/**
 * engine/records/hooks —— 主循环相位钩子（把「该写哪条记录」收在本件，engine 只留一行调用）
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表）；docs/17-§6（收割四要件
 * 不改判据）；docs/v2/11 §0.4-4（重放零第二副作用）／§5.2（WORK-06 前置记录）。
 *
 * 拆件动机（20-§十五.三「先拆再增」）：engine.ts 行数基线只减不增——相位钩子的注释/循环/
 * 署名解析全收在此，engine 侧每处只剩一行调用；行为与内联体逐字等价（同一 wire 端口、同一
 * 三态结果，失败不打断拍）。
 */
import type { IssueRecord } from '@studio-next/contract'
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
