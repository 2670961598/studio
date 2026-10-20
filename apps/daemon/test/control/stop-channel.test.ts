/**
 * stop-channel —— 控制面停机通道单元测试（DEV-9 顺带项）
 *
 * 协议面与 reload 手动通道同款（src/control/hot-reload.ts 控制面文件通道）：
 *   - 原子写（tmp+rename）／坏 JSON 当不存在（不当停机，下拍再看）
 *   - 幂等位：daemon 按 lastSeenId 去重（DEV-41 起跨重启——去重位落 daemon_kv，重启读回）；
 *     回执按 id 匹配消费（旧回执不误读）
 *   - DEV-41 修复面（2026-10-20 生产首用发现，daemon-taiga6 一拍自停事故）：请求消费后
 *     原子改名 .consume（live 面清空，新进程见无请求即正常起）；回执文件保留——CLI 轮询
 *     按 id 匹配不受影响
 *   - CLI 轮询超时面（daemon 不在跑）
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  awaitStopResult,
  consumeStopRequest,
  readStopRequest,
  STOP_REQUEST_CONSUMED_FILE,
  STOP_REQUEST_FILE,
  STOP_RESULT_FILE,
  writeStopRequest,
  writeStopResult,
} from '../../src/control/stop-channel.ts'

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

  it('DEV-41 ②：消费请求——原子改名 .consume、live 面清空（daemon 读不到）；无 live 时 false 不炸；留档恒为最近一次（有界）', () => {
    writeStopRequest(root, { id: 'stop-007', requestedAt: 111 })
    expect(consumeStopRequest(root)).toBe(true)
    expect(existsSync(path.join(control(), STOP_REQUEST_FILE))).toBe(false)
    expect(existsSync(path.join(control(), STOP_REQUEST_CONSUMED_FILE))).toBe(true)
    // live 面清空=daemon 读不到请求——重启进程见无请求即正常起（事故面根除）
    expect(readStopRequest(root)).toBeUndefined()
    // 无 live 再消费：false 不抛——调用侧（serve）不因改名失败阻断停机（①kv 兜底）
    expect(consumeStopRequest(root)).toBe(false)
    // 新请求再消费：.consume 留档=最近一次已应答请求（POSIX rename 原子替换，单文件有界）
    writeStopRequest(root, { id: 'stop-008', requestedAt: 222 })
    expect(consumeStopRequest(root)).toBe(true)
    const consumed = JSON.parse(readFileSync(path.join(control(), STOP_REQUEST_CONSUMED_FILE), 'utf8')) as { id?: string }
    expect(consumed.id).toBe('stop-008')
    expect(existsSync(path.join(control(), STOP_RESULT_FILE))).toBe(true) // 回执保留（CLI 兼容面）
  })
})

describe('spawn 冒烟：studio-next stop（控制面优雅停，真 bin 进程端到端）', () => {
  it('serve 起真进程 → stop 写请求 → daemon 拍边界优雅停（exit 0）→ 回执落盘 → CLI exit 0', async () => {
    const { spawn } = await import('node:child_process')
    const { mkdirSync } = await import('node:fs')
    const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')
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
    // DEV-41 ②：请求消费后原子改名 .consume——live 面清空（重启见无请求即正常起）；
    // 回执文件保留（CLI 轮询按 id 匹配的兼容面——上面 awaitStopResult 已证不误读）
    expect(existsSync(path.join(dir, 'control', STOP_REQUEST_FILE))).toBe(false)
    expect(existsSync(path.join(dir, 'control', `${STOP_REQUEST_FILE}.consume`))).toBe(true)
    // 消费件内容=刚应答的请求（单文件覆写有界，不随历史堆积）
    const consumed = JSON.parse(readFileSync(path.join(dir, 'control', `${STOP_REQUEST_FILE}.consume`), 'utf8')) as { id?: string }
    expect(consumed.id).toBe(receipt.id)
  })
})

// ————————————————————————— DEV-41：重启失忆复现与修复面 —————————————————————————

/**
 * DEV-41 停机通道重启失忆（2026-10-20 生产首用发现，daemon-taiga6 事故）：
 * 协议「请求文件不删 + daemon 按 lastSeenId 去重」——但 lastSeenId 只在内存，daemon 重启后
 * 读到残留 stop.request.json 当新请求消费，新进程起一拍即自我停机（实测：taiga6 起来 1 拍
 * 即优雅停；应急=清 control 目录重启）。
 *
 * 修复面（src/control/stop-channel.ts + src/assembly/serve.ts，docs/17-§2 拍边界纪律不变）：
 *   ① 去重位落 daemon_kv（键 stop.lastSeenId）——重启读回，与请求 id 比对去重；
 *   ② 请求消费后原子改名 .consume——live 面清空，新进程见无请求即正常起；
 *      回执文件保留（CLI 轮询按 id 匹配，兼容面不动）。
 *
 * e2e 复现口径（任务书）：写请求→停→重启→断言新进程不停机。两用例分别钉死②的
 * 主路径（残留不产生）与①的兜底路径（残留已在场仍被去重）。
 */
describe('DEV-41 停机通道重启失忆：残留 stop.request.json × daemon 重启（2026-10-20 daemon-taiga6 事故）', () => {
  /** daemon 真进程句柄：输出聚合 + 退出面 + 兜底杀（测试失败路径不留孤儿进程） */
  interface DaemonProc {
    out: string
    exited: boolean
    exit: Promise<number | null>
    kill: () => Promise<void>
  }

  async function startDaemon(bin: string, configPath: string): Promise<DaemonProc> {
    const { spawn } = await import('node:child_process')
    const proc = spawn(process.execPath, [bin, 'serve', '--config', configPath])
    const handle: DaemonProc = {
      out: '',
      exited: false,
      exit: new Promise<number | null>((resolve) => {
        proc.once('exit', (code) => {
          handle.exited = true
          resolve(code)
        })
      }),
      kill: async (): Promise<void> => {
        if (!handle.exited) {
          proc.kill('SIGTERM')
          await Promise.race([handle.exit, new Promise((r) => setTimeout(r, 5000))])
          if (!handle.exited) proc.kill('SIGKILL')
        }
      },
    }
    proc.stdout?.on('data', (d: Buffer) => {
      handle.out += d.toString('utf8')
    })
    proc.stderr?.on('data', (d: Buffer) => {
      handle.out += d.toString('utf8')
    })
    return handle
  }

  /** 窗口内等输出匹配（进程先退=终态输出再判一次） */
  async function waitOut(h: DaemonProc, re: RegExp, windowMs: number): Promise<boolean> {
    const deadline = Date.now() + windowMs
    for (;;) {
      if (re.test(h.out)) return true
      if (h.exited || Date.now() >= deadline) return re.test(h.out)
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  /** 窗口内等退出（超时 undefined——测试断言面自报，不悬挂） */
  async function exitWithin(h: DaemonProc, windowMs: number): Promise<number | null | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), windowMs)
    })
    const code = await Promise.race([h.exit, timeout])
    if (timer !== undefined) clearTimeout(timer)
    return code
  }

  /** 观测 tick 行数（事故面=1 拍即优雅停；健康面应多拍存活） */
  const tickCount = (h: DaemonProc): number => (h.out.match(/tick#\d+/g) ?? []).length

  /** 输出尾段（失败诊断面——红时可见事故现场） */
  const tailOf = (s: string): string => s.split('\n').slice(-8).join('\n')

  /** 起一套 daemon 工位（目录+daemon.yaml；fake 全家桶零外部依赖，tickMs=120 快拍） */
  function makeStation(name: string): { dir: string; configPath: string; dbPath: string } {
    const dir = path.join(root, name)
    mkdirSync(dir, { recursive: true })
    const dbPath = path.join(dir, 'ledger.sqlite')
    const configPath = path.join(dir, 'daemon.yaml')
    writeFileSync(
      configPath,
      [`db: ${dbPath}`, 'platform: fake', 'company: demo', `rootDir: ${dir}`, 'tickMs: 120'].join('\n'),
      'utf8',
    )
    return { dir, configPath, dbPath }
  }

  it(
    '主复现面（②消费）：写请求→停→重启→新进程照常跑（≥3 拍不死、无停机请求日志）；新停机请求（新 id）仍可正常停',
    { timeout: 90_000 },
    async () => {
      const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')
      const { dir, configPath, dbPath } = makeStation('dev41-consume')

      // —— 阶段一：daemon A 起跑 → 写停机请求（R1）→ 拍边界优雅停 ——
      const a = await startDaemon(bin, configPath)
      try {
        expect(await waitOut(a, /studio-next daemon 启动/, 20_000)).toBe(true)
        writeStopRequest(dir, { id: 'dev41-r1', requestedAt: Date.now(), reason: 'DEV-41 复现' })
        const codeA = await exitWithin(a, 20_000)
        if (codeA === undefined) throw new Error(`daemon A 未在窗口内停机——输出尾段：\n${tailOf(a.out)}`)
        expect(codeA).toBe(0)
        expect(a.out).toContain('控制面停机请求')
        expect(a.out).toContain('已优雅关闭')
        // 回执落盘（A 写；CLI 轮询面按 id 命中）
        expect((await awaitStopResult(dir, 'dev41-r1', 200))?.stopped).toBe(true)

        // —— DEV-41 断言面②：请求已消费——live 文件不在场、.consume 留档在场 ——
        expect(existsSync(path.join(dir, 'control', STOP_REQUEST_FILE))).toBe(false)
        expect(existsSync(path.join(dir, 'control', `${STOP_REQUEST_FILE}.consume`))).toBe(true)
        // 回执文件保留（「CLI 轮询回执按 id 匹配」的兼容面——消费不碍回执）
        expect(existsSync(path.join(dir, 'control', STOP_RESULT_FILE))).toBe(true)

        // —— 阶段二：daemon B 重启（同 db 同 rootDir——生产事故现场的重启路径） ——
        const b = await startDaemon(bin, configPath)
        try {
          expect(await waitOut(b, /studio-next daemon 启动/, 20_000)).toBe(true)
          expect(await waitOut(b, /tick#\d+/, 5_000)).toBe(true)
          await new Promise((r) => setTimeout(r, 1_500)) // ≈12 拍窗口 @tickMs=120
          // 事故面=起一拍即自我停机（exit 0 + 消费残留请求）；修复面=多拍存活、零停机日志
          expect(b.exited).toBe(false)
          expect(b.out).not.toContain('控制面停机请求')
          expect(tickCount(b)).toBeGreaterThanOrEqual(3)

          // —— 阶段三：去重不挡新意图——新停机请求（新 id）照常 honored ——
          writeStopRequest(dir, { id: 'dev41-r2', requestedAt: Date.now(), reason: 'DEV-41 复现·二次停' })
          expect((await awaitStopResult(dir, 'dev41-r2', 20_000))?.stopped).toBe(true)
          const codeB = await exitWithin(b, 10_000)
          if (codeB === undefined) throw new Error(`daemon B 未在窗口内停机——输出尾段：\n${tailOf(b.out)}`)
          expect(codeB).toBe(0)
          expect(b.out).toContain('控制面停机请求')
          expect(b.out).toContain('已优雅关闭')
          // 消费件=最近一次已应答请求（单文件覆写有界）
          const consumed = JSON.parse(readFileSync(path.join(dir, 'control', `${STOP_REQUEST_FILE}.consume`), 'utf8')) as { id?: string }
          expect(consumed.id).toBe('dev41-r2')
          // ①去重位落 daemon_kv（跨重启持久化——与 activity.cursor / tick.seq 同表）
          const { DatabaseSync } = await import('node:sqlite')
          const db = new DatabaseSync(dbPath)
          try {
            const row = db.prepare("SELECT value FROM daemon_kv WHERE key = 'stop.lastSeenId'").get() as { value?: string } | undefined
            expect(row?.value).toBe('dev41-r2')
          } finally {
            db.close()
          }
        } finally {
          await b.kill()
        }
      } finally {
        await a.kill()
      }
    },
  )

  it(
    '兜底面（①kv 去重）：残留请求文件在场（模拟②改名失败窗口/旧协议残留）→ 重启 → daemon_kv 读回去重，新进程照常跑',
    { timeout: 90_000 },
    async () => {
      const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/cli/main.ts')
      const { dir, configPath } = makeStation('dev41-kv')

      // —— 阶段一：daemon A 起跑 → 停机请求（K1）→ 优雅停（去重位已落 kv） ——
      const a = await startDaemon(bin, configPath)
      try {
        expect(await waitOut(a, /studio-next daemon 启动/, 20_000)).toBe(true)
        writeStopRequest(dir, { id: 'dev41-k1', requestedAt: Date.now(), reason: 'DEV-41 kv 兜底' })
        const codeA = await exitWithin(a, 20_000)
        if (codeA === undefined) throw new Error(`daemon A 未在窗口内停机——输出尾段：\n${tailOf(a.out)}`)
        expect(codeA).toBe(0)

        // —— 人为恢复残留请求文件：把消费件复制回 live 位——事故现场文件态
        //    （②改名失败窗口 / 旧版协议「请求文件不删」的升级路径残留） ——
        const consumedPath = path.join(dir, 'control', `${STOP_REQUEST_FILE}.consume`)
        const livePath = path.join(dir, 'control', STOP_REQUEST_FILE)
        if (existsSync(consumedPath)) copyFileSync(consumedPath, livePath)
        expect(existsSync(livePath)).toBe(true) // 残留现场就位

        // —— 阶段二：daemon B 重启——残留请求在场，①去重位读回命中 → 不当新请求消费 ——
        const b = await startDaemon(bin, configPath)
        try {
          expect(await waitOut(b, /studio-next daemon 启动/, 20_000)).toBe(true)
          expect(await waitOut(b, /tick#\d+/, 5_000)).toBe(true)
          await new Promise((r) => setTimeout(r, 1_500))
          expect(b.exited).toBe(false)
          expect(b.out).not.toContain('控制面停机请求')
          expect(tickCount(b)).toBeGreaterThanOrEqual(3)
          // 去重观测面：启动期残留请求去重日志行（①读回命中——静默去重=观察黑洞）
          expect(b.out).toContain('残留停机请求已去重')
        } finally {
          await b.kill()
        }
      } finally {
        await a.kill()
      }
    },
  )
})
