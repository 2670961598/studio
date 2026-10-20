/**
 * typeflows e2e —— DEV-43 单据类型系统验收④（零代码全链，docs/51 v1.1 / docs/18-§2.1.1）：
 *
 * 公司包只改 org-config.yaml（注入 workflows: 段声明 spike + defect 两类）——零代码改动，
 * import（loadCompanyDirectory + deriveFieldProvision）→ provision（fields.provision 物化
 * 三桶状态档）→ 建单**不带 initialState** → 派发-收割-合并-关单全链跑在新状态名上。
 *
 * 断言面：
 *   1. import 面：W-1..W-9 过闸，snapshot.workflows 就位；deriveFieldProvision 折叠出
 *      typeInbox/typeFlows/entities（spike 无 entity 折顶层、defect 折 issue 桶）
 *   2. provision 面：fake 平台留存档（N2 同构），建 spike 单不带 initialState 落
 *      typeInbox['spike']='待探索'（制作人显式要求：建单不传 initialState）
 *   3. 引擎面：配置注入 T 键流表（serve 同序：DEFAULT_FLOW_TABLE 铺底 + T 键覆盖顶），
 *      拍链走 待探索→探索中→探索结论就绪→复验通过→已归档（每拍一动作五事件）
 *   4. 不扰面：task 单（W-9 保留词·L0 回退）与未声明 level 单照走五态缺省流
 *   5. 审批环面：defect 流 approval 锚（autoApprove 批），新建→待批→修复中→…
 *   6. N1 热换面：applyCompanyUpdate 换 flows（tick 边界热换）——去 T 键后新 spike 单
 *      NOOP_UNKNOWN_STATE（诚实不静默），回灌 T 键恢复 DISPATCH
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { deriveFieldProvision, ensureAiwsTree, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE, type FlowTable } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { flowsFromWorkflows } from '../src/engine/typeflows.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'

/** initCompany 的 git 首提身份（e2e.test.ts 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'typeflows-e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'typeflows-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-21T00:00:00.000Z')

/**
 * 公司包的唯一改动面（验收④口径「零代码」）：org-config.yaml 末尾追加 workflows 段。
 * spike=无 entity（顶层桶·双终态·归档重开边）；defect=entity: issue（审批环）。
 */
const WORKFLOWS_YAML = `
# —— DEV-43 类型声明（docs/51 v1.1）：以下两段是本包唯一的类型面改动 ——
workflows:
  types:
    - id: spike
      states:
        - name: 待探索
        - name: 探索中
        - name: 探索结论就绪
        - name: 复验通过
        - name: 已归档
          final: true
        - name: 不予归档
          final: true
      edges:
        - from: 已归档
          to: 待探索
      anchors:
        inbox: 待探索
        dispatched: 探索中
        evidence: 探索结论就绪
        verified: 复验通过
        delivered: 已归档
    - id: defect
      entity: issue
      states:
        - name: 新建
        - name: 待批
        - name: 修复中
        - name: 待复验
        - name: 已修复
        - name: 已关闭
          final: true
      edges:
        - from: 待复验
          to: 修复中
      anchors:
        inbox: 新建
        approval: 待批
        dispatched: 修复中
        evidence: 待复验
        verified: 已修复
        delivered: 已关闭
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
  /** 覆盖流表（serve 同序：DEFAULT 铺底 + T 键覆盖顶）；缺省=按 snapshot.workflows 合成 */
  flows?: FlowTable
  autoApprove?: boolean
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
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-typeflows-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  // 公司包改动=纯配置：只改 org-config.yaml 字符串（追加 workflows 段），不动任何代码
  const files = await readDirectoryFiles(companyDir)
  files['org-config.yaml'] = `${files['org-config.yaml'] ?? ''}${WORKFLOWS_YAML}`
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

describe('import 面：配置改动过闸并折叠出三桶', () => {
  it('W-1..W-9 全绿挂载，workflows 就位；deriveFieldProvision 折叠 typeInbox/typeFlows/entities', () => {
    expect(snapshot.workflows?.types.map((t) => t.id)).toEqual(['spike', 'defect'])
    const map = deriveFieldProvision(undefined, snapshot.workflows)
    expect(map.typeInbox).toEqual({ spike: '待探索', defect: '新建' })
    expect(map.typeFlows?.spike).toMatchObject({ 待探索: ['探索中'], 已归档: ['待探索'] })
    expect(map.typeFlows?.defect).toMatchObject({ 新建: ['待批'], 待复验: ['已修复', '修复中'] })
    // D7 分桶：defect（entity: issue）态入实体桶不落顶层；spike 折顶层
    expect(map.entities?.issue?.states).toEqual(['新建', '待批', '修复中', '待复验', '已修复', '已关闭'])
    expect(map.states).toContain('待探索')
    expect(map.states).not.toContain('新建')
  })
})

describe('④ 零代码全链：provision → 建 spike 单（不带 initialState）→ 拍链走新状态名', () => {
  let stack: TestStack
  let ticket = ''

  beforeAll(() => {
    stack = buildStack('spike-chain')
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('provision 物化三桶；建 spike 单不带 initialState 落 typeInbox["spike"]=待探索', async () => {
    const map = deriveFieldProvision(undefined, snapshot.workflows)
    await stack.platform.fields.provision(map) // import→provision（serve 真链同序）
    // 建单不带 initialState、不带 level——落位完全由声明驱动（制作人显式要求）
    const created = await stack.platform.issues.create({
      title: '探索单：验证类型流全链',
      type: 'spike',
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    ticket = created.id
    expect(created.state).toBe('待探索')
    expect(created.level).toBeUndefined()
  })

  it('tick1：待探索 → DISPATCH（平台迁探索中 + 工位在途）', async () => {
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.actions.map((a) => `${a.type}:${a.code}`)).toContain('dispatch:DISPATCH')
    expect((await stack.platform.issues.get(ticket)).state).toBe('探索中')
    expect(stack.ledger.listWorkRecords({ issue: ticket })[0]?.status).toBe('running')
  })

  it('tick2：探索中 → 收割 GATE_PASS → 探索结论就绪（收割相位非动作面——事件+态双证）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.harvest.completed).toBe(1)
    expect(stack.ledger.queryEvents({ issue: ticket }).map((e) => e.event)).toContain('GATE_PASS')
    expect((await stack.platform.issues.get(ticket)).state).toBe('探索结论就绪')
  })

  it('tick3：探索结论就绪 → QA_PASS → 复验通过', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.actions.map((a) => `${a.type}:${a.code}`)).toContain('collect:EVIDENCE_READY')
    expect(stack.ledger.queryEvents({ issue: ticket }).map((e) => e.event)).toContain('QA_PASS')
    expect((await stack.platform.issues.get(ticket)).state).toBe('复验通过')
  })

  it('tick4：复验通过 → MERGE → 已归档；tick5：CLOSE 收口（事件序+台账镜像）', async () => {
    stack.clock.advance(1000)
    const r4 = await stack.engine.tick()
    expect(r4.actions.map((a) => `${a.type}:${a.code}`)).toContain('merge:MERGE_DUE')
    expect((await stack.platform.issues.get(ticket)).state).toBe('已归档')
    stack.clock.advance(1000)
    const r5 = await stack.engine.tick()
    expect(r5.phases.recycle.recycled).toBe(1)
    const events = stack.ledger.queryEvents({ issue: ticket }).map((e) => e.event)
    expect(events).toContain('DISPATCH')
    expect(events).toContain('GATE_PASS')
    expect(events).toContain('QA_PASS')
    expect(events).toContain('MERGE')
    expect(events).toContain('CLOSE')
  })

  it('不扰面：task 单照走 L0 五态缺省流（W-9 保留词回退·derive 铺底五态）', async () => {
    const task = await stack.platform.issues.create({ title: '岗单：照走缺省流', type: 'task', level: 0 })
    // derive 铺底 states=[新单,已派发,证据就绪,复验通过,已交付,...spike 态]——task 无
    // typeInbox 键回退 states[0]=新单（L0 初态），不落 spike 桶首态
    expect(task.state).toBe('新单')
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.actions.some((a) => a.type === 'dispatch' && a.ticket === task.id)).toBe(true)
    expect((await stack.platform.issues.get(task.id)).state).toBe('已派发')
  })
})

describe('审批环面：defect 流 approval 锚（autoApprove 批）', () => {
  let stack: TestStack

  beforeAll(() => {
    stack = buildStack('defect-chain', { autoApprove: true })
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('新建 → SUBMIT_APPROVAL 迁待批；待批+approved → DISPATCH 迁修复中', async () => {
    const map = deriveFieldProvision(undefined, snapshot.workflows)
    await stack.platform.fields.provision(map)
    const created = await stack.platform.issues.create({
      title: '缺陷单：审批环链',
      type: 'defect',
      dept: snapshot.departments[0]?.path,
      assignee: snapshot.people[0]?.id,
    })
    expect(created.state).toBe('新建')
    stack.clock.advance(1000)
    const r1 = await stack.engine.tick()
    expect(r1.actions.map((a) => `${a.type}:${a.code}`)).toContain('submit_approval:SUBMIT_APPROVAL')
    expect((await stack.platform.issues.get(created.id)).state).toBe('待批')
    stack.clock.advance(1000)
    const r2 = await stack.engine.tick()
    expect(r2.actions.map((a) => `${a.type}:${a.code}`)).toContain('dispatch:DISPATCH')
    expect((await stack.platform.issues.get(created.id)).state).toBe('修复中')
  })

  it('未批（autoApprove 关）→ 待批态恒 WAIT_APPROVAL 不派发', async () => {
    const idle = buildStack('defect-wait')
    try {
      const map = deriveFieldProvision(undefined, snapshot.workflows)
      await idle.platform.fields.provision(map)
      const created = await idle.platform.issues.create({ title: '缺陷单：等批', type: 'defect' })
      idle.clock.advance(1000)
      await idle.engine.tick() // 新建 → SUBMIT_APPROVAL
      idle.clock.advance(1000)
      const r = await idle.engine.tick()
      expect(r.actions.map((a) => `${a.type}:${a.code}`)).toContain('noop:WAIT_APPROVAL')
      expect((await idle.platform.issues.get(created.id)).state).toBe('待批')
      expect(r.phases.dispatch.dispatched).toBe(0)
    } finally {
      idle.ledger.close()
    }
  })
})

describe('N1 热换面：applyCompanyUpdate 换 flows（tick 边界）', () => {
  it('去 T 键 → 新 spike 单 NOOP_UNKNOWN_STATE（不静默）；回灌 → 恢复 DISPATCH', async () => {
    const stack = buildStack('hot-swap')
    try {
      const map = deriveFieldProvision(undefined, snapshot.workflows)
      await stack.platform.fields.provision(map)
      const created = await stack.platform.issues.create({ title: '热换探索单', type: 'spike' })
      expect(created.state).toBe('待探索')

      // 热换①：flows 收回纯 L 表（无 T 键）——spike 无 level 无 L 键 → 诚实 NOOP（缺流明报）
      stack.engine.applyCompanyUpdate({
        people: snapshot.people,
        assembler: makeAssembler(),
        defaultPersonId: (snapshot.people[0] as PersonRef).id,
        deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
        defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
        flows: DEFAULT_FLOW_TABLE,
      })
      stack.clock.advance(1000)
      const r1 = await stack.engine.tick()
      expect(r1.actions.map((a) => `${a.type}:${a.code}`)).toContain('noop:NOOP_UNKNOWN_FLOW')
      expect(r1.phases.dispatch.dispatched).toBe(0)

      // 热换②：回灌 T 键表——新 spike 单（新活动触发决策）恢复按类型解析派发；
      // 热换前的 T-1 已被 noop 拍消费完活动（无新活动不进决策——诚实幂等，不重演）
      stack.engine.applyCompanyUpdate({
        people: snapshot.people,
        assembler: makeAssembler(),
        defaultPersonId: (snapshot.people[0] as PersonRef).id,
        deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
        defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
        flows: mergedFlows(snapshot.workflows) as FlowTable,
      })
      const revived = await stack.platform.issues.create({ title: '热换后探索单', type: 'spike' })
      expect(revived.state).toBe('待探索')
      stack.clock.advance(1000)
      const r2 = await stack.engine.tick()
      expect(r2.actions.map((a) => `${a.type}:${a.code}:${a.ticket}`)).toContain(`dispatch:DISPATCH:${revived.id}`)
      expect((await stack.platform.issues.get(revived.id)).state).toBe('探索中')
    } finally {
      stack.ledger.close()
    }
  })
})
