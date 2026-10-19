/**
 * 知识库面测试：get（by_slug 命中/未命中/路径非法）、search（slug+正文子串、
 * 空查询、无命中）、upsert（onboard 三件之一：建页 POST / 内容一致零写 /
 * 有变 PATCH {content, version} / 版本并发 400 面 / 路径与正文校验）。
 * wiki 页形状按真机实测（列表响应内嵌 content；PATCH version 语义=P61-P63）。
 */
import { describe, expect, it } from 'vitest'
import { createTaigaPlatform } from './index.ts'
import { FakeTaiga, TEST_BASE_URL, TEST_PASSWORD_AUTH, expectTaigaReject, makePlatform } from './testutil.ts'

describe('kb.get（wiki by_slug）', () => {
  it('命中返回正文；未命中 → kb-not-found；路径非法 → kb-path-invalid', async () => {
    const fake = new FakeTaiga()
    fake.seedWikiPage('guide-deploy', '# 部署指南\n零依赖跑法') // slug 不允许斜杠（真机 400），path 折平后命中
    const p = makePlatform(fake)
    expect(await p.kb.get('home')).toContain('知识库根页')
    expect(await p.kb.get('guide/deploy')).toContain('部署指南') // 树形 path 折平为 guide-deploy
    expect(await p.kb.get('guide/deploy.md')).toContain('部署指南') // '.md' 后缀同样折平
    await expectTaigaReject(() => p.kb.get('missing'), 'EXTERNAL_REJECT', 'kb-not-found')
    await expectTaigaReject(() => p.kb.get('/abs'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectTaigaReject(() => p.kb.get('a/../b'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectTaigaReject(() => p.kb.get('  '), 'CONFIG_INVALID', 'kb-path-invalid')
  })
})

describe('kb.search（slug/正文子串，大小写不敏感）', () => {
  it('命中标题与正文；快照窗截断；空查询空结果', async () => {
    const fake = new FakeTaiga()
    fake.seedWikiPage('guide-deploy', '# 部署指南\n零依赖跑法')
    fake.seedWikiPage('notes', '# 会议纪要\n部署 checklist 在下游')
    const p = makePlatform(fake)
    const hits = await p.kb.search('部署')
    expect(hits.map((h) => h.path).sort()).toEqual(['guide-deploy', 'notes'])
    expect(hits.find((h) => h.path === 'guide-deploy')?.title).toBe('部署指南')
    expect(hits.find((h) => h.path === 'guide-deploy')?.snippet).toContain('零依赖跑法')
    expect(await p.kb.search('')).toEqual([])
    expect(await p.kb.search('不存在词')).toEqual([])
  })
})

describe('kb.upsert（按 slug 幂等写）', () => {
  it('新页 → POST（path 折平为 slug）；读回一致；内容一致重入 → 零写调用（不推 version/editions）', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await p.kb.upsert('onboard/runbook', '# 跑法\nbun install')
    expect(fake.wiki.find((w) => w.slug === 'onboard-runbook')).toMatchObject({ content: '# 跑法\nbun install', version: 1, editions: 1 })
    expect(fake.countWriteCalls((c) => c.path === '/api/v1/wiki')).toBe(1)
    const before = fake.countWriteCalls()
    await p.kb.upsert('onboard/runbook', '# 跑法\nbun install')
    expect(fake.countWriteCalls()).toBe(before) // 幂等短路
    expect(await p.kb.get('onboard/runbook')).toBe('# 跑法\nbun install')
  })

  it('已有页内容有变 → PATCH {content, version}（页自身乐观并发号）', async () => {
    const fake = new FakeTaiga()
    const page = fake.seedWikiPage('update-me', '# 旧内容')
    const p = makePlatform(fake)
    await p.kb.upsert('update-me', '# 新内容')
    expect(page.content).toBe('# 新内容')
    expect(page.version).toBe(2)
    expect(page.editions).toBe(2)
    const patch = fake.calls.find((c) => c.method === 'PATCH' && c.path === `/api/v1/wiki/${String(page.id)}`)
    expect(patch?.body).toEqual({ content: '# 新内容', version: 1 }) // 带 GET 探测时的 version
  })

  it('并发冲突面：探测与写之间 version 被推 → 平台 400 透传（bad-request）', async () => {
    const fake = new FakeTaiga()
    fake.seedWikiPage('racy', '# 旧内容')
    // 包装 fetch：在 wiki PATCH 落地前先推页 version（模拟并发写者抢先）
    const inner = fake.fetch
    const racingFetch: typeof inner = (url, init) => {
      if ((init?.method ?? 'GET') === 'PATCH' && url.includes('/api/v1/wiki/')) {
        const pg = fake.wiki.find((w) => w.slug === 'racy')
        if (pg !== undefined) pg.version += 1
      }
      return inner(url, init)
    }
    const p = createTaigaPlatform({ baseUrl: TEST_BASE_URL, project: 'probe-co', auth: TEST_PASSWORD_AUTH, fields: { fields: {}, states: [], stateFlow: {} }, fetch: racingFetch })
    await expectTaigaReject(() => p.kb.upsert('racy', '# 竞态'), 'CONFIG_INVALID', 'bad-request')
    expect(fake.wiki.find((w) => w.slug === 'racy')?.content).toBe('# 旧内容') // 写未生效
  })

  it('路径非法 / 正文非字符串 → CONFIG_INVALID，不发任何写', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await expectTaigaReject(() => p.kb.upsert('/abs', '# x'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectTaigaReject(() => p.kb.upsert('home', 3 as never), 'CONFIG_INVALID', 'bad-kb-body')
    expect(fake.countWriteCalls()).toBe(0)
  })
})
