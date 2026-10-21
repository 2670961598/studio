/**
 * :8789 公司概览面 **JSON 读面 + 换装壳** 测试（DEV-12 刀二拆分件——自 overview.test.ts 迁出：
 * 宪法 BC-S2 拆分，行为零变更）：app.request() 进程内驱动（零端口）。
 * 覆盖：换装壳骨架（/ui/* 静态面）、/api/overview/* JSON 投影（asOf/snapshotMeta）、
 * 保留字闸与热源标注。旧版 /legacy 面与纯函数直测仍在 overview.test.ts。
 * 语料与装配与 overview.test.ts 同源（夹具副本：example-corp 模板直读 + corp-b 合成快照+台账）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, DeptNode } from '@studio-next/contract'
import { openLedger, type BudgetRecord, type Ledger, type TicketMirrorRecord } from '@studio-next/store'
import { createOverviewApp, mountHotCompanySource } from '../src/overview/index.ts'
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
// ————————————————————————— 换装壳（DEV-12 刀二：规范路径=单壳多页 SPA） —————————————————————————

describe('GET / 与 /<slug>/…（换装壳——Naive UI 页面骨架）', () => {
  it('根路径：壳含 #app/#boot-error/importmap 三项映射/入口模块 /legacy 兜底链接/noscript', async () => {
    const { status, html } = await htmlOf('/')
    expect(status).toBe(200)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('id="app"')
    expect(html).toContain('id="boot-error"')
    expect(html).toContain('"vue"')
    expect(html).toContain('"naive-ui"')
    expect(html).toContain('"echarts"')
    expect(html).toContain('<script type="module" src="/ui/overview/main.js">')
    expect(html).toContain('href="/legacy"')
    expect(html).toContain('<noscript>')
  })

  it('公司页/tab 页/档案页同壳（路径即路由——SPA 自行取数）：全部 200 且含同一入口模块', async () => {
    for (const p of [
      '/example-corp/',
      '/example-corp',
      '/corp-b/',
      '/corp-b/org',
      '/corp-b/people',
      '/corp-b/progress',
      '/corp-b/finance',
      '/corp-b/people/PB-1',
    ]) {
      const { status, html } = await htmlOf(p)
      expect(status, p).toBe(200)
      expect(html, p).toContain('<script type="module" src="/ui/overview/main.js">')
    }
  })

  it('未知工号在规范面 404（与 /legacy 同判）；未知 slug 规范面 404', async () => {
    expect((await htmlOf('/corp-b/people/UNKNOWN-9')).status).toBe(404)
    expect((await htmlOf('/nope/')).status).toBe(404)
  })

  it('/ui/overview/* 深层模块经静态面可达（text/javascript）', async () => {
    for (const file of ['main.js', 'app.js', 'router.js', 'components/SnapshotBadge.js', 'charts/options.js']) {
      const res = await app.request(`/ui/overview/${file}`)
      expect(res.status, file).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    }
  })
})

// ————————————————————————— JSON 读面（/api/overview/*——换装页数据源） —————————————————————————

describe('GET /api/overview/companies（JSON 公司清单）', () => {
  it('basis/asOf/全公司行（名称 slug 等级 部门数 人数 平台 使命）；静态源无 snapshotMeta 键（不臆造）', async () => {
    const res = await app.request('/api/overview/companies')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { basis: string; asOf: string; companies: Array<Record<string, unknown>> }
    expect(body.basis).toBe('company-directory')
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false)
    expect(body.companies.map((c) => c.slug)).toEqual(['example-corp', 'corp-b'])
    const corpB = body.companies[1]
    expect(corpB?.name).toBe('合成公司乙')
    expect(corpB?.departmentCount).toBe(4)
    expect(corpB?.peopleCount).toBe(3)
    expect(corpB?.platform).toBe('youtrack')
    expect(corpB?.mission).toBeNull()
    expect(body.companies[0]?.mission).toBe('用一条可验证的交付链，把需求变成有证据的产出')
    for (const c of body.companies) expect('snapshotMeta' in c).toBe(false)
  })
})

describe('GET /api/overview/<slug>/*（JSON 投影）', () => {
  it('snapshot：概览卡全字段（mission=null=未提供）', async () => {
    const res = await app.request('/api/overview/corp-b/snapshot')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.slug).toBe('corp-b')
    expect(body.name).toBe('合成公司乙')
    expect(body.level).toBe(3)
    expect(body.charter).toBe('charter.md')
    expect(body.platform).toBe('youtrack')
    expect(body.departmentCount).toBe(4)
    expect(body.peopleCount).toBe(3)
    expect(body.jobCount).toBe(0)
    expect(body.mission).toBeNull()
    expect('snapshotMeta' in body).toBe(false)
  })

  it('org：嵌套树 JSON（总裁办→工程部→平台组）+ 悬挂父 promoted 标记', async () => {
    const res = await app.request('/api/overview/corp-b/org')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { basis: string; roots: Array<{ name: string; children: Array<{ name: string; children: Array<{ name: string; leader: string; lanes: string[] }> }> }>; promoted: string[]; cyclic: string[] }
    expect(body.basis).toBe('parent-chain')
    expect(body.roots.map((r) => r.name)).toEqual(['总裁办', '悬挂部'])
    const eng = body.roots[0]?.children[0]
    expect(eng?.name).toBe('工程部')
    expect(eng?.children[0]?.name).toBe('平台组')
    expect(eng?.children[0]?.leader).toBe('PB-3')
    expect(eng?.children[0]?.lanes).toEqual(['cli'])
    expect(body.promoted).toEqual(['departments/悬挂部'])
    expect(body.cyclic).toEqual([])
  })

  it('people：hasBody 逐人（PB-1/PB-3 有正文，PB-2 无）', async () => {
    const res = await app.request('/api/overview/corp-b/people')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { people: Array<{ id: string; hasBody: boolean }> }
    const byId = new Map(body.people.map((p) => [p.id, p.hasBody]))
    expect(byId.get('PB-1')).toBe(true)
    expect(byId.get('PB-2')).toBe(false)
    expect(byId.get('PB-3')).toBe(true)
  })

  it('person：档案正文原文进 body（不可信输入由前端模板转义）；缺失=null；未知工号 404 JSON', async () => {
    const ok = (await (await app.request('/api/overview/corp-b/people/PB-3')).json()) as { body: string | null; person: { id: string; dept: string } }
    expect(ok.person.id).toBe('PB-3')
    expect(ok.person.dept).toBe('departments/工程部/平台组')
    expect(ok.body).toContain('<script>alert(1)</script>')
    const missing = (await (await app.request('/api/overview/corp-b/people/PB-2')).json()) as { body: string | null }
    expect(missing.body).toBeNull()
    const unknown = await app.request('/api/overview/corp-b/people/UNKNOWN-9')
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as { error: string }).error).toBe('unknown-person')
  })

  it('progress：状态聚合（开发中 2/已完成 1、共 3）；他公司单不计；无台账=null', async () => {
    const res = await app.request('/api/overview/corp-b/progress')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { progress: { total: number; byState: Array<{ state: string; count: number }>; basis: string } | null }
    expect(body.progress?.total).toBe(3)
    expect(body.progress?.byState).toEqual([
      { state: '开发中', count: 2 },
      { state: '已完成', count: 1 },
    ])
    expect(body.progress?.basis).toBe('ticket-mirror')
    const none = (await (await app.request('/api/overview/example-corp/progress')).json()) as { progress: unknown }
    expect(none.progress).toBeNull()
  })

  it('finance：三口径分列（reserve 8.5/settle 1.75/refusal 0.75/净额 6.75）+ LLM 按日两行；无台账=null', async () => {
    const res = await app.request('/api/overview/corp-b/finance')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      finance: { budgets: { reserveUsd: number; settleUsd: number; refusalUsd: number; netUsd: number }; llmDaily: Array<{ costUsd: number; events: number }> } | null
    }
    expect(body.finance?.budgets).toMatchObject({ reserveUsd: 8.5, settleUsd: 1.75, refusalUsd: 0.75, netUsd: 6.75 })
    expect(body.finance?.llmDaily).toEqual([
      { date: expect.any(String), costUsd: 0.75, events: 2 },
      { date: expect.any(String), costUsd: 1.25, events: 1 },
    ])
    const none = (await (await app.request('/api/overview/example-corp/finance')).json()) as { finance: unknown }
    expect(none.finance).toBeNull()
  })

  it('未知 slug → 404 JSON {error:unknown-slug}；slug 错位 → 500 JSON（/api 面 onError 走 JSON）', async () => {
    const unknown = await app.request('/api/overview/nope/snapshot')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'unknown-slug', slug: 'nope' })
    const mismatchApp = createOverviewApp({
      companies: [{ slug: 'corp-b', snapshotProvider: () => templateSnapshot }],
    })
    const mismatch = await mismatchApp.request('/api/overview/corp-b/snapshot')
    expect(mismatch.status).toBe(500)
    expect(mismatch.headers.get('content-type')).toContain('application/json')
    const errBody = (await mismatch.json()) as { error: string; message: string }
    expect(errBody.error).toBe('internal')
    expect(errBody.message).toContain('slug 错位')
  })
})

// ————————————————————————— 保留字闸 + 快照时间标注（DEV-12） —————————————————————————

describe('保留字与热源标注（DEV-12 刀二）', () => {
  it('slug=legacy → CONFIG_INVALID/overview/reserved-slug（/legacy 路由空间不遮蔽）', () => {
    expect(() =>
      createOverviewApp({ companies: [{ slug: 'legacy', snapshotProvider: () => CORP_B_SNAPSHOT }] }),
    ).toThrow(/reserved-slug/)
  })

  it('热源（mountHotCompanySource）→ snapshotMeta 随 JSON 透出（at/atIso/version/watching/lastError）', async () => {
    const hot = mountHotCompanySource({
      directory: root, // watchEnabled:false——目录仅占位，不真监听（真监听行为归 overview-reload.test.ts）
      initial: { slug: 'corp-b', snapshotProvider: () => CORP_B_SNAPSHOT },
      reload: () => ({ slug: 'corp-b', snapshotProvider: () => CORP_B_SNAPSHOT }),
      watchEnabled: false,
    })
    try {
      const hotApp = createOverviewApp({ companies: [hot.source] })
      const body = (await (await hotApp.request('/api/overview/companies')).json()) as {
        companies: Array<{ slug: string; snapshotMeta?: { at: number; atIso: string; version: number; watching: boolean; lastError: string | null } }>
      }
      const meta = body.companies[0]?.snapshotMeta
      expect(meta).toBeDefined()
      expect(meta?.version).toBe(1)
      expect(meta?.watching).toBe(false)
      expect(meta?.lastError).toBeNull()
      expect(meta?.at).toBeGreaterThan(0)
      expect(Number.isNaN(Date.parse(meta?.atIso ?? ''))).toBe(false)
      // snapshot 页同标注
      const snap = (await (await hotApp.request('/api/overview/corp-b/snapshot')).json()) as { snapshotMeta?: { version: number } }
      expect(snap.snapshotMeta?.version).toBe(1)
    } finally {
      hot.close()
    }
  })
})
