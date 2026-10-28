/**
 * rule-gate —— 开工门规则面夹具（规则两阶段接线的合法输入）
 *
 * 依据：docs/v2/10 §6.1-§6.3（档形状：身份/版本/状态/semanticDigest/operators/limits/
 *       patternModel/determinism/caseSetRefs）；§6.5（规则引用结构）；docs/v2/11 REC-WORK-04
 *       「规则求值中止按该门不可开工聚合」——夹具只承载形状，断言语义在 rule-wiring.test.ts。
 *
 * 纪律：`semanticDigest` 由 core `semanticDigestOfJson` 复算（不手写十六进制、不自造 digest）；
 *       本文件零 IO、零时钟；不冒充任何已登记档（profileId 用 test 前缀）。
 */
import type { DigestFace } from '@studio-next/core'
import { semanticDigestOfJson } from '@studio-next/core'

/** 夹具档身份（测试内自洽；不冒充登记档） */
export const GATE_PROFILE_ID = 'sn.work.gate.test'
export const GATE_PROFILE_VERSION = '1.0.0'

/** 语义摘要失败＝夹具错误（直接抛出，不用假值掩盖） */
function digestOf(value: unknown): DigestFace {
  const result = semanticDigestOfJson(value)
  if (!result.ok) throw new Error(`fixture digest failed: ${result.diagnostics[0]?.messageKey ?? 'unknown'}`)
  return result.value
}

/** 档摘要（对档身份投影取语义摘要；可复算） */
export function gateProfileDigest(): DigestFace {
  return digestOf({ profileId: GATE_PROFILE_ID, version: GATE_PROFILE_VERSION })
}

/** 算子全集（本实现支持算子；档声明全集——档外算子拒收 RULE-06） */
const ALL_OPERATORS = [
  'not',
  'present',
  'absent',
  'isNull',
  'neg',
  'dec',
  'int',
  'and',
  'or',
  'eq',
  'ne',
  'lt',
  'le',
  'gt',
  'ge',
  'add',
  'sub',
  'mul',
  'div',
  'in',
  'forall',
  'exists',
  'match',
] as const

/** 合法档（浅合并覆盖——负例改一处即静态面不过） */
export function gateProfile(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    profileId: GATE_PROFILE_ID,
    version: GATE_PROFILE_VERSION,
    status: 'vectors-published',
    semanticDigest: gateProfileDigest(),
    operators: [...ALL_OPERATORS],
    limits: {
      ceiling: {
        maxNodes: 200,
        maxDepth: 40,
        maxListItems: 100,
        maxTextCodepoints: 4096,
        maxSignificantDigits: 34,
        maxScale: 9,
        maxEvalSteps: 10_000,
      },
      fixed: {
        maxPatternInputCodepoints: 4096,
        maxPatternSteps: 500_000,
        maxQuantifierNesting: 4,
      },
    },
    patternModel: {
      matchingModel: 'linear-nfa',
      anchoring: 'full-match',
      caseSensitive: true,
      maxQuantifierBound: 1000,
    },
    determinism: {
      unicodeVersion: 'Unicode 15.1.0',
      linebreakDef: 'LF',
      strComparison: 'codepoint',
      decimalContext: { precision: 34, rounding: 'half-even' },
    },
    caseSetRefs: [
      {
        setId: 'sn.work.gate.cases',
        version: '1.0.0',
        digest: digestOf({ setId: 'sn.work.gate.cases', version: '1.0.0' }),
      },
    ],
  }
  return { ...base, ...overrides }
}

/** 输入声明（门级规则消费的最小输入面：任务等级 ≥3） */
const GATE_INPUT_DECL = {
  roots: ['task'],
  fields: [{ path: '/task/level', type: 'integer', required: true, nullable: false, absenceTolerant: false }],
}

/** 合法规则载体（等级≥3 即门可开工；expression 可覆盖） */
export function gateRule(expression?: unknown): Record<string, unknown> {
  return {
    ruleProfileRef: { profileId: GATE_PROFILE_ID, version: GATE_PROFILE_VERSION, digest: gateProfileDigest() },
    inputDecl: GATE_INPUT_DECL,
    expression:
      expression ??
      ({
        node: 'binary',
        op: 'ge',
        left: { node: 'input', path: '/task/level' },
        right: { node: 'literal', type: { kind: 'Int' }, value: 3 },
      } as const),
  }
}

/** 合法输入面（level=5 → 规则 true；level=1 → false） */
export const GATE_INPUTS = { task: { level: 5 } }
