/**
 * verify-commit-keys.test —— 721 每人 key/提交校验（真 ssh-keygen + 真 git 仓库夹具）
 *
 * 运行：node --test scripts/ops/verify-commit-keys.test.mjs
 *
 * 覆盖：
 *   - gen-worker-key：key 对生成/权限 600+644/元数据指纹与 ssh-keygen 一致/重复拒（--force 轮换）
 *   - 纯函数：trailer 解析、指纹归一化、verifyCommit 六类失败码
 *   - CLI commit-msg 模式：合法通过；缺 trailer/指纹不符/作者不符/未登记 → exit1（钩子即拒）
 *   - CLI range 模式：历史豁免 + 新提交校验（含 --require-signature 的 SSH 签名正例）
 *   - install-git-hooks：commit-msg 钩子真实拦截/放行；--remove
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { assertKeysDirSafe, normalizeFingerprint, parseTrailers, validateWorkerId, verifyCommit } from './worker-key-lib.mjs'

const HERE = import.meta.dirname
const GEN = path.join(HERE, 'gen-worker-key.mjs')
const VERIFY = path.join(HERE, 'verify-commit-keys.mjs')
const INSTALL = path.join(HERE, 'install-git-hooks.mjs')
const roots = []
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-keys-721-'))
  roots.push(dir)
  return dir
}

function run(command, args, options = {}) {
  const result = (() => {
    try {
      return { status: 0, stdout: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }), stderr: '' }
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') }
    }
  })()
  return result
}

function git(repo, ...args) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'REL-1',
    GIT_AUTHOR_EMAIL: 'rel-1@studio-next.local',
    GIT_COMMITTER_NAME: 'REL-1',
    GIT_COMMITTER_EMAIL: 'rel-1@studio-next.local',
  }
  const result = run('git', ['-C', repo, ...args], { env })
  assert.equal(result.status, 0, `git ${args.join(' ')} 失败：${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

/** 造一个带 key 的临时 git 仓库（author/committer 由 env 指定） */
function makeRepoWithKey(id = 'REL-1') {
  const root = tempRoot()
  const keysDir = path.join(root, 'keys')
  const repo = path.join(root, 'repo')
  const gen = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', id, '--name', '发布', '--json'])
  assert.equal(gen.status, 0, gen.stderr)
  const meta = JSON.parse(readFileSync(path.join(keysDir, `${id}.json`), 'utf8'))
  mkdirSync(repo, { recursive: true })
  run('git', ['init', '-q', repo])
  git(repo, 'config', 'user.name', id)
  git(repo, 'config', 'user.email', meta.email)
  writeFileSync(path.join(repo, 'a.txt'), 'a\n', 'utf8')
  run('git', ['-C', repo, 'add', 'a.txt'])
  return { root, keysDir, repo, meta }
}

function messageFor(meta, over = {}) {
  return `feat: demo\n\nStudio-Worker: ${over.worker ?? meta.id}\nStudio-Key: ${over.key ?? meta.fingerprint}\n`
}

function commit(repo, message) {
  const result = run('git', ['-C', repo, 'commit', '--allow-empty', '-m', message], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'REL-1',
      GIT_AUTHOR_EMAIL: 'rel-1@studio-next.local',
      GIT_COMMITTER_NAME: 'REL-1',
      GIT_COMMITTER_EMAIL: 'rel-1@studio-next.local',
    },
  })
  return result
}

test('gen-worker-key：ed25519 key 对 + 权限 600/644 + 元数据指纹一致；重复默认拒、--force 轮换', () => {
  const dir = tempRoot()
  const keysDir = path.join(dir, 'keys')
  const gen = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--name', '发布', '--json'])
  assert.equal(gen.status, 0, gen.stderr)
  const key = path.join(keysDir, 'REL-1.key')
  const pub = path.join(keysDir, 'REL-1.pub')
  const meta = JSON.parse(readFileSync(path.join(keysDir, 'REL-1.json'), 'utf8'))
  assert.equal(statSync(key).mode & 0o777, 0o600)
  assert.equal(statSync(pub).mode & 0o777, 0o644)
  assert.equal(meta.schema, 'studio-next/worker-key/v1')
  assert.match(meta.fingerprint, /^SHA256:/)
  assert.match(readFileSync(pub, 'utf8'), /REL-1@studio-next/)
  // 指纹与 ssh-keygen 实算一致
  const fp = run('ssh-keygen', ['-l', '-E', 'sha256', '-f', pub]).stdout.trim().split(/\s+/)[1]
  assert.equal(meta.fingerprint, fp)
  // 重复生成拒
  const again = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--json'])
  assert.equal(again.status, 2)
  assert.match(again.stderr, /已存在/)
  // --force 轮换（指纹变化）
  const forced = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', 'REL-1', '--force', '--json'])
  assert.equal(forced.status, 0, forced.stderr)
  const meta2 = JSON.parse(readFileSync(path.join(keysDir, 'REL-1.json'), 'utf8'))
  assert.notEqual(meta2.fingerprint, meta.fingerprint)
})

test('纯函数：trailer 解析/指纹归一化/verifyCommit 失败分类', () => {
  assert.deepEqual(parseTrailers('x\n\nStudio-Worker: REL-1\nStudio-Key: SHA256:abc\n'), { worker: 'REL-1', key: 'SHA256:abc' })
  assert.deepEqual(parseTrailers('no trailers'), {})
  assert.equal(normalizeFingerprint('SHA256:AAAA'), null)
  assert.equal(normalizeFingerprint('aaaa'), null)
  const fp = 'SHA256:' + 'A'.repeat(43)
  assert.equal(normalizeFingerprint(fp), fp)
  assert.equal(normalizeFingerprint(fp.replace('SHA256:', '')), fp)
  const registry = new Map([['REL-1', { id: 'REL-1', name: '发布', email: 'rel-1@studio-next.local', fingerprint: fp }]])
  const base = { authorName: 'REL-1', authorEmail: 'rel-1@studio-next.local', registry }
  assert.deepEqual(verifyCommit({ message: `m\nStudio-Worker: REL-1\nStudio-Key: ${fp}\n`, ...base }).ok, true)
  const codes = (message, over = {}) => verifyCommit({ message, ...base, ...over }).issues.map((issue) => issue.code)
  assert.deepEqual(codes('no trailers'), ['worker-missing', 'key-missing'])
  assert.deepEqual(codes('m\nStudio-Worker: REL-1\nStudio-Key: ' + 'SHA256:' + 'B'.repeat(43)), ['key-mismatch'])
  assert.deepEqual(codes('m\nStudio-Worker: X-9\nStudio-Key: ' + fp), ['worker-unregistered'])
  assert.deepEqual(codes(`m\nStudio-Worker: REL-1\nStudio-Key: ${fp}`, { authorEmail: 'other@x' }), ['author-mismatch'])
  assert.deepEqual(codes(`m\nStudio-Worker: REL-1\nStudio-Key: ${fp}`, { authorName: '别的人' }), ['author-mismatch'])
  assert.deepEqual(codes(`m\nStudio-Worker: REL-1\nStudio-Key: ${fp}`, { requireSignature: true }), ['signature-missing'])
})

test('CLI commit-msg：合法通过；缺 trailer/指纹不符/作者不符/未登记 → exit1（钩子即拒）', () => {
  const { root, keysDir, repo, meta } = makeRepoWithKey()
  const good = path.join(root, 'good.msg')
  writeFileSync(good, messageFor(meta), 'utf8')
  const ok = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--commit-msg', good, '--json'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: meta.email },
  })
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(JSON.parse(ok.stdout).ok, true)
  const bad = path.join(root, 'bad.msg')
  writeFileSync(bad, 'feat: no trailers\n', 'utf8')
  const reject = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--commit-msg', bad], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: meta.email },
  })
  assert.equal(reject.status, 1)
  assert.match(reject.stderr, /worker-missing/)
  const mismatch = path.join(root, 'mismatch.msg')
  writeFileSync(mismatch, messageFor(meta, { key: 'SHA256:' + 'C'.repeat(43) }), 'utf8')
  assert.equal(run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--commit-msg', mismatch], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: meta.email },
  }).status, 1)
  // 作者不符
  assert.equal(run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--commit-msg', good], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'REL-1', GIT_AUTHOR_EMAIL: 'someone@else' },
  }).status, 1)
  // 未登记工号
  const unreg = path.join(root, 'unreg.msg')
  writeFileSync(unreg, messageFor({ id: 'X-9', fingerprint: meta.fingerprint }), 'utf8')
  const r = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--commit-msg', unreg], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'X-9', GIT_AUTHOR_EMAIL: 'x-9@studio-next.local' },
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /worker-unregistered/)
})

test('CLI range：历史提交豁免（只验 range 内）+ 坏提交逐条列出', () => {
  const { keysDir, repo, meta } = makeRepoWithKey()
  // 历史提交（无 trailer，应被 range 排除）
  assert.equal(commit(repo, 'chore: base').status, 0)
  // 合法新提交
  assert.equal(commit(repo, messageFor(meta)).status, 0)
  const pass = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--range', 'HEAD~1..HEAD', '--json'])
  assert.equal(pass.status, 0, pass.stderr)
  const parsed = JSON.parse(pass.stdout)
  assert.equal(parsed.total, 1)
  assert.equal(parsed.ok, true)
  // 坏提交（缺 trailer）进入 range → 红
  assert.equal(commit(repo, 'feat: no trailers').status, 0)
  const fail = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--range', 'HEAD~2..HEAD', '--json'])
  assert.equal(fail.status, 1)
  const data = JSON.parse(fail.stdout)
  assert.equal(data.failed, 1)
  assert.equal(data.commits.filter((c) => !c.ok)[0].issues[0].code, 'worker-missing')
})

test('SSH 签名正例：--require-signature 要求 %G?=G（真实 ssh-keygen 签名）', () => {
  const { root, keysDir, repo, meta } = makeRepoWithKey()
  const allowed = path.join(root, 'allowed_signers')
  const pub = readFileSync(path.join(keysDir, 'REL-1.pub'), 'utf8').trim()
  writeFileSync(allowed, `${meta.email} ${pub}\n`, 'utf8')
  git(repo, 'config', 'gpg.format', 'ssh')
  git(repo, 'config', 'user.signingkey', path.join(keysDir, 'REL-1.key'))
  git(repo, 'config', 'gpg.ssh.allowedSignersFile', allowed)
  assert.equal(commit(repo, 'chore: base').status, 0)
  const msg = messageFor(meta)
  const signed = run('git', ['-C', repo, 'commit', '--allow-empty', '-S', '-m', msg], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'REL-1',
      GIT_AUTHOR_EMAIL: meta.email,
      GIT_COMMITTER_NAME: 'REL-1',
      GIT_COMMITTER_EMAIL: meta.email,
    },
  })
  assert.equal(signed.status, 0, signed.stderr)
  const pass = run(process.execPath, [VERIFY, '--repo', repo, '--keys-dir', keysDir, '--range', 'HEAD~1..HEAD', '--require-signature', '--json'])
  assert.equal(pass.status, 0, pass.stderr)
  assert.equal(JSON.parse(pass.stdout).commits[0].signatureStatus, 'G')
})

test('install-git-hooks：真实 commit-msg 钩子拦截缺 trailer 提交、放行合法提交；--remove', () => {
  const { root, keysDir, repo, meta } = makeRepoWithKey()
  // 临时仓库内 scripts 链接到真脚本（钩子按 <repo>/scripts/ops/... 调用）
  mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  symlinkSync(HERE, path.join(repo, 'scripts', 'ops'))
  const install = run(process.execPath, [INSTALL, '--repo', repo, '--keys-dir', keysDir, '--json'])
  assert.equal(install.status, 0, install.stderr)
  const hookFile = path.join(repo, '.git', 'hooks', 'commit-msg')
  assert.ok(existsSync(hookFile))
  // 缺 trailer → 钩子拒（git commit 非 0）
  const rejected = commit(repo, 'feat: no trailers')
  assert.notEqual(rejected.status, 0)
  assert.match(String(rejected.stderr), /拒提交/)
  // 合法 trailer → 通过
  const accepted = commit(repo, messageFor(meta))
  assert.equal(accepted.status, 0, accepted.stderr)
  // --remove
  const removed = run(process.execPath, [INSTALL, '--repo', repo, '--remove'])
  assert.equal(removed.status, 0)
  assert.equal(existsSync(hookFile), false)
})

test('F2：工号白名单（防 ../escape/路径分隔/盘符）与 keysDir 归属校验（防私钥入仓）', () => {
  // 纯函数：合法/非法工号
  for (const good of ['REL-1', 'ENG-10', 'PRIME-0', 'a.b_c-9']) assert.equal(validateWorkerId(good), good)
  for (const bad of ['', '.', '..', '../escape', 'a/b', 'a\\b', 'C:evil', 'A B', 'x'.repeat(65)]) {
    assert.throws(() => validateWorkerId(bad), /工号/, JSON.stringify(bad))
  }
  // CLI：--id '../escape' 拒且不写出 keysDir 外文件
  const dir = tempRoot()
  const keysDir = path.join(dir, 'keys')
  const escape = run(process.execPath, [GEN, '--keys-dir', keysDir, '--id', '../escape', '--json'])
  assert.notEqual(escape.status, 0)
  assert.equal(existsSync(path.join(dir, 'escape.key')), false)
  assert.equal(existsSync(path.join(dir, 'escape.pub')), false)
  // keysDir 位于 git 工作树内 → 默认拒（私钥禁止入仓）
  const gitRepo = path.join(dir, 'repo')
  mkdirSync(gitRepo, { recursive: true })
  run('git', ['init', '-q', gitRepo])
  const inside = run(process.execPath, [GEN, '--keys-dir', path.join(gitRepo, 'keys'), '--id', 'REL-1'])
  assert.notEqual(inside.status, 0)
  assert.match(inside.stderr, /git 工作树/)
  // 显式 --allow-outside 才允许（演练/特殊布局）
  const allow = run(process.execPath, [GEN, '--keys-dir', path.join(gitRepo, 'keys'), '--id', 'REL-1', '--allow-outside', '--json'])
  assert.equal(allow.status, 0, allow.stderr)
  // 公司目录形态：<companyDir>/docs/keys（与 company/.git 平级，不在 git 工作树内）→ 允许
  const companyDir = path.join(dir, 'companydir')
  mkdirSync(path.join(companyDir, 'company', '.git'), { recursive: true })
  const okCompany = run(process.execPath, [GEN, '--keys-dir', path.join(companyDir, 'docs', 'keys'), '--id', 'REL-1', '--json'])
  assert.equal(okCompany.status, 0, okCompany.stderr)
  assert.ok(existsSync(path.join(companyDir, 'docs', 'keys', 'REL-1.pub')))
  // assertKeysDirSafe 直调：可写目录 ok；文件路径拒
  assert.ok(assertKeysDirSafe(path.join(dir, 'safe-keys')))
  const fileAsDir = path.join(dir, 'notdir')
  writeFileSync(fileAsDir, 'x', 'utf8')
  assert.throws(() => assertKeysDirSafe(fileAsDir), /不是目录/)
})
