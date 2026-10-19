/**
 * 唤起源端口 —— 源注册表协议（docs/25-§3.4，依据 22 原文冻结）
 * 源只产意图，绝不直接驱动 worker；决策归状态机主循环。
 *
 * kind='escalate'（docs/35-§3 岗位运作规格首刀，制作人 2026-10-19 批复）：SLA/升级计时器源产
 * ——payload 携单号+超时档；附原单上下文唤起（35-§4「升级唤起」）的引擎消费面归后续刀。
 */
import type { CompanySlug, TicketId } from './kernel.ts'

export interface InvokeIntent {
  kind: 'ticket' | 'mention' | 'schedule' | 'relay' | 'resume' | 'webhook' | 'escalate'
  company: CompanySlug
  ticket?: TicketId
  payload?: unknown
  /** 来源源名 */
  source: string
  priority?: number
  /** 去重键（v1.3）：无 ticket 的意图（如 mention）必填——主循环按 (source, kind, company, dedupKey) 幂等 */
  dedupKey?: string
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
