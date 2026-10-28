/**
 * work-readiness —— 开工五门纯判定与三值结论（v2/04 §四；ENU-12）
 *
 * 依据（MIG-03 / IMPL-03-07；G-PORT-WORK 的纯求值唯一件——v2/14 §二 WORK 行）：
 *   - v2/04 §四「开工五门与重判」：门＝权（授权目的/范围/条件/期限内、无禁配）／能力
 *     （资格与能力在有效期内）／资源（预算/时间/注意力/额度足以支撑到下一复审点；
 *     **额度或占用不可知即不判充足——unknown≠充足、缺省≠0**）／信息（必需输入可得、
 *     时效内、知悉范围允许）／禁止（不落入明确禁止；未覆盖按保留事项转呈，决定前只做
 *     保全与升级）；缺项处置与「不得冒充」（能力不补权、权不补能力、承诺不补资源、
 *     猜测不补信息、收益/紧急/能力具备不解除禁止）；
 *   - 同节：开工判断结论三值（ENU-12：`ready` 可开工｜`conditional_ready` 附条件开工
 *     （条件、责任者、到期处置；到期未满足自动进入暂停——**不是继续**）｜`not_ready`
 *     不可开工）；开工判断时点＝资源消耗与责任起算时点；依据留痕；
 *   - 同节「重判触发」：范围变化、资源变化、能力退化或更换、**承接者或执行配置变更**、
 *     新禁止出现、关键信息被证伪、外部条件改变、效果级升级；
 *   - v2/04 §二/§五（受理五取值 ENU-08；验收口径为空不得开工、责任位置任一空缺不得开工）；
 *   - v2/01 §2.2 三类事项与「清单外默认保留」（禁止门未覆盖＝保留，不得开工）。
 *
 * 纪律：
 *   - **缺门＝不可开工**：未给结论的门不是 pass，也不是「暂时放行」——不 fail-open；
 *   - 未知不等于充足/通过（`unknown` 记 fail 方向，理由逐门指明）；
 *   - 零 IO：时点由调用方以 epoch 毫秒传入；不读时钟/环境/文件/网络。
 */

import type { PolicyState } from './spec.ts'

/** 门 id（本实现五门；判据面回 v2/04 §四，不重述门语义） */
export const WORK_GATE_IDS = ['authority', 'capability', 'prohibition', 'resource', 'acceptance'] as const

/** 门 id */
export type WorkGateId = (typeof WORK_GATE_IDS)[number]

/** 单门判定（pass/conditional/fail/unknown；unknown 不等于 pass） */
export type WorkGateVerdict = 'pass' | 'conditional' | 'fail' | 'unknown'

/** 开工判断三值（值集唯一主表 v2/09 ENU-12） */
export const WORK_READINESS_VERDICTS = ['ready', 'conditional_ready', 'not_ready'] as const

/** 开工判断三值（ENU-12；缺门与未知一律落 `not_ready`） */
export type WorkReadinessValue = (typeof WORK_READINESS_VERDICTS)[number]

/** 受理五取值（值集唯一主表 v2/09 ENU-08） */
export type IntakeValue = 'accepted' | 'conditional_accepted' | 'hold' | 'rejected' | 'referred'

/** 附条件（条件、责任者、到期缺一不可；到期处置＝自动暂停，不是继续） */
export interface WorkCondition {
  readonly description: string
  readonly ownerRef: string
  readonly dueAtMs: number
}

/** 权源门输入（消费 authority 判定面：四态之一＋留痕引用） */
export interface AuthorityGateInput {
  readonly state: PolicyState
  readonly evidenceRef: string
  readonly condition?: WorkCondition
}

/** 能力门输入（资格认定与有效期；null 有效期＝未知≠有效） */
export interface CapabilityGateInput {
  readonly qualificationRef: string
  readonly evaluatedAtMs: number
  readonly validUntilMs: number | null
}

/** 禁止门输入（ENU-31 的消费面：明确禁止／未覆盖／明确不禁止） */
export interface ProhibitionGateInput {
  readonly state: 'prohibited' | 'uncovered' | 'clear'
  readonly evidenceRef: string
}

/** 资源门输入（unknown≠充足；额度或占用不可知即不判充足） */
export interface ResourceGateInput {
  readonly state: 'sufficient' | 'insufficient' | 'unknown'
  readonly evidenceRef: string
  readonly nextReviewAtMs: number | null
}

/** 接受门输入（受理结论＋验收口径＋责任位置；口径为空/位置空缺不得开工） */
export interface AcceptanceGateInput {
  readonly intake: IntakeValue
  readonly acceptanceCriteria: readonly string[]
  readonly verificationPositionRef?: string
  readonly condition?: WorkCondition
}

/** 开工判断输入（五门各自的结论证据；缺门即不判可开工） */
export interface WorkReadinessInput {
  readonly authority?: AuthorityGateInput
  readonly capability?: CapabilityGateInput
  readonly prohibition?: ProhibitionGateInput
  readonly resource?: ResourceGateInput
  readonly acceptance?: AcceptanceGateInput
}

/** 逐门判定结果（reason 是机器可读的原因串；门级判据回 v2/04 §四） */
export interface WorkGateJudgment {
  readonly gate: WorkGateId
  readonly verdict: WorkGateVerdict
  readonly reason: string
}

/** 开工判断结果（三值＋逐门结论＋缺门清单＋条件＋留痕） */
export interface WorkReadinessVerdict {
  readonly verdict: WorkReadinessValue
  readonly gates: readonly WorkGateJudgment[]
  readonly missingGates: readonly WorkGateId[]
  readonly conditions: readonly WorkCondition[]
  readonly evidenceRefs: readonly string[]
}

/** 附条件三要素齐备（缺一＝不得附条件开工，只能不可开工） */
export function isValidCondition(condition: WorkCondition | undefined): condition is WorkCondition {
  return (
    condition !== undefined &&
    condition.description.trim() !== '' &&
    condition.ownerRef.trim() !== '' &&
    Number.isFinite(condition.dueAtMs)
  )
}

function judgeAuthority(input: AuthorityGateInput): WorkGateJudgment {
  switch (input.state) {
    case 'permitted':
      return { gate: 'authority', verdict: 'pass', reason: 'authority-permitted' }
    case 'prohibited':
      return { gate: 'authority', verdict: 'fail', reason: 'authority-prohibited' }
    case 'reserved':
      // 保留事项须指定位置决定：附条件开工（条件三要素齐备）或不可开工
      return isValidCondition(input.condition)
        ? { gate: 'authority', verdict: 'conditional', reason: 'authority-reserved' }
        : { gate: 'authority', verdict: 'fail', reason: 'authority-reserved-undecided' }
    case 'uncovered':
      // 未覆盖≠允许（v2/01 §2.2 清单外默认保留）
      return { gate: 'authority', verdict: 'fail', reason: 'authority-uncovered' }
  }
}

function judgeCapability(input: CapabilityGateInput): WorkGateJudgment {
  if (input.validUntilMs === null || !Number.isFinite(input.validUntilMs)) {
    // 资格有效期不可知＝未证在有效期内（unknown≠通过）
    return { gate: 'capability', verdict: 'unknown', reason: 'capability-validity-unknown' }
  }
  if (input.evaluatedAtMs >= input.validUntilMs) {
    return { gate: 'capability', verdict: 'fail', reason: 'capability-expired' }
  }
  return { gate: 'capability', verdict: 'pass', reason: 'capability-valid' }
}

function judgeProhibition(input: ProhibitionGateInput): WorkGateJudgment {
  if (input.state === 'clear') return { gate: 'prohibition', verdict: 'pass', reason: 'prohibition-clear' }
  if (input.state === 'prohibited') return { gate: 'prohibition', verdict: 'fail', reason: 'prohibition-hit' }
  // 未覆盖按保留事项转呈，决定前只做保全与升级——不得开工
  return { gate: 'prohibition', verdict: 'fail', reason: 'prohibition-uncovered' }
}

function judgeResource(input: ResourceGateInput): WorkGateJudgment {
  if (input.state === 'sufficient') return { gate: 'resource', verdict: 'pass', reason: 'resource-sufficient' }
  if (input.state === 'insufficient') return { gate: 'resource', verdict: 'fail', reason: 'resource-insufficient' }
  // unknown≠充足、缺省≠0（v2/04 §四资源门）
  return { gate: 'resource', verdict: 'unknown', reason: 'resource-unknown' }
}

function judgeAcceptance(input: AcceptanceGateInput): WorkGateJudgment {
  if (input.intake === 'rejected' || input.intake === 'hold' || input.intake === 'referred') {
    return { gate: 'acceptance', verdict: 'fail', reason: `acceptance-${input.intake}` }
  }
  if (input.acceptanceCriteria.filter((line) => line.trim() !== '').length === 0) {
    // 验收口径为空不得开工（v2/04 §三/§四）
    return { gate: 'acceptance', verdict: 'fail', reason: 'acceptance-criteria-empty' }
  }
  if (input.verificationPositionRef === undefined || input.verificationPositionRef.trim() === '') {
    // 责任位置任一空缺不得开工；不得以「团队/部门/公司」代名
    return { gate: 'acceptance', verdict: 'fail', reason: 'acceptance-position-missing' }
  }
  if (input.intake === 'conditional_accepted') {
    return isValidCondition(input.condition)
      ? { gate: 'acceptance', verdict: 'conditional', reason: 'acceptance-conditional' }
      : { gate: 'acceptance', verdict: 'fail', reason: 'acceptance-condition-missing' }
  }
  return { gate: 'acceptance', verdict: 'pass', reason: 'acceptance-accepted' }
}

/**
 * 开工五门判定（纯函数）：
 *   - 缺任一门＝`not_ready`（missingGates 逐门列出；缺门不是 pass）；
 *   - 任一门 fail/unknown＝`not_ready`（unknown 不折算为通过）；
 *   - 有 conditional 且无 fail/unknown/缺门＝`conditional_ready`（条件三要素齐备，
 *     到期未满足自动暂停——规则型迁移由守护计时者承担，本件只给结论）；
 *   - 全 pass＝`ready`。
 */
export function judgeWorkReadiness(input: WorkReadinessInput): WorkReadinessVerdict {
  const gates: WorkGateJudgment[] = []
  const missingGates: WorkGateId[] = []
  const conditions: WorkCondition[] = []
  const evidenceRefs: string[] = []
  if (input.authority === undefined) missingGates.push('authority')
  else {
    gates.push(judgeAuthority(input.authority))
    evidenceRefs.push(input.authority.evidenceRef)
    if (isValidCondition(input.authority.condition)) conditions.push(input.authority.condition)
  }
  if (input.capability === undefined) missingGates.push('capability')
  else {
    gates.push(judgeCapability(input.capability))
    evidenceRefs.push(input.capability.qualificationRef)
  }
  if (input.prohibition === undefined) missingGates.push('prohibition')
  else {
    gates.push(judgeProhibition(input.prohibition))
    evidenceRefs.push(input.prohibition.evidenceRef)
  }
  if (input.resource === undefined) missingGates.push('resource')
  else {
    gates.push(judgeResource(input.resource))
    evidenceRefs.push(input.resource.evidenceRef)
  }
  if (input.acceptance === undefined) missingGates.push('acceptance')
  else {
    gates.push(judgeAcceptance(input.acceptance))
    if (input.acceptance.verificationPositionRef !== undefined) evidenceRefs.push(input.acceptance.verificationPositionRef)
    if (isValidCondition(input.acceptance.condition)) conditions.push(input.acceptance.condition)
  }
  const blocking = gates.some((gate) => gate.verdict === 'fail' || gate.verdict === 'unknown')
  const conditional = gates.some((gate) => gate.verdict === 'conditional')
  let verdict: WorkReadinessValue
  if (missingGates.length > 0 || blocking) verdict = 'not_ready'
  else if (conditional) verdict = 'conditional_ready'
  else verdict = 'ready'
  return { verdict, gates, missingGates, conditions, evidenceRefs }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、重判触发（v2/04 §四；开工判断不是一次性仪式）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 重判触发类别（v2/04 §四逐条：范围变化、资源变化、能力退化或更换、承接者或执行配置
 * 变更、新禁止出现、关键信息被证伪、外部条件改变、效果级升级）。
 */
export const WORK_REJUDGE_TRIGGERS = [
  'scope_change',
  'resource_change',
  'capability_degraded',
  'capability_replaced',
  'holder_change',
  'execution_config_change',
  'new_prohibition',
  'information_falsified',
  'external_condition_change',
  'effect_level_upgrade',
] as const

/** 重判触发类别 */
export type WorkRejudgeTrigger = (typeof WORK_REJUDGE_TRIGGERS)[number]

/**
 * 是否须重判：落在十类触发内＝true；**未知变化类别也返回 true**（fail-closed：
 * 变化不符预期时按须重判处理，不得默认沿用旧开工结论）。
 */
export function requiresWorkRejudgment(changeKind: string): boolean {
  // 十类触发逐条须重判；未知类别同样须重判（fail-closed）；只有「无变化」不重判
  return changeKind !== 'none'
}
