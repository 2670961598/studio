/**
 * engine/records/hooks —— 主循环相位钩子（把「该写哪条记录」收在本件，engine 只留一行调用）
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表；刀B 段=相位 0 名册装载／
 * 相位 4 出工段／相位 7 对账读者）；docs/17-§6（收割四要件不改判据）；docs/v2/11 §0.4-4
 * （重放零第二副作用）／§5.2（WORK-06 前置记录）／§3.1（出工必引生效任命）。
 *
 * 拆件动机（20-§十五.三「先拆再增」）：engine.ts 行数基线只减不增——相位钩子的注释/循环/
 * 署名解析全收在此，engine 侧每处只剩一行调用；行为与内联体逐字等价（同一 wire 端口、同一
 * 三态结果，失败不打断拍）。
 */
import type { IssueRecord } from '@studio-next/contract'
import type { ProjectionReconciliation } from './projection.ts'
import type {
  RecordAccountabilityArgs,
  RecordChangeSegmentArgs,
  RecordExceptionArgs,
  RecordMemoryDisposalArgs,
  RecordReviewArgs,
  RecordSettlementArgs,
  RecordValueEvaluationArgs,
  RecordWirePort,
  RecordWriteResult,
} from './types.ts'
import type { HarvestChainFacts, StartChainFacts } from './work-chain.ts'

/** 相位 1 采集尾：本拍受活动影响的单 → REC-WORK-01（请求型；幂等由 recordId 恒定保证） */
export function recordTickIntake(args: {
  readonly records: RecordWirePort
  readonly issueById: ReadonlyMap<string, IssueRecord>
  readonly affected: readonly string[]
  readonly at: number
  /** 受理责任位置解析（具名工号；不得回落到 daemon/框架/系统——§0.2-1） */
  readonly actorOf: (issue: IssueRecord) => string
}): void {
  for (const ticket of args.affected) {
    const issue = args.issueById.get(ticket)
    if (issue === undefined) continue
    args.records.intake({ issue, at: args.at, actor: args.actorOf(issue), source: 'platform.activity' })
  }
}

/** 迁移执行缝（相位 3/4/6）：REC-WORK-06（决定型；边集/前置/规则依据/决定面四闸在 drafts.ts） */
export function recordTransition(args: {
  readonly records: RecordWirePort
  readonly ticket: string
  readonly attempt: number
  readonly fromState: string
  readonly toState: string
  readonly at: number
  readonly actor: string
}): void {
  args.records.transition({
    ticket: args.ticket,
    attempt: args.attempt,
    fromState: args.fromState,
    toState: args.toState,
    at: args.at,
    actor: args.actor,
  })
}

/** 刀D 相位 → 记录族映射（docs/17-§2 表同源；测试/观测面可读） */
export const PHASE_RECORD_FAMILIES = {
  'phase5.close': ['REC-MEM-03', 'REC-EVD-04', 'REC-WORK-12'],
  'phase6.recycle': ['REC-MEM-03', 'REC-EVD-04', 'REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01'],
  'phase6.breaker': ['REC-WORK-17', 'REC-ACC-01'],
  'config.change': ['REC-CHG-01'],
  'post-terminal.review': ['REC-REV-01'],
} as const

/** 三态结果袋（调用方只观测；refused/failed 不打断拍） */
export interface PhaseRecordResults {
  readonly written: number
  readonly deduped: number
  readonly refused: number
  readonly failed: number
  readonly results: readonly RecordWriteResult[]
}

/** 折叠结果（不抛错、不重试） */
function fold(results: readonly RecordWriteResult[]): PhaseRecordResults {
  return {
    written: results.filter((result) => result.ok && !result.deduped).length,
    deduped: results.filter((result) => result.ok && result.deduped).length,
    refused: results.filter((result) => !result.ok && result.code === 'record-prereq-missing').length,
    failed: results.filter((result) => !result.ok && result.code !== 'record-prereq-missing').length,
    results,
  }
}

/**
 * 相位 5 合并 / 相位 6 回收：结清前置＋结清（REC-MEM-03 → REC-EVD-04 → REC-WORK-12）。
 * 顺序写死：先分流凭证与价值评估，再结清——前置件本轮未成就拒写，不跨轮臆造。
 */
export function recordClosingPhase(args: {
  readonly records: RecordWirePort
  readonly memoryDisposals: readonly RecordMemoryDisposalArgs[]
  readonly valueEvaluations: readonly RecordValueEvaluationArgs[]
  readonly settlements: readonly RecordSettlementArgs[]
}): PhaseRecordResults {
  const results: RecordWriteResult[] = []
  for (const memory of args.memoryDisposals) results.push(args.records.memoryDisposal(memory))
  for (const value of args.valueEvaluations) results.push(args.records.valueEvaluation(value))
  for (const settlement of args.settlements) results.push(args.records.settlement(settlement))
  return fold(results)
}

/** 相位 6 回收 / 断路：异常升级链＋问责案例（REC-WORK-17 → REC-ACC-01） */
export function recordExceptionPhase(args: {
  readonly records: RecordWirePort
  readonly exceptions: readonly RecordExceptionArgs[]
  readonly accountabilities: readonly RecordAccountabilityArgs[]
}): PhaseRecordResults {
  const results: RecordWriteResult[] = []
  for (const exception of args.exceptions) results.push(args.records.exception(exception))
  for (const accountability of args.accountabilities) results.push(args.records.accountability(accountability))
  return fold(results)
}

/** 配置热更 / 变更决定位：REC-CHG-01 逐段（段序由 drafts 判，不可跳段/三门不合并） */
export function recordChangePhase(args: {
  readonly records: RecordWirePort
  readonly segments: readonly RecordChangeSegmentArgs[]
}): PhaseRecordResults {
  return fold(args.segments.map((segment) => args.records.changeSegment(segment)))
}

/** 终局后 / 周期复盘：REC-REV-01（EVD-04 代价账＋WORK-09 验收引用为前置） */
export function recordReviewPhase(args: {
  readonly records: RecordWirePort
  readonly reviews: readonly RecordReviewArgs[]
}): PhaseRecordResults {
  return fold(args.reviews.map((review) => args.records.review(review)))
}

/**
 * 相位 0 名册装载（启动装载／人事变更；刀B）：LIFE-05 → AUTH-01 授权链 → LIFE-01 任命。
 * 幂等（同 recordId 重放 deduped），单条拒写只计数+日志，不打断拍。
 */
export function recordRosterLoad(args: {
  readonly records: RecordWirePort
  readonly at: number
  readonly reason: 'boot' | 'hr-change'
}): readonly RecordWriteResult[] {
  return args.records.rosterLoad({ at: args.at, reason: args.reason })
}

/**
 * 相位 4 收割：出工段 REC-LIFE-04（前件＝生效任命/计划锁/授权结果/资格）→ 收割批次 REC-EVD-01
 * （segment_ref 只认已落库 LIFE-04）。两写面均 fail-closed：前件未落即拒，不臆造段/批次。
 */
export function recordHarvest(args: {
  readonly records: RecordWirePort
  readonly ticket: string
  readonly attempt: number
  readonly personId: string
  readonly at: number
  readonly terminal: 'completed' | 'error' | 'blocked' | 'aborted' | 'limit_exceeded'
  readonly workspace?: string
  readonly briefRef?: string
  readonly usage?: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
  readonly cost?: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
  readonly gaps?: readonly string[]
}): void {
  args.records.workSegment({
    ticket: args.ticket,
    attempt: args.attempt,
    personId: args.personId,
    at: args.at,
    ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
    ...(args.briefRef !== undefined ? { briefRef: args.briefRef } : {}),
  })
  args.records.harvest({
    ticket: args.ticket,
    attempt: args.attempt,
    at: args.at,
    actor: args.personId,
    terminal: args.terminal,
    gaps: args.gaps ?? [],
    usage: args.usage ?? [],
    cost: args.cost ?? [],
  })
}

/** 相位 3 派发：开工链（WORK-02→07→03→05→04）＋ M-05；事实缺省时回落到刀A 迁移缝（行为不缩水） */
export function recordStartChain(args: {
  readonly records: RecordWirePort
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  readonly fromState: string
  readonly toState: string
  readonly facts?: StartChainFacts | undefined
}): void {
  if (args.facts === undefined) {
    args.records.transition({
      ticket: args.ticket,
      attempt: args.attempt,
      fromState: args.fromState,
      toState: args.toState,
      at: args.at,
      actor: args.actor,
    })
    return
  }
  args.records.startChain({
    ticket: args.ticket,
    attempt: args.attempt,
    at: args.at,
    actor: args.actor,
    fromState: args.fromState,
    toState: args.toState,
    facts: args.facts,
  })
}

/** 相位 4 收割：B 面收割批次（LIFE-04→EVD-01）＋ C 面 EVD-03→WORK-08＋M-10；事实缺省回落刀A 迁移缝 */
export function recordHarvestChain(args: {
  readonly records: RecordWirePort
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  readonly personId: string
  readonly fromState: string
  readonly toState: string
  readonly terminal: 'completed' | 'error' | 'blocked' | 'aborted' | 'limit_exceeded'
  readonly workspace?: string
  readonly briefRef?: string
  readonly facts?: HarvestChainFacts | undefined
}): void {
  recordHarvest({
    records: args.records,
    ticket: args.ticket,
    attempt: args.attempt,
    personId: args.personId,
    at: args.at,
    terminal: args.terminal,
    ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
    ...(args.briefRef !== undefined ? { briefRef: args.briefRef } : {}),
  })
  if (args.facts === undefined) {
    args.records.transition({
      ticket: args.ticket,
      attempt: args.attempt,
      fromState: args.fromState,
      toState: args.toState,
      at: args.at,
      actor: args.actor,
    })
    return
  }
  args.records.harvestChain({
    ticket: args.ticket,
    attempt: args.attempt,
    at: args.at,
    actor: args.actor,
    fromState: args.fromState,
    toState: args.toState,
    facts: args.facts,
  })
}

/** 对账读者节流（每 N 拍一跑；与 harvestReconEveryTicks 同量级——观测面不追每拍） */
export const RECORDS_RECONCILE_EVERY_TICKS = 30

/** 对账窗口重叠量（1h）：窗口下界回退一段，避免「记录在窗内、其事件锚在窗前」的假 missing */
export const RECORDS_RECONCILE_OVERLAP_MS = 60 * 60 * 1000

/** 对账读者所需的 kv 面（daemon_kv；装配面注入 ledger） */
export interface RecordsReconcileKv {
  kvGet(key: string): string | null
  kvSet(key: string, value: string): void
}

/** 对账锚键（daemon_kv；不新增事件名——事件枚举冻结） */
export const RECORDS_RECONCILE_AT_KEY = 'records.recon.at'
export const RECORDS_RECONCILE_LAST_KEY = 'records.recon.last'

/**
 * 相位 7 落账尾·records↔events 对账读者（#559 验收项：对账读者接入生产对账循环）。
 * 节流：每 `everyTicks` 拍一跑；增量窗口＝上次对账时刻回退 1h；结论落 kv＋日志（只留痕，不写事件、
 * 不改决策）。差异非空不抛错（fail-safe）——欠账由观测面暴露，不静默吞。
 */
export function recordReconcileTick(args: {
  readonly records: RecordWirePort
  readonly kv: RecordsReconcileKv
  readonly seq: number
  readonly at: number
  readonly everyTicks?: number
  readonly log?: (line: string) => void
}): ProjectionReconciliation | undefined {
  const every = args.everyTicks ?? RECORDS_RECONCILE_EVERY_TICKS
  if (every <= 0 || args.seq % every !== 0) return undefined
  const lastRaw = args.kv.kvGet(RECORDS_RECONCILE_AT_KEY)
  const last = lastRaw !== null && lastRaw !== '' ? Number(lastRaw) : 0
  const since = Math.max(0, (Number.isFinite(last) ? last : 0) - RECORDS_RECONCILE_OVERLAP_MS)
  const reconciled = args.records.reconcile(since)
  args.kv.kvSet(RECORDS_RECONCILE_AT_KEY, String(args.at))
  args.kv.kvSet(
    RECORDS_RECONCILE_LAST_KEY,
    JSON.stringify({
      at: args.at,
      seq: args.seq,
      since,
      checked: reconciled.checked,
      settled: reconciled.settled,
      differences: reconciled.differences.length,
      sample: reconciled.differences.slice(0, 5),
    }),
  )
  args.log?.(
    `[records] 对账读者 tick#${args.seq}：checked=${reconciled.checked} differences=${reconciled.differences.length}` +
      (reconciled.settled ? '（对平）' : '（差异非空——见 daemon_kv records.recon.last）'),
  )
  return reconciled
}
