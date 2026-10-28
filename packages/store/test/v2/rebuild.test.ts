/**
 * rebuild —— MIG-04 / IMPL-04-07：重建只重放 events、cost_daily 零重放、报告含排除域
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-07（rebuid 面验收：`test:v2 -- packages/store` 绿；排除域报告；
 *     cost_daily 零重放）／IMPL-04-03（rebuild/drill/dump 排除域清单）
 *   - docs/v2/16 §四（DOM-04 限域：rebuild 重放范围只有 events；报告不得声称钱账已重建；
 *     「排除域清单」显式列 `cost_daily`＋理由）／§一 B11（rebuild 循环体只 appendEvent）
 *   - docs/v2/05 §三 DOM-04（cost_daily 历史钱账：只备份不重放、遗留不可重建）
 *   - docs/v2/17 §三 NEG-MIG-02（删库重建后金额不一致可判，不静默抹平）——本文件只证
 *     rebuild 侧的结构面（排除域零重放）；分列对账值证据落 cost-frozen.test.ts 与
 *     rebuild-exclusion.test.ts（既有 V2 件，不重复改写）
 *
 * 覆盖：
 *   1. rebuild 只重放 events：目标库 events 全量、cost_daily 恒 0 行、源表原样；
 *   2. 排除域三面一致：RebuildResult.excludedDomains / 常量表 / 人读报告；
 *   3. dump 的 JSONL 只含 events 列（钱账行无导出路径）；
 *   4. 负向：钱账行被手工塞进 JSONL 也无法借 rebuild 入账——整批坏行回滚，不留半截库。
 *
 * 隔离：临时目录真文件库（`os.tmpdir()`；删库重建需真文件语义）；**不碰真实台账库**。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LATEST_VERSION, openLedger } from '../../src/index.ts'
import {
  COST_DAILY_EXCLUSION_REASON,
  COST_DAILY_DOMAIN,
  EXCLUDED_DOMAINS,
  EXCLUDED_DOMAIN_REASONS,
  rebuild,
  renderRebuildReport,
} from '../../src/rebuild.ts'
import { costRow, eventRecord, T0, ulid } from './fixtures.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-rebuild-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 建源库：4 条 events＋2 条 cost_daily 定型行；返回 dump 出的 JSONL 路径 */
function seedSource(name: string): { dbPath: string; jsonl: string } {
  const dbPath = path.join(root, `${name}-src.db`)
  const jsonl = path.join(root, `${name}.jsonl`)
  const ledger = openLedger(dbPath)
  try {
    for (let i = 0; i < 4; i++) {
      ledger.appendEvent(eventRecord({ id: ulid(T0, 300 + i), ts: T0 + i, event: 'LLM', cost_usd: 0.01 * (i + 1) }))
    }
    ledger.appendCostDaily(costRow({ id: ulid(T0, 400), cost_usd: 0.25 }))
    ledger.appendCostDaily(costRow({ id: ulid(T0, 401), person_id: 'ENG-2', cost_usd: 0.5 }))
    ledger.dumpEvents(jsonl)
  } finally {
    ledger.close()
  }
  return { dbPath, jsonl }
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  return Number(row.c)
}

describe('rebuild 重放范围（只 events；B11 不回退）', () => {
  it('目标库 events 全量重放、cost_daily 恒 0 行；源库两表原样', () => {
    expect(LATEST_VERSION).toBe(15) // MIG-04 波前版本（v14 records＋v15 events 触发器）
    const { dbPath, jsonl } = seedSource('basic')
    const target = path.join(root, 'basic-target.db')

    const result = rebuild(jsonl, target)
    expect(result.events).toBe(4)
    expect(result.version).toBe(LATEST_VERSION)
    expect(result.excludedDomains).toEqual(['cost_daily'])

    const rebuilt = openLedger(target)
    try {
      expect(rebuilt.queryEvents()).toHaveLength(4)
      expect(rebuilt.listCostDaily()).toHaveLength(0) // 排除域零重放：钱账未重建
      expect(countRows(rebuilt.db, 'events')).toBe(4)
      expect(countRows(rebuilt.db, 'cost_daily')).toBe(0)
    } finally {
      rebuilt.close()
    }

    const sourceAgain = openLedger(dbPath)
    try {
      expect(sourceAgain.queryEvents()).toHaveLength(4)
      expect(sourceAgain.listCostDaily()).toHaveLength(2) // rebuild 只写 target，源表不受影响
    } finally {
      sourceAgain.close()
    }
  })

  it('dump 的 JSONL 每行只含 events 列（钱账列无导出路径）', () => {
    const { jsonl } = seedSource('jsonl-shape')
    const text = readFileSync(jsonl, 'utf8')
    const lines = text.split('\n').filter((line) => line !== '')
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>
      expect(Object.hasOwn(row, 'event')).toBe(true)
      expect(Object.hasOwn(row, 'id')).toBe(true)
      expect(Object.hasOwn(row, 'cost_date')).toBe(false)
      expect(Object.hasOwn(row, 'person_id')).toBe(false)
      expect(Object.hasOwn(row, 'tokens_in')).toBe(false)
      expect(Object.hasOwn(row, 'price_snapshot_id')).toBe(false)
    }
  })
})

describe('排除域报告（rebuild / 常量表同源；不得声称钱账已重建）', () => {
  it('报告含排除域清单与理由；结构面 excludedDomains＝常量表；无金额/重建完成话术', () => {
    const { jsonl } = seedSource('report')
    const target = path.join(root, 'report-target.db')
    const result = rebuild(jsonl, target)
    const report = renderRebuildReport(result, target)

    expect(result.excludedDomains).toEqual([...EXCLUDED_DOMAINS])
    expect(result.excludedDomains).toEqual([COST_DAILY_DOMAIN])
    expect(EXCLUDED_DOMAIN_REASONS[COST_DAILY_DOMAIN]).toBe(COST_DAILY_EXCLUSION_REASON)

    expect(report[0]).toBe(`已重建：events=4 / schema v${LATEST_VERSION} → ${target}`)
    const text = report.join('\n')
    expect(text).toContain('排除域：cost_daily（不重放；重建/导出范围只有 events）')
    expect(text).toContain('只备份不重放')
    expect(text).toContain('遗留不可重建')
    expect(text).toContain('备份=恢复语义，非重建语义')
    expect(text).toContain('排除域备份：cost_daily 未随本次操作生成')
    expect(text).not.toContain('钱账已重建')
    // 重建报告不出现金额：没有单一「已对平」数字可供静默抹平（NEG-MIG-02 前腿）
    expect(text).not.toMatch(/\bUSD\b|cost_daily=|\d+\.\d+/)
  })
})

describe('负向：钱账行无法借 JSONL 混入重建路径', () => {
  it('第 2 行为 cost_daily 行 → 整批 CONFIG_INVALID 回滚，目标库零事件零钱账（不留半截）', () => {
    const jsonl = path.join(root, 'mixed.jsonl')
    const target = path.join(root, 'mixed-target.db')
    const first = eventRecord({ id: ulid(T0, 500), ts: T0, event: 'CLOSE' })
    const cost = costRow({ id: ulid(T0, 501) })
    writeFileSync(jsonl, `${JSON.stringify(first)}\n${JSON.stringify(cost)}\n`, 'utf8')

    let caught: unknown
    try {
      rebuild(jsonl, target)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('第 2 行')

    const opened = openLedger(target)
    try {
      // 单事务原子：第 1 行合法事件也随批回滚——不留半截库
      expect(opened.queryEvents()).toHaveLength(0)
      expect(countRows(opened.db, 'events')).toBe(0)
      expect(countRows(opened.db, 'cost_daily')).toBe(0)
    } finally {
      opened.close()
    }
  })
})
