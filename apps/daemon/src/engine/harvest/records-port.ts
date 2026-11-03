/**
 * harvest/records-port —— 引擎侧收割证据落库端口装配（第 4 相位封批）
 *
 * 依据（实现单引用）：docs/17-§2（主循环七相位·第 4 位＝收割）/§6（收割四要件判据不改）；
 *   docs/v2/14 §1.6（PORT-HIST 唯一记录写口）；docs/v2/11 §六（REC-EVD-01/02）；
 *   docs/20-§十五.三（先拆再增：engine 侧注入面与端口装配析出成件，engine.ts 只留装配）。
 *
 * 职责（单一面）：把「批次簿＋可选落库口」装成引擎消费者面——
 *   - 注入落库口（`EngineDeps.harvestRecords`）＝**录制簿**：封批时整批原子写 REC-EVD-02×N＋REC-EVD-01×1；
 *   - 缺省不注入＝**纯内存簿**：旧行为字节不变（面关零行为，D9 纪律）。
 * 本件零记录形状（映射归 records.ts）、零事务实现（显式 tx 归 assembly/harvest/records.ts）、
 * 零权限判定（三不入·库闸在写口装配面）。
 */
import { createHarvestBatchLedger, type HarvestBatchLedger } from './batch.ts'
import { createHarvestRecordingLedger, type HarvestRecordSink, type HarvestRecordingView } from './records.ts'

/**
 * 引擎可选注入面（`EngineDeps` 组合进来；docs 归本件——20-§十五.三 先拆再增）。
 */
export interface HarvestRecordingDeps {
  /**
   * 收割证据批次落库口（REC-EVD-01/02 → PORT-HIST；可选注入）：注入＝引擎第 4 相位封批时整批
   * 原子写记录（装配见 assembly/harvest/records.ts）；缺省不注入＝只留内存结构位（零行为变更）。
   * 写失败不翻转四要件判据（记录面是投影），但批次判不可作验收输入（fail-closed）。
   */
  harvestRecords?: HarvestRecordSink
}

/**
 * 引擎只读观测面（`Engine` 组合进来）：证据落库视图——未注入落库口＝空数组；
 * 写口仅第 4 相位封批一次（本件只暴露读面，不提供写入口）。
 */
export interface HarvestRecordingObservation {
  /** 收割证据落库观测面（REC-EVD-01/02；未注入落库口＝空）：只读视图；写口仅第 4 相位封批一次 */
  readonly harvestRecordings: readonly HarvestRecordingView[]
}

/** 引擎消费面：批次簿（相位 4 编排用）＋证据落库只读观测面（未注入落库口＝空） */
export interface HarvestRecordingPort {
  readonly batches: HarvestBatchLedger
  recordings(): readonly HarvestRecordingView[]
}

/**
 * 装配收割证据端口（一引擎一实例）：簿可由调用方传入（runtime 传既有簿以保 harvestBatches
 * 同一实例），缺省端口内建（观测/测试只读，写口仅收割相位）——注入落库口时以录制簿装饰
 * 原簿，封批整批原子写；缺省返回纯内存簿。
 */
export function wireHarvestRecordingPort(args: {
  readonly sink: HarvestRecordSink | undefined
  readonly company: string
  readonly now: () => number
  /** 批次簿（可选；缺省本件新建——runtime 传既有簿以保 harvestBatches 同一实例） */
  readonly book?: HarvestBatchLedger
}): HarvestRecordingPort {
  const book = args.book ?? createHarvestBatchLedger()
  if (args.sink === undefined) {
    return {
      batches: book,
      recordings: (): readonly HarvestRecordingView[] => [],
    }
  }
  const recording = createHarvestRecordingLedger(book, { sink: args.sink, company: args.company, now: args.now })
  return {
    batches: recording,
    recordings: (): readonly HarvestRecordingView[] => recording.recordings(),
  }
}
