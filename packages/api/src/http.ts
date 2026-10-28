/**
 * packages/api/src/http.ts —— 对外 API 的公共 HTTP 语义（错误体/公司维/读上下文/校验）
 *
 * 依据：
 *   - docs/v2/14 §四错误模型（唯一错误体 `{ error:{ failure, category, subcause }, traceId }`；
 *     422 外层加 fieldPath、501 外层加 reason、429 外层加 retryAfter；三边界不串味：
 *     记录不存在→503 receipt-not-in-snapshot、路由不存在→404、读不出来→500）；
 *   - docs/v2/14 §四跨公司一致性（?company= 读写同一解析规则；解析出的公司维与挂载维
 *     不一致＝4xx 拒绝，不静默落错库）；
 *   - docs/v2/15 §三 SEC-WD-01、§五 SEC-RD-01（读面 readScope/caller 字段承载）；
 *   - docs/v2/14 §0.2-3 幂等键四槽（公司×来源×种类×票据或去重键）。
 *
 * 本件零 IO：除 `createHash`（payload 摘要）与 `randomUUID`（trace 兜底）外不触外部；
 * 公司维/身份/投影数据都来自注入面，API 进程零库零平台。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  CallerRef,
  CompanyRef,
  FailureCategory,
  IntentReceipt,
  PortFailure,
  ReadContext,
} from '@studio-next/contract'
import type { ApiEnv, ApiRouteDeps } from './types.ts'

/** 请求体上限（字节；Content-Length 预检＋实读复检，防 chunked 绕过） */
export const MAX_REQUEST_BODY_BYTES = 100_000

/** /v1/issues 缺省页大小与上限（夹取，不放大） */
export const DEFAULT_ISSUES_LIMIT = 20
export const MAX_ISSUES_LIMIT = 100

/** 单字段最大长度（字符串槽防拉爆） */
export const MAX_TEXT_FIELD_LENGTH = 200

/** 只读面调用者（程序位；权源不由 token/凭据承担——读面公开视图） */
export const READ_CALLER: CallerRef = Object.freeze({
  callerId: 'api:public-read',
  kind: 'program',
  programRef: 'PORT-OBS',
})

/** 路由上下文别名（traceId 由应用级中间件注入） */
export type ApiHttpContext = Context<ApiEnv>

/** 是否普通对象（数组/null 不算——JSON 对象槽的判据） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空字符串（trim 后非空；不自动 trim 返回值——保留原值供键/URL 使用） */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** traceId 读面（中间件缺省时兜底常量——不伪造；错误体仍可归链） */
export function traceOf(c: ApiHttpContext): string {
  const trace = c.get('traceId')
  return typeof trace === 'string' && trace !== '' ? trace : 'trace-unavailable'
}

/** 时钟（注入源优先；异常兜底系统时钟——不把错误吞成成功） */
export function nowIso(deps: Pick<ApiRouteDeps, 'obs'>): string {
  try {
    const reading = deps.obs.clock()
    if (isNonEmptyString(reading.now)) return reading.now
  } catch {
    // 注入时钟坏＝读不出来：兜底系统时钟只用于错误/回执时间戳，不冒充权威历史
  }
  return new Date().toISOString()
}

/** 新标识（trace/事件 id；注入 `newId` 优先，异常兜底 UUID） */
export function newTraceId(deps: Pick<ApiRouteDeps, 'obs'>): string {
  try {
    const id = deps.obs.newId('trace')
    if (isNonEmptyString(id.value)) return id.value
  } catch {
    // 同上：标识注入坏不阻塞请求，UUID 兜底仍唯一
  }
  return randomUUID()
}

/** 错误体附加槽（仅文档冻结的三项外层槽；其余一律不进错误体） */
export interface ApiErrorOptions {
  readonly detail?: string
  readonly fieldPath?: string
  readonly reason?: string
  readonly retryAfter?: number
}

/**
 * 唯一错误体（v2/14 §四）：`{ error:{failure,category,subcause,detail?}, traceId }`，
 * 外层按状态附 fieldPath/reason/retryAfter。`category` 取失败十四类（v2/09 ENU-58）。
 */
export function apiError(
  c: ApiHttpContext,
  status: ContentfulStatusCode,
  failure: string,
  category: FailureCategory,
  subcause: string,
  options: ApiErrorOptions = {},
): Response {
  const error: { failure: string; category: FailureCategory; subcause: string; detail?: string } = {
    failure,
    category,
    subcause,
  }
  if (options.detail !== undefined) error.detail = options.detail
  const body: Record<string, unknown> = { error, traceId: traceOf(c) }
  if (options.fieldPath !== undefined) body['fieldPath'] = options.fieldPath
  if (options.reason !== undefined) body['reason'] = options.reason
  if (options.retryAfter !== undefined) body['retryAfter'] = options.retryAfter
  return c.json(body, status)
}

/** 400/422 族：请求槽不合法（fieldPath 指出首个坏槽） */
export function invalidRequest(
  c: ApiHttpContext,
  fieldPath: string,
  detail: string,
): Response {
  return apiError(c, 422, 'invalid-request', 'rejected_precondition', 'invalid-request', {
    fieldPath,
    detail,
  })
}

/** 404：路由不存在（与记录不存在=503 严格分开——三边界不串味） */
export function routeNotFound(c: ApiHttpContext): Response {
  return apiError(c, 404, 'route-not-found', 'unsupported', 'route-not-found')
}

/** 500：读不出来（subcause 透传；不伪装成 404/200） */
export function internalFailure(c: ApiHttpContext, detail: string): Response {
  return apiError(c, 500, 'internal', 'degraded', 'internal', { detail })
}

/** 503：读源未提供/未命中（不是 404；「查不到」≠「没有」） */
export function viewUnavailable(c: ApiHttpContext, view: string, reason: string): Response {
  return apiError(c, 503, 'view-unavailable', 'unavailable', 'view-unavailable', {
    reason: `${view}: ${reason}`,
  })
}

/** 503：读源形状不符合 API 视图契约（缺必填槽/类型错）——不猜测、不补默认值 */
export function viewShapeInvalid(c: ApiHttpContext, view: string, detail: string): Response {
  return apiError(c, 503, 'projection-degraded', 'degraded', 'view-shape-invalid', {
    reason: `${view}: ${detail}`,
  })
}

/** 数值槽（有限数；NaN/Infinity 不算数值——未知不冒充 0） */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 503：注入的读源返回了别的公司维（wiring 安全 bug）。
 * 不服务该视图——跨公司读隔离失败时「宁可不显示」也不显示别家数据（NEG-SEC-02 读腿）。
 */
export function sourceCompanyMismatch(c: ApiHttpContext, view: string, kind: 'missing' | 'mismatch'): Response {
  const subcause = kind === 'missing' ? 'source-company-missing' : 'source-company-mismatch'
  return apiError(c, 503, 'projection-degraded', 'degraded', subcause, {
    reason: `${view}: 读源公司维不可校验（${kind}）——跨公司读隔离 fail-closed，不服务该视图`,
  })
}

/** 公司维比对（slug 或 companyId 任一命中即同维；两槽都来自同一挂载注入面） */
export function companyMatches(value: unknown, mounted: CompanyRef): boolean {
  return value === mounted.slug || value === mounted.companyId
}

/** 视图公司维三态（缺失也算失败——未声明公司维的投影不得对外） */
export function checkViewCompany(value: unknown, mounted: CompanyRef): 'ok' | 'missing' | 'mismatch' {
  if (!isNonEmptyString(value)) return 'missing'
  return companyMatches(value, mounted) ? 'ok' : 'mismatch'
}

/** 公司解析结果（失败已带响应，调用方直接 return） */
export type CompanyResolution =
  | { readonly ok: true; readonly company: CompanyRef }
  | { readonly ok: false; readonly response: Response }

/** GET 读面公司解析：?company= 缺省=挂载公司；给出则必须同维（否则 403） */
export function resolveCompanyDimension(c: ApiHttpContext, deps: Pick<ApiRouteDeps, 'company'>): CompanyResolution {
  const requested = c.req.query('company')
  if (requested === undefined) return { ok: true, company: deps.company }
  if (requested.trim() === '') {
    return { ok: false, response: invalidRequest(c, 'company', '?company= 不得为空') }
  }
  if (!companyMatches(requested, deps.company)) {
    return {
      ok: false,
      response: apiError(c, 403, 'company-scope-mismatch', 'rejected_forbidden', 'company-scope-mismatch', {
        detail: '请求公司维与挂载公司维不一致（跨公司读隔离 fail-closed；读写同一解析规则）',
      }),
    }
  }
  return { ok: true, company: deps.company }
}

/**
 * 写面公司维解析（query 与 body 同规则）：缺省=挂载公司；给出必须同维。
 * query 与 body 同时给出且不等＝构造歧义 422（不猜哪个生效）。
 */
export function resolveRequestCompany(
  c: ApiHttpContext,
  deps: Pick<ApiRouteDeps, 'company'>,
  bodyCompany: unknown,
): CompanyResolution {
  const queryCompany = c.req.query('company')

  if (bodyCompany !== undefined && (typeof bodyCompany !== 'string' || bodyCompany.trim() === '')) {
    return { ok: false, response: invalidRequest(c, 'company', 'company 须为非空字符串') }
  }
  if (queryCompany !== undefined && queryCompany.trim() === '') {
    return { ok: false, response: invalidRequest(c, 'company', '?company= 不得为空') }
  }

  // 两处同给：都必须落在挂载公司维（slug/ID 别名可互认）；任一错维＝403（不猜哪个生效）
  if (bodyCompany !== undefined && queryCompany !== undefined) {
    if (!companyMatches(bodyCompany, deps.company) || !companyMatches(queryCompany, deps.company)) {
      return {
        ok: false,
        response: apiError(c, 403, 'company-scope-mismatch', 'rejected_forbidden', 'company-scope-mismatch', {
          detail: 'query 与 body 的公司维必须同时等于挂载公司维（SEC-WD-01，错绑不静默落库）',
        }),
      }
    }
    return { ok: true, company: deps.company }
  }

  const requested = bodyCompany ?? queryCompany
  if (requested === undefined) return { ok: true, company: deps.company }
  if (!companyMatches(requested, deps.company)) {
    return {
      ok: false,
      response: apiError(c, 403, 'company-scope-mismatch', 'rejected_forbidden', 'company-scope-mismatch', {
        detail: '写请求解析出的公司维与挂载公司维不一致＝4xx 拒绝（SEC-WD-01，不静默落错库）',
      }),
    }
  }
  return { ok: true, company: deps.company }
}

/** 读上下文（PORT-OBS/读取器同封套；fields 非空＝至少声明一个可读字段） */
export function readContextFor(
  deps: Pick<ApiRouteDeps, 'company'>,
  fields: readonly [string, ...string[]],
  purpose: string,
): ReadContext {
  return {
    readScope: { company: deps.company, fields, purpose },
    caller: READ_CALLER,
  }
}

/** 请求体读取结果（失败已带响应） */
export type RawBodyResult =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly response: Response }

/** 原始请求体读取（Content-Length 预检＋实读复检；超限=413，不读完整盘） */
export async function readRawBody(
  c: ApiHttpContext,
  limit: number = MAX_REQUEST_BODY_BYTES,
): Promise<RawBodyResult> {
  const declared = c.req.header('content-length')
  if (declared !== undefined) {
    const length = Number.parseInt(declared, 10)
    if (Number.isFinite(length) && length > limit) {
      return { ok: false, response: apiError(c, 413, 'payload-too-large', 'rejected_precondition', 'payload-too-large', {
        reason: `载荷上限 ${String(limit)} 字节（Content-Length=${String(length)}）`,
      }) }
    }
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > limit) {
    return { ok: false, response: apiError(c, 413, 'payload-too-large', 'rejected_precondition', 'payload-too-large', {
      reason: `载荷上限 ${String(limit)} 字节（实读超限）`,
    }) }
  }
  return { ok: true, raw }
}

/** JSON body 读取结果（对象槽；数组/null 不算对象） */
export type JsonBodyResult =
  | { readonly ok: true; readonly value: Record<string, unknown>; readonly raw: string }
  | { readonly ok: false; readonly response: Response }

/** JSON 请求体（先限长再解析；坏 JSON=422，不是 500） */
export async function readJsonBody(
  c: ApiHttpContext,
  limit: number = MAX_REQUEST_BODY_BYTES,
): Promise<JsonBodyResult> {
  const raw = await readRawBody(c, limit)
  if (!raw.ok) return raw
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.raw)
  } catch {
    return { ok: false, response: invalidRequest(c, '$', '请求体不是合法 JSON') }
  }
  if (!isRecord(parsed)) {
    return { ok: false, response: invalidRequest(c, '$', '请求体须为 JSON 对象') }
  }
  return { ok: true, value: parsed, raw: raw.raw }
}

/** 请求体严格键闸：未知顶层槽=422（fail-closed，拼错字段不被静默忽略） */
export function rejectUnknownKeys(
  c: ApiHttpContext,
  value: Record<string, unknown>,
  allowed: readonly string[],
): Response | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return invalidRequest(c, key, `未知请求字段 ${key}`)
  }
  return undefined
}

/** 可选字符串槽：缺省 undefined；给出必须是 ≤max 的非空字符串（否则 422） */
export function optionalString(
  c: ApiHttpContext,
  value: Record<string, unknown>,
  key: string,
  maxLength: number = MAX_TEXT_FIELD_LENGTH,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly response: Response } {
  const raw = value[key]
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, response: invalidRequest(c, key, `${key} 须为非空字符串`) }
  }
  if (raw.length > maxLength) {
    return { ok: false, response: invalidRequest(c, key, `${key} 长度超限（>${String(maxLength)}）`) }
  }
  return { ok: true, value: raw }
}

/** 必填字符串槽 */
export function requiredString(
  c: ApiHttpContext,
  value: Record<string, unknown>,
  key: string,
  maxLength: number = MAX_TEXT_FIELD_LENGTH,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly response: Response } {
  const parsed = optionalString(c, value, key, maxLength)
  if (!parsed.ok) return parsed
  if (parsed.value === undefined) {
    return { ok: false, response: invalidRequest(c, key, `${key} 必填`) }
  }
  return { ok: true, value: parsed.value }
}

/** 调用者三分（任职/位置/程序）；只承载身份，不承载权源 */
export function parseCaller(value: unknown): CallerRef | undefined {
  if (!isRecord(value)) return undefined
  const callerId = value['callerId']
  const kind = value['kind']
  if (!isNonEmptyString(callerId)) return undefined
  if (kind !== 'employment' && kind !== 'position' && kind !== 'program') return undefined
  const out: {
    callerId: string
    kind: 'employment' | 'position' | 'program'
    personId?: string
    positionRef?: string
    programRef?: string
  } = { callerId, kind }
  const personId = value['personId']
  if (isNonEmptyString(personId)) out.personId = personId
  const positionRef = value['positionRef']
  if (isNonEmptyString(positionRef)) out.positionRef = positionRef
  const programRef = value['programRef']
  if (isNonEmptyString(programRef)) out.programRef = programRef
  return out
}

/** 稳定序列化（键序无关；同内容恒同摘要——幂等同内容判据的输入面） */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? 'null'
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonical(item))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

/** 载荷摘要（sha256:<hex>；外部意图 payloadDigest 的 API 侧计算） */
export function payloadDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}


/**
 * 意图回执白名单（入口回执只承载 queued；intakeVerdict/acceptedAt 不在入口）。
 * `undefined`＝outcome 不是 queued 或形状不符（调用方映射 503，fail-closed）。
 */
export function pickIntentReceipt(receipt: IntentReceipt): Record<string, unknown> | undefined {
  if (receipt.outcome !== 'queued') return undefined
  const identity = receipt.identity
  if (typeof identity !== 'object' || identity === null) return undefined
  const company = identity.company
  if (typeof company !== 'object' || company === null) return undefined
  return {
    intentRef: receipt.intentRef,
    identity: {
      company: { companyId: company.companyId, slug: company.slug },
      source: identity.source,
      requestKind: identity.requestKind,
      key: identity.key,
    },
    outcome: receipt.outcome,
    commissionerRef: receipt.commissionerRef,
    anchorRef: receipt.anchorRef,
    queuedAt: receipt.queuedAt,
    deduped: receipt.deduped,
  }
}

/** 失败十四类 → HTTP 状态（Record 保证新增类别即编译红；未知不入默认放行） */
const FAILURE_STATUS: Readonly<Record<FailureCategory, ContentfulStatusCode>> = {
  rejected_precondition: 422,
  rejected_authority: 403,
  rejected_forbidden: 403,
  rejected_state: 409,
  rejected_version: 409,
  rejected_idempotency: 409,
  unsupported: 501,
  unavailable: 503,
  unverified: 503,
  partial: 503,
  conflict: 409,
  timeout: 503,
  cancelled: 503,
  degraded: 503,
}

/** PORT 失败 → 唯一错误体（Err 只表确定未产生外部效果的拒绝；结果不明由端口回 Ok(unknown)） */
export function portFailureResponse(c: ApiHttpContext, error: PortFailure, failure = 'port-rejected'): Response {
  return apiError(c, FAILURE_STATUS[error.category], failure, error.category, error.subcause, {
    ...(error.detail !== undefined ? { detail: error.detail } : {}),
  })
}

/** 页大小夹取（非正整数落回缺省；上限不放大） */
export function clampLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_ISSUES_LIMIT
  return Math.min(parsed, MAX_ISSUES_LIMIT)
}
