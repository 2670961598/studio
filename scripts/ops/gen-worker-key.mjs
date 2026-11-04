#!/usr/bin/env node
/**
 * gen-worker-key —— 每岗 ed25519 key 生成/登记（studio-dev-721）
 *
 * 用法：
 *   node scripts/ops/gen-worker-key.mjs --keys-dir <companyDir>/docs/keys --id REL-1 --name 发布 [--email rel-1@studio-next.local] [--force] [--json]
 *   node scripts/ops/gen-worker-key.mjs --keys-dir <keys> --batch <people.json>   # [{id,name,email?},...]
 *
 * 产物（docs/keys/ 在公司 git 仓之外，永不入仓）：
 *   <工号>.key（私钥，600）｜<工号>.pub（公钥，644，comment=<工号>@studio-next）｜<工号>.json（元数据，644，不含私钥）
 *
 * 纪律：已存在同名 key 默认拒（--force 才轮换，旧指纹请从 registry 移除/登记轮换记录）；
 * 私钥绝不打印、绝不入 git/日志/REPORT。
 */
import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { KEY_SCHEMA, assertKeysDirSafe, defaultEmailFor, sshKeygenFingerprint, validateWorkerId } from './worker-key-lib.mjs'

const USAGE = `用法：node scripts/ops/gen-worker-key.mjs --keys-dir <dir> --id <工号> [--name <姓名>] [--email <邮箱>] [--force] [--json]
       node scripts/ops/gen-worker-key.mjs --keys-dir <dir> --batch <people.json> [--force] [--json]

产物：<工号>.key(600) / <工号>.pub(644) / <工号>.json（元数据）。私钥只留本机，永不入 git。`

const EXIT = { ok: 0, usage: 1, exists: 2 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--force' || token === '--json' || token === '--allow-outside') {
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

function generateOne({ keysDir, id, name, email, force }) {
  if (path.dirname(path.join(keysDir, `${id}.key`)) !== keysDir) throw new Error(`工号解析路径逃逸（拒绝）：${id}`)
  const privateKey = path.join(keysDir, `${id}.key`)
  const publicKey = path.join(keysDir, `${id}.pub`)
  const metaFile = path.join(keysDir, `${id}.json`)
  if (!force && (existsSync(privateKey) || existsSync(publicKey) || existsSync(metaFile))) {
    throw Object.assign(new Error(`工号 ${id} 的 key 已存在（${path.basename(privateKey)}/${path.basename(publicKey)}）；轮换请显式 --force`), { code: EXIT.exists })
  }
  if (force) {
    for (const file of [privateKey, publicKey, metaFile]) rmSync(file, { force: true })
  }
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${id}@studio-next`, '-f', privateKey], { stdio: 'pipe' })
  // ssh-keygen 把公钥写成 `<私钥路径>.pub`（即 <工号>.key.pub）——按托管约定改名为 <工号>.pub
  renameSync(`${privateKey}.pub`, publicKey)
  chmodSync(privateKey, 0o600)
  chmodSync(publicKey, 0o644)
  const fingerprint = sshKeygenFingerprint(publicKey)
  const meta = {
    schema: KEY_SCHEMA,
    id,
    name,
    email,
    algorithm: 'ed25519',
    comment: `${id}@studio-next`,
    fingerprint,
    createdAt: new Date().toISOString(),
    pubFile: path.basename(publicKey),
    keyFile: path.basename(privateKey),
  }
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return { id, name, email, fingerprint, keyFile: privateKey, pubFile: publicKey, metaFile }
}

function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`gen-worker-key：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (args.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = args.opts
  if (typeof opts['keys-dir'] !== 'string' || opts['keys-dir'] === '') {
    process.stderr.write(`gen-worker-key：缺 --keys-dir（公司目录 docs/keys）\n\n${USAGE}`)
    return EXIT.usage
  }
  let keysDir
  try {
    keysDir = assertKeysDirSafe(opts['keys-dir'], { allowOutside: opts['allow-outside'] === true })
    chmodSync(keysDir, 0o700)
  } catch (err) {
    process.stderr.write(`gen-worker-key：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.usage
  }
  let people
  try {
    if (typeof opts.batch === 'string') {
      const raw = JSON.parse(execFileSync('cat', [opts.batch], { encoding: 'utf8' }))
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('--batch 需非空 JSON 数组 [{id,name,email?}]')
      people = raw.map((item) => {
        const id = validateWorkerId(item.id)
        return { id, name: String(item.name ?? id), email: String(item.email ?? defaultEmailFor(id)) }
      })
    } else {
      if (typeof opts.id !== 'string' || opts.id === '') throw new Error('缺 --id <工号>（或 --batch）')
      const id = validateWorkerId(opts.id)
      people = [{ id, name: typeof opts.name === 'string' && opts.name !== '' ? opts.name : id, email: typeof opts.email === 'string' && opts.email !== '' ? opts.email : defaultEmailFor(id) }]
    }
    const results = []
    for (const person of people) results.push(generateOne({ keysDir, ...person, force: opts.force === true }))
    if (opts.json === true) {
      process.stdout.write(`${JSON.stringify({ ok: true, keysDir, generated: results.map((r) => ({ id: r.id, fingerprint: r.fingerprint, pubFile: r.pubFile })) }, null, 2)}\n`)
    } else {
      for (const r of results) {
        process.stdout.write(`[gen-worker-key] ${r.id} → ${r.pubFile}\n  fingerprint=${r.fingerprint}\n  git config：user.name=${r.id} user.email=${r.email}\n`)
      }
      process.stdout.write('[gen-worker-key] 完成；私钥 600 只留本机，永不入 git/日志/REPORT。\n')
    }
    return EXIT.ok
  } catch (err) {
    const code = typeof err?.code === 'number' ? err.code : EXIT.usage
    process.stderr.write(`gen-worker-key：${err instanceof Error ? err.message : String(err)}\n`)
    return code
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
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
