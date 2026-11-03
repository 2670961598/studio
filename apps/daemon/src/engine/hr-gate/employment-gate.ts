/**
 * hr-gate/employment-gate —— 任职闸门事实面（daemon 生产链路的「出工前在岗校验」）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/v2/02 §三（任职生命周期状态机；六状态值集）＋§3.3-1（授权冻结即工作侧权门失效：
 *     暂停态下以原授权继续动作构成越权，网关默认拒绝）＋§3.4（**非在岗态不得发起出工**；
 *     「目标（未证）」的网关闸门即本件落点）；
 *   - docs/v2/11 §14.2（迁移边与触发者——任职事实只能由 REC-LIFE-02 依决定作出；
 *     本件只读事实，不写迁移、不冒充迁移生产者）；
 *   - docs/v2/14 PORT-HR（任职生命周期端口；「非在岗态发起出工」网关拒绝的目标态）；
 *   - docs/17-§2（主循环七相位：相位 3 派发即「发起出工」的机器面）＋§6（收割四要件：
 *     本件不改判据，只在派发前加**资格闸**）；
 *   - docs/v2/17 GAP-V2-06 / NEG-REC-02（代偿面＝REC-LIFE-02＋审计断言；本件把它收敛为
 *     真闸门：判定面在 core `decide`（HOLD_NOT_IN_SERVICE），事实面在本件，留痕进台账）。
 *
 * 边界（三条，缺一即越界）：
 *   1. **只读事实、零 IO、零时钟**：输入＝公司目录快照 people（daemon 热重载经 thunk 取
 *      活值），本件不读盘、不写台账、不迁移任职状态（迁移生产者仍是 REC-LIFE-02）；
 *   2. **不改契约面**：PersonRef.status 是既有可选字段（contract §ports/company.ts），
 *      六状态归一表落本件，不新增 schema 键、不改端口签名；
 *   3. **fail-closed 在事实面收口**：不可解析＝missing/conflict/unknown，一律交 core 判
 *      HOLD_NOT_IN_SERVICE；本件不放行、不猜测、不降级成「缺省在岗」。
 *
 * 事实源与归一（v0 → v2 六状态，冻结表见 EMPLOYMENT_STATE_BY_STATUS）：
 *   - 公司目录人事索引 `people[].status`（org-config people 段；真实公司 28/28 人携 status）；
 *   - 值集取 v2/02 §3.1（机器值 candidate/active/suspended/handover/settling/retired）＋
 *     v0 人事模板值 paused/retired（docs/52-§5.1 停/复/退分类维度）；
 *   - **只有 active（在岗）放行**；candidate/suspended/paused/handover/settling/retired 一律拒。
 *
 * 两种模式（模式只影响「status 键缺省」的处置，不改变任何显式非在岗拒绝）：
 *   - `strict`（生产：serve 装配恒注入）：status 缺失=任职事实缺失=**拒**（fail-closed）；
 *   - `compat`（引擎直连：v0 demo/旧测试面；serve 不注入）：status 缺失按 contract
 *     `PersonRef.status` 注释的「未携带时按 active 缺省语义消费」处理，其余判定与 strict 同。
 *     compat 不是生产放行口——生产装配的闸门恒为 strict（见 assembly/serve/runtime.ts）。
 */
import type { EventRecord, IssueRecord, PersonRef, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { EmploymentGateSnapshot, EmploymentGateState } from '@studio-next/core'

/** 规格锚（报告/审计断言引用；章节号随文档走，行号不锚） */
export const EMPLOYMENT_GATE_DOC_REFS = [
  'docs/v2/02 §三（任职生命周期状态机）',
  'docs/v2/02 §3.3-1（授权冻结即工作侧权门失效）',
  'docs/v2/02 §3.4（非在岗态不得发起出工）',
  'docs/v2/11 §14.2（任职迁移边与触发者）',
  'docs/v2/14 PORT-HR',
  'docs/17-§2（相位 3 派发）',
] as const

/**
 * 事实源标签（台账留痕用；`source=` 字段值）。公司目录人事索引是 v0 唯一可读任职事实，
 * 记录面（REC-LIFE-01/02）生产写口未开前不得冒充第二事实源。
 */
export const EMPLOYMENT_FACT_SOURCE = 'company-directory' as const

/** 六状态归一表（v2/02 §3.1 / v2/09 ENU-01 机器值；v0 paused=暂停的模板值） */
export const EMPLOYMENT_STATE_BY_STATUS: Readonly<Record<string, EmploymentGateState>> = {
  active: 'in-service',
  candidate: 'not-in-service',
  suspended: 'not-in-service',
  paused: 'not-in-service',
  handover: 'not-in-service',
  settling: 'not-in-service',
  retired: 'not-in-service',
}

/** 在岗值集（值集唯一主表 v2/09 ENU-01：只有 active 是「在岗」） */
export const IN_SERVICE_STATUS: readonly string[] = ['active']

/** 非在岗值集（六状态里除 active 外的五态＋v0 paused） */
export const NOT_IN_SERVICE_STATUS: readonly string[] = ['candidate', 'suspended', 'paused', 'handover', 'settling', 'retired']

/**
 * 闸门模式（见头注）：strict=生产（缺证即拒）；compat=v0 引擎直连面（缺证按 active 缺省）。
 * 不是「开关」——两种模式都拒一切显式非在岗/未知值/冲突/缺人。
 */
export type HrGateMode = 'strict' | 'compat'

/** 引擎注入面（EngineDeps.hrGate）；缺省=compat（serve 恒注入 strict） */
export interface HrGateOptions {
  readonly mode: HrGateMode
}

/** 任职闸门事实面（引擎拍内按派发对象取快照；thunk 读活值，热重载零重绑） */
export interface EmploymentGate {
  readonly mode: HrGateMode
  /** 派发对象 → 任职事实快照（纯函数；同输入同输出） */
  snapshotOf(personId: string | undefined): EmploymentGateSnapshot
}

/** 归一公开面（probe/审计脚本复用；未知值原样归 unknown，不猜测） */
export function normalizeEmploymentStatus(raw: string | undefined): EmploymentGateState {
  if (raw === undefined) return 'missing'
  const value = raw.trim().toLowerCase()
  if (value === '') return 'missing'
  return EMPLOYMENT_STATE_BY_STATUS[value] ?? 'unknown'
}

/**
 * 纯事实解析：people 快照 × 派发对象 × 模式 → 任职闸门快照。
 *
 * 判定序（每一步都是 fail-closed）：
 *   1. 派发对象未解析（assignee 空且无缺省人）→ missing；
 *   2. people 里查无该工号 → missing（**不得**回退 people[0]——错人比不派更坏）；
 *   3. 同工号多行且归一态不一致 → conflict（不一致即不可证在岗）；
 *   4. status 缺失：strict→missing；compat→in-service（contract 缺省语义，如实记 detail）；
 *   5. 已知值→按表；未知值→unknown（不猜测）。
 */
export function employmentSnapshotOf(
  people: readonly PersonRef[],
  personId: string | undefined,
  mode: HrGateMode,
): EmploymentGateSnapshot {
  if (personId === undefined || personId.trim() === '') {
    return { state: 'missing', source: EMPLOYMENT_FACT_SOURCE, detail: '派发对象未解析（assignee/缺省人均为空）' }
  }
  const rows = people.filter((p) => p.id === personId)
  if (rows.length === 0) {
    return { state: 'missing', personId, source: EMPLOYMENT_FACT_SOURCE, detail: `人事索引查无工号 ${personId}（任职事实缺失）` }
  }
  const states = rows.map((p) => normalizeEmploymentStatus(p.status))
  const distinct = [...new Set(states)]
  if (distinct.length > 1) {
    return {
      state: 'conflict',
      personId,
      source: EMPLOYMENT_FACT_SOURCE,
      detail: `人事索引同工号多行任职事实不一致：${rows.map((p) => p.status ?? '<absent>').join(' / ')}`,
    }
  }
  const state = distinct[0] as EmploymentGateState
  const status = rows[0]?.status?.trim()
  if (state === 'missing') {
    if (mode === 'strict') {
      return {
        state: 'missing',
        personId,
        source: EMPLOYMENT_FACT_SOURCE,
        detail: '人事索引未携带 status（strict：任职事实缺失=拒，fail-closed）',
      }
    }
    return {
      state: 'in-service',
      personId,
      source: EMPLOYMENT_FACT_SOURCE,
      detail: '人事索引未携带 status——compat 按 contract §PersonRef.status 的 active 缺省语义（生产装配为 strict）',
    }
  }
  return {
    state,
    personId,
    ...(status !== undefined && status !== '' ? { status } : {}),
    source: EMPLOYMENT_FACT_SOURCE,
    ...(state === 'unknown' ? { detail: `人事索引 status 值不可归一：${status ?? '<empty>'}` } : {}),
  }
}

/** 引擎装配：thunk 读活值（公司目录热重载整组替换 people 后零重绑） */
export function createEmploymentGate(opts: { people: () => readonly PersonRef[]; mode?: HrGateMode }): EmploymentGate {
  const mode: HrGateMode = opts.mode ?? 'compat'
  return {
    mode,
    snapshotOf: (personId) => employmentSnapshotOf(opts.people(), personId, mode),
  }
}

/**
 * 台账留痕 note（事件名走既有 ESCALATE——事件枚举冻结，不新增事件名，docs/17-§3）：
 * `HR_GATE;REFUSED;person=ENG-11;fact=not-in-service;status=paused;src=company-directory;doc=v2/02-§3.4`
 * 字段顺序固定、值做单行化（note 不进多行），供审计断言/grep 机械复核。
 */
export function employmentGateNoteOf(snapshot: EmploymentGateSnapshot): string {
  const field = (value: string | undefined): string => (value === undefined || value.trim() === '' ? '-' : value.trim().replace(/[\r\n;]+/g, '_'))
  return [
    'HR_GATE;REFUSED',
    `person=${field(snapshot.personId)}`,
    `fact=${snapshot.state}`,
    `status=${field(snapshot.status)}`,
    `src=${field(snapshot.source)}`,
    'doc=v2/02-§3.4',
  ].join(';')
}

// ————————————————————————— 拍内观测与台账留痕 —————————————————————————

/**
 * 一拍任职闸门观测（TickReport.phases.stateDiff.hrGate 面）：refused=本拍被拒出工数，
 * samples=事实样本（≤5 条，逐条完整留痕在台账 ESCALATE 锚；样本只是人读摘要）。
 */
export interface HrGateTickReport {
  mode: HrGateMode
  refused: number
  samples: readonly { ticket: TicketId; person: string; state: EmploymentGateState; status?: string }[]
}

/** 拍内累加器（engine tick 作用域一次；纯内存，不落 IO） */
export interface EmploymentRefusalTally {
  observe(ticket: TicketId, snapshot: EmploymentGateSnapshot | undefined): void
  report(mode: HrGateMode): HrGateTickReport
}

export function createEmploymentRefusalTally(): EmploymentRefusalTally {
  let refused = 0
  const samples: Array<{ ticket: TicketId; person: string; state: EmploymentGateState; status?: string }> = []
  return {
    observe(ticket, snapshot) {
      refused += 1
      if (samples.length >= 5) return
      samples.push({
        ticket,
        person: snapshot?.personId ?? '-',
        state: snapshot?.state ?? 'missing',
        ...(snapshot?.status !== undefined ? { status: snapshot.status } : {}),
      })
    },
    report: (mode) => ({ mode, refused, samples }),
  }
}

/** 台账留痕参数（engine 拍内装配；emit＝engine.makeEvent 的窄化签名） */
export interface EmploymentRefusalTraceArgs {
  ledger: Ledger
  /** 事件发射（engine.makeEvent：append + 本拍事件流收集） */
  emit: (name: 'ESCALATE', issue: IssueRecord, attempt: number, tickEvents: EventRecord[], extra: { note: string }) => EventRecord
  issue: IssueRecord
  ticket: TicketId
  attempt: number
  tickEvents: EventRecord[]
  snapshot: EmploymentGateSnapshot | undefined
}

/**
 * 台账留痕（事件名走**既有** ESCALATE——事件枚举冻结 docs/17-§3，不新增事件名）：
 * note=`HR_GATE;REFUSED;...`；锚键 `hr.gate.anchor.<单号>` 以事实签名
 * （person|state|status）去重——同单同事实只落一次，事实变化再落。返回是否真落账。
 */
export function recordEmploymentRefusal(args: EmploymentRefusalTraceArgs): boolean {
  const fact: EmploymentGateSnapshot = args.snapshot ?? { state: 'missing' }
  const signature = `${fact.personId ?? '-'}|${fact.state}|${fact.status ?? '-'}`
  const key = `hr.gate.anchor.${args.ticket}`
  if (args.ledger.kvGet(key) === signature) return false
  args.ledger.kvSet(key, signature)
  args.emit('ESCALATE', args.issue, args.attempt, args.tickEvents, { note: employmentGateNoteOf(fact) })
  return true
}

/**
 * 执行位兜底判据（executeDispatch 进入预算/装配/launch 之前）：返回拒绝说明或 undefined。
 * 决策位（core HOLD_NOT_IN_SERVICE）已拒，此处防「自动分配换人／新增调用面绕过」。
 */
export function employmentRefusalOf(gate: EmploymentGate, personId: string | undefined): string | undefined {
  const snapshot = gate.snapshotOf(personId)
  if (snapshot.state === 'in-service') return undefined
  return `${employmentGateNoteOf(snapshot)}——任职事实非在岗，拒出工（fail-closed）`
}
