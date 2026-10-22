/**
 * groups 组群声明契约单测（130-P3 频道供给扩展，130 提案 §6.7.1/C4 `groups:` 段）。
 * 分支覆盖目标：G 规则每条至少一例命中+一例不命中；快照装载（toSnapshot）形状
 * （members 显式清单、leader 可选键不落显式 undefined）；缺段=快照无键（现状字节不变）。
 *
 * 夹具=模板 company-2-level 伴生件（同 workflows.test.ts 先例）——合法基线全绿才谈规则命中。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCompanyDirectory } from '../src/index.ts'

const TPL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/company-2-level')
const tpl = (f: string): string => readFileSync(path.join(TPL, f), 'utf8')

const COMPANY = `  name: 演示公司
  slug: demo-corp
  charter_ref: charter.md
  level: 2
  level_distribution:
    2: 1
`

const TAIL = `departments:
  - name: 工程部
    path: departments/工程部
    leader: AGENT-1
    level: 2
    parent: null
    lanes: [core]
    functions: [交付]
people:
  - id: AGENT-1
    name: 演示工程师
    login: agent-1
    level: 2
    dept: departments/工程部
`

/** 合法基线：一组（组长=成员） */
const LEGAL_GROUPS = `groups:
  - id: core
    dept: departments/工程部
    name: 工程部-核心组
    leader: AGENT-1
    members: [AGENT-1]
`

function dirWith(groups: string): Record<string, string> {
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n${COMPANY}${groups}${TAIL}`,
    'charter.md': tpl('charter.md'),
    '.studio-next.yaml': tpl('.studio-next.yaml'),
    'departments/工程部/config.yaml': tpl('departments/工程部/config.yaml'),
    'departments/工程部/people/AGENT-1.md': tpl('departments/工程部/people/AGENT-1.md'),
  }
}

const TAIL_TWO = `departments:
  - name: 工程部
    path: departments/工程部
    leader: AGENT-1
    level: 2
    parent: null
    lanes: [core]
    functions: [交付]
people:
  - id: AGENT-1
    name: 演示工程师
    login: agent-1
    level: 2
    dept: departments/工程部
  - id: AGENT-2
    name: 演示工程师二
    login: agent-2
    level: 2
    dept: departments/工程部
`

function dirWithTwo(groups: string): Record<string, string> {
  // AGENT-2 档案=AGENT-1 模板文本替换（front-matter 锚点 id/name/login 三键全换）；
  // level_distribution 2:2（两人都 level 2——level-count-mismatch 不混入本测断言面）
  const agent2 = tpl('departments/工程部/people/AGENT-1.md')
    .replaceAll('AGENT-1', 'AGENT-2')
    .replaceAll('agent-1', 'agent-2')
    .replaceAll('示例工程师', '示例工程师二')
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n${COMPANY.replace('    2: 1', '    2: 2')}${groups}${TAIL_TWO}`,
    'charter.md': tpl('charter.md'),
    '.studio-next.yaml': tpl('.studio-next.yaml'),
    'departments/工程部/config.yaml': tpl('departments/工程部/config.yaml'),
    'departments/工程部/people/AGENT-1.md': tpl('departments/工程部/people/AGENT-1.md'),
    'departments/工程部/people/AGENT-2.md': agent2,
  }
}

function rulesOf(files: Record<string, string>): string[] {
  const r = loadCompanyDirectory(files)
  expect(r.ok).toBe(false)
  if (!r.ok) return r.issues.map((i) => i.rule)
  return []
}

function loadOk(files: Record<string, string>) {
  const r = loadCompanyDirectory(files)
  expect(r.ok).toBe(true)
  if (r.ok) return r
  throw new Error('unreachable')
}

describe('合法声明过闸＋快照装载', () => {
  it('合法组（组长=成员）全过；snapshot.groups 形状（id/dept/name/leader/members）', () => {
    const r = loadOk(dirWith(LEGAL_GROUPS))
    expect(r.snapshot.groups).toEqual([
      { id: 'core', dept: 'departments/工程部', name: '工程部-核心组', leader: 'AGENT-1', members: ['AGENT-1'] },
    ])
  })

  it('组长未声明：leader 键不落快照（显式 undefined 剥离——同 status/role 扩法）', () => {
    const r = loadOk(dirWith(LEGAL_GROUPS.replace('    leader: AGENT-1\n', '')))
    expect(r.snapshot.groups).toEqual([
      { id: 'core', dept: 'departments/工程部', name: '工程部-核心组', members: ['AGENT-1'] },
    ])
  })

  it('无 groups 段：快照无键（现状形状字节不变）', () => {
    const r = loadOk(dirWith(''))
    expect(r.snapshot.groups).toBeUndefined()
  })
})

describe('组条目结构形状（schema 层）', () => {
  it('id 非 slug 段语法 → schema 层拒绝（频道别名段 #<slug>-<部门slug>-<组id> 语法闸）', () => {
    const rules = rulesOf(dirWith(LEGAL_GROUPS.replace('- id: core', '- id: 核心组')))
    expect(rules.some((x) => x.includes('group') || x.includes('schema'))).toBe(true)
  })

  it('空 members → schema 层拒绝（组=显式清单，min 1）', () => {
    const rules = rulesOf(dirWith(LEGAL_GROUPS.replace('members: [AGENT-1]', 'members: []')))
    expect(rules.some((x) => x.includes('group') || x.includes('schema'))).toBe(true)
  })

  it('未知键 → strictObject 拒绝（不静默收额外面）', () => {
    const rules = rulesOf(dirWith(LEGAL_GROUPS.replace('    name: 工程部-核心组\n', '    name: 工程部-核心组\n    extra: 1\n')))
    expect(rules.length).toBeGreaterThan(0)
  })
})

describe('引用完整性（crossRules 指认到行）', () => {
  it('dept 不在 departments 索引 → dangling-ref', () => {
    const rules = rulesOf(dirWith(LEGAL_GROUPS.replace('dept: departments/工程部', 'dept: departments/不存在')))
    expect(rules).toContain('org-config/dangling-ref')
  })

  it('成员工号不在 people 索引 → dangling-ref', () => {
    const rules = rulesOf(dirWith(LEGAL_GROUPS.replace('members: [AGENT-1]', 'members: [GHOST-9]')))
    expect(rules).toContain('org-config/dangling-ref')
  })

  it('组长不在成员清单 → group-leader-not-member（组长须进群——§6.7.1 成员列）', () => {
    const rules = rulesOf(dirWithTwo(`groups:
  - id: core
    dept: departments/工程部
    name: 工程部-核心组
    leader: AGENT-2
    members: [AGENT-1]
`))
    expect(rules).toEqual(['org-config/group-leader-not-member'])
  })

  it('(dept,id) 重复 → group-duplicate-id（同部门内 id 须唯一）', () => {
    const dup = dirWith(`${LEGAL_GROUPS}  - id: core
    dept: departments/工程部
    name: 工程部-重复组
    members: [AGENT-1]
`)
    expect(rulesOf(dup)).toContain('org-config/group-duplicate-id')
  })
})
