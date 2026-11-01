// ▸ 落仓路径：apps/daemon/test/engine/assign/auto-assign.e2e.test.ts（新文件，全文照抄）

/**
 * auto-assign —— 自动派工分配器引擎接线 e2e（轨2 R1 登记项①，studio-dev-345）
 *
 * 规格依据（实现单引用，规格单一源=studio-dev-345 att1 deliverables/plan.md §1/§3）：
 *   - 面开：无 assignee 新单按部门自动选人（在途最小/同级轮转/并发帽），选人**写回
 *     平台 assignee**、DISPATCH note 携 `;autoassign=<工号>` 观测锚；
 *   - 同级轮转：等在途并列集 cursor 取位——第二张无主单轮转给第二人（不恒压第一人，
 *     本单痛点的红证）；
 *   - 全在帽=顺延不丢（fail-closed 不回退缺省人），收割放人后照派；
 *   - 已指派单恒走旧链（自动派工只补位，永不覆盖明确指派）；面关=行为零变（负对照）。
 *
 * 测试栈同 person-gate-queue.test.ts（fake platform/adapter + tmp sqlite ledger）；
 * 异泳道（lane: 'extra'）摘泳道闸以纯证人面——闸序 lane>person。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { FlowPlatform, PersonRef, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

// ————————————————————————— 测试栈 —————————————————————————

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  /** 轨2 R1① 面开关（缺省不注入=关——负对照用） */
  autoAssign?: boolean
  /** 镜像对账重决策节流（顺延单活动已被游标消费——rescan 唤回要 1） */
  mirrorRescanEveryTicks?: number
}

/** 双人同级（部门/工程部、level 2）：并列集=[AGENT-1,AGENT-2]（id 升序）——轮转可红证 */
const PEOPLE_2: readonly PersonRef[] = [
  { id: 'AGENT-1', name: '甲工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
  { id: 'AGENT-2', name: '乙工程师', login: 'agent-2', level: 2, dept: 'departments/工程部' },
]

function buildStack(id: string, opts?: StackOptions): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
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
      limits: { maxActionsPerTick: 4, maxInflight: 4 },
      ...(opts?.mirrorRescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: opts.mirrorRescanEveryTicks } : {}),
      ...(opts?.autoAssign !== undefined ? { autoAssign: opts.autoAssign } : {}),
    },
    people: PEOPLE_2,
  })
  return { platform, ledger, engine, clock }
}

async function createTicket(
  stack: TestStack,
  title: string,
  opts?: { lane?: string; assignee?: string },
): Promise<TicketId> {
  const created = await stack.platform.issues.create({ title, type: 'task', level: 0 })
  if (opts?.lane !== undefined) await stack.platform.issues.setField(created.id, 'lane', opts.lane)
  if (opts?.assignee !== undefined) await stack.platform.issues.setField(created.id, 'assignee', opts.assignee)
  return created.id
}

/** 推拍到该单 CLOSE（fake 全链 5 拍内到终态；上限内未到=断言面自会红） */
async function runTicks(stack: TestStack, n: number): Promise<TickReport[]> {
  const reports: TickReport[] = []
  for (let i = 0; i < n; i += 1) {
    stack.clock.advance(1000)
    reports.push(await stack.engine.tick())
  }
  return reports
}

let root = ''
const T0 = Date.UTC(2026, 10, 1, 0, 0, 0)

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-auto-assign-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 面开：写回/轮转/负载 —————————————————————————

describe('轨2 R1① 自动派工：选人写回 + 同级轮转 + 在途最小', () => {
  it('无主单派发即写回平台 assignee；DISPATCH note 携 autoassign 锚且 wait 锚形不漂', async () => {
    const stack = buildStack('assign-writeback', { autoAssign: true })
    await createTicket(stack, '无主单第一张')
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(1)
    // 并列集 [AGENT-1,AGENT-2]、cursor 0 → 首位 AGENT-1；写回平台（非仅内存）
    expect((await stack.platform.issues.get('T-1')).assignee).toBe('AGENT-1')
    // 观测锚：autoassign 在 seatbelt 之后、wait/prio/boost 之前（尾锚形冻结不漂）
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch).toBeDefined()
    expect(dispatch?.note).toContain(';autoassign=AGENT-1')
    expect(/;wait=(\d+);prio=(\d+);boost=(\d+)$/.exec(dispatch?.note ?? '')).not.toBeNull()
    await runTicks(stack, 8)
    expect((await stack.platform.issues.get('T-1')).state).toBe('已交付')
    stack.ledger.close()
  })

  it('同级轮转（痛点红证）：第二张无主单轮转给第二人——不恒压 AGENT-1', async () => {
    const stack = buildStack('assign-rotate', { autoAssign: true })
    await createTicket(stack, '无主单第一张')
    stack.clock.advance(1000)
    await stack.engine.tick() // T-1 → AGENT-1（cursor 0→1 落 kv）
    await runTicks(stack, 8) // T-1 全链收口（两人皆空）
    await createTicket(stack, '无主单第二张')
    const reports = await runTicks(stack, 8)
    expect(reports.some((r) => r.phases.dispatch.dispatched > 0)).toBe(true)
    // 并列集 [AGENT-1,AGENT-2]、cursor 1 → AGENT-2（旧链此时会再派 AGENT-1——病灶）
    expect((await stack.platform.issues.get('T-2')).assignee).toBe('AGENT-2')
    stack.ledger.close()
  })

  it('在途最小者优先（同拍两单）：T-1→AGENT-1、T-2→AGENT-2（拍内占用记账即时生效）', async () => {
    const stack = buildStack('assign-balanced', { autoAssign: true })
    await createTicket(stack, '无主单甲')
    await createTicket(stack, '无主单乙', { lane: 'extra' }) // 异泳道摘泳道闸——纯证人面
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(2)
    expect((await stack.platform.issues.get('T-1')).assignee).toBe('AGENT-1')
    // T-2 决策时 dispatchPersons 已记 T-1→AGENT-1（在工 1）→ 在途最小=AGENT-2
    expect((await stack.platform.issues.get('T-2')).assignee).toBe('AGENT-2')
    stack.ledger.close()
  })

  it('全在帽=顺延不丢（fail-closed 不回退缺省人）：HOLD_PERSON_BUSY → 收割放人后照派', async () => {
    const stack = buildStack('assign-cap-defer', { autoAssign: true, mirrorRescanEveryTicks: 1 })
    await createTicket(stack, '占帽一')
    await createTicket(stack, '占帽二', { lane: 'extra' })
    await createTicket(stack, '第三单顺延', { lane: 'extra2' }) // 异泳道——lane 闸放行纯证人闸
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(2) // T-1→AGENT-1、T-2→AGENT-2
    // 两人皆在帽（缺省 1）：分配器 all-at-cap → 不派缺省人 → 人闸面 HOLD_PERSON_BUSY
    const byTicket = new Map(t1.phases.stateDiff.decisions.map((d) => [d.ticket, d.code]))
    expect(byTicket.get('T-3')).toBe('HOLD_PERSON_BUSY')
    expect((await stack.platform.issues.get('T-3')).assignee).toBeUndefined() // 未写回=未错派
    // 收割放人后经 rescan 照派（顺延不丢）；cursor=1（同拍两写同值——无烧位）→ AGENT-2
    const reports = await runTicks(stack, 10)
    expect(reports.some((r) => r.phases.dispatch.dispatched > 0)).toBe(true)
    expect((await stack.platform.issues.get('T-3')).assignee).toBe('AGENT-2')
    expect((await stack.platform.issues.get('T-3')).state).toBe('已交付')
    stack.ledger.close()
  })
})

// ————————————————————————— 边界面：指派优先 / 面关零变 —————————————————————————

describe('轨2 R1① 边界面：人的指派恒优先、面关行为零变', () => {
  it('已指派单照旧派所指人（自动派工只补位不覆盖），note 无 autoassign 锚', async () => {
    const stack = buildStack('assign-explicit', { autoAssign: true })
    await createTicket(stack, '有人单', { assignee: 'AGENT-2' })
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(1)
    expect((await stack.platform.issues.get('T-1')).assignee).toBe('AGENT-2')
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).not.toContain('autoassign=')
    stack.ledger.close()
  })

  it('面关=行为零变（负对照）：无主单派 defaultPersonId，平台不写回、note 无锚', async () => {
    const stack = buildStack('assign-off') // autoAssign 缺省不注入=关
    await createTicket(stack, '面关无主单')
    stack.clock.advance(1000)
    const t1 = await stack.engine.tick()
    expect(t1.phases.dispatch.dispatched).toBe(1)
    expect((await stack.platform.issues.get('T-1')).assignee).toBeUndefined() // 旧链不写平台
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).not.toContain('autoassign=')
    await runTicks(stack, 8)
    expect((await stack.platform.issues.get('T-1')).state).toBe('已交付') // 全链不受面开关影响
    stack.ledger.close()
  })
})
