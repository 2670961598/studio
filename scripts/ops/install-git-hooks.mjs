#!/usr/bin/env node
/**
 * install-git-hooks —— 本地 commit-msg 钩子安装（studio-dev-721；docs/90-§八）
 *
 * 用法：
 *   node scripts/ops/install-git-hooks.mjs --repo <repo> --keys-dir <companyDir>/docs/keys [--node <node路径>] [--json]
 *   node scripts/ops/install-git-hooks.mjs --repo <repo> --remove
 *
 * 行为：写 <repo>/.git/hooks/commit-msg（可执行），内容=调用 verify-commit-keys.mjs --commit-msg "$1"；
 * 已有非本工具钩子先备份为 commit-msg.bak-<ts>；--remove 仅删除带本工具标记的钩子（不误删他人钩子）。
 * 副作用仅 .git/hooks（不入 git、不写业务面）。
 */
import { chmodSync, existsSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const USAGE = `用法：node scripts/ops/install-git-hooks.mjs --repo <repo> --keys-dir <companyDir>/docs/keys [--node <node>] [--json]
       node scripts/ops/install-git-hooks.mjs --repo <repo> --remove`

const MARKER = '# studio-next-721 commit-msg hook（verify-commit-keys；docs/90-§八）'

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--remove' || token === '--json') {
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

function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`install-git-hooks：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return 1
  }
  if (args.help === true) {
    process.stdout.write(USAGE)
    return 0
  }
  const opts = args.opts
  const repo = typeof opts.repo === 'string' && opts.repo !== '' ? path.resolve(opts.repo) : process.cwd()
  const hooksDir = path.join(repo, '.git', 'hooks')
  const hookFile = path.join(hooksDir, 'commit-msg')
  if (!existsSync(path.join(repo, '.git'))) {
    process.stderr.write(`install-git-hooks：不是 git 仓库（${repo}）\n`)
    return 1
  }
  if (opts.remove === true) {
    if (existsSync(hookFile) && readFileSync(hookFile, 'utf8').includes(MARKER)) {
      rmSync(hookFile)
      process.stdout.write(`[install-git-hooks] 已移除 ${hookFile}\n`)
    } else {
      process.stdout.write('[install-git-hooks] 未发现本工具安装的 commit-msg 钩子（未改动）\n')
    }
    return 0
  }
  const keysDir = typeof opts['keys-dir'] === 'string' && opts['keys-dir'] !== '' ? path.resolve(opts['keys-dir']) : ''
  if (keysDir === '') {
    process.stderr.write(`install-git-hooks：缺 --keys-dir <companyDir>/docs/keys\n\n${USAGE}`)
    return 1
  }
  const nodeBin = typeof opts.node === 'string' && opts.node !== '' ? opts.node : process.execPath
  const verifier = path.join(repo, 'scripts', 'ops', 'verify-commit-keys.mjs')
  if (!existsSync(verifier)) {
    process.stderr.write(`install-git-hooks：找不到 ${verifier}（--repo 应为框架主仓；钩子调仓库内脚本）\n`)
    return 1
  }
  if (existsSync(hookFile)) {
    const existing = readFileSync(hookFile, 'utf8')
    if (!existing.includes(MARKER)) {
      const backup = `${hookFile}.bak-${Date.now()}`
      copyFileSync(hookFile, backup)
      process.stdout.write(`[install-git-hooks] 既有 commit-msg 已备份：${backup}\n`)
    }
  }
  const script = `#!/bin/sh
${MARKER}
# 说明：仅校验 commit message 的 trailer/作者/registry 指纹；范围校验见 CI（722）。
exec "${nodeBin}" "${verifier}" --repo "${repo}" --keys-dir "${keysDir}" --commit-msg "$1"
`
  writeFileSync(hookFile, script, 'utf8')
  chmodSync(hookFile, 0o755)
  if (opts.json === true) process.stdout.write(`${JSON.stringify({ ok: true, repo, hookFile, keysDir, node: nodeBin }, null, 2)}\n`)
  else process.stdout.write(`[install-git-hooks] 已安装 ${hookFile}\n  keys=${keysDir}\n  校验器=${verifier}\n`)
  return 0
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
