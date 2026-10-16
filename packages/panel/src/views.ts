/**
 * views —— :8787 监控面的纯函数层（v0.3 首刀）
 *
 * 依据：docs/16-§四 v0.3（验收口径「信息覆盖：jobs/runs/workers/事件流齐备」）、
 * docs/17-§8 :8787 端面定义（jobs/runs/workers 实时流 SSE / 事件流——全部读 SQLite）。
 *
 * 分层纪律：本文件零 IO、零 Hono 依赖——只吃 Ledger 读面（queryEvents/listJobs/
 * listWorkRecords/listSessions，见 packages/store/src/ledger.ts）吐纯数据快照与 HTML；
 * server.ts 只做路由与传输。数据源全部为 store 读面，不直接碰 SQL。
 *
 * 只读纪律：panel 对 SQLite 零写。WAL 模式下单写多读天然并发安全（store/driver.ts
 * journal_mode=WAL），panel 与 daemon 写进程可同库并存。
 *
 * **workers v0 口径（头注声明，docs/17-§8「workers 实时流」的 v0.3 替身）**：
 *   真 workers = daemon 内存态（在跑 executor 进程表，17-§2），v0.3 daemon 尚无主循环，
 *   故以台账投影近似：「work_records 中 ended_at 为空」∪「sessions 中 ended_at 为空」
 *   按 person_id 聚合。误差已知：异常死亡未收割的在途单会永远留在聚合里（无 ended_at 落账）。
 *   v0.4+ daemon 接管 workers 真源后本口径整体替换（响应体带 basis 字段机器可辨）。
 */
import type { EventRecord } from '@studio-next/contract'
import type { JobRecord, Ledger, SessionRecord, WorkRecord } from '@studio-next/store'

// —— 快照形状（/api/snapshot 的响应体；页面一次拉全） ——

export interface SnapshotJobs {
  total: number
  /** next_run_at <= now 的槽位数（与 store.dueJobs 同判据） */
  due: number
}

export interface SnapshotRuns {
  total: number
  /** ended_at 为空的在途 run 数 */
  inFlight: number
  /** 近况（在途优先，各自 started_at 降序） */
  recent: WorkRecord[]
}

/** workers v0 聚合行（口径见文件头注） */
export interface ActiveWorker {
  person_id: string
  /** 在途 work_records 数 */
  activeRuns: number
  /** 在途 sessions 数 */
  activeSessions: number
  executors: string[]
  issues: string[]
  /** 最早一处活动的 started_at（epoch ms） */
  sinceMs: number
}

export interface SnapshotWorkers {
  /** 口径标记：'ledger-v0' = 台账近似聚合；daemon 内存态接管后换值（v0.4+） */
  basis: 'ledger-v0'
  note: string
  active: ActiveWorker[]
}

export interface SnapshotEvents {
  total: number
  /** 事件计数按类分布（count 降序，同数按事件名稳定序） */
  byEvent: Array<{ event: string; count: number }>
}

export interface DashboardSnapshot {
  /** 快照生成时刻（epoch ms） */
  generatedAt: number
  schemaVersion: number
  jobs: SnapshotJobs
  runs: SnapshotRuns
  workers: SnapshotWorkers
  events: SnapshotEvents
}

/** 快照可调参数：测试注时间用 now，页面卡片密度用 recentRuns */
export interface SnapshotOptions {
  now?: number
  recentRuns?: number
}

/** 默认近况条数（server 的 pageSize 缺省同此） */
export const DEFAULT_PAGE_SIZE = 20

/** workers v0 口径说明（响应体 note 字段原文，机器可读处也留人话） */
export const WORKERS_V0_NOTE =
  'v0 口径：未 ended 的 work_records/sessions 按 person_id 聚合（台账近似）；' +
  '真 workers 是 daemon 内存态，v0.4 daemon 接管后替换（docs/17-§8）'

/**
 * 一次收集仪表盘快照：jobs 总数/due 数、runs 近 N 条+在途数、workers v0 聚合、
 * 事件计数按类分布。全部走 Ledger 读面；events 全量扫描计数（v0 量级小，量级证后优化）。
 */
export function buildDashboardSnapshot(ledger: Ledger, options?: SnapshotOptions): DashboardSnapshot {
  const now = options?.now ?? Date.now()
  const recentRuns = options?.recentRuns ?? DEFAULT_PAGE_SIZE

  const jobs = ledger.listJobs()
  const runs = ledger.listWorkRecords()
  const sessions = ledger.listSessions()
  const events = ledger.queryEvents()

  return {
    generatedAt: now,
    schemaVersion: ledger.version(),
    jobs: {
      total: jobs.length,
      due: jobs.filter((j) => j.next_run_at <= now).length,
    },
    runs: {
      total: runs.length,
      inFlight: runs.filter((r) => r.ended_at === undefined).length,
      recent: recentRunSlice(runs, recentRuns),
    },
    workers: aggregateActiveWorkers(runs, sessions),
    events: {
      total: events.length,
      byEvent: eventDistribution(events),
    },
  }
}

/**
 * runs 近况切片：在途（ended_at 为空）优先，组内按 started_at 降序；
 * 「在途优先」= 监控第一问是「现在谁在跑」，其次是最近完单。
 */
export function recentRunSlice(records: WorkRecord[], limit: number): WorkRecord[] {
  const sorted = [...records].sort((a, b) => {
    const aInFlight = a.ended_at === undefined ? 0 : 1
    const bInFlight = b.ended_at === undefined ? 0 : 1
    if (aInFlight !== bInFlight) return aInFlight - bInFlight
    return b.started_at - a.started_at
  })
  return sorted.slice(0, limit)
}

/** workers v0 聚合（口径见文件头注）：在途 runs × 在途 sessions 按 person_id 归并 */
export function aggregateActiveWorkers(runs: WorkRecord[], sessions: SessionRecord[]): SnapshotWorkers {
  const byPerson = new Map<string, ActiveWorker>()
  const slot = (personId: string): ActiveWorker => {
    const existing = byPerson.get(personId)
    if (existing !== undefined) return existing
    const fresh: ActiveWorker = {
      person_id: personId,
      activeRuns: 0,
      activeSessions: 0,
      executors: [],
      issues: [],
      sinceMs: Number.MAX_SAFE_INTEGER,
    }
    byPerson.set(personId, fresh)
    return fresh
  }
  for (const run of runs) {
    if (run.ended_at !== undefined) continue
    const w = slot(run.person_id)
    w.activeRuns += 1
    w.sinceMs = Math.min(w.sinceMs, run.started_at)
    if (!w.executors.includes(run.executor)) w.executors.push(run.executor)
    if (!w.issues.includes(run.issue)) w.issues.push(run.issue)
  }
  for (const session of sessions) {
    if (session.ended_at !== undefined) continue
    const w = slot(session.person_id)
    w.activeSessions += 1
    w.sinceMs = Math.min(w.sinceMs, session.started_at)
    if (!w.issues.includes(session.issue)) w.issues.push(session.issue)
  }
  const active = [...byPerson.values()].sort((a, b) => b.sinceMs - a.sinceMs || a.person_id.localeCompare(b.person_id))
  return { basis: 'ledger-v0', note: WORKERS_V0_NOTE, active }
}

/** 事件计数按类分布：count 降序、同数按事件名升序（输出稳定，UI 与测试都好断言） */
export function eventDistribution(events: EventRecord[]): Array<{ event: string; count: number }> {
  const counts = new Map<string, number>()
  for (const ev of events) counts.set(ev.event, (counts.get(ev.event) ?? 0) + 1)
  return [...counts.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event))
}

/** jobs 投影：JobRecord + due 标记（与 store.dueJobs 同判据：next_run_at <= now） */
export interface JobView extends JobRecord {
  due: boolean
}

export function jobViews(jobs: JobRecord[], now: number): JobView[] {
  return jobs.map((j) => ({ ...j, due: j.next_run_at <= now }))
}

// —— 监控单页（零前端依赖、内联 CSS；丑没关系，信息覆盖是验收口径） ——

/** 极简 HTML 单页：四区块卡片（jobs/runs/workers/事件流）+ fetch 轮询 + SSE 接事件流 */
export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio Next 监控 :8787</title>
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
  footer { color: #546e7a; margin-top: 16px; }
</style>
</head>
<body>
<h1>Studio Next 监控（:8787 只读面）</h1>
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
    <h2>事件流 <span class="cnt" id="events-cnt"></span></h2>
    <div id="events-feed"><div class="empty">等待 SSE 事件…</div></div>
  </section>
</div>
<footer>只读监控面（v0.3）：数据全部来自 SQLite 台账；workers 为 v0 台账近似口径（真源=daemon 内存态）。</footer>
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

function refresh() {
  fetch('/api/jobs').then(function (r) { return r.json(); }).then(renderJobs).catch(function () {});
  fetch('/api/snapshot').then(function (r) { return r.json(); }).then(renderSnapshot).catch(function () {});
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
var source = new EventSource('/api/events/stream');
source.addEventListener('ledger', function (e) {
  try { var ev = JSON.parse(e.data); prependEvent(ev, ev.ts); } catch (err) {}
});
</script>
</body>
</html>
`;
}
