/**
 * v11 测试（132-§6.1 单C 用量投影刀，studio-dev-177）：usage_daily 表迁移+读写面。
 * 覆盖（132 §6.4 触发条件表/§8 验收）：
 *   - 版本号：LATEST_VERSION=11（v10 顺延）；
 *   - 新库直达 v11：表+自然键 UNIQUE 索引+日期查询索引齐；
 *   - upsert 并格：四桶累加+runs_count 计数+first_ts MIN/last_ts MAX+冲突沿用原行 id；
 *   - 分格隔离：自然键四元组任一异=新格；
 *   - 形状闸：坏日期（非日历日）/负 tokens/坏 ULID/未知键拒；
 *   - list 过滤面：company/usage_date/person_id/model 四过滤；
 *   - replace：整组替换原子性+公司不一致拒（回滚不留半截）。
 * 环境：os.tmpdir() 真文件库（沿 v9 风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION } from '../src/migrations.ts'
import { openLedger, type Ledger, type UsageDailyRecord } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''
let dbPath = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v11-'))
  dbPath = path.join(root, 'ledger.db')
  ledger = openLedger(dbPath)
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const T0 = Date.UTC(2026, 9, 23, 2, 0, 0) // 2026-10-23（本地日锚随用例）
const T1 = T0 + 3_600_000
const T2 = T0 + 7_200_000

function delta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: makeUlid(T0),
    company: 'studio-dev',
    person_id: 'ENG-2',
    model: 'deepseek/deepseek-flash',
    usage_date: '2026-10-23',
    tokens: { input: 1000, output: 2000, cache_read: 500, cache_creation: 100 },
    first_ts: T0,
    last_ts: T1,
    updated_at: T1,
    ...over,
  }
}

describe('v11 迁移面：usage_daily（132-§6.1 单C）', () => {
  it('版本号：LATEST_VERSION=11（v10 顺延——后续单依合入序顺取 v12+）', () => {
    expect(LATEST_VERSION).toBe(11)
  })

  it('新库直达 v11：自然键 UNIQUE 索引+日期查询索引齐', () => {
    const db = new DatabaseSync(dbPath)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_daily'").all()
    expect(tables.length).toBe(1)
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='usage_daily'").all() as Array<{ name: string }>).map((r) => r.name)
    db.close()
    expect(idx).toContain('idx_usage_daily_nat')
    expect(idx).toContain('idx_usage_daily_date')
  })

  it('upsert 首插：全列落位 runs_count=1', () => {
    ledger.upsertUsageDaily(delta())
    const rows = ledger.listUsageDaily({ company: 'studio-dev', usage_date: '2026-10-23' })
    expect(rows.length).toBe(1)
    const r = rows[0] as UsageDailyRecord
    expect(r.tokens_in).toBe(1000)
    expect(r.tokens_out).toBe(2000)
    expect(r.cache_read).toBe(500)
    expect(r.cache_creation).toBe(100)
    expect(r.runs_count).toBe(1)
    expect(r.first_ts).toBe(T0)
    expect(r.last_ts).toBe(T1)
  })

  it('upsert 并格：四桶累加+runs_count 计数+MIN/MAX 锚+沿用原行 id', () => {
    const before = (ledger.listUsageDaily({ company: 'studio-dev', person_id: 'ENG-2' })[0]) as UsageDailyRecord
    ledger.upsertUsageDaily(
      delta({
        id: makeUlid(T2), // 新 id——冲突沿用原行主键
        tokens: { input: 11, output: 22, cache_read: 3, cache_creation: 0 },
        first_ts: T0 + 60_000, // 更晚——MIN 取原值
        last_ts: T2, // 更晚——MAX 取新值
      }),
    )
    const rows = ledger.listUsageDaily({ company: 'studio-dev', usage_date: '2026-10-23' })
    expect(rows.length).toBe(1) // 并格不新增行
    const r = rows[0] as UsageDailyRecord
    expect(r.id).toBe(before.id)
    expect(r.tokens_in).toBe(1011)
    expect(r.tokens_out).toBe(2022)
    expect(r.cache_read).toBe(503)
    expect(r.cache_creation).toBe(100)
    expect(r.runs_count).toBe(2)
    expect(r.first_ts).toBe(T0)
    expect(r.last_ts).toBe(T2)
  })

  it('自然键任一异=新格：人/模型/日期三维各一格', () => {
    ledger.upsertUsageDaily(delta({ person_id: 'ENG-3', id: makeUlid(T0 + 1) }))
    ledger.upsertUsageDaily(delta({ model: 'glm/GLM-5.3', id: makeUlid(T0 + 2) }))
    ledger.upsertUsageDaily(delta({ usage_date: '2026-10-24', id: makeUlid(T0 + 3), last_ts: T2, updated_at: T2 }))
    const all = ledger.listUsageDaily({ company: 'studio-dev' })
    expect(all.length).toBe(4)
    expect(ledger.listUsageDaily({ company: 'studio-dev', person_id: 'ENG-3' }).length).toBe(1)
    expect(ledger.listUsageDaily({ company: 'studio-dev', model: 'glm/GLM-5.3' }).length).toBe(1)
    expect(ledger.listUsageDaily({ company: 'studio-dev', usage_date: '2026-10-24' }).length).toBe(1)
  })

  it('形状闸：坏日期/负 tokens/坏 ULID/未知键/缺桶拒（configInvalid）', () => {
    expect(() => ledger.upsertUsageDaily(delta({ usage_date: '2026-02-30' }))).toThrow(/usage_date/)
    expect(() => ledger.upsertUsageDaily(delta({ usage_date: '2026-10-23', tokens: { input: -1, output: 0 } }))).toThrow(/tokens/)
    expect(() => ledger.upsertUsageDaily(delta({ id: 'not-ulid' }))).toThrow()
    expect(() => ledger.upsertUsageDaily(delta({ extra: 1 }))).toThrow()
    expect(() => ledger.upsertUsageDaily(delta({ tokens: { output: 5 } }))).toThrow() // input 必填
  })

  it('replace：整组替换+公司不一致拒（原投影留全——回滚不留半截）', () => {
    const id1 = makeUlid(T2)
    const id2 = makeUlid(T2 + 1)
    const replaced = ledger.replaceUsageDaily('studio-dev', [
      {
        id: id1, company: 'studio-dev', person_id: 'ENG-2', model: 'deepseek/deepseek-flash', usage_date: '2026-10-23',
        tokens_in: 9000, tokens_out: 9000, cache_read: 0, cache_creation: 0, runs_count: 3, first_ts: T0, last_ts: T2, updated_at: T2,
      },
      {
        id: id2, company: 'studio-dev', person_id: 'ENG-3', model: 'glm/GLM-5.3', usage_date: '2026-10-23',
        tokens_in: 500, tokens_out: 500, cache_read: 0, cache_creation: 0, runs_count: 1, updated_at: T2,
      },
    ])
    expect(replaced.rows).toBe(2)
    expect(ledger.listUsageDaily({ company: 'studio-dev' }).length).toBe(2)
    expect(ledger.listUsageDaily({ company: 'studio-dev', usage_date: '2026-10-24' }).length).toBe(0) // 旧日格随整组替换清
    // 公司不一致：整批拒——行数不动
    expect(() =>
      ledger.replaceUsageDaily('studio-dev', [
        { id: makeUlid(T2 + 2), company: 'other-co', person_id: 'ENG-2', model: 'm', usage_date: '2026-10-23', tokens_in: 1, tokens_out: 1, cache_read: 0, cache_creation: 0, runs_count: 1, updated_at: T2 },
      ]),
    ).toThrow(/other-co/)
    expect(ledger.listUsageDaily({ company: 'studio-dev' }).length).toBe(2)
  })
})
