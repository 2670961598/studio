/**
 * engine/records/types —— 记录族生产写面接线（studio-dev-527）公共形状
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：相位×记录类型×写入者映射表见 docs/17-§2「记录族生产写面」段）；
 *   - docs/17-§6（收割四要件；生产写面只在收割判定后落记录，不改判据）；
 *   - docs/v2/11 §〇（记录信封/责任主体五分型/决定面/幂等键）、§1.4（WORK 21 类）、
 *     §1.5（EVD 6 类）、§1.6（ACC 2 类）、§1.7（CHG 1 类）、§1.9（REV 1 类）；
 *   - docs/v2/11 §0.2（记录五分型：请求型不设决定面；决定型必须具名权源）、§0.3-2（决定面
 *     封闭清单）、§0.4-5（幂等五元组）、§0.5（生效槽）、§0.7（证明边界）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口：写面只走 `createHistFace(...).append`）。
 *
 * 边界（本件只给形状，零 IO）：
 *   - 写入结果三态：ok（已落库）/ deduped（同 recordId 幂等重放）/ refused（契约前置未就绪，
 *     fail-closed，**不臆造记录**）——refused 是合法终态而非异常，调用方只观测不重试；
 *   - 记录类型一律取 v2/11 §一 登记值，本件不新增类、不改 payload 形状（契约面零变更）。
 */
import type { IssueRecord } from '@studio-next/contract'
import type {
  AccountabilityCaseContext,
  AccountabilityCasePayload,
  ChangeSegmentContext,
  ChangeSegmentPayload,
  ExceptionRecordPayload,
  MemoryDisposalContext,
  MemoryDisposalPayload,
  RemedyDecisionContext,
  RemedyDecisionPayload,
  ReviewContext,
  ReviewPayload,
  ValueEvaluationPayload,
  WorkSettlementContext,
  WorkSettlementPayload,
} from '@studio-next/contract/records'
import type { HistRecordRef } from '@studio-next/store'
import type { RecordValidationIssue } from '@studio-next/contract/records'
import type { AcceptanceChainFacts, HarvestChainFacts, StartChainFacts } from './work-chain.ts'

/** 写入路径名（producer.writtenBy；与 mainloop 事件写面分开——v2/11 §0.2-1） */
export const RECORD_WRITTEN_BY = 'daemon:engine/records'

/** 冻结 schema 工件引用（v2/10 §4.1；与 assembly/ops 同口径——仓库内记录工件唯一引用） */
export const RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与契约包 spec 版本常量 artifacts/generate.ts: SPEC_VERSION 同值） */
export const RECORD_SPEC_VERSION = '2.0.0'

/** 异议位置合法缺省（v2/11 §5.2 白名单：不得因「无异议」本身拒写） */
export const NO_DISSENT_LITERAL = '无异议'

/** 幂等作用域五元组（v2/11 §0.4-5；落列形由 store/hist 序列化） */
export interface RecordIdempotencyKey {
  readonly companyRef: string
  readonly recordType: string
  readonly subjectId: string
  readonly operationClass: string
  readonly requesterSequence: string
}

/** 记录草案（已过相位语义、尚未成信封；成信封/契约校验在 envelope.ts） */
export interface RecordDraft {
  readonly recordType: string
  /** 身份派生键：同一语义事件重放恒同 recordId（§0.4-1 身份不复用） */
  readonly recordId: string
  readonly producedAt: string
  /** 具名决定者/受理位置（§0.2-1；不得写框架/系统/平台） */
  readonly decidedBy: string
  readonly payload: unknown
  readonly effectiveState?: 'pending' | 'effective'
  readonly effectiveFrom?: string
  readonly proofBoundary?: string
  readonly idempotencyKey?: Omit<RecordIdempotencyKey, 'companyRef'>
}

/** 写入结果（三态；refused 不抛错、不写库） */
export type RecordWriteResult =
  | { readonly ok: true; readonly recordId: string; readonly recordType: string; readonly deduped: boolean; readonly ref: HistRecordRef }
  | { readonly ok: false; readonly recordType: string; readonly code: RecordRefusalCode; readonly reason: string }

/** 拒写码（观测面；码值冻结在本件，事件词表零新增） */
export const RECORD_REFUSAL_CODES = [
  'record-shape-invalid',
  'record-prereq-missing',
  'record-write-failed',
] as const

export type RecordRefusalCode = (typeof RECORD_REFUSAL_CODES)[number]

/** 契约形状拒收（envelope 层给 issue 明细） */
export interface RecordShapeFailure {
  readonly ok: false
  readonly recordType: string
  readonly code: 'record-shape-invalid'
  readonly reason: string
  readonly issues: readonly RecordValidationIssue[]
}

/** 采集相位意图入口入参（相位 1；REC-WORK-01 请求型，无决定面——§0.2） */
export interface RecordIntakeArgs {
  readonly issue: IssueRecord
  readonly at: number
  readonly actor: string
  /** 采集来源（活动流/全量对账——两路语义不同，人读锚） */
  readonly source: string
}

/** 状态迁移入参（相位 3/4/6；REC-WORK-06 决定型——前置记录不齐即拒写） */
export interface RecordTransitionArgs {
  readonly ticket: string
  readonly attempt: number
  readonly fromState: string
  readonly toState: string
  readonly at: number
  readonly actor: string
  /** 本迁移已具备的前置记录引用（§14.1 前置记录列；缺即拒，不补造） */
  readonly evidenceRefs?: readonly DraftRecordRef[]
  /** 规则型生产者的规则依据引用（§5.2；规则未登记即拒） */
  readonly ruleBasisRef?: DraftRecordRef
  /**
   * 决定面（§0.3-2：REC-WORK-06 在决定面封闭清单内，任何迁移都必带）。
   * 平台直派桥接（L0 新单→已派发）以一个派发决定承载 M-01→M-05 复合路径两跳——
   * 决定面与逐边前置记录分离：前置记录逐边判，决定面是同一派发决定（docs/17-§2 状态桥接段）。
   */
  readonly decision?: DraftDecisionFaceInput
}


/** 链相位公共入参（ticket/attempt/at/actor；事实由决定点端口给） */
export interface RecordChainPhaseArgs {
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  /** 平台流迁移锚（缺省取该相位缺省锚；映射见 state-map.ts） */
  readonly fromState?: string
  readonly toState?: string
}

/** 派发前置链入参（相位 3；facts 缺省＝决定点未产出 V2 事实 → 五族拒写） */
export interface RecordStartChainArgs extends RecordChainPhaseArgs {
  readonly facts?: StartChainFacts | undefined
}

/** 收割链入参（相位 4 收割；facts 缺省＝EVD-03/08 拒写） */
export interface RecordHarvestChainArgs extends RecordChainPhaseArgs {
  readonly facts?: HarvestChainFacts | undefined
}

/** 验收链入参（相位 4 收尾 QA 面；facts 缺省＝WORK-09 拒写） */
export interface RecordAcceptanceChainArgs extends RecordChainPhaseArgs {
  readonly facts?: AcceptanceChainFacts | undefined
}

/** 决定点 → 记录事实端口（v0 决定点尚未产出 V2 决定事实；缺省不注入＝C 族 fail-closed） */
export interface RecordPhaseFactsPort {
  start(args: RecordChainPhaseArgs): StartChainFacts | undefined
  harvest(args: RecordChainPhaseArgs): HarvestChainFacts | undefined
  acceptance(args: RecordChainPhaseArgs): AcceptanceChainFacts | undefined
}

/** 收割批次入参（相位 4 收割；REC-EVD-01 事件型，但仍需出工段引用） */
export interface RecordHarvestArgs {
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly actor: string
  readonly terminal: 'completed' | 'error' | 'blocked' | 'aborted' | 'limit_exceeded'
  readonly gaps: readonly string[]
  readonly usage: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
  readonly cost: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
}

// —— 刀D（studio-dev-561）：结清/复盘/问责/变更链/记忆分流/价值评估 ——
//
// 入参一律取 contract 的 payload 类型（形状唯一源=v2/11 §一 74 类），本件只补
// **跨记录前置闸**（contract 看不到的部分）：引用类型、被引记录是否存在、独立性是否自填。
// 逐族依据：WORK-12=v2/11 §5.2；WORK-17=§5.4；ACC-01/02=§七；CHG-01=§八/§14.4-2；
// REV-01=§十；MEM-03=§十三；EVD-04=§六（docs/17-§2 映射表同源）。

/** 记录引用形（与 contract RecordRef 同构；草案入参不带 recordType 判定的额外包装） */
export interface DraftRecordRef {
  readonly refType: string
  readonly refId: string
  readonly refVersion: string
}

/** 决定面输入（v2/11 §0.3-1 六件；决定面封闭清单类型必带——§0.3-2） */
export interface DraftDecisionFaceInput {
  readonly decidedBy: string
  readonly authorityRef: DraftRecordRef
  readonly rationale: string
  readonly basisRefs: readonly DraftRecordRef[]
  readonly scopeJudged: { readonly judged: readonly string[]; readonly notJudged: readonly string[] }
  readonly dissentPosition: string
  readonly effectiveFrom: string
}

/** 被引前置记录（wire 写前用 hist.get 机械核验：缺即拒、异类型即拒） */
export interface RecordRefRequirement {
  readonly ref: DraftRecordRef
  readonly recordType: string
  readonly role: string
  /** 额外机械核验（如变更链前段的段名一致）；返回 undefined=通过，字符串=拒写理由 */
  readonly match?: (record: { readonly recordType: string; readonly payload: unknown }) => string | undefined
}

/** 记录草案闸（contract 校验器＋被引前置记录清单；随草案返回，wire 统一执行） */
export interface RecordDraftGate {
  readonly requires?: readonly RecordRefRequirement[]
  readonly validate?: (record: unknown) => import('@studio-next/contract/records').RecordValidationOutcome
}

/** 结清入参（相位 5 合并/相位 6 回收；REC-WORK-12 决定型） */
export interface RecordSettlementArgs {
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  /** 除 settled_state 外的 payload（四态由 deriveWorkSettlementState 按清单推导，不接受自报） */
  readonly payload: Omit<WorkSettlementPayload, 'settled_state'>
  readonly context?: WorkSettlementContext
}

/** 异常入参（相位 6 回收/断路；REC-WORK-17） */
export interface RecordExceptionArgs {
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly payload: ExceptionRecordPayload
  readonly context?: { readonly treatedAsClosed?: boolean }
}

/** 问责入参（相位 6 回收/断路；REC-ACC-01） */
export interface RecordAccountabilityArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: AccountabilityCasePayload
  readonly context?: AccountabilityCaseContext
}

/** 救济入参（REC-ACC-02；决定面封闭清单成员） */
export interface RecordRemedyArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: RemedyDecisionPayload
  readonly context?: RemedyDecisionContext
}

/** 变更链段入参（配置热更/变更决定位；REC-CHG-01） */
export interface RecordChangeSegmentArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: ChangeSegmentPayload
  readonly context?: ChangeSegmentContext
  /** 链前段的被引记录（非 candidate 段必填；wire 核验存在且段名一致） */
  readonly previousSegmentRef?: DraftRecordRef
  /** 能力包变更的 CAP-01/02 前件（capability_pack 的三门段必填） */
  readonly capabilityRefs?: { readonly cap01?: DraftRecordRef; readonly cap02?: DraftRecordRef }
}

/** 复盘入参（终局后/周期；REC-REV-01） */
export interface RecordReviewArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: ReviewPayload
  readonly context?: ReviewContext
}

/** 记忆分流入参（结清/复盘前置；REC-MEM-03） */
export interface RecordMemoryDisposalArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: MemoryDisposalPayload
  readonly context?: MemoryDisposalContext
  /** 处置授权位置（§三 表 D 行 10/11；不得为该记忆的请求方本人——独立位置闸） */
  readonly independentPosition: string
  /** 请求方/被处置记忆的责任位置（与 independentPosition 同体即拒） */
  readonly requestedBy?: string
}

/** 价值评估入参（结清/复盘前置；REC-EVD-04） */
export interface RecordValueEvaluationArgs {
  readonly ticket: string
  readonly at: number
  readonly payload: ValueEvaluationPayload
  readonly context?: { readonly negativeValueUnlisted?: boolean }
}

// —— 刀B（任职/授权链；studio-dev-605 承接 #559 重出）——
//
// 入参一律只有「时刻/工号/单号」：任职与授权事实由名册端口（`roster.ts`）派生，调用方没有可填字段
// ＝「自填即拒」的类型面（docs/17-§2 刀B 段；v2/11 §七 独立性）。

/** 相位 0 名册装载入参（启动装载／人事变更）——**只有时刻与原因** */
export interface RecordRosterLoadArgs {
  readonly at: number
  readonly reason: 'boot' | 'hr-change'
}

/** 相位 4 出工段入参（前件记录引用由写面按记录 id 约定解析，调用方不得自带） */
export interface RecordSegmentArgs {
  readonly ticket: string
  readonly attempt: number
  readonly personId: string
  readonly at: number
  readonly workspace?: string
  readonly briefRef?: string
}

/** 权源解析入参（决定型记录写前取 authority_ref；引用由授权链派生，调用方不得自带记录引用） */
export interface RecordAuthorityArgs {
  readonly personId: string
  /** 动作范围词（须落在授予 scope.included 内且不在 forbidden 内） */
  readonly actionScope: string
}

/** 记录写面端口（EngineDeps.records；缺省不注入＝记录面关、行为零变） */
export interface RecordWirePort {
  readonly counters: {
    intake: number
    transition: number
    deduped: number
    refused: number
    failed: number
    settlement: number
    exception: number
    accountability: number
    remedy: number
    change: number
    review: number
    memory: number
    value: number
    /** 刀B：名册装载轮次（相位 0／人事变更） */
    lifecycle: number
    /** 刀B：出工段尝试次数（相位 4） */
    segment: number
    /** 刀B：权源解析次数（决定型记录写入前） */
    authority: number
    /** 刀B：#559 验收项「对账读者」——records↔events 对账轮次 */
    reconcile: number
  }
  intake(args: RecordIntakeArgs): RecordWriteResult
  transition(args: RecordTransitionArgs): RecordWriteResult
  harvest(args: RecordHarvestArgs): RecordWriteResult
  /** 刀B 相位 0：名册 → LIFE-05 禁配申报 → AUTH-01 授权链 → LIFE-01 任命（逐条三态，不打断拍） */
  rosterLoad(args: RecordRosterLoadArgs): readonly RecordWriteResult[]
  /** 刀B 相位 4：出工段 LIFE-04（生效任命／WORK-05／AUTH-02／CAP-02 前件缺一即拒——不臆造段） */
  workSegment(args: RecordSegmentArgs): RecordWriteResult
  /** 刀B 权源面：该工号在该动作范围上的覆盖授予引用（无覆盖即拒，调用方不得自填） */
  authorityRefFor(args: RecordAuthorityArgs): RecordWriteResult
  /** 相位 3：WORK-02→07→03→05→04 五族 + M-05 迁移（逐条三态；前件不齐即拒） */
  startChain(args: RecordStartChainArgs): readonly RecordWriteResult[]
  /** 相位 4 收割：EVD-03→WORK-08 + M-10 迁移（逐条三态） */
  harvestChain(args: RecordHarvestChainArgs): readonly RecordWriteResult[]
  /** 相位 4 收尾验收：WORK-09 + M-17 迁移（逐条三态） */
  acceptanceChain(args: RecordAcceptanceChainArgs): readonly RecordWriteResult[]
  /** #559 验收项：records ↔ events 双向对账（生产对账循环的读面消费者，只读不写） */
  reconcile(since?: number): import('./projection.ts').ProjectionReconciliation
  settlement(args: RecordSettlementArgs): RecordWriteResult
  exception(args: RecordExceptionArgs): RecordWriteResult
  accountability(args: RecordAccountabilityArgs): RecordWriteResult
  remedy(args: RecordRemedyArgs): RecordWriteResult
  changeSegment(args: RecordChangeSegmentArgs): RecordWriteResult
  review(args: RecordReviewArgs): RecordWriteResult
  memoryDisposal(args: RecordMemoryDisposalArgs): RecordWriteResult
  valueEvaluation(args: RecordValueEvaluationArgs): RecordWriteResult
}
