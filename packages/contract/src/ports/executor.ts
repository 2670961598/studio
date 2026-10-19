/**
 * Executor 端口 —— 执行体适配协议（docs/25-§3.1，依据 18-§一）
 * 实现归 packages/adapters（及未来任意新 CLI 适配）；核心零 if executor，只读能力声明。
 */
import type { Money, ResultStats, StreamEvent, TaskBrief } from './kernel.ts'

/** executor 家族（17-§6 四原语表；CLI 泳道首刀反馈补入 docs/25-§3.1） */
export type ExecutorFamily = 'dsh' | 'claude' | 'codex' | 'kimi'

export interface ExecutorCapabilities {
  budget_cap: boolean
  cancel_turn: boolean
  session_resume: boolean
  agents_md: 'native' | 'user_level' | 'append_system_prompt'
  cost_native: boolean
}

export interface DetectResult {
  name: string
  version: string
  ok: boolean
  /** 不达标项明报（如 claude<2.1.277 无原生 AGENTS.md）；绝不静默降级 */
  gaps: string[]
}

export interface Handle {
  readonly executor: string
  readonly sessionId: string
  pid: number
  /**
   * executor 侧会话 id（v1.5，2026-10-19 制作人批，端口级原则）：如 dsh 的 session-<uuid>——
   * launch 后由 stream() 从流首 session 事件捕获写入（捕获前无此键）。续跑（--session-id
   * 透传）与对账用；可选位：不支持捕获的 executor 不填，先填的家先受益（dsh 首个填写）。
   */
  executorSessionId?: string
}

export interface BudgetEstimate {
  estimated: Money
  confidence: number
}

export interface ExecutorAdapter {
  readonly name: string
  readonly capabilities: ExecutorCapabilities
  detect(): Promise<DetectResult>
  estimate(task: TaskBrief): Promise<BudgetEstimate>
  launch(task: TaskBrief): Promise<Handle>
  stream(h: Handle): AsyncIterable<StreamEvent>
  resultStats(h: Handle): Promise<ResultStats>
  kill(h: Handle, graceMs: number): Promise<void>
}

/** 注册表条目（agent.yaml 的类型面；实例归框架 config home） */
export interface ExecutorRegistration {
  name: string
  cmd: string[]
  capabilities: ExecutorCapabilities
  default?: boolean
}
