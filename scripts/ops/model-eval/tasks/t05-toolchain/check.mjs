/**
 * t05-toolchain —— JSON → 过滤 → 分组统计 → CSV/JSON：确定性判分
 *
 * 期望值由参考实现 expectedOutputs() 从 **原件** tickets.json 算出（分累加），不信任工位里的输入副本。
 * 口径（docs/quality/model-eval.md §2）：
 *   CSV 值全对（归一后逐字节，required）；summary.json 值与键序全对（required）；脚本存在（required）；
 *   输入未改、无新增依赖（required）；CSV 字节级规范（LF/无 BOM/单换行结尾，附加项）；
 *   summary.json 规范化 2 空格缩进（附加项）；脚本可重跑复现（附加项）；无多余文件（附加项）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileHashes, finish, listFiles, normalizeCtx, normalizeText, readTextIfExists } from '../../lib/check-utils.mjs'

export const rubric = [
  '- 结果正确（6 分）：滞留定义（open/stalled 且 ageDays≥3）落实无误，按 lane 分组的 count / costUsd、totalStalled、topModel（并列取字典序最小）全部正确。',
  '- 形式合规（2 分）：CSV 表头/排序/两位小数/LF；summary.json 键序与缩进；无多余文件。',
  '- 过程稳健（2 分）：用脚本而非手算；金额按分累加；脚本可重跑复现；未装依赖、未改输入。',
].join('\n')

const toCents = (usd) => Math.round(Number(usd) * 100)
const money = (cents) => (cents / 100).toFixed(2)
const STALLED_STATES = new Set(['open', 'stalled'])
const ALLOWED_FILES = new Set(['tickets.json', 'stats.mjs', 'out/stalled-by-lane.csv', 'out/summary.json'])
const DEP_FILES = new Set(['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml'])

/** 参考实现：从 tickets 数组算期望产物（金额按分累加）。 */
export function expectedOutputs(tickets) {
  const stalled = tickets.filter((t) => STALLED_STATES.has(t.state) && Number(t.ageDays) >= 3)
  const lanes = [...new Set(stalled.map((t) => t.lane))].sort()
  const byLane = {}
  for (const lane of lanes) {
    const rows = stalled.filter((t) => t.lane === lane)
    byLane[lane] = { count: rows.length, costUsd: money(rows.reduce((s, t) => s + toCents(t.costUsd), 0)) }
  }
  const byModel = {}
  for (const t of stalled) byModel[t.model] = (byModel[t.model] ?? 0) + 1
  const max = Math.max(...Object.values(byModel))
  const topModel = Object.keys(byModel).filter((m) => byModel[m] === max).sort()[0] ?? null
  const csv = ['lane,count,costUsd', ...lanes.map((l) => `${l},${byLane[l].count},${byLane[l].costUsd}`)].join('\n') + '\n'
  const summary = {
    generatedFrom: 'tickets.json',
    totalStalled: stalled.length,
    byLane: Object.fromEntries(lanes.map((l) => [l, { count: byLane[l].count, costUsd: Number(byLane[l].costUsd) }])),
    topModel,
  }
  return { csv, summary, lanes }
}

function firstDiff(actual, expected) {
  const a = normalizeText(actual)
  const b = normalizeText(expected)
  if (a === b) return null
  const al = a.split('\n')
  const bl = b.split('\n')
  const i = al.findIndex((l, k) => l !== bl[k])
  return i === -1 ? `行数不同：实际 ${al.length}，期望 ${bl.length}` : `第 ${i + 1} 行：实际「${al[i]}」期望「${bl[i]}」`
}

function summaryDiff(obj, exp) {
  const top = ['generatedFrom', 'totalStalled', 'byLane', 'topModel']
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return '不是 JSON 对象'
  if (JSON.stringify(Object.keys(obj)) !== JSON.stringify(top)) return `顶层键序 ${JSON.stringify(Object.keys(obj))}（期望 ${JSON.stringify(top)}）`
  if (obj.generatedFrom !== exp.summary.generatedFrom) return `generatedFrom=${JSON.stringify(obj.generatedFrom)}`
  if (obj.totalStalled !== exp.summary.totalStalled) return `totalStalled=${obj.totalStalled}（期望 ${exp.summary.totalStalled}）`
  const lanes = Object.keys(obj.byLane ?? {})
  if (JSON.stringify(lanes) !== JSON.stringify(exp.lanes)) return `byLane 的 lane ${JSON.stringify(lanes)}（期望 ${JSON.stringify(exp.lanes)}）`
  for (const lane of exp.lanes) {
    const v = obj.byLane[lane]
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return `byLane.${lane} 不是对象`
    if (JSON.stringify(Object.keys(v)) !== '["count","costUsd"]') return `byLane.${lane} 键序 ${JSON.stringify(Object.keys(v))}`
    if (v.count !== exp.summary.byLane[lane].count) return `byLane.${lane}.count=${v.count}（期望 ${exp.summary.byLane[lane].count}）`
    if (toCents(v.costUsd) !== toCents(exp.summary.byLane[lane].costUsd)) return `byLane.${lane}.costUsd=${v.costUsd}（期望 ${exp.summary.byLane[lane].costUsd}）`
  }
  if (obj.topModel !== exp.summary.topModel) return `topModel=${JSON.stringify(obj.topModel)}（期望 ${JSON.stringify(exp.summary.topModel)}）`
  return null
}

export async function check(ctx) {
  const { dir, fixturesSource } = normalizeCtx(ctx)
  const tickets = JSON.parse(readTextIfExists(join(fixturesSource, 'tickets.json')))
  const exp = expectedOutputs(tickets)
  const files = listFiles(dir)
  const script = join(dir, 'stats.mjs')
  const scriptExists = existsSync(script)

  // 1) 先比对「跑前」已有的产物（期望值来自原件）——判分方不替被测模型补跑
  const csvRaw = readTextIfExists(join(dir, 'out/stalled-by-lane.csv'))
  const jsonRaw = readTextIfExists(join(dir, 'out/summary.json'))
  const csvDiff = csvRaw === null ? '缺 out/stalled-by-lane.csv' : firstDiff(csvRaw, exp.csv)
  let parsed = null
  try {
    parsed = jsonRaw === null ? null : JSON.parse(jsonRaw.replace(/^\uFEFF/, ''))
  } catch {
    parsed = null
  }
  const jsonDiff = jsonRaw === null ? '缺 out/summary.json' : summaryDiff(parsed, exp)
  const csvBytesOk = csvRaw !== null && csvRaw === normalizeText(csvRaw) && !/\r/.test(csvRaw) && csvRaw.endsWith('\n') && !/\n\n$/.test(csvRaw)
  const jsonBytesOk = jsonRaw !== null && parsed !== null && jsonRaw === `${JSON.stringify(parsed, null, 2)}\n`

  // 2) 脚本可重跑：在工位内再跑一次，产物须与跑前一致（跑前缺产物则不代跑，判不过）
  let repro = { ok: false, detail: '缺 stats.mjs' }
  if (scriptExists && csvRaw !== null && jsonRaw !== null) {
    const before = fileHashes(join(dir, 'out'))
    const r = spawnSync(process.execPath, ['stats.mjs'], { cwd: dir, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '', HOME: dir, LANG: 'en_US.UTF-8' } })
    const after = fileHashes(join(dir, 'out'))
    const same = before.size === after.size && [...before].every(([k, v]) => after.get(k) === v)
    repro = { ok: r.status === 0 && same, detail: `node stats.mjs → exit=${r.status ?? r.signal ?? '?'}，产物${same ? '一致' : '不一致'}` }
  } else if (scriptExists) {
    repro = { ok: false, detail: '跑前缺 out/ 产物（脚本未执行；判分方不代跑）' }
  }

  // 3) 约束：输入未改、无依赖、无多余文件
  const inputUnchanged = readTextIfExists(join(dir, 'tickets.json')) === readTextIfExists(join(fixturesSource, 'tickets.json'))
  const badDeps = files
    .filter((f) => (f !== 'package.json' && DEP_FILES.has(f)) || (f === 'package.json' && /"dependencies"\s*:\s*\{\s*"/.test(readTextIfExists(join(dir, f)) ?? '')))
    .concat(existsSync(join(dir, 'node_modules')) ? ['node_modules/'] : [])
  const extras = files.filter((f) => !ALLOWED_FILES.has(f) && f !== '.DS_Store')

  return finish([
    { id: 'csv-values', ok: csvDiff === null, detail: csvDiff ?? `out/stalled-by-lane.csv 与期望一致（${exp.lanes.length} 个 lane）` },
    { id: 'summary-values', ok: jsonDiff === null, detail: jsonDiff ?? 'out/summary.json 值与键序一致' },
    { id: 'script-exists', ok: scriptExists, detail: '工位根 stats.mjs' },
    { id: 'input-unchanged', ok: inputUnchanged, detail: inputUnchanged ? 'tickets.json 未改' : 'tickets.json 被改' },
    { id: 'no-deps', ok: badDeps.length === 0, detail: badDeps.length === 0 ? '未新增依赖/锁文件' : `出现：${badDeps.join(', ')}` },
    { id: 'csv-bytes', ok: csvBytesOk, detail: 'CSV 字节规范：LF、无 BOM、单换行结尾、无空行', required: false },
    { id: 'json-bytes', ok: jsonBytesOk, detail: 'summary.json：2 空格缩进、换行结尾', required: false },
    { id: 'script-reproducible', ok: repro.ok, detail: repro.detail, required: false },
    { id: 'no-extra-files', ok: extras.length === 0, detail: extras.length === 0 ? '无多余文件' : `多余：${extras.slice(0, 5).join(', ')}`, required: false },
  ])
}
