/**
 * breaker-half-open —— DEV-46 断路器半开重试回归（红→绿纪律：先红证后修法）
 *
 * 缺陷（2026-10-20 实证 studio-dev-78）：断路器无半开态——GLM 外部限速 4 连击熔断后
 * HOLD_BREAKER_OPEN 永久压制重派；复位唯一路径=成功信号（onSuccess），而被压制即无
 * 派发、无派发即无成功——**永久死锁**（bug 单等人修，原单永不可自愈）。
 *
 * 修法（本单落点，docs/17-§6 半开语义修订稿）：熔断后冷却窗（拟稿 30min，
 * config.breakerCooldownMs 可配）过 → 放行一次试探派发（半开）——
 *   - 试探成功 = GATE_PASS → onSuccess 复位（BREAKER_RESET 语义），单走正常链；
 *   - 试探失败 = 回全开续冷却（trippedAt 刷新），bug 单不重开。
 *
 * 红证剧本（本文件）：
 *   1. 外部错误注入熔断：fake adapter external_error 形态（turn_end.completed=false +
 *      error=429——GLM 限速同型）三轮 → ESCALATE 恰一次 + bug 单开出；
 *   2. 冷却窗内：HOLD_BREAKER_OPEN 压制（无 att4）——与旧语义一致（回归锚）；
 *   3. 冷却窗过：**半开试探发生**（DISPATCH attempt=4，note 携 half-open-probe 锚）
 *      ——旧代码此处死锁（恒 HOLD，永无第 4 次派发），即本测试的红点；
 *   4a. 试探成功：GATE_PASS → 断路复位 → 单走全链 CLOSE（死锁解除的终局证明）；
 *   4b. 试探失败（外部限速未解）：回全开续冷却——新冷却窗内再压制、窗过再试探，
 *       ESCALATE 仍恰一次（bug 单不重开）。
 */
import { rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../src/fakes.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'

const T0 = Date.parse('2026-10-16T00:00:00.000Z')
/** 测试用短冷却窗（5min——语义同产线 30min 缺省，只缩时长；DEV-46 拟稿可配面） */
const COOLDOWN_MS = 5 * 60_000

/** 手搓公司快照（serve.ts DEMO_SNAPSHOT 同形——本文件只测断路半开面） */
const SNAPSHOT: CompanySnapshot = {
  slug: 'half-open-corp',
  name: '半开回归公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

interface Stack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

/** 确定性 ULID（contract UlidSchema 合法形） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

function buildStack(id: string, mode: () => FakeAdapterMode): Stack {
  const rootDir = path.join(root, id)
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode, name: 'fake' }), { default: true })
  const person = SNAPSHOT.people[0] as PersonRef
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: SNAPSHOT.slug,
      rootDir,
      defaultPersonId: person.id,
      deptFallback: SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
      defaultLane: SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      breakerCooldownMs: COOLDOWN_MS,
      // DEV-42① 重决策节流=1：断路压制的单无状态迁移即无新活动——HOLD 拍把最后一波
      // GATE_FAIL 活动消费掉后，候选只能靠 mirror 重扫描回补（产线缺省 30 拍回补一次；
      // 本测缩到每拍，保证「冷却窗一过、下一拍即试探」的断言不被扫描节流噪声干扰）
      mirrorRescanEveryTicks: 1,
    },
    people: SNAPSHOT.people,
    makeId: deterministicIds(),
  })
  return { platform, ledger, engine, clock }
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-half-open-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function eventsOf(ledger: Ledger, ticket: string): string[] {
  return ledger.queryEvents({ issue: ticket }).map((e) => e.event)
}

function countOf(ledger: Ledger, ticket: string, event: string): number {
  return eventsOf(ledger, ticket).filter((n) => n === event).length
}

function decisionOf(report: TickReport, ticket: string): string | undefined {
  return report.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code
}

/** 三轮「派发→收割失败」喂满断路器（同签名 harvest:-o-r-g 三连击 → 熔断） */
async function tripOnExternalErrors(stack: Stack): Promise<void> {
  for (let round = 1; round <= 3; round += 1) {
    stack.clock.advance(1000)
    const dispatchTick = await stack.engine.tick()
    expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
    expect((await stack.platform.issues.get('T-1')).state).toBe('已派发')

    stack.clock.advance(1000)
    const harvestTick = await stack.engine.tick()
    expect(harvestTick.phases.harvest.failed).toBe(1)
    // 外部错误如实落账：GATE_FAIL note 折 turn_end.error（429 限速文本——分类面证据）
    const gateFail = stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'GATE_FAIL')[round - 1]
    expect(gateFail?.note).toContain('turn_end.error=上游模型服务限速（HTTP 429')
    expect((await stack.platform.issues.get('T-1')).state).toBe('新单')
  }
  // 熔断恰一次：ESCALATE + bug 单（与旧语义一致的回归锚）
  expect(countOf(stack.ledger, 'T-1', 'ESCALATE')).toBe(1)
  const bugs = (await stack.platform.issues.list({})).filter((i) => i.type === 'bug')
  expect(bugs).toHaveLength(1)
}

describe('半开试探成功路：外部错误熔断 → 冷却 → 试探 → GATE_PASS 复位 → 全链 CLOSE（死锁解除）', () => {
  let stack: Stack
  let mode: FakeAdapterMode = 'external_error'

  beforeAll(() => {
    stack = buildStack('probe-success', () => mode)
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('外部错误 429 三连击 → 熔断（ESCALATE 恰一次 + bug 单）', async () => {
    await stack.platform.issues.create({ title: '外部限速单（半开成功路）', type: 'task', level: 0 })
    await tripOnExternalErrors(stack)
  })

  it('冷却窗内：HOLD_BREAKER_OPEN 压制（无第 4 次派发——旧语义回归锚）', async () => {
    stack.clock.advance(1000)
    const held = await stack.engine.tick()
    expect(decisionOf(held, 'T-1')).toBe('HOLD_BREAKER_OPEN')
    expect(countOf(stack.ledger, 'T-1', 'DISPATCH')).toBe(3)
  })

  it('红点：冷却窗过 → 半开试探发生（DISPATCH attempt=4，note 携 half-open-probe 锚）', async () => {
    mode = 'ok' // 冷却窗内外部限速已解（429 风暴过境）——试探誓全要件真
    stack.clock.advance(COOLDOWN_MS + 1000)
    const probeTick = await stack.engine.tick()
    expect(probeTick.phases.dispatch.dispatched).toBe(1)
    const dispatches = stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(4)
    expect(dispatches[3]?.attempt).toBe(4)
    expect(dispatches[3]?.note).toContain('breaker=half-open-probe')
    expect((await stack.platform.issues.get('T-1')).state).toBe('已派发')
  })

  it('试探成功：GATE_PASS → 断路复位 → 全链收口 CLOSE（无 ESCALATE 增量）', async () => {
    stack.clock.advance(1000)
    const passTick = await stack.engine.tick()
    expect(passTick.phases.harvest.completed).toBe(1)
    expect(eventsOf(stack.ledger, 'T-1')).toContain('GATE_PASS')

    // 断路已复位：后续拍无 HOLD_BREAKER_OPEN，单走完 QA→MERGE→CLOSE
    for (let i = 0; i < 4; i += 1) {
      stack.clock.advance(1000)
      await stack.engine.tick()
    }
    expect(eventsOf(stack.ledger, 'T-1')).toEqual([
      'DISPATCH', 'GATE_FAIL', 'DISPATCH', 'GATE_FAIL', 'DISPATCH', 'GATE_FAIL', 'ESCALATE',
      'DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE',
    ])
    expect(countOf(stack.ledger, 'T-1', 'ESCALATE')).toBe(1) // 复位不是再熔断——bug 单不重开
  })
})

describe('半开试探失败路：外部限速未解 → 试探失败回全开续冷却 → 窗过再试探（ESCALATE 仍恰一次）', () => {
  let stack: Stack

  beforeAll(() => {
    stack = buildStack('probe-retry', () => 'external_error') // 恒外部限速：试探也失败
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('熔断 → 窗过 → 首次试探（attempt=4）失败：回全开', async () => {
    await stack.platform.issues.create({ title: '外部限速单（半开失败路）', type: 'task', level: 0 })
    await tripOnExternalErrors(stack)

    stack.clock.advance(COOLDOWN_MS + 1000)
    const probeTick = await stack.engine.tick()
    expect(probeTick.phases.dispatch.dispatched).toBe(1)
    expect(countOf(stack.ledger, 'T-1', 'DISPATCH')).toBe(4)

    stack.clock.advance(1000)
    const failTick = await stack.engine.tick()
    expect(failTick.phases.harvest.failed).toBe(1)
    // 试探失败不重开 bug 单（熔断事实已有 bug 在册——只刷新冷却窗）
    expect(countOf(stack.ledger, 'T-1', 'ESCALATE')).toBe(1)
  })

  it('新冷却窗内：再压制（trippedAt 已刷新——无第 5 次派发）', async () => {
    stack.clock.advance(COOLDOWN_MS - 60_000) // 窗过 4/5：未足
    const held = await stack.engine.tick()
    expect(decisionOf(held, 'T-1')).toBe('HOLD_BREAKER_OPEN')
    expect(countOf(stack.ledger, 'T-1', 'DISPATCH')).toBe(4)
  })

  it('新冷却窗过：再次试探（attempt=5）——半开循环不放弃、也不风暴', async () => {
    stack.clock.advance(60_000 + 1000) // 补足剩余窗+ε
    const probeTick = await stack.engine.tick()
    expect(probeTick.phases.dispatch.dispatched).toBe(1)
    const dispatches = stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(5)
    expect(dispatches[4]?.attempt).toBe(5)
    expect(dispatches[4]?.note).toContain('breaker=half-open-probe')
  })
})
