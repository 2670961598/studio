/**
 * chat/page —— 面板自研聊天室页（服务端渲染壳＋原生 JS 轮询；M4-3 最小刀）
 *
 * 依据：docs/plan/06-…-2026-11-19.md §四.1（聊天室 UI=panel 新页：房间列表＋消息流＋
 * 输入＋未读数）；docs/16-§二 Web 选型（零新前端依赖——原生 JS，不进 Vue 换装壳）。
 *
 * 安全（对话页 page.ts 判例）：消息正文一律 textContent 注入（不拼 innerHTML）；
 * 页面无内联用户数据（CONFIG 仅数字/布尔/缺省工号——服务端可信值）；token 永不进页面。
 * 显示层脱敏（chat/mask.ts 同源）：正文渲染前经 maskHostPaths 把主机绝对路径
 * （/Volumes/… /Users/… /home/… C:\…）替换为 `<path>`——只读卫生面，不改 chatd 数据。
 * 未启用态：整页降级「未启用」说明（不报错不白屏），API 面 503（fail-closed 不冒充空列表）。
 */

import { chatPageScript } from './page-script.ts'

/** 页面渲染选项（全部为服务端可信值） */
export interface ChatPageOptions {
  /** chatd 已配置（transport 已装配）；false=未启用降级页 */
  readonly enabled: boolean
  /** 缺省操作者工号（chatd 按房间成员校验） */
  readonly defaultActorId: string
  /** 轮询间隔 ms（缺省 2000；非正数落回缺省） */
  readonly pollIntervalMs?: number
  /** 输入框预填文案（§十.3：/chat?draft= → route 侧净化后透传；缺省无预填） */
  readonly draft?: string
  /** 进入即选房间（§十.3：/chat?room=；缺省=首个实存房间） */
  readonly room?: string
  /** @补全人员源（§十.3：门户传 /api/org；缺省不传=补全关闭——监控面行为零变化） */
  readonly peopleUrl?: string
}

interface PageConfig {
  readonly enabled: boolean
  readonly actor: string
  readonly pollIntervalMs: number
  readonly draft?: string
  readonly room?: string
  readonly peopleUrl?: string
}

function pageConfigOf(opts: ChatPageOptions): PageConfig {
  const pollRaw = opts.pollIntervalMs
  const poll = typeof pollRaw === 'number' && Number.isInteger(pollRaw) && pollRaw > 0 ? pollRaw : 2000
  return {
    enabled: opts.enabled,
    actor: opts.defaultActorId,
    pollIntervalMs: poll,
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
    ...(opts.room !== undefined ? { room: opts.room } : {}),
    ...(opts.peopleUrl !== undefined ? { peopleUrl: opts.peopleUrl } : {}),
  }
}

/**
 * 渲染聊天室**内容片段**（enabled：main 两栏＋轮询脚本｜disabled：未启用降级卡）——
 * 单源供 renderChatPage（独立整页）与门户嵌装（apps/daemon assembly/portal，
 * docs/plan/11-公司门户-2026-11-23.md §1.2/§三）消费。嵌装方自备样式与布局；
 * 类名/容器 id 契约：.title/.room/.kind/.unread/.msg/.mine/.who/.body/.disabled-card 与
 * #rooms/#banner/#meta/#actor/#messages/#sendForm/#text/#send/#status（业务脚本按 id 取节点）。
 */
export function renderChatBody(opts: ChatPageOptions): string {
  const config = pageConfigOf(opts)
  return opts.enabled
    ? `<main>
  <aside>
    <div class="title">房间（未读）</div>
    <input id="roomFilter" type="search" placeholder="过滤房间…" aria-label="过滤房间">
    <div id="rooms"></div>
  </aside>
  <section>
    <div id="banner"></div>
    <div id="meta">操作者 <input id="actor" value="">（chatd 按房间成员校验）<span id="totalUnread"></span></div>
    <div class="msg-tools">
      <input id="msgFilter" type="search" placeholder="在当前房间内搜索…" aria-label="搜索当前房间消息">
      <span id="msgCount"></span>
    </div>
    <div id="messages"></div>
    <form id="sendForm">
      <div id="mentionBox" hidden></div>
      <textarea id="text" maxlength="4000" placeholder="发到当前房间…（Enter 发送，Shift+Enter 换行；@工号 触发唤醒）"></textarea>
      <button id="send" class="primary" type="submit">发送</button>
    </form>
    <div id="status"></div>
  </section>
</main>
<script>
${chatPageScript(config)}
</script>`
    : `<div class="disabled-card">
  <h2>聊天室未启用</h2>
  <p>自研聊天室视图默认关闭：面板未配置本地 chatd 连接。</p>
  <p>启用方式（运维 env，改后重启面板进程）：</p>
  <p><code>WORKBENCH_CHATD_SOCKET=&lt;chatd Unix socket 路径&gt;</code></p>
  <p><code>WORKBENCH_CHATD_TOKEN=&lt;鉴权 token（可选，chatd 配了才需要）&gt;</code></p>
  <p><code>PANEL_CHAT_ACTOR=&lt;缺省操作者工号（可选）&gt;</code></p>
  <p>未配置不报错：本页保持只读降级，<code>/api/chat/*</code> 一律 503。</p>
</div>`
}

/** 独立整页 favicon（内联 SVG data URI）：与门户壳同一图样（依赖方向 daemon→panel，
 *  故此处各持一份同图——门户 /chat 与独立页同标，浏览器标签不跳标）。零外链。 */
const CHAT_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#11151a"/><path d="M10 20V12l6 8v-8" fill="none" stroke="#6c9cff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v8" fill="none" stroke="#6c9cff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  )

/** 渲染聊天室页（独立整页；纯字符串；零 IO）——内容本体单源经 renderChatBody */
export function renderChatPage(opts: ChatPageOptions): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>聊天室 · Studio Next :8791</title>
<link rel="icon" href="${CHAT_FAVICON}">
<style>
  :root { color-scheme: light dark; --line:#d0d7de; --muted:#6a737d; --bg:#f6f8fa; --card:#fff; --accent:#0969da; --danger:#cf222e; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:#24292f; }
  header { display:flex; align-items:center; gap:12px; padding:10px 16px; background:var(--card); border-bottom:1px solid var(--line); }
  header h1 { font-size:15px; margin:0; }
  header .hint { color:var(--muted); font-size:12px; }
  header a { margin-left:auto; color:var(--accent); text-decoration:none; font-size:13px; }
  main { display:grid; grid-template-columns:240px 1fr; height:calc(100vh - 49px); }
  aside { border-right:1px solid var(--line); background:var(--card); overflow:auto; padding:8px; }
  aside .title { color:var(--muted); font-size:12px; padding:4px 8px; }
  aside input[type="search"] { width:100%; margin:0 0 6px; padding:5px 8px; border:1px solid var(--line); border-radius:6px; font:inherit; background:var(--card); color:inherit; }
  .room { display:flex; align-items:center; gap:6px; width:100%; text-align:left; border:0; background:transparent; padding:8px; border-radius:6px; cursor:pointer; }
  .room:hover, .room.active { background:var(--bg); }
  .room .name { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
  .room .kind { color:var(--muted); font-size:11px; }
  .room .unread { min-width:20px; text-align:center; font-size:11px; padding:1px 6px; border-radius:10px; background:var(--accent); color:#fff; }
  .room .unread.zero { display:none; }
  section { display:flex; flex-direction:column; min-width:0; }
  #banner { margin:8px 16px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#fff8c5; color:#4d2d00; font-size:13px; display:none; }
  #meta { display:flex; gap:8px; align-items:center; padding:8px 16px 0; color:var(--muted); font-size:12px; }
  #meta input { width:140px; padding:4px 8px; border:1px solid var(--line); border-radius:6px; font:inherit; }
  #messages { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:8px; }
  .msg-tools { display:flex; gap:8px; align-items:center; padding:8px 16px 0; }
  .msg-tools input { flex:1; max-width:340px; padding:5px 8px; border:1px solid var(--line); border-radius:6px; font:inherit; background:var(--card); color:inherit; }
  .msg-tools span { color:var(--muted); font-size:12px; }
  mark { background:#fff8c5; color:inherit; border-radius:2px; padding:0 1px; }
  .msg .body a.link { color:var(--accent); word-break:break-all; }
  form { display:flex; gap:8px; padding:10px 16px; border-top:1px solid var(--line); background:var(--card); position:relative; }
  #mentionBox { position:absolute; bottom:100%; left:16px; right:16px; max-width:420px; max-height:240px; overflow:auto; background:var(--card); border:1px solid var(--line); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.14); z-index:5; }
  .mention-item { display:flex; gap:8px; align-items:baseline; width:100%; text-align:left; border:0; background:transparent; padding:7px 10px; cursor:pointer; font:inherit; }
  .mention-item.active, .mention-item:hover { background:var(--bg); }
  .mention-item span { color:var(--muted); font-size:12px; }
  .msg { max-width:72ch; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); }
  .msg.mine { align-self:flex-end; border-color:#0969da55; background:#ddf4ff; }
  .msg .who { color:var(--muted); font-size:11px; margin-bottom:2px; }
  .msg .body { white-space:pre-wrap; word-break:break-word; }
  form { display:flex; gap:8px; padding:10px 16px; border-top:1px solid var(--line); background:var(--card); }
  textarea { flex:1; min-height:44px; max-height:160px; resize:vertical; padding:8px; border:1px solid var(--line); border-radius:6px; font:inherit; }
  button { padding:8px 14px; border:1px solid var(--line); border-radius:6px; background:var(--card); cursor:pointer; font:inherit; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  #status { padding:0 16px 10px; color:var(--muted); font-size:12px; min-height:18px; }
  .disabled-card { margin:40px auto; max-width:560px; padding:20px 24px; border:1px solid var(--line); border-radius:8px; background:var(--card); }
  .disabled-card h2 { font-size:15px; margin:0 0 8px; }
  .disabled-card code { background:var(--bg); padding:1px 5px; border-radius:4px; font-size:12px; }
  .disabled-card p { color:var(--muted); font-size:13px; margin:6px 0; }
</style>
</head>
<body>
<header>
  <h1>聊天室（自研 chatd）</h1>
  <span class="hint">rooms / messages / 未读 · Transport v1 · 本地 socket</span>
  <a href="/">← 监控面</a>
</header>
${renderChatBody(opts)}
</body>
</html>`
}
