/**
 * merge-run unit —— S1 触发面/S2 闸门四脸/S3 指令块/S1e 租约（202-P2，studio-dev-232）
 *
 * 断言面（对契约与冻结口径负责，不对实现细节）：
 *   - S1 轨道分派：面关（mergeRun 缺省）/非 post-verified 位 → v0 模拟轨 byte-identical
 *     （note 原文/计数/迁移——P1 语义零变更的机械钉子）；standing 缺席=顺延不弃单；
 *     merge=manual 标记=终局让位（chain=manual ESCALATE 每单一次 dedupe）。
 *   - S2 闸门四脸：提交核验三红脸（分支不可解析/单亲非真合并/祖先缺位）+命令面独立
 *     （命令红=exit0 假）+全绿（mergeSha=目标 tip）。
 *   - S3 指令块：R5 目标分支/不强推/回执落点/门禁命令原文冻结。
 *   - S1e 租约：全链派发（resume 唤起原会话+attempt 续号+causation 链+DISPATCH 锚）→
 *     他单同枝顺延 → 收口释放后可再派；closeOut 全绿/缺件两脸（GATE_PASS→MERGE 事件
 *     face 与 GATE_FAIL+merge=manual 锚 face）；failMergeHarvest worker 消亡面。
 *
 * 引擎级接线（相位 5 真调用/harvest 折算/decide 同拍批准）见 merge-run.e2e.test.ts。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { DEFAULT_FLOW_TABLE, resolveTicketFlow } from '@studio-next/core'
import type { CompanySlug, EventRecord, ExecutorAdapter, FlowPlatform, Handle, IssueRecord, PersonRef, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, FAKE_SUMMARY_JSON } from '../../../src/engine/fakes.ts'
import { buildEventIndex, MERGE_CHAIN_ANCHOR, MERGE_MANUAL_ANCHOR, MERGE_RUN_ANCHOR } from '../../../src/engine/sentinel/events-index.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'
import { runMergeAction, closeOutMergeHarvest, failMergeHarvest, type MergeRunHost, type MergeRunDeps } from '../../../src/engine/merge/merge-run.ts'
import { runMergeGate, type MergeGitPort } from '../../../src/engine/merge/merge-gate.ts'
import { mergeDirectiveBlock, MERGE_BRIEF_FILENAME, MERGE_RECEIPT_FILENAME } from '../../../src/engine/merge/merge-brief.ts'
import type { TickPhaseDispatchBudget } from '../../../src/engine/tick-report/types.ts'
import type { DirectiveVerb } from '../../../src/engine/directive/index.ts'

const DEPT = 'departments/工程部'

function person(id: string): PersonRef {
  return { id, name: id, login: id.toLowerCase(), level: 1, dept: DEPT }
}

const ROSTER: readonly PersonRef[] = [person('ENG-1'), person('ENG-0'), person('PLN-9')]

const DEV_TASK_WF = {
  types: [
    {
      id: 'devtask',
      states: [{ name: '新单' }, { name: '已派发' }, { name: '证据就绪' }, { name: '复验通过' }, { name: '待验收' }, { name: '已交付', final: true }],
      edges: [{ from: '待验收', to: '已派发' }],
      anchors: { inbox: '新单', approval: '待验收', dispatched: '已派发', evidence: '证据就绪', verified: '复验通过', delivered: '已交付' },
    },
  ],
}

function devTaskFlows() {
  const t = flowsFromWorkflows(DEV_TASK_WF)
  if (t === undefined) throw new Error('T:devtask 流合成失败')
  return { ...DEFAULT_FLOW_TABLE, ...t }
}

/** 合并跑可续 fake：launch 带 executorSessionId（契约 v1.5）；resumeWithSession 写回执（要件 3 的 worker 面） */
function createMergeCapableAdapter(opts?: { withExecutorSid?: boolean; onMerge?: (task: TaskBrief, executorSessionId: string) => void }): ExecutorAdapter {
  const base = createFakeAdapter({ name: 'fake-mg' })
  return {
    ...base,
    capabilities: { ...base.capabilities, session_resume: true },
    async launch(task: TaskBrief): Promise<Handle> {
      const h = await base.launch(task)
      return opts?.withExecutorSid === false ? h : { ...h, executorSessionId: `${h.sessionId}-exec` }
    },
    async resumeWithSession(task: TaskBrief, executorSessionId: string): Promise<Handle> {
      opts?.onMerge?.(task, executorSessionId)
      const h = await base.launch(task)
      writeFileSync(path.join(task.workspace, MERGE_RECEIPT_FILENAME), '# 合并回执\n\nmerge commit m-sha-9；无冲突；门禁自跑 exit 0。\n', 'utf8')
      return { ...h, executorSessionId }
    },
  }
}

function fakeGit(o: { tip?: string | null; parents?: number; ancestor?: boolean; pushOk?: boolean }): MergeGitPort & { pushes: string[] } {
  const pushes: string[] = []
  return {
    pushes,
    revParseHead: async () => 'rev-aaa',
    branchTip: async (_repo: string, branch: string) => (branch === 'dev' ? (o.tip === null ? undefined : (o.tip ?? 'm-sha-9')) : undefined),
    isAncestor: async () => o.ancestor ?? true,
    tipParentCount: async () => o.parents ?? 2,
    push: async (repo: string, branch: string) => {
      pushes.push(`${repo}|${branch}`)
      return o.pushOk === false ? { ok: false, note: 'fake push denied（网络面）' } : { ok: true, note: 'fake push ok' }
    },
  }
}

function fakeGate(code: number) {
  return { run: async (_repoDir: string): Promise<{ code: number; note: string }> => ({ code, note: code === 0 ? '测试门禁（引擎亲跑）：[1] bun run test exit=0' : '测试门禁（引擎亲跑）：[1] bun run test exit=1 out=1 failed' }) }
}

interface UnitHost {
  host: MergeRunHost
  platform: FlowPlatform
  ledger: Ledger
  events: EventRecord[]
  dir: string
}

function buildHost(o: { adapter?: ExecutorAdapter; mergeRun?: MergeRunDeps }): UnitHost {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-run-unit-'))
  const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
  const platform = createFakePlatform({ now: () => '2026-10-24T00:00:00.000Z' })
  const registry = createRegistry()
  registry.register(o.adapter ?? createMergeCapableAdapter(), { default: true })
  const events: EventRecord[] = []
  let seqN = 0
  let idN = 0
  const flows = devTaskFlows()
  const host: MergeRunHost = {
    platform,
    ledger,
    registry,
    assemble: (input) => ({
      agentsMd: { text: `AGENTS demo（merge-run unit 誓 ${input.attempt}）`, fingerprint: 'fp-unit-0' },
      brief: {
        text: `任务书（merge-run unit 誓 ${input.attempt}）\n`,
        taskBrief: { ticket: input.issue.id, attempt: input.attempt, briefPath: input.briefPath, workspace: input.workspace, AGENTS_MD: { channel: 'native', target: input.agentsTarget } },
      },
    }),
    config: { ...ENGINE_CONFIG_DEFAULTS, company: 'demo' as CompanySlug, rootDir: dir, aiwsRoot: dir, defaultPersonId: 'ENG-1', deptFallback: DEPT, defaultLane: 'core', actor: 'PLN-9', flows },
    people: () => ROSTER,
    budgetDeps: { ledger, makeId: (ts: number): string => `b-${ts}-${(idN += 1)}` },
    costGuard: () => undefined,
    modelTiers: undefined,
    inflight: new Map(),
    mergeRun: o.mergeRun,
    seq: (): number => (seqN += 1),
    now: (): number => 1_000,
    makeId: (_ts: number): string => ulid((idN += 1)),
    makeEvent: (name, issue, attempt, tickEvents, extra) => {
      const evt = {
        id: ulid((idN += 1)),
        ts: 1_000,
        company: 'demo',
        issue: issue.id,
        event: name,
        actor: 'PLN-9',
        attempt,
        level: 1,
        dept: DEPT,
        tokens: extra?.tokens ?? { input: 0 },
        ...(extra?.note !== undefined ? { note: extra.note } : {}),
        ...(extra?.causation_id !== undefined ? { causation_id: extra.causation_id } : {}),
      } as EventRecord
      ledger.appendEvent(evt) // 台账真落（attempt 续号/dedupe 面经 buildEventIndex(ledger) 可见——与引擎同构）
      events.push(evt)
      if (tickEvents !== events) tickEvents.push(evt)
      return evt
    },
    syncMirror: () => undefined,
    resolvePerson: (issue: { assignee?: string }): PersonRef | undefined => ROSTER.find((p) => p.id === issue.assignee),
    flowOf: (issue: { type?: string; level?: number }) => resolveTicketFlow(flows, issue.type, issue.level),
  }
  return { host, platform, ledger, events, dir }
}

async function seedTicket(platform: FlowPlatform, state: string): Promise<IssueRecord> {
  return platform.issues.create({ title: '合并跑单', type: 'devtask', dept: DEPT, level: 1, assignee: 'ENG-1', initialState: state })
}

let seedSeq = 0

/** 播种断点：工位（summary sidecar+repo 目录）+末位工时单（session_id+summary_ref+executor_session_id 收口） */
function seedBreakpoint(u: UnitHost, ticket: TicketId, wsName: string, executorSid: string): string {
  const ws = path.join(u.dir, wsName)
  mkdirSync(path.join(ws, 'repo'), { recursive: true })
  const summaryPath = path.join(ws, 'summary.json')
  writeFileSync(summaryPath, FAKE_SUMMARY_JSON, 'utf8')
  const wrId = `wr-${wsName}`
  u.ledger.insertWorkRecord({ id: wrId, issue: ticket, person_id: 'ENG-1', executor: 'fake-mg', session_id: 'fake-mg-1', lane: 'core', started_at: 1, attempt: 1, status: 'running' })
  u.ledger.endWorkRecord(wrId, { ended_at: 2, status: 'done', summary_ref: summaryPath, ...(executorSid !== '' ? { executor_session_id: executorSid } : {}) })
  // 誓 1 的 DISPATCH 事件（attempt 续号=buildEventIndex 计数面——与引擎链路同构）
  u.ledger.appendEvent({ id: ulid(900 + (seedSeq += 1)), ts: 1, company: 'demo', issue: ticket, event: 'DISPATCH', actor: 'PLN-9', attempt: 1, level: 1, dept: DEPT, tokens: { input: 0 } } as EventRecord)
  return ws
}

/** 合规 ULID（26 字符 Crockford——台账 events 主键闸） */
function ulid(n: number): string {
  return '0'.repeat(10) + String(n).padStart(16, '0')
}

function emptyBudget(): TickPhaseDispatchBudget {
  return { budgetReserved: 0, budgetRefused: 0 }
}

function standingMap(ticket: TicketId): Map<TicketId, DirectiveVerb> {
  return new Map([[ticket, '批准']])
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'merge-run-unit-suite-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('S2 runMergeGate 四脸（先门禁后 MERGE 的核验面）', () => {
  const cases: ReadonlyArray<{ name: string; tip?: string; parents?: number; ancestor?: boolean; gateCode: number; wantExit0: boolean; wantNote: string }> = [
    { name: '目标分支不可解析', tip: null, gateCode: 0, wantExit0: false, wantNote: '目标分支 dev 不可解析' },
    { name: 'tip 单亲=非真合并提交（未合入或 fast-forward 形）', parents: 1, gateCode: 0, wantExit0: false, wantNote: '非真合并提交' },
    { name: 'reviewTip 非目标分支祖先（合入提交缺位）', ancestor: false, gateCode: 0, wantExit0: false, wantNote: '非 dev 祖先' },
    { name: '命令面红=exit0 假（命令与提交两面独立）', gateCode: 1, wantExit0: false, wantNote: '门禁 exit=1' },
    { name: '全绿：命令 exit0 ∧ 提交核验过', gateCode: 0, wantExit0: true, wantNote: '门禁 exit=0' },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const r = await runMergeGate({ git: fakeGit(c), gate: fakeGate(c.gateCode), repoDir: '/tmp/repo', reviewTip: 'rev-aaa', targetBranch: 'dev' })
      expect(r.exit0).toBe(c.wantExit0)
      expect(r.note).toContain(c.wantNote)
      if (c.wantExit0) expect(r.mergeSha).toBe('m-sha-9')
    })
  }
  it('git 端口抛错不炸拍（出口永不抛——失败面照走 GATE_FAIL）', async () => {
    const throwing: MergeGitPort = {
      revParseHead: async () => 'x',
      branchTip: async () => {
        throw new Error('git 不可用')
      },
      isAncestor: async () => true,
      tipParentCount: async () => 2,
      push: async () => ({ ok: false, note: 'x' }),
    }
    const r = await runMergeGate({ git: throwing, gate: fakeGate(0), repoDir: '/tmp/repo', reviewTip: 'rev-aaa', targetBranch: 'dev' })
    expect(r.exit0).toBe(false)
    expect(r.exitCode).toBe(-1)
    expect(r.note).toContain('git 不可用')
  })
})

describe('S3 合并指令块（R5/R1/R3 冻结原文）', () => {
  it('目标分支/不强推/回执落点/门禁命令原文', () => {
    const b = mergeDirectiveBlock('dev', ['bun', 'run', 'test'])
    expect(b).toContain('目标分支：dev')
    expect(b).toContain('不得强推、不得重写历史')
    expect(b).toContain(`合并回执：把合并回执写到工位根 ${MERGE_RECEIPT_FILENAME}`)
    expect(b).toContain('门禁命令 `bun run test`')
    expect(b).toContain('引擎将亲跑核验（R1）')
    expect(b).toContain('冲突自解（R3）')
  })
})

describe('S1 触发面（轨道分派/顺延/终局让位）', () => {
  it('面关（mergeRun 缺省）=v0 模拟轨 byte-identical', async () => {
    const u = buildHost({})
    const t = await seedTicket(u.platform, '待验收')
    const r = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), [], emptyBudget(), new Map())
    expect(r.counted).toBe(true)
    expect(r.mutated).toBe(true)
    expect(r.result.ok).toBe(true)
    expect(r.result.detail).toBe('→已交付（模拟）')
    expect(u.events.map((e) => e.event)).toEqual(['MERGE'])
    expect(u.events[0]?.note).toBe('→已交付（v0 模拟合并：无真 git 合并，归 v0.5 真单刀）')
    expect((await u.platform.issues.get(t.id)).state).toBe('已交付')
    u.ledger.close()
  })

  it('非 post-verified 位（已派发）即使 mergeRun 在场也走 v0 模拟轨', async () => {
    const u = buildHost({ mergeRun: { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git: fakeGit({}), gate: fakeGate(0) } })
    const t = await seedTicket(u.platform, '已派发')
    const r = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), [], emptyBudget(), standingMap(t.id))
    expect(r.counted).toBe(true)
    expect(u.events[0]?.note).toContain('v0 模拟合并')
    u.ledger.close()
  })

  it('standing 批示不在场=顺延（不计数不上报不迁移）', async () => {
    const u = buildHost({ mergeRun: { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git: fakeGit({}), gate: fakeGate(0) } })
    const t = await seedTicket(u.platform, '待验收')
    const r = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), [], emptyBudget(), new Map())
    expect(r.deferred).toBe(true)
    expect(r.mutated).toBe(false)
    expect(r.counted).toBe(false)
    expect(u.events).toHaveLength(0)
    expect((await u.platform.issues.get(t.id)).state).toBe('待验收')
    u.ledger.close()
  })

  it('merge=manual 标记=终局让位（chain=manual ESCALATE 每单一次 dedupe）', async () => {
    const deps: MergeRunDeps = { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git: fakeGit({}), gate: fakeGate(0) }
    const u = buildHost({ mergeRun: deps })
    const t = await seedTicket(u.platform, '待验收')
    const gateFail = {
      id: ulid(950), ts: 1, company: 'demo', issue: t.id, event: 'GATE_FAIL', actor: 'PLN-9', attempt: 2, level: 1, dept: DEPT,
      tokens: { input: 0 }, note: `合并跑四要件缺 闸门exit0；…;${MERGE_RUN_ANCHOR};${MERGE_MANUAL_ANCHOR}——降级宰相手工链`,
    } as EventRecord
    u.ledger.appendEvent(gateFail)
    const r1 = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), u.events, emptyBudget(), standingMap(t.id))
    expect(r1.ok ?? r1.result.ok).toBe(true)
    expect(r1.counted).toBe(false)
    expect(r1.mutated).toBe(true)
    expect(u.events.map((e) => e.event)).toEqual(['ESCALATE'])
    expect(u.events[0]?.note).toContain(MERGE_CHAIN_ANCHOR)
    expect(u.events[0]?.note).toContain('merge=manual')
    expect((await u.platform.issues.get(t.id)).state).toBe('待验收')
    const r2 = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), [], emptyBudget(), standingMap(t.id))
    expect(r2.mutated).toBe(false)
    expect(u.events).toHaveLength(1)
    u.ledger.close()
  })
})

describe('S1e 派发-租约-收口全链（host 级）', () => {
  function mergeDeps(git: MergeGitPort & { pushes: string[] }, gateCode = 0): MergeRunDeps {
    return { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git, gate: fakeGate(gateCode) }
  }

  it('全链绿：resume 唤起原会话派发→租约互斥→closeOut 四要件→MERGE 真事件→释放后再派', async () => {
    const git = fakeGit({})
    const merges: Array<{ task: TaskBrief; executorSessionId: string }> = []
    const u = buildHost({ adapter: createMergeCapableAdapter({ onMerge: (task, executorSessionId) => merges.push({ task, executorSessionId }) }), mergeRun: mergeDeps(git) })
    const a = await seedTicket(u.platform, '待验收')
    seedBreakpoint(u, a.id, 'ws-a', 'fake-mg-1-exec')
    const r = await runMergeAction(u.host, { type: 'merge', ticket: a.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), u.events, emptyBudget(), standingMap(a.id))
    expect(r.counted).toBe(false) // 合并完成计数在收割收口面
    expect(r.mutated).toBe(true)
    expect(u.events.map((e) => e.event)).toEqual(['DISPATCH'])
    const dn = u.events[0]?.note ?? ''
    expect(dn).toContain(MERGE_RUN_ANCHOR)
    expect(dn).toContain('resume=fake-mg-1-exec@fake-mg')
    expect(dn).toContain('合并跑唤起原会话')
    expect(u.events[0]?.causation_id).toBe('wr-ws-a')
    expect(merges).toHaveLength(1)
    expect(merges[0]?.executorSessionId).toBe('fake-mg-1-exec')
    const recs = u.ledger.listWorkRecords({ issue: a.id })
    expect(recs.map((x) => x.attempt)).toEqual([1, 2])
    expect(recs[1]?.session_id).toBe('fake-mg-1')
    const entry = u.host.inflight.get(a.id)
    expect(entry?.mergeRun?.reviewTip).toBe('rev-aaa')
    expect(entry?.mergeRun?.leaseKey).toBe('demo:dev')
    // 合并任务书落盘（merge-brief.md）且含指令块
    const brief = path.join(entry?.workspace ?? '', MERGE_BRIEF_FILENAME)
    const briefText = (await import('node:fs')).readFileSync(brief, 'utf8')
    expect(briefText).toContain('目标分支：dev')
    // —— 他单同枝：租约忙顺延 ——
    const b = await seedTicket(u.platform, '待验收')
    const rb = await runMergeAction(u.host, { type: 'merge', ticket: b.id, toState: '已交付' }, buildEventIndex(u.events), [], emptyBudget(), standingMap(b.id))
    expect(rb.deferred).toBe(true)
    expect(u.events.filter((e) => e.event === 'DISPATCH').length).toBe(1)
    // —— 收口全绿：GATE_PASS→push→MERGE→已交付 ——
    if (entry === undefined) throw new Error('inflight 缺位')
    entry.foldCompleted = true
    entry.foldNonEmpty = true
    const adapter = u.host.registry.resolve('fake-mg')
    const errs: string[] = []
    const verdict = await closeOutMergeHarvest(u.host, adapter, entry, [], errs)
    expect(verdict).toBe('completed')
    expect(errs).toEqual([])
    expect(u.events.map((e) => e.event)).toEqual(['DISPATCH', 'GATE_PASS', 'MERGE'])
    const mergeNote = u.events[2]?.note ?? ''
    expect(mergeNote).toContain('sha=m-sha-9')
    expect(mergeNote).toContain('resume=fake-mg-1-exec@fake-mg')
    expect(mergeNote).toContain('push=ok')
    expect(git.pushes).toEqual([`${path.join(entry.workspace, 'repo')}|dev`])
    expect((await u.platform.issues.get(a.id)).state).toBe('已交付')
    const closed = u.ledger.listWorkRecords({ issue: a.id })[1]
    expect(closed?.status).toBe('done')
    expect(closed?.report_ref).toContain(MERGE_RECEIPT_FILENAME)
    expect(closed?.executor_session_id).toBe('fake-mg-1-exec')
    const settles = u.ledger.listBudgets({ kinds: ['settle'] }).filter((x) => x.scope_id === a.id)
    expect(settles).toHaveLength(1)
    // —— 租约已释放：B 补断点后可派 ——
    seedBreakpoint(u, b.id, 'ws-b', 'fake-mg-1-exec')
    const rb2 = await runMergeAction(u.host, { type: 'merge', ticket: b.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), [], emptyBudget(), standingMap(b.id))
    expect(rb2.deferred).toBe(false)
    expect(u.events.filter((e) => e.event === 'DISPATCH').length).toBe(2)
    const entryB = u.host.inflight.get(b.id) // B 也收口（租约释放——模块级租约簿不污染后续用例）
    if (entryB !== undefined) {
      entryB.foldCompleted = true
      entryB.foldNonEmpty = true
      await closeOutMergeHarvest(u.host, adapter, entryB, [], [])
    }
    u.ledger.close()
  })

  it('断点缺 executor_session_id=降级手工链（重启打断合并跑同此面）', async () => {
    const u = buildHost({ adapter: createMergeCapableAdapter({ withExecutorSid: false }), mergeRun: mergeDeps(fakeGit({})) })
    const t = await seedTicket(u.platform, '待验收')
    seedBreakpoint(u, t.id, 'ws-c', '') // 末位工时单无 executor_session_id
    const r = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), u.events, emptyBudget(), standingMap(t.id))
    expect(r.counted).toBe(false)
    expect(u.events.map((e) => e.event)).toEqual(['ESCALATE'])
    expect(u.events[0]?.note).toContain(MERGE_CHAIN_ANCHOR)
    expect(u.events[0]?.note).toContain('executor_session_id')
    expect((await u.platform.issues.get(t.id)).state).toBe('待验收')
    expect(u.ledger.listWorkRecords({ issue: t.id })).toHaveLength(1)
    u.ledger.close()
  })

  it('closeOut 缺件脸：门禁红→GATE_FAIL+merge=manual 锚→待验收不动→工时单 failed→无断路', async () => {
    const git = fakeGit({ parents: 1 }) // 提交核验不过（未合入）
    const u = buildHost({ adapter: createMergeCapableAdapter(), mergeRun: mergeDeps(git, 1) })
    const t = await seedTicket(u.platform, '待验收')
    seedBreakpoint(u, t.id, 'ws-d', 'fake-mg-1-exec')
    await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), u.events, emptyBudget(), standingMap(t.id))
    const entry = u.host.inflight.get(t.id)
    if (entry === undefined) throw new Error('inflight 缺位')
    entry.foldCompleted = true
    entry.foldNonEmpty = true
    const errs: string[] = []
    const verdict = await closeOutMergeHarvest(u.host, u.host.registry.resolve('fake-mg'), entry, errs)
    expect(verdict).toBe('failed')
    const fail = u.events.find((e) => e.event === 'GATE_FAIL')
    expect(fail?.note).toContain(MERGE_RUN_ANCHOR)
    expect(fail?.note).toContain(MERGE_MANUAL_ANCHOR)
    expect(fail?.note).toContain('闸门exit0')
    expect((await u.platform.issues.get(t.id)).state).toBe('待验收')
    expect(u.ledger.listWorkRecords({ issue: t.id })[1]?.status).toBe('failed')
    // merge=manual 标记生效：standing 在场也终局让位（每单一次 ESCALATE 已落——本面降级不重复报）
    const r2 = await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.events), [], emptyBudget(), standingMap(t.id))
    expect(r2.counted).toBe(false)
    expect(u.events.filter((e) => e.event === 'DISPATCH').length).toBe(1)
    u.ledger.close()
  })

  it('failMergeHarvest（worker 消亡面）：GATE_FAIL+failed+结算+租约释放', async () => {
    const git = fakeGit({})
    const u = buildHost({ adapter: createMergeCapableAdapter(), mergeRun: mergeDeps(git) })
    const t = await seedTicket(u.platform, '待验收')
    seedBreakpoint(u, t.id, 'ws-e', 'fake-mg-1-exec')
    await runMergeAction(u.host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(u.ledger.queryEvents()), u.events, emptyBudget(), standingMap(t.id))
    const entry = u.host.inflight.get(t.id)
    if (entry === undefined) throw new Error('inflight 缺位')
    const verdict = await failMergeHarvest(u.host, entry, 'stream 异常：worker 会话消失', [])
    expect(verdict).toBe('failed')
    const fail = u.events.find((e) => e.event === 'GATE_FAIL')
    expect(fail?.note).toContain('worker 会话消失')
    expect(fail?.note).toContain(MERGE_MANUAL_ANCHOR)
    expect(u.ledger.listWorkRecords({ issue: t.id })[1]?.status).toBe('failed')
    // 租约已释放：新单可再占
    const b = await seedTicket(u.platform, '待验收')
    seedBreakpoint(u, b.id, 'ws-f', 'fake-mg-1-exec')
    const rb = await runMergeAction(u.host, { type: 'merge', ticket: b.id, toState: '已交付' }, buildEventIndex(u.events), [], emptyBudget(), standingMap(b.id))
    expect(rb.deferred).toBe(false)
    u.ledger.close()
  })
})
