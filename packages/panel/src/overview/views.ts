/**
 * overview views —— :8789 公司概览面的纯函数层（v0.7 首刀：读面）
 *
 * 依据：docs/16-§四 v0.7（公司面：:8789/<slug>/ 可看组织/人事/财务/进度——本刀只做读面，
 * 编辑中心归后续刀）、docs/04-§七（概览路由按公司目录名：/<slug>/... 直达、未知名 404、
 * 根路径列公司清单）、docs/17-§8（:8789 端面：tab=概览/组织/人事/财务/项目/报表/编辑中心——
 * 本刀落前五读面中的概览/组织/人事/进度/财务；项目/报表 tab 与编辑中心归后续刀，不臆造）。
 * DEV-36 增量：财务页加「月报（reports 表）」段（store v6 reports type='monthly' 行 +
 * json_ref 快照 headline——04-§三 {node}/{date}-{type} 渲染约定的读面落点；报表 tab 整面
 * 归后续刀，此处只落月报最小闭环）。
 *
 * 分层纪律（与 :8787 views.ts 同款）：本文件零 IO、零 Hono 依赖——
 *   - 组织数据吃 CompanySnapshot（公司目录快照——组织事实源是公司 git 目录，docs/17-§1）；
 *   - 运营数据吃 Ledger 读面吐出的行（ticket_mirror / budgets / events——SQLite 台账是
 *     可重建投影，docs/17-§3），server.ts 负责取数；
 *   - 档案正文吃注入的 md 原文（people/<工号>.md，01-C2-04）——渲染为 pre 块零前端依赖。
 *
 * 口径声明：
 *   - 财务三口径分列对齐 :8787 成本卡（docs/26 C1）：reserve=estimated 求和、settle=actual
 *     求和、refusal=estimated 求和，净额=reserve−settle；不相加当总额。预算行按「本司 scope
 *     集」过滤：company scope=本司 slug ∪ issue scope=本司镜像单号 ∪ person scope=本司花名册
 *     （快照 people）——与 :8787 全量口径的区别就是公司维过滤。
 *   - LLM 成本按日：event='LLM' 的 cost_usd 按 UTC 日聚合（dayKeyOf 与 :8787 同口径）；
 *     v0 只列有事件的日（稀疏），零填充趋势窗归后续需要时加。
 *   - 组织树：parent 链嵌套；悬空 parent（父不在部门集）与成环链（互相为父不可达）的部门
 *     **提升为根节点渲染**（不静默消失——组织数据缺口如实可见，处置归目录侧）。
 *
 * HTML 纪律：全部服务端渲染、零前端依赖（无 JS 无 fetch 轮询——读面静态即可）；复用 :8787
 * 极简暗色风格；一切动态文本经 escapeHtml（档案 md 原文进 pre 块前同样转义——网页内容按
 * 不可信输入对待，docs/17-§5/§11 的读面同款纪律）。
 */
import type { CompanySnapshot, DeptNode, EventRecord, PersonRef } from '@studio-next/contract'
import type { BudgetRecord, ReportRecord, TicketMirrorRecord } from '@studio-next/store'
import { dayKeyOf } from '../views.ts'

// —— HTML 基元 ——

/** HTML 文本转义（与 :8787 页内 esc 同规则：& < > " ' 五字符实体化） */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/** 金额显示层取整到 4 位小数（台账存原始 double——models 冻结口径：显示层自取整） */
function fmtUsd(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}

/** URL 路径段转义（工号/slug 进 href 前；slug 形状闸在路由侧，此处防御性兜底） */
function escapePath(value: string): string {
  return encodeURIComponent(value)
}

/** 概览面共用暗色样式（复用 :8787 palette：#101418 底 / monospace / 同卡片风格） */
const OVERVIEW_CSS = `  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; background: #101418; color: #cfd8dc; margin: 0; padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #80cbc4; }
  h2 { font-size: 13px; margin: 0 0 8px; color: #eeff41; font-weight: 600; }
  #meta, .caliber, .empty, footer { color: #78909c; }
  #meta { margin-bottom: 12px; }
  nav { margin-bottom: 16px; }
  nav a { color: #80cbc4; margin-right: 12px; text-decoration: none; border-bottom: 1px dotted #37474f; }
  nav a.here { color: #eeff41; border-bottom-color: #eeff41; }
  table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { text-align: left; padding: 3px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { color: #90a4ae; border-bottom: 1px solid #263238; }
  tr:nth-child(even) td { background: #1b232b; }
  section { background: #161c22; border: 1px solid #263238; border-radius: 6px; padding: 12px; margin-bottom: 16px; min-width: 0; }
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  dt { color: #90a4ae; }
  dd { margin: 0; }
  ul.tree { list-style: none; padding-left: 0; margin: 0; }
  ul.tree ul.tree { padding-left: 24px; border-left: 1px dotted #37474f; }
  ul.tree li { padding: 2px 0; }
  ul.tree .path { color: #78909c; }
  .tag { display: inline-block; border: 1px solid #37474f; border-radius: 3px; padding: 0 5px; margin-left: 6px; color: #80cbc4; font-size: 12px; }
  .warn { color: #ff8a65; }
  pre { background: #0d1114; border: 1px solid #263238; border-radius: 6px; padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0; }
  a { color: #4dd0e1; }
  footer { margin-top: 16px; }`

/** 页面骨架（各页共用：head + 导航 tab + footer 口径声明） */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${OVERVIEW_CSS}
</style>
</head>
<body>
${body}
<footer>公司概览只读面（:8789，docs/04-§七 / 17-§8）：组织数据来自公司目录快照（git 目录=组织事实源）；
运营数据来自 SQLite 台账镜像（可重建投影）；财务三口径分列不相加（docs/26 C1）；月报段来自 reports 表（04-§三，快照不可读如实标注）；项目/报表 tab 归后续刀。</footer>
</body>
</html>
`
}

/**
 * tab 导航（当前页高亮；只列本刀已落地的读面 tab，未落地不臆造）。
 * basePath：链接前缀（''=规范路径；'/legacy'=旧版回滚面——DEV-12 换装后旧树内部链接
 * 保持树内可达，不自跳出到换装面）。
 */
function navTabs(slug: string, here: string, basePath = ''): string {
  const tabs: ReadonlyArray<readonly [key: string, label: string, href: string]> = [
    ['overview', '概览', `${basePath}/${escapePath(slug)}/`],
    ['org', '组织', `${basePath}/${escapePath(slug)}/org`],
    ['people', '人事', `${basePath}/${escapePath(slug)}/people`],
    ['progress', '进度', `${basePath}/${escapePath(slug)}/progress`],
    ['finance', '财务', `${basePath}/${escapePath(slug)}/finance`],
  ]
  const links = tabs
    .map(([key, label, href]) => `<a href="${href}"${key === here ? ' class="here"' : ''}>${escapeHtml(label)}</a>`)
    .join('')
  return `<nav>${links}<a href="${basePath}/">↑ 公司清单</a></nav>`
}

/** 404 页（未注册 slug / 未知工号 / 未知子路径共用；basePath 同 navTabs——规范面 ''/旧版面 '/legacy'） */
export function renderNotFoundPage(what: string, basePath = ''): string {
  return page(
    '404 · Studio Next 公司概览',
    `<h1>Studio Next 公司概览（:8789）</h1>
<div id="meta">只读面</div>
<section>
  <h2>404 未找到</h2>
  <p class="empty">${escapeHtml(what)} 不在概览面（未注册的 slug / 未知工号 / 未知子路径——docs/04-§七：路由按公司目录 slug，未知名 404）。</p>
  <p><a href="${basePath}/">← 返回公司清单</a></p>
</section>`,
  )
}

// —— 组织树（/org 的数据形状；纯函数可直测） ——

/** 组织树节点：部门 + 子部门（嵌套深度=部门层级，04-§二） */
export interface OrgTreeNode {
  dept: DeptNode
  children: OrgTreeNode[]
}

/** buildOrgTree 结果：根节点 + 两类「提升为根」的诚实标记 */
export interface OrgTree {
  roots: OrgTreeNode[]
  /** parent 不在部门集（悬空父引用）而被提升为根的部门 */
  promoted: DeptNode[]
  /** parent 链成环（从任何根都不可达）而被提升为根的部门 */
  cyclic: DeptNode[]
}

/**
 * 部门平面表 → 嵌套树（parent 链）。
 *   - parent=null 为根；parent 指向集内部门则挂其下；
 *   - 悬空 parent → 提升为根（promoted，不静默消失）；
 *   - 挂完后从根不可达（成环）→ 提升为根（cyclic）；
 *   - 同层内保持快照原序（输入确定 → 输出确定）。
 */
export function buildOrgTree(departments: DeptNode[]): OrgTree {
  const nodes = new Map<string, OrgTreeNode>()
  for (const dept of departments) nodes.set(dept.path, { dept, children: [] })

  const roots: OrgTreeNode[] = []
  const promoted: DeptNode[] = []
  for (const dept of departments) {
    const node = nodes.get(dept.path) as OrgTreeNode
    if (dept.parent === null) {
      roots.push(node)
      continue
    }
    const parent = nodes.get(dept.parent)
    if (parent === undefined) {
      roots.push(node) // 悬空父引用：提升为根，如实可见
      promoted.push(dept)
    } else {
      parent.children.push(node)
    }
  }

  // 可达性（防 A↔B 互为父的环把部门吞没）：从根游历，未达者提升为根。
  // 先全量收集未达者再统一游历——环上所有成员都入 cyclic（先游历会让环中后到者变「可达」漏标）。
  const reached = new Set<string>()
  const walk = (node: OrgTreeNode): void => {
    if (reached.has(node.dept.path)) return
    reached.add(node.dept.path)
    for (const child of node.children) walk(child)
  }
  for (const root of roots) walk(root)
  const cyclic: DeptNode[] = []
  const cyclicNodes: OrgTreeNode[] = []
  for (const dept of departments) {
    if (reached.has(dept.path)) continue
    const node = nodes.get(dept.path)
    if (node === undefined) continue // 不可能（上面全量入 map）；防御性兜底
    roots.push(node)
    cyclic.push(dept)
    cyclicNodes.push(node)
  }
  for (const node of cyclicNodes) walk(node)
  return { roots, promoted, cyclic }
}

/** 组织树 HTML：嵌套 ul + 每节点 name(path) · L<level> · 主管 leader · lanes/functions 标签 */
export function renderOrgTree(tree: OrgTree): string {
  const nodeHtml = (node: OrgTreeNode): string => {
    const d = node.dept
    const tags = [
      `L${String(d.level)}`,
      ...d.lanes.map((l) => `lane:${l}`),
      ...d.functions.map((f) => `fn:${f}`),
    ]
      .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
      .join('')
    const children = node.children.length > 0 ? `\n<ul class="tree">${node.children.map(nodeHtml).join('\n')}</ul>` : ''
    return `<li>${escapeHtml(d.name)} <span class="path">${escapeHtml(d.path)}</span> · 主管 ${escapeHtml(d.leader)}${tags}${children}</li>`
  }
  const warns: string[] = []
  if (tree.promoted.length > 0) {
    warns.push(`悬空父引用（parent 不在部门集，已提升为根）：${tree.promoted.map((d) => d.path).join('、')}`)
  }
  if (tree.cyclic.length > 0) {
    warns.push(`parent 链成环（从根不可达，已提升为根）：${tree.cyclic.map((d) => d.path).join('、')}`)
  }
  const warnHtml = warns.length > 0 ? `\n<p class="warn">${warns.map(escapeHtml).join('；')}</p>` : ''
  return `<ul class="tree">${tree.roots.map(nodeHtml).join('\n')}</ul>${warnHtml}`
}

// —— 进度（/progress：ticket_mirror 按状态聚合） ——

/** 进度卡口径说明 */
export const PROGRESS_NOTE =
  '进度口径：ticket_mirror（YouTrack 镜像，可重建投影）按 state 聚合计数，只计本司单据；' +
  '状态名以镜像行为准（YouTrack 状态流是权威源）'

/** 州表卫生映射层口径说明（127-C：state_mapping 应用时并入 note——统计视图透明可审计） */
export const PROGRESS_MAPPING_NOTE =
  '；州表卫生映射（127-C）：外来态按 org-config yt.state_mapping（启用前置审计全键盖戳）并入公司态统计——仅统计视图，不改平台状态'

/** 进度快照（/progress 的数据形状） */
export interface ProgressSnapshot {
  basis: 'ticket-mirror'
  note: string
  /** 本司镜像单据总数 */
  total: number
  /** 按状态聚合计数（count 降序，同数按状态名稳定序——与 :8787 事件分布同款输出确定性） */
  byState: Array<{ state: string; count: number }>
}

/**
 * 镜像行 → 本司进度聚合（company=slug 过滤在 server 侧已做或在此做均可——此处全量入、按 slug 滤）。
 * stateMapping（127-C 州表卫生映射层，可选）：外来态→公司态统计映射（CompanySnapshot.
 * stateMapping——装载面已过 yt.state_mapping_audited 全键盖戳校验）；**仅统计视图**——
 * 聚合计数先映射后计数，镜像行与 byState 原生态名口径不变（映射透明进 note）。
 */
export function buildProgressSnapshot(mirrors: TicketMirrorRecord[], slug: string, stateMapping?: Readonly<Record<string, string>>): ProgressSnapshot {
  const counts = new Map<string, number>()
  let total = 0
  for (const m of mirrors) {
    if (m.company !== slug) continue
    total += 1
    const state = stateMapping?.[m.state] ?? m.state
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const byState = [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state))
  const applied = stateMapping !== undefined && Object.keys(stateMapping).length > 0
  return { basis: 'ticket-mirror', note: PROGRESS_NOTE + (applied ? PROGRESS_MAPPING_NOTE : ''), total, byState }
}

// —— 财务（/finance：budgets 三口径分列 + 事件 LLM 成本按日） ——

/** 财务卡口径说明（对齐 :8787 成本卡 COSTS_NOTE 的分列口径 + 本司 scope 过滤声明） */
export const FINANCE_NOTE =
  '口径（docs/26 C1，与 :8787 成本卡同源）：reserve/settle/refusal 三口径分列不相加，净额=reserve−settle；' +
  '预算行按本司 scope 集过滤（company=本司 ∪ issue=本司镜像单 ∪ person=本司花名册）；LLM 成本=event=LLM 的 cost_usd 按 UTC 日聚合'

/** 预算三口径分列（每口径：金额合计 + 笔数） */
export interface FinanceBudgets {
  reserveUsd: number
  reserveCount: number
  settleUsd: number
  settleCount: number
  refusalUsd: number
  refusalCount: number
  /** 净额 = reserveUsd − settleUsd（未释放的预留占用；可为负） */
  netUsd: number
}

/** LLM 成本单日点 */
export interface FinanceLlmDay {
  /** UTC 日（YYYY-MM-DD，dayKeyOf 与 :8787 同口径） */
  date: string
  costUsd: number
  events: number
}

/** 月报行（reports 表 type='monthly' 的视图行；metrics 缺失=快照文件不可读，如实标注） */
export interface MonthlyReportViewRow {
  id: string
  /** 归属期锚日 YYYY-MM-DD（月报=当月末日 UTC） */
  date: string
  /** 口径版本戳（如 monthly/v1——口径变更是换代不是修订） */
  caliber: string
  /** 报表 JSON 快照的公司目录相对路径（审计线索：页面可见引用） */
  jsonRef: string
  /** headline 三指标（快照 metrics 头解析；undefined=快照不可读——零臆造） */
  metrics?: { hoursMs: number; costUsd: number; delivered: number }
}

/**
 * 月报快照 headline 防御性解析（panel 不 import company 的报表形状——分层纪律，快照形状
 * 归 company reports.ts，此处只按「数值三字段」窄面读取）：坏 JSON / 坏形状 / 缺字段 →
 * undefined（快照不可读，页面如实标注——不折算不猜测）。
 */
function parseMonthlyHeadline(raw: string | undefined): MonthlyReportViewRow['metrics'] {
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const metrics = (parsed as { metrics?: unknown }).metrics
    if (typeof metrics !== 'object' || metrics === null) return undefined
    const { hours_ms, cost_usd, delivered } = metrics as Record<string, unknown>
    if (typeof hours_ms !== 'number' || typeof cost_usd !== 'number' || typeof delivered !== 'number') return undefined
    return { hoursMs: hours_ms, costUsd: cost_usd, delivered }
  } catch {
    return undefined
  }
}

/** 财务快照（/finance 的数据形状） */
export interface FinanceSnapshot {
  basis: 'budgets+events'
  note: string
  budgets: FinanceBudgets
  /** LLM 成本按日（升序；只列有事件的日——v0 稀疏口径，零填充趋势窗归后续需要时加） */
  llmDaily: FinanceLlmDay[]
  /** 月报行（reports 表 type='monthly'，date 升序；04-§三 {node}/{date}-{type} 渲染约定的财务页落点） */
  monthly: MonthlyReportViewRow[]
}

/**
 * 财务一次聚合（纯函数）：
 *   - budgets：listBudgets 全量行按本司 scope 集过滤后三口径分列（estimated/actual 求和口径
 *     与 :8787 buildCostsSnapshot 逐字对齐：reserve+=estimated、settle+=actual、refusal+=estimated；
 *     未记金额的行计 0，如实不折算）；
 *   - events：本司事件（server 侧已按 company 维滤好）中 event='LLM' 者按 UTC 日聚合；
 *   - monthly：reports 表 type='monthly' 行（server 侧已按 company 维滤好）+ json_ref 快照
 *     headline 解析（readReportFile 注入缺省或快照不可读 → 行在、metrics=undefined 如实标注）。
 */
export function buildFinanceSnapshot(input: {
  slug: string
  budgets: BudgetRecord[]
  mirrors: TicketMirrorRecord[]
  /** 本司花名册（person scope 的判据——快照 people，镜像 people 表无公司维） */
  peopleIds: ReadonlySet<string>
  /** 本司事件行（queryEvents({company: slug}) 的回包；LLM 过滤在此做） */
  events: EventRecord[]
  /** 月报行（listReports({company: slug, type: 'monthly'}) 的回包；缺省=空段（旧调用面兼容） */
  reports?: readonly ReportRecord[]
  /** 报表快照文件读取面（json_ref → JSON 正文；缺省=全部「快照不可读」） */
  readReportFile?: (jsonRef: string) => string | undefined
}): FinanceSnapshot {
  const scopes = new Set<string>()
  scopes.add(`company:${input.slug}`)
  for (const m of input.mirrors) {
    if (m.company === input.slug) scopes.add(`issue:${m.issue}`)
  }
  for (const id of input.peopleIds) scopes.add(`person:${id}`)

  const budgets: FinanceBudgets = {
    reserveUsd: 0,
    reserveCount: 0,
    settleUsd: 0,
    settleCount: 0,
    refusalUsd: 0,
    refusalCount: 0,
    netUsd: 0,
  }
  for (const b of input.budgets) {
    if (!scopes.has(`${b.scope_kind}:${b.scope_id}`)) continue
    if (b.kind === 'reserve') {
      budgets.reserveUsd += b.estimated_usd ?? 0
      budgets.reserveCount += 1
    } else if (b.kind === 'settle') {
      budgets.settleUsd += b.actual_usd ?? 0
      budgets.settleCount += 1
    } else {
      budgets.refusalUsd += b.estimated_usd ?? 0
      budgets.refusalCount += 1
    }
  }
  budgets.netUsd = budgets.reserveUsd - budgets.settleUsd

  const days = new Map<string, FinanceLlmDay>()
  for (const ev of input.events) {
    if (ev.event !== 'LLM') continue
    const key = dayKeyOf(ev.ts)
    const slot = days.get(key) ?? { date: key, costUsd: 0, events: 0 }
    slot.costUsd += ev.cost_usd ?? 0
    slot.events += 1
    days.set(key, slot)
  }
  const llmDaily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))

  const monthly: MonthlyReportViewRow[] = (input.reports ?? []).map((r) => {
    const row: MonthlyReportViewRow = { id: r.id, date: r.date, caliber: r.caliber, jsonRef: r.json_ref }
    const metrics = parseMonthlyHeadline(input.readReportFile?.(r.json_ref))
    return metrics === undefined ? row : { ...row, metrics }
  })

  return { basis: 'budgets+events', note: FINANCE_NOTE, budgets, llmDaily, monthly }
}

// —— 各页 HTML 渲染 ——

/** 根路径：公司清单（docs/04-§七：多公司时根路径列公司清单；basePath 见 navTabs） */
export function renderCompanyListPage(entries: ReadonlyArray<{ slug: string; snapshot: CompanySnapshot }>, basePath = ''): string {
  const rows = entries
    .map(
      (e) =>
        `<tr><td><a href="${basePath}/${escapePath(e.slug)}/">${escapeHtml(e.snapshot.name)}</a></td>` +
        `<td>${escapeHtml(e.slug)}</td><td>L${String(e.snapshot.level)}</td>` +
        `<td>${String(e.snapshot.departments.length)}</td><td>${String(e.snapshot.people.length)}</td>` +
        `<td>${escapeHtml(e.snapshot.platform.platform)}</td></tr>`,
    )
    .join('\n')
  return page(
    '公司清单 · Studio Next 公司概览',
    `<h1>Studio Next 公司概览（:8789 只读面）</h1>
<div id="meta">已挂载 ${String(entries.length)} 家公司 · 路由 /&lt;slug&gt;/…（docs/04-§七）</div>
<section>
  <h2>公司清单</h2>
  <table><thead><tr><th>公司名</th><th>slug</th><th>等级</th><th>部门数</th><th>人数</th><th>平台绑定</th></tr></thead>
  <tbody>
${rows}
  </tbody></table>
</section>`,
  )
}

/** 概览卡字段来源：快照必载五项 + 注入位 mission（契约 CompanySnapshot 无 mission——见 server.ts 头注拟稿） */
export function renderCompanyPage(
  slug: string,
  snapshot: CompanySnapshot,
  mission: string | undefined,
  basePath = '',
): string {
  const missionText = mission === undefined ? '（未提供——契约 CompanySnapshot 暂无 mission 字段，注入位见 server.ts 头注拟稿）' : mission
  return page(
    `${snapshot.name} · 概览`,
    `<h1>${escapeHtml(snapshot.name)}（概览）</h1>
<div id="meta">slug ${escapeHtml(slug)} · L${String(snapshot.level)} 公司 · 平台绑定 ${escapeHtml(snapshot.platform.platform)}</div>
${navTabs(slug, 'overview', basePath)}
<section>
  <h2>公司卡</h2>
  <dl>
    <dt>公司名</dt><dd>${escapeHtml(snapshot.name)}</dd>
    <dt>等级</dt><dd>L${String(snapshot.level)}</dd>
    <dt>使命</dt><dd>${escapeHtml(missionText)}</dd>
    <dt>部门数</dt><dd>${String(snapshot.departments.length)}</dd>
    <dt>人数</dt><dd>${String(snapshot.people.length)}</dd>
    <dt>平台绑定</dt><dd>${escapeHtml(snapshot.platform.platform)}</dd>
    <dt>定时岗</dt><dd>${String(snapshot.jobs.length)}</dd>
    <dt>章程</dt><dd>${escapeHtml(snapshot.charter)}</dd>
  </dl>
</section>`,
  )
}

/** 组织页：嵌套树 + 悬空/成环诚实标记（basePath 见 navTabs） */
export function renderOrgPage(slug: string, snapshot: CompanySnapshot, basePath = ''): string {
  const tree = buildOrgTree(snapshot.departments)
  return page(
    `${snapshot.name} · 组织`,
    `<h1>${escapeHtml(snapshot.name)}（组织）</h1>
<div id="meta">slug ${escapeHtml(slug)} · ${String(snapshot.departments.length)} 个部门 · 嵌套深度=部门层级（04-§二）</div>
${navTabs(slug, 'org', basePath)}
<section>
  <h2>组织树</h2>
  ${renderOrgTree(tree)}
</section>`,
  )
}

/** 人事页：PersonRef 表（工号/姓名/login/等级/部门）+「档案正文」链接（有档案 md 可读时） */
export function renderPeoplePage(
  slug: string,
  snapshot: CompanySnapshot,
  hasBody: (personId: string) => boolean,
  basePath = '',
): string {
  const rows = snapshot.people
    .map((p) => {
      const link = hasBody(p.id)
        ? `<a href="${basePath}/${escapePath(slug)}/people/${escapePath(p.id)}">档案正文</a>`
        : '<span class="empty">（无档案正文）</span>'
      return (
        `<tr><td>${escapeHtml(p.id)}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.login)}</td>` +
        `<td>L${String(p.level)}</td><td>${escapeHtml(p.dept)}</td><td>${link}</td></tr>`
      )
    })
    .join('\n')
  return page(
    `${snapshot.name} · 人事`,
    `<h1>${escapeHtml(snapshot.name)}（人事）</h1>
<div id="meta">slug ${escapeHtml(slug)} · ${String(snapshot.people.length)} 人 · 工号=档案文件名=永不变主键（01-C2-04）</div>
${navTabs(slug, 'people', basePath)}
<section>
  <h2>花名册</h2>
  <table><thead><tr><th>工号</th><th>姓名</th><th>login</th><th>等级</th><th>部门</th><th>档案</th></tr></thead>
  <tbody>
${rows}
  </tbody></table>
</section>`,
  )
}

/** 人事档案页：md 原文渲染为 pre 块（零前端依赖；正文按不可信输入先转义） */
export function renderPersonPage(
  slug: string,
  person: PersonRef,
  body: string | undefined,
  basePath = '',
): string {
  const bodyBlock =
    body === undefined
      ? '<p class="empty">（档案正文缺失：工号在册但正文文件不可读——人事档案路径约定见 04-§二）</p>'
      : `<pre>${escapeHtml(body)}</pre>`
  return page(
    `${person.id} ${person.name} · 档案`,
    `<h1>${escapeHtml(person.name)}（${escapeHtml(person.id)}）档案</h1>
<div id="meta">slug ${escapeHtml(slug)} · ${escapeHtml(person.login)} · L${String(person.level)} · ${escapeHtml(person.dept)}</div>
${navTabs(slug, 'people', basePath)}
<section>
  <h2>档案正文（md 原文）</h2>
  ${bodyBlock}
</section>`,
  )
}

/** 进度页（有台账：状态聚合表；无台账：如实降级面） */
export function renderProgressPage(slug: string, snapshot: CompanySnapshot, progress: ProgressSnapshot | undefined, basePath = ''): string {
  const section =
    progress === undefined
      ? `<section>
  <h2>单据进度</h2>
  <p class="empty">无台账数据（本司未接 ledger——挂载时给 --db 即可呈现；docs/17-§3 台账是运营数据的唯一来源）。</p>
</section>`
      : `<section>
  <h2>单据进度 <span class="caliber">共 ${String(progress.total)} 单</span></h2>
  <div class="caliber">${escapeHtml(progress.note)}</div>
  <table><thead><tr><th>状态</th><th>单数</th></tr></thead>
  <tbody>
${progress.byState.map((s) => `<tr><td>${escapeHtml(s.state)}</td><td>${String(s.count)}</td></tr>`).join('\n')}
  </tbody></table>
</section>`
  return page(
    `${snapshot.name} · 进度`,
    `<h1>${escapeHtml(snapshot.name)}（进度）</h1>
<div id="meta">slug ${escapeHtml(slug)} · basis=${progress === undefined ? '（无台账）' : progress.basis}</div>
${navTabs(slug, 'progress', basePath)}
${section}`,
  )
}

/** 财务页（有台账：三口径分列 + LLM 按日；无台账：如实降级面） */
export function renderFinancePage(slug: string, snapshot: CompanySnapshot, finance: FinanceSnapshot | undefined, basePath = ''): string {
  const section =
    finance === undefined
      ? `<section>
  <h2>财务</h2>
  <p class="empty">无台账数据（本司未接 ledger——挂载时给 --db 即可呈现；docs/17-§3 台账是运营数据的唯一来源）。</p>
</section>`
      : `<section>
  <h2>预算三口径 <span class="caliber">分列不相加（docs/26 C1）</span></h2>
  <div class="caliber">${escapeHtml(finance.note)}</div>
  <table><thead><tr><th>口径</th><th>笔数</th><th>金额 USD</th></tr></thead>
  <tbody>
    <tr><td>reserve（预留）</td><td>${String(finance.budgets.reserveCount)}</td><td>${fmtUsd(finance.budgets.reserveUsd)}</td></tr>
    <tr><td>settle（结算）</td><td>${String(finance.budgets.settleCount)}</td><td>${fmtUsd(finance.budgets.settleUsd)}</td></tr>
    <tr><td>refusal（拒绝）</td><td>${String(finance.budgets.refusalCount)}</td><td>${fmtUsd(finance.budgets.refusalUsd)}</td></tr>
    <tr><td>净额（reserve−settle）</td><td>—</td><td>${fmtUsd(finance.budgets.netUsd)}</td></tr>
  </tbody></table>
</section>
<section>
  <h2>LLM 成本按日（UTC）</h2>
  <table><thead><tr><th>日</th><th>LLM 事件</th><th>成本 USD</th></tr></thead>
  <tbody>
${finance.llmDaily.map((d) => `<tr><td>${escapeHtml(d.date)}</td><td>${String(d.events)}</td><td>${fmtUsd(d.costUsd)}</td></tr>`).join('\n')}
  </tbody></table>
</section>
<section>
  <h2>月报（reports 表） <span class="caliber">04-§三 {node}/{date}-{type} 渲染约定</span></h2>
  ${finance.monthly.length === 0 ? '<p class="empty">尚无月报行（reports 表无 type=monthly 行——月报最小闭环首刀，产报岗接线归后续刀）。</p>' : `<table><thead><tr><th>锚日</th><th>口径</th><th>工时（h）</th><th>成本 USD</th><th>交付（单）</th><th>快照引用</th></tr></thead>
  <tbody>
${finance.monthly
  .map(
    (m) =>
      `<tr><td>${escapeHtml(m.date)}</td><td>${escapeHtml(m.caliber)}</td>` +
      (m.metrics === undefined
        ? '<td colspan="3" class="empty">快照不可读</td>'
        : `<td>${(m.metrics.hoursMs / 3_600_000).toFixed(2)}</td><td>${fmtUsd(m.metrics.costUsd)}</td><td>${String(m.metrics.delivered)}</td>`) +
      `<td>${escapeHtml(m.jsonRef)}</td></tr>`,
  )
  .join('\n')}
  </tbody></table>`}
</section>`
  return page(
    `${snapshot.name} · 财务`,
    `<h1>${escapeHtml(snapshot.name)}（财务）</h1>
<div id="meta">slug ${escapeHtml(slug)} · basis=${finance === undefined ? '（无台账）' : finance.basis}</div>
${navTabs(slug, 'finance', basePath)}
${section}`,
  )
}
