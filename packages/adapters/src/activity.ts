/**
 * activity —— executor 侧活性探测（看门狗活性锚的 adapter 面；studio-dev-505）
 *
 * 规格依据（实现单引用）：
 *   - docs/02-F1-08 看门狗三道（wrap 墙钟 kill / daemon 侧兜底 / 心跳超时）：daemon 侧
 *     兜底的判定面=「工人活性」而非平台单据字段——本件提供 worker 侧活性证据；
 *   - docs/v2/07-§三 EXEC-01/EXEC-02：派发简报含看护参数；长周期工作必设进展信号、
 *     活性观察面独立于交付者自述；EXEC-03「常态更新不得杀活 worker」；
 *   - docs/17-§6 dsh 行：会话落盘形态=session.v4.jsonl.zstd（真机实测 mtime 随写）。
 *
 * 边界（不扩 ExecutorAdapter 契约）：本件是**纯探测辅助函数**，不新增端口方法、不改
 * ExecutorAdapter 接口（契约面零变更）；daemon 按 executor 名选择探测策略。未登记探测
 * 的 executor 如实返回 unavailable（不猜活性），由 daemon 回退到流事件/进程探测。
 *
 * 语义：lastActivityAt=会话文件 mtime（worker 最后写入时刻）。「会话文件存在」不等于
 * 「进程活着」——活性判定与存活判定是两件事，daemon 侧组合使用（docs/v2/07 EXEC-05）。
 * 会话目录按 `<DSH_HOME>/sessions/<cwd 编码>/session-<executorSessionId>/` 定位；cwd 编码
 * 属 dsh 私有格式，本件**不复制编码算法**（按 session id 目录名精确匹配扫描，结果缓存），
 * 避免把 dsh 内部实现漂移引入框架。
 */
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 探测结果（unavailable 时 lastActivityAt 缺省，reason 如实） */
export interface ActivityProbe {
  /** worker 最后写入时刻 epoch-ms（available 时必有） */
  readonly lastActivityAt?: number
  /** 证据来源（本件只产 session-mtime） */
  readonly source: 'session-mtime'
  /** 可读归因（台账 note 用；不含凭据/绝对路径以外敏感值） */
  readonly detail: string
  /** 命中的会话文件（证据锚） */
  readonly sessionPath?: string
  /** unavailable 归因 */
  readonly reason?: 'no-probe-registered' | 'session-id-unknown' | 'session-id-invalid' | 'not-found' | 'read-error'
}

/** 探测入参 */
export interface ActivityProbeInput {
  /** executor 注册名（dsh/dsh-mid/dsh-high/dsh-low/...） */
  readonly executor: string
  /** executor 侧会话 id（Handle.executorSessionId） */
  readonly executorSessionId?: string
  /** DS H 家目录覆盖（缺省 env DSH_HOME → ~/.dsh） */
  readonly dshHome?: string
  /** 当前时刻（缺省 Date.now；测试注入） */
  readonly now?: number
  /** 未命中缓存重扫间隔 ms（缺省 30_000——避免每拍全目录扫描） */
  readonly missRetryMs?: number
}

/** 会话 id 白名单形状：禁止路径分隔/上跳（防目录穿越；dsh 原生 id 为 UUID 形） */
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,200}$/

/** 解析缓存：`<sessionsRoot>|<sessionId>` → 命中路径 / 未命中时间戳 */
const cache = new Map<string, { path?: string; checkedAt: number }>()

/** 探测缓存清空（测试与长跑进程卫生面） */
export function clearActivityProbeCache(): void {
  cache.clear()
}

/** executor 是否走 dsh 会话探测（dsh 家族：dsh / dsh-mid / dsh-high / dsh-low） */
export function usesDshSessionProbe(executor: string): boolean {
  return executor === 'dsh' || executor.startsWith('dsh-')
}

/** dsh 会话根（`<DSH_HOME>/sessions`） */
export function dshSessionsRoot(dshHome?: string): string {
  const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/**
 * 定位 `session-<executorSessionId>` 目录（扫描 sessions 根一层；命中缓存）。
 * 返回会话目录内最新 `session.*` 文件的 mtime。
 */
function probeDshSession(input: ActivityProbeInput): ActivityProbe {
  const id = input.executorSessionId
  const now = input.now ?? Date.now()
  if (id === undefined || id === '') return { source: 'session-mtime', reason: 'session-id-unknown', detail: 'executorSessionId 未登记（流首会话事件前/旧 handle）' }
  if (!SESSION_ID_RE.test(id)) return { source: 'session-mtime', reason: 'session-id-invalid', detail: `executorSessionId 形状非法（拒路径穿越）：${id.slice(0, 40)}` }
  const root = dshSessionsRoot(input.dshHome)
  const key = `${root}|${id}`
  const cached = cache.get(key)
  const missRetryMs = input.missRetryMs ?? 30_000
  if (cached !== undefined && (cached.path !== undefined || now - cached.checkedAt < missRetryMs)) {
    if (cached.path === undefined) return { source: 'session-mtime', reason: 'not-found', detail: `会话目录未命中（缓存）root=${root}` }
    return statSessionDir(cached.path, id)
  }
  let dirs: string[]
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    cache.set(key, { checkedAt: now })
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { source: 'session-mtime', reason: 'not-found', detail: `sessions 根不存在（dsh 未起过/家目录未落）：${root}` }
    }
    return { source: 'session-mtime', reason: 'read-error', detail: `sessions 根不可读：${err instanceof Error ? err.message : String(err)}` }
  }
  for (const dir of dirs) {
    const sessionDir = join(root, dir, `session-${id}`)
    try {
      if (statSync(sessionDir).isDirectory()) {
        cache.set(key, { path: sessionDir, checkedAt: now })
        return statSessionDir(sessionDir, id)
      }
    } catch {
      // 未命中目录——继续扫描（ENOENT 是常态，不记错）
    }
  }
  cache.set(key, { checkedAt: now })
  return { source: 'session-mtime', reason: 'not-found', detail: `会话目录未命中（已扫描 ${dirs.length} 个 cwd 槽）root=${root}` }
}

/** 会话目录内最新 `session.*` 文件的 mtime */
function statSessionDir(sessionDir: string, id: string): ActivityProbe {
  try {
    const files = readdirSync(sessionDir).filter((f) => f.startsWith('session.'))
    let last: number | undefined
    let hit: string | undefined
    for (const f of files) {
      const st = statSync(join(sessionDir, f))
      if (st.isFile() && (last === undefined || st.mtimeMs > last)) {
        last = st.mtimeMs
        hit = join(sessionDir, f)
      }
    }
    if (last === undefined) return { source: 'session-mtime', reason: 'not-found', detail: `会话目录无 session.* 文件（id=${id}）` }
    return {
      source: 'session-mtime',
      lastActivityAt: last,
      ...(hit !== undefined ? { sessionPath: hit } : {}),
      detail: `会话 mtime=${new Date(last).toISOString()}（id=${id}）`,
    }
  } catch (err) {
    return { source: 'session-mtime', reason: 'read-error', detail: `会话目录不可读：${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * 探测 executor 活性（当前唯一实现=dsh 会话 mtime；其余如实 unavailable）。
 * 纯读、无副作用（缓存仅进程内观测加速，可清空重建）。
 */
export function probeExecutorActivity(input: ActivityProbeInput): ActivityProbe {
  if (!usesDshSessionProbe(input.executor)) {
    return { source: 'session-mtime', reason: 'no-probe-registered', detail: `executor=${input.executor} 未登记会话探测（由 daemon 回退流事件/进程探测）` }
  }
  return probeDshSession(input)
}
