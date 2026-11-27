/**
 * agy-registry.test.ts —— agy 登记面验收（team task-140 交付物②「登记不启用」；LANE-X）
 *
 * 冻结验收口径（task-140：先登记，缺省零行为漂移）：
 *   ① 零行为漂移：registerBuiltins(createRegistry()) 恰四家、注册序与 default 不变；overrides
 *      点名 agy → CONFIG_INVALID/agentconfig/agy-override-ignored（结构拒收，不静默跳过）
 *   ② 可达：builtinResolver('agy') / judge 位 / 模型档位名解析到 AgyAdapter 家族；agent.yaml
 *      executors 段登记 agy → wireRegistry 可注册（注册序=书写序，default 不被夺）
 *   ③ 闸门同款：能力镜像漂移 → cap-drift；显式放宽 seatbelt → seatbelt-unenforceable（agy 无
 *      端子，与 claude/codex 同处置）；未证能力对齐面不波及 agy（同引用＝零改动）
 *   ④ patches 家族专属（分片 patches.ts）：agyOptionsFromPatches 形状闸；dshModelFromPatches 经
 *      agentconfig re-export 与包 index 的既有引用路径零变（同一函数引用）
 *   ⑤ ENU-88：EXECUTOR_VALUES 含 agy；选择链登记/解析与非主绑定执行器同款闸走
 *
 *   依据：docs/17-§4（agent.yaml=executor 注册与人事档案）、docs/18-§1.2（先写适配器再登记）、
 *   docs/v2/07 §一（选择链：单据指定＞岗位绑定＞默认；选择不是授权）、v2/12 §2.1（未证按不支持）。
 *   注：docs/v2/09 ENU-88 行已于 task-147 经提案流登记 agy（登记不启用；冻结件同批重冻结）——
 *   见 docs/sentinel-logs/提案-ENU88-执行器枚举新增agy-2026-11-27.md 与 docs/quality/agy-adapter.md §九。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, ExecutorCapabilities, Result } from '@studio-next/contract'
import { EXECUTOR_VALUES } from '../../../contract/src/records/asset.ts'
import {
  builtinResolver,
  effectiveCapabilities,
  familyOfExecutorName,
  judgeAwareResolver,
  judgeFamilyOf,
  loadAgentConfig,
  registerBuiltins,
  tierAwareResolver,
  tierOfExecutorName,
  wireRegistry,
} from '../../src/agentconfig.ts'
import { dshModelFromPatches as dshModelFromPatchesViaAgentconfig } from '../../src/agentconfig.ts'
import { dshModelFromPatches as dshModelFromPatchesViaIndex } from '../../src/index.ts'
import { AgyAdapter } from '../../src/agy.ts'
import { agyOptionsFromPatches, dshModelFromPatches } from '../../src/patches.ts'
import { createRegistry } from '../../src/registry.ts'
import { EMPTY_SELECTION_CHAIN, registerSelection, resolveDispatchTarget } from '../../src/bindcard/index.ts'

const MODEL = 'Gemini 4 Neon (High)'
const AGY_CAPABILITIES: ExecutorCapabilities = {
  budget_cap: false,
  cancel_turn: false,
  session_resume: false,
  agents_md: 'append_system_prompt',
  cost_native: false,
}

function thrownBy(fn: () => unknown): ClassifiedError {
  try {
    fn()
  } catch (e) {
    return e as ClassifiedError
  }
  throw new Error('期望抛 CONFIG_INVALID——未抛即放行路径存在')
}

function okOf<T>(result: Result<T, ClassifiedError>): T {
  if (result.kind !== 'ok') throw new Error(`期望 ok，实际 ${result.error.subcause}：${result.error.detail ?? ''}`)
  return result.value
}

function errOf<T>(result: Result<T, ClassifiedError>): ClassifiedError {
  if (result.kind !== 'err') throw new Error('期望 err——放行路径必须不存在')
  return result.error
}

describe('① 零行为漂移（缺省不启用）', () => {
  it('registerBuiltins 恰四家、注册序与 default 不变；agy 未登记即 resolve 拒', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.list().map((e) => e.name)).toEqual(['dsh', 'claude', 'codex', 'kimi'])
    expect(registry.defaultName()).toBe('dsh')
    expect(thrownBy(() => registry.resolve('agy')).subcause).toBe('executor/unknown')
  })

  it('overrides 点名 agy → CONFIG_INVALID/agentconfig/agy-override-ignored（不静默跳过）', () => {
    const error = thrownBy(() => registerBuiltins(createRegistry(), { agy: { cmd: ['agy'] } }))
    expect(error.category).toBe('CONFIG_INVALID')
    expect(error.subcause).toBe('agentconfig/agy-override-ignored')
    expect(error.detail).toContain('agent.yaml')
  })
})

describe('② 可达（工厂表有键即 resolver 可解析，启用归 agent.yaml）', () => {
  it('builtinResolver / judge 位 / 模型档位 / 家族归并：agy 全可达且是 AgyAdapter 家族', () => {
    const factory = builtinResolver('agy')
    if (factory === undefined) throw new Error('builtinResolver(agy) 应可解析')
    const adapter = factory(undefined, undefined)
    expect(adapter).toBeInstanceOf(AgyAdapter)
    expect(adapter.name).toBe('agy')
    expect(adapter.capabilities).toEqual(AGY_CAPABILITIES)
    expect(builtinResolver('gemini')).toBeUndefined() // 无别名旁路（ENU-88 值集外不解析）
    expect(judgeFamilyOf('agy-judge')).toBe('agy')
    expect(tierOfExecutorName('agy-high')).toEqual({ family: 'agy', tier: 'high' })
    expect(familyOfExecutorName('agy-low')).toBe('agy')
    expect(judgeAwareResolver()('agy-judge')?.(['agy'], undefined).name).toBe('agy-judge')
    const tiered = tierAwareResolver()('agy-low')?.(['agy'], { model: 'Gemini 4 Neon (Low)' })
    expect(tiered).toBeInstanceOf(AgyAdapter)
    expect(tiered?.name).toBe('agy-low')
  })

  it('agent.yaml 登记 agy → wireRegistry 可注册：注册序=书写序、default 不被夺、未登记不注册', () => {
    const config = loadAgentConfig(
      ['executors:', '  dsh: { default: true }', '  agy:', `    patches: { model: "${MODEL}", print-timeout-sec: 900 }`, ''].join('\n'),
    )
    const registry = wireRegistry(createRegistry(), config, builtinResolver)
    expect(registry.list().map((e) => [e.name, e.default])).toEqual([
      ['dsh', true],
      ['agy', false],
    ])
    expect(registry.resolve('agy')).toBeInstanceOf(AgyAdapter)
    expect(registry.defaultName()).toBe('dsh')
    // 镜像一致（与代码声明逐字段相同）照过；judge 位标 default 仍拒（判断位不是派工泳道）
    const mirrored = wireRegistry(
      createRegistry(),
      loadAgentConfig(['executors:', `  agy: { capabilities: { session_resume: false, agents_md: append_system_prompt } }`, ''].join('\n')),
      builtinResolver,
    )
    expect(mirrored.list().map((e) => e.name)).toEqual(['agy'])
    expect(
      thrownBy(() =>
        wireRegistry(
          createRegistry(),
          loadAgentConfig('executors:\n  agy-judge: { default: true }\n'),
          judgeAwareResolver(),
        ),
      ).subcause,
    ).toBe('agentconfig/judge-default')
  })
})

describe('③ 闸门同款（能力镜像 / seatbelt / 未证对齐）', () => {
  it('能力镜像漂移 → cap-drift（配置不得伪造能力；agy 不在 PB-6 未证名单，不落 cap-unproven）', () => {
    const wire = (capabilities: string): unknown =>
      wireRegistry(createRegistry(), loadAgentConfig(`executors:\n  agy: { capabilities: ${capabilities} }\n`), builtinResolver)
    expect(thrownBy(() => wire('{ session_resume: true }')).subcause).toBe('agentconfig/cap-drift')
    expect(thrownBy(() => wire('{ budget_cap: true }')).subcause).toBe('agentconfig/cap-drift')
    expect(thrownBy(() => wire('{ agents_md: native }')).subcause).toBe('agentconfig/cap-drift')
  })

  it('显式放宽 seatbelt → seatbelt-unenforceable（agy 无端子，read-only 缺省照过）', () => {
    const grant = { tier: 'workspace-write', writeRoots: ['/absolute/work/root'], authorization: 'task-140 test' } as const
    expect(thrownBy(() => builtinResolver('agy', grant)?.(['agy'], undefined)).subcause).toBe('agentconfig/seatbelt-unenforceable')
    expect(builtinResolver('agy')?.(['agy'], undefined)).toBeInstanceOf(AgyAdapter)
  })

  it('未证能力对齐面不波及 agy：对齐值与声明同引用（合法面零改动）', () => {
    expect(effectiveCapabilities('agy', AGY_CAPABILITIES)).toBe(AGY_CAPABILITIES)
    expect(effectiveCapabilities('agy-high', AGY_CAPABILITIES)).toBe(AGY_CAPABILITIES)
  })
})

describe('④ patches 家族专属（分片 patches.ts；既有引用路径零变）', () => {
  it('agyOptionsFromPatches：缺键如实缺席；合法照录；形状坏 → agentconfig/agy-patch-shape', () => {
    expect(agyOptionsFromPatches(undefined)).toEqual({})
    expect(agyOptionsFromPatches({})).toEqual({})
    expect(agyOptionsFromPatches({ model: MODEL, 'print-timeout-sec': 900, other: 1 })).toEqual({ model: MODEL, printTimeoutSec: 900 })
    for (const bad of [1, '', '   ', 'a\nb', null]) {
      expect(thrownBy(() => agyOptionsFromPatches({ model: bad })).subcause, JSON.stringify(bad)).toBe('agentconfig/agy-patch-shape')
    }
    for (const bad of [0, -1, 1.5, '900', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(thrownBy(() => agyOptionsFromPatches({ 'print-timeout-sec': bad })).subcause, String(bad)).toBe(
        'agentconfig/agy-patch-shape',
      )
    }
  })

  it('dshModelFromPatches：agentconfig re-export 与包 index 同一引用（迁出零行为漂移）；解析口径不变', () => {
    expect(dshModelFromPatchesViaAgentconfig).toBe(dshModelFromPatches)
    expect(dshModelFromPatchesViaIndex).toBe(dshModelFromPatches)
    expect(dshModelFromPatches(undefined)).toBeUndefined()
    expect(dshModelFromPatches({ 'agent-default-model': { config: { provider: 'deepseek', model: 'deepseek-flash' } } })).toBe(
      'deepseek/deepseek-flash',
    )
    expect(thrownBy(() => dshModelFromPatches({ 'agent-default-model': { config: { provider: 'a/b', model: 'm' } } })).subcause).toBe(
      'agentconfig/dsh-model-patch',
    )
  })
})

describe('⑤ ENU-88 值集与选择链', () => {
  it('EXECUTOR_VALUES 含 agy；选择链：未登记直连拒、登记后可解析（选择≠授权）、别名拒', () => {
    expect([...EXECUTOR_VALUES]).toEqual(['dsh', 'claude', 'codex', 'kimi', 'agy'])
    expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'TASK-140', executor: 'agy' })).subcause).toBe(
      'dispatch/selection-unregistered',
    )
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'TASK-140',
        executor: 'agy',
        source: 'ticket',
        registeredBy: '制作人',
        reason: 'Gemini 异源复核（task-140）',
      }),
    )
    expect(chain.entries.map((e) => e.executor)).toEqual(['agy'])
    expect(okOf(resolveDispatchTarget(chain, { ticket: 'TASK-140', executor: 'agy' }))).toMatchObject({
      executor: 'agy',
      source: 'ticket',
      authorization: 'not-granted-here',
    })
    expect(errOf(resolveDispatchTarget(chain, { ticket: 'TASK-140', executor: 'gemini' })).subcause).toBe('dispatch/executor-unknown')
  })
})
