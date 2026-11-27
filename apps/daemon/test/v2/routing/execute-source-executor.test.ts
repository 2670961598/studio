/**
 * task-141：模型源 per-source executor 派发级用例（跨执行器换源）——fake 执行器替身，不真调 agy。
 *
 * 依据：docs/quality/model-routing.md §10（源 executor 与跨执行器换源）、
 * docs/quality/tier-executors.md「选择链登记面」（放行集合=tierExecutors ∪ 本档 sources executor）。
 *
 * 改前必红（task-141 前派发体只认档位适配器，sources[].executor 被忽略）：
 *   ① 首源 executor=agy 的派发落在 dsh；② agy launch 429 后换源不换执行器、无 from/to 留痕；
 *   ③ 未登记 executor 不拒派；④ 选择闸不放行 sources executor 家族。
 * 接线后（本文件断言）：
 *   ① 首源 executor=agy → 派发落 agy（dsh 零 launch、零 overlay），闸放行 `model-source:default`；
 *   ② agy launch 429 → 跨执行器换到 dsh 成功（各 launch 一次；FAILOVER `from=a@agy;to=b@dsh`）；
 *   ③ 源 executor 未登记 → fail-closed 可读（EXECUTOR_UNKNOWN）、零 launch、无 DISPATCH；
 *   ④ 闸仍拒未登记家族（sources executor 集合不放行 kimi）；
 *   ⑤ 同执行器两源（dsh/dsh）换源=既有行为（overlay/model 逐位回归形，绑定段不重跑）；
 *   ⑥ 预算预检改选他执行器的源 → 首绑即换绑一次（不记 FAILOVER）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, ExecutorAdapter, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { deserializeRoutingState } from '../../../src/engine/routing/router.ts'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type EngineConfig } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

const TIERS_TAIL = `  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`
/** high 两源：a=agy（首源）、b=dsh（次源） */
const MIXED_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}, executor: agy}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 2, outputPerM: 10}, executor: dsh}
${TIERS_TAIL}`
/** 同执行器两源（均 dsh）：源 executor 配置在场但与档位既有候选同家 */
const SAME_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}, executor: dsh}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 2, outputPerM: 10}, executor: dsh}
${TIERS_TAIL}`
/** 未登记 executor（注册表只有 dsh/agy） */
const UNKNOWN_YAML = MIXED_YAML.replace('executor: agy', 'executor: kimi')
/** 预算预检改选：首源 a（agy）超票帽、次源 b（dsh）在帽内 */
const BUDGET_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: big, priority: 10, price: {inputPerM: 500, outputPerM: 500}, executor: agy}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 0.1, outputPerM: 0.2}, executor: dsh}
${TIERS_TAIL}`

const QUOTA = new Error('upstream 429 quota exhausted')

interface Counts {
  readonly launches: Record<string, number>
  readonly detects: Record<string, number>
}
interface Harness {
  readonly engine: ReturnType<typeof createEngine>
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledgerRoot: string
  readonly overlaySets: Array<string | undefined>
  readonly models: Array<string | undefined>
  readonly counts: Counts
}
interface HarnessOptions {
  /** 按适配器名排队的 launch 抛错（该适配器第 i+1 次 launch 抛；缺省=成功走真 fake） */
  readonly launchFailures?: Readonly<Record<string, readonly unknown[]>>
  /** 选择闸开（dispatchSelection deps 注入；缺省=面关——仅测试直连引擎的兼容缝） */
  readonly gate?: { readonly personExecutors?: Readonly<Record<string, string>> }
  readonly configOverrides?: Partial<EngineConfig>
}

async function harness(root: string, yaml: string, opts: HarnessOptions = {}): Promise<Harness> {
  const platform = createFakePlatform()
  const models = parseModelsYaml(yaml)
  const registry = createRegistry()
  const counts: Counts = { launches: {}, detects: {} }
  const overlaySets: Array<string | undefined> = []
  const models_: Array<string | undefined> = []
  let overlay: string | undefined
  let model: string | undefined
  const wrap = (name: string, extra: Record<string, unknown>): ExecutorAdapter => {
    const base = createFakeAdapter({ name }) as unknown as { launch: (t: TaskBrief) => Promise<unknown>; detect: () => Promise<unknown> }
    return {
      ...base,
      async detect() { counts.detects[name] = (counts.detects[name] ?? 0) + 1; return base.detect() },
      async launch(task: TaskBrief) {
        const i = counts.launches[name] ?? 0
        counts.launches[name] = i + 1
        const fail = opts.launchFailures?.[name]?.[i]
        if (fail !== undefined) throw fail
        return base.launch(task)
      },
      ...extra,
    } as unknown as ExecutorAdapter
  }
  // dsh 家族位：带 overlay/model 端子（登记为缺省）；agy 位：无 overlay 端子——派发体若误套即 TypeError→派发失败→本套件红
  registry.register(wrap('dsh', {
    setSourceOverlay(p: string | undefined) { overlay = p; overlaySets.push(p) },
    setModel(m: string | undefined) { model = m; models_.push(m) },
    getSourceOverlay() { return overlay },
    getModel() { return model },
  }), { default: true })
  registry.register(wrap('agy', {}))
  const engine = createEngine({
    platform,
    ledger: openLedger(path.join(root, 'ledger.sqlite')),
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
      ...opts.configOverrides,
    },
    people: DEMO_SNAPSHOT.people,
    ...(opts.gate !== undefined ? { dispatchSelection: { chain: { entries: [] }, personExecutors: opts.gate.personExecutors ?? {} } } : {}),
  })
  return { engine, platform, ledgerRoot: path.join(root, 'ledger.sqlite'), overlaySets, models: models_, counts }
}

/** 建单并跑到首次 launch（或首个派发错误）；返回单号与拍错误 */
async function dispatchOnce(h: Harness): Promise<{ ticket: TicketId; errors: string[] }> {
  const t = await h.platform.issues.create({ title: 'source executor probe', type: 'task', level: 0 })
  const errors: string[] = []
  const launched = (): number => Object.values(h.counts.launches).reduce((a, b) => a + b, 0)
  for (let i = 0; i < 8 && launched() === 0; i += 1) {
    const out = await h.engine.tick()
    errors.push(...out.errors)
    if (out.errors.length > 0) break
  }
  return { ticket: t.id, errors }
}

async function ledgerOf(h: Harness): Promise<Ledger> {
  return openLedger(h.ledgerRoot)
}

function notesOf(ledger: Ledger, ticket: TicketId, event: string, needle = ''): string[] {
  const all: EventRecord[] = ledger.queryEvents({ issue: ticket })
  return all.filter((e) => e.event === event && (e.note ?? '').includes(needle)).map((e) => e.note ?? '')
}

describe('task-141 跨执行器换源（high 两源 [agy, dsh]）', () => {
  it('首源 executor=agy launch 429 → 跨执行器换到 dsh 成功：各 launch 一次；FAILOVER from=a@agy;to=b@dsh；DISPATCH 携 routing=b@dsh', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-1')); roots.push(root)
    const h = await harness(root, MIXED_YAML, { launchFailures: { agy: [QUOTA] } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.counts.launches).toEqual({ agy: 1, dsh: 1 })
    expect(h.counts.detects).toEqual({ agy: 1, dsh: 1 }) // 换执行器=绑定段整段重跑一次（dsh 侧一次，不重复）
    // overlay 只套 dsh 家族：b 一次 + finally 清回；agy 无 overlay 端子、零调用
    expect(h.overlaySets).toEqual([expect.stringContaining('dsh-tier-high--b'), undefined])
    expect(h.models).toEqual(['opencode-go/kimi-k3.1-pro', undefined])

    const ledger = await ledgerOf(h)
    const dispatch = notesOf(ledger, ticket, 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toContain('executor=dsh@0.0.0-fake')
    expect(dispatch[0]).toContain(';routing=b@dsh;routing-fallbackFrom=a@agy;routing-price=in$2/out$10;routing-skipped=a:cooldown(')
    expect(dispatch[0]).not.toContain('tier=high@agy')
    // 换源留痕：源锚 id@executor；from/to 跨执行器可判读
    const failover = notesOf(ledger, ticket, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')
    expect(failover).toHaveLength(1)
    expect(failover[0]).toContain('MODEL_ROUTING_FAILOVER;tier=high;source=a@agy;class=quota;cooldownMs=900000;from=a@agy;to=b@dsh（task-135 同dispatch换源）')
    // 在途执行器=换绑后的 dsh（台账为准，非 note 自述）
    const running = ledger.listWorkRecords({ issue: ticket })
    expect(running.map((r) => r.executor)).toEqual(['dsh'])
    // 冷却持久化：a 进冷却、b 未触碰
    const state = deserializeRoutingState(ledger.kvGet('model-routing.state') ?? '{}')
    expect(state['a']?.cooldownUntil).toBeGreaterThan(1_800_000_000_000)
    expect(state['b']?.cooldownUntil ?? 0).toBe(0)
  })

  it('全源失败 → 跨执行器换源后重试仍败=DISPATCH_FAIL 可读（次源锚 b@dsh+首源错误+次源错误并陈，不冒称成功）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-2')); roots.push(root)
    const h = await harness(root, MIXED_YAML, { launchFailures: { agy: [QUOTA], dsh: [new Error('upstream 533 overloaded')] } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(h.counts.launches).toEqual({ agy: 1, dsh: 1 })
    const text = errors.join('\n')
    expect(text).toContain('DISPATCH_FAIL')
    expect(text).toContain('DISPATCH_FAIL：launch 失败且同 dispatch 换源重试仍失败（b@dsh；首源错误：upstream 429 quota exhausted）：upstream 533 overloaded')
    const ledger = await ledgerOf(h)
    expect(notesOf(ledger, ticket, 'DISPATCH')).toHaveLength(0)
    expect(h.overlaySets).toEqual([expect.stringContaining('dsh-tier-high--b'), undefined]) // 失败也清回
  })

  it('无故障：派发落首源 executor=agy（dsh 零 launch、零 overlay）；选择闸放行 model-source 登记；档位锚改述为源 executor 绑定', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-3')); roots.push(root)
    const h = await harness(root, MIXED_YAML, { gate: {} })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.counts.launches).toEqual({ agy: 1 })
    expect(h.overlaySets).toEqual([])
    expect(h.models).toEqual([])
    const ledger = await ledgerOf(h)
    const dispatch = notesOf(ledger, ticket, 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toContain('executor=agy@0.0.0-fake')
    expect(dispatch[0]).toContain(';routing=a@agy;routing-price=in$1/out$2')
    expect(dispatch[0]).toContain(';selection=model-source:default@agy')
    expect(dispatch[0]).toContain(';tier=high@agy（源 executor=a@agy，task-141）')
    expect(ledger.listWorkRecords({ issue: ticket }).map((r) => r.executor)).toEqual(['agy'])
  })

  it('源 executor 未登记 → 派发 fail-closed 可读（EXECUTOR_UNKNOWN；与 task-56 路由拒派同形，无 DISPATCH_FAIL 误称）：零 launch、无 DISPATCH、无 FAILOVER', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-4')); roots.push(root)
    const h = await harness(root, UNKNOWN_YAML)
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toEqual(['派发失败 T-1：MODEL_ROUTING_FAIL;tier=high;reason=EXECUTOR_UNKNOWN;源 a 的 executor=kimi 未在注册表登记（已登记：dsh、agy）（task-141 fail-closed 不降档）'])
    expect(h.counts.launches).toEqual({})
    const ledger = await ledgerOf(h)
    expect(notesOf(ledger, ticket, 'DISPATCH')).toHaveLength(0)
    expect(notesOf(ledger, ticket, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')).toHaveLength(0)
  })

  it('选择闸仍拒未登记：sources executor 集合={agy,dsh} 不放行岗位绑定的 kimi（拒派、零 launch）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-5')); roots.push(root)
    const h = await harness(root, MIXED_YAML, { gate: { personExecutors: { 'AGENT-1': 'kimi' } } })
    const { ticket, errors } = await dispatchOnce(h)
    const text = errors.join('\n')
    expect(text).toContain('DISPATCH_FAIL')
    expect(text).toContain('dispatch/selection-unregistered')
    expect(h.counts.launches).toEqual({})
    expect(notesOf(await ledgerOf(h), ticket, 'DISPATCH')).toHaveLength(0)
  })

  it('同执行器两源（dsh/dsh）launch 429 换源=既有行为：不换绑不重跑段；overlay/model 逐位回归形；锚携 @dsh', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-6')); roots.push(root)
    const h = await harness(root, SAME_YAML, { launchFailures: { dsh: [QUOTA] } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.counts.launches).toEqual({ dsh: 2 })
    expect(h.counts.detects).toEqual({ dsh: 1 }) // 同执行器换源：绑定段不重跑
    expect(h.overlaySets).toEqual([expect.stringContaining('dsh-tier-high--a'), expect.stringContaining('dsh-tier-high--b'), undefined])
    expect(h.models).toEqual(['glm/GLM-5.3', 'opencode-go/kimi-k3.1-pro', undefined])
    const ledger = await ledgerOf(h)
    const dispatch = notesOf(ledger, ticket, 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toContain('executor=dsh@0.0.0-fake')
    expect(dispatch[0]).toContain(';routing=b@dsh;routing-fallbackFrom=a@dsh;')
    const failover = notesOf(ledger, ticket, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')
    expect(failover).toHaveLength(1)
    expect(failover[0]).toContain('source=a@dsh;class=quota;cooldownMs=900000;from=a@dsh;to=b@dsh（task-135 同dispatch换源）')
  })

  it('预算预检改选他执行器的源 → 首绑即换绑一次（agy 段跑一次→dsh 段一次→launch dsh）；不记 FAILOVER', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-7')); roots.push(root)
    const h = await harness(root, BUDGET_YAML, { configOverrides: { allowBudgetDowngrade: true, budgetTicketCapUsd: 0.02 } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.counts.launches).toEqual({ dsh: 1 })
    expect(h.counts.detects).toEqual({ agy: 1, dsh: 1 })
    const ledger = await ledgerOf(h)
    const dispatch = notesOf(ledger, ticket, 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toContain('executor=dsh@0.0.0-fake')
    expect(dispatch[0]).toContain(';routing=b@dsh;routing-price=in$0.1/out$0.2;routing-skipped=a:budget')
    expect(dispatch[0]).not.toContain('routing-fallbackFrom')
    expect(notesOf(ledger, ticket, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')).toHaveLength(0)
    expect(ledger.listWorkRecords({ issue: ticket }).map((r) => r.executor)).toEqual(['dsh'])
  })
})
