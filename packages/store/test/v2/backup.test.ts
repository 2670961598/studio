/**
 * backup —— MIG-04 / IMPL-04-04：cost_daily 备份快照（JSONL＋sha256；G-DOM-04）
 *
 * 依据：docs/v2/16 §四（备份快照：SQL/JSONL＋sha256；备份=恢复语义非重建语义）、
 *       plan/05 IMPL-04-04、v2/17 NEG-MIG-01（改/删被拒）／NEG-EVD-05（快照被改可判）。
 *
 * 覆盖：
 *   1. JSONL 稳定键序（冻结列序）/ 稳定行序（cost_date, person_id, model, id）；
 *   2. sha256 侧车 `<out>.sha256`（`<hex>  <basename>` 形）与返回值一致、可复算；
 *   3. verifyBackup：摘要一致/不一致/缺失件；readCostDailyBackup 恢复行（含负 delta adjustment）；
 *   4. 只读源表：备份前后行集不变；空表=0 行空文件；
 *   5. NEG-MIG-01：UPDATE/DELETE cost_daily 被 v12 触发器拒；
 *   6. 篡改备份件可判（sha 不符）＋列集漂移 fail-closed（不静默漏列）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger } from '../../src/index.ts'
import { COST_DAILY_BACKUP_COLUMNS, backupCostDaily, readCostDailyBackup, sha256Hex, verifyBackup } from '../../src/backup.ts'
import { costRow, T0, ulid } from './fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-backup-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 独立复算摘要（测试侧用 node:crypto，不信任生产实现自报） */
function independentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('cost_daily 备份件（JSONL＋sha256）', () => {
  it('JSONL 稳定键序/行序、侧车摘要、恢复行全列（含负 delta adjustment）', () => {
    const dbPath = path.join(root, 'backup.db')
    const outPath = path.join(root, 'cost_daily.jsonl')
    const ledger = openLedger(dbPath)
    try {
      const finalId = ulid(T0, 100)
      ledger.appendCostDaily(costRow({ id: finalId }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 102), person_id: 'ENG-2', cost_usd: 0.5, note: '夜班' }))
      ledger.appendCostDaily({
        id: ulid(T0, 101),
        company: 'games',
        person_id: 'ENG-1',
        model: 'deepseek/deepseek-flash',
        cost_date: '2026-10-23',
        tokens: { tokens_in: 10, tokens_out: 5, cache_read: 0, cache_creation: 0 },
        price_snapshot_id: 'models-yaml:deepseek/deepseek-flash',
        cost_usd: -0.1,
        kind: 'adjustment',
        adjusts_id: finalId,
        closed_at: T0 + 1,
        closed_by: 'cost-adjust:2026-10-23',
        note: '迟到事实',
      })

      const backup = backupCostDaily(ledger.db, outPath)
      expect(backup.domain).toBe('cost_daily')
      expect(backup.lines).toBe(3)
      expect(backup.path).toBe(outPath)
      expect(backup.digestPath).toBe(`${outPath}.sha256`)

      const text = readFileSync(outPath, 'utf8')
      expect(text.endsWith('\n')).toBe(true)
      const rawLines = text.split('\n').filter((line) => line !== '')
      expect(rawLines).toHaveLength(3)
      const expectedSha = independentSha256(text)
      expect(backup.sha256).toBe(expectedSha)
      expect(sha256Hex(text)).toBe(expectedSha)
      // 侧车内容：<hex>  <basename>\n
      expect(readFileSync(backup.digestPath, 'utf8')).toBe(`${expectedSha}  ${path.basename(outPath)}\n`)
      // 键序冻结：逐行 JSON 键序 = 备份列序
      for (const line of rawLines) {
        const row = JSON.parse(line) as Record<string, unknown>
        expect(Object.keys(row)).toEqual([...COST_DAILY_BACKUP_COLUMNS])
      }
      // 行序冻结 (cost_date, person_id, model, id)：ENG-1 final → ENG-1 adjustment → ENG-2 final
      const rows = readCostDailyBackup(outPath)
      expect(rows.map((row) => row.person_id)).toEqual(['ENG-1', 'ENG-1', 'ENG-2'])
      expect(rows[0]?.adjusts_id).toBeNull()
      expect(rows[0]?.note).toBeNull()
      expect(rows[1]?.adjusts_id).toBe(finalId)
      expect(rows[1]?.cost_usd).toBe(-0.1) // adjustment signed delta 原值保留（不取绝对值）
      expect(rows[1]?.kind).toBe('adjustment')
      expect(rows[2]?.note).toBe('夜班')
      // 摘要校验：裸 hex / sha256: 前缀均可
      expect(verifyBackup(outPath, expectedSha)).toMatchObject({ ok: true, lines: 3, expected: expectedSha, actual: expectedSha })
      expect(verifyBackup(outPath, `sha256:${expectedSha}`).ok).toBe(true)
      // 只读源表：备份前后行集不变
      expect(ledger.listCostDaily()).toHaveLength(3)
      expect(ledger.listCostDaily({ kind: 'adjustment' })).toHaveLength(1)
    } finally {
      ledger.close()
    }
  })

  it('同库同内容两次备份字节一致（稳定输出，sha256 可复算）', () => {
    const ledger = openLedger(path.join(root, 'stable.db'))
    try {
      ledger.appendCostDaily(costRow({ id: ulid(T0, 200) }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 201), person_id: 'ENG-2', cost_usd: 0.5 }))
      const first = backupCostDaily(ledger.db, path.join(root, 'stable-a.jsonl'))
      const second = backupCostDaily(ledger.db, path.join(root, 'stable-b.jsonl'))
      expect(readFileSync(first.path, 'utf8')).toBe(readFileSync(second.path, 'utf8'))
      expect(first.sha256).toBe(second.sha256)
      expect(first.sha256).toBe(independentSha256(readFileSync(first.path, 'utf8')))
    } finally {
      ledger.close()
    }
  })

  it('空表：0 行、空文件、空串 sha256（侧车仍落盘）', () => {
    const ledger = openLedger(path.join(root, 'empty.db'))
    const outPath = path.join(root, 'empty.jsonl')
    try {
      const backup = backupCostDaily(ledger.db, outPath)
      expect(backup.lines).toBe(0)
      expect(readFileSync(outPath, 'utf8')).toBe('')
      expect(backup.sha256).toBe(independentSha256(''))
      expect(readFileSync(backup.digestPath, 'utf8')).toBe(`${backup.sha256}  empty.jsonl\n`)
      expect(readCostDailyBackup(outPath)).toEqual([])
      expect(verifyBackup(outPath, backup.sha256)).toMatchObject({ ok: true, lines: 0 })
    } finally {
      ledger.close()
    }
  })
})

describe('NEG-MIG-01：cost_daily 定型面改/删被触发器拒（库侧机制）', () => {
  it('UPDATE/DELETE 均 ABORT，行内容原样；trg_cost_daily_no_update/no_delete 在位', () => {
    const ledger = openLedger(path.join(root, 'neg-mig-01.db'))
    try {
      ledger.appendCostDaily(costRow({ id: ulid(T0, 300) }))
      const triggers = ledger.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_cost_daily_%' ORDER BY name")
        .all() as Array<{ name: unknown }>
      expect(triggers.map((row) => String(row.name))).toEqual(['trg_cost_daily_no_delete', 'trg_cost_daily_no_update'])

      expect(() => ledger.db.prepare('UPDATE cost_daily SET cost_usd = 9.99').run()).toThrow(/UPDATE 被拒/)
      expect(() => ledger.db.prepare("UPDATE cost_daily SET note = '改写'").run()).toThrow(/UPDATE 被拒/)
      expect(() => ledger.db.prepare('DELETE FROM cost_daily').run()).toThrow(/DELETE 被拒/)
      expect(() => ledger.db.prepare("DELETE FROM cost_daily WHERE person_id = 'ENG-1'").run()).toThrow(/DELETE 被拒/)

      const rows = ledger.listCostDaily()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.cost_usd).toBe(0.25)
      expect(rows[0]?.note).toBeUndefined() // 触发 ABORT 后写入未落库
    } finally {
      ledger.close()
    }
  })
})

describe('NEG-EVD-05 快照面：改/删备份件可判，缺件报错', () => {
  it('篡改备份件 → verifyBackup ok=false（实际摘要可复算）；缺件 → CONFIG_INVALID', () => {
    const ledger = openLedger(path.join(root, 'tamper.db'))
    try {
      ledger.appendCostDaily(costRow({ id: ulid(T0, 400) }))
      const backup = backupCostDaily(ledger.db, path.join(root, 'tamper.jsonl'))
      const original = readFileSync(backup.path, 'utf8')
      writeFileSync(backup.path, original.replace('"cost_usd":0.25', '"cost_usd":0.99'), 'utf8')
      const checked = verifyBackup(backup.path, backup.sha256)
      expect(checked.ok).toBe(false)
      expect(checked.actual).not.toBe(checked.expected)
      expect(checked.actual).toBe(independentSha256(readFileSync(backup.path, 'utf8')))
      // 篡改值可读回 → 差异可判（不是被静默接受为「原值」）
      expect(readCostDailyBackup(backup.path)[0]?.cost_usd).toBe(0.99)
      expect(() => verifyBackup(path.join(root, 'missing.jsonl'), backup.sha256)).toThrow(/store\/backup:missing/)
    } finally {
      ledger.close()
    }
  })

  it('备份行类型漂移 → 拒读（null 不被静默强转成 0，值不被抹平）', () => {
    const ledger = openLedger(path.join(root, 'bad-type.db'))
    try {
      ledger.appendCostDaily(costRow({ id: ulid(T0, 500) }))
      const backup = backupCostDaily(ledger.db, path.join(root, 'bad-type.jsonl'))
      const original = readFileSync(backup.path, 'utf8')
      writeFileSync(backup.path, original.replace('"cost_usd":0.25', '"cost_usd":null'), 'utf8')
      expect(() => readCostDailyBackup(backup.path)).toThrow(/store\/backup:bad-row/)
    } finally {
      ledger.close()
    }
  })
})

describe('备份列集冻结闸（schema 漂移 fail-closed）', () => {
  it('cost_daily 列集与备份列集不一致 → store/backup:column-drift（不静默漏列）', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE cost_daily (id TEXT)')
      expect(() => backupCostDaily(db, path.join(root, 'drift.jsonl'))).toThrow(/store\/backup:column-drift/)
    } finally {
      db.close()
    }
  })
})
