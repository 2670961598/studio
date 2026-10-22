/**
 * schedule-report-priority —— studio-dev-200 回归（红→绿纪律：先红证后修法）
 *
 * 缺陷（2026-10-22，daemon-taiga17 双实证）：report 型定时岗（daily-report 18:00:15 /
 * hf-finance 20:00:03）物化（PATROL 落账）后派发段静默失联——190 卡新单 +10h50m、
 * 194 卡 +8h59m54s，日结出窗（2026-10-23-report-综合部-studio-dev-194 G-10 同结论：
 * 「19 次研发部 level-2 派发（17 单）连续先行 ~9h」）。
 *
 * 机制（对照组 taiga16 134/140 同秒 PATROL→DISPATCH 的差异面=队列态非代码差）：
 *   - schedule 意图 priority=2（scheduler.ts 源侧口径）只活在**物化拍**的候选面：
 *     物化拍 issueById 快照先于物化（相位 1 取数）→ 相位 2 触钟环对拍内新单盲视
 *     （engine.ts touch 环 `issueById.get(cand.ticket)` undefined 直跳）；
 *   - 物化拍若派发被闸顺延（实证：18:00:15 core 泳道被 167 号在工租约占道至 18:10:35
 *     → HOLD_LANE_BUSY——hold 无台账事件无 noop 行，观测面全静默），意图即耗尽，p2
 *     随拍蒸发；
 *   - 此后单只能靠 activity(p1)/mirror rescan(p0) 意图重进队列：携带峰种在 p1/p0、
 *     FIFO 锚又最年轻 → 排全队尾。单泳道（laneTtlMs 死主回收 30min 一发）× 19 单积压
 *     （taiga17 实况 18:10→04:50 连续先行 19 发）= 定时岗结构性饥饿。
 *   - escalate 消费件（intents/escalate.ts，129-D studio-dev-181）对同形「物化拍盲区」
 *     已有解法：touch 登记 pendingQueuePriority → settlePendingQueuePriority 延拍并入
 *     携带峰。schedule 消费件漏接同一机制——本单补齐（129-§6.2 R4「高优意图只改下一拍
 *     派发顺序」的源侧义务，不引入抢占；129-D「成员资格落地拍并入携带峰」的种钟面
 *     一并补全——零活动平台（Taiga 真机：daemon 自身迁移不回流活动流）首个成员拍
 *     无候选时 pending 直删=峰值丢地板）。
 *
 * 断言面（红→绿，两世界各钉一面）：
 *   1. 双岗同拍到（18:00 事况复刻）：巡查岗物化即终态（PATROL+CLOSE 同拍、零派发、
 *      零工时）＋report 岗物化（PATROL）——泳道被在工租约占道时 HOLD_LANE_BUSY
 *      （无事件无产物，「物化后不派发」观测面对齐 190/194 实况）；
 *   2. 泳道租约到期后的首个可派发拍：report 岗必须**先于**同分低优积压单（FIFO 先到
 *      者）获得 DISPATCH（红证：修复前 report 回落 p0/p1 + FIFO 最年轻 → 先发的恒是
 *      积压单，190 实况 19 发先行同型）；
 *   3. todo_queue 投影：report 单 priority=2（携带峰可观测面；修复前=0/1）——含零活动
 *      平台首个成员拍无候选的种钟面（129-D 落地面，红证：修复前 pending 直删、行峰 0）；
 *   4. 全链收口（docs/17-§2 七相位 / §6 收割四要件）：DISPATCH→GATE_PASS→工时收口
 *      done＋REPORT.md 落盘——日报产出；
 *   5. 反证 dedup 非阻断面：全拍序列无 DEDUP_NOOP（190/194 实况对齐——排位饥饿不是
 *      seenKeys 消费键滞留，141 面无关）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, InvokeIntent, TicketId } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { scheduleIntent } from '../../../src/engine/scheduler.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

/** 事发锚点：2026-10-22 17:59（18:00 槽前一刻，本地时区） */
const T0 = new Date(2026, 9, 22, 17, 59, 0, 0).getTime()

/** 零活动平台（对齐 Taiga 真机「daemon 自身迁移不回流活动流」——141 测试同款装饰器） */
function silentActivity(p: FlowPlatform): FlowPlatform {
  return { ...p, activity: { since: async () => ({ items: [], nextCursor: null }) } }
}

interface TestStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  /** 全拍汇报累积（断言 5 全序列扫描面） */
  reports: TickReport[]
}

/**
 * 测试栈：laneTtlMs=10s（泳道租约窗，tick 步长 1s 的 10 拍）＋人闸 override（隔离
 * 泳道闸维度——不叫 HOLD_PERSON_BUSY 抢戏）；适配器首 launch=stalled（在工占道单 W
 * 零事件零产物驻留，收割恒 streaming——STALL 看门狗 stallAfterMs=1h 测试窗内不介
 * 入），其余=sentinel（report 岗单带哨兵义务——读任务书三元组原样回写 summary，
 * 127-A R1 契约面全链走真；harvest-recon r4-ok 同款）。
 */
function buildStack(id: string, opts: { silent?: boolean } = {}): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const raw = createFakePlatform({ now: () => new Date(t).toISOString() })
  const platform = opts.silent === true ? silentActivity(raw) : raw
  let launchSeq = 0
  const registry = createRegistry()
  registry.register(
    createFakeAdapter({ mode: (): 'stalled' | 'sentinel' => ((launchSeq += 1) === 1 ? 'stalled' : 'sentinel') }),
    { default: true },
  )
  const reports: TickReport[] = []
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.4-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, id),
      defaultPersonId: DEMO_SNAPSHOT.people[0]?.id ?? 'AGENT-1',
      deptFallback: DEMO_SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
      defaultLane: DEMO_SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      limits: { maxActionsPerTick: 8, maxInflight: 6 },
      laneTtlMs: 10_000,
      stallAfterMs: 60 * 60_000,
      mirrorRescanEveryTicks: opts.silent === true ? 2 : 1,
      // 人闸放宽（W 在工占道期间 R/C 同人不被 HOLD_PERSON_BUSY 混淆视听——本缺陷只验泳道闸）
      personInflightOverrides: { [DEMO_SNAPSHOT.people[0]?.id ?? 'AGENT-1']: 3 },
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, clock, reports }
}

/** 定时岗台账行（18:00 日结=事发槽；19:00 巡查岗同拍对照） */
function jobRow(partial: Partial<JobRecord> & Pick<JobRecord, 'job_id'>): JobRecord {
  return {
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2, // 台账行 schema 阈（>=1）；物化工单恒 L0（drain.ts 物化段）——派发链不受批闸
    model_tier: 'low',
    next_run_at: 0,
    ...partial,
  }
}

/** 按事件名筛（含 ts——派发次序断言用） */
function eventsOf(ledger: Ledger, name: string): { issue: string; note: string; ts: number }[] {
  return ledger
    .queryEvents()
    .filter((e) => e.event === name)
    .map((e) => ({ issue: e.issue ?? '', note: e.note ?? '', ts: e.ts }))
}

/** 全拍决策码平面（dedup 反证 / hold 观测面） */
function decisionsOf(reports: TickReport[], ticket: string): string[] {
  return reports.flatMap((r) => r.phases.stateDiff.decisions.filter((d) => d.ticket === ticket).map((d) => d.code))
}

async function runTicks(stack: TestStack, n: number): Promise<TickReport[]> {
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    const r = await stack.engine.tick()
    stack.reports.push(r)
  }
  return stack.reports
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-s200-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 事况复刻：活动世界（taiga17 同型） ————————————————————

describe('studio-dev-200：report 型定时岗物化后派发饥饿（活动世界）', () => {
  it('双岗同点到：巡查岗同拍收口；report 岗泳道占道 hold 无声 → 租约到期后首拍先于 FIFO 先到积压单派发 → 全链收口', async () => {
    const stack = buildStack('case-a')
    const { ledger, platform, clock, reports } = stack

    // 事前态：在工占道单 W（18:00 时 core 泳道租约持有者=167 号同位）＋先到积压单 C
    const w = await platform.issues.create({ title: 'W 占道在工单（lane 契据）', type: 'task', level: 0 })
    const c = await platform.issues.create({ title: 'C 积压竞争单（FIFO 先到）', type: 'task', level: 0 })

    ledger.upsertJob(jobRow({ job_id: 'daily-report', payload: { type: 'report', output: 'reports/工程部/' } }))
    ledger.upsertJob(jobRow({ job_id: 'health-patrol', payload: { type: 'patrol' }, cron: '0 19 * * *' }))

    const r1 = (await runTicks(stack, 1)).at(-1) as TickReport
    expect(r1.phases.dispatch.dispatched).toBe(1) // W 派发（stalled 驻留——租约至 t+10s）
    expect((await platform.issues.get(w.id)).state).toBe('已派发')

    // 18:00:15 事况：两岗同槽到点（调度器源侧同秒产双意图——taiga17 tick#102568 同型）
    clock.advance(1000)
    const intents: InvokeIntent[] = [
      scheduleIntent(ledger.getJob('daily-report') as JobRecord, clock.now()),
      scheduleIntent(ledger.getJob('health-patrol') as JobRecord, clock.now()),
    ]
    stack.engine.ingest(intents)
    const r3 = await stack.engine.tick() // t=T0+3s：物化拍
    reports.push(r3)

    // —— 断言 1：巡查岗物化即终态（PATROL+CLOSE 同拍、零派发零工时——DEV-40 落位分型）——
    const patrols = eventsOf(ledger, 'PATROL')
    const patrolR = patrols.find((e) => e.note.includes('job=daily-report'))
    const patrolP = patrols.find((e) => e.note.includes('job=health-patrol'))
    expect(patrolR).toBeDefined()
    expect(patrolP).toBeDefined()
    const artifact = patrolP?.issue as TicketId
    expect((await platform.issues.get(artifact)).state).toBe('已交付')
    expect(eventsOf(ledger, 'CLOSE').some((e) => e.issue === artifact)).toBe(true)
    expect(ledger.listWorkRecords({ issue: artifact })).toHaveLength(0)

    // —— 断言 1（续）：report 岗物化拍派发被泳道闸无声顺延（190/194「物化后不派发」观测面）——
    const report = patrolR?.issue as TicketId
    expect((await platform.issues.get(report)).state).toBe('新单')
    expect(eventsOf(ledger, 'DISPATCH').some((e) => e.issue === report)).toBe(false)
    expect(r3.phases.stateDiff.decisions.some((d) => d.ticket === report && d.code === 'HOLD_LANE_BUSY')).toBe(true)

    // —— 泳道租约窗内静默（物化拍 t+2s..t+10s，事况 18:00→18:10 压缩）——
    await runTicks(stack, 8)

    // —— 断言 3：todo_queue 投影携带峰=p2（红证面：修复前 activity 种钟 p1）——
    const row = ledger.listTodoQueue().find((q) => q.ticket === report)
    expect(row?.priority).toBe(2)

    // —— 断言 2：租约到期首拍（t+11s），report 岗先于 FIFO 先到的同分低优积压单 C ——
    const r11 = (await runTicks(stack, 1)).at(-1) as TickReport
    expect(r11.phases.dispatch.dispatched).toBe(1)
    const dispatchR = eventsOf(ledger, 'DISPATCH').find((e) => e.issue === report)
    const dispatchC = eventsOf(ledger, 'DISPATCH').find((e) => e.issue === c.id)
    expect(dispatchR).toBeDefined()
    // 红证面：修复前 report 回落 p0/p1+FIFO 最年轻 → C 先发、report 排下一发
    expect(dispatchC === undefined || dispatchR.ts < dispatchC.ts).toBe(true)

    // —— 断言 4：全链收口（docs/17-§2/§6：收割四要件真→闸过→工时收口 done＋REPORT 落盘）——
    await runTicks(stack, 12)
    const work = ledger.listWorkRecords({ issue: report })[0]
    expect(work?.status).toBe('done')
    expect(work?.report_ref).toMatch(/REPORT\.md$/)
    expect(eventsOf(ledger, 'GATE_PASS').some((e) => e.issue === report)).toBe(true)
    expect((await platform.issues.get(report)).state).toBe('已交付')

    // —— 断言 5：反证 dedup 非阻断面（141 面无关）——
    expect(decisionsOf(stack.reports, report).filter((code) => code === 'DEDUP_NOOP')).toHaveLength(0)

    await stack.engine.dispose()
    stack.ledger.close()
  }, 30_000)
})

// ————————————————————————— 种钟面：零活动平台（Taiga 真机同型） ————————————————————

describe('studio-dev-200：零活动平台首个成员拍无候选——pending 直删=峰值丢地板', () => {
  it('物化拍占道 hold → 无候选成员拍 settle 种钟 p2（修复前 pending 直删、投影行峰 0）→ rescan 拍照常可派发', async () => {
    const stack = buildStack('case-b', { silent: true })
    const { ledger, platform, clock } = stack

    const w = await platform.issues.create({ title: 'W 占道在工单（零活动世界）', type: 'task', level: 0 })
    ledger.upsertJob(jobRow({ job_id: 'daily-report', payload: { type: 'report', output: 'reports/工程部/' } }))
    ledger.upsertJob(jobRow({ job_id: 'health-patrol', payload: { type: 'patrol' }, cron: '0 19 * * *' }))

    // seq1：无 rescan（every=2）无活动——零候选；seq2：rescan 首拍 → W 兜底进候选并派发
    //（租约至 seq2 时刻+10s）
    await runTicks(stack, 2)
    expect(eventsOf(ledger, 'DISPATCH').some((e) => e.issue === w.id)).toBe(true)

    // seq3：静默；seq4（rescan 拍）：双岗同到物化——report 岗泳道占道 hold（对齐 18:00 事况）
    await runTicks(stack, 1)
    clock.advance(1000)
    stack.engine.ingest([
      scheduleIntent(ledger.getJob('daily-report') as JobRecord, clock.now()),
      scheduleIntent(ledger.getJob('health-patrol') as JobRecord, clock.now()),
    ])
    const r4 = await stack.engine.tick()
    stack.reports.push(r4)
    const report = eventsOf(ledger, 'PATROL').find((e) => e.note.includes('job=daily-report'))?.issue as TicketId
    expect(report).toBeDefined()
    expect(r4.phases.stateDiff.decisions.some((d) => d.ticket === report && d.code === 'HOLD_LANE_BUSY')).toBe(true)

    // seq5（无 rescan 无活动=本拍零候选）：成员资格已落地（相位 1 活集含新单）——
    // settle 必须把 pending p2 并入携带（红证：修复前成员拍 carry 缺位 → pending 直删）
    await runTicks(stack, 1)
    expect(ledger.listTodoQueue().find((q) => q.ticket === report)?.priority).toBe(2)

    // seq6..seq12：租约到期（seq2+10s=seq12 时刻）+rescan 拍——report 岗派发并全链收口
    await runTicks(stack, 8)
    const dispatchR = eventsOf(ledger, 'DISPATCH').find((e) => e.issue === report)
    expect(dispatchR).toBeDefined()
    expect(dispatchR.ts).toBeGreaterThanOrEqual(T0 + 12_000)
    const work = ledger.listWorkRecords({ issue: report })[0]
    expect(work?.status).toBe('done')
    expect(work?.report_ref).toMatch(/REPORT\.md$/)
    expect(eventsOf(ledger, 'GATE_PASS').some((e) => e.issue === report)).toBe(true)

    await stack.engine.dispose()
    stack.ledger.close()
  }, 30_000)
})
