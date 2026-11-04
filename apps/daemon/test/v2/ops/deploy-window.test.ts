/**
 * deploy-window 部署窗口端到端（studio-dev-717 真机事故回归）
 *
 * 覆盖 Lead 21:01 真机事故暴露的顺序缺陷：
 *   ① 「state=旧 commit、部署树=新 commit、guardian preflight 开启」的窗口 → 必须成功且 daemon
 *      持续可用：state 必须在 kickstart **之前**写好（fake launchctl 在 kickstart 时刻跑
 *      `deploy.mjs check`，必须 exit 0；旧实现此步 fail-closed → daemon 停 3min）；
 *   ② health 失败（旧 pid 一直挡/永不换新）→ 回滚部署树到上一 commit + 恢复 state（树/state
 *      一致，preflight 可放行旧代码），exit 4 且报错含「daemon 可能已停」恢复步骤；
 *   ③ 部署树与 state 漂移（事故后的残留态）→ 拒绝重启（fail-closed）并给恢复指令；
 *   ④ `invokedDirectly` 在 /tmp（macOS=/private/tmp 符号链接）下仍能执行（realpath 归一）。
 *
 * 说明：真机重启由 Lead 部署窗口执行（717 流程要求）；本测试用 fake launchctl + 假 healthz
 * 服务器复现窗口时序，不触 live daemon。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const CLI = path.join(REPO_ROOT, 'scripts', 'ops', 'deploy.mjs')
const roots: string[] = []
const servers: Server[] = []

afterAll(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-deploy-window-'))
  roots.push(dir)
  return dir
}

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...(env ?? {}) }, timeout: 60_000 })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** 异步子进程（deploy CLI 需与父进程内假 healthz 服务器并行，不能用 spawnSync 阻塞事件循环） */
function runAsync(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`子进程超时（${String(timeoutMs)}ms）：${cmd}`))
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

function git(cwd: string, ...args: string[]): string {
  const result = run('git', args, cwd)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

/** 建临时主仓：固定入口文件 + 提交（base）；返回 commit sha */
function initRepo(root: string): { repo: string; base: string } {
  const repo = path.join(root, 'repo')
  mkdirSync(path.join(repo, 'apps', 'boot', 'src'), { recursive: true })
  mkdirSync(path.join(repo, 'apps', 'daemon', 'src'), { recursive: true })
  mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  writeFileSync(path.join(repo, 'package.json'), '{"name":"deploy-window-fixture","private":true}\n', 'utf8')
  writeFileSync(path.join(repo, 'apps', 'boot', 'src', 'main.ts'), '// v1\n', 'utf8')
  writeFileSync(path.join(repo, 'apps', 'daemon', 'src', 'index.ts'), '// entry\n', 'utf8')
  writeFileSync(path.join(repo, 'scripts', 'guardian.mjs'), '// guardian\n', 'utf8')
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.email', 'deploy-window@studio-next.invalid')
  git(repo, 'config', 'user.name', 'deploy-window-fixture')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'base')
  return { repo, base: git(repo, 'rev-parse', 'HEAD') }
}

/** 在临时主仓追加一个 commit（改 apps/boot/src/main.ts）→ 返回新 commit sha 与 tree sha */
function addCommit(repo: string, marker: string): { commit: string; tree: string } {
  writeFileSync(path.join(repo, 'apps', 'boot', 'src', 'main.ts'), `// ${marker}\n`, 'utf8')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', marker)
  const commit = git(repo, 'rev-parse', 'HEAD')
  return { commit, tree: git(repo, 'rev-parse', `${commit}^{tree}`) }
}

/** 部署树 clone 到指定 commit */
function cloneDeploy(repo: string, deploy: string, commit: string): void {
  const cloned = run('git', ['clone', '-q', repo, deploy], path.dirname(deploy))
  if (cloned.status !== 0) throw new Error(`clone 失败：${cloned.stderr}`)
  git(deploy, 'checkout', '-q', '--detach', commit)
}

/** 构造上一版「已验证」state（tree/state 一致，模拟上一轮部署成功后的状态） */
function seedState(statePath: string, deploy: string, commit: string, tree: string): void {
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'studio-next/deploy-state/v1',
        status: 'active',
        deployedAt: new Date(0).toISOString(),
        targetCommit: commit,
        tree,
        previousCommit: null,
        deployDir: deploy,
        repo: path.dirname(deploy),
        ref: commit,
        depsInstalled: false,
        launchdLabel: 'io.studionext.fixture',
        health: { ok: true, pid: 11111, previousPid: null, waitedMs: 10, probes: 1 },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

/** fake launchctl：kickstart 时刻跑 preflight check 并落证（state-first 证明点） */
function installFakeLaunchctl(root: string, deploy: string, statePath: string): { binDir: string; markerDir: string } {
  const binDir = path.join(root, 'fakebin')
  const markerDir = path.join(root, 'markers')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(markerDir, { recursive: true })
  const script = `#!/bin/sh
# 717 演练 fake launchctl：记录 kickstart 时刻的 state/check 结果（不重启任何真实进程）
NODE_BIN=${JSON.stringify(process.execPath)}
node "$NODE_BIN" >/dev/null 2>&1
"$NODE_BIN" ${JSON.stringify(CLI)} check --deploy ${JSON.stringify(deploy)} --state ${JSON.stringify(statePath)} > ${JSON.stringify(path.join(markerDir, 'check.out'))} 2>&1
echo $? > ${JSON.stringify(path.join(markerDir, 'check.exit'))}
git -C ${JSON.stringify(deploy)} rev-parse HEAD > ${JSON.stringify(path.join(markerDir, 'tree.head'))} 2>/dev/null
exit 0
`
  writeFileSync(path.join(binDir, 'launchctl'), script, 'utf8')
  chmodSync(path.join(binDir, 'launchctl'), 0o755)
  return { binDir, markerDir }
}

/** 假 healthz：前 switchAfter 次返回 oldPid，之后返回 newPid（neverSwitch=true 恒旧） */
function startHealthServer(options: { oldPid: number; newPid: number; switchAfter?: number; neverSwitch?: boolean }): Promise<string> {
  let hits = 0
  const switchAfter = options.switchAfter ?? 1
  const server = createServer((_req, res) => {
    hits += 1
    const pid = options.neverSwitch === true || hits <= switchAfter ? options.oldPid : options.newPid
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, pid }))
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`))
  })
}

interface DeployEnv {
  repo: string
  deploy: string
  statePath: string
  binDir: string
  markerDir: string
  base: string
  baseTree: string
  next: string
  nextTree: string
}

/** 公共夹具：临时主仓 base + 新 commit + 部署树(base) + 旧 state + fake launchctl + healthz */
interface DeployEnvWithHealth extends DeployEnv {
  healthUrl: string
}

async function buildEnv(label: string, health: { oldPid: number; newPid: number; switchAfter?: number; neverSwitch?: boolean }): Promise<DeployEnvWithHealth> {
  const root = tempRoot()
  const { repo, base } = initRepo(root)
  const baseTree = git(repo, 'rev-parse', `${base}^{tree}`)
  const nextInfo = addCommit(repo, `${label}-v2`)
  const deploy = path.join(root, 'deploy')
  cloneDeploy(repo, deploy, base)
  const statePath = path.join(root, 'deploy-state.json')
  seedState(statePath, deploy, base, baseTree)
  const { binDir, markerDir } = installFakeLaunchctl(root, deploy, statePath)
  const healthUrl = await startHealthServer(health)
  return { repo, deploy, statePath, binDir, markerDir, base, baseTree, next: nextInfo.commit, nextTree: nextInfo.tree, healthUrl }
}

function runDeploy(env: DeployEnvWithHealth, timeoutMs = '5000') {
  return runAsync(
    process.execPath,
    [
      CLI,
      'deploy',
      '--repo',
      env.repo,
      '--deploy',
      env.deploy,
      '--ref',
      env.next,
      '--state',
      env.statePath,
      '--skip-install',
      '--health-url',
      env.healthUrl,
      '--health-timeout-ms',
      timeoutMs,
      '--json',
    ],
    REPO_ROOT,
    { PATH: `${env.binDir}:${process.env.PATH ?? ''}` },
  )
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

describe('部署窗口顺序（717 事故回归：state-first）', () => {
  it('state=旧 commit、部署树切新 commit、preflight 全开 → 成功且 kickstart 时刻 check 已通过', async () => {
    const env = await buildEnv('window-ok', { oldPid: 41001, newPid: 41002, switchAfter: 2 })
    const result = await runDeploy(env)
    expect(result.status).toBe(0)
    // fake launchctl 在 kickstart 时刻跑的 preflight：state 已是新 commit/tree → check exit 0
    expect(readFileSync(path.join(env.markerDir, 'check.exit'), 'utf8').trim()).toBe('0')
    expect(readFileSync(path.join(env.markerDir, 'tree.head'), 'utf8').trim()).toBe(env.next)
    // final state：active + 新 pid + deployedCommit
    const state = readJson(env.statePath)
    expect(state.status).toBe('active')
    expect(state.targetCommit).toBe(env.next)
    expect(state.tree).toBe(env.nextTree)
    expect((state.health as Record<string, unknown>).ok).toBe(true)
    expect((state.health as Record<string, unknown>).pid).toBe(41002)
    expect((state.health as Record<string, unknown>).deployedCommit).toBe(env.next)
    // 部署树已切换
    expect(git(env.deploy, 'rev-parse', 'HEAD')).toBe(env.next)
    // JSON 摘要
    const payload = JSON.parse(result.stdout) as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.commit).toBe(env.next)
  }, 30_000)

  it('health 失败（旧 pid 一直挡）→ exit 4、回滚部署树+state（树/state 一致）、报「daemon 可能已停」', async () => {
    const env = await buildEnv('window-fail', { oldPid: 42001, newPid: 42002, neverSwitch: true })
    const result = await runDeploy(env, '800')
    expect(result.status).toBe(4)
    expect(result.stderr).toContain('回滚')
    expect(result.stderr).toContain('daemon 可能已停')
    // 回滚：部署树回 base，state 恢复为上一版（targetCommit=base）
    expect(git(env.deploy, 'rev-parse', 'HEAD')).toBe(env.base)
    const state = readJson(env.statePath)
    expect(state.targetCommit).toBe(env.base)
    expect(state.tree).toBe(env.baseTree)
    // kickstart 时刻 check 仍为 0（state 已先行；失败发生在 health 阶段）
    expect(readFileSync(path.join(env.markerDir, 'check.exit'), 'utf8').trim()).toBe('0')
  }, 30_000)

  it('部署树与 state 漂移 → 拒绝重启（fail-closed）并给恢复指令（717 事故残留态）', async () => {
    const env = await buildEnv('window-drift', { oldPid: 43001, newPid: 43002 })
    // 制造事故残留：部署树已切新 commit，而 state 仍指向 base
    git(env.deploy, 'checkout', '-q', '--detach', env.next)
    const direct = run(
      process.execPath,
      [CLI, 'deploy', '--repo', env.repo, '--deploy', env.deploy, '--ref', env.next, '--state', env.statePath, '--skip-install', '--skip-restart', '--json'],
      REPO_ROOT,
      { PATH: `${env.binDir}:${process.env.PATH ?? ''}` },
    )
    expect(direct.status).toBe(2)
    expect(direct.stderr).toContain('漂移')
    // 未发生 mutation：树仍新、state 仍旧（拒绝在漂移态重启）
    expect(git(env.deploy, 'rev-parse', 'HEAD')).toBe(env.next)
    expect(readJson(env.statePath).targetCommit).toBe(env.base)
  }, 30_000)

  it('invokedDirectly 在 /tmp 符号链接路径下仍执行（realpath 归一；717 坑）', () => {
    const dir = path.join(tempRoot(), 'tmp-cli-link')
    symlinkSync(path.join(REPO_ROOT, 'scripts', 'ops'), dir)
    const linkCli = path.join(dir, 'deploy.mjs')
    const result = run(process.execPath, [linkCli, '--help'], REPO_ROOT)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('用法：node scripts/ops/deploy.mjs')
  }, 15_000)

  it('preflight check 在窗口态（status=deploying）通过（guardian 不会死循环）', async () => {
    const env = await buildEnv('window-check', { oldPid: 44001, newPid: 44002 })
    // 手工构造窗口态：state 指向新 commit/tree，树已切新（模拟 deploy 在 kickstart 前写入后、health 未完成）
    const windowState = {
      schema: 'studio-next/deploy-state/v1',
      status: 'deploying',
      deployedAt: new Date(0).toISOString(),
      targetCommit: env.next,
      tree: env.nextTree,
      previousCommit: env.base,
      deployDir: env.deploy,
      repo: env.repo,
      depsInstalled: false,
      launchdLabel: 'io.studionext.fixture',
      health: { ok: false, pending: true, previousPid: null },
    }
    git(env.deploy, 'checkout', '-q', '--detach', env.next)
    writeFileSync(env.statePath, `${JSON.stringify(windowState, null, 2)}\n`, 'utf8')
    const check = run(process.execPath, [CLI, 'check', '--deploy', env.deploy, '--state', env.statePath, '--json'], REPO_ROOT)
    expect(check.status).toBe(0)
  }, 30_000)
})
