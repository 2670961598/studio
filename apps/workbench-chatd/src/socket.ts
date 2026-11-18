/**
 * workbench-chatd Unix socket 绑定（Phase1 模块 A / P1-1b）。
 * 依据：提案-Phase1聊天服务-2026-11-17.md §1.1（Unix socket 非 TCP；文件权限收紧；非 TCP/loopback-only）。
 * 纪律：socket 文件权限 0700；父目录按需创建（0700）；已占用（活监听者）拒绝抢绑；
 *       陈旧文件（kill -9 残留，ECONNREFUSED/ENOENT）清理后重绑。
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { connect, createServer, type Server, type Socket } from 'node:net'

export class SocketBindError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocketBindError'
  }
}

/** 探测既有 socket 文件背后是否有活监听者：可连=alive；ECONNREFUSED/ENOENT=stale；其余错误保守拒绝。 */
function probeSocket(socketPath: string, timeoutMs: number): Promise<'alive' | 'stale'> {
  return new Promise<'alive' | 'stale'>((resolve, reject) => {
    const socket = connect(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new SocketBindError(`探测既有 socket 超时（${String(timeoutMs)}ms）：${socketPath}`))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve('alive')
    })
    socket.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      socket.destroy()
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') resolve('stale')
      else reject(new SocketBindError(`探测既有 socket 失败（${err.code ?? 'unknown'}）：${socketPath}`))
    })
  })
}

/**
 * 绑定 Unix socket：mkdir 父目录 → 清理陈旧 socket（仅无监听者时）→ listen → chmod 0700。
 * 已有活监听者时抛 SocketBindError（防止双实例抢同一公司 socket）。
 */
export async function bindUnixSocket(socketPath: string, onConnection: (socket: Socket) => void): Promise<Server> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
  if (existsSync(socketPath)) {
    const st = lstatSync(socketPath)
    if (!st.isSocket()) throw new SocketBindError(`socket 路径被非 socket 文件占用：${socketPath}`)
    const probe = await probeSocket(socketPath, 300)
    if (probe === 'alive') throw new SocketBindError(`socket 已被活实例占用（拒绝抢绑）：${socketPath}`)
    unlinkSync(socketPath)
  }
  const server = createServer(onConnection)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  chmodSync(socketPath, 0o700)
  return server
}

/** 停机后清理 socket 文件（尽力而为；只删 socket 类型文件）。 */
export function removeSocketFile(socketPath: string): void {
  try {
    if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath)
  } catch {
    // 清理失败不阻断停机流程
  }
}
