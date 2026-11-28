/**
 * 供给错误分类矩阵测试 —— docs/quality/supply-quota-gating.md §1/§5（task-157 / FIX-03）。
 *
 * 覆盖：401/403 凭据类、429×三窗口（GLM 1310/1308、Kimi weekly/5-hour、相对/绝对 reset、
 * UTC+8 缺省帧）、1302/rate limit 限速、502/529/overloaded 供给类、缺凭据/缺 adapter/地区
 * 限制 config、timeout、网络码、400/拒答、无证据缺省；收割面 worker_dead/quality/timeout/
 * CONFIG_INVALID；审计段形状。纯函数、固定时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESET_TZ_OFFSET_MS,
  classifyHarvestFailure,
  classifySupplyError,
  errorKindNote,
  parseQuotaResetAt,
  quotaWindowOf,
  retryabilityOf,
} from '../../../src/supply/error-kind.ts'

/** 2026-11-26 14:00 北京时间 */
const NOW = Date.parse('2026-11-26T06:00:00.000Z')
const at = (iso: string): number => Date.parse(iso)

/** GLM 周期窗原文（哨查日志：限额时刻与 API 重置同帧=北京时间） */
const GLM_1310 = '429 code=1310 "您已达到每周/每月使用上限，您的限额将在 2026-11-27 14:24:57 重置"'
const GLM_1308 = '429 code=1308 "您已达到 5 小时使用上限，您的限额将在 2026-11-26 19:30:00 重置"'

describe('classifySupplyError：凭据/限速/供给类', () => {
  it('401/403 → auth / fatal_config / 不可重试', () => {
    for (const status of [401, 403]) {
      const cls = classifySupplyError({ status, message: 'Incorrect API key provided' }, NOW)
      expect(cls).toMatchObject({ kind: 'auth', retryability: 'fatal_config', retryable: false })
    }
    expect(classifySupplyError(new Error('401 Unauthorized: 凭据无效或已过期'), NOW)).toMatchObject({ kind: 'auth', retryable: false })
  })
  it('GLM 1302 账户速率限制 → rate_limit（可重试、不入池、无窗口）', () => {
    const cls = classifySupplyError({ status: 429, message: '429 code=1302 "账户速率限制，请稍后重试"' }, NOW)
    expect(cls).toMatchObject({ kind: 'rate_limit', retryability: 'retryable', retryable: true })
    expect(cls.quotaWindow).toBeUndefined()
    expect(cls.resetAt).toBeUndefined()
  })
  it('rate limit 文案 → rate_limit；相对 reset 仍解析（供源冷却用）', () => {
    const cls = classifySupplyError({ status: 429, message: 'Rate limit exceeded, try again in 20s' }, NOW)
    expect(cls).toMatchObject({ kind: 'rate_limit', retryable: true, resetAt: NOW + 20_000 })
  })
  it('429 overloaded / 502 / 503 / 504 / 529 → overload（retryable）；其余 5xx → server', () => {
    expect(classifySupplyError({ status: 429, message: '429 [overloaded] the server is overloaded' }, NOW)).toMatchObject({ kind: 'overload', retryable: true })
    for (const status of [502, 503, 504, 529]) {
      const cls = classifySupplyError({ status }, NOW)
      expect(cls).toMatchObject({ kind: 'overload', retryability: 'retryable', retryable: true })
      expect(cls.quotaWindow).toBeUndefined()
    }
    expect(classifySupplyError({ status: 500, message: 'Internal Server Error' }, NOW)).toMatchObject({ kind: 'server', retryable: true })
    expect(classifySupplyError(new Error('502 Bad Gateway'), NOW)).toMatchObject({ kind: 'overload' })
  })
})

describe('classifySupplyError：429 配额窗口', () => {
  it('GLM 1310「每周/每月」→ week，resetAt 按北京时间帧（UTC+8 缺省）', () => {
    const cls = classifySupplyError({ status: 429, message: GLM_1310 }, NOW)
    expect(cls).toMatchObject({
      kind: 'quota',
      retryability: 'wait_reset',
      retryable: false,
      quotaWindow: 'week',
      resetAt: at('2026-11-27T06:24:57.000Z'),
      providerCode: '1310',
    })
  })
  it('GLM 1308「5 小时」→ five_hour', () => {
    const cls = classifySupplyError({ status: 429, message: GLM_1308 }, NOW)
    expect(cls).toMatchObject({ kind: 'quota', quotaWindow: 'five_hour', resetAt: at('2026-11-26T11:30:00.000Z'), providerCode: '1308' })
  })
  it('时区可注入：tzOffsetMs=0 同文案按 UTC 解析', () => {
    const cls = classifySupplyError({ status: 429, message: GLM_1310 }, NOW, { tzOffsetMs: 0 })
    expect(cls.resetAt).toBe(at('2026-11-27T14:24:57.000Z'))
    expect(DEFAULT_RESET_TZ_OFFSET_MS).toBe(8 * 60 * 60_000)
  })
  it('Kimi weekly / 5-hour；exceeded_current_quota 无窗口=unknown', () => {
    expect(classifySupplyError({ status: 429, message: "You've reached your weekly (7-day) usage limit" }, NOW)).toMatchObject({ kind: 'quota', quotaWindow: 'week' })
    const five = classifySupplyError({ status: 429, message: "You've reached your 5-hour usage limit" }, NOW)
    expect(five).toMatchObject({ kind: 'quota', quotaWindow: 'five_hour' })
    expect(five.resetAt).toBeUndefined()
    expect(classifySupplyError({ status: 429, message: 'exceeded_current_quota_error' }, NOW)).toMatchObject({ kind: 'quota', quotaWindow: 'unknown' })
  })
  it('相对 reset：resets in 17m / try again in 2 hours / 3d', () => {
    expect(classifySupplyError({ status: 429, message: 'OpenCode Go usage limit reached (5-hour, resets in 17m)' }, NOW)).toMatchObject({
      kind: 'quota',
      quotaWindow: 'five_hour',
      resetAt: NOW + 17 * 60_000,
    })
    expect(classifySupplyError({ status: 429, message: 'quota exceeded, try again in 2 hours' }, NOW).resetAt).toBe(NOW + 2 * 3_600_000)
    expect(classifySupplyError({ status: 429, message: 'resets in 3d' }, NOW).resetAt).toBe(NOW + 3 * 86_400_000)
  })
  it('Retry-After：retryAfterMs / retryAfter 秒 / 文案 retry-after', () => {
    expect(classifySupplyError({ status: 429, message: 'rate limit', retryAfterMs: 30_000 }, NOW).resetAt).toBe(NOW + 30_000)
    expect(classifySupplyError({ status: 429, message: 'x', retryAfter: 45 }, NOW).resetAt).toBe(NOW + 45_000)
    expect(classifySupplyError({ status: 429, message: 'Too Many Requests\nretry-after: 60' }, NOW).resetAt).toBe(NOW + 60_000)
  })
  it('reset 时刻 ≤ now（文案陈旧/时钟漂移）视为无 resetAt', () => {
    const stale = '429 code=1310 "限额将在 2026-11-25 14:24:57 重置"'
    expect(classifySupplyError({ status: 429, message: stale }, NOW).resetAt).toBeUndefined()
    expect(classifySupplyError({ status: 429, message: stale }, NOW).quotaWindow).toBe('week')
  })
  it('裸 {status:429} / 无 status 仅额度文案 → quota unknown（保旧口径）', () => {
    expect(classifySupplyError({ status: 429 }, NOW)).toMatchObject({ kind: 'quota', quotaWindow: 'unknown', retryability: 'wait_reset' })
    expect(classifySupplyError({ message: 'upstream 429 quota exhausted' }, NOW)).toMatchObject({ kind: 'quota', quotaWindow: 'unknown' })
    expect(classifySupplyError({ message: '额度不足' }, NOW).kind).toBe('quota')
    expect(classifySupplyError({ message: 'exceeded_current_quota' }, NOW).kind).toBe('quota')
  })
  it('窗口证据压过 rate limit 字样', () => {
    expect(classifySupplyError({ status: 429, message: 'Rate limit reached: 5-hour limit, resets in 17m' }, NOW)).toMatchObject({ kind: 'quota', quotaWindow: 'five_hour' })
  })
})

describe('classifySupplyError：config / timeout / network / 4xx / 缺省', () => {
  it('缺凭据 / 缺 adapter / 地区限制 → config / fatal_config', () => {
    const cases: unknown[] = [
      new Error('KIMI_API_KEY, which is not set'),
      new Error('no-credential: provider kimi-coding'),
      new Error('credentials unavailable for provider kimi-coding'),
      new Error('API key missing for provider kimi-coding'),
      new Error('Missing API key: KIMI_API_KEY'), // missing 在前
      new Error('auth token not provided'),
      new Error('Error: no token provided'), // 裸 token：无 HTTP 状态的 CLI 级文案=缺凭据
      new Error('no token supplied'),
      new Error('no adapter registered for provider studio-dev-1526'),
      new Error('Unsupported country, region, or territory'),
      { status: 403, message: 'Request not allowed from your region' },
    ]
    for (const err of cases) {
      const cls = classifySupplyError(err, NOW)
      expect(cls, JSON.stringify(String(err instanceof Error ? err.message : err))).toMatchObject({ kind: 'config', retryability: 'fatal_config', retryable: false })
    }
  })
  it('timeout：408 / 文案 / TimeoutError / exit=124 / 超时', () => {
    for (const err of [{ status: 408 }, { message: 'Request timed out after 60000ms' }, Object.assign(new Error('x'), { name: 'TimeoutError' }), { message: '闸门 exit=124(timeout)' }, { message: '调用超时' }]) {
      expect(classifySupplyError(err, NOW), JSON.stringify(err)).toMatchObject({ kind: 'timeout', retryable: true })
    }
  })
  it('网络码优先（ECONNREFUSED 不得命中 refusal）；closed handle → network', () => {
    expect(classifySupplyError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443' }, NOW)).toMatchObject({ kind: 'network', retryable: true })
    expect(classifySupplyError({ code: 'ENOTFOUND' }, NOW).kind).toBe('network')
    expect(classifySupplyError({ code: 'EAI_AGAIN' }, NOW).kind).toBe('network')
    expect(classifySupplyError(new Error('read ECONNRESET'), NOW).kind).toBe('network')
    expect(classifySupplyError(new Error('closed handle'), NOW)).toMatchObject({ kind: 'network' })
  })
  it('真 400 / 拒答 → bad_request / refusal（terminal）', () => {
    expect(classifySupplyError({ status: 400, message: 'bad request' }, NOW)).toMatchObject({ kind: 'bad_request', retryability: 'terminal', retryable: false })
    // 带 4xx 校验态的「token missing / no token provided」是请求体校验，不是缺凭据（不得误判 config 触发换源/冷却）
    expect(classifySupplyError({ status: 400, message: 'messages: input token missing' }, NOW)).toMatchObject({ kind: 'bad_request', retryable: false })
    expect(classifySupplyError({ status: 422, message: 'no token provided in request body' }, NOW)).toMatchObject({ kind: 'bad_request', retryable: false })
    // 401/403 不属请求体校验态：缺 token=缺凭据（config，判定序在 401/403 之前——§1.1 表序）
    expect(classifySupplyError({ status: 401, message: 'no token provided' }, NOW)).toMatchObject({ kind: 'config', retryable: false })
    expect(classifySupplyFailureSafe({ status: 400, message: 'safety refusal by upstream' })).toBe('refusal')
    expect(classifySupplyFailureSafe({ status: 400, message: '内容审核拦截' })).toBe('refusal')
  })
  it('parse：JSON/parse 文案（无 status）', () => {
    expect(classifySupplyError({ message: 'Unexpected end of JSON input: parse error' }, NOW).kind).toBe('parse')
  })
  it('无证据 → default 证据、kind server（路由面保旧缺省）', () => {
    for (const err of [{ status: 0, message: 'harvest-not-four' }, {}, 'some weird failure', null, undefined]) {
      const cls = classifySupplyError(err, NOW)
      expect(cls, JSON.stringify(err ?? null)).toMatchObject({ kind: 'server', evidence: 'default', retryable: true })
      expect(cls.quotaWindow).toBeUndefined()
    }
  })
  it('retryabilityOf 表', () => {
    expect(retryabilityOf('quota')).toBe('wait_reset')
    expect(retryabilityOf('auth')).toBe('fatal_config')
    expect(retryabilityOf('config')).toBe('fatal_config')
    expect(retryabilityOf('quality')).toBe('quality')
    expect(retryabilityOf('bad_request')).toBe('terminal')
    expect(retryabilityOf('worker_dead')).toBe('retryable')
  })
})

function classifySupplyFailureSafe(err: unknown): string {
  return classifySupplyError(err, NOW).kind
}

describe('parseQuotaResetAt / quotaWindowOf', () => {
  it('绝对时间须有「重置/reset」语境，取最后一个日期时间', () => {
    const msg = '上报于 2026-11-26 13:00:00；限额将在 2026-11-27 14:24:57 重置'
    expect(parseQuotaResetAt(msg, NOW)).toBe(at('2026-11-27T06:24:57.000Z'))
    expect(parseQuotaResetAt('请求时间 2026-11-27 14:24:57 已记录', NOW)).toBeUndefined()
  })
  it('相对时长单位 d/h/m/s；非法单位忽略', () => {
    expect(parseQuotaResetAt('try again in 90s', NOW)).toBe(NOW + 90_000)
    expect(parseQuotaResetAt('try again in 1d 2h', NOW)).toBe(NOW + 86_400_000)
    expect(parseQuotaResetAt('try again in a while', NOW)).toBeUndefined()
  })
  it('quotaWindowOf：每周/每月同现取 week；无证据 undefined', () => {
    expect(quotaWindowOf('您已达到每周/每月使用上限')).toBe('week')
    expect(quotaWindowOf('OpenCode Go usage limit reached (5-hour, resets in 17m)')).toBe('five_hour')
    expect(quotaWindowOf('monthly cap reached')).toBe('month')
    expect(quotaWindowOf('rate limit exceeded')).toBeUndefined()
  })
})

describe('classifyHarvestFailure（GATE_FAIL 归因；四要件语义不动）', () => {
  const gate = (detail: string, terminalError?: string) => classifyHarvestFailure({ detail, terminalError, now: NOW })
  it('WORKER_DEAD → worker_dead / retryable；CONFIG_INVALID → config', () => {
    expect(gate('WORKER_DEAD：进程已退出（exit=137）')).toMatchObject({ kind: 'worker_dead', retryable: true })
    expect(gate('CONFIG_INVALID：等级未登记状态流（收割去向不可定）')).toMatchObject({ kind: 'config', retryable: false })
  })
  it('终局错误带供给证据 → 对应 kind（含 reset）', () => {
    expect(gate('GATE_FAIL：四要件缺【1.终态事件】；turn_end.error=…', GLM_1310)).toMatchObject({ kind: 'quota', quotaWindow: 'week', resetAt: at('2026-11-27T06:24:57.000Z') })
    expect(gate('GATE_FAIL：四要件缺【1.终态事件】', 'upstream 502 Bad Gateway')).toMatchObject({ kind: 'overload', retryable: true })
  })
  it('终局错误无供给证据 → quality；闸门超时 → timeout', () => {
    expect(gate('GATE_FAIL：四要件缺【4.闸门】', 'tests failed: 3 red')).toMatchObject({ kind: 'quality', retryability: 'quality', retryable: false })
    expect(gate('GATE_FAIL：四要件缺【4.闸门】；gate=真验收闸门：[1] exit=124(timeout)')).toMatchObject({ kind: 'timeout', retryable: true })
    expect(gate('GATE_FAIL：四要件缺【3.REPORT】')).toMatchObject({ kind: 'quality' })
  })
})

describe('errorKindNote（审计段只在末尾追加）', () => {
  it('形状：errorKind/retryable[/quotaWindow/resetAt][/providerCode]/provider/account', () => {
    const cls = classifySupplyError({ status: 429, message: GLM_1310 }, NOW)
    expect(errorKindNote(cls, { provider: 'GLM' })).toBe(
      `;errorKind=quota;retryable=false;quotaWindow=week;resetAt=2026-11-27T06:24:57.000Z;providerCode=1310;provider=GLM;account=-`,
    )
    expect(errorKindNote(classifySupplyError({ status: 500 }, NOW), { provider: 'glm', account: 'ops' })).toBe(';errorKind=server;retryable=true;provider=glm;account=ops')
    expect(errorKindNote(classifySupplyError({ status: 400 }, NOW))).toBe(';errorKind=bad_request;retryable=false')
  })
})
