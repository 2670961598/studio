/**
 * 台账日闭（cost close）窗口工具。
 * 口径：窗口是 epoch ms 的闭开区间 [since, until) —— 含 since、不含 until（见 README.md）。
 */

export interface Window {
  /** 起始（含），epoch ms */
  since: number
  /** 结束（不含），epoch ms */
  until: number
}

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

/** 时间戳是否落在窗口内（闭开区间）。 */
export function inWindow(ts: number, w: Window): boolean {
  return ts >= w.since && ts <= w.until
}

/** 本地自然日窗口 [00:00, 24:00)。 */
export function dayWindow(d: Date): Window {
  const since = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return { since, until: since + DAY_MS }
}

/** 两窗口是否有重叠（半开区间；首尾相接不算重叠）。 */
export function overlaps(a: Window, b: Window): boolean {
  return a.since < b.until && b.since < a.until
}

/** 把窗口按小时切片，末片可短于 1h；切片左闭右开、无缝拼回原窗口。 */
export function sliceByHours(w: Window): Window[] {
  const out: Window[] = []
  for (let t = w.since; t < w.until; t += HOUR_MS) {
    out.push({ since: t, until: Math.min(t + HOUR_MS, w.until) })
  }
  return out
}
