/**
 * GAP-26 刀B · 单元字段/模板 v2 投影面（定向红→绿）
 *
 * 依据：docs/v2/10 §4.3（SCH-ORG-01 `unitCount`/`units[]`）、docs/v2/06 §5.2/§5.3、
 *       docs/v2/17 §4.5（GAP-V2-17/18 关闭条件）、docs/17-§2/§6（施工/收割）。
 *
 * 断言面（补 #552 刀A 只测投影输入形状之外的字段级承载）：
 *   1. 模板 v2 字段：3-9 级模板 org-config 均有 unitCount/units[]，且与 N 示例同口径；
 *   2. 投影面输出 v2 字段：structure.units.unitCount/units[].vacancyState 直出；
 *   3. 校验器（loadCompanyDirectory）接受 v2 字段，并对 unitCount 不符/域重叠/悬空 headRef fail-closed；
 *   4. 生成器 v2：renderLevelTemplate 输出的 unitCount/units[] 与仓内模板一致（再生成零漂移由旧套件锁）。
 */
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { loadCompanyDirectory } from '../../src/validator.ts'
import { renderLevelTemplate } from '../../src/gen-template.ts'
import { projectOrganization } from '../../src/projection/index.ts'
import type { OrganizationProjectionInput } from '../../src/projection/index.ts'
import { readDirectoryFiles } from '../../src/init.ts'

const TEMPLATES_ROOT = fileURLToPath(new URL('../../../../templates/', import.meta.url))
const LEVELS = [3, 4, 5, 6, 7, 8, 9] as const
const N_EXAMPLE: Record<number, number> = { 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3, 9: 3 }

async function templateFiles(level: number): Promise<Record<string, string>> {
  return readDirectoryFiles(`${TEMPLATES_ROOT}/company-${level}-level`)
}

function projectOf(org: Record<string, unknown>) {
  return projectOrganization({ org } as unknown as OrganizationProjectionInput)
}

describe('单元字段 v2 · 模板投影面（GAP-V2-17 字段方案）', () => {
  for (const level of LEVELS) {
    it(`company-${level}-level：unitCount=${N_EXAMPLE[level]!} 且 units[] 同口径，投影输出 v2 字段`, async () => {
      const n = N_EXAMPLE[level]!
      const files = await templateFiles(level)
      const raw = parseYaml(files['org-config.yaml'] ?? '') as Record<string, unknown>
      expect(raw['unitCount']).toBe(n)
      expect(Array.isArray(raw['units']) ? raw['units'].length : -1).toBe(n)
      const out = projectOf(raw)
      expect(out.status, JSON.stringify(out.issues.filter((i) => i.blocking))).toBe('ok')
      expect(out.structure.units.unitCount).toBe(n)
      expect(out.structure.units.count).toBe(n)
      expect(out.structure.units.units).toHaveLength(n)
      for (const unit of out.structure.units.units) {
        expect(typeof unit.unitId).toBe('string')
        expect(unit.domain.length).toBeGreaterThan(0)
        expect(unit.vacancyState === null || unit.vacancyState === 'staffed' || unit.vacancyState === 'head-vacant').toBe(true)
      }
    })
  }

  it('生成器 v2：renderLevelTemplate 输出 unitCount/units[]（不再生成 v1 结构）', async () => {
    const files = await renderLevelTemplate(7)
    const raw = parseYaml(files['org-config.yaml'] ?? '') as Record<string, unknown>
    expect(raw['unitCount']).toBe(2)
    const units = raw['units'] as Array<{ unitId: string; domain: string[]; headRef: string | null; vacancyState?: string }>
    expect(units.map((u) => u.unitId)).toEqual(['unit-1', 'unit-2'])
    expect(units.every((u) => u.headRef !== null && u.vacancyState === 'staffed')).toBe(true)
    expect(files['org-config.yaml']).toContain('schema: studio-next/org@1')
    expect(files['org-config.yaml']).not.toContain('dept.level = 公司等级')
  })
})

describe('单元字段 v2 · 校验器 fail-closed（不改 #552 刀A 形状闸）', () => {
  it('合法模板过目录校验；unitCount 与 units.length 不符 → org-config/unit-count-mismatch', async () => {
    const files = await templateFiles(3)
    expect(loadCompanyDirectory(files).ok).toBe(true)
    const src = files['org-config.yaml'] ?? ''
    const mutated = { ...files, 'org-config.yaml': src.replace('unitCount: 1', 'unitCount: 2') }
    const result = loadCompanyDirectory(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.rule)).toContain('org-config/unit-count-mismatch')
  })

  it('unitCount>1 但未声明 units[] → 拒（不虚构单元）', async () => {
    const files = await templateFiles(3)
    const src = files['org-config.yaml'] ?? ''
    const mutated = { ...files, 'org-config.yaml': src.replace(/^units:\n(?: {2,}.*\n)+/m, '').replace('unitCount: 1', 'unitCount: 2') }
    const result = loadCompanyDirectory(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.rule)).toContain('org-config/unit-count-mismatch')
  })

  it('域跨单元重叠 → org-config/unit-domain-overlap', async () => {
    const files = await templateFiles(7)
    const src = files['org-config.yaml'] ?? ''
    // L7 两单元域分别为 [人事] / [财务]；把第二单元域改成 [人事] 制造重叠
    const mutated = { ...files, 'org-config.yaml': src.replace('domain: [财务]', 'domain: [人事]') }
    const result = loadCompanyDirectory(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.rule)).toContain('org-config/unit-domain-overlap')
  })

  it('headRef 非 null 与 vacancyState=head-vacant 互斥 → org-config/unit-head-state-conflict', async () => {
    const files = await templateFiles(7)
    const src = files['org-config.yaml'] ?? ''
    const mutated = { ...files, 'org-config.yaml': src.replace('vacancyState: staffed', 'vacancyState: head-vacant') }
    const result = loadCompanyDirectory(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.rule)).toContain('org-config/unit-head-state-conflict')
  })

  it('headRef 悬空 → org-config/unit-head-unresolved', async () => {
    const files = await templateFiles(7)
    const src = files['org-config.yaml'] ?? ''
    const mutated = { ...files, 'org-config.yaml': src.replace('headRef: HR-0', 'headRef: NOPE-9') }
    const result = loadCompanyDirectory(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map((i) => i.rule)).toContain('org-config/unit-head-unresolved')
  })

  it('模板再生成逐字节等值（3-9，防 v1 覆盖 v2）', async () => {
    for (const level of LEVELS) {
      const files = await renderLevelTemplate(level)
      const onDisk = await readDirectoryFiles(`${TEMPLATES_ROOT}/company-${level}-level`)
      expect(onDisk).toEqual(files)
    }
  })
})
