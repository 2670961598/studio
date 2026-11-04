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
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { bunLockSha, installDeps } from './deploy-deps.mjs'
import { probeDeployHealth, summarizeHealthWait, waitForReplacedDaemon } from './deploy-health.mjs'
import { baseState, readState, rollbackDeployTree, STATE_SCHEMA, statePathOf, writeState } from './deploy-state.mjs'

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
  --label <launchd label>    launchd 守护核标签（缺省 io.studionext.daemon；单 label 兼容面）
  --labels-file <json>       多 label 批量部署（787）：JSON 数组 [{label,healthUrl}] 或 {"<label>":"<healthUrl>"}；
                             逐 label kickstart+healthz（pid≠部署前）+任一失败回滚树/state（与 719 release CLI 兼容）
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
  # 部署（校验 → 依赖 → **先写 state(deploying)** → 重启守护核 → 等「新 pid」healthz → 落 state(active)）
  # 成功判据：healthz 200 ∧ ok=true ∧ pid ≠ 部署前 pid（旧 daemon 未停完=不算成功；writer-lease
  # 首启失败由 guardian 退避重试，本步持续等待到超时）
  # 失败处置：health 超时 → 部署树回滚到上一 commit 并恢复 state（树/state 一致，preflight 可放行
  # 旧代码启动）；绝不留「树=新/state=旧」漂移（717 真机事故）。
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

/** 787：读取多 label 目标（JSON 数组或 {label: healthUrl} 映射；fail-closed 校验） */
function loadLabelTargets(opts) {
  const file = typeof opts['labels-file'] === 'string' && opts['labels-file'] !== '' ? path.resolve(opts['labels-file']) : ''
  if (file === '') return null
  if (!existsSync(file)) throw new DeployError(EXIT.usage, `--labels-file 不存在：${file}`)
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new DeployError(EXIT.usage, `--labels-file 解析失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray(raw.labels)
      ? raw.labels
      : typeof raw === 'object' && raw !== null
        ? Object.entries(raw).map(([label, healthUrl]) => ({ label, healthUrl }))
        : null
  if (list === null || list.length === 0) throw new DeployError(EXIT.usage, '--labels-file 须为非空数组或 {label: healthUrl} 映射')
  const seen = new Set()
  const targets = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) throw new DeployError(EXIT.usage, '--labels-file 条目须为 {label,healthUrl}')
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const healthUrl = typeof item.healthUrl === 'string' ? item.healthUrl.trim() : ''
    if (label === '' || !/^[A-Za-z0-9._-]+$/.test(label)) throw new DeployError(EXIT.usage, `--labels-file label 非法：${JSON.stringify(item.label)}`)
    if (!/^https?:\/\//.test(healthUrl)) throw new DeployError(EXIT.usage, `--labels-file healthUrl 须为 http(s)：${JSON.stringify(item.healthUrl)}`)
    if (seen.has(label)) throw new DeployError(EXIT.usage, `--labels-file label 重复：${label}`)
    seen.add(label)
    targets.push({ label, healthUrl })
  }
  return targets
}

/** 787：多 label 部署前的旧 daemon pid 基线（每个 healthUrl 独立；不可达=null） */
async function probeLabelPreviousPids(targets) {
  const out = {}
  for (const target of targets) {
    const probe = await probeDeployHealth(target.healthUrl, null, { timeoutMs: 5_000 })
    out[target.label] = probe.pid ?? null
  }
  return out
}

async function cmdDeploy(opts) {
  const repo = absPath(requireOpt(opts, 'repo'), '主仓')
  const deploy = absPath(requireOpt(opts, 'deploy'), '部署树')
  const ref = requireOpt(opts, 'ref')
  const label = typeof opts.label === 'string' && opts.label !== '' ? opts.label : 'io.studionext.daemon'
  const healthUrl = typeof opts['health-url'] === 'string' && opts['health-url'] !== '' ? opts['health-url'] : 'http://127.0.0.1:8788/healthz'
  const labelTargets = loadLabelTargets(opts) // null=单 label 兼容路径
  const multilabel = labelTargets !== null
  const targets = multilabel ? labelTargets : [{ label, healthUrl }]
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
  const previousHead = headInfo(deploy)
  // 部署树与 state 必须一致（717 事故：失败部署会留下「tree=新 commit / state=旧 commit」漂移，
  // guardian preflight 随即 fail-closed 死循环 → daemon 停摆；本检查在动手前列出恢复指令）
  if (previousState !== null && previousState.targetCommit !== previousHead.commit) {
    throw new DeployError(
      EXIT.preflight,
      `部署树与 state 漂移：tree HEAD=${previousHead.commit}，state.targetCommit=${String(previousState.targetCommit)}——拒绝在漂移态重启（preflight 会 fail-closed）。\n` +
        `恢复：git -C ${deploy} checkout --detach ${String(previousState.targetCommit)} 使树回到 state 记录，或手工修正 state 后再跑 deploy`,
    )
  }
  const targetCommit = resolveCommit(repo, ref)
  appendDeployLog(logPath, { event: 'deploy-start', repo, deploy, ref, targetCommit, startedAt, previousCommit: previousHead.commit })

  // ① 部署树必须干净（fail-closed：不覆盖未提交改动）
  assertClean(deploy, '部署树')

  // ② 目标 commit 可见 + checkout；③ 树 digest 校验
  const commitSource = ensureCommitAvailable(repo, deploy, targetCommit)
  checkoutCommit(deploy, targetCommit)
  const verified = verifyDeployTree(repo, deploy, targetCommit)
  assertClean(deploy, '部署树（checkout 后）')
  requireEntryPoints(deploy)
  appendDeployLog(logPath, { event: 'tree-verified', commit: verified.commit, tree: verified.tree })

  // ④ 依赖（失败即回滚部署树到上一 commit；state 未动——保持「树=state」一致）
  let deps
  try {
    deps = installDeps({
      opts,
      deploy,
      previousState,
      runCmd,
      sha256File,
      fail: (code, message) => {
        throw new DeployError(code, message)
      },
    })
  } catch (err) {
    rollbackDeployTree({ repo, deploy, previousState, previousHead, inTree: checkoutCommit, verify: verifyDeployTree, clean: assertClean, entryCheck: requireEntryPoints })
    throw err
  }

  // ⑤ 记旧 daemon pid（pid≠previous 判定基准；不可达=部署前 daemon 未运行）
  let previousHealthPid = null
  let previousHealthPids = null
  if (opts['skip-restart'] !== true) {
    if (multilabel) previousHealthPids = await probeLabelPreviousPids(targets)
    else {
      const preProbe = await probeDeployHealth(healthUrl, null, { timeoutMs: 5_000 })
      previousHealthPid = preProbe !== null ? preProbe.pid : null
    }
  }
  const common = {
    targetCommit: verified.commit,
    tree: verified.tree,
    previousCommit: previousHead.commit,
    deployDir: deploy,
    repo,
    ref,
    commitSource,
    lockSha256: deps.lockSha256,
    depsInstalled: deps.nodeModules === true,
    depsInstall: deps,
    launchdLabel: multilabel ? null : label,
    launchdLabels: targets.map((target) => target.label),
  }

  // ⑥ **state 先写**：部署窗口内 guardian preflight 必须通过（state 已指向新 commit/tree，
  //    health=pending）；绝不留下「树=新 / state=旧」的窗口（717 真机事故根因）。
  const deployingState = baseState({
    status: 'deploying',
    deployedAt: nowIso(),
    ...common,
    restart: { pending: true },
    health: multilabel
      ? { ok: false, pending: true, labels: Object.fromEntries(targets.map((target) => [target.label, { previousPid: previousHealthPids?.[target.label] ?? null }])) }
      : { ok: false, pending: true, previousPid: previousHealthPid },
  })
  writeState(statePath, deployingState)
  appendDeployLog(logPath, { event: 'state-deploying', ...deployingState })

  // ⑦ 重启守护核（launchd kickstart -k → guardian 重启；此时 preflight 读到的 state 已是新值）
  //    787 多 label：逐 label kickstart + 逐 health（pid≠各 label 部署前 pid），任一失败=回滚树/state。
  let restart
  if (multilabel) {
    const restarts = []
    try {
      for (const target of targets) {
        restarts.push({ label: target.label, ...restartGuardian(target.label, opts) })
      }
    } catch (err) {
      const rollback = rollbackDeployTree({ repo, deploy, previousState, previousHead, inTree: checkoutCommit, verify: verifyDeployTree, clean: assertClean, entryCheck: requireEntryPoints })
      if (rollback.ok && previousState !== null) writeState(statePath, previousState)
      throw new DeployError(
        EXIT.deploy,
        `批量重启失败（897 多 label）：${err instanceof Error ? err.message : String(err)}\n` +
          (rollback.ok ? `已回滚部署树到 ${rollback.commit}${previousState !== null ? '并恢复 state' : ''}。` : `⚠ 回滚失败：${rollback.error ?? '未知'}。`),
      )
    }
    restart = { restarted: opts['skip-restart'] !== true, skipped: opts['skip-restart'] === true, labels: restarts.map((item) => item.label) }
  } else {
    restart = restartGuardian(label, opts)
  }

  // ⑧ 等新 daemon：healthz 200 ∧ ok=true ∧ pid ≠ 部署前 pid（旧 daemon 未停完/不可达/
  //    writer-lease 首启失败重试窗都只算过渡态——持续等，不首轮即判）
  let health = { replaced: false, skipped: true, reason: '--skip-restart' }
  if (multilabel) {
    if (restart.restarted === true) {
      const labels = {}
      for (const target of targets) {
        const h = await waitForReplacedDaemon({ url: target.healthUrl, previousPid: previousHealthPids?.[target.label] ?? null, timeoutMs: healthTimeoutMs })
        labels[target.label] = { ok: h.replaced, pid: h.pid ?? null, previousPid: h.previousPid, waitedMs: h.waitedMs, probes: h.observations.length }
        health = { replaced: false, labels, ...(h.replaced ? {} : { failedLabel: target.label, reason: h.reason }) }
        if (!h.replaced) break
      }
      if (Object.values(labels).every((item) => item.ok === true)) health.replaced = true
    }
  } else if (restart.restarted === true) {
    health = await waitForReplacedDaemon({ url: healthUrl, previousPid: previousHealthPid, timeoutMs: healthTimeoutMs })
  }
  if (restart.restarted === true && health.replaced !== true) {
    // 失败处置：回滚部署树到上一 commit 并恢复 state（保持树=state 一致，preflight 可放行旧代码），
    // 绝不留 stale state 让 guardian 无限 fail-closed。
    const rollback = rollbackDeployTree({ repo, deploy, previousState, previousHead, inTree: checkoutCommit, verify: verifyDeployTree, clean: assertClean, entryCheck: requireEntryPoints })
    if (rollback.ok) {
      if (previousState !== null) {
        writeState(statePath, previousState)
      } else {
        writeState(
          statePath,
          baseState({
            status: 'failed',
            deployedAt: nowIso(),
            targetCommit: previousHead.commit,
            tree: previousHead.tree,
            previousCommit: null,
            deployDir: deploy,
            repo,
            ref,
            launchdLabel: label,
            health: { ok: false, pending: false },
            note: '首次部署失败，已回滚部署树到原 commit（树/state 一致）',
          }),
        )
      }
    }
    appendDeployLog(logPath, { event: 'health-failed-rollback', summary: multilabel ? JSON.stringify(health.labels ?? {}) : summarizeHealthWait(health), rollback })
    throw new DeployError(
      EXIT.health,
      `部署已切换但 ${String(healthTimeoutMs)}ms 内未等到「healthz 200∧ok=true∧pid≠部署前 pid」的新 daemon：\n  ${multilabel ? `labels=${JSON.stringify(health.labels ?? {})}` : summarizeHealthWait(health)}\n` +
        (rollback.ok
          ? `已回滚部署树到 ${rollback.commit}${previousState !== null ? '并恢复 state' : '（首次部署：写 failed state；树/state 一致）'}——guardian preflight 将放行旧代码启动。\n`
          : `⚠ 回滚失败（${rollback.error ?? '未知'}）：需人工把部署树/state 恢复一致后再重启守护核。\n`) +
        `注意：daemon 可能已停。确认 guardian 已拉起（launchctl kickstart -k gui/<uid>/${label}）；仍失败查 ~/Library/Logs/studio-next/guardian.jsonl。\n` +
        `手工恢复：git -C ${deploy} checkout --detach <上一 commit> 并使 state.targetCommit 同值。`,
    )
  }

  const state = baseState({
    status: 'active',
    deployedAt: nowIso(),
    ...common,
    restart,
    health:
      restart.restarted !== true
        ? { ok: false, skipped: true }
        : multilabel
          ? { ok: true, labels: health.labels, deployedCommit: verified.commit }
          : { ok: true, pid: health.pid, previousPid: health.previousPid, waitedMs: health.waitedMs, probes: health.observations.length, deployedCommit: verified.commit },
  })
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
    `  health=${state.health.ok === true ? (multilabel ? `ok labels=${Object.keys(state.health.labels ?? {}).join(',')}` : `ok pid=${String(state.health.pid)} previous=${state.health.previousPid === null ? 'none' : String(state.health.previousPid)} (${String(state.health.waitedMs)}ms, probes=${String(state.health.probes)})`) : 'skipped'}`,
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
    const code = err instanceof DeployError ? err.code : typeof err?.code === 'number' ? err.code : EXIT.deploy
    const message = err instanceof Error ? err.message : String(err)
    if (opts.json === true) {
      process.stdout.write(`${JSON.stringify({ ok: false, command, code, error: message }, null, 2)}\n`)
    }
    process.stderr.write(`[deploy:${command ?? '?'}] 失败（exit ${String(code)}）：${message}\n`)
    return code
  }
}

function realpathOrResolved(target) {
  try {
    return realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathOrResolved(path.resolve(process.argv[1])) === realpathOrResolved(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
