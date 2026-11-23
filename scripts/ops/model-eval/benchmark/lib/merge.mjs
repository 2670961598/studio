/**
 * merge.mjs —— 多批次 report.json 合并与重试替换（纯函数，零 IO）
 *
 * 口径（docs/quality/benchmark-business-eval.md §5.4）：
 *   格键 = (模型, 任务, rep)。多份 report.json 按生成时间升序当作同一评测的连续批次：
 *   · 首个有效样本（OK / TASK_FAIL）即定稿，其后同键的结果只留档不替换（先到先得，禁止挑好样本）；
 *   · 无有效样本时取**最后一次**尝试的类别；
 *   · 同一格累计 `timeoutRetriesToModelSide` 次 LIMIT:timeout → 判模型侧 BUDGET:timeout，计 0 分
 *     （重试后仍超时 = 时限预算内未完成，属模型侧而非设施侧）。
 */
import { classifyRow } from './classify.mjs'

export function cellKey(row) {
  return `${row.model}|${row.task}|${row.rep}`
}

function byTime(a, b) {
  return String(a.generatedAt ?? '').localeCompare(String(b.generatedAt ?? ''))
}

/**
 * @param {Array<object>} reports  model-eval/v1 report.json 对象（任意顺序）
 * @param {{timeoutRetriesToModelSide?: number}} [opts]
 * @returns {Array<object>} 每格一条：{ key, model, task, rep, taskSlug, attempts[], final, retried, extraRuns }
 */
export function mergeReports(reports, { timeoutRetriesToModelSide = 2 } = {}) {
  const cells = new Map()
  const sorted = [...(reports ?? [])].sort(byTime)
  sorted.forEach((rep, run) => {
    for (const row of rep?.rows ?? []) {
      if (!row || typeof row.model !== 'string' || typeof row.task !== 'string') continue
      const key = cellKey(row)
      if (!cells.has(key)) {
        cells.set(key, { key, model: row.model, task: row.task, rep: row.rep, taskSlug: row.taskSlug ?? row.task, attempts: [] })
      }
      const c = classifyRow(row)
      cells.get(key).attempts.push({
        run,
        generatedAt: rep.generatedAt ?? null,
        ...c,
        latencyMs: row.latencyMs ?? null,
        tokensTotal: row.tokensTotal ?? null,
        steps: row.steps ?? null,
        toolCalls: row.toolCalls ?? null,
        judgeScore: row.judgeScore ?? null,
        judgeSelf: row.judgeSelf === true,
        failedChecks: Array.isArray(row.failedChecks) ? row.failedChecks : [],
        outputPath: row.outputPath ?? null,
        finalText: typeof row.finalText === 'string' ? row.finalText : null,
      })
    }
  })
  for (const cell of cells.values()) resolveCell(cell, timeoutRetriesToModelSide)
  return [...cells.values()].sort((a, b) =>
    a.model.localeCompare(b.model) || a.task.localeCompare(b.task) || Number(a.rep) - Number(b.rep))
}

function resolveCell(cell, k) {
  const idx = cell.attempts.findIndex((a) => a.side === 'sample')
  if (idx >= 0) {
    cell.final = { ...cell.attempts[idx], attemptsUsed: idx + 1 }
    cell.retried = idx > 0
    cell.extraRuns = cell.attempts.length - idx - 1
    return
  }
  const last = cell.attempts[cell.attempts.length - 1]
  const timeouts = cell.attempts.filter((a) => a.cls === 'LIMIT:timeout').length
  cell.retried = cell.attempts.length > 1
  cell.extraRuns = 0
  if (timeouts >= k) {
    cell.final = {
      ...last,
      cls: 'BUDGET:timeout',
      side: 'model',
      score: 0,
      detail: `累计 ${timeouts} 次超时（≥${k}）→ 模型侧：时限预算内未完成`,
    }
    return
  }
  cell.final = { ...last, attemptsUsed: cell.attempts.length }
}
