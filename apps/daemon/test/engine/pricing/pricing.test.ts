/**
 * pricing e2e（132-§6.2 单B·studio-dev-169）：定价面端到端。
 *
 * 断言面（plan.md §3；docs/17-§6 四要件冻结口径不动）：
 *   1. 定价单全链：type='pricing' 单 → 派发 → 收割 GATE_PASS（note 后缀 ;pricing=N行@datev…）
 *      + price_snapshots 行单据锚（source_ticket/published_by）——态 B 无 catalog 降级不拦；
 *   2. 覆盖校验失败（catalog 在档缺档）：整表拒——GATE_PASS 照发（收割结论不劫持）+
 *      ;pricing-err= 后缀 + DAILY_ALARM src=pricing-publish + 零行入账；
 *   3. 附件缺失：同上失败面（HF-1 漏发附件唤醒不静默）；
 *   4. 同日紧急调价：第二张定价单同模型同日 → version=2 新行（旧行不动，F1）；
 *   5. 普通单（type='task'）零行为：无 pricing 后缀、无快照行；
 *   6. stale 守夜（P5 每晨必更）：本地 10:00 前不跑；到窗未定价/沿用≥2 日 → DAILY_ALARM
 *      挂心跳哨兵（issue='-'）；kv 日锚一日一跑；事件 note 派生幂等（崩溃重放不双告）；
 *      fresh/stale1 不告警。
 * 时区无关：时钟一律本地 08:00/12:00 构造（本地日=构造日，任意机器 TZ 稳定）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { createModelCatalog, parseModelsYaml } from '@studio-next/core'
import type { CompanySnapshot, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { PRICING_STALE_CHECK_DATE_KEY } from '../../../src/engine/pricing/pricing.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'e2e@studio-next.invalid',
}

/** 测试 catalog 三档（budget-gate 同款形；pricing.yaml 覆盖校验的声明面） */
const TEST_MODELS_YAML = [
  'tiers:',
  '  high: {provider: test, model: m-high, price: {inputPerM: 600, outputPerM: 2200}}',
  '  mid: {provider: test, model: m-mid, price: {inputPerM: 200, outputPerM: 800}}',
  '  low: {provider: test, model: m-low, price: {inputPerM: 50, outputPerM: 250}}',
  'roles:',
  '  main_worker: high',
].join('\n')

/** 定价附件（覆盖三档+超额模型 extra/new——「⊇」放行面） */
const PRICING_YAML = [
  "priceDate: '2026-10-16'",
  'sourceNote: e2e 测试价（deepseek 官网页形）',
  'models:',
  '  - {provider: test, model: m-high, prices: [{slot: peak, inputPerM: 1.32, outputPerM: 3.96, cacheReadPerM: 0.044}]}',
  '  - {provider: test, model: m-mid, prices: [{slot: peak, inputPerM: 0.3, outputPerM: 1.2}]}',
  '  - {provider: test, model: m-low, prices: [{slot: peak, inputPerM: 0.15, outputPerM: 0.6}]}',
  '  - {provider: extra, model: new-model, prices: [{slot: peak, inputPerM: 0.5, outputPerM: 2}]}',
].join('\n')

/** 覆盖缺档附件（缺 m-mid/m-low——CONFIG_INVALID pricing/coverage 面） */
const PRICING_YAML_PARTIAL = [
  "priceDate: '2026-10-16'",
  'sourceNote: 缺档附件',
  'models:',
  '  - {provider: test, model: m-high, prices: [{slot: peak, inputPerM: 1.32, outputPerM: 3.96}]}',
].join('\n')

/** 同日紧急调价附件（同模型同日=version 2 面；仍须全覆盖——晨更完整性不因紧急豁免） */
const PRICING_YAML_URGENT = [
  "priceDate: '2026-10-16'",
  'sourceNote: 紧急调价（上游涨价）',
  'models:',
  '  - {provider: test, model: m-high, prices: [{slot: peak, inputPerM: 2.64, outputPerM: 7.92}]}',
  '  - {provider: test, model: m-mid, prices: [{slot: peak, inputPerM: 0.6, outputPerM: 2.4}]}',
  '  - {provider: test, model: m-low, prices: [{slot: peak, inputPerM: 0.3, outputPerM: 1.2}]}',
].join('\n')

/** 本地时刻构造（时区无关：本地日=构造日） */
const localTime = (y: number, m: number, d: number, h: number): number => new Date(y, m - 1, d, h, 0, 0, 0).valueOf()

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface StackOptions {
  /** 定价附件内容（undefined=不写附件）；每次 launch 调用取值——同栈双单异附件面 */
  pricingYaml?: () => string
  catalog?: boolean
  /** 镜像重决策节流（紧急调价用例：前单占道后新单靠 rescan 补进候选——缩短拍数） */
  mirrorRescanEveryTicks?: number
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
  // 每栈独立 .AIWS 树：T-1 同号单的 workspace 路径跨栈不复用（附件残留不串栈）
  const stackAiws = path.join(root, `${id}-aiws`)
  ensureAiwsTree(stackAiws, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  let t = localTime(2026, 10, 16, 9)
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(
    createFakeAdapter({
      onLaunch: (task) => {
        const yaml = opts?.pricingYaml?.()
        if (yaml === undefined) return
        mkdirSync(path.join(task.workspace, 'deliverables'), { recursive: true })
        writeFileSync(path.join(task.workspace, 'deliverables', 'pricing.yaml'), yaml, 'utf8')
      },
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
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      aiwsRoot: stackAiws,
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.mirrorRescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: opts.mirrorRescanEveryTicks } : {}),
    },
    people: snapshot.people,
    makeId: deterministicIds(),
    ...(opts?.catalog === true ? { catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)) } : {}),
  })
  return { platform, ledger, engine, clock, personId: person.id }
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-pricing-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
  aiwsRoot = path.join(path.dirname(companyDir), '.AIWS')
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  expect(aiwsTree.personDirs.length).toBeGreaterThan(0)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 全链跑到收割：create（type）→ DISPATCH 拍 → 收割拍 */
async function runToHarvest(stack: TestStack, type: string): Promise<{ ticket: string; report: TickReport }> {
  const created = await stack.platform.issues.create({ title: `定价面 e2e（${type}）`, type, level: 0 })
  stack.clock.advance(1000)
  await stack.engine.tick() // DISPATCH
  stack.clock.advance(1000)
  const report = await stack.engine.tick() // 收割（GATE_PASS + 定价消费步）
  return { ticket: created.id, report }
}

describe('定价更新单据化消费（GATE_PASS 后置步）', () => {
  it('态 A（catalog 在档）：附件→覆盖校验过→快照行落账（单据锚+发布人锚）+ note 后缀', async () => {
    const stack = buildStack('publish-ok', { pricingYaml: () => PRICING_YAML, catalog: true })
    try {
      const { ticket, report } = await runToHarvest(stack, 'pricing')
      expect(report.errors).toEqual([])
      const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.note).toContain(`;pricing=4行@2026-10-16v1..1`)
      // 快照行：单据号锚+发布人锚（收割 worker=默认岗）；超额模型 extra/new-model 同批入账
      const rows = stack.ledger.listPriceSnapshots({ source_ticket: ticket })
      expect(rows).toHaveLength(4)
      expect(rows.every((r) => r.published_by === stack.personId && r.source_ticket === ticket)).toBe(true)
      expect(rows.map((r) => `${r.provider}/${r.model}`).sort()).toEqual(['extra/new-model', 'test/m-high', 'test/m-low', 'test/m-mid'])
      expect(rows.every((r) => r.version === 1)).toBe(true)
      // 成功路径零 DAILY_ALARM（发布失败才唤醒——不静默≠无事嚎）
      expect(stack.ledger.queryEvents({ issue: ticket }).filter((e) => e.event === 'DAILY_ALARM')).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })

  it('态 B（无 catalog）：覆盖校验降级跳过——照常入账+note 如实降级（不伪造依据）', async () => {
    const stack = buildStack('publish-degraded', { pricingYaml: () => PRICING_YAML })
    try {
      const { ticket, report } = await runToHarvest(stack, 'pricing')
      expect(report.errors).toEqual([])
      const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.note).toContain(`;pricing=4行@2026-10-16v1..1（态B：无 models.yaml，覆盖校验降级）`)
      expect(stack.ledger.listPriceSnapshots({ source_ticket: ticket })).toHaveLength(4)
    } finally {
      stack.ledger.close()
    }
  })

  it('覆盖缺档：GATE_PASS 照发（收割结论不劫持）+ pricing-err 后缀 + DAILY_ALARM + 零行入账', async () => {
    const stack = buildStack('publish-coverage-fail', { pricingYaml: () => PRICING_YAML_PARTIAL, catalog: true })
    try {
      const { ticket, report } = await runToHarvest(stack, 'pricing')
      // 收割四要件与定价消费分责：单据本身合格 → GATE_PASS；发布失败如实上报（不静默）
      expect(report.errors.filter((e) => e.startsWith('定价发布失败'))).toHaveLength(1)
      const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.note).toContain('pricing-err=')
      expect(gatePass?.note).not.toContain(';pricing=4行')
      const alarms = stack.ledger.queryEvents({ issue: ticket }).filter((e) => e.event === 'DAILY_ALARM')
      expect(alarms).toHaveLength(1)
      expect(alarms[0]?.note).toContain(`src=pricing-publish;ticket=${ticket}`)
      expect(alarms[0]?.note).toContain('m-mid')
      expect(stack.ledger.listPriceSnapshots({ source_ticket: ticket })).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })

  it('附件缺失（HF-1 漏发）：同失败面——pricing-err=附件缺失 + DAILY_ALARM + 零行', async () => {
    const stack = buildStack('publish-missing', { catalog: true })
    try {
      const { ticket, report } = await runToHarvest(stack, 'pricing')
      expect(report.errors.filter((e) => e.startsWith('定价发布失败'))).toHaveLength(1)
      const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.note).toContain('pricing-err=定价单附件缺失')
      const alarms = stack.ledger.queryEvents({ issue: ticket }).filter((e) => e.event === 'DAILY_ALARM')
      expect(alarms).toHaveLength(1)
      expect(alarms[0]?.note).toContain('pricing.yaml')
      expect(stack.ledger.listPriceSnapshots()).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })

  it('同日紧急调价：第二张定价单同模型同日 → version=2 新行（旧行不动，F1 版本化）', async () => {
    // 双附件序列：晨更附件（4 模型 v1）→ 紧急调价附件（3 档 v2）——每次 launch 取当次内容
    let publishYaml = PRICING_YAML
    const stack = buildStack('publish-urgent', { pricingYaml: () => publishYaml, catalog: true, mirrorRescanEveryTicks: 1 })
    try {
      const first = await runToHarvest(stack, 'pricing') // T-1 晨更
      publishYaml = PRICING_YAML_URGENT
      // T-2 紧急调价（同模型同日）：与 T-1 后续流（QA/merge/close）交错推进——
      // 有限拍循环等收割（每拍单至多一动作，收割拍序不硬编码）
      const secondCreated = await stack.platform.issues.create({ title: '紧急调价单', type: 'pricing', level: 0 })
      stack.clock.advance(1000)
      let gate2 = stack.ledger.queryEvents({ issue: secondCreated.id }).find((e) => e.event === 'GATE_PASS')
      for (let i = 0; i < 6 && gate2 === undefined; i += 1) {
        await stack.engine.tick()
        stack.clock.advance(1000)
        gate2 = stack.ledger.queryEvents({ issue: secondCreated.id }).find((e) => e.event === 'GATE_PASS')
      }
      const gate1 = stack.ledger.queryEvents({ issue: first.ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gate1?.note).toContain('v1..1')
      expect(gate2?.note).toContain(`;pricing=3行@2026-10-16v2..2`)
      const mHigh = stack.ledger.listPriceSnapshots({ provider: 'test', model: 'm-high', price_date: '2026-10-16' })
      expect(mHigh).toHaveLength(2)
      expect(mHigh.map((r) => r.version)).toEqual([1, 2]) // (price_date, version) 升序
      expect(mHigh.map((r) => r.input_per_m)).toEqual([1.32, 2.64])
      expect(mHigh.map((r) => r.source_ticket)).toEqual([first.ticket, secondCreated.id])
    } finally {
      stack.ledger.close()
    }
  })

  it('普通单（type="task"）零行为：无 pricing 后缀、无快照行（非定价单不受影响）', async () => {
    const stack = buildStack('non-pricing', { pricingYaml: () => PRICING_YAML, catalog: true })
    try {
      const { ticket, report } = await runToHarvest(stack, 'task')
      expect(report.errors).toEqual([])
      const gatePass = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.note).not.toContain('pricing=4行')
      expect(gatePass?.note).not.toContain('pricing-err')
      expect(stack.ledger.listPriceSnapshots()).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })
})

describe('stale 守夜（相位 7 尾日锚步·P5 每晨必更）', () => {
  it('10:00 前不跑；到窗未定价=DAILY_ALARM×3（挂心跳哨兵）；kv 日锚一日一跑；次日沿用 fresh/stale 边界', async () => {
    const stack = buildStack('stale-watch', { catalog: true })
    try {
      // ① 本地 09:00（发布窗内、检查时刻前）：不跑（报告 checked=0，无 kv 锚）
      await stack.engine.tick()
      expect(stack.ledger.kvGet(PRICING_STALE_CHECK_DATE_KEY)).toBeNull()
      // ② 12:00 到窗：三档从未定价 → 3 告警挂心跳哨兵（issue='-'，events.issue 必填契约）
      stack.clock.advance(3 * 3_600_000)
      const noon = await stack.engine.tick()
      expect(noon.phases.account.pricingStale).toMatchObject({ checked: 3, alarmed: 3 })
      const alarms = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'DAILY_ALARM' && (e.note ?? '').startsWith('src=pricing-stale;'))
      expect(alarms).toHaveLength(3)
      expect(alarms.every((e) => (e.note ?? '').includes('stale=never'))).toBe(true)
      expect(stack.ledger.kvGet(PRICING_STALE_CHECK_DATE_KEY)).toBe('2026-10-16')
      // ③ 同日再拍：kv 日锚命中——不重跑（崩溃重放同面；note 派生集是第二道闸）
      stack.clock.advance(3_600_000)
      const again = await stack.engine.tick()
      expect(again.phases.account.pricingStale).toMatchObject({ checked: 0, alarmed: 0 })
      expect(stack.ledger.queryEvents({ issue: '-' }).filter((e) => (e.note ?? '').startsWith('src=pricing-stale;'))).toHaveLength(3)
      // ④ HF-1 补发布（三档当日价，直写 store 面——发布消费链另有上测）→ 次日沿用 1 日：不告
      const seedIds = deterministicIds()
      for (const m of ['m-high', 'm-mid', 'm-low']) {
        stack.ledger.appendPriceSnapshot({
          id: `ps-${seedIds()}`,
          company: snapshot.slug,
          provider: 'test',
          model: m,
          price_date: '2026-10-16',
          input_per_m: 1,
          output_per_m: 1,
          source_note: 'stale 守夜测试注入',
          source_ticket: 'STALE-SEED',
          published_by: 'HF-1',
        })
      }
      stack.clock.advance(24 * 3_600_000) // 10-17 13:00
      const day1 = await stack.engine.tick()
      expect(day1.phases.account.pricingStale).toMatchObject({ checked: 3, alarmed: 0 })
      // ⑤ 再一日无更新：沿用满 2 日 → 三档再告（note date=10-17——新告警日键）
      stack.clock.advance(24 * 3_600_000) // 10-18 13:00
      const day2 = await stack.engine.tick()
      expect(day2.phases.account.pricingStale).toMatchObject({ checked: 3, alarmed: 3 })
      const all = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'DAILY_ALARM' && (e.note ?? '').startsWith('src=pricing-stale;'))
      expect(all).toHaveLength(6)
      expect(all.filter((e) => (e.note ?? '').includes('date=2026-10-16'))).toHaveLength(3)
      expect(all.filter((e) => (e.note ?? '').includes('date=2026-10-18'))).toHaveLength(3)
      expect(all.filter((e) => (e.note ?? '').includes('stale=2'))).toHaveLength(3)
    } finally {
      stack.ledger.close()
    }
  })
})
