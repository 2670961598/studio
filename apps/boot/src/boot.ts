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
 *     → matrix: true → createMentionSource（rooms 白名单/roles 角色词映射/节奏/长轮询超时）
 *     → matrixChannels: true → createMatrixProvisionFace（130-P3 §6.7 八类地图供给面：
 *       matrixDeptMap JSON 装载 + matrixProducerMxid 缺省神号；ctx.snapshot 活取公司快照）
 *       + createMatrixBroadcastFace（105-刀B notify 广播面：#alert/部门频道/总览——
 *       事件中继+escalate 警戒 IM 出口+惊动计量，studio-dev-219）
 *     → runServe(configPath, { matrixSource?, matrixRoomFace?, notifyBroadcast? })（源/面工厂注入）
 *
 * 不做什么（105-刀A 边界＋130-P3 边界）：
 *   - 不做 E2EE/应用服务（matrix 包 README 未做事项同源）
 *   - 不代 daemon 存 Matrix 凭据：login 结果（token）只留 client 实例内存，重启重登
 *   - 不做路由/去重/计量（daemon 侧 engine/notify/* 职责——boot 只装配发送面）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { InvokeSource, PersonId } from '@studio-next/contract'
import {
  parseDaemonConfig,
  runServe,
  type MatrixRoomFace,
  type MatrixRoomFaceContext,
  type NotifyBroadcastFace,
  type ServeConfig,
  type ServeResult,
} from '@studio-next/daemon/serve'
import {
  createMatrixBroadcastFace,
  createMatrixProvisionFace,
  createMentionSource,
  MatrixClient,
  type ChannelMapInput,
  type FetchLike,
  createMatrixHrFace,
  type MatrixHrTarget,
} from '@studio-next/matrix'

/** bot 密码 env 名（红名单：值永不入 daemon.yaml/日志/台账） */
export const MATRIX_BOT_PASSWORD_ENV = 'MATRIX_BOT_PASSWORD'

/**
 * hr 建号 shared secret env 名（studio-dev-217，docs/52-§7.2/§十二；红名单同 bot 密码）：
 * 值=homeserver.yaml 侧 `registration_shared_secret`（21A-§2.3 冻结建号通道），经 env
 * 注入不落盘；次选 MATRIX_SHARED_SECRET（daemon collectHrSecrets 同扫两名——出站
 * 脱敏单一口径，不另立第三名）。
 */
export const MATRIX_HR_SHARED_SECRET_ENV = 'MATRIX_HR_SHARED_SECRET'

/** 制作人 MXID 缺省（神号全知，130 §6.7.2；21A-§2.2 冻结锚） */
export const DEFAULT_PRODUCER_MXID = '@opengames:localhost'

export interface BootOptions {
  /** daemon.yaml 路径（透传 runServe——配置由 daemon 解析面收口，boot 不重造） */
  configPath: string
  /** env 供给面（缺省 process.env；测试注入） */
  env?: Record<string, string | undefined>
  /** fetch 注入面（缺省 globalThis.fetch；测试回放，不真实联网） */
  fetch?: FetchLike
  /** runServe 注入面（测试捕获 opts 契约；缺省真跑主循环） */
  serve?: (
    configPath: string,
    opts?: {
      matrixSource?: () => InvokeSource
      matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
      notifyBroadcast?: NotifyBroadcastFace
    },
  ) => Promise<ServeResult>
  /** 日志出口（缺省 console.log） */
  log?: (line: string) => void
}

/**
 * matrix 装配件（boot 的被测核心）：config 键组 + env 密码 → 登录 → mention 源。
 * 不接 runServe（接线归 bootServe）——两件分离让装配面可全量假网测。
 * options.login=boot 双开共用登录注入面（同一 bot 账号 matrix+matrixChannels 只登录一次）。
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

/** 装配选项公共形（fetch 回放/日志出口/共用登录注入面） */
interface AssembleOptions {
  fetch?: FetchLike
  log?: (line: string) => void
  /** 已登录面（boot 双开时同一 bot 账号共用一次登录；缺省自行登录） */
  login?: { client: MatrixClient; botMxid: string }
}

/**
 * matrix bot 登录核心（assembleMatrixSource/assembleMatrixProvisionFace 共用）：
 * config 键组 + env 密码 → MatrixClient.login。fail-fast 面（CONFIG_INVALID 明报不猜）：
 * 开关开而缺密码 env / 缺 homeserver / 缺 bot 账号。开关名随调用面（matrix/matrixChannels）。
 */
export async function assembleMatrixLogin(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: { fetch?: FetchLike; log?: (line: string) => void },
  switchName = 'matrix',
): Promise<{ client: MatrixClient; botMxid: string }> {
  const log = options?.log ?? ((): void => {})
  if (config.matrixHomeserverUrl === undefined || config.matrixHomeserverUrl === '') {
    throw new Error(`CONFIG_INVALID：${switchName}: true 需配 matrixHomeserverUrl（如 http://127.0.0.1:8008，105-刀A）`)
  }
  if (config.matrixUserId === undefined || config.matrixUserId === '') {
    throw new Error(`CONFIG_INVALID：${switchName}: true 需配 matrixUserId（bot 账号，如 @demo-bot:studio.local）`)
  }
  const password = env[MATRIX_BOT_PASSWORD_ENV]
  if (password === undefined || password === '') {
    throw new Error(
      `CONFIG_INVALID：${switchName}: true 需 env ${MATRIX_BOT_PASSWORD_ENV}（bot 密码红名单——永不入 daemon.yaml/日志/台账，21A D5）`,
    )
  }
  const client = new MatrixClient({
    baseUrl: config.matrixHomeserverUrl,
    ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
  })
  const login = await client.login(config.matrixUserId, password)
  log(`[boot] matrix bot 已登录（${login.userId}；token 只留进程内存，重启重登）`)
  return { client, botMxid: login.userId }
}

/**
 * matrix 装配：解析后的 config + env → login + createMentionSource。
 * fail-fast 面（CONFIG_INVALID 明报不猜）：matrix 开而缺密码 env / 缺 homeserver /
 * 缺 bot 账号 / roles 形态坏。
 */
export async function assembleMatrixSource(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: AssembleOptions,
): Promise<MatrixAssembly> {
  if (!config.matrix) throw new Error('CONFIG_INVALID：assembleMatrixSource 在 matrix: false 下被调用（装配面与开关面不一致）')
  const { client, botMxid } = options?.login ?? (await assembleMatrixLogin(config, env, options, 'matrix'))
  const rooms = splitSemicolonList(config.matrixRooms)
  if (rooms !== undefined) options?.log?.(`[boot] matrix 房间白名单：${rooms.join('、')}`)
  const roles = parseMatrixRoles(config.matrixRoles)
  const source = createMentionSource({
    client,
    company: config.company,
    selfUserId: botMxid, // 登录返回的规范 MXID（非配置原文）——防回声
    ...(rooms !== undefined ? { rooms } : {}),
    ...(roles !== undefined ? { roles } : {}),
    ...(config.matrixPollMs !== undefined ? { pollIntervalMs: config.matrixPollMs } : {}),
    ...(config.matrixSyncTimeoutMs !== undefined ? { syncTimeoutMs: config.matrixSyncTimeoutMs } : {}),
  })
  return { client, source }
}

/**
 * deptMap JSON 装载（DEV-20 D6 形态：`{"departments/研发部": "rd"}`——部门 path →
 * ASCII slug，频道别名段用）。fail-fast：文件读不到 / 非 JSON / 非扁平 string→string /
 * 空对象=CONFIG_INVALID（缺部门项的软失败面归供给器 problems，不在此炸）。
 */
export function loadDeptSlugs(jsonPath: string | undefined): Record<string, string> {
  if (jsonPath === undefined || jsonPath === '') {
    throw new Error('CONFIG_INVALID：matrixChannels: true 需配 matrixDeptMap（部门 path→slug JSON 路径，DEV-20 D6）')
  }
  let text: string
  try {
    text = readFileSync(path.resolve(jsonPath), 'utf8')
  } catch (err) {
    throw new Error(
      `CONFIG_INVALID：matrixDeptMap 文件读不到（${jsonPath}）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`CONFIG_INVALID：matrixDeptMap 非 JSON（${jsonPath}）：${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`CONFIG_INVALID：matrixDeptMap 须为扁平对象 path→slug（${jsonPath}）`)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string' || v === '' || !/^[a-z0-9][a-z0-9-]*$/.test(v)) {
      throw new Error(`CONFIG_INVALID：matrixDeptMap 条目 ${k} 的 slug 须为小写 ASCII 连字符形（实得 ${String(v)}；DEV-20 D6）`)
    }
    out[k] = v
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`CONFIG_INVALID：matrixDeptMap 为空对象（${jsonPath}——至少映射一个部门）`)
  }
  return out
}

/**
 * matrix 频道供给面装配（130-P3 §6.7）：login → createMatrixProvisionFace 工厂。
 * 工厂由 runServe 以 ctx（snapshot 活取——L1 热重载新鲜面）回调装配；本函数只持
 * 进程内常量（client/botMxid/deptSlugs/producerMxid——daemon.yaml 键不热重载，重启生效）。
 */
export async function assembleMatrixProvisionFace(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: AssembleOptions,
): Promise<(ctx: MatrixRoomFaceContext) => MatrixRoomFace> {
  if (!config.matrixChannels) {
    throw new Error('CONFIG_INVALID：assembleMatrixProvisionFace 在 matrixChannels: false 下被调用（装配面与开关面不一致）')
  }
  const { client, botMxid } = options?.login ?? (await assembleMatrixLogin(config, env, options, 'matrixChannels'))
  const deptSlugs = loadDeptSlugs(config.matrixDeptMap)
  const producerMxid = config.matrixProducerMxid ?? DEFAULT_PRODUCER_MXID
  options?.log?.(
    `[boot] matrix 频道供给面已装配：deptMap ${Object.keys(deptSlugs).length} 部、制作人 ${producerMxid}` +
      '——130-P3 §6.7 八类地图（ensure 幂等，重跑收敛）',
  )
  return (ctx: MatrixRoomFaceContext): MatrixRoomFace => {
    const snapshot = (): ChannelMapInput => {
      const snap = ctx.snapshot()
      return {
        slug: snap.slug,
        companyName: snap.name,
        departments: snap.departments.map((d) => ({ path: d.path, name: d.name, leader: d.leader })),
        people: snap.people.map((p) => ({
          id: p.id,
          login: p.login,
          dept: p.dept,
          ...(p.role !== undefined ? { role: p.role } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
        })),
        ...(snap.groups !== undefined
          ? { groups: snap.groups.map((g) => ({ id: g.id, dept: g.dept, name: g.name, ...(g.leader !== undefined ? { leader: g.leader } : {}), members: g.members })) }
          : {}),
        deptSlugs,
        botMxid,
        producerMxid,
      }
    }
    return createMatrixProvisionFace(client, { snapshot })
  }
}

/**
 * notify 广播面装配（105-刀B-1，studio-dev-219）：共用登录 → createMatrixBroadcastFace。
 * 与供给面同开关（matrixChannels）同键组（deptMap/slug 同源——广播的目标频道就是供给
 * 面确保的那批 alias，130-P3 八类地图命名）；面持有进程内常量（client/botMxid/deptSlugs
 * ——daemon.yaml 键不热重载，重启生效），alias→room_id 解析缓存在面内。
 */
export function assembleMatrixBroadcastFace(
  config: ServeConfig,
  _env: Record<string, string | undefined>,
  options: AssembleOptions & { login: { client: MatrixClient; botMxid: string } },
): NotifyBroadcastFace {
  if (!config.matrixChannels) {
    throw new Error('CONFIG_INVALID：assembleMatrixBroadcastFace 在 matrixChannels: false 下被调用（装配面与开关面不一致）')
  }
  const deptSlugs = loadDeptSlugs(config.matrixDeptMap)
  options.log?.(
    `[boot] matrix notify 广播面已装配：#<slug>-alert/#<slug>-overview/#<slug>-<dept> → ` +
      `${Object.keys(deptSlugs).length} 部——105-刀B 事件中继+escalate 警戒 IM 出口（studio-dev-219）`,
  )
  return createMatrixBroadcastFace({
    client: options.login.client,
    slug: config.company,
    deptSlugs,
    botMxid: options.login.botMxid,
    ...(options.log !== undefined ? { log: options.log } : {}),
  })
}

/**
 * 组合根入口：读 daemon.yaml →（matrix: true 时）装配 matrix 源 →（matrixChannels:
 * true 时）装配频道供给面+notify 广播面 → runServe。两开关独立（只开供给不开唤醒源=
 * 合法灰度形态：频道先建、mention 后开）；都关=透传 runServe（matrix 面整体关闭，boot
 * 仍是合法入口）。配置解析在 daemon 收口（runServe 内部再读同一文件——单一解析器，
 * boot 不重造）。
 */
/**
 * matrix 人事执行面装配（studio-dev-217，docs/52-§七；hrSync+hrMatrix: true 时）：
 * login（bot 管理账号代操作，§7.2「网关 bot 一个管理账号」）+ env shared secret →
 * createMatrixHrFace。密钥取值序：MATRIX_HR_SHARED_SECRET > MATRIX_SHARED_SECRET
 * （与 daemon collectHrSecrets 同两名——出站脱敏单一口径）；缺=CONFIG_INVALID 明报。
 * ensure-shape 幂等（注册冲突≈已建号/邀请 M_FORBIDDEN≈已在房/PL 同值不写）归 matrix
 * 包 hr-face（§7.4）——boot 不重造业务幂等。
 */
export async function assembleMatrixHrFace(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: AssembleOptions,
): Promise<MatrixHrTarget> {
  if (!config.hrSync || !config.hrMatrix) {
    throw new Error('CONFIG_INVALID：assembleMatrixHrFace 在 hrSync/hrMatrix 面未开下被调用（装配面与开关面不一致）')
  }
  const secret = env[MATRIX_HR_SHARED_SECRET_ENV] ?? env['MATRIX_SHARED_SECRET']
  if (secret === undefined || secret === '') {
    throw new Error(
      `CONFIG_INVALID：hrMatrix: true 需 env ${MATRIX_HR_SHARED_SECRET_ENV}` +
        '（=homeserver.yaml 侧 registration_shared_secret，21A-§2.3 冻结建号通道；红名单——永不入 daemon.yaml/日志/台账，docs/52-§十二）',
    )
  }
  const { client } = options?.login ?? (await assembleMatrixLogin(config, env, options, 'hrMatrix'))
  options?.log?.('[boot] matrix 人事面已装配（shared-secret 建号+入房+PL，docs/52-§七）——ensure 幂等收敛')
  return createMatrixHrFace({ client, sharedSecret: secret })
}

export async function bootServe(options: BootOptions): Promise<ServeResult> {
  const log = options.log ?? ((line: string): void => console.log(line))
  const config = parseDaemonConfig(readFileSync(path.resolve(options.configPath), 'utf8'))
  const serve = options.serve ?? runServe
  const hrFaceNeeded = config.hrSync === true && config.hrMatrix === true // studio-dev-217：hr 面独立灰度形态（matrix/matrixChannels 关也不早退）
  if (!config.matrix && !config.matrixChannels && !hrFaceNeeded) {
    log('[boot] matrix: false、matrixChannels: false——@唤醒源/频道供给面/notify 广播面均未装配（组合根透传 runServe）')
    return serve(options.configPath)
  }
  // 同一 bot 账号多面共用一次登录（token 只留进程内存；两开关的必配键校验已由
  // parseDaemonConfig 交叉校验面收口——serve.ts coerceServeConfig）；两开关独立
  //（只开供给不开唤醒源=合法灰度形态：频道先建、mention 后开）。
  const faceOpts: AssembleOptions = { ...(options.fetch !== undefined ? { fetch: options.fetch } : {}), log }
  const login = await assembleMatrixLogin(config, options.env ?? process.env, faceOpts, config.matrix ? 'matrix' : config.matrixChannels ? 'matrixChannels' : 'hrMatrix')
  const shared = { ...faceOpts, login }
  let matrixSource: (() => InvokeSource) | undefined
  let matrixRoomFace: ((ctx: MatrixRoomFaceContext) => MatrixRoomFace) | undefined
  let notifyBroadcast: NotifyBroadcastFace | undefined
  if (config.matrix) {
    const assembly = await assembleMatrixSource(config, options.env ?? process.env, shared)
    log(
      `[boot] matrix @唤醒源已装配（company=${config.company}）→ runServe opts.matrixSource 注入` +
        '（源 emit 统一进 engine.ingest，22-§一 源零直驱；消费门=kind→handler 分发表，105-刀A A-2）',
    )
    matrixSource = (): InvokeSource => assembly.source
  }
  if (config.matrixChannels) {
    matrixRoomFace = await assembleMatrixProvisionFace(config, options.env ?? process.env, shared)
    // 105-刀B（219）：广播面与供给面同键组同 bot——目标频道即供给面确保的 alias 批
    notifyBroadcast = assembleMatrixBroadcastFace(config, options.env ?? process.env, shared)
  }
  let hrMatrixFace: (() => MatrixHrTarget) | undefined
  if (config.hrSync === true && config.hrMatrix === true) {
    const face = await assembleMatrixHrFace(config, options.env ?? process.env, shared)
    hrMatrixFace = (): MatrixHrTarget => face
  }
  return serve(options.configPath, {
    ...(matrixSource !== undefined ? { matrixSource } : {}),
    ...(matrixRoomFace !== undefined ? { matrixRoomFace } : {}),
    ...(notifyBroadcast !== undefined ? { notifyBroadcast } : {}),
    ...(hrMatrixFace !== undefined ? { hrMatrixFace } : {}),
  })
}
