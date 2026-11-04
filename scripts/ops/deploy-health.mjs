#!/usr/bin/env node
/**
 * deploy-health —— 部署成功判定（studio-dev-717）
 *
 * 背景（2026-11-04 20:21 实测 18778aa 部署）：
 *   ① 假成功窗口：`deploy.mjs deploy` 在 `launchctl kickstart -k` 后 **81ms** 就轮询到
 *      `health=ok pid=<旧 daemon pid>`——旧 daemon 尚未被 guardian 停完即被当作「部署成功」，
 *      state 里也记了旧 pid。
 *   ② writer-lease 重启竞态：新 daemon 首启因旧 daemon drain 中仍持台账写者租约 exit 1
 *      （`STALL writer-lease-held`），guardian 2s 退避重试后自愈；部署等待必须把「旧 daemon
 *      退出中/新 daemon 尚未起来」的过渡态计入等待，而不是首轮即判。
 *
 * 本模块只做一件事：**等「healthz 200 ∧ ok=true ∧ pid ≠ 部署前 pid」的新 daemon**。
 *   - previousPid = 部署前（kickstart 之前）探测到的 daemon pid；null=部署前 daemon 未运行
 *     （此时任一健康 daemon 视为替换完成——没有「旧进程」可混淆）。
 *   - 过渡态（旧 pid 仍响应 / 连接不可达 / HTTP 非 200 / pid 缺失）全部只记录观测并继续等，
 *     直到超时——统一覆盖假成功窗口与 writer-lease 重试窗口。
 *   - 纯 IO 面：fetch/sleep/now 全注入，测试零网络、零真实计时（除显式集成用例）。
 *
 * 手工演练（717 evidence）：用 node:http 假旧/新 daemon 复现「旧 pid 仍 200 → 不可达 →
 * 新 pid 200」时序，证明旧实现会假成功、新实现不会。
 *
 * 类型（JSDoc；本文件是 .mjs，不依赖 TS 语法）：
 * @typedef {{kind: 'ok'|'previous-pid'|'not-ready', http: number|null, pid: number|null, okBody: boolean, reason?: string, atMs: number}} HealthProbe
 * @typedef {{replaced: boolean, pid: number|null, previousPid: number|null, waitedMs: number, observations: HealthProbe[], reason?: string}} HealthWaitResult
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 单次探测（fetch 注入；AbortSignal 超时；JSON 坏/网络错=not-ready 不抛）。
 * @param {string} url
 * @param {number|null} previousPid
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, nowImpl?: () => number}} [options]
 * @returns {Promise<HealthProbe>}
 */
export async function probeDeployHealth(url, previousPid, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const nowImpl = options.nowImpl ?? (() => Date.now())
  const atMs = nowImpl()
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await response.json().catch(() => null)
    const pid = body !== null && typeof body.pid === 'number' && Number.isFinite(body.pid) ? body.pid : null
    const okBody = body !== null && body.ok === true
    if (response.status !== 200) {
      return { kind: 'not-ready', http: response.status, pid, okBody, reason: `http-${String(response.status)}`, atMs }
    }
    if (!okBody) return { kind: 'not-ready', http: response.status, pid, okBody, reason: 'body-not-ok', atMs }
    if (pid === null) return { kind: 'not-ready', http: response.status, pid, okBody, reason: 'body-pid-missing', atMs }
    if (previousPid !== null && pid === previousPid) {
      // 假成功窗口：旧 daemon 尚未停完仍在应答——不得判成功
      return { kind: 'previous-pid', http: response.status, pid, okBody, reason: 'still-previous-pid', atMs }
    }
    return { kind: 'ok', http: response.status, pid, okBody, atMs }
  } catch (err) {
    // 过渡态（连接拒绝/超时）=旧 daemon 已停、新 daemon 尚未起（含 writer-lease 首启失败重试窗）
    return {
      kind: 'not-ready',
      http: null,
      pid: null,
      okBody: false,
      reason: `unreachable:${err instanceof Error ? err.message : String(err)}`,
      atMs,
    }
  }
}

/**
 * 等「新 daemon」就绪：healthz 200 ∧ ok=true ∧ pid ≠ previousPid。
 * - previousPid=null（部署前 daemon 未运行）：任一健康 daemon 即视为替换完成。
 * - 超时返回 replaced=false + 观测序列（含最后 pid/reason），调用方据此报错并给回滚提示。
 * @param {{url: string, previousPid: number|null, timeoutMs: number, intervalMs?: number, probeTimeoutMs?: number, fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void>, nowImpl?: () => number}} options
 * @returns {Promise<HealthWaitResult>}
 */
export async function waitForReplacedDaemon(options) {
  const intervalMs = options.intervalMs ?? 1_000
  const sleepImpl = options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const nowImpl = options.nowImpl ?? (() => Date.now())
  const startedAt = nowImpl()
  /** @type {HealthProbe[]} */
  const observations = []
  let last = null
  while (nowImpl() - startedAt <= options.timeoutMs) {
    const probe = await probeDeployHealth(options.url, options.previousPid, {
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.probeTimeoutMs !== undefined ? { timeoutMs: options.probeTimeoutMs } : {}),
      nowImpl,
    })
    last = probe
    observations.push(probe)
    if (probe.kind === 'ok') {
      return { replaced: true, pid: probe.pid, previousPid: options.previousPid, waitedMs: nowImpl() - startedAt, observations }
    }
    await sleepImpl(intervalMs)
  }
  return {
    replaced: false,
    pid: last !== null ? last.pid : null,
    previousPid: options.previousPid,
    waitedMs: nowImpl() - startedAt,
    observations,
    reason: last !== null ? (last.reason ?? last.kind) : 'no-probe',
  }
}

/**
 * 观测序列压缩成一行（错误信息/日志用；不全量刷屏）。
 * @param {HealthWaitResult} result
 * @returns {string}
 */
export function summarizeHealthWait(result) {
  /** @type {string[]} */
  const transitions = []
  for (const probe of result.observations) {
    if (transitions.length === 0 || transitions[transitions.length - 1] !== probe.kind) transitions.push(probe.kind)
  }
  const lastPid = result.pid !== null ? `last-pid=${String(result.pid)}` : 'last-pid=none'
  return `previous-pid=${result.previousPid === null ? 'none' : String(result.previousPid)}；${lastPid}；probes=${String(result.observations.length)}；transitions=${transitions.join('→')}；waited=${String(result.waitedMs)}ms；reason=${result.reason ?? 'ok'}`
}

// ————————————————————————— CLI（717 演练/测试用；与 deploy.mjs 共用同一实现） —————————————————————————
async function main(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        '用法：node scripts/ops/deploy-health.mjs --url <healthz> --previous-pid <pid|none> [--timeout-ms 180000] [--interval-ms 1000] [--once] [--json]\n' +
          '  部署成功判定（717）：等 healthz 200∧ok=true∧pid≠部署前 pid。exit 0=新 daemon 就绪；2=超时/未就绪；1=用法错误\n',
      )
      return 0
    }
    if (token === '--json' || token === '--once' || token === '--wait') {
      opts[token.slice(2)] = true
      continue
    }
    const key = token.replace(/^--/, '')
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    opts[key] = value
    i += 1
  }
  if (typeof opts.url !== 'string' || opts.url === '') throw new Error('缺少 --url')
  const rawPid = typeof opts['previous-pid'] === 'string' ? opts['previous-pid'] : 'none'
  const previousPid = rawPid === 'none' ? null : Number(rawPid)
  if (previousPid !== null && (!Number.isInteger(previousPid) || previousPid < 0)) throw new Error('--previous-pid 必须是整数或 none')
  const timeoutMs = opts['timeout-ms'] !== undefined ? Number(opts['timeout-ms']) : 180_000
  const intervalMs = opts['interval-ms'] !== undefined ? Number(opts['interval-ms']) : 1_000
  const emit = (payload) => {
    if (opts.json === true) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    else process.stdout.write(`${payload.summary ?? JSON.stringify(payload)}\n`)
  }
  if (opts.once === true) {
    const probe = await probeDeployHealth(opts.url, previousPid)
    const payload = { mode: 'once', kind: probe.kind, pid: probe.pid, previousPid, http: probe.http, reason: probe.reason ?? null, summary: `probe kind=${probe.kind} pid=${probe.pid ?? 'none'} reason=${probe.reason ?? 'ok'}` }
    emit(payload)
    return probe.kind === 'ok' ? 0 : 2
  }
  const result = await waitForReplacedDaemon({ url: opts.url, previousPid, timeoutMs, intervalMs })
  const payload = { mode: 'wait', ...result, summary: summarizeHealthWait(result) }
  emit(payload)
  return result.replaced ? 0 : 2
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  try {
    const code = await main(process.argv.slice(2))
    process.exit(code)
  } catch (err) {
    process.stderr.write(`[deploy-health] 失败：${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
