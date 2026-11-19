/**
 * chat/page —— 面板自研聊天室页（服务端渲染壳＋原生 JS 轮询；M4-3 最小刀）
 *
 * 依据：docs/plan/06-…-2026-11-19.md §四.1（聊天室 UI=panel 新页：房间列表＋消息流＋
 * 输入＋未读数）；docs/16-§二 Web 选型（零新前端依赖——原生 JS，不进 Vue 换装壳）。
 *
 * 安全（对话页 page.ts 判例）：消息正文一律 textContent 注入（不拼 innerHTML）；
 * 页面无内联用户数据（CONFIG 仅数字/布尔/缺省工号——服务端可信值）；token 永不进页面。
 * 未启用态：整页降级「未启用」说明（不报错不白屏），API 面 503（fail-closed 不冒充空列表）。
 */

/** 页面渲染选项（全部为服务端可信值） */
export interface ChatPageOptions {
  /** chatd 已配置（transport 已装配）；false=未启用降级页 */
  readonly enabled: boolean
  /** 缺省操作者工号（chatd 按房间成员校验） */
  readonly defaultActorId: string
  /** 轮询间隔 ms（缺省 2000；非正数落回缺省） */
  readonly pollIntervalMs?: number
}

interface PageConfig {
  readonly enabled: boolean
  readonly actor: string
  readonly pollIntervalMs: number
}

/** 渲染聊天室页（纯字符串；零 IO） */
export function renderChatPage(opts: ChatPageOptions): string {
  const pollRaw = opts.pollIntervalMs
  const poll = typeof pollRaw === 'number' && Number.isInteger(pollRaw) && pollRaw > 0 ? pollRaw : 2000
  const config: PageConfig = { enabled: opts.enabled, actor: opts.defaultActorId, pollIntervalMs: poll }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>聊天室 · Studio Next :8791</title>
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
${
  opts.enabled
    ? `<main>
  <aside>
    <div class="title">房间（未读）</div>
    <div id="rooms"></div>
  </aside>
  <section>
    <div id="banner"></div>
    <div id="meta">操作者 <input id="actor" value="">（chatd 按房间成员校验）<span id="totalUnread"></span></div>
    <div id="messages"></div>
    <form id="sendForm">
      <textarea id="text" maxlength="4000" placeholder="发到当前房间…（Enter 发送，Shift+Enter 换行；@工号 触发唤醒）"></textarea>
      <button id="send" class="primary" type="submit">发送</button>
    </form>
    <div id="status"></div>
  </section>
</main>
<script>
(function () {
  'use strict';
  var CONFIG = ${JSON.stringify(config)};
  var state = { roomId: null, actor: CONFIG.actor, rooms: [], unreadTotal: null, sent: {} };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function setStatus(text, isError) {
    var node = $('status');
    node.textContent = text || '';
    node.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  }
  function setBanner(text) {
    var node = $('banner');
    node.textContent = text || '';
    node.style.display = text ? 'block' : 'none';
  }
  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) {
          var err = new Error((data && data.error && (data.error.code + ': ' + data.error.message)) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }
  function actorParam(extra) {
    var params = extra || {};
    params.actor = state.actor;
    var pairs = [];
    for (var key in params) { if (params[key] !== undefined && params[key] !== null) pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key])); }
    return pairs.length > 0 ? ('?' + pairs.join('&')) : '';
  }
  function errCode(err) { return (err && err.message && err.message.split(':')[0]) || ''; }

  function renderRooms() {
    var box = $('rooms');
    box.textContent = '';
    if (state.rooms.length === 0) { box.appendChild(el('div', 'title', '（无房间——chatd rooms.list 为空）')); return; }
    state.rooms.forEach(function (room) {
      var unread = room.unread === null || room.unread === undefined ? 0 : room.unread;
      var button = el('button', 'room' + (room.roomId === state.roomId ? ' active' : ''));
      button.appendChild(el('span', 'name', room.name || room.roomId));
      button.appendChild(el('span', 'kind', room.kind || ''));
      var badge = el('span', 'unread' + (unread > 0 ? '' : ' zero'), String(unread));
      badge.title = '未读';
      button.appendChild(badge);
      button.addEventListener('click', function () { switchRoom(room.roomId); });
      box.appendChild(button);
    });
    $('totalUnread').textContent = state.unreadTotal === null ? '' : ('合计未读 ' + String(state.unreadTotal));
  }

  function renderMessages(items) {
    var box = $('messages');
    box.textContent = '';
    if (!items || items.length === 0) { box.appendChild(el('div', 'title', '（无消息——选中房间后自动标记已读）')); return; }
    items.forEach(function (message) {
      var mine = message.senderId === state.actor;
      var node = el('div', 'msg' + (mine ? ' mine' : ''));
      var when = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
      node.appendChild(el('div', 'who', (message.senderId || '?') + ' · ' + when + ' · #' + String(message.roomSeq)));
      node.appendChild(el('div', 'body', message.body));
      box.appendChild(node);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadRooms() {
    return api('/api/chat/rooms' + actorParam()).then(function (data) {
      state.rooms = data.rooms || [];
      state.unreadTotal = data.totalUnread === undefined || data.totalUnread === null ? null : data.totalUnread;
      renderRooms();
      if (state.roomId === null && state.rooms.length > 0) switchRoom(state.rooms[0].roomId);
    });
  }

  function loadMessages() {
    if (state.roomId === null) return Promise.resolve();
    return api('/api/chat/messages' + actorParam({ roomId: state.roomId, limit: 100 })).then(function (data) {
      var items = (data.page && data.page.items) || [];
      renderMessages(items);
      var top = 0;
      items.forEach(function (m) { if (m.roomSeq > top) top = m.roomSeq; });
      if (top > 0) markRead(top);
    });
  }

  function markRead(upToRoomSeq) {
    return api('/api/chat/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: state.roomId, actorId: state.actor, upToRoomSeq: upToRoomSeq })
    }).then(function (data) {
      if (data.result && typeof data.result.unread === 'number') {
        state.rooms.forEach(function (room) { if (room.roomId === state.roomId) room.unread = data.result.unread; });
        renderRooms();
      }
    });
  }

  function switchRoom(roomId) {
    state.roomId = roomId;
    setBanner('');
    renderRooms();
    loadMessages().catch(function (err) { setBanner('消息读取失败：' + err.message); });
  }

  function sendText(text) {
    var key = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    setStatus('发送中…');
    return api('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: state.roomId, senderId: state.actor, body: text, idempotencyKey: 'panel-' + key })
    }).then(function (data) {
      setStatus(data.result && data.result.replayed ? '已存在（幂等回放）' : '已发送');
      return loadMessages().then(loadRooms);
    }).catch(function (err) {
      setStatus('发送失败：' + err.message, true);
      throw err;
    });
  }

  $('actor').value = state.actor;
  $('actor').addEventListener('change', function () {
    var value = $('actor').value.trim();
    if (!value) { $('actor').value = state.actor; return; }
    state.actor = value;
    loadRooms().catch(function (err) { setBanner('房间读取失败：' + err.message); });
  });

  $('sendForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (state.roomId === null) { setStatus('未选中房间', true); return; }
    var input = $('text');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendText(text).catch(function () { input.value = text; });
  });

  $('text').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('sendForm').requestSubmit();
    }
  });

  loadRooms().catch(function (err) { setBanner('房间读取失败：' + err.message + (errCode(err) === 'CHAT_PANEL_DISABLED' ? '（chatd 未配置）' : '')); });
  window.setInterval(function () {
    loadRooms().catch(function () { /* 轮询失败不刷屏；下周期重试 */ });
    loadMessages().catch(function () { });
  }, CONFIG.pollIntervalMs);
})();
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
</body>
</html>`
}
