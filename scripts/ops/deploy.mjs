#!/usr/bin/env node
/**
 * deploy.mjs —— 部署隔离工具（studio-dev-708；docs/90-§六）
 *
 * 铁律：**运行中的 daemon 只执行「部署树」里已提交/已验证的代码**；主工作区只用于施工，
 * 可以脏（builder 未提交改动），任何重启/守护核自动拉起都不会加载主工作区代码。
 *
 * 形态：
 *   - 部署树 = 主仓之外的独立检出（git clone 或 git worktree；推荐 clone），固定在目标 commit；
 *   - 已验证事实 = `deploy-state.json` 记录的 `targetCommit` + `tree`（git tree sha1）digest；
 *   - 部署 = 校验部署树干净 → checkout 到目标 commit → 校验树的 tree digest 与主仓一致 →
 *     （依赖变化时）`bun install --frozen-lockfile` → `launchctl kickstart -k` 重启守护核 →
 *     轮询 `/healthz` 直到 ok=true → 落 state；
 *   - 回滚 = 用同一命令 `--ref <上一 commit>` 重新部署（不重写历史）。
 *
 * guardian 侧兜底：`guardian.json` 的 `daemon.preflight` 指向本脚本 `check` 子命令——
 * 部署树不干净 / HEAD 与 state 不符 / digest 不符 / 依赖缺失时 **拒绝启动 daemon 并告警重试**
 * （fail-closed；主工作区脏不影响，因为它不在部署树里）。
 *
 * 约束：只依赖 Node 标准库；不 import 仓内业务代码；**永不写主工作区**（只写部署树 +
 * state/log 文件）；不 delete/不 amend 任何 git 历史；不含本机路径/凭据（路径全部入参）。
 *
 * 用法：
 *   node scripts/ops/deploy.mjs help
 *   node scripts/ops/deploy.mjs check  --deploy <部署树> [--state <state.json>] [--json]
 *   node scripts/ops/deploy.mjs deploy --repo <主仓> --deploy <部署树> --ref <commit|ref>
 *        [--state <state.json>] [--label io.studionext.daemon] [--health-url http://127.0.0.1:8788/healthz]
 *        [--node <node>] [--bun <bun>] [--skip-install] [--skip-restart] [--health-timeout-ms 180000]
 *        [--log <deploy.log>] [--json]
 *   node scripts/ops/deploy.mjs status --deploy <部署树> [--state <state.json>] [--json]
 *
 * 退出码：0=成功；1=用法/配置错误；2=preflight 拒绝（部署树不干净/漂移）；3=部署步骤失败；4=健康检查失败。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const STATE_SCHEMA = 'studio-next/deploy-state/v1'
export const EXIT = Object.freeze({ ok: 0, usage: 1, preflight: 2, deploy: 3, health: 4 })

const USAGE = `用法：node scripts/ops/deploy.mjs <check|deploy|status|help> [选项]

检查（guardian preflight 用；fail-closed）：
  --deploy <部署树>          部署树绝对路径（必填；必须在主仓之外）
  --state <state.json>       部署状态文件（缺省 <部署树>.deploy-state.json）
  --json                     stdout 输出 JSON（guardian 日志可直读）

部署（部署窗口执行；默认重启守护核并等待 /healthz）：
  --repo <主仓>              主仓路径（必填）
  --deploy <部署树>          部署树路径（必填；git clone/worktree，必须在主仓之外）
  --ref <commit|ref>         目标 commit（必填；部署树将 checkout --detach 到该 commit）
  --state <state.json>       状态文件（缺省 <部署树>.deploy-state.json）
  --label <launchd label>    launchd 守护核标签（缺省 io.studionext.daemon）
  --health-url <url>         healthz URL（缺省 http://127.0.0.1:8788/healthz）
  --node <node 二进制>       记录用（缺省 node；部署树入口仍是 node apps/boot/src/main.ts）
  --bun <bun 二进制>         依赖安装用（缺省 bun）
  --skip-install             跳过依赖安装（演练/离线；真实部署不建议）
  --skip-restart             跳过 launchctl 重启（演练）
  --health-timeout-ms <ms>   等待健康超时（缺省 180000）
  --log <file>               追加结构化部署日志（JSON lines）
  --json                     stdout 输出 JSON 摘要

示例（路径全部由调用方给出；仓内不写主机绝对路径）：
  # 首次准备（部署窗口、一次性）：clone 独立部署树并显式 checkout 到已验证 commit
  # （--no-checkout 后索引为空、git status 呈全部 staged deletions 属预期态；不先 checkout 会被 assertClean 拒绝）
  git clone --no-checkout <主仓路径> <部署树路径>
  git -C <部署树路径> checkout --detach <已验证 commit sha>
  # 部署（校验 → 依赖 → 重启守护核 → healthz 验证 → 落 state）
  node scripts/ops/deploy.mjs deploy --repo <主仓路径> \\
    --deploy <部署树路径> --ref <已验证 commit sha>
  # 回滚
  node scripts/ops/deploy.mjs deploy --repo <主仓路径> \\
    --deploy <部署树路径> --ref <上一 commit sha>
`

class DeployError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DeployError'
    this.code = code
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const nowIso = () => new Date().toISOString()
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function parseArgs(argv) {
  const command = argv[0]
  const opts = {}
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new DeployError(EXIT.usage, `未知参数：${token}`)
    const eq = token.indexOf('=')
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq)
    if (eq !== -1) {
      opts[key] = token.slice(eq + 1)
      continue
    }
    if (key === 'json' || key === 'skip-install' || key === 'skip-restart') {
      opts[key] = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new DeployError(EXIT.usage, `参数缺值：--${key}`)
    opts[key] = value
    i += 1
  }
  return { command, opts }
}

function requireOpt(opts, key) {
  const value = opts[key]
  if (typeof value !== 'string' || value === '') throw new DeployError(EXIT.usage, `缺少必填参数 --${key}`)
  return value
}

function absPath(value, what) {
  const resolved = path.resolve(value)
  if (what !== undefined && !existsSync(resolved)) throw new DeployError(EXIT.usage, `${what} 不存在：${resolved}`)
  return resolved
}

function runCmd(argv, { cwd, timeoutMs = 600_000, env } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  })
  if (result.error !== undefined) {
    throw new DeployError(EXIT.deploy, `命令启动失败（${argv[0]}）：${result.error.message}`)
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

function git(dir, args, opts) {
  return runCmd(['git', '-C', dir, ...args], opts)
}

function gitOut(dir, args, opts) {
  const result = git(dir, args, opts)
  if (result.status !== 0) {
    throw new DeployError(EXIT.deploy, `git ${args.join(' ')} 失败（cwd=${dir}）：${result.output}`)
  }
  return result.stdout.trim()
}

function isGitWorkTree(dir) {
  if (!existsSync(dir)) return false
  const result = git(dir, ['rev-parse', '--is-inside-work-tree'])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function headInfo(dir) {
  return {
    commit: gitOut(dir, ['rev-parse', 'HEAD']),
    tree: gitOut(dir, ['rev-parse', 'HEAD^{tree}']),
  }
}

function dirtyEntries(dir) {
  const result = git(dir, ['status', '--porcelain=v1', '--untracked-files=normal'])
  if (result.status !== 0) throw new DeployError(EXIT.deploy, `读取工作树状态失败（${dir}）：${result.output}`)
  return result.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean)
}

function assertClean(dir, what) {
  const dirty = dirtyEntries(dir)
  if (dirty.length > 0) {
    throw new DeployError(
      EXIT.preflight,
      `${what}不干净（${dirty.length} 项未提交/未跟踪改动）——拒绝运行未提交代码：\n${dirty.slice(0, 10).join('\n')}`,
    )
  }
}

function assertDeployOutsideRepo(repo, deploy) {
  if (repo === deploy) throw new DeployError(EXIT.usage, '部署树不能等于主仓（部署树必须是独立检出）')
  const rel = path.relative(repo, deploy)
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  if (inside) throw new DeployError(EXIT.usage, `部署树必须在主仓之外：repo=${repo} deploy=${deploy}`)
}

function ensureDeployRepo(deploy) {
  if (!existsSync(deploy)) {
    throw new DeployError(
      EXIT.usage,
      `部署树不存在：${deploy}\n首次准备：git clone --no-checkout <主仓> ${deploy} 然后 checkout 到已验证 commit`,
    )
  }
  if (!isGitWorkTree(deploy)) {
    throw new DeployError(EXIT.usage, `部署树不是 git 工作树（需要 clone/worktree）：${deploy}`)
  }
}

function resolveCommit(repo, ref) {
  const result = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])
  if (result.status !== 0) {
    throw new DeployError(EXIT.usage, `目标不是主仓中的 commit：${ref}\n${result.output}`)
  }
  return result.stdout.trim()
}

function ensureCommitAvailable(repo, deploy, commit) {
  if (git(deploy, ['cat-file', '-e', `${commit}^{commit}`]).status === 0) return 'present'
  const fetched = git(deploy, ['fetch', '--no-tags', repo, commit])
  if (fetched.status === 0 && git(deploy, ['cat-file', '-e', `${commit}^{commit}`]).status === 0) return 'fetched'
  throw new DeployError(
    EXIT.deploy,
    `部署树缺少目标 commit（${commit}）且 fetch 失败——请先在部署树 checkout 到该 commit 或修复 remote：\n${fetched.output}`,
  )
}

function checkoutCommit(deploy, commit) {
  const result = git(deploy, ['-c', 'advice.detachedHead=false', 'checkout', '--detach', commit, '--'])
  if (result.status !== 0) {
    throw new DeployError(EXIT.deploy, `部署树 checkout 失败（${commit}）：\n${result.output}`)
  }
}

function verifyDeployTree(repo, deploy, commit) {
  const expectedTree = gitOut(repo, ['rev-parse', `${commit}^{tree}`])
  const head = headInfo(deploy)
  if (head.commit !== commit) {
    throw new DeployError(EXIT.deploy, `部署树 HEAD 不符：期望 ${commit}，实际 ${head.commit}`)
  }
  if (head.tree !== expectedTree) {
    throw new DeployError(EXIT.deploy, `部署树 tree digest 不符：主仓 ${expectedTree}，部署树 ${head.tree}`)
  }
  return head
}

function bunLockSha(deploy) {
  const lock = path.join(deploy, 'bun.lock')
  return existsSync(lock) ? sha256File(lock) : null
}

function installDeps(opts, deploy, previousState) {
  const lockSha = bunLockSha(deploy)
  const nodeModules = existsSync(path.join(deploy, 'node_modules'))
  const lockChanged = previousState !== null && previousState.lockSha256 !== null && previousState.lockSha256 !== lockSha
  const needsInstall = !nodeModules || lockChanged
  if (opts['skip-install'] === true) {
    return {
      installed: false,
      skipped: true,
      reason: needsInstall ? 'node_modules 缺失或 bun.lock 变化，但指定了 --skip-install（演练/离线）' : '依赖未变化',
      lockSha256: lockSha,
      nodeModules,
    }
  }
  if (!needsInstall) return { installed: false, reason: '依赖未变化', lockSha256: lockSha, nodeModules }
  const bun = typeof opts.bun === 'string' && opts.bun !== '' ? opts.bun : 'bun'
  const result = runCmd([bun, 'install', '--frozen-lockfile'], { cwd: deploy, timeoutMs: 1_200_000 })
  if (result.status !== 0) {
    throw new DeployError(EXIT.deploy, `依赖安装失败（bun install --frozen-lockfile）：\n${result.output}`)
  }
  return { installed: true, reason: 'node_modules 缺失或 bun.lock 变化', lockSha256: lockSha, nodeModules: true }
}

function guiDomain() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0
  return `gui/${uid}`
}

function restartGuardian(label, opts) {
  if (opts['skip-restart'] === true) return { restarted: false, skipped: true }
  const target = `${guiDomain()}/${label}`
  const result = runCmd(['launchctl', 'kickstart', '-k', target], { timeoutMs: 60_000 })
  if (result.status !== 0) {
    throw new DeployError(EXIT.deploy, `launchctl kickstart 失败（${target}）：\n${result.output}`)
  }
  return { restarted: true, target }
}

async function waitHealth(url, timeoutMs) {
  const startedAt = Date.now()
  let last = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      const body = await response.json().catch(() => null)
      last = { http: response.status, body }
      if (response.status === 200 && body !== null && body.ok === true) {
        return { healthy: true, http: response.status, body, waitedMs: Date.now() - startedAt }
      }
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) }
    }
    await sleep(1_000)
  }
  return { healthy: false, last, waitedMs: Date.now() - startedAt }
}

function statePathOf(opts, deploy) {
  if (typeof opts.state === 'string' && opts.state !== '') return path.resolve(opts.state)
  return `${deploy}.deploy-state.json`
}

function readState(statePath) {
  if (!existsSync(statePath)) return null
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (err) {
    throw new DeployError(EXIT.preflight, `部署状态文件解析失败（${statePath}）：${err instanceof Error ? err.message : String(err)}`)
  }
}

function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function appendDeployLog(logPath, entry) {
  if (typeof logPath !== 'string' || logPath === '') return
  try {
    mkdirSync(path.dirname(logPath), { recursive: true })
    appendFileSync(logPath, `${JSON.stringify({ ts: nowIso(), ...entry })}\n`, 'utf8')
  } catch {
    /* 日志失败不炸部署（部署结果以 stdout/state 为准） */
  }
}

function emit(opts, payload, humanLines) {
  if (opts.json === true) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }
  for (const line of humanLines) process.stdout.write(`${line}\n`)
}

function requireEntryPoints(deploy) {
  const entries = ['apps/boot/src/main.ts', 'apps/daemon/src/index.ts', 'scripts/guardian.mjs', 'package.json']
  const missing = entries.filter((entry) => !existsSync(path.join(deploy, entry)))
  if (missing.length > 0) {
    throw new DeployError(EXIT.preflight, `部署树缺少入口文件：${missing.join(', ')}`)
  }
}

function cmdCheck(opts) {
  const deploy = absPath(requireOpt(opts, 'deploy'), '部署树')
  const statePath = statePathOf(opts, deploy)
  ensureDeployRepo(deploy)
  const state = readState(statePath)
  if (state === null) {
    throw new DeployError(EXIT.preflight, `部署状态文件缺失（${statePath}）——未经部署脚本记录的树不允许启动`)
  }
  if (state.schema !== STATE_SCHEMA) {
    throw new DeployError(EXIT.preflight, `部署状态文件 schema 不符（期望 ${STATE_SCHEMA}）`)
  }
  if (typeof state.deployDir === 'string' && path.resolve(state.deployDir) !== deploy) {
    throw new DeployError(EXIT.preflight, `状态文件属于另一部署树：${state.deployDir} != ${deploy}`)
  }
  assertClean(deploy, '部署树')
  const head = headInfo(deploy)
  if (head.commit !== state.targetCommit) {
    throw new DeployError(EXIT.preflight, `部署树 HEAD 漂移：HEAD=${head.commit} 已验证 commit=${String(state.targetCommit)}`)
  }
  if (head.tree !== state.tree) {
    throw new DeployError(EXIT.preflight, `部署树 tree digest 漂移：实际=${head.tree} 已验证=${String(state.tree)}`)
  }
  requireEntryPoints(deploy)
  if (state.depsInstalled === true && !existsSync(path.join(deploy, 'node_modules'))) {
    throw new DeployError(EXIT.preflight, '部署树 node_modules 缺失（state 记录已安装依赖）')
  }
  const payload = {
    ok: true,
    command: 'check',
    checkedAt: nowIso(),
    deployDir: deploy,
    statePath,
    commit: head.commit,
    tree: head.tree,
    depsInstalled: state.depsInstalled === true,
    deployedAt: state.deployedAt ?? null,
  }
  emit(opts, payload, [
    `[deploy:check] OK  deploy=${deploy}`,
    `  commit=${payload.commit}`,
    `  tree=${payload.tree}`,
    `  state=${statePath}`,
  ])
  return EXIT.ok
}

function cmdStatus(opts) {
  const deploy = absPath(requireOpt(opts, 'deploy'), '部署树')
  const statePath = statePathOf(opts, deploy)
  const state = readState(statePath)
  let head = null
  let dirty = null
  let isRepo = false
  try {
    isRepo = isGitWorkTree(deploy)
    if (isRepo) {
      head = headInfo(deploy)
      dirty = dirtyEntries(deploy).length
    }
  } catch (err) {
    dirty = `不可读（${err instanceof Error ? err.message : String(err)}）`
  }
  const payload = {
    command: 'status',
    checkedAt: nowIso(),
    deployDir: deploy,
    exists: existsSync(deploy),
    isGitWorkTree: isRepo,
    head,
    dirtyEntries: dirty,
    statePath,
    state,
    drifted:
      state !== null && head !== null ? head.commit !== state.targetCommit || head.tree !== state.tree : null,
  }
  emit(opts, payload, [
    `[deploy:status] deploy=${deploy}`,
    `  isGitWorkTree=${String(isRepo)} head=${head === null ? 'n/a' : head.commit}`,
    `  dirty=${String(dirty)} state=${state === null ? '缺失' : `commit=${String(state.targetCommit)}`}`,
  ])
  return EXIT.ok
}

async function cmdDeploy(opts) {
  const repo = absPath(requireOpt(opts, 'repo'), '主仓')
  const deploy = absPath(requireOpt(opts, 'deploy'), '部署树')
  const ref = requireOpt(opts, 'ref')
  const label = typeof opts.label === 'string' && opts.label !== '' ? opts.label : 'io.studionext.daemon'
  const healthUrl = typeof opts['health-url'] === 'string' && opts['health-url'] !== '' ? opts['health-url'] : 'http://127.0.0.1:8788/healthz'
  const healthTimeoutMs = opts['health-timeout-ms'] === undefined ? 180_000 : Number(opts['health-timeout-ms'])
  if (!Number.isFinite(healthTimeoutMs) || healthTimeoutMs <= 0) {
    throw new DeployError(EXIT.usage, '--health-timeout-ms 必须是正整数')
  }
  const statePath = statePathOf(opts, deploy)
  const logPath = typeof opts.log === 'string' ? opts.log : ''
  const startedAt = nowIso()

  if (!existsSync(repo) || !isGitWorkTree(repo)) throw new DeployError(EXIT.usage, `主仓不是 git 工作树：${repo}`)
  assertDeployOutsideRepo(repo, deploy)
  ensureDeployRepo(deploy)
  const previousState = readState(statePath)
  const previousHead = isGitWorkTree(deploy) ? headInfo(deploy) : null
  const targetCommit = resolveCommit(repo, ref)
  appendDeployLog(logPath, { event: 'deploy-start', repo, deploy, ref, targetCommit, startedAt })

  // ① 部署树必须干净（fail-closed：不覆盖未提交改动）
  assertClean(deploy, '部署树')

  // ② 目标 commit 可见 + checkout
  const commitSource = ensureCommitAvailable(repo, deploy, targetCommit)
  checkoutCommit(deploy, targetCommit)

  // ③ 树 digest 校验（部署树 == 主仓目标 commit 的 tree）
  const verified = verifyDeployTree(repo, deploy, targetCommit)
  assertClean(deploy, '部署树（checkout 后）')
  requireEntryPoints(deploy)
  appendDeployLog(logPath, { event: 'tree-verified', commit: verified.commit, tree: verified.tree })

  // ④ 依赖（node_modules 缺失或 lock 变化才安装；bun --frozen-lockfile）
  const deps = installDeps(opts, deploy, previousState)

  // ⑤ 重启守护核（launchd kickstart -k → guardian 重新拉起 daemon）
  const restart = restartGuardian(label, opts)

  // ⑥ healthz 验证（守护核重启后 daemon 从部署树起）
  let health = { healthy: false, skipped: true, reason: '--skip-restart' }
  if (restart.restarted === true) {
    health = await waitHealth(healthUrl, healthTimeoutMs)
    if (health.healthy !== true) {
      appendDeployLog(logPath, { event: 'health-failed', health })
      throw new DeployError(
        EXIT.health,
        `部署已切换但 /healthz 未在 ${String(healthTimeoutMs)}ms 内恢复：${JSON.stringify(health.last ?? null)}\n` +
          `回滚：node scripts/ops/deploy.mjs deploy --repo ${repo} --deploy ${deploy} --ref ${
            previousState !== null && typeof previousState.targetCommit === 'string' ? previousState.targetCommit : '<上一 commit>'
          }`,
      )
    }
  }

  const state = {
    schema: STATE_SCHEMA,
    deployedAt: nowIso(),
    targetCommit: verified.commit,
    tree: verified.tree,
    previousCommit: previousHead === null ? null : previousHead.commit,
    deployDir: deploy,
    repo,
    ref,
    commitSource,
    lockSha256: deps.lockSha256,
    depsInstalled: deps.nodeModules === true,
    depsInstall: deps,
    launchdLabel: label,
    restart,
    health: health.healthy === true ? { ok: true, http: health.http, waitedMs: health.waitedMs, pid: health.body?.pid ?? null } : { ok: false, skipped: true },
  }
  writeState(statePath, state)
  appendDeployLog(logPath, { event: 'deploy-done', ...state })
  const payload = {
    command: 'deploy',
    ok: true,
    deployDir: deploy,
    statePath,
    commit: verified.commit,
    tree: verified.tree,
    previousCommit: state.previousCommit,
    deps,
    restart,
    health: state.health,
    logPath: logPath === '' ? null : logPath,
  }
  emit(opts, payload, [
    `[deploy] OK  ${deploy}`,
    `  commit=${verified.commit} (previous=${String(state.previousCommit)})`,
    `  tree=${verified.tree}`,
    `  deps=${deps.installed === true ? 'installed' : 'unchanged/skipped'}`,
    `  restart=${restart.restarted === true ? restart.target : 'skipped'}`,
    `  health=${health.healthy === true ? `ok pid=${String(health.body?.pid ?? '?')} (${String(health.waitedMs)}ms)` : 'skipped'}`,
    `  state=${statePath}`,
  ])
  return EXIT.ok
}

export async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`deploy：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  const { command, opts } = parsed
  if (command === undefined || command === 'help' || command === '--help' || command === '-h' || opts.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  try {
    if (command === 'check') return cmdCheck(opts)
    if (command === 'deploy') return await cmdDeploy(opts)
    if (command === 'status') return cmdStatus(opts)
    throw new DeployError(EXIT.usage, `未知子命令：${command}`)
  } catch (err) {
    const code = err instanceof DeployError ? err.code : EXIT.deploy
    const message = err instanceof Error ? err.message : String(err)
    if (opts.json === true) {
      process.stdout.write(`${JSON.stringify({ ok: false, command, code, error: message }, null, 2)}\n`)
    }
    process.stderr.write(`[deploy:${command ?? '?'}] 失败（exit ${String(code)}）：${message}\n`)
    return code
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
