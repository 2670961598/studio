#!/usr/bin/env node
/**
 * worker-key-lib —— 每人 key / commit 校验纯面（studio-dev-721）
 *
 * 依据：docs/90-§八（每人 key 与提交签名纪律）；制作人令「每个人有自己的 key，提交时验证
 * key 和作者，commit log 加工号和 key 指纹，验证通过才允许提交」。
 *
 * 铁律：只 node 标准库；不 import daemon/契约/公司目录业务包；不写业务数据。
 * 密钥文件位于公司目录 `docs/keys/`（company git 仓之外，永不入仓）；本模块只读 registry/pub。
 *
 * 校验口径（fail-closed）：
 *   - commit message 末尾 git trailers：`Studio-Worker: <工号>` + `Studio-Key: SHA256:<指纹>`；
 *   - 工号必须已登记（registry：`<工号>.json` 或 `<工号>.pub`）；
 *   - Studio-Key 指纹必须等于 registry 中登记公钥的真实指纹（ssh-keygen -lf -E sha256）；
 *   - 作者邮箱必须等于 registry 登记的 email（作者名可为工号或姓名）；
 *   - `--require-signature` 时要求 `%G?` 为 G/U（SSH/GPG 有效签名）。
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** 工号白名单（verifier F2：防 ../escape/路径分隔/盘符；最大 64 字符） */
const WORKER_ID_RE = /^[A-Za-z0-9._-]+$/

/**
 * 校验工号（路径安全第一道闸）：只允许 `[A-Za-z0-9._-]`；拒空/`.`/`..`/超长/路径分隔/盘符。
 * 返回规范化工号；非法抛错（fail-fast，调用方不得拼接未校验工号进路径）。
 */
export function validateWorkerId(raw) {
  const id = String(raw ?? '')
  if (id === '') throw new Error('工号不能为空')
  if (id.length > 64) throw new Error(`工号过长（>64）：${id.length}`)
  if (!WORKER_ID_RE.test(id)) throw new Error(`工号非法（只允许 A-Za-z0-9._-，禁路径分隔/盘符/空白）：${JSON.stringify(id)}`)
  if (id === '.' || id === '..') throw new Error(`工号非法（不得为 ${JSON.stringify(id)}）`)
  if (id.includes('/') || id.includes('\\') || id.includes(':')) throw new Error(`工号非法（禁路径分隔/盘符）：${JSON.stringify(id)}`)
  return id
}

/** 探测目录所在 git 工作树根（非 repo=null） */
function gitToplevelOf(dir, run = defaultRun) {
  try {
    const out = run('git', ['-C', dir, 'rev-parse', '--show-toplevel'])
    const text = (typeof out === 'string' ? out : String(out?.stdout ?? '')).trim()
    return text === '' ? null : text
  } catch {
    return null
  }
}

/**
 * keys 目录归属校验（verifier F2）：必须存在/可建且可写；**默认拒绝位于任何 git 工作树内**
 * （防私钥入仓；与「docs/keys 在 company git 仓之外」一致）。确需例外=显式 allowOutside。
 * 返回绝对路径。
 */
export function assertKeysDirSafe(rawDir, options = {}) {
  if (typeof rawDir !== 'string' || rawDir === '') throw new Error('keys 目录不能为空')
  const dir = path.resolve(rawDir)
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error(`keys 路径不是目录：${dir}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  accessSync(dir, constants.W_OK)
  if (options.allowOutside !== true) {
    const top = gitToplevelOf(dir, options.run)
    if (top !== null) throw new Error(`keys 目录位于 git 工作树内（${top}）——私钥禁止入仓；确需例外请显式 --allow-outside`)
  }
  return dir
}

/** registry 元数据 schema（<工号>.json） */
export const KEY_SCHEMA = 'studio-next/worker-key/v1'

/** commit trailer 名（docs/90-§8.2） */
export const TRAILER_WORKER = 'Studio-Worker'
export const TRAILER_KEY = 'Studio-Key'

/** 缺省作者邮箱（person.login + 域名） */
export function defaultEmailFor(id) {
  return `${id.toLowerCase()}@studio-next.local`
}

/** 指纹归一化：接受裸指纹/带 SHA256: 前缀；非法=null */
export function normalizeFingerprint(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^SHA256:/i, '').replace(/=+$/, '')
  if (trimmed === '' || !/^[A-Za-z0-9+/]+$/.test(trimmed) || trimmed.length < 20) return null
  return `SHA256:${trimmed}`
}

/** ssh-keygen 计算公钥指纹（默认实现；可注入） */
export function sshKeygenFingerprint(pubPath, run = defaultRun) {
  const out = run('ssh-keygen', ['-l', '-E', 'sha256', '-f', pubPath])
  const text = typeof out === 'string' ? out : String(out?.stdout ?? '')
  const match = /^\d+\s+(SHA256:\S+)/.exec(text)
  if (match === null) throw new Error(`ssh-keygen 未返回指纹（${pubPath}）：${String(out.stdout ?? out.stderr ?? '')}`)
  return normalizeFingerprint(match[1]) ?? match[1]
}

function defaultRun(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`registry 文件解析失败（${file}）：${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 读 keys 目录 registry（fail-closed：坏 JSON/缺字段/公钥与指纹不一致→抛）。
 * 优先 `<工号>.json`；无 json 时以 `<工号>.pub` 兜底（id=文件名，email=缺省）。
 * @returns Map<工号, {id,name,email,fingerprint,pubFile,source}>
 */
export function readRegistry(keysDir, options = {}) {
  const run = options.run ?? defaultRun
  const dir = path.resolve(keysDir)
  if (!existsSync(dir)) throw new Error(`keys 目录不存在：${dir}`)
  const files = readdirSync(dir)
  const jsonIds = files.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5))
  const pubIds = files.filter((name) => name.endsWith('.pub')).map((name) => name.slice(0, -4))
  const ids = new Set([...jsonIds, ...pubIds])
  const registry = new Map()
  for (const id of [...ids].sort()) {
    const pubFile = path.join(dir, `${id}.pub`)
    if (!existsSync(pubFile)) throw new Error(`registry 有 ${id}.json 但缺公钥 ${id}.pub（fail-closed）`)
    const actual = sshKeygenFingerprint(pubFile, run)
    const jsonFile = path.join(dir, `${id}.json`)
    if (jsonIds.includes(id)) {
      const meta = readJson(jsonFile)
      if (meta.schema !== undefined && meta.schema !== KEY_SCHEMA) throw new Error(`${id}.json schema 非法：${String(meta.schema)}`)
      if (typeof meta.id !== 'string' || meta.id !== id) throw new Error(`${id}.json 的 id 字段须等于文件名（实际 ${String(meta.id)}）`)
      if (typeof meta.email !== 'string' || !meta.email.includes('@')) throw new Error(`${id}.json 缺合法 email`)
      const declared = normalizeFingerprint(meta.fingerprint)
      if (declared === null) throw new Error(`${id}.json 缺合法 fingerprint`)
      if (declared !== actual) throw new Error(`${id}.json 指纹与 ${id}.pub 实际不符（${declared} ≠ ${actual}）`)
      registry.set(id, { id, name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : id, email: meta.email, fingerprint: actual, pubFile, source: 'json' })
    } else {
      registry.set(id, { id, name: id, email: defaultEmailFor(id), fingerprint: actual, pubFile, source: 'pub' })
    }
  }
  if (registry.size === 0) throw new Error(`keys 目录无任何 <工号>.pub/${'<工号>'}.json：${dir}`)
  return registry
}

/** 解析 commit message 末尾 trailers（同名取最后一条；返回去重表） */
export function parseTrailers(message) {
  const result = {}
  const lines = String(message ?? '').split('\n')
  for (const line of lines) {
    const match = /^(Studio-Worker|Studio-Key):\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    const name = match[1]
    const value = match[2].replace(/^["']|["']$/g, '').trim()
    result[name === TRAILER_WORKER ? 'worker' : 'key'] = value
  }
  return result
}

/** 作者名匹配：工号或姓名均可（作者邮箱必须严格匹配） */
function authorNameMatches(entry, authorName) {
  const name = String(authorName ?? '').trim()
  return name === entry.id || name === entry.name
}

/**
 * 校验单条 commit（纯函数）。
 * @returns {{ok: boolean, worker?: string, issues: Array<{code: string, detail: string}>}}
 */
export function verifyCommit({ message, authorName, authorEmail, registry, requireSignature = false, signatureVerified = false }) {
  const issues = []
  const trailers = parseTrailers(message)
  const worker = trailers.worker
  const keyTrailer = trailers.key
  if (worker === undefined || worker === '') issues.push({ code: 'worker-missing', detail: `缺 trailer ${TRAILER_WORKER}` })
  if (keyTrailer === undefined || keyTrailer === '') issues.push({ code: 'key-missing', detail: `缺 trailer ${TRAILER_KEY}` })
  const entry = worker !== undefined ? registry.get(worker) : undefined
  if (worker !== undefined && entry === undefined) issues.push({ code: 'worker-unregistered', detail: `工号 ${worker} 未在 keys registry 登记（先 gen-worker-key.mjs）` })
  if (entry !== undefined) {
    const declared = normalizeFingerprint(keyTrailer)
    if (declared === null) issues.push({ code: 'key-mismatch', detail: `${TRAILER_KEY} 形状非法：${String(keyTrailer)}` })
    else if (declared !== entry.fingerprint) issues.push({ code: 'key-mismatch', detail: `指纹不匹配：commit=${declared} registry=${entry.fingerprint}` })
    const email = String(authorEmail ?? '').trim().toLowerCase()
    if (email !== entry.email.toLowerCase()) issues.push({ code: 'author-mismatch', detail: `作者邮箱 ${String(authorEmail)} ≠ registry ${entry.email}` })
    if (!authorNameMatches(entry, authorName)) issues.push({ code: 'author-mismatch', detail: `作者名 ${String(authorName)} ≠ 工号/姓名（${entry.id}/${entry.name}）` })
  }
  if (requireSignature && signatureVerified !== true) issues.push({ code: 'signature-missing', detail: '要求 SSH/GPG 签名（%G? 非 G/U 或未启用签名）' })
  return { ok: issues.length === 0, ...(worker !== undefined ? { worker } : {}), issues }
}

/** 解析 author ident（`Name <email> timestamp tz`） */
export function parseAuthorIdent(ident) {
  const match = /^(.*?)\s+<([^>]*)>/.exec(String(ident ?? '').trim())
  if (match === null) return { name: '', email: '' }
  return { name: match[1].trim(), email: match[2].trim() }
}

/** git log 记录分隔（不可见字符；避免 commit message 干扰） */
const FIELD = '\u001f'
const RECORD = '\u001e'

/**
 * 读 range 内 commits（含签名状态 %G?）。
 * @returns Array<{sha, authorName, authorEmail, signatureStatus, message}>
 */
export function readCommits(repo, range, options = {}) {
  const run = options.run ?? defaultRun
  const format = ['%H', '%an', '%ae', '%G?', '%B'].join('%x1f') + '%x1e'
  const out = run('git', ['-C', repo, 'log', `--format=${format}`, range])
  const text = String(out.stdout ?? out)
  return text
    .split(RECORD)
    .map((record) => record.replace(/^\s+/, ''))
    .filter((record) => record !== '')
    .map((record) => {
      const parts = record.split(FIELD)
      return {
        sha: parts[0] ?? '',
        authorName: parts[1] ?? '',
        authorEmail: parts[2] ?? '',
        signatureStatus: parts[3] ?? '',
        message: parts.slice(4).join(FIELD),
      }
    })
}

/** range 校验（逐 commit；registry 读失败=调用方错误） */
export function verifyCommits(repo, range, options = {}) {
  const registry = readRegistry(options.keysDir, options)
  const requireSignature = options.requireSignature === true
  const commits = readCommits(repo, range, options).map((commit) => {
    const result = verifyCommit({
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      registry,
      requireSignature,
      signatureVerified: commit.signatureStatus === 'G' || commit.signatureStatus === 'U',
    })
    return { sha: commit.sha, authorName: commit.authorName, authorEmail: commit.authorEmail, signatureStatus: commit.signatureStatus, ...result }
  })
  const failed = commits.filter((commit) => !commit.ok)
  return { ok: failed.length === 0, range, total: commits.length, failed: failed.length, commits }
}

/** 校验单条消息（commit-msg 钩子面）：作者 ident 由调用方给（缺省由脚本取 git var GIT_AUTHOR_IDENT） */
export function verifyMessage({ message, authorName, authorEmail, keysDir, requireSignature = false, run }) {
  const registry = readRegistry(keysDir, { ...(run !== undefined ? { run } : {}) })
  return verifyCommit({ message, authorName, authorEmail, registry, requireSignature })
}

export function readAuthorIdent(repo, run = defaultRun) {
  const out = run('git', ['-C', repo, 'var', 'GIT_AUTHOR_IDENT'])
  return parseAuthorIdent(String(out.stdout ?? out))
}
