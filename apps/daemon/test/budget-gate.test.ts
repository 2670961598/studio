/**
 * budget-gate —— 预算闸接线测试：派发前 reserve→launch 顺序 / 超帽拒派 / duplicate 幂等 /
 * 收割 settle 冲销 / 失败保留 / 估算两态（docs/16-§三、docs/20-§六.8、F1-09）
 *
 * 依据（实现单引用）：
 *   - docs/20-§六.8：预算预留-结算**不落即不派**——落账（appendBudget）与 launch 之间
 *     失败=不派（本套用注入抛错的 ledger 代理直证机制点）。
 *   - docs/16-§三：reserve→settle→refusal；成本按每成功交付记账（settle 行 actual）。
 *   - docs/02 F1-09：launch 前原子预留 → 完工 settle 释放 → 超额调用前拒绝落 refusal
 *     （可查、不封死）。
 *   - core/budget.ts：双行落账（人档行 id=票档行 id+'#p'）、refusal 行 id+'#r'、
 *     settle 冲销全部未结预留；src/budget-gate.ts 头注：估算两态 + 失败保留 adopt 拟稿。
 *
 * 断言面（对契约与冻结口径负责，不对实现细节负责）：
 *   1. 预算行先于派发：reserve 双行（issue+person/#p）落账在 DISPATCH 事件前（ts/id 双序）
 *   2. 不落即不派：appendBudget 抛错 → 无 DISPATCH、无 work_record、平台不迁已派发
 *      （issue 行已落+person 行抛错的半行残留面同证：残留不引发双派）
 *   3. 超帽拒派：票级/岗级两帽各证一次；refusal 行落账（#r）+ TickReport budgetRefused
 *      + actionResult detail 记 budget-refusal
 *   4. refusal 不封死：结清释放后再派可过（F1-09「可查」不含「封禁」）
 *   5. duplicate 幂等：既有未结预留 → adopt 沿用（不落新行，DISPATCH 正常）
 *   6. settle 双行冲销：收割成功 → issue+person 双 settle 行（estimated=冲销额、actual=成本）
 *      + 折叠对账（reserved=0 / settled=actual）
 *   7. 失败保留：GATE_FAIL 不结算（无 settle 行、预留原额）→ 重派 adopt（同笔额度）
 *   8. 估算两态：态 B（无价目表）=适配器自报（fake=0）；态 A（catalog）=字符量×价目>0
 *   9. 模块面：无预留可结=CONFIG_INVALID；结清后可再预留（新周期）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { createModelCatalog, parseModelsYaml, budgetView, foldBudgets } from '@studio-next/core'
import type { ClassifiedError, CompanySnapshot, FlowPlatform, ModelCatalog, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../src/engine.ts'
import {
  ESTIMATE_CHARS_PER_TOKEN,
  ESTIMATE_OUTPUT_INPUT_RATIO,
  estimateDispatch,
  gateDispatch,
  settleDispatch,
  type BudgetGateDeps,
} from '../src/budget-gate.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { createDefaultGateRunner, type GateOutcome, type GateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'

const T0 = Date.parse('2026-10-16T00:00:00.000Z')

/** 测试价目（放大 1000 倍便于帽值取整断言；价目是测试夹具非承诺价） */
const TEST_MODELS_YAML = [
  'tiers:',
  '  high: {provider: test, model: m-high, price: {inputPerM: 600, outputPerM: 2200}}',
  '  mid: {provider: test, model: m-mid, price: {inputPerM: 200, outputPerM: 800}}',
  '  low: {provider: test, model: m-low, price: {inputPerM: 50, outputPerM: 250}}',
  'roles:',
  '  main_worker: high',
].join('\n')

/** 恒红闸门（exit=1）：四要件第 4 条缺失——失败保留链路注入（e2e 同款） */
const RED_GATE: GateRunner = {
  async run(input): Promise<GateOutcome> {
    return { exitCode: 1, reportExists: true, reportPath: path.join(input.workspace, 'REPORT.md'), note: 'test 注入：验收红' }
  },
}

let root = ''
let snapshot: CompanySnapshot

/** 确定性 ULID（e2e 同款：'0' 时间段 + 计数尾段——id 全序可比较，落账序断言依据） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface StackOptions {
  gateRunner?: GateRunner
  catalog?: ModelCatalog
  budgetTicketCapUsd?: number
  budgetPersonCapUsd?: number
  limits?: { maxActionsPerTick?: number; maxInflight?: number }
  /** 注入 appendBudget 抛错（不落即不派的机制点直证）：命中谓词即抛 */
  failAppendBudgetOn?: (record: { kind: string; scope_kind: string }) => boolean
}

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildStack(id: string, opts?: StackOptions): TestStack {
  const realLedger = openLedger(path.join(root, `${id}.sqlite`))
  const ledger: Ledger =
    opts?.failAppendBudgetOn === undefined
      ? realLedger
      : {
          ...realLedger,
          appendBudget: (record: unknown): { id: string; appended: boolean } => {
            const r = record as { kind: string; scope_kind: string }
            if (opts.failAppendBudgetOn?.(r)) throw new Error(`test 注入：appendBudget 失败（${r.scope_kind}/${r.kind}）`)
            return realLedger.appendBudget(record)
          },
        }
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
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
      docRefs: ['docs/16-§三（预算）', 'docs/20-§六.8（不落即不派）'],
    }),
    gateRunner: opts?.gateRunner ?? createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      limits: {
        maxActionsPerTick: opts?.limits?.maxActionsPerTick ?? 4,
        maxInflight: opts?.limits?.maxInflight ?? 4,
      },
      ...(opts?.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: opts.budgetTicketCapUsd } : {}),
      ...(opts?.budgetPersonCapUsd !== undefined ? { budgetPersonCapUsd: opts.budgetPersonCapUsd } : {}),
    },
    people: snapshot.people,
    makeId: deterministicIds(),
    ...(opts?.catalog !== undefined ? { catalog: opts.catalog } : {}),
  })
  return { platform, ledger: realLedger, engine, clock }
}

/** 预算行便捷面（kind 过滤） */
function budgetRows(ledger: Ledger, scope: { scope_kind: 'issue' | 'person'; scope_id: string }, kind?: string) {
  return ledger.queryBudgets(scope).filter((r) => kind === undefined || r.kind === kind)
}

/** 折叠净视图（对账面：core foldBudgets 直喂 store 行流） */
function viewOf(ledger: Ledger, scope: { scope_kind: 'issue' | 'person'; scope_id: string }) {
  return budgetView(foldBudgets(ledger.queryBudgets(scope)), scope.scope_kind, scope.scope_id)
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-daemon-budget-'))
  // 最小快照（无需公司目录 init——引擎只消费快照形状）
  snapshot = {
    slug: 'budget-corp',
    name: '预算测试公司',
    level: 2,
    charter: 'charter.md',
    platform: { platform: 'localfile' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people: [
      { id: 'AGENT-1', name: '预算工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
    ],
    jobs: [],
  }
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 模块面（budget-gate 纯接线件） —————————————————————————

describe('估算两态（价目表接入面）', () => {
  const catalog = createModelCatalog(parseModelsYaml(TEST_MODELS_YAML))

  it('态 B（无价目表）：估算=适配器自报（fake=0.01 与实际成本同额）——降级不伪造依据', async () => {
    const est = await estimateDispatch(createFakeAdapter(), { ticket: 'T-1', attempt: 1, briefPath: '/b', workspace: '/w', AGENTS_MD: { channel: 'native', target: '/a' } }, 10_000)
    expect(est.usd).toBe(0.01)
  })

  it('0 额预留接缝：估算 0 的适配器 → reserve 行照落（estimated=0）→ 结算 no-op（无额可冲销）；真无预留仍 CONFIG_INVALID', async () => {
    const ledger = openLedger(path.join(root, 'gate-zero.sqlite'))
    const freeAdapter = createFakeAdapter()
    freeAdapter.estimate = async () => ({ estimated: { usd: 0 }, confidence: 0 })
    const deps: BudgetGateDeps = { ledger, makeId: deterministicIds() }
    const brief = { ticket: 'T-0', attempt: 1, briefPath: '/b', workspace: '/w', AGENTS_MD: { channel: 'native' as const, target: '/a' } }

    const gate = await gateDispatch(deps, { ticket: 'T-0', personId: 'AGENT-1', adapter: freeAdapter, taskBrief: brief, briefChars: 100, now: T0 })
    expect(gate.kind).toBe('reserved')
    if (gate.kind !== 'reserved') return
    expect(gate.estimated).toBe(0)

    const settled = settleDispatch(deps, { ticket: 'T-0', personId: 'AGENT-1', actual: { usd: 0.02 }, now: T0 + 1 })
    expect(settled.rows).toEqual([]) // no-op：0 额未结预留无额可冲销（budget-gate 头注接缝拟稿）
    expect(settled.released).toBe(0)

    expect(() => settleDispatch(deps, { ticket: 'T-nothing', personId: 'AGENT-1', actual: { usd: 0.02 }, now: T0 + 2 })).toThrowError(/无未结预留可结算/)
    ledger.close()
  })

  it('态 A（有价目表）：估算=字符量×价目折算（>0，确定性）', async () => {
    const brief = { ticket: 'T-1', attempt: 1, briefPath: '/b', workspace: '/w', AGENTS_MD: { channel: 'native' as const, target: '/a' } }
    const est = await estimateDispatch(createFakeAdapter(), brief, 4000, catalog)
    // 4000 字符 → 1000 入 tokens + 500 出 tokens → high 档：(1000/1e6)*600+(500/1e6)*2200
    const expected = (4000 / ESTIMATE_CHARS_PER_TOKEN / 1e6) * 600 + Math.ceil(4000 / ESTIMATE_CHARS_PER_TOKEN * ESTIMATE_OUTPUT_INPUT_RATIO) / 1e6 * 2200
    expect(est.usd).toBeCloseTo(expected, 10)
    expect(est.usd).toBeGreaterThan(0)
    const again = await estimateDispatch(createFakeAdapter(), brief, 4000, catalog)
    expect(again.usd).toBe(est.usd)
  })

  it('态 A 取保守值：价目折算与适配器自报取 max', async () => {
    const priceySelfReport = createFakeAdapter()
    // 适配器自报高于价目折算时以自报为准（保守：宁多不少，settle 全额冲销）
    priceySelfReport.estimate = async () => ({ estimated: { usd: 999 }, confidence: 1 })
    const est = await estimateDispatch(priceySelfReport, { ticket: 'T-1', attempt: 1, briefPath: '/b', workspace: '/w', AGENTS_MD: { channel: 'native', target: '/a' } }, 100, catalog)
    expect(est.usd).toBe(999)
  })

  it('结算无预留可结=CONFIG_INVALID（core 语义镜像：不能凭空结算）', () => {
    const ledger = openLedger(path.join(root, 'gate-empty.sqlite'))
    const deps: BudgetGateDeps = { ledger, makeId: deterministicIds() }
    expect(() => settleDispatch(deps, { ticket: 'T-9', personId: 'AGENT-1', actual: { usd: 0.01 }, now: T0 })).toThrowError(
      /无未结预留可结算/,
    )
    try {
      settleDispatch(deps, { ticket: 'T-9', personId: 'AGENT-1', actual: { usd: 0.01 }, now: T0 })
    } catch (err) {
      expect((err as ClassifiedError).category).toBe('CONFIG_INVALID')
    }
    ledger.close()
  })
})

// ————————————————————————— 引擎面：派发前闸 —————————————————————————

describe('派发前闸：预留先落账才派发（20-§六.8 不落即不派）', () => {
  it('预留双行（issue+person/#p）先于 DISPATCH 落账（ts/id 双序）', async () => {
    const stack = buildStack('order', { catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)) })
    const created = await stack.platform.issues.create({ title: '预算先行单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.budgetReserved).toBe(1)

    const reserves = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: created.id }, 'reserve')
    const personReserves = budgetRows(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' }, 'reserve')
    expect(reserves).toHaveLength(1)
    expect(personReserves).toHaveLength(1)
    expect(personReserves[0]?.id).toBe(`${reserves[0]?.id}#p`) // 双行 id 约定（core BUDGET_PERSON_SUFFIX）
    expect(reserves[0]?.estimated_usd).toBeGreaterThan(0) // 态 A：价目校准（fake 自报 0 被抬升）

    const dispatch = stack.ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')
    expect(dispatch).toBeDefined()
    expect(reserves[0]?.ts).toBeLessThanOrEqual(dispatch?.ts ?? Number.POSITIVE_INFINITY) // 同拍冻结时钟 ts 相等
    // 确定性 id 全序：reserve id 先于 DISPATCH 事件 id 生成（落账序直证）
    expect(reserves[0]?.id < (dispatch?.id ?? '')).toBe(true)
    expect(dispatch?.note).toContain('budget=reserve$')
    stack.ledger.close()
  })

  it('落账失败=不派：issue 行 append 抛错 → 无 DISPATCH/无工位/平台不迁已派发', async () => {
    const stack = buildStack('fail-issue-row', {
      failAppendBudgetOn: (r) => r.kind === 'reserve' && r.scope_kind === 'issue',
    })
    const created = await stack.platform.issues.create({ title: '落账失败单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.budgetReserved).toBe(0)
    expect(report.errors.join('\n')).toContain('DISPATCH_FAIL')
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    expect(stack.ledger.listWorkRecords({ issue: created.id })).toHaveLength(0)
    expect((await stack.platform.issues.get(created.id)).state).toBe('新单')
    expect(stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: created.id })).toHaveLength(0)
    stack.ledger.close()
  })

  it('半行残留不双派：issue 行已落+person 行 append 抛错 → 仍不派（残留不引发第二次 launch）', async () => {
    const stack = buildStack('fail-person-row', {
      failAppendBudgetOn: (r) => r.kind === 'reserve' && r.scope_kind === 'person',
    })
    const created = await stack.platform.issues.create({ title: '半行残留单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    // issue 行已落（顺序=issue 先 person 后——失败安全面，budget-gate 头注拟稿）
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: created.id }, 'reserve')).toHaveLength(1)
    expect((await stack.platform.issues.get(created.id)).state).toBe('新单')
    stack.ledger.close()
  })

  it('超票帽拒派：refusal 行（#r）落账 + budgetRefused 计数 + detail 记 budget-refusal + 票不动', async () => {
    const stack = buildStack('cap-ticket', {
      catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)),
      budgetTicketCapUsd: 0.1, // 态 A 估算 ~0.5 美元 > 帽
    })
    const created = await stack.platform.issues.create({ title: '超票帽单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.budgetReserved).toBe(0)
    expect(report.phases.dispatch.budgetRefused).toBe(1)
    expect(report.errors.join('\n')).toContain('budget-refusal:over-ticket-cap')

    const refusals = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: created.id }, 'refusal')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.id.endsWith('#r')).toBe(true)
    expect(refusals[0]?.estimated_usd).toBeGreaterThan(0)
    // 未派：无 DISPATCH/无工位/平台不迁；预留面为空（refused 只记录不占位）
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    expect(viewOf(stack.ledger, { scope_kind: 'issue', scope_id: created.id })).toEqual({ reserved: 0, settled: 0, refused: refusals[0]?.estimated_usd })
    expect((await stack.platform.issues.get(created.id)).state).toBe('新单')
    stack.ledger.close()
  })

  it('超岗帽拒派（person 档跨票合计）；结清释放后再派可过（refusal 不封死，F1-09）', async () => {
    // 探针栈先测单笔估算 E（同长栈 id/同长标题 → 装配文本等长 → 估算恒等，确定性）；
    // 帽取 1.5E：一笔过（0+E≤1.5E）、两笔超（E+E>1.5E）
    const catalog = createModelCatalog(parseModelsYaml(TEST_MODELS_YAML))
    const probe = buildStack('cap-a', { catalog })
    await probe.platform.issues.create({ title: '岗帽探针单', type: 'task', level: 0 })
    probe.clock.advance(1000)
    await probe.engine.tick()
    const est = budgetRows(probe.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'reserve')[0]?.estimated_usd
    probe.ledger.close()
    expect(est).toBeGreaterThan(0)

    const stack = buildStack('cap-b', {
      catalog,
      budgetPersonCapUsd: (est as number) * 1.5,
    })
    await stack.platform.issues.create({ title: '岗帽第一单', type: 'task', level: 0 })
    const second = await stack.platform.issues.create({ title: '岗帽第二单', type: 'task', level: 0 })
    await stack.platform.issues.setField(second.id, 'lane', 'extra') // 异泳道：让两单同拍都进派发面
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(1)
    expect(t1.phases.dispatch.budgetRefused).toBe(1)
    expect(t1.errors.join('\n')).toContain('budget-refusal:over-person-cap')
    // 人档在途=第一单预留（跨票合计的比较基准）
    expect(viewOf(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' }).reserved).toBeGreaterThan(0)

    stack.clock.advance(1000)
    const t2 = await stack.engine.tick()
    expect(t2.phases.harvest.completed).toBe(1) // 第一单收割成功 → settle 释放人池
    expect(viewOf(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' }).reserved).toBe(0)

    // 第二单再试（评论活动再触发决策）：refusal 不挡后续 reserve
    await stack.platform.comments.add('T-2', { author: 'tester', body: '再试一次（结清后人池已释放）', signature: '[budget-corp·工程部·预算工程师·2]' })
    stack.clock.advance(1000)
    const t3 = await stack.engine.tick()
    expect(t3.phases.dispatch.dispatched).toBe(1)
    expect(t3.phases.dispatch.budgetReserved).toBe(1)
    expect(t3.errors).toEqual([])
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-2' }, 'reserve')).toHaveLength(1)
    stack.ledger.close()
  })
})

describe('duplicate 幂等：既有未结预留 → adopt 沿用（失败保留重派语义）', () => {
  it('预置未结预留（失败/崩溃残留）→ 派发 adopt：不落新行、DISPATCH 正常、计数不涨', async () => {
    const stack = buildStack('adopt')
    // 直落一对 reserve 双行（模拟上次失败保留 / 落账-launch 间崩溃残留）
    stack.ledger.appendBudget({ id: 'seed-r1', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 0.42, ts: T0 })
    stack.ledger.appendBudget({ id: 'seed-r1#p', scope_kind: 'person', scope_id: 'AGENT-1', kind: 'reserve', estimated_usd: 0.42, ts: T0 })
    const created = await stack.platform.issues.create({ title: '沿用预留单', type: 'task', level: 0 })
    expect(created.id).toBe('T-1')

    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.phases.dispatch.budgetReserved).toBe(0) // adopt 不落新行不计数
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'reserve')).toHaveLength(1)
    expect(budgetRows(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' }, 'reserve')).toHaveLength(1)
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).toContain('budget=adopt$0.4200')
    // 收割成功：settle 冲销的恰是沿用那笔（released=0.42）
    stack.clock.advance(1000)
    const t2 = await stack.engine.tick()
    expect(t2.phases.harvest.completed).toBe(1)
    const settles = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'settle')
    expect(settles[0]?.estimated_usd).toBe(0.42)
    expect(settles[0]?.actual_usd).toBe(0.01)
    stack.ledger.close()
  })
})

// ————————————————————————— 引擎面：收割结算与失败保留 —————————————————————————

describe('收割后结算与失败保留（16-§三：成本按每成功交付记账）', () => {
  it('成功路径：settle 双行冲销（issue+person）+ 折叠对账（reserved=0 / settled=actual）', async () => {
    const stack = buildStack('settle-ok', { catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)) })
    await stack.platform.issues.create({ title: '结算冲销单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick()
    const reservedEst = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'reserve')[0]?.estimated_usd
    expect(reservedEst).toBeGreaterThan(0)

    stack.clock.advance(1000)
    const t2 = await stack.engine.tick()
    expect(t2.errors).toEqual([])
    expect(t2.phases.harvest.completed).toBe(1)

    const issueSettles = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'settle')
    const personSettles = budgetRows(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' }, 'settle')
    expect(issueSettles).toHaveLength(1)
    expect(personSettles).toHaveLength(1)
    expect(personSettles[0]?.id).toBe(`${issueSettles[0]?.id}#p`)
    expect(issueSettles[0]?.actual_usd).toBe(0.01) // fake resultStats.cost：每成功交付记账
    expect(issueSettles[0]?.estimated_usd).toBe(reservedEst) // 冲销额=预留额（对账友好显式写）
    expect(personSettles[0]?.estimated_usd).toBe(reservedEst)
    const after = viewOf(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' })
    expect(after.reserved).toBe(0)
    expect(after.settled).toBe(0.01)
    expect(viewOf(stack.ledger, { scope_kind: 'person', scope_id: 'AGENT-1' })).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
    const gatePass = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_PASS')
    expect(gatePass?.note).toContain('budget=settle 冲销 $')
    // 结清后同票可再预留（新周期）——gateDispatch 直证（reserved=0 无 duplicate 面；
    // id 段从 900 起：避开引擎已用的确定性 ULID 段——appendBudget 同 id 异容=CONFIG_INVALID）
    const laterIds = (): ((ts: number) => string) => {
      let n = 900
      return (_ts: number): string => {
        n += 1
        return '0'.repeat(10) + String(n).padStart(16, '0')
      }
    }
    const again = await gateDispatch(
      { ledger: stack.ledger, makeId: laterIds() },
      {
        ticket: 'T-1',
        personId: 'AGENT-1',
        adapter: createFakeAdapter(),
        taskBrief: { ticket: 'T-1', attempt: 2, briefPath: '/b', workspace: '/w', AGENTS_MD: { channel: 'native', target: '/a' } },
        briefChars: 100,
        now: T0 + 999_999,
      },
    )
    expect(again.kind).toBe('reserved')
    stack.ledger.close()
  })

  it('失败路径：预留保留（无 settle 行、原额不动）→ 重派 adopt 同笔额度 → 再失败仍不结算', async () => {
    const stack = buildStack('keep-on-fail', {
      gateRunner: RED_GATE,
      catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)),
    })
    await stack.platform.issues.create({ title: '失败保留单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick() // 派发：reserve 双行
    const reserved = viewOf(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }).reserved
    expect(reserved).toBeGreaterThan(0)

    stack.clock.advance(1000)
    const failTick = await stack.engine.tick() // 收割失败：GATE_FAIL + 回首批位
    expect(failTick.phases.harvest.failed).toBe(1)
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'settle')).toHaveLength(0) // 不结算
    expect(viewOf(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }).reserved).toBe(reserved) // 原额保留

    stack.clock.advance(1000)
    const reDispatch = await stack.engine.tick() // 重派（回滚活动触发）
    expect(reDispatch.phases.dispatch.dispatched).toBe(1)
    expect(reDispatch.phases.dispatch.budgetReserved).toBe(0) // adopt：不落新行
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'reserve')).toHaveLength(1)
    const dispatches = stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    expect(dispatches[1]?.attempt).toBe(2)
    expect(dispatches[1]?.note).toContain('budget=adopt$')

    stack.clock.advance(1000)
    await stack.engine.tick() // 二次收割失败
    expect(budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }, 'settle')).toHaveLength(0)
    expect(viewOf(stack.ledger, { scope_kind: 'issue', scope_id: 'T-1' }).reserved).toBe(reserved)
    stack.ledger.close()
  })
})

describe('无价目表降级态（态 B）与 daemon.yaml 装载面', () => {
  it('态 B：估算=适配器自报（fake=0.01）→ reserve 行载自报值，无帽照常派发', async () => {
    const stack = buildStack('degraded')
    const created = await stack.platform.issues.create({ title: '降级态单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.phases.dispatch.budgetReserved).toBe(1)
    const reserves = budgetRows(stack.ledger, { scope_kind: 'issue', scope_id: created.id }, 'reserve')
    expect(reserves[0]?.estimated_usd).toBe(0.01)
    const dispatch = stack.ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).toContain('budget=reserve$0.0100')
    // 收割照常结算冲销（态 B 全链：预留→结算对账自洽）
    stack.clock.advance(1000)
    await stack.engine.tick()
    expect(viewOf(stack.ledger, { scope_kind: 'issue', scope_id: created.id })).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
    stack.ledger.close()
  })

  it('态 B：岗级帽不生效（无价目依据）——两单并发均派（对照态 A 的 over-person-cap）', async () => {
    const stack = buildStack('degraded-pc', { budgetPersonCapUsd: 0.000001 })
    await stack.platform.issues.create({ title: '岗帽失效一', type: 'task', level: 0 })
    const second = await stack.platform.issues.create({ title: '岗帽失效二', type: 'task', level: 0 })
    await stack.platform.issues.setField(second.id, 'lane', 'extra') // 异泳道：两单同拍都进派发面
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(2) // 岗级帽在态 B 被忽略（两态口径，budget-gate 头注）
    expect(report.phases.dispatch.budgetRefused).toBe(0)
    stack.ledger.close()
  })

  it('parseDaemonConfig：models/budgetTicketCapUsd/budgetPersonCapUsd 三键装载', async () => {
    const { parseDaemonConfig } = await import('../src/serve.ts')
    const cfg = parseDaemonConfig(
      ['db: ./var/l.sqlite', 'platform: fake', 'company: demo', 'models: ./models.yaml', 'budgetTicketCapUsd: 5', 'budgetPersonCapUsd: 20'].join('\n'),
    )
    expect(cfg.models).toBe('./models.yaml')
    expect(cfg.budgetTicketCapUsd).toBe(5)
    expect(cfg.budgetPersonCapUsd).toBe(20)
    // 缺省两态：无 models 键=态 B（undefined，不拷贝示例）
    const bare = parseDaemonConfig('db: ./var/l.sqlite')
    expect(bare.models).toBeUndefined()
    expect(bare.budgetTicketCapUsd).toBeUndefined()
  })
})
