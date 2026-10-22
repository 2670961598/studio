/**
 * state-hygiene —— 州表卫生双层声明契约单测（127-C，studio-dev-127 §4.7 制作人
 * 2026-10-22 全批）。
 *
 * 分支覆盖目标：SH-1..SH-5 每条至少一例命中+一例不命中；合法双层声明全绿且快照
 * 装载（knownForeignStates/stateMapping）形状断言；面关（不声明=零行为）负对照。
 *
 * 夹具=模板 company-2-level 伴生件（workflows.test.ts 同法）+ yt 段可注入的
 * org-config.yaml——合法基线全绿才谈规则命中。
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

/** 合法白名单（六英文态全量——生产语义同款） */
const WHITELIST = `yt:
  project: DEMO
  known_foreign_states: [New, Ready, In progress, Ready for test, Done, Archived]
`

/** 合法映射（全键盖戳） */
const MAPPING = `  state_mapping:
    Archived: 已交付
  state_mapping_audited:
    Archived: 2026-10-22 studio-dev-170 审计
`

function dirWith(yt: string): Record<string, string> {
  return {
    'org-config.yaml': `schema: org-config/v1\ncompany:\n${COMPANY}${yt === '' ? '' : yt}\n${TAIL}`,
    'charter.md': tpl('charter.md'),
    '.studio-next.yaml': tpl('.studio-next.yaml'),
    'departments/工程部/config.yaml': tpl('departments/工程部/config.yaml'),
    'departments/工程部/people/AGENT-1.md': tpl('departments/工程部/people/AGENT-1.md'),
  }
}

function issuesOf(files: Record<string, string>): Array<{ rule: string; line: number }> {
  const r = loadCompanyDirectory(files)
  expect(r.ok).toBe(false)
  if (!r.ok) return r.issues.map((i) => ({ rule: i.rule, line: i.line }))
  return []
}

function rulesOf(files: Record<string, string>): string[] {
  return issuesOf(files).map((i) => i.rule)
}

function loadOk(files: Record<string, string>) {
  const r = loadCompanyDirectory(files)
  expect(r.ok).toBe(true)
  if (r.ok) return r
  throw new Error('unreachable')
}

describe('SH-1 白名单形状（known_foreign_states）', () => {
  it('合法：六英文态全过且快照装载', () => {
    const r = loadOk(dirWith(WHITELIST))
    expect(r.snapshot.knownForeignStates).toEqual(['New', 'Ready', 'In progress', 'Ready for test', 'Done', 'Archived'])
    expect(r.snapshot.stateMapping).toBeUndefined()
  })

  it('非字符串项命中 state-hygiene-bad-whitelist', () => {
    const rules = rulesOf(dirWith(`yt:\n  known_foreign_states: [New, 3]\n`))
    expect(rules).toContain('org-config/state-hygiene-bad-whitelist')
  })

  it('重复项命中 state-hygiene-dup-whitelist（集合语义）', () => {
    const rules = rulesOf(dirWith(`yt:\n  known_foreign_states: [New, New]\n`))
    expect(rules).toContain('org-config/state-hygiene-dup-whitelist')
  })
})

describe('SH-2..SH-5 映射层（state_mapping/state_mapping_audited）', () => {
  it('合法：全键盖戳过闸且快照装载', () => {
    const r = loadOk(dirWith(WHITELIST + MAPPING))
    expect(r.snapshot.knownForeignStates).toHaveLength(6)
    expect(r.snapshot.stateMapping).toEqual({ Archived: '已交付' })
  })

  it('SH-2：非 record 形状命中 state-hygiene-bad-mapping', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping: [Archived]\n  state_mapping_audited:\n    Archived: 2026-10-22\n`))
    expect(rules).toContain('org-config/state-hygiene-bad-mapping')
  })

  it('SH-2：空映射命中（空映射不声明即面关）', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping: {}\n  state_mapping_audited: {}\n`))
    expect(rules).toContain('org-config/state-hygiene-bad-mapping')
  })

  it('SH-3：映射键不在白名单命中 state-hygiene-mapping-not-foreign', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping:\n    已交付: 已交付\n  state_mapping_audited:\n    已交付: 2026-10-22\n`))
    expect(rules).toContain('org-config/state-hygiene-mapping-not-foreign')
  })

  it('SH-3：无白名单声明时映射键全不外来（映射须白名单先行）', () => {
    const rules = rulesOf(dirWith(`yt:\n  state_mapping:\n    Archived: 已交付\n  state_mapping_audited:\n    Archived: 2026-10-22\n`))
    expect(rules).toContain('org-config/state-hygiene-mapping-not-foreign')
  })

  it('SH-4：未盖戳（缺 audited 段）拒绝挂载——fail-closed', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping:\n    Archived: 已交付\n`))
    expect(rules).toContain('org-config/state-hygiene-mapping-unaudited')
  })

  it('SH-4：部分键盖戳仍拒绝（全键盖戳才过）', () => {
    const rules = rulesOf(
      dirWith(
        WHITELIST +
          `  state_mapping:\n    Archived: 已交付\n    Done: 已交付\n  state_mapping_audited:\n    Archived: 2026-10-22\n`,
      ),
    )
    expect(rules.filter((r) => r === 'org-config/state-hygiene-mapping-unaudited')).toHaveLength(1)
  })

  it('SH-4：audited 非 record 命中 state-hygiene-bad-audit', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping:\n    Archived: 已交付\n  state_mapping_audited: 2026-10-22\n`))
    expect(rules).toContain('org-config/state-hygiene-bad-audit')
  })

  it('SH-5：映射键已删残戳命中 state-hygiene-audit-stale', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping:\n    Archived: 已交付\n  state_mapping_audited:\n    Archived: 2026-10-22\n    Done: 2026-10-01\n`))
    expect(rules).toContain('org-config/state-hygiene-audit-stale')
  })

  it('SH-5：无映射只剩戳命中 state-hygiene-audit-without-mapping', () => {
    const rules = rulesOf(dirWith(WHITELIST + `  state_mapping_audited:\n    Archived: 2026-10-22\n`))
    expect(rules).toContain('org-config/state-hygiene-audit-without-mapping')
  })
})

describe('面关负对照 + 行号指认', () => {
  it('yt 无双层键：零 state-hygiene 规则、零快照键（现状行为零变化）', () => {
    const r = loadOk(dirWith(`yt:\n  project: DEMO\n`))
    expect(r.snapshot.knownForeignStates).toBeUndefined()
    expect(r.snapshot.stateMapping).toBeUndefined()
  })

  it('行号指认到 yt 段双层键（文件:行=MountResult 修法可执行）', () => {
    const files = dirWith(WHITELIST + `  state_mapping:\n    Archived: 已交付\n`)
    const hits = issuesOf(files)
    const unaudited = hits.find((i) => i.rule === 'org-config/state-hygiene-mapping-unaudited')
    expect(unaudited).toBeDefined()
    expect(unaudited?.line).toBeGreaterThan(1)
  })
})
