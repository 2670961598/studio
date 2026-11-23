/**
 * render-stats.mjs —— 统计对象（buildStats 输出）→ stats.md（纯函数，零 IO）
 */
const NA = '—'

export function fmt(x, digits = 2) {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) : NA
}

export function fmtMs(x) {
  return typeof x === 'number' && Number.isFinite(x) ? `${(x / 1000).toFixed(1)}s` : NA
}

export function fmtTokens(x) {
  return typeof x === 'number' && Number.isFinite(x) ? `${(x / 1000).toFixed(1)}k` : NA
}

export function ciText(ci) {
  if (!ci || ci.method === 'none') return 'n<2，不给区间'
  if (ci.method === 'range') return `极差 [${fmt(ci.lo)}, ${fmt(ci.hi)}]`
  return `t 95% [${fmt(ci.lo)}, ${fmt(ci.hi)}]${ci.approximate ? '（正态近似）' : ''}`
}

/** {类目: 次数} → "TASK_FAIL×2, PROVIDER_ERROR:server×1"；空 → "—" */
export function failuresText(obj) {
  const es = Object.entries(obj ?? {}).filter(([, v]) => v > 0).sort(([a], [b]) => a.localeCompare(b))
  return es.length === 0 ? NA : es.map(([k, v]) => `${k}×${v}`).join(', ')
}

function cell(text) {
  return String(text ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function clip(text, max = 80) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function renderStatsMarkdown(s) {
  const L = []
  const push = (line = '') => L.push(line)
  // 预探失败且零有效格的模型：整模型都是设施侧缺格，只在 §2 单列，不进 §3–§5（补齐后重算）
  const dead = new Map(s.coverage.filter((c) => c.valid === 0 && c.available === false).map((c) => [c.model, c.errorClass]))
  const alive = (model) => !dead.has(model)
  push('# 模型评测统计（业务向基准 · 统计协议产物）')
  push()
  push(`- 口径：schema \`${s.schema}\`；结论闸 = **${s.decision.level === 'smoke' ? '冒烟' : '正式'}** —— ${s.decision.note}`)
  push(`- 批次：${s.inputs.length} 份报告，合计 ${s.models.length} 模型 × ${s.tasks.length} 任务（${s.tasks.join(', ') || NA}）；reps=${s.decision.repsPlanned}；设施侧/评测台侧缺格比例 ${fmt(s.decision.missingRatio)}`)
  push('- 能力口径 = 设施侧/评测台侧缺格**不计分**（重试后仍缺则单列）；可用性口径 = 缺格按 0 计。模型侧失败（拒答 / 预算内未完成）两种口径都计 0。')
  if (s.fingerprints) {
    const state = s.fingerprints.consistent === true ? '各批次一致' : s.fingerprints.consistent === false ? '**各批次不一致（见 §6）**' : '未提供批次指纹（只留了跑前参照）'
    push(`- 控制变量指纹：harness \`${s.fingerprints.reference.harness}\` / 全树 \`${s.fingerprints.reference.all}\`；${state}`)
  }
  push()
  push('## 1. 输入批次')
  push()
  push('| # | 报告 | 生成时间 | 格数 | reps | 单格超时 | 裁判 |')
  push('|---|---|---|---|---|---|---|')
  s.inputs.forEach((r, i) => {
    push(`| ${i + 1} | ${cell(r.file)} | ${cell(r.generatedAt)} | ${r.rows} | ${r.config?.reps ?? NA} | ${fmtMs(r.config?.timeoutMs)} | ${cell(r.config?.judge ?? 'none')} |`)
  })
  push()
  push('## 2. 可用性与覆盖')
  push()
  push('| 模型 | 预探可用 | 计划格 | 有效格 | 缺格 | 格覆盖 | 任务覆盖 | 可进推荐（≥60%） |')
  push('|---|---|---|---|---|---|---|---|')
  for (const c of s.coverage) {
    const avail = c.available === null ? NA : c.available ? '是' : `否（${cell(c.errorClass)}）`
    push(`| ${cell(c.model)} | ${avail} | ${c.planned} | ${c.valid} | ${c.missing} | ${fmt(c.cellCoverage * 100, 0)}% | ${c.tasksCovered}/${s.tasks.length} | ${c.eligible ? '是' : '否'} |`)
  }
  if (dead.size > 0) {
    push()
    push(`- 未产生样本（预探失败，整模型设施侧缺格，不进 §3–§5，补齐后重算）：${[...dead].map(([m, e]) => `${cell(m)}（${e ?? NA}）`).join('、')}`)
  }
  push()
  push('## 3. 模型 × 任务（能力口径；有效格的确定性分）')
  push()
  push('| 模型 | 任务 | 有效/计划 | 均值 | 95% 区间 | 全过 | 零分 | 模型侧失败 | 缺格类目 | 重试格 |')
  push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of s.byModelTask) {
    if (!alive(r.model)) continue
    push(`| ${cell(r.model)} | ${r.task} | ${r.n}/${r.planned} | ${fmt(r.mean)} | ${ciText(r.ci95)} | ${r.okCount} | ${r.zeroCount} | ${failuresText(r.modelSide)} | ${failuresText(r.missingClasses)} | ${r.retried} |`)
  }
  push()
  push(`## 4. 逐模型汇总（共同任务 = ${s.sharedTasks.join(', ') || NA}）`)
  push()
  push('| 模型 | 有效格 | 能力均值 | 95% 区间 | 可用性口径均值 | 全过率 | 共同任务均衡均值 | 时延中位 / p90 | tokens | 失败类目 |')
  push('|---|---|---|---|---|---|---|---|---|---|')
  for (const m of s.byModel) {
    if (!alive(m.model)) continue
    push(`| ${cell(m.model)} | ${m.n} | ${fmt(m.mean)} | ${ciText(m.ci95)} | ${fmt(m.meanAvailabilityView)} | ${m.passRate === null ? NA : `${fmt(m.passRate * 100, 0)}%`} | ${fmt(m.balancedMean)} | ${fmtMs(m.medianLatencyMs)} / ${fmtMs(m.p90LatencyMs)} | ${fmtTokens(m.totalTokens)} | ${failuresText(m.failures)} |`)
  }
  push()
  push('## 5. 配对比较（a − b，按共同任务的格均值；区间 = 同任务同 rep 的配对差）')
  push()
  push('| a | b | 共同任务 | 平均差 | 领先 / 平 / 落后 | 配对差 95% 区间 | 判读 |')
  push('|---|---|---|---|---|---|---|')
  for (const p of s.pairs) {
    if (!alive(p.a) || !alive(p.b)) continue
    const verdict = { 'no-overlap': '无共同任务', insufficient: '样本不足（冒烟不下结论）', distinguishable: '差异可辨（区间不含 0）', indistinguishable: '不可辨（区间含 0）' }[p.verdict] ?? p.verdict
    push(`| ${cell(p.a)} | ${cell(p.b)} | ${p.tasks} | ${fmt(p.meanDiff)} | ${p.ahead} / ${p.tie} / ${p.behind} | ${ciText(p.paired.ci95)} | ${verdict} |`)
  }
  push()
  if (s.pairs.some((p) => p.perTask.length > 0)) {
    push('逐任务差（正 = a 领先）：')
    push()
    for (const p of s.pairs) {
      if (p.perTask.length === 0 || !alive(p.a) || !alive(p.b)) continue
      push(`- ${cell(p.a)} − ${cell(p.b)}：${p.perTask.map((t) => `${t.task} ${t.diff >= 0 ? '+' : ''}${fmt(t.diff)}`).join('；')}`)
    }
    push()
  }
  if (s.availability.some((a) => a.available !== true)) {
    push('不可用原因（评测台已脱敏）：')
    push()
    for (const a of s.availability.filter((x) => x.available !== true)) {
      push(`- ${cell(a.model)}：${cell(clip(a.reason, 160))}`)
    }
    push()
  }
  if (s.triage.length > 0) {
    push('须人工复核归因的格：')
    push()
    for (const t of s.triage) push(`- ${cell(t)}`)
    push()
  }
  push('## 6. 口径说明')
  push()
  push(`- 协议：冒烟 reps ≥ ${s.protocol.minReps}；正式 reps ≥ ${s.protocol.formalReps}；设施侧失败重试 ≤ ${s.protocol.retryMax}；同格累计 ${s.protocol.timeoutRetriesToModelSide} 次超时判模型侧；推荐线 = 任务覆盖 ≥ ${s.protocol.coverageMin * 100}%；正式结论还要求设施侧缺格比例 ≤ ${s.protocol.facilityMissingMax * 100}%。`)
  push('- 区间：n=1 不给；n=2 只报极差；n≥3 报双侧 95% t 区间。样本小、区间宽是常态——区间含 0 只说明「分辨不出」，不说明「一样」。')
  push(`- 折分：${s.scoring.note}`)
  if (s.fingerprints?.mismatches?.length > 0) {
    push('- 指纹差异（控制变量未对齐，跨批次比较须谨慎）：')
    for (const m of s.fingerprints.mismatches) push(`  - ${cell(m.file)}：${cell(m.diffs.join('；') || '—')}`)
  }
  push()
  return L.join('\n')
}
