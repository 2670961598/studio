/**
 * neg-org2.test.ts —— NEG-ORG-02/05/08 机制补强（company 纯投影面；MIG-05 补强单）
 *
 * 依据：docs/v2/17 §4.1 NEG-ORG-02（表 A′ 权力归属；悬空/塞入可选容器=结构违规判负）、
 *   NEG-ORG-05（部门自改硬核=无效＋判负）、NEG-ORG-08（老板不可达且无代行程序仍推进硬核事项
 *   →停摆待老板＋保全；代行者≠最高宰相）；docs/v2/03 §2.3（表 A′ 唯一主表）、§6.3（部门硬核
 *   由部长上一层批准，部门只能改软外围）、§3.5（内核冻结·运行延续；代行程序目标未证）；
 *   docs/v2/06 §五（投影输入边界；不改 YAML/记录类）。
 *
 * 口径（只测生产面真实机制，不造假）：
 *   - NEG-ORG-02：`projectOrganization()` 对 `org.powerOwners` 的真校验（12 行逐行、空 owner/
 *     可选容器/悬空/缺行/坏行 → status='blocked'＋blocking issue）；`reservedPowers` 引用输出保留；
 *   - NEG-ORG-05：`validateDepartmentHardCoreChange(before, after)` 纯函数（自改→拒；具名上位
 *     授权→允许；未变→不改写）＋投影面对已声明硬核的授权引用校验；
 *   - NEG-ORG-08：`projectOrganization()` 对 `org.bossReachability` 的真校验（不可达无代行仍
 *     推进硬核→blocked；代行者=最高宰相/内部岗位→拒；无在途硬核=冻结·运行延续合法态）。
 *   - 缺省（未声明）保持旧输入兼容：不猜 12 行、不猜可达、不阻断。
 *
 * 变异验证（施工时实做，记录见回报单）：临时移除各面守卫（NEG-ORG-02 缺行判定 / NEG-ORG-05
 * 授权解析 / NEG-ORG-08 无代行硬核阻断）→ 本文件对应用例转红；还原后转绿。
 */
import { describe, expect, it } from 'vitest'
import {
  ISSUE_CODES,
  projectOrganization,
  validateDepartmentHardCoreChange,
} from '../../src/projection/index.ts'
import type {
  BossReachabilityState,
  OrganizationProjectionInput,
  ParsedBossReachability,
  ParsedDepartment,
  ParsedPerson,
  ParsedPowerOwner,
  ParsedUnit,
} from '../../src/projection/index.ts'

// ───────────────────────── 夹具（最小合法组织：两个部门＋在编首长） ─────────────────────────

const PEOPLE: readonly ParsedPerson[] = [
  { id: 'AGENT-1', name: '部门首长甲', level: 3, status: 'active' },
  { id: 'AGENT-2', name: '部门首长乙', level: 3, status: 'active' },
]

const DEPARTMENTS: readonly ParsedDepartment[] = [
  { name: '工程部', path: 'departments/工程部', leader: 'AGENT-1', parent: null },
  { name: '综合部', path: 'departments/综合部', leader: 'AGENT-2', parent: null },
]

interface InputOptions {
  departments?: readonly ParsedDepartment[]
  people?: readonly ParsedPerson[]
  units?: readonly ParsedUnit[]
  powerOwners?: readonly ParsedPowerOwner[]
  bossReachability?: ParsedBossReachability
}

/** 合法基座：未声明任何新输入面时投影为 ok（旧输入兼容面）。 */
function makeInput(options: InputOptions = {}): OrganizationProjectionInput {
  return {
    org: {
      company: { name: '示例公司', slug: 'demo-corp', level: 3, charter_ref: 'charter.md' },
      departments: options.departments ?? DEPARTMENTS,
      people: options.people ?? PEOPLE,
      ...(options.units !== undefined ? { units: options.units } : {}),
      ...(options.powerOwners !== undefined ? { powerOwners: options.powerOwners } : {}),
      ...(options.bossReachability !== undefined ? { bossReachability: options.bossReachability } : {}),
    },
  }
}

function codesOf(input: OrganizationProjectionInput): readonly string[] {
  return projectOrganization(input).issues.map((issue) => issue.code)
}

function dept(path: string, extra: Partial<ParsedDepartment> = {}): ParsedDepartment {
  return { name: path.split('/').pop() ?? path, path, leader: 'AGENT-1', parent: null, ...extra }
}

function unit(unitId: string, domain: readonly string[], extra: Partial<ParsedUnit> = {}): ParsedUnit {
  return { unitId, domain, ...extra }
}

// ───────────────────────── 表 A′ 12 行归属夹具（只给行号＋归属引用，不含表 A′ 正文） ─────────────────────────

const DEFAULT_OWNERS: readonly string[] = [
  'supreme-minister', // 1 制宪与修宪
  'supreme-minister', // 2 公司级审计（内部老板自审）
  'external-boss', // 3 最终责任（恒外部老板）
  'external-boss', // 4 最高宰相任免
  'supreme-minister', // 5 一级单元首长任免
  'supreme-minister', // 6 各级任免
  'external-boss', // 7 对外承诺
  'person:AGENT-1', // 8 部门硬核（上一层保管）
  'supreme-minister', // 9 资源/访问权
  'department:departments/工程部', // 10 软外围
  'supreme-minister', // 11 合并/分立
  'person:AGENT-2', // 12 风险与可逆性分类
]

/** 12 行齐全的归属声明（覆写行用 overrides）。 */
function fullPowerOwners(overrides: Partial<Record<number, string>> = {}): readonly ParsedPowerOwner[] {
  const rows: ParsedPowerOwner[] = []
  for (let row = 1; row <= 12; row++) {
    rows.push({ row, ownerRef: overrides[row] ?? DEFAULT_OWNERS[row - 1] ?? '' })
  }
  return rows
}

// ───────────────────────── NEG-ORG-02：表 A′ 权力归属/悬空 ─────────────────────────

describe('NEG-ORG-02 · 表 A′ 12 行归属（显式/悬空/可选容器）', () => {
  it('NEG-ORG-02 正例：12 行逐行具名归属（含 unit/department/person 解析）→ 投影通过，引信保留', () => {
    const result = projectOrganization(
      makeInput({
        units: [unit('unit-a', ['交付'], { headRef: 'AGENT-1' })],
        powerOwners: fullPowerOwners({ 8: 'unit:unit-a' }),
      }),
    )
    expect(result.status).toBe('ok')
    const ownership = result.structure.powerOwnership
    expect(ownership.tableRef).toBe('v2/03 §2.3')
    expect(ownership.source).toBe('declared')
    expect(ownership.rule).toBe('explicit-per-row-no-optional-container')
    expect(ownership.rows.map((item) => item.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(ownership.rows.every((item) => item.resolved)).toBe(true)
    const byRow = new Map(ownership.rows.map((item) => [item.row, item]))
    expect(byRow.get(3)?.kind).toBe('external-boss')
    expect(byRow.get(8)?.kind).toBe('unit')
    expect(byRow.get(10)?.kind).toBe('department')
    expect(byRow.get(12)?.kind).toBe('person')
    // 既有 reservedPowers 引用输出保留（只给行号；不复制正文）
    expect(result.structure.reservedPowers.rowRefs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(Object.keys(result.structure.reservedPowers)).toHaveLength(3)
  })

  it('NEG-ORG-02 反例：缺行（第 7 行未声明）→ blocked，缺失行可判', () => {
    const result = projectOrganization(
      makeInput({ powerOwners: fullPowerOwners().filter((owner) => owner.row !== 7) }),
    )
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.powerOwnersIncomplete)
    expect(issue).toBeDefined()
    expect(issue?.blocking).toBe(true)
    expect(issue?.detail).toContain('缺失行：7')
    // 已声明行仍如实投影（不静默丢弃），缺失不猜成默认归属
    expect(result.structure.powerOwnership.rows).toHaveLength(11)
    expect(result.structure.powerOwnership.rows.some((item) => item.row === 7)).toBe(false)
  })

  it('NEG-ORG-02 反例：归属悬空（unit/person 解析不到）→ blocked，行标 resolved=false', () => {
    const unitGhost = projectOrganization(
      makeInput({ powerOwners: fullPowerOwners({ 5: 'unit:ghost-unit' }) }),
    )
    expect(unitGhost.status).toBe('blocked')
    const unresolved = unitGhost.issues.find((entry) => entry.code === ISSUE_CODES.powerOwnerUnresolved)
    expect(unresolved?.ref).toBe('power-owner:5')
    expect(unresolved?.detail).toContain('unitId 不在已声明一级单元')
    expect(unitGhost.structure.powerOwnership.rows.find((item) => item.row === 5)?.resolved).toBe(false)

    const personGhost = projectOrganization(
      makeInput({ powerOwners: fullPowerOwners({ 12: 'person:GHOST' }) }),
    )
    expect(personGhost.status).toBe('blocked')
    expect(codesOf(makeInput({ powerOwners: fullPowerOwners({ 12: 'person:GHOST' }) }))).toContain(
      ISSUE_CODES.powerOwnerUnresolved,
    )
  })

  it('NEG-ORG-02 反例：归属塞入可选容器/空 owner → blocked（不得留可选形态）', () => {
    const container = projectOrganization(
      makeInput({
        powerOwners: fullPowerOwners().map((owner) =>
          owner.row === 3
            ? ({ row: 3, ownerRef: { optional: true } } as unknown as ParsedPowerOwner)
            : owner,
        ),
      }),
    )
    expect(container.status).toBe('blocked')
    const containerIssue = container.issues.find((entry) => entry.code === ISSUE_CODES.powerOwnerOptionalContainer)
    expect(containerIssue?.ref).toBe('power-owner:3')
    expect(containerIssue?.detail).toContain('可选容器')

    const emptyOwner = projectOrganization(makeInput({ powerOwners: fullPowerOwners({ 9: '   ' }) }))
    expect(emptyOwner.status).toBe('blocked')
    expect(codesOf(makeInput({ powerOwners: fullPowerOwners({ 9: '   ' }) }))).toContain(
      ISSUE_CODES.powerOwnerOptionalContainer,
    )
    expect(emptyOwner.structure.powerOwnership.rows.some((item) => item.row === 9)).toBe(false)
  })

  it('NEG-ORG-02 反例：行号越界/重复 → blocked（一行一归属）', () => {
    const outOfRange = projectOrganization(
      makeInput({
        powerOwners: [...fullPowerOwners(), { row: 13, ownerRef: 'external-boss' }],
      }),
    )
    expect(outOfRange.status).toBe('blocked')
    expect(codesOf(makeInput({ powerOwners: [...fullPowerOwners(), { row: 13, ownerRef: 'external-boss' }] }))).toContain(
      ISSUE_CODES.powerOwnerRowInvalid,
    )

    const duplicated = projectOrganization(
      makeInput({ powerOwners: [...fullPowerOwners(), { row: 1, ownerRef: 'external-boss' }] }),
    )
    expect(duplicated.status).toBe('blocked')
    expect(duplicated.issues.find((entry) => entry.code === ISSUE_CODES.powerOwnerRowInvalid)?.ref).toBe('power-owner:1')
  })

  it('NEG-ORG-02 缺省：未声明 powerOwners → 不猜 12 行、不阻断（旧输入兼容）', () => {
    const result = projectOrganization(makeInput())
    expect(result.status).toBe('ok')
    expect(result.structure.powerOwnership.source).toBe('undeclared')
    expect(result.structure.powerOwnership.rows).toEqual([])
    expect(result.issues.map((entry) => entry.code)).not.toContain(ISSUE_CODES.powerOwnersIncomplete)
  })
})

// ───────────────────────── NEG-ORG-05：部门自改硬核 ─────────────────────────

describe('NEG-ORG-05 · 部门硬核不可自改（03 §6.3）', () => {
  const beforeDept: ParsedDepartment = {
    name: '工程部',
    path: 'departments/工程部',
    leader: 'AGENT-1',
    parent: null,
    hardCore: ['部门章程', '预算与资源上限'],
    hardCoreRef: 'supreme-minister:REC-AUTH-01',
  }

  it('NEG-ORG-05 正例：硬核内容未变 → allowed（无需新授权，不改写输入）', () => {
    const afterDept: ParsedDepartment = {
      ...beforeDept,
      hardCore: ['预算与资源上限', '部门章程', '部门章程'],
    }
    const beforeSnapshot = JSON.stringify(beforeDept)
    const afterSnapshot = JSON.stringify(afterDept)
    const verdict = validateDepartmentHardCoreChange(beforeDept, afterDept)
    expect(verdict.allowed).toBe(true)
    expect(verdict.verdict).toBe('unchanged')
    expect(verdict.changedFields).toEqual([])
    expect(verdict.basisRef).toBe('v2/03 §6.3')
    // 纯函数：冻结/快照对比（不取时钟、不写输入）
    expect(JSON.stringify(beforeDept)).toBe(beforeSnapshot)
    expect(JSON.stringify(afterDept)).toBe(afterSnapshot)
  })

  it('NEG-ORG-05 反例：部门自行改硬核（无授权引用）→ 拒', () => {
    const before: ParsedDepartment = { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] }
    const after: ParsedDepartment = { name: '工程部', path: 'departments/工程部', hardCore: ['新章程'] }
    const verdict = validateDepartmentHardCoreChange(before, after)
    expect(verdict.allowed).toBe(false)
    expect(verdict.verdict).toBe('missing-authorization')
    expect(verdict.changedFields).toEqual(['hardCore'])
    expect(verdict.authorizationRef).toBeNull()
  })

  it('NEG-ORG-05 反例：自指/未具名/未知授权者 → 拒（授权引用必须具名且来自部门之外）', () => {
    const self = validateDepartmentHardCoreChange(
      { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] },
      {
        name: '工程部',
        path: 'departments/工程部',
        hardCore: ['新章程'],
        hardCoreRef: 'department:departments/工程部',
      },
    )
    expect(self.allowed).toBe(false)
    expect(self.verdict).toBe('self-authorization')

    const unnamed = validateDepartmentHardCoreChange(
      { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] },
      { name: '工程部', path: 'departments/工程部', hardCore: ['新章程'], hardCoreRef: 'supreme-minister' },
    )
    expect(unnamed.allowed).toBe(false)
    expect(unnamed.verdict).toBe('invalid-authorization')

    const unknown = validateDepartmentHardCoreChange(
      { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] },
      { name: '工程部', path: 'departments/工程部', hardCore: ['新章程'], hardCoreRef: 'boss:REC-1' },
    )
    expect(unknown.allowed).toBe(false)
    expect(unknown.verdict).toBe('invalid-authorization')
  })

  it('NEG-ORG-05 正例：具名最高宰相/外部老板授权引用 → 允许（授权者随判可读）', () => {
    const supreme = validateDepartmentHardCoreChange(
      { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] },
      {
        name: '工程部',
        path: 'departments/工程部',
        hardCore: ['新章程'],
        hardCoreRef: 'supreme-minister:REC-AUTH-02',
      },
    )
    expect(supreme.allowed).toBe(true)
    expect(supreme.verdict).toBe('authorized')
    expect(supreme.authorizer).toBe('supreme-minister')
    expect(supreme.authorizationRef).toBe('supreme-minister:REC-AUTH-02')

    const external = validateDepartmentHardCoreChange(
      { name: '工程部', path: 'departments/工程部', hardCore: ['旧章程'] },
      {
        name: '工程部',
        path: 'departments/工程部',
        hardCore: ['新章程'],
        hardCoreRef: 'external-boss:root-delegation#1',
      },
    )
    expect(external.allowed).toBe(true)
    expect(external.authorizer).toBe('external-boss')
  })

  it('NEG-ORG-05 投影反例：部门声明硬核但无授权引用 → blocked（自改硬核=无效）', () => {
    const input = makeInput({ departments: [dept('departments/工程部', { hardCore: ['部门章程'] })] })
    const result = projectOrganization(input)
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.departmentHardCoreUnauthorized)
    expect(issue?.ref).toBe('departments/工程部')
    expect(issue?.blocking).toBe(true)
  })

  it('NEG-ORG-05 投影反例：自指授权引用 → blocked（departmentHardCoreSelfAuthorized）', () => {
    const result = projectOrganization(
      makeInput({
        departments: [
          dept('departments/工程部', {
            hardCore: ['部门章程'],
            hardCoreRef: 'department:departments/工程部',
          }),
        ],
      }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((entry) => entry.code)).toContain(ISSUE_CODES.departmentHardCoreSelfAuthorized)
  })

  it('NEG-ORG-05 投影正例：硬核＋具名上位授权引用 → 通过，节点只读投影两字段', () => {
    const result = projectOrganization(
      makeInput({
        departments: [
          dept('departments/工程部', {
            hardCore: ['部门章程', '预算与资源上限'],
            hardCoreRef: 'supreme-minister:REC-AUTH-03',
          }),
        ],
      }),
    )
    expect(result.status).toBe('ok')
    const node = result.tree.nodes.find((entry) => entry.path === 'departments/工程部')
    expect(node?.hardCore).toEqual(['部门章程', '预算与资源上限'])
    expect(node?.hardCoreRef).toBe('supreme-minister:REC-AUTH-03')
  })

  it('NEG-ORG-05 缺省：部门未声明硬核字段 → 不阻断（旧输入兼容）', () => {
    const result = projectOrganization(makeInput())
    expect(result.status).toBe('ok')
    expect(result.tree.nodes.every((node) => node.hardCore.length === 0 && node.hardCoreRef === null)).toBe(true)
  })
})

// ───────────────────────── NEG-ORG-08：老板缺席处置 ─────────────────────────

describe('NEG-ORG-08 · 老板不可达处置（冻结·运行延续；代行者≠最高宰相）', () => {
  it('NEG-ORG-08 缺省：未声明 bossReachability → 不猜可达、不阻断（旧输入兼容）', () => {
    const result = projectOrganization(makeInput())
    expect(result.status).toBe('ok')
    expect(result.structure.bossReachability.source).toBe('undeclared')
    expect(result.structure.bossReachability.state).toBeNull()
    expect(result.structure.bossReachability.kernelState).toBe('active')
    // 既有老板缺席策略（NEG-ORG-07）保留
    expect(result.structure.bossAbsence.whenUnavailable).toBe('freeze-kernel-run-continues')
  })

  it('NEG-ORG-08 正例：可达 → active，无阻断；硬核在途不拦（老板在场）', () => {
    const result = projectOrganization(
      makeInput({
        bossReachability: { state: 'reachable', hardCorePending: ['最高宰相任免'] },
      }),
    )
    expect(result.status).toBe('ok')
    expect(result.structure.bossReachability.state).toBe('reachable')
    expect(result.structure.bossReachability.kernelState).toBe('active')
    expect(result.structure.bossReachability.reviewRequired).toBe(false)
  })

  it('NEG-ORG-08 正例：不可达且无代行、无在途硬核 → 内核冻结·运行延续（合法态，须复审）', () => {
    const result = projectOrganization(makeInput({ bossReachability: { state: 'unreachable' } }))
    expect(result.status).toBe('ok')
    const reachability = result.structure.bossReachability
    expect(reachability.state).toBe('unreachable')
    expect(reachability.actingValid).toBe(false)
    expect(reachability.kernelState).toBe('frozen-run-continues')
    expect(reachability.reviewRequired).toBe(true)
    expect(reachability.hardCorePending).toEqual([])
    // 不悬置：冻结态不是停摆/悬置（03 §3.5；NEG-ORG-07 语义保留）
    expect(result.structure.bossAbsence.suspension).toBe('forbidden')
    expect(result.structure.bossAbsence.whenUnavailable).toBe('freeze-kernel-run-continues')
  })

  it('NEG-ORG-08 反例：不可达且无代行仍推进硬核事项 → blocked（停摆待老板＋保全）', () => {
    const input = makeInput({
      bossReachability: { state: 'unreachable', hardCorePending: ['最高宰相任免', 'root 密钥轮换'] },
    })
    const result = projectOrganization(input)
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.bossHardCoreWithoutProxy)
    expect(issue?.blocking).toBe(true)
    expect(issue?.detail).toContain('停摆待老板')
    expect(result.structure.bossReachability.kernelState).toBe('frozen-run-continues')
  })

  it('NEG-ORG-08 反例：代行者＝最高宰相 → blocked（它就是内部老板，不得代行）', () => {
    const input = makeInput({ bossReachability: { state: 'unreachable', actingRef: 'supreme-minister' } })
    const result = projectOrganization(input)
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.bossProxyForbidden)
    expect(issue?.blocking).toBe(true)
    expect(result.structure.bossReachability.actingValid).toBe(false)
  })

  it('NEG-ORG-08 反例：内部岗位/裸工号冒充代行 → blocked（非具名外部代行）', () => {
    const result = projectOrganization(
      makeInput({ bossReachability: { state: 'unreachable', actingRef: 'AGENT-1' } }),
    )
    expect(result.status).toBe('blocked')
    expect(result.issues.map((entry) => entry.code)).toContain(ISSUE_CODES.bossProxyInvalid)
    expect(result.structure.bossReachability.actingValid).toBe(false)
  })

  it('NEG-ORG-08 正例：不可达＋具名外部代行＋在途硬核 → 通过（代行承接，内核不冻结）', () => {
    const result = projectOrganization(
      makeInput({
        bossReachability: {
          state: 'unreachable',
          actingRef: 'external-proxy:deed-001',
          hardCorePending: ['外部独立审计'],
        },
      }),
    )
    expect(result.status).toBe('ok')
    const reachability = result.structure.bossReachability
    expect(reachability.actingValid).toBe(true)
    expect(reachability.kernelState).toBe('active')
    expect(reachability.reviewRequired).toBe(true)
  })

  it('NEG-ORG-08 反例：可达态非闭式值 → blocked（未知态不得默认放行）', () => {
    const stranger = { state: 'offline' as unknown as BossReachabilityState }
    const result = projectOrganization(makeInput({ bossReachability: stranger }))
    expect(result.status).toBe('blocked')
    expect(result.issues.map((entry) => entry.code)).toContain(ISSUE_CODES.bossReachabilityShape)
  })
})
