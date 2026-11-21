// stack —— `studio-next stack status|doctor|up|down|run` 命令组（M5-1 第一刀；M5-2 Linux systemd 分支；M5-3 run 前台分支）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §2.2（up=单元实例化＋加载；down=停服
//     保数据）、§2.5（卸载/停服边界）、§三（里程碑5-1 CLI 骨架刀；里程碑5-2 运维刀：
//     macOS launchd＋Linux systemd user 双分支）、§七/§八（实现记录）
//   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 里程碑5（干净机器一条命令起公司）
//   - scripts/ops/chatd-setup.mjs（dry-run 缺省/--apply 写盘/token 0600 不覆盖/原子写判例）、
//     scripts/ops/chatd-health.mjs（chatd 两步探针判例——本文件内联同款最小客户端）
//   - scripts/ops/deploy.mjs（launchctl kickstart/healthz 判例；gui/$(id -u) 域）
//
// 形态（进程面起停体检——不接 daemon 内部协议）：
//   - status：只读探测 daemon /healthz（--port，缺省 8788）、chatd socket+token（Transport v1
//     health+rooms.list 两步）、panel（--panel-port，缺省 8791）三端点；表/JSON（--json）；
//     绝不启动任何进程。缺 --company-dir 时 chatd 探针=skipped（不算失败）。
//   - doctor：六项体检（node>=24 / companyDir / daemon.yaml platform=localfile / chatd 三件权限
//     0700·0600·0600 / 备份目录可写 / 磁盘余量），缺项 exit 2 逐项明报。
//   - up/down：macOS=launchd plist（M5-1）；Linux=systemd user unit（M5-2，systemd.ts——
//     三枚写入 ~/.config/systemd/user/ 后 daemon-reload+enable --now；down=disable --now）；
//     其余平台明报 unsupported exit 3。默认 dry-run 零副作用，写盘/服务管理器调用需显式
//     --apply；所有路径显式入参（--company-dir/--deploy-root/--label-prefix…），缺省值
//     运行时推导（deploy/node/home），仓内零主机路径。
//   - 退出码：0=成功；1=用法错（缺参/未知旗标/前置缺件）或 status 有探针失败/up 加载失败；
//     2=doctor 体检缺项；3=up/down 平台或服务管理器不支持（非 macOS launchd／Linux 无
//     systemd user 会话）。
//
// 可测性：平台判定/node 版本/uid/HOME/systemd 会话在场/launchctl·systemctl 执行器/
// HTTP·chatd 探针/statfs 全部可注入（StackDeps；测试不真调 launchctl/systemctl——
// test/v2/cli/stack.test.ts）。
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statfsSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { CONCISE, SECTION } from '../usage.ts'
import { helpOk, missingSub, unknownSub, usageFail, wantsHelp } from '../help.ts'
import { errText, parseArgv } from '../argv.ts'
import { buildDownPlan, buildUpPlan, readFlatYamlScalars, STACK_CONVENTIONS, STACK_EXIT, StackUsageError } from './plists.ts'
import { checkBackupDir, checkChatdPerms, checkCompanyDir, checkDaemonPlatform, checkDiskFree, checkNodeVersion, DISK_MIN_FREE_BYTES, doctorVerdict, probeWritableDir } from './doctor.ts'
import { atomicWrite, defaultDaemonConfigPath, parsePort, parsePositiveInt, requireCompanyDir, upContext, type UpContext } from './updown.ts'
import { runDownSystemd, runUpSystemd } from './systemd.ts'
import { runRun, spawnChildReal, type SpawnedChild } from './run.ts'

const PROG = 'stack'
const SUBCOMMANDS = ['status', 'doctor', 'up', 'down', 'run'] as const
const CHATD_PROTOCOL = 'workbench-transport/v1'

/** 退出码（usage.ts 尾部声明面同源；定义收口 plists.ts——systemd 分支共用） */
export { STACK_EXIT } from './plists.ts'

/* ------------------------------------------------------------------ */
/* 可注入依赖面（测试不真调 launchctl/不碰真 HOME/不依赖真平台）          */
/* ------------------------------------------------------------------ */

export interface HttpProbeResult {
  readonly http: number | null
  readonly body: string | null
  readonly error: string | null
}

export interface ChatdProbeResult {
  readonly state: 'up' | 'down'
  readonly server?: string
  readonly rooms?: number
  readonly reason?: string
}

export interface RunResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface StackDeps {
  readonly platform: string
  readonly nodeVersion: string
  readonly home: string
  readonly env: Record<string, string | undefined>
  readonly uid: number
  /** systemd user 会话在场（缺省=/run/systemd/users/<uid> 存在性——loginctl enable-linger 面） */
  readonly systemdAvailable: boolean
  readonly run: (argv: readonly string[]) => RunResult
  readonly httpGet: (url: string, timeoutMs: number) => Promise<HttpProbeResult>
  readonly chatdProbe: (socketPath: string, tokenFile: string, timeoutMs: number) => Promise<ChatdProbeResult>
  readonly statfs: (p: string) => { bavail: number; bsize: number }
  /** 子进程拉起（run 前台分支专用——缺省 spawnChildReal；测试注入 fake 零真进程） */
  readonly spawnChild: (cmd: string, args: readonly string[], opts: { cwd: string; env: Record<string, string | undefined> }) => SpawnedChild
  /** 计时睡眠（就绪轮询节拍——测试注 no-op 快进） */
  readonly sleep: (ms: number) => Promise<void>
  /** 时钟（就绪窗口判定——测试注入可控步进） */
  readonly now: () => number
  /** 信号注册（SIGINT/SIGTERM 优雅停；返回退订——测试注入假信号源） */
  readonly onSignal: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => () => void
}

export type StackDepsInit = Partial<StackDeps>

function resolveDeps(init: StackDepsInit): StackDeps {
  return {
    platform: init.platform ?? process.platform,
    nodeVersion: init.nodeVersion ?? process.versions.node,
    home: init.home ?? (process.env.HOME ?? ''),
    env: init.env ?? process.env,
    uid: init.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0),
    systemdAvailable: init.systemdAvailable ?? existsSync(`/run/systemd/users/${String(typeof process.getuid === 'function' ? process.getuid() : 0)}`),
    run:
      init.run ??
      ((argv) => {
        const res = spawnSync(argv[0] ?? '', argv.slice(1), { encoding: 'utf8' })
        return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
      }),
    httpGet: init.httpGet ?? httpGetReal,
    chatdProbe: init.chatdProbe ?? probeChatdReal,
    statfs: init.statfs ?? ((p) => statfsSync(p)),
    spawnChild: init.spawnChild ?? spawnChildReal,
    sleep: init.sleep ?? ((ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })),
    now: init.now ?? (() => Date.now()),
    onSignal: init.onSignal ?? ((signal, handler) => {
      process.on(signal, handler)
      return () => {
        process.off(signal, handler)
      }
    }),
  }
}

/** 真探针：fetch + 超时（Node 24 全局 fetch；fail-closed 只回观测，不抛） */
async function httpGetReal(url: string, timeoutMs: number): Promise<HttpProbeResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return { http: res.status, body: await res.text(), error: null }
  } catch (err) {
    return { http: null, body: null, error: errText(err) }
  }
}

/** chatd NDJSON 单请求（chatd-health.mjs request 同款最小实现；不 import ops 脚本保持 CLI 零耦合） */
function chatdRequest(socketPath: string, frame: { id: string; method: string; params: { token: string } }, deadlineMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    let buffer = ''
    const socket = net.createConnection({ path: socketPath })
    const settle = (ok: boolean, value: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (ok) resolve(value)
      else reject(value instanceof Error ? value : new Error(String(value)))
    }
    const timer = setTimeout(() => settle(false, new Error('超时（无应答）')), Math.max(1, deadlineMs - Date.now()))
    socket.on('connect', () => socket.write(`${JSON.stringify(frame)}\n`))
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const idx = buffer.indexOf('\n')
      if (idx < 0) return
      let msg: { id?: string; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } }
      try {
        msg = JSON.parse(buffer.slice(0, idx).trim()) as typeof msg
      } catch {
        settle(false, new Error('协议帧非 JSON'))
        return
      }
      if (msg.id !== frame.id) return // 乱序他帧（不应发生）：忽略
      if (msg.ok === true) settle(true, msg.result ?? {})
      else settle(false, new Error(`${msg.error?.code ?? 'WB_PROTOCOL'} ${msg.error?.message ?? ''}`))
    })
    socket.on('error', (err: NodeJS.ErrnoException) =>
      settle(false, new Error(`${err.message}${err.code === 'ENOENT' ? '（socket 不存在：chatd 未启动？）' : err.code === 'ECONNREFUSED' ? '（socket 在但无监听者）' : ''}`)),
    )
    socket.on('close', () => settle(false, new Error('连接在应答前被对端关闭')))
  })
}

/** 真探针：chatd 两步（health + rooms.list）——token 只读不打印 */
async function probeChatdReal(socketPath: string, tokenFile: string, timeoutMs: number): Promise<ChatdProbeResult> {
  let token = ''
  try {
    token = readFileSync(tokenFile, 'utf8').trim()
  } catch {
    return { state: 'down', reason: `token 文件不可读：${tokenFile}（先 stack up --apply 或 chatd-setup --apply）` }
  }
  if (token === '') return { state: 'down', reason: `token 文件为空：${tokenFile}` }
  const deadline = Date.now() + timeoutMs
  try {
    const health = (await chatdRequest(socketPath, { id: 'stack-health', method: 'health', params: { token } }, deadline)) as { ok?: unknown; protocol?: unknown; server?: unknown }
    if (health.ok !== true || health.protocol !== CHATD_PROTOCOL) {
      return { state: 'down', reason: `health 应答异常（protocol=${JSON.stringify(health.protocol)}，期望 ${CHATD_PROTOCOL}）` }
    }
    const rooms = await chatdRequest(socketPath, { id: 'stack-rooms', method: 'rooms.list', params: { token } }, deadline)
    if (!Array.isArray(rooms)) return { state: 'down', reason: 'rooms.list 应答非数组' }
    return { state: 'up', server: String(health.server ?? ''), rooms: rooms.length }
  } catch (err) {
    return { state: 'down', reason: errText(err) }
  }
}

/* ------------------------------------------------------------------ */
/* status：判定纯函数 + 只读探测                                        */
/* ------------------------------------------------------------------ */

export interface StatusRow {
  readonly id: 'daemon' | 'chatd' | 'panel'
  readonly target: string
  readonly state: 'up' | 'down' | 'skipped'
  readonly detail: string
}

/** daemon 判定：/healthz 200 ∧ body.ok=true（503/超时/解析失败=down——fail-closed 不谎报） */
export function judgeDaemonHealth(probe: HttpProbeResult): 'up' | 'down' {
  if (probe.error !== null || probe.http === null || probe.http !== 200) return 'down'
  try {
    return (JSON.parse(probe.body ?? '') as { ok?: unknown }).ok === true ? 'up' : 'down'
  } catch {
    return 'down'
  }
}

/** panel 判定：GET / 任一 2xx 即活（面板根路由 200 HTML——packages/panel server.ts） */
export function judgePanelHealth(probe: HttpProbeResult): 'up' | 'down' {
  return probe.error === null && probe.http !== null && probe.http >= 200 && probe.http < 300 ? 'up' : 'down'
}

/** 汇总裁定：failed 只数 down；skipped（如未给 --company-dir 的 chatd）不算失败 */
export function summarizeStatus(rows: readonly StatusRow[]): { failed: number; skipped: number } {
  return {
    failed: rows.filter((r) => r.state === 'down').length,
    skipped: rows.filter((r) => r.state === 'skipped').length,
  }
}

async function runStatus(flags: Map<string, string>, json: boolean, deps: StackDeps): Promise<number> {
  const port = parsePort(flags.get('port') ?? '8788', 'port')
  const panelPort = parsePort(flags.get('panel-port') ?? '8791', 'panel-port')
  const timeoutMs = parsePositiveInt(flags.get('timeout-ms') ?? '3000', 'timeout-ms')
  const daemonUrl = `http://127.0.0.1:${port}/healthz`
  const panelUrl = `http://127.0.0.1:${panelPort}/`
  const rows: StatusRow[] = []

  const daemonProbe = await deps.httpGet(daemonUrl, timeoutMs)
  const daemonState = judgeDaemonHealth(daemonProbe)
  rows.push({
    id: 'daemon',
    target: daemonUrl,
    state: daemonState,
    detail: daemonState === 'down' ? `探针失败：${daemonProbe.error ?? `http=${String(daemonProbe.http)}`}` : daemonDetail(daemonProbe.body),
  })

  const companyDir = flags.get('company-dir') ?? ''
  if (companyDir === '') {
    rows.push({ id: 'chatd', target: '(未给 --company-dir，跳过)', state: 'skipped', detail: '无法推导 socket/token' })
  } else {
    const varDir = path.join(path.resolve(companyDir), ...STACK_CONVENTIONS.varRel)
    const socketPath = path.join(varDir, STACK_CONVENTIONS.socketFile)
    const chatd = await deps.chatdProbe(socketPath, path.join(varDir, STACK_CONVENTIONS.tokenFile), timeoutMs)
    rows.push({
      id: 'chatd',
      target: socketPath,
      state: chatd.state,
      detail: chatd.state === 'up' ? `server=${chatd.server ?? '?'} rooms=${String(chatd.rooms ?? '?')}` : (chatd.reason ?? '探针失败'),
    })
  }

  const panelProbe = await deps.httpGet(panelUrl, timeoutMs)
  const panelState = judgePanelHealth(panelProbe)
  rows.push({ id: 'panel', target: panelUrl, state: panelState, detail: panelState === 'up' ? `http ${String(panelProbe.http)}` : `探针失败：${panelProbe.error ?? `http=${String(panelProbe.http)}`}` })

  const summary = summarizeStatus(rows)
  if (json) {
    console.log(JSON.stringify({ command: 'stack status', rows, failed: summary.failed, skipped: summary.skipped }, null, 2))
  } else {
    console.log('stack status（只读探测——不启动任何进程）')
    for (const row of rows) console.log(`  ${row.id.padEnd(6)} ${row.state === 'up' ? '● up  ' : row.state === 'skipped' ? '- skip' : '○ down'}  ${row.target}  ${row.detail}`)
    console.log(summary.failed === 0 ? `结论 0 失败（${summary.skipped > 0 ? `跳过 ${String(summary.skipped)} 项；` : ''}exit 0）` : `结论 ${String(summary.failed)} 项失败（exit 1）——up 起服后复测`)
  }
  return summary.failed === 0 ? STACK_EXIT.ok : STACK_EXIT.usage
}

function daemonDetail(body: string | null): string {
  try {
    const parsed = JSON.parse(body ?? '') as { pid?: unknown; tick?: { seq?: unknown } }
    return `ok=true pid=${String(parsed.pid ?? '?')}${parsed.tick !== undefined ? ` tick=${String(parsed.tick.seq ?? '?')}` : ''}`
  } catch {
    return 'ok=true'
  }
}


function runDoctor(flags: Map<string, string>, json: boolean, deps: StackDeps): number {
  const companyDir = requireCompanyDir(flags)
  const configPath = path.resolve(flags.get('config') ?? defaultDaemonConfigPath(companyDir))
  const backupDir = path.resolve(flags.get('backup-dir') ?? deps.env['PLATFORM_BACKUP_DIR'] ?? path.join(deps.home === '' ? '.' : deps.home, 'backups', 'studio-next'))

  const dirStat = statQuiet(companyDir)
  let platform: string | null = null
  let configError: string | null = null
  if (existsSync(configPath)) {
    try {
      platform = readFlatYamlScalars(readFileSync(configPath, 'utf8'))['platform'] ?? null
    } catch (err) {
      configError = errText(err)
    }
  }
  const varDir = path.join(path.resolve(companyDir), ...STACK_CONVENTIONS.varRel)
  const chatdItems = (['socket', 'db', 'token'] as const).map((kind) => {
    const file = kind === 'socket' ? STACK_CONVENTIONS.socketFile : kind === 'db' ? STACK_CONVENTIONS.dbFile : STACK_CONVENTIONS.tokenFile
    const p = path.join(varDir, file)
    const st = statQuiet(p)
    return { kind, path: p, exists: st.exists && !st.isDir, mode: st.exists && !st.isDir ? (st.mode & 0o777) : null }
  })

  let freeBytes: number | null = null
  if (dirStat.exists) {
    try {
      freeBytes = deps.statfs(companyDir).bavail * deps.statfs(companyDir).bsize
    } catch {
      freeBytes = null
    }
  }

  const checks = [
    checkNodeVersion(deps.nodeVersion),
    checkCompanyDir(companyDir, { exists: dirStat.exists, isDir: dirStat.isDir }),
    checkDaemonPlatform({ path: configPath, exists: existsSync(configPath), platform, error: configError }),
    checkChatdPerms(chatdItems),
    checkBackupDir(backupDir, probeWritableDir(backupDir)),
    checkDiskFree(freeBytes, DISK_MIN_FREE_BYTES),
  ]
  const verdict = doctorVerdict(checks)
  if (json) {
    console.log(JSON.stringify({ command: 'stack doctor', checks, pass: verdict.pass, failed: verdict.failed }, null, 2))
  } else {
    console.log('stack doctor（六项体检；缺项 exit 2）')
    checks.forEach((check, i) => {
      console.log(`  ${String(i + 1)}. ${check.ok ? '● ok  ' : '○ FAIL'} ${check.name.padEnd(6)} ${check.detail}`)
      if (!check.ok && check.hint !== undefined) console.log(`       ↳ ${check.hint}`)
    })
    console.log(verdict.pass ? `结论 PASS（${String(checks.length)}/${String(checks.length)}）——可 stack up` : `结论 FAIL（${String(checks.length - verdict.failed)}/${String(checks.length)}）——缺项 exit 2`)
  }
  return verdict.pass ? STACK_EXIT.ok : STACK_EXIT.doctor
}

function statQuiet(p: string): { exists: boolean; isDir: boolean; mode: number } {
  try {
    const st = statSync(p)
    return { exists: true, isDir: st.isDirectory(), mode: st.mode }
  } catch {
    return { exists: false, isDir: false, mode: 0 }
  }
}

/* ------------------------------------------------------------------ */
/* up / down：dry-run 缺省 + --apply 写面（macOS launchd＋Linux systemd） */
/* ------------------------------------------------------------------ */

/**
 * 服务管理器判定（M5-2 双分支）：darwin=launchd；linux=systemd user（须 systemd user
 * 会话在场——/run/systemd/users/<uid>，缺则明报 enable-linger 面）；其余平台 unsupported。
 * 返回 undefined=通过；返回数字=已打错误面的退出码。
 */
function serviceManagerMode(deps: StackDeps): 'launchd' | 'systemd' | number {
  if (deps.platform === 'darwin') return 'launchd'
  if (deps.platform === 'linux') {
    if (deps.systemdAvailable) return 'systemd'
    console.error(`stack：up/down 在 Linux 需 systemd user 会话（/run/systemd/users/${String(deps.uid)} 不在场——loginctl enable-linger <user> 开常驻会话后复跑，或前台模式跑 daemon；plan/08 §八）`)
    return STACK_EXIT.unsupported
  }
  console.error(`stack：up/down 仅支持 macOS launchd 与 Linux systemd user（当前 platform=${deps.platform}——plan/08 §2.2/§八）`)
  return STACK_EXIT.unsupported
}

async function runUp(flags: Map<string, string>, apply: boolean, deps: StackDeps): Promise<number> {
  const mode = serviceManagerMode(deps)
  if (typeof mode === 'number') return mode
  const ctx = upContext(flags, apply, deps) // 双分支公共前置（含两档体检）
  return mode === 'systemd' ? runUpSystemd({ flags, apply, deps, ctx }) : runUpLaunchd(flags, apply, deps, ctx)
}

function runDown(flags: Map<string, string>, apply: boolean, deps: StackDeps): number {
  const mode = serviceManagerMode(deps)
  if (typeof mode === 'number') return mode
  return mode === 'systemd' ? runDownSystemd({ flags, apply, deps }) : runDownLaunchd(flags, apply, deps)
}

/** up（macOS launchd 分支——M5-1 形态保持不变） */
async function runUpLaunchd(flags: Map<string, string>, apply: boolean, deps: StackDeps, ctx: UpContext): Promise<number> {
  const plan = buildUpPlan({
    companyDir: ctx.companyDir,
    company: ctx.company,
    deployRoot: ctx.deployRoot,
    nodeBin: ctx.nodeBin,
    guardianConfig: ctx.guardianConfig,
    daemonConfigPath: ctx.configPath,
    daemonDb: ctx.daemonDb,
    port: ctx.port,
    panelPort: ctx.panelPort,
    home: ctx.home,
    labelPrefix: flags.get('label-prefix') ?? STACK_CONVENTIONS.labelPrefix,
    launchAgents: flags.get('launch-agents') ?? '',
    logDir: flags.get('log-dir') ?? '',
  })

  // 前置体检已由 upContext 收拢（ctx.warnings/ctx.missing；两档——dry-run 软提醒不拦预览、--apply 硬拒）
  if (apply && ctx.missing.length > 0) {
    for (const line of ctx.missing) console.error(`stack up：前置缺件：${line}`)
    return STACK_EXIT.usage
  }

  console.log(apply ? 'stack up --apply（写盘+bootstrap）' : 'stack up dry-run（零副作用——写盘与加载需 --apply）')
  console.log(`  公司     slug=${plan.slug}`)
  console.log(`  公司目录 ${plan.companyDir}`)
  console.log(`  部署树   ${plan.deployRoot}`)
  for (const service of plan.services) {
    console.log(`  ${service.id.padEnd(6)} label=${service.label}`)
    console.log(`         plist=${service.plistPath}`)
    console.log(`         日志=${path.dirname(service.logOut)}/${path.basename(service.logOut)}|${path.basename(service.logErr)}`)
  }
  for (const warning of ctx.warnings) console.log(`  提醒  ${warning}`)
  console.log('--- 将执行（--apply）---')
  for (const service of plan.services) console.log(`  ${service.bootstrapCmd}（已加载的先 bootout 再 bootstrap——幂等重入）`)
  if (!apply) {
    for (const service of plan.services) {
      console.log(`--- plist 渲染预览（${service.id}；未写任何文件/未执行任何命令）---`)
      console.log(service.plist)
    }
    return STACK_EXIT.ok
  }

  // --apply：① var 目录 0700 ② token 首产 0600（在场不覆盖，权限漂移修回）③ plist 原子写 0600 ④ bootstrap
  mkdirSync(plan.varDir, { recursive: true })
  chmodSync(plan.varDir, 0o700)
  const results: string[] = []
  if (!existsSync(plan.tokenFile)) {
    atomicWrite(plan.tokenFile, randomBytes(32).toString('hex'), 0o600)
    results.push(`token 首产 0600：${plan.tokenFile}（值不打印）`)
  } else {
    chmodSync(plan.tokenFile, 0o600)
    results.push(`token 已在场，保留不覆盖（chmod 0600 复核）：${plan.tokenFile}`)
  }
  for (const service of plan.services) {
    const existed = existsSync(service.plistPath)
    atomicWrite(service.plistPath, service.plist, 0o600)
    results.push(`${service.id} plist ${existed ? '幂等重写（同字节）' : '已写入'} 0600：${service.plistPath}`)
  }
  let failed = 0
  for (const service of plan.services) {
    deps.run(['launchctl', 'bootout', `gui/${String(deps.uid)}/${service.label}`]) // 未加载时的失败=预期，忽略
    const boot = deps.run(['launchctl', 'bootstrap', `gui/${String(deps.uid)}`, service.plistPath])
    if (boot.status === 0) results.push(`${service.id} bootstrap ok（label=${service.label}）`)
    else {
      failed += 1
      console.error(`stack up：bootstrap 失败（${service.label}，exit ${String(boot.status)}）：${(boot.stderr !== '' ? boot.stderr : boot.stdout).trim().slice(0, 300)}`)
    }
  }
  for (const line of results) console.log(`  ${line}`)
  if (failed > 0) {
    console.error(`stack up：${String(failed)} 项 bootstrap 失败——launchctl print gui/$(id -u)/<label> 查因；plist/数据已就位，修复后重跑（幂等）`)
    return STACK_EXIT.usage
  }
  console.log('  下一步：studio-next stack status 验证三端点；studio-next stack doctor 复检六项')
  return STACK_EXIT.ok
}

/** down（macOS launchd 分支——M5-1 形态保持不变） */
function runDownLaunchd(flags: Map<string, string>, apply: boolean, deps: StackDeps): number {
  const companyDir = requireCompanyDir(flags)
  const plan = buildDownPlan({ companyDir, company: flags.get('company') ?? '', labelPrefix: flags.get('label-prefix') ?? STACK_CONVENTIONS.labelPrefix })
  console.log(apply ? 'stack down --apply（bootout 三服务）' : 'stack down dry-run（零副作用——停服需 --apply）')
  for (const cmd of plan.bootoutCmds) console.log(`  ${cmd}`)
  console.log('  保留面：plist 文件与数据全不动（socket/db/token/公司目录——卸载销毁走 chatd-setup --remove，plan/08 §2.5）')
  if (!apply) return STACK_EXIT.ok
  const labels = [plan.labels.daemon, plan.labels.chatd, plan.labels.panel]
  for (const label of labels) {
    const res = deps.run(['launchctl', 'bootout', `gui/${String(deps.uid)}/${label}`])
    if (res.status === 0) console.log(`  ${label} bootout ok`)
    else console.log(`  ${label} 未加载/已停（exit ${String(res.status)}：${(res.stderr !== '' ? res.stderr : res.stdout).trim().slice(0, 160)}）`)
  }
  console.log('  数据保留：三服务进程已停；复起=stack up --apply（幂等重入）')
  return STACK_EXIT.ok
}

/* ------------------------------------------------------------------ */
/* 参数面与分发                                                         */
/* ------------------------------------------------------------------ */

const VALUE_FLAGS = new Set([
  'company-dir', 'company', 'config', 'port', 'panel-port', 'timeout-ms', 'backup-dir',
  'deploy-root', 'node-bin', 'label-prefix', 'guardian-config', 'home', 'launch-agents', 'log-dir',
  'env-file', 'user-units-dir', // M5-2 systemd 分支（--user-units-dir 为测试/沙箱注入口）
  'daemon-args', 'ready-timeout-ms', 'stop-timeout-ms', // M5-3 run 前台分支
])

export async function cmdStack(argv: string[], depsInit: StackDepsInit = {}): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION.stack) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, VALUE_FLAGS, undefined, new Set(['json', 'apply', 'no-chatd']))
  if ('error' in parsed) return usageFail(PROG, parsed.error, CONCISE.stack)
  const [sub, ...extra] = parsed.positionals
  if (sub === undefined) return missingSub(PROG, [...SUBCOMMANDS], CONCISE.stack)
  if (!SUBCOMMANDS.includes(sub as (typeof SUBCOMMANDS)[number])) return unknownSub(PROG, sub, [...SUBCOMMANDS], CONCISE.stack)
  if (extra.length > 0) return usageFail(PROG, `多余的位置参数：${extra.join(' ')}`, CONCISE.stack)
  const deps = resolveDeps(depsInit)
  try {
    if (sub === 'status') return await runStatus(new Map(Object.entries(parsed.flags)), parsed.booleans.has('json'), deps)
    if (sub === 'doctor') return runDoctor(new Map(Object.entries(parsed.flags)), parsed.booleans.has('json'), deps)
    if (sub === 'up') return await runUp(new Map(Object.entries(parsed.flags)), parsed.booleans.has('apply'), deps)
    if (sub === 'run') return await runRun(new Map(Object.entries(parsed.flags)), parsed.booleans.has('no-chatd'), deps)
    return runDown(new Map(Object.entries(parsed.flags)), parsed.booleans.has('apply'), deps)
  } catch (err) {
    if (err instanceof StackUsageError) return usageFail(PROG, err.message, CONCISE.stack)
    throw err
  }
}
