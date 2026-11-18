/**
 * 测试支撑：最小 NDJSON 原始客户端（仅测试用；P1-1b）。
 * 与 WorkbenchTransport 客户端同一帧格式，但直接暴露帧/连接细节，
 * 供鉴权、协议错误、drain 等「服务端视角」断言使用（不经客户端归一化）。
 */
import { createConnection, type Socket } from 'node:net'

export interface WbErrorBody {
  readonly code: string
  readonly message: string
  readonly retryable?: boolean
}
export type WbFrame = { readonly id: string; readonly ok: true; readonly result: unknown } | { readonly id: string; readonly ok: false; readonly error: WbErrorBody }

export interface RawClient {
  /** 发送请求帧并等待同 id 响应。 */
  call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<WbFrame>
  /** 等待下一个任意帧（协议错误响应 id=unknown 等场景）。 */
  next(timeoutMs?: number): Promise<WbFrame>
  /** 直接写一行（构造非法帧用）。 */
  sendLine(line: string): void
  close(): void
}

export function connectNdjson(socketPath: string, connectTimeoutMs = 2_000): Promise<RawClient> {
  return new Promise<RawClient>((resolve, reject) => {
    const socket = createConnection({ path: socketPath })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`raw client 连接超时：${socketPath}`))
    }, connectTimeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(makeClient(socket))
    })
    socket.once('error', (err: Error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    })
  })
}

function makeClient(socket: Socket): RawClient {
  socket.setEncoding('utf8')
  let buffer = ''
  let seq = 0
  const frames: WbFrame[] = []
  const waiters: ((frame: WbFrame) => void)[] = []
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.trim() === '') continue
      const frame = JSON.parse(line) as WbFrame
      const waiter = waiters.shift()
      if (waiter === undefined) frames.push(frame)
      else waiter(frame)
    }
  })
  const next = (timeoutMs = 5_000): Promise<WbFrame> => {
    const buffered = frames.shift()
    if (buffered !== undefined) return Promise.resolve(buffered)
    return new Promise<WbFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(resolve)
        if (i >= 0) waiters.splice(i, 1)
        reject(new Error(`raw client 等待帧超时（${String(timeoutMs)}ms）`))
      }, timeoutMs)
      waiters.push((frame) => {
        clearTimeout(timer)
        resolve(frame)
      })
    })
  }
  return {
    async call(method, params = {}, timeoutMs = 5_000): Promise<WbFrame> {
      seq += 1
      const id = `raw-${String(seq)}`
      socket.write(`${JSON.stringify({ id, method, params })}\n`)
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const frame = await next(Math.max(10, deadline - Date.now()))
        if (frame.id === id) return frame
      }
    },
    next,
    sendLine(line: string): void {
      socket.write(`${line}\n`)
    },
    close(): void {
      socket.destroy()
    },
  }
}
