/**
 * kimi-token-refresh.test.mjs —— 刷新器 CLI 契约测试（docs/quality/kimi-on-dsh.md §3/§8）
 *
 * 依据：scripts/ops/kimi-token-refresh.mjs 头注契约（退出码/原子写 0600/轮换回写/dry-run/
 *   不打印 token）。本地假 HTTP 服务模拟 auth.kimi.com token 端点——不打真网、不用真凭据；
 *   夹具 token 值一律 fake- 前缀（仓面扫描 PLACEHOLDER 豁免，scan-repo-secrets.mjs）。
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import http from 'node:http'

const execFileAsync = promisify(execFile)
const CLI = new URL('../ops/kimi-token-refresh.mjs', import.meta.url).pathname
const ROOTS = []

/** 跑刷新器 CLI：非零退出码不抛——返回 {status, stdout, stderr}（hr-sync-retry.test.mjs 同法）。 */
async function run(args, env) {
  const clean = { ...process.env }
  for (const k of Object.keys(clean)) if (k.startsWith('KIMI_') || k.startsWith('STUDIO_KIMI_')) delete clean[k]
  try {
    const r = await execFileAsync(process.execPath, [CLI, ...args], { env: { ...clean, ...env }, encoding: 'utf8', timeout: 20_000 })
    return { status: 0, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return { status: typeof err.code === 'number' ? err.code : 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** 假 token 端点：handlers 队列逐次消费（空则用 default）；记录命中数与收到的 form 体。 */
async function startFakeAuth(handlers, fallback) {
  const state = { hits: 0, bodies: [] }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += String(c) })
    req.on('end', () => {
      state.hits += 1
      state.bodies.push(raw)
      const handler = handlers.length > 0 ? handlers.shift() : fallback
      handler(req, res, raw)
    })
  })
  const port = await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(server.address().port) }) })
  return { server, state, url: `http://127.0.0.1:${String(port)}` }
}

const jsonRes = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 造一套隔离环境：credentials 目录＋token 输出目录＋假凭据文件（0600，同真形状）。 */
function makeEnv(name, credsOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), `kimi-refresh-${name}-`))
  ROOTS.push(root)
  const credFile = join(root, 'creds', 'kimi-code.json')
  mkdirSync(join(root, 'creds'), { recursive: true })
  const creds = { access_token: 'fake-access-old', refresh_token: 'fake-refresh-old', expires_at: 1_700_000_000, expires_in: 900, scope: 'coding:all', token_type: 'Bearer', ...credsOverrides }
  writeFileSync(credFile, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  const tokenFile = join(root, 'secrets', 'kimi-access-token')
  return { root, credFile, tokenFile, env: { KIMI_CREDENTIALS_FILE: credFile, STUDIO_KIMI_TOKEN_FILE: tokenFile, KIMI_REFRESH_BACKOFF_BASE_MS: '1', KIMI_REFRESH_MAX_ATTEMPTS: '3' } }
}

/** tmp 残留=原子性破坏（§3：隐藏 tmp→rename，正常路径必零残留）。 */
const tmpLeftovers = (dir) => { try { return readdirSync(dir).filter((f) => f.includes('.tmp-')) } catch { return [] } }

const okHandler = () => (req, res) => jsonRes(res, 200, { access_token: 'fake-access-new', refresh_token: 'fake-refresh-rotated', expires_in: 900 })

before(() => {})
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }) })

test('刷新成功：token 文件 0600 内容仅 token；credentials 轮换回写保序；无 tmp 残留；不打印 token', async () => {
  const e = makeEnv('ok')
  const fake = await startFakeAuth([], okHandler())
  const r = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`)
  assert.equal(readFileSync(e.tokenFile, 'utf8'), 'fake-access-new\n')
  assert.equal(statSync(e.tokenFile).mode & 0o777, 0o600)
  const nowSec = Math.floor(Date.now() / 1000)
  const cred = JSON.parse(readFileSync(e.credFile, 'utf8'))
  assert.equal(cred.access_token, 'fake-access-new')
  assert.equal(cred.refresh_token, 'fake-refresh-rotated')
  assert.ok(Math.abs(Number(cred.expires_at) - (nowSec + 900)) <= 5, `expires_at=${String(cred.expires_at)}`)
  assert.equal(cred.scope, 'coding:all')
  assert.equal(cred.token_type, 'Bearer')
  assert.equal(statSync(e.credFile).mode & 0o777, 0o600)
  // 请求面：form 表单三字段（client_id/grant_type/refresh_token=旧值）
  assert.equal(fake.state.hits, 1)
  const form = new URLSearchParams(fake.state.bodies[0])
  assert.equal(form.get('grant_type'), 'refresh_token')
  assert.equal(form.get('refresh_token'), 'fake-refresh-old')
  assert.ok((form.get('client_id') ?? '').length > 10)
  // 原子性与无泄漏
  assert.deepEqual(tmpLeftovers(join(e.root, 'creds')), [])
  assert.deepEqual(tmpLeftovers(join(e.root, 'secrets')), [])
  assert.ok(!`${r.stdout}${r.stderr}`.includes('fake-access-new'))
  assert.ok(!`${r.stdout}${r.stderr}`.includes('fake-refresh-old'))
  assert.ok(!`${r.stdout}${r.stderr}`.includes('fake-refresh-rotated'))
  fake.server.close()
})

test('凭据死（400 invalid_grant / 403）：非零退出＋明报重登；两文件都不动', async () => {
  for (const handler of [(req, res) => jsonRes(res, 400, { error: 'invalid_grant' }), (req, res) => jsonRes(res, 403, {})]) {
    const e = makeEnv('dead')
    const fake = await startFakeAuth([handler], handler)
    const r = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
    assert.notEqual(r.status, 0)
    assert.ok(r.stderr.includes('失效'), r.stderr)
    assert.ok(r.stderr.includes('kimi login'), r.stderr)
    assert.equal(JSON.parse(readFileSync(e.credFile, 'utf8')).refresh_token, 'fake-refresh-old')
    assert.equal(statSync(e.credFile).mode & 0o777, 0o600)
    assert.ok(!exists(e.tokenFile))
    assert.ok(!`${r.stdout}${r.stderr}`.includes('fake-refresh-old'))
    fake.server.close()
  }
})

test('坏响应（200 缺字段）：非零退出＋坏响应明报；两文件都不动', async () => {
  const e = makeEnv('bad')
  const bad = () => (req, res) => jsonRes(res, 200, { ok: true })
  const fake = await startFakeAuth([], bad())
  const r = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.notEqual(r.status, 0)
  assert.ok(r.stderr.includes('坏响应'), r.stderr)
  assert.equal(JSON.parse(readFileSync(e.credFile, 'utf8')).refresh_token, 'fake-refresh-old')
  assert.ok(!exists(e.tokenFile))
  fake.server.close()
})

test('网络不可达：重试后仍败=非零退出；文件不动；不重试风暴（max=1）', async () => {
  const e = makeEnv('net', {})
  const dead = await startFakeAuth([], okHandler())
  const url = dead.url
  dead.server.close()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const r = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: url, KIMI_REFRESH_MAX_ATTEMPTS: '1' })
  assert.notEqual(r.status, 0)
  assert.ok(r.stderr.includes('失败'), r.stderr)
  assert.equal(JSON.parse(readFileSync(e.credFile, 'utf8')).refresh_token, 'fake-refresh-old')
  assert.ok(!exists(e.tokenFile))
})

test('5xx 一次后退避重试成功：退出 0；命中 2 次', async () => {
  const e = makeEnv('retry')
  const fake = await startFakeAuth([(req, res) => jsonRes(res, 503, {})], okHandler())
  const r = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fake.state.hits, 2)
  assert.equal(readFileSync(e.tokenFile, 'utf8'), 'fake-access-new\n')
  fake.server.close()
})

test('dry-run=预检（零副作用）：不发请求、不写文件；凭据库坏=非零退出', async () => {
  const e = makeEnv('dry')
  const fake = await startFakeAuth([], okHandler())
  const r = await run(['--once', '--dry-run'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('dry-run'), r.stdout)
  assert.ok(r.stdout.includes('未发请求'), r.stdout)
  assert.equal(fake.state.hits, 0) // 不打网络——刷新请求会轮换 refresh_token，dry-run 试网=断链
  assert.equal(JSON.parse(readFileSync(e.credFile, 'utf8')).refresh_token, 'fake-refresh-old')
  assert.ok(!exists(e.tokenFile))
  const e2 = makeEnv('dry-bad', { refresh_token: '' })
  const r2 = await run(['--once', '--dry-run'], { ...e2.env, KIMI_OAUTH_HOST: fake.url })
  assert.notEqual(r2.status, 0)
  assert.ok(r2.stderr.includes('refresh_token'), r2.stderr)
  fake.server.close()
})

test('凭据库缺失 / 缺 refresh_token：非零退出＋明报；不落盘', async () => {
  const e = makeEnv('nocred', { refresh_token: '' })
  const fake = await startFakeAuth([], okHandler())
  const r1 = await run(['--once', '--credentials', join(e.root, 'creds', 'nope.json')], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.notEqual(r1.status, 0)
  assert.ok(r1.stderr.includes('不可读'), r1.stderr)
  const r2 = await run(['--once'], { ...e.env, KIMI_OAUTH_HOST: fake.url })
  assert.notEqual(r2.status, 0)
  assert.ok(r2.stderr.includes('refresh_token'), r2.stderr)
  assert.equal(fake.state.hits, 0)
  assert.ok(!exists(e.tokenFile))
  fake.server.close()
})

test('用法：无参=退出 2＋usage；未知旗标=退出 2', async () => {
  const r1 = await run([])
  assert.equal(r1.status, 2)
  assert.ok(r1.stdout.includes('--once'), r1.stdout)
  const r2 = await run(['--once', '--bogus'])
  assert.equal(r2.status, 2)
  assert.ok(r2.stderr.includes('未知参数'), r2.stderr)
})

/** exists 小工具（避免只为判存在引整个 fs 语法）。 */
function exists(p) {
  try { statSync(p); return true } catch { return false }
}
