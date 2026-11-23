/**
 * interval.mjs —— 描述统计（纯函数，零 IO）：均值 / 极差 / 95% 区间
 *
 * 口径（docs/quality/benchmark-business-eval.md §5.2）：
 *   n = 1        不给区间（method='none'）
 *   n = 2        只报极差 [min, max]（method='range'）——t 区间在 n=2 时宽到没有信息量
 *   n ≥ 3        双侧 95% t 区间 mean ± t(0.975, n−1)·s/√n（method='t'）
 * 所有数值四舍五入到 4 位小数；空样本一律 null。
 */

/** 双侧 95% t 分位数（df 1–30 查表；df>30 取 1.96 正态近似——冒烟/小样本场景够用，表外会标注 approximate）。 */
const T975 = Object.freeze([
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
])

export function round4(x) {
  return typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null
}

export function tCritical(df) {
  if (df >= 1 && df <= T975.length) return { t: T975[df - 1], approximate: false }
  if (df > 30) return { t: 1.96, approximate: true }
  return null
}

export function mean(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length
}

export function sampleStd(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  if (v.length < 2) return null
  const m = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
}

/**
 * @param {{ lo?: number, hi?: number }} [bounds] 分值的取值范围；区间端点截到范围内（格分 ∈ [0,1]，配对差 ∈ [-1,1]）。
 * @returns {{ n:number, mean:number|null, min:number|null, max:number|null, ci95:{method:'none'|'range'|'t', lo:number|null, hi:number|null, approximate?:boolean } }}
 */
export function summarizeScores(xs, { lo: loBound = -Infinity, hi: hiBound = Infinity } = {}) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
  const n = v.length
  const min = n === 0 ? null : Math.min(...v)
  const max = n === 0 ? null : Math.max(...v)
  const m = mean(v)
  if (n === 0) return { n, mean: null, min: null, max: null, ci95: { method: 'none', lo: null, hi: null } }
  if (n === 1) return { n, mean: round4(m), min: round4(min), max: round4(max), ci95: { method: 'none', lo: null, hi: null } }
  const clip = (x) => round4(Math.min(hiBound, Math.max(loBound, x)))
  if (n === 2) return { n, mean: round4(m), min: round4(min), max: round4(max), ci95: { method: 'range', lo: clip(min), hi: clip(max) } }
  const s = sampleStd(v)
  const crit = tCritical(n - 1)
  const half = s === 0 ? 0 : crit.t * (s / Math.sqrt(n))
  return {
    n,
    mean: round4(m),
    min: round4(min),
    max: round4(max),
    ci95: { method: 't', lo: clip(m - half), hi: clip(m + half), ...(crit.approximate ? { approximate: true } : {}) },
  }
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export function percentileNearestRank(xs, p) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const rank = Math.ceil((p / 100) * v.length)
  return v[Math.min(Math.max(rank, 1), v.length) - 1]
}

/** 区间不含 0 ⇔ 两个有限端点同号；区间缺失/退化 → null（不可判）。 */
export function excludesZero(ci) {
  if (!ci || typeof ci.lo !== 'number' || typeof ci.hi !== 'number') return null
  if (ci.lo === ci.hi) return ci.lo !== 0
  return ci.lo > 0 || ci.hi < 0
}
