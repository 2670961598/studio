#!/usr/bin/env node
/**
 * chatd-health —— M4.5 chatd sidecar 健康/观测探针（读 socket+token 走 Transport v1）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M5（sidecar 运维面）
 *   - docs/sentinel-logs/聊天自研切换-runbook-2026-11-19.md §十一（M4.5 运维章节）
 *
 * 形态：node 原生、零第三方依赖（node:net + node:fs）。协议=workbench-transport/v1
 * （NDJSON 帧、id 关联、params.token 鉴权——与 packages/workbench-transport/src/client.ts
 * 同 wire 格式；本脚本独立实现最小只读客户端，不 import 包：ops 脚本零 workspace 依赖）。
 *
 * 探测两步（全过才 HEALTHY）：
 *   1) health   ：ok:true + protocol=workbench-transport/v1（server 版本串披露）
 *   2) rooms.list：ok:true（房间计数；auth 用同 token——顺带实证鉴权面）
 *
 * 退出码：0=HEALTHY；1=UNHEALTHY（连接失败/超时/鉴权失败/协议异常——每步一行可读输出）；
 *        2=用法错误（缺参/token 文件不可读等）。
 * 纪律：token 永不打印（stdout 只有路径与计数）；全程超时可配（缺省 3000ms，含连接+应答）。
 *
 * 用法：
 *   node scripts/ops/chatd-health.mjs --socket <path> --token <tok>
 *   node scripts/ops/chatd-health.mjs --socket <path> --token-file <path>
 *   node scripts/ops/chatd-health.mjs --company-dir <companyDir>   # 推导 socket/token 文件（与 chatd-setup 同约定）
 *   可选：--timeout-ms <N>（缺省 3000） --json（单行 JSON 摘要）
 */
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const PROG = 'chatd-health'
const PROTOCOL = 'workbench-transport/v1'
const DEFAULT_TIMEOUT_MS = 3000

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { socket: '', token: '', tokenFile: '', companyDir: '', timeoutMs: DEFAULT_TIMEOUT_MS, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      i += 1
      const v = argv[i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`参数 ${a} 缺值`)
      return v
    }
    if (a === '--socket') out.socket = next()
    else if (a === '--token') out.token = next()
    else if (a === '--token-file') out.tokenFile = next()
    else if (a === '--company-dir') out.companyDir = next()
    else if (a === '--timeout-ms') {
      const v = next()
      if (!/^\d+$/.test(v) || Number(v) < 1) throw new UsageError(`--timeout-ms 须为正整数：${v}`)
      out.timeoutMs = Number(v)
    } else if (a === '--json') out.json = true
    else if (a === '--help' || a === '-h') return { ...out, help: true }
    else throw new UsageError(`未知参数 ${a}`)
  }
  // company-dir 推导（与 chatd-setup CONVENTIONS 同源约定：<cd>/var/workbench/{chat.sock,chatd.token}）
  if (out.companyDir !== '') {
    if (out.socket !== '') throw new UsageError('--company-dir 与 --socket 互斥')
    if (out.tokenFile !== '') throw new UsageError('--company-dir 与 --token-file 互斥')
    out.socket = path.join(out.companyDir, 'var', 'workbench', 'chat.sock')
    out.tokenFile = path.join(out.companyDir, 'var', 'workbench', 'chatd.token')
  }
  if (out.socket === '') throw new UsageError('缺 --socket <path>（或 --company-dir <dir> 推导）')
  if (out.token === '' && out.tokenFile === '') throw new UsageError('缺 --token <tok> 或 --token-file <path>')
  if (!path.isAbsolute(out.socket)) throw new UsageError(`--socket 须为绝对路径：${out.socket}`)
  return out
}

/** 单请求：connect→write 帧→收同 id 的单行 JSON 应答；deadline 为绝对时刻（含连接+应答）。 */
function request(socketPath, frame, deadlineMs) {
  return new Promise((resolve, reject) => {
    const id = frame.id
    let settled = false
    let buffer = ''
    const done = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn(arg)
    }
    const socket = net.createConnection({ path: socketPath })
    const timer = setTimeout(
      () => done(reject, new Error(`超时（${frame.method} 无应答，剩余预算耗尽）`)),
      Math.max(1, deadlineMs - Date.now()),
    )
    socket.on('connect', () => socket.write(`${JSON.stringify(frame)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const idx = buffer.indexOf('\n')
      if (idx < 0) return
      const line = buffer.slice(0, idx).trim()
      if (line === '') return
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return done(reject, new Error(`协议帧非 JSON：${line.slice(0, 120)}`))
      }
      if (msg.id !== id) return // 乱序他帧（不应发生）：忽略
      if (msg.ok === true) done(resolve, msg.result)
      else {
        const err = msg.error ?? {}
        const authHint = String(err.message ?? '').startsWith('unauthenticated:') ? '（token 缺失/不符——检查 token 文件或轮换窗口）' : ''
        done(reject, new Error(`${String(err.code ?? 'WB_PROTOCOL')} ${String(err.message ?? '')}${authHint}`))
      }
    })
    socket.on('error', (err) => {
      const hint = err.code === 'ENOENT' ? '（socket 文件不存在：chatd 未安装/未启动？）' : err.code === 'ECONNREFUSED' ? '（socket 在但无监听者：chatd 已死？——launchctl print 看护）' : ''
      done(reject, new Error(`${err.message}${hint}`))
    })
    socket.on('close', () => done(reject, new Error('连接在应答前被对端关闭（chatd draining/崩溃？）')))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：chatd-health.mjs (--socket <p> (--token <t>|--token-file <p>) | --company-dir <d>) [--timeout-ms N] [--json]')
    return 0
  }
  let token = args.token
  if (token === '' && args.tokenFile !== '') {
    if (!path.isAbsolute(args.tokenFile)) throw new UsageError(`--token-file 须为绝对路径：${args.tokenFile}`)
    if (!existsSync(args.tokenFile)) throw new UsageError(`token 文件不存在：${args.tokenFile}（先跑 chatd-setup --apply）`)
    token = readFileSync(args.tokenFile, 'utf8').trim()
    if (token === '') throw new UsageError(`token 文件为空：${args.tokenFile}`)
  }
  const start = Date.now()
  const deadline = start + args.timeoutMs
  const report = { ok: false, socket: args.socket, server: null, protocol: null, rooms: null, auth: 'token', elapsedMs: null }

  const say = (line) => {
    if (!args.json) console.log(line)
  }
  say(`${PROG}：socket=${args.socket} timeout=${String(args.timeoutMs)}ms token=${args.tokenFile !== '' ? `file:${args.tokenFile}` : 'env 值（不打印）'}`)

  // 1) health
  try {
    const health = await request(args.socket, { id: 'health-1', method: 'health', params: { token } }, deadline)
    if (health?.ok !== true || health?.protocol !== PROTOCOL) {
      throw new Error(`health 应答异常：ok=${JSON.stringify(health?.ok)} protocol=${JSON.stringify(health?.protocol)}（期望 protocol=${PROTOCOL}）`)
    }
    report.server = String(health.server ?? '')
    report.protocol = String(health.protocol ?? '')
    say(`  health   ok server=${report.server} protocol=${report.protocol}`)
  } catch (err) {
    say(`  health   FAIL ${err instanceof Error ? err.message : String(err)}`)
    report.elapsedMs = Date.now() - start
    finish(args, report, `health 失败：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // 2) rooms.list（顺带实证 token 鉴权面）
  try {
    const rooms = await request(args.socket, { id: 'rooms-1', method: 'rooms.list', params: { token } }, deadline)
    if (!Array.isArray(rooms)) throw new Error(`rooms.list 应答非数组：${JSON.stringify(rooms).slice(0, 80)}`)
    report.rooms = rooms.length
    say(`  rooms    ok rooms=${String(report.rooms)}`)
  } catch (err) {
    say(`  rooms    FAIL ${err instanceof Error ? err.message : String(err)}`)
    report.elapsedMs = Date.now() - start
    finish(args, report, `rooms.list 失败：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  report.ok = true
  report.elapsedMs = Date.now() - start
  finish(args, report, null)
  return 0
}

function finish(args, report, reason) {
  if (args.json) {
    console.log(JSON.stringify({ ...report, ...(reason !== null ? { reason } : {}) }))
  } else {
    console.log(reason === null ? `  结论     HEALTHY（exit 0，${String(report.elapsedMs)}ms）` : `  结论     UNHEALTHY：${reason}（exit 1，${String(report.elapsedMs)}ms）`)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UsageError) {
      console.error(`${PROG}: ${err.message}`)
      process.exit(2)
    }
    console.error(`${PROG}: FAIL ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
