/**
 * hr-gate/engine-seam —— 任职闸门在 engine 拍内的接缝薄壳（studio-dev-550）
 *
 * 存在理由：`engine.ts` 自 #556 拆件后只留装配面与两处顺序锚（298 行，不再承载相位体），
 * 因此「事实读取 → 拍内观测 → 台账留痕 → 执行位兜底」四段全落在本目录：接缝由
 * `runtime/create-runtime.ts` 单点装配进 EngineRuntime，相位体（tick/state-diff、
 * dispatch/execute、tick/run）各取一处**单行调用**，不把逻辑摊进主循环。
 *
 * 判据与事实面同源（不复制）：
 *   - 事实/归一/留痕＝`employment-gate.ts`（createEmploymentGate / recordEmploymentRefusal …）；
 *   - 判定＝core `employmentAllowsDispatch` → decide `HOLD_NOT_IN_SERVICE`（v2/02 §3.4）。
 *
 * 事件纪律：留痕走既有 `ESCALATE`（事件枚举冻结，docs/17-§3），note=`HR_GATE;REFUSED;...`，
 * 锚键 `hr.gate.anchor.<单号>` 以事实签名去重——同单同事实一次，防逐拍刷账。
 */
import type { EventRecord, IssueRecord, PersonRef, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { EmploymentGateSnapshot, EmploymentGateState } from '@studio-next/core'
import {
  createEmploymentGate,
  createEmploymentRefusalTally,
  employmentRefusalOf,
  recordEmploymentRefusal,
  type EmploymentRefusalTally,
  type HrGateMode,
  type HrGateTickReport,
} from './employment-gate.ts'

/** engine 侧接缝（createEngine 单点装配；每拍 beginTick 重置观测累加器） */
export interface EmploymentGateSeam {
  readonly mode: HrGateMode
  /** 决策位事实入参（`WorkCandidateHost.employmentOf` 直接引用） */
  readonly employmentOf: (personId: string | undefined) => EmploymentGateSnapshot
  /** 拍首重置（tick report 的 refused/samples 是**本拍**口径） */
  beginTick(): void
  /** 本拍一次拒出工：观测计数 + 台账留痕（返回 1=真落账，0=同事实已锚过） */
  noteRefusal(issue: IssueRecord, ticket: TicketId, attempt: number, tickEvents: EventRecord[], snapshot: EmploymentGateSnapshot | undefined): 0 | 1
  /** 执行位兜底（executeDispatch 进入预算/装配/launch 之前） */
  refusalOf(personId: string | undefined): string | undefined
  /** 本拍闸门观测（TickReport.phases.stateDiff.hrGate） */
  report(): HrGateTickReport
}

export function createEmploymentGateSeam(args: {
  people: () => readonly PersonRef[]
  mode?: HrGateMode
  ledger: Ledger
  /** engine.makeEvent（append + 本拍事件流收集）；接缝只调用不改语义 */
  emit: (name: 'ESCALATE', issue: IssueRecord, attempt: number, tickEvents: EventRecord[], extra: { note: string }) => EventRecord
}): EmploymentGateSeam {
  const gate = createEmploymentGate({ people: args.people, ...(args.mode !== undefined ? { mode: args.mode } : {}) })
  let tally: EmploymentRefusalTally = createEmploymentRefusalTally()
  return {
    mode: gate.mode,
    employmentOf: gate.snapshotOf,
    beginTick: (): void => {
      tally = createEmploymentRefusalTally()
    },
    noteRefusal: (issue, ticket, attempt, tickEvents, snapshot): 0 | 1 => {
      tally.observe(ticket, snapshot)
      const recorded = recordEmploymentRefusal({ ledger: args.ledger, emit: args.emit, issue, ticket, attempt, tickEvents, snapshot })
      return recorded ? 1 : 0
    },
    refusalOf: (personId) => employmentRefusalOf(gate, personId),
    report: () => tally.report(gate.mode),
  }
}

export type { EmploymentGateState }
export type { HrGateOptions } from './employment-gate.ts'
