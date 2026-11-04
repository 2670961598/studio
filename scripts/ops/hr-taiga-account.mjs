#!/usr/bin/env node
/**
 * hr-taiga-account —— 793 手动建号/绑号接口（A 自动建号 / B 预建池 的手动对应面）
 *
 * 由 Lead 在 **停 daemon 窗口**执行；只做 Taiga 成员/账号面，可选把该人 failed hr_sync_log
 * 重置为 pending（重放由 daemon 消化器接手）。安全：
 *   - 先取台账写者租约（`<db>.writer.lock`）——daemon 在跑=拒绝，不覆盖/不删他人锁；
 *   - 只写 Taiga membership/注册端点 +（可选）hr_sync_log 四列；不动台账其它表/公司目录；
 *   - `--dry-run` 只打印计划，不取租约、不调 Taiga（可在 daemon 运行期预演）。
 *
 * 模式：
 *   --mode invite-email     A 路径手动版：用 `<person>@<domain>`（或 --email）发 Taiga 邀请（不注册，供排查/人工继续）
 *   --mode bind-existing    B 路径手动版：用已存在 Taiga 账号 email/username（--email 或池映射）直接绑 membership
 *   --mode register-token   用已有邀请 token 完成注册建号（--token；username 缺省=person；email 缺省=<person>@<domain>）
 *
 * 用法：
 *   node scripts/ops/hr-taiga-account.mjs --person REL-1 --mode bind-existing \
 *     --daemon-yaml <companyDir>/daemon.yaml --email rel-1@studio.local --json
 *   环境：TAIGA_USERNAME / TAIGA_PASSWORD（admin，仅从 env 读，不打印）；
 *   可选 TAIGA_URL/TAIGA_PROJECT 覆盖（缺省取 daemon.yaml taigaUrl/taigaProject）。
 *
 * 退出码：0=成功；1=用法/拒绝；2=执行失败（错误如实上报，邀请行保留供排查）。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const USAGE = `用法：node scripts/ops/hr-taiga-account.mjs --person <工号> --mode invite-email|bind-existing|register-token [选项]

选项：
  --person <工号>        目标人员（必填；用于缺省 email/username/池映射）
  --mode <m>             invite-email|bind-existing|register-token（必填）
  --db <ledger.sqlite>   台账（真实执行必须；取 writer.lock/可选重置 failed）
  --daemon-yaml <file>   读 db/taigaUrl/taigaProject/hrTaigaEmailDomain/hrTaigaAccountPool；与 --db 可并用
  --email <email>        邮箱（A 缺省 <person>@<domain>；B 必填或池命中；register-token 缺省 <person>@<domain>）
  --username <name>      register-token 的 Taiga username（缺省=person；不能含 @）
  --token <token>        register-token 的邀请 token（必须）
  --role <slug>          邀请/绑定角色（缺省 stakeholder；allowlist：ux/design/front/back/product-owner/stakeholder）
  --index <n>            操作第 n 条 failed 任务（缺省 1；--mark-pending 用）
  --mark-pending         成功后把该人 failed taiga 任务重置 pending（复用 retry 语义，只改四列）
  --dry-run              只打印计划（不取租约、不调 Taiga）
  --json                 输出 JSON 摘要（stdout 最后一行）
  --help                 本帮助

环境：TAIGA_USERNAME / TAIGA_PASSWORD（admin；真实执行必填，不打印）；可选 TAIGA_URL/TAIGA_PROJECT。`

const EXIT = { ok: 0, refused: 1, error: 2 }
const ROLE_ALLOWLIST = ['ux', 'design', 'front', 'back', 'product-owner', 'stakeholder']

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (['--dry-run', '--json', '--mark-pending'].includes(token)) {
      opts[token.slice(2)] = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    opts[key] = value
    i += 1
  }
  return { help: false, opts }
}

function parseFlatYaml(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (m === null) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else {
      const hash = v.indexOf(' #')
      if (hash >= 0) v = v.slice(0, hash).trim()
    }
    out[m[1]] = v
  }
  return out
}

function resolveConfig(opts) {
  const daemonYaml = typeof opts['daemon-yaml'] === 'string' && opts['daemon-yaml'] !== '' ? path.resolve(opts['daemon-yaml']) : ''
  let yaml = {}
  if (daemonYaml !== '') {
    if (!existsSync(daemonYaml)) throw new Error(`daemon.yaml 不存在：${daemonYaml}`)
    yaml = parseFlatYaml(readFileSync(daemonYaml, 'utf8'))
  }
  const dbRaw = typeof opts.db === 'string' && opts.db !== '' ? opts.db : yaml.db
  if (dbRaw === undefined || dbRaw === '') throw new Error('缺 --db 或 daemon.yaml 的 db:（真实执行需台账租约）')
  const baseDir = daemonYaml !== '' ? path.dirname(daemonYaml) : process.cwd()
  const db = path.resolve(baseDir, String(dbRaw))
  const taigaUrl = String(opts['taiga-url'] ?? process.env['TAIGA_URL'] ?? yaml.taigaUrl ?? 'http://127.0.0.1:9000')
  const project = String(opts.project ?? process.env['TAIGA_PROJECT'] ?? yaml.taigaProject ?? 'studio-dev')
  const domain = String(opts.domain ?? yaml.hrTaigaEmailDomain ?? 'studio.local').trim().toLowerCase()
  const poolRaw = yaml.hrTaigaAccountPool
  let pool = {}
  if (poolRaw !== undefined && poolRaw !== '') {
    const text = String(poolRaw).trim()
    try {
      const parsed = text.startsWith('{') ? JSON.parse(text) : null
      pool = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)])) : {}
    } catch {
      pool = {}
    }
  }
  const container = typeof opts.container === 'string' && opts.container !== '' ? opts.container : yaml.hrTaigaInviteLogDocker
  return { db, taigaUrl, project, domain, pool, container: container === undefined ? undefined : String(container) }
}

function redactToken(token) {
  return typeof token === 'string' && token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : '<token>'
}

async function loadDeps(repoRoot) {
  const storeUrl = pathToFileURL(path.join(repoRoot, 'packages', 'store', 'src', 'index.ts')).href
  const taigaUrl = pathToFileURL(path.join(repoRoot, 'packages', 'taiga', 'src', 'index.ts')).href
  const store = await import(storeUrl)
  const taiga = await import(taigaUrl)
  return { store, taiga }
}

function makeContext(taiga, cfg) {
  const username = process.env['TAIGA_USERNAME']
  const password = process.env['TAIGA_PASSWORD']
  if (username === undefined || username === '' || password === undefined || password === '') {
    throw new Error('真实执行需 env TAIGA_USERNAME/TAIGA_PASSWORD（admin；值不打印）')
  }
  return taiga.buildContext({ baseUrl: cfg.taigaUrl, project: cfg.project, auth: { type: 'password', username, password } })
}

async function runMode(mode, ctx, taiga, cfg, opts) {
  const person = String(opts.person)
  const role = String(opts.role ?? 'stakeholder')
  if (!ROLE_ALLOWLIST.includes(role)) throw new Error(`--role 须为 ${ROLE_ALLOWLIST.join('/')}（实得 ${role}；784 项目角色 allowlist）`)
  if (mode === 'invite-email') {
    const email = String(opts.email ?? `${person.toLowerCase()}@${cfg.domain}`)
    const existing = await taiga.findMembershipByEmail(ctx, email)
    if (existing !== undefined) return { action: 'exists', membershipId: existing.id, email, userId: existing.userId ?? null }
    const invited = await taiga.inviteMember(ctx, { username: person, roleSlug: role, email })
    return { action: 'invited', membershipId: invited.id, email, userId: invited.userId ?? null, roleSlug: role }
  }
  if (mode === 'bind-existing') {
    const mapped = cfg.pool[person]
    const value = String(opts.email ?? mapped ?? '')
    if (value === '') throw new Error(`bind-existing 需 --email 或 daemon.yaml hrTaigaAccountPool 命中 ${person}`)
    const existing = await taiga.findMembershipByEmail(ctx, value)
    if (existing !== undefined) return { action: 'exists', membershipId: existing.id, value, userId: existing.userId ?? null }
    const invited = value.includes('@')
      ? await taiga.inviteMember(ctx, { username: person, roleSlug: role, email: value })
      : await taiga.inviteMember(ctx, { username: value, roleSlug: role })
    return { action: 'bound', membershipId: invited.id, value, userId: invited.userId ?? null, roleSlug: role }
  }
  if (mode === 'register-token') {
    const token = typeof opts.token === 'string' ? opts.token : ''
    if (token === '') throw new Error('register-token 需 --token（邀请 token；从日志/邮件取）')
    const username = String(opts.username ?? person)
    if (!/^[\w.-]+$/.test(username) || username.includes('@')) throw new Error(`--username 须匹配 Taiga 注册规则 ^[\\w.-]+$（不能含 @；实得 ${username}）`)
    const email = String(opts.email ?? `${person.toLowerCase()}@${cfg.domain}`)
    const fullName = String(opts['full-name'] ?? person)
    const result = await taiga.registerWithInviteToken({ baseUrl: cfg.taigaUrl, token, username, email, password: `sn-${token.slice(0, 12)}`, fullName })
    return { action: 'registered', username: result.username, userId: result.userId ?? null, email, token: redactToken(token) }
  }
  throw new Error(`未知 --mode：${mode}（invite-email|bind-existing|register-token）`)
}

function resetFailedRows(dbPath, person, index) {
  const db = new DatabaseSync(dbPath)
  try {
    const rows = db.prepare("SELECT id FROM hr_sync_log WHERE person_id=? AND platform='taiga' AND status='failed' ORDER BY ts ASC").all(person)
    const row = rows[Math.max(0, index - 1)]
    if (row === undefined) return null
    const id = String(row.id)
    const result = db.prepare("UPDATE hr_sync_log SET status='pending', attempts=0, last_error=NULL, updated=? WHERE id=? AND status='failed'").run(Date.now(), id)
    return { id, changed: Number(result.changes) }
  } finally {
    db.close()
  }
}

async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`hr-taiga-account：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.refused
  }
  if (parsed.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = parsed.opts
  if (typeof opts.person !== 'string' || opts.person === '') {
    process.stderr.write('hr-taiga-account：缺 --person <工号>\n')
    return EXIT.refused
  }
  const mode = String(opts.mode ?? '')
  if (!['invite-email', 'bind-existing', 'register-token'].includes(mode)) {
    process.stderr.write('hr-taiga-account：--mode 须为 invite-email|bind-existing|register-token\n')
    return EXIT.refused
  }
  let cfg
  try {
    cfg = resolveConfig(opts)
  } catch (err) {
    process.stderr.write(`hr-taiga-account：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.refused
  }
  const dryRun = opts['dry-run'] === true
  const json = opts.json === true
  const person = String(opts.person)
  if (dryRun) {
    const email = String(opts.email ?? `${person.toLowerCase()}@${cfg.domain}`)
    const summary = {
      ok: true,
      dryRun: true,
      mode,
      person,
      db: cfg.db,
      taigaUrl: cfg.taigaUrl,
      project: cfg.project,
      domain: cfg.domain,
      planned:
        mode === 'invite-email'
          ? { endpoint: 'POST /memberships', username: email, role: opts.role ?? 'stakeholder', note: 'A 手动邀请（不注册）' }
          : mode === 'bind-existing'
            ? { endpoint: 'POST /memberships', username: opts.email ?? cfg.pool[person] ?? '<需 --email 或池命中>', role: opts.role ?? 'stakeholder', note: 'B 只绑不建号' }
            : { endpoint: 'POST /auth/register', type: 'private', username: opts.username ?? person, email, token: '<redacted>', note: '用已有邀请 token 注册' },
      ...(opts['mark-pending'] === true ? { markPending: { person, index: Number(opts.index ?? 1) } } : {}),
    }
    if (json) process.stdout.write(`${JSON.stringify(summary)}\n`)
    else process.stdout.write(`[dry-run] ${mode} person=${person} db=${cfg.db} → ${JSON.stringify(summary.planned)}\n`)
    return EXIT.ok
  }
  if (!existsSync(cfg.db)) {
    process.stderr.write(`hr-taiga-account：台账不存在：${cfg.db}\n`)
    return EXIT.refused
  }
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  let store, taiga
  try {
    ;({ store, taiga } = await loadDeps(repoRoot))
  } catch (err) {
    process.stderr.write(`hr-taiga-account：依赖加载失败（${err instanceof Error ? err.message : String(err)}）\n`)
    return EXIT.error
  }
  let lease
  try {
    lease = store.acquireWriterLease(cfg.db, 'hr-taiga-account')
  } catch (err) {
    process.stderr.write(
      `hr-taiga-account：无法取得台账写者租约（${err instanceof Error ? err.message : String(err)}）\n` +
        `  处理：daemon 可能在跑（writer.lock 被持）——先停 daemon 再执行；不要手工删 ${cfg.db}.writer.lock。\n`,
    )
    return EXIT.refused
  }
  let summary
  try {
    const ctx = makeContext(taiga, cfg)
    const result = await runMode(mode, ctx, taiga, cfg, opts)
    let markPending = null
    if (opts['mark-pending'] === true) markPending = resetFailedRows(cfg.db, person, Number(opts.index ?? 1))
    summary = { ok: true, dryRun: false, mode, person, ...result, ...(opts['mark-pending'] === true ? { markPending } : {}) }
    if (json) process.stdout.write(`${JSON.stringify(summary)}\n`)
    else process.stdout.write(`[hr-taiga-account] ${mode} ${person} → ${JSON.stringify(result)}${markPending !== null ? `；pending 重置 ${JSON.stringify(markPending)}` : ''}\n`)
    return EXIT.ok
  } catch (err) {
    process.stderr.write(`hr-taiga-account：${mode} 失败：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.error
  } finally {
    try {
      lease.release()
    } catch {
      /* 释放失败由死 pid 清理兜底 */
    }
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
  process.argv[1] !== undefined && realpathOrResolved(process.argv[1]) === realpathOrResolved(new URL(import.meta.url).pathname)
if (invokedDirectly) process.exit(await main(process.argv.slice(2)))
