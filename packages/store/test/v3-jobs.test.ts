/**
 * v0.4 地基·jobs 调度表测试（17-§2 调度表列集 / 18-§三 调度设计）：v3 迁移幂等与 v2→v3
 * 升级路径 / upsertJob 幂等覆盖（热更单岗不动他岗、不清 last_run_at）/ dueJobs 扫描时序 /
 * markRan 原子 / removeJob / 记录闸（cron 形状 5/6 段、model_tier 枚举、payload JSON 往返）。
 *
 * 环境：os.tmpdir() 真文件库（沿 ledger.test.ts 风格，不用 :memory:）。dueJobs / markRan 两块
 * 用独立库（整表扫描面，不与前面的 upsert 语料互相污染）。
 * 依据：docs/17-§2（调度表列集）、docs/18-§三（错过补跑、热更不动他岗）、docs/02 F2-12、
 * contract ports/company.ts ScheduledJob（源形状）/ ports/models.ts ModelTier（tier 枚举）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate, openLedger, openSqlite, type JobRecord, type Ledger } from '../src/index.ts'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v3-'))
  ledger = openLedger(path.join(root, 'jobs.db'))
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

/** 定时岗工厂：job_id 唯一递增，next_run_at 显式给（cron 解析归 core 后续单，store 不算下次） */
let seq = 0
function makeJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1
  return {
    job_id: `job-${seq}`,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'main_worker',
    level: 3,
    model_tier: 'mid',
    next_run_at: T0,
    ...patch,
  }
}

describe('v3 迁移（jobs 表 + 补跑/公司两索引）', () => {
  it('建库即到最新版（v5）：jobs 表在库、idx_jobs_next_run_at / idx_jobs_company 在库', () => {
    expect(ledger.version()).toBe(5)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(tables).toContain('jobs')
    const indexes = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_jobs%' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(indexes).toEqual(['idx_jobs_company', 'idx_jobs_next_run_at'])
  })

  it('重开库 migrate 幂等：version 不涨、schema_version 恰五行、v3 不重放', () => {
    const again = openLedger(path.join(root, 'jobs.db'))
    expect(again.version()).toBe(5)
    const rows = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(rows.c)).toBe(5)
    again.close()
  })

  it('v2 库升级路径：v2 建库写事件 → openLedger 升 v5，旧数据无损、jobs 表补齐可用', () => {
    // ① 构造 v2 库（migrate upTo=2：测试构造历史版本库的通道）+ 裸插一条合法事件
    const p = path.join(root, 'upgrade.db')
    const v2db = openSqlite(p)
    migrate(v2db, { upTo: 2 })
    expect(
      v2db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get() as { c?: unknown },
    ).toMatchObject({ c: 0 })
    v2db
      .prepare('INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', T0, 'demo', 'STUDIO-9', 'DISPATCH', 'AGENT-9:agent-9', 1, 3, 'departments/工程部', '{"input":100,"output":50}')
    v2db.close()

    // ② v2 库重开（openLedger 全量迁移）→ v4（v3 jobs + v4 daemon_kv 逐版本补齐），v2 数据原样可读，jobs 表补齐且可写
    const upgraded = openLedger(p)
    expect(upgraded.version()).toBe(5)
    expect(upgraded.queryEvents().map((e) => e.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV'])
    expect(upgraded.upsertJob({ ...makeJob(), job_id: 'job-after-upgrade', next_run_at: T0 + 5000 })).toBe('job-after-upgrade')
    expect(upgraded.dueJobs(T0).map((j) => j.job_id)).toEqual([]) // 该岗 next=T0+5000 未到点
    upgraded.close()
  })
})

describe('upsertJob（job_id 幂等覆盖）', () => {
  it('首插 → getJob 全字段往返（payload 对象/数组/标量、budget_cap、last_run_at/status 可空）', () => {
    expect(
      ledger.upsertJob(
        makeJob({ job_id: 'job-patrol', budget_cap: 5.5, payload: { probe: 'health', targets: ['panel', 'api'] }, status: 'active', next_run_at: T0 + 1000 }),
      ),
    ).toBe('job-patrol')
    expect(ledger.getJob('job-patrol')).toEqual({
      job_id: 'job-patrol',
      company: 'demo',
      dept: 'departments/工程部',
      cron: '*/5 * * * *',
      role: 'main_worker',
      level: 3,
      model_tier: 'mid',
      budget_cap: 5.5,
      payload: { probe: 'health', targets: ['panel', 'api'] },
      next_run_at: T0 + 1000,
      status: 'active',
    })

    // 最小行：可选列全缺 → 读回不含可选键；标量 payload 往返
    expect(ledger.upsertJob(makeJob({ job_id: 'job-min', payload: 'scalar' }))).toBe('job-min')
    const min = ledger.getJob('job-min')
    expect(min?.budget_cap).toBeUndefined()
    expect(min?.payload).toBe('scalar')
    expect(min?.last_run_at).toBeUndefined()
    expect(min?.status).toBeUndefined()
    expect(ledger.getJob('job-404')).toBeUndefined()
  })

  it('同 job_id 再 upsert：整行按本次所载覆盖（幂等，不涨行、不报错）', () => {
    expect(ledger.upsertJob(makeJob({ job_id: 'job-hot', cron: '0 * * * *', next_run_at: T0 }))).toBe('job-hot')
    expect(ledger.upsertJob(makeJob({ job_id: 'job-hot', cron: '0 0 * * *', model_tier: 'low', next_run_at: T0 + 9999, status: 'paused' }))).toBe('job-hot')
    expect(ledger.getJob('job-hot')).toMatchObject({ cron: '0 0 * * *', model_tier: 'low', next_run_at: T0 + 9999, status: 'paused' })
    // 同内容重复 upsert：仍幂等，行数不涨
    const rows = () => Number((ledger.db.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c?: unknown }).c)
    const before = rows()
    expect(ledger.upsertJob(makeJob({ job_id: 'job-hot', cron: '0 0 * * *', model_tier: 'low', next_run_at: T0 + 9999, status: 'paused' }))).toBe('job-hot')
    expect(rows()).toBe(before)
  })

  it('热更单岗不影响他岗：upsert B 后 A / C 整行不变（含 next_run_at）——18-§三', () => {
    ledger.upsertJob(makeJob({ job_id: 'job-a', next_run_at: T0 + 100, budget_cap: 1.5 }))
    ledger.upsertJob(makeJob({ job_id: 'job-b', next_run_at: T0 + 200 }))
    ledger.upsertJob(makeJob({ job_id: 'job-c', next_run_at: T0 + 300 }))
    const aBefore = ledger.getJob('job-a')
    const cBefore = ledger.getJob('job-c')
    expect(aBefore).toBeDefined()
    expect(cBefore).toBeDefined()

    // 热更 B：改 cron / 档位 / 下次时刻
    ledger.upsertJob(makeJob({ job_id: 'job-b', cron: '*/1 * * * *', model_tier: 'high', next_run_at: T0 + 50 }))

    expect(ledger.getJob('job-a')).toEqual(aBefore) // 整行 deep-equal：next_run_at 等全列不动
    expect(ledger.getJob('job-c')).toEqual(cBefore)
    expect(ledger.getJob('job-b')).toMatchObject({ cron: '*/1 * * * *', model_tier: 'high', next_run_at: T0 + 50 })
  })

  it('冲突时 last_run_at 不随覆盖：markRan 落的跑史，热更（公司目录重注册）不清零', () => {
    ledger.upsertJob(makeJob({ job_id: 'job-keep', next_run_at: T0 + 1000 }))
    expect(ledger.markRan('job-keep', T0 + 1234, T0 + 9000)).toBe(true)
    ledger.upsertJob(makeJob({ job_id: 'job-keep', cron: '*/15 * * * *', next_run_at: T0 + 8000 })) // 热更配置
    expect(ledger.getJob('job-keep')).toMatchObject({ cron: '*/15 * * * *', next_run_at: T0 + 8000, last_run_at: T0 + 1234 })
  })

  it('坏记录拒入：cron 形状（空串/纯空白/7 段）/ model_tier 枚举 / level 界外 / 未知列', () => {
    const base = makeJob({ job_id: 'job-bad' })
    // cron 形状：5 段、6 段（croner 含秒变体）过闸；空串、纯空白、7 段拒
    expect(ledger.upsertJob({ ...base, cron: '0 0 8 * * *' })).toBe('job-bad')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, cron: '' }), 'store/jobs:invalid:cron')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, cron: '   ' }), 'store/jobs:invalid:cron')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, cron: '0 0 8 * * * *' }), 'store/jobs:invalid:cron', '至多 6')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, model_tier: 'ultra' }), 'store/jobs:invalid:model_tier')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, level: 12 }), 'store/jobs:invalid:level')
    expectConfigInvalid(() => ledger.upsertJob({ ...base, bogus: true }), 'store/jobs:invalid:', 'bogus')
  })

  it('payload 不可 JSON 化拒收（循环引用 / 函数），不静默丢值', () => {
    const circular: Record<string, unknown> = { self: null }
    circular['self'] = circular
    expectConfigInvalid(() => ledger.upsertJob(makeJob({ job_id: 'job-unser', payload: circular })), 'store/jobs:payload-unserializable')
    expectConfigInvalid(() => ledger.upsertJob(makeJob({ job_id: 'job-unser', payload: () => 1 })), 'store/jobs:payload-unserializable')
    expect(ledger.getJob('job-unser')).toBeUndefined()
  })
})

describe('dueJobs（补跑扫描，18-§三 启动扫 due 槽位）——独立库', () => {
  let sched: Ledger

  beforeAll(() => {
    sched = openLedger(path.join(root, 'sched.db'))
  })

  afterAll(() => {
    sched.close()
  })

  it('next_run_at <= now 升序（含 =now 边界），未到点不返回', () => {
    sched.upsertJob(makeJob({ job_id: 'due-1', next_run_at: T0 + 300 }))
    sched.upsertJob(makeJob({ job_id: 'due-2', next_run_at: T0 + 100 }))
    sched.upsertJob(makeJob({ job_id: 'due-3', next_run_at: T0 + 200 }))
    sched.upsertJob(makeJob({ job_id: 'future-1', next_run_at: T0 + 301 }))

    // =now 边界收（<=），未到点（+301）不收；升序按 next_run_at
    expect(sched.dueJobs(T0 + 300).map((j) => j.job_id)).toEqual(['due-2', 'due-3', 'due-1'])
    expect(sched.dueJobs(T0 + 99).map((j) => j.job_id)).toEqual([])
  })

  it('limit 截断 + 同刻多岗按 job_id 稳定序', () => {
    sched.upsertJob(makeJob({ job_id: 'tie-b', next_run_at: T0 + 5000 }))
    sched.upsertJob(makeJob({ job_id: 'tie-a', next_run_at: T0 + 5000 }))
    sched.upsertJob(makeJob({ job_id: 'tie-c', next_run_at: T0 + 5000 }))

    expect(sched.dueJobs(T0 + 5000, 2).map((j) => j.job_id)).toEqual(['due-2', 'due-3'])
    expect(sched.dueJobs(T0 + 5000).slice(-3).map((j) => j.job_id)).toEqual(['tie-a', 'tie-b', 'tie-c'])
    expect(sched.dueJobs(T0 + 5000, 0)).toEqual([])
    expectConfigInvalid(() => sched.dueJobs(T0, -1), 'store/jobs:bad-limit')
  })
})

describe('markRan / removeJob——独立库', () => {
  let ops: Ledger

  beforeAll(() => {
    ops = openLedger(path.join(root, 'ops.db'))
  })

  afterAll(() => {
    ops.close()
  })

  it('markRan：last_run_at 与 next_run_at 同语句落库，其余列不动；返回 true', () => {
    ops.upsertJob(makeJob({ job_id: 'job-ran', cron: '*/10 * * * *', budget_cap: 2.5, payload: { kind: 'patrol' }, status: 'active' }))
    const before = ops.getJob('job-ran')
    expect(before).toBeDefined()
    expect(ops.markRan('job-ran', T0 + 7777, T0 + 13777)).toBe(true)
    expect(ops.getJob('job-ran')).toEqual({ ...before, last_run_at: T0 + 7777, next_run_at: T0 + 13777 })
  })

  it('markRan / removeJob 不存在的 job → false（如实上报，不伪造）', () => {
    expect(ops.markRan('job-404', T0, T0 + 1)).toBe(false)
    expect(ops.removeJob('job-404')).toBe(false)
  })

  it('removeJob：删行返回 true，再删 false；不影响他岗', () => {
    ops.upsertJob(makeJob({ job_id: 'job-del', next_run_at: T0 + 400 }))
    ops.upsertJob(makeJob({ job_id: 'job-nb', next_run_at: T0 + 410 }))
    const neighbor = ops.getJob('job-nb')
    expect(ops.removeJob('job-del')).toBe(true)
    expect(ops.getJob('job-del')).toBeUndefined()
    expect(ops.removeJob('job-del')).toBe(false)
    expect(ops.getJob('job-nb')).toEqual(neighbor)
  })
})

describe('listJobs（面板 v0.3 jobs 视图的读面）', () => {
  it('next_run_at 升序、同刻按 job_id；返回形状为 JobRecord', () => {
    const jobs: JobRecord[] = ledger.listJobs()
    expect(jobs.length).toBeGreaterThan(0)
    const keys = jobs.map((j) => `${j.next_run_at}:${j.job_id}`)
    expect([...keys].sort()).toEqual(keys)
  })
})
