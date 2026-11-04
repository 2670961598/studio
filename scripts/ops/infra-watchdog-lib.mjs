#!/usr/bin/env node
/**
 * infra-watchdog-lib —— 基础设施守护纯面（studio-dev-774）
 *
 * 拆件理由：774 主脚本含 CLI/launchd 编排，受 600 行阈约束；探测/状态机/退避/限流全部
 * 纯函数或注入式 IO 放本件，测试经 `node --test scripts/ops/infra-watchdog.test.mjs` 覆盖。
 *
 * 铁律：只依赖 node 标准库；不 import daemon/公司目录/契约；只探测与「按配置执行命令」，
 * 不修改业务逻辑/端口/契约。默认只读探测；恢复动作由调用方按配置启用（默认开、可关）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'
import process from 'node:process'

/** 缺省配置（主机无关；路径全部由安装侧替换）。恢复命令缺省按 macOS/Docker Desktop 场景。 */
export const DEFAULT_WATCHDOG_CONFIG = Object.freeze({
  schema: 'studio-next/infra-watchdog-config/v1',
  probeIntervalMs: 15_000,
  failureThreshold: 2,
  alertRepeatMs: 300_000,
  recovery: { enabled: true, cooldownMs: 600_000, maxPerHour: 3 },
  probes: {
    docker: { socket: '/var/run/docker.sock', timeoutMs: 3_000 },
    matrix: { url: 'http://127.0.0.1:8008/_matrix/client/versions', timeoutMs: 3_000 },
    taiga: { url: 'http://127.0.0.1:9000/api/v1/', timeoutMs: 3_000 },
    studioDev: { url: 'http://127.0.0.1:8788/healthz', timeoutMs: 3_000, guardianLabel: 'io.studionext.daemon' },
    studioProfit: { processPattern: null, guardianLabel: null },
  },
  containers: [],
})

const TARGET_ORDER = ['docker', 'matrix', 'taiga', 'studioDev', 'studioProfit']

/** 配置归一化（缺省补全 + 基本形状校验；非法抛错，fail-fast 不猜） */
export function normalizeConfig(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('infra-watchdog 配置必须是 JSON 对象')
  const cfg = raw
  if (cfg.schema !== undefined && cfg.schema !== 'studio-next/infra-watchdog-config/v1') {
    throw new Error(`infra-watchdog 配置 schema 不符：${String(cfg.schema)}`)
  }
  const probes = { ...DEFAULT_WATCHDOG_CONFIG.probes, ...(cfg.probes ?? {}) }
  for (const [name, probe] of Object.entries(probes)) {
    if (typeof probe !== 'object' || probe === null) throw new Error(`probes.${name} 必须是对象`)
    for (const key of ['url', 'socket', 'processPattern', 'guardianLabel']) {
      const value = probe[key]
      if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(`probes.${name}.${key} 必须是字符串或 null`)
    }
  }
  const positive = (value, name, fallback) => {
    if (value === undefined) return fallback
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) throw new Error(`${name} 必须是正整数`)
    return Math.trunc(num)
  }
  const recovery = { ...DEFAULT_WATCHDOG_CONFIG.recovery, ...(cfg.recovery ?? {}) }
  const normalized = {
    schema: DEFAULT_WATCHDOG_CONFIG.schema,
    probeIntervalMs: positive(cfg.probeIntervalMs, 'probeIntervalMs', DEFAULT_WATCHDOG_CONFIG.probeIntervalMs),
    failureThreshold: positive(cfg.failureThreshold, 'failureThreshold', DEFAULT_WATCHDOG_CONFIG.failureThreshold),
    alertRepeatMs: positive(cfg.alertRepeatMs, 'alertRepeatMs', DEFAULT_WATCHDOG_CONFIG.alertRepeatMs),
    recovery: {
      enabled: recovery.enabled !== false,
      cooldownMs: positive(recovery.cooldownMs, 'recovery.cooldownMs', DEFAULT_WATCHDOG_CONFIG.recovery.cooldownMs),
      maxPerHour: positive(recovery.maxPerHour, 'recovery.maxPerHour', DEFAULT_WATCHDOG_CONFIG.recovery.maxPerHour),
    },
    probes,
    containers: Array.isArray(cfg.containers) ? cfg.containers.map(String) : [],
    logDir: typeof cfg.logDir === 'string' && cfg.logDir !== '' ? cfg.logDir : null,
    alertsFile: typeof cfg.alertsFile === 'string' && cfg.alertsFile !== '' ? cfg.alertsFile : null,
    stateFile: typeof cfg.stateFile === 'string' && cfg.stateFile !== '' ? cfg.stateFile : null,
    recoveryCommands: normalizeRecoveryCommands(cfg.recoveryCommands),
    alertOnly: cfg.alertOnly === true,
  }
  return normalized
}

/**
 * 恢复命令表归一化（774/B1：数组或 docker 对象两形状；由调用方 spawn 直接执行）
 *
 * - 常规键：非空字符串数组；
 * - `docker`：允许 `{dockerKill?: string[], dockerStart?: string[]}` 对象（shipped example 形状，
 *   与 recoveryPlan 期望一致；两键均可缺省——缺省回落内置 `pkill Docker.app`/`open -a Docker`）。
 * 未知键/未知 docker 子键/空对象一律 fail-fast，避免「example 能写、跑起来配置非法」。
 */
export function normalizeRecoveryCommands(raw) {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null) throw new Error('recoveryCommands 必须是对象')
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      if (value.length === 0 || !value.every((item) => typeof item === 'string' && item !== '')) {
        throw new Error(`recoveryCommands.${key} 必须是非空字符串数组`)
      }
      out[key] = [...value]
      continue
    }
    if (key === 'docker' && typeof value === 'object' && value !== null) {
      const docker = {}
      const unknown = Object.keys(value).filter((sub) => sub !== 'dockerKill' && sub !== 'dockerStart')
      if (unknown.length > 0) throw new Error(`recoveryCommands.docker 含未知子键：${unknown.join('/')}（只允许 dockerKill/dockerStart）`)
      for (const sub of ['dockerKill', 'dockerStart']) {
        const commands = value[sub]
        if (commands === undefined) continue
        if (!Array.isArray(commands) || commands.length === 0 || !commands.every((item) => typeof item === 'string' && item !== '')) {
          throw new Error(`recoveryCommands.docker.${sub} 必须是非空字符串数组`)
        }
        docker[sub] = [...commands]
      }
      if (Object.keys(docker).length === 0) throw new Error('recoveryCommands.docker 至少需 dockerKill 或 dockerStart（或整块省略走内置默认）')
      out[key] = docker
      continue
    }
    throw new Error(`recoveryCommands.${key} 必须是非空字符串数组（docker 可为 {dockerKill,dockerStart} 对象）`)
  }
  return out
}

/** HTTP 探活（fetch 注入；AbortSignal 超时；恒不抛） */
export async function probeHttp(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 3_000
  const nowImpl = options.nowImpl ?? (() => Date.now())
  const startedAt = nowImpl()
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    const body = options.expectJson !== false ? await response.json().catch(() => null) : null
    const okStatus = options.expectStatus === undefined ? response.status === 200 : options.expectStatus.includes(response.status)
    const okBody = options.expectOkBody === true ? body !== null && typeof body === 'object' && body.ok === true : true
    const ok = okStatus && okBody
    return {
      ok,
      status: response.status,
      reason: ok ? 'ok' : okStatus ? 'body-not-ok' : `http-${String(response.status)}`,
      latencyMs: nowImpl() - startedAt,
    }
  } catch (err) {
    return { ok: false, status: null, reason: `unreachable:${err instanceof Error ? err.message : String(err)}`, latencyMs: nowImpl() - startedAt }
  }
}

/** Docker daemon 探活（unix socket `GET /_ping`；connect 注入；恒不抛） */
export async function probeDockerSocket(socketPath, options = {}) {
  const connectImpl = options.connectImpl ?? connect
  const timeoutMs = options.timeoutMs ?? 3_000
  const nowImpl = options.nowImpl ?? (() => Date.now())
  const startedAt = nowImpl()
  return await new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        /* 竞态 */
      }
      resolve({ ...result, latencyMs: nowImpl() - startedAt })
    }
    const socket = connectImpl(socketPath)
    const timer = setTimeout(() => finish({ ok: false, status: null, reason: `timeout-after-${String(timeoutMs)}ms` }), timeoutMs)
    socket.once('error', (err) => finish({ ok: false, status: null, reason: `socket-error:${err instanceof Error ? err.message : String(err)}` }))
    socket.once('connect', () => {
      socket.write('GET /_ping HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n')
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
    })
    socket.once('close', () => {
      const statusMatch = /^HTTP\/1\.[01] (\d{3})/.exec(buffer)
      const status = statusMatch !== null ? Number(statusMatch[1]) : null
      if (status === 200 && /\bOK\b/.test(buffer)) finish({ ok: true, status, reason: 'ok' })
      else finish({ ok: false, status, reason: status === null ? 'bad-response' : `http-${String(status)}` })
    })
  })
}

/** 进程探活（pgrep -f -- pattern；exec 注入；恒不抛） */
export function probeProcess(pattern, options = {}) {
  const execImpl = options.execImpl
  if (typeof pattern !== 'string' || pattern === '') return { ok: false, reason: 'no-pattern' }
  try {
    const out = execImpl(['pgrep', '-f', '--', pattern])
    if (out.status !== 0) return { ok: false, reason: `not-running(pgrep=${String(out.status)})` }
    const pids = `${out.stdout ?? ''}`
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    return pids.length > 0 ? { ok: true, reason: 'ok', pids } : { ok: false, reason: 'not-running' }
  } catch (err) {
    return { ok: false, reason: `probe-error:${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 容器运行态探测（docker inspect -f {{.State.Running}}；exec 注入；恒不抛） */
export function probeContainer(name, options = {}) {
  const execImpl = options.execImpl
  try {
    const out = execImpl(['docker', 'inspect', '-f', '{{.State.Running}}', name])
    if (out.status !== 0) return { ok: false, running: false, reason: 'inspect-failed' }
    const running = `${out.stdout ?? ''}`.trim() === 'true'
    return running ? { ok: true, running, reason: 'ok' } : { ok: false, running: false, reason: 'not-running' }
  } catch (err) {
    return { ok: false, running: false, reason: `probe-error:${err instanceof Error ? err.message : String(err)}` }
  }
}

/** 连续失败→告警/恢复决策（纯函数；无 IO、无时钟） */
export function decideFailureActions({ failures, state, config, now, alertOnly }) {
  const threshold = config.failureThreshold
  const lastAlertAt = state?.lastAlertAt ?? 0
  const alertDue = failures >= threshold && now - lastAlertAt >= config.alertRepeatMs
  const recoverTimes = pruneRecoveryTimes(state?.recoveryTimes ?? [], now)
  const cooldownUntil = (state?.lastRecoveryAt ?? 0) + config.recovery.cooldownMs
  let recover = null
  if (!config.recovery.enabled) recover = { allowed: false, reason: 'recovery-disabled' }
  else if (alertOnly) recover = { allowed: false, reason: 'alert-only' }
  else if (failures < threshold) recover = { allowed: false, reason: 'below-threshold' }
  else if (now < cooldownUntil) recover = { allowed: false, reason: `cooldown-${String(cooldownUntil - now)}ms-left` }
  else if (recoverTimes.length >= config.recovery.maxPerHour) recover = { allowed: false, reason: `max-per-hour(${String(config.recovery.maxPerHour)})` }
  else recover = { allowed: true }
  return { alertDue, recover, recoveryTimes: recoverTimes }
}

/** 裁剪一小时前的恢复尝试时间戳（限流窗口） */
export function pruneRecoveryTimes(times, now, windowMs = 3_600_000) {
  return (times ?? []).filter((at) => Number.isFinite(at) && now - at < windowMs)
}

/** 一次探测结果汇总成分级事件（纯函数；供脚本落日志） */
export function classifyProbe(name, probe) {
  if (probe.ok) return { target: name, level: 'info', event: 'probe-ok', reason: 'ok', detail: probe }
  const transient = /timeout|unreachable|socket-error|probe-error/.test(String(probe.reason))
  return {
    target: name,
    level: transient ? 'warn' : 'error',
    event: 'probe-failed',
    reason: String(probe.reason),
    detail: probe,
  }
}

/** 读状态文件（缺失/坏 JSON → 空态；坏 JSON 抛给调用方决定是否降级） */
export function readWatchdogState(stateFile) {
  if (typeof stateFile !== 'string' || stateFile === '' || !existsSync(stateFile)) return {}
  const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}

/** 写状态文件（目录自动创建） */
export function writeWatchdogState(stateFile, state) {
  if (typeof stateFile !== 'string' || stateFile === '') return
  mkdirSync(path.dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** 追加 JSONL 告警/事件（失败不炸守护；返回是否写成功） */
export function appendJsonl(file, entry) {
  if (typeof file !== 'string' || file === '') return false
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** 目标清单（固定顺序 + 容器目标展开） */
export function targetList(config) {
  const targets = TARGET_ORDER.filter((name) => config.probes[name] !== undefined)
  for (const name of config.containers) targets.push(`container:${name}`)
  return targets
}

/** 缺省日志/状态文件路径（未配置时回落到 logDir 或 /tmp） */
export function resolvePaths(config, fallbackDir) {
  const logDir = config.logDir ?? fallbackDir ?? '/tmp'
  return {
    logDir,
    alertsFile: config.alertsFile ?? path.join(logDir, 'infra-alerts.jsonl'),
    stateFile: config.stateFile ?? path.join(logDir, 'infra-watchdog-state.json'),
  }
}
