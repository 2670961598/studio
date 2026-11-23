/**
 * kimi-on-dsh §4/§8（docs/quality/kimi-on-dsh.md）：dispatch 相位 KIMI_API_KEY 注入面——
 * 闸门（provider=kimi-coding × dsh 家族执行器）、launch 前现读 token 文件、
 * mtime 龄超阈值按需刷新（刷新败回退现值）、文件缺失/坏形状=不注入不阻派发、
 * failover 换源后重建 brief（新源非 kimi-coding 即不再注入）、token 值不落事件/台账、
 * tier 执行器门控（事故 2026-11-23：dsh-high/dsh-mid/dsh-low 下 routing 面不激活但 tier
 * overlay 生效——注入按实际生效 provider=routedSource ?? tier 解析 provider 判，见 (a)-(d)）。
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { ExecutorAdapter, TaskBrief } from '@studio-next/contract'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type EngineConfig } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { KIMI_API_KEY_ENV, KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT, kimiInjectionActive, kimiTokenCredentials, readKimiTokenFile, type KimiTokenDeps } from '../../../src/engine/dispatch/kimi-token.ts'
import type { RoutingState } from '../../../src/engine/routing/router.ts'
import { serializeRoutingState } from '../../../src/engine/routing/router.ts'

/** 夹具 token（fake- 前缀低熵——scan-repo-secrets PLACEHOLDER 豁免；真 token 永不入仓） */
const TOKEN = 'fake-access-token-standby'
const TOKEN2 = 'fake-access-token-rotated'
const STALE_MS = KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT + 60_000 // 已过新鲜度线的 mtime 龄

/** §2 供给面同形：high 双源（kimi-pro 优先 5 订阅价 0；glm-main 优先 10 兜底）。 */
const MODELS_YAML = `tiers:
  high:
    sources:
      - id: kimi-pro
        provider: kimi-coding
        model: k3.1-pro
        priority: 5
        price: {inputPerM: 0, outputPerM: 0}
        cooldown: {baseMs: 60000, maxMs: 3600000, circuitAfter: 3}
      - id: glm-main
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`

/** 事故 2026-11-23 (b) 场景同形：high 首源=glm（tier 解析 provider=glm；kimi-pro 降为备源）。 */
const MODELS_YAML_GLM_FIRST = `tiers:
  high:
    sources:
      - id: glm-main
        provider: glm
        model: GLM-5.3
        priority: 5
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}
      - id: kimi-pro
        provider: kimi-coding
        model: k3.1-pro
        priority: 10
        price: {inputPerM: 0, outputPerM: 0}
        cooldown: {baseMs: 60000, maxMs: 3600000, circuitAfter: 3}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

describe('kimi-on-dsh §4 注入面（单元）', () => {
  it('闸门：dsh 家族 × kimi-coding 才开（workbench 的 dsh-high/dsh-low 也命中；kimi/claude 执行器或 glm 源不开）', () => {
    expect(kimiInjectionActive('dsh', 'kimi-coding')).toBe(true)
    expect(kimiInjectionActive('dsh-mid', 'kimi-coding')).toBe(true)
    expect(kimiInjectionActive('dsh-high', 'kimi-coding')).toBe(true)
    expect(kimiInjectionActive('dsh-low', 'kimi-coding')).toBe(true)
    expect(kimiInjectionActive('kimi', 'kimi-coding')).toBe(false) // Kimi CLI 执行器（retirement 前仍在册）不注入
    expect(kimiInjectionActive('claude', 'kimi-coding')).toBe(false)
    expect(kimiInjectionActive('dsh', 'glm')).toBe(false)
    expect(kimiInjectionActive('dsh', undefined)).toBe(false)
  })

  it('readKimiTokenFile：缺文件/空/多行/过短 → undefined；形状好 → token+ageMs', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kimi-read-')); roots.push(root)
    const file = path.join(root, 'kimi-access-token')
    expect(readKimiTokenFile({ tokenFile: file })).toBeUndefined()
    writeFileSync(file, 'short\n')
    expect(readKimiTokenFile({ tokenFile: file })).toBeUndefined()
    writeFileSync(file, `${TOKEN}\nextra-line\n`)
    expect(readKimiTokenFile({ tokenFile: file })).toBeUndefined()
    writeFileSync(file, '\n')
    expect(readKimiTokenFile({ tokenFile: file })).toBeUndefined()
    writeFileSync(file, `${TOKEN}\n`)
    const r = readKimiTokenFile({ tokenFile: file, now: () => Date.now() + 60_000 })
    expect(r?.token).toBe(TOKEN)
    expect(r?.ageMs).toBeGreaterThan(59_000) // 浮点容差：mtime 与取时点的毫秒级错位
    expect(r?.ageMs).toBeLessThanOrEqual(60_000)
  })

  it('kimiTokenCredentials：未过闸=undefined；纯读模式（无 refresh）文件缺=undefined 不抛；坏形状同义', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kimi-gate-')); roots.push(root)
    const deps: KimiTokenDeps = { tokenFile: path.join(root, 'none') }
    expect(await kimiTokenCredentials(deps, { executorName: 'dsh', provider: 'kimi-coding' })).toBeUndefined()
    expect(await kimiTokenCredentials(deps, { executorName: 'dsh', provider: 'glm' })).toBeUndefined()
    expect(await kimiTokenCredentials(deps, { executorName: 'kimi', provider: 'kimi-coding' })).toBeUndefined()
  })
})

interface Harness {
  readonly engine: ReturnType<typeof createEngine>
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledgerRoot: string
  readonly launches: { count: number }
  readonly briefs: TaskBrief[]
  readonly overlaySets: Array<string | undefined>
  readonly refreshCalls: { count: number }
}

/** launchFailures[i]=第 i+1 次 launch 抛错（undefined=成功走真 fake）；adapterName/kimi 为注入面参数；modelsYaml/routingState/tierFaceOff 供 tier 门控场景（事故 2026-11-23）换装。 */
async function harness(root: string, opts: { launchFailures?: Array<unknown | undefined>; adapterName?: string; kimi?: KimiTokenDeps; config?: Partial<EngineConfig>; modelsYaml?: string; routingState?: RoutingState; tierFaceOff?: boolean } = {}): Promise<Harness> {
  const platform = createFakePlatform()
  const models = parseModelsYaml(opts.modelsYaml ?? MODELS_YAML)
  const ledger = (await import('@studio-next/store')).openLedger(path.join(root, 'ledger.sqlite'))
  // 路由态真源=daemon_kv（create-runtime 构造时反序列化重建）——预冷却经 kv 播种，不传内存对象
  if (opts.routingState !== undefined) ledger.kvSet('model-routing.state', serializeRoutingState(opts.routingState))
  const registry = createRegistry()
  const base = createFakeAdapter({ name: opts.adapterName ?? 'dsh' })
  const launches = { count: 0 }
  const briefs: TaskBrief[] = []
  const overlaySets: Array<string | undefined> = []
  const baseCast = base as unknown as { launch: (t: TaskBrief) => Promise<unknown> }
  const adapter = {
    ...base,
    async launch(task: TaskBrief) {
      const i = launches.count
      launches.count += 1
      briefs.push(task)
      const fail = opts.launchFailures?.[i]
      if (fail !== undefined) throw fail
      return baseCast.launch(task)
    },
    setSourceOverlay(p: string | undefined) { overlaySets.push(p) }, // fake 无 overlay 面——只记录（同 task-135 harness）
    setModel(_m: string | undefined) { /* 记录面略——本测试不断言 model */ },
    getSourceOverlay() { return undefined },
    getModel() { return undefined },
  } as unknown as ExecutorAdapter
  registry.register(adapter, { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/17-§2'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => 1_800_000_000_000,
    catalog: createModelCatalog(models),
    modelRouting: { sources: { high: modelSourcesOf(models, 'high') }, rootDir: root, ...(opts.routingState !== undefined ? { state: opts.routingState } : {}) },
    ...(opts.kimi !== undefined ? { kimiToken: opts.kimi } : {}),
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      // tierFaceOff：档选位面关（modelTierByRole 缺席→resolveModelTier=undefined）——(d) 无 tier 解析场景
      ...(opts.tierFaceOff === true ? {} : { modelTierByRole: { main_worker: 'high' }, modelTierTickets: { 'T-1': 'high', 'T-2': 'mid' } }),
      ...opts.config,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { engine, platform, ledgerRoot: path.join(root, 'ledger.sqlite'), launches, briefs, overlaySets, refreshCalls: { count: 0 } }
}

async function dispatchOnce(h: Harness): Promise<{ ticket: string; errors: string[] }> {
  const t = await h.platform.issues.create({ title: 'kimi injection probe', type: 'task', level: 0 })
  const errors: string[] = []
  for (let i = 0; i < 8 && h.launches.count === 0; i += 1) errors.push(...(await h.engine.tick()).errors)
  return { ticket: t.id, errors }
}

describe('kimi-on-dsh §4 注入面（dispatch 集成）', () => {
  it('kimi-coding 源 + dsh 执行器：launch 前 KIMI_API_KEY 已注入；路由命中 kimi-pro；token 值不落事件/台账', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-1')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { kimi: { tokenFile } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(1)
    expect(h.overlaySets[0]).toContain('kimi-pro')
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN)
    const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
    const events = store.queryEvents({ issue: ticket })
    expect(events.filter((e) => e.event === 'DISPATCH')).toHaveLength(1)
    expect(JSON.stringify(events).includes(TOKEN)).toBe(false) // 值红名单：事件/台账零泄漏
  })

  it('token 文件缺失：不注入不阻派发（brief 无 credentials 键）——worker AUTH 失败留给路由兜底', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-2')); roots.push(root)
    const h = await harness(root, { kimi: { tokenFile: path.join(root, 'none') } })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(1)
    expect(h.briefs[0]?.credentials).toBeUndefined()
  })

  it('mtime 龄超阈值 → 按需刷新后注入新值；mid（glm 源）→ 零注入；kimi 执行器 → 零注入', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-3')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const stale = new Date(Date.now() - STALE_MS)
    utimesSync(tokenFile, stale, stale)
    const refreshCalls = { count: 0 }
    const refresh = async () => {
      refreshCalls.count += 1
      writeFileSync(tokenFile, `${TOKEN2}\n`, { mode: 0o600 }) // 假刷新器：轮换新值落盘
      return { ok: true }
    }
    const h = await harness(root, { kimi: { tokenFile, refresh } })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(refreshCalls.count).toBe(1)
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN2) // 刷新后重读=新值
    // 同 dsh 执行器、非 kimi-coding 源（mid=glm 直连，无路由源）→ 零注入
    const root2 = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-3b')); roots.push(root2)
    const tokenFile2 = path.join(root2, 'kimi-access-token')
    writeFileSync(tokenFile2, `${TOKEN}\n`, { mode: 0o600 })
    const h2 = await harness(root2, { kimi: { tokenFile: tokenFile2, refresh }, config: { modelTierTickets: { 'T-1': 'mid', 'T-2': 'mid' } } }) // T-1 钉 mid（票面优先于角色）→ mid=glm 直连非 kimi-coding
    await dispatchOnce(h2)
    expect(h2.briefs[0]?.credentials).toBeUndefined()
    // Kimi CLI 执行器（非 dsh 家族，retirement 前仍在册）→ 零注入
    const root3 = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-3c')); roots.push(root3)
    const tokenFile3 = path.join(root3, 'kimi-access-token')
    writeFileSync(tokenFile3, `${TOKEN}\n`, { mode: 0o600 })
    const h3 = await harness(root3, { adapterName: 'kimi', kimi: { tokenFile: tokenFile3 } })
    await dispatchOnce(h3)
    expect(h3.briefs[0]?.credentials).toBeUndefined()
  })

  it('刷新失败 → 回退现有（陈旧）文件值（fail-safe 不阻派发）；新鲜文件不触发刷新', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-4')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const stale = new Date(Date.now() - STALE_MS)
    utimesSync(tokenFile, stale, stale)
    const refreshCalls = { count: 0 }
    const h = await harness(root, { kimi: { tokenFile, refresh: async () => { refreshCalls.count += 1; return { ok: false } } } })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(refreshCalls.count).toBe(1)
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN) // 陈旧值保命（§4 fail-safe）
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 }) // 新鲜文件（mtime=现在）
    const h2 = await harness(root, { kimi: { tokenFile, refresh: async () => { refreshCalls.count += 1; return { ok: false } } } })
    await dispatchOnce(h2)
    expect(refreshCalls.count).toBe(1) // 新鲜文件（≤240s）零刷新——dispatch 在线路径不加负担
  })

  it('failover 换源后重建 brief：kimi-pro 5xx → glm-main 重试 launch 不再带 KIMI_API_KEY', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-inj-5')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { launchFailures: [new Error('upstream 503 unavailable')], kimi: { tokenFile } })
    const { ticket, errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(2)
    expect(h.overlaySets[0]).toContain('kimi-pro')
    expect(h.overlaySets[1]).toContain('glm-main')
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN) // 首源注入
    expect(h.briefs[1]?.credentials?.[KIMI_API_KEY_ENV]).toBeUndefined() // 换源重建：glm 源零注入
    expect(h.briefs[1]?.credentials).toBeUndefined()
    const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
    const events = store.queryEvents({ issue: ticket })
    expect(JSON.stringify(events).includes(TOKEN)).toBe(false)
  })
})

describe('kimi-on-dsh §4 注入门控 × tier 执行器（事故 2026-11-23：tier overlay 生效但 routedSource 缺位）', () => {
  it('(a) executor=dsh-high + tier 解析 high provider=kimi-coding（routing 面不激活、无 routedSource）→ 注入 KIMI_API_KEY', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-tier-1')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { adapterName: 'dsh-high', kimi: { tokenFile } })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(1)
    expect(h.overlaySets[0]).toBeUndefined() // routing 面确未激活（无 per-source overlay）——生效面是 tier overlay（models.yaml hot-swap）
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN) // tier 解析 provider=kimi-coding → 注入（原 bug：只认 routedSource → 恒不注入）
  })

  it('(b) executor=dsh-high + tier 解析 high provider=glm → 不注入', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-tier-2')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { adapterName: 'dsh-high', kimi: { tokenFile }, modelsYaml: MODELS_YAML_GLM_FIRST })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(1)
    expect(h.briefs[0]?.credentials).toBeUndefined() // tier provider=glm：闸门不开（fail-safe 不改派发语义）
  })

  it('(c) routedSource=kimi-coding（dsh 路由面）→ 仍注入；换源 glm 后 routedSource 优先于 tier provider → 不注入', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-tier-3')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { kimi: { tokenFile } })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.overlaySets[0]).toContain('kimi-pro')
    expect(h.briefs[0]?.credentials?.[KIMI_API_KEY_ENV]).toBe(TOKEN) // 回归：路由面注入不因 tier 兜底漂移
    // 镜像面：kimi-pro 预冷却 → 路由选中 glm-main（tier 解析 provider 仍=kimi-coding）→ routedSource 优先 → 不注入
    const root2 = mkdtempSync(path.join(tmpdir(), 'sn-kimi-tier-3b')); roots.push(root2)
    const tokenFile2 = path.join(root2, 'kimi-access-token')
    writeFileSync(tokenFile2, `${TOKEN}\n`, { mode: 0o600 })
    const h2 = await harness(root2, { kimi: { tokenFile: tokenFile2 }, routingState: { 'kimi-pro': { consecutiveFailures: 1, cooldownUntil: 1_800_000_000_000 + 3_600_000, halfOpen: false } } })
    await dispatchOnce(h2)
    expect(h2.overlaySets[0]).toContain('glm-main')
    expect(h2.briefs[0]?.credentials).toBeUndefined()
  })

  it('(d) 无 tier 解析（modelTierByRole 面）→ 不注入（routedSource/tierProvider 皆 undefined，不阻派发）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-kimi-tier-4')); roots.push(root)
    const tokenFile = path.join(root, 'kimi-access-token')
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
    const h = await harness(root, { kimi: { tokenFile }, tierFaceOff: true })
    const { errors } = await dispatchOnce(h)
    expect(errors).toHaveLength(0)
    expect(h.launches.count).toBe(1)
    expect(h.overlaySets[0]).toBeUndefined()
    expect(h.briefs[0]?.credentials).toBeUndefined()
  })
})
