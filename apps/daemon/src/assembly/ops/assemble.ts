/**
 * assembly/ops/assemble —— PORT-OPS 生产落口装配（REC-WORK-18 → PORT-HIST 唯一记录写口）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.8（PORT-OPS；OPS 补形 A 请求形状）、§1.6（PORT-HIST 唯一记录写口）；
 *   - docs/v2/11 §〇/§0.4（信封与同 recordId/幂等键重放＝返回既有、不产生第二次副作用）、
 *     §六 REC-WORK-18；
 *   - docs/49「OPS 补形 A」（决定 A）；docs/plan/mig08-closeout.md §十三（OPS appendRecord
 *     未接 PORT-HIST 的欠账——本件即该装配面）。
 *
 * 职责：把 `createOpsLanding`（control/stop-channel.ts：三闸＋记录草案）与 PORT-HIST
 * `createHistFace(ledger.db).append` 接起来——`appendRecord` 注入给落口；本件零权源判定、
 * 零记录形状定义（形状唯一源＝contract/report，映射见 ./envelope.ts）。
 *
 * fail-closed：写口抛出一律不吞——按类包成 `OpsWriteError`（conflict/unavailable）抛回
 * 落口，由落口回分类 Err（同 id 异内容＝conflict；形状/库异常＝unavailable，副作用可能
 * 由回执的 sideEffectPossible/reconcile 承载）。`makeId/now` 全注入（不读墙钟、不造随机）。
 */
import {
  createHistFace,
  type HistFace,
  type HistRecordRef,
  type Ledger,
} from '@studio-next/store'
import { createOpsLanding, opsWriteError, type OpsLanding, type OpsStopRecord } from '../../control/ops/index.ts'
import { opsStopEnvelope } from './envelope.ts'

/** 装配依赖（全注入；缺省不读环境/墙钟） */
export interface AssembleOpsDeps {
  readonly ledger: Ledger
  /** 铸记录 ID（生产=ULID 注入；测试=确定性序列） */
  readonly makeId: () => string
  /** 记录时刻（ISO；注入时钟——不读墙钟） */
  readonly now: () => string
  /**
   * 三不入·库闸（生产=runtime 的 outbound.gate.guardStoreRecord；测试可省）：
   * 记录写前深扫，检出即拒写——写口失败走 fail-closed，不冒 Ok。
   */
  readonly guardRecord?: (record: unknown) => unknown
  /** 装配/写口失败观测行（软失败：只记日志，不改写口结论） */
  readonly log?: (line: string) => void
}

/** PORT-OPS 装配面（runtime.ops＝landing；appendRecord 供测试/对账直接重放） */
export interface OpsAssembly {
  /** PORT-OPS 落口（OperationsPort 的 control 实现：emergencyStop/circuitBreak） */
  readonly ops: OpsLanding
  /** REC-WORK-18 → 信封 → PORT-HIST 写口（同 recordId 幂等；抛 OpsWriteError 即未落地/冲突） */
  readonly appendRecord: (record: OpsStopRecord) => HistRecordRef
  /** 本装配持有的 HIST 面（读回/对账用；读写同句柄——v2/14 §1.6） */
  readonly hist: HistFace
}

/** 写口异常 → 分类错误（CONFIG_INVALID/duplicate 由 store 判；本件只做归类，不改写结论） */
function writeErrorOf(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const bag = typeof error === 'object' && error !== null ? (error as { subcause?: unknown }) : undefined
  const subcause = typeof bag?.subcause === 'string' ? bag.subcause : ''
  if (subcause.startsWith('store/hist:duplicate-id') || subcause.startsWith('store/hist:duplicate-idempotency-key')) {
    return opsWriteError('conflict', 'ops-record-conflict', `REC-WORK-18 记录冲突（同 ID/幂等键异内容——不改写既有行，§0.4-1）：${message}`)
  }
  if (subcause.startsWith('store/record:invalid') || subcause.startsWith('store/hist:basis-refs') || subcause.startsWith('store/hist:until') || subcause.startsWith('store/hist:idempotency')) {
    return opsWriteError('unavailable', 'ops-record-invalid', `REC-WORK-18 记录形状拒收（记录映射/契约面）：${message}`)
  }
  return opsWriteError('unavailable', 'ops-record-unlanded', `REC-WORK-18 记录未落地（台账写口异常）：${message}`)
}

/**
 * 建 PORT-OPS 生产装配（一 serve 进程一实例）：
 *   - HIST 面：`createHistFace(ledger.db)`（records 表；v14 迁移由 openLedger 完成）；
 *   - 落口：`createOpsLanding({ makeId, now, appendRecord })`；
 *   - appendRecord：OpsStopRecord → REC-WORK-18 信封 → （可选三不入·库闸）→ hist.append。
 */
export function assembleOps(deps: AssembleOpsDeps): OpsAssembly {
  const hist = createHistFace(deps.ledger.db)

  const appendRecord = (record: OpsStopRecord): HistRecordRef => {
    let envelope: unknown
    try {
      envelope = opsStopEnvelope(record)
      if (deps.guardRecord !== undefined) envelope = deps.guardRecord(envelope)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log?.(`[ops] REC-WORK-18 信封映射/出站闸拒绝：${message}`)
      throw opsWriteError('unavailable', 'ops-record-unmapped', `REC-WORK-18 信封映射/出站闸失败（未落库）：${message}`)
    }
    try {
      return hist.append(envelope)
    } catch (error) {
      const failure = writeErrorOf(error)
      deps.log?.(`[ops] ${failure.message}`)
      throw failure
    }
  }

  const ops = createOpsLanding({
    makeId: deps.makeId,
    now: deps.now,
    appendRecord: (record): void => {
      appendRecord(record)
    },
  })

  return { ops, appendRecord, hist }
}
