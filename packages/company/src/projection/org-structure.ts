/**
 * 组织纯投影 · 结构面（MIG-05 / IMPL-05-03；docs/v2/06 §五）
 *
 * 输出（全部是「判据输入/引用」，不是业务裁决）：
 *   1. 一级单元 N 参数（N≥1，默认 1；三省=N=3 只是示例——代码不写死 3；GAP-V2-17 投影载形
 *      `unitId`/`domain`/`headRef`/`vacancyState`/`reviewAt`）；
 *   2. 空编投影（空编=记录事实：登记＋复审期限；缺复审期限=空编静默→阻断）；
 *   3. CL 判据输入（v2/03 §2.4 逐层累进的 **input**；satisfied=null 表示输入不足，绝不以
 *      company.level 代替——NEG-ORG-06「只改 level 字段」无效）；
 *   4. 保留权力引用（只引用 v2/03 §2.3 表 A′ 行号；不复制正文/归属、不另立副本）；
 *   5. 老板缺席策略投影（NEG-ORG-07：依赖外部老板的硬核四类→内核冻结·运行延续；悬置禁止；
 *      代行者不得是最高宰相；冻结须登记复审——v2/03 §3.5）；
 *   6. 表 A′ 12 行归属（NEG-ORG-02：显式声明则逐行校验；缺失/悬空/可选容器→阻断）；
 *   7. 部门硬核声明（NEG-ORG-05：只读声明须有具名上位授权引用；部门自改=阻断）；
 *   8. 老板可达性处置（NEG-ORG-08：不可达无代行仍推进硬核→阻断；冻结·运行延续保留）。
 *
 * 零 IO：不读文件/不取时钟/不用随机数；reviewAt 只做形状校验，是否逾期由消费方按时钟判定
 * （投影不把「当前时刻」偷渡成事实）。
 */
import { collectPersonIds } from './authority.ts'
import { buildBossReachability } from './boss-reachability.ts'
import { validateDeclaredHardCores } from './hard-core.ts'
import { compareText, ISSUE_CODES, projectionIssue, sortProjectionIssues } from './issues.ts'
import { buildPowerOwnership } from './power-owners.ts'
import { IMPLICIT_UNIT_ID, ISO_8601_RE, isVacancyKind, mergeAuthorityFaces, reconcileUnits, reconcileVacancies, validateDomain } from './units.ts'
import type { StructureAuthority } from './units.ts'
export type { StructureAuthority } from './units.ts'
import type { OrgTreeBuild } from './org-tree.ts'
import { VACANCY_KINDS } from './types.ts'
import type {
  BossAbsenceProjection,
  ClCriteriaProjection,
  ClCriterionInput,
  FirstLevelUnitsProjection,
  OrganizationProjectionInput,
  ProjectedUnit,
  ProjectedVacancy,
  ProjectionIssue,
  ReservedPowerRefsProjection,
  StructureFacts,
  StructureProjection,
} from './types.ts'

/** 结构面投影结果。 */
export interface StructureBuild {
  structure: StructureProjection
  /** 单元/空编对象的权威面（O3-01 同则；与部门面在出口处合并）。 */
  authority: StructureAuthority
  issues: readonly ProjectionIssue[]
}

/** 输入已解析件 → 结构面投影（纯函数，零 IO）。 */
export function buildStructureProjection(input: OrganizationProjectionInput, tree: OrgTreeBuild): StructureBuild {
  const issues: ProjectionIssue[] = []
  const personIds = collectPersonIds(input)

  // ───────────────── 1. 一级单元 N（GAP-V2-17 载形；默认 1，不写死 3） ─────────────────
  const unitsDeclared = input.org.units !== undefined || input.definition?.units !== undefined
  const unitReconciliation = reconcileUnits(input, issues)
  const canonicalUnits = unitReconciliation.canonical
  const totalUnits = canonicalUnits.length

  const projectedUnits: ProjectedUnit[] = []
  const domainOwner = new Map<string, string>()
  const derivedVacancies: ProjectedVacancy[] = []
  for (const canonical of canonicalUnits) {
    const unit = canonical.unit
    const domain = validateDomain(unit, issues)
    for (const token of domain) {
      const owner = domainOwner.get(token)
      if (owner !== undefined && owner !== unit.unitId) {
        issues.push(
          projectionIssue(
            'structure',
            ISSUE_CODES.unitDomainOverlap,
            `unit:${unit.unitId}`,
            `一级单元域重叠：域 ${token} 同时属于 ${owner} 与 ${unit.unitId}——N 单元域不得重叠（v2/03 §八 N 单元域重叠=结构违规判负）`,
          ),
        )
      } else {
        domainOwner.set(token, unit.unitId)
      }
    }

    const headRef = unit.headRef ?? null
    const reviewAt = unit.reviewAt !== undefined && unit.reviewAt !== null && ISO_8601_RE.test(unit.reviewAt) ? unit.reviewAt : null
    let headState: ProjectedUnit['headState']
    if (headRef !== null && personIds.has(headRef) && unit.vacancyState !== 'head-vacant') {
      headState = 'staffed'
    } else if (headRef !== null && !personIds.has(headRef)) {
      headState = 'vacant'
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitHeadUnresolved,
          `unit:${unit.unitId}`,
          `一级单元 ${unit.unitId} 声明首长 ${headRef} 不在 people 索引（悬空）——不得冒充在编，按空编处理（v2/03 §2.2 注）`,
        ),
      )
    } else if (unit.vacancyState === 'head-vacant' && headRef !== null) {
      headState = 'vacant'
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitHeadStateConflict,
          `unit:${unit.unitId}`,
          `一级单元 ${unit.unitId} 同时声明 headRef=${headRef} 与 vacancyState=head-vacant——空编态与在编态互斥，投影拒绝`,
        ),
      )
    } else if (headRef === null && unit.vacancyState === 'staffed') {
      headState = totalUnits === 1 ? 'default-single' : 'vacant'
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitHeadStateConflict,
          `unit:${unit.unitId}`,
          `一级单元 ${unit.unitId} 声明 vacancyState=staffed 但无 headRef——在编声明缺在位者，不得默认放行`,
        ),
      )
    } else if (headRef === null && unit.vacancyState === 'head-vacant') {
      // 显式空编登记优先于 N=1 单人退化默认（空编是记录事实，须复审期限）
      headState = 'vacant'
    } else if (headRef === null && totalUnits === 1) {
      // N=1 且不单设单元首长：最高宰相直管，退化为单层——默认形态，不是空编（v2/03 §2.2 注）
      headState = 'default-single'
    } else {
      headState = 'vacant'
    }

    if (headState === 'vacant' && reviewAt === null) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.unitHeadVacancyWithoutReview,
          `unit:${unit.unitId}`,
          `一级单元 ${unit.unitId} 空编未登记复审期限（reviewAt 缺失/非 ISO 8601）——空编静默=违规（v2/03 §八；缺位须登记＋复审）`,
        ),
      )
    }

    const projected: ProjectedUnit = {
      unitId: unit.unitId,
      domain,
      headRef,
      headState,
      reviewAt: headState === 'vacant' ? reviewAt : null,
      authority: canonical.authority,
    }
    projectedUnits.push(projected)

    if (headState === 'vacant') {
      derivedVacancies.push({
        kind: 'unit-head',
        ref: unit.unitId,
        reviewAt,
        origin: 'derived',
        authority: canonical.authority,
      })
    }
  }
  projectedUnits.sort((a, b) => compareText(a.unitId, b.unitId))

  let unitsProjection: FirstLevelUnitsProjection
  if (!unitsDeclared) {
    // 默认 N=1（低 CL 默认形态；不单设一级单元首长，最高宰相直管）
    unitsProjection = {
      count: 1,
      source: 'default-single',
      units: [
        {
          unitId: IMPLICIT_UNIT_ID,
          domain: [],
          headRef: null,
          headState: 'default-single',
          reviewAt: null,
          // 隐式默认不是声明，不进入 O3-01 对象表；authority 只作形状占位（不冒充新权威）
          authority: 'legacy-readonly',
        },
      ],
    }
  } else if (totalUnits === 0) {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.emptyUnits,
        '(units)',
        'units 显式声明为空——一级单元 N≥1（默认 1；三省=N=3 仅示例，N 不写死）；空声明不猜成默认 1，投影拒绝',
      ),
    )
    unitsProjection = { count: 0, source: 'declared', units: [] }
  } else {
    unitsProjection = { count: totalUnits, source: 'declared', units: projectedUnits }
  }

  // ───────────────── 2. 空编（登记＋复审期限；缺期限=静默→阻断） ─────────────────
  const vacancyReconciliation = reconcileVacancies(input, issues)
  const canonicalVacancies = vacancyReconciliation.canonical
  const projectedVacancies: ProjectedVacancy[] = []
  const vacancyKeys = new Set<string>()
  for (const canonical of canonicalVacancies) {
    const vacancy = canonical.vacancy
    if (!isVacancyKind(vacancy.kind)) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.vacancyKindUnknown,
          `vacancy:${String(vacancy.kind)}:${vacancy.ref}`,
          `空编对象 kind=${String(vacancy.kind)} 不在封闭三值（${VACANCY_KINDS.join('/')}）——未知空编族拒收，不默认归类`,
        ),
      )
      continue
    }
    const ref = typeof vacancy.ref === 'string' ? vacancy.ref : ''
    if (ref.trim() === '') {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.vacancyWithoutReview,
          'vacancy:(empty)',
          '空编登记缺对象引用 ref——空编对象不明=空编静默，投影拒绝',
        ),
      )
      continue
    }
    const reviewAt = vacancy.reviewAt !== undefined && vacancy.reviewAt !== null && ISO_8601_RE.test(vacancy.reviewAt) ? vacancy.reviewAt : null
    if (reviewAt === null) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.vacancyWithoutReview,
          `vacancy:${vacancy.kind}:${ref}`,
          `空编登记缺复审期限（reviewAt 缺失/非 ISO 8601）——空编须登记＋复审期限，不得静默挂空（v2/03 §2.2 注、§八）`,
        ),
      )
    }
    const key = `${vacancy.kind}\u0000${ref}`
    if (vacancyKeys.has(key)) continue
    vacancyKeys.add(key)
    projectedVacancies.push({ kind: vacancy.kind, ref, reviewAt, origin: 'declared', authority: canonical.authority })
  }
  for (const derived of derivedVacancies) {
    const key = `${derived.kind}\u0000${derived.ref}`
    if (vacancyKeys.has(key)) continue
    vacancyKeys.add(key)
    projectedVacancies.push(derived)
  }
  projectedVacancies.sort((a, b) => compareText(a.kind, b.kind) || compareText(a.ref, b.ref))

  // ───────────────── 3. legacy 部门首长（空编/悬空不静默；definition 无 leader 字段属正常） ─────
  for (const node of tree.tree.nodes) {
    if (node.contract !== 'legacy') continue
    if (node.leaderRef === null) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.legacyLeaderMissing,
          node.path,
          `legacy 部门 ${node.path} 未声明 leader——旧格式契约要求主管必填；空编须登记（含复审期限），不得静默（v2/03 §八）`,
        ),
      )
    } else if (!node.leaderResolved) {
      issues.push(
        projectionIssue(
          'structure',
          ISSUE_CODES.danglingLeader,
          node.path,
          `legacy 部门 ${node.path} 的 leader=${node.leaderRef} 不在 people 索引（悬空）——不得冒充在编，需登记空编或修索引`,
        ),
      )
    }
  }

  // ───────────────── 4. 部门硬核声明（NEG-ORG-05：自改硬核=无效，须具名上位授权） ─────
  validateDeclaredHardCores(tree.tree.nodes, issues)

  // ───────────────── 5. 事实与 CL 判据输入（NEG-ORG-06：claim 不作事实） ─────────────────
  const facts = collectFacts(input, tree, unitsProjection, projectedVacancies)
  const cl = buildClCriteria(input, facts)
  if (cl.claimStatus === 'unverified') {
    issues.push(
      projectionIssue(
        'structure',
        ISSUE_CODES.levelClaimUnverified,
        '(org)',
        `company.level=${cl.levelClaim} 只是主张：CL 判据输入不足（结构面最高可判层=${cl.structuralLevel === null ? 'null' : String(cl.structuralLevel)}），不得据此升/降层（v2/03 §2.4；NEG-ORG-06）`,
        false,
      ),
    )
  }

  // ───────────────── 6. 表 A′ 归属（NEG-ORG-02）与老板可达性（NEG-ORG-08） ─────────────────
  const powerOwnership = buildPowerOwnership(
    input,
    {
      unitIds: new Set(unitsProjection.units.map((unit) => unit.unitId)),
      departmentPaths: new Set(tree.tree.nodes.map((node) => node.path)),
      personIds,
    },
    issues,
  )
  const bossReachability = buildBossReachability(input, issues)

  return {
    structure: {
      units: unitsProjection,
      vacancies: projectedVacancies,
      facts,
      cl,
      reservedPowers: reservedPowerRefs(),
      powerOwnership,
      bossAbsence: bossAbsencePolicy(),
      bossReachability,
    },
    authority: mergeAuthorityFaces(unitReconciliation.authority, vacancyReconciliation.authority),
    issues: sortProjectionIssues(issues),
  }
}

// ───────────────── 事实/CL 判据输入/引用型常量（单元与空编收口见 units.ts） ─────────────────
function collectFacts(
  input: OrganizationProjectionInput,
  tree: OrgTreeBuild,
  units: FirstLevelUnitsProjection,
  vacancies: readonly ProjectedVacancy[],
): StructureFacts {
  const statusById = new Map<string, string | undefined>()
  for (const person of input.org.people ?? []) statusById.set(person.id, person.status)
  for (const person of input.definition?.people ?? []) {
    if (!statusById.has(person.id)) statusById.set(person.id, person.status)
  }
  let active = 0
  for (const status of statusById.values()) {
    if (status === 'active') active += 1
  }

  let leadersDeclared = 0
  let leadersResolved = 0
  for (const node of tree.tree.nodes) {
    if (node.leaderRef === null) continue
    leadersDeclared += 1
    if (node.leaderResolved) leadersResolved += 1
  }

  let withHead = 0
  let vacant = 0
  let defaultSingle = 0
  for (const unit of units.units) {
    if (unit.headState === 'staffed') withHead += 1
    else if (unit.headState === 'vacant') vacant += 1
    else defaultSingle += 1
  }

  return {
    departments: { total: tree.tree.nodes.length, roots: tree.tree.roots.length, maxDepth: tree.tree.maxDepth },
    people: { total: statusById.size, active },
    leaders: { declared: leadersDeclared, resolved: leadersResolved, unresolved: leadersDeclared - leadersResolved },
    units: {
      declared: units.source === 'declared' ? units.count : 0,
      count: units.count,
      withHead,
      vacant,
      defaultSingle,
    },
    // 表 A 的专职审计位在 legacy org-config 无字段级承载（如实登记 0，不猜不填）
    audit: { declaredPositions: 0 },
    vacancies: {
      total: vacancies.length,
      declared: vacancies.filter((v) => v.origin === 'declared').length,
      derived: vacancies.filter((v) => v.origin === 'derived').length,
    },
  }
}

/**
 * CL 判据输入（v2/03 §2.4 逐层累进）。**不是裁决**：legacy 面缺记录/职级证据，satisfied 一律
 * null；structuralLevel=null。claim（company.level）不参与求值（NEG-ORG-06）。
 */
function buildClCriteria(input: OrganizationProjectionInput, facts: StructureFacts): ClCriteriaProjection {
  const hasCharter = typeof input.org.company.charter_ref === 'string' && input.org.company.charter_ref.trim() !== ''
  const hasDeepNesting = facts.departments.maxDepth >= 2
  const criterion = (cl: number, present: readonly string[], missing: readonly string[]): ClCriterionInput => ({
    cl,
    criterionRef: `v2/03 §2.4-CL${cl}`,
    present,
    missing,
    satisfied: null,
  })
  const criteria: readonly ClCriterionInput[] = [
    criterion(2, hasCharter ? ['charter-ref'] : [], [
      ...(hasCharter ? [] : ['charter-ref']),
      'establishment-record',
      'root-delegation-record',
      'supreme-minister-incumbency-or-vacancy',
    ]),
    criterion(3, [], ['formal-appointment-record', 'g-rank(people)']),
    criterion(4, [], ['D8-department-grade', 'G8-department-head-incumbency']),
    criterion(5, [], ['G7-incumbency-in-D8']),
    criterion(6, [], ['second-D8-department', 'G6-incumbency']),
    criterion(7, [], ['D7-sub-department', 'dedicated-audit-position']),
    criterion(8, hasDeepNesting ? ['department-nesting-depth'] : [], [
      'G5-G3-incumbency',
      ...(hasDeepNesting ? [] : ['department-nesting-depth']),
    ]),
    criterion(9, [], ['G2-G8-full-chain', 'three-D8-departments', 'audit-full-cycle']),
  ]

  let structuralLevel: number | null = null
  for (const item of criteria) {
    if (item.satisfied === true) structuralLevel = item.cl
    else break
  }

  return {
    levelClaim: input.org.company.level,
    criteriaRef: 'v2/03 §2.4',
    criteria,
    structuralLevel,
    claimStatus: 'unverified',
    claimUsedAsFact: false,
  }
}

// ───────────────── 引用型常量（不复制矩阵本体） ─────────────────

/** 保留权力引用（只给表 A′ 行号；v2/06 §5.2/§5.3：包内不复制矩阵本体、不另立副本）。 */
function reservedPowerRefs(): ReservedPowerRefsProjection {
  const rowRefs: number[] = []
  for (let row = 1; row <= 12; row++) rowRefs.push(row)
  return { tableRef: 'v2/03 §2.3', rowRefs, rule: 'reference-only-no-copy' }
}

/** 老板缺席策略（v2/03 §2.1-3/§3.5；NEG-ORG-07：悬置禁止、内核冻结·运行延续）。 */
function bossAbsencePolicy(): BossAbsenceProjection {
  return {
    externalBoss: 'outside-tree-root',
    dependentHardCoreRef: 'v2/03 §3.5',
    dependentHardCoreCount: 4,
    whenUnavailable: 'freeze-kernel-run-continues',
    suspension: 'forbidden',
    reviewRequired: true,
    proxyRule: { allowed: 'external-proxy', forbidden: 'supreme-minister' },
  }
}
