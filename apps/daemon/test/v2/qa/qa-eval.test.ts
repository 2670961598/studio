/**
 * #811 阶段2 qa-eval V2 套件（golden 载入/选取/评测，observe-only）
 *
 * 断言面：确定性分层选取（去重/CLOSE only/每单一条）；golden 载入 schema/版本/哈希；
 * golden 构建显式入口（已存在即拒不覆盖）；评测 JSON/MD 形状（baseline 版本+sha256+样本量、
 * current、drift、coverage、tickets）；drift 不阻断（无数据日 exit0）；同参同字节；只读不变；
 * 坏日期/坏 golden/无 golden exit≠0 且零输出。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { cmdQaEval, parseQaEvalArgs } from '../../../src/cli/qa/qa-eval.ts'
import { cmdQaReport } from '../../../src/cli/qa-report.ts'
import { loadGolden, selectGoldenTickets } from '../../../src/cli/qa/qa-golden.ts'
import { jsDivergence } from '../../../src/cli/qa/qa-eval-report.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-811-eval-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
const COMPANY = 'demo-eval'
const COHORT = 'departments/工程部'

let seq = 0
function idAt(day: number, hour: number): number {
  return new Date(2026, 10, day, hour, 0, 0, 0).valueOf()
}

interface Fixture {
  readonly dbPath: string
  readonly goldenDir: string
  readonly outDir: string
  readonly hash: string
  readonly mtimeMs: number
}

function appendEvent(ledger: ReturnType<typeof openLedger>, ticket: string, day: number, hour: number, event: string, note: string | null = null): void {
  seq += 1
  const ts = idAt(day, hour) + seq
  ledger.appendEvent({
    id: makeUlid(ts),
    ts,
    company: COMPANY,
    issue: ticket,
    event: event as never,
    actor: 'daemon',
    attempt: 1,
    level: 2,
    dept: COHORT,
    tokens: { input: 1 },
    ...(note !== null ? { note } : {}),
  })
}

function addTicket(
  ledger: ReturnType<typeof openLedger>,
  ticket: string,
  spec: {
    day: number
    dept?: string
    level?: number
    type?: string
    model?: string
    events: ReadonlyArray<readonly [number, string] | readonly [number, string, string | null]>
  },
): void {
  const dept = spec.dept ?? COHORT
  const level = spec.level ?? 2
  const type = spec.type ?? 'devtask'
  ledger.upsertTicketMirror({ issue: ticket, company: COMPANY, created: idAt(spec.day, 8), updated: idAt(spec.day, 8), state: '已交付', type, dept, level, dispatcher: 'AGENT-1' })
  for (const item of spec.events) appendEvent(ledger, ticket, spec.day, item[0], item[1], item[2] ?? null)
  const start = idAt(spec.day, 8)
  const end = idAt(spec.day, 10)
  ledger.insertWorkRecord({ id: `wr-${ticket}-${String(level)}`, issue: ticket, person_id: 'AGENT-1', executor: 'dsh-mid', started_at: start, ended_at: end, attempt: 1, status: 'done', ...(spec.model !== undefined ? { model: spec.model } : {}) })
}

function fixture(name: string): Fixture {
  const dbPath = path.join(ROOT, `${name}.sqlite`)
  const goldenDir = path.join(ROOT, `${name}-golden`)
  const outDir = path.join(ROOT, `${name}-out`)
  const ledger = openLedger(dbPath)
  try {
    addTicket(ledger, 'H1', { day: 8, events: [[9, 'DISPATCH'], [11, 'GATE_PASS'], [12, 'CLOSE']], model: 'mid-p/mid-m' })
    // H1 的迟到 MERGE 落在 eval 日窗口 → coverage 命中
    appendEvent(ledger, 'H1', 11, 10, 'MERGE', null)
    addTicket(ledger, 'H2', { day: 8, events: [[9, 'DISPATCH'], [10, 'GATE_FAIL', 'src=harvest;category=GATE_X'], [11, 'GATE_PASS'], [12, 'CLOSE']], model: 'high-p/high-m' })
    addTicket(ledger, 'H3', { day: 9, events: [[8, 'DISPATCH'], [9, 'GATE_PASS'], [10, 'QA_BACK'], [11, 'DISPATCH'], [12, 'GATE_PASS'], [13, 'CLOSE']] })
    addTicket(ledger, 'H4', { day: 9, dept: 'departments/研发部', level: 3, events: [[8, 'DISPATCH'], [9, 'STALL'], [10, 'GATE_PASS'], [11, 'CLOSE']], model: 'mid-p/mid-m' })
    addTicket(ledger, 'H5', { day: 10, level: 4, events: [[8, 'DISPATCH'], [9, 'GATE_PASS'], [11, 'CLOSE']], model: 'low-p/low-m' })
    addTicket(ledger, 'H6', { day: 10, dept: 'departments/综合部', events: [[9, 'DISPATCH'], [10, 'GATE_PASS'], [12, 'CLOSE']] })
    addTicket(ledger, 'T7', { day: 11, events: [[9, 'DISPATCH'], [10, 'GATE_PASS'], [11, 'CLOSE']], model: 'mid-p/mid-m' })
  } finally {
    ledger.close()
  }
  return { dbPath, goldenDir, outDir, hash: createHash('sha256').update(readFileSync(dbPath)).digest('hex'), mtimeMs: statSync(dbPath).mtimeMs }
}

describe('811 phase2：golden 选取纯面', () => {
  it('确定性/CLOSE only/去重/分层覆盖 target', () => {
    const rows = {
      events: [
        { ts: 1, issue: 'A', event: 'DISPATCH', note: null },
        { ts: 2, issue: 'A', event: 'GATE_PASS', note: null },
        { ts: 3, issue: 'A', event: 'CLOSE', note: null },
        { ts: 1, issue: 'B', event: 'DISPATCH', note: null },
        { ts: 2, issue: 'B', event: 'GATE_FAIL', note: 'category=C' },
        { ts: 3, issue: 'B', event: 'GATE_PASS', note: null },
        { ts: 4, issue: 'B', event: 'CLOSE', note: null },
        { ts: 1, issue: 'C', event: 'DISPATCH', note: null }, // 未 CLOSE → 非候选
      ],
      mirror: [
        { issue: 'A', dept: 'd1', level: 2, type: 'task', lane: null },
        { issue: 'B', dept: 'd2', level: 3, type: 'task', lane: null },
        { issue: 'C', dept: 'd1', level: 2, type: 'task', lane: null },
      ],
      work: [{ issue: 'A', model: 'm' as string | null }],
    }
    const options = { targetCount: 2, builtUntil: '2026-11-10', sourceCompany: COMPANY, generatedAt: '2026-11-11T00:00:00.000Z' }
    const one = selectGoldenTickets(rows, options)
    const two = selectGoldenTickets(rows, options)
    expect(one).toEqual(two)
    expect(one.tickets.map((t) => t.ticket).sort()).toEqual(['A', 'B'])
    expect(one.tickets.every((t) => t.outcome === 'clean' || t.outcome === 'retry')).toBe(true)
    expect(new Set(one.tickets.map((t) => t.ticket)).size).toBe(one.tickets.length)
    expect(one.stats.onePassRate).not.toBeNull()
  })
})

describe('811 phase2：golden 构建（显式、不覆盖）与校验', () => {
  it('构建写 golden+manifest；重复构建拒绝覆盖；loadGolden 校验 schema/hash', async () => {
    const fx = fixture('build')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(0)
    const goldenPath = path.join(fx.goldenDir, 'golden-v1.json')
    const manifestPath = path.join(fx.goldenDir, 'manifest.json')
    expect(existsSync(goldenPath)).toBe(true)
    expect(existsSync(manifestPath)).toBe(true)
    const loaded = loadGolden(fx.goldenDir, 'v1')
    expect(loaded.golden.tickets.length).toBe(loaded.manifest.count)
    expect(loaded.golden.schema).toBe('qa-golden/v1')
    expect(loaded.golden.selection.rule).toBe('hash-strata/v1')
    const before = readFileSync(goldenPath, 'utf8')
    // 已存在→ refuse（exit2 且旧文件不变）
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(2)
    expect(readFileSync(goldenPath, 'utf8')).toBe(before)
    // 哈希篡改→load 拒绝
    writeFileSync(goldenPath, `${before} `, 'utf8')
    expect(() => loadGolden(fx.goldenDir, 'v1')).toThrow(/哈希不符/)
  })
})

describe('811 phase2：qa-eval 评测', () => {
  it('golden 基线+当前窗口+drift+coverage；JSON/MD、幂等同字节、DB 只读不变', async () => {
    const fx = fixture('eval')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(0)
    const args = ['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-11', '--golden-dir', fx.goldenDir, '--out-dir', fx.outDir]
    expect(await cmdQaEval(args)).toBe(0)
    const jsonPath = path.join(fx.outDir, 'qa-eval-2026-11-11.json')
    const mdPath = path.join(fx.outDir, 'qa-eval-2026-11-11.md')
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)
    const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      schema: string
      observeOnly: boolean
      baseline: { goldenVersion: string; sha256: string; sampleCount: number; builtUntil: string }
      current: { closedTickets: number; onePassRate: number | null }
      drift: { failReasons: { jsd: number }; duration: Record<string, unknown>; tierShare: Record<string, unknown> }
      coverage: { goldenTickets: number; matchedInWindow: number; missing: string[] }
      tickets: Array<{ status: string }>
      verdict: string
    }
    expect(report.schema).toBe('qa-eval/v1')
    expect(report.observeOnly).toBe(true)
    expect(report.verdict).toBe('observe-only')
    expect(report.baseline.goldenVersion).toBe('v1')
    expect(report.baseline.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(report.baseline.sampleCount).toBe(7)
    expect(report.baseline.builtUntil).toBe('2026-11-11')
    expect(report.current.closedTickets).toBe(1)
    expect(report.coverage.goldenTickets).toBe(7)
    expect(report.coverage.matchedInWindow).toBeGreaterThanOrEqual(2) // H1(迟到 MERGE)+T7
    expect(typeof report.drift.failReasons.jsd).toBe('number')
    expect(report.tickets.some((t) => t.status === 'match')).toBe(true)
    const md = readFileSync(mdPath, 'utf8')
    expect(md.startsWith('# QA golden 评测')).toBe(true)
    expect(md).toContain('结论先行（observe-only，不阻断）')
    // 幂等 & 只读
    const firstJson = readFileSync(jsonPath, 'utf8')
    expect(await cmdQaEval(args)).toBe(0)
    expect(readFileSync(jsonPath, 'utf8')).toBe(firstJson)
    expect(createHash('sha256').update(readFileSync(fx.dbPath)).digest('hex')).toBe(fx.hash)
    expect(statSync(fx.dbPath).mtimeMs).toBe(fx.mtimeMs)
  })

  it('observe-only：无数据日 drift/coverage 空仍 exit0；坏 golden/坏日期/缺参 exit≠0 零输出', async () => {
    const fx = fixture('edge')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(0)
    const noDataOut = path.join(ROOT, 'edge-nodata')
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-12', '--golden-dir', fx.goldenDir, '--out-dir', noDataOut])).toBe(0)
    const report = JSON.parse(readFileSync(path.join(noDataOut, 'qa-eval-2026-11-12.json'), 'utf8')) as { current: { onePassRate: number | null }; coverage: { matchedInWindow: number } }
    expect(report.current.onePassRate).toBeNull()
    expect(report.coverage.matchedInWindow).toBe(0)
    // 坏日期 exit1；无 golden exit2；坏参数 exit1；均零输出
    const badOut = path.join(ROOT, 'edge-bad')
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-13-01', '--out-dir', badOut])).toBe(1)
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-11', '--golden-dir', path.join(ROOT, 'missing-golden'), '--out-dir', badOut])).toBe(2)
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--bogus', '1'])).toBe(1)
    expect(existsSync(badOut)).toBe(false)
    // 参数解析面：build 模式仍要求 db/company；缺省 goldenDir/outDir 派生
    const parsed = parseQaEvalArgs(['--build-golden', '/tmp/g', '--db', fx.dbPath, '--company', COMPANY, '--count', '80'])
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.args.buildGolden).toBe('/tmp/g')
      expect(parsed.args.count).toBe(80)
      expect(parsed.args.goldenDir).toBe(path.join(path.dirname(fx.dbPath), 'var', 'qa', 'golden'))
    }
  })
})


describe('811 phase2：drift 纯面边界', () => {
  it('jsDivergence：同分布=0、完全错位=1（base2）、空分布=0', () => {
    expect(jsDivergence({ a: 1, b: 3 }, { a: 1, b: 3 })).toBe(0)
    expect(jsDivergence({ a: 2 }, { b: 2 })).toBeCloseTo(1, 6)
    expect(jsDivergence({}, {})).toBe(0)
    expect(jsDivergence({ a: 1 }, { a: 1, b: 1 })).toBeGreaterThan(0)
  })
})


describe('811 phase2 F1 返工：golden 版本升序（v1→v2，不覆盖旧版）', () => {
  it('v1→v2 成功（旧 v1 保留、manifest 指向 v2、load 取 v2）；v0/同版本拒绝', async () => {
    const fx = fixture('versioned')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(0)
    const v1Path = path.join(fx.goldenDir, 'golden-v1.json')
    const v1Before = readFileSync(v1Path, 'utf8')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v2'])).toBe(0)
    const v2Path = path.join(fx.goldenDir, 'golden-v2.json')
    expect(existsSync(v2Path)).toBe(true)
    expect(readFileSync(v1Path, 'utf8')).toBe(v1Before) // 旧版保留可回滚
    const manifest = JSON.parse(readFileSync(path.join(fx.goldenDir, 'manifest.json'), 'utf8')) as { version: string; file: string; sha256: string }
    expect(manifest.version).toBe('v2')
    expect(manifest.file).toBe('golden-v2.json')
    expect(manifest.sha256).toBe(createHash('sha256').update(readFileSync(v2Path, 'utf8')).digest('hex'))
    const loaded = loadGolden(fx.goldenDir) // 缺省=manifest 最新版本
    expect(loaded.golden.version).toBe('v2')
    expect(loaded.path).toBe(v2Path)
    // v0/同版本拒绝（旧 manifest 不动）
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v0'])).toBe(2)
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v2'])).toBe(2)
    expect((JSON.parse(readFileSync(path.join(fx.goldenDir, 'manifest.json'), 'utf8')) as { version: string }).version).toBe('v2')
  })
})

describe('811 phase2 P3：--baseline qa-report.json 消费（不静默忽略）', () => {
  it('baseline 载入参与 drift（source=qa-report/reportDate/sha）；坏 schema/缺失 exit2 零输出', async () => {
    const fx = fixture('baseline')
    expect(await cmdQaEval(['--build-golden', fx.goldenDir, '--db', fx.dbPath, '--company', COMPANY, '--count', '7', '--until', '2026-11-11', '--version', 'v1'])).toBe(0)
    const baselineDir = path.join(ROOT, 'baseline-report')
    expect(await cmdQaReport(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-10', '--out-dir', baselineDir])).toBe(0)
    const baselinePath = path.join(baselineDir, 'qa-report-2026-11-10.json')
    const baselineSha = createHash('sha256').update(readFileSync(baselinePath)).digest('hex')
    const outDir = path.join(ROOT, 'baseline-out')
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-11', '--golden-dir', fx.goldenDir, '--out-dir', outDir, '--baseline', baselinePath])).toBe(0)
    const report = JSON.parse(readFileSync(path.join(outDir, 'qa-eval-2026-11-11.json'), 'utf8')) as {
      baseline: { source: string; reportDate?: string; sha256: string; builtUntil: string }
      drift: { onePassRate: { baseline: number | null }; failReasons: { jsd: number } }
    }
    expect(report.baseline.source).toBe('qa-report')
    expect(report.baseline.reportDate).toBe('2026-11-10')
    expect(report.baseline.sha256).toBe(baselineSha)
    expect(report.baseline.builtUntil).toBe('2026-11-10')
    expect(report.drift.onePassRate.baseline).toBeNull() // qa-report 无一次通过率，如实 null
    expect(typeof report.drift.failReasons.jsd).toBe('number')
    // 坏 baseline：schema 不符/文件缺失 → exit2 且零输出
    const badBaseline = path.join(ROOT, 'bad-baseline.json')
    writeFileSync(badBaseline, JSON.stringify({ schema: 'not-a-report' }), 'utf8')
    const badOut = path.join(ROOT, 'bad-baseline-out')
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-11', '--golden-dir', fx.goldenDir, '--out-dir', badOut, '--baseline', badBaseline])).toBe(2)
    expect(existsSync(badOut)).toBe(false)
    expect(await cmdQaEval(['--db', fx.dbPath, '--company', COMPANY, '--date', '2026-11-11', '--golden-dir', fx.goldenDir, '--out-dir', badOut, '--baseline', path.join(ROOT, 'missing-baseline.json')])).toBe(2)
    expect(existsSync(badOut)).toBe(false)
  })
})
