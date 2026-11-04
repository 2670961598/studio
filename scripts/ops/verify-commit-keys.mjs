#!/usr/bin/env node
/**
 * verify-commit-keys —— 每人 key/作者校验（studio-dev-721；docs/90-§八）
 *
 * 三处同一脚本：
 *   1. 本地 commit-msg 钩子（install-git-hooks.mjs 安装）：
 *      node scripts/ops/verify-commit-keys.mjs --repo . --keys-dir <companyDir>/docs/keys --commit-msg .git/COMMIT_EDITMSG
 *   2. CI/PR（722 起）：
 *      node scripts/ops/verify-commit-keys.mjs --repo . --keys-dir <keys> --range origin/main..HEAD
 *   3. 人工抽查：同上 + --json
 *
 * 校验（fail-closed）：trailer `Studio-Worker`/`Studio-Key` 齐全；工号已登记；指纹=registry 实际指纹；
 * 作者邮箱=registry email 且作者名=工号/姓名；`--require-signature` 时要求 SSH/GPG 有效签名（%G?）。
 *
 * 退出码：0=全部通过；1=有 commit 不合法；2=用法/registry 读取错误。
 * 用法：--repo/--keys-dir 必填其一模式（--commit-msg 或 --range）；--json 机器面；--help。
 */
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { readAuthorIdent, readRegistry, verifyCommit, verifyCommits } from './worker-key-lib.mjs'

const USAGE = `用法：node scripts/ops/verify-commit-keys.mjs --repo <repo> --keys-dir <dir> --commit-msg <file> [--require-signature] [--json]
       node scripts/ops/verify-commit-keys.mjs --repo <repo> --keys-dir <dir> --range <base>..HEAD [--require-signature] [--json]

退出码：0=通过；1=校验失败（逐条列 code/detail）；2=用法/registry 错误。
校验面：docs/90-§八（trailer Studio-Worker/Studio-Key + 作者 + registry 指纹）。`

const EXIT = { ok: 0, fail: 1, usage: 2 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--require-signature' || token === '--json') {
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

async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`verify-commit-keys：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  const opts = args.opts
  if (args.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const repo = typeof opts.repo === 'string' && opts.repo !== '' ? path.resolve(opts.repo) : process.cwd()
  const keysDir = typeof opts['keys-dir'] === 'string' && opts['keys-dir'] !== '' ? opts['keys-dir'] : ''
  if (keysDir === '') {
    process.stderr.write(`verify-commit-keys：缺 --keys-dir <companyDir>/docs/keys\n\n${USAGE}`)
    return EXIT.usage
  }
  const requireSignature = opts['require-signature'] === true
  const json = opts.json === true
  try {
    // —— 模式 A：commit-msg 钩子（单条，作者取 env/git ident）——
    if (typeof opts['commit-msg'] === 'string' && opts['commit-msg'] !== '') {
      const message = await readFile(path.resolve(opts['commit-msg']), 'utf8')
      const ident = readAuthorIdent(repo)
      const registry = readRegistry(keysDir)
      const result = verifyCommit({ message, authorName: ident.name, authorEmail: ident.email, registry, requireSignature, signatureVerified: false })
      if (json) process.stdout.write(`${JSON.stringify({ mode: 'commit-msg', author: ident, ...result }, null, 2)}\n`)
      else if (result.ok) process.stdout.write(`[verify-commit-keys] OK ${result.worker ?? ''}（author=${ident.name} <${ident.email}>）\n`)
      else {
        process.stderr.write(`[verify-commit-keys] 拒提交：${result.issues.map((issue) => `${issue.code}: ${issue.detail}`).join('；')}\n`)
        process.stderr.write('  约定见 docs/90-§八：trailer Studio-Worker/Studio-Key + 作者邮箱=registry email。\n')
      }
      if (!result.ok) return EXIT.fail
      if (requireSignature && result.ok) {
        // commit-msg 钩子阶段尚未签名（签名在 commit 对象创建时）；此处仅提示，CI range 模式强制
        process.stderr.write('[verify-commit-keys] 提示：--require-signature 在 commit-msg 阶段无法验签，按 CI range 模式复核\n')
      }
      return EXIT.ok
    }
    // —— 模式 B：range 校验 ——
    const range = typeof opts.range === 'string' && opts.range !== '' ? opts.range : 'HEAD~1..HEAD'
    const result = verifyCommits(repo, range, { keysDir, requireSignature })
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else if (result.ok) {
      process.stdout.write(`[verify-commit-keys] OK ${String(result.total)} commit（range=${range}）\n`)
    } else {
      process.stderr.write(`[verify-commit-keys] FAIL ${String(result.failed)}/${String(result.total)} commit（range=${range}）\n`)
      for (const commit of result.commits.filter((item) => !item.ok)) {
        process.stderr.write(`  ${commit.sha.slice(0, 12)} ${commit.authorName} <${commit.authorEmail}>${commit.worker !== undefined ? ` worker=${commit.worker}` : ''}\n`)
        for (const issue of commit.issues) process.stderr.write(`    - ${issue.code}: ${issue.detail}\n`)
      }
    }
    return result.ok ? EXIT.ok : EXIT.fail
  } catch (err) {
    process.stderr.write(`verify-commit-keys：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.usage
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
  process.exit(await main(process.argv.slice(2)))
}
