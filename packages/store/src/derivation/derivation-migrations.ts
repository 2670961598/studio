/**
 * derivation-migrations —— v17 派生树登记账本（GAP-V2-04 S6；append-only）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/07 §四「派生即登记」三规则：父引用/后端形态/能力子集/凭据类别＋逻辑引用/时点
 *     必须可审计；登记账本是执行体派生树的持久投影，不是凭据事实源。
 *   - docs/v2/11 §2.2 REC-AUTH-03（descendants[]＋deactivation_evidence）与 REC-AUTH-04
 *     （凭据逻辑引用无值）；docs/v2/15 §六 SEC-REV-01（逐个停用证据）；docs/17-§2（派发前
 *     判定）／§6（撤回完成须以证据面收口）。
 *   - docs/v2/16 §三 store 行：append-only 由**触发器机制**保证（personnel_events 同款），
 *     不靠调用方自律。
 *
 * 落位理由（20-§十五.三「先拆再增」）：`migrations.ts` 已顶 600 行尺寸阈，条目体外置到本文件，
 * 由 `records-migrations.ts` 摊入 MIGRATIONS；v14/v15 同款先例。
 *
 * 三表（全部 append-only；UPDATE/DELETE 由触发器 RAISE(ABORT) 拒绝）：
 *   - `derivation_registry`：派生登记行（一 derivation_id 一行；同 id 异内容=写面拒）；
 *   - `derivation_catalog`：凭据目录**逻辑引用**投影（无值/无路径；供重启时目录重建）；
 *   - `derivation_revocation`：撤回传播行（scope=credential|derivation；同目标同 record 幂等）。
 *
 * 边界（如实登记）：
 *   - 本表是「可重建投影」而不是第二事实源：目录/执行体的权威状态仍在 gateway 的内存判定面，
 *     本表只保证启动重建所需的最小持久面；删除本表不会改变既有记录族（records/events）。
 *   - 不含任何凭据值（三不入）：`derivation_catalog` 存的是 `CatalogEntryDraft` 的逻辑引用，
 *     值提供者只以 `valueProvider` 逻辑描述出现（env-ref/file-ref/local-mint 等）。
 */
import type { Migration } from '../migrations.ts'

/** v17：派生树登记账本三表＋append-only 触发器（GAP-V2-04 S6） */
export const derivationLedgerMigration: Migration = {
  version: 17,
  name: 'GAP-V2-04 S6：派生树登记账本（append-only；derivation_registry/catalog/revocation）',
  sql: [
    'CREATE TABLE derivation_registry (',
    '  seq INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  derivation_id TEXT NOT NULL UNIQUE,',
    '  parent_derivation_id TEXT,',
    '  ticket TEXT NOT NULL,',
    '  executor TEXT NOT NULL,',
    '  executor_name TEXT,',
    '  backend TEXT NOT NULL,',
    '  capability_subset TEXT NOT NULL,',
    '  credentials TEXT NOT NULL,',
    '  inheritance TEXT,',
    '  derived_at TEXT NOT NULL,',
    '  registered_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX idx_derivation_registry_ticket ON derivation_registry (ticket, executor);',
    "CREATE TRIGGER trg_derivation_registry_no_update BEFORE UPDATE ON derivation_registry BEGIN SELECT RAISE(ABORT, 'derivation_registry 为 append-only（GAP-V2-04）：UPDATE 被拒'); END;",
    "CREATE TRIGGER trg_derivation_registry_no_delete BEFORE DELETE ON derivation_registry BEGIN SELECT RAISE(ABORT, 'derivation_registry 为 append-only（GAP-V2-04）：DELETE 被拒'); END;",
    'CREATE TABLE derivation_catalog (',
    '  seq INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  secret_id TEXT NOT NULL UNIQUE,',
    '  draft TEXT NOT NULL,',
    '  registered_at INTEGER NOT NULL',
    ');',
    "CREATE TRIGGER trg_derivation_catalog_no_update BEFORE UPDATE ON derivation_catalog BEGIN SELECT RAISE(ABORT, 'derivation_catalog 为 append-only（GAP-V2-04）：UPDATE 被拒'); END;",
    "CREATE TRIGGER trg_derivation_catalog_no_delete BEFORE DELETE ON derivation_catalog BEGIN SELECT RAISE(ABORT, 'derivation_catalog 为 append-only（GAP-V2-04）：DELETE 被拒'); END;",
    'CREATE TABLE derivation_revocation (',
    '  seq INTEGER PRIMARY KEY AUTOINCREMENT,',
    "  scope TEXT NOT NULL CHECK (scope IN ('credential','derivation')),",
    '  target_id TEXT NOT NULL,',
    '  record_id TEXT NOT NULL,',
    '  evidence_ref TEXT NOT NULL,',
    '  revoked_at INTEGER NOT NULL,',
    '  UNIQUE (scope, target_id, record_id)',
    ');',
    "CREATE TRIGGER trg_derivation_revocation_no_update BEFORE UPDATE ON derivation_revocation BEGIN SELECT RAISE(ABORT, 'derivation_revocation 为 append-only（GAP-V2-04）：UPDATE 被拒'); END;",
    "CREATE TRIGGER trg_derivation_revocation_no_delete BEFORE DELETE ON derivation_revocation BEGIN SELECT RAISE(ABORT, 'derivation_revocation 为 append-only（GAP-V2-04）：DELETE 被拒'); END;",
    '',
  ].join('\n'),
}

/** 摊入 MIGRATIONS 的条目序列（version 单调 +1；v16 为 events 哈希链，本件为 v17；当前末条目见 records-migrations.ts） */
export const derivationMigrations: readonly Migration[] = [derivationLedgerMigration]
