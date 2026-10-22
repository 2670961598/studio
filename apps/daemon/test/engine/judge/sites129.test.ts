/**
 * judge/sites129 测试 —— 160-B 调用点接线：队列选单/插队两址（studio-dev-182；
 * 规格=160-att1 plan §6.3 site 表+§6.7 单B 行）。断言面：纯面（址解析/facts 去偏/
 * 词表/纯置换）；真链（真 invokeJudge+真台账+确定性流回放——不许 LLM 打桩）：采纳重排
 * +JUDGE_OK+mj: 预算行、降级=规则档原序、置顶结构性排除、top-K；点火条件（solo-head/
 * no-dispatch-capacity/site-off 零 launch）；interrupt front/append+两址拍闸恰合；熔断
 * 3 连 site-open+tick-quota 复位；引擎接线（注入即生效改派发序+报告观测；不注入零变）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  DetectResult,
  ExecutorAdapter,
  ExecutorCapabilities,
  FlowPlatform,
  Handle,
  PersonRef,
  StreamEvent,
  TaskBrief,
  TokenCounts,
} from '@studio-next/contract'
import { createModelCatalog, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import { createJudgeRuntime, type JudgeDeps } from '../../../src/engine/judge/invoke.ts'
import {
  assembleInterruptFacts,
  assemblePickFacts,
  buildInterruptSite,
  buildPickSite,
  createQueueJudge,
  INTERRUPT_HEAD_N,
  INTERRUPT_PRIORITY_MIN,
  MJ_129_INTERRUPT_SITE_ID,
  MJ_129_PICK_SITE_ID,
  moveToFrontOfUnpinned,
  parseJudgeSites,
  PICK_TOP_K_MAX,
  personViewOf,
  type QueueJudgeCandidate,
  type QueueJudgeHook,
} from '../../../src/engine/judge/sites129.ts'
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

// ————————————————————————— 语料 —————————————————————————

const MODELS_YAML = `tiers:
  high: { provider: t, model: m-h, price: { inputPerM: 0.60, outputPerM: 2.20 } }
  mid: { provider: t, model: m-m, price: { inputPerM: 0.20, outputPerM: 0.80 } }
  low: { provider: t, model: m-l, price: { inputPerM: 0.05, outputPerM: 0.25 } }
roles:
  main_worker: high
  micro_judge: low
`
const catalog = createModelCatalog(parseModelsYaml(MODELS_YAML))

const root = mkdtempSync(path.join(tmpdir(), 'judge-sites129-test-'))
let dbSeq = 0

/** 队列候选快照构造器 */
function cand(ticket: string, over: Partial<QueueJudgeCandidate> = {}): QueueJudgeCandidate {
  return {
    ticket,
    type: 'task',
    state: '新单',
    level: 0,
    priority: 1,
    pinned: false,
    boostTier: 0,
    waitMs: 60_000,
    ...over,
  }
}

// —— fake judge adapter（确定性流形态回放——与 judge-invoke.test 同款纪律） ——

interface FakeScript {
  logs?: string[]
  turnEnd?: { completed: boolean }
  statsTokens?: TokenCounts
}

class FakeJudgeAdapter implements ExecutorAdapter {
  readonly name = 'dsh-judge'
  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, cancel_turn: true, session_resume: false, agents_md: 'user_level', cost_native: false,
  }
  readonly briefTexts: string[] = [] // launch 期取证（一次性目录调用毕即删——时序内读）
  launches = 0
  constructor(protected readonly script: FakeScript) {}
  async detect(): Promise<DetectResult> {
    return { name: 'fake-judge', version: '1.0.0', ok: true, gaps: [] }
  }
  async estimate(): Promise<{ estimated: { usd: number }; confidence: number }> {
    return { estimated: { usd: 0 }, confidence: 1 }
  }
  async launch(task: TaskBrief): Promise<Handle> {
    this.launches += 1
    this.briefTexts.push(readFileSync(task.briefPath, 'utf8'))
    return { executor: this.name, sessionId: `sess-${this.launches}`, pid: 4242 }
  }
  async *stream(_h: Handle): AsyncIterable<StreamEvent> {
    for (const text of this.script.logs ?? []) yield { type: 'log', text }
    const t = this.script.turnEnd
    if (t !== undefined) yield { type: 'turn_end', completed: t.completed }
  }
  async resultStats(_h: Handle): Promise<{ cost: { usd: number }; tokens: TokenCounts; duration: number; turns: number }> {
    return { cost: { usd: 0 }, tokens: this.script.statsTokens ?? { input: 100, output: 10 }, duration: 7, turns: 1 }
  }
  async kill(_h: Handle, _graceMs: number): Promise<void> {}
}

/** 每用例独立台账+依赖（真 store openLedger——落账面不打折） */
function makeJudge(script: FakeScript, sites = { pick: true, interrupt: true }): {
  hook: QueueJudgeHook
  adapter: FakeJudgeAdapter
  ledger: Ledger
} {
  const ledger = openLedger(path.join(root, `sites129-${++dbSeq}.sqlite`))
  const adapter = new FakeJudgeAdapter(script)
  const wsParent = path.join(root, `ws-${dbSeq}`)
  mkdirSync(wsParent, { recursive: true })
  const deps: JudgeDeps = {
    company: 'demo-corp',
    ledger,
    catalog,
    makeAdapter: () => adapter,
    now: () => Date.now(),
    wsParent,
  }
  return { hook: createQueueJudge({ rt: createJudgeRuntime(), deps, sites }), adapter, ledger }
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 纯面：parseJudgeSites ——————————————————

describe('parseJudgeSites：址开关解析（fail-closed）', () => {
  it('缺省空串=两址全关；合法两址/单址装载（空白宽容）', () => {
    expect(parseJudgeSites('')).toEqual({ pick: false, interrupt: false })
    expect(parseJudgeSites('mj-129-pick,mj-129-interrupt')).toEqual({ pick: true, interrupt: true })
    expect(parseJudgeSites(' mj-129-interrupt ')).toEqual({ pick: false, interrupt: true })
  })

  it('未知址名拒绝（登记表外名字=配置错误不静默）', () => {
    expect(() => parseJudgeSites('mj-129-pick,mj-999-x')).toThrow(/不是已登记的小模型判断址/)
  })

  it('冻结常量与阈值（登记表口径——改值走批示）', () => {
    expect(MJ_129_PICK_SITE_ID).toBe('mj-129-pick')
    expect(MJ_129_INTERRUPT_SITE_ID).toBe('mj-129-interrupt')
    expect(PICK_TOP_K_MAX).toBe(5)
    expect(INTERRUPT_HEAD_N).toBe(5)
    expect(INTERRUPT_PRIORITY_MIN).toBe(2)
  })
})

// ————————————————————————— 2. 纯面：facts 装配（去偏） ——————————————————

describe('facts 装配：id 升序+同构等长+无引擎总分（去偏纪律）', () => {
  it('assemblePickFacts：候选按 ticket 升序呈报（引擎队序不透出）；同构键集；含紧急度与岗位', () => {
    // 引擎序 T-3（队首）→T-1→T-2；facts 呈报恒 id 升序——防位次锚定
    const facts = assemblePickFacts({
      person: { id: 'AGENT-1', name: '甲', dept: 'departments/工程部', level: 2, role: 'eng', skills: ['ts'] },
      candidates: [cand('T-3', { priority: 3 }), cand('T-1', { waitMs: 3_600_000, boostTier: 2 }), cand('T-2')],
    }) as { person: Record<string, unknown>; urgency: Record<string, number>; candidates: Array<Record<string, unknown>> }
    expect(facts.candidates.map((c) => c.ticket)).toEqual(['T-1', 'T-2', 'T-3'])
    // 同构等长：三候选键集完全一致（无位次标记/无引擎总分泄漏）
    const keys = facts.candidates.map((c) => Object.keys(c).sort().join(','))
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('boostTier,level,priority,state,ticket,type,waitMinutes')
    // 紧急度摘要（手算锚：maxPriority=3 / oldestWait=60min / boosted=1）
    expect(facts.urgency).toEqual({ maxPriority: 3, oldestWaitMinutes: 60, boostedCount: 1 })
    // 岗位定位（受益岗=规则档队首的派工对象；含 role/skills 可选键）
    expect(facts.person).toMatchObject({ id: 'AGENT-1', role: 'eng', skills: ['ts'] })
  })

  it('assemblePickFacts：岗位解析不到=null（诚实面不编造）', () => {
    const facts = assemblePickFacts({ person: null, candidates: [cand('T-1'), cand('T-2')] }) as { person: null }
    expect(facts.person).toBeNull()
  })

  it('assembleInterruptFacts：到达意图+在工摘要（只呈现）+队头 id 升序', () => {
    const facts = assembleInterruptFacts({
      arriving: { ticket: 'T-9', kind: 'schedule', priority: 2, source: 'scheduler' },
      inflight: [{ ticket: 'T-8', person: 'AGENT-1', dispatchedTicksAgo: 3 }],
      queueHead: [cand('T-3'), cand('T-1'), cand('T-2')],
    }) as { arriving: Record<string, unknown>; inflight: Array<Record<string, unknown>>; queueHead: Array<Record<string, unknown>> }
    expect(facts.arriving).toEqual({ ticket: 'T-9', kind: 'schedule', priority: 2, source: 'scheduler' })
    expect(facts.inflight).toEqual([{ ticket: 'T-8', person: 'AGENT-1', dispatchedTicksAgo: 3 }])
    expect(facts.queueHead.map((c) => c.ticket)).toEqual(['T-1', 'T-2', 'T-3'])
  })

  it('personViewOf：档案行→摘要（可选键缺省不落显式 undefined）', () => {
    const p: PersonRef = { id: 'AGENT-1', name: '甲', login: 'a1', level: 2, dept: 'd' }
    expect(personViewOf(p)).toEqual({ id: 'AGENT-1', name: '甲', dept: 'd', level: 2 })
    expect(personViewOf(undefined)).toBeNull()
  })
})

// ————————————————————————— 3. 纯面：词表与重排 ——————————————————

describe('词表构建（enum=上下文候选集；fallback=规则缺省档）', () => {
  it('buildPickSite：enum=非置顶候选 id 升序；fallback=规则档队首', () => {
    const site = buildPickSite([cand('T-3'), cand('T-1'), cand('T-2')])
    expect(site.siteId).toBe(MJ_129_PICK_SITE_ID)
    const spec = site.vocab.ops[0]!
    expect(spec.op).toBe('pick')
    expect(spec.params.ticket).toEqual({ kind: 'enum', values: ['T-1', 'T-2', 'T-3'] })
    expect(site.fallback('any-reason')).toEqual({ op: 'pick', params: { ticket: 'T-3' } })
  })

  it('buildInterruptSite：enum=队头 N ∪ 到达单；fallback=append（自然解）', () => {
    const site = buildInterruptSite([cand('T-2'), cand('T-1')], 'T-2')
    expect(site.siteId).toBe(MJ_129_INTERRUPT_SITE_ID)
    expect(site.vocab.ops.map((o) => o.op)).toEqual(['front', 'append'])
    expect(site.vocab.ops[0]!.params.ticket).toEqual({ kind: 'enum', values: ['T-1', 'T-2'] })
    expect(site.fallback('any-reason')).toEqual({ op: 'append', params: {} })
  })
})

describe('moveToFrontOfUnpinned：纯置换（不越权双轴的执行面）', () => {
  it('选中项上移至非置顶区头；其余保序（纯置换不增不删）', () => {
    const queue = [cand('P-1', { pinned: true }), cand('T-1'), cand('T-2'), cand('T-3')]
    expect(moveToFrontOfUnpinned(queue, 'T-3').map((c) => c.ticket)).toEqual(['P-1', 'T-3', 'T-1', 'T-2'])
    expect(moveToFrontOfUnpinned(queue, 'T-1').map((c) => c.ticket)).toEqual(['P-1', 'T-1', 'T-2', 'T-3']) // 已是头=无操作
  })

  it('置顶单选中=无操作（producer 明令不是判断面）；未知单号=原样返回', () => {
    const queue = [cand('P-1', { pinned: true }), cand('T-1'), cand('T-2')]
    expect(moveToFrontOfUnpinned(queue, 'P-1').map((c) => c.ticket)).toEqual(['P-1', 'T-1', 'T-2'])
    expect(moveToFrontOfUnpinned(queue, 'T-404').map((c) => c.ticket)).toEqual(['P-1', 'T-1', 'T-2'])
  })

  it('非连续置顶防御：落位=最后置顶项之后', () => {
    const queue = [cand('T-0'), cand('P-1', { pinned: true }), cand('T-1'), cand('T-2')]
    expect(moveToFrontOfUnpinned(queue, 'T-2').map((c) => c.ticket)).toEqual(['T-0', 'P-1', 'T-2', 'T-1'])
  })
})

// ————————————————————————— 4. 真链：pick 址 ——————————————————

describe('createQueueJudge·pick 真链（真 invokeJudge+真台账）', () => {
  it('采纳裁决：T-2 上移队头+JUDGE_OK（issue=址哨兵）+mj: 预算行', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-2"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2'), cand('T-3')],
      arrivals: [],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['T-2', 'T-1', 'T-3'])
    expect(report.pick).toMatchObject({ fired: true, op: 'pick', chosen: 'T-2' })
    expect(report.pick?.costUsd).toBeGreaterThan(0)
    expect(adapter.launches).toBe(1)
    // JUDGE_OK 事件：issue=址 id 哨兵列、actor/dept 框架面
    const ok = ledger.queryEvents().find((e) => e.event === 'JUDGE_OK')!
    expect(ok.issue).toBe(MJ_129_PICK_SITE_ID)
    expect(ok.actor).toBe('daemon:micro-judge')
    // 预算行：调用 reserve+settle（scope=mj:<site>:<callId>）+ 日帽；note=址哨兵
    expect(ok.note).toContain(`site=${MJ_129_PICK_SITE_ID}`)
    const rows = ledger.listBudgets()
    expect(rows.filter((r) => r.scope_id.startsWith(`mj:${MJ_129_PICK_SITE_ID}:`)).map((r) => r.kind).sort()).toEqual(['reserve', 'settle'])
    expect(rows.filter((r) => r.scope_id.startsWith(`mj-day:${MJ_129_PICK_SITE_ID}:`))).toHaveLength(1)
    ledger.close()
  })

  it('bad-json 降级：规则档原序保持+JUDGE_FALLBACK 落账（降级≠免费——真唤起真消耗）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['```json\n{"op":"pick","params":{"ticket":"T-2"}}\n```'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2')],
      arrivals: [],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['T-1', 'T-2']) // 降级=原序
    expect(report.pick).toMatchObject({ fired: true, degraded: true, reason: 'bad-json' })
    expect(report.pick?.op).toBeUndefined()
    const fb = ledger.queryEvents().find((e) => e.event === 'JUDGE_FALLBACK')!
    expect(fb.issue).toBe(MJ_129_PICK_SITE_ID)
    expect(fb.note).toContain('reason=bad-json')
    expect(adapter.launches).toBe(1)
    ledger.close()
  })

  it('置顶单结构性排除：enum 与 facts 双面都不含置顶单（不越权轴①）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-2"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('P-1', { pinned: true, priority: 3 }), cand('T-1'), cand('T-2')],
      arrivals: [],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['P-1', 'T-2', 'T-1']) // 置顶恒首+judge 在非置顶区重排
    expect(adapter.briefTexts[0]).not.toContain('P-1') // 词表+facts 双面零置顶（去偏同源）
    ledger.close()
  })

  it('top-K 截断：第 6 位候选不进 enum（K=5 冻结）→ 选它=域外拒收降级', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-6"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2'), cand('T-3'), cand('T-4'), cand('T-5'), cand('T-6')],
      arrivals: [],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    // T-6 不在候选集→闸③域校验拒收→降级原序（enum=上下文候选集语义）
    expect(report.pick).toMatchObject({ fired: true, degraded: true, reason: 'params-domain' })
    expect(adapter.briefTexts[0]).not.toContain('T-6')
    ledger.close()
  })
})

// ————————————————————————— 5. 点火条件（成本纪律） ——————————————————

describe('createQueueJudge·点火条件（skipped 面零 launch 零预算行）', () => {
  const base = { arrivals: [] as never[], inflight: [] as never[], person: null }

  it('solo-head：非置顶候选 <2 不唤起（单独占队首无需判断）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-1"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({ ...base, queueOrdered: [cand('P-1', { pinned: true }), cand('T-1')], dispatchWindowOpen: true })
    expect(report.pick).toMatchObject({ fired: false, skipped: 'solo-head', costUsd: 0 })
    expect(adapter.launches).toBe(0)
    expect(ledger.listBudgets()).toHaveLength(0)
    ledger.close()
  })

  it('no-dispatch-capacity：本拍派发闸无容量不唤起（队序无关紧要——不烧判断费）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-2"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({ ...base, queueOrdered: [cand('T-1'), cand('T-2'), cand('T-3')], dispatchWindowOpen: false })
    expect(report.pick).toMatchObject({ fired: false, skipped: 'no-dispatch-capacity' })
    expect(adapter.launches).toBe(0)
    ledger.close()
  })

  it('site-off：址关=观测不产段（零噪音）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-2"}}'], turnEnd: { completed: true } }, { pick: false, interrupt: false })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2')],
      arrivals: [{ ticket: 'T-2', kind: 'schedule', priority: 2, source: 'scheduler' }],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.pick).toBeUndefined()
    expect(report.interrupt).toMatchObject({ fired: false, skipped: 'site-off' }) // 到达在场仍零唤起（成本纪律可观测）
    expect(adapter.launches).toBe(0)
    ledger.close()
  })
})

// ————————————————————————— 6. interrupt 址 ——————————————————

describe('createQueueJudge·interrupt 真链', () => {
  const arrival = { ticket: 'T-9', kind: 'schedule', priority: 2, source: 'scheduler' }

  it('front 采纳：到达单上移非置顶区头（在工单只呈现不进候选集——结构性无抢占面）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"front","params":{"ticket":"T-9"}}'], turnEnd: { completed: true } }, { pick: false, interrupt: true })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('P-1', { pinned: true }), cand('T-1'), cand('T-2'), cand('T-9', { priority: 2 })],
      arrivals: [arrival],
      inflight: [{ ticket: 'T-8', person: 'AGENT-1', dispatchedTicksAgo: 2 }],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['P-1', 'T-9', 'T-1', 'T-2'])
    expect(report.interrupt).toMatchObject({ fired: true, op: 'front', chosen: 'T-9' })
    const ok = ledger.queryEvents().find((e) => e.event === 'JUDGE_OK')!
    expect(ok.issue).toBe(MJ_129_INTERRUPT_SITE_ID)
    expect(adapter.briefTexts[0]).toContain('T-8') // 在工单作为事实呈现（判断面看得见）
    ledger.close()
  })

  it('append 采纳=自然排队（原序保持）', async () => {
    const { hook, ledger } = makeJudge({ logs: ['{"op":"append","params":{}}'], turnEnd: { completed: true } }, { pick: false, interrupt: true })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2'), cand('T-9', { priority: 2 })],
      arrivals: [arrival],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['T-1', 'T-2', 'T-9'])
    expect(report.interrupt).toMatchObject({ fired: true, op: 'append' })
    ledger.close()
  })

  it('interrupt 后 pick 对插队后队序做最终选单（两址各一次=拍闸总额恰合）', async () => {
    const ledger = openLedger(path.join(root, `sites129-${++dbSeq}.sqlite`))
    // 脚本按 launch 序回放：首答 front（interrupt 址），次答 pick（pick 址）
    const outputs = ['{"op":"front","params":{"ticket":"T-9"}}', '{"op":"pick","params":{"ticket":"T-2"}}']
    let call = 0
    const adapter = new (class extends FakeJudgeAdapter {
      constructor() {
        super({ turnEnd: { completed: true } })
      }
      public override async *stream(_h: Handle): AsyncIterable<StreamEvent> {
        yield { type: 'log', text: outputs[call++] ?? '{}' }
        yield { type: 'turn_end', completed: true }
      }
    })()
    const wsParent = path.join(root, `ws-${dbSeq}`)
    mkdirSync(wsParent, { recursive: true })
    const deps: JudgeDeps = { company: 'demo-corp', ledger, catalog, makeAdapter: () => adapter, now: () => Date.now(), wsParent }
    const hook = createQueueJudge({ rt: createJudgeRuntime(), deps, sites: { pick: true, interrupt: true } })
    hook.beginTick('tick-1')
    const report = await hook.refine({
      queueOrdered: [cand('T-1'), cand('T-2'), cand('T-3'), cand('T-9', { priority: 2 })],
      arrivals: [{ ticket: 'T-9', kind: 'schedule', priority: 2, source: 'scheduler' }],
      inflight: [],
      person: null,
      dispatchWindowOpen: true,
    })
    // interrupt: T-9 插非置顶区头；pick: 对插队后队序 [T-9,T-1,T-2,T-3] 最终选单 T-2 上移头
    expect(report.queueOrdered.map((c) => c.ticket)).toEqual(['T-2', 'T-9', 'T-1', 'T-3'])
    expect(adapter.launches).toBe(2) // 两址各 1=拍闸 2 恰合（DEFAULT_JUDGE_TICK_LIMITS）
    expect(ledger.queryEvents().filter((e) => e.event === 'JUDGE_OK')).toHaveLength(2)
    ledger.close()
  })
})

// ————————————————————————— 7. 熔断与拍闸 ——————————————————

describe('createQueueJudge·熔断与拍闸（invoke.ts 机制经两址编排器透传）', () => {
  it('同因 3 连（跨拍 beginTick）→第 4 次 site-open 零 launch', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['not json at all'], turnEnd: { completed: true } })
    for (let tick = 1; tick <= 3; tick += 1) {
      hook.beginTick(`tick-${tick}`)
      const r = await hook.refine({ queueOrdered: [cand('T-1'), cand('T-2')], arrivals: [], inflight: [], person: null, dispatchWindowOpen: true })
      expect(r.pick).toMatchObject({ degraded: true, reason: 'bad-json' })
    }
    hook.beginTick('tick-4')
    const r4 = await hook.refine({ queueOrdered: [cand('T-1'), cand('T-2')], arrivals: [], inflight: [], person: null, dispatchWindowOpen: true })
    expect(r4.pick).toMatchObject({ degraded: true, reason: 'site-open' })
    expect(adapter.launches).toBe(3) // 第 4 次零 launch（熔断器开——码面不烧钱）
    ledger.close()
  })

  it('同拍第二调 tick-quota；beginTick 后复位（1/址/拍）', async () => {
    const { hook, adapter, ledger } = makeJudge({ logs: ['{"op":"pick","params":{"ticket":"T-2"}}'], turnEnd: { completed: true } })
    hook.beginTick('tick-1')
    await hook.refine({ queueOrdered: [cand('T-1'), cand('T-2')], arrivals: [], inflight: [], person: null, dispatchWindowOpen: true })
    const again = await hook.refine({ queueOrdered: [cand('T-1'), cand('T-2')], arrivals: [], inflight: [], person: null, dispatchWindowOpen: true })
    expect(again.pick).toMatchObject({ degraded: true, reason: 'tick-quota' })
    expect(adapter.launches).toBe(1)
    hook.beginTick('tick-2') // 新拍计数清零
    const next = await hook.refine({ queueOrdered: [cand('T-1'), cand('T-2')], arrivals: [], inflight: [], person: null, dispatchWindowOpen: true })
    expect(next.pick).toMatchObject({ fired: true, op: 'pick' })
    expect(adapter.launches).toBe(2)
    ledger.close()
  })
})

// ————————————————————————— 8. 引擎接线 ——————————————————

const PEOPLE_2: readonly PersonRef[] = [
  { id: 'AGENT-1', name: '甲工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
  { id: 'AGENT-2', name: '乙工程师', login: 'agent-2', level: 2, dept: 'departments/工程部' },
]
const T0 = Date.UTC(2026, 9, 24, 0, 0, 0)
let engineRoot = ''

interface EngineParts {
  platform: FlowPlatform
  ledger: Ledger
  clock: { now(): number; advance(ms: number): void }
}

function buildParts(): EngineParts {
  const ledger = openLedger(path.join(engineRoot, `engine-${++dbSeq}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  return { platform, ledger, clock }
}

function buildEngine(parts: EngineParts, judge?: QueueJudgeHook): Engine {
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  return createEngine({
    platform: parts.platform,
    ledger: parts.ledger,
    ...(judge !== undefined ? { judge } : {}),
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: parts.clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(engineRoot, `root-${dbSeq}`),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      limits: { maxActionsPerTick: 1, maxInflight: 4 },
      mirrorRescanEveryTicks: 1, // 顺延单活动已被游标消费——rescan 唤回（DEV-42① 兜底）
    },
    people: PEOPLE_2,
  })
}

beforeAll(async () => {
  engineRoot = await mkdtemp(path.join(tmpdir(), 'judge-sites129-engine-'))
})

afterAll(async () => {
  await rm(engineRoot, { recursive: true, force: true })
})

describe('引擎接线（队列定序后、派发决策前——C7 口径）', () => {
  it('不注入=规则缺省档：报告无 judge 段（行为零变）', async () => {
    const parts = buildParts()
    const engine = buildEngine(parts)
    await parts.platform.issues.create({ title: '单甲', type: 'task', level: 0 })
    await parts.platform.issues.create({ title: '单乙', type: 'task', level: 0 })
    parts.clock.advance(1000)
    const report = await engine.tick()
    expect(report.phases.stateDiff.judge).toBeUndefined()
    parts.ledger.close()
  })

  it('注入即生效：采纳 pick 改本拍派发首单+TickReport.stateDiff.judge 观测', async () => {
    const parts = buildParts()
    // 判定脚本目标=可变闭包（真单号在建单后才知——launch 时读即真）
    let pickTarget = ''
    const ledger = openLedger(path.join(engineRoot, 'judge-inline.sqlite'))
    const adapter = new (class extends FakeJudgeAdapter {
      constructor() {
        super({ turnEnd: { completed: true } })
      }
      public override async *stream(_h: Handle): AsyncIterable<StreamEvent> {
        yield { type: 'log', text: `{"op":"pick","params":{"ticket":"${pickTarget}"}}` }
        yield { type: 'turn_end', completed: true }
      }
    })()
    const wsParent = path.join(engineRoot, 'ws-inline')
    mkdirSync(wsParent, { recursive: true })
    const deps: JudgeDeps = { company: 'demo', ledger, catalog, makeAdapter: () => adapter, now: () => Date.now(), wsParent }
    const hook = createQueueJudge({ rt: createJudgeRuntime(), deps, sites: { pick: true, interrupt: false } })

    const a = await parts.platform.issues.create({ title: '单甲', type: 'task', level: 0 })
    const b = await parts.platform.issues.create({ title: '单乙', type: 'task', level: 0 })
    await parts.platform.issues.setField(a.id, 'assignee', 'AGENT-1')
    await parts.platform.issues.setField(b.id, 'assignee', 'AGENT-2')
    await parts.platform.issues.setField(b.id, 'lane', 'extra') // 异泳道：摘掉泳道闸，纯证精序（闸序=泳道>人）
    const engine = buildEngine(parts, hook)

    // 规则档序=创建序（同分 FIFO）：甲 → 乙；judge 令乙先派（maxActionsPerTick=1 每拍一单）
    pickTarget = b.id
    parts.clock.advance(1000)
    const report1: TickReport = await engine.tick()
    expect(report1.phases.stateDiff.judge?.pick).toMatchObject({ fired: true, op: 'pick', chosen: b.id })
    expect(report1.phases.dispatch.dispatched).toBe(1)
    expect(report1.actions[0]).toMatchObject({ type: 'dispatch', ticket: b.id }) // 本拍派发首单=乙

    // 次拍：乙在工（非候选），pick 独头跳过；甲按规则档派发（派发序=乙→甲）
    parts.clock.advance(1000)
    const report2 = await engine.tick()
    expect(report2.phases.stateDiff.judge?.pick).toMatchObject({ fired: false, skipped: 'solo-head' })
    expect(report2.actions.find((x) => x.type === 'dispatch')).toMatchObject({ ticket: a.id })
    expect(parts.ledger.queryEvents().filter((e) => e.event === 'DISPATCH').map((d) => d.issue)).toEqual([b.id, a.id])
    expect(a.id < b.id).toBe(true) // 甲先建（规则档首派本应是甲）——精序真改写了派发序
    ledger.close()
    parts.ledger.close()
  })
})
