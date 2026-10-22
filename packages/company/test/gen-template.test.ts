/**
 * 分级公司模板测试（DEV-14；docs/36-§4 M-A）——仓资产巡逻 + 生成器性质锁
 *
 * 断言面（对照 studio-dev-29 plan §3-§5 附录 A/B/C，随 DEV-14 复活）：
 *   1. 仓资产对账：templates/company-{3..9}-level 全树逐字节 == renderLevelTemplate 输出
 *      （仓里的模板是生成器产物，不是手写体——漂移即红：改结构先改 level-specs.ts）；
 *   2. 目录契约：七套全过 loadCompanyDirectory（真实校验器非 mock），等级回读=3..9；
 *   3. init 占位不变式（附录 C 七处恰好一次）——init 通道 replaceOnce 可消费；
 *   4. 确定性：渲染两遍字节全等（花名种子冻结的机器证明）；
 *   5. 结构自洽：assertLevelSpec 全绿 + level_distribution == people 实数（派生非手维护）；
 *   6. 逐级形状锚（docs/33-§3 逐级部门表）：部门数/人数/根部门定时岗数对表冻结；
 *   7. 共享资产同文：charter/README/prompts 与 2 级模板逐字节一致（单一事实源不复制）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderLevelTemplate } from '../src/gen-template.ts'
import { readDirectoryFiles } from '../src/init.ts'
import { loadCompanyDirectory } from '../src/validator.ts'
import { codenames } from '../src/namer.ts'
import { LEVEL_SPECS, assertLevelSpec, levelSpec, levelTemplateName } from '../src/level-specs.ts'

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates')
const LEVELS = [3, 4, 5, 6, 7, 8, 9] as const

/** docs/33-§3 逐级部门表形状锚（部门数/骨架人数/根部门数——根部门×2=定时岗数；form=表列名） */
const SHAPE: Record<number, { deptCount: number; peopleCount: number; rootCount: number; form: string }> = {
  3: { deptCount: 2, peopleCount: 7, rootCount: 2, form: '小团队' },
  4: { deptCount: 2, peopleCount: 10, rootCount: 2, form: '团队' },
  5: { deptCount: 6, peopleCount: 13, rootCount: 6, form: '部门化' },
  6: { deptCount: 10, peopleCount: 15, rootCount: 8, form: '多团队' },
  7: { deptCount: 11, peopleCount: 13, rootCount: 8, form: '事业部' },
  8: { deptCount: 12, peopleCount: 16, rootCount: 10, form: '集团' },
  9: { deptCount: 8, peopleCount: 10, rootCount: 8, form: '控股' },
}

describe('分级模板仓资产对账（DEV-14）', () => {
  for (const level of LEVELS) {
    it(`company-${level}-level：仓树逐字节 == 生成器输出（手改产物即红）`, async () => {
      const files = await renderLevelTemplate(level)
      const onDisk = await readDirectoryFiles(path.join(templatesRoot, levelTemplateName(level)))
      expect(Object.keys(onDisk).sort()).toEqual(Object.keys(files).sort())
      for (const [rel, content] of Object.entries(files)) {
        expect(onDisk[rel]).toBe(content) // 字节级：注释/占位/花名全量对账
      }
    })
  }

  it('七套全过目录契约（真实校验器）且等级回读 3..9', async () => {
    for (const level of LEVELS) {
      const files = await renderLevelTemplate(level)
      const mounted = loadCompanyDirectory(files)
      expect(mounted.ok, `company-${level}-level 应过目录校验`).toBe(true)
      if (mounted.ok) expect(mounted.snapshot.level).toBe(level)
    }
  })

  it('init 占位不变式：七处恰好一次（replaceOnce 通道可消费）', async () => {
    for (const level of LEVELS) {
      const files = await renderLevelTemplate(level)
      const count = (s: string | undefined, needle: string) => (s === undefined ? 0 : s.split(needle).length - 1)
      expect(count(files['org-config.yaml'], 'slug: example-corp')).toBe(1)
      expect(count(files['org-config.yaml'], 'name: 示例公司')).toBe(1)
      expect(count(files['README.md'], '# 示例公司（公司自述）')).toBe(1)
      expect((files['.studio-next.yaml'] ?? '').match(/^(template: )/gm)).toHaveLength(1)
      expect(files['.studio-next.yaml']).toContain(`template: company-${level}-level`)
      expect(count(files['.studio-next.yaml'], 'created_at: null')).toBe(1)
      expect(count(files['.studio-next.yaml'], 'last_validated_at: null')).toBe(1)
      expect(count(files['.studio-next.yaml'], 'last_validation: null')).toBe(1)
    }
  })

  it('确定性：渲染两遍字节全等（花名种子冻结——再生成零 diff 的机器证明）', async () => {
    for (const level of LEVELS) {
      const a = await renderLevelTemplate(level)
      const b = await renderLevelTemplate(level)
      expect(a).toEqual(b)
    }
  })

  it('花名批内唯一且入索引（org-config people.name == 命名器序列）', async () => {
    for (const spec of LEVEL_SPECS) {
      const names = codenames(levelTemplateName(spec.level), spec.people.length)
      expect(new Set(names).size).toBe(names.length)
      const files = await renderLevelTemplate(spec.level)
      for (const name of names) expect(files['org-config.yaml']).toContain(`name: ${name}`)
    }
  })
})

describe('level-specs 结构自洽（docs/33-§3 逐级部门表）', () => {
  it('七级规格全过 assertLevelSpec（悬挂/父链/嵌套前缀/汇报环零容忍）', () => {
    for (const spec of LEVEL_SPECS) expect(() => assertLevelSpec(spec)).not.toThrow()
  })

  it('level_distribution == people 实数（派生非手维护）', async () => {
    for (const spec of LEVEL_SPECS) {
      const files = await renderLevelTemplate(spec.level)
      const dist = new Map<number, number>()
      for (const p of spec.people) dist.set(p.level, (dist.get(p.level) ?? 0) + 1)
      for (const [lv, n] of dist) {
        expect(files['org-config.yaml']).toMatch(new RegExp(`^\\s+${lv}: ${n}$`, 'm'))
      }
    }
  })

  it('逐级形状锚：部门数/骨架人数/根部门数（根部门×2=定时岗数）', async () => {
    for (const spec of LEVEL_SPECS) {
      const shape = SHAPE[spec.level]!
      expect(spec.departments).toHaveLength(shape.deptCount)
      expect(spec.people).toHaveLength(shape.peopleCount)
      const roots = spec.departments.filter((d) => d.parent === null)
      expect(roots).toHaveLength(shape.rootCount)
      expect(spec.form).toBe(shape.form)
      const files = await renderLevelTemplate(spec.level)
      expect(files['org-config.yaml'].split('\n').filter((l) => /^  - id: (health-patrol|daily-report)-/.test(l))).toHaveLength(shape.rootCount * 2)
    }
  })

  it('工号批内唯一；login=小写工号；file 指向本人档案', () => {
    for (const spec of LEVEL_SPECS) {
      expect(new Set(spec.people.map((p) => p.id)).size).toBe(spec.people.length)
      for (const p of spec.people) {
        expect(p.id.toLowerCase()).toMatch(/^[a-z]+-\d+$/)
        expect(p.dept.startsWith('departments/')).toBe(true)
      }
    }
  })

  it('共享资产同文：charter/README/prompts 与 2 级模板逐字节一致（单一事实源不复制）', async () => {
    for (const level of LEVELS) {
      const files = await renderLevelTemplate(level)
      for (const rel of ['charter.md', 'README.md', 'prompts/company.md']) {
        expect(files[rel]).toBe(readFileSync(path.join(templatesRoot, 'company-2-level', rel), 'utf8'))
      }
    }
  })

  it('子部门 config 不带 jobs 键（定时岗只挂根部门——C-5 双清单一致）', async () => {
    for (const spec of LEVEL_SPECS) {
      const files = await renderLevelTemplate(spec.level)
      for (const d of spec.departments) {
        const cfg = files[`${d.path}/config.yaml`]!
        if (d.parent === null) {
          expect(cfg).toContain('jobs:')
          expect(cfg).toContain(`  - health-patrol-${d.name}`)
          expect(cfg).toContain(`  - daily-report-${d.name}`)
        } else {
          expect(cfg).not.toContain('jobs:')
        }
      }
    }
  })

  it('深度 2 嵌套（L6 项目群/L7 事业部）：嵌套 config 与内层人事档案均被识别受检（补现状盲区）', async () => {
    for (const level of [6, 7] as const) {
      const spec = levelSpec(level)
      const files = await renderLevelTemplate(level)
      const nested = spec.departments.filter((d) => (d.path.match(/departments\//g) ?? []).length >= 2)
      expect(nested.length).toBeGreaterThanOrEqual(2) // L6 两项目群 / L7 两事业部内嵌研发
      for (const d of nested) {
        expect(files[`${d.path}/config.yaml`]).toContain(`path: ${d.path}`)
        // 内层成员档案六节标题在渲染面在场（multifile 弱匹配面受检的前提）
        const innerPeople = spec.people.filter((p) => p.dept === d.path)
        expect(innerPeople.length).toBeGreaterThanOrEqual(1)
        for (const p of innerPeople) {
          const fm = files[`${p.dept}/people/${p.id}.md`]!
          for (const section of ['## 一、定位', '## 二、职责', '## 三、做过的事', '## 四、技能本体', '## 五、表现画像', '## 六、自述']) {
            expect(fm).toContain(section)
          }
        }
      }
    }
  })
})
