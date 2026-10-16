/**
 * 薄 HTTP 客户端 —— 自研 fetch+zod（docs/16-§二 选型定稿：不引重型 SDK）。
 *
 * 纪律（docs/03 N10 防坑）：
 *   - 只发 YouTrack 实测认账的参数（query/fields/$top/$skip）——未知参数会被**静默丢弃**，
 *     绝不发明 after/start 之类的游标参数（NA1 教训，见 activity.ts）
 *   - 分页必须 $top/$skip（activity/issues 列表都走这条）
 *   - fields 参数必带：缺 fields 只回 id，形状不可用（docs/03-§一）
 *
 * v0 明确不做（头注纪律）：超时、重试、限流退避——本层一次请求=一次 fetch。
 * fetch 可注入（测试 fake 回放，零真实网络；真实例冒烟是独立集成单）。
 */
import type { z } from 'zod'
import { YouTrackPlatformError } from './errors.ts'

/** 注入面：与全局 fetch 结构兼容的最小签名（测试用状态桩实现同形函数） */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export interface YtRequest {
  method: HttpMethod
  /** 相对路径（/api/... 起） */
  path: string
  /** 查询参数：键原样（$top/$skip 保持可读），值 encodeURIComponent */
  query?: Record<string, string>
  /** 请求体（JSON 序列化） */
  body?: unknown
}

function mapStatusToError(status: number, detail: string): YouTrackPlatformError {
  if (status === 400) return new YouTrackPlatformError('CONFIG_INVALID', 'bad-request', `平台拒收请求（400）：${detail}`)
  if (status === 401 || status === 403) {
    return new YouTrackPlatformError('CONFIG_INVALID', 'auth-rejected', `认证/权限被拒（${status}）：${detail}`)
  }
  if (status === 404) return new YouTrackPlatformError('EXTERNAL_REJECT', 'not-found', `目标不存在（404）：${detail}`)
  if (status === 409) return new YouTrackPlatformError('EXTERNAL_REJECT', 'conflict', `平台并发冲突（409）：${detail}`)
  if (status === 429) return new YouTrackPlatformError('EXTERNAL_REJECT', 'rate-limited', `平台限流（429）：${detail}`)
  if (status >= 500) return new YouTrackPlatformError('EXTERNAL_REJECT', 'server-error', `平台侧故障（${status}）：${detail}`)
  return new YouTrackPlatformError('CONFIG_INVALID', 'client-error', `未分类 4xx（${status}）：${detail}`)
}

export class YtHttpClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchLike: FetchLike

  constructor(baseUrl: string, token: string, fetchLike: FetchLike) {
    this.baseUrl = baseUrl
    this.token = token
    this.fetchLike = fetchLike
  }

  /** 构造完整 URL（测试断言用）；查询串键原样、值编码 */
  buildUrl(req: YtRequest): string {
    const base = this.baseUrl.replace(/\/+$/, '')
    const pairs = Object.entries(req.query ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    return pairs.length === 0 ? `${base}${req.path}` : `${base}${req.path}?${pairs.join('&')}`
  }

  /** 一次请求：认证头 + JSON 体 + 状态映射 + zod 校验（未建模字段透传为 unknown） */
  async request<T>(schema: z.ZodType<T>, req: YtRequest): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    }
    const init: { method: HttpMethod; headers: Record<string, string>; body?: string } = {
      method: req.method,
      headers,
    }
    if (req.body !== undefined) {
      init.body = JSON.stringify(req.body)
      headers['Content-Type'] = 'application/json'
    }
    let res: Response
    try {
      res = await this.fetchLike(this.buildUrl(req), init)
    } catch (err) {
      throw new YouTrackPlatformError(
        'EXTERNAL_REJECT',
        'network-error',
        `YouTrack 不可达（${this.baseUrl}）：${String(err)}`,
      )
    }
    if (!res.ok) {
      let detail = `HTTP ${String(res.status)}`
      try {
        const parsed = (await res.json()) as unknown
        if (typeof parsed === 'object' && parsed !== null && 'error_description' in parsed) {
          detail = String((parsed as Record<string, unknown>)['error_description'])
        }
      } catch {
        // 错误体不是 JSON：保留状态码描述
      }
      throw mapStatusToError(res.status, detail)
    }
    let raw: unknown
    try {
      raw = await res.json()
    } catch (err) {
      throw new YouTrackPlatformError(
        'CONFIG_INVALID',
        'unexpected-response',
        `响应不是合法 JSON（${req.path}）：${String(err)}`,
      )
    }
    const checked = schema.safeParse(raw)
    if (!checked.success) {
      const issues = checked.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')
      throw new YouTrackPlatformError(
        'CONFIG_INVALID',
        'unexpected-response-shape',
        `响应形状与适配器模型不符（${req.path}）：${issues}`,
      )
    }
    return checked.data
  }
}
