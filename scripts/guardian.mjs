#!/usr/bin/env node
/**
 * guardian.mjs —— StudioNext 守护核 MVP（studio-dev-697；docs/90-§三/§五）
 *
 * 铁律（docs/90 一.1）：①极小 ②零业务依赖（只 node 标准库+fetch；纯逻辑 helper 取自
 * `packages/core/src/survival/guardian.ts`——零 import/零 IO 的纯件，测试单点）③只做监护/
 * 拉起/上报，不做业务 ④自身由 launchd KeepAlive 保。
 *
 * 语义：
 *   - 起 daemon 子进程；按 intervalMs 探 GET /healthz（超时/非 200/ok!=true/tick 停=失败）；
 *   - 连续 failuresBeforeRestart 次失败或子进程退出 → SIGTERM 等 drain → SIGKILL →
 *     指数退避重启；crash-loop 刹车（windowMs 内 ≥maxRestarts 次 → brakeMs 长退避+告警）；
 *   - 告警：logDir/guardian.jsonl ＋ 可选 alertsFile ＋ 可选 webhookUrl（失败只记日志不炸）；
 *   - daemon pid 写 paths.pidFile（运维/演练观察），退出清理。
 *
 * 用法：node scripts/guardian.mjs --config <guardian.json>（配置/安装见 ops/launchd/README.md）
 * 退出码：0=正常停；1=配置非法；2=异常。
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  GUARDIAN_DEFAULTS,
  buildGuardianAlert,
  nextBackoff,
  parseGuardianArgs,
  probeHealth,
  probeFailureKind,
  shouldBrake,
} from '../packages/core/src/survival/guardian.ts'

const USAGE =
  '用法：node scripts/guardian.mjs --config <guardian.json>\n' +
  '  guardian 守护核（launchd 托管）：监护 daemon /healthz，失败退避重启＋crash-loop 刹车＋告警。\n' +
  '  配置样例/安装步骤见 ops/launchd/README.md。\n'

/**
 * 解析凭据 env 文件（studio-dev-787 凭据隔离）：
 *   `KEY=VALUE` 每行；忽略空行/`#` 注释；允许 `export KEY=VALUE`；key 形如 [A-Za-z_][A-Za-z0-9_]*；
 *   VALUE 原样保留（去首尾空白；不展开变量/不做引号解释——由 daemon.env 自己控制格式）。
 * 非法行=抛（fail-fast，不静默跳过：凭据文件错行比缺凭据更难查）。
 */
export function parseEnvFile(text, source = 'envFile') {
  const out = {}
  let lineNo = 0
  for (const raw of String(text).split(/\r?\n/)) {
    lineNo += 1
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) throw new Error(`${source} 第 ${String(lineNo)} 行格式非法（须 KEY=VALUE）：${line.slice(0, 40)}`)
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`${source} 第 ${String(lineNo)} 行 key 非法：${JSON.stringify(key)}`)
    out[key] = body.slice(eq + 1).trim()
  }
  return out
}

/**
 * 读每公司凭据文件（0600；daemon.env）。**fail-closed**：文件缺失/非普通文件/权限含 group/other
 * 可读位（mode & 0o077）→ 抛；不打印任何值（错误只带路径/权限位）。
 */
export function readEnvFile(envFile) {
  if (typeof envFile !== 'string' || envFile === '') throw new Error('daemon.envFile 必须是非空路径')
  if (!existsSync(envFile)) throw new Error(`daemon.envFile 不存在：${envFile}`)
  const st = statSync(envFile)
  if (!st.isFile()) throw new Error(`daemon.envFile 不是普通文件：${envFile}`)
  const perm = st.mode & 0o777
  if ((perm & 0o077) !== 0) {
    throw new Error(`daemon.envFile 权限过宽（${perm.toString(8)}；须 0600，拒绝含 group/other 读位）：${envFile}`)
  }
  return parseEnvFile(readFileSync(envFile, 'utf8'), envFile)
}

/** 校验/补全配置（非法即抛——fail-fast，不猜；路径必须已存在） */
export function validateConfig(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('guardian 配置必须是 JSON 对象')
  const cfg = raw
  const daemon = cfg.daemon
  if (typeof daemon !== 'object' || daemon === null) throw new Error('缺少 daemon 配置')
  const command = daemon.command
  if (!Array.isArray(command) || command.length === 0 || !command.every((x) => typeof x === 'string' && x !== '')) {
    throw new Error('daemon.command 必须是非空字符串数组（argv）')
  }
  if (typeof daemon.cwd !== 'string' || daemon.cwd === '') throw new Error('daemon.cwd 必须是非空路径')
  if (!existsSync(daemon.cwd)) throw new Error(`daemon.cwd 不存在：${daemon.cwd}`)
  const preflight = daemon.preflight
  if (preflight !== undefined && (!Array.isArray(preflight) || preflight.length === 0 || !preflight.every((x) => typeof x === 'string' && x !== ''))) {
    throw new Error('daemon.preflight 必须是非空字符串数组（argv；部署隔离 preflight，见 docs/90-§六）')
  }
  const inlineEnv = daemon.env !== undefined && daemon.env !== null ? { ...daemon.env } : {}
  let envFile = undefined
  let fileEnv = {}
  if (daemon.envFile !== undefined) {
    envFile = daemon.envFile
    fileEnv = readEnvFile(envFile) // 0600/格式 fail-closed（787 凭据隔离）
  }
  // 兼容迁移：inline env 仍允许（studio-dev 平滑迁移），但敏感键应在 daemon.envFile；envFile 优先覆盖同名键
  const env = { ...inlineEnv, ...fileEnv }
  const preflightRetryMs = daemon.preflightRetryMs ?? 30_000
  if (typeof preflightRetryMs !== 'number' || !Number.isFinite(preflightRetryMs) || preflightRetryMs <= 0) {
    throw new Error('daemon.preflightRetryMs 必须是正整数毫秒')
  }
  const healthUrl = cfg.health?.url
  if (typeof healthUrl !== 'string' || !/^https?:\/\//.test(healthUrl)) throw new Error('health.url 必须是 http(s) URL')
  if (typeof cfg.paths?.logDir !== 'string' || cfg.paths.logDir === '') throw new Error('paths.logDir 必须是非空路径')
  return {
    daemon: {
      command: command.slice(),
      cwd: daemon.cwd,
      env,
      ...(envFile !== undefined ? { envFile } : {}),
      ...(preflight !== undefined ? { preflight: preflight.slice(), preflightRetryMs: Math.trunc(preflightRetryMs) } : {}),
    },
    health: { ...GUARDIAN_DEFAULTS.health, ...(cfg.health ?? {}), url: healthUrl },
    restart: { ...GUARDIAN_DEFAULTS.restart, ...(cfg.restart ?? {}) },
    crashLoop: { ...GUARDIAN_DEFAULTS.crashLoop, ...(cfg.crashLoop ?? {}) },
    paths: {
      logDir: cfg.paths.logDir,
      ...(typeof cfg.paths.daemonLog === 'string' ? { daemonLog: cfg.paths.daemonLog } : {}),
      ...(typeof cfg.paths.guardianLog === 'string' ? { guardianLog: cfg.paths.guardianLog } : {}),
      ...(typeof cfg.paths.pidFile === 'string' ? { pidFile: cfg.paths.pidFile } : {}),
      ...(typeof cfg.paths.alertsFile === 'string' ? { alertsFile: cfg.paths.alertsFile } : {}),
      ...(typeof cfg.paths.webhookUrl === 'string' ? { webhookUrl: cfg.paths.webhookUrl } : {}),
    },
  }
}

/** 读配置（文件缺失/JSON 坏 → 抛；调用方转 exit 1） */
export function loadConfig(configPath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`guardian 配置读取/解析失败（${configPath}）：${err instanceof Error ? err.message : String(err)}`)
  }
  return validateConfig(parsed)
}

/** 打开子进程标准流文件（追加；失败回退 ignore） */
function openStdio(file, flags) {
  try {
    return openSync(file, flags)
  } catch {
    return 'ignore'
  }
}

/** 主循环（注入 spawn/probe/sleep/now 供测试；恒清理 pidFile 并留 guardian-stop） */
export async function runGuardian(config, overrides = {}) {
  const nowImpl = overrides.now ?? (() => Date.now())
  const sleepImpl = overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const spawnImpl = overrides.spawn ?? spawn
  const probeImpl = overrides.probe
  const fetchImpl = overrides.fetch ?? globalThis.fetch
  const stderr = overrides.stderr ?? ((line) => process.stderr.write(`${line}\n`))
  // 部署隔离 preflight（ref=708）：起 daemon 前先跑外部校验（默认调 deploy.mjs check）；
  // 非 0 = 部署树不干净/漂移/依赖缺失 → 拒绝启动（fail-closed），只告警并隔 preflightRetryMs 重试。
  const preflightImpl =
    overrides.preflight ??
    ((argv) => {
      const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 120_000 })
      return {
        exitCode: result.error !== undefined ? -1 : result.status,
        error: result.error === undefined ? undefined : result.error.message,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
      }
    })

  mkdirSync(config.paths.logDir, { recursive: true })
  const guardianLog = config.paths.guardianLog ?? path.join(config.paths.logDir, 'guardian.jsonl')
  const daemonLog = config.paths.daemonLog ?? path.join(config.paths.logDir, 'daemon.log')
  const alarms = config.paths.alertsFile
  const writeLine = (line) => appendFileSync(guardianLog, `${JSON.stringify(line)}\n`, 'utf8')
  const log = (event, detail) => {
    const line = buildGuardianAlert(event, detail)
    try {
      writeLine(line)
    } catch (err) {
      stderr(`guardian 日志写入失败（${guardianLog}）：${err instanceof Error ? err.message : String(err)}`)
    }
    return line
  }
  const alert = (event, detail) => {
    const line = log(event, detail)
    if (alarms !== undefined) {
      try {
        appendFileSync(alarms, `${JSON.stringify(line)}\n`, 'utf8')
      } catch (err) {
        stderr(`guardian 告警写入失败（${alarms}）：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (config.paths.webhookUrl !== undefined) {
      void fetchImpl(config.paths.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(line),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {})
    }
    return line
  }
  const pidFile = config.paths.pidFile
  const writePid = (pid) => {
    if (pidFile === undefined) return
    try {
      writeFileSync(pidFile, `${String(pid)}\n`, 'utf8')
    } catch (err) {
      log('pid-file-error', { error: err instanceof Error ? err.message : String(err) })
    }
  }
  const clearPid = () => {
    if (pidFile === undefined) return
    try {
      rmSync(pidFile, { force: true })
    } catch {
      /* 清理失败忽略（下次启动覆盖） */
    }
  }

  const restartTimes = []
  let attempt = 0
  let stopping = false
  const onSignal = () => {
    stopping = true
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  log('guardian-start', { pid: process.pid, healthUrl: config.health.url, daemonArgv: config.daemon.command.length, envFile: config.daemon.envFile ?? null })

  try {
    while (!stopping) {
      // 部署隔离 preflight：部署树必须是已验证 commit 且干净；失败则不 spawn daemon（fail-closed）
      if (config.daemon.preflight !== undefined) {
        const pf = preflightImpl(config.daemon.preflight)
        if (pf.exitCode !== 0) {
          alert('preflight-failed', {
            exitCode: pf.exitCode,
            error: pf.error ?? null,
            output: pf.output === '' ? null : pf.output.slice(0, 2_000),
            retryMs: config.daemon.preflightRetryMs,
          })
          await sleepImpl(config.daemon.preflightRetryMs)
          continue
        }
        log('preflight-ok', {})
      }
      let child
      try {
        child = spawnImpl(config.daemon.command[0], config.daemon.command.slice(1), {
          cwd: config.daemon.cwd,
          env: { ...process.env, ...config.daemon.env },
          stdio: ['ignore', openStdio(daemonLog, 'a'), openStdio(daemonLog, 'a')],
        })
      } catch (err) {
        log('spawn-error', { error: err instanceof Error ? err.message : String(err), attempt })
        attempt += 1
        await sleepImpl(nextBackoff(attempt, config.restart))
        continue
      }
      // spawn 可能异步失败（ENOENT 等）：'error' 事件必须被消费（否则 Node 未捕获崩溃）；
      // 记结构化 spawn-error 告警并走 restart/backoff（守护核不退出）。
      let spawnError = undefined
      child.on('error', (err) => {
        spawnError = err
        log('spawn-error', {
          pid: typeof child.pid === 'number' ? child.pid : null,
          error: err instanceof Error ? err.message : String(err),
          attempt,
        })
      })
      const spawned = await new Promise((resolve) => {
        if (typeof child.pid === 'number') {
          resolve('spawn')
          return
        }
        child.once('spawn', () => resolve('spawn'))
        child.once('error', () => resolve('error'))
      })
      if (spawned !== 'spawn' || spawnError !== undefined) {
        if (spawnError === undefined) log('spawn-error', { error: 'spawn 未返回 pid', attempt })
        try {
          child.kill()
        } catch {
          /* 未真正创建：kill 竞态忽略 */
        }
        attempt += 1
        const backoffMs = nextBackoff(attempt, config.restart)
        log('restart-scheduled', { attempt, backoffMs, lastReason: 'spawn-error' })
        await sleepImpl(backoffMs)
        continue
      }
      if (typeof child.pid === 'number') writePid(child.pid)
      const startedAt = nowImpl()
      log('daemon-start', { pid: child.pid, attempt })
      let consecutiveFailures = 0
      /** 最近一次失败原因（734：streak 恢复行携带；不改重启判定） */
      let lastProbeReason = undefined
      let reason = 'unknown'
      while (!stopping) {
        if (child.exitCode !== null || child.signalCode !== null) {
          reason = `child-exited(code=${String(child.exitCode)},signal=${String(child.signalCode)})`
          break
        }
        if (spawnError !== undefined) {
          reason = `spawn-error:${spawnError instanceof Error ? spawnError.message : String(spawnError)}`
          break
        }
        // 启动宽限期内不判健康失败（避免 daemon 启动中 health-fail 噪声；子进程退出仍会捕获）
        if (nowImpl() - startedAt < config.health.startupGraceMs) {
          await sleepImpl(config.health.intervalMs)
          continue
        }
        const probe =
          probeImpl !== undefined
            ? await probeImpl(config)
            : await probeHealth(config.health.url, { timeoutMs: config.health.timeoutMs }, fetchImpl)
        if (probe.healthy) {
          // 瞬态恢复可见化（734）：整条失败 streak 恢复时补一行 info（否则瞬态失败只能靠缺席推断）
          if (consecutiveFailures > 0) {
            log('health-recovered', {
              pid: child.pid,
              failures: consecutiveFailures,
              lastReason: lastProbeReason,
            })
          }
          consecutiveFailures = 0
          lastProbeReason = undefined
        } else {
          const failuresBeforeRestart = config.health.failuresBeforeRestart
          const previousFailures = consecutiveFailures
          consecutiveFailures += 1
          lastProbeReason = probe.reason
          const kind = probeFailureKind(probe.reason)
          // 734 去重：只记 streak 首次失败（warn）+ 达重启阈值时一条 error；中间失败不再刷屏。
          // 级别语义：瞬态/probe timeout=warn（旧实现全部 error，142/142 行误报）；重启阈值=error。
          if (consecutiveFailures === 1) {
            log('health-fail', {
              pid: child.pid,
              reason: probe.reason,
              consecutiveFailures,
              kind,
              transient: true,
              note: '首次探活失败（瞬态候选；连续达阈值才重启）',
            })
          }
          if (consecutiveFailures >= failuresBeforeRestart) {
            log('health-fail-restart', {
              pid: child.pid,
              reason: probe.reason,
              kind,
              consecutiveFailures,
              previousFailures,
              threshold: failuresBeforeRestart,
              note: '连续探活失败达重启阈值（重启语义不变，见 restart/backoff）',
            })
            reason = `health-fail:${probe.reason}`
            break
          }
        }
        await sleepImpl(config.health.intervalMs)
      }
      if (child.exitCode === null && child.signalCode === null) {
        log('daemon-stop', { pid: child.pid, reason })
        try {
          child.kill('SIGTERM')
        } catch {
          /* 退出竞态 */
        }
        const deadline = nowImpl() + config.restart.stopGraceMs
        while (child.exitCode === null && child.signalCode === null && nowImpl() < deadline) {
          await sleepImpl(250)
        }
        if (child.exitCode === null && child.signalCode === null) {
          log('daemon-kill', { pid: child.pid, reason: 'stop-grace-timeout' })
          try {
            child.kill('SIGKILL')
          } catch {
            /* 退出竞态 */
          }
        }
      }
      clearPid()
      if (stopping) break
      restartTimes.push(nowImpl())
      if (shouldBrake(restartTimes, nowImpl(), config.crashLoop)) {
        alert('crash-loop-brake', {
          windowMs: config.crashLoop.windowMs,
          restartsInWindow: restartTimes.filter((at) => nowImpl() - at <= config.crashLoop.windowMs).length,
          brakeMs: config.crashLoop.brakeMs,
          lastReason: reason,
        })
        await sleepImpl(config.crashLoop.brakeMs)
        restartTimes.length = 0
        attempt = 0
        continue
      }
      attempt += 1
      const backoffMs = nextBackoff(attempt, config.restart)
      log('restart-scheduled', { attempt, backoffMs, lastReason: reason })
      await sleepImpl(backoffMs)
    }
  } finally {
    clearPid()
    log('guardian-stop', { pid: process.pid })
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('SIGINT', onSignal)
  }
  return 0
}

async function main() {
  const parsed = parseGuardianArgs(process.argv)
  if (parsed.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (parsed.config === '') {
    process.stderr.write(`guardian：缺少 --config <guardian.json>\n${USAGE}`)
    return 1
  }
  let config
  try {
    config = loadConfig(parsed.config)
  } catch (err) {
    process.stderr.write(`guardian 启动失败：${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  return runGuardian(config)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`guardian 异常退出：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
      process.exitCode = 2
    },
  )
}
