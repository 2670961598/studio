/**
 * test/v2/rule-fixtures —— 规则求值档与规则的合法夹具（MIG-03 / IMPL-03-07）
 *
 * 依据：v2/10 §6.1-§6.3（档形状：身份/版本/状态/semanticDigest/operators/limits/
 *       patternModel/determinism/caseSetRefs）、§6.5（规则引用结构）——夹具只承载形状，
 *       断言语义在 rule-engine*.test.ts（夹具不替代断言）。
 * 纪律：夹具的 `semanticDigest` 由 jcs 语义摘要算出（不手写十六进制、不自造 digest）；
 *       全部常量与函数零 IO（测试文件自身不 import fs/net/child_process）。
 */
import type { DigestFace } from '../../src/spec.ts'
import { semanticDigestOfJson } from '../../src/jcs.ts'

/** 夹具档 id/版本（测试内自洽；不冒充任何已登记档） */
export const PROFILE_ID = 'sn.test.rule.core'
export const PROFILE_VERSION = '1.0.0'

/** 计算语义摘要（失败即夹具错误——直接抛出，不用假值掩盖） */
function digestOf(value: unknown): DigestFace {
  const result = semanticDigestOfJson(value)
  if (!result.ok) throw new Error(`fixture digest failed: ${result.diagnostics[0]?.messageKey ?? 'unknown'}`)
  return result.value
}

/** 档的 semanticDigest（对该档身份投影取语义摘要；测试内固定、可复算） */
export function profileDigest(): DigestFace {
  return digestOf({ profileId: PROFILE_ID, version: PROFILE_VERSION })
}

/** 默认算子全集（本实现支持的算子；档声明全集——RULE-06「档外算子拒收」） */
export const ALL_OPERATORS = [
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

/** 构造合法档（浅合并覆盖；测试按需改一处制造负例） */
export function makeProfile(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    profileId: PROFILE_ID,
    version: PROFILE_VERSION,
    status: 'vectors-published',
    semanticDigest: profileDigest(),
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
    caseSetRefs: [{ setId: 'sn.test.rule.cases', version: '1.0.0', digest: digestOf({ setId: 'sn.test.rule.cases', version: '1.0.0' }) }],
  }
  return { ...base, ...overrides }
}

/** 默认输入声明（测试规则用；path 全部为绝对 JSON Pointer） */
export const DEFAULT_INPUT_DECL = {
  roots: ['task'],
  fields: [
    { path: '/task/level', type: 'integer', required: true, nullable: false, absenceTolerant: false },
    { path: '/task/kind', type: 'text', required: false, nullable: false, absenceTolerant: true },
    // 显式求值类型：RULE-02 的标量族 `list` 不带元素类型参数，类型化使用须显式声明
    { path: '/task/tags', type: { kind: 'List', element: { kind: 'Str' } }, required: false, nullable: false, absenceTolerant: false },
    { path: '/task/priority', type: 'integer', required: false, nullable: false, absenceTolerant: false, default: 3 },
  ],
}

/** 档引用（规则载体用） */
export function profileRef(): Record<string, unknown> {
  return { profileId: PROFILE_ID, version: PROFILE_VERSION, digest: profileDigest() }
}

/** 构造规则载体（浅合并覆盖；expression/inputDecl 由用例给或取缺省字面量比较） */
export function makeRule(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ruleProfileRef: profileRef(),
    inputDecl: DEFAULT_INPUT_DECL,
    expression: {
      node: 'binary',
      op: 'ge',
      left: { node: 'input', path: '/task/level' },
      right: { node: 'literal', type: { kind: 'Int' }, value: 3 },
    },
  }
  return { ...base, ...overrides }
}

/** 常见输入值（合法输入面） */
export const INPUTS = { task: { level: 5, kind: 'review', tags: ['a', 'b'], priority: 3 } }
