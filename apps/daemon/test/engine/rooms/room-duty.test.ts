/**
 * 单据房间义务面引擎缝合单测（130-P3 频道供给扩展，130 提案 §6.7.1 需求行／DEV-20 P9-P10）。
 * 覆盖面（RoomDuty 可选注入 seam——engine 不 import matrix，义务面=结构接口）：
 *   1. DISPATCH 后 onDispatched({ticket,title,dept,assignee})——dept=单据字段，缺省回退人档
 *   2. onDispatched 失败：ESCALATE 明报**不阻断派发**（房间是沟通面不是执行前置）
 *   3. CLOSE 后 onClosed({ticket})（回收相位挂归档）
 *   4. onClosed 失败：ESCALATE 不阻断回收（CLOSE 落账、recycled 照计）
 *   5. 未注入（缺省关闭面）：零行为变更（回归锚）
 * 断言只对 seam 契约（参数形状/时序/失败语义）负责——房间供给算法在 packages/matrix
 * provision.test.ts 单测钉死，此处 fake RoomDuty 替身。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, FlowPlatform, TaskBrief } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import type { RoomDuty, RoomDutyDispatchArgs } from '../../../src/engine/rooms/room-duty.ts'

const T0 = Date.parse('2026-10-22T00:00:00.000Z')

/** 手搓公司快照（worker-key-lifecycle.test.ts 同形——不起 git init，本文件只测 seam 面） */
const SNAPSHOT: CompanySnapshot = {
  slug: 'rd-corp',
  name: '单据房间缝合公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

/** fake RoomDuty 替身：调用全录＋可注入失败 */
class RecordingRooms implements RoomDuty {
  dispatched: RoomDutyDispatchArgs[] = []
  closed: string[] = []
  failDispatch = false
  failClosed = false

  async onDispatched(args: RoomDutyDispatchArgs): Promise<void> {
    if (this.failDispatch) throw new Error('fake：房间供给断网')
    this.dispatched.push(args)
  }

  async onClosed(args: { ticket: string }): Promise<void> {
    if (this.failClosed) throw new Error('fake：房间归档断网')
    this.closed.push(args.ticket)
  }
}

interface Stack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  rooms: RecordingRooms
  clock: { now(): number; advance(ms: number): void }
}

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

function buildStack(id: string): { stack: Stack; launches: TaskBrief[] } {
  const rootDir = path.join(root, id)
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  const launches: TaskBrief[] = []
  registry.register(createFakeAdapter({ onLaunch: (task) => { launches.push(task) } }), { default: true })
  const person = SNAPSHOT.people[0]
  const rooms = new RecordingRooms()
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.7-room-duty-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: SNAPSHOT.slug,
      rootDir,
      defaultPersonId: person.id,
      deptFallback: SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
      defaultLane: SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
    },
    people: SNAPSHOT.people,
    makeId: deterministicIds(),
    rooms,
  })
  return { stack: { platform, ledger, engine, rooms, clock }, launches }
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-room-duty-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('DISPATCH 相位挂单据房间（DEV-20 P9）', () => {
  it('派发成功 → onDispatched({ticket,title,dept,assignee})——dept 取单据字段', async () => {
    const { stack, launches } = buildStack('dispatch-args')
    await stack.platform.issues.create({ title: '频道供给', type: 'task', level: 0, dept: 'departments/工程部' })
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(stack.rooms.dispatched).toEqual([{ ticket: 'T-1', title: '频道供给', dept: 'departments/工程部', assignee: 'AGENT-1' }])
    expect(launches).toHaveLength(1) // 沟通面在派发成功路径——launch 先发生
    stack.ledger.close()
  })

  it('单据无 dept → 回退派工人档案 dept（缺省回退链不炸）', async () => {
    const { stack } = buildStack('dispatch-fallback')
    await stack.platform.issues.create({ title: '无部门单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick()
    expect(stack.rooms.dispatched[0]).toMatchObject({ ticket: 'T-1', dept: 'departments/工程部' })
    stack.ledger.close()
  })

  it('供给失败 → ESCALATE 明报**不阻断派发**（房间=沟通面不是执行前置）', async () => {
    const { stack, launches } = buildStack('dispatch-fail')
    stack.rooms.failDispatch = true
    await stack.platform.issues.create({ title: '断网单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1) // 派发照成
    expect(launches).toHaveLength(1)
    const escalate = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'ESCALATE')
    expect(escalate?.note).toContain('单据房间供给失败')
    expect(escalate?.note).toContain('不阻派发')
    stack.ledger.close()
  })
})

describe('CLOSE 相位挂归档（DEV-20 P10）', () => {
  it('全生命周期到 CLOSE → onClosed({ticket})（回收相位）', async () => {
    const { stack } = buildStack('close-lifecycle')
    await stack.platform.issues.create({ title: '全链单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick() // tick1 派发
    for (let i = 0; i < 3; i += 1) {
      stack.clock.advance(1000)
      await stack.engine.tick() // tick2-4 GATE_PASS/QA_PASS/MERGE
    }
    expect(stack.rooms.closed).toEqual([]) // 关单前无归档
    stack.clock.advance(1000)
    const report = await stack.engine.tick() // tick5 回收
    expect(report.phases.recycle.recycled).toBe(1)
    expect(stack.rooms.closed).toEqual(['T-1'])
    expect(stack.rooms.dispatched).toHaveLength(1) // 派发面只此一次（幂等重跑收敛面在供给器层）
    stack.ledger.close()
  })

  it('归档失败 → ESCALATE 不阻断回收（CLOSE 落账、recycled 照计）', async () => {
    const { stack } = buildStack('close-fail')
    stack.rooms.failClosed = true
    await stack.platform.issues.create({ title: '归档断网单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick()
    for (let i = 0; i < 3; i += 1) {
      stack.clock.advance(1000)
      await stack.engine.tick()
    }
    const report = await stack.engine.tick() // tick5 回收
    expect(report.phases.recycle.recycled).toBe(1) // 回收照成
    const close = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'CLOSE')
    expect(close).toBeDefined()
    const escalate = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'ESCALATE')
    expect(escalate?.note).toContain('单据房间归档失败')
    stack.ledger.close()
  })
})

describe('未注入（缺省关闭面）：零行为变更（回归锚）', () => {
  it('无 rooms：dispatch→CLOSE 全链无房间面行为（fake adapter 全链照走）', async () => {
    const rootDir = path.join(root, 'default-off')
    const ledger = openLedger(path.join(root, 'default-off.sqlite'))
    let t = T0
    const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
    const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    const person = SNAPSHOT.people[0]
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.7-room-duty-test',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot: SNAPSHOT,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: clock.now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: SNAPSHOT.slug,
        rootDir,
        defaultPersonId: person.id,
        deptFallback: SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
        defaultLane: SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      },
      people: SNAPSHOT.people,
      makeId: deterministicIds(),
      // rooms 不注入
    })
    await platform.issues.create({ title: '缺省面单', type: 'task', level: 0 })
    clock.advance(1000)
    const report = await engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    const dispatch = ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch).toBeDefined()
    ledger.close()
  })
})
