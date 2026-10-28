/**
 * v0 退役件（MIG-06 删除）——唤起源端口协议；仍由 PORT-GATE 出口承载外部意图入口，
 * 本件并入 `gate.ts`（docs/v2/14 §二 PORT-GATE 行：吸收现状 invoke.ts/notifier.ts，
 * 两件并入后退役）。删除归 IMPL-06-09（DISP-04：调用方/替代/兼容期齐备后删）；
 * 在那之前本件**保持原样导出**以维持兼容期编译绿，禁止新增字段。
 *
 * 唤起源端口 —— 源注册表协议（docs/25-§3.4，依据 22 原文冻结）
 * 源只产意图，绝不直接驱动 worker；决策归状态机主循环。
 *
 * kind='escalate'（docs/35-§3 岗位运作规格首刀，制作人 2026-10-19 批复）：SLA/升级计时器源产
 * ——payload 携单号+超时档；附原单上下文唤起（35-§4「升级唤起」）的引擎消费面归后续刀。
 *
 * kind='data-change'（studio-dev-129 提案 C1，制作人 2026-10-22 全批·批示②；先例='escalate'
 * v1.4 同款路径）：数据变更类源产（129-§6.1 分类学①——首源=people-change 挂 hr-sync
 * peopleDiff 出口双写，源与 org-config 路由表归拆单 C）。payload={class:'people-change',
 * classifier,person,field?,prev?,next?,linked_ticket?}；dedupKey=变更指纹
 * `person+classifier+prev→next`（源侧设置，引擎消费面校验一致——129-§6.1 铁律2 幂等双层）。
 * 引擎消费面（联动单物化+路由指派）=拆单 A（studio-dev-166）。
 */
import type { CompanySlug, TicketId } from './kernel.ts'

export interface InvokeIntent {
  kind: 'ticket' | 'mention' | 'schedule' | 'relay' | 'resume' | 'webhook' | 'escalate' | 'data-change'
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
