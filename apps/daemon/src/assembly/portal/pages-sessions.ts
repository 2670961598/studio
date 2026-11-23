/**
 * portal/pages-sessions —— 会话档案列表页＋详情页＋文件预览页（服务端整页渲染）。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §九.1（v2 第一刀页面规格）。
 * 安全：所有工位数据出口经 esc()；正文（任务书/REPORT/轨迹文本）经 maskHostPaths
 * 先脱敏再转义（主机绝对路径不出页面）；会话 id/单号等进链接一律 url()。
 * 可用性：>200 条轨迹事件折叠为百条一组（首组展开，其余 <details>；无 JS 可用）。
 */
import { maskHostPaths } from '@studio-next/panel/chat'
import type { AttemptFileResult, SessionArchive, SessionDetailView, SessionIndexRow } from './sessions.ts'
import { badge, clip, emptyState, esc, fmtBytes, fmtEpoch, fmtEventMs, icon, url } from './html.ts'
import { pageHead } from './layout.ts'

/** 列表页查询（server 侧已校验/钳位） */
export interface SessionsPageQuery {
  readonly person: string
  readonly ticket: string
  readonly q: string
  readonly page: number
  readonly size: number
}

/** 会话行 → 详情页链接 */
export const sessionDetailHref = (r: { ticket: string; attempt: number }): string => `/sessions/${url(r.ticket)}/att${String(r.attempt)}`

const KIND_LABELS: Readonly<Record<string, string>> = {
  session: '会话',
  config: '配置',
  brief: '任务书',
  user: '用户',
  assistant: '助理',
  reasoning: '推理',
  tool_call: '工具',
  tool_result: '结果',
  error: '错误',
  interrupt: '中断',
  compaction: '压缩',
  turn: '回合',
  info: '信息',
}
const KIND_BADGES: Readonly<Record<string, string>> = {
  session: 'b-neutral',
  config: 'b-neutral',
  brief: 'b-info',
  user: 'b-info',
  assistant: 'b-violet',
  reasoning: 'b-neutral',
  tool_call: 'b-warn',
  tool_result: 'b-neutral',
  error: 'b-danger',
  interrupt: 'b-warn',
  compaction: 'b-info',
  turn: 'b-neutral',
  info: 'b-neutral',
}

const kindLabel = (k: string): string => KIND_LABELS[k] ?? k
const kindBadge = (k: string): string => KIND_BADGES[k] ?? 'b-neutral'

/** ms 时长 → 人类读法（会话 usage 卡） */
function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '<1 分钟'
  if (min < 60) return `${String(min)} 分钟`
  const h = Math.floor(min / 60)
  if (h < 24) return `${String(h)} 小时 ${String(min % 60)} 分`
  return `${String(Math.floor(h / 24))} 天 ${String(h % 24)} 小时`
}

/** 列表页 body（筛选＋分页＋表格；摘要列读 summary.conclusion） */
export function sessionsListBody(archive: SessionArchive, q: SessionsPageQuery): string {
  const result = archive.list({ ...(q.person !== '' ? { person: q.person } : {}), ...(q.ticket !== '' ? { ticket: q.ticket } : {}), ...(q.q !== '' ? { q: q.q } : {}), limit: q.size, offset: (q.page - 1) * q.size })
  const pages = Math.max(1, Math.ceil(result.total / q.size))
  const page = Math.min(q.page, pages)
  const from = result.items.length === 0 ? 0 : (page - 1) * q.size + 1
  const to = from + result.items.length - 1

  if (!result.available) {
    return `${pageHead('会话档案', '未发现工位档案树 · 只读')}
<div class="banner info">${icon('session')}<div class="grow">未发现 <code>.AIWS</code> 工位档案树（缺省位 <code>&lt;companyDir&gt;/../.AIWS</code>）。门户只读、不代建；树出现后此处自动列出各岗位的会话轨迹。</div></div>
<div class="card"><div class="card-body">${emptyState('session', '暂无会话档案', 'daemon 派工后工位会话轨迹会落在 .AIWS 工位树内，届时可在此浏览')}</div></div>`
  }

  const href = (p: number): string => {
    const params = new URLSearchParams()
    if (q.person !== '') params.set('person', q.person)
    if (q.ticket !== '') params.set('ticket', q.ticket)
    if (q.q !== '') params.set('q', q.q)
    if (p > 1) params.set('page', String(p))
    const s = params.toString()
    return s === '' ? '/sessions' : `/sessions?${s}`
  }

  const toolbar = `<div class="toolbar">
  <form class="search search-wide" method="get" action="/sessions">
    <input type="search" name="person" value="${esc(q.person)}" placeholder="岗位（如 ENG-1）" aria-label="按岗位筛选">
    <input type="search" name="ticket" value="${esc(q.ticket)}" placeholder="单号" aria-label="按单号筛选">
    <input type="search" name="q" value="${esc(q.q)}" placeholder="关键字（单号/岗位/部门）" aria-label="关键字搜索">
    <button class="btn" type="submit">${icon('search', 14)}筛选</button>
  </form>
</div>`

  const rows = result.items
    .map((r) => {
      const conclusion = archive.conclusionOf(r)
      return `    <tr>
      <td class="id"><a href="/tickets/${url(r.ticket)}">${esc(r.ticket)}</a></td>
      <td><a href="/sessions?person=${url(r.person)}" title="只看该岗位">${esc(r.person)}</a></td>
      <td class="muted">${esc(r.dept)}</td>
      <td><a href="${esc(sessionDetailHref(r))}" title="查看该次尝试">${badge(`att${String(r.attempt)}`, r.sessionCount > 0 ? 'b-info' : 'b-neutral')}</a>${r.sessionCount > 1 ? `<span class="muted">×${String(r.sessionCount)}</span>` : ''}</td>
      <td class="muted nowrap" title="${esc(fmtEpoch(r.updatedAtMs))}">${esc(fmtEpoch(r.updatedAtMs))}</td>
      <td>${r.hasReport ? badge('有', 'b-ok') : '<span class="muted">—</span>'}</td>
      <td class="concl">${conclusion === null ? (r.hasSummary ? '<span class="muted">（摘要无结论字段）</span>' : '<span class="muted">—</span>') : esc(clip(maskHostPaths(conclusion), 90))}</td>
    </tr>`
    })
    .join('\n')

  const table =
    result.total > 0
      ? `<div class="card"><div class="table-wrap"><table class="table">
  <thead><tr><th>单号</th><th>岗位</th><th>部门</th><th>尝试</th><th>更新时间</th><th>REPORT</th><th>摘要一句</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table></div>
<div class="pager">
  <span>第 ${String(from)}–${String(to)} 条 / 共 ${String(result.total)} 条 · 第 ${String(page)}/${String(pages)} 页${result.capped ? `（扫描达 ${String(result.scanned)} 目录上限，可能未含全部）` : ''}</span>
  <a class="btn${page <= 1 ? '' : ' ghost'}" href="${esc(href(Math.max(1, page - 1)))}"${page <= 1 ? ' aria-disabled="true"' : ''}>${icon('back', 13)}上一页</a>
  <a class="btn${page >= pages ? '' : ' ghost'}" href="${esc(href(Math.min(pages, page + 1)))}"${page >= pages ? ' aria-disabled="true"' : ''}>下一页</a>
</div>
</div>`
      : `<div class="card"><div class="card-body">${emptyState('search', '没有匹配的工位尝试', '清空岗位/单号/关键字再看全部；也可从组织页人员行进入')}</div></div>`

  const sub = `共 ${String(result.total)} 次工位尝试 · 扫描 ${String(result.scanned)} 个 att 目录 · 只读${result.capped ? ' · 已达扫描上限' : ''}`
  return `${pageHead('会话档案', sub)}
${toolbar}
${table}`
}

/** 详情页标签页集合（§九.1：时间线/摘要/REPORT/任务书/交付物） */
export type SessionsTab = 'timeline' | 'summary' | 'report' | 'brief' | 'deliverables'
const TABS: readonly { key: SessionsTab; label: string }[] = [
  { key: 'timeline', label: '会话时间线' },
  { key: 'summary', label: '摘要' },
  { key: 'report', label: 'REPORT' },
  { key: 'brief', label: '任务书' },
  { key: 'deliverables', label: '交付物' },
]
const isTab = (v: string): v is SessionsTab => TABS.some((t) => t.key === v)

/** 字符串查询 → 标签（缺省 timeline；非法回落 timeline） */
export function parseSessionsTab(raw: string | undefined): SessionsTab {
  if (raw !== undefined && isTab(raw)) return raw
  return 'timeline'
}

/** 轨迹事件分组渲染（>200 条折叠：百条一组，首组展开） */
function timelineEvents(view: SessionDetailView): string {
  if (view.events.length === 0) return ''
  const groups: typeof view.events[] = []
  for (let i = 0; i < view.events.length; i += 100) groups.push(view.events.slice(i, i + 100))
  const render = (ev: (typeof view.events)[number]): string =>
    `      <div class="ev ev-${esc(ev.kind)}">
        <span class="ev-time num">${esc(fmtEventMs(ev.time))}</span>
        ${badge(kindLabel(ev.kind), kindBadge(ev.kind))}
        <div class="ev-main">
          <div class="ev-head"><b>${esc(maskHostPaths(ev.title))}</b>${ev.detail === '' ? '' : `<span class="ev-detail">${esc(maskHostPaths(ev.detail))}</span>`}</div>
          ${ev.text === null ? '' : `<pre class="ev-text${ev.truncated ? ' clipped' : ''}">${esc(maskHostPaths(ev.text))}${ev.truncated ? '\n…（超长截断，原文在盘）' : ''}</pre>`}
        </div>
      </div>`
  return groups
    .map((g, gi) => {
      const inner = g.map(render).join('\n')
      if (gi === 0 || groups.length <= 2) return `<div class="ev-group">${inner}\n      </div>`
      const label = `事件 ${String(gi * 100 + 1)}–${String(gi * 100 + g.length)}（点击展开）`
      return `<details class="ev-fold"><summary>${esc(label)}</summary><div class="ev-group">${inner}\n      </div></details>`
    })
    .join('\n')
}

/** 摘要/REPORT/任务书 共用正文读取（server 注入 fileView；404/415 → 占位卡） */
function docBody(r: AttemptFileResult, emptyLabel: string): string {
  if (!r.ok) {
    if (r.status === 404) return emptyState('file', emptyLabel, '该尝试未落此文件')
    return `<div class="banner warn">${icon('file')}<div class="grow">${esc(r.message)}</div></div>`
  }
  return `<pre class="doc-pre${r.truncated ? ' clipped' : ''}">${esc(maskHostPaths(r.text))}${r.truncated ? '\n…（超 200KB 截断）' : ''}</pre>`
}

/** 详情页 body（头部＋标签页；tabContent 由 server 按当前标签装载） */
export function sessionsDetailBody(view: SessionDetailView, tab: SessionsTab, readFile: (rel: string) => AttemptFileResult): string {
  const u = view.usage
  const chips = u === null ? '' : `<div class="chips">
    <span class="chip num">${icon('clock', 13)}时长 ${esc(fmtDuration(u.durationMs))}</span>
    <span class="chip num">${icon('activity', 13)}事件 ${String(u.kept)} 条（轨迹 ${String(u.lines)} 行）</span>
    <span class="chip num">${icon('link', 13)}回合 ${String(u.turns)} · 工具 ${String(u.toolCalls)}</span>
    ${u.errors > 0 ? `<span class="chip num">${icon('dot', 13)}错误 ${String(u.errors)}</span>` : ''}
    ${u.provider !== null && u.model !== null ? `<span class="chip">${icon('dot', 13)}${esc(u.provider)} / ${esc(u.model)}</span>` : ''}
  </div>`

  const head = `<a class="back" href="/sessions?ticket=${url(view.ticket)}">${icon('back', 14)}返回会话列表</a>
<div class="card">
  <div class="detail-head">
    <div class="row"><span class="id"><a href="/tickets/${url(view.ticket)}">${esc(view.ticket)}</a></span>${badge(`att${String(view.attempt)}`, 'b-info')}<span class="muted">·</span><a href="/sessions?person=${url(view.person)}">${esc(view.person)}</a><span class="muted">${esc(view.dept)}</span></div>
    <h1>工位会话 · ${esc(view.ticket)} 第 ${String(view.attempt)} 次尝试</h1>
    <div class="sub">岗位 ${esc(view.person)}（${esc(view.dept)}） · 更新 ${esc(fmtEpoch(view.updatedAtMs))}${view.sessionId !== null ? ` · 会话 <code>${esc(view.sessionId)}</code>` : ' · 无会话轨迹'}</div>
    <div class="ticket-actions">
      <a class="btn" href="/console?person=${url(view.person)}&ticket=${url(view.ticket)}" title="在指令台给 ${esc(view.person)} 发派工指令（经聊天 @唤醒 daemon）">${icon('send', 14)}让负责人处理（指令台）</a>
      <a class="btn ghost" href="/chat?draft=${url(`关于 ${view.ticket} 第 ${String(view.attempt)} 次尝试（${view.person}）：`)}" title="去聊天室询问（预填草稿）">${icon('chat', 14)}在聊天中询问</a>
    </div>
  </div>
  ${chips}
</div>`

  const tabNav = `<div class="tabs">
${TABS.map((t) => `  <a class="tab${t.key === tab ? ' active' : ''}" href="/sessions/${url(view.ticket)}/att${String(view.attempt)}?tab=${t.key}${view.sessionId !== null ? `&sessionId=${url(view.sessionId)}` : ''}">${esc(t.label)}${t.key === 'deliverables' && view.files.deliverables.length > 0 ? `<span class="count num">${String(view.files.deliverables.length)}</span>` : ''}</a>`).join('\n')}
</div>`

  let body: string
  if (tab === 'timeline') {
    body =
      view.transcript.available && view.events.length > 0
        ? `<div class="card"><div class="card-head"><h2>${icon('session')}会话时间线</h2><span class="link-more num">${String(view.events.length)} 条事件${view.transcript.sourceTruncated === true ? '（源超 8MB 已截断）' : ''}</span></div><div class="card-body ev-list">
${timelineEvents(view)}
</div></div>`
        : `<div class="card"><div class="card-body">${
            view.transcript.available
              ? emptyState('session', '轨迹无事件', '解压成功但没有可渲染事件（异常轨迹）')
              : `<div class="banner warn">${icon('session')}<div class="grow"><b>${view.transcript.code === 'zstd-unavailable' ? '会话压缩工具不可用' : '会话轨迹不可用'}</b> — ${esc(view.transcript.message ?? '')}</div></div>${emptyState('session', '会话时间线降级', '其余标签页（摘要/REPORT/任务书/交付物）不受影响')}`
          }</div></div>`
  } else if (tab === 'summary') {
    body = `<div class="card"><div class="card-head"><h2>${icon('report')}摘要 summary.json</h2></div><div class="card-body">${docBody(readFile('summary.json'), '未落摘要文件')}</div></div>`
  } else if (tab === 'report') {
    body = `<div class="card"><div class="card-head"><h2>${icon('report')}REPORT.md</h2></div><div class="card-body">${docBody(readFile('REPORT.md'), '未落 REPORT')}</div></div>`
  } else if (tab === 'brief') {
    body = `<div class="card"><div class="card-head"><h2>${icon('file')}任务书 brief.md</h2></div><div class="card-body">${docBody(readFile('brief.md'), '未落任务书')}</div></div>`
  } else {
    const rows = view.files.deliverables
      .map(
        (d) => `    <tr>
      <td class="title-cell">${icon('file', 13)} <a href="/sessions/${url(view.ticket)}/att${String(view.attempt)}/file?path=${url(d.relPath)}" title="${esc(d.relPath)}">${esc(d.relPath)}</a></td>
      <td class="muted nowrap num">${esc(fmtBytes(d.sizeBytes))}</td>
      <td class="muted">${isPreviewable(d.relPath) ? '<span class="ok-dot">可预览</span>' : '文本外不预览'}</td>
    </tr>`,
      )
      .join('\n')
    body =
      view.files.deliverables.length === 0
        ? `<div class="card"><div class="card-body">${emptyState('file', '无交付物', '该尝试未落 deliverables/ 目录或为空')}</div></div>`
        : `<div class="card"><div class="table-wrap"><table class="table">
  <thead><tr><th>交付物</th><th>大小</th><th>预览</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table></div></div>`
  }

  return `${head}
${tabNav}
${body}`
}

const PREVIEW_EXTS = new Set(['.md', '.txt', '.json', '.log'])
const isPreviewable = (rel: string): boolean => PREVIEW_EXTS.has(rel.slice(rel.lastIndexOf('.')).toLowerCase())

/** 文件预览页 body（交付物/摘要等文本件的只读视图） */
export function sessionsFileBody(ctx: { ticket: string; attempt: number; person: string }, r: AttemptFileResult): string {
  const back = `/sessions/${url(ctx.ticket)}/att${String(ctx.attempt)}?tab=deliverables`
  if (!r.ok) {
    return `<a class="back" href="${esc(back)}">${icon('back', 14)}返回交付物</a>
<div class="banner danger">${icon('file')}<div class="grow"><b>${esc(r.code)}</b> — ${esc(r.message)}</div></div>`
  }
  return `<a class="back" href="${esc(back)}">${icon('back', 14)}返回 ${esc(ctx.ticket)} att${String(ctx.attempt)}</a>
<div class="card">
  <div class="card-head"><h2>${icon('file')}${esc(r.file.relPath)}</h2><span class="link-more num">${esc(fmtBytes(r.file.sizeBytes))}</span></div>
  <div class="card-body"><pre class="doc-pre${r.truncated ? ' clipped' : ''}">${esc(maskHostPaths(r.text))}${r.truncated ? '\n…（超 200KB 截断）' : ''}</pre></div>
</div>`
}

/** 概览页「最近会话」卡（rows 为索引切片；available=false 给降级卡） */
export function recentSessionsCard(rows: readonly SessionIndexRow[], available: boolean): string {
  const items = rows
    .map(
      (r) => `    <div class="list-row">
      ${badge(`att${String(r.attempt)}`, r.sessionCount > 0 ? 'b-info' : 'b-neutral')}
      <div class="grow"><div class="t"><a href="${esc(sessionDetailHref(r))}">${esc(r.ticket)}</a></div><div class="s mono">${esc(r.person)} · ${esc(r.dept)}${r.hasReport ? ' · REPORT' : ''}</div></div>
      <time>${esc(fmtEpoch(r.updatedAtMs))}</time>
    </div>`,
    )
    .join('\n')
  return `<div class="card">
  <div class="card-head"><h2>${icon('session')}最近会话</h2><a class="link-more" href="/sessions">会话档案 →</a></div>
  <div class="list-compact">${
    !available
      ? emptyState('session', '未发现工位档案树', '.AIWS 树出现后此处显示最近 3 条会话')
      : rows.length === 0
        ? emptyState('session', '暂无会话', 'daemon 派工后会话轨迹落 .AIWS 工位树')
        : items
  }</div>
</div>`
}
