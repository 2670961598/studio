/**
 * jobs-lifecycle —— 岗位运作规格两新唤起源测试（docs/35-§3 首刀，制作人 2026-10-19 批复）
 *
 * 断言面（实现单口径逐条钉死，src/engine/jobs-sources.ts）：
 *   1. cadence 档位展开器：播种（档位→真 cron 进 jobs 表、next_run_at=下槽不抢跑、
 *      幂等 upsert 既有行保留）、热更（档位变更覆写 / 撤岗移除）、stop 移除自播种行
 *      （cron 直写岗零触碰——所有权边界）
 *   2. SLA/升级计时器三态（35-§3 幂等口径）：未超时不产 / 超时产 escalate 意图+ESCALATE
 *      落账（同单同档只告一次）/ 状态推进重置（ack 关窗、新 DISPATCH 新窗新键）
 *   3. ack 白名单边界：STALL/HEARTBEAT 不算应答；无 SLA 段的岗不计时；重启零内存态恢复
 *   4. 验收三证（docs/22-§三 延伸，两源各配）：
 *      ① 注册即生效（零改主循环——真引擎只用公面 ingest/pendingIntents/tick）
 *      ② 百重复只唤一次（cadence=百次重复展开同档位同槽一意图；sla=百次重扫同窗同档一告）
 *      ③ 关源零影响（注销任一源，其他源与主循环零影响）
 *   5. 集成链：档位岗 → cadence 播种 → 既有 scheduler 到点产 schedule 意图 → 引擎物化
 *      派发 → SLA 计时器超时产 escalate 意图（引擎消费门如实明报不支持——notify 端口下刀）
 *   6. serve 接线：cadence/sla 配置解析 + buildServeRuntime 注册面
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, InvokeIntent, ScheduledJob } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { makeUlid } from '../../src/engine/id.ts'
import {
  CADENCE_SOURCE_MANIFEST,
  CADENCE_SOURCE_NAME,
  createCadenceSource,
  createSlaSource,
  SLA_SOURCE_MANIFEST,
  SLA_SOURCE_NAME,
} from '../../src/engine/jobs-sources.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { createSchedulerSource, createSourceRegistry } from '../../src/engine/sources.ts'
import { buildServeRuntime, DEMO_SNAPSHOT, parseDaemonConfig } from '../../src/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo, d, h, mi, s, 0).getTime()
}

const T0 = local(2026, 9, 16, 0, 0, 0)

/** 台账栈（jobs-sources 单元面：独立 tmp 库 + 假时钟） */
function openStack(id: string, start = T0): { ledger: Ledger; clock: { now(): number; advance(ms: number): void } } {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = start
  return { ledger, clock: { now: (): number => t, advance: (ms: number): void => { t += ms } } }
}

/** 事件直写（SLA 扫描面的台账读语料）：PATROL 携 job= 锚（engine 物化口径同形） */
function appendEvt(
  ledger: Ledger,
  issue: string,
  event: EventRecord['event'],
  ts: number,
  opts?: { attempt?: number; note?: string },
): void {
  ledger.appendEvent({
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue,
    event,
    actor: 'test',
    attempt: opts?.attempt ?? 1,
    level: 1,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    ...(opts?.note !== undefined ? { note: opts.note } : {}),
  })
}

/** SLA 测试岗（payload 由 company toJobs 构造的同形语料） */
function slaJobRecord(job_id: string, payload: unknown): JobRecord {
  return {
    job_id,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload,
    next_run_at: 0,
  }
}

/** 档位岗快照语料（validator 展开后的同形：cron 已是真表达式 + payload 留档） */
const MONTHLY_JOB: ScheduledJob = {
  job_id: 'fin-monthly-close',
  company: 'demo',
  dept: 'departments/工程部',
  cron: '0 9 1 * *',
  role: 'AGENT-1',
  level: 2,
  model_tier: 'low',
  payload: { cadence_tier: 'monthly', cadence_at: 'd+1 09:00', outputs: ['月结报表'] },
}

/** 引擎测试栈（sources.test 同手法：fake 全家桶 + tmp 台账 + 假时钟——本文件零改 engine） */
function buildEngineStack(id: string): { ledger: Ledger; engine: Engine; clock: { now(): number; advance(ms: number): void } } {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = local(2026, 9, 16, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform: createFakePlatform({ now: () => new Date(t).toISOString() }),
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.8-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/35-§3（岗位运作规格）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { ledger, engine, clock }
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-jobs-lifecycle-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— cadence 档位展开器 —————————————————————————

describe('cadence 源：播种 / 幂等 / 热更 / 所有权', () => {
  it('start 即播种：档位→真 cron 进 jobs 表，next_run_at=下槽不抢跑；二次展开幂等（既有行保留 next_run_at）', () => {
    const s = openStack('cadence-seed')
    let jobs: readonly ScheduledJob[] = [MONTHLY_JOB]
    const src = createCadenceSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, jobs: () => jobs })
    src.start(() => undefined)
    const row = s.ledger.getJob('fin-monthly-close')
    expect(row?.cron).toBe('0 9 1 * *') // 装载期展开的真 cron（本源零解析）
    expect(row?.payload).toEqual(MONTHLY_JOB.payload)
    expect((row?.next_run_at ?? 0) > s.clock.now()).toBe(true) // 下槽不立即抢跑
    const firstNext = row?.next_run_at
    // 百次重复展开：仍一行、next_run_at 原样（欠账不清——seedJobs 同语义）
    for (let i = 0; i < 100; i += 1) src.expand()
    expect(s.ledger.listJobs()).toHaveLength(1)
    expect(s.ledger.getJob('fin-monthly-close')?.next_run_at).toBe(firstNext)
    expect(src.stats.seeded).toBe(1) // 只首播一次
    src.stop()
    s.ledger.close()
  })

  it('热更面：档位变更→cron 覆写；撤岗→removeJob；cron 直写岗零触碰（所有权边界）', () => {
    const s = openStack('cadence-hot')
    s.ledger.upsertJob({ ...slaJobRecord('plain-cron-job', { type: 'patrol' }), next_run_at: 1 })
    let jobs: readonly ScheduledJob[] = [MONTHLY_JOB]
    const src = createCadenceSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, jobs: () => jobs })
    src.expand()
    // 档位变更：monthly → daily（快照重装载的 getter 面）
    jobs = [{ ...MONTHLY_JOB, cron: '0 9 * * *', payload: { cadence_tier: 'daily' } }]
    const keptNext = s.ledger.getJob('fin-monthly-close')?.next_run_at
    const r2 = src.expand()
    expect(r2.kept).toBe(1)
    expect(s.ledger.getJob('fin-monthly-close')?.cron).toBe('0 9 * * *')
    expect(s.ledger.getJob('fin-monthly-close')?.next_run_at).toBe(keptNext) // 覆写不清欠账
    // 撤岗：getter 不再返回 → 自播种行移除；cron 直写岗不动
    jobs = []
    const r3 = src.expand()
    expect(r3.removed).toBe(1)
    expect(s.ledger.getJob('fin-monthly-close')).toBeUndefined()
    expect(s.ledger.getJob('plain-cron-job')).toBeDefined()
    src.stop()
    expect(s.ledger.getJob('plain-cron-job')).toBeDefined() // stop 也只动自播种集
    s.ledger.close()
  })

  it('stop 移除自播种行（启停源即启停档位岗）', () => {
    const s = openStack('cadence-stop')
    const src = createCadenceSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, jobs: () => [MONTHLY_JOB] })
    src.start(() => undefined)
    expect(s.ledger.getJob('fin-monthly-close')).toBeDefined()
    src.stop()
    expect(s.ledger.getJob('fin-monthly-close')).toBeUndefined()
    s.ledger.close()
  })
})

// ————————————————————————— SLA/升级计时器三态（35-§3 幂等口径） —————————————————————————

describe('SLA 计时器：超时 / 未超时 / 推进重置三态', () => {
  /** 标准语料：岗 qa-oncall（first-ack 15m + 链 1h→notify-prime）；单 T-1 已物化已派发 */
  function seedSlaStack(id: string): { ledger: Ledger; clock: ReturnType<typeof openStack>['clock']; dispatch: EventRecord } {
    const s = openStack(`sla-${id}`)
    s.ledger.upsertJob(
      slaJobRecord('qa-oncall', {
        sla: { first_ack_ms: 900_000 },
        escalate: [{ after_ms: 3_600_000, unacked: 'notify-prime' }],
      }),
    )
    appendEvt(s.ledger, 'T-1', 'PATROL', T0, { note: `intent=k;job=qa-oncall;dedup=d;来源=scheduler` })
    appendEvt(s.ledger, 'T-1', 'DISPATCH', T0 + 1_000)
    const dispatch = eventsOf(s.ledger, 'DISPATCH')[0] as EventRecord
    return { ledger: s.ledger, clock: s.clock, dispatch }
  }

  it('未超时：first-ack 窗内扫 → 零意图零落账', () => {
    const s = seedSlaStack('within')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    s.clock.advance(5 * 60_000) // T0+5m（窗 15m 内）
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(0)
    expect(r.inFlight).toBe(1) // 在途但未超时
    expect(got).toEqual([])
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(0)
    s.ledger.close()
  })

  it('超时：first-ack 档产 escalate 意图 + ESCALATE 落账；同档幂等（百次重扫只一告）+ 重启零内存态恢复', () => {
    const s = seedSlaStack('overdue')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    s.clock.advance(16 * 60_000) // T0+16m（first-ack 15m 已破）
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(1)
    const intent = got[0]
    expect(intent).toMatchObject({
      kind: 'escalate',
      company: 'demo',
      ticket: 'T-1',
      source: SLA_SOURCE_NAME,
      dedupKey: `sla:T-1@${s.dispatch.id}#first-ack`,
      priority: 3,
    })
    expect(intent?.payload).toMatchObject({ ticket: 'T-1', job_id: 'qa-oncall', tier: 'first-ack', opened_at: T0 + 1_000, due_at: T0 + 1_000 + 900_000 })
    const evt = eventsOf(s.ledger, 'ESCALATE')
    expect(evt).toHaveLength(1)
    expect(evt[0]?.note).toContain(`src=${SLA_SOURCE_NAME}`)
    expect(evt[0]?.note).toContain(`anchor=${s.dispatch.id}`)
    expect(evt[0]?.note).toContain('tier=first-ack')
    expect(evt[0]?.attempt).toBe(s.dispatch.attempt)
    // 百次重扫同窗同档：只告一次（幂等——docs/22-§三.2 延伸口径）
    for (let i = 0; i < 100; i += 1) src.poll((i2) => got.push(i2))
    expect(got).toHaveLength(1)
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(1)
    // 重启（新源实例，零内存态）：已告集从 events 派生 → 不重告
    const src2 = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    expect(src2.poll((i2) => got.push(i2)).fired).toBe(0)
    expect(got).toHaveLength(1)
    s.ledger.close()
  })

  it('升级链档独立计时：first-ack 后 chain-0 档（1h→notify-prime）到点另告，payload 透传 unacked', () => {
    const s = seedSlaStack('chain')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    s.clock.advance(16 * 60_000)
    src.poll((i) => got.push(i)) // first-ack 告
    s.clock.advance(45 * 60_000) // T0+61m：chain-0（1h）到点
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(1)
    expect(got[1]).toMatchObject({
      kind: 'escalate',
      ticket: 'T-1',
      dedupKey: `sla:T-1@${s.dispatch.id}#chain-0`,
    })
    expect(got[1]?.payload).toMatchObject({ tier: 'chain-0', unacked: 'notify-prime' })
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(2)
    s.ledger.close()
  })

  it('推进重置：ack（GATE_PASS）关窗不再告；新 DISPATCH 开新窗——同档再告（新锚新键位）', () => {
    const s = seedSlaStack('reset')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    s.clock.advance(16 * 60_000)
    src.poll((i) => got.push(i)) // first-ack 告（第 1 次）
    // 状态推进：GATE_PASS=应答 → 关窗；此后再扫零告
    appendEvt(s.ledger, 'T-1', 'GATE_PASS', s.clock.now())
    s.clock.advance(30 * 60_000)
    expect(src.poll((i) => got.push(i)).fired).toBe(0)
    // 新一轮派发（attempt 2）开新窗：first-ack 再超时 → 再告（推进后重置）
    appendEvt(s.ledger, 'T-1', 'DISPATCH', s.clock.now(), { attempt: 2 })
    const anchor2 = eventsOf(s.ledger, 'DISPATCH')[1] as EventRecord
    s.clock.advance(16 * 60_000)
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(1)
    expect(got[1]?.dedupKey).toBe(`sla:T-1@${anchor2.id}#first-ack`) // 新锚=新键位（旧告不抑制）
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(2)
    s.ledger.close()
  })

  it('ack 边界：STALL（静默告警）与 HEARTBEAT 不算应答——超时照告；无 SLA 段的岗不计时', () => {
    const s = openStack('sla-ack-edge')
    s.ledger.upsertJob(slaJobRecord('stalling-job', { sla: { first_ack_ms: 900_000 } }))
    s.ledger.upsertJob(slaJobRecord('no-sla-job', { type: 'patrol' }))
    appendEvt(s.ledger, 'T-2', 'PATROL', T0, { note: 'job=stalling-job' })
    appendEvt(s.ledger, 'T-2', 'DISPATCH', T0 + 1_000)
    appendEvt(s.ledger, 'T-2', 'STALL', T0 + 2_000) // 静默告警≠应答
    appendEvt(s.ledger, 'T-3', 'PATROL', T0, { note: 'job=no-sla-job' })
    appendEvt(s.ledger, 'T-3', 'DISPATCH', T0 + 1_000)
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    s.clock.advance(20 * 60_000)
    const r = src.poll((i) => got.push(i))
    expect(r.fired).toBe(1) // 只有 stalling-job 告
    expect(r.inFlight).toBe(1) // no-sla-job 不计时
    expect(got[0]?.ticket).toBe('T-2')
    s.ledger.close()
  })

  it('普通单（无 job 映射）不在扫描面——oncall/subscribe 订阅路由下刀', () => {
    const s = openStack('sla-plain-ticket')
    appendEvt(s.ledger, 'T-9', 'DISPATCH', T0 + 1_000)
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    s.clock.advance(60 * 60_000)
    expect(src.poll(() => undefined).fired).toBe(0)
    s.ledger.close()
  })
})

// ————————————————————————— 验收三证（docs/22-§三 延伸：两新源各配） —————————————————————————

describe('验收三证 · cadence 源', () => {
  it('证① 注册即生效：真引擎公面 + 注册表——档位岗经既有 scheduler 到点产 schedule 意图→物化派发（engine 零改）', async () => {
    const stack = buildEngineStack('acc-cadence-1')
    const got: InvokeIntent[] = []
    const cadence = createCadenceSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, jobs: () => [MONTHLY_JOB] })
    const scheduler = createSchedulerSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, sink: (i) => got.push(i) })
    const reg = createSourceRegistry()
    reg.register(cadence, CADENCE_SOURCE_MANIFEST)
    reg.register(scheduler)
    reg.startAll((i) => { got.push(i); stack.engine.ingest([i]) })
    expect(stack.ledger.getJob('fin-monthly-close')).toBeDefined() // 注册即播种
    // 到点（测试面直接置 due——sources.test 同手法）：既有调度器 tick 产 schedule 意图
    //（start 后经注册表 emit——与 sink 同指一队列，src/engine/sources.ts 头注）
    const row = stack.ledger.getJob('fin-monthly-close') as JobRecord
    stack.ledger.upsertJob({ ...row, next_run_at: stack.clock.now() })
    scheduler.scheduler.poll()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'schedule', payload: { job_id: 'fin-monthly-close' } })
    expect(stack.engine.pendingIntents).toBe(1)
    const tick = await stack.engine.tick()
    expect(tick.phases.dispatch.dispatched).toBe(1) // 主循环照常唤起（源零直驱）
    expect(eventsOf(stack.ledger, 'PATROL')).toHaveLength(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('证② 百重复意图只唤一次：百次重复展开 + 到点百次泵 → 一意图一物化一派发', async () => {
    const stack = buildEngineStack('acc-cadence-2')
    const got: InvokeIntent[] = []
    const cadence = createCadenceSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, jobs: () => [MONTHLY_JOB] })
    const scheduler = createSchedulerSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, sink: (i) => got.push(i) })
    cadence.start(() => undefined)
    for (let i = 0; i < 100; i += 1) cadence.expand() // 百次重复展开（同档位同 tick 幂等）
    const row = stack.ledger.getJob('fin-monthly-close') as JobRecord
    stack.ledger.upsertJob({ ...row, next_run_at: stack.clock.now() })
    for (let i = 0; i < 100; i += 1) scheduler.scheduler.poll() // 到点后百次泵
    expect(got).toHaveLength(1) // markRan 前向不变式：一槽一意图
    for (let i = 0; i < 100; i += 1) stack.engine.ingest(got as InvokeIntent[]) // 百重复意图入队
    await stack.engine.tick()
    expect(eventsOf(stack.ledger, 'PATROL')).toHaveLength(1) // 只物化一次
    expect(eventsOf(stack.ledger, 'DISPATCH')).toHaveLength(1) // 只唤起一次
    cadence.stop()
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('证③ 关源零影响：注销 cadence 源（自播种行移除）——scheduler 照常产意图、cron 直写岗照跑', () => {
    const s = openStack('acc-cadence-3')
    s.ledger.upsertJob({ ...slaJobRecord('plain-job', undefined), next_run_at: s.clock.now() })
    const got: InvokeIntent[] = []
    const cadence = createCadenceSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, jobs: () => [MONTHLY_JOB] })
    const scheduler = createSchedulerSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, sink: (i) => got.push(i) })
    const reg = createSourceRegistry()
    reg.register(cadence, CADENCE_SOURCE_MANIFEST)
    reg.register(scheduler)
    reg.startAll((i) => got.push(i)) // start 后手动泵经注册表 emit（liveEmit 接管 sink 同队列）
    expect(s.ledger.listJobs()).toHaveLength(2) // 档位岗 + cron 直写岗
    expect(reg.unregister(CADENCE_SOURCE_NAME)).toBe(true)
    expect(s.ledger.getJob('fin-monthly-close')).toBeUndefined() // 档位岗随源停（自身域）
    // 其他源与主循环零影响：cron 直写岗到点照产意图
    s.clock.advance(1)
    scheduler.scheduler.poll()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'schedule', payload: { job_id: 'plain-job' } })
    expect(reg.stats.started).toBe(1) // scheduler 仍在
    expect(reg.stats.sourceErrors).toBe(0)
    s.ledger.close()
  })
})

describe('验收三证 · SLA 计时器源', () => {
  function seedDueStack(id: string): { ledger: Ledger; clock: ReturnType<typeof openStack>['clock']; dispatch: EventRecord } {
    const s = openStack(`acc-sla-${id}`)
    s.ledger.upsertJob(slaJobRecord('qa-oncall', { sla: { first_ack_ms: 900_000 } }))
    appendEvt(s.ledger, 'T-1', 'PATROL', T0, { note: 'job=qa-oncall' })
    appendEvt(s.ledger, 'T-1', 'DISPATCH', T0 + 1_000)
    s.clock.advance(20 * 60_000) // 已超时未应答
    return { ledger: s.ledger, clock: s.clock, dispatch: eventsOf(s.ledger, 'DISPATCH')[0] as EventRecord }
  }

  it('证① 注册即生效：注册表 startAll 接 emit——手动泵一拍即产 escalate 意图（零改主循环）', () => {
    const s = seedDueStack('1')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const reg = createSourceRegistry()
    reg.register(src, SLA_SOURCE_MANIFEST)
    const got: InvokeIntent[] = []
    reg.startAll((i) => got.push(i)) // serve 同形接线
    src.poll() // 手动泵（liveEmit=注册表注入的 emit）
    expect(got).toHaveLength(1)
    expect(got[0]?.kind).toBe('escalate')
    reg.stopAll()
    s.ledger.close()
  })

  it('证② 百重复只告一次：同窗同档百次重扫 → 一意图一落账（异窗不殃及——新锚新告）', () => {
    const s = seedDueStack('2')
    const src = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const got: InvokeIntent[] = []
    for (let i = 0; i < 100; i += 1) src.poll((i2) => got.push(i2))
    expect(got).toHaveLength(1)
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(1)
    // 异窗不殃及：新单 T-4 同岗新窗 → 到点照告
    appendEvt(s.ledger, 'T-4', 'PATROL', s.clock.now(), { note: 'job=qa-oncall' })
    appendEvt(s.ledger, 'T-4', 'DISPATCH', s.clock.now() + 1_000)
    s.clock.advance(16 * 60_000)
    expect(src.poll((i2) => got.push(i2)).fired).toBe(1)
    expect(got).toHaveLength(2)
    s.ledger.close()
  })

  it('证③ 关源零影响：注销 sla-timer——scheduler 源照常产意图、停源后不再告', () => {
    const s = openStack('acc-sla-3')
    s.ledger.upsertJob({ ...slaJobRecord('qa-oncall', { sla: { first_ack_ms: 900_000 } }), next_run_at: s.clock.now() + 3_600_000 }) // 不占 due 面
    s.ledger.upsertJob({ ...slaJobRecord('plain-job', undefined), next_run_at: s.clock.now() })
    appendEvt(s.ledger, 'T-1', 'PATROL', T0, { note: 'job=qa-oncall' })
    appendEvt(s.ledger, 'T-1', 'DISPATCH', T0 + 1_000)
    s.clock.advance(20 * 60_000)
    const got: InvokeIntent[] = []
    const sla = createSlaSource({ ledger: s.ledger, clock: s.clock.now, company: 'demo', intervalMs: 60_000 })
    const scheduler = createSchedulerSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 60_000, sink: (i) => got.push(i) })
    const reg = createSourceRegistry()
    reg.register(sla, SLA_SOURCE_MANIFEST)
    reg.register(scheduler)
    reg.startAll((i) => got.push(i)) // start 后手动泵经注册表 emit（liveEmit 接管 sink 同队列）
    expect(reg.unregister(SLA_SOURCE_NAME)).toBe(true)
    // 其他源零影响：scheduler 到点照产
    s.clock.advance(1)
    scheduler.scheduler.poll()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'schedule' })
    // 停源不再告：无 liveEmit 的泵零产出零落账
    s.clock.advance(60 * 60_000)
    expect(sla.poll().fired).toBe(0)
    expect(eventsOf(s.ledger, 'ESCALATE')).toHaveLength(0)
    s.ledger.close()
  })
})

// ————————————————————————— 集成链 + serve 接线 —————————————————————————

describe('集成链：档位岗 → scheduler → 引擎派发 → SLA 超时 escalate（消费门如实明报）', () => {
  it('全链：escalate 意图进 ingest——引擎明报 kind 不支持（notify 端口下刀）、ESCALATE 已落账', async () => {
    const stack = buildEngineStack('integrate')
    const OPS_JOB: ScheduledJob = {
      job_id: 'ops-patrol',
      company: 'demo',
      dept: 'departments/工程部',
      cron: '*/5 * * * *',
      role: 'AGENT-1',
      level: 2,
      model_tier: 'low',
      payload: { cadence_tier: 'hourly', sla: { first_ack_ms: 900_000 } },
    }
    const cadence = createCadenceSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, jobs: () => [OPS_JOB] })
    const scheduler = createSchedulerSource({ ledger: stack.ledger, clock: stack.clock.now, intervalMs: 60_000, sink: () => undefined })
    const sla = createSlaSource({ ledger: stack.ledger, clock: stack.clock.now, company: 'demo', intervalMs: 60_000 })
    const reg = createSourceRegistry()
    reg.register(cadence, CADENCE_SOURCE_MANIFEST)
    reg.register(scheduler)
    reg.register(sla, SLA_SOURCE_MANIFEST)
    reg.startAll((i) => stack.engine.ingest([i]))
    // 档位岗到点（置 due）→ schedule 意图 → 引擎物化+派发
    const row = stack.ledger.getJob('ops-patrol') as JobRecord
    stack.ledger.upsertJob({ ...row, next_run_at: stack.clock.now() })
    scheduler.scheduler.poll()
    const tick1 = await stack.engine.tick()
    expect(tick1.phases.dispatch.dispatched).toBe(1)
    expect(eventsOf(stack.ledger, 'DISPATCH')).toHaveLength(1)
    // first-ack 窗超时（fake worker 尚未收割——未应答）→ SLA 计时器告
    const got: InvokeIntent[] = []
    stack.clock.advance(16 * 60_000)
    const r = sla.poll((i) => got.push(i))
    expect(r.fired).toBe(1)
    expect(got[0]?.ticket).toBe(eventsOf(stack.ledger, 'PATROL')[0]?.issue)
    // escalate 意图进主循环：消费门如实明报（escalate 消费+notify 发送归 notify 端口后续刀）
    stack.engine.ingest(got as InvokeIntent[])
    const tick2 = await stack.engine.tick()
    expect(tick2.errors.join('\n')).toContain("kind='escalate' 不支持")
    const escalates = eventsOf(stack.ledger, 'ESCALATE').filter((e) => e.note?.includes(`src=${SLA_SOURCE_NAME}`))
    expect(escalates).toHaveLength(1) // 落账在源侧（只产意图+落账口径）
    reg.stopAll()
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('serve 接线：cadence / sla 配置与注册面', () => {
  it('parseDaemonConfig：cadence/sla 布尔键收面', () => {
    const cfg = parseDaemonConfig(['db: ./var/x.sqlite', 'cadence: true', 'sla: true'].join('\n'))
    expect(cfg.cadence).toBe(true)
    expect(cfg.sla).toBe(true)
    const dflt = parseDaemonConfig('db: ./var/x.sqlite')
    expect(dflt.cadence).toBe(false) // 缺省关（既有语义零变更）
    expect(dflt.sla).toBe(false)
  })

  it('buildServeRuntime：cadence+sla 开 → 注册表含两源（manifest kind 对齐）', async () => {
    const ledger = openLedger(path.join(root, 'serve-wiring.sqlite'))
    const rt = buildServeRuntime(
      { ...parseDaemonConfig(['db: ./var/x.sqlite', 'jobs: true', 'cadence: true', 'sla: true'].join('\n')), rootDir: path.join(root, 'serve-wiring-ws') },
      ledger,
      DEMO_SNAPSHOT,
      { log: () => undefined, clock: (): number => T0 },
    )
    const names = rt.sources.list().map((e) => e.source.name)
    expect(names).toContain(CADENCE_SOURCE_NAME)
    expect(names).toContain(SLA_SOURCE_NAME)
    expect(rt.sources.list().find((e) => e.source.name === CADENCE_SOURCE_NAME)?.manifest).toEqual(CADENCE_SOURCE_MANIFEST)
    expect(rt.sources.list().find((e) => e.source.name === SLA_SOURCE_NAME)?.manifest?.kind).toBe('escalate')
    await rt.stop()
  })
})
