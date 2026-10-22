/**
 * proposal 类型流 spike（130-P1，studio-dev-172；studio-dev-130 §6.1.1/§6.1.2 规范形、
 * §6.10 P1 行、§8 S2/S3 判负线）——待批态+部长收件箱：
 *
 *   S2（判负线=落错态）：T:proposal 声明 + yt.typeInbox 直落待批——建单**不带
 *   initialState** 落「待批」（不是新单/平台默认态——§6.1.2 互查先于建单）；待批驻留
 *   （decide 5b WAIT_APPROVAL noop，autoApprove 缺省 false）=部长收件箱语义面；
 *   autoApprove: true 分支 → DISPATCH 直迁已派发（批示运行时归 130-P0，此处只验
 *   引擎让位语义）。
 *   S3（判负线=既有流被扰动）：T 键只叠不覆——task/L 级流原样（task·level0 照走
 *   新单→已派发直派；task·level1 照旧 SUBMIT_APPROVAL 呈批）；未声明类型回退
 *   L 级流；DEFAULT_FLOW_TABLE 键集零变化。
 *   打回边：typeFlows.proposal 携 待批→新单 声明边（显式意图可走、引擎绝不自动走）；
 *   新单→待批 主干边在（decide 5a 自动呈批——打回后回待批的再呈批路径）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { deriveFieldProvision, ensureAiwsTree, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, decide, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { flowsFromWorkflows } from '../../../src/engine/typeflows.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'

/** initCompany 的 git 首提身份（typeflows.e2e.test.ts 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'proposal-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'proposal-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-22T00:00:00.000Z')

/**
 * 公司包唯一改动面（130-P1 口径）：workflows 换 T:proposal 规范形声明（§6.1.1——六态链
 * +approval 锚+userstory 绑定实体+打回声明边）。yt.typeInbox: {proposal: 待批} 用模板
 * 自带声明（本刀模板已激活该面——§6.1.2 直落待批的 org-config 侧来源）。
 */
const WORKFLOWS_YAML = `
# —— 130-P1：proposal 类型流（studio-dev-130 §6.1.1 规范形）——
workflows:
  types:
    - id: proposal
      entity: userstory
      states:
        - 新单
        - 待批
        - 已派发
        - 证据就绪
        - 复验通过
        - name: 已交付
          final: true
      edges:
        - from: 待批
          to: 新单
      anchors:
        inbox: 新单
        approval: 待批
        dispatched: 已派发
        evidence: 证据就绪
        verified: 复验通过
        delivered: 已交付
`

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  autoApprove?: boolean
  /** 覆盖流表（serve 同序：DEFAULT 铺底 + T 键覆盖顶）；缺省=按 snapshot.workflows 合成 */
  flows?: FlowTable
}

function mergedFlows(workflows: CompanySnapshot['workflows']): FlowTable | undefined {
  const t = flowsFromWorkflows(workflows)
  return t === undefined ? undefined : { ...DEFAULT_FLOW_TABLE, ...t }
}

function makeAssembler() {
  return createDefaultAssembler({
    fwkVersion: 'v0.5-demo',
    frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
    snapshot,
    acceptance: ['echo demo-ok'],
    docRefs: ['docs/17-§2（主循环七相位）'],
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
  const person = snapshot.people[0] as PersonRef
  const flows = opts?.flows ?? mergedFlows(snapshot.workflows)
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
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.autoApprove !== undefined ? { autoApprove: opts.autoApprove } : {}),
      ...(flows !== undefined ? { flows } : {}),
    },
    people: snapshot.people,
    makeId: deterministicIds(),
  })
  return { platform, ledger, engine, clock }
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-proposal-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  // 公司包改动=纯配置：模板 workflows 段（T:patrol）拆掉换本包语料（T:proposal+yt.typeInbox）
  const files = await readDirectoryFiles(companyDir)
  const base = (files['org-config.yaml'] ?? '').replace(/\n# 单据类型流声明[\s\S]*?(?=\n# YouTrack 账号锚点映射)/, '')
  files['org-config.yaml'] = `${base}${WORKFLOWS_YAML}`
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

describe('import 面：T:proposal + yt.typeInbox 过闸并折叠（§6.1.1/§6.1.2）', () => {
  it('W-1..W-9 + TI-1..TI-3 全绿；deriveFieldProvision 折叠出直落待批', () => {
    expect(snapshot.workflows?.types.map((t) => t.id)).toEqual(['proposal'])
    const map = deriveFieldProvision({ typeInbox: { proposal: '待批' } }, snapshot.workflows)
    // yt 同键覆盖派生值（anchors.inbox=新单 → 直落待批）：互查先于建单，不经新单
    expect(map.typeInbox).toEqual({ proposal: '待批' })
    // userstory 绑定实体桶：六态全档（provision 建到承载实体）
    expect(map.entities).toEqual({ userstory: { states: ['新单', '待批', '已派发', '证据就绪', '复验通过', '已交付'] } })
    // 主干前向 + 打回声明边（待批→[已派发（前向）, 新单（声明边）]——顺序=前向先声明后；
    // 终态已交付无出边不落键——derive 防御性跳空）
    expect(map.typeFlows?.proposal).toEqual({
      新单: ['待批'],
      待批: ['已派发', '新单'],
      已派发: ['证据就绪'],
      证据就绪: ['复验通过'],
      复验通过: ['已交付'],
    })
  })

  it('flowsFromWorkflows：T:proposal 键注入（approval 锚=待批；打回边在 typeEdges）', () => {
    const t = flowsFromWorkflows(snapshot.workflows) as FlowTable
    const flow = t['T:proposal']
    expect(flow).toBeDefined()
    expect(flow.mainline).toEqual(['新单', '待批', '已派发', '证据就绪', '复验通过', '已交付'])
    expect(flow.anchors?.approval).toBe('待批')
    expect(flow.typeEdges).toContainEqual({ from: '待批', to: '新单' })
    // T 键只是叠加：DEFAULT_FLOW_TABLE 键集零变化（S3 前提）
    expect(Object.keys({ ...DEFAULT_FLOW_TABLE, ...t }).filter((k) => k.startsWith('T:'))).toEqual(['T:proposal'])
  })
})

describe('S2：proposal 建单直落待批（判负线=落错态）+ 待批驻留=部长收件箱', () => {
  let stack: TestStack
  let ticket = ''

  beforeAll(() => {
    stack = buildStack('proposal-inbox')
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('provision → 建 proposal 单不带 initialState → 直落「待批」（不是新单/平台默认）', async () => {
    const map = deriveFieldProvision({ typeInbox: { proposal: '待批' } }, snapshot.workflows)
    await stack.platform.fields.provision(map) // import→provision（serve 真链同序）
    const created = await stack.platform.issues.create({
      title: '提案：收件直落验证',
      type: 'proposal',
      level: 1,
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    ticket = created.id
    expect(created.state).toBe('待批')
    expect(created.state).not.toBe('新单') // §6.1.2 判负线：落新单=直落面失效（绕回 5a 呈批）
  })

  it('tick（autoApprove 缺省 false）：WAIT_APPROVAL 驻留——零派发零事件零工位（部长收件箱语义）', async () => {
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    // 待批态+approved≠true → decide 5b noop：不派发、不迁移、不开工位
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.actions.map((a) => `${a.type}:${a.code}`)).toContain('noop:WAIT_APPROVAL')
    expect((await stack.platform.issues.get(ticket)).state).toBe('待批')
    expect(stack.ledger.queryEvents({ issue: ticket })).toEqual([])
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toEqual([])
  })

  it('驻留稳定：第二拍静默零动作（意图一次消费——mirror 键不重投；态不变不重决策）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    // docs/22-§三.2 意图幂等：无新意图=无 noop 重放、无派发、无事件、无工位——
    // 待批驻留的静默面（批示面归 130-P0：P0 在待批态上接批准/打回运行时）
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect((await stack.platform.issues.get(ticket)).state).toBe('待批')
    expect(stack.ledger.queryEvents({ issue: ticket })).toEqual([])
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toEqual([])
  })
})

describe('S2-批：autoApprove=true → 待批放行 DISPATCH 直迁已派发（批示运行时接入位）', () => {
  let stack: TestStack
  let ticket = ''

  beforeAll(() => {
    stack = buildStack('proposal-approved', { autoApprove: true })
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('建单直落待批 → tick → DISPATCH（平台迁已派发+工位在途+DISPATCH 事件）', async () => {
    const map = deriveFieldProvision({ typeInbox: { proposal: '待批' } }, snapshot.workflows)
    await stack.platform.fields.provision(map)
    const created = await stack.platform.issues.create({
      title: '提案：批后派发验证',
      type: 'proposal',
      level: 1,
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    ticket = created.id
    expect(created.state).toBe('待批')
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.actions.map((a) => `${a.type}:${a.code}`)).toContain('dispatch:DISPATCH')
    expect((await stack.platform.issues.get(ticket)).state).toBe('已派发')
    expect(stack.ledger.queryEvents({ issue: ticket }).map((e) => e.event)).toContain('DISPATCH')
    expect(stack.ledger.listWorkRecords({ issue: ticket })[0]?.status).toBe('running')
  })
})

describe('S3：既有流零扰动（判负线=既有流被扰动）', () => {
  let stack: TestStack
  let taskTicket = ''

  beforeAll(() => {
    stack = buildStack('zero-perturbation')
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('task·level0 建单照落新单（typeInbox 无 task 键——TI-3 保留词面）', async () => {
    const map = deriveFieldProvision({ typeInbox: { proposal: '待批' } }, snapshot.workflows)
    await stack.platform.fields.provision(map)
    const created = await stack.platform.issues.create({
      title: '普通任务单：既有流对照',
      type: 'task',
      level: 0,
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    taskTicket = created.id
    expect(created.state).toBe('新单')
  })

  it('task·level0 → tick → 照旧新单→已派发直派（L0 无审批环——现状语义原样）', async () => {
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect((await stack.platform.issues.get(taskTicket)).state).toBe('已派发')
    expect(stack.ledger.queryEvents({ issue: taskTicket }).map((e) => e.event)).toContain('DISPATCH')
  })

  it('decide 回归锁：task·level1/新单 照旧 SUBMIT_APPROVAL（L1 呈批语义未被 T 键改写）', () => {
    const out = decide({
      issue: {
        id: 'regress-l1',
        title: 't',
        state: '新单',
        type: 'task',
        level: 1,
        dept: 'eng',
        assignee: 'P-1',
        lane: 'main',
        created: new Date(T0).toISOString(),
        updated: new Date(T0).toISOString(),
      },
      intent: { kind: 'ticket', company: 'demo-corp', ticket: 'regress-l1', source: 'mirror', priority: 0 },
      seenIntentKeys: [],
      laneLease: { lane: 'main', holder: null },
      inflightCount: 0,
      tickActionCount: 0,
      limits: { maxActionsPerTick: 5, maxInflight: 10 },
      breaker: { strikes: 0, threshold: 3 },
      flows: { ...DEFAULT_FLOW_TABLE, ...(flowsFromWorkflows(snapshot.workflows) as FlowTable) },
      now: T0 + 60_000,
      stallAfterMs: 3_600_000,
    })
    expect(out.action).toMatchObject({ type: 'submit_approval', code: 'SUBMIT_APPROVAL', toState: '待批' })
  })

  it('decide 回归锁：未声明类型回退 L0=新单→已派发 直派（解析序冻结，T 键零干扰）', () => {
    const out = decide({
      issue: {
        id: 'regress-l0',
        title: 't',
        state: '新单',
        type: 'improvisation', // 未声明类型：T 键未命中 → L<level> 回退（docs/18-§2.1.1 解析序）
        level: 0,
        dept: 'eng',
        assignee: 'P-1',
        lane: 'main',
        created: new Date(T0).toISOString(),
        updated: new Date(T0).toISOString(),
      },
      intent: { kind: 'ticket', company: 'demo-corp', ticket: 'regress-l0', source: 'mirror', priority: 0 },
      seenIntentKeys: [],
      laneLease: { lane: 'main', holder: null },
      inflightCount: 0,
      tickActionCount: 0,
      limits: { maxActionsPerTick: 5, maxInflight: 10 },
      breaker: { strikes: 0, threshold: 3 },
      flows: { ...DEFAULT_FLOW_TABLE, ...(flowsFromWorkflows(snapshot.workflows) as FlowTable) },
      now: T0 + 60_000,
      stallAfterMs: 3_600_000,
    })
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH', toState: '已派发' })
  })
})
