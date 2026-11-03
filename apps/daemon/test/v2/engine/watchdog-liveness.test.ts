/**
 * watchdog-liveness —— 看门狗误杀活体 worker 修复（studio-dev-505）V2 定向红→绿用例
 *
 * 依据（实现单引用）：
 *   - docs/02-F1-08 看门狗三道（wrap 墙钟/daemon 侧兜底/心跳超时；kill 后等死再重派）；
 *   - docs/17-§2 相位 4 STALL 响置；docs/17-§6 收割四要件（接管≠收割）；
 *   - docs/v2/07-§三 EXEC-01/EXEC-02/EXEC-03（常态更新不得杀活 worker；活性观察面）。
 *
 * 复现 488-att2 时间线（/tmp/wd-audit/05）：活体 worker 持续写会话，silentMs 却按
 * issue.updated 计——单回合 > 阈值即被整树杀。本组用例＝「改前必红」的行为断言：
 *   ① A 面 kill 前复核：会话 mtime 新鲜 → 不杀、不落 WORKER_DEAD；
 *   ② 分级阈值：长回合 executor 配更高阈值 → 10min 静默不咬合；
 *   ③ A 面复核通过=续租（直接响置体单测：落 STALL 续租锚、不杀、不入断路）；
 *   ④ B 面即时收口：work_record interrupted + 无在途句柄 → 首拍收口，不等陈旧锚；
 *   ⑤ 真死仍收口（回归）：会话停写 + 阈值到点 → 照常杀/收口（不放宽真死检测）。
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRegistry, type ExecutorRegistry } from '@studio-next/adapters'
import { DEFAULT_STATES } from '@studio-next/core'
import type { EventRecord, ExecutorAdapter, FlowPlatform, Handle, IssueRecord, StreamEvent, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type EngineConfig, type Inflight } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { takeOverRunningWorkRecords } from '../../../src/engine/harvest/inflight-takeover.ts'
import type { StallResponseHost } from '../../../src/engine/watchdog/stall-response.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
const SESSION_ID = 'sess-live-4c4e1959'
let dshHome = ''
const prevDshHome = process.env.DSH_HOME

beforeAll(() => {
  dshHome = mkdtempSync(path.join(tmpdir(), 'sn-watchdog-home-'))
  process.env.DSH_HOME = dshHome
})

afterAll(() => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevDshHome
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

interface Stack {
  readonly root: string
  readonly ledger: Ledger
  readonly platform: FlowPlatform
  readonly clock: { now(): number; advance(ms: number): void }
  readonly engine: Engine
  readonly killed: Handle[]
  readonly sessionFile: string
}

interface StackOptions {
  readonly label: string
  /** 会话文件 mtime 偏移（相对时钟；新鲜=0，真死=10min 前） */
  readonly sessionAgeMs?: number
  readonly stallAfterMs?: number
  readonly stallAfterMsByExecutor?: Readonly<Record<string, number>>
  readonly stallKillAfterAlarms?: number
  /** 用 fake 适配器（无会话探测）而非 test 适配器 */
  readonly fakeAdapter?: FakeAdapterMode
}

/** 测试用 dsh 形适配器：驻留零事件流 + 暴露 executorSessionId（会话探测面入口） */
function createTestAdapter(onKill: (h: Handle) => void): ExecutorAdapter {
  let seq = 0
  return {
    name: 'dsh-mid',
    capabilities: { budget_cap: false, cancel_turn: false, session_resume: true, agents_md: 'user_level', cost_native: false },
    async detect() {
      return { name: 'dsh-mid', version: '0.0.0-test', ok: true, gaps: [] }
    },
    async estimate(_task: TaskBrief) {
      return { estimated: { usd: 0.01 }, confidence: 1 }
    },
    async launch(_task: TaskBrief): Promise<Handle> {
      seq += 1
      return { executor: 'dsh-mid', sessionId: `test-${seq}`, pid: process.pid, executorSessionId: SESSION_ID }
    },
    async *stream(_h: Handle): AsyncIterable<StreamEvent> {
      // 驻留流：零事件、永不收尾（长回合静默面）——活性只能来自会话 mtime/进程探测
      await new Promise<void>(() => undefined)
      yield* []
    },
    async resultStats(_h: Handle) {
      return { cost: { usd: 0 }, tokens: { input: 0, output: 0 }, duration: 0, turns: 0 }
    },
    async kill(h: Handle, _graceMs: number) {
      onKill(h)
    },
  }
}

function makeSessionFile(ageMs: number): string {
  const dir = path.join(dshHome, 'sessions', '--studio-dev-watchdog-test--', `session-${SESSION_ID}`)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, 'session')
  const sec = (Date.now() - ageMs) / 1000
  utimesSync(file, sec, sec)
  return file
}

function assemblerOf(): ReturnType<typeof createDefaultAssembler> {
  return createDefaultAssembler({
    fwkVersion: 'v0.5-test',
    frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
    snapshot: DEMO_SNAPSHOT,
    acceptance: ['echo demo-ok'],
    docRefs: ['docs/17-§2（主循环七相位）'],
  })
}

function engineOf(input: {
  platform: FlowPlatform
  ledger: Ledger
  registry: ExecutorRegistry
  clock: () => number
  rootDir: string
  stallAfterMs?: number
  stallAfterMsByExecutor?: Readonly<Record<string, number>>
  stallKillAfterAlarms?: number
}): Engine {
  return createEngine({
    platform: input.platform,
    ledger: input.ledger,
    registry: input.registry,
    assembler: assemblerOf(),
    gateRunner: createDefaultGateRunner(),
    clock: input.clock,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: input.rootDir,
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      harvestSliceMs: 5,
      stallAfterMs: input.stallAfterMs ?? 60_000,
      stallKillAfterAlarms: input.stallKillAfterAlarms ?? 1,
      ...(input.stallAfterMsByExecutor !== undefined ? { stallAfterMsByExecutor: input.stallAfterMsByExecutor } : {}),
    },
    people: DEMO_SNAPSHOT.people,
  })
}

function makeStack(opts: StackOptions): Stack {
  const root = mkdtempSync(path.join(tmpdir(), `sn-watchdog-${opts.label}-`))
  roots.push(root)
  let t = Date.now() // 真实时钟基线：会话 mtime 与假时钟同源，避免双钟漂移
  const clock = { now: (): number => t, advance(ms: number): void { t += ms } }
  const sessionFile = makeSessionFile(opts.sessionAgeMs ?? 0)
  const killed: Handle[] = []
  const registry: ExecutorRegistry = createRegistry()
  if (opts.fakeAdapter !== undefined) {
    registry.register(createFakeAdapter({ mode: opts.fakeAdapter, name: 'fake' }), { default: true })
  } else {
    registry.register(createTestAdapter((h) => killed.push(h)), { default: true })
  }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const engine = engineOf({
    platform,
    ledger,
    registry,
    clock: clock.now,
    rootDir: path.join(root, 'var'),
    stallAfterMs: opts.stallAfterMs ?? 60_000,
    ...(opts.stallAfterMsByExecutor !== undefined ? { stallAfterMsByExecutor: opts.stallAfterMsByExecutor } : {}),
    stallKillAfterAlarms: opts.stallKillAfterAlarms ?? 1,
  })
  return { root, ledger, platform, clock, engine, killed, sessionFile }
}

/** 推一拍（时钟 +1s；latent 形态同步刷新会话 mtime） */
async function tick(stack: Stack, refresh: boolean): Promise<void> {
  stack.clock.advance(1000)
  if (refresh) {
    const sec = stack.clock.now() / 1000
    utimesSync(stack.sessionFile, sec, sec)
  }
  await stack.engine.tick()
}

async function runTicks(stack: Stack, n: number, refresh: boolean): Promise<void> {
  for (let i = 0; i < n; i += 1) await tick(stack, refresh)
}

async function newTicket(stack: Stack): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title: '看门狗活性单', type: 'task', level: 0 })
  return created.id
}

function eventsNamed(ledger: Ledger, ticket: TicketId, name: string): EventRecord[] {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === name)
}

function stallNotes(ledger: Ledger, ticket: TicketId): string[] {
  return eventsNamed(ledger, ticket, 'STALL').map((e) => e.note ?? '')
}

describe('A 面 kill 前活性复核（studio-dev-505）', () => {
  it('活体长回合（会话 mtime 每拍刷新）超阈值 → 不杀、不落 WORKER_DEAD', async () => {
    const stack = makeStack({ label: 'a-live', stallAfterMs: 60_000, stallKillAfterAlarms: 1 })
    const ticket = await newTicket(stack)
    await tick(stack, true) // 派发
    await runTicks(stack, 70, true) // 70s > 阈值 60s：改前第 61s 起告警、随即整树杀
    expect(stack.killed).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(0)
    expect(stallNotes(stack.ledger, ticket)).toHaveLength(0)
    expect((await stack.platform.issues.get(ticket)).state).toBe(DEFAULT_STATES.dispatched)
    const running = stack.ledger.listWorkRecords({ issue: ticket }).filter((r) => r.status === 'running')
    expect(running).toHaveLength(1)
  })

  it('分级阈值：dsh-mid 配 6h，10min 静默不咬合（缺省 5s 档会误杀）', async () => {
    const stack = makeStack({
      label: 'a-tier',
      sessionAgeMs: 10 * 60_000,
      stallAfterMs: 5_000,
      stallAfterMsByExecutor: { 'dsh-mid': 6 * 3_600_000 },
    })
    const ticket = await newTicket(stack)
    await tick(stack, false)
    await runTicks(stack, 20, false)
    expect(stack.killed).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(0)
    expect((await stack.platform.issues.get(ticket)).state).toBe(DEFAULT_STATES.dispatched)
  })

  it('A 面复核通过=续租：落 STALL 续租锚、不杀、不入断路（响置体直测）', async () => {
    const issue = { id: 'T-1', title: 'x', state: DEFAULT_STATES.dispatched, type: 'task', level: 0, updated: new Date(0).toISOString(), dept: 'd', lane: 'core' } as IssueRecord
    const entry: Inflight = {
      ticket: 'T-1',
      workRecordId: 'w-1',
      executor: 'dsh-mid',
      handle: { executor: 'dsh-mid', sessionId: 's-1', pid: 1 },
      workspace: '/tmp/x',
      briefPath: '/tmp/x/brief.md',
      attempt: 1,
      lane: 'core',
      personId: 'AGENT-1',
      dispatchedAtSeq: 1,
    }
    const inflight = new Map<TicketId, Inflight>([['T-1', entry]])
    const emitted: Array<{ event: string; note?: string }> = []
    const strikeBreaker = vi.fn(async () => undefined)
    const host: StallResponseHost = {
      platform: { issues: { get: async () => issue } } as unknown as StallResponseHost['platform'],
      ledger: { endWorkRecord: vi.fn(), listWorkRecords: () => [] } as unknown as StallResponseHost['ledger'],
      registry: { resolve: () => ({ kill: vi.fn() }) } as unknown as StallResponseHost['registry'],
      inflight,
      config: { ...ENGINE_CONFIG_DEFAULTS, company: 'demo', rootDir: '/tmp', defaultPersonId: 'AGENT-1', deptFallback: 'd', defaultLane: 'core', stallAfterMs: 1_000, stallKillAfterAlarms: 1 } as EngineConfig,
      lanes: { release: vi.fn() } as unknown as StallResponseHost['lanes'],
      flowOf: () => undefined,
      transitionHostOf: () => ({}) as never,
      makeEvent: (name, _issue, _attempt, _tickEvents, extra) => {
        emitted.push({ event: name, ...(extra?.note !== undefined ? { note: extra.note } : {}) })
      },
      strikeBreaker,
      now: () => 10_000,
      currentSeq: () => 99,
      workerKeysEnabled: false,
      probeActivity: () => ({ lastActivityAt: 9_500, source: 'session-mtime', pidAlive: true, detail: 'sessionMtime=fresh' }),
      effectiveStallAfterMs: () => 5_000,
      reportProblem: () => undefined,
    }
    const action = {
      type: 'stall_alarm' as const,
      code: 'STALL_SILENT' as const,
      ticket: 'T-1',
      silentMs: 9_000,
      stallThresholdMs: 1_000,
      livenessSource: 'session-mtime' as const,
      livenessAnchorAt: 1_000,
    }
    const index = { attemptOf: () => 2, stallStrikesOf: () => 0 } as never
    // 动态导入：本文件其余用例在改前基线可独立运行（红证=行为红，不是收集期模块缺失）
    const { executeStallResponse } = await import('../../../src/engine/watchdog/stall-response.ts')
    const result = await executeStallResponse(host, action, index, [] as EventRecord[])
    expect(result.ok).toBe(true)
    expect(result.detail ?? '').toContain('续租')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.event).toBe('STALL')
    expect(emitted[0]?.note ?? '').toContain('活性复核通过')
    expect(inflight.has('T-1')).toBe(true)
    expect(strikeBreaker).not.toHaveBeenCalled()
  })
})

describe('B 面 work_record interrupted 即时收口（studio-dev-505）', () => {
  it('重启接管（record=interrupted、无在途句柄）→ 首拍 GATE_FAIL 收口，不等陈旧锚', async () => {
    const stack = makeStack({ label: 'b-face', fakeAdapter: 'stalled', stallAfterMs: 60_000 })
    const ticket = await newTicket(stack)
    await tick(stack, false) // 派发（fake stalled 常驻）
    await stack.engine.dispose() // 停机：record 留 running（R-B 前命孤儿面）
    takeOverRunningWorkRecords(stack.ledger, stack.clock.now()) // serve 启动例行接管 → interrupted
    expect(stack.ledger.listWorkRecords({ issue: ticket }).filter((r) => r.status === 'interrupted')).toHaveLength(1)
    // 新引擎（同一台账/平台）＝重启后首拍
    const registry = createRegistry()
    registry.register(createFakeAdapter({ mode: 'stalled', name: 'fake' }), { default: true })
    const restarted = engineOf({
      platform: stack.platform,
      ledger: stack.ledger,
      registry,
      clock: stack.clock.now,
      rootDir: path.join(stack.root, 'var'),
      stallAfterMs: 60_000,
      stallKillAfterAlarms: 2,
    })
    stack.clock.advance(1000)
    await restarted.tick()
    const fails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(fails).toHaveLength(1)
    expect(fails[0]?.note ?? '').toContain('WORKER_DEAD')
    expect(fails[0]?.note ?? '').toContain('work_record=interrupted')
    // 文案自洽（studio-dev-522）：即时收口非阈值触发——note 不得前置「超阈值」
    // （09:08:27 实测 457ms < 3600000ms 字面矛盾；只改文案，判据/门禁零变）
    expect(fails[0]?.note ?? '').toContain('即时收口')
    expect(fails[0]?.note ?? '').not.toContain('超阈值')
    // 收口＝回滚首批位（可重派），非收割结论
    expect((await stack.platform.issues.get(ticket)).state).toBe(DEFAULT_STATES.fresh)
  })
})

describe('真死仍收口（回归：不为降误杀放宽真死检测）', () => {
  it('会话停写 + 阈值到点 → 整树杀一次、工位 interrupted（不落 GATE_FAIL 收割结论）', async () => {
    const stack = makeStack({ label: 'dead', sessionAgeMs: 10 * 60_000, stallAfterMs: 60_000, stallKillAfterAlarms: 2 })
    const ticket = await newTicket(stack)
    await tick(stack, false) // 派发
    await runTicks(stack, 65, false) // 65s：第 61s 首告、第 62s 咬合（2 次告警）
    // 咬合后回首批位会重派（rescan），新誓worker 同样真死→可继续咬合；至少一次整树杀即证真死检测未放宽
    expect(stack.killed.length).toBeGreaterThanOrEqual(1)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(0) // 接管≠收割
    expect(stack.ledger.listWorkRecords({ issue: ticket }).some((r) => r.status === 'interrupted')).toBe(true)
  })
})
