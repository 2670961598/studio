/**
 * cost-threshold 消费端到端（129-D·studio-dev-181；129-§6.1② 分类学/§6.3 P0-B 验收样板）。
 *
 * 链路：cost-threshold 源（132-C·studio-dev-177）产 escalate 意图 → engine.ingest →
 * tick 消费分发（escalate 行，129-D 开闸）→ 警戒处置单物化（assignee=缺省路由 target、
 * lane=缺省路由 lane）+ PATROL 留痕 + todo_queue 投影（129-B 收件箱面，priority=3 队首）。
 *
 * 断言面（src/engine/intents/escalate.ts 实现单口径逐条钉死）：
 *   1. P0-B 验收样板：预算实际值达 warn 档 → 第二拍 HF-1 收件箱队首出现警戒处置单
 *      （rankQueue 同序：priority 3 vs 预置单 0；零手工派单）；
 *   2. 四档接线矩阵（132-§6.4）：watch/notify→出口不物化｜warn/dispatch→物化｜
 *      alarm/dispatch+notify→双动作｜hard/gate→只留痕（闸四 refusal 联动归 132-C）；
 *   3. 同拍多醒：公司档+人档各按 dedupKey 独立消费（意图幂等键走无单意图 dedupKey 路径
 *      ——129-D 修：心跳哨兵 '-' 不再冒充 ticket 挤成共用键）；
 *   4. 幂等：同 key 百次重投恒只一张警戒处置单（引擎 patrolKeys × 源 at-least-once）；
 *   5. fail-closed：dedupKey≠公式 / 档位不在 route 表 / 段未声明 / target 未配 /
 *      target 不在人事索引 / route 非冻结词表 / sla 类 payload——全明报拒收不静默。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { rankQueue, type QueueEntryRank } from '@studio-next/core'
import type { CompanySnapshot, CostGuardConfig, DeptNode, EventRecord, InvokeIntent, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { COST_THRESHOLD_SOURCE_NAME, createCostThresholdSource } from '../../../src/engine/cost-guard/source.ts'
import { costThresholdKey, type CostThresholdNotice } from '../../../src/engine/intents/escalate.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sn-129d-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const T0 = new Date(2026, 9, 23, 10, 0, 0, 0).getTime() // 2026-10-23 10:00 本地
const DAY = '2026-10-23'
const DEPT_HF = 'departments/综合部'
const DEPT_ENG = 'departments/研发部'

/** 四档全开（132-§6.4 同型）；perPersonDefault=50 → 人档不干扰公司档样板（21/50=42%<watch） */
const GUARD: CostGuardConfig = {
  dailyBudgetUsd: { company: 25, perPersonDefault: 50 },
  alertTiers: [
    { tier: 'watch', atPct: 50, route: 'notify' },
    { tier: 'warn', atPct: 80, route: 'dispatch' },
    { tier: 'alarm', atPct: 100, route: 'dispatch+notify' },
    { tier: 'hard', atPct: 120, route: 'gate' },
  ],
}

const PEOPLE: readonly PersonRef[] = [
  { id: 'HF-1', name: '财务一号', dept: DEPT_HF, level: 1, role: '财务' },
  { id: 'ENG-1', name: '程序一号', dept: DEPT_ENG, level: 2, role: '程序' },
]

const DEPTS: readonly DeptNode[] = [
  { name: '综合部', path: DEPT_HF, parent: null, leader: 'PRIME-0', level: 1, lanes: ['ops'], functions: [], relations: [] },
  { name: '研发部', path: DEPT_ENG, parent: null, leader: 'PRIME-0', level: 1, lanes: ['core'], functions: [], relations: [] },
]

const SNAPSHOT: CompanySnapshot = { ...DEMO_SNAPSHOT, people: PEOPLE, departments: DEPTS }

/** E2E 栈：引擎（缺省路由注入+freezeQueue）+ notify 出口收集面 */
interface E2EStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  notices: CostThresholdNotice[]
  /** 直灌意图（消费分发面单测用——不经源） */
  ingest(intent: InvokeIntent): void
  mkIntent(tier: string, over?: IntentOver): InvokeIntent
  close(): void
}
interface IntentOver {
  route?: string
  target?: string
  dedupKey?: string
  payload?: unknown
  facts?: Record<string, unknown>
}

function buildStack(id: string, opts?: { target?: string | null; lane?: string | null; guard?: CostGuardConfig | null; notify?: boolean }): E2EStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const notices: CostThresholdNotice[] = []
  const target = opts?.target === undefined ? 'HF-1' : opts.target // null=不注入（fail-closed 面）
  const lane = opts?.lane === undefined ? 'ops' : opts.lane
  const guard = opts?.guard === undefined ? GUARD : opts.guard // null=段未声明
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/22-§二（内置唤起源）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    people: PEOPLE,
    departments: DEPTS,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, id),
      defaultPersonId: 'HF-1',
      deptFallback: DEPT_HF,
      defaultLane: 'ops',
      // freezeQueue：每拍动作上限 0——警戒单定格在新单位（收件箱投影可见面）+ 镜像
      // 重扫每拍（新单镜像入表）；派发链行为面已由 129-A e2e 覆盖，本测断言的是
      // 「财务收件箱队首出现警戒处置单」样板
      limits: { ...ENGINE_CONFIG_DEFAULTS.limits, maxActionsPerTick: 0 },
      mirrorRescanEveryTicks: 1,
      ...(target !== null ? { costThresholdTarget: target } : {}),
      ...(lane !== null ? { costThresholdLane: lane } : {}),
    },
    // cost_guard 段（132-C 配置源）：消费位档位 route 解析源；null=段未声明
    ...(guard !== null ? { costGuard: guard } : {}),
    // notify 出口（刀B 登记位）：收集面断言（v0 serve 接 log——同构注入）
    ...(opts?.notify === false ? {} : { notify: (n: CostThresholdNotice): void => { notices.push(n) } }),
  })
  const mkIntent = (tier: string, over?: IntentOver): InvokeIntent => {
    const facts = over?.facts ?? {
      scope: 'company', period: `day:${DAY}`, tier,
      running_usd: 21, budget_usd: 25, pct: 84,
      top_consumers: [{ person: 'ENG-1', model: 'deepseek/deepseek-flash', usd: 21 }],
      price_snapshot_ref: 'deepseek/deepseek-flash@ps-test', stale_flag: false,
    }
    const payload: Record<string, unknown> = { class: 'cost-threshold', facts }
    if (over?.route !== undefined) payload.route = over.route
    if (over?.target !== undefined) payload.target = over.target
    return {
      kind: 'escalate', company: 'demo',
      source: COST_THRESHOLD_SOURCE_NAME,
      dedupKey: over?.dedupKey ?? costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier }),
      priority: 3,
      payload: over?.payload ?? payload,
    }
  }
  return {
    platform, ledger, engine, clock, notices,
    ingest: (intent): void => { engine.ingest([intent]) },
    mkIntent,
    close: (): void => { ledger.close() },
  }
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

/** 当日价快照 + 用量格（1M in + 1M out × $0.3/$1.2 = $1.5/格）——source.test 同型语料 */
function seed(ledger: Ledger, personId: string, runs: number): void {
  ledger.appendPriceSnapshot({
    id: `ps-${makeUlid(T0 - 60_000)}`, company: 'demo', provider: 'deepseek', model: 'deepseek-flash',
    price_date: DAY, input_per_m: 0.3, output_per_m: 1.2, cache_read_per_m: 0.006, cache_creation_per_m: 0.3,
    source_note: '测试语料', source_ticket: 'STUDIO-181', published_by: 'TEST',
  })
  for (let i = 0; i < runs; i += 1) {
    ledger.upsertUsageDaily({
      id: makeUlid(T0 + i), company: 'demo', person_id: personId, model: 'deepseek/deepseek-flash',
      usage_date: DAY, tokens: { input: 1_000_000, output: 1_000_000, cache_read: 0, cache_creation: 0 },
      first_ts: T0, last_ts: T0 + i, updated_at: T0 + i,
    })
  }
}

/** 源泵：poll 产物直灌引擎（serve 同链——emit 统一进 ingest）；guard 缺省=栈同款四档 */
function pump(s: E2EStack, guard: CostGuardConfig = GUARD): { fired: number; intents: InvokeIntent[] } {
  const src = createCostThresholdSource({
    ledger: s.ledger, clock: s.clock.now, company: 'demo', guard: () => guard,
    people: () => PEOPLE, deptFallback: DEPT_ENG, heartbeatIssue: '-', intervalMs: 60_000,
  })
  const intents: InvokeIntent[] = []
  const r = src.poll((i) => { intents.push(i); s.ingest(i) })
  return { fired: r.fired, intents }
}

// ————————————————————————— 1. P0-B 验收样板：warn 档 → 财务收件箱队首 —————————————————————————

describe('P0-B 端到端：公司预算达 warn 档 → HF-1 收件箱队首出现警戒处置单（零手工派单）', () => {
  it('源→意图→消费物化（assignee/lane/留痕）→ 第二拍投影 priority=3 队首', async () => {
    const s = buildStack('s7-warn')
    seed(s.ledger, 'ENG-1', 14) // $21/25 = 84% → warn（dispatch）；人档 21/50=42% 不达 watch
    // 预置低优单（HF-1 收件箱先在——队首对照面）：priority 0，FIFO 锚更早
    await s.platform.issues.create({ title: '[日常] 例会纪要归档', type: 'task', level: 0, assignee: 'HF-1', dept: DEPT_HF })

    const { fired } = pump(s)
    expect(fired).toBe(1) // 仅公司 warn 一醒

    const tick1 = await s.engine.tick()
    expect(tick1.errors).toEqual([])

    // 警戒处置单（P0-B 物化元组）：[警戒] 标题、assignee=缺省路由 target、lane=缺省路由 lane
    const alerts = (await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.assignee).toBe('HF-1')
    expect(alerts[0]?.title).toContain('company warn（84%）')
    expect(alerts[0]?.dept).toBe(DEPT_HF)
    const full = await s.platform.issues.get(alerts[0]!.id)
    expect(full.lane).toBe('ops')
    const warnKey = costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'warn' })
    expect(alerts[0]?.description).toContain(`幂等键：${warnKey}`) // 溯源（铁律2 幂等锚）

    // PATROL 留痕：intent=<源|kind|公司|dedupKey>（无单意图 dedupKey 路径）+ route 落位
    const patrols = eventsOf(s.ledger, 'PATROL').filter((p) => (p.note ?? '').includes('route=dispatch'))
    expect(patrols.some((p) => (p.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${warnKey}`))).toBe(true)

    // ESCALATE 落账（132-C 源侧）与消费同拍共存
    expect(eventsOf(s.ledger, 'ESCALATE').some((e) => (e.note ?? '').includes('scope=company'))).toBe(true)

    // 第二拍：镜像重扫入表 → 相位尾投影落 todo_queue 行（129-B 收件箱面）
    await s.engine.tick()
    const rows = s.ledger.listTodoQueue().filter((r) => r.person === 'HF-1')
    const alertRow = rows.find((r) => r.ticket === alerts[0]?.id)
    const preRow = rows.find((r) => r.ticket !== alerts[0]?.id)
    expect(alertRow).toBeDefined()
    expect(alertRow?.priority).toBe(3) // 消费位登记峰值，成员资格落地拍并入携带峰（P0-B「priority=3 置顶」）
    expect(preRow !== undefined && preRow.priority < 3).toBe(true) // 对照组：常规单（重扫意图常规优）低于警戒峰
    // 队首断言（rankQueue 同序——引擎排序件原函数）：priority 3 压过 FIFO 更早的低优单
    const ranked = rankQueue(rows.map((r): QueueEntryRank => ({
      ticket: r.ticket, priority: r.priority, pinned: r.pinned === 1, firstSeenAt: r.first_seen_at, boostTier: r.boost_tier,
    })))
    expect(ranked[0]?.ticket).toBe(alerts[0]?.id)
    s.close()
  })

  it('幂等双层：同 key 百次重投恒只一张警戒处置单（引擎 patrolKeys × 源 firedKeys）', async () => {
    const s = buildStack('s7-idem')
    seed(s.ledger, 'ENG-1', 14)
    pump(s)
    await s.engine.tick()
    const alert = (await s.platform.issues.list({})).find((i) => i.title.startsWith('[警戒]'))
    expect(alert).toBeDefined()

    // 同 key 同 payload 重投 ×100（源 at-least-once + 集群面重放）→ 消费面恰好一次
    const replay = s.mkIntent('warn')
    for (let i = 0; i < 100; i += 1) s.ingest(replay)
    const tick2 = await s.engine.tick()
    expect(tick2.errors).toEqual([])
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(1)

    // 源侧百次重扫零重告（firedKeys/ESCALATE note 派生——132-C 面不回归）
    const intents: InvokeIntent[] = []
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock.now, company: 'demo', guard: () => GUARD,
      people: () => PEOPLE, deptFallback: DEPT_ENG, heartbeatIssue: '-', intervalMs: 60_000,
    })
    for (let i = 0; i < 100; i += 1) src.poll((x) => intents.push(x))
    expect(intents).toHaveLength(0)
    s.close()
  })
})

// ————————————————————————— 2. 同拍多醒：公司档+人档独立消费 —————————————————————————

describe('同拍多醒：意图幂等键按 dedupKey 分立（129-D 修——哨兵单不冒充 ticket）', () => {
  it('公司 warn + 人档 hard 同拍两醒各按 route 消费：dispatch 物化｜gate 只留痕', async () => {
    const s = buildStack('multi', { guard: { ...GUARD, dailyBudgetUsd: { company: 25, perPersonDefault: 8 } } })
    seed(s.ledger, 'ENG-1', 14) // 公司 $21=84% warn；人档 $21/8=262% hard
    const { fired } = pump(s, { ...GUARD, dailyBudgetUsd: { company: 25, perPersonDefault: 8 } })
    expect(fired).toBe(2)

    const tick1 = await s.engine.tick()
    expect(tick1.errors).toEqual([])

    // 公司 warn（dispatch）→ 物化；人档 hard（gate）→ 不物化只留痕
    const alerts = (await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.title).toContain('company warn')
    const personKey = costThresholdKey({ scope: 'person:ENG-1', period: `day:${DAY}`, tier: 'hard' })
    const gatePatrol = eventsOf(s.ledger, 'PATROL').find((p) => (p.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${personKey}`))
    expect(gatePatrol).toBeDefined()
    expect(gatePatrol?.note).toContain('route=gate')
    s.close()
  })
})

// ————————————————————————— 3. 四档接线矩阵（132-§6.4） —————————————————————————

describe('四档接线：watch/notify｜warn/dispatch｜alarm/dispatch+notify｜hard/gate', () => {
  it('watch（notify）：不物化、notify 出口一告、PATROL 挂哨兵留痕', async () => {
    const s = buildStack('m-watch')
    s.ingest(s.mkIntent('watch'))
    const t1 = await s.engine.tick()
    expect(t1.errors).toEqual([])
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    expect(s.notices).toHaveLength(1)
    expect(s.notices[0]).toMatchObject({ tier: 'watch', route: 'notify', target: 'HF-1', scope: 'company', pct: 84 })
    const key = costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'watch' })
    const p = eventsOf(s.ledger, 'PATROL').find((e) => (e.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${key}`))
    expect(p?.issue).toBe('-') // 留痕锚=心跳哨兵单（不物化口径）
    expect(p?.note).toContain('route=notify')
    expect(p?.note).toContain('notify=已发出口')
    s.close()
  })

  it('alarm（dispatch+notify）：物化 + 出口双动作', async () => {
    const s = buildStack('m-alarm')
    s.ingest(s.mkIntent('alarm'))
    const t1 = await s.engine.tick()
    expect(t1.errors).toEqual([])
    const alerts = (await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.title).toContain('company alarm')
    expect(s.notices).toHaveLength(1)
    expect(s.notices[0]?.route).toBe('dispatch+notify')
    const key = costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'alarm' })
    const p = eventsOf(s.ledger, 'PATROL').find((e) => (e.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${key}`))
    expect(p?.issue).toBe(alerts[0]?.id) // 物化口径：留痕锚=警戒处置单
    expect(p?.note).toContain('notify=已发出口')
    s.close()
  })

  it('hard（gate）：不物化不出声——闸四 refusal 联动归 132-C 派发闸，本刀只留痕', async () => {
    const s = buildStack('m-hard')
    s.ingest(s.mkIntent('hard'))
    const t1 = await s.engine.tick()
    expect(t1.errors).toEqual([])
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    expect(s.notices).toHaveLength(0)
    const key = costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'hard' })
    const p = eventsOf(s.ledger, 'PATROL').find((e) => (e.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${key}`))
    expect(p).toBeDefined()
    expect(p?.issue).toBe('-')
    expect(p?.note).toContain('route=gate')
    s.close()
  })

  it('notify 出口未接线（刀B 前夜）：dispatch 档不因出口缺失断链——留痕如实标未接线', async () => {
    const s = buildStack('m-nowire', { notify: false })
    s.ingest(s.mkIntent('watch'))
    const t1 = await s.engine.tick()
    expect(t1.errors).toEqual([]) // 出口缺失≠错误（v0 登记位；刀B 接线后天然有声）
    expect(s.notices).toHaveLength(0)
    const key = costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'watch' })
    const p = eventsOf(s.ledger, 'PATROL').find((e) => (e.note ?? '').includes(`intent=${COST_THRESHOLD_SOURCE_NAME}|escalate|demo|${key}`))
    expect(p?.note).toContain('notify=未接线')
    s.close()
  })
})

// ————————————————————————— 4. fail-closed 判负线（明报拒收不静默） —————————————————————————

describe('fail-closed：判负全明报（error 落拍报告——不静默吞）', () => {
  it('sla 类 payload（无 class 字段）→ class 级明报丢弃（v0 只开 cost-threshold）', async () => {
    const s = buildStack('f-sla')
    s.ingest({
      kind: 'escalate', company: 'demo', ticket: 'T-1', source: 'sla',
      dedupKey: 'sla:T-1:ack', priority: 3,
      payload: { ticket: 'T-1', job_id: 'ops', after_ms: 900_000, kind: 'first-ack' },
    })
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('escalate 意图 payload 形状不符')
    expect(t1.errors.join('\n')).toContain("class 'undefined' 不支持")
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    s.close()
  })

  it('dedupKey≠公式（铁律2 断言面）→ 明报拒收', async () => {
    const s = buildStack('f-key')
    s.ingest(s.mkIntent('warn', { dedupKey: 'cost:company:day:2026-01-01:warn' }))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('dedupKey≠警戒键')
    s.close()
  })

  it('档位不在 route 表（facts.tier 无配置行）→ 无 route 明报', async () => {
    const s = buildStack('f-tier')
    s.ingest(s.mkIntent('critical'))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain("警戒档 'critical' 无 route")
    s.close()
  })

  it('cost_guard 段未声明 → 无 route（面关不误物化）', async () => {
    const s = buildStack('f-noseg', { guard: null })
    s.ingest(s.mkIntent('watch'))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('段未声明')
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    s.close()
  })

  it('target 全缺（payload 无 target + config 未配）→ 无指派目标明报', async () => {
    const s = buildStack('f-notarget', { target: null })
    s.ingest(s.mkIntent('warn'))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('无指派目标')
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    s.close()
  })

  it('payload.target 指认不在册（无人事索引兜底——不 defaultPersonId 误投）', async () => {
    const s = buildStack('f-ghost')
    s.ingest(s.mkIntent('warn', { target: 'GHOST-9' }))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('指派目标 GHOST-9 不在人事索引')
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    s.close()
  })

  it('payload.route 非冻结词表 → 形状不符明报', async () => {
    const s = buildStack('f-route')
    s.ingest(s.mkIntent('warn', { route: 'sms' }))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain("route 'sms' 不在冻结词表")
    s.close()
  })

  it('facts 字段残缺（pct 非数）→ 形状不符明报', async () => {
    const s = buildStack('f-facts')
    s.ingest(s.mkIntent('warn', { facts: { scope: 'company', period: `day:${DAY}`, tier: 'warn', pct: '84%' } }))
    const t1 = await s.engine.tick()
    expect(t1.errors.join('\n')).toContain('escalate 意图 payload 形状不符')
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[警戒]'))).toHaveLength(0)
    s.close()
  })
})

// ————————————————————————— 5. 公式单源（铁律2） —————————————————————————

describe('costThresholdKey 单源公式（源/消费/断言面同引）', () => {
  it('公式即冻结口径：cost:<scope>:<period>:<tier>', () => {
    expect(costThresholdKey({ scope: 'company', period: `day:${DAY}`, tier: 'warn' })).toBe(`cost:company:day:${DAY}:warn`)
    expect(costThresholdKey({ scope: 'person:ENG-1', period: `day:${DAY}`, tier: 'hard' })).toBe(`cost:person:ENG-1:day:${DAY}:hard`)
  })
})
