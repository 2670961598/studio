/**
 * assembly/harvest/records —— 收割证据批次落口装配（REC-EVD-01/02 → PORT-HIST 唯一记录写口）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口；多记录同域原子＝显式 tx 句柄——治 L3J-P1-01）、
 *     §二 规则②（记录形状唯一源＝contract）；docs/v2/11 §〇/§0.4（同 id/幂等键重放＝返回既有、
 *     异内容＝拒）/§六 REC-EVD-01/02；docs/17-§2（相位 4 收割）/§6（收割四要件）；
 *   - docs/v2/16（实现落点：daemon 装配面）；docs/20-§十五.三（先拆再增：runtime 只留一行接线）。
 *
 * 职责（事务装配单一面）：把 `engine/harvest/records.ts` 的落库口（`HarvestRecordSink`）接到
 * `createHistFace(ledger.db).append`——**整批一事务**：证据项＋批次记录同事务提交，
 * 任一记录被 contract/库闸拒 → 全部回滚（不落半套）。本件零记录形状定义（映射归
 * engine/harvest/records.ts）、零权限判定、零 serve 接线（HTTP/引擎注入面归
 * `records-wire.ts`——20-§十五.三 先拆再增）。
 *
 * fail-closed：写口异常一律抛回调用方（decorator 记 failed＋具名理由，验收输入闸拒）；
 * 三不入·库闸（生产=runtime 的 outbound.gate.guardStoreRecord）拒写＝整批未落库。
 */
import { createHistFace, type HistFace, type Ledger } from '@studio-next/store'
import type { HarvestRecordSink } from '../../engine/harvest/records.ts'

/** 装配面（sink＝引擎注入的落库口；hist＝读回/对账句柄，读写同出一句柄——v2/14 §1.6） */
export interface HarvestRecordAssembly {
  readonly sink: HarvestRecordSink
  readonly hist: HistFace
}

export interface AssembleHarvestRecordsDeps {
  readonly ledger: Ledger
  /** 三不入·库闸（生产=runtime 的 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  /** 装配/写口失败观测行（软失败：只记日志，不改写口结论） */
  readonly log?: (line: string) => void
}

/**
 * 建收割证据落口（一进程一实例）：`appendMany` 开显式事务→逐条 append（可过库闸）→commit；
 * 任一环节抛错＝abort 后原样抛出（调用方 fail-closed：整批未落库，不冒充已写）。
 */
export function assembleHarvestRecords(deps: AssembleHarvestRecordsDeps): HarvestRecordAssembly {
  const hist = createHistFace(deps.ledger.db)
  const sink: HarvestRecordSink = {
    appendMany(records) {
      const tx = hist.begin()
      try {
        const refs = records.map((record) =>
          hist.append(deps.guardRecord !== undefined ? deps.guardRecord(record) : record, tx),
        )
        hist.commit(tx)
        return refs
      } catch (error) {
        try {
          hist.abort(tx)
        } catch {
          // 事务已不可写（连接异常）：以原始错误为准——写口结论仍是「整批未落库」
        }
        const message = error instanceof Error ? error.message : String(error)
        deps.log?.(`[harvest] REC-EVD-01/02 整批未落库（事务回滚）：${message}`)
        throw error instanceof Error ? error : new Error(message)
      }
    },
  }
  return { sink, hist }
}
