/**
 * WorkbenchTransport v1 客户端（Unix socket + NDJSON）。
 * 责任：连接/超时/断线重连、request id 关联、服务端稳定错误码透传；不做业务缓存。
 * 断线：在途请求 → WB_UNAVAILABLE；下一次请求自动重连（指数退避由调用方/上层决定，本类只做一次即时重连）。
 */
import { createConnection, type Socket } from 'node:net'
import { WorkbenchTransportError } from './errors.ts'
import {
  WORKBENCH_TRANSPORT_PROTOCOL,
  type AckResult,
  type ClaimResult,
  type HealthResult,
  type InboxResult,
  type MessagePage,
  type ReadResult,
  type Room,
  type SendResult,
  type WbError,
  type WbMethod,
  type WbResponse,
} from './types.ts'

export interface WorkbenchTransportOptions {
  readonly socketPath: string
  readonly connectTimeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly makeId?: () => string
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: WorkbenchTransportError) => void
  readonly timer: ReturnType<typeof setTimeout>
}

const DEFAULT_CONNECT_TIMEOUT_MS = 1_000
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000

export class WorkbenchTransport {
  private readonly socketPath: string
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly makeId: () => string
  private socket: Socket | undefined
  private connecting: Promise<Socket> | undefined
  private buffer = ''
  private seq = 0
  private readonly pending = new Map<string, Pending>()
  private closed = false

  constructor(options: WorkbenchTransportOptions) {
    this.socketPath = options.socketPath
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.makeId = options.makeId ?? (() => `req-${String(++this.seq)}`)
  }

  get isConnected(): boolean {
    return this.socket !== undefined && !this.socket.destroyed && this.socket.readyState === 'open'
  }

  async health(): Promise<HealthResult> { return (await this.request('health', {})) as HealthResult }
  // rooms.list 参面（M4-3 面板聊天室接线带出）：可选 input 原样上帧（token 附加形参——其余方法同款
  // 判例；缺省 {} 与 v1 既有 wire 完全一致）。此前无参面导致 chatd 配 token 时 rooms.list 无法携凭据
  // （调用方传参被静默丢弃——daemon chatd-mention-source.roomNames 同款假设，现补齐）。
  async listRooms(input: { token?: string } = {}): Promise<readonly Room[]> { return (await this.request('rooms.list', input)) as readonly Room[] }
  async createRoom(input: { kind: Room['kind']; name: string; memberIds?: readonly string[] }): Promise<Room> {
    return (await this.request('rooms.create', input)) as Room
  }
  async sendMessage(input: { roomId: string; senderId: string; body: string; mentions?: readonly string[]; idempotencyKey?: string }): Promise<SendResult> {
    return (await this.request('messages.send', input)) as SendResult
  }
  async listMessages(input: { roomId: string; actorId: string; limit?: number; cursor?: string }): Promise<MessagePage> {
    return (await this.request('messages.list', input)) as MessagePage
  }
  async read(input: { roomId: string; actorId: string; upToRoomSeq: number; idempotencyKey?: string }): Promise<ReadResult> {
    return (await this.request('read', input)) as ReadResult
  }
  async inbox(input: { actorId: string; roomIds?: readonly string[] }): Promise<InboxResult> {
    return (await this.request('inbox', input)) as InboxResult
  }
  async claimWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string }): Promise<ClaimResult> {
    return (await this.request('wakes.claim', input)) as ClaimResult
  }
  async ackWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string }): Promise<AckResult> {
    return (await this.request('wakes.ack', input)) as AckResult
  }

  /** 主动关闭（幂等）；在途请求全部 WB_UNAVAILABLE。 */
  close(): void {
    this.closed = true
    this.failAll(new WorkbenchTransportError({ code: 'WB_NOT_CONNECTED', message: 'transport closed' }))
    this.socket?.destroy()
    this.socket = undefined
  }

  private async connect(): Promise<Socket> {
    if (this.closed) throw new WorkbenchTransportError({ code: 'WB_NOT_CONNECTED', message: 'transport closed' })
    if (this.isConnected) return this.socket as Socket
    if (this.connecting !== undefined) return this.connecting
    this.connecting = new Promise<Socket>((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new WorkbenchTransportError({ code: 'WB_TIMEOUT', message: `connect timeout after ${String(this.connectTimeoutMs)}ms`, retryable: true }))
      }, this.connectTimeoutMs)
      const onConnect = (): void => {
        clearTimeout(timer)
        socket.off('error', onError)
        this.socket = socket
        this.attach(socket)
        resolve(socket)
      }
      const onError = (err: Error): void => {
        clearTimeout(timer)
        socket.destroy()
        reject(new WorkbenchTransportError({ code: 'WB_UNAVAILABLE', message: err.message, retryable: true }))
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
    }).finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private attach(socket: Socket): void {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      this.buffer += chunk
      let index = this.buffer.indexOf('\n')
      while (index >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1)
        if (line.trim() !== '') this.onLine(line)
        index = this.buffer.indexOf('\n')
      }
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined
      this.failAll(new WorkbenchTransportError({ code: 'WB_UNAVAILABLE', message: 'socket closed', retryable: true }))
    })
    socket.on('error', () => {
      // close 处理统一失败面；error 不重复抛
    })
  }

  private onLine(line: string): void {
    let response: WbResponse
    try { response = JSON.parse(line) as WbResponse } catch {
      this.failAll(new WorkbenchTransportError({ code: 'WB_PROTOCOL', message: 'invalid JSON frame' })); return
    }
    if (typeof response !== 'object' || response === null || typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      this.failAll(new WorkbenchTransportError({ code: 'WB_PROTOCOL', message: 'invalid response shape' })); return
    }
    const pending = this.pending.get(response.id)
    if (pending === undefined) return // late response after timeout：丢弃
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new WorkbenchTransportError(response.error))
  }

  private async request(method: WbMethod, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    const socket = await this.connect()
    const id = this.makeId()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new WorkbenchTransportError({ code: 'WB_TIMEOUT', message: `request ${method} timeout after ${String(timeoutMs)}ms`, retryable: true, details: { method } }))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      socket.write(`${JSON.stringify({ id, method, params })}\n`, (err) => {
        if (err !== undefined && err !== null) {
          const p = this.pending.get(id)
          if (p !== undefined) { this.pending.delete(id); clearTimeout(p.timer); reject(new WorkbenchTransportError({ code: 'WB_UNAVAILABLE', message: err.message, retryable: true })) }
        }
      })
    })
  }

  private failAll(error: WorkbenchTransportError): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id); clearTimeout(p.timer); p.reject(error)
    }
    this.buffer = ''
  }
}

export { WORKBENCH_TRANSPORT_PROTOCOL }
export type { WbError }
