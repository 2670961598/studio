/**
 * rebuild-exclusion —— MIG-04 / IMPL-04-03：rebuild/drill/dump 排除域清单（G-DOM-04）
 *
 * 依据：docs/v2/16 §四（cost_daily 限域：只备份不重放＋排除域清单）、docs/v2/05 §三 DOM-04、
 *       plan/05 IMPL-04-03、v2/17 NEG-MIG-02（备份恢复值与事件账投影值分列可判）。
 *
 * 覆盖：
 *   1. EXCLUDED_DOMAINS / 理由（DOM-04：只备份不重放，遗留不可重建）；
 *   2. dump：DumpResult.excludedDomains＋renderDumpReport「排除域」段；JSONL 只含 events；
 *   3. rebuild：RebuildResult.excludedDomains＋renderRebuildReport「排除域」段；cost_daily 零重放；
 *   4. drill：报告「排除域」段含 cost_daily/理由/备份路径/sha256，且明示钱账未重建（不判等）；
 *   5. NEG-MIG-02：删库重建后备份值与事件账投影值分列保留、差异可判，不静默抹平。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, rebuild, renderDrillReport, runLedgerDrill } from '../../src/index.ts'
import { EXCLUDED_DOMAINS, EXCLUDED_DOMAIN_REASONS, renderRebuildReport } from '../../src/rebuild.ts'
import { renderDumpReport } from '../../src/ledger.ts'
import { backupCostDaily, readCostDailyBackup, verifyBackup } from '../../src/backup.ts'
import { costRow, eventRecord, roundUsd, T0, ulid } from './fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-exclusion-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('排除域规范（DOM-04）', () => {
  it('EXCLUDED_DOMAINS=[cost_daily]，理由锚定「只备份不重放/遗留不可重建」', () => {
    expect([...EXCLUDED_DOMAINS]).toEqual(['cost_daily'])
    const reason = EXCLUDED_DOMAIN_REASONS['cost_daily']
    expect(reason).toContain('DOM-04')
    expect(reason).toContain('只备份不重放')
    expect(reason).toContain('遗留不可重建')
  })
})

describe('dump 排除域段（ledger.ts dump 报告面）', () => {
  it('报告含排除域清单；JSONL 只导出 events，cost_daily 不入导出路径', () => {
    const dbPath = path.join(root, 'dump.db')
    const jsonl = path.join(root, 'dump.jsonl')
    const ledger = openLedger(dbPath)
    try {
      for (let i = 0; i < 3; i++) {
        ledger.appendEvent(eventRecord({ id: ulid(T0, 10 + i), ts: T0 + i, event: 'LLM', cost_usd: 0.01 * i }))
      }
      ledger.appendCostDaily(costRow({ id: ulid(T0, 50) }))
      ledger.appendCostDaily(costRow({ id: ulid(T0, 51), person_id: 'ENG-2', cost_usd: 0.5 }))

      const dump = ledger.dumpEvents(jsonl)
      expect(dump.lines).toBe(3)
      expect(dump.excludedDomains.map((ref) => ref.domain)).toEqual(['cost_daily'])
      const excluded = dump.excludedDomains[0]
      expect(excluded?.reason).toContain('只备份不重放')
      expect(excluded?.backup).toBeUndefined() // dump 不生成钱账备份——只有 report 引用

      const report = renderDumpReport(dump, jsonl).join('\n')
      expect(report).toContain('已导出 3 行')
      expect(report).toContain('排除域')
      expect(report).toContain('cost_daily')
      expect(report).toContain('只备份不重放')

      const parsed = readFileSync(jsonl, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(parsed).toHaveLength(3)
      expect(parsed.every((row) => 'event' in row && !('cost_date' in row) && !('person_id' in row))).toBe(true)
      expect(ledger.listCostDaily()).toHaveLength(2) // dump 只读 events，源表未被触碰
    } finally {
      ledger.close()
    }
  })
})

describe('rebuild 排除域段与零钱账重放（B11 口径不回退）', () => {
  it('返回值/报告显式列 cost_daily；重建库 cost_daily=0 行、源表不动', () => {
    const source = path.join(root, 'rebuild-src.db')
    const jsonl = path.join(root, 'rebuild.jsonl')
    const target = path.join(root, 'rebuild-target.db')
    const ledger = openLedger(source)
    for (let i = 0; i < 4; i++) {
      ledger.appendEvent(eventRecord({ id: ulid(T0, 20 + i), ts: T0 + i, event: 'LLM', cost_usd: 0.02 }))
    }
    ledger.appendCostDaily(costRow({ id: ulid(T0, 60) }))
    ledger.appendCostDaily(costRow({ id: ulid(T0, 61), person_id: 'ENG-2', cost_usd: 0.5 }))
    ledger.dumpEvents(jsonl)
    ledger.close()

    const result = rebuild(jsonl, target)
    expect(result.events).toBe(4)
    expect(result.excludedDomains).toEqual(['cost_daily'])
    const report = renderRebuildReport(result, target).join('\n')
    expect(report).toContain('已重建：events=4')
    expect(report).toContain('排除域')
    expect(report).toContain('cost_daily')
    expect(report).toContain('只备份不重放')

    const rebuilt = openLedger(target)
    try {
      expect(rebuilt.queryEvents()).toHaveLength(4)
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 不重放：钱账不在 events JSONL 里
    } finally {
      rebuilt.close()
    }

    const sourceAgain = openLedger(source)
    try {
      expect(sourceAgain.listCostDaily()).toHaveLength(2) // rebuild 只写 target，源表原样
    } finally {
      sourceAgain.close()
    }
  })
})

describe('drill 排除域段（演习报告不得声称钱账已重建）', () => {
  it('报告含 cost_daily/理由/备份路径/sha256；备份校验通过、重建库零钱账、两账分列', async () => {
    const dbPath = path.join(root, 'drill.db')
    const report = await runLedgerDrill(dbPath)

    expect(report.pass).toBe(true)
    // 兼容旧演习口径：比对检查仍为四项（排除域证据不冒充第五条 check）
    expect(report.checks.map((check) => check.name)).toEqual(['删库到位', '计数一致', '逐条一致', 'schema_version 一致'])
    expect(report.checks.every((check) => check.pass)).toBe(true)

    const excluded = report.excludedDomains[0]
    expect(excluded?.domain).toBe('cost_daily')
    expect(excluded?.reason).toContain('只备份不重放')
    expect(excluded?.backup?.path).toBe(report.costDaily.backupPath)
    expect(excluded?.backup?.sha256).toBe(report.costDaily.backupSha256)
    expect(report.costDaily.backupPath.endsWith('.jsonl')).toBe(true)
    expect(report.costDaily.backupSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.costDaily.sealedRows).toBe(2)
    expect(report.costDaily.backupLines).toBe(2)
    expect(report.costDaily.backupVerified).toBe(true)
    expect(report.costDaily.replayedRows).toBe(0) // 不重放
    expect(report.costDaily.backupTotalUsd).toBe(0.75)
    expect(report.costDaily.eventProjectionUsd).toBe(0.015)
    // 备份件是演习产物（留库同址）——路径引用在报告后仍可复算
    expect(existsSync(report.costDaily.backupPath)).toBe(true)
    expect(verifyBackup(report.costDaily.backupPath, report.costDaily.backupSha256)).toMatchObject({ ok: true, lines: 2 })
    expect(readCostDailyBackup(report.costDaily.backupPath).reduce((sum, row) => sum + row.cost_usd, 0)).toBe(0.75)

    const text = renderDrillReport(report).join('\n')
    expect(text).toContain('排除域')
    expect(text).toContain('cost_daily')
    expect(text).toContain('只备份不重放')
    expect(text).toContain(`sha256=${report.costDaily.backupSha256}`)
    expect(text).toContain('钱账未重建')
    expect(text).toContain('未重放')
    expect(text).toContain('备份件与侧车留在演习库同址')
    expect(text).not.toContain('钱账已重建')
    // 两账分列：备份恢复值与事件账投影值各自出现，不合并为单一总额
    expect(text).toContain(`备份恢复值=${report.costDaily.backupTotalUsd} USD`)
    expect(text).toContain(`事件账 cost_usd 合计=${report.costDaily.eventProjectionUsd} USD`)
    expect(report.costDaily.backupTotalUsd).not.toBe(report.costDaily.eventProjectionUsd)
    expect(renderDrillReport(report).at(-1)).toBe('演习 PASS')

    const rebuilt = openLedger(dbPath)
    try {
      expect(rebuilt.queryEvents()).toHaveLength(report.corpus)
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 重建产物里没有钱账——备份≠重放
    } finally {
      rebuilt.close()
    }
  })
})

describe('NEG-MIG-02 重建对账（分列可判，不静默抹平）', () => {
  it('删库重建后备份恢复值/事件账投影值分列保留；差异可见且备份仍可校验', () => {
    const dbPath = path.join(root, 'neg02.db')
    const jsonl = path.join(root, 'neg02.jsonl')
    const target = path.join(root, 'neg02-target.db')
    const backupPath = path.join(root, 'neg02-cost_daily.jsonl')
    const ledger = openLedger(dbPath)
    ledger.appendEvent(eventRecord({ id: ulid(T0, 700), cost_usd: 0.01 }))
    ledger.appendCostDaily(costRow({ id: ulid(T0, 701), cost_usd: 0.4 }))
    ledger.appendCostDaily(costRow({ id: ulid(T0, 702), person_id: 'ENG-2', cost_usd: 0.35 }))
    const backup = backupCostDaily(ledger.db, backupPath)
    ledger.dumpEvents(jsonl)
    ledger.close()

    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
    const result = rebuild(jsonl, target)
    expect(result.excludedDomains).toContain('cost_daily')

    const rebuilt = openLedger(target)
    try {
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 不重放、不静默恢复
      const restored = readCostDailyBackup(backup.path)
      const backupValue = roundUsd(restored.reduce((sum, row) => sum + row.cost_usd, 0))
      const projectionValue = roundUsd(rebuilt.queryEvents().reduce((sum, event) => sum + (event.cost_usd ?? 0), 0))
      expect(backupValue).toBe(0.75)
      expect(projectionValue).toBe(0.01)
      expect(backupValue).not.toBe(projectionValue) // 两值分列 → 不一致可判
      expect(verifyBackup(backup.path, backup.sha256)).toMatchObject({ ok: true, lines: 2 })
    } finally {
      rebuilt.close()
    }
  })
})
