/**
 * :8789 报表 tab v1 测试（127-B，studio-dev-176；规格=studio-dev-127 plan §4.6）。
 *
 * 覆盖面（Spike-2 判负线逐条钉死）：
 *   - 渲染层零写：投影纯函数零 IO 零时钟（jobs×events×files 全注入）；路由全 GET 只读；
 *   - 灯与台账事件一致：stale 最新→红；落后再有落位→绿（恢复）；LATE_FIRST_RUN→红（从未跑）；
 *     P3 对账欠账最新→黄；无信号→灰（无台账=全灰降级，不臆造绿灯）；
 *   - 缺失件绝不静默跳过：台账有落位、目录无件 → 行在且 missing=true；受辖岗从未落位 →
 *     组在且 neverLanded 如实标注；目录件无台账锚 → unanchored=true；
 *   - 两部门目录＋跨日多件：部门分组、最新件优先排序、公司级汇总（各部门最新件+灯）；
 *   - patrol 型岗（output 已声明）不入受辖集（127-D 判据）；无 output 岗不入；
 *   - 目录读面未挂：清单退事件件且不判 missing（读面缺位≠归档缺失）；无台账：灯全 none；
 *   - 正文不渲染：payload 带 REPORTS_BODY_NOTE；v2 登记位注记在。
 * 语料：corp-r 合成快照（研发部/综合部两部门岗）+ 真台账（openLedger tmp 库，事件全过
 * 契约闸）+ 合成目录元数据（两部门跨日多件+公司级根件）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, ScheduledJob } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  COMPANY_GROUP,
  REPORTS_BODY_NOTE,
  REPORTS_V2_NOTE,
  buildReportsSnapshot,
  createOverviewApp,
  type OverviewApp,
  type ReportFileMeta,
} from '../src/overview/index.ts'
import { T0, makeEvent } from './corpus.ts'

const DAY_MS = 86_400_000

// ————————————————————————— 合成公司 corp-r（研发部＋综合部两部门，报表岗三＋对照岗二） —————————————————————————

function makeJob(patch: Partial<ScheduledJob> & Record<string, unknown> = {}): ScheduledJob {
  return {
    job_id: `job-${String(makeSeq.next().value)}`,
    company: 'corp-r',
    dept: 'departments/研发部',
    cron: '0 9 * * *',
    role: 'main_worker',
    level: 2,
    model_tier: 'mid',
    ...patch,
  } as ScheduledJob
}
function* makeSeqGen(): Generator<number> {
  let n = 0
  while (true) yield ++n
}
const makeSeq = makeSeqGen()

const JOB_RD = 'daily-report-rd' // 研发部报表岗：落位两件（day1 在目录、day2 缺失）+ 对账欠账最新 → debt
const JOB_ZH = 'daily-report-zh' // 综合部报表岗：day1 落位 → stale 越窗 → day2 再落位（恢复）→ fresh
const JOB_NEVER = 'never-report-zh' // 综合部报表岗：从未落位 + LATE_FIRST_RUN → stale + neverLanded

const CORP_R_SNAPSHOT: CompanySnapshot = {
  slug: 'corp-r',
  name: '合成公司丙',
  level: 3,
  charter: 'charter.md',
  platform: { platform: 'youtrack' },
  departments: [
    { name: '研发部', path: 'departments/研发部', parent: null, leader: 'PR-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
    { name: '综合部', path: 'departments/综合部', parent: null, leader: 'PZ-1', level: 2, lanes: ['core'], functions: ['统筹'], relations: [] },
  ],
  people: [
    { id: 'PR-1', name: '丙一号', login: 'pr-1', level: 2, dept: 'departments/研发部' },
    { id: 'PZ-1', name: '丙二号', login: 'pz-1', level: 2, dept: 'departments/综合部' },
  ],
  jobs: [
    makeJob({ job_id: JOB_RD, dept: 'departments/研发部', payload: { type: 'report', output: 'reports/研发部/' } }),
    makeJob({ job_id: JOB_ZH, dept: 'departments/综合部', payload: { type: 'report', output: 'reports/综合部/' } }),
    makeJob({ job_id: JOB_NEVER, dept: 'departments/综合部', payload: { type: 'report', output: 'reports/综合部/' } }),
    // patrol 型（output 已声明）——127-D 无产出义务，不入受辖集（harvest-recon 同判据）
    makeJob({ job_id: 'health-patrol-rd', dept: 'departments/研发部', payload: { type: 'patrol', output: 'reports/研发部/' } }),
    // 无 output 岗——非报表受辖
    makeJob({ job_id: 'int-sync-rd', dept: 'departments/研发部', payload: { type: 'report' } }),
  ],
}

// ————————————————————————— 目录元数据（wiring 侧 scanReportFiles 的注入形；两部门跨日多件＋公司级根件） —————————————————————————

const DIR = '/tmp/corp-r' // 合成公司目录根（事件 output 目标绝对路径的公共前缀，任意值——join 键=尾段）
const FILES: ReportFileMeta[] = [
  { relPath: 'reports/研发部/2026-10-20-report-研发部-CB-100.md', sizeBytes: 1200, mtimeMs: T0 + 1_000 }, // 与 day1 落位事件 join 上
  { relPath: 'reports/研发部/2026-10-19-report-研发部-LEGACY-1.md', sizeBytes: 900, mtimeMs: T0 + 400 }, // 无台账锚（历史存量；mtime 取 T0+400——居组内末位，不与 day1 落位 ts 撞平手
  { relPath: 'reports/综合部/2026-10-20-report-综合部-CB-200.md', sizeBytes: 800, mtimeMs: T0 + 1_100 },
  { relPath: 'reports/综合部/2026-10-22-report-综合部-CB-200.md', sizeBytes: 850, mtimeMs: T0 + 1_200 },
  { relPath: 'reports/2026-09-monthly-corp-r.json', sizeBytes: 640, mtimeMs: T0 + 300 }, // 公司级根件（月报快照对——无岗组）
]
// day2 研发部落位目标（CB-100 第二件）：台账有、目录无 → 归档缺失（判负线：不许静默跳过）
const MISSING_TARGET = `${DIR}/reports/研发部/2026-10-21-report-研发部-CB-100.md`

let root = ''
let ledger: Ledger
let events: Array<Record<string, unknown>> = []

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-reports-'))
  ledger = openLedger(path.join(root, 'reports.db'))
  ledger.syncCompany(CORP_R_SNAPSHOT)
  // ts 序列：跨日多件（day1 < day2 < day3）＋恢复与欠账信号在后
  const day1 = T0
  const day2 = T0 + DAY_MS
  const day3 = T0 + 2 * DAY_MS
  const rows = [
    // 岗锚（PATROL note job=——issue→job join，与 harvest-recon 同形）
    makeEvent({ event: 'PATROL', company: 'corp-r', issue: 'CB-100', dept: 'departments/研发部', ts: day1 + 100, note: 'intent=scheduler|schedule|corp-r|daily-report-rd@2026-10-20;job=daily-report-rd;cron=0 9 * * *' }),
    makeEvent({ event: 'PATROL', company: 'corp-r', issue: 'CB-200', dept: 'departments/综合部', ts: day1 + 200, note: 'intent=scheduler|schedule|corp-r|daily-report-zh@2026-10-20;job=daily-report-zh;cron=0 9 * * *' }),
    makeEvent({ event: 'PATROL', company: 'corp-r', issue: 'CB-300', dept: 'departments/综合部', ts: day1 + 300, note: 'intent=scheduler|schedule|corp-r|never-report-zh@2026-10-20;job=never-report-zh;cron=0 9 * * *' }),
    // day1 落位（GATE_PASS note ;output=——output-account 收账步）
    makeEvent({ event: 'GATE_PASS', company: 'corp-r', issue: 'CB-100', dept: 'departments/研发部', ts: day1 + 500, note: `闸门过（4/4 要件）;output=${DIR}/reports/研发部/2026-10-20-report-研发部-CB-100.md` }),
    makeEvent({ event: 'GATE_PASS', company: 'corp-r', issue: 'CB-200', dept: 'departments/综合部', ts: day1 + 600, note: `闸门过（4/4 要件）;output=${DIR}/reports/综合部/2026-10-20-report-综合部-CB-200.md` }),
    // day2：研发部再落位（目标件目录缺——归档缺失）；综合部停跑（JOB_STALE 四元组分诊）
    makeEvent({ event: 'GATE_PASS', company: 'corp-r', issue: 'CB-100', dept: 'departments/研发部', ts: day2 + 500, note: `闸门过（4/4 要件）;output=${MISSING_TARGET}` }),
    makeEvent({ event: 'JOB_STALE', company: 'corp-r', issue: 'HB-1', dept: 'departments/综合部', ts: day2 + 700, note: '停跑（now>next_run_at+grace）；src=freshness-timer;job=daily-report-zh;slot=1770000000000;grace=900000;hb_age=900000;job_status=active;patrol_age=900000;last_success_age=900000;last_run_at=0' }),
    // day2 末：综合部恢复落位（最新信号胜——stale 之后又有落位 → fresh）
    makeEvent({ event: 'GATE_PASS', company: 'corp-r', issue: 'CB-200', dept: 'departments/综合部', ts: day2 + 900, note: `闸门过（4/4 要件）;output=${DIR}/reports/综合部/2026-10-22-report-综合部-CB-200.md` }),
    // day3：never-report-zh 从未跑（LATE_FIRST_RUN）；研发部落位后现哨兵欠账（SENTINEL_MISSING 最新 → debt）
    makeEvent({ event: 'LATE_FIRST_RUN', company: 'corp-r', issue: 'HB-2', dept: 'departments/综合部', ts: day3 + 100, note: '从未跑过（配置坏≠跑了没产出）；src=freshness-timer;job=never-report-zh;slot=1770000000000;grace=900000;hb_age=0;job_status=active;patrol_age=0;last_success_age=0;last_run_at=0' }),
    makeEvent({ event: 'SENTINEL_MISSING', company: 'corp-r', issue: 'CB-100', dept: 'departments/研发部', ts: day3 + 200, note: 'src=recon;kind=sentinel;job=daily-report-rd' }),
  ]
  for (const row of rows) ledger.appendEvent(row)
  events = ledger.queryEvents({ company: 'corp-r' })
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 纯投影直测（buildReportsSnapshot——零 IO 零时钟） —————————————————————————

describe('buildReportsSnapshot（纯投影：清单＋灯＋汇总）', () => {
  // 惰性构建：events 在 beforeAll 落账后才可用（describe 体先于 beforeAll 执行——vitest 语义）
  const buildSnap = () => buildReportsSnapshot({ jobs: CORP_R_SNAPSHOT.jobs, events, ledgerAvailable: true, files: FILES })
  const groupOf = (dept: string) => buildSnap().departments.find((g) => g.dept === dept)
  const jobOf = (groupDept: string, jobId: string) => groupOf(groupDept)?.jobs.find((j) => j.jobId === jobId)

  it('部门分组：两部门＋公司级保留组；组序=码点升序、保留组排后', () => {
    expect(buildSnap().departments.map((g) => g.dept)).toEqual(['研发部', '综合部', COMPANY_GROUP])
    expect(buildSnap().ledgerAvailable).toBe(true)
    expect(buildSnap().dirAvailable).toBe(true)
  })

  it('受辖集口径：output 已声明且非 patrol 型（health-patrol-rd/int-sync-rd 不入灯面）', () => {
    const allJobIds = buildSnap().departments.flatMap((g) => g.jobs.map((j) => j.jobId))
    expect(allJobIds).toEqual([JOB_RD, JOB_ZH, JOB_NEVER]) // jobId 升序（daily-report-rd < daily-report-zh < never-report-zh）
    expect(groupOf('研发部')?.deptPath).toBe('departments/研发部')
    expect(groupOf(COMPANY_GROUP)?.deptPath).toBe(null) // 公司级组无部门 path
  })

  it('灯与台账事件一致（判负线）：恢复岗=绿、从未跑岗=红+neverLanded、欠账最新岗=黄', () => {
    expect(jobOf('综合部', JOB_ZH)?.light).toBe('fresh') // stale 之后又有落位——最新信号胜
    expect(jobOf('综合部', JOB_ZH)?.lastSignalText).toContain('CB-200')
    expect(jobOf('综合部', JOB_NEVER)?.light).toBe('stale') // LATE_FIRST_RUN 从未跑
    expect(jobOf('综合部', JOB_NEVER)?.neverLanded).toBe(true) // 从未落位如实标注（不静默）
    expect(jobOf('综合部', JOB_NEVER)?.lastSignalText).toContain('从未跑过')
    expect(jobOf('研发部', JOB_RD)?.light).toBe('debt') // 落位之后的 SENTINEL_MISSING 更新 → 黄
    expect(jobOf('研发部', JOB_RD)?.lastSignalText).toContain('SENTINEL_MISSING')
    expect(jobOf('研发部', JOB_RD)?.landings).toBe(2)
    // 组灯=组内最差：综合部（fresh+stale）=红；研发部=黄；公司级灯=红
    expect(groupOf('综合部')?.light).toBe('stale')
    expect(groupOf('研发部')?.light).toBe('debt')
    expect(groupOf(COMPANY_GROUP)?.light).toBe('none') // 无受辖岗组只列件不计灯
    expect(groupOf(COMPANY_GROUP)?.lightText).toContain('无受辖岗')
    expect(buildSnap().companyLight).toBe('stale')
  })

  it('清单行：目录件×落位事件 join（合并/无锚/缺失三态齐备——缺失件绝不静默跳过）', () => {
    const rd = groupOf('研发部')?.items ?? []
    // 三行：day2 落位件（目录缺）→ missing；day1 双在 → 合并行；LEGACY → unanchored
    expect(rd).toHaveLength(3)
    const missingRow = rd.find((r) => r.name === '2026-10-21-report-研发部-CB-100.md')
    expect(missingRow?.missing).toBe(true)
    expect(missingRow?.ledgerTs).not.toBeNull()
    expect(missingRow?.sizeBytes).toBeNull() // 目录无件——辅助列缺省
    const mergedRow = rd.find((r) => r.name === '2026-10-20-report-研发部-CB-100.md')
    expect(mergedRow?.missing).toBe(false)
    expect(mergedRow?.unanchored).toBe(false)
    expect(mergedRow?.ticket).toBe('CB-100')
    expect(mergedRow?.jobId).toBe(JOB_RD)
    expect(mergedRow?.sizeBytes).toBe(1200) // 辅助列（目录 stat）
    const legacyRow = rd.find((r) => r.name === '2026-10-19-report-研发部-LEGACY-1.md')
    expect(legacyRow?.unanchored).toBe(true)
    expect(legacyRow?.ledgerTs).toBeNull()
  })

  it('组内排序：最新件优先（ledgerTs 权威、无锚退 mtime）；newest=items[0]', () => {
    const rd = groupOf('研发部')?.items ?? []
    expect(rd.map((r) => r.name)).toEqual([
      '2026-10-21-report-研发部-CB-100.md', // ledgerTs=day2（权威——虽目录缺失仍按台账时序居首，如实标注）
      '2026-10-20-report-研发部-CB-100.md',
      '2026-10-19-report-研发部-LEGACY-1.md', // 无锚退 mtime=T0+500
    ])
    expect(groupOf('研发部')?.newest?.name).toBe('2026-10-21-report-研发部-CB-100.md')
    const zh = groupOf('综合部')?.items ?? []
    expect(zh.map((r) => r.name)).toEqual(['2026-10-22-report-综合部-CB-200.md', '2026-10-20-report-综合部-CB-200.md'])
    expect(groupOf(COMPANY_GROUP)?.items.map((r) => r.name)).toEqual(['2026-09-monthly-corp-r.json'])
  })

  it('注记：正文待批项（metadata-only）与 v2 登记位齐备', () => {
    const snap = buildSnap()
    expect(snap.bodyNote).toBe(REPORTS_BODY_NOTE)
    expect(REPORTS_BODY_NOTE).toContain('metadata-only')
    expect(snap.v2Note).toBe(REPORTS_V2_NOTE)
    expect(REPORTS_V2_NOTE).toContain('v2 登记位')
  })

  it('降级①目录读面未挂：清单退事件件且不判 missing（读面缺位≠归档缺失）', () => {
    const snap = buildReportsSnapshot({ jobs: CORP_R_SNAPSHOT.jobs, events, ledgerAvailable: true })
    expect(snap.dirAvailable).toBe(false)
    const rdRow = snap.departments.find((g) => g.dept === '研发部')?.items ?? []
    expect(rdRow).toHaveLength(2) // 只剩两件落位事件行（目录三件全不可见——如实缩面）
    expect(rdRow.every((r) => !r.missing)).toBe(true) // 不判缺失
    expect(rdRow.every((r) => r.sizeBytes === null)).toBe(true)
    const zhGroup = snap.departments.find((g) => g.dept === '综合部')
    expect(zhGroup?.jobs.map((j) => j.jobId).length).toBe(2) // 岗灯面不受读面影响
  })

  it('降级②无台账：灯全 none、清单只剩目录件（unanchored）——不臆造信号', () => {
    const snap = buildReportsSnapshot({ jobs: CORP_R_SNAPSHOT.jobs, events: [], ledgerAvailable: false, files: FILES })
    expect(snap.ledgerAvailable).toBe(false)
    expect(snap.companyLight).toBe('none')
    for (const g of snap.departments) for (const j of g.jobs) expect(j.light, `${g.dept}/${j.jobId}`).toBe('none')
    // 无锚件不计落位——neverLanded 全 true（受辖岗三）
    const allJobs = snap.departments.flatMap((g) => g.jobs)
    expect(allJobs).toHaveLength(3)
    expect(allJobs.every((j) => j.neverLanded)).toBe(true)
    const rdItems = snap.departments.find((g) => g.dept === '研发部')?.items ?? []
    expect(rdItems.map((r) => r.name).sort()).toEqual(['2026-10-19-report-研发部-LEGACY-1.md', '2026-10-20-report-研发部-CB-100.md'])
    expect(rdItems.every((r) => r.unanchored)).toBe(true)
  })
})

// ————————————————————————— JSON 读面＋换装壳（app.request 进程内驱动——零端口） —————————————————————————

let app: OverviewApp

beforeAll(() => {
  app = createOverviewApp({
    companies: [
      {
        slug: CORP_R_SNAPSHOT.slug,
        snapshotProvider: () => CORP_R_SNAPSHOT,
        openLedger: () => ledger,
        listReportFiles: () => FILES,
      },
      {
        slug: 'corp-bare', // 无台账＋无目录读面（wiring 最薄挂载——双降级面）
        snapshotProvider: () => ({ ...CORP_R_SNAPSHOT, slug: 'corp-bare', name: '裸挂公司' }),
      },
    ],
  })
})

describe('GET /api/overview/:slug/reports（JSON 读面）', () => {
  it('basis=ledger-events+directory-aux；投影与纯函数同源；asOf 可解析', async () => {
    const res = await app.request('/api/overview/corp-r/reports')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as {
      slug: string
      basis: string
      asOf: string
      reports: { ledgerAvailable: boolean; dirAvailable: boolean; companyLight: string; departments: Array<{ dept: string; items: Array<{ name: string; missing: boolean }> }> }
    }
    expect(body.slug).toBe('corp-r')
    expect(body.basis).toBe('ledger-events+directory-aux')
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false)
    expect(body.reports.companyLight).toBe('stale')
    const rd = body.reports.departments.find((g) => g.dept === '研发部')
    expect(rd?.items.find((r) => r.name === '2026-10-21-report-研发部-CB-100.md')?.missing).toBe(true)
  })

  it('未知 slug 404 JSON（与五读面同口径）', async () => {
    const res = await app.request('/api/overview/nope/reports')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unknown-slug')
  })

  it('裸挂公司（无台账无读面）：双降级旗标如实，不臆造', async () => {
    const res = await app.request('/api/overview/corp-bare/reports')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reports: { ledgerAvailable: boolean; dirAvailable: boolean; companyLight: string } }
    expect(body.reports.ledgerAvailable).toBe(false)
    expect(body.reports.dirAvailable).toBe(false)
    expect(body.reports.companyLight).toBe('none')
  })
})

describe('换装壳路由 /:slug/reports（路径即路由）', () => {
  it('tab 页同壳 200（入口模块在）；未知 slug 404；legacy 面无报表路由（回滚面不加新页）', async () => {
    const res = await app.request('/corp-r/reports')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<script type="module" src="/ui/overview/main.js">')
    expect((await app.request('/nope/reports')).status).toBe(404)
    expect((await app.request('/legacy/corp-r/reports')).status).toBe(404)
  })

  it('ReportsCard 模块经静态面可达（importmap 白名单内裸导入纪律另由 overview-ui.test.ts 扫）', async () => {
    const res = await app.request('/ui/overview/components/ReportsCard.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })
})
