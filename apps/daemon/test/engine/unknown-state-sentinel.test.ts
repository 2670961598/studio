/**
 * unknown-state-sentinel —— 未知态哨 + 状态集巡逻核（DEV-49 A4，docs/52-§十）。
 *
 * 防线分工：根治三步（@studio-next/taiga factory：默认态重指/存量归化/出厂态退役，
 * onboard 接线）治**存量与默认值**；引擎哨治**增量回流**——出厂态残留/平台侧手改/
 * 新模板重拷再进平台时，NOOP_UNKNOWN_STATE 静默链（14 单卡 2 小时的观察黑洞）之上
 * 叠一层账面告警（ESCALATE，词表既有名）。
 *
 * 断言面（docs/52-§10.2 表 A4 行）：
 *   1. 单级哨：流可解析而 state∉flowStates → 恰好一条 ESCALATE UNKNOWN_STATE
 *      （note 携 state/type/level）；每单每态一次（次拍不重告）；同单换新流外态=新键=
 *      再告一次；流内态/流不可解析单不告（NOOP_UNKNOWN_FLOW 归观测行面）
 *   2. 巡逻核：fields.schema() 状态集 − 有效流表声明集 ≠∅ → 心跳哨兵单每漂移状态名
 *      一条 ESCALATE UNKNOWN_STATUS；statusSetPatrolEveryTicks 节流（非巡逻拍零拉
 *      schema）；0=关；漂移治理后（schema 归零）不再告
 *   3. 哨计 mutations：有哨账的拍不落 HEARTBEAT（RESUME 同口径）
 *   4. TickReport 观测：collect.unknownStateAlarmed / collect.statusSetDrift 计数
 *   5. C2 双向漂移（studio-dev-126）：provision 声明面注入后——声明在档平台已无 →
 *      DECLARED_STATUS_MISSING（事前哨：建单/流转将吃 unknown-state 假红）；平台
 *      在位声明未收 → PLATFORM_STATUS_EXTRA；缺省不注入=面关零行为（面关负对照）。
 *   6. 州表卫生白名单（127-C，studio-dev-127 §4.7）：yt.known_foreign_states 白名单态
 *      → 单级哨降 FOREIGN_KNOWN 观察级（每单每态一次，独立键集；计 mutations 抑心跳）；
 *      巡逻核公式=平台状态集−(声明集∪白名单)=∅（白名单态不进漂移集）；**负对照**：
 *      未白名单新流外态仍 ESCALATE——白名单吞不掉新漂移；白名单面不触 C2 两哨
 *      （DECLARED_STATUS_MISSING/PLATFORM_STATUS_EXTRA 与白名单正交）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickReport } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../src/assembly/serve.ts'

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildStack(id: string, schemaStates?: string[], patrolEvery?: number, declared?: string[], known?: string[]): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 20, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({
    now: () => new Date(clock.now()).toISOString(),
    ...(schemaStates === undefined ? {} : { schemaStates }),
  })
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
      docRefs: ['docs/52-§十（出厂态根治）'],
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
      ...(patrolEvery === undefined ? {} : { statusSetPatrolEveryTicks: patrolEvery }),
      ...(declared === undefined ? {} : { provisionDeclaredStates: declared }),
      ...(known === undefined ? {} : { knownForeignStates: known }),
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, clock }
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-unknown-state-sentinel-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('单级哨：流外态 ESCALATE（每单每态一次）', () => {
  it('流外态单（New）落恰好一条 ESCALATE UNKNOWN_STATE；次拍不重告；换新流外态再告', async () => {
    const stack = buildStack('per-ticket')
    const a = await stack.platform.issues.create({ title: '出厂态单', type: 'task', level: 0, initialState: 'New' })
    const b = await stack.platform.issues.create({ title: '平台侧手改单', type: 'task', level: 0, initialState: 'In progress' })
    await stack.platform.issues.create({ title: '流内单（不告）', type: 'task', level: 0, initialState: '新单' })
    await stack.platform.issues.create({ title: '未定级单（哨不管：归 NOOP_UNKNOWN_FLOW 观测面）', type: 'task' })

    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.unknownStateAlarmed).toBe(2)
    const evA = stack.ledger.queryEvents({ issue: a.id })
    expect(evA).toHaveLength(1)
    expect(evA[0]).toMatchObject({ event: 'ESCALATE', issue: a.id })
    expect(evA[0]?.note).toBe('UNKNOWN_STATE;state=New;type=task;level=0')
    expect(stack.ledger.queryEvents({ issue: b.id })).toHaveLength(1)

    // 次拍：同单同态不重告（每单每态一次——事件派生键去重）
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.unknownStateAlarmed).toBe(0)
    expect(stack.ledger.queryEvents({ issue: a.id })).toHaveLength(1)

    // 同单换新流外态（平台侧手改成又一个出厂态）= 新键 = 再告一次
    await stack.platform.issues.transition(a.id, 'Done')
    stack.clock.advance(1000)
    const r3: TickReport = await stack.engine.tick()
    expect(r3.phases.collect.unknownStateAlarmed).toBe(1)
    const evA3 = stack.ledger.queryEvents({ issue: a.id })
    expect(evA3).toHaveLength(2)
    expect(evA3[1]?.note).toContain('UNKNOWN_STATE;state=Done')
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('哨计 mutations：有哨账的拍不落 HEARTBEAT（RESUME 同口径）', async () => {
    const stack = buildStack('heartbeat-suppress')
    await stack.platform.issues.create({ title: '流外态单', type: 'task', level: 0, initialState: 'New' })
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.unknownStateAlarmed).toBe(1)
    expect(r1.phases.account.heartbeat).toBe(false) // 哨账=机器动作（否则「零动作拍」心跳会掩盖哨事件）

    // 次拍哨去重 → 零动作拍恢复心跳
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.unknownStateAlarmed).toBe(0)
    expect(r2.phases.account.heartbeat).toBe(true)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('状态集巡逻核：schema 状态集 − 声明集 ≠∅ → 心跳哨兵单告警', () => {
  it('出厂态回流（schema 含 New/In progress）→ 每漂移状态名一条 ESCALATE UNKNOWN_STATUS；次巡逻拍不重告', async () => {
    const stack = buildStack('patrol-drift', ['新单', '已派发', '证据就绪', '复验通过', '已交付', 'New', 'In progress'], 1)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.statusSetDrift).toBe(2)
    const driftEvents = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')
    expect(driftEvents).toHaveLength(2)
    // 行格式：状态名 + 声明集基数（并集含 L1 待批等，基数以实现为准——正则断言不锁数值）
    expect(driftEvents.map((e) => e.note).sort()).toEqual([
      expect.stringMatching(/^UNKNOWN_STATUS;status=In progress;declared=\d+$/),
      expect.stringMatching(/^UNKNOWN_STATUS;status=New;declared=\d+$/),
    ])

    // 次巡逻拍：同漂移状态名不重告（每状态名一次）
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.statusSetDrift).toBe(0)
    expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')).toHaveLength(2)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('节流：statusSetPatrolEveryTicks=3 → 第 1/2 拍零 schema 拉取（非巡逻拍 statusSetDrift 恒 0 且不产事件）', async () => {
    let schemaCalls = 0
    const stack = buildStack('patrol-throttle', ['新单', '已派发', '证据就绪', '复验通过', '已交付', 'New'], 3)
    const origSchema = stack.platform.fields.schema.bind(stack.platform.fields)
    stack.platform.fields.schema = async (): Promise<ReturnType<typeof origSchema>> => {
      schemaCalls += 1
      return origSchema()
    }
    for (let i = 0; i < 7; i += 1) {
      stack.clock.advance(1000)
      const r: TickReport = await stack.engine.tick()
      if ((i + 1) % 3 !== 0) expect(r.phases.collect.statusSetDrift).toBe(0)
    }
    expect(schemaCalls).toBe(2) // 拍 3/6 各一次（拍 1/2/4/5/7 节流——schema 不白拉）
    expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')).toHaveLength(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('0=关：schema 有漂移也不告（负对照/测试隔离口径）', async () => {
    const stack = buildStack('patrol-off', ['新单', 'New'], 0)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.statusSetDrift).toBe(0)
    // 心跳哨兵单（'-'）上只可能有 HEARTBEAT（零动作拍例行），不得有 ESCALATE
    expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')).toHaveLength(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('C2 声明态漂移哨（studio-dev-126）：provision 声明面 × 平台真态双向比对', () => {
  const CLEAN = ['新单', '已派发', '证据就绪', '复验通过', '已交付'] // 与流表全等=零 UNKNOWN_STATUS 噪声

  it('声明在档、平台已无 → DECLARED_STATUS_MISSING；次巡逻拍不重告', async () => {
    const stack = buildStack('c2-missing', CLEAN, 1, [...CLEAN, '幽灵态'])
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.declaredStatusMissing).toBe(1)
    expect(r1.phases.collect.platformStatusExtra).toBe(0)
    const notes = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE').map((e) => e.note)
    expect(notes).toEqual(['DECLARED_STATUS_MISSING;status=幽灵态'])
    // 去重：次巡逻拍同名不重告
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.declaredStatusMissing).toBe(0)
    expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')).toHaveLength(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('平台在位、声明未收 → PLATFORM_STATUS_EXTRA（与 UNKNOWN_STATUS 流表面并存：两问两哨）', async () => {
    const stack = buildStack('c2-extra', [...CLEAN, '手加态'], 1, CLEAN)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.declaredStatusMissing).toBe(0)
    expect(r1.phases.collect.platformStatusExtra).toBe(1)
    const notes = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE').map((e) => e.note).sort()
    // 手加态两哨齐告：流表面（不可用）+ 声明面（provision 事实源不一致）——问的是两件事
    expect(notes).toEqual(['PLATFORM_STATUS_EXTRA;status=手加态', expect.stringMatching(/^UNKNOWN_STATUS;status=手加态;declared=\d+$/)])
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('面关负对照：不注入 declared（localfile/fake 部署形态）→ 双向计数恒 0、零新事件', async () => {
    const stack = buildStack('c2-off', [...CLEAN, '手加态'], 1) // 平台有额外态但不注入声明面
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.declaredStatusMissing).toBe(0)
    expect(r1.phases.collect.platformStatusExtra).toBe(0)
    // 流表面照常工作（既有行为零变化——只多了面关的两键恒 0）
    expect(r1.phases.collect.statusSetDrift).toBe(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('恰等收口：声明面=平台真态 → 双向计数恒 0（零漂移=收口正断言）', async () => {
    const stack = buildStack('c2-equal', CLEAN, 1, CLEAN)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.declaredStatusMissing).toBe(0)
    expect(r1.phases.collect.platformStatusExtra).toBe(0)
    expect(r1.phases.collect.statusSetDrift).toBe(0)
    expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE')).toHaveLength(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('127-C 州表卫生白名单（studio-dev-127 §4.7）：FOREIGN_KNOWN 观察级 + 巡逻核并集', () => {
  const KNOWN = ['New', 'In progress', 'Ready for test', 'Done', 'Archived'] // 六英文态子集（Ready 留作漂移负对照）

  it('白名单态单降 FOREIGN_KNOWN（每单每态一次、计 mutations 抑心跳）；ESCALATE 零新告', async () => {
    const stack = buildStack('whitelist-observe', undefined, undefined, undefined, KNOWN)
    const a = await stack.platform.issues.create({ title: '出厂态单', type: 'task', level: 0, initialState: 'New' })
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.foreignKnown).toBe(1)
    expect(r1.phases.collect.unknownStateAlarmed).toBe(0)
    const evA = stack.ledger.queryEvents({ issue: a.id })
    expect(evA).toHaveLength(1)
    expect(evA[0]).toMatchObject({ event: 'FOREIGN_KNOWN', issue: a.id })
    // note 与 UNKNOWN_STATE 同字段集（state/type/level——events-index noteField 派生同法）
    expect(evA[0]?.note).toBe('FOREIGN_KNOWN;state=New;type=task;level=0')
    // 观察级也计 mutations：有哨账的拍不落 HEARTBEAT
    expect(r1.phases.account.heartbeat).toBe(false)

    // 次拍：FOREIGN_KNOWN 键去重（每单每态一次——观察级不刷屏）
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.foreignKnown).toBe(0)
    expect(r2.phases.account.heartbeat).toBe(true)

    // 同单换新白名单态 = 新键 = 再观察一次（换非白名单态走 ESCALATE 见负对照用例）
    await stack.platform.issues.transition(a.id, 'Archived')
    stack.clock.advance(1000)
    const r3: TickReport = await stack.engine.tick()
    expect(r3.phases.collect.foreignKnown).toBe(1)
    expect(stack.ledger.queryEvents({ issue: a.id })).toHaveLength(2)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('负对照：未白名单新流外态仍 ESCALATE——白名单吞不掉新漂移', async () => {
    const stack = buildStack('whitelist-negative', undefined, undefined, undefined, KNOWN)
    const a = await stack.platform.issues.create({ title: '白名单态单', type: 'task', level: 0, initialState: 'New' })
    const b = await stack.platform.issues.create({ title: '新漂移单（不在白名单）', type: 'task', level: 0, initialState: 'Ready' })
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.foreignKnown).toBe(1) // New → 观察级
    expect(r1.phases.collect.unknownStateAlarmed).toBe(1) // Ready → 照旧告警
    expect(stack.ledger.queryEvents({ issue: a.id }).filter((e) => e.event === 'FOREIGN_KNOWN')).toHaveLength(1)
    const evB = stack.ledger.queryEvents({ issue: b.id })
    expect(evB).toHaveLength(1)
    expect(evB[0]?.event).toBe('ESCALATE')
    expect(evB[0]?.note).toBe('UNKNOWN_STATE;state=Ready;type=task;level=0')
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('巡逻核并集吸收：schema 白名单态不进漂移集；未白名单出厂态照旧告', async () => {
    // schema 含五公司态 + New/In progress（白名单）+ Ready（未白名单）→ 漂移仅 Ready
    const stack = buildStack('whitelist-patrol', ['新单', '已派发', '证据就绪', '复验通过', '已交付', 'New', 'In progress', 'Ready'], 1, undefined, KNOWN)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.statusSetDrift).toBe(1)
    const notes = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE').map((e) => e.note)
    expect(notes).toEqual([expect.stringMatching(/^UNKNOWN_STATUS;status=Ready;declared=\d+$/)])

    // 次巡逻拍：漂移键去重保持（并集吸收不改变每状态名一次语义）
    stack.clock.advance(1000)
    const r2: TickReport = await stack.engine.tick()
    expect(r2.phases.collect.statusSetDrift).toBe(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('白名单面不触 C2 两哨：声明面漂移照常双向告（两问两哨正交）', async () => {
    const stack = buildStack('whitelist-c2-orthogonal', ['新单', '已派发', '证据就绪', '复验通过', '已交付', 'New'], 1, ['新单', '已派发', '证据就绪', '复验通过', '已交付'], KNOWN)
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    // New 白名单吸收 → 巡逻核漂移 0；但声明面平台额外向（New 在平台不在声明面）照告
    expect(r1.phases.collect.statusSetDrift).toBe(0)
    expect(r1.phases.collect.platformStatusExtra).toBe(1)
    const notes = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'ESCALATE').map((e) => e.note)
    expect(notes).toEqual(['PLATFORM_STATUS_EXTRA;status=New'])
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('面关负对照：不注入白名单（缺省）→ 哨兵现状全灵敏度零变化（既有用例已锁，此处锁计数位）', async () => {
    const stack = buildStack('whitelist-off')
    await stack.platform.issues.create({ title: '出厂态单', type: 'task', level: 0, initialState: 'New' })
    stack.clock.advance(1000)
    const r1: TickReport = await stack.engine.tick()
    expect(r1.phases.collect.foreignKnown).toBe(0)
    expect(r1.phases.collect.unknownStateAlarmed).toBe(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
