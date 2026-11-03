/**
 * studio-tools 场景工具面测试（V2）—— studio-dev-548
 *
 * 依据：docs/v2/14-§三（MCP-16 工具表 11 行 target：入参/出参/权限/公司维）、§三 铁律 1/2/3/4
 * （端口前门不新增权源／除只读外落请求申报记录／署名与公司维必带／内外两面不同名）、
 * docs/17-§2（主相位不因工具面变化）、docs/17-§6（回执不是完成证据）。
 *
 * 冻结验收（本套件钉死）：
 *   ① 注册面：tools/list = 既有六工具 + 场景 11 工具（顺序稳定）；场景 11 行声明 status=registered
 *      且逐条有迁移留痕（target→registered，契约面子项未闭合故不冒充 existing）；
 *   ② schema：11 个 strictObject 收正确入参、拒多余字段/空必填/错型；交接包十项齐全校验；
 *   ③ fail-closed：无 wkey → 11 工具全 auth/missing-wkey（端口零调用）；端口未装配 →
 *      deps/scenario-port-unavailable（不伪造回执）；速率超限 → auth/rate-limited；语义非法 →
 *      gateway/invalid-args（端口零调用）；端口判权拒 → 原样透传；端口意外 → internal/unexpected；
 *      回执类型错 → internal/receipt-type-mismatch；
 *   ④ happy path：端口收到完整请求（id/tool/group/company/args/wkey/at），回执 decided=false；
 *   ⑤ 既有六工具与场景工具同 server 并存不互相污染（comment 仍走真网关 gateWrite）。
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
  MCP_SCENARIO_TOOLS,
  STUDIO_TOOLS,
  STUDIO_TOOL_NAMES,
  mcpScenarioToolOf,
} from '../../src/tools.ts'
import type { KbHit, StudioToolsDeps } from '../../src/tools.ts'
import {
  SCENARIO_TOOL_IDS,
  SCENARIO_TOOL_MIGRATIONS,
  SCENARIO_TOOL_NAMES,
  SCENARIO_TOOL_SPECS,
  ScenarioPortError,
} from '../../src/scenario-tools.ts'
import type { ScenarioPort, ScenarioRequest } from '../../src/scenario-tools.ts'

const SECRET = new Uint8Array(32).fill(13)
const SIG_CTX = { company: '演示公司', dept: '研发部', role: '技术策划', level: 2 }
const NOW = 1_760_000_000_000

// ---------------------------------------------------------------------------
// 最小合法入参（每条对应一个工具；与 v2/14 §三「入参」列同形）
// ---------------------------------------------------------------------------

import { GOOD_ARGS, HANDOVER_ITEMS } from './scenario-fixtures.ts'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

interface RawToolResult {
  readonly isError?: boolean
  readonly structuredContent?: unknown
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

interface GateCall {
  readonly action: GatewayAction
  readonly payload: string
}

function successfulDeps(): StudioToolsDeps {
  return {
    writeEvidence: async (_path, content) => ({ bytes: content.length }),
    searchKb: async (query) => {
      const hits: KbHit[] = [{ path: 'kb/x.md', score: 0.5, snippet: query }]
      return hits
    },
    queryBudget: async (issue) => ({ issue }),
  }
}

/** 手搓极简 MCP 客户端（与既有 groups/stdio 测试同手法，不引 client 包） */
class MiniClient {
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
      clientInfo: { name: 'studio-tools-scenario-v2', version: '0.0.0' },
    })
    void this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage)
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: { type?: string } }>> {
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

/** 记录型场景端口（可注入失败/错型；默认按规格回正确回执/投影） */
interface PortProbe {
  readonly port: ScenarioPort
  readonly requests: ScenarioRequest[]
}

function recordingPort(mode: 'ok' | 'authority-denied' | 'boom' | 'wrong-kind' | 'wrong-receipt' = 'ok'): PortProbe {
  const requests: ScenarioRequest[] = []
  const port: ScenarioPort = {
    invoke: async (request) => {
      requests.push(request)
      if (mode === 'authority-denied') throw new ScenarioPortError('auth', 'authority-denied', '端口判权拒：越权')
      if (mode === 'boom') throw new Error('端口内部故障')
      const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === request.tool)
      if (spec === undefined) throw new Error(`未登记工具 ${request.tool}`)
      if (spec.kind === 'read') {
        if (mode === 'wrong-kind') return { kind: 'receipt', receiptType: 'WRONG', receiptRef: `R-${requests.length}` }
        return { kind: 'view', view: { issue: 'T-1', source: 'fixture-view' } }
      }
      const receiptType = mode === 'wrong-receipt' ? 'WRONG' : spec.receiptType
      if (receiptType === null) throw new Error(`request 工具缺回执类型：${spec.name}`)
      return { kind: 'receipt', receiptType, receiptRef: `R-${requests.length}` }
    },
  }
  return { port, requests }
}

interface Fixture {
  readonly calls: GateCall[]
  readonly client: MiniClient
  issueKey(scope?: readonly GatewayAction[], ttl?: string): string
  close(): Promise<void>
}

async function makeFixture(opts: { noWkey?: boolean; port?: ScenarioPort } = {}): Promise<Fixture> {
  const gateway = createGateway({ secret: SECRET, clock: () => NOW, ticket: 'T-1', ctx: SIG_CTX, author: 'P-3' })
  const calls: GateCall[] = []
  const recorded: Gateway = {
    ...gateway,
    gateWrite: (token, action, payload) => {
      calls.push({ action, payload })
      return gateway.gateWrite(token, action, payload)
    },
  }
  const issueKey = (scope: readonly GatewayAction[] = [...GATEWAY_ACTIONS], ttl = '30m'): string =>
    gateway.issue({ ticket: 'T-1', scope: [...scope], ttl, nonce: randomUUID() })
  const wkey = opts.noWkey === true ? undefined : issueKey()
  const server = createStudioToolsServer({
    gateway: recorded,
    deps: successfulDeps(),
    now: () => NOW,
    ...(wkey !== undefined ? { wkey } : {}),
    ...(opts.port !== undefined ? { scenario: opts.port } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new MiniClient(clientTransport)
  await client.initialize()
  return {
    calls,
    client,
    issueKey,
    close: async () => {
      await server.close().catch(() => undefined)
      await clientTransport.close().catch(() => undefined)
    },
  }
}

// ---------------------------------------------------------------------------
// ① 注册面与声明对齐
// ---------------------------------------------------------------------------

describe('场景工具注册表（11 行 target → registered）', () => {
  it('规格数=名字表=11，id 唯一且与 v2/14 §三 行号一一对应', () => {
    expect(SCENARIO_TOOL_SPECS.map((spec) => spec.name)).toEqual([...SCENARIO_TOOL_NAMES])
    expect(new Set(SCENARIO_TOOL_NAMES).size).toBe(11)
    expect(Object.keys(SCENARIO_TOOL_IDS).sort()).toEqual([...SCENARIO_TOOL_NAMES].sort())
    for (const spec of SCENARIO_TOOL_SPECS) {
      expect(spec.id).toBe(SCENARIO_TOOL_IDS[spec.name])
      expect(spec.id.startsWith(`MCP-${spec.group.toUpperCase()}-`)).toBe(true)
    }
  })

  it('声明表：11 行 registered、5 行 existing、0 行 target；registered 行无既有工具映射', () => {
    expect(MCP_SCENARIO_TOOLS).toHaveLength(16)
    expect(MCP_SCENARIO_TOOLS.filter((row) => row.status === 'registered')).toHaveLength(11)
    expect(MCP_SCENARIO_TOOLS.filter((row) => row.status === 'existing')).toHaveLength(5)
    expect(MCP_SCENARIO_TOOLS.filter((row) => row.status === 'target')).toHaveLength(0)
    const registered = MCP_SCENARIO_TOOLS.filter((row) => row.status === 'registered')
    for (const row of registered) {
      expect(row.existingTools).toEqual([])
      const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === row.names[0])
      expect(spec).toBeDefined()
      expect(spec?.group).toBe(row.group)
      expect(spec?.id).toBe(row.id)
    }
  })

  it('既有六工具面未被场景面改写（STUDIO_TOOLS ↔ GATEWAY_ACTIONS 仍一一对应）', () => {
    expect(STUDIO_TOOL_NAMES).toEqual([...GATEWAY_ACTIONS])
    expect(STUDIO_TOOLS).toHaveLength(6)
    for (const action of GATEWAY_ACTIONS) {
      expect(mcpScenarioToolOf(action)).toBeDefined()
    }
    for (const name of SCENARIO_TOOL_NAMES) {
      expect(STUDIO_TOOL_NAMES).not.toContain(name)
    }
  })

  it('迁移留痕：11 条 target→registered，含单号/实现/证据/未闭合契约子项', () => {
    expect(SCENARIO_TOOL_MIGRATIONS).toHaveLength(11)
    expect(SCENARIO_TOOL_MIGRATIONS.map((entry) => entry.name)).toEqual([...SCENARIO_TOOL_NAMES])
    for (const entry of SCENARIO_TOOL_MIGRATIONS) {
      expect(entry.id).toBe(SCENARIO_TOOL_IDS[entry.name])
      expect(entry.from).toBe('target')
      expect(entry.to).toBe('registered')
      expect(entry.ticket).toBe('studio-dev-548')
      expect(entry.implementation).toContain('scenario-tools.ts')
      expect(entry.evidence).toContain('test/v2/scenario-tools.test.ts')
      expect(entry.openSubitem).toContain('契约面')
    }
  })

  it('每规格：权限/署名主体/公司维/速率/回执类型齐备（v2/14 §三 列不留空）', () => {
    for (const spec of SCENARIO_TOOL_SPECS) {
      expect(spec.title.length).toBeGreaterThan(3)
      expect(spec.description.length).toBeGreaterThan(8)
      expect(spec.permission.subject).toBe('person')
      expect(spec.permission.companyRequired).toBe(true)
      expect(spec.permission.authority.length).toBeGreaterThan(3)
      expect(spec.limits.perMinute).toBeGreaterThan(0)
      if (spec.kind === 'request') {
        expect(spec.receiptType?.length ?? 0).toBeGreaterThan(3)
        expect(spec.output).toBeDefined()
      } else {
        expect(spec.receiptType).toBeNull()
        expect(spec.group).toBe('fin') // 只读仅财务查看两行（v2/14 §三）
      }
    }
  })

  it('类别与 v2/14 §三「出参」列一致：财务查看两行为 read，其余 9 行为 request', () => {
    const reads = SCENARIO_TOOL_SPECS.filter((spec) => spec.kind === 'read').map((spec) => spec.name)
    expect(reads).toEqual(['fin.ledgerRead', 'fin.costguardStatus'])
    for (const spec of SCENARIO_TOOL_SPECS) {
      if (spec.kind === 'request') expect(spec.receiptType).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// ③ 协议级：注册面 + fail-closed 门序
// ---------------------------------------------------------------------------

describe('tools/list 与 fail-closed 门序（真协议层）', () => {
  it('tools/list = 既有六工具 + 场景 11 工具（顺序稳定、schema 为 object）', async () => {
    const fixture = await makeFixture()
    const tools = await fixture.client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual([...GATEWAY_ACTIONS, ...SCENARIO_TOOL_NAMES])
    for (const tool of tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(8)
      expect(tool.inputSchema?.type).toBe('object')
    }
    await fixture.close()
  })

  it('无 wkey：11 场景工具全部 auth/missing-wkey，端口零调用、网关零调用', async () => {
    const probe = recordingPort()
    const fixture = await makeFixture({ noWkey: true, port: probe.port })
    for (const name of SCENARIO_TOOL_NAMES) {
      const result = await fixture.client.callTool(name, GOOD_ARGS[name])
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: 'auth', subcause: 'missing-wkey' },
      })
    }
    expect(probe.requests).toHaveLength(0)
    expect(fixture.calls).toHaveLength(0)
    await fixture.close()
  })

  it('端口未装配：11 场景工具全部 deps/scenario-port-unavailable（不伪造回执）', async () => {
    const fixture = await makeFixture()
    for (const name of SCENARIO_TOOL_NAMES) {
      const result = await fixture.client.callTool(name, GOOD_ARGS[name])
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: 'deps', subcause: 'scenario-port-unavailable' },
      })
    }
    await fixture.close()
  })

  it('语义非法（交接包缺去向）：gateway/invalid-args 且端口零调用', async () => {
    const probe = recordingPort()
    const fixture = await makeFixture({ port: probe.port })
    const items = HANDOVER_ITEMS.map((entry, index) => (index === 0 ? { item: entry.item, presence: 'missing' } : entry))
    const result = await fixture.client.callTool('work.handoverSubmit', {
      ...GOOD_ARGS['work.handoverSubmit'],
      items,
    })
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'gateway', subcause: 'invalid-args' },
    })
    expect(probe.requests).toHaveLength(0)
    await fixture.close()
  })

  it('速率超限：第 61 次 fin.ledgerRead → auth/rate-limited（前 60 次放行）', async () => {
    const probe = recordingPort()
    const fixture = await makeFixture({ port: probe.port })
    for (let i = 0; i < 60; i += 1) {
      const result = await fixture.client.callTool('fin.ledgerRead', GOOD_ARGS['fin.ledgerRead'])
      expect(result.isError).toBeFalsy()
    }
    const limited = await fixture.client.callTool('fin.ledgerRead', GOOD_ARGS['fin.ledgerRead'])
    expect(limited.isError).toBe(true)
    expect(limited.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'auth', subcause: 'rate-limited' },
    })
    expect(probe.requests).toHaveLength(60)
    await fixture.close()
  })
})

// ---------------------------------------------------------------------------
// ④ happy path + 端口异常透传
// ---------------------------------------------------------------------------

describe('场景端口路由（happy path / 拒绝透传 / 意外归类）', () => {
  it.each([...SCENARIO_TOOL_NAMES])('%s：端口收到完整请求；request 回执 decided=false / read 只读投影', async (name) => {
    const probe = recordingPort()
    const fixture = await makeFixture({ port: probe.port })
    const result = await fixture.client.callTool(name, GOOD_ARGS[name])
    expect(result.isError).toBeFalsy()
    const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === name)
    if (spec?.kind === 'read') {
      expect(result.structuredContent).toMatchObject({ ok: true, tool: name, view: { source: 'fixture-view' } })
    } else {
      expect(result.structuredContent).toMatchObject({
        ok: true,
        tool: name,
        receipt: { receiptType: spec?.receiptType, decided: false },
      })
    }
    expect(probe.requests).toHaveLength(1)
    const request = probe.requests[0]
    expect(request?.id).toBe(spec?.id)
    expect(request?.tool).toBe(name)
    expect(request?.group).toBe(spec?.group)
    expect(request?.company).toBe('演示公司')
    expect(request?.args).toEqual(GOOD_ARGS[name])
    expect(request?.at).toBe(NOW)
    expect(typeof request?.wkey).toBe('string')
    await fixture.close()
  })

  it('端口判权拒 → 原样透传 auth/authority-denied（不渲染成功）', async () => {
    const probe = recordingPort('authority-denied')
    const fixture = await makeFixture({ port: probe.port })
    const result = await fixture.client.callTool('hr.profileAmend', GOOD_ARGS['hr.profileAmend'])
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'auth', subcause: 'authority-denied' },
    })
    await fixture.close()
  })

  it('端口意外抛错 → internal/unexpected（不吞不伪）', async () => {
    const probe = recordingPort('boom')
    const fixture = await makeFixture({ port: probe.port })
    const result = await fixture.client.callTool('work.intake', GOOD_ARGS['work.intake'])
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'internal', subcause: 'unexpected' },
    })
    await fixture.close()
  })

  it('request 工具收到错型回执 → internal/receipt-type-mismatch（错型不渲染成功）', async () => {
    const probe = recordingPort('wrong-receipt')
    const fixture = await makeFixture({ port: probe.port })
    const result = await fixture.client.callTool('hr.appointmentPropose', GOOD_ARGS['hr.appointmentPropose'])
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'internal', subcause: 'receipt-type-mismatch' },
    })
    await fixture.close()
  })

  it('read 工具收到回执而非投影 → internal/outcome-kind-mismatch（类别错型不渲染成功）', async () => {
    const probe = recordingPort('wrong-kind')
    const fixture = await makeFixture({ port: probe.port })
    const result = await fixture.client.callTool('fin.ledgerRead', GOOD_ARGS['fin.ledgerRead'])
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'internal', subcause: 'outcome-kind-mismatch' },
    })
    await fixture.close()
  })
})

// ---------------------------------------------------------------------------
// ⑤ 与既有六工具并存
// ---------------------------------------------------------------------------

describe('既有六工具与场景工具同 server 并存', () => {
  it('comment 仍走真网关 gateWrite（场景注册不抢占既有工具名/链路）', async () => {
    const fixture = await makeFixture()
    const result = await fixture.client.callTool('comment', { issue: 'T-1', body: '进展：场景面已注册' })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({ ok: true, action: 'comment', author: 'P-3' })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]?.action).toBe('comment')
    await fixture.close()
  })
})
