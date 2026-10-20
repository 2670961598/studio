/**
 * stall-response —— DEV-44 STALL 响置刀回归（红→绿纪律：先红证后修法）
 *
 * 缺陷（2026-10-20 三例实证 studio-dev-20/25/71）：看门狗只叫不咬——工静默超阈、
 * 工人消亡、单卡已派发态，STALL 告警反复落账而无 kill+重派（引擎注释自认
 * 「kill 重派归后续刀」）。修法（本单落点，docs/17-§2 相位 4 末段 + 02-F1-08
 * 「kill 后等死再重派」）：告警达阈 config.stallKillAfterAlarms（同 attempt 内
 * 事件派生计数）→ executeStallResponse 两面咬合——
 *   A kill 面（在途句柄存活）：adapter.kill 整树杀（stop 通道同款链）→ 工位收口
 *     interrupted（R-B 在途语义：不落 GATE_FAIL 不结算）→ 回首批位 → 重派
 *     attempt+1 经 rescan 兜底（activity 键未释放，22-§三.2）；
 *   B 消亡面（无在途句柄）：GATE_FAIL（WORKER_DEAD）+ 遗留 running 工位收口
 *     failed + activity 键释放 → 重派 attempt+1。
 * 两面均入断路器（dispositions：STALL countsTowardBreaker——防「挂死-杀-重派」
 * 无限循环；达阈熔断 ESCALATE+bug 单+停重派）。
 *
 * 断言面：
 *   1. 负对照（刀关 0）：僵死工人告警反复累积、零 kill、单卡已派发、工位 running
 *      ——缺陷机制存档（改动前世界的如实写照）
 *   2. kill 面崩溃注入：僵死首誓 → 告警 1 只叫 → 告警 2 咬合（kill 恰一次、
 *      句柄归属正确、graceMs 同 kill 链）→ 工位 interrupted → 重派 attempt=2
 *      → 二誓全链 CLOSE（断路不熔断：单发连击 < 阈）
 *   3. 消亡面崩溃注入（dispose 模拟工人消亡——工位留 running 的三例实况同型）：
 *      咬合零 kill（无可杀）→ GATE_FAIL（WORKER_DEAD）+ 遗留工位 failed →
 *      重派 attempt=2 → 全链 CLOSE
 *   4. 断路收敛（阈 1）：僵死-杀-重派循环三周 → 同签名三连击熔断（ESCALATE +
 *      bug 单 + HOLD_BREAKER_OPEN 停第四誓）——循环不无限
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, Handle, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../src/fakes.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../src/serve.ts'

/** 测试栈：每用例独立台账/平台/引擎（fake 全家桶 + tmp 库 + 假时钟 + 可注形态适配器） */
interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StallStackOptions {
  /** STALL 响置咬合阈（DEV-44；0=关——负对照用） */
  stallKillAfterAlarms: number
  /** fake 适配器工作形态（运行期可切——崩溃注入剧本） */
  mode: () => FakeAdapterMode
  /** kill 捕获（咬合/停机注入的可观测面——fake 无真进程） */
  onKill?: (h: Handle, graceMs: number) => void
}

/**
 * 告警节奏口径：stallAfterMs=1500 + 每拍 1000ms → 派发后第 3 拍起每拍一告警
 * （silent=now-平台 updated；mirrorRescanEveryTicks=1 保证在工期每拍都是决策候选
 * ——activity 键已消费，告警候选只能经 mirror 源，DEV-42① 兜底即 DEV-44 的喂数线）。
 */
const STALL_AFTER_MS = 1500

function buildStallStack(id: string, opts: StallStackOptions): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(
    createFakeAdapter({ mode: opts.mode, name: 'fake', ...(opts.onKill !== undefined ? { onKill: opts.onKill } : {}) }),
    { default: true },
  )
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
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
      stallAfterMs: STALL_AFTER_MS,
      stallKillAfterAlarms: opts.stallKillAfterAlarms,
      mirrorRescanEveryTicks: 1,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, clock }
}

/** 建单（默认泳道 core——与引擎 defaultLane 同键，响置后的重派不受租约残留卡） */
async function createTicket(stack: TestStack, title: string): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: 0 })
  return created.id
}

/** 推拍（每拍 1s；上限拍数内未到终局=断言面自会红） */
async function runTicks(stack: TestStack, n: number): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    reports.push(await stack.engine.tick())
  }
  return reports
}

/** 单据事件名序列（链路断言用） */
function eventsOf(ledger: Ledger, ticket: TicketId): string[] {
  return ledger.queryEvents({ issue: ticket }).map((e) => e.event)
}

/** 事件名计数 */
function countOf(ledger: Ledger, ticket: TicketId, name: string): number {
  return eventsOf(ledger, ticket).filter((n) => n === name).length
}

/** 指定事件的 note 首串（GATE_FAIL 分类断言用） */
function noteOf(ledger: Ledger, ticket: TicketId, name: string): string[] {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === name).map((e) => e.note ?? '')
}

let root = ''

/** 假时钟纪元（T0=2026-10-20——三例实证同日，事故纪年对齐） */
const T0 = Date.UTC(2026, 9, 20, 0, 0, 0)

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-stall-response-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('负对照：刀关（stallKillAfterAlarms=0）——改动前世界（只叫不咬）如实存档', () => {
  it('僵死工人：告警反复累积、零 kill、单卡已派发、工位 running、无重派', async () => {
    const kills: Array<{ h: Handle; graceMs: number }> = []
    let mode: FakeAdapterMode = 'stalled'
    const stack = buildStallStack('knife-off', {
      stallKillAfterAlarms: 0,
      mode: () => mode,
      onKill: (h, graceMs) => { kills.push({ h, graceMs }) },
    })
    const t1 = await createTicket(stack, '僵死单（刀关）')

    await runTicks(stack, 8)

    // 告警累积（t3..t8 每拍一条——只叫不咬的事故本体）；零 kill；无收口无重派
    expect(countOf(stack.ledger, t1, 'STALL')).toBeGreaterThanOrEqual(3)
    expect(kills).toHaveLength(0)
    expect(countOf(stack.ledger, t1, 'DISPATCH')).toBe(1)
    expect(countOf(stack.ledger, t1, 'GATE_FAIL')).toBe(0)
    expect((await stack.platform.issues.get(t1)).state).toBe('已派发')
    const rows = stack.ledger.listWorkRecords({ issue: t1 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('running')
    expect(rows[0]?.attempt).toBe(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('kill 面：在途句柄存活 → 整树杀 + interrupted 收口 + rescan 重派（DEV-44 A）', () => {
  it('僵死首誓 → 告警1只叫 → 告警2咬合：kill 恰一次（句柄/宽限同链）→ 工位 interrupted → attempt=2 重派 → 全链 CLOSE', async () => {
    const kills: Array<{ h: Handle; graceMs: number }> = []
    let mode: FakeAdapterMode = 'stalled'
    const stack = buildStallStack('kill-face', {
      stallKillAfterAlarms: 2,
      mode: () => mode,
      onKill: (h, graceMs) => {
        kills.push({ h, graceMs })
        mode = 'ok' // 崩溃注入剧本：被杀后工人换新（重派誓正常完成）
      },
    })
    const t1 = await createTicket(stack, '僵死单（kill 面）')

    await runTicks(stack, 12)

    // 咬恰一次：杀的是首誓句柄（fake-1），宽限=killGraceMs（stop 通道同一条 kill 链）
    expect(kills).toHaveLength(1)
    expect(kills[0]?.h.sessionId).toBe('fake-1')
    expect(kills[0]?.graceMs).toBe(ENGINE_CONFIG_DEFAULTS.killGraceMs)

    // 链路：首誓派发→两条告警（第 1 只叫、第 2 咬合）→回首批位→attempt=2 重派→全链收口
    expect(eventsOf(stack.ledger, t1)).toEqual([
      'DISPATCH', 'STALL', 'STALL', 'DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE',
    ])
    const dispatches = stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches.map((e) => e.attempt)).toEqual([1, 2])

    // 工位账：首誓 interrupted（R-B 在途语义——不冒认失败）；二誓 completed
    const rows = stack.ledger.listWorkRecords({ issue: t1 })
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.attempt === 1)?.status).toBe('interrupted')
    expect(rows.find((r) => r.attempt === 2)?.status).toBe('done')

    // 断路不熔断：单发连击（stall:watchdog-kill ×1）< 阈 3
    expect(countOf(stack.ledger, t1, 'ESCALATE')).toBe(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('消亡面：无在途句柄 → GATE_FAIL（WORKER_DEAD）+ 遗留工位收口 + 活动驱动重派（DEV-44 B）', () => {
  it('dispose 注入工人消亡（工位留 running——三例实况同型）→ 咬合零 kill → GATE_FAIL WORKER_DEAD + 工位 failed → attempt=2 重派全链 CLOSE', async () => {
    const kills: Array<{ h: Handle; graceMs: number }> = []
    let mode: FakeAdapterMode = 'stalled'
    const stack = buildStallStack('dead-face', {
      stallKillAfterAlarms: 2,
      mode: () => mode,
      onKill: (h, graceMs) => { kills.push({ h, graceMs }) },
    })
    const t1 = await createTicket(stack, '消亡单（B 面）')

    // t1 派发（僵死）；t3 首告警（只叫）
    await runTicks(stack, 3)
    expect(countOf(stack.ledger, t1, 'STALL')).toBe(1)

    // 崩溃注入：工人消亡（kill+在途注销，工位留 running——dispose 语义即三例实况：
    // 工人死了、句柄没了、单还卡在已派发）
    await stack.engine.dispose()
    expect(kills).toHaveLength(1) // 注入面杀（dispose），非咬合杀

    // t4：第二告警达阈 → 消亡面咬合（无句柄可杀）
    await runTicks(stack, 1)
    expect(kills).toHaveLength(1) // 咬合零 kill——消亡面无可杀
    const gateFails = stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain('WORKER_DEAD：')
    expect(gateFails[0]?.attempt).toBe(1) // 在工 attempt 口径（记正在跑的这一誓）
    expect(countOf(stack.ledger, t1, 'STALL')).toBe(2)

    // 工位账：遗留 running 收口 failed（判定面收口——与 failHarvest 同款）
    expect(stack.ledger.listWorkRecords({ issue: t1 }).find((r) => r.attempt === 1)?.status).toBe('failed')

    // 重派：GATE_FAIL 释放 activity 键 → attempt=2 → 全链 CLOSE
    mode = 'ok'
    await runTicks(stack, 9)
    const evs = eventsOf(stack.ledger, t1)
    expect(evs.filter((n) => n === 'DISPATCH')).toHaveLength(2)
    expect(evs).toContain('GATE_PASS')
    expect(evs[evs.length - 1]).toBe('CLOSE')
    const rows = stack.ledger.listWorkRecords({ issue: t1 })
    expect(rows.find((r) => r.attempt === 1)?.status).toBe('failed')
    expect(rows.find((r) => r.attempt === 2)?.status).toBe('done')
    expect(countOf(stack.ledger, t1, 'ESCALATE')).toBe(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('断路收敛：僵死-杀-重派循环 → 同签名连击熔断（ESCALATE + bug 单 + 停重派）', () => {
  it('阈 1 即咬：三周循环后第三咬熔断——ESCALATE 恰一次、bug 单开出、HOLD_BREAKER_OPEN 压住第四誓', async () => {
    const kills: Array<{ h: Handle; graceMs: number }> = []
    const stack = buildStallStack('breaker-trip', {
      stallKillAfterAlarms: 1,
      mode: () => 'stalled' as FakeAdapterMode, // 恒僵死：循环三周喂满断路器
      onKill: (h, graceMs) => { kills.push({ h, graceMs }) },
    })
    const t1 = await createTicket(stack, '反复僵死单（断路）')

    const reports = await runTicks(stack, 14)

    // 三誓三杀（每誓：派发→1 告警即咬→interrupted→回首批位→重派）
    expect(kills).toHaveLength(3)
    expect(countOf(stack.ledger, t1, 'DISPATCH')).toBe(3)
    expect(countOf(stack.ledger, t1, 'STALL')).toBe(3)
    const rows = stack.ledger.listWorkRecords({ issue: t1 })
    expect(rows.filter((r) => r.status === 'interrupted').map((r) => r.attempt)).toEqual([1, 2, 3])

    // 第三咬熔断：ESCALATE 恰一次 + bug 单开出（标 relates-to 原单）
    expect(countOf(stack.ledger, t1, 'ESCALATE')).toBe(1)
    expect(noteOf(stack.ledger, t1, 'ESCALATE')[0]).toContain('stall:watchdog-kill')
    const bugs = (await stack.platform.issues.list({})).filter((i) => i.type === 'bug')
    expect(bugs).toHaveLength(1)
    expect(bugs[0]?.title).toContain(t1)

    // 熔断后停重派：决策面 HOLD_BREAKER_OPEN，无第四誓；单滞留首批位（不再无限循环）
    expect(countOf(stack.ledger, t1, 'DISPATCH')).toBe(3)
    expect(reports.some((r) => r.phases.stateDiff.decisions.some((d) => d.ticket === t1 && d.code === 'HOLD_BREAKER_OPEN'))).toBe(true)
    expect((await stack.platform.issues.get(t1)).state).toBe('新单')
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
