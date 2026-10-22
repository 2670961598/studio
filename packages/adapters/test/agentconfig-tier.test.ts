/**
 * agent.yaml 模型档注册位测试 —— studio-dev-196（制作人 2026-10-22 三档定调：大/中/小）
 *
 * 覆盖：
 *   - 名字判定面：MODEL_TIER_SUFFIXES 冻结值 / isModelTierExecutorName / tierOfExecutorName
 *     （四家族×三档成立、裸家族名/未知家族/裸后缀=undefined——未配置家族的档位由
 *     resolver 明报不静默）；
 *   - tierExecutorName 反函数（familyOf 派生面在 daemon 侧消费，本包只供组合原语）；
 *   - tierAwareResolver：`<family>-<tier>` → 该家族工厂 + **patches 透传**（与 judge 位
 *     丢 patches 的语义差——档位 patches['agent-default-model'] 是模型镜像源）；
 *   - wireRegistry 组合面：档位经 tierAwareResolver 注册成功；**档位可标 default**
 *     （dsh-mid 即缺省主力位——与 judge 位「不得标 default」相反）；未经
 *     tierAwareResolver（裸 builtinResolver）→ 未知名明报（档位须显式包）。
 * env 注入说明：无（纯面/装配面，不 spawn——spawn 面归 dsh.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import {
  builtinResolver,
  isModelTierExecutorName,
  loadAgentConfig,
  MODEL_TIER_SUFFIXES,
  tierAwareResolver,
  tierExecutorName,
  tierOfExecutorName,
  wireRegistry,
} from '../src/agentconfig.ts'
import { createRegistry } from '../src/registry.ts'

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

/** 合法三档位 yaml（dsh-mid default 主力 + 低高档 cmd 追加 --patch overlay） */
const TIER_YAML = `executors:
  dsh-mid:
    cmd: [dsh, --profile, headless, --json]
    default: true
    patches:
      agent-default-model:
        config: {provider: glm, model: GLM-5.3}
  dsh-low:
    cmd: [dsh, --profile, headless, --patch, /tmp/dsh-tier-low.yml, --json]
    patches:
      agent-default-model:
        config: {provider: glm, model: GLM-5.3-Flash}
  dsh-high:
    cmd: [dsh, --profile, headless, --patch, /tmp/dsh-tier-high.yml, --json]
    patches:
      agent-default-model:
        config: {provider: deepseek, model: deepseek-flash}
`

describe('名字判定面（`<family>-<tier>` 形态）', () => {
  it('后缀冻结值：-high/-mid/-low（恰三档，docs/17-§4）', () => {
    expect(MODEL_TIER_SUFFIXES).toStrictEqual(['-high', '-mid', '-low'])
  })

  it('四家族 × 三档成立；tierOfExecutorName 提取家族+档位', () => {
    for (const family of ['dsh', 'claude', 'codex', 'kimi'] as const) {
      for (const tier of ['high', 'mid', 'low'] as const) {
        expect(tierOfExecutorName(`${family}-${tier}`)).toStrictEqual({ family, tier })
        expect(isModelTierExecutorName(`${family}-${tier}`)).toBe(true)
      }
    }
  })

  it('裸家族名/未知家族/裸后缀/judge 名=undefined（档位判定不越面）', () => {
    for (const name of ['dsh', 'dsh-judge', 'high', '-high', 'foo-high', 'dsh-higher', '']) {
      expect(tierOfExecutorName(name)).toBeUndefined()
      expect(isModelTierExecutorName(name)).toBe(false)
    }
  })

  it('tierExecutorName 反函数：与 tierOfExecutorName 互逆', () => {
    for (const [family, tier] of [
      ['dsh', 'high'],
      ['claude', 'low'],
    ] as const) {
      expect(tierExecutorName(family, tier)).toBe(`${family}-${tier}`)
      expect(tierOfExecutorName(tierExecutorName(family, tier))).toStrictEqual({ family, tier })
    }
  })
})

describe('tierAwareResolver（档位复用家族工厂——cmd+patches 即配置层绑定位）', () => {
  it('档位名解析到该家族工厂：产物=同族实例 + 注册名=档位名 + patches 镜像透传', async () => {
    const { DshAdapter } = await import('../src/dsh.ts')
    const factory = tierAwareResolver()('dsh-high')
    expect(factory).toBeDefined()
    const adapter = factory(
      ['dsh', '--profile', 'headless', '--patch', '/tmp/dsh-tier-high.yml'],
      { 'agent-default-model': { config: { provider: 'deepseek', model: 'deepseek-flash' } } },
    )
    expect(adapter).toBeInstanceOf(DshAdapter) // 同族实例（委托面完整）
    expect(adapter.name).toBe('dsh-high') // 改名注册——与其他位不撞键
    // patches 透达家族工厂：dshModelFromPatches 消费为 ResultStats.model 镜像源
    //（132-§6.1 单A；Handle 流面归 dsh.test.ts——此处探构造期注入字段即透传证明）
    expect((adapter as unknown as { model: string | undefined }).model).toBe('deepseek/deepseek-flash')
  })

  it('judge 位丢 patches 的语义差：judge 路不透传（镜像对判断位无意义）', async () => {
    const { judgeAwareResolver } = await import('../src/agentconfig.ts')
    const factory = judgeAwareResolver()('dsh-judge')
    const adapter = factory(['dsh', '--profile', 'headless-low'], {
      'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3' } },
    })
    expect((adapter as unknown as { model: string | undefined }).model).toBeUndefined()
  })

  it('非档位名透传 base（与裸 builtinResolver 等价）；未知名 undefined', () => {
    const resolver = tierAwareResolver()
    for (const name of ['dsh', 'claude', 'codex', 'kimi']) {
      expect(resolver(name)).toBe(builtinResolver(name))
    }
    expect(resolver('unknown-family')).toBeUndefined()
  })

  it('档位路不经过 base（家族表即源——base 抛错也不影响档位解析）', () => {
    const resolver = tierAwareResolver(() => {
      throw new Error('base 不应被档位名触达')
    })
    expect(resolver('dsh-low')).toBeDefined()
  })
})

describe('wireRegistry 组合面（agent.yaml 装载路径）', () => {
  it('loadAgentConfig 收三档位（书写序如实）；tierAwareResolver 注册成功', () => {
    const config = loadAgentConfig(TIER_YAML)
    expect(config.executors.map((e) => e.name)).toStrictEqual(['dsh-mid', 'dsh-low', 'dsh-high'])
    const registry = createRegistry()
    wireRegistry(registry, config, tierAwareResolver())
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh-mid', 'dsh-low', 'dsh-high'])
    expect(registry.pick()?.name).toBe('dsh-mid') // 档位 default 合法（主力派工位）
  })

  it('档位可标 default——与 judge 位拒收相反（派工泳道语义，无特设闸）', () => {
    const yaml = `executors:
  dsh-mid:
    cmd: [dsh, --profile, headless, --json]
    default: true
`
    const registry = createRegistry()
    wireRegistry(registry, loadAgentConfig(yaml), tierAwareResolver())
    expect(registry.pick()?.name).toBe('dsh-mid')
  })

  it('未经 tierAwareResolver（裸 builtinResolver）→ 未知名明报（档位须显式包）', () => {
    const config = loadAgentConfig(TIER_YAML)
    expectConfigInvalid(
      () => wireRegistry(createRegistry(), config, builtinResolver),
      'agentconfig/unknown-executor',
    )
  })

  it('档位与 judge 位可同 registry 共存（组合 resolver：judge 外包 tier）', async () => {
    const { judgeAwareResolver } = await import('../src/agentconfig.ts')
    const yaml = `${TIER_YAML}  dsh-judge:
    cmd: [dsh, --profile, headless-low, --json]
`
    const config = loadAgentConfig(yaml)
    const registry = createRegistry()
    wireRegistry(registry, config, judgeAwareResolver(tierAwareResolver()))
    expect(registry.list().map((e) => e.name)).toStrictEqual([
      'dsh-mid',
      'dsh-low',
      'dsh-high',
      'dsh-judge',
    ])
  })
})
