/**
 * relay / resume 意图消费（129-E 消费门末两行——六源全通 v0.8 档收口）——studio-dev-184 实现面测试
 *
 * 规格依据（129 提案 §6.1⑥ 分类学收口类 / §6.5 单E，制作人 2026-10-22 全批）：
 *   - docs/22-§二 接力行（F1-11）：worker 完成→「请重估单 X」幂等提示——relay 消费=
 *     **零物化重估**（把已有单推回决策候选：零平台写、零 PATROL——PATROL 键 append-only
 *     不释放，relay 若留痕同键重投会被拍门永久吞掉，与「每次完成都可再触发重估」矛盾）
 *   - docs/22-§二 续命行（F1-15）：断点续跑——work_records 最近一次带 session 工时单 →
 *     summary.json 前情注入 → 新工时单挂 causation_id；续跑不重置 attempt；不支持续跑的
 *     executor 明报降级新派
 *   - docs/17-§5：任务书两版（首版/续跑版——续跑版多「前情摘要」节）
 *   - docs/25-§3.4（invoke v1.3/v1.4）：ticket 必填（relay/resume 语义对象是单号）
 *
 * 断言面：
 *   1. 契约件单元：checkRelayPayload/checkResumePayload 形状闸；resolveResumePlan 三不
 *      可续面（无 session 工时单/无 summary_ref/sidecar 读不出·非 JSON·形状不符）+ 可续面
 *   2. relay 端到端：已完成单复活（态改回新单）→ relay 意图 → 零物化（平台单数不变、
 *      零 PATROL）→ decide 重估再派（DISPATCH#2 intent= 归因）→ attempt 自然续号
 *   3. relay 幂等三层之②③：同键跨拍重投不被 PATROL 拦（设计点）但已派发态无前向
 *      dispatch（状态机最深保险——恒 1 誓在途）
 *   4. relay 同拍候选去重：同单两 relay 意图（异 source=异 intentKey）同拍 → 单候选单动作
 *   5. relay/resume 缺 ticket → errors 明报拒收（fail-closed）
 *   6. resume 端到端（可续 executor：session_resume=true）：断点解析 → 续跑版任务书
 *      （前情摘要注入）→ DISPATCH note `resume=<session>@<executor>（续自第 1 誓）` →
 *      causation_id=上次工时单 id → work_records 第 2 行 attempt=2
 *   7. resume 降级面一（断点不可解析）：errors 明报 + 仍推候选（新派好过不派）
 *   8. resume 降级面二（executor 不支持续跑）：DISPATCH note `resume=降级新派` + 首版
 *      任务书（无前情摘要节）；causation_id 仍挂（因果链不因降级断）
 *   9. onWorkComplete 收割完成钩（relay 源产面）：completed/failed 两面都报、钩异常不炸拍
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  checkRelayPayload,
  checkResumePayload,
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  resolveResumePlan,
  type Engine,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode, FAKE_SUMMARY_JSON } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import {
  createRelaySource,
  createResumeSource,
  RELAY_SOURCE_MANIFEST,
  RESUME_SOURCE_MANIFEST,
  wireRelaySource,
  wireResumeSource,
  type RelayWorkSignal,
} from '../../../src/engine/intents/relay-resume-sources.ts'
import { createSourceRegistry } from '../../../src/engine/sources.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

function twoPersonSnapshot(): CompanySnapshot {
  return {
    ...DEMO_SNAPSHOT,
    people: [
      { id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
      { id: 'PRIME-0', name: '宰相', login: 'prime-0', level: 3, dept: 'departments/工程部' },
    ],
  }
}

interface EngineStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  onWorkComplete: ReturnType<typeof collectSignals>
}

/** onWorkComplete 回采（relay 源产面断言用；钩异常注入经 throws 标志） */
function collectSignals(throws = false): { calls: Array<{ ticket: TicketId; attempt: number; outcome: string; personId: string }>; hook: (s: { ticket: TicketId; attempt: number; outcome: 'completed' | 'failed'; personId: string }) => void } {
  const calls: Array<{ ticket: TicketId; attempt: number; outcome: string; personId: string }> = []
  return {
    calls,
    hook: (s): void => {
      if (throws) throw new Error('钩面模拟异常')
      calls.push(s)
    },
  }
}

/**
 * 可续 fake（session_resume=true——F1-15 能力位）：spread 覆盖 capabilities，其余与
 * createFakeAdapter 全同（launch 即完成：REPORT+summary.json 落 workspace）。注册名
 * fake-rs（与默认 fake 区分——resume 指名解析按名命中）。
 */
function createResumableFakeAdapter() {
  const base = createFakeAdapter({ name: 'fake-rs' })
  return { ...base, capabilities: { ...base.capabilities, session_resume: true } }
}

function buildEngineStack(id: string, opts?: { resumable?: boolean; onWorkCompleteThrows?: boolean; mode?: () => FakeAdapterMode }): EngineStack {
  const snapshot = twoPersonSnapshot()
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 22, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(
    opts?.resumable === true ? createResumableFakeAdapter() : createFakeAdapter({ mode: opts?.mode }),
    { default: true },
  )
  const signals = collectSignals(opts?.onWorkCompleteThrows === true)
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/22-§二（接力/续命）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    people: snapshot.people,
    onWorkComplete: signals.hook,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: snapshot.people[0]?.id ?? 'AGENT-1',
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
    },
  })
  return { platform, ledger, engine, clock, onWorkComplete: signals }
}

function relayIntent(ticket: TicketId, source = 'relay'): InvokeIntent {
  return { kind: 'relay', company: 'demo', source, ticket, priority: 1 }
}

function resumeIntent(ticket: TicketId, cause?: string): InvokeIntent {
  return {
    kind: 'resume',
    company: 'demo',
    source: 'resume-cmd',
    ticket,
    priority: 1,
    ...(cause !== undefined ? { payload: { cause } } : {}),
  }
}

function eventsOf(ledger: Ledger, name: EventRecord['event'], issue?: TicketId): EventRecord[] {
  return ledger.queryEvents(issue === undefined ? {} : { issue }).filter((e) => e.event === name)
}

/**
 * 建单并走完全生命周期五拍（DISPATCH→GATE_PASS→QA_PASS→MERGE→CLOSE——e2e 同径）：
 * GATE_PASS 拍落 work_records.session_id+summary_ref（resume 断点面），CLOSE 拍释放泳道
 * （否则复活重派被 HOLD_LANE_BUSY 压制——泳道租约归回收相位）。
 */
async function seedClosedTicket(s: EngineStack): Promise<TicketId> {
  const created = await s.platform.issues.create({ title: '接力对象单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
  s.clock.advance(1000)
  expect((await s.engine.tick()).phases.dispatch.dispatched).toBe(1)
  s.clock.advance(1000)
  expect((await s.engine.tick()).phases.harvest.completed).toBe(1)
  s.clock.advance(1000)
  await s.engine.tick() // QA_PASS
  s.clock.advance(1000)
  await s.engine.tick() // MERGE
  s.clock.advance(1000)
  expect((await s.engine.tick()).phases.recycle.recycled).toBe(1) // CLOSE：泳道释放
  return created.id
}

/** 复活令（docs/49：改态即可复活——closed-set 派生闭集经 RESUME 事件/态改回离开终态） */
async function revive(s: EngineStack, ticket: TicketId): Promise<void> {
  await s.platform.issues.transition(ticket, '新单')
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sn-129e-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 契约件单元面 —————————————————————————

describe('payload 契约件：checkRelayPayload / checkResumePayload', () => {
  it('payload 可整体缺省（语义对象全在 intent.ticket）；reason/cause 展示位在场须非空串', () => {
    expect(checkRelayPayload(undefined)).toEqual({})
    expect(checkResumePayload(undefined)).toEqual({})
    expect(checkRelayPayload({ reason: 'GATE_PASS：四要件齐' })).toEqual({ reason: 'GATE_PASS：四要件齐' })
    expect(checkResumePayload({ cause: '重启接管' })).toEqual({ cause: '重启接管' })
    expect(checkRelayPayload({ reason: '' })).toBe('reason 非字符串或空串')
    expect(checkRelayPayload({ reason: 7 })).toBe('reason 非字符串或空串')
    expect(checkResumePayload({ cause: '' })).toBe('cause 非字符串或空串')
    expect(checkRelayPayload('x')).toBe('payload 非对象')
  })
})

describe('resolveResumePlan：断点解析三不可续面 + 可续面（F1-15）', () => {
  let ledger: Ledger
  let seedSeq = 0
  beforeAll(() => {
    ledger = openLedger(path.join(root, 'rr-plan.sqlite'))
  })
  afterAll(() => {
    ledger.close()
  })

  function seed(id: string, ticket: string, extra?: { session_id?: string; summary_ref?: string; attempt?: number }): void {
    ledger.insertWorkRecord({
      id,
      issue: ticket,
      person_id: 'AGENT-1',
      executor: 'fake',
      started_at: Date.UTC(2026, 9, 22, 1) + seedSeq * 1000,
      attempt: extra?.attempt ?? 1,
      status: 'done',
      lane: 'core',
      ...extra,
    })
    seedSeq += 1
  }

  /** 不可续断言（收窄到 unavailable 面再含子串——两分支不混淆） */
  function unavailableOf(plan: ReturnType<typeof resolveResumePlan>): string {
    if (!('unavailable' in plan)) throw new Error('期望不可续面，实得可续计划')
    return plan.unavailable
  }

  it('① 无 session 工时单（单从未被派发过）→ 不可续明报', () => {
    seed('w1', 'RR-1') // 无 session_id——被过滤
    expect(unavailableOf(resolveResumePlan(ledger, 'RR-1'))).toContain('无断点可续')
  })

  it('② 有 session 无 summary_ref（收割未交 sidecar）→ 前情摘要不可构造', () => {
    seed('w2', 'RR-2', { session_id: 'fake-1' })
    expect(unavailableOf(resolveResumePlan(ledger, 'RR-2'))).toContain('无 summary_ref')
  })

  it('③ sidecar 读不出 / 非 JSON / 形状不符 → 受验拒收不猜', () => {
    seed('w3a', 'RR-3', { session_id: 'fake-1', summary_ref: path.join(root, 'nope', 'summary.json') })
    expect(unavailableOf(resolveResumePlan(ledger, 'RR-3'))).toContain('读不出')

    const badJson = path.join(root, 'bad.summary.json')
    writeFileSync(badJson, 'not-json{', 'utf8')
    seed('w3b', 'RR-3b', { session_id: 'fake-1', summary_ref: badJson })
    expect(unavailableOf(resolveResumePlan(ledger, 'RR-3b'))).toContain('非 JSON')

    const badShape = path.join(root, 'bad-shape.summary.json')
    writeFileSync(badShape, JSON.stringify({ schema: 'other/v9' }), 'utf8')
    seed('w3c', 'RR-3c', { session_id: 'fake-1', summary_ref: badShape })
    expect(unavailableOf(resolveResumePlan(ledger, 'RR-3c'))).toContain('形状不符')
  })

  it('可续面：末位带 session 工时单 → 计划五元组（含 causationId/lastAttempt）', () => {
    const good = path.join(root, 'good.summary.json')
    writeFileSync(good, FAKE_SUMMARY_JSON, 'utf8')
    seed('w4a', 'RR-4', { session_id: 'fake-1', summary_ref: path.join(root, 'gone.json'), attempt: 1 })
    seed('w4b', 'RR-4', { session_id: 'fake-2', summary_ref: good, attempt: 2 }) // 末位胜出（started_at 升序）
    const plan = resolveResumePlan(ledger, 'RR-4')
    expect('unavailable' in plan).toBe(false)
    if (!('unavailable' in plan)) {
      expect(plan.executor).toBe('fake')
      expect(plan.sessionId).toBe('fake-2')
      expect(plan.summaryPath).toBe(good)
      expect(plan.summary.conclusion).toContain('fake 适配器')
      expect(plan.causationId).toBe('w4b')
      expect(plan.lastAttempt).toBe(2)
    }
  })
})

// ————————————————————————— 1b. 源件单元面（注册三件套之源件——22-§一 不变量） —————————————————————————

describe('relay 源：收割完成信号→relay 意图（誓作用域防抖）', () => {
  it('publish 产意图形状（kind/company/source/ticket/priority=1+reason 含 GATE_PASS/GATE_FAIL 双面）', () => {
    const got: InvokeIntent[] = []
    const src = createRelaySource({ company: 'demo', sink: (i) => got.push(i) })
    const pass: RelayWorkSignal = { ticket: 'T-1', attempt: 1, outcome: 'completed', personId: 'AGENT-1' }
    expect(src.publish(pass)).toBe(true)
    expect(src.publish({ ...pass, attempt: 2, outcome: 'failed' })).toBe(true)
    expect(got[0]).toMatchObject({ kind: 'relay', company: 'demo', source: 'relay', ticket: 'T-1', priority: 1 })
    expect(String(got[0]?.payload && (got[0].payload as { reason: string }).reason)).toContain('GATE_PASS')
    expect(String(got[1]?.payload && (got[1].payload as { reason: string }).reason)).toContain('GATE_FAIL')
  })

  it('誓作用域防抖：同 (ticket, attempt) 只发一次；跨誓恒发（GATE_FAIL→重派→再完成的快循环不误杀）', () => {
    const src = createRelaySource({ company: 'demo', sink: () => undefined })
    const s1: RelayWorkSignal = { ticket: 'T-1', attempt: 1, outcome: 'completed', personId: 'AGENT-1' }
    expect(src.publish(s1)).toBe(true)
    expect(src.publish({ ...s1, outcome: 'failed' })).toBe(false) // 同誓钩重放——防抖吞
    expect(src.publish({ ...s1, attempt: 2 })).toBe(true) // 跨誓=新事实恒发
    expect(src.stats).toEqual({ emitted: 2, debounced: 1 })
  })

  it('start 后 emit 走注册表收集器（stop 回落构造期 sink——无双写面）', () => {
    const sinkGot: InvokeIntent[] = []
    const liveGot: InvokeIntent[] = []
    const src = createRelaySource({ company: 'demo', sink: (i) => sinkGot.push(i) })
    src.start((i) => liveGot.push(i))
    src.publish({ ticket: 'T-1', attempt: 1, outcome: 'completed', personId: 'AGENT-1' })
    src.stop()
    src.publish({ ticket: 'T-1', attempt: 2, outcome: 'completed', personId: 'AGENT-1' })
    expect(liveGot).toHaveLength(1)
    expect(sinkGot).toHaveLength(1)
  })
})

describe('resume 源：续命推送面（v0 产面=测试/后续 CLI resume，B4 归档）', () => {
  it('publish 产意图形状（cause 在场进 payload、缺省无 payload——不猜不代写）', () => {
    const got: InvokeIntent[] = []
    const src = createResumeSource({ company: 'demo', sink: (i) => got.push(i) })
    expect(src.publish('T-1', '重启接管')).toBe(true)
    expect(src.publish('T-2')).toBe(true)
    expect(got[0]).toMatchObject({ kind: 'resume', company: 'demo', source: 'resume', ticket: 'T-1', priority: 1, payload: { cause: '重启接管' } })
    expect(got[1]?.payload).toBeUndefined()
  })

  it('畸形输入拒收（空单号/空 cause）+ 观测计数', () => {
    const src = createResumeSource({ company: 'demo', sink: () => undefined })
    expect(src.publish('')).toBe(false)
    expect(src.publish('T-1', '')).toBe(false)
    expect(src.stats).toEqual({ emitted: 0, rejected: 2 })
  })
})

describe('wire 装配件：注册三件套接线（manifest 同指）', () => {
  it('wireRelaySource/wireResumeSource → 注册表登记 + manifest 齐备 + publish 闭包同源', () => {
    const got: InvokeIntent[] = []
    const sink = (i: InvokeIntent): void => { got.push(i) }
    const registry = createSourceRegistry()
    const relayPublish = wireRelaySource(registry, { company: 'demo', sink })
    const resumePublish = wireResumeSource(registry, { company: 'demo', sink })
    expect(registry.list().map((e) => e.source.name)).toEqual(['relay', 'resume'])
    expect(registry.list()[0]?.manifest).toEqual(RELAY_SOURCE_MANIFEST)
    expect(registry.list()[1]?.manifest).toEqual(RESUME_SOURCE_MANIFEST)
    expect(relayPublish({ ticket: 'T-1', attempt: 1, outcome: 'completed', personId: 'AGENT-1' })).toBe(true)
    expect(resumePublish('T-1', 'CLI resume')).toBe(true)
    expect(got.map((i) => i.kind)).toEqual(['relay', 'resume'])
  })
})

// ————————————————————————— 2. relay 消费：零物化重估（F1-11） —————————————————————————

describe('relay 意图：零物化重估（已完成单复活→推回决策候选→再派）', () => {
  it('端到端：relay 意图 → 零平台写（单数不变/零 PATROL）→ DISPATCH#2（intent= 归因+attempt 续号）', async () => {
    const s = buildEngineStack('rl-e2e')
    const ticket = await seedClosedTicket(s)
    await revive(s, ticket)

    s.engine.ingest([relayIntent(ticket)])
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])

    // 零物化：不建新单、零 PATROL（relay 观测面=决策条目+动作事件，非留痕键）
    expect(await s.platform.issues.list({})).toHaveLength(1)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)

    // decide 重估：已完成单复活后可再派——attempt 续号=2（不重置）
    const dispatches = eventsOf(s.ledger, 'DISPATCH', ticket)
    expect(dispatches).toHaveLength(2)
    expect(dispatches[1]?.note).toContain(`intent=relay|relay|demo|${ticket}`)
    const recs = s.ledger.listWorkRecords({ issue: ticket })
    expect(recs.map((r) => r.attempt)).toEqual([1, 2])
    s.ledger.close()
  })

  it('幂等③（状态机最深保险）：同键重投时单已在途 → 无前向 dispatch 恒 1 誓在途；且无 PATROL 拦键（设计点）', async () => {
    const s = buildEngineStack('rl-dup')
    const ticket = await seedClosedTicket(s)
    await revive(s, ticket)
    s.engine.ingest([relayIntent(ticket)])
    s.clock.advance(1000)
    await s.engine.tick()
    expect(eventsOf(s.ledger, 'DISPATCH', ticket)).toHaveLength(2) // 复活后首 relay 派第 2 誓

    // 单已在途（已派发+inflight）——同键/异键重投都不得触发第 3 誓
    s.engine.ingest([relayIntent(ticket), relayIntent(ticket, 'relay-again')])
    s.clock.advance(1000)
    const report2 = await s.engine.tick()
    expect(report2.errors).toEqual([])
    expect(eventsOf(s.ledger, 'DISPATCH', ticket)).toHaveLength(2)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0) // 无 PATROL 键拦截——下次复活可再触发
    s.ledger.close()
  })

  it('同拍候选去重：同单两 relay 意图（异 source=异 intentKey）→ 单候选单动作（17-§2 不变量）', async () => {
    const s = buildEngineStack('rl-tick-dedup')
    const ticket = await seedClosedTicket(s)
    await revive(s, ticket)
    s.engine.ingest([relayIntent(ticket, 'relay-a'), relayIntent(ticket, 'relay-b')])
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    // 第 2 誓只派一次（第二意图不重复推候选——attempt 仍为 2，无第 3 誓）
    expect(eventsOf(s.ledger, 'DISPATCH', ticket)).toHaveLength(2)
    s.ledger.close()
  })

  it('缺 ticket → errors 明报拒收（语义对象不可缺，fail-closed）', async () => {
    const s = buildEngineStack('rl-no-ticket')
    s.engine.ingest([{ kind: 'relay', company: 'demo', source: 'relay', dedupKey: 'r1' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('relay 意图缺 ticket')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })
})

// ————————————————————————— 3. resume 消费：断点续跑（F1-15） —————————————————————————

describe('resume 意图：断点续跑端到端（可续 executor=session_resume:true）', () => {
  it('断点解析→续跑版任务书（前情摘要注入）→ note 锚+causation_id+第 2 誓不重置计数', async () => {
    const s = buildEngineStack('rs-e2e', { resumable: true })
    const ticket = await seedClosedTicket(s)
    const first = s.ledger.listWorkRecords({ issue: ticket })[0]
    expect(first?.session_id).toBeDefined() // fake-rs-1
    expect(first?.summary_ref).toBeDefined() // GATE_PASS 收口落 sidecar 引用
    await revive(s, ticket)

    s.engine.ingest([resumeIntent(ticket, '重启接管')])
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])

    const dispatches = eventsOf(s.ledger, 'DISPATCH', ticket)
    expect(dispatches).toHaveLength(2)
    const note = dispatches[1]?.note ?? ''
    expect(note).toContain('resume=fake-rs-1@fake-rs（续自第 1 誓）')
    expect(dispatches[1]?.causation_id).toBe(first?.id) // 因果链=上次工时单 id
    expect(note).toContain(`intent=resume-cmd|resume|demo|${ticket}`)

    // 续跑版任务书：att2 工位 brief 含前情摘要节（上次 summary.json 注入）
    const brief = readFileSync(path.join(root, 'rs-e2e', 'workspaces', ticket, 'att2', 'brief.md'), 'utf8')
    expect(brief).toContain('前情摘要')
    expect(brief).toContain('上次会话：`fake-rs-1`')
    expect(brief).toContain('第 2 次尝试 · 续跑')

    // work_records 第 2 行（attempt 续号——续跑不重置计数）
    const recs = s.ledger.listWorkRecords({ issue: ticket })
    expect(recs.map((r) => r.attempt)).toEqual([1, 2])
    expect(recs[1]?.session_id).toBe('fake-rs-2') // 新誓新会话（同 executor 命名空间）
    s.ledger.close()
  })
})

describe('resume 意图：降级面一（断点不可解析→明报+仍推候选新派）', () => {
  it('从未派发过的单：errors 明报断点不可解析 + 照常首誓派发（新派好过不派）', async () => {
    const s = buildEngineStack('rs-no-plan', { resumable: true })
    const created = await s.platform.issues.create({ title: '从未派发', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
    s.engine.ingest([resumeIntent(created.id)])
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('断点不可解析')
    expect(report.errors.join('\n')).toContain('降级为新派候选')
    expect(eventsOf(s.ledger, 'DISPATCH', created.id)).toHaveLength(1) // 仍推候选
    const note = eventsOf(s.ledger, 'DISPATCH', created.id)[0]?.note ?? ''
    expect(note).not.toContain('resume=') // 无计划无锚——首版静默新派（计划面明报已足够）
    s.ledger.close()
  })

  it('缺 ticket → errors 明报拒收', async () => {
    const s = buildEngineStack('rs-no-ticket')
    s.engine.ingest([{ kind: 'resume', company: 'demo', source: 'resume-cmd', dedupKey: 'r1' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('resume 意图缺 ticket')
    s.ledger.close()
  })
})

describe('resume 意图：降级面二（executor 不支持续跑→DISPATCH 锚明报+首版任务书）', () => {
  it('session_resume=false（默认 fake）：note `resume=降级新派` + causation_id 仍挂 + brief 无前情摘要节', async () => {
    const s = buildEngineStack('rs-degraded') // 默认 fake：session_resume=false
    const ticket = await seedClosedTicket(s)
    const first = s.ledger.listWorkRecords({ issue: ticket })[0]
    await revive(s, ticket)

    s.engine.ingest([resumeIntent(ticket)])
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.errors).toEqual([]) // 降级是派发面锚——非 errors 面（两级明报语义）

    const dispatches = eventsOf(s.ledger, 'DISPATCH', ticket)
    expect(dispatches).toHaveLength(2)
    const note = dispatches[1]?.note ?? ''
    expect(note).toContain('resume=降级新派')
    expect(note).toContain('session_resume=false')
    expect(dispatches[1]?.causation_id).toBe(first?.id) // 因果链不因降级断

    // 首版任务书（无前情摘要节——「不静默降级为首版」的降级例外：派发面已明报）
    const brief = readFileSync(path.join(root, 'rs-degraded', 'workspaces', ticket, 'att2', 'brief.md'), 'utf8')
    expect(brief).not.toContain('前情摘要')
    expect(brief).toContain('第 2 次尝试 · 首次派发')
    s.ledger.close()
  })
})

// ————————————————————————— 4. onWorkComplete 收割完成钩（relay 源产面） —————————————————————————

describe('onWorkComplete：收割完成钩（129-E F1-11 接力产面——GATE_PASS/GATE_FAIL 两面都报）', () => {
  it('completed 面报事实（ticket/attempt/outcome/personId 四元组）', async () => {
    const s = buildEngineStack('owc-pass')
    const ticket = await seedClosedTicket(s)
    expect(s.onWorkComplete.calls).toEqual([
      { ticket, attempt: 1, outcome: 'completed', personId: 'AGENT-1' },
    ])
    s.ledger.close()
  })

  it('failed 面同报（worker 完成含失败完成——GATE_FAIL 路径 outcome=failed）', async () => {
    const s = buildEngineStack('owc-fail', { mode: () => 'external_error' })
    const created = await s.platform.issues.create({ title: '失败单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
    s.clock.advance(1000)
    await s.engine.tick()
    s.clock.advance(1000)
    const t2 = await s.engine.tick()
    expect(t2.phases.harvest.failed).toBe(1)
    expect(s.onWorkComplete.calls).toEqual([
      { ticket: created.id, attempt: 1, outcome: 'failed', personId: 'AGENT-1' },
    ])
    s.ledger.close()
  })

  it('钩异常不炸收割拍（errors 明报——收割面完整性优先于钩面）', async () => {
    const s = buildEngineStack('owc-throw', { onWorkCompleteThrows: true })
    await s.platform.issues.create({ title: '钩异常单', type: 'task', dept: 'departments/工程部', level: 0, assignee: 'AGENT-1' })
    s.clock.advance(1000)
    await s.engine.tick()
    s.clock.advance(1000)
    const t2 = await s.engine.tick()
    expect(t2.phases.harvest.completed).toBe(1) // 收割照常收口（钩面异常不阻断）
    expect(t2.errors.join('\n')).toContain('收割完成钩异常')
    expect(s.onWorkComplete.calls).toEqual([]) // 异常注入——零成功回采
    s.ledger.close()
  })
})
