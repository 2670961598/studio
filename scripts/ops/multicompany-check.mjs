#!/usr/bin/env node
/**
 * multicompany-check —— 多公司前置配置校验（studio-dev-787 P0）
 *
 * 校验 `<WORKROOT>/registry.yaml` 与每公司落地面（daemon.yaml / credentials/daemon.env /
 * guardian-<slug>.json / ops/start.sh），把 787 的 P0 约定做成可执行门：
 *   1) 每公司 seatbeltWriteRoots 只允许「本公司 <CROOT>/.AIWS|workspaces」+ 基础设施白名单
 *      （~/.dsh、/private/tmp、/private/var/folders）；**禁全局 <WORKROOT>/.AIWS 与跨公司根**；
 *   2) 凭据隔离：guardian JSON 只允许 daemon.envFile 引用 `<CROOT>/credentials/daemon.env`
 *      （0600、非空），**禁止内联 MATRIX_BOT_PASSWORD/MATRIX_HR_SHARED_SECRET/TAIGA_PASSWORD/
 *      STUDIO_GATEWAY_SECRET**；envFile 不得含 group/other 读位；
 *   3) 端口/label 唯一，apiPort 与 registry 一致；新公司 label=io.studionext.<slug>
 *      （studio-dev 保留 io.studionext.daemon）；
 *   4) 容量初值：maxInflight ≤ 4；AIWS 配额 5–10G / 保留 7–14 天由安装后巡检核对（本脚本只查配置位数）。
 *
 * 用法：
 *   node scripts/ops/multicompany-check.mjs --registry <registry.yaml> [--work-root <root>]
 *        [--guardian-dir ~/.config/studio-next] [--json] [--strict-paths]
 *
 * 退出码：0=无违例；1=有违例（逐条给出 rule/company/problem/fix）；2=用法/读取错误。
 * 只读；不修改任何公司/配置面。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// 787 F1/F2：seatbelt 写根校验与 daemon 启动面**同源**（apps/daemon/src/assembly/serve/config.ts 唯一实现）
import { checkCompanySeatbeltWriteRoots } from '../../apps/daemon/src/assembly/serve/config.ts'

const USAGE = `用法：node scripts/ops/multicompany-check.mjs --registry <registry.yaml> [选项]

选项：
  --registry <file>       <WORKROOT>/registry.yaml（必填）
  --work-root <dir>       覆盖 registry 中的 <workRoot>（缺省=registry 文件目录）
  --guardian-dir <dir>    guardian JSON 目录（缺省 ~/.config/studio-next）
  --strict-paths          公司根/关键文件缺失也判违例（缺省 staging 允许缺失，active 必检）
  --json                  机器可读
  --help                  本帮助

退出码：0=无违例；1=违例；2=用法/读取错误。`

const SECRET_ENV_KEYS = ['MATRIX_BOT_PASSWORD', 'MATRIX_HR_SHARED_SECRET', 'TAIGA_PASSWORD', 'TAIGA_USERNAME', 'STUDIO_GATEWAY_SECRET']
const EXIT = { ok: 0, violations: 1, usage: 2 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--json' || token === '--strict-paths') {
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

function scalar(raw) {
  const v = raw.trim()
  if (v === '' || v === 'null' || v === '~') return null
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  const hash = v.indexOf(' #')
  return (hash >= 0 ? v.slice(0, hash) : v).trim()
}

/** 极简 registry YAML：companies: 列表 + 每项 key: scalar（模板即此形状；只做本脚本所需校验） */
export function parseRegistryYaml(text) {
  const lines = String(text).split(/\r?\n/)
  const companies = []
  let current = null
  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue
    if (/^companies:\s*$/.test(line)) continue
    const item = /^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (item !== null) {
      if (current !== null) companies.push(current)
      current = { [item[1]]: scalar(item[2]) }
      continue
    }
    const kv = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (kv !== null && current !== null) {
      current[kv[1]] = scalar(kv[2])
      continue
    }
  }
  if (current !== null) companies.push(current)
  return companies
}

/** 极简 flat daemon.yaml（本脚本只读顶层标量；数组值保留 JSON 字符串由后续解析） */
export function parseFlatYaml(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (m !== null) out[m[1]] = scalar(m[2])
  }
  return out
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function isUnder(target, base) {
  return target === base || target.startsWith(`${base}${path.sep}`)
}

const INFRA_ROOTS = [path.join(homedir(), '.dsh'), '/private/tmp', '/tmp', '/private/var/folders', '/var/folders']

/**
 * 核心校验（纯函数，供测试直调）：返回 violations[]。上下文由调用方给绝对路径。
 * @param {{company: object, workRoot: string, guardianDir: string, strictPaths: boolean}} input
 */
export function checkCompany({ company, workRoot, guardianDir, strictPaths }) {
  const violations = []
  const add = (rule, problem, fix) => violations.push({ rule, slug: company.slug, problem, fix })
  const root = path.resolve(String(company.root ?? path.join(workRoot, String(company.slug ?? ''))))
  const companyDir = path.resolve(String(company.company_dir ?? path.join(root, 'company')))
  const apiPort = Number(company.api_port)
  const status = String(company.status ?? '')

  if (typeof company.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(company.slug)) add('registry/slug', `slug 非法：${String(company.slug)}`, 'slug 须 ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) add('registry/api_port', `api_port 非法：${String(company.api_port)}`, '分配唯一环回端口（8788 studio-dev/8792 profit/8793+ 新公司）')
  const expectLabel = company.slug === 'studio-dev' ? 'io.studionext.daemon' : `io.studionext.${String(company.slug)}`
  if (company.guardian_label !== expectLabel) add('registry/label', `guardian_label=${String(company.guardian_label)}（期望 ${expectLabel}）`, `label 统一为 ${expectLabel}（studio-dev 兼容旧名）`)

  const requirePath = (p, rule) => {
    const exists = existsSync(p)
    if (!exists && (strictPaths || status === 'active')) add(rule, `缺失：${p}`, '补齐公司落地面文件（787 runbook）')
    return exists
  }
  const daemonYaml = path.join(companyDir, 'daemon.yaml')
  const envFile = path.join(root, 'credentials', 'daemon.env')
  const startSh = path.join(root, 'ops', 'start.sh')
  const guardianFile = path.join(guardianDir, `guardian-${String(company.slug)}.json`)
  requirePath(root, 'paths/root')
  requirePath(daemonYaml, 'paths/daemon.yaml')
  requirePath(envFile, 'paths/credentials')
  requirePath(startSh, 'paths/start.sh')
  requirePath(guardianFile, 'paths/guardian')

  if (existsSync(envFile)) {
    const st = statSync(envFile)
    const perm = st.mode & 0o777
    if ((perm & 0o077) !== 0) add('credentials/mode', `daemon.env 权限过宽：${perm.toString(8)}（须 0600）`, `chmod 600 ${envFile}`)
    if (readFileSync(envFile, 'utf8').trim() === '') add('credentials/empty', 'daemon.env 为空', '写入该公司的 TAIGA_/MATRIX_/STUDIO_GATEWAY_SECRET 等键值（0600，不入 git）')
  }

  if (existsSync(daemonYaml)) {
    const cfg = parseFlatYaml(readFileSync(daemonYaml, 'utf8'))
    if (cfg.companyDir !== undefined && path.resolve(cfg.companyDir) !== companyDir) add('daemon/companyDir', `daemon.yaml companyDir=${cfg.companyDir}（期望 ${companyDir}）`, 'companyDir 指向 <CROOT>/company')
    if (Number(cfg.maxInflight) > 4) add('capacity/maxInflight', `maxInflight=${cfg.maxInflight} > 4（新公司初值上限）`, '新公司 maxInflight ≤4；按容量门再调并留痕')
    if (Number(cfg.apiPort) !== apiPort) add('daemon/apiPort', `daemon.yaml apiPort=${String(cfg.apiPort)} ≠ registry ${String(apiPort)}`, '两处端口一致（唯一分配）')
    if (cfg.seatbeltWriteRoots === undefined) {
      if (status === 'active') add('seatbelt/missing', 'active 公司缺 seatbeltWriteRoots（缺省 read-only 会阻断派工写面）', '显式 tier: workspace-write + 本公司 .AIWS 根')
    } else {
      let parsed = null
      try {
        parsed = JSON.parse(String(cfg.seatbeltWriteRoots))
      } catch {
        parsed = null
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        add('seatbelt/roots-parse', 'seatbeltWriteRoots 不是非空 JSON 数组', '按模板写 ["<CROOT>/.AIWS", ...]')
      } else {
        const seatbeltViolations = checkCompanySeatbeltWriteRoots(
          { tier: String(cfg.seatbeltTier ?? 'workspace-write'), writeRoots: parsed.map(String), authorization: String(cfg.seatbeltAuthorization ?? '') },
          companyDir,
        )
        for (const v of seatbeltViolations) {
          const rule = v.reason === 'not-absolute' ? 'seatbelt/root-absolute' : v.reason === 'cross-company' ? 'seatbelt/cross-company' : 'seatbelt/root-whitelist'
          add(rule, `写根 ${v.raw}（realpath=${v.canonical}）：${v.reason}（787 P0：禁全局 .AIWS/跨公司/越权子域；只允许 <CROOT>/.AIWS 与 <companyDir>/workspaces 子树）`, `改为 ${path.join(root, '.AIWS')} 或 ${path.join(companyDir, 'workspaces')}`)
        }
      }
    }
  }

  if (existsSync(guardianFile)) {
    let guardian
    try {
      guardian = readJson(guardianFile)
    } catch (err) {
      add('guardian/json', `guardian JSON 无法解析：${err instanceof Error ? err.message : String(err)}`, '修 JSON')
      guardian = null
    }
    if (guardian !== null) {
      const daemon = guardian.daemon ?? {}
      const inline = daemon.env ?? {}
      for (const key of SECRET_ENV_KEYS) {
        if (inline[key] !== undefined) add('credentials/inline-secret', `guardian JSON 内联敏感键 ${key}（787 P0：凭据必须走 per-company daemon.env）`, `移除 env.${key}，改为 daemon.envFile=${envFile}`)
      }
      const envFileRef = daemon.envFile
      if (typeof envFileRef !== 'string' || envFileRef === '') add('credentials/envFile-missing', 'guardian JSON 未配 daemon.envFile（凭据应引用 <CROOT>/credentials/daemon.env）', `daemon.envFile = ${envFile}`)
      else if (path.resolve(envFileRef) !== envFile) add('credentials/envFile-path', `daemon.envFile=${envFileRef}（期望 ${envFile}，每公司独立凭据）`, 'envFile 指向本公司 credentials/daemon.env')
    }
  }
  return violations
}

function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`multicompany-check：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (args.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = args.opts
  if (typeof opts.registry !== 'string' || opts.registry === '') {
    process.stderr.write(`multicompany-check：缺 --registry <registry.yaml>\n\n${USAGE}`)
    return EXIT.usage
  }
  const registryPath = path.resolve(opts.registry)
  if (!existsSync(registryPath)) {
    process.stderr.write(`multicompany-check：registry 不存在：${registryPath}\n`)
    return EXIT.usage
  }
  let companies
  try {
    companies = parseRegistryYaml(readFileSync(registryPath, 'utf8'))
  } catch (err) {
    process.stderr.write(`multicompany-check：registry 解析失败：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.usage
  }
  if (companies.length === 0) {
    process.stderr.write('multicompany-check：registry 无 companies 条目\n')
    return EXIT.usage
  }
  const workRoot = path.resolve(typeof opts['work-root'] === 'string' && opts['work-root'] !== '' ? opts['work-root'] : path.dirname(registryPath))
  const guardianDir = path.resolve(typeof opts['guardian-dir'] === 'string' && opts['guardian-dir'] !== '' ? opts['guardian-dir'] : path.join(homedir(), '.config', 'studio-next'))
  const strictPaths = opts['strict-paths'] === true

  const violations = []
  const seenSlug = new Set()
  const seenPort = new Map()
  const seenLabel = new Set()
  for (const company of companies) {
    if (typeof company.slug === 'string') {
      if (seenSlug.has(company.slug)) violations.push({ rule: 'registry/duplicate-slug', slug: company.slug, problem: `slug 重复：${company.slug}`, fix: 'registry 每公司一行且唯一' })
      seenSlug.add(company.slug)
    }
    const port = Number(company.api_port)
    if (seenPort.has(port)) violations.push({ rule: 'registry/duplicate-port', slug: company.slug, problem: `api_port 与 ${seenPort.get(port)} 重复：${String(port)}`, fix: '每公司唯一环回端口' })
    else seenPort.set(port, company.slug)
    if (typeof company.guardian_label === 'string') {
      if (seenLabel.has(company.guardian_label)) violations.push({ rule: 'registry/duplicate-label', slug: company.slug, problem: `guardian_label 重复：${company.guardian_label}`, fix: '每公司唯一 launchd label' })
      seenLabel.add(company.guardian_label)
    }
    violations.push(...checkCompany({ company, workRoot, guardianDir, strictPaths }))
  }
  if (opts.json === true) process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, workRoot, guardianDir, companies: companies.length, violations }, null, 2)}\n`)
  else if (violations.length === 0) process.stdout.write(`[multicompany-check] PASS（${String(companies.length)} 家公司；787 P0 配置面）\n`)
  else {
    process.stdout.write(`[multicompany-check] FAIL（${String(violations.length)} 条违例 / ${String(companies.length)} 家公司）：\n`)
    for (const v of violations) process.stdout.write(`  [${v.rule}] ${v.slug ?? '?'}：${v.problem}\n    修法：${v.fix}\n`)
  }
  return violations.length === 0 ? EXIT.ok : EXIT.violations
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
