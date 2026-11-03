/**
 * engine/records/close-drafts —— 刀D 结清/异常/复盘草案（studio-dev-561）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段·刀D（相位 5/6 结清与复盘、相位 6/断路异常）；
 *   - docs/17-§6（收割四要件：记录落库在判定之后，不改判据）；
 *   - docs/v2/11 §5.2（REC-WORK-12 结清单列表/四态推导/承接/派生面/记忆分流/独立核验）、
 *     §5.4（REC-WORK-17 具名接收与升级链/终局）、§十（REC-REV-01 复盘≠追认/产出三去向）；
 *   - docs/v2/11 §〇.3-2（决定面封闭清单：WORK-12、REV-01 必带）、§〇.7（证明边界）。
 *
 * 分型纪律：
 *   - WORK-12/REV-01 是**决定型**：决定面/权源/独立位置缺一即拒，不由执行面自填；
 *   - WORK-17 是**事件型**：但接收位置必须具名（不得默认未认领），终局必须引决定。
 *
 * 族内不变量一律交 contract 判定件（`validateWorkSettlement`/`validateExceptionRecord`/
 * `validateReview`）；本件只补跨记录前置闸（引用类型/被引在库/位置独立）。
 */
import type {
  ExceptionRecordPayload,
  ReviewPayload,
  WorkSettlementPayload,
} from '../../../../../packages/contract/src/records/index.ts'
import {
  deriveWorkSettledState,
  validateExceptionRecord,
  validateReview,
  validateWorkSettlement,
} from '../../../../../packages/contract/src/records/index.ts'
import type { DraftOutcome } from './drafts.ts'
import {
  checkDecisionFace,
  isAnonymousSubject,
  refusePrereq,
  requireRef,
  requireRefs,
  samePosition,
} from './gate.ts'
import type {
  RecordExceptionArgs,
  RecordRefRequirement,
  RecordReviewArgs,
  RecordSettlementArgs,
} from './types.ts'

/** ISO 时刻（与 drafts.isoAt 同口径；本件不重复实现日期库） */
function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

/** 结清记录 proof_boundary（§0.7-1：证明/不证明分开写） */
const SETTLEMENT_PROOF =
  '本记录证明：结清清单逐项状态、四态按推导规则得出、承接与接收确认（如有）、派生面证据（如有）、' +
  '出工记忆三路分流凭证与独立核验位置；不证明验收结论（验收归 REC-WORK-09）、不证明价值判断（归 REC-EVD-04）、' +
  '不证明未列事项不存在（未判范围见决定面）。'

/** 异常记录 proof_boundary */
const EXCEPTION_PROOF =
  '本记录证明：异常的发现、类别、口径、影响范围、具名接收位置与升级链、终局（如已终局）；' +
  '不证明定责（问责归 REC-ACC-01）、不证明纠正已完成（纠正证据另引）、不证明未终局异常已结案。'

/** 复盘记录 proof_boundary */
const REVIEW_PROOF =
  '本记录证明：复盘范围/输入/发现/产出三去向与复盘位置独立性；' +
  '不证明追认授权（复盘≠追认）、不改写验收历史、不证明方法与规则候选已生效（须走 REC-CHG-01 段）。'

/**
 * REC-WORK-12 工作结清草案（相位 5 合并 / 相位 6 回收；决定型）。
 * 前置闸：MEM-03 分流凭证＋EVD-04 价值评估（或完全结清的显式缺口）＋独立核验位置。
 */
export function settlementDraft(args: RecordSettlementArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-WORK-12'
  const face = payload.decision_face
  const faceIssue = checkDecisionFace({
    decidedBy: face.decided_by,
    authorityRef: face.authority_ref,
    rationale: face.rationale,
    basisRefs: face.basis_refs,
    scopeJudged: { judged: face.scope_judged.judged, notJudged: face.scope_judged.not_judged },
    dissentPosition: face.dissent_position,
    effectiveFrom: face.effective_time ?? isoAt(args.at),
  })
  if (faceIssue !== undefined) return refusePrereq(recordType, faceIssue)
  if (isAnonymousSubject(payload.verified_by)) return refusePrereq(recordType, '核验者须具名（§0.2-1）')
  if (payload.independence.self_declared === true) {
    return refusePrereq(recordType, '独立性自填即拒收（verifier 须给独立检查位置＋控制关系依据——§5.2/§七）')
  }
  if (context?.verifierIsOwner === true) {
    return refusePrereq(recordType, '核验者不得为工作责任者本人或其控制者（§5.2/L3E-02）')
  }
  const settled = deriveWorkSettledState(payload.items)
  if (payload.items.some((item) => item.state === 'reservation' && item.reservation_ref === undefined)) {
    return refusePrereq(recordType, '保留事项须逐项给 reservation_ref（保留事项无引用不得结清——§5.2）')
  }
  if (payload.memory_disposition_refs.length === 0) {
    return refusePrereq(recordType, '出工记忆三路分流凭证未完成不得结清（→REC-MEM-03——§5.2）')
  }
  if (settled === 'fully_settled' && payload.value_ref === undefined && payload.value_evaluation_gap === undefined) {
    return refusePrereq(recordType, '完全结清且未作价值评估须写理由/责任者/复审点（value_ref 或 value_evaluation_gap——§5.2/L3E-03）')
  }
  const needsHandover = settled === 'into_liquidation' || context?.workTerminated === true
  if (needsHandover && (payload.handover_ref === undefined || payload.handover_acceptance === undefined)) {
    return refusePrereq(recordType, '转入清算/已终止必含承接记录与接收确认（§5.2/L3E-01）')
  }
  const needsDerivedFace = settled === 'into_liquidation' || context?.touchedSensitive === true || context?.ex2Plus === true
  if (needsDerivedFace && payload.derived_face_evidence.length === 0) {
    return refusePrereq(recordType, '撤回/回收/清算或曾触及 EX-2+ 须派生面证据（REC-EVD-RVK/REC-AUTH-03——§5.2/W-12）')
  }

  const requirements: RecordRefRequirement[] = []
  const work = requireRef(recordType, payload.work_ref, /^REC-WORK-/, 'work_ref（被结清工作）')
  if (!work.ok) return work
  requirements.push(work.requirement)
  const memory = requireRefs(recordType, payload.memory_disposition_refs, 'REC-MEM-03', 'memory_disposition_refs（分流凭证）')
  if (!memory.ok) return memory
  requirements.push(...memory.requirements)
  if (payload.value_ref !== undefined) {
    const value = requireRef(recordType, payload.value_ref, 'REC-EVD-04', 'value_ref（价值评估）')
    if (!value.ok) return value
    requirements.push(value.requirement)
  }
  if (payload.handover_ref !== undefined) {
    const handover = requireRef(recordType, payload.handover_ref, ['REC-LIFE-10', 'REC-WORK-HANDOVER'], 'handover_ref（承接）')
    if (!handover.ok) return handover
    requirements.push(handover.requirement)
  }
  if (payload.derived_face_evidence.length > 0) {
    const derived = requireRefs(recordType, payload.derived_face_evidence, ['REC-EVD-RVK', 'REC-AUTH-03'], 'derived_face_evidence（派生面证据）')
    if (!derived.ok) return derived
    requirements.push(...derived.requirements)
  }

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-work-12:${company}:${args.ticket}:${args.attempt}`,
      producedAt,
      decidedBy: payload.decision_face.decided_by,
      effectiveState: 'effective',
      effectiveFrom: payload.decision_face.effective_time ?? producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'settle',
        requesterSequence: `${args.attempt}`,
      },
      proofBoundary: SETTLEMENT_PROOF,
      payload: { ...payload, settled_state: settled },
    },
    gate: {
      requires: requirements,
      validate: (record) => validateWorkSettlement(record, context ?? {}),
    },
  }
}

/**
 * REC-WORK-17 异常记录草案（相位 6 回收/断路）。
 * 前置闸：subject_ref（工作/合同记录，须已落）＋具名接收位置＋升级链（不得默认未认领）。
 */
export function exceptionDraft(args: RecordExceptionArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-WORK-17'
  if (isAnonymousSubject(payload.discovered_by)) return refusePrereq(recordType, '发现者须具名（§0.2-1）')
  if (isAnonymousSubject(payload.receiver)) {
    return refusePrereq(recordType, `接收位置不得匿名「${payload.receiver}」（不得默认未认领——§5.4/L3E-16）`)
  }
  if (isAnonymousSubject(payload.escalation_target.position)) {
    return refusePrereq(recordType, '升级目标须具名位置（§5.4）')
  }
  if (payload.escalation_target.re_escalate_to.trim() === '') return refusePrereq(recordType, '再升级去向不得为空（§5.4）')
  if (payload.terminal !== null && payload.terminal_decided_by === undefined) {
    return refusePrereq(recordType, '终局须有具名决定者（terminal_decided_by——§5.4）')
  }
  if (payload.terminal === 'closed_by_termination' && payload.terminal_decision_ref === undefined) {
    return refusePrereq(recordType, '终局=终止/变更须引对应决定记录（terminal_decision_ref——§5.4）')
  }
  const subject = requireRef(recordType, payload.subject_ref, /^REC-WORK-/, 'subject_ref（工作/合同记录）')
  if (!subject.ok) return subject
  const requirements: RecordRefRequirement[] = [subject.requirement]
  if (payload.terminal_decision_ref !== undefined) {
    const decision = requireRef(recordType, payload.terminal_decision_ref, /^REC-(?:WORK|DEC|ACC|CHG|LIFE)-/, 'terminal_decision_ref（终局决定）')
    if (!decision.ok) return decision
    requirements.push(decision.requirement)
  }
  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-work-17:${company}:${args.ticket}:${payload.exception_class}:${args.at}`,
      producedAt,
      decidedBy: payload.discovered_by,
      effectiveState: 'effective',
      effectiveFrom: producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'exception',
        requesterSequence: `${payload.exception_class}:${producedAt}`,
      },
      proofBoundary: EXCEPTION_PROOF,
      payload,
    },
    gate: {
      requires: requirements,
      validate: (record) => validateExceptionRecord(record, context ?? {}),
    },
  }
}

/**
 * REC-REV-01 复盘草案（终局后/周期复盘；决定型）。
 * 前置闸：EVD-04 代价账＋WORK-09 验收引用（如有，须已落）＋复盘位置独立性（自填即拒）。
 */
export function reviewDraft(args: RecordReviewArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-REV-01'
  const face = payload.decision_face
  const faceIssue = checkDecisionFace({
    decidedBy: face.decided_by,
    authorityRef: face.authority_ref,
    rationale: face.rationale,
    basisRefs: face.basis_refs,
    scopeJudged: { judged: face.scope_judged.judged, notJudged: face.scope_judged.not_judged },
    dissentPosition: face.dissent_position,
    effectiveFrom: face.effective_time ?? isoAt(args.at),
  })
  if (faceIssue !== undefined) return refusePrereq(recordType, faceIssue)
  if (isAnonymousSubject(payload.independence.decided_by)) return refusePrereq(recordType, '复盘位置须具名（§0.2-1）')
  if (payload.independence.self_declared === true) {
    return refusePrereq(recordType, '复盘位置独立性不得自填（self_declared 即拒——§十）')
  }
  if (!samePosition(face.decided_by, payload.independence.decided_by)) {
    return refusePrereq(recordType, '决定面决定者与复盘位置不一致（决定面须由复盘位置作出——§十）')
  }

  const requirements: RecordRefRequirement[] = []
  const cost = requireRef(recordType, payload.inputs.cost_account_ref, 'REC-EVD-04', 'inputs.cost_account_ref（代价账）')
  if (!cost.ok) return cost
  requirements.push(cost.requirement)
  if (payload.inputs.acceptance_refs.length > 0) {
    const acceptance = requireRefs(recordType, payload.inputs.acceptance_refs, 'REC-WORK-09', 'inputs.acceptance_refs（验收引用）')
    if (!acceptance.ok) return acceptance
    requirements.push(...acceptance.requirements)
  }
  const unfulfilled = payload.inputs.unfulfilled_commitments.length > 0
    ? requireRefs(recordType, payload.inputs.unfulfilled_commitments, /^REC-WORK-/, 'inputs.unfulfilled_commitments（未兑现承诺）')
    : undefined
  if (unfulfilled !== undefined) {
    if (!unfulfilled.ok) return unfulfilled
    requirements.push(...unfulfilled.requirements)
  }
  if (payload.outputs.method_rule_candidates.length > 0) {
    const candidates = requireRefs(recordType, payload.outputs.method_rule_candidates, 'REC-CHG-01', 'outputs.method_rule_candidates（入变更链候选）')
    if (!candidates.ok) return candidates
    requirements.push(...candidates.requirements)
  }
  if (payload.outputs.personal_experience_refs.length > 0) {
    const experience = requireRefs(recordType, payload.outputs.personal_experience_refs, 'REC-MEM-01', 'outputs.personal_experience_refs（个人经验）')
    if (!experience.ok) return experience
    requirements.push(...experience.requirements)
  }
  if (payload.outputs.structural_issues.length > 0) {
    const structural = requireRefs(recordType, payload.outputs.structural_issues, 'REC-EVAL-01', 'outputs.structural_issues（结构问题）')
    if (!structural.ok) return structural
    requirements.push(...structural.requirements)
  }

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-rev-01:${company}:${args.ticket}:${producedAt}`,
      producedAt,
      decidedBy: payload.independence.decided_by,
      effectiveState: 'effective',
      effectiveFrom: payload.decision_face.effective_time ?? producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'review',
        requesterSequence: `${producedAt}`,
      },
      proofBoundary: REVIEW_PROOF,
      payload,
    },
    gate: {
      requires: requirements,
      validate: (record) => validateReview(record, context ?? {}),
    },
  }
}

export type { WorkSettlementPayload, ExceptionRecordPayload, ReviewPayload }
