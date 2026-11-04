/**
 * deploy-multilabel.test —— 787 多 label 部署（deploy.mjs --labels-file）
 *
 * 覆盖：逐 label kickstart + 逐 healthz(pid≠各 label 部署前 pid) 成功；任一 label health 失败 →
 * 回滚部署树/state（drop-in 与 719 release CLI 默认路径兼容：不带 --labels-file 行为不变）。
 * 隔离：临时 git 仓/部署树 + 假 launchctl + 假 healthz（按请求计数从旧 pid 切新 pid）。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const HERE = import.meta.dirname
const DEPLOY = path.join(HERE, 'deploy.mjs')
const roots = []
const servers = []
after(() => {
  for (const s of servers.splice(0)) s.close()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-deploy-multilabel-'))
  roots.push(dir)
  return dir
}
function run(cmd, args, cwd, env) {
  try {
    return { status: 0, stdout: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(env ?? {}) } }), stderr: '' }
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') }
  }
}
function git(repo, ...args) {
  const r = run('git', args, repo)
  assert.equal(r.status, 0, `git ${args.join(' ')}：${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

/** 建主仓（base + target 两 commit） */
function initRepo(root) {
  const repo = path.join(root, 'repo')
  for (const f of ['package.json', 'bun.lock', 'apps/boot/src/main.ts', 'apps/daemon/src/index.ts', 'scripts/guardian.mjs']) {
    mkdirSync(path.dirname(path.join(repo, f)), { recursive: true })
    writeFileSync(path.join(repo, f), `// ${f}\n`, 'utf8')
  }
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.email', 'deploy-multilabel@studio-next.invalid')
  git(repo, 'config', 'user.name', 'deploy-multilabel')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(path.join(repo, 'apps/boot/src/main.ts'), '// target\n', 'utf8')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'target')
  const target = git(repo, 'rev-parse', 'HEAD')
  return { repo, base, target }
}

function cloneDeploy(repo, commit, root) {
  const deploy = path.join(root, 'deploy')
  assert.equal(run('git', ['clone', '-q', repo, deploy], root).status, 0)
  git(deploy, 'checkout', '-q', '--detach', commit)
  return deploy
}

function seedState(statePath, deploy, commit, tree) {
  writeFileSync(statePath, JSON.stringify({
    schema: 'studio-next/deploy-state/v1', status: 'active', deployedAt: new Date(0).toISOString(),
    targetCommit: commit, tree, previousCommit: null, deployDir: deploy, repo: path.dirname(deploy),
    ref: commit, depsInstalled: false, launchdLabel: 'io.studionext.daemon',
    health: { ok: true, pid: 1, previousPid: null, waitedMs: 1, probes: 1 },
  }, null, 2) + '\n', 'utf8')
}

function fakeBin(root) {
  const bin = path.join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const marker = path.join(root, 'launchctl.log')
  const script = `#!/bin/sh\nfor a in "$@"; do echo "$a" >> ${marker}; done\nexit 0\n`
  writeFileSync(path.join(bin, 'launchctl'), script, 'utf8'); chmodSync(path.join(bin, 'launchctl'), 0o755)
  return { bin, marker }
}

/**
 * 假 healthz：前 2 次请求 oldPid（部署前探测 + 首轮轮询），第 3 次起 newPid（模拟新 daemon 起来）。
 * neverSwitch=true 时恒 oldPid（失败场景）。
 */
function fakeHealth(oldPid, newPid, neverSwitch = false) {
  let hits = 0
  const server = createServer((_req, res) => {
    hits += 1
    const pid = neverSwitch === true || hits <= 2 ? oldPid : newPid
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, pid }))
  })
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/healthz`, server })))
}

function runDeployAsync(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEPLOY, ...args], { env: { ...process.env, ...env } })
    let out = ''; let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.once('exit', (status) => resolve({ status, stdout: out, stderr: err }))
    child.once('error', reject)
  })
}

test('多 label：两个 label 均 kickstart+health（pid≠旧）→ 成功，state/labels 记录完整', async () => {
  const root = tempRoot(); const { repo, base, target } = initRepo(root)
  const deploy = cloneDeploy(repo, base, root)
  const tree = git(repo, 'rev-parse', `${base}^{tree}`)
  const statePath = path.join(root, 'state.json'); seedState(statePath, deploy, base, tree)
  const { bin, marker } = fakeBin(root)
  const a = await fakeHealth(41001, 41002)
  const b = await fakeHealth(42001, 42002)
  const labelsFile = path.join(root, 'labels.json')
  writeFileSync(labelsFile, JSON.stringify([{ label: 'io.studionext.daemon', healthUrl: a.url }, { label: 'io.studionext.profit', healthUrl: b.url }]))
  const r = await runDeployAsync(['deploy', '--repo', repo, '--deploy', deploy, '--ref', target, '--state', statePath, '--labels-file', labelsFile, '--skip-install', '--health-timeout-ms', '8000', '--json'], { PATH: `${bin}:${process.env.PATH}` })
  assert.equal(r.status, 0, r.stderr)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(state.status, 'active')
  assert.equal(state.targetCommit, target)
  assert.equal(state.launchdLabel, null)
  assert.deepEqual(state.launchdLabels.sort(), ['io.studionext.daemon', 'io.studionext.profit'])
  assert.equal(state.health.ok, true)
  assert.equal(state.health.labels['io.studionext.daemon'].pid, 41002)
  assert.equal(state.health.labels['io.studionext.profit'].pid, 42002)
  assert.equal(git(deploy, 'rev-parse', 'HEAD'), target)
  const calls = readFileSync(marker, 'utf8')
  assert.match(calls, /io\.studionext\.daemon/)
  assert.match(calls, /io\.studionext\.profit/)
})

test('多 label：某 label health 失败 → exit4 且回滚部署树/state 到 base', async () => {
  const root = tempRoot(); const { repo, base, target } = initRepo(root)
  const deploy = cloneDeploy(repo, base, root)
  const tree = git(repo, 'rev-parse', `${base}^{tree}`)
  const statePath = path.join(root, 'state.json'); seedState(statePath, deploy, base, tree)
  const { bin } = fakeBin(root)
  const ok = await fakeHealth(43001, 43002)
  const bad = await fakeHealth(44001, 44002, true) // 恒旧 pid → 不 replaced
  const labelsFile = path.join(root, 'labels.json')
  writeFileSync(labelsFile, JSON.stringify([{ label: 'io.studionext.daemon', healthUrl: ok.url }, { label: 'io.studionext.profit', healthUrl: bad.url }]))
  const r = await runDeployAsync(['deploy', '--repo', repo, '--deploy', deploy, '--ref', target, '--state', statePath, '--labels-file', labelsFile, '--skip-install', '--health-timeout-ms', '1500'], { PATH: `${bin}:${process.env.PATH}` })
  assert.equal(r.status, 4, r.stderr)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(state.targetCommit, base) // 回滚恢复上一 state
  assert.equal(git(deploy, 'rev-parse', 'HEAD'), base)
})
