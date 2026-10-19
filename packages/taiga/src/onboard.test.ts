/**
 * onboard 写面三件合流幂等测试（单测口径的「两跑同结果」；真机两跑=
 * test/smoke/taiga-onboard-smoke.ts WRITE_SMOKE=1）：
 *   序列 = fields.provision + kb.upsert + guards.install（docs/30 §6 ⑤⑥⑧ 子集）
 *   - 第一跑：缺档建档（状态/属性/wiki 页）、收窄闸剥非白名单角色 modify_us
 *   - 第二跑：全部命中现值/已收窄 → **零写调用**（幂等基线=GET-first + diff 写）
 *   - 两跑后平台状态指纹（schema + kb 正文 + roles×permissions）一致
 */
import { describe, expect, it } from 'vitest'
import { FakeTaiga, makePlatform } from './testutil.ts'

const ONBOARD_MAP = {
  fields: { dept: '部门', level: '等级', cost: '成本' },
  types: { level: 'int' as const, cost: 'int' as const },
  states: ['New', 'In progress', 'Done', '验收中'],
  stateFlow: { New: ['In progress'], 'In progress': ['验收中'], 验收中: ['Done'] },
}
const RULES = [
  { from: 'New', to: 'In progress', allowRoles: ['UX'] },
  { from: 'In progress', to: 'Done', allowRoles: ['UX'] },
]
const KB_PATH = 'onboard/home'
const KB_MD = '# 冒烟公司知识库根页\n跑法见下游'

async function fingerprint(fake: FakeTaiga, p: ReturnType<typeof makePlatform>): Promise<string> {
  // 角色快照直接读 fake 状态（不再组第二客户端——fake 的 token 单槽，新登录会作废旧实例 token）
  const roles = fake.roles.map((r) => [r.name, [...r.permissions].sort()] as const)
  return JSON.stringify({ schema: await p.fields.schema(), kb: await p.kb.get(KB_PATH), roles })
}

describe('onboard 三件合流幂等（两跑同结果）', () => {
  it('第一跑建档+收窄有写；第二跑零写；指纹一致', async () => {
    const fake = new FakeTaiga()
    fake.roles.push({ id: 3, name: 'Front', slug: 'front', computable: true, permissions: ['view_us', 'modify_us', 'comment_us'] })
    const p = makePlatform(fake)

    // —— 第一跑 ——
    await p.fields.provision(ONBOARD_MAP)
    await p.kb.upsert(KB_PATH, KB_MD)
    await p.guards.install('probe-co', RULES)
    const writes1 = fake.countWriteCalls()
    expect(writes1).toBe(4) // 1 状态（验收中）+ 1 属性（成本）+ 1 wiki 页 + 1 roles 收窄（Front）
    expect(fake.roles.find((r) => r.name === 'Front')?.permissions).not.toContain('modify_us')

    const fp1 = await fingerprint(fake, p)

    // —— 第二跑（幂等重入：全命中现值/已收窄 → 零写）——
    await p.fields.provision(ONBOARD_MAP)
    await p.kb.upsert(KB_PATH, KB_MD)
    await p.guards.install('probe-co', RULES)
    expect(fake.countWriteCalls()).toBe(writes1)

    const fp2 = await fingerprint(fake, p)
    expect(fp2).toBe(fp1) // 两跑同结果
  })

  it('kb 正文演进后重跑：PATCH 一次推齐，再跑回到零写', async () => {
    const fake = new FakeTaiga()
    const p = makePlatform(fake)
    await p.kb.upsert('onboard/home', '# v1')
    const base = fake.countWriteCalls()
    await p.kb.upsert('onboard/home', '# v2') // 有变 → PATCH
    expect(fake.countWriteCalls()).toBe(base + 1)
    await p.kb.upsert('onboard/home', '# v2') // 推齐后 → 零写
    expect(fake.countWriteCalls()).toBe(base + 1)
    expect(await p.kb.get('onboard/home')).toBe('# v2')
  })
})
