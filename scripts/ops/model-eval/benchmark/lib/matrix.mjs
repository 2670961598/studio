/**
 * matrix.mjs —— 统计协议汇总（纯函数，零 IO）：覆盖 / 模型×任务 / 逐模型 / 配对比较 / 结论闸
 *
 * 输入 = mergeReports() 的格列表 + 原始 report 对象；输出 = 可直接 JSON 化的统计对象
 * （schema `model-eval-stats/v1`）。口径见 docs/quality/benchmark-business-eval.md §5。
 */
import { mean, median, percentileNearestRank, round4, summarizeScores, excludesZero } from './interval.mjs'

export const STATS_SCHEMA = 'model-eval-stats/v1'

/** 协议常量（与规范 §5 一致；CLI 可覆盖 minReps/formalReps 以做敏感性查看，但报告会照录实际值）。 */
export const PROTOCOL = Object.freeze({
  minReps: 2,
  formalReps: 3,
  retryMax: 2,
  timeoutRetriesToModelSide: 2,
  coverageMin: 0.6,
  facilityMissingMax: 0.1,
  detWeight: 0.7,
  subjectiveWeight: 0.3,
})

const isValid = (c) => c.final.side === 'sample' || c.final.side === 'model'
const SCORE_BOUNDS = Object.freeze({ lo: 0, hi: 1 })
const DIFF_BOUNDS = Object.freeze({ lo: -1, hi: 1 })
const uniq = (xs) => [...new Set(xs)]

/** 格的能力分：折入主观分后的 scoreFinal 优先，否则确定性分（模型侧失败 = 0，非数值 = 不计）。 */
export function scoreOf(cell) {
  const s = cell.final.scoreFinal ?? cell.final.score
  return typeof s === 'number' && Number.isFinite(s) ? s : null
}

/**
 * 把盲评分折进格分（只折有效样本；模型侧失败保持 0）。
 * @param {Array<object>} items [{ model, task, rep, total }]，total 为 0–12 的盲评总分（已跨评审平均）
 */
export function applyBlind(cells, items) {
  const index = new Map((items ?? []).map((it) => [`${it.model}|${it.task}|${it.rep}`, it]))
  let folded = 0
  for (const c of cells) {
    c.final.scoreFinal = undefined
    const it = index.get(c.key)
    if (it && c.final.side === 'sample' && typeof it.total === 'number') {
      c.final.scoreFinal = round4(PROTOCOL.detWeight * c.final.score + PROTOCOL.subjectiveWeight * (it.total / 12))
      c.final.blindTotal = it.total
      folded += 1
    }
  }
  return folded
}

/** 把评测台自带的 LLM 裁判分（0–10）折进格分——仅当运行带裁判且显式要求（裁判 ≠ 盲评，见规范 §3.6）；同源自评（judgeSelf）不折。 */
export function applyJudge(cells) {
  let folded = 0
  for (const c of cells) {
    const j = c.final.judgeScore
    if (typeof j === 'number' && c.final.judgeSelf !== true && c.final.side === 'sample' && c.final.scoreFinal === undefined) {
      c.final.scoreFinal = round4(PROTOCOL.detWeight * c.final.score + PROTOCOL.subjectiveWeight * (j / 10))
      folded += 1
    }
  }
  return folded
}

function countBy(xs, fn) {
  const out = {}
  for (const x of xs) {
    const k = String(fn(x))
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function pick(obj, keys) {
  const o = {}
  for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k]
  return o
}

/**
 * @param {Array<object>} reports 原始 report 对象（可带 __file = 文件名）
 * @param {Array<object>} cells mergeReports() 的输出
 */
export function buildStats(reports, cells, opts = {}) {
  const P = { ...PROTOCOL, ...opts }
  const sorted = [...(reports ?? [])].sort((a, b) => String(a.generatedAt ?? '').localeCompare(String(b.generatedAt ?? '')))
  const models = uniq(cells.map((c) => c.model)).sort()
  const tasks = uniq(cells.map((c) => c.task)).sort()

  const inputs = sorted.map((r) => ({
    file: r.__file ?? null,
    generatedAt: r.generatedAt ?? null,
    schema: r.schema ?? null,
    rows: Array.isArray(r.rows) ? r.rows.length : 0,
    config: pick(r.config, ['models', 'tasks', 'reps', 'timeoutMs', 'judge', 'skipUnavailable']),
  }))

  const avail = new Map()
  for (const r of sorted) {
    for (const a of r.availability ?? []) {
      if (a && typeof a.model === 'string') {
        avail.set(a.model, { model: a.model, available: a.available === true, errorClass: a.errorClass ?? null, reason: a.reason ?? null })
      }
    }
  }

  const byModelTask = []
  for (const model of models) {
    for (const task of tasks) {
      const cs = cells.filter((c) => c.model === model && c.task === task)
      if (cs.length === 0) continue
      const vs = cs.filter(isValid)
      const ss = summarizeScores(vs.map(scoreOf), SCORE_BOUNDS)
      byModelTask.push({
        model,
        task,
        planned: cs.length,
        n: ss.n,
        mean: ss.mean,
        min: ss.min,
        max: ss.max,
        ci95: ss.ci95,
        okCount: vs.filter((c) => c.final.cls === 'OK').length,
        zeroCount: vs.filter((c) => c.final.side === 'sample' && scoreOf(c) === 0).length,
        modelSide: countBy(vs.filter((c) => c.final.side === 'model'), (c) => c.final.cls),
        missingClasses: countBy(cs.filter((c) => !isValid(c)), (c) => c.final.cls),
        retried: cs.filter((c) => c.retried).length,
        triage: cs.filter((c) => c.final.triage).length,
      })
    }
  }
  const group = (model, task) => byModelTask.find((r) => r.model === model && r.task === task) ?? null

  const activeModels = models.filter((m) => cells.some((c) => c.model === m && isValid(c)))
  const sharedTasks = tasks.filter((t) => activeModels.length > 0 && activeModels.every((m) => (group(m, t)?.n ?? 0) > 0))

  const coverage = models.map((model) => {
    const cs = cells.filter((c) => c.model === model)
    const rows = byModelTask.filter((r) => r.model === model)
    const valid = rows.reduce((a, r) => a + r.n, 0)
    const a = avail.get(model) ?? null
    const tasksCovered = rows.filter((r) => r.n > 0).length
    const taskCoverage = tasks.length === 0 ? 0 : tasksCovered / tasks.length
    return {
      model,
      available: a?.available ?? null,
      errorClass: a?.errorClass ?? null,
      reason: a?.reason ?? null,
      planned: cs.length,
      valid,
      missing: cs.length - valid,
      cellCoverage: round4(cs.length === 0 ? 0 : valid / cs.length),
      tasksCovered,
      taskCoverage: round4(taskCoverage),
      eligible: a?.available === true && taskCoverage >= P.coverageMin,
    }
  })

  const byModel = models.map((model) => {
    const cs = cells.filter((c) => c.model === model)
    const vs = cs.filter(isValid)
    const ss = summarizeScores(vs.map(scoreOf), SCORE_BOUNDS)
    const done = vs.filter((c) => c.final.side === 'sample')
    const lat = done.map((c) => c.final.latencyMs).filter((x) => typeof x === 'number')
    const tok = done.map((c) => c.final.tokensTotal).filter((x) => typeof x === 'number')
    const rows = byModelTask.filter((r) => r.model === model && sharedTasks.includes(r.task) && r.n > 0)
    return {
      model,
      planned: cs.length,
      n: ss.n,
      mean: ss.mean,
      ci95: ss.ci95,
      meanAvailabilityView: cs.length === 0 ? null : round4(vs.reduce((a, c) => a + scoreOf(c), 0) / cs.length),
      passRate: ss.n === 0 ? null : round4(vs.filter((c) => c.final.cls === 'OK').length / ss.n),
      sharedTasks: rows.length,
      balancedMean: rows.length === 0 ? null : round4(mean(rows.map((r) => r.mean))),
      medianLatencyMs: round4(median(lat)),
      p90LatencyMs: percentileNearestRank(lat, 90),
      totalTokens: tok.reduce((a, b) => a + b, 0),
      failures: countBy(cs.filter((c) => c.final.cls !== 'OK'), (c) => c.final.cls),
      retriedCells: cs.filter((c) => c.retried).length,
    }
  })

  const pairs = []
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const a = models[i]
      const b = models[j]
      const perTask = []
      const diffs = []
      let nMin = Infinity
      for (const task of tasks) {
        const ra = group(a, task)
        const rb = group(b, task)
        if (ra === null || rb === null || ra.n === 0 || rb.n === 0) continue
        nMin = Math.min(nMin, ra.n, rb.n)
        const diff = round4(ra.mean - rb.mean)
        perTask.push({ task, diff, aMean: ra.mean, bMean: rb.mean, ahead: diff > 0 ? 'a' : diff < 0 ? 'b' : 'tie' })
        const ca = cells.filter((c) => c.model === a && c.task === task && isValid(c))
        const cb = cells.filter((c) => c.model === b && c.task === task && isValid(c))
        for (const x of ca) {
          const y = cb.find((c) => c.rep === x.rep)
          if (y && scoreOf(x) !== null && scoreOf(y) !== null) diffs.push(scoreOf(x) - scoreOf(y))
        }
      }
      const paired = summarizeScores(diffs, DIFF_BOUNDS)
      let verdict = 'no-overlap'
      if (perTask.length > 0) {
        if (!Number.isFinite(nMin) || nMin < P.formalReps) verdict = 'insufficient'
        else verdict = excludesZero(paired.ci95) ? 'distinguishable' : 'indistinguishable'
      }
      pairs.push({
        a,
        b,
        tasks: perTask.length,
        meanDiff: perTask.length === 0 ? null : round4(mean(perTask.map((r) => r.diff))),
        ahead: perTask.filter((r) => r.ahead === 'a').length,
        tie: perTask.filter((r) => r.ahead === 'tie').length,
        behind: perTask.filter((r) => r.ahead === 'b').length,
        paired,
        verdict,
        perTask,
      })
    }
  }

  const repsPlanned = byModelTask.reduce((m, r) => Math.max(m, r.planned), 0)
  const level = repsPlanned >= P.formalReps ? 'formal' : 'smoke'
  // 结论闸只看设施侧 / 评测台侧缺格；模型侧失败是有效观测（计 0），不阻塞结论
  const missingRatio = cells.length === 0 ? 1 : cells.filter((c) => !isValid(c) && c.final.side !== 'model').length / cells.length
  const conclusionAllowed = level === 'formal' && missingRatio <= P.facilityMissingMax && activeModels.length >= 2
  const decision = {
    level,
    repsPlanned,
    activeModels: activeModels.length,
    missingRatio: round4(missingRatio),
    conclusionAllowed,
    note: level === 'smoke'
      ? `冒烟口径（reps=${repsPlanned} < ${P.formalReps}）：只验证可运行性与统计口径，不对模型优劣下结论`
      : conclusionAllowed
        ? '正式口径：可按配对差区间读结论（区间含 0 = 不可辨）'
        : `正式口径但缺格比例 ${round4(missingRatio)} 超过 ${P.facilityMissingMax} 或有效模型不足 2：先补跑设施侧缺格`,
  }

  return {
    schema: STATS_SCHEMA,
    protocol: P,
    inputs,
    availability: [...avail.values()],
    models,
    tasks,
    sharedTasks,
    byModelTask,
    coverage,
    byModel,
    pairs,
    decision,
  }
}
