/**
 * stop-channel —— 控制面停机通道单元测试（DEV-9 顺带项）
 *
 * 协议面与 reload 手动通道同款（src/hot-reload.ts 控制面文件通道）：
 *   - 原子写（tmp+rename）／坏 JSON 当不存在（不当停机，下拍再看）
 *   - 幂等位：daemon 按 lastSeenId 去重；回执按 id 匹配消费（旧回执不误读）
 *   - CLI 轮询超时面（daemon 不在跑）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  awaitStopResult,
  readStopRequest,
  STOP_REQUEST_FILE,
  STOP_RESULT_FILE,
  writeStopRequest,
  writeStopResult,
} from '../src/stop-channel.ts'

let root = ''
const control = (): string => path.join(root, 'control')

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-stop-channel-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('控制面停机通道（DEV-9 顺带项：文件协议）', () => {
  it('写请求→读请求：原子落盘、字段完整、reason 可选', () => {
    writeStopRequest(root, { id: 'stop-001', requestedAt: 123, reason: 'DEV-9 演习' })
    expect(existsSync(path.join(control(), STOP_REQUEST_FILE))).toBe(true)
    expect(readStopRequest(root)).toEqual({ id: 'stop-001', requestedAt: 123, reason: 'DEV-9 演习' })
    writeStopRequest(root, { id: 'stop-002', requestedAt: 456 })
    expect(readStopRequest(root)).toEqual({ id: 'stop-002', requestedAt: 456 })
  })

  it('daemon 幂等位：lastSeenId 去重（同请求不重复停机）', () => {
    writeStopRequest(root, { id: 'stop-003', requestedAt: 789 })
    const seen = readStopRequest(root)
    expect(seen?.id).toBe('stop-003')
    // 已应答（lastSeen=stop-003）→ 再读同 id 不再触发（serve 侧 `id !== lastSeen` 判定）
    expect(readStopRequest(root)?.id === 'stop-003').toBe(true)
  })

  it('回执按 id 匹配消费：旧回执不误读，新请求得新回执', async () => {
    writeStopResult(root, { id: 'stop-004', ok: true, stopped: true, detail: '旧回执' })
    // 旧 id 立即命中
    expect((await awaitStopResult(root, 'stop-004', 50))?.stopped).toBe(true)
    // 新 id 对旧回执：不误读——超时面（daemon 未写新回执）
    expect(await awaitStopResult(root, 'stop-005', 150)).toBeUndefined()
    writeStopResult(root, { id: 'stop-005', ok: true, stopped: true })
    expect((await awaitStopResult(root, 'stop-005', 50))?.id).toBe('stop-005')
  })

  it('坏 JSON 防御：请求/回执文件损坏 → 当不存在/超时，不炸不误停', async () => {
    writeFileSync(path.join(control(), STOP_REQUEST_FILE), '{oops', 'utf8')
    expect(readStopRequest(root)).toBeUndefined()
    writeFileSync(path.join(control(), STOP_RESULT_FILE), '{oops', 'utf8')
    expect(await awaitStopResult(root, 'any-id', 100)).toBeUndefined()
  })

  it('回执内容如实透传（detail=优雅停收口证据面）', () => {
    writeStopResult(root, {
      id: 'stop-006',
      ok: true,
      stopped: true,
      detail: '优雅停收口完成：ticks=42（停唤起源→在途 drain→worker 整树杀→台账落盘）',
    })
    const raw = JSON.parse(readFileSync(path.join(control(), STOP_RESULT_FILE), 'utf8')) as {
      id: string
      stopped: boolean
    }
    expect(raw.id).toBe('stop-006')
    expect(raw.stopped).toBe(true)
  })
})

describe('spawn 冒烟：studio-next stop（控制面优雅停，真 bin 进程端到端）', () => {
  it('serve 起真进程 → stop 写请求 → daemon 拍边界优雅停（exit 0）→ 回执落盘 → CLI exit 0', async () => {
    const { spawn } = await import('node:child_process')
    const { mkdirSync } = await import('node:fs')
    const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/bin.ts')
    const dir = path.join(root, 'stop-smoke')
    mkdirSync(dir, { recursive: true })
    const dbPath = path.join(dir, 'ledger.sqlite')
    const configPath = path.join(dir, 'daemon.yaml')
    writeFileSync(
      configPath,
      [`db: ${dbPath}`, 'platform: fake', 'company: demo', `rootDir: ${dir}`, 'tickMs: 150'].join('\n'),
      'utf8',
    )

    // daemon 真进程（fake 全家桶零外部依赖）
    const daemon = spawn(process.execPath, [bin, 'serve', '--config', configPath], { encoding: 'utf8' })
    let daemonOut = ''
    daemon.stdout.on('data', (d: string) => {
      daemonOut += d
    })
    const daemonExit = new Promise<number | null>((resolve) => {
      daemon.once('exit', (code) => resolve(code))
    })
    // 等首拍（daemon 起来、拍边界通道就绪）
    const up = Date.now() + 15_000
    while (Date.now() < up && !/已启动|tick#1\b/.test(daemonOut)) {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(daemonOut).toMatch(/studio-next daemon 启动/)

    // CLI 真进程发停机请求（与 daemon 同 rootDir——工位根发现序：--root）
    const cli = spawn(process.execPath, [bin, 'stop', '--root', dir, '--timeout', '10000', '--reason', 'DEV-9 演习'], {
      encoding: 'utf8',
    })
    let cliOut = ''
    let cliErr = ''
    cli.stdout.on('data', (d: string) => {
      cliOut += d
    })
    cli.stderr.on('data', (d: string) => {
      cliErr += d
    })
    const cliExit = new Promise<number | null>((resolve) => {
      cli.once('exit', (code) => resolve(code))
    })

    const [cliCode, daemonCode] = await Promise.all([cliExit, daemonExit])
    expect(cliCode).toBe(0)
    expect(cliOut).toContain('回执 ok')
    expect(cliOut).toContain('已优雅停')
    // daemon：控制面请求日志 + 优雅停收口 + exit 0（stop-request 面——非信号非错误）
    expect(daemonOut).toContain('控制面停机请求')
    expect(daemonOut).toContain('已优雅关闭')
    expect(daemonCode).toBe(0)
    // 回执文件落盘（id 匹配；stopped=true 证据面）
    const receipt = JSON.parse(readFileSync(path.join(dir, 'control', STOP_RESULT_FILE), 'utf8')) as {
      id: string
      ok: boolean
      stopped: boolean
    }
    expect(receipt.ok).toBe(true)
    expect(receipt.stopped).toBe(true)
    // stderr 无真错误（node>=22.5 的 SQLite ExperimentalWarning 属环境噪音，滤后断言空）
    const cliErrSignal = cliErr
      .split('\n')
      .filter((l) => l !== '' && !/ExperimentalWarning: SQLite|trace-warnings/.test(l))
      .join('\n')
    expect(cliErrSignal).toBe('')
    expect(existsSync(path.join(dir, 'control', STOP_REQUEST_FILE))).toBe(true)
  })
})
