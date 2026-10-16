/**
 * scheduler —— 定时岗调度层测试（v0.4，16-§四 / 18-§三 / 22-§一）
 *
 * 断言面（实现单口径逐条钉死）：
 *   1. nextRunAt：cron 槽计算（本地时区）、坏表达式抛错、无未来槽返 null（croner 实测口径）
 *   2. due 触发与 nextRun 推进：先 markRan 后回调；last_run_at/next_run_at 落账正确
 *   3. coalesce（18-§三）：错过三槽（next_run_at 远过去）只触发一次，next 从「现在」重算
 *   4. 同岗不重叠：触发瞬间（onDue 回调内）再查 due 不见它；紧接再 poll 不双触发
 *   5. 坏 cron 隔离：不炸调度器、计数+日志、他岗照常、last_run_at 不动、隔离窗后重试
 *   6. 热更：单岗 upsertJob 覆盖下一拍生效，他岗不动；markRan 时行已消失不回调
 *   7. start/stop 生命周期：轮询真起、停后不再触发、stop 幂等、start 重入明报
 *   8. schedule 意图全链（22-§一「源只产意图」）：ingest → tick 物化岗单据（PATROL 留痕）
 *      → decide → DISPATCH → 收割 → GATE_PASS → … → CLOSE（定时岗结果落台账）
 *   9. 意图幂等（22-§三.2）：同 dedupKey 重复 ingest 只物化一次；重启重放（新引擎同台账）不双开
 *  10. 意图明报：unknown job_id / 公司不匹配 / 非 schedule kind / 缺 dedupKey 逐项如实入 errors
 *  11. serve 接线：jobs/jobPollMs 配置解析、seedJobs 播种语义（新岗下一槽、既有岗保欠账、
 *      坏 cron 隔离窗）、buildServeRuntime 起停（stop=停调度器+drain+关台账，SIGINT 同收口）
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, InvokeIntent } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import {
  createScheduler,
  nextRunAt,
  scheduleIntent,
} from '../src/scheduler.ts'
import {
  buildServeRuntime,
  DEMO_SNAPSHOT,
  parseDaemonConfig,
  seedJobs,
  type ServeConfig,
} from '../src/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

/** 本地时区锚点（cron 一律本地时区——模板 org-config 注释口径） */
const T0 = Date.UTC(2026, 9, 16, 0, 0, 0) // 伪锚：具体断言用本地构造器

let root = ''

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo, d, h, mi, s, 0).getTime()
}

/** 按事件名筛（store 查询面无 event 名过滤——company/issue/since/until/limit 而已） */
function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

/** 台账测试栈：每用例独立 tmp 库 + 假时钟 */
interface LedgerStack {
  ledger: Ledger
  clock: { now(): number; advance(ms: number): void; set(ms: number): void }
}

function openStack(id: string, start = local(2026, 9, 16, 0, 0, 0)): LedgerStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = start
  return { ledger, clock: { now: (): number => t, advance: (ms): void => { t += ms }, set: (ms): void => { t = ms } } }
}

function job(partial: Partial<JobRecord> & Pick<JobRecord, 'job_id'>): JobRecord {
  return {
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    next_run_at: 0,
    ...partial,
  }
}

/** 引擎测试栈：fake 全家桶（e2e.test.ts 同手法；快照=serve 的 DEMO_SNAPSHOT，含样例岗） */
interface EngineStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildEngineStack(id: string, snapshot: CompanySnapshot = DEMO_SNAPSHOT): EngineStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = local(2026, 9, 16, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.4-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/18-§三（调度）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: snapshot.people[0]?.id ?? 'AGENT-1',
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
    },
    people: snapshot.people,
  })
  return { platform, ledger, engine, clock }
}

/** 派发在途的 schedule 意图（dedupKey 与 scheduler 产源同构） */
function intent(jobId: string, firedAt: number, company = 'demo'): InvokeIntent {
  return scheduleIntent(job({ job_id: jobId, company }), firedAt)
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-scheduler-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— nextRunAt（croner 求值面） —————————————————————————

describe('nextRunAt：cron 表达式求值', () => {
  it('每 5 分钟槽：00:02 → 00:05（本地时区）', () => {
    expect(nextRunAt('*/5 * * * *', local(2026, 9, 16, 0, 2, 30))).toBe(local(2026, 9, 16, 0, 5, 0))
  })

  it('每日 12 点：当日 00:00 → 当日 12:00；当日 13:00 → 次日 12:00', () => {
    expect(nextRunAt('0 12 * * *', local(2026, 9, 16, 0, 0, 0))).toBe(local(2026, 9, 16, 12, 0, 0))
    expect(nextRunAt('0 12 * * *', local(2026, 9, 16, 13, 0, 0))).toBe(local(2026, 9, 17, 12, 0, 0))
  })

  it('坏表达式抛错（不吞——调用方隔离）', () => {
    expect(() => nextRunAt('61 25 * * *', T0)).toThrow()
    expect(() => nextRunAt('not a cron', T0)).toThrow()
  })

  it('无未来槽返回 null（不可能日期）', () => {
    expect(nextRunAt('0 0 31 2 *', T0)).toBeNull()
  })
})

// ————————————————————————— 调度器：触发 / coalesce / 不重叠 —————————————————————————

describe('调度器：due 触发与 nextRun 推进', () => {
  it('未到点不触发（next_run_at 在未来）', () => {
    const s = openStack('future')
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() + 60_000 }))
    const fired: string[] = []
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: (j) => fired.push(j.job_id), intervalMs: 1000 })
    const report = sched.poll()
    expect(fired).toEqual([])
    expect(report).toMatchObject({ due: 0, fired: 0 })
    s.ledger.close()
  })

  it('due 触发一次：markRan 先行（last_run_at=now、next_run_at 越过 now）', () => {
    const s = openStack('fire-once')
    const due = s.clock.now() // 恰好到点
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: due }))
    const fired: Array<{ job_id: string; at: number }> = []
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: (j, at) => fired.push({ job_id: j.job_id, at }), intervalMs: 1000 })
    const report = sched.poll()
    expect(fired).toEqual([{ job_id: 'j1', at: due }])
    expect(report.fired).toBe(1)
    const row = s.ledger.getJob('j1')
    expect(row?.last_run_at).toBe(due)
    expect(row?.next_run_at).toBeGreaterThan(due)
    // 每日 12 点岗在 00:00 触发（next_run_at 被手工置 0 的补跑形），下一槽=当日 12:00
    s.ledger.close()
  })

  it('nextRun 推进用 croner：*/5 岗 00:02 触发后 next=00:05', () => {
    const s = openStack('next-advance', local(2026, 9, 16, 0, 2, 0))
    s.ledger.upsertJob(job({ job_id: 'j1', cron: '*/5 * * * *', next_run_at: local(2026, 9, 16, 0, 0, 0) }))
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => undefined, intervalMs: 1000 })
    sched.poll()
    expect(s.ledger.getJob('j1')?.next_run_at).toBe(local(2026, 9, 16, 0, 5, 0))
    s.ledger.close()
  })

  it('coalesce：错过三槽（next_run_at 远过去 15 分钟）只触发一次，next 从「现在」重算', () => {
    const s = openStack('coalesce', local(2026, 9, 16, 0, 15, 0))
    // cron 每 5 分钟、停机 15 分钟=错过 3 个槽：行里只有一条过期 next_run_at
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: local(2026, 9, 16, 0, 0, 0) }))
    let fired = 0
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => { fired += 1 }, intervalMs: 1000 })
    const report = sched.poll()
    expect(report.due).toBe(1)
    expect(fired).toBe(1)
    expect(s.ledger.getJob('j1')?.next_run_at).toBe(local(2026, 9, 16, 0, 20, 0))
    // 紧接再 poll：无 due（不补第二枪）
    s.clock.advance(1)
    expect(sched.poll().fired).toBe(0)
    expect(fired).toBe(1)
    s.ledger.close()
  })

  it('同岗不重叠：触发瞬间（onDue 回调内）再查 due 不见它', () => {
    const s = openStack('no-overlap')
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() }))
    let seenDueInCallback = -1
    const sched = createScheduler({
      ledger: s.ledger,
      clock: s.clock.now,
      onDue: (_j, _at) => {
        // markRan 已先行——回调视角该岗不再 due（单语句原子，无中间态）
        seenDueInCallback = s.ledger.dueJobs(s.clock.now()).filter((j) => j.job_id === 'j1').length
      },
      intervalMs: 1000,
    })
    sched.poll()
    expect(seenDueInCallback).toBe(0)
    // 立即重查（另一并发视角）同样不见
    expect(s.ledger.dueJobs(s.clock.now())).toHaveLength(0)
    s.ledger.close()
  })

  it('多岗同拍齐触发（dueJobs 升序），互不影响', () => {
    const s = openStack('multi')
    s.ledger.upsertJob(job({ job_id: 'j-b', next_run_at: s.clock.now() - 5_000 }))
    s.ledger.upsertJob(job({ job_id: 'j-a', next_run_at: s.clock.now() - 10_000 }))
    const order: string[] = []
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: (j) => order.push(j.job_id), intervalMs: 1000 })
    const report = sched.poll()
    expect(report).toMatchObject({ due: 2, fired: 2 })
    expect(order).toEqual(['j-a', 'j-b']) // next_run_at 升序
    expect(sched.poll().fired).toBe(0)
    s.ledger.close()
  })
})

// ————————————————————————— 坏 cron 隔离 —————————————————————————

describe('调度器：坏 cron 隔离（不炸调度器、不挡他岗）', () => {
  it('坏表达式：计数+隔离窗推后+last_run_at 不动，他岗照常触发', () => {
    const s = openStack('bad-cron')
    const logs: string[] = []
    s.ledger.upsertJob(job({ job_id: 'bad', cron: '61 25 * * *', next_run_at: s.clock.now() }))
    s.ledger.upsertJob(job({ job_id: 'good', next_run_at: s.clock.now() }))
    const fired: string[] = []
    const sched = createScheduler({
      ledger: s.ledger,
      clock: s.clock.now,
      onDue: (j) => fired.push(j.job_id),
      intervalMs: 1000,
      quarantineMs: 60_000,
      log: (l) => logs.push(l),
    })
    const report = sched.poll()
    expect(fired).toEqual(['good']) // 他岗照常
    expect(report.cronErrors).toBe(1)
    expect(report.fired).toBe(1)
    expect(sched.stats.cronErrors).toBe(1)
    expect(sched.stats.lastCronError?.job_id).toBe('bad')
    expect(logs.join('\n')).toContain('bad')
    const row = s.ledger.getJob('bad')
    expect(row?.next_run_at).toBe(s.clock.now() + 60_000) // 隔离窗
    expect(row?.last_run_at).toBeUndefined() // 不伪造跑史
    s.ledger.close()
  })

  it('无未来槽（null）同隔离路径', () => {
    const s = openStack('null-cron')
    s.ledger.upsertJob(job({ job_id: 'never', cron: '0 0 31 2 *', next_run_at: s.clock.now() }))
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => undefined, intervalMs: 1000, quarantineMs: 1000 })
    const report = sched.poll()
    expect(report.cronErrors).toBe(1)
    expect(report.fired).toBe(0)
    expect(sched.stats.lastCronError?.message).toContain('无未来槽')
    s.ledger.close()
  })

  it('隔离窗到期重新可见、再隔离（计数累加）；窗内不可见', () => {
    const s = openStack('re-quarantine')
    s.ledger.upsertJob(job({ job_id: 'bad', cron: 'not a cron', next_run_at: s.clock.now() }))
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => undefined, intervalMs: 1000, quarantineMs: 1000 })
    sched.poll()
    expect(sched.poll().cronErrors).toBe(0) // 窗内不可见
    s.clock.advance(1000) // 到期
    expect(sched.poll().cronErrors).toBe(1) // 再隔离再计数
    expect(sched.stats.cronErrors).toBe(2)
    s.ledger.close()
  })

  it('轮询体异常被吞不炸循环（下一拍照常）', async () => {
    const s = openStack('poll-crash')
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() }))
    const logs: string[] = []
    let polls = 0
    // 注入会在第二次 poll 抛错的时钟面：用坏 job 打穿 poll 内部路径之外的异常面
    const sched = createScheduler({
      ledger: s.ledger,
      clock: (): number => {
        polls += 1
        if (polls === 2) throw new Error('时钟炸了（注入）')
        return s.clock.now()
      },
      onDue: () => undefined,
      intervalMs: 5,
      log: (l) => logs.push(l),
    })
    sched.start()
    await new Promise((r) => setTimeout(r, 30))
    sched.stop()
    expect(logs.join('\n')).toContain('轮询异常')
    // stop 后仍可手动泵（状态未坏）
    expect(() => sched.poll()).not.toThrow()
    s.ledger.close()
  })
})

// ————————————————————————— 热更 —————————————————————————

describe('调度器：热更（无状态轮询天然生效）', () => {
  it('单岗新增/覆盖下一拍生效，他岗不动', () => {
    const s = openStack('hot-update')
    s.ledger.upsertJob(job({ job_id: 'j-a', next_run_at: s.clock.now() }))
    const fired: string[] = []
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: (j) => fired.push(j.job_id), intervalMs: 1000 })
    sched.poll()
    expect(fired).toEqual(['j-a'])
    // 热更：新增 j-b（立即 due）；j-a 改 cron 但 next 未到（下一槽）
    s.ledger.upsertJob(job({ job_id: 'j-b', next_run_at: s.clock.now() }))
    s.ledger.upsertJob({ ...job({ job_id: 'j-a', cron: '0 4 * * *', next_run_at: s.clock.now() + 3_600_000 }) })
    s.clock.advance(1)
    const report = sched.poll()
    expect(report.fired).toBe(1)
    expect(fired).toEqual(['j-a', 'j-b']) // 只新岗触发，j-a 不动
    s.ledger.close()
  })

  it('markRan 时行已消失（热更移除）不回调、不炸', () => {
    const s = openStack('vanish')
    s.ledger.upsertJob(job({ job_id: 'j-first', next_run_at: s.clock.now() - 10_000 }))
    s.ledger.upsertJob(job({ job_id: 'j-gone', next_run_at: s.clock.now() }))
    const fired: string[] = []
    const logs: string[] = []
    const sched = createScheduler({
      ledger: s.ledger,
      clock: s.clock.now,
      onDue: (j) => {
        fired.push(j.job_id)
        if (j.job_id === 'j-first') s.ledger.removeJob('j-gone') // 触发回调里热更移除第二岗
      },
      intervalMs: 1000,
      log: (l) => logs.push(l),
    })
    const report = sched.poll()
    expect(fired).toEqual(['j-first'])
    expect(report.fired).toBe(1)
    expect(logs.join('\n')).toContain('消失')
    expect(s.ledger.getJob('j-gone')).toBeUndefined()
    s.ledger.close()
  })
})

// ————————————————————————— 生命周期 —————————————————————————

describe('调度器：start/stop 生命周期（SIGINT 停机同收口）', () => {
  it('start 后按 intervalMs 轮询；stop 后不再触发；stop 幂等；停后可再起；运行中重入明报', async () => {
    const s = openStack('lifecycle')
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() }))
    const fired: number[] = []
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => fired.push(1), intervalMs: 10 })
    expect(sched.running).toBe(false)
    sched.start()
    expect(sched.running).toBe(true)
    await new Promise((r) => setTimeout(r, 60))
    expect(fired.length).toBeGreaterThanOrEqual(1)
    sched.stop()
    expect(sched.running).toBe(false)
    const count = fired.length
    await new Promise((r) => setTimeout(r, 40))
    expect(fired.length).toBe(count) // 停后不再触发（干净）
    expect(() => sched.stop()).not.toThrow() // 幂等
    sched.start() // 停后可再起（serve 重启路径同语义）
    expect(sched.running).toBe(true)
    expect(() => sched.start()).toThrow(/不可重入/) // 运行中重入明报
    sched.stop()
    s.ledger.close()
  })
})

// ————————————————————————— schedule 意图 → 引擎全链 —————————————————————————

describe('schedule 意图：ingest → 物化岗单据 → decide → 派发全链', () => {
  let stack: EngineStack

  beforeAll(() => {
    stack = buildEngineStack('intent-chain')
    stack.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: 1 }))
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('调度器到点 → schedule 意图（形态与 dedupKey 契合 22-§二）', () => {
    const j = stack.ledger.getJob('health-patrol') as JobRecord
    const i = scheduleIntent(j, 12345)
    expect(i).toEqual({
      kind: 'schedule',
      company: 'demo',
      payload: { job_id: 'health-patrol' },
      source: 'scheduler',
      dedupKey: 'health-patrol@12345',
      priority: 2,
    })
  })

  it('tick1：意图物化岗单据（PATROL 留痕 + 平台建单）且同拍 DISPATCH（L0 无审批环）', async () => {
    stack.engine.ingest([intent('health-patrol', stack.clock.now())])
    expect(stack.engine.pendingIntents).toBe(1)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.stateDiff.candidates).toBe(1)
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.events.map((e) => e.event)).toEqual(['PATROL', 'DISPATCH'])

    // 岗单据形态：type task、level 0（L0 流）、dept=job.dept、assignee=job.role
    const ticket = (await stack.platform.issues.list({})).find((i) => i.title.includes('health-patrol'))
    expect(ticket).toBeDefined()
    expect(ticket?.type).toBe('task')
    expect(ticket?.level).toBe(0)
    expect(ticket?.dept).toBe('departments/工程部')
    expect(ticket?.assignee).toBe('AGENT-1')
    expect(ticket?.state).toBe('已派发')

    // PATROL 留痕（携 intent 键——重投不重跑的幂等索引）+ DISPATCH 携 schedule 意图键
    const patrol = eventsOf(stack.ledger, 'PATROL')[0]
    expect(patrol?.issue).toBe(ticket?.id)
    expect(patrol?.note).toContain('job=health-patrol')
    expect(patrol?.note).toContain('intent=scheduler|schedule|demo|health-patrol@')
    const dispatch = eventsOf(stack.ledger, 'DISPATCH')[0]
    expect(dispatch?.note).toContain('intent=scheduler|schedule|demo|health-patrol@')
    // work_records 在途（fake executor，AGENTS.md 装配落盘）
    expect(stack.ledger.listWorkRecords({ issue: ticket?.id ?? '' })).toHaveLength(1)
  })

  it('tick2-5：收割链走完——GATE_PASS → QA_PASS → MERGE → CLOSE（结果落台账）', async () => {
    for (let i = 0; i < 4; i += 1) {
      stack.clock.advance(1000)
      await stack.engine.tick()
    }
    const patrol = eventsOf(stack.ledger, 'PATROL')[0]
    const chain = stack.ledger.queryEvents({ issue: patrol?.issue ?? '' }).map((e) => e.event)
    // PATROL 与 DISPATCH 同拍同 ts——台账排序 (ts,id) 的 id 平局随机，两序皆合法（因果不变）
    expect(chain.slice(0, 2).sort()).toEqual(['DISPATCH', 'PATROL'])
    expect(chain.slice(2)).toEqual(['GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE'])
    const record = stack.ledger.listWorkRecords({ issue: patrol?.issue ?? '' })[0]
    expect(record?.status).toBe('done')
    expect(record?.report_ref).toMatch(/REPORT\.md$/)
    expect(existsSync(record?.report_ref ?? '')).toBe(true)
  })

  it('同键意图重复投递只物化一次（拍内去重）；收口后重投也不重跑（PATROL 键不释放）', async () => {
    // 拍内去重：同键双投只物化一张岗单据
    stack.engine.ingest([intent('health-patrol', stack.clock.now()), intent('health-patrol', stack.clock.now())])
    stack.clock.advance(1000)
    let report = await stack.engine.tick()
    const patrols = eventsOf(stack.ledger, 'PATROL').length
    expect(report.errors).toEqual([])
    // 第二张岗单据走完链（为下一段重投做准备）：物化拍即派发，收割链 4 拍
    for (let i = 0; i < 4; i += 1) {
      stack.clock.advance(1000)
      await stack.engine.tick()
    }
    // 收口后重投同键（模拟源 at-least-once 重发）：PATROL 键 append-only 不释放——不重跑
    const firedAtSame = eventsOf(stack.ledger, 'PATROL')[0]
    const key = /dedup=([^;]+)/.exec(firedAtSame?.note ?? '')?.[1]
    expect(key).toBeDefined()
    stack.engine.ingest([
      {
        kind: 'schedule',
        company: 'demo',
        payload: { job_id: 'health-patrol' },
        source: 'scheduler',
        dedupKey: key as string,
        priority: 2,
      },
    ])
    stack.clock.advance(1000)
    report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(eventsOf(stack.ledger, 'PATROL')).toHaveLength(patrols)
  })
})

describe('schedule 意图：幂等与重启重放', () => {
  it('重启重放（新引擎同台账）：派发在途的意图键已消费——不双开岗单据', async () => {
    const s1 = buildEngineStack('replay')
    s1.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: 1 }))
    s1.engine.ingest([intent('health-patrol', s1.clock.now())])
    const t1 = await s1.engine.tick() // 物化 + DISPATCH（在途）

    // 「重启」：同台账/平台新建引擎，重放同键意图
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    const engine2 = createEngine({
      platform: s1.platform,
      ledger: s1.ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.4-test',
        frameworkPrompts: 'x',
        snapshot: DEMO_SNAPSHOT,
        acceptance: [],
        docRefs: [],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: s1.clock.now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: 'demo',
        rootDir: path.join(root, 'replay'),
        defaultPersonId: DEMO_SNAPSHOT.people[0]?.id ?? 'AGENT-1',
      },
      people: DEMO_SNAPSHOT.people,
    })
    engine2.ingest([intent('health-patrol', t1.ts.start)])
    s1.clock.advance(1000)
    const t2 = await engine2.tick()
    const patrols = eventsOf(s1.ledger, 'PATROL')
    expect(patrols).toHaveLength(1) // 不双开（PATROL 键已留痕）
    expect(t2.errors).toEqual([])
    s1.ledger.close()
  })
})

describe('schedule 意图：明报路径（不静默）', () => {
  it('unknown job_id → errors 明报、无岗单据', async () => {
    const s = buildEngineStack('unknown-job')
    s.engine.ingest([intent('ghost-job', s.clock.now())])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('ghost-job')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('公司不匹配 → errors 明报', async () => {
    const s = buildEngineStack('company-mismatch')
    s.engine.ingest([intent('j1', s.clock.now(), 'other-co')])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('公司不匹配')
    s.ledger.close()
  })

  it('非 schedule kind → errors 明报不支持', async () => {
    const s = buildEngineStack('kind-reject')
    s.engine.ingest([{ kind: 'mention', company: 'demo', source: 'test', dedupKey: 'm1' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("kind='mention' 不支持")
    s.ledger.close()
  })

  it('缺 dedupKey → errors 明报（无 ticket 意图必填）', async () => {
    const s = buildEngineStack('no-dedup')
    s.engine.ingest([{ kind: 'schedule', company: 'demo', payload: { job_id: 'j1' }, source: 'scheduler' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('dedupKey')
    s.ledger.close()
  })

  it('payload 缺 job_id → errors 明报', async () => {
    const s = buildEngineStack('no-jobid')
    s.engine.ingest([{ kind: 'schedule', company: 'demo', payload: {}, source: 'scheduler', dedupKey: 'k' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('job_id')
    s.ledger.close()
  })
})

// ————————————————————————— 调度器 × 引擎 × serve 接线 —————————————————————————

describe('serve 接线：配置面与播种', () => {
  it('parseDaemonConfig：jobs/jobPollMs 解析；缺省 jobs=false / jobPollMs=15000', () => {
    const base = 'db: ./x.sqlite\nplatform: fake\ncompany: demo\n'
    expect(parseDaemonConfig(base).jobs).toBe(false)
    expect(parseDaemonConfig(base).jobPollMs).toBe(15_000)
    const cfg = parseDaemonConfig(`${base}jobs: true\njobPollMs: 250\n`)
    expect(cfg.jobs).toBe(true)
    expect(cfg.jobPollMs).toBe(250)
    expect(() => parseDaemonConfig(`${base}jobs: yes\n`)).toThrow(/jobs/)
  })

  it('seedJobs：新岗 next_run_at=下一槽（不立即抢跑）', () => {
    const s = openStack('seed-new')
    const now = local(2026, 9, 16, 0, 2, 0)
    const r = seedJobs(s.ledger, DEMO_SNAPSHOT.jobs, now)
    expect(r.seeded).toBe(DEMO_SNAPSHOT.jobs.length)
    expect(r.kept).toBe(0)
    expect(s.ledger.getJob('health-patrol')?.next_run_at).toBe(local(2026, 9, 16, 0, 5, 0))
    expect(s.ledger.getJob('health-patrol')?.cron).toBe('*/5 * * * *')
    s.ledger.close()
  })

  it('seedJobs：既有岗保 next_run_at（欠账不清、重启补跑语义）且 last_run_at 不清零', () => {
    const s = openStack('seed-keep')
    const stale = local(2026, 9, 15, 23, 0, 0) // 昨夜欠账（已错过）
    s.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: stale, last_run_at: stale }))
    const now = local(2026, 9, 16, 0, 2, 0)
    const r = seedJobs(s.ledger, DEMO_SNAPSHOT.jobs, now)
    expect(r).toMatchObject({ seeded: 0, kept: 1 })
    const row = s.ledger.getJob('health-patrol')
    expect(row?.next_run_at).toBe(stale) // 欠账保留：首拍补跑一次
    expect(row?.last_run_at).toBe(stale) // 跑史不清
    // 首拍补跑（coalesce）后对齐新节奏
    s.clock.set(now)
    const sched = createScheduler({ ledger: s.ledger, clock: s.clock.now, onDue: () => undefined, intervalMs: 1000 })
    expect(sched.poll().fired).toBe(1)
    expect(s.ledger.getJob('health-patrol')?.next_run_at).toBe(local(2026, 9, 16, 0, 5, 0))
    s.ledger.close()
  })

  it('seedJobs：坏 cron 落隔离窗（调度器统一隔离路径）', () => {
    const s = openStack('seed-bad')
    const now = local(2026, 9, 16, 0, 0, 0)
    seedJobs(s.ledger, [{ ...DEMO_SNAPSHOT.jobs[0]!, job_id: 'broken', cron: '61 25 * * *' }], now)
    expect(s.ledger.getJob('broken')?.next_run_at).toBe(now + 60 * 60_000)
    s.ledger.close()
  })

  it('buildServeRuntime jobs=false：不起调度器；stop 后台账关闭', async () => {
    const s = openStack('runtime-off')
    const cfg: ServeConfig = { db: 'x', platform: 'fake', company: 'demo', rootDir: path.join(root, 'rt-off'), tickMs: 10, maxActionsPerTick: 4, maxInflight: 2, stallAfterMs: 1, laneTtlMs: 1, breakerThreshold: 3, autoApprove: true, jobs: false, jobPollMs: 10 }
    const rt = buildServeRuntime(cfg, s.ledger, DEMO_SNAPSHOT, { log: () => undefined })
    expect(rt.scheduler).toBeNull()
    await rt.stop()
    expect(() => s.ledger.listJobs()).toThrow()
  })

  it('buildServeRuntime jobs=true：播种+调度器起；调度到点→意图→引擎派发；stop 干净（SIGINT 同收口）', async () => {
    const s = openStack('runtime-on')
    const cfg: ServeConfig = { db: 'x', platform: 'fake', company: 'demo', rootDir: path.join(root, 'rt-on'), tickMs: 10, maxActionsPerTick: 4, maxInflight: 2, stallAfterMs: 1, laneTtlMs: 1, breakerThreshold: 3, autoApprove: true, jobs: true, jobPollMs: 10 }
    const rt = buildServeRuntime(cfg, s.ledger, DEMO_SNAPSHOT, { log: () => undefined, clock: s.clock.now })
    expect(rt.scheduler).not.toBeNull()
    expect(rt.scheduler?.running).toBe(false)

    // 手动泵：把样例岗拨到立即 due（保欠账语义），调度到点 → 意图入队
    s.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: s.clock.now() }))
    const report = rt.scheduler?.poll()
    expect(report?.fired).toBe(1)
    expect(rt.engine.pendingIntents).toBe(1)

    // 引擎消费：物化 + 派发（调度器×引擎全链）
    const tick = await rt.engine.tick()
    expect(tick.errors).toEqual([])
    expect(tick.phases.dispatch.dispatched).toBe(1)
    expect(tick.events.map((e) => e.event)).toEqual(['PATROL', 'DISPATCH'])

    await rt.stop()
    expect(rt.scheduler?.running).toBe(false)
    expect(() => s.ledger.listJobs()).toThrow() // 台账已关（干净停机）
  })

  it('demo 样例岗出厂即在快照（serve 无 companyDir 即跑 health-patrol）', () => {
    expect(DEMO_SNAPSHOT.jobs.map((j) => j.job_id)).toContain('health-patrol')
    expect(DEMO_SNAPSHOT.jobs[0]?.cron).toBe('*/5 * * * *')
  })
})

// ————————————————————————— 真进程冒烟：serve --config（jobs: on） —————————————————————————

describe('spawn 冒烟：studio-next serve（jobs: true，SIGINT 优雅停）', () => {
  it(
    '欠账岗启动补跑一次 → 意图 → 派发 → 收割 GATE_PASS 落台账；SIGINT 干净停（exit 0）',
    async () => {
      const { spawn } = await import('node:child_process')
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/bin.ts')
      const dir = path.join(root, 'serve-smoke')
      mkdirSync(dir, { recursive: true })
      const dbPath = path.join(dir, 'ledger.sqlite')
      // 预置欠账：health-patrol 的 next_run_at 远在过去（停机欠跑形）——seedJobs 保欠账，
      // 首拍补跑一次（18-§三 启动补跑 coalesce 的真进程面）
      const seed = openLedger(dbPath)
      seed.upsertJob(job({ job_id: 'health-patrol', cron: '*/5 * * * *', next_run_at: 1 }))
      seed.close()
      const configPath = path.join(dir, 'daemon.yaml')
      writeFileSync(
        configPath,
        [
          `db: ${dbPath}`,
          'platform: fake',
          'company: demo',
          `rootDir: ${dir}`,
          'tickMs: 150',
          'jobs: true',
          'jobPollMs: 300',
          'autoApprove: true',
        ].join('\n'),
        'utf8',
      )

      const child = spawn(process.execPath, [bin, 'serve', '--config', configPath], { encoding: 'utf8' })
      let stdout = ''
      child.stdout.on('data', (d: string) => {
        stdout += d
      })
      let stderr = ''
      child.stderr.on('data', (d: string) => {
        stderr += d
      })
      const exit = new Promise<number | null>((resolve) => {
        child.once('exit', (code) => resolve(code))
      })
      // 等收割拍（harvest=1/…——岗单据收割 GATE_PASS 落台账的运行面信号），上限 15s
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline && !/harvest=1\//.test(stdout)) {
        await new Promise((r) => setTimeout(r, 100))
      }
      child.kill('SIGINT')
      const code = await exit

      expect(code).toBe(0) // 信号优雅停（signal → exit 0）
      expect(stdout).toContain('jobs=on')
      expect(stdout).toContain('[scheduler] job health-patrol 到点')
      expect(stdout).toMatch(/harvest=1\//)
      expect(stderr).toBe('')

      // 台账验收：PATROL → DISPATCH → GATE_PASS 全链落账 + work_records 收口 done
      const ledger = openLedger(dbPath)
      const names = ledger.queryEvents().map((e) => e.event)
      expect(names).toContain('PATROL')
      expect(names).toContain('DISPATCH')
      expect(names).toContain('GATE_PASS')
      const patrol = ledger.queryEvents().find((e) => e.event === 'PATROL')
      expect(patrol?.note).toContain('job=health-patrol')
      const work = ledger.listWorkRecords()
      expect(work).toHaveLength(1)
      expect(work[0]?.status).toBe('done')
      expect(work[0]?.report_ref).toMatch(/REPORT\.md$/)
      // 调度面收口：跑史记账、next_run_at 已越过启动时刻（欠账清空、节奏对齐）
      const row = ledger.getJob('health-patrol')
      expect(row?.last_run_at).toBeGreaterThan(1)
      expect(row?.next_run_at).toBeGreaterThan(row.last_run_at as number)
      ledger.close()
    },
    30_000,
  )
})
