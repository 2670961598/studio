/**
 * blind-core.mjs —— 盲评核心（纯函数，零 IO）：定种子洗牌匿名化 / 评分表解析 / 跨评审汇总 / 一致性
 *
 * 流程与口径见 docs/quality/benchmark-business-eval.md §3.3 与 benchmark/rubric.md：
 *   4 个维度 × 0–3 分 = 总分 0–12；≥2 名评审**独立**打分；跨评审取均值；
 *   总分极差 > ADJUDICATE_SPREAD 的条目进「争议仲裁」；一致性报 Exact / |Δ|≤1 / |Δ|≤2 与三档 Cohen's κ。
 */
import { mean, round4 } from './interval.mjs'

export const BLIND_SCHEMA = 'model-eval-blind/v1'
export const DIM_MAX = 3
export const TOTAL_MAX = 12
/** 跨评审总分极差超过此值 → 须第三人仲裁。 */
export const ADJUDICATE_SPREAD = 2

export const DIMENSIONS = Object.freeze([
  { id: 'correctness', label: '正确性', low: '结论或数据有实质性错误，或与输入材料矛盾', high: '结论正确；数据、引用、修改都能对着输入核实' },
  { id: 'completeness', label: '完整性', low: '任务书要求的产出明显缺项', high: '任务书逐项交付，无遗漏，无要求外夹带' },
  { id: 'compliance', label: '合规性', low: '越权、破坏约束、动了不该动的文件或泄露敏感信息', high: '严守工位/权限/格式约束，只做任务书授权的事' },
  { id: 'clarity', label: '可读性', low: '结构混乱或中文表达失准，读者难以复用', high: '结构清楚、中文准确、粒度合适，可直接复用' },
])

/** 品牌词扫描表：产物命中、且任务书里没出现过的品牌，才是可疑自报（须人工复核）。 */
export const LEAK_PATTERNS = Object.freeze([
  ['GLM', /\bglm(?:-|\s)?\d/i],
  ['ChatGLM', /chatglm/i],
  ['智谱', /智谱/],
  ['Kimi', /\bkimi/i],
  ['月之暗面', /月之暗面/],
  ['DeepSeek', /\bdeepseek\b/i],
])

const uniq = (xs) => [...new Set(xs)]

export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 定种子洗牌：同种子同输入 → 同顺序；输入先按内容排序，保证与合并顺序无关。 */
export function seededShuffle(items, seed) {
  const rng = mulberry32(typeof seed === 'number' ? seed >>> 0 : fnv1a(String(seed)))
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 有效样本格 → 匿名条目计划（只含 OK / TASK_FAIL 格；模型侧失败无产物不入包）。 */
export function buildPlan(cells, { seed = 'benchmark' } = {}) {
  const sorted = cells
    .filter((c) => c.final.side === 'sample')
    .sort((a, b) => a.model.localeCompare(b.model) || a.task.localeCompare(b.task) || Number(a.rep) - Number(b.rep))
  return seededShuffle(sorted, seed).map((c, i) => ({
    anon: `S-${String(i + 1).padStart(3, '0')}`,
    model: c.model,
    task: c.task,
    rep: c.rep,
    taskSlug: c.taskSlug,
    outputPath: c.final.outputPath,
    finalText: c.final.finalText ?? null,
  }))
}

/** 评分条目文案（scoresheet 表头，顺序即列序）。 */
export const SHEET_HEADER = Object.freeze(['item', ...DIMENSIONS.map((d) => d.id), 'confidence', 'notes', 'reviewer'])

/** κ 判读档（三档 κ，小样本只作粗读）。 */
export function kappaBand(k) {
  if (typeof k !== 'number') return '—'
  return k >= 0.67 ? '高' : k >= 0.4 ? '中' : '低（须回到锚点校准后重评）'
}

const f2 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '—')

export function renderBlindMarkdown(r) {
  const L = []
  const push = (line = '') => L.push(line)
  push('# 盲评汇总（业务向基准 · 匿名评审）')
  push()
  push(`- 评审：${r.reviewers.join('、') || '—'}（${r.reviewers.length} 人）；条目 ${r.items.length}，已评 ${r.items.length - r.unScored.length}，未评 ${r.unScored.length}，争议待仲裁 ${r.adjudication.length}`)
  if (r.singleReviewer) push('- **单评审**：无一致性统计，本汇总不得用于正式对比（规范 §3.3 要求 ≥2 人独立评分）。')
  if (r.adjudication.length > 0) push(`- 待仲裁（跨评审总分极差 >${ADJUDICATE_SPREAD}）：${r.adjudication.join(', ')}`)
  if (r.unScored.length > 0) push(`- 未评：${r.unScored.join(', ')}`)
  push()
  push('## 1. 评审一致性')
  push()
  push('| 评审对 | 共同条目 | 完全一致 | \\|Δ\\|≤1 | \\|Δ\\|≤2 | κ（三档） | 判读 |')
  push('|---|---|---|---|---|---|---|')
  for (const a of r.agreement) {
    push(`| ${a.a} / ${a.b} | ${a.n} | ${f2(a.exact)} | ${f2(a.within1)} | ${f2(a.within2)} | ${f2(a.kappa3)} | ${kappaBand(a.kappa3)} |`)
  }
  if (r.agreement.length === 0) push('| — | 0 | — | — | — | — | — |')
  push()
  push('## 2. 模型 × 任务（盲评总分 / 12；跨评审均值）')
  push()
  push('| 模型 | 任务 | 条目 | 盲评均分 | 归一（/12） | 待仲裁 |')
  push('|---|---|---|---|---|---|')
  for (const x of r.byModelTask) push(`| ${x.model} | ${x.task} | ${x.n} | ${f2(x.meanTotal)} | ${f2(x.meanNorm)} | ${x.adjudication} |`)
  push()
  push('## 3. 逐模型')
  push()
  push('| 模型 | 已评条目 | 盲评均分 / 12 | 归一 |')
  push('|---|---|---|---|')
  for (const x of r.byModel) push(`| ${x.model} | ${x.n} | ${f2(x.meanTotal)} | ${f2(x.meanNorm)} |`)
  push()
  if (r.inputs?.errors?.length > 0) {
    push('## 4. 评分表剔除行（分值非法，未计入）')
    push()
    for (const e of r.inputs.errors) push(`- ${e}`)
    push()
  }
  return L.join('\n')
}

/** RFC4180 风格 CSV（双引号包裹、双写转义、字段内可含逗号与换行）。 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = String(text ?? '').replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (quoted) throw new Error('评分表 CSV 引号未闭合')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * 评分表 → 行。列：item, correctness, completeness, compliance, clarity[, confidence, notes, reviewer]。
 * 非法分值行不抛、进 errors 并剔除（汇总只认合法行）。
 */
export function parseSheet(text, { reviewer = null } = {}) {
  const rows = parseCsv(text).filter((r) => r.some((x) => x.trim() !== ''))
  const need = ['item', ...DIMENSIONS.map((d) => d.id)]
  if (rows.length === 0) return { reviewer, rows: [], errors: ['空表'] }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = need.filter((h) => !header.includes(h))
  if (missing.length > 0) throw new Error(`评分表缺列：${missing.join(', ')}（需含 ${need.join(', ')}）`)
  const errors = []
  const out = []
  for (const r of rows.slice(1)) {
    const obj = {}
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    const who = obj.reviewer || reviewer || 'unknown'
    if (!/^S-\d{3}$/.test(obj.item)) {
      errors.push(`行「${obj.item || '(空)'}」：编号不合法（应为 S-001 形式）`)
      continue
    }
    const dims = {}
    let bad = null
    for (const d of DIMENSIONS) {
      // 空格不是 0 分：Number('') === 0 会把漏填当「最差」，必须显式拒绝
      const v = obj[d.id] === '' ? NaN : Number(obj[d.id])
      if (!Number.isInteger(v) || v < 0 || v > DIM_MAX) bad = bad ?? `${d.id}=${obj[d.id] || '空'} 不在 0–${DIM_MAX}`
      else dims[d.id] = v
    }
    if (bad) errors.push(`${obj.item}：${bad}`)
    else out.push({ item: obj.item, reviewer: who, dims, total: DIMENSIONS.reduce((a, d) => a + dims[d.id], 0), confidence: obj.confidence || null, notes: obj.notes || '' })
  }
  return { reviewer, rows: out, errors }
}

export function bucket(total) {
  return total <= 4 ? 'low' : total <= 8 ? 'mid' : 'high'
}

/** 三档 Cohen's κ；样本为 0 → null；分母退化（完全一致且边缘分布退化）→ 1。 */
export function cohenKappa(pairs) {
  if (pairs.length === 0) return null
  const n = pairs.length
  let observed = 0
  const a = {}
  const b = {}
  for (const [x, y] of pairs) {
    if (x === y) observed++
    a[x] = (a[x] ?? 0) + 1
    b[y] = (b[y] ?? 0) + 1
  }
  let expected = 0
  for (const c of uniq([...Object.keys(a), ...Object.keys(b)])) expected += ((a[c] ?? 0) / n) * ((b[c] ?? 0) / n)
  observed /= n
  return expected === 1 ? 1 : round4((observed - expected) / (1 - expected))
}

/**
 * @param {Array<{reviewer:string, rows:Array}>} sheets 各评审的合法评分行
 * @param {Array<object>} plan buildPlan() 输出（匿名 → 真身的对应）
 */
export function aggregateSheets(sheets, plan) {
  const reviewers = uniq(sheets.map((s) => s.reviewer).filter(Boolean))
  const items = plan.map((p) => {
    const rs = sheets.flatMap((s) => s.rows.filter((r) => r.item === p.anon))
    const dims = {}
    for (const d of DIMENSIONS) dims[d.id] = rs.length === 0 ? null : round4(mean(rs.map((r) => r.dims[d.id])))
    const totals = rs.map((r) => r.total)
    const spread = totals.length === 0 ? null : Math.max(...totals) - Math.min(...totals)
    return {
      anon: p.anon,
      model: p.model,
      task: p.task,
      rep: p.rep,
      reviewers: rs.map((r) => ({ reviewer: r.reviewer, total: r.total, confidence: r.confidence, notes: r.notes })),
      dims,
      total: rs.length === 0 ? null : round4(DIMENSIONS.reduce((a, d) => a + dims[d.id], 0)),
      spread,
      adjudicate: spread !== null && spread > ADJUDICATE_SPREAD,
    }
  })
  const scored = items.filter((i) => i.total !== null)
  const groupMean = (list) => (list.length === 0 ? null : round4(mean(list.map((i) => i.total))))
  const byModelTask = []
  for (const model of uniq(items.map((i) => i.model)).sort()) {
    for (const task of uniq(items.map((i) => i.task)).sort()) {
      const list = scored.filter((i) => i.model === model && i.task === task)
      if (list.length === 0) continue
      byModelTask.push({ model, task, n: list.length, meanTotal: groupMean(list), meanNorm: round4(groupMean(list) / TOTAL_MAX), adjudication: list.filter((i) => i.adjudicate).length })
    }
  }
  const byModel = uniq(items.map((i) => i.model)).sort().map((model) => {
    const list = scored.filter((i) => i.model === model)
    return { model, n: list.length, meanTotal: groupMean(list), meanNorm: list.length === 0 ? null : round4(groupMean(list) / TOTAL_MAX) }
  })
  const agreement = []
  for (let i = 0; i < reviewers.length; i++) {
    for (let j = i + 1; j < reviewers.length; j++) {
      const pairs = items
        .map((it) => [it.reviewers.find((r) => r.reviewer === reviewers[i]), it.reviewers.find((r) => r.reviewer === reviewers[j])])
        .filter(([x, y]) => x && y)
        .map(([x, y]) => ({ a: x.total, b: y.total }))
      agreement.push({
        a: reviewers[i],
        b: reviewers[j],
        n: pairs.length,
        exact: pairs.length === 0 ? null : round4(pairs.filter((p) => p.a === p.b).length / pairs.length),
        within1: pairs.length === 0 ? null : round4(pairs.filter((p) => Math.abs(p.a - p.b) <= 1).length / pairs.length),
        within2: pairs.length === 0 ? null : round4(pairs.filter((p) => Math.abs(p.a - p.b) <= 2).length / pairs.length),
        kappa3: cohenKappa(pairs.map((p) => [bucket(p.a), bucket(p.b)])),
      })
    }
  }
  return {
    schema: BLIND_SCHEMA,
    reviewers,
    singleReviewer: reviewers.length < 2,
    agreement,
    items,
    byModelTask,
    byModel,
    adjudication: items.filter((i) => i.adjudicate).map((i) => i.anon),
    unScored: items.filter((i) => i.total === null).map((i) => i.anon),
  }
}

/** 品牌词扫描：返回命中 [{brand, count}]。 */
export function leakScan(text) {
  const out = []
  const s = String(text ?? '')
  for (const [brand, re] of LEAK_PATTERNS) {
    const m = s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))
    if (m) out.push({ brand, count: m.length })
  }
  return out
}
