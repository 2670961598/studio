/**
 * engine/records/work-chain —— 开工/完成/验收链草案（REC-WORK-02/03/04/05/07/08/09＋REC-EVD-03）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表；本件是其执行体）；
 *   - docs/17-§6（收割四要件：记录只在判定**之后**落，四要件判据零变更——记录是留痕不是判据）；
 *   - docs/v2/11 §5.1（02/03/04/05 字段/不变量）、§5.2（07/08/09 与 M-05/M-10/M-17 边）、
 *     §六（REC-EVD-03 证据包八要素）、§〇.3-1/§0.3-2（决定面六件与封闭清单）、§0.4-5（幂等）、
 *     §0.5（生效槽）、§0.7（证明边界）、§十四 §14.1（M 边集前置记录列）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一写口——本件零 IO，只造草案）。
 *
 * 纪律（与 drafts.ts 同源）：
 *   - 本件只做「草案→记录身份/证明边界/幂等键」的确定性映射；字段形状一律取 contract 类型，
 *     **不复制字段表**、不改判据、不新增记录类；
 *   - 决定面由 payload 自带的 `decision_face` 承载（权威值）；本件只把信封 `decidedBy` /
 *     生效槽投影为同值（§0.3-4：两处冲突即拒收，校验在 envelope/contract）；
 *   - 前件引用（work_ref/effect_level_ref/authority_ref…）由调用方（决定点）给出，写面在
 *     wire.ts 逐条验「已落库」——引用未来记录＝拒写，不臆造（§0.4-2/§十五-2）。
 */
import type {
  CompletionRecordPayload,
  EffectLevelPayload,
  EvidencePackagePayload,
  IntakeDecisionPayload,
  PlanLockPayload,
  StartDecisionPayload,
  WorkAcceptancePayload,
  WorkContractPayload,
  WorkType,
} from '@studio-next/contract/records'
import type { DraftDecisionFaceInput, DraftOutcome, DraftRecordRef } from './drafts.ts'
import { isoAt } from './drafts.ts'
import type { RecordDraft } from './types.ts'

/** 链上三类相位（决定点）：派发前置 / 收割 / 验收（相位 4 收尾） */
export type WorkChainPhase = 'start' | 'harvest' | 'acceptance'

/** 记录 id 约定（幂等身份；`rec-work-05` 与刀B `wire.planLockRecordId` 同值——前件按 id 解析） */
export function chainRecordId(company: string, ticket: string, attempt: number, recordType: WorkChainRecordType): string {
  const suffix: Record<WorkChainRecordType, string> = {
    'REC-WORK-02': 'rec-work-02',
    'REC-WORK-03': 'rec-work-03',
    'REC-WORK-04': 'rec-work-04',
    'REC-WORK-05': 'rec-work-05',
    'REC-WORK-07': 'rec-work-07',
    'REC-WORK-08': 'rec-work-08',
    'REC-WORK-09': 'rec-work-09',
    'REC-EVD-03': 'rec-evd-03',
  }
  return `${suffix[recordType]}:${company}:${ticket}:${attempt}`
}

/** 本刀八族（族表唯一源；BLOCKED 解除与文档映射表同序） */
export const WORK_CHAIN_RECORD_TYPES = [
  'REC-WORK-02',
  'REC-WORK-03',
  'REC-WORK-04',
  'REC-WORK-05',
  'REC-WORK-07',
  'REC-WORK-08',
  'REC-WORK-09',
  'REC-EVD-03',
] as const

export type WorkChainRecordType = (typeof WORK_CHAIN_RECORD_TYPES)[number]

/** 派生引用形（记录类型＋id＋版本；版本取初始类型版本 1.0.0——§十五-4） */
export function chainRef(recordType: string, recordId: string): DraftRecordRef {
  return { refType: recordType, refId: recordId, refVersion: '1.0.0' }
}

/** 决定面提取（决定型 payload 必带；缺＝调用方 bug，直接拒写） */
function faceOf(payload: { readonly decision_face?: { readonly decided_by: string; readonly effective_time?: string | undefined; readonly effective_state: string } }): {
  readonly decidedBy: string
  readonly effectiveFrom: string | undefined
} | undefined {
  const face = payload.decision_face
  if (face === undefined) return undefined
  return { decidedBy: face.decided_by, effectiveFrom: face.effective_time }
}

/** 草案公共骨架（recordId/producedAt/幂等/证明边界；payload 原样） */
function draftOf(args: {
  readonly recordType: WorkChainRecordType
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly decidedBy: string
  readonly effectiveFrom?: string
  readonly operationClass: string
  readonly proofBoundary: string
  readonly payload: unknown
}): RecordDraft {
  const producedAt = isoAt(args.at)
  return {
    recordType: args.recordType,
    recordId: chainRecordId(args.company, args.ticket, args.attempt, args.recordType),
    producedAt,
    decidedBy: args.decidedBy,
    effectiveState: 'effective',
    effectiveFrom: args.effectiveFrom ?? producedAt,
    idempotencyKey: {
      recordType: args.recordType,
      subjectId: args.ticket,
      operationClass: args.operationClass,
      requesterSequence: `${args.attempt}`,
    },
    proofBoundary: args.proofBoundary,
    payload: args.payload,
  }
}

// —— §1 REC-WORK-02 受理结论（决定型；authority_ref 与决定面必填） ——

export function intakeDecisionDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly payload: IntakeDecisionPayload
}): DraftOutcome {
  const face = faceOf(args.payload)
  if (face === undefined) {
    return { ok: false, recordType: 'REC-WORK-02', code: 'record-prereq-missing', reason: '受理结论缺决定面（§0.3-2 封闭清单成员）——不得无决定面落库' }
  }
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-02',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: face.decidedBy,
      ...(face.effectiveFrom !== undefined ? { effectiveFrom: face.effectiveFrom } : {}),
      operationClass: 'intake-decision',
      proofBoundary: '本记录证明：受理结论已按 REC-WORK-02 登记（结论/主类型/范围/条件/异议位置/决定面）；不证明开工五门已过（WORK-04）与验收结论（WORK-09）。',
      payload: args.payload,
    }),
  }
}

// —— §2 REC-WORK-07 效果级判定（决定型；合同的风险分类输入——必须先于 WORK-03） ——

export function effectLevelDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly payload: EffectLevelPayload
}): DraftOutcome {
  const face = faceOf(args.payload)
  if (face === undefined) {
    return { ok: false, recordType: 'REC-WORK-07', code: 'record-prereq-missing', reason: '效果级判定缺决定面（§0.3-2 封闭清单成员）——不得无决定面落库' }
  }
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-07',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: face.decidedBy,
      ...(face.effectiveFrom !== undefined ? { effectiveFrom: face.effectiveFrom } : {}),
      operationClass: 'effect-level',
      proofBoundary: '本记录证明：效果级判定已按 REC-WORK-07 登记（级/可逆性/触及权利/分类者/依据/争议/程序口径/决定面）；不证明交付质量与验收结论。',
      payload: args.payload,
    }),
  }
}

// —— §3 REC-WORK-03 任务合同（请求型侧；risk_classification_ref 必引 REC-WORK-07） ——

export function workContractDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly decidedBy: string
  readonly payload: WorkContractPayload
}): DraftOutcome {
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-03',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: args.decidedBy,
      operationClass: 'contract',
      proofBoundary: '本记录证明：任务合同五要件与责任位置已登记（承诺/验收口径/期限/四责任位置/风险分类引用）；不证明开工判断（WORK-04）已完成，不证明合同相对方已接受。',
      payload: args.payload,
    }),
  }
}

// —— §4 REC-WORK-05 执行计划锁（只回答「用哪一套、占多少」；不产生门结论） ——

export function planLockDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly decidedBy: string
  readonly payload: PlanLockPayload
}): DraftOutcome {
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-05',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: args.decidedBy,
      operationClass: 'plan-lock',
      proofBoundary: '本记录证明：本次执行所用定义/配置/资格/能力/资源预留已锁定（版本与摘要）；不证明五门结论（WORK-04），不证明资源实际消耗（收割批次记实际用量）。',
      payload: args.payload,
    }),
  }
}

// —— §5 REC-WORK-04 开工判断（决定型；五门各一＋计划锁读序） ——

export function startDecisionDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly payload: StartDecisionPayload
}): DraftOutcome {
  const face = faceOf(args.payload)
  if (face === undefined) {
    return { ok: false, recordType: 'REC-WORK-04', code: 'record-prereq-missing', reason: '开工判断缺决定面（§0.3-2 封闭清单成员）——不得无决定面落库' }
  }
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-04',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: face.decidedBy,
      ...(face.effectiveFrom !== undefined ? { effectiveFrom: face.effectiveFrom } : {}),
      operationClass: 'start-decision',
      proofBoundary: '本记录证明：开工五门逐门结论与三值聚合已按 REC-WORK-04 登记（判据/材料/判者/资源基线/决定面）；不证明执行结果，不证明验收（WORK-09）。',
      payload: args.payload,
    }),
  }
}

// —— §6 REC-EVD-03 证据包（八要素齐备或合法缺项；自检恒为交付方自述） ——

export function evidencePackageDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  readonly payload: EvidencePackagePayload
}): DraftOutcome {
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-EVD-03',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: args.actor,
      operationClass: 'evidence-package',
      proofBoundary: '本记录证明：交付方证据包已登记（八要素逐项在场/缺项理由、自检清单与结论、自评、未决项、异议）；不证独立充分（自检不构成独立验收——§六）。',
      payload: args.payload,
    }),
  }
}

// —— §7 REC-WORK-08 完成判据（完成≠验收≠结清） ——

export function completionRecordDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  readonly payload: CompletionRecordPayload
}): DraftOutcome {
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-08',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: args.actor,
      operationClass: 'completion',
      proofBoundary: '本记录证明：完成判据按效果级逐项登记（要素三态/采集者独立性/缺口/证明边界）；不证明验收通过（WORK-09），不证明价值（EVD-04）。',
      payload: args.payload,
    }),
  }
}

// —— §8 REC-WORK-09 验收（决定型；四值；验者≠交付者） ——

export function workAcceptanceDraft(args: {
  readonly company: string
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly payload: WorkAcceptancePayload
}): DraftOutcome {
  const face = faceOf(args.payload)
  if (face === undefined) {
    return { ok: false, recordType: 'REC-WORK-09', code: 'record-prereq-missing', reason: '验收记录缺决定面（§0.3-2 封闭清单成员）——不得无决定面落库' }
  }
  return {
    ok: true,
    draft: draftOf({
      recordType: 'REC-WORK-09',
      company: args.company,
      ticket: args.ticket,
      attempt: args.attempt,
      at: args.at,
      decidedBy: face.decidedBy,
      ...(face.effectiveFrom !== undefined ? { effectiveFrom: face.effectiveFrom } : {}),
      operationClass: 'acceptance',
      proofBoundary: '本记录证明：验收结论四值、范围、判者独立性、证据引用与决定面已登记；不证明价值结论（EVD-04）与结清（WORK-12）。',
      payload: args.payload,
    }),
  }
}

// —— §9 决定点输入（事实口；写面不派生事实，只验「已落库」） ——

/** 迁移决定面输入（M-05/M-10/M-17 由相位决定点给出；记录只留痕） */
export interface ChainTransitionDecision {
  readonly decidedBy: string
  readonly authorityRef: DraftRecordRef
  readonly rationale: string
  readonly basisRefs: readonly DraftRecordRef[]
  readonly scopeJudged: { readonly judged: readonly string[]; readonly notJudged: readonly string[] }
  readonly dissentPosition: string
}

/** 派发前置链事实（相位 3 决定点注入；缺省＝不写，fail-closed） */
export interface StartChainFacts {
  readonly workType: WorkType
  readonly intentRef: DraftRecordRef
  readonly authorityRef: DraftRecordRef
  readonly intake: IntakeDecisionPayload
  readonly effect: EffectLevelPayload
  readonly contract: WorkContractPayload
  readonly plan: PlanLockPayload
  readonly start: StartDecisionPayload
  readonly transition: ChainTransitionDecision
}

/** 收割链事实（相位 4 收割决定点注入；WORK-09 归验收链） */
export interface HarvestChainFacts {
  readonly workType: WorkType
  readonly effectLevel: EffectLevelPayload['effect_level']
  readonly workRef: DraftRecordRef
  readonly effectRef: DraftRecordRef
  readonly evidencePackage: EvidencePackagePayload
  readonly completion: CompletionRecordPayload
  readonly transition: ChainTransitionDecision
}

/** 验收链事实（相位 4 收尾 QA 面注入） */
export interface AcceptanceChainFacts {
  readonly workType: WorkType
  readonly effectLevel: EffectLevelPayload['effect_level']
  readonly workRef: DraftRecordRef
  readonly effectRef: DraftRecordRef
  readonly independenceRef: DraftRecordRef
  readonly acceptance: WorkAcceptancePayload
  readonly transition: ChainTransitionDecision
}

/** 决定面 → 草案决定面输入（迁移缝用；effectiveFrom 由相位时点给） */
export function decisionFaceOf(decision: ChainTransitionDecision, at: number): DraftDecisionFaceInput {
  return {
    decidedBy: decision.decidedBy,
    authorityRef: decision.authorityRef,
    rationale: decision.rationale,
    basisRefs: decision.basisRefs,
    scopeJudged: decision.scopeJudged,
    dissentPosition: decision.dissentPosition,
    effectiveFrom: isoAt(at),
  }
}
