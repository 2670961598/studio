/**
 * neg-org.test.ts —— NEG-ORG 族覆盖补强（company 纯投影面；MIG-08 补强单）
 *
 * 依据：docs/v2/17 §4.1 NEG-ORG-01（必设岗空编静默：登记空编＋复审期限；二选一必答）；
 *   docs/v2/03 §2.2 注/§八（空编不得静默＝强制失败出口）、§3.5（缺位登记与复审）；
 *   docs/v2/06 §5.3（空编=登记＋复审期限）；docs/v2/11 §3.2（REC-LIFE-08 空编类事件必附复审期限）；
 *   docs/plan/05 IMPL-05-03（投影面）。
 *
 * 口径（只测生产面真实机制，不造假）：
 *   - 本文件只覆盖 **company 纯投影** 能判的 ORG 负向：`projectOrganization()` 对
 *     `structure.vacancies` 的阻断（生产函数真实返回 status='blocked'＋blocking issue）；
 *   - 表 A′ 权力归属/悬空、部门自改硬核在 company/validator 面无输入面/拒绝机制（投影只输出
 *     表 A′ 行号引用，validator 无部门硬核概念）——不写假测试，登记为 target（见回报单）；
 *   - 权源解析＋跳级任免、审计分层的生产机制在 contract 记录判定件（validateAppointment/
 *     validateStructuralEvaluation），不在本文件（另见 contract/test/v2/neg-org.test.ts）。
 *
 * 变异验证（本文件断言对应的生产守卫）：`src/projection/org-structure.ts` 的
 * 「空编登记缺复审期限 → vacancyWithoutReview（blocking）」分支；临时移除后本文件应红，
 * 还原后绿（施工记录见回报单）。
 */
import { describe, expect, it } from 'vitest'
import { ISSUE_CODES, projectOrganization } from '../../src/projection/index.ts'
import type { OrganizationProjectionInput, ParsedDepartment, ParsedPerson, ParsedVacancy } from '../../src/projection/index.ts'

// ───────────────────────── 夹具（最小合法组织：两个部门＋在编首长） ─────────────────────────

const PEOPLE: readonly ParsedPerson[] = [
  { id: 'AGENT-1', name: '部门首长甲', level: 3, status: 'active' },
  { id: 'AGENT-2', name: '部门首长乙', level: 3, status: 'active' },
]

const DEPARTMENTS: readonly ParsedDepartment[] = [
  { name: '工程部', path: 'departments/工程部', leader: 'AGENT-1', parent: null },
  { name: '综合部', path: 'departments/综合部', leader: 'AGENT-2', parent: null },
]

/** 合法基座：无空编声明时投影不阻断（对照面用） */
function makeInput(vacancies: readonly ParsedVacancy[]): OrganizationProjectionInput {
  return {
    org: {
      company: { name: '示例公司', slug: 'demo-corp', level: 3, charter_ref: 'charter.md' },
      departments: DEPARTMENTS,
      people: PEOPLE,
      vacancies,
    },
  }
}

function issueByCode(input: OrganizationProjectionInput, code: string) {
  return projectOrganization(input).issues.find((issue) => issue.code === code)
}

// ───────────────────────── NEG-ORG-01：必设岗空编静默 ─────────────────────────

describe('NEG-ORG-01 · 必设岗空编不得静默（登记空编＋复审期限）', () => {
  it('最高宰相空编未登记复审期限 → 投影阻断（空编静默=违规，03 §八）', () => {
    const result = projectOrganization(makeInput([{ kind: 'supreme-minister', ref: 'supreme-minister' }]))
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.vacancyWithoutReview)
    expect(issue, '空编缺复审期限须产生 vacancyWithoutReview 阻断项').toBeDefined()
    expect(issue?.blocking).toBe(true)
    expect(issue?.ref).toBe('vacancy:supreme-minister:supreme-minister')
    // 不被静默吞掉：声明式空编仍进 structure.vacancies，reviewAt=null 显式暴露缺口
    expect(result.structure.vacancies).toEqual([
      {
        kind: 'supreme-minister',
        ref: 'supreme-minister',
        reviewAt: null,
        origin: 'declared',
        authority: 'legacy-readonly',
      },
    ])
    expect(result.structure.facts.vacancies).toEqual({ total: 1, declared: 1, derived: 0 })
  })

  it('部门首长空编未登记复审期限 → 同样阻断（必设岗空编三族都不得静默）', () => {
    const result = projectOrganization(makeInput([{ kind: 'department-head', ref: 'departments/工程部' }]))
    expect(result.status).toBe('blocked')
    const issue = issueByCode(makeInput([{ kind: 'department-head', ref: 'departments/工程部' }]), ISSUE_CODES.vacancyWithoutReview)
    expect(issue, '部门首长空编缺复审期限须阻断').toBeDefined()
    expect(issue?.ref).toBe('vacancy:department-head:departments/工程部')
    // 部门节点本身结构有效（不是树面问题）：缺口在空编登记，不被误记成悬空 leader
    expect(result.issues.map((entry) => entry.code)).not.toContain(ISSUE_CODES.danglingLeader)
  })

  it('对照面：空编登记＋复审期限 → 投影通过，复审期限随条目投影（登记缺口可见即合法）', () => {
    const result = projectOrganization(
      makeInput([{ kind: 'department-head', ref: 'departments/工程部', reviewAt: '2026-12-31' }]),
    )
    expect(result.status).toBe('ok')
    expect(result.issues.some((issue) => issue.blocking)).toBe(false)
    expect(result.structure.vacancies).toEqual([
      {
        kind: 'department-head',
        ref: 'departments/工程部',
        reviewAt: '2026-12-31',
        origin: 'declared',
        authority: 'legacy-readonly',
      },
    ])
    expect(result.structure.facts.vacancies).toEqual({ total: 1, declared: 1, derived: 0 })
  })

  it('对照面：非 ISO 8601 复审期限视同缺期限（形状闸，不把「下个季度」当期限）', () => {
    const result = projectOrganization(
      makeInput([{ kind: 'supreme-minister', ref: 'supreme-minister', reviewAt: '下个季度' }]),
    )
    expect(result.status).toBe('blocked')
    const issue = result.issues.find((entry) => entry.code === ISSUE_CODES.vacancyWithoutReview)
    expect(issue).toBeDefined()
    expect(result.structure.vacancies[0]?.reviewAt).toBeNull()
  })
})
