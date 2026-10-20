/**
 * stop-channel —— 控制面停机通道（CLI `studio-next stop` ↔ daemon，文件协议）
 *
 * 动机（DEV-9 P1 顺带项，2026-10-19 生产事故处置）：daemon 以 `nohup sh -c "…"` 双层壳
 * 起进程，运维 kill 壳（外层 sh）后 node 子进程存活成孤儿——kill 壳未杀孙。停机改走
 * daemon 自身优雅停（runtime.stop：停唤起源 → 在途 drain → engine.dispose() 对 worker
 * 整树 SIGTERM→SIGKILL），运维经控制面文件请求，不再依赖进程树外部信号猜 PID。
 *
 * 协议与 reload 手动通道同款（src/control/hot-reload.ts 控制面文件通道；拍边界纪律 docs/38-§2）：
 *   CLI：writeStopRequest（tmp+rename 原子写）→ awaitStopResult（轮询至 id 匹配）
 *   daemon：拍边界读请求（hotReload.check() 之后——停机前先把积压 reload 应答掉）→
 *           置停机标 → 主循环退出 → 优雅停收口 → writeStopResult 回执落盘
 *   幂等（DEV-41 修复，2026-10-20 daemon-taiga6 一拍自停事故——旧口径「请求文件不删 +
 *   lastSeenId 内存去重」在 daemon 重启后失忆：残留请求被当新请求消费，新进程起一拍即
 *   自我停机；应急曾是清 control 目录重启）：
 *     ① 去重位落 daemon_kv（键 STOP_LAST_SEEN_KV_KEY）——重启读回，与请求 id 比对去重；
 *     ② 请求消费后原子改名 .consume——live 面清空，新进程见无请求即正常起（消费件留档
 *       =最近一次已应答请求，单文件覆写有界不堆积）。
 *   回执文件**保留**：CLI 轮询按 id 匹配 stop.result.json、不读请求文件——②消费不碍
 *   兼容；旧回执不误读，重发请求（新 id）再得新回执。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { controlDirOf } from './hot-reload.ts'

export const STOP_REQUEST_FILE = 'stop.request.json'
export const STOP_RESULT_FILE = 'stop.result.json'
/**
 * 消费后的请求文件名（DEV-41 ②：live 请求原子改名至此——新进程见无 live 请求即正常起；
 * 留档=最近一次已应答请求，单文件覆写有界）。CLI 不读请求文件（只轮询回执按 id 匹配），
 * live 面清空不碍兼容。
 */
export const STOP_REQUEST_CONSUMED_FILE = `${STOP_REQUEST_FILE}.consume`
/**
 * 停机请求去重位的 daemon_kv 键（DEV-41 ①：lastSeenId 落台账跨重启——serve.ts 消费时先
 * 落 kv 再改名，重启读回与请求 id 比对；与 engine 的 'activity.cursor' / 'tick.seq' 同表
 * 同命名法，见 packages/store migrations v4）。
 */
export const STOP_LAST_SEEN_KV_KEY = 'stop.lastSeenId'

/** stop 请求（CLI 写；reason=运维口径的停机事由，随回执透传） */
export interface StopRequest {
  id: string
  requestedAt: number
  reason?: string
}

/** stop 回执（daemon 写；ok+stopped=true=优雅停收口完成；CLI 轮询至 id 匹配） */
export interface StopResult {
  id: string
  ok: boolean
  stopped: boolean
  reason?: string
  detail?: string
}

/** CLI 侧：原子写请求（tmp+rename——daemon 读到的恒是完整 JSON） */
export function writeStopRequest(rootDir: string, request: StopRequest): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, STOP_REQUEST_FILE)
  const tmp = `${target}.tmp-${request.id}`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** daemon 侧：读请求（无文件/坏 JSON → undefined——控制面文件坏不当停机，下拍再看） */
export function readStopRequest(rootDir: string): StopRequest | undefined {
  const target = path.join(controlDirOf(rootDir), STOP_REQUEST_FILE)
  if (!existsSync(target)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<StopRequest>
    if (typeof parsed.id !== 'string' || parsed.id === '') return undefined
    return {
      id: parsed.id,
      requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0,
      ...(typeof parsed.reason === 'string' && parsed.reason !== '' ? { reason: parsed.reason } : {}),
    }
  } catch {
    return undefined
  }
}

/** daemon 侧：写回执（原子写；CLI 按 id 匹配消费——在优雅停收口**之后**落） */
export function writeStopResult(rootDir: string, result: StopResult): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, STOP_RESULT_FILE)
  const tmp = `${target}.tmp-${result.id}`
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/**
 * daemon 侧：消费请求（DEV-41 ②，2026-10-20 daemon-taiga6 事故修复）——决定应答停机请求
 * 时把 live 请求原子改名 .consume（POSIX rename 语义：目标已存在则原子替换——留档恒为
 * 最近一次已应答请求，有界）。改名后 live 面清空：daemon 重启见无请求即正常起，不再起一
 * 拍自停。调用序（serve.ts）：**先**落 ①daemon_kv 去重位**再**本函数——改名前崩溃的窗口
 * 由 kv 读回去重兜底。返回是否成功：失败（并发覆写/fs 异常）不阻断停机——去重已在 kv。
 */
export function consumeStopRequest(rootDir: string): boolean {
  const dir = controlDirOf(rootDir)
  try {
    renameSync(path.join(dir, STOP_REQUEST_FILE), path.join(dir, STOP_REQUEST_CONSUMED_FILE))
    return true
  } catch {
    return false
  }
}

/** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢；提示见命令面） */
export async function awaitStopResult(rootDir: string, id: string, timeoutMs: number, pollMs = 100): Promise<StopResult | undefined> {
  const target = path.join(controlDirOf(rootDir), STOP_RESULT_FILE)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<StopResult>
        if (parsed.id === id) {
          return {
            id: parsed.id as string,
            ok: parsed.ok === true,
            stopped: parsed.stopped === true,
            ...(parsed.reason !== undefined ? { reason: String(parsed.reason) } : {}),
            ...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}),
          }
        }
      } catch {
        // 坏 JSON/读到写一半：下轮再读（daemon 侧原子写使本分支近不可达——兜底不炸）
      }
    }
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
