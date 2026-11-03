/**
 * assembly/harvest/records-wire —— 收割证据落库口的 serve 接线面（REC-EVD-01/02 → PORT-HIST）
 *
 * 依据（实现单引用）：docs/v2/14 §1.6（PORT-HIST 唯一记录写口）；docs/v2/11 §六
 *   （REC-EVD-01/02）；docs/17-§2（相位 4 收割）/§6（收割四要件）；docs/20-§十五.三
 *   （先拆再增：runtime 只留一行接线；撞阈一律拆件，禁注释折行/压缩凑行数）。
 *
 * 职责（单一面）：把 `records.ts` 的事务装配面（`assembleHarvestRecords`）接成引擎注入面
 *   （`HarvestRecordSink`），并落一行装配日志。本件零记录形状定义（映射归
 *   engine/harvest/records.ts）、零权限判定、零事务语义（事务归 records.ts：证据项＋批次
 *   同事务提交，任一被拒整批回滚）。
 *
 * fail-closed：写口异常一律抛回调用方（decorator 记 failed＋具名理由，验收输入闸拒）；
 *   三不入·库闸（生产=runtime 的 outbound.gate.guardStoreRecord）拒写＝整批未落库。
 * 面关：runServe 不主动触发收割——写口只在引擎第 4 相位封批时被调用（docs/17-§2 七相位不增删）。
 */
import type { HarvestRecordSink } from '../../engine/harvest/records.ts'
import { assembleHarvestRecords } from './records.ts'
import type { Ledger } from '@studio-next/store'

export interface WireServeHarvestRecordsArgs {
  readonly ledger: Ledger
  /** 三不入·库闸（生产=runtime 的 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  /** 装配/写口失败观测行（软失败：只记日志，不改写口结论） */
  readonly log?: (line: string) => void
}

/**
 * runtime 接线面（serve 装配）：返回引擎注入用的落库口。
 * 只提供装配面——runServe 不主动触发收割，写口只在引擎第 4 相位封批时被调用。
 */
export function wireServeHarvestRecords(args: WireServeHarvestRecordsArgs): HarvestRecordSink {
  const assembly = assembleHarvestRecords(args)
  args.log?.(
    '[serve] 收割证据落口已装配：REC-EVD-01/02 → PORT-HIST（第 4 相位封批整批原子写；DEC-OPEN-13 未裁只落结构位）',
  )
  return assembly.sink
}
