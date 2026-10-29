/**
 * studio-tools MCP stdio 入口测试（V2）—— IMPL-06-10
 *
 * 依据：v2/14 §三（MCP-16 场景分组面；stdio 形态=目标）、v2/16 §三 studio-tools 行
 * （stdio 入口＋bin，结果面库/stdio 一致性治 L3P-09/10）、plan/05 IMPL-06-10。
 *
 * 冻结验收：
 *   ① 真子进程 stdio 冒烟：initialize → tools/list（= GATEWAY_ACTIONS）→ 六工具无 key
 *     全 fail-closed → stdin EOF 进程 0 退出；stdout 只含 JSON-RPC；stderr 一行诊断；
 *   ② 配置 fail-closed：有 wkey 无 secret = 启动失败（非零退出、stdout 零帧、不打印 key）；
 *   ③ 库/stdio 结果面一致：同 token/同配置/同入参 → 同 structuredContent；comment 成功
 *     必须来自网关放行（回执带署名；不是未鉴权的本地直回 — L3P-09 面）；
 *   ④ deps 未装配 → 双侧 deps/<tool>-failed（L3P-10：不渲染成功）；
 *   ⑤ package.json#bin / exports["./stdio"] 指向本入口，既有 "." 出口不变。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import type { JSONRPCMessage } from '@modelcontextprotocol/server'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'
import { createGateway } from '@studio-next/gateway'
import type { Gateway } from '@studio-next/gateway'
import { createStudioToolsServer } from '../../src/server.ts'
import { createFailClosedDeps } from '../../src/stdio.ts'
import type { StudioToolsDeps } from '../../src/tools.ts'

const STDIO_ENTRY = fileURLToPath(new URL('../../src/stdio.ts', import.meta.url))
const REQUEST_TIMEOUT_MS = 15_000
const EXIT_TIMEOUT_MS = 15_000

const SECRET = new Uint8Array(32).fill(7)
const SECRET_HEX = Buffer.from(SECRET).toString('hex')
const SIG_CTX = { company: '演示公司', dept: '平台部', role: '工程师', level: 3 }
const EXPECT_SIG = '[演示公司·平台部·工程师·3]'

const NO_KEY_ARGS: Record<GatewayAction, Record<string, unknown>> = {
  comment: { issue: 'T-1', body: '进展：地基完成' },
  heartbeat: { issue: 'T-1' },
  article: { path: 'kb/lessons/cursor.md', markdown: '# 游标' },
  'kb-search': { query: '游标 语义' },
  'evidence-write': { path: 'evidence/REPORT.md', content: '# REPORT' },
  'budget-query': { issue: 'T-1' },
}

const COMMENT_ARGS = { issue: 'T-1', body: '进展：stdio 与库面一致性' }

interface ToolCallResult {
  readonly isError?: boolean
  readonly structuredContent?: unknown
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

interface RawMessage {
  readonly id?: unknown
  readonly method?: unknown
  readonly result?: unknown
  readonly error?: { readonly code?: number; readonly message?: string }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

/** 极简 JSON-RPC 客户端（不引 @modelcontextprotocol/client：依赖纪律只增 server 包） */
class JsonRpcPeer {
  private readonly sendLine: (message: Record<string, unknown>) => void
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1

  constructor(sendLine: (message: Record<string, unknown>) => void) {
    this.sendLine = sendLine
  }

  handle(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const record = message as RawMessage
    if (record.method !== undefined) return // 服务器请求/通知：本客户端不处理
    if (typeof record.id !== 'number') return
    const pending = this.pending.get(record.id)
    if (pending === undefined) return
    this.pending.delete(record.id)
    if (record.error !== undefined) {
      pending.reject(new Error(`JSON-RPC error ${String(record.error.code ?? '')}: ${record.error.message ?? 'unknown'}`))
    } else {
      pending.resolve(record.result)
    }
  }

  fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP 请求超时：${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.sendLine({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string): void {
    this.sendLine({ jsonrpc: '2.0', method })
  }

  async initialize(meta?: Record<string, unknown>): Promise<void> {
    const params: Record<string, unknown> = {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'studio-tools-stdio-v2', version: '0.0.0' },
    }
    if (meta !== undefined) params['_meta'] = meta
    await this.request('initialize', params)
    this.notify('notifications/initialized')
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return this.request<ToolCallResult>('tools/call', { name, arguments: args })
  }
}

interface ExitInfo {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

/** 真子进程 stdio 夹具（进程由测试自管；afterEach 兜底 kill） */
class StdioChild {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly peer: JsonRpcPeer
  private readonly exitPromise: Promise<ExitInfo>
  private exitInfo: ExitInfo | undefined
  private stdoutBuffer = ''
  private stderrText = ''
  private readonly stdoutLines: string[] = []
  private readonly protocolErrors: string[] = []

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [STDIO_ENTRY], { env })
    this.peer = new JsonRpcPeer((message) => {
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrText += chunk
    })
    this.exitPromise = new Promise<ExitInfo>((resolve) => {
      this.child.once('exit', (code, signal) => {
        this.exitInfo = { code, signal }
        this.peer.fail(new Error('stdio 子进程已退出，请求未获响应'))
        resolve({ code, signal })
      })
    })
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newlineAt = this.stdoutBuffer.indexOf('\n')
      if (newlineAt === -1) return
      const line = this.stdoutBuffer.slice(0, newlineAt).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineAt + 1)
      if (line === '') continue
      this.stdoutLines.push(line)
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        this.protocolErrors.push(line)
        continue
      }
      this.peer.handle(parsed)
    }
  }

  initialize(meta?: Record<string, unknown>): Promise<void> {
    return this.peer.initialize(meta)
  }

  async listTools(): Promise<Array<{ readonly name: string; readonly description?: string }>> {
    const result = await this.peer.request<{ tools?: Array<{ name: string; description?: string }> }>(
      'tools/list',
      {},
    )
    return result.tools ?? []
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return this.peer.callTool(name, args)
  }

  stdoutLineCount(): number {
    return this.stdoutLines.length
  }

  get parseErrors(): readonly string[] {
    return this.protocolErrors
  }

  stderr(): string {
    return this.stderrText
  }

  async waitForExit(): Promise<ExitInfo> {
    if (this.exitInfo !== undefined) return this.exitInfo
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        this.exitPromise,
        new Promise<ExitInfo>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('stdio 子进程未按时退出')), EXIT_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async close(): Promise<ExitInfo> {
    if (this.exitInfo !== undefined) return this.exitInfo
    this.child.stdin.end()
    return await this.waitForExit()
  }

  kill(): void {
    if (this.exitInfo === undefined) this.child.kill('SIGKILL')
  }
}

const children: StdioChild[] = []

function startChild(env: NodeJS.ProcessEnv): StdioChild {
  const child = new StdioChild(env)
  children.push(child)
  return child
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

/** 清空全部 STUDIO_TOOLS_* 继承值后合并本次用例配置（避免宿主环境影响判决） */
function cleanEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('STUDIO_TOOLS_')) delete env[key]
  }
  return { ...env, ...overrides }
}

function configuredEnv(wkey: string): NodeJS.ProcessEnv {
  return cleanEnv({
    STUDIO_TOOLS_WKEY: wkey,
    STUDIO_TOOLS_GATEWAY_SECRET: SECRET_HEX,
    STUDIO_TOOLS_TICKET: 'T-1',
    STUDIO_TOOLS_AUTHOR: 'P-1',
    STUDIO_TOOLS_SIGNATURE_CTX: JSON.stringify(SIG_CTX),
  })
}

function makeGateway(): Gateway {
  return createGateway({ secret: SECRET, clock: () => Date.now(), ticket: 'T-1', ctx: SIG_CTX, author: 'P-1' })
}

function issueToken(gateway: Gateway): string {
  return gateway.issue({ ticket: 'T-1', scope: [...GATEWAY_ACTIONS], ttl: '30m', nonce: randomUUID() })
}

interface LibraryFixture {
  readonly peer: JsonRpcPeer
  close(): Promise<void>
}

/** 库面夹具：与 stdio 面走同一个 createStudioToolsServer 注册面 */
async function connectLibrary(opts: {
  readonly gateway: Gateway
  readonly deps: StudioToolsDeps
  readonly wkey?: string | undefined
}): Promise<LibraryFixture> {
  const server = createStudioToolsServer({
    gateway: opts.gateway,
    deps: opts.deps,
    ...(opts.wkey !== undefined ? { wkey: opts.wkey } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const peer = new JsonRpcPeer((message) => {
    void clientTransport.send(message as JSONRPCMessage)
  })
  clientTransport.onmessage = (message) => peer.handle(message)
  return {
    peer,
    close: async () => {
      await server.close().catch(() => undefined)
      await clientTransport.close().catch(() => undefined)
    },
  }
}

describe('真子进程 stdio 冒烟（无 daemon、零配置 sealed）', () => {
  it('initialize → tools/list → 六工具无 key 全 fail-closed → EOF 退出 0；stdout 只含 JSON-RPC', async () => {
    const child = startChild(cleanEnv({}))
    await child.initialize()
    const tools = await child.listTools()
    expect(tools.map((t) => t.name)).toEqual([...GATEWAY_ACTIONS])
    for (const t of tools) expect((t.description ?? '').length).toBeGreaterThan(8)
    for (const action of GATEWAY_ACTIONS) {
      const result = await child.callTool(action, NO_KEY_ARGS[action])
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: 'auth', subcause: 'missing-wkey' },
      })
    }
    const exit = await child.close()
    expect(exit).toEqual({ code: 0, signal: null })
    expect(child.parseErrors).toEqual([])
    expect(child.stdoutLineCount()).toBe(2 + GATEWAY_ACTIONS.length)
    expect(child.stderr()).toContain('[studio-tools] stdio listening (gateway=sealed, wkey=none)')
  })

  it('配置 fail-closed：有 wkey 无 secret → 非零退出、stdout 零帧、stderr 稳定码且不打印 key', async () => {
    const fakeKey = 'fake-wkey-must-not-appear-in-logs'
    const child = startChild(cleanEnv({ STUDIO_TOOLS_WKEY: fakeKey }))
    const exit = await child.waitForExit()
    expect(exit.code).toBe(1)
    expect(child.stdoutLineCount()).toBe(0)
    expect(child.stderr()).toContain('stdio-config-invalid')
    expect(child.stderr()).not.toContain(fakeKey)
  })
})

describe('库/stdio 结果面一致（L3P-09/10）', () => {
  it('无 key 的 comment：两侧同为 auth/missing-wkey（stdio 无凭据不本地放行）', async () => {
    const gateway = makeGateway()
    const lib = await connectLibrary({ gateway, deps: createFailClosedDeps() })
    await lib.peer.initialize()
    const libResult = await lib.peer.callTool('comment', COMMENT_ARGS)
    expect(libResult.isError).toBe(true)

    const child = startChild(cleanEnv({}))
    await child.initialize()
    const stdioResult = await child.callTool('comment', COMMENT_ARGS)
    expect(stdioResult.isError).toBe(true)
    expect(stdioResult.structuredContent).toEqual(libResult.structuredContent)
    expect(stdioResult.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'auth', subcause: 'missing-wkey' },
    })

    expect((await child.close()).code).toBe(0)
    await lib.close()
  })

  it('有效 wkey 的 comment：两侧 structuredContent 全等，回执带网关署名（allow 由网关放行，非本地直回）', async () => {
    const gateway = makeGateway()
    const token = issueToken(gateway)
    const lib = await connectLibrary({ gateway, deps: createFailClosedDeps(), wkey: token })
    await lib.peer.initialize()
    const libResult = await lib.peer.callTool('comment', COMMENT_ARGS)
    expect(libResult.isError).toBeFalsy()
    expect(libResult.structuredContent).toMatchObject({
      ok: true,
      action: 'comment',
      issue: 'T-1',
      author: 'P-1',
      signature: EXPECT_SIG,
    })

    const child = startChild(configuredEnv(token))
    await child.initialize()
    const stdioResult = await child.callTool('comment', COMMENT_ARGS)
    expect(stdioResult.isError).toBeFalsy()
    expect(stdioResult.structuredContent).toEqual(libResult.structuredContent)
    expect(child.stderr()).not.toContain(token)
    expect(child.stderr()).not.toContain(SECRET_HEX)

    expect((await child.close()).code).toBe(0)
    await lib.close()
  })

  it('deps 未装配的 kb-search：两侧同为 deps/kb-search-failed，绝不渲染 ok:true', async () => {
    const gateway = makeGateway()
    const token = issueToken(gateway)
    const lib = await connectLibrary({ gateway, deps: createFailClosedDeps(), wkey: token })
    await lib.peer.initialize()
    const libResult = await lib.peer.callTool('kb-search', { query: '游标 语义' })
    expect(libResult.isError).toBe(true)

    const child = startChild(configuredEnv(token))
    await child.initialize()
    const stdioResult = await child.callTool('kb-search', { query: '游标 语义' })
    expect(stdioResult.isError).toBe(true)
    expect(stdioResult.structuredContent).toEqual(libResult.structuredContent)
    expect(stdioResult.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'deps', subcause: 'kb-search-failed' },
    })

    expect((await child.close()).code).toBe(0)
    await lib.close()
  })
})

interface ExportCondition {
  readonly import?: string
  readonly require?: string
}

describe('bin / exports 声明', () => {
  it('package.json#bin 与 exports["./stdio"] 指向本入口，既有 "." 出口不变', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      readonly bin?: Record<string, string>
      readonly exports?: Record<string, string | ExportCondition>
    }
    expect(pkg.bin?.['studio-tools']).toBe('./src/stdio.ts')
    const stdioExport = pkg.exports?.['./stdio']
    const rootExport = pkg.exports?.['.']
    expect(typeof stdioExport === 'string' ? stdioExport : stdioExport?.import).toBe(
      './src/stdio.ts',
    )
    expect(typeof rootExport === 'string' ? rootExport : rootExport?.import).toBe('./src/index.ts')
  })
})
