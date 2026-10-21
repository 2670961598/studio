/**
 * boot —— Studio Next 组合根（composition root，105-刀A A-3；studio-dev-105 提案 §5.3-3）
 *
 * 定位：仓内**唯一**同时依赖 @studio-next/daemon 与 @studio-next/matrix 的单元——
 * daemon 本体零 matrix import（docs/25-§一.2 依赖方向纪律，判负线⑦；装配例外经
 * 提案批示⑥全批）。装配序列：
 *
 *   daemon.yaml（matrix 键组，扁平）+ env MATRIX_BOT_PASSWORD（密码永不入 yaml，21A D5）
 *     → parseDaemonConfig（fail-fast：缺 matrixHomeserverUrl/matrixUserId=CONFIG_INVALID）
 *     → MatrixClient.login（bot 密码登录，凭据只留进程内存）
 *     → createMentionSource（rooms 白名单/roles 角色词映射/节奏/长轮询超时）
 *     → runServe(configPath, { matrixSource })（源工厂注入；emit 统一进 engine.ingest）
 *
 * 不做什么（105-刀A 边界）：
 *   - 不做 notify 出口装配（createMatrixNotifier 归刀B notify 端口接线单）
 *   - 不做 E2EE/alias 解析/应用服务（matrix 包 README 未做事项同源）
 *   - 不代 daemon 存 Matrix 凭据：login 结果（token）只留 client 实例内存，重启重登
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { InvokeSource, PersonId } from '@studio-next/contract'
import { parseDaemonConfig, runServe, type ServeConfig, type ServeResult } from '@studio-next/daemon/serve'
import { createMentionSource, MatrixClient, type FetchLike } from '@studio-next/matrix'

/** bot 密码 env 名（红名单：值永不入 daemon.yaml/日志/台账） */
export const MATRIX_BOT_PASSWORD_ENV = 'MATRIX_BOT_PASSWORD'

export interface BootOptions {
  /** daemon.yaml 路径（透传 runServe——配置由 daemon 解析面收口，boot 不重造） */
  configPath: string
  /** env 供给面（缺省 process.env；测试注入） */
  env?: Record<string, string | undefined>
  /** fetch 注入面（缺省 globalThis.fetch；测试回放，不真实联网） */
  fetch?: FetchLike
  /** runServe 注入面（测试捕获 opts 契约；缺省真跑主循环） */
  serve?: (configPath: string, opts?: { matrixSource?: () => InvokeSource }) => Promise<ServeResult>
  /** 日志出口（缺省 console.log） */
  log?: (line: string) => void
}

/**
 * matrix 装配件（boot 的被测核心）：config 键组 + env 密码 → 登录 → mention 源。
 * 不接 runServe（接线归 bootServe）——两件分离让装配面可全量假网测。
 */
export interface MatrixAssembly {
  /** 已登录的 client（凭据在实例内存；随源闭包存活） */
  client: MatrixClient
  /** @唤醒源（start/stop 对齐 InvokeSource 端口） */
  source: InvokeSource
}

/** 分号列表解析：'!a:lo;!b:lo' → ['!a:lo','!b:lo']（空段剔除；无值=undefined） */
function splitSemicolonList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = value.split(';').map((v) => v.trim()).filter((v) => v !== '')
  return items.length > 0 ? items : undefined
}

/** 角色词映射解析：'宰相=PRIME-0;制作人=PRODUCER-0' → {宰相:'PRIME-0',...}（③混合语义源侧面） */
export function parseMatrixRoles(
  value: string | undefined,
): Record<string, PersonId> | undefined {
  const items = splitSemicolonList(value)
  if (items === undefined) return undefined
  const roles: Record<string, PersonId> = {}
  for (const item of items) {
    const eq = item.indexOf('=')
    if (eq <= 0 || eq === item.length - 1) {
      throw new Error(
        `CONFIG_INVALID：matrixRoles 条目「${item}」须为 角色词=工号 形态（分号分隔，如 宰相=PRIME-0;制作人=PRODUCER-0）`,
      )
    }
    roles[item.slice(0, eq).trim()] = item.slice(eq + 1).trim()
  }
  return roles
}

/**
 * matrix 装配：解析后的 config + env → login + createMentionSource。
 * fail-fast 面（CONFIG_INVALID 明报不猜）：matrix 开而缺密码 env / 缺 homeserver /
 * 缺 bot 账号 / roles 形态坏。
 */
export async function assembleMatrixSource(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: { fetch?: FetchLike; log?: (line: string) => void },
): Promise<MatrixAssembly> {
  const log = options?.log ?? ((): void => {})
  if (!config.matrix) throw new Error('CONFIG_INVALID：assembleMatrixSource 在 matrix: false 下被调用（装配面与开关面不一致）')
  if (config.matrixHomeserverUrl === undefined || config.matrixHomeserverUrl === '') {
    throw new Error('CONFIG_INVALID：matrix: true 需配 matrixHomeserverUrl（如 http://127.0.0.1:8008，105-刀A）')
  }
  if (config.matrixUserId === undefined || config.matrixUserId === '') {
    throw new Error('CONFIG_INVALID：matrix: true 需配 matrixUserId（bot 账号，如 @demo-bot:studio.local）')
  }
  const password = env[MATRIX_BOT_PASSWORD_ENV]
  if (password === undefined || password === '') {
    throw new Error(
      `CONFIG_INVALID：matrix: true 需 env ${MATRIX_BOT_PASSWORD_ENV}（bot 密码红名单——永不入 daemon.yaml/日志/台账，21A D5）`,
    )
  }
  const client = new MatrixClient({
    baseUrl: config.matrixHomeserverUrl,
    ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
  })
  const login = await client.login(config.matrixUserId, password)
  log(`[boot] matrix bot 已登录（${login.userId}；token 只留进程内存，重启重登）`)
  const rooms = splitSemicolonList(config.matrixRooms)
  if (rooms !== undefined) log(`[boot] matrix 房间白名单：${rooms.join('、')}`)
  const roles = parseMatrixRoles(config.matrixRoles)
  const source = createMentionSource({
    client,
    company: config.company,
    selfUserId: login.userId, // 登录返回的规范 MXID（非配置原文）——防回声
    ...(rooms !== undefined ? { rooms } : {}),
    ...(roles !== undefined ? { roles } : {}),
    ...(config.matrixPollMs !== undefined ? { pollIntervalMs: config.matrixPollMs } : {}),
    ...(config.matrixSyncTimeoutMs !== undefined ? { syncTimeoutMs: config.matrixSyncTimeoutMs } : {}),
  })
  return { client, source }
}

/**
 * 组合根入口：读 daemon.yaml →（matrix: true 时）装配 matrix 源 → runServe。
 * matrix: false 时透传 runServe（matrix 面整体关闭，boot 仍是合法入口）。
 * 配置解析在 daemon 收口（runServe 内部再读同一文件——单一解析器，boot 不重造）。
 */
export async function bootServe(options: BootOptions): Promise<ServeResult> {
  const log = options.log ?? ((line: string): void => console.log(line))
  const config = parseDaemonConfig(readFileSync(path.resolve(options.configPath), 'utf8'))
  const serve = options.serve ?? runServe
  if (!config.matrix) {
    log('[boot] matrix: false——@唤醒源未装配（组合根透传 runServe）')
    return serve(options.configPath)
  }
  const assembly = await assembleMatrixSource(config, options.env ?? process.env, {
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    log,
  })
  log(
    `[boot] matrix @唤醒源已装配（company=${config.company}）→ runServe opts.matrixSource 注入` +
      '（源 emit 统一进 engine.ingest，22-§一 源零直驱；消费门=kind→handler 分发表，105-刀A A-2）',
  )
  return serve(options.configPath, { matrixSource: () => assembly.source })
}
