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
import type { RecordWirePort } from './types.ts'

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
