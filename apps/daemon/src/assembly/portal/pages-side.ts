/**
 * portal/pages-side —— 组织／报表／聊天包装页。
 *
 * 依据：docs/plan/11-公司门户-2026-11-23.md §1.2（组织树/人员表/报表树/报表查看/聊天）。
 * 聊天页：内容片段单源来自 @studio-next/panel/chat 的 renderChatBody（业务脚本零复制），
 * 本文件只做门户壳包装（§三——复用 createChatApp 挂同端口，样式按门户 tokens 覆写）。
 */
import { renderChatBody, type ChatPageOptions } from '@studio-next/panel/chat'
import type { PortalData, ReportFileView, ReportViewResult } from './data.ts'
import { emptyState, esc, fmtBytes, fmtTime, icon, url } from './html.ts'
import { pageHead } from './layout.ts'

/** 组织页 body（§1.2：部门树＋人员表） */
export function orgBody(data: PortalData): string {
  const org = data.org()
  const company = data.company()

  const tree = org.departments
    .map(
      (d) =>
        `    <div class="tree-row" style="padding-left:${16 + d.depth * 22}px">
      ${d.depth > 0 ? '<span class="muted">└</span>' : icon('org', 15)}
      <span class="name">${esc(d.name)}</span>
      <span class="lvl">L${d.level}</span>
      <span class="meta">
        <span>负责人 ${esc(d.leaderName)}（${esc(d.leader)}）</span>
        ${d.lanes.length > 0 ? `<span>${icon('link', 12)}${d.lanes.map((l) => esc(l)).join(' / ')}</span>` : ''}
        ${d.functions.length > 0 ? `<span>${esc(d.functions.join(' · '))}</span>` : ''}
      </span>
    </div>`,
    )
    .join('\n')

  const people = org.people
    .map(
      (p) =>
        `    <tr>
      <td class="id">${esc(p.id)}</td>
      <td>${esc(p.name)}</td>
      <td class="muted">${esc(p.deptName)}</td>
      <td><span class="lvl">L${p.level}</span></td>
      <td class="muted mono">${esc(p.login)}</td>
    </tr>`,
    )
    .join('\n')

  return `${pageHead('组织', `${org.departments.length} 个部门 · ${org.people.length} 名在册人员 · 公司等级 L${company.level}`)}
<div class="stack">
  <div class="card">
    <div class="card-head"><h2>${icon('org')}部门树</h2><span class="link-more">负责人/等级/泳道/职能</span></div>
    <div class="tree">
${tree}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${icon('people')}人员名册</h2><span class="link-more num">${org.people.length} 人</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>等级</th><th>登录名</th></tr></thead>
      <tbody>
${people}
      </tbody>
    </table></div>
  </div>
</div>`
}

/** 报表页每页条数（§1.2 补订：服务端 q 过滤＋limit 截断——真实树 1500+ 件不整页倾倒） */
export const REPORTS_DEFAULT_LIMIT = 100
export const REPORTS_MAX_LIMIT = 500

/** 报表页查询视图（server 侧已完成过滤＋切片；本函数只渲染，不重算分页） */
export interface ReportsPageQuery {
  /** 路径关键字（已 trim；''=未筛） */
  readonly q: string
  readonly limit: number
  readonly page: number
  /** 全树文件数（未筛总数） */
  readonly totalAll: number
  /** 筛后文件数（未筛时 = totalAll） */
  readonly totalMatch: number
}

/** 报表页 body（§1.2：搜索框＋文件表＋范围分页；files 为当页行） */
export function reportsBody(files: readonly ReportFileView[], q: ReportsPageQuery): string {
  const pages = Math.max(1, Math.ceil(q.totalMatch / q.limit))
  const from = files.length === 0 ? 0 : (q.page - 1) * q.limit + 1
  const to = from + files.length - 1
  // 链接保持 q/limit（翻页/清除都续传当次口径）
  const href = (page: number): string => {
    const params = new URLSearchParams()
    if (q.q !== '') params.set('q', q.q)
    params.set('limit', String(q.limit))
    if (page > 1) params.set('page', String(page))
    return `/reports?${params.toString()}`
  }
  const rows = files
    .map(
      (f) =>
        `    <tr>
      <td class="title-cell">${icon('file', 13)} <a href="/reports/view?path=${url(f.relPath)}" title="${esc(f.relPath)}">${esc(f.relPath)}</a></td>
      <td class="muted nowrap">${esc(fmtBytes(f.sizeBytes))}</td>
      <td class="muted nowrap">${esc(fmtTime(new Date(f.mtimeMs).toISOString()))}</td>
    </tr>`,
    )
    .join('\n')
  const sub =
    q.totalAll === 0
      ? '公司目录 reports/ 为空或不存在'
      : q.q === ''
        ? `公司目录 reports/ 下共 ${q.totalAll} 个文件${q.totalAll > q.limit ? `（显示前 ${q.limit}）` : ''}`
        : `关键字「${q.q}」匹配 ${q.totalMatch} 个文件（全树 ${q.totalAll} 个${q.totalMatch > q.limit ? `；显示前 ${q.limit}` : ''}）`
  const toolbar = `<div class="toolbar">${q.q === '' ? '' : `\n  <a class="btn ghost" href="/reports?limit=${q.limit}">清除关键字</a>`}
  <form class="search" method="get" action="/reports">
    <input type="search" name="q" value="${esc(q.q)}" placeholder="按路径关键字过滤…" aria-label="过滤报表文件">
    <input type="hidden" name="limit" value="${q.limit}">
    <button class="btn" type="submit">${icon('search', 14)}过滤</button>
  </form>
</div>`
  const pager =
    q.totalMatch > q.limit
      ? `\n<div class="pager">
  <span>第 ${from}–${to} 条 / 共 ${q.totalMatch} 条 · 第 ${q.page}/${pages} 页</span>
  <a class="btn${q.page <= 1 ? '' : ' ghost'}" href="${esc(href(Math.max(1, q.page - 1)))}"${q.page <= 1 ? ' aria-disabled="true"' : ''}>${icon('back', 13)}上一页</a>
  <a class="btn${q.page >= pages ? '' : ' ghost'}" href="${esc(href(Math.min(pages, q.page + 1)))}"${q.page >= pages ? ' aria-disabled="true"' : ''}>下一页</a>
</div>`
      : ''
  const body =
    q.totalAll === 0
      ? `  <div class="card-body">${emptyState('report', '暂无报表文件', '公司目录 reports/ 为空或不存在——报表由 daemon 收割落盘（04-§三）')}</div>`
      : q.totalMatch === 0
        ? `  <div class="card-body">${emptyState('search', '没有匹配的文件', `关键字未命中任何报表路径——清空关键字后提交，或「清除」看全树 ${q.totalAll} 个文件`)}</div>`
        : `  <div class="table-wrap"><table class="table">
    <thead><tr><th>文件</th><th>大小</th><th>修改时间</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>${pager}`
  return `${pageHead('报表', sub)}
${toolbar}
<div class="card">
${body}
</div>`
}

/** 报表查看页 body（§1.2：pre 文本渲染；越界/不存在由 server 折 400/404） */
export function reportViewBody(result: Extract<ReportViewResult, { ok: true }>): string {
  const f = result.file
  return `<a class="back" href="/reports">${icon('back', 14)}返回报表列表</a>
<div class="card">
  <div class="card-head">
    <h2 style="word-break:break-all">${icon('file')}${esc(f.relPath)}</h2>
    <span class="report-meta"><span class="kv"><span class="k">大小</span><span class="num">${esc(fmtBytes(f.sizeBytes))}</span></span><span class="kv"><span class="k">修改</span><span class="num">${esc(fmtTime(new Date(f.mtimeMs).toISOString()))}</span></span></span>
  </div>
  <div style="overflow:auto">
    <pre class="file-pre">${esc(result.text)}</pre>
  </div>
${
  result.truncated
    ? `  <div class="pager"><span>文件超过 1 MiB，仅显示前 1 MiB 文本</span></div>
`
    : ''
}</div>`
}

/** 聊天页渲染器（pageRenderer 注入位——门户壳包 renderChatBody 单源片段） */
export function chatPageRenderer(shell: (title: string, active: string, body: string, opts?: { mainAsDiv?: boolean }) => string) {
  return (opts: ChatPageOptions): string => {
    // 片段自带 <main>：外壳内容区让位为 div（一页一个 main 地标）
    const head = opts.enabled
      ? pageHead('聊天', `公司聊天室 · 房间 / 消息 / 未读 · 缺省操作者 ${opts.defaultActorId}（chatd 本地 socket）`)
      : `${pageHead('聊天', '公司聊天室（未启用）')}
<div class="banner info">${icon('chat')}<div class="grow">门户启用方式：启动时加 <code>--chatd-socket &lt;socket 路径&gt;</code>（chatd 配了鉴权再加 <code>--chatd-token-file &lt;文件&gt;</code>，缺省操作者工号可加 <code>--chat-actor</code>）；亦可走下列运维 env。未启用时 <code>/api/chat/*</code> 一律 503，不冒充空房间。</div></div>`
    return shell(
      '聊天',
      'chat',
      `${head}
<div class="chat-embed">
${renderChatBody(opts)}
</div>`,
      { mainAsDiv: true },
    )
  }
}
