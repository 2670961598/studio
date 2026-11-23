/**
 * portal/pages-core —— 概览／单子列表／单子详情（服务端整页渲染）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §1.2（页面规格）／§二（组件）。
 * 安全：所有平台/台账数据出口经 esc()（§三.安全——XSS 防线在渲染面统一收口）。
 */
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import type { PortalData, PortalStats, TicketDetailView } from './data.ts'
import type { TicketSortDir, TicketSortKey } from './tickets-view.ts'
import { ticketRow, ticketsExportName } from './tickets-view.ts'
import type { SessionIndexRow } from './sessions.ts'
import { recentSessionsCard, sessionDetailHref } from './pages-sessions.ts'
import { badge, clip, emptyState, esc, eventBadgeClass, fmtAgo, fmtEpoch, fmtTime, fmtUsd, icon, stateBadgeClass, url } from './html.ts'
import { pageHead } from './layout.ts'

/** 单据字段中文名（meta 网格/时间线共用；未知字段原样） */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '标题',
  description: '描述',
  type: '类型',
  dept: '部门',
  lane: '泳道',
  level: '等级',
  assignee: '负责人',
  parent: '父单',
}
const fieldLabel = (f: string): string => FIELD_LABELS[f] ?? f

const statTile = (tone: string, ic: string, label: string, value: string, sub: string): string =>
  `<div class="stat ${tone}"><div class="stat-ic">${icon(ic, 17)}</div><div class="stat-label">${esc(label)}<div class="stat-value">${value}</div><div class="stat-sub">${esc(sub)}</div></div></div>`

/** 概览页 body（§1.2：hero＋统计卡＋最近活动/最近单子＋组织摘要＋快捷入口） */
export function overviewBody(data: PortalData, stats: PortalStats): string {
  const company = data.company()
  const recent = data.recentTickets(5)
  // 最近活动滤心跳（HEARTBEAT 每拍一条会刷屏；卡面口径注明，/api/activity 仍为原始流）
  const activity = data.activity(120).filter((e) => e.event !== 'HEARTBEAT').slice(0, 20)
  const ticketsLabel = stats.tickets.available ? `${stats.tickets.total} 张` : '未接平台'

  const hero = `<section class="hero">
  <h1>${esc(company.name)}</h1>
  <p class="mission">${data.mission() === '' ? '（org-config.yaml 未声明 mission）' : esc(data.mission())}</p>
  <div class="chips">
    <span class="chip">${icon('org', 13)}${esc(company.slug)}</span>
    <span class="chip">${icon('people', 13)}等级 L${company.level}</span>
    <span class="chip">${icon('link', 13)}平台 ${esc(company.platform.platform)}</span>
    <span class="chip">${icon('ticket', 13)}${ticketsLabel}</span>
  </div>
</section>`

  const statsGrid = `<div class="stat-grid">
  ${statTile('tone-accent', 'ticket', '单子总数', stats.tickets.available ? String(stats.tickets.total) : '—', stats.tickets.available ? '平台全树' : '未接 --platform-root')}
  ${statTile('tone-warn', 'clock', '进行中', stats.tickets.available ? String(stats.tickets.active) : '—', '未交付且未归档')}
  ${statTile('tone-ok', 'report', '已交付', stats.tickets.available ? String(stats.tickets.delivered) : '—', '状态含「交付」')}
  ${statTile('tone-violet', 'activity', '今日台账事件', String(stats.ledger.todayEvents), 'UTC 日起算')}
  ${statTile('tone-neutral', 'file', '今日成本', stats.ledger.todayCostUsd === null ? '—' : esc(fmtUsd(stats.ledger.todayCostUsd)), stats.ledger.todayCostUsd === null ? '今日暂无计量事件' : 'cost_usd 合计')}
  ${statTile(stats.chat.available ? 'tone-accent' : 'tone-neutral', 'chat', '聊天房间', stats.chat.available ? String(stats.chat.rooms) : '—', stats.chat.available ? `累计 ${stats.chat.messages} 条消息` : 'chatd 不可用')}
</div>`

  const activityCard = `<div class="card">
  <div class="card-head"><h2>${icon('activity')}最近活动</h2><span class="link-more">台账事件 · 已滤心跳</span></div>
  <div class="list-compact">${
    activity.length === 0
      ? emptyState('activity', '暂无台账事件', 'daemon 落账后此处显示最近 20 条（心跳类不计）')
      : activity
          .map((e) => {
            const issueCell =
              e.issue !== undefined && e.issue !== ''
                ? `<a class="mono" href="/tickets/${url(e.issue)}">${esc(e.issue)}</a>`
                : '<span class="muted">—</span>'
            const note = e.note !== undefined ? clip(e.note, 90) : ''
            return `    <div class="list-row">
      ${badge(e.event, eventBadgeClass(e.event))}
      <div class="grow"><div class="t">${issueCell}</div>${note === '' ? '' : `<div class="s">${esc(note)}</div>`}</div>
      <time title="${esc(fmtEpoch(e.ts))}">${esc(fmtAgo(new Date(e.ts).toISOString()))}</time>
    </div>`
          })
          .join('\n')
  }</div>
</div>`

  const recentCard = `<div class="card">
  <div class="card-head"><h2>${icon('ticket')}最近单子</h2><a class="link-more" href="/tickets">全部 →</a></div>
  <div class="list-compact">${
    recent.length === 0
      ? emptyState('ticket', '暂无单子', stats.tickets.available ? '平台 issues/ 为空' : '未接平台（--platform-root）——门户只读不代建')
      : recent
          .map(
            (t) => `    <div class="list-row">
      ${badge(t.state, stateBadgeClass(t.state))}
      <div class="grow"><div class="t"><a href="/tickets/${url(t.id)}">${esc(clip(t.title, 64))}</a></div><div class="s mono">${esc(t.id)}${t.assignee !== undefined ? ` · ${esc(t.assignee)}` : ''}</div></div>
      <time title="${esc(fmtTime(t.updated))}">${esc(fmtAgo(t.updated))}</time>
    </div>`,
          )
          .join('\n')
  }</div>
</div>`

  const orgCard = `<div class="card">
  <div class="card-head"><h2>${icon('org')}组织摘要</h2><a class="link-more" href="/org">组织 →</a></div>
  <div class="card-body">
    <div class="org-summary">
      <div class="cell"><div class="v num">${stats.org.departments}</div><div class="k">部门</div></div>
      <div class="cell"><div class="v num">${stats.org.people}</div><div class="k">在册人员</div></div>
      <div class="cell"><div class="v num">L${company.level}</div><div class="k">公司等级</div></div>
    </div>
  </div>
</div>`

  const quickCard = `<div class="card">
  <div class="card-head"><h2>${icon('link')}快捷入口</h2></div>
  <div class="card-body">
    <div class="quick">
      <a href="/tickets">${icon('ticket')}浏览单子</a>
      <a href="/chat">${icon('chat')}打开聊天</a>
      <a href="/org">${icon('org')}组织与人员</a>
      <a href="/reports">${icon('report')}公司报表</a>
      <a href="/sessions">${icon('session')}会话档案</a>
    </div>
  </div>
</div>`

  const sessionsArchive = data.sessions()
  return `${hero}
${statsGrid}
<div class="grid-2">
  <div class="stack">${activityCard}
${recentCard}
${recentSessionsCard(sessionsArchive.recent(3), sessionsArchive.available())}</div>
  <div class="stack">${orgCard}
${quickCard}</div>
</div>`
}

/** 单子列表页 body（§1.2 状态 chips＋搜索＋分页＋表格；§十.2 多选筛选/负责人/排序/导出） */
export function ticketsBody(
  data: PortalData,
  q: { states: readonly string[]; assignee: string | undefined; search: string; sort: TicketSortKey; dir: TicketSortDir; page: number; size: number },
): string {
  const result = data.ticketQuery({ states: q.states, assignee: q.assignee, search: q.search, sort: q.sort, dir: q.dir })
  const pages = Math.max(1, Math.ceil(result.total / q.size))
  const page = Math.min(q.page, pages)
  const start = (page - 1) * q.size
  const items = result.items.slice(start, start + q.size)
  // 参数续传（§十.2：chips/负责人/排序/方向全部进查询串；分页与导出链接同源）
  const qs = (over: { states?: readonly string[]; assignee?: string; page?: string; sort?: TicketSortKey; dir?: TicketSortDir; q?: string } = {}): string => {
    const params = new URLSearchParams()
    const states = over.states ?? q.states
    for (const s of states) params.append('states', s)
    const assignee = over.assignee !== undefined ? over.assignee : q.assignee
    if (assignee !== undefined && assignee !== '') params.set('assignee', assignee)
    const search = over.q !== undefined ? over.q : q.search
    if (search !== '') params.set('q', search)
    const sort = over.sort ?? q.sort
    if (sort !== 'updated') params.set('sort', sort)
    const dir = over.dir ?? q.dir
    if (dir !== 'desc') params.set('dir', dir)
    const pageOver = over.page
    if (pageOver !== undefined && pageOver !== '1') params.set('page', pageOver)
    const s = params.toString()
    return s === '' ? '/tickets' : `/tickets?${s}`
  }
  // 导出链接：与页面同一查询串＋format（§十.2；上限/CSV 转义在端点侧单源）
  const exportHref = (format: 'csv' | 'json'): string => {
    const params = new URLSearchParams()
    for (const s of q.states) params.append('states', s)
    if (q.assignee !== undefined && q.assignee !== '') params.set('assignee', q.assignee)
    if (q.search !== '') params.set('q', q.search)
    if (q.sort !== 'updated') params.set('sort', q.sort)
    if (q.dir !== 'desc') params.set('dir', q.dir)
    params.set('format', format)
    return `/api/tickets/export?${params.toString()}`
  }

  // 状态 chips：复选（GET 表单 checkbox——无 JS 可用，勾选后「应用」提交；§十.2）
  const chips = `<div class="chips">
    <a class="chip chip-link" href="${esc(qs({ states: [], q: '', page: '1', assignee: '' }))}">全部<span class="count num">${result.available ? String(result.total) : '—'}</span></a>
    ${result.states
      .map(
        (s) =>
          `<label class="chip chip-check"><input type="checkbox" name="states" value="${esc(s.state)}"${q.states.includes(s.state) ? ' checked' : ''}>${esc(s.state)}<span class="count num">${s.count}</span></label>`,
      )
      .join('\n    ')}
  </div>`

  const assigneeOptions = data
    .org()
    .people.map((p) => `<option value="${esc(p.id)}"${q.assignee === p.id ? ' selected' : ''}>${esc(p.id)} ${esc(p.name)}</option>`)
    .join('\n      ')

  const toolbar = `<form class="toolbar tickets-toolbar" method="get" action="/tickets" id="ticketsFilter">
  ${chips}
  <div class="filters">
    <input type="search" name="q" value="${esc(q.search)}" placeholder="搜索单号 / 标题 / 负责人…" aria-label="搜索单子">
    <select name="assignee" aria-label="负责人">
      <option value="">全部负责人</option>
      ${assigneeOptions}
    </select>
    <select name="sort" aria-label="排序字段">
      <option value="updated"${q.sort === 'updated' ? ' selected' : ''}>按更新时间</option>
      <option value="id"${q.sort === 'id' ? ' selected' : ''}>按单号</option>
    </select>
    <select name="dir" aria-label="排序方向">
      <option value="desc"${q.dir === 'desc' ? ' selected' : ''}>降序</option>
      <option value="asc"${q.dir === 'asc' ? ' selected' : ''}>升序</option>
    </select>
    <button class="btn" type="submit">${icon('search', 14)}应用</button>
    <span class="export-btns">
      <a class="btn ghost" href="${esc(exportHref('csv'))}" data-export="csv" download-name="${esc(ticketsExportName('csv', Date.now()))}" title="导出当前筛选结果（≤5000 行）">${icon('report', 13)}CSV</a>
      <a class="btn ghost" href="${esc(exportHref('json'))}" data-export="json" download-name="${esc(ticketsExportName('json', Date.now()))}" title="导出当前筛选结果（≤5000 行）">${icon('report', 13)}JSON</a>
    </span>
  </div>
</form>
<script>
(function () {
  'use strict';
  var form = document.getElementById('ticketsFilter');
  if (!form) return;
  // 勾选 chips/换选排序即提交（无 JS 时「应用」按钮兜底；CSP 友好——无内联处理器）
  form.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t && (t.type === 'checkbox' || t.tagName === 'SELECT')) form.submit();
  });
  // 导出：fetch → 浏览器端 Blob 落盘（§十.2；无 JS 时同链接原生下载兜底）
  form.querySelectorAll('a[data-export]').forEach(function (link) {
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      fetch(link.href).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + String(res.status));
        return res.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = link.getAttribute('download-name') || 'tickets.' + link.getAttribute('data-export');
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }).catch(function () { window.location.assign(link.href); });
    });
  });
})();
</script>`

  const table =
    result.available && result.total > 0
      ? `<div class="card"><div class="table-wrap"><table class="table">
  <thead><tr><th>单号</th><th>标题</th><th>状态</th><th>负责人</th><th>部门</th><th>泳道</th><th>会话</th><th>更新</th></tr></thead>
  <tbody>
${items
  .map(
    (t) => `    <tr>
      <td class="id"><a href="/tickets/${url(t.id)}">${esc(t.id)}</a></td>
      <td class="title-cell"><a href="/tickets/${url(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a></td>
      <td>${badge(t.state, stateBadgeClass(t.state))}</td>
      <td class="muted">${t.assignee !== undefined ? esc(t.assignee) : '—'}</td>
      <td class="muted">${t.dept !== undefined ? esc(shortDept(t.dept)) : '—'}</td>
      <td class="muted">${t.lane !== undefined ? esc(t.lane) : '—'}</td>
      <td>${data.sessions().ticketsWithSessions().has(t.id) ? `<a href="/sessions?ticket=${url(t.id)}" title="该单的工位会话">${icon('session', 13)}会话</a>` : '<span class="muted">—</span>'}</td>
      <td class="muted nowrap" title="${esc(fmtTime(t.updated))}">${esc(fmtAgo(t.updated))}</td>
    </tr>`,
  )
  .join('\n')}
  </tbody>
</table></div>
<div class="pager">
  <span>共 ${result.total} 张 · 第 ${page}/${pages} 页</span>
  <a class="btn${page <= 1 ? '' : ' ghost'}" href="${esc(qs({ page: String(Math.max(1, page - 1)) }))}"${page <= 1 ? ' aria-disabled="true"' : ''}>${icon('back', 13)}上一页</a>
  <a class="btn${page >= pages ? '' : ' ghost'}" href="${esc(qs({ page: String(Math.min(pages, page + 1)) }))}"${page >= pages ? ' aria-disabled="true"' : ''}>下一页</a>
</div>
</div>`
      : `<div class="card"><div class="card-body">${
          result.available
            ? emptyState('search', q.search === '' && q.states.length === 0 ? '暂无单子' : '没有匹配的单子', '换个关键字或状态试试；清空筛选看全部')
            : emptyState('ticket', '未接单子平台', '启动时加 --platform-root <目录>（缺省 <companyDir>/../platform）——门户只读，不代建平台目录')
        }</div></div>`

  // 页头副题：公司 slug＋平台全树只读——host 绝对路径不出页面（§三.安全：路径只进日志）
  const headSub = result.available
    ? `共 ${result.total} 张（筛选后）· ${data.company().slug} 平台全树 · 只读`
    : '未接平台'
  return `${pageHead('单子', headSub)}
${toolbar}
${table}`
}

const shortDept = (dept: string): string => {
  const idx = dept.lastIndexOf('/')
  return idx === -1 ? dept : dept.slice(idx + 1)
}

/** 单子详情页 body（§1.2：头部＋meta 网格＋描述＋验收＋工位尝试/会话＋事件时间线＋返回） */
export function ticketDetailBody(view: TicketDetailView, sessionsRows: readonly SessionIndexRow[] = []): string {
  const r = view.record
  // 空值行直出「—」的只留有信息量的（父单缺=不渲染该行；类型/负责人等业务字段保留占位）
  const meta = `<dl class="meta-grid">
  <div><dt>类型</dt><dd>${r.type !== undefined ? esc(r.type) : '—'}</dd></div>
  <div><dt>负责人</dt><dd>${r.assignee !== undefined ? esc(r.assignee) : '—'}</dd></div>
  <div><dt>部门</dt><dd>${r.dept !== undefined ? esc(shortDept(r.dept)) : '—'}</dd></div>
  <div><dt>泳道</dt><dd>${r.lane !== undefined ? esc(r.lane) : '—'}</dd></div>
  <div><dt>等级</dt><dd>${r.level !== undefined ? `<span class="lvl">L${r.level}</span>` : '—'}</dd></div>
  ${r.parent !== undefined ? `<div><dt>父单</dt><dd><a class="mono" href="/tickets/${url(r.parent)}">${esc(r.parent)}</a></dd></div>` : ''}
  <div><dt>创建</dt><dd class="num">${esc(fmtTime(view.created))}</dd></div>
  <div><dt>更新</dt><dd class="num">${esc(fmtTime(r.updated))}</dd></div>
</dl>`

  const timeline = `<div class="timeline">
${view.events
  .map((ev) => {
    const cls = ev.kind === 'created' ? 'created' : ev.kind === 'transitioned' ? 'state' : 'field'
    const dot = ev.kind === 'created' ? icon('ticket', 13) : ev.kind === 'transitioned' ? icon('activity', 13) : icon('file', 13)
    let head: string
    if (ev.kind === 'created') {
      head = `<span class="kind">创建单据</span>${ev.to !== undefined ? badge(ev.to, stateBadgeClass(ev.to)) : ''}`
    } else if (ev.kind === 'transitioned') {
      const from = ev.from !== undefined ? badge(ev.from, stateBadgeClass(ev.from)) : ''
      const to = ev.to !== undefined ? badge(ev.to, stateBadgeClass(ev.to)) : ''
      head = `<span class="kind">状态推进</span><span class="tl-state highlight">${from === '' ? '' : `${from}<span class="arrow">→</span>`}${to}</span>`
    } else {
      head = `<span class="kind">字段写入</span><code>${esc(fieldLabel(ev.field ?? ''))}</code>`
    }
    let body = ''
    if (ev.kind === 'created') body = `标题 ${esc(r.title)}`
    else if (ev.kind === 'field-set') body = `<code>${esc(ev.field === 'dept' ? shortDept(ev.value ?? '') : (ev.value ?? ''))}</code>`
    return `  <div class="tl-item ${cls}">
    <div class="tl-dot">${dot}</div>
    <div><div class="tl-head">${head}<time title="${esc(fmtTime(ev.ts))}">${esc(fmtAgo(ev.ts))}</time></div>${body === '' ? '' : `<div class="tl-body">${body}</div>`}</div>
  </div>`
  })
  .join('\n')}
</div>`

  // 操作区（§十.4）：指令台派工 / 聊天询问 / 复制单号与链接——门户零写，
  // 「让负责人处理」只构造指令台链接（发送仍由确认卡人工确认，经 chatd 唤醒 daemon）
  const actions = `<div class="ticket-actions">
  ${r.assignee !== undefined ? `<a class="btn" href="/console?person=${url(r.assignee)}&ticket=${url(r.id)}" title="在指令台给 ${esc(r.assignee)} 发派工指令（经聊天 @唤醒 daemon）">${icon('send', 14)}让负责人处理（指令台）</a>` : ''}
  <a class="btn ghost" href="/chat?draft=${url(`关于 ${r.id}（${r.title}）：`)}" title="去聊天室询问（预填草稿）">${icon('chat', 14)}在聊天中询问</a>
  <button class="btn ghost" type="button" data-copy="${esc(r.id)}" title="复制单号">${icon('copy', 13)}复制单号</button>
  <button class="btn ghost" type="button" data-copy-link="/tickets/${url(r.id)}" title="复制单子链接">${icon('link', 13)}复制链接</button>
</div>
<script>
(function () {
  'use strict';
  document.querySelectorAll('button[data-copy], button[data-copy-link]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy') !== null
        ? button.getAttribute('data-copy')
        : window.location.origin + button.getAttribute('data-copy-link');
      var done = function () {
        var old = button.textContent;
        button.textContent = '已复制 ✓';
        window.setTimeout(function () { button.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done);
      else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      }
    });
  });
})();
</script>`

  return `<a class="back" href="/tickets">${icon('back', 14)}返回单子列表</a>
<div class="card">
  <div class="detail-head">
    <div class="row"><span class="id">${esc(r.id)}</span>${badge(r.state, stateBadgeClass(r.state))}</div>
    <h1>${esc(r.title)}</h1>
    ${actions}
  </div>
  ${meta}
</div>
<div class="stack" style="margin-top:16px">
  <div class="card">
    <div class="card-head"><h2>${icon('file')}描述</h2></div>
    <div class="card-body"><div class="prose${view.description === '' ? ' muted' : ''}">${view.description === '' ? '（未填写描述）' : esc(view.description)}</div></div>
  </div>
${
  view.acceptance !== null
    ? `  <div class="card">
    <div class="card-head"><h2>${icon('report')}验收口径</h2></div>
    <div class="card-body"><div class="prose${view.acceptance === '' ? ' muted' : ''}">${view.acceptance === '' ? '（声明了验收段但为空）' : esc(view.acceptance)}</div></div>
  </div>
`
    : ''
}  <div class="card">
    <div class="card-head"><h2>${icon('session')}工位尝试与会话</h2><span class="link-more"><a href="/sessions?ticket=${url(r.id)}">会话档案 →</a></span></div>
    <div class="card-body">
${
  sessionsRows.length === 0
    ? `      <div class="prose muted">该单在 .AIWS 工位树暂无尝试记录（派工后自动出现；门户只读不代建）。</div>`
    : `      <div class="list-compact">
${sessionsRows
  .map(
    (s) => `      <div class="list-row">
        ${badge(`att${String(s.attempt)}`, s.sessionCount > 0 ? 'b-info' : 'b-neutral')}
        <div class="grow"><div class="t"><a href="${esc(sessionDetailHref(s))}" title="查看该次尝试的会话">${esc(s.person)} <span class="mono muted">${esc(s.dept)}</span></a></div><div class="s mono">${s.hasReport ? 'REPORT ' : ''}${s.hasSummary ? '摘要 ' : ''}${s.hasBrief ? '任务书' : ''}${s.hasReport || s.hasSummary || s.hasBrief ? '' : '无产物文件'}</div></div>
        <span class="muted num">${s.sessionCount > 0 ? `${String(s.sessionCount)} 条会话` : '无会话'}</span>
        <time title="${esc(fmtEpoch(s.updatedAtMs))}">${esc(fmtEpoch(s.updatedAtMs))}</time>
      </div>`,
  )
  .join('\n')}
      </div>`
}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${icon('clock')}事件时间线</h2><span class="link-more num">${view.events.length} 条事件</span></div>
    <div class="card-body">${timeline}</div>
  </div>
</div>`
}

/** 台账事件 → /api/activity 行（server.ts 复用口径） */
export function activityJson(e: EventRecord): Record<string, unknown> {
  return { id: e.id, ts: e.ts, company: e.company, issue: e.issue, event: e.event, actor: e.actor, level: e.level, dept: e.dept, note: e.note }
}

/** 单据 → /api/tickets 行（行形状单源在 tickets-view.ts ticketRow——页面/导出/API 三处同源） */
export function ticketJson(t: IssueRecord): Record<string, unknown> {
  return ticketRow(t)
}
