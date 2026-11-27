/**
 * agy stdout 终稿解析与失败分类（task-140 分片；BC-S2 尺寸阈「先拆后加」，docs/20-§十五）
 * ——纯函数，无 IO。适配器本体在 agy.ts；argv/env 构造件在 agy-argv.ts。只被 agy.ts 与
 * 测试直证引用（kimi-wire.ts 同例：不进 index.ts）。
 *
 * 终稿形态（单对象 JSON，非流）：
 *   - 实测（task-140 真机探针）：成功 `{status:"SUCCESS",response,conversation_id,
 *     duration_seconds,num_turns,usage}`；失败 `{status:"ERROR",error}`（auth/eligibility/
 *     region 样本见 docs/quality/agy-adapter.md §五）
 *   - 安装包静态核对（v1.5.18 二进制内嵌 changelog 与 Go 结构标签，未发起调用）：结果另带
 *     **可选** `finished_reason`——`print_timeout`（--print-timeout 到点、response 为残稿）/
 *     `interrupted`（被取消）/ `error`（其他失败）；失败时 stderr 另打结构化 `AGY_ERROR: {…}`
 *     行（canonical status / HTTP 或 gRPC 码 / retryability / error ID），退出码 3。
 *     两者与 stdout JSON 的同屏组合未实测——解析按「在场即采信」处理，不依赖组合假设
 *   - 真机实测（task-149，v1.5.18）：--print-timeout 到点的终稿形是 `{status:"ERROR",
 *     finished_reason:"print_timeout",error,response 残稿,num_turns,usage 全 0}`＋stderr
 *     AGY_ERROR 行（status=DEADLINE_EXCEEDED,reason=print_timeout）＋退出码 3——finished_reason
 *     先于 status 分支采信（挂 ERROR 不挂 SUCCESS）
 *
 * 口径：
 *   - 成功只认 status=SUCCESS + response 非空 + finished_reason 不在场（17-§6 收割口径的
 *     agy 形）；finished_reason 在场＝非正常收尾，**残稿不计完成**（fail-closed，不伪造成功）
 *   - 失败分类（实测样本归纳，非保证面）：auth→AUTH 码；quota→EXTERNAL_RATE_LIMIT 码；
 *     eligibility/region/network/timeout/other→词表外无码，文本承载（EXECUTOR_ERROR_CODES
 *     冻结词表只增不改、加码走批示）；未知文本落 other 不猜
 *   - 脱敏：错误文本/诊断片段进事件前过一道（凭据永不入日志——docs/25-§二红名单）
 *   - usage：input/output/cache_read 三桶（CLI 上报即落键、含 0——streams.ts 同口径；未上报或
 *     形状坏不落键）；thinking_tokens 无契约桶不折算不编造（实测样本 12297+121=12418=
 *     total_tokens——thinking 已含在 output 内）。**print_timeout 面例外**（task-149 真机：3338
 *     字残稿而 usage 全 0——回合未收尾、用量未结算）：usage 缺席/全 0 一律按未上报，不落键、
 *     不伪造零账，文本注明 `CLI 未上报（超时）`
 */
import { Buffer } from 'node:buffer'
import type { TokenCounts } from '@studio-next/contract'

/** agy 失败分类（task-140 口径 auth/eligibility/quota/network/timeout/other ＋ region 地区限制） */
export type AgyErrorKind = 'auth' | 'eligibility' | 'region' | 'quota' | 'network' | 'timeout' | 'other'

/** 分类结果：code 只用 EXECUTOR_ERROR_CODES 冻结词表成员（词表外无码，文本承载） */
export interface AgyErrorClass {
  readonly kind: AgyErrorKind
  readonly code?: 'AUTH' | 'EXTERNAL_RATE_LIMIT'
  /** 处置提示＋脱敏原文片段（凭据永不入账） */
  readonly detail: string
}

/**
 * stdout 终稿解析：SUCCESS → response/usage/num_turns/conversation_id；ERROR → 分类；
 * finished_reason 在场 → 残稿面（不计完成）；形状坏/坏 JSON → bad-shape / bad-json（如实分类不猜）。
 */
export type AgyOutcome =
  | {
      readonly kind: 'success'
      readonly response: string
      readonly conversationId?: string
      readonly numTurns?: number
      readonly usage?: TokenCounts
    }
  | {
      readonly kind: 'error'
      readonly errorClass: AgyErrorClass
      /** CLI 如实上报的用量（残稿/失败面也记账——claude result.usage 同口径；未上报不填） */
      readonly usage?: TokenCounts
      readonly conversationId?: string
      readonly numTurns?: number
      /** 残稿面：终稿带非空 response 但不计完成（有效模型回合的证据位，task-149②） */
      readonly partial?: true
      /** 用量未上报标注（print_timeout 面 usage 缺席/全 0；与 usage 互斥） */
      readonly usageUnreported?: true
    }
  | { readonly kind: 'bad-shape'; readonly reason: string }
  | { readonly kind: 'bad-json'; readonly reason: string }

/**
 * 有效模型回合证据（turns 记账判据，task-149③）：成功面恒真；失败面须有残稿（partial）或 CLI
 * 上报的非零 usage（三桶全 0＝模型没跑过或未结算，不是证据）。旗标解析失败/鉴权失败/watchdog
 * 抢杀等「status=ERROR 而无 response/usage」的面不计回合（不采信 CLI num_turns）。
 */
export function agyOutcomeHasModelTurn(outcome: AgyOutcome): boolean {
  if (outcome.kind === 'success') return true
  return outcome.kind === 'error' && (outcome.partial === true || (outcome.usage !== undefined && !isZeroTokens(outcome.usage)))
}

/**
 * stdout 字节分片 → 文本（task-149④：多字节 UTF-8 跨分片）。stdout 以 pipe 拉起、未设 encoding，
 * 逐片给 Buffer——逐片 `String(chunk)` 各自解码时，被管道边界拆开的多字节字符（CJK 3 字节、
 * emoji 4 字节）两头都成 U+FFFD（长终稿超 64KB 管道缓冲必现）。全片拼回一个 Buffer 再统一
 * 解码；string 片（上游已按边界解码）原样拼接。纯函数，字节不变。
 */
export function decodeAgyStdout(chunks: readonly (Buffer | string)[]): string {
  if (chunks.length === 0) return ''
  return Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : c))).toString('utf8')
}

/** 进事件/日志前的片段上限（字符） */
const SNIPPET_MAX = 400
/** 脱敏前的输入预裁（防超大 stdout 拖慢正则；终稿是单对象 JSON，正常远小于此） */
const SANITIZE_INPUT_MAX = 100_000

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** 脱敏：凭据形态（Bearer/sk-/AIza/ya29./JWT/长 base64 或 hex/URL 口令/JSON token 值）一律
 * 打码，ANSI 转义剥除，空白折叠，截断到 max（错误文本/诊断片段进 log/事件前必过） */
export function sanitizeAgyText(text: string, max: number = SNIPPET_MAX): string {
  return text
    .slice(0, SANITIZE_INPUT_MAX)
    .replace(ANSI_RE, '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/("(?:access_token|refresh_token|id_token|token|api[_-]?key|secret|password|authorization)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*\b/g, '[REDACTED]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const REGION_RE =
  /location\s+not\s+supported|unsupported\s+(?:location|region|country)|(?:region|country|location)\s+(?:is\s+)?not\s+(?:supported|available|allowed)|(?:not\s+be\s+)?available\s+in\s+your\s+(?:region|country|location)|geo[\s-]?block/i
const ELIGIBILITY_RE = /eligib|entitlement|verify\s+your\s+account|account\s+verification|terms?\s+of\s+service|\bTOS\b/i
const AUTH_RE =
  /authenticat|unauthori[sz]ed|unauthenticated|\b401\b|log[\s-]?in|sign[\s-]?in|oauth|credential|invalid[_-]?grant|token\s+(?:expired|has\s+expired|is\s+invalid|invalid)/i
const QUOTA_RE =
  /usage\s+limit|quota|rate[\s-]?limit|too\s+many\s+requests|resource[\s_]?exhausted|(?:^|[^0-9])429([^0-9]|$)|exceed(?:ed|ing)?\s+(?:your\s+|the\s+)?(?:daily\s+|request\s+|quota\s+|credit\s+)?limit|out\s+of\s+credits|insufficient\s+(?:quota|credits)/i
const NETWORK_RE =
  /dial\s*tcp|connection\s+(?:refused|reset|closed|aborted)|no\s+such\s+host|could\s+not\s+resolve|resolve\s+host|server\s+misbehaving|network\s+is\s+unreachable|host\s+is\s+unreachable|proxy|i\/o\s+timeout|tls\s+handshake|x509|certificate\s+(?:is\s+valid\s+for|signed\s+by\s+unknown|verify\s+failed|has\s+expired|expired)|econn(?:refused|reset|aborted)|enotfound|eai_again|ehostunreach|enetunreach|unexpected\s+eof|socket\s+hang\s+up|(?<![a-z])unavailable\b|(?<![0-9a-z])50[234](?![0-9])/i
const TIMEOUT_RE = /timed?\s*out|time[\s-]?out|timeout|deadline/i

const AUTH_HINT = 'agy 鉴权失败——需本机 agy 交互登录（OAuth）一次；已登录仍败则检查代理可达（Google 域必须经代理）'
const ELIGIBILITY_HINT =
  'agy 资格检查未过——账号订阅资格/验证态问题（Google AI Pro；浏览器验证后仍复现属 Google 侧 entitlement bug，见 docs/quality/agy-adapter.md）'
const REGION_HINT =
  'agy 地区限制——代理出口地区不受支持（实测样本：非美出口报 location not supported）；切换代理出口到受支持地区后重试'
const QUOTA_HINT = 'agy 额度/限速——订阅请求额度耗尽或上游限速（额度面待实测）'
const NETWORK_HINT = 'agy 网络失败——检查代理（HTTPS_PROXY/HTTP_PROXY 等；Google 域本机直连被拦）'
const TIMEOUT_HINT = 'agy 超时——上游超时或 --print-timeout 到点'
const OTHER_HINT = 'agy 失败（未分类样本）'

/**
 * 失败分类（实测样本归纳，非保证面——未知文本落 other 不猜）。
 * 匹配次序=专项优先：region/eligibility 样本先判（auth 文案 "authentication failed or timed
 * out" 须先于 timeout；"i/o timeout" 归 network——代理不通的处置提示更有用）。
 */
export function classifyAgyError(raw: string): AgyErrorClass {
  const text = raw.trim()
  const snip = sanitizeAgyText(text)
  const cls = (kind: AgyErrorKind, hint: string, code?: 'AUTH' | 'EXTERNAL_RATE_LIMIT'): AgyErrorClass => ({
    kind,
    ...(code !== undefined ? { code } : {}),
    detail: snip === '' ? hint : `${hint}（原文：${snip}）`,
  })
  if (REGION_RE.test(text)) return cls('region', REGION_HINT)
  if (ELIGIBILITY_RE.test(text)) return cls('eligibility', ELIGIBILITY_HINT)
  if (AUTH_RE.test(text)) return cls('auth', AUTH_HINT, 'AUTH')
  if (QUOTA_RE.test(text)) return cls('quota', QUOTA_HINT, 'EXTERNAL_RATE_LIMIT')
  if (NETWORK_RE.test(text)) return cls('network', NETWORK_HINT)
  if (TIMEOUT_RE.test(text)) return cls('timeout', TIMEOUT_HINT)
  return cls('other', OTHER_HINT)
}

/** 键名即凭据面（AGY_ERROR 字段名判据：值不看形状一律打码） */
const SENSITIVE_KEY_RE = /token|secret|passw|(?:api|private|session)[_-]?key|^key$|authorization|credential|cookie/i

/**
 * stderr 结构化错误行 `AGY_ERROR: {…}` 摘要（失败面 stderr 侧证据；无此行 undefined）：
 * JSON 对象只取前 8 个标量字段拼 `key=value`（嵌套只留键名；键名属凭据面或值过脱敏——
 * error ID / canonical status 是排障证据，凭据不进账），非 JSON 原文脱敏。
 */
export function agyErrorSummary(stderrText: string): string | undefined {
  let raw: string | undefined
  for (const line of stderrText.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('AGY_ERROR')) raw = trimmed.slice('AGY_ERROR'.length).replace(/^:\s*/, '')
  }
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return sanitizeAgyText(raw)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return sanitizeAgyText(raw)
  const parts: string[] = []
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>).slice(0, 8)) {
    if (value === null || value === undefined) continue
    parts.push(
      SENSITIVE_KEY_RE.test(key)
        ? `${key}=[REDACTED]`
        : typeof value === 'object'
          ? `${key}={…}`
          : `${key}=${sanitizeAgyText(String(value), 80)}`,
    )
  }
  return `AGY_ERROR ${parts.join(' ')}`
}

/**
 * agy stdout 单对象 JSON → AgyOutcome（usage 只映射契约三新键，thinking_tokens 无桶不折算）。
 * stderr 只在失败面取证（AGY_ERROR 行）；stdout 空而 stderr 有 AGY_ERROR 行＝失败面（CLI
 * 未产终稿但报了结构化错）——其余 stdout 空/坏 JSON 如实落 bad-json，不猜。
 */
export function parseAgyJson(stdoutText: string, stderrText: string = ''): AgyOutcome {
  const trimmed = stdoutText.trim()
  const stderrSummary = agyErrorSummary(stderrText)
  if (trimmed === '') {
    return stderrSummary !== undefined
      ? { kind: 'error', errorClass: classifyAgyError(stderrSummary) }
      : { kind: 'bad-json', reason: 'stdout 为空' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    return { kind: 'bad-json', reason: `stdout 非法 JSON（${sanitizeAgyText(why, 120)}）：${sanitizeAgyText(trimmed, 160)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'bad-shape', reason: `JSON 非 object（收到 ${Array.isArray(parsed) ? 'array' : typeof parsed}）` }
  }
  const obj = parsed as Record<string, unknown>
  const status = obj['status']
  const finished = obj['finished_reason']
  // finished_reason 在场即采信、先于 status 分支（真机超时终稿挂 status=ERROR，task-149）
  if ((status === 'SUCCESS' || status === 'ERROR') && finished !== undefined && finished !== null) {
    return cutShortOutcome(finished, obj, stderrSummary)
  }
  if (status === 'SUCCESS') {
    const response = obj['response']
    if (typeof response !== 'string') return { kind: 'bad-shape', reason: 'status=SUCCESS 但 response 非 string' }
    if (response.trim() === '') {
      return {
        kind: 'error',
        errorClass: { kind: 'other', detail: 'agy: status=SUCCESS 但 response 为空——不伪造成功（17-§6 收割口径）' },
        ...resultMeta(obj),
      }
    }
    return { kind: 'success', response, ...resultMeta(obj) }
  }
  if (status === 'ERROR') {
    const text = [errorTextOf(obj['error']), stderrSummary].filter((t) => t !== undefined && t !== '').join(' ')
    return { kind: 'error', errorClass: classifyAgyError(text), ...resultMeta(obj) }
  }
  return { kind: 'bad-shape', reason: `status 缺失/未知（收到 ${JSON.stringify(status)}）` }
}

/**
 * finished_reason 在场＝非正常收尾：残稿不计完成（fail-closed）；CLI 上报的会话 id/num_turns 照记。
 * 残稿面标注（文本承载）：`partial=true`；print_timeout 面恒打 `partial=<bool>`，且 usage 缺席/
 * 全 0 按「未上报」处理（头注 usage 口径例外，task-149②）。
 */
function cutShortOutcome(
  finished: unknown,
  obj: Record<string, unknown>,
  stderrSummary: string | undefined,
): AgyOutcome {
  const response = obj['response']
  const residual = typeof response === 'string' && response.trim() !== '' ? response : undefined
  const partial = residual !== undefined
  const residue = residual === undefined
    ? finished === 'print_timeout'
      ? '；无残稿'
      : ''
    : `；残稿 ${String(residual.length)} 字符不作输出（首段：${sanitizeAgyText(residual, 120)}）`
  const partialMark = partial ? '；partial=true' : finished === 'print_timeout' ? '；partial=false' : ''
  const stderrPart = stderrSummary === undefined ? '' : `；${stderrSummary}`
  const meta = resultMeta(obj)
  if (typeof finished !== 'string' || finished === '') {
    return {
      kind: 'error',
      errorClass: { kind: 'other', detail: `agy finished_reason 形状坏（收到 ${JSON.stringify(String(finished))}）——不计完成（fail-closed）` },
      ...meta,
    }
  }
  switch (finished) {
    case 'print_timeout': {
      // 超时面用量：缺席/全 0＝未上报（不落 usage 键、不伪造零账）
      const timeoutMeta = resultMeta(obj, true)
      const usageNote = timeoutMeta.usageUnreported === true ? '；usage 未上报（CLI 未上报（超时）：终稿 usage 缺席或全 0，不伪造零账）' : ''
      return {
        kind: 'error',
        errorClass: {
          kind: 'timeout',
          detail: `agy print 超时（--print-timeout 到点，response 为残稿不计完成；加大 print-timeout-sec 或拆小任务）${residue}${partialMark}${usageNote}${stderrPart}`,
        },
        ...timeoutMeta,
        ...(partial ? { partial: true as const } : {}),
      }
    }
    case 'interrupted':
      return {
        kind: 'error',
        errorClass: {
          kind: 'other',
          detail: `agy 运行被中断（finished_reason=interrupted）——残稿不计完成，按新会话重派${residue}${partialMark}${stderrPart}`,
        },
        ...meta,
        ...(partial ? { partial: true as const } : {}),
      }
    case 'error': {
      const text = [errorTextOf(obj['error']), stderrSummary].filter((t) => t !== undefined && t !== '').join(' ')
      const cls: AgyErrorClass =
        text === '' ? { kind: 'other', detail: 'agy 失败（finished_reason=error，无错误文本）' } : classifyAgyError(text)
      return {
        kind: 'error',
        errorClass: residue === '' && partialMark === '' ? cls : { ...cls, detail: `${cls.detail}${residue}${partialMark}` },
        ...meta,
        ...(partial ? { partial: true as const } : {}),
      }
    }
    default:
      return {
        kind: 'error',
        errorClass: { kind: 'other', detail: `agy finished_reason 未知（收到 ${JSON.stringify(finished)}）——不计完成（fail-closed）` },
        ...meta,
        ...(partial ? { partial: true as const } : {}),
      }
  }
}

/**
 * 终稿公共位：conversation_id / num_turns / usage（三桶；缺则不落键）。
 * zeroUsageUnreported（print_timeout 面）：usage 缺席或全 0 一律按未上报——不落 usage 键，改落 usageUnreported。
 */
function resultMeta(obj: Record<string, unknown>, zeroUsageUnreported = false): AgyResultMeta {
  const conversationId = obj['conversation_id']
  const numTurns = obj['num_turns']
  const reported = agyUsageOf(obj['usage']).usage
  const unreported = zeroUsageUnreported && (reported === undefined || isZeroTokens(reported))
  return {
    ...(typeof conversationId === 'string' && conversationId !== '' ? { conversationId } : {}),
    ...(typeof numTurns === 'number' && Number.isFinite(numTurns) ? { numTurns } : {}),
    ...(reported !== undefined && !unreported ? { usage: reported } : {}),
    ...(unreported ? { usageUnreported: true as const } : {}),
  }
}

/** 三桶全 0（cache_read 缺省视同 0） */
function isZeroTokens(u: TokenCounts): boolean {
  return u.input === 0 && u.output === 0 && (u.cache_read ?? 0) === 0
}

interface AgyResultMeta {
  readonly conversationId?: string
  readonly numTurns?: number
  readonly usage?: TokenCounts
  /** 用量未上报标注（与 usage 互斥；turn_end 不落 usage 键的依据） */
  readonly usageUnreported?: true
}

/** error 字段取文（string 直取；对象/其他 JSON 化——分类前脱敏在 classifyAgyError 内做） */
function errorTextOf(error: unknown): string {
  if (error === undefined) return ''
  return typeof error === 'string' ? error : JSON.stringify(error)
}

/** usage 四桶 → 契约三新键（cache_read 上报即落键含 0；thinking_tokens 无桶不折算，头注） */
function agyUsageOf(usage: unknown): { usage?: TokenCounts } {
  if (typeof usage !== 'object' || usage === null) return {}
  const u = usage as Record<string, unknown>
  const input = u['input_tokens']
  const output = u['output_tokens']
  const cacheRead = u['cache_read_tokens']
  if (typeof input !== 'number' || !Number.isFinite(input)) return {}
  if (typeof output !== 'number' || !Number.isFinite(output)) return {}
  return {
    usage: {
      input,
      output,
      ...(typeof cacheRead === 'number' && Number.isFinite(cacheRead) ? { cache_read: cacheRead } : {}),
    },
  }
}
