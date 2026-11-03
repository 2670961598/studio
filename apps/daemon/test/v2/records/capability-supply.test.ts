/**
 * capability-supply —— 能力供给 CAP 记录写入＋能力缺口五出口决策接线（NEG-RING-03）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/11 §9 CAP 族（REC-CAP-01 声明九维/RECEIPT 回执；自报仅线索/负向结果必载）、
 *     §0.4（身份/幂等）、§0.5（生效槽）、§0.7（证明边界）；docs/v2/14 §1.6（PORT-HIST 唯一写口）；
 *   - docs/v2/02 §五（缺能力/退化/成本失控处置阶梯；不得静默退化/降标）；
 *   - docs/v2/17 §5.1 NEG-RING-03 / §3.3 TR-RING-03（能力环五出口必答；V1＋V3）；
 *   - docs/17-§2 主循环七相位（state-diff/派发判定相位接点）＋docs/17-§6（收割四要件不改）。
 *
 * 断言面（负向优先，fail-closed 优先）：
 *   ① 写者：REC-CAP-01 逐执行体落库（九维/具名 producer/证明边界；重复 ensure 幂等）；
 *   ② 退化事实：detect 不达标落 REC-CAP-RECEIPT（proved=false＋负向发现＋声明引用＋digest）；
 *   ③ 五出口：缺省策略 missing→refuse / degraded→refuse / cost_runaway→stop；
 *      策略未给出口、出口非法（continue）、声明缺项、策略抛错——一律 ok:false（不默认继续）；
 *   ④ 真机接线：引擎 fake 栈三触发面（无 executor/detect 不达标/预算超帽）→ ESCALATE 出口留痕
 *      ＋无 DISPATCH＋无 launch（不是单测自证纯函数，而是主循环派发相位实际消费）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, ExecutorAdapter, FlowPlatform, PersonRef } from '@studio-next/contract'
import { createHistFace, openLedger, type HistFace, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import {
  createCapabilitySupplyFace,
  judgeCapabilityGap,
  type CapabilityGapPolicy,
  type CapabilityGapRequest,
  type CapabilitySupplyFace,
} from '../../../src/engine/capability/index.ts'

const T0 = Date.parse('2026-11-03T00:00:00.000Z')
const COMPANY = 'cap-corp'

let root = ''
let snapshot: CompanySnapshot
const ledgers: Ledger[] = []

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return `0`.repeat(10) + String(n).padStart(16, '0')
  }
}

interface StackOptions {
  /** null＝注册表零存活执行体（能力缺口 missing 面） */
  adapter?: ExecutorAdapter | null
  policy?: CapabilityGapPolicy
  budgetTicketCapUsd?: number
}

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  hist: HistFace
  face: CapabilitySupplyFace
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  logs: string[]
}

function buildStack(id: string, opts?: StackOptions): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  ledgers.push(ledger)
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  const adapter = opts?.adapter === null ? undefined : (opts?.adapter ?? createFakeAdapter())
  if (adapter !== undefined) registry.register(adapter, { default: true })
  const logs: string[] = []
  const makeId = deterministicIds()
  const hist = createHistFace(ledger.db)
  const face = createCapabilitySupplyFace({
    hist,
    company: COMPANY,
    executors: registry.list().map((entry) => ({ name: entry.name, capabilities: entry.capabilities, source: 'test:registry' })),
    makeId,
    now: clock.now,
    ...(opts?.policy !== undefined ? { policy: opts.policy } : {}),
    log: (line) => logs.push(line),
  })
  face.ensureDeclared()
  const person = snapshot.people[0] as PersonRef
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/v2/02 §五（能力缺失处置）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: COMPANY,
      rootDir: path.join(root, `${id}-run`),
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: opts.budgetTicketCapUsd } : {}),
    },
    people: snapshot.people,
    makeId,
    capabilitySupply: face,
  })
  return { platform, ledger, hist, face, engine, clock, logs }
}

function gapRequest(overrides: Partial<CapabilityGapRequest> = {}): CapabilityGapRequest {
  return {
    ticket: 'T-1',
    attempt: 1,
    kind: 'missing',
    capabilityRef: 'executor:x',
    impactRef: 'ticket:T-1',
    at: '2026-11-03T00:00:01.000Z',
    ...overrides,
  }
}

/** payload 断言便捷面（contract 信封 payload 为 unknown——测试内收窄，不改实现） */
function payloadOf(record: { payload: unknown }): Record<string, unknown> {
  return record.payload as Record<string, unknown>
}

function escalationNote(report: TickReport, fragment: string): string | undefined {
  return report.events.find((event) => event.event === 'ESCALATE' && (event.note ?? '').includes(fragment))?.note
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-capability-'))
  snapshot = {
    slug: COMPANY,
    name: '能力供给测试公司',
    level: 2,
    charter: 'charter.md',
    platform: { platform: 'localfile' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people: [{ id: 'AGENT-1', name: '能力工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
    jobs: [],
  }
})

afterAll(async () => {
  for (const ledger of ledgers) {
    try {
      ledger.close()
    } catch {
      /* already closed */
    }
  }
  ledgers.length = 0
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 一、REC-CAP 写者（供给/退化事实落库） —————————————————————————

describe('REC-CAP 写者：能力供给声明与退化回执（PORT-HIST 唯一写口）', () => {
  it('REC-CAP-01：逐执行体一条声明，九维齐/具名 producer/证明边界；重复 ensure 幂等不重复写', () => {
    const stack = buildStack('declare')
    const first = stack.face.ensureDeclared()
    const second = stack.face.ensureDeclared()
    expect(first).toHaveLength(1)
    expect(second).toEqual(first)

    const declarations = stack.hist.query({ company: COMPANY, type: 'REC-CAP-01' })
    expect(declarations).toHaveLength(1)
    const record = declarations[0] as NonNullable<(typeof declarations)[number]>
    expect(record.recordType).toBe('REC-CAP-01')
    expect(record.effectiveState).toBe('effective')
    expect(record.producer.decidedBy).toBe('executor:fake')
    expect(record.producer.decidedBy.toLowerCase()).not.toBe('daemon') // §0.2-1 具名决定者
    expect(record.proofBoundary ?? '').toContain('不证明资格已认定')

    const payload = payloadOf(record)
    const claim = payload['claim'] as Record<string, unknown>
    expect(Object.keys(claim)).toHaveLength(9) // 九维声明齐（v2/07 §一）
    expect(claim['生命周期']).toMatchObject({ supported: expect.any(Array), unsupported: expect.any(Array) })
    expect(claim['证据与已知不能']).toContain('REC-CAP-02')
    expect(payload['evidence_refs']).toEqual([]) // 声明是主张：无可引证据记录，如实空
  })

  it('REC-CAP-RECEIPT：detect 不达标＝proved=false＋负向发现必载＋引用声明 ID/digest（自报仅线索）', () => {
    const stack = buildStack('receipt')
    const declaration = stack.face.ensureDeclared()[0] as NonNullable<ReturnType<CapabilitySupplyFace['ensureDeclared']>[number]>
    const ref = stack.face.recordProbe({
      executor: 'fake',
      version: '0.0.0-fake',
      ok: false,
      gaps: ['native-agents-missing', 'budget-cap-missing'],
      ticket: 'T-9',
      at: '2026-11-03T00:00:05.000Z',
    })
    expect(ref?.appended).toBe(true)

    const receipts = stack.hist.query({ company: COMPANY, type: 'REC-CAP-RECEIPT' })
    expect(receipts).toHaveLength(1)
    const record = receipts[0] as NonNullable<(typeof receipts)[number]>
    const payload = payloadOf(record)
    expect(payload['receipt_kind']).toBe('probing')
    expect(payload['capability_ref']).toEqual({ refType: 'REC-CAP-01', refId: declaration.recordId, refVersion: '1.0.0' })
    expect(payload['capability_digest']).toBe(declaration.digest)
    expect(payload['result']).toMatchObject({ proved: false, negative_findings: ['native-agents-missing', 'budget-cap-missing'] })
    expect(payload['collector_identity']).toMatchObject({ channel: '执行体自报探测（adapter.detect；仅线索）', independent: false })
  })
})

// ————————————————————————— 二、五出口决策（纯判定；fail-closed 优先） —————————————————————————

describe('五出口决策：缺省策略与 fail-closed 负向面', () => {
  it('缺省策略：missing/degraded→refuse；cost_runaway→stop（有且仅一个出口＋理由/授权/影响三件）', () => {
    const missing = judgeCapabilityGap(gapRequest({ kind: 'missing' }))
    expect(missing.ok).toBe(true)
    if (missing.ok) {
      expect(missing.exit).toBe('refuse')
      expect(missing.decision.disposition.authorityRef).not.toBe('')
      expect(missing.decision.disposition.reason).toContain('能力未证')
    }
    const degraded = judgeCapabilityGap(gapRequest({ kind: 'degraded', capabilityRef: 'executor:fake' }))
    expect(degraded.ok && degraded.exit).toBe('refuse')
    const runaway = judgeCapabilityGap(gapRequest({ kind: 'cost_runaway', capabilityRef: 'ticket:T-1/budget' }))
    expect(runaway.ok).toBe(true)
    if (runaway.ok) {
      expect(runaway.exit).toBe('stop')
      expect(runaway.trace).toContain('exit=stop')
      expect(runaway.trace).toContain('authority=v2/02-§五')
    }
  })

  it('四答未答不阻断处置，但进 missingAnswers（不得默认视为已答）', () => {
    const ruling = judgeCapabilityGap(gapRequest())
    expect(ruling.ok).toBe(true)
    if (ruling.ok) expect(ruling.decision.missingAnswers).toEqual(['duration', 'alternative'])
    const answered = judgeCapabilityGap(gapRequest({ durationRef: 'P1D', alternativeRefs: [] }))
    expect(answered.ok).toBe(true)
    if (answered.ok) expect(answered.decision.missingAnswers).toEqual([])
  })

  it('决策数据缺失/出口非法/策略抛错＝ok:false（fail-closed 不继续）', () => {
    const noDisposition = judgeCapabilityGap(gapRequest(), () => undefined)
    expect(noDisposition.ok).toBe(false)
    if (!noDisposition.ok) {
      expect(noDisposition.subcause).toBe('gap-exit-missing')
      expect(noDisposition.trace).toContain('fail-closed=gap-exit-missing')
    }

    const illegal = judgeCapabilityGap(gapRequest(), () => ({ exit: 'continue', reason: '继续原路径', authorityRef: 'x', impactRef: 'y' }))
    expect(illegal.ok).toBe(false)
    if (!illegal.ok) expect(illegal.subcause).toBe('gap-exit-not-closed')

    const malformed = judgeCapabilityGap(gapRequest({ capabilityRef: '   ' }))
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.subcause).toBe('gap-capability-missing')

    const throwing = judgeCapabilityGap(gapRequest(), () => {
      throw new Error('policy-boom')
    })
    expect(throwing.ok).toBe(false)
    if (!throwing.ok) expect(throwing.subcause).toBe('gap-policy-error')
  })
})

// ————————————————————————— 三、主循环派发相位接线（真机面） —————————————————————————

describe('主循环接线：三触发面 → 五出口决策 → 出口留痕＋不派发', () => {
  it('能力缺口 missing：注册表零 execution → ESCALATE 携 exit=refuse、无 DISPATCH/无 launch', async () => {
    const stack = buildStack('wire-missing', { adapter: null })
    const created = await stack.platform.issues.create({ title: '缺能力单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()

    const note = escalationNote(report, 'kind=missing')
    expect(note).toBeDefined()
    expect(note).toContain('exit=refuse')
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.errors.join('\n')).toContain('capability-gap:missing;exit=refuse')
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((event) => event.event === 'DISPATCH')).toHaveLength(0)
    expect(stack.ledger.listWorkRecords({ issue: created.id })).toHaveLength(0)
  })

  it('能力退化 degraded：detect 不达标落 REC-CAP-RECEIPT＋ESCALATE exit=refuse、不 launch', async () => {
    const base = createFakeAdapter()
    const degraded: ExecutorAdapter = {
      ...base,
      name: 'degraded-exec',
      async detect() {
        return { name: 'degraded-exec', version: '0.1.0', ok: false, gaps: ['native-agents-missing'] }
      },
    }
    const stack = buildStack('wire-degraded', { adapter: degraded })
    const created = await stack.platform.issues.create({ title: '退化单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()

    const note = escalationNote(report, 'kind=degraded')
    expect(note).toContain('exit=refuse')
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.errors.join('\n')).toContain('detect 不达标')
    const receipts = stack.hist.query({ company: COMPANY, type: 'REC-CAP-RECEIPT' })
    expect(receipts).toHaveLength(1)
    const payload = payloadOf(receipts[0] as NonNullable<(typeof receipts)[number]>)
    expect(payload['result']).toMatchObject({ proved: false, negative_findings: ['native-agents-missing'] })
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((event) => event.event === 'DISPATCH')).toHaveLength(0)
  })

  it('成本失控 cost_runaway：预算 refusal → ESCALATE exit=stop、refusal 行落账、不派发', async () => {
    const stack = buildStack('wire-cost', { budgetTicketCapUsd: 0.001 })
    const created = await stack.platform.issues.create({ title: '超帽单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()

    const note = escalationNote(report, 'kind=cost_runaway')
    expect(note).toContain('exit=stop')
    expect(report.phases.dispatch.budgetRefused).toBe(1)
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.errors.join('\n')).toContain('capability-gap:cost_runaway;exit=stop')
    expect(stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: created.id }).filter((row) => row.kind === 'refusal')).toHaveLength(1)
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((event) => event.event === 'DISPATCH')).toHaveLength(0)
  })

  it('fail-closed 穿透：出口策略未给出口 → 派发拒绝 detail 携 fail-closed（不静默继续）', async () => {
    const stack = buildStack('wire-failclosed', { budgetTicketCapUsd: 0.001, policy: () => undefined })
    const created = await stack.platform.issues.create({ title: '出口缺失单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()

    const note = escalationNote(report, 'fail-closed=gap-exit-missing')
    expect(note).toBeDefined()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.errors.join('\n')).toContain('fail-closed')
    expect(stack.ledger.queryEvents({ issue: created.id }).filter((event) => event.event === 'DISPATCH')).toHaveLength(0)
  })
})
