/**
 * v0.1-M2.2 多文件交叉校验测试（docs/04-§二/§九；需求 C2-04/C2-05）
 *
 * 覆盖（拟稿编号随 src/multifile.ts 头注 M2.2-①..⑨）：
 *   - 多文件全绿面：最小合成树全绿 / file 键缺省推导全绿（M2.2-②）/ 模板全树直读全绿
 *   - 部门双检：dept/dangling（索引→文件）/ dept/orphan（文件→索引，M2.2-⑦ 阻断级）/
 *     部门 config 形状（缺必填/坏形状/未知键/yaml 语法）+ leader∈people 索引
 *   - 人事档案双检：people/dangling（显式 file 键与推导两口径）/ people/orphan /
 *     front-matter 形状（缺必填/坏形状/未知键/坏分隔/坏语法）/ 文件名=front-matter id /
 *     索引 id=档案 id / 六节弱校验（缺节定位正文起始行——M2.2-③）
 *   - charter_ref 存在性（charter/dangling——M2.2-⑧）
 *   - .studio-next.yaml：缺文件/schema 不一致/戳位形状（ISO 8601 口径——M2.2-⑥）
 *   - 宽容位两态（M2.2-⑨）：缺省全检 vs strictFiles:false 保持 v0 单文件语义
 *   - 行号定位抽查：跨 org-config / 部门 config / 档案 / 元信息四类文件逐条钉行
 *
 * 分工（CASES.md）：契约 case 断言语料级语义（dir 域冻结为单文件面）；本套断言多文件行为+位置。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCompanyDirectory, readDirectoryFiles } from '../src/index.ts'

// ───────────────────────── 最小全绿树（行号受控：mutation 测试按行号断言） ─────────────────────────

/** org-config.yaml 23 行骨架：people[0] 显式带 file 键（第 23 行） */
const ORG_BASE = [
  'schema: org-config/v1',                                // 1
  'company:',                                             // 2
  '  name: 演示公司',                                     // 3
  '  slug: demo-corp',                                    // 4
  '  charter_ref: charter.md',                            // 5
  '  level: 2',                                           // 6
  '  level_distribution:',                                // 7
  '    2: 1',                                             // 8
  'departments:',                                         // 9
  '  - name: 工程部',                                     // 10（条目起始行——dept/dangling 定位）
  '    path: departments/工程部',                         // 11
  '    leader: AGENT-1',                                  // 12
  '    level: 2',                                         // 13
  '    parent: null',                                     // 14
  '    lanes: [core]',                                    // 15
  '    functions: [交付]',                                // 16
  'people:',                                              // 17
  '  - id: AGENT-1',                                      // 18（条目起始行——file 键缺省时 dangling 定位）
  '    name: 演示工程师',                                 // 19
  '    login: agent-1',                                   // 20
  '    level: 2',                                         // 21
  '    dept: departments/工程部',                         // 22
  '    file: departments/工程部/people/AGENT-1.md',       // 23（file 键行——显式引用 dangling 定位）
]

/** departments/工程部/config.yaml 11 行（形状=模板实形收——M2.2-④） */
const DEPT_BASE = [
  'name: 工程部',                 // 1（name 键行——dept/orphan 定位）
  'path: departments/工程部',     // 2
  'level: 2',                     // 3
  'parent: null',                 // 4
  'leader: AGENT-1',              // 5（leader 行——leader-dangling/形状定位）
  'functions: [交付]',            // 6
  'lanes: [core]',                // 7
  'reports_to: null',             // 8
  'rules: []',                    // 9
  'relations: []',                // 10
  'jobs: []',                     // 11
]

/** departments/工程部/people/AGENT-1.md：front-matter（2-10 行）+ 六节（12 行起） */
const PERSON_BASE = [
  '---',                          // 1
  'id: AGENT-1',                  // 2（id 键行——id 三方对齐定位）
  'name: 演示工程师',             // 3
  'login: agent-1',               // 4
  'level: 2',                     // 5
  'dept: departments/工程部',     // 6
  'role: 工程负责人',             // 7
  'reports_to: null',             // 8
  'skills: [typescript]',         // 9
  'status: active',               // 10
  '---',                          // 11（front-matter 闭界；正文起始=12 行）
  '## 一、定位',                  // 12
  '定位一句话。',                 // 13
  '## 二、职责',                  // 14
  '- 职责一条。',                 // 15
  '## 三、做过的事',              // 16
  '（待回填）',                   // 17
  '## 四、技能本体',              // 18
  '（待回填）',                   // 19
  '## 五、表现画像',              // 20
  '（待回填）',                   // 21
  '## 六、自述',                  // 22
  '（待本人填写）',               // 23
]

/** .studio-next.yaml 6 行（戳位全 null=未盖戳——M2.2-⑥） */
const META_BASE = [
  'schema: org-config/v1',          // 1
  'template: company-2-level',      // 2
  'created_at: null',               // 3
  'last_validated_at: null',        // 4
  'last_validation: null',          // 5
  'framework_version: null',        // 6
]

const yaml = (lines: string[]): string => `${lines.join('\n')}\n`

/** 最小全绿树（每次浅拷贝，测试内就地 mutation） */
function greenTree(): Record<string, string> {
  return {
    'org-config.yaml': yaml(ORG_BASE),
    'charter.md': '# 公司章程\n',
    '.studio-next.yaml': yaml(META_BASE),
    'departments/工程部/config.yaml': yaml(DEPT_BASE),
    'departments/工程部/people/AGENT-1.md': yaml(PERSON_BASE),
  }
}

/** 结构合法的档案（换工号生成——孤儿/对齐测试用） */
function personDoc(id: string): string {
  return yaml(PERSON_BASE.map((line) => (line === 'id: AGENT-1' ? `id: ${id}` : line)))
}

/** 断言恰命中目标规则并返回该 issue（rule 唯一定位，附加断言在调用侧） */
function mustIssue(r: ReturnType<typeof loadCompanyDirectory>, rule: string) {
  expect(r.ok).toBe(false)
  if (!r.ok) {
    const issue = r.issues.find((i) => i.rule === rule)
    expect(issue).toBeDefined()
    expect(issue?.fix).toBeTruthy()
    return issue
  }
  return undefined
}

// ───────────────────────── 多文件全绿面 ─────────────────────────

describe('多文件全绿面', () => {
  it('最小多文件树全绿：org-config + 部门 config + 档案 + 章程 + 元信息齐备 → ok:true', () => {
    const r = loadCompanyDirectory(greenTree())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.slug).toBe('demo-corp')
      expect(r.snapshot.departments).toHaveLength(1)
      expect(r.snapshot.people).toHaveLength(1)
      expect(r.snapshot.people[0]?.id).toBe('AGENT-1')
      expect(r.snapshot.jobs).toEqual([])
    }
  })

  it('file 键缺省走 <dept>/people/<工号>.md 推导仍全绿（M2.2-② 正向）', () => {
    const tree = greenTree()
    tree['org-config.yaml'] = yaml(ORG_BASE.filter((line) => !line.startsWith('    file:')))
    const r = loadCompanyDirectory(tree)
    expect(r.ok).toBe(true)
  })

  it('模板全树直读（templates/company-2-level）全绿——init 自检面的直接回归', async () => {
    const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/company-2-level')
    const r = loadCompanyDirectory(await readDirectoryFiles(templateDir))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.slug).toBe('example-corp')
      expect(r.snapshot.departments.map((d) => d.path)).toEqual(['departments/工程部'])
      expect(r.snapshot.people.map((p) => p.id)).toEqual(['AGENT-1'])
      expect(r.snapshot.jobs.map((j) => j.job_id)).toEqual(['health-patrol-工程部', 'daily-report-工程部'])
    }
  })
})

// ───────────────────────── 部门索引↔文件双检 ─────────────────────────

describe('departments/**/config.yaml：索引↔文件双检 + 形状 + leader 交叉', () => {
  it('索引引用 path 无文件 → dept/dangling，定位 org-config 条目起始行（第 10 行）', () => {
    const tree = greenTree()
    delete tree['departments/工程部/config.yaml']
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept/dangling')
    expect(issue?.file).toBe('org-config.yaml')
    expect(issue?.line).toBe(10)
  })

  it('文件在树、不在索引 → dept/orphan（M2.2-⑦ 阻断级），定位该文件 name 行（第 1 行）', () => {
    const tree = greenTree()
    tree['departments/质量部/config.yaml'] = yaml([
      'name: 质量部',
      'path: departments/质量部',
      'level: 2',
      'parent: null',
      'leader: AGENT-1',
      'functions: [把关]',
      'lanes: [qa]',
    ])
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept/orphan')
    expect(issue?.file).toBe('departments/质量部/config.yaml')
    expect(issue?.line).toBe(1)
  })

  it('孤儿部门仍受形状约束：缺 leader → dept/orphan 与 dept-config/missing-field:leader 齐发', () => {
    const tree = greenTree()
    tree['departments/质量部/config.yaml'] = yaml([
      'name: 质量部',
      'path: departments/质量部',
      'level: 2',
      'parent: null',
      'functions: [把关]',
      'lanes: [qa]',
    ])
    const r = loadCompanyDirectory(tree)
    mustIssue(r, 'dept/orphan')
    mustIssue(r, 'dept-config/missing-field:leader')
  })

  it('索引内部门 config 缺必填 leader → dept-config/missing-field:leader', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = yaml(DEPT_BASE.filter((line) => !line.startsWith('leader:')))
    mustIssue(loadCompanyDirectory(tree), 'dept-config/missing-field:leader')
  })

  it('leader 坏形状（数字非串）→ 定位 leader 行（第 5 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = yaml(DEPT_BASE.map((line) => (line === 'leader: AGENT-1' ? 'leader: 123' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept-config/missing-field:leader')
    expect(issue?.file).toBe('departments/工程部/config.yaml')
    expect(issue?.line).toBe(5)
  })

  it('leader 不在 people 索引 → dept/leader-dangling，定位 leader 行（第 5 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = yaml(DEPT_BASE.map((line) => (line === 'leader: AGENT-1' ? 'leader: AGENT-9' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept/leader-dangling')
    expect(issue?.file).toBe('departments/工程部/config.yaml')
    expect(issue?.line).toBe(5)
  })

  it('部门 config YAML 语法错误 → dept-config/yaml-syntax', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = 'leader: [\n'
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept-config/yaml-syntax')
    expect(issue?.file).toBe('departments/工程部/config.yaml')
    expect(issue?.line).toBeGreaterThanOrEqual(1)
  })

  it('部门 config 未知键拒收（strictObject）→ 根级未知键路径为空，规则落 (root)、定位文件首行', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = yaml([...DEPT_BASE, 'note: 不在契约'])
    const issue = mustIssue(loadCompanyDirectory(tree), 'dept-config/missing-field:(root)')
    expect(issue?.file).toBe('departments/工程部/config.yaml')
    expect(issue?.line).toBe(1)
    expect(issue?.fix).toContain('Unrecognized')
  })

  it('部门 config jobs 清单收形状（M2.2-⑤）：非字符串数组 → dept-config/missing-field:jobs.0', () => {
    const tree = greenTree()
    tree['departments/工程部/config.yaml'] = yaml(DEPT_BASE.map((line) => (line === 'jobs: []' ? 'jobs: [123]' : line)))
    mustIssue(loadCompanyDirectory(tree), 'dept-config/missing-field:jobs.0')
  })
})

// ───────────────────────── 人事档案双检与 front-matter ─────────────────────────

describe('人事档案：索引↔档案双检 + front-matter + 文件名/工号 + 六节', () => {
  it('索引显式 file 键指向缺失档案 → people/dangling，定位 file 键行（第 23 行）', () => {
    const tree = greenTree()
    delete tree['departments/工程部/people/AGENT-1.md']
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/dangling')
    expect(issue?.file).toBe('org-config.yaml')
    expect(issue?.line).toBe(23)
  })

  it('file 键缺省 + 推导路径无档案 → people/dangling，定位条目起始行（第 18 行），修法含推导口径（M2.2-②）', () => {
    const tree = greenTree()
    tree['org-config.yaml'] = yaml(ORG_BASE.filter((line) => !line.startsWith('    file:')))
    delete tree['departments/工程部/people/AGENT-1.md']
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/dangling')
    expect(issue?.file).toBe('org-config.yaml')
    expect(issue?.line).toBe(18)
    expect(issue?.fix).toContain('推导')
  })

  it('档案在树、不被索引引用 → people/orphan，定位档案 id 行（第 2 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-2.md'] = personDoc('AGENT-2')
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/orphan')
    expect(issue?.file).toBe('departments/工程部/people/AGENT-2.md')
    expect(issue?.line).toBe(2)
  })

  it('front-matter id ≠ 文件名 ≠ 索引 id → file-id-mismatch 与 id-mismatch 齐发（工号永不变主键）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = personDoc('AGENT-2')
    const r = loadCompanyDirectory(tree)
    const fileIssue = mustIssue(r, 'people/file-id-mismatch')
    expect(fileIssue?.file).toBe('departments/工程部/people/AGENT-1.md')
    expect(fileIssue?.line).toBe(2)
    mustIssue(r, 'people/id-mismatch')
  })

  it('front-matter 缺必填 login → people-fm/missing-field:login，定位 front-matter 块首行（第 2 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.filter((line) => !line.startsWith('login:')))
    const issue = mustIssue(loadCompanyDirectory(tree), 'people-fm/missing-field:login')
    expect(issue?.file).toBe('departments/工程部/people/AGENT-1.md')
    expect(issue?.line).toBe(2)
  })

  it('front-matter 坏形状（level 给字符串）→ 定位该键行（第 5 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.map((line) => (line === 'level: 2' ? 'level: 两' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'people-fm/missing-field:level')
    expect(issue?.line).toBe(5)
  })

  it('front-matter 未知键拒收（strictObject）→ 根级未知键路径为空，规则落 (root)、定位块首行（第 2 行）', () => {
    const tree = greenTree()
    const lines = [...PERSON_BASE.slice(0, 10), 'note: 不在契约', ...PERSON_BASE.slice(10)]
    tree['departments/工程部/people/AGENT-1.md'] = yaml(lines)
    const issue = mustIssue(loadCompanyDirectory(tree), 'people-fm/missing-field:(root)')
    expect(issue?.line).toBe(2)
    expect(issue?.fix).toContain('Unrecognized')
  })

  it('无 --- 分隔的 front-matter → people/bad-front-matter，定位第 1 行', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.slice(1))
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/bad-front-matter')
    expect(issue?.line).toBe(1)
  })

  it('front-matter YAML 语法错误 → people/bad-front-matter，行号落在 front-matter 块内（≥2 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.map((line) => (line === 'login: agent-1' ? 'login: [agent-1' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/bad-front-matter')
    expect(issue && issue.line).toBeGreaterThanOrEqual(2)
  })

  it('缺固定六节之一（六、自述）→ people/missing-section:六，定位正文起始行（第 12 行）', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.filter((line) => line !== '## 六、自述' && line !== '（待本人填写）'))
    const issue = mustIssue(loadCompanyDirectory(tree), 'people/missing-section:六')
    expect(issue?.file).toBe('departments/工程部/people/AGENT-1.md')
    expect(issue?.line).toBe(12)
  })

  it('六节弱匹配容忍模板式括号后缀（M2.2-③ 正向）→ 仍全绿', () => {
    const tree = greenTree()
    tree['departments/工程部/people/AGENT-1.md'] = yaml(PERSON_BASE.map((line) =>
      line === '## 三、做过的事' ? '## 三、做过的事（事实段 · 系统机械归集）' : line))
    const r = loadCompanyDirectory(tree)
    expect(r.ok).toBe(true)
  })
})

// ───────────────────────── charter_ref 存在性 ─────────────────────────

describe('charter_ref 存在性', () => {
  it('charter_ref 指到的文件不在树中 → charter/dangling，定位 charter_ref 行（第 5 行）', () => {
    const tree = greenTree()
    delete tree['charter.md']
    const issue = mustIssue(loadCompanyDirectory(tree), 'charter/dangling')
    expect(issue?.file).toBe('org-config.yaml')
    expect(issue?.line).toBe(5)
  })
})

// ───────────────────────── .studio-next.yaml ─────────────────────────

describe('.studio-next.yaml：必备 + 形状 + schema 同源', () => {
  it('缺 .studio-next.yaml → meta/missing-file', () => {
    const tree = greenTree()
    delete tree['.studio-next.yaml']
    mustIssue(loadCompanyDirectory(tree), 'meta/missing-file')
  })

  it('schema 与 org-config 不一致 → meta/schema-mismatch，定位 schema 行（第 1 行）', () => {
    const tree = greenTree()
    tree['.studio-next.yaml'] = yaml(META_BASE.map((line) => (line === 'schema: org-config/v1' ? 'schema: org-config/v2' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'meta/schema-mismatch')
    expect(issue?.file).toBe('.studio-next.yaml')
    expect(issue?.line).toBe(1)
  })

  it('created_at 非 ISO 8601 非 null → meta/missing-field:created_at，定位该行（第 3 行）', () => {
    const tree = greenTree()
    tree['.studio-next.yaml'] = yaml(META_BASE.map((line) => (line === 'created_at: null' ? 'created_at: 昨天' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'meta/missing-field:created_at')
    expect(issue?.line).toBe(3)
  })

  it('戳位合法形态（ISO 8601 带偏移/Z + last_validation: pass）→ 全绿（M2.2-⑥ 正向）', () => {
    const tree = greenTree()
    tree['.studio-next.yaml'] = yaml([
      'schema: org-config/v1',
      'template: company-2-level',
      'created_at: 2026-10-16T09:00:00+08:00',
      'last_validated_at: 2026-10-16T01:02:03.456Z',
      'last_validation: pass',
      'framework_version: 0.1.0',
    ])
    expect(loadCompanyDirectory(tree).ok).toBe(true)
  })

  it('last_validation 非法值（pending）→ meta/missing-field:last_validation，定位该行（第 5 行）', () => {
    const tree = greenTree()
    tree['.studio-next.yaml'] = yaml(META_BASE.map((line) => (line === 'last_validation: null' ? 'last_validation: pending' : line)))
    const issue = mustIssue(loadCompanyDirectory(tree), 'meta/missing-field:last_validation')
    expect(issue?.line).toBe(5)
  })
})

// ───────────────────────── 宽容位两态（M2.2-⑨） ─────────────────────────

describe('宽容位 strictFiles 两态（M2.2-⑨，dir 域契约语义分叉点）', () => {
  it('单文件目录（只有 org-config.yaml）：缺省全检 → 部门/档案/章程/元信息悬空齐发；strictFiles:false → ok:true（v0 语义）', () => {
    const single = { 'org-config.yaml': yaml(ORG_BASE) }

    const strict = loadCompanyDirectory(single) // 缺省 strictFiles=true
    expect(strict.ok).toBe(false)
    if (!strict.ok) {
      const rules = new Set(strict.issues.map((i) => i.rule))
      expect(rules.has('dept/dangling')).toBe(true)
      expect(rules.has('people/dangling')).toBe(true)
      expect(rules.has('charter/dangling')).toBe(true)
      expect(rules.has('meta/missing-file')).toBe(true)
    }

    const lax = loadCompanyDirectory(single, { strictFiles: false })
    expect(lax.ok).toBe(true) // C-dir-001 期望 ok:true 的口径来源
  })

  it('strictFiles:false 只关多文件面，不掩盖 org-config 自身错误（等级分布不符仍红）', () => {
    const bad = { 'org-config.yaml': yaml(ORG_BASE.map((line) => (line === '    2: 1' ? '    2: 2' : line))) }
    const r = loadCompanyDirectory(bad, { strictFiles: false })
    mustIssue(r, 'org-config/level-count-mismatch')
  })

  it('全绿树在两态下都 ok（宽容位不引入假阳性）', () => {
    const tree = greenTree()
    expect(loadCompanyDirectory(tree).ok).toBe(true)
    expect(loadCompanyDirectory(tree, { strictFiles: false }).ok).toBe(true)
  })
})
