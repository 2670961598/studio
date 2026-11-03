#!/usr/bin/env node
/**
 * run-pb246.mjs —— PB-2 / PB-4 / PB-6 真机探针采集器（可重复执行，产物落盘归档）
 *
 * 依据：docs/v2/12 §5.1/§5.3（PRB- 唯一主表）、docs/v2/17 §五（PB- 批次与入口/阻断）、
 *       docs/17-§2（主循环七相位）与 §6（收割四要件：终态 completed + 输出非空 +
 *       REPORT 落盘 + 闸门 exit=0）；本采集器只负责「原始命令＋原始输出＋时间戳＋
 *       环境指纹」四件，不替探针下结论（结论在 report.md / probe-status.json）。
 *
 * 用法（在仓根）：
 *   mise exec -- bun scripts/probe/run-pb246.mjs [--repo <仓根>] [--out <docs/probe>] [--batch 2|4|6|all]
 *
 * 产物（每个批次目录）：
 *   log-00-environment.txt  环境指纹（DATE/HEAD/HOST/NODE/BUN/DSH/CODEX/...）
 *   log-01..log-0N.txt      每行 = 命令 + 原始输出 + EXIT；头部含 DATE/FINGERPRINT
 * 不写 report.md / probe-status.json（判定与证据引用由人写，防「采集器自证」）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = { batch: 'all' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--repo') out.repo = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--batch') out.batch = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const repo = path.resolve(args.repo ?? process.cwd())
const outRoot = path.resolve(args.out ?? path.join(repo, 'docs/probe'))
const only = String(args.batch)

const home = process.env.HOME ?? ''
const probeSecret = process.env.STUDIO_PROBE_SECRET ?? ''
const wkey = process.env.STUDIO_TOOLS_WKEY ?? ''

function nowIso() {
  return new Date().toISOString()
}

function quote(arg) {
  const s = String(arg)
  return /[^\w./:@%+=,-]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s
}

function sanitize(text) {
  let s = String(text ?? '')
  s = s.split(repo).join('<repo>')
  if (home !== '') s = s.split(home).join('<home>')
  if (gitCommon !== undefined) s = s.split(gitCommon).join('<git-common>')
  s = s.split('/private/tmp').join('<tmp>')
  if (probeSecret !== '') s = s.split(probeSecret).join('<redacted-probe-secret>')
  if (wkey !== '') s = s.split(wkey).join('<redacted-wkey>')
  return s
}

function clip(text, maxLines = 260) {
  const s = String(text ?? '')
  const lines = s.split('\n')
  if (lines.length <= maxLines) return s
  return `${lines.slice(0, maxLines).join('\n')}\n...[truncated ${lines.length - maxLines} lines]`
}

function runCommand(cmd, cmdArgs, opts = {}) {
  const started = nowIso()
  const res = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? repo,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input ?? '',
    encoding: 'utf8',
    timeout: opts.timeout ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const stdout = res.stdout ?? ''
  const stderr = res.stderr ?? ''
  const leak = probeSecret !== '' && `${stdout}${stderr}`.includes(probeSecret)
  return {
    started,
    cmd,
    args: cmdArgs,
    display: opts.display,
    stdout,
    stderr,
    status: res.status,
    signal: res.signal,
    errorCode: res.error ? (res.error.code ?? res.error.message) : undefined,
    leak,
  }
}

function renderRecord(record) {
  const lines = []
  lines.push(`TS=${record.started}`)
  const display = record.display ?? [record.cmd, ...record.args.map(quote)].join(' ')
  lines.push(`$ ${display}`)
  const out = clip(sanitize(record.stdout)).replace(/\n$/, '')
  const err = clip(sanitize(record.stderr)).replace(/\n$/, '')
  if (out !== '') lines.push(out)
  if (err !== '') lines.push(err)
  let exit = `EXIT=${record.status === null ? 'null' : String(record.status)}`
  if (record.signal) exit += ` SIGNAL=${record.signal}`
  if (record.errorCode) exit += ` ERROR=${record.errorCode}`
  if (record.leak) exit += ' LEAK_SCAN=FOUND'
  lines.push(exit)
  lines.push('')
  return lines.join('\n')
}

function resolveHead() {
  try {
    const dotGit = path.join(repo, '.git')
    const stat = fs.statSync(dotGit)
    let gitdir = dotGit
    if (stat.isFile()) {
      const text = fs.readFileSync(dotGit, 'utf8').trim()
      if (!text.startsWith('gitdir: ')) return { head: 'unknown', branch: 'unknown' }
      gitdir = path.resolve(repo, text.slice('gitdir: '.length))
    }
    const headText = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim()
    if (!headText.startsWith('ref: ')) return { head: headText, branch: 'detached' }
    const ref = headText.slice('ref: '.length)
    const commonFile = path.join(gitdir, 'commondir')
    const common = fs.existsSync(commonFile)
      ? path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim())
      : gitdir
    const sha = fs.readFileSync(path.join(common, ref), 'utf8').trim()
    return { head: sha, branch: ref.replace(/^refs\/heads\//, '') }
  } catch (error) {
    return { head: 'unknown', branch: 'unknown', error: String(error) }
  }
}

function resolveGitCommon() {
  try {
    const dotGit = path.join(repo, '.git')
    const stat = fs.statSync(dotGit)
    let gitdir = dotGit
    if (stat.isFile()) {
      const text = fs.readFileSync(dotGit, 'utf8').trim()
      if (!text.startsWith('gitdir: ')) return undefined
      gitdir = path.resolve(repo, text.slice('gitdir: '.length))
    }
    const commonFile = path.join(gitdir, 'commondir')
    return fs.existsSync(commonFile)
      ? path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim())
      : gitdir
  } catch {
    return undefined
  }
}

const gitCommon = resolveGitCommon()

function tryHealth(port) {
  const body = path.join('/private/tmp', `studio-probe-health-${port}.txt`)
  const res = spawnSync(
    'curl',
    ['-sS', '-m', '2', '-o', body, '-w', '%{http_code}', `http://127.0.0.1:${port}/api/health`],
    { encoding: 'utf8', timeout: 5000 },
  )
  let size = 0
  try {
    size = fs.statSync(body).size
  } catch {
    size = 0
  }
  return { code: (res.stdout ?? '').trim() || '000', size }
}

function readFileOr(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return fallback
  }
}

function buildEnvironmentFacts() {
  const head = resolveHead()
  const uname = runCommand('uname', ['-srm'])
  const swVersion = runCommand('sw_vers', ['-productVersion'])
  const swBuild = runCommand('sw_vers', ['-buildVersion'])
  const mise = runCommand('mise', ['--version'])
  const node = runCommand('mise', ['exec', '--', 'node', '--version'])
  const bun = runCommand('mise', ['exec', '--', 'bun', '--version'])
  const dsh = runCommand('dsh', ['--version'])
  const codex = runCommand('codex', ['--version'])
  const claudeWhich = runCommand('which', ['claude'])
  const kimiWhich = runCommand('which', ['kimi'])
  const git = runCommand('git', ['rev-parse', '--git-dir'])
  const envKeys = runCommand('sh', [
    '-c',
    "env | cut -d= -f1 | grep -E '^(DSH|KIMI|CODEX|CLAUDE|STUDIO|OPENAI|ANTHROPIC)' | sort",
  ])
  const health = { 8791: tryHealth(8791), 8788: tryHealth(8788), 8789: tryHealth(8789) }

  let repoWritable = 'unknown'
  const writeCheck = path.join(repo, '.probe-write-check')
  try {
    fs.writeFileSync(writeCheck, 'probe')
    repoWritable = 'yes'
    fs.unlinkSync(writeCheck)
  } catch (error) {
    repoWritable = `no (${error.code ?? 'EPERM'})`
  }

  const value = (record) => {
    const text = `${record.stdout}${record.stderr}`.trim()
    return text === '' ? `(exit ${record.status === null ? 'null' : record.status})` : text.split('\n')[0]
  }

  const facts = [
    `HEAD=${head.head}`,
    `BRANCH=${head.branch}`,
    `HOST=${value(uname)} / macOS ${value(swVersion)} (${value(swBuild)})`,
    `NODE=${value(node)}`,
    `BUN=${value(bun)}`,
    `MISE=${value(mise)}`,
    `DSH=${value(dsh)}`,
    'DSH_LOCKED=0.2.0-rc.2 (packages/adapters/src/dsh.ts LOCKED_VERSION)',
    `CODEX=${value(codex)}`,
    `CLAUDE=${claudeWhich.status === 0 ? value(claudeWhich) : 'missing'}`,
    `KIMI=${kimiWhich.status === 0 ? value(kimiWhich) : 'missing'}`,
    `REPO_WRITABLE=${repoWritable}`,
    `GIT=${git.status === 0 ? value(git) : `unavailable (${(git.stderr || git.stdout).trim().split('\n')[0] || 'exit ' + String(git.status)})`}`,
    `HEALTH_8791=${health[8791].code} (body ${health[8791].size}B)`,
    `HEALTH_8788=${health[8788].code} (body ${health[8788].size}B)`,
    `HEALTH_8789=${health[8789].code} (body ${health[8789].size}B)`,
    `ENV_KEYS=${(envKeys.stdout || '(none)').trim().split('\n').filter(Boolean).join(',') || '(none)'}`,
  ]
  return { facts, head, commands: [uname, swVersion, swBuild, mise, node, bun, dsh, codex, claudeWhich, kimiWhich, git, envKeys] }
}

function renderEnvironmentLog(facts, commands) {
  const bodyLines = [
    '# PB-2/4/6 真机探针环境指纹（只读采集；不含任何凭据值）',
    `DATE=${nowIso()}`,
    ...facts,
    '',
    '# 采集命令（原始输出）',
  ]
  for (const record of commands) {
    bodyLines.push(`$ ${[record.cmd, ...record.args.map(quote)].join(' ')}`)
    const out = clip(sanitize(`${record.stdout}${record.stderr}`)).replace(/\n$/, '')
    if (out !== '') bodyLines.push(out)
    bodyLines.push(`EXIT=${record.status === null ? 'null' : String(record.status)}`)
    bodyLines.push('')
  }
  const body = `${bodyLines.join('\n')}\n`
  const fingerprint = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`
  return { content: `${body}FINGERPRINT=${fingerprint}\n`, fingerprint }
}

function writeProbeLog(batchDir, filename, title, fingerprint, records) {
  const lines = [
    `# ${title}`,
    `DATE=${nowIso()}`,
    `FINGERPRINT=${fingerprint}`,
    `REPO=<repo>`,
    '',
  ]
  for (const record of records) lines.push(renderRecord(record))
  fs.writeFileSync(path.join(batchDir, filename), lines.join('\n'))
}

const env = buildEnvironmentFacts()
const envLog = renderEnvironmentLog(env.facts, env.commands)
const fingerprint = envLog.fingerprint

function shell(command) {
  return runCommand('sh', ['-c', command], { display: command })
}

function bunScript(scriptName, extraArgs = [], opts = {}) {
  const script = path.join(here, scriptName)
  return runCommand('mise', ['exec', '--', 'bun', script, '--repo', repo, ...extraArgs], {
    ...opts,
    display: `mise exec -- bun scripts/probe/${scriptName} --repo <repo>${extraArgs.length ? ' ' + extraArgs.map(quote).join(' ') : ''}`,
  })
}

const batchDefs = {
  2: {
    title: 'PB-2 投影与秘密（PRB-07/08/09）',
    logs: [
      {
        file: 'log-01-prb-07-secret-context.txt',
        title: 'PRB-07 秘密不进上下文（生成器 + 凭据目录，组件级正负同验）',
        records: [
          bunScript('prb07-secret-scan.mjs', [], {
            env: { STUDIO_PROBE_SECRET: probeSecret },
            display: 'STUDIO_PROBE_SECRET=<injected> mise exec -- bun scripts/probe/prb07-secret-scan.mjs --repo <repo>',
          }),
        ],
      },
      {
        file: 'log-02-prb-08-projection-signature.txt',
        title: 'PRB-08 投影摘要/签名校验（digest 篡改腿 + 验签通道静态面）',
        records: [
          bunScript('prb08-digest-tamper.mjs'),
          shell('grep -rn "verifySignature\\|verifyProjection\\|SEC-SIG-04" packages/core/src packages/gateway/src apps/daemon/src --include=*.ts | grep -v "/test/"'),
          shell('grep -rn "compileProjection\\|projectionGate\\|projectionDigest" apps packages --include=*.ts | grep -v "/test/"'),
          shell('grep -rn "loadProjection\\|ProjectionLoader\\|verifyProjection" apps packages --include=*.ts'),
          shell('grep -rn "signature" packages/gateway/src packages/core/src --include=*.ts | grep -v "/test/"'),
        ],
      },
      {
        file: 'log-03-prb-09-runtime-drift.txt',
        title: 'PRB-09 投影与运行时比对（drift 面静态侦察）',
        records: [
          shell('grep -rn "projection.*drift\\|drift.*projection\\|reconcileProjection\\|compareProjection" apps packages --include=*.ts'),
          shell('grep -rn "drift" apps/daemon/src packages/core/src --include=*.ts | grep -v "/test/"'),
          shell('grep -rn "loadProjection\\|ProjectionLoader" apps packages --include=*.ts'),
          shell('ls -1 packages/core/src/prm'),
        ],
      },
    ],
  },
  4: {
    title: 'PB-4 派生与审批（PRB-10/11/12/15/16）',
    logs: [
      {
        file: 'log-01-prb-10-subagent-decay.txt',
        title: 'PRB-10 子 agent 衰减（声明面 vs 运行期）',
        records: [
          shell('grep -rn "subagent\\|attenuat" packages/adapters/src apps/daemon/src packages/core/src --include=*.ts'),
          shell('grep -rn "in-process-subagent-decay\\|dsh-subagent" packages/adapters/src --include=*.ts'),
          runCommand('dsh', ['--help']),
          shell('dsh --help | grep -in "subagent\\|tool-filter\\|max-depth"'),
        ],
      },
      {
        file: 'log-02-prb-11-approval.txt',
        title: 'PRB-11 审批 fail-closed（审批端口/运行期）',
        records: [
          shell('grep -rn "approval" packages/adapters/src/bindcard packages/core/src apps/daemon/src/engine --include=*.ts'),
          shell('grep -rn "PORT-APPROVAL\\|approvalPort\\|requestApproval\\|approval-timeout\\|approvalTimeout" apps packages --include=*.ts'),
          shell('grep -rn "approval" packages/contract/src/ports --include=*.ts'),
        ],
      },
      {
        file: 'log-03-prb-12-crash-unknown.txt',
        title: 'PRB-12 崩溃后未知不重试（字段面 vs 运行期写口）',
        records: [
          shell('grep -rn "sideEffectPossible\\|retryable\\|reconcile" packages/adapters/src packages/core/src apps/daemon/src/engine --include=*.ts'),
          shell('grep -rn "crash\\|kill.*tool\\|unknown.*result\\|result.*unknown" apps/daemon/src packages/core/src --include=*.ts'),
          shell('grep -rn "REC-EVT-03\\|unknown" packages/contract/src --include=*.ts | head -60'),
        ],
      },
      {
        file: 'log-04-prb-15-host-switch.txt',
        title: 'PRB-15 换宿主保任职（HCL-3 交接/旧段围栏）',
        records: [
          shell('grep -rn "HCL-3\\|handover\\|switchHost\\|host-switch" apps packages --include=*.ts'),
          shell('grep -rn "HCL-3" docs/v2 --include=*.md | head -30'),
          shell('grep -rn "resumeWithSession\\|session_resume" apps/daemon/src --include=*.ts'),
        ],
      },
      {
        file: 'log-05-prb-16-ptc.txt',
        title: 'PRB-16 工具呈现三档与 PTC 可达面（配置/声明面）',
        records: [
          shell('grep -rn "PTC\\|ptc\\|tool-presentation" packages apps --include=*.ts'),
          shell('dsh --help | grep -in "presentation\\|ptc\\|profile"'),
          shell('grep -rn "dsh-agent-tool-presentation" . --include=*.ts --include=*.json --include=*.yaml --include=*.yml'),
        ],
      },
    ],
  },
  6: {
    title: 'PB-6 备选 CLI（PRB-24/25/26）',
    logs: [
      {
        file: 'log-01-prb-24-claude.txt',
        title: 'PRB-24 Claude 拟稿点（CLI 在机性 + 权限/降级面）',
        records: [
          runCommand('which', ['claude']),
          runCommand('claude', ['--version'], { timeout: 10_000 }),
          shell('grep -n "claude" packages/adapters/src/agentconfig.ts | head -40'),
          shell('grep -n "claude" packages/adapters/src/bindcard/cli-cards.ts | head -40'),
        ],
      },
      {
        file: 'log-02-prb-25-codex.txt',
        title: 'PRB-25 Codex 拟稿点（--resume 旗标形 vs resume 子命令形）',
        records: [
          runCommand('codex', ['--version'], { cwd: '/private/tmp' }),
          runCommand('codex', ['exec', '--help'], { cwd: '/private/tmp' }),
          runCommand('codex', ['exec', 'resume', '--help'], { cwd: '/private/tmp' }),
          runCommand('codex', ['exec', '--resume'], { cwd: '/private/tmp', input: '', timeout: 20_000 }),
          runCommand(
            'codex',
            ['exec', 'resume', '00000000-0000-0000-0000-000000000000', 'probe', '--skip-git-repo-check'],
            { cwd: '/private/tmp', input: '', timeout: 20_000 },
          ),
          shell('grep -n "resume" packages/adapters/src/codex.ts'),
        ],
      },
      {
        file: 'log-03-prb-26-kimi.txt',
        title: 'PRB-26 Kimi 拟稿点（-S 形态/wire 路径/模式互斥）',
        records: [
          runCommand('which', ['kimi']),
          runCommand('kimi', ['--version'], { timeout: 10_000 }),
          shell('grep -n "resume\\|-S\\|wire" packages/adapters/src/kimi.ts | head -80'),
          shell('grep -n "kimi" packages/adapters/src/agentconfig.ts | head -40'),
        ],
      },
    ],
  },
}

const selected = only === 'all' ? ['2', '4', '6'] : [only]
for (const key of selected) {
  const def = batchDefs[key]
  if (!def) {
    console.error(`UNKNOWN_BATCH=${key}`)
    process.exit(2)
  }
  const dir = path.join(outRoot, `pb-${key}`)
  fs.mkdirSync(dir, { recursive: true })
  // 每个批次共用同一份环境指纹（同一次采集、同一宿主）；同一份字节写入各批目录。
  fs.writeFileSync(path.join(dir, 'log-00-environment.txt'), envLog.content)
  for (const log of def.logs) {
    writeProbeLog(dir, log.file, log.title, fingerprint, log.records)
  }
  console.log(`BATCH=PB-${key} OUT=${sanitize(dir)} LOGS=${def.logs.length + 1}`)
}
console.log(`FINGERPRINT=${fingerprint}`)
console.log(`HEAD=${env.head.head} BRANCH=${env.head.branch}`)
