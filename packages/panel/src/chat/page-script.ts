/**
 * chat/page-script —— 聊天室内联脚本单源（page.ts 服务端渲染注入；纯字符串拼装，零 IO）。
 *
 * 拆出独立件：page.ts 只留 HTML/样式，脚本本体在此（v3 第二刀 §十.3 后两件各自远离
 * 600 行阈）。行为（既有契约零变化＋加法式增强）：
 *   - 房间轮询/消息轮询/已读上报/发送（Enter 发送 Shift+Enter 换行）——原样；
 *   - 房间过滤（#roomFilter）、当前房间消息过滤＋<mark> 高亮（#msgFilter）——纯前端，
 *     不触 chatd、不改 API 面；
 *   - @补全（CONFIG.peopleUrl 在场才启用；输入 @ 弹在册工号列表，点击/键盘插入）；
 *   - draft 预填（/chat?draft= → 输入框预填）、room 预选（/chat?room= → 进入即选房间）；
 *   - linkify（chat/linkify.ts 单源正则注入：白名单 http(s)，正文其余 textContent 注入，
 *     零 innerHTML——转义安全性不依赖字符串拼接）。
 * 安全（对话页判例）：消息正文一律 DOM API 注入；CONFIG 仅服务端可信值且 `<` 转义；
 * token 永不进页面。
 */
import { HOST_PATH_MASK_SOURCE } from './mask.ts'
import { LINK_RE_SOURCE } from './linkify.ts'

/** 页面脚本配置（全部为服务端可信值；`<` 注入时转义防 </script> 逃逸） */
export interface ChatScriptConfig {
  readonly enabled: boolean
  readonly actor: string
  readonly pollIntervalMs: number
  /** 输入框预填文案（/chat?draft=；服务端已净化） */
  readonly draft?: string
  /** 进入即选房间（/chat?room=；服务端已净化） */
  readonly room?: string
  /** @补全人员源（门户传 /api/org；缺省无=补全关闭） */
  readonly peopleUrl?: string
}

export function chatPageScript(config: ChatScriptConfig): string {
  return `(function () {
  'use strict';
  var CONFIG = ${JSON.stringify({ enabled: config.enabled, actor: config.actor, pollIntervalMs: config.pollIntervalMs, ...(config.draft !== undefined ? { draft: config.draft } : {}), ...(config.room !== undefined ? { room: config.room } : {}), ...(config.peopleUrl !== undefined ? { peopleUrl: config.peopleUrl } : {}) }).replaceAll('<', '\\u003c')};
  var state = { roomId: null, actor: CONFIG.actor, rooms: [], unreadTotal: null, msgs: [], people: null, mention: null, mentionSel: 0 };
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

  // 显示层脱敏（chat/mask.ts 同源注入）：主机绝对路径 → <path>（只改显示，不改数据）
  var HOST_PATH_RE = new RegExp(${JSON.stringify(HOST_PATH_MASK_SOURCE).replaceAll('<', '\\u003c')}, 'g');
  function maskHostPaths(text) {
    return text === undefined || text === null ? text : String(text).replace(HOST_PATH_RE, '<path>');
  }
  // linkify（chat/linkify.ts 同源注入）：白名单 http(s) URL → 可点击 <a>；其余纯文本
  var LINK_SOURCE = ${JSON.stringify(LINK_RE_SOURCE).replaceAll('<', '\\u003c')};
  function isSafeLink(href) {
    return /^https?:\\/\\//i.test(href);
  }
  function appendHighlight(node, text, needle) {
    if (!needle) { node.appendChild(document.createTextNode(text)); return; }
    var lower = text.toLowerCase();
    var n = needle.toLowerCase();
    var pos = 0;
    var hit = lower.indexOf(n, pos);
    while (hit !== -1) {
      if (hit > pos) node.appendChild(document.createTextNode(text.slice(pos, hit)));
      node.appendChild(el('mark', null, text.slice(hit, hit + n.length)));
      pos = hit + n.length;
      hit = lower.indexOf(n, pos);
    }
    if (pos < text.length) node.appendChild(document.createTextNode(text.slice(pos)));
  }
  function appendRichText(node, text, needle) {
    var masked = maskHostPaths(text);
    var re = new RegExp(LINK_SOURCE, 'g');
    var last = 0;
    var m = re.exec(masked);
    while (m !== null) {
      appendHighlight(node, masked.slice(last, m.index), needle);
      var href = m[0];
      if (isSafeLink(href)) {
        var a = el('a', 'link', href);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        node.appendChild(a);
      } else {
        appendHighlight(node, href, needle);
      }
      last = m.index + href.length;
      m = re.exec(masked);
    }
    appendHighlight(node, masked.slice(last), needle);
  }

  // chatd 侧失效族（未配置/未连接/不可达/超时）：可读降级文案，不当内部错误渲染
  function isChatdDown(code) {
    return code === 'CHAT_PANEL_DISABLED' || code === 'WB_NOT_CONNECTED' || code === 'WB_UNAVAILABLE' || code === 'WB_TIMEOUT';
  }

  // 读面失败 → 降级文案（成员未入/房间缺/chatd 缺三族可读化；其余原样带码）
  function degradeText(action, err) {
    var code = errCode(err);
    if (code === 'WB_INVALID_ARGUMENT') return '操作者 ' + state.actor + ' 不是该房间成员——无法' + action + '（切换房间，或在上方操作者栏改为在册工号）';
    if (isChatdDown(code)) return action + '不可用：chatd 未配置或不可达（chatd 起后自动恢复）';
    return action + '失败：' + err.message;
  }

  function roomNeedle() {
    var input = $('roomFilter');
    return input ? input.value.trim().toLowerCase() : '';
  }
  function visibleRooms() {
    var needle = roomNeedle();
    if (!needle) return state.rooms;
    return state.rooms.filter(function (room) {
      return String(room.roomId || '').toLowerCase().indexOf(needle) !== -1 || String(room.name || '').toLowerCase().indexOf(needle) !== -1;
    });
  }
  function renderRooms() {
    var box = $('rooms');
    box.textContent = '';
    var rooms = visibleRooms();
    if (rooms.length === 0) {
      box.appendChild(el('div', 'title', state.rooms.length === 0 ? '（无房间——chatd rooms.list 为空）' : '（无匹配房间）'));
    }
    rooms.forEach(function (room) {
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

  function messageNeedle() {
    var input = $('msgFilter');
    return input ? input.value.trim() : '';
  }
  function renderMessages(items) {
    var box = $('messages');
    box.textContent = '';
    var needle = messageNeedle();
    var shown = items || [];
    if (needle) {
      shown = shown.filter(function (message) { return String(message.body || '').toLowerCase().indexOf(needle.toLowerCase()) !== -1; });
    }
    var count = $('msgCount');
    if (count) count.textContent = needle ? ('匹配 ' + String(shown.length) + '/' + String((items || []).length)) : '';
    if (shown.length === 0) {
      box.appendChild(el('div', 'title', needle ? '（无匹配消息）' : '（无消息——选中房间后自动标记已读）'));
      box.scrollTop = box.scrollHeight;
      return;
    }
    shown.forEach(function (message) {
      var mine = message.senderId === state.actor;
      var node = el('div', 'msg' + (mine ? ' mine' : ''));
      var when = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
      node.appendChild(el('div', 'who', (message.senderId || '?') + ' · ' + when + ' · #' + String(message.roomSeq)));
      var body = el('div', 'body');
      // 正文渲染单点：脱敏（幂等，先罩主机路径）→ linkify（白名单 http(s)）→ 高亮；
      // appendRichText 内部再脱敏一次（幂等无害），此显式调用即「渲染处套用」守门位
      appendRichText(body, maskHostPaths(message.body), needle);
      node.appendChild(body);
      box.appendChild(node);
    });
    box.scrollTop = box.scrollHeight;
  }

  function loadRooms() {
    return api('/api/chat/rooms' + actorParam()).then(function (data) {
      state.rooms = data.rooms || [];
      state.unreadTotal = data.totalUnread === undefined || data.totalUnread === null ? null : data.totalUnread;
      renderRooms();
      if (state.roomId === null && state.rooms.length > 0) {
        var wanted = CONFIG.room || null;
        var chosen = null;
        if (wanted !== null) {
          for (var i = 0; i < state.rooms.length; i++) { if (state.rooms[i].roomId === wanted) { chosen = wanted; break; } }
        }
        switchRoom(chosen || state.rooms[0].roomId);
      }
    });
  }

  function loadMessages() {
    if (state.roomId === null) return Promise.resolve();
    return api('/api/chat/messages' + actorParam({ roomId: state.roomId, limit: 100 })).then(function (data) {
      var items = (data.page && data.page.items) || [];
      state.msgs = items;
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
    var filter = $('msgFilter');
    if (filter) filter.value = '';
    loadMessages().catch(function (err) {
      setBanner(degradeText('读取消息', err));
      if (errCode(err) === 'WB_INVALID_ARGUMENT') renderMessages([]);
    });
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
      setStatus(degradeText('发送', err), true);
      throw err;
    });
  }

  // —— 房间/消息过滤（纯前端；不触 chatd） ——
  $('roomFilter').addEventListener('input', renderRooms);
  $('msgFilter').addEventListener('input', function () { renderMessages(state.msgs); });

  // —— @补全（CONFIG.peopleUrl 在场才启用；人员来自 /api/org 同源快照） ——
  function ensurePeople() {
    if (state.people !== null || !CONFIG.peopleUrl) return Promise.resolve();
    return fetch(CONFIG.peopleUrl).then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
      var list = data && Array.isArray(data.people) ? data.people : [];
      state.people = [];
      list.forEach(function (p) {
        if (p && typeof p.id === 'string' && p.id !== '') state.people.push({ id: p.id, name: p.name || '', dept: p.deptName || p.dept || '' });
      });
    }).catch(function () { state.people = []; });
  }
  function detectMention() {
    if (!state.people || state.people.length === 0) return null;
    var input = $('text');
    var pos = input.selectionStart;
    var head = input.value.slice(0, pos);
    var m = /(^|[\\s（(【])@([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(head);
    return m === null ? null : { start: pos - m[2].length - 1, query: m[2].toLowerCase() };
  }
  function hideMention() {
    state.mention = null;
    var box = $('mentionBox');
    box.hidden = true;
    box.textContent = '';
  }
  function renderMention() {
    var hit = detectMention();
    var box = $('mentionBox');
    if (hit === null) { hideMention(); return; }
    var matches = [];
    state.people.forEach(function (p) {
      if (matches.length >= 8) return;
      var hay = (p.id + ' ' + p.name + ' ' + p.dept).toLowerCase();
      if (hit.query === '' || hay.indexOf(hit.query) !== -1) matches.push(p);
    });
    if (matches.length === 0) { hideMention(); return; }
    state.mention = { start: hit.start, matches: matches };
    if (state.mentionSel >= matches.length) state.mentionSel = 0;
    box.textContent = '';
    matches.forEach(function (p, idx) {
      var item = el('button', 'mention-item' + (idx === state.mentionSel ? ' active' : ''));
      item.type = 'button';
      item.appendChild(el('b', null, '@' + p.id));
      item.appendChild(el('span', null, p.name + (p.dept ? '（' + p.dept + '）' : '')));
      item.addEventListener('mousedown', function (ev) { ev.preventDefault(); insertMention(idx); });
      box.appendChild(item);
    });
    box.hidden = false;
  }
  function insertMention(idx) {
    var hit = state.mention;
    if (hit === null || !hit.matches[idx]) { hideMention(); return; }
    var input = $('text');
    var pos = input.selectionStart;
    var value = input.value;
    input.value = value.slice(0, hit.start + 1) + hit.matches[idx].id + ' ' + value.slice(pos);
    var next = hit.start + 1 + hit.matches[idx].id.length + 1;
    input.focus();
    input.setSelectionRange(next, next);
    hideMention();
  }

  $('actor').value = state.actor;
  $('actor').addEventListener('change', function () {
    var value = $('actor').value.trim();
    if (!value) { $('actor').value = state.actor; return; }
    state.actor = value;
    loadRooms().catch(function (err) { setBanner(degradeText('读取房间', err)); });
  });

  $('sendForm').addEventListener('submit', function (event) {
    event.preventDefault();
    hideMention();
    if (state.roomId === null) { setStatus('未选中房间', true); return; }
    var input = $('text');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendText(text).catch(function () { input.value = text; });
  });

  $('text').addEventListener('input', renderMention);
  $('text').addEventListener('keydown', function (event) {
    var visible = state.mention !== null;
    if (visible && event.key === 'ArrowDown') { event.preventDefault(); state.mentionSel = (state.mentionSel + 1) % state.mention.matches.length; renderMention(); return; }
    if (visible && event.key === 'ArrowUp') { event.preventDefault(); state.mentionSel = (state.mentionSel + state.mention.matches.length - 1) % state.mention.matches.length; renderMention(); return; }
    if (visible && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); insertMention(state.mentionSel); return; }
    if (event.key === 'Escape') { hideMention(); return; }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('sendForm').requestSubmit();
    }
  });

  // —— 预填/预选（§十.3：/chat?draft=&room=） ——
  if (CONFIG.draft) {
    var draftInput = $('text');
    if (!draftInput.value) draftInput.value = CONFIG.draft;
    draftInput.focus();
  }
  ensurePeople();
  loadRooms().catch(function (err) { setBanner(degradeText('读取房间', err)); });
  window.setInterval(function () {
    loadRooms().catch(function () { /* 轮询失败不刷屏；下周期重试 */ });
    loadMessages().catch(function () { });
  }, CONFIG.pollIntervalMs);
})();`
}
