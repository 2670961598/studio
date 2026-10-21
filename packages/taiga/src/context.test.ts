/**
 * TaigaContext 缓存纪律测试（studio-dev-126 T1，proposal §1-A①）：
 *  - 抛错型查找 bound=1 自愈：长实例缓存可能落后平台真源（他人 provision/平台侧手改
 *    的窗口）——miss 时作废缓存重读真源一次；仍缺才抛（消息指路 fields.provision）。
 *  - invalidateMembers()：作废「项目 id+成员」双缓存（成员内嵌 by_slug 与 projectId
 *    一次解析，N11）——hr-sync 写通面（T5）的作废原语。
 *  - 读放大防线（负断言）：undefined 返回型查找（usernameById）**不**自愈——miss 只回
 *    undefined，不多拉真源（高频读路径的读放大闸）。
 */
import { describe, expect, it } from 'vitest'
import { buildContext } from './platform.ts'
import { FakeTaiga } from './testutil.ts'
import { TEST_BASE_URL, TEST_PASSWORD_AUTH } from './platform-fixture.ts'

function ctxOf(fake: FakeTaiga): ReturnType<typeof buildContext> {
  return buildContext({ baseUrl: TEST_BASE_URL, project: 'probe-co', auth: TEST_PASSWORD_AUTH, fetch: fake.fetch })
}

describe('T1 bound=1 自愈（statusIdByName/statusNameById/attributeIdByName）', () => {
  it('缓存落后真源：直改 fake 状态集（不走 provision=无作废）→ miss 一次自愈重读命中', async () => {
    const fake = new FakeTaiga()
    const ctx = ctxOf(fake)
    expect(await ctx.statusIdByName('New')).toBe(1) // 首查落缓存
    fake.statuses.push({ id: 99, name: '新档态', slug: 'xin-dang' }) // 平台侧他者建档（缓存不知）
    expect(await ctx.statusIdByName('新档态')).toBe(99) // 自愈：作废重读命中
    // 反向同法：id 查名（issue 读面 statusNameById 消费平台回显 id）
    fake.statuses.push({ id: 100, name: '次新态', slug: 'ci-xin' })
    expect(await ctx.statusNameById(100)).toBe('次新态')
  })

  it('自愈后仍缺 → 显式抛（消息指路 fields.provision，不再「重建实例」旧口径）', async () => {
    const ctx = ctxOf(new FakeTaiga())
    await ctx.statusIdByName('New') // 落缓存
    await expect(ctx.statusIdByName('无有态')).rejects.toThrow('缓存已重读真源仍缺')
    await expect(ctx.statusIdByName('无有态')).rejects.toThrow('fields.provision')
  })

  it('属性集同法：attributeIdByName 自愈命中/仍缺明报', async () => {
    const fake = new FakeTaiga()
    const ctx = ctxOf(fake)
    expect(await ctx.attributeIdByName('类型')).toBe(11)
    fake.attributes.push({ id: 88, name: '成本', type: 'number' })
    expect(await ctx.attributeIdByName('成本')).toBe(88)
    await expect(ctx.attributeIdByName('无有属性')).rejects.toThrow('缓存已重读真源仍缺')
  })

  it('读放大负断言：usernameById（undefined 返回型）不自愈——miss 只回 undefined 不重拉真源', async () => {
    const fake = new FakeTaiga()
    const ctx = ctxOf(fake)
    await ctx.members() // 落缓存
    fake.members.push({ id: 77, username: 'later' }) // 平台侧新入场（缓存不知）
    expect(await ctx.usernameById(77)).toBeUndefined() // 不自愈：长实例读面宁可返回旧视图，读放大闸优先
    // by_slug 拉取次数=1（首查）——自愈若发生会是 2
    const bySlug = fake.calls.filter((c) => c.path.includes('/projects/by_slug'))
    expect(bySlug).toHaveLength(1)
  })
})

describe('T1 invalidateMembers()（T5 写通的作废原语：projectId+memberList 一起作废）', () => {
  it('作废后 members()/idByUsername 回真源见新成员；projectId 同批作废重建', async () => {
    const fake = new FakeTaiga()
    const ctx = ctxOf(fake)
    await ctx.project() // 落 projectId+memberList 双缓存
    fake.members.push({ id: 77, username: 'later' }) // hr-sync 入场后的真源变化
    ctx.invalidateMembers()
    expect((await ctx.members()).some((m) => m.username === 'later')).toBe(true)
    expect(await ctx.idByUsername('later')).toBe(77)
  })

  it('不作废即不见（缓存惯性正断言——写通作废的必要性证明）', async () => {
    const fake = new FakeTaiga()
    const ctx = ctxOf(fake)
    await ctx.members()
    fake.members.push({ id: 77, username: 'later' })
    expect((await ctx.members()).some((m) => m.username === 'later')).toBe(false) // 旧视图
  })
})
