/**
 * agent.yaml judge 注册位测试 —— studio-dev-160 §6.3/§6.5（制作人 2026-10-22 全批，单 164）
 *
 * 覆盖：
 *   - 名字判定面：JUDGE_EXECUTOR_SUFFIX 冻结值 / isJudgeExecutorName / judgeFamilyOf
 *     （四家族成立、未知家族与非 judge 形态=undefined——未配置家族的 judge 位由
 *     resolver 明报不静默）；
 *   - judgeAwareResolver：`<family>-judge` → 该家族工厂（与 builtinResolver 对四家名
 *     等价）、非 judge 名透传 base；
 *   - wireRegistry 组合面：judge 位经 judgeAwareResolver 注册成功；**judge 位标
 *     default → CONFIG_INVALID agentconfig/judge-default**（判断位不是主派发位）；
 *     未经 judgeAwareResolver（裸 builtinResolver）→ 未知名明报（judge 位须显式包）。
 * env 注入说明：无（本文件全纯面/装配面，不 spawn——spawn 面归 dsh.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import {
  builtinResolver,
  isJudgeExecutorName,
  judgeAwareResolver,
  judgeFamilyOf,
  JUDGE_EXECUTOR_SUFFIX,
  loadAgentConfig,
  wireRegistry,
} from '../src/agentconfig.ts'
import { createRegistry } from '../src/registry.ts'

/** 断言抛 CONFIG_INVALID 并返回（两级分类形状：category+subcause 机器可比对键） */
function expectConfigInvalid(fn: () => unknown, subcause: string): Error & ClassifiedError {
  try {
    fn()
  } catch (err) {
    const e = err as Error & ClassifiedError
    expect(e.category).toBe('CONFIG_INVALID')
    expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error('expected CONFIG_INVALID')
}

/** 合法 judge 位 yaml（dsh-judge 注册 + dsh 本尊 default——能力声明同本尊） */
const JUDGE_YAML = `executors:
  dsh:
    cmd: [dsh, --profile, headless, --json]
    default: true
  dsh-judge:
    cmd: [dsh, --profile, headless-low, --json]
`

describe('名字判定面（§6.3：`<family>-judge` 形态）', () => {
  it('后缀冻结值：-judge', () => {
    expect(JUDGE_EXECUTOR_SUFFIX).toBe('-judge')
  })

  it('四家族 judge 名成立；judgeFamilyOf 提取家族名', () => {
    for (const [name, family] of [
      ['dsh-judge', 'dsh'],
      ['claude-judge', 'claude'],
      ['codex-judge', 'codex'],
      ['kimi-judge', 'kimi'],
    ] as const) {
      expect(judgeFamilyOf(name)).toBe(family)
      expect(isJudgeExecutorName(name)).toBe(true)
    }
  })

  it('非 judge 形态与未知家族=undefined（isJudgeExecutorName=false）', () => {
    for (const name of ['dsh', 'dshjudged', 'judge', '-judge', 'foo-judge', '']) {
      expect(judgeFamilyOf(name)).toBeUndefined()
      expect(isJudgeExecutorName(name)).toBe(false)
    }
  })
})

describe('judgeAwareResolver（判断位复用家族工厂——cmd 即配置层绑定位）', () => {
  it('judge 名解析到该家族工厂：产物=同族实例 + 注册名=judge 名（registry 键不撞本尊）', async () => {
    const { DshAdapter } = await import('../src/dsh.ts')
    const factory = judgeAwareResolver()('dsh-judge')
    expect(factory).toBeDefined()
    const adapter = factory(['dsh', '--profile', 'headless-low'])
    expect(adapter).toBeInstanceOf(DshAdapter) // 同族实例（委托面完整）
    expect(adapter.name).toBe('dsh-judge') // 改名注册——与本尊 'dsh' 不撞键
    expect(builtinResolver('dsh')!(undefined).name).toBe('dsh') // 本尊名不变
  })

  it('非 judge 名透传 base（与裸 builtinResolver 等价）；未知名 undefined', () => {
    const resolver = judgeAwareResolver()
    for (const name of ['dsh', 'claude', 'codex', 'kimi']) {
      expect(resolver(name)).toBe(builtinResolver(name))
    }
    expect(resolver('unknown-family')).toBeUndefined()
  })

  it('judge 路不经过 base（家族表即源——base 抛错也不影响 judge 解析）', () => {
    const resolver = judgeAwareResolver(() => {
      throw new Error('base 不应被 judge 名触达')
    })
    expect(resolver('dsh-judge')).toBeDefined()
  })
})

describe('wireRegistry 组合面（agent.yaml 装载路径）', () => {
  it('loadAgentConfig 收 judge 位（书写序如实）；judgeAwareResolver 注册成功', () => {
    const config = loadAgentConfig(JUDGE_YAML)
    expect(config.executors.map((e) => e.name)).toStrictEqual(['dsh', 'dsh-judge'])
    const registry = createRegistry()
    wireRegistry(registry, config, judgeAwareResolver())
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh', 'dsh-judge'])
  })

  it('裸 builtinResolver 接 judge 位 → 未知名明报（judge 位须显式包 judgeAwareResolver）', () => {
    const config = loadAgentConfig(JUDGE_YAML)
    expectConfigInvalid(() => wireRegistry(createRegistry(), config, builtinResolver), 'agentconfig/unknown-executor')
  })

  it('judge 位标 default → CONFIG_INVALID agentconfig/judge-default（判断位不是主派发位）', () => {
    const yaml = `executors:
  dsh:
    cmd: [dsh]
  dsh-judge:
    cmd: [dsh, --profile, headless-low]
    default: true
`
    const config = loadAgentConfig(yaml)
    expectConfigInvalid(() => wireRegistry(createRegistry(), config, judgeAwareResolver()), 'agentconfig/judge-default')
  })

  it('judge 位不标 default 时本尊 default 正常通过（组合态合法）', () => {
    const config = loadAgentConfig(JUDGE_YAML)
    const registry = createRegistry()
    wireRegistry(registry, config, judgeAwareResolver())
    const dsh = registry.list().find((e) => e.name === 'dsh')
    const judge = registry.list().find((e) => e.name === 'dsh-judge')
    expect(dsh?.default).toBe(true)
    expect(judge?.default).toBeFalsy()
  })
})
