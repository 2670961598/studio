/**
 * 共享内核类型 —— 全端口共用（协议依据 docs/25-§二）
 * 纯类型文件：零运行时逻辑、零外部依赖；改动先改文档再改此文件（07 顺序铁律）。
 */

// —— 标识（string 别名，语义自文档化）——
export type CompanySlug = string
export type TicketId = string
export type PersonId = string
export type AttemptNo = number

// —— 计量 ——
export interface Money { usd: number }
export interface TokenCounts { input: number; output: number; cached?: number }
export type DurationMs = number

// —— executor 归一化结果（收割输入）——
export interface ResultStats {
  cost: Money
  tokens: TokenCounts
  duration: DurationMs
  turns: number
}

// —— executor 归一化流事件（各家 stdout 差异在适配器内消化）——
export type StreamEvent =
  | { type: 'step_start'; step: string }
  | { type: 'step_end'; step: string; usage?: TokenCounts }
  | {
      type: 'turn_end'
      completed: boolean
      usage?: TokenCounts
      error?: string
      /**
       * 机器可读错误码（v1.5，2026-10-19 制作人批，渐进兼容）：如 dsh 的 AUTH /
       * MISSING_CREDENTIAL——message 原文保留在 error；前缀拼接方案废除
       * （可选位：先填的家先受益，其余 executor 发现一个做一个）。
       * v1.7：值域冻结为 EXECUTOR_ERROR_CODES（词表三件套落位 schemas/errors.ts——
       * kernel 本文件守零运行时纪律；映射附表 docs/25 附录 A）
       */
      errorCode?: string
    }
  | { type: 'log'; text: string }

// —— 任务书（装配管线输出，executor 输入）——
export interface TaskBrief {
  ticket: TicketId
  attempt: AttemptNo
  briefPath: string
  workspace: string
  AGENTS_MD: { channel: 'native' | 'user_level' | 'append_system_prompt'; target: string }
  budgetCap?: Money
  resume?: { sessionId: string; summaryPath: string }
  /**
   * 短命按单凭据（v1.4；docs/25-§二 + 2026-10-18 制作人定调）。冻结语义：
   *   - 由 daemon 在 launch 前注入；适配器**无条件透传**进子进程 env（不校验不拆解）。
   *   - 适配器不得记录/打印其值（红名单）——不得进任何日志/事件/账面文本。
   *   - prompt / 任务书正文 / 档案**永不含**（凭据永不入提示词/档案/任务书）。
   */
  credentials?: Record<string, string>
}

// —— 两级错误分类（docs/17-§9 冻结枚举；处置语义归 core）——
export type ErrorCategory =
  | 'GATE_FAIL'
  | 'WORKER_DEAD'
  | 'QA_BACK'
  | 'STALL'
  | 'NO_LANE'
  | 'DISPATCH_FAIL'
  | 'MERGE_CONFLICT'
  | 'LLM_FAIL'
  | 'CONFIG_INVALID'
  | 'EVOLVE_REJECT'
  | 'EXTERNAL_REJECT'

export interface ClassifiedError {
  category: ErrorCategory
  subcause: string
  detail?: string
}
