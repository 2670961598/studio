/**
 * task-135 交付③：execute 同 dispatch 内一次换源 —— launch 抛错（=未产生首段输出）且
 * 失败类可换源（429/quota/5xx/网络）→ 冷却当前源 + ESCALATE MODEL_ROUTING_FAILOVER 留痕 →
 * 重绑下一源 overlay/model → 重试 launch 一次；全灭=DISPATCH_FAIL 可读 fail-closed；
 * 400/拒答类不换源（attempts=1 直接失败）。测试面：fake adapter 包 launch（不新增生产缝）。
 * task-135 收尾：预算 HOLD 可达性——allowBudgetDowngrade=true 全源超帽 → router 收尾判
 * BUDGET_EXCEEDED → ESCALATE MODEL_ROUTING_BUDGET_HOLD（注明全源超帽）；false=现状不降档。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { ExecutorAdapter, TaskBrief } from '@studio-next/contract'
import { deserializeRoutingState } from '../../../src/engine/routing/router.ts'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type EngineConfig } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

const MODELS_YAML = `tiers:
  high:
    sources:
      - id: a
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}
      - id: b
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: {inputPerM: 2, outputPerM: 10}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`

interface Harness {
  readonly engine: ReturnType<typeof createEngine>
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledgerRoot: string
  readonly launches: { count: number }
  readonly overlaySets: Array<string | undefined>
  readonly models: Array<string | undefined>
}

/** launchFailures[i]=第 i+1 次 launch 抛出的错误（undefined=成功走真 fake）；configOverrides=引擎配置覆盖 */
async function harness(root: string, launchFailures: Array<unknown | undefined>, configOverrides: Partial<EngineConfig> = {}): Promise<Harness> {
  const platform = createFakePlatform()
  const models = parseModelsYaml(MODELS_YAML)
  const registry = createRegistry()
  const base = createFakeAdapter({ name: 'dsh' })
  const launches = { count: 0 }
  const overlaySets: Array<string | undefined> = []
  const models_: Array<string | undefined> = []
  let overlay: string | undefined
  let model: string | undefined
  const baseCast = base as unknown as { launch: (t: TaskBrief) => Promise<unknown> }
  const adapter = {
    ...base,
    async launch(task: TaskBrief) {
      const i = launches.count
      launches.count += 1
      const fail = launchFailures[i]
      if (fail !== undefined) throw fail
      return baseCast.launch(task)
    },
    setSourceOverlay(p: string | undefined) { overlay = p; overlaySets.push(p) },
    setModel(m: string | undefined) { model = m; models_.push(m) },
    getSourceOverlay() { return overlay },
    getModel() { return model },
  } as unknown as ExecutorAdapter
  registry.register(adapter, { default: true })
  const engine = createEngine({
    platform,
    ledger: (await import('@studio-next/store')).openLedger(path.join(root, 'ledger.sqlite')),
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/17-§2'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => 1_800_000_000_000,
    catalog: createModelCatalog(models),
    modelRouting: { sources: { high: modelSourcesOf(models, 'high') }, rootDir: root },
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      modelTierByRole: { main_worker: 'high' },
      modelTierTickets: { 'T-1': 'high', 'T-2': 'mid' },
      ...configOverrides,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { engine, platform, ledgerRoot: path.join(root, 'ledger.sqlite'), launches, overlaySets, models: models_ }
}

async function dispatchOnce(h: Harness): Promise<{ ticket: string; errors: string[] }> {
  const t = await h.platform.issues.create({ title: 'failover probe', type: 'task', level: 0 })
  const errors: string[] = []
  for (let i = 0; i < 8 && h.launches.count === 0; i += 1) errors.push(...(await h.engine.tick()).errors)
  return { ticket: t.id, errors }
}

describe('task-135 同 dispatch 一次换源', () => {
  it('首源 429 类失败 → 冷却+留痕+换源重试成功：DISPATCH 携 routing=b/fallbackFrom=a', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-failover-1')); roots.push(root)
    const h = await harness(root, [new Error('upstream 429 quota exhausted')])
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(2)
    expect(h.overlaySets.length).toBe(3) // a → b → finally 恢复
    expect(h.overlaySets[0]).toContain('dsh-tier-high--a')
    expect(h.overlaySets[1]).toContain('dsh-tier-high--b')
    expect(h.overlaySets[2]).toBeUndefined()
    expect(h.models).toEqual(['glm/GLM-5.3', 'opencode-go/kimi-k3.1-pro', undefined])
    const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
    const events = store.queryEvents({ issue: ticket })
    const dispatch = events.filter((e) => e.event === 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]?.note).toContain('routing=b')
    expect(dispatch[0]?.note).toContain('routing-fallbackFrom=a')
    const failover = events.filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_FAILOVER'))
    expect(failover).toHaveLength(1)
    expect(failover[0]?.note).toContain('source=a')
    expect(failover[0]?.note).toContain('class=quota')
    expect(failover[0]?.note).toContain('cooldownMs=900000')
    // 冷却持久化：源 a 进冷却（下次派发自然跳过）；源 b 未登记（未触碰）
    const state = deserializeRoutingState(store.kvGet('model-routing.state') ?? '{}')
    expect(state['a']?.cooldownUntil).toBeGreaterThan(1_800_000_000_000)
    expect(state['b']?.cooldownUntil ?? 0).toBe(0)
  })

  it('全源失败 → fail-closed 可读（DISPATCH_FAIL、无 DISPATCH 假成功、换源留痕仅首源一次）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-failover-2')); roots.push(root)
    const h = await harness(root, [new Error('upstream 429 quota exhausted'), new Error('upstream 533 overloaded')])
    const { ticket, errors } = await dispatchOnce(h)
    expect(h.launches.count).toBe(2) // a 一次 + 换源 b 一次，不再更多
    expect(errors.join('\n')).toContain('DISPATCH_FAIL')
    const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
    const events = store.queryEvents({ issue: ticket })
    expect(events.filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    const failover = events.filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_FAILOVER'))
    expect(failover).toHaveLength(1) // 只有 a（b 的失败归 DISPATCH_FAIL 文本，不二次留痕）
    expect(errors.join('\n')).toContain('换源重试仍失败')
  })

  it('400 类失败不换源：attempts=1 直接 DISPATCH_FAIL、零换源留痕', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-failover-3')); roots.push(root)
    const bad = new Error('bad request')
    ;(bad as Error & { status?: number }).status = 400
    const h = await harness(root, [bad])
    const { ticket, errors } = await dispatchOnce(h)
    expect(h.launches.count).toBe(1)
    expect(errors.join('\n')).toContain('DISPATCH_FAIL')
    const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
    const events = store.queryEvents({ issue: ticket })
    expect(events.filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_FAILOVER'))).toHaveLength(0)
    expect(events.filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
  })
})

describe('task-135 收尾：预算 HOLD 可达（allowBudgetDowngrade 全源超帽，verifier 死分支修复）', () => {
  it('true 全源超帽 → ESCALATE MODEL_ROUTING_BUDGET_HOLD 可见+fail-closed+去重；false=现状 HOLD 不降档', async () => {
    // allowBudgetDowngrade=true：两源均超票帽 → router 收尾判 BUDGET_EXCEEDED → HOLD note 可见
    const root1 = mkdtempSync(path.join(tmpdir(), 'sn-budget-hold-1')); roots.push(root1)
    const h1 = await harness(root1, [], { allowBudgetDowngrade: true, budgetTicketCapUsd: 0.00001 })
    const d1 = await dispatchOnce(h1)
    expect(h1.launches.count).toBe(0) // fail-closed：不 launch
    expect(d1.errors.join('\n')).toContain('MODEL_ROUTING_FAIL')
    expect(d1.errors.join('\n')).toContain('BUDGET_EXCEEDED')
    const store1 = (await import('@studio-next/store')).openLedger(h1.ledgerRoot)
    const events1 = store1.queryEvents({ issue: d1.ticket })
    expect(events1.filter((e) => e.event === 'DISPATCH')).toHaveLength(0)
    const hold1 = events1.filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_BUDGET_HOLD'))
    expect(hold1).toHaveLength(1) // 连续 tick 重试不刷屏（ticket+source 去重）
    expect(hold1[0]?.note).toContain('allowBudgetDowngrade=true 全源超帽')
    expect(hold1[0]?.note).toContain('source=a')
    // 缺省 false=现状：首源超帽即 HOLD（不降档注记），不静默试下一源
    const root2 = mkdtempSync(path.join(tmpdir(), 'sn-budget-hold-2')); roots.push(root2)
    const h2 = await harness(root2, [], { budgetTicketCapUsd: 0.00001 })
    const d2 = await dispatchOnce(h2)
    expect(h2.launches.count).toBe(0)
    expect(d2.errors.join('\n')).toContain('BUDGET_EXCEEDED')
    const store2 = (await import('@studio-next/store')).openLedger(h2.ledgerRoot)
    const hold2 = store2.queryEvents({ issue: d2.ticket }).filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_BUDGET_HOLD'))
    expect(hold2).toHaveLength(1)
    expect(hold2[0]?.note).toContain('不降档')
    expect(hold2[0]?.note).toContain('source=a')
  })
})
