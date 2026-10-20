/**
 * instructions-channel —— bridge 通道（agents_md=user_level）派发落盘/env 目标/清理策略单测
 *
 * 依据（实现单引用）：docs/25-§3.1 v1.5 裁决#1（STUDIO_NEXT_INSTRUCTIONS 插件通道——
 * daemon 落每任务指令临时文件→适配器注 env→dsh-bridge 消费）；docs/04-§六（落点规则/
 * 生成物标记）；清理策略=保留至收割完成再删（engine.ts Inflight.instructionsPath 注）。
 *
 * 断言面（fake 路径——真机端到端归套外 bridge-e2e 证据包）：
 *   1. 能力路由：agents_md='user_level' 的 executor 派发时指令落 <rootDir>/tmp/instructions/
 *      <单号>.md（0600、workspace 外、生成物横幅+六层定界原样），workspace **无** AGENTS.md；
 *      TaskBrief.AGENTS_MD={channel:'user_level',target=该路径}（onLaunch 回显替身断言）；
 *      DISPATCH note 携 agents=<该路径>（审计锚）。
 *   2. 清理-成功面：GATE_PASS 收割后文件删除。
 *   3. 清理-失败面：GATE_FAIL（no_report 四要件缺）收割后文件同样删除。
 *   4. 清理-拒派面：预算拒派（估算超帽）即删（无收割会来收本 attempt）。
 *   5. native 对照：agents_md='native'（fake 缺省）行为不变——AGENTS.md 落 workspace 根、
 *      收割后保留（工位证据）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type {
  CompanySnapshot,
  ExecutorAdapter,
  ExecutorCapabilities,
  FlowPlatform,
  PersonRef,
  TaskBrief,
} from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode, type FakeAdapterOptions } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { instructionsTarget } from '../../src/engine/instructions-store.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'e2e@studio-next.invalid',
}
const T0 = Date.parse('2026-10-19T00:00:00.000Z')

let root = ''
let snapshot: CompanySnapshot

/** 能力通道覆盖包装（路由面零 if executor：只改 capabilities.agents_md，行为全委托 fake） */
function withChannel(
  mode: FakeAdapterMode | undefined,
  channel: ExecutorCapabilities['agents_md'],
  opts?: FakeAdapterOptions,
): ExecutorAdapter {
  const base = createFakeAdapter({ ...(mode !== undefined ? { mode } : {}), ...opts })
  return {
    name: base.name,
    capabilities: { ...base.capabilities, agents_md: channel },
    detect: () => base.detect(),
    estimate: (t) => base.estimate(t),
    launch: (t) => base.launch(t),
    stream: (h) => base.stream(h),
    resultStats: (h) => base.resultStats(h),
    kill: (h, g) => base.kill(h, g),
  }
}

interface Stack {
  platform: FlowPlatform
  engine: Engine
  ledger: Ledger
  clock: { advance(ms: number): void }
  rootDir: string
}

function buildStack(id: string, adapter: ExecutorAdapter, budgetTicketCapUsd?: number): Stack {
  const rootDir = path.join(root, id)
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(adapter, { default: true })
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
    gateRunner: createDefaultGateRunner(),
    clock: (): number => t,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir,
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd } : {}),
    },
    people: snapshot.people,
  })
  return { platform, engine, ledger, clock, rootDir }
}

async function putTicket(stack: Stack, title: string): Promise<string> {
  const created = await stack.platform.issues.create({
    title,
    type: 'task',
    dept: snapshot.departments[0]?.path,
    level: 0,
    assignee: snapshot.people[0]?.id,
  })
  return created.id
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-instr-channel-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('bridge 通道（agents_md=user_level）：落盘/env 目标/清理', () => {
  const launchedBriefs: TaskBrief[] = []
  let stack: Stack
  let ticket = ''

  beforeAll(() => {
    stack = buildStack(
      'bridge-chain',
      withChannel('ok', 'user_level', { onLaunch: (t) => launchedBriefs.push(t) }),
    )
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('tick1 派发：指令临时文件落盘（0600/横幅/六层定界），workspace 无 AGENTS.md，TaskBrief.AGENTS_MD 指向它', async () => {
    ticket = await putTicket(stack, 'bridge 通道单：demo 交付')
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)

    const instr = instructionsTarget(stack.rootDir, ticket)
    expect(existsSync(instr)).toBe(true)
    expect(statSync(instr).mode & 0o777).toBe(0o600)
    const text = readFileSync(instr, 'utf8')
    expect(text).toContain('Studio Next 生成物：勿手改') // 04-§六 生成物标记（组装产物自带）
    expect(text).toContain('<!-- LAYER:L0:BEGIN -->')
    expect(text).toContain('<!-- LAYER:L5:END -->')
    // workspace 外：工位只有 brief.md（无 AGENTS.md——落点已按通道路由改道）
    const workspace = path.join(stack.rootDir, 'workspaces', ticket, 'att1')
    expect(existsSync(path.join(workspace, 'brief.md'))).toBe(true)
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(false)

    // TaskBrief.AGENTS_MD（onLaunch 回显替身——真实面=适配器注 env STUDIO_NEXT_INSTRUCTIONS）
    expect(launchedBriefs).toHaveLength(1)
    expect(launchedBriefs[0]?.AGENTS_MD).toStrictEqual({ channel: 'user_level', target: instr })

    // DISPATCH note 审计锚
    const dispatch = stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).toContain(`agents=${instr}`)
  })

  it('tick2 收割 GATE_PASS：指令临时文件已清理（保留至收割完成再删）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.harvest.completed).toBe(1)
    expect(existsSync(instructionsTarget(stack.rootDir, ticket))).toBe(false)
  })
})

describe('清理-失败面：GATE_FAIL（no_report）收割后同删', () => {
  it('四要件缺 → GATE_FAIL + 文件删除', async () => {
    const stack = buildStack('bridge-fail', withChannel('no_report', 'user_level'))
    const ticket = await putTicket(stack, '失败面单：worker 不交报告')
    stack.clock.advance(1000)
    await stack.engine.tick()
    const instr = instructionsTarget(stack.rootDir, ticket)
    expect(existsSync(instr)).toBe(true)
    stack.clock.advance(1000)
    const report2 = await stack.engine.tick()
    expect(report2.phases.harvest.failed).toBe(1)
    expect(existsSync(instr)).toBe(false) // 收割完成（失败面）即删
    stack.ledger.close()
  })
})

describe('清理-拒派面：预算拒派即删（无收割会来收本 attempt）', () => {
  it('估算 $0.01 超帽 $0.001 → refusal 不派 + 文件删除 + refusal 行留痕', async () => {
    const stack = buildStack('bridge-refused', withChannel('ok', 'user_level'), 0.001)
    const ticket = await putTicket(stack, '拒派面单：预算超帽')
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.budgetRefused).toBe(1)
    expect(existsSync(instructionsTarget(stack.rootDir, ticket))).toBe(false) // 拒派即删
    const refusals = stack.ledger
      .queryBudgets({ scope_kind: 'issue', scope_id: ticket })
      .filter((b) => b.kind === 'refusal')
    expect(refusals).toHaveLength(1) // 不派但留痕（F1-09）
    stack.ledger.close()
  })
})

describe('native 对照：agents_md=native 行为不变（AGENTS.md 落 workspace 根、收割后保留）', () => {
  it('fake 缺省通道——workspace AGENTS.md 在、无指令临时文件、收割后仍在', async () => {
    const stack = buildStack('native-ctrl', withChannel('ok', 'native'))
    const ticket = await putTicket(stack, 'native 对照单')
    stack.clock.advance(1000)
    await stack.engine.tick()
    const workspace = path.join(stack.rootDir, 'workspaces', ticket, 'att1')
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(true)
    expect(existsSync(instructionsTarget(stack.rootDir, ticket))).toBe(false)
    stack.clock.advance(1000)
    await stack.engine.tick()
    expect(existsSync(path.join(workspace, 'AGENTS.md'))).toBe(true) // 工位证据保留
    stack.ledger.close()
  })
})
