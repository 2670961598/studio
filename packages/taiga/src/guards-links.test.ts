/**
 * guards/links 面测试：
 *  - guards 读面：readTaigaRoles() 暴露角色×permissions 数组（docs/32 §二⑤ 素材，
 *    端口无读位——包级导出；形状按 roles-probe-co.json 同构手造、值截短脱敏）
 *  - guards 写面（install/uninstall）：显式未实现（角色收窄=onboard 切片）
 *  - links 面：骨架显式报错（issue↔US 关联未实测，docs/32 §四待核项）
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

describe('guards 写面（显式未实现）', () => {
  it('install/uninstall 调用即明报', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.guards.install('demo-co', [{ from: 'New', to: 'Done' }]), 'CONFIG_INVALID', 'taiga-guards-install-not-implemented')
    await expectTaigaReject(() => p.guards.uninstall('demo-co'), 'CONFIG_INVALID', 'taiga-guards-uninstall-not-implemented')
  })
})

describe('links 面（骨架，docs/32 §四待核项）', () => {
  it('link/children 调用即明报（不静默返回空集）', async () => {
    const p = makePlatform(new FakeTaiga())
    await expectTaigaReject(() => p.links.link('probe-co-1', 'probe-co-2', 'parent-child'), 'CONFIG_INVALID', 'taiga-links-not-implemented')
    await expectTaigaReject(() => p.links.children('probe-co-1'), 'CONFIG_INVALID', 'taiga-links-not-implemented')
  })
})
