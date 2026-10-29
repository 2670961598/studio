/**
 * assembly/api/live —— API 监听壳（node:http ＋ Hono `app.fetch`；零新框架依赖）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（对外 API 面装配＝daemon 同进程注入；**默认绑定＝环回 127.0.0.1**，
 *     显式旗标才开放局域网——V2 裁决取 fail-closed 方向；错误体唯一形状
 *     `{ error:{failure,category,subcause}, traceId }`）；
 *   - docs/v2/15 §4.4（SEC-SEC-04：API 响应＝五出口之一，出站文本过统一闸；无扫描通道的
 *     出口登记缺口、不静默放行）——本壳把 JSON 响应交装配注入的 `guardResponse`
 *     （＝wireOutboundGate().guardApiResponse），闸阻断＝原响应不出站（500 固定错误体）；
 *   - docs/v2/16 §三 api 行 / plan/05 IMPL-06-06（监听壳不引 @hono/node-server：node:http
 *     作 fetch 适配器，零新增 HTTP 框架依赖）。
 *
 * 纪律：
 *   - **不写日志到 stdout**：本件零 console；启动/缺口行由装配面（serve-face）经注入 log 打印；
 *   - port=0＝ephemeral（缺省形态：不抢 :8788，生产在 daemon.yaml 显式指定）；
 *   - 只绑环回：`host` 缺省 127.0.0.1；开放局域网需要显式旗标装配面（当前未落位＝缺口，
 *     不默认监听 0.0.0.0）；
 *   - 响应面闸只扫 JSON（`application/json`/`+json`）：SSE（text/event-stream）等流式面直通
 *     ——流式内容不吃「读全文再重写」的路径；非 JSON 面由各自端点承担出站义务。
 *   - 断连取消：请求侧 AbortSignal 传 Hono；响应侧 pipe 冲突即销毁上游流；
 *   - 请求体上限＝API 端点同源常量（`MAX_REQUEST_BODY_BYTES`，不另造阈值）：超限在监听壳
 *     即 413（不把无限载荷先缓冲进内存再交给端点闸）。
 *
 * 目录口径（如实登记）：`outbound-gate/exits.ts` 的 `api-response` 行仍标 `gap`
 * （`api-response:api-assembly-not-wired`）——本单领土不含该文件与 security/outbound.test.ts，
 * 故不翻转目录状态：**实质通道已在本壳接线（JSON 响应过 guardApiResponse）**，目录翻转归
 * 后续单（不伪造 coverage 已覆盖）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { configInvalid } from '@studio-next/contract'
import { MAX_REQUEST_BODY_BYTES } from '@studio-next/api'
import type { ApiApp } from '@studio-next/api'

/** 监听选项（port=0 可 ephemeral；host 缺省环回） */
export interface ApiServerOptions {
  /** 监听端口（0＝ephemeral；1..65535＝显式端口） */
  readonly port: number
  /** 绑定地址（缺省 127.0.0.1——v2/14 §四 fail-closed 方向；LAN 暴露未落位＝缺口） */
  readonly host?: string
  /**
   * API 响应面出站闸 wrapper（第 5 出口；`wireOutboundGate().guardApiResponse`）。
   * 缺省＝不扫描（装配面须在启动日志显式登记该缺口——不静默放行）。
   */
  readonly guardResponse?: (payload: unknown) => unknown
}

/** 监听句柄（真端口＋优雅关闭：断全部连接含长连后关 server） */
export interface ApiServerHandle {
  /** 实际监听 URL（`http://<host>:<port>`；ephemeral 时 port 为系统分配值） */
  readonly url: string
  readonly port: number
  readonly host: string
  close(): Promise<void>
}

/** 请求侧逐出的逐跳头（host 走 URL、其余由 node:http 自管） */
const HOP_BY_HOP_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** 回写侧逐出的逐跳头（node:http 自管 chunked/连接语义） */
const HOP_BY_HOP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

/** 受闸响应体（错误体形状与 v2/14 §四同构；固定常量、不含原响应内容） */
const BLOCKED_RESPONSE_BODY = JSON.stringify({
  error: {
    failure: 'internal',
    category: 'degraded',
    subcause: 'api-response-blocked',
    detail: 'API 响应面出站闸阻断：原响应不出站（失败记录见失败台账 outbound-gate 行）',
  },
  traceId: 'api-response-gate',
})

/** 传输层兜底响应体（Hono 之前/之后的异常；不回显异常文本——防出站泄漏） */
const TRANSPORT_ERROR_BODY = JSON.stringify({
  error: { failure: 'internal', category: 'degraded', subcause: 'api-transport-error' },
  traceId: 'api-transport',
})

/** 请求体超限响应体（与 API 端点 413 同构；监听壳不缓冲超限载荷） */
const PAYLOAD_TOO_LARGE_BODY = JSON.stringify({
  error: { failure: 'payload-too-large', category: 'rejected_precondition', subcause: 'payload-too-large' },
  traceId: 'api-transport',
})

/** 请求体超限（监听壳层，先于 app.fetch） */
class PayloadTooLargeError extends Error {
  constructor() {
    super(`请求体超限（>${String(MAX_REQUEST_BODY_BYTES)} 字节）`)
    this.name = 'PayloadTooLargeError'
  }
}

/** 是否受响应闸面覆盖的 JSON 响应（SSE 等流式面与 204/304 无体响应直通） */
function isGuardedJson(response: Response): boolean {
  if (response.status === 204 || response.status === 304) return false
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('application/json') || contentType.includes('+json')
}

/** IncomingMessage → 标准 Request（断连经 AbortSignal 传给 Hono；body 仅非 GET/HEAD） */
async function toWebRequest(req: IncomingMessage, signal: AbortSignal): Promise<Request> {
  const host = typeof req.headers.host === 'string' && req.headers.host !== '' ? req.headers.host : '127.0.0.1'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_REQUEST.has(key) || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item)
  }
  const method = req.method ?? 'GET'
  let body: Uint8Array | null = null
  if (method !== 'GET' && method !== 'HEAD') {
    const declared = Number.parseInt(req.headers['content-length'] ?? '', 10)
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) throw new PayloadTooLargeError()
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      size += buffer.byteLength
      if (size > MAX_REQUEST_BODY_BYTES) throw new PayloadTooLargeError()
      chunks.push(buffer)
    }
    body = Buffer.concat(chunks)
  }
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method,
    headers,
    signal,
    ...(body !== null ? { body } : {}),
  })
}

/** 回写头（跳过逐跳头；重写体时 content-length 由本壳重算） */
function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE.has(key)) headers[key] = value
  })
  return headers
}

/** Response → ServerResponse 流式回写（SSE 同一条 pipe 路径；客户端断开 → 销毁上游流） */
async function pipeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, responseHeaders(response))
  if (response.body === null) {
    res.end()
    return
  }
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  res.on('close', () => {
    if (!res.writableEnded) nodeStream.destroy()
  })
  await new Promise<void>((resolve) => {
    nodeStream.on('error', () => {
      res.destroy()
      resolve()
    })
    res.on('close', () => resolve())
    nodeStream.pipe(res)
  })
}

/** 受闸 JSON 回写：读全文 → JSON → 出站闸 → 重序列化；闸阻断＝500 固定体（原响应不出站） */
async function guardedResponse(
  res: ServerResponse,
  response: Response,
  guardResponse: (payload: unknown) => unknown,
): Promise<void> {
  const text = await response.text()
  let guardedText: string
  try {
    const payload: unknown = text === '' ? null : JSON.parse(text)
    guardedText = JSON.stringify(guardResponse(payload))
  } catch {
    // 闸阻断/扫描异常：原响应不出站（fail-closed；闸侧失败记录已落台账）
    const body = Buffer.from(BLOCKED_RESPONSE_BODY, 'utf8')
    res.writeHead(500, { 'content-type': 'application/json', 'content-length': String(body.byteLength) })
    res.end(body)
    return
  }
  const body = Buffer.from(guardedText, 'utf8')
  res.writeHead(response.status, { ...responseHeaders(response), 'content-length': String(body.byteLength) })
  res.end(body)
}

/**
 * 起 API 监听（runServe 装配序调用；测试用 ephemeral 端口）。
 * @param app     `assembleApi().app`（Hono；进程内可 app.request 驱动）
 * @param options 端口/绑定地址/响应面出站闸 wrapper
 */
export async function startApiServer(app: ApiApp, options: ApiServerOptions): Promise<ApiServerHandle> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    configInvalid('api/live:port', `监听端口须为 0..65535 的整数（0＝ephemeral；实得 ${String(options.port)}）`)
  }
  const host = options.host ?? '127.0.0.1'
  const guardResponse = options.guardResponse
  const server = createServer((req, res) => {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    void toWebRequest(req, controller.signal)
      .then((request) => app.fetch(request))
      .then((response: Response) =>
        guardResponse !== undefined && isGuardedJson(response)
          ? guardedResponse(res, response, guardResponse)
          : pipeResponse(res, response),
      )
      .catch((err: unknown) => {
        if (res.headersSent) {
          res.destroy()
          return
        }
        // 客户端已断（断连取消路径）：不向销毁的响应写兜底体
        if (res.destroyed || res.writableEnded) return
        const tooLarge = err instanceof PayloadTooLargeError
        const body = Buffer.from(tooLarge ? PAYLOAD_TOO_LARGE_BODY : TRANSPORT_ERROR_BODY, 'utf8')
        res.writeHead(tooLarge ? 413 : 500, {
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
          connection: 'close',
        })
        res.end(body)
      })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err)
    server.once('error', onError)
    server.listen(options.port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  return {
    url: `http://${host}:${String(address.port)}`,
    port: address.port,
    host,
    close: async (): Promise<void> => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
