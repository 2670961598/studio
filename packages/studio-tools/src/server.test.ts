/**
 * MCP server 工厂测试 —— 进程内协议级（InMemoryTransport + 手搓极简 JSON-RPC 客户端）
 *
 * 不起真 stdio（不引 @modelcontextprotocol/client——新依赖纪律仅 @modelcontextprotocol/server）。
 * 驱动真实协议层：schema 校验、initialize 握手 _meta 捕获、tools/call 结构化输出全走真链路。
 *
 * 冻结验收（docs/24-§二）：
 *   - 六工具 happy path：gateWrite 收到正确 action + 单行 @action payload（真网关署名链）
 *   - 无 key/坏 key/坏签名/scope 外/过期/重放 → 全部 fail-closed 两级分类拒绝
 *   - 坏输入由协议层拒（isError，不进 handler、不碰网关）
 *   - tools/list 广告面与 GATEWAY_ACTIONS 完全一致（防漂移第二道钉）
 *   - deps 失败归类 deps 族
 */
import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { Transport } from '@modelcontextprotocol/server'
import { createGateway } from '@studio-next/gateway'
import type { Gateway } from '@studio-next/gateway'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'
import { randomUUID } from 'node:crypto'
import { createStudioToolsServer } from './server.ts'
import type { StudioToolsServer } from './server.ts'
import type { KbHit, StudioToolsDeps, ToolErrorCategory } from './tools.ts'

// ---------------------------------------------------------------------------
// 夹具：真网关（纯逻辑）+ 记录代理 + 注入 deps
// ---------------------------------------------------------------------------

const SECRET = new Uint8Array(32).fill(7)
const SIG_CTX = { company: '演示公司', dept: '平台部', role: '工程师', level: 3 }
const EXPECT_SIG = '[演示公司·平台部·工程师·3]'

interface GateCall {
  readonly action: GatewayAction
  readonly payload: string
}

/** 记录代理：断言 gateWrite 收到的 action/payload，鉴权语义全走真网关 */
function recordingGateway(inner: Gateway): { gateway: Gateway; calls: GateCall[] } {
  const calls: GateCall[] = []
  const gateway: Gateway = {
    ...inner,
    gateWrite: (token, action, payload) => {
      calls.push({ action, payload })
      return inner.gateWrite(token, action, payload)
    },
  }
  return { gateway, calls }
}

interface DepsLog {
  readonly evidence: Array<{ path: string; content: string }>
  readonly queries: string[]
  readonly budgets: string[]
}

function fakeDeps(log: DepsLog, failures?: Partial<Record<'evidence' | 'search' | 'budget', Error>>): StudioToolsDeps {
  return {
    writeEvidence: async (path, content) => {
      if (failures?.evidence) throw failures.evidence
      log.evidence.push({ path, content })
      return { bytes: content.length }
    },
    searchKb: async (query) => {
      if (failures?.search) throw failures.search
      log.queries.push(query)
      const hits: KbHit[] = [{ path: 'kb/lessons/cursor.md', score: 0.9, snippet: `命中：${query}` }]
      return hits
    },
    queryBudget: async (issue) => {
      if (failures?.budget) throw failures.budget
      log.budgets.push(issue)
      return { issue, reserved: 1.0, settled: 0.25, remaining: 0.75 }
    },
  }
}

interface Fixture {
  server: StudioToolsServer
  calls: GateCall[]
  log: DepsLog
  issueKey(scope?: readonly GatewayAction[], ttl?: string): string
  tick(minutes: number): void
}

/** 每测试一套全新夹具（wkey nonce 单次有效 → 互不复用） */
function makeFixture(opts?: { wkey?: string; deps?: StudioToolsDeps }): Fixture {
  let now = 1_000_000_000_000
  const gateway = createGateway({ secret: SECRET, clock: () => now, ticket: 'T-1', ctx: SIG_CTX, author: 'P-1' })
  const rec = recordingGateway(gateway)
  const log: DepsLog = { evidence: [], queries: [], budgets: [] }
  const server = createStudioToolsServer({
    gateway: rec.gateway,
    deps: opts?.deps ?? fakeDeps(log),
    ...(opts?.wkey !== undefined ? { wkey: opts.wkey } : {}),
  })
  return {
    server,
    calls: rec.calls,
    log,
    issueKey: (scope, ttl = '30m') =>
      rec.gateway.issue({
        ticket: 'T-1',
        scope: scope === undefined ? [...GATEWAY_ACTIONS] : [...scope],
        ttl,
        nonce: randomUUID(),
      }),
    tick: (minutes) => {
      now += minutes * 60_000
    },
  }
}

// ---------------------------------------------------------------------------
// 手搓极简 MCP 客户端（只够测试用：initialize + tools/call + tools/list）
// ---------------------------------------------------------------------------

interface RawToolResult {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

interface MiniClient {
  callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult>
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>
  close(): Promise<void>
}

async function connectClient(server: StudioToolsServer, initMeta?: Record<string, unknown>): Promise<MiniClient> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const pending = new Map<number, (msg: unknown) => void>()
  let nextId = 1
  const transport: Transport = clientT
  transport.onmessage = (msg) => {
    const m = msg as { id?: number; result?: unknown; error?: unknown }
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

  const initParams: Record<string, unknown> = {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'studio-tools-test', version: '0.0.0' },
  }
  if (initMeta !== undefined) initParams._meta = initMeta
  await request('initialize', initParams)
  void transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  return {
    callTool: (name, args) => request<RawToolResult>('tools/call', { name, arguments: args }),
    listTools: async () => {
      const r = await request<{ tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }>('tools/list', {})
      return r.tools ?? []
    },
    close: () => transport.close(),
  }
}

// ---------------------------------------------------------------------------
// 断言辅助
// ---------------------------------------------------------------------------

function expectOk(res: RawToolResult, action: GatewayAction): Record<string, unknown> {
  expect(res.isError).toBeFalsy()
  expect(res.structuredContent).toMatchObject({ ok: true, action })
  return res.structuredContent as Record<string, unknown>
}

function expectDeny(res: RawToolResult, category: ToolErrorCategory, subcause: string): void {
  expect(res.isError).toBe(true)
  expect(res.structuredContent).toMatchObject({ ok: false, error: { category, subcause } })
}

/** 首行 @action <verb> <json> 与参数逐一对应（与 actions.ts 冻结格式对齐） */
function expectGateCall(call: GateCall | undefined, action: GatewayAction, args: Record<string, unknown>): void {
  expect(call).toBeDefined()
  expect(call!.action).toBe(action)
  expect(call!.payload.startsWith(`@action ${action} `)).toBe(true)
  expect(call!.payload.includes('\n')).toBe(false) // 单行
  expect(JSON.parse(call!.payload.slice(`@action ${action} `.length))).toEqual(args)
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('六工具 happy path（真网关链路）', () => {
  it('comment：gateWrite 收 comment + 署名回执', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('comment', { issue: 'T-1', body: '进展：地基完成' })
    const sc = expectOk(res, 'comment')
    expect(sc.author).toBe('P-1')
    expect(sc.signature).toBe(EXPECT_SIG)
    expectGateCall(f.calls[0], 'comment', { issue: 'T-1', body: '进展：地基完成' })
    await c.close()
  })

  it('heartbeat：gateWrite 收 heartbeat', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('heartbeat', { issue: 'T-1' })
    expectOk(res, 'heartbeat')
    expectGateCall(f.calls[0], 'heartbeat', { issue: 'T-1' })
    await c.close()
  })

  it('article：gateWrite 收 article + path 回执', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('article', { path: 'kb/lessons/cursor.md', markdown: '# 游标语义\nsince(null)=最旧页' })
    const sc = expectOk(res, 'article')
    expect(sc.path).toBe('kb/lessons/cursor.md')
    expect(sc.signature).toBe(EXPECT_SIG)
    expectGateCall(f.calls[0], 'article', { path: 'kb/lessons/cursor.md', markdown: '# 游标语义\nsince(null)=最旧页' })
    await c.close()
  })

  it('kb-search：gateWrite 收 kb-search + deps 命中透传', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('kb-search', { query: '游标 语义' })
    const sc = expectOk(res, 'kb-search')
    expect(sc.hits).toEqual([{ path: 'kb/lessons/cursor.md', score: 0.9, snippet: '命中：游标 语义' }])
    expect(f.log.queries).toEqual(['游标 语义'])
    expectGateCall(f.calls[0], 'kb-search', { query: '游标 语义' })
    await c.close()
  })

  it('evidence-write：gateWrite 收 evidence-write + deps 落盘', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const content = '# REPORT\n- typecheck 绿\n- test 绿'
    const res = await c.callTool('evidence-write', { path: 'evidence/REPORT.md', content })
    const sc = expectOk(res, 'evidence-write')
    expect(sc.bytes).toBe(content.length)
    expect(f.log.evidence).toEqual([{ path: 'evidence/REPORT.md', content }])
    expectGateCall(f.calls[0], 'evidence-write', { path: 'evidence/REPORT.md', content })
    await c.close()
  })

  it('budget-query：gateWrite 收 budget-query + 预算视图透传', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('budget-query', { issue: 'T-1' })
    const sc = expectOk(res, 'budget-query')
    expect(sc.view).toEqual({ issue: 'T-1', reserved: 1.0, settled: 0.25, remaining: 0.75 })
    expectGateCall(f.calls[0], 'budget-query', { issue: 'T-1' })
    await c.close()
  })
})

describe('tools/list 广告面（防漂移第二道钉）', () => {
  it('与 GATEWAY_ACTIONS 同名同序，且描述齐备、schema 是 object 形', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const tools = await c.listTools()
    expect(tools.map((t) => t.name)).toEqual([...GATEWAY_ACTIONS])
    for (const t of tools) {
      expect((t.description ?? '').length).toBeGreaterThan(8)
      expect((t.inputSchema as { type?: string }).type).toBe('object')
    }
    await c.close()
  })
})

describe('fail-closed：无 key 全工具拒', () => {
  it('initialize 不带 wkey → 六工具全部 auth/missing-wkey，不碰网关不碰 deps', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server)
    const args: Record<GatewayAction, Record<string, unknown>> = {
      comment: { issue: 'T-1', body: 'x' },
      heartbeat: { issue: 'T-1' },
      article: { path: 'a.md', markdown: 'x' },
      'kb-search': { query: 'x' },
      'evidence-write': { path: 'a.md', content: 'x' },
      'budget-query': { issue: 'T-1' },
    }
    for (const name of GATEWAY_ACTIONS) {
      const res = await c.callTool(name, args[name])
      expectDeny(res, 'auth', 'missing-wkey')
    }
    expect(f.calls).toHaveLength(0)
    expect(f.log.evidence).toHaveLength(0)
    expect(f.log.queries).toHaveLength(0)
    expect(f.log.budgets).toHaveLength(0)
    await c.close()
  })

  it('initialize _meta 的 wkey 为非字符串 → 忽略，全工具 fail-closed', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': 12345 })
    const res = await c.callTool('comment', { issue: 'T-1', body: 'x' })
    expectDeny(res, 'auth', 'missing-wkey')
    expect(f.calls).toHaveLength(0)
    await c.close()
  })
})

describe('fail-closed：坏 key 与网关拒绝码透传', () => {
  it('垃圾 wkey → gateway/gw-verify-malformed', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': 'garbage-not-a-token' })
    expectDeny(await c.callTool('comment', { issue: 'T-1', body: 'x' }), 'gateway', 'gw-verify-malformed')
    await c.close()
  })

  it('异密签发的 wkey → gateway/gw-verify-bad-signature', async () => {
    const f = makeFixture()
    const rogue = createGateway({
      secret: new Uint8Array(32).fill(9),
      clock: () => 1_000_000_000_000,
      ticket: 'T-1',
      ctx: SIG_CTX,
      author: 'P-9',
    })
    const rogueToken = rogue.issue({ ticket: 'T-1', scope: ['comment'], ttl: '30m', nonce: randomUUID() })
    const c = await connectClient(f.server, { 'studio-wkey': rogueToken })
    expectDeny(await c.callTool('comment', { issue: 'T-1', body: 'x' }), 'gateway', 'gw-verify-bad-signature')
    await c.close()
  })

  it('scope 外动作 → gateway/gw-verify-scope', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey(['comment']) })
    expectDeny(await c.callTool('kb-search', { query: 'x' }), 'gateway', 'gw-verify-scope')
    await c.close()
  })

  it('过期 wkey → gateway/gw-verify-expired', async () => {
    const f = makeFixture()
    const token = f.issueKey(undefined, '10m')
    f.tick(11)
    const c = await connectClient(f.server, { 'studio-wkey': token })
    expectDeny(await c.callTool('heartbeat', { issue: 'T-1' }), 'gateway', 'gw-verify-expired')
    await c.close()
  })

  it('同 wkey 二次调用 → gateway/gw-verify-replay（钉现行「一调用一签发」语义）', async () => {
    const f = makeFixture()
    const token = f.issueKey()
    const c = await connectClient(f.server, { 'studio-wkey': token })
    expectOk(await c.callTool('comment', { issue: 'T-1', body: '第一次' }), 'comment')
    expectDeny(await c.callTool('comment', { issue: 'T-1', body: '第二次' }), 'gateway', 'gw-verify-replay')
    await c.close()
  })
})

describe('格式错误由协议层拒绝（不进 handler、不碰网关）', () => {
  it('comment 空 body → isError，网关零调用', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('comment', { issue: 'T-1', body: '' })
    expect(res.isError).toBe(true)
    expect(f.calls).toHaveLength(0)
    await c.close()
  })

  it('多余字段（strictObject）→ isError', async () => {
    const f = makeFixture()
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    const res = await c.callTool('kb-search', { query: 'x', limit: 10 })
    expect(res.isError).toBe(true)
    expect(f.calls).toHaveLength(0)
    await c.close()
  })
})

describe('deps 失败归类 deps 族（不伪造不隐瞒）', () => {
  it('writeEvidence 抛错 → deps/evidence-write-failed', async () => {
    const log: DepsLog = { evidence: [], queries: [], budgets: [] }
    const f = makeFixture({ deps: fakeDeps(log, { evidence: new Error('磁盘只读') }) })
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    expectDeny(
      await c.callTool('evidence-write', { path: 'a.md', content: 'x' }),
      'deps',
      'evidence-write-failed',
    )
    await c.close()
  })

  it('searchKb 抛错 → deps/kb-search-failed', async () => {
    const log: DepsLog = { evidence: [], queries: [], budgets: [] }
    const f = makeFixture({ deps: fakeDeps(log, { search: new Error('索引未挂载') }) })
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    expectDeny(await c.callTool('kb-search', { query: 'x' }), 'deps', 'kb-search-failed')
    await c.close()
  })

  it('queryBudget 抛错 → deps/budget-query-failed', async () => {
    const log: DepsLog = { evidence: [], queries: [], budgets: [] }
    const f = makeFixture({ deps: fakeDeps(log, { budget: new Error('价目表缺失') }) })
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    expectDeny(await c.callTool('budget-query', { issue: 'T-1' }), 'deps', 'budget-query-failed')
    await c.close()
  })
})

describe('wkey 注入通道', () => {
  it('wkeyInjected：无注入 false → initialize _meta 后 true', async () => {
    const f = makeFixture()
    expect(f.server.wkeyInjected).toBe(false)
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    expect(f.server.wkeyInjected).toBe(true)
    await c.close()
  })

  it('opts.wkey 宿主直注（daemon/HTTP 鉴权头形态）：不依赖 initialize _meta 即可用', async () => {
    const f = makeFixture({ wkey: makeFixture().issueKey() })
    const c = await connectClient(f.server) // initialize 无 _meta
    expect(f.server.wkeyInjected).toBe(true)
    expectOk(await c.callTool('heartbeat', { issue: 'T-1' }), 'heartbeat')
    await c.close()
  })

  it('initialize _meta 到达即覆写宿主初值（同过网关 HMAC，无信任差异）', async () => {
    const holder = makeFixture()
    const direct = holder.issueKey()
    const f = makeFixture({ wkey: direct })
    const c = await connectClient(f.server, { 'studio-wkey': f.issueKey() })
    expectOk(await c.callTool('comment', { issue: 'T-1', body: '以握手注入的 key 落评' }), 'comment')
    await c.close()
  })
})
