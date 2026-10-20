/**
 * noop-observability —— noop 决策观测面（DEV-40 ②，2026-10-20 哨查事故防复发）
 *
 * 事故面：外部建单（放单脚本）落平台默认态（Taiga=New）→ decide 判 NOOP_UNKNOWN_STATE
 * 静默跳过——无台账事件、无平台动作、无日志行=观察黑洞（14 张 P0/P1 单静默卡 2 小时，
 * 靠台账缺席+镜像态反推才定位）。
 *
 * 修法（docs/17-§2 state-diff 相位）：TickDecisionEntry 携决策时平台态 state；serve
 * 每拍为每个 noop 决策落一行日志（renderNoopDecision：单号+原因码+态）。事件词表
 * 冻结（contract EVENT_NAMES）不扩事件——选 daemon 日志行口径（任务书 ② 两口径择一）。
 *
 * 断言面：
 *   1. 事故复现（流外态）：单据落 'New' → decide NOOP_UNKNOWN_STATE（noop）→ 决策条目
 *      携 state='New'；noopLinesOf 产出含单号+原因码+态的日志行
 *   2. 流缺失（未定级单）：level 缺失 → NOOP_UNKNOWN_FLOW 同样可见（「等 noop 决策」
 *      全类经同一观测面）
 *   3. 事故单账面（DEV-49 A4 升级，2026-10-22：日志行不再是唯一观测面）：流外态单
 *      额外落**恰好一条** ESCALATE 事件（UNKNOWN_STATE 哨——每单每态一次，事件派生
 *      键去重；词表既有名不扩词）+ 零动作零派发
 *   4. renderNoopDecision 纯函数行格式（单号+原因码+态+拍号）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickDecisionEntry, type TickReport } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT, noopLinesOf, renderNoopDecision } from '../../src/assembly/serve.ts'

/** 测试栈：每用例独立台账/平台/引擎（fake 全家桶 + tmp 库 + 假时钟） */
interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildStack(id: string): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 20, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
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
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { platform, ledger, engine, clock }
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-noop-observability-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('noop 决策观测面（DEV-40 ②：静默 noop=观察黑洞）', () => {
  it('事故复现：流外态单（New）→ NOOP_UNKNOWN_STATE 决策携 state + 恰好一条 ESCALATE 哨（DEV-49 A4：日志行+台账双观测；零动作/零派发/平台态不动）', async () => {
    const stack = buildStack('out-of-flow')
    // 外部建单（放单脚本口径）：直接平台 create 落平台默认态 New（fake 经 initialState 模拟
    // Taiga 默认态——流外态进 decide）
    const created = await stack.platform.issues.create({
      title: '外部放单：P0 单',
      type: 'task',
      dept: 'departments/工程部',
      level: 0,
      initialState: 'New',
    })
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()

    // 决策条目：noop + 原因码 + 决策时平台态（观测面载荷）
    const entry = report.phases.stateDiff.decisions.find((d) => d.ticket === created.id)
    expect(entry).toMatchObject({ code: 'NOOP_UNKNOWN_STATE', actionType: 'noop', state: 'New' })

    // 观测行：单号+原因码+态（serve 每拍逐条落）
    const lines = noopLinesOf(report)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`noop：${created.id} code=NOOP_UNKNOWN_STATE state=New`)

    // 负断言：noop 无平台动作——零动作/零派发
    expect(report.actions.filter((a) => a.ticket === created.id)).toEqual([
      { type: 'noop', code: 'NOOP_UNKNOWN_STATE', ticket: created.id },
    ])
    expect(report.phases.dispatch.dispatched).toBe(0)
    // DEV-49 A4 升级（docs/52-§十）：流外态单不再只靠日志行——恰好一条 ESCALATE
    // UNKNOWN_STATE 哨（词表既有名；每单每态一次）落台账=账面可查、面板可见
    expect(report.phases.collect.unknownStateAlarmed).toBe(1)
    const events = stack.ledger.queryEvents({ issue: created.id })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: 'ESCALATE', issue: created.id })
    expect(events[0]?.note).toContain('UNKNOWN_STATE;state=New')
    // 平台态不动（哨=观测非驱动；根治动作在 onboard factory 三步）
    expect((await stack.platform.issues.get(created.id)).state).toBe('New')

    // 洪泛控制：下一拍同单同态不重告（事件派生键去重——14 单事故级回流也不刷屏）
    stack.clock.advance(1000)
    const report2: TickReport = await stack.engine.tick()
    expect(report2.phases.collect.unknownStateAlarmed).toBe(0)
    expect(stack.ledger.queryEvents({ issue: created.id })).toHaveLength(1)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('流缺失：未定级单 → NOOP_UNKNOWN_FLOW 同样落 noop 观测行（「等 noop 决策」全类可见）', async () => {
    const stack = buildStack('no-flow')
    const created = await stack.platform.issues.create({ title: '未定级单', type: 'task' })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    const entry = report.phases.stateDiff.decisions.find((d) => d.ticket === created.id)
    expect(entry).toMatchObject({ code: 'NOOP_UNKNOWN_FLOW', actionType: 'noop', state: '新单' })
    expect(noopLinesOf(report)).toHaveLength(1)
    expect(noopLinesOf(report)[0]).toContain(`noop：${created.id} code=NOOP_UNKNOWN_FLOW state=新单`)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('renderNoopDecision 纯函数：行格式=拍号+单号+原因码+态（可 grep 的观测行）', () => {
    const entry: TickDecisionEntry = {
      ticket: 'T-9',
      intentKey: 'ticket|T-9',
      code: 'NOOP_UNKNOWN_FLOW',
      actionType: 'noop',
      state: '已交付',
    }
    expect(renderNoopDecision(7, entry)).toBe(
      '[serve] tick#7 noop：T-9 code=NOOP_UNKNOWN_FLOW state=已交付（noop 无台账事件，此行=唯一观测面）',
    )
  })

  it('非 noop 决策不产观测行（派发/hold 各有账面或事件面，不重复观测）', async () => {
    const stack = buildStack('non-noop')
    // 正常工单：落初态（新单）→ decide 派发（非 noop）——该拍无 noop 行
    await stack.platform.issues.create({ title: '正常工单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.phases.stateDiff.decisions.every((d) => d.actionType !== 'noop' || d.code !== 'NOOP_UNKNOWN_STATE')).toBe(true)
    expect(noopLinesOf(report)).toHaveLength(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
