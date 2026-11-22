/**
 * portal/pages-core —— 概览／单子列表／单子详情（服务端整页渲染）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §1.2（页面规格）／§二（组件）。
 * 安全：所有平台/台账数据出口经 esc()（§三.安全——XSS 防线在渲染面统一收口）。
 */
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import type { PortalData, PortalStats, TicketDetailView } from './data.ts'
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
    <span class="chip">${icon('link', 13)}平台 ${esc(String(company.platform))}</span>
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
    </div>
  </div>
</div>`

  return `${hero}
${statsGrid}
<div class="grid-2">
  <div class="stack">${activityCard}
${recentCard}</div>
  <div class="stack">${orgCard}
${quickCard}</div>
</div>`
}

/** 单子列表页 body（§1.2：状态 chips＋搜索＋分页＋表格） */
export function ticketsBody(
  data: PortalData,
  q: { state: string | undefined; search: string; page: number; size: number },
): string {
  const result = data.ticketList({ state: q.state, search: q.search })
  const pages = Math.max(1, Math.ceil(result.total / q.size))
  const page = Math.min(q.page, pages)
  const start = (page - 1) * q.size
  const items = result.items.slice(start, start + q.size)
  const qs = (over: Record<string, string | undefined>): string => {
    const params = new URLSearchParams()
    const state = over['state'] !== undefined ? over['state'] : q.state
    const search = over['search'] !== undefined ? over['search'] : q.search
    const pageOver = over['page']
    if (state !== undefined) params.set('state', state)
    if (search !== '') params.set('q', search)
    if (pageOver !== undefined && pageOver !== '1') params.set('page', pageOver)
    const s = params.toString()
    return s === '' ? '/tickets' : `/tickets?${s}`
  }

  const chips = `<div class="chips">
    <a class="chip chip-link${q.state === undefined ? ' active' : ''}" href="${esc(qs({ state: undefined, page: '1' }))}">全部<span class="count num">${result.available ? String(result.total) : '—'}</span></a>
    ${result.states
      .map(
        (s) =>
          `<a class="chip chip-link${q.state === s.state ? ' active' : ''}" href="${esc(qs({ state: s.state, page: '1' }))}">${esc(s.state)}<span class="count num">${s.count}</span></a>`,
      )
      .join('\n    ')}
  </div>`

  const toolbar = `<div class="toolbar">
  ${chips}
  <form class="search" method="get" action="/tickets">
    ${q.state !== undefined ? `<input type="hidden" name="state" value="${esc(q.state)}">` : ''}
    <input type="search" name="q" value="${esc(q.search)}" placeholder="搜索单号 / 标题 / 负责人…" aria-label="搜索单子">
    <button class="btn" type="submit">${icon('search', 14)}搜索</button>
  </form>
</div>`

  const table =
    result.available && result.total > 0
      ? `<div class="card"><div class="table-wrap"><table class="table">
  <thead><tr><th>单号</th><th>标题</th><th>状态</th><th>负责人</th><th>部门</th><th>泳道</th><th>更新</th></tr></thead>
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
            ? emptyState('search', q.search === '' && q.state === undefined ? '暂无单子' : '没有匹配的单子', '换个关键字或状态试试；清空筛选看全部')
            : emptyState('ticket', '未接单子平台', '启动时加 --platform-root <目录>（缺省 <companyDir>/../platform）——门户只读，不代建平台目录')
        }</div></div>`

  return `${pageHead('单子', result.available ? `共 ${result.total} 张（筛选后）· 平台 ${data.platformRoot() ?? ''}` : '未接平台')}
${toolbar}
${table}`
}

const shortDept = (dept: string): string => {
  const idx = dept.lastIndexOf('/')
  return idx === -1 ? dept : dept.slice(idx + 1)
}

/** 单子详情页 body（§1.2：头部＋meta 网格＋描述＋验收＋事件时间线＋返回） */
export function ticketDetailBody(view: TicketDetailView): string {
  const r = view.record
  const meta = `<dl class="meta-grid">
  <div><dt>类型</dt><dd>${r.type !== undefined ? esc(r.type) : '—'}</dd></div>
  <div><dt>负责人</dt><dd>${r.assignee !== undefined ? esc(r.assignee) : '—'}</dd></div>
  <div><dt>部门</dt><dd>${r.dept !== undefined ? esc(r.dept) : '—'}</dd></div>
  <div><dt>泳道</dt><dd>${r.lane !== undefined ? esc(r.lane) : '—'}</dd></div>
  <div><dt>等级</dt><dd>${r.level !== undefined ? `L${r.level}` : '—'}</dd></div>
  <div><dt>父单</dt><dd>${r.parent !== undefined ? `<a class="mono" href="/tickets/${url(r.parent)}">${esc(r.parent)}</a>` : '—'}</dd></div>
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
    else if (ev.kind === 'field-set') body = `<code>${esc(ev.value ?? '')}</code>`
    return `  <div class="tl-item ${cls}">
    <div class="tl-dot">${dot}</div>
    <div><div class="tl-head">${head}<time title="${esc(fmtTime(ev.ts))}">${esc(fmtAgo(ev.ts))}</time></div>${body === '' ? '' : `<div class="tl-body">${body}</div>`}</div>
  </div>`
  })
  .join('\n')}
</div>`

  return `<a class="back" href="/tickets">${icon('back', 14)}返回单子列表</a>
<div class="card">
  <div class="detail-head">
    <div class="row"><span class="id">${esc(r.id)}</span>${badge(r.state, stateBadgeClass(r.state))}</div>
    <h1>${esc(r.title)}</h1>
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
    <div class="card-head"><h2>${icon('clock')}事件时间线</h2><span class="link-more num">${view.events.length} 条事件</span></div>
    <div class="card-body">${timeline}</div>
  </div>
</div>`
}

/** 台账事件 → /api/activity 行（server.ts 复用口径） */
export function activityJson(e: EventRecord): Record<string, unknown> {
  return { id: e.id, ts: e.ts, company: e.company, issue: e.issue, event: e.event, actor: e.actor, level: e.level, dept: e.dept, note: e.note }
}

/** 单据 → /api/tickets 行 */
export function ticketJson(t: IssueRecord): Record<string, unknown> {
  return { id: t.id, title: t.title, state: t.state, assignee: t.assignee, dept: t.dept, lane: t.lane, level: t.level, parent: t.parent, updated: t.updated }
}
