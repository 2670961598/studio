/**
 * stall-rescan-revival —— studio-dev-141 回归（红→绿纪律：先红证后修法）
 *
 * 缺陷（2026-10-21，123 号卡 3.5h 实证）：STALL 咬合 kill 面回滚重派被 DEDUP_NOOP
 * 压制——回退回初态的单 rescan 兜底失效。
 *   机制：上誓消费键（DISPATCH note intent=）唯一释放路径=GATE_PASS/GATE_FAIL 结论
 *   事件；kill 面（R-B 在途语义：接管≠收割，四要件不可判）两皆无 → 键滞留
 *   seenKeys → 回退态单的 mirror rescan 意图键与上誓消费键同形 → decide step1 恒
 *   DEDUP_NOOP。零活动世界（Taiga 真机：daemon 自身迁移不回流活动流——建单不进
 *   history、迁移被 hidden/snapshot 过滤）无 activity 逃生门 → 单滞留首批位直到
 *   平台侧偶发外部活动（123 号卡 16:59:09 咬合 → 20:33:21 才被无关活动救活，
 *   daemon-taiga15/16.log tick#77940-78098 全程 noop 实证）。
 *   既有测试为何从未暴露：fake 平台 transition() 产 state-transition 活动（fakes.ts）
 *   ——回滚即活动、activity 意图键从未被消费，测试世界逃生门恒开。
 *
 * 修法（events-index.ts studio-dev-141 面）：STALL 咬合事件（note 携
 * STALL_KILL_CLOSE_ANCHOR「工位收口 interrupted」——kill 面收口独有锚）= 该誓在工
 * 生命终结锚，进 lastOutcome 释放消费键。键释放≠收割结论：GATE_FAIL/预算/断路面
 * 全不动；与 22-§三.2 幂等口径不破（同誓内 100 重复意图仍只唤起一次——幂等的对象
 * 是誓，咬合后重派是新誓唤起非 replay）。事件派生可重放：存量咬合事件重放即释放
 * （123 号卡无需人工清账，修复上线下一节流拍 rescan 自愈——selfheal 验证见单据
 * REPORT）。
 *
 * 断言面：
 *   1. 零活动世界（silentActivity 装饰器——对齐 Taiga 真机）kill 面剧本：上誓由
 *      mirror rescan 派发（123 实况对齐）→ 咬合 → **下一拍** rescan 即刻重派
 *      attempt=2 → 全链 CLOSE（红证：修复前咬合后每拍 DEDUP_NOOP，单滞留新单）
 *   2. 同誓幂等保持（22-§三.2）：咬合前重复 rescan 意图不双派（DISPATCH 恰一次）
 *   3. 工位账/R-B 在途语义不动：首誓 interrupted、二誓 done
 *   4. 断路安全网仍在：恒僵死 3 誓 3 杀熔断停第四誓（键释放不得绕过断路器——
 *      「挂死-杀-重派」无限循环由 DEV-46 半开断路器守，红证：修复前零活动世界
 *      循环断在誓一，熔断永无机会介入）
 *   （既有 kill 面行为零回归由 stall-response.test.ts 守：有活动平台世界本修复
 *    前后行为一致——activity 逃生门照常，事件序列不变。）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../src/assembly/serve.ts'

/** 测试栈：每用例独立台账/平台/引擎（fake 全家桶 + tmp 库 + 假时钟） */
interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  root: string
}

/**
 * 零活动平台：activity.since 恒空——对齐 Taiga 真机「daemon 自身迁移不回流活动流」
 * （建单不进 history、迁移被 hidden/snapshot 过滤——packages/taiga/src/activity.ts）。
 * fake 平台 transition() 产 state-transition 活动是测试逃生门（stall-response.test.ts
 * kill 面用例经 activity 通道重派而绿——本缺陷在其世界恒不可见）。
 */
function silentActivity(p: FlowPlatform): FlowPlatform {
  return { ...p, activity: { since: async () => ({ items: [], nextCursor: null }) } }
}

function buildStack(
  id: string,
  opts: { stallKillAfterAlarms: number; mode: () => FakeAdapterMode; onKill?: (h: unknown, graceMs: number) => void },
): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const raw = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const platform = silentActivity(raw)
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode: opts.mode, onKill: opts.onKill as never }), { default: true })
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
  return { platform, ledger, engine, clock, root }
}

async function createTicket(stack: TestStack, title: string): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: 0 })
  return created.id
}

async function runTicks(stack: TestStack, n: number): Promise<Array<{ tick: number; report: TickReport }>> {
  const reports: Array<{ tick: number; report: TickReport }> = []
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    reports.push({ tick: i + 1, report: await stack.engine.tick() })
  }
  return reports
}

const eventsOf = (ledger: Ledger, ticket: TicketId): string[] =>
  ledger.queryEvents({ issue: ticket }).map((e) => e.event)

const decisionsOf = (reports: Array<{ tick: number; report: TickReport }>, ticket: TicketId, code: string): number[] =>
  reports
    .filter((r) => r.report.phases.stateDiff.decisions.some((d) => d.ticket === ticket && d.code === code))
    .map((r) => r.tick)

const STALL_AFTER_MS = 1500
const T0 = Date.UTC(2026, 9, 21, 0, 0, 0) // 123 号卡实证同日

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-stall-rescan-revival-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('kill 面·零活动世界（123 号卡同型）：咬合释放消费键 → rescan 即刻可派（studio-dev-141）', () => {
  it('mirror 派发被杀 → 回滚 → 下一拍 rescan 重派 attempt=2 → 全链 CLOSE', async () => {
    const kills: Array<{ sessionId: string; graceMs: number }> = []
    let mode: FakeAdapterMode = 'stalled'
    const stack = buildStack('kill-face-silent', {
      stallKillAfterAlarms: 2,
      mode: () => mode,
      onKill: (h, graceMs) => {
        kills.push({ sessionId: (h as { sessionId: string }).sessionId, graceMs })
        mode = 'ok' // 崩溃注入剧本：被杀后工人换新（重派誓正常完成）
      },
    })
    const t1 = await createTicket(stack, '零活动世界（123 号卡同型）')

    const reports = await runTicks(stack, 12)
    const events = eventsOf(stack.ledger, t1)

    // 红证面（修复前）：事件序列止于 [DISPATCH, STALL, STALL]——咬合后每拍 mirror
    // rescan 意图与滞留消费键同形 → DEDUP_NOOP，单滞留首批位直到拍上限烧尽
    //（123 号卡 3.5h noop 的机制复现，daemon-taiga15/16.log tick#77940-78098 同型）。
    expect(events).toEqual([
      'DISPATCH', 'STALL', 'STALL', 'DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE',
    ])

    // kill 恰一次（首誓句柄）；上誓与重派均经 mirror 源（123 实况对齐：上誓由
    // rescan 兜底派发——DISPATCH note intent=mirror|…）
    expect(kills).toHaveLength(1)
    expect(kills[0]?.sessionId).toBe('fake-1')
    expect(kills[0]?.graceMs).toBe(ENGINE_CONFIG_DEFAULTS.killGraceMs)
    const dispatches = stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'DISPATCH')
    expect(dispatches.map((e) => e.attempt)).toEqual([1, 2])
    expect(dispatches.map((e) => e.note ?? '')).toSatisfy((notes: string[]) =>
      notes.every((n) => n.includes('intent=mirror|ticket|demo|')))

    // 「rescan 即刻可派」核心断言：咬合拍（第 2 条 STALL 落账拍）的下一拍即重派决策
    const stalls = stack.ledger.queryEvents({ issue: t1 }).filter((e) => e.event === 'STALL')
    const biteTick = Math.round(((stalls[1]?.ts ?? 0) - T0) / 1000)
    const dispatchTicks = decisionsOf(reports, t1, 'DISPATCH')
    expect(dispatchTicks).toEqual([1, biteTick + 1])

    // 压制解除：咬合后任何拍 t1 决策码不再 DEDUP_NOOP（红证面：修复前 t5..t12 恒 DEDUP）
    const dedupAfterBite = reports
      .filter((r) => r.tick > biteTick)
      .flatMap((r) => r.report.phases.stateDiff.decisions.filter((d) => d.ticket === t1 && d.code === 'DEDUP_NOOP'))
    expect(dedupAfterBite).toHaveLength(0)

    // 同誓幂等保持（22-§三.2）：咬合前（首誓在工期）重复 rescan 意图不双派
    const dispatchBeforeBite = reports
      .filter((r) => r.tick < biteTick)
      .flatMap((r) => r.report.phases.stateDiff.decisions.filter((d) => d.ticket === t1 && d.code === 'DISPATCH'))
    expect(dispatchBeforeBite).toHaveLength(1)

    // 工位账：R-B 在途语义不动（首誓 interrupted 不冒认失败；二誓 done）
    const rows = stack.ledger.listWorkRecords({ issue: t1 })
    expect(rows.find((r) => r.attempt === 1)?.status).toBe('interrupted')
    expect(rows.find((r) => r.attempt === 2)?.status).toBe('done')

    // 断路不熔断：单发连击（stall:watchdog-kill ×1）< 阈 3
    expect(events.includes('ESCALATE')).toBe(false)

    await stack.engine.dispose()
    stack.ledger.close()
  })
})

describe('断路安全网（DEV-46 半开）：键释放不得绕过断路器', () => {
  it('恒僵死 3 誓 3 杀（重派全经 rescan）→ 熔断 ESCALATE + bug 单 + HOLD_BREAKER_OPEN 停第四誓', async () => {
    const kills: Array<{ sessionId: string }> = []
    const stack = buildStack('breaker-silent', {
      stallKillAfterAlarms: 1,
      mode: () => 'stalled',
      onKill: (h) => { kills.push({ sessionId: (h as { sessionId: string }).sessionId }) },
    })
    const t1 = await createTicket(stack, '恒僵死（断路收敛·零活动世界）')

    const reports = await runTicks(stack, 16)
    const events = eventsOf(stack.ledger, t1)

    // 红证面（修复前）：零活动世界重派被 DEDUP 断在誓一（DISPATCH,STALL 后滞留），
    // 「挂死-杀-重派」连第一轮都走不完——熔断永无机会介入（不是收敛快慢问题，
    // 是安全网被 dedup 压制遮蔽成永冻单）。
    expect(events.filter((e) => e === 'DISPATCH')).toHaveLength(3)
    expect(kills).toHaveLength(3)
    expect(events.filter((e) => e === 'ESCALATE')).toHaveLength(1)
    const bugs = (await stack.platform.issues.list({})).filter((i) => i.type === 'bug')
    expect(bugs).toHaveLength(1)
    expect(bugs[0]?.title.includes(t1)).toBe(true)
    expect(reports.some((r) => r.report.phases.stateDiff.decisions.some((d) => d.ticket === t1 && d.code === 'HOLD_BREAKER_OPEN'))).toBe(true)
    expect((await stack.platform.issues.get(t1)).state).toBe('新单')

    await stack.engine.dispose()
    stack.ledger.close()
  })
})
