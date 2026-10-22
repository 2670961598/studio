/**
 * reports —— :8789 报表 tab 的纯投影层（127-B，studio-dev-176；规格=studio-dev-127
 * plan §4.6，制作人 2026-10-22 全批；docs/17-§8 报表 tab 设计位断链欠账修复）
 *
 * v1 范围（§4.6 冻结口径，metadata-only）：
 *   - 清单：部门分组＋最新件优先＋大小/mtime（**辅助列**——目录文件可被 touch 洗绿，
 *     红队漏项 6；时序与新旧的权威=台账事件 ts）；
 *   - 新鲜度灯：**台账事件为源**（P4 台账为源、面板为投影）——R2 事件
 *     （JOB_STALE/LATE_FIRST_RUN，127-A 冻结词表）＋P3 对账事件（SENTINEL_MISSING/
 *     HARVEST_INVALID/REPORT_MISSING/HARVEST_DENIED/HARVEST_INCOMPLETE）＋产出落位
 *     （GATE_PASS note `;output=`——收割四要件过闸后的内联收账，docs/17-§6/§2 相位 4）；
 *   - 公司级汇总一屏：各部门最新件＋部门灯（逐级聚合 v1=清单级——制作人「统一在
 *     界面上看」令满足到清单级，内容级上汇归 v2）；
 *   - 正文渲染不绕开待批项：REPORTS_BODY_NOTE（红队 5-3 采纳）；
 *   - v2 登记位：REPORTS_V2_NOTE（小模型自整理＋逐级收集上汇——制作人 2026-10-22
 *     补充令，依赖 studio-dev-160 原语与 127 v2 立项，本单不做）。
 *
 * 诚实纪律（Spike-2 判负线逐条对应）：
 *   - 缺失件绝不静默跳过：台账有落位、目录无此件 → 行在、missing=true；
 *   - 受辖岗（output 已声明、非 patrol 型——127-D 岗型治理判据，与 harvest-recon 同款）
 *     从未落位 → 组在、neverLanded 如实标注，不臆造绿灯；
 *   - 目录件无台账锚 → unanchored=true（时序退 mtime，如实标注）；
 *   - 渲染层零写：本文件零 IO、零 Hono（与 views.ts 同层）——数据全注入（jobs/events
 *     来自快照与台账读面，files 来自 wiring 侧扫描注入——panel 不碰磁盘与库）。
 *
 * 降级面（不臆造）：无台账 → 灯全 none、清单只剩目录件（unanchored）；目录读面未挂 →
 * 清单只剩事件件（**不判 missing**——读面缺位≠归档缺失，大小/mtime 缺省）；两者皆无 → 空面。
 */
import { parseJobOps } from '@studio-next/company'
import type { EventRecord, ScheduledJob } from '@studio-next/contract'

/** 正文待批项注记（§4.6 红队 5-3 采纳：v1 只列元数据，内容端点与口径待批示后开） */
export const REPORTS_BODY_NOTE = 'v1 只列元数据（metadata-only）——正文内容端点与口径待批示后开（studio-dev-127 §4.6 待批项），本页不渲染报告正文'

/** v2 登记位（§4.6 逐级上汇分期诚实标注：v2=内容级上汇——本案不做） */
export const REPORTS_V2_NOTE = 'v2 登记位：小模型自整理＋逐级收集上汇（制作人 2026-10-22 补充令）依赖 studio-dev-160 原语与 127 v2 立项——未立项不开'

/** 目录读面注入的文件元数据（wiring 侧 stat 公司目录 reports/ 树而来；panel 零 IO） */
export interface ReportFileMeta {
  /** 公司目录相对路径（形 `reports/<部门>/<文件名>`，posix 分隔） */
  relPath: string
  /** 字节数（辅助列） */
  sizeBytes: number
  /** mtime（epoch ms，辅助列——可被 touch 洗绿，不作物序权威） */
  mtimeMs: number
}

/** 报表灯（事件派生；缺省灰=无信号——如实，不臆造绿灯） */
export type ReportLight = 'fresh' | 'stale' | 'debt' | 'none'

/** 灯的人话注（与 ReportLight 一一对应；面板/JSON 共用单表） */
export const REPORT_LIGHT_TEXT: Readonly<Record<ReportLight, string>> = Object.freeze({
  fresh: '产出落位',
  stale: '停跑/从未跑',
  debt: '对账欠账',
  none: '无台账信号',
})

/** 灯严重度（部门灯=组内最差；Spike-2 判负线：灯必须与台账事件一致） */
const LIGHT_SEVERITY: Readonly<Record<ReportLight, number>> = Object.freeze({ stale: 3, debt: 2, none: 1, fresh: 0 })

/** 清单行：目录件 × 落位事件的 join 结果（键=组名+文件名） */
export interface ReportItemRow {
  /** 部门分组名（落点目录名；公司级件=COMPANY_GROUP、他处落点=OTHER_GROUP） */
  deptDir: string
  /** 文件名 */
  name: string
  /** 审计路径：有台账锚=事件 output 目标（绝对路径）；无锚=公司目录相对路径 */
  path: string
  /** 落位事件 ts（权威时序；无锚=null） */
  ledgerTs: number | null
  /** 落位单号（GATE_PASS 的 issue；无锚=null） */
  ticket: string | null
  /** 落位岗（PATROL 锚 join；锚失联=null） */
  jobId: string | null
  /** 字节数（辅助列；事件件/读面未挂=null） */
  sizeBytes: number | null
  /** mtime（辅助列；同上） */
  mtimeMs: number | null
  /** 台账有落位、目录无此件（目录读面挂载时才可判——缺失件绝不静默跳过） */
  missing: boolean
  /** 目录有件、台账无落位锚（历史存量/收账面落地前旧件——如实标注） */
  unanchored: boolean
}

/** 受辖岗灯（最新信号胜——freshest wins，全事件派生） */
export interface ReportJobLight {
  jobId: string
  light: ReportLight
  /** 最新信号时刻（epoch ms；无信号=null） */
  lastSignalTs: number | null
  /** 最新信号人话（stale=四元组分诊文本；debt=欠账类型；fresh=落位单号；none=null） */
  lastSignalText: string | null
  /** 累计落位件数（GATE_PASS output=） */
  landings: number
  /** 从未落位（缺失面如实标注——判负线：不许静默） */
  neverLanded: boolean
}

/** 部门分组（清单聚合的组；组名=落点目录名） */
export interface DeptReportGroup {
  /** 组名（落点目录名，如 综合部；公司级/其他落点用保留组名） */
  dept: string
  /** 部门 path（受辖岗 dept 列；纯目录组=null——公司级/其他落点） */
  deptPath: string | null
  /** 组灯=组内受辖岗最差（无受辖岗=none） */
  light: ReportLight
  /** 组灯人话注（无岗组=「只列件不计灯」口径句） */
  lightText: string
  /** 受辖岗灯（按 jobId 升序） */
  jobs: ReportJobLight[]
  /** 清单（最新件优先：ledgerTs 优先、无锚退 mtime；并列按 name 升序稳定） */
  items: ReportItemRow[]
  /** 最新件（items[0]；空组=null） */
  newest: ReportItemRow | null
}

/** 报表 tab 快照（v1 metadata-only 投影） */
export interface ReportsSnapshot {
  /** 台账读面是否可用（false=灯全 none、清单只剩目录件） */
  ledgerAvailable: boolean
  /** 目录读面是否挂载（false=清单只剩事件件、不判 missing） */
  dirAvailable: boolean
  /** 公司级灯=有受辖岗各组最差（全组无岗=none） */
  companyLight: ReportLight
  /** 部门分组（组名升序；公司级/其他落点保留组排后） */
  departments: DeptReportGroup[]
  /** 正文待批项注记（REPORTS_BODY_NOTE） */
  bodyNote: string
  /** v2 登记位注记（REPORTS_V2_NOTE） */
  v2Note: string
}

/** 公司级落点保留组名（reports/ 根直落的件——如月报快照对；不与部门名冲突的保留形） */
export const COMPANY_GROUP = '（公司级）'

/** 非 reports/ 树落点的保留组名（受辖岗 output 声明在他处——如实归桶不丢行） */
export const OTHER_GROUP = '（其他落点）'

/** buildReportsSnapshot 输入（全注入——jobs/events 来自 server 侧读面，files 来自 wiring 扫描） */
export interface ReportsSnapshotInput {
  /** 快照岗集（CompanySnapshot.jobs——声明面；热源随目录热更） */
  jobs: readonly ScheduledJob[]
  /** 台账事件（company 维已过滤；无台账=空数组＋ledgerAvailable=false） */
  events: readonly EventRecord[]
  /** 台账读面可用性（server 侧 ledger 未注入即 false——灯面如实降级） */
  ledgerAvailable: boolean
  /** 目录读面（undefined=未挂载——清单退事件件，不判 missing） */
  files?: readonly ReportFileMeta[] | undefined
}

// —— 事件 note 结构化解析（17-§3 note 结构化先例：fp=/budget=/wait= 同款分号段）——

/** note 分号段取值（`;key=value` 或行首 `key=value`；全半角分号都吃） */
function noteSegment(note: string | undefined, key: string): string | undefined {
  if (note === undefined) return undefined
  const m = new RegExp(`(?:^|[;；])${key}=([^;；]*)`).exec(note)
  return m === null ? undefined : (m[1] as string)
}

/** 落位目标（GATE_PASS note `;output=<目标路径>`——output-account 收账步后缀） */
function landingTargetOf(note: string | undefined): string | undefined {
  const target = noteSegment(note, 'output')
  return target === undefined || target === '' ? undefined : target
}

/** 岗锚（PATROL/JOB_STALE/SENTINEL_MISSING note `;job=<job_id>`） */
function jobAnchorOf(note: string | undefined): string | undefined {
  const job = noteSegment(note, 'job')
  return job === undefined || job === '' ? undefined : job
}

/** 落点分组键：路径里最后一个 `reports/` 段之后的目录结构——首段=组名，无目录=公司级 */
function groupKeyOf(posixPath: string): string {
  const normalized = posixPath.replaceAll('\\', '/')
  const marker = '/reports/'
  const idx = normalized.lastIndexOf(marker)
  const afterReports =
    idx >= 0
      ? normalized.slice(idx + marker.length)
      : normalized.startsWith('reports/')
        ? normalized.slice('reports/'.length)
        : null
  if (afterReports === null) return OTHER_GROUP
  const segs = afterReports.split('/')
  if (segs.length === 1 || segs[0] === '') return COMPANY_GROUP // reports/ 根直落
  return segs[0] as string
}

/** 受辖岗判定（127-D 岗型治理：output 已声明且非 patrol 型——与 harvest-recon 同判据） */
function isReportJob(job: ScheduledJob): boolean {
  const payload = job.payload
  const type =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as { type?: unknown }).type
      : undefined
  return parseJobOps(payload).output !== undefined && type !== 'patrol'
}

/** 岗的声明落点分组（parseJobOps.output 相对路径；受辖岗已验 output 非空） */
function jobGroupOf(job: ScheduledJob): string {
  return groupKeyOf(parseJobOps(job.payload).output ?? '')
}

/** stale 分诊文本（note 前缀——freshness 源写入的「停跑（…）/从未跑过（…）」人话段） */
function staleTextOf(event: string, note: string | undefined): string {
  const split = note === undefined ? undefined : note.split(/[;；]src=/)[0]
  const diag = split !== undefined && split !== '' ? split : event
  return `${diag}（处置=手动补跑 jobs catchup）`
}

/** P3 对账欠账事件的人话（词表语义单表——面板只译词不判账） */
function debtTextOf(event: string): string {
  switch (event) {
    case 'SENTINEL_MISSING':
      return '哨兵缺/不符（收割证据链断——欠账不重派，补跑走新槽）'
    case 'HARVEST_INVALID':
      return '归档件空壳/损坏（读回门不过——人工核对）'
    case 'REPORT_MISSING':
      return '归档缺件（对账补收失败/转人工）'
    case 'HARVEST_DENIED':
      return '收账面不可读（权限/可达性）'
    case 'HARVEST_INCOMPLETE':
      return '有产物无 REPORT（悬空面——不补收不代写）'
    default:
      return `P3 对账事件 ${event}`
  }
}

/** P3 对账欠账词表（127-A R4＋P3 增补族——进灯的最新信号面） */
const DEBT_EVENTS: ReadonlySet<string> = new Set([
  'SENTINEL_MISSING',
  'HARVEST_INVALID',
  'REPORT_MISSING',
  'HARVEST_DENIED',
  'HARVEST_INCOMPLETE',
])

/**
 * 报表 tab 快照投影（纯函数：jobs×events×files → 分组清单＋灯＋汇总；零 IO 零时钟）。
 * 排序口径：组内 ledgerTs 优先（无锚退 mtimeMs）降序；分组名升序、保留组（公司级/其他
 * 落点）排后——渲染序稳定可回放。
 */
export function buildReportsSnapshot(input: ReportsSnapshotInput): ReportsSnapshot {
  const { jobs, events, ledgerAvailable, files } = input
  const dirAvailable = files !== undefined

  // ① 单→岗锚（PATROL note job= 首条口径——与 harvest-recon anchorOf 同形 join）
  const issueToJob = new Map<string, string>()
  for (const e of events) {
    if (e.event !== 'PATROL') continue
    const job = jobAnchorOf(e.note)
    if (job !== undefined && !issueToJob.has(e.issue)) issueToJob.set(e.issue, job)
  }

  // ② 落位事件（GATE_PASS note output=——收割成功判据后的收账步，docs/17-§6/§2 相位 4）
  interface Landing {
    ts: number
    ticket: string
    target: string
    jobId: string | null
  }
  const landings: Landing[] = []
  for (const e of events) {
    if (e.event !== 'GATE_PASS') continue
    const target = landingTargetOf(e.note)
    if (target === undefined) continue
    landings.push({ ts: e.ts, ticket: e.issue, target, jobId: issueToJob.get(e.issue) ?? null })
  }

  // ③ 新鲜度/欠账信号（逐岗取最新——freshest wins；词表=127-A 冻结面，无台账不判）
  interface Signal {
    ts: number
    light: 'stale' | 'debt'
    text: string
  }
  const jobSignals = new Map<string, Signal>()
  const recordSignal = (jobId: string, signal: Signal): void => {
    const cur = jobSignals.get(jobId)
    if (cur === undefined || signal.ts >= cur.ts) jobSignals.set(jobId, signal)
  }
  if (ledgerAvailable) {
    for (const e of events) {
      if (e.event === 'JOB_STALE' || e.event === 'LATE_FIRST_RUN') {
        const job = jobAnchorOf(e.note)
        if (job !== undefined) recordSignal(job, { ts: e.ts, light: 'stale', text: staleTextOf(e.event, e.note) })
      } else if (DEBT_EVENTS.has(e.event)) {
        // SENTINEL_MISSING note 携 job=；其余经 issue→PATROL 锚 join（锚缺再试 note job=）
        const job = e.event === 'SENTINEL_MISSING' ? jobAnchorOf(e.note) : (issueToJob.get(e.issue) ?? jobAnchorOf(e.note))
        if (job !== undefined) recordSignal(job, { ts: e.ts, light: 'debt', text: `${debtTextOf(e.event)}（${e.event}）` })
      }
    }
  }

  // ④ 受辖岗灯（最新信号=信号与落位的 ts 最大者——落位即 fresh 证据）
  const landingCountByJob = new Map<string, number>()
  const latestLandingByJob = new Map<string, Landing>()
  for (const landing of landings) {
    if (landing.jobId === null) continue
    landingCountByJob.set(landing.jobId, (landingCountByJob.get(landing.jobId) ?? 0) + 1)
    const cur = latestLandingByJob.get(landing.jobId)
    if (cur === undefined || landing.ts > cur.ts) latestLandingByJob.set(landing.jobId, landing)
  }
  const reportJobs = jobs.filter(isReportJob)
  const jobLights = new Map<string, ReportJobLight>()
  for (const job of reportJobs) {
    const signal = jobSignals.get(job.job_id)
    const latestLanding = latestLandingByJob.get(job.job_id)
    const candidates: Array<{ ts: number; light: ReportLight; text: string }> = []
    if (signal !== undefined) candidates.push({ ts: signal.ts, light: signal.light, text: signal.text })
    if (latestLanding !== undefined) {
      candidates.push({ ts: latestLanding.ts, light: 'fresh', text: `最近产出落位（${latestLanding.ticket}）` })
    }
    let light: ReportLight = 'none'
    let lastSignalTs: number | null = null
    let lastSignalText: string | null = null
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.ts - a.ts)
      const winner = candidates[0] as { ts: number; light: ReportLight; text: string }
      light = winner.light
      lastSignalTs = winner.ts
      lastSignalText = winner.text
    }
    const count = landingCountByJob.get(job.job_id) ?? 0
    jobLights.set(job.job_id, {
      jobId: job.job_id,
      light,
      lastSignalTs,
      lastSignalText,
      landings: count,
      neverLanded: count === 0,
    })
  }

  // ⑤ 清单行：目录件（辅助列）× 落位事件（权威时序）按 join 键（组名+文件名）合并
  const rowKeyOf = (deptDir: string, name: string): string => `${deptDir}/${name}`
  const rows = new Map<string, ReportItemRow>()
  if (files !== undefined) {
    for (const file of files) {
      const name = file.relPath.replaceAll('\\', '/').split('/').pop() ?? file.relPath
      const deptDir = groupKeyOf(file.relPath)
      rows.set(rowKeyOf(deptDir, name), {
        deptDir,
        name,
        path: file.relPath,
        ledgerTs: null,
        ticket: null,
        jobId: null,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        missing: false,
        unanchored: true,
      })
    }
  }
  for (const landing of landings) {
    const name = landing.target.replaceAll('\\', '/').split('/').pop() ?? landing.target
    const deptDir = groupKeyOf(landing.target)
    const key = rowKeyOf(deptDir, name)
    const existing = rows.get(key)
    if (existing !== undefined) {
      existing.ledgerTs = landing.ts
      existing.ticket = landing.ticket
      existing.jobId = landing.jobId
      existing.unanchored = false
      continue
    }
    rows.set(key, {
      deptDir,
      name,
      path: landing.target,
      ledgerTs: landing.ts,
      ticket: landing.ticket,
      jobId: landing.jobId,
      sizeBytes: null,
      mtimeMs: null,
      // 目录读面未挂=不知在不在（不判缺失）；挂了而没有=归档缺失（绝不静默跳过）
      missing: dirAvailable,
      unanchored: false,
    })
  }

  // ⑥ 分组：受辖岗声明落点 ∪ 目录件组 ∪ 落位事件组（无件岗也成组——neverLanded 如实）
  const groups = new Map<string, DeptReportGroup>()
  const ensureGroup = (dept: string, deptPath: string | null): DeptReportGroup => {
    let group = groups.get(dept)
    if (group === undefined) {
      group = { dept, deptPath, light: 'none', lightText: REPORT_LIGHT_TEXT.none, jobs: [], items: [], newest: null }
      groups.set(dept, group)
    }
    if (group.deptPath === null && deptPath !== null) group.deptPath = deptPath
    return group
  }
  for (const job of reportJobs) {
    const group = ensureGroup(jobGroupOf(job), job.dept)
    group.jobs.push(jobLights.get(job.job_id) as ReportJobLight)
  }
  for (const row of rows.values()) {
    ensureGroup(row.deptDir, null).items.push(row)
  }
  for (const group of groups.values()) {
    group.jobs.sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0))
    group.items.sort((a, b) => {
      const ta = a.ledgerTs ?? a.mtimeMs ?? 0
      const tb = b.ledgerTs ?? b.mtimeMs ?? 0
      if (tb !== ta) return tb - ta
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    group.newest = group.items[0] ?? null
    // 组灯=组内受辖岗最差（无岗组=none——公司级/其他落点只列件不计灯，如实）
    group.light = group.jobs.reduce<ReportLight>(
      (worst, job) => (LIGHT_SEVERITY[job.light] > LIGHT_SEVERITY[worst] ? job.light : worst),
      'none',
    )
    group.lightText = group.jobs.length === 0 ? '本组无受辖岗（公司级/其他落点——只列件不计灯）' : REPORT_LIGHT_TEXT[group.light]
  }

  const reserved = (g: DeptReportGroup): number => (g.dept === COMPANY_GROUP || g.dept === OTHER_GROUP ? 1 : 0)
  const ordered = [...groups.values()].sort((a, b) => {
    if (reserved(a) !== reserved(b)) return reserved(a) - reserved(b)
    return a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0
  })
  const companyLight = ordered.reduce<ReportLight>(
    (worst, group) => (group.jobs.length > 0 && LIGHT_SEVERITY[group.light] > LIGHT_SEVERITY[worst] ? group.light : worst),
    'none',
  )

  return {
    ledgerAvailable,
    dirAvailable,
    companyLight,
    departments: ordered,
    bodyNote: REPORTS_BODY_NOTE,
    v2Note: REPORTS_V2_NOTE,
  }
}
