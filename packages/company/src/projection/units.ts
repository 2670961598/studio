/**
 * 组织纯投影 · 一级单元与空编收口（MIG-05 / IMPL-05-03；自 org-structure.ts 拆出）
 *
 * 拆分依据：宪法 20-§十五 单件 ≤600 行（org-structure 含结构面编排与 CL 判据，超过阈值即拆；
 * 拆分为「单元/空编声明收口」＋「结构面编排」两件，职责各自内聚）。
 *
 * 本件职责（纯函数、零 IO）：
 *   - 一级单元声明收口（O3-01：legacy/definition 同对象不得两权威）＋域校验＋权威面记录；
 *   - 空编声明收口（同则）＋空编对象 id 前缀（`vacancy:<kind>:<ref>`）；
 *   - 单元 N 的投影载形（`unitCount`/`units[]` 的 `unitId`/`domain`/`headRef`/
 *     `vacancyState`/`reviewAt`——GAP-V2-17，SCH-ORG-01 字段级承载已落 v2/10 §4.3）；
 *   - 单元字段运行时**形状闸**（`unitFieldShapeViolations`：domain/headRef/vacancyState/
 *     reviewAt 非法形状一律拒——不静默强转、不按字符拆域、不把未知态退化成默认形态；
 *     #552 刀A 的 fail-closed 形状闸不放宽；登记见 split-plan §六）；
 *   - `reviewAt` ISO 8601 形状闸（是否逾期归消费方按时钟判，投影不取时钟）。
 */
import { compareText, ISSUE_CODES, projectionIssue } from './issues.ts'
import { VACANCY_KINDS } from './types.ts'
import type {
  OrganizationAuthority,
  OrganizationDeclarationSource,
  OrganizationProjectionInput,
  ParsedUnit,
  ParsedVacancy,
  ProjectionIssue,
  VacancyKind,
} from './types.ts'

/** 隐式 N=1 单元 id（投影默认值，不是声明；不写死「三省」）。 */
export const IMPLICIT_UNIT_ID = '(whole-company)'

/** ISO 8601 形状闸（单一实现 src/iso8601.ts；是否逾期归消费方按时钟判）。 */
import { ISO_8601_RE } from '../iso8601.ts'
export { ISO_8601_RE }

/** 结构面对象（单元/空编）的权威面记录（部门对象面见 org-tree 的 authority）。 */
export interface StructureAuthority {
  legacyObjects: readonly string[]
  definitionObjects: readonly string[]
  conflicts: readonly string[]
}

/** 一级单元声明收口（同一对象不落两权威——O3-01 同则）。 */
export interface CanonicalUnit {
  unit: ParsedUnit
  authority: OrganizationAuthority
}

/** 空编声明收口。 */
export interface CanonicalVacancy {
  vacancy: ParsedVacancy
  authority: OrganizationAuthority
}

export interface UnitReconciliation {
  canonical: readonly CanonicalUnit[]
  authority: StructureAuthority
}

export interface VacancyReconciliation {
  canonical: readonly CanonicalVacancy[]
  authority: StructureAuthority
}

/**
 * 单元字段运行时形状违规清单（fail-closed：非法形状=拒，不静默强转/丢弃/退化）。
 * 纯函数、零 IO；判的是**已解析输入**的运行时不变量——TS 类型之外，YAML/JSON 直入的
 * 值仍可能越形（如 `domain: 研发` 会被按字符迭代），本闸先拒再投影（不猜不补）。
 */
export function unitFieldShapeViolations(unit: ParsedUnit): string[] {
  const violations: string[] = []
  const domain: unknown = unit.domain
  if (domain !== undefined) {
    if (!Array.isArray(domain)) {
      violations.push(`domain 须为字符串数组（实际 ${typeof domain}）——非数组不得按字符/键迭代成域`)
    } else if (domain.some((token) => typeof token !== 'string' || token.trim() === '')) {
      violations.push('domain 含非字符串/空串 token——域划分须逐项为非空字符串')
    }
  }
  const headRef: unknown = unit.headRef
  if (headRef !== undefined && headRef !== null && (typeof headRef !== 'string' || headRef.trim() === '')) {
    violations.push(`headRef=${JSON.stringify(headRef)} 非法——须为非空工号字符串或 null（空串不得当缺省）`)
  }
  const vacancyState: unknown = unit.vacancyState
  if (vacancyState !== undefined && vacancyState !== 'staffed' && vacancyState !== 'head-vacant') {
    violations.push(`vacancyState=${JSON.stringify(vacancyState)} 不在值集 {staffed, head-vacant}——未知态不得退化成默认形态`)
  }
  const reviewAt: unknown = unit.reviewAt
  if (reviewAt !== undefined && reviewAt !== null && (typeof reviewAt !== 'string' || !ISO_8601_RE.test(reviewAt))) {
    violations.push(`reviewAt=${JSON.stringify(reviewAt)} 非 ISO 8601——复审期限不得静默置空`)
  }
  return violations
}

export function reconcileUnits(input: OrganizationProjectionInput, issues: ProjectionIssue[]): UnitReconciliation {
  const buckets = new Map<string, { legacy?: ParsedUnit; definition?: ParsedUnit }>()
  const seen = new Set<string>()
  const register = (source: OrganizationDeclarationSource, unit: ParsedUnit): void => {
    const unitId = typeof unit.unitId === 'string' ? unit.unitId : ''
    if (unitId.trim() === '') {
      issues.push(projectionIssue('authority', ISSUE_CODES.declarationShape, 'unit:(empty)', `一级单元声明缺 unitId（来源=${source}）——对象身份不明，投影拒绝`))
      return
    }
    const shapeViolations = unitFieldShapeViolations(unit)
    if (shapeViolations.length > 0) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitFieldShape,
          `unit:${unitId}`,
          `一级单元 ${unitId} 字段形状非法（来源=${source}）：${shapeViolations.join('；')}——拒绝，不猜不补`,
        ),
      )
      return
    }
    const key = `${source}\u0000${unitId}`
    if (seen.has(key)) {
      issues.push(projectionIssue('authority', ISSUE_CODES.duplicateDeclaration, `unit:${unitId}`, `同一来源（${source}）对一级单元 ${unitId} 重复声明——对象身份不唯一，投影拒绝`))
      return
    }
    seen.add(key)
    const bucket = buckets.get(unitId) ?? {}
    if (source === 'definition') bucket.definition = unit
    else bucket.legacy = unit
    buckets.set(unitId, bucket)
  }
  const declaredSources: readonly { source: OrganizationDeclarationSource; value: unknown }[] = [
    { source: 'legacy-index', value: input.org.units },
    { source: 'definition', value: input.definition?.units },
  ]
  for (const { source, value } of declaredSources) {
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      // 声明面本身越形（对象/标量）：拒，不得迭代/强转（否则抛 TypeError=失败出口不可读）
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitFieldShape,
          'units',
          `${source} 的 units 声明须为数组（实际 ${typeof value}）——非数组不得迭代/强转，投影拒绝（不猜不补）`,
        ),
      )
      continue
    }
    for (const unit of value as readonly ParsedUnit[]) register(source, unit)
  }

  const canonical: CanonicalUnit[] = []
  const legacyObjects: string[] = []
  const definitionObjects: string[] = []
  const conflicts: string[] = []
  for (const [unitId, bucket] of buckets) {
    if (bucket.legacy !== undefined && bucket.definition !== undefined) {
      conflicts.push(`unit:${unitId}`)
      issues.push(
        projectionIssue(
          'authority',
          ISSUE_CODES.authorityConflict,
          `unit:${unitId}`,
          `一级单元 ${unitId} 同时出现在 legacy 与 definition——同一对象不得有两权威（O3-01）；投影拒绝，不静默择一`,
        ),
      )
      continue
    }
    const unit = bucket.definition ?? bucket.legacy
    if (unit === undefined) continue
    canonical.push({ unit, authority: bucket.definition !== undefined ? 'definition' : 'legacy-readonly' })
    if (bucket.definition !== undefined) definitionObjects.push(`unit:${unitId}`)
    else legacyObjects.push(`unit:${unitId}`)
  }
  canonical.sort((a, b) => compareText(a.unit.unitId, b.unit.unitId))
  return { canonical, authority: faceOf(legacyObjects, definitionObjects, conflicts) }
}

export function reconcileVacancies(input: OrganizationProjectionInput, issues: ProjectionIssue[]): VacancyReconciliation {
  const buckets = new Map<string, { legacy?: ParsedVacancy; definition?: ParsedVacancy }>()
  const seen = new Set<string>()
  const register = (source: OrganizationDeclarationSource, vacancy: ParsedVacancy): void => {
    const key = `${String(vacancy.kind)}\u0000${String(vacancy.ref)}`
    const scoped = `${source}\u0000${key}`
    if (seen.has(scoped)) {
      issues.push(
        projectionIssue('authority', ISSUE_CODES.duplicateDeclaration, `vacancy:${String(vacancy.kind)}:${String(vacancy.ref)}`, `同一来源（${source}）对空编对象重复登记——登记不唯一，投影拒绝`),
      )
      return
    }
    seen.add(scoped)
    const bucket = buckets.get(key) ?? {}
    if (source === 'definition') bucket.definition = vacancy
    else bucket.legacy = vacancy
    buckets.set(key, bucket)
  }
  for (const vacancy of input.org.vacancies ?? []) register('legacy-index', vacancy)
  for (const vacancy of input.definition?.vacancies ?? []) register('definition', vacancy)

  const canonical: CanonicalVacancy[] = []
  const legacyObjects: string[] = []
  const definitionObjects: string[] = []
  const conflicts: string[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.legacy !== undefined && bucket.definition !== undefined) {
      const id = `vacancy:${key.replace('\u0000', ':')}`
      conflicts.push(id)
      issues.push(
        projectionIssue(
          'authority',
          ISSUE_CODES.authorityConflict,
          id,
          '同一空编对象同时出现在 legacy 与 definition——同一对象不得有两权威（O3-01）；投影拒绝，不静默择一',
        ),
      )
      continue
    }
    const vacancy = bucket.definition ?? bucket.legacy
    if (vacancy === undefined) continue
    canonical.push({ vacancy, authority: bucket.definition !== undefined ? 'definition' : 'legacy-readonly' })
    const id = `vacancy:${String(vacancy.kind)}:${String(vacancy.ref)}`
    if (bucket.definition !== undefined) definitionObjects.push(id)
    else legacyObjects.push(id)
  }
  canonical.sort((a, b) => compareText(String(a.vacancy.kind), String(b.vacancy.kind)) || compareText(String(a.vacancy.ref), String(b.vacancy.ref)))
  return { canonical, authority: faceOf(legacyObjects, definitionObjects, conflicts) }
}

function faceOf(legacyObjects: string[], definitionObjects: string[], conflicts: string[]): StructureAuthority {
  return {
    legacyObjects: [...legacyObjects].sort(compareText),
    definitionObjects: [...definitionObjects].sort(compareText),
    conflicts: [...conflicts].sort(compareText),
  }
}

export function mergeAuthorityFaces(...faces: readonly StructureAuthority[]): StructureAuthority {
  const legacyObjects: string[] = []
  const definitionObjects: string[] = []
  const conflicts: string[] = []
  for (const face of faces) {
    legacyObjects.push(...face.legacyObjects)
    definitionObjects.push(...face.definitionObjects)
    conflicts.push(...face.conflicts)
  }
  return faceOf(legacyObjects, definitionObjects, conflicts)
}

export function validateDomain(unit: ParsedUnit, issues: ProjectionIssue[]): readonly string[] {
  const raw = unit.domain ?? []
  if (raw.length === 0) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.unitDomainMissing,
        `unit:${unit.unitId}`,
        `一级单元 ${unit.unitId} 未声明域划分（domain）——N 单元须表达各单元域（v2/06 §5.2；域重叠/空白均不可判）`,
      ),
    )
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const token of raw) {
    if (typeof token !== 'string' || token.trim() === '') {
      issues.push(projectionIssue('structure', ISSUE_CODES.unitDomainMissing, `unit:${unit.unitId}`, `一级单元 ${unit.unitId} 的 domain 含空串——域划分须为非空串`))
      continue
    }
    if (seen.has(token)) {
      issues.push(projectionIssue('structure', ISSUE_CODES.unitDomainOverlap, `unit:${unit.unitId}`, `一级单元 ${unit.unitId} 的 domain 内重复 ${token}——域划分不唯一`))
      continue
    }
    seen.add(token)
    out.push(token)
  }
  out.sort(compareText)
  return out
}

export function isVacancyKind(value: unknown): value is VacancyKind {
  return typeof value === 'string' && (VACANCY_KINDS as readonly string[]).includes(value)
}
