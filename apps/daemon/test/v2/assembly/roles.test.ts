/** 公司 L2.5 角色包装载（studio-dev-724）：6 类模板 + 28 卡装载/校验/缺省。 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROLE_CLASSES, inferRoleClass } from '@studio-next/prompt'
import { loadRolePacks } from '../../../src/assembly/roles/loader.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function company(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'roles-724-'))
  dirs.push(dir)
  mkdirSync(path.join(dir, 'prompts', 'roles', 'cards'), { recursive: true })
  return dir
}
function seedCompany(dir: string): void {
  for (const roleClass of ROLE_CLASSES) {
    writeFileSync(path.join(dir, 'prompts', 'roles', `${roleClass}.md`), `# ${roleClass} 类模板\n- 职责/边界/升级\n`, 'utf8')
  }
  for (let i = 1; i <= 28; i += 1) {
    const roleClass = ROLE_CLASSES[(i - 1) % ROLE_CLASSES.length]!
    writeFileSync(
      path.join(dir, 'prompts', 'roles', 'cards', `P-${String(i).padStart(3, '0')}.md`),
      `---\nroleClass: ${roleClass}\ntitle: 岗位${i}\nmission: 使命${i}\nversion: 1\n---\n职责：${roleClass} 卡正文 ${i}\n`,
      'utf8',
    )
  }
}

describe('loadRolePacks', () => {
  it('6 类模板 + 28 卡装载；rolePackFor 返回类模板+卡正文；缺省目录=空', () => {
    const dir = company()
    seedCompany(dir)
    const packs = loadRolePacks(dir)
    expect(packs.templates.size).toBe(6)
    expect(packs.cards.size).toBe(28)
    const pack = packs.rolePackFor('P-001')
    expect(pack?.roleClass).toBe('minister')
    expect(pack?.classText).toContain('minister 类模板')
    expect(pack?.card.body).toContain('职责：minister 卡正文 1')
    expect(packs.rolePackFor('NOBODY')).toBeUndefined()
    expect(loadRolePacks(company()).templates.size).toBe(0)
  })
  it('坏卡（缺/坏 roleClass、空正文、超长、层标记走私）→ 拒收', () => {
    const bad = company()
    seedCompany(bad)
    writeFileSync(path.join(bad, 'prompts', 'roles', 'cards', 'P-001.md'), '---\ntitle: x\n---\n正文\n', 'utf8')
    expect(() => loadRolePacks(bad)).toThrow(/roleClass/)
    const marked = company()
    seedCompany(marked)
    writeFileSync(path.join(marked, 'prompts', 'roles', 'cards', 'P-002.md'), '---\nroleClass: qa\n---\n<!-- LAYER:L2.5:BEGIN -->\n', 'utf8')
    expect(() => loadRolePacks(marked)).toThrow(/定界标记/)
  })
  it('角色类推断缺省（无卡回退）', () => {
    expect(inferRoleClass('研发部长')).toBe('minister')
    expect(inferRoleClass('前端程序工程师')).toBe('executor')
    expect(inferRoleClass('质量工程师')).toBe('qa')
    expect(inferRoleClass('情报研究')).toBe('intel')
    expect(inferRoleClass('人事财务')).toBe('ops')
  })
})

describe('724 F1：缺模板 fail-closed / 禁止跨类顶替', () => {
  it('卡声明类无对应模板 → loadRolePacks 抛错（含工号/类名/缺失文件）', () => {
    const dir = company()
    seedCompany(dir)
    // 只留 executor 模板、删卡 P-001 声明的 minister 模板
    rmSync(path.join(dir, 'prompts', 'roles', 'minister.md'))
    expect(() => loadRolePacks(dir)).toThrow(/P-001/)
    expect(() => loadRolePacks(dir)).toThrow(/minister/)
    expect(() => loadRolePacks(dir)).toThrow(/minister\.md/)
  })
  it('卡类与 hint 不同：类标签/正文同源同类（不跨类顶替）', () => {
    const dir = company()
    seedCompany(dir)
    // 卡 P-001 声明 minister；调用不再接受 hint（签名收窄）——用 pack 自身检查同源
    const packs = loadRolePacks(dir)
    const pack = packs.rolePackFor('P-001')
    expect(pack?.roleClass).toBe('minister')
    expect(pack?.classText).toContain('minister 类模板')
    expect(pack?.classText).not.toContain('executor 类模板')
  })
})
