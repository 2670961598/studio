/**
 * directive e2e —— 批示归一层引擎面（studio-dev-171，docs/18-§2.5 / 130-§8 spike S4·S5）。
 *
 * 断言面（判负线照 130-§8 冻结口径）：
 *   - S4 批示归一×防御：部长署名 批示:批准 → APPROVE（verb=批准）+ 同拍 DISPATCH；
 *     非部长同文 → 忽略+ESCALATE（DIRECTIVE_REJECTED;why=not-whitelisted）——伪造批示
 *     不得推进状态（判负线）；未知 actor/越级派单/畸形 同为忽略+ESCALATE 面。
 *   - S5 打回闭环：批示:打回+理由 → 声明边 待批→新单 + 理由落事件 note（判负线：
 *     状态不动或理由丢失）；边未声明 → 状态不动+ESCALATE（理由不丢）；打回站立期
 *     引擎不自动呈批（5a 回弹抑制——部长已说 no，机器不反弹）。
 *
 * 载体铁律（C3）：批示=网关 comment 信号，GATEWAY_ACTIONS 零增删；daemon 仍是唯一
 * 状态推进者（本测试一切状态推进断言均经 engine tick 驱动）。
 * 单元面见同目录 parse-qualify.test.ts；声明面（S1/S2/S3）见 flows.test.ts。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, DEFAULT_TYPE_EDGES, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, PersonRef, TicketWorkflows } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'directive-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'directive-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-22T00:00:00.000Z')

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

// ————————————————————————— 测试名册（资格校验面的合成 roster） —————————————————————————


const DEPT = 'departments/工程部'

function person(id: string, login: string, level: number, dept = DEPT): PersonRef {
  return { id, name: id, login, level, dept }
}

/** 名册（departments/工程部）：deps.directives 注入面消费——与 snapshot.people 独立 */
const ROSTER: readonly PersonRef[] = [
  person('ENG-1', 'eng-1', 1), // 被派单 worker（缺省 assignee）
  person('ENG-0', 'eng-0', 3), // 工程部部长（departments 表 leader 位）
  person('ENG-2', 'eng-2', 3), // 与部长同级（dispatch-law 负面：3≤3 非严格高）
  person('PLN-9', 'pln-9', 1), // 非白名单（伪造批示面）
  person('PRIME-0', 'prime-0', 5), // 组织锚白名单（extraWhitelist 按工号）
  person('BIG-9', 'big-9', 9), // 与制作人同级（制作人豁免面：9≤9）
  person('producer', 'boss', 9), // 制作人（§2.3 任意介入不受限——含派单律豁免）
]

const DIRECTIVE_DEPS = {
  departments: new Map([[DEPT, 'ENG-0']]),
  extraWhitelist: ['PRIME-0'],
  producer: 'producer',
}


// ————————————————————————— 引擎面（S4/S5） —————————————————————————

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  /** 覆盖流表（serve 同序：DEFAULT 铺底 + T 键覆盖顶） */
  flows?: FlowTable
}

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/** L1 流 + 打回声明边（S5 正位：待批→新单 声明在 typeEdges——130-§6.1.2 打回边形） */
function l1WithRejectEdge(): FlowTable {
  const l1 = DEFAULT_FLOW_TABLE.L1
  if (l1 === undefined) throw new Error('L1 流缺位')
  return { ...DEFAULT_FLOW_TABLE, L1: { ...l1, typeEdges: [...DEFAULT_TYPE_EDGES, { from: '待批', to: '新单' }] } }
}

/**
 * T:proposal 类型流（S1 阳性声明的引擎面等价物——130-§6.1.1 意图的 as-built 表达：
 * anchors.inbox=待批 使 typeInbox 派生直落待批；approval 锚同位待批=部长收件箱
 * 收口（5b 等批示）；新单=终态后成员态，经声明边 待批→新单 可达）。
 */
const PROPOSAL_WF: TicketWorkflows = {
  types: [
    {
      id: 'proposal',
      entity: 'userstory',
      states: [
        { name: '待批' },
        { name: '已派发' },
        { name: '证据就绪' },
        { name: '复验通过' },
        { name: '已交付', final: true },
        { name: '新单' },
      ],
      edges: [{ from: '待批', to: '新单' }],
      anchors: { inbox: '待批', approval: '待批', dispatched: '已派发', evidence: '证据就绪', verified: '复验通过', delivered: '已交付' },
    },
  ],
}

function proposalFlows(): FlowTable {
  const t = flowsFromWorkflows(PROPOSAL_WF)
  if (t === undefined) throw new Error('T:proposal 流合成失败')
  return { ...DEFAULT_FLOW_TABLE, ...t }
}

function makeAssembler() {
  return createDefaultAssembler({
    fwkVersion: 'v0.5-demo',
    frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
    snapshot,
    acceptance: ['echo demo-ok'],
    docRefs: ['docs/17-§2（主循环七相位）', 'docs/18-§2.5（批示载体）'],
  })
}

function buildStack(id: string, opts?: StackOptions): TestStack {
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
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: makeAssembler(),
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
      autoApprove: false, // 生产缺省（C5）：approved 正主通道=批示站立
      ...(opts?.flows !== undefined ? { flows: opts.flows } : {}),
    },
    people: ROSTER,
    makeId: deterministicIds(),
    // 归一层恒注入（serve 同构面）：部门表+组织锚+制作人三源
    directives: DIRECTIVE_DEPS,
  })
  return { platform, ledger, engine, clock }
}

interface Ticker {
  stack: TestStack
  /** L1 待批单（缺省 assignee=ENG-1 level 1——部长(3) 严格高，派单律正位） */
  makeL1Ticket(overrides?: { assignee?: string; level?: number; state?: string }): Promise<string>
  /** 落一条评论并回填其评论 id（消费键断言用） */
  comment(ticket: string, author: string, body: string): Promise<string>
}

function makeTicker(id: string, opts?: StackOptions): Ticker {
  const stack = buildStack(id, opts)
  return {
    stack,
    async makeL1Ticket(overrides) {
      const created = await stack.platform.issues.create({
        title: '批示归一验收单',
        type: 'task',
        dept: DEPT,
        level: overrides?.level ?? 1,
        assignee: overrides?.assignee ?? 'ENG-1',
        initialState: overrides?.state ?? '待批',
      })
      return created.id
    },
    async comment(ticket, author, body) {
      await stack.platform.comments.add(ticket, { author, body, signature: `[test·${author}·demo]` })
      const list = await stack.platform.comments.list(ticket)
      const last = list[list.length - 1]
      if (last === undefined) throw new Error('评论未落平台')
      return last.id
    },
  }
}

function notes(r: TickReport, event: string): string[] {
  return r.events.filter((e) => e.event === event).map((e) => e.note ?? '')
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-directive-'))
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

// ————————————————————————— S4：批示归一 × 伪造防御 —————————————————————————

describe('S4 批示归一×防御（130-§8 判负线：伪造批示不得推进状态）', () => {
  it('部长署名 批示:批准 → APPROVE(verb=批准)+同拍 DISPATCH，状态 待批→已派发', async () => {
    const t = makeTicker('s4-approve')
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'eng-0', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(notes(r, 'APPROVE')).toEqual([`DIRECTIVE;verb=批准;actor=eng-0;directive=${cid}`])
      expect(r.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('已派发')
      expect(r.phases.collect.directives).toEqual({ tickets: 1, consumed: 1, rejected: 0 })
    } finally {
      t.stack.ledger.close()
    }
  })

  it('非白名单同文批示 → 忽略+ESCALATE（not-whitelisted），不派发、状态留待批', async () => {
    const t = makeTicker('s4-forged')
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'pln-9', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'APPROVE')).toHaveLength(0)
      expect(r.actions.some((a) => a.type === 'dispatch')).toBe(false)
      expect(notes(r, 'ESCALATE')).toEqual([`DIRECTIVE_REJECTED;why=not-whitelisted;verb=批准;actor=pln-9;directive=${cid}`])
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      const decision = r.phases.stateDiff.decisions.find((d) => d.ticket === ticket)
      expect(decision?.code).toBe('WAIT_APPROVAL')
      expect(r.phases.collect.directives).toEqual({ tickets: 1, consumed: 1, rejected: 1 })
    } finally {
      t.stack.ledger.close()
    }
  })

  it('越级派单（批示人 3 ≤ 被派单人 3 非严格高）→ 拒+ESCALATE（dispatch-law）', async () => {
    const t = makeTicker('s4-skip-level')
    try {
      // 单据留 L1 流；被派单人=ENG-2（person level 3）与部长同级——严格高不满足
      const ticket = await t.makeL1Ticket({ assignee: 'ENG-2' })
      const cid = await t.comment(ticket, 'eng-0', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(notes(r, 'ESCALATE')).toEqual([`DIRECTIVE_REJECTED;why=dispatch-law;verb=批准;actor=eng-0;directive=${cid}`])
      expect(r.actions.some((a) => a.type === 'dispatch')).toBe(false)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('未知账号署名 → 拒+ESCALATE（unknown-actor，宁拒不错派）', async () => {
    const t = makeTicker('s4-ghost')
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'ghost', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(notes(r, 'ESCALATE')).toEqual([`DIRECTIVE_REJECTED;why=unknown-actor;verb=批准;actor=ghost;directive=${cid}`])
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('制作人豁免：被派单人同级 9≤9 仍放行（§2.3 任意介入不受限）', async () => {
    const t = makeTicker('s4-producer')
    try {
      // 单据留 L1 流；被派单人=BIG-9（person level 9）与制作人同级——豁免面
      const ticket = await t.makeL1Ticket({ assignee: 'BIG-9' })
      await t.comment(ticket, 'producer', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'ESCALATE')).toHaveLength(0)
      expect(r.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('已派发')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('组织锚白名单（PRIME-0，level 5 > 1）→ 放行派发', async () => {
    const t = makeTicker('s4-prime')
    try {
      const ticket = await t.makeL1Ticket()
      await t.comment(ticket, 'PRIME-0', '批示:批准')
      const r = await t.stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'ESCALATE')).toHaveLength(0)
      expect(r.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('已派发')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('畸形（全角冒号）→ ESCALATE DIRECTIVE_MALFORMED，状态不动', async () => {
    const t = makeTicker('s4-malformed')
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'eng-0', '批示：批准')
      const r = await t.stack.engine.tick()
      expect(notes(r, 'ESCALATE')).toEqual([`DIRECTIVE_MALFORMED;why=fullwidth-colon;actor=eng-0;directive=${cid}`])
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      expect(r.phases.collect.directives).toEqual({ tickets: 1, consumed: 1, rejected: 1 })
    } finally {
      t.stack.ledger.close()
    }
  })

  it('自由言论不消费不落事件（词表外评论零事件零归一）', async () => {
    const t = makeTicker('s4-freespeech')
    try {
      const ticket = await t.makeL1Ticket()
      await t.comment(ticket, 'eng-1', '进度正常，方案对齐中')
      const r = await t.stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'APPROVE' || e.event === 'ESCALATE')).toHaveLength(0)
      expect(r.phases.collect.directives).toEqual({ tickets: 1, consumed: 0, rejected: 0 })
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('幂等：已消费批示二拍不重放（拒/畸形同面）；approved 站立不重复', async () => {
    const t = makeTicker('s4-idempotent')
    try {
      const ticket = await t.makeL1Ticket()
      const forged = await t.comment(ticket, 'pln-9', '批示:批准')
      const r1 = await t.stack.engine.tick()
      expect(notes(r1, 'ESCALATE')).toHaveLength(1)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      // 二拍：新自由评论造活动重拉评论列表——旧批示（已拒）不得重放
      await t.comment(ticket, 'eng-1', '补充信息：范围收敛')
      t.stack.clock.advance(1000)
      const r2 = await t.stack.engine.tick()
      expect(r2.events.filter((e) => (e.note ?? '').includes(`directive=${forged}`))).toHaveLength(0)
      expect(r2.phases.collect.directives).toEqual({ tickets: 1, consumed: 0, rejected: 0 })
      // 三拍：部长批准→消费一次；四拍再加活动不重放 APPROVE
      const cid = await t.comment(ticket, 'eng-0', '批示:批准')
      t.stack.clock.advance(1000)
      const r3 = await t.stack.engine.tick()
      expect(notes(r3, 'APPROVE')).toEqual([`DIRECTIVE;verb=批准;actor=eng-0;directive=${cid}`])
      await t.comment(ticket, 'eng-1', '开工')
      t.stack.clock.advance(1000)
      const r4 = await t.stack.engine.tick()
      expect(r4.events.filter((e) => (e.note ?? '').includes(`directive=${cid}`))).toHaveLength(0)
      expect(r4.events.filter((e) => e.event === 'APPROVE')).toHaveLength(0)
    } finally {
      t.stack.ledger.close()
    }
  })

  it('搁置：批示:搁置 置站立并抑制 5a 自动呈批（新单不弹回批位，WAIT_APPROVAL）', async () => {
    const t = makeTicker('s4-hold')
    try {
      const ticket = await t.makeL1Ticket({ state: '新单' })
      await t.comment(ticket, 'eng-0', '批示:搁置 等上游方案定稿')
      const r = await t.stack.engine.tick()
      expect(r.events.filter((e) => e.event === 'APPROVE').map((e) => e.note ?? '')).toContain(
        `DIRECTIVE;verb=搁置;actor=eng-0;directive=c-1;note=等上游方案定稿`,
      )
      // 回弹抑制：新单→待批 的 submit_approval 被站立拦截，落 WAIT_APPROVAL 观测面
      expect(r.actions.some((a) => a.type === 'submit_approval')).toBe(false)
      expect(r.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('WAIT_APPROVAL')
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('新单')
      // 站立持久：后续拍有新活动仍不自动呈批
      await t.comment(ticket, 'eng-1', '等通知')
      t.stack.clock.advance(1000)
      const r2 = await t.stack.engine.tick()
      expect(r2.actions.some((a) => a.type === 'submit_approval')).toBe(false)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('新单')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('T:proposal 类型流：待批（approval 锚）等批示不放行；部长批准后放行派发', async () => {
    const t = makeTicker('s4-proposal', { flows: proposalFlows() })
    try {
      const ticket = await t.makeL1Ticket({ state: '待批' })
      await t.stack.platform.issues.setField(ticket, 'type', 'proposal')
      // 无批示：5b 收口 WAIT_APPROVAL（typeInbox 直落待批的守门面——收件箱不自动派）
      await t.comment(ticket, 'eng-1', '提案就绪请批示')
      const r1 = await t.stack.engine.tick()
      expect(r1.actions.some((a) => a.type === 'dispatch')).toBe(false)
      expect(r1.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('WAIT_APPROVAL')
      // 部长批准 → 同拍 DISPATCH（approved 入参经 5b 派发轨道）
      const cid = await t.comment(ticket, 'eng-0', '批示:批准')
      t.stack.clock.advance(1000)
      const r2 = await t.stack.engine.tick()
      expect(notes(r2, 'APPROVE')).toEqual([`DIRECTIVE;verb=批准;actor=eng-0;directive=${cid}`])
      expect(r2.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('已派发')
    } finally {
      t.stack.ledger.close()
    }
  })
})

// ————————————————————————— S5：打回闭环 —————————————————————————

describe('S5 打回闭环（130-§8 判负线：状态不动或理由丢失）', () => {
  it('声明边（待批→新单）：批示:打回+理由 → 状态回新单 + APPROVE(verb=打回,reason) + 同拍不回弹', async () => {
    const t = makeTicker('s5-rollbed', { flows: l1WithRejectEdge() })
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'eng-0', '批示:打回 范围太大，先做词表')
      const r = await t.stack.engine.tick()
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('新单')
      expect(notes(r, 'APPROVE')).toEqual([`DIRECTIVE;verb=打回;actor=eng-0;directive=${cid};reason=范围太大，先做词表`])
      // 同拍防回弹：打回后 decide 对新单会想 submit_approval——站立（打回）拦截
      expect(r.actions.some((a) => a.type === 'submit_approval')).toBe(false)
      expect(r.phases.stateDiff.decisions.find((d) => d.ticket === ticket)?.code).toBe('WAIT_APPROVAL')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('防回弹持久：打回站立期新活动不把未修订件弹回批位；改判批准后恢复呈批/派发', async () => {
    const t = makeTicker('s5-norebound', { flows: l1WithRejectEdge() })
    try {
      const ticket = await t.makeL1Ticket()
      await t.comment(ticket, 'eng-0', '批示:打回 理由不充分')
      await t.stack.engine.tick()
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('新单')
      // 新活动拍：仍不呈批
      await t.comment(ticket, 'eng-1', '已修订，请再看')
      t.stack.clock.advance(1000)
      const r2 = await t.stack.engine.tick()
      expect(r2.actions.some((a) => a.type === 'submit_approval')).toBe(false)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('新单')
      // 改判批准（站立翻转=抑制解除）：新单先自动呈批回批位（5a 恢复）——
      // 站立「批准」不在抑制词集（打回/拆单/搁置）内
      await t.comment(ticket, 'eng-0', '批示:批准 修订版通过')
      t.stack.clock.advance(1000)
      const r3 = await t.stack.engine.tick()
      expect(r3.actions.some((a) => a.type === 'submit_approval' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      // 再拍：待批（approval 锚）×站立批准（5b approved）→ 派发
      await t.comment(ticket, 'eng-1', '待批就绪')
      t.stack.clock.advance(1000)
      const r4 = await t.stack.engine.tick()
      expect(r4.actions.some((a) => a.type === 'dispatch' && a.ticket === ticket)).toBe(true)
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('已派发')
    } finally {
      t.stack.ledger.close()
    }
  })

  it('边未声明（缺省等级流无 待批→新单）→ 状态不动+ESCALATE，理由不丢', async () => {
    const t = makeTicker('s5-noedge')
    try {
      const ticket = await t.makeL1Ticket()
      const cid = await t.comment(ticket, 'eng-0', '批示:打回 先收敛范围')
      const r = await t.stack.engine.tick()
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      expect(notes(r, 'ESCALATE')).toEqual([
        `DIRECTIVE_EDGE_UNDECLARED;verb=打回;actor=eng-0;directive=${cid};reason=先收敛范围`,
      ])
      expect(r.phases.collect.directives).toEqual({ tickets: 1, consumed: 1, rejected: 1 })
    } finally {
      t.stack.ledger.close()
    }
  })

  it('T:proposal 打回 fail-closed：fresh=待批=当前态（无可回边）→ 状态不动+可观测，理由不丢', async () => {
    const t = makeTicker('s5-proposal-edge', { flows: proposalFlows() })
    try {
      const ticket = await t.makeL1Ticket({ state: '待批' })
      await t.stack.platform.issues.setField(ticket, 'type', 'proposal')
      const cid = await t.comment(ticket, 'eng-0', '批示:打回 提案重写后再报')
      const r = await t.stack.engine.tick()
      expect((await t.stack.platform.issues.get(ticket)).state).toBe('待批')
      expect(notes(r, 'ESCALATE')).toEqual([
        `DIRECTIVE_EDGE_UNDECLARED;verb=打回;actor=eng-0;directive=${cid};reason=提案重写后再报`,
      ])
    } finally {
      t.stack.ledger.close()
    }
  })
})
