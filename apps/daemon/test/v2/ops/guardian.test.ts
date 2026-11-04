/**
 * 守护核单测（studio-dev-697；docs/90-§一/§三/§五）
 *
 * 覆盖：指数退避封顶、crash-loop 判定、健康响应判据、探测失败不抛（结构化）、告警形状、
 * 参数解析（core 纯件单点）；guardian 脚本 CLI fail-fast（--help/缺配置/坏配置 exit 码；
 * 脚本本体不 import 业务包——用子进程从外部验，避免跨包相对引用）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GUARDIAN_DEFAULTS,
  buildGuardianAlert,
  classifyHealth,
  guardianEventLevel,
  probeFailureKind,
  nextBackoff,
  parseGuardianArgs,
  probeHealth,
  shouldBrake,
} from '@studio-next/core'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-guardian-'))
  dirs.push(dir)
  return dir
}

const GUARDIAN = path.join(process.cwd(), 'scripts', 'guardian.mjs')

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [GUARDIAN, ...args], { encoding: 'utf8', timeout: 15_000 })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** 等 guardian 日志出现指定事件（高负载下 node 启动慢，SIGTERM 必须等 handler 就绪后再发） */
async function waitForGuardianEvent(logPath: string, event: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      const events = readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { event: string })
      if (events.some((entry) => entry.event === event)) return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`guardian 日志未出现事件 ${event}（${String(timeoutMs)}ms，${logPath}）`)
}

describe('纯函数（退避/刹车/判据/告警/参数；core/src/survival/guardian）', () => {
  it('nextBackoff：指数增长、封顶 maxBackoffMs', () => {
    const cfg = { initialBackoffMs: 1_000, maxBackoffMs: 8_000, multiplier: 2 }
    expect([1, 2, 3, 4, 5, 6].map((n) => nextBackoff(n, cfg))).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000])
    expect(nextBackoff(1, { initialBackoffMs: 0, maxBackoffMs: 5_000 })).toBe(0)
  })

  it('shouldBrake：窗口内达到 maxRestarts 才刹车', () => {
    const cfg = { windowMs: 60_000, maxRestarts: 3, brakeMs: 1 }
    expect(shouldBrake([20_000, 95_000, 99_000], 100_000, cfg)).toBe(false) // 最早一条滑出窗口
    expect(shouldBrake([95_000, 98_000, 99_000], 100_000, cfg)).toBe(true)
    expect(shouldBrake([], 100_000, cfg)).toBe(false)
  })

  it('classifyHealth：200+ok+advancing 才算健康；503/坏体/停拍=不健康', () => {
    expect(classifyHealth(200, { ok: true, tick: { advancing: true } })).toEqual({ healthy: true })
    expect(classifyHealth(503, { ok: false }).healthy).toBe(false)
    expect(classifyHealth(200, { ok: false }).reason).toBe('body-not-ok')
    expect(classifyHealth(200, { ok: true, tick: { advancing: false } }).reason).toBe('tick-not-advancing')
    expect(classifyHealth(200, null).reason).toBe('body-not-object')
  })

  it('probeHealth：200/503/网络异常都结构化返回（不抛）', async () => {
    const ok = await probeHealth('http://x/healthz', {}, async () => ({ status: 200, json: async () => ({ ok: true }) }))
    expect(ok.healthy).toBe(true)
    const bad = await probeHealth('http://x/healthz', {}, async () => ({
      status: 503,
      json: async () => ({ ok: false, tick: { advancing: false } }),
    }))
    expect(bad.healthy).toBe(false)
    expect(bad.reason).toBe('http-503')
    const err = await probeHealth('http://x/healthz', {}, async () => {
      throw new Error('connect refused')
    })
    expect(err.healthy).toBe(false)
    expect(String(err.reason)).toContain('connect refused')
  })

  it('parseGuardianArgs / buildGuardianAlert 形状', () => {
    expect(parseGuardianArgs(['node', 'guardian.mjs', '--config', '/x.json'])).toEqual({ help: false, config: '/x.json' })
    expect(parseGuardianArgs(['node', 'guardian.mjs', '--config=/y.json'])).toEqual({ help: false, config: '/y.json' })
    expect(parseGuardianArgs(['node', 'guardian.mjs', '-h']).help).toBe(true)
    const alert = buildGuardianAlert('health-fail', { pid: 1 })
    expect(alert.level).toBe('warn') // 734：瞬态探活失败=warn（旧实现误标 error）
    expect(alert.event).toBe('health-fail')
    expect(alert.pid).toBe(1)
    const healthy = buildGuardianAlert('healthy', {})
    expect(healthy.level).toBe('info')
    expect(GUARDIAN_DEFAULTS.crashLoop.maxRestarts).toBe(5)
  })

  it('guardianEventLevel：正常事件≠error；error 仅限需人工介入类（734）', () => {
    // 正常生命周期/部署面 → info
    for (const event of ['guardian-start', 'guardian-stop', 'daemon-start', 'preflight-ok', 'healthy', 'health-recovered']) {
      expect(guardianEventLevel(event)).toBe('info')
    }
    // 可自愈/需关注 → warn
    for (const event of ['health-fail', 'health-recovered'.replace('recovered', 'fail'), 'preflight-failed', 'daemon-stop', 'restart-scheduled', 'pid-file-error']) {
      expect(guardianEventLevel(event)).toBe('warn')
    }
    // 需人工介入 → error
    for (const event of ['spawn-error', 'daemon-kill', 'crash-loop-brake', 'health-fail-restart']) {
      expect(guardianEventLevel(event)).toBe('error')
    }
    // 未知事件保守 warn（不得默认 error——正常事件不得 error 的结构性保证）
    expect(guardianEventLevel('some-new-event')).toBe('warn')
    expect(guardianEventLevel('')).toBe('warn')
  })

  it('probeFailureKind：timeout/network/http/body 可判（734 probe timeout 不再误报）', () => {
    expect(probeFailureKind('probe-error:The operation was aborted due to timeout')).toBe('timeout')
    expect(probeFailureKind('probe-error:fetch failed')).toBe('network')
    expect(probeFailureKind('http-503')).toBe('http')
    expect(probeFailureKind('body-not-ok')).toBe('body')
    expect(probeFailureKind(undefined)).toBe('unknown')
    expect(probeFailureKind('weird')).toBe('unknown')
  })
})

describe('guardian 脚本 CLI（fail-fast；不 import 业务包）', () => {
  it('--help → exit 0 且输出用法', () => {
    const result = runCli(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--config')
  })

  it('缺 --config → exit 1', () => {
    const result = runCli([])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('缺少 --config')
  })

  it('配置非法（JSON 坏/字段缺/URL 非 http）→ exit 1 并明报', () => {
    const dir = tempDir()
    const badJson = path.join(dir, 'bad.json')
    writeFileSync(badJson, '{not json', 'utf8')
    expect(runCli(['--config', badJson]).status).toBe(1)

    const noDaemon = path.join(dir, 'no-daemon.json')
    writeFileSync(noDaemon, JSON.stringify({ health: { url: 'http://127.0.0.1:8788/healthz' }, paths: { logDir: dir } }), 'utf8')
    const missing = runCli(['--config', noDaemon])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('daemon')

    const badUrl = path.join(dir, 'bad-url.json')
    writeFileSync(
      badUrl,
      JSON.stringify({ daemon: { command: ['node'], cwd: dir }, health: { url: 'ftp://x' }, paths: { logDir: dir } }),
      'utf8',
    )
    const urlResult = runCli(['--config', badUrl])
    expect(urlResult.status).toBe(1)
    expect(urlResult.stderr).toContain('health.url')
  })
})

describe('guardian bad-command（spawn ENOENT；F1 回归）', () => {
  it('坏命令：记 spawn-error 告警＋退避重试，进程不崩溃；SIGTERM 可正常退出', async () => {
    const dir = tempDir()
    const configPath = path.join(dir, 'guardian.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        daemon: { command: [path.join(dir, 'no-such-daemon-binary-xyz')], cwd: dir },
        health: { url: 'http://127.0.0.1:9/healthz', intervalMs: 50, timeoutMs: 50, failuresBeforeRestart: 1, startupGraceMs: 10 },
        restart: { initialBackoffMs: 50, maxBackoffMs: 100, multiplier: 2, stopGraceMs: 100 },
        crashLoop: { windowMs: 5_000, maxRestarts: 3, brakeMs: 200 },
        paths: { logDir: dir },
      }),
      'utf8',
    )
    const child = spawn(process.execPath, [GUARDIAN, '--config', configPath], { stdio: 'ignore' })
    await waitForGuardianEvent(path.join(dir, 'guardian.jsonl'), 'guardian-start')
    await new Promise((resolve) => setTimeout(resolve, 800))
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) => child.once('exit', (value) => resolve(value)))
    expect(code).toBe(0)
    const logPath = path.join(dir, 'guardian.jsonl')
    expect(existsSync(logPath)).toBe(true)
    const events = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string })
    expect(events.some((line) => line.event === 'spawn-error')).toBe(true)
    expect(events.some((line) => line.event === 'restart-scheduled')).toBe(true)
    expect(events.some((line) => line.event === 'guardian-stop')).toBe(true)
    // 不崩溃的旁证：launchd 视角下进程存活到 SIGTERM（未提前以非 0 退出），且无 pidFile 伪造
    expect(existsSync(path.join(dir, 'daemon.pid'))).toBe(false)
  }, 10_000)
})

describe('部署隔离 preflight（ref=708：部署树不干净/漂移则拒绝起 daemon）', () => {
  function writePreflightConfig(dir: string, daemonExtra: Record<string, unknown>): string {
    const configPath = path.join(dir, 'guardian-pf.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        daemon: { command: ['/usr/bin/true'], cwd: dir, ...daemonExtra },
        health: { url: 'http://127.0.0.1:9/healthz', intervalMs: 50, timeoutMs: 50, failuresBeforeRestart: 1, startupGraceMs: 10 },
        restart: { initialBackoffMs: 50, maxBackoffMs: 100, multiplier: 2, stopGraceMs: 100 },
        crashLoop: { windowMs: 5_000, maxRestarts: 3, brakeMs: 200 },
        paths: { logDir: dir },
      }),
      'utf8',
    )
    return configPath
  }

  function readGuardianEvents(logPath: string): { event: string }[] {
    return readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string })
  }

  it('配置校验：daemon.preflight 非字符串数组 → exit 1 并明报', () => {
    const dir = tempDir()
    const configPath = path.join(dir, 'guardian-pf-bad.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        daemon: { command: ['/usr/bin/true'], cwd: dir, preflight: 'not-an-array' },
        health: { url: 'http://127.0.0.1:9/healthz' },
        paths: { logDir: dir },
      }),
      'utf8',
    )
    const result = runCli(['--config', configPath])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('daemon.preflight')
  })

  it('preflight 失败：不 spawn daemon，记 preflight-failed 并重试（fail-closed）', async () => {
    const dir = tempDir()
    const configPath = writePreflightConfig(dir, { preflight: ['/usr/bin/false'], preflightRetryMs: 200 })
    const child = spawn(process.execPath, [GUARDIAN, '--config', configPath], { stdio: 'ignore' })
    await waitForGuardianEvent(path.join(dir, 'guardian.jsonl'), 'preflight-failed')
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) => child.once('exit', (value) => resolve(value)))
    expect(code).toBe(0)
    const events = readGuardianEvents(path.join(dir, 'guardian.jsonl'))
    expect(events.filter((line) => line.event === 'preflight-failed').length).toBeGreaterThanOrEqual(1)
    expect(events.some((line) => line.event === 'daemon-start')).toBe(false)
    expect(events.some((line) => line.event === 'preflight-ok')).toBe(false)
  }, 10_000)

  it('preflight 成功：先 preflight-ok 才 daemon-start', async () => {
    const dir = tempDir()
    const configPath = writePreflightConfig(dir, { preflight: ['/usr/bin/true'] })
    const child = spawn(process.execPath, [GUARDIAN, '--config', configPath], { stdio: 'ignore' })
    await waitForGuardianEvent(path.join(dir, 'guardian.jsonl'), 'daemon-start')
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) => child.once('exit', (value) => resolve(value)))
    expect(code).toBe(0)
    const events = readGuardianEvents(path.join(dir, 'guardian.jsonl'))
    const preflightOkIndex = events.findIndex((line) => line.event === 'preflight-ok')
    const daemonStartIndex = events.findIndex((line) => line.event === 'daemon-start')
    expect(preflightOkIndex).toBeGreaterThanOrEqual(0)
    expect(daemonStartIndex).toBeGreaterThanOrEqual(0)
    expect(preflightOkIndex).toBeLessThan(daemonStartIndex)
  }, 10_000)
})

/** 异步跑 guardian CLI（需与父进程内假 healthz 服务器并行；spawnSync 会阻塞事件循环） */
function runGuardianAsync(configPath: string, runMs: number): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GUARDIAN, '--config', configPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const hardTimeoutMs = runMs + 20_000
    const hardTimer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`guardian 未在预期时间内退出（${String(hardTimeoutMs)}ms）`))
    }, hardTimeoutMs)
    // 高负载下 node 启动可能 >1s：先等 guardian-start（信号 handler 已就绪）再计时/发 SIGTERM
    void waitForGuardianEvent(path.join(configPath, '..', 'guardian.jsonl'), 'guardian-start')
      .catch(() => undefined)
      .then(() => new Promise<void>((done) => setTimeout(done, runMs)))
      .then(() => child.kill('SIGTERM'))
      .catch(() => undefined)
    child.once('exit', (status) => {
      clearTimeout(hardTimer)
      resolve({ status, stdout, stderr })
    })
    child.once('error', (err) => {
      clearTimeout(hardTimer)
      reject(err)
    })
  })
}

/** 假 healthz 服务器：按 steps 顺序返回，用尽后重复最后一步 */
function startFakeHealth(steps: Array<{ status?: number; body?: unknown }>): Promise<{ url: string; close: () => Promise<void> }> {
  let index = 0
  const server = createServer((_req, res) => {
    const step = steps[Math.min(index, steps.length - 1)] ?? { body: { ok: true, pid: 1 } }
    index += 1
    res.statusCode = step.status ?? 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(step.body ?? {}))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `http://127.0.0.1:${port}/healthz`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            setTimeout(done, 2_000)
          }),
      })
    })
  })
}

interface LevelEvent {
  level: string
  event: string
  kind?: string
  consecutiveFailures?: number
  threshold?: number
}

function readLevelEvents(logPath: string): LevelEvent[] {
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LevelEvent)
}

function writeGuardianConfig(dir: string, overrides: Record<string, unknown>): string {
  const configPath = path.join(dir, 'guardian-levels.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      daemon: { command: ['/bin/sleep', '30'], cwd: dir },
      health: { url: 'http://127.0.0.1:9/healthz', intervalMs: 100, timeoutMs: 300, failuresBeforeRestart: 3, startupGraceMs: 10 },
      restart: { initialBackoffMs: 50, maxBackoffMs: 100, multiplier: 2, stopGraceMs: 200 },
      crashLoop: { windowMs: 5_000, maxRestarts: 3, brakeMs: 200 },
      paths: { logDir: dir },
      ...overrides,
    }),
    'utf8',
  )
  return configPath
}

describe('734 级别分级与瞬态去重（guardian.jsonl 观测面）', () => {
  it('正常事件全是 info/warn，无 error（旧实现 142/142 全 error）', async () => {
    const dir = tempDir()
    const configPath = writeGuardianConfig(dir, { daemon: { command: ['/usr/bin/true'], cwd: dir } })
    await runGuardianAsync(configPath, 1_200)
    const events = readLevelEvents(path.join(dir, 'guardian.jsonl'))
    const start = events.find((event) => event.event === 'guardian-start')
    const daemonStart = events.find((event) => event.event === 'daemon-start')
    expect(start?.level).toBe('info')
    expect(daemonStart?.level).toBe('info')
    // 正常生命周期事件不得 error（734 验收）
    for (const event of events) {
      if (['guardian-start', 'guardian-stop', 'daemon-start', 'preflight-ok'].includes(event.event)) expect(event.level).not.toBe('error')
    }
    // 子进程退出→重启调度类=warn（非 error；/usr/bin/true 立刻退出故无 daemon-stop 行）
    expect(events.find((event) => event.event === 'restart-scheduled')?.level).toBe('warn')
  }, 30_000)

  it('单次 probe 失败=warn（kind=timeout/http 可判）＋恢复补 info，不触发重启', async () => {
    const dir = tempDir()
    const fake = await startFakeHealth([{ status: 500, body: { ok: false, reasons: ['probe-timeout-sim'] } }, { body: { ok: true, pid: 999 } }])
    try {
      const configPath = writeGuardianConfig(dir, {
        health: { url: fake.url, intervalMs: 100, timeoutMs: 2_000, failuresBeforeRestart: 3, startupGraceMs: 10 },
      })
      await runGuardianAsync(configPath, 3_000)
      const events = readLevelEvents(path.join(dir, 'guardian.jsonl'))
      const failures = events.filter((event) => event.event === 'health-fail')
      const recovered = events.filter((event) => event.event === 'health-recovered')
      expect(failures).toHaveLength(1) // 去重：streak 首次只记一条
      expect(failures[0]?.level).toBe('warn') // 734：transient probe timeout 不误报 error
      expect(failures[0]?.consecutiveFailures).toBe(1)
      expect(['http', 'timeout', 'network']).toContain(String(failures[0]?.kind))
      expect(recovered).toHaveLength(1)
      expect(recovered[0]?.level).toBe('info')
      expect(events.some((event) => event.event === 'health-fail-restart')).toBe(false)
    } finally {
      await fake.close()
    }
  }, 30_000)

  it('连续失败达阈值→一条 error（health-fail-restart）且重启语义不变（daemon-stop/restart-scheduled 仍在）', async () => {
    const dir = tempDir()
    const fake = await startFakeHealth([{ status: 500, body: { ok: false } }])
    try {
      const configPath = writeGuardianConfig(dir, {
        health: { url: fake.url, intervalMs: 100, timeoutMs: 2_000, failuresBeforeRestart: 2, startupGraceMs: 10 },
      })
      await runGuardianAsync(configPath, 4_000)
      const events = readLevelEvents(path.join(dir, 'guardian.jsonl'))
      const restarts = events.filter((event) => event.event === 'health-fail-restart')
      const failures = events.filter((event) => event.event === 'health-fail')
      expect(restarts.length).toBeGreaterThanOrEqual(1)
      expect(restarts[0]?.level).toBe('error')
      expect(restarts[0]?.threshold).toBe(2)
      // 去重不变量：每条 streak 恰一条 warn + 一条 error
      expect(failures.length).toBe(restarts.length)
      // 重启语义不变：既有 daemon-stop / restart-scheduled 事件仍在（级别 warn）
      expect(events.some((event) => event.event === 'daemon-stop')).toBe(true)
      expect(events.some((event) => event.event === 'restart-scheduled')).toBe(true)
    } finally {
      await fake.close()
    }
  }, 30_000)
})
