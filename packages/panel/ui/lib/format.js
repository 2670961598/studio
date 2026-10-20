/**
 * format —— 展示层格式化纯函数（DEV-1 方案 §7.2：台账原始 double，显示层取整；
 * 金额 4 位小数、时间本地时区、时长人话化）。
 */

/** epoch ms → 'MM-DD HH:mm:ss'（本地时区；UTC 日切口径归服务端，展示层只给人看） */
export function fmtTime(ts) {
  if (!Number.isFinite(ts)) return '-'
  const d = new Date(ts)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** epoch ms → 'YYYY-MM-DD HH:mm'（次密度场景：断路器最近触发） */
export function fmtDateTime(ts) {
  if (!Number.isFinite(ts)) return '-'
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** USD 数值 → '$0.0000'（台账存原始 double——models.ts 冻结：显示层自取整） */
export function fmtUsd(v, digits = 4) {
  if (!Number.isFinite(v)) return '-'
  return `$${v.toFixed(digits)}`
}

/** 毫秒时长 → '1d2h'/'3m12s'/'890ms'（在途 run 起跑至今等） */
export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** 数组 → 逗号连接（workers 的 executors/issues 展示）；空数组 → '-' */
export function fmtList(list) {
  if (!Array.isArray(list) || list.length === 0) return '-'
  return list.join(',')
}
