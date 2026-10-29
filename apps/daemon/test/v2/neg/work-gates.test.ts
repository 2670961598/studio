/**
 * neg/work-gates —— NEG 覆盖补强（WRK 族门面负例；V1＋V3 混合腿）
 *
 * 依据（实现单必须引章节号——AGENTS §五.1）：
 *   - docs/v2/17 §4.1 逐行：NEG-WRK-01（口径事前性）、NEG-WRK-03（验收独立性）、
 *     NEG-WRK-04（未分类高档侧）、NEG-WRK-07（维持验收四件）、NEG-WRK-08（学习分层/变更链）、
 *     NEG-WRK-09（履约派生）、NEG-WRK-10（不利信息）、NEG-WRK-11（承诺变更程序）、
 *     NEG-WRK-12（结清完整面）、NEG-WRK-13（降档逃证）；
 *   - docs/v2/04 §§三/五/六/七/九/十一（口径事前/完成判据/验收与维持/结清/学习分层）；
 *   - docs/v2/11 §5.1/§5.2/§5.3 各族字段与不变量（REC-WORK-07/08/09/12/16/17＋COMMIT-CHANGE）、
 *     §5.2 五门（REC-WORK-04）；docs/v2/08 §1.4/§1.5（四要件与三判不合并）；
 *   - docs/v2/17 §一 V1（形状/记录判定真跑）与 V3（fake 只替代外部端口；判定本体真跑）。
 *
 * 断言纪律（禁注释/文档充数、禁只断言类型存在）：
 *   每条用例都**调用生产函数**并断言其给出的**拒绝结论**（`ok:false`＋具名 issue 路径/文案）；
 *   跟随一条正例对照，证明判负不是「形状永远红」。载荷构造只写「合法最少基座 + 单点负形态」，
 *   不复制生产判定。
 *
 * 如实登记（残腿不冒充已闭）：
 *   - NEG-WRK-01：本文件证「口径缺位即不得开工（开工门是唯一合法化门）＋口径变动须新决定
 *     （fail-closed 重判）」。**「口径定义时点晚于开工」无独立判据**（REC-WORK-03/09 只约束
 *     口径在场与版本非空，无 produced_at 时序比较）——该残腿仍 target。
 *   - NEG-WRK-10：本文件证「报告超时/完整性存疑类异常须具名接收＋不得无终局当结案」。
 *     **「只报有利证据」的自动识别无判据**（REC-WORK-17 `concealment_finding` 仅形状槽）——
 *     该残腿仍 target。
 */
import { describe, expect, it } from 'vitest'
import { requiresWorkRejudgment } from '@studio-next/core'
import { judgeStartGates } from '../../../src/engine/work/intake.ts'
import type { RecordValidationOutcome } from '../../../../../packages/contract/src/records/envelope.ts'
import {
  validateCommitmentChange,
  validateCompletionRecord,
  validateEffectLevel,
  validateExceptionRecord,
  validateFulfillmentMapping,
  validateMaintenanceAcceptance,
  validateWorkAcceptance,
  validateWorkSettlement,
} from '../../../../../packages/contract/src/records/work.ts'
import { validateChangeSegment } from '../../../../../packages/contract/src/records/chg.ts'

// ————————————————————————— 基座（合法最少信封/载荷） —————————————————————————

const AT = '2026-10-28T00:00:00Z'
const PROOF = '只证明本条记录的判定面；不证明验收合格、结清与价值'
const ISSUE = { path: '', message: '' } as const

type Issue = { readonly path: string; readonly message: string }
type Ref = { refType: string; refId: string; refVersion: string }
type ORef = { refId: string; refVersion: string }

function ref(refType: string, refId = 'rec-1', refVersion = '1.0.0'): Ref {
  return { refType, refId, refVersion }
}

function oref(refId = 'object-1'): ORef {
  return { refId, refVersion: '1.0.0' }
}

/** 决定面（§0.3-1 六件；生效槽与信封同值——§0.5） */
function decisionFace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decided_by: 'g9.internal-boss',
    authority_ref: ref('REC-AUTH-01'),
    rationale: '依 v2/04 逐条核验（判据见 basis_refs）',
    basis_refs: [ref('REC-WORK-01')],
    scope_judged: { judged: ['效果级', '验收口径'], not_judged: ['价值'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    ...overrides,
  }
}

/** 记录信封（§〇：生效槽＋具名 producer） */
function envelope(recordType: string, payload: Record<string, unknown>, withProof = true): Record<string, unknown> {
  return {
    recordId: 'rec-neg-0001',
    recordType,
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'company-a',
    producedAt: AT,
    producer: { decidedBy: 'g9.internal-boss', writtenBy: 'daemon:records' },
    basisRefs: [oref('basis-1')],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: AT },
    ...(withProof ? { proofBoundary: PROOF } : {}),
  }
}

/** 断言「判负」并取出 issues（拒绝路径必须真的存在） */
function reject(outcome: RecordValidationOutcome): readonly Issue[] {
  expect(outcome.ok).toBe(false)
  return outcome.ok ? [ISSUE] : outcome.issues
}

/** issue 命中（路径＋文案片段；文案是生产判定原文，不改写） */
function hit(issues: readonly Issue[], path: string, fragment: string): boolean {
  return issues.some((issue) => issue.path === path && issue.message.includes(fragment))
}

// ————————————————————————— NEG-WRK-01 口径事前性 —————————————————————————

/** 开工五门基线（其余四门齐备，只让 acceptance 门口径面成为唯一变量） */
function readiness(criteria: readonly string[], withAcceptanceGate = true): Parameters<typeof judgeStartGates>[0]['gates'] {
  return {
    authority: { state: 'permitted', evidenceRef: 'REC-AUTH-01@1.0.0' },
    capability: { qualificationRef: 'REC-CAP-02@1.0.0', evaluatedAtMs: Date.parse(AT), validUntilMs: Date.parse('2027-01-01T00:00:00Z') },
    prohibition: { state: 'clear', evidenceRef: 'PRO-1@1.0.0' },
    resource: { state: 'sufficient', evidenceRef: 'BUD-1@1.0.0', nextReviewAtMs: Date.parse(AT) },
    ...(withAcceptanceGate ? { acceptance: { intake: 'accepted' as const, acceptanceCriteria: criteria, verificationPositionRef: 'g9.verify' } } : {}),
  }
}

describe('NEG-WRK-01 口径事前性：开工判断之前口径缺位即不得开工，口径变动只能走新决定', () => {
  it('验收口径为空/验收门缺位 → 开工判断拒（not_ready）；口径存在才 ready；口径变动须重判（fail-closed）', () => {
    // ① 口径未在开工判断前就位：acceptance 门 fail（「口径为空不得开工」）
    const noCriteria = judgeStartGates({ workRef: 'REC-WORK-01@1.0.0', gates: readiness([]) })
    expect(noCriteria.verdict).toBe('not_ready')
    const acceptance = noCriteria.gates.find((gate) => gate.gate === 'acceptance')
    expect(acceptance?.verdict).toBe('fail')
    expect(acceptance?.reason).toBe('acceptance-criteria-empty')
    // ② 整门缺位≠通过：缺门清单点名，结论同样是 not_ready
    const noGate = judgeStartGates({ workRef: 'REC-WORK-01@1.0.0', gates: readiness(['口径'], false) })
    expect(noGate.verdict).toBe('not_ready')
    expect(noGate.missingGates).toContain('acceptance')
    // ③ 口径就位（事前）→ ready：判负来自口径缺位本身，不是形状永远红
    const ready = judgeStartGates({ workRef: 'REC-WORK-01@1.0.0', gates: readiness(['判什么/怎么判/谁判/何时判']) })
    expect(ready.verdict).toBe('ready')
    // ④ 事后改口径不是追认：任何口径变动（含未登记类别）都须重判，不得沿用旧开工结论
    expect(requiresWorkRejudgment('criteria_change')).toBe(true)
    expect(requiresWorkRejudgment('未登记的变化类别')).toBe(true)
    expect(requiresWorkRejudgment('none')).toBe(false)
  })
})

// ————————————————————————— NEG-WRK-03 验收独立性 —————————————————————————

const ACCEPTANCE_BASE: Record<string, unknown> = {
  work_ref: ref('REC-WORK-01'),
  criteria_revision: '1.0.0',
  verdict: 'accepted',
  reworkable: true,
  scope_judged: { judged: ['验收口径逐项'], not_judged: ['价值'] },
  judged_by: 'AGENT-1',
  independence_verified_by: { verified_by: 'g9.audit', control_basis_ref: ref('REC-LIFE-05') },
  evidence_refs: [ref('REC-EVD-03'), ref('REC-EVD-01')],
  conditions: [],
  basis_and_dissent: { basis: ['口径逐项符合'], dissent_position: '无异议', reply_deadline: AT },
  effect_level_applied: ref('REC-WORK-07'),
  acceptance_kind: 'artifact',
  decision_face: decisionFace(),
}

describe('NEG-WRK-03 验收独立性：自检不得冒称独立验收（采集者=交付者→判负）', () => {
  it('验者=交付者 / 仅自检 → 验收记录判负；独立性自填同样拒收', () => {
    // 正例对照：同一载荷更换判者关系后放行
    expect(validateWorkAcceptance(envelope('REC-WORK-09', { ...ACCEPTANCE_BASE }))).toEqual({ ok: true })

    // ① 验者=交付者：自检冒称独立验收
    const deliverer = reject(validateWorkAcceptance(envelope('REC-WORK-09', { ...ACCEPTANCE_BASE }), { judgedByDeliverer: true }))
    expect(hit(deliverer, 'payload.judged_by', '验者≠交付者')).toBe(true)
    // ② 自检清单当验收证据（X3 回执/自检不构成独立验收）
    const selfCheck = reject(validateWorkAcceptance(envelope('REC-WORK-09', { ...ACCEPTANCE_BASE }), { selfCheckOnly: true }))
    expect(hit(selfCheck, 'payload.evidence_refs', '自检不构成独立验收')).toBe(true)
    // ③ 独立性槽自填（无独立检查位置＋控制关系依据）
    const selfDeclared = reject(
      validateWorkAcceptance(
        envelope('REC-WORK-09', {
          ...ACCEPTANCE_BASE,
          independence_verified_by: { verified_by: 'AGENT-1', control_basis_ref: ref('REC-LIFE-05'), self_declared: true },
        }),
      ),
    )
    expect(hit(selfDeclared, 'payload.independence_verified_by', '独立性自填即拒收')).toBe(true)
    // ④ EX-2+ 验收缺收割批次（REC-EVD-01）即不得作验收判断
    const noHarvest = reject(
      validateWorkAcceptance(
        envelope('REC-WORK-09', { ...ACCEPTANCE_BASE, evidence_refs: [ref('REC-EVD-03')] }),
        { effectLevel: 'EX-2' },
      ),
    )
    expect(hit(noHarvest, 'payload.evidence_refs', 'EX-2+ 验收须含收割批次')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-04 未分类高档侧 —————————————————————————

function effectLevelPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_ref: ref('REC-WORK-01'),
    effect_level: 'EX-2',
    reversibility: '可逆：工位副本可回滚',
    affected_rights: ['收益分配权'],
    classified_by: 'g9.internal-boss',
    basis: ['v2/04 §1.1 效果级判据'],
    dispute: [],
    effect_on_procedure: ['EX-2+：四要件＋独立收割'],
    scope_judged: { judged: ['效果级'], not_judged: ['价值'] },
    dissent_position: '无异议',
    decision_face: decisionFace(),
    ...overrides,
  }
}

describe('NEG-WRK-04 未分类高档侧：存疑/争议/敏感面一律 EX-2+，按低档验收即判负', () => {
  it('存疑/争议/触敏感面/重判降档的自评低档记录全部判负（高侧为默认）', () => {
    const low = envelope('REC-WORK-07', effectLevelPayload({ effect_level: 'EX-1' }))
    // ① 存疑/未分级 → 一律高侧（不得自评低档）
    expect(hit(reject(validateEffectLevel(low, { doubtful: true })), 'payload.effect_level', '一律 EX-2+')).toBe(true)
    // ② 争议未裁 → 同样高侧（争议存在本身即判负输入）
    const disputed = envelope('REC-WORK-07', {
      ...effectLevelPayload({ effect_level: 'EX-1' }),
      dispute: [{ party: '生产部', point: '影响面未裁定', final_arbiter: 'g9.internal-boss', deadline: AT }],
    })
    expect(hit(reject(validateEffectLevel(disputed)), 'payload.effect_level', '一律 EX-2+')).toBe(true)
    // ③ 触及敏感面 → 高中低不自选，一律 EX-2+
    expect(hit(reject(validateEffectLevel(low, { sensitiveSurfaces: ['收益分配权'] })), 'payload.effect_level', '一律 EX-2+')).toBe(true)
    // ④ 重判是对新事实的重新分类，不是旧结论追溯降档
    expect(hit(reject(validateEffectLevel(low, { previousLevel: 'EX-3' })), 'payload.effect_level', '不得把旧结论 EX-3 追溯降档')).toBe(true)
    // 正例对照：高侧记录在存疑/争议下放行
    expect(validateEffectLevel(envelope('REC-WORK-07', effectLevelPayload()), { doubtful: true })).toEqual({ ok: true })
  })
})

// ————————————————————————— NEG-WRK-07 维持验收四件 —————————————————————————

function maintPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-01'),
    criteria_revision: '1.0.0',
    result_kind: 'standby',
    state_indicators: [{ indicator: '界内时间比例', material_ref: oref('state-1') }],
    process_indicators: [{ indicator: '覆盖与响应时长', material_ref: oref('process-1') }],
    sampling_refs: [ref('REC-WORK-01')],
    verdict: 'maintained',
    review_cycle: { cycle: '每两周复审', exit_terms: '撤回决定后终止', risk_successor: '风险承接位置=g9.internal-boss' },
    proof_boundary: PROOF,
    ...overrides,
  }
}

describe('NEG-WRK-07 维持验收四件：动作数量不得证明维持有效（双指标分判＋独立抽样＋三段证据）', () => {
  it('只有动作数量（过程指标空）/避免类缺三段/以四要件替代维持记录 → 维持验收记录判负', () => {
    // 正例对照
    expect(validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload()))).toEqual({ ok: true })
    // ① 以动作数量证明维持：状态指标在、过程指标空（两组不可互替）
    const actionsOnly = reject(
      validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload({ process_indicators: [] }))),
    )
    expect(hit(actionsOnly, 'payload.state_indicators', '两组分别判断、不可互替')).toBe(true)
    // ② 避免类缺事前/期间/事后三段 → 结论不得为「维持」
    const avoidance = reject(
      validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload({ result_kind: 'avoidance' }))),
    )
    expect(hit(avoidance, 'payload.three_stage_refs', '三段证据')).toBe(true)
    // ③ 以收割四要件替代维持性验收记录 → 判负
    const fourElements = reject(
      validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload()), { fourElementsOnly: true }),
    )
    expect(hit(fourElements, 'recordType', '不得以收割四要件替代维持性验收记录')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-08 学习分层/变更链 —————————————————————————

function changeSegment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain_id: 'chg-neg-1',
    segment: 'candidate',
    subject: oref('rule-1'),
    subject_kind: 'criteria',
    decided_by: 'g9.internal-boss',
    authority_ref: ref('REC-AUTH-01'),
    basis_refs: [ref('REC-WORK-01')],
    impact_assessment: { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] },
    criteria_version: '1.0.0',
    no_override: true,
    rollback_path: { stop_conditions: ['撤回率上升即停'], monitoring: ['逐周抽样'], rollback_steps: ['回退到旧口径版本'] },
    dissent_position: '无异议',
    effective_state: 'effective',
    effective_time: AT,
    ...overrides,
  }
}

describe('NEG-WRK-08 学习分层/变更链：局部经验不得直接升格为规则（激活批准＋后验缺一即判负）', () => {
  it('跳段生效/无验证生效/三门同一人/受益方单方分类 → 变更链段判负', () => {
    // 正例对照：链首 candidate 段
    expect(validateChangeSegment(envelope('REC-CHG-01', changeSegment()))).toEqual({ ok: true })
    // ① 无验证生效为零：受控生效前必须有验证授权＋独立验证＋激活批准三段
    const noGates = reject(
      validateChangeSegment(envelope('REC-CHG-01', changeSegment({ segment: 'controlled_effective' })), { previousSegment: 'activation_approval', establishedSegments: [] }),
    )
    expect(hit(noGates, 'payload.segment', '无验证生效为零')).toBe(true)
    // ② 段不可跳：substantive_classification 后直接做后验观察（跳过三门）
    const skipped = reject(
      validateChangeSegment(envelope('REC-CHG-01', changeSegment({ segment: 'post_review' })), { previousSegment: 'substantive_classification' }),
    )
    expect(hit(skipped, 'payload.segment', '段不可跳不可互替')).toBe(true)
    // ③ 三门不合并：验证授权/独立验证/激活批准同一具名位置
    const sameDecider = reject(
      validateChangeSegment(envelope('REC-CHG-01', changeSegment({ segment: 'activation_approval' })), {
        previousSegment: 'independent_verification',
        gateDeciders: {
          verification_authorization: 'g9.internal-boss',
          independent_verification: 'g9.internal-boss',
          activation_approval: 'g9.internal-boss',
        },
      }),
    )
    expect(hit(sameDecider, 'payload.decided_by', '三门不得由同一具名位置作出')).toBe(true)
    // ④ 受益方不得单方分类（R-24）
    const beneficiary = reject(
      validateChangeSegment(envelope('REC-CHG-01', changeSegment({ segment: 'substantive_classification', classification_basis: { criteria: ['影响面'], classification: '局部', beneficiary_involvement: '无' } })), {
        previousSegment: 'candidate',
        classifiedByBeneficiary: true,
      }),
    )
    expect(hit(beneficiary, 'payload.decided_by', '受益方不得单方分类')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-09 履约派生 —————————————————————————

function fulfillmentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commitment_ref: ref('REC-WORK-15'),
    work_refs: [ref('REC-WORK-01')],
    merge_rule: '以最近一次验收结论为准（多对多按验收位置合并）',
    derived_status: 'on_track',
    derivation_refs: [ref('REC-WORK-09')],
    ...overrides,
  }
}

describe('NEG-WRK-09 履约派生：履约=派生值禁独立写入，内部验收不得对外宣称履约', () => {
  it('独立写入/工作返工仍标顺利/已兑现无相对方验收 → 履约记录判负', () => {
    // 正例对照
    expect(validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload()))).toEqual({ ok: true })
    // ① 独立写入路径不存在（派生值只能由工作状态＋验收结论推出）
    expect(hit(reject(validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload()), { writtenIndependently: true })), 'recordType', '禁止独立写入')).toBe(true)
    // ② 工作返工时不得标「进行顺利」（内部验收不推出对外履约）
    expect(hit(reject(validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload()), { workStates: ['rework'] })), 'payload.derived_status', '不得标「进行顺利」')).toBe(true)
    // ③ 已兑现必含相对方验收引用（无则最多到有风险/无法判断——治 L3E-06）
    const fulfilled = reject(validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload({ derived_status: 'fulfilled' }))))
    expect(hit(fulfilled, 'payload.counterparty_acceptance', '已兑现必含相对方验收引用')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-10 不利信息 —————————————————————————

function exceptionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_ref: ref('REC-WORK-01'),
    exception_class: 'report_overdue',
    judged_against: '报告时限（v2/04 §九）',
    impact_scope: '对外履约声明（在途承诺）',
    discovered_by: 'g9.audit',
    receiver: 'g9.internal-boss',
    escalation_target: { position: 'g9.internal-boss', deadline: AT, re_escalate_to: 'external-owner' },
    response_deadline: AT,
    review_condition: '不利证据补齐后复核（不得只报有利证据）',
    terminal: null,
    dissent_position: '无异议',
    ...overrides,
  }
}

describe('NEG-WRK-10 不利信息：报告超时/完整性存疑入异常族，未终局不得当结案', () => {
  it('未终局当已结案/接收者匿名/终局无决定引用 → 异常记录判负', () => {
    // 正例对照：报告超时登记为未终局异常（终局是缺省标记，不是结案值）
    expect(validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload()))).toEqual({ ok: true })
    // ① 未终局的异常不得当作已结案（「只报有利证据」类不可静默闭合）
    expect(hit(reject(validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload()), { treatedAsClosed: true })), 'payload.terminal', '不得当作已结案')).toBe(true)
    // ② 接收者须具名（不得「框架/系统/公司」默认未认领）
    expect(hit(reject(validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload({ receiver: '框架' })))), 'payload.receiver', '接收者须具名')).toBe(true)
    // ③ 完整性存疑类终局必须带具名决定者与决定引用
    const noDecision = reject(
      validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload({ exception_class: 'report_integrity_doubt', terminal: 'closed_by_termination' }))),
    )
    expect(hit(noDecision, 'payload.terminal_decision_ref', '须有对应决定引用')).toBe(true)
    expect(hit(noDecision, 'payload.terminal_decided_by', '终局须有具名决定者')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-11 承诺变更程序 —————————————————————————

function commitChangePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commitment_ref: ref('REC-WORK-15'),
    stages: [
      { stage: 'application', at: '2026-10-20T00:00:00Z', actor: 'g9.sales', materials: [ref('REC-WORK-15')] },
      { stage: 'acceptance', at: '2026-10-21T00:00:00Z', actor: 'g9.internal-boss', materials: [ref('REC-AUTH-01')] },
      { stage: 'counterparty_statement', at: '2026-10-22T00:00:00Z', actor: 'counterparty.agent', materials: [ref('REC-WORK-15')] },
    ],
    elements: {
      original_commitment_ref: ref('REC-WORK-15'),
      proposed_change: '交付期后延两周（替代方案：加急补偿）',
      reason_and_evidence: ['外部依赖延期，附往来件'],
      alternative_or_compensation: '加急补偿＋里程碑拆分',
      counterparty_opinion: '相对方明确不同意延期',
      disposition_if_declined: '维持原承诺并执行补偿',
    },
    deadlock_clock: '2026-10-21T00:00:00Z',
    original_terms_stand: true,
    ...overrides,
  }
}

describe('NEG-WRK-11 承诺变更程序：承诺方不得单方降标，在途按原口径结算', () => {
  it('在途改口径/相对方不同意却无合法去向/僵局时限早于申请 → 变更记录判负', () => {
    // 正例对照：四段留痕＋相对方已表达＋去向已定
    expect(
      validateCommitmentChange(
        envelope('REC-WORK-COMMIT-CHANGE', commitChangePayload({ stages: [...(commitChangePayload()['stages'] as unknown[]), { stage: 'decision', at: '2026-10-23T00:00:00Z', actor: 'g9.internal-boss', materials: [ref('REC-AUTH-01')] }], outcome: 'keep_original' })),
      ),
    ).toEqual({ ok: true })
    // ① 单方降标（在途不按原口径结算）→ 形状即拒：original_terms_stand 必须为真
    const downgraded = reject(validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', commitChangePayload({ original_terms_stand: false }))))
    expect(downgraded.some((issue) => issue.path.startsWith('payload.original_terms_stand'))).toBe(true)
    // ② 相对方不同意却无去向：不得拖到过期造成既成事实
    expect(hit(reject(validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', commitChangePayload()), { counterpartyDeclined: true })), 'payload.outcome', '不得拖到过期造成既成事实')).toBe(true)
    // ③ 僵局时限自申请受理起算（早于申请时点即无计时依据）
    expect(hit(reject(validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', commitChangePayload({ deadlock_clock: '2026-10-19T00:00:00Z' })))), 'payload.deadlock_clock', '自申请受理时起算')).toBe(true)
    // ④ 段序不可跳：跳过受理直接相对方表达
    const skipped = reject(
      validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', commitChangePayload({ stages: [{ stage: 'counterparty_statement', at: AT, actor: 'counterparty.agent', materials: [ref('REC-WORK-15')] }] }))),
    )
    expect(hit(skipped, 'payload.stages', '次序逐段留痕')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-12 结清完整面 —————————————————————————

function settlementPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-01'),
    items: [
      { item: 'artifact', state: 'closed' },
      { item: 'resource', state: 'closed' },
      { item: 'evidence', state: 'closed' },
      { item: 'open_items', state: 'closed' },
      { item: 'commitment', state: 'closed' },
      { item: 'counterparty', state: 'closed' },
      { item: 'responsibility', state: 'closed' },
      { item: 'memory', state: 'closed' },
      { item: 'derived_face', state: 'closed' },
    ],
    settled_state: 'fully_settled',
    reservations: [],
    derived_face_evidence: [],
    memory_disposition_refs: [ref('REC-MEM-03')],
    verified_by: 'g9.audit',
    independence: { verified_by: 'g9.audit', control_basis_ref: ref('REC-LIFE-05') },
    verified_scope: '只判「是否关闭」，不重作验收、不判价值',
    dissent_position: '无异议',
    decision_face: decisionFace(),
    value_ref: ref('REC-EVD-04'),
    ...overrides,
  }
}

describe('NEG-WRK-12 结清完整面：结清不结承诺/派生面即不得称完成', () => {
  it('EX-2+ 缺派生面证据/终止无承接/四态自报/核验者=责任者 → 结清记录判负', () => {
    // 正例对照：九项逐项关闭＋四态按推导
    expect(validateWorkSettlement(envelope('REC-WORK-12', settlementPayload()))).toEqual({ ok: true })
    // ① 曾触及 EX-2+ 却无派生面证据（后代枚举＋停用证据）→ 不得称完成
    expect(hit(reject(validateWorkSettlement(envelope('REC-WORK-12', settlementPayload()), { ex2Plus: true })), 'payload.derived_face_evidence', '须派生面证据')).toBe(true)
    // ② 工作已终止却无承接记录与接收确认（转清算同理）→ 未决事项有指派≠承接已被接受
    expect(hit(reject(validateWorkSettlement(envelope('REC-WORK-12', settlementPayload()), { workTerminated: true })), 'payload.handover_ref', '必含承接记录与接收确认')).toBe(true)
    // ③ 结清四态不得自报（有 open 项却声称完全结清）
    const selfClaimed = reject(
      validateWorkSettlement(
        envelope('REC-WORK-12', settlementPayload({ items: [{ item: 'artifact', state: 'closed' }, { item: 'commitment', state: 'open' }] })),
      ),
    )
    expect(hit(selfClaimed, 'payload.settled_state', '结清四态须按推导规则')).toBe(true)
    // ④ 核验者不得为工作责任者本人或其控制者（只判关闭，不重作验收）
    expect(hit(reject(validateWorkSettlement(envelope('REC-WORK-12', settlementPayload()), { verifierIsOwner: true })), 'payload.verified_by', '核验者不得为工作责任者')).toBe(true)
  })
})

// ————————————————————————— NEG-WRK-13 降档逃证 —————————————————————————

function completionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work_ref: ref('REC-WORK-01'),
    effect_level_ref: ref('REC-WORK-07'),
    completion_basis: [
      { element: '终态事件', state: 'present' },
      { element: '自报', state: 'present' },
    ],
    collector_identity: { collector: 'AGENT-1', independence: 'self', self_reported: true },
    gaps: ['抽样未覆盖（低侧按缺口登记）'],
    proof_boundary: PROOF,
    ...overrides,
  }
}

describe('NEG-WRK-13 降档逃证：EX-2+ 按低侧自报完成即判负（四要件＋独立收割缺一不可）', () => {
  it('高侧按低侧闭合 → 完成记录判负；同一载荷在低侧档放行（判负只来自降档）', () => {
    // 正例对照：低侧档（非 EX-2+）同一载荷放行——判负不是形状永远红
    expect(validateCompletionRecord(envelope('REC-WORK-08', completionPayload()), { effectLevel: 'EX-1' })).toEqual({ ok: true })
    // ① EX-2+ 须四要件齐备：自报终态≠完成判据（缺非空输出/REPORT/闸门 exit=0）
    const high = reject(validateCompletionRecord(envelope('REC-WORK-08', completionPayload()), { effectLevel: 'EX-2' }))
    expect(hit(high, 'payload.completion_basis', '降档逃证 W-13')).toBe(true)
    // ② 无独立收割批次 → 不得称完成
    expect(hit(high, 'payload.harvest_ref', '须由独立收割者')).toBe(true)
    // ③ 自报冒充独立收缴
    expect(hit(high, 'payload.collector_identity', '自报只能是线索')).toBe(true)
    // ④ 「不适用」的合法表示：非 present 要素须记理由＋判者，空着即拒
    const emptyNa = reject(
      validateCompletionRecord(
        envelope('REC-WORK-08', completionPayload({ completion_basis: [{ element: '终态事件', state: 'present' }, { element: 'REPORT 落盘', state: 'missing' }] })),
        { effectLevel: 'EX-2' },
      ),
    )
    expect(hit(emptyNa, 'payload.completion_basis', '须记不适用＋理由＋判者')).toBe(true)
  })
})
