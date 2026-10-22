/**
 * v0.11 报表三表·v6 测试（store：ledgers / reports / probes_runs——docs/50 断链6 收口）：
 * 迁移（建库即 v6 / 三表两索引在库 / v5→v6 升级路径 / 重开幂等）、ledgers 单据派生面
 * （upsert 覆盖写往返 / 同键换代 / 双键查询 / kind 值域闸 / body 不可序列化拒 / 形状闸）、
 * reports 报表快照面（自然键 (company,node,type,date) 唯一 / 同 id 全列一致幂等跳过 /
 * 同 id 内容不一致拒 / 同自然键新 id 覆盖换代 / id 撞他行拒 / list 过滤与排序 / type 值域闸）、
 * probes_runs 探针跑分面（append 幂等与 id 冲突拒 / 触发器拦 UPDATE+DELETE（append-only
 * 机制保证）/ list 过滤排序 / cost/duration 拟稿列名口径）。
 *
 * 环境：os.tmpdir() 真文件库（沿 v4-debts / v5-candidates 风格，不用 :memory:）。功能面
 * 各套独立库（语料隔离）。
 * 依据：docs/17-§3（三表列集——ledgers「issue, kind(task/progress), body(json), updated」/
 * reports「id, company, node, type, date, 口径版本, json_ref」/ probes_runs「executor, model,
 * probe_id, pass, cost, duration, ts」）、docs/04-§三（报表 type 值域 daily/weekly/monthly、
 * 报表快照落库+文件约定）、docs/50-断链6（三表缺位即报表聚合首刀的结构断链）。
 * 形状取舍（17-§3 未尽的库侧细节，拟稿待批）：列名 cost→cost_usd / duration→duration_ms
 * （对齐库内 events/work_records 货币与时延列名口径）；probes_runs 加 id 主键（append-only
 * 幂等回填需要唯一键——events 同款非空串，不锁 ULID）；reports 自然键唯一索引
 * (company,node,type,date)——04-§三「网页按 {node}/{date}-{type} 约定直接渲染」的机制化。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, openLedger, openSqlite, type Ledger } from '../src/index.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v6-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 断言抛出 ClassifiedError 形状且 category=CONFIG_INVALID、subcause 匹配；可附带 message 子串 */
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

const T0 = 1_770_000_000_000

describe('v6 迁移（ledgers / reports / probes_runs 三表）', () => {
  let ledger: Ledger

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'ledger.db'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('建库即到 v7：三表在库、schema_version 恰七行；重开库 migrate 幂等（version 不涨、v6/v7 不重放）', () => {
    expect(ledger.version()).toBe(9)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(tables).toContain('ledgers')
    expect(tables).toContain('reports')
    expect(tables).toContain('probes_runs')
    const rows = ledger.db.prepare('SELECT version, sha8 FROM schema_version ORDER BY version').all() as Array<{ version: unknown; sha8: unknown }>
    expect(rows.length).toBe(9)
    for (const row of rows) expect(String(row.sha8)).toMatch(/^[0-9a-f]{8}$/)

    const again = openLedger(path.join(root, 'ledger.db'))
    expect(again.version()).toBe(9)
    const count = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(count.c)).toBe(9)
    again.close()
  })

  it('reports 唯一索引与列形态在库（自然键 (company,node,type,date)；口径版本列名 caliber）', () => {
    const idx = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_reports%' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(idx).toEqual(['idx_reports_company', 'idx_reports_natural'])
    const sql = String(
      (ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'").get() as { sql?: unknown }).sql,
    )
    expect(sql).toContain('id TEXT PRIMARY KEY')
    expect(sql).toContain('company TEXT NOT NULL')
    expect(sql).toContain('node TEXT NOT NULL')
    expect(sql).toContain('type TEXT NOT NULL')
    expect(sql).toContain('date TEXT NOT NULL')
    expect(sql).toContain('caliber TEXT NOT NULL')
    expect(sql).toContain('json_ref TEXT NOT NULL')
    const probesSql = String(
      (ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='probes_runs'").get() as { sql?: unknown }).sql,
    )
    expect(probesSql).toContain('executor TEXT NOT NULL')
    expect(probesSql).toContain('model TEXT NOT NULL')
    expect(probesSql).toContain('probe_id TEXT NOT NULL')
    expect(probesSql).toContain('pass INTEGER NOT NULL')
    expect(probesSql).toContain('cost_usd REAL')
    expect(probesSql).toContain('duration_ms INTEGER')
    expect(probesSql).toContain('ts INTEGER NOT NULL')
    const ledgersSql = String(
      (ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledgers'").get() as { sql?: unknown }).sql,
    )
    expect(ledgersSql).toContain('PRIMARY KEY (issue, kind)')
    expect(ledgersSql).toContain('body TEXT NOT NULL')
    expect(ledgersSql).toContain('updated INTEGER NOT NULL')
  })

  it('v5→v6 升级路径：v5 存量库裸数据无损、三表补齐可用（v5 时代无此三表）', () => {
    // ① 构造 v5 库（migrate upTo=5）+ 裸数据；v5 时代无三表
    const p = path.join(root, 'upgrade-v5.db')
    const v5db = openSqlite(p)
    migrate(v5db, { upTo: 5 })
    for (const t of ['ledgers', 'reports', 'probes_runs']) {
      const no = v5db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name = ?").get(t) as { c?: unknown }
      expect(Number(no.c)).toBe(0)
    }
    v5db
      .prepare('INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', T0, 'demo', 'STUDIO-9', 'DISPATCH', 'AGENT-9:agent-9', 1, 3, 'departments/工程部', '{"input":100,"output":50}')
    v5db.close()

    // ② 重开（openLedger 全量迁移）→ v6：存量无损、三表面可用
    const upgraded = openLedger(p)
    expect(upgraded.version()).toBe(9)
    expect(upgraded.queryEvents().map((e) => e.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV'])
    expect(upgraded.getLedgerEntry('STUDIO-9', 'task')).toBeUndefined()
    expect(upgraded.listReports()).toEqual([])
    expect(upgraded.listProbeRuns()).toEqual([])
    upgraded.close()
  })
})

describe('ledgers 单据派生面——独立库', () => {
  let lg: Ledger

  beforeAll(() => {
    lg = openLedger(path.join(root, 'ledgers.db'))
  })

  afterAll(() => {
    lg.close()
  })

  it('upsert 往返全字段（body JSON 列读写往返：对象/数组/标量）；getLedgerEntry 双键取回', () => {
    lg.upsertLedgerEntry({ issue: 'DEV-1', kind: 'task', body: { state: '开发中', est: 2 }, updated: T0 })
    expect(lg.getLedgerEntry('DEV-1', 'task')).toEqual({ issue: 'DEV-1', kind: 'task', body: { state: '开发中', est: 2 }, updated: T0 })
    // 同 issue 不同 kind = 两行（task / progress 双键）
    lg.upsertLedgerEntry({ issue: 'DEV-1', kind: 'progress', body: ['phase-1', 'phase-2'], updated: T0 + 10 })
    expect(lg.getLedgerEntry('DEV-1', 'progress')?.body).toEqual(['phase-1', 'phase-2'])
    // 标量 body 也往返（json 列不猜形状——单据派生，形状归上游）
    lg.upsertLedgerEntry({ issue: 'DEV-2', kind: 'progress', body: 3, updated: T0 + 20 })
    expect(lg.getLedgerEntry('DEV-2', 'progress')?.body).toBe(3)
  })

  it('同键再写=覆盖换代（单据派生镜像语义：last-write-wins，可重建投影）；listLedgerEntries 升序', () => {
    lg.upsertLedgerEntry({ issue: 'DEV-1', kind: 'task', body: { state: '已完成' }, updated: T0 + 100 })
    expect(lg.getLedgerEntry('DEV-1', 'task')).toEqual({ issue: 'DEV-1', kind: 'task', body: { state: '已完成' }, updated: T0 + 100 })
    expect(
      lg.db.prepare('SELECT COUNT(*) AS c FROM ledgers WHERE issue = ? AND kind = ?').get('DEV-1', 'task') as { c?: unknown },
    ).toEqual({ c: 1 })
    const all = lg.listLedgerEntries()
    expect(all.length).toBe(3)
    expect(all.map((e) => e.updated)).toEqual([...all.map((e) => e.updated)].sort((a, b) => a - b))
  })

  it('listLedgerEntries 过滤（issue / kind）；kind 枚举外值如实拒', () => {
    expect(lg.listLedgerEntries({ issue: 'DEV-1' }).map((e) => e.kind).sort()).toEqual(['progress', 'task'])
    expect(lg.listLedgerEntries({ kind: 'progress' }).map((e) => e.issue).sort()).toEqual(['DEV-1', 'DEV-2'])
    expectConfigInvalid(() => lg.listLedgerEntries({ kind: 'other' as never }), 'store/ledgers:bad-kind', '值域 task/progress')
  })

  it('形状闸：kind 枚举外 / updated 非整 / body 不可序列化 → CONFIG_INVALID（fail-closed）', () => {
    expectConfigInvalid(() => lg.upsertLedgerEntry({ issue: 'DEV-3', kind: 'note' as never, body: {}, updated: T0 }), 'store/ledger-entry:invalid:kind')
    expectConfigInvalid(() => lg.upsertLedgerEntry({ issue: 'DEV-3', kind: 'task', body: {}, updated: 1.5 }), 'store/ledger-entry:invalid:updated')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expectConfigInvalid(() => lg.upsertLedgerEntry({ issue: 'DEV-3', kind: 'task', body: circular, updated: T0 }), 'store/ledger-entry:body-unserializable')
    expect(lg.getLedgerEntry('DEV-3', 'task')).toBeUndefined()
  })
})

describe('reports 报表快照面——独立库', () => {
  let rp: Ledger

  beforeAll(() => {
    rp = openLedger(path.join(root, 'reports.db'))
  })

  afterAll(() => {
    rp.close()
  })

  const base = { company: 'demo', node: 'demo', type: 'monthly' as const, date: '2026-10-31', caliber: 'monthly/v1', json_ref: 'reports/2026-10-31-monthly-demo-经营月报.json' }

  it('insert 往返全字段：getReport 回读 deep-equal；新行 appended=true', () => {
    expect(rp.insertReport({ id: 'r-1', ...base })).toEqual({ id: 'r-1', appended: true })
    expect(rp.getReport('r-1')).toEqual({ id: 'r-1', ...base })
    expect(rp.getReport('r-none')).toBeUndefined()
  })

  it('幂等跳过：同自然键同 id 全列一致 → appended=false 不重写', () => {
    expect(rp.insertReport({ id: 'r-1', ...base })).toEqual({ id: 'r-1', appended: false })
    expect(rp.db.prepare('SELECT COUNT(*) AS c FROM reports').get() as { c?: unknown }).toEqual({ c: 1 })
  })

  it('同自然键新 id=覆盖换代（快照最新胜：id/caliber/json_ref 随新值，行数不涨）', () => {
    expect(rp.insertReport({ id: 'r-2', ...base, caliber: 'monthly/v2', json_ref: 'reports/2026-10-31-monthly-demo-经营月报-v2.json' })).toEqual({ id: 'r-2', appended: true })
    expect(rp.getReport('r-1')).toBeUndefined()
    expect(rp.getReport('r-2')).toEqual({ id: 'r-2', ...base, caliber: 'monthly/v2', json_ref: 'reports/2026-10-31-monthly-demo-经营月报-v2.json' })
    expect(rp.db.prepare('SELECT COUNT(*) AS c FROM reports').get() as { c?: unknown }).toEqual({ c: 1 })
  })

  it('同 id 内容不一致（caliber/json_ref 变）→ CONFIG_INVALID（id 全局唯一语义，拒改口供）', () => {
    expectConfigInvalid(() => rp.insertReport({ id: 'r-2', ...base, caliber: 'monthly/v3' }), 'store/reports:id-conflict', 'r-2')
    // 恢复 v2 形状后幂等依旧成立
    expect(rp.insertReport({ id: 'r-2', ...base, caliber: 'monthly/v2', json_ref: 'reports/2026-10-31-monthly-demo-经营月报-v2.json' })).toEqual({ id: 'r-2', appended: false })
  })

  it('自然键局部不同=新行：异 node / 异 type / 异 date / 异 company 互不干扰', () => {
    rp.insertReport({ id: 'r-dept', ...base, node: 'departments/工程部' })
    rp.insertReport({ id: 'r-daily', ...base, type: 'daily', date: '2026-10-20' })
    rp.insertReport({ id: 'r-nov', ...base, date: '2026-11-30' })
    rp.insertReport({ id: 'r-co', ...base, company: 'other-co' })
    expect(rp.db.prepare('SELECT COUNT(*) AS c FROM reports').get() as { c?: unknown }).toEqual({ c: 5 })
  })

  it('listReports 过滤（company/node/type）+ 恒升序（date,id）；type 枚举外值如实拒', () => {
    const all = rp.listReports()
    expect(all.length).toBe(5)
    expect(all.map((r) => `${r.date}/${r.id}`)).toEqual([...all.map((r) => `${r.date}/${r.id}`)].sort())
    expect(rp.listReports({ company: 'other-co' }).map((r) => r.id)).toEqual(['r-co'])
    expect(rp.listReports({ node: 'demo' }).map((r) => r.id)).toEqual(['r-daily', 'r-2', 'r-co', 'r-nov'])
    expect(rp.listReports({ type: 'monthly' }).map((r) => r.id)).toEqual(['r-2', 'r-co', 'r-dept', 'r-nov'])
    expectConfigInvalid(() => rp.listReports({ type: 'yearly' as never }), 'store/reports:bad-type', 'daily/weekly/monthly')
  })

  it('形状闸：type 枚举外 / 空 id / 非法 date 形状 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => rp.insertReport({ id: 'r-x', ...base, type: 'yearly' as never }), 'store/report:invalid:type')
    expectConfigInvalid(() => rp.insertReport({ id: '', ...base }), 'store/report:invalid:id')
    expectConfigInvalid(() => rp.insertReport({ id: 'r-x', ...base, date: '2026-10' }), 'store/report:invalid:date')
  })
})

describe('probes_runs 探针跑分面——独立库', () => {
  let pr: Ledger

  beforeAll(() => {
    pr = openLedger(path.join(root, 'probes.db'))
  })

  afterAll(() => {
    pr.close()
  })

  it('append 往返全字段（pass 布尔↔INTEGER 0/1；cost_usd/duration_ms 可空列往返）', () => {
    expect(pr.appendProbeRun({ id: 'p-1', executor: 'dsh', model: 'glm-5.3', probe_id: 'probe/hello', pass: true, cost_usd: 0.0125, duration_ms: 8_400, ts: T0 })).toEqual({ id: 'p-1', appended: true })
    expect(pr.getProbeRun('p-1')).toEqual({ id: 'p-1', executor: 'dsh', model: 'glm-5.3', probe_id: 'probe/hello', pass: true, cost_usd: 0.0125, duration_ms: 8_400, ts: T0 })
    pr.appendProbeRun({ id: 'p-2', executor: 'claude', model: 'sonnet', probe_id: 'probe/hello', pass: false, ts: T0 + 100 })
    expect(pr.getProbeRun('p-2')).toEqual({ id: 'p-2', executor: 'claude', model: 'sonnet', probe_id: 'probe/hello', pass: false, ts: T0 + 100 })
    expect(pr.getProbeRun('p-none')).toBeUndefined()
  })

  it('append 幂等：同 id 全列一致 → appended=false；同 id 内容不一致 → CONFIG_INVALID（append-only 拒覆盖）', () => {
    expect(pr.appendProbeRun({ id: 'p-1', executor: 'dsh', model: 'glm-5.3', probe_id: 'probe/hello', pass: true, cost_usd: 0.0125, duration_ms: 8_400, ts: T0 })).toEqual({ id: 'p-1', appended: false })
    expectConfigInvalid(() => pr.appendProbeRun({ id: 'p-1', executor: 'dsh', model: 'glm-5.3', probe_id: 'probe/hello', pass: true, cost_usd: 9.99, duration_ms: 8_400, ts: T0 }), 'store/probe-run:duplicate-id')
  })

  it('append-only 机制保证：行级触发器拦 UPDATE 与 DELETE（裸 SQL 也拒——AGENTS 纪律 4）', () => {
    expect(() => pr.db.prepare('UPDATE probes_runs SET pass = 0 WHERE id = ?').run('p-1')).toThrowError(/append-only/)
    expect(() => pr.db.prepare('DELETE FROM probes_runs WHERE id = ?').run('p-1')).toThrowError(/append-only/)
    expect(pr.getProbeRun('p-1')?.pass).toBe(true)
  })

  it('listProbeRuns 过滤（executor / probe_id / 时间窗）+ 恒升序（ts,id）', () => {
    pr.appendProbeRun({ id: 'p-0', executor: 'dsh', model: 'glm-5.3', probe_id: 'probe/bye', pass: true, ts: T0 - 50 })
    expect(pr.listProbeRuns().map((r) => r.id)).toEqual(['p-0', 'p-1', 'p-2'])
    expect(pr.listProbeRuns({ executor: 'claude' }).map((r) => r.id)).toEqual(['p-2'])
    expect(pr.listProbeRuns({ probe_id: 'probe/hello' }).map((r) => r.id)).toEqual(['p-1', 'p-2'])
    expect(pr.listProbeRuns({ since: T0, until: T0 + 50 }).map((r) => r.id)).toEqual(['p-1'])
  })

  it('形状闸：空串列 / pass 非布尔 / ts 非整 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => pr.appendProbeRun({ id: '', executor: 'dsh', model: 'm', probe_id: 'p', pass: true, ts: T0 }), 'store/probe-run:invalid:id')
    expectConfigInvalid(() => pr.appendProbeRun({ id: 'p-x', executor: 'dsh', model: 'm', probe_id: 'p', pass: 1 as never, ts: T0 }), 'store/probe-run:invalid:pass')
    expectConfigInvalid(() => pr.appendProbeRun({ id: 'p-x', executor: 'dsh', model: 'm', probe_id: 'p', pass: true, ts: 1.5 }), 'store/probe-run:invalid:ts')
  })
})
