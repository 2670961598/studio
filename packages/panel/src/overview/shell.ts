/**
 * overview shell —— :8789 公司概览面的 Vue 页壳（纯函数、零 IO；DEV-12 执行刀二）
 *
 * 与 :8787 的 shell.ts 同套换装纪律（docs/37-§5.1 路线 I / DEV-1 方案 §3.4）：importmap
 * 三项映射复用 PANEL_IMPORTMAP（vendor 三件由刀一进仓，本刀不重复携带）；差异只在
 * 模块入口（/ui/overview/main.js）与兜底路由（/legacy——本刀把 v0.7 首刀的服务端渲染
 * 五读面整组迁往 /legacy/<原路径>，作换装验证期回滚面，退役评估归后续刀）。
 *
 * 本文件零 IO、零 Hono；静态路由复用 static.ts（mountPanelStatic），接线在 server.ts。
 */
import { PANEL_IMPORTMAP, PANEL_LEGACY_ROUTE } from '../shell.ts'

/** 概览面前端模块入口（/ui/* 静态路由服务，no-cache + ETag） */
export const OVERVIEW_UI_ENTRY = '/ui/overview/main.js'

/** 旧版服务端渲染读面的根路由（换装期回滚/无 JS 兜底；slug 保留字见 server.ts 构造闸） */
export const OVERVIEW_LEGACY_ROUTE = PANEL_LEGACY_ROUTE

/** 旧版树内部链接 basePath（render*Page 的链接前缀——值同 OVERVIEW_LEGACY_ROUTE，语义别名） */
export const OVERVIEW_LEGACY_BASE = OVERVIEW_LEGACY_ROUTE

/**
 * 概览面壳：与 renderDashboardShell 同骨架——importmap + #app + #boot-error/<noscript>
 * 兜底（指向 /legacy 旧版读面）。单壳多页：所有概览路径（/、/<slug>/…）共用本壳，
 * 页面切换由 ui/overview/app.js 按 location.pathname 解析（深链/刷新不失效）。
 */
export function renderOverviewShell(title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  html, body, #app { height: 100%; margin: 0; }
  body { background: #101418; }
  #boot-error { font: 13px/1.6 ui-monospace, Menlo, Consolas, monospace; color: #cfd8dc; padding: 24px; }
  #boot-error a, noscript a { color: #80cbc4; }
  noscript { display: block; font: 13px/1.6 ui-monospace, Menlo, Consolas, monospace; color: #cfd8dc; padding: 24px; }
</style>
<script type="importmap">
${JSON.stringify({ imports: PANEL_IMPORTMAP }, null, 2)}
</script>
</head>
<body>
<div id="app">
  <div id="boot-error">
    公司概览面前端模块加载中……若长时间停留在此：浏览器可能不支持 importmap，
    或 /vendor/* 静态资源缺失（见服务端启动日志）。可访问
    <a href="${OVERVIEW_LEGACY_ROUTE}">/legacy 旧版只读面</a>（零 JS 依赖）。
  </div>
</div>
<noscript>公司概览面需要 JavaScript。可访问 <a href="${OVERVIEW_LEGACY_ROUTE}">/legacy 旧版只读面</a>（零 JS 依赖）。</noscript>
<script type="module" src="${OVERVIEW_UI_ENTRY}"></script>
</body>
</html>
`
}
