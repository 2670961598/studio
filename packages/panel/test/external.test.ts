/**
 * :8788 对外 API 端面测试（v0.9 首刀）：app.request() 进程内驱动（零端口）。
 * 依据：docs/16-§四 v0.9（信息/触发端点骨架 + 名片带版本 + **越权调用全部 fail-closed**）、
 * docs/17-§8（:8788 端面）、docs/25-§4.2（EXTERNAL_AI_TOOLS 后续面）、docs/00-§四 D4/D5/D6。
 *
 * 覆盖面：信息端点形状（company/org/people/projects/issues/finance/reports）｜凭证三态
 * （无 401/坏 403/好通过；未配令牌=全 401）｜幂等键防重（同键两次同单号、TTL 过期重落、
 * kv 坏值容错）｜配额 429（固定窗、按客户端键分桶、窗口滚动）｜agent-card 版本字段｜
 * 只落单不派工（断言无 DISPATCH 事件产生）｜多公司解析三态（404/400/自动）｜SSE 501 占位｜
 * 构造闸（空挂载/重复 slug）。
 *
 * 语料：合成公司 demo-corp（2 部门 + 悬空父引用 + 3 人）+ tmp ledger（mirror/budgets/events）；
 * 触发面平台为进程内 fake（记录 create 调用——断言「只落单不派工」的平台侧证据）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, IssueCreate, IssueRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  CLIENT_KEY_HEADER,
  CONTACT_MISSING_NOTE,
  DEFAULT_REQUESTS_PER_MINUTE,
  EXTERNAL_REQUEST_TYPE,
  FRAMEWORK_VERSION,
  IDEMPOTENCY_KV_PREFIX,
  REPORTS_BODY_NOTE,
  TOKEN_HEADER,
  createExternalApp,
} from '../src/external/index.ts'
import type { ExternalCompanySource, ExternalPlatformWrite } from '../src/external/index.ts'
import { T0, makeEvent, makeUlid } from './corpus.ts'

const SLUG = 'demo-corp'

const SNAPSHOT: CompanySnapshot = {
  slug: SLUG,
  name: '演示公司',
  level: 3,
  charter: 'charter.md',
  platform: { platform: 'youtrack' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AG-1', level: 3, lanes: ['core'], functions: ['交付'], relations: [] },
    { name: '悬挂部', path: 'departments/悬挂部', parent: 'departments/不存在', leader: 'AG-1', level: 2, lanes: [], functions: [], relations: [] },
  ],
  people: [
    { id: 'AG-1', name: '一号', login: 'ag-1', level: 3, dept: 'departments/工程部' },
    { id: 'AG-2', name: '二号', login: 'ag-2', level: 2, dept: 'departments/工程部' },
  ],
  jobs: [],
}

const OTHER_SNAPSHOT: CompanySnapshot = {
  slug: 'other-corp',
  name: '别家公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '运营部', path: 'departments/运营部', parent: null, leader: 'OC-1', level: 2, lanes: ['core'], functions: ['运营'], relations: [] },
  ],
  people: [{ id: 'OC-1', name: '别一号', login: 'oc-1', level: 2, dept: 'departments/运营部' }],
  jobs: [],
}

/** 触发面 fake 平台：记录 create 入参（断言只落单的平台侧证据），返回递增单号 */
function createFakeWritePlatform(): { platform: ExternalPlatformWrite; creates: IssueCreate[] } {
  const creates: IssueCreate[] = []
  let seq = 0
  const platform: ExternalPlatformWrite = {
    issues: {
      async create(input: IssueCreate): Promise<IssueRecord> {
        creates.push(input)
        seq += 1
        return {
          id: `EXT-${String(seq)}`,
          title: input.title,
          state: '新单',
          updated: new Date(T0).toISOString(),
          ...(input.type !== undefined ? { type: input.type } : {}),
        }
      },
    },
  }
  return { platform, creates }
}

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-external-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
  // 镜像语料：新单×2 + 已派发×1 + 他司×1（company 过滤维）
  for (const [issue, state, company] of [
    ['EXT-100', '新单', SLUG],
    ['EXT-101', '新单', SLUG],
    ['EXT-102', '已派发', SLUG],
    ['EXT-900', '新单', 'other-corp'],
  ] as const) {
    ledger.upsertTicketMirror({
      issue,
      company,
      created: T0,
      updated: T0,
      state,
      type: 'task',
      dept: 'departments/工程部',
      level: 2,
      dispatcher: 'daemon',
    })
  }
  // 预算三口径（scope=company:demo-corp 全中）
  ledger.appendBudget({ id: makeUlid(T0 + 1), scope_kind: 'company', scope_id: SLUG, kind: 'reserve', estimated_usd: 10, ts: T0 + 1 })
  ledger.appendBudget({ id: makeUlid(T0 + 2), scope_kind: 'company', scope_id: SLUG, kind: 'settle', actual_usd: 4, ts: T0 + 2 })
  ledger.appendBudget({ id: makeUlid(T0 + 3), scope_kind: 'company', scope_id: SLUG, kind: 'refusal', estimated_usd: 2, ts: T0 + 3 })
  // 他司 scope 预算（不应计入 demo-corp 财务面）
  ledger.appendBudget({ id: makeUlid(T0 + 4), scope_kind: 'company', scope_id: 'other-corp', kind: 'reserve', estimated_usd: 99, ts: T0 + 4 })
  // LLM 成本事件 ×2（同日）+ HEARTBEAT ×1（DISPATCH 零条——「只落单不派工」断言基线）
  ledger.appendEvent(makeEvent({ company: SLUG, issue: 'EXT-100', event: 'LLM', cost_usd: 1.5, ts: T0 + 10 }))
  ledger.appendEvent(makeEvent({ company: SLUG, issue: 'EXT-101', event: 'LLM', cost_usd: 0.5, ts: T0 + 11 }))
  ledger.appendEvent(makeEvent({ company: SLUG, issue: '-', event: 'HEARTBEAT', ts: T0 + 12 }))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

/** buildApp 局部覆盖项（noToken/noPlatform 造 fail-closed 面；platform/now 注入自定义件） */
interface BuildOverrides {
  noToken?: boolean
  noPlatform?: boolean
  platform?: ExternalPlatformWrite
  now?: () => number
  requestsPerMinute?: number
  idempotencyTtlMs?: number
}

/** 标准单司 app（含台账/平台/令牌；局部可关掉——exactOptionalPropertyTypes 下显式条件展开） */
function buildApp(o: BuildOverrides = {}): ReturnType<typeof createExternalApp> {
  const companies: ExternalCompanySource[] = [
    {
      slug: SLUG,
      snapshotProvider: () => SNAPSHOT,
      openLedger: () => ledger,
      listReports: () => [
        { file: '2026-10-15-report-工程部-周总结.md', bytes: 1024 },
        { file: '2026-10-16-patrol-工程部-巡检.md', bytes: 512 },
      ],
    },
  ]
  return createExternalApp({
    companies,
    ...(o.noToken ? {} : { token: 'secret-token' }),
    ...(o.noPlatform || o.platform !== undefined ? {} : { platform: createFakeWritePlatform().platform }),
    ...(o.platform !== undefined ? { platform: o.platform } : {}),
    ...(o.now !== undefined ? { now: o.now } : { now: () => T0 }),
    ...(o.requestsPerMinute !== undefined ? { requestsPerMinute: o.requestsPerMinute } : {}),
    ...(o.idempotencyTtlMs !== undefined ? { idempotencyTtlMs: o.idempotencyTtlMs } : {}),
  })
}

const AUTH_HEADERS: Record<string, string> = { [TOKEN_HEADER]: 'secret-token', 'content-type': 'application/json' }

describe('信息端点（全 GET 全公开——D5）', () => {
  it('GET / 索引：service/version/endpoints 清单（与 agent-card 端点表同源）', async () => {
    const res = await buildApp().request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; service: string; version: string; endpoints: Array<{ method: string; path: string }> }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('studio-next external api')
    expect(body.version).toBe(FRAMEWORK_VERSION)
    expect(body.endpoints.some((e) => e.method === 'POST' && e.path === '/v1/requests')).toBe(true)
  })

  it('GET /v1/company：公司清单形状（slug/name/level/platform/计数）+ ?company= 单取 + 未知 404', async () => {
    const app = createExternalApp({
      companies: [
        { slug: SLUG, snapshotProvider: () => SNAPSHOT },
        { slug: 'other-corp', snapshotProvider: () => OTHER_SNAPSHOT },
      ],
    })
    const list = await app.request('/v1/company')
    expect(list.status).toBe(200)
    const body = (await list.json()) as { ok: boolean; count: number; companies: Array<Record<string, unknown>> }
    expect(body.count).toBe(2)
    expect(body.companies.map((c) => c['slug'])).toEqual([SLUG, 'other-corp'])
    expect(body.companies[0]).toMatchObject({ name: '演示公司', level: 3, platform: 'youtrack', departments: 2, people: 2 })

    const single = await app.request('/v1/company?company=other-corp')
    expect(((await single.json()) as { companies: Array<Record<string, unknown>> }).companies[0]?.['name']).toBe('别家公司')

    const unknown = await app.request('/v1/company?company=zzz')
    expect(unknown.status).toBe(404)
  })

  it('GET /v1/org：部门平面投影 + 悬空父引用如实入 warns；单司挂载缺省自动选中', async () => {
    const res = await buildApp().request('/v1/org')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; company: string; departments: Array<{ path: string; parent: string | null }>; warns: string[] }
    expect(body.company).toBe(SLUG)
    expect(body.departments.map((d) => d.path)).toEqual(['departments/工程部', 'departments/悬挂部'])
    expect(body.warns[0]).toContain('悬空父引用')
  })

  it('GET /v1/org 多司挂载未给 company → 400 明示（fail-closed 不静默取首家）；未知 404', async () => {
    const app = createExternalApp({
      companies: [
        { slug: SLUG, snapshotProvider: () => SNAPSHOT },
        { slug: 'other-corp', snapshotProvider: () => OTHER_SNAPSHOT },
      ],
    })
    const res = await app.request('/v1/org')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('COMPANY_REQUIRED')
    const unknown = await app.request('/v1/org?company=zzz')
    expect(unknown.status).toBe(404)
  })

  it('GET /v1/people：PersonRef 直出（D5 全公开）', async () => {
    const res = await buildApp().request('/v1/people')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { people: Array<{ id: string; login: string; level: number }> }
    expect(body.people).toEqual([
      { id: 'AG-1', name: '一号', login: 'ag-1', level: 3, dept: 'departments/工程部' },
      { id: 'AG-2', name: '二号', login: 'ag-2', level: 2, dept: 'departments/工程部' },
    ])
  })

  it('GET /v1/projects：项目卡（N1 一公司一项目；镜像按状态聚合 + 他司行不混入）', async () => {
    const app = createExternalApp({
      companies: [
        { slug: SLUG, snapshotProvider: () => SNAPSHOT, openLedger: () => ledger },
        { slug: 'other-corp', snapshotProvider: () => OTHER_SNAPSHOT, openLedger: () => ledger },
      ],
    })
    const res = await app.request('/v1/projects')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects: Array<{ company: string; total: number; byState: Array<{ state: string; count: number }> }> }
    const demo = body.projects.find((p) => p.company === SLUG)
    const other = body.projects.find((p) => p.company === 'other-corp')
    expect(demo?.total).toBe(3)
    expect(demo?.byState).toEqual([
      { state: '新单', count: 2 },
      { state: '已派发', count: 1 },
    ])
    expect(other?.total).toBe(1)
  })

  it('GET /v1/issues：state 精确过滤 + limit 截取 + company 维 + 缺省全量', async () => {
    const app = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT, openLedger: () => ledger }] })
    const fresh = await app.request('/v1/issues?state=新单')
    const freshBody = (await fresh.json()) as { count: number; issues: Array<{ issue: string; state: string; company: string }> }
    expect(freshBody.issues.every((i) => i.state === '新单')).toBe(true)
    expect(freshBody.issues.map((i) => i.issue)).toEqual(['EXT-100', 'EXT-101'])

    const limited = await app.request('/v1/issues?limit=1')
    expect(((await limited.json()) as { issues: unknown[] }).issues).toHaveLength(1)

    const all = await app.request('/v1/issues')
    expect(((await all.json()) as { issues: unknown[] }).issues).toHaveLength(3)
  })

  it('GET /v1/issues 无台账挂载：如实降级（note 明示，不臆造空数据）', async () => {
    const app = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT }] })
    const res = await app.request('/v1/issues')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; issues: unknown[]; note: string }
    expect(body.issues).toEqual([])
    expect(body.note).toContain('无台账数据')
  })

  it('GET /v1/finance：三口径分列（对齐 :8787 口径）+ 他司 scope 不混入 + LLM 按日聚合', async () => {
    const res = await buildApp().request('/v1/finance')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      finance: {
        budgets: { reserveUsd: number; settleUsd: number; refusalUsd: number; netUsd: number; reserveCount: number }
        llmDaily: Array<{ costUsd: number; events: number }>
      }
    }
    expect(body.finance.budgets).toMatchObject({ reserveUsd: 10, settleUsd: 4, refusalUsd: 2, netUsd: 6, reserveCount: 1 })
    expect(body.finance.llmDaily).toEqual([{ date: expect.any(String), costUsd: 2, events: 2 }])
  })

  it('GET /v1/finance 无台账：finance=null 如实降级', async () => {
    const app = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT }] })
    const body = (await (await app.request('/v1/finance')).json()) as { finance: unknown; note: string }
    expect(body.finance).toBeNull()
    expect(body.note).toContain('无台账数据')
  })

  it('GET /v1/reports：文件清单 + 正文不出（note 待批）；未注入 listReports 如实明示', async () => {
    const res = await buildApp().request('/v1/reports')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; reports: Array<{ file: string; bytes: number }>; note: string }
    expect(body.count).toBe(2)
    expect(body.reports[0]?.file).toBe('2026-10-15-report-工程部-周总结.md')
    expect(body.note).toBe(REPORTS_BODY_NOTE)

    const bare = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT }] })
    const bareBody = (await (await bare.request('/v1/reports')).json()) as { reports: unknown[]; note: string }
    expect(bareBody.reports).toEqual([])
    expect(bareBody.note).toContain('未挂载报表面')
  })

  it('GET /v1/agent-card：名片带版本（=框架版本）+ 端点清单 + 联系位拟稿占位/注入', async () => {
    const res = await buildApp().request('/v1/agent-card')
    expect(res.status).toBe(200)
    const card = ((await res.json()) as { card: Record<string, unknown> }).card
    expect(card['name']).toBe('演示公司')
    expect(card['slug']).toBe(SLUG)
    expect(card['version']).toBe(FRAMEWORK_VERSION)
    expect(card['framework']).toBe('studio-next')
    expect(card['platform']).toBe('youtrack')
    expect(card['contact']).toBe(CONTACT_MISSING_NOTE)
    expect((card['endpoints'] as Array<{ method: string; path: string; auth: string }>).length).toBeGreaterThanOrEqual(10)

    const withContact = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT, contact: 'producer@example.com' }] })
    expect((((await (await withContact.request('/v1/agent-card')).json()) as { card: { contact: string } }).card.contact)).toBe('producer@example.com')
  })

  it('GET /v1/events：SSE 订阅 v0 占位 501（subscription 语义归后续刀）', async () => {
    const res = await buildApp().request('/v1/events')
    expect(res.status).toBe(501)
    expect(((await res.json()) as { code: string }).code).toBe('NOT_IMPLEMENTED')
  })

  it('未知端点 → 404 JSON（ok=false）', async () => {
    const res = await buildApp().request('/v1/nope')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false)
  })
})

describe('触发端点凭证三态（越权全部 fail-closed）', () => {
  const post = (app: ReturnType<typeof createExternalApp>, headers: Record<string, string> = {}): Promise<Response> =>
    app.request('/v1/requests', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ title: '需求', body: '正文', idempotencyKey: 'k-0' }) })

  it('无凭证 → 401；坏凭证 → 403；好凭证 → 通过鉴权（201 落单）', async () => {
    const app = buildApp()
    expect((await post(app)).status).toBe(401)
    expect((await post(app, { [TOKEN_HEADER]: 'wrong' })).status).toBe(403)
    expect((await post(app, AUTH_HEADERS)).status).toBe(201)
  })

  it('令牌未配置 → 触发面全 401（fail-closed，无后门；任意头都不放行）', async () => {
    const app = buildApp({ noToken: true })
    expect((await post(app)).status).toBe(401)
    expect((await post(app, { [TOKEN_HEADER]: 'secret-token' })).status).toBe(401)
    expect((await post(app, { [TOKEN_HEADER]: '' })).status).toBe(401)
  })

  it('凭证先于配额与装配：无 platform 挂载时无凭证仍 401（不泄漏装配态）；过鉴权后 501 明报', async () => {
    const app = buildApp({ noPlatform: true })
    expect((await post(app)).status).toBe(401)
    const res = await post(app, AUTH_HEADERS)
    expect(res.status).toBe(501)
    expect(((await res.json()) as { code: string }).code).toBe('TRIGGER_UNAVAILABLE')
  })

  it('无台账挂载（platform 有、ledger 无）→ 过鉴权后 501（幂等面不可用不静默）', async () => {
    const app = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT }], token: 'secret-token', platform: createFakeWritePlatform().platform })
    const res = await post(app, AUTH_HEADERS)
    expect(res.status).toBe(501)
  })
})

describe('触发端点：落单与幂等键防重', () => {
  it('POST /v1/requests：201 落「外部需求」类型单（title/description 入参直传平台），返回单号', async () => {
    const fake = createFakeWritePlatform()
    const app = buildApp({ platform: fake.platform })
    const res = await app.request('/v1/requests', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ title: '想要一个报表', body: '请出周报', idempotencyKey: 'req-1' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; request: { issue: string; title: string; state: string; type: string; company: string; idempotent: boolean } }
    expect(body.request).toMatchObject({ issue: 'EXT-1', title: '想要一个报表', state: '新单', type: EXTERNAL_REQUEST_TYPE, company: SLUG, idempotent: false })
    expect(fake.creates).toEqual([{ title: '想要一个报表', description: '请出周报', type: EXTERNAL_REQUEST_TYPE }])
  })

  it('幂等键防重：同键两次 → 同单号、第二次 idempotent=true、平台恰被调一次', async () => {
    const fake = createFakeWritePlatform()
    const app = buildApp({ platform: fake.platform })
    const first = await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'same-key' }) })
    const second = await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'same-key' }) })
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const a = ((await first.json()) as { request: { issue: string; idempotent: boolean } }).request
    const b = ((await second.json()) as { request: { issue: string; idempotent: boolean } }).request
    expect(b.issue).toBe(a.issue)
    expect(b.idempotent).toBe(true)
    expect(fake.creates).toHaveLength(1)
  })

  it('幂等 kv 记键→单号映射（external:idem:<slug>:<key> 前缀）', async () => {
    const app = buildApp()
    await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'kv-probe' }) })
    const raw = ledger.kvGet(`${IDEMPOTENCY_KV_PREFIX}${SLUG}:kv-probe`)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toMatchObject({ issue: 'EXT-1' })
  })

  it('TTL 过期：同键过期后重落新单（拟稿 24h——此处注入短 TTL 证明读侧判）', async () => {
    let nowMs = T0
    const fake = createFakeWritePlatform()
    const app = buildApp({ platform: fake.platform, idempotencyTtlMs: 1000, now: () => nowMs })
    const post = (key: string): Promise<Response> => app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: key }) })
    await post('ttl-key')
    nowMs += 2000
    const again = await post('ttl-key')
    expect(again.status).toBe(201)
    expect(((await again.json()) as { request: { issue: string; idempotent: boolean } }).request).toMatchObject({ issue: 'EXT-2', idempotent: false })
    expect(fake.creates).toHaveLength(2)
  })

  it('kv 坏值容错：视为 miss 覆盖重写（幂等面 fail-open 于坏值——不拒服务）', async () => {
    ledger.kvSet(`${IDEMPOTENCY_KV_PREFIX}${SLUG}:bad-value`, 'not-json')
    const fake = createFakeWritePlatform()
    const app = buildApp({ platform: fake.platform })
    const res = await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'bad-value' }) })
    expect(res.status).toBe(201)
    expect(fake.creates).toHaveLength(1)
    expect(JSON.parse(ledger.kvGet(`${IDEMPOTENCY_KV_PREFIX}${SLUG}:bad-value`) as string)).toMatchObject({ issue: 'EXT-1' })
  })

  it('入参校验：坏 JSON / 非对象 / 缺字段 / 空字段 → 400', async () => {
    const app = buildApp()
    const post = (body: string): Promise<Response> => app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body })
    expect((await post('{oops')).status).toBe(400)
    expect((await post('[1,2]')).status).toBe(400)
    expect((await post(JSON.stringify({ body: 'b', idempotencyKey: 'k' }))).status).toBe(400)
    expect((await post(JSON.stringify({ title: '', body: 'b', idempotencyKey: 'k' }))).status).toBe(400)
    expect((await post(JSON.stringify({ title: 't', body: 'b' }))).status).toBe(400)
  })

  it('请求体超限（Content-Length 预检）→ 413', async () => {
    const app = buildApp()
    const res = await app.request('/v1/requests', { method: 'POST', headers: { ...AUTH_HEADERS, 'content-length': '999999' }, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'k' }) })
    expect(res.status).toBe(413)
  })

  it('未知公司 → 404（触发面同解析规则）', async () => {
    const app = buildApp()
    const res = await app.request('/v1/requests?company=zzz', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'k' }) })
    expect(res.status).toBe(404)
  })
})

describe('配额（D6 最小面：IP 每分钟固定窗计数）', () => {
  it('超限 → 429（retryAfterMs>0、limit 明示）；窗口滚动后恢复', async () => {
    let nowMs = T0
    let seq = 0
    const app = buildApp({ requestsPerMinute: 2, now: () => nowMs })
    const post = (): Promise<Response> => app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: `q-${String(seq++)}` }) })
    expect((await post()).status).toBe(201)
    expect((await post()).status).toBe(201)
    const limited = await post()
    expect(limited.status).toBe(429)
    const body = (await limited.json()) as { code: string; limit: number; retryAfterMs: number }
    expect(body.code).toBe('RATE_LIMITED')
    expect(body.limit).toBe(2)
    expect(body.retryAfterMs).toBeGreaterThan(0)
    nowMs += 60_000
    expect((await post()).status).toBe(201)
  })

  it('按客户端键分桶：A 键打满不影响 B 键；401/403 不耗配额', async () => {
    const app = buildApp({ requestsPerMinute: 1 })
    const post = (headers: Record<string, string>, key: string): Promise<Response> =>
      app.request('/v1/requests', { method: 'POST', headers: { ...AUTH_HEADERS, ...headers }, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: `bucket-${key}-${String(Math.random())}` }) })
    // A 桶：一次成功一次 429
    expect((await post({ [CLIENT_KEY_HEADER]: 'client-a' }, 'a')).status).toBe(201)
    expect((await post({ [CLIENT_KEY_HEADER]: 'client-a' }, 'a2')).status).toBe(429)
    // B 桶不受 A 桶影响
    expect((await post({ [CLIENT_KEY_HEADER]: 'client-b' }, 'b')).status).toBe(201)
    // 无凭证/坏凭证不耗配额：灌 5 次失败后持证仍可用（C 桶 fresh）
    for (let i = 0; i < 5; i += 1) {
      await app.request('/v1/requests', { method: 'POST', headers: { [CLIENT_KEY_HEADER]: 'client-c' }, body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'x' }) })
    }
    expect((await post({ [CLIENT_KEY_HEADER]: 'client-c' }, 'c')).status).toBe(201)
  })

  it('配额缺省 30/分钟（DEFAULT_REQUESTS_PER_MINUTE 拟稿值导出冻结）', () => {
    expect(DEFAULT_REQUESTS_PER_MINUTE).toBe(30)
  })
})

describe('只落单不派工（16-§四 v0.9 核心验收）', () => {
  it('触发链全程零 DISPATCH 事件（台账侧证据：无派工落账；含幂等命中路径）', async () => {
    const before = ledger.queryEvents().filter((e) => e.event === 'DISPATCH').length
    const app = buildApp()
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: `需求${String(i)}`, body: 'b', idempotencyKey: `no-dispatch-${String(i)}` }) })
      expect(res.status).toBe(201)
    }
    await app.request('/v1/requests', { method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ title: '需求0', body: 'b', idempotencyKey: 'no-dispatch-0' }) })
    const after = ledger.queryEvents().filter((e) => e.event === 'DISPATCH').length
    expect(after).toBe(before)
  })
})

describe('构造闸（CONFIG_INVALID——fail-closed 于 wiring 错接）', () => {
  it('空挂载 / 重复 slug / 坏 slug → 拒启', () => {
    expect(() => createExternalApp({ companies: [] })).toThrow(/CONFIG_INVALID/)
    expect(() =>
      createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => SNAPSHOT }, { slug: SLUG, snapshotProvider: () => SNAPSHOT }] }),
    ).toThrow(/duplicate-slug/)
    expect(() => createExternalApp({ companies: [{ slug: 'Bad_Slug', snapshotProvider: () => SNAPSHOT }] })).toThrow(/bad-slug/)
  })

  it('快照 slug 与注册 slug 错位 → 500 明报（wiring 错接不静默）', async () => {
    const app = createExternalApp({ companies: [{ slug: SLUG, snapshotProvider: () => OTHER_SNAPSHOT }] })
    const res = await app.request('/v1/company')
    expect(res.status).toBe(500)
  })
})
