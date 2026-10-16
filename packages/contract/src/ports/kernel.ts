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
  | { type: 'turn_end'; completed: boolean; usage?: TokenCounts }
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
