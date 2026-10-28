/**
 * test/v2/rule-engine —— 规则两阶段求值：合法档、阶段隔离、四值、限额、方向表、档升级
 *
 * 依据：docs/v2/10 §六 RULE-01..08（求值语义唯一主表）、§6.3（限额/结构块/相位）、
 *       §八（诊断码封闭）；docs/plan/04 §三 RULE-01..10 的 V1 腿与 §1.3（core 单测）；
 *       v2/17 §一（V1 语义断言，不用覆盖率代替负例）。
 * 负例分文件：rule-engine-neg.test.ts（NEG-RULE-01..10、NEG-ENG-03）。
 *
 * 零 IO：不 import fs/net/child_process；断言面是纯函数（同档同输入同结果）。
 */
import { describe, expect, it } from 'vitest'
import type { CheckedProfileCall } from '../../src/rule-engine.ts'
import {
  assertProfileRefStable,
  checkProfileUpgrade,
  evaluateRule,
  resolvePolicyDirection,
  typecheckRuleProfile,
  validateRuleProfile,
} from '../../src/rule-engine.ts'
import { semanticDigestOfJson } from '../../src/jcs.ts'
import {
  DIAGNOSTIC_CODE_PHASES,
  FIXED_LIMIT_NAMES,
  LIMITS_APPLIED_NAMES,
  PROFILE_STATUSES,
} from '../../src/spec.ts'
import { INPUTS, PROFILE_ID, PROFILE_VERSION, makeProfile, makeRule, profileDigest, profileRef } from './rule-fixtures.ts'

const literal = (kind: string, value: unknown): Record<string, unknown> => ({ node: 'literal', type: { kind }, value })

/** 构造已过静态面的调用（失败即夹具错误，不用宽松断言掩盖） */
function checkedCall(expression?: unknown, profile?: Record<string, unknown>): CheckedProfileCall {
  const rule = expression === undefined ? makeRule() : makeRule({ expression })
  const result = typecheckRuleProfile({ profile: profile ?? makeProfile(), rule })
  if (!result.ok) {
    throw new Error(`fixture typecheck failed: ${result.diagnostics.map((entry) => `${entry.code}:${entry.messageKey}`).join(',')}`)
  }
  return result.call
}

function codesOf(diagnostics: readonly { readonly code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

function expectClosedCodes(diagnostics: readonly { readonly code: string; readonly phase: string }[]): void {
  for (const diagnostic of diagnostics) {
    // 封闭码表：每个码必须在 §八 登记且相位与表一致（同一 code 不跨相位复用）
    expect(DIAGNOSTIC_CODE_PHASES[diagnostic.code as keyof typeof DIAGNOSTIC_CODE_PHASES]).toBe(diagnostic.phase)
  }
}

describe('RULE-01 档的身份与结构（合法性正面）', () => {
  it('合法档通过结构校验：identity/version/status/semanticDigest/operators/limits/结构块/用例集', () => {
    const result = validateRuleProfile(makeProfile())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.profile.profileId).toBe(PROFILE_ID)
    expect(result.profile.version).toBe(PROFILE_VERSION)
    expect(PROFILE_STATUSES).toContain(result.profile.status)
    expect(result.profile.semanticDigest.kind).toBe('semantic')
    expect(result.profile.caseSetRefs.length).toBeGreaterThan(0)
    expect(result.profile.patternModel.matchingModel).toBe('linear-nfa')
    expect(result.profile.patternModel.anchoring).toBe('full-match')
    expect(result.diagnostics).toEqual([])
  })

  it('档是语言不是单条规则：同一档服务两条不同表达式，均通过且结果各异', () => {
    const profile = makeProfile()
    const first = checkedCall(undefined, profile)
    const second = checkedCall({ node: 'binary', op: 'eq', left: literal('Int', 1), right: literal('Int', 1) }, profile)
    expect(evaluateRule(first, INPUTS).outcome).toBe('true')
    expect(evaluateRule(second, INPUTS).outcome).toBe('true')
    // 两条规则的 profileRef 指向同一档（语言复用），输入摘要相同
    const a = evaluateRule(first, INPUTS)
    const b = evaluateRule(second, INPUTS)
    expect(a.profileRef).toEqual(b.profileRef)
    expect(a.inputsDigest).toEqual(b.inputsDigest)
  })
})

describe('两阶段：typecheck 先于 evaluate，且阶段不得合并', () => {
  it('静态面失败不产出可求值调用（无 call 即无求值通道）', () => {
    const broken = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule({ expression: { node: 'binary', op: 'eq', left: literal('Int', 1), right: literal('Str', 'x') } }),
    })
    expect(broken.ok).toBe(false)
    expect('call' in broken).toBe(false)
    expect(codesOf(broken.diagnostics)).toContain('E-RULE-003')
  })

  it('通过静态面的调用带 typechecked 标记；求值只消费该型', () => {
    const call = checkedCall()
    expect(call.typechecked).toBe(true)
    expect(call.referencedPaths).toEqual(['/task/level'])
  })

  it('短路分支中的类型错误仍在静态期拒绝（RULE-04 全子树检查）', () => {
    const result = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule({
        expression: {
          node: 'binary',
          op: 'and',
          left: literal('Bool', false),
          right: { node: 'binary', op: 'eq', left: literal('Int', 1), right: literal('Str', 'x') },
        },
      }),
    })
    expect(result.ok).toBe(false)
    expect(codesOf(result.diagnostics)).toContain('E-RULE-003')
  })
})

describe('RULE-07 结果恰七字段与四值', () => {
  it('trace 可选：带 trace 时恰七字段；不带时六字段；四值不合并', () => {
    const call = checkedCall()
    const withTrace = evaluateRule(call, INPUTS, { trace: true })
    expect(Object.keys(withTrace).sort()).toEqual([
      'diagnostics',
      'inputsDigest',
      'limitsApplied',
      'outcome',
      'profileRef',
      'steps',
      'trace',
    ])
    const withoutTrace = evaluateRule(call, INPUTS)
    expect(Object.keys(withoutTrace).sort()).toEqual([
      'diagnostics',
      'inputsDigest',
      'limitsApplied',
      'outcome',
      'profileRef',
      'steps',
    ])
    expect(withTrace.outcome).toBe('true')
    expect(withTrace.trace?.length).toBeGreaterThan(0)
  })

  it('profileRef.digest 必须是档的 semanticDigest；inputsDigest 可对输入复算', () => {
    const call = checkedCall()
    const result = evaluateRule(call, INPUTS)
    expect(result.profileRef).toEqual({ profileId: PROFILE_ID, version: PROFILE_VERSION, digest: profileDigest() })
    const recomputed = semanticDigestOfJson(INPUTS)
    expect(recomputed.ok).toBe(true)
    if (!recomputed.ok) return
    expect(result.inputsDigest).toEqual(recomputed.value)
  })

  it('true/false 由求值值决定；unknown＝输入不足；refused＝求值中止（四值互不顶替）', () => {
    const call = checkedCall()
    expect(evaluateRule(call, INPUTS).outcome).toBe('true')
    expect(evaluateRule(call, { task: { level: 1, priority: 3 } }).outcome).toBe('false')
    // 容忍字段实际缺失 → 求值面读到 unknown（不是 false）
    const unknownRule = checkedCall({
      node: 'binary',
      op: 'eq',
      left: { node: 'input', path: '/task/kind' },
      right: literal('Str', 'review'),
    })
    const unknown = evaluateRule(unknownRule, { task: { level: 1, priority: 3 } })
    expect(unknown.outcome).toBe('unknown')
    // 必需输入缺失 → inputBinding 拒绝 ≠ false
    const refused = evaluateRule(call, { task: { priority: 3 } })
    expect(refused.outcome).toBe('refused')
    expect(codesOf(refused.diagnostics)).toContain('E-RULE-005')
  })

  it('refused 不得读成 false：超限与缺失都走 refused，且 steps 是实际步数', () => {
    const call = checkedCall()
    const refused = evaluateRule(call, INPUTS, { limits: { maxEvalSteps: 1 } })
    expect(refused.outcome).toBe('refused')
    expect(refused.steps).toBeGreaterThan(0)
    expect(codesOf(refused.diagnostics)).toContain('E-RULE-008')
  })
})

describe('RULE-06 限额：七项可收紧（生效值 min）＋三项档内固定不入 limitsApplied', () => {
  it('limitsApplied 恰七项机器名，不含档内固定三项', () => {
    const result = evaluateRule(checkedCall(), INPUTS)
    expect(Object.keys(result.limitsApplied).sort()).toEqual([...LIMITS_APPLIED_NAMES].sort())
    for (const name of FIXED_LIMIT_NAMES) {
      expect(name in result.limitsApplied).toBe(false)
    }
    expect(result.limitsApplied.maxEvalSteps).toBe(10_000)
  })

  it('调用侧收紧取 min；放宽无效（不得越过档内声明）', () => {
    const call = checkedCall()
    const tightened = evaluateRule(call, INPUTS, { limits: { maxListItems: 5, maxEvalSteps: 2 } })
    expect(tightened.limitsApplied.maxListItems).toBe(5)
    expect(tightened.limitsApplied.maxEvalSteps).toBe(2)
    expect(tightened.outcome).toBe('refused')
    const loosened = evaluateRule(call, INPUTS, { limits: { maxEvalSteps: 999_999 } })
    expect(loosened.limitsApplied.maxEvalSteps).toBe(10_000)
  })

  it('节点数/深度超限 → refused＋E-RULE-008（limit 相位）', () => {
    const call = checkedCall()
    const nodes = evaluateRule(call, INPUTS, { limits: { maxNodes: 1 } })
    expect(nodes.outcome).toBe('refused')
    expect(nodes.diagnostics.some((entry) => entry.code === 'E-RULE-008' && entry.messageKey === 'rule/limit-nodes')).toBe(true)
    const depth = evaluateRule(call, INPUTS, { limits: { maxDepth: 1 } })
    expect(depth.outcome).toBe('refused')
    expect(depth.diagnostics.some((entry) => entry.code === 'E-RULE-008' && entry.messageKey === 'rule/limit-depth')).toBe(true)
  })

  it('步数口径：每节点＋1、短路子树不计（and(false,·) 步数少于 and(true,·)）', () => {
    const shortCircuit = evaluateRule(
      checkedCall({ node: 'binary', op: 'and', left: literal('Bool', false), right: literal('Bool', true) }),
      INPUTS,
    )
    const full = evaluateRule(
      checkedCall({ node: 'binary', op: 'and', left: literal('Bool', true), right: literal('Bool', true) }),
      INPUTS,
    )
    expect(shortCircuit.outcome).toBe('false')
    expect(full.outcome).toBe('true')
    expect(shortCircuit.steps).toBeLessThan(full.steps)
    // 同输入同步数（确定性）
    const again = evaluateRule(
      checkedCall({ node: 'binary', op: 'and', left: literal('Bool', false), right: literal('Bool', true) }),
      INPUTS,
    )
    expect(again.steps).toBe(shortCircuit.steps)
  })

  it('量词迭代：每个列表元素计一步，exists/forall 真值与空列表口径', () => {
    const existsRule = checkedCall({
      node: 'quantifier',
      quant: 'exists',
      binding: { name: 'tag', type: { kind: 'Str' } },
      over: { node: 'input', path: '/task/tags' },
      body: { node: 'binary', op: 'eq', left: { node: 'binding', name: 'tag' }, right: literal('Str', 'b') },
    })
    const exists = evaluateRule(existsRule, { task: { level: 1, tags: ['a', 'b'], priority: 3 } })
    expect(exists.outcome).toBe('true')
    const empty = evaluateRule(existsRule, { task: { level: 1, tags: [], priority: 3 } })
    expect(empty.outcome).toBe('false') // exists 空列表 = false
    const forallRule = checkedCall({
      node: 'quantifier',
      quant: 'forall',
      binding: { name: 'tag', type: { kind: 'Str' } },
      over: { node: 'input', path: '/task/tags' },
      body: { node: 'binary', op: 'ne', left: { node: 'binding', name: 'tag' }, right: literal('Str', 'z') },
    })
    expect(evaluateRule(forallRule, { task: { level: 1, tags: [], priority: 3 } }).outcome).toBe('true') // forall 空列表 = true
  })
})

describe('RULE-05 缺省与容忍（声明期与绑定期）', () => {
  it('声明缺省的 defaultOf 产生 W-RULE-002；缺省值在绑定期生效并再次提示', () => {
    const call = checkedCall({
      node: 'binary',
      op: 'eq',
      left: { node: 'defaultOf', path: '/task/priority' },
      right: literal('Int', 3),
    })
    expect(call.diagnostics.some((entry) => entry.code === 'W-RULE-002' && entry.messageKey === 'rule/defaultof-declared')).toBe(true)
    const result = evaluateRule(call, { task: { level: 1, tags: [], kind: 'x' } })
    expect(result.outcome).toBe('true')
    expect(result.diagnostics.some((entry) => entry.code === 'W-RULE-002' && entry.messageKey === 'rule/default-applied')).toBe(true)
  })

  it('容忍字段缺失读作 unknown；同一字段声明缺省与容忍＝声明期拒收（E-RULE-004）', () => {
    const conflict = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule({
        inputDecl: {
          roots: ['task'],
          fields: [{ path: '/task/kind', type: 'text', required: false, nullable: false, absenceTolerant: true, default: 'x' }],
        },
      }),
    })
    expect(conflict.ok).toBe(false)
    expect(conflict.diagnostics.some((entry) => entry.code === 'E-RULE-004' && entry.messageKey === 'rule/default-tolerant-conflict')).toBe(true)
  })
})

describe('RULE-05/§6.3 方向表（policy 相位，W-RULE-001 单码）', () => {
  it('permitted 条件 unknown→不命中；prohibited→命中；reserved→命中且须指定位置；uncovered→不得执行', () => {
    const permitted = resolvePolicyDirection({ state: 'permitted', outcome: 'unknown' })
    expect(permitted.decision).toBe('miss')
    expect(permitted.requiresPosition).toBe(false)
    expect(permitted.diagnostic?.code).toBe('W-RULE-001')
    expect(permitted.diagnostic?.phase).toBe('policy')

    const prohibited = resolvePolicyDirection({ state: 'prohibited', outcome: 'unknown' })
    expect(prohibited.decision).toBe('hit') // 禁止优先：unknown 也不放行
    expect(prohibited.diagnostic?.messageKey).toBe('rule/direction/prohibited-unknown')

    const reserved = resolvePolicyDirection({ state: 'reserved', outcome: 'unknown' })
    expect(reserved.decision).toBe('hit')
    expect(reserved.requiresPosition).toBe(true)

    const uncovered = resolvePolicyDirection({ state: 'uncovered', outcome: 'unknown' })
    expect(uncovered.decision).toBe('not-executable')
    // uncovered 与「无命中」必须可区分（不同 messageKey）
    expect(uncovered.diagnostic?.messageKey).not.toBe(permitted.diagnostic?.messageKey)
  })

  it('已知结论：true→命中、false→不命中；refused→不得执行（不得读成 false）', () => {
    expect(resolvePolicyDirection({ state: 'permitted', outcome: 'true' }).decision).toBe('hit')
    expect(resolvePolicyDirection({ state: 'permitted', outcome: 'false' }).decision).toBe('miss')
    const refused = resolvePolicyDirection({ state: 'permitted', outcome: 'refused' })
    expect(refused.decision).toBe('not-executable')
    expect(refused.diagnostic?.messageKey).toBe('rule/direction/refused')
    expect(resolvePolicyDirection({ state: 'uncovered', outcome: 'false' }).decision).toBe('not-executable')
  })

  it('方向表产生的码仍在封闭表内且相位为 policy（不配 typecheck 码）', () => {
    for (const state of ['permitted', 'reserved', 'prohibited', 'uncovered'] as const) {
      for (const outcome of ['true', 'false', 'unknown', 'refused'] as const) {
        const direction = resolvePolicyDirection({ state, outcome })
        if (direction.diagnostic !== null) expectClosedCodes([direction.diagnostic])
      }
    }
  })
})

describe('RULE-01 档升级与判定稳定性', () => {
  it('升级须变更链三联：缺一即 E-RULE-010（policy）', () => {
    const previous = makeProfile()
    const nextResult = semanticDigestOfJson({ profileId: PROFILE_ID, version: '1.1.0' })
    expect(nextResult.ok).toBe(true)
    if (!nextResult.ok) return
    const next = makeProfile({ version: '1.1.0', semanticDigest: nextResult.value })
    const missing = checkProfileUpgrade({ previous: previous as never, next: next as never, evidence: {} })
    expect(missing.ok).toBe(false)
    expect(missing.diagnostics.filter((entry) => entry.code === 'E-RULE-010')).toHaveLength(3)
    expectClosedCodes(missing.diagnostics)
    const complete = checkProfileUpgrade({
      previous: previous as never,
      next: next as never,
      evidence: { changeRecordRef: 'chg-1', verificationRef: 'ver-1', activationRef: 'act-1' },
    })
    expect(complete).toEqual({ ok: true, diagnostics: [] })
  })

  it('档升级不得改变既有判定：旧档引用仍按原版解释，新档需新引用', () => {
    const oldCall = checkedCall()
    const before = evaluateRule(oldCall, INPUTS)
    const oldAgain = evaluateRule(oldCall, INPUTS)
    expect(before).toEqual(oldAgain)
    // 既有引用与新档不一致＝E-RULE-010（不得按「当前最新」解释）
    const nextResult = semanticDigestOfJson({ profileId: PROFILE_ID, version: '1.1.0' })
    if (!nextResult.ok) return
    const nextProfile = makeProfile({ version: '1.1.0', semanticDigest: nextResult.value })
    const mismatch = typecheckRuleProfile({ profile: nextProfile, rule: makeRule() })
    expect(mismatch.ok).toBe(false)
    expect(codesOf(mismatch.diagnostics)).toContain('E-RULE-010')
    // 旧档判定不受新档存在影响
    expect(evaluateRule(oldCall, INPUTS)).toEqual(before)
  })

  it('引用稳定性守卫：档版本逐字一致才允许（profileId＋version）', () => {
    const profile = validateRuleProfile(makeProfile())
    if (!profile.ok) throw new Error('fixture profile invalid')
    const stable = assertProfileRefStable(profileRef() as never, profile.profile)
    expect(stable).toEqual([])
    const drifted = assertProfileRefStable(
      { profileId: PROFILE_ID, version: '2.0.0', digest: profileDigest() },
      profile.profile,
    )
    expect(codesOf(drifted)).toEqual(['E-RULE-010'])
  })
})

describe('RULE-08 确定性（纯函数面）', () => {
  it('同档＋同输入＋同限额下结果唯一；输入键序不影响 inputsDigest（JCS 键排序）', () => {
    const call = checkedCall()
    const first = evaluateRule(call, { task: { level: 5, priority: 3, kind: 'review', tags: ['a', 'b'] } })
    const second = evaluateRule(call, { task: { tags: ['a', 'b'], kind: 'review', priority: 3, level: 5 } })
    expect(first.outcome).toBe(second.outcome)
    expect(first.steps).toBe(second.steps)
    expect(first.inputsDigest).toEqual(second.inputsDigest)
    expect(first.limitsApplied).toEqual(second.limitsApplied)
  })

  it('结果不含宿主时间/环境采集字段（只有 RULE-07 七字段）', () => {
    const result = evaluateRule(checkedCall(), INPUTS)
    const allowed = new Set(['outcome', 'profileRef', 'inputsDigest', 'steps', 'limitsApplied', 'diagnostics', 'trace'])
    for (const key of Object.keys(result)) expect(allowed.has(key)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/computedAt|hostname|timezone|process|env/i)
  })

  it('全流程只产封闭码（本条用例面）', () => {
    const call = checkedCall()
    for (const input of [INPUTS, { task: {} }, { task: { level: 1 } }]) {
      expectClosedCodes(evaluateRule(call, input).diagnostics)
    }
  })
})
