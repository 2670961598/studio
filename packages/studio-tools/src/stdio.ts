#!/usr/bin/env node
/**
 * studio-tools MCP stdio 传输入口 —— IMPL-06-10（v2/14 §三、v2/16 §三 studio-tools 行）
 *
 * 职责（只做传输与进程生命周期，不新增业务）：
 *   - stdin 读 JSON-RPC 行 / stdout 只写 JSON-RPC（MCP stdio 绑定；日志一律 stderr）；
 *   - stderr 单行诊断（启动/失败；不写 wkey、不写 secret）；
 *   - 复用 createStudioToolsServer 的同一注册面（六工具；MCP-16 分组声明不注册新工具）；
 *   - 不依赖 daemon：gateway/deps 由 env（bin 形态）或调用方注入（库形态）。
 *
 * 凭据通道（fail-closed）：
 *   - STUDIO_TOOLS_WKEY：宿主每单直注（stdio 无 HTTP 头）。与 initialize
 *     `_meta['studio-wkey']` 同一 server.ts 通道；_meta 到达仍按现行为覆写（不新增第二套语义）。
 *   - STUDIO_TOOLS_GATEWAY_SECRET / _TICKET / _AUTHOR / _SIGNATURE_CTX：进程内网关校验配置。
 *     缺 secret 且无 wkey → sealed 网关（随机密钥，外部无从得到可过闸凭据）：进程可启动、
 *     tools/list 可用，一切 tools/call fail-closed——不伪造成功（L3P-09）。
 *     有 wkey 无 secret / secret 非 64 位十六进制 / 缺 ticket/author/ctx → 启动失败
 *     （stdio-config-invalid，非零退出），不静默降级。
 *   - deps 不在本文件实现：默认 fail-closed 三方法（抛错→deps 族），宿主需要真 IO 时注入
 *     （L3P-10：deps 失败不得渲染成成功）。
 *
 * 拟稿缺口（待批示，不假装已解）：
 *   - gateway HMAC 为对称密钥：stdio helper 进程校验 wkey 必须持有 secret，secret 经 env
 *     投递会进入执行体可读范围。目标形态（challenge-proof / 非对称验签 / daemon 代验，
 *     沿 v1 80-§11.4.1）未实现；本入口只保证「没有 secret 就不接受真凭据通道」。
 *   - README 的 CLI 挂载样例仍指旧 daemon 路径（本单领土不含 README，登记为缺口）。
 */
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type { Implementation } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createGateway } from '@studio-next/gateway'
import type { Gateway, SignatureContext } from '@studio-next/gateway'
import { createStudioToolsServer } from './server.ts'
import type { StudioToolsServer } from './server.ts'
import type { StudioToolsDeps } from './tools.ts'

/** stdio 入口读取的环境键（只读；不写回） */
export const STDIO_ENV_KEYS = {
  /** 宿主每单直注 wkey（README 拟稿键名；与 initialize _meta 同通道） */
  wkey: 'STUDIO_TOOLS_WKEY',
  /** 网关 HMAC 密钥（64 位十六进制 = 32 字节） */
  gatewaySecret: 'STUDIO_TOOLS_GATEWAY_SECRET',
  /** 本闸收口的单号（verify 单号绑定锚） */
  ticket: 'STUDIO_TOOLS_TICKET',
  /** 署名工号 */
  author: 'STUDIO_TOOLS_AUTHOR',
  /** 署名上下文 JSON：{ company, dept, role, level } */
  signatureContext: 'STUDIO_TOOLS_SIGNATURE_CTX',
} as const

/** 启动期稳定失败码（stderr 一行；不混类） */
export type StdioFailureCode = 'stdio-config-invalid' | 'stdio-startup-failed'

export class StdioError extends Error {
  readonly code: StdioFailureCode

  constructor(code: StdioFailureCode, message: string) {
    super(message)
    this.name = 'StdioError'
    this.code = code
  }
}

/** sealed 网关的保留单号（不与真实单据 id 冲突；外部无从得到可过闸凭据） */
const SEALED_TICKET = '__stdio-sealed__'
const SEALED_AUTHOR = 'stdio-sealed'
const SEALED_SIGNATURE_CTX: SignatureContext = {
  company: 'studio-tools',
  dept: 'stdio',
  role: 'sealed',
  level: 1,
}

/** deps 未装配的统一文案（库/stdio 一致性断言以它为准） */
const DEPS_UNAVAILABLE = {
  evidence: '证据落盘后端未装配',
  kb: '知识库检索后端未装配',
  budget: '预算视图后端未装配',
} as const

const DEPS_UNAVAILABLE_SUFFIX = '（stdio 入口不持有 IO，由宿主注入 deps）'

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function configInvalid(message: string): StdioError {
  return new StdioError('stdio-config-invalid', message)
}

/** 64 位十六进制 → 32 字节 HMAC 密钥（形状非法即启动失败，不猜编码） */
function decodeGatewaySecret(raw: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw configInvalid(`${STDIO_ENV_KEYS.gatewaySecret} 须为 64 位十六进制（32 字节 HMAC-SHA256 密钥）`)
  }
  return new Uint8Array(Buffer.from(raw, 'hex'))
}

/** 署名上下文 JSON 形状校验（四段全填充；错误消息不带值） */
function parseSignatureContext(raw: string): SignatureContext {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext} 须为 JSON 对象`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext} 须为 JSON 对象`)
  }
  const record = parsed as Record<string, unknown>
  const company = record['company']
  const dept = record['dept']
  const role = record['role']
  const level = record['level']
  if (typeof company !== 'string' || company === '') {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext}.company 须为非空字符串`)
  }
  if (typeof dept !== 'string' || dept === '') {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext}.dept 须为非空字符串`)
  }
  if (typeof role !== 'string' || role === '') {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext}.role 须为非空字符串`)
  }
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) {
    throw configInvalid(`${STDIO_ENV_KEYS.signatureContext}.level 须为 >=1 的整数`)
  }
  return { company, dept, role, level }
}

export interface StdioGatewayResolution {
  readonly gateway: Gateway
  readonly wkey: string | undefined
  /** configured=env 给了 secret；sealed=零配置启动（永不接受外部凭据） */
  readonly mode: 'configured' | 'sealed'
}

/**
 * 从进程环境装配 stdio 面网关（零 IO，除随机 sealed 密钥）。
 *
 * 零配置 → sealed：进程可启动并响应 tools/list，但任何 token 都过不了 HMAC（fail-closed）。
 * 给 secret 就必须给齐 ticket/author/signatureContext——缺一即启动失败，不猜身份。
 */
export function createStdioGateway(
  env: NodeJS.ProcessEnv = process.env,
  clock: () => number = Date.now,
): StdioGatewayResolution {
  const wkey = nonEmpty(env[STDIO_ENV_KEYS.wkey])
  const secretRaw = nonEmpty(env[STDIO_ENV_KEYS.gatewaySecret])
  if (secretRaw === undefined) {
    if (wkey !== undefined) {
      throw configInvalid(
        `${STDIO_ENV_KEYS.wkey} 已给但缺 ${STDIO_ENV_KEYS.gatewaySecret}：stdio 无法校验 wkey（fail-closed，不静默降级）`,
      )
    }
    return {
      gateway: createGateway({
        secret: randomBytes(32),
        clock,
        ticket: SEALED_TICKET,
        ctx: SEALED_SIGNATURE_CTX,
        author: SEALED_AUTHOR,
      }),
      wkey: undefined,
      mode: 'sealed',
    }
  }
  const ticket = nonEmpty(env[STDIO_ENV_KEYS.ticket])
  if (ticket === undefined) {
    throw configInvalid(`缺 ${STDIO_ENV_KEYS.ticket}（wkey 单号绑定锚，不得缺省猜测）`)
  }
  const author = nonEmpty(env[STDIO_ENV_KEYS.author])
  if (author === undefined) {
    throw configInvalid(`缺 ${STDIO_ENV_KEYS.author}（署名工号，不得缺省猜测）`)
  }
  const ctxRaw = nonEmpty(env[STDIO_ENV_KEYS.signatureContext])
  if (ctxRaw === undefined) {
    throw configInvalid(`缺 ${STDIO_ENV_KEYS.signatureContext}（署名上下文，不得缺省猜测）`)
  }
  return {
    gateway: createGateway({
      secret: decodeGatewaySecret(secretRaw),
      clock,
      ticket,
      ctx: parseSignatureContext(ctxRaw),
      author,
    }),
    wkey,
    mode: 'configured',
  }
}

/**
 * deps 的 fail-closed 默认实现：三方法一律抛错（server.ts 归类 deps 族，不渲染成功）。
 * 宿主需要真 IO 时经 StudioToolsStdioOptions.deps 注入，本入口不读台账/证据目录。
 */
export function createFailClosedDeps(): StudioToolsDeps {
  const unavailable = (message: string): never => {
    throw new Error(`${message}${DEPS_UNAVAILABLE_SUFFIX}`)
  }
  return {
    writeEvidence: async () => unavailable(DEPS_UNAVAILABLE.evidence),
    searchKb: async () => unavailable(DEPS_UNAVAILABLE.kb),
    queryBudget: async () => unavailable(DEPS_UNAVAILABLE.budget),
  }
}

export interface StudioToolsStdioOptions {
  /** 注入网关（库形态/测试）；缺省走 env 装配（bin 形态） */
  readonly gateway?: Gateway | undefined
  /** 注入 IO 后端；缺省 fail-closed 三方法 */
  readonly deps?: StudioToolsDeps | undefined
  /** 宿主直注 wkey（优先于 env；注入 gateway 时 env 的 STUDIO_TOOLS_WKEY 不参与组装） */
  readonly wkey?: string | undefined
  readonly serverInfo?: Implementation | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly stdin?: Readable | undefined
  readonly stdout?: Writable | undefined
  readonly stderr?: Writable | undefined
}

export interface StudioToolsStdioHandle {
  readonly server: StudioToolsServer
  readonly transport: StdioServerTransport
  readonly gatewayMode: 'configured' | 'sealed' | 'injected'
  readonly wkeySource: 'env' | 'host' | 'none'
  close(): Promise<void>
}

function writeDiagnostic(stderr: Writable, line: string): void {
  try {
    stderr.write(`[studio-tools] ${line}\n`)
  } catch {
    // stderr 不可写不阻断协议面：诊断是尽力而为，协议错误仍由 MCP 层给出结果
  }
}

/**
 * 启动 MCP stdio 服务（读 stdin / 写 stdout）并返回句柄。
 *
 * 单进程单连接语义（MCP stdio 绑定）：不处理多连接/重连；stdin 关闭即传输关闭。
 * 启动失败抛 StdioError（config-invalid）或 stdio-startup-failed，由 bin 非零退出。
 */
export async function startStudioToolsStdio(
  opts: StudioToolsStdioOptions = {},
): Promise<StudioToolsStdioHandle> {
  const env = opts.env ?? process.env
  const stderr = opts.stderr ?? process.stderr
  const resolved: {
    gateway: Gateway
    wkey: string | undefined
    mode: 'configured' | 'sealed' | 'injected'
  } =
    opts.gateway === undefined
      ? createStdioGateway(env)
      : { gateway: opts.gateway, wkey: undefined, mode: 'injected' }
  const wkey = opts.wkey ?? resolved.wkey
  const wkeySource: 'env' | 'host' | 'none' =
    opts.wkey !== undefined ? 'host' : resolved.wkey !== undefined ? 'env' : 'none'
  const server = createStudioToolsServer({
    gateway: resolved.gateway,
    deps: opts.deps ?? createFailClosedDeps(),
    ...(wkey !== undefined ? { wkey } : {}),
    ...(opts.serverInfo !== undefined ? { serverInfo: opts.serverInfo } : {}),
  })
  const transport = new StdioServerTransport(opts.stdin ?? process.stdin, opts.stdout ?? process.stdout)
  writeDiagnostic(stderr, `stdio listening (gateway=${resolved.mode}, wkey=${wkeySource})`)
  try {
    await server.connect(transport)
  } catch (err) {
    await transport.close().catch(() => undefined)
    throw new StdioError('stdio-startup-failed', err instanceof Error ? err.message : String(err))
  }
  let closed = false
  return {
    server,
    transport,
    gatewayMode: resolved.mode,
    wkeySource,
    close: async () => {
      if (closed) return
      closed = true
      await server.close()
    },
  }
}

/** bin 主流程：启动 stdio 服务；启动成功即返回 0（stdin 监听让进程存活到 EOF） */
export async function main(opts: StudioToolsStdioOptions = {}): Promise<number> {
  const stderr = opts.stderr ?? process.stderr
  try {
    await startStudioToolsStdio(opts)
    return 0
  } catch (err) {
    const code: StdioFailureCode = err instanceof StdioError ? err.code : 'stdio-startup-failed'
    const message = err instanceof Error ? err.message : String(err)
    try {
      stderr.write(`[studio-tools] ${code}: ${message}\n`)
    } catch {
      // 同 writeDiagnostic：stderr 不可写不改变退出码
    }
    return 1
  }
}

/** 被当主模块执行判定（被 import 时不得拉起 stdio；软链入口用 realpath 归一） */
function isExecutedDirectly(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isExecutedDirectly()) {
  const exitCode = await main()
  if (exitCode !== 0) process.exitCode = exitCode
}
