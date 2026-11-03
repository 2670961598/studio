/**
 * assembly/records/serve-face —— runtime 接线面：记录族生产写面进 ServeRuntime
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者）；docs/v2/14 §1.6（PORT-HIST）；
 * docs/v2/11 §〇.7（证明边界——记录落库≠执行完成）。
 *
 * 拆件动机（照 assembly/ops 先例）：runtime.ts 守卫 600 行阈——本件收口「装配＋装配日志」，
 * runtime 只留一行 `records:` 注入。行为边界：只提供写面，不自动触发任何记录写入。
 */
import type { Ledger } from '@studio-next/store'
import type { RecordWire } from '../../engine/records/index.ts'
import { assembleRecords } from './assemble.ts'

/** ServeRuntime 的记录面（引擎注入端口） */
export interface ServeRecordsFace {
  readonly records: RecordWire
}

/** 接线入参 */
export interface WireServeRecordsArgs {
  readonly ledger: Ledger
  readonly company: string
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/** 装配记录写面并返回 runtime 片段（生产装配日志＝接线证据锚） */
export function wireServeRecords(args: WireServeRecordsArgs): ServeRecordsFace {
  const assembly = assembleRecords({
    ledger: args.ledger,
    company: args.company,
    ...(args.guardRecord !== undefined ? { guardRecord: args.guardRecord } : {}),
    ...(args.log !== undefined ? { log: args.log } : {}),
  })
  args.log?.(
    '[serve] 记录族生产写面已装配：相位 1 采集尾→REC-WORK-01、相位 3/4/6 迁移缝→REC-WORK-06（前置不齐即拒）、相位 4 收割尾→REC-EVD-01（需 REC-LIFE-04）→ PORT-HIST append',
  )
  return { records: assembly.records }
}
