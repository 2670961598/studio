/**
 * v0.2 首刀·台账句柄测试：建库/迁移幂等/PRAGMA、appendEvent 契约闸与幂等规则、
 * queryEvents 查询面、work_records / sessions 读写面。
 *
 * 环境：os.tmpdir() 真文件库（不用 :memory:——16-§四 v0.2 验收面向删库重建演习，真文件语义才作数）。
 * 依据：docs/16-§四 v0.2、docs/17-§3、docs/02 F2-01/F2-04、contract EventRecordSchema。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

/** 事件工厂：ts 唯一递增（base + 序号），保证 ULID 与排序确定 */
let seq = 0
function makeEvent(patch: Partial<EventRecord> = {}): EventRecord {
  seq += 1
  const ts = 1760000000000 + seq * 1000
  return {
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: 'STUDIO-200',
    event: 'DISPATCH',
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 120, output: 60 },
    ...patch,
  }
}

/** 断言抛出的是 ClassifiedError 形状且 category=CONFIG_INVALID、subcause 匹配；可附带 message 子串 */
function expectConfigInvalid(fn: () => unknown, subcausePrefix: string, messageContains?: string): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const err = caught as Error & { category?: string; subcause?: string }
  expect(err.category).toBe('CONFIG_INVALID')
  expect(err.subcause).toMatch(new RegExp(`^${subcausePrefix.replaceAll('/', '\\/')}`))
  if (messageContains !== undefined) expect(err.message).toContain(messageContains)
}

describe('建库与迁移（schema_version 薄 runner）', () => {
  it('建库即迁移：首刀三表 + v2 五表 + v3 jobs + v4 daemon_kv + v5 candidates + v6 报表三表 + 索引 + schema_version 落六行，version=6', () => {
    expect(ledger.version()).toBe(6)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: unknown
      }>
    ).map((r) => String(r.name))
    expect(tables).toContain('events')
    expect(tables).toContain('work_records')
    expect(tables).toContain('sessions')
    expect(tables).toContain('schema_version')
    const indexes = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all() as Array<{
        name: unknown
      }>
    ).map((r) => String(r.name))
    expect(indexes).toEqual([
      'idx_budgets_scope',
      'idx_candidates_asset_path_diff_hash',
      'idx_candidates_parent_id',
      'idx_candidates_status',
      'idx_events_company_ts',
      'idx_events_issue',
      'idx_jobs_company',
      'idx_jobs_next_run_at',
      'idx_probes_runs_executor',
      'idx_probes_runs_probe_ts',
      'idx_reports_company',
      'idx_reports_natural',
      'idx_work_records_issue',
    ])
    const rows = ledger.db.prepare('SELECT version, sha8 FROM schema_version').all() as Array<{ version: unknown; sha8: unknown }>
    expect(rows.length).toBe(6)
    for (const row of rows) expect(String(row.sha8)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('PRAGMA 对齐：WAL / foreign_keys=ON', () => {
    const journal = ledger.db.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown }
    expect(String(journal.journal_mode).toLowerCase()).toBe('wal')
    const fk = ledger.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: unknown }
    expect(Number(fk.foreign_keys)).toBe(1)
  })

  it('重开库 migrate 幂等：版本不变、schema_version 不重复落行', () => {
    const again = openLedger(path.join(root, 'ledger.db'))
    expect(again.version()).toBe(6)
    const rows = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(rows.c)).toBe(6)
    again.close()
  })
})

describe('appendEvent 契约闸（非法事件拒入账）', () => {
  it('合法事件入账，前缀族（GW_* / REPORT_*）与四桶变体全收', () => {
    const cases: EventRecord[] = [
      makeEvent(),
      makeEvent({ event: 'GW_KB_SEARCH', tokens: { input: 0 } }),
      makeEvent({ event: 'REPORT_DAILY', tokens: { cache_read: 512 } }),
      makeEvent({ event: 'HEARTBEAT', tokens: { cache_creation: 0 } }),
      makeEvent({ event: 'CLOSE', tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } }),
    ]
    for (const c of cases) expect(ledger.appendEvent(c).appended).toBe(true)
    expect(ledger.queryEvents().length).toBeGreaterThanOrEqual(cases.length)
  })

  it('非法事件：抛 ClassifiedError(CONFIG_INVALID) 且库内零新增', () => {
    const before = ledger.queryEvents().length
    expectConfigInvalid(() => ledger.appendEvent({ no: 'not an event' }), 'evt/invalid:')
    expectConfigInvalid(
      () => ledger.appendEvent(makeEvent({ id: 'not-a-ulid' })),
      'evt/invalid:id',
    )
    expectConfigInvalid(
      () => ledger.appendEvent(makeEvent({ event: 'dispatch' })), // 小写=未知类型（F2-02）
      'evt/invalid:event',
    )
    expectConfigInvalid(
      () => ledger.appendEvent(makeEvent({ tokens: {} })), // 空桶=无计量拒收（F2-04；refine 落 root 路径）
      'evt/invalid:',
    )
    expectConfigInvalid(
      () => ledger.appendEvent({ ...makeEvent(), extra: 1 }), // strict 未知列拒收（zod v4 落 root 路径，message 带键名）
      'evt/invalid:',
      'extra',
    )
    expectConfigInvalid(
      () => ledger.appendEvent(makeEvent({ level: 10 })), // 04-§四 1..9 界外
      'evt/invalid:level',
    )
    expect(ledger.queryEvents().length).toBe(before)
  })

  it('幂等规则：同 id 全列一致 → appended:false 不重复；同 id 内容冲突 → CONFIG_INVALID', () => {
    const evt = makeEvent({ event: 'LLM', correlation_id: 'corr-1', cost_usd: 0.0125, note: 'n' })
    expect(ledger.appendEvent(evt).appended).toBe(true)
    // 同内容重放（对象重新构造，字段序不同也要一致）
    const replay: EventRecord = { ...evt, tokens: { ...evt.tokens } }
    expect(ledger.appendEvent(replay)).toEqual({ id: evt.id, appended: false })
    // 桶键序不同但内容一致的 tokens 仍视为同事件（canonical 序列化按固定桶序比对）
    expect(ledger.appendEvent({ ...evt, tokens: { output: evt.tokens.output, input: evt.tokens.input } }).appended).toBe(false)
    // 内容冲突
    expectConfigInvalid(() => ledger.appendEvent({ ...evt, note: 'different' }), 'store/evt:duplicate-id')
  })
})

describe('queryEvents 查询面（恒升序 + 过滤）', () => {
  it('company / issue / since / until / limit 组合过滤，ts 升序', () => {
    const t0 = 1770000000000
    const events: EventRecord[] = [
      makeEvent({ company: 'alpha', issue: 'A-1', ts: t0 + 100, event: 'DISPATCH' }),
      makeEvent({ company: 'alpha', issue: 'A-1', ts: t0 + 200, event: 'GATE_PASS' }),
      makeEvent({ company: 'alpha', issue: 'A-2', ts: t0 + 300, event: 'CLOSE' }),
      makeEvent({ company: 'beta', issue: 'B-1', ts: t0 + 400, event: 'LLM' }),
    ]
    for (const e of events) ledger.appendEvent(e)

    const alpha = ledger.queryEvents({ company: 'alpha', since: t0, until: t0 + 250 })
    expect(alpha.map((e) => e.event)).toEqual(['DISPATCH', 'GATE_PASS'])
    const limited = ledger.queryEvents({ company: 'alpha', limit: 1 })
    expect(limited.length).toBe(1)
    expect(limited[0]?.event).toBe('DISPATCH')
    const byIssue = ledger.queryEvents({ issue: 'B-1' })
    expect(byIssue.map((e) => e.company)).toEqual(['beta'])
    // 升序保证：全量 ts 非降
    const all = ledger.queryEvents()
    const tss = all.map((e) => e.ts)
    expect([...tss].sort((a, b) => a - b)).toEqual(tss)
  })
})

describe('work_records / sessions 读写面', () => {
  it('insert → get/list 全字段往返（可选字段含空/满两端）', () => {
    const id = ledger.insertWorkRecord({
      id: 'wr-1',
      issue: 'STUDIO-200',
      person_id: 'AGENT-1',
      executor: 'dsh',
      started_at: 1760000100000,
      ended_at: 1760000200000,
      cost_usd: 0.5,
      tokens: { input: 100, output: 50, cached: 10 },
      attempt: 2,
      status: 'done',
      report_ref: 'reports/STUDIO-200/REPORT.md',
      summary_ref: 'reports/STUDIO-200/summary.json',
      lane: 'core',
      branch: 'feature/x',
      session_id: 'sess-1',
      instance_id: 'inst-1',
    })
    expect(id).toBe('wr-1')
    const got = ledger.getWorkRecord('wr-1')
    expect(got).toEqual({
      id: 'wr-1',
      issue: 'STUDIO-200',
      person_id: 'AGENT-1',
      instance_id: 'inst-1',
      executor: 'dsh',
      session_id: 'sess-1',
      lane: 'core',
      branch: 'feature/x',
      started_at: 1760000100000,
      ended_at: 1760000200000,
      cost_usd: 0.5,
      tokens: { input: 100, output: 50, cached: 10 },
      attempt: 2,
      status: 'done',
      report_ref: 'reports/STUDIO-200/REPORT.md',
      summary_ref: 'reports/STUDIO-200/summary.json',
    })

    ledger.insertWorkRecord({ id: 'wr-2', issue: 'STUDIO-201', person_id: 'AGENT-2', executor: 'claude', started_at: 1760000300000, attempt: 1, status: 'running' })
    expect(ledger.listWorkRecords({ issue: 'STUDIO-201' }).map((r) => r.id)).toEqual(['wr-2'])
    expect(ledger.listWorkRecords().map((r) => r.id)).toContain('wr-1')
    expect(ledger.getWorkRecord('wr-404')).toBeUndefined()

    ledger.insertSession({ session_id: 'sess-1', issue: 'STUDIO-200', person_id: 'AGENT-1', archive_path: 'archive/sess-1.jsonl', started_at: 1760000100000, ended_at: 1760000200000, turns: 12 })
    ledger.insertSession({ session_id: 'sess-2', issue: 'STUDIO-200', person_id: 'AGENT-1', started_at: 1760000300000 })
    expect(ledger.getSession('sess-1')).toEqual({
      session_id: 'sess-1',
      issue: 'STUDIO-200',
      person_id: 'AGENT-1',
      archive_path: 'archive/sess-1.jsonl',
      started_at: 1760000100000,
      ended_at: 1760000200000,
      turns: 12,
    })
    expect(ledger.getSession('sess-2')?.ended_at).toBeUndefined()
    expect(ledger.listSessions({ issue: 'STUDIO-200' }).map((s) => s.session_id).sort()).toEqual(['sess-1', 'sess-2'])
    expect(ledger.getSession('sess-404')).toBeUndefined()
  })

  it('坏记录拒入：缺必填 / 未知列 / attempt 越界 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => ledger.insertWorkRecord({ id: 'wr-bad' }), 'store/work-record:invalid:')
    expectConfigInvalid(
      () => ledger.insertWorkRecord({ id: 'wr-bad', issue: 'X-1', person_id: 'P', executor: 'dsh', started_at: 1, attempt: 0, status: 'done' }),
      'store/work-record:invalid:attempt',
    )
    expectConfigInvalid(
      () => ledger.insertSession({ session_id: 's', issue: 'X-1', person_id: 'P', started_at: 1, bogus: true }),
      'store/session:invalid:',
      'bogus',
    )
  })
})

describe('杂项', () => {
  it('close 后文件落盘（真文件库语义）', () => {
    const p = path.join(root, 'misc.db')
    const l = openLedger(p)
    l.appendEvent(makeEvent({ event: 'PATROL' }))
    l.close()
    expect(existsSync(p)).toBe(true)
  })
})
