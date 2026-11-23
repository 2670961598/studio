/**
 * report.mjs —— 汇总与呈现（纯函数）：report.json 的 summary/roles + report.md 渲染
 *
 * 口径（docs/quality/model-eval.md §3、§7）：
 *   - 格分 cell = 0.7×确定性分 + 0.3×(裁判分/10)（裁判开启且该格有分）；否则 = 确定性分；
 *     被测调用失败（超时/auth/quota…）记 0；评测台自身故障（harness、判分脚本异常）不计入（null）。
 *   - 角色 = 任务加权平均；覆盖 <60% 或不可用 → 不进入推荐（排最后、注明原因）；
 *     patrol 档额外按 token 量扣 0.05×（该模型 tokens / 矩阵最大 tokens）体现成本敏感。
 *   - 排序只基于本矩阵实际跑到的格子；样本小、裁判有偏等局限固定附在报告末尾。
 */
import { ROLE_WEIGHTS, JUDGE_WEIGHT, COVERAGE_MIN, COST_PENALTY, ROLE_LABELS, ALL_TASKS } from './roles.mjs'

const round = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)
const mean = (xs) => (xs.length === 0 ? null : round(xs.reduce((s, x) => s + x, 0) / xs.length, 3))

/** 一格的标量分（见文件头口径）。 */
export function cellScore(row, { judgeEnabled }) {
  if (row.status === 'skipped') return null
  if (row.errorClass === 'harness' || row.checkError) return null // 评测台自身故障：不计入
  if (!row.ok) return 0
  if (row.deterministicScore === null || row.deterministicScore === undefined) return null
  if (judgeEnabled && typeof row.judgeScore === 'number') {
    return round((1 - JUDGE_WEIGHT) * row.deterministicScore + JUDGE_WEIGHT * (row.judgeScore / 10), 3)
  }
  return row.deterministicScore
}

function countBy(rows, keyOf) {
  const out = {}
  for (const r of rows) {
    const k = keyOf(r)
    if (k === null || k === undefined) continue
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

/** 逐模型汇总（键=模型引用）。 */
export function summarizeModels(report) {
  const byModel = {}
  const judgeEnabled = report.judge?.enabled === true
  for (const m of report.config.models) byModel[m] = []
  for (const row of report.rows) (byModel[row.model] ??= []).push(row)
  const out = {}
  for (const [model, rows] of Object.entries(byModel)) {
    const ran = rows.filter((r) => r.status !== 'skipped')
    const scored = ran.filter((r) => cellScore(r, { judgeEnabled }) !== null)
    // 被测调用失败（超时/auth/quota…）的格子：算 0 分、不算通过；空工位上的检查明细不进「未过项」统计
    const okRows = scored.filter((r) => r.ok)
    const avail = report.availability.find((a) => a.model === model)
    const byTask = {}
    for (const r of scored) (byTask[r.task] ??= []).push(cellScore(r, { judgeEnabled }))
    out[model] = {
      model,
      available: avail?.available ?? null,
      unavailableReason: avail?.reason ?? null,
      cellsPlanned: rows.length,
      cellsRun: scored.length,
      cellsSkipped: rows.length - ran.length,
      cellsBroken: ran.length - scored.length, // 评测台自身故障格（harness / 判分脚本异常）
      passCount: okRows.filter((r) => r.deterministicPass === true).length,
      avgDetScore: mean(scored.map((r) => (r.ok ? r.deterministicScore : 0))),
      avgJudgeScore: mean(okRows.map((r) => r.judgeScore).filter((v) => typeof v === 'number')),
      avgLatencyMs: mean(okRows.map((r) => r.latencyMs).filter((v) => typeof v === 'number')),
      totalTokens: scored.reduce((s, r) => s + (r.tokensTotal ?? 0), 0),
      totalCostUsd: scored.some((r) => r.costUsd !== null) ? round(scored.reduce((s, r) => s + (r.costUsd ?? 0), 0), 4) : null,
      failures: countBy(ran.filter((r) => !r.ok), (r) => r.errorClass),
      failedChecks: countBy(okRows, (r) => (r.failedChecks.length > 0 ? r.failedChecks.join('+') : null)),
      byTask: Object.fromEntries(Object.entries(byTask).map(([t, xs]) => [t, mean(xs)])),
    }
  }
  return out
}

/** 三档角色排序。 */
export function rankRoles(report, summaries = summarizeModels(report)) {
  const tasks = report.config.tasks
  const entries = Object.values(summaries)
  const maxTokens = Math.max(1, ...entries.map((e) => e.totalTokens))
  const roles = Object.keys(ROLE_WEIGHTS).map((role) => {
    const weights = ROLE_WEIGHTS[role]
    const ranking = entries.map((e) => {
      const covered = tasks.filter((t) => typeof e.byTask[t] === 'number')
      const wSum = covered.reduce((s, t) => s + (weights[t] ?? 1), 0)
      const quality = wSum === 0 ? null : round(covered.reduce((s, t) => s + (weights[t] ?? 1) * e.byTask[t], 0) / wSum, 3)
      const coverage = tasks.length === 0 ? 0 : round(covered.length / tasks.length, 2)
      const costPenalty = role === 'patrol' ? round(COST_PENALTY * (e.totalTokens / maxTokens), 3) : 0
      const score = quality === null ? null : round(quality - costPenalty, 3)
      const strong = covered.filter((t) => e.byTask[t] >= 0.85)
      const weak = covered.filter((t) => e.byTask[t] < 0.6)
      let eligible = false
      let note
      if (e.available !== true) {
        note = `不可用（${e.unavailableReason ?? '未预探'}）`
      } else if (coverage < COVERAGE_MIN) {
        note = `覆盖不足（${covered.length}/${tasks.length}）`
      } else {
        eligible = true
        const parts = [`质量 ${quality}，覆盖 ${covered.length}/${tasks.length}，均时延 ${e.avgLatencyMs === null ? '?' : `${Math.round(e.avgLatencyMs / 100) / 10}s`}`]
        if (role === 'patrol') parts.push(`token 成本扣 ${costPenalty}`)
        if (strong.length > 0) parts.push(`强项 ${strong.join('、')}`)
        if (weak.length > 0) parts.push(`弱项 ${weak.join('、')}`)
        note = parts.join('；')
      }
      return { model: e.model, eligible, score, quality, coverage, costPenalty, avgLatencyMs: e.avgLatencyMs, totalTokens: e.totalTokens, strong, weak, note }
    })
    ranking.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      const qa = a.score ?? -1
      const qb = b.score ?? -1
      if (qa !== qb) return qb - qa
      const la = a.avgLatencyMs ?? Infinity
      const lb = b.avgLatencyMs ?? Infinity
      if (la !== lb) return la - lb
      return a.model < b.model ? -1 : 1
    })
    return { role, label: ROLE_LABELS[role], ranking }
  })
  return roles
}

/** 给 report 对象补 summary/roles（就地加字段并返回）。 */
export function summarize(report) {
  report.summary = summarizeModels(report)
  report.roles = rankRoles(report, report.summary)
  return report
}

const fmtTokens = (n) => (typeof n !== 'number' ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const fmtSec = (ms) => (typeof ms !== 'number' ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const fmtScore = (n) => (typeof n !== 'number' ? '—' : n.toFixed(1))
const cell = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function cellMarkdown(rows) {
  const ran = rows.filter((r) => r.status !== 'skipped')
  if (ran.length === 0) return '⏭ 跳过'
  const broken = ran.filter((r) => r.errorClass === 'harness' || r.checkError)
  if (broken.length === ran.length) return `⚠️ 评测台故障（${broken[0].errorDetail ?? broken[0].checkError}）`
  const scored = ran.filter((r) => r.errorClass !== 'harness' && !r.checkError)
  const okRows = scored.filter((r) => r.ok)
  const pass = okRows.filter((r) => r.deterministicPass === true).length
  const failed = scored.filter((r) => !r.ok)
  const icon = failed.length === scored.length ? '💥' : pass === scored.length ? '✅' : '❌'
  const det = mean(scored.map((r) => (r.ok ? r.deterministicScore : 0)))?.toFixed(2) ?? '—'
  const judge = mean(okRows.map((r) => r.judgeScore).filter((v) => typeof v === 'number'))
  const lat = mean(okRows.map((r) => r.latencyMs).filter((v) => typeof v === 'number'))
  const tokens = scored.reduce((s, r) => s + (r.tokensTotal ?? 0), 0) / scored.length
  const parts = [det]
  if (judge !== null) parts.push(`判 ${judge.toFixed(1)}`)
  parts.push(fmtSec(lat))
  parts.push(fmtTokens(Math.round(tokens)))
  let text = `${icon} ${pass}/${scored.length} · ${parts.join(' · ')}`
  const failedChecks = [...new Set(okRows.flatMap((r) => r.failedChecks))].slice(0, 3)
  if (failed.length > 0) text += `<br>失败：${[...new Set(failed.map((r) => r.reason ?? r.errorClass))].map(cell).join('；').slice(0, 160)}`
  else if (failedChecks.length > 0) text += `<br>未过：${failedChecks.join(', ')}`
  return text
}

/** 渲染 report.md。 */
export function renderMarkdown(report) {
  const { config, availability, judge, summary, roles, warnings } = report
  const out = []
  out.push('# 模型能力评测报告（业务向）', '')
  out.push(`- 生成时间：${report.generatedAt}（schema \`${report.schema}\`）`)
  out.push(`- 被测矩阵：${config.models.join('、')}；任务：${config.tasks.join('、')}；重复：${config.reps}；单次超时：${config.timeoutMs}ms`)
  out.push(`- 裁判：${judge.enabled ? `${judge.model}（${judge.available === true ? '可用' : '不可用/未验证'}）` : '关闭（仅确定性判分）'}`)
  out.push('- 产物目录：本报告所在目录（工位 work/、事件流 logs/、overlay overlays/；机器可读 report.json 同目录；绝对路径见 report.json 的 outDir）')
  out.push(`- 读法：✅ 确定性检查全过｜❌ 有未过项｜💥 被测调用失败｜⏭ 预探不可用跳过｜⚠️ 评测台自身故障或判分脚本异常（不计入模型）。格内：确定性分（0-1）· 判分（0-10）· 均时延 · 均 tokens`, '')
  out.push('## 1. 可用性预探', '', '| 模型 | 可用 | 类目 | 原因 | 预探时延 |', '|---|---|---|---|---|')
  for (const a of availability) out.push(`| ${cell(a.model)} | ${a.available ? '是' : '否'} | ${cell(a.errorClass ?? 'ok')} | ${cell(a.reason ?? '—')} | ${fmtSec(a.latencyMs)} |`)
  out.push('')

  out.push('## 2. 结果矩阵（每格：通过数/运行数 · 确定性分 · 判分 · 均时延 · 均 tokens）', '')
  const byModel = {}
  for (const row of report.rows) (byModel[row.model] ??= []).push(row)
  out.push(`| 模型 | ${config.tasks.join(' | ')} | 通过/运行 |`, `|---|${config.tasks.map(() => '---').join('|')}|---|`)
  for (const m of config.models) {
    const rows = byModel[m] ?? []
    const s = summary[m]
    out.push(`| ${cell(m)} | ${config.tasks.map((t) => cellMarkdown(rows.filter((r) => r.task === t))).join(' | ')} | ${s.passCount}/${s.cellsRun} |`)
  }
  out.push('')

  out.push('## 3. 逐模型汇总', '', '| 模型 | 运行格 | 确定性通过 | 平均确定性分 | 平均判分 | 平均时延 | 总 tokens | 估算成本 | 失败类目 |', '|---|---|---|---|---|---|---|---|---|')
  for (const s of Object.values(summary)) {
    const failures = Object.entries(s.failures).map(([k, v]) => `${k}×${v}`).join(' ') || '—'
    out.push(`| ${cell(s.model)} | ${s.cellsRun}${s.cellsSkipped ? `（跳过 ${s.cellsSkipped}）` : ''} | ${s.passCount} | ${fmtScore(s.avgDetScore)} | ${fmtScore(s.avgJudgeScore)} | ${fmtSec(s.avgLatencyMs)} | ${fmtTokens(s.totalTokens)} | ${s.totalCostUsd === null ? '—' : `$${s.totalCostUsd}`} | ${cell(failures)} |`)
  }
  out.push('')

  out.push('## 4. 逐任务明细', '', '| 模型 | 任务 | rep | 状态 | 确定性分 | 未过检查 | 判分 | 判分理由 | 时延 | tokens | 错误 |', '|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of report.rows) {
    out.push(`| ${cell(r.model)} | ${r.task} | ${r.rep} | ${r.checkError ? `${r.status}（判分异常）` : r.status} | ${r.deterministicScore === null ? '—' : r.deterministicScore.toFixed(2)} | ${cell(r.failedChecks.join(', ') || '—')} | ${r.judgeScore === null ? '—' : r.judgeScore}${r.judgeSelf ? '（自评）' : ''} | ${cell(r.judgeReason ?? r.judgeError ?? '—')} | ${fmtSec(r.latencyMs)} | ${fmtTokens(r.tokensTotal)} | ${cell(r.reason ?? r.checkError ?? '—')} |`)
  }
  out.push('')

  const subset = config.tasks.filter((t) => ALL_TASKS.includes(t)).length < ALL_TASKS.length
  const scope = subset ? `本次只跑 ${config.tasks.length} 个任务（${config.tasks.join('、')}）：排序只代表这些任务上的表现，不构成完整档位结论。` : ''
  out.push('## 5. 业务适配建议', '', `排序口径：格分 = 0.7×确定性 + 0.3×裁判/10（裁判关闭时只用确定性）；角色=任务加权；覆盖 <60% 或不可用者不进推荐、列于末位。样本小，结论只作选型起点，正式对比请 \`--reps 3\`。${scope}`, '')
  for (const role of roles) {
    out.push(`### ${role.label}`, '')
    role.ranking.forEach((e, i) => {
      out.push(`${i + 1}. **${e.model}** —— ${e.eligible ? '' : '（不推荐）'}${e.note}`)
    })
    out.push('')
  }

  out.push('## 6. 警告与局限', '')
  for (const w of warnings) out.push(`- ${w}`)
  out.push('- 样本小：6 任务 × reps 次，单次抖动可翻转相邻名次；通过率看趋势不看小数点。')
  out.push('- 裁判有偏：LLM 裁判偏好冗长/工整的产物，且可能与被测同源；裁判分只占格分 30%，对形式分敏感的结论请核对确定性项。')
  out.push('- 成本为估算：仅在提供 `--prices` 时按 tokens 估算，未计缓存折扣与重试；时延含 dsh 启动开销。')
  out.push('- 隔离有限：被测模型的工具不在内层沙箱里（headless profile 为 danger-full-access），只靠任务书约束「只读写当前目录」；请勿在含敏感数据的机器上无人值守跑。')
  out.push('')
  return `${out.join('\n')}\n`
}
