/**
 * 809：lane/merge 租约 epoch 栅栏 + idempotent stop + 迟到完成拒收（前沿对比 skein epoch fence）。
 * 依据：809 票「旧 epoch 完成/写入/释放依赖一律拒收并落审计事件；重复 stop 幂等」。
 */
import { describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { createLaneRegistry, type EpochStore } from '../../../src/engine/lanes/registry.ts'
import { createMergeLeaseRegistry } from '../../../src/engine/merge/merge-lease.ts'
import { epochOfInflight, releaseTicketLane, releaseWithEpoch } from '../../../src/engine/lanes/release.ts'
import { executeStallResponse } from '../../../src/engine/watchdog/stall-response.ts'
import { harvestHostOf } from '../../../src/engine/runtime/hosts.ts'
import type { EngineRuntime } from '../../../src/engine/runtime/types.ts'
import type { Inflight } from '../../../src/engine/tick/types.ts'

function memoryStore(): EpochStore & { data: Map<string, number> } {
  const data = new Map<string, number>()
  return {
    data,
    read: (key) => data.get(key),
    write: (key, epoch) => {
      data.set(key, epoch)
    },
  }
}

describe('809 lane 租约 epoch', () => {
  it('acquire→stop 携带 epoch 成功并递增；旧 epoch/乱序释放 stale；重复 stop 幂等不二次递增', () => {
    const store = memoryStore()
    const lanes = createLaneRegistry(60_000, store)
    const epoch0 = lanes.acquire('dev', 't-1', 1_000)
    expect(epoch0).toBe(0)
    expect(lanes.state('dev')).toMatchObject({ lane: 'dev', holder: 't-1', epoch: 0 })
    // 旧 epoch（-1/未来序）拒收
    expect(lanes.release('dev', 't-1', epoch0 + 1)).toMatchObject({ ok: false, reason: 'stale-epoch', currentEpoch: 0 })
    expect(lanes.state('dev').holder).toBe('t-1') // 未释放
    // 正确 epoch → 释放并递增
    const released = lanes.release('dev', 't-1', epoch0)
    expect(released).toMatchObject({ ok: true, reason: 'released', currentEpoch: 1 })
    expect(lanes.state('dev').holder).toBeNull()
    // 重复 stop 幂等：不二次递增
    const again = lanes.stop('dev', 't-1', epoch0)
    expect(again).toMatchObject({ ok: false, reason: 'idempotent', currentEpoch: 1 })
    expect(lanes.epochOf('dev')).toBe(1)
    // 新 epoch 重新占道：旧 epoch 的释放仍拒收（迟到完成面）
    const epoch1 = lanes.acquire('dev', 't-2', 2_000)
    expect(epoch1).toBe(1)
    expect(lanes.release('dev', 't-2', epoch0)).toMatchObject({ ok: false, reason: 'stale-epoch', currentEpoch: 1 })
    expect(lanes.isCurrent('dev', epoch1)).toBe(true)
    // 持久化：epoch 写入 daemon_kv 形态 key（store 注入）
    expect(store.data.get('lane:dev')).toBe(1) // 成功 release 后 1；acquire/旧 epoch 拒收不再增
  })
  it('epoch 持久化可跨实例恢复（进程重启续号）', () => {
    const store = memoryStore()
    const a = createLaneRegistry(60_000, store)
    a.acquire('dev', 't-1', 1)
    a.release('dev', 't-1', 0)
    // 新实例（模拟重启）：从 store 读到 epoch=1
    const b = createLaneRegistry(60_000, store)
    expect(b.epochOf('dev')).toBe(1)
    const epoch = b.acquire('dev', 't-2', 2)
    expect(epoch).toBe(1)
    expect(b.release('dev', 't-2', 0)).toMatchObject({ ok: false, reason: 'stale-epoch' })
  })
})

describe('809 merge 租约 epoch', () => {
  it('acquire/stop 递增；旧 epoch renew/release 拒收；重复 stop 幂等', () => {
    const store = memoryStore()
    const merge = createMergeLeaseRegistry(60_000, store)
    expect(merge.acquire('co:dev', 't-1', 1_000)).toBe(true)
    const epoch0 = merge.epochOf('co:dev')
    expect(epoch0).toBe(0)
    expect(merge.renew('co:dev', 't-1', 2_000, epoch0 + 1)).toBe(false) // 旧/未来 epoch 不续命
    expect(merge.renew('co:dev', 't-1', 2_000, epoch0)).toBe(true)
    expect(merge.release('co:dev', 't-1', epoch0)).toMatchObject({ ok: true, reason: 'released', currentEpoch: 1 })
    expect(merge.stop('co:dev', 't-1', epoch0)).toMatchObject({ ok: false, reason: 'idempotent', currentEpoch: 1 })
    expect(merge.acquire('co:dev', 't-2', 3_000)).toBe(true)
    expect(merge.epochOf('co:dev')).toBe(1)
    expect(merge.release('co:dev', 't-2', 0)).toMatchObject({ ok: false, reason: 'stale-epoch' })
    expect(store.data.get('merge:co:dev')).toBe(1)
  })
})

describe('809 迟到完成拒收（harvestHostOf 栅栏）', () => {
  const tickEvents: EventRecord[] = []
  function hostFor(lanes: ReturnType<typeof createLaneRegistry>, mergeLeases: ReturnType<typeof createMergeLeaseRegistry>, inflight: Map<string, Inflight>) {
    const events: Array<{ name: string; note: string }> = []
    const rt = {
      inflight,
      lanes,
      mergeLeases,
      harvestBatches: {},
      config: { harvestSliceMs: 1 },
      now: () => 0,
      registry: {},
      makeEvent: (name: string, _carrier: unknown, _attempt: number, _tickEvents: EventRecord[], extra?: { note?: string }) => {
        events.push({ name, note: extra?.note ?? '' })
      },
    } as unknown as EngineRuntime
    const errors: string[] = []
    const host = harvestHostOf(rt, tickEvents, errors)
    return { host, events, errors, rt }
  }
  function entry(over: Partial<Inflight>): Inflight {
    return { ticket: 't-1', attempt: 1, lane: 'dev', workRecordId: 'wr-1', ...over } as Inflight
  }

  it('stop 后旧 lane epoch 的完成 → 拒收（failed）、ESCALATE 审计、不写台账、inflight 清、epoch 不二次递增', async () => {
    const lanes = createLaneRegistry(60_000)
    const oldEpoch = lanes.acquire('dev', 't-1', 1_000)
    lanes.stop('dev', 't-1', oldEpoch) // 停机闩：epoch 0→1，旧完成失效
    const inflight = new Map<string, Inflight>()
    inflight.set('t-1', entry({ laneEpoch: oldEpoch }))
    const { host, events, errors } = hostFor(lanes, createMergeLeaseRegistry(60_000), inflight)
    const outcome = await host.finalize(null as never, entry({ laneEpoch: oldEpoch }))
    expect(outcome).toBe('failed')
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('ESCALATE')
    expect(events[0]?.note).toContain('lease-epoch-stale;lane=dev')
    expect(errors.some((e) => e.includes('迟到完成拒收'))).toBe(true)
    expect(inflight.has('t-1')).toBe(false)
    expect(lanes.epochOf('dev')).toBe(1) // 未被迟到释放再次推进
  })
  it('新 epoch 正常：stale 检测通过（不触发审计）', async () => {
    const lanes = createLaneRegistry(60_000)
    const oldEpoch = lanes.acquire('dev', 't-1', 1_000)
    lanes.stop('dev', 't-1', oldEpoch)
    const newEpoch = lanes.acquire('dev', 't-1', 2_000)
    expect(newEpoch).toBe(1)
    // 直接验证栅栏判定面：isCurrent=true（host.finalize 会进入真 finalize，此处只锁定栅栏）
    expect(lanes.isCurrent('dev', newEpoch)).toBe(true)
    expect(lanes.isCurrent('dev', oldEpoch)).toBe(false)
  })
  it('merge 旧 epoch 完成 → 拒收并审计（lease-epoch-stale;merge=…）', async () => {
    const mergeLeases = createMergeLeaseRegistry(60_000)
    mergeLeases.acquire('co:dev', 't-1', 1_000)
    const oldEpoch = mergeLeases.epochOf('co:dev')
    mergeLeases.stop('co:dev', 't-1', oldEpoch)
    const inflight = new Map<string, Inflight>()
    const e = entry({ mergeRun: { leaseKey: 'co:dev', leaseEpoch: oldEpoch, deps: {} as never, targetBranch: 'dev', reviewTip: 'x', receiptPath: '/tmp/r', causationId: 'c', executorSessionId: 's' } })
    inflight.set('t-1', e)
    const { host, events } = hostFor(createLaneRegistry(60_000), mergeLeases, inflight)
    const outcome = await host.finalize(null as never, e)
    expect(outcome).toBe('failed')
    expect(events[0]?.note).toContain('lease-epoch-stale;merge=co:dev')
  })
})


describe('812 守卫件：epoch 释放统一规则', () => {
  it('无 epoch=skipped+errors（禁止无 epoch 释放，不猜）', () => {
    const lanes = createLaneRegistry(60_000)
    lanes.acquire('dev', 't-1', 1_000)
    const errors: string[] = []
    const r = releaseWithEpoch(lanes, { lane: 'dev', ticket: 't-1', epoch: undefined }, errors)
    expect(r).toMatchObject({ ok: false, reason: 'idempotent', epoch: -1 })
    expect(lanes.state('dev').holder).toBe('t-1') // 未释放
    expect(errors.some((e) => e.includes('无 epoch'))).toBe(true)
  })
  it('inflight epoch 优先；无 inflight 仅 holder===ticket 用 state.epoch；他单持有跳过', () => {
    const lanes = createLaneRegistry(60_000)
    const oldEpoch = lanes.acquire('dev', 't-1', 1_000)
    const inflight = new Map<string, { laneEpoch?: number }>([['t-1', { laneEpoch: oldEpoch }]])
    expect(epochOfInflight(inflight as never, 't-1')).toBe(oldEpoch)
    // 新 attempt 在途：skipIfInflight=true 不释放
    const errors: string[] = []
    expect(releaseTicketLane(lanes, inflight as never, 't-1', 'dev', errors, { skipIfInflight: true })).toBeUndefined()
    expect(lanes.state('dev').holder).toBe('t-1')
    expect(errors.some((e) => e.includes('inflight 在场'))).toBe(true)
    // 正常释放后 epoch+1；再占 epoch1；旧 epoch 释放 stale 且不误放
    expect(releaseTicketLane(lanes, new Map() as never, 't-1', 'dev')).toMatchObject({ ok: true, reason: 'released', currentEpoch: 1 })
    const newEpoch = lanes.acquire('dev', 't-2', 2_000)
    expect(newEpoch).toBe(1)
    expect(releaseWithEpoch(lanes, { lane: 'dev', ticket: 't-2', epoch: oldEpoch })).toMatchObject({ ok: false, reason: 'stale-epoch', currentEpoch: 1 })
    expect(lanes.state('dev').holder).toBe('t-2') // 新 holder 未被旧 epoch 误放
    expect(lanes.epochOf('dev')).toBe(1) // 旧 epoch 拒收不推进
  })
})

describe('812 stall-response A 面 stale 预检（kill 前拒收）', () => {
  function stallHost() {
    const lanes = createLaneRegistry(60_000)
    const oldEpoch = lanes.acquire('core', 't-1', 1_000)
    lanes.stop('core', 't-1', oldEpoch) // 外部 stop 推进 epoch 0→1（旧 inflight 仍在）
    const inflight = new Map<string, Record<string, unknown>>([
      ['t-1', { ticket: 't-1', lane: 'core', laneEpoch: oldEpoch, workRecordId: 'wr-1', executor: 'fake', attempt: 1, dispatchedAtSeq: 1 }],
    ])
    const events: Array<{ name: string; note: string }> = []
    const problems: string[] = []
    let ended = 0
    let transitioned = 0
    const host = {
      config: { killGraceMs: 10, stallAfterMs: 60_000, stallKillAfterAlarms: 1 },
      inflight,
      lanes,
      platform: { issues: { get: async () => ({ id: 't-1', state: '已派发', lane: 'core' }) } },
      flowOf: () => ({}),
      makeEvent: (name: string, _i: unknown, _a: number, _t: unknown, extra?: { note?: string }) => {
        events.push({ name, note: extra?.note ?? '' })
      },
      transitionHostOf: () => ({ platform: { issues: { transition: async () => ({ id: 't-1' }) } }, syncMirror: () => {}, emit: () => ({}) }),
      ledger: { endWorkRecord: () => { ended += 1 } },
      reportProblem: (m: string) => problems.push(m),
      strikeBreaker: async () => { transitioned += 1 },
      now: () => 2_000,
      currentSeq: () => 2,
      probeActivity: () => ({ lastActivityAt: undefined, detail: 'probe' }),
      effectiveStallAfterMs: () => 60_000,
      registry: { resolve: () => ({ kill: async () => {} }) },
    } as never
    const index = { attemptOf: () => 2, stallStrikesOf: () => 0 } as never
    const action = { type: 'stall_alarm', ticket: 't-1', silentMs: 60_001 } as never
    return { host, index, action, inflight, events, problems, lanes, oldEpoch, ended: () => ended, transitioned: () => transitioned }
  }
  it('stale：ESCALATE 审计、不 kill/不 endWorkRecord/不迁移、inflight 保留、返回 ok=false', async () => {
    const h = stallHost()
    const before = h.inflight.get('t-1')
    const result = await executeStallResponse(h.host, h.action, h.index, [])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('epoch 陈旧拒收')
    expect(h.events.some((e) => e.name === 'ESCALATE' && e.note.includes('lease-epoch-stale'))).toBe(true)
    expect(h.problems.some((p) => p.includes('STALL 响置拒收'))).toBe(true)
    expect(h.ended()).toBe(0) // 未 endWorkRecord
    expect(h.transitioned()).toBe(0) // 未断路/迁移
    expect(h.inflight.get('t-1')).toBe(before) // inflight 保留（新 epoch 在途）
    expect(h.lanes.epochOf('core')).toBe(1) // 未二次推进
  })
  it('正常面不回归：epoch 当前且复核新鲜 → 续租 STALL 事件（不误拒）', async () => {
    const h = stallHost()
    // 重新占道（当前 epoch=1），inflight 携 epoch1
    const currentEpoch = h.lanes.acquire('core', 't-1', 2_000)
    h.inflight.set('t-1', { ticket: 't-1', lane: 'core', laneEpoch: currentEpoch, workRecordId: 'wr-1', executor: 'fake', attempt: 1, dispatchedAtSeq: 1, handle: { sessionId: 's-1', pid: 1 } })
    ;(h.host as unknown as { probeActivity: () => unknown }).probeActivity = () => ({ lastActivityAt: 1_999, detail: 'probe', pidAlive: true })
    const result = await executeStallResponse(h.host, h.action, h.index, [])
    expect(result.ok).toBe(true)
    expect(h.events.some((e) => e.name === 'STALL' && e.note.includes('续租'))).toBe(true)
    expect(h.ended()).toBe(0) // 续租不杀不收口
  })
})
