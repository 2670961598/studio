/**
 * 注册表测试 —— 注册/解析/拒收 + 能力路由矩阵（docs/17-§2「零 if executor」）
 *
 * 覆盖：
 *   - registerBuiltins 一行接入四家（dsh default）；list 快照含能力声明
 *   - resolve 注册名/未注册名（CONFIG_INVALID/executor/unknown 明报）
 *   - 同名重注册拒收（executor/dup-register）；第二个 default 拒收（executor/dup-default）
 *   - 能力路由矩阵（pick 单选 / pickAll 全集，共用过滤谓词）：
 *       要续跑 → 只剩 session_resume=true 家（claude/codex/kimi）
 *       要预算帽 → 只剩 budget_cap=true 家（claude）
 *       要原生成本账 → 只剩 cost_native=true 家（claude）
 *       要单轮取消 → 四家皆无（组合无解 → undefined/[]，如实不硬凑）
 *       无过滤 → default（dsh）
 *   - default 语义边界：default 也要过能力过滤（不满足时不越权，回退注册序首位）；
 *     无 default 注册表 → pick 取注册序首位（确定性回退）；default 优先与注册序无关
 *   - 零名单硬编码旁证：能力同形的第五家 fake 适配器被平等路由（注册即路由）
 *
 * 矩阵依据（四家 capabilities 冻结声明，见各自源文件）：
 *   dsh    budget_cap=F cancel_turn=F session_resume=F agents_md=native cost_native=F（default）
 *   claude budget_cap=T cancel_turn=F session_resume=T agents_md=native cost_native=T
 *   codex  budget_cap=F cancel_turn=F session_resume=T agents_md=native cost_native=F
 *   kimi   budget_cap=F cancel_turn=F session_resume=T agents_md=native cost_native=F
 */
import { describe, expect, it } from 'vitest'
import type {
  ClassifiedError,
  ExecutorAdapter,
  ExecutorCapabilities,
  StreamEvent,
} from '@studio-next/contract'
import { registerBuiltins } from '../src/agentconfig.ts'
import { createRegistry } from '../src/registry.ts'
import type { RegistryEntry } from '../src/registry.ts'

/** 捕获 CONFIG_INVALID 并断言两级分类形状（category + subcause 机器可比对键） */
function captureConfigInvalid(fn: () => unknown): Error & ClassifiedError {
  try {
    fn()
  } catch (e) {
    const err = e as Error & ClassifiedError
    expect(err.category).toBe('CONFIG_INVALID')
    expect(typeof err.subcause).toBe('string')
    expect(err.subcause.length).toBeGreaterThan(0)
    return err
  }
  throw new Error('期望抛出 CONFIG_INVALID，实际未抛出')
}

/** 能力可定制的假适配器（不产进程不产流——注册表只读 name/capabilities，六原语不被调用） */
function fakeAdapter(name: string, caps: Partial<ExecutorCapabilities> = {}): ExecutorAdapter {
  return {
    name,
    capabilities: {
      budget_cap: false,
      cancel_turn: false,
      session_resume: false,
      agents_md: 'native',
      cost_native: false,
      ...caps,
    },
    async detect() {
      return { name, version: '9.9.9', ok: true, gaps: [] }
    },
    async estimate() {
      return { estimated: { usd: 0 }, confidence: 0 }
    },
    async launch() {
      throw new Error(`${name}: fake 适配器不支持 launch`)
    },
    async *stream(): AsyncGenerator<StreamEvent, void, unknown> {
      // fake 不产流
    },
    async resultStats() {
      return { cost: { usd: 0 }, tokens: { input: 0, output: 0 }, duration: 0, turns: 0 }
    },
    async kill() {
      // fake 无进程可杀
    },
  }
}

describe('注册表：注册 / 解析 / 拒收', () => {
  it('registerBuiltins 一行接入四家：list 按注册序、dsh default、条目带能力快照', () => {
    const registry = registerBuiltins(createRegistry())
    const entries = registry.list()
    expect(entries.map((e) => e.name)).toStrictEqual(['dsh', 'claude', 'codex', 'kimi'])
    expect(registry.defaultName()).toBe('dsh')
    const flags = new Map(entries.map((e) => [e.name, e.default]))
    expect(flags.get('dsh')).toBe(true)
    expect(flags.get('claude')).toBe(false)
    expect(flags.get('codex')).toBe(false)
    expect(flags.get('kimi')).toBe(false)
    // 条目快照含能力声明（面板/监控投影）
    const claude = entries.find((e) => e.name === 'claude')
    expect(claude?.capabilities).toStrictEqual({
      budget_cap: true,
      cancel_turn: false,
      session_resume: true,
      agents_md: 'native',
      cost_native: true,
    })
    const dsh = entries.find((e) => e.name === 'dsh')
    expect(dsh?.capabilities.session_resume).toBe(false) // v0 不支持续跑，照实声明
  })

  it('resolve 注册名返回适配器本体（name 与能力相符）', () => {
    const registry = registerBuiltins(createRegistry())
    const claude = registry.resolve('claude')
    expect(claude.name).toBe('claude')
    expect(claude.capabilities.budget_cap).toBe(true)
  })

  it('resolve 未注册名 → CONFIG_INVALID/executor/unknown 明报', () => {
    const registry = registerBuiltins(createRegistry())
    const err = captureConfigInvalid(() => registry.resolve('probe'))
    expect(err.subcause).toBe('executor/unknown')
    expect(err.message).toContain('probe')
  })

  it('同名重注册拒收：CONFIG_INVALID/executor/dup-register（不后写覆盖）', () => {
    const registry = registerBuiltins(createRegistry())
    const err = captureConfigInvalid(() => registry.register(fakeAdapter('dsh')))
    expect(err.subcause).toBe('executor/dup-register')
    // 拒收后注册表原样：仍四家、dsh 能力未被 fake 覆盖
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh', 'claude', 'codex', 'kimi'])
    expect(registry.resolve('dsh').capabilities.session_resume).toBe(false)
  })

  it('第二个 default 拒收：CONFIG_INVALID/executor/dup-default', () => {
    const registry = registerBuiltins(createRegistry())
    const err = captureConfigInvalid(() =>
      registry.register(fakeAdapter('probe', { budget_cap: true }), { default: true }),
    )
    expect(err.subcause).toBe('executor/dup-default')
    expect(err.message).toContain('dsh')
    expect(registry.defaultName()).toBe('dsh') // 原 default 不受影响
  })

  it('不同名新家可并存注册：注册即路由（第五家 fake 平等入册）', () => {
    const registry = registerBuiltins(createRegistry())
    registry.register(fakeAdapter('probe', { budget_cap: true }))
    expect(registry.list().map((e) => e.name)).toStrictEqual([
      'dsh',
      'claude',
      'codex',
      'kimi',
      'probe',
    ])
    expect(registry.resolve('probe').capabilities.budget_cap).toBe(true)
  })

  it('空注册表：list 空、pick/pickAll 无结果、defaultName undefined', () => {
    const registry = createRegistry()
    expect(registry.list()).toStrictEqual([])
    expect(registry.pick()).toBeUndefined()
    expect(registry.pickAll()).toStrictEqual([])
    expect(registry.defaultName()).toBeUndefined()
  })

  it('list() 返回快照：外部改动不回写注册表', () => {
    const registry = registerBuiltins(createRegistry())
    const snapshot = registry.list()
    // list() 契约为只读快照类型；本用例刻意原地篡改以证明不回写——断言意图优先于只读标注
    ;(snapshot as RegistryEntry[]).push({
      name: 'tamper',
      capabilities: fakeAdapter('x').capabilities,
      default: true,
    })
    expect(registry.list().length).toBe(4)
    expect(registry.defaultName()).toBe('dsh')
  })
})

describe('能力路由矩阵（零 if executor 名单硬编码）', () => {
  it('无过滤 → default（dsh）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pick()?.name).toBe('dsh')
    expect(registry.pick({})?.name).toBe('dsh') // 空 opts 等价无过滤
    expect(registry.pickAll().map((a) => a.name)).toStrictEqual(['dsh', 'claude', 'codex', 'kimi'])
  })

  it('要续跑 → 只剩 session_resume=true 家（claude/codex/kimi）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ sessionResume: true }).map((a) => a.name)).toStrictEqual([
      'claude',
      'codex',
      'kimi',
    ])
    expect(registry.pick({ sessionResume: true })?.name).toBe('claude') // 无 default 存活 → 注册序首位
  })

  it('要续跑=false → 只剩 dsh（布尔过滤=真值相等，不是仅真值过滤）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ sessionResume: false }).map((a) => a.name)).toStrictEqual(['dsh'])
    expect(registry.pick({ sessionResume: false })?.name).toBe('dsh')
  })

  it('要预算帽 → 只剩 budget_cap=true 家（claude）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ budgetCap: true }).map((a) => a.name)).toStrictEqual(['claude'])
    expect(registry.pick({ budgetCap: true })?.name).toBe('claude')
  })

  it('要原生成本账 → 只剩 cost_native=true 家（claude）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ costNative: true }).map((a) => a.name)).toStrictEqual(['claude'])
  })

  it('要单轮取消 → 四家皆无：组合无解如实返回（[]/undefined，不硬凑）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ cancelTurn: true })).toStrictEqual([])
    expect(registry.pick({ cancelTurn: true })).toBeUndefined()
  })

  it('组合过滤：预算帽+续跑 → claude 独中', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ budgetCap: true, sessionResume: true }).map((a) => a.name)).toStrictEqual(
      ['claude'],
    )
    expect(registry.pick({ budgetCap: true, sessionResume: true })?.name).toBe('claude')
  })

  it('组合过滤：预算帽+原生成本+续跑 → claude；native 通道不收窄（四家皆 native）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(
      registry.pickAll({ budgetCap: true, costNative: true, sessionResume: true, agentsMdChannel: 'native' }).map(
        (a) => a.name,
      ),
    ).toStrictEqual(['claude'])
    expect(registry.pickAll({ agentsMdChannel: 'native' }).length).toBe(4)
    expect(registry.pick({ agentsMdChannel: 'native' })?.name).toBe('dsh') // default 优先
  })

  it('组合无解（预算帽+不支持续跑）→ undefined：pick 无解是结果不是错误', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.pickAll({ budgetCap: true, sessionResume: false })).toStrictEqual([])
    expect(registry.pick({ budgetCap: true, sessionResume: false })).toBeUndefined()
  })

  it('零名单硬编码旁证：能力同形第五家被平等路由', () => {
    const registry = registerBuiltins(createRegistry())
    registry.register(fakeAdapter('probe-x', { budget_cap: true, session_resume: true, cost_native: true }))
    expect(
      registry.pickAll({ budgetCap: true, sessionResume: true, costNative: true }).map((a) => a.name),
    ).toStrictEqual(['claude', 'probe-x'])
    expect(registry.pick({ cancelTurn: true })).toBeUndefined() // probe-x 也不支持，仍无解
  })
})

describe('default 语义边界', () => {
  it('default 也要过能力过滤：不满足时不越权，回退注册序首位存活者', () => {
    const registry = createRegistry()
    registry.register(fakeAdapter('alpha', { budget_cap: true }), { default: true })
    registry.register(fakeAdapter('beta'))
    registry.register(fakeAdapter('gamma'))
    expect(registry.pick({ budgetCap: false })?.name).toBe('beta') // default alpha 被过滤
    expect(registry.pick({ budgetCap: true })?.name).toBe('alpha') // 满足时 default 优先
    expect(registry.pick()?.name).toBe('alpha')
  })

  it('无 default 注册表：pick 取注册序首位（确定性回退，不随机）', () => {
    const registry = createRegistry()
    registry.register(fakeAdapter('claude-like', { session_resume: true }))
    registry.register(fakeAdapter('codex-like', { session_resume: true }))
    expect(registry.defaultName()).toBeUndefined()
    expect(registry.pick()?.name).toBe('claude-like')
    expect(registry.pick({ sessionResume: true })?.name).toBe('claude-like')
  })

  it('default 优先与注册先后无关：晚注册的 default 仍胜出', () => {
    const registry = createRegistry()
    registry.register(fakeAdapter('beta'))
    registry.register(fakeAdapter('alpha'), { default: true })
    expect(registry.pick()?.name).toBe('alpha')
  })

  it('registerBuiltins overrides 可改写 default 家', () => {
    const registry = registerBuiltins(createRegistry(), {
      dsh: { default: false },
      claude: { default: true },
    })
    expect(registry.defaultName()).toBe('claude')
    expect(registry.pick()?.name).toBe('claude')
    expect(registry.pick({ sessionResume: false })?.name).toBe('dsh') // claude 不满足时回退
  })
})
