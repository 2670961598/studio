/**
 * model-tier —— 模型档执行面（studio-dev-196，制作人 2026-10-22 三档定调：大/中/小）。
 *
 * 断言面（deliverables/plan.md §1 冻结设计）：
 *   1. resolveModelTier 三级解析序：显式单级覆盖 > 岗单锚（PATROL job= 派生 →
 *      jobs.model_tier）> 角色映射（roleOfAssignee 口径；未知角色回 mid）；
 *      面关（modelTierByRole 未注入）=undefined（现行为逐字节保持）。
 *   2. modelTierDispatchFace：档位名在册 → 指名解析 + `tier=<t>@<位名>` 锚；
 *      不在册 → 缺省回退 + 降级锚（fake 注册表面开不炸派发）；familyOf 剥档位
 *      后缀（dsh-mid 缺省 → 高档落 dsh-high）。
 *   3. provisionModelTierOverlays：low/high 两文件确定性生成（0600）、mid 不生成；
 *      内容=单一 agent-default-model patch（tiers 单一事实源直录）。
 *   4. parseModelTierTickets：合法/空串=空表/坏段/未知档/重复单号 fail-closed。
 *   5. checkTierPositionDeclarations：镜像与 tiers 同源绿；漂移 CONFIG_INVALID；
 *      未声明镜像/非档位名不查。
 *   6. 引擎接线（tick 集成）：三位在册 → 三单三档三执行位（work_records.executor
 *      + DISPATCH note tier 锚）；面关负对照（无锚）；缺位降级正对照（fake 注册表）。
 * env 注入说明：无（fake 适配器全内存）。
 */
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import type { ModelsConfig, TierId } from '@studio-next/core'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import {
  checkTierPositionDeclarations,
  modelTierDispatchFace,
  parseModelTierTickets,
  provisionModelTierOverlays,
  resolveModelTier,
} from '../../../src/engine/tier/model-tier.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

/** 断言抛 CONFIG_INVALID 且 subcause 机器可比对 */
function expectConfigInvalid(fn: () => unknown, subcause: string): void {
  try {
    fn()
  } catch (err) {
    const e = err as { category?: string; subcause?: string }
    expect(e.category).toBe('CONFIG_INVALID')
    expect(e.subcause).toBe(subcause)
    return
  }
  throw new Error('expected CONFIG_INVALID')
}

/** people 两枚（P-1 工号在册；角色名 assignee 非＝角色直读） */
const PEOPLE = [
  { id: 'P-1', name: '甲', dept: 'departments/研发部', level: 1 },
  { id: 'P-2', name: '乙', dept: 'departments/研发部', level: 1 },
] as const

/** models.yaml 形状直构（tiers=制作人三档定调；roles=main_worker→mid；PriceEntry 键形
 * inputPerM/outputPerM——serve 集成面走 parseModelsYaml 文本装载，见 assembly/serve-tier） */
const MODELS: ModelsConfig = {
  tiers: {
    high: { provider: 'deepseek', model: 'deepseek-flash', price: { inputPerM: 0.27, outputPerM: 1.1 } },
    mid: { provider: 'glm', model: 'GLM-5.3', price: { inputPerM: 0.5, outputPerM: 2 } },
    low: { provider: 'glm', model: 'GLM-5.3-Flash', price: { inputPerM: 0.1, outputPerM: 0.4 } },
  },
  roles: { main_worker: 'mid', verifier: 'low' },
}

// ————————————————————————— 1. 三级解析序 —————————————————————————

describe('resolveModelTier（单>岗>角色三级；面关=undefined）', () => {
  const jobTierOf = (id: string): TierId | undefined =>
    ({ 'job-daily': 'low', 'job-pln': 'mid' } as Record<string, TierId>)[id]

  it('面关（modelTierByRole 未注入）→ undefined（现行为保持）', () => {
    const r = resolveModelTier(
      { ticket: 'T-1', assignee: 'P-1', people: [...PEOPLE], jobAnchor: 'job-daily', jobTierOf },
      { modelTierTickets: { 'T-1': 'high' } },
    )
    expect(r).toBeUndefined()
  })

  it('级1 显式单级覆盖压倒岗锚与角色', () => {
    const r = resolveModelTier(
      { ticket: 'T-1', assignee: 'P-1', people: [...PEOPLE], jobAnchor: 'job-daily', jobTierOf },
      { modelTierByRole: MODELS.roles, modelTierTickets: { 'T-1': 'high' } },
    )
    expect(r).toStrictEqual({ tier: 'high', source: 'ticket' })
  })

  it('级2 岗单锚 → jobs.model_tier 随行落档（非岗单 undefined 落级3）', () => {
    expect(
      resolveModelTier(
        { ticket: 'T-2', assignee: 'P-1', people: [...PEOPLE], jobAnchor: 'job-daily', jobTierOf },
        { modelTierByRole: MODELS.roles },
      ),
    ).toStrictEqual({ tier: 'low', source: 'job' })
    expect(
      resolveModelTier(
        { ticket: 'T-2', assignee: 'P-1', people: [...PEOPLE], jobAnchor: 'job-unknown', jobTierOf },
        { modelTierByRole: MODELS.roles },
      ),
    ).toStrictEqual({ tier: 'mid', source: 'role' }) // 岗读不到=角色面兜底
  })

  it('级3 角色：工号 assignee=main_worker→mid；角色名 assignee=该角色档；未知角色回 mid', () => {
    expect(
      resolveModelTier({ ticket: 'T-3', assignee: 'P-1', people: [...PEOPLE], jobAnchor: undefined, jobTierOf }, { modelTierByRole: MODELS.roles }),
    ).toStrictEqual({ tier: 'mid', source: 'role' })
    expect(
      resolveModelTier({ ticket: 'T-3', assignee: 'verifier', people: [...PEOPLE], jobAnchor: undefined, jobTierOf }, { modelTierByRole: MODELS.roles }),
    ).toStrictEqual({ tier: 'low', source: 'role' })
    expect(
      resolveModelTier({ ticket: 'T-3', assignee: 'summarizer', people: [...PEOPLE], jobAnchor: undefined, jobTierOf }, { modelTierByRole: MODELS.roles }),
    ).toStrictEqual({ tier: 'mid', source: 'role' }) // roles 未登记角色：保守缺省 mid
  })
})

// ————————————————————————— 2. 档派发面 —————————————————————————

/** 结构面 registry 桩：list/resolve 只认名 */
function stubRegistry(names: readonly string[]): { list(): { name: string }[]; resolve(n: string): { name: string } } {
  return {
    list: () => names.map((name) => ({ name })),
    resolve: (n: string) => {
      if (!names.includes(n)) throw new Error(`resolve 落空：${n}`)
      return { name: n } as never
    },
  }
}

describe('modelTierDispatchFace（在册指名/缺位降级；familyOf 剥档位后缀）', () => {
  it('档位名在册 → 指名解析 + tier 锚', () => {
    const reg = stubRegistry(['dsh-mid', 'dsh-low', 'dsh-high'])
    const face = modelTierDispatchFace(reg, 'high', { name: 'dsh-mid' } as never)
    expect(face.adapter.name).toBe('dsh-high')
    expect(face.noteAnchor).toBe(';tier=high@dsh-high')
  })

  it('缺省位名是档位名时家族先剥后缀（dsh-mid 缺省 → dsh-high 不落 dsh-mid-high）', () => {
    const reg = stubRegistry(['dsh-mid', 'dsh-high'])
    const face = modelTierDispatchFace(reg, 'high', { name: 'dsh-mid' } as never)
    expect(face.adapter.name).toBe('dsh-high')
  })

  it('缺位 → 缺省回退 + 降级锚（fake 注册表面开不炸派发）', () => {
    const reg = stubRegistry(['fake'])
    const face = modelTierDispatchFace(reg, 'low', { name: 'fake' } as never)
    expect(face.adapter.name).toBe('fake')
    expect(face.noteAnchor).toContain('tier=low@fake')
    expect(face.noteAnchor).toContain('降级')
    expect(face.noteAnchor).toContain('fake-low')
  })
})

// ————————————————————————— 3. overlay 生成 —————————————————————————

describe('provisionModelTierOverlays（低/高档生成；mid=现役不生成）', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'studio-next-tier-overlay-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('low/high 两文件确定性生成（0600）；mid 不生成；内容=tiers 直录', () => {
    const out = provisionModelTierOverlays(dir, MODELS)
    expect(Object.keys(out).sort()).toStrictEqual(['high', 'low'])
    const low = readFileSync(out.low!, 'utf8')
    expect(low).toContain('- id: agent-default-model')
    expect(low).toContain('provider: glm')
    expect(low).toContain('model: GLM-5.3-Flash')
    const high = readFileSync(out.high!, 'utf8')
    expect(high).toContain('provider: deepseek')
    expect(high).toContain('model: deepseek-flash')
    expect(statSync(out.low!).mode & 0o777).toBe(0o600)
    // 确定性：重跑同 bytes（启动覆写刷新面）
    const again = provisionModelTierOverlays(dir, MODELS)
    expect(readFileSync(again.high!, 'utf8')).toBe(high)
  })
})

// ————————————————————————— 4. 覆盖表解析 —————————————————————————

describe('parseModelTierTickets（解析即验 fail-closed）', () => {
  it('合法对/空串=空表', () => {
    expect(parseModelTierTickets('STUDIO-196-H=high;STUDIO-196-L=low')).toStrictEqual({
      'STUDIO-196-H': 'high',
      'STUDIO-196-L': 'low',
    })
    expect(parseModelTierTickets('')).toStrictEqual({})
    expect(parseModelTierTickets(';;')).toStrictEqual({})
  })
  it('坏段/未知档/空单号/重复单号 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => parseModelTierTickets('T-1'), 'serve/model-tier-tickets')
    expectConfigInvalid(() => parseModelTierTickets('T-1=ultra'), 'serve/model-tier-tickets')
    expectConfigInvalid(() => parseModelTierTickets('=high'), 'serve/model-tier-tickets')
    expectConfigInvalid(() => parseModelTierTickets('T-1=high;T-1=low'), 'serve/model-tier-tickets')
  })
})

// ————————————————————————— 5. 档位声明一致性闸 —————————————————————————

describe('checkTierPositionDeclarations（三面同源；漂移启动拒）', () => {
  const execs = (patches?: Record<string, unknown>) => [{ name: 'dsh-high', patches }]

  it('镜像与 tiers 同源绿；漂移红；未声明镜像/非档位名不查', () => {
    expect(() =>
      checkTierPositionDeclarations(execs({ 'agent-default-model': { config: { provider: 'deepseek', model: 'deepseek-flash' } } }), MODELS),
    ).not.toThrow()
    expectConfigInvalid(
      () => checkTierPositionDeclarations(execs({ 'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3' } } }), MODELS),
      'serve/model-tier-drift',
    )
    expect(() => checkTierPositionDeclarations(execs(undefined), MODELS)).not.toThrow() // 镜像缺席=不查
    expect(() => checkTierPositionDeclarations([{ name: 'dsh', patches: { 'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3' } } } }], MODELS)).not.toThrow() // 裸位不查
  })
})

// ————————————————————————— 6. 引擎接线（tick 集成） —————————————————————————

interface Stack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

/** 轻量栈（unknown-state-sentinel 同款）：registry 可注入位名/档配置 */
function buildStack(
  id: string,
  opts?: {
    tierPositions?: boolean
    modelTier?: { byRole?: Record<string, TierId>; tickets?: Record<string, TierId> }
  },
): Stack {
  const ledger = openLedger(path.join(root!, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 23, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  if (opts?.tierPositions === true) {
    // 三档位：名=dsh-<tier>（tierAwareResolver 装配面的位名形态；fake 适配器挂名即等价
    // ——engine 只读 registry 名与能力，零 executor 名单硬编码）
    registry.register(createFakeAdapter({ name: 'dsh-mid' }), { default: true })
    registry.register(createFakeAdapter({ name: 'dsh-low' }))
    registry.register(createFakeAdapter({ name: 'dsh-high' }))
  } else {
    registry.register(createFakeAdapter(), { default: true })
  }
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§4（models.yaml 三档）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root!, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1, // 缺省 30 拍回扫太慢——三单人闸串行链在本测试拍窗内走不完
      readBlindAcceptance: ['echo demo-ok'], // verifier 角色=blind 读面（DEFAULT_ROLE_READ_TIERS）——冻结验收命令就位（17-§7）
      ...(opts?.modelTier !== undefined
        ? {
            ...(opts.modelTier.byRole !== undefined ? { modelTierByRole: opts.modelTier.byRole } : {}),
            ...(opts.modelTier.tickets !== undefined ? { modelTierTickets: opts.modelTier.tickets } : {}),
          }
        : {}),
    },
    people: DEMO_SNAPSHOT.people,
    makeId: (() => {
      let n = 0
      return (): string => {
        n += 1
        return '0'.repeat(10) + String(n).padStart(16, '0')
      }
    })(),
  })
  return { platform, ledger, engine, clock }
}

let root: string | undefined

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-tier-e2e-'))
})
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

/** 建单→tick 推进到出现 DISPATCH，返回该 note（fake 'ok' 模式 launch 即完成流；人闸缺省
 * 串行——前序单收割关单后才轮到本单，故留足拍数） */
async function dispatchNoteOf(stack: Stack, ticket: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    stack.clock.advance(1000)
    await stack.engine.tick()
    const d = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'DISPATCH')
    if (d !== undefined) return d.note ?? ''
  }
  throw new Error(`ticket ${ticket} 未派发`)
}

describe('引擎接线：档路由 → 执行位选择 → DISPATCH 锚 → work_records', () => {
  it('三档三执行位全链：显式 high（T-1）/角色 mid（T-2 main_worker）/角色 low（T-3 verifier）', async () => {
    const stack = buildStack('tier-positions', {
      tierPositions: true,
      modelTier: {
        byRole: { main_worker: 'mid', verifier: 'low' },
        tickets: { 'T-1': 'high' }, // fake 平台首建单恒 T-1（e2e 同口径）
      },
    })
    try {
      const high = await stack.platform.issues.create({ title: '高档单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
      const mid = await stack.platform.issues.create({ title: '中档单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
      const low = await stack.platform.issues.create({ title: '低档单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'verifier' }) // 角色名 assignee=角色直读（roleOfAssignee 口径）
      expect([high.id, mid.id, low.id]).toStrictEqual(['T-1', 'T-2', 'T-3'])
      const note1 = await dispatchNoteOf(stack, high.id)
      expect(note1).toContain('tier=high@dsh-high') // 级1 显式单级覆盖
      expect(stack.ledger.listWorkRecords({ issue: high.id })[0]?.executor).toBe('dsh-high')
      const note2 = await dispatchNoteOf(stack, mid.id)
      expect(note2).toContain('tier=mid@dsh-mid') // 级3 角色映射（main_worker→mid）
      expect(stack.ledger.listWorkRecords({ issue: mid.id })[0]?.executor).toBe('dsh-mid')
      const note3 = await dispatchNoteOf(stack, low.id)
      expect(note3).toContain('tier=low@dsh-low') // 级3 角色映射（verifier→low）
      expect(stack.ledger.listWorkRecords({ issue: low.id })[0]?.executor).toBe('dsh-low')
    } finally {
      stack.ledger.close()
    }
  })

  it('缺位降级：fake 注册表（无档位名）面开不炸派发——降级锚明报', async () => {
    const stack = buildStack('fallback', { modelTier: { byRole: { main_worker: 'mid' }, tickets: { 'T-1': 'high' } } })
    try {
      const created = await stack.platform.issues.create({ title: '缺位单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
      const note = await dispatchNoteOf(stack, created.id)
      expect(note).toContain('executor=fake@')
      expect(note).toContain('tier=high@fake（降级') // T-1 显式覆盖 high；位不在册→缺省回退+锚
      expect(stack.ledger.listWorkRecords({ issue: created.id })[0]?.executor).toBe('fake')
    } finally {
      stack.ledger.close()
    }
  })

  it('面关负对照：modelTierByRole 未注入 → note 无 tier 锚、执行位=缺省', async () => {
    const stack = buildStack('face-off', { tierPositions: true })
    try {
      const created = await stack.platform.issues.create({ title: '面关单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
      const note = await dispatchNoteOf(stack, created.id)
      expect(note).not.toContain('tier=')
      expect(stack.ledger.listWorkRecords({ issue: created.id })[0]?.executor).toBe('dsh-mid')
    } finally {
      stack.ledger.close()
    }
  })
})
