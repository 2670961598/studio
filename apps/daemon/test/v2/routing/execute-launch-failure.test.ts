/**
 * task-81 T1：execute 级 launch-failure —— 路由选源→setSourceOverlay/setModel 后 launch 抛错，
 * finally 必须恢复 adapter 状态（不泄漏下一次派发），错误按现有 DISPATCH_FAIL 分类，不伪造成功。
 * 测试面：fake adapter 包一层 setSourceOverlay/setModel/getter（不新增生产缝）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { ExecutorAdapter, TaskBrief } from '@studio-next/contract'
import { createEngine, ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

const MODELS_YAML = `tiers:
  high:
    sources:
      - id: primary
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`

describe('task-81 T1 execute launch-failure', () => {
  it('路由 launch 抛错：finally 恢复 overlay/model，DISPATCH_FAIL 可读、无 DISPATCH 假成功；下一非路由派发不携源', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-launch-fail-')); roots.push(root)
    const platform = createFakePlatform()
    const models = parseModelsYaml(MODELS_YAML)
    const registry = createRegistry()
    const base = createFakeAdapter({ name: 'dsh', onLaunch: () => { launches += 1 } })
    let launches = 0
    let attempts = 0
    let failNext = true
    let overlay: string | undefined
    let model: string | undefined
    const overlaySets: Array<string | undefined> = []
    const baseCast = base as unknown as { launch: (t: TaskBrief) => Promise<unknown> }
    const adapter = {
      ...base,
      async launch(task: TaskBrief) {
        attempts += 1
        if (failNext) { failNext = false; throw new Error('probe-launch-failure') }
        return baseCast.launch(task)
      },
      setSourceOverlay(p: string | undefined) { overlay = p; overlaySets.push(p) },
      setModel(m: string | undefined) { model = m },
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
      },
      people: DEMO_SNAPSHOT.people,
    })
    const t1 = await platform.issues.create({ title: 'launch failure routed', type: 'task', level: 0 })
    const reports = []
    for (let i = 0; i < 8 && attempts === 0; i += 1) reports.push(await engine.tick())
    expect(attempts).toBe(1) // 第一次派发 launch 失败；停止 tick，避免重试成功污染断言
    expect(launches).toBe(0)
    expect(overlaySets.length).toBeGreaterThan(0)
    expect(overlay).toBeUndefined() // finally 恢复
    expect(model).toBeUndefined()
    const errText = reports.flatMap((r) => r.errors).join('\n')
    expect(errText).toContain('DISPATCH_FAIL')
    expect(errText).toContain('probe-launch-failure')
    const events = (await import('@studio-next/store')).openLedger(path.join(root, 'ledger.sqlite')).queryEvents({ issue: t1.id })
    expect(events.filter((e) => e.event === 'DISPATCH')).toHaveLength(0) // 不伪造 DISPATCH 成功
    // 新引擎无 modelRouting（非路由派发）：复用同一 adapter/registry；验证 finally 恢复未泄漏源 overlay/model
    const ledger2 = (await import('@studio-next/store')).openLedger(path.join(root, 'ledger2.sqlite'))
    const engine2 = createEngine({
      platform,
      ledger: ledger2,
      registry,
      assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/17-§2'] }),
      gateRunner: createDefaultGateRunner(),
      clock: () => 1_800_000_000_000,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: DEMO_SNAPSHOT.slug,
        rootDir: path.join(root, 'var2'),
        defaultPersonId: 'AGENT-1',
        deptFallback: 'departments/工程部',
        defaultLane: 'core',
        mirrorRescanEveryTicks: 1,
      },
      people: DEMO_SNAPSHOT.people,
    })
    const t2 = await platform.issues.create({ title: 'non-routing mid', type: 'task', level: 0 })
    const beforeSets = overlaySets.length
    for (let i = 0; i < 6; i += 1) await engine2.tick()
    const t2Dispatch = ledger2.queryEvents({ issue: t2.id }).filter((e) => e.event === 'DISPATCH')
    expect(t2Dispatch.length).toBeGreaterThan(0)
    expect(overlaySets.length).toBe(beforeSets) // 非路由派发不 set source overlay
    expect(overlay).toBeUndefined()
    expect(model).toBeUndefined()
  })
})
