/**
 * dispatch-derivation.test.ts —— 派发前派生树撤回闸（GAP-V2-04 登记腿；NEG-SEC-08/NEG-RUN-05）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四（撤回父凭据时后代执行体/持有凭据同步失效；后代未全停不得记完成）与
 *     §三 EXEC-01（派发前置校验失败＝不启动，不静默降级）。
 *   - docs/v2/15 §六 SEC-REV-01/02（撤回网关整树强制＝目标；本单落登记网关＋派发闸消费腿）。
 *   - docs/v2/17 §4.1 NEG-SEC-08（撤回后子体仍可用＝判负）／NEG-RUN-05（未登记/已撤路径拒绝）。
 *
 * 被测面＝生产函数 `resolveWorkerDispatchSeatbelt`（engine.ts 派发前置同体）：注入 `derivationGuard`
 * 时先于档位/工位校验；未注入＝行为零变更。只注入同形桩（gateway 实现由 gateway 套件自证）。
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  resolveWorkerDispatchSeatbelt,
  type DispatchDerivationGuard,
} from '../../../src/engine/work/dispatch-seatbelt.ts'

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'sn532-dispatch-derivation-')))

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/** 同形桩：只把指定（单号,执行体）判为已撤 */
function guardRevoking(ticket: string, executor: string): DispatchDerivationGuard {
  return { isRevoked: (candidateTicket, candidateExecutor) => candidateTicket === ticket && candidateExecutor === executor }
}

function subcauseOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return (error as { subcause?: string }).subcause ?? ''
  }
  return ''
}

describe('派发前置·派生树撤回闸（撤回后后代不得再派发）', () => {
  it('命中已撤派生 ⇒ CONFIG_INVALID/dispatch-derivation-revoked（拒派，零 spawn）', () => {
    const subcause = subcauseOf(() =>
      resolveWorkerDispatchSeatbelt({ ticket: 'T-532', executor: 'claude', workspace, derivationGuard: guardRevoking('T-532', 'claude') }),
    )
    expect(subcause).toBe('dispatch/derivation-revoked')
    expect(() =>
      resolveWorkerDispatchSeatbelt({ ticket: 'T-532', executor: 'claude', workspace, derivationGuard: guardRevoking('T-532', 'claude') }),
    ).toThrow(/dispatch\/derivation-revoked/)
  })

  it('未命中撤回面 ⇒ 正常返回 read-only 计划（档位语义不变）', () => {
    const plan = resolveWorkerDispatchSeatbelt({
      ticket: 'T-532',
      executor: 'claude',
      workspace,
      derivationGuard: guardRevoking('T-OTHER', 'claude'),
    })
    expect([plan.ticket, plan.executor, plan.tier, plan.writeRoots]).toEqual(['T-532', 'claude', 'read-only', []])
  })

  it('未注入端口 ⇒ 行为零变更（与既有派发面同结果）', () => {
    const plan = resolveWorkerDispatchSeatbelt({ ticket: 'T-532', executor: 'dsh-mid', workspace })
    expect([plan.tier, plan.trail]).toEqual(['read-only', undefined])
    expect(subcauseOf(() => resolveWorkerDispatchSeatbelt({ ticket: 'T-532', executor: 'dsh-mid', workspace, derivationGuard: guardRevoking('T-532', 'dsh-mid') }))).toBe(
      'dispatch/derivation-revoked',
    )
  })
})
