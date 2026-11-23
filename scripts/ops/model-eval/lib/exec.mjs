/**
 * exec.mjs —— dsh 子进程执行面（runner 里唯一 spawn 真进程的地方）+ 宿主凭据/路径探测
 *
 * 调用形态（docs/quality/model-eval.md §5，制作人 2026-11-23 指定）：
 *   dsh --profile headless --patch <overlay.yml> --permission-mode workspace-write --json -- <任务文本>
 * 约束：cwd 一律是临时工位；env 由 overlay.buildChildEnv 组装；超时先 SIGTERM 整个进程组、
 * 宽限后 SIGKILL（被测模型的工具子进程一并收掉）；stdout/stderr 设上限防内存爆。
 * 测试不 spawn dsh——evaluate.runEval 接受注入的 fake exec；execDsh 本身只用 node 自身做冒烟。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** 宿主 dsh 安装位（脚本内可读 host 路径；文档只用占位符——AGENTS §五.6）。 */
export const DEFAULT_DSH_BIN = '/opt/homebrew/bin/dsh'

/** 可用性预探用的最小调用（同 kimi-on-dsh.md §6 PoC 口径）。 */
export const PROBE_PROMPT = '只回复两个字：可用'

const STDOUT_CAP = 16 * 1024 * 1024
const KILL_GRACE_MS = 5_000

/** headless 调用参数（固定形态；taskText 作 `--` 后唯一位置参数）。 */
export function dshArgs(overlayPath, taskText) {
  return ['--profile', 'headless', '--patch', overlayPath, '--permission-mode', 'workspace-write', '--json', '--', taskText]
}

/** 在途子进程登记：runner 自身被信号打断时整组收掉，不留孤儿 dsh。 */
const ACTIVE = new Set()
let cleanupInstalled = false

/** 进程级兜底（run.mjs 启动时调一次；重复调用幂等）。 */
export function installChildCleanup() {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const killAll = () => {
    for (const child of ACTIVE) killGroup(child, 'SIGKILL')
    ACTIVE.clear()
  }
  process.once('SIGINT', () => {
    killAll()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    killAll()
    process.exit(143)
  })
  process.once('exit', killAll)
}

function killGroup(child, signal) {
  if (typeof child.pid !== 'number') return
  try {
    process.kill(-child.pid, signal) // detached：pid 即进程组长，负号=整组
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* 进程已退出 */
    }
  }
}

/**
 * 跑一次 dsh。返回 Promise<RunResult>：
 * { exitCode, signal, spawnError, timedOut, latencyMs, stdout, stderr, stdoutTruncated }
 * 永不 reject（spawn 失败也落 spawnError），由调用方分类。
 */
export function execDsh({ cmd, args, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let timedOut = false
    let hardTimer = null
    let killTimer = null
    let child
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    } catch (err) {
      resolve({ exitCode: null, signal: null, spawnError: err?.code ?? String(err), timedOut: false, latencyMs: Date.now() - started, stdout: '', stderr: String(err?.stack ?? err), stdoutTruncated: false })
      return
    }
    ACTIVE.add(child)
    const finish = (patch) => {
      if (settled) return
      settled = true
      ACTIVE.delete(child)
      clearTimeout(hardTimer)
      clearTimeout(killTimer)
      resolve({
        exitCode: null,
        signal: null,
        spawnError: null,
        timedOut,
        latencyMs: Date.now() - started,
        stdout,
        stderr,
        stdoutTruncated,
        ...patch,
      })
    }
    killTimer = setTimeout(() => {
      timedOut = true
      killGroup(child, 'SIGTERM')
      hardTimer = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      if (stdout.length >= STDOUT_CAP) {
        stdoutTruncated = true
        return
      }
      stdout += d
    })
    child.stderr.on('data', (d) => {
      if (stderr.length < STDOUT_CAP) stderr += d
    })
    child.on('error', (err) => finish({ spawnError: err?.code ?? String(err) }))
    child.on('close', (code, signal) => finish({ exitCode: code, signal }))
    child.stdin.on('error', () => {})
    child.stdin.end()
  })
}

/** kimi access token 文件缺省位（env STUDIO_KIMI_TOKEN_FILE 可覆盖；同 kimi-token-refresh.mjs）。 */
export function kimiTokenFile(env = process.env) {
  const override = env?.STUDIO_KIMI_TOKEN_FILE
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  return join(homedir(), 'Library', 'Application Support', 'StudioNext', 'secrets', 'kimi-access-token')
}

/**
 * 读 kimi token（不打印、不记录值）。文件内容支持「仅 token 单行」或含 access_token 的 JSON。
 * @returns {{ token: string|null, file: string, reason: string|null, ageMs: number|null }}
 */
export function readKimiToken({ file } = {}) {
  const path = file ?? kimiTokenFile()
  // reason 会进 report（可用性预探表）——不写宿主路径；路径只放在返回值 file 字段（不打印）
  if (!existsSync(path)) return { token: null, file: path, reason: 'token 文件缺失', ageMs: null }
  let text
  let ageMs = null
  try {
    text = readFileSync(path, 'utf8')
    ageMs = Date.now() - statSync(path).mtimeMs
  } catch (err) {
    return { token: null, file: path, reason: `token 文件不可读（${err?.code ?? 'ERR'}）`, ageMs: null }
  }
  const trimmed = text.trim()
  let token = null
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (typeof obj?.access_token === 'string') token = obj.access_token.trim()
      else if (typeof obj?.accessToken === 'string') token = obj.accessToken.trim()
    } catch {
      token = null
    }
  } else {
    token = trimmed.split('\n')[0].trim()
  }
  if (!token) return { token: null, file: path, reason: 'token 文件为空或无 access_token 字段', ageMs }
  return { token, file: path, reason: null, ageMs }
}

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function which(name, env) {
  const dirs = String(env?.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const cand = join(dir, name)
    try {
      if (isFile(cand) || isFile(readlinkSync(cand))) return cand
      if (existsSync(cand)) return cand
    } catch {
      /* 下一项 */
    }
  }
  return null
}

/** 解析 dsh 可执行文件：显式 --dsh > 缺省安装位 > PATH 上的 dsh；都没有则抛（harness）。 */
export function resolveDshBin(explicit, env = process.env) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const p = explicit.trim()
    if (!existsSync(p)) throw new Error(`--dsh 指定的路径不存在：${p}`)
    return p
  }
  if (existsSync(DEFAULT_DSH_BIN)) return DEFAULT_DSH_BIN
  const onPath = which('dsh', env)
  if (onPath !== null) return onPath
  throw new Error(`找不到 dsh（缺省位 ${DEFAULT_DSH_BIN} 不存在，PATH 上也无 dsh）；用 --dsh 指定`)
}
