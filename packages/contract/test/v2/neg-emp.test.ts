/**
 * neg-emp.test.ts —— NEG-EMP 族覆盖补强（contract 记录判定面；MIG-08 补强单）
 *
 * 依据：docs/v2/17 §4.1 NEG-EMP-01（任命生效闸：责任承接五判据不满足→任命无效）、
 *   NEG-EMP-05（记忆处置边界：不可清除字段删除被拒）、NEG-EMP-10（进化边界：受益方自批无效）、
 *   NEG-EMP-11（三面分离：职级/任命记录冒充资格认定→出工拒绝）、
 *   NEG-EMP-12（记忆≠证据：证据类型校验拒收）、NEG-EMP-13（独立性供给：自证拒收；结构性不可得
 *   只能不承认/附条件承认＋局限记录）；docs/v2/02 §二/§八/§十、§4.1；docs/v2/11 §3.1/§九/§十三；
 *   docs/v2/08 §一/§2.2；docs/v2/03 §八。
 *
 * 口径（只测生产面真实机制，不造假）：
 *   - 每个 case 都调用**生产判定件**（validateAppointment/validateMemoryDisposal/
 *     validateCapabilityActivation/validatePlanLock/validateMemoryEntry/validateQualificationDecision），
 *     断言真实的拒绝路径；不写「类型存在」类空断言，不用注释/字符串列表充数；
 *   - 仍 target（本文件不写假测试）：EMP 族 02/04/06/07/08/09 六行（禁配累计合并无判据；验收口径
 *     降档变更闸未建；绩效结论改任命/职级无判据；临时任职者无交接离场即结清无判据；集体任职匿名
 *     挡箭牌无判据；外部主体保留权越权无判据）；11 的「资格认定缺位→engine 出工拒绝」腿在
 *     apps/daemon（本单写面外），本文件只落 contract 判定面可证的两面分离腿；
 *   - NEG-EMP-13 的「不承认/附条件承认」正例（局限记录＋缩短复审＋范围收窄）在本文件作对照面。
 *
 * 变异验证（本文件断言对应的生产守卫，逐条临时移除→红，还原→绿）：
 *   - life.ts validateAppointment 的「生效前五条件齐备」规则（EMP-01）；
 *   - mem.ts validateMemoryDisposal 的 `clearsProtectedRecords` 规则（EMP-05）；
 *   - cap.ts validateCapabilityActivation 的 `beneficiaryApprover` 规则（EMP-10）；
 *   - work-intent.ts validatePlanLock 的 qualification_refs→REC-CAP-02 闸（EMP-11）；
 *   - mem.ts validateMemoryEntry 的 `usedAsEvidenceStandalone` 规则（EMP-12）；
 *   - cap.ts validateQualificationDecision 的 `structurally_unavailable` 规则（EMP-13）。
 */
import { describe, expect, it } from 'vitest'
import { validateAppointment } from '../../src/records/life.ts'
import type { AppointmentContext } from '../../src/records/life.ts'
import {
  validateCapabilityActivation,
  validateQualificationDecision,
} from '../../src/records/cap.ts'
import { validateMemoryDisposal, validateMemoryEntry } from '../../src/records/mem.ts'
import { validatePlanLock } from '../../src/records/work-intent.ts'
import { AT, appointmentPayload, decisionFace, envelope, issuePaths, oref, ref } from './records/fixtures.ts'
import { planLockPayload } from './records/fixtures-work.ts'

const PROOF = { proofBoundary: '证明边界：本记录证明所述判断，不证明未列范围' }

// ───────────────────────── NEG-EMP-01：任命生效闸（五判据） ─────────────────────────

const G9_EXTERNAL: AppointmentContext = {
  positionGrade: 'G9',
  appointingAuthorityClass: 'external_owner',
  nominatorClass: 'external_owner',
}

function appointmentGates(satisfied: {
  authority: boolean
  qualification: boolean
  conflict: boolean
  handover: boolean
  acceptance: boolean
}): Record<string, unknown> {
  return {
    authority: { satisfied: satisfied.authority },
    qualification: { satisfied: satisfied.qualification },
    conflict: { satisfied: satisfied.conflict },
    handover: { satisfied: satisfied.handover },
    acceptance: { satisfied: satisfied.acceptance },
  }
}

describe('NEG-EMP-01 · 任命生效闸（责任承接五判据不满足→任命无效）', () => {
  it('权源判据不满足（把「已取得授权」当责任承接完成）→ 生效任命被拒', () => {
    const payload = appointmentPayload({
      entry_gate_results: appointmentGates({
        authority: false,
        qualification: true,
        conflict: true,
        handover: true,
        acceptance: true,
      }),
    })
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), G9_EXTERNAL)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.entry_gate_results')
    const message = outcome.ok ? '' : outcome.issues.map((issue) => issue.message).join('|')
    expect(message).toContain('authority')
  })

  it('决定≠接受：五判据齐备但缺任职者明示接受 → 生效任命被拒', () => {
    const payload = appointmentPayload({ acceptance_time: undefined })
    const outcome = validateAppointment(envelope('REC-LIFE-01', payload), G9_EXTERNAL)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.acceptance_time')
  })

  it('对照面：五判据齐备＋接受已落 → 任命生效放行', () => {
    expect(validateAppointment(envelope('REC-LIFE-01', appointmentPayload()), G9_EXTERNAL)).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-05：记忆处置边界（不可清除字段不得借清除消灭） ─────────────────────────

function disposalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'erase',
    target_entries: [ref('REC-MEM-01', 'mem-1')],
    authorizations: [{ layer: '个人记忆', authorized_by: 'g9.internal-boss' }],
    reason_and_impact: {
      reason: '离岗清理个人记忆副本',
      impact_scope: '仅个人域三条，责任/承诺/证据记录不在清除范围',
      irrecoverable_notice: '已告知不可恢复，外部副本可能仍存在',
    },
    retained_obligations: ['责任记录、承诺、证据与审计线索按保留义务保留'],
    disposal_evidence: {
      route: 'erase',
      retention_check: '保留义务核对：责任记录与证据保留，审计线索留痕',
      trail_ref: ref('REC-MEM-02', 'trail-1'),
    },
    notice: {
      notified: [oref('holder-h1')],
      residue_statement: '原始来源与外部副本可能仍存在，清除不消灭历史',
    },
    ...overrides,
  }
}

describe('NEG-EMP-05 · 记忆处置边界（不可清除字段删除被拒）', () => {
  it('借记忆清除消灭责任/承诺/证据/历史 → 拒（处置授权不覆盖不可清除字段）', () => {
    const outcome = validateMemoryDisposal(envelope('REC-MEM-03', disposalPayload()), {
      clearsProtectedRecords: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.operation')
  })

  it('恢复出厂式删除（停索引/丢弃向量库）当作合法结清 → 拒', () => {
    const outcome = validateMemoryDisposal(envelope('REC-MEM-03', disposalPayload()), { factoryReset: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.disposal_evidence')
  })

  it('对照面：只清个人记忆副本、保留义务与留痕齐备 → 放行（清除有边界不是禁止处置）', () => {
    expect(validateMemoryDisposal(envelope('REC-MEM-03', disposalPayload()))).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-10：进化边界（受益方自批/自定扩权无效） ─────────────────────────

function capDiff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { added: [], removed: [], basis_ref: oref('diff-basis-1'), ...overrides }
}

function capActivationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain_ref: ref('REC-CHG-01'),
    capability_set: [{ capability_ref: ref('REC-CAP-01'), version: '1.0.0' }],
    permission_diff: capDiff(),
    secret_class_diff: capDiff({ basis_ref: oref('diff-basis-2') }),
    supply_confirmation_ref: ref('REC-CAP-RECEIPT'),
    in_flight_pinning: [ref('REC-WORK-05')],
    approval_basis: ['独立验证通过且有供给确认'],
    rollback_path: '回退旧版本并在途钉旧版',
    dissent_position: '无异议',
    decision_face: decisionFace(),
    proof_boundary: '证明激活批准边界与双差分；不证明运行时已生效',
    ...overrides,
  }
}

describe('NEG-EMP-10 · 进化边界（以「进化」名义自定资格/扩权→无独立程序即无效）', () => {
  it('被进化对象/直接受益方单方作出激活批准 → 拒（自定进化程序无效）', () => {
    const outcome = validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', capActivationPayload(), PROOF), {
      beneficiaryApprover: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.decision_face.decided_by')
  })

  it('「验证已通过」倒推为激活批准（三门合并）→ 拒（无独立验证段不生效）', () => {
    const outcome = validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', capActivationPayload(), PROOF), {
      inferredFromVerification: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('对照面：双差分单列＋供给确认＋在途钉旧版＋非受益方作出 → 放行', () => {
    expect(validateCapabilityActivation(envelope('REC-CAP-ACTIVATE', capActivationPayload(), PROOF))).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-11：三面分离（职级≠资格，跳过认定即出工拒绝） ─────────────────────────

describe('NEG-EMP-11 · 三面分离（职级/任命记录冒充资格认定→计划锁拒）', () => {
  it('计划锁的资格引用指向任命/职级记录（非 REC-CAP-02）→ 拒（不得跳过资格认定）', () => {
    const payload = planLockPayload({
      qualification_refs: [ref('REC-LIFE-01', 'appointment-g9')],
    })
    const outcome = validatePlanLock(envelope('REC-WORK-05', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.qualification_refs')
  })

  it('能力描述引用指向资格认定（REC-CAP-02）而非能力声明（REC-CAP-01）→ 拒（三面各自可解析）', () => {
    const payload = planLockPayload({
      capability_descriptors: [{ capability_ref: ref('REC-CAP-02', 'qualification-1'), digest: 'sha256:cap-1' }],
    })
    const outcome = validatePlanLock(envelope('REC-WORK-05', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.capability_descriptors')
  })

  it('对照面：资格引 REC-CAP-02、能力描述引 REC-CAP-01＋版本摘要 → 计划锁放行', () => {
    expect(validatePlanLock(envelope('REC-WORK-05', planLockPayload()))).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-12：记忆≠证据（记忆不得替证据） ─────────────────────────

function memoryEntryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: 'personal',
    personal_subtype: 'fact',
    owner_scope: 'holder-h1 的个人记忆',
    source_refs: [ref('REC-WORK-08', 'completion-1')],
    observation_vs_interpretation: {
      observation: '观测：该接口在本地探测返回 200',
      interpretation: '解释：接口可用（解释不构成证明）',
    },
    formed_at: AT,
    valid_at: AT,
    review_at: AT,
    confidence: 'medium',
    knowledge_scope: '仅本工作段可见',
    correction_lineage: [],
    disputed: false,
    ...overrides,
  }
}

describe('NEG-EMP-12 · 记忆≠证据（把记忆当证据/经验当因果证明）', () => {
  it('以记忆条目单独充当证据（usedAsEvidenceStandalone）→ 证据类型校验拒收', () => {
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()), {
      usedAsEvidenceStandalone: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
    const message = outcome.ok ? '' : outcome.issues.map((issue) => issue.message).join('|')
    expect(message).toContain('不能替代')
  })

  it('与可核验记录冲突却未标 disputed（以记忆改写记录）→ 拒（以记录为准）', () => {
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()), {
      conflictsWithRecordUnmarked: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.disputed')
  })

  it('对照面：记忆可指向证据（source_refs 引完成记录）且标不确定 → 放行（指向≠替代）', () => {
    expect(validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()))).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-13：独立性供给（自证拒收/结构性不可得） ─────────────────────────

function qualificationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: ref('REC-CAP-01'),
    scope: 'W-07 任务内的只读检索',
    conclusion: 'recognized',
    conditions: [],
    term: { expires_at: AT, renewal_rule: '过期即失效，不默认延续' },
    evidence_refs: [ref('REC-CAP-RECEIPT')],
    decided_by: 'audit-1',
    independence: {
      verified_by: 'audit-1',
      control_basis_ref: ref('REC-LIFE-05'),
      structurally_unavailable: false,
    },
    review_and_invalidation: {
      review_point: AT,
      invalidation_rule: '运行时偏离即失效',
      dispute_entry: '资格争议入口',
    },
    ...overrides,
  }
}

describe('NEG-EMP-13 · 独立性供给（独立认定者结构性不可得仍宣称独立验证）', () => {
  it('独立性自填（self_declared）→ 自证拒收（不得自填独立）', () => {
    const payload = qualificationPayload({
      independence: {
        verified_by: 'cap-owner',
        control_basis_ref: ref('REC-LIFE-05'),
        structurally_unavailable: false,
        self_declared: true,
      },
    })
    const outcome = validateQualificationDecision(envelope('REC-CAP-02', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.independence')
  })

  it('独立认定者结构性不可得却仍给「承认」→ 拒（只能不承认或附条件承认＋局限记录）', () => {
    const payload = qualificationPayload({
      independence: {
        verified_by: 'audit-1',
        control_basis_ref: ref('REC-LIFE-05'),
        structurally_unavailable: true,
      },
    })
    const outcome = validateQualificationDecision(envelope('REC-CAP-02', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.independence')
  })

  it('对照面：结构性不可得→附条件承认＋局限记录＋缩短复审＋范围收窄 → 放行（诚实供给失败）', () => {
    const payload = qualificationPayload({
      conclusion: 'conditional_recognition',
      conditions: ['仅限只读检索；30 日内复审'],
      independence: {
        verified_by: 'audit-1',
        control_basis_ref: ref('REC-LIFE-05'),
        structurally_unavailable: true,
        limitation_note: '独立认定者结构性不可得：以控制关系依据＋缩短复审＋范围收窄附条件承认',
        shortened_review: true,
        narrowed_scope: true,
      },
    })
    expect(validateQualificationDecision(envelope('REC-CAP-02', payload))).toEqual({ ok: true })
  })
})
