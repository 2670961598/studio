/**
 * hr-taiga-account.test —— 793 手动建号/绑号 CLI（真 fake Taiga HTTP + 真台账 writer lease）
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { acquireWriterLease, openLedger } from '../../packages/store/src/index.ts'

const HERE = import.meta.dirname
const CLI = path.join(HERE, 'hr-taiga-account.mjs')
const roots = []
const servers = []
after(() => {
  for (const s of servers.splice(0)) s.close()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function tempRoot() { const d = mkdtempSync(path.join(tmpdir(), 'sn-hr-taiga-account-')); roots.push(d); return d }
/**
 * 异步 spawn（不能用 execFileSync：父进程阻塞会让本进程内的 fake HTTP server 无法响应子 CLI 请求→假死）
 */
function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.once('exit', (code) => { clearTimeout(timer); resolve({ status: code ?? 1, stdout, stderr }) })
    child.once('error', (err) => { clearTimeout(timer); resolve({ status: 1, stdout, stderr: String(err) }) })
  })
}
function fixtureDb(dir) {
  const db = path.join(dir, 'ledger.sqlite')
  const ledger = openLedger(db)
  ledger.enqueueHrSync({ id: 'HRS-793-1', ts: 1, company: 'studio-dev', person_id: 'REL-1', kind: '入', platform: 'taiga', op_key: 'rel-1:入', ticket: '@hr:b793', status: 'pending', attempts: 0, payload: { field: '*', prev: null, next: 'REL-1' }, updated: 1 })
  ledger.claimHrSync('HRS-793-1', 2)
  ledger.failHrSync('HRS-793-1', 'unknown-role', { now: 3, retryLimit: 1 })
  ledger.close()
  return db
}

/** fake Taiga：auth/login、roles、memberships(GET/POST)、auth/register */
async function fakeTaiga() {
  const calls = []
  const memberships = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const json = body === '' ? undefined : JSON.parse(body)
      calls.push({ method: req.method, path: url.pathname, query: url.search, body: json })
      res.setHeader('content-type', 'application/json')
      if (req.method === 'POST' && url.pathname === '/api/v1/auth') { res.end(JSON.stringify({ auth_token: 'fake-token' })); return }
      if (req.method === 'GET' && url.pathname === '/api/v1/projects/by_slug') { res.end(JSON.stringify({ id: 3, slug: '3' })); return }
      if (req.method === 'GET' && url.pathname === '/api/v1/roles') { res.end(JSON.stringify([{ id: 18, name: 'Stakeholder', slug: 'stakeholder' }])); return }
      if (req.method === 'GET' && url.pathname === '/api/v1/memberships') { res.end(JSON.stringify(memberships)); return }
      if (req.method === 'POST' && url.pathname === '/api/v1/memberships') {
        const row = { id: 44, email: json.username, user: json.username.includes('prebuilt') ? 77 : null, role: 18, role_name: 'Stakeholder', is_active: true }
        memberships.push(row); res.end(JSON.stringify(row)); return
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/register') { res.statusCode = 201; res.end(JSON.stringify({ username: json.username, id: 99 })); return }
      if (req.method === 'GET' && url.pathname === '/api/v1/users') { res.end(JSON.stringify([])); return }
      res.statusCode = 404; res.end(JSON.stringify({ _error_message: 'not found' }))
    })
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls, memberships }
}

test('dry-run 不需要租约/不调 Taiga；真实执行遇 writer.lock 持锁 → 拒绝', async () => {
  const dir = tempRoot(); const db = fixtureDb(dir)
  const tg = await fakeTaiga()
  const env = { TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'fixture' }
  const dry = await run(['--person', 'REL-1', '--mode', 'invite-email', '--db', db, '--taiga-url', tg.baseUrl, '--project', '3', '--dry-run', '--json'], env)
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(JSON.parse(dry.stdout.trim().split('\n').at(-1)).dryRun, true)
  assert.equal(tg.calls.length, 0) // dry-run 零 HTTP
  const lease = acquireWriterLease(db, 'fake-daemon')
  try {
    const refused = await run(['--person', 'REL-1', '--mode', 'invite-email', '--db', db, '--taiga-url', tg.baseUrl, '--project', '3', '--json'], env)
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /writer\.lock|写者租约|daemon 可能在跑/)
  } finally { lease.release() }
})

test('invite-email：POST /memberships username=<person>@<domain>；可选 reset failed→pending', async () => {
  const dir = tempRoot(); const db = fixtureDb(dir)
  const tg = await fakeTaiga()
  const r = await run(['--person', 'REL-1', '--mode', 'invite-email', '--db', db, '--taiga-url', tg.baseUrl, '--project', '3', '--mark-pending', '--json'], { TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'fixture' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1))
  assert.equal(out.action, 'invited')
  assert.equal(out.email, 'rel-1@studio.local')
  const invite = tg.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/memberships')
  assert.equal(invite.body.username, 'rel-1@studio.local')
  assert.equal(out.markPending.changed, 1)
})

test('bind-existing：daemon.yaml 池命中 → POST membership 用池 email；不建号', async () => {
  const dir = tempRoot(); const db = fixtureDb(dir); const tg = await fakeTaiga()
  const yaml = path.join(dir, 'daemon.yaml')
  writeFileSync(yaml, `db: ${db}\ntaigaUrl: ${tg.baseUrl}\ntaigaProject: 3\nhrTaigaEmailDomain: studio.local\nhrTaigaAccountPool: '{"REL-1":"prebuilt@studio.local"}'\n`, 'utf8')
  const r = await run(['--person', 'REL-1', '--mode', 'bind-existing', '--daemon-yaml', yaml, '--json'], { TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'fixture' })
  assert.equal(r.status, 0, r.stderr)
  const invite = tg.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/memberships')
  assert.equal(invite.body.username, 'prebuilt@studio.local')
  assert.equal(tg.calls.filter((c) => c.path === '/api/v1/auth/register').length, 0)
})

test('register-token：POST /auth/register 带 email/accepted_terms/token', async () => {
  const dir = tempRoot(); const db = fixtureDb(dir); const tg = await fakeTaiga()
  const r = await run(['--person', 'REL-1', '--mode', 'register-token', '--token', 'AbCdEfGh1234567890123456789012345678', '--email', 'rel-1@studio.local', '--db', db, '--taiga-url', tg.baseUrl, '--project', '3', '--json'], { TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'fixture' })
  assert.equal(r.status, 0, r.stderr)
  const reg = tg.calls.find((c) => c.path === '/api/v1/auth/register')
  assert.equal(reg.body.type, 'private')
  assert.equal(reg.body.email, 'rel-1@studio.local')
  assert.equal(reg.body.accepted_terms, true)
  assert.equal(reg.body.username, 'REL-1')
})
