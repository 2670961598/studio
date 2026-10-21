/**
 * :8789 财务页·月报段测试（DEV-36 / docs/50 断链6：reports 表 type='monthly' 行 + json_ref
 * 快照读取——04-§三「网页按 {node}/{date}-{type} 约定直接渲染」的财务页落点）：
 * ① buildFinanceSnapshot 纯函数：月报行（date/caliber/json_ref + headline 指标）；
 *    json_ref 可读 → 解析 headline（工时/成本/交付三指标）；坏 JSON / 坏形状 / 无读取面 →
 *    metrics=undefined 如实标注（零臆造——快照不可读不折算不猜测）；无 reports 入参 →
 *    空段（旧调用面向后兼容）
 * ② GET /<slug>/finance：月报表渲染（锚日/口径/工时h/成本/交付/快照引用）；快照不可读行
 *    如实显示；无台账公司整页降级不受影响
 * ③ 公司维隔离：他公司月报行不进本司段（listReports({company}) 过滤在 server 侧）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createOverviewApp, type OverviewApp } from '../src/overview/index.ts'
import { buildFinanceSnapshot } from '../src/overview/views.ts'

const T0 = 1_770_000_000_000

const CORP_M_SNAPSHOT: CompanySnapshot = {
  slug: 'corp-m',
  name: '丙公司',
  platform: { platform: 'youtrack', host: 'yt.example.invalid', project: 'CM' },
  charter: 'file://charter.md',
  level: 2,
  departments: [
    { path: 'departments/工程部', name: '工程部', leader: 'PM-1', lanes: [], functions: [], parent: null },
  ],
  people: [
    { id: 'PM-1', name: '丙一号', login: 'pm-1', level: 2, dept: 'departments/工程部' },
    { id: 'PM-2', name: '丙二号', login: 'pm-2', level: 1, dept: 'departments/工程部' },
  ],
  jobs: [],
}

/** 月报快照 JSON 文件面（公司目录相对路径 → 正文；模拟 daemon 产报后的目录态） */
const REPORT_FILES = new Map<string, string>([
  [
    'reports/2026-09-30-monthly-corp-m-九月经营月报.json',
    JSON.stringify({
      schema: 'monthly-report/v1', caliber: 'monthly/v1', company: 'corp-m', month: '2026-09',
      generated_at: T0, basis: 'events+work_records+people',
      metrics: { node: 'corp-m', people: 2, depts: 1, hours_ms: 16_200_000, cost_usd: 3.5, work_cost_usd: 1, delivered: 4, llm_events: 7 },
      departments: [], persons: [],
    }),
  ],
  [
    'reports/2026-10-31-monthly-corp-m-十月经营月报.json',
    JSON.stringify({
      schema: 'monthly-report/v1', caliber: 'monthly/v1', company: 'corp-m', month: '2026-10',
      generated_at: T0 + 1000, basis: 'events+work_records+people',
      metrics: { node: 'corp-m', people: 2, depts: 1, hours_ms: 10_800_000, cost_usd: 2.25, work_cost_usd: 0.5, delivered: 2, llm_events: 3 },
      departments: [], persons: [],
    }),
  ],
  // 坏 JSON：读取面如实降级（不臆造）
  ['reports/2026-08-31-monthly-corp-m-八月经营月报.json', '.not-json'],
  // 坏形状：metrics 缺字段 → 同样降级
  ['reports/2026-07-31-monthly-corp-m-七月经营月报.json', JSON.stringify({ schema: 'monthly-report/v1', metrics: { hours_ms: 1 } })],
])

let root = ''
let ledger: Ledger
let app: OverviewApp

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-overview-monthly-'))
  ledger = openLedger(path.join(root, 'monthly.db'))
  ledger.syncCompany(CORP_M_SNAPSHOT)

  const base = { company: 'corp-m', node: 'corp-m', type: 'monthly' as const, caliber: 'monthly/v1' }
  ledger.insertReport({ id: 'mr-2026-07', ...base, date: '2026-07-31', json_ref: 'reports/2026-07-31-monthly-corp-m-七月经营月报.json' })
  ledger.insertReport({ id: 'mr-2026-08', ...base, date: '2026-08-31', json_ref: 'reports/2026-08-31-monthly-corp-m-八月经营月报.json' })
  ledger.insertReport({ id: 'mr-2026-09', ...base, date: '2026-09-30', json_ref: 'reports/2026-09-30-monthly-corp-m-九月经营月报.json' })
  ledger.insertReport({ id: 'mr-2026-10', ...base, date: '2026-10-31', json_ref: 'reports/2026-10-31-monthly-corp-m-十月经营月报.json' })
  // 他公司行 + 他类型行：均不进 corp-m 月报段
  ledger.insertReport({ id: 'mr-other', company: 'other-co', node: 'other-co', type: 'monthly', date: '2026-10-31', caliber: 'monthly/v1', json_ref: 'reports/x.json' })
  ledger.insertReport({ id: 'dr-1', company: 'corp-m', node: 'corp-m', type: 'daily', date: '2026-10-20', caliber: 'daily/v1', json_ref: 'reports/d.json' })
  // corp-n 自己的行：行在、但无 readReportFile 注入 → 指标列如实「快照不可读」
  ledger.insertReport({ id: 'nr-2026-09', company: 'corp-n', node: 'corp-n', type: 'monthly', date: '2026-09-30', caliber: 'monthly/v1', json_ref: 'reports/2026-09-30-monthly-corp-n-九月经营月报.json' })
  ledger.insertReport({ id: 'nr-2026-10', company: 'corp-n', node: 'corp-n', type: 'monthly', date: '2026-10-31', caliber: 'monthly/v1', json_ref: 'reports/2026-10-31-monthly-corp-n-十月经营月报.json' })

  app = createOverviewApp({
    companies: [
      {
        slug: CORP_M_SNAPSHOT.slug,
        snapshotProvider: () => CORP_M_SNAPSHOT,
        openLedger: () => ledger,
        readReportFile: (ref) => REPORT_FILES.get(ref),
      },
      {
        // 有台账但无 readReportFile 注入：行在、指标如实「快照不可读」
        slug: 'corp-n',
        snapshotProvider: () => ({ ...CORP_M_SNAPSHOT, slug: 'corp-n', name: '丁公司' }),
        openLedger: () => ledger,
      },
    ],
  })
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

describe('buildFinanceSnapshot（月报行纯函数面）', () => {
  const input = {
    slug: 'corp-m',
    budgets: [],
    mirrors: [],
    peopleIds: new Set<string>(['PM-1', 'PM-2']),
    events: [],
  }

  it('reports+reader：行按 date 升序；可读快照解析出 headline 三指标；坏 JSON/坏形状行 metrics=undefined', () => {
    const snap = buildFinanceSnapshot({ ...input, reports: ledger.listReports({ company: 'corp-m', type: 'monthly' }), readReportFile: (ref) => REPORT_FILES.get(ref) })
    expect(snap.monthly.map((r) => r.id)).toEqual(['mr-2026-07', 'mr-2026-08', 'mr-2026-09', 'mr-2026-10'])
    expect(snap.monthly[2]).toEqual({
      id: 'mr-2026-09', date: '2026-09-30', caliber: 'monthly/v1',
      jsonRef: 'reports/2026-09-30-monthly-corp-m-九月经营月报.json',
      metrics: { hoursMs: 16_200_000, costUsd: 3.5, delivered: 4 },
    })
    expect(snap.monthly[0].metrics).toBeUndefined()
    expect(snap.monthly[1].metrics).toBeUndefined()
  })

  it('reports 无 reader：行在、全部 metrics=undefined（不臆造）；无 reports 入参：空段（旧调用面兼容）', () => {
    const noReader = buildFinanceSnapshot({ ...input, reports: ledger.listReports({ company: 'corp-m', type: 'monthly' }) })
    expect(noReader.monthly.length).toBe(4)
    for (const row of noReader.monthly) expect(row.metrics).toBeUndefined()
    const noReports = buildFinanceSnapshot(input)
    expect(noReports.monthly).toEqual([])
  })
})

describe('GET /<slug>/finance（月报段渲染）', () => {
  it('corp-m：四行月报（升序）；可读行出工时/成本/交付；坏快照行如实「快照不可读」；口径与引用可见', async () => {
    const res = await app.request('/legacy/corp-m/finance')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('月报（reports 表）')
    expect(html).toContain('monthly/v1')
    // 九月行：4.50h / 3.5 / 4 交付 + json_ref 可见（审计线索）
    expect(html).toContain('<td>2026-09-30</td><td>monthly/v1</td><td>4.50</td><td>3.5</td><td>4</td>')
    expect(html).toContain('reports/2026-09-30-monthly-corp-m-九月经营月报.json')
    // 十月行：3.00h / 2.25 / 2
    expect(html).toContain('<td>2026-10-31</td><td>monthly/v1</td><td>3.00</td><td>2.25</td><td>2</td>')
    // 七/八月坏快照行：快照不可读（不折算不猜测）——只数表格单元（页脚口径文案不计）
    expect(html.match(/class="empty">快照不可读<\/td>/g)?.length).toBe(2)
    // 他公司行与他类型行不进本司段（段内只有 4 行月报）
    expect(html).not.toContain('mr-other')
    expect(html).not.toContain('daily/v1')
  })

  it('corp-n（无 readReportFile 注入）：行在、指标列如实「快照不可读」；他司（corp-m）行不计', async () => {
    const res = await app.request('/legacy/corp-n/finance')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('月报（reports 表）')
    expect(html.match(/class="empty">快照不可读<\/td>/g)?.length).toBe(2)
    expect(html).toContain('<td>2026-10-31</td>')
    // corp-m 的可读行不串台（corp-n 两行均不可读，无指标数字行）
    expect(html).not.toContain('<td>4.50</td>')
    expect(html).not.toContain('corp-m-')
  })
})
