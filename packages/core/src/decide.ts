/**
 * decide —— 主循环 state-diff 相位决策纯函数（docs/17-§2，需求 F1-03）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§2 主循环七相位：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。
 *     本函数即 state-diff 相位：输入镜像态与闸况，输出**单个**结构化 Action——
 *     同一 tick 内一单至多一动作由调用方（每单调一次 decide）结构性保证。
 *   - docs/17-§2 并发三闸：泳道租约（TTL+续租+死主回收）/ 每拍上限 / 全局在途上限，
 *     超限=hold 带理由码，触顶顺延不丢（F1-05）。
 *   - docs/22-§三.2 意图幂等：同 (source, kind, company, ticket??dedupKey) 重复意图 → noop，
 *     100 个重复意图只唤起一次（已处理键集合由 daemon 落账后回灌入参）。
 *   - docs/17-§6 末 / F1-10 断路器：连击达阈值=停重派（本函数只压制 dispatch），
 *     open_bug 动作由 breaker.onWorkerError 在熔断瞬间产生（src/breaker.ts）。
 *
 * Action 语义与七相位的对应（每动作附理由码 decision code，供落账与 golden trace）：
 *   - dispatch        派发相位：launch worker + 平台迁入「已派发」（F1-03：由状态/等级/租约唯一决定）
 *   - submit_approval 派发前置：呈批迁移（新单→待批 / 复验通过→待批，L1/L2）
 *   - hold            三闸未过/断路开/意图异常——留待下拍（顺延不丢）
 *   - wait_evidence   已派发在工，等收割四要件（终态事件+输出非空+REPORT 落盘+闸门 exit=0，17-§6）
 *   - collect         收割相位：证据就绪，收 REPORT/闸门/账目
 *   - merge           合并相位：复验通过（或交付批已准），持租约切本单分支后合并交付
 *   - recycle         回收相位：已交付——释放泳道租约/归档工位
 *   - open_bug        断路熔断瞬间的自动开 bug 单（breaker 产生，共享本 Action 联合）
 *   - stall_alarm     心跳相位：在工单静默超阈值（STALL 前兆），看门狗/告警介入
 *   - noop            本拍无机器动作：去重命中/待批等人/未知态/未知流/自定义中间态
 *
 * 纯函数纪律：同输入恒同输出；零 IO；时间一律入参（now），禁 Date.now/random。
 *
 * 拟升 contract（docs/25 端口面）：DecisionInput / DecisionOutput / Action / DecisionCode
 * ——本刀放 core 内（契约包未冻结此协议），升包走进化管线（F3-01），格式即契约雏形。
 *
 * 拟稿待批点（汇报后走批示流）：
 *   - submit_approval 为第十个动作（任务书列了九个"至少"）：docs 未冻结「新单→待批」由谁执行，
 *     本刀定为 daemon 呈批迁移（经网关）。
 *   - approved 输入（制作人已批信号经网关动作词落平台，daemon 归一后传入）：docs 未冻结
 *     批准信号的落点，暂以布尔入参表达。
 *   - verifiedEvidence 输入：L2 主干「待批」出现两次（docs/18-§2.1 字面模板），同一状态名下
 *     前批（→已派发）与交付批（→已交付）无法从 (state,level,type,lease) 区分——本刀以
 *     daemon 归一的「本单已有复验通过证据」布尔消歧（true=交付批→merge；缺省=派发轨道）。
 *     此为文档疑点已记录，不改文档（07 顺序铁律：停手改文档走批示流）。
 *   - stall 只盯「已派发」态（在工静默）；待批静默属人因节奏，不告警。
 */

import type { IssueRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import { DEFAULT_BREAKER_COOLDOWN_MS } from './breaker.ts'
import {
  DEFAULT_FLOW_TABLE,
  flowAnchors,
  flowStates,
  forwardStates,
  resolveTicketFlow,
  type FlowTable,
} from './flows.ts'

// ————————————————————————— 理由码（decision code）—————————————————————————

/**
 * 理由码全清单（落账 + golden trace 的稳定标识；冻结后禁改，升 contract 走进化管线）：
 *   DISPATCH               泳道空闲三闸全过，派发
 *   SUBMIT_APPROVAL        呈批迁移（新单→待批 / 复验通过→待批）
 *   HOLD_LANE_BUSY         泳道租约有主且未过期
 *   HOLD_TICK_LIMIT        本拍动作上限已满（顺延不丢）
 *   HOLD_INFLIGHT_LIMIT    全局在途上限已满（顺延不丢）
 *   HOLD_BREAKER_OPEN      断路器熔断且冷却窗未过，停重派（F1-10；DEV-46：窗过放半开试探）
 *   HOLD_INTENT_MALFORMED  意图缺 ticket 且缺 dedupKey（违反 docs/25-§3.4 契约）
 *   HOLD_INTENT_MISMATCH   意图单号与本单不符（调用方装配错误，防御性拦下）
 *   DEDUP_NOOP             幂等去重命中（docs/22-§三.2）
 *   WAIT_APPROVAL          待批态等制作人批示（L1 前置批 / L2 交付批）
 *   EVIDENCE_PENDING       已派发在工，等证据四要件
 *   EVIDENCE_READY         证据就绪，转收割
 *   MERGE_DUE              复验通过（/交付批已准），待合并
 *   LANE_RELEASE           已交付，回收租约与工位
 *   STALL_SILENT           在工单静默超阈值，停摆告警
 *   BREAKER_TRIPPED        断路熔断，自动开 bug 单（breaker 产生）
 *   BREAKER_RESET          成功信号复位断路器（breaker 产生，事件性码）
 *   NOOP_UNKNOWN_FLOW      等级未登记状态流（镜像数据质量，明报不动单）
 *   NOOP_UNKNOWN_STATE     状态不在流表状态集内（平台侧自定义态，daemon 不动）
 *   NOOP_IDLE              自定义中间态：本拍无机器动作
 */
export type DecisionCode =
  | 'DISPATCH'
  | 'SUBMIT_APPROVAL'
  | 'HOLD_LANE_BUSY'
  | 'HOLD_TICK_LIMIT'
  | 'HOLD_INFLIGHT_LIMIT'
  | 'HOLD_BREAKER_OPEN'
  | 'HOLD_INTENT_MALFORMED'
  | 'HOLD_INTENT_MISMATCH'
  | 'DEDUP_NOOP'
  | 'WAIT_APPROVAL'
  | 'EVIDENCE_PENDING'
  | 'EVIDENCE_READY'
  | 'MERGE_DUE'
  | 'LANE_RELEASE'
  | 'STALL_SILENT'
  | 'BREAKER_TRIPPED'
  | 'BREAKER_RESET'
  | 'NOOP_UNKNOWN_FLOW'
  | 'NOOP_UNKNOWN_STATE'
  | 'NOOP_IDLE'

// ————————————————————————— Action 联合（拟升 contract）—————————————————————————

interface ActionBase {
  /** 理由码：落账与 golden trace 的稳定标识 */
  code: DecisionCode
  /** 动作目标单（open_bug 为触发单，新 bug 单由 daemon 创建） */
  ticket: TicketId
}

export interface DispatchAction extends ActionBase {
  type: 'dispatch'
  code: 'DISPATCH'
  /** 平台目标态（锚点 dispatched） */
  toState: string
  /** 派发占用泳道（租约名不含 pid，docs/17-§2） */
  lane: string
  /**
   * 半开试探派发（DEV-46）：断路开且冷却窗已过时放行的试探誓——成功=复位
   * （onSuccess）、失败=回全开续冷却（trippedAt 刷新）。判据面见 breakerCooled；
   * 观测面=daemon 在 DISPATCH 事件 note 携 half-open-probe 锚（golden 判据只看
   * (type, code)，本字段不进冻结判据）。
   */
  breakerProbe?: true
}

export interface SubmitApprovalAction extends ActionBase {
  type: 'submit_approval'
  code: 'SUBMIT_APPROVAL'
  /** 平台目标态（锚点 approval） */
  toState: string
}

export interface HoldAction extends ActionBase {
  type: 'hold'
  code:
    | 'HOLD_LANE_BUSY'
    | 'HOLD_TICK_LIMIT'
    | 'HOLD_INFLIGHT_LIMIT'
    | 'HOLD_BREAKER_OPEN'
    | 'HOLD_INTENT_MALFORMED'
    | 'HOLD_INTENT_MISMATCH'
}

export interface WaitEvidenceAction extends ActionBase {
  type: 'wait_evidence'
  code: 'EVIDENCE_PENDING'
}

export interface CollectAction extends ActionBase {
  code: 'EVIDENCE_READY'
  type: 'collect'
}

export interface MergeAction extends ActionBase {
  type: 'merge'
  code: 'MERGE_DUE'
  /** 平台目标态（锚点 delivered） */
  toState: string
}

export interface RecycleAction extends ActionBase {
  type: 'recycle'
  code: 'LANE_RELEASE'
}

export interface OpenBugAction extends ActionBase {
  type: 'open_bug'
  code: 'BREAKER_TRIPPED'
  /** 触发熔断的错误签名（同(单号,签名)连击，docs/17-§6） */
  errorSignature: string
  /** 熔断时连击数（=阈值 N） */
  strikes: number
}

export interface StallAlarmAction extends ActionBase {
  type: 'stall_alarm'
  code: 'STALL_SILENT'
  /** 静默时长 ms（now - issue.updated） */
  silentMs: number
}

export interface NoopAction extends ActionBase {
  type: 'noop'
  code: 'DEDUP_NOOP' | 'WAIT_APPROVAL' | 'NOOP_UNKNOWN_FLOW' | 'NOOP_UNKNOWN_STATE' | 'NOOP_IDLE'
}

/** 结构化 Action 联合（拟升 contract；tick 聚合后落账，17-§2「tick 返回结构化 actions」） */
export type Action =
  | DispatchAction
  | SubmitApprovalAction
  | HoldAction
  | WaitEvidenceAction
  | CollectAction
  | MergeAction
  | RecycleAction
  | OpenBugAction
  | StallAlarmAction
  | NoopAction

export type ActionType = Action['type']

// ————————————————————————— 输入（拟升 contract）—————————————————————————

/** 泳道租约状态（并发三闸之一；docs/17-§2：TTL+续租+死主回收，锁名不含 pid） */
export interface LaneLeaseState {
  lane: string
  /** 当前持有人；null=无主可派 */
  holder: string | null
  /** 租约到期 epoch-ms；holder 非空且 now<expiresAt 才算有主（过期=死主，视同无主） */
  expiresAt?: number
}

/** 并发三闸阈值（随公司可配，纯入参；docs/17-§2） */
export interface ConcurrencyLimits {
  /** 每拍动作上限（超限顺延不丢） */
  maxActionsPerTick: number
  /** 全局在途 worker 上限 */
  maxInflight: number
}

/** 断路器快照（decide 只读连击数/阈值/熔断时刻；状态本体在 src/breaker.ts） */
export interface BreakerSnapshot {
  /** 同(单号,错误签名)当前连击数（0=无记录） */
  strikes: number
  /** 熔断阈值 N（参数化，默认 3，docs/17-§6） */
  threshold: number
  /**
   * 熔断时刻 epoch-ms（DEV-46 半开面；undefined=未熔断或**无时刻面**的旧快照——
   * 后者 strikes≥阈时按未冷却处理，fail-closed：不可证冷却已过即不放试探）
   */
  trippedAt?: number
  /** 冷却窗 ms（缺省 DEFAULT_BREAKER_COOLDOWN_MS=30min 拟稿，DEV-46） */
  cooldownMs?: number
}

/** decide 输入（拟升 contract；一切外部世界经参数传入，core 零 IO） */
export interface DecisionInput {
  /** 镜像单据（docs/25-§3.2 IssueRecord；状态权威在平台侧，此处只是加速镜像） */
  issue: IssueRecord
  /** 等级显式覆盖（缺省回退 issue.level） */
  level?: number
  /** 类型显式覆盖（缺省回退 issue.type；v0 仅随 type_edges 语义保留） */
  type?: string
  /** 状态流表（公司覆盖=传入替换；缺省 DEFAULT_FLOW_TABLE，docs/18-§2.1） */
  flows?: FlowTable
  /** 泳道租约状态 */
  laneLease: LaneLeaseState
  /** 全局在途 worker 计数 */
  inflightCount: number
  /** 本拍已发出动作计数 */
  tickActionCount: number
  /** 三闸阈值 */
  limits: ConcurrencyLimits
  /** 唤起意图（docs/25-§3.4 InvokeIntent；v0 只用其身份参与去重键，kind/priority 留后续刀） */
  intent: InvokeIntent
  /** 已处理意图键集合（daemon 落账后回灌；幂等去重依据） */
  seenIntentKeys: readonly string[]
  /** 断路器快照（同单同错误签名连击数） */
  breaker: BreakerSnapshot
  /** 制作人已批（网关动作词批准记录归一；L1/L2 待批派发与 L2 交付批前置） */
  approved?: boolean
  /** 本单已有复验通过证据（daemon 从收割/事件侧归一；L2 重名态「待批」消歧：true=交付批） */
  verifiedEvidence?: boolean
  /** 当前时刻 epoch-ms（时间一律入参，core 禁 Date.now） */
  now: number
  /** 在工静默告警阈值 ms（stall_alarm 触发线；只盯「已派发」态） */
  stallAfterMs: number
}

/** decide 输出（拟升 contract） */
export interface DecisionOutput {
  /** 本拍该单的至多一个动作（17-§2：同 tick 单只一单至多一动作） */
  action: Action
  /** 本意图去重键（daemon 落账后加入 seen 集合，形成幂等闭环） */
  intentKey: string
}

// ————————————————————————— 幂等键（docs/22-§三.2 / docs/25-§3.4）—————————————————————————

/**
 * 意图去重键：(source, kind, company, ticket ?? dedupKey)。
 * 契约要求无 ticket 的意图必填 dedupKey（docs/25-§3.4）；缺位键槽留空，由 decide 以
 * HOLD_INTENT_MALFORMED 拦下（不派工、明报），键本身仍确定性可算（同输入恒同输出）。
 */
export function intentKeyOf(intent: InvokeIntent): string {
  const dedup = intent.ticket ?? intent.dedupKey ?? ''
  return [intent.source, intent.kind, intent.company, dedup].join('|')
}

// ————————————————————————— decide 本体 —————————————————————————

/**
 * 决策顺序（固定，供 golden trace 与测试锁定；顺序即优先级）：
 *   1. 意图校验与幂等去重（malformed / mismatch / dedup）
 *   2. 定流定表（DEV-43，docs/18-§2.1.1）：类型 T:<type> 优先→等级 L<n> 回退→StateFlow，缺流明报
 *   3. 状态合法性：不在流状态集内=平台自定义态，不动
 *   4. 停摆检查：已派发+静默超阈值 → stall_alarm
 *   5. 状态机推演（锚点+边）：
 *      后继含待批 → submit_approval；待批态 → 批否分流（dispatch/merge/等批）；
 *      后继含已派发 → dispatch 过三闸；已派发 → wait_evidence；证据就绪 → collect；
 *      复验通过→已交付 → merge；已交付 → recycle；其余自定义中间态 → noop
 *   三闸序：断路 > 泳道 > 每拍 > 在途（断路最高：F1-10 断路后零新 DISPATCH）
 */
export function decide(input: DecisionInput): DecisionOutput {
  const { issue, intent } = input
  const intentKey = intentKeyOf(intent)

  // 1. 意图校验与幂等
  if (intent.ticket === undefined && intent.dedupKey === undefined) {
    return { intentKey, action: hold(issue.id, 'HOLD_INTENT_MALFORMED') }
  }
  if (intent.ticket !== undefined && intent.ticket !== issue.id) {
    return { intentKey, action: hold(issue.id, 'HOLD_INTENT_MISMATCH') }
  }
  if (input.seenIntentKeys.includes(intentKey)) {
    return { intentKey, action: noop(issue.id, 'DEDUP_NOOP') }
  }

  // 2. 定流定表（DEV-43 解析序冻结，docs/18-§2.1.1：T:<type> 优先 → L<level> 回退 →
  //    缺流明报；类型流命中不要求 level——两路都解析不到才 NOOP）
  const level = input.level ?? issue.level
  const type = input.type ?? issue.type
  const table = input.flows ?? DEFAULT_FLOW_TABLE
  const flow = resolveTicketFlow(table, type, level)
  if (flow === undefined) {
    return { intentKey, action: noop(issue.id, 'NOOP_UNKNOWN_FLOW') }
  }
  const anchors = flowAnchors(flow)
  const states = flowStates(flow)

  // 3. 状态合法性（平台权威：未知态不猜不动）
  if (!states.includes(issue.state)) {
    return { intentKey, action: noop(issue.id, 'NOOP_UNKNOWN_STATE') }
  }

  // 4. 停摆（只盯在工态：已派发静默；updated 不可解析时跳过，不基于坏数据告警）
  if (issue.state === anchors.dispatched) {
    const updatedMs = Date.parse(issue.updated)
    if (!Number.isNaN(updatedMs)) {
      const silentMs = input.now - updatedMs
      if (silentMs > input.stallAfterMs) {
        return { intentKey, action: { type: 'stall_alarm', code: 'STALL_SILENT', ticket: issue.id, silentMs } }
      }
    }
  }

  // 5. 状态机推演（只用主干**前向**后继——rollback/type 边是修复路径不是下一步，
  //    否则「已交付 --rollback--> 已派发」会误触发再派发）
  const successors = forwardStates(flow, issue.state)

  // 5a. 呈批：主干下一站是待批（L1/L2 新单、L2 复验通过）
  if (successors.includes(anchors.approval)) {
    return { intentKey, action: { type: 'submit_approval', code: 'SUBMIT_APPROVAL', ticket: issue.id, toState: anchors.approval } }
  }

  // 5b. 待批态：批否分流（重名态消歧：verifiedEvidence=true 走交付批合并，
  //     缺省走派发轨道——L1/L2 前批 / L2 交付批，见头注拟稿待批点）
  if (issue.state === anchors.approval) {
    if (input.approved !== true) {
      return { intentKey, action: noop(issue.id, 'WAIT_APPROVAL') }
    }
    if (input.verifiedEvidence === true && successors.includes(anchors.delivered)) {
      return { intentKey, action: mergeTo(issue.id, anchors.delivered) }
    }
    if (successors.includes(anchors.dispatched)) {
      return { intentKey, action: passGates(input, anchors.dispatched) }
    }
    if (successors.includes(anchors.delivered)) {
      return { intentKey, action: mergeTo(issue.id, anchors.delivered) }
    }
    return { intentKey, action: noop(issue.id, 'NOOP_IDLE') }
  }

  // 5c. 派发就绪（后继含已派发：L0 新单）：过三闸
  if (successors.includes(anchors.dispatched)) {
    return { intentKey, action: passGates(input, anchors.dispatched) }
  }

  // 5d. 在工等证据（停摆已在 4 拦截）
  if (issue.state === anchors.dispatched) {
    return { intentKey, action: { type: 'wait_evidence', code: 'EVIDENCE_PENDING', ticket: issue.id } }
  }

  // 5e. 证据就绪 → 收割
  if (issue.state === anchors.evidenceReady) {
    return { intentKey, action: { type: 'collect', code: 'EVIDENCE_READY', ticket: issue.id } }
  }

  // 5f. 复验通过 → 合并（→交付；→待批已被 5a 呈批截住）
  if (issue.state === anchors.verified && successors.includes(anchors.delivered)) {
    return { intentKey, action: mergeTo(issue.id, anchors.delivered) }
  }

  // 5g. 已交付 → 回收（释放租约/归档工位）
  if (issue.state === anchors.delivered) {
    return { intentKey, action: { type: 'recycle', code: 'LANE_RELEASE', ticket: issue.id } }
  }

  // 5h. 自定义中间态：无机器动作
  return { intentKey, action: noop(issue.id, 'NOOP_IDLE') }
}

// ————————————————————————— 内部构件（纯函数）—————————————————————————

function hold(ticket: TicketId, code: HoldAction['code']): HoldAction {
  return { type: 'hold', code, ticket }
}

function noop(ticket: TicketId, code: NoopAction['code']): NoopAction {
  return { type: 'noop', code, ticket }
}

function mergeTo(ticket: TicketId, delivered: string): MergeAction {
  return { type: 'merge', code: 'MERGE_DUE', ticket, toState: delivered }
}

/** 泳道无主判定：无持有人，或持有人租约已过期（死主回收语义：回收归 daemon，decide 视同可用） */
function laneFree(lease: LaneLeaseState, now: number): boolean {
  if (lease.holder === null) return true
  return lease.expiresAt !== undefined && now >= lease.expiresAt
}

/**
 * 断路开否（DEV-46 半开）：trippedAt 在册=熔断中（连击数不计——熔断后换签名连击归 1，
 * 熔断态仍保持）；无时刻面的旧快照退回 strikes≥阈判（fail-closed）。
 */
export function breakerTripped(b: BreakerSnapshot): boolean {
  return b.trippedAt !== undefined || b.strikes >= b.threshold
}

/**
 * 冷却窗过否（半开试探前置，DEV-46）：熔断时刻+冷却窗 ≤ now 才放试探。
 * 无 trippedAt（未熔断/旧快照）恒 false——不可证冷却已过即不放（fail-closed，
 * golden 旧迹兼容：breaker-trip-chain 无时刻面 → 恒 hold，语义与旧代码一致）。
 */
export function breakerCooled(b: BreakerSnapshot, now: number): boolean {
  if (b.trippedAt === undefined) return false
  return now >= b.trippedAt + (b.cooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS)
}

/**
 * 三闸（断路 > 泳道 > 每拍 > 在途）：全过=dispatch；任一未过=hold 带理由（顺延不丢）。
 * 断路面（DEV-46 半开）：熔断开且冷却窗未过=HOLD_BREAKER_OPEN；窗过=放行**一次**
 * 试探派发（dispatch 携 breakerProbe 锚——同拍单只一动作结构性保证「一次」；试探在工
 * 期间该单不重决策派发，试探失败回全开续冷却再压制）。
 */
function passGates(input: DecisionInput, dispatched: string): Action {
  const { issue, laneLease, limits, breaker, now } = input
  if (breakerTripped(breaker) && !breakerCooled(breaker, now)) {
    return hold(issue.id, 'HOLD_BREAKER_OPEN')
  }
  const probe = breakerTripped(breaker)
  if (!laneFree(laneLease, now)) {
    return hold(issue.id, 'HOLD_LANE_BUSY')
  }
  if (input.tickActionCount >= limits.maxActionsPerTick) {
    return hold(issue.id, 'HOLD_TICK_LIMIT')
  }
  if (input.inflightCount >= limits.maxInflight) {
    return hold(issue.id, 'HOLD_INFLIGHT_LIMIT')
  }
  return {
    type: 'dispatch',
    code: 'DISPATCH',
    ticket: issue.id,
    toState: dispatched,
    lane: laneLease.lane,
    ...(probe ? { breakerProbe: true } : {}),
  }
}
