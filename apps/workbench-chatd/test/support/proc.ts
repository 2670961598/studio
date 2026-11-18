/**
 * 测试支撑：拉起/看护真实 workbench-chatd 子进程（仅测试用；P1-1b）。
 * 以 node --experimental-strip-types 直跑 apps/workbench-chatd/src/main.ts，与生产启动命令一致。
 * ready 判定：stderr 出现 {event:"ready"} 日志行（main.ts 在 socket 可用后输出）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/workbench-chatd/test/support/ → 仓根 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
export const CHATD_MAIN = path.join(REPO_ROOT, 'apps', 'workbench-chatd', 'src', 'main.ts')
/** WorkbenchTransport v1 真客户端驱动器（packages/workbench-transport 自身 test-support）。 */
export const CHATD_DRIVER = path.join(REPO_ROOT, 'packages', 'workbench-transport', 'test', 'support', 'chatd-driver.ts')

export interface ExitInfo {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface ChatdHandle {
  readonly proc: ChildProcess
  readonly socketPath: string
  readonly dir: string
  readonly pid: number | undefined
  /** 累计 stdout+stderr（密钥泄露断言用）。 */
  output(): string
  waitReady(timeoutMs?: number): Promise<void>
  waitExit(timeoutMs?: number): Promise<ExitInfo>
  sigterm(): void
  kill9(): void
  /** 尽力收尾：杀进程（若活）+ 删临时目录；测试 afterEach 兜底调用。 */
  cleanup(): Promise<void>
}

export interface StartOptions {
  /**
   * 追加/覆盖 env；外层同名 WORKBENCH_CHATD_* 一律先清空（测试密闭性）。
   * 密闭基线含显式 WORKBENCH_CHATD_ALLOW_NO_AUTH=1：本套件非鉴权用例（lifecycle/endpoints/contract）
   * 统一走 mock/dev 免鉴权通道（服务端默认 fail-closed 的唯一显式豁免）；
   * 鉴权/fail-closed 用例在 env 里覆盖该键（置 '' 即恢复默认 fail-closed）。
   */
  readonly env?: Readonly<Record<string, string>>
  /** 显式 socket 路径（复用/陈旧文件场景）；默认 <dir>/chat.sock。 */
  readonly socketPath?: string
  /** 显式工作目录（复用场景）；默认新 mkdtemp。 */
  readonly dir?: string
}

const READY_TIMEOUT_MS = 8_000
const EXIT_TIMEOUT_MS = 8_000

export async function startChatd(options: StartOptions = {}): Promise<ChatdHandle> {
  const dir = options.dir ?? mkdtempSync(path.join(tmpdir(), 'workbench-chatd-test-'))
  const socketPath = options.socketPath ?? path.join(dir, 'chat.sock')
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('WORKBENCH_CHATD_')) delete env[key]
  }
  env.WORKBENCH_CHATD_ALLOW_NO_AUTH = '1' // 见 StartOptions.env 注：非鉴权用例的显式 mock/dev 通道
  Object.assign(env, options.env ?? {})
  env.WORKBENCH_CHATD_SOCKET = socketPath // 测试一律显式指定 socket，避免实例间串台
  const proc = spawn(process.execPath, ['--experimental-strip-types', CHATD_MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const append = (chunk: Buffer | string): void => {
    output += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  }
  proc.stdout?.on('data', append)
  proc.stderr?.on('data', append)

  const exited = new Promise<ExitInfo>((resolve) => {
    proc.once('exit', (code, signal) => { resolve({ code, signal }) })
  })

  const waitReady = async (timeoutMs = READY_TIMEOUT_MS): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (output.split('\n').some((line) => line.includes('"event":"ready"'))) return
      const exitInfo = await Promise.race([exited, sleep(25).then(() => undefined as ExitInfo | undefined)])
      if (exitInfo !== undefined) throw new Error(`chatd 提前退出（code=${String(exitInfo.code)} signal=${String(exitInfo.signal)}）\n${output}`)
      await sleep(10)
    }
    throw new Error(`等待 ready 超时（${String(timeoutMs)}ms）\n${output}`)
  }

  const waitExit = async (timeoutMs = EXIT_TIMEOUT_MS): Promise<ExitInfo> => {
    const timer = sleep(timeoutMs).then(() => null)
    const result = await Promise.race([exited, timer])
    if (result === null) throw new Error(`等待退出超时（${String(timeoutMs)}ms）\n${output}`)
    return result
  }

  return {
    proc,
    socketPath,
    dir,
    pid: proc.pid,
    output: () => output,
    waitReady,
    waitExit,
    sigterm: () => { proc.kill('SIGTERM') },
    kill9: () => { proc.kill('SIGKILL') },
    async cleanup(): Promise<void> {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGKILL')
        await Promise.race([exited, sleep(2_000)]).catch(() => undefined)
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 尽力清理
      }
    },
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 总期限护栏：deadline 到点抛错（防测试挂死；node:test 无内建单测超时）。 */
export async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(`withDeadline 超时（${label}，${String(ms)}ms）`)) }, ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
