/**
 * portal/html —— 门户 HTML 原子工具（转义/格式化/徽章语义色/图标）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §二（设计系统）／§三（安全——所有
 * 用户数据 HTML 转义）。纯字符串函数、零 IO、零业务。
 */

/** HTML 转义（属性与文本双安全：& < > " '）——所有用户数据出口必经 */
export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** URL 查询串编码（路径段/参数出口） */
export function url(value: string): string {
  return encodeURIComponent(value)
}

/** ISO 时间 → 本地可读短时（面板人类读法；无效输入原样返回） */
export function fmtTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** epoch ms → 本地可读短时（台账事件 ts） */
export function fmtEpoch(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  return fmtTime(new Date(ms).toISOString())
}

/** 相对时间（「3 分钟前」；粒度分级，>30 天落绝对短日） */
export function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return fmtTime(iso)
}

/** 字节数人类读法（报表列表） */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** 金额（美元两位小数；千分位） */
export function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * 状态 → 徽章语义色（§二.组件：新单=info 灰蓝／派发=warn 琥珀／交付=ok 绿／
 * Archived=neutral 灰；其余在途态=violet 紫——「证据就绪」等验证族落此档）。
 */
export function stateBadgeClass(state: string): string {
  if (/archived/i.test(state)) return 'b-neutral'
  if (state.includes('新')) return 'b-info'
  if (state.includes('派发')) return 'b-warn'
  if (state.includes('交付')) return 'b-ok'
  return 'b-violet'
}

/** 台账事件名 → 徽章档（心跳/巡逻=neutral；闸/断路/判负=danger；收割/报告=ok；其余=info） */
export function eventBadgeClass(event: string): string {
  if (event === 'HEARTBEAT' || event.startsWith('PATROL')) return 'b-neutral'
  if (event.startsWith('CIRCUIT_BREAK') || event.startsWith('JUDGE') || event.includes('GATE_FAIL')) return 'b-danger'
  if (event.startsWith('REPORT') || event.startsWith('HARVEST')) return 'b-ok'
  if (event.startsWith('GW_')) return 'b-warn'
  return 'b-info'
}

/** 行内 SVG 图标（24 viewBox，描边风格——§二；name 固定白名单，无用户数据） */
const ICON_PATHS: Readonly<Record<string, string>> = {
  home: '<path d="M3 9.5 12 3l9 6.5V21h-6v-6h-6v6H3z"/>',
  ticket: '<path d="M4 5h16v4a2 2 0 0 0 0 6v4H4v-4a2 2 0 0 0 0-6z"/><path d="M13 5v2M13 11v2M13 17v2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>',
  org: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/>',
  report: '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 13h6M9 17h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  file: '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  people: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2"/><circle cx="17" cy="9" r="3"/><path d="M22 21v-1a5 5 0 0 0-5-5"/>',
  session: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
  dot: '<circle cx="12" cy="12" r="5"/>',
}

/** 渲染图标（aria-hidden 装饰；尺寸默认 16；cls 附加类用于主题态显隐等） */
export function icon(name: keyof typeof ICON_PATHS | string, size = 16, cls = ''): string {
  const body = ICON_PATHS[name] ?? ICON_PATHS['dot']
  return `<svg class="ic${cls === '' ? '' : ` ${cls}`}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** 状态徽章（§二.组件——语义色档见 stateBadgeClass） */
export function badge(text: string, cls = 'b-neutral'): string {
  return `<span class="badge ${cls}">${esc(text)}</span>`
}

/** 空态（§二.组件：图标＋标题＋提示；零数据与降级共用） */
export function emptyState(iconName: string, title: string, hint: string): string {
  return `<div class="empty">${icon(iconName, 28)}<div class="empty-title">${esc(title)}</div><div class="empty-hint">${esc(hint)}</div></div>`
}

/** 截断长文本（显示层；转义后截断——先 esc 会截出实体半截，先按码点截再 esc） */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${[...text].slice(0, max).join('')}…`
}

/** field-set 值 → 安全展示串（对象 JSON 化；长值截断） */
export function fieldValueText(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null'
  return clip(raw, 120)
}
