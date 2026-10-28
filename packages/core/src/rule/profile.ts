/**
 * rule/profile —— 规则求值档的结构校验（RULE-01/06 的声明面；ENU-92/104/105/106）
 *
 * 依据：
 *   - v2/10 §6.1/§6.2 RULE-01（档＝`{profileId: dotid, version: semver, status: enum,
 *     semanticDigest: ENC-08}`；档＝语言不是单条规则；档升级属变更链）；
 *   - §6.3 结构块（limitsApplied 七项＋档内固定三项、patternModel、determinism）；
 *   - §1.3（引用钉精确版本，禁「当前最新」）、§2.8（ENC-08 摘要结构）、§5.1（轴）、
 *     §6.5（档必带 caseSetRefs）；
 *   - v2/09 ENU-92（档状态三值）、ENU-104（限额机器名）、ENU-105（结构块值）、
 *     ENU-106（Unicode 15.1.0）；
 *   - v2/10 §八：档结构不合法＝E-RULE-001（parse）；未知/档外算子＝E-RULE-002（parse）；
 *     摘要结构违规＝E-ENC-001（structure，本件复用 jcs 校验，不另造码）。
 *
 * 零 IO、无宿主读取。
 */

import type { Diagnostic, DigestFace, LimitsApplied, RuleProfileSpec } from '../spec.ts'
import {
  FIXED_LIMIT_NAMES,
  LIMITS_APPLIED_NAMES,
  PROFILE_STATUSES,
  UNICODE_VERSION,
  isDotid,
  makeDiagnostic,
  parseSemver,
} from '../spec.ts'
import { validateDigestFace } from '../jcs.ts'
import { BINARY_OPERATORS, UNARY_OPERATORS } from './expr.ts'

/** 本实现语法面支持的算子名（档的算子全集必须落在此集合内；档外算子拒收 E-RULE-002） */
export const SUPPORTED_RULE_OPERATORS: readonly string[] = [
  ...UNARY_OPERATORS,
  ...BINARY_OPERATORS,
  'forall',
  'exists',
  'match',
]

/** 档校验结果：成功携收窄后的档；失败携封闭码诊断 */
export type ProfileTypecheckResult =
  | { readonly ok: true; readonly profile: RuleProfileSpec; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/** 已登记档（用于拒绝未知档/未知版本/已撤回档——RULE-01/E-RULE-010） */
export interface KnownRuleProfile {
  readonly profile: RuleProfileSpec
  readonly withdrawn: boolean
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function profileError(diagnostics: Diagnostic[], location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): void {
  diagnostics.push(makeDiagnostic('E-RULE-001', location, messageKey, args))
}

function readLimitBlock(
  raw: unknown,
  names: readonly string[],
  diagnostics: Diagnostic[],
  location: string,
): Record<string, number> | null {
  const record = asRecord(raw)
  if (record === null) {
    profileError(diagnostics, location, 'rule/limits-shape')
    return null
  }
  const keys = Object.keys(record).sort()
  const expected = [...names].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    profileError(diagnostics, location, 'rule/limits-names', [keys.join(',')])
    return null
  }
  const out: Record<string, number> = {}
  for (const name of names) {
    const value = record[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || !Number.isSafeInteger(value)) {
      profileError(diagnostics, `${location}/${name}`, 'rule/limits-value', [name, String(value)])
      continue
    }
    out[name] = value
  }
  return out
}

function readSemanticDigest(raw: unknown, diagnostics: Diagnostic[], location: string): DigestFace | null {
  const record = asRecord(raw)
  if (record === null) {
    diagnostics.push(makeDiagnostic('E-RULE-001', location, 'rule/digest-shape'))
    return null
  }
  const structDiagnostics = validateDigestFace(record)
  if (structDiagnostics.length > 0) {
    diagnostics.push(...structDiagnostics)
    return null
  }
  return {
    algorithm: 'sha-256',
    value: String(record['value']),
    kind: 'semantic',
    canonicalizationId: String(record['canonicalizationId']),
    canonicalizationVersion: Number(record['canonicalizationVersion']),
  }
}

function readPatternModel(
  raw: unknown,
  diagnostics: Diagnostic[],
): RuleProfileSpec['patternModel'] | null {
  const record = asRecord(raw)
  if (record === null) {
    profileError(diagnostics, '/patternModel', 'rule/pattern-model-shape')
    return null
  }
  const matchingModel = record['matchingModel']
  const anchoring = record['anchoring']
  const caseSensitive = record['caseSensitive']
  const bound = record['maxQuantifierBound']
  if (matchingModel !== 'linear-nfa') profileError(diagnostics, '/patternModel/matchingModel', 'rule/pattern-model', [String(matchingModel)])
  if (anchoring !== 'full-match') profileError(diagnostics, '/patternModel/anchoring', 'rule/pattern-model', [String(anchoring)])
  if (typeof caseSensitive !== 'boolean') profileError(diagnostics, '/patternModel/caseSensitive', 'rule/pattern-model', ['caseSensitive'])
  if (typeof bound !== 'number' || !Number.isInteger(bound) || bound < 1 || bound > 1000) {
    // §6.3：maxQuantifierBound ≤1000
    profileError(diagnostics, '/patternModel/maxQuantifierBound', 'rule/pattern-bound', [String(bound)])
  }
  return {
    matchingModel: 'linear-nfa',
    anchoring: 'full-match',
    caseSensitive: caseSensitive === true,
    maxQuantifierBound: typeof bound === 'number' ? bound : 0,
  }
}

function readDeterminism(
  raw: unknown,
  diagnostics: Diagnostic[],
): RuleProfileSpec['determinism'] | null {
  const record = asRecord(raw)
  if (record === null) {
    profileError(diagnostics, '/determinism', 'rule/determinism-shape')
    return null
  }
  const unicodeVersion = record['unicodeVersion']
  const linebreakDef = record['linebreakDef']
  const strComparison = record['strComparison']
  const decimalRaw = asRecord(record['decimalContext'])
  if (typeof unicodeVersion !== 'string') profileError(diagnostics, '/determinism/unicodeVersion', 'rule/determinism-shape')
  if (typeof linebreakDef !== 'string') profileError(diagnostics, '/determinism/linebreakDef', 'rule/determinism-shape')
  if (strComparison !== 'codepoint' && strComparison !== 'nfc') {
    profileError(diagnostics, '/determinism/strComparison', 'rule/determinism-shape')
  }
  if (strComparison === 'nfc' && unicodeVersion !== UNICODE_VERSION) {
    // RULE-08：未钉版本的 Unicode 归一禁止（ENU-106 钉 Unicode 15.1.0）
    profileError(diagnostics, '/determinism/unicodeVersion', 'rule/unicode-unpinned', [String(unicodeVersion)])
  }
  const precision = decimalRaw?.['precision']
  const rounding = decimalRaw?.['rounding']
  if (typeof precision !== 'number' || !Number.isInteger(precision) || precision < 1 || precision > 34) {
    profileError(diagnostics, '/determinism/decimalContext/precision', 'rule/determinism-shape')
  }
  if (rounding !== 'half-even' && rounding !== 'floor' && rounding !== 'ceiling') {
    profileError(diagnostics, '/determinism/decimalContext/rounding', 'rule/determinism-shape')
  }
  return {
    unicodeVersion: typeof unicodeVersion === 'string' ? unicodeVersion : '',
    linebreakDef: typeof linebreakDef === 'string' ? linebreakDef : '',
    strComparison: strComparison === 'nfc' ? 'nfc' : 'codepoint',
    decimalContext: {
      precision: typeof precision === 'number' ? precision : 0,
      rounding: rounding === 'floor' || rounding === 'ceiling' ? rounding : 'half-even',
    },
  }
}

function readCaseSets(raw: unknown, diagnostics: Diagnostic[]): RuleProfileSpec['caseSetRefs'] {
  const refs: RuleProfileSpec['caseSetRefs'][number][] = []
  if (!Array.isArray(raw) || raw.length === 0) {
    // §6.5：档必带 caseSetRefs（无用例的档不得被跨实现声明支持）
    profileError(diagnostics, '/caseSetRefs', 'rule/case-set-missing')
    return refs
  }
  for (const [index, entry] of raw.entries()) {
    const location = `/caseSetRefs/${index}`
    const record = asRecord(entry)
    if (record === null) {
      profileError(diagnostics, location, 'rule/case-set-shape')
      continue
    }
    const setId = record['setId']
    const version = record['version']
    if (typeof setId !== 'string' || !isDotid(setId)) profileError(diagnostics, `${location}/setId`, 'rule/case-set-shape')
    if (typeof version !== 'string' || parseSemver(version) === null) profileError(diagnostics, `${location}/version`, 'rule/case-set-shape')
    const digest = readSemanticDigest(record['digest'], diagnostics, `${location}/digest`)
    if (digest !== null) refs.push({ setId: String(setId), version: String(version), digest })
  }
  return refs
}

/**
 * 档结构校验入口（RULE-01 身份/版本/状态/摘要；RULE-06 限额与结构块；RULE-08 档纯度）。
 * 失败即档不合法——不得进入 `typecheckRuleProfile` 的规则面，更不得求值。
 */
export function validateRuleProfile(raw: unknown): ProfileTypecheckResult {
  const diagnostics: Diagnostic[] = []
  const record = asRecord(raw)
  if (record === null) {
    profileError(diagnostics, '', 'rule/profile-shape')
    return { ok: false, diagnostics }
  }
  const profileId = record['profileId']
  if (typeof profileId !== 'string' || !isDotid(profileId)) {
    profileError(diagnostics, '/profileId', 'rule/profile-id', [String(profileId)])
  }
  const version = record['version']
  if (typeof version !== 'string' || parseSemver(version) === null) {
    // §1.3：每个引用钉精确版本；通配/脱字符/「最新」不是版本引用
    profileError(diagnostics, '/version', 'rule/profile-version', [String(version)])
  }
  const status = record['status']
  if (typeof status !== 'string' || !(PROFILE_STATUSES as readonly string[]).includes(status)) {
    profileError(diagnostics, '/status', 'rule/profile-status', [String(status)])
  }
  const semanticDigest = readSemanticDigest(record['semanticDigest'], diagnostics, '/semanticDigest')
  const operatorsRaw = record['operators']
  const operators: string[] = []
  if (!Array.isArray(operatorsRaw) || operatorsRaw.length === 0) {
    profileError(diagnostics, '/operators', 'rule/operators-shape')
  } else {
    const seen = new Set<string>()
    for (const [index, operator] of operatorsRaw.entries()) {
      if (typeof operator !== 'string' || !SUPPORTED_RULE_OPERATORS.includes(operator)) {
        // RULE-06：档外/未知算子拒收（E-RULE-002）
        diagnostics.push(makeDiagnostic('E-RULE-002', `/operators/${index}`, 'rule/operator-unknown', [String(operator)]))
        continue
      }
      if (seen.has(operator)) profileError(diagnostics, `/operators/${index}`, 'rule/operator-duplicate', [operator])
      seen.add(operator)
      operators.push(operator)
    }
  }
  const limitsRaw = asRecord(record['limits'])
  const ceiling = readLimitBlock(limitsRaw?.['ceiling'], LIMITS_APPLIED_NAMES, diagnostics, '/limits/ceiling')
  const fixed = readLimitBlock(limitsRaw?.['fixed'], FIXED_LIMIT_NAMES, diagnostics, '/limits/fixed')
  const patternModel = readPatternModel(record['patternModel'], diagnostics)
  const determinism = readDeterminism(record['determinism'], diagnostics)
  const caseSetRefs = readCaseSets(record['caseSetRefs'], diagnostics)
  const ambientReads = record['ambientReads']
  if (ambientReads !== undefined) {
    if (!Array.isArray(ambientReads)) {
      profileError(diagnostics, '/ambientReads', 'rule/ambient-reads', ['shape'])
    } else if (ambientReads.length > 0) {
      // RULE-08/NEG-RULE-06：声明读宿主时间/环境/随机/模型（或文件/网络/进程）的档不合法
      profileError(diagnostics, '/ambientReads', 'rule/ambient-reads', [ambientReads.map(String).join(',')])
    }
  }
  const failed = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  if (
    failed ||
    semanticDigest === null ||
    ceiling === null ||
    fixed === null ||
    patternModel === null ||
    determinism === null ||
    typeof profileId !== 'string' ||
    typeof version !== 'string' ||
    typeof status !== 'string'
  ) {
    return { ok: false, diagnostics }
  }
  const profile: RuleProfileSpec = {
    profileId,
    version,
    status: status as RuleProfileSpec['status'],
    semanticDigest,
    operators,
    limits: {
      ceiling: ceiling as unknown as LimitsApplied,
      fixed: fixed as unknown as RuleProfileSpec['limits']['fixed'],
    },
    patternModel,
    determinism,
    caseSetRefs,
  }
  return { ok: true, profile, diagnostics }
}
