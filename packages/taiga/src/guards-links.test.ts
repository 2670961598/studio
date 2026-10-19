/**
 * guards/links 面测试（onboard 三件之二 + links 定版）：
 *  - guards 读面：readTaigaRoles() 暴露角色×permissions 数组（docs/32 §二⑤ 素材）
 *  - guards 写面：install=modify_us 收窄闸（只收窄不放宽、diff 写、幂等零 PATCH、
 *    unrestricted 边、未知角色/状态/公司作用域/空规则集的失败面）；uninstall=拆闸
 *    （全员放开、幂等零 PATCH）
 *  - links 面（真机定版，证据=probe-evidence/taiga-links）：
 *    link() 三型显式 links-unsupported；children(userstory)=派生 task 链读回；
 *    children(issue)=生成链客户端过滤；单不存在 → issue-not-found
 */
import { describe, expect, it } from 'vitest'
import { readTaigaRoles } from './guards.ts'
import { FakeTaiga, TEST_BASE_URL, TEST_PASSWORD_AUTH, expectTaigaReject, makePlatform } from './testutil.ts'

describe('guards 读面（roles permissions 暴露）', () => {
  it('readTaigaRoles：角色齐全、permissions 数组透传、id 升序', async () => {
    const fake = new FakeTaiga()
    const roles = await readTaigaRoles({
      baseUrl: TEST_BASE_URL,
      project: 'probe-co',
      auth: TEST_PASSWORD_AUTH,
      fetch: fake.fetch,
    })
    expect(roles.map((r) => r.name)).toEqual(['UX', 'Stakeholder'])
    expect(roles[0]?.permissions).toContain('modify_issue')
    expect(roles[0]?.computable).toBe(true)
    expect(roles[1]?.permissions.every((p) => !p.startsWith('add_'))).toBe(true) // stakeholder 只读面
  })
})

describe('guards.install（modify_us 收窄闸）', () => {
  /** 三角色格局：UX=允许且可写、Front=可写但不允许（收窄对象）、Stakeholder=出厂无 modify_us（不放宽） */
  function staged(): FakeTaiga {
    const fake = new FakeTaiga()
    fake.roles.push({ id: 3, name: 'Front', slug: 'front', computable: true, permissions: ['view_us', 'modify_us', 'comment_us', 'add_us'] })
    return fake
  }
  const RULES = [{ from: 'New', to: 'In progress', allowRoles: ['UX'] }]

  it('不在白名单的角色被剥 modify_us；白名单/本无 modify 的角色零 PATCH（只收窄不放宽）', async () => {
    const fake = staged()
    await makePlatform(fake).guards.install('probe-co', RULES)
    expect(fake.roles.find((r) => r.name === 'Front')?.permissions).not.toContain('modify_us')
    expect(fake.roles.find((r) => r.name === 'Front')?.permissions).toContain('comment_us') // 闸只剥 modify
    expect(fake.roles.find((r) => r.name === 'UX')?.permissions).toContain('modify_us')
    expect(fake.roles.find((r) => r.name === 'Stakeholder')?.permissions).not.toContain('modify_us') // 不越权放宽
    expect(fake.countWriteCalls((c) => c.path.startsWith('/api/v1/roles/'))).toBe(1) // 只动了 Front
  })

  it('幂等重入：已收窄后零 PATCH', async () => {
    const fake = staged()
    const p = makePlatform(fake)
    await p.guards.install('probe-co', RULES)
    const before = fake.countWriteCalls()
    await p.guards.install('probe-co', RULES)
    expect(fake.countWriteCalls()).toBe(before)
  })

  it('unrestricted 边（allowRoles 缺省）→ 无人被收窄', async () => {
    const fake = staged()
    await makePlatform(fake).guards.install('probe-co', [{ from: 'New', to: 'Done' }])
    expect(fake.countWriteCalls((c) => c.path.startsWith('/api/v1/roles/'))).toBe(0)
    expect(fake.roles.find((r) => r.name === 'Front')?.permissions).toContain('modify_us')
  })

  it('失败面：公司作用域不符 / 空规则集 / 未知角色 / 未知状态 / 坏规则形状', async () => {
    const p = makePlatform(staged())
    await expectTaigaReject(() => p.guards.install('other-co', RULES), 'CONFIG_INVALID', 'company-scope-mismatch')
    await expectTaigaReject(() => p.guards.install('probe-co', []), 'CONFIG_INVALID', 'bad-guard-rules')
    await expectTaigaReject(() => p.guards.install('probe-co', [{ from: 'New', to: 'In progress', allowRoles: ['不存在的角色'] }]), 'CONFIG_INVALID', 'unknown-role')
    await expectTaigaReject(() => p.guards.install('probe-co', [{ from: '新', to: 'In progress', allowRoles: ['UX'] }]), 'CONFIG_INVALID', 'unknown-state')
    await expectTaigaReject(() => p.guards.install('probe-co', [{ from: '', to: 'In progress' } as never]), 'CONFIG_INVALID', 'bad-guard-rules')
  })
})

describe('guards.uninstall（拆闸=全员放开）', () => {
  it('缺 modify_us 的角色被补回（含出厂即无的——拆闸语义非恢复出厂）；已有者零 PATCH', async () => {
    const fake = new FakeTaiga()
    fake.roles.push({ id: 3, name: 'Front', slug: 'front', computable: true, permissions: ['view_us', 'comment_us'] })
    const p = makePlatform(fake)
    await p.guards.uninstall('probe-co')
    expect(fake.roles.find((r) => r.name === 'UX')?.permissions).toContain('modify_us')
    expect(fake.roles.find((r) => r.name === 'Front')?.permissions).toContain('modify_us')
    expect(fake.roles.find((r) => r.name === 'Stakeholder')?.permissions).toContain('modify_us') // 拆闸=全员放开（头注语义）
    expect(fake.countWriteCalls((c) => c.path.startsWith('/api/v1/roles/'))).toBe(2) // Front + Stakeholder（UX 已有不动）
    // 幂等重入：全员已有 → 零 PATCH
    const before = fake.countWriteCalls()
    await p.guards.uninstall('probe-co')
    expect(fake.countWriteCalls()).toBe(before)
    await expectTaigaReject(() => p.guards.uninstall('other-co'), 'CONFIG_INVALID', 'company-scope-mismatch')
  })
})

describe('links 面（真机定版：写不支持明报，读=派生链）', () => {
  it('link() 三型均显式 links-unsupported（不装懂）；自环先报 self-link', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.links.link('probe-co-1', 'probe-co-2', 'parent-child'), 'CONFIG_INVALID', 'links-unsupported')
    await expectTaigaReject(() => p.links.link('probe-co-1', 'probe-co-2', 'depends-on'), 'CONFIG_INVALID', 'links-unsupported')
    await expectTaigaReject(() => p.links.link('probe-co-1', 'probe-co-2', 'relates-to'), 'CONFIG_INVALID', 'links-unsupported')
    await expectTaigaReject(() => p.links.link('probe-co-1', 'probe-co-1', 'relates-to'), 'CONFIG_INVALID', 'self-link')
  })

  it('children(userstory) = 派生 task 链（ref 全局序 → TicketId 升序）；空派生=[]；单不存在 → issue-not-found', async () => {
    const fake = new FakeTaiga()
    const us = fake.seedEntity({ subject: '父 US' })
    const t1 = fake.seedTask({ subject: '子任务1', userStory: us.id })
    const t2 = fake.seedTask({ subject: '子任务2', userStory: us.id })
    fake.seedTask({ subject: '别人的子任务', userStory: us.id + 100 })
    const p = makePlatform(fake)
    const got = await p.links.children(`probe-co-${String(us.ref)}`)
    expect(got).toEqual([`probe-co-${String(t1.ref)}`, `probe-co-${String(t2.ref)}`]) // ref 升序
    expect(fake.countHistoryFetches()).toBe(0) // children 不走 history
    await expectTaigaReject(() => p.links.children('probe-co-999'), 'EXTERNAL_REJECT', 'issue-not-found')
  })

  it('children(issue) = 生成链客户端过滤（API 过滤参数不生效——平台形状如此）', async () => {
    const fake = new FakeTaiga()
    const parent = fake.seedIssue({ subject: '源 issue' })
    fake.seedIssue({ subject: '生成 issue', generatedFromIssue: parent.id })
    fake.seedIssue({ subject: '无关 issue' })
    const p = makePlatform(fake, { entity: 'issue' })
    const got = await p.links.children(`probe-co-${String(parent.ref)}`)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatch(/^probe-co-\d+$/)
    // 无生成关系的 issue → 空
    const lone = fake.seedIssue({ subject: '孤 issue' })
    expect(await p.links.children(`probe-co-${String(lone.ref)}`)).toEqual([])
  })
})
