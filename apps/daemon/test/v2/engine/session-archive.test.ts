/**
 * session-archive —— 会话归档/守护计时接线（studio-dev-551）V2 定向红→绿用例
 *
 * 依据（实现单引用）：
 *   - docs/17-§2 主循环七相位（相位 3 派发 / 相位 4 收割与末段看护的落点）；
 *   - docs/17-§3 sessions 行（session_id/issue/工号/archive_path/started/ended/turns，列集零变更）；
 *   - docs/17-§6 收割四要件（记录落库在判定**之后**——写失败不倒推 GATE 结论；接管≠收割）；
 *   - docs/v2/07-§五 EXEC-04（会话证据归档收割入台账＝V07-P2-2 追账项）。
 *
 * 断言纪律（改前必红）：
 *   - 行为面用真栈（fake 平台/执行体，真 SQLite 台账/真引擎）+ 台账真查询；
 *   - 不 mock LLM、不重试；守护计时只断言有证据的 inflightMs/turns，不伪造 silentMs。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { clearActivityProbeCache, createRegistry } from '@studio-next/adapters'
import type { ExecutorAdapter, Handle, StreamEvent, TaskBrief } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type EngineConfig } from '../../../src/engine/engine.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { takeOverRunningWorkRecords } from '../../../src/engine/harvest/inflight-takeover.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import {
  T0,
  createTicket,
  createWorkStack,
  disposeWorkStacks,
  eventsNamed,
  runTicks,
  type WorkTestStack,
} from '../records/fixtures/work-stack.ts'

const customRoots: string[] = []
const prevDshHome = process.env.DSH_HOME

afterAll(async () => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevDshHome
  for (const root of customRoots) rmSync(root, { recursive: true, force: true })
  customRoots.length = 0
  await disposeWorkStacks()
})

function assemblerOf(): ReturnType<typeof createDefaultAssembler> {
  return createDefaultAssembler({
    fwkVersion: 'v0.5-test',
    frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
    snapshot: DEMO_SNAPSHOT,
    acceptance: ['echo demo-ok'],
    docRefs: ['docs/17-§2（主循环七相位）'],
  })
}

interface CustomStack {
  readonly ledger: Ledger
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly engine: Engine
  readonly clock: { now(): number; advance(ms: number): void }
  readonly root: string
}

/** 自定义执行体真栈（会话 id/executor 会话 id 注入面；与 work-stack 夹具同构、只换 adapter） */
function customStack(label: string, adapter: ExecutorAdapter, overrides: Partial<EngineConfig> = {}): CustomStack {
  const root = mkdtempSync(path.join(tmpdir(), `sn-sess-${label}-`))
  customRoots.push(root)
  let t = T0
  const clock = {
    now: (): number => t,
    advance(ms: number): void {
      t += ms
    },
  }
  const registry = createRegistry()
  registry.register(adapter, { default: true })
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: assemblerOf(),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      stallAfterMs: 60_000,
      ...overrides,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { ledger, platform, engine, clock, root }
}

/** 完成形态执行体：落 REPORT、流收尾四要件齐；会话 id 可注入（''=非法，构造 start 写失败面） */
function okAdapter(opts: { sessionId: string; executorSessionId?: string; turns?: number }): ExecutorAdapter {
  return {
    name: 'dsh-mid',
    capabilities: { budget_cap: false, cancel_turn: false, session_resume: true, agents_md: 'user_level', cost_native: false },
    async detect() {
      return { name: 'dsh-mid', version: '0.0.0-test', ok: true, gaps: [] }
    },
    async estimate() {
      return { estimated: { usd: 0.01 }, confidence: 1 }
    },
    async launch(task: TaskBrief): Promise<Handle> {
      mkdirSync(task.workspace, { recursive: true })
      writeFileSync(path.join(task.workspace, 'REPORT.md'), '# 会话归档探针\n\n验收：echo demo-ok\n', 'utf8')
      return {
        executor: 'dsh-mid',
        sessionId: opts.sessionId,
        pid: 0,
        ...(opts.executorSessionId !== undefined ? { executorSessionId: opts.executorSessionId } : {}),
      }
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield { type: 'log', text: '[dsh-mid] 会话归档探针产出文本' }
      yield { type: 'turn_end', completed: true, usage: { input: 100, output: 50 } }
    },
    async resultStats() {
      return { cost: { usd: 0.01 }, tokens: { input: 100, output: 50 }, duration: 10, turns: opts.turns ?? 2 }
    },
    async kill() {
      /* 无真进程 */
    },
  }
}

function sessionRowOf(stack: WorkTestStack, sessionId: string) {
  return stack.ledger.listSessions().find((s) => s.session_id === sessionId)
}

describe('相位 3 派发：insertSession start 行落库（生产写者接线）', () => {
  it('派发后 sessions 有 start 行（ended_at 空）；行字段与入参对齐', async () => {
    const stack = await createWorkStack('sess-start')
    const ticket = await createTicket(stack)
    await runTicks(stack, 1) // 拍 1 派发
    const rows = stack.ledger.listSessions({ issue: ticket })
    expect(rows).toHaveLength(1) // 改前红：生产调用=0，sessions 恒 0 行
    expect(rows[0]?.session_id).toBe('fake-work-1')
    expect(rows[0]?.person_id).toBe('AGENT-1')
    expect(rows[0]?.started_at).toBe(T0 + 1000)
    expect(rows[0]?.ended_at).toBeUndefined()
  })
})

describe('相位 4 收割：会话收口 + 守护计时 note 锚', () => {
  it('收割成功 → ended_at/turns 收口；GATE_PASS note 携 session/inflightMs 锚', async () => {
    const stack = await createWorkStack('sess-ok')
    const ticket = await createTicket(stack)
    await runTicks(stack, 2) // 派发 → 收割成功
    const row = sessionRowOf(stack, 'fake-work-1')
    expect(row).toBeDefined()
    expect(typeof row?.ended_at).toBe('number')
    expect(row?.turns).toBe(1) // fake resultStats.turns=1
    const gatePass = eventsNamed(stack.ledger, ticket, 'GATE_PASS')
    expect(gatePass).toHaveLength(1)
    expect(gatePass[0]?.note ?? '').toContain('session=fake-work-1:closed')
    expect(gatePass[0]?.note ?? '').toContain('inflightMs=1000')
  })

  it('收割失败 → 失败面同样收口；GATE_FAIL note 携 session 锚（不留 ended_at=NULL）', async () => {
    const stack = await createWorkStack('sess-fail')
    stack.mode.value = 'incomplete' // 四要件缺终态
    const ticket = await createTicket(stack)
    await runTicks(stack, 2)
    const row = sessionRowOf(stack, 'fake-work-1')
    expect(typeof row?.ended_at).toBe('number')
    const gateFail = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFail).toHaveLength(1)
    expect(gateFail[0]?.note ?? '').toContain('session=fake-work-1:closed')
  })

  it('看护咬合（STALL kill）→ 被杀会话同体收口；STALL note 携 session 锚', async () => {
    const stack = await createWorkStack('sess-stall', { stallAfterMs: 1_000, stallKillAfterAlarms: 1 })
    stack.mode.value = 'stalled'
    const ticket = await createTicket(stack)
    await runTicks(stack, 3) // 派发 → 静默超阈 → 咬合整树杀
    const row = sessionRowOf(stack, 'fake-work-1')
    expect(typeof row?.ended_at).toBe('number')
    const stall = eventsNamed(stack.ledger, ticket, 'STALL').find((e) => (e.note ?? '').includes('咬合'))
    expect(stall).toBeDefined()
    expect(stall?.note ?? '').toContain('session=fake-work-1:closed')
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(0) // 接管≠收割
  })
})

describe('启动接管（R-B）：前命孤儿会话同体收口（非第八相位）', () => {
  it('takeOverRunningWorkRecords 收口 running 工位时同体收口其会话', async () => {
    const stack = await createWorkStack('sess-takeover')
    const ticket = await createTicket(stack)
    stack.mode.value = 'stalled'
    await runTicks(stack, 1) // 派发（在途）
    await stack.engine.dispose() // 停机：work_record 留 running
    const takeover = takeOverRunningWorkRecords(stack.ledger, stack.clock.now() + 1)
    expect(takeover.takenOver).toBe(1)
    expect(takeover.sessionsClosed).toBe(1)
    const row = sessionRowOf(stack, 'fake-work-1')
    expect(typeof row?.ended_at).toBe('number')
    expect(stack.ledger.listWorkRecords({ issue: ticket })[0]?.status).toBe('interrupted')
  })
})

describe('fail-closed：行缺失不臆造 / start 写失败不派', () => {
  it('会话行缺失 → 收割结论不变（GATE_PASS 照落），note 明报 :missing 且零补插', async () => {
    const stack = await createWorkStack('sess-missing')
    const ticket = await createTicket(stack)
    await runTicks(stack, 1) // 派发（start 行已落）
    stack.ledger.db.exec('DELETE FROM sessions') // 构造负向场景：行缺失（不臆造补插）
    await runTicks(stack, 1) // 收割
    expect(stack.ledger.listSessions({ issue: ticket })).toHaveLength(0) // 不补插
    const gatePass = eventsNamed(stack.ledger, ticket, 'GATE_PASS')
    expect(gatePass).toHaveLength(1) // 四要件判据不被写失败倒推
    expect(gatePass[0]?.note ?? '').toContain('session=fake-work-1:missing')
  })

  it('start 行写失败（session id 非法）→ SESSION_ARCHIVE_START_FAILED＋DISPATCH_FAIL，不落工时单', async () => {
    const stack = customStack('start-fail', okAdapter({ sessionId: '' }))
    const created = await stack.platform.issues.create({ title: '会话归档失败面', type: 'task', level: 0 })
    const report = await stack.engine.tick() // 首拍：采集→派发（start 写失败即中断）
    const dispatch = report.phases.dispatch.results.find((r) => r.ticket === created.id)
    expect(dispatch?.ok).toBe(false)
    expect(dispatch?.detail ?? '').toContain('SESSION_ARCHIVE_START_FAILED')
    expect(stack.ledger.listWorkRecords()).toHaveLength(0) // 无归档不派：工时单零行
    expect(stack.ledger.listSessions()).toHaveLength(0)
    expect((await stack.platform.issues.get(created.id)).state).toBe('新单') // 未进已派发
  })

  it('dsh 归档路径：会话落盘件存在 → archive_path 回填（无证据不猜路径的对照=缺省）', async () => {
    const dshHome = mkdtempSync(path.join(tmpdir(), 'sn-sess-dsh-home-'))
    customRoots.push(dshHome)
    process.env.DSH_HOME = dshHome
    clearActivityProbeCache()
    const sid = 'sess-archive-551'
    const dir = path.join(dshHome, 'sessions', '--studio-dev-sess551--', `session-${sid}`)
    mkdirSync(dir, { recursive: true })
    const sessionFile = path.join(dir, 'session.v4.jsonl.zstd')
    writeFileSync(sessionFile, 'session')
    const stack = customStack('archive-path', okAdapter({ sessionId: 'dsh-work-1', executorSessionId: sid }))
    const created = await stack.platform.issues.create({ title: '归档路径探针', type: 'task', level: 0 })
    await stack.engine.tick() // 派发
    await stack.engine.tick() // 收割
    const row = stack.ledger.getSession('dsh-work-1')
    expect(row?.archive_path).toBe(sessionFile)
    expect(row?.turns).toBe(2)
    expect(typeof row?.ended_at).toBe('number')
    const gatePass = eventsNamed(stack.ledger, created.id, 'GATE_PASS')
    expect(gatePass[0]?.note ?? '').toContain(`;archive=${sessionFile}`)
  })
})
