/**
 * views-render —— :8787 监控单页（零前端依赖、内联 CSS/浏览器 JS 模板）
 *
 * 依据（实现单引用）：docs/17-§8 :8787 端面（只读 SQLite、面板第一落点）；docs/16-§四 v0.3
 *   六区块覆盖；docs/17-§2/§6（相位与收割判据零变更——本件只做渲染）；
 *   docs/20-§十五.三（600 行阈：views.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件零 IO、零状态——纯字符串渲染；快照/断路器/成本读面仍在 views.ts。
 */


/** 极简 HTML 单页：六区块卡片（jobs/runs/workers/断路器/成本/事件流）+ fetch 轮询 + SSE 接事件流 */
export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio Next 监控 :8791</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; background: #101418; color: #cfd8dc; margin: 0; padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #80cbc4; }
  #meta { color: #78909c; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
  section { background: #161c22; border: 1px solid #263238; border-radius: 6px; padding: 12px; min-width: 0; }
  h2 { font-size: 13px; margin: 0 0 8px; color: #eeff41; font-weight: 600; }
  h2 .cnt { color: #78909c; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 3px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { color: #90a4ae; border-bottom: 1px solid #263238; }
  tr:nth-child(even) td { background: #1b232b; }
  .due { color: #ff8a65; }
  .ok { color: #a5d6a7; }
  .fail { color: #ef9a9a; }
  .run { color: #fff59d; }
  #events-feed div { padding: 2px 0; border-bottom: 1px dotted #263238; }
  #events-feed .t { color: #78909c; }
  .empty { color: #546e7a; padding: 8px 0; }
  .caliber { color: #78909c; margin: 4px 0 8px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef5350; margin-right: 6px; vertical-align: middle; }
  #breakers-list div { padding: 3px 0; border-bottom: 1px dotted #263238; }
  #breakers-list .sig { color: #ef9a9a; }
  .bar { color: #80cbc4; letter-spacing: -1px; }
  .bar.net { color: #fff59d; }
  footer { color: #546e7a; margin-top: 16px; }
</style>
</head>
<body>
<h1>Studio Next 监控（:8791 只读面）</h1>
<div id="meta">schema v<span id="schema">-</span> · 快照 <span id="stamp">-</span> · 每 3s 轮询 + SSE 实时事件</div>
<div class="grid">
  <section>
    <h2>定时岗 jobs <span class="cnt" id="jobs-cnt"></span></h2>
    <table><thead><tr><th>job</th><th>company</th><th>cron</th><th>next_run_at</th><th>状态</th></tr></thead>
    <tbody id="jobs-body"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>执行 runs <span class="cnt" id="runs-cnt"></span></h2>
    <table><thead><tr><th>issue</th><th>工号</th><th>executor</th><th>started</th><th>ended</th><th>status</th></tr></thead>
    <tbody id="runs-body"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>workers <span class="cnt" id="workers-cnt"></span></h2>
    <div class="empty" id="workers-note"></div>
    <table><thead><tr><th>工号</th><th>在途runs</th><th>在途sessions</th><th>executors</th><th>issues</th></tr></thead>
    <tbody id="workers-body"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>断路器告警 <span class="cnt" id="breakers-cnt"></span></h2>
    <div class="caliber" id="breakers-note"></div>
    <div id="breakers-list"><div class="empty">加载中…</div></div>
  </section>
  <section>
    <h2>成本趋势 <span class="cnt" id="costs-cnt"></span></h2>
    <div class="caliber" id="costs-note"></div>
    <table><thead><tr><th>日(UTC)</th><th>LLM岛$</th><th>收割$</th><th>reserve</th><th>settle</th><th>refusal</th><th>净额$</th></tr></thead>
    <tbody id="costs-body"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody></table>
  </section>
  <section>
    <h2>事件流 <span class="cnt" id="events-cnt"></span></h2>
    <div id="events-feed"><div class="empty">等待 SSE 事件…</div></div>
  </section>
</div>
<footer>只读监控面（17-§8 口径）：数据全部来自 SQLite 台账；workers 为 v0 台账近似口径（真源=daemon 内存态）；
断路器=触发史投影（复位未落账不消红）；成本 LLM 岛/收割分列不相加（docs/26 C1）；漂移告警待判据冻结。</footer>
<script>
'use strict';
var esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
};
var fmtTime = function (ms) { return ms ? new Date(ms).toLocaleTimeString('zh-CN', { hour12: false }) : '-'; };
var setCnt = function (id, text) { document.getElementById(id).textContent = text; };
var setBody = function (id, rowsHtml, cols) {
  document.getElementById(id).innerHTML = rowsHtml || ('<tr><td colspan="' + cols + '" class="empty">（空）</td></tr>');
};
var statusClass = function (s) { return s === 'done' ? 'ok' : s === 'failed' ? 'fail' : 'run'; };

function renderJobs(j) {
  setCnt('jobs-cnt', '共 ' + j.total + ' · due ' + j.due);
  setBody('jobs-body', j.jobs.map(function (job) {
    return '<tr' + (job.due ? ' class="due"' : '') + '><td title="' + esc(job.job_id) + '">' + esc(job.job_id) +
      '</td><td>' + esc(job.company) + '</td><td>' + esc(job.cron) + '</td><td>' + fmtTime(job.next_run_at) +
      '</td><td>' + esc(job.status || '-') + (job.due ? ' · DUE' : '') + '</td></tr>';
  }).join(''), 5);
}

function renderSnapshot(s) {
  setCnt('schema', s.schemaVersion);
  setCnt('stamp', fmtTime(s.generatedAt));
  setCnt('runs-cnt', '共 ' + s.runs.total + ' · 在途 ' + s.runs.inFlight + ' · 近 ' + s.runs.recent.length + ' 条');
  setBody('runs-body', s.runs.recent.map(function (r) {
    var ended = r.ended_at === undefined ? '在途' : fmtTime(r.ended_at);
    return '<tr><td title="' + esc(r.id) + '">' + esc(r.issue) + '</td><td>' + esc(r.person_id) +
      '</td><td>' + esc(r.executor) + '</td><td>' + fmtTime(r.started_at) + '</td><td>' + ended +
      '</td><td class="' + statusClass(r.status) + '">' + esc(r.status) + '#' + r.attempt + '</td></tr>';
  }).join(''), 6);
  setCnt('workers-cnt', '在册 ' + s.workers.active.length);
  setCnt('workers-note', s.workers.note);
  setBody('workers-body', s.workers.active.map(function (w) {
    return '<tr><td>' + esc(w.person_id) + '</td><td>' + w.activeRuns + '</td><td>' + w.activeSessions +
      '</td><td>' + esc(w.executors.join(',')) + '</td><td>' + esc(w.issues.join(',')) + '</td></tr>';
  }).join(''), 5);
  setCnt('events-cnt', '累计 ' + s.events.total);
}

// 断路器卡：红点=触发（触发史投影口径——复位未落账不消红，见 note）
function renderBreakers(b) {
  setCnt('breakers-cnt', '近 ' + b.days + ' 天 ' + b.count + ' 单');
  setCnt('breakers-note', b.note);
  var list = document.getElementById('breakers-list');
  if (!b.breakers.length) { list.innerHTML = '<div class="empty">（无熔断触发）</div>'; return; }
  list.innerHTML = b.breakers.map(function (brk) {
    var sig = brk.signature === null ? '签名未携带' : brk.signature;
    var strikes = brk.streak === null ? '' : ' · 连击 ' + brk.streak + '/' + (brk.threshold === null ? '?' : brk.threshold);
    var bug = brk.bug === null ? '' : ' · bug ' + brk.bug;
    return '<div><span class="dot"></span>' + esc(brk.issue) + ' <span class="sig">' + esc(sig) +
      '</span> · x' + brk.trips + strikes + bug + ' · ' + fmtTime(brk.lastTs) + '</div>';
  }).join('');
}

// 成本卡：纯文本条形简图（零前端依赖；金额显示层取整——台账存原始 double）
var fmtUsd = function (v) { return (Math.round(v * 10000) / 10000).toString(); };
var bar = function (v, max, cls) {
  var width = max > 0 ? Math.max(1, Math.round((v / max) * 16)) : 0;
  return '<span class="bar' + (cls ? ' ' + cls : '') + '">' + String.fromCharCode(9608).repeat(width) + '</span> ' + fmtUsd(v);
};
function renderCosts(c) {
  setCnt('costs-cnt', '近 ' + c.days + ' 天（UTC）');
  setCnt('costs-note', c.note);
  var maxLlm = 0, maxNet = 0;
  c.series.forEach(function (p) {
    if (p.llm_cost_usd > maxLlm) maxLlm = p.llm_cost_usd;
    if (Math.abs(p.net_usd) > maxNet) maxNet = Math.abs(p.net_usd);
  });
  setBody('costs-body', c.series.slice().reverse().map(function (p) {
    return '<tr><td>' + esc(p.date) + '</td><td>' + bar(p.llm_cost_usd, maxLlm) + ' <span class="cnt">(' + p.llm_events + '条)</span>' +
      '</td><td>' + fmtUsd(p.harvest_cost_usd) + ' <span class="cnt">(' + p.harvest_runs + '单)</span>' +
      '</td><td>' + fmtUsd(p.reserve_usd) + '</td><td>' + fmtUsd(p.settle_usd) + '</td><td>' + fmtUsd(p.refusal_usd) +
      '</td><td>' + bar(p.net_usd, maxNet, 'net') + '</td></tr>';
  }).join(''), 7);
}

function refresh() {
  fetch('/api/jobs').then(function (r) { return r.json(); }).then(renderJobs).catch(function () {});
  fetch('/api/snapshot').then(function (r) { return r.json(); }).then(renderSnapshot).catch(function () {});
  fetch('/api/breakers?days=7').then(function (r) { return r.json(); }).then(renderBreakers).catch(function () {});
  fetch('/api/costs?days=7').then(function (r) { return r.json(); }).then(renderCosts).catch(function () {});
}
refresh();
setInterval(refresh, 3000);

var feed = document.getElementById('events-feed');
feed.textContent = '';
function prependEvent(ev, ts) {
  var line = document.createElement('div');
  line.innerHTML = '<span class="t">' + fmtTime(ts) + '</span> ' + esc(ev.event) + ' · ' + esc(ev.company) + ' · ' + esc(ev.issue) + ' · ' + esc(ev.actor);
  feed.insertBefore(line, feed.firstChild);
  while (feed.childElementCount > 50) feed.removeChild(feed.lastChild);
}
// 事件流底账：载入即拉最近 50 条（倒序——最新在前），SSE 只负责之后的新事件
fetch('/api/events?order=desc&limit=50').then(function (r) { return r.json(); }).then(function (body) {
  body.events.slice().reverse().forEach(function (ev) { prependEvent(ev, ev.ts); });
}).catch(function () {});
var source = new EventSource('/api/events/stream');
source.addEventListener('ledger', function (e) {
  try { var ev = JSON.parse(e.data); prependEvent(ev, ev.ts); } catch (err) {}
});
</script>
</body>
</html>
`;
}
