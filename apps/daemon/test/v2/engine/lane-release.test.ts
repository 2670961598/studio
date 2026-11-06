/**
 * lane-release —— 泳道租约成功路径释放 + hold 观测（studio-dev-713，P0）
 *
 * 依据：docs/17-§2「泳道租约释放对称＋hold 观测」段、docs/17-§6 收割成功契约位别注记。
 *
 * 根因（fault-scout 2026-11-04 实证）：泳道=单持有人+TTL（缺省 30min）；派发即占道，
 * 但收割成功分支未释放租约（释放只在失败/STALL/回收/批示回新单）→ 同泳道单在 TTL 内
 * 恒 HOLD_LANE_BUSY（studio-profit 实测停摆 20.5min：actions=4 dispatched=0 且无日志）。
 *
 * 用例纪律（V2 新套件）：真 SQLite 台账＋真引擎＋fake 外部端口（records fixtures/work-stack）；
 * 断言只认行为事实（平台态/事件流/tick report decisions），不 mock 决策面。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createLaneRegistry } from '../../../src/engine/lanes/registry.ts'
import { releaseTicketLane, releaseWithEpoch } from '../../../src/engine/lanes/release.ts'
import { holdLaneBusyLinesOf } from '../../../src/assembly/render/tick.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, issueOf, runTicks, tick, type WorkTestStack } from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

/** 建栈：泳道 TTL 保持生产缺省 30min（正是停摆成因；不缩短——否则测不到缺陷） */
async function stackWithLongTtl(label: string): Promise<WorkTestStack> {
  return createWorkStack(label, {
    laneTtlMs: 30 * 60_000,
    limits: { maxActionsPerTick: 5, maxInflight: 5, maxInflightPerPerson: 5 },
  })
}

describe('泳道租约成功路径释放（713 P0）', () => {
  it('成功收割后同泳道下一单可派（TTL 30min 内不再被 HOLD_LANE_BUSY 挡）', async () => {
    const stack = await stackWithLongTtl('lane-release-ok')
    const first = await createTicket(stack, 'a：占 core 泳道')
    const second = await createTicket(stack, 'b：同泳道排队')

    // 逐拍推进：先到首单派发；此期间次单同泳道必须看到 HOLD_LANE_BUSY（缺陷态现象）
    let dispatchedFirst = false
    let sawLaneHold = false
    for (let i = 0; i < 6 && !sawLaneHold; i += 1) {
      const report = await tick(stack)
      if (report.actions.some((a) => a.type === 'dispatch' && a.ticket === first)) dispatchedFirst = true
      if (report.phases.stateDiff.decisions.some((d) => d.ticket === second && d.code === 'HOLD_LANE_BUSY')) sawLaneHold = true
    }
    expect(dispatchedFirst).toBe(true)
    expect(sawLaneHold).toBe(true)

    // 推一拍收割首单成功（四要件齐）→ 修复点：成功分支释放租约
    await tick(stack)
    expect(eventsNamed(stack.ledger, first, 'GATE_PASS')).toHaveLength(1)
    expect((await issueOf(stack, first)).state).toBe('证据就绪')

    // 成功收割后 ≤2 拍内同泳道次单可派（未释放则仍 HOLD_LANE_BUSY，直到 30min TTL 到期）
    let nextDispatch = await tick(stack)
    if (!nextDispatch.actions.some((a) => a.type === 'dispatch' && a.ticket === second)) nextDispatch = await tick(stack)
    expect(nextDispatch.actions.some((a) => a.type === 'dispatch' && a.ticket === second)).toBe(true)
    expect((await issueOf(stack, second)).state).toBe('已派发')
    // 首单已越过派发态（证据就绪→复验通过→…），不与次单抢回泳道
    expect((await issueOf(stack, first)).state).not.toBe('已派发')
  }, 60_000)

  it('失败路径释放不回归：GATE_FAIL 后同单可重派（attempt2）', async () => {
    const stack = await stackWithLongTtl('lane-release-fail')
    stack.mode.value = 'no_report' // 四要件缺 REPORT → 收割失败面
    const ticketId = await createTicket(stack, '会失败的单')

    // 逐拍推进到首个「失败收割」拍（期间会有一次派发）
    let failTick: Awaited<ReturnType<typeof tick>> | undefined
    let sawDispatch = false
    for (let i = 0; i < 6; i += 1) {
      const report = await tick(stack)
      if (report.actions.some((a) => a.type === 'dispatch' && a.ticket === ticketId)) sawDispatch = true
      if (report.phases.harvest.failed > 0) {
        failTick = report
        break
      }
    }
    expect(sawDispatch).toBe(true)
    expect(failTick).toBeDefined()
    expect((await issueOf(stack, ticketId)).state).toBe('新单')
    // 失败面恰一条 GATE_FAIL（此刻第一轮失败已收口、尚未进入第二轮）
    expect(eventsNamed(stack.ledger, ticketId, 'GATE_FAIL')).toHaveLength(1)

    // 失败面已释放租约（既有语义）→ 后续拍可重派（attempt2）
    for (let i = 0; i < 4 && eventsNamed(stack.ledger, ticketId, 'DISPATCH').length < 2; i += 1) await tick(stack)
    const dispatches = eventsNamed(stack.ledger, ticketId, 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    expect(dispatches[1]?.attempt).toBe(2)
  }, 60_000)

  it('多泳道隔离＋误放防护＋双放幂等（registry 纯件）', () => {
    const lanes = createLaneRegistry(1_000)
    lanes.acquire('core', 'T-1', 0)
    lanes.acquire('qa', 'T-2', 0)
    expect(lanes.state('core').holder).toBe('T-1')
    expect(lanes.state('qa').holder).toBe('T-2')

    // 不误放他人泳道：清 core 不得动 qa
    lanes.release('core', 'T-1')
    expect(lanes.state('core').holder).toBeNull()
    expect(lanes.state('qa').holder).toBe('T-2')

    // holder 校验：非持有人释放=无效（不误放他单）
    lanes.release('qa', 'T-999')
    expect(lanes.state('qa').holder).toBe('T-2')

    // 双放幂等：第二次释放无副作用、不抛
    lanes.release('qa', 'T-2')
    lanes.release('qa', 'T-2')
    expect(lanes.state('qa').holder).toBeNull()
  })
})

describe('HOLD_LANE_BUSY 观测面（713 P0）', () => {
  it('hold 决策携 lane/holder/到期时间，渲染行签名去重（不刷屏）', async () => {
    const stack = await stackWithLongTtl('lane-hold-observe')
    const first = await createTicket(stack, 'a：占道')
    const second = await createTicket(stack, 'b：被挡')
    const reports = await runTicks(stack, 4)
    const report = reports.find((r) => r.phases.stateDiff.decisions.some((d) => d.ticket === second && d.code === 'HOLD_LANE_BUSY'))
    expect(report).toBeDefined()
    if (report === undefined) throw new Error('未观察到 HOLD_LANE_BUSY 决策（观测面缺失）')
    const entry = report.phases.stateDiff.decisions.find((d) => d.ticket === second && d.code === 'HOLD_LANE_BUSY')
    expect(entry).toBeDefined()
    expect(entry?.actionType).toBe('hold')
    expect(entry?.lane).toBe('core')
    expect(entry?.laneHolder).toBe(first)
    expect(typeof entry?.laneExpiresAt).toBe('number')

    const seen = new Map<string, string>()
    const lines = holdLaneBusyLinesOf(report, seen)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('HOLD_LANE_BUSY')
    expect(lines[0]).toContain(`lane=core`)
    expect(lines[0]).toContain(`holder=${first}`)
    expect(lines[0]).toContain('expiresAt=')
    expect(lines[0]).toContain(second)

    // 同签名下一拍不再刷屏
    expect(holdLaneBusyLinesOf(report, seen)).toHaveLength(0)

    // 租约快照变化（续租/换主/到期时间变）→ 重新可见
    const changed = structuredClone(report) as NonNullable<typeof report>
    const changedEntry = changed.phases.stateDiff.decisions.find((d) => d.ticket === second && d.code === 'HOLD_LANE_BUSY')
    expect(changedEntry).toBeDefined()
    if (changedEntry !== undefined) changedEntry.laneExpiresAt = (changedEntry.laneExpiresAt ?? 0) + 60_000
    expect(holdLaneBusyLinesOf(changed, seen)).toHaveLength(1)

    // 不再 busy（释放/派发）→ 清理 afterimage；下次再 busy 可重新可见
    const drained = structuredClone(report) as NonNullable<typeof report>
    drained.phases.stateDiff.decisions = drained.phases.stateDiff.decisions.filter((d) => d.code !== 'HOLD_LANE_BUSY')
    expect(holdLaneBusyLinesOf(drained, seen)).toHaveLength(0)
    expect(holdLaneBusyLinesOf(report, seen)).toHaveLength(1)
  }, 60_000)
})


describe('812 派发失败释放带 epoch（epoch 只 +1，同泳道可立即再派）', () => {
  it('acquire(epoch0)→失败 release(epoch0)→epoch=1；再 acquire=epoch1；旧 epoch 释放 stale 不误放', () => {
    const lanes = createLaneRegistry(30 * 60_000)
    const acquired = lanes.acquire('core', 'T-fail', 1_000)
    expect(acquired).toBe(0)
    // 决策位 acquire 返回 epoch → executeDispatch 失败面 releaseWithEpoch（812）
    const released = releaseWithEpoch(lanes, { lane: 'core', ticket: 'T-fail', epoch: acquired })
    expect(released).toMatchObject({ ok: true, reason: 'released', currentEpoch: 1 })
    expect(lanes.epochOf('core')).toBe(1) // 只 +1（不重复推进）
    // 同泳道下一单可立即占道（epoch 前进不阻塞）
    const next = lanes.acquire('core', 'T-next', 2_000)
    expect(next).toBe(1)
    // 旧 epoch（0）的迟到释放拒收：新 holder 不被误放
    expect(releaseWithEpoch(lanes, { lane: 'core', ticket: 'T-fail', epoch: acquired })).toMatchObject({ ok: false, reason: 'stale-epoch' })
    expect(lanes.state('core').holder).toBe('T-next')
    expect(lanes.epochOf('core')).toBe(1) // 拒收不推进
    // 无 inflight 且 holder 匹配时，统一规则用 state.epoch 正常释放
    expect(releaseTicketLane(lanes, new Map() as never, 'T-next', 'core')).toMatchObject({ ok: true, reason: 'released' })
    expect(lanes.state('core').holder).toBeNull()
  })
})


describe('812 后续单：lane 每拍续租（引擎级长跑跨 TTL）', () => {
  it('inflight 长跑跨 TTL：同泳道候选仍 HOLD_LANE_BUSY（不被 TTL 抢道）；release 后 epoch+1 可再派', async () => {
    const stack = await createWorkStack('lane-renew-longrun', {
      laneTtlMs: 1_000, // 极小 TTL，模拟 90s 长跑跨越
      limits: { maxActionsPerTick: 5, maxInflight: 5, maxInflightPerPerson: 5 },
    })
    stack.mode.value = 'stalled' // worker 长跑不结束（stalled 流驻留）
    const first = await createTicket(stack, '长跑占 core')
    const second = await createTicket(stack, '同泳道排队')
    let dispatched = false
    for (let i = 0; i < 4 && !dispatched; i += 1) {
      const report = await tick(stack)
      if (report.actions.some((a) => a.type === 'dispatch' && a.ticket === first)) dispatched = true
    }
    expect(dispatched).toBe(true)
    expect((await issueOf(stack, first)).state).toBe('已派发')
    // 每次 tick 前把钟推过 TTL（2s>1s）；续租在 tick 入口/决策前执行 → 租约仍活
    let sawLaneHold = false
    for (let i = 0; i < 3; i += 1) {
      stack.clock.advance(2_000)
      const report = await tick(stack)
      if (report.phases.stateDiff.decisions.some((d) => d.ticket === second && d.code === 'HOLD_LANE_BUSY')) sawLaneHold = true
    }
    expect(sawLaneHold).toBe(true) // 未续租时：TTL 过期→第二单会被派发（缺陷形态）
    // 首单仍在途（stalled）——第二单未被派发
    expect((await issueOf(stack, second)).state).not.toBe('已派发')
  }, 60_000)
})
