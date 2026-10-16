/**
 * Studio Next · store —— 台账存储（占位）
 *
 * 定位（docs/17-§3，需求 F2）：
 *   - **可重建投影**，不是第二事实源：每一行都要能回答"权威源是谁"（F2-01）
 *   - 引擎：`node:sqlite`（零原生依赖）+ drizzle migration；WAL 单写多读
 *   - 只此一个写口：daemon 是唯一写入者；events 表 append-only（无 UPDATE/DELETE 路径）
 *   - 结果体分离：库里只存 status/hash/size/path_ref，大 payload 与 prompt 留文件（F2-03）
 *   - 核心表：events / work_records / sessions / people / personnel_events / departments /
 *     ticket_mirror / ledgers / candidates / budgets / reports / probes_runs / schema_version
 *   - 每日快照不入 git；季度删库重建演习；能力重建自 JSONL + YouTrack + 公司目录（F2-12）
 *
 * 风险与回退：node:sqlite 仍为 RC —— 切换面隔离在本包内，必要时一行换 better-sqlite3（docs/16-§六）。
 *
 * TODO(骨架阶段)：
 *   [ ] schema 定义（drizzle）+ 首次 migration
 *   [ ] 打开库的封装（WAL、busy_timeout、PRAGMA 对齐）
 *   [ ] append-only 事件写入 API（ULID、四桶互斥 token 口径）
 *   [ ] 快照/重建脚本：rebuild --from jsonl|yt|org
 *   [ ] 删库重建演习脚本与留证
 *   [ ] 数据保留与归档（>90 天事件按月导出，热表留索引，见 docs/19-§四）
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/store";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";
