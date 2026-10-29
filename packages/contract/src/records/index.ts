/**
 * records 分区出口（MIG-03 / IMPL-03-01＋IMPL-03-02）——v2/11 运行记录 13 AREA / 74 类形状落
 * `contract/src/records/`，不占 ports/ 名额
 *
 * 依据：v2/14 §二 规则②（记录族形状落 `contract/src/records/`）、v2/11 §一（74 类唯一登记处）、
 *       §0.9（REC- AREA 唯一登记处，13 AREA 封闭）、plan/02 LANE-C（records 分区不占 ports 平铺名额）、
 *       plan/05 IMPL-03-01（骨架/权责/生命周期/绩效 28 类）＋IMPL-03-02（余九族 46 类）。
 *
 * 13 件与 74 类覆盖（每族件头注列文档章节号；计数复算见 §一 表）：
 *   - envelope.ts：记录信封 `RecordEnvelope<T>`＋标量/引用/决定面/幂等键/生效槽共用件
 *   - common.ts：§2.1 通用骨架八条（CMD-01/02、DEC-01、RCP-01、COR-01、EVT-01/02/03）
 *   - auth.ts：AUTH-01..08（＋common 八条并集＝AUTH 16 类）
 *   - life.ts：LIFE-01..11（任职 6＋组织 5）
 *   - perf.ts：PERF-01
 *   - work.ts：WORK-01..18＋ACCEPT-MAINT/HANDOVER/COMMIT-CHANGE（21 类；超 600 行拆四件）——
 *     work-intent.ts（01..05）/work-state.ts（06..09＋ACCEPT-MAINT）/
 *     work-exec.ts（10/11/13/17/18）/work-close.ts（12/14/15/16＋HANDOVER/COMMIT-CHANGE）
 *   - evd.ts：EVD-01..05＋EVD-RVK（6 类）
 *   - acc.ts：ACC-01/02｜chg.ts：CHG-01｜cap.ts：CAP-01/02/RECEIPT/ACTIVATE（4 类）
 *   - rev.ts：REV-01｜eval.ts：EVAL-01｜asset.ts：ASSET-01/02｜obs.ts：OBS-01..04｜mem.ts：MEM-01..04
 *   - emp-neg.ts：NEG-EMP-02/04/06/07/08/09 纯判定件（**不新增记录类/不改冻结字段**——74 类计数不变，
 *     输入面＝已解析记录面声明；依据 v2/17 §4.1 与 v2/02 §一/§3.4/§五/§六/§七/§九）
 *
 * 计数（不改文档、不新增记录类）：16＋11＋1＋21＋6＋2＋1＋4＋1＋1＋2＋4＋4＝74。
 */
import type { ZodType } from 'zod'
import { ACC_RECORD_SCHEMAS, ACC_RECORD_TYPES } from './acc.ts'
import { ASSET_RECORD_SCHEMAS, ASSET_RECORD_TYPES } from './asset.ts'
import { AUTH_RECORD_SCHEMAS, AUTH_RECORD_TYPES } from './auth.ts'
import { CAP_RECORD_SCHEMAS, CAP_RECORD_TYPES } from './cap.ts'
import { CHG_RECORD_SCHEMAS, CHG_RECORD_TYPES } from './chg.ts'
import { EVD_RECORD_SCHEMAS, EVD_RECORD_TYPES } from './evd.ts'
import { EVAL_RECORD_SCHEMAS, EVAL_RECORD_TYPES } from './eval.ts'
import { LIFE_RECORD_SCHEMAS, LIFE_RECORD_TYPES } from './life.ts'
import { MEM_RECORD_SCHEMAS, MEM_RECORD_TYPES } from './mem.ts'
import { OBS_RECORD_SCHEMAS, OBS_RECORD_TYPES } from './obs.ts'
import { PERF_RECORD_SCHEMAS, PERF_RECORD_TYPES } from './perf.ts'
import { REV_RECORD_SCHEMAS, REV_RECORD_TYPES } from './rev.ts'
import { WORK_RECORD_SCHEMAS, WORK_RECORD_TYPES } from './work.ts'

export * from './envelope.ts'
export * from './common.ts'
export * from './auth.ts'
export * from './life.ts'
export * from './perf.ts'
export * from './work.ts'
export * from './evd.ts'
export * from './acc.ts'
export * from './chg.ts'
export * from './cap.ts'
export * from './rev.ts'
export * from './eval.ts'
export * from './asset.ts'
export * from './obs.ts'
export * from './mem.ts'
export * from './emp-neg.ts'

/** §一 74 类全登记（序：§一 表序；13 AREA 各自封闭） */
export const ALL_RECORD_TYPES = [
  ...AUTH_RECORD_TYPES,
  ...LIFE_RECORD_TYPES,
  ...PERF_RECORD_TYPES,
  ...WORK_RECORD_TYPES,
  ...EVD_RECORD_TYPES,
  ...ACC_RECORD_TYPES,
  ...CHG_RECORD_TYPES,
  ...CAP_RECORD_TYPES,
  ...REV_RECORD_TYPES,
  ...EVAL_RECORD_TYPES,
  ...ASSET_RECORD_TYPES,
  ...OBS_RECORD_TYPES,
  ...MEM_RECORD_TYPES,
] as const

export type AllRecordType = (typeof ALL_RECORD_TYPES)[number]

/** 形状闸并集：74 类每类恰有 payload/记录 schema（未登记类型不可解析） */
export const ALL_RECORD_SCHEMAS: Readonly<Record<AllRecordType, ZodType>> = {
  ...AUTH_RECORD_SCHEMAS,
  ...LIFE_RECORD_SCHEMAS,
  ...PERF_RECORD_SCHEMAS,
  ...WORK_RECORD_SCHEMAS,
  ...EVD_RECORD_SCHEMAS,
  ...ACC_RECORD_SCHEMAS,
  ...CHG_RECORD_SCHEMAS,
  ...CAP_RECORD_SCHEMAS,
  ...REV_RECORD_SCHEMAS,
  ...EVAL_RECORD_SCHEMAS,
  ...ASSET_RECORD_SCHEMAS,
  ...OBS_RECORD_SCHEMAS,
  ...MEM_RECORD_SCHEMAS,
}

/** 74 类计数（§一 复算：16/11/1/21/6/2/1/4/1/1/2/4/4） */
export const RECORD_TYPE_COUNT = ALL_RECORD_TYPES.length
