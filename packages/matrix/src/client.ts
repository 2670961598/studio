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
 */
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

  /** 发文本消息（m.room.message/m.text）；channel 语义=room_id（v0.1 不做 alias 解析） */
  async sendMessage(roomId: string, text: string): Promise<{ eventId: string }> {
    const txnId = `sn-${globalThis.crypto.randomUUID()}`
    const res = await this.request<{ event_id?: unknown }>(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      { auth: true, body: { msgtype: 'm.text', body: text } },
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
    const res = await this.fetchLike(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    })
    if (!res.ok) throw await toApiError(method, path, res)
    return (await res.json()) as T
  }
}

/** 非 2xx → 带 status/errcode 的 Error（端口纪律：不抛裸字符串） */
async function toApiError(method: string, path: string, res: FetchResponse): Promise<Error> {
  let detail = ''
  try {
    const parsed = (await res.json()) as { errcode?: unknown; error?: unknown }
    if (typeof parsed.errcode === 'string') detail = ` ${parsed.errcode}`
    if (typeof parsed.error === 'string') detail += `: ${parsed.error}`
  } catch {
    // 非 JSON 错误体：只带状态码
  }
  return new Error(`matrix api ${res.status} ${method} ${path}${detail}`)
}
