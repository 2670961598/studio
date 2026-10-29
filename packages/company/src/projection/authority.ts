/**
 * 组织纯投影 · 权威面对账（O3-01 复验；MIG-05 / IMPL-05-03）
 *
 * 三契约（v1）：76 `DEF-ORG-01` 语义 schema｜`validator.ts` 部门形状｜`81-files/19` 逐文件
 * 契约。对「部门」给出互斥形状、且组织事实源迁移无决定授权（docs/audit-DSF/O3 §…；v2/17
 * O3-01 行）——V2 消解口径：**旧格式只读投影 + 新格式权威**（docs/v2/06 §四.3）。
 *
 * 本件只做三件事（纯函数、零 IO）：
 *   1. 把三个声明面收成一张对象表：legacy-index（org-config 索引）/ legacy-file（逐文件
 *      config.yaml）/ definition（定义包组织面）；
 *   2. 同一对象出现两**权威**（legacy 契约与 definition 契约）→ 阻断，不静默择一；
 *   3. legacy 索引与 legacy 逐文件是**同一契约的镜像面**，字段漂移→阻断（两个声明不能
 *      各自当权威）。
 *
 * 不合并、不回落、不覆盖：冲突对象不入 canonical（宁可缺节点也不产出两权威节点）。
 */
import { compareText, ISSUE_CODES, projectionIssue } from './issues.ts'
import { O3_01 } from './types.ts'
import type {
  AuthorityReconciliation,
  OrganizationAuthority,
  OrganizationContract,
  OrganizationDeclarationSource,
  OrganizationProjectionInput,
  ParsedDepartment,
  ParsedDepartmentFile,
  ProjectionIssue,
} from './types.ts'

/** 收口后的部门对象（恰一个权威面；legacy 契约下 declaredBy 可含索引/逐文件两个镜像面）。 */
export interface CanonicalDepartment {
  path: string
  name: string
  parent: string | null
  leaderRef: string | null
  level: number | null
  hardCore: readonly string[]
  hardCoreRef: string | null
  contract: OrganizationContract
  authority: OrganizationAuthority
  declaredBy: readonly OrganizationDeclarationSource[]
}

/** 部门声明面收口结果。 */
export interface DepartmentReconciliation {
  canonical: readonly CanonicalDepartment[]
  authority: AuthorityReconciliation
  issues: readonly ProjectionIssue[]
}

interface Bucket {
  index?: ParsedDepartment
  file?: ParsedDepartmentFile
  definition?: ParsedDepartment
}

/** 声明面 → 对象表 → canonical（含 O3-01 冲突与 legacy 镜像漂移阻断）。 */
export function reconcileDepartmentDeclarations(input: OrganizationProjectionInput): DepartmentReconciliation {
  const issues: ProjectionIssue[] = []
  const buckets = new Map<string, Bucket>()
  const seen = new Set<string>()

  const register = (source: OrganizationDeclarationSource, declaration: ParsedDepartment): void => {
    const path = typeof declaration.path === 'string' ? declaration.path : ''
    const name = typeof declaration.name === 'string' ? declaration.name : ''
    if (path.trim() === '' || name.trim() === '') {
      issues.push(
        projectionIssue(
          'authority',
          ISSUE_CODES.declarationShape,
          path !== '' ? path : '(department)',
          `部门声明形状不完整（来源=${source}；name/path 必填非空）——组织对象无法识别，投影拒绝（不静默跳过）`,
        ),
      )
      return
    }
    const key = `${source}\u0000${path}`
    if (seen.has(key)) {
      issues.push(
        projectionIssue(
          'authority',
          ISSUE_CODES.duplicateDeclaration,
          path,
          `同一来源（${source}）对 ${path} 重复声明——对象身份不唯一，投影拒绝（不取首/末条冒充唯一）`,
        ),
      )
      return
    }
    seen.add(key)
    const bucket = buckets.get(path) ?? {}
    if (source === 'legacy-index') bucket.index = declaration
    else if (source === 'legacy-file') bucket.file = declaration
    else bucket.definition = declaration
    buckets.set(path, bucket)
  }

  for (const declaration of input.org.departments ?? []) register('legacy-index', declaration)
  for (const declaration of input.departmentFiles ?? []) register('legacy-file', declaration)
  for (const declaration of input.definition?.departments ?? []) register('definition', declaration)

  const canonical: CanonicalDepartment[] = []
  const legacyObjects: string[] = []
  const definitionObjects: string[] = []
  const conflicts: string[] = []

  for (const [path, bucket] of buckets) {
    const hasLegacy = bucket.index !== undefined || bucket.file !== undefined
    const hasDefinition = bucket.definition !== undefined

    // O3-01：同一对象不得同时落在两权威面——不选优先级、不合并
    if (hasLegacy && hasDefinition) {
      conflicts.push(path)
      issues.push(
        projectionIssue(
          'authority',
          ISSUE_CODES.authorityConflict,
          path,
          `部门 ${path} 同时出现在 legacy（org-config/departments 只读面）与 definition（定义包权威面）——O3-01 三契约互斥：同一对象不得有两权威（${O3_01.resolution}）；投影拒绝，不静默择一`,
        ),
      )
      continue
    }

    if (bucket.definition !== undefined) {
      canonical.push(toCanonical(bucket.definition, 'definition', ['definition']))
      definitionObjects.push(path)
      continue
    }

    const legacy = bucket.index ?? bucket.file
    if (legacy === undefined) continue
    const declaredBy: OrganizationDeclarationSource[] = []
    if (bucket.index !== undefined) declaredBy.push('legacy-index')
    if (bucket.file !== undefined) declaredBy.push('legacy-file')
    // 同一 legacy 契约的两个镜像声明面必须一致；不一致=两处各自当权威→拒
    if (bucket.index !== undefined && bucket.file !== undefined) {
      const drift = mirrorDrift(bucket.index, bucket.file)
      if (drift.length > 0) {
        issues.push(
          projectionIssue(
            'authority',
            ISSUE_CODES.legacyFaceDrift,
            path,
            `部门 ${path} 的 org-config 索引与 departments/<path>/config.yaml 不一致（漂移字段：${drift.join('/')}）——同一对象两处声明不得各自当权威（v2/06 §四.3 旧格式只读投影；O3-01 复验）`,
          ),
        )
      }
    }
    canonical.push(toCanonical(legacy, 'legacy', declaredBy))
    legacyObjects.push(path)
  }

  canonical.sort((a, b) => compareText(a.path, b.path))
  legacyObjects.sort(compareText)
  definitionObjects.sort(compareText)
  conflicts.sort(compareText)

  return {
    canonical,
    authority: {
      table: 'O3-01',
      rule: O3_01.rule,
      resolution: O3_01.resolution,
      legacyObjects,
      definitionObjects,
      conflicts,
    },
    issues,
  }
}

function toCanonical(
  declaration: ParsedDepartment,
  contract: OrganizationContract,
  declaredBy: readonly OrganizationDeclarationSource[],
): CanonicalDepartment {
  return {
    path: declaration.path,
    name: declaration.name,
    parent: declaration.parent ?? null,
    leaderRef: declaration.leader ?? null,
    level: declaration.level ?? null,
    hardCore: declaration.hardCore ?? [],
    hardCoreRef: declaration.hardCoreRef ?? null,
    contract,
    authority: contract === 'legacy' ? 'legacy-readonly' : 'definition',
    declaredBy,
  }
}

/** legacy 镜像面漂移字段（索引 vs 逐文件；比较投影相关字段，不比较正文类扩展键）。 */
function mirrorDrift(index: ParsedDepartment, file: ParsedDepartmentFile): readonly string[] {
  const drift: string[] = []
  if (index.name !== file.name) drift.push('name')
  if ((index.parent ?? null) !== (file.parent ?? null)) drift.push('parent')
  if ((index.leader ?? null) !== (file.leader ?? null)) drift.push('leader')
  if ((index.level ?? null) !== (file.level ?? null)) drift.push('level')
  if (!sameStringList(index.lanes, file.lanes)) drift.push('lanes')
  if (!sameStringList(index.functions, file.functions)) drift.push('functions')
  // 部门硬核只读声明面（NEG-ORG-05）：两个镜像声明不得各自当权威
  if (!sameStringList(index.hardCore, file.hardCore)) drift.push('hardCore')
  if ((index.hardCoreRef ?? null) !== (file.hardCoreRef ?? null)) drift.push('hardCoreRef')
  return drift
}

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = left ?? []
  const b = right ?? []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** people 索引 id 集（legacy + definition；人员身份不在 O3-01 部门对象面内）。 */
export function collectPersonIds(input: OrganizationProjectionInput): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const person of input.org.people ?? []) ids.add(person.id)
  for (const person of input.definition?.people ?? []) ids.add(person.id)
  return ids
}
