/**
 * engine/records/wire —— 记录族生产写面（主循环相位 → PORT-HIST）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者；本件是映射表的写侧执行体）；
 *   - docs/17-§6（收割四要件；记录落库是相位结果留痕，不参与判据）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口：`createHistFace(...).append`）；
 *   - docs/v2/11 §〇.4-1（身份一经分配不复用）／§0.4-4（同单重放返回既有结果、零第二副作用）／
 *     §0.4-5（幂等五元组）／§0.7（证明边界随记录走）。
 *
 * 纪律（与 mainloop 事件的位别）：
 *   - 记录是事实源，`events` 保留为可重建投影（docs/17-§2；本件**不改**事件写面语义）；
 *   - 记录写入失败/拒写**不得打断拍**：结果三态回报调用方（ok/deduped/refused/failed），
 *     错误进 log＋计数器，事件面照旧（fail-safe，记录面欠账可对账发现）；
 *   - 同 recordId 幂等：先读既有行（`hist.get`），命中即 deduped，不再 append（同 id 异内容由
 *     store 拒收——记录身份不复用的机械保证）。
 */
import type { HistFace, HistRecordRef } from '@studio-next/store'
import { buildEnvelope } from './envelope.ts'
import { harvestBatchDraft, workIntakeDraft, workTransitionDraft, type DraftOutcome } from './drafts.ts'
import {
  RECORD_WRITTEN_BY,
  type RecordHarvestArgs,
  type RecordIntakeArgs,
  type RecordRefusalCode,
  type RecordTransitionArgs,
  type RecordWirePort,
  type RecordWriteResult,
} from './types.ts'

/** 装配入参（一 serve 进程一实例；company 固定——records 一进程一公司口径） */
export interface RecordWireDeps {
  readonly hist: HistFace
  readonly company: string
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/** 记录写面（RecordWirePort 实现；计数器为本拍/累计观测面，不落库） */
export interface RecordWire extends RecordWirePort {
  /** 记录写入路径名（producer.writtenBy；审计锚） */
  readonly writtenBy: string
}

/** 结果折叠（draft 拒写 → refused；形状拒收 → failed；store 冲突 → failed 不重试） */
function failureOf(recordType: string, code: RecordRefusalCode, reason: string): RecordWriteResult {
  return { ok: false, recordType, code, reason }
}

/**
 * 建记录写面。`hist` 必须已迁移到 v14/v15（`openLedger` 完成）——本件不自开库、不建表。
 */
export function createRecordWire(deps: RecordWireDeps): RecordWire {
  const { hist, company } = deps
  const counters = { intake: 0, transition: 0, deduped: 0, refused: 0, failed: 0 }

  const refuse = (outcome: Extract<DraftOutcome, { ok: false }>): RecordWriteResult => {
    counters.refused += 1
    deps.log?.(`[records] 拒写 ${outcome.recordType}：${outcome.reason}`)
    return failureOf(outcome.recordType, outcome.code, outcome.reason)
  }

  const write = (outcome: DraftOutcome): RecordWriteResult => {
    if (!outcome.ok) return refuse(outcome)
    const { draft } = outcome
    const built = buildEnvelope(draft, { company })
    if (!built.ok) {
      counters.failed += 1
      deps.log?.(`[records] 形状拒收 ${draft.recordType}（recordId=${draft.recordId}）：${built.reason}`)
      return failureOf(draft.recordType, built.code, built.reason)
    }
    // 幂等（§0.4-4）：同 recordId 命中既有行＝重放，不产生第二次副作用
    const existing = hist.get(draft.recordId)
    if (existing !== undefined) {
      counters.deduped += 1
      const ref: HistRecordRef = { recordId: draft.recordId, recordType: draft.recordType, appended: false }
      return { ok: true, recordId: draft.recordId, recordType: draft.recordType, deduped: true, ref }
    }
    try {
      const guarded = deps.guardRecord !== undefined ? deps.guardRecord(built.envelope) : built.envelope
      const ref = hist.append(guarded)
      return {
        ok: true,
        recordId: ref.recordId,
        recordType: ref.recordType,
        deduped: ref.appended === false,
        ref,
      }
    } catch (err) {
      counters.failed += 1
      const message = err instanceof Error ? err.message : String(err)
      deps.log?.(`[records] 落库失败 ${draft.recordType}（recordId=${draft.recordId}）：${message}`)
      return failureOf(draft.recordType, 'record-write-failed', `记录未落库（PORT-HIST append 异常）：${message}`)
    }
  }

  return {
    writtenBy: RECORD_WRITTEN_BY,
    counters,
    /** 相位 1 采集尾：平台意图 → REC-WORK-01（请求型；无决定面） */
    intake(args: RecordIntakeArgs): RecordWriteResult {
      counters.intake += 1
      return write(workIntakeDraft({ ...args, company }))
    },
    /** 相位 3/4/6 迁移执行缝：REC-WORK-06（决定型；边集/前置/规则依据/决定面四闸） */
    transition(args: RecordTransitionArgs): RecordWriteResult {
      counters.transition += 1
      return write(
        workTransitionDraft({
          ticket: args.ticket,
          attempt: args.attempt,
          fromPlatformState: args.fromState,
          toPlatformState: args.toState,
          at: args.at,
          actor: args.actor,
          company,
          ...(args.evidenceRefs !== undefined ? { evidenceRefs: args.evidenceRefs } : {}),
          ...(args.ruleBasisRef !== undefined ? { ruleBasisRef: args.ruleBasisRef } : {}),
        }),
      )
    },
    /** 相位 4 收割尾：REC-EVD-01（事件型；需 REC-LIFE-04 出工段） */
    harvest(args: RecordHarvestArgs): RecordWriteResult {
      return write(
        harvestBatchDraft({
          ticket: args.ticket,
          attempt: args.attempt,
          at: args.at,
          actor: args.actor,
          company,
          terminal: args.terminal,
          gaps: args.gaps,
          usage: args.usage,
          cost: args.cost,
        }),
      )
    },
  }
}
