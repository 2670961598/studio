/**
 * studio-tools 工具面测试（V2）—— IMPL-06-10
 *
 * 依据：v2/14 §三（MCP-16 场景分组面；现状六工具=本组已实现子集）、v2/16 §三
 * studio-tools 行、plan/05 IMPL-06-10「既有六工具行为断言（V2 版）」。
 *
 * 冻结验收：
 *   ① MCP-16 分组声明 = 四组 16 行（HR 4 / FIN 3 / DEV 3 / GEN 6），ID 唯一、组前缀一致；
 *   ② 声明不是注册面：STUDIO_TOOLS 仍六条，existing 行与六工具一一对应，target 行零实现；
 *   ③ 既有六工具 happy path 走真网关（action/payload/署名），tools/list 广告面不漂移；
 *   ④ 无 key 六工具全 auth/missing-wkey，网关零调用。
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/server'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'
import { createGateway } from '@studio-next/gateway'
import type { Gateway } from '@studio-next/gateway'
import { createStudioToolsServer } from '../../src/server.ts'
import {
  MCP_SCENARIO_GROUPS,
  MCP_SCENARIO_GROUP_NAMES,
  MCP_SCENARIO_TOOLS,
  STUDIO_TOOL_NAMES,
  STUDIO_TOOLS,
  mcpScenarioToolOf,
} from '../../src/tools.ts'
import type { KbHit, StudioToolsDeps } from '../../src/tools.ts'

const SECRET = new Uint8Array(32).fill(11)
const SIG_CTX = { company: '演示公司', dept: '平台部', role: '工程师', level: 3 }
const EXPECT_SIG = '[演示公司·平台部·工程师·3]'
const EVIDENCE = '# REPORT\n- typecheck 绿\n- test 绿'

interface RawToolResult {
  readonly isError?: boolean
  readonly structuredContent?: unknown
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

interface GateCall {
  readonly action: GatewayAction
  readonly payload: string
}

interface ToolCase {
  readonly args: Record<string, unknown>
  readonly expected: Record<string, unknown>
}

const CASES: Record<GatewayAction, ToolCase> = {
  comment: {
    args: { issue: 'T-1', body: '进展：地基完成' },
    expected: { author: 'P-1', signature: EXPECT_SIG },
  },
  heartbeat: {
    args: { issue: 'T-1' },
    expected: { author: 'P-1', signature: EXPECT_SIG },
  },
  article: {
    args: { path: 'kb/lessons/cursor.md', markdown: '# 游标教训\nsince(null)=最旧页' },
    expected: { path: 'kb/lessons/cursor.md', author: 'P-1', signature: EXPECT_SIG },
  },
  'kb-search': {
    args: { query: '游标 语义' },
    expected: { hits: [{ path: 'kb/lessons/cursor.md', score: 0.9, snippet: '命中：游标 语义' }] },
  },
  'evidence-write': {
    args: { path: 'evidence/REPORT.md', content: EVIDENCE },
    expected: { path: 'evidence/REPORT.md', bytes: EVIDENCE.length },
  },
  'budget-query': {
    args: { issue: 'T-1' },
    expected: { view: { issue: 'T-1', reserved: 1.0, settled: 0.25, remaining: 0.75 } },
  },
}

function successfulDeps(): StudioToolsDeps {
  return {
    writeEvidence: async (_path, content) => ({ bytes: content.length }),
    searchKb: async (query) => {
      const hits: KbHit[] = [{ path: 'kb/lessons/cursor.md', score: 0.9, snippet: `命中：${query}` }]
      return hits
    },
    queryBudget: async (issue) => ({ issue, reserved: 1.0, settled: 0.25, remaining: 0.75 }),
  }
}

function makeGateway(): Gateway {
  return createGateway({ secret: SECRET, clock: () => Date.now(), ticket: 'T-1', ctx: SIG_CTX, author: 'P-1' })
}

function issueToken(gateway: Gateway): string {
  return gateway.issue({ ticket: 'T-1', scope: [...GATEWAY_ACTIONS], ttl: '30m', nonce: randomUUID() })
}

/** 极简 MCP 客户端（InMemoryTransport；不引 client 包） */
class InMemoryClient {
  private readonly transport: Transport
  private readonly pending = new Map<number, (message: unknown) => void>()
  private nextId = 1

  constructor(transport: Transport) {
    this.transport = transport
    transport.onmessage = (message) => {
      const record = message as { id?: unknown }
      if (typeof record.id !== 'number') return
      const resolve = this.pending.get(record.id)
      if (resolve === undefined) return
      this.pending.delete(record.id)
      resolve(message)
    }
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++
    const message = await new Promise<unknown>((resolve) => {
      this.pending.set(id, resolve)
      void this.transport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage)
    })
    const record = message as { result?: T; error?: { message?: string } }
    if (record.error !== undefined) throw new Error(`${method}: ${record.error.message ?? 'JSON-RPC error'}`)
    return record.result as T
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'studio-tools-v2-groups', version: '0.0.0' },
    })
    void this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage)
  }

  async listTools(): Promise<Array<{ readonly name: string; readonly description?: string; readonly inputSchema?: { readonly type?: string } }>> {
    const result = await this.request<{
      tools?: Array<{ name: string; description?: string; inputSchema?: { type?: string } }>
    }>('tools/list', {})
    return result.tools ?? []
  }

  callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult> {
    return this.request<RawToolResult>('tools/call', { name, arguments: args })
  }

  close(): Promise<void> {
    return this.transport.close()
  }
}

interface Fixture {
  readonly calls: GateCall[]
  readonly client: InMemoryClient
  close(): Promise<void>
}

async function makeFixture(opts: { readonly noWkey?: boolean } = {}): Promise<Fixture> {
  const gateway = makeGateway()
  const calls: GateCall[] = []
  const recorded: Gateway = {
    ...gateway,
    gateWrite: (token, action, payload) => {
      calls.push({ action, payload })
      return gateway.gateWrite(token, action, payload)
    },
  }
  const wkey = opts.noWkey === true ? undefined : issueToken(gateway)
  const server = createStudioToolsServer({
    gateway: recorded,
    deps: successfulDeps(),
    ...(wkey !== undefined ? { wkey } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new InMemoryClient(clientTransport)
  await client.initialize()
  return {
    calls,
    client,
    close: async () => {
      await server.close().catch(() => undefined)
      await clientTransport.close().catch(() => undefined)
    },
  }
}

describe('MCP-16 场景分组声明（只声明，不注册）', () => {
  it('四组 16 行：ID 唯一、组前缀一致、工具名与摘要非空；声明不扩大注册面', () => {
    expect(MCP_SCENARIO_GROUPS.map((g) => g.group)).toEqual([...MCP_SCENARIO_GROUP_NAMES])
    expect(MCP_SCENARIO_TOOLS).toHaveLength(16)
    expect(new Set(MCP_SCENARIO_TOOLS.map((t) => t.id)).size).toBe(16)
    for (const declaration of MCP_SCENARIO_TOOLS) {
      expect(declaration.id.startsWith(`MCP-${declaration.group.toUpperCase()}-`)).toBe(true)
      expect(declaration.names.length).toBeGreaterThan(0)
      expect(declaration.summary.length).toBeGreaterThan(4)
      for (const name of declaration.names) expect(name.length).toBeGreaterThan(3)
    }
    expect(MCP_SCENARIO_TOOLS.filter((t) => t.status === 'target')).toHaveLength(11)
    expect(MCP_SCENARIO_TOOLS.filter((t) => t.status === 'existing')).toHaveLength(5)
    expect(STUDIO_TOOLS).toHaveLength(6)
  })

  it('existing 行与六工具一一对应；target 行零实现映射（反向索引每工具恰命中一行）', () => {
    const mapped = MCP_SCENARIO_TOOLS.flatMap((t) => t.existingTools)
    expect([...mapped].sort()).toEqual([...STUDIO_TOOL_NAMES].sort())
    expect(mapped).toHaveLength(STUDIO_TOOL_NAMES.length)
    for (const action of GATEWAY_ACTIONS) {
      const declaration = mcpScenarioToolOf(action)
      expect(declaration).toBeDefined()
      expect(declaration?.existingTools).toContain(action)
    }
    for (const declaration of MCP_SCENARIO_TOOLS) {
      if (declaration.status === 'target') expect(declaration.existingTools).toEqual([])
      else expect(declaration.existingTools.length).toBeGreaterThan(0)
    }
  })
})

describe('既有六工具行为（V2 版，真网关链路）', () => {
  it.each([...GATEWAY_ACTIONS])('%s：happy path 回执 + 网关收到单行 @action 载荷', async (action) => {
    const fixture = await makeFixture()
    const result = await fixture.client.callTool(action, CASES[action].args)
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ ok: true, action, ...CASES[action].expected })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]?.action).toBe(action)
    expect(fixture.calls[0]?.payload).toBe(`@action ${action} ${JSON.stringify(CASES[action].args)}`)
    expect(fixture.calls[0]?.payload.includes('\n')).toBe(false)
    await fixture.close()
  })

  it('tools/list 广告面 = GATEWAY_ACTIONS（描述齐备、inputSchema 为 object）', async () => {
    const fixture = await makeFixture()
    const tools = await fixture.client.listTools()
    expect(tools.map((t) => t.name)).toEqual([...GATEWAY_ACTIONS])
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(8)
      expect(tool.inputSchema?.type).toBe('object')
    }
    await fixture.close()
  })

  it('无 key：六工具全部 auth/missing-wkey，网关零调用（不烧 nonce）', async () => {
    const fixture = await makeFixture({ noWkey: true })
    for (const action of GATEWAY_ACTIONS) {
      const result = await fixture.client.callTool(action, CASES[action].args)
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: 'auth', subcause: 'missing-wkey' },
      })
    }
    expect(fixture.calls).toHaveLength(0)
    await fixture.close()
  })
})
