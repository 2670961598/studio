/**
 * router —— :8789 换装页的路径路由（纯函数 + 极简导航；DEV-12 刀二）
 *
 * 单壳多页：服务端对所有概览路径回同一壳（shell.ts），页面切换在浏览器内完成——
 * 本文件负责 pathname → 路由对象 的解析（深链/刷新/后退都走它）与 pushState 导航
 * （自定义事件 ROUTE_EVENT 通知 app 重解析；popstate 同款处理）。
 *
 * slug 形状与 @studio-next/company 的 SLUG_RE 同口径（小写字母/数字/连字符；浏览器侧
 * 无法 import 包内校验器，此处等价复刻——两侧漂移由服务端路由闸兜底）。
 */

/** 路由对象：companies=公司清单页；company=公司页（tab=概览/组织/人事/进度/财务）；person=档案页 */
export const COMPANY_TABS = ['overview', 'org', 'people', 'progress', 'finance']

const SLUG = /^[a-z0-9][a-z0-9-]*$/
const PERSON_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * pathname → 路由对象；不认识的形状返回 null（app 显示 404 视图——与服务端 HTML 404 口径一致）。
 *   '' | '/'                 → { view: 'companies' }
 *   '/<slug>' | '/<slug>/'   → { view: 'company', slug, tab: 'overview' }
 *   '/<slug>/<tab>'          → { view: 'company', slug, tab }（tab ∈ org/people/progress/finance）
 *   '/<slug>/people/<工号>'   → { view: 'person', slug, personId }
 */
export function parseOverviewPath(pathname) {
  const path = String(pathname ?? '')
  if (path === '' || path === '/') return { view: 'companies' }
  const segments = path.replace(/\/+$/, '').split('/').filter((s) => s !== '')
  if (segments.length === 0) return { view: 'companies' }
  if (segments.length > 3) return null
  const [slug, second, third] = segments
  if (!SLUG.test(slug)) return null
  if (second === undefined) return { view: 'company', slug, tab: 'overview' }
  if (second === 'people') {
    if (third === undefined) return { view: 'company', slug, tab: 'people' }
    if (PERSON_ID.test(third)) return { view: 'person', slug, personId: third }
    return null
  }
  if (third !== undefined) return null
  if (second === 'org' || second === 'progress' || second === 'finance') {
    return { view: 'company', slug, tab: second }
  }
  return null
}

/** 路由变更通知事件名（go() 派发；app 监听它与 popstate 同一处理） */
export const ROUTE_EVENT = 'overview-route'

/** 站内导航：pushState + ROUTE_EVENT（不整页刷新——热重载页面切换的前提） */
export function go(pathname) {
  history.pushState(null, '', pathname)
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT, { detail: pathname }))
}

/** tab → 规范路径（overview 用规范根 /<slug>/，其余 /<slug>/<tab>——与服务端路由表同构） */
export function tabPath(slug, tab) {
  return tab === 'overview' ? `/${slug}/` : `/${slug}/${tab}`
}
