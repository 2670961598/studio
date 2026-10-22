/**
 * e2e —— demo 模式端到端：一张单从 create → 派发 → 收割 → GATE_PASS → CLOSE 全链（v0.5 合龙件）
 *
 * 依据（实现单引用）：
 *   - docs/23-§四「demo 模式零外部依赖跑通 TTHW」的预演：fake 全家桶——fake FlowPlatform
 *     （内存七能力）+ fake executor（launch 即完成流+落 REPORT/summary）+ tmp 台账 +
 *     tmp 公司目录（initCompany 生成 → loadCompanyDirectory 挂载快照）。
 *   - docs/17-§2 七相位每拍幂等、同 tick 单只一单至多一动作；docs/17-§6 收割四要件与断路器。
 *
 * 断言面：
 *   1. 全链事件序列（单据侧）：DISPATCH → GATE_PASS → QA_PASS → MERGE → CLOSE（每拍一动作）
 *   2. 平台状态迁移：新单→已派发→证据就绪→复验通过→已交付（+失败链回首批位）
 *   3. work_records 收口：running→done（ended_at/cost/tokens/report_ref/summary_ref 齐）
 *   4. 指纹落账：DISPATCH note 携完整分层指纹（W-…/co.…/org.…/p.…/t.<单号>.<att>/ex.…）
 *   5. 幂等：连续空拍不双写（DISPATCH 计数不涨，零动作拍落 HEARTBEAT）
 *   6. 失败与断路：闸门红→GATE_FAIL+回新单；同签名 3 连击→ESCALATE+自动开 bug 单+
 *      HOLD_BREAKER_OPEN 停重派；并发闸：泳道占用→HOLD_LANE_BUSY、每拍上限→HOLD_TICK_LIMIT
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { budgetView, foldBudgets } from '@studio-next/core'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner, type GateOutcome, type GateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'

/** initCompany 的 git 首提身份（company/test/init.test.ts 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-16T00:00:00.000Z')

let root = ''
let snapshot: CompanySnapshot
let companyDir = ''
/** .AIWS 员工工作区树根（dirname(companyDir)/.AIWS=公司根形态，docs/43-§五；派发 cwd 之源） */
let aiwsRoot = ''

/** 确定性 ULID（contract UlidSchema 合法形：'0' 时间段 + 计数尾段，26 字符） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/** 测试栈：每用例独立台账/平台/引擎（公司目录与快照全局共享） */
interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

interface StackOptions {
  gateRunner?: GateRunner
  limits?: { maxActionsPerTick?: number; maxInflight?: number; maxInflightPerPerson?: number }
  breakerThreshold?: number
  /** 适配器注入面（132-§6.1 单A：四桶+model 账目收割回归用）；缺省=default fake */
  adapter?: ReturnType<typeof createFakeAdapter>
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
  registry.register(opts?.adapter ?? createFakeAdapter(), { default: true })
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
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: opts?.gateRunner ?? createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      aiwsRoot,
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      limits: {
        maxActionsPerTick: opts?.limits?.maxActionsPerTick ?? ENGINE_CONFIG_DEFAULTS.limits.maxActionsPerTick,
        maxInflight: opts?.limits?.maxInflight ?? ENGINE_CONFIG_DEFAULTS.limits.maxInflight,
        // 人闸帽透传（129-§6.2-R3：缺省不注入=引擎兜底 1 串行——本测试栈显式可放宽）
        ...(opts?.limits?.maxInflightPerPerson !== undefined
          ? { maxInflightPerPerson: opts.limits.maxInflightPerPerson }
          : {}),
      },
      ...(opts?.breakerThreshold !== undefined ? { breakerThreshold: opts.breakerThreshold } : {}),
    },
    people: snapshot.people,
    makeId: deterministicIds(),
  })
  return { platform, ledger, engine, clock }
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-daemon-e2e-'))
  companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
  // .AIWS 员工工作区树（DEV-28，docs/43-§五）：公司根形态（companyDir 同级）建树——
  // e2e 主链的派发 cwd 落员工家 <部门路径>/<工号>/tickets/<单号>/att<N>
  aiwsRoot = path.join(path.dirname(companyDir), '.AIWS')
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  expect(aiwsTree.personDirs.length).toBeGreaterThan(0)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 单据侧事件序列（滤掉哨兵心跳与熔断建单面） */
function ticketEvents(ledger: Ledger, ticket: string): string[] {
  return ledger.queryEvents({ issue: ticket }).map((e) => e.event)
}

describe('demo 端到端：create → 派发 → 收割 → GATE_PASS → CLOSE 全链', () => {
  let stack: TestStack

  beforeAll(() => {
    stack = buildStack('main-chain')
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('前置：init 生成公司目录可挂载（单部门单人）', () => {
    expect(snapshot.slug).toBe('demo-corp')
    expect(snapshot.people.length).toBeGreaterThanOrEqual(1)
    expect(snapshot.departments.length).toBeGreaterThanOrEqual(1)
  })

  it('tick1：新单 → DISPATCH（平台迁已派发 + work_records 在途 + 装配落盘 + 指纹落账）', async () => {
    const created = await stack.platform.issues.create({
      title: 'demo 单：交付一句话',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.actions.map((a) => `${a.type}:${a.code}`)).toContain('dispatch:DISPATCH')

    // 平台权威态 + 台账镜像
    expect((await stack.platform.issues.get(created.id)).state).toBe('已派发')
    expect(stack.ledger.getTicketMirror(created.id)?.state).toBe('已派发')
    expect(stack.ledger.getTicketMirror(created.id)?.company).toBe('demo-corp')

    // work_records 落在途
    const records = stack.ledger.listWorkRecords({ issue: created.id })
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('running')
    expect(records[0]?.attempt).toBe(1)
    expect(records[0]?.executor).toBe('fake')
    expect(records[0]?.ended_at).toBeUndefined()

    // 装配落盘：AGENTS.md（勿手改横幅+分层指纹+六层定界）与任务书首版——落 **员工家**
    // .AIWS/<部门路径>/<工号>/tickets/<单号>/att<N>（DEV-28，docs/43-§五 派发权限圈①cwd）
    const workspace = path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1', 'tickets', created.id, 'att1')
    const agentsPath = path.join(workspace, 'AGENTS.md')
    const briefPath = path.join(workspace, 'brief.md')
    expect(existsSync(agentsPath)).toBe(true)
    expect(existsSync(briefPath)).toBe(true)
    const agentsMd = readFileSync(agentsPath, 'utf8')
    expect(agentsMd).toContain('Studio Next 生成物：勿手改')
    expect(agentsMd).toContain('<!-- LAYER:L0:BEGIN -->')
    expect(agentsMd).toContain('<!-- LAYER:L5:END -->')
    expect(readFileSync(briefPath, 'utf8')).toContain('## 验收口径')
    // 对抗布局负断言①：旧一次性布局 <rootDir>/workspaces/<单号>/att1 不得存在（正式链路
    // 一律员工家——两布局并生=接线漏）；②工号目录=ensureAiwsTree 建的组织树成员（家在位）
    expect(existsSync(path.join(root, 'main-chain', 'workspaces', created.id, 'att1', 'brief.md'))).toBe(false)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'))).toBe(true)

    // 指纹落账：DISPATCH note 携完整分层指纹 + payload 哈希与字节
    const dispatch = stack.ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')
    expect(dispatch).toBeDefined()
    expect(dispatch?.note).toMatch(/^fp=W-v0\.5-demo\/co\.[0-9a-f]{8}\/org\.[0-9a-f]{8}\/p\.AGENT-1\.[0-9a-f]{8}\/t\.T-1\.1\/ex\.fake@0\.0\.0-fake;/)
    expect(dispatch?.payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(dispatch?.size).toBeGreaterThan(0)
    expect(dispatch?.attempt).toBe(1)

    // 预算闸（16-§三 / 20-§六.8）：DISPATCH 前已落 reserve 双行（issue+person/#p；态 B
    // 降级：估算=适配器自报——fake=0.01 与实际成本同额）；预留先于派发（id 全序直证落账序）
    const budget = report.phases.dispatch
    expect(budget.budgetReserved).toBe(1)
    expect(budget.budgetRefused).toBe(0)
    const reserves = stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: created.id }).filter((r) => r.kind === 'reserve')
    const personReserves = stack.ledger.queryBudgets({ scope_kind: 'person', scope_id: (snapshot.people[0] as PersonRef).id }).filter((r) => r.kind === 'reserve')
    expect(reserves).toHaveLength(1)
    expect(personReserves).toHaveLength(1)
    expect(personReserves[0]?.id).toBe(`${reserves[0]?.id}#p`)
    expect(reserves[0]?.estimated_usd).toBe(0.01)
    expect(dispatch !== undefined && reserves[0]?.id < dispatch.id).toBe(true)
  })

  it('tick2：收割 → GATE_PASS（四要件齐 + work_records 收口 done + 断路复位）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.harvest.completed).toBe(1)
    expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS'])
    expect((await stack.platform.issues.get('T-1')).state).toBe('证据就绪')

    const record = stack.ledger.listWorkRecords({ issue: 'T-1' })[0]
    expect(record?.status).toBe('done')
    expect(record?.ended_at).toBeGreaterThan(0)
    expect(record?.cost_usd).toBe(0.01)
    expect(record?.tokens).toEqual({ input: 100, output: 50 })
    expect(record?.report_ref).toMatch(/REPORT\.md$/)
    expect(record?.summary_ref).toMatch(/summary\.json$/)
    expect(existsSync(record?.report_ref ?? '')).toBe(true)
    // 收割四要件收账随迁员工家（docs/17-§6）：report_ref 落 .AIWS 工位（非旧 rootDir 布局）
    expect(record?.report_ref).toContain(path.join('.AIWS', 'departments', '工程部', 'AGENT-1', 'tickets', 'T-1', 'att1'))
    expect(record?.summary_ref).toContain(path.join('.AIWS', 'departments', '工程部', 'AGENT-1', 'tickets', 'T-1', 'att1'))

    const gatePass = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_PASS')
    expect(gatePass?.tokens).toEqual({ input: 100, output: 50 })
    expect(gatePass?.cost_usd).toBe(0.01)
    expect(gatePass?.duration_ms).toBe(10)

    // 预算结算全链对账（16-§三：成本按每成功交付记账）：settle 双行冲销预留——
    // 折叠后 issue/person 两档均 reserved=0 / settled=0.01（行流重建=净视图）
    const settles = stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' }).filter((r) => r.kind === 'settle')
    expect(settles).toHaveLength(1)
    expect(settles[0]?.actual_usd).toBe(0.01)
    expect(settles[0]?.estimated_usd).toBe(0.01)
    expect(gatePass?.note).toContain('budget=settle 冲销 $0.0100 实际 $0.0100')
    const issueView = budgetView(foldBudgets(stack.ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' })), 'issue', 'T-1')
    expect(issueView).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
    const personView = budgetView(
      foldBudgets(stack.ledger.queryBudgets({ scope_kind: 'person', scope_id: (snapshot.people[0] as PersonRef).id })),
      'person',
      (snapshot.people[0] as PersonRef).id,
    )
    expect(personView).toEqual({ reserved: 0, settled: 0.01, refused: 0 })
  })

  it('tick3：collect → QA_PASS（证据就绪→复验通过）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS', 'QA_PASS'])
    expect((await stack.platform.issues.get('T-1')).state).toBe('复验通过')
  })

  it('tick4：merge → MERGE（复验通过→已交付，v0 模拟合并）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE'])
    expect((await stack.platform.issues.get('T-1')).state).toBe('已交付')
  })

  it('tick5：recycle → CLOSE（泳道释放，单据生命周期收口；工位原位归档=.AIWS 家保留）', async () => {
    const reportPathBefore = stack.ledger.listWorkRecords({ issue: 'T-1' })[0]?.report_ref ?? ''
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.recycle.recycled).toBe(1)
    expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE'])
    const close = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'CLOSE')
    expect(close?.note).toContain('.AIWS 家保留')
    // 家保留直证：关单后工位证据原样在位（REPORT/summary/brief 不迁不删——refs 不断链），
    // 且工号目录本身仍是活组织成员（不归档——工位史属家，不属单据生命周期）
    expect(existsSync(reportPathBefore)).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1', 'tickets', 'T-1', 'att1', 'brief.md'))).toBe(true)
    expect(existsSync(path.join(aiwsRoot, 'departments', '工程部', 'AGENT-1'))).toBe(true)
  })

  it('tick6+：空拍 → HEARTBEAT；幂等——连续空拍不双写（DISPATCH 计数不涨）', async () => {
    stack.clock.advance(1000)
    const idle1 = await stack.engine.tick()
    stack.clock.advance(1000)
    const idle2 = await stack.engine.tick()
    expect(idle1.phases.account.heartbeat).toBe(true)
    expect(idle2.phases.account.heartbeat).toBe(true)
    expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE'])
    const heartbeats = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'HEARTBEAT')
    expect(heartbeats).toHaveLength(2)
    // 游标已持久化：两空拍的采集均为零增量
    expect(idle2.phases.collect.activities).toBe(0)
    expect(idle2.phases.collect.cursorAfter).not.toBeNull()
  })

  it('闭环后同泳道可再派（lane 释放验证）', async () => {
    await stack.platform.issues.create({ title: '第二张单：同泳道复用', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(report.actions.some((a) => a.type === 'dispatch' && a.ticket === 'T-2')).toBe(true)
  })
})

describe('失败链与断路器：闸门红 → GATE_FAIL → 3 连击熔断 → ESCALATE + bug 单 + 停重派', () => {
  it('同签名 3 连击后断路开（HOLD_BREAKER_OPEN），bug 单自动创建且不定级不派发', async () => {
    // 注入恒红闸门（exit=1）：四要件第 4 条永不满足（REPORT/流均正常——单要件缺失面）
    const redGate: GateRunner = {
      async run(input): Promise<GateOutcome> {
        return { exitCode: 1, reportExists: true, reportPath: path.join(input.workspace, 'REPORT.md'), note: 'test 注入：验收红' }
      },
    }
    const stack = buildStack('breaker', { gateRunner: redGate })
    await stack.platform.issues.create({ title: '会熔断的单', type: 'task', level: 0 })

    // 三轮「派发→收割失败」（每轮两拍：dispatch 拍 + harvest 拍）
    for (let round = 1; round <= 3; round += 1) {
      stack.clock.advance(1000)
      const dispatchTick = await stack.engine.tick()
      expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
      expect((await stack.platform.issues.get('T-1')).state).toBe('已派发')
      const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'DISPATCH')
      expect(dispatch).toHaveLength(round)
      expect(dispatch[round - 1]?.attempt).toBe(round)

      stack.clock.advance(1000)
      const harvestTick = await stack.engine.tick()
      expect(harvestTick.phases.harvest.failed).toBe(1)
      expect(ticketEvents(stack.ledger, 'T-1')).toContain('GATE_FAIL')
      // 回首批位（rollback 边：已派发→新单——decide/flows 默认回退表）
      expect((await stack.platform.issues.get('T-1')).state).toBe('新单')
      const record = stack.ledger.listWorkRecords({ issue: 'T-1' })[round - 1]
      expect(record?.status).toBe('failed')
    }

    // 第三连击 = 熔断瞬间：ESCALATE 落账 + bug 单自动创建（relates-to 关联）+ 不定级
    const escalate = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'ESCALATE')
    expect(escalate).toBeDefined()
    const bugId = /bug 单 (T-\d+)/.exec(escalate?.note ?? '')?.[1]
    expect(bugId).toBeDefined()
    const bug = await stack.platform.issues.get(bugId as string)
    expect(bug.type).toBe('bug')
    expect(bug.level).toBeUndefined()
    expect(bug.title).toContain('[bug] T-1')

    // 停重派：下一拍 decide 压制（HOLD_BREAKER_OPEN），bug 单不定级明报不动（NOOP_UNKNOWN_FLOW）
    stack.clock.advance(1000)
    const held = await stack.engine.tick()
    const decisions = held.phases.stateDiff.decisions
    expect(decisions.find((d) => d.ticket === 'T-1')?.code).toBe('HOLD_BREAKER_OPEN')
    expect(decisions.find((d) => d.ticket === bugId)?.code).toBe('NOOP_UNKNOWN_FLOW')
    expect(stack.ledger.queryEvents({ issue: 'T-1' }).filter((e) => e.event === 'DISPATCH')).toHaveLength(3)
    stack.ledger.close()
  })
})

describe('并发四闸：泳道占用、人闸与每拍上限（129-§6.2-R3 闸序冻结：断路 > 泳道 > 人 > 每拍 > 在途）', () => {
  it('同泳道第二单 HOLD_LANE_BUSY；同人异泳道 HOLD_PERSON_BUSY（人闸先于每拍限——缺省帽 1）', async () => {
    const stack = buildStack('gates', { limits: { maxActionsPerTick: 1, maxInflight: 4 } })
    await stack.platform.issues.create({ title: 'a：占 core 泳道', type: 'task', level: 0 })
    await stack.platform.issues.create({ title: 'b：core 泳道排队', type: 'task', level: 0 })
    const extra = await stack.platform.issues.create({ title: 'c：extra 泳道但人忙（同人缺省帽 1）', type: 'task', level: 0 })
    await stack.platform.issues.setField(extra.id, 'lane', 'extra')

    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1)
    const byTicket = new Map(report.phases.stateDiff.decisions.map((d) => [d.ticket, d.code]))
    expect(byTicket.get('T-1')).toBe('DISPATCH')
    expect(byTicket.get('T-2')).toBe('HOLD_LANE_BUSY')
    // 泳道空但人忙（T-1 已占 AGENT-1 的缺省帽 1）——闸序：人 > 每拍（S8 同款断言）
    expect(byTicket.get('T-3')).toBe('HOLD_PERSON_BUSY')
    stack.ledger.close()
  })

  it('人闸放宽（maxInflightPerPerson=2）后每拍上限照拦：HOLD_TICK_LIMIT（两闸正交，顺延不丢）', async () => {
    const stack = buildStack('gates-person2', {
      limits: { maxActionsPerTick: 1, maxInflight: 4, maxInflightPerPerson: 2 },
    })
    await stack.platform.issues.create({ title: 'a：占 core 泳道', type: 'task', level: 0 })
    await stack.platform.issues.create({ title: 'b：core 泳道排队', type: 'task', level: 0 })
    const extra = await stack.platform.issues.create({ title: 'c：extra 泳道人也有手——拍上限拦', type: 'task', level: 0 })
    await stack.platform.issues.setField(extra.id, 'lane', 'extra')

    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1)
    const byTicket = new Map(report.phases.stateDiff.decisions.map((d) => [d.ticket, d.code]))
    expect(byTicket.get('T-1')).toBe('DISPATCH')
    expect(byTicket.get('T-2')).toBe('HOLD_LANE_BUSY')
    // 人有第二只手（帽 2：在工 1 < 2 过人闸）→ 每拍上限拦（1 动作已满）——闸序：人 > 每拍
    expect(byTicket.get('T-3')).toBe('HOLD_TICK_LIMIT')
    stack.ledger.close()
  })
})

describe('store v4 切换回归：daemon 全路径无自建 DDL', () => {
  it('createEngine（含初始化持久化触点）+ 一整拍后 sqlite_master 快照不变、版本不漂（无自建表/索引）', async () => {
    // 切换前 daemon 在 createEngine 即 ledger.db.exec(CREATE TABLE IF NOT EXISTS daemon_kv ...)；
    // 切 store v4 后引擎对库只剩正式读写面（kvGet/kvSet/endWorkRecord/appendEvent/...）——
    // 本测试是对「daemon 不再执行任何 DDL」的直证（v4-debts.test.ts 侧 store 面对照的同题互证）。
    const ledger = openLedger(path.join(root, 'no-ddl.sqlite'))
    const schemaOf = (): string =>
      JSON.stringify(ledger.db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all())
    const before = schemaOf()
    const person = snapshot.people[0] as PersonRef
    let t = T0
    const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.5-demo',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: (): number => t,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: snapshot.slug,
        rootDir: path.join(root, 'no-ddl'),
        defaultPersonId: person.id,
        deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
        defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      },
      people: snapshot.people,
    })
    // 空拍全路径：采集（kvGet/kvSet 游标与拍序）→ 镜像对账 → 决策 → HEARTBEAT 落账
    t += 1000
    const report = await engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.account.heartbeat).toBe(true)
    expect(ledger.kvGet('tick.seq')).toBe('1')
    expect(schemaOf()).toBe(before)
    expect(ledger.version()).toBe(12) // store migration v8(132-A)+v9(129-B)+v11(132-C usage)+v12(132-D cost_daily)——版本随库迁移面走，daemon 仍零 DDL
    ledger.close()
  })
})

describe('收割账目面：tokens 四桶兼容读 + model 全链（132-§6.1 单A·studio-dev-168）', () => {
  it('四桶 + model 适配器账 → work_records（tokens/model 列）+ GATE_PASS（tokens 四桶 + note 后缀 model=）', async () => {
    const stack = buildStack('harvest-model', {
      adapter: createFakeAdapter({
        usage: { input: 1500, output: 100, cache_read: 640, cache_creation: 256 },
        model: 'glm/GLM-5.3',
      }),
    })
    try {
      await stack.platform.issues.create({ title: '四桶+model 收割对账单', type: 'task', level: 0 })
      stack.clock.advance(1000)
      await stack.engine.tick() // DISPATCH
      stack.clock.advance(1000)
      const report = await stack.engine.tick() // 收割
      expect(report.errors).toEqual([])
      expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS'])

      // work_records：tokens 四桶原样 + model 列落归一形（v8 列全链首证）
      const record = stack.ledger.listWorkRecords({ issue: 'T-1' })[0]
      expect(record?.tokens).toEqual({ input: 1500, output: 100, cache_read: 640, cache_creation: 256 })
      expect(record?.model).toBe('glm/GLM-5.3')

      // GATE_PASS 事件：tokens 四桶 + note 后缀 model=…（events 列集冻结——model 只走
      // work_records 列与本 note 后缀，132-§6.1「不扩 events 列」）
      const gatePass = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.tokens).toEqual({ input: 1500, output: 100, cache_read: 640, cache_creation: 256 })
      expect(gatePass?.note).toContain('model=glm/GLM-5.3')
    } finally {
      stack.ledger.close()
    }
  })

  it('旧形 cached 适配器账（存量 85 行同形）→ events tokens 兼容读归 cache_read（读侧 cache_read ?? cached，G7 兼容）', async () => {
    const stack = buildStack('harvest-cached-compat', {
      adapter: createFakeAdapter({ usage: { input: 900, output: 120, cached: 45000 } }),
    })
    try {
      await stack.platform.issues.create({ title: '旧形 cached 兼容读对账单', type: 'task', level: 0 })
      stack.clock.advance(1000)
      await stack.engine.tick()
      stack.clock.advance(1000)
      const report = await stack.engine.tick()
      expect(report.errors).toEqual([])
      expect(ticketEvents(stack.ledger, 'T-1')).toEqual(['DISPATCH', 'GATE_PASS'])

      // GATE_PASS tokens（events F2-04 四桶列）：cached → cache_read 归并——新键落账，
      // 旧键不透传（写侧一律新键）；cache_creation 无源=不落键
      const gatePass = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass?.tokens).toEqual({ input: 900, output: 120, cache_read: 45000 })
      expect(gatePass?.note).not.toContain('model=') // 未声明模型=note 无后缀（无从可知不猜）

      // work_records.tokens（store 面）：收割直录 stats 原体——旧形键原样往返（store 不
      // 重排不改写；读侧归并归 events 面与消费方，两列两责不混淆）
      const record = stack.ledger.listWorkRecords({ issue: 'T-1' })[0]
      expect(record?.tokens).toEqual({ input: 900, output: 120, cached: 45000 })
      expect(record?.model).toBeUndefined()
    } finally {
      stack.ledger.close()
    }
  })
})
