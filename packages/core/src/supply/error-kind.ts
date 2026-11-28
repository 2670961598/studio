/**
 * supply/error-kind —— 供给错误分类（task-157 / FIX-03；docs/quality/supply-quota-gating.md §1）
 *
 * 纯函数、零 IO、时间入参（now 由调用方给）。把散落在路由/收割面的字符串启发式收敛为
 * 一张显式分类表：`classifySupplyError` 判 kind / retryability / 配额窗口 / resetAt，
 * `classifyHarvestFailure` 给 GATE_FAIL 归因（四要件语义不动），`errorKindNote` 产审计尾段
 * （只追加在既有 note 末尾——事件词/契约枚举零增删）。
 *
 * 证据位 `evidence`：有正向证据=status|code|message；default=无证据——路由面按既有缺省
 * `server` 冷却（行为不变），收割面按 `quality` 归因（§1.2）。
 */

export type QuotaWindow = 'five_hour' | 'week' | 'month' | 'unknown'

export type ErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'overload'
  | 'server'
  | 'timeout'
  | 'network'
  | 'config'
  | 'parse'
  | 'bad_request'
  | 'refusal'
  | 'worker_dead'
  | 'quality'

/**
 * 可重试性：retryable=原样可再派；wait_reset=reset 前不可重试（携 resetAt）；
 * fatal_config=改配置前不可重试；quality=验收/质量失败（重派走人工/新 attempt 语义）；
 * terminal=请求本身不被接受（换源/改请求才有意义）。
 */
export type Retryability = 'retryable' | 'wait_reset' | 'fatal_config' | 'quality' | 'terminal'

export type ErrorEvidence = 'status' | 'code' | 'message' | 'default'

export interface ErrorClassification {
  readonly kind: ErrorKind
  readonly retryability: Retryability
  /** 恒等价于 retryability==='retryable'（审计段直接可读） */
  readonly retryable: boolean
  /** 仅 quota 类携带（§1.3） */
  readonly quotaWindow?: QuotaWindow
  /** 仅 quota/rate_limit 且解析到有效 reset（> now）时携带 */
  readonly resetAt?: number
  /** 上游错误码（GLM code=1310/1308/1302 等） */
  readonly providerCode?: string
  readonly evidence: ErrorEvidence
}

/** 绝对时间文案的时区偏移缺省：UTC+8（GLM 文案=北京时间帧，哨查日志与重置时刻同帧） */
export const DEFAULT_RESET_TZ_OFFSET_MS = 8 * 60 * 60_000

export interface ClassifyErrorOptions {
  readonly tzOffsetMs?: number
}

const RETRYABILITY_OF: Readonly<Record<ErrorKind, Retryability>> = {
  auth: 'fatal_config',
  quota: 'wait_reset',
  rate_limit: 'retryable',
  overload: 'retryable',
  server: 'retryable',
  timeout: 'retryable',
  network: 'retryable',
  config: 'fatal_config',
  parse: 'retryable',
  bad_request: 'terminal',
  refusal: 'terminal',
  worker_dead: 'retryable',
  quality: 'quality',
}

export function retryabilityOf(kind: ErrorKind): Retryability {
  return RETRYABILITY_OF[kind]
}

/** 网络类错误码（优先于 status/message；ECONNREFUSED 不得命中 refusal 正则——task-57 F1） */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', 'ECONNABORTED',
])
const NETWORK_MESSAGE = /\bE(?:CONNREFUSED|NOTFOUND|AI_AGAIN|CONNRESET|NETUNREACH|TIMEDOUT|HOSTUNREACH|PIPE|CONNABORTED)\b|socket hang up|closed handle|premature close/i
/** 凭据名词（强证据）：credential / API key / secret / 带限定词的 token（auth·access·api·bearer·refresh） */
const CREDENTIAL_NOUN = String.raw`credentials?|api[\s_-]?key|secret|(?:auth|access|api|bearer|refresh)[\s_-]?token`
/** 缺凭据文案（强证据）：no credential / no API key / no auth token；API key missing；missing API key */
const CONFIG_CREDENTIAL_STRONG = new RegExp(
  String.raw`\bno[\s_-]?(?:${CREDENTIAL_NOUN})\b`
    + String.raw`|\b(?:${CREDENTIAL_NOUN})\b[^.\n]{0,40}\b(?:missing|not configured|not provided|not found|unavailable|未配置|缺失)\b`
    + String.raw`|\b(?:missing|absent)\b[^.\n]{0,12}\b(?:${CREDENTIAL_NOUN})\b`,
  'i',
)
/** 缺 adapter/地区限制（我方无可用凭据或供给面不可达——改配置前重试无意义） */
const CONFIG_PATTERNS: readonly RegExp[] = [
  /[A-Z][A-Z0-9_]{2,}(?:,? which is| is| was) not set/,
  CONFIG_CREDENTIAL_STRONG,
  /\bno (?:registered )?adapter\b|\badapter (?:not found|missing|unknown)\b|\bunknown (?:executor|provider)\b|\bunsupported (?:executor|provider)\b|找不到[^。\n]{0,12}适配/i,
  /unsupported_country|country, region, or territory|\b(?:not|cannot) (?:available|allowed|supported|access)\b[^.\n]{0,24}\b(?:country|region)\b|\b(?:country|region)\b[^.\n]{0,24}\b(?:not (?:allowed|supported|available)|blocked|restricted)\b|地区限制|该地区(?:不可|暂不)/i,
]
/** 裸 `token` 的缺凭据文案（CLI 级，如 no token provided / missing token）：仅无 4xx 校验态时采信——
 *  带 4xx 状态的「input token missing」是请求体校验（bad_request），不是缺凭据 */
const CONFIG_BARE_TOKEN = /\bno[\s_-]?token\b|\btoken\b[^.\n]{0,40}\b(?:missing|not configured|not provided|未配置|缺失)\b|\b(?:missing|absent)\b[^.\n]{0,12}\btoken\b/i
const TIMEOUT_MESSAGE = /\b(?:timeout|timed out|time out)\b|ETIMEDOUT|超时|exit=124\b/i
const OVERLOAD_MESSAGE = /\[overloaded\]|server is overloaded|\boverloaded\b/i
const RATE_LIMIT_MESSAGE = /\brate[\s_-]?limit|1302|速率限制|频率限制|throttl|requests per (?:second|minute|day)/i
// 词界按字母/数字判定（下划线不算词字符：exceeded_current_quota_error 须命中）
const QUOTA_MESSAGE = /(?<![a-z\d])(?:quota|allowance|exhausted|429|usage (?:limit|cap)|insufficient_quota|limit reached)(?![a-z\d])|额度|配额|使用上限/i
const REFUSAL_MESSAGE = /\b(?:refus(?:ed|al)|safety|blocked by safety)\b|安全拒答|内容审核/i
const PARSE_MESSAGE = /\b(?:parse|JSON)\b/i
/** 窗口词（判定序即优先序：「每周/每月」同现取 week） */
const WINDOW_PATTERNS: ReadonlyArray<readonly [QuotaWindow, RegExp]> = [
  ['five_hour', /\b5[\s-]?hours?\b|five[\s-]?hour|\b5h\b|\b1308\b/i],
  ['week', /每周|weekly|\b7[\s-]?days?\b|\b1310\b/i],
  ['month', /每月|monthly|月度/i],
]
const OVERLOAD_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 529])

interface ErrorLike {
  readonly status?: unknown
  readonly statusCode?: unknown
  readonly code?: unknown
  readonly name?: unknown
  readonly message?: unknown
  readonly retryAfterMs?: unknown
  readonly retryAfter?: unknown
}

function errorLikeOf(err: unknown): ErrorLike {
  if (typeof err === 'string') return { message: err }
  if (typeof err === 'object' && err !== null) return err as ErrorLike
  return {}
}

/** HTTP 状态：status/statusCode 字段优先；否则文案里的 4xx/5xx（行首/分隔后，不吞 4 位错误码与时间戳） */
function statusOf(e: ErrorLike, message: string): number | undefined {
  for (const raw of [e.status, e.statusCode]) if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  const m = /(?:^|[\s;[（(]|status[ =:]|HTTP[ /])([45]\d\d)(?!\d)/.exec(message)
  return m === null ? undefined : Number(m[1])
}

function providerCodeOf(e: ErrorLike, message: string): string | undefined {
  const fromField = typeof e.code === 'number' ? String(e.code) : typeof e.code === 'string' && /^\d{3,6}$/.test(e.code) ? e.code : undefined
  if (fromField !== undefined) return fromField
  const m = /\bcode[ =:]["']?(\d{3,6})/.exec(message)
  return m === null ? undefined : m[1]
}

/** 窗口词（§1.3）：有窗口证据即 quota（压过 rate limit 字样） */
export function quotaWindowOf(message: string): QuotaWindow | undefined {
  for (const [window, pattern] of WINDOW_PATTERNS) if (pattern.test(message)) return window
  return undefined
}

const UNIT_MS: Readonly<Record<string, number>> = {
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
}
const RELATIVE_RESET = /\b(?:resets?|try again|retry)[^.\d]{0,24}?\bin (\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/i
const RETRY_AFTER_MESSAGE = /\bretry-after[ :]+(\d+(?:\.\d+)?)/i
/** 绝对时间：须有「重置/reset」语境；取最后一个日期时间（§1.3 ①） */
const ABSOLUTE_RESET_CONTEXT = /重置|reset/i
const ABSOLUTE_DATETIME = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/g

function positive(n: number | undefined): number | undefined {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * reset 时刻解析（仅 quota/rate_limit 类使用）：① 绝对时间（按 tzOffsetMs 帧）② 相对时长
 * ③ Retry-After。结果 ≤ now 视为无效（文案陈旧/时钟漂移）→ undefined。
 */
export function parseQuotaResetAt(message: string, now: number, tzOffsetMs: number = DEFAULT_RESET_TZ_OFFSET_MS): number | undefined {
  if (ABSOLUTE_RESET_CONTEXT.test(message)) {
    let last: number | undefined
    for (const m of message.matchAll(ABSOLUTE_DATETIME)) {
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - tzOffsetMs
      if (Number.isFinite(ms)) last = ms
    }
    const valid = last !== undefined && last > now ? last : undefined
    if (valid !== undefined) return valid
  }
  const rel = RELATIVE_RESET.exec(message)
  if (rel !== null) {
    const unit = UNIT_MS[rel[2]!.toLowerCase()]
    const ms = unit === undefined ? undefined : now + Number(rel[1]) * unit
    if (ms !== undefined && ms > now) return ms
  }
  const retryAfter = RETRY_AFTER_MESSAGE.exec(message)
  if (retryAfter !== null) return now + Number(retryAfter[1]) * 1_000
  return undefined
}

function retryAfterMsOf(e: ErrorLike): number | undefined {
  const direct = positive(typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined)
  if (direct !== undefined) return direct
  const raw = e.retryAfter
  const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()) ? Number(raw) : undefined
  return positive(seconds === undefined ? undefined : seconds * 1_000)
}

function classify(kind: ErrorKind, evidence: ErrorEvidence, extra: { quotaWindow?: QuotaWindow | undefined; resetAt?: number | undefined; providerCode?: string | undefined } = {}): ErrorClassification {
  const retryability = RETRYABILITY_OF[kind]
  return {
    kind,
    retryability,
    retryable: retryability === 'retryable',
    ...(extra.quotaWindow !== undefined ? { quotaWindow: extra.quotaWindow } : {}),
    ...(extra.resetAt !== undefined ? { resetAt: extra.resetAt } : {}),
    ...(extra.providerCode !== undefined ? { providerCode: extra.providerCode } : {}),
    evidence,
  }
}

/**
 * 供给错误分类（§1.1，判定序即表序）：网络码 → 408 → 429 族（overload / 窗口 / rate_limit /
 * quota）→ config 文案 → 401/403 → 5xx → 其余 4xx（refusal/bad_request）→ 文案（timeout /
 * 配额 / refusal / parse）→ 无证据缺省 server（evidence=default）。
 */
export function classifySupplyError(err: unknown, now: number, options?: ClassifyErrorOptions): ErrorClassification {
  const e = errorLikeOf(err)
  const message = typeof e.message === 'string' ? e.message : String(e.message ?? '')
  const providerCode = providerCodeOf(e, message)
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : undefined
  if (code !== undefined && NETWORK_CODES.has(code)) return classify('network', 'code')
  if (code === undefined && NETWORK_MESSAGE.test(message)) return classify('network', 'message')

  const status = statusOf(e, message)
  const tzOffsetMs = options?.tzOffsetMs
  /** resetAt：文案（绝对/相对/Retry-After）优先，其次 retryAfterMs/retryAfter 字段 */
  const resetAt = (): number | undefined => {
    const fromMessage = parseQuotaResetAt(message, now, tzOffsetMs)
    if (fromMessage !== undefined) return fromMessage
    const retryAfter = retryAfterMsOf(e)
    return retryAfter === undefined ? undefined : now + retryAfter
  }
  const quotaLike = (): ErrorClassification => {
    const window = quotaWindowOf(message)
    const at = resetAt()
    return classify('quota', status === 429 ? 'status' : 'message', { quotaWindow: window ?? 'unknown', resetAt: at, providerCode })
  }
  if (status === 408) return classify('timeout', 'status', { providerCode })
  if (status === 429) {
    if (OVERLOAD_MESSAGE.test(message)) return classify('overload', 'status', { providerCode })
    if (quotaWindowOf(message) === undefined && RATE_LIMIT_MESSAGE.test(message)) {
      return classify('rate_limit', 'status', { resetAt: resetAt(), providerCode })
    }
    return quotaLike()
  }
  const requestValidation = status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 403
  if (CONFIG_PATTERNS.some((pattern) => pattern.test(message)) || (!requestValidation && CONFIG_BARE_TOKEN.test(message))) {
    return classify('config', 'message', { providerCode })
  }
  if (status === 401 || status === 403) return classify('auth', 'status', { providerCode })
  if (status !== undefined && status >= 500) {
    return classify(OVERLOAD_STATUSES.has(status) ? 'overload' : 'server', 'status', { providerCode })
  }
  if (status !== undefined && status >= 400) {
    return classify(REFUSAL_MESSAGE.test(message) ? 'refusal' : 'bad_request', 'status', { providerCode })
  }
  if (e.name === 'TimeoutError' || TIMEOUT_MESSAGE.test(message)) return classify('timeout', 'message', { providerCode })
  if (quotaWindowOf(message) !== undefined || QUOTA_MESSAGE.test(message)) return quotaLike()
  if (RATE_LIMIT_MESSAGE.test(message)) return classify('rate_limit', 'message', { resetAt: resetAt(), providerCode })
  if (REFUSAL_MESSAGE.test(message)) return classify('refusal', 'message', { providerCode })
  if (PARSE_MESSAGE.test(message)) return classify('parse', 'message', { providerCode })
  return classify('server', 'default', { providerCode })
}

/**
 * 收割面归因（§1.2；GATE_FAIL 尾段与路由回填口径）：WORKER_DEAD → worker_dead；
 * CONFIG_INVALID → config；终局错误有供给正向证据 → 该 kind；闸门超时 → timeout；
 * 其余（四要件缺）→ quality。
 */
export function classifyHarvestFailure(input: { detail: string; terminalError?: string | undefined; now: number }): ErrorClassification {
  if (/^WORKER_DEAD\b/.test(input.detail)) return classify('worker_dead', 'message')
  if (/^CONFIG_INVALID\b/.test(input.detail)) return classify('config', 'message')
  const terminal = input.terminalError?.trim() ?? ''
  if (terminal !== '') {
    const cls = classifySupplyError({ message: terminal }, input.now)
    if (cls.evidence !== 'default') return cls
  }
  if (/\(timeout\)|exit=124\b/.test(input.detail)) return classify('timeout', 'message')
  return classify('quality', 'default')
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * 审计尾段（§3；只追加在既有 note 末尾，panel 正则锚不受影响）：
 * `;errorKind=<k>;retryable=<b>[;quotaWindow=<w>;resetAt=<iso>][;providerCode=<c>][;provider=<p>;account=<a>]`
 */
export function errorKindNote(cls: ErrorClassification, extra?: { provider?: string | undefined; account?: string | undefined }): string {
  let note = `;errorKind=${cls.kind};retryable=${cls.retryable ? 'true' : 'false'}`
  if (cls.quotaWindow !== undefined) note += `;quotaWindow=${cls.quotaWindow}`
  if (cls.resetAt !== undefined) note += `;resetAt=${isoOf(cls.resetAt)}`
  if (cls.providerCode !== undefined) note += `;providerCode=${cls.providerCode}`
  if (extra !== undefined) note += `;provider=${extra.provider ?? '-'};account=${extra.account ?? '-'}`
  return note
}
