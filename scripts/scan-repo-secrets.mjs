#!/usr/bin/env node
/**
 * scan-repo-secrets.mjs —— 仓面秘密/本机痕迹扫描门禁（IMPL-07-11；AGENTS.md §五.6 第三句的机器化）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-11（「仓面扫描门禁脚本：本机路径/IP/凭证模式扫描，命中即拒」；
 *     冻结验收 `mise exec -- node scripts/scan-repo-secrets.mjs` exit 0）；
 *   - docs/v2/15 §4.4-④（仓面扫描＝提交门禁扫描仓内容，本机路径/IP/真实凭证模式，命中即拒）
 *     与 §4.5（「不入库｜不入提示词｜不入日志」红线；显式拒绝优于默认放行）；
 *   - docs/79-§…「本机路径」条（产物与文档中不得出现 `/Users/...`、`/Volumes/...`、盘符、
 *     内网 IP、主机名、真实 MXID/账号；docs/79:965）；
 *   - docs/audit-DSF/V13-01（「仓内无任何密钥扫描工具」——本脚本即该缺口的工具面）。
 *
 * 规则（命中即判负；值不回显——只打印规则名/位置/值指纹）：
 *   1. host-absolute-path  ：`/Users/<x>`、`/Volumes/<x>`、`/home/<x>`、`<盘符>:\Users\<x>`
 *                            （本机/个人绝对路径；仓内文档与代码一律不得写死）
 *   2. private-ip          ：RFC1918（10/8、172.16/12、192.168/16）与 link-local 169.254/16
 *   3. private-key         ：PEM 私钥块头（`-----BEGIN … PRIVATE KEY-----`）
 *   4. provider-token      ：已知供应商凭据前缀（GitHub/AWS/Slack/OpenAI/Google）与 JWT
 *   5. bearer-token        ：`Authorization: Bearer <长值>` / `Bearer <≥20 值字符>`
 *   6. credential-assign   ：`password|secret|token|api_key|…[:=]<高熵值>`（赋值对）
 *
 * 口径纪律（不静默）：
 *   - **存量基线**：本脚本落地时仓内已有命中（文档留痕/测试夹具/工具正则）逐条登记于
 *     `BASELINE`（file＋rule＋值指纹；**不存值**）。基线只减不增：新命中 exit 1；
 *     `--strict` 忽略基线（目标态：零命中；用来量现存债）。
 *   - **自豁免**：脚本自身含规则正则（字面量必然自命中），仅此一文件按绝对路径跳过，
 *     其余一切文本文件（含 docs/templates/scripts）都在扫描面内。
 *   - **生成物/第三方**：`.git`/`node_modules`/`dist`/`vendor`/`var`/`.AIWS`/`.VSCodeCounter`
 *     等生成目录与二进制文件（NUL 探测）不扫；不扫 = 明确排除，不是「扫了没命中」。
 *
 * 用法：
 *   node scripts/scan-repo-secrets.mjs               # 扫本仓；新命中 exit 1
 *   node scripts/scan-repo-secrets.mjs --root <dir>  # 扫任意目录（测试夹具/CI worktree）
 *   node scripts/scan-repo-secrets.mjs --strict      # 存量基线也计入失败（目标态检查）
 *   node scripts/scan-repo-secrets.mjs --json        # 机器可读输出（CI/测试断言）
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(SELF), '..')
const MAX_BYTES = 2 * 1024 * 1024
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'vendor',
  'var',
  '.AIWS',
  '.VSCodeCounter',
  'coverage',
  '.cache',
  '.turbo',
  'tmp',
])
const SKIP_FILES = new Set(['.DS_Store'])

/** 规则表：id 是判负口径名（测试与报告引用此名，不改名）。 */
const RULES = [
  {
    id: 'host-absolute-path',
    // 段首必须字母数字（`/Users/...` 这类省略号占位不误报）
    re: /(?:\/Users\/|\/Volumes\/|\/home\/|[A-Za-z]:\\Users\\)[A-Za-z0-9][A-Za-z0-9._-]+/g,
  },
  {
    id: 'private-ip',
    // 四段（每段 0-255）RFC1918/link-local。**不做三段匹配**——`10.0.0`/`10.1.1` 是版本号不是 IP；
    // 10/8 与 172.16/12 需补足四段，192.168/16 与 169.254/16 前缀已占两段。
    re: /\b(?:(?:10|172\.(?:1[6-9]|2[0-9]|3[01]))\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])|(?:192\.168|169\.254)\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9]))\b/g,
  },
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'provider-token',
    re: /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|A[KS]IA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
  },
  {
    id: 'bearer-token',
    // 两档：显式 Authorization 头（12+ 值字符）或裸 Bearer（20+ 值字符）
    re: /(?:Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})/gi,
  },
  {
    id: 'credential-assign',
    re: /\b(?:password|passwd|shared_secret|client_secret|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{12,})/gi,
    // 赋值对低熵过滤：夹具词（test/fake/…）与单字符重复不算真实凭证形态
    accept: (match, value) => looksHighEntropy(value),
  },
]

const PLACEHOLDER = /^(?:test|fake|dummy|example|sample|placeholder|changeme|change_me|redacted|secret|password|token|value|hunter2|abcdef|lorem|xxx|foo|bar|baz|todo|your|none|null|undefined)/i

/** 高熵判定（凭证形态而非教学/夹具词）：字母数字混排或长 hex/base64。 */
function looksHighEntropy(value) {
  if (PLACEHOLDER.test(value)) return false
  const unique = new Set(value).size
  if (unique < 6) return false
  const hasAlpha = /[A-Za-z]/.test(value)
  const hasDigit = /[0-9]/.test(value)
  if (hasAlpha && hasDigit) return true
  return /^[0-9a-f]{24,}$/i.test(value) || (hasAlpha && value.length >= 24)
}

/**
 * 存量基线：本脚本落地时仓内已存在的命中（file＋rule＋值指纹 sha256 前 16 hex）。
 * 不存值、不按行号（行号漂移不产生假红）；同一文件同一规则的**同一值**只登记一次。
 * 只减不增：修复后应删条目（`--strict` 下任何命中都判负，基线不清即失败）。
 */
const BASELINE = [
  // —— 文档留痕（历史审计/复核文档引本机路径；修法=改为相对引用，属 docs 领土，本单不改）——
  { file: 'docs/83-审计-GLM/H0b-总纲层反例与判据完备性-GLM.md', rule: 'host-absolute-path', valueHash: '1e04d48803942783' },
  { file: 'docs/87-验证-工程资产类-GLM.md', rule: 'host-absolute-path', valueHash: 'c8a805994641b9cf' },
  { file: 'docs/89-修订一致性复核-DSF.md', rule: 'host-absolute-path', valueHash: '6208456725a2a0a3' },
  { file: 'docs/90-修订复核-复检-DSF.md', rule: 'host-absolute-path', valueHash: '7768dd13bda2a0fb' },
  { file: 'docs/audit-DSF/O3-可行性与证据-DSF.md', rule: 'host-absolute-path', valueHash: '0638494baf08a8af' },
  // —— 文档示例（脱敏规则/矩阵凭据说明里的教学样例；非真实凭据）——
  { file: 'docs/81-files/05-prompt.md', rule: 'bearer-token', valueHash: '193307c8de5507f7' },
  { file: 'docs/81-files/11-matrix.md', rule: 'credential-assign', valueHash: 'cccecc4b25093043' },
  // —— 测试夹具（假路径/假内网 IP/脱敏算法自测样例；旧测试领土，本单不改）——
  { file: 'packages/adapters/test/dsh-env-whitelist.test.ts', rule: 'host-absolute-path', valueHash: '92edc76831511b6e' },
  { file: 'packages/adapters/test/seatbelt.test.ts', rule: 'private-ip', valueHash: '58181c1167e9a359' },
  { file: 'packages/api/test/v2/subscriptions.test.ts', rule: 'private-ip', valueHash: 'e222273ec698ee30' },
  { file: 'packages/api/test/v2/subscriptions.test.ts', rule: 'private-ip', valueHash: 'db0ecc6938710408' },
  { file: 'packages/company/test/v2/asset-import.test.ts', rule: 'host-absolute-path', valueHash: '44c488057bc5b4df' },
  { file: 'packages/company/test/v2/defpkg-import.test.ts', rule: 'host-absolute-path', valueHash: '9b144af52f8a68fd' },
  { file: 'packages/core/test/secrets.test.ts', rule: 'bearer-token', valueHash: 'ab0421108219084f' },
  { file: 'packages/core/test/secrets.test.ts', rule: 'bearer-token', valueHash: '1f13de8dc196fcc4' },
  { file: 'packages/core/test/secrets.test.ts', rule: 'credential-assign', valueHash: 'c5fe5d2e4d81f5c8' },
  { file: 'packages/gateway/test/v2/fail-closed-secret.test.ts', rule: 'credential-assign', valueHash: 'edfc84a0807744f1' },
  { file: 'packages/matrix/src/hr-face.test.ts', rule: 'credential-assign', valueHash: 'e3abcdc828d5f4c9' },
  { file: 'packages/taiga/test/memberships.test.ts', rule: 'credential-assign', valueHash: 'ef66e7de2d1cf248' },
  { file: 'apps/daemon/test/engine/hrsync/hrsync.test.ts', rule: 'credential-assign', valueHash: '7f4f3b44eb63472e' },
]

function fingerprint(file, rule, value) {
  return createHash('sha256').update(`${file}\0${rule}\0${value}`).digest('hex').slice(0, 16)
}

function isBinary(buf) {
  const n = Math.min(buf.length, 1024)
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true
  return false
}

/** 递归收集待扫文件（确定性序：readdir 排序 + 先文件后目录不保证——最后统一排序）。 */
function collectFiles(root, out = []) {
  for (const name of readdirSync(root).sort()) {
    // 跳过表按名命中（`.git` 在 worktree 里是**文件**——gitdir 指针含本机路径，同跳）
    if (SKIP_FILES.has(name) || SKIP_DIRS.has(name)) continue
    const abs = join(root, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue // 悬空符号链接等：跳过不报（扫描面=可读常规文件）
    }
    if (st.isDirectory()) {
      collectFiles(abs, out)
      continue
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) continue
    if (abs === SELF) continue // 自豁免（规则正则字面量必然自命中；见头注）
    out.push(abs)
  }
  return out
}

function scanFile(abs, rule, hits) {
  let text
  try {
    const buf = readFileSync(abs)
    if (isBinary(buf)) return
    text = buf.toString('utf8')
  } catch {
    return
  }
  const re = new RegExp(rule.re.source, rule.re.flags)
  for (const m of text.matchAll(re)) {
    const value = m[0]
    if (rule.accept !== undefined && rule.accept(m, m[1] ?? value) !== true) continue
    hits.push({ file: abs, rule: rule.id, value, line: lineOf(text, m.index ?? 0) })
  }
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

function parseArgs(argv) {
  const opts = { root: REPO_ROOT, strict: false, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--root') {
      const next = argv[i + 1]
      if (next === undefined) {
        process.stderr.write('scan-repo-secrets：--root 缺参数值\n')
        process.exit(2)
      }
      opts.root = resolve(next)
      i += 1
    } else if (a === '--strict') opts.strict = true
    else if (a === '--json') opts.json = true
    else if (a === '--help' || a === '-h') {
      process.stdout.write('用法：node scripts/scan-repo-secrets.mjs [--root <dir>] [--strict] [--json]\n')
      process.exit(0)
    } else {
      process.stderr.write(`scan-repo-secrets：未知参数 ${a}\n`)
      process.exit(2)
    }
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  let rootStat
  try {
    rootStat = statSync(opts.root)
  } catch {
    process.stderr.write(`scan-repo-secrets：扫描根不存在或不可读：${opts.root}\n`)
    process.exit(2)
  }
  if (!rootStat.isDirectory()) {
    process.stderr.write(`scan-repo-secrets：扫描根不是目录：${opts.root}\n`)
    process.exit(2)
  }
  const baseline = new Map()
  for (const b of BASELINE) baseline.set(`${b.file}\0${b.rule}\0${b.valueHash}`, b)
  const raw = []
  for (const abs of collectFiles(opts.root).sort()) for (const rule of RULES) scanFile(abs, rule, raw)

  const seen = new Set()
  const hits = []
  for (const h of raw) {
    const file = relative(opts.root, h.file).split(sep).join('/')
    const valueHash = fingerprint(file, h.rule, h.value)
    const key = `${file}\0${h.rule}\0${valueHash}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({ file, rule: h.rule, line: h.line, valueHash, baseline: baseline.has(key) })
  }
  hits.sort((a, b) => (a.file === b.file ? (a.rule === b.rule ? a.line - b.line : a.rule.localeCompare(b.rule)) : a.file.localeCompare(b.file)))
  const fresh = hits.filter((h) => !h.baseline)
  const known = hits.filter((h) => h.baseline)
  const stale = [...baseline.keys()].filter((key) => {
    const [file, rule, valueHash] = key.split('\0')
    return !hits.some((h) => h.file === file && h.rule === rule && h.valueHash === valueHash)
  })
  const ok = opts.strict ? hits.length === 0 : fresh.length === 0

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        root: opts.root,
        strict: opts.strict,
        ok,
        rules: RULES.map((r) => r.id),
        newHits: fresh.map((h) => ({ file: h.file, rule: h.rule, line: h.line, valueHash: h.valueHash })),
        baselineHits: known.map((h) => ({ file: h.file, rule: h.rule, line: h.line, valueHash: h.valueHash })),
        staleBaseline: stale.length,
      })}\n`,
    )
  } else {
    const lines = []
    lines.push(`扫描根：${opts.root}`)
    lines.push(`规则：${RULES.map((r) => r.id).join(' / ')}（值不回显，只报位置与指纹）`)
    lines.push(`命中：新 ${fresh.length} 条 / 已登记基线 ${known.length} 条${opts.strict ? '（--strict：基线亦判负）' : ''}`)
    for (const h of fresh) lines.push(`  ✗ ${h.file}:${h.line}  [${h.rule}]  指纹 ${h.valueHash}`)
    for (const h of known) lines.push(`  · ${h.file}:${h.line}  [${h.rule}]  指纹 ${h.valueHash}（基线）`)
    if (stale.length > 0) lines.push(`基线过期：${stale.length} 条（命中已消失——请从 BASELINE 删除，只减不增）`)
    lines.push(ok ? '结论：通过（无新增命中）' : '结论：FAIL——命中本机路径/IP/凭证模式（AGENTS §五.6；修法=清除该值或改相对引用/env 键名）')
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  process.exit(ok ? 0 : 1)
}

main()
