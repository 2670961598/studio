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
 *
 * studio-dev-537 增量（返工版；#527/#605 已落内容零删改）：五对象记录载体（REC-ACC-01/02、
 * REC-CHG-01、REC-REV-01、REC-EVAL-01）写口装配也挂在本件——复用 `assembleRecords` 产出的
 * **同一 HIST 面**（不二次建句柄、不另开第二条 SQL 写口）；本件只提供显式写面＋相位 4 GATE_FAIL
 * 钩（docs/17-§2、docs/17-§6），决定者由生产位置注入、缺位拒写，不以 daemon 冒充；与 #530
 * `root-delegation/worker-key-face.ts` 无交集（wkey 签发/吊销仍由 runtime 的 import/调用链持有）。
 */
import type { HistFace, Ledger } from '@studio-next/store'
import type { RelayWorkSignal } from '../../engine/intents/relay-resume-sources.ts'
import { recordRosterLoad, type RecordWire, type RecordWriteResult, type RootGrantFact } from '../../engine/records/index.ts'
import {
  createObjectRecordWire,
  type ObjectRecordPositions,
  type ObjectRecordWire,
} from '../../engine/records/object-wire.ts'
import { assembleRecords } from './assemble.ts'

/** ServeRuntime 的记录面（引擎注入端口） */
export interface ServeRecordsFace {
  readonly records: RecordWire
  /** 同一 HIST 句柄（五对象载体复用；不另建第二句柄） */
  readonly hist: HistFace
  /** 五对象载体面（显式写口＋相位 4 收割钩；装配在本件，runtime 只挂一行钩） */
  readonly objectRecords: ServeObjectRecordsFace
}

/** 接线入参 */
export interface WireServeRecordsArgs {
  readonly ledger: Ledger
  readonly company: string
  /** 根授予外部事实（#530 根委任生产件注入；缺省＝AUTH-01 拒写并如实记日志） */
  readonly rootGrant?: RootGrantFact
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  /** 记录时刻源（runtime 注入同一 clock；五对象载体与引擎同源，不各自取 Date.now） */
  readonly clock: () => number
  /** 五对象载体生产位置（缺省=载体不开面——独立裁判/复盘/评价位置由生产侧注入，不以 daemon 冒充） */
  readonly positions?: ObjectRecordPositions
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
  const objectRecords = wireServeObjectRecords({
    ledger: args.ledger,
    hist: assembly.hist,
    company: args.company,
    clock: args.clock,
    ...(args.positions !== undefined ? { positions: args.positions } : {}),
    ...(log !== undefined ? { log } : {}),
  })
  return { records: assembly.records, hist: assembly.hist, objectRecords }
}

/** 五对象载体装配入参（hist＝#527 已建 HIST 面；clock 注入令记录时刻与引擎同源） */
export interface WireServeObjectRecordsArgs {
  readonly ledger: Ledger
  /** #527 assembleRecords 产出的 HIST 面（复用；不另建句柄） */
  readonly hist: HistFace
  readonly company: string
  readonly clock: () => number
  /** 生产位置注入（缺省=对应载体不开面；决定者不得由 daemon 冒充——v2/11 §〇.2-1） */
  readonly positions?: ObjectRecordPositions
  readonly log?: (line: string) => void
}

/** ServeRuntime 的五对象载体面（engine 相位 4 钩子消费 + 显式写口） */
export interface ServeObjectRecordsFace {
  /** 五对象写口（显式面：复盘/变更/救济/评价由各自生产位置调用） */
  readonly records: ObjectRecordWire
  /** 引擎相位 4 收割完成钩（GATE_FAIL→ACC-01；completed=零行为；钩面异常不炸拍） */
  readonly afterHarvest: (signal: RelayWorkSignal) => void
}

/** 钩面结果日志（软失败：只记日志，不改收割结论） */
function noteOutcome(log: (line: string) => void, signal: RelayWorkSignal, outcome: ReturnType<ObjectRecordWire['afterHarvest']>): void {
  if (outcome.status === 'written') {
    log(`[records] 相位4 ${signal.ticket} att${signal.attempt} → REC-ACC-01 #${outcome.ref.recordId}（问责案例开案，结论=暂不能归因）`)
    return
  }
  if (outcome.status === 'refused') log(`[records] 相位4 ${signal.ticket} att${signal.attempt} → 拒写 REC-ACC-01（${outcome.code}）：${outcome.detail}`)
}

/**
 * 装配五对象载体写口（#527/#530 边界：HIST 面复用 #527、wkey 面不触）：
 *   - HIST 面＝调用方传入的 #527 同一 `HistFace`（records 表；v14 迁移由 openLedger 完成）；
 *   - 相位 4 钩子：GATE_FAIL → REC-ACC-01（独立裁判位置在场才开案）；
 *   - 装配日志显式（生产装配证据锚）；不调用任何写口。
 */
export function wireServeObjectRecords(args: WireServeObjectRecordsArgs): ServeObjectRecordsFace {
  const log = args.log ?? ((): void => undefined)
  const records = createObjectRecordWire({
    hist: args.hist,
    company: args.company,
    now: args.clock,
    ...(args.positions !== undefined ? { positions: args.positions } : {}),
    log,
  })
  log('[serve] 五对象记录载体写口已装配：REC-ACC-01/02、REC-CHG-01、REC-REV-01、REC-EVAL-01 → PORT-HIST（相位 4 GATE_FAIL→ACC-01；其余=生产位置显式写口）')
  return {
    records,
    afterHarvest: (signal: RelayWorkSignal): void => {
      try {
        noteOutcome(log, signal, records.afterHarvest(args.ledger, signal))
      } catch (error) {
        log(`[records] 相位4 载体钩异常（不阻断收割）：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
