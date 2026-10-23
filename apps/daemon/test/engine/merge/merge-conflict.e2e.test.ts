/**
 * merge-conflict e2e —— 冲突兜底与手工链收口（202-P3，studio-dev-233，proposal §5.5/§7 S5；
 * docs/17-§2 合并相位冲突兜底注记、docs/17-§6 收割四要件）。
 *
 * 断言面（判负线照 brief 冻结口径，逐字）：
 *   - S5 主链·双单冲突：两单（T:devtask post-verified 位）先后批准合并——首单真单刀收口；
 *     门禁翻红建模**双单冲突**（首单先落 dev 后，第二单的合并面不再干净＝收割四要件不齐）
 *     → 第二单：GATE_FAIL（merge-run+merge=manual+category=MERGE_CONFLICT 三锚）
 *     +ESCALATE 通知宰相（低噪不广播）+批准站立清+单留待验收（无回滚无平台迁移）
 *     +工时单 failed+断路零连击+预算双结算。
 *   - 判负线①（冲突单自动重试=判负）：冲突后连拍零重派——合并跑台账总数恒 1、工时单
 *     恒 2 条、无新 ESCALATE、状态钉待验收。
 *   - 手工链完成后批示:批准（R6 **宰相腿**＝组织锚白名单 prime-0）→ decide 再出 mergeTo
 *     → v0 模拟迁移转正收口：MERGE ×1（note 如实＝宰相手工链收口/无真 git 合并）＋已交付
 *     ＋不二跑（无合并跑派发）。
 *   - 判负线②（手工链迁移 note 冒充真合并=判负）：收口 note 不含「真单刀」、不匹配 sha=。
 *   - 收口幂等：次拍回收轨，无第二次 MERGE。
 *
 * 载体铁律（C3）：daemon 仍是唯一状态推进者；git 面由宰相手工链亲跑（引擎外）——
 * 收口只做平台迁移+MERGE 事件（note 如实声明无真 git 合并）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
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
import { MERGE_RECEIPT_FILENAME } from '../../../src/engine/merge/merge-brief.ts'

const T0 = Date.parse('2026-10-24T00:00:00.000Z')

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'merge-conflict-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'merge-conflict-e2e@studio-next.invalid',
}

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

const DEPT = 'departments/工程部'

function person(id: string, login: string, level: number, dept = DEPT): PersonRef {
  return { id, name: id, login, level, dept }
}

/** 名册含 R6 宰相腿：PRIME-0（组织锚白名单）——手工链完成后的批示资格面 */
const ROSTER: readonly PersonRef[] = [
  person('ENG-1', 'eng-1', 1),
  person('ENG-0', 'eng-0', 3),
  person('PLN-9', 'pln-9', 1),
  person('producer', 'boss', 9),
  person('PRIME-0', 'prime-0', 3),
]

const DIRECTIVE_DEPS = {
  departments: new Map([[DEPT, 'ENG-0']]),
  extraWhitelist: ['PRIME-0'],
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
function createMergeCapableAdapter() {
  const base = createFakeAdapter({ name: 'fake-mg' })
  return {
    ...base,
    capabilities: { ...base.capabilities, session_resume: true },
    async launch(task: TaskBrief): Promise<Handle> {
      const h = await base.launch(task)
      return { ...h, executorSessionId: `${h.sessionId}-exec` }
    },
    async resumeWithSession(task: TaskBrief, executorSessionId: string): Promise<Handle> {
      const h = await base.launch(task)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path.join(task.workspace, MERGE_RECEIPT_FILENAME), '# 合并回执\n\nmerge commit m-sha-e2e；无冲突；门禁自跑 exit 0。\n', 'utf8')
      return { ...h, executorSessionId }
    },
  }
}

function fakeGit(): MergeGitPort & { pushes: string[] } {
  const pushes: string[] = []
  return {
    pushes,
    revParseHead: async () => 'rev-e2e',
    branchTip: async (_repo: string, branch: string) => (branch === 'dev' ? 'm-sha-e2e' : undefined),
    isAncestor: async () => true,
    tipParentCount: async () => 2,
    push: async (repo: string, branch: string) => {
      pushes.push(`${repo}|${branch}`)
      return { ok: true, note: 'fake push ok' }
    },
  }
}

interface ConflictStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  git: MergeGitPort & { pushes: string[] }
  /** 可翻门禁（双单冲突建模：首单收口后翻红＝第二单合并面不净——收割四要件不齐面） */
  gate: { code: number }
}

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/** 冲突栈：=P1 验收位栈 + mergeRun 真机 deps（fake git；gate 可翻红——引擎接线面全真） */
function buildStack(id: string): ConflictStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createMergeCapableAdapter(), { default: true })
  const git = fakeGit()
  const gate = { code: 0 }
  const mergeRun: MergeRunDeps = { targetBranch: 'dev', gateCommand: ['bun', 'run', 'test'], git, gate: { run: async (_repoDir: string) => ({ code: gate.code, note: `合并跑门禁（引擎亲跑）：[1] bun run test exit=${gate.code}` }) } }
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
    },
    people: ROSTER,
    makeId: deterministicIds(),
    directives: DIRECTIVE_DEPS,
    mergeRun,
  })
  return { platform, ledger, engine, clock, git, gate }
}

async function comment(stack: ConflictStack, ticket: string, author: string, body: string): Promise<void> {
  await stack.platform.comments.add(ticket, { author, body, signature: `[test·${author}·demo]` })
}

/** 播种到待验收（与 P2 merge-run.e2e 同链：dispatch→GATE_PASS→QA_PASS→呈批→驻留） */
async function seedToAcceptance(stack: ConflictStack): Promise<string> {
  const created = await stack.platform.issues.create({
    title: '冲突兜底单',
    type: 'devtask',
    dept: DEPT,
    level: 1,
    assignee: 'ENG-1',
    initialState: '新单',
  })
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.dispatch.dispatched).toBe(1) // 誓 1
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.harvest.completed).toBe(1) // GATE_PASS：证据就绪
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
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-merge-conflict-'))
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

// ————————————————————————— S5：双单冲突——冲突兜底与手工链收口 —————————————————————————

describe('S5 双单冲突（第二单合并跑不齐→MERGE_CONFLICT 兜底→宰相批示→模拟迁移收口）', () => {
  it('首单真单刀收口→门禁翻红＝第二单四要件不齐→冲突四件套+不自动重试；宰相（R6 白名单腿）批示后收口 note 如实', async () => {
    const stack = buildStack('p3-conflict')
    try {
      // —— 首单 A：真单刀全链（同泳道串行——A 不回收 B 不得入道；同拍争租约的序问题不在本面） ——
      const a = await seedToAcceptance(stack)
      await comment(stack, a, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r1 = await stack.engine.tick()
      expect(r1.errors).toEqual([])
      expect(notes(r1, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(1) // A 派合并跑
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick() // A 收割：四要件齐→真单刀收口
      expect(r2.errors).toEqual([])
      const r2merge = notes(r2, 'MERGE')
      expect(r2merge).toHaveLength(1)
      expect(r2merge[0]).toContain('sha=m-sha-e2e')
      expect((await stack.platform.issues.get(a)).state).toBe('已交付')
      stack.clock.advance(1000)
      await stack.engine.tick() // A 回收：泳道释放（CLOSE）——第二单方可继任入道
      expect(stack.ledger.queryEvents().some((e) => e.issue === a && e.event === 'CLOSE')).toBe(true)
      // —— 第二单 B：同枝继任，先批准合并 ——
      const b = await seedToAcceptance(stack)
      await comment(stack, b, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r3 = await stack.engine.tick() // B 派合并跑（A 租约已释——真单刀径）
      expect(r3.errors).toEqual([])
      expect(notes(r3, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(1)
      expect((await stack.platform.issues.get(b)).state).toBe('待验收') // 派发拍不迁移
      // —— 双单冲突建模：A 先落 dev 后，B 的合并面不再干净——门禁翻红＝B 收割四要件不齐 ——
      stack.gate.code = 1
      stack.clock.advance(1000)
      const rconf = await stack.engine.tick() // B 收割：冲突兜底面
      expect(rconf.errors).toEqual([])
      const gf = notes(rconf, 'GATE_FAIL')
      expect(gf).toHaveLength(1)
      expect(gf[0]).toContain('merge-run')
      expect(gf[0]).toContain('merge=manual') // 单标记（事件锚派生幂等可回放——P2 面）
      expect(gf[0]).toContain('category=MERGE_CONFLICT') // MERGE_CONFLICT 既有类（note 锚——事件名零新增）
      expect(gf[0]).toContain('闸门exit0') // 四要件缺的是闸门（终态/非空/回执均绿）
      const esc = notes(rconf, 'ESCALATE')
      expect(esc).toHaveLength(1) // ESCALATE 通知宰相（低噪不广播——事件流可观测）
      expect(esc[0]).toContain('MERGE_CONFLICT')
      expect(esc[0]).toContain('R6')
      expect((await stack.platform.issues.get(b)).state).toBe('待验收') // 留待验收：无回滚无平台迁移
      expect(stack.ledger.listWorkRecords({ issue: b }).map((x) => x.status)).toEqual(['done', 'failed'])
      expect(stack.ledger.queryEvents().some((e) => e.event === 'CIRCUIT_BREAK')).toBe(false) // 位别接线：不计连击
      expect(stack.ledger.listBudgets({ kinds: ['settle'] }).filter((x) => x.scope_id === b).length).toBe(2) // 誓 1+合并誓（失败面也结算）
      // —— 判负线①：冲突单自动重试=判负 —— 连拍零重派（站立已清→WAIT_APPROVAL；manual 锚挡触发五查）
      for (let i = 0; i < 2; i += 1) {
        stack.clock.advance(1000)
        const rx = await stack.engine.tick()
        expect(rx.errors).toEqual([])
        expect(notes(rx, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(0)
        expect(notes(rx, 'ESCALATE')).toHaveLength(0)
        expect((await stack.platform.issues.get(b)).state).toBe('待验收')
      }
      expect(stack.ledger.queryEvents().filter((e) => e.issue === b && e.event === 'DISPATCH' && (e.note ?? '').includes('merge-run'))).toHaveLength(1) // 合并跑总数恒 1
      expect(stack.ledger.listWorkRecords({ issue: b })).toHaveLength(2) // 无第三誓（不自动重试的台账级钉子）
      // —— 手工链完成（git 面由宰相亲跑——引擎外）＋批示:批准（R6 宰相腿＝组织锚白名单） ——
      await comment(stack, b, 'prime-0', '批示:批准')
      stack.clock.advance(1000)
      const rclose = await stack.engine.tick()
      expect(rclose.errors).toEqual([])
      expect(notes(rclose, 'DISPATCH').filter((n) => n.includes('merge-run'))).toHaveLength(0) // 不二跑
      expect(notes(rclose, 'ESCALATE')).toHaveLength(0)
      const mg = notes(rclose, 'MERGE')
      expect(mg).toHaveLength(1) // v0 模拟迁移转正收口
      expect(mg[0]).toContain('手工链收口') // note 如实＝宰相手工链收口
      expect(mg[0]).toContain('无真 git 合并')
      expect(mg[0]).toContain('merge=manual')
      expect(mg[0]).not.toContain('真单刀') // 判负线②：手工链迁移 note 冒充真合并=判负
      expect(mg[0]).not.toMatch(/sha=/)
      expect((await stack.platform.issues.get(b)).state).toBe('已交付')
      expect(stack.ledger.listWorkRecords({ issue: b })).toHaveLength(2) // 收口不派工——无新工时单
      // —— 收口幂等：次拍回收轨（CLOSE 归档），无第二次 MERGE；B 合并跑台账总数仍 1 ——
      stack.clock.advance(1000)
      const ridle = await stack.engine.tick()
      expect(ridle.errors).toEqual([])
      expect(notes(ridle, 'MERGE')).toHaveLength(0)
      expect(notes(ridle, 'ESCALATE')).toHaveLength(0)
      expect(stack.ledger.queryEvents().filter((e) => e.issue === b && e.event === 'DISPATCH' && (e.note ?? '').includes('merge-run'))).toHaveLength(1)
      expect(stack.git.pushes).toHaveLength(1) // 只有 A 的代推（B 冲突面+收口面均不推——git 面归宰相）
    } finally {
      stack.ledger.close()
    }
  })
})
