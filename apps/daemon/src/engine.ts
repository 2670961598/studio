/**
 * engine —— daemon 主循环七相位引擎（docs/17-§2，v0.5 合龙件）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§2 主循环（相位机，每拍幂等）：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。
 *     同一 tick 内单只一单至多一动作（decide 每单调一次，结构性保证）；tick 返回结构化 actions 落账。
 *   - docs/17-§6 末 收割成功契约四要件：终态事件 completed + 输出非空 + REPORT 落盘 + 闸门 exit=0。
 *     前两要件由引擎消费 adapter.stream() 判定；后两要件由**可注入 gateRunner**（src/gate.ts，
 *     v0 占位实现，诚实标注）执行。
 *   - docs/17-§6 末 断路器：worker 错误 → core.onWorkerError；open_bug 瞬间 events 落 ESCALATE +
 *     platform.issues.create 建 bug 单。
 *   - docs/22-§三.2 意图幂等：同 (source, kind, company, ticket) 重复意图只唤起一次——
 *     seenIntentKeys 由 **events 派生**（DISPATCH 事件 note 携 intentKey；见 indexEvents），
 *     同 tick 重放 / 重启重放均不双写。
 *   - docs/23-§四 demo 模式：fake 全家桶（platform/adapter/台账/公司目录）零外部依赖跑通——
 *     端到端预演见 apps/daemon/test/e2e.test.ts。
 *
 * v0 占位与诚实边界（真单前逐项补齐，详见 serve.ts 头注与汇报）：
 *   - gateRunner：默认实现=REPORT 存在性 + exit0 模拟（真验收命令执行归 v0.5 真单刀）；
 *   - 泳道租约：进程内 Map + TTL（**不持久**；续租/死主回收/跨进程互斥归后续刀——单进程 v0 无死主）；
 *   - 断路器状态：进程内（重启即清零；持久化拟走 events 派生，待批示）；
 *   - 重启后在途接管：work_records 留 'running' 但 handle 已失（WORKER_DEAD 检测归后续刀）；
 *     dispose() 仅对内存 handle 优雅 kill；
 *   - 合并相位：v0 无真 git 合并（MERGE 事件 + 状态迁移的**模拟**，note 如实标注）；
 *   - 任务书只出首版（续跑版=上次 summary.json 前情注入，17-§5，归真单刀）；
 *   - 呈批迁移（submit_approval）：v0 直迁平台，不落事件（呈批事件名待批示；真路径=网关
 *     动作词 GW_*，v0 无网关不伪造 GW_ 事件）；
 *   - approved 输入：v0 用 config.autoApprove（demo 自动批）；真制作人批准信号经网关动作词
 *     落平台后由 daemon 归一（decide.ts 头注拟稿待批点）；
 *   - 采集增量：activity 游标增量 + issues.list 全量对账（17-§12 分页/增量优化后续）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - 游标持久化：store 无 kv 表，jobs 表是调度投影不宜复用——daemon 在台账库自建 daemon_kv
 *     （key TEXT PK, value TEXT；daemon 是台账唯一写入者，写面合法）；store 升级 kv 表后迁移。
 *   - work_records 收口：store 只有 insert 无 update——收口（ended_at/status/cost/report_ref
 *     回填）经 ledger.db 标准面直发 UPDATE（拟稿；store 补 updateWorkRecord 后迁移）。
 *   - seenIntentKeys 语义：DISPATCH 落账即「意图已消费」；该单出现 GATE_PASS/GATE_FAIL 后键
 *     释放（成功→证据就绪走收割链；失败→回首批位可再派）。100 重复活动→1 次派发即此语义。
 *   - attempt 口径：= 该单 DISPATCH 事件计数 + 1（events 派生，可重放）。
 *   - events.level：IssueRecord.level 是流等级（0→L0 流），events.level 是 1..9 人员/公司口径——
 *     取 max(1, level)（0 级单按 1 记）。两口径混用为文档疑点，已上报不改文档。
 *   - ticket_mirror.created：IssueRecord 无 created 字段，以 updated 近似（镜像可重建，17-§3）。
 *   - HEARTBEAT 哨兵单号：events.issue 必填（contract），零动作拍挂 config.heartbeatIssue（'-'）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  EventRecord,
  ExecutorAdapter,
  FlowPlatform,
  Handle,
  IssueRecord,
  PersonRef,
  ResultStats,
  TicketId,
} from '@studio-next/contract'
import {
  breakerStrikes,
  DEFAULT_FLOW_TABLE,
  decide,
  emptyBreakerState,
  flowAnchors,
  flowLevelKey,
  onWorkerError,
  onSuccess,
  resolveFlow,
  type Action,
  type BreakerState,
  type ConcurrencyLimits,
  type DecisionCode,
  type FlowTable,
} from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import type { GateRunner } from './gate.ts'
import { makeUlid } from './id.ts'
import type { PromptAssembler } from './prompt-assembly.ts'

// ————————————————————————— 配置 —————————————————————————

/** 引擎配置（并发三闸阈值即 ConcurrencyLimits，docs/17-§2） */
export interface EngineConfig {
  /** 公司 slug（events.company / intents.company / ticket_mirror.company） */
  company: string
  /** 工位根：workspace = <rootDir>/workspaces/<单号>/att<N> */
  rootDir: string
  /** events.actor（17-§3「工号+账号」编码归 store 层定——v0 'daemon' 拟稿） */
  actor: string
  /** 派工默认工号（issue.assignee 缺省时的人员索引回退位） */
  defaultPersonId: string
  /** events.dept / ticket_mirror.dept 兜底 */
  deptFallback: string
  /** issue.lane 缺省泳道 */
  defaultLane: string
  /** InvokeIntent.source（v0 活动流轮询源名） */
  intentSource: string
  /** 并发三闸之两闸（第三闸=泳道租约） */
  limits: ConcurrencyLimits
  /** 泳道租约 TTL（ms；续租/死主回收归后续刀） */
  laneTtlMs: number
  /** 在工静默告警阈值（ms；只盯已派发态，decide 4 号判定） */
  stallAfterMs: number
  /** 断路阈值 N（17-§6 默认 3） */
  breakerThreshold: number
  /** demo 模式自动批（真制作人批准信号经网关动作词归一，v0 布尔拟稿） */
  autoApprove: boolean
  /** 零动作拍 HEARTBEAT 的哨兵单号（contract events.issue 必填——拟稿待批） */
  heartbeatIssue: string
  /** 每拍 activity 翻页上限 */
  maxActivityPages: number
  /** dispose() 优雅杀宽限（ms） */
  killGraceMs: number
  /** 状态流表覆盖（公司目录 flows；缺省 DEFAULT_FLOW_TABLE，docs/18-§2.1） */
  flows?: FlowTable
}

/** 缺省引擎配置（demo/测试可直接改写；serve 侧由 daemon.yaml 覆盖） */
export const ENGINE_CONFIG_DEFAULTS: EngineConfig = {
  company: 'demo',
  rootDir: './var',
  actor: 'daemon',
  defaultPersonId: '',
  deptFallback: 'departments/工程部',
  defaultLane: 'core',
  intentSource: 'activity',
  limits: { maxActionsPerTick: 4, maxInflight: 2 },
  laneTtlMs: 30 * 60_000,
  stallAfterMs: 60 * 60_000,
  breakerThreshold: 3,
  autoApprove: false,
  heartbeatIssue: '-',
  maxActivityPages: 10,
  killGraceMs: 5_000,
}

// ————————————————————————— 依赖注入 —————————————————————————

/** 引擎依赖：全注入（platform 泳道的 @studio-next/localplatform 接入点=此处 FlowPlatform
 *  参数——v0 传 fake（src/fakes.ts）；真 localfile/YouTrack 接线归 platform 泳道合龙） */
export interface EngineDeps {
  platform: FlowPlatform
  ledger: Ledger
  registry: ExecutorRegistry
  assembler: PromptAssembler
  /** 闸门执行器（v0 默认占位实现见 src/gate.ts；真验收命令版归 v0.5 真单刀） */
  gateRunner: GateRunner
  clock: () => number
  config: EngineConfig
  /** 人员索引（公司目录快照静态注入；人事流热更归后续刀） */
  people: readonly PersonRef[]
  /** ULID 生成器（缺省 src/id.ts；测试可注入确定性序列） */
  makeId?: (ts: number) => string
}

// ————————————————————————— TickReport（17-§2「tick 返回结构化 actions」） —————————————————————————

/** 采集相位汇报 */
export interface TickPhaseCollect {
  activities: number
  pages: number
  affectedTickets: number
  mirrorSynced: number
  cursorBefore: string | null
  cursorAfter: string | null
}

/** state-diff 相位：每候选一决（含 hold/noop——落账口径全量留痕） */
export interface TickDecisionEntry {
  ticket: TicketId
  intentKey: string
  code: DecisionCode
  actionType: Action['type']
}

/** 动作执行结果（派发/呈批/collect/merge/recycle/stall 面） */
export interface TickActionResult {
  ticket: TicketId
  actionType: Action['type']
  ok: boolean
  detail?: string
}

/** 收割相位汇报 */
export interface TickPhaseHarvest {
  checked: number
  completed: number
  failed: number
  pending: number
}

/** 一拍全量汇报（JSON 可序列化；actions=结构化动作原体，actionResults=执行面，events=本拍新账） */
export interface TickReport {
  seq: number
  ts: { start: number; end: number }
  phases: {
    collect: TickPhaseCollect
    stateDiff: { candidates: number; decisions: readonly TickDecisionEntry[] }
    dispatch: { dispatched: number; approvals: number; results: readonly TickActionResult[] }
    harvest: TickPhaseHarvest
    merge: { merged: number }
    recycle: { recycled: number }
    account: { eventsAppended: number; heartbeat: boolean }
  }
  actions: readonly Action[]
  actionResults: readonly TickActionResult[]
  events: readonly EventRecord[]
  inflightAfter: number
  errors: readonly string[]
}

// ————————————————————————— 内部状态 —————————————————————————

/** 在途工位（dispatch 落 work_record 'running' 后登记；harvest 收口后注销） */
interface Inflight {
  ticket: TicketId
  workRecordId: string
  executor: string
  handle: Handle
  workspace: string
  briefPath: string
  attempt: number
  lane: string
  /** 派发拍序：本拍派发的下一拍才可收割（同拍单至多一动作的收割侧落点） */
  dispatchedAtSeq: number
}

/** 泳道租约（进程内 v0：holder=单号；TTL 到期视同无主——decide laneFree 同语义） */
interface LaneLease {
  holder: TicketId
  expiresAt: number
}

/** events 派生索引（幂等依据；每拍重建，可重放） */
interface EventIndex {
  /** DISPATCH 计数（attempt=计数+1） */
  attemptOf(ticket: TicketId): number
  /** 在工意图键集（DISPATCH 已消费且无收割结论——重复活动 noop） */
  seenKeys: readonly string[]
  /** 已 CLOSE 单（不再进 state-diff 候选） */
  closed: ReadonlySet<TicketId>
}

// ————————————————————————— 引擎本体 —————————————————————————

/** 引擎句柄：serve 循环每拍调 tick()；停机走 dispose()（在途 drain=优雅杀） */
export interface Engine {
  tick(): Promise<TickReport>
  /** 在途 drain（v0：对内存 handle 优雅 kill；work_records 留 running——重启接管归后续刀） */
  dispose(): Promise<void>
  readonly config: EngineConfig
}

const KV_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS daemon_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
const CURSOR_KEY = 'activity.cursor'
const TICK_SEQ_KEY = 'tick.seq'

export function createEngine(deps: EngineDeps): Engine {
  const { platform, ledger, registry, assembler, gateRunner, clock, config, people } = deps
  const makeId = deps.makeId ?? makeUlid

  // —— 进程内状态（持久化边界见文件头注「v0 占位」） ——
  let breaker: BreakerState = emptyBreakerState()
  const lanes = new Map<string, LaneLease>()
  const inflight = new Map<TicketId, Inflight>()
  let seq = 0

  // daemon_kv（拟稿：store 升 kv 表后迁移，见文件头注）
  ledger.db.exec(KV_TABLE_SQL)
  const kvGetStmt = ledger.db.prepare('SELECT value FROM daemon_kv WHERE key = ?')
  const kvSetStmt = ledger.db.prepare(
    'INSERT INTO daemon_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  const kvGet = (key: string): string | null => {
    const row = kvGetStmt.get(key) as { value: string } | undefined
    return row === undefined ? null : row.value
  }
  const kvSet = (key: string, value: string): void => {
    kvSetStmt.run(key, value)
  }
  const seqSeed = Number.parseInt(kvGet(TICK_SEQ_KEY) ?? '0', 10)
  if (Number.isInteger(seqSeed) && seqSeed > 0) seq = seqSeed

  // ————————————————— 小构件 —————————————————

  /** 时钟（一切时刻经注入 clock——core 纪律在 daemon 侧的同形落点） */
  const now = (): number => clock()

  function evtLevel(issue: IssueRecord): number {
    return Math.min(9, Math.max(1, issue.level ?? 1))
  }

  function evtDept(issue: IssueRecord): string {
    return issue.dept ?? config.deptFallback
  }

  /** 四桶映射（F2-04 冻结列名；kernel.TokenCounts 三字段→四桶，cached→cache_read 拟稿） */
  function tokenBuckets(stats: ResultStats): EventRecord['tokens'] {
    const out: Record<string, number> = { input: stats.tokens.input, output: stats.tokens.output }
    if (stats.tokens.cached !== undefined) out.cache_read = stats.tokens.cached
    return out as EventRecord['tokens']
  }

  /** 记账+入拍汇报（appendEvent 是 events 唯一写口——store 契约闸前置） */
  function append(evt: EventRecord, tickEvents: EventRecord[]): void {
    const r = ledger.appendEvent(evt)
    if (r.appended) tickEvents.push(evt)
  }

  function makeEvent(
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: {
      tokens?: EventRecord['tokens']
      cost_usd?: number
      duration_ms?: number
      size?: number
      payload_hash?: string
      note?: string
    },
  ): EventRecord {
    const ts = now()
    const rec: EventRecord = {
      id: makeId(ts),
      ts,
      company: config.company,
      issue: issue.id,
      event: name,
      actor: config.actor,
      attempt,
      level: evtLevel(issue),
      dept: evtDept(issue),
      tokens: extra?.tokens ?? { input: 0 },
      ...(extra?.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      ...(extra?.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
      ...(extra?.size !== undefined ? { size: extra.size } : {}),
      ...(extra?.payload_hash !== undefined ? { payload_hash: extra.payload_hash } : {}),
      ...(extra?.note !== undefined ? { note: extra.note } : {}),
    }
    append(rec, tickEvents)
    return rec
  }

  /** ticket_mirror upsert（IssueRecord→镜像列；created 以 updated 近似——拟稿见头注） */
  function syncMirror(issue: IssueRecord): void {
    const updatedMs = Date.parse(issue.updated)
    const safe = Number.isNaN(updatedMs) ? now() : updatedMs
    ledger.upsertTicketMirror({
      issue: issue.id,
      company: config.company,
      created: safe,
      updated: safe,
      state: issue.state,
      type: issue.type ?? 'task',
      dept: evtDept(issue),
      level: evtLevel(issue),
      dispatcher: config.actor,
      ...(issue.parent !== undefined ? { parent: issue.parent } : {}),
      ...(issue.lane !== undefined ? { lane: issue.lane } : {}),
    })
  }

  /** events 派生索引（幂等三件套：attempt/seen/closed；见文件头注拟稿） */
  function indexEvents(): EventIndex {
    const dispatchCount = new Map<TicketId, number>()
    const lastDispatch = new Map<TicketId, { ts: number; key: string | null }>()
    const lastOutcome = new Map<TicketId, number>()
    const closed = new Set<TicketId>()
    for (const e of ledger.queryEvents()) {
      if (e.event === 'DISPATCH') {
        dispatchCount.set(e.issue, (dispatchCount.get(e.issue) ?? 0) + 1)
        const key = e.note?.split(';').find((s) => s.startsWith('intent='))?.slice('intent='.length) ?? null
        lastDispatch.set(e.issue, { ts: e.ts, key })
      } else if (e.event === 'GATE_PASS' || e.event === 'GATE_FAIL') {
        lastOutcome.set(e.issue, Math.max(lastOutcome.get(e.issue) ?? 0, e.ts))
      } else if (e.event === 'CLOSE') {
        closed.add(e.issue)
      }
    }
    const seen: string[] = []
    for (const [ticket, last] of lastDispatch) {
      if (last.key !== null && (lastOutcome.get(ticket) ?? 0) <= last.ts) seen.push(last.key)
    }
    return {
      attemptOf: (ticket: TicketId): number => (dispatchCount.get(ticket) ?? 0) + 1,
      seenKeys: seen,
      closed,
    }
  }

  /** 泳道租约状态（过期=死主视同无主——decide laneFree 同语义；过期判定归 decide 入参时钟） */
  function laneState(lane: string): { lane: string; holder: string | null; expiresAt?: number } {
    const lease = lanes.get(lane)
    if (lease === undefined) return { lane, holder: null }
    return { lane, holder: lease.holder, expiresAt: lease.expiresAt }
  }

  function acquireLane(lane: string, ticket: TicketId, at: number): void {
    lanes.set(lane, { holder: ticket, expiresAt: at + config.laneTtlMs })
  }

  function releaseLane(lane: string, ticket: TicketId): void {
    const lease = lanes.get(lane)
    if (lease !== undefined && lease.holder === ticket) lanes.delete(lane)
  }

  function resolvePerson(issue: IssueRecord): PersonRef | undefined {
    return (
      (issue.assignee !== undefined ? people.find((p) => p.id === issue.assignee) : undefined) ??
      people.find((p) => p.id === config.defaultPersonId) ??
      people[0]
    )
  }

  function flowOf(issue: IssueRecord) {
    return resolveFlow(config.flows ?? DEFAULT_FLOW_TABLE, flowLevelKey(issue.level))
  }

  // ————————————————— 相位执行体 —————————————————

  /**
   * 派发：装配（AGENTS.md+任务书落盘）→ registry 选适配器 → launch → work_records 落在途
   * → 平台迁已派发 → events 落 DISPATCH（note 携分层指纹与 intentKey——幂等索引依据）。
   */
  async function executeDispatch(
    action: Extract<Action, { type: 'dispatch' }>,
    intentKey: string,
    index: EventIndex,
    tickEvents: EventRecord[],
  ): Promise<TickActionResult> {
    const ticket = action.ticket
    // state-diff 排队时已占泳道（决策即占用）——任何失败路径都必须归还，不留死锁
    const fail = (detail: string): TickActionResult => {
      releaseLane(action.lane, ticket)
      inflight.delete(ticket)
      return { ticket, actionType: action.type, ok: false, detail }
    }
    if (inflight.has(ticket)) {
      return fail('该单已有在途工位（幂等跳过，不双写）')
    }
    const fresh = await platform.issues.get(ticket)
    const person = resolvePerson(fresh)
    if (person === undefined) {
      return fail('人员索引为空（people 未注入）——不派工')
    }
    const adapter = registry.pick()
    if (adapter === undefined) {
      return fail('注册表无存活 executor（registry.pick 空）')
    }
    const attempt = index.attemptOf(ticket)
    const workspace = path.join(config.rootDir, 'workspaces', ticket, `att${attempt}`)
    const briefPath = path.join(workspace, 'brief.md')
    const agentsTarget = path.join(workspace, 'AGENTS.md')
    const at = now()
    let launched: Handle | undefined
    try {
      // detect 前置（18-§一：launch 前必跑；不达标明报不静默降级）
      const detect = await adapter.detect()
      if (!detect.ok) {
        return fail(`executor ${adapter.name} detect 不达标：${detect.gaps.join('；')}`)
      }
      // 装配（L0-L5 → AGENTS.md + 任务书首版）与落盘（daemon 是 prompt 落盘者，17-§5）
      const assembled = assembler({
        issue: fresh,
        attempt,
        person,
        adapterName: adapter.name,
        adapterVersion: detect.version,
        capabilities: adapter.capabilities,
        workspace,
        briefPath,
        agentsTarget,
        agentsChannel: { channel: adapter.capabilities.agents_md, target: agentsTarget },
      })
      mkdirSync(workspace, { recursive: true })
      writeFileSync(agentsTarget, assembled.agentsMd.text, 'utf8')
      writeFileSync(briefPath, assembled.brief.text, 'utf8')
      const taskBrief = assembled.brief.taskBrief
      launched = await adapter.launch(taskBrief)
      acquireLane(action.lane, ticket, at)
      const transitioned = await platform.issues.transition(ticket, action.toState)
      const workRecordId = makeId(at)
      ledger.insertWorkRecord({
        id: workRecordId,
        issue: ticket,
        person_id: person.id,
        executor: adapter.name,
        session_id: launched.sessionId,
        lane: action.lane,
        started_at: at,
        attempt,
        status: 'running',
      })
      inflight.set(ticket, {
        ticket,
        workRecordId,
        executor: adapter.name,
        handle: launched,
        workspace,
        briefPath,
        attempt,
        lane: action.lane,
        dispatchedAtSeq: seq,
      })
      syncMirror(transitioned)
      makeEvent('DISPATCH', transitioned, attempt, tickEvents, {
        size: Buffer.byteLength(assembled.agentsMd.text, 'utf8'),
        payload_hash: `sha256:${createHash('sha256').update(assembled.agentsMd.text, 'utf8').digest('hex')}`,
        note: `fp=${assembled.agentsMd.fingerprint};intent=${intentKey};executor=${adapter.name}@${detect.version};agents=${agentsTarget};brief=${briefPath}`,
      })
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail: `attempt=${attempt} executor=${adapter.name} lane=${action.lane}`,
      }
    } catch (err) {
      // 派发失败如实分类上报（DISPOSITIONS: DISPATCH_FAIL/retry）；v0 不计断路连击（拟稿）
      const msg = err instanceof Error ? err.message : String(err)
      if (launched !== undefined) await adapter.kill(launched, config.killGraceMs).catch(() => undefined)
      return fail(`DISPATCH_FAIL：${msg}`)
    }
  }

  /**
   * 收割一单：消费 stream（要件 1/2）→ gateRunner（要件 3/4）→ 四要件齐=迁证据就绪+GATE_PASS+
   * work_records 收口+断路复位；不齐=回滚首批位+GATE_FAIL+断路连击（熔断瞬间 ESCALATE+建 bug 单）。
   */
  async function harvestOne(entry: Inflight, tickEvents: EventRecord[]): Promise<'completed' | 'failed'> {
    let adapter: ExecutorAdapter
    try {
      adapter = registry.resolve(entry.executor)
    } catch {
      return failHarvest(entry, tickEvents, 'CONFIG_INVALID：executor 已不在注册表（收割不可继续）', {
        completed: false,
        nonEmptyOutput: false,
        reportExists: false,
        exit0: false,
      })
    }
    const ticket = entry.ticket
    let completed = false
    let nonEmptyOutput = false
    let terminalError: string | undefined
    try {
      for await (const ev of adapter.stream(entry.handle)) {
        if (ev.type === 'log' && ev.text.trim() !== '') nonEmptyOutput = true
        if (ev.type === 'turn_end') {
          completed = ev.completed
          if (ev.error !== undefined) terminalError = ev.error
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return failHarvest(entry, tickEvents, `WORKER_DEAD：流消费异常 ${msg}`, {
        completed,
        nonEmptyOutput,
        reportExists: false,
        exit0: false,
      })
    }
    const gate = await gateRunner.run({
      ticket,
      attempt: entry.attempt,
      workspace: entry.workspace,
      briefPath: entry.briefPath,
    })
    const fresh = await platform.issues.get(ticket)
    const flow = flowOf(fresh)
    const stats = await adapter.resultStats(entry.handle)

    const verdict = { completed, nonEmptyOutput, reportExists: gate.reportExists, exit0: gate.exitCode === 0 }
    const fourOk = verdict.completed && verdict.nonEmptyOutput && verdict.reportExists && verdict.exit0
    if (flow === undefined) {
      return failHarvest(entry, tickEvents, 'CONFIG_INVALID：等级未登记状态流（收割去向不可定）', verdict)
    }
    if (fourOk) {
      const anchors = flowAnchors(flow)
      const transitioned = await platform.issues.transition(ticket, anchors.evidenceReady)
      closeWorkRecord(entry.workRecordId, {
        status: 'done',
        endedAt: now(),
        costUsd: stats.cost.usd,
        tokens: stats.tokens,
        reportRef: gate.reportExists ? gate.reportPath : undefined,
        summaryRef: gate.summaryPath,
      })
      breaker = onSuccess(breaker, ticket).newState
      inflight.delete(ticket)
      syncMirror(transitioned)
      makeEvent('GATE_PASS', transitioned, entry.attempt, tickEvents, {
        tokens: tokenBuckets(stats),
        cost_usd: stats.cost.usd,
        duration_ms: stats.duration,
        note: `四要件齐（completed/非空/REPORT/exit0）；report=${gate.reportPath}${gate.summaryPath !== undefined ? `;summary=${gate.summaryPath}` : ''}`,
      })
      return 'completed'
    }
    const missing = [
      ...(verdict.completed ? [] : ['终态 completed']),
      ...(verdict.nonEmptyOutput ? [] : ['输出非空']),
      ...(verdict.reportExists ? [] : ['REPORT 落盘']),
      ...(verdict.exit0 ? [] : ['闸门 exit=0']),
    ].join('、')
    const detail = `GATE_FAIL：四要件缺【${missing}】${terminalError !== undefined ? `；turn_end.error=${terminalError}` : ''}${gate.note !== undefined ? `；gate=${gate.note}` : ''}`
    return failHarvest(entry, tickEvents, detail, verdict)
  }

  /** 收割失败面：回滚首批位 + GATE_FAIL 落账 + work_records 收口 failed + 断路连击（熔断开 bug 单） */
  async function failHarvest(
    entry: Inflight,
    tickEvents: EventRecord[],
    detail: string,
    verdict: { completed: boolean; nonEmptyOutput: boolean; reportExists: boolean; exit0: boolean },
  ): Promise<'completed' | 'failed'> {
    const ticket = entry.ticket
    const fresh = await platform.issues.get(ticket)
    const flow = flowOf(fresh)
    // 断路签名：四要件失败形态（同形态连击才熔断——breaker streak 语义）
    const signature = `harvest:${verdict.completed ? 'c' : '-'}${verdict.nonEmptyOutput ? 'o' : '-'}${verdict.reportExists ? 'r' : '-'}${verdict.exit0 ? 'g' : '-'}`
    closeWorkRecord(entry.workRecordId, { status: 'failed', endedAt: now() })
    inflight.delete(ticket)
    releaseLane(entry.lane, ticket)
    if (flow !== undefined) {
      // 回首批位（DEFAULT_ROLLBACK_EDGES：已派发→新单；断路器停重派语义，breaker.ts 头注）
      const rolled = await platform.issues.transition(ticket, flowAnchors(flow).fresh)
      syncMirror(rolled)
      makeEvent('GATE_FAIL', rolled, entry.attempt, tickEvents, {
        note: `${detail};rollback=${flowAnchors(flow).fresh}`,
      })
    } else {
      makeEvent('GATE_FAIL', fresh, entry.attempt, tickEvents, { note: `${detail};rollback=跳过（等级未登记流）` })
    }
    // 断路器：worker 错误入账（同单同签名连击；达阈值熔断→open_bug）
    const result = onWorkerError(breaker, ticket, signature, { threshold: config.breakerThreshold })
    breaker = result.newState
    if (result.action !== null) {
      const bug = await platform.issues.create({
        title: `[bug] ${ticket} 断路熔断（同签名 ${result.action.strikes} 连击：${signature}）`,
        description: detail,
        type: 'bug',
        dept: evtDept(fresh),
        // 不定级：未定级单无状态流（decide NOOP_UNKNOWN_FLOW 明报不动），bug 单待人定级后派
      })
      await platform.links.link(bug.id, ticket, 'relates-to').catch(() => undefined)
      makeEvent('ESCALATE', fresh, entry.attempt, tickEvents, {
        note: `CIRCUIT_BREAK：${ticket} 连击 ${result.action.strikes} 达阈值 ${config.breakerThreshold}（签名 ${signature}）→ 自动开 bug 单 ${bug.id}`,
      })
      syncMirror(bug)
    }
    return 'failed'
  }

  /** work_records 收口（store 无 update 面——ledger.db 标准面直发 UPDATE，拟稿见头注） */
  function closeWorkRecord(
    id: string,
    closed: {
      status: string
      endedAt: number
      costUsd?: number | undefined
      tokens?: ResultStats['tokens'] | undefined
      reportRef?: string | undefined
      summaryRef?: string | undefined
    },
  ): void {
    ledger.db
      .prepare(
        'UPDATE work_records SET ended_at = ?, status = ?, cost_usd = COALESCE(?, cost_usd), tokens = COALESCE(?, tokens), report_ref = COALESCE(?, report_ref), summary_ref = COALESCE(?, summary_ref) WHERE id = ?',
      )
      .run(
        closed.endedAt,
        closed.status,
        closed.costUsd ?? null,
        closed.tokens !== undefined ? JSON.stringify(closed.tokens) : null,
        closed.reportRef ?? null,
        closed.summaryRef ?? null,
        id,
      )
  }

  // ————————————————— tick：七相位 —————————————————

  async function tick(): Promise<TickReport> {
    seq += 1
    kvSet(TICK_SEQ_KEY, String(seq))
    const startedAt = now()
    const tickEvents: EventRecord[] = []
    const decisions: TickDecisionEntry[] = []
    const decidedActions: Action[] = []
    const actionResults: TickActionResult[] = []
    const errors: string[] = []
    let mutations = 0

    // —— 相位 1 采集：activity 增量（游标）+ issues 全量对账（镜像 upsert） ——
    const cursorRaw = kvGet(CURSOR_KEY)
    // 空串=「游标为 null（尚未消费任何活动）」的持久形态（kv 列 NOT NULL——回读须还原 null）
    const cursorBefore = cursorRaw === '' || cursorRaw === null ? null : cursorRaw
    let cursor: string | null = cursorBefore
    const affected: TicketId[] = []
    const affectedSeen = new Set<TicketId>()
    let pages = 0
    let activityCount = 0
    try {
      for (let i = 0; i < config.maxActivityPages; i += 1) {
        pages += 1
        const page = await platform.activity.since(cursor)
        for (const item of page.items) {
          activityCount += 1
          if (item.issue !== undefined && !affectedSeen.has(item.issue)) {
            affectedSeen.add(item.issue)
            affected.push(item.issue)
          }
        }
        if (page.nextCursor !== null) {
          cursor = page.nextCursor
        } else if (page.items.length > 0) {
          // 平台「无更多」但本页有货：游标退守最后活动 id（docs/25-§3.2 YouTrack=最后活动 id 边界）
          const last = page.items[page.items.length - 1]?.id
          if (last !== undefined) cursor = last
        }
        if (page.nextCursor === null) break
      }
      kvSet(CURSOR_KEY, cursor ?? '')
    } catch (err) {
      errors.push(`采集相位失败：${err instanceof Error ? err.message : String(err)}`)
    }

    const issues = await platform.issues.list({}).catch((err: unknown) => {
      errors.push(`镜像对账失败（issues.list）：${err instanceof Error ? err.message : String(err)}`)
      return [] as IssueRecord[]
    })
    const issueById = new Map<TicketId, IssueRecord>(issues.map((i) => [i.id, i]))
    for (const issue of issues) syncMirror(issue)

    // —— 相位 2 state-diff：受影响单逐个 decide（每单至多一动作；provisionalActions 供三闸） ——
    const index = indexEvents()
    const dispatchQ: Array<{ action: Extract<Action, { type: 'dispatch' }>; intentKey: string }> = []
    const approvalQ: Array<Extract<Action, { type: 'submit_approval' }>> = []
    const collectQ: Array<Extract<Action, { type: 'collect' }>> = []
    const mergeQ: Array<Extract<Action, { type: 'merge' }>> = []
    const recycleQ: Array<Extract<Action, { type: 'recycle' }>> = []
    const stallQ: Array<Extract<Action, { type: 'stall_alarm' }>> = []
    let provisionalActions = 0

    for (const ticket of [...affected].sort()) {
      if (index.closed.has(ticket)) continue // 已 CLOSE 单不再进决策
      const issue = issueById.get(ticket) ?? (await platform.issues.get(ticket).catch(() => undefined))
      if (issue === undefined) {
        errors.push(`state-diff：单 ${ticket} 平台取不到（跳过本拍）`)
        continue
      }
      const lane = issue.lane ?? config.defaultLane
      const intent = {
        kind: 'ticket' as const,
        company: config.company,
        ticket,
        source: config.intentSource,
        priority: 1,
      }
      const out = decide({
        issue,
        laneLease: laneState(lane),
        // 在途计数=已落工位 + 本拍已排队派发（两段式「先决后执」下三闸仍须拍内即时生效）
        inflightCount: inflight.size + dispatchQ.length,
        tickActionCount: provisionalActions,
        limits: config.limits,
        intent,
        seenIntentKeys: index.seenKeys,
        breaker: { strikes: breakerStrikes(breaker, ticket), threshold: config.breakerThreshold },
        ...(config.autoApprove ? { approved: true } : {}),
        ...(config.flows !== undefined ? { flows: config.flows } : {}),
        now: startedAt,
        stallAfterMs: config.stallAfterMs,
      })
      const { action, intentKey } = out
      decisions.push({ ticket, intentKey, code: action.code, actionType: action.type })
      decidedActions.push(action)
      switch (action.type) {
        case 'dispatch':
          dispatchQ.push({ action, intentKey })
          provisionalActions += 1
          // 决策即占用泳道（两段式先决后执：后续候选的 decide 须看到本拍已派的占用；
          // 执行失败时 executeDispatch 的 catch 负责释放）
          acquireLane(action.lane, ticket, startedAt)
          break
        case 'submit_approval':
          approvalQ.push(action)
          provisionalActions += 1
          break
        case 'collect':
          collectQ.push(action)
          provisionalActions += 1
          break
        case 'merge':
          mergeQ.push(action)
          provisionalActions += 1
          break
        case 'recycle':
          recycleQ.push(action)
          provisionalActions += 1
          break
        case 'stall_alarm':
          stallQ.push(action)
          provisionalActions += 1
          break
        case 'hold':
        case 'wait_evidence':
        case 'noop':
        case 'open_bug': // open_bug 只由断路器产生（收割面），decide 不出——防御性忽略
          break
      }
    }

    // —— 相位 3 派发：submit_approval（派发前置呈批）→ dispatch ——
    let approvals = 0
    for (const action of approvalQ) {
      try {
        const transitioned = await platform.issues.transition(action.ticket, action.toState)
        syncMirror(transitioned)
        approvals += 1
        mutations += 1
        actionResults.push({
          ticket: action.ticket,
          actionType: action.type,
          ok: true,
          detail: `呈批→${action.toState}（v0 直迁，事件名待批示）`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`呈批迁移失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }
    let dispatched = 0
    for (const { action, intentKey } of dispatchQ) {
      const result = await executeDispatch(action, intentKey, index, tickEvents)
      actionResults.push(result)
      if (result.ok) {
        dispatched += 1
        mutations += 1
      } else {
        errors.push(`派发失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }

    // —— 相位 4 收割：在途 handle 检查（本拍派发的下一拍才收）→ collect 动作 → stall 告警 ——
    const harvest = { checked: 0, completed: 0, failed: 0, pending: 0 }
    for (const entry of [...inflight.values()]) {
      if (entry.dispatchedAtSeq === seq) {
        harvest.pending += 1
        continue
      }
      harvest.checked += 1
      try {
        const outcome = await harvestOne(entry, tickEvents)
        if (outcome === 'completed') harvest.completed += 1
        else harvest.failed += 1
        mutations += 1
      } catch (err) {
        errors.push(`收割异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    for (const action of collectQ) {
      try {
        const fresh = await platform.issues.get(action.ticket)
        const flow = flowOf(fresh)
        if (flow === undefined) {
          errors.push(`collect：单 ${action.ticket} 等级未登记流`)
          actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: '等级未登记流' })
          continue
        }
        const anchors = flowAnchors(flow)
        const transitioned = await platform.issues.transition(action.ticket, anchors.verified)
        syncMirror(transitioned)
        makeEvent('QA_PASS', transitioned, index.attemptOf(action.ticket), tickEvents, {
          note: '证据就绪→复验通过（收割相位 QA 面）',
        })
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `→${anchors.verified}` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`collect 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }
    for (const action of stallQ) {
      const fresh = await platform.issues.get(action.ticket).catch(() => undefined)
      if (fresh !== undefined) {
        makeEvent('STALL', fresh, index.attemptOf(action.ticket), tickEvents, {
          note: `在工静默 ${action.silentMs}ms 超阈值 ${config.stallAfterMs}ms（看门狗告警；kill 重派归后续刀）`,
        })
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `silentMs=${action.silentMs}` })
      }
    }

    // —— 相位 5 合并：复验通过 → 已交付（v0 模拟合并——无真 git 操作，note 如实标注） ——
    let merged = 0
    for (const action of mergeQ) {
      try {
        const transitioned = await platform.issues.transition(action.ticket, action.toState)
        syncMirror(transitioned)
        makeEvent('MERGE', transitioned, index.attemptOf(action.ticket), tickEvents, {
          note: `→${action.toState}（v0 模拟合并：无真 git 合并，归 v0.5 真单刀）`,
        })
        merged += 1
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `→${action.toState}（模拟）` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`merge 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }

    // —— 相位 6 回收：已交付 → 关单落账 + 泳道释放（已交付为终态，无平台迁移） ——
    let recycled = 0
    for (const action of recycleQ) {
      try {
        const fresh = await platform.issues.get(action.ticket)
        const lane = fresh.lane ?? config.defaultLane
        releaseLane(lane, action.ticket)
        makeEvent('CLOSE', fresh, index.attemptOf(action.ticket), tickEvents, {
          note: '交付回收：泳道释放、工位归档（会话归档归后续刀）',
        })
        recycled += 1
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `lane=${lane} 释放` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`recycle 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }

    // —— 相位 7 落账/心跳：零动作拍落 HEARTBEAT（游标/拍序已持久化） ——
    let heartbeat = false
    if (mutations === 0) {
      const sentinel: IssueRecord = {
        id: config.heartbeatIssue,
        title: '心跳哨兵',
        state: '-',
        dept: config.deptFallback,
        level: 1,
        updated: new Date(startedAt).toISOString(),
      }
      makeEvent('HEARTBEAT', sentinel, 1, tickEvents, { note: `tick#${seq} 无机器动作（activities=${activityCount}）` })
      heartbeat = true
    }

    return {
      seq,
      ts: { start: startedAt, end: now() },
      phases: {
        collect: {
          activities: activityCount,
          pages,
          affectedTickets: affected.length,
          mirrorSynced: issues.length,
          cursorBefore,
          cursorAfter: cursor,
        },
        stateDiff: { candidates: affected.length, decisions },
        dispatch: {
          dispatched,
          approvals,
          results: actionResults.filter((r) => r.actionType === 'dispatch' || r.actionType === 'submit_approval'),
        },
        harvest,
        merge: { merged },
        recycle: { recycled },
        account: { eventsAppended: tickEvents.length, heartbeat },
      },
      actions: decidedActions,
      actionResults,
      events: tickEvents,
      inflightAfter: inflight.size,
      errors,
    }
  }

  async function dispose(): Promise<void> {
    for (const entry of [...inflight.values()]) {
      try {
        const adapter = registry.resolve(entry.executor)
        await adapter.kill(entry.handle, config.killGraceMs)
      } catch {
        // kill 失败如实吞记（v0：dispose 不抛——停机路径保序）；work_records 留 running（接管归后续刀）
      }
    }
    inflight.clear()
  }

  const engine: Engine = {
    tick,
    dispose,
    get config(): EngineConfig {
      return config
    },
  }
  return engine
}
