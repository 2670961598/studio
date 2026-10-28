/**
 * cost-frozen —— MIG-04 / IMPL-04-07：cost_daily 定型面 NEG 套件（NEG-MIG-01/02）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-07（记录面 NEG 套件；验收：`test:v2 -- packages/store` 绿）
 *   - docs/v2/16 §四（DOM-04 限域：`cost_daily` 为定型 append-only 账；改/删应被拒；
 *     删库重建后金额一致/不一致**可判**——备份恢复值与事件账投影值分列，不静默抹平；
 *     对账规则未决 GAP-V2-01）／§一 B10（v12 触发器拒改删现状）、B11（rebuild 零 cost 重放）
 *   - docs/v2/17 §三 NEG-MIG-01（改/删 cost_daily → 触发器拒，V5）、NEG-MIG-02（重建对账：
 *     备份值与投影值分列可判，V5）；同卷 NEG-EVD-05 的「分列可判」腿由本文件 §NEG-MIG-02
 *     一并承载（改/删快照可判归 backup.test.ts 既有 V2 件）；NEG-SEC-03（events 触发器）
 *     归 events-trigger.test.ts 既有 V2 件，本文件不改写、不重复。
 *   - docs/v2/05 §三 DOM-04（历史钱账只备份不重放、遗留不可重建）
 *
 * 覆盖：
 *   1. NEG-MIG-01：v12 两枚触发器在位；UPDATE/DELETE（单行/整表）被 ABORT 且行零变化；
 *      append-only 仍可追加（拒绝的是改史，不是新事实）；
 *   2. NEG-MIG-02：删库重建后备份恢复值（备份件复算）与事件账投影值（重建库 events 复算）
 *      分列保留、差异可判；演习报告两值分列不判等，不合并为单一总额、不声称钱账已重建。
 *
 * 隔离：临时目录真文件库；**不碰真实台账库**、不读环境、无 mock（真 SQLite 触发器真触发）。
 */
import { rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  currentVersion,
  openLedger,
  renderDrillReport,
  runLedgerDrill,
  type Ledger,
} from '../../src/index.ts'
import { costDailyMigration } from '../../src/cost.ts'
import { backupCostDaily, readCostDailyBackup, verifyBackup } from '../../src/backup.ts'
import { rebuild, renderRebuildReport } from '../../src/rebuild.ts'
import { costRow, eventRecord, roundUsd, T0, ulid } from './fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-cost-frozen-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 夹具（临时库；真触发器，不做任何 monkeypatch）
// ---------------------------------------------------------------------------

function countCost(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM cost_daily').get() as { c: number }
  return Number(row.c)
}

interface CostProjection {
  cost_usd: number
  tokens_in: number
  kind: string
  note: string | null
  adjusts_id: string | null
}

function costProjection(db: DatabaseSync, id: string): CostProjection {
  const row = db
    .prepare('SELECT cost_usd, tokens_in, kind, note, adjusts_id FROM cost_daily WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (row === undefined) throw new Error(`cost_daily 行不存在：${id}`)
  return {
    cost_usd: Number(row['cost_usd']),
    tokens_in: Number(row['tokens_in']),
    kind: String(row['kind']),
    note: row['note'] === null ? null : String(row['note']),
    adjusts_id: row['adjusts_id'] === null ? null : String(row['adjusts_id']),
  }
}

/** 断言 ABORT：消息＝v12 触发器的 RAISE 第二参数（定型账 append-only） */
function expectAppendOnlyAbort(fn: () => unknown, op: 'UPDATE' | 'DELETE'): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const message = (caught as Error).message
  expect(message).toContain('cost_daily 已定型 append-only')
  expect(message).toContain(`${op} 被拒`)
}

function openTemp(name: string): Ledger {
  return openLedger(path.join(root, `${name}.db`))
}

// ---------------------------------------------------------------------------
// NEG-MIG-01：改/删 cost_daily 被 v12 触发器拒（V5）
// ---------------------------------------------------------------------------

describe('NEG-MIG-01 cost_daily 改/删被拒（v12 定型账 append-only）', () => {
  it('两枚触发器在位：BEFORE UPDATE/DELETE，均 RAISE(ABORT)；迁移条目自含同一机制', () => {
    const ledger = openTemp('triggers')
    try {
      expect(currentVersion(ledger.db)).toBe(15)
      const rows = ledger.db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'cost_daily' ORDER BY name")
        .all() as unknown as Array<{ name: string; sql: string }>
      expect(rows.map((row) => String(row.name))).toEqual(['trg_cost_daily_no_delete', 'trg_cost_daily_no_update'])
      for (const row of rows) {
        expect(String(row.sql)).toContain('RAISE(ABORT')
        expect(String(row.sql)).toContain('cost_daily 已定型 append-only')
        expect(String(row.sql)).toMatch(/BEFORE (?:UPDATE|DELETE) ON cost_daily/)
      }
      // 迁移条目（DDL 唯一源）内含且仅含两枚触发器——B10 计数不回退
      expect(costDailyMigration.sql.match(/CREATE TRIGGER/g)).toHaveLength(2)
      expect(costDailyMigration.sql).toContain('trg_cost_daily_no_update')
      expect(costDailyMigration.sql).toContain('trg_cost_daily_no_delete')
    } finally {
      ledger.close()
    }
  })

  it('UPDATE 被 ABORT：金额/桶/kind 三面改不动，行零变化（拒绝不是「先改后报错」）', () => {
    const ledger = openTemp('update')
    try {
      const id = ulid(T0, 100)
      ledger.appendCostDaily(costRow({ id, cost_usd: 0.25, note: '日终首冻' }))
      const before = costProjection(ledger.db, id)

      expectAppendOnlyAbort(() => ledger.db.prepare('UPDATE cost_daily SET cost_usd = ? WHERE id = ?').run(999, id), 'UPDATE')
      expectAppendOnlyAbort(() => ledger.db.prepare('UPDATE cost_daily SET tokens_in = ? WHERE id = ?').run(999999, id), 'UPDATE')
      expectAppendOnlyAbort(() => ledger.db.prepare("UPDATE cost_daily SET kind = 'adjustment' WHERE id = ?").run(id), 'UPDATE')
      // 无 WHERE 的整表改写同样被拒（不因批量而放行）
      expectAppendOnlyAbort(() => ledger.db.exec('UPDATE cost_daily SET cost_usd = 0'), 'UPDATE')

      expect(costProjection(ledger.db, id)).toEqual(before)
      expect(countCost(ledger.db)).toBe(1)
    } finally {
      ledger.close()
    }
  })

  it('DELETE 被 ABORT：按 id 删与整表清空都被拒，行仍可读（append-only 链不可缩短）', () => {
    const ledger = openTemp('delete')
    try {
      const first = ulid(T0, 110)
      const second = ulid(T0, 111)
      ledger.appendCostDaily(costRow({ id: first }))
      ledger.appendCostDaily(costRow({ id: second, person_id: 'ENG-2', cost_usd: 0.5 }))
      expect(countCost(ledger.db)).toBe(2)

      expectAppendOnlyAbort(() => ledger.db.prepare('DELETE FROM cost_daily WHERE id = ?').run(first), 'DELETE')
      expectAppendOnlyAbort(() => ledger.db.exec('DELETE FROM cost_daily'), 'DELETE')

      expect(countCost(ledger.db)).toBe(2)
      expect(ledger.listCostDaily().map((row) => row.id).sort()).toEqual([first, second].sort())
    } finally {
      ledger.close()
    }
  })

  it('append-only 不是整表冻结：迟到事实 adjustment 仍可追加（只拒改删，不拒新事实）', () => {
    const ledger = openTemp('append')
    try {
      const finalId = ulid(T0, 120)
      ledger.appendCostDaily(costRow({ id: finalId }))
      ledger.appendCostDaily({
        id: ulid(T0, 121),
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
        note: '迟到事实（负 delta 原值保留）',
      })

      const rows = ledger.listCostDaily()
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.kind).sort()).toEqual(['adjustment', 'final'])
      expect(roundUsd(rows.reduce((sum, row) => sum + row.cost_usd, 0))).toBe(0.15)
      expect(rows.find((row) => row.kind === 'adjustment')?.adjusts_id).toBe(finalId)
    } finally {
      ledger.close()
    }
  })
})

// ---------------------------------------------------------------------------
// NEG-MIG-02：删库重建后备份值与事件账投影值分列可判、不静默抹平（V5）
// ---------------------------------------------------------------------------

describe('NEG-MIG-02 重建对账：两账分列可判（不静默抹平）', () => {
  it('自定义不一致量级：备份恢复值 1.25 ≠ 事件账投影 0.05，重建后两值各自可复算、钱账零重放', () => {
    const dbPath = path.join(root, 'neg02-custom.db')
    const jsonl = path.join(root, 'neg02-custom.jsonl')
    const backupPath = path.join(root, 'neg02-custom.cost_daily.jsonl')
    let backupSha = ''
    const ledger = openLedger(dbPath)
    try {
      ledger.appendEvent(eventRecord({ id: ulid(T0, 800), cost_usd: 0.02 }))
      ledger.appendEvent(eventRecord({ id: ulid(T0, 801), ts: T0 + 1, cost_usd: 0.03, note: '第二条' }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 810), cost_usd: 0.75 }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 811), person_id: 'ENG-2', cost_usd: 0.5 }))
      const backup = backupCostDaily(ledger.db, backupPath)
      backupSha = backup.sha256
      ledger.dumpEvents(jsonl)
      expect(backup.lines).toBe(2)
    } finally {
      ledger.close()
    }

    // 删库三件套 → 只重放 events（钱账不随重建恢复）
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(file, { force: true })
    const result = rebuild(jsonl, dbPath)
    expect(result.excludedDomains).toEqual(['cost_daily'])

    const rebuilt = openLedger(dbPath)
    try {
      // 事件账投影值（重建库 events 复算）
      const projection = roundUsd(rebuilt.queryEvents().reduce((sum, event) => sum + (event.cost_usd ?? 0), 0))
      // 备份恢复值（备份件复算；恢复=人工显式动作，不是 rebuild 自动路径）
      const restored = readCostDailyBackup(backupPath)
      const backupValue = roundUsd(restored.reduce((sum, row) => sum + row.cost_usd, 0))

      expect(backupValue).toBe(1.25)
      expect(projection).toBe(0.05)
      expect(backupValue).not.toBe(projection) // 不一致可判——不是「静默抹平」
      expect(roundUsd(backupValue - projection)).toBe(1.2)
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 重建库无钱账行：不静默恢复、不静默补 0
      expect(countCost(rebuilt.db)).toBe(0)
      expect(rebuilt.queryEvents()).toHaveLength(2)
    } finally {
      rebuilt.close()
    }

    expect(verifyBackup(backupPath, backupSha)).toMatchObject({ ok: true, lines: 2 })
    // rebuild 报告不含金额：结构面不提供「单一已对平数字」
    const report = renderRebuildReport(result, dbPath).join('\n')
    expect(report).toContain('排除域')
    expect(report).not.toMatch(/USD|\d+\.\d+/)
  })

  it('删库重建演习报告两值分列不判等：备份恢复值/事件账投影值各自可复算，差异可见且不阻断也不抹平', async () => {
    const dbPath = path.join(root, 'neg02-drill.db')
    const report = await runLedgerDrill(dbPath)
    expect(report.pass).toBe(true)
    expect(report.costDaily.replayedRows).toBe(0)

    // 复算备份恢复值（从演习备份件，不信任报告自报）
    const restored = readCostDailyBackup(report.costDaily.backupPath)
    const restoredTotal = roundUsd(restored.reduce((sum, row) => sum + row.cost_usd, 0))
    expect(restoredTotal).toBe(0.75)
    expect(report.costDaily.backupTotalUsd).toBe(restoredTotal)
    expect(verifyBackup(report.costDaily.backupPath, report.costDaily.backupSha256)).toMatchObject({ ok: true, lines: 2 })

    // 复算事件账投影值（重建库 events，不信任报告自报）
    const rebuilt = openLedger(dbPath)
    let projection = 0
    try {
      projection = roundUsd(rebuilt.queryEvents().reduce((sum, event) => sum + (event.cost_usd ?? 0), 0))
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 零重放：钱账未重建
    } finally {
      rebuilt.close()
    }
    expect(projection).toBe(0.015)
    expect(report.costDaily.eventProjectionUsd).toBe(projection)
    expect(restoredTotal).not.toBe(projection) // 分列 → 差异可判

    const text = renderDrillReport(report).join('\n')
    expect(text).toContain('分列不判等')
    expect(text).toContain('GAP-V2-01')
    expect(text).toContain(`备份恢复值=${restoredTotal} USD`)
    expect(text).toContain(`事件账 cost_usd 合计=${projection} USD`)
    expect(text).toContain('钱账未重建')
    expect(text).not.toContain('钱账已重建')
    expect(text).not.toContain('两账一致')
    // 不合并为单一总额：差值/合计都不得作为已对平数字出现
    expect(text).not.toContain(`=${roundUsd(restoredTotal + projection)} USD`)
    expect(text).not.toContain(`差异=${roundUsd(restoredTotal - projection)}`)
  })
})
