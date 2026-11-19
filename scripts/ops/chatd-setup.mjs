#!/usr/bin/env node
/**
 * chatd-setup —— M4.5 chatd 生产 sidecar 运维件（安装/卸载；默认 dry-run 零副作用）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M5（chatd 常驻 sidecar 化——
 *     本单是它的前置运维件：装上、闲置、不接 daemon）
 *   - docs/plan/06-…-2026-11-19.md §一（生产约定：每公司一实例、
 *     `<companyDir>/var/workbench/chat.sock|chat.db`、launchd KeepAlive）
 *   - docs/sentinel-logs/聊天自研切换-runbook-2026-11-19.md §十一（M4.5 运维章节——
 *     安装/起停/卸载/token 轮换/备份恢复/双跑切换检查单）
 *   - docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md §1.1（0700/0600 纪律）
 *
 * 形态：node 原生、零第三方依赖。三种模式：
 *   --dry-run（缺省）  打印完整安装计划 + plist 渲染预览 + 待人工执行的 launchctl 命令，
 *                      零副作用（不建目录/不写 token/不写 plist/不执行任何 launchctl）
 *   --apply            需显式 `--i-understand`（缺则 exit 2 零副作用）：建 var 目录（0700）、
 *                      生成 token 文件（64 hex，0600；**已存在不覆盖**）、写 launchd plist
 *                      （0600，`~/Library/LaunchAgents/io.studionext.chatd.<slug>.plist`）。
 *                      **不 load、不启动**——只打印 launchctl 命令由 ops 人工执行；
 *                      SQLite/chat.sock 均由 chatd 首次启动自建，本脚本不创建。
 *   --remove           需显式 `--i-understand`：删除 plist（先打印 bootout 命令，**不代执行**）；
 *                      **数据全保留**（token/chat.db/socket 目录不动——卸载不销毁证据）。
 *
 * 安全纪律：
 *   - token 永不打印（stdout 只出现路径）；plist 只带 WORKBENCH_CHATD_TOKEN_FILE 路径，
 *     不嵌 token 值（chatd config M4.5 起支持文件供给，值 env 仍优先）。
 *   - 仓内零 host 绝对路径：模板用 __占位符__，实例化只发生在目标机的
 *     ~/Library/LaunchAgents（生成物落主机不落仓）；缺省值运行时推导（repo/node/home）。
 *   - 不 load plist、不启动进程、不触碰生产 daemon（mentionSource 保持 matrix 零漂移）。
 *
 * 退出码：0=成功（dry-run 打印计划/apply 落盘/remove 完成）；1=执行失败；
 *        2=用法错误（含 --apply/--remove 缺 --i-understand）。
 *
 * 用法：
 *   node scripts/ops/chatd-setup.mjs --company-dir <公司目录> [--company <slug>] [--dry-run]
 *   node scripts/ops/chatd-setup.mjs --company-dir <公司目录> --apply --i-understand \
 *        [--company <slug>] [--repo <部署树>] [--node-bin <node>] [--home <HOME>]
 *   node scripts/ops/chatd-setup.mjs --company-dir <公司目录> --remove --i-understand [--home <HOME>]
 *   （--home/--launch-agents/--log-dir 为测试/沙箱旋钮，缺省按真实 HOME 推导）
 */
import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROG = 'chatd-setup'

/** 生产约定（与 daemon 缺省推导同源：apps/daemon/src/assembly/serve/chatd-mention-source.ts） */
export const CONVENTIONS = Object.freeze({
  varRel: ['var', 'workbench'], // <companyDir>/var/workbench
  dbFile: 'chat.db',
  socketFile: 'chat.sock',
  tokenFile: 'chatd.token',
  labelPrefix: 'io.studionext.chatd',
  plistRel: ['Library', 'LaunchAgents'],
  logRel: ['Library', 'Logs', 'studio-next'],
  logLevel: 'info',
})

/**
 * launchd plist 模板（占位符实例化——仓内零绝对路径）。
 * 与 apps/workbench-chatd/launchd/io.studionext.workbench-chat.plist.template（P1-1b 占位）
 * 同构：ProgramArguments=node main.ts（--experimental-strip-types 直跑 .ts）、
 * KeepAlive+RunAtLoad 常驻、ThrottleInterval 防抖；差异=Label 按 M4.5 任务书定
 * io.studionext.chatd.<slug>，token 走 TOKEN_FILE（不嵌值）。
 */
export const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 scripts/ops/chatd-setup.mjs 实例化（M4.5；--dry-run 可预览）。安装后不自动 load。 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>__LABEL__</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
    <string>--experimental-strip-types</string>
    <string>__CHATD_MAIN__</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__REPO__</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WORKBENCH_CHATD_SOCKET</key>
    <string>__SOCKET__</string>
    <key>WORKBENCH_CHATD_DB</key>
    <string>__DB__</string>
    <key>WORKBENCH_CHATD_TOKEN_FILE</key>
    <string>__TOKEN_FILE__</string>
    <key>WORKBENCH_CHATD_LOG</key>
    <string>__LOG_LEVEL__</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>__LOG_OUT__</string>
  <key>StandardErrorPath</key>
  <string>__LOG_ERR__</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`

/* ------------------------------------------------------------------ */
/* 纯函数面（测试直接 import）                                          */
/* ------------------------------------------------------------------ */

/** token 生成：随机 32B 十六进制（64 hex 字符）；只在此处产生，永不打印。 */
export function generateToken() {
  return randomBytes(32).toString('hex')
}

export class SetupUsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SetupUsageError'
  }
}

export function parseArgs(argv) {
  const out = { mode: 'dry-run', companyDir: '', company: '', repo: '', nodeBin: '', home: '', launchAgents: '', logDir: '', iUnderstand: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      i += 1
      const v = argv[i]
      if (v === undefined || v.startsWith('--')) throw new SetupUsageError(`参数 ${a} 缺值`)
      return v
    }
    if (a === '--dry-run') out.mode = 'dry-run'
    else if (a === '--apply') out.mode = 'apply'
    else if (a === '--remove') out.mode = 'remove'
    else if (a === '--i-understand') out.iUnderstand = true
    else if (a === '--company-dir') out.companyDir = next()
    else if (a === '--company') out.company = next()
    else if (a === '--repo') out.repo = next()
    else if (a === '--node-bin') out.nodeBin = next()
    else if (a === '--home') out.home = next()
    else if (a === '--launch-agents') out.launchAgents = next()
    else if (a === '--log-dir') out.logDir = next()
    else if (a === '--help' || a === '-h') return { ...out, help: true }
    else throw new SetupUsageError(`未知参数 ${a}`)
  }
  if (out.companyDir === '') throw new SetupUsageError('缺 --company-dir <公司目录>')
  if (!path.isAbsolute(out.companyDir)) throw new SetupUsageError(`--company-dir 须为绝对路径：${out.companyDir}`)
  return out
}

/**
 * 安装计划（纯推导，零 IO）：路径全集 + label。缺省值在此收口（测试/CLI 共用）。
 * @param {{companyDir:string, company?:string, repo:string, nodeBin:string, home:string, launchAgents?:string, logDir?:string}} input
 */
export function buildPlan(input) {
  const companyDir = path.resolve(input.companyDir)
  let slug = input.company ?? ''
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    // slug 兜底=公司目录名；label 会进 launchd，非法字符防呆
    const base = path.basename(companyDir)
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(base)) {
      throw new SetupUsageError(`公司 slug 非法（须 [a-z0-9-]，首字符字母数字）：${base}；用 --company 显式指定`)
    }
    slug = base
  }
  const normalizedSlug = slug.toLowerCase()
  const varDir = path.join(companyDir, ...CONVENTIONS.varRel)
  const home = path.resolve(input.home)
  // 空串=未指定（parseArgs 缺省 ''；直接调用方缺键=undefined，同 treated）
  const launchAgents = path.resolve(input.launchAgents !== '' && input.launchAgents !== undefined ? input.launchAgents : path.join(home, ...CONVENTIONS.plistRel))
  const logDir = path.resolve(input.logDir !== '' && input.logDir !== undefined ? input.logDir : path.join(home, ...CONVENTIONS.logRel, normalizedSlug))
  const repo = path.resolve(input.repo)
  return {
    slug: normalizedSlug,
    companyDir,
    varDir,
    dbPath: path.join(varDir, CONVENTIONS.dbFile),
    socketPath: path.join(varDir, CONVENTIONS.socketFile),
    tokenFile: path.join(varDir, CONVENTIONS.tokenFile),
    label: `${CONVENTIONS.labelPrefix}.${normalizedSlug}`,
    plistPath: path.join(launchAgents, `${CONVENTIONS.labelPrefix}.${normalizedSlug}.plist`),
    launchAgentsDir: launchAgents,
    logDir,
    logOut: path.join(logDir, 'chatd.out.log'),
    logErr: path.join(logDir, 'chatd.err.log'),
    repo,
    nodeBin: path.resolve(input.nodeBin),
    chatdMain: path.join(repo, 'apps', 'workbench-chatd', 'src', 'main.ts'),
    logLevel: CONVENTIONS.logLevel,
  }
}

/** plist 实例化（纯函数）；残留 __占位符__ 即抛错（模板/计划不齐不落盘）。 */
export function renderPlist(plan) {
  const map = {
    __LABEL__: plan.label,
    __NODE_BIN__: plan.nodeBin,
    __CHATD_MAIN__: plan.chatdMain,
    __REPO__: plan.repo,
    __SOCKET__: plan.socketPath,
    __DB__: plan.dbPath,
    __TOKEN_FILE__: plan.tokenFile,
    __LOG_LEVEL__: plan.logLevel,
    __LOG_OUT__: plan.logOut,
    __LOG_ERR__: plan.logErr,
  }
  let out = PLIST_TEMPLATE
  for (const [key, value] of Object.entries(map)) out = out.split(key).join(value)
  if (/__[A-Z_]+__/.test(out)) throw new Error(`plist 渲染残留占位符：${out.match(/__[A-Z_]+__/g)?.join(',')}`)
  return out
}

/* ------------------------------------------------------------------ */
/* 执行面                                                              */
/* ------------------------------------------------------------------ */

function fail(message, code = 1) {
  console.error(`${PROG}: FAIL ${message}`)
  process.exit(code)
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function modeOf(p) {
  return statSync(p).mode & 0o777
}

/** 原子写（tmp+rename，同卷）+ chmod；防半写。 */
function atomicWrite(file, content, mode) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`)
  writeFileSync(tmp, content, { mode })
  chmodSync(tmp, mode)
  renameSync(tmp, file)
}

function printPlan(plan) {
  console.log(`公司     slug=${plan.slug}`)
  console.log(`公司目录 ${plan.companyDir}`)
  console.log(`var 目录 ${plan.varDir}（创建 0700）`)
  console.log(`SQLite   ${plan.dbPath}（chatd 首次启动自建 0600——本脚本不创建）`)
  console.log(`socket   ${plan.socketPath}（chatd 运行时自建 0700）`)
  console.log(`token    ${plan.tokenFile}（不存在则生成 64-hex 0600；已存在不覆盖）`)
  console.log(`plist    ${plan.plistPath}（0600；只写不 load）`)
  console.log(`日志     ${plan.logOut} / ${plan.logErr}`)
  console.log(`入口     ${plan.nodeBin} --experimental-strip-types ${plan.chatdMain}`)
}

function printLaunchctl(plan) {
  const uid = 'gui/$(id -u)'
  console.log('\n--- 安装后人工执行（本脚本不执行 launchctl/不启动进程）---')
  console.log(`  启动（常驻）：launchctl bootstrap ${uid} ${plan.plistPath}`)
  console.log(`  状态查看　　：launchctl print ${uid}/${plan.label}`)
  console.log(`  手动重启　　：launchctl kickstart -k ${uid}/${plan.label}`)
  console.log(`  停止卸载　　：launchctl bootout ${uid}/${plan.label}`)
  console.log(`  健康检查　　：node scripts/ops/chatd-health.mjs --socket ${plan.socketPath} --token-file ${plan.tokenFile}`)
  console.log('  注：chatd 装上即闲置（daemon mentionSource 不动，仍 matrix 零漂移）——双跑/切换另见 runbook §十一。')
}

function dryRun(plan) {
  console.log(`${PROG} dry-run（零副作用）：`)
  printPlan(plan)
  console.log('\n--- plist 渲染预览 ---')
  console.log(renderPlist(plan))
  console.log('--- 预览结束（以上仅为打印，未写任何文件/未执行任何命令）---')
  if (!isDir(plan.companyDir)) console.log(`提醒：公司目录尚不存在（apply 前置校验会拒绝）：${plan.companyDir}`)
  if (!existsSync(plan.chatdMain)) console.log(`提醒：chatd 入口不存在（检查 --repo）：${plan.chatdMain}`)
  printLaunchctl(plan)
}

function apply(plan) {
  // 前置校验（全过才动手——fail-closed，不半装）
  if (!isDir(plan.companyDir)) fail(`公司目录不存在：${plan.companyDir}`)
  if (!existsSync(plan.chatdMain)) fail(`chatd 入口不存在（--repo 部署树不对？）：${plan.chatdMain}`)
  if (!existsSync(plan.nodeBin)) fail(`node 可执行不存在（--node-bin）：${plan.nodeBin}`)

  // 1) var 目录 0700（公司目录/var 若缺，按需创建；只对 workbench 层强制 0700）
  mkdirSync(plan.varDir, { recursive: true, mode: 0o700 })
  chmodSync(plan.varDir, 0o700)

  // 2) token 文件：已存在不覆盖（轮换走 runbook §十一，不在本工具）
  let tokenNote
  if (existsSync(plan.tokenFile)) {
    tokenNote = `已存在，不覆盖（mode=${modeOf(plan.tokenFile).toString(8).padStart(3, '0')}；轮换走 runbook）`
  } else {
    atomicWrite(plan.tokenFile, `${generateToken()}\n`, 0o600)
    tokenNote = '已生成（64-hex，0600；值不打印）'
  }
  if (modeOf(plan.tokenFile) !== 0o600) {
    // 历史遗留权限漂移：修到 0600（不视为覆盖）
    chmodSync(plan.tokenFile, 0o600)
    tokenNote += '；权限已修正为 0600'
  }

  // 3) plist（原子写 0600；不 load 不启动）
  const plistExisted = existsSync(plan.plistPath)
  atomicWrite(plan.plistPath, `${renderPlist(plan)}\n`, 0o600)

  console.log(`${PROG} apply 完成（未 load、未启动——launchctl 命令见下，由 ops 人工执行）：`)
  printPlan(plan)
  console.log(`token    ${plan.tokenFile}：${tokenNote}`)
  console.log(`plist    ${plan.plistPath}：${plistExisted ? '已重写（幂等重装）' : '已写入'}（mode=${modeOf(plan.plistPath).toString(8).padStart(3, '0')}）`)
  console.log(`var 目录 ${plan.varDir}（mode=${modeOf(plan.varDir).toString(8).padStart(3, '0')}）`)
  printLaunchctl(plan)
}

function remove(plan) {
  console.log(`${PROG} remove（数据保留，只卸 launchd 面）：`)
  const uid = 'gui/$(id -u)'
  if (existsSync(plan.plistPath)) {
    console.log(`如已 load，先人工停用（本脚本不执行 launchctl）：launchctl bootout ${uid}/${plan.label}`)
    rmSync(plan.plistPath)
    console.log(`已删 plist：${plan.plistPath}`)
  } else {
    console.log(`plist 不存在（无需删）：${plan.plistPath}`)
  }
  console.log('保留（卸载不销毁证据；如需彻底清除由 ops 人工执行）：')
  for (const [name, p] of [['token', plan.tokenFile], ['SQLite', plan.dbPath], ['socket', plan.socketPath], ['var 目录', plan.varDir]]) {
    console.log(`  ${name.padEnd(6)} ${p}${existsSync(p) ? '' : '（不存在）'}`)
  }
  console.log('  彻底清除（人工执行，含迁移历史，慎用）：rm -rf ' + plan.varDir)
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`${PROG}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }
  if (args.help) {
    console.log('用法见文件头注释；模式：--dry-run（缺省）/ --apply --i-understand / --remove --i-understand')
    return
  }
  const defaults = {
    repo: args.repo !== '' ? args.repo : path.resolve(import.meta.dirname, '..', '..'),
    nodeBin: args.nodeBin !== '' ? args.nodeBin : process.execPath,
    home: args.home !== '' ? args.home : (process.env.HOME ?? ''),
  }
  if (defaults.home === '') fail('$HOME 未设置（或用 --home 显式指定）', 2)
  if ((args.mode === 'apply' || args.mode === 'remove') && !args.iUnderstand) {
    console.error(`${PROG}: --${args.mode} 默认禁用：写/删操作须显式 --i-understand（ops 人工确认）`)
    process.exit(2)
  }
  const plan = buildPlan({ ...args, ...defaults })
  if (args.mode === 'apply') apply(plan)
  else if (args.mode === 'remove') remove(plan)
  else dryRun(plan)
}

// 直跑才执行 CLI（测试 import 纯函数零副作用）；realpath 两侧（macOS /tmp→/private/tmp 符号链接）
if (process.argv[1] !== undefined && isDirectRun()) {
  try {
    main()
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

function isDirectRun() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
