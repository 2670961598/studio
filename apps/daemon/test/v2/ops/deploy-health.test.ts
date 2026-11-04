/**
 * deploy-health 部署成功判定（studio-dev-717，P1；子进程验证——沿用 guardian.test.ts 先例，
 * 测试不跨包 import scripts/，避免 BC-H2 相对引用越界）。
 *
 * 覆盖：
 *   1) 假成功窗口：旧 daemon 仍 200/ok=true 但 pid==部署前 pid → 不得判成功（717 事故现场）；
 *   2) 正常替换（旧→新 pid）→ 成功且 pid 正确；
 *   3) writer-lease 重启竞态：healthz 不可达过渡态继续等，新 daemon 起来后成功；
 *   4) 部署前 daemon 未运行（previousPid=none）→ 首个健康 daemon 视为替换完成；
 *   5) 超时（旧 pid 一直挡着）→ exit 2 + replaced=false + reason=still-previous-pid；
 *   6) HTTP 503/坏体/pid 缺失 → 不判成功（--once 口径可见）。
 */
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const HEALTH = path.join(process.cwd(), 'scripts', 'ops', 'deploy-health.mjs')
const servers: Server[] = []

/** 关停所有假 daemon 并**等 close 完成**（避免端口竞态：测试内切端口后立即复用） */
async function closeAllServers(): Promise<void> {
  const all = servers.splice(0)
  await Promise.all(
    all.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          setTimeout(resolve, 2_000) // 防御：极少数情况 close 回调不触发也不卡测试
        }),
    ),
  )
}

afterEach(async () => {
  await closeAllServers()
})

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

/** 起一个按顺序返回健康响应的假 daemon（用尽后重复最后一步） */
function startFakeDaemon(steps: Array<{ status?: number; body?: unknown }>): Promise<{ url: string; hits: () => number }> {
  let index = 0
  const server = createServer((_req, res) => {
    const step = steps[Math.min(index, steps.length - 1)] ?? { body: { ok: true, pid: 1 } }
    index += 1
    res.statusCode = step.status ?? 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(step.body ?? {}))
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({ url: `http://127.0.0.1:${port}/healthz`, hits: () => index })
    })
  })
}

function runHealthCli(args: string[], timeoutMs = 15_000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HEALTH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`deploy-health CLI 超时（${String(timeoutMs)}ms）`))
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>
}

describe('假成功窗口（717 事故现场：旧 daemon 仍应答）', () => {
  it('--once：旧 pid 仍 200/ok=true → kind=previous-pid、exit 2（不假成功）', async () => {
    const daemon = await startFakeDaemon([{ body: { ok: true, pid: 53665 } }])
    const result = await runHealthCli(['--once', '--json', '--url', daemon.url, '--previous-pid', '53665'])
    expect(result.status).toBe(2)
    const payload = parseJson(result.stdout)
    expect(payload.kind).toBe('previous-pid')
    expect(payload.pid).toBe(53665)
  })

  it('--wait：旧 pid 前两次应答 → 新 pid 出现才 exit 0（不再 81ms 假成功）', async () => {
    const daemon = await startFakeDaemon([
      { body: { ok: true, pid: 53665 } },
      { body: { ok: true, pid: 53665 } },
      { body: { ok: true, pid: 61234 } },
    ])
    const result = await runHealthCli([
      '--wait', '--json', '--url', daemon.url, '--previous-pid', '53665', '--timeout-ms', '5000', '--interval-ms', '100',
    ])
    expect(result.status).toBe(0)
    const payload = parseJson(result.stdout)
    expect(payload.replaced).toBe(true)
    expect(payload.pid).toBe(61234)
    expect(payload.previousPid).toBe(53665)
    expect(daemon.hits()).toBeGreaterThanOrEqual(3)
  })
})

describe('writer-lease 重启竞态（过渡态=不可达，继续等）', () => {
  it('过渡态（503/不可达）继续等：非首轮即判，新 pid 出现才 exit 0', async () => {
    // 确定性模拟 writer-lease 窗口的「过渡态」：前两轮 503（新 daemon 尚未通过 /healthz 健康判据），
    // 第三轮起新 pid 200——验证等待循环继续重试，不会首轮即判/超时误报。
    const daemon = await startFakeDaemon([
      { status: 503, body: { ok: false, reasons: ['tick-not-advancing'] } },
      { status: 503, body: { ok: false, reasons: ['tick-not-advancing'] } },
      { body: { ok: true, pid: 60002 } },
    ])
    const result = await runHealthCli([
      '--wait', '--json', '--url', daemon.url, '--previous-pid', '53665', '--timeout-ms', '8000', '--interval-ms', '100',
    ])
    expect(result.status).toBe(0)
    const payload = parseJson(result.stdout)
    expect(payload.replaced).toBe(true)
    expect(payload.pid).toBe(60002)
    const observations = payload.observations as Array<{ kind: string; reason: string | null }>
    expect(observations[0]?.kind).toBe('not-ready')
    expect(observations[0]?.reason).toBe('http-503')
    expect(observations.some((o) => o.kind === 'ok')).toBe(true)
  })

  it('不可达（连接拒绝）→ --once 判 not-ready/unreachable（确定性：端口无监听）', async () => {
    // 取一个先占后关的端口（无人监听；ECONNREFUSED 立即返回，无计时竞态）
    const probe = await startFakeDaemon([{ body: { ok: true, pid: 1 } }])
    const port = Number(new URL(probe.url).port)
    await closeAllServers()
    const result = await runHealthCli(['--once', '--json', '--url', `http://127.0.0.1:${port}/healthz`, '--previous-pid', '53665'])
    expect(result.status).toBe(2)
    const payload = parseJson(result.stdout)
    expect(payload.kind).toBe('not-ready')
    expect(String(payload.reason)).toContain('unreachable')
  })

  it('部署前 daemon 未运行（--previous-pid none）→ 首个健康 daemon 视为替换完成', async () => {
    const daemon = await startFakeDaemon([{ body: { ok: true, pid: 12345 } }])
    const result = await runHealthCli(['--wait', '--json', '--url', daemon.url, '--previous-pid', 'none', '--timeout-ms', '3000', '--interval-ms', '100'])
    expect(result.status).toBe(0)
    const payload = parseJson(result.stdout)
    expect(payload.replaced).toBe(true)
    expect(payload.pid).toBe(12345)
    expect(payload.previousPid).toBeNull()
  })
})

describe('异常面（不谎报成功）', () => {
  it('--once：HTTP 503 / body-not-ok / pid 缺失 → kind=not-ready、exit 2', async () => {
    const cases: Array<{ step: { status?: number; body?: unknown }; reason: string }> = [
      { step: { status: 503, body: { ok: false } }, reason: 'http-503' },
      { step: { body: { ok: false } }, reason: 'body-not-ok' },
      { step: { body: { ok: true } }, reason: 'body-pid-missing' },
    ]
    for (const item of cases) {
      const daemon = await startFakeDaemon([item.step])
      const result = await runHealthCli(['--once', '--json', '--url', daemon.url, '--previous-pid', '100'])
      expect(result.status).toBe(2)
      const payload = parseJson(result.stdout)
      expect(payload.kind).toBe('not-ready')
      expect(payload.reason).toBe(item.reason)
    }
  })

  it('--wait 超时（旧 pid 一直挡着）→ exit 2、replaced=false、reason=still-previous-pid（供 deploy.mjs 报错）', async () => {
    const daemon = await startFakeDaemon([{ body: { ok: true, pid: 1 } }])
    const result = await runHealthCli(['--wait', '--json', '--url', daemon.url, '--previous-pid', '1', '--timeout-ms', '400', '--interval-ms', '100'])
    expect(result.status).toBe(2)
    const payload = parseJson(result.stdout)
    expect(payload.replaced).toBe(false)
    expect(payload.reason).toBe('still-previous-pid')
    expect(String(payload.summary)).toContain('previous-pid=1')
  })
})
