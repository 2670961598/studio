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
import type { HistRecordRef } from '@studio-next/store'
import type { RecordValidationIssue } from '../../../../../packages/contract/src/records/index.ts'

/** 写入路径名（producer.writtenBy；与 mainloop 事件写面分开——v2/11 §0.2-1） */
export const RECORD_WRITTEN_BY = 'daemon:engine/records'

/** 冻结 schema 工件引用（v2/10 §4.1；与 assembly/ops 同口径——仓库内记录工件唯一引用） */
export const RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与 packages/contract/src/artifacts/generate.ts SPEC_VERSION 同值） */
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
  readonly evidenceRefs?: readonly { readonly refType: string; readonly refId: string; readonly refVersion: string }[]
  /** 规则型生产者的规则依据引用（§5.2；规则未登记即拒） */
  readonly ruleBasisRef?: { readonly refType: string; readonly refId: string; readonly refVersion: string }
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

/** 记录写面端口（EngineDeps.records；缺省不注入＝记录面关、行为零变） */
export interface RecordWirePort {
  readonly counters: {
    intake: number
    transition: number
    deduped: number
    refused: number
    failed: number
  }
  intake(args: RecordIntakeArgs): RecordWriteResult
  transition(args: RecordTransitionArgs): RecordWriteResult
  harvest(args: RecordHarvestArgs): RecordWriteResult
}
