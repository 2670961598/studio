/**
 * 报表聚合管线·月报最小闭环测试（company reports.ts——docs/04-§三 核心契约 / docs/50 断链6）：
 * ① 月窗（UTC 月初/月末毫秒闭区间；非法月键拒）② 人员月度指标（工时=done 工时 Σ(ended−started)、
 * 在途不计；成本=LLM 事件 Σcost_usd 按 actor 工号前缀归属；交付= CLOSE 事件按该单最近
 * work_record 归属，无工作记录入 (unattributed) 诚实桶）③ 部门/公司逐级聚合（不跳级：
 * 公司面只读部门面输出）④ 快照 JSON（caliber=monthly/v1；数字全来自台账——零自评指标）
 * ⑤ md 渲染（04-§三 文件名 <YYYY-MM-DD>-monthly-<节点>-<一句话>.md + front-matter
 * {time,type,node,level,author}）⑥ 材料化（writeRelFile 注入、内容寻址 id 幂等、reports 行
 * 形状对齐 store ReportRecord）。
 * 口径均为拟稿待批（04-§三只冻结「逐级聚合/零自评/文件名约定」，指标定义归本刀拟稿，
 * 见 src/reports.ts 头注）；测试钉的是口径的稳定性而非正确性权威。
 */
import { describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import type { PersonRecord, WorkRecord } from '@studio-next/store'
import {
  MONTHLY_CALIBER,
  buildMonthlySnapshot,
  materializeMonthlyReport,
  monthWindow,
  monthlyAnchorDate,
  monthlyReportPaths,
  personMonthlyMetrics,
  rollupCompanyMonthly,
  rollupDeptMonthly,
  renderMonthlyReportMarkdown,
} from '../src/reports.ts'

/** 2026-10 月窗（UTC）：月初 00:00:00.000 — 月末 23:59:59.999 */
const OCT = { since: Date.UTC(2026, 9, 1), until: Date.UTC(2026, 10, 1) - 1 }
const T = (day: number, hour = 0): number => Date.UTC(2026, 9, day, hour)
const H = 3_600_000

function person(patch: Partial<PersonRecord>): PersonRecord {
  return { person_id: '', name: '', login: '', level: 1, dept: '', ...patch }
}

function work(patch: Partial<WorkRecord> & { person_id: string; issue: string }): WorkRecord {
  return { id: `w-${patch.issue}`, instance_id: null, executor: 'dsh', session_id: null, lane: null, branch: null, started_at: T(5), ended_at: null, cost_usd: undefined, tokens: undefined, attempt: 1, status: 'done', report_ref: null, summary_ref: null, ...patch }
}

function evt(patch: Partial<EventRecord> & { ts: number; event: string; actor: string; issue: string }): EventRecord {
  return { id: `e-${patch.ts}-${patch.event}`, company: 'studio-dev', attempt: 1, level: 2, dept: 'departments/研发部', tokens: { input: 1 }, ...patch } as EventRecord
}

const PEOPLE: PersonRecord[] = [
  person({ person_id: 'AGENT-1', name: '张一', login: 'agent-1', level: 2, dept: 'departments/研发部' }),
  person({ person_id: 'AGENT-2', name: '李二', login: 'agent-2', level: 2, dept: 'departments/研发部' }),
  person({ person_id: 'AGENT-3', name: '王三', login: 'agent-3', level: 3, dept: 'departments/市场部' }),
]

const WORK: WorkRecord[] = [
  work({ person_id: 'AGENT-1', issue: 'DEV-1', started_at: T(5), ended_at: T(5) + 7.5 * H, cost_usd: 0.5 }),
  work({ person_id: 'AGENT-2', issue: 'DEV-2', started_at: T(10), ended_at: T(10) + 4 * H, cost_usd: 0.25 }),
  work({ person_id: 'AGENT-1', issue: 'DEV-3', started_at: T(20), ended_at: T(20) + 2 * H, status: 'failed' }),
  work({ person_id: 'AGENT-1', issue: 'DEV-4', started_at: T(28), ended_at: null }),
  work({ person_id: 'AGENT-2', issue: 'DEV-5', started_at: Date.UTC(2026, 8, 28), ended_at: Date.UTC(2026, 10, 1) }),
  work({ person_id: 'AGENT-3', issue: 'DEV-6', started_at: Date.UTC(2026, 8, 10), ended_at: Date.UTC(2026, 8, 20) + 3 * H, cost_usd: 0.1 }),
]

const EVENTS: EventRecord[] = [
  evt({ ts: T(6), event: 'LLM', actor: 'AGENT-1:agent-1', issue: 'DEV-1', cost_usd: 1.0 }),
  evt({ ts: T(11), event: 'LLM', actor: 'AGENT-2:agent-2', issue: 'DEV-2', cost_usd: 0.25 }),
  evt({ ts: T(12), event: 'LLM', actor: 'AGENT-9:agent-9', issue: 'DEV-9', cost_usd: 0.5 }),
  evt({ ts: Date.UTC(2026, 10, 1), event: 'LLM', actor: 'AGENT-1:agent-1', issue: 'DEV-1', cost_usd: 99 }),
  evt({ ts: T(7), event: 'CLOSE', actor: 'daemon', issue: 'DEV-1' }),
  evt({ ts: T(12), event: 'CLOSE', actor: 'daemon', issue: 'DEV-2' }),
  evt({ ts: T(15), event: 'CLOSE', actor: 'daemon', issue: 'DEV-9' }),
  evt({ ts: Date.UTC(2026, 10, 5), event: 'CLOSE', actor: 'daemon', issue: 'DEV-3' }),
  evt({ ts: T(8), event: 'DISPATCH', actor: 'daemon', issue: 'DEV-7' }),
]

const BASIS = { month: '2026-10', events: EVENTS, workRecords: WORK, people: PEOPLE }

describe('monthWindow（UTC 月窗，闭区间）', () => {
  it('月初 00:00:00.000 — 次月初减 1 毫秒；闰年二月/十二月跨年正确', () => {
    expect(monthWindow('2026-10')).toEqual(OCT)
    expect(monthWindow('2026-12')).toEqual({ since: Date.UTC(2026, 11, 1), until: Date.UTC(2027, 0, 1) - 1 })
    expect(monthWindow('2028-02')).toEqual({ since: Date.UTC(2028, 1, 1), until: Date.UTC(2028, 2, 1) - 1 })
    expect(monthWindow('2026-02')).toEqual({ since: Date.UTC(2026, 1, 1), until: Date.UTC(2026, 2, 1) - 1 })
  })

  it('双端闭区间：since/until 恰在界上的记录计入；非法月键 CONFIG_INVALID', () => {
    expect(monthWindow('2026-01').since).toBe(Date.UTC(2026, 0, 1))
    // 形如 2026-13 / 2026-1x / 空 → 拒
    for (const bad of ['2026-13', '2026-00', '2026-1', '2026', 'abcd', '2026-10-05', '']) {
      let caught: unknown
      try {
        monthWindow(bad)
      } catch (err) {
        caught = err
      }
      expect(caught, `monthKey=${bad}`).toBeInstanceOf(Error)
      expect((caught as { category?: string }).category).toBe('CONFIG_INVALID')
    }
  })
})

describe('personMonthlyMetrics（人员月度指标——台账聚合，零自评）', () => {
  it('工时/成本/交付三指标按拟稿口径归到人；在途与窗外不计；失败尝试计工时', () => {
    const rows = personMonthlyMetrics(BASIS)
    const byId = new Map(rows.map((r) => [r.person_id, r]))
    expect(byId.get('AGENT-1')).toEqual({
      person_id: 'AGENT-1', name: '张一', dept: 'departments/研发部',
      hours_ms: 9.5 * H, cost_usd: 1.0, work_cost_usd: 0.5, delivered: 1, llm_events: 1,
    })
    expect(byId.get('AGENT-2')).toMatchObject({ hours_ms: 4 * H, cost_usd: 0.25, work_cost_usd: 0.25, delivered: 1 })
    // AGENT-3：工时 ended 在九月（窗外）→ 全零行不产出（当月无活动的人不上月报）
    expect(byId.get('AGENT-3')).toBeUndefined()
    // AGENT-9：无镜像 → dept '(unknown)' 诚实桶（不臆造部门）
    expect(byId.get('AGENT-9')).toMatchObject({ dept: '(unknown)', cost_usd: 0.5, hours_ms: 0 })
    // CLOSE 无工作记录的单 → (unattributed) 诚实桶
    expect(byId.get('(unattributed)')).toMatchObject({ dept: '(unknown)', delivered: 1 })
  })

  it('交付归属=该单最近一条 work_record 的人（跨月工作记录也参与归属判定）', () => {
    const rows = personMonthlyMetrics({ ...BASIS, workRecords: [...WORK.filter((w) => w.issue !== 'DEV-1'), work({ person_id: 'AGENT-2', issue: 'DEV-1', started_at: T(6), ended_at: T(6) + H })] })
    expect(rows.find((r) => r.person_id === 'AGENT-2')?.delivered).toBe(2)
    expect(rows.find((r) => r.person_id === 'AGENT-1')?.delivered).toBe(0)
  })

  it('行按 person_id 升序稳定排序', () => {
    const ids = personMonthlyMetrics(BASIS).map((r) => r.person_id)
    expect(ids).toEqual([...ids].sort())
  })
})

describe('rollupDeptMonthly / rollupCompanyMonthly（逐级聚合，不跳级）', () => {
  it('部门面=人员面按 dept 归并；(unknown) 桶如实保留；行按 node 升序', () => {
    const depts = rollupDeptMonthly(personMonthlyMetrics(BASIS))
    expect(depts).toEqual([
      { node: '(unknown)', people: 2, hours_ms: 0, cost_usd: 0.5, work_cost_usd: 0, delivered: 1, llm_events: 1 },
      { node: 'departments/研发部', people: 2, hours_ms: 13.5 * H, cost_usd: 1.25, work_cost_usd: 0.75, delivered: 2, llm_events: 2 },
    ])
  })

  it('公司面只读部门面输出（数字=Σ部门，不回人员面重算）；people=Σ部门人数', () => {
    const depts = rollupDeptMonthly(personMonthlyMetrics(BASIS))
    const co = rollupCompanyMonthly('studio-dev', depts)
    expect(co).toEqual({
      node: 'studio-dev', people: 4, depts: 2,
      hours_ms: 13.5 * H, cost_usd: 1.75, work_cost_usd: 0.75, delivered: 3, llm_events: 3,
    })
    // 结构性不跳级：公司面来自部门面的派生（同输入重算一致）
    expect(rollupCompanyMonthly('x', rollupDeptMonthly(personMonthlyMetrics(BASIS)))).toEqual({ ...co, node: 'x' })
  })
})

describe('buildMonthlySnapshot / 路径 / md 渲染（04-§三 契约面）', () => {
  const snapshot = buildMonthlySnapshot({ company: 'studio-dev', generatedAt: Date.UTC(2026, 10, 1, 8), ...BASIS })

  it('快照 JSON 形状：schema/caliber/company/month/generated_at/basis + 三级数字同源', () => {
    expect(snapshot.schema).toBe('monthly-report/v1')
    expect(snapshot.caliber).toBe(MONTHLY_CALIBER)
    expect(snapshot.caliber).toBe('monthly/v1')
    expect(snapshot.company).toBe('studio-dev')
    expect(snapshot.month).toBe('2026-10')
    expect(snapshot.generated_at).toBe(Date.UTC(2026, 10, 1, 8))
    expect(snapshot.basis).toBe('events+work_records+people')
    expect(snapshot.metrics).toEqual(rollupCompanyMonthly('studio-dev', rollupDeptMonthly(personMonthlyMetrics(BASIS))))
    expect(snapshot.departments.length).toBe(2)
    expect(snapshot.persons.length).toBe(4)
    // 快照可整体 JSON 往返（落文件面的形状保证）
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('monthlyAnchorDate=当月末日 UTC；monthlyReportPaths 按 04-§三 文件名约定', () => {
    expect(monthlyAnchorDate('2026-10')).toBe('2026-10-31')
    expect(monthlyAnchorDate('2028-02')).toBe('2028-02-29')
    const paths = monthlyReportPaths({ company: 'studio-dev', month: '2026-10', summary: '十月经营月报' })
    expect(paths.mdPath).toBe('reports/2026-10-31-monthly-studio-dev-十月经营月报.md')
    expect(paths.jsonPath).toBe('reports/2026-10-31-monthly-studio-dev-十月经营月报.json')
    // 一句话总结做文件名安全化：路径分隔符/空白折叠为连字符
    const weird = monthlyReportPaths({ company: 'studio-dev', month: '2026-10', summary: '上线/支付 a  b：重构' })
    expect(weird.mdPath).not.toMatch(/[/\\]上线/)
    expect(weird.mdPath).toMatch(/^reports\/2026-10-31-monthly-studio-dev-[^/\\]+\.md$/)
  })

  it('md 渲染：front-matter {time,type,node,level,author} + 公司/部门/人员三级表 + 零自评声明', () => {
    const md = renderMonthlyReportMarkdown(snapshot, { level: 3, author: 'daemon' })
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain(`time: ${new Date(Date.UTC(2026, 10, 1, 8)).toISOString()}`)
    expect(md).toContain('type: monthly')
    expect(md).toContain('node: studio-dev')
    expect(md).toContain('level: 3')
    expect(md).toContain('author: daemon')
    expect(md).toContain('# studio-dev 经营月报（2026-10）')
    // 数字面：工时 13.50h / 成本 1.75 / 交付 3（表格里出现；来自快照非自评）
    expect(md).toContain('13.50')
    expect(md).toContain('1.75')
    expect(md).toContain('departments/研发部')
    expect(md).toContain('零自评')
  })
})

describe('materializeMonthlyReport（月报材料化：写文件 + reports 行）', () => {
  it('writeRelFile 收到 md+json 两文件；json 可解析且与快照一致；report 行对齐 store ReportRecord', () => {
    const written = new Map<string, string>()
    const out = materializeMonthlyReport({
      company: 'studio-dev', month: '2026-10', summary: '十月经营月报', level: 3, author: 'daemon',
      now: Date.UTC(2026, 10, 1, 8), ...BASIS,
      writeRelFile: (rel, content) => void written.set(rel, content),
    })
    expect(out.mdPath).toBe('reports/2026-10-31-monthly-studio-dev-十月经营月报.md')
    expect(out.jsonPath).toBe('reports/2026-10-31-monthly-studio-dev-十月经营月报.json')
    expect(written.get(out.jsonPath)).toBeDefined()
    expect(JSON.parse(written.get(out.jsonPath) as string)).toEqual(out.snapshot)
    expect(written.get(out.mdPath)).toContain('type: monthly')
    expect(out.report).toEqual({
      id: out.report.id, company: 'studio-dev', node: 'studio-dev', type: 'monthly',
      date: '2026-10-31', caliber: 'monthly/v1', json_ref: out.jsonPath,
    })
    expect(out.report.id).toMatch(/^monthly-[0-9a-f]{8,}$/)
  })

  it('内容寻址 id：同输入重算 → 同 id 同快照字节（幂等重放安全）；数据变 → id 变（换代）', () => {
    const mk = (events: EventRecord[] = EVENTS): { id: string; json: string } => {
      const written = new Map<string, string>()
      const out = materializeMonthlyReport({
        company: 'studio-dev', month: '2026-10', summary: '十月经营月报', level: 3, author: 'daemon',
        now: Date.UTC(2026, 10, 1, 8), events, workRecords: WORK, people: PEOPLE,
        writeRelFile: (rel, c) => void written.set(rel, c),
      })
      return { id: out.report.id, json: written.get(out.jsonPath) as string }
    }
    const a = mk()
    const b = mk()
    expect(b.id).toBe(a.id)
    expect(b.json).toBe(a.json)
    // 换数据（追加一条 LLM 成本）→ 快照字节变 → 内容寻址 id 变（自然键覆盖换代的库侧路径）
    const c = mk([...EVENTS, evt({ ts: T(20), event: 'LLM', actor: 'AGENT-1:agent-1', issue: 'DEV-1', cost_usd: 2 })])
    expect(c.id).not.toBe(a.id)
    expect(c.json).not.toBe(a.json)
  })
})
