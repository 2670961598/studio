/**
 * Studio Next · store —— 台账存储（SQLite 可重建投影）
 *
 * 定位（docs/17-§3，需求 F2）：
 *   - **可重建投影**，不是第二事实源：每一行都要能回答"权威源是谁"（F2-01）
 *   - 引擎：`node:sqlite`（DatabaseSync，零原生依赖）+ 手写薄 migration runner
 *     （schema_version 表 + 顺序 SQL，见 migrations.ts）——drizzle 探测结论见 driver.ts 头注
 *     （稳定线无 node:sqlite 驱动，留待后续单，如实记录）
 *   - 只此一个写口：daemon 是唯一写入者；events 表 append-only（无 UPDATE/DELETE 路径）
 *   - 结果体分离：库里只存 status/size/hash/路径引用，大 payload 与 prompt 留文件（F2-03）
 *
 * TODO：
 *   [x] v0.2 首刀三表：events / work_records / sessions（migration v1，17-§3 列集）
 *   [x] 打开库封装 openLedger（WAL / synchronous / foreign_keys / busy_timeout PRAGMA 对齐）
 *   [x] appendEvent：contract validateEventRecord 前置闸（非法 CONFIG_INVALID 拒入账）+
 *       同 id 幂等规则（拟稿待批）；canonical tokens 序列化（F2-11 哈希比对前提）
 *   [x] 查询面：queryEvents（company/issue/since/until/limit，恒升序）；
 *       work_records / sessions insert/get/list
 *   [x] 快照/重建：dumpEvents（库 → JSONL 单向派生）+ rebuild（JSONL → 新库，单事务原子，
 *       坏行中止且指明行号）；删库重建演习测试落 test/rebuild.test.ts
 *   [ ] 17-§3 其余表（后续 migration 逐版本补）：people / personnel_events / departments /
 *       ticket_mirror / ledgers / candidates / budgets / reports / probes_runs
 *   [ ] 回填工具（F2-13：done.json/REPORT/stream/events → 对账 → 幂等回填；旁路关单标注规则）
 *   [ ] rebuild --from yt,org 两源通道（F2-12 全量再生；现仅 jsonl 源）
 *   [ ] 季度删库演习脚本化留证（cron 岗，v0.4 定时岗落地后挂）
 *   [ ] 数据保留与归档（>90 天事件按月导出，热表留索引，见 docs/19-§四）
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = '@studio-next/store'

/** 状态标记：v0.2 首刀范围（三表+查询面+快照/重建）已落地；其余表与回填工具见上方 TODO */
export const PACKAGE_STATUS = 'partial'

// 引擎边界（better-sqlite3 一行切换点，16-§六）
export { openSqlite } from './driver.ts'

// 薄 migration runner（schema_version 表）
export { currentVersion, migrate, LATEST_VERSION } from './migrations.ts'
export type { Migration } from './migrations.ts'

// 台账句柄与读写面
export { openLedger } from './ledger.ts'
export type { AppendResult, DumpResult, EventQuery, Ledger } from './ledger.ts'

// work_records / sessions 记录形状（store 层临时闸，contract schema 落地后替换）
export { SessionRecordSchema, WorkRecordSchema } from './records.ts'
export type { SessionRecord, WorkRecord } from './records.ts'

// 快照与重建
export { rebuild } from './rebuild.ts'
export type { RebuildResult } from './rebuild.ts'
