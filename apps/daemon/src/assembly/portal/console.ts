/**
 * portal/console —— 指令台（v3 第二刀，docs/plan/11-公司门户-2026-11-23.md §十.1）。
 *
 * 安全边界（§十.0）：唯一写通道=chatd 消息（ChatPanelTransport.sendMessage——与 /chat 页
 * 同一 Port、同一 token 注入面）；发送者=门户缺省操作者；正文 @工号 → chatd wake →
 * daemon 走既有建单派工链。**不直写平台/台账/公司目录**；平台唯一写入者仍是 daemon。
 *
 * 校验前置（过闸才触达 transport）：工号在册（org 快照全等）／text 非空 ≤4000（同
 * MAX_CHAT_BODY_CHARS）／roomId 在 rooms.list 实存；templateId 白名单；ticket 须票形。
 * 失败分类（§十.1 表）：chat-disabled(503)/missing-field/bad-template/text-too-long/
 * person-unknown/bad-ticket-id(400)/room-not-found(404)/transport WB_* 透传。
 *
 * 页面：岗位/房间/模板下拉＋文本区＋发送按钮＋确认卡＋操作审计（localStorage 最近 20 条，
 * 只存浏览器——服务端零落盘，不与台账事实源混淆）。
 */
import {
  classifyChatFailure,
  MAX_CHAT_BODY_CHARS,
  type ChatAppOptions,
  type ChatPanelErrorBody,
  type ChatPanelTransport,
} from '@studio-next/panel/chat'
import type { PortalData } from './data.ts'
import { emptyState, esc, icon, url } from './html.ts'
import { pageHead } from './layout.ts'

/** 发送编排超时（挂死 socket 不拖住页面；chatd 正常毫秒级） */
const SEND_TIMEOUT_MS = 8_000
/** POST /api/console/send 请求体上限（32KiB——文案上限 4000 字符，此阈只挡滥用） */
export const CONSOLE_SEND_BODY_MAX = 32 * 1024
/** 单号参数合法形（与 TICKET_ID_RE 同口径——本件自持一份避免环依赖 server.ts） */
const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface ConsoleTemplate {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly text: string
}

/** 模板白名单（§十.1 表；{{person}}/{{ticket}} 占位——服务端/客户端双端替换同源） */
export const CONSOLE_TEMPLATES: readonly ConsoleTemplate[] = [
  { id: 'create', label: '建单', hint: '描述＋验收标准', text: '@{{person}} 请处理：<描述>（验收：<标准>）' },
  { id: 'redraft', label: '重派', hint: '按原验收口径重做', text: '@{{person}} 重派单 {{ticket}}：请按原验收口径重做并落 REPORT' },
  { id: 'ask', label: '询问', hint: '进度与证据', text: '@{{person}} 请汇报 {{ticket}} 进度与证据' },
  { id: 'daily', label: '日报', hint: 'REPORT＋summary', text: '@{{person}} 请产出今日日报（REPORT+summary）' },
  { id: 'custom', label: '自定义', hint: '自由文案（@工号 …）', text: '' },
]

export const CONSOLE_DEFAULT_ROOM = 'room-1'

/** 模板取用（白名单外落缺省 create——页面导航宽容，发送不因模板 id 炸） */
export function consoleTemplate(id: string | undefined): ConsoleTemplate {
  return CONSOLE_TEMPLATES.find((t) => t.id === id) ?? (CONSOLE_TEMPLATES[0] as ConsoleTemplate)
}

/** 占位替换（未给值时保留占位符提示用户补写） */
export function fillConsoleTemplate(text: string, person: string | undefined, ticket: string | undefined): string {
  return text.replaceAll('{{person}}', person !== undefined && person !== '' ? person : '{{person}}').replaceAll('{{ticket}}', ticket !== undefined && ticket !== '' ? ticket : '{{ticket}}')
}

// ─────────────────────────── 发送：校验＋编排 ───────────────────────────

export interface ConsoleSendRequest {
  readonly person: string
  readonly roomId: string
  readonly templateId: string | undefined
  readonly text: string
  readonly ticket?: string
}

export type ConsoleSendFail = { readonly ok: false; readonly status: 400 | 404 | 502 | 503; readonly code: string; readonly message: string }

export type ConsoleSendOutcome =
  | { readonly ok: true; readonly seq: number; readonly roomSeq: number; readonly roomId: string; readonly message: string; readonly chatUrl: string; readonly replayed: boolean }
  | ConsoleSendFail

const failOf = (status: 400 | 404 | 502 | 503, code: string, message: string): ConsoleSendFail => ({ ok: false, status, code, message })

/** 请求体解析（形状/长度/白名单——工号在册与房间实存属数据面，见 sendConsoleMessage） */
export function parseConsoleSendBody(value: unknown): { ok: true; value: ConsoleSendRequest } | { ok: false; fail: ConsoleSendFail } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, fail: failOf(400, 'bad-json', '请求体须为 JSON 对象') }
  const raw = value as Record<string, unknown>
  const str = (k: string): string | undefined => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined)
  const person = str('person')
  const roomId = str('roomId')
  const text = str('text')
  if (person === undefined || person.trim() === '' || roomId === undefined || roomId.trim() === '') {
    return { ok: false, fail: failOf(400, 'missing-field', 'person 与 roomId 必填（非空字符串）') }
  }
  if (text === undefined || text.trim() === '') return { ok: false, fail: failOf(400, 'missing-field', 'text 必填（非空文案）') }
  if (text.length > MAX_CHAT_BODY_CHARS) {
    return { ok: false, fail: failOf(400, 'text-too-long', `文案超长（>${String(MAX_CHAT_BODY_CHARS)} 字符）`) }
  }
  const templateId = str('templateId')
  if (templateId !== undefined && !CONSOLE_TEMPLATES.some((t) => t.id === templateId)) {
    return { ok: false, fail: failOf(400, 'bad-template', `模板 ${templateId} 不在白名单（${CONSOLE_TEMPLATES.map((t) => t.id).join('/')}）`) }
  }
  const ticket = str('ticket')
  if (ticket !== undefined && ticket !== '' && !TICKET_RE.test(ticket)) {
    return { ok: false, fail: failOf(400, 'bad-ticket-id', `单号 ${ticket} 不是票形 id（^[A-Za-z0-9][A-Za-z0-9._-]*$）`) }
  }
  return { ok: true, value: { person: person.trim(), roomId: roomId.trim(), templateId, text, ...(ticket !== undefined && ticket !== '' ? { ticket } : {}) } }
}

const withTimeout = async <T>(p: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** transport 失败 → 稳定错误面（WB_* 稳定码透传＋HTTP 映射；本地错误 502 不伪装） */
function classifySendFailure(err: unknown): ConsoleSendFail {
  const f: ChatPanelErrorBody = classifyChatFailure(err).body
  const status = f.error.code === 'CHAT_PANEL_INTERNAL' ? 502 : 503
  return failOf(status as 502 | 503, f.error.code, f.error.message)
}

/**
 * 发送编排：在册校验 → 房间实存校验 → transport.sendMessage（发送者=门户缺省操作者；
 * mentions 不显式传——与已 e2e 验证的 /chat 发送路径逐字段一致，chatd 按正文 @工号 产 wake）。
 */
export async function sendConsoleMessage(opts: { chat: ChatAppOptions; data: PortalData; req: ConsoleSendRequest }): Promise<ConsoleSendOutcome> {
  const transport: ChatPanelTransport | null | undefined = opts.chat.transport
  if (transport === null || transport === undefined) {
    return failOf(503, 'chat-disabled', 'chatd 未配置：指令台经聊天唤醒链路发送，需启动时加 --chatd-socket（门户不直写平台/台账）')
  }
  if (!opts.data.org().people.some((p) => p.id === opts.req.person)) {
    return failOf(400, 'person-unknown', `工号 ${opts.req.person} 不在册（从 /org 名册选择岗位）`)
  }
  const auth = opts.chat.token !== undefined ? { token: opts.chat.token } : {}
  const senderId = opts.chat.defaultActorId !== undefined && opts.chat.defaultActorId !== '' ? opts.chat.defaultActorId : 'PRIME-0'
  try {
    const rooms = await withTimeout(transport.listRooms({ ...auth }), SEND_TIMEOUT_MS, 'chatd 房间查询超时')
    if (!rooms.some((r) => r.roomId === opts.req.roomId)) {
      // 实存房间列表截前 8 个——大房号环境（几百间）不让错误信息淹没可读性
      const shown = rooms.slice(0, 8).map((r) => r.roomId).join('、') || '无'
      const more = rooms.length > 8 ? ` 等 ${String(rooms.length)} 间` : ''
      return failOf(404, 'room-not-found', `房间 ${opts.req.roomId} 不存在（实存：${shown}${more}）`)
    }
    const result = await withTimeout(
      transport.sendMessage({ roomId: opts.req.roomId, senderId, body: opts.req.text, ...auth }),
      SEND_TIMEOUT_MS,
      'chatd 发送超时',
    )
    return {
      ok: true,
      seq: result.seq,
      roomSeq: result.roomSeq,
      roomId: opts.req.roomId,
      message: opts.req.text,
      chatUrl: `/chat?room=${url(opts.req.roomId)}`,
      replayed: result.replayed,
    }
  } catch (err) {
    return classifySendFailure(err)
  }
}

// ─────────────────────────── 页面 ───────────────────────────

/** /console 查询参（server 侧已校验：person 在册、ticket 票形；room 任意可见串） */
export interface ConsolePageQuery {
  readonly person: string
  readonly ticket: string
  readonly templateId: string
  readonly room: string
}

/** 页面配置（全部服务端可信值；CONFIG JSON 注入经 < 转义——chat 页判例） */
interface ConsolePageConfig {
  readonly roomsUrl: string
  readonly defaultRoom: string
  readonly person: string
  readonly ticket: string
  readonly templateId: string
  readonly templates: Readonly<Record<string, string>>
  readonly defaultRoomId: string
}

export function consoleBody(data: PortalData, q: ConsolePageQuery): string {
  const template = consoleTemplate(q.templateId)
  const people = data.org().people
  // 预填：?person/&ticket 在场即按模板替换占位（重派链路来自单子/会话详情按钮）
  const prefill = fillConsoleTemplate(template.text, q.person !== '' ? q.person : undefined, q.ticket !== '' ? q.ticket : undefined)
  const personSelected = q.person !== '' && people.some((p) => p.id === q.person)
  const templates = Object.fromEntries(CONSOLE_TEMPLATES.map((t) => [t.id, t.text]))
  const config: ConsolePageConfig = {
    roomsUrl: '/api/chat/rooms',
    defaultRoom: q.room !== '' ? q.room : CONSOLE_DEFAULT_ROOM,
    person: personSelected ? q.person : '',
    ticket: q.ticket,
    templateId: template.id,
    templates,
    defaultRoomId: CONSOLE_DEFAULT_ROOM,
  }

  const options = (list: readonly { value: string; label: string }[], selected: string): string =>
    list.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('\n        ')

  const personOptions = [{ value: '', label: '选择岗位…' }, ...people.map((p) => ({ value: p.id, label: `${p.id} ${p.name}（${p.deptName}）` }))]
  const templateOptions = CONSOLE_TEMPLATES.map((t) => ({ value: t.id, label: `${t.label} · ${t.hint}` }))

  const form = `<div class="card">
  <div class="card-head"><h2>${icon('send')}新指令</h2><span class="link-more">发送＝聊天消息（chatd 唤醒）</span></div>
  <div class="card-body console-form">
    <div class="console-grid">
      <label class="field"><span>岗位（接收工号）</span>
        <select id="consolePerson" aria-label="岗位">${options(personOptions, config.person)}</select></label>
      <label class="field"><span>房间</span>
        <select id="consoleRoom" aria-label="房间"><option value="${esc(CONSOLE_DEFAULT_ROOM)}">${esc(CONSOLE_DEFAULT_ROOM)}</option></select>
        <span class="field-hint" id="roomHint">读取房间列表中…</span></label>
      <label class="field"><span>模板</span>
        <select id="consoleTemplate" aria-label="模板">${options(templateOptions, template.id)}</select></label>
      <label class="field"><span>单号（重派/询问模板用）</span>
        <input id="consoleTicket" class="mono" value="${esc(q.ticket)}" placeholder="如 TICK-123（可空）" maxlength="128" aria-label="单号"></label>
    </div>
    <label class="field grow"><span>文案（≤${String(MAX_CHAT_BODY_CHARS)} 字符；@工号 触发唤醒）</span>
      <textarea id="consoleText" maxlength="${String(MAX_CHAT_BODY_CHARS)}" rows="5" aria-label="指令文案">${esc(prefill)}</textarea></label>
    <div class="console-actions">
      <button id="consoleSend" class="btn primary" type="button">${icon('send', 14)}发送…</button>
      <a class="btn ghost" href="/chat">${icon('chat', 14)}打开聊天</a>
    </div>
    <div id="consoleConfirm" class="console-confirm" hidden>
      <div class="cc-head">${icon('people', 14)}确认发送</div>
      <div class="cc-meta">接收：<b id="ccPerson" class="mono"></b> · 房间：<b id="ccRoom" class="mono"></b><span id="ccHint" class="cc-hint" hidden>⚠ 文案未含该工号的 @——将不会触发唤醒（仅入房间消息流）</span></div>
      <pre id="ccText" class="cc-text"></pre>
      <div class="cc-actions">
        <button id="confirmYes" class="btn primary" type="button">确认发送</button>
        <button id="confirmNo" class="btn ghost" type="button">取消</button>
      </div>
    </div>
    <div id="consoleStatus" class="console-status" role="status"></div>
  </div>
</div>`

  const audit = `<div class="card">
  <div class="card-head"><h2>${icon('clock')}操作审计</h2><span class="link-more">只存本浏览器（最近 20 条）· <button id="auditClear" class="btn ghost icon" type="button">清除</button></span></div>
  <div class="card-body"><div id="auditList" class="audit-list">${emptyState('dot', '暂无记录', '发送成功的指令会记在这里（仅本浏览器，服务端零落盘）')}</div></div>
</div>`

  const script = `<script>
(function () {
  'use strict';
  var CONFIG = ${JSON.stringify(config).replaceAll('<', '\\u003c')};
  var AUDIT_KEY = 'portal-console-audit';
  var AUDIT_MAX = 20;
  var $ = function (id) { return document.getElementById(id); };
  var currentTemplate = CONFIG.templateId;

  function fillText() {
    var text = CONFIG.templates[currentTemplate] || '';
    var person = $('consolePerson').value;
    var ticket = $('consoleTicket').value.trim();
    text = text.split('{{person}}').join(person || '{{person}}');
    text = text.split('{{ticket}}').join(ticket || '{{ticket}}');
    if (currentTemplate === 'custom') text = '';
    $('consoleText').value = text;
  }
  $('consoleTemplate').addEventListener('change', function () { currentTemplate = $('consoleTemplate').value; fillText(); });
  $('consoleTicket').addEventListener('change', function () {
    if (currentTemplate !== 'custom' && ($('consoleText').value === '' || window.confirm('按新单号重填模板文案？（取消保留当前文案）'))) fillText();
  });

  // 房间列表：实存房间刷新下拉（缺省 room-1；不在列时自动选第一个实存房间）
  fetch(CONFIG.roomsUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || d.ok !== true || !d.rooms || d.rooms.length === 0) throw new Error('no-rooms');
    var sel = $('consoleRoom');
    var prev = sel.value;
    sel.textContent = '';
    d.rooms.forEach(function (room) {
      var opt = document.createElement('option');
      opt.value = room.roomId;
      opt.textContent = (room.name ? room.name + ' · ' : '') + room.roomId;
      sel.appendChild(opt);
    });
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === prev; });
    sel.value = has ? prev : (Array.prototype.some.call(sel.options, function (o) { return o.value === CONFIG.defaultRoom; }) ? CONFIG.defaultRoom : sel.options[0].value);
    $('roomHint').textContent = '';
  }).catch(function () { $('roomHint').textContent = '房间列表不可用（chatd 未配置/不可达）——发送时服务端仍会校验房间实存'; });

  function setStatus(html, isError) {
    var node = $('consoleStatus');
    node.innerHTML = html;
    node.classList.toggle('err', isError === true);
  }

  // 审计（localStorage 最近 20 条；只存本浏览器）
  function auditRows() {
    try { var v = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, AUDIT_MAX) : []; } catch (e) { return []; }
  }
  function auditPush(row) {
    var rows = auditRows();
    rows.unshift(row);
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(rows.slice(0, AUDIT_MAX))); } catch (e) {}
    renderAudit();
  }
  function renderAudit() {
    var rows = auditRows();
    var box = $('auditList');
    box.textContent = '';
    if (rows.length === 0) { box.innerHTML = '<div class="empty"><div class="empty-title">暂无记录</div><div class="empty-hint">发送成功的指令会记在这里（仅本浏览器，服务端零落盘）</div></div>'; return; }
    rows.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'audit-row' + (row.ok ? '' : ' bad');
      var head = document.createElement('div');
      head.className = 't';
      var who = document.createElement('b');
      who.textContent = row.person;
      head.appendChild(who);
      head.appendChild(document.createTextNode(' · ' + (row.template || 'custom') + ' · ' + (row.ok ? '已发送' : '失败')));
      if (!row.ok && row.code) { var code = document.createElement('span'); code.className = 'mono'; code.textContent = ' ' + row.code; head.appendChild(code); }
      var time = document.createElement('time');
      time.textContent = row.at;
      head.appendChild(time);
      var body = document.createElement('div');
      body.className = 's';
      body.textContent = row.text;
      item.appendChild(head);
      item.appendChild(body);
      box.appendChild(item);
    });
  }
  $('auditClear').addEventListener('click', function () {
    try { localStorage.removeItem(AUDIT_KEY); } catch (e) {}
    renderAudit();
  });

  // 确认卡 → 确认才 POST（写通道唯一：chatd 消息）
  $('consoleSend').addEventListener('click', function () {
    var person = $('consolePerson').value;
    var text = $('consoleText').value;
    var ticket = $('consoleTicket').value.trim();
    if (!person) { setStatus('先选岗位（接收工号）', true); return; }
    if (!text.trim()) { setStatus('文案为空', true); return; }
    if (text.length > ${String(MAX_CHAT_BODY_CHARS)}) { setStatus('文案超长（>${String(MAX_CHAT_BODY_CHARS)} 字符）', true); return; }
    $('ccPerson').textContent = person;
    $('ccRoom').textContent = $('consoleRoom').value;
    $('ccText').textContent = text;
    $('ccHint').hidden = text.indexOf('@' + person) !== -1;
    $('consoleConfirm').hidden = false;
    $('consoleConfirm').scrollIntoView({ block: 'nearest' });
  });
  $('confirmNo').addEventListener('click', function () { $('consoleConfirm').hidden = true; });
  $('confirmYes').addEventListener('click', function () {
    var btn = $('confirmYes');
    btn.disabled = true;
    btn.textContent = '发送中…';
    fetch('/api/console/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person: $('consolePerson').value,
        roomId: $('consoleRoom').value,
        templateId: currentTemplate,
        ticket: $('consoleTicket').value.trim() || undefined,
        text: $('consoleText').value
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var at = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
        if (res.ok && data.ok === true) {
          auditPush({ at: at, person: $('consolePerson').value, template: currentTemplate, ok: true, text: $('consoleText').value.slice(0, 80) });
          setStatus('已发送（seq ' + String(data.seq) + '）——工单将按聊天唤醒链路创建。 <a href="' + data.chatUrl + '">在聊天中查看 →</a>', false);
          $('consoleConfirm').hidden = true;
          if (currentTemplate === 'custom') $('consoleText').value = '';
        } else {
          var code = data && data.error && data.error.code ? data.error.code : 'HTTP ' + String(res.status);
          var msg = data && data.error && data.error.message ? data.error.message : '发送失败';
          auditPush({ at: at, person: $('consolePerson').value, template: currentTemplate, ok: false, code: code, text: $('consoleText').value.slice(0, 80) });
          setStatus('发送失败：' + msg + '（' + code + '）', true);
        }
      });
    }).catch(function (err) {
      setStatus('发送失败：' + (err && err.message ? err.message : '网络错误'), true);
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '确认发送';
    });
  });

  renderAudit();
})();
</script>`

  return `${pageHead('指令台', '下单 / 追问 / 日报 · 经聊天唤醒链路（平台唯一写入者仍是 daemon）')}
<div class="banner info">${icon('send')}<div class="grow"><b>指令台＝经聊天唤醒</b>：发送的是 chatd 房间消息（接收工号经 @ 触发 wake → daemon 建单派工）；门户不直写平台/台账，工单以 daemon 落账为准。文案须含 <code>@工号</code> 才会唤醒。</div></div>
${form}
${audit}
${script}`
}
