/**
 * gate —— 收割四要件的闸门执行器端口（docs/17-§6 末：收割成功契约）
 *
 * 成功契约四要件（17-§6 冻结口径）：
 *   1. 终态事件 completed —— 由 engine 消费 adapter.stream() 的 turn_end.completed 判定；
 *   2. 输出非空          —— 由 engine 判定（存在非空 log 文本，dsh 口径近似，见 adapters/dsh.ts 头注）；
 *   3. REPORT 落盘       —— **本端口职责**（可注入）；
 *   4. 闸门 exit=0       —— **本端口职责**（可注入）。
 *
 * v0 默认实现 createDefaultGateRunner（**诚实标注：v0 占位**）：
 *   - REPORT 落盘 = 检查 briefPath 同目录约定文件 REPORT.md 存在（workspace 约定：
 *     <rootDir>/workspaces/<单号>/att<N>/REPORT.md）；
 *   - 闸门 exit=0 = **模拟**——不真跑冻结验收命令（验收命令的装载与执行归 v0.5 真单刀），
 *     reportExists ? 0 : 1；
 *   - summary.json sidecar 若存在则一并回报（engine 落 work_records.summary_ref），
 *     不存在不拦收（v0 拟稿：sidecar 必须性待批示——contract SummarySidecarSchema 已冻结形状）。
 *
 * TODO(v0.5 真单前)：真 gateRunner = 读任务书冻结验收命令 → 子进程执行 → 采集退出码与
 * 验收产物（REPORT 骨架校验走 contract validateReportDocument / validateSummarySidecar）。
 */
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

/** 闸门输入（engine 收割相位组装） */
export interface GateInput {
  ticket: string
  attempt: number
  workspace: string
  briefPath: string
}

/** 闸门结论：四要件中第 3/4 要件的事实回报（第 1/2 要件归 engine 流消费侧） */
export interface GateOutcome {
  /** 闸门退出码（0=过；非 0=验收红——GATE_FAIL 子因之一） */
  exitCode: number
  /** REPORT 是否落盘（要件 3） */
  reportExists: boolean
  /** REPORT 落点（存在时回填；engine 落 work_records.report_ref 与 GATE_PASS note） */
  reportPath: string
  /** summary.json sidecar 落点（存在时回填；不存在=undefined） */
  summaryPath?: string
  note?: string
}

/** 闸门执行器端口：v0 默认实现见 createDefaultGateRunner；真验收命令版归 v0.5 真单刀 */
export interface GateRunner {
  run(input: GateInput): Promise<GateOutcome>
}

/** briefPath 同目录的 REPORT/summary 约定文件名（workspace 约定，拟稿待批） */
export const REPORT_FILENAME = 'REPORT.md'
export const SUMMARY_FILENAME = 'summary.json'

/**
 * v0 占位闸门（诚实标注：不跑真验收命令）——
 * REPORT 落盘=同目录约定文件存在性检查；exit0=存在即模拟 0、缺失即 1。
 */
export function createDefaultGateRunner(): GateRunner {
  return {
    async run(input: GateInput): Promise<GateOutcome> {
      const reportPath = path.join(path.dirname(input.briefPath), REPORT_FILENAME)
      const summaryPath = path.join(path.dirname(input.briefPath), SUMMARY_FILENAME)
      const reportExists = existsSync(reportPath)
      return {
        exitCode: reportExists ? 0 : 1,
        reportExists,
        reportPath,
        ...(existsSync(summaryPath) ? { summaryPath } : {}),
        note: reportExists
          ? `v0 占位闸门：REPORT 存在即 exit0 模拟（真验收命令归 v0.5 真单刀）；size=${statSync(reportPath).size}`
          : 'v0 占位闸门：REPORT 未落盘（四要件第 3 条不满足）',
      }
    },
  }
}
