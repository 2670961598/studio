/**
 * 知识库面测试：get（by_slug 命中/未命中/路径非法）、search（slug+正文子串、
 * 空查询、无命中）、upsert 显式未实现（写面边界=issues+comments）。
 * wiki 页形状按真机实测（列表响应内嵌 content）。
 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, expectTaigaReject, makePlatform } from './testutil.ts'

describe('kb.get（wiki by_slug）', () => {
  it('命中返回正文；未命中 → kb-not-found；路径非法 → kb-path-invalid', async () => {
    const fake = new FakeTaiga()
    fake.wiki.push({ slug: 'guide/deploy', content: '# 部署指南\n零依赖跑法' })
    const p = makePlatform(fake)
    expect(await p.kb.get('home')).toContain('知识库根页')
    expect(await p.kb.get('guide/deploy')).toContain('部署指南')
    await expectTaigaReject(() => p.kb.get('missing'), 'EXTERNAL_REJECT', 'kb-not-found')
    await expectTaigaReject(() => p.kb.get('/abs'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectTaigaReject(() => p.kb.get('a/../b'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectTaigaReject(() => p.kb.get('  '), 'CONFIG_INVALID', 'kb-path-invalid')
  })
})

describe('kb.search（slug/正文子串，大小写不敏感）', () => {
  it('命中标题与正文；快照窗截断；空查询空结果', async () => {
    const fake = new FakeTaiga()
    fake.wiki.push({ slug: 'guide/deploy', content: '# 部署指南\n零依赖跑法' })
    fake.wiki.push({ slug: 'notes', content: '# 会议纪要\n部署 checklist 在下游' })
    const p = makePlatform(fake)
    const hits = await p.kb.search('部署')
    expect(hits.map((h) => h.path).sort()).toEqual(['guide/deploy', 'notes'])
    expect(hits.find((h) => h.path === 'guide/deploy')?.title).toBe('部署指南')
    expect(hits.find((h) => h.path === 'guide/deploy')?.snippet).toContain('零依赖跑法')
    expect(await p.kb.search('')).toEqual([])
    expect(await p.kb.search('不存在词')).toEqual([])
  })
})

describe('kb.upsert（显式未实现）', () => {
  it('调用即明报，指向 onboard 落地路径', async () => {
    await expectTaigaReject(() => makePlatform(new FakeTaiga()).kb.upsert('home', '# x'), 'CONFIG_INVALID', 'taiga-kb-upsert-not-implemented')
  })
})
