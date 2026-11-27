/**
 * task-141 返工回归（独立 verifier 退回项 1-5 的复现用例）：绑定段清理、放行集合档位范围、
 * 链锁定归因、换绑登记撤销、换绑不稳定。受检面 engine/dispatch/{bound-stage,execute}.ts、
 * engine/routing/source-executor.ts、engine/work/derivation-registration.ts。
 *
 * 依据：docs/quality/model-routing.md §10（源 executor 与跨执行器换源；§10.6 用例表）。
 * 口径＝verifier 探针 P1-P4 同参数（真实引擎 tick＋fake 适配器；不真调任何执行器）：
 *   F1 默认路径（未配 executor；bridge 通道）：绑定段写完指令文件后抛错／launch 失败 →
 *      `<rootDir>/tmp/instructions/<单号>.md` 须删；launch 后抛错 → 已启动 worker 须 kill
 *     （与抽件前 execute.ts 外层 instructionsPath／adapter 变量同语义）。
 *   F2 选择闸放行集合按**派发档位**取 sources executor 家族（他档 executor 不放行）。
 *   F3 选择链改派（chainLocked）且链执行器非源家族 → 源未实际执行，不归因。
 *   F4 launch 前换绑 → 被弃段未 spawn 的派生登记须撤（登记面无撤销口=fail-closed 不换绑）；
 *      launch 后换源换绑 → 被弃段已 spawn，登记行如实留痕不撤。
 *   F5 EXECUTOR_REBIND_UNSTABLE：预算预检随适配器任务书长度变化 → fail-closed 明报、零 launch。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { SelectionChainEntry } from '@studio-next/adapters/bindcard'
import type { ExecutorAdapter, IssueRecord, PortResult, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type EngineConfig } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { instructionsTarget } from '../../../src/engine/instructions-store.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { deserializeRoutingState } from '../../../src/engine/routing/router.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import type { DispatchDerivationRegistry } from '../../../src/engine/work/derivation-registration.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })
/** 等长 tag（F5 按任务书 token 标定票帽窗口——任务书含 workspace 路径，路径长度须一致） */
const fresh = (tag: string): string => { const r = mkdtempSync(path.join(tmpdir(), `r141-${tag}-`)); roots.push(r); return r }

const TIERS_TAIL = `  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`
/** 默认路径：high 单源不带 executor（routing 面开、executor 面关） */
const DEFAULT_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
${TIERS_TAIL}`
/** 仅 high 档面开：a@agy */
const HIGH_ONLY_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, executor: agy}
${TIERS_TAIL}`
/** high 两源跨执行器：a=agy（首源，带冷却）、b=dsh（次源） */
const MIXED_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, cooldown: {baseMs: 900000, maxMs: 3600000, circuitAfter: 3}, executor: agy}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 2, outputPerM: 10}, executor: dsh}
${TIERS_TAIL}`
/** 预算预检改选：首源 a（agy）天价、次源 b（dsh）贱价——票帽 1 USD 下 a 恒超帽、b 恒在帽内 */
const BUDGET_YAML = `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: big, priority: 10, price: {inputPerM: 1000000, outputPerM: 1000000}, executor: agy}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 0.001, outputPerM: 0.002}, executor: dsh}
${TIERS_TAIL}`

const QUOTA = new Error('upstream 429 quota exhausted')

type Channel = 'native' | 'user_level'
interface AdapterSpec {
  readonly name: string
  /** AGENTS.md 通道能力（缺省 native；user_level=bridge 插件通道→每任务临时指令文件） */
  readonly channel?: Channel
  /** dsh 家族 overlay/model 端子 */
  readonly dshFace?: boolean
  /** 按次排队的 launch 抛错（第 i+1 次 launch 抛 fail[i]；缺省成功走真 fake） */
  readonly fail?: readonly unknown[]
}
interface Counts {
  readonly launches: Record<string, number>
  readonly detects: Record<string, number>
  readonly kills: Record<string, number>
}
interface Harness {
  readonly engine: ReturnType<typeof createEngine>
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledgerRoot: string
  readonly rootDir: string
  readonly counts: Counts
}
interface HarnessOptions {
  readonly adapters: readonly AdapterSpec[]
  /** 选择闸开（dispatchSelection deps 注入；缺省=面关） */
  readonly gate?: { readonly chain?: readonly SelectionChainEntry[]; readonly personExecutors?: Readonly<Record<string, string>> }
  readonly configOverrides?: Partial<EngineConfig>
  /** 派生登记面桩（缺省不注入=不登记） */
  readonly registry?: DispatchDerivationRegistry
  readonly platform?: ReturnType<typeof createFakePlatform>
}

async function harness(root: string, yaml: string, opts: HarnessOptions): Promise<Harness> {
  const platform = opts.platform ?? createFakePlatform()
  const models = parseModelsYaml(yaml)
  const registry = createRegistry()
  const counts: Counts = { launches: {}, detects: {}, kills: {} }
  const rootDir = path.join(root, 'var')
  opts.adapters.forEach((spec, i): void => {
    const base = createFakeAdapter({ name: spec.name, onKill: () => { counts.kills[spec.name] = (counts.kills[spec.name] ?? 0) + 1 } }) as unknown as Record<string, unknown>
    let overlay: string | undefined
    let model: string | undefined
    registry.register({
      ...base,
      capabilities: spec.channel === undefined ? base.capabilities : { ...(base.capabilities as object), agents_md: spec.channel },
      async detect() { counts.detects[spec.name] = (counts.detects[spec.name] ?? 0) + 1; return (base.detect as () => Promise<unknown>)() },
      async launch(task: TaskBrief) {
        const n = counts.launches[spec.name] ?? 0
        counts.launches[spec.name] = n + 1
        const fail = spec.fail?.[n]
        if (fail !== undefined) throw fail
        return (base.launch as (t: TaskBrief) => Promise<ReturnType<ExecutorAdapter['launch']>>)(task)
      },
      ...(spec.dshFace === true ? {
        setSourceOverlay(p: string | undefined): void { overlay = p },
        setModel(m: string | undefined): void { model = m },
        getSourceOverlay(): string | undefined { return overlay },
        getModel(): string | undefined { return model },
      } : {}),
    } as unknown as ExecutorAdapter, i === 0 ? { default: true } : undefined)
  })
  const engine = createEngine({
    platform,
    ledger: openLedger(path.join(root, 'ledger.sqlite')),
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/17-§2'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => 1_800_000_000_000,
    catalog: createModelCatalog(models),
    modelRouting: { sources: { high: modelSourcesOf(models, 'high') }, rootDir },
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir,
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      modelTierByRole: { main_worker: 'high' },
      modelTierTickets: { 'T-1': 'high', 'T-2': 'mid' },
      ...opts.configOverrides,
    },
    people: DEMO_SNAPSHOT.people,
    ...(opts.gate !== undefined ? { dispatchSelection: { chain: { entries: opts.gate.chain ?? [] }, personExecutors: opts.gate.personExecutors ?? {} } } : {}),
    ...(opts.registry !== undefined ? { derivationRegistry: opts.registry } : {}),
  })
  return { engine, platform, ledgerRoot: path.join(root, 'ledger.sqlite'), rootDir, counts }
}

/** 逐 tick 跑到 pred 成立（或 max 拍）；返回沿途拍错误 */
async function tickUntil(h: Harness, pred: () => boolean, max: number): Promise<string[]> {
  const errors: string[] = []
  for (let i = 0; i < max && !pred(); i += 1) errors.push(...(await h.engine.tick()).errors)
  return errors
}
/** 逐 tick 跑到首个拍错误（或 max 拍）；返回沿途拍错误 */
async function tickUntilError(h: Harness, max: number): Promise<string[]> {
  const errors: string[] = []
  for (let i = 0; i < max && errors.length === 0; i += 1) errors.push(...(await h.engine.tick()).errors)
  return errors
}
async function ledgerOf(h: Harness): Promise<Ledger> { return openLedger(h.ledgerRoot) }
function notes(ledger: Ledger, ticket: TicketId, event: string, needle = ''): string[] {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === event && (e.note ?? '').includes(needle)).map((e) => e.note ?? '')
}
const execOf = (found: readonly string[]): string[] => found.map((n) => /executor=([^;]*)/.exec(n)?.[1] ?? '?')
const createTicket = async (h: Harness, title: string): Promise<TicketId> => (await h.platform.issues.create({ title, type: 'task', level: 0 })).id

/** 派生登记面桩：记登记/撤销 id；withRevoke=false 模拟生产登记面（持久网关无单行撤销口） */
function registryStub(withRevoke: boolean): { readonly face: DispatchDerivationRegistry; readonly registered: string[]; readonly revoked: string[] } {
  const registered: string[] = []
  const revoked: string[] = []
  const ok = (): PortResult<null> => ({ kind: 'ok', value: null })
  const face: DispatchDerivationRegistry = {
    register(record) { registered.push(record.derivationId); return ok() },
    ...(withRevoke ? { revoke(id: string): PortResult<null> { revoked.push(id); return ok() } } : {}),
  }
  return { face, registered, revoked }
}

describe('F1 默认路径（未配 executor）：绑定段写盘后的失败不留指令文件、不漏 kill', () => {
  it('绑定段写完指令文件后抛错（brief.md 预建为目录→EISDIR）→ 指令文件即删（DISPATCH_FAIL 明报、零 launch）', async () => {
    const h = await harness(fresh('f1dir'), DEFAULT_YAML, { adapters: [{ name: 'dsh', channel: 'user_level', dshFace: true }] })
    const t = await createTicket(h, 'f1 brief write fails')
    mkdirSync(path.join(h.rootDir, 'workspaces', t, 'att1', 'brief.md'), { recursive: true })
    const errors = await tickUntil(h, () => (h.counts.detects.dsh ?? 0) >= 1, 3)
    expect(errors.join('\n')).toContain('DISPATCH_FAIL')
    expect(errors.join('\n')).toContain('EISDIR')
    expect(h.counts.launches).toEqual({})
    expect(existsSync(instructionsTarget(h.rootDir, t))).toBe(false)
  })

  it('launch 抛错 → 指令文件即删（无收割会来收本 attempt）', async () => {
    const h = await harness(fresh('f1lau'), DEFAULT_YAML, { adapters: [{ name: 'dsh', channel: 'user_level', dshFace: true, fail: [new Error('spawn ENOENT')] }] })
    const t = await createTicket(h, 'f1 launch fails')
    const errors = await tickUntil(h, () => (h.counts.launches.dsh ?? 0) >= 1, 3)
    expect(errors.join('\n')).toContain('DISPATCH_FAIL：spawn ENOENT')
    expect(h.counts.launches).toEqual({ dsh: 1 })
    expect(existsSync(instructionsTarget(h.rootDir, t))).toBe(false)
  })

  it('launch 后续步抛错（平台迁态失败）→ 已启动 worker 被 kill', async () => {
    const platform = createFakePlatform()
    const issues = platform.issues as unknown as { transition: (id: TicketId, toState: string) => Promise<IssueRecord> }
    issues.transition = async (id, to) => { throw new Error(`transition boom：${id}→${to}`) }
    const h = await harness(fresh('f1kil'), DEFAULT_YAML, { adapters: [{ name: 'dsh', dshFace: true }], platform })
    await createTicket(h, 'f1 transition fails')
    const errors = await tickUntil(h, () => (h.counts.launches.dsh ?? 0) >= 1, 3)
    expect(errors.join('\n')).toContain('DISPATCH_FAIL：transition boom')
    expect(h.counts.launches).toEqual({ dsh: 1 })
    expect(h.counts.kills).toEqual({ dsh: 1 })
  })
})

describe('F2 选择闸放行集合按派发档位取 sources executor 家族', () => {
  it('仅 high 配 a@agy：high 单派 agy；mid 单岗位绑定 agy 不放行（selection-unregistered、零 launch）', async () => {
    const h = await harness(fresh('f2'), HIGH_ONLY_YAML, {
      adapters: [{ name: 'dsh', dshFace: true }, { name: 'agy' }],
      gate: { personExecutors: { 'AGENT-1': 'agy' } },
    })
    const t1 = await createTicket(h, 'f2 high')
    const t2 = await createTicket(h, 'f2 mid')
    const errors = await tickUntil(h, () => false, 4)
    const ledger = await ledgerOf(h)
    expect(h.counts.launches).toEqual({ agy: 1 })
    expect(execOf(notes(ledger, t1, 'DISPATCH'))).toEqual(['agy@0.0.0-fake'])
    expect(notes(ledger, t2, 'DISPATCH')).toEqual([])
    expect(errors.filter((e) => e.includes(t2)).some((e) => e.includes('dispatch/selection-unregistered')), JSON.stringify(errors)).toBe(true)
    expect(errors.filter((e) => e.includes(t1))).toEqual([])
  })
})

describe('F3 选择链改派（chainLocked）且链执行器非源家族：源未实际执行，不归因', () => {
  const CHAIN: readonly SelectionChainEntry[] = [{ ticket: 'T-1', executor: 'kimi', source: 'ticket', registeredBy: 'test', reason: 'f3 链锁定' }]
  const adapters: readonly AdapterSpec[] = [{ name: 'dsh', dshFace: true }, { name: 'agy' }, { name: 'kimi' }]

  it('kimi launch 429 → 源 a 不冷却、无 FAILOVER from/to、无 MODEL_ROUTING 留痕；错误=原始 launch 错', async () => {
    const h = await harness(fresh('f3fai'), MIXED_YAML, { adapters: adapters.map((a) => (a.name === 'kimi' ? { ...a, fail: [QUOTA, QUOTA] } : a)), gate: { chain: CHAIN } })
    await createTicket(h, 'f3 chain lock fails')
    const errors = await tickUntil(h, () => (h.counts.launches.kimi ?? 0) >= 1, 4)
    const ledger = await ledgerOf(h)
    const state = deserializeRoutingState(ledger.kvGet('model-routing.state') ?? '{}')
    expect(h.counts.launches).toEqual({ kimi: 1 })
    expect(state.a?.cooldownUntil ?? 0).toBe(0)
    expect(state.b?.cooldownUntil ?? 0).toBe(0)
    expect(notes(ledger, 'T-1', 'ESCALATE', 'MODEL_ROUTING')).toEqual([])
    expect(errors.join('\n')).toContain('DISPATCH_FAIL：upstream 429 quota exhausted')
    expect(notes(ledger, 'T-1', 'DISPATCH')).toEqual([])
  })

  it('kimi 派发成功 → DISPATCH 锚=tier 改派段、不带 routing= 源锚', async () => {
    const h = await harness(fresh('f3ok'), MIXED_YAML, { adapters, gate: { chain: CHAIN } })
    await createTicket(h, 'f3 chain lock ok')
    const errors = await tickUntil(h, () => (h.counts.launches.kimi ?? 0) >= 1, 4)
    const ledger = await ledgerOf(h)
    expect(errors).toEqual([])
    expect(h.counts.launches).toEqual({ kimi: 1 })
    const dispatch = notes(ledger, 'T-1', 'DISPATCH')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toContain(';tier=high@kimi（选择链改派，不按源 executor 换绑，task-141）')
    expect(dispatch[0]).not.toContain('routing=')
    expect(notes(ledger, 'T-1', 'ESCALATE', 'MODEL_ROUTING')).toEqual([])
  })
})

describe('F4 换绑与派生登记：launch 前换绑撤销被弃段登记（无撤销口=fail-closed）', () => {
  const adapters: readonly AdapterSpec[] = [{ name: 'dsh', dshFace: true }, { name: 'agy' }]
  const budget = { budgetTicketCapUsd: 1, allowBudgetDowngrade: true } satisfies Partial<EngineConfig>

  it('预算预检改选 b@dsh → 换绑前撤销 agy 段登记；dsh 段登记在场、派发落 dsh', async () => {
    const stub = registryStub(true)
    const h = await harness(fresh('f4rev'), BUDGET_YAML, { adapters, configOverrides: budget, registry: stub.face })
    await createTicket(h, 'f4 pre-launch rebind')
    const errors = await tickUntil(h, () => (h.counts.launches.dsh ?? 0) >= 1, 3)
    const ledger = await ledgerOf(h)
    expect(errors).toEqual([])
    expect(h.counts.detects).toEqual({ agy: 1, dsh: 1 })
    expect(stub.registered).toEqual(['T-1:att1:agy', 'T-1:att1:dsh'])
    expect(stub.revoked).toEqual(['T-1:att1:agy'])
    expect(execOf(notes(ledger, 'T-1', 'DISPATCH'))).toEqual(['dsh@0.0.0-fake'])
    expect(notes(ledger, 'T-1', 'DISPATCH')[0]).toContain(';routing=b@dsh')
  })

  it('登记面无撤销口 → 不换绑（EXECUTOR_REBIND_UNREVOKED 明报、零 launch、只留首段登记）', async () => {
    const stub = registryStub(false)
    const h = await harness(fresh('f4no'), BUDGET_YAML, { adapters, configOverrides: budget, registry: stub.face })
    await createTicket(h, 'f4 unrevocable registry')
    const errors = await tickUntilError(h, 3)
    expect(errors[0]).toContain('MODEL_ROUTING_FAIL;tier=high;reason=EXECUTOR_REBIND_UNREVOKED')
    expect(errors[0]).toContain('T-1:att1:agy')
    expect(h.counts.detects).toEqual({ agy: 1 })
    expect(h.counts.launches).toEqual({})
    expect(stub.registered).toEqual(['T-1:att1:agy'])
  })

  it('撤销被拒 / 撤销口抛错 → 同样不换绑（EXECUTOR_REBIND_UNREVOKED、零 launch）', async () => {
    const refused = (): PortResult<null> => ({ kind: 'err', error: { category: 'rejected_state', subcause: 'not-found', retryable: false, sideEffectPossible: false, reconcile: { required: false, reason: '写前拒收' }, responsiblePosition: 'test' } })
    const cases = [
      { tag: 'f4rej', revoke: (): PortResult<null> => refused(), needle: '撤销被拒 rejected_state/not-found' },
      { tag: 'f4thr', revoke: (): PortResult<null> => { throw new Error('gateway down') }, needle: '撤销异常 gateway down' },
    ] as const
    for (const c of cases) {
      const stub = registryStub(true)
      const face: DispatchDerivationRegistry = { register: stub.face.register, revoke: c.revoke }
      const h = await harness(fresh(c.tag), BUDGET_YAML, { adapters, configOverrides: budget, registry: face })
      await createTicket(h, 'f4 revoke refused')
      const errors = await tickUntilError(h, 3)
      expect(errors[0]).toContain('MODEL_ROUTING_FAIL;tier=high;reason=EXECUTOR_REBIND_UNREVOKED')
      expect(errors[0]).toContain(c.needle)
      expect(h.counts.detects).toEqual({ agy: 1 })
      expect(h.counts.launches).toEqual({})
    }
  })

  it('launch 后换源换绑（agy 429→dsh）：被弃段已 spawn，登记行留痕不撤、无撤销口也放行', async () => {
    const stub = registryStub(false)
    const h = await harness(fresh('f4pos'), MIXED_YAML, { adapters: adapters.map((a) => (a.name === 'agy' ? { ...a, fail: [QUOTA] } : a)), registry: stub.face })
    await createTicket(h, 'f4 post-launch rebind')
    const errors = await tickUntil(h, () => (h.counts.launches.dsh ?? 0) >= 1, 3)
    const ledger = await ledgerOf(h)
    expect(errors).toEqual([])
    expect(h.counts.launches).toEqual({ agy: 1, dsh: 1 })
    expect(stub.registered).toEqual(['T-1:att1:agy', 'T-1:att1:dsh'])
    expect(notes(ledger, 'T-1', 'ESCALATE', 'MODEL_ROUTING_FAILOVER').some((n) => n.includes(';from=a@agy;to=b@dsh'))).toBe(true)
    expect(execOf(notes(ledger, 'T-1', 'DISPATCH'))).toEqual(['dsh@0.0.0-fake'])
  })
})

describe('F5 EXECUTOR_REBIND_UNSTABLE：换绑后重选指回原执行器 → fail-closed 明报、零 launch', () => {
  /** 标定：单适配器＋零票帽 → BUDGET_HOLD 的 estimated（=该适配器任务书 token × a 源价 1000/M） */
  /** 标定与正式跑共用单题（任务书含标题：长度不一致=token 数不一致=窗口失真） */
  const TITLE = 'f5 rebind unstable'
  const estimatedOn = async (executor: string, channel: Channel): Promise<number> => {
    const yaml = `tiers:\n  high:\n    sources:\n      - {id: a, provider: glm, model: big, priority: 10, price: {inputPerM: 1000, outputPerM: 1000}, executor: ${executor}}\n${TIERS_TAIL}`
    const h = await harness(fresh('calib'), yaml, { adapters: [{ name: executor, channel }], configOverrides: { budgetTicketCapUsd: 0 } })
    await createTicket(h, TITLE) // 与正式跑同题（任务书含标题——长度须一致）
    let estimated = Number.NaN
    for (let i = 0; i < 2 && !Number.isFinite(estimated); i += 1) {
      const errors = await h.engine.tick().then((r) => r.errors)
      const ledger = await ledgerOf(h)
      const text = [...notes(ledger, 'T-1', 'ESCALATE', 'MODEL_ROUTING_BUDGET_HOLD'), ...errors].join(' | ')
      estimated = Number(/estimated=\$([0-9.]+)/.exec(text)?.[1] ?? 'NaN')
    }
    expect(Number.isFinite(estimated), `${executor}@${channel} 标定失败`).toBe(true)
    return estimated
  }

  it('票帽落在「a@dsh 任务书帽内、a@agy 任务书超帽」窗口 → 换绑到 dsh 后重选仍指 agy → 不稳定拒派', async () => {
    const estA = await estimatedOn('agy', 'user_level') // 首候选 agy（user_level 任务书更长）
    const estD = await estimatedOn('dsh', 'native')
    expect(estA).toBeGreaterThan(estD) // 窗口非空：agy 任务书更长（通道不同）
    const cap = (estA + estD) / 2
    const yaml = `tiers:\n  high:\n    sources:\n      - {id: a, provider: glm, model: big, priority: 10, price: {inputPerM: 1000, outputPerM: 1000}, executor: agy}\n      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 0.001, outputPerM: 0.002}, executor: dsh}\n${TIERS_TAIL}`
    const h = await harness(fresh('unsta'), yaml, { adapters: [{ name: 'dsh', channel: 'native', dshFace: true }, { name: 'agy', channel: 'user_level' }], configOverrides: { budgetTicketCapUsd: cap, allowBudgetDowngrade: true } })
    const t = await createTicket(h, TITLE)
    const errors = await tickUntilError(h, 3)
    const ledger = await ledgerOf(h)
    expect(errors[0]).toContain(`MODEL_ROUTING_FAIL;tier=high;reason=EXECUTOR_REBIND_UNSTABLE;换绑后重选仍指向他执行器 agy（已绑 dsh）`)
    expect(h.counts.launches).toEqual({})
    expect(h.counts.detects).toEqual({ agy: 1, dsh: 1 })
    expect(notes(ledger, t, 'DISPATCH')).toEqual([])
    expect(existsSync(instructionsTarget(h.rootDir, t))).toBe(false) // agy 段（bridge）写过的指令文件随换绑清理
  }, 60_000)
})
