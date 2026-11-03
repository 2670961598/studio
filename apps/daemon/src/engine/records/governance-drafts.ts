/**
 * engine/records/governance-drafts —— 刀D 问责/变更链/记忆分流/价值评估草案（studio-dev-561）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段·刀D（相位 6/断路问责、配置热更变更链、结清/复盘前置）；
 *   - docs/17-§6（收割四要件；记录是留痕不是判据）；
 *   - docs/v2/11 §七（REC-ACC-01/02 独立裁判/申辩窗口/执行证据）、§八＋§14.4-2
 *     （REC-CHG-01 段不可跳、三门不合并、R-8/R-24）、§十三（REC-MEM-03 处置授权/三路分流）、
 *     §六（REC-EVD-04 四本账/判断者独立/外部反馈为空只能「价值不明」）；
 *   - docs/v2/11 §〇.3-2（ACC-02 必带决定面）、§〇.7（证据类/决定类必填 proof_boundary）。
 *
 * 族内不变量一律交 contract 判定件（`validateAccountabilityCase`/`validateRemedyDecision`/
 * `validateChangeSegment`/`validateMemoryDisposal`/`validateValueEvaluation`）；本件只补
 * 跨记录前置闸（引用类型/被引在库/位置独立/链前段一致）。
 */
import type {
  AccountabilityCasePayload,
  ChangeSegmentPayload,
  MemoryDisposalPayload,
  RemedyDecisionPayload,
  ValueEvaluationPayload,
} from '../../../../../packages/contract/src/records/index.ts'
import {
  validateAccountabilityCase,
  validateChangeSegment,
  validateMemoryDisposal,
  validateRemedyDecision,
  validateValueEvaluation,
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
  RecordAccountabilityArgs,
  RecordChangeSegmentArgs,
  RecordMemoryDisposalArgs,
  RecordRefRequirement,
  RecordRemedyArgs,
  RecordValueEvaluationArgs,
} from './types.ts'

/** ISO 时刻（调用方给 epoch-ms；转换集中在此） */
function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

/** 问责 proof_boundary */
const ACCOUNTABILITY_PROOF =
  '本记录证明：问责事项、质询/说明材料、申辩窗口与逾期处置、独立裁判位置与控制关系依据、结论与后果去向；' +
  '不证明证据充分性超出所列材料、不证明任命/职级已改变（须经 v2/03 程序）、不证明救济已执行（→REC-ACC-02）。'

/** 救济 proof_boundary */
const REMEDY_PROOF =
  '本记录证明：救济类别、受益方与申请入口、执行者与执行证据链、结清确认与不可补偿损害边界；' +
  '不证明执行不能已消灭义务（执行不能＝未决登记）、不证明争议期间抵销合法（I-15）。'

/** 变更链段 proof_boundary */
const CHANGE_PROOF =
  '本记录证明：本变更链段的段名/次序、具名作出者与权源、依据与影响评估、段条件字段；' +
  '不证明其他段已成立（每段一条记录、不可跳段）、不证明三门已合并（三门不合并——§八）、不证明后验已达标（归后验段）。'

/** 记忆分流 proof_boundary */
const MEMORY_PROOF =
  '本记录证明：处置操作、目标条目、处置授权位置（须独立于请求方）、三路分流凭证与通知/残留事实；' +
  '不证明责任记录/承诺/证据/审计线索可被清除（禁止借记忆清除消灭——§十三）、不证明外部副本已消灭。'

/** 价值评估 proof_boundary */
const VALUE_PROOF =
  '本记录证明：四本账逐项与依据、外部反馈与价值结论、判断者独立性与不确定/异议；' +
  '不证明可压成单一总分、不证明未列负价值不存在、不回溯改验收结论（§六）。'

/**
 * REC-ACC-01 问责案例草案（相位 6 回收/断路；决定型，决定面由自有字段承载）。
 * 前置闸：REC-LIFE-01 任职引用（须已落）＋独立裁判位置/控制关系依据（自填即拒）＋申辩窗口非无限期。
 */
export function accountabilityDraft(args: RecordAccountabilityArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-ACC-01'
  if (isAnonymousSubject(payload.arbiter.verified_by)) return refusePrereq(recordType, '裁判位置须具名（§0.2-1）')
  if (payload.arbiter.self_declared === true) {
    return refusePrereq(recordType, '独立性自填即拒收（须独立检查位置＋控制关系依据——§七/L3E-02）')
  }
  if (context?.arbiterSameAsSubject === true) {
    return refusePrereq(recordType, '裁判位置不得由被问责者或其任免链下位单独担任（§七）')
  }
  if (payload.defense_window.deadline === undefined && payload.defense_window.review_condition === undefined) {
    return refusePrereq(recordType, '申辩窗口不得无限期：须给期限或复审条件（I-11——§七）')
  }
  if (payload.defense_window.overdue_disposition.trim() === '') {
    return refusePrereq(recordType, '申辩逾期须写处置去向（overdue_disposition——I-11）')
  }
  if (payload.proof_boundary.trim() === '') return refusePrereq(recordType, 'proof_boundary 必填（§〇.7-1）')
  if (payload.consequence_routing.appointment_recommendation !== undefined && payload.consequence_routing.procedure_ref === undefined) {
    return refusePrereq(recordType, '不经 v2/03 程序不得改变任命或职级（须给 procedure_ref——E-6/§七）')
  }

  const requirements: RecordRefRequirement[] = []
  const subject = requireRef(recordType, payload.subject_ref, 'REC-LIFE-01', 'subject_ref（被问责者任职引用）')
  if (!subject.ok) return subject
  requirements.push(subject.requirement)
  const matters = requireRefs(recordType, payload.matter_refs, /^REC-(?:WORK|EVD|ACC)-/, 'matter_refs（事项与后果）')
  if (!matters.ok) return matters
  requirements.push(...matters.requirements)

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-acc-01:${company}:${args.ticket}:${args.at}`,
      producedAt,
      decidedBy: payload.arbiter.verified_by,
      effectiveState: 'effective',
      effectiveFrom: producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'accountability',
        requesterSequence: `${payload.subject_ref.refId}:${producedAt}`,
      },
      proofBoundary: ACCOUNTABILITY_PROOF,
      payload,
    },
    gate: {
      requires: requirements,
      validate: (record) => validateAccountabilityCase(record, context ?? {}),
    },
  }
}

/**
 * REC-ACC-02 救济决定草案（问责出口）。
 * 前置闸：case_ref（ACC-01/损害记录，须已落）＋决定面＋proof_boundary＋执行证据链。
 */
export function remedyDraft(args: RecordRemedyArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-ACC-02'
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
  if (payload.proof_boundary.trim() === '') return refusePrereq(recordType, 'proof_boundary 必填（§〇.7-1）')
  if (payload.execution_evidence.length === 0) {
    return refusePrereq(recordType, '执行证据链必填（执行不能＝未决登记，不消灭义务——§七）')
  }
  if (payload.settlement_confirmation.settled && payload.settlement_confirmation.confirmed_by === null) {
    return refusePrereq(recordType, '结清确认须有具名确认者（§七）')
  }
  const caseRef = requireRef(
    recordType,
    payload.case_ref,
    ['REC-ACC-01', 'REC-WORK-17', 'REC-WORK-12', 'REC-EVD-04'],
    'case_ref（问责案例/损害记录）',
  )
  if (!caseRef.ok) return caseRef
  const execution = requireRefs(recordType, payload.execution_evidence, /^REC-/, 'execution_evidence（执行证据链）')
  if (!execution.ok) return execution

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-acc-02:${company}:${args.ticket}:${args.at}`,
      producedAt,
      decidedBy: payload.decision_face.decided_by,
      effectiveState: 'effective',
      effectiveFrom: payload.decision_face.effective_time ?? producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'remedy',
        requesterSequence: `${payload.case_ref.refId}:${producedAt}`,
      },
      proofBoundary: REMEDY_PROOF,
      payload,
    },
    gate: {
      requires: [caseRef.requirement, ...execution.requirements],
      validate: (record) => validateRemedyDecision(record, context ?? {}),
    },
  }
}

const CHANGE_GATES = ['verification_authorization', 'independent_verification', 'activation_approval'] as const

/**
 * REC-CHG-01 变更链段草案（配置热更/变更决定位）。
 * 前置闸：链前段（不可跳段）＋三门不合并＋CAP-01/02 前件（能力包）。
 */
export function changeSegmentDraft(args: RecordChangeSegmentArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-CHG-01'
  if (isAnonymousSubject(payload.decided_by)) return refusePrereq(recordType, '该段作出者须具名（§0.2-1）')
  if (payload.no_override !== true) {
    return refusePrereq(recordType, '判据变更不得覆盖原结论（no_override 恒真——R-8/§八）')
  }
  const previous = context?.previousSegment
  if (payload.segment === 'candidate') {
    if (previous !== undefined || args.previousSegmentRef !== undefined) {
      return refusePrereq(recordType, 'candidate 段无链前段（不得带 previousSegment/previousSegmentRef——§八）')
    }
  } else {
    if (previous === undefined) return refusePrereq(recordType, `段 ${payload.segment} 缺链前段（segment 不可跳段——§八/§14.4-2）`)
    if (args.previousSegmentRef === undefined) return refusePrereq(recordType, `段 ${payload.segment} 缺链前段记录引用（不臆造链续接）`)
  }
  const gateDeciders = context?.gateDeciders ?? {}
  const provided = CHANGE_GATES.map((segment) => gateDeciders[segment]).filter((value): value is string => value !== undefined)
  if (new Set(provided).size !== provided.length) {
    return refusePrereq(recordType, '验证授权/独立验证/激活批准三门不得由同一具名位置作出（三门不合并——§八）')
  }
  if (payload.segment === 'activation_approval') {
    const missing = CHANGE_GATES.filter((segment) => gateDeciders[segment] === undefined)
    if (missing.length > 0) {
      return refusePrereq(recordType, `激活批准段须三门前置齐：缺 ${missing.join('、')} 的具名作出者（§八）`)
    }
  }
  if (payload.segment === 'substantive_classification' && payload.classification_basis === undefined) {
    return refusePrereq(recordType, '实质分类段必填 classification_basis（受益方不得单方分类——R-24）')
  }
  if (payload.segment === 'controlled_effective' && payload.controlled_rollout === undefined) {
    return refusePrereq(recordType, '受控生效段必填 controlled_rollout（范围与围栏——§八）')
  }
  if (payload.segment === 'post_review' && payload.post_review === undefined) {
    return refusePrereq(recordType, '后验观察段必填 post_review（撤回率/多轮后验/退化比较——§八）')
  }
  if (payload.segment === 'post_chain_duty' && (payload.post_chain_duties === undefined || payload.post_chain_duties.length === 0)) {
    return refusePrereq(recordType, '链后义务段必填逐项完成证据与残余清点（§八）')
  }

  const requirements: RecordRefRequirement[] = []
  if (args.previousSegmentRef !== undefined && previous !== undefined) {
    const prev = args.previousSegmentRef
    const checked = requireRef(recordType, prev, 'REC-CHG-01', 'previous_segment（链前段）')
    if (!checked.ok) return checked
    requirements.push({
      ...checked.requirement,
      match: (record) => {
        const bag = record.payload as { segment?: unknown; chain_id?: unknown }
        if (bag.segment !== previous) return `链前段记录段名=${String(bag.segment)}，期望 ${previous}（不可跳段——§八）`
        if (bag.chain_id !== payload.chain_id) return `链前段 chain_id=${String(bag.chain_id)}，期望 ${payload.chain_id}（跨链不得续接）`
        return undefined
      },
    })
  }
  if (payload.subject_kind === 'capability_pack' && (CHANGE_GATES as readonly string[]).includes(payload.segment)) {
    const cap01 = requireRef(recordType, args.capabilityRefs?.cap01, 'REC-CAP-01', 'capabilityRefs.cap01（能力声明）')
    if (!cap01.ok) return cap01
    const cap02 = requireRef(recordType, args.capabilityRefs?.cap02, 'REC-CAP-02', 'capabilityRefs.cap02（资格认定/重认）')
    if (!cap02.ok) return cap02
    requirements.push(cap01.requirement, cap02.requirement)
  }

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-chg-01:${company}:${payload.chain_id}:${payload.segment}`,
      producedAt,
      decidedBy: payload.decided_by,
      effectiveState: 'effective',
      effectiveFrom: producedAt,
      idempotencyKey: {
        recordType,
        subjectId: payload.chain_id,
        operationClass: 'change-segment',
        requesterSequence: payload.segment,
      },
      proofBoundary: CHANGE_PROOF,
      payload,
    },
    gate: {
      requires: requirements,
      validate: (record) => validateChangeSegment(record, context ?? {}),
    },
  }
}

/**
 * REC-MEM-03 处置决定草案（结清/复盘前置）。
 * 前置闸：处置授权位置（独立于请求方）＋三路分流凭证（归档/清除/转出）＋转层双授权。
 */
export function memoryDisposalDraft(args: RecordMemoryDisposalArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-MEM-03'
  if (isAnonymousSubject(args.independentPosition)) return refusePrereq(recordType, '处置授权位置须具名（§0.2-1）')
  if (args.requestedBy !== undefined && samePosition(args.independentPosition, args.requestedBy)) {
    return refusePrereq(recordType, '处置授权位置不得与请求方同体（独立位置闸——§十三/表 D 行 10/11）')
  }
  if (payload.authorizations.some((entry) => isAnonymousSubject(entry.authorized_by))) {
    return refusePrereq(recordType, '授权者须具名（authorized_by——§十三）')
  }
  if (payload.authorizations.length === 0) return refusePrereq(recordType, '处置授权不得为空（§十三）')
  if (payload.target_entries.length === 0) return refusePrereq(recordType, '目标条目不得为空（§十三）')
  if (payload.notice.notified.length === 0) return refusePrereq(recordType, '通知对象不得为空（§十三）')
  if (payload.notice.residue_statement.trim() === '') {
    return refusePrereq(recordType, '须载明原始来源与外部副本可能仍存在的事实（不消灭历史——§十三）')
  }
  if (payload.operation === 'transfer_layer') {
    const layers = new Set(payload.authorizations.map((entry) => entry.layer))
    if (layers.size < 2) return refusePrereq(recordType, '转层须源层与目标层双授权（缺一即拒——§十三/L3E-10）')
  }
  const routeByOperation: Partial<Record<MemoryDisposalPayload['operation'], MemoryDisposalPayload['disposal_evidence']['route']>> = {
    archive: 'archive',
    erase: 'erase',
    transfer_out: 'transfer_out',
    transfer_layer: 'transfer_out',
  }
  const expectedRoute = routeByOperation[payload.operation]
  if (expectedRoute !== undefined && payload.disposal_evidence.route !== expectedRoute) {
    return refusePrereq(recordType, `操作 ${payload.operation} 须给 ${expectedRoute} 凭证（实得 ${payload.disposal_evidence.route}——§十三）`)
  }

  const targets = requireRefs(recordType, payload.target_entries, /^REC-MEM-/, 'target_entries（目标条目）')
  if (!targets.ok) return targets

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-mem-03:${company}:${args.ticket}:${args.at}`,
      producedAt,
      decidedBy: args.independentPosition,
      effectiveState: 'effective',
      effectiveFrom: producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'memory-disposal',
        requesterSequence: `${payload.operation}:${args.at}`,
      },
      proofBoundary: MEMORY_PROOF,
      payload,
    },
    gate: {
      // 目标条目只做类型闸：v0 记忆读面由 store hist.memory 承载，不在此越权读内容
      validate: (record) => validateMemoryDisposal(record, context ?? {}),
    },
  }
}

/**
 * REC-EVD-04 价值评估草案（结清/复盘前置）。
 * 前置闸：四本账（不得压总分）＋判断者独立性（自填即拒）＋负价值单列＋外部反馈为空只能「价值不明」。
 */
export function valueEvaluationDraft(args: RecordValueEvaluationArgs & { readonly company: string }): DraftOutcome {
  const { payload, context, company } = args
  const recordType = 'REC-EVD-04'
  if (isAnonymousSubject(payload.judged_by)) return refusePrereq(recordType, '价值判断者须具名（§0.2-1）')
  if (isAnonymousSubject(payload.independence.verified_by)) return refusePrereq(recordType, '独立性核验者须具名（§六）')
  if (payload.independence.self_declared === true) {
    return refusePrereq(recordType, '独立性自填即拒收（judged_by＋independence 必填且独立——§六/L3E-03）')
  }
  if (payload.proof_boundary.trim() === '') return refusePrereq(recordType, 'proof_boundary 必填（§〇.7-1）')
  if (payload.external_feedback.length === 0 && payload.conclusion !== 'value_unknown') {
    return refusePrereq(recordType, '外部反馈为空时 conclusion 只能是「价值不明」（不得默认有价值——§六/L3E-03）')
  }
  const accounts = [payload.artifact_account, payload.state_account, payload.impact_account, payload.cost_account]
  const negative = new Set<string>()
  for (const account of accounts) {
    for (const entry of account.entries) {
      if (entry.amount !== null && entry.amount < 0) negative.add(entry.item)
    }
  }
  const unlisted = [...negative].filter((item) => !payload.negative_value_items.includes(item))
  if (unlisted.length > 0) {
    return refusePrereq(recordType, `负价值须单独列示：${unlisted.join('、')}（I-3——§六）`)
  }

  const requirements: RecordRefRequirement[] = []
  const work = requireRef(recordType, payload.work_ref, /^REC-WORK-/, 'work_ref（被评估工作）')
  if (!work.ok) return work
  requirements.push(work.requirement)
  if (payload.acceptance_ref !== null) {
    const acceptance = requireRef(recordType, payload.acceptance_ref, 'REC-WORK-09', 'acceptance_ref（验收引用）')
    if (!acceptance.ok) return acceptance
    requirements.push(acceptance.requirement)
  }

  const producedAt = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType,
      recordId: `rec-evd-04:${company}:${args.ticket}:${args.at}`,
      producedAt,
      decidedBy: payload.judged_by,
      effectiveState: 'effective',
      effectiveFrom: producedAt,
      idempotencyKey: {
        recordType,
        subjectId: args.ticket,
        operationClass: 'value-evaluation',
        requesterSequence: `${args.at}`,
      },
      proofBoundary: VALUE_PROOF,
      payload,
    },
    gate: {
      requires: requirements,
      validate: (record) => validateValueEvaluation(record, context ?? {}),
    },
  }
}

/** 供 index 再出口的入参/载荷类型别名（调用方不必再深引 contract） */
export type {
  AccountabilityCasePayload,
  ChangeSegmentPayload,
  MemoryDisposalPayload,
  RemedyDecisionPayload,
  ValueEvaluationPayload,
}
