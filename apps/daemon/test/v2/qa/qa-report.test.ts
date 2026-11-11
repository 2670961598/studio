/**
 * #811 阶段 1 qa-report V2 套件（observe-only 只读指标报表）
 *
 * 断言面：参数/日期闸；纯统计（事件计数、失败 top-N、model/tier、耗时 median/p90）；
 * JSON/MD 形状与空数据；CLI 真库只读生成（DB 哈希/mtime 前后不变）、幂等同字节、坏库/坏日期
 * exit≠0 零输出；日志 tail 摘要（asOf/window='tail'，不参与日期对比；缺省 null）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { cmdQaReport, isRealDate, localDayWindow, parseQaArgs, readQaData } from '../../../src/cli/qa-report.ts'
import { buildQaReport } from '../../../src/cli/qa-report.ts'
import { computeQaMetrics, renderQaJson, renderQaMarkdown, summarizeLog } from '../../../src/cli/qa-report-stats.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-811-qa-report-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
const COMPANY = 'demo-qa'
const DATE = '2026-11-10'
const GATE = 'departments/工程部'
const MODELS_YAML = [
  'tiers:',
  '  high: {provider: high-p, model: high-m, price: {inputPerM: 1, outputPerM: 2}}',
  '  mid: {provider: mid-p, model: mid-m, price: {inputPerM: 1, outputPerM: 2}}',
  '  low: {provider: low-p, model: low-m, price: {inputPerM: 1, outputPerM: 2}}',
  'roles: {main_worker: mid}',
].join('\n')
const MODELS = path.join(ROOT, 'models.yaml')
writeFileSync(MODELS, MODELS_YAML, 'utf8')

/** 真库夹具（写侧 openLedger；CLI 侧只读打开） */
function fixtureDb(name: string): { dbPath: string; hash: string; mtimeMs: number } {
  const dbPath = path.join(ROOT, `${name}.sqlite`)
  const ledger = openLedger(dbPath)
  const base = localDayWindow(DATE).since + 3_600_000
  const ev = (i: number, issue: string, name: string, note: string | null): void => {
    ledger.appendEvent({
      id: makeUlid(base + i),
      ts: base + i,
      company: COMPANY,
      issue,
      event: name as never,
      actor: 'daemon',
      attempt: 1,
      level: 2,
      dept: GATE,
      tokens: { input: 1 },
      ...(note !== null ? { note } : {}),
    })
  }
  ev(1, 'ISSUE-1', 'GATE_PASS', 'src=harvest;model=mid-p/mid-m')
  ev(2, 'ISSUE-1', 'GATE_FAIL', 'src=harvest;category=GATE_X')
  ev(3, 'ISSUE-2', 'GATE_FAIL', 'src=harvest;category=GATE_X')
  ev(4, 'ISSUE-3', 'GATE_FAIL', 'boom')
  ev(5, 'ISSUE-2', 'STALL', null)
  ev(6, 'JOB-1', 'JOB_STALE', 'src=jobs')
  ev(7, 'ISSUE-1', 'ESCALATE', 'src=hr')
  ev(8, 'ISSUE-1', 'CLOSE', null)
  ev(9, 'ISSUE-1', 'DISPATCH', null)
  const mirror = (issue: string): void => {
    ledger.upsertTicketMirror({ issue, company: COMPANY, created: base, updated: base, state: '已交付', type: 'devtask', dept: GATE, level: 1, dispatcher: 'AGENT-1' })
  }
  for (const issue of ['ISSUE-1', 'ISSUE-2', 'ISSUE-3']) mirror(issue)
  ledger.insertWorkRecord({ id: 'wr-1', issue: 'ISSUE-1', person_id: 'AGENT-1', executor: 'dsh-mid', started_at: base, ended_at: base + 120_000, attempt: 1, status: 'done', model: 'mid-p/mid-m' })
  ledger.insertWorkRecord({ id: 'wr-2', issue: 'ISSUE-2', person_id: 'AGENT-2', executor: 'dsh-high', started_at: base + 1_000, ended_at: base + 61_000, attempt: 1, status: 'done', model: 'high-p/high-m' })
  ledger.insertWorkRecord({ id: 'wr-3', issue: 'ISSUE-3', person_id: 'AGENT-1', executor: 'dsh-mid', started_at: base + 2_000, attempt: 1, status: 'running' })
  ledger.upsertUsageDaily({ id: makeUlid(base + 100), company: COMPANY, person_id: 'AGENT-1', model: 'mid-p/mid-m', usage_date: DATE, tokens: { input: 100, output: 50, cache_read: 10, cache_creation: 2 }, first_ts: base, last_ts: base + 1000, updated_at: base + 1000 })
  ledger.upsertUsageDaily({ id: makeUlid(base + 101), company: COMPANY, person_id: 'AGENT-2', model: 'high-p/high-m', usage_date: DATE, tokens: { input: 200, output: 80, cache_read: 0, cache_creation: 0 }, first_ts: base, last_ts: base + 1000, updated_at: base + 1000 })
  ledger.close()
  return { dbPath, hash: createHash('sha256').update(readFileSync(dbPath)).digest('hex'), mtimeMs: statSync(dbPath).mtimeMs }
}

describe('811 qa-report：参数/日期闸', () => {
  it('缺参/未知旗标/坏日期/坏 top → 用法错；合法参数解析含本地日窗口', () => {
    expect(parseQaArgs([]).ok).toBe(false)
    expect(parseQaArgs(['--db', 'x.sqlite']).ok).toBe(false)
    expect(parseQaArgs(['--db', 'x.sqlite', '--company', 'c', '--bogus', '1'])).toEqual({ ok: false, message: expect.stringContaining('未知参数') })
    expect(parseQaArgs(['--db', 'x.sqlite', '--company', 'c', '--date', '2026-02-30']).ok).toBe(false)
    expect(parseQaArgs(['--db', 'x.sqlite', '--company', 'c', '--date', DATE, '--top', '0']).ok).toBe(false)
    const parsed = parseQaArgs([`--db=${path.join(ROOT, 'x.sqlite')}`, '--company', COMPANY, '--date', DATE, '--top', '5'])
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.args.date).toBe(DATE)
      expect(parsed.args.top).toBe(5)
      expect(parsed.args.outDir).toBe(path.join(ROOT, 'var', 'reports', 'qa'))
      expect(localDayWindow(DATE).until - localDayWindow(DATE).since).toBeGreaterThan(0)
    }
    expect(isRealDate('2026-11-10')).toBe(true)
    expect(isRealDate('2026-11-31')).toBe(false)
  })
})

describe('811 qa-report：纯统计', () => {
  it('事件计数/失败 top-N/model tier/耗时 median+p90/inFlight', () => {
    const data = readQaData(fixtureDb('stats').dbPath, COMPANY, DATE, localDayWindow(DATE).since, localDayWindow(DATE).until)
    const tiers = new Map<string, 'high' | 'mid' | 'low'>([['mid-p/mid-m', 'mid'], ['high-p/high-m', 'high']])
    const metrics = computeQaMetrics({ ...data, tierOf: (m) => tiers.get(m) ?? null, top: 10 })
    expect(metrics.counts).toMatchObject({ gatePass: 1, gateFail: 3, stall: 1, jobStale: 1, escalate: 1, close: 1, dispatch: 1 })
    expect(metrics.failures.total).toBe(3)
    expect(metrics.failures.top[0]).toEqual({ reason: 'GATE_X', count: 2 })
    expect(metrics.failures.top.some((f) => f.reason === 'boom')).toBe(true)
    expect(metrics.models.tierCounts).toMatchObject({ high: 1, mid: 1, low: 0 })
    expect(metrics.models.rows.find((r) => r.model === 'mid-p/mid-m')?.tier).toBe('mid')
    expect(metrics.durations).toMatchObject({ tickets: 3, attempts: 3, inFlight: 1, medianMs: 90_000, p90Ms: 120_000 })
  })
})

describe('811 qa-report：JSON/Markdown 形状与空数据', () => {
  it('空数据零形状可渲染；JSON 固定 schema/observeOnly；MD 含指标段落', () => {
    const report = buildQaReport(
      { db: 'x', company: COMPANY, date: DATE, outDir: ROOT, log: undefined, models: MODELS, top: 10 },
      { events: [], work: [], usage: [], ticketCount: 0 },
    )
    const parsed = JSON.parse(renderQaJson(report)) as Record<string, unknown>
    expect(parsed).toMatchObject({ schema: 'qa-report/v1', reportDate: DATE, company: COMPANY, observeOnly: true, log: null })
    expect((parsed['metrics'] as { counts: { gatePass: number } }).counts.gatePass).toBe(0)
    const md = renderQaMarkdown(report)
    expect(md).toContain('# QA 指标报表')
    expect(md).toContain('## 事件计数')
    expect(md).toContain('## 失败原因')
    expect(md).toContain('## 模型分布')
    expect(md).toContain('## 单耗时')
    expect(md).toContain('## 日志 tail 摘要')
  })
})

describe('811 qa-report：CLI 只读生成 + 幂等', () => {
  it('真库生成 JSON+MD；DB 哈希/mtime 不变；重跑同字节；--models 映射 tier', async () => {
    const fx = fixtureDb('cli')
    const outDir = path.join(ROOT, 'out-cli')
    expect(await cmdQaReport(['--db', fx.dbPath, '--company', COMPANY, '--date', DATE, '--out-dir', outDir, '--models', MODELS])).toBe(0)
    const jsonPath = path.join(outDir, `qa-report-${DATE}.json`)
    const mdPath = path.join(outDir, `qa-report-${DATE}.md`)
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)
    const firstJson = readFileSync(jsonPath, 'utf8')
    const firstMd = readFileSync(mdPath, 'utf8')
    const report = JSON.parse(firstJson) as { metrics: { counts: { gatePass: number }; models: { tierCounts: Record<string, number> } }; log: unknown }
    expect(report.metrics.counts.gatePass).toBe(1)
    expect(report.metrics.models.tierCounts).toMatchObject({ mid: 1, high: 1 })
    expect(report.log).toBeNull()
    // 只读不变：DB 字节哈希 + mtime 前后一致
    expect(createHash('sha256').update(readFileSync(fx.dbPath)).digest('hex')).toBe(fx.hash)
    expect(statSync(fx.dbPath).mtimeMs).toBe(fx.mtimeMs)
    // 幂等：同参数重跑同字节
    expect(await cmdQaReport(['--db', fx.dbPath, '--company', COMPANY, '--date', DATE, '--out-dir', outDir, '--models', MODELS])).toBe(0)
    expect(readFileSync(jsonPath, 'utf8')).toBe(firstJson)
    expect(readFileSync(mdPath, 'utf8')).toBe(firstMd)
  })

  it('坏库/坏日期 exit≠0 且零输出（不静默）；日志 tail 摘要 asOf/window', async () => {
    const outDir = path.join(ROOT, 'out-bad')
    expect(await cmdQaReport(['--db', path.join(ROOT, 'missing.sqlite'), '--company', COMPANY, '--date', DATE, '--out-dir', outDir])).toBe(2)
    expect(existsSync(outDir)).toBe(false) // 读库失败发生在 mkdir 前=零输出
    expect(await cmdQaReport(['--db', path.join(ROOT, 'x.sqlite'), '--company', COMPANY, '--date', '2026-13-01'])).toBe(1)
    const logFile = path.join(ROOT, 'daemon.log')
    writeFileSync(logFile, ['[loop-lag] lagMs=1500 seq=10', '[loop-lag] lagMs=9000 seq=11', '[serve] tick#11 noop聚合：code=NOOP_UNKNOWN_STATE state=Archived count=135 samples=a,b,c（x）', 'other line'].join('\n'), 'utf8')
    const summary = summarizeLog(logFile)
    expect(summary).toMatchObject({ window: 'tail', asOf: expect.any(String) })
    expect(summary.loopLag).toMatchObject({ count: 2, maxMs: 9000, medianMs: 5250, maxSeq: 11 })
    expect(summary.noop).toMatchObject({ aggregateLines: 1, decisions: 135 })
  })
})


describe('811 qa-report：落盘原子性（F1 返工；MD 失败→零输出且旧报告不破坏）', () => {
  it('MD final 为目录：exit2、JSON 不落盘、旧 JSON 原样保留、无 tmp/bak 残留', async () => {
    const fx = fixtureDb('atomic-old')
    const outDir = path.join(ROOT, 'out-atomic-old')
    mkdirSync(outDir, { recursive: true })
    const jsonPath = path.join(outDir, `qa-report-${DATE}.json`)
    const mdPath = path.join(outDir, `qa-report-${DATE}.md`)
    const oldJson = '{"old":true}\n'
    writeFileSync(jsonPath, oldJson, 'utf8')
    mkdirSync(mdPath, { recursive: true }) // 模拟 MD rename 失败（目标为目录）
    expect(await cmdQaReport(['--db', fx.dbPath, '--company', COMPANY, '--date', DATE, '--out-dir', outDir])).toBe(2)
    // 旧报告零破坏；新 JSON 未落盘（O_EXCL 语义：JSON 未 rename）
    expect(readFileSync(jsonPath, 'utf8')).toBe(oldJson)
    expect(statSync(mdPath).isDirectory()).toBe(true)
    expect(readdirSync(outDir).filter((f) => f.includes('.tmp-') || f.includes('.bak-'))).toEqual([])
  })

  it('无旧报告的 fresh 目录：MD final 为目录 → exit2，JSON 也不存在（零输出）', async () => {
    const fx = fixtureDb('atomic-fresh')
    const outDir = path.join(ROOT, 'out-atomic-fresh')
    mkdirSync(outDir, { recursive: true })
    const jsonPath = path.join(outDir, `qa-report-${DATE}.json`)
    const mdPath = path.join(outDir, `qa-report-${DATE}.md`)
    mkdirSync(mdPath, { recursive: true })
    expect(await cmdQaReport(['--db', fx.dbPath, '--company', COMPANY, '--date', DATE, '--out-dir', outDir])).toBe(2)
    expect(existsSync(jsonPath)).toBe(false)
    expect(statSync(mdPath).isDirectory()).toBe(true)
  })
})
