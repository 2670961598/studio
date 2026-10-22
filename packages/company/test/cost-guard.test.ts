/**
 * cost_guard 段测试（132-§6.4 单C·studio-dev-177；批示 P1/P2 载体=132 提案全批）：
 * org-config cost_guard 段 + people.cost_caps 的校验面与快照装载面。
 * 覆盖：
 *   - 好段：四档样例（132 §6.4 定稿表直译）过验 + 快照 snake→camel 映射；
 *   - 段缺省=面关（快照 costGuard 无键——现状零变化）；
 *   - CG-1 tier 唯一 / CG-2 at_pct 唯一 / CG-3 route='gate' 至多一档（逐条指认文件:行）；
 *   - 结构闸：坏 route（词表外）/daily_budget_usd 缺键/未知键/空 alert_tiers 拒；
 *   - people cost_caps：人档覆盖帽装载 + 坏值拒。
 */
import { describe, expect, it } from 'vitest'
import { loadCompanyDirectory } from '../src/index.ts'

const COST_GUARD_SECTION = `cost_guard:\n  daily_budget_usd:\n    company: 25\n    per_person_default: 8\n  alert_tiers:\n    - { tier: watch, at_pct: 50, route: notify }\n    - { tier: warn, at_pct: 80, route: dispatch }\n    - { tier: alarm, at_pct: 100, route: dispatch+notify }\n    - { tier: hard, at_pct: 120, route: gate }\n`

function files(extraPersonFields = '', costGuard = COST_GUARD_SECTION): Record<string, string> {
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n  name: 演示公司\n  slug: demo-corp\n  charter_ref: charter.md\n  level: 2\n  level_distribution:\n    2: 1\ndepartments:\n  - name: 工程部\n    path: departments/工程部\n    leader: AGENT-1\n    level: 2\n    parent: null\n    lanes: [core]\n    functions: [交付]\npeople:\n  - id: AGENT-1\n    name: 演示工程师\n    login: agent-1\n    level: 2\n    dept: departments/工程部\n${extraPersonFields}${costGuard}`,
    'charter.md': '# 演示公司章程\n',
    '.studio-next.yaml': 'schema: org-config/v1\ntemplate: company-2-level\ncreated_at: null\nlast_validated_at: null\nlast_validation: null\nframework_version: null\n',
    'departments/工程部/config.yaml': 'name: 工程部\npath: departments/工程部\nlevel: 2\nparent: null\nleader: AGENT-1\nfunctions: [交付]\nlanes: [core]\nreports_to: null\nrules: []\nrelations: []\n',
    'departments/工程部/people/AGENT-1.md': `---\nid: AGENT-1\nname: 演示工程师\nlogin: agent-1\nlevel: 2\ndept: departments/工程部\nrole: 工程负责人\n---\n# AGENT-1 · 演示工程师\n\n## 一、定位\n\n工程负责人。\n\n## 二、职责\n\n- 交付\n\n## 三、做过的事（事实段 · 系统机械归集）\n\n（待回填）\n\n## 四、技能本体\n\n- typescript\n\n## 五、表现画像\n\n（待评价）\n\n## 六、自述\n\n（本人写）\n`,
  }
}

describe('cost_guard 段：好段与快照装载（132-§6.4 定稿表直译）', () => {
  it('四档样例过验 + 快照映射（snake→camel；route 词表含 dispatch+notify）', () => {
    const r = loadCompanyDirectory(files())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.costGuard).toEqual({
      dailyBudgetUsd: { company: 25, perPersonDefault: 8 },
      alertTiers: [
        { tier: 'watch', atPct: 50, route: 'notify' },
        { tier: 'warn', atPct: 80, route: 'dispatch' },
        { tier: 'alarm', atPct: 100, route: 'dispatch+notify' },
        { tier: 'hard', atPct: 120, route: 'gate' },
      ],
    })
  })

  it('段缺省=面关（快照无 costGuard 键——现状零变化）', () => {
    const r = loadCompanyDirectory(files('', ''))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('costGuard' in r.snapshot).toBe(false)
  })

  it('people cost_caps：人档覆盖帽装载（daily_usd 覆盖 per_person_default）', () => {
    const r = loadCompanyDirectory(files('    cost_caps:\n      daily_usd: 12\n'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.people[0]?.costCaps).toEqual({ dailyUsd: 12 })
  })

  it('people cost_caps：非正数拒（结构闸）', () => {
    const r = loadCompanyDirectory(files('    cost_caps:\n      daily_usd: 0\n'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.rule.startsWith('org-config/'))).toBe(true)
  })
})

describe('cost_guard 段：内容规则 CG-1..CG-3（132-§6.4 单C）', () => {
  it('CG-1 tier 重复 → cost-guard-dup-tier 指认到重复档行', () => {
    const bad = COST_GUARD_SECTION.replace('- { tier: warn, at_pct: 80, route: dispatch }', '- { tier: watch, at_pct: 80, route: dispatch }')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
    if (r.ok) return
    const issue = r.issues.find((i) => i.rule === 'org-config/cost-guard-dup-tier')
    expect(issue).toBeDefined()
    expect(issue?.line).toBeGreaterThan(0)
  })

  it('CG-2 at_pct 重复 → cost-guard-dup-pct', () => {
    const bad = COST_GUARD_SECTION.replace('- { tier: warn, at_pct: 80, route: dispatch }', '- { tier: warn, at_pct: 50, route: dispatch }')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.rule === 'org-config/cost-guard-dup-pct')).toBe(true)
  })

  it('CG-3 route=gate 两档 → cost-guard-multi-gate（hard 联动锚唯一）', () => {
    const bad = COST_GUARD_SECTION.replace('- { tier: alarm, at_pct: 100, route: dispatch+notify }', '- { tier: alarm, at_pct: 100, route: gate }')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.some((i) => i.rule === 'org-config/cost-guard-multi-gate')).toBe(true)
  })

  it('单 gate 档=合法（hard 样例本身不误伤）', () => {
    const r = loadCompanyDirectory(files())
    expect(r.ok).toBe(true)
  })
})

describe('cost_guard 段：结构闸（strictObject 词表）', () => {
  it('坏 route（词表外）拒', () => {
    const bad = COST_GUARD_SECTION.replace('route: notify }', 'route: pager-duty }')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
  })

  it('daily_budget_usd 缺 per_person_default 拒', () => {
    const bad = COST_GUARD_SECTION.replace('    per_person_default: 8\n', '')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
  })

  it('未知键拒（org-config 同纪律）', () => {
    const bad = COST_GUARD_SECTION.replace('alert_tiers:\n', 'monthly_budget_usd: 500\n  alert_tiers:\n')
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
  })

  it('空 alert_tiers 拒（至少一档）', () => {
    const bad = COST_GUARD_SECTION.slice(0, COST_GUARD_SECTION.indexOf('  alert_tiers:')) + '  alert_tiers: []\n'
    const r = loadCompanyDirectory(files('', bad))
    expect(r.ok).toBe(false)
  })
})
