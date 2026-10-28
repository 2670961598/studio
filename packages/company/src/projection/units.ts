/**
 * 组织纯投影 · 一级单元与空编收口（MIG-05 / IMPL-05-03；自 org-structure.ts 拆出）
 *
 * 拆分依据：宪法 20-§十五 单件 ≤600 行（org-structure 含结构面编排与 CL 判据，超过阈值即拆；
 * 拆分为「单元/空编声明收口」＋「结构面编排」两件，职责各自内聚）。
 *
 * 本件职责（纯函数、零 IO）：
 *   - 一级单元声明收口（O3-01：legacy/definition 同对象不得两权威）＋域校验＋权威面记录；
 *   - 空编声明收口（同则）＋空编对象 id 前缀（`vacancy:<kind>:<ref>`）；
 *   - 单元 N 的投影载形常量（`unitCount`/`units[]` 的 `unitId`/`domain`/`headRef`/
 *     `vacancyState`/`reviewAt`——GAP-V2-17；本件不新增 YAML 键/记录类）；
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

/** ISO 8601 形状闸（日期或日期时刻；是否逾期归消费方按时钟判）。 */
export const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/

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

export function reconcileUnits(input: OrganizationProjectionInput, issues: ProjectionIssue[]): UnitReconciliation {
  const buckets = new Map<string, { legacy?: ParsedUnit; definition?: ParsedUnit }>()
  const seen = new Set<string>()
  const register = (source: OrganizationDeclarationSource, unit: ParsedUnit): void => {
    const unitId = typeof unit.unitId === 'string' ? unit.unitId : ''
    if (unitId.trim() === '') {
      issues.push(projectionIssue('authority', ISSUE_CODES.declarationShape, 'unit:(empty)', `一级单元声明缺 unitId（来源=${source}）——对象身份不明，投影拒绝`))
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
  for (const unit of input.org.units ?? []) register('legacy-index', unit)
  for (const unit of input.definition?.units ?? []) register('definition', unit)

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
