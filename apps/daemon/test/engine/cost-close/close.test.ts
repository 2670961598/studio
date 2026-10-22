/**
 * cost-close 工序测试（132-§6.3 单D·studio-dev-179）：日终收口 tick 全语义。
 *
 * 断言面（plan.md §3；时区无关——本地时刻构造，本地日=构造日）：
 *   1. 时刻闸：19:54 不跑；19:55 首拍进工序；
 *   2. 首冻：usage×快照折算 → cost_daily final 行（快照锚/exact/closed_by 工序锚串）
 *      + kv 前进 + REPORT_COST_CLOSE note（rows/usd 计数）+ 零用量日照收；
 *   3. kv 幂等：同晚重拍 ran=false 零新行；
 *   4. 三路降级不静默：stale 沿用/桥/无价 → DAILY_ALARM degraded 计数；
 *   5. 追平：kv 落后多日 → 一次收齐（旧→新）；
 *   6. 巡检（S3）：迟到事实并格 → 次日收口拍 signed adjustment（挂 final 行）+
 *      Σ 真值一致 + cost-adjust 事件；迟到新格 → 补 final；
 *   7. 对账段：Σcost_daily vs ΣGATE_PASS（差>eps → 文件注因段 notes）；
 *   8. 失败不前进：落账崩 → 告警+kv 不动 → 下一拍重入收敛（半收日补齐）；
 *   9. 报告面：<companyDir>/reports/综合部/cost-close/cost-close-<X>.json
 *      （caliber cost-close/v1）+ insertReport 快照行（同自然键覆盖换代）；
 *  10. costCloseDeps 缝装配：emit 闭包经 makeEvent 落事件台账。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord, IssueRecord, ModelTier } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  COST_CLOSE_KV_KEY,
  costCloseDeps,
  runCostCloseTick,
  type CostCloseDeps,
  type CostCloseTickReport,
} from '../../../src/engine/cost-close/close.ts'

const COMPANY = 'demo-corp'

/** 本地时刻（时区无关：本地日=构造日） */
const localTime = (y: number, m: number, d: number, h: number, min = 0): number => new Date(y, m - 1, d, h, min, 0, 0).valueOf()

/** 确定性 ULID（26 字符全 0 段+序号——Crockford '0' 合法） */
function detIds(): (ts: number) => string {
  let n = 0
  return (): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface Harness {
  ledger: Ledger
  companyDir: string
  events: { kind: 'REPORT_COST_CLOSE' | 'DAILY_ALARM'; note: string }[]
  errors: string[]
  ids: (ts: number) => string
  now(): number
  setNow(t: number): void
  deps(overrides?: Partial<CostCloseDeps>): CostCloseDeps
  tiers?: ModelTier[] | undefined
  setTiers(t: ModelTier[] | undefined): void
}

let root = ''

function harness(id: string, tiers?: ModelTier[]): Harness {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  const companyDir = path.join(root, `${id}-company`)
  const events: { kind: 'REPORT_COST_CLOSE' | 'DAILY_ALARM'; note: string }[] = []
  const errors: string[] = []
  const ids = detIds()
  let t = localTime(2026, 10, 22, 19, 55)
  let curTiers = tiers
  const base: CostCloseDeps = {
    ledger,
    company: COMPANY,
    companyDir,
    tiers: curTiers,
    now: () => t,
    makeId: ids,
    emitReport: (note) => events.push({ kind: 'REPORT_COST_CLOSE', note }),
    emitAlarm: (note) => events.push({ kind: 'DAILY_ALARM', note }),
    onError: (message) => errors.push(message),
  }
  return {
    ledger,
    companyDir,
    events,
    errors,
    ids,
    now: () => t,
    setNow: (v) => {
      t = v
    },
    deps: (overrides) => ({ ...base, ...(overrides ?? {}), ...(curTiers !== undefined ? { tiers: curTiers } : {}) }),
    tiers: curTiers,
    setTiers: (v) => {
      curTiers = v
    },
  }
}

/** 快照落账（ps-<ULID>；api 轨缺省） */
function seedPrice(h: Harness, provider: string, model: string, priceDate: string, inputPerM: number, outputPerM: number, cacheRead?: number): void {
  h.ledger.appendPriceSnapshot({
    id: `ps-${h.ids(0)}`,
    company: COMPANY,
    provider,
    model,
    price_date: priceDate,
    slot: 'peak',
    input_per_m: inputPerM,
    output_per_m: outputPerM,
    ...(cacheRead !== undefined ? { cache_read_per_m: cacheRead } : {}),
    billing_track: 'api',
    source_note: '工序测试采价',
    source_ticket: 'studio-dev-179-test',
    published_by: 'eng-6',
  })
}

/** 用量并格（自然键累加——收割 write-through 同口） */
function seedUsage(h: Harness, person: string, model: string, date: string, inputTok: number, outputTok: number, cacheRead = 0, cacheCreation = 0): void {
  h.ledger.upsertUsageDaily({
    id: h.ids(0),
    company: COMPANY,
    person_id: person,
    model,
    usage_date: date,
    tokens: { input: inputTok, output: outputTok, cache_read: cacheRead, cache_creation: cacheCreation },
    first_ts: localTime(2026, 10, 1, 9),
    last_ts: localTime(2026, 10, 1, 10),
    updated_at: localTime(2026, 10, 1, 10),
  })
}

/** GATE_PASS 事件（对账段收割侧——本地日 X 的收割折算账） */
function seedGatePass(h: Harness, ts: number, usd: number, model: string): void {
  const rec: EventRecord = {
    id: h.ids(0),
    ts,
    company: COMPANY,
    issue: 'hb-sentinel',
    event: 'GATE_PASS',
    actor: 'daemon',
    attempt: 1,
    level: 1,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    cost_usd: usd,
    note: `src=harvest;model=${model}`,
  }
  const r = h.ledger.appendEvent(rec)
  expect(r.appended).toBe(true)
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-cost-close-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const TIERS: ModelTier[] = [
  { tier: 'high', provider: 'test', model: 'm-high', price: { inputPerM: 600, outputPerM: 2200 } },
]

describe('时刻闸与首冻', () => {
  it('19:54 不跑；19:55 首拍收 D-1（exact 折算+kv 前进+REPORT_COST_CLOSE+零告警）', () => {
    const h = harness('gate-and-first-close')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1.32, 3.96, 0.044)
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 2_000_000, 500_000)
      h.setNow(localTime(2026, 10, 22, 19, 54))
      let r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(false)
      expect(r.finalRows).toBe(0)
      expect(h.ledger.listCostDaily({ company: COMPANY })).toHaveLength(0)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(true)
      expect(r.closedDates).toEqual(['2026-10-21'])
      expect(r.finalRows).toBe(1)
      // final 行：机械复算 1×1.32+2×3.96+0.5×0.044=9.262；快照锚+工序锚串
      const rows = h.ledger.listCostDaily({ company: COMPANY, cost_date: '2026-10-21' })
      expect(rows).toHaveLength(1)
      const f = rows[0] as { cost_usd: number; kind: string; closed_by: string; price_snapshot_id: string; tokens_in: number }
      expect(f.kind).toBe('final')
      expect(f.cost_usd).toBeCloseTo(9.262, 10)
      expect(f.closed_by).toBe('cost-close:2026-10-21')
      expect(f.price_snapshot_id.startsWith('ps-')).toBe(true)
      expect(f.tokens_in).toBe(1_000_000)
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
      const ev = h.events.filter((e) => e.kind === 'REPORT_COST_CLOSE')
      expect(ev).toHaveLength(1)
      expect(ev[0]?.note).toContain('src=cost-close;date=2026-10-21')
      expect(ev[0]?.note).toContain('rows=1')
      expect(ev[0]?.note).toContain('usd=9.2620')
      expect(h.events.filter((e) => e.kind === 'DAILY_ALARM')).toHaveLength(0)
      expect(h.errors).toEqual([])
    } finally {
      h.ledger.close()
    }
  })

  it('零用量日照收（rows=0 事件+kv 前进）——给 20:00 岗诚实日锚', () => {
    const h = harness('zero-row-day')
    try {
      h.setNow(localTime(2026, 10, 22, 20, 5))
      const r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(true)
      expect(r.finalRows).toBe(0)
      expect(r.closedDates).toEqual(['2026-10-21'])
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
      expect(h.events.filter((e) => e.kind === 'REPORT_COST_CLOSE' && e.note.includes('rows=0'))).toHaveLength(1)
    } finally {
      h.ledger.close()
    }
  })

  it('kv 幂等：同晚重拍 ran=false 零新行零事件', () => {
    const h = harness('kv-idempotent')
    try {
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 100, 100)
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      h.setNow(localTime(2026, 10, 22, 19, 56))
      runCostCloseTick(h.deps())
      const r2 = runCostCloseTick(h.deps())
      expect(r2.ran).toBe(false)
      expect(r2.finalRows).toBe(0)
      expect(h.ledger.listCostDaily({ company: COMPANY })).toHaveLength(1)
      expect(h.events).toHaveLength(1)
    } finally {
      h.ledger.close()
    }
  })
})

describe('三路降级不静默（S6-adjacent：不静默不编造）', () => {
  it('stale 沿用+桥+无价 → DAILY_ALARM degraded 计数；无价 usd=0 收口', () => {
    const h = harness('degraded', TIERS)
    try {
      // stale：快照 10-18（沿用 3 日）；桥：m-high 无快照而在 models.yaml；无价：ghost/m-x
      seedPrice(h, 'test', 'm-stale', '2026-10-18', 1, 2)
      seedUsage(h, 'p1', 'test/m-stale', '2026-10-21', 1_000_000, 0)
      seedUsage(h, 'p2', 'test/m-high', '2026-10-21', 1_000_000, 0)
      seedUsage(h, 'p3', 'ghost/m-x', '2026-10-21', 100, 100)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      runCostCloseTick(h.deps())
      const alarms = h.events.filter((e) => e.kind === 'DAILY_ALARM')
      expect(alarms).toHaveLength(1)
      expect(alarms[0]?.note).toContain('degraded=stale:1,bridge:1,unpriced:1')
      const rows = h.ledger.listCostDaily({ company: COMPANY })
      const unpriced = rows.find((r) => r.model === 'ghost/m-x') as { cost_usd: number; price_snapshot_id: string }
      expect(unpriced.cost_usd).toBe(0)
      expect(unpriced.price_snapshot_id).toBe('unpriced')
      const bridged = rows.find((r) => r.model === 'test/m-high') as { price_snapshot_id: string }
      expect(bridged.price_snapshot_id).toBe('models-yaml:test/m-high')
    } finally {
      h.ledger.close()
    }
  })
})

describe('追平（崩溃落后多日一次收齐）', () => {
  it('kv=D-4 → 收 D-3..D-1（旧→新，三事件三 kv 步进终点 D-1）', () => {
    const h = harness('catch-up')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-18', 1, 1)
      for (const d of ['2026-10-19', '2026-10-20', '2026-10-21']) seedUsage(h, 'p1', 'test/m-high', d, 100_000, 0)
      h.ledger.kvSet(COST_CLOSE_KV_KEY, '2026-10-18')
      h.setNow(localTime(2026, 10, 22, 19, 55))
      const r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(true)
      expect(r.closedDates).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
      expect(r.finalRows).toBe(3)
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
      expect(h.events.filter((e) => e.kind === 'REPORT_COST_CLOSE')).toHaveLength(3)
    } finally {
      h.ledger.close()
    }
  })
})

describe('巡检（S3 迟到事实 → 次日收口拍补账）', () => {
  it('迟到并格：signed adjustment 挂 final 行 + Σ 真值一致 + cost-adjust 事件', () => {
    const h = harness('late-facts')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 1_000_000)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      runCostCloseTick(h.deps()) // 首收：usd = 1+1 = 2
      const finalId = (h.ledger.listCostDaily({ company: COMPANY, cost_date: '2026-10-21' })[0] as { id: string }).id
      // 迟到事实：重建回填追加 500k/500k（R1 零迟窗——迟到只来自重建/修复）
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 500_000, 500_000)
      h.setNow(localTime(2026, 10, 23, 19, 55))
      const r2 = runCostCloseTick(h.deps()) // 收 10-22（零用量）+ 巡检 10-21
      expect(r2.closedDates).toEqual(['2026-10-22'])
      expect(r2.adjustmentRows).toBe(1)
      const rows = h.ledger.listCostDaily({ company: COMPANY, cost_date: '2026-10-21' })
      expect(rows).toHaveLength(2)
      const adj = rows.find((x) => x.kind === 'adjustment') as { adjusts_id: string; cost_usd: number; tokens_in: number; closed_by: string; note: string | undefined }
      expect(adj.adjusts_id).toBe(finalId)
      expect(adj.cost_usd).toBeCloseTo(1.0, 10)
      expect(adj.tokens_in).toBe(500_000)
      expect(adj.closed_by).toBe('cost-adjust:2026-10-21')
      expect(adj.note).toContain('迟到事实')
      const sum = rows.reduce((s, x) => s + x.cost_usd, 0)
      expect(sum).toBeCloseTo(3.0, 10) // 应有真值 1.5M+1.5M
      expect(h.events.some((e) => e.kind === 'REPORT_COST_CLOSE' && e.note.includes('src=cost-adjust;date=2026-10-21') && e.note.includes('adjustments=1'))).toBe(true)
    } finally {
      h.ledger.close()
    }
  })

  it('重入收敛：半收日崩溃（kv 未前进）→ 下一拍已冻格跳过+缺口补齐，无重复行', () => {
    const h = harness('reentry-converge')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 1_000_000)
      seedUsage(h, 'p2', 'test/m-high', '2026-10-21', 2_000_000, 2_000_000)
      // 半收：直接落 p1 的 final（模拟收口中途崩——kv 未写）
      h.ledger.appendCostDaily({
        id: h.ids(0), company: COMPANY, person_id: 'p1', model: 'test/m-high', cost_date: '2026-10-21',
        tokens: { tokens_in: 1_000_000, tokens_out: 1_000_000, cache_read: 0, cache_creation: 0 },
        price_snapshot_id: 'ps-half', cost_usd: 2, kind: 'final',
        closed_at: localTime(2026, 10, 22, 19, 55), closed_by: 'cost-close:2026-10-21',
      })
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBeNull()
      h.setNow(localTime(2026, 10, 22, 20, 30))
      const r = runCostCloseTick(h.deps())
      expect(r.ran).toBe(true)
      expect(r.finalRows).toBe(1) // 只补 p2；p1 已冻跳过
      const rows = h.ledger.listCostDaily({ company: COMPANY, cost_date: '2026-10-21', kind: 'final' })
      expect(rows).toHaveLength(2)
      expect(h.ledger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
    } finally {
      h.ledger.close()
    }
  })
})

describe('对账段与报告面', () => {
  it('Σ 平（收割同账）→ recon.diverged=false；差 → 注因段 notes + perModel 段', () => {
    const h = harness('recon-and-report')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 1_000_000) // usd=2
      seedGatePass(h, localTime(2026, 10, 21, 15), 2.0, 'test/m-high')
      h.setNow(localTime(2026, 10, 22, 19, 55))
      runCostCloseTick(h.deps())
      // 平账：文件 recon 平
      const file1 = JSON.parse(readFileSync(path.join(h.companyDir, 'reports', '综合部', 'cost-close', 'cost-close-2026-10-21.json'), 'utf8')) as { recon: { diverged: boolean }; notes?: string[] }
      expect(file1.recon.diverged).toBe(false)
      expect(file1.notes).toBeUndefined()
      // 快照行（insertReport——自然键 (company,node,type,date)）
      const reports = h.ledger.listReports({ company: COMPANY, type: 'daily' })
      expect(reports).toHaveLength(1)
      expect(reports[0]?.caliber).toBe('cost-close/v1')
      expect(reports[0]?.date).toBe('2026-10-21')
      expect(reports[0]?.json_ref).toBe('reports/综合部/cost-close/cost-close-2026-10-21.json')
      // ---- 差账面：再造一日，收割侧少 1.0 → diverged + notes 注因
      seedUsage(h, 'p1', 'test/m-high', '2026-10-22', 1_000_000, 1_000_000)
      seedGatePass(h, localTime(2026, 10, 22, 15), 1.0, 'test/m-high')
      h.setNow(localTime(2026, 10, 23, 19, 55))
      runCostCloseTick(h.deps())
      const file2 = JSON.parse(readFileSync(path.join(h.companyDir, 'reports', '综合部', 'cost-close', 'cost-close-2026-10-22.json'), 'utf8')) as { recon: { diverged: boolean; deltaUsd: number; perModel: Array<{ model: string; deltaUsd: number }> }; notes?: string[] }
      expect(file2.recon.diverged).toBe(true)
      expect(file2.recon.deltaUsd).toBeCloseTo(1.0, 10)
      expect(file2.recon.perModel.find((m) => m.model === 'test/m-high')?.deltaUsd).toBeCloseTo(1.0, 10)
      expect(file2.notes?.some((n) => n.includes('对账差'))).toBe(true)
      // 两日报表快照行并存（同自然键互不覆盖——date 是键分量）
      expect(h.ledger.listReports({ company: COMPANY, type: 'daily' })).toHaveLength(2)
    } finally {
      h.ledger.close()
    }
  })

  it('companyDir 未注入=报告面未开：零文件行为，账与事件照落', () => {
    const h = harness('no-report-face')
    try {
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 0)
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      const r = runCostCloseTick(h.deps({ companyDir: undefined }))
      expect(r.ran).toBe(true)
      expect(existsSync(path.join(h.companyDir, 'reports'))).toBe(false)
      expect(h.ledger.listCostDaily({ company: COMPANY })).toHaveLength(1)
      expect(h.events.filter((e) => e.kind === 'REPORT_COST_CLOSE')).toHaveLength(1)
    } finally {
      h.ledger.close()
    }
  })
})

describe('失败面（不前进不静默）', () => {
  it('落账崩 → DAILY_ALARM+onError+kv 不动；修复后下一拍收敛补齐', () => {
    const h = harness('failure-retry')
    try {
      seedPrice(h, 'test', 'm-high', '2026-10-21', 1, 1)
      seedUsage(h, 'p1', 'test/m-high', '2026-10-21', 1_000_000, 1_000_000)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      // 注入崩点：appendCostDaily 首次调用抛（模拟磁盘满/锁）
      let broken = true
      const realLedger = h.ledger
      const wired: CostCloseDeps = h.deps({
        ledger: new Proxy(realLedger, {
          get(target, prop, receiver): unknown {
            if (prop === 'appendCostDaily' && broken) {
              return (): never => {
                throw new Error('注入崩溃：磁盘满')
              }
            }
            return Reflect.get(target, prop, receiver)
          },
        }),
      })
      const r1 = runCostCloseTick(wired)
      expect(r1.ran).toBe(true)
      expect(r1.finalRows).toBe(0)
      expect(r1.alarms).toBe(1)
      expect(h.errors.some((e) => e.includes('日终收口失败 2026-10-21'))).toBe(true)
      expect(h.events.filter((e) => e.kind === 'DAILY_ALARM' && e.note.includes('error='))).toHaveLength(1)
      expect(realLedger.kvGet(COST_CLOSE_KV_KEY)).toBeNull() // 不前进——下一拍重试
      broken = false
      const r2 = runCostCloseTick(wired)
      expect(r2.ran).toBe(true)
      expect(r2.finalRows).toBe(1)
      expect(realLedger.kvGet(COST_CLOSE_KV_KEY)).toBe('2026-10-21')
      expect(realLedger.listCostDaily({ company: COMPANY })).toHaveLength(1)
    } finally {
      h.ledger.close()
    }
  })
})

describe('costCloseDeps 缝装配（engine 一行缝的闭包面）', () => {
  it('emitReport/emitAlarm 经 makeEvent 落 sink（REPORT_COST_CLOSE/DAILY_ALARM）', () => {
    const h = harness('seam-wiring')
    try {
      const sink: EventRecord[] = []
      const sentinel: IssueRecord = {
        id: 'hb-sentinel', title: '心跳哨兵', type: 'task', level: 0, state: 'In Progress',
        created: '2026-10-22T00:00:00Z', updated: '2026-10-22T00:00:00Z', labels: [], lanes: [],
      } as unknown as IssueRecord
      const deps = costCloseDeps({
        ledger: h.ledger,
        config: { company: COMPANY, heartbeatIssue: 'hb-sentinel', deptFallback: 'departments/工程部' },
        now: h.now,
        makeId: h.ids,
        makeEvent: (name, issue, attempt, sinkArr, extra) => {
          const ts = h.now()
          const rec: EventRecord = {
            id: h.ids(ts), ts, company: COMPANY, issue: issue.id, event: name, actor: 'daemon',
            attempt, level: 0, dept: 'departments/工程部', tokens: { input: 0 }, ...(extra?.note !== undefined ? { note: extra.note } : {}),
          }
          sinkArr.push(rec)
          return rec
        },
        heartbeatSentinelRecord: () => sentinel,
        tickEvents: sink,
        errors: h.errors,
      })
      deps.emitReport('src=cost-close;date=2026-10-21;rows=1')
      deps.emitAlarm('src=cost-close;date=2026-10-21;degraded=stale:1')
      deps.onError('工序测试错误面')
      expect(sink.map((e) => e.event)).toEqual(['REPORT_COST_CLOSE', 'DAILY_ALARM'])
      expect(sink[0]?.note).toContain('src=cost-close;date=2026-10-21')
      expect(h.errors).toEqual(['工序测试错误面'])
    } finally {
      h.ledger.close()
    }
  })
})

describe('财务分析面入报告（制作人 2026-10-22 补充令）', () => {
  it('无价/桥/无基线异常等洞察入报告 insights 段（阈值=core 拟稿常量）', () => {
    const h = harness('insights-in-report', TIERS)
    try {
      // ghost/m-x 无声明（tier-mismatch 面）+ 无价收口
      seedUsage(h, 'p1', 'ghost/m-x', '2026-10-21', 100, 100)
      h.setNow(localTime(2026, 10, 22, 19, 55))
      runCostCloseTick(h.deps())
      const file = JSON.parse(readFileSync(path.join(h.companyDir, 'reports', '综合部', 'cost-close', 'cost-close-2026-10-21.json'), 'utf8')) as { insights: Array<{ kind: string; message: string }>; notes?: string[] }
      expect(file.insights.some((i) => i.kind === 'tier-mismatch' && i.message.includes('ghost/m-x'))).toBe(true)
      expect(file.notes?.some((n) => n.includes('定价降级'))).toBe(true)
    } finally {
      h.ledger.close()
    }
  })
})

/** 缺口回归锚：CostCloseTickReport 形状（account 段契约） */
describe('报告形状', () => {
  it('ran=false 拍报告形状完整（engine account 段消费面）', () => {
    const h = harness('shape')
    try {
      h.setNow(localTime(2026, 10, 22, 10, 0))
      const r: CostCloseTickReport = runCostCloseTick(h.deps())
      expect(r).toEqual({ date: '2026-10-22', ran: false, closedDates: [], finalRows: 0, adjustmentRows: 0, alarms: 0, reportEvents: 0, mutations: 0 })
    } finally {
      h.ledger.close()
    }
  })
})
