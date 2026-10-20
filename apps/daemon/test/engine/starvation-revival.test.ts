/**
 * starvation-revival —— DEV-42 引擎两缺陷回归（红→绿纪律：先红证后修法）
 *
 * 缺陷①（候选积压饿死，2026-10-20 哨查：studio-dev-45..53 零事件滞留数小时）：
 *   决策候选是活动驱动的（采集相位 affected）——被 maxActionsPerTick/maxInflight 顺延
 *   的单，其建单/迁移活动已被游标消费：下一拍无新活动=不再是候选=永久搁置（队列大片
 *   开放却长时间零派发的根因）。修法（本单落点，docs/17-§2 相位 2）：镜像对账扫描进
 *   决策候选——issues.list 全量每拍已取（相位 1 镜像 upsert 用），每 N 拍把非闭环
 *   （未 CLOSE）mirror 单补进候选重决策（source='mirror' 与活动源区分可归因；节流闸
 *   mirrorRescanEveryTicks，0=关）。
 *
 * 缺陷②（CLOSE 单复活封锁，2026-10-20 哨查：studio-dev-51/57 复活无效）：
 *   closed-set 由 CLOSE 事件派生且 append-only 不释放——平台侧复活（态改回流程态+
 *   评论，docs/49 复活令口径「复活均评论即可」）后单据仍被闭集拦在决策外。
 *   修法（本单落点，docs/17-§3 冻结词表）：复活一等语义——closed 单平台态离开终态
 *   （交付锚点）→ 落 RESUME 事件（词表内复活锚点；REOPEN 不在冻结词表，加名走
 *   SCHEMA_EVOLVE 批示流，不擅改契约）+ closed-set 释放（CLOSE 后有 RESUME 即出
 *   闭集——事件派生可重放，无第二份可变状态）。
 *
 * 断言面：
 *   1. 缺陷①负对照（rescan 关）：活动被消费+顺延 → 无新活动单永久搁置（缺陷机制存档；
 *      同时钉住节流闸真实可关——修法不得变成每拍全量扫）
 *   2. 缺陷①修法（rescan 开）：顺延单被救回、全链走到 CLOSE；救回派发经 mirror 源
 *      （决策条目 intentKey 可归因）
 *   3. 缺陷②修法：平台复活 → RESUME 落账（恰一次，幂等）+ attempt=2 重派 + 二轮
 *      全链再 CLOSE（work_records 双行）
 *   4. 缺陷②负断言：closed 单仅评论不离开终态 → 不复活（无 RESUME、不进决策——
 *      复活判定=离开终态，不是「有评论」）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../src/serve.ts'

/** 测试栈：每用例独立台账/平台/引擎（fake 全家桶 + tmp 库 + 假时钟） */
interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  /** 并发两闸（第三闸=泳道租约） */
  limits?: { maxActionsPerTick: number; maxInflight: number }
  /** 镜像对账重决策节流（DEV-42①；0=关——负对照/缺陷隔离用） */
  mirrorRescanEveryTicks?: number
}

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
      ...(opts?.limits !== undefined ? { limits: opts.limits } : {}),
      ...(opts?.mirrorRescanEveryTicks !== undefined
        ? { mirrorRescanEveryTicks: opts.mirrorRescanEveryTicks }
        : {}),
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, clock }
}

/** 建单+落泳道（三闸之泳道闸解耦——tick 限顺延才可复现） */
async function createTicket(
  stack: TestStack,
  title: string,
  lane?: string,
): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: 0 })
  if (lane !== undefined) await stack.platform.issues.setField(created.id, 'lane', lane)
  return created.id
}

/** 推拍到终局（每拍 1s；上限拍数内未到终局=断言面自会红） */
async function runTicks(stack: TestStack, n: number): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    reports.push(await stack.engine.tick())
  }
  return reports
}

/** 单据事件名序列（链路断言用） */
function eventsOf(ledger: Ledger, ticket: TicketId): string[] {
  return ledger.queryEvents({ issue: ticket }).map((e) => e.event)
}

/**
 * 单据事件的「按拍分组」序列：`<拍号>:<事件…>`（同拍内字典序）。
 * 台账 queryEvents 排序=ts,id——id 是 ULID（时间戳+随机尾），同拍多事件的相对序是
 * 随机平局，非契约面；断言按拍分组（拍间序稳定）+ 组内多重集，不赌同拍次序。
 */
function tickGroupsOf(ledger: Ledger, ticket: TicketId, t0: number): string[] {
  const groups = new Map<number, string[]>()
  for (const e of ledger.queryEvents({ issue: ticket })) {
    const tick = (e.ts - t0) / 1000
    groups.set(tick, [...(groups.get(tick) ?? []), e.event].sort())
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([tick, names]) => `${tick}:${names.join('>')}`)
}

/** L0 主链事件名序列（一轮完整走单——各事件分属不同拍，次序稳定） */
const FULL_CHAIN = ['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE']

let root = ''

/** 假时钟纪元（拍号=（ts-T0）/1000——tickGroupsOf 断言口径） */
const T0 = Date.UTC(2026, 9, 20, 0, 0, 0)

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-starvation-revival-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('缺陷①：候选积压饿死 → 镜像对账扫描重决策（DEV-42①）', () => {
  it('事故复现（负对照，rescan 关）：顺延单活动已被消费 → 此后每拍零候选决策，永久搁置在 新单', async () => {
    const stack = buildStack('starve-negative', {
      limits: { maxActionsPerTick: 1, maxInflight: 6 },
      mirrorRescanEveryTicks: 0,
    })
    const t1 = await createTicket(stack, '先派单', 'core')
    const t2 = await createTicket(stack, '被顺延单', 'qa')
    const t3 = await createTicket(stack, '被顺延单2', 'extra')

    const reports = await runTicks(stack, 13)
    // tick1：T-1 派发占满本拍动作额；T-2/T-3 顺延（HOLD_TICK_LIMIT——活动已被游标消费）
    const first = reports[0]
    expect(first.phases.dispatch.dispatched).toBe(1)
    expect(first.phases.stateDiff.decisions.find((d) => d.ticket === t1)?.code).toBe('DISPATCH')

    // 此后 12 拍：T-2/T-3 无新活动 → 不进候选 → 零决策零派发（饿死即事故本体）
    for (const r of reports.slice(1)) {
      expect(r.phases.stateDiff.decisions.some((d) => d.ticket === t2 || d.ticket === t3)).toBe(false)
      expect(r.actions.some((a) => a.ticket === t2 || a.ticket === t3)).toBe(false)
    }
    // T-1 独自走完全链；T-2/T-3 仍在 新单（零事件）
    expect(eventsOf(stack.ledger, t1)).toEqual(FULL_CHAIN)
    expect(eventsOf(stack.ledger, t2)).toEqual([])
    expect(eventsOf(stack.ledger, t3)).toEqual([])
    expect((await stack.platform.issues.get(t2)).state).toBe('新单')
    expect((await stack.platform.issues.get(t3)).state).toBe('新单')
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('修法（rescan 开）：节流拍把非闭环 mirror 单补进候选 → 顺延单被救回，三单全链走到 CLOSE；救回派发经 mirror 源可归因', async () => {
    const stack = buildStack('starve-rescue', {
      limits: { maxActionsPerTick: 1, maxInflight: 6 },
      mirrorRescanEveryTicks: 2,
    })
    const t1 = await createTicket(stack, '先派单', 'core')
    const t2 = await createTicket(stack, '被顺延单', 'qa')
    const t3 = await createTicket(stack, '被顺延单2', 'extra')

    const reports = await runTicks(stack, 40)

    // 三单全部闭环（救回=不再依赖「恰好有新活动」）
    expect(eventsOf(stack.ledger, t1)).toEqual(FULL_CHAIN)
    expect(eventsOf(stack.ledger, t2)).toEqual(FULL_CHAIN)
    expect(eventsOf(stack.ledger, t3)).toEqual(FULL_CHAIN)
    for (const t of [t1, t2, t3]) {
      expect((await stack.platform.issues.get(t)).state).toBe('已交付')
    }

    // 救回派发经 mirror 源（决策条目 intentKey 归因——与活动源 'activity' 区分）
    const rescueDispatch = reports
      .flatMap((r) => r.phases.stateDiff.decisions)
      .find((d) => (d.ticket === t2 || d.ticket === t3) && d.code === 'DISPATCH')
    expect(rescueDispatch?.intentKey.startsWith('mirror|ticket|demo|')).toBe(true)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('缺陷②：CLOSE 单复活封锁 → RESUME 一等语义 + closed-set 释放（DEV-42②）', () => {
  it('修法：平台复活（态回新单+评论）→ RESUME 落账恰一次 + attempt=2 重派 + 二轮全链再 CLOSE；复活后闭环仍生效', async () => {
    const stack = buildStack('revive-main', { mirrorRescanEveryTicks: 0 })
    const t1 = await createTicket(stack, '复活单', 'core')

    await runTicks(stack, 5)
    expect(eventsOf(stack.ledger, t1)).toEqual(FULL_CHAIN)
    expect((await stack.platform.issues.get(t1)).state).toBe('已交付')

    // 平台侧复活（docs/49 复活令口径：态改回流程态 + 评论留令痕）——引擎侧零提示
    await stack.platform.issues.transition(t1, '新单')
    await stack.platform.comments.add(t1, {
      author: 'admin',
      body: '复活：重开此单',
      signature: '[admin]',
    })

    const reports = await runTicks(stack, 10)
    // 事件链（按拍分组——同拍多事件次序是台账排序随机平局，非契约面）：一轮全链 →
    // 第 6 拍复活拍（RESUME 落账+attempt=2 重派同拍）→ 二轮全链
    expect(tickGroupsOf(stack.ledger, t1, T0)).toEqual([
      '1:DISPATCH',
      '2:GATE_PASS',
      '3:QA_PASS',
      '4:MERGE',
      '5:CLOSE',
      '6:DISPATCH>RESUME',
      '7:GATE_PASS',
      '8:QA_PASS',
      '9:MERGE',
      '10:CLOSE',
    ])
    const dispatches = stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    expect(dispatches[1]?.attempt).toBe(2)
    expect((await stack.platform.issues.get(t1)).state).toBe('已交付')

    // RESUME 恰一次（幂等：复活拍只落一次；二轮 CLOSE 后闭集重新生效——再推拍不复活）
    expect(stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'RESUME')).toHaveLength(1)
    expect(reports.slice(6).every((r) => !r.actions.some((a) => a.ticket === t1 && a.type === 'dispatch'))).toBe(true)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('负断言（rescan 每拍开也不救）：closed 单仅评论不离开终态 → 不复活——无 RESUME、不进决策', async () => {
    const stack = buildStack('revive-negative', { mirrorRescanEveryTicks: 1 })
    const t1 = await createTicket(stack, '已闭环单', 'core')

    await runTicks(stack, 5)
    expect(eventsOf(stack.ledger, t1)).toEqual(FULL_CHAIN)

    // 仅评论（态不动，仍在终态 已交付）——复活判定=离开终态，不是「有评论」
    await stack.platform.comments.add(t1, {
      author: 'admin',
      body: '问一句进度',
      signature: '[admin]',
    })

    const reports = await runTicks(stack, 3)
    expect(eventsOf(stack.ledger, t1)).toEqual(FULL_CHAIN)
    expect(reports.every((r) => !r.phases.stateDiff.decisions.some((d) => d.ticket === t1))).toBe(true)
    expect(reports.every((r) => r.actions.every((a) => a.ticket !== t1))).toBe(true)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
