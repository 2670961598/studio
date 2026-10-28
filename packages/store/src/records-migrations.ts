/**
 * records-migrations —— MIG-04 迁移条目体（v14 records 表族 ＋ v15 events 防改触发器）
 *
 * 依据：plan/05 IMPL-04-01（v14）／IMPL-04-02（v15）；docs/v2/11 §〇（信封、§0.4 身份/幂等、§0.5 时间
 *   分层）／§一（74 类唯一登记处）／§0.9（13 AREA 封闭登记）；docs/v2/05 §三 DOM-03/04/05（records
 *   ＝DOM-05 记录投影，**不是第四事实源**）；docs/v2/15 §一 SEC-FC-04（events no-update/no-delete，
 *   负向行 NEG-SEC-03）；docs/v2/16 §四（cost_daily 限域——本文件不碰 DOM-04）。
 *
 * 落位理由（BC-S2「先拆再增」）：`migrations.ts` 已顶 600 行尺寸阈（v12 条目落 `cost.ts` 同款先例）——
 *   条目体落本文件，`migrations.ts` 只 import 摊入；版本序列仍按 14／15 单调 +1，sha8 由条目自身 SQL
 *   决定（与内联在 `migrations.ts` 等价，`schema_version.sha8` 防漂移口径不变）。
 */
import type { Migration } from './migrations.ts'

/**
 * v14：记录族落表（DOM-05 记录投影；IMPL-04-01）
 *
 * **单表 `records`，不为 74 类各建宽表**（本刀裁定，理由三条）：
 *   1. 74 类（v2/11 §一）的字段差异已在 MIG-03／IMPL-03-01..02 落 contract
 *      （`packages/contract/src/records/`）=形状唯一源；逐类再建宽表即造「第二套字段表」，与契约
 *      漂移面按 n×字段 放大，且违反 §0.6 枚举/形状零重述纪律；
 *   2. 库侧需要**机械可判**的只有信封维（身份/类型/域/时刻/生产者/证明边界/生效/版本链/幂等），
 *      族内细节一律读写 `payload` JSON ＋ `schema_ref` 指向冻结形状（v2/10 §4.1）；
 *   3. 74 张窄表对查询面无收益：跨族查询（观察面/审计/对账）恰要按信封维扫，单表两索引即覆盖。
 *
 * DOM-05＝DOM-03 的记录投影（v2/05 §三）：**不是第四事实源**、不得自称权威。本刀只建表/索引、
 *   零写数据——写口与契约校验归 IMPL-04-06（records.ts 单写者），投射来源仍是 events（DOM-03；
 *   v15 正是该源的防改面）。
 *
 * 列与约束的取舍：
 *   - `record_area`：v2/11 §0.9 十三 AREA 封闭登记 → 列级 CHECK 兜底（AUTH 族含通用骨架
 *     CMD/DEC/RCP/COR/EVT 五前缀，故 area≠record_type 第二段，不能由 type 派生）；
 *     `effective_state` 三值属 v2/09 ENU-62 唯一主表，本表**不加 CHECK**（不复制枚举字面量，§0.6）。
 *   - `produced_at`/`effective_time`/`created_at` 存 epoch ms（库内时间列统一口径；信封 Timestamp 串
 *     ↔毫秒的转换归写面）；payload 永不含 `until` 或任何区间型窗口字段（§0.5：区间终点唯一存放点
 *     是信封）。
 *   - 幂等：`UNIQUE(company, record_type, idempotency_key) WHERE idempotency_key IS NOT NULL`——
 *     §0.4-5 通用作用域第①元＝公司标识；partial 索引＝键缺省时不约束（v12 cost_daily 的同款手法）；
 *     同键异内容＝写面拒（IMPL-04-06），库侧唯一索引兜底防双写。
 *   - `revises`＝前一版 `record_id`（§0.4-1：修改产生新版本、旧版本保留）；无 FK（软引用，容忍重建
 *     期的插入顺序）。
 *   - 三索引＝三查询面：公司×域×时刻（观察面/审计扫描）、类型×时刻（族级对账）、幂等键（防双写）。
 */
export const recordsMigration: Migration = {
  version: 14,
  name: 'MIG-04 记录族落表：records（DOM-05 投影；IMPL-04-01）',
  sql: [
    'CREATE TABLE records (',
    '  record_id TEXT PRIMARY KEY, record_type TEXT NOT NULL,',
    "  record_area TEXT NOT NULL CHECK (record_area IN ('AUTH','LIFE','PERF','WORK','EVD','ACC','CHG','CAP','REV','EVAL','ASSET','OBS','MEM')),",
    '  schema_ref TEXT NOT NULL, spec_version TEXT NOT NULL,',
    '  company TEXT NOT NULL, produced_at INTEGER NOT NULL,',
    '  producer TEXT NOT NULL, payload TEXT NOT NULL,',
    '  proof_boundary TEXT, effective_state TEXT,',
    '  effective_time INTEGER, revises TEXT,',
    '  idempotency_key TEXT, created_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX idx_records_company_area_time ON records (company, record_area, produced_at);',
    'CREATE INDEX idx_records_type_time ON records (record_type, produced_at);',
    "CREATE UNIQUE INDEX idx_records_idem ON records (company, record_type, idempotency_key) WHERE idempotency_key IS NOT NULL;",
    '',
  ].join('\n'),
}

/**
 * v15：events 防改触发器（SEC-FC-04 收口；IMPL-04-02；v2/15 §一，负向行 NEG-SEC-03）
 *
 * v1 建表体**一字不动**（sha8 已锁：改 DDL 会让存量库的 schema_version.sha8 对不上而 CONFIG_INVALID
 * 拒开），只补两枚行级触发器——与 personnel_events / probes_runs / price_snapshots / cost_daily
 * 同机制（B10 同款，`SEC-FC-04 现状`列点名的唯一缺口）。INSERT 不受限（append-only 只拒改/删）。
 *
 * 边界（如实登记，不冒充已闭合）：
 *   - DROP TABLE 不被行级触发器拦：删库重建仍是合法演习路径，rebuild 重放可行（B11 零 cost 重放）；
 *   - 哈希链或等价物承接不变量 I-17 仍属**目标（未证）**（GAP-V2-05）——本刀只完成「改/删 events
 *     必须被拒」这一腿，不得据此宣称 append-only 已机制化。
 */
export const eventsTriggersMigration: Migration = {
  version: 15,
  name: 'MIG-04 events append-only 触发器（SEC-FC-04；IMPL-04-02）',
  sql: [
    'CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON events BEGIN',
    "  SELECT RAISE(ABORT, 'events is append-only');",
    'END;',
    'CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON events BEGIN',
    "  SELECT RAISE(ABORT, 'events is append-only');",
    'END;',
    '',
  ].join('\n'),
}

/**
 * 摊入 `migrations.ts` 的条目序列（**升序**：14 → 15；`LATEST_VERSION` 取末条 version，故运行时＝15）。
 * 后续 MIG 波次新增迁移条目时按同法追加（版本单调 +1，禁跳号）。
 */
export const recordsMigrations: readonly Migration[] = [recordsMigration, eventsTriggersMigration]
