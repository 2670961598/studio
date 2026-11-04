#!/usr/bin/env node
/**
 * infra-watchdog —— 基础设施守护（studio-dev-774）
 *
 * 背景（2026-11-04 23:00 事故）：USB 外置盘 I/O error → Docker Desktop VM 卡死（Docker.raw 在该盘）
 * → Synapse(:8008)/Taiga(:9000) 全挂 → daemon Matrix 登录 500 连续崩溃 ×5 → guardian crash-loop
 * brake 15min → daemon 停 ~16min；profit 同停。恢复全靠人工。本脚本=host 侧独立 watchdog：
 *   - 探测：①docker daemon（unix socket `_ping`）②Matrix :8008 ③Taiga :9000 ④studio-dev /healthz
 *     ⑤profit daemon 进程；容器运行态（docker inspect）
 *   - 连续 N 次失败 → 结构化告警（alerts.jsonl，info/warn/error 分级）＋按配置**自动恢复**：
 *     docker 卡死=杀 Docker 进程并重开；容器未起=docker start；studio-dev daemon 停=kickstart guardian；
 *     恢复动作有冷却/小时上限/开关（默认开启，可 `--alert-only` 只告警）
 *   - 恢复成功后记 `recovered`（info）；单次瞬态失败只 warn 不动作；失败重复告警按 alertRepeatMs 节流
 *
 * 边界（774）：零业务依赖（仅 node 标准库）；不 import daemon/契约/公司目录；不改端口/业务逻辑；
 * 只按配置执行命令。launchd 托管模板：`ops/launchd/io.studionext.infra-watchdog.plist`。
 *
 * 用法：
 *   node scripts/ops/infra-watchdog.mjs --config <infra-watchdog.json> [--once|--runs N]
 *        [--interval-ms N] [--alert-only] [--json] [--dry-run]
 *   node scripts/ops/infra-watchdog.mjs --help
 *
 * 退出码：0=正常（单轮/守护退出）；1=用法/配置错误。
 * 注意：只有显式 `--dry-run`/`--alert-only` 或配置 `recovery.enabled=false` 才不执行恢复命令。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_WATCHDOG_CONFIG,
  appendJsonl,
  classifyProbe,
  decideFailureActions,
  normalizeConfig,
  probeContainer,
  probeDockerSocket,
  probeHttp,
  probeProcess,
  readWatchdogState,
  resolvePaths,
  targetList,
  writeWatchdogState,
} from './infra-watchdog-lib.mjs'

const USAGE = `用法：node scripts/ops/infra-watchdog.mjs --config <infra-watchdog.json> [选项]

选项：
  --config <file>        配置 JSON（必填；模板见 ops/launchd/infra-watchdog.example.json）
  --once                 只跑一轮探测（演练/测试）
  --runs <n>             跑 n 轮后退出（缺省无限，launchd 常驻）
  --interval-ms <n>      覆盖 probeIntervalMs
  --alert-only           只告警、不执行恢复命令（覆盖配置）
  --dry-run              只打印将要执行的恢复命令，不执行（安全演练）
  --json                 每轮/结束时输出 JSON 摘要
  --help                 本帮助

退出码：0=正常；1=用法/配置错误。`

const EXIT = { ok: 0, usage: 1 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--once' || token === '--alert-only' || token === '--dry-run' || token === '--json') {
      opts[token.slice(2)] = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    opts[key] = value
    i += 1
  }
  return { help: false, opts }
}

function nowIso() {
  return new Date().toISOString()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 执行恢复命令（同步；返回结构化结果） */
function runCommand(argv, options = {}) {
  if (options.dryRun === true) return { status: null, dryRun: true, command: argv.join(' ') }
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: options.timeoutMs ?? 120_000 })
  return {
    status: result.status,
    error: result.error === undefined ? null : result.error.message,
    stdout: `${result.stdout ?? ''}`.trim().slice(0, 500),
    stderr: `${result.stderr ?? ''}`.trim().slice(0, 500),
    command: argv.join(' '),
  }
}

/** pgrep/docker inspect 执行器（spawnSync；可被测试通过 PATH 替换） */
function execProbe(argv) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 5_000 })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function defaultDockerCommands() {
  return { dockerKill: ['pkill', '-f', 'Docker.app'], dockerStart: ['open', '-a', 'Docker'] }
}

function guiDomain() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  return `gui/${uid}`
}

/** 目标恢复命令规划（配置优先；缺省按 774 场景） */
export function recoveryPlan(target, config, probe) {
  const commands = config.recoveryCommands
  if (Array.isArray(commands[target])) return { commands: [commands[target]], note: 'configured' }
  if (target === 'docker') {
    const docker = { ...defaultDockerCommands(), ...(commands.docker ?? {}) }
    return { commands: [docker.dockerKill, docker.dockerStart], note: 'docker-hang: kill+reopen' }
  }
  if (target.startsWith('container:')) {
    const name = target.slice('container:'.length)
    const prefix = Array.isArray(commands.containerStart) ? commands.containerStart : ['docker', 'start']
    return { commands: [[...prefix, name]], note: `container-start:${name}` }
  }
  if (target === 'matrix' || target === 'taiga') {
    const container = config.probes[target]?.container ?? (target === 'matrix' ? 'synapse' : 'taiga')
    const prefix = Array.isArray(commands.containerStart) ? commands.containerStart : ['docker', 'start']
    return { commands: [[...prefix, String(container)]], note: `container-start:${String(container)}` }
  }
  if (target === 'studioDev') {
    const label = config.probes.studioDev.guardianLabel ?? DEFAULT_WATCHDOG_CONFIG.probes.studioDev.guardianLabel
    const prefix = Array.isArray(commands.studioDevKickstart) ? commands.studioDevKickstart : ['launchctl', 'kickstart', '-k']
    return { commands: [[...prefix, `${guiDomain()}/${String(label)}`]], note: `guardian-kickstart:${String(label)}` }
  }
  if (target === 'studioProfit') {
    const label = config.probes.studioProfit.guardianLabel
    if (typeof label === 'string' && label !== '') {
      const prefix = Array.isArray(commands.studioDevKickstart) ? commands.studioDevKickstart : ['launchctl', 'kickstart', '-k']
      return { commands: [[...prefix, `${guiDomain()}/${label}`]], note: `guardian-kickstart:${label}` }
    }
    return { commands: [], note: 'no-recovery-configured（profit 目前无 guardian；守护化后配 guardianLabel）' }
  }
  return { commands: [], note: 'no-recovery-configured' }
}

function probeTarget(target, config) {
  if (target === 'docker') return probeDockerSocket(config.probes.docker.socket, { timeoutMs: config.probes.docker.timeoutMs })
  if (target === 'matrix') return probeHttp(config.probes.matrix.url, { timeoutMs: config.probes.matrix.timeoutMs })
  if (target === 'taiga') return probeHttp(config.probes.taiga.url, { timeoutMs: config.probes.taiga.timeoutMs })
  if (target === 'studioDev') return probeHttp(config.probes.studioDev.url, { timeoutMs: config.probes.studioDev.timeoutMs, expectOkBody: true })
  if (target === 'studioProfit') return probeProcess(config.probes.studioProfit.processPattern, { execImpl: execProbe })
  if (target.startsWith('container:')) return probeContainer(target.slice('container:'.length), { execImpl: execProbe })
  return { ok: false, reason: 'unknown-target' }
}

/** 一轮探测（返回事件数组；含恢复动作） */
async function runRound(config, state, paths, options) {
  const events = []
  const emit = (level, event, detail) => {
    const entry = { ts: nowIso(), level, event, ...detail }
    appendJsonl(paths.alertsFile, entry)
    events.push(entry)
    if (options.json !== true) {
      const tag = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]'
      process.stdout.write(`${tag} ${event} ${detail.target ?? ''} ${detail.reason ?? ''}${detail.note !== undefined ? `（${detail.note}）` : ''}\n`)
    }
    return entry
  }
  const now = Date.now()
  const targets = targetList(config).filter((name) => {
    if (name === 'studioProfit' && (config.probes.studioProfit.processPattern === null || config.probes.studioProfit.processPattern === undefined)) return false
    return true
  })
  for (const target of targets) {
    const probe = await probeTarget(target, config)
    const targetState = state.targets[target] ?? { failures: 0, lastAlertAt: 0, lastRecoveryAt: 0, recoveryTimes: [] }
    const classified = classifyProbe(target, probe)
    if (probe.ok) {
      if (targetState.failures > 0) {
        emit('info', 'recovered', { target, failures: targetState.failures, lastReason: targetState.lastReason ?? null })
      }
      state.targets[target] = { failures: 0, lastAlertAt: 0, lastRecoveryAt: targetState.lastRecoveryAt, recoveryTimes: targetState.recoveryTimes }
      continue
    }
    targetState.failures += 1
    targetState.lastReason = probe.reason
    const decision = decideFailureActions({
      failures: targetState.failures,
      state: targetState,
      config,
      now,
      alertOnly: config.alertOnly === true || options['alert-only'] === true,
    })
    if (decision.alertDue) {
      emit(classified.level, 'probe-failed', {
        target,
        reason: probe.reason,
        failures: targetState.failures,
        threshold: config.failureThreshold,
      })
      targetState.lastAlertAt = now
    }
    if (decision.recover.allowed) {
      const plan = recoveryPlan(target, config, probe)
      targetState.lastRecoveryAt = now
      targetState.recoveryTimes = [...decision.recoveryTimes, now]
      if (plan.commands.length === 0) {
        emit('warn', 'recovery-skipped', { target, reason: probe.reason, note: plan.note })
      } else {
        emit('warn', 'recovery-attempt', { target, reason: probe.reason, commands: plan.commands.map((argv) => argv.join(' ')), note: plan.note })
        for (const argv of plan.commands) {
          const result = runCommand(argv, { dryRun: config.dryRun === true || options['dry-run'] === true })
          if (result.dryRun === true) {
            emit('info', 'recovery-dry-run', { target, command: result.command })
            continue
          }
          const ok = result.status === 0
          emit(ok ? 'info' : 'error', ok ? 'recovery-ok' : 'recovery-failed', {
            target,
            command: result.command,
            status: result.status,
            stderr: result.stderr === '' ? null : result.stderr,
          })
          if (!ok) break
        }
      }
    } else if (targetState.failures >= config.failureThreshold) {
      emit('warn', 'recovery-skipped', { target, reason: probe.reason, note: decision.recover.reason })
    }
    state.targets[target] = targetState
  }
  state.lastRoundAt = now
  writeWatchdogState(paths.stateFile, state)
  return events
}

async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`infra-watchdog：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (parsed.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = parsed.opts
  if (typeof opts.config !== 'string' || opts.config === '') {
    process.stderr.write(`infra-watchdog：缺少 --config <file>\n\n${USAGE}`)
    return EXIT.usage
  }
  let rawConfig
  try {
    rawConfig = JSON.parse(readFileSync(path.resolve(opts.config), 'utf8'))
  } catch (err) {
    process.stderr.write(`infra-watchdog：配置读取/解析失败（${opts.config}）：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.usage
  }
  let config
  try {
    config = normalizeConfig(rawConfig)
  } catch (err) {
    process.stderr.write(`infra-watchdog：配置非法：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.usage
  }
  if (opts['alert-only'] === true) config = { ...config, alertOnly: true }
  if (opts['interval-ms'] !== undefined) {
    const interval = Number(opts['interval-ms'])
    if (!Number.isFinite(interval) || interval <= 0) {
      process.stderr.write('infra-watchdog：--interval-ms 必须是正整数\n')
      return EXIT.usage
    }
    config = { ...config, probeIntervalMs: Math.trunc(interval) }
  }
  config = { ...config, dryRun: opts['dry-run'] === true }
  const paths = resolvePaths(config, existsSync(config.logDir ?? '') ? config.logDir : path.dirname(path.resolve(opts.config)))
  const state = (() => {
    try {
      return readWatchdogState(paths.stateFile)
    } catch {
      return {}
    }
  })()
  state.targets = state.targets ?? {}
  const runs = opts.once === true ? 1 : opts.runs !== undefined ? Number(opts.runs) : Infinity
  if (Number.isFinite(runs) && (!Number.isInteger(runs) || runs < 0)) {
    process.stderr.write('infra-watchdog：--runs 必须是非负整数\n')
    return EXIT.usage
  }
  const startedAt = nowIso()
  appendJsonl(paths.alertsFile, { ts: startedAt, level: 'info', event: 'watchdog-start', pid: process.pid, config: path.resolve(opts.config), targets: targetList(config), alertOnly: config.alertOnly === true })
  if (opts.json !== true) process.stdout.write(`[INFO] watchdog-start pid=${String(process.pid)} interval=${String(config.probeIntervalMs)}ms threshold=${String(config.failureThreshold)} ${config.alertOnly === true ? '(alert-only)' : ''}\n`)
  let stopping = false
  const onSignal = () => {
    stopping = true
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  let rounds = 0
  let lastEvents = []
  try {
    while (!stopping && rounds < runs) {
      lastEvents = await runRound(config, state, paths, opts)
      rounds += 1
      if (opts.json === true) process.stdout.write(`${JSON.stringify({ round: rounds, at: nowIso(), events: lastEvents })}\n`)
      if (stopping || rounds >= runs) break
      await sleep(config.probeIntervalMs)
    }
  } finally {
    appendJsonl(paths.alertsFile, { ts: nowIso(), level: 'info', event: 'watchdog-stop', pid: process.pid, rounds })
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('SIGINT', onSignal)
  }
  return EXIT.ok
}

function realpathOrResolved(target) {
  try {
    return realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathOrResolved(process.argv[1]) === realpathOrResolved(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
