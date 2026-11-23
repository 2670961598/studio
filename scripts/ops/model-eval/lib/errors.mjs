/**
 * errors.mjs —— 失败分类（纯函数）
 *
 * 类目对齐 apps/daemon/src/engine/routing/router.ts 的 FailureClass（quota / rate_limit /
 * server / timeout / network / auth / parse / bad_request / refusal），另加 dsh 流面特有的
 * blocked / aborted / max_tokens，以及评测台自身的 harness（dsh 起不来、被文件沙箱拒写——
 * **不是模型不可用**，报告里单列）。缺省落 unknown（评测宁可标「不明」也不冒认 server）。
 * 分类次序同 router：先 code（网络类/凭据类），再 HTTP 状态，再消息关键词。
 */
import { squash } from './redact.mjs'

export const FAILURE_CLASSES = Object.freeze([
  'ok', 'quota', 'rate_limit', 'server', 'timeout', 'network', 'auth', 'parse', 'bad_request',
  'refusal', 'blocked', 'aborted', 'max_tokens', 'harness', 'unknown',
])

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE'])
const CREDENTIAL_CODES = new Set(['AUTH', 'MISSING_CREDENTIAL', 'UNAUTHORIZED', 'INVALID_API_KEY', 'AUTHENTICATION_ERROR'])
const REFUSAL_RE = /\b(refus(?:ed|al)|safety)\b|安全拒答|内容审核/i
const QUOTA_RE = /\b(quota|allowance|exhausted|usage[ _-]?limit|insufficient[_ ]quota|429|GoUsageLimit)\b/i
const QUOTA_ZH_RE = /额度|配额|耗尽/
const RATE_LIMIT_RE = /\b(rate[ _-]?limit|too many requests|\b(?:tpm|rpm|req\/min)\b)/i
const TIMEOUT_RE = /\b(timeouts?|timed out)\b|ETIMEDOUT/i
const PARSE_RE = /\b(parse|unexpected token|invalid json|json.*expected)\b/i

/** 消息里首个 HTTP 状态：行首 `429 {…}` 形态，或 `status 5xx` / `HTTP 5xx` / `code: 5xx`。 */
export function firstStatus(message) {
  const msg = String(message ?? '')
  const lead = /^\s*([45]\d{2})\b/.exec(msg)
  if (lead !== null) return Number(lead[1])
  const inner = /\b(?:status|http|code)[\s:="']*([45]\d{2})\b/i.exec(msg)
  if (inner !== null) return Number(inner[1])
  return undefined
}

/**
 * 单个错误 → 类目。入参字段均可选：{ code, status, message, name }。
 */
export function classifyFailure({ code, status, message, name } = {}) {
  const msg = String(message ?? '')
  const upper = String(code ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  if (NETWORK_CODES.has(upper)) return 'network'
  if (CREDENTIAL_CODES.has(upper)) return 'auth'
  const st = Number.isInteger(status) ? status : firstStatus(msg)
  if (st === 408) return 'timeout'
  if (st === 429) return 'quota'
  if (st === 401 || st === 403) return 'auth'
  if (st !== undefined && st >= 500) return 'server'
  if (st !== undefined && st >= 400) return REFUSAL_RE.test(msg) ? 'refusal' : 'bad_request'
  if (QUOTA_RE.test(msg) || QUOTA_ZH_RE.test(msg)) return 'quota'
  if (RATE_LIMIT_RE.test(msg)) return 'rate_limit'
  if (TIMEOUT_RE.test(msg) || name === 'TimeoutError') return 'timeout'
  if (REFUSAL_RE.test(msg)) return 'refusal'
  if (PARSE_RE.test(msg)) return 'parse'
  return 'unknown'
}

/** stderr 尾巴里的「评测台自身故障」指纹；无则 null。 */
export function detectHarness(stderrTail) {
  const s = String(stderrTail ?? '')
  let m = /\b(EPERM|EACCES)\b[^\n]{0,240}?(?:\.dsh\b|profiles\/|cordis)/i.exec(s)
  if (m !== null) return `dsh 启动写 profile 被拒（${m[1]}）——疑文件沙箱/权限，非模型原因`
  m = /\bENOENT\b[^\n]{0,240}?(?:profiles\/|\.dsh\b)/i.exec(s)
  if (m !== null) return 'dsh profile 不存在——检查 DSH_HOME / profiles/headless'
  if (/\bCannot find module\b/.test(s)) return 'dsh 依赖缺失（Cannot find module）'
  if (/unknown default profile|profile .*not found/i.test(s)) return 'dsh profile 未找到'
  if (/\bunknown option\b/i.test(s)) return 'dsh 不认识传入的旗标（版本不匹配）'
  return null
}

function fail(errorClass, detail) {
  return { ok: false, errorClass, errorDetail: squash(detail), reason: `${errorClass}: ${squash(detail)}` }
}

/**
 * 一次运行（summarizeRun 的产物）→ { ok, errorClass, errorDetail, reason }。
 * ok 的唯一判据：turn_end.reason.kind==='completed' 且 exit 0 且无顶层 error 事件。
 */
export function classifyRun(s) {
  if (s.spawnError) return fail('harness', `spawn 失败 ${s.spawnError}`)
  if (s.timedOut) return fail('timeout', `超过超时被杀（latencyMs=${s.latencyMs ?? '?'}）`)
  // 评测台自身故障（profile 被拒写 / 依赖缺失…）不冒认成模型错误：stderr 或顶层 error 里见指纹即判 harness
  const harness = detectHarness(s.stderrTail) ?? detectHarness(s.errorEvent)
  if (harness !== null) return fail('harness', harness)
  if (s.errorEvent) {
    return fail(classifyFailure({ message: s.errorEvent }), s.errorEvent)
  }
  const kind = s.turnReason?.kind
  if (kind === 'completed' && s.exitCode === 0) {
    return { ok: true, errorClass: 'ok', errorDetail: null, reason: null }
  }
  const err = s.turnReason?.error
  if (kind === 'error' || kind === 'failed') {
    return fail(classifyFailure({ code: err?.code, message: err?.message, name: err?.name }), err?.message ?? JSON.stringify(s.turnReason))
  }
  if (kind === 'blocked') return fail('blocked', err?.message ?? '被权限/审批策略拦截')
  if (kind === 'aborted') return fail('aborted', err?.message ?? 'turn 被中止')
  if (kind === 'max-tokens' || kind === 'max_tokens') return fail('max_tokens', err?.message ?? '达 max tokens')
  if (s.signal) return fail('aborted', `进程被信号 ${s.signal} 终止（turn_end=${String(kind)}）`)
  if (kind === 'completed') return fail('unknown', `turn_end=completed 但 exit=${s.exitCode}`)
  if (s.eventCount === 0) return fail('parse', `stdout 无事件（exit=${s.exitCode}）`)
  return fail('aborted', `无 turn_end 事件（events=${s.eventCount}，exit=${s.exitCode}；疑被 kill）`)
}
