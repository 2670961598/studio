/**
 * reports —— 报表聚合管线·月报最小闭环（docs/04-§三 核心契约 / docs/50 断链6 / docs/17-§3）
 *
 * 04-§三冻结的契约面（本模块实现的硬边界）：
 *   - 逐级聚合不跳级：人 → 部门 → 公司，每层只读下层输出（company 面只读 dept 面）；
 *   - 零自评指标：数字全部来自台账（events / work_records / people 镜像），文字面只是
 *     快照的视图——本刀 md 由纯渲染产生，不含 agent 主观叙述；
 *   - 文件名约定 `<YYYY-MM-DD>-<type>-<节点>-<一句话总结>.md` + front-matter
 *     {time, type∈daily|weekly|monthly, node, level, author}；
 *   - 报表快照落库（store reports 表 v6）：库行存引用（json_ref=公司目录相对路径），
 *     正文留文件（F2-03 结果体分离）。
 *
 * 本刀范围（任务书）：月报最小闭环——工时/成本/交付三指标，events/work_records 聚合落
 * reports 表，:8789 财务页可读。日报/周报三档框架已备（REPORT_TYPE_VALUES 值域），
 * 产报岗接线归后续刀。
 *
 * 指标口径（**拟稿待批**——04-§三只冻结聚合方向与零自评，指标定义为本刀拟稿）：
 *   - 工时 hours_ms：work_records 中 ended_at 落月窗内者 Σ(ended_at − started_at)；
 *     失败尝试也计（真实成本观）；在途（ended_at 空）不计（账未收）；归属=记录的人。
 *   - 成本 cost_usd：events 中 event='LLM' 且 ts 落月窗内者 Σ(cost_usd)；
 *     归属人=actor 的工号前缀（actor 形如 'AGENT-1:agent-1'=工号:账号，17-§3）。
 *     其中 work_records.cost_usd 单列报出（work_cost_usd，收割侧账目）。
 *   - 交付 delivered：events 中 event='CLOSE' 且 ts 落月窗内者按单计数；
 *     归属人=该单**最近一条** work_record 的人（跨月工作记录也参与归属判定——
 *     「谁干的」与「何时收账」分离）；无工作记录 → '(unattributed)' 诚实桶，不臆造。
 *   - 部门归属：people 镜像的 dept 列（公司目录快照）；镜像缺失 → '(unknown)' 诚实桶。
 *     (unknown)/(unattributed) 均为保留桶名，正常流程不产出同名真值。
 *   - 全零行不产出（当月无台账活动的人不上月报——报表是账目不是名册）。
 *
 * MCP 接口位（docs/49 §162-170 缓办令）：本刀只留 ReportOperationsPort 类型槽，不实现、
 * 不接网关——动词扩展走 GATEWAY_ACTIONS 时需批示流，见 contract/ports/gateway.ts 注锚。
 */
import { createHash } from 'node:crypto'
import { configInvalid, type EventRecord } from '@studio-next/contract'
import type { PersonRecord, ReportRecord, WorkRecord } from '@studio-next/store'

/** 月报口径版本戳（reports.caliber 列值；指标口径变更时换值——读面可辨新旧不可比） */
export const MONTHLY_CALIBER = 'monthly/v1'

/** 无部门归属诚实桶（people 镜像缺失时；保留名，不与真值冲突） */
export const UNKNOWN_DEPT = '(unknown)'

/** CLOSE 无工作记录单的交付归属诚实桶（保留名） */
export const UNATTRIBUTED_PERSON = '(unattributed)'

/** 聚合输入的最小台账切面（调用方负责按公司过滤；月窗由本模块再过滤） */
export interface MonthlyAggregationInput {
  /** 月键 'YYYY-MM'（UTC 口径——台账 ts 为 epoch ms，时区归渲染面） */
  month: string
  events: readonly EventRecord[]
  workRecords: readonly WorkRecord[]
  people: readonly PersonRecord[]
}

/** 人员月度指标（聚合最底层；数字全台账） */
export interface PersonMonthlyMetrics {
  person_id: string
  /** people 镜像名；镜像缺失=''（诚实：不臆造名字） */
  name: string
  /** people 镜像 dept；缺失=(unknown) 桶 */
  dept: string
  hours_ms: number
  cost_usd: number
  work_cost_usd: number
  delivered: number
  llm_events: number
}

/** 部门月度指标（人面归并；逐级聚合的中间层） */
export interface DeptMonthlyMetrics {
  node: string
  people: number
  hours_ms: number
  cost_usd: number
  work_cost_usd: number
  delivered: number
  llm_events: number
}

/** 公司月度指标（只读部门面输出；逐级聚合的顶层） */
export interface CompanyMonthlyMetrics {
  node: string
  people: number
  depts: number
  hours_ms: number
  cost_usd: number
  work_cost_usd: number
  delivered: number
  llm_events: number
}

/** 月报表快照（json 文件正文形状；schema 版本化——形状变更时换 schema 值） */
export interface MonthlyReportSnapshot {
  schema: 'monthly-report/v1'
  caliber: typeof MONTHLY_CALIBER
  company: string
  month: string
  generated_at: number
  /** 指标来源台账面（审计线索：数字可回放） */
  basis: 'events+work_records+people'
  metrics: CompanyMonthlyMetrics
  departments: DeptMonthlyMetrics[]
  persons: PersonMonthlyMetrics[]
}

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/

/** UTC 月窗（闭区间毫秒）：since=月初 00:00:00.000，until=次月初减 1ms；非法月键拒 */
export function monthWindow(month: string): { since: number; until: number } {
  const m = MONTH_KEY_RE.exec(month)
  if (m === null) configInvalid('company/reports:bad-month', `month=${month} 须为 YYYY-MM 月键（UTC 口径）`)
  const year = Number(m[1])
  const monthIdx = Number(m[2]) - 1
  if (monthIdx < 0 || monthIdx > 11) configInvalid('company/reports:bad-month', `month=${month} 月份越界（01-12）`)
  const since = Date.UTC(year, monthIdx, 1)
  return { since, until: Date.UTC(year, monthIdx + 1, 1) - 1 }
}

/** 归属期锚日 YYYY-MM-DD=当月末日 UTC（reports.date 列值；由期键派生，非生成时刻） */
export function monthlyAnchorDate(month: string): string {
  const { until } = monthWindow(month)
  const d = new Date(until)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** actor（工号:账号，17-§3）→ 工号；无冒号取整串（如 'daemon'——诚实归属到该名下） */
function actorPersonId(actor: string): string {
  const idx = actor.indexOf(':')
  return idx === -1 ? actor : actor.slice(0, idx)
}

/** 人员月度指标（聚合最底层）：工时/成本/交付三指标归到人 */
export function personMonthlyMetrics(input: MonthlyAggregationInput): PersonMonthlyMetrics[] {
  const { since, until } = monthWindow(input.month)
  const inWindow = (ts: number): boolean => ts >= since && ts <= until
  const byPerson = new Map<string, PersonMonthlyMetrics>()

  const ensure = (personId: string): PersonMonthlyMetrics => {
    let row = byPerson.get(personId)
    if (row === undefined) {
      const mirror = input.people.find((p) => p.person_id === personId)
      row = {
        person_id: personId,
        name: mirror?.name ?? '',
        dept: mirror?.dept ?? UNKNOWN_DEPT,
        hours_ms: 0,
        cost_usd: 0,
        work_cost_usd: 0,
        delivered: 0,
        llm_events: 0,
      }
      byPerson.set(personId, row)
    }
    return row
  }

  // ① 工时 + work_records 成本（ended 落月窗；在途不计；失败也计）
  for (const w of input.workRecords) {
    if (w.ended_at === null || w.ended_at === undefined || !inWindow(w.ended_at)) continue
    const row = ensure(w.person_id)
    row.hours_ms += w.ended_at - w.started_at
    row.work_cost_usd += w.cost_usd ?? 0
  }

  // ② LLM 成本（ts 落月窗；归属=actor 工号前缀）
  for (const e of input.events) {
    if (e.event !== 'LLM' || !inWindow(e.ts)) continue
    const row = ensure(actorPersonId(e.actor))
    row.cost_usd += e.cost_usd ?? 0
    row.llm_events += 1
  }

  // ③ 交付（CLOSE ts 落月窗；归属=该单最近一条 work_record 的人——跨月也参与判定）
  const latestWorkByIssue = new Map<string, WorkRecord>()
  for (const w of input.workRecords) {
    const cur = latestWorkByIssue.get(w.issue)
    if (cur === undefined || w.started_at > cur.started_at || (w.started_at === cur.started_at && w.id > cur.id)) {
      latestWorkByIssue.set(w.issue, w)
    }
  }
  for (const e of input.events) {
    if (e.event !== 'CLOSE' || !inWindow(e.ts)) continue
    const latest = latestWorkByIssue.get(e.issue)
    ensure(latest === undefined ? UNATTRIBUTED_PERSON : latest.person_id).delivered += 1
  }

  // 全零行不产出（报表是账目不是名册）；行按 person_id 升序稳定排序
  return [...byPerson.values()]
    .filter((r) => r.hours_ms !== 0 || r.cost_usd !== 0 || r.work_cost_usd !== 0 || r.delivered !== 0 || r.llm_events !== 0)
    .sort((a, b) => (a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : 0))
}

/** 部门月度指标（人面按 dept 归并；(unknown) 桶如实保留；行按 node 升序） */
export function rollupDeptMonthly(persons: readonly PersonMonthlyMetrics[]): DeptMonthlyMetrics[] {
  const byDept = new Map<string, DeptMonthlyMetrics>()
  for (const p of persons) {
    let row = byDept.get(p.dept)
    if (row === undefined) {
      row = { node: p.dept, people: 0, hours_ms: 0, cost_usd: 0, work_cost_usd: 0, delivered: 0, llm_events: 0 }
      byDept.set(p.dept, row)
    }
    row.people += 1
    row.hours_ms += p.hours_ms
    row.cost_usd += p.cost_usd
    row.work_cost_usd += p.work_cost_usd
    row.delivered += p.delivered
    row.llm_events += p.llm_events
  }
  return [...byDept.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0))
}

/** 公司月度指标（**只读部门面输出**——逐级聚合不跳级；数字=Σ部门，不回人面重算） */
export function rollupCompanyMonthly(company: string, depts: readonly DeptMonthlyMetrics[]): CompanyMonthlyMetrics {
  const out: CompanyMonthlyMetrics = {
    node: company,
    people: 0,
    depts: depts.length,
    hours_ms: 0,
    cost_usd: 0,
    work_cost_usd: 0,
    delivered: 0,
    llm_events: 0,
  }
  for (const d of depts) {
    out.people += d.people
    out.hours_ms += d.hours_ms
    out.cost_usd += d.cost_usd
    out.work_cost_usd += d.work_cost_usd
    out.delivered += d.delivered
    out.llm_events += d.llm_events
  }
  return out
}

/** 组装月报快照（纯函数：三级数字同源一次计算；generated_at 由调用方注入） */
export function buildMonthlySnapshot(input: MonthlyAggregationInput & { company: string; generatedAt: number }): MonthlyReportSnapshot {
  const persons = personMonthlyMetrics(input)
  const departments = rollupDeptMonthly(persons)
  return {
    schema: 'monthly-report/v1',
    caliber: MONTHLY_CALIBER,
    company: input.company,
    month: input.month,
    generated_at: input.generatedAt,
    basis: 'events+work_records+people',
    metrics: rollupCompanyMonthly(input.company, departments),
    departments,
    persons,
  }
}

/** 文件名安全化（04-§三「一句话总结」段）：路径分隔符/空白/控制符折叠为连字符，截长 60 */
function safeSummarySegment(summary: string): string {
  const seg = summary
    .replaceAll('/', '-')
    .replaceAll('\\', '-')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(' ', '-')
    .replaceAll(/[\u0000-\u001f<>:"|?*]+/g, '')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return seg === '' ? '月报' : seg
}

/** 04-§三文件名约定：md 与 json 同基名旁落（json_ref 指 json） */
export function monthlyReportPaths(input: { company: string; month: string; summary: string }): { mdPath: string; jsonPath: string } {
  const base = `${monthlyAnchorDate(input.month)}-monthly-${input.company}-${safeSummarySegment(input.summary)}`
  return { mdPath: `reports/${base}.md`, jsonPath: `reports/${base}.json` }
}

const fmtHours = (ms: number): string => (ms / 3_600_000).toFixed(2)
const fmtUsd = (usd: number): string => usd.toFixed(2)

/** md 渲染（04-§三 front-matter + 三级表；零自评——数字全来自快照，本文件只是视图） */
export function renderMonthlyReportMarkdown(snapshot: MonthlyReportSnapshot, meta: { level: number; author: string }): string {
  const lines: string[] = []
  lines.push('---', `time: ${new Date(snapshot.generated_at).toISOString()}`, 'type: monthly', `node: ${snapshot.company}`, `level: ${meta.level}`, `author: ${meta.author}`, '---', '')
  lines.push(`# ${snapshot.company} 经营月报（${snapshot.month}）`, '')
  lines.push(`> 口径 ${snapshot.caliber}｜basis=${snapshot.basis}｜生成于 ${new Date(snapshot.generated_at).toISOString()}`, '')
  lines.push('> 零自评指标：以下数字全部来自台账（events / work_records / people）聚合快照，本文件只是快照的视图。', '')
  lines.push('## 公司指标', '')
  lines.push('| 指标 | 值 |', '|---|---|')
  lines.push(`| 工时（小时） | ${fmtHours(snapshot.metrics.hours_ms)} |`)
  lines.push(`| 成本（USD） | ${fmtUsd(snapshot.metrics.cost_usd)} |`)
  lines.push(`| 其中 work_records 成本（USD） | ${fmtUsd(snapshot.metrics.work_cost_usd)} |`)
  lines.push(`| 交付（单） | ${snapshot.metrics.delivered} |`)
  lines.push(`| 覆盖人数 | ${snapshot.metrics.people} |`)
  lines.push(`| 覆盖部门 | ${snapshot.metrics.depts} |`, '')
  lines.push('## 部门', '')
  lines.push('| 部门 | 人数 | 工时(h) | 成本(USD) | 交付 |', '|---|---|---|---|---|')
  for (const d of snapshot.departments) {
    lines.push(`| ${d.node} | ${d.people} | ${fmtHours(d.hours_ms)} | ${fmtUsd(d.cost_usd)} | ${d.delivered} |`)
  }
  lines.push('', '## 人员', '')
  lines.push('| 工号 | 姓名 | 部门 | 工时(h) | 成本(USD) | 交付 |', '|---|---|---|---|---|---|')
  for (const p of snapshot.persons) {
    lines.push(`| ${p.person_id} | ${p.name} | ${p.dept} | ${fmtHours(p.hours_ms)} | ${fmtUsd(p.cost_usd)} | ${p.delivered} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 材料化依赖注入面：写文件与时钟由 daemon 接线（core 零 Date.now 纪律的库外同款） */
export interface MaterializeMonthlyReportDeps extends MonthlyAggregationInput {
  company: string
  /** 一句话总结（进文件名，04-§三） */
  summary: string
  /** 报表节点等级（front-matter level；公司级=公司等级） */
  level: number
  /** 报表作者（front-matter author；定时岗产报=daemon） */
  author: string
  /** 生成时刻（epoch ms） */
  now: number
  /** 公司目录相对写（daemon 注入：唯一写入者纪律——本模块不触盘） */
  writeRelFile: (relPath: string, content: string) => void
}

export interface MaterializedMonthlyReport {
  /** 报表快照行（喂 ledger.insertReport；json_ref 指 jsonPath） */
  report: ReportRecord
  mdPath: string
  jsonPath: string
  snapshot: MonthlyReportSnapshot
  md: string
  json: string
}

/** 内容寻址 id：monthly-<sha8(json)>——同内容同 id（库侧幂等跳过），内容变 id 变（覆盖换代） */
function contentAddressedId(json: string): string {
  return `monthly-${createHash('sha256').update(json).digest('hex').slice(0, 12)}`
}

/** 月报材料化：聚合 → 快照 JSON + md 渲染 → 注入写面落文件 → 组装 reports 行 */
export function materializeMonthlyReport(deps: MaterializeMonthlyReportDeps): MaterializedMonthlyReport {
  const snapshot = buildMonthlySnapshot({ company: deps.company, generatedAt: deps.now, month: deps.month, events: deps.events, workRecords: deps.workRecords, people: deps.people })
  const { mdPath, jsonPath } = monthlyReportPaths({ company: deps.company, month: deps.month, summary: deps.summary })
  const json = JSON.stringify(snapshot, null, 2)
  const md = renderMonthlyReportMarkdown(snapshot, { level: deps.level, author: deps.author })
  deps.writeRelFile(jsonPath, `${json}\n`)
  deps.writeRelFile(mdPath, md)
  return {
    report: {
      id: contentAddressedId(json),
      company: deps.company,
      node: deps.company,
      type: 'monthly',
      date: monthlyAnchorDate(deps.month),
      caliber: MONTHLY_CALIBER,
      json_ref: jsonPath,
    },
    mdPath,
    jsonPath,
    snapshot,
    md,
    json,
  }
}

// —— 报表操作接口位（docs/49 §162-170 MCP 缓办令：本刀只留类型槽，不实现不接线） ——

/** 报表操作请求（未来网关动作词的载荷面；动作集拟稿——落地需批示流） */
export interface ReportOperationRequest {
  action: 'recompute' | 'republish' | 'archive'
  company: string
  month: string
}

/** 报表操作结果（ok=false 时 reason 为人话失败原因——fail-closed 分类归实现方） */
export type ReportOperationResult = { ok: true; note: string } | { ok: false; reason: string }

/**
 * 报表操作端口（MCP 接口位）：未来 daemon 侧由「网关动作词扩展点」实现并注册；本刀
 * 无实现方。接线路径：GATEWAY_ACTIONS 增动词（批示流）→ daemon 实现 handler → 网关注册。
 */
export type ReportOperationHandler = (request: ReportOperationRequest) => Promise<ReportOperationResult>
