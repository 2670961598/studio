/**
 * worker-key 生命周期 e2e —— daemon 侧 wkey 闭环的引擎级断言（17-§7「按单签发→随派发注入→关单吊销」）
 *
 * 覆盖面（实现单验收口径）：
 *   1. dispatch：预算过闸后 launch 前签发——workspace `.studio-next/wkey`（0600）随派发出现、
 *      token 经签发实例 authority 可验（scope 六动词全集）、brief.md 追加指引行、DISPATCH note 携 wkey 路径
 *   2. 预算拒派不签发（超帽 refusal 无凭据落盘——不给不派的工签钥匙）
 *   3. GATE_FAIL：旧 attempt 凭据文件删（非终局不吊销 ticket——吊销粒度裁决，见 worker-key.ts
 *      头注）；重派重签（att2 新 token ≠ att1 旧 token，nonce 链干净）
 *   4. 断路熔断：3 连击 ESCALATE（终局）吊销该时刻 key；HOLD_BREAKER_OPEN 停重派不再签新 key
 *   5. GATE_PASS 后 key 存续（关单才吊销——frozen 口径）；CLOSE：吊销+文件随关单消失+CLOSE note 记账
 *   6. workerKeys 未注入（缺省）：零行为变更（无 .studio-next 目录）
 *   7. studio-tools 打通：fake worker 读 wkey 文件 → MCP initialize _meta['studio-wkey'] 注入 →
 *      comment 工具成功（真协议链路 InMemoryTransport）→ 关单吊销后再调 → gw-verify-revoked
 *      （17-§7「关单即吊销，杜绝归档后仍有效」的可执行证明）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { Transport } from '@modelcontextprotocol/server'
import { createRegistry } from '@studio-next/adapters'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import type { Gateway } from '@studio-next/gateway'
import { createStudioToolsServer } from '@studio-next/studio-tools'
import type { StudioToolsServer } from '@studio-next/studio-tools'
import type { CompanySnapshot, FlowPlatform, GatewayAction, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { createDefaultGateRunner, type GateOutcome, type GateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'
import { readWorkerKeyFile, workerKeyFilePath } from '../src/worker-key.ts'

const T0 = Date.parse('2026-10-16T00:00:00.000Z')
const SECRET = new Uint8Array(32).fill(5)

/** 手搓公司快照（serve.ts DEMO_SNAPSHOT 同形——不起 git init，本文件只测 wkey 面） */
const SNAPSHOT: CompanySnapshot = {
  slug: 'wk-corp',
  name: 'Wkey 生命周期公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

/** 恒红闸门（收割四要件第 4 条永不满足——GATE_FAIL/断路面注入） */
const RED_GATE: GateRunner = {
  async run(input): Promise<GateOutcome> {
    return { exitCode: 1, reportExists: true, reportPath: path.join(input.workspace, 'REPORT.md'), note: 'test 注入：验收红' }
  },
}

/** 确定性 ULID（contract UlidSchema 合法形） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface Stack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  gateway: Gateway
  clock: { now(): number; advance(ms: number): void }
  rootDir: string
}

interface StackOptions {
  gateRunner?: GateRunner
  /** worker key 签发实例（缺省不注入=关闭面；verify 断言走 gateway.authority.verify） */
  workerGateway?: Gateway
  budgetTicketCapUsd?: number
}

function buildStack(id: string, opts?: StackOptions): Stack {
  const rootDir = path.join(root, id)
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const person = SNAPSHOT.people[0] as PersonRef
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.7-wkey-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§7（wkey 按单签发、关单吊销）'],
    }),
    gateRunner: opts?.gateRunner ?? createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: SNAPSHOT.slug,
      rootDir,
      defaultPersonId: person.id,
      deptFallback: SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
      defaultLane: SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: opts.budgetTicketCapUsd } : {}),
    },
    people: SNAPSHOT.people,
    makeId: deterministicIds(),
    ...(opts?.workerGateway !== undefined ? { workerKeys: { gateway: opts.workerGateway } } : {}),
  })
  return { platform, ledger, engine, gateway: opts?.workerGateway ?? createGateway({ secret: SECRET, clock: clock.now, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }), clock, rootDir }
}

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-worker-key-e2e-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** workspace 路径：`<rootDir>/workspaces/<ticket>/att<N>`（engine 冻结形态） */
function ws(stack: Stack, ticket: string, attempt: number): string {
  return path.join(stack.rootDir, 'workspaces', ticket, `att${attempt}`)
}

function verify(stack: Stack, token: string, ticket: string, action: GatewayAction = 'comment') {
  return stack.gateway.authority.verify(token, { now: stack.clock.now(), ticket, action })
}

// ---------------------------------------------------------------------------
// 1-2：dispatch 签发面与预算拒派面
// ---------------------------------------------------------------------------

describe('dispatch 相位：签发与注入（launch 前）', () => {
  let stack: Stack

  beforeAll(() => {
    stack = buildStack('dispatch', { workerGateway: createGateway({ secret: SECRET, clock: (): number => T0, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }) })
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('随派发出现：`.studio-next/wkey`（0600）落 workspace，token 可验、scope 六动词全集，brief 携指引行，DISPATCH note 记 wkey 路径', async () => {
    await stack.platform.issues.create({ title: 'wkey 签发面', type: 'task', level: 0, assignee: 'AGENT-1' })
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)

    const filePath = workerKeyFilePath(ws(stack, 'T-1', 1))
    expect(existsSync(filePath)).toBe(true)
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(readFileSync(filePath, 'utf8')).toMatch(/^STUDIO_TOOLS_WKEY=[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+\n$/)

    const token = readWorkerKeyFile(ws(stack, 'T-1', 1))
    expect(token).toBeDefined()
    const v = verify(stack, token as string, 'T-1')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.claims.scope).toHaveLength(6)

    // 任务书追加指引行（worker 从文件读凭据的一句话指引）
    expect(readFileSync(path.join(ws(stack, 'T-1', 1), 'brief.md'), 'utf8')).toContain('.studio-next/wkey')
    expect(readFileSync(path.join(ws(stack, 'T-1', 1), 'brief.md'), 'utf8')).toContain('studio-wkey')

    // DISPATCH note 携 wkey 文件路径（审计锚）
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).toContain(`;wkey=${filePath}`)
  })
})

describe('预算拒派不签发（超帽 refusal 无凭据落盘）', () => {
  it('估算 $0.01 超帽 $0.001 → refusal 行落账不派，workspace 无 `.studio-next`（不给不派的工签钥匙）', async () => {
    const stack = buildStack('budget-refuse', {
      workerGateway: createGateway({ secret: SECRET, clock: (): number => T0, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }),
      budgetTicketCapUsd: 0.001,
    })
    await stack.platform.issues.create({ title: '超帽单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.budgetRefused).toBe(1)
    expect(existsSync(path.join(ws(stack, 'T-1', 1), '.studio-next'))).toBe(false)
    stack.ledger.close()
  })
})

// ---------------------------------------------------------------------------
// 3-4：GATE_FAIL 轮换与断路吊销
// ---------------------------------------------------------------------------

describe('GATE_FAIL：凭据撤离+重派重签（一 attempt 一 key，nonce 链干净）', () => {
  let stack: Stack

  beforeAll(() => {
    stack = buildStack('rotation', {
      gateRunner: RED_GATE,
      workerGateway: createGateway({ secret: SECRET, clock: (): number => T0, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }),
    })
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('att1 派发取 token → 收割失败 → 旧 attempt 文件删（不吊销 ticket——吊销粒度裁决）+ GATE_FAIL note 记撤离；重派 att2 → 新 token 有效且 ≠ 旧 token', async () => {
    await stack.platform.issues.create({ title: '会重派的单', type: 'task', level: 0 })

    // att1：派发（key 落盘）→ 收割失败（凭据撤离+文件删；非终局不吊销——重签 key 须活）
    stack.clock.advance(1000)
    await stack.engine.tick()
    const token1 = readWorkerKeyFile(ws(stack, 'T-1', 1))
    expect(token1).toBeDefined()
    stack.clock.advance(1000)
    const failTick = await stack.engine.tick()
    expect(failTick.phases.harvest.failed).toBe(1)
    expect(existsSync(workerKeyFilePath(ws(stack, 'T-1', 1)))).toBe(false)
    const gateFail = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_FAIL')
    expect(gateFail?.note).toContain(';wkey=file-removed')

    // att2：重派重签（新 attempt 新 workspace 新 key，可用——旧 key 若被吊销则新 key 同死）
    stack.clock.advance(1000)
    await stack.engine.tick()
    const token2 = readWorkerKeyFile(ws(stack, 'T-1', 2))
    expect(token2).toBeDefined()
    expect(token2).not.toBe(token1)
    const v2 = verify(stack, token2 as string, 'T-1')
    expect(v2.ok).toBe(true)
  })
})

describe('断路熔断：3 连击 ESCALATE 后终局吊销、停重派不再签新 key', () => {
  it('前两轮 key 撤离不吊销；第三轮熔断（终局）吊销该时刻 key；HOLD_BREAKER_OPEN 无 att4 签发', async () => {
    const stack = buildStack('breaker', {
      gateRunner: RED_GATE,
      workerGateway: createGateway({ secret: SECRET, clock: (): number => T0, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }),
    })
    await stack.platform.issues.create({ title: '会熔断的单', type: 'task', level: 0 })

    const tokens: string[] = []
    for (let round = 1; round <= 3; round += 1) {
      stack.clock.advance(1000)
      const dispatchTick = await stack.engine.tick()
      expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
      const token = readWorkerKeyFile(ws(stack, 'T-1', round))
      expect(token).toBeDefined()
      tokens.push(token as string)

      stack.clock.advance(1000)
      const harvestTick = await stack.engine.tick()
      expect(harvestTick.phases.harvest.failed).toBe(1)
    }

    // 熔断已开（ESCALATE + bug 单 + 终局吊销记账）：第三轮 key 死亡
    const escalate = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'ESCALATE')
    expect(escalate).toBeDefined()
    expect(escalate?.note).toContain('wkey=revoked（终局吊销）')
    expect(verify(stack, tokens[2] as string, 'T-1')).toEqual({ ok: false, reason: 'revoked' })

    // 停重派：无第 4 次签发（无 att4 workspace）
    stack.clock.advance(1000)
    const held = await stack.engine.tick()
    expect(held.phases.stateDiff.decisions.find((d) => d.ticket === 'T-1')?.code).toBe('HOLD_BREAKER_OPEN')
    expect(existsSync(ws(stack, 'T-1', 4))).toBe(false)
    stack.ledger.close()
  })
})

// ---------------------------------------------------------------------------
// 5-6：GATE_PASS 存续 / CLOSE 收口 / 缺省关闭面
// ---------------------------------------------------------------------------

describe('GATE_PASS 存续与 CLOSE 收口（关单即吊销）', () => {
  let stack: Stack
  let token: string | undefined

  beforeAll(() => {
    stack = buildStack('close', {
      workerGateway: createGateway({ secret: SECRET, clock: (): number => T0, ticket: CONTROL_TICKET, ctx: { company: SNAPSHOT.name, dept: 'departments/工程部', role: 'daemon', level: 2 }, author: 'daemon' }),
    })
  })

  afterAll(() => {
    stack.ledger.close()
  })

  it('tick1 派发：key 落盘', async () => {
    await stack.platform.issues.create({ title: '全链单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    await stack.engine.tick()
    token = readWorkerKeyFile(ws(stack, 'T-1', 1))
    expect(token).toBeDefined()
  })

  it('tick2 GATE_PASS：key 仍有效（验收/复验窗口内存续——关单才吊销）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.harvest.completed).toBe(1)
    expect(verify(stack, token as string, 'T-1').ok).toBe(true)
  })

  it('tick3-4 QA_PASS/MERGE：文件仍在（未到关单）', async () => {
    stack.clock.advance(1000)
    await stack.engine.tick()
    stack.clock.advance(1000)
    await stack.engine.tick()
    expect(existsSync(workerKeyFilePath(ws(stack, 'T-1', 1)))).toBe(true)
  })

  it('tick5 CLOSE：吊销+文件随关单消失+CLOSE note 记账（17-§7「杜绝归档后仍有效」）', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.recycle.recycled).toBe(1)
    expect(existsSync(workerKeyFilePath(ws(stack, 'T-1', 1)))).toBe(false)
    // revoked 先于 replay 判定：nonce 已烧（tick2 verify 过）仍得 revoked——吊销是权威面
    expect(verify(stack, token as string, 'T-1')).toEqual({ ok: false, reason: 'revoked' })
    const close = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'CLOSE')
    expect(close?.note).toContain('wkey=关单吊销')
  })
})

describe('workerKeys 未注入（缺省关闭面）：零行为变更', () => {
  it('dispatch 后无 `.studio-next` 目录、DISPATCH note 无 wkey 字段（回归锚）', async () => {
    const stack = buildStack('default-off')
    await stack.platform.issues.create({ title: '缺省面单', type: 'task', level: 0 })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    expect(existsSync(path.join(ws(stack, 'T-1', 1), '.studio-next'))).toBe(false)
    const dispatch = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).not.toContain(';wkey=')
    expect(readFileSync(path.join(ws(stack, 'T-1', 1), 'brief.md'), 'utf8')).not.toContain('.studio-next/wkey')
    stack.ledger.close()
  })
})

// ---------------------------------------------------------------------------
// 7：studio-tools 打通（真协议链路：InMemoryTransport + initialize _meta 注入）
// ---------------------------------------------------------------------------

interface RawToolResult {
  isError?: boolean
  structuredContent?: unknown
}

/** 手搓极简 MCP 客户端（studio-tools server.test.ts 同款手法：initialize 握手 + tools/call） */
async function connectWorkerClient(server: StudioToolsServer, wkey: string): Promise<{ callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult> ; close(): Promise<void> }> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const pending = new Map<number, (msg: unknown) => void>()
  let nextId = 1
  const transport: Transport = clientT
  transport.onmessage = (msg) => {
    const m = msg as { id?: number }
    if (m !== null && typeof m === 'object' && 'id' in m && m.id !== undefined && pending.has(m.id)) {
      const resolve = pending.get(m.id)
      pending.delete(m.id)
      resolve?.(msg)
    }
  }
  const request = <T>(method: string, params: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, (msg) => {
        const m = msg as { result?: T; error?: { message?: string } }
        if (m.error !== undefined) reject(new Error(`${method}: ${m.error.message ?? 'JSON-RPC error'}`))
        else resolve(m.result as T)
      })
      void transport.send({ jsonrpc: '2.0', id, method, params })
    })
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fake-worker', version: '0.0.0' },
    _meta: { 'studio-wkey': wkey },
  })
  void transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    callTool: (name, args) => request<RawToolResult>('tools/call', { name, arguments: args }),
    close: () => transport.close(),
  }
}

describe('studio-tools 打通：wkey 文件 → MCP _meta 注入 → comment 成功 → 关单吊销后拒调', () => {
  it('全链：派发签发 → fake worker 读文件过 initialize → comment 过真网关 → CLOSE 吊销 → 再调 gw-verify-revoked', async () => {
    // 单先建（ticket id 已知）→ per-ticket 网关（签发/吊销/验签三面同一实例——worker 侧 studio-tools
    // server 与 daemon 签发共享，关单吊销对 worker 进程内即时可见）
    const ledger = openLedger(path.join(root, 'mcp.sqlite'))
    let t = T0
    const clock = { now: (): number => t }
    const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
    await platform.issues.create({ title: 'MCP 打通单', type: 'task', level: 0, assignee: 'AGENT-1' })
    const person = SNAPSHOT.people[0] as PersonRef
    const gateway = createGateway({
      secret: SECRET,
      clock: clock.now,
      ticket: 'T-1',
      ctx: { company: SNAPSHOT.name, dept: person.dept ?? 'departments/工程部', role: person.name, level: person.level },
      author: person.id,
    })
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.7-wkey-test',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot: SNAPSHOT,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§7（wkey 按单签发、关单吊销）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: clock.now,
      config: { ...ENGINE_CONFIG_DEFAULTS, company: SNAPSHOT.slug, rootDir: path.join(root, 'mcp'), defaultPersonId: person.id, deptFallback: 'departments/工程部', defaultLane: 'core' },
      people: SNAPSHOT.people,
      makeId: deterministicIds(),
      workerKeys: { gateway },
    })
    // worker 侧 MCP server（六工具注册面 + initialize _meta 捕获；deps 只需构造面）
    const server = createStudioToolsServer({
      gateway,
      deps: {
        writeEvidence: async () => ({ bytes: 0 }),
        searchKb: async () => [],
        queryBudget: async () => ({ issue: 'T-1', reserved: 0, settled: 0, remaining: 0 }),
      },
    })

    // tick1 派发：wkey 文件出现（fake worker 的「读凭据」动作）
    t += 1000
    const dispatchTick = await engine.tick()
    expect(dispatchTick.errors).toEqual([])
    const wkey = readWorkerKeyFile(path.join(root, 'mcp', 'workspaces', 'T-1', 'att1'))
    expect(wkey).toBeDefined()

    // fake worker：initialize _meta 注入 → comment 成功（真协议链路 + 真网关验签署名）
    const client = await connectWorkerClient(server, wkey as string)
    const okCall = await client.callTool('comment', { issue: 'T-1', body: '进展：wkey 链路已通' })
    expect(okCall.isError).toBeFalsy()
    expect(okCall.structuredContent).toMatchObject({ ok: true, action: 'comment', author: 'AGENT-1' })

    // 推进到关单（收割→QA→MERGE→CLOSE 五拍走完）
    for (let i = 0; i < 4; i += 1) {
      t += 1000
      await engine.tick()
    }
    expect(ledger.queryEvents({ issue: 'T-1' }).map((e) => e.event)).toContain('CLOSE')

    // 关单后再调：gw-verify-revoked（吊销先于重放判定——归档后凭据死亡的可执行证明）
    const denied = await client.callTool('comment', { issue: 'T-1', body: '归档后补一句' })
    expect(denied.isError).toBe(true)
    expect(denied.structuredContent).toMatchObject({ ok: false, error: { category: 'gateway', subcause: 'gw-verify-revoked' } })
    await client.close()
    ledger.close()
  })
})
