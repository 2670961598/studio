/**
 * 守护核单测（studio-dev-697；docs/90-§一/§三/§五）
 *
 * 覆盖：指数退避封顶、crash-loop 判定、健康响应判据、探测失败不抛（结构化）、告警形状、
 * 参数解析（core 纯件单点）；guardian 脚本 CLI fail-fast（--help/缺配置/坏配置 exit 码；
 * 脚本本体不 import 业务包——用子进程从外部验，避免跨包相对引用）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GUARDIAN_DEFAULTS,
  buildGuardianAlert,
  classifyHealth,
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
    expect(alert.level).toBe('error')
    expect(alert.event).toBe('health-fail')
    expect(alert.pid).toBe(1)
    const healthy = buildGuardianAlert('healthy', {})
    expect(healthy.level).toBe('info')
    expect(GUARDIAN_DEFAULTS.crashLoop.maxRestarts).toBe(5)
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
    await new Promise((resolve) => setTimeout(resolve, 1_500))
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
