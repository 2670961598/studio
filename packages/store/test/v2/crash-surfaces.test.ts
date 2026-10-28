/**
 * crash-surfaces —— MIG-06 记录面第 7/8/9 注入点的**纯 store 断言**（真进程 SIGKILL 腿在
 * apps/daemon/test/v2/crash/surfaces-crash.test.ts，不在此文件）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/03 MIG-06「记录面注入点补点」；plan/04 §1.6（记录面四点扩展；恢复判据纯函数部分
 *     归 core/store 用例，真进程 SIGKILL 生命周期归 daemon 侧）；
 *   - docs/v2/16 §四（DOM-04：备份=恢复语义、非重建语义；报告不得声称钱账已重建）／§一 B11
 *     （rebuild 单事务只重放 events，不留半截库）；docs/v2/17 §1.1 V5（三不变量）。
 *
 * 覆盖（不含进程生命周期——crash 点必须在真进程验，本文件只证 store 侧判据）：
 *   1. 备份半写＋全量摘要侧车：verifyBackup 判否、行数不足、不得当完整；生产重跑完整且 sha 稳定；
 *   2. 重建单事务：半重放 ROLLBACK 零行（无半投影）；生产 rebuild 重跑幂等（不重复不丢、排除域零重放）；
 *   3. 排除域报告完整性：完整报告含排除域清单/理由/备份声明；半报告（缺理由与备份行）不得判完整。
 *
 * 隔离：临时目录真文件库（`os.tmpdir()`）；不碰真实台账、不读环境、不依赖系统时钟。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, openLedger, rebuild } from '../../src/index.ts'
import { backupCostDaily, readCostDailyBackup, verifyBackup } from '../../src/backup.ts'
import { renderRebuildReport } from '../../src/rebuild.ts'
import { costRow, eventRecord, T0, ulid } from './fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-crash-surfaces-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 独立复算摘要（测试侧用 node:crypto，不信任生产实现自报） */
function independentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function countRows(dbPath: string, table: 'events' | 'cost_daily'): number {
  const ledger = openLedger(dbPath)
  try {
    const row = ledger.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as unknown as { c: number }
    return Number(row.c)
  } finally {
    ledger.close()
  }
}

/** 备份件完整性判定：canonical 存在＋侧车摘要校验通过＋行数等于源行数（三合一才算有效） */
function backupComplete(outPath: string, expectedRows: number): boolean {
  const digestPath = `${outPath}.sha256`
  let declared = ''
  try {
    declared = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] ?? ''
  } catch {
    return false
  }
  try {
    const checked = verifyBackup(outPath, declared)
    return checked.ok && checked.lines === expectedRows
  } catch {
    return false
  }
}

/** 排除域报告完整性判定：须含排除域清单/理由/备份声明，且不得称钱账已重建 */
function reportComplete(text: string): boolean {
  return (
    text.includes('已重建：events=')
    && text.includes('排除域：cost_daily')
    && text.includes('只备份不重放')
    && text.includes('未随本次操作生成')
    && !text.includes('钱账已重建')
  )
}

/** 4 行定型钱账（自然键互异；与 daemon crash 腿场景同形） */
function seedCostRows(ledger: ReturnType<typeof openLedger>): void {
  for (let i = 0; i < 4; i++) {
    ledger.appendCostDaily(
      costRow({
        id: ulid(T0, 500 + i),
        person_id: i % 2 === 0 ? 'ENG-1' : 'ENG-2',
        cost_date: `2026-10-${20 + i}`,
        cost_usd: 0.25 + i * 0.5,
        closed_at: T0 + i,
      }),
    )
  }
}

describe('第 7 点纯 store 判据：备份半写＋全量摘要侧车不得当完整', () => {
  it('半 JSONL（侧车仍为全量摘要）→ verifyBackup ok=false/行数不足；生产重跑完整且 sha 与崩溃前全量身份一致', () => {
    const dbPath = path.join(root, 'backup.db')
    const outPath = path.join(root, 'cost_daily.jsonl')
    const ledger = openLedger(dbPath)
    try {
      seedCostRows(ledger)
      const full = backupCostDaily(ledger.db, outPath)
      expect(full.lines).toBe(4)
      const fullText = readFileSync(outPath, 'utf8')
      expect(independentSha256(fullText)).toBe(full.sha256) // 崩溃前的全量身份

      // 模拟写入中途被硬杀：只留前半 JSONL，侧车未回滚（仍声明全量身份）
      const lines = fullText.split('\n').filter((line) => line !== '')
      writeFileSync(outPath, lines.slice(0, 2).map((line) => `${line}\n`).join(''), 'utf8')
      const checked = verifyBackup(outPath, full.sha256)
      expect(checked.ok).toBe(false)
      expect(checked.actual).not.toBe(checked.expected)
      expect(checked.lines).toBe(2)
      expect(readCostDailyBackup(outPath)).toHaveLength(2) // 半文件不被当完整（4 行）
      expect(backupComplete(outPath, 4)).toBe(false)

      // 重启重跑：生产备份覆盖出完整件；sha 与崩溃前声明的全量身份一致（同库同内容确定性）
      const rerun = backupCostDaily(ledger.db, outPath)
      expect(rerun.lines).toBe(4)
      expect(rerun.sha256).toBe(full.sha256)
      expect(verifyBackup(outPath, rerun.sha256)).toMatchObject({ ok: true, lines: 4 })
      expect(readCostDailyBackup(outPath).map((row) => row.id)).toEqual([ulid(T0, 500), ulid(T0, 501), ulid(T0, 502), ulid(T0, 503)])
      expect(readFileSync(rerun.digestPath, 'utf8')).toBe(`${full.sha256}  ${path.basename(outPath)}\n`)
      expect(backupComplete(outPath, 4)).toBe(true)
      // 只读源表：备份前后 4 行原样
      expect(ledger.listCostDaily()).toHaveLength(4)
    } finally {
      ledger.close()
    }
  })
})

describe('第 8 点纯 store 判据：重建事务回滚与重跑幂等', () => {
  it('半重放 ROLLBACK → 目标库零行（无半投影）；rebuild 连跑两次仍全量 6 行（不重复不丢、排除域零重放）', () => {
    const source = path.join(root, 'events-source.db')
    const jsonl = path.join(root, 'events.jsonl')
    const target = path.join(root, 'rebuild-target.db')
    const ledger = openLedger(source)
    try {
      for (let i = 0; i < 6; i++) {
        ledger.appendEvent(eventRecord({ id: ulid(T0, 600 + i), ts: T0 + i, event: i % 2 === 0 ? 'LLM' : 'CLOSE' }))
      }
      ledger.appendCostDaily(costRow({ id: ulid(T0, 650) }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 651), person_id: 'ENG-2', cost_usd: 0.5 }))
      expect(ledger.dumpEvents(jsonl).lines).toBe(6)
    } finally {
      ledger.close()
    }

    // 崩溃缝隙的事务语义：BEGIN→重放前 3 行→ROLLBACK 后零残留（不留半投影）
    const half = openLedger(target)
    try {
      const lines = readFileSync(jsonl, 'utf8').split('\n').filter((line) => line !== '')
      half.db.exec('BEGIN')
      for (const line of lines.slice(0, 3)) half.appendEvent(JSON.parse(line))
      expect(half.queryEvents()).toHaveLength(3)
      half.db.exec('ROLLBACK')
      expect(half.queryEvents()).toHaveLength(0)
    } finally {
      half.close()
    }

    const first = rebuild(jsonl, target)
    expect(first.events).toBe(6)
    expect(first.version).toBe(LATEST_VERSION)
    expect(first.excludedDomains).toEqual(['cost_daily'])
    const expectedIds = Array.from({ length: 6 }, (_, i) => ulid(T0, 600 + i))
    const after = openLedger(target)
    let firstEvents: string
    try {
      expect(after.queryEvents().map((event) => event.id)).toEqual(expectedIds)
      expect(countRows(target, 'events')).toBe(6)
      expect(countRows(target, 'cost_daily')).toBe(0) // 排除域不重放
      firstEvents = JSON.stringify(after.queryEvents())
    } finally {
      after.close()
    }

    // 重跑幂等：同源二次 rebuild（appendEvent 同 id 全列一致跳过）→ 仍 6 行、内容不变
    const second = rebuild(jsonl, target)
    expect(second.events).toBe(6)
    expect(countRows(target, 'events')).toBe(6)
    expect(countRows(target, 'cost_daily')).toBe(0)
    const again = openLedger(target)
    try {
      expect(JSON.stringify(again.queryEvents())).toBe(firstEvents)
      const distinct = again.db.prepare('SELECT COUNT(DISTINCT id) AS c FROM events').get() as unknown as { c: number }
      expect(Number(distinct.c)).toBe(6) // 不重复（不是 12）
    } finally {
      again.close()
    }
  })
})

describe('第 9 点纯 store 判据：排除域报告完整性', () => {
  it('完整报告含排除域清单/理由/备份声明；半报告（缺理由与备份行）不得判完整', () => {
    const result = { events: 6, version: LATEST_VERSION, excludedDomains: ['cost_daily'] }
    const report = renderRebuildReport(result, '/tmp/rebuild-target.db')
    expect(report).toHaveLength(4)
    const full = report.join('\n') + '\n'
    expect(reportComplete(full)).toBe(true)
    expect(full).toContain('排除域：cost_daily')
    expect(full).toContain('只备份不重放')
    expect(full).toContain('遗留不可重建')
    expect(full).toContain('未随本次操作生成')
    expect(full).not.toContain('钱账已重建')
    expect(full).not.toMatch(/\bUSD\b/)

    // 半报告＝前一半行（缺「排除域理由」「排除域备份」两行）——不得当有效报告
    const half = report.slice(0, 2).join('\n') + '\n'
    expect(half).not.toContain('只备份不重放')
    expect(half).not.toContain('未随本次操作生成')
    expect(reportComplete(half)).toBe(false)
  })
})
