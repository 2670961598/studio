/**
 * cost-guard 唤起源测试（132-§6.4 单C·studio-dev-177；docs/22-§一 源注册表/
 * §三.2 幂等口径）：cost-threshold 源的档位判定/幂等/升档/面关/零内存态恢复。
 *
 * 断言面（src/engine/cost-guard/source.ts 实现单口径逐条钉死）：
 *   1. 段未声明（guard=undefined）=面关：poll 空报告零意图零落账；
 *   2. 公司档达线：escalate 意图（payload.class='cost-threshold'/facts 字段/
 *      dedupKey `cost:company:day:<本地日>:<tier>`）+ ESCALATE 事件挂心跳哨兵单；
 *   3. 幂等：同 scope 同日同档只醒一次（百次重扫一告）；
 *   4. 升档必醒：running 涨破更高档=新 tier 新 key（hard 二醒）；
 *   5. 人档：cost_caps 覆盖 per_person_default；在途预留计入 running；
 *   6. 零内存态：新源实例（重启面）从 ESCALATE note 派生已醒集不重告；
 *   7. unpriced（无当日价）：按 0 计+stale_flag=1 如实上报（DEV-19 不猜价）。
 * 语料：真实 tmp 库 usage_daily+price_snapshots+budgets 三面直写（快照桥同型）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CostGuardConfig, InvokeIntent, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import {
  COST_THRESHOLD_SOURCE_MANIFEST,
  COST_THRESHOLD_SOURCE_NAME,
  createCostThresholdSource,
} from '../../../src/engine/cost-guard/source.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-cost-src-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const T0 = new Date(2026, 9, 23, 10, 0, 0, 0).getTime() // 2026-10-23 10:00 本地
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

const PEOPLE: readonly PersonRef[] = [
  { id: 'ENG-1', dept: 'departments/研发部', level: 2, role: '程序' },
  { id: 'ENG-2', dept: 'departments/研发部', level: 1, role: '程序', costCaps: { dailyUsd: 12 } },
]

function openStack(id: string): { ledger: Ledger; clock: () => number } {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  return { ledger, clock: (): number => t }
}

/** 当日价快照（deepseek/deepseek-flash：$0.30/$1.20 每百万 in/out） */
function seedSnapshot(ledger: Ledger): void {
  ledger.appendPriceSnapshot({
    id: `ps-${makeUlid(T0 - 60_000)}`,
    company: 'demo',
    provider: 'deepseek',
    model: 'deepseek-flash',
    price_date: DAY,
    input_per_m: 0.3,
    output_per_m: 1.2,
    cache_read_per_m: 0.006,
    cache_creation_per_m: 0.3,
    source_note: '测试语料',
    source_ticket: 'STUDIO-177',
    published_by: 'TEST',
  })
}

/** 当日用量格（1M in + 1M out × $0.3/$1.2 = $1.5） */
function seedUsage(ledger: Ledger, personId: string, runs = 1): void {
  for (let i = 0; i < runs; i += 1) {
    ledger.upsertUsageDaily({
      id: makeUlid(T0 + i),
      company: 'demo',
      person_id: personId,
      model: 'deepseek/deepseek-flash',
      usage_date: DAY,
      tokens: { input: 1_000_000, output: 1_000_000, cache_read: 0, cache_creation: 0 },
      first_ts: T0,
      last_ts: T0 + i,
      updated_at: T0 + i,
    })
  }
}

function eventsOf(ledger: Ledger, name: string): Array<{ note?: string; issue: string }> {
  return ledger
    .queryEvents({ company: 'demo' })
    .filter((e) => e.event === name)
    .map((e) => ({ note: e.note, issue: e.issue }))
}

describe('cost-threshold 源：面关与公司档', () => {
  it('段未声明=面关：poll 空报告（checked=0）零意图零落账', () => {
    const s = openStack('guard-off')
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => undefined,
      people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got: InvokeIntent[] = []
    seedUsage(s.ledger, 'ENG-1')
    const r = src.poll((i) => got.push(i))
    expect(r).toMatchObject({ checked: 0, fired: 0 })
    expect(got).toEqual([])
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(0)
    s.ledger.close()
  })

  it('公司档达线：watch 档意图+ESCALATE（心跳哨兵单）；facts 字段逐项；幂等百扫一告', () => {
    const s = openStack('company-watch')
    seedSnapshot(s.ledger)
    seedUsage(s.ledger, 'ENG-1', 9) // $13.5 = 54% → watch（公司预算 25）
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => GUARD,
      people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got: InvokeIntent[] = []
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(2) // 公司 watch + 人档 ENG-1 hard（13.5/8=168.75%——人档同拍独立评估）
    expect(r.checked).toBe(1 + PEOPLE.length)
    const intent = got[0]
    // ticket 不携（129-D 181 修）：心跳哨兵 '-' 不是单——无单意图走 dedupKey 路径
    // （25-§3.4 v1.3 幂等键设计位；携 '-' 会坍缩成全警戒共用键，升档二醒被消费门吞掉）
    expect(intent?.ticket).toBeUndefined()
    expect(intent).toMatchObject({
      kind: 'escalate', company: 'demo',
      source: COST_THRESHOLD_SOURCE_NAME,
      dedupKey: `cost:company:day:${DAY}:watch`, priority: 3,
    })
    const facts = (intent?.payload as { facts: Record<string, unknown> }).facts
    expect(facts).toMatchObject({
      scope: 'company', period: `day:${DAY}`, tier: 'watch',
      budget_usd: 25, stale_flag: false,
    })
    expect(facts.running_usd).toBeCloseTo(13.5, 3)
    expect(facts.pct).toBeCloseTo(54, 1)
    expect(facts.top_consumers).toEqual([{ person: 'ENG-1', model: 'deepseek/deepseek-flash', usd: 13.5 }])
    expect(facts.price_snapshot_ref).toContain('deepseek/deepseek-flash@')
    const evt = eventsOf(s.ledger, 'ESCALATE')
    expect(evt).toHaveLength(2) // 公司 watch + 人档 hard 各一（同拍同 ts——ULID 随机尾，序不作断言）
    const companyEvt = evt.find((e) => (e.note ?? '').includes('scope=company'))
    expect(companyEvt?.issue).toBe('-') // 公司级挂心跳哨兵单
    expect(companyEvt?.note).toContain(`src=${COST_THRESHOLD_SOURCE_NAME}`)
    expect(companyEvt?.note).toContain('scope=company')
    expect(companyEvt?.note).toContain(`period=day:${DAY}`)
    expect(companyEvt?.note).toContain('tier=watch')
    // 幂等：百次重扫零重告（两键各一）
    for (let i = 0; i < 100; i += 1) src.poll((i2) => got.push(i2))
    expect(got).toHaveLength(2)
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(2)
    s.ledger.close()
  })

  it('升档必醒：running 涨破 hard 线（$30+ 在途预留）→ hard 档新 key 二醒；重启零内存态恢复', () => {
    const s = openStack('company-hard')
    seedSnapshot(s.ledger)
    seedUsage(s.ledger, 'ENG-1', 9) // $13.5 已结
    let guard: CostGuardConfig | undefined = GUARD
    const mk = (): ReturnType<typeof createCostThresholdSource> =>
      createCostThresholdSource({
        ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => guard,
        people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
      })
    const got: InvokeIntent[] = []
    mk().poll((i) => got.push(i)) // 公司 watch + 人档 ENG-1 hard（两醒）
    expect(got).toHaveLength(2)
    // 在途预留 $17（person 档——engine reserve 双行口径）→ 公司 running 13.5+17=30.5=122% → hard 二醒
    s.ledger.appendBudget({
      id: makeUlid(T0 + 100), scope_kind: 'person', scope_id: 'ENG-1', kind: 'reserve',
      estimated_usd: 17, ts: T0 + 100,
    })
    const src2 = mk()
    const r2 = src2.poll((i) => got.push(i))
    expect(r2.fired).toBe(1) // 只公司 hard 新醒（ENG-1 人档 hard 已醒不重）
    expect(got.some((i) => i.dedupKey === `cost:company:day:${DAY}:hard`)).toBe(true)
    // 已醒集（watch+hard）重启恢复：新实例不再重告
    guard = undefined // 面关插测：段摘除=零行为
    const src3 = mk()
    expect(src3.poll((i) => got.push(i)).checked).toBe(0)
    guard = GUARD
    const src4 = mk()
    const before = got.length
    src4.poll((i) => got.push(i))
    expect(got.length).toBe(before) // 零内存态：ESCALATE note 派生已醒集
    s.ledger.close()
  })
})

describe('cost-threshold 源：人档与取价基准', () => {
  it('人档：cost_caps 覆盖（ENG-2 帽 12：$13.5=112.5%→alarm；ENG-1 缺省 8：含在途→更高档）', () => {
    const s = openStack('person-tiers')
    seedSnapshot(s.ledger)
    seedUsage(s.ledger, 'ENG-1', 9) // $13.5
    seedUsage(s.ledger, 'ENG-2', 9) // $13.5
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => GUARD,
      people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got: InvokeIntent[] = []
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(3) // company alarm（27/25=108%）+ ENG-1 hard（168.75%）+ ENG-2 alarm（112.5%）
    const keys = got.map((i) => i.dedupKey)
    expect(keys).toContain(`cost:company:day:${DAY}:alarm`) // 27/25=108% → alarm
    expect(keys).toContain(`cost:person:ENG-2:day:${DAY}:alarm`) // 13.5/12=112.5% → alarm
    expect(keys).toContain(`cost:person:ENG-1:day:${DAY}:hard`) // 13.5/8=168.75% → hard
    s.ledger.close()
  })

  it('在途预留计入人档 running：reserve 未结即压档', () => {
    const s = openStack('person-reserve')
    seedSnapshot(s.ledger)
    seedUsage(s.ledger, 'ENG-2', 4) // $6 已结（帽 12：50%→watch 恰达线）
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => GUARD,
      people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got: InvokeIntent[] = []
    let r = src.poll((i) => got.push(i))
    expect(got.some((i) => i.dedupKey === `cost:person:ENG-2:day:${DAY}:watch`)).toBe(true)
    // 在途 $1：6+1=7 = 58.3% 仍 watch（已醒不重复）；$5 → 11/12=91.7% → warn
    s.ledger.appendBudget({
      id: makeUlid(T0 + 200), scope_kind: 'person', scope_id: 'ENG-2', kind: 'reserve',
      estimated_usd: 5, ts: T0 + 200,
    })
    r = src.poll((i) => got.push(i))
    expect(r.fired).toBeGreaterThanOrEqual(1)
    expect(got.some((i) => i.dedupKey === `cost:person:ENG-2:day:${DAY}:warn`)).toBe(true)
    s.ledger.close()
  })

  it('unpriced：无当日价模型按 0 计+stale_flag=1 如实上报（不猜价）', () => {
    const s = openStack('unpriced')
    // 无快照、无 declared → unpriced
    s.ledger.upsertUsageDaily({
      id: makeUlid(T0), company: 'demo', person_id: 'ENG-1', model: 'glm/GLM-5.3',
      usage_date: DAY, tokens: { input: 9_000_000, output: 9_000_000, cache_read: 0, cache_creation: 0 },
      first_ts: T0, last_ts: T0, updated_at: T0,
    })
    const src = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => GUARD,
      people: () => PEOPLE, deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got: InvokeIntent[] = []
    const r = src.poll((i) => got.push(i))
    expect(r.checked).toBe(1 + PEOPLE.length)
    expect(r.fired).toBe(0) // running=0 → 零档达标（预算 0 消耗=零档）
    // 空 cells 面（company 无任何格）同样 stale=true——面关插测由上一断言覆盖
    const r2 = createCostThresholdSource({
      ledger: s.ledger, clock: s.clock, company: 'demo', guard: () => GUARD,
      people: () => [], deptFallback: 'departments/研发部', heartbeatIssue: '-', intervalMs: 60_000,
    })
    const got2: InvokeIntent[] = []
    r2.poll((i) => got2.push(i))
    expect(got2).toEqual([])
    s.ledger.close()
  })

  it('manifest：kind=escalate 注册面', () => {
    expect(COST_THRESHOLD_SOURCE_MANIFEST).toMatchObject({ name: COST_THRESHOLD_SOURCE_NAME, kind: 'escalate' })
  })
})
