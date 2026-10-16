/**
 * :8789 公司概览面端面测试（v0.7 首刀：读面）：app.request() 进程内驱动（零端口）。
 * 依据：docs/16-§四 v0.7（公司面：组织/人事/财务/进度）、docs/04-§七（slug 路由/404/根路径
 * 公司清单）、docs/17-§8（:8789 端面）。
 *
 * 语料：
 *   - example-corp：**模板目录直读**（templates/company-2-level → readDirectoryFiles →
 *     loadCompanyDirectory——init 产物的真实装载链；无 ledger → progress/finance 降级面）；
 *   - corp-b：合成快照（3 层嵌套部门 + 悬空父引用 + 3 人，其中 PB-2 无档案正文）+ tmp ledger
 *     （mirror/budgets/events 语料——有台账面）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, DeptNode } from '@studio-next/contract'
import { openLedger, type BudgetRecord, type Ledger, type TicketMirrorRecord } from '@studio-next/store'
import { createOverviewApp } from '../src/overview/index.ts'
import { buildFinanceSnapshot, buildOrgTree, buildProgressSnapshot, escapeHtml } from '../src/overview/index.ts'
import type { OverviewApp } from '../src/overview/index.ts'
import { T0, makeEvent } from './corpus.ts'

const DAY_MS = 86_400_000

// ————————————————————————— 语料一：模板公司（example-corp，无 ledger） —————————————————————————

let templateSnapshot: CompanySnapshot
/** 模板目录的文件映射（档案正文 provider 的数据源） */
let templateFiles: Record<string, string>
const templateDir = fileURLToPath(new URL('../../../templates/company-2-level', import.meta.url))

// ————————————————————————— 语料二：合成公司（corp-b，嵌套组织 + 台账） —————————————————————————

const CORP_B_SNAPSHOT: CompanySnapshot = {
  slug: 'corp-b',
  name: '合成公司乙',
  level: 3,
  charter: 'charter.md',
  platform: { platform: 'youtrack' },
  departments: [
    {
      name: '总裁办',
      path: 'departments/总裁办',
      parent: null,
      leader: 'PB-1',
      level: 3,
      lanes: ['core'],
      functions: ['统筹'],
      relations: [],
    },
    {
      name: '工程部',
      path: 'departments/工程部',
      parent: 'departments/总裁办',
      leader: 'PB-2',
      level: 2,
      lanes: ['core', 'cli'],
      functions: ['交付'],
      relations: [],
    },
    {
      name: '平台组',
      path: 'departments/工程部/平台组',
      parent: 'departments/工程部',
      leader: 'PB-3',
      level: 1,
      lanes: ['cli'],
      functions: ['平台'],
      relations: [],
    },
    {
      name: '悬挂部',
      path: 'departments/悬挂部',
      parent: 'departments/不存在', // 悬空父引用：树渲染不吞部门（提升为根 + warn）
      leader: 'PB-1',
      level: 2,
      lanes: [],
      functions: [],
      relations: [],
    },
  ],
  people: [
    { id: 'PB-1', name: '乙一号', login: 'pb-1', level: 3, dept: 'departments/总裁办' },
    { id: 'PB-2', name: '乙二号', login: 'pb-2', level: 2, dept: 'departments/工程部' },
    { id: 'PB-3', name: '乙三号', login: 'pb-3', level: 1, dept: 'departments/工程部/平台组' },
  ],
  jobs: [],
}

const CORP_B_PERSON_FILES = new Map<string, string>([
  ['PB-1', '---\nid: PB-1\n---\n\n## 一、定位\n\n总裁办负责人。\n'],
  // PB-2 故意无档案正文（people 页无链接 + 档案页如实缺失）
  ['PB-3', '---\nid: PB-3\n---\n\n## 一、定位\n\n平台组成员。<script>alert(1)</script>\n'],
])

let root = ''
let ledger: Ledger

function makeMirror(patch: Partial<TicketMirrorRecord> = {}): TicketMirrorRecord {
  const base: TicketMirrorRecord = {
    issue: 'CB-1',
    company: 'corp-b',
    created: T0,
    updated: T0,
    state: '开发中',
    type: 'Task',
    dept: 'departments/工程部',
    level: 2,
    dispatcher: 'PB-1',
  }
  return { ...base, ...patch }
}

function makeBudget(patch: Partial<BudgetRecord> = {}): BudgetRecord {
  return { id: 'budg-0', scope_kind: 'company', scope_id: 'corp-b', kind: 'reserve', estimated_usd: 1, ts: T0, ...patch }
}

/** 被测 app（beforeAll 内装配——模板快照装载完成后才能取 slug）：example-corp（模板直读、
 *  无 ledger）+ corp-b（合成快照、有 ledger） */
let app: OverviewApp

beforeAll(async () => {
  // 模板目录直读（真实装载链）
  templateFiles = await readDirectoryFiles(templateDir)
  const mounted = loadCompanyDirectory(templateFiles)
  if (!mounted.ok) throw new Error(`模板目录装载失败（测试前置）：${JSON.stringify(mounted.issues)}`)
  templateSnapshot = mounted.snapshot

  // tmp 台账语料（corp-b 有台账面）
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-overview-'))
  ledger = openLedger(path.join(root, 'overview.db'))
  ledger.syncCompany(CORP_B_SNAPSHOT)

  // mirror：corp-b 三单（开发中×2 + 已完成×1）+ 他公司一单（不计入）
  ledger.upsertTicketMirror(makeMirror({ issue: 'CB-1', state: '开发中' }))
  ledger.upsertTicketMirror(makeMirror({ issue: 'CB-2', state: '开发中' }))
  ledger.upsertTicketMirror(makeMirror({ issue: 'CB-3', state: '已完成' }))
  ledger.upsertTicketMirror(makeMirror({ issue: 'OTHER-1', company: 'other-co', state: '开发中' }))

  // budgets：本司三口径——company scope 6.5(2)+settle 1.25+refusal 0.75；issue scope CB-1 reserve 2；
  // person scope PB-2 settle 0.5；他公司/陌生 scope 全排除。⇒ reserve 8.5(3)/settle 1.75(2)/refusal 0.75(1)/净额 6.75
  ledger.appendBudget(makeBudget({ id: 'budg-1', estimated_usd: 5 }))
  ledger.appendBudget(makeBudget({ id: 'budg-2', estimated_usd: 1.5 }))
  ledger.appendBudget(makeBudget({ id: 'budg-3', kind: 'settle', actual_usd: 1.25 }))
  ledger.appendBudget(makeBudget({ id: 'budg-4', kind: 'refusal', estimated_usd: 0.75 }))
  ledger.appendBudget(makeBudget({ id: 'budg-5', scope_kind: 'issue', scope_id: 'CB-1', estimated_usd: 2 }))
  ledger.appendBudget(makeBudget({ id: 'budg-6', scope_kind: 'person', scope_id: 'PB-2', kind: 'settle', actual_usd: 0.5 }))
  ledger.appendBudget(makeBudget({ id: 'budg-x1', scope_id: 'other-co', estimated_usd: 99 }))
  ledger.appendBudget(makeBudget({ id: 'budg-x2', scope_kind: 'person', scope_id: 'STRANGER', estimated_usd: 50 }))
  ledger.appendBudget(makeBudget({ id: 'budg-x3', scope_kind: 'issue', scope_id: 'OTHER-1', estimated_usd: 10 }))

  // events：corp-b LLM 三条（当日 0.25+0.5、次日 1.25）+ 他公司 LLM（不计）+ corp-b 非 LLM 带 cost（不计）
  const dayBase = Math.floor(T0 / DAY_MS) * DAY_MS
  ledger.appendEvent(makeEvent({ event: 'LLM', company: 'corp-b', issue: 'CB-1', ts: dayBase + 1000, cost_usd: 0.25 }))
  ledger.appendEvent(makeEvent({ event: 'LLM', company: 'corp-b', issue: 'CB-2', ts: dayBase + 2000, cost_usd: 0.5 }))
  ledger.appendEvent(makeEvent({ event: 'LLM', company: 'corp-b', issue: 'CB-3', ts: dayBase + DAY_MS + 1000, cost_usd: 1.25 }))
  ledger.appendEvent(makeEvent({ event: 'LLM', company: 'demo', issue: 'DEMO-9', ts: dayBase + 3000, cost_usd: 5 }))
  ledger.appendEvent(makeEvent({ event: 'DISPATCH', company: 'corp-b', issue: 'CB-1', ts: dayBase + 4000, cost_usd: 9 }))

  // 被测 app 装配（模板快照已装载、台账语料已落）：example-corp 无 ledger + corp-b 有 ledger
  app = createOverviewApp({
    companies: [
      {
        slug: templateSnapshot.slug,
        snapshotProvider: () => templateSnapshot,
        mission: '用一条可验证的交付链，把需求变成有证据的产出',
        readPersonFile: (personId) => templateFiles[`departments/工程部/people/${personId}.md`],
      },
      {
        slug: CORP_B_SNAPSHOT.slug,
        snapshotProvider: () => CORP_B_SNAPSHOT,
        readPersonFile: (personId) => CORP_B_PERSON_FILES.get(personId),
        openLedger: () => ledger,
      },
    ],
  })
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const htmlOf = async (pathName: string): Promise<{ status: number; html: string }> => {
  const res = await app.request(pathName)
  return { status: res.status, html: await res.text() }
}

// ————————————————————————— GET /（公司清单） —————————————————————————

describe('GET /（根路径=公司清单，04-§七）', () => {
  it('列全部挂载公司：名称/slug/等级/部门数/人数/平台 + /<slug>/ 链接；text/html', async () => {
    const { status, html } = await htmlOf('/')
    expect(status).toBe(200)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('href="/example-corp/"')
    expect(html).toContain('href="/corp-b/"')
    expect(html).toContain('示例公司')
    expect(html).toContain('合成公司乙')
    expect(html).toContain('youtrack')
    expect(html).toContain('已挂载 2 家公司')
  })
})

// ————————————————————————— 概览卡 —————————————————————————

describe('GET /<slug>/（概览卡）', () => {
  it('模板公司：公司名/等级/使命/部门数/人数/平台绑定/章程（snapshot 全字段）', async () => {
    const { status, html } = await htmlOf('/example-corp/')
    expect(status).toBe(200)
    expect(html).toContain('示例公司')
    expect(html).toContain('L2')
    expect(html).toContain('用一条可验证的交付链，把需求变成有证据的产出')
    expect(html).toContain('<dd>1</dd>') // 部门数（人数也是 1——同值断言取一即可，下面单独断言人数）
    expect(html).toContain('youtrack')
    expect(html).toContain('charter.md')
  })

  it('合成公司：部门 4（含悬挂部）/人数 3；/corp-b（无尾斜杠）与 /corp-b/ 同页', async () => {
    const withSlash = await htmlOf('/corp-b/')
    const withoutSlash = await htmlOf('/corp-b')
    expect(withSlash.status).toBe(200)
    expect(withoutSlash.status).toBe(200)
    expect(withoutSlash.html).toBe(withSlash.html)
    expect(withSlash.html).toContain('L3')
    expect(withSlash.html).toContain('<dt>部门数</dt><dd>4</dd>')
    expect(withSlash.html).toContain('<dt>人数</dt><dd>3</dd>')
  })

  it('未注册 slug → 404（概览卡与子页同判，04-§七）', async () => {
    expect((await htmlOf('/nope/')).status).toBe(404)
    expect((await htmlOf('/nope')).status).toBe(404)
    expect((await htmlOf('/nope/org')).status).toBe(404)
    const page = await htmlOf('/nope/')
    expect(page.html).toContain('404')
  })

  it('未知子路径 → 404（app.notFound HTML 面）', async () => {
    expect((await htmlOf('/corp-b/whatever')).status).toBe(404)
  })
})

// ————————————————————————— 组织树 —————————————————————————

describe('GET /<slug>/org（组织树）', () => {
  it('嵌套正确：总裁办→工程部→平台组 按序嵌套；各部 leader/lanes/functions 渲染；悬挂部提升为根 + warn', async () => {
    const { status, html } = await htmlOf('/corp-b/org')
    expect(status).toBe(200)
    // 嵌套序（DOM 顺序 = 树先序）：总裁办 在 工程部 前、工程部 在 平台组 前
    const iRoot = html.indexOf('>总裁办')
    const iEng = html.indexOf('>工程部')
    const iPlat = html.indexOf('>平台组')
    expect(iRoot).toBeGreaterThanOrEqual(0)
    expect(iEng).toBeGreaterThan(iRoot)
    expect(iPlat).toBeGreaterThan(iEng)
    // 平台组的 li 嵌在工程部的子 ul 里（工程部 li 开始到悬挂部/根 ul 结束之间含平台组）
    expect(html.indexOf('<ul class="tree"><li>总裁办')).toBeGreaterThanOrEqual(0)
    // 主管与标签
    expect(html).toContain('主管 PB-2')
    expect(html).toContain('lane:cli')
    expect(html).toContain('fn:交付')
    // 悬挂部不消失：如实渲染 + warn 说明
    expect(html).toContain('悬挂部')
    expect(html).toContain('悬空父引用')
  })
})

describe('buildOrgTree（纯函数直测）', () => {
  it('parent 链挂对：根/子/孙三层 + 悬空父引用提升为根（promoted 标记）', () => {
    const tree = buildOrgTree(CORP_B_SNAPSHOT.departments)
    expect(tree.roots.map((n) => n.dept.path)).toEqual(['departments/总裁办', 'departments/悬挂部'])
    const eng = tree.roots[0]?.children[0]
    expect(eng?.dept.path).toBe('departments/工程部')
    expect(eng?.children.map((n) => n.dept.path)).toEqual(['departments/工程部/平台组'])
    expect(tree.promoted.map((d) => d.path)).toEqual(['departments/悬挂部'])
    expect(tree.cyclic).toEqual([])
  })

  it('parent 链成环（A↔B）不吞部门：提升为根 + cyclic 标记', () => {
    const a: DeptNode = { name: 'A', path: 'a', parent: 'b', leader: 'P1', level: 1, lanes: [], functions: [], relations: [] }
    const b: DeptNode = { name: 'B', path: 'b', parent: 'a', leader: 'P1', level: 1, lanes: [], functions: [], relations: [] }
    const tree = buildOrgTree([a, b])
    const paths = tree.roots.map((n) => n.dept.path).sort()
    expect(paths).toEqual(['a', 'b'])
    expect(tree.cyclic.map((d) => d.path).sort()).toEqual(['a', 'b'])
  })

  it('同层保持快照原序（输入确定 → 输出确定）', () => {
    const mk = (p: string): DeptNode => ({ name: p, path: p, parent: null, leader: 'P1', level: 1, lanes: [], functions: [], relations: [] })
    const tree = buildOrgTree([mk('c'), mk('a'), mk('b')])
    expect(tree.roots.map((n) => n.dept.path)).toEqual(['c', 'a', 'b'])
  })
})

// ————————————————————————— 人事 —————————————————————————

describe('GET /<slug>/people（人事列表）', () => {
  it('PersonRef 表全字段（工号/姓名/login/等级/部门）；有档案者给链接、无档案者如实标注', async () => {
    const { status, html } = await htmlOf('/corp-b/people')
    expect(status).toBe(200)
    for (const marker of ['PB-1', '乙一号', 'pb-1', 'PB-2', '乙二号', 'PB-3', '乙三号', 'departments/总裁办', 'departments/工程部/平台组']) {
      expect(html).toContain(marker)
    }
    expect(html).toContain('href="/corp-b/people/PB-1"')
    expect(html).toContain('href="/corp-b/people/PB-3"')
    expect(html).not.toContain('href="/corp-b/people/PB-2"')
    expect(html).toContain('（无档案正文）')
  })
})

describe('GET /<slug>/people/<工号>（档案正文）', () => {
  it('md 原文渲染为 pre 块（模板公司 AGENT-1：六节档案全文进 pre）', async () => {
    const res = await app.request('/example-corp/people/AGENT-1')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('<pre>---')
    expect(html).toContain('## 一、定位')
    expect(html).toContain('## 六、自述')
    expect(html).toContain('id: AGENT-1')
  })

  it('档案正文按不可信输入转义：PB-3 档案中的 <script> 实体化，无裸脚本标签', async () => {
    const { status, html } = await htmlOf('/corp-b/people/PB-3')
    expect(status).toBe(200)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('在册但正文缺失 → 200 + 如实缺失说明（不 404 不臆造）', async () => {
    const { status, html } = await htmlOf('/corp-b/people/PB-2')
    expect(status).toBe(200)
    expect(html).toContain('档案正文缺失')
  })

  it('未知工号 → 404', async () => {
    expect((await htmlOf('/corp-b/people/UNKNOWN-9')).status).toBe(404)
  })
})

// ————————————————————————— 进度（有台账 / 无台账降级） —————————————————————————

describe('GET /<slug>/progress（ticket_mirror 状态聚合）', () => {
  it('corp-b：按状态聚合计数（开发中 2/已完成 1、共 3 单）；他公司单不计', async () => {
    const { status, html } = await htmlOf('/corp-b/progress')
    expect(status).toBe(200)
    expect(html).toContain('共 3 单')
    expect(html.indexOf('>开发中</td>')).toBeGreaterThan(0)
    expect(html).toContain('<td>开发中</td><td>2</td>')
    expect(html).toContain('<td>已完成</td><td>1</td>')
    expect(html).toContain('ticket-mirror')
  })

  it('example-corp（无 ledger）：如实显示无台账数据', async () => {
    const { status, html } = await htmlOf('/example-corp/progress')
    expect(status).toBe(200)
    expect(html).toContain('无台账数据')
    expect(html).toContain('（无台账）')
  })
})

// ————————————————————————— 财务（有台账 / 无台账降级） —————————————————————————

describe('GET /<slug>/finance（三口径分列 + LLM 按日）', () => {
  it('corp-b：reserve 8.5(3 笔)/settle 1.75(2)/refusal 0.75(1)/净额 6.75；本司 scope 集外全排除；分列口径文案', async () => {
    const { status, html } = await htmlOf('/corp-b/finance')
    expect(status).toBe(200)
    expect(html).toContain('分列不相加')
    expect(html).toContain('<td>reserve（预留）</td><td>3</td><td>8.5</td>')
    expect(html).toContain('<td>settle（结算）</td><td>2</td><td>1.75</td>')
    expect(html).toContain('<td>refusal（拒绝）</td><td>1</td><td>0.75</td>')
    expect(html).toContain('<td>净额（reserve−settle）</td><td>—</td><td>6.75</td>')
  })

  it('corp-b：LLM 成本按 UTC 日两行（当日 0.75/2 条、次日 1.25/1 条）；他公司 LLM 与非 LLM 事件不计', async () => {
    const dayBase = Math.floor(T0 / DAY_MS) * DAY_MS
    const day1 = new Date(dayBase).toISOString().slice(0, 10)
    const day2 = new Date(dayBase + DAY_MS).toISOString().slice(0, 10)
    const { html } = await htmlOf('/corp-b/finance')
    expect(html).toContain(`<tr><td>${day1}</td><td>2</td><td>0.75</td></tr>`)
    expect(html).toContain(`<tr><td>${day2}</td><td>1</td><td>1.25</td></tr>`)
  })

  it('example-corp（无 ledger）：如实显示无台账数据', async () => {
    const { status, html } = await htmlOf('/example-corp/finance')
    expect(status).toBe(200)
    expect(html).toContain('无台账数据')
  })
})

// ————————————————————————— 构造闸与 per-request 闸 —————————————————————————

describe('构造闸（wiring 错接即拒启）', () => {
  it('重复 slug → CONFIG_INVALID/overview/duplicate-slug', () => {
    const company = { slug: 'dup', snapshotProvider: () => CORP_B_SNAPSHOT }
    expect(() => createOverviewApp({ companies: [company, company] })).toThrow(/duplicate-slug/)
  })

  it('空 companies → CONFIG_INVALID/overview/no-companies', () => {
    expect(() => createOverviewApp({ companies: [] })).toThrow(/no-companies/)
  })

  it('坏形状 slug（大写/斜杠/空段）→ CONFIG_INVALID/overview/bad-slug', () => {
    expect(() =>
      createOverviewApp({ companies: [{ slug: 'Corp-B', snapshotProvider: () => CORP_B_SNAPSHOT }] }),
    ).toThrow(/bad-slug/)
    expect(() =>
      createOverviewApp({ companies: [{ slug: 'corp/b', snapshotProvider: () => CORP_B_SNAPSHOT }] }),
    ).toThrow(/bad-slug/)
  })

  it('snapshot.slug 与注册 slug 错位 → 该请求 500 明报（wiring 错接不静默）', async () => {
    const mismatchApp = createOverviewApp({
      companies: [{ slug: 'corp-b', snapshotProvider: () => templateSnapshot }], // 注册 corp-b 但快照是 example-corp
    })
    const res = await mismatchApp.request('/corp-b/')
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('slug 错位')
  })
})

// ————————————————————————— views 纯函数直测 —————————————————————————

describe('buildProgressSnapshot（纯函数直测）', () => {
  it('按状态聚合计数降序、同数按状态名稳定序；只计本司', () => {
    const mirrors = [
      makeMirror({ issue: 'A', state: 's2' }),
      makeMirror({ issue: 'B', state: 's2' }),
      makeMirror({ issue: 'C', state: 's1' }),
      makeMirror({ issue: 'D', state: 'aa' }), // 同数 1：'aa' < 's1' 稳定序在前
      makeMirror({ issue: 'X', company: 'other', state: 's2' }), // 他公司不计
    ]
    const snap = buildProgressSnapshot(mirrors, 'corp-b')
    expect(snap.total).toBe(4)
    expect(snap.byState).toEqual([
      { state: 's2', count: 2 },
      { state: 'aa', count: 1 },
      { state: 's1', count: 1 },
    ])
    expect(snap.basis).toBe('ticket-mirror')
  })
})

describe('buildFinanceSnapshot（纯函数直测：与页面同源对账）', () => {
  it('三口径分列 + 净额=reserve−settle；scope 集外排除；LLM 按 UTC 日聚合升序', () => {
    const dayBase = Math.floor(T0 / DAY_MS) * DAY_MS
    const snap = buildFinanceSnapshot({
      slug: 'corp-b',
      budgets: [
        { id: 'b1', scope_kind: 'company', scope_id: 'corp-b', kind: 'reserve', estimated_usd: 5, ts: T0 },
        { id: 'b2', scope_kind: 'issue', scope_id: 'CB-1', kind: 'settle', actual_usd: 1.25, ts: T0 },
        { id: 'b3', scope_kind: 'person', scope_id: 'PB-1', kind: 'refusal', estimated_usd: 0.75, ts: T0 },
        { id: 'b4', scope_kind: 'company', scope_id: 'other', kind: 'reserve', estimated_usd: 99, ts: T0 },
      ],
      mirrors: [makeMirror({ issue: 'CB-1' }), makeMirror({ issue: 'OX', company: 'other' })],
      peopleIds: new Set(['PB-1']),
      events: [
        makeEvent({ event: 'LLM', company: 'corp-b', ts: dayBase + DAY_MS + 100, cost_usd: 1.25 }),
        makeEvent({ event: 'LLM', company: 'corp-b', ts: dayBase + 200, cost_usd: 0.5 }),
        makeEvent({ event: 'LLM', company: 'corp-b', ts: dayBase + 100, cost_usd: 0.25 }),
        makeEvent({ event: 'DISPATCH', company: 'corp-b', ts: dayBase + 300, cost_usd: 9 }),
      ],
    })
    expect(snap.budgets).toEqual({ reserveUsd: 5, reserveCount: 1, settleUsd: 1.25, settleCount: 1, refusalUsd: 0.75, refusalCount: 1, netUsd: 3.75 })
    const day1 = new Date(dayBase).toISOString().slice(0, 10)
    const day2 = new Date(dayBase + DAY_MS).toISOString().slice(0, 10)
    expect(snap.llmDaily).toEqual([
      { date: day1, costUsd: 0.75, events: 2 },
      { date: day2, costUsd: 1.25, events: 1 },
    ])
    expect(snap.note).toContain('不相加')
  })
})

describe('escapeHtml', () => {
  it('五字符实体化；其余原样', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
    expect(escapeHtml('纯文本 123')).toBe('纯文本 123')
  })
})
