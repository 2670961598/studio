/** task-106：主绑定执行器可配置（缺省 dsh 零漂移；primaryExecutor=kimi 放行/拒 dsh；非法值拒启）。 */
import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION_CHAIN, resolveDispatchTarget } from '@studio-next/adapters/bindcard'
import { EMPTY_SELECTION_CHAIN as EMPTY } from '@studio-next/adapters/bindcard'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { resolveDispatchSelection, type DispatchSelectionDeps } from '../../../src/engine/work/dispatch-selection.ts'

const BASE = ['db: /tmp/x/var/ledger.sqlite', 'platform: localfile', 'company: demo', 'rootDir: /tmp/x/var', 'jobs: false'].join('\n')

describe('task-106 primaryExecutor', () => {
  it('缺省零漂移：不配置=undefined；dsh 缺省链仍放行', () => {
    const cfg = parseDaemonConfig(BASE)
    expect(cfg.primaryExecutor).toBeUndefined()
    const resolved = resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor: 'dsh' })
    expect(resolved.kind === 'ok' ? resolved.value.chainId : '').toBe('default:primary')
    expect(resolved.kind === 'ok' ? resolved.value.note : '').toBe(
      '主绑定缺省链（v2/07 §一 默认＝DSH）：选择结果不是授权，权与禁配另判 v2/03/04',
    )
  })

  it('缺省 dsh 的 note 逐字不变（零漂移精确断言）', () => {
    const resolved = resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor: 'dsh' })
    expect(resolved.kind === 'ok' ? resolved.value.note : '').toBe(
      '主绑定缺省链（v2/07 §一 默认＝DSH）：选择结果不是授权，权与禁配另判 v2/03/04',
    )
  })

  it('primaryExecutor=kimi + 空链 + executor=kimi → 放行；请求 dsh → 仍拒 NEG-RUN-05', () => {
    const cfg = parseDaemonConfig(`${BASE}\nprimaryExecutor: kimi`)
    expect(cfg.primaryExecutor).toBe('kimi')
    const deps: DispatchSelectionDeps = { chain: EMPTY, personExecutors: {}, primaryExecutor: 'kimi' }
    const selected = resolveDispatchSelection({ deps, ticket: 'T-1', personId: 'AGENT-1', candidateName: 'kimi' })
    expect(selected.kind).toBe('selected')
    if (selected.kind === 'selected') {
      expect(selected.selection.executor).toBe('kimi')
      expect(selected.selection.chainId).toBe('default:primary')
      expect(selected.selection.note).toContain('primary=kimi')
      expect(selected.selection.note).not.toContain('默认＝DSH')
    }
    const rejected = resolveDispatchSelection({ deps, ticket: 'T-1', personId: 'AGENT-1', candidateName: 'dsh' })
    expect(rejected.kind).toBe('rejected')
    if (rejected.kind === 'rejected') expect(rejected.error.subcause).toBe('dispatch/selection-unregistered')
  })

  it('非法 primaryExecutor 拒启', () => {
    expect(() => parseDaemonConfig(`${BASE}\nprimaryExecutor: nope`)).toThrow(/ENU-88|primaryExecutor/)
    expect(() => parseDaemonConfig(`${BASE}\nprimaryExecutor: off`)).toThrow(/primaryExecutor/)
  })
})
