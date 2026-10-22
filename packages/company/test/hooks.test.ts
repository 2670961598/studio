/**
 * hooks 事件钩子声明契约单测（129-C，129-§6.1① / §6.3 P0-A `hooks:` 段）。
 * 分支覆盖目标：结构闸（空路由表拒/未知键拒）+ 悬空检（route 目标工号不在册 →
 * 指认到行）+ 快照装载形状 + 缺段=快照无键（现状字节不变）；类型键值域不在此测
 * （归引擎路由闸 fail-closed——129-A 纪律，company 不复制 HR_EVENT_KINDS）。
 *
 * 夹具=模板 company-2-level 伴生件（groups.test.ts 先例）。
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

/** 合法基线：七类型全路由（P0-A 建议口径的模板形态） */
const LEGAL_HOOKS = `hooks:
  data_change:
    routes:
      入: AGENT-1
      调: AGENT-1
      退: AGENT-1
      升: AGENT-1
      降: AGENT-1
      停: AGENT-1
      复: AGENT-1
`

function dirWith(hooks: string): Record<string, string> {
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n${COMPANY}${hooks}${TAIL}`,
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

describe('合法声明过闸＋快照装载', () => {
  it('七类型全路由过闸；snapshot.hooks 形状（routes 键序=声明序）', () => {
    const r = loadOk(dirWith(LEGAL_HOOKS))
    expect(r.snapshot.hooks).toEqual({
      data_change: { routes: { 入: 'AGENT-1', 调: 'AGENT-1', 退: 'AGENT-1', 升: 'AGENT-1', 降: 'AGENT-1', 停: 'AGENT-1', 复: 'AGENT-1' } },
    })
  })

  it('部分路由（只配入/升）同样过闸——路由表无全七值义务（未配类型=引擎「未命中」明报拒收）', () => {
    const r = loadOk(dirWith(`hooks:
  data_change:
    routes:
      入: AGENT-1
      升: AGENT-1
`))
    expect(r.snapshot.hooks).toEqual({ data_change: { routes: { 入: 'AGENT-1', 升: 'AGENT-1' } } })
  })

  it('hooks 声明而 data_change 缺：snapshot.hooks={}（空对象——装载不猜默认）', () => {
    const r = loadOk(dirWith('hooks: {}\n'))
    expect(r.snapshot.hooks).toEqual({})
  })

  it('无 hooks 段：快照无键（现状形状字节不变）', () => {
    const r = loadOk(dirWith(''))
    expect(r.snapshot.hooks).toBeUndefined()
  })
})

describe('结构形状（schema 层）', () => {
  it('空路由表 → schema 层拒绝（声明即哑火=装载面明报）', () => {
    const rules = rulesOf(dirWith(`hooks:
  data_change:
    routes: {}
`))
    expect(rules.length).toBeGreaterThan(0)
  })

  it('未知键 → strictObject 拒绝（不静默收额外面）', () => {
    const rules = rulesOf(dirWith(LEGAL_HOOKS.replace('hooks:\n', 'hooks:\n  extra: 1\n')))
    expect(rules.length).toBeGreaterThan(0)
  })

  it('空工号值 → schema 层拒绝（路由目标必须非空串）', () => {
    const rules = rulesOf(dirWith(`hooks:
  data_change:
    routes:
      入: ""
`))
    expect(rules.length).toBeGreaterThan(0)
  })
})

describe('引用完整性（crossRules 指认到行）', () => {
  it('route 目标工号不在 people 索引 → dangling-ref（错派比拒收危害大，装载面先挡）', () => {
    const rules = rulesOf(dirWith(LEGAL_HOOKS.replace('      入: AGENT-1', '      入: GHOST-9')))
    expect(rules).toContain('org-config/dangling-ref')
  })

  it('悬空指认到行：line 对应 org-config.yaml 的 routes 键行', () => {
    const r = loadCompanyDirectory(dirWith(LEGAL_HOOKS.replace('      退: AGENT-1', '      退: GHOST-9')))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const hit = r.issues.find((i) => i.rule === 'org-config/dangling-ref')
      expect(hit?.file).toBe('org-config.yaml')
      expect(hit?.line).toBeGreaterThan(1)
      expect(hit?.fix).toContain('退')
      expect(hit?.fix).toContain('GHOST-9')
    }
  })
})
