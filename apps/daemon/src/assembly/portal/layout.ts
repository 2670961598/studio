/**
 * portal/layout —— 门户壳（侧栏/顶栏/页脚/主题切换/favicon）。纯字符串渲染，零 IO。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §一.1（布局）／§二（设计系统·主题/图标/脚本）。
 * 安全：脚本仅操作主题与导航态（无用户数据插值，CSP 友好——无内联事件处理器）；
 * 公司名等用户侧文本一律经 esc()；聊天徽标取数地址由服务端拼好（actor 经 url+esc）
 * 放进 data-src，脚本只读属性、不拼用户数据。
 */
import type { CompanySnapshot } from '@studio-next/contract'
import { PORTAL_CSS } from './styles.ts'
import { esc, icon, url } from './html.ts'

/** 导航项（§一.1 五页＋§九.1 会话页——v2 第一刀） */
const NAV: readonly { href: string; key: string; label: string; ic: string }[] = [
  { href: '/', key: 'overview', label: '概览', ic: 'home' },
  { href: '/tickets', key: 'tickets', label: '单子', ic: 'ticket' },
  { href: '/chat', key: 'chat', label: '聊天', ic: 'chat' },
  { href: '/org', key: 'org', label: '组织', ic: 'org' },
  { href: '/sessions', key: 'sessions', label: '会话', ic: 'session' },
  { href: '/reports', key: 'reports', label: '报表', ic: 'report' },
]

/** 品牌标（内联 SVG——§二.图标；线条风格与导航图标同族） */
const BRAND_MARK =
  '<svg class="brand-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="3" width="26" height="26" rx="7"/><path d="M10 20V12l6 8v-8"/><path d="M21 12v8"/></svg>'

/** favicon（内联 SVG data URI——§二；深色底亮字） */
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#11151a"/><path d="M10 20V12l6 8v-8" fill="none" stroke="#6c9cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v8" fill="none" stroke="#6c9cff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  )

/** 首屏主题脚本（<head> 内执行防闪白；localStorage 优先，缺省随系统，再缺省深色） */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('portal-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`

/** 主题切换脚本（文档尾；无内联事件处理器——CSP 友好） */
const THEME_TOGGLE = `(function(){var b=document.getElementById('themeToggle');if(!b)return;b.addEventListener('click',function(){var d=document.documentElement;var t=d.getAttribute('data-theme')==='light'?'dark':'light';d.setAttribute('data-theme',t);try{localStorage.setItem('portal-theme',t);}catch(e){}});})();`

/**
 * 聊天导航未读徽标脚本（文档尾；fetch /api/chat/rooms?actor= 聚合 totalUnread——与 /chat
 * 页同源同 API）。失败/无未读/无 chatd→徽标保持 hidden（「失败不显示」；无内联事件处理器）。
 * 取数地址来自徽标元素的 data-src（服务端拼好并经 esc；脚本零用户数据插值）。
 */
const CHAT_UNREAD_BADGE = `(function(){var b=document.getElementById('navChatUnread');if(!b)return;var src=b.getAttribute('data-src');if(!src)return;fetch(src).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d||d.ok!==true)return;var n=d.totalUnread;if(typeof n==='number'&&n>0){b.textContent=n>999?'999+':String(n);b.removeAttribute('hidden');}}).catch(function(){});})();`

export interface ShellOptions {
  readonly company: CompanySnapshot
  readonly title: string
  readonly active: string
  readonly online: boolean
  readonly version: string
  readonly body: string
  /** 内容区用 <div> 而非 <main>（聊天页：@studio-next/panel/chat 片段自带 <main> 地标——
   *  一页只能一个 main 地标，嵌装时外壳让位；其余页不变） */
  readonly mainAsDiv?: boolean
  /** 聊天未读徽标（transport 已配才注入）：actor 进查询串（esc 转义），脚本惰性取数 */
  readonly chatBadge?: { readonly actor: string }
}

/** 渲染门户整页（doctype → 壳 → body；pageRenderer 注入位消费同构） */
export function portalShell(opts: ShellOptions): string {
  const chatBadge =
    opts.chatBadge === undefined
      ? ''
      : `<span class="nav-badge" id="navChatUnread" data-src="/api/chat/rooms${opts.chatBadge.actor !== '' ? `?actor=${esc(url(opts.chatBadge.actor))}` : ''}" hidden></span>`
  const nav = NAV.map(
    (n) =>
      `<a href="${n.href}"${n.key === opts.active ? ' class="active" aria-current="page"' : ''}>${icon(n.ic)}<span>${n.label}</span>${n.key === 'chat' ? chatBadge : ''}</a>`,
  ).join('\n        ')
  const tag = opts.mainAsDiv === true ? 'div' : 'main'
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)} · ${esc(opts.company.name)} 门户</title>
<link rel="icon" href="${FAVICON}">
<script>${THEME_INIT}</script>
<style>${PORTAL_CSS}</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar" aria-label="门户导航">
    <div class="brand">
      ${BRAND_MARK}
      <div>
        <div class="brand-name" title="${esc(opts.company.name)}">${esc(opts.company.name)}</div>
        <div class="brand-sub">Company Portal</div>
      </div>
    </div>
    <nav class="nav">
        ${nav}
    </nav>
    <div class="sidebar-foot">
      <span class="badge b-neutral plain badge-ro">只读</span>
      <span class="ver num">${esc(opts.version)}</span>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="crumb"><span>门户</span><span class="sep">/</span><b>${esc(opts.title)}</b></div>
      <div class="topbar-right">
        <span class="status-pill"><span class="dot${opts.online ? ' on' : ''}"></span>${opts.online ? 'daemon 在线' : 'daemon 静默'}</span>
        <button id="themeToggle" class="btn ghost icon" type="button" aria-label="切换深浅主题" title="切换深浅主题">${icon('sun', 16, 'ic-sun')}${icon('moon', 16, 'ic-moon')}</button>
      </div>
    </header>
    <${tag} class="page">
${opts.body}
    </${tag}>
  </div>
</div>
<script>${THEME_TOGGLE}</script>
${opts.chatBadge === undefined ? '' : `<script>${CHAT_UNREAD_BADGE}</script>`}
</body>
</html>`
}

/** 内容标题区（各页共用；sub 一律转义——调用方传原文，不在调用点各自记转义） */
export function pageHead(title: string, sub: string): string {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>`
}
