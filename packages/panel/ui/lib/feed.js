/**
 * feed —— 事件流合并纯函数（DEV-1 方案 §6.2：SSE 新事件与 backlog 首屏历史的合流面）。
 *
 * 合并语义（单测钉死：test/ui-feed.test.ts）：
 *   - 按 id 去重（ULID 全局唯一）：incoming 覆盖 current 同 id 行（SSE 重连重放场景）；
 *   - 排序：ts 降序、同 ts 按 id 降序（(ts,id) 双键全序——与服务端游标同口径）；
 *   - 上限：截 limit 条（环形窗口，缺省 50——对齐旧页 50 条行为）；
 *   - 坏输入（null/非对象/缺 id/ts 非数）直接丢弃，不炸流。
 */

/** 单行合法性：对象 + 非空字符串 id + 有限数 ts */
function isValidEvent(ev) {
  return (
    ev !== null &&
    typeof ev === 'object' &&
    typeof ev.id === 'string' &&
    ev.id !== '' &&
    Number.isFinite(ev.ts)
  )
}

/**
 * mergeFeed(current, incoming, limit=50) → 合并后的新数组（不修改入参）。
 * current/incoming 均可含坏行（过滤）；两者可为 null/undefined（视同空）。
 */
export function mergeFeed(current, incoming, limit = 50) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 50
  const map = new Map()
  for (const ev of Array.isArray(current) ? current : []) {
    if (isValidEvent(ev)) map.set(ev.id, ev)
  }
  for (const ev of Array.isArray(incoming) ? incoming : []) {
    if (isValidEvent(ev)) map.set(ev.id, ev)
  }
  const merged = [...map.values()]
  merged.sort((a, b) => (b.ts - a.ts) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return merged.slice(0, cap)
}
