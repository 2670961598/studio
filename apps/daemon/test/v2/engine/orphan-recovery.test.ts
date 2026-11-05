/**
 * 838：809 stale 拒收后的孤票兜底 + boot 孤儿扫描（幂等/跳过/审计）。
 * 依据：838 票（809 部署窗口 #836 实测：旧 epoch 迟到完成拒收后 Taiga=已派发、inflight=0、
 * lane 无 holder、无自动重派路径）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import type { StateFlow } from '@studio-next/core'
import { createLaneRegistry } from '../../../src/engine/lanes/registry.ts'
import { harvestHostOf } from '../../../src/engine/runtime/hosts.ts'
import { orphanSweepDue, recoverDispatchedOrphans, recoverStaleTicket } from '../../../src/engine/recovery/orphan-recovery.ts'
import type { EngineRuntime } from '../../../src/engine/runtime/types.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, issueOf, tick } from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

describe('838 boot 孤儿扫描（真引擎+fake 平台）', () => {
  it('平台=已派发且无 inflight → 回退新单；重复扫描幂等（不双派/不双写）', async () => {
    const stack = await createWorkStack('orphan-boot')
    const ticket = await createTicket(stack, '孤票：平台已派发、daemon 无 inflight')
    await stack.platform.issues.transition(ticket, '已派发')
    const before = eventsNamed(stack.ledger, ticket, 'GATE_FAIL').length

    const first = await stack.engine.recoverOrphans()
    expect(first.recovered).toBe(1)
    expect(first.items[0]?.ticket).toBe(ticket)
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    const events = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(events.length).toBe(before + 1)
    expect(events.at(-1)?.event).toBe('GATE_FAIL')

    const second = await stack.engine.recoverOrphans()
    expect(second.recovered).toBe(0) // 状态已非已派发 → 幂等跳过
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL').length).toBe(before + 1)
  }, 60_000)

  it('新 epoch 已接管（inflight 在场）→ 跳过不重派', async () => {
    const stack = await createWorkStack('orphan-inflight')
    const ticket = await createTicket(stack, '在途单：有 inflight 不扫描回退')
    for (let i = 0; i < 4; i += 1) {
      const report = await tick(stack)
      if (report.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)) break
    }
    expect((await issueOf(stack, ticket)).state).toBe('已派发')
    const before = eventsNamed(stack.ledger, ticket, 'GATE_FAIL').length
    const result = await stack.engine.recoverOrphans()
    expect(result.recovered).toBe(0)
    expect(result.skippedInflight).toBeGreaterThanOrEqual(1)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL').length).toBe(before)
  }, 60_000)
})

describe('838 stale 拒收后的单票兜底（recoverStaleTicket）', () => {
  function mockRt(over: { issue: IssueRecord; laneHolder?: string; inflight?: Map<string, unknown> }) {
    const transitions: Array<{ ticket: string; to: string }> = []
    const events: Array<{ name: string; note: string }> = []
    let current = over.issue
    const platform = {
      issues: {
        get: async () => current,
        list: async () => [current],
        transition: async (ticket: string, to: string) => {
          transitions.push({ ticket, to })
          current = { ...current, state: to }
          return current
        },
      },
    }
    const lanes = createLaneRegistry(60_000)
    const staleEpoch = lanes.acquire('core', 'old-holder', 1)
    lanes.stop('core', 'old-holder', staleEpoch) // 停机闩：epoch 0→1
    if (over.laneHolder !== undefined) lanes.acquire('core', over.laneHolder, 2)
    const inflight = new Map<string, unknown>(over.inflight ?? [])
    const rt = {
      platform,
      lanes,
      inflight,
      flowOf: (): StateFlow => ({}) as StateFlow,
      transitionHostOf: () => ({
        platform,
        syncMirror: () => {},
        emit: (name: string, _issue: IssueRecord, _attempt: number, extra?: { note?: string }) => {
          events.push({ name, note: extra?.note ?? '' })
          return {} as EventRecord
        },
      }),
      ledger: { listWorkRecords: () => [{ attempt: 1 }] },
      makeEvent: () => {},
    } as unknown as EngineRuntime
    const errors: string[] = []
    return { rt, transitions, events, errors }
  }

  it('旧 epoch 孤票 → 回退新单（一次；重复/接管后幂等跳过）', async () => {
    const { rt, transitions, events, errors } = mockRt({ issue: { id: 't-1', state: '已派发', lane: 'core' } as IssueRecord })
    const first = await recoverStaleTicket(rt, 't-1', 1, 'core', [], errors)
    expect(first).toBe(true)
    expect(transitions).toEqual([{ ticket: 't-1', to: '新单' }])
    expect(events.some((e) => e.note.includes('lease-epoch-stale-recovery'))).toBe(true)
    // 重复调用（平台已新单）→ 幂等不再写
    expect(await recoverStaleTicket(rt, 't-1', 1, 'core', [], errors)).toBe(false)
    expect(transitions).toHaveLength(1)
  }, 30_000)

  it('新 epoch 已接管（inflight 在场）→ 跳过不写', async () => {
    const withInflight = mockRt({ issue: { id: 't-1', state: '已派发', lane: 'core' } as IssueRecord, inflight: new Map([['t-1', {}]]) })
    expect(await recoverStaleTicket(withInflight.rt, 't-1', 1, 'core', [], withInflight.errors)).toBe(false)
    expect(withInflight.transitions).toHaveLength(0)
  }, 30_000)

  it('838 缺口 A：lane 有他主 + inflight 空 + 平台=已派发 → 仍回退新单，审计标 lane-held-by-other', async () => {
    const withHolder = mockRt({ issue: { id: 't-1', state: '已派发', lane: 'core' } as IssueRecord, laneHolder: 'new-ticket' })
    expect(await recoverStaleTicket(withHolder.rt, 't-1', 1, 'core', [], withHolder.errors)).toBe(true)
    expect(withHolder.transitions).toEqual([{ ticket: 't-1', to: '新单' }])
    expect(withHolder.events.some((e) => e.note.includes('lease-epoch-stale-recovery;lane-held-by-other'))).toBe(true)
  }, 30_000)
})

/** 838 F1/F2 对抗面：hosts 删除顺序（新 epoch inflight 保留）+ 扫描失败不静默 */
describe('838 F1：hosts 先判 inflight 再删（新 epoch 接管不被旧完成误删）', () => {
  function hostsRt(opts: { inflight?: Array<[string, InflightLike]>; issueState?: string }) {
    const transitions: Array<{ ticket: string; to: string }> = []
    const audit: Array<{ name: string; note: string }> = []
    let issue: IssueRecord = { id: 't-1', state: opts.issueState ?? '已派发', lane: 'core' } as IssueRecord
    const platform = {
      issues: {
        get: async () => issue,
        list: async () => [issue],
        transition: async (ticket: string, to: string) => {
          transitions.push({ ticket, to })
          issue = { ...issue, state: to } as IssueRecord
          return issue
        },
      },
    }
    const lanes = createLaneRegistry(60_000)
    const oldEpoch = lanes.acquire('core', 't-1', 1)
    lanes.stop('core', 't-1', oldEpoch) // epoch 0→1（旧完成 stale）
    const inflight = new Map<string, InflightLike>(opts.inflight ?? [])
    const rt = {
      platform,
      lanes,
      mergeLeases: undefined,
      inflight,
      flowOf: (): StateFlow => ({}) as StateFlow,
      transitionHostOf: () => ({
        platform,
        syncMirror: () => {},
        emit: (name: string, _i: unknown, _a: number, extra?: { note?: string }) => {
          if (name === 'GATE_FAIL') audit.push({ name, note: extra?.note ?? '' })
          return {} as EventRecord
        },
      }),
      makeEvent: (name: string, _c: unknown, _a: number, _t: unknown, extra?: { note?: string }) => {
        audit.push({ name, note: extra?.note ?? '' })
      },
      ledger: { listWorkRecords: () => [{ attempt: 1 }] },
      harvestBatches: {},
      config: { harvestSliceMs: 1, defaultLane: 'core' },
      now: () => 0,
      registry: {},
    } as unknown as EngineRuntime
    const errors: string[] = []
    const host = harvestHostOf(rt, [], errors)
    return { host, transitions, audit, inflight, errors }
  }
  type InflightLike = { ticket: string; attempt: number; lane: string; workRecordId: string; laneEpoch?: number; mergeRun?: { leaseEpoch?: number } }
  const oldEntry: InflightLike = { ticket: 't-1', attempt: 1, lane: 'core', workRecordId: 'wr-old', laneEpoch: 0 }
  const newEntry: InflightLike = { ticket: 't-1', attempt: 2, lane: 'core', workRecordId: 'wr-new', laneEpoch: 1 }

  it('新 epoch inflight 在场 → 保留新 inflight、无平台回退、审计 stale-ignored-new-epoch', async () => {
    const h = hostsRt({ inflight: [['t-1', newEntry]] })
    await h.host.finalize(null as never, oldEntry as never)
    expect(h.inflight.get('t-1')?.workRecordId).toBe('wr-new') // 新 inflight 未被删
    expect(h.transitions).toHaveLength(0) // 不回退平台
    expect(h.audit.some((e) => e.name === 'ESCALATE' && e.note.includes('lease-epoch-stale-ignored-new-epoch'))).toBe(true)
    expect(h.audit.some((e) => e.name === 'GATE_FAIL')).toBe(false)
    expect(h.errors.some((e) => e.includes('保留新 inflight'))).toBe(true)
  }, 30_000)

  it('旧完成且无新 inflight → 删除旧 inflight、回退新单一次；同 entry 重复→幂等', async () => {
    const h = hostsRt({})
    h.inflight.set('t-1', oldEntry)
    await h.host.finalize(null as never, oldEntry as never)
    expect(h.transitions).toEqual([{ ticket: 't-1', to: '新单' }])
    expect(h.inflight.has('t-1')).toBe(false)
    // 同 entry 重复（幂等）：平台已新单，不二次回退
    await h.host.finalize(null as never, oldEntry as never)
    expect(h.transitions).toHaveLength(1)
  }, 30_000)
})

describe('838 F2：boot 扫描失败不静默', () => {
  it('platform.issues.list 抛错 → failed=1 + errors 明细（runServe 会打印）', async () => {
    const rt = {
      platform: {
        issues: {
          list: async () => {
            throw new Error('probe-platform-down')
          },
        },
      },
    } as unknown as EngineRuntime
    const result = await recoverDispatchedOrphans(rt)
    expect(result.failed).toBe(1)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('issues.list')
    expect(result.errors[0]).toContain('probe-platform-down')
  })
})

/** 838 缺口 A/B：多孤票 mock（boot/周期扫描共用） */
function multiRt(issues: IssueRecord[], opts: { laneHolder?: string } = {}) {
  const state = new Map(issues.map((i) => [i.id, { ...i }]))
  const transitions: Array<{ ticket: string; to: string }> = []
  const audit: Array<{ name: string; note: string }> = []
  const platform = {
    issues: {
      list: async () => [...state.values()],
      get: async (ticket: string) => state.get(ticket) as IssueRecord,
      transition: async (ticket: string, to: string) => {
        transitions.push({ ticket, to })
        const current = state.get(ticket) as IssueRecord
        state.set(ticket, { ...current, state: to })
        return state.get(ticket) as IssueRecord
      },
    },
  }
  const lanes = createLaneRegistry(60_000)
  if (opts.laneHolder !== undefined) lanes.acquire('core', opts.laneHolder, 1)
  const rt = {
    platform,
    lanes,
    inflight: new Map(),
    flowOf: (): StateFlow => ({}) as StateFlow,
    transitionHostOf: () => ({
      platform,
      syncMirror: () => {},
      emit: (name: string, _issue: IssueRecord, _attempt: number, extra?: { note?: string }) => {
        audit.push({ name, note: extra?.note ?? '' })
        return {} as EventRecord
      },
    }),
    ledger: { listWorkRecords: () => [{ attempt: 1 }] },
    config: { defaultLane: 'core' },
  } as unknown as EngineRuntime
  const errors: string[] = []
  return { rt, transitions, audit, errors }
}

describe('838 缺口 A/B：周期扫描/放宽门/限速/幂等', () => {
  it('boot 扫描：lane 他主 + inflight 空 → 放宽回退新单；note 标 lane-held-by-other', async () => {
    const { rt, transitions, audit, errors } = multiRt([{ id: 't-1', state: '已派发', lane: 'core' } as IssueRecord], { laneHolder: 'other-ticket' })
    const result = await recoverDispatchedOrphans(rt, { errors })
    expect(result.recovered).toBe(1)
    expect(result.skippedLaneBusy).toBe(0)
    expect(transitions).toEqual([{ ticket: 't-1', to: '新单' }])
    expect(audit.some((e) => e.note.includes('boot-orphan-recovery;lane-held-by-other'))).toBe(true)
  }, 30_000)

  it('boot 扫描：inflight 非空 → 不回退（即使 lane 他主）', async () => {
    const { rt, transitions } = multiRt([{ id: 't-1', state: '已派发', lane: 'core' } as IssueRecord], { laneHolder: 'other-ticket' })
    ;(rt.inflight as Map<string, unknown>).set('t-1', {})
    const result = await recoverDispatchedOrphans(rt, {})
    expect(result.recovered).toBe(0)
    expect(result.skippedInflight).toBe(1)
    expect(transitions).toHaveLength(0)
  }, 30_000)

  it('maxRecover 限速：3 孤票限 2 → 只回退 2；下一轮再回退剩余（幂等不重复）', async () => {
    const { rt, transitions, errors } = multiRt([
      { id: 't-1', state: '已派发', lane: 'core' } as IssueRecord,
      { id: 't-2', state: '已派发', lane: 'core' } as IssueRecord,
      { id: 't-3', state: '已派发', lane: 'core' } as IssueRecord,
    ])
    const first = await recoverDispatchedOrphans(rt, { maxRecover: 2, errors })
    expect(first.recovered).toBe(2)
    expect(transitions).toHaveLength(2)
    const second = await recoverDispatchedOrphans(rt, { maxRecover: 2, errors })
    expect(second.recovered).toBe(1)
    const third = await recoverDispatchedOrphans(rt, { maxRecover: 2, errors })
    expect(third.recovered).toBe(0) // 已全部回退=幂等
    expect(transitions).toHaveLength(3)
  }, 30_000)

  it('周期触发纯函数：每 60 拍到期；0/59/61 不到期；可注入 every', () => {
    expect(orphanSweepDue(0)).toBe(false)
    expect(orphanSweepDue(59)).toBe(false)
    expect(orphanSweepDue(60)).toBe(true)
    expect(orphanSweepDue(120)).toBe(true)
    expect(orphanSweepDue(61)).toBe(false)
    expect(orphanSweepDue(6, 3)).toBe(true)
    expect(orphanSweepDue(7, 3)).toBe(false)
  })
})
