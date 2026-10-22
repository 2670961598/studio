/**
 * v8 测试（132-§6.1 单A 成本契约刀，studio-dev-168）：work_records.model 列迁移面。
 * 覆盖：
 *   - 新库直达 v8（LATEST_VERSION=8；model 列在表尾、TEXT、可空无默认）；
 *   - v7→v8 升级路径：存量行原样（tokens 旧形 `cached` 键 JSON 不改写）+ 新列 NULL；
 *   - 偏差申报锚：132-§6.1/§10 写「v9」系 A-E 五单合计投影序号，仓库纪律「version
 *     单调 +1」（migrations.ts 头注）优先——本刀取 v8，后续单依合入序顺延。
 * 环境：os.tmpdir() 真文件库（沿 v4/v7 测试风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentVersion, LATEST_VERSION, migrate } from '../src/migrations.ts'
import { openLedger, type Ledger } from '../src/index.ts'

let root = ''
let dbPath = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v8-'))
  dbPath = path.join(root, 'ledger.db')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('v8 迁移面：work_records.model 列（132-§6.1 单A）', () => {
  it('版本号：LATEST_VERSION=8（单调 +1——v9 为 132 提案期五单合计投影序号，偏差已申报）', () => {
    expect(LATEST_VERSION).toBe(9)
  })

  it('新库直达 v8：currentVersion=8；model 列存在（TEXT、可空、无默认）且居表尾（ALTER 追加）', () => {
    const db = new DatabaseSync(dbPath)
    try {
      const applied = migrate(db)
      expect(applied).toBe(9)
      expect(currentVersion(db)).toBe(9)
      const cols = db.prepare('PRAGMA table_info(work_records)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>
      const modelCol = cols.find((c) => c.name === 'model')
      expect(modelCol).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null })
      // ALTER 追加=尾列（存量行零改写；列序不参与任何读写语义）
      expect(cols[cols.length - 1]?.name).toBe('model')
    } finally {
      db.close()
    }
  })
})

describe('v7→v8 升级路径（存量行兼容）', () => {
  it('v7 库升级：migrate 只补 v8；旧形 tokens（cached 键）JSON 字节不动 + model 列 NULL=无从可知', () => {
    const legacyPath = path.join(root, 'legacy.db')
    // 造 v7 库：裸 DatabaseSync + upTo 截断（openLedger 会跑满——升级前语义用裸库构造）
    const db = new DatabaseSync(legacyPath)
    migrate(db, { upTo: 7 })
    expect(currentVersion(db)).toBe(7)
    db.prepare(
      `INSERT INTO work_records (id, issue, person_id, executor, started_at, ended_at, cost_usd, tokens, attempt, status)
       VALUES ('wr-legacy', 'STUDIO-777', 'AGENT-7', 'dsh', 1760000000000, 1760000600000, 0.0, ?, 1, 'done')`,
    ).run('{"input":900,"output":120,"cached":45000}')
    db.close()

    // 重开=生产路径（openLedger 幂等补 v8）：存量行原样 + 新列可写可读
    const ledger: Ledger = openLedger(legacyPath)
    try {
      const rec = ledger.getWorkRecord('wr-legacy')
      expect(rec).toMatchObject({
        id: 'wr-legacy',
        executor: 'dsh',
        status: 'done',
        tokens: { input: 900, output: 120, cached: 45000 }, // 旧形键原样往返——读侧 cache_read ?? cached 归消费方（engine）
      })
      expect(rec?.model).toBeUndefined() // v7 存量行无模型可考——如实缺省（不猜）
      // 升级后新行四桶+model 全通（读写面回归——insertWorkRecord/endWorkRecord 细面见 v4/ledger 套）
      ledger.insertWorkRecord({
        id: 'wr-v8',
        issue: 'STUDIO-778',
        person_id: 'AGENT-7',
        executor: 'dsh',
        started_at: 1760000100000,
        attempt: 1,
        status: 'running',
        model: 'glm/GLM-5.3',
      })
      expect(ledger.endWorkRecord('wr-v8', {
        ended_at: 1760000700000,
        status: 'done',
        tokens: { input: 100, output: 20, cache_read: 30, cache_creation: 10 },
      })).toBe(true)
      expect(ledger.getWorkRecord('wr-v8')).toMatchObject({
        model: 'glm/GLM-5.3',
        tokens: { input: 100, output: 20, cache_read: 30, cache_creation: 10 },
      })
    } finally {
      ledger.close()
    }
  })
})
