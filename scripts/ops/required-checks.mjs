#!/usr/bin/env node
/**
 * required-checks —— 本地一键 required checks（studio-dev-722）
 *
 * 串：verify:v2（无 bun 时按 package.json 的 verify:v2 分解执行）＋verify:docs＋scan-repo-secrets
 *     ＋verify-commit-keys --range（范围=origin/dev...HEAD；keys 目录外部或仓库公钥投影）。
 * 失败即红（exit 1）且给可读摘要；全过 exit 0；用法错 exit 2。
 *
 * 用法：
 *   node scripts/ops/required-checks.mjs [--repo .] [--base origin/dev] [--keys-dir <dir>]
 *        [--only verify:v2,verify:docs] [--strict-keys] [--require-signature]
 *        [--dry-run] [--list] [--json] [--override <id>=<shell命令>]...
 *
 * 设计：
 *   - 只编排既有脚本，不复制其逻辑；每个 check 有 id/标题/命令；
 *   - keys 面：显式 --keys-dir > 环境 STUDIO_KEYS_DIR > <repo>/ops/keys/registry（公钥投影）；
 *     **务实模式默认=skip（不强制）**：未设 REQUIRE_COMMIT_KEYS=1 且未给 --require-signature/--strict-keys 时，
 *     verify-commit-keys 只报告不阻断（registry 在场仅表示可运行，不等于强制）；
 *     显式严格模式才 FAIL（--strict-keys/--require-signature/env REQUIRE_COMMIT_KEYS=1）；
 *   - `--override <id>=<cmd>` 仅供测试/排障注入（sh -c 执行）；默认命令全部 argv 直跑（无 shell）。
 *   - CI 里由 `.github/workflows/required-checks.yml` 调用（bun 存在→bun run verify:v2）。
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const USAGE = `用法：node scripts/ops/required-checks.mjs [选项]

选项：
  --repo <dir>             仓库根（缺省 cwd）
  --base <ref>             提交校验范围 base（缺省 origin/dev；range=<base>...HEAD）
  --range <range>          直接指定 git range（覆盖 --base）
  --keys-dir <dir>         keys registry（缺省 $STUDIO_KEYS_DIR 或 <repo>/ops/keys/registry）
  --only <ids>             只跑指定 check（逗号分隔；id 见 --list）
  --strict-keys            严格模式（keys/range/提交校验均按失败计；缺省=skip，仅报告不阻断）
  --require-signature      严格模式并要求 SSH/GPG 签名（未签名=失败；缺省不强制）
  --require-signature      提交校验要求 SSH/GPG 签名（团队 key 齐后开）
  --dry-run                只打印命令计划，不执行
  --list                   列出 check id/标题/命令
  --json                   输出 JSON 摘要（stdout 最后一行）
  --override <id>=<cmd>    测试/排障：用 sh -c 命令替换该 check 的执行
  --help                   本帮助

退出码：0=全过（含 skip）；1=有 fail；2=用法错误。`

const EXIT = { ok: 0, fail: 1, usage: 2 }

/** 工具自身所在仓库根（校验脚本用绝对路径——支持 --repo 指向其它仓库/临时夹具） */
const TOOL_REPO = path.resolve(import.meta.dirname, '..', '..')

export const CHECK_ORDER = ['verify:v2', 'verify:docs', 'scan-repo-secrets', 'verify-commit-keys']

const V2_FALLBACK_STEPS = [
  { label: 'guard:boundaries', argv: ['node', 'scripts/guards/boundaries.mjs'] },
  { label: 'margin:watch', argv: ['node', 'scripts/guards/margin-watch.mjs'] },
  { label: 'typecheck', argv: ['npx', 'tsc', '--noEmit'] },
  { label: 'typecheck:v2', argv: ['npx', 'tsc', '--noEmit', '-p', 'tsconfig.v2.json'] },
  { label: 'test:v2', argv: ['npx', 'vitest', 'run', '--config', 'vitest.v2.config.ts'] },
  { label: 'hr-gate-audit', argv: ['node', 'scripts/verify/hr-gate-audit.mjs'] },
  { label: 'v2-suite-manifest', argv: ['node', 'scripts/verify/v2-suite-manifest.mjs'] },
  { label: 'old-test-ledger', argv: ['node', 'scripts/verify/old-test-ledger.mjs'] },
]

function parseArgs(argv) {
  const opts = { overrides: {} }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--dry-run' || token === '--list' || token === '--json' || token === '--strict-keys' || token === '--require-signature') {
      const name = token.slice(2)
      // F2③：统一命名（解析面与 resolve 面同用 camelCase；env REQUIRE_COMMIT_KEYS 行为不变）
      opts[name === 'strict-keys' ? 'strictKeys' : name] = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    if (key === 'override') {
      const eq = value.indexOf('=')
      if (eq <= 0) throw new Error('--override 需 <id>=<cmd>')
      opts.overrides[value.slice(0, eq)] = value.slice(eq + 1)
    } else {
      opts[key] = value
    }
    i += 1
  }
  return { help: false, opts }
}

function hasCommand(name) {
  const result = spawnSync('sh', ['-c', `command -v ${name} >/dev/null 2>&1`], { stdio: 'ignore' })
  return result.status === 0
}

function stepResult(label, result) {
  const status = result.status === 0 ? 'pass' : 'fail'
  const tail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')
  return { label, status, exitCode: result.status, durationMs: result.durationMs ?? 0, ...(status === 'fail' ? { tail } : {}) }
}

/** 执行一个 argv 步骤；返回 {status, exitCode, durationMs, tail} */
function runStep(argv, options = {}) {
  const startedAt = Date.now()
  if (options.env?.REQUIRED_CHECKS_DRY_RUN === '1') return { label: options.label ?? argv.join(' '), status: 'dry-run', exitCode: 0, durationMs: 0 }
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30 * 60_000,
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return stepResult(options.label ?? argv.join(' '), { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', durationMs: Date.now() - startedAt })
}

/** 执行 override（sh -c；仅测试/排障面） */
function runOverride(id, command, options = {}) {
  const startedAt = Date.now()
  const result = spawnSync('sh', ['-c', command], { cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs ?? 30 * 60_000 })
  return stepResult(`override:${id}`, { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', durationMs: Date.now() - startedAt })
}

/** keys/range 可用性判定（纯函数，可测） */
export function resolveCommitKeyCheck({ repo, opts, env = process.env }) {
  const explicit = typeof opts['keys-dir'] === 'string' && opts['keys-dir'] !== '' ? path.resolve(opts['keys-dir']) : ''
  const fromEnv = typeof env.STUDIO_KEYS_DIR === 'string' && env.STUDIO_KEYS_DIR !== '' ? path.resolve(env.STUDIO_KEYS_DIR) : ''
  const projection = path.join(repo, 'ops', 'keys', 'registry')
  const keysDir = explicit !== '' ? explicit : fromEnv !== '' ? fromEnv : projection
  const strict = opts.strictKeys === true || opts['require-signature'] === true || env.REQUIRE_COMMIT_KEYS === '1'
  if (!existsSync(keysDir) || !readdirSync(keysDir).some((name) => name.endsWith('.pub'))) {
    return { ok: false, strict, reason: `keys registry 无公钥（${keysDir}；先 export-key-registry + 提交，或设 STUDIO_KEYS_DIR）`, keysDir }
  }
  let range = typeof opts.range === 'string' && opts.range !== '' ? opts.range : ''
  if (range === '') {
    const base = typeof opts.base === 'string' && opts.base !== '' ? opts.base : 'origin/dev'
    const probe = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', base], { encoding: 'utf8' })
    if (probe.status !== 0) return { ok: false, strict, reason: `git base 不可解析（${base}；CI 需 fetch-depth 0，或显式 --range）`, keysDir }
    range = `${base}...HEAD`
  }
  return { ok: true, keysDir, range, strict }
}

/** 构建执行计划（纯函数；返回 [{id,title,steps:[{label,argv}]}]） */
export function buildPlan({ repo, opts, bunAvailable = hasCommand('bun'), env = process.env }) {
  const plan = []
  const overrides = opts.overrides ?? {}
  const stepsOf = (id, steps) => (overrides[id] !== undefined ? [{ label: `override:${id}`, argv: null, override: overrides[id] }] : steps)
  if (overrides['verify:v2'] === undefined) {
    plan.push({
      id: 'verify:v2',
      title: 'V2 门禁（guard/margin/typecheck/typecheck:v2/test:v2/manifest/ledger）',
      steps: bunAvailable ? stepsOf('verify:v2', [{ label: 'bun run verify:v2', argv: ['bun', 'run', 'verify:v2'] }]) : stepsOf('verify:v2', V2_FALLBACK_STEPS),
    })
  } else plan.push({ id: 'verify:v2', title: 'V2 门禁', steps: stepsOf('verify:v2', []) })
  plan.push({ id: 'verify:docs', title: '文档门禁（v0-doc-check）', steps: stepsOf('verify:docs', [{ label: 'v0-doc-check', argv: ['node', 'scripts/verify/v0-doc-check.mjs'] }]) })
  plan.push({ id: 'scan-repo-secrets', title: '仓库秘密扫描（命中即红）', steps: stepsOf('scan-repo-secrets', [{ label: 'scan-repo-secrets', argv: ['node', 'scripts/scan-repo-secrets.mjs'] }]) })
  if (overrides['verify-commit-keys'] !== undefined) {
    plan.push({ id: 'verify-commit-keys', title: '提交作者/key 校验', steps: [{ label: 'override:verify-commit-keys', argv: null, override: overrides['verify-commit-keys'] }] })
  } else {
    // 务实模式默认：不强制提交校验（registry 在场≠强制）；显式严格模式才执行并 FAIL
    const enforce =
      opts.strictKeys === true || opts['require-signature'] === true || env.REQUIRE_COMMIT_KEYS === '1'
    if (!enforce) {
      plan.push({
        id: 'verify-commit-keys',
        title: '提交作者/key 校验（务实模式：默认不强制）',
        skipReason:
          '未设 REQUIRE_COMMIT_KEYS=1 且未给 --require-signature/--strict-keys：默认 SKIP 不阻断（registry 在场仅表示可运行；显式严格模式才 FAIL）',
        steps: [],
      })
    } else {
      const resolved = resolveCommitKeyCheck({ repo, opts, env })
      if (!resolved.ok) {
        plan.push({ id: 'verify-commit-keys', title: '提交作者/key 校验', skipReason: resolved.reason, steps: [] })
      } else {
        const argv = ['node', path.join(TOOL_REPO, 'scripts', 'ops', 'verify-commit-keys.mjs'), '--repo', repo, '--keys-dir', resolved.keysDir, '--range', resolved.range]
        if (opts['require-signature'] === true) argv.push('--require-signature')
        plan.push({ id: 'verify-commit-keys', title: '提交作者/key 校验', steps: [{ label: `verify-commit-keys ${resolved.range}`, argv }] })
      }
    }
  }
  const only = typeof opts.only === 'string' && opts.only !== '' ? new Set(opts.only.split(',').map((item) => item.trim()).filter(Boolean)) : null
  return only === null ? plan : plan.filter((check) => only.has(check.id))
}

function formatFailTail(step) {
  if (step.tail === undefined || step.tail === '') return ''
  return step.tail.split('\n').map((line) => `    ${line}`).join('\n')
}

function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`required-checks：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (parsed.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = parsed.opts
  const repo = path.resolve(typeof opts.repo === 'string' && opts.repo !== '' ? opts.repo : process.cwd())
  const plan = buildPlan({ repo, opts })
  if (opts.list === true) {
    if (opts.json === true) process.stdout.write(`${JSON.stringify({ ok: true, checks: plan.map(({ id, title, steps, skipReason }) => ({ id, title, skipReason: skipReason ?? null, steps: steps.map((step) => step.label) })) }, null, 2)}\n`)
    else for (const check of plan) process.stdout.write(`${check.id.padEnd(22)} ${check.title}${check.skipReason !== undefined ? `（skip: ${check.skipReason}）` : ''}\n`)
    return EXIT.ok
  }
  if (plan.length === 0) {
    process.stderr.write('required-checks：--only 未匹配任何 check\n')
    return EXIT.usage
  }
  if (opts['dry-run'] === true) {
    if (opts.json === true) process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, repo, plan: plan.map(({ id, steps, skipReason }) => ({ id, steps: steps.map((step) => step.override !== undefined ? `override:${step.override}` : step.argv.join(' ')), skipReason: skipReason ?? null })) }, null, 2)}\n`)
    else for (const check of plan) {
      process.stdout.write(`[dry-run] ${check.id}${check.skipReason !== undefined ? `（skip: ${check.skipReason}）` : ''}\n`)
      for (const step of check.steps) process.stdout.write(`  - ${step.override !== undefined ? `override: ${step.override}` : step.argv.join(' ')}\n`)
    }
    return EXIT.ok
  }
  const startedAt = Date.now()
  const results = []
  process.stdout.write(`[required-checks] repo=${repo} checks=${plan.map((check) => check.id).join(',')}\n`)
  for (const check of plan) {
    if (check.skipReason !== undefined) {
      const strict = opts.strictKeys === true || opts['require-signature'] === true || process.env.REQUIRE_COMMIT_KEYS === '1'
      const status = strict ? 'fail' : 'skip'
      results.push({ id: check.id, status, reason: check.skipReason, steps: [] })
      process.stdout.write(`[${status.toUpperCase()}] ${check.id}（${check.skipReason}）${strict ? ' ← strict 模式按失败计' : ''}\n`)
      continue
    }
    const stepResults = []
    let failed = false
    for (const step of check.steps) {
      process.stdout.write(`[RUN ] ${check.id} :: ${step.label}\n`)
      const result = step.override !== undefined ? runOverride(check.id, step.override, { cwd: repo }) : runStep(step.argv, { cwd: repo, label: step.label })
      stepResults.push(result)
      process.stdout.write(`[${result.status.toUpperCase()}] ${check.id} :: ${step.label}（${String(result.durationMs)}ms）\n`)
      if (result.status !== 'pass') {
        failed = true
        if (result.tail !== undefined && result.tail !== '') process.stdout.write(`${formatFailTail(result)}\n`)
        break
      }
    }
    results.push({ id: check.id, status: failed ? 'fail' : 'pass', steps: stepResults })
  }
  const failed = results.filter((result) => result.status === 'fail')
  const summary = {
    ok: failed.length === 0,
    repo,
    durationMs: Date.now() - startedAt,
    results: results.map((result) => ({ id: result.id, status: result.status, ...(result.reason !== undefined ? { reason: result.reason } : {}) })),
  }
  process.stdout.write(`\n[required-checks] ${summary.ok ? 'PASS' : 'FAIL'}（${String(results.length - failed.length)}/${String(results.length)}；${String(summary.durationMs)}ms）\n`)
  for (const result of failed) process.stdout.write(`  FAIL ${result.id}${result.steps.length > 0 ? ` @ ${result.steps[result.steps.length - 1]?.label ?? ''}` : ''}\n`)
  if (opts.json === true) process.stdout.write(`${JSON.stringify(summary)}\n`) // JSON 固定最后一行（机器面）
  return summary.ok ? EXIT.ok : EXIT.fail
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
