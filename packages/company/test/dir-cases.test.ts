/**
 * dir 域契约 + 校验器定位单测（docs/04-§二/§九；契约语料 packages/contract/cases.json）
 * 分工（CASES.md）：契约 case 断言语义（规则命中）；本套单测断言**位置**（文件:行）。
 */
import { describe, expect, it } from 'vitest'
import { runCases } from '@studio-next/contract'
import { dirSubject, loadCompanyDirectory } from '../src/index.ts'
import manifest from '../../contract/cases.json'

describe('dir 域契约（语义）', () => {
  it('3 条 dir case 全绿', async () => {
    const r = await runCases(manifest, { dir: dirSubject }, { domains: ['dir'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(3)
    expect(r.passed).toBe(3)
  })
})

describe('校验器定位（文件:行）', () => {
  const base = (companyBlock: string) =>
    `schema: org-config/v1\ncompany:\n${companyBlock}\ndepartments:\n  - name: 工程部\n    path: departments/工程部\n    leader: AGENT-1\n    level: 2\n    parent: null\n    lanes: [core]\n    functions: [交付]\npeople:\n  - id: AGENT-1\n    name: 演示工程师\n    login: agent-1\n    level: 2\n    dept: departments/工程部\n`

  it('缺 charter_ref → 定位到 company 块起始行（第 3 行）', () => {
    const files = { 'org-config.yaml': base('  name: 演示公司\n  slug: demo-corp\n  level: 2\n  level_distribution:\n    2: 1\n') }
    const r = loadCompanyDirectory(files)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.rule.startsWith('org-config/missing-field'))
      expect(issue).toBeDefined()
      expect(issue?.line).toBe(3) // 'company:' 键所在行
      expect(issue?.fix).toBeTruthy()
    }
  })

  it('等级分布不符 → 定位到 level_distribution 块（第 8 行）', () => {
    const files = { 'org-config.yaml': base('  name: 演示公司\n  slug: demo-corp\n  charter_ref: charter.md\n  level: 2\n  level_distribution:\n    2: 2\n') }
    const r = loadCompanyDirectory(files)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.rule === 'org-config/level-count-mismatch')
      expect(issue).toBeDefined()
      expect(issue?.line).toBe(8) // 'level_distribution:' 键所在行
    }
  })

  it('悬空 leader 引用 → 定位到该 leader 属性行', () => {
    const yaml = `schema: org-config/v1\ncompany:\n  name: 演示公司\n  slug: demo-corp\n  charter_ref: charter.md\n  level: 2\n  level_distribution:\n    2: 1\ndepartments:\n  - name: 工程部\n    path: departments/工程部\n    leader: AGENT-9\n    level: 2\n    parent: null\n    lanes: [core]\n    functions: [交付]\npeople:\n  - id: AGENT-1\n    name: 演示工程师\n    login: agent-1\n    level: 2\n    dept: departments/工程部\n`
    const r = loadCompanyDirectory({ 'org-config.yaml': yaml })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.rule === 'org-config/dangling-ref')
      expect(issue).toBeDefined()
      expect(issue?.line).toBe(12) // 'leader: AGENT-9' 行（重数修正）
    }
  })

  it('YAML 语法错误 → 定位到出错行', () => {
    const r = loadCompanyDirectory({ 'org-config.yaml': 'schema: org-config/v1\ncompany: [\n' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues[0]?.rule).toBe('org-config/yaml-syntax')
      expect(r.issues[0]?.line).toBeGreaterThanOrEqual(2)
    }
  })

  it('缺 org-config.yaml 文件 → 文件级报错', () => {
    const r = loadCompanyDirectory({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.rule).toBe('org-config/missing-file')
  })
})
