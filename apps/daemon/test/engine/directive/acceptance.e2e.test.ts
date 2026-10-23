/**
 * acceptance e2e —— 策划验收位（202-P1，studio-dev-231；proposal studio-dev-202 §7 S2/S3）。
 *
 * 断言面（判负线照提案 §7 冻结口径，逐字）：
 *   - S2 验收位资格与站立：T:devtask 单 QA_PASS 后落待验收 WAIT_APPROVAL；dispatcher
 *     批示：批准→站立（APPROVE verb=批准）且同拍合并已交付（R3——验收位批准不查派单律，
 *     同级策划可验收自己的派单成果）；非白名单 actor 批示→ESCALATE 且状态不动
 *     （伪造批示不得推进状态——判负线）。
 *   - S3 验收打回重做链：待验收＋批示:打回（理由）→过渡已派发（声明回退边命中）＋
 *     回新单重做位＋resume 派发 causation 链末位工时单＋attempt 不重置＋前情摘要含
 *     打回理由｜判负：打回后新开 attempt／理由丢失／开新会话（非 resume）。
 *
 * 载体铁律（C3）：批示=网关 comment 信号；daemon 仍是唯一状态推进者（一切状态推进
 * 断言均经 engine tick 驱动）。decide 决策码零增（S2 用既有 WAIT_APPROVAL/MERGE 面）。
 * 单元面（dispatcher 源+R3 律）见同目录 parse-qualify.test.ts；呈批位既有面见
 * directive.e2e.test.ts。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, PersonRef, TicketWorkflows } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'acceptance-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'acceptance-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-22T00:00:00.000Z')

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

const DEPT = 'departments/工程部'

function person(id: string, login: string, level: number, dept = DEPT): PersonRef {
  return { id, name: id, login, level, dept }
}

/**
 * 名册：ENG-1=被派 worker（level 1）；PLN-9=派单策划（level 1——与被派同级：
 * R3 判据位；不在 leader/组织锚/制作人三源——dispatcher 源是唯一放行源）；
 * ENG-0=部长（leader 源对照组）。
 */
const ROSTER: readonly PersonRef[] = [
  person('ENG-1', 'eng-1', 1),
  person('ENG-0', 'eng-0', 3),
  person('PLN-9', 'pln-9', 1),
  person('producer', 'boss', 9),
]

const DIRECTIVE_DEPS = {
  departments: new Map([[DEPT, 'ENG-0']]),
  extraWhitelist: [],
  producer: 'producer',
}

/**
 * T:devtask 类型流（202-§5.1 声明形——与模板 org-config.yaml 样例段同构）：
 * 五锚+验收位 approval=待验收（居复验锚后=W-8 第二合法槽）；声明回退边 待验收→已派发。
 */
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

/** 可续 fake（session_resume=true——F1-15 能力位；session fake-rs-1/2 命名空间） */
function createResumableFakeAdapter() {
  const base = createFakeAdapter({ name: 'fake-rs' })
  return { ...base, capabilities: { ...base.capabilities, session_resume: true } }
}

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/**
 * 验收位栈：T:devtask 流表+可续 fake+批示归一层注入+actor=PLN-9（镜像 dispatcher 列
 * 落策划工号——生产为 'daemon' 非人员名=本源 fail-closed；测试以策划代派模拟部署面）。
 */
function buildStack(id: string): TestStack {
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
  registry.register(createResumableFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/18-§2.5（批示载体）', 'docs/51（类型流声明）'],
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
      actor: 'PLN-9', // 派单策划=本单 dispatcher（镜像列 F2-07——dispatcherOf 源）
      flows: devTaskFlows(),
    },
    people: ROSTER,
    makeId: deterministicIds(),
    directives: DIRECTIVE_DEPS,
  })
  return { platform, ledger, engine, clock }
}

async function comment(stack: TestStack, ticket: string, author: string, body: string): Promise<string> {
  await stack.platform.comments.add(ticket, { author, body, signature: `[test·${author}·demo]` })
  const list = await stack.platform.comments.list(ticket)
  const last = list[list.length - 1]
  if (last === undefined) throw new Error('评论未落平台')
  return last.id
}

/** 播种到待验收：dispatch→GATE_PASS（工时单落 session+summary_ref）→QA_PASS→呈批 */
async function seedToAcceptance(stack: TestStack): Promise<string> {
  const created = await stack.platform.issues.create({
    title: '策划验收单',
    type: 'devtask',
    dept: DEPT,
    level: 1,
    assignee: 'ENG-1',
    initialState: '新单',
  })
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.dispatch.dispatched).toBe(1) // 新单→已派发（誓 1：fake-rs-1）
  stack.clock.advance(1000)
  expect((await stack.engine.tick()).phases.harvest.completed).toBe(1) // GATE_PASS：证据就绪
  stack.clock.advance(1000)
  await stack.engine.tick() // QA_PASS：复验通过
  stack.clock.advance(1000)
  await stack.engine.tick() // 5a 呈批：→待验收
  stack.clock.advance(1000)
  const r = await stack.engine.tick() // 5b 驻留：WAIT_APPROVAL
  expect((await stack.platform.issues.get(created.id)).state).toBe('待验收')
  expect(r.phases.stateDiff.decisions.some((d) => d.ticket === created.id && d.code === 'WAIT_APPROVAL')).toBe(true)
  return created.id
}

function notes(r: TickReport, event: string): string[] {
  return r.events.filter((e) => e.event === event).map((e) => e.note ?? '')
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-acceptance-'))
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

// ————————————————————————— S2：验收位资格与站立 —————————————————————————

describe('S2 验收位资格与站立（202-§7：dispatcher 批示合法；非白名单拒且状态不动）', () => {
  it('QA_PASS 后落待验收 WAIT_APPROVAL（类型流声明面——decide 决策码零增）', async () => {
    const stack = buildStack('s2-wait')
    try {
      const ticket = await seedToAcceptance(stack)
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
    } finally {
      stack.ledger.close()
    }
  })

  it('dispatcher（策划，与被派同级）批示:批准→APPROVE 站立+同拍合并已交付（R3：验收位批准不查派单律）', async () => {
    const stack = buildStack('s2-approve')
    try {
      const ticket = await seedToAcceptance(stack)
      const cid = await comment(stack, ticket, 'pln-9', '批示:批准')
      stack.clock.advance(1000)
      const r = await stack.engine.tick()
      expect(r.errors).toEqual([])
      expect(notes(r, 'APPROVE')).toEqual([`DIRECTIVE;verb=批准;actor=pln-9;directive=${cid}`])
      expect((await stack.platform.issues.get(ticket)).state).toBe('已交付') // 同拍 merge（approved 站立→5b）
      // 对照：呈批位同 actor 同级（1≤1）违律——R3 只免验收位（单测面已覆盖，此处引擎面闭环）
    } finally {
      stack.ledger.close()
    }
  })

  it('非白名单 actor（被派 worker 本人）批示:批准→忽略+ESCALATE（not-whitelisted），状态留待验收', async () => {
    const stack = buildStack('s2-forged')
    try {
      const ticket = await seedToAcceptance(stack)
      const cid = await comment(stack, ticket, 'eng-1', '批示:批准')
      stack.clock.advance(1000)
      const r = await stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'APPROVE')).toHaveLength(0)
      expect(notes(r, 'ESCALATE')).toEqual([
        `DIRECTIVE_REJECTED;why=not-whitelisted;verb=批准;actor=eng-1;directive=${cid}`,
      ])
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收') // 状态不动（判负线）
    } finally {
      stack.ledger.close()
    }
  })
})

// ————————————————————————— S3：验收打回重做链 —————————————————————————

describe('S3 验收打回重做链（202-§7：过渡已派发+resume 派发+attempt 续号+前情含理由）', () => {
  it('待验收+批示:打回（理由）→声明回退边命中已派发→回新单→同拍 resume 重派（causation 链/attempt 续号/前情含理由）', async () => {
    const stack = buildStack('s3-reject')
    try {
      const ticket = await seedToAcceptance(stack)
      const first = stack.ledger.listWorkRecords({ issue: ticket })[0]
      expect(first?.session_id).toBe('fake-rs-1') // 誓 1 断点（GATE_PASS 落账）
      expect(first?.summary_ref).toBeDefined()

      const reason = '验收不通过：边界用例未覆盖，证据链断在复验'
      const cid = await comment(stack, ticket, 'pln-9', `批示:打回 ${reason}`)
      stack.clock.advance(1000)
      const r = await stack.engine.tick()
      expect(r.errors).toEqual([])

      // ①过渡已派发（声明回退边命中）+回新单重做位——APPROVE note 全链（理由不丢）
      const approve = notes(r, 'APPROVE').find((n) => n.includes('verb=打回'))
      expect(approve).toBe(
        `DIRECTIVE;verb=打回;actor=pln-9;directive=${cid};reason=${reason}` +
          `;target=已派发（声明回退边）→新单（重做回派发位）;resume=意图已物化（cause=策划验收打回）`,
      )

      // ②同拍 resume 重派：本拍恰一次 DISPATCH（首誓在播种拍）——note 锚（续自第 1 誓
      // ——非新会话首派形）+意图源归因 directive
      const dispatches = r.events.filter((e) => e.event === 'DISPATCH' && e.issue === ticket)
      expect(dispatches).toHaveLength(1)
      const note = dispatches[0]?.note ?? ''
      expect(note).toContain('resume=fake-rs-1@fake-rs（续自第 1 誓）')
      expect(note).toContain(`intent=directive|resume|${snapshot.slug}|${ticket}`)
      expect(dispatches[0]?.causation_id).toBe(first?.id) // 因果链=上次（末位）工时单

      // ③attempt 不重置（续号 1→2）+新誓新会话（同 executor 命名空间）
      const recs = stack.ledger.listWorkRecords({ issue: ticket })
      expect(recs.map((x) => x.attempt)).toEqual([1, 2])
      expect(recs[1]?.session_id).toBe('fake-rs-2')

      // ④前情摘要含打回理由（续跑版任务书——批示注入行）+末态已派发（在工重做）；
      // brief 路径取自 DISPATCH note 自描述锚（brief=…；工位=AIWS 人位工单目录）
      const briefPath = /brief=([^;]+)/.exec(note)?.[1]
      expect(briefPath).toBeDefined()
      const brief = readFileSync(briefPath as string, 'utf8')
      expect(brief).toContain('前情摘要')
      expect(brief).toContain('上次会话：`fake-rs-1`')
      expect(brief).toContain('第 2 次尝试 · 续跑')
      expect(brief).toContain(`本次续跑缘由（批示注入）：策划验收打回：${reason}`)
      expect((await stack.platform.issues.get(ticket)).state).toBe('已派发')
    } finally {
      stack.ledger.close()
    }
  })

  it('打回站立期不自动呈批（回弹抑制）且重做完成后再呈批不被旧打回压制（DISPATCH 清零站立）', async () => {
    const stack = buildStack('s3-standing')
    try {
      const ticket = await seedToAcceptance(stack)
      // 打回→重做（同拍 resume 重派，末态已派发）
      await comment(stack, ticket, 'pln-9', '批示:打回 首版证据不足')
      stack.clock.advance(1000)
      await stack.engine.tick()
      expect((await stack.platform.issues.get(ticket)).state).toBe('已派发')
      // 重做收割→QA_PASS→复验通过：DISPATCH 已清打回站立，5a 自动呈批恢复（不回弹抑制）
      stack.clock.advance(1000)
      expect((await stack.engine.tick()).phases.harvest.completed).toBe(1) // GATE_PASS（誓 2）
      stack.clock.advance(1000)
      await stack.engine.tick() // QA_PASS：复验通过
      stack.clock.advance(1000)
      await stack.engine.tick() // 5a 呈批：→待验收（旧打回站立已被誓 2 DISPATCH 清零）
      expect((await stack.platform.issues.get(ticket)).state).toBe('待验收')
    } finally {
      stack.ledger.close()
    }
  })
})
