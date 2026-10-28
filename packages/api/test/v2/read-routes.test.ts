/**
 * packages/api/test/v2/read-routes.test.ts —— 只读族 API-01..05/07 正负例
 *
 * 覆盖（app.request 进程内）：
 *   ① company/org/people/projects/issues/reports 正例（白名单字段）；
 *   ② 跨公司读隔离 NEG-SEC-02 读腿：?company= 错维 403（读源不被触达）；
 *   ③ 读源未提供/未命中=503（不是 404/空列表）；读源公司维不符/缺失=503；
 *   ④ 白名单序列化：读源多给的秘密列/花名册/正文不外露；
 *   ⑤ 读源抛错=500（读不出来不伪装 404/200）。
 */
import { describe, expect, it } from 'vitest'
import type { ApiIssueQuery, ApiPeopleView, ApiReadSources } from '../../src/index.ts'
import { COMPANY, jsonBody, makeApp, makeReaders } from './fakes.ts'

const READ_PATHS = [
  '/v1/company',
  '/v1/org',
  '/v1/people',
  '/v1/projects',
  '/v1/issues',
  '/v1/reports',
  '/v1/agent-card',
] as const

describe('只读族正例（API-01..05/07/09）', () => {
  it('company：挂载公司维＋平台；白名单不含读源多给字段', async () => {
    const readers = makeReaders({
      company: () =>
        ({
          companyId: COMPANY.companyId,
          slug: COMPANY.slug,
          name: 'Demo 公司',
          platform: 'taiga',
          description: '演示公司',
          secretColumn: '不得外露',
        }) as never,
    })
    const res = await makeApp({ readers }).request('/v1/company?company=demo')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const company = body['company'] as Record<string, unknown>
    expect(company['companyId']).toBe(COMPANY.companyId)
    expect(company['slug']).toBe('demo')
    expect(company['name']).toBe('Demo 公司')
    expect(company['platform']).toBe('taiga')
    expect(company['description']).toBe('演示公司')
    expect(company['secretColumn']).toBeUndefined()
    expect(body['readOnly']).toBe(true)
    expect(body['generatedAt']).toBe('2026-10-28T00:00:00.000Z')
  })

  it('company：?company=<companyId> 同维也接受（slug/ID 同源）', async () => {
    const res = await makeApp().request(`/v1/company?company=${COMPANY.companyId}`)
    expect(res.status).toBe(200)
  })

  it('org：部门平面＋悬空/成环 warnings 原样；无人员明细', async () => {
    const res = await makeApp().request('/v1/org')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const org = body['org'] as Record<string, unknown>
    expect(org['company']).toBe('demo')
    const departments = org['departments'] as Array<Record<string, unknown>>
    expect(departments).toHaveLength(2)
    expect(departments[0]?.['path']).toBe('研发部')
    expect(departments[1]?.['parent']).toBe('研发部')
    expect(org['warnings']).toEqual(['悬空父引用（parent 不在部门集，已提升为根）：x'])
    expect(JSON.stringify(org)).not.toContain('花名册')
  })

  it('people：默认只出聚合（total＋分组），读源花名册字段被白名单挡掉', async () => {
    const base = makeReaders().people({
      readScope: { company: COMPANY, fields: ['people.aggregate'], purpose: 'test' },
      caller: { callerId: 'test', kind: 'program' },
    })
    const withRoster = {
      ...(base as ApiPeopleView),
      roster: [{ name: '秘密姓名' }],
    } as unknown as ApiPeopleView
    const res = await makeApp({ readers: makeReaders({ people: () => withRoster }) }).request('/v1/people')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const people = body['people'] as Record<string, unknown>
    expect(people['total']).toBe(5)
    expect(people['byDepartment']).toEqual([
      { key: '研发部', count: 3 },
      { key: '财务部', count: 2 },
    ])
    expect(people['byStatus']).toEqual([{ key: 'active', count: 5 }])
    expect(people['roster']).toBeUndefined()
    expect(JSON.stringify(people)).not.toContain('秘密姓名')
  })

  it('projects：只出挂载公司行（别家行过滤），total=同维行数', async () => {
    const res = await makeApp().request('/v1/projects')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const items = body['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]?.['projectId']).toBe('p-1')
    expect(body['total']).toBe(1)
    expect(JSON.stringify(body)).not.toContain('别家项目')
  })

  it('issues：?state=&limit= 传给读源；limit 夹取≤100；只出同维行且不透出跨公司 total', async () => {
    let seen: ApiIssueQuery | undefined
    const readers = makeReaders({
      issues: (query) => {
        seen = query
        return {
          items: [
            { company: COMPANY.slug, issueId: 'i-1', title: '单据一', state: query.state ?? 'open' },
            { company: 'other', issueId: 'i-x', title: '别家单据', state: 'open' },
          ],
          total: 99,
        }
      },
    })
    const res = await makeApp({ readers }).request('/v1/issues?state=closed&limit=999')
    expect(res.status).toBe(200)
    expect(seen).toEqual({ state: 'closed', limit: 100 })
    const body = await jsonBody(res)
    const items = body['items'] as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]?.['issueId']).toBe('i-1')
    expect(items[0]?.['state']).toBe('closed')
    expect(body['total']).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('别家单据')
    // 白名单：默认 fake 行里的 secretColumn 不外露
    expect(JSON.stringify(body)).not.toContain('secretColumn')
    expect(JSON.stringify(body)).not.toContain('不得外露')
  })

  it('issues：无跨公司行时 total 如实给出；默认 limit=20', async () => {
    let seen: ApiIssueQuery | undefined
    const readers = makeReaders({
      issues: (query) => {
        seen = query
        return { items: [{ company: COMPANY.slug, issueId: 'i-1', title: '单据一', state: 'open' }], total: 1 }
      },
    })
    const res = await makeApp({ readers }).request('/v1/issues')
    expect(res.status).toBe(200)
    expect(seen).toEqual({ limit: 20 })
    const body = await jsonBody(res)
    expect(body['total']).toBe(1)
  })

  it('reports：只出文件清单（正文/别家行不外露）', async () => {
    const readers = makeReaders({
      reports: () => [
        { company: COMPANY.slug, file: '2026-10.md', bytes: 128, generatedAt: '2026-10-28T00:00:00.000Z' },
        { company: COMPANY.slug, file: 'secret.md', content: '报表正文不得外露' } as never,
        { company: 'other', file: 'other.md' },
      ],
    })
    const res = await makeApp({ readers }).request('/v1/reports')
    expect(res.status).toBe(200)
    const body = await jsonBody(res)
    const reports = body['reports'] as Array<Record<string, unknown>>
    expect(reports).toHaveLength(2)
    expect(reports[0]?.['file']).toBe('2026-10.md')
    expect(reports[1]?.['content']).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('报表正文不得外露')
    expect(JSON.stringify(body)).not.toContain('other.md')
  })
})

describe('跨公司读隔离（NEG-SEC-02 读腿）', () => {
  it('?company= 错维一律 403，读源不被触达（fail-closed 在数据面之前）', async () => {
    const throwingReaders: ApiReadSources = {
      company: () => {
        throw new Error('reader 不应被调用')
      },
      org: () => {
        throw new Error('reader 不应被调用')
      },
      people: () => {
        throw new Error('reader 不应被调用')
      },
      projects: () => {
        throw new Error('reader 不应被调用')
      },
      issues: () => {
        throw new Error('reader 不应被调用')
      },
      finance: () => {
        throw new Error('reader 不应被调用')
      },
      reports: () => {
        throw new Error('reader 不应被调用')
      },
      agentCard: () => {
        throw new Error('reader 不应被调用')
      },
    }
    const app = makeApp({ readers: throwingReaders })
    for (const readPath of READ_PATHS) {
      const res = await app.request(`${readPath}?company=other`)
      expect(res.status, readPath).toBe(403)
      const body = await jsonBody(res)
      const error = body['error'] as Record<string, unknown>
      expect(error['subcause']).toBe('company-scope-mismatch')
    }
  })

  it('?company= 空串＝422（不回落挂载公司）', async () => {
    const res = await makeApp().request('/v1/company?company=')
    expect(res.status).toBe(422)
    const body = await jsonBody(res)
    expect(body['fieldPath']).toBe('company')
  })

  it('读源返回别家公司维＝503 不服务（公司/组织/人事/财务/名片）', async () => {
    const cases: Array<{ path: string; readers: Partial<ApiReadSources> }> = [
      { path: '/v1/company', readers: { company: () => ({ companyId: 'C-999', slug: 'other', name: '别家公司' }) } },
      { path: '/v1/org', readers: { org: () => ({ company: 'other', departments: [], warnings: [] }) } },
      {
        path: '/v1/people',
        readers: { people: () => ({ company: 'other', total: 0, byDepartment: [], byLevel: [] }) },
      },
      {
        path: '/v1/finance',
        readers: {
          finance: () => ({
            company: 'other',
            currency: 'CNY',
            window: { from: '2026-10-01', to: '2026-10-31' },
            segments: [],
          }),
        },
      },
      {
        path: '/v1/agent-card',
        readers: {
          agentCard: () => ({
            company: 'other',
            name: '别家',
            slug: 'other',
            version: '1.0.0',
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: '2027-01-01T00:00:00.000Z',
          }),
        },
      },
    ]
    for (const testCase of cases) {
      const res = await makeApp({ readers: makeReaders(testCase.readers) }).request(testCase.path)
      expect(res.status, testCase.path).toBe(503)
      const body = await jsonBody(res)
      const error = body['error'] as Record<string, unknown>
      expect(error['subcause']).toBe('source-company-mismatch')
    }
  })
})

describe('读源未命中/读不出来', () => {
  it('各只读端点读源 undefined＝503 view-unavailable（不是 404/空列表）', async () => {
    const cases: Array<{ path: string; readers: Partial<ApiReadSources> }> = [
      { path: '/v1/company', readers: { company: () => undefined } },
      { path: '/v1/org', readers: { org: () => undefined } },
      { path: '/v1/people', readers: { people: () => undefined } },
      { path: '/v1/projects', readers: { projects: () => undefined } },
      { path: '/v1/issues', readers: { issues: () => undefined } },
      { path: '/v1/finance', readers: { finance: () => undefined } },
      { path: '/v1/reports', readers: { reports: () => undefined } },
      { path: '/v1/agent-card', readers: { agentCard: () => undefined } },
    ]
    for (const testCase of cases) {
      const res = await makeApp({ readers: makeReaders(testCase.readers) }).request(testCase.path)
      expect(res.status, testCase.path).toBe(503)
      const body = await jsonBody(res)
      const error = body['error'] as Record<string, unknown>
      expect(error['subcause']).toBe('view-unavailable')
      expect(body['reason']).toBeDefined()
    }
  })

  it('读源抛错＝500（读不出来不伪装成 404/200）', async () => {
    const readers = makeReaders({
      org: () => {
        throw new Error('投影读取失败（测试）')
      },
    })
    const res = await makeApp({ readers }).request('/v1/org')
    expect(res.status).toBe(500)
    const body = await jsonBody(res)
    const error = body['error'] as Record<string, unknown>
    expect(error['subcause']).toBe('internal')
  })

  it('issues 缺 state 值/坏 limit 不炸：limit 非法回落缺省、state 空串 422', async () => {
    const res = await makeApp().request('/v1/issues?limit=abc')
    expect(res.status).toBe(200)
    const bad = await makeApp().request('/v1/issues?state=')
    expect(bad.status).toBe(422)
  })
})
