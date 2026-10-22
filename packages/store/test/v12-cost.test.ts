/**
 * v12 测试（132-§6.3 单D 定型面刀，studio-dev-179）：cost_daily 定型账迁移+读写面。
 * 覆盖（132 §6.3 DDL/票面 S2/S3 语义/§8 验收）：
 *   - 版本号：LATEST_VERSION=12（v11 顺延）；
 *   - 新库直达 v12：表+partial UNIQUE（WHERE kind='final'）+日期索引+两枚 append-only
 *     触发器齐；
 *   - final 首冻：appendCostDaily 往返全字段；列表过滤面（company/cost_date/person_id/
 *     model/kind）；
 *   - 重复收口双层拒绝（S2②）：store 前置检查=分类 CONFIG_INVALID（store/cost-daily:
 *     final-exists）；裸 SQL 直插第二 final=partial UNIQUE 约束拒（库侧兜底）；
 *   - append-only 机制保证（S2①判负线）：UPDATE/DELETE 触发器拦（裸 SQL 也拒）；
 *   - adjustment 流（S3）：signed delta（负值合法=数据修复可减账）+adjusts_id 挂同格
 *     final 行；跨格挂账拒/指向非 final 拒/缺 adjusts_id 拒；
 *   - 形状闸：坏日期/负 final tokens/未知列拒；
 *   - listClosedCostDates：DISTINCT 日期扫描面（对账/巡检有界）。
 * 环境：os.tmpdir() 真文件库（沿 v9/v11 风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, migrate } from '../src/migrations.ts'
import { openLedger, type Ledger } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''
let dbPath = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v12-'))
  dbPath = path.join(root, 'ledger.db')
  ledger = openLedger(dbPath)
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const T0 = Date.UTC(2026, 9, 23, 2, 0, 0) // 2026-10-23 收口时刻（19:55 本地近似——测试只锚数值）

const FINAL_ID = makeUlid(T0)
const FINAL_ID2 = makeUlid(T0 + 1)
const FINAL_ID3 = makeUlid(T0 + 2)

function finalRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FINAL_ID,
    company: 'studio-dev',
    person_id: 'ENG-6',
    model: 'deepseek/deepseek-flash',
    cost_date: '2026-10-23',
    tokens: { tokens_in: 1_000_000, tokens_out: 2_000_000, cache_read: 500_000, cache_creation: 0 },
    price_snapshot_id: '01JD0000000000000000000000',
    cost_usd: 0.15,
    closed_at: T0,
    closed_by: 'cost-close:2026-10-23',
    ...over,
  }
}

function expectConfigInvalid(fn: () => void, subcause: string): void {
  try {
    fn()
  } catch (err) {
    const e = err as { category?: string; subcause?: string }
    expect(e.category).toBe('CONFIG_INVALID')
    expect(String(e.subcause)).toMatch(new RegExp(`^${subcause}(?::|$)`))
    return
  }
  expect.unreachable('expected CONFIG_INVALID not thrown')
}

describe('v12 迁移面：cost_daily 定型账（132-§6.3 单D）', () => {
  it('版本号：LATEST_VERSION=12（v11 顺延——后续单依合入序顺取 v13+）', () => {
    expect(LATEST_VERSION).toBe(12)
  })

  it('新库直达 v12：表+partial UNIQUE+日期索引+两枚 append-only 触发器齐', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(migrate(db)).toBe(12)
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cost%' ORDER BY name")
        .all() as Array<{ name: unknown }>
      expect(idx.map((r) => String(r.name))).toEqual(['idx_cost_daily_date', 'idx_cost_daily_final'])
      const trg = db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_cost%' ORDER BY name")
        .all() as Array<{ name: unknown }>
      expect(trg.map((r) => String(r.name))).toEqual(['trg_cost_daily_no_delete', 'trg_cost_daily_no_update'])
      // partial UNIQUE：WHERE 子句带 kind='final'（半索引——adjustment 行不受缚）
      const ddl = db
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_cost_daily_final'")
        .get() as { sql: unknown }
      expect(String(ddl.sql)).toContain("WHERE kind='final'")
    } finally {
      db.close()
    }
  })

  it('final 首冻往返：appendCostDaily → listCostDaily 全字段；缺省 basis/kind 落默认值', () => {
    ledger.appendCostDaily(finalRow())
    const rows = ledger.listCostDaily({ company: 'studio-dev' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id: FINAL_ID,
      company: 'studio-dev',
      person_id: 'ENG-6',
      model: 'deepseek/deepseek-flash',
      cost_date: '2026-10-23',
      tokens_in: 1_000_000,
      tokens_out: 2_000_000,
      cache_read: 500_000,
      cache_creation: 0,
      price_snapshot_id: '01JD0000000000000000000000',
      cost_usd: 0.15,
      basis: 'shadow',
      kind: 'final',
      closed_at: T0,
      closed_by: 'cost-close:2026-10-23',
    })
  })

  it('重复收口双层拒绝（S2②）：store 前置=分类拒；裸 SQL 直插=partial UNIQUE 拒', () => {
    // 层 1（store 写口）：同格第二 final 行 → CONFIG_INVALID 分类拒（幂等双保险的应用层）
    expectConfigInvalid(
      () => ledger.appendCostDaily(finalRow({ id: makeUlid(T0 + 5), cost_usd: 0.99 })),
      'store/cost-daily:final-exists',
    )
    // 层 2（库侧兜底）：绕过写口的裸 INSERT → 约束拒（不产第二行）
    const raw = new DatabaseSync(dbPath)
    try {
      expect(() =>
        raw
          .prepare(
            `INSERT INTO cost_daily (id, company, person_id, model, cost_date, tokens_in, tokens_out, cache_read, cache_creation, price_snapshot_id, cost_usd, basis, kind, adjusts_id, closed_at, closed_by, note)
             VALUES ('raw-dup', 'studio-dev', 'ENG-6', 'deepseek/deepseek-flash', '2026-10-23', 0, 0, 0, 0, 'ps', 0, 'shadow', 'final', NULL, 1, 't', NULL)`,
          )
          .run(),
      ).toThrowError(/UNIQUE/)
      // 半索引旁证：adjustment 同格直插成功（partial UNIQUE 仅缚 final——多行补账合法）
      raw
        .prepare(
          `INSERT INTO cost_daily (id, company, person_id, model, cost_date, tokens_in, tokens_out, cache_read, cache_creation, price_snapshot_id, cost_usd, basis, kind, adjusts_id, closed_at, closed_by, note)
           VALUES ('raw-adj-2', 'studio-dev', 'ENG-6', 'deepseek/deepseek-flash', '2026-10-23', 0, 0, 0, 0, 'ps', 0.01, 'shadow', 'adjustment', '${FINAL_ID}', 2, 't', NULL)`,
        )
        .run()
      const n = raw.prepare("SELECT COUNT(*) AS c FROM cost_daily WHERE id = 'raw-adj-2'").get() as { c: unknown }
      expect(Number(n.c)).toBe(1)
    } finally {
      raw.close()
    }
  })

  it('append-only 机制保证（S2①判负线）：UPDATE 与 DELETE 触发器拦（裸 SQL 也拒）', () => {
    const raw = new DatabaseSync(dbPath)
    try {
      expect(() => raw.prepare('UPDATE cost_daily SET cost_usd = 999 WHERE id = ?').run(FINAL_ID)).toThrowError(
        /append-only/,
      )
      expect(() => raw.prepare('DELETE FROM cost_daily WHERE id = ?').run(FINAL_ID)).toThrowError(/append-only/)
      // 触发器拒绝后行原封不动（RAISE ABORT 回滚单语句）
      const row = raw.prepare('SELECT cost_usd FROM cost_daily WHERE id = ?').get(FINAL_ID) as { cost_usd: unknown }
      expect(Number(row.cost_usd)).toBe(0.15)
    } finally {
      raw.close()
    }
  })

  it('adjustment 流（S3）：signed delta 负值合法挂同格 final；形状/指向校验拒', () => {
    // 负 delta（数据修复减账）+ note → 落账
    ledger.appendCostDaily({
      id: FINAL_ID2,
      company: 'studio-dev',
      person_id: 'ENG-6',
      model: 'deepseek/deepseek-flash',
      cost_date: '2026-10-23',
      tokens: { tokens_in: -200_000, tokens_out: 0, cache_read: 0, cache_creation: 0 },
      price_snapshot_id: '01JD0000000000000000000000',
      cost_usd: -0.03,
      kind: 'adjustment',
      adjusts_id: FINAL_ID,
      closed_at: T0 + 3_600_000,
      closed_by: 'cost-adjust:2026-10-23',
      note: '重建回填补账',
    })
    const adj = ledger.listCostDaily({ company: 'studio-dev', kind: 'adjustment' })
    expect(adj).toHaveLength(2) // face 落的 FINAL_ID2 + 上一用例裸插的 raw-adj-2（同格多行补账合法）
    expect(adj.find((r) => r.id === FINAL_ID2)).toMatchObject({ cost_usd: -0.03, adjusts_id: FINAL_ID, note: '重建回填补账' })
    // 格真值 = final + adjustments Σ（对账段口径）：0.15 - 0.03 + 0.01 = 0.13
    const cell = ledger.listCostDaily({ company: 'studio-dev', cost_date: '2026-10-23' })
    const truth = cell.reduce((sum, r) => sum + r.cost_usd, 0)
    expect(truth).toBeCloseTo(0.13, 10)

    // 跨格挂账拒：adjusts_id 指向别格 final 行
    ledger.appendCostDaily(finalRow({ id: FINAL_ID3, person_id: 'ENG-2', cost_date: '2026-10-22' }))
    expectConfigInvalid(
      () =>
        ledger.appendCostDaily({
          id: makeUlid(T0 + 10),
          company: 'studio-dev',
          person_id: 'ENG-6',
          model: 'deepseek/deepseek-flash',
          cost_date: '2026-10-23',
          tokens: { tokens_in: 1, tokens_out: 0, cache_read: 0, cache_creation: 0 },
          price_snapshot_id: '01JD0000000000000000000000',
          cost_usd: 0.001,
          kind: 'adjustment',
          adjusts_id: FINAL_ID3,
          closed_at: T0,
          closed_by: 'cost-adjust:2026-10-23',
        }),
      'store/cost-daily:invalid',
    )
    // 缺 adjusts_id / 指向不存在行 / final 携带 adjusts_id
    const base = {
      company: 'studio-dev',
      person_id: 'ENG-6',
      model: 'deepseek/deepseek-flash',
      cost_date: '2026-10-23',
      tokens: { tokens_in: 1, tokens_out: 0, cache_read: 0, cache_creation: 0 },
      price_snapshot_id: '01JD0000000000000000000000',
      cost_usd: 0.001,
      closed_at: T0,
      closed_by: 'cost-adjust:2026-10-23',
    }
    expectConfigInvalid(() => ledger.appendCostDaily({ ...base, id: makeUlid(T0 + 11), kind: 'adjustment' }), 'store/cost-daily:invalid')
    expectConfigInvalid(
      () => ledger.appendCostDaily({ ...base, id: makeUlid(T0 + 12), kind: 'adjustment', adjusts_id: makeUlid(T0 + 13) }),
      'store/cost-daily:invalid',
    )
    expectConfigInvalid(() => ledger.appendCostDaily({ ...base, id: makeUlid(T0 + 14), adjusts_id: FINAL_ID }), 'store/cost-daily:invalid')
  })

  it('形状闸：坏日期（非日历日）/final 负 tokens/final 负 usd/未知列 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => ledger.appendCostDaily(finalRow({ id: makeUlid(T0 + 20), cost_date: '2026-02-30' })), 'store/cost-daily:invalid')
    expectConfigInvalid(
      () => ledger.appendCostDaily(finalRow({ id: makeUlid(T0 + 21), tokens: { tokens_in: -1, tokens_out: 0, cache_read: 0, cache_creation: 0 } })),
      'store/cost-daily:invalid',
    )
    expectConfigInvalid(() => ledger.appendCostDaily(finalRow({ id: makeUlid(T0 + 22), cost_usd: -0.01 })), 'store/cost-daily:invalid')
    expectConfigInvalid(() => ledger.appendCostDaily(finalRow({ id: makeUlid(T0 + 23), bogus: 1 })), 'store/cost-daily:invalid')
  })

  it('listCostDaily 过滤面：company/cost_date/person_id/model/kind 组合；恒 (cost_date,person,model,id) 升序', () => {
    // 再落一格（ENG-2 已有 2026-10-22）→ 4 行两日期（含裸插 raw-adj-2）
    const rows = ledger.listCostDaily({ company: 'studio-dev' })
    expect(rows.map((r) => [r.cost_date, r.person_id, r.id])).toEqual([
      ['2026-10-22', 'ENG-2', FINAL_ID3],
      ['2026-10-23', 'ENG-6', FINAL_ID],
      ['2026-10-23', 'ENG-6', FINAL_ID2],
      ['2026-10-23', 'ENG-6', 'raw-adj-2'],
    ])
    expect(ledger.listCostDaily({ company: 'studio-dev', kind: 'final' })).toHaveLength(2)
    expect(ledger.listCostDaily({ company: 'studio-dev', model: 'anthropic/claude' })).toHaveLength(0)
    expect(ledger.listCostDaily({ company: 'no-co' })).toHaveLength(0)
  })

  it('listClosedCostDates：DISTINCT final 日期升序（adjustment 不新增日期）', () => {
    expect(ledger.listClosedCostDates('studio-dev')).toEqual(['2026-10-22', '2026-10-23'])
    expect(ledger.listClosedCostDates('no-co')).toEqual([])
    expectConfigInvalid(() => ledger.listClosedCostDates(''), 'store/cost-daily:invalid')
  })
})
