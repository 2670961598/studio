/**
 * cost-guard 收割缝与人日硬线接线测试（132-§6.4 单C·studio-dev-177；
 * docs/17-§6 四要件冻结口径不动——缝件只增不改）
 *
 * 断言面（src/engine/cost-guard/{harvest,fold}.ts + engine.ts 缝行）：
 *   1. foldHarvestCost 四路（R4 即时折算）：native>0 自报为尊 / snapshot 快照折算+
 *      锚留痕 / models-yaml 兜底 / unpriced 按 0 计如实留痕（无模型/无当日价两形）；
 *   2. 收割缝端到端（fake adapter model+usage 注入）：GATE_PASS note 后缀
 *      `;cost=basis=native;usage=daily ok` + work_records.cost_usd + settle 双行
 *      actual 三面同值 + usage_daily write-through 一格（人×模型×本地日）；
 *   3. skip 面：model 缺席=不投影（132-A 冻结口径）——`;usage=daily skip` + 零行；
 *   4. 人日硬线联动（R6）：今日已结实际超 hard 线 → 拒派 refusal 'over-person-cap'
 *      （人档行 #r）+ budgetRefused 计数；无 gate 档=面关可派。
 * 依据：docs/17-§6（四要件）；132-§6.4（触发条件定稿表）；DEV-19（不猜价）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, CostGuardConfig, PersonRef, ResultStats, TokenCounts } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { foldHarvestCost } from '../../../src/engine/cost-guard/harvest.ts'

const T0 = new Date(2026, 9, 23, 10, 0, 0, 0).getTime() // 2026-10-23 10:00 本地（时区无关）
const DAY = '2026-10-23'

const GUARD: CostGuardConfig = {
  dailyBudgetUsd: { company: 25, perPersonDefault: 8 },
  alertTiers: [
    { tier: 'watch', atPct: 50, route: 'notify' },
    { tier: 'warn', atPct: 80, route: 'dispatch' },
    { tier: 'alarm', atPct: 100, route: 'dispatch+notify' },
    { tier: 'hard', atPct: 120, route: 'gate' },
  ],
}

let root = ''
let snapshot: CompanySnapshot

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface StackOptions {
  costGuard?: CostGuardConfig
  /** fake adapter 注入（132-A 测试面）：model 归一形 + usage 四桶 */
  model?: string
  usage?: TokenCounts
}

interface TestStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  personId: string
}

function buildStack(id: string, opts?: StackOptions): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(
    createFakeAdapter({
      ...(opts?.model !== undefined ? { model: opts.model } : {}),
      ...(opts?.usage !== undefined ? { usage: opts.usage } : {}),
    }),
    { default: true },
  )
  const person = snapshot.people[0] as PersonRef
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§6（收割四要件）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
    },
    people: snapshot.people,
    makeId: deterministicIds(),
    ...(opts?.costGuard !== undefined ? { costGuard: opts.costGuard } : {}),
  })
  return { platform, ledger, engine, clock, personId: person.id }
}

/** 全链跑到收割（budget-gate/e2e 同型：create → DISPATCH 拍 → 收割拍） */
async function runToHarvest(stack: TestStack, type = 'task'): Promise<{ ticket: string; report: TickReport }> {
  const created = await stack.platform.issues.create({ title: `cost-guard 缝测试单（${type}）`, type, level: 0 })
  stack.clock.advance(1000)
  await stack.engine.tick() // DISPATCH
  stack.clock.advance(1000)
  const report = await stack.engine.tick() // 收割（GATE_PASS）
  return { ticket: created.id, report }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-daemon-costguard-'))
  snapshot = {
    slug: 'costguard-corp',
    name: '成本警戒测试公司',
    level: 2,
    charter: 'charter.md',
    platform: { platform: 'localfile' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people: [
      { id: 'AGENT-1', name: '警戒工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
    ],
    jobs: [],
  }
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— foldHarvestCost 四路（R4 单元面） —————————————————————————

describe('foldHarvestCost：即时折算四路（native 为尊→快照→兜底→不猜价）', () => {
  const stats = (o: { usd?: number; model?: string; tokens?: TokenCounts }): ResultStats => ({
    cost: { usd: o.usd ?? 0 },
    tokens: o.tokens ?? { input: 1_000_000, output: 1_000_000, cache_read: 0, cache_creation: 0 },
    duration: 10,
    turns: 1,
    ...(o.model !== undefined ? { model: o.model } : {}),
  })

  it('native>0 自报为尊（tokens 再大也不重折）', () => {
    const ledger = openLedger(path.join(root, 'fold-native.sqlite'))
    const r = foldHarvestCost(ledger, 'demo', stats({ usd: 0.01, model: 'deepseek/deepseek-flash', tokens: { input: 9e9, output: 9e9, cache_read: 0, cache_creation: 0 } }), undefined, T0)
    expect(r).toEqual({ usd: 0.01, noteSuffix: ';cost=basis=native' })
    ledger.close()
  })

  it('快照折算：usd=tokens×当日价 + basis=snapshot + 锚留痕', () => {
    const ledger = openLedger(path.join(root, 'fold-snap.sqlite'))
    const snapId = `ps-${makeUlid(T0 - 60_000)}`
    ledger.appendPriceSnapshot({
      id: snapId, company: 'demo', provider: 'deepseek', model: 'deepseek-flash', price_date: DAY,
      input_per_m: 0.3, output_per_m: 1.2, cache_read_per_m: 0.006, cache_creation_per_m: 0.3,
      source_note: '测试语料', source_ticket: 'STUDIO-177', published_by: 'TEST',
    })
    const r = foldHarvestCost(ledger, 'demo', stats({ model: 'deepseek/deepseek-flash' }), undefined, T0)
    expect(r.usd).toBeCloseTo(1.5, 6) // 1M×0.3 + 1M×1.2
    expect(r.noteSuffix).toBe(`;cost=basis=snapshot;cost-snap=${snapId}`)
    ledger.close()
  })

  it('models-yaml 兜底：无快照有声明 → basis=models-yaml', () => {
    const ledger = openLedger(path.join(root, 'fold-yaml.sqlite'))
    const declared = [
      { tier: 'high' as const, provider: 'deepseek', model: 'deepseek-flash', price: { inputPerM: 0.3, outputPerM: 1.2 } },
    ]
    const r = foldHarvestCost(ledger, 'demo', stats({ model: 'deepseek/deepseek-flash' }), declared, T0)
    expect(r.usd).toBeCloseTo(1.5, 6)
    expect(r.noteSuffix).toBe(';cost=basis=models-yaml')
    ledger.close()
  })

  it('不猜价两形：无模型声明 / 有模型无当日价 → usd=0 + 如实留痕', () => {
    const ledger = openLedger(path.join(root, 'fold-unpriced.sqlite'))
    const a = foldHarvestCost(ledger, 'demo', stats({}), undefined, T0)
    expect(a.usd).toBe(0)
    expect(a.noteSuffix).toBe(';cost=basis=unpriced（无模型声明，无从折算）')
    const b = foldHarvestCost(ledger, 'demo', stats({ model: 'glm/GLM-5.3' }), undefined, T0)
    expect(b.usd).toBe(0)
    expect(b.noteSuffix).toBe(';cost=basis=unpriced（model=glm/GLM-5.3 无当日价）')
    ledger.close()
  })
})

// ————————————————————————— 收割缝端到端（write-through + 三面同值） —————————————————————————

describe('收割缝：GATE_PASS note + 三面同值 + usage_daily write-through', () => {
  const USAGE: TokenCounts = { input: 1000, output: 500, cache_read: 0, cache_creation: 0 }

  it('native+write-through ok：cost=basis=native；usage=daily ok；三面同值 0.01；一格落账', async () => {
    const stack = buildStack('seam-ok', { model: 'deepseek/deepseek-flash', usage: USAGE })
    const { ticket, report } = await runToHarvest(stack)
    expect(report.errors).toEqual([])
    const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
    expect(gatePass?.note).toContain(';cost=basis=native')
    expect(gatePass?.note).toContain(';usage=daily ok')
    // 三面同值（结构性保证——同一 foldHarvestCost 返回值）
    expect(gatePass?.cost_usd).toBeCloseTo(0.01, 6)
    const wr = stack.ledger.listWorkRecords({ issue: ticket })[0]
    expect(wr?.cost_usd).toBeCloseTo(0.01, 6)
    const settles = stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: ticket }).filter((r) => r.kind === 'settle')
    expect(settles[0]?.actual_usd).toBeCloseTo(0.01, 6)
    // write-through 一格：人×模型×本地日 + 四桶（列名 tokens_in/out——migrations v11 口径）
    const cells = stack.ledger.listUsageDaily({ company: snapshot.slug, person_id: stack.personId, model: 'deepseek/deepseek-flash', usage_date: DAY })
    expect(cells).toHaveLength(1)
    const cell = cells[0]
    expect(cell?.tokens_in).toBe(USAGE.input)
    expect(cell?.tokens_out).toBe(USAGE.output)
    expect(cell?.runs_count).toBe(1)
    expect(cell?.last_ts).toBeGreaterThanOrEqual(wr?.started_at ?? 0)
    stack.ledger.close()
  })

  it('model 缺席=skip：不投影（132-A 冻结口径）+ 零行', async () => {
    const stack = buildStack('seam-skip', { usage: USAGE })
    const { ticket, report } = await runToHarvest(stack)
    expect(report.errors).toEqual([])
    const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
    expect(gatePass?.note).toContain(';cost=basis=native') // fake 自报 0.01 仍直录
    expect(gatePass?.note).toContain(';usage=daily skip')
    expect(stack.ledger.listUsageDaily({ company: snapshot.slug, usage_date: DAY })).toHaveLength(0)
    stack.ledger.close()
  })
})

// ————————————————————————— 人日硬线联动（R6 gate 档） —————————————————————————

describe('人日硬线：今日已结实际超 hard 线 → 拒派（refusal over-person-cap）', () => {
  it('超线拒派：settle 8.5×2=17 > hard 8×120%=9.6 → refusal #r + budgetRefused；票不动', async () => {
    const stack = buildStack('hard-refuse', { costGuard: GUARD })
    // 今日已结两笔 settle（person 档——engine 双行口径同形直写）：17 > 9.6
    stack.ledger.appendBudget({ id: makeUlid(T0 - 2000), scope_kind: 'person', scope_id: stack.personId, kind: 'settle', estimated_usd: 8.5, actual_usd: 8.5, ts: T0 - 2000 })
    stack.ledger.appendBudget({ id: makeUlid(T0 - 1000), scope_kind: 'person', scope_id: stack.personId, kind: 'settle', estimated_usd: 8.5, actual_usd: 8.5, ts: T0 - 1000 })
    const created = await stack.platform.issues.create({ title: '硬线拒绝单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.budgetRefused).toBe(1)
    expect(report.errors.join('\n')).toContain('budget-refusal:over-person-cap')
    const refusals = stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: created.id }).filter((r) => r.kind === 'refusal')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.id.endsWith('#r')).toBe(true)
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    stack.ledger.close()
  })

  it('线内可派 + 无 gate 档=面关：同账面下两形都放行', async () => {
    // 线内（settle 5 < 9.6）：正常派发
    const ok = buildStack('hard-pass', { costGuard: GUARD })
    ok.ledger.appendBudget({ id: makeUlid(T0 - 1000), scope_kind: 'person', scope_id: ok.personId, kind: 'settle', estimated_usd: 5, actual_usd: 5, ts: T0 - 1000 })
    await ok.platform.issues.create({ title: '线内单', type: 'task', level: 0 })
    ok.clock.advance(1000)
    const r1 = await ok.engine.tick()
    expect(r1.phases.dispatch.budgetRefused).toBe(0)
    expect(r1.phases.dispatch.dispatched).toBe(1)
    ok.ledger.close()
    // 面关（段声明但无 gate 档——CG-3 合法形态）：同账面（超 9.6）仍可派
    const noGate = buildStack('hard-off', { costGuard: { ...GUARD, alertTiers: GUARD.alertTiers.filter((t) => t.route !== 'gate') } })
    noGate.ledger.appendBudget({ id: makeUlid(T0 - 1000), scope_kind: 'person', scope_id: noGate.personId, kind: 'settle', estimated_usd: 8.5, actual_usd: 8.5, ts: T0 - 1000 })
    noGate.ledger.appendBudget({ id: makeUlid(T0 - 900), scope_kind: 'person', scope_id: noGate.personId, kind: 'settle', estimated_usd: 8.5, actual_usd: 8.5, ts: T0 - 900 })
    await noGate.platform.issues.create({ title: '面关单', type: 'task', level: 0 })
    noGate.clock.advance(1000)
    const r2 = await noGate.engine.tick()
    expect(r2.phases.dispatch.budgetRefused).toBe(0)
    expect(r2.phases.dispatch.dispatched).toBe(1)
    noGate.ledger.close()
  })
})
