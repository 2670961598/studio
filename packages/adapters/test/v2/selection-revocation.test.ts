/**
 * selection-revocation.test.ts —— 执行器选择链接入派生树撤回端口（GAP-V2-04 传播面；NEG-SEC-08/NEG-RUN-05）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §一（执行器选择链：单据指定＞岗位绑定＞默认；选择不是授权）与 §四（撤回父凭据
 *     时后代执行体/持有凭据同步失效；后代未全停不得记完成）。
 *   - docs/v2/17 §4.1 NEG-RUN-05（无登记选择链直连非主绑定执行器＝拒）／NEG-SEC-08（撤回后子体
 *     仍可派发＝判负）。
 *   - docs/v2/15 §六 SEC-REV-02（撤回网关从按单 wkey 扩到整树＝目标；本单落登记网关与选择链
 *     端口消费腿，真实进程终止仍属执行面）。
 *
 * 断言：端口是**结构类型**（adapters 不跨包 import gateway）；未注入＝行为零变更；注入且命中
 * 撤回面时，连主绑定缺省链也不放行（撤回传播面优先于缺省）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, Result } from '@studio-next/contract'
import {
  EMPTY_SELECTION_CHAIN,
  registerSelection,
  resolveDispatchTarget,
  type DerivationRevocationPort,
} from '../../src/bindcard/index.ts'

function okOf<T>(result: Result<T, ClassifiedError>): T {
  if (result.kind !== 'ok') throw new Error(`期望 ok，实际 ${result.error.subcause}：${result.error.detail ?? ''}`)
  return result.value
}

function errOf<T>(result: Result<T, ClassifiedError>): ClassifiedError {
  if (result.kind !== 'err') throw new Error('期望 CONFIG_INVALID（err）——放行路径必须不存在')
  return result.error
}

/** 同形端口：只把指定（单号,执行体）判为已撤 */
function portRevoking(ticket: string, executor: string): DerivationRevocationPort {
  return { isRevoked: (candidateTicket, candidateExecutor) => candidateTicket === ticket && candidateExecutor === executor }
}

describe('选择链×派生树撤回端口（NEG-SEC-08 传播面）', () => {
  it('命中已撤派生：主绑定缺省链也拒（撤回优先于默认；NEG-RUN-05 同族）', () => {
    const error = errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'dsh' }, portRevoking('T-532', 'dsh')))
    expect(error.subcause).toBe('dispatch/selection-revoked')
    expect(error.detail ?? '').toContain('NEG-SEC-08')
    expect(error.detail ?? '').toContain('NEG-RUN-05')
  })

  it('非主绑定执行体同样先过撤回闸（不因缺登记链而换错误码）', () => {
    expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'claude' }, portRevoking('T-532', 'claude'))).subcause).toBe(
      'dispatch/selection-revoked',
    )
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-532',
        executor: 'claude',
        source: 'ticket',
        registeredBy: '制作人',
        reason: '异源复核',
      }),
    )
    expect(errOf(resolveDispatchTarget(chain, { ticket: 'T-532', executor: 'claude' }, portRevoking('T-532', 'claude'))).subcause).toBe(
      'dispatch/selection-revoked',
    )
  })

  it('未命中撤回面/未注入端口：行为零变更', () => {
    expect(okOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'dsh' }, portRevoking('T-OTHER', 'dsh'))).chainId).toBe(
      'default:primary',
    )
    expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'claude' }, portRevoking('T-OTHER', 'claude'))).subcause).toBe(
      'dispatch/selection-unregistered',
    )
    expect(okOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'dsh' })).chainId).toBe('default:primary')
    expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-532', executor: 'claude' })).subcause).toBe(
      'dispatch/selection-unregistered',
    )
  })

  it('端口仍非授权面：命中放行时 authorization 恒 not-granted-here（选择≠授权）', () => {
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-532',
        executor: 'claude',
        source: 'ticket',
        registeredBy: '制作人',
        reason: '异源复核',
      }),
    )
    const picked = okOf(resolveDispatchTarget(chain, { ticket: 'T-532', executor: 'claude' }, portRevoking('T-OTHER', 'claude')))
    expect(picked.authorization).toBe('not-granted-here')
    expect('granted' in picked).toBe(false)
  })
})
