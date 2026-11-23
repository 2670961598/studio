/**
 * io.mjs —— 基准工具的共享 IO：参数解析 / report 读取 / 原子写 / 出目录安全员
 * 复用评测台 lib（args/evaluate）的同类能力，不另起口径。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { UsageError } from '../../lib/args.mjs'
import { assertSafeOutDir, REPO_ROOT } from '../../lib/evaluate.mjs'

/** 评测台目录 scripts/ops/model-eval（本文件在 benchmark/lib/ 下，上溯两级）。 */
export const EVAL_DIR = resolve(import.meta.dirname, '..', '..')
/** 基准工具目录 scripts/ops/model-eval/benchmark。 */
export const HERE = resolve(import.meta.dirname, '..')

/**
 * 极简参数解析：`--key value` / `--key=value`；bool 型不取值。未知参数 / 缺值 → UsageError。
 * @param {string[]} argv
 * @param {Record<string, {type?: 'string'|'bool'|'int', default?: any}>} spec
 */
export function parseFlagArgs(argv, spec) {
  const out = {}
  for (const [k, def] of Object.entries(spec)) out[k] = def.default ?? (def.type === 'bool' ? false : null)
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok.startsWith('--')) throw new UsageError(`无法识别的参数：${tok}`)
    const eq = tok.indexOf('=')
    const key = eq > 0 ? tok.slice(2, eq) : tok.slice(2)
    const def = spec[key]
    if (def === undefined) throw new UsageError(`未知选项：--${key}`)
    if (def.type === 'bool') {
      if (eq > 0) throw new UsageError(`--${key} 不接受取值`)
      out[key] = true
      continue
    }
    const raw = eq > 0 ? tok.slice(eq + 1) : argv[++i]
    if (raw === undefined || raw === '') throw new UsageError(`--${key} 缺少取值`)
    if (def.type === 'int') {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${key} 须为非负整数：${raw}`)
      out[key] = n
    } else out[key] = raw
  }
  return out
}

/** "a,b, c" → ['a','b','c'] */
export function parseList(spec) {
  return String(spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * --reports 取值：逗号分隔的 report.json 路径或含 report.json 的目录。
 * @returns {Array<{file:string, label:string, report:object}>} label = "<上级目录名>/report.json"（不含绝对路径）
 */
export function loadReports(spec) {
  const parts = parseList(spec)
  if (parts.length === 0) throw new UsageError('--reports 必填：至少一份 report.json 或其所在目录')
  return parts.map((part) => {
    const p = resolve(part)
    if (!existsSync(p)) throw new UsageError(`报告路径不存在：${part}`)
    const file = statSync(p).isDirectory() ? join(p, 'report.json') : p
    if (!existsSync(file)) throw new UsageError(`目录下无 report.json：${part}`)
    const report = readJson(file)
    if (report?.schema !== 'model-eval/v1') {
      throw new UsageError(`不是 model-eval/v1 报告：${basename(dirname(file))}/${basename(file)}（schema=${report?.schema ?? '缺'}）`)
    }
    if (!Array.isArray(report.rows)) throw new UsageError(`报告缺 rows[]：${basename(file)}`)
    return { file, label: `${basename(dirname(file))}/${basename(file)}`, report }
  })
}

export function readJson(file, what = 'JSON 文件') {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new UsageError(`${what}读取失败：${basename(file)}（${e.message}）`)
  }
}

/** 出目录安全员：沿用评测台规则（不落仓 / 不落家目录 / 不落 git 根）。 */
export function safeOut(dir, what = '--out') {
  try {
    return assertSafeOutDir(dir)
  } catch (e) {
    throw new UsageError(`${what} 不安全：${e.message}`)
  }
}

/** 仓内拒写（AGENTS §五.6：运行产物不落仓）。 */
export function refuseInRepo(file, what) {
  const abs = resolve(file)
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT.endsWith('/') ? REPO_ROOT : `${REPO_ROOT}/`)) {
    throw new UsageError(`${what} 不得落在仓内（AGENTS §五.6）：${basename(abs)}`)
  }
  return abs
}

/** 原子写：先写同目录临时文件再 rename，避免半截产物被下游读到。 */
export function writeFileAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export function outLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}
