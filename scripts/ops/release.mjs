#!/usr/bin/env node
/**
 * release.mjs —— 发布控制面 CLI（studio-dev-719；P0；docs/90-§七）
 *
 * 依据：/tmp/719-construction-brief.md §2（CLI 契约冻结面/exit codes/三形状/绑定/gatesDigest/execute/
 * rollback/status）、/tmp/autonomy-impl-plan-2026-11-04.md §二-719。
 *
 * 铁律（施工书 §3）：**只 spawn 调用 `deploy.mjs` CLI**（check/deploy/status），**不 import** deploy、
 * 不改 deploy.mjs（717 同面在改）；不 import daemon/store/契约；不建岗位/不改 org-config；不自动 push tag
 * （默认本地 annotated tag + 打印 push 命令；`--push` 需显式）；不伪造 gate 证据（gatesDigest 采自真实
 * verify 输出文本，缺失即 usage 错，不猜）。
 *
 * 用法（冻结面；exit codes：0 ok｜1 usage｜2 approval-missing/binding-mismatch｜3 deploy-failed｜
 * 4 health-failed/rollback-failed｜5 record/tag 失败）：
 *   node scripts/ops/release.mjs plan    --repo <repo> --deploy <tree> --ref <sha> --version <v> [--gates-file <f>|--gates-line <s>] [--json]
 *   node scripts/ops/release.mjs request --repo <repo> --deploy <tree> --ref <sha> --version <v> --out <request.json> --gates-file <f> [--by <name>] [--notes <s>] [--json]
 *   node scripts/ops/release.mjs approve-check --request <f> --approval <f> [--json]
 *   node scripts/ops/release.mjs execute --repo <repo> --deploy <tree> --request <f> --approval <f> [--json] [--push]
 *   node scripts/ops/release.mjs rollback --repo <repo> --deploy <tree> --to <sha> [--version <v>] [--json]
 *   node scripts/ops/release.mjs record  --version <v> --commit <sha> --tree <tree> --request <f> --approval <f> [--out <md>] [--json]
 *   node scripts/ops/release.mjs tag     --version <v> --commit <sha> [--dry-run] [--push] [--json]
 *   node scripts/ops/release.mjs status  --repo <repo> --deploy <tree> [--json]
 *
 * gatesDigest 口径（施工书 §2）：sha256(`verify:v2@<commit>:` + verify 输出最后一条 PASS 行)；执行者
 * 用 `--gates-file <verify 输出文件>` 或 `--gates-line <真实输出行>` 提供——本工具**不**自己跑 verify（避免
 * 长跑/伪造面），只从真实文本按口径算。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  EXIT,
  SCHEMA,
  buildRequest,
  checkBinding,
  computeGatesDigest,
  isValidVersion,
  parseFlags,
  renderReleaseRecord,
  renderRollbackRecord,
  tagNameOf,
  validateRequest,
  validateApproval,
} from './release-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEPLOY_JS = path.join(HERE, 'deploy.mjs')
const REPO_ROOT = path.resolve(HERE, '../..')

/** 可注入依赖（测试 mock spawn/fs/now；生产缺省用真实实现） */
function defaultDeps() {
  return {
    spawnSync,
    readFile: (file) => readFileSync(file, 'utf8'),
    writeFile: (file, content) => {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content, 'utf8')
    },
    exists: (file) => existsSync(file),
    listDir: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    now: () => Date.now(),
    execPath: process.execPath,
    cwd: REPO_ROOT,
  }
}

function fail(status, message, payload) {
  const err = new Error(message)
  err.exitStatus = status
  err.payload = payload
  throw err
}

function requireFlag(flags, name) {
  const value = flags[name]
  if (typeof value !== 'string' || value.trim() === '') fail(EXIT.usage, `缺 --${name}`)
  return value
}

function absPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function git(deps, repo, args) {
  const result = deps.spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

function gitOrFail(deps, repo, args, what) {
  const out = git(deps, repo, args)
  if (out.status !== 0) fail(EXIT.usage, `${what}失败：${out.stderr || out.stdout}`)
  return out.stdout
}

function resolveTarget(deps, repo, ref) {
  const commit = gitOrFail(deps, repo, ['rev-parse', '--verify', `${ref}^{commit}`], '解析目标 commit')
  const tree = gitOrFail(deps, repo, ['rev-parse', '--verify', `${commit}^{tree}`], '解析目标 tree')
  return { commit, tree }
}

function deployCall(deps, args) {
  const result = deps.spawnSync(deps.execPath, [DEPLOY_JS, ...args], { encoding: 'utf8' })
  let json = null
  try {
    json = result.stdout !== undefined && result.stdout.trim() !== '' ? JSON.parse(result.stdout) : null
  } catch {
    json = null
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', json }
}

function deployStatus(deps, deploy) {
  const call = deployCall(deps, ['status', '--deploy', deploy, '--json'])
  if (call.status !== 0) fail(EXIT.deploy, `deploy.mjs status 失败（exit=${String(call.status)}）：${call.stderr || call.stdout}`)
  return { call, payload: call.json ?? {} }
}

function readJson(deps, file, what) {
  if (!deps.exists(file)) fail(EXIT.approval, `${what} 不存在：${file}`)
  try {
    return JSON.parse(deps.readFile(file))
  } catch (err) {
    fail(EXIT.usage, `${what} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
  }
}

function gatesInput(flags, deps) {
  if (typeof flags['gates-file'] === 'string') {
    const file = absPath(flags['gates-file'])
    if (!deps.exists(file)) fail(EXIT.usage, `--gates-file 不存在：${file}`)
    return deps.readFile(file)
  }
  if (typeof flags['gates-line'] === 'string') return flags['gates-line']
  return null
}

function emit(flags, payload, lines) {
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }
  for (const line of lines) process.stdout.write(`${line}\n`)
}

function healthUrlOf(statusPayload) {
  const state = statusPayload?.state
  if (typeof state?.healthUrl === 'string' && state.healthUrl !== '') return state.healthUrl
  return 'http://127.0.0.1:8788/healthz'
}

function previousCommitOf(statusPayload) {
  const state = statusPayload?.state
  return typeof state?.targetCommit === 'string' && state.targetCommit !== '' ? state.targetCommit : null
}

/** plan：解析 commit/tree + deploy 现状 + checklist +（可选）gatesDigest */
export function runPlan(deps, flags) {
  const repo = absPath(requireFlag(flags, 'repo'))
  const deploy = absPath(requireFlag(flags, 'deploy'))
  const ref = requireFlag(flags, 'ref')
  const version = requireFlag(flags, 'version')
  if (!isValidVersion(version)) fail(EXIT.usage, `--version 形状非法：${version}`)
  if (!deps.exists(repo)) fail(EXIT.usage, `--repo 不存在：${repo}`)
  const target = resolveTarget(deps, repo, ref)
  const status = deployStatus(deps, deploy)
  const previousCommit = previousCommitOf(status.payload)
  const gatesText = gatesInput(flags, deps)
  const gatesDigest = gatesText === null ? null : computeGatesDigest(target.commit, gatesText)
  const checklist = [
    { item: 'target-commit', status: 'ok', evidence: target.commit },
    { item: 'tree', status: 'ok', evidence: target.tree },
    { item: 'previous-commit', status: 'ok', evidence: previousCommit === null ? '（deploy state 无 targetCommit）' : previousCommit },
    { item: 'deploy-state', status: status.payload.drifted === true ? 'warn' : 'ok', evidence: `deploy.mjs status exit=0 drifted=${String(status.payload.drifted ?? null)}` },
    { item: 'gates-digest', status: gatesDigest === null ? 'pending' : 'ok', evidence: gatesDigest === null ? '未提供 --gates-file/--gates-line（execute/request 前必须提供）' : gatesDigest },
    { item: 'approval', status: 'pending', evidence: 'request/approve 后 execute 前必须 approve-check' },
  ]
  const payload = {
    ok: true,
    version,
    targetCommit: target.commit,
    tree: target.tree,
    previousCommit,
    healthUrl: healthUrlOf(status.payload),
    deployDir: deploy,
    checklist,
    gatesDigest,
  }
  emit(flags, payload, [
    `[release:plan] version=${version} commit=${target.commit}`,
    `  tree=${target.tree} previous=${previousCommit === null ? 'n/a' : previousCommit}`,
    `  deploy=${deploy} drifted=${String(status.payload.drifted ?? null)}`,
    `  gatesDigest=${gatesDigest === null ? '（未提供）' : gatesDigest}`,
  ])
  return EXIT.ok
}

/** request：plan 事实 + gatesDigest → request.json（不调 deploy） */
export function runRequest(deps, flags) {
  const repo = absPath(requireFlag(flags, 'repo'))
  const deploy = absPath(requireFlag(flags, 'deploy'))
  const ref = requireFlag(flags, 'ref')
  const version = requireFlag(flags, 'version')
  const out = absPath(requireFlag(flags, 'out'))
  if (!isValidVersion(version)) fail(EXIT.usage, `--version 形状非法：${version}`)
  const target = resolveTarget(deps, repo, ref)
  const status = deployStatus(deps, deploy)
  const gatesText = gatesInput(flags, deps)
  if (gatesText === null) {
    fail(EXIT.usage, 'request 需要 --gates-file <verify 输出文件> 或 --gates-line <真实 PASS 行>（gatesDigest 不伪造）')
  }
  const gatesDigest = computeGatesDigest(target.commit, gatesText)
  const request = buildRequest({
    version,
    targetCommit: target.commit,
    tree: target.tree,
    previousCommit: previousCommitOf(status.payload),
    gatesDigest,
    createdAt: new Date(deps.now()).toISOString(),
    requestedBy: typeof flags.by === 'string' && flags.by !== '' ? flags.by : (process.env.USER ?? 'unknown'),
    ...(typeof flags.notes === 'string' ? { notes: flags.notes } : {}),
  })
  const errors = validateRequest(request)
  if (errors.length > 0) fail(EXIT.usage, `request 形状非法：${errors.join('；')}`)
  deps.writeFile(out, `${JSON.stringify(request, null, 2)}\n`)
  const payload = { ok: true, request, path: out }
  emit(flags, payload, [`[release:request] OK ${out}`, `  version=${version} commit=${target.commit} gatesDigest=${gatesDigest}`])
  return EXIT.ok
}

/** approve-check：request 与 approval 全等绑定 + 未过期；不调 deploy */
export function runApproveCheck(deps, flags) {
  const requestFile = absPath(requireFlag(flags, 'request'))
  const approvalFile = absPath(requireFlag(flags, 'approval'))
  const request = readJson(deps, requestFile, 'request')
  const approval = readJson(deps, approvalFile, 'approval')
  const binding = checkBinding(request, approval, deps.now())
  if (!binding.ok) fail(EXIT.approval, `approve-check 拒绝（${binding.reason}）：${binding.detail}`, binding)
  const payload = { ok: true, version: request.version, targetCommit: request.targetCommit, tree: request.tree, gatesDigest: request.gatesDigest }
  emit(flags, payload, [`[release:approve-check] OK version=${request.version} commit=${request.targetCommit}`])
  return EXIT.ok
}

function tagExists(deps, repo, tag) {
  return git(deps, repo, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0
}

function ensureTagAbsent(deps, repo, tag) {
  if (tagExists(deps, repo, tag)) fail(EXIT.record, `tag 已存在：${tag}（不覆盖/不 force；如需重发请制作人批）`)
}

function createAnnotatedTag(deps, repo, version, commit, push) {
  const tag = tagNameOf(version)
  ensureTagAbsent(deps, repo, tag)
  const created = git(deps, repo, ['tag', '-a', tag, '-m', `release ${version} @ ${commit}（studio-next release.mjs）`, commit])
  if (created.status !== 0) fail(EXIT.record, `git tag 失败：${created.stderr || created.stdout}`)
  let pushed = false
  if (push === true) {
    const pushResult = git(deps, repo, ['push', 'origin', tag])
    if (pushResult.status !== 0) fail(EXIT.record, `git push tag 失败（本地 tag 已建，未推送）：${pushResult.stderr || pushResult.stdout}`)
    pushed = true
  }
  return { tag, pushed, pushCommand: `git -C ${repo} push origin ${tag}` }
}

function writeRecordFile(deps, flags, version, content) {
  const out = typeof flags.out === 'string' && flags.out !== '' ? absPath(flags.out) : path.join(REPO_ROOT, 'docs/releases', `${version}.md`)
  deps.writeFile(out, content)
  return out
}

/** execute：approve-check 通过→deploy.mjs deploy→record→tag（默认不 push） */
export function runExecute(deps, flags) {
  const repo = absPath(requireFlag(flags, 'repo'))
  const deploy = absPath(requireFlag(flags, 'deploy'))
  const requestFile = absPath(requireFlag(flags, 'request'))
  const approvalFile = absPath(requireFlag(flags, 'approval'))
  const request = readJson(deps, requestFile, 'request')
  const approval = readJson(deps, approvalFile, 'approval')
  const binding = checkBinding(request, approval, deps.now())
  if (!binding.ok) fail(EXIT.approval, `execute 拒绝（${binding.reason}）：${binding.detail}`, binding)
  // 冻结面：绑定通过前不得调用 deploy（无审批/坏绑定=零 deploy 调用，verifier spy 可证）
  const call = deployCall(deps, ['deploy', '--repo', repo, '--deploy', deploy, '--ref', request.targetCommit, '--json'])
  if (call.status === 4) fail(EXIT.health, `deploy 健康检查失败（exit=4）：${call.stderr || call.stdout}`)
  if (call.status !== 0) fail(EXIT.deploy, `deploy 失败（exit=${String(call.status)}）：${call.stderr || call.stdout}`)
  const deployed = call.json ?? {}
  const releasedAt = new Date(deps.now()).toISOString()
  let recordPath = null
  let tag = null
  if (flags['no-record'] !== true) {
    const content = renderReleaseRecord({
      version: request.version,
      commit: request.targetCommit,
      tree: request.tree,
      previousCommit: request.previousCommit,
      gatesDigest: request.gatesDigest,
      requestRef: requestFile,
      approvalRef: approvalFile,
      approver: approval.approver,
      releasedAt,
      deploy: { ok: deployed.ok === true, health: deployed.health ?? null, statePath: deployed.statePath ?? null },
    })
    recordPath = writeRecordFile(deps, flags, request.version, content)
  }
  if (flags['no-tag'] !== true) {
    tag = createAnnotatedTag(deps, repo, request.version, request.targetCommit, flags.push === true)
  }
  const payload = {
    ok: true,
    version: request.version,
    targetCommit: request.targetCommit,
    tree: request.tree,
    deploy: { exit: call.status, health: deployed.health ?? null, statePath: deployed.statePath ?? null },
    record: recordPath,
    tag,
    pushed: tag?.pushed === true,
    pushCommand: tag?.pushCommand ?? null,
  }
  const tagLine = tag === null ? '（跳过）' : `${tag.tag}（${tag.pushed ? '已推送' : '本地；未推送'}）`
  emit(flags, payload, [
    `[release:execute] OK version=${request.version} commit=${request.targetCommit}`,
    `  deploy: exit=0 health=${JSON.stringify(deployed.health ?? null)}`,
    `  record: ${recordPath ?? '（跳过）'}`,
    `  tag: ${tagLine}`,
    ...(tag !== null && !tag.pushed ? [`  push: ${tag.pushCommand}`] : []),
  ])
  return EXIT.ok
}

/** rollback：deploy.mjs deploy --ref <to>，写回滚记录 */
export function runRollback(deps, flags) {
  const repo = absPath(requireFlag(flags, 'repo'))
  const deploy = absPath(requireFlag(flags, 'deploy'))
  const to = requireFlag(flags, 'to')
  const target = resolveTarget(deps, repo, to)
  const status = deployStatus(deps, deploy)
  const fromCommit = previousCommitOf(status.payload)
  const call = deployCall(deps, ['deploy', '--repo', repo, '--deploy', deploy, '--ref', target.commit, '--json'])
  if (call.status === 4) fail(EXIT.health, `rollback 健康检查失败（deploy exit=4）：${call.stderr || call.stdout}`)
  if (call.status !== 0) fail(EXIT.deploy, `rollback 失败（deploy exit=${String(call.status)}）：${call.stderr || call.stdout}`)
  const rolledBackAt = new Date(deps.now()).toISOString()
  const short = target.commit.slice(0, 12)
  const content = renderRollbackRecord({
    version: typeof flags.version === 'string' ? flags.version : null,
    fromCommit,
    rolledBackTo: target.commit,
    tree: target.tree,
    rolledBackAt,
    deploy: { ok: true, health: call.json?.health ?? null },
  })
  const out = typeof flags.out === 'string' && flags.out !== '' ? absPath(flags.out) : path.join(REPO_ROOT, 'docs/releases', `rollback-${short}.md`)
  deps.writeFile(out, content)
  const payload = { ok: true, rolledBackTo: target.commit, tree: target.tree, fromCommit, record: out, deploy: { exit: 0, health: call.json?.health ?? null } }
  emit(flags, payload, [`[release:rollback] OK → ${target.commit}（record=${out}）`, `  health=${JSON.stringify(call.json?.health ?? null)}`])
  return EXIT.ok
}

/** record：写 docs/releases/<version>.md（需 request+approval 绑定通过） */
export function runRecord(deps, flags) {
  const version = requireFlag(flags, 'version')
  const commit = requireFlag(flags, 'commit')
  const tree = requireFlag(flags, 'tree')
  const request = readJson(deps, absPath(requireFlag(flags, 'request')), 'request')
  const approval = readJson(deps, absPath(requireFlag(flags, 'approval')), 'approval')
  const binding = checkBinding(request, approval, deps.now())
  if (!binding.ok) fail(EXIT.approval, `record 拒绝（${binding.reason}）：${binding.detail}`, binding)
  if (request.version !== version || request.targetCommit !== commit) fail(EXIT.record, 'record 参数与 request 绑定不符')
  if (request.tree !== tree) fail(EXIT.record, 'record tree 与 request 绑定不符')
  const content = renderReleaseRecord({
    version,
    commit,
    tree,
    previousCommit: request.previousCommit,
    gatesDigest: request.gatesDigest,
    requestRef: absPath(requireFlag(flags, 'request')),
    approvalRef: absPath(requireFlag(flags, 'approval')),
    approver: approval.approver,
    releasedAt: new Date(deps.now()).toISOString(),
    deploy: null,
  })
  const out = writeRecordFile(deps, flags, version, content)
  const payload = { ok: true, path: out, version, commit, tree }
  emit(flags, payload, [`[release:record] OK ${out}`])
  return EXIT.ok
}

/** tag：本地 annotated tag（默认不 push；--push 显式） */
export function runTag(deps, flags) {
  const version = requireFlag(flags, 'version')
  if (!isValidVersion(version)) fail(EXIT.usage, `--version 形状非法：${version}`)
  const commit = requireFlag(flags, 'commit')
  const tag = tagNameOf(version)
  if (flags['dry-run'] === true) {
    const payload = { ok: true, dryRun: true, tag, commit, pushCommand: `git push origin ${tag}` }
    emit(flags, payload, [`[release:tag] dry-run tag=${tag} commit=${commit}（未写）`])
    return EXIT.ok
  }
  const created = createAnnotatedTag(deps, flags.repo !== undefined ? absPath(flags.repo) : deps.cwd, version, commit, flags.push === true)
  const payload = { ok: true, tag: created.tag, commit, pushed: created.pushed, pushCommand: created.pushCommand }
  emit(flags, payload, [`[release:tag] OK ${created.tag}（${created.pushed ? '已推送' : '本地；未推送'}）`, `  push: ${created.pushCommand}`])
  return EXIT.ok
}

/** status：deploy.mjs status --json + 最近 release 记录 + tag 存在性 */
export function runStatus(deps, flags) {
  const repo = absPath(requireFlag(flags, 'repo'))
  const deploy = absPath(requireFlag(flags, 'deploy'))
  const status = deployStatus(deps, deploy)
  const recordsDir = path.join(REPO_ROOT, 'docs/releases')
  const versions = deps
    .listDir(recordsDir)
    .filter((name) => name.endsWith('.md') && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name) && !name.startsWith('rollback-'))
    .map((name) => name.slice(0, -3))
    .filter((v) => isValidVersion(v))
  const latest = versions.length > 0 ? versions.sort().reverse()[0] : null
  const latestRecord = latest === null ? null : path.join(recordsDir, `${latest}.md`)
  const latestTagExists = latest === null ? false : tagExists(deps, repo, tagNameOf(latest))
  const payload = {
    ok: true,
    deploy: { status: status.payload, exit: status.call.status },
    release: {
      latestVersion: latest,
      latestRecord,
      latestTagExists,
      tag: latest === null ? null : tagNameOf(latest),
    },
  }
  emit(flags, payload, [
    `[release:status] latest=${latest ?? '（无记录）'} tag=${latestTagExists ? '存在' : '缺失'}`,
    `  deploy.state.targetCommit=${String(status.payload?.state?.targetCommit ?? 'n/a')} drifted=${String(status.payload?.drifted ?? null)}`,
  ])
  return EXIT.ok
}

const COMMANDS = {
  plan: runPlan,
  request: runRequest,
  'approve-check': runApproveCheck,
  execute: runExecute,
  rollback: runRollback,
  record: runRecord,
  tag: runTag,
  status: runStatus,
}

/** 入口（可注入 deps；返回 exit code，不 process.exit——测试友好） */
export function runCli(argv, deps = defaultDeps()) {
  let flags
  try {
    const parsed = parseFlags(argv)
    flags = parsed.flags
    const command = parsed.positionals[0]
    if (command === undefined || command === 'help' || flags.help === true) {
      process.stdout.write(USAGE)
      return EXIT.ok
    }
    const handler = COMMANDS[command]
    if (handler === undefined) fail(EXIT.usage, `未知子命令：${command}（支持：${Object.keys(COMMANDS).join('/')}）`)
    return handler(deps, flags)
  } catch (err) {
    const status = typeof err?.exitStatus === 'number' ? err.exitStatus : EXIT.usage
    const payload = { ok: false, error: err instanceof Error ? err.message : String(err), ...(err?.payload !== undefined ? { detail: err.payload } : {}) }
    if (flags?.json === true) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    else process.stderr.write(`[release] ${payload.error}\n`)
    return status
  }
}

const USAGE = `用法：node scripts/ops/release.mjs <plan|request|approve-check|execute|rollback|record|tag|status> [选项]

plan    --repo <repo> --deploy <tree> --ref <sha> --version <v> [--gates-file <f>|--gates-line <s>] [--json]
request --repo ... --deploy ... --ref ... --version ... --out <request.json> --gates-file <f> [--by <name>] [--notes <s>] [--json]
approve-check --request <file> --approval <file> [--json]
execute --repo ... --deploy ... --request <file> --approval <file> [--json] [--push] [--no-record] [--no-tag]
rollback --repo ... --deploy ... --to <sha> [--version <v>] [--out <md>] [--json]
record  --version <v> --commit <sha> --tree <tree> --request <file> --approval <file> [--out <md>] [--json]
tag     --version <v> --commit <sha> [--repo <repo>] [--dry-run] [--push] [--json]
status  --repo ... --deploy ... [--json]

exit codes：0 ok｜1 usage｜2 approval-missing/binding-mismatch｜3 deploy-failed｜4 health-failed/rollback-failed｜5 record/tag 失败
铁律：只 spawn 调用 deploy.mjs CLI（不 import/不改 deploy.mjs）；默认不 push tag（打印 push 命令；--push 显式才推）。
gatesDigest 口径：sha256("verify:v2@<commit>:" + verify 输出最后一条 PASS 行)——必须来自真实输出文本。
`

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCli(process.argv))
}
