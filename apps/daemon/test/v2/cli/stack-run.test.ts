// stack-run.test —— `studio-next stack run` 前台双进程分支测试（M5-3；V2 套件）。
//
// 覆盖面（plan/08-§九 M5-3 验收；测试注入 fake 子进程/假信号源——绝不真起真进程）：
//   1. 命令拼装纯函数：daemon argv（index.ts --config＋--daemon-args 透传）/chatd argv＋
//      env 四键（token 只带路径）/数据面路径/前置体检对两态（chatdOn）
//   2. --daemon-args 切分：空白分组/引号保空格/未闭合即抛
//   3. token 纪律：首产 0600（值 64 hex）；在场复用不覆盖＋chmod 0600 复核；--no-chatd 不产
//   4. READY 判定：daemon /healthz ∧ chatd 两步双绿→精确行 `READY daemon=<pid> chatd=<pid>`；
//      探针端口=daemon.yaml apiPort（--port 覆盖）；就绪超时→停双进程 exit 1
//   5. 前置 fail-closed：公司目录缺/daemon.yaml 不可读/platform≠localfile/apiPort=0/
//      部署树入口缺/端口已被现有 daemon 占（零 spawn 不触碰）
//   6. 停机：SIGINT/SIGTERM→先 chatd 后 daemon（SIGTERM→宽限→SIGKILL 兜底）exit 0；
//      信号面退订收尾
//   7. 崩溃 fail-closed：daemon 崩→停 chatd exit 1；chatd 崩→停 daemon exit 1；
//      就绪期崩（shouldAbort 支路）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cmdStack, STACK_EXIT, type StackDepsInit } from '../../../src/cli/stack/stack.ts'
import { buildRunPlan, splitArgsLine, type ChildExit, type SpawnedChild } from '../../../src/cli/stack/run.ts'

/* ---------------- 测试底座（fake 子进程＋假信号源——零真进程） ---------------- */

let root = ''
let home = ''
let workRoot = ''
let companyDir = ''
let configPath = ''
let nodeBin = ''
let deployRoot = ''

/** fake 世界开关（每例重置） */
let daemonUp = false
let chatdUp = false
/** 端口已被「现有 daemon」占用（pre-probe 拒跑面） */
let occupied = false
/** 子进程起后是否变健康（false=就绪超时/启动期崩面） */
let becomeHealthy = true
/** daemon 拉起即在微任务窗口内崩（启动期崩注入——须赶在 waitReady 轮询前） */
let crashDaemonOnSpawn = false
/** 哪个子进程对 SIGTERM 装死（SIGKILL 兜底面） */
let stubborn: 'none' | 'daemon' | 'chatd' = 'none'

let spawns: { cmd: string; args: string[]; cwd: string; env: Record<string, string | undefined>; child: FakeChild }[] = []
let httpCalls: { url: string; timeoutMs: number }[] = []
let chatdProbeCalls: { socketPath: string; tokenFile: string }[] = []
let killOrder: string[] = []
let signalHandlers: Record<string, () => void> = {}
let clock = 0
let nextPid = 1110

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stack-run-test-'))
  home = path.join(root, 'home')
  workRoot = path.join(root, 'work')
  companyDir = path.join(workRoot, 'demo-corp')
  configPath = path.join(companyDir, 'daemon.yaml')
  nodeBin = path.join(root, 'fake-node')
  deployRoot = path.join(root, 'deploy')
  daemonUp = false
  chatdUp = false
  occupied = false
  becomeHealthy = true
  crashDaemonOnSpawn = false
  stubborn = 'none'
  spawns = []
  httpCalls = []
  chatdProbeCalls = []
  killOrder = []
  signalHandlers = {}
  clock = 0
  nextPid = 1110
  makeCompany()
  makeDeployTree()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** 公司夹具：daemon.yaml(platform=localfile＋apiPort 8799) + var/workbench 三件（健康态） */
function makeCompany(): void {
  mkdirSync(path.join(companyDir, 'var', 'workbench'), { recursive: true })
  const varDir = path.join(companyDir, 'var', 'workbench')
  writeFileSync(path.join(varDir, 'chat.sock'), '', { mode: 0o700 })
  writeFileSync(path.join(varDir, 'chat.db'), '', { mode: 0o600 })
  writeFileSync(path.join(varDir, 'chatd.token'), 'a'.repeat(64), { mode: 0o600 })
  writeFileSync(configPath, `# 注释行\nplatform: localfile\napiPort: 8799\ndb: "${path.join(workRoot, 'var', 'ledger.sqlite')}"\ntickMs: 1000\n`)
}

/** 假部署树（run 前置硬校验两个入口＋node 二进制在场） */
function makeDeployTree(): void {
  for (const rel of ['apps/daemon/src/index.ts', 'apps/workbench-chatd/src/main.ts']) {
    const file = path.join(deployRoot, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '// stub\n')
  }
  writeFileSync(nodeBin, '#!/bin/sh\n', { mode: 0o755 })
}

/** fake 子进程：graceful=收到 SIGTERM/SIGKILL 即退；stubborn=只死 SIGKILL */
class FakeChild implements SpawnedChild {
  readonly pid: number
  readonly name: string
  readonly signals: string[] = []
  behavior: 'graceful' | 'stubborn' = 'graceful'
  private exitValue: ChildExit | null = null
  private listeners: ((e: ChildExit) => void)[] = []
  constructor(pid: number, name: string) {
    this.pid = pid
    this.name = name
  }
  kill(signal?: NodeJS.Signals): void {
    const sig = signal ?? 'SIGTERM'
    this.signals.push(sig)
    killOrder.push(`${this.name}:${sig}`)
    const dies = this.behavior === 'stubborn' ? sig === 'SIGKILL' : sig === 'SIGTERM' || sig === 'SIGKILL'
    if (dies) this.forceExit(sig === 'SIGTERM' ? { code: 0, signal: 'SIGTERM' } : { code: null, signal: 'SIGKILL' })
  }
  /** 外部驱动退出（崩溃注入/启动期崩） */
  forceExit(exit: ChildExit): void {
    if (this.exitValue !== null) return
    this.exitValue = exit
    for (const listener of [...this.listeners]) listener(exit)
  }
  waitExit(timeoutMs: number): Promise<ChildExit | 'timeout'> {
    if (this.exitValue !== null) return Promise.resolve(this.exitValue)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), Math.max(1, timeoutMs))
      this.listeners.push((e) => {
        clearTimeout(timer)
        resolve(e)
      })
    })
  }
  onceExit(cb: (exit: ChildExit) => void): void {
    if (this.exitValue !== null) cb(this.exitValue)
    else this.listeners.push(cb)
  }
}

/** 可注入 deps（缺省=健康世界；spawn/信号/时钟全 fake——测试零真进程零真信号） */
function deps(over: StackDepsInit = {}): StackDepsInit {
  return {
    platform: 'linux',
    nodeVersion: '24.21.0',
    home,
    env: {},
    uid: 501,
    systemdAvailable: true,
    run: () => ({ status: 0, stdout: '', stderr: '' }),
    httpGet: async (url, timeoutMs) => {
      httpCalls.push({ url, timeoutMs })
      const up = occupied || daemonUp
      return up ? { http: 200, body: '{"ok":true,"pid":123}', error: null } : { http: null, body: null, error: 'ECONNREFUSED' }
    },
    chatdProbe: async (socketPath, tokenFile) => {
      chatdProbeCalls.push({ socketPath, tokenFile })
      return chatdUp ? { state: 'up', server: 'workbench-chatd/1.0.0', rooms: 2 } : { state: 'down', reason: 'socket 未就绪' }
    },
    statfs: () => ({ bavail: 100, bsize: 1024 ** 3 }),
    spawnChild: (cmd, args, opts) => {
      const isDaemon = args.some((a) => a.endsWith('apps/daemon/src/index.ts'))
      const child = new FakeChild(nextPid, isDaemon ? 'daemon' : 'chatd')
      nextPid += 1
      child.behavior = (isDaemon && stubborn === 'daemon') || (!isDaemon && stubborn === 'chatd') ? 'stubborn' : 'graceful'
      spawns.push({ cmd, args: [...args], cwd: opts.cwd, env: opts.env, child })
      if (becomeHealthy) {
        if (isDaemon) daemonUp = true
        else chatdUp = true
      }
      if (crashDaemonOnSpawn && isDaemon) queueMicrotask(() => child.forceExit({ code: 2, signal: null }))
      return child
    },
    sleep: async () => {},
    now: () => (clock += 30_000),
    onSignal: (signal, handler) => {
      signalHandlers[signal] = handler
      return () => {
        delete signalHandlers[signal]
      }
    },
    ...over,
  }
}

/** console 实时捕获（run 是长驻 promise——先装 spy 再起命令，流式断言 READY） */
function tapConsole(): { out: () => string; err: () => string; restore: () => void } {
  const logs: string[] = []
  const errors: string[] = []
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.join(' '))
  })
  return { out: () => logs.join('\n'), err: () => errors.join('\n'), restore: () => { logSpy.mockRestore(); errSpy.mockRestore() } }
}

/** 短轮询等条件（fake 探针全微任务级——5ms 步进足够，2s 封顶防挂死） */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`until 超时（${String(ms)}ms）`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** 一次性捕获（前置失败面——cmdStack 快速自回） */
async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const tap = tapConsole()
  try {
    return { code: await fn(), out: tap.out(), err: tap.err() }
  } finally {
    tap.restore()
  }
}

function runArgs(...extra: string[]): string[] {
  return ['run', '--company-dir', companyDir, '--deploy-root', deployRoot, '--node-bin', nodeBin, ...extra]
}

const daemonChild = (): FakeChild => spawns[0]!.child
const chatdChild = (): FakeChild | undefined => spawns[1]?.child
const varFile = (name: string): string => path.join(companyDir, 'var', 'workbench', name)
const mode = (p: string): number => statSync(p).mode & 0o777

/* ---------------- 1. 命令拼装纯函数 ---------------- */

describe('stack/run：计划纯函数（命令拼装）', () => {
  const base = (): { companyDir: string; configPath: string; deployRoot: string; nodeBin: string; chatdOn: boolean; port: number } => ({
    companyDir,
    configPath,
    deployRoot,
    nodeBin,
    chatdOn: true,
    port: 8799,
  })

  it('daemon argv＝node --experimental-strip-types index.ts --config <yaml>＋--daemon-args 透传', () => {
    const plan = buildRunPlan({ ...base(), daemonArgs: ['--extra', 'v'] })
    expect(plan.daemonArgv).toEqual([nodeBin, '--experimental-strip-types', path.join(deployRoot, 'apps/daemon/src/index.ts'), '--config', configPath, '--extra', 'v'])
  })

  it('chatd argv＋env 四键（socket/db/token 只带路径，token 值永不入参）；数据面=<companyDir>/var/workbench', () => {
    const plan = buildRunPlan(base())
    expect(plan.chatdArgv).toEqual([nodeBin, '--experimental-strip-types', path.join(deployRoot, 'apps/workbench-chatd/src/main.ts')])
    expect(plan.chatdEnv).toEqual({
      WORKBENCH_CHATD_SOCKET: varFile('chat.sock'),
      WORKBENCH_CHATD_DB: varFile('chat.db'),
      WORKBENCH_CHATD_TOKEN_FILE: varFile('chatd.token'),
      WORKBENCH_CHATD_LOG: 'info',
    })
    expect(plan.varDir).toBe(path.join(companyDir, 'var/workbench'))
    expect(plan.socketPath).toBe(varFile('chat.sock'))
    expect(plan.tokenFile).toBe(varFile('chatd.token'))
  })

  it('前置体检对两态：chatdOn 含 chatd 入口；off 不含', () => {
    expect(buildRunPlan(base()).preflight.map(([name]) => name)).toEqual(['node', 'daemon 入口', 'chatd 入口'])
    expect(buildRunPlan({ ...base(), chatdOn: false }).preflight.map(([name]) => name)).toEqual(['node', 'daemon 入口'])
  })
})

/* ---------------- 2. --daemon-args 切分 ---------------- */

describe('stack/run：--daemon-args 切分', () => {
  it('空白分组＋双/单引号保空格；空串→[]', () => {
    expect(splitArgsLine('')).toEqual([])
    expect(splitArgsLine('  ')).toEqual([])
    expect(splitArgsLine('--foo "a b" --bar')).toEqual(['--foo', 'a b', '--bar'])
    expect(splitArgsLine(`--x 'c d' e`)).toEqual(['--x', 'c d', 'e'])
    expect(splitArgsLine('a"b c"d')).toEqual(['ab cd'])
  })

  it('引号未闭合＝用法错', () => {
    expect(() => splitArgsLine('--foo "unclosed')).toThrowError(/引号未闭合/)
  })
})

/* ---------------- 3. READY 判定＋探针端口 ---------------- */

describe('stack/run：READY 判定与探针', () => {
  it('双绿→READY daemon=<pid> chatd=<pid>（探针 URL=daemon.yaml apiPort；chatd 两步带 socket+token）', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(tap.out()).toContain('READY daemon=1110 chatd=1111')
    expect(httpCalls.some((c) => c.url === 'http://127.0.0.1:8799/healthz')).toBe(true)
    expect(chatdProbeCalls).toContainEqual({ socketPath: varFile('chat.sock'), tokenFile: varFile('chatd.token') })
    expect(spawns.length).toBe(2)
    expect(spawns.every((s) => s.cwd === deployRoot)).toBe(true)
    expect(spawns[1]?.env['WORKBENCH_CHATD_SOCKET']).toBe(varFile('chat.sock'))
    expect(spawns[1]?.env['WORKBENCH_CHATD_TOKEN_FILE']).toBe(varFile('chatd.token'))
  })

  it('--port 覆盖探针端口（daemon.yaml apiPort 不动）', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs('--port', '8902'), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(httpCalls.every((c) => c.url === 'http://127.0.0.1:8902/healthz')).toBe(true)
  })

  it('--no-chatd：只起 daemon，READY chatd=off，零 chatd 探针，不产 token', async () => {
    rmSync(path.join(companyDir, 'var', 'workbench'), { recursive: true, force: true })
    const tap = tapConsole()
    const p = cmdStack(runArgs('--no-chatd'), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(spawns.length).toBe(1)
    expect(tap.out()).toContain('READY daemon=1110 chatd=off')
    expect(chatdProbeCalls.length).toBe(0)
    expect(spawns[0]?.env['WORKBENCH_CHATD_SOCKET']).toBeUndefined()
  })

  it('就绪超时→停双进程 exit 1（不打印 READY）', async () => {
    becomeHealthy = false
    const tap = tapConsole()
    const code = await cmdStack(runArgs('--stop-timeout-ms', '50'), deps())
    tap.restore()
    expect(code).toBe(STACK_EXIT.usage)
    expect(tap.out()).not.toContain('READY')
    expect(tap.err()).toContain('就绪失败')
    expect(tap.err()).toContain('未就绪')
    expect(killOrder).toEqual(['chatd:SIGTERM', 'daemon:SIGTERM'])
  })
})

/* ---------------- 4. token 纪律 ---------------- */

describe('stack/run：token 0600 纪律', () => {
  it('首产：0600＋64 hex（值不打印）', async () => {
    rmSync(path.join(companyDir, 'var', 'workbench'), { recursive: true, force: true })
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(mode(varFile('chatd.token'))).toBe(0o600)
    const token = readFileSync(varFile('chatd.token'), 'utf8')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(tap.out()).toContain('token 首产 0600')
    expect(tap.out()).not.toContain(token)
  })

  it('复用：在场不覆盖＋chmod 0600 复核', async () => {
    writeFileSync(varFile('chatd.token'), 'b'.repeat(64), { mode: 0o644 })
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(readFileSync(varFile('chatd.token'), 'utf8')).toBe('b'.repeat(64))
    expect(mode(varFile('chatd.token'))).toBe(0o600)
    expect(tap.out()).toContain('token 复用不覆盖')
  })
})

/* ---------------- 5. 前置 fail-closed（零 spawn） ---------------- */

describe('stack/run：前置 fail-closed', () => {
  it('公司目录不存在：exit 1', async () => {
    const res = await capture(() => cmdStack(runArgs().map((a) => (a === companyDir ? `${companyDir}-absent` : a)), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('公司目录不存在')
    expect(spawns.length).toBe(0)
  })

  it('缺 --company-dir：exit 1 用法错', async () => {
    const res = await capture(() => cmdStack(['run', '--deploy-root', deployRoot], deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('--company-dir')
  })

  it('daemon.yaml 不可读：exit 1', async () => {
    rmSync(configPath)
    const res = await capture(() => cmdStack(runArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('不可读')
    expect(spawns.length).toBe(0)
  })

  it('platform≠localfile：exit 1 明报', async () => {
    writeFileSync(configPath, 'platform: taiga\napiPort: 8799\ndb: "/tmp/x.sqlite"\n')
    const res = await capture(() => cmdStack(runArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('仅支持 daemon.yaml platform=localfile')
    expect(res.err).toContain('taiga')
    expect(spawns.length).toBe(0)
  })

  it('apiPort: 0（ephemeral）：exit 1——run 需确定性探针端口', async () => {
    writeFileSync(configPath, 'platform: localfile\napiPort: 0\ndb: "/tmp/x.sqlite"\n')
    const res = await capture(() => cmdStack(runArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('ephemeral')
    expect(spawns.length).toBe(0)
  })

  it('部署树入口缺件：exit 1 逐项明报', async () => {
    rmSync(path.join(deployRoot, 'apps', 'workbench-chatd', 'src', 'main.ts'))
    const res = await capture(() => cmdStack(runArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('chatd 入口不存在')
    expect(spawns.length).toBe(0)
  })

  it('healthz 端口已有 daemon 在跑：拒跑零 spawn（不触碰现有进程）', async () => {
    occupied = true
    const res = await capture(() => cmdStack(runArgs(), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('不触碰现有进程')
    expect(spawns.length).toBe(0)
  })

  it('未知旗标：exit 1 用法错', async () => {
    const res = await capture(() => cmdStack(runArgs('--nope'), deps()))
    expect(res.code).toBe(STACK_EXIT.usage)
    expect(res.err).toContain('未知参数')
  })
})

/* ---------------- 6. 信号停机 ---------------- */

describe('stack/run：信号优雅停', () => {
  it('SIGINT：先 chatd 后 daemon（各一发 SIGTERM），exit 0，信号面退订', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(killOrder).toEqual(['chatd:SIGTERM', 'daemon:SIGTERM'])
    expect(tap.out()).toContain('收到 SIGINT')
    expect(tap.out()).toContain('chatd pid=1111 已停')
    expect(tap.out()).toContain('daemon pid=1110 已停')
    expect(Object.keys(signalHandlers).length).toBe(0)
  })

  it('SIGTERM 同道：exit 0', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGTERM']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(tap.out()).toContain('收到 SIGTERM')
  })

  it('SIGTERM 不退→SIGKILL 兜底（--stop-timeout-ms 收紧）', async () => {
    stubborn = 'chatd'
    const tap = tapConsole()
    const p = cmdStack(runArgs('--stop-timeout-ms', '50'), deps())
    await until(() => tap.out().includes('READY'))
    signalHandlers['SIGINT']?.()
    expect(await p).toBe(STACK_EXIT.ok)
    tap.restore()
    expect(chatdChild()?.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(daemonChild().signals).toEqual(['SIGTERM'])
    expect(tap.out()).toContain('SIGKILL')
  })
})

/* ---------------- 7. 崩溃 fail-closed ---------------- */

describe('stack/run：子进程崩溃 fail-closed', () => {
  it('daemon 崩（READY 后）→停 chatd→exit 1', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    daemonChild().forceExit({ code: 3, signal: null })
    expect(await p).toBe(STACK_EXIT.usage)
    tap.restore()
    expect(tap.err()).toContain('daemon 意外退出')
    expect(tap.err()).toContain('code=3')
    expect(tap.err()).toContain('fail-closed')
    expect(chatdChild()?.signals).toEqual(['SIGTERM'])
  })

  it('chatd 崩（READY 后）→停 daemon→exit 1', async () => {
    const tap = tapConsole()
    const p = cmdStack(runArgs(), deps())
    await until(() => tap.out().includes('READY'))
    chatdChild()?.forceExit({ code: 1, signal: null })
    expect(await p).toBe(STACK_EXIT.usage)
    tap.restore()
    expect(tap.err()).toContain('chatd 意外退出')
    expect(daemonChild().signals).toEqual(['SIGTERM'])
  })

  it('就绪期崩（READY 前）：fail-closed 接管，exit 1', async () => {
    becomeHealthy = false
    crashDaemonOnSpawn = true
    const tap = tapConsole()
    const code = await cmdStack(runArgs('--stop-timeout-ms', '50'), deps())
    tap.restore()
    expect(code).toBe(STACK_EXIT.usage)
    expect(tap.out()).not.toContain('READY')
    expect(tap.err()).toContain('daemon 意外退出')
    expect(tap.err()).toContain('code=2')
    expect(killOrder).toEqual(['chatd:SIGTERM', 'daemon:SIGTERM'])
  })
})
