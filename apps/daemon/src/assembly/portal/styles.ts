/**
 * portal/styles —— 公司门户设计系统（自研 CSS，仓内自包含，零外网 CDN）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §二。
 * 心智模型：Linear（侧栏克制/细边框）、Vercel（排版与层级）、GitHub Primer（badge/时间线）、
 * Stripe（信息密度与留白）、shadcn/ui（中性色＋圆角＋细边框）——只借气质，不引依赖。
 *
 * 主题：深色为缺省（:root），浅色经 html[data-theme="light"]；无 JS 时随
 * prefers-color-scheme（:root:not([data-theme]) 分支），有 JS 时 layout.ts 首屏脚本落 data-theme。
 * 聊天嵌装（.chat-embed）只覆写 @studio-next/panel/chat 的类名/id 契约，不动其脚本。
 */

const TOKENS_DARK = `
  color-scheme: dark;
  --bg0: #0b0d10;
  --bg1: #11151a;
  --bg2: #171c23;
  --bg3: #1e252e;
  --line: #232b35;
  --line-strong: #303a46;
  --fg: #e7eaef;
  --fg-muted: #9aa5b3;
  --fg-subtle: #6c7786;
  --accent: #6c9cff;
  --accent-strong: #3b7bff;
  --accent-fg: #ffffff;
  --accent-soft: rgba(108, 156, 255, 0.14);
  --ok: #46c08a;
  --ok-soft: rgba(70, 192, 138, 0.14);
  --warn: #e2b13c;
  --warn-soft: rgba(226, 177, 60, 0.14);
  --danger: #f0615c;
  --danger-soft: rgba(240, 97, 92, 0.13);
  --info: #79b8ff;
  --info-soft: rgba(121, 184, 255, 0.14);
  --violet: #b083f0;
  --violet-soft: rgba(176, 131, 240, 0.15);
  --neutral: #8d98a7;
  --neutral-soft: rgba(141, 152, 167, 0.16);
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.45);
  --shadow-2: 0 12px 32px rgba(0, 0, 0, 0.5);
  --hero-glow: radial-gradient(900px 320px at 10% -10%, rgba(108, 156, 255, 0.16), transparent 60%);
`

const TOKENS_LIGHT = `
  color-scheme: light;
  --bg0: #f5f7fa;
  --bg1: #ffffff;
  --bg2: #f0f3f7;
  --bg3: #e7ecf2;
  --line: #dde3ea;
  --line-strong: #c6cfda;
  --fg: #1c2128;
  --fg-muted: #57606b;
  --fg-subtle: #8a95a3;
  --accent: #0969da;
  --accent-strong: #0550ae;
  --accent-fg: #ffffff;
  --accent-soft: rgba(9, 105, 218, 0.1);
  --ok: #1a7f37;
  --ok-soft: rgba(26, 127, 55, 0.11);
  --warn: #9a6700;
  --warn-soft: rgba(154, 103, 0, 0.12);
  --danger: #cf222e;
  --danger-soft: rgba(207, 34, 46, 0.09);
  --info: #0969da;
  --info-soft: rgba(9, 105, 218, 0.1);
  --violet: #8250df;
  --violet-soft: rgba(130, 80, 223, 0.12);
  --neutral: #57606b;
  --neutral-soft: rgba(87, 96, 107, 0.11);
  --shadow-1: 0 1px 2px rgba(20, 30, 50, 0.08);
  --shadow-2: 0 12px 32px rgba(20, 30, 50, 0.12);
  --hero-glow: radial-gradient(900px 320px at 10% -10%, rgba(9, 105, 218, 0.12), transparent 60%);
`

const BASE = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
    font-size: 14px; line-height: 1.55; color: var(--fg); background: var(--bg0);
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 2px; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.92em; }
  .num { font-variant-numeric: tabular-nums; }
  h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: 22px; line-height: 1.25; }
  h2 { font-size: 15px; line-height: 1.35; }
  h3 { font-size: 13px; line-height: 1.4; color: var(--fg-muted); }
  p { margin: 0; }
  .ic { flex: none; vertical-align: -0.18em; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
  ::selection { background: var(--accent-soft); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`

const LAYOUT = `
  .shell { display: flex; min-height: 100vh; }
  .sidebar {
    position: sticky; top: 0; flex: none; width: 240px; height: 100vh;
    display: flex; flex-direction: column; gap: 4px; padding: 16px 12px;
    background: var(--bg1); border-right: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 10px; padding: 6px 10px 14px; }
  .brand-mark { width: 30px; height: 30px; flex: none; color: var(--accent); }
  .brand-name { font-weight: 650; font-size: 14px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .brand-sub { color: var(--fg-subtle); font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; }
  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav a {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px;
    color: var(--fg-muted); font-weight: 500; font-size: 13.5px;
  }
  .nav a:hover { background: var(--bg2); color: var(--fg); text-decoration: none; }
  .nav a.active { background: var(--accent-soft); color: var(--accent); }
  .nav a .ic { opacity: 0.85; }
  /* 聊天未读徽标（flex 项靠右；hidden=无未读/取数失败——不占位） */
  .nav a .nav-badge { margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 600; line-height: 17px; text-align: center; font-variant-numeric: tabular-nums; }
  .nav a .nav-badge[hidden] { display: none; }
  .sidebar-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 10px; color: var(--fg-subtle); font-size: 12px; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .topbar {
    position: sticky; top: 0; z-index: 20; height: 52px; display: flex; align-items: center; gap: 16px; padding: 0 32px;
    background: color-mix(in srgb, var(--bg0) 84%, transparent); backdrop-filter: saturate(180%) blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .crumb { display: flex; align-items: center; gap: 8px; color: var(--fg-subtle); font-size: 13px; }
  .crumb b { color: var(--fg); font-weight: 600; }
  .crumb .sep { opacity: 0.5; }
  .topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .page { width: 100%; max-width: 1200px; margin: 0 auto; padding: 28px 32px 72px; }
  .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .page-head .sub { color: var(--fg-muted); margin-top: 4px; font-size: 13px; }
  .grid-2 { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .stack { display: flex; flex-direction: column; gap: 16px; }
`

const COMPONENTS = `
  .card { background: var(--bg1); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-1); }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .card-head h2 { display: flex; align-items: center; gap: 8px; }
  .card-body { padding: 16px; }
  .card-body.tight { padding: 6px 0 2px; }
  .link-more { font-size: 12.5px; color: var(--fg-muted); }
  .link-more:hover { color: var(--accent); }

  .hero { position: relative; overflow: hidden; padding: 24px 28px; margin-bottom: 16px; background: var(--bg1); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-1); }
  .hero::before { content: ""; position: absolute; inset: 0; background: var(--hero-glow); pointer-events: none; }
  .hero > * { position: relative; }
  .hero h1 { font-size: 26px; letter-spacing: -0.02em; }
  .hero .mission { margin-top: 8px; max-width: 72ch; color: var(--fg-muted); font-size: 14.5px; }
  .hero .chips { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }

  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; line-height: 18px; color: var(--fg-muted); background: var(--bg2); border: 1px solid var(--line); }
  .chip .ic { opacity: 0.8; }
  .chip-link { color: var(--fg-muted); white-space: nowrap; }
  .chip-link:hover { color: var(--accent); text-decoration: none; border-color: var(--accent); }
  .chip-link.active { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  /* 计数药丸：等高同基线（数字宽窄不抖动；tabular 对齐） */
  .chip .count { padding: 0 6px; border-radius: 999px; background: var(--bg3); font-size: 11.5px; line-height: 16px; color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
  .chip-link.active .count { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(172px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat { display: flex; gap: 12px; padding: 14px 16px; background: var(--bg1); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-1); min-height: 84px; }
  .stat-ic { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border-radius: 9px; background: var(--bg2); color: var(--fg-muted); border: 1px solid var(--line); }
  .stat-label { color: var(--fg-muted); font-size: 12.5px; }
  .stat-value { font-size: 22px; font-weight: 650; line-height: 1.2; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .stat-sub { color: var(--fg-subtle); font-size: 12px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .stat.tone-accent .stat-ic { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
  .stat.tone-ok .stat-ic { color: var(--ok); background: var(--ok-soft); border-color: transparent; }
  .stat.tone-warn .stat-ic { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .stat.tone-violet .stat-ic { color: var(--violet); background: var(--violet-soft); border-color: transparent; }
  .stat.tone-neutral .stat-ic { color: var(--neutral); background: var(--neutral-soft); border-color: transparent; }

  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1.6; white-space: nowrap; border: 1px solid transparent; font-variant-numeric: tabular-nums; }
  .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.85; }
  .badge.plain::before { display: none; }
  .b-info { color: var(--info); background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 30%, transparent); }
  .b-warn { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
  .b-ok { color: var(--ok); background: var(--ok-soft); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
  .b-danger { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  .b-violet { color: var(--violet); background: var(--violet-soft); border-color: color-mix(in srgb, var(--violet) 30%, transparent); }
  .b-neutral { color: var(--neutral); background: var(--neutral-soft); border-color: color-mix(in srgb, var(--neutral) 30%, transparent); }
  .badge-ro { border-color: var(--line-strong); color: var(--fg-muted); background: var(--bg2); }
  .badge-ro::before { display: none; }

  .table-wrap { overflow-x: auto; }
  table.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .table th { text-align: left; padding: 10px 16px; color: var(--fg-subtle); font-weight: 500; font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .table td { padding: 10px 16px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .table tr:last-child td { border-bottom: 0; }
  .table tbody tr:hover td { background: var(--bg2); }
  .table td.muted, .table .muted { color: var(--fg-muted); }
  .table .id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; color: var(--fg-muted); white-space: nowrap; }
  .table .title-cell { max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .table .title-cell a { color: var(--fg); font-weight: 500; }
  .table .title-cell a:hover { color: var(--accent); }
  .table .nowrap { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .list-compact { display: flex; flex-direction: column; }
  .list-row { display: flex; align-items: center; gap: 12px; padding: 9px 16px; border-bottom: 1px solid var(--line); }
  .list-row:last-child { border-bottom: 0; }
  .list-row .grow { flex: 1; min-width: 0; }
  .list-row .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .list-row .s { color: var(--fg-subtle); font-size: 12px; margin-top: 1px; }
  .list-row time { color: var(--fg-subtle); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }

  .toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .toolbar .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .search { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .search input { width: 240px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg1); color: var(--fg); font: inherit; font-size: 13px; }
  .search input::placeholder { color: var(--fg-subtle); }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--bg2); color: var(--fg); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
  .btn:hover { background: var(--bg3); text-decoration: none; }
  .btn.primary { background: var(--accent-strong); border-color: var(--accent-strong); color: var(--accent-fg); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.ghost { background: transparent; border-color: transparent; color: var(--fg-muted); }
  .btn.ghost:hover { background: var(--bg2); color: var(--fg); }
  .btn.icon { padding: 6px; width: 32px; height: 32px; justify-content: center; }
  #themeToggle .ic { display: none; }
  :root[data-theme="dark"] #themeToggle .ic-sun { display: block; }
  :root[data-theme="light"] #themeToggle .ic-moon { display: block; }
  .pager { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--line); color: var(--fg-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .pager .btn[aria-disabled="true"] { opacity: 0.45; pointer-events: none; }

  .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px 16px; text-align: center; color: var(--fg-subtle); }
  .empty .ic { opacity: 0.6; }
  .empty-title { color: var(--fg-muted); font-weight: 600; font-size: 13.5px; }
  .empty-hint { font-size: 12.5px; max-width: 52ch; }
  .banner { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border-radius: 10px; font-size: 13px; border: 1px solid; margin-bottom: 14px; }
  .banner.warn { color: var(--warn); background: var(--warn-soft); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
  .banner.danger { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  .banner.info { color: var(--info); background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 30%, transparent); }
  .banner .grow { flex: 1; color: var(--fg); }

  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--neutral); box-shadow: 0 0 0 3px var(--neutral-soft); }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
  .status-pill { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg1); color: var(--fg-muted); font-size: 12px; white-space: nowrap; }
  .back { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-muted); font-size: 13px; margin-bottom: 12px; }
  .back:hover { color: var(--accent); text-decoration: none; }
  .detail-head { padding: 20px 24px; }
  .detail-head .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .detail-head h1 { margin-top: 8px; font-size: 20px; }
  .detail-head .id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fg-muted); font-size: 13px; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 20px; padding: 14px 24px; border-top: 1px solid var(--line); }
  .meta-grid dt { color: var(--fg-subtle); font-size: 12px; }
  .meta-grid dd { margin: 2px 0 0; font-weight: 500; }
  .prose { white-space: pre-wrap; word-break: break-word; line-height: 1.65; color: var(--fg); }
  .prose.muted { color: var(--fg-muted); }

  .timeline { position: relative; display: flex; flex-direction: column; gap: 0; padding-left: 0; }
  .tl-item { position: relative; display: grid; grid-template-columns: 28px 1fr; gap: 10px; padding: 0 0 18px 0; }
  .tl-item::before { content: ""; position: absolute; left: 13px; top: 22px; bottom: -2px; width: 2px; background: var(--line); }
  .tl-item:last-child::before { display: none; }
  .tl-dot { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--bg2); border: 1px solid var(--line-strong); color: var(--fg-muted); z-index: 1; }
  .tl-item.state .tl-dot { color: var(--violet); background: var(--violet-soft); border-color: transparent; }
  .tl-item.created .tl-dot { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
  .tl-item.field .tl-dot { color: var(--neutral); background: var(--neutral-soft); border-color: transparent; }
  .tl-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; font-weight: 500; }
  .tl-head .kind { color: var(--fg); }
  .tl-head time { color: var(--fg-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }
  .tl-body { color: var(--fg-muted); font-size: 12.5px; margin-top: 2px; word-break: break-word; }
  .tl-body code { background: var(--bg2); padding: 1px 6px; border-radius: 5px; color: var(--fg); }
  .tl-state { display: inline-flex; align-items: center; gap: 6px; }
  .tl-state .arrow { color: var(--fg-subtle); }
  .tl-state.highlight { background: var(--violet-soft); border-radius: 8px; padding: 3px 8px; }

  .tree { display: flex; flex-direction: column; }
  .tree-row { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid var(--line); }
  .tree-row:last-child { border-bottom: 0; }
  .tree-row:hover { background: var(--bg2); }
  .tree-row .name { font-weight: 600; }
  .tree-row .meta { color: var(--fg-muted); font-size: 12.5px; display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
  .tree-row .meta span { display: inline-flex; align-items: center; gap: 4px; }
  .lvl { display: inline-block; padding: 0 6px; border-radius: 5px; background: var(--bg3); color: var(--fg-muted); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }

  .file-pre { margin: 0; padding: 18px 20px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--fg); background: var(--bg1); }
  .report-meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--fg-subtle); font-size: 12.5px; }
  .kv { display: flex; gap: 6px; align-items: baseline; }
  .kv .k { color: var(--fg-subtle); }
  .org-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .org-summary .cell { padding: 10px 12px; border-radius: 10px; background: var(--bg2); border: 1px solid var(--line); }
  .org-summary .v { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .org-summary .k { color: var(--fg-subtle); font-size: 12px; }
  .quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .quick a { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg2); color: var(--fg); font-weight: 500; font-size: 13px; }
  .quick a:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
`

const CHAT = `
  /* --muted 别名：panel/chat 脚本 setStatus() 内联引用 var(--muted)/var(--danger) */
  .chat-embed { --muted: var(--fg-muted); display: flex; flex-direction: column; }
  .chat-embed main { display: grid; grid-template-columns: 260px minmax(0, 1fr); height: calc(100vh - 160px); min-height: 420px; background: var(--bg1); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow-1); }
  .chat-embed aside { border-right: 1px solid var(--line); background: var(--bg1); overflow: auto; padding: 8px; }
  .chat-embed aside .title { color: var(--fg-subtle); font-size: 12px; padding: 6px 8px; letter-spacing: 0.03em; }
  .chat-embed .room { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--fg-muted); font: inherit; }
  .chat-embed .room:hover { background: var(--bg2); }
  .chat-embed .room.active { background: var(--accent-soft); color: var(--accent); }
  .chat-embed .room .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .chat-embed .room .kind { color: var(--fg-subtle); font-size: 11px; }
  .chat-embed .room .unread { min-width: 20px; text-align: center; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--accent-strong); color: var(--accent-fg); font-variant-numeric: tabular-nums; }
  .chat-embed .room .unread.zero { display: none; }
  .chat-embed section { display: flex; flex-direction: column; min-width: 0; }
  .chat-embed #banner { margin: 10px 14px 0; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 13px; display: none; }
  .chat-embed #meta { display: flex; gap: 8px; align-items: center; padding: 10px 16px 6px; color: var(--fg-subtle); font-size: 12px; }
  .chat-embed #meta input { width: 140px; padding: 4px 10px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg2); color: var(--fg); font: inherit; }
  .chat-embed #messages { flex: 1; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .chat-embed #messages .title { color: var(--fg-subtle); font-size: 12.5px; padding: 12px; text-align: center; }
  .chat-embed .msg { max-width: 72ch; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg2); }
  .chat-embed .msg.mine { align-self: flex-end; border-color: color-mix(in srgb, var(--accent) 35%, transparent); background: var(--accent-soft); }
  .chat-embed .msg .who { color: var(--fg-subtle); font-size: 11px; margin-bottom: 2px; font-variant-numeric: tabular-nums; }
  .chat-embed .msg .body { white-space: pre-wrap; word-break: break-word; }
  .chat-embed form { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--line); background: var(--bg1); }
  .chat-embed textarea { flex: 1; min-height: 44px; max-height: 160px; resize: vertical; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg2); color: var(--fg); font: inherit; }
  .chat-embed button { padding: 8px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg2); color: var(--fg); cursor: pointer; font: inherit; }
  .chat-embed button.primary { background: var(--accent-strong); border-color: var(--accent-strong); color: var(--accent-fg); }
  .chat-embed button.primary:hover { filter: brightness(1.08); }
  .chat-embed #status { padding: 0 16px 10px; color: var(--fg-muted); font-size: 12px; min-height: 18px; font-variant-numeric: tabular-nums; }
  .chat-embed .disabled-card { margin: 24px auto; max-width: 560px; padding: 20px 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg1); box-shadow: var(--shadow-1); }
  .chat-embed .disabled-card h2 { font-size: 15px; margin: 0 0 8px; }
  .chat-embed .disabled-card code { background: var(--bg2); padding: 1px 6px; border-radius: 5px; font-size: 12px; }
  .chat-embed .disabled-card p { color: var(--fg-muted); font-size: 13px; margin: 6px 0; }
`

const RESPONSIVE = `
  @media (max-width: 900px) {
    .shell { flex-direction: column; }
    .sidebar { position: sticky; top: 0; width: 100%; height: auto; flex-direction: row; align-items: center; padding: 8px 12px; gap: 8px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
    .brand { padding: 0 8px 0 0; flex: none; }
    .brand-name { max-width: 160px; }
    .brand-sub { display: none; }
    .nav { flex-direction: row; gap: 2px; }
    .nav a { padding: 6px 10px; white-space: nowrap; }
    .sidebar-foot { margin: 0 0 0 auto; padding: 0 6px; flex: none; }
    .sidebar-foot .ver { display: none; }
    .topbar { padding: 0 16px; }
    .page { padding: 18px 16px 56px; }
    .grid-2 { grid-template-columns: minmax(0, 1fr); }
    .hero { padding: 18px; }
    .hero h1 { font-size: 22px; }
    .search { margin-left: 0; width: 100%; }
    .search input { flex: 1; width: auto; }
    .chat-embed main { grid-template-columns: 200px minmax(0, 1fr); height: calc(100vh - 220px); }
    .org-summary, .quick { grid-template-columns: 1fr; }
    .search-wide { flex-wrap: wrap; }
    .ev-text { max-height: 220px; }
    .ev-head { flex-wrap: wrap; }
  }
  @media (max-width: 560px) {
    .chat-embed main { grid-template-columns: 1fr; }
    .chat-embed aside { max-height: 160px; border-right: 0; border-bottom: 1px solid var(--line); }
  }
`

/** §九.2 组织架构图＋§九.1 会话档案页（v2 第一刀新增组件面） */
const SESSIONS_ORG = `
  .org-chart, .org-chart ul { list-style: none; margin: 0; padding: 0; display: flex; justify-content: center; gap: 14px; }
  .org-chart { padding: 6px 0 2px; }
  .org-chart ul { position: relative; padding-top: 18px; }
  .org-chart ul::before { content: ''; position: absolute; top: 0; left: 50%; width: 1px; height: 18px; background: var(--line-strong); }
  .org-chart li { display: flex; flex-direction: column; align-items: center; position: relative; padding-top: 18px; }
  .org-chart li::before { content: ''; position: absolute; top: 0; left: 50%; width: 1px; height: 18px; background: var(--line-strong); }
  .org-chart > li { padding-top: 0; }
  .org-chart > li::before { display: none; }
  .org-chart li:only-child > ul::before { display: none; }
  .org-node { display: flex; flex-direction: column; gap: 4px; min-width: 128px; max-width: 190px; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--bg2); color: var(--fg); text-decoration: none; box-shadow: var(--shadow-1); }
  .org-node:hover { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .org-node.active { border-color: var(--accent); background: var(--accent-soft); }
  .org-node.dim { opacity: 0.45; }
  .org-name { font-weight: 600; font-size: 13px; text-align: center; }
  .org-meta { display: flex; justify-content: center; gap: 6px; align-items: center; font-size: 11px; color: var(--fg-muted); flex-wrap: wrap; }
  .chart-scroll { overflow-x: auto; }
  .tree-row.hit { background: var(--accent-soft); border-radius: 8px; }
  .search-wide { display: flex; gap: 8px; flex: 1; max-width: 760px; }
  .search-wide input { flex: 1; min-width: 110px; }
  .concl { max-width: 380px; }
  .tabs { display: flex; gap: 4px; margin: 14px 0 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .tab { padding: 8px 14px; font-size: 13px; color: var(--fg-muted); text-decoration: none; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0; }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--fg); background: var(--bg2); border-color: var(--line); }
  .tab .count { margin-left: 5px; }
  .doc-pre { margin: 0; padding: 14px 16px; border-radius: 8px; background: var(--bg2); border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.6; max-height: 70vh; overflow: auto; }
  .doc-pre.clipped::after { content: ''; display: block; }
  .ev-list { display: flex; flex-direction: column; gap: 4px; }
  .ev { display: flex; gap: 10px; align-items: flex-start; padding: 7px 10px; border-radius: 8px; border: 1px solid transparent; }
  .ev:hover { background: var(--bg2); }
  .ev-time { font-size: 11px; color: var(--fg-muted); white-space: nowrap; margin-top: 2px; }
  .ev-main { flex: 1; min-width: 0; }
  .ev-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 12.5px; }
  .ev-detail { color: var(--fg-muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
  .ev-text { margin: 6px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; max-height: 260px; overflow: auto; }
  .ev-user .badge, .ev-brief .badge { border-color: color-mix(in srgb, var(--info) 50%, transparent); }
  .ev-assistant .badge { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .ev-tool_call .badge { border-color: color-mix(in srgb, var(--warn) 55%, transparent); }
  .ev-error { border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 6%, transparent); }
  .ev-fold { margin: 8px 0 0; border: 1px dashed var(--line-strong); border-radius: 8px; }
  .ev-fold summary { cursor: pointer; padding: 8px 12px; color: var(--fg-muted); font-size: 12.5px; user-select: none; }
  .ev-fold .ev-group { padding: 0 6px 6px; }
  .ok-dot { color: var(--ok); }
`

/** 门户样式表全文（layout.ts 以 <style> 内联——零外链，CSP 友好） */
export const PORTAL_CSS = `:root {${TOKENS_DARK}}
:root[data-theme="light"] {${TOKENS_LIGHT}}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {${TOKENS_LIGHT} }
}
${BASE}
${LAYOUT}
${COMPONENTS}
${SESSIONS_ORG}
${CHAT}
${RESPONSIVE}`
