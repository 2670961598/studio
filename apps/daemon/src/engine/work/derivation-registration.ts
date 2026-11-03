/**
 * work/derivation-registration —— 派发时登记口（GAP-V2-04 S6；v2/07 §四规则 1）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」：每次派生必记父引用/后端形态/能力子集/凭据类别＋逻辑引用/时点；
 *     无登记的派生＝违规。派发＝父执行体产生一次外部 CLI 执行体，故必须在 spawn **之前**登记。
 *   - docs/17-§2 主循环七相位：派发前判定失败即不启动（EXEC-01 fail-closed）；
 *   - docs/17-§6 收割四要件：证据面收口——登记行是后续撤回回执的后代清单来源。
 *
 * 边界（诚实登记）：
 *   - 本口只登记「身份/后端/能力子集/时点」，不记 wkey 值；wkey 是 per-ticket local-mint
 *     例外（78-§7.4.1：不进静态 catalogue），生命周期归 worker-key.ts。
 *   - 失败＝派发失败（不 spawn），不静默降级为空操作；实现侧可以是内存网关或持久包装。
 */
import type { PortResult } from '@studio-next/contract'

/** 派发登记入参（结构类型；引擎不 import gateway 实现，测试可注入同形桩） */
export interface DispatchDerivationRegistration {
  /** 稳定 id：`<ticket>:att<N>:<executor>`（同 attempt 同 executor 只登记一次） */
  readonly derivationId: string
  readonly ticket: string
  /** 执行体注册名（如 dsh-mid） */
  readonly executor: string
  /** 后端形态：框架当前派发一律外部 CLI 子进程 */
  readonly backend: 'external-cli'
  /** preset/能力子集引用（不猜「继承了啥」） */
  readonly capabilitySubset: string
  /** 派生时点（ISO 带偏移；调用方给，引擎不另读时钟） */
  readonly derivedAt: string
}

/** 派发登记口（缺省不注入＝不登记；注入即 fail-closed） */
export interface DispatchDerivationRegistry {
  register(record: DispatchDerivationRegistration): PortResult<unknown>
}
