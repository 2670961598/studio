/**
 * required-checks.test —— 722 本地 required checks / 公钥投影 / pre-push 钩子（node --test）
 *
 * 覆盖：
 *   - 计划构建（bun 有无两种 verify:v2 形态、--only、override 注入）；
 *   - keys/range 可用性判定（无 registry / 无 base → skip，strict 语义）；
 *   - CLI：--list/--dry-run/--json；override 成功/失败 exit code；
 *   - 公钥投影导出：只导 .pub/.json（绝不导 .key），导出后 verify-commit-keys 可校验；
 *   - install-git-hooks --with-pre-push 安装/卸载（不执行全量 checks，安全快速）。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { CHECK_ORDER, buildPlan, resolveCommitKeyCheck } from './required-checks.mjs'

const HERE = import.meta.dirname
const CHECK = path.join(HERE, 'required-checks.mjs')
const EXPORT = path.join(HERE, 'export-key-registry.mjs')
const GEN = path.join(HERE, 'gen-worker-key.mjs')
const INSTALL = path.join(HERE, 'install-git-hooks.mjs')
const VERIFY = path.join(HERE, 'verify-commit-keys.mjs')
const roots = []
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-required-checks-'))
  roots.push(dir)
  return dir
}

function run(command, args, options = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }),
      stderr: '',
    }
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') }
  }
}

function gitInit(repo) {
  mkdirSync(repo, { recursive: true })
  run('git', ['init', '-q', repo])
  run('git', ['-C', repo, 'config', 'user.name', 'REL-1'])
  run('git', ['-C', repo, 'config', 'user.email', 'rel-1@studio-next.local'])
}

function keysWithPub(dir, id = 'REL-1') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${id}.pub`), `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${id} ${id}@studio-next\n`, 'utf8')
  writeFileSync(path.join(dir, 'a.pub'), 'ssh-ed25519 AAAA a@b\n', 'utf8')
}

test('buildPlan：bun 有无两种 verify:v2 形态；--only 过滤；override 覆盖', () => {
  const opts = { overrides: {} }
  const noBun = buildPlan({ repo: '/tmp/x', opts, bunAvailable: false })
  assert.deepEqual(noBun.map((check) => check.id), CHECK_ORDER)
  assert.equal(noBun[0].steps.length, 8) // 分解步
  assert.equal(noBun[0].steps[0].argv[0], 'node')
  const withBun = buildPlan({ repo: '/tmp/x', opts, bunAvailable: true })
  assert.equal(withBun[0].steps.length, 1)
  assert.deepEqual(withBun[0].steps[0].argv, ['bun', 'run', 'verify:v2'])
  const only = buildPlan({ repo: '/tmp/x', opts: { overrides: {}, only: 'verify:docs' }, bunAvailable: true })
  assert.deepEqual(only.map((check) => check.id), ['verify:docs'])
  const overridden = buildPlan({ repo: '/tmp/x', opts: { overrides: { 'scan-repo-secrets': 'true' } }, bunAvailable: true })
  assert.equal(overridden.find((check) => check.id === 'scan-repo-secrets').steps[0].override, 'true')
})

test('resolveCommitKeyCheck：无 registry=skip；有公钥+base 可解析=ok；base 不可解析=skip', () => {
  const dir = tempRoot()
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  run('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'init'])
  const noKeys = resolveCommitKeyCheck({ repo, opts: {}, env: {} })
  assert.equal(noKeys.ok, false)
  assert.match(noKeys.reason, /keys registry 无公钥/)
  keysWithPub(path.join(repo, 'ops', 'keys', 'registry'))
  const noBase = resolveCommitKeyCheck({ repo, opts: {}, env: {} })
  assert.equal(noBase.ok, false) // 本地无 origin/dev
  assert.match(noBase.reason, /git base/)
  const explicitRange = resolveCommitKeyCheck({ repo, opts: { range: 'HEAD~1..HEAD' }, env: {} })
  assert.equal(explicitRange.ok, true)
  assert.equal(explicitRange.range, 'HEAD~1..HEAD')
  // 显式 keys-dir + strict
  const strict = resolveCommitKeyCheck({ repo: '/tmp/nowhere', opts: { strictKeys: true }, env: {} })
  assert.equal(strict.strict, true)
})

test('CLI：--list/--dry-run/--json 摘要；override 成功/失败决定 exit', () => {
  const dir = tempRoot()
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  const list = run(process.execPath, [CHECK, '--repo', repo, '--list', '--json'])
  assert.equal(list.status, 0)
  const listed = JSON.parse(list.stdout)
  assert.deepEqual(listed.checks.map((check) => check.id), CHECK_ORDER)
  const dry = run(process.execPath, [CHECK, '--repo', repo, '--dry-run', '--json'])
  assert.equal(dry.status, 0)
  assert.equal(JSON.parse(dry.stdout).dryRun, true)
  // override 成功 → 0；失败 → 1
  const pass = run(process.execPath, [CHECK, '--repo', repo, '--only', 'verify:docs', '--override', 'verify:docs=true', '--json'])
  assert.equal(pass.status, 0, pass.stderr)
  const lastLine = pass.stdout.trim().split('\n').at(-1)
  assert.equal(JSON.parse(lastLine).ok, true)
  const fail = run(process.execPath, [CHECK, '--repo', repo, '--only', 'verify:docs', '--override', 'verify:docs=false', '--json'])
  assert.equal(fail.status, 1)
  assert.equal(JSON.parse(`${fail.stdout.trim().split('\n').at(-1)}`).ok, false)
})

test('export-key-registry：只导 .pub/.json（绝不导 .key）；导出后 verify-commit-keys 可用', () => {
  const dir = tempRoot()
  const keysDir = path.join(dir, 'external-keys')
  const gen = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--json'])
  assert.equal(gen.status, 0, gen.stderr)
  const meta = JSON.parse(readFileSync(path.join(keysDir, 'REL-1.json'), 'utf8'))
  const outDir = path.join(dir, 'repo', 'ops', 'keys', 'registry')
  mkdirSync(path.join(dir, 'repo'), { recursive: true })
  const exported = run(process.execPath, [EXPORT, '--keys-dir', keysDir, '--out', outDir, '--json'])
  assert.equal(exported.status, 0, exported.stderr)
  const files = readdirSync(outDir).sort()
  assert.ok(files.includes('REL-1.pub'))
  assert.ok(files.includes('REL-1.json'))
  assert.ok(files.includes('README.md'))
  assert.match(readFileSync(path.join(outDir, 'README.md'), 'utf8'), /§十一/)
  assert.equal(files.some((name) => name.endsWith('.key')), false)
  assert.equal(existsSync(path.join(outDir, 'REL-1.key')), false)
  // 导出 registry 后 commit-msg 校验可用（作者/指纹一致）
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  const msg = path.join(dir, 'msg')
  writeFileSync(msg, `feat: x\n\nStudio-Worker: REL-1\nStudio-Key: ${meta.fingerprint}\n`, 'utf8')
  const verify = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', outDir, '--commit-msg', msg], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: 'rel-1@studio-next.local' },
  })
  assert.equal(verify.status, 0, verify.stderr)
})

test('install-git-hooks --with-pre-push：安装 commit-msg+pre-push（可执行/带标记），--remove 清理', () => {
  const dir = tempRoot()
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  symlinkSync(HERE, path.join(repo, 'scripts', 'ops'))
  const installed = run(process.execPath, [INSTALL, '--repo', repo, '--keys-dir', path.join(dir, 'keys'), '--with-pre-push', '--json'])
  assert.equal(installed.status, 0, installed.stderr)
  const parsed = JSON.parse(installed.stdout)
  assert.ok(existsSync(parsed.prePushFile))
  assert.equal(statSync(parsed.prePushFile).mode & 0o111, 0o111)
  const content = readFileSync(parsed.prePushFile, 'utf8')
  assert.match(content, /studio-next-722 pre-push hook/)
  assert.match(content, /required-checks\.mjs/)
  assert.match(content, /SKIP_REQUIRED_CHECKS/)
  const removed = run(process.execPath, [INSTALL, '--repo', repo, '--remove'])
  assert.equal(removed.status, 0)
  assert.equal(existsSync(parsed.prePushFile), false)
  assert.equal(existsSync(parsed.hookFile), false)
})

test('F1（722 v2）：--out 与 --keys-dir 同目录/其内 → 拒绝且私钥不被删（三态）', async () => {
  const dir = tempRoot()
  const keysDir = path.join(dir, 'external-keys')
  const gen = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--json'])
  assert.equal(gen.status, 0, gen.stderr)
  const keyFile = path.join(keysDir, 'REL-1.key')
  const before = readFileSync(keyFile)
  const beforeHash = createHash('sha256').update(before).digest('hex')
  // ① 同目录
  const same = run(process.execPath, [EXPORT, '--keys-dir', keysDir, '--out', keysDir, '--json'])
  assert.notEqual(same.status, 0)
  assert.match(same.stderr, /不得等于/)
  assert.ok(existsSync(keyFile), '同目录拒绝后私钥必须仍在')
  // ② out 在 keys 内
  const inside = run(process.execPath, [EXPORT, '--keys-dir', keysDir, '--out', path.join(keysDir, 'projection'), '--json'])
  assert.notEqual(inside.status, 0)
  assert.match(inside.stderr, /不得位于/)
  assert.ok(existsSync(keyFile))
  // ③ 正常独立目录：导出只含 .pub/.json/README；out 里预置的 .key/任意文件不被删；keys 私钥哈希不变
  const outDir = path.join(dir, 'repo', 'ops', 'keys', 'registry')
  mkdirSync(path.join(outDir, 'subdir'), { recursive: true })
  // 预置：非投影业务文件/子目录/隐藏文件/私钥哨兵/旧同工号投影（应被替换）
  writeFileSync(path.join(outDir, 'stale.key'), 'SENTINEL-PRIVATE-DO-NOT-DELETE', 'utf8')
  writeFileSync(path.join(outDir, 'package.json'), '{"keep":"pkg"}\n', 'utf8')
  writeFileSync(path.join(outDir, 'data.json'), '{"keep":"data"}\n', 'utf8')
  writeFileSync(path.join(outDir, 'notes.pub'), 'keep-notes-pub\n', 'utf8')
  writeFileSync(path.join(outDir, 'old.pub'), 'stale-other-id\n', 'utf8')
  writeFileSync(path.join(outDir, 'notes.txt'), 'keep me\n', 'utf8')
  writeFileSync(path.join(outDir, '.hidden-keep'), 'hidden\n', 'utf8')
  writeFileSync(path.join(outDir, 'subdir', 'keep.txt'), 'subdir keep\n', 'utf8')
  writeFileSync(path.join(outDir, 'REL-1.pub'), 'STALE-PROJECTION-PUB\n', 'utf8')
  writeFileSync(path.join(outDir, 'REL-1.json'), '{"stale":true}\n', 'utf8')
  const ok = run(process.execPath, [EXPORT, '--keys-dir', keysDir, '--out', outDir, '--json'])
  assert.equal(ok.status, 0, ok.stderr)
  const afterHash = createHash('sha256').update(readFileSync(keyFile)).digest('hex')
  assert.equal(afterHash, beforeHash, '私钥内容必须不变')
  // 非投影文件一律保留（F1-a：不按扩展名泛删）
  assert.equal(readFileSync(path.join(outDir, 'stale.key'), 'utf8'), 'SENTINEL-PRIVATE-DO-NOT-DELETE', 'out 内 .key 绝不能被清')
  assert.equal(readFileSync(path.join(outDir, 'package.json'), 'utf8'), '{"keep":"pkg"}\n', 'package.json 绝不能被清')
  assert.equal(readFileSync(path.join(outDir, 'data.json'), 'utf8'), '{"keep":"data"}\n', 'data.json 绝不能被清')
  assert.equal(readFileSync(path.join(outDir, 'notes.pub'), 'utf8'), 'keep-notes-pub\n', 'notes.pub（非本 registry 工号）绝不能被清')
  assert.equal(readFileSync(path.join(outDir, 'old.pub'), 'utf8'), 'stale-other-id\n', '非本工号旧 .pub 保留（不泛删）')
  assert.equal(readFileSync(path.join(outDir, 'notes.txt'), 'utf8'), 'keep me\n', 'notes.txt 不得删除')
  assert.equal(readFileSync(path.join(outDir, '.hidden-keep'), 'utf8'), 'hidden\n', '隐藏文件不得删除')
  assert.equal(readFileSync(path.join(outDir, 'subdir', 'keep.txt'), 'utf8'), 'subdir keep\n', '子目录不得删除')
  // 与本次 registry 工号匹配的旧投影被替换
  assert.notEqual(readFileSync(path.join(outDir, 'REL-1.pub'), 'utf8'), 'STALE-PROJECTION-PUB\n', '匹配工号旧 pub 应被替换')
  assert.match(readFileSync(path.join(outDir, 'REL-1.json'), 'utf8'), /fingerprint/)
  assert.equal(existsSync(path.join(outDir, 'REL-1.key')), false)
})

test('F2（722 v2）：required-checks 从符号链接路径调用仍执行（realpath 入口）；--strict-keys 生效', () => {
  const dir = tempRoot()
  // ① 符号链接入口（模拟 macOS /tmp→/private/tmp 的 argv/import.meta.url 不一致）
  const linkDir = path.join(dir, 'link')
  mkdirSync(linkDir, { recursive: true })
  const link = path.join(linkDir, 'required-checks.mjs')
  symlinkSync(CHECK, link)
  const viaLink = run(process.execPath, [link, '--list', '--json'])
  assert.equal(viaLink.status, 0, viaLink.stderr)
  const listed = JSON.parse(viaLink.stdout)
  assert.deepEqual(listed.checks.map((check) => check.id), CHECK_ORDER)
  // ② --strict-keys：无 keys registry 时 fail（非 skip）；不带时 skip 且 exit0
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  const strict = run(process.execPath, [CHECK, '--repo', repo, '--only', 'verify-commit-keys', '--strict-keys', '--override', 'verify:v2=true', '--json'])
  assert.equal(strict.status, 1)
  const last = JSON.parse(`${strict.stdout.trim().split('\n').at(-1)}`)
  assert.equal(last.results[0].status, 'fail')
  const lenient = run(process.execPath, [CHECK, '--repo', repo, '--only', 'verify-commit-keys', '--json'])
  assert.equal(lenient.status, 0)
  assert.equal(JSON.parse(`${lenient.stdout.trim().split('\n').at(-1)}`).results[0].status, 'skip')
  // ③ env REQUIRE_COMMIT_KEYS=1 与 --strict-keys 同义
  const envStrict = run(process.execPath, [CHECK, '--repo', repo, '--only', 'verify-commit-keys', '--json'], { env: { ...process.env, REQUIRE_COMMIT_KEYS: '1' } })
  assert.equal(envStrict.status, 1)
})

test('A（CI 修复）：registry 在场默认 SKIP 不阻断；严格模式未签名 FAIL、已签名 PASS', async () => {
  // 造 key + 仓库公钥投影（CI 真实形态：ops/keys/registry 已提交）
  const dir = tempRoot()
  const keysDir = path.join(dir, 'external-keys')
  const gen = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--name', '发布', '--json'])
  assert.equal(gen.status, 0, gen.stderr)
  const meta = JSON.parse(readFileSync(path.join(keysDir, 'REL-1.json'), 'utf8'))
  const repo = path.join(dir, 'repo')
  gitInit(repo)
  const outDir = path.join(repo, 'ops', 'keys', 'registry')
  assert.equal(run(process.execPath, [EXPORT, '--keys-dir', keysDir, '--out', outDir, '--json']).status, 0)
  const trailer = `Studio-Worker: REL-1\nStudio-Key: ${meta.fingerprint}`
  const authorEnv = { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: 'rel-1@studio-next.local', GIT_COMMITTER_NAME: 'REL-1', GIT_COMMITTER_EMAIL: 'rel-1@studio-next.local' }
  // 基准提交（供 HEAD~1..HEAD range）
  assert.equal(run('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'chore: base'], { env: authorEnv }).status, 0)
  // commit ①：合法 trailer（未签名）
  assert.equal(run('git', ['-C', repo, 'commit', '--allow-empty', '-m', `feat: A\n\n${trailer}`], { env: authorEnv }).status, 0)
  const baseOpts = ['--repo', repo, '--only', 'verify-commit-keys', '--json']
  // ① 默认（务实模式）→ SKIP 且 exit0（registry 在场不强制）
  const dflt = run(process.execPath, [CHECK, ...baseOpts], { env: { ...process.env, REQUIRE_COMMIT_KEYS: '0' } })
  assert.equal(dflt.status, 0, dflt.stderr)
  const dfltJson = JSON.parse(`${dflt.stdout.trim().split('\n').at(-1)}`)
  assert.equal(dfltJson.results[0].status, 'skip')
  assert.match(String(dfltJson.results[0].reason), /默认 SKIP|不阻断/)
  // ② REQUIRE_COMMIT_KEYS=1：合法 trailer 未签名 → PASS（未要求签名）
  const strictTrailers = run(process.execPath, [CHECK, ...baseOpts, '--range', 'HEAD~1..HEAD'], { env: { ...process.env, REQUIRE_COMMIT_KEYS: '1' } })
  assert.equal(strictTrailers.status, 0, strictTrailers.stderr)
  assert.equal(JSON.parse(`${strictTrailers.stdout.trim().split('\n').at(-1)}`).results[0].status, 'pass')
  // ③ --require-signature：未签名 → FAIL
  const needSig = run(process.execPath, [CHECK, ...baseOpts, '--require-signature', '--range', 'HEAD~1..HEAD'])
  assert.equal(needSig.status, 1)
  assert.equal(JSON.parse(`${needSig.stdout.trim().split('\n').at(-1)}`).results[0].status, 'fail')
  // ④ 已签名 + --require-signature → PASS（真实 ssh-keygen 签名 + allowedSigners）
  const allowed = path.join(dir, 'allowed_signers')
  writeFileSync(allowed, `${meta.email} ${readFileSync(path.join(keysDir, 'REL-1.pub'), 'utf8').trim()}\n`, 'utf8')
  run('git', ['-C', repo, 'config', 'gpg.format', 'ssh'])
  run('git', ['-C', repo, 'config', 'user.signingkey', path.join(keysDir, 'REL-1.key')])
  run('git', ['-C', repo, 'config', 'gpg.ssh.allowedSignersFile', allowed])
  const signed = run('git', ['-C', repo, 'commit', '--allow-empty', '-S', '-m', `feat: signed\n\n${trailer}`], { env: authorEnv })
  assert.equal(signed.status, 0, signed.stderr)
  const sigPass = run(process.execPath, [CHECK, ...baseOpts, '--require-signature', '--range', 'HEAD~1..HEAD'])
  assert.equal(sigPass.status, 0, sigPass.stderr)
  // ⑤ 严格模式（env）下缺 trailer 的提交 → FAIL
  assert.equal(run('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'feat: no trailer'], { env: authorEnv }).status, 0)
  const bad = run(process.execPath, [CHECK, ...baseOpts, '--range', 'HEAD~1..HEAD'], { env: { ...process.env, REQUIRE_COMMIT_KEYS: '1' } })
  assert.equal(bad.status, 1)
})
