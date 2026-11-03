/**
 * conversation/page —— 面板对话页（服务端渲染壳＋原生 JS 轮询；studio-dev-647 · Phase 2）
 *
 * 依据：docs/v2/14-§8.1（页面含会话列表＋消息流＋输入＋clear；轮询缺省 2s）、
 * docs/21-§7.2（发送回显 pending→sent、失败标 failed 可重试、clear 后整屏重置）。
 *
 * 安全：消息正文一律经 textContent 注入（不拼 innerHTML）；制作人令牌只存 sessionStorage，
 * 不写 cookie/localStorage，不进 URL。页面无内联用户数据（配置仅数字/布尔/工号）。
 */

/** 页面渲染选项（全部为服务端可信值） */
export interface ConversationPageOptions {
  readonly pollIntervalMs: number
  readonly storeWired: boolean
  readonly writeConfigured: boolean
  readonly producerId: string
}

interface PageConfig {
  readonly pollIntervalMs: number
  readonly storeWired: boolean
  readonly writeConfigured: boolean
  readonly producerId: string
}

/** 渲染对话页（纯字符串；零 IO） */
export function renderConversationPage(opts: ConversationPageOptions): string {
  const config: PageConfig = {
    pollIntervalMs: opts.pollIntervalMs,
    storeWired: opts.storeWired,
    writeConfigured: opts.writeConfigured,
    producerId: opts.producerId,
  }
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>制作人对话 · Studio Next :8791</title>
<style>
  :root { color-scheme: light dark; --line:#d0d7de; --muted:#6a737d; --bg:#f6f8fa; --card:#fff; --accent:#0969da; --danger:#cf222e; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:#24292f; }
  header { display:flex; align-items:center; gap:12px; padding:10px 16px; background:var(--card); border-bottom:1px solid var(--line); }
  header h1 { font-size:15px; margin:0; }
  header .hint { color:var(--muted); font-size:12px; }
  header a { margin-left:auto; color:var(--accent); text-decoration:none; font-size:13px; }
  main { display:grid; grid-template-columns:260px 1fr; height:calc(100vh - 49px); }
  aside { border-right:1px solid var(--line); background:var(--card); overflow:auto; padding:8px; }
  aside .title { color:var(--muted); font-size:12px; padding:4px 8px; }
  .conv { display:block; width:100%; text-align:left; border:0; background:transparent; padding:8px; border-radius:6px; cursor:pointer; }
  .conv:hover, .conv.active { background:var(--bg); }
  .conv .id { font-weight:600; }
  .conv .last { color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  section { display:flex; flex-direction:column; min-width:0; }
  #banner { margin:8px 16px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#fff8c5; color:#4d2d00; font-size:13px; display:none; }
  #messages { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:8px; }
  .msg { max-width:72ch; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); }
  .msg.mine { align-self:flex-end; border-color:#0969da55; background:#ddf4ff; }
  .msg .meta { color:var(--muted); font-size:11px; margin-bottom:2px; }
  .msg .body { white-space:pre-wrap; word-break:break-word; }
  .msg .state { font-size:11px; color:var(--muted); margin-top:4px; }
  .msg .state.failed { color:var(--danger); cursor:pointer; text-decoration:underline; }
  form { display:flex; gap:8px; padding:10px 16px; border-top:1px solid var(--line); background:var(--card); }
  textarea { flex:1; min-height:48px; max-height:160px; resize:vertical; padding:8px; border:1px solid var(--line); border-radius:6px; font:inherit; }
  button { padding:8px 14px; border:1px solid var(--line); border-radius:6px; background:var(--card); cursor:pointer; font:inherit; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  #clear { color:var(--danger); }
  #status { padding:0 16px 10px; color:var(--muted); font-size:12px; min-height:18px; }
</style>
</head>
<body>
<header>
  <h1>制作人 · 岗位对话</h1>
  <span class="hint">同一份会话：Matrix 端 ↔ 面板端（seq 游标同步）</span>
  <a href="/">← 监控面</a>
</header>
<main>
  <aside>
    <div class="title">会话（工号）</div>
    <div id="list"></div>
  </aside>
  <section>
    <div id="banner"></div>
    <div id="messages"></div>
    <form id="sendForm">
      <textarea id="text" maxlength="4000" placeholder="发给当前工号…（Enter 发送，Shift+Enter 换行）"></textarea>
      <button id="clear" type="button" title="清空会话（保留审计）">clear</button>
      <button id="send" class="primary" type="submit">发送</button>
    </form>
    <div id="status"></div>
  </section>
</main>
<script>
(function () {
  'use strict';
  var CONFIG = ${JSON.stringify(config)};
  var TOKEN_KEY = 'studio.producerToken';
  var state = { personId: CONFIG.producerId, after: 0, messages: [], list: [], clearSeq: 0, clearedAt: null };
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

  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(value) {
    try { sessionStorage.setItem(TOKEN_KEY, value); } catch (e) { /* 隐私模式：仅本次内存 */ }
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error && data.error.subcause) || ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function authHeaders(extra) {
    var headers = extra || {};
    var value = token();
    if (value) headers['X-Studio-Producer-Token'] = value;
    return headers;
  }

  function messageNode(message, status) {
    var mine = message.from && message.from.kind === 'producer';
    var node = el('div', 'msg' + (mine ? ' mine' : ''));
    var who = mine ? '制作人' : (message.from && message.from.ref) || '岗位';
    var when = message.at ? new Date(message.at).toLocaleString() : '待发送';
    node.appendChild(el('div', 'meta', who + ' · ' + when + (message.seq ? ' · #' + message.seq : '')));
    node.appendChild(el('div', 'body', message.text));
    if (status === 'pending') node.appendChild(el('div', 'state', '发送中…'));
    if (status === 'failed') {
      var retry = el('div', 'state failed', '发送失败 · 点击重试');
      retry.addEventListener('click', function () { retryMessage(message); });
      node.appendChild(retry);
    }
    return node;
  }

  function renderMessages() {
    var box = $('messages');
    box.textContent = '';
    if (state.clearedAt) box.appendChild(el('div', 'meta', '会话已于 ' + new Date(state.clearedAt).toLocaleString() + ' 被 clear（审计记录保留）'));
    state.messages.forEach(function (message) {
      if (message.kind === 'clear') return;
      box.appendChild(messageNode(message, message._state || 'sent'));
    });
    box.scrollTop = box.scrollHeight;
  }

  function renderList() {
    var box = $('list');
    box.textContent = '';
    if (state.list.length === 0) {
      box.appendChild(el('div', 'title', CONFIG.storeWired ? '（暂无会话）' : '（存储未接线）'));
      return;
    }
    state.list.forEach(function (item) {
      var button = el('button', 'conv' + (item.personId === state.personId ? ' active' : ''));
      button.appendChild(el('div', 'id', item.personId + ' · ' + item.count + ' 条'));
      button.appendChild(el('div', 'last', item.lastText || '（空会话）'));
      button.addEventListener('click', function () { switchPerson(item.personId); });
      box.appendChild(button);
    });
  }

  function loadList() {
    return api('/api/conversations').then(function (data) {
      state.list = data.conversations || [];
      renderList();
    }).catch(function (err) {
      if (err.status === 503) setBanner('会话存储未接线（Phase 1 #646 未落仓）：读/写均不可用。');
      else setBanner('会话列表读取失败：' + err.message);
    });
  }

  function loadHistory(reset) {
    var path = '/api/conversations/' + encodeURIComponent(state.personId);
    if (!reset && state.after > 0) path += '?after=' + state.after;
    return api(path).then(function (data) {
      var view = data.view;
      if (!view) return;
      if (reset || view.reset) {
        state.messages = [];
        state.after = 0;
        state.clearSeq = view.clearSeq;
        state.clearedAt = view.clearedAt;
      }
      var known = {};
      state.messages.forEach(function (m) { known[m.id] = true; });
      view.messages.forEach(function (m) { if (!known[m.id] && !m._state) state.messages.push(m); });
      state.messages.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
      state.after = view.version;
      state.clearSeq = view.clearSeq;
      state.clearedAt = view.clearedAt;
      renderMessages();
    });
  }

  function switchPerson(personId) {
    if (!personId) return;
    state.personId = personId;
    state.after = 0;
    state.messages = [];
    state.clearSeq = 0;
    state.clearedAt = null;
    setBanner('');
    loadHistory(true).catch(function (err) { setBanner('历史读取失败：' + err.message); });
    renderList();
  }

  function requestToken() {
    var value = window.prompt('该操作需要制作人凭据（只存本页 sessionStorage，不写 cookie）：');
    if (value) { setToken(value.trim()); return true; }
    return false;
  }

  function postMessage(text, clientMsgId) {
    return api('/api/conversations/' + encodeURIComponent(state.personId) + '/messages', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: text, clientMsgId: clientMsgId })
    });
  }

  function sendText(text, clientMsgId) {
    var pending = { id: 'pending-' + clientMsgId, kind: 'message', seq: 0, at: Date.now(), text: text, from: { kind: 'producer', ref: CONFIG.producerId }, _state: 'pending', clientMsgId: clientMsgId };
    state.messages.push(pending);
    renderMessages();
    setStatus('发送中…');
    return postMessage(text, clientMsgId).then(function (data) {
      state.messages = state.messages.filter(function (m) { return m.id !== pending.id; });
      if (!state.messages.some(function (m) { return m.id === data.message.id; })) state.messages.push(data.message);
      state.messages.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
      state.after = Math.max(state.after, data.message.seq || 0);
      renderMessages();
      setStatus(data.deduped ? '已存在（幂等去重）' : '已发送');
      loadList();
      return data;
    }).catch(function (err) {
      if ((err.status === 401 || err.status === 403) && requestToken()) {
        state.messages = state.messages.filter(function (m) { return m.id !== pending.id; });
        return sendText(text, clientMsgId);
      }
      pending._state = 'failed';
      renderMessages();
      setStatus('发送失败：' + err.message, true);
      throw err;
    });
  }

  function retryMessage(message) {
    if (!message.clientMsgId) return;
    state.messages = state.messages.filter(function (m) { return m.id !== message.id; });
    sendText(message.text, message.clientMsgId).catch(function () {});
  }

  function clearConversation() {
    if (!window.confirm('清空与 ' + state.personId + ' 的对话？历史将不可见，但 clear 审计记录保留。')) return;
    api('/api/conversations/' + encodeURIComponent(state.personId) + '/clear', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason: 'panel-clear' })
    }).then(function () {
      state.messages = [];
      state.after = 0;
      setStatus('已 clear（审计记录保留）');
      return loadHistory(true);
    }).then(loadList).catch(function (err) {
      if ((err.status === 401 || err.status === 403) && requestToken()) { clearConversation(); return; }
      setStatus('clear 失败：' + err.message, true);
    });
  }

  $('sendForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!CONFIG.storeWired) { setStatus('存储未接线，无法发送', true); return; }
    var input = $('text');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    var clientMsgId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    sendText(text, clientMsgId).catch(function () { input.value = text; });
  });

  $('text').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('sendForm').requestSubmit();
    }
  });

  $('clear').addEventListener('click', function () {
    if (!CONFIG.storeWired) { setStatus('存储未接线，无法 clear', true); return; }
    clearConversation();
  });

  if (!CONFIG.storeWired) {
    setBanner('会话存储未接线（Phase 1 #646 未落仓）：页面只读降级，读/写 API 均 503。');
    $('send').disabled = true;
    $('clear').disabled = true;
  } else if (!CONFIG.writeConfigured) {
    setBanner('写凭据未配置（STUDIO_PANEL_PRODUCER_TOKEN 缺省）：只读访客可读，写入一律 503。');
  }

  $('list').appendChild(el('div', 'title', '加载中…'));
  loadHistory(true).catch(function (err) { setBanner('历史读取失败：' + err.message); });
  loadList();
  window.setInterval(function () {
    if (!CONFIG.storeWired) return;
    loadHistory(false).catch(function () { /* 轮询失败不刷屏；下周期重试 */ });
  }, CONFIG.pollIntervalMs);
})();
</script>
</body>
</html>`
}
