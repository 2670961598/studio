/**
 * 唤起源端口 —— 源注册表协议（docs/25-§3.4，依据 22 原文冻结）
 * 源只产意图，绝不直接驱动 worker；决策归状态机主循环。
 */
import type { CompanySlug, TicketId } from './kernel.js'

export interface InvokeIntent {
  kind: 'ticket' | 'mention' | 'schedule' | 'relay' | 'resume' | 'webhook'
  company: CompanySlug
  ticket?: TicketId
  payload?: unknown
  /** 来源源名 */
  source: string
  priority?: number
}

export interface InvokeSource {
  readonly name: string
  start(emit: (intent: InvokeIntent) => void): void
  stop(): void
}

export interface SourceManifest {
  name: string
  kind: InvokeIntent['kind']
  /** zod schema 引用（注册与灰度用；源的增删走进化管线） */
  configSchema: string
}
