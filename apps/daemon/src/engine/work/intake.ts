/**
 * work/intake —— 开工门编排（REC-WORK-04 五门）与出工段续接判定（NEG-EMP-03 结构位）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-02（engine 拆分·工作与判定域；领土 `engine/work/`）；
 *   - docs/v2/14 §1.4（PORT-WORK `judgeReadiness`：「REC-WORK-04 五门各一；judge→role
 *     封闭映射」）＋§1.3（PORT-HR 出工段/重认面）；
 *   - docs/v2/11 §5.1 REC-WORK-04（开工判断：五门各一不得缺门重复；门级与整体结论共用
 *     同一组三值；**规则求值中止按该门不可开工聚合，不另造门级取值**；judge→role 封闭
 *     映射：权→授权者、能力→认定位置、资源→资源责任者、信息→信息持有者、禁止→禁止
 *     清单所有者；承接者只以申请者/记录者身份出现）；§5.2 REC-WORK-06/07（迁移前置）；
 *   - docs/v2/02 §五/§六＋§十一 E-3（NEG-EMP-03）：出工中换能力宣称「同一人不用重认」→
 *     实质变更重认门拒绝续跑——重认未完成前，续接只能走「新出工段/重判五门」路径；
 *   - docs/v2/07 §三 EXEC-04（恢复三层不得混同：续跑同一会话 ≠ 恢复同一出工段）；
 *   - docs/v2/04 §四（五门语义与三值；缺门/未知≠通过）——**判定本体在 core
 *     `work-readiness.ts` / `rule-engine.ts`（MIG-03 / IMPL-03-07），本件零判定复制**。
 *
 * 本件三面（全部纯编排/接线，engine.ts 只留相位缝与拍作用域闭包）：
 *   1. `decideWorkCandidate` —— 开工门输入装配（三闸/人闸/断路/批示站立快照 → core
 *      `decide`）：判定语义仍在 core；本件只把引擎拍内可观测值按 decide 入参契约装齐。
 *   2. `judgeStartGates` —— PORT-WORK `judgeReadiness` 的 daemon 侧编排腿：请求形状校验
 *      ＋委托 core 五门三值判定＋gate→role 封闭映射落值（端口消费方＝网关/studio-tools
 *      装配，MIG-06-04/07）。
 *   3. `evaluateGateRule` —— 规则两阶段求值接线（v2/10 §六 RULE-01..08）：typecheck 不过
 *      **不进入求值**；求值四值（true/false/unknown/refused）按 REC-WORK-04 聚合为门级
 *      三值——中止（refused/静态错）落 `fail`，不新造「正侧」取值。
 *
 * 纪律：本件零 IO、零时钟读取（时点经入参）；不持引擎状态；不复制 core 判定与门序。
 */
import type { InvokeIntent, IssueRecord, TicketId } from '@studio-next/contract'
import type {
  Action,
  BreakerSnapshot,
  ConcurrencyLimits,
  DecisionInput,
  Diagnostic,
  EvalOutcome,
  EvaluateOptions,
  FlowTable,
  KnownRuleProfile,
  LaneLeaseState,
  PersonGateState,
  StateFlow,
  WorkCondition,
  WorkGateId,
  WorkGateJudgment,
  WorkGateVerdict,
  WorkReadinessInput,
  WorkReadinessValue,
} from '@studio-next/core'
import { decide, evaluateRule, flowAnchors, judgeWorkReadiness, typecheckRuleProfile } from '@studio-next/core'
import type { DirectiveVerb } from '../directive/parse.ts'
import { reboundSuppressed } from '../directive/wire.ts'
import type { WorkIntentCandidate } from './intent.ts'

// ————————————————————————— 一、开工门输入装配（core decide 的 daemon 侧缝） —————————————————————————

/**
 * 开工门快照宿主（engine tick 作用域构造一次；全部为闭包读，不持状态副本）。
 * 闸面语义（断路>泳道>人>每拍>在途）与判定顺序在 core `decide.ts`——本件不重复。
 */
export interface WorkCandidateHost {
  /** 拍首镜像取（issues.list 对账产物） */
  readonly issueOf: (ticket: TicketId) => IssueRecord | undefined
  /** 镜像缺位时平台补取（失败＝undefined——派发面 fail-closed 归 executeDispatch） */
  readonly fetchIssue: (ticket: TicketId) => Promise<IssueRecord | undefined>
  /** 流解析（T:<type> 优先→L<level> 回退；core 同函数，本件不另解析） */
  readonly flowOf: (issue: { type?: string; level?: number }) => StateFlow | undefined
  /** 泳道租约状态（core `LaneLeaseState`） */
  readonly laneLeaseOf: (lane: string) => LaneLeaseState
  /** 人解析（assignee→defaultPersonId 回退链在引擎侧） */
  readonly personIdOf: (issue: IssueRecord) => string | undefined
  /** 人闸快照（在工计数＝内存 Inflight＋本拍已排队派发；129-§6.2-R3） */
  readonly personGateOf: (personId: string | undefined) => PersonGateState | undefined
  /** 批示站立（本拍归一动词优先，否则事件索引派生；studio-dev-171） */
  readonly verbNowOf: (ticket: TicketId) => DirectiveVerb | null
  /** 制作人已批（config.autoApprove ∥ 批示站立=批准；D4 清偿点） */
  readonly approvedNow: (verbNow: DirectiveVerb | null) => boolean
  /** 已消费意图键集（事件派生，22-§三.2） */
  readonly seenKeys: readonly string[]
  /** 该单在工消费键（flow 未登记流=null；看门狗喂数豁免面见引擎注） */
  readonly ownSeenKeyOf: (ticket: TicketId, issue: IssueRecord) => string | null
  /** 断路快照（连击/阈值/熔断时刻/冷却窗；DEV-46 半开） */
  readonly breakerOf: (ticket: TicketId) => BreakerSnapshot
  /** 镜像缺位明报面（tick errors；不抛——下拍再看） */
  readonly onUnavailable: (ticket: TicketId) => void
  readonly defaultLane: string
  readonly limits: ConcurrencyLimits
  /** 流表热换消费（缺省＝core 内置表） */
  readonly flows?: FlowTable
  /** 在途计数＝已落工位＋本拍已排队派发（两段式「先决后执」拍内即时生效） */
  readonly inflightCount: () => number
  readonly tickActionCount: () => number
  readonly now: () => number
  readonly stallAfterMs: number
}

/** 一张候选的开工决策（gate 快照＋core decide 产物＋抑制面；队列/占用结算归引擎） */
export interface WorkDecision {
  readonly ticket: TicketId
  readonly issue: IssueRecord
  readonly lane: string
  readonly intent: InvokeIntent
  readonly personId?: string
  readonly verbNow?: DirectiveVerb
  readonly intentKey: string
  readonly action: Action
  /** 回弹抑制（打回/拆单/搁置站立期不自动呈批——engine 落 WAIT_APPROVAL 观测码） */
  readonly reboundSuppressed: boolean
}

/**
 * 单候选开工决策（原 engine 相位 2 state-diff 体内联装配段——语义逐字保持）：
 *   镜像取（缺位补取）→ 泳道/人闸/批示/断路器快照 → core `decide` → 抑制面判定。
 * 状态机与闸序判定在 core；本件只做入参装配与「单据取不到」的拍内明报跳过。
 */
export async function decideWorkCandidate(
  host: WorkCandidateHost,
  candidate: WorkIntentCandidate,
): Promise<WorkDecision | undefined> {
  const ticket = candidate.ticket
  const issue = host.issueOf(ticket) ?? (await host.fetchIssue(ticket))
  if (issue === undefined) {
    host.onUnavailable(ticket)
    return undefined
  }
  const lane = issue.lane ?? host.defaultLane
  const intent = candidate.intent
  // 看门狗喂数豁免（DEV-44）：在工（已派发态）单的本单消费键不注入 seenIntentKeys——
  // dedup 防 replay 不防健康探针；镜像键被上一誓消费后（咬合前在工期）STALL_SILENT 会被
  // dedup 挡成 DEDUP_NOOP，看门狗对第二誓失明。豁免只影响在工单 noop 决策码面
  // （DEDUP_NOOP→EVIDENCE_PENDING/STALL_SILENT）；重派安全由状态机守。
  const flow = host.flowOf(issue)
  const dispatched = flow !== undefined ? flowAnchors(flow).dispatched : undefined
  const inWork = dispatched !== undefined && issue.state === dispatched
  const ownSeenKey = host.ownSeenKeyOf(ticket, issue)
  const seenIntentKeys = inWork && ownSeenKey !== null ? host.seenKeys.filter((key) => key !== ownSeenKey) : host.seenKeys
  const personId = host.personIdOf(issue)
  const personGate = host.personGateOf(personId)
  const verbNow = host.verbNowOf(ticket)
  const input: DecisionInput = {
    issue,
    laneLease: host.laneLeaseOf(lane),
    ...(personGate !== undefined ? { personGate } : {}),
    inflightCount: host.inflightCount(),
    tickActionCount: host.tickActionCount(),
    limits: host.limits,
    intent,
    seenIntentKeys,
    breaker: host.breakerOf(ticket),
    ...(host.approvedNow(verbNow) ? { approved: true } : {}),
    ...(host.flows !== undefined ? { flows: host.flows } : {}),
    now: host.now(),
    stallAfterMs: host.stallAfterMs,
  }
  const out = decide(input)
  return {
    ticket,
    issue,
    lane,
    intent,
    ...(personId !== undefined ? { personId } : {}),
    ...(verbNow !== null ? { verbNow } : {}),
    intentKey: out.intentKey,
    action: out.action,
    reboundSuppressed: reboundSuppressed(verbNow, out.action.type),
  }
}

// ————————————————————————— 二、开工五门编排（PORT-WORK judgeReadiness 编排腿） —————————————————————————

/**
 * gate→role 封闭映射（v2/11 REC-WORK-04 落值；值集五门一一对应，不得新增门）。
 * 「承接者只以申请者/记录者身份出现」——acceptance 门的判定位置不得由承接者自判
 * （本表只声明角色面；判定/自判豁免属决定面字段，归记录载体的消费方）。
 */
export const WORK_GATE_JUDGE_ROLES: Readonly<Record<WorkGateId, string>> = {
  authority: '授权者',
  capability: '认定位置',
  prohibition: '禁止清单所有者',
  resource: '资源责任者',
  acceptance: '受理/验收位置（承接者不得自判）',
}

/** 开工判断请求（PORT-WORK judgeReadiness 入参；`gates`＝五门各自结论证据） */
export interface StartGateRequest {
  /** 工作对象引用（ID＋版本——v2/11 §〇.4「禁当前最新」） */
  readonly workRef: string
  readonly contractRef?: string
  readonly gates: WorkReadinessInput
}

/** 开工判断结果（三值＋逐门结论＋缺门清单＋条件＋留痕＋角色映射） */
export interface StartGateJudgment {
  readonly workRef: string
  readonly contractRef?: string
  readonly verdict: WorkReadinessValue
  readonly gates: readonly WorkGateJudgment[]
  readonly missingGates: readonly WorkGateId[]
  readonly conditions: readonly WorkCondition[]
  readonly evidenceRefs: readonly string[]
  readonly judgeRoles: Readonly<Record<WorkGateId, string>>
}

/**
 * 开工五门判断（编排腿）：**判定本体＝core `judgeWorkReadiness`**（缺门/未知≠通过；
 * 任一门不可开工→整体不可开工；附条件三件缺一→不可开工）。本件只补端口形状：
 * 工作引用、契约引用与 gate→role 映射——不重算、不改写 core 的三值聚合。
 */
export function judgeStartGates(request: StartGateRequest): StartGateJudgment {
  const verdict = judgeWorkReadiness(request.gates)
  return {
    workRef: request.workRef,
    ...(request.contractRef !== undefined ? { contractRef: request.contractRef } : {}),
    verdict: verdict.verdict,
    gates: verdict.gates,
    missingGates: verdict.missingGates,
    conditions: verdict.conditions,
    evidenceRefs: verdict.evidenceRefs,
    judgeRoles: WORK_GATE_JUDGE_ROLES,
  }
}

// ————————————————————————— 三、规则求值→门级三值（REC-WORK-04 中止聚合） —————————————————————————

/** 规则求值请求（门级规则：档＋规则＋输入；已知档表可选——RULE-01 撤回档拒收） */
export interface GateRuleRequest {
  readonly profile: unknown
  readonly rule: unknown
  readonly inputs: unknown
  readonly known?: readonly KnownRuleProfile[]
  readonly options?: EvaluateOptions
}

/** 规则求值→门级结论（outcome 四值不合并；中止统一聚合为门级 `fail`） */
export interface GateRuleEvaluation {
  readonly verdict: WorkGateVerdict
  /** 求值四值；静态面不过记 `typecheck-failed`（不冒充 false） */
  readonly outcome: EvalOutcome | 'typecheck-failed'
  readonly diagnostics: readonly Diagnostic[]
  /** 求值中止（静态错/refused）——门级按不可开工聚合，不新造取值 */
  readonly halted: boolean
}

/**
 * 规则两阶段接线（v2/10 §六；v2/11 REC-WORK-04「规则求值中止按该门不可开工聚合」）：
 *   ① `typecheckRuleProfile` 静态面不过 → **不进求值**，门级 `fail`（三值共用，不造
 *     「规则错」第四值；诊断原样返回供记录/观测）；
 *   ② 过检 → `evaluateRule`：true→pass；false→fail；unknown→unknown（输入不足≠通过）；
 *     refused（求值中止）→fail＋halted。
 */
export function evaluateGateRule(request: GateRuleRequest): GateRuleEvaluation {
  const checked = typecheckRuleProfile({
    profile: request.profile,
    rule: request.rule,
    ...(request.known !== undefined ? { known: request.known } : {}),
  })
  if (!checked.ok) {
    return { verdict: 'fail', outcome: 'typecheck-failed', diagnostics: checked.diagnostics, halted: true }
  }
  const evaluation = evaluateRule(checked.call, request.inputs, request.options ?? {})
  switch (evaluation.outcome) {
    case 'true':
      return { verdict: 'pass', outcome: 'true', diagnostics: evaluation.diagnostics, halted: false }
    case 'false':
      return { verdict: 'fail', outcome: 'false', diagnostics: evaluation.diagnostics, halted: false }
    case 'unknown':
      return { verdict: 'unknown', outcome: 'unknown', diagnostics: evaluation.diagnostics, halted: false }
    case 'refused':
      return { verdict: 'fail', outcome: 'refused', diagnostics: evaluation.diagnostics, halted: true }
  }
}

// ————————————————————————— 四、出工段续接判定（NEG-EMP-03 结构位） —————————————————————————

/** 本段已锁定的执行配置（REC-WORK-05 计划锁的消费面快照；只读） */
export interface LockedExecutionConfig {
  readonly executor: string
  /** 能力档案/绑定档案摘要（v2/12；缺省＝无可比面——不得据此宣称未变更） */
  readonly capabilityDigest?: string
}

/** 续跑/接管主张（EXEC-04：同执行器同会话＝技术续跑；换家/换配置＝新段或重认） */
export interface RequestedContinuation {
  readonly executor: string
  readonly sessionId?: string
  readonly capabilityDigest?: string
}

/** 出工段续接判定请求 */
export interface SegmentContinuationRequest {
  readonly locked: LockedExecutionConfig
  readonly requested: RequestedContinuation
  /** 重认结论引用（REC-CAP-02；实质变更时必填——出工段重认门） */
  readonly requalificationRef?: string
  /** 调用方按 v2/02 §五/§六 判据得出的「是否实质变更」（能力/配置/绑定） */
  readonly substantive: boolean
}

/** 续接模式：continue=同一出工段续跑；requalification_required=实质变更拒绝续跑（先重认） */
export type ContinuationMode = 'continue' | 'requalification_required'

/** 出工段续接判定结果（allowed 只回答「能否续跑同一出工段」，不回答「能否派新段」） */
export interface SegmentContinuationVerdict {
  readonly mode: ContinuationMode
  readonly allowed: boolean
  readonly reason: string
  readonly substantive: boolean
  readonly requalificationRef?: string
}

/**
 * 出工段续接判定（NEG-EMP-03 的判负面）：出工中换能力/换执行配置＝**实质变更**——
 * 「同一人/同一单」不构成免重认理由；重认结论（REC-CAP-02 引用）缺位时**拒绝续跑**
 * （同一出工段 continue 不成立）。观察事实不构成判定：
 *   - executor 变更 / capabilityDigest 变更 / 调用方声明 substantive —— 任一成立即实质变更；
 *   - capabilityDigest 两侧都缺省＝无可比面（只按执行体与调用方声明判）；**只有一侧给出
 *     ＝比较基座不成立（未知）**——按 fail-closed 视同实质变更（未知≠未变更，不得放行）；
 *   - 重认到场（非空引用）后允许续跑；合法出口之外的行为（拒绝后派新段/重判五门）由
 *     调用方决定——本件只给「能否续接本段」的封闭结论。
 */
export function judgeSegmentContinuation(request: SegmentContinuationRequest): SegmentContinuationVerdict {
  const executorChanged = request.requested.executor !== request.locked.executor
  const lockedDigest = request.locked.capabilityDigest
  const requestedDigest = request.requested.capabilityDigest
  const comparable = lockedDigest !== undefined && requestedDigest !== undefined
  const capabilityUnverifiable = (lockedDigest === undefined) !== (requestedDigest === undefined)
  const capabilityChanged = comparable && lockedDigest !== requestedDigest
  const substantive = request.substantive || executorChanged || capabilityChanged || capabilityUnverifiable
  if (!substantive) {
    return { mode: 'continue', allowed: true, reason: 'same-execution-config', substantive }
  }
  if (request.requalificationRef !== undefined && request.requalificationRef.trim() !== '') {
    return {
      mode: 'continue',
      allowed: true,
      reason: 'requalified',
      substantive,
      requalificationRef: request.requalificationRef,
    }
  }
  return {
    mode: 'requalification_required',
    allowed: false,
    reason: 'substantive-change-requires-requalification',
    substantive,
  }
}
