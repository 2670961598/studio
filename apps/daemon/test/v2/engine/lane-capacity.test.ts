/**
 * lane-capacity —— 泳道容量域（LOCAL-329；docs/quality/lane-capacity.md）
 *
 * 背景：2026-11-24 事故——LOCAL-300（基准长跑）独占 core 泳道 1h+，6+ 单全部 HOLD_LANE_BUSY
 * （根因＝LaneRegistry 单持有者模型；#488 泳道容量域落单）。
 *
 * 验收口径（LOCAL-329 L1-L4；L4 配置面见 test/v2/assembly/lane-capacity-config）：
 *   L1 容量 1＝单持有者旧语义零回归（registry 纯件逐分支；引擎缺省部署次单仍 HOLD_LANE_BUSY、
 *      决策载荷不带多槽字段——字节不变）；
 *   L2 容量>1 并发：registry 两单共存/满员拒收/过期回收；引擎真栈同拍/跨拍两单同泳道都派发、
 *      第三单 HOLD_LANE_BUSY 携 holders/capacity 观测、槽位回收后补位；
 *   L3 epoch 逐租约：精确释放/旧 epoch 拒收/只续本租约/重启 epoch 恢复/stop 幂等。
 *
 * 用例纪律（V2 新套件）：真 SQLite 台账＋真引擎＋fake 外部端口（records fixtures/work-stack）；
 * registry 纯件只测契约语义（返回值/快照），不测实现细节。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createLaneRegistry, LANE_FULL, type EpochStore } from '../../../src/engine/lanes/registry.ts'
import { releaseTicketLane, releaseWithEpoch } from '../../../src/engine/lanes/release.ts'
import { renderHoldLaneBusy } from '../../../src/assembly/render/tick.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, issueOf, tick, type WorkTestStack } from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

/** 内存 EpochStore（重启恢复用：同 store 再建 registry） */
function memoryStore(): EpochStore & { dump(): Record<string, number> } {
  const kv = new Map<string, number>()
  return {
    read: (key) => kv.get(key),
    write: (key, epoch) => void kv.set(key, epoch),
    dump: () => Object.fromEntries(kv),
  }
}

const TTL = 1_000

describe('L1 容量 1＝单持有者旧语义（registry 纯件逐分支）', () => {
  it('缺省不配容量表：state 兼容面逐字节（holder/expiresAt/epoch）；holders 恒 0/1 条；capacity=1', () => {
    const lanes = createLaneRegistry(TTL)
    expect(lanes.state('core')).toEqual({ lane: 'core', holder: null, epoch: 0, holders: [], capacity: 1 })
    expect(lanes.acquire('core', 'T-1', 0)).toBe(0)
    expect(lanes.state('core')).toEqual({
      lane: 'core',
      holder: 'T-1',
      expiresAt: TTL,
      epoch: 0,
      holders: [{ ticket: 'T-1', expiresAt: TTL, epoch: 0 }],
      capacity: 1,
    })
    expect(lanes.release('core', 'T-1', 1)).toEqual({ ok: false, reason: 'stale-epoch', epoch: 1, currentEpoch: 0 })
    expect(lanes.release('core', 'T-1', 0)).toEqual({ ok: true, reason: 'released', epoch: 0, currentEpoch: 1 })
    expect(lanes.release('core', 'T-1', 0)).toEqual({ ok: false, reason: 'idempotent', epoch: 0, currentEpoch: 1 })
    expect(lanes.state('core')).toEqual({ lane: 'core', holder: null, epoch: 1, holders: [], capacity: 1 })
  })

  it('同单重占保 epoch（不 bump）；过期后他单可占（死主回收）；在持时他单占道拒收且不逐出（fail-closed）', () => {
    const lanes = createLaneRegistry(TTL)
    expect(lanes.acquire('core', 'T-1', 0)).toBe(0)
    expect(lanes.acquire('core', 'T-1', 500)).toBe(0)
    expect(lanes.state('core').expiresAt).toBe(1_500)
    // 旧实现＝静默覆盖他单；新＝拒收（-1）不改状态——引擎链路 decide 先闸，此面只防直连误用
    expect(lanes.acquire('core', 'T-2', 600)).toBe(LANE_FULL)
    expect(lanes.state('core').holder).toBe('T-1')
    // 过期即回收：T-2 占道得当前计数（空道不 bump）
    expect(lanes.acquire('core', 'T-2', 1_500)).toBe(0)
    expect(lanes.state('core').holders.map((h) => h.ticket)).toEqual(['T-2'])
  })

  it('isCurrent/renew 旧语义不变：在册=true、释放后=false；续租只认在册 ticket', () => {
    const lanes = createLaneRegistry(TTL)
    lanes.acquire('core', 'T-1', 0)
    expect(lanes.isCurrent('core', 0)).toBe(true)
    expect(lanes.renew('core', 'T-2', 100)).toBe(false)
    expect(lanes.renew('core', 'T-1', 200)).toBe(true)
    expect(lanes.state('core').expiresAt).toBe(1_200)
    lanes.release('core', 'T-1', 0)
    expect(lanes.isCurrent('core', 0)).toBe(false)
  })
})

describe('L2 容量>1：多槽并发（registry 纯件）', () => {
  it('容量 2：两单并发 acquire 成功且 epoch 两两不同；第三单满员拒收（-1）不改状态', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a = lanes.acquire('core', 'A', 0)
    const b = lanes.acquire('core', 'B', 0)
    expect(a).toBe(0)
    expect(b).toBe(1)
    expect(a).not.toBe(b)
    expect(lanes.state('core')).toEqual({
      lane: 'core',
      holder: 'A',
      expiresAt: TTL,
      epoch: 1,
      holders: [
        { ticket: 'A', expiresAt: TTL, epoch: 0 },
        { ticket: 'B', expiresAt: TTL, epoch: 1 },
      ],
      capacity: 2,
    })
    expect(lanes.acquire('core', 'C', 100)).toBe(LANE_FULL)
    expect(lanes.state('core').holders.map((h) => h.ticket)).toEqual(['A', 'B'])
    expect(lanes.epochOf('core')).toBe(1)
  })

  it('释放一单腾位 → 第三单占道（新 epoch＝释放 bump 再共存 bump）；未列泳道/他泳道仍容量 1（容量按泳道隔离）', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a = lanes.acquire('core', 'A', 0)
    lanes.acquire('core', 'B', 0)
    expect(lanes.release('core', 'A', a)).toEqual({ ok: true, reason: 'released', epoch: 0, currentEpoch: 2 })
    expect(lanes.acquire('core', 'C', 200)).toBe(3) // 释放→2，共存 bump→3（新 epoch > 一切已发）
    expect(lanes.state('core').holders.map((h) => [h.ticket, h.epoch])).toEqual([
      ['B', 1],
      ['C', 3],
    ])
    // 未配置泳道＝容量 1
    expect(lanes.acquire('qa', 'Q1', 0)).toBe(0)
    expect(lanes.acquire('qa', 'Q2', 0)).toBe(LANE_FULL)
    expect(lanes.state('qa').capacity).toBe(1)
  })

  it('过期回收：过期租约不占容量（满员道在租约过期后可再占，占道即清死主；在册活租约保原 epoch）', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    lanes.acquire('core', 'A', 0) // 到期 1000
    lanes.acquire('core', 'B', 0) // 到期 1000；共存 bump → 计数 1
    expect(lanes.acquire('core', 'C', 500)).toBe(LANE_FULL) // 仍满员（A/B 活跃）
    // 全过期：占道即清 → 空道沿用当前计数 1
    expect(lanes.acquire('core', 'D', 1_500)).toBe(1)
    expect(lanes.state('core').holders.map((h) => [h.ticket, h.epoch])).toEqual([['D', 1]]) // 死主 A/B 不再可见
    // 与 D 共存（D 到期 2500 仍活）：bump → 2
    expect(lanes.acquire('core', 'E', 2_000)).toBe(2)
    // 部分过期：D 到期、E（到期 3000）仍活 → 只腾一位；E 保原 epoch 不受扰
    expect(lanes.acquire('core', 'F', 2_600)).toBe(3)
    expect(lanes.state('core').holders.map((h) => [h.ticket, h.epoch])).toEqual([
      ['E', 2],
      ['F', 3],
    ])
  })

  it('同单重占原位刷新保 epoch，不触及他单租约（execute 二次 acquire 面）', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    lanes.acquire('core', 'A', 0)
    lanes.acquire('core', 'B', 0)
    expect(lanes.acquire('core', 'A', 300)).toBe(0)
    expect(lanes.state('core').holders).toEqual([
      { ticket: 'A', expiresAt: 1_300, epoch: 0 },
      { ticket: 'B', expiresAt: TTL, epoch: 1 },
    ])
  })
})

describe('L3 epoch 栅栏逐租约（registry 纯件）', () => {
  it('精确释放：带 B 的 epoch 释放 A 被拒（stale）；各用各的 epoch 才放，不误放邻槽', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a = lanes.acquire('core', 'A', 0)
    const b = lanes.acquire('core', 'B', 0)
    expect(lanes.release('core', 'A', b)).toEqual({ ok: false, reason: 'stale-epoch', epoch: b, currentEpoch: 1 })
    expect(lanes.state('core').holders.map((h) => h.ticket)).toEqual(['A', 'B'])
    expect(lanes.release('core', 'A', a)).toEqual({ ok: true, reason: 'released', epoch: a, currentEpoch: 2 })
    expect(lanes.state('core').holders.map((h) => h.ticket)).toEqual(['B'])
    expect(releaseWithEpoch(lanes, { lane: 'core', ticket: 'B', epoch: b })).toEqual({ ok: true, reason: 'released', epoch: b, currentEpoch: 3 })
    expect(lanes.state('core').holders).toEqual([])
  })

  it('旧 epoch 拒收：重占得新 epoch 后，迟到完成携旧 epoch 的 release/stop 不误放新租约', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a0 = lanes.acquire('core', 'A', 0)
    lanes.release('core', 'A', a0)
    const a1 = lanes.acquire('core', 'A', 100) // 空道：沿用当前计数 1
    const b = lanes.acquire('core', 'B', 100) // 共存：bump
    expect(a1).toBe(1)
    expect(b).toBe(2)
    expect(lanes.release('core', 'A', a0)).toEqual({ ok: false, reason: 'stale-epoch', epoch: a0, currentEpoch: 2 })
    expect(lanes.stop('core', 'A', a0).reason).toBe('stale-epoch')
    expect(lanes.isCurrent('core', a0)).toBe(false)
    expect(lanes.isCurrent('core', a1)).toBe(true)
    expect(lanes.state('core').holders.map((h) => [h.ticket, h.epoch])).toEqual([
      ['A', 1],
      ['B', 2],
    ])
  })

  it('renew 只续本租约：他单到期时间不变；旧 epoch 续租拒收；不在册=false', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a = lanes.acquire('core', 'A', 0)
    const b = lanes.acquire('core', 'B', 0)
    expect(lanes.renew('core', 'A', 500, a)).toBe(true)
    expect(lanes.state('core').holders.map((h) => h.expiresAt)).toEqual([1_500, TTL])
    expect(lanes.renew('core', 'A', 600, b)).toBe(false) // 旧/他单 epoch
    expect(lanes.renew('core', 'ZZ', 600)).toBe(false)
    expect(lanes.state('core').holders.map((h) => h.expiresAt)).toEqual([1_500, TTL])
    expect(lanes.renew('core', 'B', 700)).toBe(true) // 无 epoch 续租=旧兼容面（holder 校验）
    expect(lanes.state('core').holders.map((h) => h.expiresAt)).toEqual([1_500, 1_700])
  })

  it('重启 epoch 恢复：EpochStore 持久化计数；重启后旧 epoch 释放拒收（进程重启不复活旧栅栏）', () => {
    const store = memoryStore()
    const before = createLaneRegistry(TTL, store, { core: 2 })
    before.acquire('core', 'A', 0) // e0
    const b = before.acquire('core', 'B', 0) // 共存 bump → e1
    expect(b).toBe(1)
    expect(before.release('core', 'B', b).currentEpoch).toBe(2)
    const c = before.acquire('core', 'C', 100) // 与 A 共存 bump → e3
    expect(c).toBe(3)
    expect(before.release('core', 'C', c).currentEpoch).toBe(4)
    expect(store.dump()).toEqual({ 'lane:core': 4 })
    // 重启：租约簿清空、计数从 kv 恢复
    const after = createLaneRegistry(TTL, store, { core: 2 })
    expect(after.state('core').holders).toEqual([])
    expect(after.epochOf('core')).toBe(4)
    expect(after.acquire('core', 'A', 0)).toBe(4) // 空道沿用恢复计数（重启前旧租约 e0 作废：不在册）
    expect(after.release('core', 'A', 0)).toEqual({ ok: false, reason: 'stale-epoch', epoch: 0, currentEpoch: 4 })
    expect(after.release('core', 'A', 4).reason).toBe('released')
  })

  it('stop 幂等：道空后重复 stop 只第一次生效、不二次递增；他单在册时旧 epoch=stale、当前 epoch=幂等零行为', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    const a0 = lanes.acquire('core', 'A', 0)
    expect(lanes.stop('core', 'A', a0)).toEqual({ ok: true, reason: 'released', epoch: 0, currentEpoch: 1 })
    expect(lanes.stop('core', 'A', a0)).toEqual({ ok: false, reason: 'idempotent', epoch: 0, currentEpoch: 1 }) // 不二次递增
    // 重占得新 epoch，与他单共存：旧 epoch 一律 stale（栅栏先于幂等——旧语义同序）
    const a1 = lanes.acquire('core', 'A', 100)
    const b = lanes.acquire('core', 'B', 100)
    expect([a1, b]).toEqual([1, 2])
    expect(lanes.stop('core', 'A', a0)).toEqual({ ok: false, reason: 'stale-epoch', epoch: 0, currentEpoch: 2 })
    expect(lanes.stop('core', 'A', b)).toEqual({ ok: false, reason: 'stale-epoch', epoch: 2, currentEpoch: 2 }) // 带 B 的 epoch 不放 A
    // A 已放、B 在册：携当前 epoch 再 stop A＝幂等零行为，不误放 B
    expect(lanes.stop('core', 'A', a1)).toEqual({ ok: true, reason: 'released', epoch: 1, currentEpoch: 3 })
    expect(lanes.stop('core', 'A', 3)).toEqual({ ok: false, reason: 'idempotent', epoch: 3, currentEpoch: 3 })
    expect(lanes.state('core').holders.map((h) => [h.ticket, h.epoch])).toEqual([['B', 2]])
  })

  it('releaseTicketLane 无 inflight 回退：按 ticket 取本单租约 epoch（多槽下不误用首持有者 epoch）', () => {
    const lanes = createLaneRegistry(TTL, undefined, { core: 2 })
    lanes.acquire('core', 'A', 0)
    lanes.acquire('core', 'B', 0)
    const inflight = new Map() as never
    expect(releaseTicketLane(lanes, inflight, 'B', 'core')).toEqual({ ok: true, reason: 'released', epoch: 1, currentEpoch: 2 })
    expect(lanes.state('core').holders.map((h) => h.ticket)).toEqual(['A']) // 首持有者 A 不受扰
    expect(releaseTicketLane(lanes, inflight, 'ZZ', 'core')).toBeUndefined() // 非持有者=跳过
  })
})

/** 引擎栈：人闸/在途/每拍全开（只测泳道容量闸），泳道 TTL 保持生产缺省 30min */
async function stackWithCapacity(label: string, laneCapacity?: Record<string, number>): Promise<WorkTestStack> {
  return createWorkStack(label, {
    ...(laneCapacity !== undefined ? { laneCapacity } : {}),
    laneTtlMs: 30 * 60_000,
    limits: { maxActionsPerTick: 5, maxInflight: 5, maxInflightPerPerson: 5 },
  })
}

const dispatched = (stack: Awaited<ReturnType<typeof tick>>, ticket: string) => stack.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)
const laneHoldOf = (report: Awaited<ReturnType<typeof tick>>, ticket: string) =>
  report.phases.stateDiff.decisions.find((d) => d.ticket === ticket && d.code === 'HOLD_LANE_BUSY')

describe('L2 引擎真栈：同泳道容量 2 两单并发派发（真引擎＋fake 执行体）', () => {
  it('同拍：两单同拍都派发（互不 HOLD_LANE_BUSY）', async () => {
    const stack = await stackWithCapacity('lane-cap-2-same-tick', { core: 2 })
    const a = await createTicket(stack, 'a：槽位一')
    const b = await createTicket(stack, 'b：槽位二')
    const report = await tick(stack)
    expect(dispatched(report, a)).toBe(true)
    expect(dispatched(report, b)).toBe(true)
    expect(report.phases.stateDiff.decisions.filter((d) => d.code === 'HOLD_LANE_BUSY')).toHaveLength(0)
    expect((await issueOf(stack, a)).state).toBe('已派发')
    expect((await issueOf(stack, b)).state).toBe('已派发')
  }, 60_000)

  it('跨拍：首单在途时次单照派；第三单 HOLD_LANE_BUSY 携 holders=2/capacity=2（渲染行前缀兼容）', async () => {
    const stack = await stackWithCapacity('lane-cap-2-cross-tick', { core: 2 })
    stack.mode.value = 'stalled' // 首单长跑在途（不收尾）
    const first = await createTicket(stack, 'a：长跑占槽')
    let firstDispatched = false
    for (let i = 0; i < 4 && !firstDispatched; i += 1) firstDispatched = dispatched(await tick(stack), first)
    expect(firstDispatched).toBe(true)

    const second = await createTicket(stack, 'b：次单补位')
    let secondDispatched = false
    for (let i = 0; i < 3 && !secondDispatched; i += 1) {
      const report = await tick(stack)
      secondDispatched = dispatched(report, second)
      expect(laneHoldOf(report, second)).toBeUndefined() // 容量 2：首单在途不挡次单
    }
    expect(secondDispatched).toBe(true)
    expect((await issueOf(stack, second)).state).toBe('已派发')

    const third = await createTicket(stack, 'c：满员排队')
    let hold: ReturnType<typeof laneHoldOf>
    for (let i = 0; i < 3 && hold === undefined; i += 1) hold = laneHoldOf(await tick(stack), third)
    expect(hold).toBeDefined()
    expect(hold?.lane).toBe('core')
    expect(hold?.laneCapacity).toBe(2)
    expect(hold?.laneHolders?.map((h) => h.ticket).sort()).toEqual([first, second].sort())
    expect(hold?.laneHolder).toBe(first) // 兼容面：最早占道者
    const line = renderHoldLaneBusy(1, hold!)
    const expiresAt = new Date(hold!.laneExpiresAt!).toISOString()
    // 前缀兼容：容量 1 旧行原样 + 多槽后缀 holders=N/capacity=M（缺省部署行字节不变）
    expect(line).toBe(
      `[serve] tick#1 hold：${third} code=HOLD_LANE_BUSY lane=core holder=${first} expiresAt=${expiresAt} holders=2/2（hold 无台账事件；此行=唯一观测面，签名去重）`,
    )
    expect((await issueOf(stack, third)).state).toBe('新单')
  }, 60_000)

  it('L1 容量 1（缺省不配）：次单 HOLD_LANE_BUSY，决策载荷不带多槽字段（字节不变）', async () => {
    const stack = await stackWithCapacity('lane-cap-1-default')
    stack.mode.value = 'stalled'
    const first = await createTicket(stack, 'a：独占')
    const second = await createTicket(stack, 'b：被挡')
    let hold: ReturnType<typeof laneHoldOf>
    let firstDispatched = false
    for (let i = 0; i < 6 && hold === undefined; i += 1) {
      const report = await tick(stack)
      firstDispatched ||= dispatched(report, first)
      hold = laneHoldOf(report, second)
    }
    expect(firstDispatched).toBe(true)
    expect(hold).toBeDefined()
    expect(hold?.lane).toBe('core')
    expect('laneCapacity' in hold!).toBe(false)
    expect('laneHolders' in hold!).toBe(false)
    expect(renderHoldLaneBusy(1, hold!)).not.toContain('holders=')
    expect((await issueOf(stack, second)).state).toBe('新单')
  }, 60_000)

  it('槽位回收：在途两单收割成功释放后，排队单补位派发（容量不泄漏）', async () => {
    const stack = await stackWithCapacity('lane-cap-2-recycle', { core: 2 })
    const a = await createTicket(stack, 'a：占槽')
    const b = await createTicket(stack, 'b：占槽')
    const c = await createTicket(stack, 'c：排队')
    const first = await tick(stack)
    expect(first.actions.filter((x) => x.type === 'dispatch' && [a, b, c].includes(x.ticket))).toHaveLength(2)
    expect(first.phases.stateDiff.decisions.filter((d) => d.code === 'HOLD_LANE_BUSY')).toHaveLength(1)
    const held = first.phases.stateDiff.decisions.find((d) => d.code === 'HOLD_LANE_BUSY')?.ticket
    expect(held).toBeDefined()
    expect(held).toBe(c) // 先创建的 a/b 先占槽（候选序稳定）
    // 收割成功（GATE_PASS 释放租约）→ 排队单 ≤6 拍内补位；占槽两单各恰一次成功收口
    let recycled = false
    for (let i = 0; i < 6 && !recycled; i += 1) recycled = dispatched(await tick(stack), c)
    expect(recycled).toBe(true)
    expect((await issueOf(stack, c)).state).toBe('已派发')
    for (const ticket of [a, b]) expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(1)
  }, 60_000)
})
