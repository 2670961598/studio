/**
 * PORT-HIST 历史与记忆 —— 唯一记录写口、事务壳、读/查询、载荷视图、修正、
 * 对账、记忆写/处置/访问审计（docs/v2/05 §四；签名 docs/v2/14 §1.6）
 *
 * 必须拒绝：记忆覆盖历史（修正只追加，`CorrectionDraft.appendOnly:true`）；
 *   自动交给继任者（`MemoryDisposeDraft` 的 inherit/transfer 必须显式指定承接者/
 *   接收方，类型上不存在「自动继承」槽）；越权读以 `Ok(undefined)` 冒充「无行」
 *   （`get` 的 undefined 只表权威确认不存在，越权＝Err）；对账未完成即结清
 *   （`ReconcileBatch.settled:false` 时不得进入结清）。
 * 多记录同域原子用显式 tx 句柄（治 L3J-P1-01）；投影钩子同事务＝目标（未证）。
 * 零实现、零 IO；DDL 归 v2/16 MIG-04。
 */
import type { ByteDigestState } from './evd.ts'
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  Page,
  PortResult,
  ProofBoundary,
  ReadContext,
  VersionRef,
} from './def.ts'

/** 端口名常量 */
export const PORT_HIST = 'PORT-HIST' as const

/**
 * 记录引用（ID＋类型＋版本；版本链逐版链接，旧版保留）。v2/14 称 `RecordRef`；
 * 与记录面同名类型避撞，本端口取 `HistoryRecordRef`。
 */
export interface HistoryRecordRef {
  readonly recordId: string
  readonly recordType: string
  readonly version: number
}

/** 事务壳（多记录同域原子；显式句柄，不隐式开事务） */
export interface TxHandle {
  readonly txId: string
  readonly open: boolean
}

export interface TxReceipt {
  readonly txId: string
  readonly committed: boolean
  readonly recordRefs: readonly HistoryRecordRef[]
}

/** 追加写入草案：`expected` 改状态必带；`supersedes` 是版本链的前版引用 */
export interface RecordDraft {
  readonly recordType: string
  readonly company: CompanyRef
  readonly payload: Readonly<Record<string, unknown>>
  readonly writtenBy: CallerRef
  readonly expected?: VersionRef
  readonly supersedes?: HistoryRecordRef
  readonly proofBoundary?: ProofBoundary
}

interface HistoryRecordBase {
  readonly ref: HistoryRecordRef
  readonly company: CompanyRef
  readonly recordedAt: string
}

/**
 * 记录读面（顶层 `kind` 判别联合，v2/14 §0.2-6）：
 * record＝主记录；correction＝追加更正；reconcile＝对账；memory＝记忆记录。
 */
export type HistoryRecord =
  | (HistoryRecordBase & {
      readonly kind: 'record'
      readonly recordType: string
      readonly payload: Readonly<Record<string, unknown>>
      readonly supersedes?: HistoryRecordRef
    })
  | (HistoryRecordBase & {
      readonly kind: 'correction'
      readonly recordType: string
      readonly correctionOf: HistoryRecordRef
      readonly payload: Readonly<Record<string, unknown>>
    })
  | (HistoryRecordBase & {
      readonly kind: 'reconcile'
      readonly recordType: string
      readonly payload: Readonly<Record<string, unknown>>
    })
  | (HistoryRecordBase & {
      readonly kind: 'memory'
      readonly recordType: string
      readonly payload: Readonly<Record<string, unknown>>
    })

export interface RecordQuery {
  readonly company: CompanyRef
  readonly recordType: string
  readonly since?: string
  readonly until?: string
  readonly cursor?: string
  readonly limit?: number
}

/**
 * 载荷视图（按信封知悉范围）。`byteDigestState` 三态引 ENU-61；
 * `redactedFields` 列出因知悉范围被遮的字段——遮了不等于不存在。
 */
export interface PayloadView {
  readonly ref: HistoryRecordRef
  readonly payload: Readonly<Record<string, unknown>>
  readonly byteDigestState: ByteDigestState
  readonly knowableFields: readonly string[]
  readonly redactedFields: readonly string[]
}

/** 修正草案（REC-COR-01）：追加不覆盖；`appendOnly:true` 是类型级纪律标记 */
export interface CorrectionDraft {
  readonly target: HistoryRecordRef
  readonly reason: string
  readonly patch: Readonly<Record<string, unknown>>
  readonly correctedBy: CallerRef
  readonly appendOnly: true
  readonly proofBoundary: ProofBoundary
  readonly expected: VersionRef
}

export interface CorrectionRef {
  readonly recordId: string
  readonly version: number
  readonly correctionOf: HistoryRecordRef
}

/** 对账差异类别（值集唯一主表 v2/09 ENU-68） */
export type ReconcileDifferenceKind =
  | 'missing'
  | 'duplicate'
  | 'disorder'
  | 'conflict'
  | 'late_arrival'
  | 'undeterminable'

export interface ReconcileDifference {
  readonly kind: ReconcileDifferenceKind
  readonly ref: HistoryRecordRef
  readonly detail: string
}

export interface ReconcileQuery {
  readonly company: CompanyRef
  readonly recordType: string
  readonly window: { readonly from: string; readonly to: string }
}

/**
 * 对账批次（REC-EVT-02）：`settled:false`＝不得结清；差异不得压成「已对平」。
 * `reconcile` 完成前，任何结清动作都只能停在「有保留」。
 */
export interface ReconcileBatch {
  readonly query: ReconcileQuery
  readonly differences: readonly ReconcileDifference[]
  readonly settled: boolean
  readonly completedAt: string
}

/** 记忆三域（值集唯一主表 v2/09 ENU-63） */
export type MemoryDomain = 'personal' | 'work' | 'corporate'

/** 个人记忆四子类（值集唯一主表 v2/09 ENU-64） */
export type MemoryItemKind = 'fact' | 'experience' | 'skill' | 'commitment_relation'

export interface MemoryWriteDraft {
  readonly domain: MemoryDomain
  readonly itemKind: MemoryItemKind
  readonly subject: string
  readonly content: string
  readonly sourceRefs: readonly [string, ...string[]]
  readonly writtenBy: CallerRef
}

/** 记忆处置操作（值集唯一主表 v2/09 ENU-65） */
export type MemoryDisposalAction =
  | 'correct'
  | 'erase'
  | 'inherit'
  | 'transfer_layer'
  | 'seal'
  | 'archive'
  | 'transfer_out'

/**
 * 处置目标（类型级拒绝「自动交给继任者」）：
 * inherit 必填显式承接者；transfer_out 必填显式接收方；transfer_layer 必填双授权引用；
 * 其余动作不允许携带承接/接收/双授权槽。
 */
export type MemoryDisposalTarget =
  | { readonly action: 'inherit'; readonly inheritor: CallerRef }
  | { readonly action: 'transfer_out'; readonly recipient: string }
  | { readonly action: 'transfer_layer'; readonly dualAuthorizationRef: string }
  | {
      readonly action: 'correct' | 'erase' | 'seal' | 'archive'
      readonly inheritor?: undefined
      readonly recipient?: undefined
      readonly dualAuthorizationRef?: undefined
    }

export type MemoryDisposeDraft = MemoryDisposalTarget & {
  readonly memoryRef: string
  readonly authorizer: CallerRef
  readonly reason: string
  readonly expected?: VersionRef
}

/** 记忆访问审计（MON-09 消费面）：读一次记一次，含用途与范围 */
export interface MemoryAccessDraft {
  readonly memoryRef: string
  readonly accessor: CallerRef
  readonly purpose: string
  readonly scope: readonly string[]
  readonly accessedAt: string
}

/** 记忆记录引用（写/处置/访问审计共用） */
export interface MemoryRecordRef {
  readonly recordId: string
  readonly version: number
  readonly memoryRef: string
}

/**
 * 端口接口：唯一记录写口。`append` 覆盖首笔＋状态推进＋修正（修正走 `correct`）；
 * 读面 `get` 的 `undefined` 只表权威确认不存在（越权＝Err）。
 */
export interface HistoryPort {
  append(d: RecordDraft, ctx: CallContext, tx?: TxHandle): PortResult<HistoryRecordRef>
  begin(ctx: CallContext): PortResult<TxHandle>
  commit(tx: TxHandle, ctx: CallContext): PortResult<TxReceipt>
  abort(tx: TxHandle, ctx: CallContext): PortResult<TxReceipt>
  get(ref: HistoryRecordRef, rc: ReadContext): PortResult<HistoryRecord | undefined>
  query(q: RecordQuery & ReadContext): PortResult<Page<HistoryRecord>>
  payload(ref: HistoryRecordRef, rc: ReadContext): PortResult<PayloadView>
  correct(d: CorrectionDraft, ctx: CallContext): PortResult<CorrectionRef>
  reconcile(q: ReconcileQuery, ctx: CallContext): PortResult<ReconcileBatch>
  memoryWrite(d: MemoryWriteDraft, ctx: CallContext): PortResult<MemoryRecordRef>
  memoryDispose(d: MemoryDisposeDraft, ctx: CallContext): PortResult<MemoryRecordRef>
  memoryAuditAccess(d: MemoryAccessDraft, ctx: CallContext): PortResult<MemoryRecordRef>
}
