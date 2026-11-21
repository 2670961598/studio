#!/usr/bin/env node
/**
 * clean-machine-e2e —— 干净机器 E2E 烟测（M5-4b，2026-11-22；docs/plan/08-§〇/§三 里程碑5-4）
 *
 * 定位（与 dist-smoke 的边界）：dist-smoke 验「干净**目录**」——解包＋doctor 五项绿；
 * 本件验「干净**机器**闭环的脚本化子集」——在**本机**以临时 HOME＋解包树模拟干净机器，
 * 起真 daemon＋chatd 双进程到 READY，验端点＋备份＋优雅停＋重启恢复。
 * §四 清单中的 #3（建单）/#4（派发收割闭环）/#5（聊天 wake）不在此件——jobs: false
 * 只验装配与端点，不验真实派工（§十 M5-4b 记录的「限制」面）。
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/08-M5打包分发-2026-11-20.md §〇（干净机器：无 Docker/Taiga/Matrix 起公司）、
 *     §三 里程碑5-4（按 §四 清单落盘证据）、§四 #0/#1/#2/#6/#7（本件覆盖的子集）、
 *     §九（stack run 前台双进程——READY/SIGTERM 停序判例）、§十（pack-dist/dist-smoke 判例）；
 *   - apps/daemon/src/cli/stack/run.ts（buildRunPlan：daemon=apps/daemon/src/index.ts
 *     `--config`；chatd=apps/workbench-chatd/src/main.ts env 四键；READY 行格式）、
 *     apps/daemon/src/cli/stack/stack.ts（status rows daemon/chatd/panel）；
 *   - scripts/ops/platform-backup.sh（--skip-docker：docker 段 SKIP 不算失败；
 *     --core-company 三面 platform/ledger.sqlite/company；--chatd-db 在线 .backup；
 *     SUMMARY JSON 尾行）；
 *   - packages/company/src/create.ts（--platform-root/--db 旗标；git 署名走 env——
 *     临时 HOME 无全局 git 配置，故本件显式供 GIT_AUTHOR_* 与 GIT_COMMITTER_* 环境署名）。
 *
 * 形态（零新依赖，node:child_process/fs/net 内建面）：
 *   - 输入 `--dist <tgz>`（pack-dist 产物）；解包到临时树 `<tmp>/tree`；
 *   - 临时基按 chatd Unix socket 路径长度选（macOS sun_path=104 含 NUL——/var/folders/…
 *     长前缀会 listen EINVAL，实测判例；预算内最短可写基优先，/tmp 兜底）；
 *   - 临时 HOME `<tmp>/home`（隔离 ~/.config 与 git 全局配置；XDG_CONFIG_HOME 同步指过去；
 *     全程不碰 launchd/systemd——run 面零服务管理器写入，事后断言 LaunchAgents 不在场）；
 *     **PATH 原样保留**（docker 在不在 PATH 都可跑——备份走 --skip-docker，容器段 SKIP）；
 *   - 公司布局（对齐备份脚本 --core-company 三面约定，production 同构）：
 *       <tmp>/<slug>/company        公司 git 目录（template company-2-level）
 *       <tmp>/<slug>/platform       localfile 平台根（--platform-root 钉）
 *       <tmp>/<slug>/ledger.sqlite  台账（--db 钉）
 *       <tmp>/<slug>/var/daemon.yaml 最小配置（本件自写，覆盖 create 顺产骨架——骨架的
 *       platformDir 推导为 <work>/var/platform，与本处 --platform-root 不一致，自写钉齐三路径）
 *   - daemon.yaml 最小面：db/platform/company/companyDir/rootDir/platformDir/apiPort/tickMs
 *     ＋ **jobs: false**（config-types.ts:99 `jobs: boolean` 为已支持字段——定时岗调度关，
 *     E2E 只验装配与端点）；mentionSource 不写（缺省 matrix 且 matrix 未开=零装配；
 *     且 stack run 走 index.ts 直装配不经 boot——§十 记录）；
 *   - 验证链：READY（daemon healthz ∧ chatd health 双绿）→ daemon /healthz 200∧ok →
 *     chatd-health exit 0 → stack status（daemon/chatd up；panel 行在场不判负——run 不起
 *     panel）→ platform-backup --skip-docker（core 三面＋chatd 齐、SUMMARY ok、docker 段
 *     skipped）→ 产物完整性（gzip -t/tar -tzf；chatd/ledger gunzip 后 PRAGMA integrity_check
 *     =ok）→ 组 SIGTERM → run exit 0＋双 pid 已死＋healthz 关 → 重启 run → READY＋双端点复绿
 *     ＋token 复用不覆盖 → 二次优雅停。
 *
 * 用法：node scripts/ops/clean-machine-e2e.mjs --dist <tgz> [--keep] [--node <路径>]
 *         [--slug <名>] [--port <n>] [--json] [--help]
 * 退出：0=全过；1=任一步失败或用法错。失败清理临时目录（--keep 保留现场取证）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROG = 'clean-machine-e2e'
export const DEFAULT_SLUG = 'clean-e2e-corp'
/** daemon.yaml 最小面允许键集（⊆ parseDaemonConfig 收的面；多余键=daemon 启动拒——自检防线） */
export const DAEMON_YAML_ALLOWED_KEYS = Object.freeze(['db', 'platform', 'company', 'companyDir', 'rootDir', 'platformDir', 'apiPort', 'tickMs', 'jobs'])
/** 备份产物四类前缀（core 三面＋chatd；详见 platform-backup.sh core/chatd 段） */
export const BACKUP_ARTIFACT_PREFIXES = Object.freeze(['core-platform-', 'core-ledger-', 'core-company-', 'chatd-'])

/* ------------------------------------------------------------------ */
/* 参数 / 校验（纯函数，测试面）                                        */
/* ------------------------------------------------------------------ */

/** 解析 argv：--dist <tgz>（必填）｜--keep｜--node <路径>｜--slug <名>｜--port <n>｜--json｜--help */
export function parseArgs(argv) {
  const flags = { dist: '', keep: false, node: process.execPath, slug: DEFAULT_SLUG, port: 0, json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${arg} 缺值`)
      return value
    }
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--keep') flags.keep = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--dist') {
      flags.dist = next()
      i += 1
    } else if (arg.startsWith('--dist=')) flags.dist = arg.slice('--dist='.length)
    else if (arg === '--node') { flags.node = next(); i += 1 }
    else if (arg.startsWith('--node=')) flags.node = arg.slice('--node='.length)
    else if (arg === '--slug') { flags.slug = next(); i += 1 }
    else if (arg.startsWith('--slug=')) flags.slug = arg.slice('--slug='.length)
    else if (arg === '--port') {
      const raw = next()
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error(`--port 须为 1-65535 端口号：${raw}`)
      flags.port = Number(raw)
      i += 1
    } else if (arg.startsWith('--port=')) {
      const raw = arg.slice('--port='.length)
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error(`--port 须为 1-65535 端口号：${raw}`)
      flags.port = Number(raw)
    } else throw new Error(`未知参数：${arg}（只收 --dist <tgz>｜--keep｜--node <路径>｜--slug <名>｜--port <n>｜--json｜--help）`)
  }
  if (flags.slug !== '' && !/^[a-z0-9][a-z0-9-]*$/.test(flags.slug)) throw new Error(`--slug 须形如 my-corp（小写字母/数字/连字符）：${flags.slug}`)
  return flags
}

/** dist 包路径校验（存在＋常规文件＋.tgz/.tar.gz 后缀；返回问题清单，空=过） */
export function validateDistPath(file) {
  const issues = []
  if (file === '') issues.push('缺少 --dist <tarball>（pack-dist 产物 .tgz）')
  else {
    if (!/\.(tgz|tar\.gz)$/.test(file)) issues.push('dist 包须为 .tgz/.tar.gz')
    if (!existsSync(file)) issues.push(`文件不存在：${file}`)
    else if (!statSync(file).isFile()) issues.push(`非常规文件：${file}`)
  }
  return issues
}

export function usageText() {
  return [
    '用法：node scripts/ops/clean-machine-e2e.mjs --dist <tgz> [--keep] [--node <路径>] [--slug <名>] [--port <n>] [--json] [--help]',
    '',
    '  干净机器 E2E（M5-4b；docs/plan/08 §三 里程碑5-4、§十一 记录）：临时 HOME＋解包树起公司闭环。',
    '  手工执行步骤（与本件自动化一致）：',
    '    1. node scripts/ops/pack-dist.mjs --out-dir dist            # 产 <repo>/dist/studio-next-*.tgz',
    '    2. tar -xzf dist/<tgz> -C <临时树>                           # 解包（manifest 在场自检）',
    '    3. <树>/apps/daemon/src/cli/main.ts company create <slug> --dir <X>/company --work-root <X>',
    '         --template <树>/templates/company-2-level --platform localfile',
    '         --platform-root <X>/platform --db <X>/ledger.sqlite     # X=临时公司根（备份三面同构）',
    '    4. 写 <X>/var/daemon.yaml 最小面（jobs: false＋apiPort 钉死；见 renderMinimalDaemonYaml）',
    '    5. <树> stack run --company-dir <X>/company --config <X>/var/daemon.yaml --port <n>',
    '         → 等 `READY daemon=<pid> chatd=<pid>`',
    '    6. 验端点：daemon /healthz 200∧ok；scripts/ops/chatd-health.mjs --company-dir <X>/company；',
    '         stack status --json（daemon/chatd up；panel down=run 面预期）',
    '    7. scripts/ops/platform-backup.sh --skip-docker --backup-dir <临时> --core-company <X>',
    '         --chatd-db <X>/company/var/workbench/chat.db → SUMMARY ok＋四产物完整性',
    '    8. kill -TERM <-run 进程组> → run exit 0、双 pid 退出、healthz 关',
    '    9. 重启 stack run → READY 复绿（token 复用不覆盖）→ 二次优雅停',
    '  全程临时 HOME（不碰 ~/.config 与 launchd）；PATH 原样（docker 在否都可跑）。失败清理临时目录（--keep 保留）。',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* 布局 / daemon.yaml / 判定（纯函数，测试面）                          */
/* ------------------------------------------------------------------ */

/** Unix socket 路径长度预算（macOS sun_path=104 含 NUL——留余量；超限 listen EINVAL） */
export const UNIX_SOCKET_BUDGET = 100

/** 候选临时基下 chatd socket 全长（mkdtemp 尾 6 位按定长估）＋是否在预算内 */
export function socketBudgetFor(base, slug) {
  const sock = path.join(base, 'sn-clean-e2e-123456', slug, 'company', 'var', 'workbench', 'chat.sock')
  return { path: sock, len: sock.length, ok: sock.length <= UNIX_SOCKET_BUDGET }
}

/**
 * 临时树布局（对齐 platform-backup --core-company 三面：company/platform/ledger.sqlite）。
 * companyRoot=<tmp>/<slug>；chatd 数据面在公司 git 目录 <companyRoot>/company/var/workbench/
 * （stack run 约定——plists.ts STACK_CONVENTIONS.varRel）。
 */
export function e2eLayout(tmpRoot, slug) {
  const companyRoot = path.join(tmpRoot, slug)
  const companyDir = path.join(companyRoot, 'company')
  return {
    tmpRoot,
    tree: path.join(tmpRoot, 'tree'),
    home: path.join(tmpRoot, 'home'),
    companyRoot,
    companyDir,
    platformDir: path.join(companyRoot, 'platform'),
    ledgerPath: path.join(companyRoot, 'ledger.sqlite'),
    varDir: path.join(companyRoot, 'var'),
    configPath: path.join(companyRoot, 'var', 'daemon.yaml'),
    chatdDb: path.join(companyDir, 'var', 'workbench', 'chat.db'),
    chatdToken: path.join(companyDir, 'var', 'workbench', 'chatd.token'),
    backupDir: path.join(tmpRoot, 'backups'),
    logsDir: path.join(tmpRoot, 'logs'),
  }
}

/** 最小 daemon.yaml（E2E 面）：键集 ⊆ DAEMON_YAML_ALLOWED_KEYS；jobs: false 关定时岗 */
export function renderMinimalDaemonYaml(input) {
  const q = (s) => JSON.stringify(s)
  return [
    `# studio-next daemon 配置（clean-machine-e2e 最小面；M5-4b——docs/plan/08 §十一）`,
    `# 覆盖 company create 顺产骨架：骨架 platformDir 推导 <work>/var/platform 与本布局`,
    `# --platform-root <companyRoot>/platform 不一致，此处钉齐 db/companyDir/platformDir 三路径。`,
    `db: ${q(input.dbPath)}`,
    'platform: localfile',
    `company: ${q(input.slug)}`,
    `companyDir: ${q(input.companyDir)}`,
    `rootDir: ${q(input.rootDir)}`,
    `platformDir: ${q(input.platformDir)}`,
    `apiPort: ${String(input.apiPort)}`,
    'tickMs: 1000',
    '# 定时岗调度关（config-types.ts `jobs: boolean` 已支持字段）：E2E 只验装配与端点，不验真实派工；',
    '# mentionSource 不写=缺省 matrix 且 matrix 未开（零装配）；stack run 亦经 index.ts 直装配不经 boot。',
    'jobs: false',
    '',
  ].join('\n')
}

/** 扁平 YAML 键清单（`key: value` 行；# 注释行跳过）——自检写出的键集不越 DAEMON_YAML_ALLOWED_KEYS */
export function parseFlatYamlKeys(text) {
  const keys = []
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(line)
    if (m !== null) keys.push(m[1])
  }
  return keys
}

/** READY 行扫描：`READY daemon=<pid> chatd=<pid|off>`（run.ts 就绪门输出；off=--no-chatd 面） */
export function scanReadyLine(text) {
  const m = /^READY daemon=(\d+) chatd=(\d+|off)$/m.exec(text)
  if (m === null) return null
  const chatdRaw = m[2]
  return { daemonPid: Number(m[1]), chatdPid: chatdRaw === 'off' ? null : Number(chatdRaw) }
}

/**
 * stack status --json rows 判定（纯函数）：daemon∧chatd 必 up；panel 行须在场（探测面不缩水）
 * 但 state 不判负——run 面不起 panel（M5-3 §九「panel 不入 run 面」）。
 */
export function evaluateStatusRows(parsed) {
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.rows)) {
    return { ok: false, reason: 'status 输出非 {rows:[…]} 形' }
  }
  const byId = new Map(parsed.rows.map((r) => [r.id, r]))
  const missing = ['daemon', 'chatd', 'panel'].filter((id) => !byId.has(id))
  if (missing.length > 0) return { ok: false, reason: `探测面缩水：缺 ${missing.join('/')}` }
  const daemon = byId.get('daemon').state
  const chatd = byId.get('chatd').state
  const panel = byId.get('panel').state
  if (daemon !== 'up') return { ok: false, reason: `daemon=${String(daemon)}` }
  if (chatd !== 'up') return { ok: false, reason: `chatd=${String(chatd)}` }
  return { ok: true, reason: `daemon=up chatd=up panel=${String(panel)}（run 不起 panel——state 不判负）` }
}

/**
 * platform-backup SUMMARY 判定（纯函数）：ok=true ∧ docker 段 skipped（--skip-docker 生效
 * 证——全程零容器面）∧ core backed=3（platform/ledger/company 三面）∧ chatd backed≥1。
 */
export function evaluateBackupSummary(parsed) {
  if (parsed === null || typeof parsed !== 'object') return { ok: false, reason: 'SUMMARY 非对象' }
  if (parsed.ok !== true) return { ok: false, reason: `ok=${String(parsed.ok)}` }
  if (parsed.docker?.skipped !== true) return { ok: false, reason: 'docker 段未 skipped（--skip-docker 未生效？）' }
  if (parsed.core?.backed !== 3) return { ok: false, reason: `core backed=${String(parsed.core?.backed ?? '?')}（期望 3：platform/ledger/company）` }
  const chatdBacked = parsed.chatd?.backed ?? 0
  if (chatdBacked < 1) return { ok: false, reason: `chatd backed=${String(chatdBacked)}` }
  return { ok: true, reason: `core=3 chatd=${String(chatdBacked)} docker=skipped(${String(parsed.docker?.reason ?? '?')})` }
}

/**
 * 输出尾部的 JSON 对象提取（纯函数）：容忍 pretty 多行对象（stack status --json 缩进式）
 * 与单行式（SUMMARY 尾行）；取「最后一个行首列 0 的 `{`」起的块，失败回退末行。不可解析=null。
 */
export function extractLastJson(text) {
  const trimmed = text.trimEnd()
  if (trimmed === '') return null
  const candidates = []
  const idx = trimmed.lastIndexOf('\n{')
  if (idx >= 0) candidates.push(trimmed.slice(idx + 1))
  if (trimmed.startsWith('{')) candidates.push(trimmed)
  const lastLine = trimmed.split('\n').at(-1) ?? ''
  if (lastLine.startsWith('{')) candidates.push(lastLine)
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* 下一候选 */
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 运行时小件（IO 面——不进单测，真流程经 --keep 取证）                  */
/* ------------------------------------------------------------------ */

function run(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

/**
 * 临时基选择：Unix socket 长度优先（macOS sun_path 104 含 NUL；/var/folders/… 长前缀会
 * EINVAL——首跑实测），按预算内最短基 mkdtemp；均不可写/超限=明错不猜。
 */
function chooseTmpRoot(slug) {
  const bases = [...new Set([tmpdir(), '/tmp'])]
    .map((base) => ({ base, budget: socketBudgetFor(base, slug) }))
    .filter((c) => c.budget.ok)
    .sort((a, b) => a.budget.len - b.budget.len)
  for (const { base } of bases) {
    try {
      return mkdtempSync(path.join(base, 'sn-clean-e2e-'))
    } catch {
      /* 不可写→换下一候选 */
    }
  }
  throw new Error(`无可写临时基（chatd socket 路径须 ≤${String(UNIX_SOCKET_BUDGET)} 字符；候选 ${[tmpdir(), '/tmp'].join('、')}）——缩短 --slug 或换 TMPDIR`)
}

function tail(text, lines = 8) {
  const arr = text.trimEnd().split('\n')
  return arr.slice(-lines).join(' ⏎ ')
}

function pidAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err instanceof Error && err.code === 'EPERM') // 他户进程=活着
  }
}

async function healthzOk(port, timeoutMs = 3000) {
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.json()
    return { ok: res.status === 200 && body.ok === true, detail: `http=${String(res.status)} ok=${String(body.ok)}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/** 端口探测：preferred 空闲即用（8788 常规位），被占则回退 ephemeral（E2E 不与在跑实例抢端口） */
function pickFreePort(preferred) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => {
      const any = net.createServer()
      any.once('error', () => resolve(0))
      any.listen(0, '127.0.0.1', () => {
        const p = any.address().port
        any.close(() => resolve(p))
      })
    })
    srv.listen(preferred, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })
}

/** 起 stack run（detached=独立进程组——组信号语义；stdout/stderr 落日志文件＋内存缓冲供 READY 扫描） */
function spawnStackRun(flags, layout, port, logFile, gatewaySecret) {
  const child = spawn(
    flags.node,
    [
      path.join(layout.tree, 'apps', 'daemon', 'src', 'cli', 'main.ts'),
      'stack', 'run',
      '--company-dir', layout.companyDir,
      '--config', layout.configPath,
      '--port', String(port),
    ],
    {
      cwd: layout.tree,
      env: childEnv(flags, layout, gatewaySecret),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let buffer = ''
  const sink = createWriteStream(logFile, { flags: 'a' })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      buffer += text
      sink.write(text)
    })
  }
  child.once('exit', () => sink.end())
  return { child, getBuffer: () => buffer }
}

/** 子进程 env：临时 HOME（＋XDG）＋git 署名（临时 HOME 无全局配置）＋网关签根（SEC-FC-02
 *  部署秘密源=env 注入；E2E 每次运行随机产、永不写 daemon.yaml/日志/台账）；PATH 原样保留 */
function childEnv(flags, layout, gatewaySecret) {
  return {
    ...process.env,
    HOME: layout.home,
    XDG_CONFIG_HOME: path.join(layout.home, '.config'),
    GIT_AUTHOR_NAME: PROG,
    GIT_AUTHOR_EMAIL: `${PROG}@studio-next.invalid`,
    GIT_COMMITTER_NAME: PROG,
    GIT_COMMITTER_EMAIL: `${PROG}@studio-next.invalid`,
    STUDIO_GATEWAY_SECRET: gatewaySecret,
    LANG: process.env.LANG ?? 'C.UTF-8',
  }
}

function waitRunExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true)
      return
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

/** 组 SIGTERM→宽限→组 SIGKILL（任务口径：发信号给 run 进程组，等双进程退出，超时 kill） */
async function stopRunGroup(child, graceMs) {
  if (child.pid === undefined) return { code: child.exitCode, signal: child.signalCode, killed: true }
  const groupKill = (sig) => {
    try {
      process.kill(-child.pid, sig)
    } catch {
      try {
        child.kill(sig)
      } catch {
        /* 已退 */
      }
    }
  }
  groupKill('SIGTERM')
  if (await waitRunExit(child, graceMs)) return { code: child.exitCode, signal: child.signalCode, killed: false }
  groupKill('SIGKILL')
  await waitRunExit(child, 8000)
  return { code: child.exitCode, signal: child.signalCode, killed: true }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const READY_WAIT_MS = 90_000 // > run.ts 就绪门缺省 60s（含 spawn/解包尾延）
const STOP_GRACE_MS = 40_000 // > run 停序缺省（SIGTERM→8s→SIGKILL→5s 观测）×2 子进程

export async function main(argv) {
  const flags = parseArgs(argv)
  if (flags.help) {
    console.log(usageText())
    return 0
  }
  const distIssues = validateDistPath(flags.dist)
  if (distIssues.length > 0) {
    console.error(`${PROG}：${distIssues.join('；')}`)
    console.error(`（${usageText().split('\n')[0]}）`)
    return 1
  }
  const startedAt = Date.now()
  const gatewaySecret = randomBytes(32).toString('hex') // SEC-FC-02 部署秘密源（env 注入；每 E2E 运行随机）
  const tmpRoot = chooseTmpRoot(flags.slug)
  const layout = e2eLayout(tmpRoot, flags.slug)
  for (const dir of [layout.tree, path.join(layout.home, '.config'), layout.backupDir, layout.logsDir, layout.varDir]) mkdirSync(dir, { recursive: true })
  const results = []
  let runHandle = null
  let exitCode = 1
  let port = flags.port
  let dockerNote = 'docker 不在 PATH（--skip-docker 面本就无需）'
  let pids = { daemonPid: 0, chatdPid: 0 }

  const step = async (id, label, fn) => {
    const t0 = Date.now()
    try {
      const detail = await fn()
      results.push({ id, label, ok: true, detail: String(detail), ms: Date.now() - t0 })
      if (!flags.json) console.log(`  [${String(results.length).padStart(2)}] ${id.padEnd(16)} PASS  ${String(detail)}`)
      return true
    } catch (err) {
      results.push({ id, label, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 })
      if (!flags.json) console.log(`  [${String(results.length).padStart(2)}] ${id.padEnd(16)} FAIL  ${results.at(-1).detail}`)
      return false
    }
  }
  const fail = (msg) => {
    throw new Error(msg)
  }

  try {
    if (!flags.json) {
      console.log(`${PROG}（M5-4b 干净机器 E2E）—— ${flags.dist}`)
      console.log(`  临时树 ${tmpRoot}（失败即清理；--keep 保留）｜node ${flags.node}（${process.version}）`)
    }

    let port = flags.port
    let pids = { daemonPid: 0, chatdPid: 0 }

    /* ---- 1. 前置自检（外部命令面；docker 只记录不判负） ---- */
    await step('preflight', '前置自检', async () => {
      if (Number(process.versions.node.split('.')[0]) < 24) fail(`node 主版本 <24：${process.version}`)
      for (const tool of ['tar', 'git', 'sqlite3']) {
        const probe = run(tool, ['--version'])
        if (probe.error !== undefined || probe.status !== 0) fail(`${tool} 不可用（PATH）`)
      }
      const dockerInPath = run('/bin/sh', ['-c', 'command -v docker'], { encoding: 'utf8' })
      if (dockerInPath.status === 0 && dockerInPath.stdout !== null && dockerInPath.stdout.trim() !== '') {
        const info = run('/bin/sh', ['-c', 'docker info >/dev/null 2>&1; echo $?'], { encoding: 'utf8' })
        dockerNote = `docker 在 PATH（docker info exit=${String(info.stdout ?? '').trim()}）——脚本照跑（备份 --skip-docker）`
      }
      return `tar/git/sqlite3 在位｜${dockerNote}`
    })

    /* ---- 2. 解包 ---- */
    await step('unpack', '解包 dist 树', async () => {
      const untar = run('tar', ['-xzf', flags.dist, '-C', layout.tree])
      if (untar.status !== 0) fail(`tar 解包失败：${tail(untar.stderr ?? '')}`)
      const manifest = path.join(layout.tree, 'dist-manifest.json')
      if (!existsSync(manifest)) fail('包内缺 dist-manifest.json（非 pack-dist 产物？）')
      return `${path.basename(flags.dist)} → tree/（dist-manifest.json 在场）`
    })

    /* ---- 3. company create（模板 company-2-level，localfile） ---- */
    await step('company-create', 'company create（2 级模板）', async () => {
      const res = run(
        flags.node,
        [
          path.join(layout.tree, 'apps', 'daemon', 'src', 'cli', 'main.ts'),
          'company', 'create', flags.slug,
          '--dir', layout.companyDir,
          '--work-root', layout.companyRoot,
          '--template', path.join(layout.tree, 'templates', 'company-2-level'),
          '--platform', 'localfile',
          '--platform-root', layout.platformDir,
          '--db', layout.ledgerPath,
          '--by', PROG,
        ],
        { cwd: layout.tree, env: childEnv(flags, layout, gatewaySecret), timeout: 120_000 },
      )
      if (res.status !== 0) fail(`exit=${String(res.status)}：${tail(res.stderr ?? res.stdout ?? '')}`)
      for (const p of [path.join(layout.companyDir, 'org-config.yaml'), layout.ledgerPath, layout.platformDir]) {
        if (!existsSync(p)) fail(`产物缺席：${p}`)
      }
      return `${layout.companyDir}（platform/ledger/company 三面钉齐于 ${layout.companyRoot}）`
    })

    /* ---- 4. 最小 daemon.yaml（jobs: false） ---- */
    await step('daemon-yaml', '最小 daemon.yaml', async () => {
      if (port === 0) {
        port = await pickFreePort(8788)
        if (port === 0) fail('无可用端口（8788 与 ephemeral 均不可绑）')
      }
      const yamlText = renderMinimalDaemonYaml({
        dbPath: layout.ledgerPath,
        slug: flags.slug,
        companyDir: layout.companyDir,
        rootDir: layout.companyRoot,
        platformDir: layout.platformDir,
        apiPort: port,
      })
      writeFileSync(layout.configPath, yamlText, 'utf8')
      const keys = parseFlatYamlKeys(yamlText)
      const illegal = keys.filter((k) => !DAEMON_YAML_ALLOWED_KEYS.includes(k))
      if (illegal.length > 0) fail(`越界键（daemon 启动会拒）：${illegal.join(',')}`)
      if (!/^jobs: false$/m.test(yamlText)) fail('jobs: false 未落')
      return `${layout.configPath}（apiPort=${String(port)}，jobs: false——定时岗关，只验装配与端点）`
    })

    /* ---- 5. stack run（第一次）→ READY ---- */
    await step('run1-ready', 'stack run #1 → READY', async () => {
      runHandle = spawnStackRun(flags, layout, port, path.join(layout.logsDir, 'run-1.log'), gatewaySecret)
      const t0 = Date.now()
      for (;;) {
        const ready = scanReadyLine(runHandle.getBuffer())
        if (ready !== null) {
          pids = ready
          return `READY daemon=${String(ready.daemonPid)} chatd=${String(ready.chatdPid ?? 'off')}（${String(Date.now() - t0)}ms）｜日志 ${path.join(layout.logsDir, 'run-1.log')}`
        }
        if (runHandle.child.exitCode !== null || runHandle.child.signalCode !== null) {
          fail(`run 进程先折（code=${String(runHandle.child.exitCode)} signal=${String(runHandle.child.signalCode)}）：${tail(runHandle.getBuffer())}`)
        }
        if (Date.now() - t0 > READY_WAIT_MS) {
          await stopRunGroup(runHandle.child, 5000)
          fail(`${String(READY_WAIT_MS)}ms 未 READY：${tail(runHandle.getBuffer())}`)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    })

    /* ---- 6-8. 三端点验证 ---- */
    await step('healthz', 'daemon /healthz', async () => {
      const h = await healthzOk(port)
      if (!h.ok) fail(h.detail)
      return `200∧ok（${h.detail}）`
    })
    await step('chatd-health', 'chatd health 两步探针', async () => {
      const res = run(flags.node, [path.join(layout.tree, 'scripts', 'ops', 'chatd-health.mjs'), '--company-dir', layout.companyDir], { env: childEnv(flags, layout, gatewaySecret), timeout: 15_000 })
      if (res.status !== 0) fail(`exit=${String(res.status)}：${tail(res.stdout ?? res.stderr ?? '')}`)
      return `exit 0（health＋rooms.list 双过，token 不回显）`
    })
    await step('stack-status', 'stack status 端点面', async () => {
      const res = run(
        flags.node,
        [path.join(layout.tree, 'apps', 'daemon', 'src', 'cli', 'main.ts'), 'stack', 'status', '--company-dir', layout.companyDir, '--port', String(port), '--json'],
        { env: childEnv(flags, layout, gatewaySecret), timeout: 30_000 },
      )
      if (res.status !== 0 && res.status !== 1) fail(`exit=${String(res.status)}（0/1 之外）`)
      const parsed = extractLastJson(res.stdout ?? '')
      if (parsed === null) fail(`status JSON 不可解析（raw=${JSON.stringify((res.stdout ?? '').slice(0, 400))}）：${tail(res.stdout ?? '')}`)
      const verdict = evaluateStatusRows(parsed)
      if (!verdict.ok) fail(verdict.reason)
      return verdict.reason
    })

    /* ---- 9-10. 备份（运行中热库）＋产物完整性 ---- */
    await step('backup', 'platform-backup --skip-docker', async () => {
      const res = run(
        'bash',
        [
          path.join(layout.tree, 'scripts', 'ops', 'platform-backup.sh'),
          '--skip-docker',
          '--backup-dir', layout.backupDir,
          '--core-company', layout.companyRoot,
          '--chatd-db', layout.chatdDb,
        ],
        { env: childEnv(flags, layout, gatewaySecret), timeout: 180_000 },
      )
      if (res.status !== 0) fail(`exit=${String(res.status)}：${tail(res.stderr ?? res.stdout ?? '')}`)
      const parsed = extractLastJson(res.stdout ?? '')
      if (parsed === null) fail(`SUMMARY 行不可解析：${tail(res.stdout ?? '')}`)
      const verdict = evaluateBackupSummary(parsed)
      if (!verdict.ok) fail(verdict.reason)
      return verdict.reason
    })
    await step('backup-integrity', '备份产物完整性', async () => {
      const files = readdirSync(layout.backupDir)
      const found = []
      for (const prefix of BACKUP_ARTIFACT_PREFIXES) {
        const hit = files.filter((f) => f.startsWith(prefix))
        if (hit.length === 0) fail(`缺 ${prefix}* 产物`)
        found.push(hit[0])
      }
      for (const f of found) {
        const full = path.join(layout.backupDir, f)
        if (f.endsWith('.tgz')) {
          const t = run('tar', ['-tzf', full])
          if (t.status !== 0) fail(`tar -tzf 失败：${f}`)
          const n = (t.stdout ?? '').trim().split('\n').filter((l) => l !== '').length
          if (n === 0) fail(`tar 内容为空：${f}`)
        } else {
          const g = run('gzip', ['-t', full])
          if (g.status !== 0) fail(`gzip -t 失败：${f}`)
          const dbCopy = path.join(layout.tmpRoot, `.integrity-${f}.sqlite`)
          const dec = run('/bin/sh', ['-c', `gzip -dc ${JSON.stringify(full)} > ${JSON.stringify(dbCopy)}`])
          if (dec.status !== 0) fail(`gunzip 失败：${f}`)
          const ic = run('sqlite3', [dbCopy, 'PRAGMA integrity_check;'])
          rmSync(dbCopy, { force: true })
          if (ic.status !== 0 || (ic.stdout ?? '').trim() !== 'ok') fail(`integrity_check=${(ic.stdout ?? '').trim() || '?'}：${f}`)
        }
      }
      return `${String(found.length)} 产物齐（tgz 过 tar -tzf；db.gz 过 gunzip→PRAGMA integrity_check=ok）`
    })

    /* ---- 11. 组 SIGTERM 优雅停 ---- */
    await step('sigterm-stop', 'SIGTERM 进程组 → 双进程退出', async () => {
      const stop = await stopRunGroup(runHandle.child, STOP_GRACE_MS)
      const details = [`run exit=${String(stop.code)}${stop.signal !== null ? ` signal=${String(stop.signal)}` : ''}${stop.killed ? '（超时 SIGKILL 兜底）' : ''}`]
      if (stop.killed) fail(`run 进程组超时未退（${details[0]}）`)
      if (stop.code !== 0) fail(`${details[0]}——非 0（优雅停应 exit 0）`)
      for (const [who, pid] of [['daemon', pids.daemonPid], ['chatd', pids.chatdPid]]) {
        if (pid !== null && pidAlive(pid)) fail(`${who} pid=${String(pid)} 仍存活`)
        details.push(`${who} pid=${String(pid)} 已退`)
      }
      await new Promise((r) => setTimeout(r, 300))
      const h = await healthzOk(port, 1500)
      if (h.ok) fail(`healthz 仍应答（${h.detail}）——端口未关`)
      const agents = path.join(layout.home, 'Library', 'LaunchAgents')
      if (existsSync(agents)) fail(`run 面写了服务管理器文件：${agents}（应零 launchd/systemd 写入）`)
      details.push('healthz 已关', 'launchd/systemd 零写入')
      return details.join('；')
    })

    /* ---- 12-14. 重启（幂等/恢复） ---- */
    const tokenBefore = existsSync(layout.chatdToken) ? readFileSync(layout.chatdToken, 'utf8') : ''
    await step('run2-ready', 'stack run #2 → READY（恢复）', async () => {
      runHandle = spawnStackRun(flags, layout, port, path.join(layout.logsDir, 'run-2.log'), gatewaySecret)
      const t0 = Date.now()
      for (;;) {
        const ready = scanReadyLine(runHandle.getBuffer())
        if (ready !== null) {
          pids = ready
          return `READY daemon=${String(ready.daemonPid)} chatd=${String(ready.chatdPid ?? 'off')}（${String(Date.now() - t0)}ms）｜日志 ${path.join(layout.logsDir, 'run-2.log')}`
        }
        if (runHandle.child.exitCode !== null || runHandle.child.signalCode !== null) {
          fail(`run 进程先折（code=${String(runHandle.child.exitCode)} signal=${String(runHandle.child.signalCode)}）：${tail(runHandle.getBuffer())}`)
        }
        if (Date.now() - t0 > READY_WAIT_MS) {
          await stopRunGroup(runHandle.child, 5000)
          fail(`${String(READY_WAIT_MS)}ms 未 READY：${tail(runHandle.getBuffer())}`)
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    })
    await step('healthz-again', '重启后双端点复绿', async () => {
      const h = await healthzOk(port)
      if (!h.ok) fail(`healthz ${h.detail}`)
      const res = run(flags.node, [path.join(layout.tree, 'scripts', 'ops', 'chatd-health.mjs'), '--company-dir', layout.companyDir], { env: childEnv(flags, layout, gatewaySecret), timeout: 15_000 })
      if (res.status !== 0) fail(`chatd-health exit=${String(res.status)}`)
      if (!existsSync(layout.chatdDb)) fail(`chat.db 缺席：${layout.chatdDb}`)
      const tokenAfter = existsSync(layout.chatdToken) ? readFileSync(layout.chatdToken, 'utf8') : ''
      if (tokenBefore === '' || tokenAfter !== tokenBefore) fail('token 未复用（首产应 0600 复用不覆盖）')
      return `healthz ok∧chatd health ok；chat.db 持久在场；token 复用不覆盖（幂等）`
    })
    await step('sigterm-stop-2', '二次优雅停', async () => {
      const stop = await stopRunGroup(runHandle.child, STOP_GRACE_MS)
      if (stop.killed) fail(`run 进程组超时未退`)
      if (stop.code !== 0) fail(`run exit=${String(stop.code)}（非 0）`)
      return `run exit=0；daemon/chatd 随组退出`
    })

    exitCode = results.every((r) => r.ok) ? 0 : 1
  } finally {
    if (runHandle !== null && runHandle.child.pid !== undefined && runHandle.child.exitCode === null && runHandle.child.signalCode === null) {
      await stopRunGroup(runHandle.child, 5000) // 异常路径兜底：不留孤儿进程组
    }
    const pass = results.filter((r) => r.ok).length
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (flags.json) {
      console.log(JSON.stringify({ command: PROG, dist: flags.dist, slug: flags.slug, port, dockerNote, pass, fail: results.length - pass, results, elapsedSec: Number(elapsed), verdict: pass === results.length ? 'PASS' : 'FAIL' }, null, 2))
    } else {
      console.log(`结论 ${pass === results.length ? 'PASS' : 'FAIL'}（${String(pass)}/${String(results.length)} 步）——${flags.dist}｜总耗时 ${elapsed}s｜${dockerNote}`)
    }
    if (flags.keep) {
      console.log(`现场保留：${tmpRoot}（--keep）`)
    } else {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  }
  return exitCode
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      console.error(`${PROG} 失败：${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    },
  )
}
