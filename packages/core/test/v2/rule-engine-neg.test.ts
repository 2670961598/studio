/**
 * test/v2/rule-engine-neg —— 规则求值负例：NEG-RULE-01..10（v2/17 §四）＋ NEG-ENG-03（ReDoS）
 *
 * 依据：docs/v2/17 §四（NEG-RULE-01..10 逐条判据）、docs/v2/10 §6.6（负向用例引位）、
 *       docs/plan/04 §1.3（NEG-RULE 分支负例与 E-RULE 码逐条；core 单测零 IO）、
 *       docs/v2/13 §八-6（NEG-ENG-03：外部输入正则长输入 → 超时/拒，E-RULE-009 联动）。
 * 每条负例只断言**判据本身**（拒绝面＋码），不靠覆盖率数字充当负例（plan/04 §1.3）。
 *
 * 零 IO：不 import fs/net/child_process；「超时」以确定性步数上限表达（墙钟不是语义）
 * ——本文件不断言毫秒级耗时，而以「步数是否越限」与「同输入同步数」证明线性自动机面。
 */
import { describe, expect, it } from 'vitest'
import type { CheckedProfileCall } from '../../src/rule-engine.ts'
import {
  checkProfileUpgrade,
  evaluateRule,
  typecheckRuleProfile,
} from '../../src/rule-engine.ts'
import { DIAGNOSTIC_CODE_PHASES } from '../../src/spec.ts'
import { INPUTS, PROFILE_ID, makeProfile, makeRule, profileDigest } from './rule-fixtures.ts'

const literal = (kind: string, value: unknown): Record<string, unknown> => ({ node: 'literal', type: { kind }, value })

type Diagnostic = { readonly code: string; readonly phase: string; readonly messageKey: string }

function report(profile: Record<string, unknown>, rule: Record<string, unknown>): { readonly ok: boolean; readonly diagnostics: readonly Diagnostic[] } {
  const result = typecheckRuleProfile({ profile, rule })
  return { ok: result.ok, diagnostics: result.diagnostics as readonly Diagnostic[] }
}

function expectClosed(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    expect(DIAGNOSTIC_CODE_PHASES[diagnostic.code as keyof typeof DIAGNOSTIC_CODE_PHASES]).toBe(diagnostic.phase)
  }
}

function expectDiagnostic(diagnostics: readonly Diagnostic[], code: string, messageKey: string): void {
  expectClosed(diagnostics)
  expect(diagnostics.some((entry) => entry.code === code && entry.messageKey === messageKey)).toBe(true)
}

function checkedCall(expression: unknown, profile?: Record<string, unknown>): CheckedProfileCall {
  const result = typecheckRuleProfile({ profile: profile ?? makeProfile(), rule: makeRule({ expression }) })
  if (!result.ok) throw new Error(`fixture typecheck failed: ${result.diagnostics.map((entry) => entry.code).join(',')}`)
  return result.call
}

/** 档内固定三项与限额的便捷覆盖（测试负例用；不改变档身份） */
function profileWith(overrides: {
  readonly ceiling?: Record<string, number>
  readonly fixed?: Record<string, number>
}): Record<string, unknown> {
  const base = makeProfile()
  const limits = base['limits'] as { ceiling: Record<string, number>; fixed: Record<string, number> }
  return makeProfile({
    limits: {
      ceiling: { ...limits.ceiling, ...(overrides.ceiling ?? {}) },
      fixed: { ...limits.fixed, ...(overrides.fixed ?? {}) },
    },
  })
}

describe('NEG-RULE-01 表达式封闭：未知算子/未知节点被拒而非降级文本（E-RULE-001/002）', () => {
  it('未知节点 call → E-RULE-001（parse 相位，不按文本降级）', () => {
    const result = report(makeProfile(), makeRule({ expression: { node: 'call', fn: 'host.now' } }))
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics, 'E-RULE-001', 'rule/unknown-node')
  })

  it('未知一元算子名 hostExec → E-RULE-001；合法算子但档未声明 → E-RULE-002', () => {
    const unknownOperator = report(
      makeProfile(),
      makeRule({ expression: { node: 'unary', op: 'hostExec', operand: literal('Bool', true) } }),
    )
    expectDiagnostic(unknownOperator.diagnostics, 'E-RULE-001', 'rule/unknown-operator')

    const undeclaredOperator = makeRule({
      expression: { node: 'binary', op: 'eq', left: literal('Int', 1), right: literal('Int', 1) },
    })
    const declaredNarrow = report(makeProfile({ operators: ['ge'] }), undeclaredOperator)
    expect(declaredNarrow.ok).toBe(false)
    expectDiagnostic(declaredNarrow.diagnostics, 'E-RULE-002', 'rule/operator-undeclared')
  })

  it('禁用构造 regex-replace / macro 一律拒收（无宿主调用面）', () => {
    for (const node of ['regex-replace', 'macro', 'comment', 'dynamic-field']) {
      const result = report(makeProfile(), makeRule({ expression: { node } }))
      expect(result.ok).toBe(false)
      expectDiagnostic(result.diagnostics, 'E-RULE-001', 'rule/unknown-node')
    }
  })
})

describe('NEG-RULE-02 输入绑定：必需输入缺失 → inputBinding 拒绝（E-RULE-005）', () => {
  it('必需字段 /task/level 缺失：refused（非 false）＋E-RULE-005（inputBinding 相位）', () => {
    const call = checkedCall(makeRule()['expression'] as Record<string, unknown>)
    const result = evaluateRule(call, { task: { priority: 3 } })
    expect(result.outcome).toBe('refused')
    expect(result.outcome).not.toBe('false')
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-005', 'rule/required-missing')
  })
})

describe('NEG-RULE-03 容忍声明：未声明容忍的可选缺失被当 unknown 使用 → 拒绝（E-RULE-006）', () => {
  it('显式缺失的非容忍可选字段一旦被引用即拒绝，不得静默按 unknown 放行', () => {
    const rule = makeRule({
      inputDecl: {
        roots: ['task'],
        fields: [{ path: '/task/note', type: 'text', required: false, nullable: false, absenceTolerant: false }],
      },
      expression: { node: 'binary', op: 'eq', left: { node: 'input', path: '/task/note' }, right: literal('Str', 'x') },
    })
    const result = typecheckRuleProfile({ profile: makeProfile(), rule })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const evaluated = evaluateRule(result.call, { task: {} })
    expect(evaluated.outcome).toBe('refused')
    expectDiagnostic(evaluated.diagnostics as readonly Diagnostic[], 'E-RULE-006', 'rule/optional-missing')
  })

  it('同一字段声明 absenceTolerant=true 时缺失可读作 unknown（对照：声明容忍才放行该面）', () => {
    const call = checkedCall({
      node: 'binary',
      op: 'eq',
      left: { node: 'input', path: '/task/kind' },
      right: literal('Str', 'review'),
    })
    const result = evaluateRule(call, { task: { level: 1, priority: 3 } })
    expect(result.outcome).toBe('unknown')
    expect(result.diagnostics.some((entry) => entry.code === 'E-RULE-006')).toBe(false)
  })
})

describe('NEG-RULE-04 类型静态性：跨词表/跨版本比较与短路分支类型错误（E-RULE-003）', () => {
  it('跨词表 Enum 比较 → E-RULE-003（rule/type/cross-vocab，不得按码值字符串比较）', () => {
    const result = report(
      makeProfile(),
      makeRule({
        expression: {
          node: 'binary',
          op: 'eq',
          left: { node: 'literal', type: { kind: 'Enum', vocab: 'policy', vocabVersion: '1.0.0' }, value: 'permit' },
          right: { node: 'literal', type: { kind: 'Enum', vocab: 'risk', vocabVersion: '1.0.0' }, value: 'low' },
        },
      }),
    )
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics, 'E-RULE-003', 'rule/type/cross-vocab')
  })

  it('跨版本 Enum（同词表异版本）同样类型错误', () => {
    const result = report(
      makeProfile(),
      makeRule({
        expression: {
          node: 'binary',
          op: 'eq',
          left: { node: 'literal', type: { kind: 'Enum', vocab: 'policy', vocabVersion: '1.0.0' }, value: 'permit' },
          right: { node: 'literal', type: { kind: 'Enum', vocab: 'policy', vocabVersion: '2.0.0' }, value: 'permit' },
        },
      }),
    )
    expectDiagnostic(result.diagnostics, 'E-RULE-003', 'rule/type/cross-vocab')
  })

  it('无隐式转换：Int 与 Dec 比较 → E-RULE-003（no-implicit-conversion）', () => {
    const result = report(
      makeProfile(),
      makeRule({ expression: { node: 'binary', op: 'eq', left: literal('Int', 1), right: literal('Dec', '1.0') } }),
    )
    expectDiagnostic(result.diagnostics, 'E-RULE-003', 'rule/type/no-implicit-conversion')
  })

  it('短路分支中的类型错误逃检 → E-RULE-003（and(false, 错误分支) 仍被静态拒绝）', () => {
    const result = report(
      makeProfile(),
      makeRule({
        expression: {
          node: 'binary',
          op: 'and',
          left: literal('Bool', false),
          right: { node: 'binary', op: 'lt', left: literal('Str', 'a'), right: literal('Int', 1) },
        },
      }),
    )
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics, 'E-RULE-003', 'rule/type/mismatch')
  })

  it('比较禁止链式：a<b<c 结构下 Bool 与 Int 比较 → E-RULE-003（ordering）', () => {
    const result = report(
      makeProfile(),
      makeRule({
        expression: {
          node: 'binary',
          op: 'lt',
          left: { node: 'binary', op: 'lt', left: literal('Int', 1), right: literal('Int', 2) },
          right: literal('Int', 3),
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((entry) => entry.code === 'E-RULE-003')).toBe(true)
  })
})

describe('NEG-RULE-05 缺省纪律：defaultOf 用于未声明缺省 → 拒绝位（E-RULE-004）', () => {
  it('/task/level 无声明缺省却写 defaultOf → E-RULE-004（defaultof-conflict）', () => {
    const result = report(
      makeProfile(),
      makeRule({ expression: { node: 'binary', op: 'eq', left: { node: 'defaultOf', path: '/task/level' }, right: literal('Int', 1) } }),
    )
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics, 'E-RULE-004', 'rule/defaultof-conflict')
  })
})

describe('NEG-RULE-06 档纯度：读宿主时间/环境/随机/模型 → 档不合法（E-RULE-001 族）', () => {
  it('档声明 ambientReads（clock/env/random/model）→ E-RULE-001（parse）', () => {
    for (const ambient of ['clock', 'timezone', 'env', 'random', 'network', 'file', 'model']) {
      const result = report(makeProfile({ ambientReads: [ambient] }), makeRule())
      expect(result.ok).toBe(false)
      expectDiagnostic(result.diagnostics, 'E-RULE-001', 'rule/ambient-reads')
    }
  })

  it('表达式试图读宿主时钟 → 未知节点拒绝（E-RULE-001），不得降级为文本', () => {
    const result = report(makeProfile(), makeRule({ expression: { node: 'hostClock', field: 'now' } }))
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics, 'E-RULE-001', 'rule/unknown-node')
  })
})

describe('NEG-RULE-07 超限语义：超限记 refused 而非 false（E-RULE-008）', () => {
  it('求值步数越限 → refused＋E-RULE-008（limit 相位）；不得以 false/unknown 冒充', () => {
    const call = checkedCall(makeRule()['expression'] as Record<string, unknown>)
    const result = evaluateRule(call, INPUTS, { limits: { maxEvalSteps: 1 } })
    expect(result.outcome).toBe('refused')
    expect(result.outcome).not.toBe('false')
    expect(result.outcome).not.toBe('unknown')
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-008', 'rule/limit-steps')
  })

  it('列表元素数越限 → refused＋E-RULE-008（rule/limit-list）', () => {
    const call = checkedCall({
      node: 'quantifier',
      quant: 'forall',
      binding: { name: 'tag', type: { kind: 'Str' } },
      over: { node: 'input', path: '/task/tags' },
      body: { node: 'binary', op: 'ne', left: { node: 'binding', name: 'tag' }, right: literal('Str', 'z') },
    })
    const result = evaluateRule(call, { task: { level: 1, tags: ['a', 'b', 'c', 'd', 'e', 'f'], priority: 3 } }, { limits: { maxListItems: 3 } })
    expect(result.outcome).toBe('refused')
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-008', 'rule/limit-list')
  })
})

describe('NEG-RULE-08 unknown 传播：if 条件 unknown 不求值任何分支，结果 unknown', () => {
  it('unknown 条件＋真分支除零：结果 unknown（分支未被求值，无 E-RULE-007）', () => {
    const call = checkedCall({
      node: 'conditional',
      test: { node: 'binary', op: 'eq', left: { node: 'input', path: '/task/kind' }, right: literal('Str', 'review') },
      whenTrue: { node: 'binary', op: 'gt', left: { node: 'binary', op: 'div', left: literal('Int', 1), right: literal('Int', 0) }, right: literal('Int', 0) },
      whenFalse: literal('Bool', true),
    })
    const result = evaluateRule(call, { task: { level: 1, priority: 3 } })
    expect(result.outcome).toBe('unknown')
    expect(result.diagnostics.some((entry) => entry.code === 'E-RULE-007')).toBe(false)
    // 未求值分支不产生节点步数：仅 test 子树被计（步数远小于求值分支的情形）
    expect(result.steps).toBeLessThan(10)
  })
})

describe('NEG-RULE-09 档版本：引用未知档/未知版本/已撤回档 → E-RULE-010 拒收', () => {
  it('登记表无该档 → E-RULE-010（profile-unknown）', () => {
    const other = makeProfile({ version: '9.9.9' })
    const result = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule(),
      known: [{ profile: other as never, withdrawn: false }],
    })
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-010', 'rule/profile-unknown')
  })

  it('已撤回档不得新引用 → E-RULE-010（profile-withdrawn）', () => {
    const result = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule(),
      known: [{ profile: makeProfile() as never, withdrawn: true }],
    })
    expect(result.ok).toBe(false)
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-010', 'rule/profile-withdrawn')
  })

  it('档版本与引用不一致 → E-RULE-010；引用摘要不一致 → E-RULE-010', () => {
    const versionMismatch = typecheckRuleProfile({
      profile: makeProfile({ version: '1.1.0' }),
      rule: makeRule(),
    })
    expect(versionMismatch.ok).toBe(false)
    expectDiagnostic(versionMismatch.diagnostics as readonly Diagnostic[], 'E-RULE-010', 'rule/profile-ref-mismatch')

    const digestMismatch = typecheckRuleProfile({
      profile: makeProfile(),
      rule: makeRule({
        ruleProfileRef: { profileId: PROFILE_ID, version: '1.0.0', digest: { ...profileDigest(), value: 'a'.repeat(64) } },
      }),
    })
    expect(digestMismatch.ok).toBe(false)
    expectDiagnostic(digestMismatch.diagnostics as readonly Diagnostic[], 'E-RULE-010', 'rule/profile-digest-mismatch')
  })
})

describe('NEG-RULE-10 判定稳定性：档升级未走变更链即改变既有判定 → 判负（E-RULE-010）', () => {
  it('升级缺变更记录/独立验证/新激活 → 三条 E-RULE-010（change-chain-missing）', () => {
    const previous = makeProfile()
    const next = makeProfile({ version: '1.1.0' })
    const verdict = checkProfileUpgrade({ previous: previous as never, next: next as never, evidence: {} })
    expect(verdict.ok).toBe(false)
    const missing = verdict.diagnostics.filter((entry) => entry.messageKey === 'rule/change-chain-missing')
    expect(missing).toHaveLength(3)
    expectClosed(verdict.diagnostics as readonly Diagnostic[])
  })

  it('版本不严格上移（同版/降级）→ E-RULE-010（profile-version-order）', () => {
    const previous = makeProfile({ version: '1.1.0' })
    const same = makeProfile({ version: '1.1.0' })
    const verdict = checkProfileUpgrade({ previous: previous as never, next: same as never, evidence: { changeRecordRef: 'c', verificationRef: 'v', activationRef: 'a' } })
    expect(verdict.ok).toBe(false)
    expectDiagnostic(verdict.diagnostics as readonly Diagnostic[], 'E-RULE-010', 'rule/profile-version-order')
  })

  it('既有判定在档升级候选存在时保持不变（同档同输入同结果；旧引用不按新档解释）', () => {
    const call = checkedCall(makeRule()['expression'] as Record<string, unknown>)
    const before = evaluateRule(call, INPUTS)
    const nextProfile = makeProfile({ version: '2.0.0' })
    const mismatch = typecheckRuleProfile({ profile: nextProfile, rule: makeRule() })
    expect(mismatch.ok).toBe(false) // 旧规则引用不能被新档静默吸收
    expect(evaluateRule(call, INPUTS)).toEqual(before)
  })
})

describe('NEG-ENG-03 ReDoS 面：外部输入正则长输入 → 拒/受限（E-RULE-009 联动）', () => {
  const matchRule = makeRule({
    expression: { node: 'match', subject: { node: 'input', path: '/task/kind' }, pattern: '(a+)+b' },
  })

  function matchCall(profile: Record<string, unknown>): CheckedProfileCall {
    const result = typecheckRuleProfile({ profile, rule: matchRule })
    if (!result.ok) throw new Error(`fixture typecheck failed: ${result.diagnostics.map((entry) => entry.code).join(',')}`)
    return result.call
  }

  it('长输入超过 maxPatternInputCodepoints → refused＋E-RULE-009（input-too-long）', () => {
    const call = matchCall(profileWith({ fixed: { maxPatternInputCodepoints: 64 } }))
    const result = evaluateRule(call, { task: { level: 1, priority: 3, kind: 'a'.repeat(200) } })
    expect(result.outcome).toBe('refused')
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-009', 'rule/pattern-input-too-long')
  })

  it('自动机转移数超过 maxPatternSteps → refused＋E-RULE-009（steps-exceeded），不得记 false', () => {
    const call = matchCall(profileWith({ fixed: { maxPatternSteps: 200 } }))
    const result = evaluateRule(call, { task: { level: 1, priority: 3, kind: 'a'.repeat(2000) } })
    expect(result.outcome).toBe('refused')
    expect(result.outcome).not.toBe('false')
    expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-009', 'rule/pattern-steps-exceeded')
  })

  it('越出受限子集（环视/反向引用/零宽断言）→ E-RULE-009（pattern-syntax）', () => {
    for (const pattern of ['(?=a)', '(a)\\1', '\\bword', 'a+?']) {
      const call = matchCall(profileWith({}))
      const rule = makeRule({
        expression: { node: 'match', subject: { node: 'input', path: '/task/kind' }, pattern },
      })
      const result = typecheckRuleProfile({ profile: profileWith({}), rule })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const evaluated = evaluateRule(result.call, { task: { level: 1, priority: 3, kind: 'aaa' } })
      expect(evaluated.outcome).toBe('refused')
      expectDiagnostic(evaluated.diagnostics as readonly Diagnostic[], 'E-RULE-009', 'rule/pattern-syntax')
      expect(call.typechecked).toBe(true)
    }
  })

  it('量词嵌套/上界越限 → E-RULE-009（nesting-exceeded / bound-exceeded）', () => {
    const nesting = typecheckRuleProfile({ profile: profileWith({ fixed: { maxQuantifierNesting: 1 } }), rule: matchRule })
    expect(nesting.ok).toBe(true)
    if (nesting.ok) {
      const result = evaluateRule(nesting.call, { task: { level: 1, priority: 3, kind: 'ab' } })
      expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-009', 'rule/pattern-nesting-exceeded')
    }
    const boundRule = makeRule({
      expression: { node: 'match', subject: { node: 'input', path: '/task/kind' }, pattern: 'a{1001}' },
    })
    const bound = typecheckRuleProfile({ profile: profileWith({}), rule: boundRule })
    expect(bound.ok).toBe(true)
    if (bound.ok) {
      const result = evaluateRule(bound.call, { task: { level: 1, priority: 3, kind: 'a' } })
      expectDiagnostic(result.diagnostics as readonly Diagnostic[], 'E-RULE-009', 'rule/pattern-bound-exceeded')
    }
  })

  it('线性自动机面：灾难性模式＋长输入在限额内完成且步数确定（不以墙钟保护代替模型一致）', () => {
    const call = matchCall(
      profileWith({
        ceiling: { maxEvalSteps: 1_000_000, maxTextCodepoints: 20_000 },
        fixed: { maxPatternInputCodepoints: 4096, maxPatternSteps: 500_000 },
      }),
    )
    const subject = 'a'.repeat(3000)
    const first = evaluateRule(call, { task: { level: 1, priority: 3, kind: subject } })
    const second = evaluateRule(call, { task: { level: 1, priority: 3, kind: subject } })
    expect(first.outcome).toBe('false') // 无 'b'，整串锚定不匹配
    expect(first.outcome).not.toBe('refused')
    expect(second.outcome).toBe(first.outcome)
    expect(second.steps).toBe(first.steps) // 步数＝自动机转移数，确定可复算
    expect(first.steps).toBeGreaterThan(1000)
    expect(first.steps).toBeLessThan(300_000) // 无回溯爆炸：步数与输入长度同阶
    expect(first.trace).toBeUndefined()
  })
})
