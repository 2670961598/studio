/**
 * Matrix Client-Server API 最小客户端（薄网络层）
 *
 * 设计约束：
 *   - 零 npm 依赖：fetch 走注入（默认包装 globalThis.fetch，Node 24 原生）
 *   - typed 返回值手写：SyncResponse 只建模消费到的字段（next_batch + join timeline），
 *     其余字段不进类型（unknown 世界，靠 extractRoomMessages 做防御性投影）
 *   - 不引 SDK、不做 E2EE、不做 token 持久化（进程内存持有，README 留痕）
 *
 * 端点（v3）：POST /login · PUT /rooms/:id/send/m.room.message/:txnId · GET /sync
 * DEV-48 增补（docs/52-§七 / 21A-§2.3）：GET+POST /_synapse/admin/v1/register（shared-secret
 * 建号）· whoami · displayname · createRoom · directory/room 别名解析 · invite/join/kick ·
 * power_levels 读写。薄网络层——业务幂等（ensure-shape）在 hr-face.ts（§7.4 纪律）。
 * * 限流礼让（105-刀A A-4，F4 事故教训）：429 → 读 retry_after_ms 等待后重试一次
 * （缺省 2000ms、上限 30000ms 封顶）；再 429 则抛错走调用方退避——不吞不限流。
 * 长轮询：sync timeout 由调用方传入（适配层空闲期默认 25s，见 adapter.ts）。
 */
import { createHmac } from 'node:crypto'
/** 注入式 fetch 的最小结构类型（globalThis.fetch 天然满足） */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>
export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}
export interface FetchResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export interface MatrixClientOptions {
  /** homeserver 基址，如 http://127.0.0.1:8008 */
  baseUrl: string
  /** 注入 fetch（测试回放用）；缺省用全局 fetch */
  fetch?: FetchLike
  /** 已有凭据时直接注入（v0.1 不做持久化，重启重登） */
  accessToken?: string
}

export interface LoginResult {
  userId: string
  accessToken: string
  deviceId?: string
}

/** sync 响应（只建模用到的字段；presence/account_data/invite 等一律不进类型） */
export interface SyncResponse {
  next_batch: string
  rooms?: {
    join?: Record<string, JoinedRoomSnapshot>
  }
}
export interface JoinedRoomSnapshot {
  timeline?: { events?: unknown[]; limited?: boolean }
}

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init)

export class MatrixClient {
  private readonly baseUrl: string
  private readonly fetchLike: FetchLike
  private accessToken: string | undefined
  private loggedInUserId: string | undefined

  constructor(options: MatrixClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchLike = options.fetch ?? defaultFetch
    if (options.accessToken !== undefined) this.accessToken = options.accessToken
  }

  /** 当前登录用户（login 前为 undefined） */
  get userId(): string | undefined {
    return this.loggedInUserId
  }

  /** 密码登录（m.login.password），成功后凭据留在实例内 */
  async login(userId: string, password: string): Promise<LoginResult> {
    const res = await this.request<{ user_id?: unknown; access_token?: unknown; device_id?: unknown }>(
      'POST',
      '/_matrix/client/v3/login',
      {
        body: {
          type: 'm.login.password',
          identifier: { type: 'm.user.user', user: userId },
          password,
        },
      },
    )
    if (typeof res.user_id !== 'string' || typeof res.access_token !== 'string') {
      throw new Error('matrix login: 响应缺 user_id/access_token')
    }
    this.accessToken = res.access_token
    this.loggedInUserId = res.user_id
    return {
      userId: res.user_id,
      accessToken: res.access_token,
      ...(typeof res.device_id === 'string' ? { deviceId: res.device_id } : {}),
    }
  }

  /**
   * 发文本消息（m.room.message/m.text）；channel 语义=room_id（v0.1 不做 alias 解析）。
   * mentionedUserIds：写入 m.mentions.user_ids（v1.5 意图元数据）——发送侧显式声明
   * 结构化提及（105-刀A A-4）；缺省带空 m.mentions（明确「无提及」，防正文 @ 词元
   * 触发收端客户端 push 高亮的误报面）。不解析 MXID，调用方负责传完整 user_id。
   */
  async sendMessage(
    roomId: string,
    text: string,
    options?: { mentionedUserIds?: readonly string[] },
  ): Promise<{ eventId: string }> {
    const txnId = `sn-${globalThis.crypto.randomUUID()}`
    const mentioned = options?.mentionedUserIds
    const res = await this.request<{ event_id?: unknown }>(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        auth: true,
        body: {
          msgtype: 'm.text',
          body: text,
          'm.mentions': mentioned !== undefined && mentioned.length > 0 ? { user_ids: [...mentioned] } : {},
        },
      },
    )
    if (typeof res.event_id !== 'string') throw new Error('matrix sendMessage: 响应缺 event_id')
    return { eventId: res.event_id }
  }

  /** 增量同步；since 为空=首次全量。timeoutMs=0 即刻返回（轮询节奏由调用方掌控） */
  async sync(since?: string, timeoutMs = 0): Promise<SyncResponse> {
    const query: Record<string, string> = { timeout: String(timeoutMs) }
    if (since !== undefined) query.since = since
    const res = await this.request<{ next_batch?: unknown }>(
      'GET',
      '/_matrix/client/v3/sync',
      { auth: true, query },
    )
    if (typeof res.next_batch !== 'string') throw new Error('matrix sync: 响应缺 next_batch')
    return res as SyncResponse
  }

  // —— DEV-48 人事同步器端点（docs/52-§七 / docs/21A-§2.3；薄网络层——业务幂等在 hr-face） ——

  /**
   * Synapse shared-secret 注册（docs/21A-§2.3 + §2.1 配置注）：
   * GET /_synapse/admin/v1/register 拿一次性 nonce → 本地 HMAC-SHA1 → POST
   * {nonce, username, password, admin?, mac}。mac 字节口径（官方 register API 示例代码，
   * 21A-§二「以官方文档字节口径为准」）：HMAC_SHA1(shared_secret, nonce \0 username \0
   * password \0 (admin?'admin':'notadmin')) hexlower。**用户已存在 → 平台报错**
   * （冲突语义=已建号，ensure-shape 收敛归 hr-face）。
   */
  async registerWithSharedSecret(args: {
    username: string
    password: string
    sharedSecret: string
    admin?: boolean
  }): Promise<{ userId: string; accessToken: string }> {
    const nonceRes = await this.request<{ nonce?: unknown }>('GET', '/_synapse/admin/v1/register', {})
    if (typeof nonceRes.nonce !== 'string') throw new Error('matrix register: nonce 响应缺 nonce')
    const mac = createHmac('sha1', args.sharedSecret)
      .update(`${nonceRes.nonce}\0${args.username}\0${args.password}\0${args.admin === true ? 'admin' : 'notadmin'}`)
      .digest('hex')
    const body: Record<string, unknown> = {
      nonce: nonceRes.nonce,
      username: args.username,
      password: args.password,
      mac,
    }
    if (args.admin === true) body['admin'] = true
    const res = await this.request<{ user_id?: unknown; access_token?: unknown }>(
      'POST',
      '/_synapse/admin/v1/register',
      { body },
    )
    if (typeof res.user_id !== 'string' || typeof res.access_token !== 'string') {
      throw new Error('matrix register: 响应缺 user_id/access_token')
    }
    return { userId: res.user_id, accessToken: res.access_token }
  }

  /** 当前凭据自查（GET /account/whoami；启动探测/测试用） */
  async whoami(): Promise<{ userId: string }> {
    const res = await this.request<{ user_id?: unknown }>('GET', '/_matrix/client/v3/account/whoami', { auth: true })
    if (typeof res.user_id !== 'string') throw new Error('matrix whoami: 响应缺 user_id')
    return { userId: res.user_id }
  }

  /** 显示名设置（PUT /profile/{userId}/displayname；幂等——重复 PUT 同值无害） */
  async setDisplayName(userId: string, name: string): Promise<void> {
    await this.request('PUT', `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
      auth: true,
      body: { displayname: name },
    })
  }

  /** 建房（POST /createRoom；aliasName 给定时服务器侧挂别名）。返回 roomId（!开头） */
  async createRoom(opts: { name: string; aliasName?: string; visibility?: 'public' | 'private' }): Promise<{ roomId: string }> {
    const body: Record<string, unknown> = { name: opts.name }
    if (opts.aliasName !== undefined) body['room_alias_name'] = opts.aliasName
    if (opts.visibility !== undefined) body['visibility'] = opts.visibility
    const res = await this.request<{ room_id?: unknown }>('POST', '/_matrix/client/v3/createRoom', { auth: true, body })
    if (typeof res.room_id !== 'string') throw new Error('matrix createRoom: 响应缺 room_id')
    return { roomId: res.room_id }
  }

  /** 别名 → roomId（GET /directory/room/{alias}；404=别名未挂——errcode 在 toApiError 文本里） */
  async resolveAlias(alias: string): Promise<string> {
    const res = await this.request<{ room_id?: unknown }>(
      'GET',
      `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
      { auth: true },
    )
    if (typeof res.room_id !== 'string') throw new Error('matrix resolveAlias: 响应缺 room_id')
    return res.room_id
  }

  /** 邀请入房（M_FORBIDDEN=已在房——调用方按幂等收敛；docs/52-§7.2） */
  async invite(roomId: string, userId: string): Promise<void> {
    await this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      auth: true,
      body: { user_id: userId },
    })
  }

  /** 自己加入房间（建房/受邀后；幂等——已在房再 join 是 no-op） */
  async joinRoom(roomIdOrAlias: string): Promise<void> {
    await this.request('POST', '/_matrix/client/v3/join/' + encodeURIComponent(roomIdOrAlias), { auth: true, body: {} })
  }

  /** 踢出房间（kick 非 ban——D4：退场可复邀，docs/52-§14） */
  async kick(roomId: string, userId: string, reason?: string): Promise<void> {
    await this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, {
      auth: true,
      body: { user_id: userId, ...(reason !== undefined ? { reason } : {}) },
    })
  }

  /** 房间 power_levels 全量读（setPowerLevel 的读-改-写底座；users 映射防御性投影） */
  async getPowerLevels(roomId: string): Promise<{ users: Record<string, number> }> {
    const res = await this.request<{ users?: unknown }>(
      'GET',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`,
      { auth: true },
    )
    const users: Record<string, number> = {}
    if (typeof res.users === 'object' && res.users !== null) {
      for (const [k, v] of Object.entries(res.users)) {
        if (typeof v === 'number') users[k] = v
      }
    }
    return { users }
  }

  /** 单人 power_level 写（GET→改 users→PUT 全量 state；并发窗口内 last-write-wins——v0 单写者可接受） */
  async setPowerLevel(roomId: string, userId: string, level: number): Promise<void> {
    const current = await this.getPowerLevels(roomId)
    current.users[userId] = level
    await this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`, {
      auth: true,
      body: current,
    })
  }

  private async request<T>(
    method: string,
    path: string,
    init: { body?: unknown; auth?: boolean; query?: Record<string, string> },
  ): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
    const headers: Record<string, string> = {}
    if (init.auth === true) {
      if (this.accessToken === undefined) throw new Error(`matrix ${method} ${path}: 未登录（无 access_token）`)
      headers.Authorization = `Bearer ${this.accessToken}`
    }
    let body: string | undefined
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    // 429 礼让重试一次（105-刀A A-4）：读 retry_after_ms 等待（缺省 2000、上限 30s）；
    // 再 429 抛错走调用方退避。循环体最多两轮，非 429 失败直抛。
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.fetchLike(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      })
      if (res.ok) return (await res.json()) as T
      // 错误体只读一次（Response.json() 不可重复调用），解析结果同时喂错误面与 429 面
      const parsed = await readErrorBody(res)
      if (res.status === 429 && attempt === 0) {
        await sleep(clampRetryAfterMs(parsed.retry_after_ms))
        continue
      }
      throw apiErrorFrom(method, path, res.status, parsed)
    }
  }
}

/** 非 2xx 错误体的防御性读取：能读 JSON 就读（errcode/error/retry_after_ms），否则空对象 */
async function readErrorBody(
  res: FetchResponse,
): Promise<{ errcode?: string; error?: string; retry_after_ms?: number }> {
  try {
    const parsed = (await res.json()) as {
      errcode?: unknown
      error?: unknown
      retry_after_ms?: unknown
    }
    return {
      ...(typeof parsed.errcode === 'string' ? { errcode: parsed.errcode } : {}),
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
      ...(typeof parsed.retry_after_ms === 'number' && Number.isFinite(parsed.retry_after_ms)
        ? { retry_after_ms: parsed.retry_after_ms }
        : {}),
    }
  } catch {
    return {} // 非 JSON 错误体：只带状态码
  }
}

/** 429 等待时长：尊重服务端 retry_after_ms；缺省 2000ms；负数按 0；上限 30000ms 封顶 */
function clampRetryAfterMs(retryAfterMs: number | undefined): number {
  if (retryAfterMs === undefined) return 2000
  return Math.min(Math.max(retryAfterMs, 0), 30_000)
}

/** 可中断安全的 sleep：定时器 unref（等待期不阻止进程退出），不抛错 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    ;(timer as { unref?: () => void }).unref?.()
  })
}

/** 非 2xx → 带 status/errcode 的 Error（端口纪律：不抛裸字符串） */
function apiErrorFrom(
  method: string,
  path: string,
  status: number,
  parsed: { errcode?: string; error?: string },
): Error {
  let detail = ''
  if (parsed.errcode !== undefined) detail = ` ${parsed.errcode}`
  if (parsed.error !== undefined) detail += `: ${parsed.error}`
  return new Error(`matrix api ${status} ${method} ${path}${detail}`)
}
