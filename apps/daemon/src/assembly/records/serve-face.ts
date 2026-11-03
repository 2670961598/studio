/**
 * assembly/records/serve-face —— runtime 接线面：记录族生产写面进 ServeRuntime
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者；刀B=相位 0 名册装载／相位 4 出工段／
 * 相位 7 对账读者）；docs/v2/14 §1.6（PORT-HIST）；docs/v2/11 §〇.7（证明边界——记录落库≠执行完成）；
 * §3.1（任职链）；§2.2（授权链）。
 *
 * 拆件动机（照 assembly/ops 先例）：runtime.ts 守卫 600 行阈——本件收口「装配＋相位 0 启动装载＋
 * 装配日志」，runtime 只留一行 `records:` 注入。行为边界：装配后**只跑相位 0 名册装载**（启动装载
 * 即把任职/授权链写入台账——docs/17-§2 映射表的相位 0 位）；派发/收割相位由引擎在拍内触发。
 */
import type { Ledger } from '@studio-next/store'
import { recordRosterLoad, type RecordWire, type RecordWriteResult, type RootGrantFact } from '../../engine/records/index.ts'
import { assembleRecords } from './assemble.ts'

/** ServeRuntime 的记录面（引擎注入端口） */
export interface ServeRecordsFace {
  readonly records: RecordWire
}

/** 接线入参 */
export interface WireServeRecordsArgs {
  readonly ledger: Ledger
  readonly company: string
  /** 根授予外部事实（#530 根委任生产件注入；缺省＝AUTH-01 拒写并如实记日志） */
  readonly rootGrant?: RootGrantFact
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/**
 * 相位 0 启动装载（**必须在人事镜像 syncCompany 之后调**，否则新库名册为空）：
 * 名册 → REC-LIFE-05 / REC-AUTH-01 / REC-LIFE-01。幂等：同 recordId 重放 deduped，可随重启重跑。
 */
export function bootRecordRoster(args: {
  readonly records: RecordWire
  readonly at: number
  readonly log?: (line: string) => void
}): readonly RecordWriteResult[] {
  const bootResults = recordRosterLoad({ records: args.records, at: args.at, reason: 'boot' })
  const counts = new Map<string, number>()
  for (const result of bootResults) counts.set(result.recordType, (counts.get(result.recordType) ?? 0) + 1)
  const okCount = bootResults.filter((result) => result.ok).length
  args.log?.(
    `[serve] 记录面相位 0 启动装载完成：${okCount}/${bootResults.length} 落库（逐族 ${[...counts].map(([type, n]) => `${type}×${n}`).join('/') || '无'}）`,
  )
  const refused = bootResults.filter((result) => !result.ok)
  if (refused.length > 0) {
    const byReason = new Map<string, number>()
    for (const result of refused) {
      if (result.ok) continue
      const key = `${result.recordType}: ${result.reason}`
      byReason.set(key, (byReason.get(key) ?? 0) + 1)
    }
    for (const [reason, n] of byReason) args.log?.(`[serve] 记录面拒写 ${n} 条——${reason}`)
  }
  return bootResults
}

/** 装配记录写面并返回 runtime 片段（生产装配日志＝接线证据锚）；相位 0 装载由 bootRecordRoster 跑在 hrSync 镜像之后 */
export function wireServeRecords(args: WireServeRecordsArgs): ServeRecordsFace {
  const log = args.log
  const assembly = assembleRecords({
    ledger: args.ledger,
    company: args.company,
    ...(args.rootGrant !== undefined ? { rootGrant: args.rootGrant } : {}),
    ...(args.guardRecord !== undefined ? { guardRecord: args.guardRecord } : {}),
    ...(log !== undefined ? { log } : {}),
  })
  log?.(
    '[serve] 记录族生产写面已装配：相位 0 启动装载→REC-AUTH-01/REC-LIFE-05/REC-LIFE-01（装载在人事镜像 syncCompany 之后跑，见 bootRecordRoster）；' +
      '相位 1 采集尾→REC-WORK-01、相位 3/4/6 迁移缝→REC-WORK-06（前置/权源不齐即拒）、' +
      '相位 4 收割尾→REC-LIFE-04→REC-EVD-01（前件不齐即拒）、相位 7 落账尾→records↔events 对账读者→ PORT-HIST append',
  )
  return { records: assembly.records }
}
