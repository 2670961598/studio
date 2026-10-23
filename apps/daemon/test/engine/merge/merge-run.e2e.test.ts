/**
 * merge-run e2e —— 相位 5 真单刀（202-P2，studio-dev-232，proposal §7 S4-S7；docs/17-§2 合并相位双轨注记；
 * S7 并发串行面由 202-P4（studio-dev-234）改写为单栈双单——合并租约去模块共享改 per-engine 簿）。
 *
 * 断言面（判负线照提案冻结口径，逐字）：
 *   - S4 真单刀全链：待验收+dispatcher 批准→同拍**派发合并跑**（非同拍迁移——留待验收，
 *     与 P1 S2 模拟轨的同拍迁移对照）；resume 唤起原会话（resumeWithSession+executor_session_id）；
 *     最小合并任务书（merge-brief.md）含合并指令块；次拍收割四要件→GATE_PASS→MERGE 真事件
 *     （sha/门禁摘要/续跑证据/推送结果）→已交付；attempt 续号 [1,2]；工时单 done+回执
 *     report_ref；causation 链；预算结算；无断路事件。
 *   - S5 降级手工链：断点缺 executor_session_id→ESCALATE chain=manual 每单一次（dedupe）；
 *     状态留待验收；无合并跑派发；每拍重查（修复自恢复面归 P4 文档缝）。
 *   - S6 闸门红收口（202-P3 冲突兜底面）：四要件缺（门禁 exit≠0）→GATE_FAIL
 *     （merge-run+merge=manual+category=MERGE_CONFLICT 锚）+ESCALATE 通知宰相+清站立；
 *     状态留待验收；工时单 failed；断路器不计连击（无 CIRCUIT_BREAK）；不自动重试
 *     （无新批示零拍重派）；再批准（R6 腿）→v0 模拟迁移转正收口（note 如实——手工链
 *     收口/无真 git 合并，不冒充真单刀）。
 *   - S7 合并租约（202-P4，studio-dev-234）：单栈双单同拍批准→一派一顺延
 *     （第二单 actionResults=merge-lease-busy，ok=true 不失败）；合并队列栏只读投影
 *     （waiting/running/lease）；A 收口释放→B 经镜像 rescan 兜底补派→两单先后已交付
 *     （push 串行 1+1——判负线「两列并发推 dev」反面）。
 *
 * 载体铁律（C3）：daemon 仍是唯一状态推进者；v0 模拟轨回归面=P1 acceptance.e2e.test.ts
 * S2（无 mergeRun 注入栈——byte-identical 不改不删）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, Handle, PersonRef, TaskBrief, TicketWorkflows } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'
import type { MergeGitPort } from '../../../src/engine/merge/merge-gate.ts'
import type { MergeRunDeps } from '../../../src/engine/merge/merge-run.ts'
import { MERGE_BRIEF_FILENAME, MERGE_RECEIPT_FILENAME } from '../../../src/engine/merge/merge-brief.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'merge-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'merge-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-24T00:00:00.000Z')

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

const DEPT = 'departments/工程部'

function person(id: string, login: string, level: number, dept = DEPT): PersonRef {
  return { id, name: id, login, level, dept }
}

const ROSTER: readonly PersonRef[] = [
  person('ENG-1', 'eng-1', 1),
  person('ENG-2', 'eng-2', 1),
  person('ENG-0', 'eng-0', 3),
  person('PLN-9', 'pln-9', 1),
  person('producer', 'boss', 9),
]

const DIRECTIVE_DEPS = {
  departments: new Map([[DEPT, 'ENG-0']]),
  extraWhitelist: [],
  producer: 'producer',
}

const DEV_TASK_WF: TicketWorkflows = {
  types: [
    {
      id: 'devtask',
      states: [
        { name: '新单' },
        { name: '已派发' },
        { name: '证据就绪' },
        { name: '复验通过' },
        { name: '待验收' },
        { name: '已交付', final: true },
      ],
      edges: [{ from: '待验收', to: '已派发' }],
      anchors: { inbox: '新单', approval: '待验收', dispatched: '已派发', evidence: '证据就绪', verified: '复验通过', delivered: '已交付' },
    },
  ],
}

function devTaskFlows(): FlowTable {
  const t = flowsFromWorkflows(DEV_TASK_WF)
  if (t === undefined) throw new Error('T:devtask 流合成失败')
  return { ...DEFAULT_FLOW_TABLE, ...t }
}

/** 合并跑可续 fake（契约 v1.5）：launch 收 executorSessionId；resumeWithSession=唤起面+回执落盘 */
function createMergeCapableAdapter(opts?: { withExecutorSid?: boolean; onMerge?: (task: TaskBrief, executorSessionId: string) => void }) {
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
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path.join(task.workspace, MERGE_RECEIPT_FILENAME), '# 合并回执\n\nmerge commit m-sha-e2e；无冲突；门禁自跑 exit 0。\n', 'utf8')
      return { ...h, executorSessionId }
    },
  }
}

function fakeGit(o: { parents?: number; ancestor?: boolean; pushOk?: boolean }): MergeGitPort & { pushes: string[]; pushOk: boolean } {
  const pushes: string[] = []
  const st = { pushOk: o.pushOk !== false }
  return {
    pushes,
    get pushOk(): boolean { return st.pushOk },
    set pushOk(v: boolean) { st.pushOk = v },
    revParseHead: async () => 'rev-e2e',
    branchTip: async (_repo: string, branch: string) => (branch === 'dev' ? 'm-sha-e2e' : undefined),
    isAncestor: async () => o.ancestor ?? true,
    tipParentCount: async () => o.parents ?? 2,
    push: async (repo: string, branch: string) => {
      pushes.push(`${repo}|${branch}`)
      return st.pushOk ? { ok: true, note: 'fake push ok' } : { ok: false, note: 'fake push denied（网络面）' }
    },
  }
}

function fakeGate(code: number) {
  return { run: async (_repoDir: string): Promise<{ code: number; note: string }> => ({ code, note: `合并跑门禁（引擎亲跑）：[1] bun run test exit=${code}` }) }
}

interface MergeStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  git: MergeGitPort & { pushes: string[] }
  merges: Array<{ task: TaskBrief; executorSessionId: string }>
}

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/** 合并跑栈：=P1 验收位栈 + mergeRun 真机 deps（fake git/gate——引擎接线面全真） */
function buildStack(id: string, opts?: { gateCode?: number; withExecutorSid?: boolean; idPrefix?: string; rescanEvery?: number }): MergeStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString(), ...(opts?.idPrefix !== undefined ? { idPrefix: opts.idPrefix } : {}) })
  const registry = createRegistry()
  const merges: Array<{ task: TaskBrief; executorSessionId: string }> = []
  registry.register(createMergeCapableAdapter({ withExecutorSid: opts?.withExecutorSid, onMerge: (task, executorSessionId) => merges.push({ task, executorSessionId }) }), { default: true })
  const git = fakeGit({})
  const mergeRun: MergeRunDeps = { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git, gate: fakeGate(opts?.gateCode ?? 0) }
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（合并相位）', 'docs/51（类型流声明）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      aiwsRoot,
      defaultPersonId: 'ENG-1',
      deptFallback: DEPT,
      defaultLane: 'core',
      actor: 'PLN-9',
      flows: devTaskFlows(),
      // 合并租约顺延面（S7）：顺延单的活动已消费（批准评论在派发尝试拍已吃）——重进
      // 候选走镜像 rescan 兜底（DEV-42① starvation-revival 同款；缺省 30 拍对测试太疏）
      ...(opts?.rescanEvery !== undefined ? { mirrorRescanEveryTicks: opts.rescanEvery } : {}),
    },
    people: ROSTER,
    makeId: deterministicIds(),
    directives: DIRECTIVE_DEPS,
    mergeRun,
  })
  return { platform, ledger, engine, clock, git, merges }
}

async function comment(stack: MergeStack, ticket: string, author: string, body: string): Promise<string> {
  await stack.platform.comments.add(ticket, { author, body, signature: `[test·${author}·demo]` })
  const list = await stack.platform.comments.list(ticket)
  const last = list[list.length - 1]
  if (last === undefined) throw new Error('评论未落平台')
  return last.id
}

/** 播种到待验收（与 P1 acceptance.e2e 同链：dispatch→GATE_PASS→QA_PASS→呈批→驻留）；异人异道面（202-P4 S6 双单同栈） */
async function seedToAcceptance(stack: MergeStack, opts?: { assignee?: string; lane?: string }): Promise<string> {
  const created = await stack.platform.issues.create({
    title: '合并跑单',
    type: 'devtask',
    dept: DEPT,
    level: 1,
    assignee: opts?.assignee ?? 'ENG-1',
    initialState: '新单',
  })
  if (opts?.lane !== undefined) await stack.platform.issues.setField(created.id, 'lane', opts.lane) // fake create 不收 lane——字段面补设
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.dispatch.dispatched).toBe(1) // 誓 1：fake-mg-1（launch 带 executorSessionId）
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.harvest.completed).toBe(1) // GATE_PASS：证据就绪（summary_ref 落账）
  stack.clock.advance(1000)
  await stack.engine.tick() // QA_PASS：复验通过
  stack.clock.advance(1000)
  await stack.engine.tick() // 5a 呈批：→待验收
  stack.clock.advance(1000)
  await stack.engine.tick() // 5b 驻留
  expect((await stack.platform.issues.get(created.id)).state).toBe('待验收')
  return created.id
}

function notes(r: TickReport, event: string): string[] {
  return r.events.filter((e) => e.event === event).map((e) => e.note ?? '')
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-merge-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')
  const files = await readDirectoryFiles(companyDir)
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line} ${i.rule}`).join('；')}`)
  snapshot = mounted.snapshot
  aiwsRoot = path.join(path.dirname(companyDir), '.AIWS')
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  expect(aiwsTree.personDirs.length).toBeGreaterThan(0)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— S4：真单刀全链 —————————————————————————

describe('S4 真单刀全链（批准→派发合并跑→收割四要件→MERGE 真事件→已交付）', () => {
  it('待验收+批示:批准→同拍派发合并跑（留待验收）；次拍 GATE_PASS→MERGE（sha/续跑证据/代推）→已交付', async () => {
    const stack = buildStack('s4-green')
    try {
      const ticket = await seedToAcceptance(stack)
      const first = stack.ledger.listWorkRecords({ issue: ticket })[0]
      expect(first?.session_id).toBe('fake-mg-1')
      expect(first?.executor_session_id).toBe('fake-mg-1-exec') // 誓 1 收口带 dsh 侧会话 id（v13 列）
      await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r1 = await stack.engine.tick()
      expect(r1.errors).toEqual([])
      // 同拍=派发合并跑（非同拍迁移——与 P1 S2 模拟轨对照：迁移归收割收口面）
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
      const dn = notes(r1, 'DISPATCH')[0] ?? ''
      expect(dn).toContain('merge-run')
      expect(dn).toContain('resume=fake-mg-1-exec@fake-mg')
      expect(dn).toContain('合并跑唤起原会话')
      expect(r1.events.find((e) => e.event === 'DISPATCH')?.causation_id).toBe(first?.id)
      expect(stack.merges).toHaveLength(1)
      expect(stack.merges[0]?.executorSessionId).toBe('fake-mg-1-exec') // resumeWithSession 收到 dsh 侧会话 id
      // 合并任务书落盘+指令块（R5 dev/不强推/门禁冻结）
      const ws = path.dirname(stack.merges[0]?.task.briefPath ?? '')
      const brief = readFileSync(path.join(ws, MERGE_BRIEF_FILENAME), 'utf8')
      expect(brief).toContain('目标分支：dev')
      expect(brief).toContain('不得强推、不得重写历史')
      expect(brief).toContain('门禁命令 `bun run test`')
      // 次拍收割：四要件→GATE_PASS→代推→MERGE→已交付
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick()
      expect(r2.errors).toEqual([])
      expect(notes(r2, 'GATE_PASS')[0]).toContain('merge-run')
      const mergeNote = notes(r2, 'MERGE')[0] ?? ''
      expect(mergeNote).toContain('sha=m-sha-e2e')
      expect(mergeNote).toContain('resume=fake-mg-1-exec@fake-mg')
      expect(mergeNote).toContain('push=ok')
      expect((await stack.platform.issues.get(ticket)).state).toBe('已交付')
      expect(stack.git.pushes).toHaveLength(1)
      expect(stack.git.pushes[0]).toContain('|dev')
      // 工时单：attempt 续号+done+回执 report_ref+executor_session_id 收口
      const recs = stack.ledger.listWorkRecords({ issue: ticket })
      expect(recs.map((x) => x.attempt)).toEqual([1, 2])
      expect(recs[1]?.status).toBe('done')
      expect(recs[1]?.report_ref).toContain(MERGE_RECEIPT_FILENAME)
      expect(recs[1]?.executor_session_id).toBe('fake-mg-1-exec')
      // 预算结算（誓 1+合并誓 各一——不留悬空预留）；无断路事件（位别接线：不计连击）
      expect(stack.ledger.listBudgets({ kinds: ['settle'] }).filter((x) => x.scope_id === ticket).length).toBe(2)
      expect(stack.ledger.queryEvents().some((e) => e.event === 'CIRCUIT_BREAK')).toBe(false)
    } finally {
      stack.ledger.close()
    }
  })

  it('push 失败不阻迁移（P4 缝——note 如实入 MERGE）', async () => {
    const stack = buildStack('s4-pushfail')
    try {
      const ticket = await seedToAcceptance(stack)
      stack.git.pushOk = false
      await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      await stack.engine.tick() // 派发合并跑
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick()
      expect(r2.errors).toEqual([])
      const mergeNote = notes(r2, 'MERGE')[0] ?? ''
      expect(mergeNote).toContain('push=fail')
      expect(mergeNote).toContain('P4 重试面')
      expect((await stack.platform.issues.get(ticket)).state).toBe('已交付') // 迁移照走
    } finally {
      stack.ledger.close()
    }
  })
})

// ————————————————————————— S5：降级手工链 —————————————————————————

describe('S5 降级手工链（断点缺 executor_session_id——重启打断合并跑同此面）', () => {
  it('批准→ESCALATE chain=manual（每单一次）+留待验收+无合并跑派发；次拍不重复报', async () => {
    const stack = buildStack('s5-degrade', { withExecutorSid: false }) // 誓 1 无 executor_session_id
    try {
      const ticket = await seedToAcceptance(stack)
      await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r1 = await stack.engine.tick()
      expect(r1.errors).toEqual([])
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
      const esc = notes(r1, 'ESCALATE')
      expect(esc).toHaveLength(1)
      expect(esc[0]).toContain('chain=manual')
      expect(esc[0]).toContain('executor_session_id')
      expect(notes(r1, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(0)
      expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(1)
      // 次拍：每拍重查但锚不重复（manualChainNoted dedupe）
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick()
      expect(r2.errors).toEqual([])
      expect(notes(r2, 'ESCALATE')).toHaveLength(0)
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
    } finally {
      stack.ledger.close()
    }
  })
})

// ————————————————————————— S6：闸门红收口 —————————————————————————

describe('S6 闸门红收口（四要件缺→冲突兜底：GATE_FAIL 三锚+ESCALATE+清站立；无断路；不自动重试）', () => {
  it('门禁 exit 1→GATE_FAIL（merge-run+merge=manual+category=MERGE_CONFLICT）+ESCALATE→留待验收→工时单 failed→无新批示零重派→再批准（R6）→模拟迁移收口', async () => {
    const stack = buildStack('s6-gatered', { gateCode: 1 })
    try {
      const ticket = await seedToAcceptance(stack)
      await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r1 = await stack.engine.tick() // 派发合并跑
      expect(notes(r1, 'DISPATCH')[0]).toContain('merge-run')
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick() // 收割：门禁红=四要件不齐（冲突兜底面）
      expect(r2.errors).toEqual([])
      const gf = notes(r2, 'GATE_FAIL')
      expect(gf).toHaveLength(1)
      expect(gf[0]).toContain('merge-run')
      expect(gf[0]).toContain('merge=manual')
      expect(gf[0]).toContain('category=MERGE_CONFLICT') // 202-P3 冲突分类锚
      expect(gf[0]).toContain('闸门exit0')
      const esc2 = notes(r2, 'ESCALATE')
      expect(esc2).toHaveLength(1) // 202-P3 ESCALATE 通知宰相（低噪不广播——事件流可观测）
      expect(esc2[0]).toContain('MERGE_CONFLICT')
      expect(esc2[0]).toContain('R6')
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收') // 无回滚无平台迁移
      const recs = stack.ledger.listWorkRecords({ issue: ticket })
      expect(recs[1]?.status).toBe('failed')
      expect(stack.ledger.queryEvents().some((e) => e.event === 'CIRCUIT_BREAK')).toBe(false) // 不计连击
      expect(stack.ledger.listBudgets({ kinds: ['settle'] }).filter((x) => x.scope_id === ticket).length).toBe(2) // 誓 1+合并誓（失败面也结算）
      // 不自动重试（判负线：冲突单自动重试=判负）：无新批示→站立已清→WAIT_APPROVAL 零重派
      stack.clock.advance(1000)
      const r2b = await stack.engine.tick()
      expect(r2b.errors).toEqual([])
      expect(notes(r2b, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(0)
      expect(notes(r2b, 'ESCALATE')).toHaveLength(0)
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
      // 再批准（dispatcher=R6 腿）：手工链收口——v0 模拟迁移转正（202-P3，note 如实不冒充真单刀）
      await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r3 = await stack.engine.tick()
      expect(r3.errors).toEqual([])
      expect(notes(r3, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(0) // 合并跑总数恒 1
      expect(notes(r3, 'ESCALATE')).toHaveLength(0)
      const mg = notes(r3, 'MERGE')
      expect(mg).toHaveLength(1)
      expect(mg[0]).toContain('手工链收口')
      expect(mg[0]).toContain('无真 git 合并')
      expect(mg[0]).toContain('merge=manual')
      expect(mg[0]).not.toContain('真单刀') // 判负线：迁移 note 冒充真合并=判负
      expect(mg[0]).not.toMatch(/sha=/)
      expect((await stack.platform.issues.get(ticket)).state).toBe('已交付')
      stack.clock.advance(1000)
      const r4 = await stack.engine.tick() // 收口幂等：已交付→回收轨，无第二次 MERGE
      expect(r4.errors).toEqual([])
      expect(notes(r4, 'MERGE')).toHaveLength(0)
      expect(notes(r4, 'ESCALATE')).toHaveLength(0)
    } finally {
      stack.ledger.close()
    }
  })
})

// ————————————————————————— S7：合并租约（202-P4 并发串行） —————————————————————————

describe('S7 合并租约（单栈双单同拍批准——一进一顺延；合并队列栏；rescan 补派；串行收口）', () => {
  it('双单同拍过验收→A 派发 B 顺延（merge-lease-busy 不失败）→queue 栏投影→A 收口释放→B 补派→两单先后已交付（push 1+1 串行）', async () => {
    // rescanEvery=5：B 顺延后批准活动已被游标消费——重进候选走镜像 rescan 兜底（seq 15，
    // A 于 seq 12 收口关单不再重进；DEV-42① starvation-revival 机制复用，缺省 30 拍太疏）
    const stack = buildStack('s7-lease', { rescanEvery: 5 })
    try {
      const a = await seedToAcceptance(stack, { assignee: 'ENG-1', lane: 'core' })
      const b = await seedToAcceptance(stack, { assignee: 'ENG-2', lane: 'aux' }) // 异人异道：人闸/泳道互不涉——只争合并租约
      expect(a).not.toBe(b)
      await comment(stack, a, 'pln-9', '批示:批准')
      await comment(stack, b, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      // —— 同拍双 merge 动作：A（先入队）占租约派发；B=merge-lease-busy 顺延（不弃单不报错） ——
      const r1 = await stack.engine.tick()
      expect(r1.errors).toEqual([])
      expect(notes(r1, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(1) // 一进
      expect(r1.actionResults.filter((x) => x.ok && (x.detail ?? '').includes('merge-lease-busy'))).toHaveLength(1) // 一顺延
      expect((await stack.platform.issues.get(b)).state).toBe('待验收') // 等待者不失败（判负线反面）
      expect(stack.merges).toHaveLength(1) // 只唤起 A 的原会话
      expect(stack.merges[0]?.task.ticket).toBe(a)
      // —— 合并队列栏（tick report 只读投影）：等待=[B] 在跑=[A] 租约持有=A ——
      expect(r1.phases.merge.queue).toEqual({ waiting: [b], running: [a], lease: { key: `${snapshot.slug}:dev`, holder: a, expiresAt: expect.any(Number), expired: false } })
      // —— A 收口（收割相释放租约）→ B 经 rescan 重进候选补派（4 拍内必进） ——
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick()
      expect(r2.errors).toEqual([])
      expect(notes(r2, 'MERGE')).toHaveLength(1)
      expect((await stack.platform.issues.get(a)).state).toBe('已交付')
      let bTick = -1
      let bDispatched = false
      for (let i = 0; i < 4 && !bDispatched; i += 1) {
        stack.clock.advance(1000)
        const rb = await stack.engine.tick()
        expect(rb.errors).toEqual([])
        bDispatched = notes(rb, 'DISPATCH').some((n) => n.includes('merge-run'))
        if (bDispatched) {
          bTick = i
          // B 派发拍队列栏：在跑=[B]（A 已收口释放——等待清空）
          expect(rb.phases.merge.queue.running).toEqual([b])
          expect(rb.phases.merge.queue.lease).toMatchObject({ holder: b, expired: false })
        } else {
          expect(rb.phases.merge.queue.waiting).toEqual([]) // 未重进候选=无新顺延（rescan 节流拍如实空投影）
        }
      }
      expect(bDispatched).toBe(true) // B 补派必达（rescan 兜底——顺延不弃单的可观测兑现）
      expect(bTick).toBeLessThanOrEqual(3)
      expect(stack.merges).toHaveLength(2) // A、B 各唤起一次（原会话各归各）
      stack.clock.advance(1000)
      const r3 = await stack.engine.tick()
      expect(r3.errors).toEqual([])
      expect(notes(r3, 'MERGE')).toHaveLength(1)
      expect((await stack.platform.issues.get(b)).state).toBe('已交付')
      // —— 串行铁证：dev 恰两次推送（A 先 B 后——同一 fake git 端口顺序记录），无第三列 ——
      expect(stack.git.pushes).toHaveLength(2)
      expect(stack.git.pushes.every((p) => p.endsWith('|dev'))).toBe(true)
      expect(r3.phases.merge.queue).toEqual({ waiting: [], running: [], lease: { key: `${snapshot.slug}:dev`, holder: null, expired: false } }) // 收口后全空（账实相符）
    } finally {
      stack.ledger.close()
    }
  })
})
