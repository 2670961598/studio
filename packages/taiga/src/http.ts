/**
 * TaigaClient —— 原生 fetch 薄客户端（零新依赖；docs/16-§二自研客户端哲学的 Taiga 延续）
 *
 * 真机事实（docs/32 §二①，2026-10-18 实测）：
 *   - auth = JWT：POST /api/v1/auth {type:"normal", username, password} → {auth_token, refresh}
 *   - 刷新：POST /api/v1/auth/refresh {refresh} → {auth_token, refresh}
 *   - 分页：?page=N&page_size=M + 响应头 x-pagination-count（总数）/x-paginated-by/
 *     x-pagination-current/X-Pagination-Next（真机 9000 端口实测头名，docs/32 §四「待核」已核）
 *   - 错误体：{_error_message, _error_type}（Taiga 惯例；也兼容 error_description）
 *
 * 行为约定（对齐 yt http.ts，v0 明确不做）：
 *   - 一次请求=一次 fetch；**唯一例外是 401**：自动刷新/重登后重试一次，再 401 才报错
 *     （JWT 过期是常态而非故障，静默续期是 auth 语义的一部分）
 *   - 无超时、无限流退避、无 5xx 重试（上层断路器职责）
 *   - fetch 可注入（测试 fake 回放零真实网络；真机冒烟=套外脚本）
 *   - 响应校验不在本层：各面自带 parse（shape.ts 手写守卫，本包不引 zod）
 */
import { TaigaPlatformError } from './errors.ts'
import { asObject, optString } from './shape.ts'

/** 注入面：与全局 fetch 结构兼容（需要 headers.get 供分页读数） */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

export interface TaigaRequest {
  method: HttpMethod
  /** 相对路径（/api/v1 之下，如 /projects/by_slug） */
  path: string
  /** 查询参数（值 encodeURIComponent） */
  query?: Record<string, string>
  /** 请求体（JSON 序列化） */
  body?: unknown
}

/** 认证配置：密码态（自动登录+刷新）或预换 token 态（有 refresh 才可刷新） */
export type TaigaAuth =
  | { type: 'password'; username: string; password: string }
  | { type: 'token'; token: string; refresh?: string }

export interface RawResponse {
  status: number
  /** 解析后的 JSON（2xx 才有；非 JSON 会在本层报错） */
  json: unknown
  /** 响应头取值（分页计数用；头名大小写不敏感） */
  header(name: string): string | null
}

/** 防御性翻页上限（x-pagination-count 异常时防死循环） */
export const MAX_PAGES = 1000

function mapStatusToError(status: number, detail: string, path: string): TaigaPlatformError {
  const at = `（${path}）`
  if (status === 400) return new TaigaPlatformError('CONFIG_INVALID', 'bad-request', `平台拒收请求（400）${at}：${detail}`)
  if (status === 401 || status === 403) {
    return new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', `认证/权限被拒（${status}）${at}：${detail}`)
  }
  if (status === 404) return new TaigaPlatformError('EXTERNAL_REJECT', 'not-found', `目标不存在（404）${at}：${detail}`)
  if (status === 409) return new TaigaPlatformError('EXTERNAL_REJECT', 'conflict', `平台并发冲突（409）${at}：${detail}`)
  if (status === 429) return new TaigaPlatformError('EXTERNAL_REJECT', 'rate-limited', `平台限流（429）${at}：${detail}`)
  if (status >= 500) return new TaigaPlatformError('EXTERNAL_REJECT', 'server-error', `平台侧故障（${status}）${at}：${detail}`)
  return new TaigaPlatformError('CONFIG_INVALID', 'client-error', `未分类 4xx（${status}）${at}：${detail}`)
}

/** Taiga 错误体说明提取（_error_message 优先，兼容 error_description/error） */
function extractErrorDetail(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  for (const key of ['_error_message', 'error_description', 'error', 'detail']) {
    const v = o[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return null
}

interface TokenPair {
  authToken: string
  refreshToken: string | null
}

export class TaigaClient {
  private readonly baseUrl: string
  private readonly auth: TaigaAuth
  private readonly fetchLike: FetchLike
  private tokens: TokenPair | null = null

  constructor(baseUrl: string, auth: TaigaAuth, fetchLike?: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.auth = auth
    this.fetchLike = fetchLike ?? (globalThis.fetch as FetchLike)
  }

  buildUrl(req: TaigaRequest): string {
    const pairs = Object.entries(req.query ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    return pairs.length === 0 ? `${this.baseUrl}/api/v1${req.path}` : `${this.baseUrl}/api/v1${req.path}?${pairs.join('&')}`
  }

  private async fetchOnce(req: TaigaRequest, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token !== null) headers['Authorization'] = `Bearer ${token}`
    const init: RequestInit = { method: req.method, headers }
    if (req.body !== undefined) {
      init.body = JSON.stringify(req.body)
      headers['Content-Type'] = 'application/json'
    }
    try {
      return await this.fetchLike(this.buildUrl(req), init)
    } catch (err) {
      throw new TaigaPlatformError('EXTERNAL_REJECT', 'network-error', `Taiga 不可达（${this.baseUrl}）：${String(err)}`)
    }
  }

  /** 登录换 JWT（docs/32 §二①：POST /auth type:normal） */
  private async login(): Promise<TokenPair> {
    if (this.auth.type !== 'password') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', 'token 态无密码可登录，token 已失效（提供 refresh 或改用密码态）')
    }
    const raw = await this.exchange('/auth', { type: 'normal', username: this.auth.username, password: this.auth.password })
    const authToken = optString(raw, 'auth_token')
    if (authToken === undefined || authToken === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', 'auth 响应缺 auth_token')
    }
    this.tokens = { authToken, refreshToken: optString(raw, 'refresh') ?? null }
    return this.tokens
  }

  /** 刷新 JWT（POST /auth/refresh）；无 refresh token 且是密码态 → 重登 */
  private async revalidate(): Promise<TokenPair> {
    const refresh = this.tokens?.refreshToken ?? (this.auth.type === 'token' ? (this.auth.refresh ?? null) : null)
    if (refresh !== null && refresh !== '') {
      const raw = await this.exchange('/auth/refresh', { refresh })
      const authToken = optString(raw, 'auth_token')
      if (authToken === undefined || authToken === '') {
        throw new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', 'auth/refresh 响应缺 auth_token')
      }
      this.tokens = { authToken, refreshToken: optString(raw, 'refresh') ?? refresh }
      return this.tokens
    }
    return this.login() // 密码态兜底：无 refresh token 就重登
  }

  /** 免认证的信息交换（登录/刷新自身）；失败统一收口 auth-rejected */
  private async exchange(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchOnce({ method: 'POST', path, body }, null)
    if (!res.ok) {
      let raw: unknown = null
      try {
        raw = await res.json()
      } catch {
        // 错误体非 JSON：保留状态码
      }
      const detail = extractErrorDetail(raw) ?? `HTTP ${String(res.status)}`
      throw new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', `认证交换失败（${path}，${String(res.status)}）：${detail}`)
    }
    try {
      return asObject(await res.json(), path)
    } catch (err) {
      if (err instanceof TaigaPlatformError) {
        throw new TaigaPlatformError('CONFIG_INVALID', 'auth-rejected', `认证交换响应不是合法形状（${path}）`)
      }
      throw err
    }
  }

  private async ensureTokens(): Promise<TokenPair> {
    if (this.tokens !== null) return this.tokens
    if (this.auth.type === 'token') {
      this.tokens = { authToken: this.auth.token, refreshToken: this.auth.refresh ?? null }
      return this.tokens
    }
    return this.login()
  }

  /** 一次请求：认证头 + JSON + 状态映射；401 时刷新/重登后重试一次 */
  async request(req: TaigaRequest): Promise<RawResponse> {
    let tokens = await this.ensureTokens()
    let res = await this.fetchOnce(req, tokens.authToken)
    if (res.status === 401) {
      tokens = await this.revalidate()
      res = await this.fetchOnce(req, tokens.authToken)
    }
    if (!res.ok) {
      let raw: unknown = null
      try {
        raw = await res.json()
      } catch {
        // 错误体非 JSON：保留状态码
      }
      const detail = extractErrorDetail(raw) ?? `HTTP ${String(res.status)}`
      throw mapStatusToError(res.status, detail, req.path)
    }
    let json: unknown
    if (res.status === 204) {
<<<<<<< ours
      // 204 No Content：DELETE 端点惯例（出厂态退役 S0 定版，docs/32-§九）——无体合法
      json = null
=======
      json = null // 204 No Content（DELETE 族端点，如 memberships 移除）：无体即无 JSON，null 代空
>>>>>>> theirs
    } else {
      try {
        json = await res.json()
      } catch (err) {
        throw new TaigaPlatformError('CONFIG_INVALID', 'unexpected-response', `响应不是合法 JSON（${req.path}）：${String(err)}`)
      }
    }
    return { status: res.status, json, header: (name: string) => res.headers.get(name) }
  }

  /**
   * 分页迭代：page 从 1 起，翻到取尽（x-pagination-count 总数为准，短页/空页兜底）。
   * 头缺失（fake/代理剥头）时按「短页即止」收敛——不依赖 X-Pagination-Next。
   */
  async paginate<T>(req: TaigaRequest, parse: (raw: unknown) => T[], pageSize: number): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = { ...(req.query ?? {}), page: String(page), page_size: String(pageSize) }
      const res = await this.request({ ...req, query })
      const batch = parse(res.json)
      out.push(...batch)
      const countHeader = res.header('x-pagination-count')
      const count = countHeader === null ? null : Number(countHeader)
      if (Number.isFinite(count) && out.length >= (count as number)) break
      if (batch.length < pageSize) break // 短页即止（头缺失时的收敛路径）
    }
    return out
  }
}
