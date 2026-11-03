/**
 * dispatch-selection —— 执行器选择链接进 dispatch（GAP-V2-04）V2 定向红→绿用例
 *
 * 依据（实现单引用）：
 *   - docs/v2/07 §一「执行器选择链」：**单据指定＞岗位绑定＞默认（默认＝DSH）**；选择不是授权
 *     （选择只回答「这单由哪家跑」）；强策略岗位无解不派工（fail-closed，不得静默回落默认家）。
 *   - docs/v2/14 §1.5 PORT-EXEC `selectExecutor(c: SelectionChain, rc): PortResult<ExecutorChoice>`。
 *   - docs/v2/17 NEG-RUN-05（无登记选择链直连非主绑定执行器=拒）＋GAP-V2-04（派生树登记网关
 *     未建前以代偿校验拒）。
 *   - docs/17-§2 相位 3 派发（主循环七相位）；docs/17-§6 收割四要件（拒派=不启动，不静默降级）。
 *
 * 改前必红（红证原始输出归档见 REPORT「定向红→绿」段）：`dispatchSelection` 未接线时，
 * 「岗位绑定非主绑定 + 空登记链」被静默放行（DISPATCH 照发、无选择锚）；接线后：
 *   ① 未登记 → 拒派（ESCALATE 留痕、零 DISPATCH、零 work_record、状态不前移）；
 *   ② 已登记（岗位/单据）→ 放行且 DISPATCH note 携 `;selection=` 锚（记录面可判读）；
 *   ③ 主绑定缺省链 → 放行（`default:primary`，合法行为零变化）；
 *   ④ 解析失败/指向别家 → fail-closed（不静默降级）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRegistry, type ExecutorRegistry } from '@studio-next/adapters'
import { DEFAULT_STATES } from '@studio-next/core'
import type { EventRecord, FlowPlatform, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

type ExecutorName = 'dsh' | 'claude' | 'codex' | 'kimi'

/** 选择链登记条目（结构同 packages/adapters bindcard SelectionChainEntry——本文件不直引内部件） */
interface ChainEntryInput {
  ticket: string
  executor: ExecutorName
  source: 'ticket' | 'position'
  positionRef?: string
  registeredBy: string
  reason: string
}

interface Stack {
  readonly platform: FlowPlatform
  readonly ledger: Ledger
  readonly engine: Engine
  readonly clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  /** 登记链（按真单号生成——单号先于引擎创建） */
  readonly chainFor?: (ticket: TicketId) => readonly ChainEntryInput[]
  /** 岗位绑定 executor 偏好（org-config people[].executor 的注入形；缺省=无偏好） */
  readonly personExecutors?: Readonly<Record<string, string>>
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

/** 测试栈：fake 平台 + fake 适配器（dsh-mid 缺省／claude 备选）+ tmp 台账（零外部依赖） */
async function makeStack(label: string, opts: StackOptions = {}): Promise<{ stack: Stack; ticket: TicketId }> {
  const root = mkdtempSync(path.join(tmpdir(), `sn-dispatch-selection-${label}-`))
  roots.push(root)
  let t = Date.parse('2026-11-03T00:00:00.000Z')
  const clock = { now: (): number => t, advance(ms: number): void { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const registry: ExecutorRegistry = createRegistry()
  // 缺省=主绑定家族（dsh-mid 归 dsh 家族）；备选=非主绑定 claude
  registry.register(createFakeAdapter({ name: 'dsh-mid' }), { default: true })
  registry.register(createFakeAdapter({ name: 'claude' }))
  const created = await platform.issues.create({ title: '执行器选择链单', type: 'task', level: 0, assignee: 'AGENT-1' })
  const ticket = created.id
  const entries = opts.chainFor !== undefined ? opts.chainFor(ticket) : []
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
      harvestSliceMs: 5,
    },
    people: DEMO_SNAPSHOT.people,
    dispatchSelection: {
      chain: { entries },
      personExecutors: opts.personExecutors ?? {},
    },
  })
  return { stack: { platform, ledger, engine, clock }, ticket }
}

async function tick(stack: Stack): Promise<Awaited<ReturnType<Engine['tick']>>> {
  stack.clock.advance(1000)
  return stack.engine.tick()
}

function eventsNamed(ledger: Ledger, ticket: TicketId, name: string): EventRecord[] {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === name)
}

function dispatchNotes(ledger: Ledger, ticket: TicketId): string[] {
  return eventsNamed(ledger, ticket, 'DISPATCH').map((e) => e.note ?? '')
}

function runningExecutor(ledger: Ledger, ticket: TicketId): string | undefined {
  return ledger.listWorkRecords({ issue: ticket }).find((r) => r.status === 'running')?.executor
}

// ---------------------------------------------------------------------------
// ① 负向（NEG-RUN-05）：未登记选择链直连非主绑定执行器 → 拒派并留痕
// ---------------------------------------------------------------------------

describe('NEG-RUN-05：非主绑定未登记 → fail-closed（拒派＋留痕）', () => {
  it('岗位绑定 claude＋空登记链 → 拒派：零 DISPATCH／零 work_record／状态不前移／ESCALATE 留痕', async () => {
    const { stack, ticket } = await makeStack('unregistered', { personExecutors: { 'AGENT-1': 'claude' } })
    const report = await tick(stack)
    // 拒派：派发计数 0、动作结果如实失败、detail 指名 NEG-RUN-05 子因
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.actionResults).toHaveLength(1)
    expect(report.actionResults[0]?.ok).toBe(false)
    expect(report.actionResults[0]?.detail ?? '').toContain('dispatch/selection-unregistered')
    expect(report.actionResults[0]?.detail ?? '').toContain('NEG-RUN-05')
    // 不启动：零 DISPATCH 事件、零工时单、平台态停在初态
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(0)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(0)
    expect((await stack.platform.issues.get(ticket)).state).toBe(DEFAULT_STATES.fresh)
    // 留痕：ESCALATE 事件（note 携子因与处置指引）
    const escalates = eventsNamed(stack.ledger, ticket, 'ESCALATE')
    expect(escalates).toHaveLength(1)
    expect(escalates[0]?.note ?? '').toContain('dispatch/selection-unregistered')
    expect(escalates[0]?.note ?? '').toContain('NEG-RUN-05')
  })

  it('拒派留痕每单每因一次（rescan 重派不刷屏）；派发仍恒拒', async () => {
    const { stack, ticket } = await makeStack('dedupe', { personExecutors: { 'AGENT-1': 'claude' } })
    await tick(stack)
    await tick(stack)
    await tick(stack)
    expect(eventsNamed(stack.ledger, ticket, 'ESCALATE')).toHaveLength(1)
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(0)
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(0)
  })

  it('岗位绑定未知执行器（ENU-88 外）→ dispatch/executor-unknown 拒派（不猜不降级）', async () => {
    const { stack, ticket } = await makeStack('unknown', { personExecutors: { 'AGENT-1': 'gpt-5' } })
    const report = await tick(stack)
    expect(report.actionResults[0]?.ok).toBe(false)
    expect(report.actionResults[0]?.detail ?? '').toContain('dispatch/executor-unknown')
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(0)
  })

  it('登记链指向别家（岗位 codex vs 登记 claude）→ dispatch/selection-mismatch 拒派', async () => {
    const { stack, ticket } = await makeStack('mismatch', {
      personExecutors: { 'AGENT-1': 'codex' },
      chainFor: (t) => [{ ticket: t, executor: 'claude', source: 'position', positionRef: 'AGENT-1', registeredBy: 'qa', reason: '异源复核' }],
    })
    const report = await tick(stack)
    expect(report.actionResults[0]?.ok).toBe(false)
    expect(report.actionResults[0]?.detail ?? '').toContain('dispatch/selection-mismatch')
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ② 正向：已登记放行（岗位/单据两源）＋主绑定缺省链
// ---------------------------------------------------------------------------

describe('选择链放行：单据指定＞岗位绑定＞默认（DISPATCH note 携选择锚）', () => {
  it('岗位绑定 claude＋已登记（source=position）→ 放行：`;selection=position:<单>@claude`', async () => {
    const { stack, ticket } = await makeStack('position-ok', {
      personExecutors: { 'AGENT-1': 'claude' },
      chainFor: (t) => [{ ticket: t, executor: 'claude', source: 'position', positionRef: 'AGENT-1', registeredBy: 'qa-lead', reason: '异源复核' }],
    })
    const report = await tick(stack)
    expect(report.phases.dispatch.dispatched).toBe(1)
    const notes = dispatchNotes(stack.ledger, ticket)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain(`;selection=position:${ticket}@claude`)
    expect(runningExecutor(stack.ledger, ticket)).toBe('claude')
    expect((await stack.platform.issues.get(ticket)).state).toBe(DEFAULT_STATES.dispatched)
  })

  it('主绑定缺省链（岗位 dsh＋空登记）→ 放行：`;selection=default:primary@dsh`，候选 dsh-mid 家族保留', async () => {
    const { stack, ticket } = await makeStack('default-primary', { personExecutors: { 'AGENT-1': 'dsh' } })
    const report = await tick(stack)
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(dispatchNotes(stack.ledger, ticket)[0]).toContain(';selection=default:primary@dsh')
    expect(runningExecutor(stack.ledger, ticket)).toBe('dsh-mid')
  })

  it('单据指定优先于岗位绑定（岗位 dsh＋单据登记 claude）→ 按单据派 claude', async () => {
    const { stack, ticket } = await makeStack('ticket-priority', {
      personExecutors: { 'AGENT-1': 'dsh' },
      chainFor: (t) => [{ ticket: t, executor: 'claude', source: 'ticket', registeredBy: 'producer', reason: '异源独立性' }],
    })
    const report = await tick(stack)
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(dispatchNotes(stack.ledger, ticket)[0]).toContain(`;selection=ticket:${ticket}@claude`)
    expect(runningExecutor(stack.ledger, ticket)).toBe('claude')
  })
})

// ---------------------------------------------------------------------------
// ③ 配置面：daemon.yaml dispatchSelections 解析/校验 fail-closed
// ---------------------------------------------------------------------------

describe('配置面：dispatchSelections（JSON 数组字符串）解析即验', () => {
  const base = ['db: /tmp/x.sqlite', 'platform: fake', 'company: demo', 'rootDir: /tmp/x', 'tickMs: 1000'].join('\n')

  it('合法登记 → 链条目可判读（ticket/executor/source/positionRef/registeredBy/reason）', () => {
    const cfg = parseDaemonConfig(
      `${base}\ndispatchSelections: '[{"ticket":"STUDIO-620","executor":"claude","source":"position","positionRef":"AGENT-1","registeredBy":"qa-lead","reason":"异源复核"}]'`,
    )
    expect(cfg.dispatchSelections?.entries).toHaveLength(1)
    const entry = cfg.dispatchSelections?.entries[0]
    expect([entry?.ticket, entry?.executor, entry?.source, entry?.positionRef, entry?.registeredBy]).toEqual([
      'STUDIO-620',
      'claude',
      'position',
      'AGENT-1',
      'qa-lead',
    ])
  })

  it('坏条目（未知执行器／缺登记人）→ CONFIG_INVALID 拒启（不静默忽略段）', () => {
    expect(() =>
      parseDaemonConfig(`${base}\ndispatchSelections: '[{"ticket":"T-1","executor":"gpt-5","source":"ticket","registeredBy":"x","reason":"y"}]'`),
    ).toThrow(/dispatch\/executor-unknown|dispatch\/selection-invalid/)
    expect(() =>
      parseDaemonConfig(`${base}\ndispatchSelections: '[{"ticket":"T-1","executor":"claude","source":"ticket","registeredBy":"","reason":"y"}]'`),
    ).toThrow(/dispatch\/selection-invalid/)
  })

  it('非 JSON 数组 / 未知条目键 → CONFIG_INVALID 拒启', () => {
    expect(() => parseDaemonConfig(`${base}\ndispatchSelections: 'not-json'`)).toThrow(/dispatchSelections/)
    expect(() =>
      parseDaemonConfig(`${base}\ndispatchSelections: '[{"ticket":"T-1","executor":"claude","source":"ticket","registeredBy":"x","reason":"y","extra":1}]'`),
    ).toThrow(/dispatchSelections/)
  })
})
