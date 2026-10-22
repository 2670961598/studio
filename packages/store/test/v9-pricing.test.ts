/**
 * v9 测试（132-§6.2 单B 定价面刀，studio-dev-169）：price_snapshots 表迁移+读写面。
 * 覆盖（132-§8 S2/S7+判负线①）：
 *   - 版本号：LATEST_VERSION=10（v8 测试已申报「后续单依合入序顺取 v9」——本刀即 v9）；
 *   - 新库直达 v10 + v8→v9 升级路径（存量行零改写）；
 *   - append-only 触发器：UPDATE/DELETE 一律 ABORT（判负线①——日终定型不回溯）；
 *   - 写面：形状闸（坏日期/负价/坏 slot/坏 track/双轨互斥/非 USD/坏 id）；
 *   - 幂等：同单同键全列一致=跳过；内容冲突=CONFIG_INVALID 拒；
 *   - version 赋值：同日异单=+1；首行=1；同单重收（崩溃重放）不双写；
 *   - 词表复制一致性：PRICE_SLOT_VALUES ≡ core；PRICE_BILLING_TRACK_VALUES ≡ contract。
 * 环境：os.tmpdir() 真文件库（沿 v4/v7/v8 测试风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PRICE_SLOT_VALUES as CORE_PRICE_SLOTS } from '@studio-next/core'
import { BILLING_TRACKS } from '@studio-next/contract'
import { currentVersion, LATEST_VERSION, migrate } from '../src/migrations.ts'
import { openLedger, PRICE_BILLING_TRACK_VALUES, PRICE_SLOT_VALUES, type Ledger, type PriceSnapshotRecord } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''
let dbPath = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v9-'))
  dbPath = path.join(root, 'ledger.db')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 合法入参基样（每用例改字段；id 每次新生成——主键不撞） */
function baseInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `ps-${makeUlid(Date.now())}`,
    company: 'studio-dev',
    provider: 'deepseek',
    model: 'deepseek-flash',
    price_date: '2026-10-23',
    input_per_m: 0.3,
    output_per_m: 1.2,
    cache_read_per_m: 0.006,
    cache_creation_per_m: 0.3,
    source_note: 'DeepSeek 官网价目页（2026-10-23 晨采）',
    source_ticket: 'STUDIO-901',
    published_by: 'HF-1',
    ...over,
  }
}

describe('v9 迁移面：price_snapshots（132-§6.2 单B）', () => {
  it('版本号：LATEST_VERSION=10（v8 顺延——后续单依合入序顺取 v10+）', () => {
    expect(LATEST_VERSION).toBe(12)
  })

  it('新库直达 v10：表/双 UNIQUE 索引/查询索引/双触发器齐', () => {
    const db = new DatabaseSync(dbPath)
    try {
      expect(migrate(db)).toBe(12)
      expect(currentVersion(db)).toBe(12)
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='price_snapshots'").all()
      expect(tables).toHaveLength(1)
      const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='price_snapshots'").all() as Array<{ name: string }>).map(r => r.name)
      expect(idx).toContain('idx_price_snapshots_nat')
      expect(idx).toContain('idx_price_snapshots_ticket')
      expect(idx).toContain('idx_price_snapshots_model_date')
      const trg = (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='price_snapshots'").all() as Array<{ name: string }>).map(r => r.name)
      expect(trg).toContain('trg_price_snapshots_no_update')
      expect(trg).toContain('trg_price_snapshots_no_delete')
    } finally {
      db.close()
    }
  })

  it('v8→v9 升级路径：upTo=9 造历史库 → migrate 补 v10（幂等，存量行零改写）', () => {
    const legacyPath = path.join(root, 'legacy.db')
    const db = new DatabaseSync(legacyPath)
    migrate(db, { upTo: 8 })
    expect(currentVersion(db)).toBe(8)
    db.close()
    const ledger: Ledger = openLedger(legacyPath)
    try {
      expect(ledger.version()).toBe(12)
      const r = ledger.appendPriceSnapshot(baseInput())
      expect(r.appended).toBe(true)
    } finally {
      ledger.close()
    }
  })

  it('词表复制一致性：slot ≡ core 唯一源；billing_track ≡ contract BILLING_TRACKS（132-A 词表）', () => {
    expect([...PRICE_SLOT_VALUES]).toEqual([...CORE_PRICE_SLOTS])
    expect([...PRICE_BILLING_TRACK_VALUES]).toEqual([...BILLING_TRACKS])
  })
})

describe('append-only 触发器（判负线①：改史路径=废件）', () => {
  it('UPDATE 被 ABORT（含同值 UPDATE——append-only 无豁免面）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const r = ledger.appendPriceSnapshot(baseInput())
      expect(r.appended).toBe(true)
      expect(() => ledger.db.prepare('UPDATE price_snapshots SET input_per_m = 99 WHERE id = ?').run(r.id)).toThrowError(/append-only/)
      expect(() => ledger.db.prepare("UPDATE price_snapshots SET input_per_m = input_per_m WHERE id = ?").run(r.id)).toThrowError(/append-only/)
    } finally {
      ledger.close()
    }
  })

  it('DELETE 被 ABORT（降价永不回溯——「日终定型不回溯」制作人令直译）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const r = ledger.appendPriceSnapshot(baseInput({ price_date: '2026-10-24', source_ticket: 'STUDIO-902' }))
      expect(() => ledger.db.prepare('DELETE FROM price_snapshots WHERE id = ?').run(r.id)).toThrowError(/append-only/)
    } finally {
      ledger.close()
    }
  })
})

describe('写面：appendPriceSnapshot 形状闸（fail-closed）', () => {
  it.each([
    ['坏日期（非真日历日）', { price_date: '2026-02-30' }],
    ['坏日期（非 YYYY-MM-DD）', { price_date: '2026/10/23' }],
    ['负价', { input_per_m: -0.3 }],
    ['NaN 价', { output_per_m: Number.NaN }],
    ['越界 slot', { slot: 'night' }],
    ['未知列（strict 拒收）', { extra_key: 1 }],
    ['coding_plan 缺月费（补充令：摊销轨锚必填）', { billing_track: 'coding_plan' }],
    ['coding_plan 月费非正', { billing_track: 'coding_plan', plan_monthly_usd: 0 }],
    ['api 行带月费（双轨互斥）', { billing_track: 'api', plan_monthly_usd: 30 }],
    ['非 USD', { currency: 'CNY' }],
    ['坏 id（无 ps- 前缀）', { id: makeUlid(Date.now()) }],
    ['坏 id（ULID 形不合）', { id: `ps-${'x'.repeat(26)}` }],
    ['空单据号（S7 单据锚必填）', { source_ticket: '' }],
  ])('拒收：%s', (_name, over) => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      expect(() => ledger.appendPriceSnapshot(baseInput(over))).toThrowError(/CONFIG_INVALID/)
    } finally {
      ledger.close()
    }
  })

  it('缺省值：slot=peak、currency=USD、billing_track=api（入参省略时）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const r = ledger.appendPriceSnapshot({
        id: `ps-${makeUlid(Date.now())}`,
        company: 'studio-dev',
        provider: 'zhipu',
        model: 'glm-4.7-flash',
        price_date: '2026-10-23',
        input_per_m: 0.05,
        output_per_m: 0.25,
        source_note: 'zhipu 官网',
        source_ticket: 'STUDIO-903',
        published_by: 'HF-1',
      })
      expect(r).toMatchObject({ version: 1, appended: true })
      const row = ledger.listPriceSnapshots({ source_ticket: 'STUDIO-903' })[0]
      expect(row).toMatchObject({ slot: 'peak', currency: 'USD', billing_track: 'api' })
    } finally {
      ledger.close()
    }
  })

  it('cache 价 NULL 语义：缺键入参 → 库行 NULL → 记录 undefined（未定价≠0 价）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      ledger.appendPriceSnapshot(baseInput({
        id: `ps-${makeUlid(Date.now())}`,
        price_date: '2026-10-25',
        source_ticket: 'STUDIO-904',
        cache_read_per_m: undefined,
        cache_creation_per_m: undefined,
      }))
      const row = ledger.listPriceSnapshots({ source_ticket: 'STUDIO-904' })[0] as PriceSnapshotRecord
      expect(row.cache_read_per_m).toBeUndefined()
      expect(row.cache_creation_per_m).toBeUndefined()
      // 零价与未定价可区分：显式 0 落库为 0
      ledger.appendPriceSnapshot(baseInput({
        id: `ps-${makeUlid(Date.now())}`,
        price_date: '2026-10-25',
        source_ticket: 'STUDIO-905',
        cache_read_per_m: 0,
      }))
      const zeroRow = ledger.listPriceSnapshots({ source_ticket: 'STUDIO-905' })[0] as PriceSnapshotRecord
      expect(zeroRow.cache_read_per_m).toBe(0)
    } finally {
      ledger.close()
    }
  })
})

describe('幂等与 version 赋值（F1 版本化+S7 单据锚）', () => {
  it('同单同键重收：全列一致=幂等跳过（appended=false，崩溃重放安全）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const first = ledger.appendPriceSnapshot(baseInput({ price_date: '2026-10-26', source_ticket: 'STUDIO-910' }))
      expect(first.appended).toBe(true)
      const again = ledger.appendPriceSnapshot(baseInput({ id: `ps-${makeUlid(Date.now())}`, price_date: '2026-10-26', source_ticket: 'STUDIO-910' }))
      expect(again).toEqual({ id: first.id, version: first.version, appended: false })
      expect(ledger.listPriceSnapshots({ source_ticket: 'STUDIO-910' })).toHaveLength(1)
    } finally {
      ledger.close()
    }
  })

  it('同单同键内容冲突=CONFIG_INVALID 拒（同一单据同键只能有一个价）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      ledger.appendPriceSnapshot(baseInput({ price_date: '2026-10-26', source_ticket: 'STUDIO-911' }))
      expect(() => ledger.appendPriceSnapshot(baseInput({ id: `ps-${makeUlid(Date.now())}`, price_date: '2026-10-26', source_ticket: 'STUDIO-911', input_per_m: 0.5 }))).toThrowError(/ticket-conflict/)
    } finally {
      ledger.close()
    }
  })

  it('同日异单（晨更+紧急调价）=version+1 新行；旧行不动（F1）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const morning = ledger.appendPriceSnapshot(baseInput({ price_date: '2026-10-27', source_ticket: 'STUDIO-920' }))
      const urgent = ledger.appendPriceSnapshot(baseInput({ id: `ps-${makeUlid(Date.now())}`, price_date: '2026-10-27', source_ticket: 'STUDIO-921', input_per_m: 0.45 }))
      expect(morning.version).toBe(1)
      expect(urgent.version).toBe(2)
      const rows = ledger.listPriceSnapshots({ price_date: '2026-10-27' })
      expect(rows).toHaveLength(2)
      expect(rows.map(r => r.input_per_m)).toEqual([0.3, 0.45]) // (price_date, version) 升序
    } finally {
      ledger.close()
    }
  })

  it('异 slot 独立 version 计数（峰谷各一序）', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const peak = ledger.appendPriceSnapshot(baseInput({ price_date: '2026-10-28', source_ticket: 'STUDIO-930' }))
      const offpeak = ledger.appendPriceSnapshot(baseInput({ id: `ps-${makeUlid(Date.now())}`, price_date: '2026-10-28', slot: 'offpeak', source_ticket: 'STUDIO-930', input_per_m: 0.15 }))
      expect(peak.version).toBe(1)
      expect(offpeak.version).toBe(1)
    } finally {
      ledger.close()
    }
  })
})

describe('读面：listPriceSnapshots 过滤', () => {
  it('company/provider/model/on_or_before/source_ticket 过滤全通 + 升序', () => {
    const ledger: Ledger = openLedger(dbPath)
    try {
      const all = ledger.listPriceSnapshots({ company: 'studio-dev' })
      expect(all.length).toBeGreaterThan(0)
      const bounded = ledger.listPriceSnapshots({ company: 'studio-dev', provider: 'deepseek', model: 'deepseek-flash', on_or_before: '2026-10-23' })
      for (const r of bounded) {
        expect(r.price_date <= '2026-10-23').toBe(true)
        expect(r.provider).toBe('deepseek')
      }
      const sorted = [...bounded].sort((a, b) => (a.price_date === b.price_date ? a.version - b.version : a.price_date < b.price_date ? -1 : 1))
      expect(bounded.map(r => r.id)).toEqual(sorted.map(r => r.id))
    } finally {
      ledger.close()
    }
  })
})
