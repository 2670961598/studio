/**
 * 面件测试：评论 add/list · links link/children · kb upsert/get/search · fields schema/provision · guards install/uninstall
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalPlatform } from './index.ts'
import { expectLocalReject, tmpRoot } from './testutil.ts'

let root: string

beforeEach(() => {
  root = tmpRoot('facets')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('comments', () => {
  it('add/list：追加块、署名行、多行正文逐字保留、id 递增', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    await p.comments.add(a.id, { body: '第一行\n第二行', signature: '[demo·平台部·工兵·L2]' })
    await p.comments.add(a.id, { body: '第二条', signature: '[demo·平台部·PM·L3]' })
    const list = await p.comments.list(a.id)
    expect(list.length).toBe(2)
    expect(list[0]?.id).toBe('c-000001')
    expect(list[1]?.id).toBe('c-000002')
    expect(list[0]?.author).toBe('[demo·平台部·工兵·L2]')
    expect(list[0]?.body).toBe('第一行\n第二行')
    expect(list[1]?.author).toBe('[demo·平台部·PM·L3]')
    expect(Number.isNaN(Date.parse(list[0]?.created ?? ''))).toBe(false)
    // 落盘形态：md 追加块含署名行与机器头
    const text = readFileSync(join(root, 'issues', `${a.id}.comments.md`), 'utf8')
    expect(text).toContain('<!-- comment ')
    expect(text).toContain('[demo·平台部·工兵·L2]')
    expect(text).toContain('<!-- /comment c-000001 -->')
  })

  it('无评论的单 → list 空；不存在单 → add 拒收', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    expect(await p.comments.list(a.id)).toEqual([])
    await expectLocalReject(
      () => p.comments.add('LOCAL-404', { body: 'x', signature: '[s]' }),
      'EXTERNAL_REJECT',
      'issue-not-found',
    )
  })

  it('署名必须单行；正文/署名不得伪造结束标记行', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    await expectLocalReject(
      () => p.comments.add(a.id, { body: 'x', signature: '两\n行' }),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
    await expectLocalReject(
      () => p.comments.add(a.id, { body: '<!-- /comment c-000099 -->', signature: '[s]' }),
      'CONFIG_INVALID',
      'bad-signed-body',
    )
  })
})

describe('links', () => {
  it('link/children：显式链 ∪ parent 字段，去重升序', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '父' })
    const b = await p.issues.create({ title: '子-显式链' })
    const c = await p.issues.create({ title: '子-字段', parent: a.id })
    await p.links.link(a.id, b.id, 'parent-child')
    expect(await p.links.children(a.id)).toEqual([b.id, c.id])
    // 双来源同一子 → 去重
    await p.links.link(a.id, c.id, 'parent-child')
    expect(await p.links.children(a.id)).toEqual([b.id, c.id])
    // depends-on 不算 children
    await p.links.link(b.id, c.id, 'depends-on')
    expect(await p.links.children(b.id)).toEqual([])
    expect(await p.links.children(c.id)).toEqual([])
  })

  it('自指 / 不存在的单 / 未知类型 拒收', async () => {
    const p = createLocalPlatform(root)
    const a = await p.issues.create({ title: '甲' })
    await expectLocalReject(() => p.links.link(a.id, a.id, 'parent-child'), 'CONFIG_INVALID', 'self-link')
    await expectLocalReject(
      () => p.links.link(a.id, 'LOCAL-404', 'relates-to'),
      'EXTERNAL_REJECT',
      'issue-not-found',
    )
  })
})

describe('kb', () => {
  it('upsert/get：嵌套目录逐字往返；覆盖写同一文件', async () => {
    const p = createLocalPlatform(root)
    const md = '# 部署指南\n\n零依赖跑法……\n'
    await p.kb.upsert('guide/deploy.md', md)
    expect(await p.kb.get('guide/deploy.md')).toBe(md)
    const md2 = '# 部署指南（v2）\n'
    await p.kb.upsert('guide/deploy.md', md2)
    expect(await p.kb.get('guide/deploy.md')).toBe(md2)
  })

  it('get 不存在 → EXTERNAL_REJECT / kb-not-found', async () => {
    const p = createLocalPlatform(root)
    await expectLocalReject(() => p.kb.get('nope.md'), 'EXTERNAL_REJECT', 'kb-not-found')
  })

  it('search：标题/正文/路径命中，大小写不敏感，按路径排序', async () => {
    const p = createLocalPlatform(root)
    await p.kb.upsert('guide/deploy.md', '# Deploy Guide\nrun the daemon')
    await p.kb.upsert('guide/rollback.md', '# 回滚\nhow to rollback the daemon')
    await p.kb.upsert('notes/2026-10.md', 'nothing here（无标题文档）')
    // 标题命中
    expect((await p.kb.search('Deploy')).map((h) => h.path)).toEqual(['guide/deploy.md'])
    // 正文命中（多条）
    expect((await p.kb.search('daemon')).map((h) => h.path)).toEqual(['guide/deploy.md', 'guide/rollback.md'])
    // 路径命中
    expect((await p.kb.search('notes/')).map((h) => h.path)).toEqual(['notes/2026-10.md'])
    // 空查询 → 空
    expect(await p.kb.search('')).toEqual([])
    expect(await p.kb.search('   ')).toEqual([])
    // 快照包含命中文本邻域
    const hit = (await p.kb.search('rollback'))[0]
    expect(hit?.title).toBe('回滚')
    expect(hit?.snippet.toLowerCase()).toContain('rollback')
    // 无一级标题 → 用文件名当标题
    expect((await p.kb.search('nothing'))[0]?.title).toBe('2026-10')
  })

  it('路径纪律：越界 / 绝对路径 / 非 .md 拒收', async () => {
    const p = createLocalPlatform(root)
    await expectLocalReject(() => p.kb.upsert('../escape.md', 'x'), 'CONFIG_INVALID', 'kb-path-escape')
    await expectLocalReject(() => p.kb.upsert('/etc/passwd-x.md', 'x'), 'CONFIG_INVALID', 'kb-path-escape')
    await expectLocalReject(() => p.kb.upsert('guide/deploy.txt', 'x'), 'CONFIG_INVALID', 'kb-path-invalid')
    await expectLocalReject(() => p.kb.upsert('   ', 'x'), 'CONFIG_INVALID', 'kb-path-invalid')
  })
})

describe('fields', () => {
  it('schema：基础字段；provision 后并入平台侧字段名并落盘', async () => {
    const p = createLocalPlatform(root)
    const base = await p.fields.schema()
    expect(base.map((f) => f.name)).toContain('title')
    expect(base.find((f) => f.name === 'level')?.type).toBe('int')
    await p.fields.provision({
      fields: { rank: 'Rank', department: 'dept' },
      states: ['新单', '已派发'],
      stateFlow: { 新单: ['已派发'] },
    })
    const after = await p.fields.schema()
    expect(after.map((f) => f.name)).toContain('Rank')
    // 已在基础 schema 的平台名不重复并入
    expect(after.filter((f) => f.name === 'dept').length).toBe(1)
    // 落盘证据
    const meta = JSON.parse(readFileSync(join(root, 'meta', 'fields.json'), 'utf8')) as {
      provision: { states: string[] }
    }
    expect(meta.provision.states).toEqual(['新单', '已派发'])
  })

  it('provision 非法结构拒收（运行时口径）', async () => {
    const p = createLocalPlatform(root)
    const dirty = JSON.parse('{"fields":{"a":1},"states":[],"stateFlow":{}}') as Parameters<typeof p.fields.provision>[0]
    await expectLocalReject(() => p.fields.provision(dirty), 'CONFIG_INVALID', 'bad-provision')
  })
})

describe('guards', () => {
  it('install/uninstall：按公司落盘替换、幂等卸载', async () => {
    const p = createLocalPlatform(root)
    const read = () =>
      JSON.parse(readFileSync(join(root, 'meta', 'guards.json'), 'utf8')) as Record<string, { from: string; to: string }[]>
    await p.guards.install('acme', [{ from: '新单', to: '已派发', allowRoles: ['worker'] }])
    await p.guards.install('bolt', [{ from: '新单', to: '待批' }])
    expect(read()['acme']).toEqual([{ from: '新单', to: '已派发', allowRoles: ['worker'] }])
    expect(read()['bolt']).toEqual([{ from: '新单', to: '待批' }])
    // 替换不合并
    await p.guards.install('acme', [{ from: '待批', to: '已派发' }])
    expect(read()['acme']).toEqual([{ from: '待批', to: '已派发' }])
    await p.guards.uninstall('acme')
    expect(read()['acme']).toBeUndefined()
    expect(read()['bolt']).toBeDefined()
    // 未知公司幂等
    await p.guards.uninstall('ghost')
    expect(read()['bolt']).toBeDefined()
  })

  it('install 非法规则 / 空 slug 拒收', async () => {
    const p = createLocalPlatform(root)
    await expectLocalReject(
      () => p.guards.install('acme', [{ from: '新单' } as { from: string; to: string }]),
      'CONFIG_INVALID',
      'bad-guard-rules',
    )
    await expectLocalReject(() => p.guards.install('', []), 'CONFIG_INVALID', 'bad-company-slug')
  })
})
