/**
 * v0.5 吸收·v4 测试（store v4 三债）：daemon_kv 接管（迁移幂等 / daemon 切换后无自建 DDL /
 * v3→v4 升级路径含存量 daemon_kv 原地接管 / kv 往返覆盖）、work_records 收口面 endWorkRecord
 * （一次性 / 部分列 COALESCE / tokens 往返与坏形状 / 重复收口拒 / 无此行 false）、queryEvents
 * 倒序通道（desc=asc 镜像反序 / 同过滤两序等价集 / desc+limit=最近 N / 过滤组合 / 坏 order 运行期拒）。
 *
 * 环境：os.tmpdir() 真文件库（沿 ledger.test.ts 风格，不用 :memory:）。kv / desc 两块用独立库
 * （语料隔离，不与迁移语料互相污染）。
 * 依据：docs/17-§2（游标/拍序持久化）、docs/17-§3、docs/02 F2-01（store 收编 daemon 旁路写面）。
 * daemon_kv 对照（本单已同步）：daemon 已切 store v4 面、引擎内自建语句已删（切换单
 * feature/daemon-store-api-switch）——下方 DAEMON_* 常量为**切换前语句的历史形态存档**
 * （跨包 import 违反包边界，字节级复制留存）。存档用途：①v3→v4 升级路径语料构造（v3 时代
 * daemon 真会执行这些语句，存量库实况即此形态）；②建表字节级对齐的永久回归（v4 DDL 须永远
 * 与切换前 daemon 自建 DDL 同形，存量库才能无损接管）。daemon 侧「不再执行任何 DDL」的直证
 * 落 apps/daemon/test/e2e.test.ts（createEngine+整拍后 sqlite_master 快照不变的负断言）——
 * 本包无法 import daemon 重放真引擎初始化，store 侧可测面=重放 v4 全部 kv 触点后 schema 不变。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { migrate, openLedger, openSqlite, type EndWorkRecord, type Ledger } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

/** 切换前 apps/daemon/src/engine.ts 的 KV_TABLE_SQL 原文（历史形态存档——daemon 已删自建段切
 *  store v4 面；用途见文件头注。**非现行语句，勿随 store schema 演进改写**——改动即失存量对照） */
const DAEMON_KV_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS daemon_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
/** 切换前 apps/daemon/src/engine.ts 的 kvSetStmt 原文（同上，历史形态存档） */
const DAEMON_KV_SET_SQL =
  'INSERT INTO daemon_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
/** 切换前 apps/daemon/src/engine.ts 的 kvGetStmt 原文（同上，历史形态存档） */
const DAEMON_KV_GET_SQL = 'SELECT value FROM daemon_kv WHERE key = ?'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v4-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
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

const T0 = 1770000000000

/** 事件工厂：ts 显式给（升/降序语料要精确控时刻），id 随 ts 生成合法 ULID */
function makeEvent(ts: number, patch: Partial<EventRecord> = {}): EventRecord {
  return {
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: 'STUDIO-400',
    event: 'DISPATCH',
    actor: 'AGENT-4:agent-4',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 10, output: 5 },
    ...patch,
  }
}

/** 在途工时单工厂（running；started_at 显式给——收口断言要精确值） */
function makeRunning(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `wr-${makeUlid(T0)}`,
    issue: 'STUDIO-400',
    person_id: 'AGENT-4',
    executor: 'dsh',
    started_at: T0 + 100,
    attempt: 1,
    status: 'running',
    ...patch,
  }
}

describe('v4 迁移（daemon_kv 接管）', () => {
  it('建库即到 v7（v4 daemon_kv 随建库齐备）：daemon_kv 在库；重开库 migrate 幂等（version 不涨、schema_version 恰七行、v4 不重放）', () => {
    expect(ledger.version()).toBe(13)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(tables).toContain('daemon_kv')
    const rows = ledger.db.prepare('SELECT version, sha8 FROM schema_version ORDER BY version').all() as Array<{ version: unknown; sha8: unknown }>
    expect(rows.length).toBe(13)
    for (const row of rows) expect(String(row.sha8)).toMatch(/^[0-9a-f]{8}$/)

    const again = openLedger(path.join(root, 'ledger.db'))
    expect(again.version()).toBe(13)
    const count = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(count.c)).toBe(13)
    again.close()
  })

  it('daemon 已切本面（切换债清偿后）：对 v4 库重放 daemon 全部持久化触点（本面 kvGet/kvSet）无任何 schema 变化', () => {
    const l = openLedger(path.join(root, 'switched.db'))
    l.kvSet('activity.cursor', 'cur-1')
    l.kvSet('tick.seq', '3')
    const schemaOf = (): string =>
      JSON.stringify(l.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all())
    const before = schemaOf()
    // daemon 切换后的初始化/每拍持久化触点=本面 kvGet/kvSet（引擎自建 DDL 与语句已删——切换单）。
    // 注：本包无法 import apps/daemon 重放真引擎初始化（跨包违反包边界，见文件头注），store 侧
    // 可测面=「v4 全部 kv 触点重放后 sqlite_master 快照不变、版本与迁移行数不漂」；daemon 侧
    // 真路径无 DDL 的直证在 apps/daemon/test/e2e.test.ts（createEngine+整拍快照不变负断言）。
    expect(l.kvGet('activity.cursor')).toBe('cur-1')
    expect(l.kvGet('tick.seq')).toBe('3')
    expect(l.kvGet('never.set')).toBeNull()
    l.kvSet('tick.seq', '4')
    l.kvSet('activity.cursor', '') // 空串=游标 null 持久形态（daemon 回读方还原 null 的那条路径）
    expect(schemaOf()).toBe(before)
    expect(l.version()).toBe(13)
    const versionRows = l.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(versionRows.c)).toBe(13)
    // 存档语句与本面的读写互通仍成立（历史存量库数据的可读性）：存档 SET 写入 → 本面可读
    l.db.prepare(DAEMON_KV_SET_SQL).run('legacy.key', 'legacy-value')
    expect(l.kvGet('legacy.key')).toBe('legacy-value')
    expect(schemaOf()).toBe(before)
    l.close()
  })

  it('历史形态存档对照：v4 建表语句与切换前 daemon 自建 DDL 在 sqlite_master 逐字节一致（存量库无缝接管的永久回归）', () => {
    const daemonBuilt = openSqlite(path.join(root, 'daemon-built.db'))
    daemonBuilt.exec(DAEMON_KV_TABLE_SQL)
    const migrated = openLedger(path.join(root, 'migrated.db'))
    const daemonSql = String(
      (daemonBuilt.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daemon_kv'").get() as { sql?: unknown }).sql,
    )
    const migratedSql = String(
      (migrated.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daemon_kv'").get() as { sql?: unknown }).sql,
    )
    expect(migratedSql).toBe(daemonSql)
    expect(daemonSql).toContain('key TEXT PRIMARY KEY, value TEXT NOT NULL')
    daemonBuilt.close()
    migrated.close()
  })

  it('v3→v4 升级路径（v3 时代 daemon 已自建 daemon_kv 的存量库）：裸数据无损、kv 数据原地接管、收口面可用', () => {
    // ① 构造 v3 库（migrate upTo=3）+ 切换前 daemon 做法（历史 SQL 存档，见文件头注）自建
    //    daemon_kv 并落游标/拍序 + 裸数据
    const p = path.join(root, 'upgrade.db')
    const v3db = openSqlite(p)
    migrate(v3db, { upTo: 3 })
    expect(
      v3db.prepare("SELECT COUNT(*) AS c FROM schema_version").get() as { c?: unknown },
    ).toMatchObject({ c: 3 })
    v3db.exec(DAEMON_KV_TABLE_SQL)
    v3db.prepare(DAEMON_KV_SET_SQL).run('activity.cursor', 'legacy-cursor')
    v3db.prepare(DAEMON_KV_SET_SQL).run('tick.seq', '12')
    v3db
      .prepare('INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', T0, 'demo', 'STUDIO-9', 'DISPATCH', 'AGENT-9:agent-9', 1, 3, 'departments/工程部', '{"input":100,"output":50}')
    v3db
      .prepare('INSERT INTO work_records (id, issue, person_id, executor, started_at, attempt, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('wr-legacy', 'STUDIO-9', 'AGENT-9', 'dsh', T0, 1, 'running')
    v3db.close()

    // ② 重开（openLedger 全量迁移）→ v4：IF NOT EXISTS 对存量表无操作，kv 数据原地接管
    const upgraded = openLedger(p)
    expect(upgraded.version()).toBe(13)
    expect(upgraded.queryEvents().map((e) => e.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV'])
    expect(upgraded.kvGet('activity.cursor')).toBe('legacy-cursor')
    expect(upgraded.kvGet('tick.seq')).toBe('12')
    expect(upgraded.endWorkRecord('wr-legacy', { ended_at: T0 + 900, status: 'done' })).toBe(true)
    expect(upgraded.getWorkRecord('wr-legacy')).toMatchObject({ status: 'done', ended_at: T0 + 900 })
    upgraded.close()
  })
})

describe('kvGet / kvSet（upsert 语义）——独立库', () => {
  let kv: Ledger

  beforeAll(() => {
    kv = openLedger(path.join(root, 'kv.db'))
  })

  afterAll(() => {
    kv.close()
  })

  it('缺键=null → 写入往返 → 覆盖=upsert（不报错不涨行），他键不动', () => {
    expect(kv.kvGet('activity.cursor')).toBeNull()
    kv.kvSet('activity.cursor', 'yt-activity-42')
    expect(kv.kvGet('activity.cursor')).toBe('yt-activity-42')
    const rows = () => Number((kv.db.prepare('SELECT COUNT(*) AS c FROM daemon_kv').get() as { c?: unknown }).c)
    expect(rows()).toBe(1)
    // 覆盖写：upsert 语义，同键新值顶旧值
    kv.kvSet('activity.cursor', 'yt-activity-43')
    expect(kv.kvGet('activity.cursor')).toBe('yt-activity-43')
    expect(rows()).toBe(1)
    kv.kvSet('tick.seq', '7')
    expect(kv.kvGet('tick.seq')).toBe('7')
    expect(kv.kvGet('activity.cursor')).toBe('yt-activity-43')
    expect(rows()).toBe(2)
  })

  it('value 允空串（daemon「游标 null」持久形态，回读方还原 null）；空键读写双拒', () => {
    kv.kvSet('activity.cursor', '')
    expect(kv.kvGet('activity.cursor')).toBe('')
    expectConfigInvalid(() => kv.kvGet(''), 'store/kv:bad-key')
    expectConfigInvalid(() => kv.kvSet('', 'x'), 'store/kv:bad-key')
  })
})

describe('endWorkRecord（收口面：一次性 + COALESCE）', () => {
  it('全字段收口：running→终态一次落齐（ended_at/status/cost_usd/report_ref/summary_ref）', () => {
    ledger.insertWorkRecord(makeRunning({ id: 'wr-full', started_at: T0 + 100, session_id: 'sess-1' }))
    expect(
      ledger.endWorkRecord('wr-full', {
        ended_at: T0 + 5000,
        status: 'done',
        cost_usd: 0.75,
        report_ref: 'workspaces/STUDIO-400/att1/REPORT.md',
        summary_ref: 'workspaces/STUDIO-400/att1/summary.json',
      }),
    ).toBe(true)
    expect(ledger.getWorkRecord('wr-full')).toEqual({
      id: 'wr-full',
      issue: 'STUDIO-400',
      person_id: 'AGENT-4',
      executor: 'dsh',
      session_id: 'sess-1',
      started_at: T0 + 100,
      attempt: 1,
      status: 'done',
      ended_at: T0 + 5000,
      cost_usd: 0.75,
      report_ref: 'workspaces/STUDIO-400/att1/REPORT.md',
      summary_ref: 'workspaces/STUDIO-400/att1/summary.json',
    })
  })

  it('tokens 收口往返：四桶+兼容旧键落列 JSON 文本原序（132-§6.1 单A）+ 回读同形；未给值列不动', () => {
    ledger.insertWorkRecord(makeRunning({ id: 'wr-tok', started_at: T0 + 400 }))
    expect(
      ledger.endWorkRecord('wr-tok', { ended_at: T0 + 800, status: 'done', cost_usd: 0.5, tokens: { input: 120, output: 30, cache_read: 7, cache_creation: 2 } }),
    ).toBe(true)
    expect(ledger.getWorkRecord('wr-tok')?.tokens).toEqual({ input: 120, output: 30, cache_read: 7, cache_creation: 2 })
    // 列形态：JSON 文本，键序=写入原序（kernel.TokenCounts 四桶——132-§6.1 单A 与 events
    // F2-04 同名统一，G7 收口）；序列化原序=调用方对象序，store 不重排不增删
    const raw = ledger.db.prepare('SELECT tokens FROM work_records WHERE id = ?').get('wr-tok') as { tokens?: unknown }
    expect(String(raw.tokens)).toBe('{"input":120,"output":30,"cache_read":7,"cache_creation":2}')
    // 兼容旧键：`cached` 形（存量 85 行形状）照收照回——读侧归并 cache_read ?? cached 归消费方
    ledger.insertWorkRecord(makeRunning({ id: 'wr-tok4', started_at: T0 + 420 }))
    expect(
      ledger.endWorkRecord('wr-tok4', { ended_at: T0 + 820, status: 'done', tokens: { input: 80, output: 20, cached: 5 } }),
    ).toBe(true)
    expect(ledger.getWorkRecord('wr-tok4')?.tokens).toEqual({ input: 80, output: 20, cached: 5 })
    // 反向：不带缓存桶的两字段形态（无缓存流的收割 stats 即此形）
    ledger.insertWorkRecord(makeRunning({ id: 'wr-tok3', started_at: T0 + 410 }))
    expect(ledger.endWorkRecord('wr-tok3', { ended_at: T0 + 810, status: 'done', tokens: { input: 100, output: 50 } })).toBe(true)
    expect(ledger.getWorkRecord('wr-tok3')?.tokens).toEqual({ input: 100, output: 50 })
    // 未给 tokens：列仍缺（COALESCE 不动）
    ledger.insertWorkRecord(makeRunning({ id: 'wr-tok2', started_at: T0 + 450 }))
    expect(ledger.endWorkRecord('wr-tok2', { ended_at: T0 + 850, status: 'done' })).toBe(true)
    expect(ledger.getWorkRecord('wr-tok2')?.tokens).toBeUndefined()
  })

  it('model 收口往返（132-§6.1 单A·v8 列）：收割直落归一形；未给值列不动（COALESCE）；插入时已有值收口不带走', () => {
    ledger.insertWorkRecord(makeRunning({ id: 'wr-model', started_at: T0 + 460 }))
    expect(
      ledger.endWorkRecord('wr-model', { ended_at: T0 + 860, status: 'done', model: 'glm/GLM-5.3' }),
    ).toBe(true)
    expect(ledger.getWorkRecord('wr-model')).toMatchObject({ model: 'glm/GLM-5.3' })
    // 未给 model：列仍 NULL（无从可知=缺省，不猜）
    ledger.insertWorkRecord(makeRunning({ id: 'wr-model2', started_at: T0 + 470 }))
    expect(ledger.endWorkRecord('wr-model2', { ended_at: T0 + 870, status: 'done' })).toBe(true)
    expect(ledger.getWorkRecord('wr-model2')?.model).toBeUndefined()
    // 空 model 串拒（归一形非空串——写面闸）
    expectConfigInvalid(
      () => ledger.endWorkRecord('wr-404', { ended_at: T0, status: 'done', model: '' }),
      'store/work-record:end-invalid:model',
    )
  })

  it('tokens 坏形状拒：负值 / 非整数 / 未知桶（strict——真未知键不吃；四桶名 cache_read/cache_creation 合法=132-§6.1 单A 正名）；闸先于行存在性', () => {
    const bad = (tokens: unknown): void => {
      expectConfigInvalid(
        () => ledger.endWorkRecord('wr-404', { ended_at: T0, status: 'done', tokens: tokens as EndWorkRecord['tokens'] }),
        'store/work-record:end-invalid:tokens',
      )
    }
    bad({ input: -1, output: 0 })
    bad({ input: 1.5, output: 0 })
    bad({ input: 1, output: 2, cache_warm: 3 }) // 真未知桶名——拒（cache_read/cache_creation 现为合法四桶键）
    bad({ input: 1 }) // 缺 output
  })

  it('部分列收口：未给值的列不动（COALESCE）——插入时已有的 cost_usd 保留，未给的 report/summary 仍缺', () => {
    ledger.insertWorkRecord(makeRunning({ id: 'wr-partial', started_at: T0 + 200, cost_usd: 1.25 }))
    expect(ledger.endWorkRecord('wr-partial', { ended_at: T0 + 600, status: 'failed' })).toBe(true)
    const rec = ledger.getWorkRecord('wr-partial')
    expect(rec).toMatchObject({ status: 'failed', ended_at: T0 + 600, cost_usd: 1.25 })
    expect(rec?.report_ref).toBeUndefined()
    expect(rec?.summary_ref).toBeUndefined()
    // 反向：收口给 report_ref 而不给 cost（插入时也无 cost）→ cost 仍缺
    ledger.insertWorkRecord(makeRunning({ id: 'wr-partial2', started_at: T0 + 300 }))
    expect(ledger.endWorkRecord('wr-partial2', { ended_at: T0 + 700, status: 'done', report_ref: 'r.md' })).toBe(true)
    const rec2 = ledger.getWorkRecord('wr-partial2')
    expect(rec2).toMatchObject({ status: 'done', report_ref: 'r.md' })
    expect(rec2?.cost_usd).toBeUndefined()
  })

  it('重复收口拒：已 ended 再收=CONFIG_INVALID（同/异载荷均拒——收口是状态迁移非入账，无幂等跳过）；原值不被改写', () => {
    expectConfigInvalid(
      () => ledger.endWorkRecord('wr-full', { ended_at: T0 + 9999, status: 'failed' }),
      'store/work-record:already-ended',
      'wr-full',
    )
    expectConfigInvalid(
      () =>
        ledger.endWorkRecord('wr-full', {
          ended_at: T0 + 5000,
          status: 'done',
          cost_usd: 0.75,
          report_ref: 'workspaces/STUDIO-400/att1/REPORT.md',
          summary_ref: 'workspaces/STUDIO-400/att1/summary.json',
        }),
      'store/work-record:already-ended',
    )
    expect(ledger.getWorkRecord('wr-full')).toMatchObject({ ended_at: T0 + 5000, status: 'done' })
  })

  it('无此行=false（如实上报不伪造）；坏入参拒（空 status / 负 ended_at / 未知列）', () => {
    expect(ledger.endWorkRecord('wr-404', { ended_at: T0, status: 'done' })).toBe(false)
    expectConfigInvalid(() => ledger.endWorkRecord('wr-404', { ended_at: T0, status: '' }), 'store/work-record:end-invalid:status')
    expectConfigInvalid(() => ledger.endWorkRecord('wr-404', { ended_at: -1, status: 'done' }), 'store/work-record:end-invalid:ended_at')
    expectConfigInvalid(
      () => ledger.endWorkRecord('wr-404', { ended_at: T0, status: 'done', bogus: 1 } as unknown as EndWorkRecord),
      'store/work-record:end-invalid:',
      'bogus',
    )
    // 闸先于行存在性：坏入参在无此行时也拒（拒坏值优先，不留「坏值静默吞、只回 false」的暗门）
  })
})

describe('queryEvents 倒序通道（order）——独立库', () => {
  let ord: Ledger
  /** demo 全量升序 id（语料固定：e1..e5 离散 ts + tieA/tieB 同刻 T0+6000；other1 另一公司） */
  let demoAsc: EventRecord[]

  beforeAll(() => {
    ord = openLedger(path.join(root, 'order.db'))
    for (const ts of [T0 + 1000, T0 + 2000, T0 + 3000, T0 + 4000, T0 + 5000]) {
      expect(ord.appendEvent(makeEvent(ts)).appended).toBe(true)
    }
    // 同刻平局对：ts 相同、id 随机——(ts,id) 双列取反的镜像反序仍须精确成立
    expect(ord.appendEvent(makeEvent(T0 + 6000)).appended).toBe(true)
    expect(ord.appendEvent(makeEvent(T0 + 6000)).appended).toBe(true)
    expect(ord.appendEvent(makeEvent(T0 + 3500, { company: 'other', issue: 'OTHER-9' })).appended).toBe(true)
    demoAsc = ord.queryEvents({ company: 'demo' })
    expect(demoAsc.length).toBe(7)
  })

  afterAll(() => {
    ord.close()
  })

  it('desc=asc 的镜像反序（无 limit 全量）；同过滤两序等价集（拼起来=同集合）', () => {
    const desc = ord.queryEvents({ company: 'demo', order: 'desc' })
    expect(desc.map((e) => e.id)).toEqual([...demoAsc].reverse().map((e) => e.id))
    // 等价集：同过滤下两序取到的 id 集合一致（顺序无关）
    expect(new Set(desc.map((e) => e.id))).toEqual(new Set(demoAsc.map((e) => e.id)))
    // 同刻平局：两序在 T0+6000 段互为反序（id 双列取反的直证）
    const tieAsc = demoAsc.filter((e) => e.ts === T0 + 6000).map((e) => e.id)
    const tieDesc = desc.filter((e) => e.ts === T0 + 6000).map((e) => e.id)
    expect(tieDesc).toEqual([...tieAsc].reverse())
  })

  it('desc+limit=最近 N 条：等于升序尾部 N 条的逆序；首元素即最大 ts', () => {
    const recent3 = ord.queryEvents({ company: 'demo', order: 'desc', limit: 3 })
    expect(recent3.map((e) => e.id)).toEqual(demoAsc.slice(-3).reverse().map((e) => e.id))
    expect(recent3[0]?.ts).toBe(T0 + 6000)
    expect(recent3[2]?.ts).toBe(T0 + 5000) // 尾三条 = ts 5000 + 同刻 6000 平局对
    // limit 超过总量=全量逆序
    expect(ord.queryEvents({ company: 'demo', order: 'desc', limit: 99 }).map((e) => e.id)).toEqual(
      [...demoAsc].reverse().map((e) => e.id),
    )
  })

  it('过滤组合（company+since/until 闭区间）下 desc 同义：窗内升序的逆序，窗沿事件不丢', () => {
    const win = ord.queryEvents({ company: 'demo', since: T0 + 2000, until: T0 + 5000 })
    expect(win.map((e) => e.ts)).toEqual([T0 + 2000, T0 + 3000, T0 + 4000, T0 + 5000])
    const winDesc = ord.queryEvents({ company: 'demo', since: T0 + 2000, until: T0 + 5000, order: 'desc' })
    expect(winDesc.map((e) => e.id)).toEqual([...win].reverse().map((e) => e.id))
    expect(winDesc.map((e) => e.ts)).toEqual([T0 + 5000, T0 + 4000, T0 + 3000, T0 + 2000])
  })

  it('缺省 order 升序回归不变；坏 order 运行期拒（方向内插 SQL，白名单闸防注入）', () => {
    expect(ord.queryEvents({ company: 'demo', limit: 2 }).map((e) => e.ts)).toEqual([T0 + 1000, T0 + 2000])
    expect(ord.queryEvents({ company: 'demo', order: 'asc' }).map((e) => e.id)).toEqual(demoAsc.map((e) => e.id))
    expectConfigInvalid(
      () => ord.queryEvents({ order: 'ts; DROP TABLE events' as unknown as 'desc' }),
      'store/evt:bad-order',
    )
    // 拒后库无损（无注入面、无副作用）
    expect(ord.queryEvents({ company: 'demo' }).length).toBe(7)
  })
})
