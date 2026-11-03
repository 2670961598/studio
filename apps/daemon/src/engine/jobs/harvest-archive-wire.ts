/**
 * harvest-archive-wire —— 收割两处归档写出面的装配入参（第 5 出口证据导出注入位）
 *
 * 依据（实现单引用）：
 *   - docs/v2/15 §4.4（SEC-SEC-04）：出站闸第 5 出口 evidence-export——收割 GATE_PASS 收账与
 *     相位 4 尾 P3 对账补收，在写出 company/reports 归档前对正文过闸（拒发档，fail-closed，
 *     不脱敏改写、不覆盖既有归档）；
 *   - docs/17-§2（主循环七相位：相位 4 收割尾 P3 对账步）；docs/17-§6（收割四要件：收账/
 *     对账是 GATE_PASS 后置步，四要件判定零改动）；
 *   - docs/04-§三（company/reports 落点命名，daemon 单点写）。
 *
 * 为什么独立一件（20-§十五.三「先拆再增」）：engine.ts 是 lineBaseline 件（1998），实测 1989
 * （余量 9<50）——第 5 出口接线不得以注释折行/删空行/压缩腾行。本件把两处**纯装配入参
 * 构造**（零引擎可变状态依赖）移出，engine.ts 只留调用行，净行数不增反降。
 *
 * 行为边界：与拆前 engine.ts 内联块逐字等价；guard 缺省不注入=面关（旧调用零行为变化）。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { EngineConfig } from '../tick/types.ts'
import type { JobOutputAccountInput } from './output-account.ts'
import { reconIssueRecord, runHarvestRecon, type HarvestReconDeps, type HarvestReconResult } from './harvest-recon.ts'

/** 证据导出闸签名（与 EngineConfig.evidenceExportGuard / 两 job 入参同形） */
type EvidenceExportGuard = (text: string) => string

/** engine makeEvent 的最小结构签名（emit 词表与 harvest-recon 的 emit 面一致） */
type HarvestMakeEvent = (
  name: 'REPORT_MISSING' | 'HARVEST_INCOMPLETE' | 'SENTINEL_MISSING' | 'HARVEST_INVALID',
  issue: IssueRecord,
  attempt: number,
  tickEvents: EventRecord[],
  extra: { note: string },
) => void

/** 收割成功收账入参（GATE_PASS 后置步；收账异常进 engine tick errors） */
export interface AccountOutputDepsArgs {
  ledger: Ledger
  ticket: TicketId
  reportPath: string
  summaryPath: string | undefined
  companyDir: string | undefined
  now: () => number
  errors: string[]
  guard: EvidenceExportGuard | undefined
}

/** 构造 accountJobOutput 入参（guard 缺省不注入=面关，旧调用零行为变化） */
export function accountOutputDeps(args: AccountOutputDepsArgs): JobOutputAccountInput {
  return {
    ledger: args.ledger,
    ticket: args.ticket,
    reportPath: args.reportPath,
    companyDir: args.companyDir,
    now: args.now,
    onProblem: (message) => args.errors.push(message),
    ...(args.summaryPath !== undefined ? { summaryPath: args.summaryPath } : {}),
    ...(args.guard !== undefined ? { guardEvidenceExport: args.guard } : {}),
  }
}

/** P3 对账补收入参（相位 4 尾；事件锚/欠账口由 engine 注入） */
export interface HarvestReconStepArgs {
  ledger: Ledger
  companyDir: string
  at: number
  config: EngineConfig
  tickEvents: EventRecord[]
  errors: string[]
  makeEvent: HarvestMakeEvent
}

/** 相位 4 尾 P3 对账步：构造入参并执行（guard 缺省=既有直拷，旧调用零行为变化） */
export function runHarvestReconStep(args: HarvestReconStepArgs): HarvestReconResult | undefined {
  const deps: HarvestReconDeps = {
    ledger: args.ledger,
    companyDir: args.companyDir,
    emit: (name, ticket, attempt, note) => {
      args.makeEvent(
        name,
        reconIssueRecord({ ticket, mirror: args.ledger.getTicketMirror(ticket), deptFallback: args.config.deptFallback, at: args.at }),
        attempt,
        args.tickEvents,
        { note },
      )
    },
    onProblem: (message) => args.errors.push(message),
    ...(args.config.evidenceExportGuard !== undefined ? { guardEvidenceExport: args.config.evidenceExportGuard } : {}),
  }
  return runHarvestRecon(deps)
}
