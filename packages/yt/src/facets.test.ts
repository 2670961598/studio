/**
 * 面件测试：comments add/list · kb upsert/get/search · links link/children ·
 * fields schema/provision（热换绑）· guards 显式缺口
 */
import { describe, expect, it } from 'vitest'
import { TEST_PROVISION, FakeYouTrack, expectYtReject, makePlatform } from './testutil.ts'
import type { FieldProvisionMap } from '@studio-next/contract'

describe('comments', () => {
  it('add/list：机器头+正文+署名行拼接；作者派生；多行正文逐字保留；外来评论宽容', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.comments.add('STUDIO-1', { body: '第一行\n第二行', signature: '[demo·平台部·工兵·L2]', author: 'AGENT-1' })
    // 写入文本形态（author 进文本头）
    const call = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/issues/STUDIO-1/comments')
    expect(call?.body).toEqual({ text: '<!-- actor: AGENT-1 -->\n第一行\n第二行\n[demo·平台部·工兵·L2]' })

    const list = await p.comments.list('STUDIO-1')
    expect(list.length).toBe(3)
    // 自有评论：author 从机器头派生、body 逐字、署名行剥离
    expect(list[0]).toMatchObject({ id: 'c-1', issue: 'STUDIO-1', author: 'AGENT-1', body: '第一行\n第二行' })
    expect(Number.isNaN(Date.parse(list[0]?.created ?? ''))).toBe(false)
    // 外来评论（无机器头）：author=平台账号 login、全文逐字
    expect(list[1]).toMatchObject({ author: 'foreign-user', body: '外来评论全文（无机器头，逐字保留含末行）' })
    // 新增评论：id 由平台分配
    expect(list[2]).toMatchObject({ author: 'AGENT-1', body: '第一行\n第二行' })
  })

  it('无评论单 → list 空；不存在单 → add/list 拒收 issue-not-found', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    expect(await p.comments.list('STUDIO-3')).toEqual([])
    await expectYtReject(
      () => p.comments.add('STUDIO-404', { body: 'x', signature: '[s]', author: 'AGENT-1' }),
      'EXTERNAL_REJECT',
      'issue-not-found',
    )
  })

  it('署名单行/工号单段无空白/正文不得伪造机器头', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(
      () => p.comments.add('STUDIO-1', { body: 'x', signature: '两\n行', author: 'AGENT-1' }),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
    await expectYtReject(
      () => p.comments.add('STUDIO-1', { body: 'x', signature: '[s]', author: 'has space' }),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
    await expectYtReject(
      () => p.comments.add('STUDIO-1', { body: '<!-- actor: FAKE -->\n冒充', signature: '[s]', author: 'AGENT-1' }),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
  })

  it('评论分页拼接：105 条两页取全（$skip 0→100）', async () => {
    const fake = new FakeYouTrack()
    const seeded = Array.from({ length: 105 }, (_, i) => ({
      id: `c-x${String(i)}`,
      text: `bulk-${String(i)}`,
      created: 1767225900000 + i,
      authorLogin: 'svc-agent',
    }))
    fake.comments.set('STUDIO-3', seeded)
    const p = makePlatform(fake, { project: 'STUDIO' })
    const list = await p.comments.list('STUDIO-3')
    expect(list.length).toBe(105)
    const calls = fake.calls.filter((c) => c.method === 'GET' && c.path === '/api/issues/STUDIO-3/comments')
    expect(calls.map((c) => c.query['$skip'])).toEqual(['0', '100'])
  })
})

describe('kb（articles 端点）', () => {
  it('get：路径下钻树；upsert 覆盖已有叶子', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    expect(await p.kb.get('guide/deploy.md')).toBe('# 部署指南\n\nrun the daemon')
    await p.kb.upsert('guide/deploy.md', '# 部署指南（v2）\n新内容')
    expect(await p.kb.get('guide/deploy.md')).toBe('# 部署指南（v2）\n新内容')
    // 覆盖=对既有文章 POST content，不新建
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/articles').length).toBe(0)
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/articles/2-2')).toBe(true)
  })

  it('upsert：深层新路径逐级补建中间层与叶子，随后可 get', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.kb.upsert('handbook/zh/intro.md', '# 引言')
    expect(await p.kb.get('handbook/zh/intro.md')).toBe('# 引言')
    // 三级创建：handbook、zh、intro 各一次 POST /api/articles；父链逐级挂接
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/articles').length).toBe(3)
    const bodies = fake.calls
      .filter((c) => c.method === 'POST' && c.path === '/api/articles')
      .map((c) => c.body as { summary: string; content: string; parentArticle?: { id: string } })
    expect(bodies[0]).toEqual({ summary: 'handbook', content: '' }) // 根层不带 parentArticle
    expect(bodies[1]?.summary).toBe('zh')
    expect(bodies[1]?.parentArticle?.id).toBe(fake.articles.find((a) => a.summary === 'handbook')?.id)
    expect(bodies[2]).toMatchObject({ summary: 'intro', content: '# 引言' })
    expect(bodies[2]?.parentArticle?.id).toBe(fake.articles.find((a) => a.summary === 'zh')?.id) // intro 挂在 zh 之下
  })

  it('get 不存在 → EXTERNAL_REJECT / kb-not-found；路径纪律拒收', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => p.kb.get('nope.md'), 'EXTERNAL_REJECT', 'kb-not-found')
    await expectYtReject(() => p.kb.get('guide/missing.md'), 'EXTERNAL_REJECT', 'kb-not-found')
    await expectYtReject(() => p.kb.upsert('../escape.md', 'x'), 'CONFIG_INVALID', 'kb-path-escape')
    await expectYtReject(() => p.kb.upsert('/abs/path.md', 'x'), 'CONFIG_INVALID', 'kb-path-escape')
    await expectYtReject(() => p.kb.upsert('guide/deploy.txt', 'x'), 'CONFIG_INVALID', 'kb-path-invalid')
  })

  it('search：命中按路径升序；快照含检索词邻域；空查询不发请求', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    const hits = await p.kb.search('daemon')
    expect(hits.map((h) => h.path)).toEqual(['guide/deploy.md', 'guide/rollback.md'])
    expect(hits[0]?.title).toBe('deploy')
    expect(hits[0]?.snippet.toLowerCase()).toContain('daemon')
    const callsBefore = fake.calls.length
    expect(await p.kb.search('')).toEqual([])
    expect(fake.calls.length).toBe(callsBefore) // 空查询零网络
  })

  it('同名兄弟文章歧义 → 显式报错（v0 已知局限）', async () => {
    const fake = new FakeYouTrack()
    fake.articles.push({ id: '9-1', summary: 'deploy', content: 'dup', parentId: '2-1' })
    const p = makePlatform(fake, { project: 'STUDIO' })
    await expectYtReject(() => p.kb.get('guide/deploy.md'), 'CONFIG_INVALID', 'kb-ambiguous-path')
  })
})

describe('links', () => {
  it('parent-child 落链（子持 INWARD/父持 OUTWARD）；children=OUTWARD Subtask 去重升序', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2']) // fixture 双端链
    await p.links.link('STUDIO-1', 'STUDIO-3', 'parent-child')
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2', 'STUDIO-3'])
    // 重复落链不产生重复 children（Set 去重）
    await p.links.link('STUDIO-1', 'STUDIO-3', 'parent-child')
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2', 'STUDIO-3'])
    // 子单读回 parent（INWARD Subtask 派生）
    expect((await p.issues.get('STUDIO-3')).parent).toBe('STUDIO-1')
  })

  it('depends-on / relates-to 不进 children；链接类型 id 按名解析且实例内缓存', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.links.link('STUDIO-1', 'STUDIO-2', 'depends-on')
    await p.links.link('STUDIO-1', 'STUDIO-3', 'relates-to')
    expect(await p.links.children('STUDIO-1')).toEqual(['STUDIO-2'])
    // issueLinks 只解析一次（缓存；N11 按名、不落盘）
    expect(fake.calls.filter((c) => c.path === '/api/issueLinks').length).toBe(1)
  })

  it('自指 / 不存在的单 拒收', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => p.links.link('STUDIO-1', 'STUDIO-1', 'parent-child'), 'CONFIG_INVALID', 'self-link')
    await expectYtReject(() => p.links.link('STUDIO-1', 'STUDIO-404', 'relates-to'), 'EXTERNAL_REJECT', 'issue-not-found')
    await expectYtReject(() => p.links.link('STUDIO-404', 'STUDIO-1', 'depends-on'), 'EXTERNAL_REJECT', 'issue-not-found')
  })
})

describe('fields', () => {
  it('schema：内建 ∪ 绑定映射（类型取声明）∪ admin live 字段', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const schema = await p.fields.schema()
    const byName = new Map(schema.map((f) => [f.name, f]))
    expect(byName.get('title')).toEqual({ name: 'title', type: 'string' })
    expect(byName.get('description')).toEqual({ name: 'description', type: 'text' })
    expect(byName.get('State')?.type).toBe('enum') // 声明类型
    expect(byName.get('等级')?.type).toBe('int') // 声明类型
    expect(byName.get('Estimation')?.type).toBe('string') // admin-only（float 粗映射）
    expect(schema.filter((f) => f.name === 'State').length).toBe(1) // 不重复并入
  })

  it('provision：热换绑后 schema 与写路径即刻生效', async () => {
    const fake = new FakeYouTrack()
    const p = makePlatform(fake, { project: 'STUDIO' })
    await p.fields.provision({
      ...TEST_PROVISION,
      fields: { ...TEST_PROVISION.fields, rank: 'Rank' },
    })
    expect((await p.fields.schema()).some((f) => f.name === 'Rank')).toBe(true)
    await p.issues.setField('STUDIO-3', 'rank', 'P1')
    const issue = fake.issues.find((i) => i.idReadable === 'STUDIO-3')
    expect(issue?.customFields.some((cf) => cf.name === 'Rank' && cf.value === 'P1')).toBe(true)
  })

  it('provision 非法结构拒收（运行时口径）', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    const dirty = JSON.parse('{"fields":{"a":1},"states":[],"stateFlow":{}}') as FieldProvisionMap
    await expectYtReject(() => p.fields.provision(dirty), 'CONFIG_INVALID', 'bad-provision')
    const noState: FieldProvisionMap = { fields: { dept: '部门' }, states: [], stateFlow: {} }
    await expectYtReject(() => p.fields.provision(noState), 'CONFIG_INVALID', 'missing-state-mapping')
  })
})

describe('guards（v0 显式缺口）', () => {
  it('install/uninstall 一律明报 yt-guards-not-implemented，不静默', async () => {
    const p = makePlatform(new FakeYouTrack(), { project: 'STUDIO' })
    await expectYtReject(() => p.guards.install('demo-co', [{ from: '新单', to: '待批' }]), 'CONFIG_INVALID', 'yt-guards-not-implemented')
    await expectYtReject(() => p.guards.uninstall('demo-co'), 'CONFIG_INVALID', 'yt-guards-not-implemented')
    expect(new FakeYouTrack().calls.length).toBe(0) // 零网络副作用
  })
})
