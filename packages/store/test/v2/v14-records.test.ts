/**
 * test/v2/v14-records —— v14 记录族落表（`records`／DOM-05 记录投影）＋ v15 版本序列
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-01（v14 记录族 DDL；验收：B9 复算含 14、`LATEST_VERSION` 单调 +1、
 *     `test:v2` 绿、无双写）／IMPL-04-02（v15 封顶，故本文件同时钉 `LATEST_VERSION=15`）
 *   - docs/v2/11 §〇（通用记录契约：§0.4 身份/幂等、§0.5 时间分层、§0.7 证明边界）／§一（74 类
 *     唯一登记处）／§0.9（13 AREA 封闭登记）
 *   - docs/v2/05 §三 DOM-03/04/05（`records`＝DOM-05 记录投影，**不是第四事实源**）
 *   - docs/v2/10 §4.1（`schemaRef`/`specVersion` 形状唯一主表——本表只存引用串）
 *   - plan/04 §二 MIG-04 门（②版本序列；本文件用 `currentVersion` 作机械口径，见下「版本口径」）
 *
 * 版本口径（不臆造）：本仓**不用** `PRAGMA user_version`（`migrations.ts` 头注：版本唯一源＝
 *   `schema_version` 表）。故「迁移后版本」一律断 `currentVersion(db)`；另有一条显式断言把
 *   `PRAGMA user_version` 钉在 0，防止后人把两套口径混用（`user_version` 恒 0 是**事实登记**，
 *   不是缺陷断言）。
 *
 * 隔离：临时目录真文件（`os.tmpdir()`）＋升级路径用 `:memory:`；**不碰真实台账库**、不读环境。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSqlite } from '../../src/driver.ts'
import { LATEST_VERSION, currentVersion, migrate } from '../../src/migrations.ts'
import { eventsTriggersMigration, recordsMigration, recordsMigrations } from '../../src/records-migrations.ts'

/** v2/11 §0.9 十三 AREA（封闭登记；AUTH 族含通用骨架 CMD/DEC/RCP/COR/EVT 五前缀） */
const RECORD_AREAS = [
  'AUTH',
  'LIFE',
  'PERF',
  'WORK',
  'EVD',
  'ACC',
  'CHG',
  'CAP',
  'REV',
  'EVAL',
  'ASSET',
  'OBS',
  'MEM',
] as const

/** 设计列序（plan/05 IMPL-04-01；顺序即本单裁定，见 records-migrations.ts v14 头注） */
const COLUMNS = [
  'record_id',
  'record_type',
  'record_area',
  'schema_ref',
  'spec_version',
  'company',
  'produced_at',
  'producer',
  'payload',
  'proof_boundary',
  'effective_state',
  'effective_time',
  'revises',
  'idempotency_key',
  'created_at',
] as const

/** 显式 NOT NULL 列（record_id 走 PRIMARY KEY 声明——见下「PRAGMA 口径」注，故不在本表） */
const NOT_NULL_COLUMNS = [
  'record_type',
  'record_area',
  'schema_ref',
  'spec_version',
  'company',
  'produced_at',
  'producer',
  'payload',
  'created_at',
] as const

const T0 = Date.UTC(2026, 9, 28, 2, 0, 0)

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  pk: number
}

function columnsOf(db: DatabaseSync, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[]
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  return row !== undefined
}

function triggerNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name").all(
    table,
  ) as unknown as Array<{ name: string }>
  return rows.map((r) => String(r.name))
}

/** 一条最简可插记录（未给的可空列留 NULL；键位可覆写） */
function recordRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_id: '01JREC000000000000000001',
    record_type: 'REC-EVD-01',
    record_area: 'EVD',
    schema_ref: 'rec.evd-01',
    spec_version: '2.1.0',
    company: 'studio-dev',
    produced_at: T0,
    producer: 'owner:ENG-1',
    payload: '{"summary":"证据摘要"}',
    created_at: T0 + 1,
    ...over,
  }
}

const INSERT_SQL = [
  'INSERT INTO records',
  '  (record_id, record_type, record_area, schema_ref, spec_version, company, produced_at, producer, payload,',
  '   proof_boundary, effective_state, effective_time, revises, idempotency_key, created_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
].join('\n')

function insertRecord(db: DatabaseSync, over: Record<string, unknown> = {}): void {
  const row = recordRow(over)
  db.prepare(INSERT_SQL).run(
    String(row['record_id']),
    String(row['record_type']),
    String(row['record_area']),
    String(row['schema_ref']),
    String(row['spec_version']),
    String(row['company']),
    Number(row['produced_at']),
    String(row['producer']),
    String(row['payload']),
    row['proof_boundary'] === undefined ? null : String(row['proof_boundary']),
    row['effective_state'] === undefined ? null : String(row['effective_state']),
    row['effective_time'] === undefined ? null : Number(row['effective_time']),
    row['revises'] === undefined ? null : String(row['revises']),
    row['idempotency_key'] === undefined ? null : String(row['idempotency_key']),
    Number(row['created_at']),
  )
}

let root = ''
let db: DatabaseSync

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v14-'))
  db = openSqlite(path.join(root, 'ledger.db'))
  migrate(db)
})

afterAll(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('版本序列（B9 复算：v1..v15 单调 +1，v12 在 cost.ts、v14/v15 在 records-migrations.ts）', () => {
  it('LATEST_VERSION=15 且新库直达 15（v14 记录族 + v15 触发器同批落地）', () => {
    expect(LATEST_VERSION).toBe(15)
    expect(currentVersion(db)).toBe(15)
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_version').get()).toEqual({ v: 15 })
  })

  it('schema_version 恰 15 行，版本集合=1..15（无跳号、无重放）', () => {
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as unknown as Array<{
      version: number
    }>
    const versions = rows.map((r) => Number(r.version))
    expect(versions).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  it('条目序列：recordsMigrations=[14,15]，且 14 条目无触发器 / 15 条目无建表（增量各司其职）', () => {
    expect(recordsMigrations.map((m) => m.version)).toEqual([14, 15])
    expect(recordsMigration.version).toBe(14)
    expect(eventsTriggersMigration.version).toBe(15)
    // v14 只建表/索引：DDL 内不得出现 DML、触发器、DROP（只建表不写数据）
    expect(recordsMigration.sql).toContain('CREATE TABLE records')
    expect(recordsMigration.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP)\b/)
    expect(recordsMigration.sql).not.toContain('CREATE TRIGGER')
    // v15 只补触发器：v1 建表体一字不动（sha8 已锁），故不得再出现 CREATE TABLE
    expect(eventsTriggersMigration.sql.match(/CREATE TRIGGER/g)?.length).toBe(2)
    expect(eventsTriggersMigration.sql).not.toContain('CREATE TABLE')
  })

  it('版本口径登记：PRAGMA user_version 恒 0（本库版本唯一源＝schema_version 表）', () => {
    const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
    expect(Number(row.user_version)).toBe(0)
    expect(currentVersion(db)).toBe(LATEST_VERSION)
  })
})

describe('records 表结构（DOM-05 投影；不为 74 类建宽表）', () => {
  it('表在库，列名与列序＝设计列集（15 列）', () => {
    expect(tableExists(db, 'records')).toBe(true)
    expect(columnsOf(db, 'records').map((c) => c.name)).toEqual([...COLUMNS])
  })

  it('主键＝record_id；九列显式 NOT NULL，其余五列可空（payload 结构不落库侧 CHECK）', () => {
    const cols = columnsOf(db, 'records')
    // PRAGMA 口径：`record_id TEXT PRIMARY KEY` 未带显式 NOT NULL 时 notnull=0（SQLite rowid 表历史
    // 行为；仓内 v1..v13 各表 id 列同款声明），故 PK 面由 pk 列表征、NOT NULL 面单列断言。
    expect(cols.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['record_id'])
    expect(cols.filter((c) => c.notnull === 1).map((c) => c.name)).toEqual([...NOT_NULL_COLUMNS])
    const nullable = cols.filter((c) => c.notnull === 0 && c.pk === 0).map((c) => c.name)
    expect(nullable).toEqual(['proof_boundary', 'effective_state', 'effective_time', 'revises', 'idempotency_key'])
  })

  it('record_id 唯一：同 id 第二次插入被主键拒（身份一经分配不复用，v2/11 §0.4-1）', () => {
    insertRecord(db, { record_id: '01JPK000000000000000001' })
    expect(() => insertRecord(db, { record_id: '01JPK000000000000000001', record_type: 'REC-WORK-01' })).toThrow(
      /UNIQUE constraint failed: records\.record_id/,
    )
  })

  it('三索引在库：公司×域×时刻 / 类型×时刻 / 幂等键 partial UNIQUE', () => {
    // auto index（PRIMARY KEY 的 sqlite_autoindex_*）sql 列为 NULL，不是本刀声明的索引，排除在外
    const rows = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'records' AND sql IS NOT NULL ORDER BY name",
      )
      .all() as unknown as Array<{ name: string; sql: string | null }>
    expect(rows.map((r) => String(r.name))).toEqual([
      'idx_records_company_area_time',
      'idx_records_idem',
      'idx_records_type_time',
    ])
    const idem = rows.find((r) => r.name === 'idx_records_idem')
    expect(String(idem?.sql)).toContain('UNIQUE')
    expect(String(idem?.sql)).toContain('WHERE idempotency_key IS NOT NULL')
  })

  it('投影非事实源：records 不设 append-only 触发器（保护面在 DOM-03 的 events，归 v15）', () => {
    expect(triggerNames(db, 'records')).toEqual([])
    expect(triggerNames(db, 'events')).toEqual(['trg_events_no_delete', 'trg_events_no_update'])
  })

  it('v14 迁移本身零写数据（建表后表为空）', () => {
    const fresh = new DatabaseSync(':memory:')
    try {
      expect(migrate(fresh, { upTo: 14 })).toBe(14)
      expect(tableExists(fresh, 'records')).toBe(true)
      expect(fresh.prepare('SELECT COUNT(*) AS c FROM records').get()).toEqual({ c: 0 })
    } finally {
      fresh.close()
    }
  })
})

describe('record_area CHECK：十三 AREA 全收、非法值拒（v2/11 §0.9 封闭登记）', () => {
  it('13 个合法 AREA 逐一插入成功（含 AUTH 族对骨架五前缀的归属面）', () => {
    for (const [i, area] of RECORD_AREAS.entries()) {
      insertRecord(db, {
        record_id: `01JAREA00000000000000${String(i).padStart(2, '0')}`,
        record_area: area,
        record_type: area === 'AUTH' ? 'REC-CMD-01' : `REC-${area}-01`,
        produced_at: T0 + i,
      })
    }
    const row = db.prepare("SELECT COUNT(*) AS c FROM records WHERE record_id LIKE '01JAREA%'").get() as unknown as {
      c: number
    }
    expect(Number(row.c)).toBe(RECORD_AREAS.length)
  })

  it.each([['FOO'], ['CMD'], ['work'], [''], ['EVD ']])('非法 area %j 被 CHECK 拒', (bad) => {
    expect(() => insertRecord(db, { record_id: `01JBAD_${bad || 'empty'}`, record_area: bad })).toThrow(
      /CHECK constraint failed/,
    )
  })
})

describe('幂等键 UNIQUE(company, record_type, idempotency_key) WHERE key IS NOT NULL（v2/11 §0.4-5）', () => {
  it('同公司同类型同幂等键：第二次写入被唯一索引拒（库侧兜底防双写）', () => {
    insertRecord(db, { record_id: '01JIDEM0000000000000000A', idempotency_key: 'idem-1' })
    expect(() => insertRecord(db, { record_id: '01JIDEM0000000000000000B', idempotency_key: 'idem-1' })).toThrow(
      /UNIQUE constraint failed: records\.company, records\.record_type, records\.idempotency_key/,
    )
  })

  it('公司维是第①元：换 company / 换 record_type 即另一幂等作用域，均可写入', () => {
    insertRecord(db, { record_id: '01JIDEM0000000000000000C', company: 'other-co', idempotency_key: 'idem-1' })
    insertRecord(db, { record_id: '01JIDEM0000000000000000D', record_type: 'REC-WORK-01', idempotency_key: 'idem-1' })
    const row = db.prepare("SELECT COUNT(*) AS c FROM records WHERE idempotency_key = 'idem-1'").get() as unknown as {
      c: number
    }
    expect(Number(row.c)).toBe(3)
  })

  it('键缺省（NULL）不受 partial 索引约束：多行 NULL 可共存', () => {
    insertRecord(db, { record_id: '01JNULL000000000000000N1' })
    insertRecord(db, { record_id: '01JNULL000000000000000N2' })
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM records WHERE record_id IN ('01JNULL000000000000000N1', '01JNULL000000000000000N2')")
      .get() as unknown as { c: number }
    expect(Number(row.c)).toBe(2)
  })
})

describe('插入/查询往返（DOM-05 投影面：信封维可判，payload 交给 contract）', () => {
  it('全列往返：payload JSON 原样读出、proof_boundary/生效槽/幂等键/revises 均可空可填', () => {
    const payload = { proof_kind: '观察', note: '中文与 \\"转义\\" 均原样' }
    insertRecord(db, {
      record_id: '01JROUND00000000000000R1',
      record_type: 'REC-EVD-01',
      record_area: 'EVD',
      schema_ref: 'rec.evd-01',
      spec_version: '2.1.0',
      produced_at: T0 + 100,
      producer: 'owner:ENG-9',
      payload: JSON.stringify(payload),
      proof_boundary: '本记录证明可观测到该次采集；不证明采集完整',
      effective_state: 'effective',
      effective_time: T0 + 100,
      idempotency_key: 'harvest:seg-1',
    })
    const row = db.prepare('SELECT * FROM records WHERE record_id = ?').get('01JROUND00000000000000R1') as unknown as Record<
      string,
      unknown
    >
    expect(row['record_type']).toBe('REC-EVD-01')
    expect(row['record_area']).toBe('EVD')
    expect(row['produced_at']).toBe(T0 + 100)
    expect(JSON.parse(String(row['payload']))).toEqual(payload)
    expect(row['proof_boundary']).toBe('本记录证明可观测到该次采集；不证明采集完整')
    expect(row['effective_state']).toBe('effective')
    expect(row['effective_time']).toBe(T0 + 100)
    expect(row['revises']).toBeNull()
  })

  it('按 (company, record_area, produced_at) 检索：索引覆盖等值+排序面', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT record_id FROM records WHERE company = ? AND record_area = ? ORDER BY produced_at',
      )
      .all('studio-dev', 'EVD') as unknown as Array<{ detail: string }>
    const detail = plan.map((p) => String(p.detail)).join(' | ')
    expect(detail).toContain('idx_records_company_area_time')
    const rows = db
      .prepare('SELECT record_id FROM records WHERE company = ? AND record_area = ? ORDER BY produced_at')
      .all('studio-dev', 'EVD') as unknown as Array<{ record_id: string }>
    expect(rows.length).toBeGreaterThan(0)
  })

  it('版本链：revises 指前一版 record_id，旧版本保留、新版本另起一行（v2/11 §0.4-1）', () => {
    insertRecord(db, { record_id: '01JCHAIN000000000000V1', produced_at: T0 + 200, record_type: 'REC-WORK-06' })
    insertRecord(db, {
      record_id: '01JCHAIN000000000000V2',
      produced_at: T0 + 201,
      record_type: 'REC-WORK-06',
      revises: '01JCHAIN000000000000V1',
    })
    const next = db.prepare('SELECT record_id, revises FROM records WHERE revises = ?').all(
      '01JCHAIN000000000000V1',
    ) as unknown as Array<{ record_id: string; revises: string }>
    expect(next.map((r) => r.record_id)).toEqual(['01JCHAIN000000000000V2'])
    const old = db.prepare('SELECT COUNT(*) AS c FROM records WHERE record_id = ?').get('01JCHAIN000000000000V1') as unknown as {
      c: number
    }
    expect(Number(old.c)).toBe(1) // 旧版本未被覆盖
  })
})

describe('升级路径：v14 分段库 → v15（触发器补装、records 数据保留）', () => {
  it('upTo:14 时 records 在库而 events 无触发器；再 migrate() 到 15 后触发器齐、记录不丢', () => {
    const staged = new DatabaseSync(':memory:')
    try {
      expect(migrate(staged, { upTo: 14 })).toBe(14)
      expect(tableExists(staged, 'records')).toBe(true)
      expect(triggerNames(staged, 'events')).toEqual([])
      insertRecord(staged, { record_id: '01JUPG00000000000000001', record_area: 'MEM', record_type: 'REC-MEM-01' })
      expect(migrate(staged)).toBe(15)
      expect(triggerNames(staged, 'events')).toEqual(['trg_events_no_delete', 'trg_events_no_update'])
      expect(staged.prepare('SELECT COUNT(*) AS c FROM records').get()).toEqual({ c: 1 })
      // 重开库再 migrate：幂等（版本不涨、不重放）
      expect(migrate(staged)).toBe(15)
      const rows = staged.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as unknown as { c: number }
      expect(Number(rows.c)).toBe(15)
    } finally {
      staged.close()
    }
  })
})
