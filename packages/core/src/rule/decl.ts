/**
 * rule/decl —— 规则输入声明（RULE-02）与档引用（§6.5）的静态校验
 *
 * 依据：
 *   - v2/10 §6.2 RULE-02（`inputDecl = {roots: list<token>, fields: list<{path: JSON Pointer,
 *     type: 标量族, required, nullable, absenceTolerant, default?}>}`；`absenceTolerant` 缺省
 *     false、必须逐字段声明、不得整组放行；path 静态可解析，解析不到即拒收 E-RULE-004）；
 *   - v2/10 §6.2 RULE-05（同一字段同时声明缺省与 `absenceTolerant=true`＝声明期拒收
 *     E-RULE-004；缺省在方向表之前生效）；
 *   - v2/10 §6.5（规则引用结构 `{ruleProfileRef, expression, inputDecl, humanText?}`；档引用
 *     digest 必须是 semanticDigest；未知档/版本 E-RULE-010）；
 *   - v2/10 §八：E-RULE-001（声明结构非法）、E-RULE-003（值域/类型不符面）、E-RULE-004
 *     （路径不可解析/缺省声明冲突）、E-RULE-010（policy：档版本与引用不一致）。
 *
 * 零 IO：纯声明校验，不解析外部文件、不读时钟。
 */

import type { Diagnostic, DigestFace, InputDecl, RuleProfileRef, RuleProfileSpec, RuleType } from '../spec.ts'
import { SCALAR_FAMILIES, isDotid, isJsonPointer, isToken, makeDiagnostic, parseSemver } from '../spec.ts'
import { validateDigestFace } from '../jcs.ts'
import { parseRuleTypeShape } from './expr.ts'
import { resolveFieldType } from './bind.ts'
import { jsonToRuleValue } from './value.ts'

const INPUT_DECL_KEYS = ['roots', 'fields'] as const
const INPUT_FIELD_KEYS = ['path', 'type', 'required', 'nullable', 'absenceTolerant', 'default'] as const

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function declError(diagnostics: Diagnostic[], location: string, messageKey: string, args: readonly (string | number | boolean)[] = []): void {
  diagnostics.push(makeDiagnostic('E-RULE-001', location, messageKey, args))
}

/** 声明期的缺省/容忍冲突与值域校验（RULE-05：声明期拒收而非运行期猜） */
function checkFieldDeclaration(
  diagnostics: Diagnostic[],
  location: string,
  path: string,
  type: RuleType,
  required: boolean,
  nullable: boolean,
  absenceTolerant: boolean,
  defaultValue: unknown,
): void {
  if (defaultValue === undefined) return
  if (absenceTolerant) {
    // RULE-05：缺省与容忍同时声明＝声明期拒收（缺省在方向表之前生效，容忍让位于未知）
    diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/default-tolerant-conflict', [path]))
  }
  if (required) {
    diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/default-required-conflict', [path]))
  }
  if (defaultValue === null) {
    if (!nullable) diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/default-null-not-nullable', [path]))
    return
  }
  const converted = jsonToRuleValue(type, defaultValue)
  if (!converted.ok) {
    // 缺省值不在声明类型的值域内＝声明与值域冲突（E-RULE-004；不是运行期绑定错）
    diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/default-type', [path, converted.detail]))
  }
}

/**
 * 输入声明校验：字段集封闭（未知键拒收）、path 必须是可解析 JSON Pointer 且不重复、
 * type 必须是标量族或显式求值类型、缺省/容忍/必需三声明互不冲突。
 */
export function readInputDecl(raw: unknown, diagnostics: Diagnostic[]): InputDecl | null {
  const record = asRecord(raw)
  if (record === null) {
    declError(diagnostics, '/inputDecl', 'rule/input-decl-shape')
    return null
  }
  for (const key of Object.keys(record)) {
    if (!(INPUT_DECL_KEYS as readonly string[]).includes(key)) {
      declError(diagnostics, `/inputDecl/${key}`, 'rule/unknown-key', [key])
    }
  }
  const rootsRaw = record['roots']
  const roots: string[] = []
  if (!Array.isArray(rootsRaw) || rootsRaw.length === 0) {
    declError(diagnostics, '/inputDecl/roots', 'rule/input-roots')
  } else {
    for (const root of rootsRaw) {
      if (typeof root !== 'string' || !isToken(root)) {
        declError(diagnostics, '/inputDecl/roots', 'rule/input-roots')
        continue
      }
      roots.push(root)
    }
  }
  const fieldsRaw = record['fields']
  if (!Array.isArray(fieldsRaw)) {
    declError(diagnostics, '/inputDecl/fields', 'rule/input-fields-shape')
    return null
  }
  const fields: InputDecl['fields'][number][] = []
  const seenPaths = new Set<string>()
  for (const [index, entry] of fieldsRaw.entries()) {
    const location = `/inputDecl/fields/${index}`
    const field = asRecord(entry)
    if (field === null) {
      declError(diagnostics, location, 'rule/input-field-shape')
      continue
    }
    for (const key of Object.keys(field)) {
      if (!(INPUT_FIELD_KEYS as readonly string[]).includes(key)) {
        declError(diagnostics, `${location}/${key}`, 'rule/unknown-key', [key])
      }
    }
    const path = field['path']
    if (typeof path !== 'string' || !isJsonPointer(path) || path === '') {
      diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/path-unresolvable', [String(path)]))
      continue
    }
    if (seenPaths.has(path)) {
      diagnostics.push(makeDiagnostic('E-RULE-004', location, 'rule/input-duplicate', [path]))
      continue
    }
    seenPaths.add(path)
    const rawType = field['type']
    let type: RuleType | null = null
    if (typeof rawType === 'string') {
      if ((SCALAR_FAMILIES as readonly string[]).includes(rawType)) {
        type = resolveFieldType({ path, type: rawType as InputDecl['fields'][number]['type'], required: false, nullable: false, absenceTolerant: false })
      }
    } else {
      type = parseRuleTypeShape(rawType)
    }
    if (type === null) {
      declError(diagnostics, `${location}/type`, 'rule/input-type', [String(rawType)])
      continue
    }
    const required = field['required']
    const nullable = field['nullable']
    const absenceTolerant = field['absenceTolerant'] === undefined ? false : field['absenceTolerant']
    if (typeof required !== 'boolean' || typeof nullable !== 'boolean' || typeof absenceTolerant !== 'boolean') {
      declError(diagnostics, location, 'rule/input-field-shape')
      continue
    }
    checkFieldDeclaration(diagnostics, location, path, type, required, nullable, absenceTolerant, field['default'])
    const declared: InputDecl['fields'][number] = {
      path,
      type: typeof rawType === 'string' ? (rawType as InputDecl['fields'][number]['type']) : type,
      required,
      nullable,
      absenceTolerant,
    }
    if (field['default'] !== undefined) {
      fields.push({ ...declared, default: field['default'] as string | number | boolean | null })
    } else {
      fields.push(declared)
    }
  }
  return { roots, fields }
}

/** 规则引用的档字段校验：身份逐字一致 + digest 必须是同一 semanticDigest（E-RULE-010） */
export function readProfileRef(raw: unknown, profile: RuleProfileSpec, diagnostics: Diagnostic[]): RuleProfileRef | null {
  const record = asRecord(raw)
  if (record === null) {
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef', 'rule/profile-ref-shape'))
    return null
  }
  const profileId = record['profileId']
  const version = record['version']
  if (typeof profileId !== 'string' || typeof version !== 'string' || profileId !== profile.profileId || version !== profile.version) {
    // RULE-01：档版本与引用不一致（含未知档/未知版本）＝E-RULE-010
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef', 'rule/profile-ref-mismatch', [String(profileId), String(version)]))
    return null
  }
  if (parseSemver(version) === null) {
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef/version', 'rule/profile-version', [version]))
    return null
  }
  const digestRaw = asRecord(record['digest'])
  let digest: DigestFace | null = null
  if (digestRaw === null) {
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef/digest', 'rule/profile-ref-shape'))
  } else {
    const structDiagnostics = validateDigestFace(digestRaw)
    if (structDiagnostics.length > 0) {
      diagnostics.push(...structDiagnostics)
    } else {
      digest = {
        algorithm: 'sha-256',
        value: String(digestRaw['value']),
        kind: 'semantic',
        canonicalizationId: String(digestRaw['canonicalizationId']),
        canonicalizationVersion: Number(digestRaw['canonicalizationVersion']),
      }
      if (digest.value !== profile.semanticDigest.value) {
        diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef/digest', 'rule/profile-digest-mismatch', [digest.value]))
        digest = null
      }
    }
  }
  if (digest === null) return null
  return { profileId, version, digest }
}

/** 档登记项定位（未知档＝E-RULE-010；已撤回档不得新引用——RULE-01） */
export function checkKnownProfile(
  profile: RuleProfileSpec,
  known: readonly { readonly profile: RuleProfileSpec; readonly withdrawn: boolean }[] | undefined,
  diagnostics: Diagnostic[],
): void {
  if (known === undefined) return
  const entry = known.find(
    (candidate) => candidate.profile.profileId === profile.profileId && candidate.profile.version === profile.version,
  )
  if (entry === undefined) {
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef', 'rule/profile-unknown', [profile.profileId, profile.version]))
    return
  }
  if (entry.withdrawn) {
    diagnostics.push(makeDiagnostic('E-RULE-010', '/ruleProfileRef', 'rule/profile-withdrawn', [profile.profileId, profile.version]))
  }
}

/** 档标识校验（dotid 形态的再确认；供 profile/decl 之外的上层复用） */
export function isRuleProfileId(text: string): boolean {
  return isDotid(text)
}
