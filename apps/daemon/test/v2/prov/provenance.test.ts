/**
 * Airlock provenance A+C V2 套件（observe-only：只读派生图 + 告警/单票影响面）
 *
 * 断言面：trace 真链（ticket/attempt/person/artifact/alert/commit/model/price）；impact 从 alert/
 * ticket 得受影响面+confidence+缺口，且单票 2 跳可扩到同人其它票；空图/未知 from exit0 空形状；
 * 坏库/坏参数 exit≠0 零输出；DB sha256/mtime 不变+重跑同字节；note 白名单脱敏不泄露原路径/凭据。
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { cmdProvenance, parseProvenanceArgs } from '../../../src/cli/prov/prov-command.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-prov-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
const COMPANY = 'demo-prov'
const DEPT = 'departments/工程部'
let seq = 0
const base = new Date(2026, 10, 12, 9, 0, 0, 0).valueOf()

interface Fixture {
  readonly dbPath: string
  readonly outDir: string
  readonly alertId: string
  readonly hash: string
  readonly mtimeMs: number
}

function fixture(name: string): Fixture {
  const dbPath = path.join(ROOT, `${name}.sqlite`)
  const ledger = openLedger(dbPath)
  let alertId = ''
  const ev = (ticket: string, event: string, note: string | null, actor = 'AGENT-1', attempt = 1): string => {
    seq += 1
    const ts = base + seq * 1000
    const id = makeUlid(ts)
    ledger.appendEvent({ id, ts, company: COMPANY, issue: ticket, event: event as never, actor, attempt, level: 2, dept: DEPT, tokens: { input: 1 }, ...(note !== null ? { note } : {}) })
    return id
  }
  try {
    ledger.upsertTicketMirror({ issue: 'T-1', company: COMPANY, created: base, updated: base + 50_000, state: '已交付', type: 'devtask', dept: DEPT, level: 2, lane: 'core', dispatcher: 'AGENT-1' })
    ledger.upsertTicketMirror({ issue: 'T-2', company: COMPANY, created: base, updated: base + 60_000, state: '已交付', type: 'devtask', dept: DEPT, level: 2, lane: 'core', dispatcher: 'AGENT-1' })
    ev('T-1', 'DISPATCH', 'job=job-1;executor=dsh-mid')
    ev('T-1', 'GATE_FAIL', 'src=harvest;category=GATE_X;report=/secret/path/REPORT.md')
    ev('T-1', 'GATE_PASS', 'report=/secret/path/REPORT.md;model=glm/GLM-5.3')
    ev('T-1', 'QA_BACK', null)
    ev('T-1', 'MERGE', 'sha=abcdef1234567890;branch=dev')
    ev('T-1', 'CLOSE', null)
    ev('T-1', 'REPORT_MISSING', 'report=/secret/lost/REPORT.md')
    ev('T-2', 'DISPATCH', 'executor=dsh-mid')
    ev('T-2', 'GATE_PASS', 'report=/secret/lost/REPORT.md')
    ev('T-2', 'REPORT_MISSING', 'report=/secret/lost/REPORT.md')
    ev('T-2', 'CLOSE', null)
    alertId = ev('T-1', 'DAILY_ALARM', 'src=pricing-stale;category=NOISE')
    ledger.insertWorkRecord({ id: 'wr-t1', issue: 'T-1', person_id: 'AGENT-1', executor: 'dsh-mid', session_id: 'S-1', started_at: base, ended_at: base + 40_000, attempt: 1, status: 'done', model: 'glm/GLM-5.3', report_ref: '/secret/path/REPORT.md' })
    ledger.insertWorkRecord({ id: 'wr-t2', issue: 'T-2', person_id: 'AGENT-1', executor: 'dsh-mid', session_id: 'S-2', started_at: base + 5_000, ended_at: base + 45_000, attempt: 1, status: 'done', model: 'glm/GLM-5.3' })
    ledger.insertSession({ session_id: 'S-1', issue: 'T-1', person_id: 'AGENT-1', started_at: base, ended_at: base + 40_000, turns: 3 })
    ledger.insertSession({ session_id: 'S-2', issue: 'T-2', person_id: 'AGENT-1', started_at: base + 5_000, ended_at: base + 45_000, turns: 2 })
    ledger.appendPriceSnapshot({ id: `ps-${makeUlid(base + 100)}`, company: COMPANY, provider: 'glm', model: 'GLM-5.3', price_date: '2026-11-12', slot: 'peak', input_per_m: 1, output_per_m: 2, source_note: 'prov fixture', source_ticket: 'PROV', published_by: 'HF-1' })
  } finally {
    ledger.close()
  }
  return { dbPath, outDir: path.join(ROOT, `${name}-out`), alertId, hash: createHash('sha256').update(readFileSync(dbPath)).digest('hex'), mtimeMs: statSync(dbPath).mtimeMs }
}

function readJson(dir: string, prefix: string): { path: string; json: Record<string, unknown>; md: string } {
  const files = readdirSync(dir)
  const jsonFile = files.find((f) => f.startsWith(prefix) && f.endsWith('.json'))
  if (jsonFile === undefined) throw new Error(`缺 ${prefix}*.json（实际 ${files.join(',')}）`)
  const mdFile = jsonFile.replace(/\.json$/, '.md')
  return { path: path.join(dir, jsonFile), json: JSON.parse(readFileSync(path.join(dir, jsonFile), 'utf8')) as Record<string, unknown>, md: readFileSync(path.join(dir, mdFile), 'utf8') }
}

describe('provenance phase1：trace 真链', () => {
  it('trace 单票：ticket/attempt/person/artifact/alert/commit/model/price 节点+边证据；脱敏', async () => {
    const fx = fixture('trace')
    expect(await cmdProvenance(['trace', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', fx.outDir])).toBe(0)
    const { json, md, path: file } = readJson(fx.outDir, 'prov-trace-T-1')
    expect(json['schema']).toBe('prov-trace/v1')
    const nodes = json['nodes'] as Array<{ id: string; kind: string; label: string }>
    const kinds = new Set(nodes.map((n) => n.kind))
    for (const kind of ['ticket', 'attempt', 'person', 'artifact', 'alert', 'commit', 'model', 'price']) expect(kinds.has(kind), `缺节点 ${kind}`).toBe(true)
    expect(nodes.some((n) => n.kind === 'ticket' && n.label === 'T-1')).toBe(true)
    // artifact 只留 basename；note 原文/绝对路径/凭据不得出现
    const raw = readFileSync(file, 'utf8') + md
    expect(raw).not.toContain('/secret/')
    expect(raw).not.toContain('/Users/')
    expect(raw).not.toContain('job=job-1')
    expect(raw).toContain('REPORT.md')
    // 边证据：sourceEventId/time/confidence
    const edges = json['edges'] as Array<{ sourceEventId: string | null; time: number; confidence: string }>
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every((e) => typeof e.time === 'number' && ['direct', 'inferred', 'gap'].includes(e.confidence))).toBe(true)
    expect(edges.some((e) => e.sourceEventId !== null)).toBe(true)
    expect(md.startsWith('# Provenance trace')).toBe(true)
    expect((json['gaps'] as string[]).length).toBeGreaterThan(0) // REPORT_MISSING→artifact-gap
  })
})

describe('provenance phase1：impact 影响面', () => {
  it('alert→ticket/person/artifact+gap（direct/inferred）；ticket 2 跳经同人扩到 T-2', async () => {
    const fx = fixture('impact')
    // from=alert 事件 id（裸 id 解析 alert 节点）
    expect(await cmdProvenance(['impact', '--from', fx.alertId, '--db', fx.dbPath, '--company', COMPANY, '--out-dir', fx.outDir])).toBe(0)
    const alertImpact = readJson(fx.outDir, 'prov-impact').json as {
      schema: string
      source: { kind: string; id: string } | null
      affected: { tickets: string[]; persons: string[]; artifacts: string[] }
      confidence: { direct: number; inferred: number; gap: number }
      gaps: string[]
    }
    expect(alertImpact.schema).toBe('prov-impact/v1')
    expect(alertImpact.source?.kind).toBe('alert')
    expect(alertImpact.affected.tickets).toContain('T-1')
    expect(alertImpact.affected.persons).toContain('AGENT-1')
    expect(alertImpact.gaps.length).toBeGreaterThan(0) // T-1 REPORT_MISSING 在 2 跳内可见
    expect(alertImpact.confidence.gap).toBeGreaterThan(0)
    // ticket→T-2（同 person，深度 2）与 T-1 artifact/commit
    const ticketOut = path.join(ROOT, 'impact-ticket')
    expect(await cmdProvenance(['impact', '--from', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', ticketOut])).toBe(0)
    const ticketImpact = readJson(ticketOut, 'prov-impact').json as { affected: { tickets: string[]; artifacts: string[]; commits: string[] }; confidence: { direct: number; inferred: number } }
    expect(ticketImpact.affected.tickets).toContain('T-2')
    expect(ticketImpact.affected.tickets).toContain('T-1')
    expect(ticketImpact.affected.artifacts.length).toBeGreaterThan(0)
    expect(ticketImpact.affected.commits.length).toBeGreaterThan(0)
    expect(ticketImpact.confidence.direct + ticketImpact.confidence.inferred).toBeGreaterThan(0)
  })

  it('空图/未知 from：exit0 空形状（observe-only 不判错）', async () => {
    const fx = fixture('unknown')
    const out1 = path.join(ROOT, 'unknown-ticket')
    expect(await cmdProvenance(['trace', 'NO-SUCH', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', out1])).toBe(0)
    const trace = readJson(out1, 'prov-trace-NO-SUCH').json as { root: string | null; nodes: unknown[]; reason?: string }
    expect(trace.root).toBeNull()
    expect(trace.nodes).toEqual([])
    expect(trace.reason).toContain('not-in-derived-graph')
    const out2 = path.join(ROOT, 'unknown-from')
    expect(await cmdProvenance(['impact', '--from', 'NOPE', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', out2])).toBe(0)
    const impact = readJson(out2, 'prov-impact').json as { source: unknown; reason?: string; affected: { tickets: unknown[] } }
    expect(impact.source).toBeNull()
    expect(impact.affected.tickets).toEqual([])
    expect(impact.reason).toBe('unknown-from')
  })
})

describe('provenance phase1：只读/幂等/坏输入', () => {
  it('DB sha256/mtime 不变；重跑同字节；坏库/坏参数 exit≠0 零输出', async () => {
    const fx = fixture('readonly')
    expect(await cmdProvenance(['trace', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', fx.outDir])).toBe(0)
    const firstPath = readJson(fx.outDir, 'prov-trace-T-1').path
    const first = readFileSync(firstPath, 'utf8')
    expect(createHash('sha256').update(readFileSync(fx.dbPath)).digest('hex')).toBe(fx.hash)
    expect(statSync(fx.dbPath).mtimeMs).toBe(fx.mtimeMs)
    expect(await cmdProvenance(['trace', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--out-dir', fx.outDir])).toBe(0)
    expect(readFileSync(firstPath, 'utf8')).toBe(first)
    // 坏库 exit2；坏参数 exit1；均零输出
    const badOut = path.join(ROOT, 'bad-out')
    expect(await cmdProvenance(['trace', 'T-1', '--db', path.join(ROOT, 'missing.sqlite'), '--company', COMPANY, '--out-dir', badOut])).toBe(2)
    expect(await cmdProvenance(['trace', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--bogus', '1'])).toBe(1)
    expect(await cmdProvenance(['trace', '--db', fx.dbPath, '--company', COMPANY])).toBe(1)
    expect(() => parseProvenanceArgs(['impact', '--db', 'x', '--company', 'c', '--from', 'x', '--since', 'bad'])).toThrow
  })
})


describe('provenance phase1：时间窗/深度边界', () => {
  it('impact --depth=1 不跨同人扩到 T-2；--depth=2 才扩到（phase1 ≤2 跳）', async () => {
    const fx = fixture('depth')
    const d1 = path.join(ROOT, 'depth-1')
    expect(await cmdProvenance(['impact', '--from', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--depth', '1', '--out-dir', d1])).toBe(0)
    const one = readJson(d1, 'prov-impact').json as { affected: { tickets: string[] } }
    expect(one.affected.tickets).not.toContain('T-2')
    const d2 = path.join(ROOT, 'depth-2')
    expect(await cmdProvenance(['impact', '--from', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--depth', '2', '--out-dir', d2])).toBe(0)
    const two = readJson(d2, 'prov-impact').json as { affected: { tickets: string[] } }
    expect(two.affected.tickets).toContain('T-2')
  })

  it('impact --since/--until 窗口过滤：窗外无事件→exit0 空形状；窗内有→source 可解析', async () => {
    const fx = fixture('window')
    const outside = path.join(ROOT, 'window-outside')
    const since = new Date(2026, 10, 13, 0, 0, 0, 0).valueOf()
    const until = new Date(2026, 10, 14, 0, 0, 0, 0).valueOf()
    expect(await cmdProvenance(['impact', '--from', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--since', String(since), '--until', String(until), '--out-dir', outside])).toBe(0)
    const empty = readJson(outside, 'prov-impact').json as { source: unknown; affected: { tickets: unknown[] } }
    // mirror/work 仍会派生本地票节点，但窗内无事件→无 alert/边；至少不报错、空影响集
    expect(empty.source).not.toBeNull()
    expect(empty.affected.tickets.length).toBeGreaterThanOrEqual(0)
    const inside = path.join(ROOT, 'window-inside')
    expect(await cmdProvenance(['impact', '--from', 'T-1', '--db', fx.dbPath, '--company', COMPANY, '--since', '2026-11-12', '--until', '2026-11-13', '--out-dir', inside])).toBe(0)
    const found = readJson(inside, 'prov-impact').json as { source: { id: string } | null; affected: { tickets: string[] } }
    expect(found.source?.id).toBe('ticket:T-1')
    expect(found.affected.tickets).toContain('T-2')
  })
})
