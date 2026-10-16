/**
 * serveExternal 真端口测试（v0.9）：随机端口起真 node:http 监听——绑定面 + mock 外部
 * agent 冒烟（16-§四 v0.9 验收口径预演：「提需求→读进度」fetch 链全通）。
 *
 * 绑定面（D4 拟稿反转）：缺省 127.0.0.1（只绑本机）；hostname: '0.0.0.0'（bin --lan 旗标
 * 的落点）才对局域网开放。触发面经真监听壳走 POST 请求体转发 + socket 客户端键注入
 * （toWebRequest 的 x-sn-client-key——真 IP 配额分桶的面板侧证据）。
 *
 * 冒烟链（脚本式 fetch，模拟外部 agent 视角——零内部句柄）：
 *   读名片 → 读公司 → 无凭证 401（fail-closed 自检）→ 提需求（201）→ 同幂等键重提（200
 *   同单号）→ 【模拟 daemon 采集相位同步镜像——生产由主循环完成，本面不写 mirror】→
 *   读进度（/v1/issues 见新单 + /v1/projects 聚合）→ 断言零 DISPATCH（只落单不派工）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, IssueCreate, IssueRecord } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { FRAMEWORK_VERSION, serveExternal } from '../src/external/index.ts'
import type { ExternalCompanySource, ExternalHandle, ExternalPlatformWrite } from '../src/external/index.ts'
import { T0 } from './corpus.ts'

const SLUG = 'smoke-corp'

const SNAPSHOT: CompanySnapshot = {
  slug: SLUG,
  name: '冒烟公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'SM-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'SM-1', name: '冒烟一号', login: 'sm-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

let root = ''
let dbPath = ''
let probeLedger: ReturnType<typeof openLedger> | undefined

/** 冒烟平台：真监听链路上的 fake（记录 create 调用——「只落单」的平台侧证据） */
let smokeCreates: IssueCreate[] = []
const smokePlatform: ExternalPlatformWrite = {
  issues: {
    async create(input: IssueCreate): Promise<IssueRecord> {
      smokeCreates = [...smokeCreates, input]
      const seq = smokeCreates.length
      return { id: `SMOKE-${String(seq)}`, title: input.title, state: '新单', updated: new Date(T0).toISOString(), ...(input.type !== undefined ? { type: input.type } : {}) }
    },
  },
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-external-serve-'))
  dbPath = path.join(root, 'smoke.db')
  const ledger = openLedger(dbPath)
  // 既有单据语料（模拟 daemon 已同步的镜像——进度面有基线数据）
  ledger.upsertTicketMirror({ issue: 'SMOKE-000', company: SLUG, created: T0, updated: T0, state: '已交付', type: 'task', dept: 'departments/工程部', level: 2, dispatcher: 'daemon' })
  ledger.close() // 写手关掉再起 external：WAL 读并发由 external 自己的句柄走
})

afterAll(async () => {
  probeLedger?.close()
  await rm(root, { recursive: true, force: true })
})

const company: ExternalCompanySource = { slug: SLUG, snapshotProvider: () => SNAPSHOT, listReports: () => [{ file: 'README.md', bytes: 12 }] }

describe('serveExternal（绑定面）', () => {
  it('缺省绑 127.0.0.1（D4 拟稿反转：只绑本机）；请求可达；close() 干净关闭', async () => {
    const handle = await serveExternal(0, [company])
    expect(handle.hostname).toBe('127.0.0.1')
    try {
      const res = await fetch(`http://127.0.0.1:${String(handle.port)}/v1/agent-card`)
      expect(res.status).toBe(200)
    } finally {
      await handle.close()
    }
    await expect(fetch(`http://127.0.0.1:${String(handle.port)}/`)).rejects.toThrow()
  }, 5000)

  it("hostname: '0.0.0.0'（--lan 落点）→ 句柄如实上报，本机仍可达", async () => {
    const handle = await serveExternal(0, [company], { hostname: '0.0.0.0' })
    expect(handle.hostname).toBe('0.0.0.0')
    try {
      const res = await fetch(`http://127.0.0.1:${String(handle.port)}/v1/company`)
      expect(res.status).toBe(200)
    } finally {
      await handle.close()
    }
  }, 5000)

  it('ledgerPath 不存在即拒启（external 不代建库）', async () => {
    await expect(serveExternal(0, [company], { ledgerPath: path.join(root, 'not-exist.db') })).rejects.toThrow(/CONFIG_INVALID\/external\/db-not-found/)
  })
})

describe('mock 外部 agent 冒烟（提需求→读进度，v0.9 验收口径预演）', () => {
  let handle: ExternalHandle
  const base = (): string => `http://127.0.0.1:${String(handle.port)}`
  const TOKEN = 'smoke-token'

  beforeAll(async () => {
    handle = await serveExternal(0, [company], { ledgerPath: dbPath, token: TOKEN, platform: smokePlatform })
  })

  afterAll(async () => {
    await handle.close()
  })

  it('全链 fetch：名片→公司→401 自检→提需求→幂等重提→模拟镜像同步→读进度', async () => {
    // ① 读名片（带版本——16-§四 验收点）
    const cardRes = await fetch(`${base()}/v1/agent-card`)
    expect(cardRes.status).toBe(200)
    const card = ((await cardRes.json()) as { card: { name: string; slug: string; version: string } }).card
    expect(card).toMatchObject({ name: '冒烟公司', slug: SLUG, version: FRAMEWORK_VERSION })

    // ② 读公司清单
    const companyRes = await fetch(`${base()}/v1/company`)
    expect(((await companyRes.json()) as { companies: Array<{ slug: string }> }).companies[0]?.slug).toBe(SLUG)

    // ③ 无凭证提需求 → 401（越权 fail-closed 自检）
    const unauth = await fetch(`${base()}/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '想要一个功能', body: '详情', idempotencyKey: 'smoke-1' }),
    })
    expect(unauth.status).toBe(401)

    // ④ 提需求（凭证必带）→ 201 落「外部需求」类型单
    const create = await fetch(`${base()}/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sn-token': TOKEN },
      body: JSON.stringify({ title: '想要一个功能', body: '详情见附件', idempotencyKey: 'smoke-1' }),
    })
    expect(create.status).toBe(201)
    const created = ((await create.json()) as { request: { issue: string; type: string; state: string; idempotent: boolean } }).request
    expect(created).toMatchObject({ issue: 'SMOKE-1', type: '外部需求', state: '新单', idempotent: false })

    // ⑤ 同幂等键重提 → 200 同单号（网络重试安全）
    const retry = await fetch(`${base()}/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sn-token': TOKEN },
      body: JSON.stringify({ title: '想要一个功能', body: '详情见附件', idempotencyKey: 'smoke-1' }),
    })
    expect(retry.status).toBe(200)
    expect(((await retry.json()) as { request: { issue: string; idempotent: boolean } }).request).toMatchObject({ issue: 'SMOKE-1', idempotent: true })
    expect(smokeCreates).toHaveLength(1) // 平台恰被调一次

    // ⑥ 模拟 daemon 采集相位同步镜像（engine.syncMirror 同款形状；生产由主循环完成——本面不写 mirror）
    probeLedger = openLedger(dbPath)
    const updatedMs = Date.parse(new Date(T0).toISOString())
    probeLedger.upsertTicketMirror({
      issue: created.issue,
      company: SLUG,
      created: updatedMs,
      updated: updatedMs,
      state: created.state,
      type: '外部需求',
      dept: 'departments/工程部',
      level: 2,
      dispatcher: 'daemon',
    })

    // ⑦ 读进度：/v1/issues?state=新单 见新单；/v1/projects 聚合计入
    const issuesRes = await fetch(`${base()}/v1/issues?state=新单`)
    const issues = ((await issuesRes.json()) as { issues: Array<{ issue: string; state: string }> }).issues
    expect(issues.some((i) => i.issue === 'SMOKE-1' && i.state === '新单')).toBe(true)

    const projectsRes = await fetch(`${base()}/v1/projects`)
    const projects = ((await projectsRes.json()) as { projects: Array<{ company: string; total: number; byState: Array<{ state: string; count: number }> }> }).projects
    expect(projects[0]?.total).toBe(2)
    expect(projects[0]?.byState).toEqual([
      { state: '已交付', count: 1 },
      { state: '新单', count: 1 },
    ])

    // ⑧ 只落单不派工：台账零 DISPATCH（含真监听链路上的触发）
    const dispatches = probeLedger.queryEvents().filter((e) => e.event === 'DISPATCH')
    expect(dispatches).toHaveLength(0)
  }, 10_000)

  it('真监听壳注入 socket 客户端键：本机请求按 remoteAddress 分桶（127.0.0.1）', async () => {
    // 非触发端点不涉配额；此处验证壳层头注入可见性——触发面配额分桶的面板侧依据。
    // 用 POST（会走配额）打一次后查 kv 侧无异常 + 响应正常即可（分桶正确性归 external.test 的键语义测试）。
    const res = await fetch(`${base()}/v1/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sn-token': TOKEN },
      body: JSON.stringify({ title: 't', body: 'b', idempotencyKey: 'client-key-probe' }),
    })
    expect(res.status).toBe(201)
  })
})
