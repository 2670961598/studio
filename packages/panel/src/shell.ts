/**
 * shell —— :8787 监控页的 Vue 页壳（纯函数、零 IO；docs/37-§5.1 路线 I / DEV-1 方案 §3.4）
 *
 * 职责：只产出「换装壳」——importmap 三项映射 + #app 挂载点 + /ui/main.js 模块入口
 * + 无 JS/资源缺失兜底（#boot-error 与 <noscript> 均指向 /legacy 旧版只读页）。
 *
 * 与 views.ts 的分层一致：本文件零 IO、零 Hono 依赖；静态路由在 static.ts，接线在 server.ts。
 * importmap 的 `?v=<version>` 与 vendor.lock.json 的 version 两处写死是刻意的（页壳静态，
 * 不引入运行时读 lock 的 IO）——升级时两处同改（见 vendor/README.md 升级步骤）。
 */

/**
 * importmap 三项映射（vue / naive-ui / echarts——三件 vendor，docs/37-§6「四件」为勘误，
 * 见 DEV-1 §12 回填单）。naive-ui 内部裸导入仅 `vue` 一个、echarts 零裸导入（取件时实查），
 * 故三项即够；查询串 ?v= 随版本变，配合静态路由的 immutable 年缓存，升级自然失效。
 */
export const PANEL_IMPORTMAP: Readonly<Record<string, string>> = {
  vue: '/vendor/vue.esm-browser.prod.js?v=3.5.44',
  'naive-ui': '/vendor/naive-ui.prod.mjs?v=2.45.3',
  echarts: '/vendor/echarts.esm.min.js?v=6.1.0',
}

/** 前端模块入口（/ui/* 静态路由服务，no-cache + ETag） */
export const PANEL_UI_ENTRY = '/ui/main.js'

/** 旧版只读页路由（换装期回滚/无 JS 兜底；退役归刀二后评估，DEV-1 §11） */
export const PANEL_LEGACY_ROUTE = '/legacy'

/**
 * 监控页壳：Vue ESM 挂载点 + importmap。#app 内置首屏兜底文案——模块加载失败
 * （importmap 不支持 / vendor 缺失 / 网络断）时文案保持可见，不白屏；Vue 挂载成功
 * 则整体替换 #app 内容。样式只留首屏背景与兜底块，组件样式全归 Naive UI（CSS-in-JS）。
 */
export function renderDashboardShell(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio Next 监控 :8791</title>
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
    监控页前端模块加载中……若长时间停留在此：浏览器可能不支持 importmap，
    或 /vendor/* 静态资源缺失（见服务端启动日志）。可访问
    <a href="${PANEL_LEGACY_ROUTE}">/legacy 旧版只读页</a>（零 JS 依赖）。
  </div>
</div>
<noscript>监控页需要 JavaScript。可访问 <a href="${PANEL_LEGACY_ROUTE}">/legacy 旧版只读页</a>（零 JS 依赖）。</noscript>
<script type="module" src="${PANEL_UI_ENTRY}"></script>
</body>
</html>
`
}
