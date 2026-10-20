/**
 * fakes —— demo 模式全家桶：fake FlowPlatform + fake executor adapter（docs/23-§四）
 *
 * 定位：
 *   - docs/23-§四「demo 模式（localfile）零外部依赖跑通 TTHW」的 daemon 侧预演件——
 *     serve --platform fake 与 e2e 测试共用本文件；真 localfile 平台归 platform 泳道
 *     （@studio-next/localplatform，v0 未挂 daemon 依赖——node_modules/@studio-next 无此包，
 *     接入点=serve.ts wirePlatform 与 engine deps 的 FlowPlatform 参数）。
 *   - fake platform：内存实现 FlowPlatform 七能力（issues/comments/fields/kb/activity/links/
 *     guards），活动流游标=数字 id 边界（对齐 docs/25-§3.2 YouTrack「最后活动 id」语义）。
 *   - fake adapter：launch 即产出**完成流**并落 REPORT.md + summary.json 到 workspace
 *     （模拟 worker 一命终态；流一次性消费——dsh 同款纪律），四要件中前两要件恒真、
 *     REPORT 由本适配器代写（要件 3/4 归 gateRunner——v0 占位闸门即检查这两个文件）。
 *
 * 诚实边界：fake adapter 的「工作产出」是固定文本——不跑真模型、不跑真验收命令；
 * 失败形态（mode）只覆盖收割四要件的缺失面，供断路器/回滚链路测试注入。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  ActivityPage,
  BudgetEstimate,
  Comment,
  CompanySlug,
  DetectResult,
  ExecutorAdapter,
  ExecutorCapabilities,
  FieldProvisionMap,
  FieldSchema,
  FlowPlatform,
  GuardRule,
  Handle,
  IssueCreate,
  IssueQuery,
  IssueRecord,
  KbHit,
  LinkType,
  PlatformActivity,
  ResultStats,
  SignedBody,
  StreamEvent,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'

// ————————————————————————— fake FlowPlatform —————————————————————————

/** fake 平台选项 */
export interface FakePlatformOptions {
  /** 时钟注入（IssueRecord.updated/活动 ts 一致性来源；缺省真时钟） */
  now?: () => string
  /** 活动流分页大小（缺省 100；测试注入小值可验翻页） */
  pageSize?: number
  /**
   * fields.schema() 的 state 枚举覆盖（DEV-49 A4 状态集巡逻核注入面）：缺省五态
   * （与 fake 流表口径一致=零漂移）；注入含流外语（如出厂 New）即造「平台状态集−
   * 声明集≠∅」漂移——巡逻核测试唯一入口。
   */
  schemaStates?: string[]
}

interface FakeIssue extends IssueRecord {
  created: string
}

/**
 * 内存 FlowPlatform：状态权威在本实例（Map）；一切变更推活动流。
 * 游标=活动 id（数字字符串，升序）；since(cursor) 返回 id > cursor 的活动，
 * nextCursor=本页末条 id（有货即给——空页才 null，允许调用方多拉一拍空页）。
 */
export function createFakePlatform(opts?: FakePlatformOptions): FlowPlatform {
  const now = opts?.now ?? (() => new Date().toISOString())
  const pageSize = opts?.pageSize ?? 100
  const issues = new Map<TicketId, FakeIssue>()
  const comments = new Map<TicketId, Comment[]>()
  const links = new Map<TicketId, Array<{ other: TicketId; type: LinkType }>>()
  const kb = new Map<string, string>()
  const activities: PlatformActivity[] = []
  let issueSeq = 0
  let actSeq = 0
  let commentSeq = 0

  const pushActivity = (issue: TicketId | undefined, kind: string, actor?: string): void => {
    actSeq += 1
    activities.push({ id: String(actSeq), ts: now(), ...(issue !== undefined ? { issue } : {}), kind, ...(actor !== undefined ? { actor } : {}) })
  }

  // 最近一次 provision 的映射（N2，DEV-43）：建单落位按 localplatform 同一解析序消费
  // typeInbox——fake 平台与真实平台的建单语义必须同构（e2e 断言才有效力）
  let provisioned: FieldProvisionMap | null = null

  const mustIssue = (id: TicketId): FakeIssue => {
    const found = issues.get(id)
    if (found === undefined) throw new Error(`fake-platform：单据不存在 ${id}`)
    return found
  }

  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        let all = [...issues.values()]
        if (q.stateIn !== undefined) all = all.filter((i) => q.stateIn?.includes(i.state))
        if (q.assignee !== undefined) all = all.filter((i) => i.assignee === q.assignee)
        if (q.lane !== undefined) all = all.filter((i) => i.lane === q.lane)
        if (q.updatedSince !== undefined) all = all.filter((i) => i.updated > (q.updatedSince ?? ''))
        return all.map(({ ...i }) => ({ ...i }))
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return { ...mustIssue(id) }
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        issueSeq += 1
        const id = `T-${issueSeq}`
        const rec: FakeIssue = {
          id,
          title: input.title,
          // 建单落位（docs/25-§3.2 + DEV-43 docs/18-§2.1.1）：解析序=显式入参 >
          // typeInbox[type]（provision 按单据类型查收件态）> states[0] > 平台默认态（新单）
          // ——与 localplatform.createIssue 同序（N2）
          state:
            input.initialState
            ?? (input.type !== undefined ? provisioned?.typeInbox?.[input.type] : undefined)
            ?? provisioned?.states[0]
            ?? '新单',
          updated: now(),
          created: now(),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.dept !== undefined ? { dept: input.dept } : {}),
          ...(input.level !== undefined ? { level: input.level } : {}),
          ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
          ...(input.parent !== undefined ? { parent: input.parent } : {}),
        }
        issues.set(id, rec)
        pushActivity(id, 'issue-created', input.assignee)
        return { ...rec }
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        const rec = mustIssue(id)
        rec.state = toState
        rec.updated = now()
        pushActivity(id, 'state-transition')
        return { ...rec }
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        const rec = mustIssue(id)
        const key = field as keyof FakeIssue
        if (key === 'lane' || key === 'assignee' || key === 'dept' || key === 'level' || key === 'type' || key === 'title') {
          ;(rec as unknown as Record<string, unknown>)[key] = value
        }
        rec.updated = now()
        pushActivity(id, `field-set:${field}`)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        mustIssue(id)
        commentSeq += 1
        const list = comments.get(id) ?? []
        list.push({ id: `c-${commentSeq}`, issue: id, author: body.author, body: body.body, created: now() })
        comments.set(id, list)
        pushActivity(id, 'comment-added', body.author)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return [...(comments.get(id) ?? [])]
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return [
          { name: 'state', type: 'enum', values: opts?.schemaStates ?? ['新单', '已派发', '证据就绪', '复验通过', '已交付'] },
          { name: 'level', type: 'int' },
          { name: 'dept', type: 'string' },
        ]
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        // fake 平台无字段物化面（provision 记活动即视为受理；映射留存供建单落位消费——N2）
        provisioned = map
        pushActivity(undefined, 'fields-provisioned')
      },
    },
    kb: {
      async upsert(p: string, md: string): Promise<void> {
        kb.set(p, md)
        pushActivity(undefined, 'kb-upsert')
      },
      async search(q: string): Promise<KbHit[]> {
        return [...kb.entries()]
          .filter(([, md]) => md.includes(q))
          .map(([p, md]) => ({ path: p, title: p, snippet: md.slice(0, 60) }))
      },
      async get(p: string): Promise<string> {
        const found = kb.get(p)
        if (found === undefined) throw new Error(`fake-platform：kb 条目不存在 ${p}`)
        return found
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        const threshold = cursor === null ? 0 : Number.parseInt(cursor, 10)
        const base = Number.isNaN(threshold) ? 0 : threshold
        const items = activities.filter((a) => Number(a.id) > base).slice(0, pageSize)
        const nextCursor = items.length > 0 ? items[items.length - 1]?.id ?? null : null
        return { items, nextCursor }
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        mustIssue(a)
        mustIssue(b)
        const listA = links.get(a) ?? []
        listA.push({ other: b, type })
        links.set(a, listA)
        pushActivity(a, 'link-added')
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return [...(issues.values())].filter((i) => i.parent === id).map((i) => i.id)
      },
    },
    guards: {
      async install(_company: CompanySlug, _rules: GuardRule[]): Promise<void> {
        // fake 平台不强制 guard（迁移合法性第一道闸在 core flows；第二道闸平台侧 v0 免）
      },
      async uninstall(_company: CompanySlug): Promise<void> {
        // 同上（无面可卸）
      },
    },
  }
}

// ————————————————————————— fake executor adapter —————————————————————————

/** fake 适配器工作形态（收割四要件缺失面注入——测试断路/回滚链路用） */
export type FakeAdapterMode =
  | 'ok' // 全要件真（流 completed+非空+落 REPORT/summary）
  | 'empty_output' // 要件 2 缺：completed 但无非空 log 文本
  | 'incomplete' // 要件 1 缺：turn_end.completed=false
  | 'no_report' // 要件 3 缺：不落 REPORT/summary（闸门侧报）
  | 'stalled' // 静默工人（DEV-44 注入面）：流驻留永不收尾、零事件零产物——收割恒 streaming，单卡已派发等看门狗
  | 'external_error' // 外部服务错误（DEV-46 注入面）：产物照落（REPORT/summary/log 全真）、流照收尾，但 turn_end.completed=false + error/errorCode（GLM 外部限速 429 同型，studio-dev-78 实况）——四要件缺「终态 completed」，错误文本经 turn_end.error 进 GATE_FAIL note 断路面

/**
 * fake 适配器选项。
 * mode 支持函数形态（每次 launch 现取）：测试运行期切换形态——如「首誓僵死（stalled）→
 * STALL 咬合杀掉 → 重派完成（ok）」的崩溃注入剧本（DEV-44 红证）。
 */
export interface FakeAdapterOptions {
  mode?: FakeAdapterMode | (() => FakeAdapterMode)
  name?: string
  /**
   * launch 捕获钩子（测试断言注入面用）：收到 daemon 传入的 TaskBrief 原体——
   * env 通道下「子进程读 env」的回显替身（credentials 断言经此钩子取，不进流/日志，
   * 凭据红名单不破——fake 流文本永不含凭据值）。
   */
  onLaunch?: (task: TaskBrief) => void
  /**
   * kill 捕获钩子（DEV-44 测试断言面）：fake 无真进程（pid=0），kill 的可观测面只有
   * 本钩子——断言「整树杀」被调（handle 归属 + graceMs 与 killGraceMs 同链）。
   */
  onKill?: (h: Handle, graceMs: number) => void
}

interface FakeSession {
  events: StreamEvent[]
  consumed: boolean
  /**
   * stalled 形态的驻留放行器：kill() 调用即放行（模拟整树杀后流收尾——真适配器里
   * SIGKILL 后 read 返回 EOF，同构）。未驻留/未 kill = 永不收尾（静默工人本体）。
   */
  release?: () => void
}

const FAKE_CAPABILITIES: ExecutorCapabilities = {
  budget_cap: false,
  cancel_turn: false,
  session_resume: false,
  agents_md: 'native',
  cost_native: false,
}

/** fake REPORT 骨架（contract 必填节：结论/改动/验证——ReportSkeletonSchema 拟稿口径） */
export const FAKE_REPORT_MD = [
  '# REPORT · fake worker',
  '',
  '## 结论',
  'fake 适配器完成单据（demo 模式固定产出）。',
  '',
  '## 改动',
  '- 无真实改动（demo）',
  '',
  '## 验证',
  '- fake 流 turn_end.completed=true；闸门=REPORT 存在性模拟',
  '',
].join('\n')

/** fake summary.json sidecar（contract SummarySidecarSchema summary/v1） */
export const FAKE_SUMMARY_JSON = JSON.stringify(
  {
    schema: 'summary/v1',
    conclusion: 'fake 适配器完成单据（demo 模式固定产出）',
    changed_files: [],
  },
  null,
  2,
)

/**
 * 内存 fake adapter：launch 即「worker 已完成」——按 mode 落产物并备好一次性完成流。
 * stream 一会话只许消费一次（dsh 同款纪律）；resultStats 固定账目。stalled 形态例外：
 * 流驻留永不收尾（kill 放行收尾）——DEV-44 STALL 响置刀的静默工人注入面。
 */
export function createFakeAdapter(opts?: FakeAdapterOptions): ExecutorAdapter {
  const modeOpt = opts?.mode
  const modeOf: () => FakeAdapterMode = typeof modeOpt === 'function' ? modeOpt : () => modeOpt ?? 'ok'
  const name = opts?.name ?? 'fake'
  const onLaunch = opts?.onLaunch
  const onKill = opts?.onKill
  const sessions = new Map<string, FakeSession>()
  let sessionSeq = 0

  return {
    name,
    capabilities: { ...FAKE_CAPABILITIES },
    async detect(): Promise<DetectResult> {
      return { name, version: '0.0.0-fake', ok: true, gaps: [] }
    },
    async estimate(_task: TaskBrief): Promise<BudgetEstimate> {
      // 估算与固定 resultStats.cost 同额（0.01）：demo 账面自洽——态 B（无价目表）下
      // 预算闸以本值为预留/冲销依据（0 值预留在 core 折叠视图不可见，见 budget-gate 头注接缝）
      return { estimated: { usd: 0.01 }, confidence: 1 }
    },
    async launch(task: TaskBrief): Promise<Handle> {
      onLaunch?.(task) // 回显替身：真实 executor 在此把 credentials 透传进子进程 env（v1.4）
      sessionSeq += 1
      const sessionId = `${name}-${sessionSeq}`
      const mode = modeOf() // 每誓现取（函数形态=运行期切换——DEV-44 崩溃注入剧本）
      // worker 落产物（REPORT/summary 是 worker 侧产物，非闸门侧）；no_report/stalled
      // 形态=worker 没交报告（静默工人零产物）
      if (mode !== 'no_report' && mode !== 'stalled') {
        mkdirSync(task.workspace, { recursive: true })
        writeFileSync(path.join(task.workspace, 'REPORT.md'), FAKE_REPORT_MD, 'utf8')
        writeFileSync(path.join(task.workspace, 'summary.json'), FAKE_SUMMARY_JSON, 'utf8')
      }
      const events: StreamEvent[] = []
      if (mode === 'stalled') {
        // 静默工人（DEV-44）：零事件流（无 log/无 step/无 turn_end）——收割增量泵恒驻留
        sessions.set(sessionId, { events, consumed: false })
        return { executor: name, sessionId, pid: 0 }
      }
      if (mode !== 'empty_output') events.push({ type: 'log', text: `[${name}] 工作产出文本（非空输出——四要件之一）` })
      events.push({ type: 'step_start', step: 'work' })
      events.push({ type: 'step_end', step: 'work', usage: { input: 100, output: 50 } })
      events.push({
        type: 'turn_end',
        completed: mode !== 'incomplete' && mode !== 'external_error',
        usage: { input: 100, output: 50 },
        // DEV-46 外部服务错误注入：错误码走 contract errorCode 位（v1.5），原文走 error——
        // daemon 收割面折进 GATE_FAIL note（turn_end.error=…），断路签名仍按四要件形态计
        ...(mode === 'external_error'
          ? { error: '上游模型服务限速（HTTP 429 Too Many Requests——GLM 外部服务）', errorCode: 'EXTERNAL_RATE_LIMIT' }
          : {}),
      })
      sessions.set(sessionId, { events, consumed: false })
      return { executor: name, sessionId, pid: 0 }
    },
    async *stream(h: Handle): AsyncIterable<StreamEvent> {
      const session = sessions.get(h.sessionId)
      if (session === undefined) throw new Error(`fake-adapter：未知会话 ${h.sessionId}`)
      if (session.consumed) throw new Error(`fake-adapter：会话 ${h.sessionId} 流已消费（一单一命、一流一收）`)
      session.consumed = true
      if (session.events.length === 0) {
        // stalled 形态（DEV-44）：驻留等 kill 放行（真适配器同构——整树杀后流收尾 EOF）；
        // 未 kill=永不收尾（静默工人本体，看门狗判据面）。零事件=stalled 判形（恒零事件）。
        await new Promise<void>((resolve) => {
          session.release = resolve
        })
        return
      }
      for (const ev of session.events) yield ev
    },
    async resultStats(h: Handle): Promise<ResultStats> {
      const session = sessions.get(h.sessionId)
      if (session === undefined) throw new Error(`fake-adapter：未知会话 ${h.sessionId}`)
      const turnEnd = session.events.find((e): e is Extract<StreamEvent, { type: 'turn_end' }> => e.type === 'turn_end')
      return {
        cost: { usd: 0.01 },
        tokens: turnEnd?.usage ?? { input: 0, output: 0 },
        duration: 10,
        turns: 1,
      }
    },
    async kill(h: Handle, graceMs: number): Promise<void> {
      // fake 无进程可杀（pid=0）——可观测面=onKill 钩子 + 驻留流放行（stalled 会话）
      const session = sessions.get(h.sessionId)
      session?.release?.()
      onKill?.(h, graceMs)
    },
  }
}
