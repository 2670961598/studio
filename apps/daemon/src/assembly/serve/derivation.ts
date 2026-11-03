/**
 * serve/derivation —— daemon 组合根派生树面（GAP-V2-04 S6 收尾；任务书 §2-1/2/4/5）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」三规则与撤回四判据；
 *   - docs/v2/15 §六 SEC-REV-01/02（撤回三件套/整树网关）；
 *   - docs/v2/14 §1.2 PORT-AUTH.withdraw；docs/v2/11 §2.2 REC-AUTH-03、§六 REC-EVD-RVK；
 *   - docs/17-§2（主循环七相位：装配期建面、派发前判定）／§6（撤回完成以证据面收口）；
 *   - 202-P4 写者租约（store `openLedgerWriter`）：本件经 daemon 已持租约的 ledger 句柄写，
 *     **不另开库、不另建锁、不新增事实源**。
 *
 * 装配职责（失败＝启动 fail-closed，不静默关闸）：
 *   1. 建持久派生网关（store v17 账本重建：目录引用→登记→撤回位）；
 *   2. 把 `revocationPort()` 交给 EngineDeps.derivationGuard（派发 0 号闸）；
 *   3. 把持久 `register` 交给 EngineDeps.derivationRegistry（spawn 前登记）；
 *   4. 建 PORT-AUTH.withdraw 生产面（#528 AuthorityGate 判定→网关撤回→REC 行）；
 *   5. #528 授权链闸与写路径共用同一 `AuthorityGate` 实例（同一 grants 快照，不双源）。
 */
import { createHistFace, type Ledger } from '@studio-next/store'
import type { AuthorityGate } from '../../engine/tools/authority-gate.ts'
import { createAuthorityGate } from '../../engine/tools/authority-gate.ts'
import type { GrantLink } from '@studio-next/core'
import { createPersistentDerivation, type PersistentDerivationFace } from '../../engine/derivation/persistent-gateway.ts'
import { createWithdrawalFace, type WithdrawalFace } from '../../engine/derivation/withdrawal.ts'
import type { DispatchDerivationRegistry } from '../../engine/work/derivation-registration.ts'
import type { DispatchDerivationGuard } from '../../engine/work/dispatch-seatbelt.ts'

/** 组合根派生面（runtime 消费；`withdrawal` 是控制面/PORT-AUTH 的生产入口） */
export interface DerivationServeFace {
  /** #528 授权链闸（与 gated-platform 共用同一实例） */
  readonly authority: AuthorityGate
  /** 持久派生网关（撤回面/观测面） */
  readonly persistent: PersistentDerivationFace
  /** 派发 0 号闸（结构端口；注入 EngineDeps.derivationGuard） */
  readonly guard: DispatchDerivationGuard
  /** spawn 前登记口（注入 EngineDeps.derivationRegistry） */
  readonly registry: DispatchDerivationRegistry
  /** PORT-AUTH.withdraw＋控制面 ctl- 撤回入口＋REC 行写面 */
  readonly withdrawal: WithdrawalFace
  /** 启动重建摘要（证据锚：目录行/登记行/已撤凭据/已撤派生） */
  readonly rebuild: PersistentDerivationFace['rebuild']
}

export interface WireDerivationArgs {
  readonly ledger: Ledger
  readonly clock: () => number
  readonly company: string
  readonly log: (line: string) => void
  /** 授予链快照（#528 现状：授予记录生产者未建=空；测试/后续装配可注入） */
  readonly grants?: () => readonly GrantLink[]
  /** 授权证据落点（缺省 daemon 日志行；与 #528 wireGatedPlatform 同形） */
  readonly recordAuthorityEvidence?: (evidence: { mode: string; state: string; action: string; ticket: string; evidenceId: string; detail?: string }) => void
}

/**
 * 装配派生树面。任一步失败抛错（run.ts 不吞）——启动 fail-closed，绝不静默关闸。
 */
export function wireDerivation(args: WireDerivationArgs): DerivationServeFace {
  const grants = args.grants ?? ((): readonly GrantLink[] => [])
  const authority = createAuthorityGate({
    grants,
    now: args.clock,
    record:
      args.recordAuthorityEvidence ??
      ((evidence) => {
        args.log(
          `[authority] ${evidence.mode}/${evidence.state} action=${evidence.action} ticket=${evidence.ticket} evidence=${evidence.evidenceId}` +
            `${evidence.detail !== undefined ? ` detail=${evidence.detail}` : ''}`,
        )
      }),
  })

  const persistent = createPersistentDerivation({ ledger: args.ledger, clock: args.clock })
  const hist = createHistFace(args.ledger.db)
  const withdrawal = createWithdrawalFace({
    authority,
    gateway: persistent.gateway,
    catalog: persistent.gateway.catalog,
    revoke: persistent.revoke,
    hist,
    clock: args.clock,
    company: args.company,
    writtenBy: 'daemon:assembly/serve/derivation',
  })

  const registry: DispatchDerivationRegistry = {
    register(record) {
      return persistent.register({
        derivationId: record.derivationId,
        ticket: record.ticket,
        executor: record.executor,
        backend: record.backend,
        capabilitySubset: record.capabilitySubset,
        // 凭据继承默认无（v2/07 §四规则 3）；wkey 是 local-mint 例外、不进静态 catalogue
        // （78-§7.4.1），故此处不登记凭据引用，避免把 per-ticket 值面写进登记账。
        credentials: [],
        derivedAt: record.derivedAt,
      })
    },
  }

  args.log(
    `[serve] 派生树面已接：持久重建 catalog=${persistent.rebuild.catalogEntries} derivation=${persistent.rebuild.registeredDerivations} ` +
      `revokedCredential=${persistent.rebuild.revokedCredentials} revokedDerivation=${persistent.rebuild.revokedDerivations}；` +
      `派发 0 号闸＋spawn 前登记＋PORT-AUTH.withdraw 生产入口（GAP-V2-04 S6）`,
  )

  return {
    authority,
    persistent,
    guard: persistent.gateway.revocationPort(),
    registry,
    withdrawal,
    rebuild: persistent.rebuild,
  }
}

