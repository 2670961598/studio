/**
 * task-157 / FIX-03：供给级配额门控（docs/quality/supply-quota-gating.md §2/§5）。
 *
 * 场景（引擎级，fake adapter 包 launch + mode 函数，不新增生产缝）：
 *  ① 同池他源不再被派发（换源只换他池）；FAILOVER 尾段携 errorKind/retryable/resetAt；池入 kv/healthz
 *  ② reset 前零无效重试：决策级 HOLD_QUOTA_WAIT——不占泳道/不烧 attempt/不落 GATE_FAIL/不刷屏；跨单共享
 *  ③ 恢复期单探针：过 reset 恰一次派发，探针成功收割后放开
 *  ④ 探针再失败 → 按新 reset 重新阻塞
 *  ⑤ 无 reset 文案 → 退化：阻塞至 now+源冷却（=现行为），到期单探针
 *  ⑥ worker 运行内 429（收割面，事故同型）：GATE_FAIL/FAILOVER 携 errorKind；回填后新派发被 hold
 *  ⑦ 限速（1302）/ overloaded 不入池：同池他源照常换源
 *  ⑧ 派发即认领（execute 级单元；决策级门控未开的面）：选中恢复期池源=认领单探针、他单在途不冒认、换源他池释放
 *  ⑨ 重启续接（kv `model-routing.quota` 跨引擎）：阻塞窗照 hold、过 reset 单探针；坏 kv=全开（现行为）
 *  ⑩ 看门狗消亡面咬合（探针单 WORKER_DEAD）：GATE_FAIL 尾段 errorKind=worker_dead；咬合即释放探针认领
 *  ⑪ 回归（FIX-03 D1）：收割成功态同落 kv `model-routing.state`——重启续接健康态，不回旧失败态
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createModelCatalog,
  emptySupplyQuotaState,
  modelSourcesOf,
  parseModelsYaml,
  quotaPoolVerdict,
  recordQuotaBlock,
  type ModelSourceSpec,
} from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, ExecutorAdapter, TaskBrief } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type TickReport } from '../../../src/engine/engine.ts'
import type { EngineConfig } from '../../../src/engine/tick/types.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { takeOverRunningWorkRecords } from '../../../src/engine/harvest/inflight-takeover.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { holdQuotaLinesOf } from '../../../src/assembly/render/tick.ts'
import { quotaProbeNote } from '../../../src/engine/routing/quota-gate.ts'
import { deserializeRoutingState } from '../../../src/engine/routing/router.ts'
import type { EngineRuntime } from '../../../src/engine/runtime/types.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

/** 2026-11-26 14:00 北京时间（时钟可拨） */
const BASE = Date.parse('2026-11-26T06:00:00.000Z')
/** 文案「2026-11-26 16:00:00 重置」=UTC 08:00 */
const RESET = Date.parse('2026-11-26T08:00:00.000Z')
const RESET2 = Date.parse('2026-11-27T08:00:00.000Z')
const RESET_ISO = '2026-11-26T08:00:00.000Z'
const RESET2_ISO = '2026-11-27T08:00:00.000Z'
/** GLM 周期窗原文（哨查日志同型） */
const glmWeek = (resetBeijing: string): Error => new Error(`429 code=1310 "您已达到每周/每月使用上限，您的限额将在 ${resetBeijing} 重置"`)

const MODELS_YAML = `tiers:
  high:
    sources:
      - id: a1
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}
      - id: a2
        provider: glm
        model: GLM-5.3-Air
        priority: 20
        price: {inputPerM: 1, outputPerM: 2}
        cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}
      - id: b
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 30
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
  readonly clock: { now: number }
}

/** layout='solo'=仅 a1（单源面）；'pair'=a1,a2 同池（glm）；'three'=+b（opencode-go 异池）。launchErrors[i]=第 i+1 次 launch 抛错；modes[i]=该次 launch 的 fake 形态；
 *  opts.limits/opts.laneCapacity=引擎并发上限/泳道槽数（缺省=引擎缺省：单槽、人位 1）——探针他单 hold 面需并发余量；
 *  opts.platform=续用平台（重启面：同 root=同台账/同 kv，新引擎＋旧平台） */
async function harness(
  root: string,
  layout: 'solo' | 'pair' | 'three',
  launchErrors: Array<unknown | undefined>,
  modes: FakeAdapterMode[] = [],
  opts: {
    laneCapacity?: Readonly<Record<string, number>>
    limits?: EngineConfig['limits']
    platform?: ReturnType<typeof createFakePlatform>
  } = {},
): Promise<Harness> {
  const platform = opts.platform ?? createFakePlatform()
  const models = parseModelsYaml(MODELS_YAML)
  const sources = modelSourcesOf(models, 'high').filter((s) => layout === 'three' || (layout === 'pair' ? s.id !== 'b' : s.id === 'a1'))
  const registry = createRegistry()
  const base = createFakeAdapter({ name: 'dsh', mode: () => modes[launches.count - 1] ?? 'ok' })
  const launches = { count: 0 }
  const overlaySets: Array<string | undefined> = []
  let overlay: string | undefined
  const baseCast = base as unknown as { launch: (t: TaskBrief) => Promise<unknown> }
  const adapter = {
    ...base,
    async launch(task: TaskBrief) {
      const i = launches.count
      launches.count += 1
      const fail = launchErrors[i]
      if (fail !== undefined) throw fail
      return baseCast.launch(task)
    },
    setSourceOverlay(p: string | undefined) { overlay = p; overlaySets.push(p) },
    getModel() { return overlay },
    getSourceOverlay() { return overlay },
  } as unknown as ExecutorAdapter
  registry.register(adapter, { default: true })
  const clock = { now: BASE }
  const engine = createEngine({
    platform,
    ledger: (await import('@studio-next/store')).openLedger(path.join(root, 'ledger.sqlite')),
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/quality/supply-quota-gating.md §2'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => clock.now,
    catalog: createModelCatalog(models),
    modelRouting: { sources: { high: sources }, rootDir: root },
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      modelTierByRole: { main_worker: 'high' },
      modelTierTickets: { 'T-1': 'high', 'T-2': 'high', 'T-3': 'high' },
      ...(opts.laneCapacity !== undefined ? { laneCapacity: opts.laneCapacity } : {}),
      ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { engine, platform, ledgerRoot: path.join(root, 'ledger.sqlite'), launches, overlaySets, clock }
}

async function createTicket(h: Harness): Promise<string> {
  const t = await h.platform.issues.create({ title: 'quota probe', type: 'task', level: 0 })
  return t.id
}

/** 逐拍直到 pred 成立（缺省按 launches 判）；返回期间各拍报告 */
async function tickUntil(h: Harness, pred: (r: TickReport) => boolean, max = 8): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < max; i += 1) {
    const r = await h.engine.tick()
    reports.push(r)
    if (pred(r)) break
  }
  return reports
}
const launched = (h: Harness, n: number) => (): boolean => h.launches.count >= n

async function eventsOf(h: Harness, ticket: string): Promise<EventRecord[]> {
  const store = (await import('@studio-next/store')).openLedger(h.ledgerRoot)
  return store.queryEvents({ issue: ticket })
}
const withNote = (events: EventRecord[], name: string, needle: string): EventRecord[] =>
  events.filter((e) => e.event === name && (e.note ?? '').includes(needle))
const holdOf = (r: TickReport): Array<string> => r.phases.stateDiff.decisions.filter((d) => d.code === 'HOLD_QUOTA_WAIT').map((d) => d.ticket).sort()
const field = (note: string | undefined, key: string): string | undefined => (note === undefined ? undefined : new RegExp(`(?:^|;)${key}=([^;]*)`).exec(note)?.[1])

describe('task-157 供给级配额门控', () => {
  it('① 同池他源不再被派发、换源只换他池；FAILOVER 携分类段；池状态入 kv/healthz', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-1')); roots.push(root)
    const h = await harness(root, 'three', [glmWeek('2026-11-26 16:00:00')])
    const ticket = await createTicket(h)
    const reports = await tickUntil(h, launched(h, 2))
    expect(reports.flatMap((r) => r.errors)).toEqual([])
    expect(h.launches.count).toBe(2) // a1 → b；a2 同池不再被试
    expect(h.overlaySets.map((o) => /--([-\w]+)\.yml$/.exec(o ?? '')?.[1])).toEqual(['a1', 'b', undefined])
    const events = await eventsOf(h, ticket)
    const dispatch = withNote(events, 'DISPATCH', 'routing=')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]?.note).toContain('routing=b')
    expect(dispatch[0]?.note).not.toContain('routing-quota-probe')
    const failover = withNote(events, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')
    expect(failover).toHaveLength(1)
    expect(failover[0]?.note).toContain('class=quota')
    expect(failover[0]?.note?.endsWith(`;errorKind=quota;retryable=false;quotaWindow=week;resetAt=${RESET_ISO};providerCode=1310;provider=glm;account=-`)).toBe(true)
    expect(h.engine.modelRoutingHealth?.()?.quota).toEqual([
      { provider: 'glm', state: 'blocked', window: 'week', blockedUntil: RESET, resetAt: RESET, sources: ['a1', 'a2'] },
    ])
    // 跨单共享：T-2 直接走 b，无二次 429、无二次 FAILOVER
    const t2 = await createTicket(h)
    await tickUntil(h, launched(h, 3))
    const events2 = await eventsOf(h, t2)
    expect(withNote(events2, 'ESCALATE', 'MODEL_ROUTING_FAILOVER')).toHaveLength(0)
    expect(withNote(events2, 'DISPATCH', 'routing=')[0]?.note).toContain('routing=b')
  })

  it('② reset 前零无效重试：决策级 HOLD_QUOTA_WAIT——不占泳道/不烧 attempt/不落 GATE_FAIL/不刷屏；跨单共享', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-2')); roots.push(root)
    const h = await harness(root, 'pair', [glmWeek('2026-11-26 16:00:00')])
    const t1 = await createTicket(h)
    const errors = (await tickUntil(h, launched(h, 1))).flatMap((r) => r.errors).join('\n')
    expect(h.launches.count).toBe(1)
    expect(errors).toContain(`换源不可用（ALL_SOURCES_UNAVAILABLE;tier=high 全部源不可用（冷却/禁用/额度耗尽）：a1:cooldown(until=`)
    expect(errors).toContain(`a2:quota-window(window=week;resetAt=${RESET_ISO};until=${RESET_ISO})`)
    const t2 = await createTicket(h)
    const seen = new Map<string, string>()
    const reports = await tickUntil(h, (r) => holdOf(r).length > 0, 4)
    const holdTick = reports.at(-1)!
    expect(holdOf(holdTick)).toEqual([t1, t2].sort())
    const payload = holdTick.phases.stateDiff.decisions.find((d) => d.code === 'HOLD_QUOTA_WAIT')?.quota
    expect(payload).toMatchObject({ tier: 'high', provider: 'glm', window: 'week', resetAt: RESET, blockedUntil: RESET })
    expect(holdTick.phases.dispatch.dispatched).toBe(0)
    expect(holdQuotaLinesOf(holdTick, seen)).toHaveLength(2)
    const first = withNote(await eventsOf(h, t1), 'ESCALATE', 'MODEL_ROUTING_QUOTA_HOLD')
    expect(first).toHaveLength(1)
    expect(first[0]?.note).toContain(`MODEL_ROUTING_QUOTA_HOLD;tier=high;provider=glm;account=-;quotaWindow=week;resetAt=${RESET_ISO};blockedUntil=${RESET_ISO};sources=a1,a2`)
    const before = await eventsOf(h, t1)
    const a1Cooldown = h.engine.modelRoutingHealth?.()?.sources.find((s) => s.id === 'a1')?.cooldownUntil
    for (let i = 0; i < 3; i += 1) {
      const r = await h.engine.tick()
      expect(r.errors).toEqual([])
      expect(holdQuotaLinesOf(r, seen)).toEqual([])
      expect(holdOf(r)).toEqual([t1, t2].sort())
    }
    expect(h.launches.count).toBe(1)
    expect(withNote(await eventsOf(h, t1), 'ESCALATE', 'MODEL_ROUTING_QUOTA_HOLD')).toHaveLength(1)
    expect(withNote(await eventsOf(h, t2), 'ESCALATE', 'MODEL_ROUTING_QUOTA_HOLD')).toHaveLength(0) // 同池同窗只留痕一次
    const after = await eventsOf(h, t1)
    expect(after).toHaveLength(before.length)
    expect(after.some((e) => e.event === 'GATE_FAIL')).toBe(false)
    expect(h.engine.modelRoutingHealth?.()?.sources.find((s) => s.id === 'a1')?.cooldownUntil).toBe(a1Cooldown) // 源状态零追加失败
    expect(h.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'blocked', window: 'week', resetAt: RESET })
  })

  it('③ 恢复期单探针：过 reset 恰一次派发；探针成功收割后放开', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-3')); roots.push(root)
    // 并发余量：缺省单槽泳道/人位 1 下，探针在途期他单先撞更前置的 HOLD_LANE_BUSY/HOLD_PERSON_BUSY（配额门控在其后）——
    // 开 2 槽+并发 5 使「恢复期 probe-other hold」可见
    const h = await harness(root, 'pair', [glmWeek('2026-11-26 16:00:00')], [], {
      laneCapacity: { core: 2 },
      limits: { maxActionsPerTick: 5, maxInflight: 5, maxInflightPerPerson: 5 },
    })
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    const t2 = await createTicket(h)
    const holdReports = await tickUntil(h, (r) => holdOf(r).length >= 2, 4)
    expect(holdOf(holdReports.at(-1)!)).toEqual([t1, t2].sort())
    expect(h.launches.count).toBe(1)
    h.clock.now = RESET + 1
    const probeReports = await tickUntil(h, (r) => r.phases.dispatch.dispatched >= 1, 3)
    const probeTick = probeReports.at(-1)!
    expect(h.launches.count).toBe(2)
    const dispatching = probeTick.phases.stateDiff.decisions.filter((d) => d.actionType === 'dispatch')
    expect(dispatching).toHaveLength(1)
    const probeTicket = dispatching[0]!.ticket
    const other = probeTicket === t1 ? t2 : t1
    expect(withNote(await eventsOf(h, probeTicket), 'DISPATCH', 'routing=')[0]?.note).toContain('routing-quota-probe=1;routing-quota-pool=glm')
    const otherHolds = probeTick.phases.stateDiff.decisions.filter((d) => d.ticket === other && d.code === 'HOLD_QUOTA_WAIT')
    expect(otherHolds).toHaveLength(1)
    expect(otherHolds[0]?.quota?.probeTicket).toBe(probeTicket)
    expect(h.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'probe', probeTicket })
    // 探针在途：他单持续 hold、零新 launch
    const inflight = await h.engine.tick()
    expect(h.launches.count).toBe(2)
    expect(inflight.phases.stateDiff.decisions.filter((d) => d.ticket === other && d.code === 'HOLD_QUOTA_WAIT')).toHaveLength(1)
    // 探针成功收割 → 池开 → 他单正常派发（非探针）
    await tickUntil(h, (r) => r.phases.dispatch.dispatched >= 1, 4)
    expect(h.launches.count).toBe(3)
    expect(withNote(await eventsOf(h, other), 'DISPATCH', 'routing=')[0]?.note ?? '').not.toContain('routing-quota-probe')
    expect(h.engine.modelRoutingHealth?.()?.quota).toEqual([])
  })

  it('④ 探针再失败 → 按新 reset 重新阻塞；其后零重试', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-4')); roots.push(root)
    const h = await harness(root, 'pair', [glmWeek('2026-11-26 16:00:00'), glmWeek('2026-11-27 16:00:00')])
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    await h.engine.tick() // hold
    h.clock.now = RESET + 1
    const errors = (await tickUntil(h, (r) => r.phases.dispatch.dispatched >= 1, 3)).flatMap((r) => r.errors).join('\n')
    expect(h.launches.count).toBe(2)
    expect(errors).toContain('换源不可用（ALL_SOURCES_UNAVAILABLE')
    expect(h.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'blocked', window: 'week', resetAt: RESET2, blockedUntil: RESET2 })
    for (let i = 0; i < 3; i += 1) {
      const r = await h.engine.tick()
      expect(r.errors).toEqual([])
    }
    expect(h.launches.count).toBe(2)
    const resets = withNote(await eventsOf(h, t1), 'ESCALATE', 'MODEL_ROUTING_FAILOVER').map((e) => field(e.note, 'resetAt'))
    expect(resets).toEqual([RESET_ISO, RESET2_ISO])
  })

  it('⑤ 无 reset 文案 → 退化：阻塞至 now+源冷却（=现行为），到期单探针', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-5')); roots.push(root)
    const h = await harness(root, 'pair', [new Error('upstream 429 Too Many Requests')])
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    const r = await h.engine.tick()
    expect(holdOf(r)).toEqual([t1])
    const row = h.engine.modelRoutingHealth?.()?.quota?.[0]
    expect(row).toMatchObject({ provider: 'glm', state: 'blocked', window: 'unknown', blockedUntil: BASE + 900_000 })
    expect(row?.resetAt).toBeUndefined()
    h.clock.now = BASE + 900_000
    await tickUntil(h, (x) => x.phases.dispatch.dispatched >= 1, 3)
    expect(h.launches.count).toBe(2)
    expect(withNote(await eventsOf(h, t1), 'DISPATCH', 'routing=')[0]?.note).toContain('routing-quota-probe=1')
  })

  it('⑥ worker 运行内 429（收割面，事故同型）：GATE_FAIL/FAILOVER 携 errorKind；回填后新派发被 hold', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-6')); roots.push(root)
    const h = await harness(root, 'pair', [], ['external_error'])
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    h.clock.now = BASE + 60_000 // 收割晚于派发（冻结钟下 outcome≤DISPATCH 同 ts → 消费键不释放=DEDUP_NOOP，与本单无关）
    const harvested = await tickUntil(h, (r) => r.events.some((e) => e.event === 'GATE_FAIL'), 4)
    const gate = harvested.at(-1)?.events.find((e) => e.event === 'GATE_FAIL')
    expect(gate?.note?.endsWith(';errorKind=quota;retryable=false;quotaWindow=unknown;provider=glm;account=-')).toBe(true)
    const failover = withNote(await eventsOf(h, t1), 'ESCALATE', 'MODEL_ROUTING_FAILOVER')
    expect(failover).toHaveLength(1)
    expect(failover[0]?.note?.endsWith(';errorKind=quota;retryable=false;quotaWindow=unknown;provider=glm;account=-')).toBe(true)
    expect(h.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'blocked', window: 'unknown' })
    for (let i = 0; i < 2; i += 1) {
      const r = await h.engine.tick()
      expect(holdOf(r)).toEqual([t1])
      expect(r.errors).toEqual([])
    }
    expect(h.launches.count).toBe(1)
  })

  it('⑦ 限速（1302）/ overloaded 不入池：同池他源照常换源', async () => {
    const cases = [
      { err: new Error('429 code=1302 "账户速率限制，请稍后重试"'), kind: 'rate_limit' },
      { err: new Error('429 [overloaded] the server is overloaded'), kind: 'overload' },
    ] as const
    for (const [i, c] of cases.entries()) {
      const root = mkdtempSync(path.join(tmpdir(), `sn-quota-7-${String(i)}`)); roots.push(root)
      const h = await harness(root, 'pair', [c.err])
      const t1 = await createTicket(h)
      const reports = await tickUntil(h, launched(h, 2))
      expect(reports.flatMap((r) => r.errors)).toEqual([])
      expect(h.launches.count).toBe(2) // a1 → a2（同池，不被跳过）
      expect(h.engine.modelRoutingHealth?.()?.quota).toEqual([])
      const note = withNote(await eventsOf(h, t1), 'ESCALATE', 'MODEL_ROUTING_FAILOVER')[0]?.note ?? ''
      expect(field(note, 'errorKind')).toBe(c.kind)
      expect(field(note, 'retryable')).toBe('true')
    }
  })

  it('⑧ 派发即认领（execute 级单元；决策级门控未开的面）：选中恢复期池源=认领单探针；他单在途不冒认；换源他池释放', () => {
    const kv = new Map<string, string>()
    const quota = recordQuotaBlock(emptySupplyQuotaState(), { pool: 'glm', window: 'week', resetAt: RESET, now: BASE, fallbackMs: 900_000, sourceId: 'a1' })
    const rt = { modelRouting: { quota }, ledger: { kvSet: (key: string, value: string) => { kv.set(key, value) } } } as unknown as EngineRuntime
    const a1 = { id: 'a1', provider: 'GLM' } as ModelSourceSpec // provider 大小写/空白归一
    const b = { id: 'b', provider: 'opencode-go' } as ModelSourceSpec
    // 阻塞期：不认领、无尾段、不落 kv
    expect(quotaProbeNote(rt, a1, 'T-1', BASE)).toBe('')
    expect(kv.size).toBe(0)
    // 恢复期：选中即认领（本单无决策级认领）
    expect(quotaProbeNote(rt, a1, 'T-1', RESET + 1)).toBe(';routing-quota-probe=1;routing-quota-pool=glm')
    expect(kv.get('model-routing.quota')).toContain('"ticket":"T-1"')
    expect(quotaPoolVerdict(rt.modelRouting!.quota, 'glm', 'T-2', RESET + 2)).toBe('probe-other')
    // 他单（select 层已跳过；即便到达）不冒认
    expect(quotaProbeNote(rt, a1, 'T-2', RESET + 2)).toBe('')
    expect(quotaPoolVerdict(rt.modelRouting!.quota, 'glm', 'T-1', RESET + 2)).toBe('probe-mine')
    // 本单换源到他池 → 释放 glm 认领（探针未发生，不得占位）
    expect(quotaProbeNote(rt, b, 'T-1', RESET + 3)).toBe('')
    expect(quotaPoolVerdict(rt.modelRouting!.quota, 'glm', 'T-3', RESET + 3)).toBe('probe-claimable')
  })

  it('⑨ 重启续接（kv 跨引擎）：阻塞窗照 hold、零新 launch；坏 kv=保守重置全开（现行为）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-9')); roots.push(root)
    const h = await harness(root, 'pair', [glmWeek('2026-11-26 16:00:00')])
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    await h.engine.dispose()
    // 新引擎（同台账=model-routing.quota 续接；平台续用；时钟不变=阻塞窗未到）
    const restarted = await harness(root, 'pair', [], [], { platform: h.platform })
    const t2 = await createTicket(restarted)
    const r = await restarted.engine.tick()
    expect(r.errors).toEqual([])
    expect(holdOf(r)).toEqual([t1, t2].sort())
    expect(restarted.launches.count).toBe(0)
    expect(restarted.engine.modelRoutingHealth?.()?.quota).toEqual([
      { provider: 'glm', state: 'blocked', window: 'week', blockedUntil: RESET, resetAt: RESET, sources: ['a1', 'a2'] },
    ])
    // 阻塞期留痕按引擎去重（routingWarnings 不持久化=重启后再留一条；已知噪声，非每拍）
    const holdNotes = [...(await eventsOf(restarted, t1)), ...(await eventsOf(restarted, t2))]
      .filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('MODEL_ROUTING_QUOTA_HOLD'))
    expect(holdNotes).toHaveLength(1)
    // 坏 kv（手改/截断）→ 反序列化保守重置=全开：不崩、不 hold、照常派发（现行为）
    await restarted.engine.dispose()
    openLedger(h.ledgerRoot).kvSet('model-routing.quota', '{not-json')
    const recovered = await harness(root, 'pair', [], [], { platform: h.platform })
    const t3 = await createTicket(recovered)
    const open = await recovered.engine.tick()
    expect(open.errors).toEqual([])
    expect(holdOf(open)).toEqual([])
    expect(recovered.engine.modelRoutingHealth?.()?.quota).toEqual([])
    expect(open.phases.dispatch.dispatched).toBe(1) // 首拍即照常派发（非探针）
    expect(recovered.launches.count).toBe(1)
    const dispatchNotes = (await Promise.all([t1, t2, t3].map((t) => eventsOf(recovered, t))))
      .flat().filter((e) => e.event === 'DISPATCH').map((e) => e.note ?? '')
    expect(dispatchNotes).toHaveLength(1)
    expect(dispatchNotes[0]).not.toContain('routing-quota-probe')
  })

  it('⑩ 看门狗消亡面咬合（探针单 WORKER_DEAD）：GATE_FAIL 尾段 errorKind=worker_dead；咬合即释放认领（下拍可再认领）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-10')); roots.push(root)
    const capacity = { laneCapacity: { core: 2 }, limits: { maxActionsPerTick: 5, maxInflight: 5, maxInflightPerPerson: 5 } }
    const h = await harness(root, 'pair', [glmWeek('2026-11-26 16:00:00')], ['ok', 'stalled'], capacity) // 第 2 次 launch=探针，须驻留
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    const t2 = await createTicket(h)
    await tickUntil(h, (r) => holdOf(r).length >= 2, 4)
    h.clock.now = RESET + 1
    await tickUntil(h, (r) => r.phases.dispatch.dispatched >= 1, 3) // 探针在途（stalled：流驻留不收尾）
    expect(h.launches.count).toBe(2)
    const probeTicket = (await eventsOf(h, t1)).some((e) => e.event === 'DISPATCH' && (e.note ?? '').includes('routing-quota-probe=1')) ? t1 : t2
    const other = probeTicket === t1 ? t2 : t1
    expect(h.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'probe', probeTicket })
    // 停机（record 留 running）→ serve 例行接管 → interrupted＋无在途句柄 → 新引擎首拍消亡面收口
    await h.engine.dispose()
    takeOverRunningWorkRecords(openLedger(h.ledgerRoot), h.clock.now)
    const restarted = await harness(root, 'pair', [], [], { ...capacity, platform: h.platform })
    restarted.clock.now = h.clock.now
    const first = await restarted.engine.tick()
    expect(first.errors).toEqual([])
    const dead = withNote(await eventsOf(restarted, probeTicket), 'GATE_FAIL', 'WORKER_DEAD')
    expect(dead).toHaveLength(1)
    expect(dead[0]?.note?.endsWith(';errorKind=worker_dead;retryable=true')).toBe(true)
    // 决策时（咬合前）他单仍 probe-other hold；咬合后认领释放=池回恢复期、本拍零新 launch
    expect(holdOf(first)).toEqual([other])
    expect(restarted.launches.count).toBe(0)
    expect(restarted.engine.modelRoutingHealth?.()?.quota).toEqual([
      { provider: 'glm', state: 'recovering', window: 'week', blockedUntil: RESET, resetAt: RESET, sources: ['a1', 'a2'] },
    ])
    // 释放后可再认领：下拍恰一单以探针身份重新派发（fake 缺省 ok → 成功收割 → 池开）
    await tickUntil(restarted, (r) => r.phases.dispatch.dispatched >= 1, 3)
    expect(restarted.launches.count).toBe(1)
    expect(restarted.engine.modelRoutingHealth?.()?.quota?.[0]).toMatchObject({ provider: 'glm', state: 'probe' })
    await tickUntil(restarted, (r) => r.phases.dispatch.dispatched >= 2, 5)
    expect(restarted.engine.modelRoutingHealth?.()?.quota).toEqual([])
  })

  it('⑪ 回归（FIX-03 D1）：收割成功态同落 kv model-routing.state——重启续接健康态，不回旧失败态', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-quota-11')); roots.push(root)
    // 单源 a1：首次 no_report → GATE_FAIL（失败态入 kv＋源冷却 15min）；+16min 冷却到期 half-open 重派 ok → GATE_PASS
    const routingStateOf = (h: Harness) => deserializeRoutingState(openLedger(h.ledgerRoot).kvGet('model-routing.state'))
    const healthOf = (h: Harness) => h.engine.modelRoutingHealth?.()?.sources.find((s) => s.id === 'a1')
    const h = await harness(root, 'solo', [], ['no_report'])
    const t1 = await createTicket(h)
    await tickUntil(h, launched(h, 1))
    const FAILED_AT = BASE + 60_000 // 收割晚于派发（同 ⑥）
    h.clock.now = FAILED_AT
    const failed = await tickUntil(h, (r) => r.events.some((e) => e.event === 'GATE_FAIL'), 4)
    expect(failed.flatMap((r) => r.events).filter((e) => e.event === 'GATE_FAIL')).toHaveLength(1)
    expect(routingStateOf(h)['a1']).toEqual({ consecutiveFailures: 1, cooldownUntil: FAILED_AT + 900_000, halfOpen: false, lastFailureClass: 'server', lastFailureAt: FAILED_AT })
    // 冷却期内：单源不可用，零重试（源级冷却在途）
    h.clock.now = FAILED_AT + 5 * 60_000
    const cooling = await h.engine.tick()
    expect(h.launches.count).toBe(1)
    expect(cooling.errors.join('\n')).toContain('a1:cooldown(until=')
    // +16min：冷却到期 → half-open 候选恰一次 → ok 收割 → GATE_PASS（恰一次、零多余重试）
    h.clock.now = FAILED_AT + 16 * 60_000
    const passed = await tickUntil(h, (r) => r.events.some((e) => e.event === 'GATE_PASS'), 6)
    expect(h.launches.count).toBe(2)
    expect(passed.flatMap((r) => r.events).filter((e) => e.event === 'GATE_PASS')).toHaveLength(1)
    const pass = (await eventsOf(h, t1)).find((e) => e.event === 'GATE_PASS')
    expect(pass?.attempt).toBe(2)
    // D1 修复点：成功态（失败清零/冷却清除/lastSuccessAt 更新）须落 kv——修复前仅改内存态，kv 停留上一步失败态
    expect(routingStateOf(h)['a1']).toEqual({ consecutiveFailures: 0, cooldownUntil: 0, halfOpen: false, lastSuccessAt: pass?.ts })
    // 重启续接（同台账）：新引擎从 kv 加载＝旧引擎内存态（健康），不回旧失败态（docs/quality/model-routing.md §4）
    const before = healthOf(h)
    expect(before).toMatchObject({ available: true, cooldownUntil: 0, lastSuccessAt: pass?.ts })
    await h.engine.dispose()
    const restarted = await harness(root, 'solo', [], ['no_report'], { platform: h.platform })
    expect(healthOf(restarted)).toEqual(before)
    expect(healthOf(restarted)).not.toHaveProperty('lastFailureClass')
    // 影响面（D1）：重启后再失败一次 → 计数从 1 起、冷却=base 900000（旧失败态残留时会记 2 次/×2=1800000）
    restarted.clock.now = FAILED_AT + 20 * 60_000
    const t2 = await createTicket(restarted)
    const refailed = await tickUntil(restarted, (r) => r.events.some((e) => e.event === 'GATE_FAIL'), 6)
    expect(refailed.flatMap((r) => r.events).filter((e) => e.event === 'GATE_FAIL')).toHaveLength(1)
    const refailAt = (await eventsOf(restarted, t2)).find((e) => e.event === 'GATE_FAIL')?.ts
    expect(routingStateOf(restarted)['a1']).toMatchObject({ consecutiveFailures: 1, cooldownUntil: (refailAt ?? 0) + 900_000 })
  })
})
