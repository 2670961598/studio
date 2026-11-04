/**
 * hr-sync-retry.test —— 784 retry CLI（node --test；真 SQLite 台账 + 真 writer.lock）
 *
 * 覆盖：failed→pending 重置（attempts/last_error 清空）、--dry-run 不写、--daemon-yaml 解析、
 * 无匹配 exit0、缺 --person/--all 拒绝、**daemon 在跑（writer.lock 被持）时拒绝且不改库**。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'
import { openLedger, acquireWriterLease } from '../../packages/store/src/index.ts'

const HERE = import.meta.dirname
const CLI = path.join(HERE, 'hr-sync-retry.mjs')
const roots = []
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-hr-retry-'))
  roots.push(dir)
  return dir
}

function run(args, options = {}) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }), stderr: '' }
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') }
  }
}

/** 建库 + 一条 failed taiga 任务（REL-1 入项目；模拟 775/784 事故行） */
function makeFailedTask(dbPath, id = 'HRS-784-1', personId = 'REL-1') {
  const ledger = openLedger(dbPath)
  ledger.enqueueHrSync({
    id,
    ts: 1,
    company: 'studio-dev',
    person_id: personId,
    kind: '入',
    platform: 'taiga',
    op_key: `${personId}:入`,
    ticket: '@hr:b784',
    status: 'pending',
    attempts: 0,
    payload: { field: '*', prev: null, next: personId, login: personId.toLowerCase(), name: personId, level: 2, role: '发布岗' },
    updated: 1,
  })
  ledger.claimHrSync(id, 2)
  ledger.failHrSync(id, 'CONFIG_INVALID/unknown-role: member', { now: 3, retryLimit: 1 })
  ledger.close()
}

function rowOf(dbPath, id) {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare('SELECT id, status, attempts, last_error FROM hr_sync_log WHERE id = ?').get(id)
  } finally {
    db.close()
  }
}

test('failed→pending：attempts 归零/last_error 清空；--dry-run 不写；再跑无匹配 exit0', () => {
  const dir = tempRoot()
  const db = path.join(dir, 'ledger.sqlite')
  makeFailedTask(db)
  assert.equal(rowOf(db, 'HRS-784-1').status, 'failed')
  // dry-run：不改
  const dry = run(['--db', db, '--person', 'REL-1', '--dry-run', '--json'])
  assert.equal(dry.status, 0, dry.stderr)
  const dryJson = JSON.parse(dry.stdout.trim().split('\n').at(-1))
  assert.equal(dryJson.matched, 1)
  assert.equal(dryJson.reset, 0)
  assert.equal(rowOf(db, 'HRS-784-1').status, 'failed')
  // 真重置
  const reset = run(['--db', db, '--person', 'REL-1', '--json'])
  assert.equal(reset.status, 0, reset.stderr)
  const summary = JSON.parse(reset.stdout.trim().split('\n').at(-1))
  assert.equal(summary.reset, 1)
  assert.equal(summary.queue.pending, 1)
  const row = rowOf(db, 'HRS-784-1')
  assert.equal(row.status, 'pending')
  assert.equal(row.attempts, 0)
  assert.equal(row.last_error, null)
  // 再跑：无匹配
  const again = run(['--db', db, '--person', 'REL-1', '--json'])
  assert.equal(again.status, 0)
  assert.equal(JSON.parse(again.stdout.trim().split('\n').at(-1)).matched, 0)
})

test('安全：daemon 在跑（writer.lock 被持）→ 拒绝且不改库；释放后可执行', () => {
  const dir = tempRoot()
  const db = path.join(dir, 'ledger.sqlite')
  makeFailedTask(db)
  const lease = acquireWriterLease(db, 'fake-daemon')
  try {
    const refused = run(['--db', db, '--person', 'REL-1'])
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /writer\.lock|写者租约|daemon 可能在跑/)
    assert.equal(rowOf(db, 'HRS-784-1').status, 'failed') // 未改
  } finally {
    lease.release()
  }
  const ok = run(['--db', db, '--person', 'REL-1', '--json'])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(rowOf(db, 'HRS-784-1').status, 'pending')
})

test('--daemon-yaml 读 db: 键；缺 --person/--all 拒绝；--all 可批量', () => {
  const dir = tempRoot()
  const db = path.join(dir, 'ledger.sqlite')
  makeFailedTask(db, 'HRS-784-A', 'REL-1')
  makeFailedTask(db, 'HRS-784-B', 'ENG-1')
  const yamlPath = path.join(dir, 'daemon.yaml')
  writeFileSync(yamlPath, `db: ./ledger.sqlite\ncompany: studio-dev\nplatform: taiga\n`, 'utf8')
  // 缺 --person/--all → 拒绝
  const missing = run(['--daemon-yaml', yamlPath])
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /--person|--all/)
  // --all 重置两条
  const all = run(['--daemon-yaml', yamlPath, '--all', '--json'])
  assert.equal(all.status, 0, all.stderr)
  assert.equal(JSON.parse(all.stdout.trim().split('\n').at(-1)).reset, 2)
  assert.equal(rowOf(db, 'HRS-784-A').status, 'pending')
  assert.equal(rowOf(db, 'HRS-784-B').status, 'pending')
  // 平台过滤：非 taiga 不匹配
  const matrix = run(['--db', db, '--person', 'REL-1', '--platform', 'matrix'])
  assert.equal(matrix.status, 0)
  assert.match(matrix.stdout, /无匹配/)
})

test('F2：--id 单独作为充分范围成功；--id+--person 交集；无任何范围仍拒', () => {
  const dir = tempRoot()
  const db = path.join(dir, 'ledger.sqlite')
  makeFailedTask(db, 'HRS-784-ID', 'REL-1')
  makeFailedTask(db, 'HRS-784-ID2', 'ENG-1')
  // ① --id 单独成功（无需 --person/--all）
  const byId = run(['--db', db, '--id', 'HRS-784-ID', '--json'])
  assert.equal(byId.status, 0, byId.stderr)
  assert.equal(JSON.parse(byId.stdout.trim().split('\n').at(-1)).reset, 1)
  assert.equal(rowOf(db, 'HRS-784-ID').status, 'pending')
  // ② --id + --person 交集：id 匹配但 person 不符 → 无匹配、不改
  const mismatch = run(['--db', db, '--id', 'HRS-784-ID2', '--person', 'REL-1', '--json'])
  assert.equal(mismatch.status, 0)
  assert.equal(JSON.parse(mismatch.stdout.trim().split('\n').at(-1)).matched, 0)
  assert.equal(rowOf(db, 'HRS-784-ID2').status, 'failed')
  // ③ --id + --person 一致 → 重置
  const match = run(['--db', db, '--id', 'HRS-784-ID2', '--person', 'ENG-1', '--json'])
  assert.equal(match.status, 0)
  assert.equal(JSON.parse(match.stdout.trim().split('\n').at(-1)).reset, 1)
  // ④ 无任何范围 → 仍拒
  const none = run(['--db', db])
  assert.notEqual(none.status, 0)
  assert.match(none.stderr, /--person|--id|--all/)
})

test('--id 精确重置 + --company 过滤 + dry-run 输出列表', () => {
  const dir = tempRoot()
  const db = path.join(dir, 'ledger.sqlite')
  makeFailedTask(db, 'HRS-784-X', 'REL-1')
  const byId = run(['--db', db, '--id', 'HRS-784-X', '--person', 'REL-1', '--json'])
  assert.equal(byId.status, 0, byId.stderr)
  assert.equal(rowOf(db, 'HRS-784-X').status, 'pending')
  // 错误公司过滤 → 无匹配
  const wrongCompany = run(['--db', db, '--all', '--platform', 'taiga', '--company', 'other'])
  assert.equal(wrongCompany.status, 0)
  assert.match(wrongCompany.stdout, /无匹配/)
})
