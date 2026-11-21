// run —— `studio-next stack run` 前台双进程分支（M5-3 第一刀，2026-11-21）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §〇（干净机器一条命令起公司：daemon＋chatd
//     双进程，launchd/systemd 保活**或前台模式**）、§2.2（「无 init 系统：前台进程组，
//     Ctrl-C 整组优雅停」——本刀以独立 `run` 子命令落地，差异实录见 §九）、§九
//     （M5-3 实现记录：run 与 up 的边界）
//   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 里程碑5（干净机器无
//     Docker/Taiga/Matrix 跑通公司闭环）
//   - apps/daemon/src/index.ts（daemon 真实入口：`--config <daemon.yaml>`——裸跑不经
//     guardian，run=临时/CI/烟测面）、apps/workbench-chatd/src/main.ts（chatd 入口：
//     env 四键 SOCKET/DB/TOKEN_FILE/LOG——templates.ts 双制式模板同源约定）
//   - scripts/ops/chatd-setup.mjs（token 首产 0600 不覆盖判例——up 分支同款防线）
//
// 形态（与 up 的边界——up=launchd/systemd 常驻服务；run=前台进程组，退出即散）：
//   - 前置：公司目录存在＋daemon.yaml 可读且 platform=localfile（干净机器口径，非
//     localfile 明报拒跑）＋部署树 node/daemon/chatd 入口在场（run 无 dry-run，缺件硬拒）；
//     healthz 端口已有 daemon 在跑（探针 200∧ok）→ 拒跑不触碰（端口/路径全由参数决定）。
//   - 就绪：轮询 daemon /healthz（judgeDaemonHealth 同源判定）＋chatd 两步探针
//     （deps.chatdProbe）双绿后打印 `READY daemon=<pid> chatd=<pid>`；超时→停双进程 exit 1。
//   - 停机：Ctrl-C/SIGTERM→先 chatd 后 daemon（SIGTERM→宽限→SIGKILL）exit 0；
//     任一子进程意外退出→停另一个→exit 1（fail-closed，不假装活着）。
//   - 不写 launchd/systemd、不碰 plist/unit；token 首产 0600 复用不覆盖（值不打印）。
//
// 可测性：spawn/sleep/now/onSignal/探针全注入（StackDeps——测试不真起进程、不挂真信号）。
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { StackDeps } from './stack.ts'
import { judgeDaemonHealth } from './stack.ts'
import { readFlatYamlScalars, STACK_CONVENTIONS, STACK_EXIT, StackUsageError } from './plists.ts'
import { atomicWrite, defaultDaemonConfigPath, defaultDeployRoot, parsePort, parsePositiveInt, requireCompanyDir } from './updown.ts'

/** run 面约定（宽限/轮询节拍——与 guardian stopGraceMs 15s 相比收紧：run 是临时面） */
export const RUN_CONVENTIONS = Object.freeze({
  /** 就绪窗口（daemon /healthz ∧ chatd health 双绿；对齐 guardian startupGraceMs 60s） */
  readyTimeoutMs: 60_000,
  /** 就绪轮询间隔 */
  pollMs: 250,
  /** 单次探针超时（daemon fetch / chatd 两步共用） */
  probeMs: 2000,
  /** 起跑前端口占用探测超时（已有 daemon 在跑=拒跑不触碰） */
  preProbeMs: 1500,
  /** SIGTERM 后优雅退出宽限，超时 SIGKILL */
  stopTimeoutMs: 8000,
  /** SIGKILL 后等待退出观测窗口 */
  killWaitMs: 5000,
})

/* ------------------------------------------------------------------ */
/* 子进程抽象（注入面——真实现包 node:child_process.spawn；测试用 fake）   */
/* ------------------------------------------------------------------ */

export interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

export interface SpawnOptions {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
}

/**
 * 子进程句柄（最小面：pid/kill/等退出/退出监听）。waitExit 超时回 'timeout' 不抛；
 * onceExit 一次性（已退出即同步回调）——fail-closed 驱动专用。
 */
export interface SpawnedChild {
  readonly pid: number
  kill(signal?: NodeJS.Signals): void
  waitExit(timeoutMs: number): Promise<ChildExit | 'timeout'>
  onceExit(cb: (exit: ChildExit) => void): void
}

/** 真实现：stdio=inherit（前台直通终端——run 的日志面就是操作员的终端）；error 事件=code 127 */
export function spawnChildReal(cmd: string, args: readonly string[], opts: SpawnOptions): SpawnedChild {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: 'inherit' })
  let exited: ChildExit | null = null
  const exitWaiters: Array<(e: ChildExit) => void> = []
  const exitListeners: Array<(e: ChildExit) => void> = []
  const deliver = (e: ChildExit): void => {
    if (exited !== null) return
    exited = e
    for (const listener of [...exitListeners]) listener(e)
    for (const waiter of [...exitWaiters]) waiter(e)
    exitWaiters.length = 0
  }
  child.once('exit', (code, signal) => deliver({ code, signal }))
  child.once('error', () => deliver({ code: 127, signal: null })) // ENOENT 等（pid 未起即折）
  return {
    pid: child.pid ?? -1,
    kill: (signal) => {
      child.kill(signal)
    },
    waitExit: (timeoutMs) =>
      new Promise((resolve) => {
        if (exited !== null) {
          resolve(exited)
          return
        }
        let settled = false
        const finish = (r: ChildExit | 'timeout'): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(r)
        }
        const waiter = (e: ChildExit): void => finish(e)
        const timer = setTimeout(() => {
          const idx = exitWaiters.indexOf(waiter)
          if (idx >= 0) exitWaiters.splice(idx, 1)
          finish('timeout')
        }, Math.max(1, timeoutMs))
        exitWaiters.push(waiter)
      }),
    onceExit: (cb) => {
      if (exited !== null) cb(exited)
      else exitListeners.push(cb)
    },
  }
}

/* ------------------------------------------------------------------ */
/* 计划（纯推导，零 IO——命令拼装可单测）                                */
/* ------------------------------------------------------------------ */

export interface RunPlan {
  readonly companyDir: string
  readonly configPath: string
  readonly deployRoot: string
  readonly nodeBin: string
  readonly port: number
  readonly daemonEntry: string
  readonly chatdEntry: string
  readonly varDir: string
  readonly socketPath: string
  readonly dbPath: string
  readonly tokenFile: string
  readonly chatdOn: boolean
  readonly daemonArgs: readonly string[]
  /** daemon 子进程 argv（node 裸跑真实入口 index.ts——不经 guardian，run=临时面） */
  readonly daemonArgv: readonly string[]
  readonly chatdArgv: readonly string[]
  /** chatd env 四键（templates.ts 双制式模板同源约定；token 只带文件路径不嵌值） */
  readonly chatdEnv: Readonly<Record<string, string>>
  /** 前置在场体检对（缺任一=硬拒 exit 1——run 无 dry-run） */
  readonly preflight: readonly (readonly [name: string, p: string])[]
}

/**
 * run 前台计划（纯推导）。daemon=`node apps/daemon/src/index.ts --config <yaml>`＋
 * `--daemon-args` 透传（入口自身只收 --config，多余参数由 daemon 自己的用法面拒绝）；
 * chatd=`node apps/workbench-chatd/src/main.ts`＋env 四键。
 */
export function buildRunPlan(input: {
  companyDir: string
  configPath: string
  deployRoot: string
  nodeBin: string
  daemonArgs?: readonly string[]
  chatdOn: boolean
  port: number
}): RunPlan {
  const companyDir = path.resolve(input.companyDir)
  const configPath = path.resolve(input.configPath)
  const deployRoot = path.resolve(input.deployRoot)
  const nodeBin = path.resolve(input.nodeBin)
  const varDir = path.join(companyDir, ...STACK_CONVENTIONS.varRel)
  const daemonEntry = path.join(deployRoot, 'apps', 'daemon', 'src', 'index.ts')
  const chatdEntry = path.join(deployRoot, 'apps', 'workbench-chatd', 'src', 'main.ts')
  const chatdEnv = {
    WORKBENCH_CHATD_SOCKET: path.join(varDir, STACK_CONVENTIONS.socketFile),
    WORKBENCH_CHATD_DB: path.join(varDir, STACK_CONVENTIONS.dbFile),
    WORKBENCH_CHATD_TOKEN_FILE: path.join(varDir, STACK_CONVENTIONS.tokenFile),
    WORKBENCH_CHATD_LOG: STACK_CONVENTIONS.logLevel,
  }
  const preflight: (readonly [string, string])[] = [
    ['node', nodeBin],
    ['daemon 入口', daemonEntry],
  ]
  if (input.chatdOn) preflight.push(['chatd 入口', chatdEntry])
  return {
    companyDir,
    configPath,
    deployRoot,
    nodeBin,
    port: input.port,
    daemonEntry,
    chatdEntry,
    varDir,
    socketPath: chatdEnv['WORKBENCH_CHATD_SOCKET'],
    dbPath: chatdEnv['WORKBENCH_CHATD_DB'],
    tokenFile: chatdEnv['WORKBENCH_CHATD_TOKEN_FILE'],
    chatdOn: input.chatdOn,
    daemonArgs: [...(input.daemonArgs ?? [])],
    daemonArgv: [nodeBin, '--experimental-strip-types', daemonEntry, '--config', configPath, ...(input.daemonArgs ?? [])],
    chatdArgv: [nodeBin, '--experimental-strip-types', chatdEntry],
    chatdEnv,
    preflight,
  }
}

/**
 * `--daemon-args` 取值切分（shell 轻量版：空白分隔＋双/单引号成组保空格；不展开变量/
 * 不处理转义——透传面保持可预期）。引号未闭合=用法错（明报不猜）。
 */
export function splitArgsLine(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let hasToken = false
  for (const ch of raw) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (hasToken || cur !== '') {
        out.push(cur)
        cur = ''
        hasToken = false
      }
      continue
    }
    cur += ch
    hasToken = true
  }
  if (quote !== null) throw new StackUsageError(`--daemon-args 引号未闭合：${raw}`)
  if (hasToken || cur !== '') out.push(cur)
  return out
}

/* ------------------------------------------------------------------ */
/* 编排（前置→token→spawn→就绪→值守：信号优雅停／崩溃 fail-closed）       */
/* ------------------------------------------------------------------ */

interface ReadyOutcome {
  readonly ok: boolean
  readonly reason?: string
}

/** 就绪轮询：daemon /healthz ∧ chatd 两步双绿；shouldAbort（）真=子进程已折（fail-closed 接管） */
async function waitReady(input: {
  deps: StackDeps
  daemonUrl: string
  socketPath: string
  tokenFile: string
  chatdOn: boolean
  readyTimeoutMs: number
  shouldAbort: () => boolean
}): Promise<ReadyOutcome> {
  const { deps } = input
  const deadline = deps.now() + input.readyTimeoutMs
  let daemonDetail = '未探测'
  let chatdDetail = '未探测'
  for (;;) {
    if (input.shouldAbort()) return { ok: false, reason: '子进程退出（fail-closed 已接管）' }
    const probe = await deps.httpGet(input.daemonUrl, RUN_CONVENTIONS.probeMs)
    const daemonUp = judgeDaemonHealth(probe) === 'up'
    daemonDetail = daemonUp ? 'up' : `down（${probe.error ?? `http=${String(probe.http)}`}）`
    let chatdUp = true
    if (input.chatdOn) {
      const res = await deps.chatdProbe(input.socketPath, input.tokenFile, RUN_CONVENTIONS.probeMs)
      chatdUp = res.state === 'up'
      chatdDetail = chatdUp ? 'up' : `down（${res.reason ?? '未知'}）`
    }
    if (daemonUp && chatdUp) return { ok: true }
    if (deps.now() >= deadline) {
      return { ok: false, reason: `${String(input.readyTimeoutMs)}ms 内未就绪：daemon=${daemonDetail}${input.chatdOn ? `；chatd=${chatdDetail}` : ''}` }
    }
    await deps.sleep(RUN_CONVENTIONS.pollMs)
  }
}

/** 单子进程优雅停：SIGTERM→宽限→SIGKILL（观测窗口内等退出面收口） */
async function stopChild(who: string, child: SpawnedChild | null, stopTimeoutMs: number): Promise<void> {
  if (child === null) return
  child.kill('SIGTERM')
  const grace = await child.waitExit(stopTimeoutMs)
  if (grace === 'timeout') {
    child.kill('SIGKILL')
    const killed = await child.waitExit(RUN_CONVENTIONS.killWaitMs)
    console.log(`  ${who} pid=${String(child.pid)} SIGTERM ${String(stopTimeoutMs)}ms 未退 → SIGKILL${killed === 'timeout' ? '（退出观测超时——进程可能仍在收尾）' : ''}`)
    return
  }
  console.log(`  ${who} pid=${String(child.pid)} 已停（code=${grace.code === null ? 'null' : String(grace.code)} signal=${grace.signal ?? '-'}）`)
}

/** `stack run` 主体（前置用法错抛 StackUsageError——cmdStack 收口 exit 1；其余面自回退出码）。 */
export async function runRun(flags: Map<string, string>, noChatd: boolean, deps: StackDeps): Promise<number> {
  // ---- 前置：公司目录存在 ∧ daemon.yaml platform=localfile ∧ 端口可推导 ----
  const companyDir = path.resolve(requireCompanyDir(flags))
  let isDir = false
  try {
    isDir = statSync(companyDir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) throw new StackUsageError(`公司目录不存在/非目录：${companyDir}`)
  const configPath = path.resolve(flags.get('config') ?? defaultDaemonConfigPath(companyDir))
  let scalars: Record<string, string>
  try {
    scalars = readFlatYamlScalars(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new StackUsageError(`daemon.yaml 不可读（${configPath}）：${err instanceof Error ? err.message : String(err)}（--config 显式指定）`)
  }
  const platform = scalars['platform'] ?? null
  if (platform !== 'localfile') {
    throw new StackUsageError(`stack run 仅支持 daemon.yaml platform=localfile（当前=${platform ?? '未声明'}，${configPath}——plan/08 §〇 干净机器口径）`)
  }
  const portRaw = flags.get('port') ?? scalars['apiPort'] ?? '8788'
  if (portRaw === '0') throw new StackUsageError('apiPort: 0=ephemeral 无法探 healthz（--port 显式指定探针端口，或 daemon.yaml 写死 apiPort——run 需确定性端口）')
  const port = parsePort(portRaw, 'port')

  const plan = buildRunPlan({
    companyDir,
    configPath,
    deployRoot: path.resolve(flags.get('deploy-root') ?? defaultDeployRoot()),
    nodeBin: path.resolve(flags.get('node-bin') ?? process.execPath),
    daemonArgs: splitArgsLine(flags.get('daemon-args') ?? ''),
    chatdOn: !noChatd,
    port,
  })
  const readyTimeoutMs = positiveIntFlag(flags, 'ready-timeout-ms', RUN_CONVENTIONS.readyTimeoutMs)
  const stopTimeoutMs = positiveIntFlag(flags, 'stop-timeout-ms', RUN_CONVENTIONS.stopTimeoutMs)

  const missing: string[] = []
  for (const [name, p] of plan.preflight) if (!existsSync(p)) missing.push(`${name}不存在：${p}`)
  if (missing.length > 0) {
    for (const line of missing) console.error(`stack run：前置缺件：${line}`)
    return STACK_EXIT.usage
  }

  // ---- 不触碰现有生产：healthz 已有 daemon 在跑（同端口）=拒跑 ----
  const daemonUrl = `http://127.0.0.1:${String(port)}/healthz`
  const pre = await deps.httpGet(daemonUrl, RUN_CONVENTIONS.preProbeMs)
  if (judgeDaemonHealth(pre) === 'up') {
    console.error(`stack run：${daemonUrl} 已有 daemon 在跑（healthz ok）——不触碰现有进程；换 --config（daemon.yaml apiPort）/--port 或先停现有实例`)
    return STACK_EXIT.usage
  }

  // ---- chatd 数据面：var 0700＋token 首产 0600 复用不覆盖（up 分支同款防线） ----
  let tokenNote = ''
  if (plan.chatdOn) {
    mkdirSync(plan.varDir, { recursive: true })
    chmodSync(plan.varDir, 0o700)
    if (!existsSync(plan.tokenFile)) {
      atomicWrite(plan.tokenFile, randomBytes(32).toString('hex'), 0o600)
      tokenNote = '；token 首产 0600（值不打印）'
    } else {
      chmodSync(plan.tokenFile, 0o600)
      tokenNote = '；token 复用不覆盖（chmod 0600 复核）'
    }
  }

  console.log('stack run（前台双进程——Ctrl-C/SIGTERM 优雅停；不写 launchd/systemd；常驻服务走 up）')
  console.log(`  公司目录 ${plan.companyDir}`)
  console.log(`  部署树   ${plan.deployRoot}`)
  console.log(`  daemon   ${plan.daemonArgv.join(' ')}（healthz=${daemonUrl}）`)
  console.log(plan.chatdOn ? `  chatd    ${plan.chatdArgv.join(' ')}（socket=${plan.socketPath}${tokenNote}）` : '  chatd    --no-chatd 关闭（只跑 daemon）')

  // ---- spawn（daemon 先起；值守闭包先挂再探活——启动期崩溃也 fail-closed） ----
  const daemon = deps.spawnChild(plan.daemonArgv[0] ?? '', plan.daemonArgv.slice(1), { cwd: plan.deployRoot, env: { ...deps.env } })
  const chatd = plan.chatdOn ? deps.spawnChild(plan.chatdArgv[0] ?? '', plan.chatdArgv.slice(1), { cwd: plan.deployRoot, env: { ...deps.env, ...plan.chatdEnv } }) : null

  let stopping = false
  let settled = false
  let resolveDone: (code: number) => void = () => {}
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve
  })
  const finish = (code: number): void => {
    if (settled) return
    settled = true
    resolveDone(code)
  }
  const stopAll = async (reason: string): Promise<void> => {
    console.log(`stack run：${reason}——停子进程（先 chatd 后 daemon；SIGTERM→${String(stopTimeoutMs)}ms→SIGKILL）`)
    await stopChild('chatd', chatd, stopTimeoutMs)
    await stopChild('daemon', daemon, stopTimeoutMs)
  }
  const onCrash = (who: 'daemon' | 'chatd', exit: ChildExit): void => {
    if (stopping) return // 停机流程内的退出=预期
    stopping = true
    console.error(`stack run：${who} 意外退出（code=${exit.code === null ? 'null' : String(exit.code)} signal=${exit.signal ?? '-'}）——fail-closed：停另一子进程后退出非 0`)
    void (async () => {
      await stopAll(`${who} 崩溃`)
      finish(STACK_EXIT.usage)
    })()
  }
  daemon.onceExit((exit) => onCrash('daemon', exit))
  chatd?.onceExit((exit) => onCrash('chatd', exit))

  const unsubscribers: (() => void)[] = []
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    unsubscribers.push(
      deps.onSignal(signal, () => {
        if (stopping) return
        stopping = true
        void (async () => {
          await stopAll(`收到 ${signal}`)
          finish(STACK_EXIT.ok)
        })()
      }),
    )
  }

  // ---- 就绪门：双绿才 READY；超时/启动期崩溃=停双进程 exit 1 ----
  const ready = await waitReady({ deps, daemonUrl, socketPath: plan.socketPath, tokenFile: plan.tokenFile, chatdOn: plan.chatdOn, readyTimeoutMs, shouldAbort: () => stopping })
  if (!ready.ok) {
    if (!stopping) {
      stopping = true
      console.error(`stack run：就绪失败：${ready.reason ?? '未知'}`)
      await stopAll('就绪失败')
      for (const unsub of unsubscribers) unsub()
      return STACK_EXIT.usage
    }
    // stopping=true：crash 路径已接管停机与退出码
  } else {
    console.log(`READY daemon=${String(daemon.pid)} chatd=${chatd === null ? 'off' : String(chatd.pid)}`)
  }

  // ---- 值守：信号优雅停（exit 0）或任一子进程崩（fail-closed exit 1） ----
  const code = await done
  for (const unsub of unsubscribers) unsub()
  return code
}

/** 旗标缺省收口（--ready-timeout-ms/--stop-timeout-ms：未给=约定值；给了=正整数校验） */
function positiveIntFlag(flags: Map<string, string>, flag: string, fallback: number): number {
  const raw = flags.get(flag) ?? ''
  return raw === '' ? fallback : parsePositiveInt(raw, flag)
}
