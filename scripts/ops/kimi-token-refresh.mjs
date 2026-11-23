#!/usr/bin/env node
/**
 * kimi-token-refresh.mjs —— Kimi（kimi-coding 订阅）access token 刷新器（docs/quality/kimi-on-dsh.md §3）
 *
 * 依据（实现单引用）：docs/quality/kimi-on-dsh.md §0/§3（凭据链与刷新器契约）；docs/31-§3.5
 *   （OAuth 15 分钟过期的运维事实——本脚本即其「正式方案」的刷新腿）；pi-ai
 *   `auth/oauth/kimi-coding.js`（刷新协议参照：form 表单 grant_type=refresh_token、
 *   响应必含 access_token/refresh_token/expires_in、refresh_token 服务器侧轮换）。
 *
 * 链路：`~/.kimi-code/credentials/kimi-code.json` 的 refresh_token → 直连
 *   `<oauthHost>/api/oauth/token`（**不调用 kimi CLI**）→ access token 原子写
 *   `~/Library/Application Support/StudioNext/secrets/kimi-access-token`（0600，内容仅 token）
 *   ＋新 refresh_token **轮换回写** kimi-code.json（保序其余字段，否则下次刷新与 kimi CLI 双断）。
 *
 * 纪律（docs/v2/15 §4.5 三不入）：token 值永不打印（stdout/stderr 只出现路径/状态码/expires_in/
 *   错误分类）；仓面扫描（scan-repo-secrets）不豁免本件——不得出现真实凭据/主机绝对路径。
 *
 * 用法：
 *   node scripts/ops/kimi-token-refresh.mjs --once                 # 刷新一次并落盘
 *   node scripts/ops/kimi-token-refresh.mjs --once --dry-run       # 预检：不发请求、不写文件
 *   旗标：--credentials <file> / --out <file> / --oauth-host <url> / --timeout-ms <n> / --help
 *   env 覆盖（旗标优先）：KIMI_CREDENTIALS_FILE / STUDIO_KIMI_TOKEN_FILE /
 *         KIMI_CODE_OAUTH_HOST / KIMI_OAUTH_HOST；测试旋钮：KIMI_REFRESH_BACKOFF_BASE_MS /
 *         KIMI_REFRESH_MAX_ATTEMPTS（daemon 按需刷新面用它收短重试）
 *
 * 退出码：0=成功（dry-run=预检通过）；1=失败（凭据死/坏响应/网络不可达——重试退避后仍败）；
 *   2=用法错。失败时两个落盘文件都不动（旧值保命）。
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

/** pi-ai kimi-coding 公开 OAuth client id（随发行包分发的客户端标识，非凭据）。 */
const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const DEFAULT_CREDENTIALS_FILE = () => join(homedir(), '.kimi-code', 'credentials', 'kimi-code.json')
const DEFAULT_TOKEN_FILE = () => join(homedir(), 'Library', 'Application Support', 'StudioNext', 'secrets', 'kimi-access-token')
const DEFAULT_OAUTH_HOST = 'https://auth.kimi.com'
const TOKEN_PATH = '/api/oauth/token'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_BASE_MS = 1_000

const usage = `用法：node scripts/ops/kimi-token-refresh.mjs --once [--dry-run] [选项]
  --once              刷新一次并落盘（token 文件＋credentials 轮换回写）
  --dry-run           预检：校验参数与凭据库（可读/含 refresh_token），不发请求、不写文件
                      （刷新请求会在服务器侧轮换 refresh_token——真机试网直接跑 --once，原子且失败不动盘）
  --credentials <f>   凭据库路径（env KIMI_CREDENTIALS_FILE；缺省 ~/.kimi-code/credentials/kimi-code.json）
  --out <f>           token 文件路径（env STUDIO_KIMI_TOKEN_FILE；缺省 ~/Library/Application Support/StudioNext/secrets/kimi-access-token）
  --oauth-host <url>  OAuth host（env KIMI_CODE_OAUTH_HOST/KIMI_OAUTH_HOST；缺省 ${DEFAULT_OAUTH_HOST}）
  --timeout-ms <n>    单次 HTTP 请求超时（缺省 ${String(DEFAULT_TIMEOUT_MS)}）
  --help              本说明
退出码：0 成功；1 失败（文件不动）；2 用法错。token 值永不打印。`

function parseArgs(argv) {
  const flags = { once: false, dryRun: false, help: false, credentials: undefined, out: undefined, oauthHost: undefined, timeoutMs: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--once') flags.once = true
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--help' || a === '-h') flags.help = true
    else if (a === '--credentials' || a === '--out' || a === '--oauth-host' || a === '--timeout-ms') {
      const v = argv[i + 1]
      if (v === undefined || v === '') return { ok: false, error: `旗标 ${a} 需要一个值` }
      if (a === '--credentials') flags.credentials = v
      else if (a === '--out') flags.out = v
      else if (a === '--oauth-host') flags.oauthHost = v
      else flags.timeoutMs = Number(v)
      i += 1
    } else return { ok: false, error: `未知参数：${a}` }
  }
  if (flags.timeoutMs !== undefined && (!Number.isFinite(flags.timeoutMs) || flags.timeoutMs <= 0)) return { ok: false, error: '--timeout-ms 需为正数' }
  return { ok: true, flags }
}

function intEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** 原子写（docs/quality/kimi-on-dsh.md §3）：同目录隐藏 tmp（0600）→ chmod → rename；无中间可见半文件。 */
function atomicWrite(file, data, mode) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.${basename(file)}.tmp-${String(process.pid)}-${randomUUID().slice(0, 8)}`)
  try {
    writeFileSync(tmp, data, { mode })
    chmodSync(tmp, mode)
    renameSync(tmp, file)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* 尽力清理残留 tmp；原错优先上抛 */ }
    throw err
  }
}

/** 响应形状校验（pi-ai parseTokenResponse 同口径；拒绝含空白 token——落盘面是单行文件）。 */
function parseTokenResponse(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: '响应非 JSON 对象' }
  const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = body
  if (typeof access !== 'string' || access.length === 0) return { ok: false, reason: 'token 响应缺 access_token（坏响应）' }
  if (/\s/.test(access)) return { ok: false, reason: 'access_token 含空白（坏响应）' }
  if (typeof refresh !== 'string' || refresh.length === 0) return { ok: false, reason: 'token 响应缺 refresh_token（坏响应）' }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return { ok: false, reason: 'token 响应 expires_in 非正数（坏响应）' }
  return { ok: true, access, refresh, expiresIn }
}

/**
 * 单次刷新请求。分类（不回显响应体——防 token 字面意外落日志）：
 *   ok / dead（401/403/invalid_grant——凭据死，不重试）/ retry（429/5xx/网络）/ bad（其余 4xx、2xx 坏形状）。
 */
async function requestRefresh(oauthHost, refreshToken, timeoutMs) {
  const url = `${oauthHost.replace(/\/+$/, '')}${TOKEN_PATH}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.name : String(err)
    return { kind: 'retry', reason: `token 端点请求失败（${reason}）` }
  }
  let body = undefined
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  const errCode = body !== null && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string' ? body.error : ''
  if (res.status === 401 || res.status === 403 || errCode === 'invalid_grant') {
    return { kind: 'dead', reason: `refresh token 已失效（HTTP ${String(res.status)}${errCode !== '' ? `/${errCode}` : ''}）——需人工重新登录 kimi CLI（kimi login）` }
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'retry', reason: `token 端点暂不可用（HTTP ${String(res.status)}）` }
  if (res.status < 200 || res.status >= 300) return { kind: 'bad', reason: `token 端点意外状态（HTTP ${String(res.status)}）` }
  const parsed = parseTokenResponse(body)
  if (!parsed.ok) return { kind: 'bad', reason: parsed.reason }
  return { kind: 'ok', access: parsed.access, refresh: parsed.refresh, expiresIn: parsed.expiresIn }
}

function modeOf(file, fallback) {
  try {
    return statSync(file).mode & 0o777
  } catch {
    return fallback
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    process.stderr.write(`用法错：${parsed.error}\n${usage}\n`)
    return 2
  }
  const { flags } = parsed
  if (flags.help || !flags.once) {
    process.stdout.write(`${usage}\n`)
    return flags.help ? 0 : 2
  }
  const credentialsFile = flags.credentials ?? process.env.KIMI_CREDENTIALS_FILE ?? DEFAULT_CREDENTIALS_FILE()
  const tokenFile = flags.out ?? process.env.STUDIO_KIMI_TOKEN_FILE ?? DEFAULT_TOKEN_FILE()
  const oauthHost = flags.oauthHost ?? process.env.KIMI_CODE_OAUTH_HOST ?? process.env.KIMI_OAUTH_HOST ?? DEFAULT_OAUTH_HOST
  const timeoutMs = flags.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = Math.max(1, intEnv('KIMI_REFRESH_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS))
  const backoffBaseMs = intEnv('KIMI_REFRESH_BACKOFF_BASE_MS', DEFAULT_BACKOFF_BASE_MS)

  let credText
  try {
    credText = readFileSync(credentialsFile, 'utf8')
  } catch {
    process.stderr.write(`失败：凭据库不可读（${credentialsFile}）——先完成 kimi CLI 登录生成该文件\n`)
    return 1
  }
  let cred
  try {
    cred = JSON.parse(credText)
  } catch {
    process.stderr.write(`失败：凭据库非 JSON（${credentialsFile}）——不落任何盘\n`)
    return 1
  }
  const refreshToken = cred !== null && typeof cred === 'object' && typeof cred.refresh_token === 'string' ? cred.refresh_token : ''
  if (refreshToken === '' || /\s/.test(refreshToken)) {
    process.stderr.write(`失败：凭据库缺可用 refresh_token（${credentialsFile}）——需人工重新登录 kimi CLI\n`)
    return 1
  }

  // dry-run=预检（零副作用）：不发请求——每次刷新请求都会在服务器侧轮换 refresh_token，
  // 丢弃响应=存档 refresh_token 作废（kimi CLI 与本刷新器双断）。真机验证直接跑 --once。
  if (flags.dryRun) {
    process.stdout.write(`ok（dry-run 预检）：参数与凭据库校验通过；未发请求、未写文件。计划：POST ${oauthHost.replace(/\/+$/, '')}${TOKEN_PATH} → token 文件 ${tokenFile}（0600）＋credentials 轮换回写 ${credentialsFile}\n`)
    return 0
  }

  let lastReason = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await requestRefresh(oauthHost, refreshToken, timeoutMs)
    if (outcome.kind === 'ok') {
      const expiresAtSec = Math.floor((Date.now() + outcome.expiresIn * 1000) / 1000) // epoch 秒——与 kimi-code.json 现形状一致
      // 先回写轮换的 refresh_token（丢它=凭据链断），再写 token 文件
      const nextCred = { ...cred, access_token: outcome.access, refresh_token: outcome.refresh, expires_at: expiresAtSec, expires_in: outcome.expiresIn }
      atomicWrite(credentialsFile, `${JSON.stringify(nextCred, null, 2)}\n`, modeOf(credentialsFile, 0o600))
      atomicWrite(tokenFile, `${outcome.access}\n`, 0o600)
      process.stdout.write(`ok：token 文件已写（0600，内容仅 token）→ ${tokenFile}；expires_in=${String(outcome.expiresIn)}s；credentials 已轮换回写 → ${credentialsFile}\n`)
      return 0
    }
    lastReason = outcome.reason
    if (outcome.kind !== 'retry') {
      process.stderr.write(`失败：${outcome.reason}\n`)
      return 1
    }
    if (attempt < maxAttempts) await sleep(backoffBaseMs * 2 ** (attempt - 1))
  }
  process.stderr.write(`失败：${lastReason}——重试 ${String(maxAttempts)} 次后仍败；文件未动\n`)
  return 1
}

const code = await main()
process.exit(code)
