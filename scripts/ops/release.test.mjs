#!/usr/bin/env node
/**
 * release.test —— 发布控制面单测（studio-dev-719；node --test）
 *
 * 覆盖施工书 §2/§4：plan 形状（tree 与 rev-parse 一致）；gatesDigest 口径（真实文本→sha256）；
 * 无审批/坏绑定 exit2 且零 deploy 调用（spy）；execute 成功→deploy→record→tag（mock spawn/fs）；
 * rollback 参数与记录；record/tag 前置校验；schema 文件可解析。零网络/零真实 deploy。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  EXIT,
  buildRequest,
  checkBinding,
  computeGatesDigest,
  parseFlags,
  validateRequest,
  validateApproval,
} from './release-lib.mjs'
import { runPlan, runRequest, runExecute, runRollback, runRecord, runTag, runCli } from './release.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const COMMIT = 'a'.repeat(40)
const PREV = 'b'.repeat(40)
const TREE = 'c'.repeat(40)
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)

function makeDeps(overrides = {}) {
  const calls = []
  const writes = new Map()
  const files = new Map()
  const deps = {
    calls,
    writes,
    files,
    spawnSync: (cmd, args) => {
      calls.push([cmd, args])
      if (cmd === 'git') {
        if (args.includes('rev-parse') && args.some((a) => a.endsWith('^{commit}'))) {
          const refArg = args.find((a) => a.endsWith('^{commit}'))
          const ref = refArg.slice(0, -'^{commit}'.length)
          const resolved = /^[0-9a-f]{40}$/.test(ref) ? ref : COMMIT
          return { status: 0, stdout: `${resolved}\n`, stderr: '' }
        }
        if (args.includes('rev-parse') && args.some((a) => a.endsWith('^{tree}'))) return { status: 0, stdout: `${TREE}\n`, stderr: '' }
        if (args.includes('tag')) return { status: 0, stdout: '', stderr: '' }
        if (args.includes('rev-parse') && args.includes('--verify') && args.some((a) => a.startsWith('refs/tags/'))) return { status: 1, stdout: '', stderr: 'not found' }
        return { status: 0, stdout: '', stderr: '' }
      }
      if (cmd === '/fake/node' && args[0]?.endsWith('deploy.mjs')) {
        if (args[1] === 'status') {
          return { status: 0, stdout: JSON.stringify({ command: 'status', state: { targetCommit: PREV, tree: TREE, healthUrl: 'http://127.0.0.1:8788/healthz' }, drifted: false }), stderr: '' }
        }
        if (args[1] === 'deploy') {
          return { status: 0, stdout: JSON.stringify({ command: 'deploy', ok: true, statePath: '/tmp/deploy.state.json', health: { ok: true, pid: 4321 } }), stderr: '' }
        }
      }
      return { status: 1, stdout: '', stderr: 'unexpected' }
    },
    readFile: (file) => {
      if (files.has(file)) return files.get(file)
      throw new Error(`unexpected readFile: ${file}`)
    },
    writeFile: (file, content) => writes.set(file, content),
    exists: (file) => files.has(file) || true,
    listDir: () => [],
    now: () => NOW,
    execPath: '/fake/node',
    cwd: '/tmp/repo',
    ...overrides,
  }
  return deps
}

function captureStdout(fn) {
  const original = process.stdout.write
  let out = ''
  process.stdout.write = (chunk) => {
    out += String(chunk)
    return true
  }
  try {
    const code = fn()
    return { code, out }
  } finally {
    process.stdout.write = original
  }
}

function requestOf(over = {}) {
  return buildRequest({
    version: 'v-test',
    targetCommit: COMMIT,
    tree: TREE,
    previousCommit: PREV,
    gatesDigest: computeGatesDigest(COMMIT, 'verify:v2 PASS 6/6'),
    createdAt: new Date(NOW).toISOString(),
    requestedBy: 'tester',
    ...over,
  })
}
function approvalOf(request, over = {}) {
  return {
    schema: 'studio-next/release-approval/v1',
    version: request.version,
    targetCommit: request.targetCommit,
    tree: request.tree,
    gatesDigest: request.gatesDigest,
    approver: '制作人',
    approvedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86_400_000).toISOString(),
    commentRef: 'taiga:comment:1',
    ...over,
  }
}

test('parseFlags：--k v 与 --k=v/布尔旗标', () => {
  assert.deepEqual(parseFlags(['node', 'release.mjs', 'plan', '--repo', '/r', '--json']).flags, { repo: '/r', json: true })
  assert.equal(parseFlags(['node', 'release.mjs', 'plan', '--version=v1']).flags.version, 'v1')
})

test('形状校验 + 绑定（全等/过期）', () => {
  const request = requestOf()
  assert.deepEqual(validateRequest(request), [])
  assert.deepEqual(validateApproval(approvalOf(request)), [])
  assert.equal(checkBinding(request, approvalOf(request), NOW).ok, true)
  const mismatch = checkBinding(request, approvalOf(request, { tree: 'd'.repeat(40) }), NOW)
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.reason, 'binding-mismatch')
  const expired = checkBinding(request, approvalOf(request, { expiresAt: new Date(NOW - 1).toISOString() }), NOW)
  assert.equal(expired.reason, 'approval-expired')
})

test('gatesDigest 口径：sha256("verify:v2@<commit>:"+最后一条 PASS 行)', () => {
  const out = 'line1\nTest Files 185 passed\nverify:v2 PASS 6/6\n'
  const expected = createHash('sha256').update(`verify:v2@${COMMIT}:verify:v2 PASS 6/6`).digest('hex')
  assert.equal(computeGatesDigest(COMMIT, out), expected)
  assert.throws(() => computeGatesDigest(COMMIT, '   \n'))
})

test('plan：输出含 targetCommit/tree/previousCommit/healthUrl/checklist/gatesDigest', () => {
  const deps = makeDeps()
  const { code, out } = captureStdout(() => runPlan(deps, { repo: '/r', deploy: '/d', ref: 'HEAD', version: 'v-test', 'gates-line': 'verify:v2 PASS 6/6', json: true }))
  assert.equal(code, EXIT.ok)
  const plan = JSON.parse(out)
  assert.equal(plan.targetCommit, COMMIT)
  assert.equal(plan.tree, TREE)
  assert.equal(plan.previousCommit, PREV)
  assert.equal(plan.healthUrl, 'http://127.0.0.1:8788/healthz')
  assert.ok(plan.checklist.some((item) => item.item === 'target-commit' && item.status === 'ok'))
  assert.equal(plan.gatesDigest, computeGatesDigest(COMMIT, 'verify:v2 PASS 6/6'))
})

test('execute 无审批/坏绑定：exit 2 且零 deploy 调用', () => {
  const deps = makeDeps()
  const request = requestOf()
  deps.files.set('/tmp/request.json', JSON.stringify(request))
  deps.files.set('/tmp/approval.json', JSON.stringify({ schema: 'studio-next/release-approval/v1' }))
  assert.throws(
    () => runExecute(deps, { repo: '/r', deploy: '/d', request: '/tmp/request.json', approval: '/tmp/approval.json', json: true }),
    (err) => err.exitStatus === EXIT.approval,
  )
  assert.equal(deps.calls.filter(([cmd, args]) => cmd === '/fake/node' && args?.[1] === 'deploy').length, 0)

  const deps2 = makeDeps()
  deps2.files.set('/tmp/request.json', JSON.stringify(request))
  deps2.files.set('/tmp/approval.json', JSON.stringify(approvalOf(request, { gatesDigest: 'deadbeef-other' })))
  assert.throws(
    () => runExecute(deps2, { repo: '/r', deploy: '/d', request: '/tmp/request.json', approval: '/tmp/approval.json', json: true }),
    (err) => err.exitStatus === EXIT.approval,
  )
  assert.equal(deps2.calls.filter(([cmd, args]) => cmd === '/fake/node' && args?.[1] === 'deploy').length, 0)
})

test('execute 成功：deploy→record→本地 tag（默认不 push）', () => {
  const deps = makeDeps()
  const request = requestOf()
  deps.files.set('/tmp/request.json', JSON.stringify(request))
  deps.files.set('/tmp/approval.json', JSON.stringify(approvalOf(request)))
  const { code, out } = captureStdout(() =>
    runExecute(deps, { repo: '/r', deploy: '/d', request: '/tmp/request.json', approval: '/tmp/approval.json', json: true }),
  )
  assert.equal(code, EXIT.ok)
  const payload = JSON.parse(out)
  assert.equal(payload.targetCommit, COMMIT)
  assert.equal(payload.pushed, false)
  const deployCalls = deps.calls.filter(([cmd, args]) => cmd === '/fake/node' && args?.[1] === 'deploy')
  assert.equal(deployCalls.length, 1)
  assert.deepEqual(deployCalls[0][1].slice(2, 7), ['--repo', '/r', '--deploy', '/d', '--ref'])
  assert.ok(deployCalls[0][1].includes(COMMIT))
  // record 落 docs/releases/v-test.md（mock writeFile 捕获）
  const recordEntry = [...deps.writes.entries()].find(([file]) => file.endsWith('/docs/releases/v-test.md'))
  assert.ok(recordEntry !== undefined)
  assert.match(recordEntry[1], /# release v-test/)
  // 本地 annotated tag（无 push 调用）
  assert.ok(deps.calls.some(([cmd, args]) => cmd === 'git' && args.includes('tag') && args.includes('v-test')))
  assert.equal(deps.calls.filter(([cmd, args]) => cmd === 'git' && args.includes('push')).length, 0)
})

test('rollback：deploy --ref <to> + 回滚记录含 rolledBackTo', () => {
  const deps = makeDeps()
  const { code } = captureStdout(() => runRollback(deps, { repo: '/r', deploy: '/d', to: PREV, json: true }))
  assert.equal(code, EXIT.ok)
  const deployCalls = deps.calls.filter(([cmd, args]) => cmd === '/fake/node' && args?.[1] === 'deploy')
  assert.equal(deployCalls.length, 1)
  assert.ok(deployCalls[0][1].includes(PREV))
  const record = [...deps.writes.entries()].find(([file]) => file.endsWith('.md'))
  assert.ok(record !== undefined)
  assert.match(record[1], /rolledBackTo/)
})

test('record/tag：record 绑定校验；tag dry-run 不写；tag 已存在拒', () => {
  const deps = makeDeps()
  const request = requestOf()
  deps.files.set('/tmp/request.json', JSON.stringify(request))
  deps.files.set('/tmp/approval.json', JSON.stringify(approvalOf(request)))
  const recordOut = captureStdout(() =>
    runRecord(deps, { version: 'v-test', commit: COMMIT, tree: TREE, request: '/tmp/request.json', approval: '/tmp/approval.json', out: '/tmp/out.md', json: true }),
  )
  assert.equal(recordOut.code, EXIT.ok)
  assert.ok(deps.writes.has('/tmp/out.md'))
  const tagOut = captureStdout(() => runTag(deps, { version: 'v-test', commit: COMMIT, 'dry-run': true, json: true }))
  assert.equal(tagOut.code, EXIT.ok)
  assert.match(tagOut.out, /dryRun/)
})

test('request：缺 gates 来源拒绝（不伪造）；提供真实文本→request 形状合法', () => {
  const deps = makeDeps()
  assert.throws(() => runRequest(deps, { repo: '/r', deploy: '/d', ref: 'HEAD', version: 'v-test', out: '/tmp/req.json', json: true }), (err) => err.exitStatus === EXIT.usage)
  const { code, out } = captureStdout(() =>
    runRequest(deps, { repo: '/r', deploy: '/d', ref: 'HEAD', version: 'v-test', out: '/tmp/req.json', 'gates-line': 'verify:v2 PASS 6/6', by: 'tester', json: true }),
  )
  assert.equal(code, EXIT.ok)
  const payload = JSON.parse(out)
  assert.equal(payload.request.targetCommit, COMMIT)
  assert.equal(payload.request.gatesDigest, computeGatesDigest(COMMIT, 'verify:v2 PASS 6/6'))
})

test('schema 文件可解析且三形状齐全；help exit0', () => {
  const schema = JSON.parse(readFileSync(path.join(HERE, 'release-request.schema.json'), 'utf8'))
  for (const key of ['request', 'approval', 'releaseRecord']) assert.ok(schema.definitions[key] !== undefined)
  const { code } = captureStdout(() => runCli(['node', 'release.mjs', 'help']))
  assert.equal(code, EXIT.ok)
})
