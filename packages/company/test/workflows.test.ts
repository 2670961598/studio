/**
 * workflows 类型声明契约单测（DEV-43，docs/51 v1.1 B-1 `workflows:` 段 / W-1..W-9）。
 * 分支覆盖目标：每条 W 规则至少一例命中+一例不命中；快照映射（toWorkflows 规范化）
 * 与 deriveFieldProvision 折叠（typeInbox/typeFlows/entities）各断言形状。
 *
 * 夹具=模板 company-2-level 伴生件（charter/.studio-next/部门 config/人事档案）+
 * 本套拼装的 org-config.yaml（workflows 段可注入）——合法基线全绿才谈规则命中。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCompanyDirectory } from '../src/index.ts'
import { deriveFieldProvision } from '../src/git-import.ts'
import type { TicketWorkflows } from '@studio-next/contract'

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

/** 合法基线：探索单（无 entity·双终态·重开边）——e2e/demo 同源 */
const LEGAL_SPIKE = `workflows:
  types:
    - id: spike
      states:
        - name: 待探索
        - name: 探索中
        - name: 探索结论就绪
        - name: 复验通过
        - name: 已归档
          final: true
        - name: 不予归档
          final: true
      edges:
        - from: 已归档
          to: 待探索
      anchors:
        inbox: 待探索
        dispatched: 探索中
        evidence: 探索结论就绪
        verified: 复验通过
        delivered: 已归档
`

/** 合法基线：缺陷单（entity: issue·审批环·W-8 形状：delivered=首终态，截断后无声明态） */
const LEGAL_DEFECT = `    - id: defect
      entity: issue
      states:
        - name: 新建
        - name: 待批
        - name: 修复中
        - name: 待复验
        - name: 已修复
        - name: 已关闭
          final: true
      edges:
        - from: 待复验
          to: 修复中
      anchors:
        inbox: 新建
        approval: 待批
        dispatched: 修复中
        evidence: 待复验
        verified: 已修复
        delivered: 已关闭
`

function dirWith(workflows: string): Record<string, string> {
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n${COMPANY}${workflows}${TAIL}`,
    'charter.md': tpl('charter.md'),
    '.studio-next.yaml': tpl('.studio-next.yaml'),
    'departments/工程部/config.yaml': tpl('departments/工程部/config.yaml'),
    'departments/工程部/people/AGENT-1.md': tpl('departments/工程部/people/AGENT-1.md'),
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

describe('合法声明过闸（W-1..W-9 全绿基线）', () => {
  it('spike+defect 双类型全过（含 entity/审批环/双终态/重开边）', () => {
    const r = loadOk(dirWith(`${LEGAL_SPIKE}${LEGAL_DEFECT}`))
    expect(r.snapshot.workflows?.types.map((t) => t.id)).toEqual(['spike', 'defect'])
  })

  it('无 workflows 段：快照无键（D9 现状形状字节不变）', () => {
    const r = loadOk(dirWith(''))
    expect(r.snapshot.workflows).toBeUndefined()
  })

  it('快照规范化：states 升对象（final 缺省剥离）、edges/anchors 原样、entity 可选', () => {
    const r = loadOk(dirWith(`${LEGAL_SPIKE}${LEGAL_DEFECT}`))
    const wf = r.snapshot.workflows
    expect(wf?.types[0]).toMatchObject({
      id: 'spike',
      states: [
        { name: '待探索' },
        { name: '探索中' },
        { name: '探索结论就绪' },
        { name: '复验通过' },
        { name: '已归档', final: true },
        { name: '不予归档', final: true },
      ],
      edges: [{ from: '已归档', to: '待探索' }],
      anchors: { inbox: '待探索', dispatched: '探索中', evidence: '探索结论就绪', verified: '复验通过', delivered: '已归档' },
    })
    expect(wf?.types[1]?.entity).toBe('issue')
    expect(wf?.types[1]?.anchors.approval).toBe('待批')
  })
})

describe('W-1 类型清单形状', () => {
  it('id 含冒号 → workflow-bad-type-id（T: 键语法保留字面冲突）', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('- id: spike', '- id: sp:ike')))
    expect(rules).toContain('org-config/workflow-bad-type-id')
  })

  it('id 重复 → workflow-dup-type-id', () => {
    const rules = rulesOf(dirWith(`${LEGAL_SPIKE}${LEGAL_DEFECT.replace('- id: defect', '- id: spike')}`))
    expect(rules).toContain('org-config/workflow-dup-type-id')
  })

  it('空 types 数组 → schema 层拒绝（types min 1）', () => {
    const rules = rulesOf(dirWith('workflows:\n  types: []\n'))
    expect(rules.some((x) => x.includes('workflow'))).toBe(true)
  })

  it('缺 id → schema 层拒绝', () => {
    const rules = rulesOf(
      dirWith('workflows:\n  types:\n    - states:\n        - name: a\n        - name: b\n      anchors: { inbox: a, dispatched: b, evidence: b, verified: b, delivered: b }\n'),
    )
    expect(rules.some((x) => x.includes('workflow'))).toBe(true)
  })
})

describe('W-2 状态集', () => {
  it('重名态 → workflow-dup-state', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('        - name: 探索中\n', '        - name: 待探索\n')))
    expect(rules).toContain('org-config/workflow-dup-state')
  })

  it('少于两态 → schema 层拒绝', () => {
    const rules = rulesOf(
      dirWith('workflows:\n  types:\n    - id: one\n      states:\n        - name: 唯一态\n      anchors: { inbox: 唯一态, dispatched: 唯一态, evidence: 唯一态, verified: 唯一态, delivered: 唯一态 }\n'),
    )
    expect(rules.some((x) => x.includes('workflow'))).toBe(true)
  })

  it('空名态 → schema 层拒绝', () => {
    const rules = rulesOf(
      dirWith('workflows:\n  types:\n    - id: e\n      states:\n        - name: ""\n        - name: b\n      anchors: { inbox: b, dispatched: b, evidence: b, verified: b, delivered: b }\n'),
    )
    expect(rules.some((x) => x.includes('workflow'))).toBe(true)
  })
})

describe('W-3 锚点成员性 + W-8 主干邻接链', () => {
  it('锚点不在状态集 → workflow-anchor-not-in-states', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('        inbox: 待探索\n', '        inbox: 不在场\n')))
    expect(rules).toContain('org-config/workflow-anchor-not-in-states')
  })

  it('inbox 非 states[0] → workflow-inbox-not-first', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('        inbox: 待探索\n', '        inbox: 探索中\n')))
    expect(rules).toContain('org-config/workflow-inbox-not-first')
  })

  it('approval 不在状态集 → workflow-anchor-not-in-states（approval 参与成员校验）', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE + LEGAL_DEFECT.replace('        approval: 待批\n', '        approval: 不在场\n')))
    expect(rules).toContain('org-config/workflow-anchor-not-in-states')
  })

  it('五锚主干断裂（evidence→verified 间插非锚声明态）→ workflow-anchor-chain', () => {
    const broken = LEGAL_SPIKE.replace('        - name: 复验通过\n', '        - name: 插队态\n        - name: 复验通过\n')
    const rules = rulesOf(dirWith(broken))
    expect(rules).toContain('org-config/workflow-anchor-chain')
  })
})

describe('W-4 delivered 终态', () => {
  it('delivered 非 final → workflow-delivered-not-final', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('        - name: 已归档\n          final: true\n', '        - name: 已归档\n')))
    expect(rules).toContain('org-config/workflow-delivered-not-final')
  })
})

describe('W-6 边端点成员性 + 去重', () => {
  it('边端点不在状态集 → workflow-edge-not-in-states', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('        - from: 已归档\n          to: 待探索\n', '        - from: 已归档\n          to: 不在场\n')))
    expect(rules).toContain('org-config/workflow-edge-not-in-states')
  })

  it('重复边对 → workflow-dup-edge', () => {
    const rules = rulesOf(
      dirWith(LEGAL_SPIKE.replace('      edges:\n        - from: 已归档\n          to: 待探索\n', '      edges:\n        - from: 已归档\n          to: 待探索\n        - from: 已归档\n          to: 待探索\n')),
    )
    expect(rules).toContain('org-config/workflow-dup-edge')
  })
})

describe('W-7 实体名', () => {
  it('entity 非 slug 段语法 → workflow-bad-entity（值域枚举闸在平台侧 provision——判定器平台中立）', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE + LEGAL_DEFECT.replace('      entity: issue\n', '      entity: e pic\n')))
    expect(rules).toContain('org-config/workflow-bad-entity')
  })
})

describe('W-9 保留词', () => {
  it('id=bug → workflow-reserved-type-id', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('- id: spike', '- id: bug')))
    expect(rules).toContain('org-config/workflow-reserved-type-id')
  })

  it('id=task → workflow-reserved-type-id（岗单实体名占位）', () => {
    const rules = rulesOf(dirWith(LEGAL_SPIKE.replace('- id: spike', '- id: task')))
    expect(rules).toContain('org-config/workflow-reserved-type-id')
  })
})

// ————————————————— deriveFieldProvision 折叠（平台面契约） —————————————————

describe('deriveFieldProvision（git-import 平台折叠）', () => {
  it('workflows 缺席 → 三键旧形状原样（D9 字节不变）', () => {
    const map = deriveFieldProvision(undefined as never, undefined)
    expect(Object.keys(map).sort()).toEqual(['fields', 'stateFlow', 'states'])
  })

  it('typeInbox/typeFlows/entities 折叠：entity 态入实体桶、无 entity 态入顶层', () => {
    const wf = loadOk(dirWith(`${LEGAL_SPIKE}${LEGAL_DEFECT}`)).snapshot.workflows as TicketWorkflows
    const map = deriveFieldProvision(undefined as never, wf)
    expect(map.typeInbox).toEqual({ spike: '待探索', defect: '新建' })
    // spike 主干前向（终态截断）：复验通过→[已归档]（不予归档被截）；已归档 声明边→待探索
    expect(map.typeFlows?.spike).toMatchObject({ 待探索: ['探索中'], 复验通过: ['已归档'], 已归档: ['待探索'] })
    // defect 审批环：主干邻接（新建→待批、待复验→已修复、已修复→已关闭）+ 打回声明边（待复验→修复中 并存）
    expect(map.typeFlows?.defect).toMatchObject({ 新建: ['待批'], 待复验: ['已修复', '修复中'], 已修复: ['已关闭'] })
    expect(map.entities).toEqual({ issue: { states: ['新建', '待批', '修复中', '待复验', '已修复', '已关闭'] } })
    // D7 分桶：spike（无 entity）折入顶层 states；defect（entity:issue）不落顶层
    expect(map.states).toContain('待探索')
    expect(map.states).not.toContain('新建')
  })
})
