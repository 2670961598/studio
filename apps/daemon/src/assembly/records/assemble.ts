/**
 * assembly/records/assemble —— PORT-HIST 记录写口生产装配（主循环记录族）
 *
 * 依据：docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表）；docs/17-§6；
 * docs/v2/14 §1.6（PORT-HIST 唯一记录写口）；docs/v2/11 §〇（信封）/§0.4-5（幂等）。
 *
 * 行为边界：
 *   - 一 serve 进程一实例；`createHistFace(ledger.db)`（v14 迁移由 openLedger 完成）；
 *   - 写前过三不入·库闸（`guardRecord`，runtime 传 outbound.gate.guardStoreRecord）；
 *   - 本件零权源判定：记录该不该写、前置是否齐，全在 engine/records/{drafts,life,authority}.ts 的闸；
 *   - 记录写失败不打断拍（wire 三态回报），事件面照旧——欠账由 projection 对账（wire.reconcile）发现；
 *   - 名册端口从 ledger 读时派生（热更新下一拍即生效）；根授予外部事实由装配入参注入（缺省＝AUTH-01 拒写）。
 */
import type { Ledger } from '@studio-next/store'
import { createHistFace, type HistFace } from '@studio-next/store'
import { createRecordWire, rosterOf, type RecordWire, type RootGrantFact, type RosterPort } from '../../engine/records/index.ts'

/** 装配入参 */
export interface AssembleRecordsDeps {
  readonly ledger: Ledger
  readonly company: string
  /** 根授予外部事实（#530 根委任生产件注入；缺省＝无外部事实→AUTH-01 拒写，见 engine/records/authority.ts） */
  readonly rootGrant?: RootGrantFact
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/** 装配面（records=引擎注入端口；hist=只读/对账面） */
export interface RecordsAssembly {
  readonly records: RecordWire
  readonly hist: HistFace
}

/** 名册端口：读时取（不缓存）——公司目录热更新下一拍即生效（docs/38-§2 L1） */
function rosterPortOf(ledger: Ledger): RosterPort {
  return { roster: () => rosterOf(ledger.listPeople(), ledger.listDepartments()) }
}

/** 建记录写面（幂等装配：每次调用新建 hist 句柄，不共享事务） */
export function assembleRecords(deps: AssembleRecordsDeps): RecordsAssembly {
  const hist = createHistFace(deps.ledger.db)
  const records = createRecordWire({
    hist,
    company: deps.company,
    roster: rosterPortOf(deps.ledger),
    // 对账读者（#559 验收项）：事件面读自 ledger（增量窗口下界 when）；缺省不注入＝只跑记录侧
    readEvents: (since) => deps.ledger.queryEvents({ company: deps.company, ...(since > 0 ? { since } : {}) }),
    ...(deps.rootGrant !== undefined ? { rootGrant: deps.rootGrant } : {}),
    ...(deps.guardRecord !== undefined ? { guardRecord: deps.guardRecord } : {}),
    ...(deps.log !== undefined ? { log: deps.log } : {}),
  })
  return { records, hist }
}
