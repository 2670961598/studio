/**
 * DEV-32 · 公司仓库判定器规则集测试（docs/51-§七「规则集测试纪律」：每条规则至少一对
 * 夹具（合法+违法）——判定器改动过全量门禁；规则集与规范正文一一对应）。
 *
 * 夹具法（恶意样本纪律沿 docs/44-附录B/DEV-27 同款）：
 *   - 良基（canonical 最小合法仓）= docs/51-§三 示例形态：schema=studio-next/org@1
 *     （canonical 字面量，区别于 DEV-27 迁移期夹具的 org-config/v1）+ version + 章程位 +
 *     1 部门 2 员工（level_distribution 对账）+ jobs（与部门 config 双清单一致）+
 *     dependencies.yaml（role 命中绑定）+ plugins/dsh-web-test（完整 dsh 形态，拷自
 *     DEV-27 良性夹具）。**缺 .studio-next.yaml**（R2：源仓缺场合法——导入产物面补桩）。
 *   - 每条规则的违法夹具=良基单点变异（一处 mutation）；合法孪生=同变异的修复态
 *     （twin——缺省=良基本身）。同一 it() 内两态并跑：违法态 FAIL 且指认到该规则号，
 *     孪生态 PASS——「一对夹具」逐规则落证，不靠全局面拼。
 *   - D-2/D-3 两行是「合法但明示」面：违法位=警示/缺失面出现而非 FAIL（docs/51-§五）。
 *
 * 违规输出契约（docs/51-§七）：逐条 {规则号, 文件, 位置, 违规描述, 修复建议}——测试断言
 * 四元组非空（不许只说校验失败）。
 */
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importCompanyRepo, validateCompanyRepo, type RepoValidateResult } from '../src/index.ts'

const pluginFixture = fileURLToPath(new URL('./fixtures/company-dist/plugins/dsh-web-test', import.meta.url))

let root = ''

/** 良基文件表（相对路径 → 内容）；目录由 mkdir 隐式建 */
function canonicalBase(): Record<string, string> {
  return {
    'org-config.yaml': [
      '# DEV-32 判定器良基（docs/51-§三 canonical 形态：schema=studio-next/org@1）',
      'schema: studio-next/org@1',
      'company:',
      '  name: 判定器示范公司',
      '  slug: demo-corp',
      '  version: 1.0.0',
      '  level: 2',
      '  level_distribution:',
      '    2: 2',
      '  charter_ref: charter.md',
      '  platform: localfile',
      'departments:',
      '  - name: 工程部',
      '    path: departments/工程部',
      '    leader: AGENT-1',
      '    level: 2',
      '    parent: null',
      '    lanes: [core]',
      '    functions: [交付]',
      '    relations: []',
      'people:',
      '  - id: AGENT-1',
      '    name: 工程师甲',
      '    login: agent-1',
      '    level: 2',
      '    dept: departments/工程部',
      '    role: 工程负责人',
      '    reports_to: null',
      '    skills: [typescript]',
      '    status: active',
      '    executor: dsh',
      '    file: departments/工程部/people/AGENT-1.md',
      '  - id: AGENT-2',
      '    name: 工程师乙',
      '    login: agent-2',
      '    level: 2',
      '    dept: departments/工程部',
      '    skills: [yaml]',
      '    status: active',
      '    executor: dsh',
      '    file: departments/工程部/people/AGENT-2.md',
      'jobs:',
      '  - id: demo-report',
      '    dept: departments/工程部',
      '    cron: "0 18 * * *"',
      '    role: 工程负责人',
      '    level: 2',
      '    type: report',
      '    model_tier: low',
      '    budget_cap: 2',
      '    output: reports/工程部/',
      'accounts:',
      '  - login: agent-1',
      '    level: 2',
      '    note: 判定器示范公司的等级锚点账号',
      '',
    ].join('\n'),
    'charter.md': '# 判定器示范公司章程\n\n以 docs/51 五契约为唯一标尺，逐条可判。\n',
    'README.md': '# demo-corp\n\nDEV-32 判定器测试良基。\n',
    '.gitignore': '.DS_Store\n',
    'prompts/company.md': '# 公司提示词片段\n\n契约先行，证据断言。\n',
    'docs/about.md': '# 关于\n\n封闭集内自由文本目录。\n',
    'departments/工程部/config.yaml': [
      'name: 工程部',
      'path: departments/工程部',
      'level: 2',
      'parent: null',
      'leader: AGENT-1',
      'functions: [交付]',
      'lanes: [core]',
      'reports_to: null',
      'relations: []',
      'jobs:',
      '  - demo-report',
      '',
    ].join('\n'),
    'departments/工程部/people/AGENT-1.md': [
      '---',
      'id: AGENT-1',
      'name: 工程师甲',
      'login: agent-1',
      'level: 2',
      'dept: departments/工程部',
      'role: 工程负责人',
      'reports_to: null',
      'skills: [typescript]',
      'executor: dsh',
      'status: active',
      '---',
      '',
      '# AGENT-1 · 工程师甲',
      '',
      '## 一、定位',
      '',
      '工程负责人：判定器良基的档案面。',
      '',
      '## 二、职责',
      '',
      '- 保持良基合法',
      '',
      '## 三、做过的事',
      '',
      '（待回填）',
      '',
      '## 四、技能本体',
      '',
      '- typescript',
      '',
      '## 五、表现画像',
      '',
      '（待台账接入）',
      '',
      '## 六、自述',
      '',
      '（待本人填写）',
      '',
    ].join('\n'),
    'departments/工程部/people/AGENT-2.md': [
      '---',
      'id: AGENT-2',
      'name: 工程师乙',
      'login: agent-2',
      'level: 2',
      'dept: departments/工程部',
      'reports_to: AGENT-1',
      'skills: [yaml]',
      'executor: dsh',
      'status: active',
      '---',
      '',
      '# AGENT-2 · 工程师乙',
      '',
      '## 一、定位',
      '',
      '工程师：良基第二名成员。',
      '',
      '## 二、职责',
      '',
      '- 配平 level_distribution',
      '',
      '## 三、做过的事',
      '',
      '（待回填）',
      '',
      '## 四、技能本体',
      '',
      '- yaml',
      '',
      '## 五、表现画像',
      '',
      '（待台账接入）',
      '',
      '## 六、自述',
      '',
      '（待本人填写）',
      '',
    ].join('\n'),
    'dependencies.yaml': [
      'schema: studio-next/dependencies@1',
      'bindings:',
      '  - when:',
      '      attr: role',
      '      is: 工程负责人',
      '    plugins:',
      '      - name: dsh-web-test',
      '        version: "^1.2"',
      '',
    ].join('\n'),
  }
}

/** 落盘良基（+可选变异）到目录；plugins/ 从 DEV-27 良性夹具拷贝（完整 dsh 形态） */
async function materializeBase(dir: string, mutate?: (files: Record<string, string>) => void): Promise<string> {
  const files = canonicalBase()
  if (mutate !== undefined) mutate(files)
  await mkdir(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    await mkdir(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  await cp(pluginFixture, path.join(dir, 'plugins', 'dsh-web-test'), { recursive: true })
  return dir
}

/** 违规四元组契约断言：规则号在场 + 文件/位置/描述/修法全非空（docs/51-§七） */
function expectRule(result: RepoValidateResult, rule: string): void {
  const hits = result.violations.filter((v) => v.rule === rule)
  expect(hits.length, `规则 ${rule} 未被指认；实际违规=${JSON.stringify(result.violations.map((v) => v.rule))}`).toBeGreaterThan(0)
  for (const v of hits) {
    expect(v.file.trim()).not.toBe('')
    expect(v.location.trim()).not.toBe('')
    expect(v.problem.trim()).not.toBe('')
    expect(v.fix.trim()).not.toBe('')
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-repo-validate-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 0. 良基自证 —————————————————————————

describe('DEV-32 · 良基自证（canonical 最小合法仓）', () => {
  it('良基 PASS：缺省源面 + R2 缺 meta 合法（警示留痕）+ 摘要四元组', async () => {
    const dir = await materializeBase(path.join(root, 'base'))
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.exempted).toEqual([])
    expect(result.warnings.map((w) => w.rule)).toContain('meta/missing')
    const s = result.summary
    expect(s).toBeDefined()
    expect(s?.name).toBe('判定器示范公司')
    expect(s?.slug).toBe('demo-corp')
    expect(s?.level).toBe(2)
    expect(s?.departments).toBe(1)
    expect(s?.people).toBe(2)
    expect(s?.jobs).toBe(1)
    expect(s?.plugins).toBe(1)
    expect(s?.platform).toBe('localfile')
    expect(s?.capabilityMissing).toEqual([])
    expect(s?.conflicts).toEqual([])
  })

  it('PASS 摘要=「可初始化」语义：snapshot 随行（导入流共用同一判定器——单一事实源）', async () => {
    const dir = await materializeBase(path.join(root, 'base-snapshot'))
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(true)
    expect(result.snapshot?.people.map((p) => p.id)).toEqual(['AGENT-1', 'AGENT-2'])
  })
})

// ————————————————————————— 1. A 组 · 目录封闭集（docs/51-§二） —————————————————————————

describe('DEV-32 · A 组（目录契约）——每规则一对夹具', () => {
  interface Case { rule: string; desc: string; mutate: (files: Record<string, string>) => void; twin?: (files: Record<string, string>) => void }

  const cases: Case[] = [
    {
      rule: 'A-1', desc: '顶层封闭集外条目（stray.txt）',
      mutate: (f) => { f['stray.txt'] = '越界文件\n' },
      twin: (f) => { delete f['stray.txt'] },
    },
    {
      rule: 'A-1', desc: 'departments/ 子树形状外文件（部门内附加文本）',
      mutate: (f) => { f['departments/工程部/notes.txt'] = '部门内越界\n' },
      twin: (f) => { f['docs/dept-notes.md'] = '归位 docs/\n' },
    },
    {
      rule: 'A-2', desc: '缺 org-config.yaml 必备位',
      mutate: (f) => { delete f['org-config.yaml'] },
      twin: (f) => { f['org-config.yaml'] = canonicalBase()['org-config.yaml'] ?? '' },
    },
    {
      rule: 'A-2', desc: '缺章程位（charter.md 移走）',
      mutate: (f) => {
        const src = f['charter.md'] ?? ''
        delete f['charter.md']
        f['docs/charter.md'] = src // 文件还在但不在章程位
      },
      twin: (f) => { f['charter.md'] = '# 判定器示范公司章程\n\n回到章程位。\n' },
    },
    {
      rule: 'A-2', desc: '缺部门配置位（departments/*/config.yaml 删除）',
      mutate: (f) => { delete f['departments/工程部/config.yaml'] },
      twin: (f) => { f['departments/工程部/config.yaml'] = canonicalBase()['departments/工程部/config.yaml'] ?? '' },
    },
    {
      rule: 'A-4', desc: '.AIWS/ 员工工作区入仓（E-3 同步重申）',
      mutate: (f) => { f['.AIWS/AGENT-1/workspace.md'] = '工作区不入仓\n' },
    },
    {
      rule: 'A-5', desc: '.studio-next/ 信任锚目录入仓（E-3 同步重申）',
      mutate: (f) => { f['.studio-next/trust.json'] = '{"trust": true}\n' },
    },
  ]

  for (const c of cases) {
    it(`[${c.rule}] ${c.desc}：违法态 FAIL 指认 + 孪生态 PASS`, async () => {
      const mutant = await materializeBase(path.join(root, 'a', c.rule, slugOf(c.desc)), c.mutate)
      const result = await validateCompanyRepo(mutant)
      expect(result.ok).toBe(false)
      expectRule(result, c.rule)
      // 孪生=修复态（缺省=良基重落）：与违法态同 it 配对取证
      const twin = await materializeBase(path.join(root, 'a', c.rule, `${slugOf(c.desc)}-twin`), c.twin)
      const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
    })
  }

  it('[A-3] .git/ 不参与合法性判定：含 .git 的仓库照常 PASS（传输层豁免）', async () => {
    const dir = await materializeBase(path.join(root, 'a', 'A-3'))
    mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(path.join(dir, '.git', 'config'), '[core]\n', 'utf8')
    writeFileSync(path.join(dir, '.git', 'hooks', 'post-merge'), '#!/bin/sh\n', 'utf8')
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(true)
  })

  it('[A-4/A-5 违法态同步指认 E-3 重申]：两面同禁的卫生组镜像规则在场', async () => {
    const dir = await materializeBase(path.join(root, 'a', 'E-3'), (f) => {
      f['.AIWS/AGENT-1/x.md'] = 'x\n'
      f['.studio-next/trust.json'] = '{}\n'
    })
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(false)
    expectRule(result, 'A-4')
    expectRule(result, 'A-5')
    expectRule(result, 'E-3')
  })

  it('[A-1 --allow-extra] 封闭集外路径豁免留痕（不豁免其他组）', async () => {
    const dir = await materializeBase(path.join(root, 'a', 'allow-extra'), (f) => {
      f['stray.txt'] = '越界文件\n'
      f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('slug: demo-corp', 'slug: Demo Corp!')
    })
    const result = await validateCompanyRepo(dir, { allowExtra: true })
    expect(result.ok).toBe(false) // B-1 不被豁免
    expect(result.exempted).toContain('stray.txt')
    expectRule(result, 'B-1')
  })
})

// ————————————————————————— 2. B 组 · 逐文件 schema 与值域（docs/51-§三） —————————————————————————

describe('DEV-32 · B 组（文件契约）——每规则一对夹具', () => {
  interface Case { rule: string; desc: string; mutate: (files: Record<string, string>) => void; twin?: (files: Record<string, string>) => void; expectPassTwin?: boolean }

  const cases: Case[] = [
    {
      rule: 'B-1', desc: 'slug 语法域外（大写+空格）',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('slug: demo-corp', 'slug: Demo Corp') },
      twin: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('slug: demo-corp', 'slug: demo-corp-two') },
    },
    {
      rule: 'B-1', desc: 'version 非 semver 三元组（在场必须 x.y.z——R5）',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('version: 1.0.0', 'version: 1.0') },
      twin: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('version: 1.0.0', 'version: 2.1.3') },
    },
    {
      rule: 'B-1', desc: 'level_distribution 值为负数',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    2: 2', '    2: -1') },
    },
    {
      rule: 'B-2', desc: '孤儿部门 config（org-config 未声明 departments/质量部）',
      mutate: (f) => { f['departments/质量部/config.yaml'] = 'name: 质量部\npath: departments/质量部\nlevel: 2\nparent: null\nleader: AGENT-1\nfunctions: [质量]\nlanes: [qa]\nreports_to: null\nrelations: []\n' },
      twin: (f) => { delete f['departments/质量部/config.yaml'] },
    },
    {
      rule: 'B-3', desc: '工号语法形状域外（连字符起止）',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('  - id: AGENT-2', '  - id: -AGENT-2') },
    },
    {
      rule: 'B-3', desc: '工号全司不唯一（AGENT-2 顶替 AGENT-1 的 id 位重复）',
      mutate: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '')
          .replace('  - id: AGENT-2', '  - id: AGENT-1')
          .replace('    file: departments/工程部/people/AGENT-2.md', '    file: departments/工程部/people/AGENT-1.md')
        delete f['departments/工程部/people/AGENT-2.md']
      },
    },
    {
      rule: 'B-4', desc: 'jobs id 全司不唯一（重复定时岗）',
      mutate: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '')
          .replace('    output: reports/工程部/\n', '    output: reports/工程部/\n  - id: demo-report\n    cron: "30 18 * * *"\n    type: report\n')
      },
      twin: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '')
          .replace('    output: reports/工程部/\n', '    output: reports/工程部/\n  - id: demo-audit\n    cron: "30 18 * * *"\n    type: report\n')
        f['departments/工程部/config.yaml'] = (f['departments/工程部/config.yaml'] ?? '').replace('jobs:\n  - demo-report\n', 'jobs:\n  - demo-report\n  - demo-audit\n')
      },
    },
    {
      rule: 'B-5', desc: 'dependencies.yaml 未知字段（strictObject 拒收）',
      mutate: (f) => { f['dependencies.yaml'] = `${f['dependencies.yaml'] ?? ''}extra_field: 1\n` },
      twin: (f) => { f['dependencies.yaml'] = canonicalBase()['dependencies.yaml'] ?? '' },
    },
    {
      rule: 'B-6', desc: '章程空文本（空白文件不算章程）',
      mutate: (f) => { f['charter.md'] = '   \n\n  \n' },
      twin: (f) => { f['charter.md'] = '# 判定器示范公司章程\n\n非空正文。\n' },
    },
    {
      rule: 'B-6', desc: 'prompts/ 片段空文件',
      mutate: (f) => { f['prompts/empty.md'] = '' },
      twin: (f) => { delete f['prompts/empty.md'] },
    },
  ]

  for (const c of cases) {
    it(`[${c.rule}] ${c.desc}：违法态 FAIL 指认 + 孪生态 PASS`, async () => {
      const mutant = await materializeBase(path.join(root, 'b', c.rule, slugOf(c.desc)), c.mutate)
      const result = await validateCompanyRepo(mutant)
      expect(result.ok).toBe(false)
      expectRule(result, c.rule)
      const twin = await materializeBase(path.join(root, 'b', c.rule, `${slugOf(c.desc)}-twin`), c.twin)
      const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
    })
  }
})

// ————————————————————————— 3. C 组 · 交叉引用（docs/51-§四） —————————————————————————

describe('DEV-32 · C 组（交叉引用契约）——每规则一对夹具', () => {
  interface Case { rule: string; desc: string; mutate: (files: Record<string, string>) => void; twin?: (files: Record<string, string>) => void }

  const cases: Case[] = [
    {
      rule: 'C-1', desc: 'people.dept 悬空（指向未声明部门）',
      mutate: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    dept: departments/工程部\n    skills: [yaml]', '    dept: departments/质量部\n    skills: [yaml]')
      },
      twin: (f) => {
        // 孪生：把质量部按契约补全（声明+config+档案归位）→ 引用闭合 PASS
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '')
          .replace('    dept: departments/工程部\n    skills: [yaml]', '    dept: departments/质量部\n    skills: [yaml]')
          .replace('    file: departments/工程部/people/AGENT-2.md', '    file: departments/质量部/people/AGENT-2.md')
          .replace('    functions: [交付]\n    relations: []', '    functions: [交付]\n    relations: []\n  - name: 质量部\n    path: departments/质量部\n    leader: AGENT-2\n    level: 2\n    parent: null\n    lanes: [qa]\n    functions: [质量]\n    relations: []')
        f['departments/质量部/config.yaml'] = 'name: 质量部\npath: departments/质量部\nlevel: 2\nparent: null\nleader: AGENT-2\nfunctions: [质量]\nlanes: [qa]\nreports_to: null\nrelations: []\n'
        f['departments/质量部/people/AGENT-2.md'] = (f['departments/工程部/people/AGENT-2.md'] ?? '').replace('dept: departments/工程部', 'dept: departments/质量部')
        delete f['departments/工程部/people/AGENT-2.md']
      },
    },
    {
      rule: 'C-2', desc: 'charter_ref 指向不存在的章程文件',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('charter_ref: charter.md', 'charter_ref: charter/ghost.md') },
      twin: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('charter_ref: charter.md', 'charter_ref: charter/主章.md')
        f['charter/主章.md'] = '# 章程（分册形态）\n\ncharter/<名>.md 也是章程位。\n'
        delete f['charter.md']
      },
    },
    {
      rule: 'C-3', desc: '部门 leader 悬空（非 people 成员工号）',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    leader: AGENT-1', '    leader: GHOST-9') },
      twin: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    leader: AGENT-1', '    leader: AGENT-2') },
    },
    {
      rule: 'C-4', desc: 'people.file 指向不存在的档案',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    file: departments/工程部/people/AGENT-2.md', '    file: departments/工程部/people/WRONG.md') },
    },
    {
      rule: 'C-4', desc: '档案文件名与工号不一致',
      mutate: (f) => {
        f['departments/工程部/people/AGENT-2.md'] = (f['departments/工程部/people/AGENT-2.md'] ?? '').replace('id: AGENT-2', 'id: AGENT-TWO')
      },
    },
    {
      rule: 'C-5', desc: '部门 config jobs 清单与 org-config jobs 不一致（org 岗未收录）',
      mutate: (f) => {
        f['departments/工程部/config.yaml'] = (f['departments/工程部/config.yaml'] ?? '').replace('jobs:\n  - demo-report\n', 'jobs: []\n')
      },
      twin: (f) => {
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    output: reports/工程部/\n', [
          '    output: reports/工程部/',
          '  - id: demo-audit',
          '    dept: departments/工程部',
          '    cron: "30 18 * * *"',
          '    role: 工程负责人',
          '    level: 2',
          '    type: report',
          '    model_tier: low',
          '    budget_cap: 2',
          '    output: reports/工程部/',
          '',
        ].join('\n'))
        f['departments/工程部/config.yaml'] = (f['departments/工程部/config.yaml'] ?? '').replace('jobs:\n  - demo-report\n', 'jobs:\n  - demo-report\n  - demo-audit\n')
      },
    },
    {
      rule: 'C-6', desc: 'departments.parent 自指成环',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    parent: null', '    parent: departments/工程部', 1) },
    },
    {
      rule: 'C-6', desc: 'departments.parent 悬空（指向未登记 path）',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    parent: null', '    parent: departments/不存在部', 1) },
      twin: (f) => {
        // 合法孪生：真两级部门树（工程部 ← 平台部）
        f['org-config.yaml'] = (f['org-config.yaml'] ?? '')
          .replace('    functions: [交付]\n    relations: []', '    functions: [交付]\n    relations: []\n  - name: 平台部\n    path: departments/平台部\n    leader: AGENT-2\n    level: 2\n    parent: departments/工程部\n    lanes: [core]\n    functions: [平台]\n    relations: []')
          .replace('    dept: departments/工程部\n    skills: [yaml]', '    dept: departments/平台部\n    skills: [yaml]')
          .replace('    file: departments/工程部/people/AGENT-2.md', '    file: departments/平台部/people/AGENT-2.md')
        f['departments/平台部/config.yaml'] = 'name: 平台部\npath: departments/平台部\nlevel: 2\nparent: departments/工程部\nleader: AGENT-2\nfunctions: [平台]\nlanes: [core]\nreports_to: null\nrelations: []\n'
        f['departments/平台部/people/AGENT-2.md'] = (f['departments/工程部/people/AGENT-2.md'] ?? '').replace('dept: departments/工程部', 'dept: departments/平台部')
        delete f['departments/工程部/people/AGENT-2.md']
      },
    },
    {
      rule: 'C-7', desc: 'when.attr 不在六属性封闭枚举（nickname）',
      mutate: (f) => { f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('attr: role', 'attr: nickname') },
      twin: (f) => { f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('attr: role', 'attr: executor') },
    },
    {
      rule: 'C-8', desc: 'level_distribution 总账与 people 实数不一致',
      mutate: (f) => { f['org-config.yaml'] = (f['org-config.yaml'] ?? '').replace('    2: 2', '    2: 5') },
    },
  ]

  for (const c of cases) {
    it(`[${c.rule}] ${c.desc}：违法态 FAIL 指认 + 孪生态 PASS`, async () => {
      const mutant = await materializeBase(path.join(root, 'c', c.rule, slugOf(c.desc)), c.mutate)
      const result = await validateCompanyRepo(mutant)
      expect(result.ok).toBe(false)
      expectRule(result, c.rule)
      const twin = await materializeBase(path.join(root, 'c', c.rule, `${slugOf(c.desc)}-twin`), c.twin)
      const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
    })
  }
})

// ————————————————————————— 4. D 组 · 依赖（docs/51-§五） —————————————————————————

describe('DEV-32 · D 组（依赖契约）——每规则一对夹具', () => {
  it('[D-1] version 约束非法（~1.2 波浪号形态）：FAIL 指认 + 孪生（^1.2）PASS', async () => {
    const mutant = await materializeBase(path.join(root, 'd', 'D-1'), (f) => {
      f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('version: "^1.2"', 'version: "~1.2"')
    })
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'D-1')
    const twin = await materializeBase(path.join(root, 'd', 'D-1-twin'), (f) => {
      f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('version: "^1.2"', 'version: "1.2.0"')
    })
    const twinResult = await validateCompanyRepo(twin)
    expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
  })

  it('[D-2] 约束并集无解=合法但 conflict 警示（不阻断——不装错版本）', async () => {
    const dir = await materializeBase(path.join(root, 'd', 'D-2'), (f) => {
      f['dependencies.yaml'] = [
        'schema: studio-next/dependencies@1',
        'bindings:',
        '  - when:',
        '      attr: role',
        '      is: 工程负责人',
        '    plugins:',
        '      - name: dsh-web-test',
        '        version: "^1.2"',
        '  - when:',
        '      attr: dept',
        '      is: 工程部',
        '    plugins:',
        '      - name: dsh-web-test',
        '        version: "^9.0"',
        '',
      ].join('\n')
    })
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(true) // 合法不阻断
    expect(result.warnings.map((w) => w.rule)).toContain('D-2')
    expect(result.summary?.conflicts.length).toBe(1)
    expect(result.summary?.conflicts[0]?.name).toBe('dsh-web-test')
    // 孪生：并集有解（两绑定同约束）→ 零警示
    const twin = await materializeBase(path.join(root, 'd', 'D-2-twin'), (f) => {
      f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('version: "^9.0"', 'version: "^1.2"')
    })
    const twinResult = await validateCompanyRepo(twin)
    expect(twinResult.ok).toBe(true)
    expect(twinResult.warnings.map((w) => w.rule)).not.toContain('D-2')
  })

  it('[D-3] 绑定插件无仓内源=能力缺失面明示（合法——依赖清单同时是能力声明）', async () => {
    const dir = await materializeBase(path.join(root, 'd', 'D-3'), (f) => {
      f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('name: dsh-web-test', 'name: dsh-ghost')
    })
    const result = await validateCompanyRepo(dir)
    expect(result.ok).toBe(true)
    expect(result.summary?.capabilityMissing.length).toBe(1)
    expect(result.summary?.capabilityMissing[0]?.name).toBe('dsh-ghost')
    expect(result.summary?.capabilityMissing[0]?.detail).toContain('缺源')
    // 孪生：插件补入仓内（源在位）→ 缺失面清空
    const twin = await materializeBase(path.join(root, 'd', 'D-3-twin'), (f) => {
      f['dependencies.yaml'] = (f['dependencies.yaml'] ?? '').replace('name: dsh-web-test', 'name: dsh-ghost')
    })
    await cp(pluginFixture, path.join(twin, 'plugins', 'dsh-ghost'), { recursive: true })
    const twinResult = await validateCompanyRepo(twin)
    expect(twinResult.ok).toBe(true)
    expect(twinResult.summary?.capabilityMissing).toEqual([])
  })

  it('[D-4] plugins/ 形态违规（缺 package.json）：FAIL 指认 + 孪生（完整 dsh 形态）PASS', async () => {
    const mutant = await materializeBase(path.join(root, 'd', 'D-4'))
    await rm(path.join(mutant, 'plugins', 'dsh-web-test', 'package.json'), { force: true })
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'D-4')
    const twin = await materializeBase(path.join(root, 'd', 'D-4-twin'))
    const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
  })

  it('[D-4] dsh.bundle.patch 所指 patch 文件不在仓内：FAIL 指认', async () => {
    const mutant = await materializeBase(path.join(root, 'd', 'D-4-patch'))
    await rm(path.join(mutant, 'plugins', 'dsh-web-test', 'cordis.patch.yml'), { force: true })
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'D-4')
  })
})

// ————————————————————————— 5. E 组 · 卫生（docs/51-§六，闸跑克隆产物） —————————————————————————

describe('DEV-32 · E 组（卫生契约）——每规则一对夹具', () => {
  it('[E-1] 符号链接拒收 + 孪生（真实文件）PASS', async () => {
    const mutant = await materializeBase(path.join(root, 'e', 'E-1'))
    symlinkSync('../charter.md', path.join(mutant, 'docs', 'link.md'))
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'E-1')
    const twin = await materializeBase(path.join(root, 'e', 'E-1-twin'))
    writeFileSync(path.join(twin, 'docs', 'link.md'), '真实文件不是链接\n', 'utf8')
    const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
  })

  it('[E-2] exec 位文件在约定入口外拒收（run.sh）+ 孪生（main 入口带 exec 位=约定内）PASS（R6）', async () => {
    const mutant = await materializeBase(path.join(root, 'e', 'E-2'))
    writeFileSync(path.join(mutant, 'plugins', 'dsh-web-test', 'run.sh'), '#!/bin/sh\n', 'utf8')
    chmodSync(path.join(mutant, 'plugins', 'dsh-web-test', 'run.sh'), 0o755)
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'E-2')
    // 孪生：main=src/index.mjs 带 exec 位——R6 约定入口集内，合法
    const twin = await materializeBase(path.join(root, 'e', 'E-2-twin'))
    chmodSync(path.join(twin, 'plugins', 'dsh-web-test', 'src', 'index.mjs'), 0o755)
    const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
  })

  it('[E-4] 单文件超 8MB 资源护栏 + 孪生（护栏内）PASS', async () => {
    const mutant = await materializeBase(path.join(root, 'e', 'E-4'))
    const big = path.join(mutant, 'docs', 'big.md')
    const chunk = 'x'.repeat(1024 * 1024)
    const fh = await import('node:fs/promises').then((m) => m.open(big, 'w'))
    try {
      for (let i = 0; i < 9; i++) await fh.write(chunk) // 9MB > 8MB
    } finally {
      await fh.close()
    }
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'E-4')
    const twin = await materializeBase(path.join(root, 'e', 'E-4-twin'))
    writeFileSync(path.join(twin, 'docs', 'big.md'), `${chunk.slice(0, 1024)}\n`, 'utf8')
    const twinResult = await validateCompanyRepo(twin)
      expect(twinResult.ok, JSON.stringify(twinResult.violations)).toBe(true)
  })

  it('[E-4] 文件总数超 5000 资源护栏', async () => {
    const mutant = await materializeBase(path.join(root, 'e', 'E-4-count'))
    const bulk = path.join(mutant, 'docs', 'bulk')
    mkdirSync(bulk, { recursive: true })
    // 良基约 13 文件 + 4990 → 5003 份（> 5000 护栏）
    for (let i = 0; i < 4990; i++) writeFileSync(path.join(bulk, `f-${i}.txt`), `${i}\n`, 'utf8')
    const result = await validateCompanyRepo(mutant)
    expect(result.ok).toBe(false)
    expectRule(result, 'E-4')
    expect(result.violations.find((v) => v.rule === 'E-4')?.problem).toContain('文件总数')
  })
})

// ————————————————————————— 6. 面/退出码三角与共用核 —————————————————————————

describe('DEV-32 · 面语义与共用核（docs/51-§七 判定器契约）', () => {
  it('产物面豁免 .studio-next/ 锚（R7）：源面 FAIL、产物面 PASS', async () => {
    const dir = await materializeBase(path.join(root, 'face', 'anchor'))
    mkdirSync(path.join(dir, '.studio-next'), { recursive: true })
    writeFileSync(path.join(dir, '.studio-next', 'trust.json'), '{"trust": false}\n', 'utf8')
    const sourceFace = await validateCompanyRepo(dir, { face: 'source' })
    expect(sourceFace.ok).toBe(false)
    expectRule(sourceFace, 'A-5')
    const productFace = await validateCompanyRepo(dir, { face: 'product' })
    expect(productFace.ok).toBe(true)
  })

  it('产物面照禁 .AIWS/（两面同禁——R7）', async () => {
    const dir = await materializeBase(path.join(root, 'face', 'aiws'))
    mkdirSync(path.join(dir, '.AIWS'), { recursive: true })
    writeFileSync(path.join(dir, '.AIWS', 'x.md'), 'x\n', 'utf8')
    const productFace = await validateCompanyRepo(dir, { face: 'product' })
    expect(productFace.ok).toBe(false)
    expectRule(productFace, 'A-4')
  })

  it('判定目录不存在=判定器自身错误（RepoInputError——CLI exit 2 面，与不合法严格区分）', async () => {
    await expect(validateCompanyRepo(path.join(root, 'face', 'not-exist'))).rejects.toThrow('待判定目录不存在')
  })

  it('DEV-27 导入流两遍共用同一判定器：源仓面+产物面各一跑（validator 注入取证）', async () => {
    const calls: { dir: string; face?: string }[] = []
    const sourceDir = await materializeBase(path.join(root, 'shared', 'source'))
    const workRoot = path.join(root, 'shared', 'work')
    const result = await importCompanyRepo({
      sourceDir,
      targetDir: path.join(workRoot, 'demo-corp'),
      now: () => new Date('2026-10-20T08:00:00.000Z'),
      validator: async (dir, opts) => {
        const r = await validateCompanyRepo(dir, opts)
        calls.push({ dir, face: opts?.face })
        return r
      },
    })
    expect(result.slug).toBe('demo-corp')
    expect(calls.length).toBe(2)
    expect(calls[0]?.face).toBe('source')
    expect(calls[0]?.dir).toBe(sourceDir)
    expect(calls[1]?.face).toBe('product')
    // 产物面跑在镜像+git 重建后、落锚前
    expect(calls[1]?.dir).toBe(result.dir)
    expect(existsSync(path.join(result.dir, '.git'))).toBe(true)
    expect(existsSync(path.join(result.dir, '.studio-next', 'trust.json'))).toBe(true)
    // R2：源仓缺 meta → 产物面框架补写缺省桩并盖戳（导入流唯一写入者语义）
    const meta = await import('node:fs/promises').then((m) => m.readFile(path.join(result.dir, '.studio-next.yaml'), 'utf8'))
    expect(meta).toContain('schema: studio-next/org@1')
    expect(meta).toContain('created_at: "2026-10-20T08:00:00.000Z"')
  })
})

/** 描述 → 目录名（短 slug 化，避免路径过长/非法字符） */
function slugOf(desc: string): string {
  let h = 0
  for (let i = 0; i < desc.length; i++) h = (h * 31 + desc.charCodeAt(i)) >>> 0
  return `case-${h.toString(36)}`
}
