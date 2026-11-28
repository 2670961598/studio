#!/usr/bin/env node
/**
 * spec-admission.mjs —— 规范效力、实现状态与部署准入机械门禁（GOV-01 / task-160）
 *
 * 依据：
 *   - docs/quality/规范效力与部署准入.md（三表口径、legacy/shadow/enforce 与豁免流程）
 *   - docs/sentinel-logs/全面Review拆分-2026-11-28.md（§2.2 GOV-01、§7 范围裁剪与 V2 enforce 暂缓裁决）
 *   - docs/quality/reviews/2026-11-28/00-overall-review.md（§2.2 P1-01）与 01-framework-review.md（:102-119）
 *   - docs/v2/05 §三 DOM-05、docs/v2/09 §四、docs/v2/17 §七/§十一、docs/20 第十二章
 *
 * 零第三方依赖（仅 Node 标准库）；fail-closed（任一违例 exit 1）。
 * 校验器本体拆至 ./spec-admission-checks.mjs（保持每件 ≤600 行，docs/17-§5.1 SG-3）。
 *
 * 用法：
 *   node scripts/verify/spec-admission.mjs [--root <仓根>] [--gov-dir <相对目录>]
 *        [--now <YYYY-MM-DD>] [--skip-doc-scan] [--skip-fingerprints] [--json]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  addViolation,
  ISO_DATE_RE,
  isNonEmptyStr,
  isRecord,
  scanDocContradictions,
  validateDeploymentTable,
  validateImplTable,
  validateMigrationTable,
  validateSpecTable,
} from './spec-admission-checks.mjs'

const DEFAULT_GOV_DIR = 'docs/quality/governance'

function loadTable(root, govDir, fileName, violations) {
  const rel = `${govDir}/${fileName}`
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    addViolation(violations, 'MISSING_TABLE', rel, `缺少必需的机读治理表：${rel}`)
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    addViolation(violations, 'INVALID_JSON', rel, `JSON 解析失败：${msg}`)
    return null
  }
  if (!isRecord(parsed)) {
    addViolation(violations, 'SCHEMA_INVALID', rel, '顶层必须为 JSON 对象')
    return null
  }
  if (!isNonEmptyStr(parsed.schemaVersion)) {
    addViolation(violations, 'SCHEMA_INVALID', rel, '缺少非空 schemaVersion 字段')
  }
  if (!isNonEmptyStr(parsed.updatedAt) || !ISO_DATE_RE.test(parsed.updatedAt)) {
    addViolation(violations, 'SCHEMA_INVALID', rel, '缺少合法 updatedAt（YYYY-MM-DD）')
  }
  return parsed
}

/** 纯逻辑主入口（可供测试直接调用，无进程退出副作用）。 */
export function runSpecAdmission(root, options = {}) {
  const govDir = options.govDir ?? DEFAULT_GOV_DIR
  const asOfDate = options.now ?? new Date().toISOString().slice(0, 10)
  const checkFiles = options.checkFiles !== false
  const skipDocScan = options.skipDocScan === true
  const skipFingerprints = options.skipFingerprints === true
  const violations = []
  const warnings = []

  if (!ISO_DATE_RE.test(asOfDate)) {
    addViolation(violations, 'SCHEMA_INVALID', '--now', `非法日期格式：${asOfDate}（须为 YYYY-MM-DD）`)
  }

  const specTable = loadTable(root, govDir, 'spec-registry.json', violations)
  const implTable = loadTable(root, govDir, 'implementation-registry.json', violations)
  const deployTable = loadTable(root, govDir, 'deployment-admission.json', violations)
  const migTable = loadTable(root, govDir, 'migration-modes.json', violations)

  let specById = new Map()
  let implBySpecId = new Map()
  let activeExemptions = new Map()
  let deployedCompanies = new Set()

  if (specTable !== null) {
    specById = validateSpecTable(specTable, root, checkFiles, violations)
  }
  if (implTable !== null) {
    implBySpecId = validateImplTable(implTable, specById, root, checkFiles, violations)
  }
  if (deployTable !== null) {
    const dep = validateDeploymentTable(
      deployTable,
      specById,
      implBySpecId,
      root,
      asOfDate,
      { checkFiles, skipFingerprints },
      violations,
    )
    activeExemptions = dep.activeExemptions
    deployedCompanies = dep.deployedCompanies
  }
  if (migTable !== null) {
    validateMigrationTable(
      migTable,
      specById,
      implBySpecId,
      deployedCompanies,
      deployTable,
      asOfDate,
      violations,
    )
  }

  const checkedDocs = skipDocScan ? [] : scanDocContradictions(root, violations)

  const byCode = {}
  for (const v of violations) {
    byCode[v.code] = (byCode[v.code] ?? 0) + 1
  }

  return {
    ok: violations.length === 0,
    checkedAt: new Date().toISOString(),
    asOfDate,
    govDir,
    summary: {
      specs: specById.size,
      implementations: implBySpecId.size,
      requiredSpecs: Array.isArray(deployTable?.requiredSpecIds) ? deployTable.requiredSpecIds.length : 0,
      activeExemptions: activeExemptions.size,
      checkedDocs: checkedDocs.length,
      violations: violations.length,
      byCode,
    },
    checkedDocs,
    violations,
    warnings,
  }
}

function parseCliArgs(argv) {
  const opts = { json: false, skipDocScan: false, skipFingerprints: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--skip-doc-scan') opts.skipDocScan = true
    else if (a === '--skip-fingerprints') opts.skipFingerprints = true
    else if (a === '--root') opts.root = argv[++i]
    else if (a === '--gov-dir') opts.govDir = argv[++i]
    else if (a === '--now') opts.now = argv[++i]
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return opts
}

function resolveSelfPath() {
  const selfPath = fileURLToPath(import.meta.url)
  try {
    return fs.realpathSync(selfPath)
  } catch {
    return path.resolve(selfPath)
  }
}

function isDirectCliEntry() {
  if (!process.argv[1]) return false
  const argvAbs = path.resolve(process.argv[1])
  try {
    return fs.realpathSync(argvAbs) === resolveSelfPath()
  } catch {
    return import.meta.url === pathToFileURL(argvAbs).href
  }
}

function main() {
  let opts
  try {
    opts = parseCliArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`spec-admission 参数错误：${err instanceof Error ? err.message : String(err)}`)
    return 2
  }
  if (opts.help) {
    console.log(
      '用法：node scripts/verify/spec-admission.mjs [--root <仓根>] [--gov-dir <相对目录>] [--now YYYY-MM-DD] [--skip-doc-scan] [--skip-fingerprints] [--json]',
    )
    return 0
  }
  const defaultRoot = path.resolve(path.dirname(resolveSelfPath()), '..', '..')
  const root = opts.root ? path.resolve(opts.root) : defaultRoot
  const result = runSpecAdmission(root, opts)
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result.ok ? 0 : 1
  }
  if (result.ok) {
    const s = result.summary
    console.log(
      `spec-admission PASS：specs=${s.specs} impls=${s.implementations} admitted=${s.requiredSpecs} exemptions=${s.activeExemptions} docs=${s.checkedDocs}（asOf=${result.asOfDate}）`,
    )
    return 0
  }
  for (const v of result.violations) {
    console.error(`[spec-admission] FAIL [${v.code}] ${v.target} —— ${v.detail}`)
  }
  console.error(`spec-admission FAIL：${result.violations.length} 项违例 ${JSON.stringify(result.summary.byCode)}`)
  return 1
}

if (isDirectCliEntry()) {
  process.exit(main())
}
