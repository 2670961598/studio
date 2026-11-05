/**
 * harvest-recon 增量扫描 V2 套件（studio-dev-812 后续单；P1 loop-lag 尖峰治理）
 *
 * 原缺陷：每 `harvestReconEveryTicks`=30 拍 `ledger.queryEvents()` 全表扫描（events≈23.3 万行），
 * 单拍 +1.3–2.3s（30 拍 5.12s vs 其他 1.31s），watchdog 误判。本套件钉：
 *   ① 首扫全量→二次零新事件只走增量（queryEvents 不再调用）；② 增量新增事件被消费且与
 *   强制全量等价；③ kv 游标持久化（重开 ledger 后修复/续跑）；④ 游标失效/超前/非整数回退
 *   全量并修复；⑤ ts 乱序（回填）回退全量；⑥ 索引失败 onProblem 明报不吞、kv 不前进。
 * 不 skip/only/todo/retry；不改 schema/契约/事件词。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { HARVEST_RECON_CURSOR_KEY } from '../../../src/engine/jobs/harvest-recon-index.ts'
import { runHarvestRecon, type HarvestReconResult } from '../../../src/engine/jobs/harvest-recon.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-recon-inc-'))
const T0 = Date.parse('2026-11-06T00:00:00.000Z')
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

let lead = 0
function evt(issue: string, event: EventRecord['event'], ts: number, note: string, attempt = 1): EventRecord {
  lead += 1
  return { id: makeUlid(ts + lead), ts, company: 'demo', issue, event, actor: 'daemon', attempt, level: 2, dept: 'departments/综合部', tokens: { input: 0 }, note }
}

function seedBase(ledger: ReturnType<typeof openLedger>, jobId: string): void {
  ledger.upsertJob({ job_id: jobId, company: 'demo', dept: 'departments/综合部', cron: '0 9 * * *', role: 'AGENT-1', level: 2, model_tier: 'low', budget_cap: 1, payload: { type: 'report', output: 'reports' }, next_run_at: T0, status: 'active' })
  ledger.appendEvent(evt('demo-1', 'PATROL', T0, `job=${jobId};dedup=${jobId}@${T0}`))
  ledger.appendEvent(evt('demo-1', 'GATE_PASS', T0 + 1, '四要件齐；report=/tmp/ws/REPORT.md'))
}

function recon(ledger: ReturnType<typeof openLedger>, companyDir: string, onProblem?: (m: string) => void): HarvestReconResult {
  return runHarvestRecon({ ledger, companyDir, emit: () => {}, ...(onProblem !== undefined ? { onProblem } : {}) })
}

function counters(r: HarvestReconResult): Record<string, unknown> {
  return { scanned: r.scanned, inPlace: r.inPlace, repaired: r.repaired, manual: r.manual, sentinelOk: r.sentinelOk, sentinelMissing: r.sentinelMissing, invalid: r.invalid, patrolArtifacts: r.patrolArtifacts }
}

describe('harvest-recon 增量扫描', () => {
  it('首扫全量 → 零新事件二次只增量：queryEvents 不再调用、游标保持', () => {
    const ledger = openLedger(path.join(ROOT, 'zero.sqlite'))
    const companyDir = path.join(ROOT, 'zero-company')
    seedBase(ledger, 'job-zero')
    const spy = vi.spyOn(ledger, 'queryEvents')
    const first = recon(ledger, companyDir)
    expect(first.scanMode).toBe('full')
    expect(spy).toHaveBeenCalledTimes(1)
    const cursor = ledger.kvGet(HARVEST_RECON_CURSOR_KEY)
    expect(cursor).not.toBeNull()
    const second = recon(ledger, companyDir)
    expect(second.scanMode).toBe('delta')
    expect(second.newEvents).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1) // 零新事件：未再全量
    expect(ledger.kvGet(HARVEST_RECON_CURSOR_KEY)).toBe(cursor) // 游标不前进
    ledger.close()
  })

  it('增量消费新增事件，且与强制全量结果逐字段等价', () => {
    const ledger = openLedger(path.join(ROOT, 'equiv.sqlite'))
    const companyDir = path.join(ROOT, 'equiv-company')
    seedBase(ledger, 'job-equiv')
    recon(ledger, companyDir)
    // 新增第二单 PATROL+GATE_PASS（无归档→manual 1 条，recon-key 去重）
    ledger.appendEvent(evt('demo-2', 'PATROL', T0 + 10, 'job=job-equiv;dedup=job-equiv@2'))
    ledger.appendEvent(evt('demo-2', 'GATE_PASS', T0 + 11, '四要件齐；report=/tmp/ws2/REPORT.md'))
    const delta = recon(ledger, companyDir)
    expect(delta.scanMode).toBe('delta')
    expect(delta.newEvents).toBe(2)
    expect(delta.scanned).toBe(2)
    // 强制全量（破坏游标）→ 同文件系统状态下逐字段等价
    ledger.kvSet(HARVEST_RECON_CURSOR_KEY, 'broken')
    const full = recon(ledger, companyDir)
    expect(full.scanMode).toBe('full')
    expect(counters(full)).toEqual(counters(delta))
    ledger.close()
  })

  it('kv 游标跨 ledger 重开持久化（重开首扫全量修复/续跑；之后增量）', () => {
    const db = path.join(ROOT, 'restart.sqlite')
    const companyDir = path.join(ROOT, 'restart-company')
    const firstLedger = openLedger(db)
    seedBase(firstLedger, 'job-restart')
    recon(firstLedger, companyDir)
    const cursor = firstLedger.kvGet(HARVEST_RECON_CURSOR_KEY)
    firstLedger.close()
    // 新进程/新 ledger 对象：kv 游标仍在；首扫全量（缓存缺失）并修复游标；随后增量
    const secondLedger = openLedger(db)
    const reopened = recon(secondLedger, companyDir)
    expect(reopened.scanMode).toBe('full')
    expect(secondLedger.kvGet(HARVEST_RECON_CURSOR_KEY)).toBe(cursor)
    const next = recon(secondLedger, companyDir)
    expect(next.scanMode).toBe('delta')
    expect(next.newEvents).toBe(0)
    secondLedger.close()
  })

  it('游标失效/超前/非整数 → 全量回退并修复游标', () => {
    const ledger = openLedger(path.join(ROOT, 'invalid.sqlite'))
    const companyDir = path.join(ROOT, 'invalid-company')
    seedBase(ledger, 'job-invalid')
    recon(ledger, companyDir)
    const tip = ledger.eventsChainTipSeq()
    for (const bad of ['not-a-number', String(tip + 99), '-3']) {
      ledger.kvSet(HARVEST_RECON_CURSOR_KEY, bad)
      const r = recon(ledger, companyDir)
      expect(r.scanMode).toBe('full') // 失效回退
      expect(Number(ledger.kvGet(HARVEST_RECON_CURSOR_KEY))).toBe(tip) // 修复游标
    }
    ledger.close()
  })

  it('新事件 ts 乱序（回填 ≤ lastTs）→ 回退全量（不得按 chain 顺序错位首条口径）', () => {
    const ledger = openLedger(path.join(ROOT, 'backfill.sqlite'))
    const companyDir = path.join(ROOT, 'backfill-company')
    seedBase(ledger, 'job-backfill')
    recon(ledger, companyDir)
    ledger.appendEvent(evt('demo-9', 'PATROL', T0 - 5, 'job=job-backfill;dedup=backfill-old')) // 迟到回填
    const r = recon(ledger, companyDir)
    expect(r.scanMode).toBe('full')
    expect(Number(ledger.kvGet(HARVEST_RECON_CURSOR_KEY))).toBe(ledger.eventsChainTipSeq())
    ledger.close()
  })

  it('索引失败不吞：onProblem 明报、kv 不前进；恢复后下轮全量成功', () => {
    const ledger = openLedger(path.join(ROOT, 'fail.sqlite'))
    const companyDir = path.join(ROOT, 'fail-company')
    seedBase(ledger, 'job-fail')
    const problems: string[] = []
    const spy = vi.spyOn(ledger, 'queryEvents').mockImplementation(() => {
      throw new Error('probe-query-down')
    })
    const failed = recon(ledger, companyDir, (m) => problems.push(m))
    expect(failed.manual).toBe(1)
    expect(problems.some((p) => p.includes('对账步索引失败') && p.includes('probe-query-down'))).toBe(true)
    expect(ledger.kvGet(HARVEST_RECON_CURSOR_KEY)).toBeNull() // 失败不前进
    spy.mockRestore()
    const recovered = recon(ledger, companyDir, (m) => problems.push(m))
    expect(recovered.scanMode).toBe('full')
    expect(Number(ledger.kvGet(HARVEST_RECON_CURSOR_KEY))).toBe(ledger.eventsChainTipSeq())
    ledger.close()
  })
})

/** F1 夹具：job-A=report 有 output；job-B=patrol 无 output——首个 PATROL 锚决定 processed 面 */
function seedTwoJobs(ledger: ReturnType<typeof openLedger>): void {
  ledger.upsertJob({ job_id: 'job-A', company: 'demo', dept: 'departments/综合部', cron: '0 9 * * *', role: 'AGENT-1', level: 2, model_tier: 'low', budget_cap: 1, payload: { type: 'report', output: 'reports' }, next_run_at: T0, status: 'active' })
  ledger.upsertJob({ job_id: 'job-B', company: 'demo', dept: 'departments/综合部', cron: '0 10 * * *', role: 'AGENT-1', level: 2, model_tier: 'low', budget_cap: 1, payload: { type: 'patrol' }, next_run_at: T0, status: 'active' })
}

function eventWithId(id: string, issue: string, event: EventRecord['event'], ts: number, note: string): EventRecord {
  return { id, ts, company: 'demo', issue, event, actor: 'daemon', attempt: 1, level: 2, dept: 'departments/综合部', tokens: { input: 0 }, note }
}

describe('812 后续 F1：delta 批内 (ts,id) 排序（锚分裂/永久漏扫回归）', () => {
  it('a) 批内 ts 回填乱序：late(job-B patrol) 先追加、early(job-A 回填) 后追加 → delta 与 full 逐字段等价且不漏扫', () => {
    const ledger = openLedger(path.join(ROOT, 'f1a.sqlite'))
    const companyDir = path.join(ROOT, 'f1a-company')
    seedTwoJobs(ledger)
    ledger.appendEvent(evt('demo-1', 'PATROL', T0, 'job=job-A;dedup=x'))
    ledger.appendEvent(evt('demo-1', 'GATE_PASS', T0 + 1, '四要件齐；report=/tmp/ws/REPORT.md'))
    expect(recon(ledger, companyDir).scanMode).toBe('full')
    // 批内 chain 序 = late(T0+100 job-B) 先，early(T0+50 job-A) 后；full 的 (ts,id) 序应选 early 锚
    ledger.appendEvent(evt('demo-2', 'PATROL', T0 + 100, 'job=job-B;dedup=late'))
    ledger.appendEvent(evt('demo-2', 'PATROL', T0 + 50, 'job=job-A;dedup=early'))
    ledger.appendEvent(evt('demo-2', 'GATE_PASS', T0 + 200, '四要件齐；report=/tmp/ws2/REPORT.md'))
    const delta = recon(ledger, companyDir)
    expect(delta.scanMode).toBe('delta')
    expect(delta.scanned).toBe(2) // full 锚=job-A(report)→demo-2 进 scanned；job-B 锚会漏（1）
    const deltaCounters = counters(delta)
    // 连续第二轮 delta：零新事件、索引完整（无永久漏扫）
    const second = recon(ledger, companyDir)
    expect(second.scanMode).toBe('delta')
    expect(second.newEvents).toBe(0)
    expect(counters(second)).toEqual(deltaCounters)
    // 强制 full：逐字段等价
    ledger.kvSet(HARVEST_RECON_CURSOR_KEY, 'broken')
    const full = recon(ledger, companyDir)
    expect(full.scanMode).toBe('full')
    expect(counters(full)).toEqual(deltaCounters)
    ledger.close()
  })

  it('b) 同 ts 两条 PATROL，id 字典序与链序相反：delta 与 full 逐字段等价且不漏扫', () => {
    const ledger = openLedger(path.join(ROOT, 'f1b.sqlite'))
    const companyDir = path.join(ROOT, 'f1b-company')
    seedTwoJobs(ledger)
    ledger.appendEvent(evt('demo-1', 'PATROL', T0, 'job=job-A;dedup=base'))
    ledger.appendEvent(evt('demo-1', 'GATE_PASS', T0 + 1, '四要件齐；report=/tmp/ws/REPORT.md'))
    expect(recon(ledger, companyDir).scanMode).toBe('full')
    const ts = T0 + 300
    const idLow = makeUlid(ts) // 字典序小
    const idHigh = makeUlid(ts + 1) // 字典序大
    // 链序先高位 id（job-B patrol），后低位 id（job-A report）——full (ts,id) 序取低位 job-A 锚
    ledger.appendEvent(eventWithId(idHigh, 'demo-3', 'PATROL', ts, 'job=job-B;dedup=high'))
    ledger.appendEvent(eventWithId(idLow, 'demo-3', 'PATROL', ts, 'job=job-A;dedup=low'))
    ledger.appendEvent(evt('demo-3', 'GATE_PASS', ts + 1, '四要件齐；report=/tmp/ws3/REPORT.md'))
    const delta = recon(ledger, companyDir)
    expect(delta.scanMode).toBe('delta')
    expect(delta.scanned).toBe(2) // full 锚=job-A；旧实现链序锚 job-B → 1（漏扫）
    const deltaCounters = counters(delta)
    const second = recon(ledger, companyDir)
    expect(second).toMatchObject({ scanMode: 'delta', newEvents: 0 })
    expect(counters(second)).toEqual(deltaCounters)
    ledger.kvSet(HARVEST_RECON_CURSOR_KEY, 'broken')
    const full = recon(ledger, companyDir)
    expect(full.scanMode).toBe('full')
    expect(counters(full)).toEqual(deltaCounters)
    ledger.close()
  })
})
