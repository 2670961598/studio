/**
 * workbench-chatd 配置（Phase1 模块 A / P1-1b）：全部经 env 注入，无配置文件、无命令行解析。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A（config/token）；
 *       提案-Phase1聊天服务-2026-11-17.md §1.1（socket/token 路径与 0600/0700 纪律）。
 * 边界：P1-1b 是 mock 骨架——不读公司目录、不建 chat.db、不接生产 daemon。
 * 鉴权默认 fail-closed：未配 token 即拒启（config_invalid）；仅显式
 * WORKBENCH_CHATD_ALLOW_NO_AUTH=1（mock/dev/test）允许免鉴权（启动仍告警 auth_disabled）。
 * token 供给两条（值优先，M4.5 运维件补文件面）：WORKBENCH_CHATD_TOKEN（值）；
 * WORKBENCH_CHATD_TOKEN_FILE（绝对路径，文件内容首尾空白修剪）——launchd 面零密钥入 plist。
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseLogLevel, type LogLevel } from './log.ts'
import type { StoreMode } from './store/types.ts'

export class ChatdConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatdConfigError'
  }
}

export interface ChatdConfig {
  /** Unix socket 路径（生产约定 <companyDir>/var/workbench/chat.sock；本骨架默认 tmpdir）。 */
  readonly socketPath: string
  /** 鉴权 token；undefined=未配置——仅当显式 WORKBENCH_CHATD_ALLOW_NO_AUTH=1（mock/dev/test）时允许，启动时告警。 */
  readonly token: string | undefined
  /** 每请求人工延迟（ms）：mock 观测/测试旋钮（超时/断连测试），生产为 0。 */
  readonly delayMs: number
  /** SIGTERM 后在途请求 drain 上限（ms）。 */
  readonly drainTimeoutMs: number
  readonly logLevel: LogLevel
  /**
   * SQLite 数据库文件绝对路径（Phase1 模块 C 最小刀）；undefined=内存 mock 模式（缺省，向后兼容）。
   * 由 env WORKBENCH_CHATD_DB 或 --memory 覆盖逻辑决定（见 loadConfig）。
   */
  readonly dbPath: string | undefined
  /** 存储模式派生值：dbPath===undefined → 'memory'，否则 'sqlite'。 */
  readonly storeMode: StoreMode
  /**
   * wake 租约 TTL（ms，P1-2 wake lease 最小刀）：claim 授予的租约在此时长内有效；
   * 过期后再次 claim 即重投（attempt+1，≤WAKE_MAX_DELIVERY_ATTEMPTS，超限 dead-letter）。
   * 缺省 30_000（与 P1-1b 硬编码口径一致）；测试旋钮经 env 注入，生产不设即缺省。
   */
  readonly wakeLeaseMs: number
}

export const ENV_KEYS = {
  socket: 'WORKBENCH_CHATD_SOCKET',
  token: 'WORKBENCH_CHATD_TOKEN',
  /** token 文件绝对路径（M4.5 ops/chatd-setup 生成的 launchd 面）：值 env 未设时从此文件读；
   *  读取失败/空文件=fail-closed 拒启。文件本身 0600 由安装脚本保证。 */
  tokenFile: 'WORKBENCH_CHATD_TOKEN_FILE',
  /** 免鉴权显式豁免开关：仅精确值 `1` 生效（mock/dev/test 专用；生产不得设置）。 */
  allowNoAuth: 'WORKBENCH_CHATD_ALLOW_NO_AUTH',
  /** SQLite 数据库绝对路径（C-mini）：设置即 sqlite 模式；缺省/空=内存 mock。 */
  db: 'WORKBENCH_CHATD_DB',
  /** wake 租约 TTL ms（P1-2 wake lease）：非负整数；缺省 30000；0=即过期（测试旋钮）。 */
  wakeLeaseMs: 'WORKBENCH_CHATD_WAKE_LEASE_MS',
  delayMs: 'WORKBENCH_CHATD_DELAY_MS',
  drainTimeoutMs: 'WORKBENCH_CHATD_DRAIN_TIMEOUT_MS',
  logLevel: 'WORKBENCH_CHATD_LOG',
} as const

function parseNonNegativeInt(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 0) throw new ChatdConfigError(`${key} 必须是非负整数，收到：${raw}`)
  return n
}

/** 从 env/argv 装配配置；非法值抛 ChatdConfigError（main 捕获后 exit 1）。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): ChatdConfig {
  const socketRaw = env[ENV_KEYS.socket]?.trim()
  const socketPath = socketRaw === undefined || socketRaw === '' ? path.join(tmpdir(), 'workbench-chatd.sock') : socketRaw
  if (!path.isAbsolute(socketPath)) throw new ChatdConfigError(`${ENV_KEYS.socket} 必须是绝对路径：${socketPath}`)

  // 存储模式（C-mini）：--memory 显式强制内存 mock（优先于 env）；否则 WORKBENCH_CHATD_DB 绝对路径即 sqlite。
  const memoryFlag = argv.includes('--memory')
  const dbRaw = env[ENV_KEYS.db]?.trim()
  let dbPath: string | undefined
  if (dbRaw !== undefined && dbRaw !== '') {
    if (!path.isAbsolute(dbRaw)) throw new ChatdConfigError(`${ENV_KEYS.db} 必须是绝对路径：${dbRaw}`)
    dbPath = dbRaw
  }
  if (memoryFlag && dbPath !== undefined) dbPath = undefined
  const storeMode: StoreMode = dbPath === undefined ? 'memory' : 'sqlite'

  const tokenRaw = env[ENV_KEYS.token]?.trim()
  let token: string | undefined = tokenRaw !== undefined && tokenRaw !== '' ? tokenRaw : undefined
  // 文件供给面（M4.5）：值 env 优先；无值 env 且给了文件路径 → 读文件（fail-closed：
  // 路径非绝对/不可读/空内容一律拒启——绝不静默降级为免鉴权）。
  if (token === undefined) {
    const tokenFileRaw = env[ENV_KEYS.tokenFile]?.trim()
    if (tokenFileRaw !== undefined && tokenFileRaw !== '') {
      if (!path.isAbsolute(tokenFileRaw)) throw new ChatdConfigError(`${ENV_KEYS.tokenFile} 必须是绝对路径：${tokenFileRaw}`)
      let content: string
      try {
        content = readFileSync(tokenFileRaw, 'utf8')
      } catch (cause) {
        throw new ChatdConfigError(`${ENV_KEYS.tokenFile} 不可读：${tokenFileRaw}（${cause instanceof Error ? cause.message : String(cause)}）`)
      }
      const fromFile = content.trim()
      if (fromFile === '') throw new ChatdConfigError(`${ENV_KEYS.tokenFile} 内容为空：${tokenFileRaw}`)
      token = fromFile
    }
  }

  // 鉴权 fail-closed：未配 token 默认拒启；仅显式 ALLOW_NO_AUTH=1（精确值）豁免（mock/dev/test）。
  const allowNoAuth = env[ENV_KEYS.allowNoAuth]?.trim() === '1'
  if (token === undefined && !allowNoAuth) {
    throw new ChatdConfigError(
      `${ENV_KEYS.token} 未配置：默认 fail-closed 拒启（生产必配 token）。仅 mock/dev/test 可显式设 ${ENV_KEYS.allowNoAuth}=1 免鉴权`,
    )
  }
  // 占位符防呆：launchd 模板等 __...__ 占位符未替换时不得带进运行（有测试）。
  if (token !== undefined && /^__.+__$/.test(token)) {
    throw new ChatdConfigError(`${ENV_KEYS.token} 形如 __...__ 占位符（疑似模板未替换）：拒绝启动`)
  }

  const delayMs = parseNonNegativeInt(env[ENV_KEYS.delayMs], 0, ENV_KEYS.delayMs)
  const drainTimeoutMs = parseNonNegativeInt(env[ENV_KEYS.drainTimeoutMs], 5_000, ENV_KEYS.drainTimeoutMs)
  const wakeLeaseMs = parseNonNegativeInt(env[ENV_KEYS.wakeLeaseMs], 30_000, ENV_KEYS.wakeLeaseMs)

  const levelRaw = env[ENV_KEYS.logLevel]?.trim()
  let logLevel: LogLevel = 'info'
  if (levelRaw !== undefined && levelRaw !== '') {
    const parsed = parseLogLevel(levelRaw)
    if (parsed === undefined) throw new ChatdConfigError(`${ENV_KEYS.logLevel} 非法：${levelRaw}（debug|info|warn|error）`)
    logLevel = parsed
  }
  return { socketPath, token, delayMs, drainTimeoutMs, logLevel, dbPath, storeMode, wakeLeaseMs }
}
