/**
 * person-gate-queue —— 人闸+todo_queue 投影+排序键 引擎接线回归（129-§6.2，studio-dev-167 单B）
 *
 * 规格依据（实现单引用，规格单一源=129-att1 plan §6）：
 *   - R3 第四闸「人闸」：闸序冻结 `断路 > 泳道 > 人 > 每拍 > 在途`——同人第二单
 *     HOLD_PERSON_BUSY 顺延不丢（缺省帽 1）；org-config 按人覆盖（AGENT-1 可配 2）；
 *     人闸与泳道闸正交（lane 管「这道工序能不能进」，人闸管「这个人有没有手」）。
 *   - R4 排序键冻结：score = clampPriority(priority 0..3) + ageBoostTier(wait/step 封顶 2)；
 *     pinned=+∞ 恒首；同分 FIFO（first_seen_at 升序→单号升序）；不抢占（在工自然收口）。
 *     饥饿防线=ageBoost：低优老单 2 档加成压过高优新单（引擎级红证）。
 *   - R2 todo_queue 投影：可重建投影非事实源（决策永不读表）；成员=主干派发位之前的
 *     态；DISPATCH note 携 wait/prio/boost 锚（scheduleToStart 观测面=store 读回）。
 *
 * 断言面：
 *   1. 人闸缺省 1 串行：同人第二单 HOLD_PERSON_BUSY → 收割放人后照派（顺延不丢）；
 *   2. 两人互不锁（assignee 分工）；覆盖表放宽 2 → 同拍双派（正交面：人闸配置归人闸）；
 *   3. 闸序人>每拍：人忙先于每拍上限拦（maxActionsPerTick=1 下第三单断言次序）；
 *   4. DISPATCH note wait/prio/boost 锚 + recentDispatchWaitsMs 读回 + tick 报告
 *      scheduleToStart；
 *   5. todo_queue 投影：行形（person/ready_state/first_seen_at/why）、派发即离投影、
 *      stateDiff.queue 观测、重启种子（FIFO 钟跨重启不漂）；
 *   6. R4 引擎级红证：低优老单 ageBoost 2 档 > 高优新单 1 分（饥饿防线兑现）；
 *   7. 排序器注入位：queueRanker 注入即生效（160-B 小模型档升级位面已冻结）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, PersonRef, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'
import {
  orderCandidates,
  parsePersonInflightOverrides,
  parsePinnedTickets,
  projectTodoQueue,
  queueMembership,
  seedQueueCarry,
  touchQueueCarry,
  type QueueCarry,
  type QueueMemberSource,
} from '../../../src/engine/todoqueue/queue.ts'
import { DEFAULT_FLOW_TABLE, DEFAULT_STATES, resolveTicketFlow, type QueueRanker } from '@studio-next/core'

// ————————————————————————— 测试栈 —————————————————————————

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  limits?: { maxActionsPerTick?: number; maxInflight?: number; maxInflightPerPerson?: number }
  /** 按人覆盖表（R3：批量执行岗才可 >1） */
  personInflightOverrides?: Readonly<Record<string, number>>
  /** 制作人置顶单集（R4：+∞ 恒首） */
  pinnedTickets?: readonly string[]
  /** 排序器注入（R1 升级位：160-B 小模型档） */
  queueRanker?: QueueRanker
  /** 队列 ageBoost 步长（R4；缺省 60min） */
  queueAgeStepMs?: number
  /** 镜像对账重决策节流（队列老化红证要 rescan 唤回排队单） */
  mirrorRescanEveryTicks?: number
  /** 人员索引（两人互不锁用例注入双人） */
  people?: readonly PersonRef[]
}

const PEOPLE_2: readonly PersonRef[] = [
  { id: 'AGENT-1', name: '甲工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
  { id: 'AGENT-2', name: '乙工程师', login: 'agent-2', level: 2, dept: 'departments/工程部' },
]

function buildStack(id: string, opts?: StackOptions): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      limits: {
        maxActionsPerTick: opts?.limits?.maxActionsPerTick ?? 4,
        maxInflight: opts?.limits?.maxInflight ?? 4,
        ...(opts?.limits?.maxInflightPerPerson !== undefined
          ? { maxInflightPerPerson: opts.limits.maxInflightPerPerson }
          : {}),
      },
      ...(opts?.mirrorRescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: opts.mirrorRescanEveryTicks } : {}),
      ...(opts?.personInflightOverrides !== undefined ? { personInflightOverrides: opts.personInflightOverrides } : {}),
      ...(opts?.pinnedTickets !== undefined ? { pinnedTickets: opts.pinnedTickets } : {}),
      ...(opts?.queueRanker !== undefined ? { queueRanker: opts.queueRanker } : {}),
      ...(opts?.queueAgeStepMs !== undefined ? { queueAgeStepMs: opts.queueAgeStepMs } : {}),
    },
    people: opts?.people ?? PEOPLE_2,
  })
  return { platform, ledger, engine, clock }
}

async function createTicket(
  stack: TestStack,
  title: string,
  opts?: { lane?: string; assignee?: string; level?: number },
): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: opts?.level ?? 0 })
  if (opts?.lane !== undefined) await stack.platform.issues.setField(created.id, 'lane', opts.lane)
  if (opts?.assignee !== undefined) await stack.platform.issues.setField(created.id, 'assignee', opts.assignee)
  return created.id
}

/** 推拍到该单 CLOSE（fake 全链 5 拍内到终态；上限内未到=断言面自会红） */
async function runTicks(stack: TestStack, n: number): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    reports.push(await stack.engine.tick())
  }
  return reports
}

let root = ''
const T0 = Date.UTC(2026, 9, 22, 0, 0, 0)

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-person-gate-queue-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 域件纯函数 —————————————————————————

describe('域件纯函数：成员资格（主干派发位之前——位置判定）', () => {
  const member = (state: string, type: string | undefined, level: number | undefined): QueueMemberSource => ({
    id: 'T-1',
    state,
    ...(type !== undefined ? { type } : {}),
    ...(level !== undefined ? { level } : {}),
  })
  const flowOf = (m: QueueMemberSource) => resolveTicketFlow(DEFAULT_FLOW_TABLE, m.type, m.level)

  it('L0：新单=ready 成员；已派发/证据就绪/复验通过/已交付均非成员（在工与收割链不进收件箱）', () => {
    expect(queueMembership(member('新单', 'task', 0), flowOf(member('新单', 'task', 0)))).toBe('ready')
    expect(queueMembership(member('已派发', 'task', 0), flowOf(member('已派发', 'task', 0)))).toBe(false)
    expect(queueMembership(member('证据就绪', 'task', 0), flowOf(member('证据就绪', 'task', 0)))).toBe(false)
    expect(queueMembership(member('已交付', 'task', 0), flowOf(member('已交付', 'task', 0)))).toBe(false)
  })

  it('L1：新单=ready、待批=awaiting_approval（成员但等制作人批）、已派发起非成员', () => {
    expect(queueMembership(member('新单', 'task', 1), flowOf(member('新单', 'task', 1)))).toBe('ready')
    expect(queueMembership(member('待批', 'task', 1), flowOf(member('待批', 'task', 1)))).toBe('awaiting_approval')
    expect(queueMembership(member('已派发', 'task', 1), flowOf(member('已派发', 'task', 1)))).toBe(false)
  })

  it('L2 后段不进收件箱：复验通过（二道待批前位）与已交付均非成员——位置判定切准「排队等派发」', () => {
    // 可达面红证：L2 主干 复验通过→待批→已派发 链式可达，但复验通过在派发位**之后**
    // ——收件箱只看派发位之前的段（收割链后段不是「人还没开工的队」）
    expect(queueMembership(member('复验通过', 'task', 2), flowOf(member('复验通过', 'task', 2)))).toBe(false)
    expect(queueMembership(member('已交付', 'task', 2), flowOf(member('已交付', 'task', 2)))).toBe(false)
    expect(queueMembership(member('待批', 'task', 2), flowOf(member('待批', 'task', 2)))).toBe('awaiting_approval')
  })

  it('未声明态/无流（bug 不定级）非成员——fail-closed 不产行', () => {
    expect(queueMembership(member('乱写的态', 'task', 0), flowOf(member('乱写的态', 'task', 0)))).toBe(false)
    expect(queueMembership(member('新单', undefined, undefined), undefined)).toBe(false)
  })
})

describe('域件纯函数：携带态与定序', () => {
  it('touchQueueCarry：首见种钟（why 归因）；再见只抬峰不重种（FIFO 锚不动）', () => {
    const carry: QueueCarry = new Map()
    const intent = { kind: 'ticket' as const, company: 'demo', ticket: 'T-1', source: 'activity', priority: 2 }
    const first = touchQueueCarry(carry, 'T-1', intent, 1000)
    expect(first).toEqual({ firstSeenAt: 1000, priority: 2, why: 'activity|ticket' })
    // 高优插队：抬峰（钳 3 封顶）；钟不重种（同誓一钟）
    const second = touchQueueCarry(carry, 'T-1', { ...intent, priority: 9 }, 9999)
    expect(second.firstSeenAt).toBe(1000)
    expect(second.priority).toBe(3)
    // 低优再触不降峰（历史峰语义——排队期间见过的最高意图优先级）
    const third = touchQueueCarry(carry, 'T-1', { ...intent, priority: 0 }, 12345)
    expect(third.priority).toBe(3)
  })

  it('orderCandidates：生命周期原序在前，队列候选全局排序在后（收割回收先于新派发）', () => {
    const meta = (ticket: string, priority: number, firstSeenAt: number) => ({
      ticket,
      priority,
      pinned: false,
      firstSeenAt,
      boostTier: 0,
    })
    const candidates = [
      { ticket: 'T-9', inWork: true }, // 生命周期（在工——收割链）
      { ticket: 'T-1' },
      { ticket: 'T-2' },
    ]
    const memberOf = (t: string): boolean => t !== 'T-9'
    const metaOf = (t: string) => (t === 'T-1' ? meta('T-1', 0, 100) : meta('T-2', 3, 100))
    const ordered = orderCandidates(candidates, memberOf, metaOf)
    // T-9 生命周期恒首（原序）；队列内 T-2（prio 3）压过 T-1（prio 0）
    expect(ordered.map((c) => c.ticket)).toEqual(['T-9', 'T-2', 'T-1'])
  })

  it('orderCandidates：pinned 恒首 + 同分 FIFO（first_seen_at 升序→单号升序全序）', () => {
    const meta = (ticket: string, pinned: boolean, firstSeenAt: number) => ({
      ticket,
      priority: 1,
      pinned,
      firstSeenAt,
      boostTier: 0,
    })
    const candidates = [{ ticket: 'T-2' }, { ticket: 'T-3' }, { ticket: 'T-1' }]
    const metaOf = (t: string) => (t === 'T-2' ? meta('T-2', true, 500) : t === 'T-3' ? meta('T-3', false, 100) : meta('T-1', false, 100))
    const ordered = orderCandidates(candidates, () => true, metaOf)
    // pinned T-2 恒首；T-3/T-1 同分（prio 1、boost 0）→ firstSeenAt 同 100 → 单号升序
    expect(ordered.map((c) => c.ticket)).toEqual(['T-2', 'T-1', 'T-3'])
  })

  it('orderCandidates：排序器注入即生效（R1 升级位——倒序 ranker 逆转队序）', () => {
    const meta = (ticket: string) => ({ ticket, priority: 1, pinned: false, firstSeenAt: 100, boostTier: 0 })
    const candidates = [{ ticket: 'T-1' }, { ticket: 'T-2' }, { ticket: 'T-3' }]
    const reversed: QueueRanker = (entries) => [...entries].sort((a, b) => (a.ticket < b.ticket ? 1 : a.ticket > b.ticket ? -1 : 0))
    const ordered = orderCandidates(candidates, () => true, meta, reversed)
    expect(ordered.map((c) => c.ticket)).toEqual(['T-3', 'T-2', 'T-1'])
  })
})

describe('域件纯函数：投影与配置解析', () => {
  const memberOf = (id: string, state: string, assignee?: string): QueueMemberSource => ({
    id,
    state,
    type: 'task',
    level: 0,
    ...(assignee !== undefined ? { assignee } : {}),
  })

  it('projectTodoQueue：行形（person/ready_state/first_seen_at/why/last_boost_at）+ 人不可解析跳行 + 确定序', () => {
    const carry: QueueCarry = new Map()
    touchQueueCarry(carry, 'T-1', { kind: 'ticket', company: 'demo', ticket: 'T-1', source: 'activity', priority: 2 }, 1000)
    const rows = projectTodoQueue({
      members: [memberOf('T-1', '新单'), memberOf('T-2', '新单', 'AGENT-2'), memberOf('T-3', '新单')],
      flowResolve: (m) => resolveTicketFlow(DEFAULT_FLOW_TABLE, m.type, m.level),
      personOf: (m) => m.assignee ?? 'AGENT-1',
      carry,
      pinnedTickets: new Set(['T-2']),
      ageStepMs: 3_600_000,
      now: 1000 + 7_200_000, // 两步 → boost 档 2 封顶
      company: 'demo',
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]?.ticket).toBe('T-1') // 单号升序（确定性可重放）
    expect(rows[0]).toMatchObject({
      company: 'demo',
      person: 'AGENT-1',
      priority: 2,
      pinned: 0,
      boost_tier: 2,
      first_seen_at: 1000,
      ready_state: 'ready',
      why: 'activity|ticket',
    })
    expect(rows[0]?.last_boost_at).toBe(1000 + 2 * 3_600_000)
    expect(rows[1]?.pinned).toBe(1)
    // T-2 零等待：boost 0 档 → 无 last_boost_at（可空列缺省面）
    expect(rows[1]?.boost_tier).toBe(0)
    expect(rows[1]?.last_boost_at).toBeUndefined()
  })

  it('projectTodoQueue：离队单的携带条目被 GC（防跨拍膨胀——投影可重建兜底）', () => {
    const carry: QueueCarry = new Map()
    touchQueueCarry(carry, 'T-1', { kind: 'ticket', company: 'demo', ticket: 'T-1', source: 'activity', priority: 1 }, 1000)
    touchQueueCarry(carry, 'T-2', { kind: 'ticket', company: 'demo', ticket: 'T-2', source: 'activity', priority: 1 }, 1000)
    projectTodoQueue({
      members: [memberOf('T-1', '已交付')], // T-1 终态、T-2 消失——两条都离队
      flowResolve: (m) => resolveTicketFlow(DEFAULT_FLOW_TABLE, m.type, m.level),
      personOf: () => 'AGENT-1',
      carry,
      pinnedTickets: new Set(),
      ageStepMs: 3_600_000,
      now: 2000,
      company: 'demo',
    })
    expect(carry.size).toBe(0)
  })

  it('parsePersonInflightOverrides：分号对解析 + 坏形态明报（不静默忽略段）', () => {
    expect([...parsePersonInflightOverrides('P-1=2;P-2=3')]).toEqual([['P-1', 2], ['P-2', 3]])
    expect(parsePersonInflightOverrides(' AGENT-1 = 2 ').get('AGENT-1')).toBe(2)
    expect(parsePersonInflightOverrides('').size).toBe(0)
    expect(() => parsePersonInflightOverrides('P-1')).toThrow('工号=N')
    expect(() => parsePersonInflightOverrides('P-1=0')).toThrow('正整数')
    expect(() => parsePersonInflightOverrides('=2')).toThrow('工号=N')
  })

  it('parsePinnedTickets：逗号清单（空白容忍）；空串=空集', () => {
    expect(parsePinnedTickets('T-1, T-2,,T-3')).toEqual(['T-1', 'T-2', 'T-3'])
    expect(parsePinnedTickets('')).toEqual([])
  })
})

// ————————————————————————— 引擎接线 —————————————————————————

describe('R3 人闸：缺省 1 串行、顺延不丢、两人互不锁、覆盖面放宽', () => {
  it('同人第二单 HOLD_PERSON_BUSY（缺省帽 1）→ 收割放人后照派——顺延不丢', async () => {
    const stack = buildStack('person-default', {
      limits: { maxActionsPerTick: 4, maxInflight: 4 },
      mirrorRescanEveryTicks: 1, // 顺延单活动已被游标消费——rescan 唤回（DEV-42① 兜底）
    })
    await createTicket(stack, '甲的第一单')
    // 异泳道：把泳道闸摘掉，纯证人闸（闸序=泳道>人，同泳道会先撞 HOLD_LANE_BUSY）
    await createTicket(stack, '甲的第二单', { lane: 'extra' })
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(1)
    const byTicket = new Map(t1.phases.stateDiff.decisions.map((d) => [d.ticket, d.code]))
    expect(byTicket.get('T-1')).toBe('DISPATCH')
    expect(byTicket.get('T-2')).toBe('HOLD_PERSON_BUSY')
    // 推到第一单收割放人：第二单照派（顺延不丢），全链到终态
    const reports = await runTicks(stack, 8)
    const t2DispatchTick = reports.findIndex((r) => r.phases.dispatch.dispatched > 0)
    expect(t2DispatchTick).toBeGreaterThan(0)
    const dispatches = stack.ledger.queryEvents({ issue: 'T-2' }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(1)
    expect((await stack.platform.issues.get('T-2')).state).toBe('已交付')
    stack.ledger.close()
  })

  it('两人互不锁（assignee 分工=队列归属键）：各一单同拍双派', async () => {
    const stack = buildStack('person-two', { limits: { maxActionsPerTick: 4, maxInflight: 4 } })
    await createTicket(stack, '甲的单')
    // 异泳道+异人：两闸都不锁（同泳道会撞泳道闸——那是 lane 的面不是人的面）
    await createTicket(stack, '乙的单', { assignee: 'AGENT-2', lane: 'extra' })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(2)
    expect(report.phases.stateDiff.decisions.map((d) => d.code)).not.toContain('HOLD_PERSON_BUSY')
    stack.ledger.close()
  })

  it('覆盖面放宽（AGENT-1=2 批量执行岗）：同人两单同拍双派——人闸配置归人闸，与预算/泳道正交', async () => {
    const stack = buildStack('person-override', {
      limits: { maxActionsPerTick: 4, maxInflight: 4 },
      personInflightOverrides: { 'AGENT-1': 2 },
    })
    await createTicket(stack, '批量岗一')
    await createTicket(stack, '批量岗二', { lane: 'extra' })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(2)
    stack.ledger.close()
  })
})

describe('R2/R5 投影与 wait 锚：todo_queue 落表 + DISPATCH note + scheduleToStart', () => {
  it('排队即投影（person/ready_state/first_seen_at/why）；派发即离投影；报告 queue 观测', async () => {
    const stack = buildStack('project-basic', {
      limits: { maxActionsPerTick: 4, maxInflight: 4 },
      mirrorRescanEveryTicks: 1,
    })
    await createTicket(stack, '排队的单')
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    // 拍 1：dispatched T-1（已派发离投影）——拍 1 末投影应为空（无排队单）
    expect(t1.phases.stateDiff.queue).toEqual({ rows: 0, persons: 0 })
    // 第二单排队（人忙）：拍 2 投影一行
    await createTicket(stack, '第二单排队', { lane: 'extra' })
    stack.clock.advance(1000)
    const t2 = await stack.engine.tick()
    expect(t2.phases.stateDiff.queue).toEqual({ rows: 1, persons: 1 })
    const rows = stack.ledger.listTodoQueue('demo')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      company: 'demo',
      ticket: 'T-2',
      person: 'AGENT-1',
      ready_state: 'ready',
      why: 'activity|ticket',
    })
    expect(rows[0]?.first_seen_at).toBe(T0 + 2000) // 种钟拍=入候选拍
    // 推到收割放人：T-2 派发即离投影
    const reports = await runTicks(stack, 8)
    const dispatchTick = reports.find((r) => r.phases.dispatch.dispatched > 0)
    expect(dispatchTick?.phases.stateDiff.queue.rows).toBe(0)
    expect(stack.ledger.listTodoQueue('demo')).toHaveLength(0)
    stack.ledger.close()
  })

  it('DISPATCH note 携 wait/prio/boost 锚；recentDispatchWaitsMs 读回；报告 scheduleToStart（排队 2 拍→wait≥1s）', async () => {
    const stack = buildStack('wait-anchor', {
      limits: { maxActionsPerTick: 4, maxInflight: 4 },
      mirrorRescanEveryTicks: 1,
    })
    await createTicket(stack, '第一单占人')
    await createTicket(stack, '第二单排队', { lane: 'extra' })
    stack.clock.advance(1000)
    await stack.engine.tick() // T-1 派发；T-2 排队（HOLD_PERSON_BUSY——异泳道证人闸）
    stack.clock.advance(1000)
    await stack.engine.tick() // T-1 在工（fake 流驻留拍）；T-2 仍排队
    const reports = await runTicks(stack, 6)
    // T-2 的 DISPATCH note：wait=入队到派发的墙钟（≥2s——两拍排队）+ prio + boost 锚
    const dispatch = stack.ledger.queryEvents({ issue: 'T-2' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch).toBeDefined()
    const anchor = /;wait=(\d+);prio=(\d+);boost=(\d+)$/.exec(dispatch?.note ?? '')
    expect(anchor).not.toBeNull()
    expect(Number(anchor?.[1])).toBeGreaterThanOrEqual(2000)
    expect(anchor?.[2]).toBe('1') // 活动意图优先级（钳后 1）
    expect(anchor?.[3]).toBe('0') // 60min 步长下 2s 排队=0 档加成
    // scheduleToStart 观测面：note 锚 SQL 读回（近 50 次）
    const waits = stack.ledger.recentDispatchWaitsMs('demo', 50)
    expect(waits.length).toBeGreaterThanOrEqual(2)
    const report = reports[reports.length - 1]
    expect(report.phases.dispatch.scheduleToStart.count).toBeGreaterThanOrEqual(2)
    expect(report.phases.dispatch.scheduleToStart.maxMs).toBeGreaterThan(0)
    expect((await stack.platform.issues.get('T-2')).state).toBe('已交付')
    stack.ledger.close()
  })

  it('重启种子：同库重建引擎——FIFO 钟续用（排队单的 first_seen_at 不因重启漂移）', async () => {
    const stack = buildStack('restart-seed', { limits: { maxActionsPerTick: 4, maxInflight: 4 } })
    await createTicket(stack, '占人的单')
    await createTicket(stack, '排队过重启')
    stack.clock.advance(1000)
    await stack.engine.tick() // T-1 派发；T-2 种钟 T0+1000 排队
    const before = stack.ledger.listTodoQueue('demo').find((r) => r.ticket === 'T-2')
    expect(before?.first_seen_at).toBe(T0 + 1000)
    stack.ledger.close()
    // 重启：同库新引擎（携带态从 todo_queue 种子——seqSeed 同款恢复面）
    const reborn = buildStack('restart-seed', { limits: { maxActionsPerTick: 4, maxInflight: 4 } })
    // 注意：buildStack 新开库文件名同名但 openLedger 同一路径=同库；新引擎读回投影种子
    const after = reborn.ledger.listTodoQueue('demo').find((r) => r.ticket === 'T-2')
    expect(after?.first_seen_at).toBe(before?.first_seen_at)
    reborn.ledger.close()
  })
})

describe('R4 排序键引擎级红证：ageBoost 饥饿防线 + 置顶 + 排序器注入', () => {
  it('低优老单 ageBoost 2 档压过高优新单（每拍上限 1 的单槽竞争）——饥饿防线兑现', async () => {
    // 步长 1s（queueAgeStepMs=1000）：排队 2 拍=2 档加成满档
    const stack = buildStack('age-boost', {
      limits: { maxActionsPerTick: 1, maxInflight: 4 },
      queueAgeStepMs: 1000,
      mirrorRescanEveryTicks: 1, // 人闸顺延单的活动已消费——rescan 唤回（DEV-42① 兜底）
    })
    await createTicket(stack, '老单低优')
    stack.clock.advance(1000)
    await stack.engine.tick() // T-1 派发（唯一槽）；maxActionsPerTick=1 → T-2 无槽
    await createTicket(stack, '老单第二') // 与 T-1 同拍建单被拍上限拦？不——本拍后才建
    // 拍 2：T-1 在工；T-2 rescan 唤回（prio 0）被每拍上限拦（0 动作槽被 T-1 收割占用……收割也是动作）
    stack.clock.advance(1000)
    const t2 = await stack.engine.tick()
    expect(t2.phases.stateDiff.decisions.map((d) => d.ticket)).toContain('T-2')
    // 拍 3：T-3 新单进（活动意图 prio 1=score 1）；T-2 已排队 2 拍（prio 0+boost 2=score 2）
    await createTicket(stack, '新单高优')
    stack.clock.advance(1000)
    const t3 = await stack.engine.tick()
    // 找首个空槽（T-1 收割链先占槽——拍 3 可能两单都 hold）：此后 T-2/T-3 的第一个
    // 派发槽必属 T-2（score 2>1；即便 T-3 也老化到 1 档=2 分同分，FIFO 钟 T-2 先）
    const later = await runTicks(stack, 6)
    const slot = [t3, ...later].find((r) =>
      r.phases.stateDiff.decisions.some((d) => (d.ticket === 'T-2' || d.ticket === 'T-3') && d.code === 'DISPATCH'),
    )
    expect(slot).toBeDefined()
    const winner = slot?.phases.stateDiff.decisions.find((d) => d.code === 'DISPATCH')?.ticket
    expect(['T-2', 'T-3']).toContain(winner) // 单槽拍内只一个 DISPATCH（maxActionsPerTick=1）
    expect(winner).toBe('T-2') // 低优老单 ageBoost 上位——饥饿防线兑现（R4 冻结公式）
    stack.ledger.close()
  })

  it('制作人置顶（pinnedTickets）：+∞ 恒首——后建置顶单抢在先建未置顶单之前拿单槽', async () => {
    const stack = buildStack('pinned', {
      limits: { maxActionsPerTick: 1, maxInflight: 4 },
      pinnedTickets: ['T-2'],
      mirrorRescanEveryTicks: 1,
    })
    // T-1 先建（缺省档同分 FIFO=先建先派）——T-2 后建但制作人置顶（score=∞ 恒首）
    await createTicket(stack, '先建单 FIFO 占先', { lane: 'extra' })
    await createTicket(stack, '后建置顶单')
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    // 单槽竞争：置顶 T-2 压过 FIFO 先建的 T-1（R4 冻结公式 pinned=+∞）
    expect(t1.phases.dispatch.dispatched).toBe(1)
    const dispatched = t1.phases.stateDiff.decisions.find((d) => d.code === 'DISPATCH')
    expect(dispatched?.ticket).toBe('T-2')
    // 置顶只抬序不抬闸：T-2 占人后（缺省帽 1），T-1 泳道空（extra）但人忙——HOLD_PERSON_BUSY
    const held = t1.phases.stateDiff.decisions.find((d) => d.ticket === 'T-1')
    expect(held?.code).toBe('HOLD_PERSON_BUSY')
    stack.ledger.close()
  })

  it('queueRanker 注入位：倒序 ranker 让单号大者先派（R1 升级面接线兑现，160-B 档位）', async () => {
    const reversed: QueueRanker = (entries) => [...entries].sort((a, b) => (a.ticket < b.ticket ? 1 : a.ticket > b.ticket ? -1 : 0))
    const stack = buildStack('ranker-inject', {
      limits: { maxActionsPerTick: 1, maxInflight: 4 },
      queueRanker: reversed,
      mirrorRescanEveryTicks: 1,
    })
    await createTicket(stack, 'a 单')
    await createTicket(stack, 'b 单')
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    // 单槽：缺省档 FIFO（同拍同分→单号升序=T-1 先）被倒序 ranker 逆转=T-2 先派
    expect(report.phases.dispatch.dispatched).toBe(1)
    const dispatched = report.phases.stateDiff.decisions.find((d) => d.code === 'DISPATCH')
    expect(dispatched?.ticket).toBe('T-2')
    stack.ledger.close()
  })
})
