/**
 * chat/linkify —— 聊天正文 URL 可点击化（显示层；单一正则源）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §十.3（聊天增强：linkify 安全转义）。
 * 安全模型（与 mask.ts 同款注入模式——TS 本体与内联 JS 共用 `.source`，两处渲染同源）：
 *   - 正则**白名单**只匹配 `http://`/`https://` 开头的 URL——`javascript:`/`data:`/
 *     `vbscript:` 等危险 scheme 永不命中、永不进 href；
 *   - URL 终止于首个空白/引号/尖括号，尾随中英文标点（`,.;:!?)]}」』】）»`）不并入链接；
 *   - 前端组装走 `createElement`＋`textContent`（正文零 innerHTML），href 只取正则命中段
 *     并二次校验 scheme 前缀——转义安全性不依赖字符串拼接。
 * 脱敏（mask.ts）先于 linkify：被罩成 `<path>` 的主机路径不可能被当成 URL 匹配。
 */

/** URL 白名单正则（单一冻结源：TS 本体与 page.ts 内联 JS 共用 `.source` 注入） */
const LINK_RE = /https?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}」』】）]/g

/** 正则源串（服务端 HTML 生成器注入前端脚本用——两处渲染同源不双轨） */
export const LINK_RE_SOURCE: string = LINK_RE.source

/** href 安全校验（纵深防御：正则命中段仍须 http(s) 前缀——防御注入源漂移） */
export function isSafeLinkHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** 文本 → 片段序列（TS 侧同源解析，供测试与未来服务端渲染共用）：纯文本段/链接段 */
export type LinkSegment = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'link'; readonly href: string }

export function linkifySegments(text: string): readonly LinkSegment[] {
  const segments: LinkSegment[] = []
  let last = 0
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', text: text.slice(last, m.index) })
    segments.push({ kind: 'link', href: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}
