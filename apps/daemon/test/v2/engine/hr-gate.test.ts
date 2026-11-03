/**
 * hr-gate.test.ts —— 任职闸门「非在岗态不得发起出工」V2 定向红→绿用例（studio-dev-550）
 *
 * 依据（实现单引用）：
 *   - docs/v2/02 §三（任职六状态状态机）＋§3.4（**非在岗态不得发起出工**；闸门建成前的
 *     「REC-LIFE-02＋审计断言代偿」即本组用例收敛为真闸门的行为面）；
 *   - docs/v2/11 §14.2（任职迁移边/触发者——本闸只读事实，不写迁移）；
 *   - docs/v2/14 PORT-HR；docs/v2/17 GAP-V2-06 / NEG-REC-02；
 *   - docs/17-§2 相位 3 派发（发起出工的机器面）＋§6（收割四要件不动，本闸只加资格门）。
 *
 * 红→绿口径（改前必红）：改前 daemon 对 people[].status 零消费——暂停/退役者照常派发、
 * 台账零留痕；本组断言在改前全部为红（dispatched=1 / 无 HOLD_NOT_IN_SERVICE / 无
 * HR_GATE 事件），改后全绿。用例分三层：
 *   ① 控制组：在岗（active）放行，闸门不误伤；
 *   ② 红线：paused/suspended/retired/candidate/handover/settling → 拒（HOLD_NOT_IN_SERVICE，
 *      零 launch、平台态不动、tick report 取证、台账 ESCALATE `HR_GATE;REFUSED;...`）；
 *   ③ 事实面 fail-closed：strict 缺 status / 未知值 / 同工号冲突 / 查无工号 → 拒；
 *      compat（仅引擎直连面）缺 status 按 contract 缺省语义放行（生产装配恒 strict）。
 * 锚面：同单同事实只落一次 ESCALATE（`hr.gate.anchor.<单号>` 签名去重），事实变化再落。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import {
  createEmploymentGate,
  employmentGateNoteOf,
  employmentRefusalOf,
  employmentSnapshotOf,
  type HrGateMode,
} from '../../../src/engine/hr-gate/employment-gate.ts'

const T0 = Date.parse('2026-11-03T00:00:00.000Z')
const roots: string[] = []
let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sn-hr-gate-'))
  roots.push(root)
})

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

interface Stack {
  readonly ledger: Ledger
  readonly platform: FlowPlatform
  readonly engine: Engine
  /** 每次 launch 的单号（零 launch=拒出工面；TaskBrief 不携 person，按单号取证） */
  readonly launches: string[]
}

/** 测试栈：独立临时台账 + fake 平台/执行器（零外部依赖；不触 git/真平台/真 worker） */
function buildStack(label: string, opts: { people: readonly PersonRef[]; mode?: HrGateMode }): Stack {
  const ledger = openLedger(path.join(root, `${label}.sqlite`))
  const launches: string[] = []
  const platform = createFakePlatform({ now: () => new Date(T0).toISOString() })
  const adapter = createFakeAdapter({ onLaunch: (task) => { launches.push(task.ticket) } })
  const registry = createRegistry()
  registry.register(adapter, { default: true })
  // clock 每次读自增：拍内事件/工时 id 唯一（本组不依赖精确时刻；时间只经入参）
  let clock = T0
  const clockNow = (): number => (clock += 1)
  const snapshot: CompanySnapshot = { ...DEMO_SNAPSHOT, people: [...opts.people] }
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/v2/02 §3.4（非在岗态不得发起出工）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clockNow,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, `${label}-root`),
      defaultPersonId: opts.people[0]?.id ?? '',
      deptFallback: DEMO_SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
      defaultLane: DEMO_SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      // 逐拍镜像 rescan：多拍取证（第二拍仍出候选→仍拒→锚不重复落账）
      mirrorRescanEveryTicks: 1,
    },
    people: [...opts.people],
    ...(opts.mode !== undefined ? { hrGate: { mode: opts.mode } } : {}),
  })
  return { ledger, platform, engine, launches }
}

/** 建一张待派发新单（L0 类型流：新单 → 已派发） */
async function newTicket(platform: FlowPlatform, assignee: string | undefined): Promise<string> {
  const created = await platform.issues.create({
    title: '任职闸门用例单',
    type: 'task',
    dept: DEMO_SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
    level: 0,
    ...(assignee !== undefined ? { assignee } : {}),
  })
  return created.id
}

/** 台账里该单的 HR_GATE 留痕（note 前缀 HR_GATE;REFUSED）——事件枚举冻结，走既有 ESCALATE */
function hrGateNotes(ledger: Ledger, ticket: string): string[] {
  return ledger
    .queryEvents({ issue: ticket })
    .filter((e) => e.event === 'ESCALATE' && (e.note ?? '').startsWith('HR_GATE;REFUSED'))
    .map((e) => e.note ?? '')
}

const person = (id: string, status?: string): PersonRef => ({
  id,
  name: `测试员${id}`,
  login: id.toLowerCase(),
  level: 1,
  dept: 'departments/工程部',
  ...(status !== undefined ? { status } : {}),
})

describe('任职闸门：非在岗态不得发起出工（v2/02 §3.4；GAP-V2-06）', () => {
  it('① 控制组：在岗（active）放行——dispatched=1 / launch=1 / 闸门零拒', async () => {
    const stack = buildStack('active', { people: [person('ENG-1', 'active')], mode: 'strict' })
    const ticket = await newTicket(stack.platform, 'ENG-1')
    const report = await stack.engine.tick()
    expect(report.phases.stateDiff.hrGate).toEqual({ mode: 'strict', refused: 0, samples: [] })
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(stack.launches).toEqual([ticket])
    expect(report.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('DISPATCH')
    expect(hrGateNotes(stack.ledger, ticket)).toEqual([])
    stack.ledger.close()
  })

  it('② 红线：paused 拒出工——HOLD_NOT_IN_SERVICE / 零 launch / 平台态不动 / tick 取证 / 台账留痕', async () => {
    const stack = buildStack('paused', { people: [person('ENG-2', 'paused')], mode: 'strict' })
    const ticket = await newTicket(stack.platform, 'ENG-2')
    const report = await stack.engine.tick()

    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(stack.launches).toEqual([])
    expect(report.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('HOLD_NOT_IN_SERVICE')
    expect(report.phases.stateDiff.hrGate.mode).toBe('strict')
    expect(report.phases.stateDiff.hrGate.refused).toBe(1)
    expect(report.phases.stateDiff.hrGate.samples[0]).toMatchObject({ ticket, person: 'ENG-2', state: 'not-in-service', status: 'paused' })
    expect((await stack.platform.issues.get(ticket)).state).toBe('新单')

    const notes = hrGateNotes(stack.ledger, ticket)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toBe('HR_GATE;REFUSED;person=ENG-2;fact=not-in-service;status=paused;src=company-directory;doc=v2/02-§3.4')

    // 锚去重：同单同事实第二拍不再刷账，但本拍仍取证（refused=1）
    const second = await stack.engine.tick()
    expect(second.phases.stateDiff.hrGate.refused).toBe(1)
    expect(hrGateNotes(stack.ledger, ticket)).toHaveLength(1)
    stack.ledger.close()
  })

  it('② 红线：六状态中其余非在岗值（candidate/suspended/handover/settling/retired）全拒', async () => {
    for (const status of ['candidate', 'suspended', 'handover', 'settling', 'retired']) {
      const stack = buildStack(`status-${status}`, { people: [person('ENG-3', status)], mode: 'strict' })
      const ticket = await newTicket(stack.platform, 'ENG-3')
      const report = await stack.engine.tick()
      expect(report.phases.dispatch.dispatched, `status=${status}`).toBe(0)
      expect(report.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code, `status=${status}`).toBe('HOLD_NOT_IN_SERVICE')
      expect(stack.launches, `status=${status}`).toEqual([])
      stack.ledger.close()
    }
  })

  it('③ 事实缺失（strict）：status 未携带 → 拒（fail-closed，不按 active 猜测）', async () => {
    const stack = buildStack('missing-strict', { people: [person('ENG-4')], mode: 'strict' })
    const ticket = await newTicket(stack.platform, 'ENG-4')
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('HOLD_NOT_IN_SERVICE')
    expect(report.phases.stateDiff.hrGate.samples[0]).toMatchObject({ person: 'ENG-4', state: 'missing' })
    expect(stack.launches).toEqual([])
    stack.ledger.close()
  })

  it('③ 事实不一致/未知：未知值 → unknown 拒；同工号多行冲突 → conflict 拒', async () => {
    const unknown = buildStack('unknown', { people: [person('ENG-5', 'on-call')], mode: 'strict' })
    const t1 = await newTicket(unknown.platform, 'ENG-5')
    const r1 = await unknown.engine.tick()
    expect(r1.phases.stateDiff.decisions.find((d) => d.ticket === t1)?.code).toBe('HOLD_NOT_IN_SERVICE')
    expect(r1.phases.stateDiff.hrGate.samples[0]).toMatchObject({ person: 'ENG-5', state: 'unknown' })
    unknown.ledger.close()

    const conflict = buildStack('conflict', { people: [person('ENG-6', 'active'), person('ENG-6', 'paused')], mode: 'strict' })
    const t2 = await newTicket(conflict.platform, 'ENG-6')
    const r2 = await conflict.engine.tick()
    expect(r2.phases.stateDiff.decisions.find((d) => d.ticket === t2)?.code).toBe('HOLD_NOT_IN_SERVICE')
    expect(r2.phases.stateDiff.hrGate.samples[0]).toMatchObject({ person: 'ENG-6', state: 'conflict' })
    conflict.ledger.close()
  })

  it('③ compat（仅引擎直连面）：缺 status 按 contract §PersonRef.status 缺省语义放行（生产恒 strict）', async () => {
    const stack = buildStack('missing-compat', { people: [person('ENG-7')] })
    const ticket = await newTicket(stack.platform, 'ENG-7')
    const report = await stack.engine.tick()
    expect(report.phases.stateDiff.hrGate.mode).toBe('compat')
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(stack.launches).toEqual([ticket])
    expect(hrGateNotes(stack.ledger, ticket)).toEqual([])
    stack.ledger.close()
  })

  it('③ 执行位兜底判据：非在岗返回拒绝说明（防自动分配换人/新调用面绕过）', () => {
    const gate = createEmploymentGate({ people: () => [person('ENG-8', 'suspended')], mode: 'strict' })
    expect(employmentRefusalOf(gate, 'ENG-8')).toContain('HR_GATE;REFUSED;person=ENG-8;fact=not-in-service;status=suspended')
    const ok = createEmploymentGate({ people: () => [person('ENG-9', 'active')], mode: 'strict' })
    expect(employmentRefusalOf(ok, 'ENG-9')).toBeUndefined()
  })

  it('事实面纯函数：缺/冲突/未知/查无工号一律 fail-closed；note 单行可机械复核', () => {
    expect(employmentSnapshotOf([], 'ENG-1', 'strict').state).toBe('missing')
    expect(employmentSnapshotOf([person('ENG-1')], 'ENG-1', 'strict').state).toBe('missing')
    expect(employmentSnapshotOf([person('ENG-1')], 'ENG-1', 'compat').state).toBe('in-service')
    expect(employmentSnapshotOf([person('ENG-1', 'ACTIVE')], 'ENG-1', 'strict').state).toBe('in-service')
    expect(employmentSnapshotOf([person('ENG-1', 'weird')], 'ENG-1', 'strict').state).toBe('unknown')
    expect(employmentSnapshotOf([person('ENG-1', 'active'), person('ENG-1', 'retired')], 'ENG-1', 'strict').state).toBe('conflict')
    expect(employmentSnapshotOf([person('ENG-1', 'retired')], 'ENG-2', 'strict').state).toBe('missing')
    expect(employmentGateNoteOf({ state: 'not-in-service', personId: 'ENG-1', status: 'paused', source: 'company-directory' })).not.toContain('\n')
  })
})
