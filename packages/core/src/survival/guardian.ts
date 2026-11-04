/**
 * core/survival/guardian —— 守护核纯逻辑（studio-dev-697；docs/90-§一/§三）
 *
 * 为什么放 core：guardian 本体（scripts/guardian.mjs）必须极小、零业务依赖；但其退避/刹车/
 * 健康判据等**纯函数**需要单元测试与单一来源——放 core 纯件（零 import/零 IO/零第三方），
 * guardian 脚本仅做 IO/进程编排并引用本件；测试经 `@studio-next/core` 导入。
 *
 * 边界：本件不读时钟/不读文件/不发网络（时间/fetch 全部入参注入）；不定义 IO 配置校验
 * （落在 guardian.mjs，fail-fast 由脚本负责）。
 */

/** 缺省退避/刹车策略（guardian.mjs 亦引用同一份，避免双源漂移） */
export const GUARDIAN_DEFAULTS = Object.freeze({
  health: { intervalMs: 15_000, timeoutMs: 5_000, failuresBeforeRestart: 3, startupGraceMs: 60_000 },
  restart: { initialBackoffMs: 2_000, maxBackoffMs: 60_000, multiplier: 2, stopGraceMs: 15_000 },
  crashLoop: { windowMs: 10 * 60_000, maxRestarts: 5, brakeMs: 15 * 60_000 },
})

export interface GuardianBackoffConfig {
  readonly initialBackoffMs?: number
  readonly maxBackoffMs?: number
  readonly multiplier?: number
}

export interface GuardianCrashLoopConfig {
  readonly windowMs?: number
  readonly maxRestarts?: number
  readonly brakeMs?: number
}

/** 指数退避（attempt 从 1 起；封顶 maxBackoffMs；非负整数 ms） */
export function nextBackoff(attempt: number, restart: GuardianBackoffConfig = GUARDIAN_DEFAULTS.restart): number {
  const n = Math.max(1, Math.trunc(attempt))
  const initial = Math.max(0, Number(restart.initialBackoffMs ?? GUARDIAN_DEFAULTS.restart.initialBackoffMs) || 0)
  const multiplier = Math.max(1, Number(restart.multiplier ?? GUARDIAN_DEFAULTS.restart.multiplier) || 1)
  const initialEffective = Math.max(0, Math.trunc(initial))
  const maxMs = Math.max(initialEffective, Number(restart.maxBackoffMs ?? GUARDIAN_DEFAULTS.restart.maxBackoffMs) || 0)
  return Math.min(maxMs, Math.round(initialEffective * multiplier ** (n - 1)))
}

/** crash-loop 判定：windowMs 内重启次数 ≥ maxRestarts → 刹车（true） */
export function shouldBrake(
  restartTimes: readonly number[],
  now: number,
  crashLoop: GuardianCrashLoopConfig = GUARDIAN_DEFAULTS.crashLoop,
): boolean {
  const windowMs = Math.max(1, Number(crashLoop.windowMs ?? GUARDIAN_DEFAULTS.crashLoop.windowMs) || 1)
  const maxRestarts = Math.max(1, Number(crashLoop.maxRestarts ?? GUARDIAN_DEFAULTS.crashLoop.maxRestarts) || 1)
  const recent = restartTimes.filter((at) => now - at <= windowMs)
  return recent.length >= maxRestarts
}

/** 健康响应判据：HTTP 200 ∧ JSON ok=true ∧（若带 tick.advancing 则须 true） */
export function classifyHealth(status: number, payload: unknown): { healthy: boolean; reason?: string } {
  if (status !== 200) return { healthy: false, reason: `http-${String(status)}` }
  if (typeof payload !== 'object' || payload === null) return { healthy: false, reason: 'body-not-object' }
  const body = payload as { ok?: unknown; tick?: { advancing?: unknown } | null }
  if (body.ok !== true) return { healthy: false, reason: 'body-not-ok' }
  if (typeof body.tick === 'object' && body.tick !== null && body.tick.advancing !== true) {
    return { healthy: false, reason: 'tick-not-advancing' }
  }
  return { healthy: true }
}

/** 探测结果（恒不抛；原因结构化） */
export interface GuardianProbeResult {
  readonly healthy: boolean
  readonly reason?: string
  readonly status: number | null
  readonly latencyMs: number
}

/** 探活响应窄面（fetch 注入可替换，测试不触网） */
export type GuardianProbeFetch = (
  url: string,
  init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<{ readonly status: number; json(): Promise<unknown> }>

/** 单次健康探测（AbortSignal 超时；失败原因结构化，不抛） */
export async function probeHealth(
  url: string,
  options: { readonly timeoutMs?: number } = {},
  fetchImpl: GuardianProbeFetch = globalThis.fetch as unknown as GuardianProbeFetch,
): Promise<GuardianProbeResult> {
  const startedAt = Date.now()
  const timeoutMs = Math.max(1, Number(options.timeoutMs ?? GUARDIAN_DEFAULTS.health.timeoutMs) || 5_000)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { healthy: false, reason: 'body-not-json', status: response.status, latencyMs: Date.now() - startedAt }
    }
    const checked = classifyHealth(response.status, payload)
    return { ...checked, status: response.status, latencyMs: Date.now() - startedAt }
  } catch (err) {
    return {
      healthy: false,
      reason: `probe-error:${err instanceof Error ? err.message : String(err)}`,
      status: null,
      latencyMs: Date.now() - startedAt,
    }
  }
}

/**
 * 事件级别分级（studio-dev-734）。
 *
 * 改前缺陷：`level = event==='healthy' ? 'info' : 'error'` → **所有正常事件都是 error**
 * （`guardian-start`/`daemon-start`/`preflight-ok` 等 142/142 行 error），告警级别失去区分度。
 * 现按语义分三级：
 *   - info  ：正常生命周期/部署面正常（guardian-start/stop、daemon-start、preflight-ok、healthy、health-recovered）
 *   - warn  ：可自愈/需关注（health-fail 瞬态、preflight-failed fail-closed 拒启、daemon-stop、restart-scheduled、pid-file-error）
 *   - error ：需人工介入（spawn-error、daemon-kill、crash-loop-brake、health-fail-restart 达重启阈值）
 * 未知事件保守定为 warn（「正常事件不得 error」；新事件需显式登记级别）。
 */
export type GuardianLevel = 'info' | 'warn' | 'error'

const GUARDIAN_INFO_EVENTS: ReadonlySet<string> = new Set([
  'guardian-start',
  'guardian-stop',
  'daemon-start',
  'preflight-ok',
  'healthy',
  'health-recovered',
])
const GUARDIAN_WARN_EVENTS: ReadonlySet<string> = new Set([
  'health-fail',
  'preflight-failed',
  'daemon-stop',
  'restart-scheduled',
  'pid-file-error',
])
const GUARDIAN_ERROR_EVENTS: ReadonlySet<string> = new Set([
  'spawn-error',
  'daemon-kill',
  'crash-loop-brake',
  'health-fail-restart',
])

/** 事件 → 级别（纯函数；测试单点） */
export function guardianEventLevel(event: string): GuardianLevel {
  if (GUARDIAN_INFO_EVENTS.has(event)) return 'info'
  if (GUARDIAN_ERROR_EVENTS.has(event)) return 'error'
  if (GUARDIAN_WARN_EVENTS.has(event)) return 'warn'
  return 'warn'
}

/**
 * 探活失败原因分类（纯函数；734 观测面）：timeout/network/http/body 分开，
 * 让「probe timeout」在日志里可判（不误报 error；去重后仍保留首次瞬态可见）。
 */
export function probeFailureKind(reason: string | undefined): 'timeout' | 'network' | 'http' | 'body' | 'unknown' {
  const text = reason ?? ''
  if (/timeout|aborted|ETIMEDOUT/i.test(text)) return 'timeout'
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|network/i.test(text)) return 'network'
  if (/^http-|status|503|500/i.test(text)) return 'http'
  if (/body|json/i.test(text)) return 'body'
  return 'unknown'
}

/** 结构化告警/事件行（级别由事件语义决定，见 guardianEventLevel） */
export function buildGuardianAlert(
  event: string,
  detail: Record<string, unknown>,
  now: Date = new Date(),
): { ts: string; level: GuardianLevel; event: string } & Record<string, unknown> {
  return { ts: now.toISOString(), level: guardianEventLevel(event), event, ...detail }
}

/** 解析 --config（纯函数；--config=path 与 --config path 同义；-h/--help） */
export function parseGuardianArgs(argv: readonly string[]): { help: boolean; config: string } {
  const args = argv.slice(2)
  let config = ''
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--config') {
      config = args[i + 1] ?? ''
      i += 1
    } else if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length)
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, config: '' }
    }
  }
  return { help: false, config }
}
