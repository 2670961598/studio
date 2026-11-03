/**
 * assembly/records —— 记录族生产写面装配（studio-dev-527）
 *
 * 依据：docs/17-§2「记录族生产写面」段；docs/v2/14 §1.6（PORT-HIST 唯一记录写口）；
 * docs/v2/11 §0.2/§0.7（责任主体与证明边界）。
 *
 * 件面：`assemble.ts`（createRecordWire＋`createHistFace(ledger.db)`＋出站闸注入）、
 * `serve-face.ts`（runtime 一行接线＋装配日志——照 assembly/ops 先例）。
 * 子域目录（assembly/records/）按域平面纪律新增，不占 assembly/ 直属散件基线。
 */
export { assembleRecords, type AssembleRecordsDeps, type RecordsAssembly } from './assemble.ts'
export { wireServeRecords, type ServeRecordsFace, type WireServeRecordsArgs } from './serve-face.ts'
