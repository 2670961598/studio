/**
 * MIG-05 / IMPL-05-03 · org 结构面投影（N 一级单元／空编／CL 判据输入／保留权力引用／老板缺席）
 *
 * 依据：docs/v2/06 §5.2（CL 只是主张、N≥1 默认 1、三省=N=3 仅示例、包内不复制表 A 本体）、
 *       §5.3（空编=登记＋复审期限；保留权力按表 A′ 逐行显式、不得另立副本）、§5.4（CL2 单人退化）、
 *       docs/v2/03 §2.4（N 不参与 CL 判据）、§3.5（老板缺席：内核冻结·运行延续、无悬置）、
 *       §八（空编静默/N 单元域重叠=判负）、docs/v2/17 NEG-ORG-06/07。
 *
 * 本件覆盖：
 *   - N 参数：默认 1（非写死 3）；N=2/N=3 声明；空声明/重复/域缺失/域重叠 → 阻断
 *   - 空编：单元缺位需复审期限（缺=静默→阻断）；声明空编三族；legacy 部门首长缺失/悬空阻断；
 *     definition 无 leader 属正常（不误伤）
 *   - NEG-ORG-06：同结构只改 level → 事实/判据输入不变、structuralLevel=null、claim 不作事实
 *   - NEG-ORG-07：老板缺席策略=冻结内核·运行延续、悬置禁止、代行者不得为最高宰相
 *   - 保留权力：只引用表 A′ 行号（1..12），不复制归属正文
 */
import { describe, expect, it } from 'vitest'
import { ISSUE_CODES, projectOrganization } from '../../src/projection/index.ts'
import type {
  OrganizationProjectionInput,
  ParsedDepartment,
  ParsedPerson,
  ParsedUnit,
  ParsedVacancy,
  VacancyKind,
} from '../../src/projection/index.ts'

// ───────────────────────── 夹具 ─────────────────────────

interface DeptSpec {
  path: string
  leader?: string | null
  parent?: string | null
}

function dept(spec: DeptSpec): ParsedDepartment {
  return {
    name: spec.path.split('/').pop() ?? spec.path,
    path: spec.path,
    leader: spec.leader === undefined ? 'AGENT-1' : spec.leader,
    parent: spec.parent === undefined ? null : spec.parent,
  }
}

const PEOPLE: readonly ParsedPerson[] = [
  { id: 'AGENT-1', name: '工程师甲', level: 2, status: 'active' },
  { id: 'AGENT-2', name: '工程师乙', level: 2, status: 'paused' },
  { id: 'AGENT-3', name: '工程师丙', level: 3 },
]

interface InputOptions {
  level?: number
  departments?: readonly ParsedDepartment[]
  people?: readonly ParsedPerson[]
  units?: readonly ParsedUnit[]
  vacancies?: readonly ParsedVacancy[]
  definitionDepartments?: readonly ParsedDepartment[]
  definitionUnits?: readonly ParsedUnit[]
  definitionVacancies?: readonly ParsedVacancy[]
}

function makeInput(options: InputOptions): OrganizationProjectionInput {
  const definition =
    options.definitionDepartments !== undefined ||
    options.definitionUnits !== undefined ||
    options.definitionVacancies !== undefined
      ? {
          ...(options.definitionDepartments !== undefined ? { departments: options.definitionDepartments } : {}),
          ...(options.definitionUnits !== undefined ? { units: options.definitionUnits } : {}),
          ...(options.definitionVacancies !== undefined ? { vacancies: options.definitionVacancies } : {}),
        }
      : undefined
  return {
    org: {
      company: { name: '示例公司', slug: 'demo-corp', level: options.level ?? 3, charter_ref: 'charter.md' },
      ...(options.departments !== undefined ? { departments: options.departments } : {}),
      ...(options.people !== undefined ? { people: options.people } : {}),
      ...(options.units !== undefined ? { units: options.units } : {}),
      ...(options.vacancies !== undefined ? { vacancies: options.vacancies } : {}),
    },
    ...(definition !== undefined ? { definition } : {}),
  }
}

function baseInput(extra: Partial<InputOptions> = {}): OrganizationProjectionInput {
  return makeInput({
    departments: [
      dept({ path: 'departments/工程部', leader: 'AGENT-1' }),
      dept({ path: 'departments/工程部/departments/平台组', leader: 'AGENT-2', parent: 'departments/工程部' }),
    ],
    people: PEOPLE,
    ...extra,
  })
}

function codesOf(input: OrganizationProjectionInput): readonly string[] {
  return projectOrganization(input).issues.map((issue) => issue.code)
}

function unit(unitId: string, domain: readonly string[], extra: Partial<ParsedUnit> = {}): ParsedUnit {
  return { unitId, domain, ...extra }
}

// ───────────────────────── 一、一级单元 N（不写死 3） ─────────────────────────

describe('一级单元 N（GAP-V2-17 投影载形；默认 1；三省=N=3 仅示例）', () => {
  it('未声明 units → N=1 隐式单元（default-single，不是空编、不提复审）', () => {
    const result = projectOrganization(baseInput())
    expect(result.status).toBe('ok')
    expect(result.structure.units.source).toBe('default-single')
    expect(result.structure.units.count).toBe(1)
    expect(result.structure.units.units).toHaveLength(1)
    expect(result.structure.units.units[0]?.headState).toBe('default-single')
    expect(result.structure.units.units[0]?.unitId).toBe('(whole-company)')
    expect(result.structure.vacancies.filter((vacancy) => vacancy.kind === 'unit-head')).toEqual([])
    expect(result.structure.facts.units).toMatchObject({ count: 1, defaultSingle: 1, vacant: 0 })
  })

  it('N=2 声明 → count=2（明确不是写死的 3），域/首长/权威随声明', () => {
    const result = projectOrganization(
      baseInput({
        units: [
          unit('unit-b', ['域B'], { headRef: 'AGENT-2' }),
          unit('unit-a', ['域A'], { headRef: 'AGENT-1' }),
        ],
      }),
    )
    expect(result.status).toBe('ok')
    expect(result.structure.units.source).toBe('declared')
    expect(result.structure.units.count).toBe(2)
    expect(result.structure.units.count).not.toBe(3)
    expect(result.structure.units.units.map((item) => item.unitId)).toEqual(['unit-a', 'unit-b'])
    expect(result.structure.units.units.map((item) => item.headState)).toEqual(['staffed', 'staffed'])
    expect(result.structure.units.units[0]?.authority).toBe('legacy-readonly')
  })

  it('N=3（三省示例）可表达但不被写死：再改 N=5 仍是声明值', () => {
    const heads: readonly ParsedPerson[] = [{ id: 'AGENT-1' }, { id: 'AGENT-2' }, { id: 'AGENT-3' }]
    const three = projectOrganization(
      baseInput({
        units: [
          unit('u1', ['立法'], { headRef: 'AGENT-1' }),
          unit('u2', ['行政'], { headRef: 'AGENT-2' }),
          unit('u3', ['司法'], { headRef: 'AGENT-3' }),
        ],
        people: heads,
      }),
    )
    expect(three.status).toBe('ok')
    expect(three.structure.units.count).toBe(3)
    expect(three.structure.units.units.every((item) => item.headState === 'staffed')).toBe(true)

    const five = projectOrganization(
      baseInput({
        units: [
          unit('u1', ['a'], { headRef: 'AGENT-1' }),
          unit('u2', ['b'], { headRef: 'AGENT-2' }),
          unit('u3', ['c'], { headRef: 'AGENT-3' }),
          unit('u4', ['d'], { headRef: null, vacancyState: 'head-vacant', reviewAt: '2026-12-31' }),
          unit('u5', ['e'], { headRef: null, vacancyState: 'head-vacant', reviewAt: '2026-12-31' }),
        ],
        people: heads,
      }),
    )
    expect(five.status).toBe('ok')
    expect(five.structure.units.count).toBe(5)
    expect(five.structure.vacancies.filter((vacancy) => vacancy.kind === 'unit-head')).toHaveLength(2)
  })

  it('units: [] 显式空声明 → 阻断 empty-units，不猜成默认 1', () => {
    const result = projectOrganization(baseInput({ units: [] }))
    expect(result.status).toBe('blocked')
    expect(result.structure.units.count).toBe(0)
    expect(result.structure.units.source).toBe('declared')
    expect(codesOf(baseInput({ units: [] }))).toContain(ISSUE_CODES.emptyUnits)
  })

  it('同一来源重复 unitId → 阻断（对象身份不唯一）', () => {
    const result = projectOrganization(baseInput({ units: [unit('u1', ['a']), unit('u1', ['b'])] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.duplicateDeclaration)
  })

  it('N 单元域重叠 → 阻断（03 §八 结构违规判负）', () => {
    const result = projectOrganization(baseInput({ units: [unit('u1', ['公共域']), unit('u2', ['公共域'])] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.unitDomainOverlap)
  })

  it('单元缺域划分 → 阻断（N 单元须表达各单元域）', () => {
    const result = projectOrganization(baseInput({ units: [unit('u1', [])] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.unitDomainMissing)
  })

  it('单元首长悬空（headRef 不在 people）→ 阻断，不冒充在编', () => {
    const result = projectOrganization(baseInput({ units: [unit('u1', ['a'], { headRef: 'GHOST' })] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.unitHeadUnresolved)
    expect(result.structure.units.units[0]?.headState).toBe('vacant')
  })

  it('N=1 声明单元不单设首长 → default-single（单人退化，不是空编）', () => {
    const result = projectOrganization(baseInput({ units: [unit('only', ['全域'], { headRef: null })] }))
    expect(result.status).toBe('ok')
    expect(result.structure.units.units[0]?.headState).toBe('default-single')
    expect(result.structure.vacancies).toEqual([])
  })

  it('N=2 有空编单元：缺复审期限 → 阻断；给期限 → 通过并派生空编条目', () => {
    const missing = projectOrganization(
      baseInput({
        units: [unit('u1', ['a'], { headRef: 'AGENT-1' }), unit('u2', ['b'], { headRef: null })],
      }),
    )
    expect(missing.status).toBe('blocked')
    expect(missing.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.unitHeadVacancyWithoutReview)

    const dated = projectOrganization(
      baseInput({
        units: [
          unit('u1', ['a'], { headRef: 'AGENT-1' }),
          unit('u2', ['b'], { headRef: null, vacancyState: 'head-vacant', reviewAt: '2026-12-31' }),
        ],
      }),
    )
    expect(dated.status).toBe('ok')
    expect(dated.structure.units.units[1]?.headState).toBe('vacant')
    expect(dated.structure.units.units[1]?.reviewAt).toBe('2026-12-31')
    expect(dated.structure.vacancies).toEqual([
      { kind: 'unit-head', ref: 'u2', reviewAt: '2026-12-31', origin: 'derived', authority: 'legacy-readonly' },
    ])
  })

  it('同 unitId 同时出现在 legacy 与 definition → 阻断（O3-01 同则覆盖单元对象）', () => {
    const result = projectOrganization(
      baseInput({
        units: [unit('u1', ['a'], { headRef: 'AGENT-1' })],
        definitionUnits: [unit('u1', ['a'])],
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.authorityConflict)
    expect(result.authority.conflicts).toContain('unit:u1')
    expect(result.structure.units.units).toEqual([])
  })
})

// ───────────────────────── 二、空编（登记＋复审；静默=违规） ─────────────────────────

describe('空编 · 记录事实（登记＋复审期限），不发明、不静默', () => {
  it('声明空编（含复审期限）→ 通过并投影三要素', () => {
    const result = projectOrganization(
      baseInput({ vacancies: [{ kind: 'department-head', ref: 'departments/工程部', reviewAt: '2026-12-31' }] }),
    )
    expect(result.status).toBe('ok')
    expect(result.structure.vacancies).toEqual([
      { kind: 'department-head', ref: 'departments/工程部', reviewAt: '2026-12-31', origin: 'declared', authority: 'legacy-readonly' },
    ])
  })

  it('空编缺复审期限 → 阻断（空编静默=违规，03 §八）', () => {
    const result = projectOrganization(baseInput({ vacancies: [{ kind: 'supreme-minister', ref: 'supreme-minister' }] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.vacancyWithoutReview)
  })

  it('复审期限非 ISO 8601 形状 → 阻断（不把乱码当期限）', () => {
    const result = projectOrganization(
      baseInput({ vacancies: [{ kind: 'unit-head', ref: 'u1', reviewAt: '下个季度' }] }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.vacancyWithoutReview)
  })

  it('未知空编族 kind → 阻断（不默认归类）', () => {
    const stranger = { kind: 'audit-seat' as unknown as VacancyKind, ref: 'x', reviewAt: '2026-12-31' }
    const result = projectOrganization(baseInput({ vacancies: [stranger] }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.vacancyKindUnknown)
  })

  it('同一空编对象两权威（legacy+definition）→ 阻断且无投影条目', () => {
    const result = projectOrganization(
      baseInput({
        vacancies: [{ kind: 'department-head', ref: 'departments/工程部', reviewAt: '2026-12-31' }],
        definitionVacancies: [{ kind: 'department-head', ref: 'departments/工程部', reviewAt: '2026-12-31' }],
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.authorityConflict)
    expect(result.authority.conflicts).toContain('vacancy:department-head:departments/工程部')
    expect(result.structure.vacancies).toEqual([])
  })

  it('legacy 部门未声明 leader → 阻断（旧格式契约；不静默）', () => {
    const input = makeInput({
      departments: [dept({ path: 'departments/工程部', leader: null })],
      people: PEOPLE,
    })
    const result = projectOrganization(input)
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.legacyLeaderMissing)
  })

  it('legacy 部门 leader 悬空（工号不在 people）→ 阻断，不冒充在编', () => {
    const input = makeInput({
      departments: [dept({ path: 'departments/工程部', leader: 'GHOST' })],
      people: PEOPLE,
    })
    const result = projectOrganization(input)
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toContain(ISSUE_CODES.danglingLeader)
  })

  it('definition 部门无 leader 属正常（76 语义 schema 无该字段）——不误伤', () => {
    const input = makeInput({
      departments: [dept({ path: 'departments/工程部', leader: 'AGENT-1' })],
      people: PEOPLE,
      definitionDepartments: [dept({ path: 'departments/定义部', leader: null })],
    })
    const result = projectOrganization(input)
    expect(result.status).toBe('ok')
    expect(result.issues.map((issue) => issue.code)).not.toContain(ISSUE_CODES.legacyLeaderMissing)
  })
})

// ───────────────────────── 三、NEG-ORG-06：虚记层级（CL 判据以结构为准） ─────────────────────────

describe('NEG-ORG-06 · 虚记层级（只改 level 字段无效）', () => {
  const sameStructure = (level: number): OrganizationProjectionInput => baseInput({ level })

  it('同结构 level=2 与 level=9：事实与判据输入完全一致，claim 不作事实', () => {
    const low = projectOrganization(sameStructure(2))
    const high = projectOrganization(sameStructure(9))

    expect(low.status).toBe('ok')
    expect(high.status).toBe('ok')
    expect(low.structure.facts).toEqual(high.structure.facts)
    expect(low.structure.cl.criteria).toEqual(high.structure.cl.criteria)
    expect(low.structure.cl.levelClaim).toBe(2)
    expect(high.structure.cl.levelClaim).toBe(9)
    expect(low.structure.cl.structuralLevel).toBeNull()
    expect(high.structure.cl.structuralLevel).toBeNull()
    expect(low.structure.cl.claimStatus).toBe('unverified')
    expect(high.structure.cl.claimStatus).toBe('unverified')
    expect(low.structure.cl.claimUsedAsFact).toBe(false)
    expect(high.structure.cl.claimUsedAsFact).toBe(false)
    expect(low.tree).toEqual(high.tree)
  })

  it('level 主张只产生非阻断提示（不得据此升/降层，也不得阻断投影）', () => {
    const result = projectOrganization(sameStructure(9))
    const notice = result.issues.find((issue) => issue.code === ISSUE_CODES.levelClaimUnverified)
    expect(notice).toBeDefined()
    expect(notice?.blocking).toBe(false)
    expect(notice?.detail).toContain('company.level=9')
    expect(result.status).toBe('ok')
  })

  it('CL 判据输入 8 层（CL2..CL9）：引用 §2.4、present/missing 分列、satisfied 一律 null（不猜）', () => {
    const result = projectOrganization(sameStructure(3))
    const criteria = result.structure.cl.criteria
    expect(criteria.map((item) => item.cl)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    for (const item of criteria) {
      expect(item.criterionRef).toBe(`v2/03 §2.4-CL${item.cl}`)
      expect(item.satisfied).toBeNull()
      expect(item.missing.length).toBeGreaterThan(0)
    }
    // 只有可判的结构输入才进 present：章程位在场、嵌套深度（本夹具 maxDepth=1）不足 3 层
    expect(criteria[0]?.present).toEqual(['charter-ref'])
    expect(criteria[6]?.present).toEqual([])
    expect(criteria[6]?.missing).toContain('department-nesting-depth')
  })

  it('N（一级单元数）不参与 CL 判据：N=1 与 N=3 的判据输入一致（03 §2.4）', () => {
    const one = projectOrganization(baseInput())
    const three = projectOrganization(
      baseInput({ units: [unit('u1', ['a']), unit('u2', ['b']), unit('u3', ['c'])], people: [{ id: 'AGENT-1' }, { id: 'AGENT-2' }, { id: 'AGENT-3' }] }),
    )
    expect(three.structure.cl.criteria).toEqual(one.structure.cl.criteria)
    expect(three.structure.cl.structuralLevel).toBeNull()
    expect(one.structure.cl.structuralLevel).toBeNull()
  })
})

// ───────────────────────── 四、NEG-ORG-07：老板缺席（冻结内核·运行延续，无悬置） ─────────────────────────

describe('NEG-ORG-07 · 老板缺席/最高宰相缺位处置', () => {
  it('外部老板恒在组织树之外；依赖硬核动作引用 §3.5（四类）', () => {
    const result = projectOrganization(baseInput())
    const policy = result.structure.bossAbsence
    expect(policy.externalBoss).toBe('outside-tree-root')
    expect(policy.dependentHardCoreRef).toBe('v2/03 §3.5')
    expect(policy.dependentHardCoreCount).toBe(4)
  })

  it('不可达且无代行＝内核冻结·运行延续；悬置禁止；冻结须登记复审', () => {
    const policy = projectOrganization(baseInput()).structure.bossAbsence
    expect(policy.whenUnavailable).toBe('freeze-kernel-run-continues')
    expect(policy.suspension).toBe('forbidden')
    expect(policy.reviewRequired).toBe(true)
    // 无主体悬置态不得作为输出状态出现
    expect(JSON.stringify(policy)).not.toContain('"suspended"')
    expect(JSON.stringify(policy)).not.toContain('suspension":"allowed')
  })

  it('代行者不得是最高宰相（它就是内部老板）——外部代行是唯一允许形态', () => {
    const policy = projectOrganization(baseInput()).structure.bossAbsence
    expect(policy.proxyRule).toEqual({ allowed: 'external-proxy', forbidden: 'supreme-minister' })
  })
})

// ───────────────────────── 五、保留权力引用（表 A′ 只引用、不复制） ─────────────────────────

describe('保留权力引用 · 表 A′ 行号引用（不复制矩阵本体/不另立副本）', () => {
  it('只给表引用＋行号 1..12＋reference-only 纪律，无归属正文副本', () => {
    const refs = projectOrganization(baseInput()).structure.reservedPowers
    expect(refs.tableRef).toBe('v2/03 §2.3')
    expect(refs.rowRefs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(refs.rule).toBe('reference-only-no-copy')
    expect(Object.keys(refs)).toHaveLength(3)
    const serialized = JSON.stringify(refs)
    expect(serialized).not.toContain('外部老板')
    expect(serialized).not.toContain('最高宰相')
  })
})

// ───────────────────────── 六、事实面与状态 ─────────────────────────

describe('结构事实 · 计数/解析态可判（CL 判据输入来源）', () => {
  it('部门/人数/首长解析/单元/空编计数与输入一致', () => {
    const result = projectOrganization(
      baseInput({
        units: [
          unit('u1', ['a'], { headRef: 'AGENT-1' }),
          unit('u2', ['b'], { headRef: null, vacancyState: 'head-vacant', reviewAt: '2026-12-31' }),
        ],
        vacancies: [{ kind: 'supreme-minister', ref: 'supreme-minister', reviewAt: '2026-12-31' }],
      }),
    )
    expect(result.status).toBe('ok')
    expect(result.structure.facts.departments).toEqual({ total: 2, roots: 1, maxDepth: 1 })
    expect(result.structure.facts.people).toEqual({ total: 3, active: 1 })
    expect(result.structure.facts.leaders).toEqual({ declared: 2, resolved: 2, unresolved: 0 })
    expect(result.structure.facts.units).toEqual({ declared: 2, count: 2, withHead: 1, vacant: 1, defaultSingle: 0 })
    expect(result.structure.facts.audit).toEqual({ declaredPositions: 0 })
    expect(result.structure.facts.vacancies).toEqual({ total: 2, declared: 1, derived: 1 })
  })

  it('阻断状态由 blocking issue 决定（非阻断提示不拦）；issues 两次调用逐项一致', () => {
    const blocked = projectOrganization(baseInput({ units: [unit('u1', ['a']), unit('u2', ['a'])] }))
    expect(blocked.status).toBe('blocked')
    expect(blocked.issues.some((issue) => issue.blocking)).toBe(true)

    const once = projectOrganization(baseInput())
    const twice = projectOrganization(baseInput())
    expect(once.issues).toEqual(twice.issues)
  })
})
