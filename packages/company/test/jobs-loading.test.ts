/**
 * v0.1-M4 jobs 装载测试（04-§三 D9；18-§三「定时岗全部来自公司目录配置」的 company 侧落点）
 *
 * 覆盖：
 *   - 合法 jobs 段 → snapshot.jobs 全字段映射断言（映射表冻结在 validator.ts OrgJobSchema 头注）
 *   - 缺省值链：dept=根部门 / role=type 兜底 / level=company.level / model_tier='low' /
 *     不设 budget_cap / payload 只收 type+output 已定义键
 *   - 非法条目 → DirectoryIssue 带行号（沿 zod 路径回爬既有机制）：缺 id / 缺 cron /
 *     坏 cron 形状（7 段）/ 坏 model_tier / level 界外 / role 与 type 全缺 / 未知键拒收
 *   - 空 jobs 段（jobs: []）与无 jobs 段 → snapshot.jobs = []
 *   - 模板 jobs 段自检：templates/company-2-level/org-config.yaml 必须始终过新 schema
 *     （init 链路的直接回归面——init.test.ts 走全链，此处直击模板与映射）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCompanyDirectory } from '../src/index.ts'

/**
 * M2.2 起 loadCompanyDirectory 缺省做全目录校验（multifile.ts）；本套聚焦 org-config.yaml
 * 的 jobs 段（单文件语料），统一走宽容位 strictFiles:false 保持 v0 语义——多文件面归
 * multifile.test.ts（CASES.md dir 域 v1 语义增补说明 / M2.2-⑨）。
 */
const mount = (yaml: string) => loadCompanyDirectory({ 'org-config.yaml': yaml }, { strictFiles: false })

/** 最小合法骨架（部门/人齐备、交叉规则全绿，第 1-22 行）；jobsBlock 追加在尾部（第 23 行起） */
function orgYaml(jobsBlock: string): string {
  return [
    'schema: org-config/v1', // 1
    'company:', // 2
    '  name: 演示公司', // 3
    '  slug: demo-corp', // 4
    '  charter_ref: charter.md', // 5
    '  level: 2', // 6
    '  level_distribution:', // 7
    '    2: 1', // 8
    'departments:', // 9
    '  - name: 工程部', // 10
    '    path: departments/工程部', // 11
    '    leader: AGENT-1', // 12
    '    level: 2', // 13
    '    parent: null', // 14
    '    lanes: [core]', // 15
    '    functions: [交付]', // 16
    'people:', // 17
    '  - id: AGENT-1', // 18
    '    name: 演示工程师', // 19
    '    login: agent-1', // 20
    '    level: 2', // 21
    '    dept: departments/工程部', // 22
    jobsBlock,
  ].join('\n')
}

describe('jobs 装载（合法段 → snapshot.jobs）', () => {
  it('全字段条目：逐字段映射断言（id→job_id、裸数→Money、type/output→payload）', () => {
    const yaml = orgYaml([
      'jobs:', // 23
      '  - id: health-patrol-工程部', // 24
      '    dept: departments/工程部', // 25
      '    cron: "*/5 * * * *"', // 26
      '    role: 工程负责人', // 27
      '    level: 2', // 28
      '    type: patrol', // 29
      '    model_tier: low', // 30
      '    budget_cap: 1', // 31
      '    output: reports/工程部/', // 32
    ].join('\n'))
    const r = mount(yaml)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.jobs).toHaveLength(1)
      expect(r.snapshot.jobs[0]).toEqual({
        job_id: 'health-patrol-工程部',
        company: 'demo-corp', // company.slug 注入（D9：快照即本司）
        dept: 'departments/工程部',
        cron: '*/5 * * * *',
        role: '工程负责人',
        level: 2,
        model_tier: 'low',
        budget_cap: { usd: 1 }, // 裸数 → Money 形状变换（M4-⑦）
        payload: { type: 'patrol', output: 'reports/工程部/' }, // M4-④
      })
    }
  })

  it('最小条目（仅 id/cron/type）：缺省值全链（dept=根部门、role=type 兜底、level=company.level、model_tier=low、不设帽）', () => {
    const yaml = orgYaml([
      'jobs:', // 23
      '  - id: patrol-only', // 24
      '    cron: "0 8 * * *"', // 25
      '    type: patrol', // 26
    ].join('\n'))
    const r = mount(yaml)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.jobs[0]).toEqual({
        job_id: 'patrol-only',
        company: 'demo-corp',
        dept: 'departments/工程部', // 缺省=根部门（首个 parent:null——M4-①）
        cron: '0 8 * * *',
        role: 'patrol', // 缺 role 以 type 兜底（M4-②）
        level: 2, // 缺省=company.level（M4-⑤）
        model_tier: 'low', // 缺省（M4-⑥）
        payload: { type: 'patrol' },
      })
    }
  })

  it('仅 role（无 type/output）：payload 不设键', () => {
    const yaml = orgYaml([
      'jobs:', // 23
      '  - id: manual-audit', // 24
      '    cron: "0 9 * * 1"', // 25
      '    role: verifier', // 26
    ].join('\n'))
    const r = mount(yaml)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.jobs[0]?.role).toBe('verifier')
      expect(r.snapshot.jobs[0]?.payload).toBeUndefined()
      expect(r.snapshot.jobs[0]?.budget_cap).toBeUndefined()
    }
  })

  it('空 jobs 段（jobs: []）与无 jobs 段 → snapshot.jobs = []', () => {
    const empty = mount(orgYaml('jobs: []'))
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.snapshot.jobs).toEqual([])

    const absent = mount(orgYaml(''))
    expect(absent.ok).toBe(true)
    if (absent.ok) expect(absent.snapshot.jobs).toEqual([])
  })
})

describe('jobs 非法条目 → DirectoryIssue 带行号', () => {
  const mountJobs = (jobsBlock: string) => mount(orgYaml(jobsBlock))
  /** 断言恰好命中一条目标规则并返回它 */
  function mustIssue(r: ReturnType<typeof mount>, rule: string) {
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const issue = r.issues.find((i) => i.rule === rule)
      expect(issue).toBeDefined()
      expect(issue?.fix).toBeTruthy()
      return issue
    }
    return undefined
  }

  it('缺 id → 定位到条目起始行（第 24 行）', () => {
    const r = mountJobs(['jobs:', '  - cron: "*/5 * * * *"', '    type: patrol'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.id')
    expect(issue?.line).toBe(24)
  })

  it('缺 cron → 定位到条目起始行（第 24 行）', () => {
    const r = mountJobs(['jobs:', '  - id: no-cron', '    type: patrol'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.cron')
    expect(issue?.line).toBe(24)
  })

  it('坏 cron 形状（7 段）→ 定位到 cron 行（第 25 行），修法含形状口径', () => {
    const r = mountJobs(['jobs:', '  - id: bad-cron', '    cron: "* * * * * * *"', '    type: patrol'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.cron')
    expect(issue?.line).toBe(25)
    expect(issue?.fix).toContain('至多 6 个空白分隔段')
  })

  it('坏 model_tier（ultra）→ 定位到 model_tier 行（第 26 行）', () => {
    const r = mountJobs(['jobs:', '  - id: bad-tier', '    cron: "*/5 * * * *"', '    model_tier: ultra'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.model_tier')
    expect(issue?.line).toBe(26)
    expect(issue?.fix).toContain('high')
  })

  it('level 界外（10 > 9）→ 定位到 level 行（第 26 行）', () => {
    const r = mountJobs(['jobs:', '  - id: bad-level', '    cron: "*/5 * * * *"', '    level: 10'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.level')
    expect(issue?.line).toBe(26)
  })

  it('role 与 type 全缺 → 定位到条目起始行（第 24 行），修法给兜底规则', () => {
    const r = mountJobs(['jobs:', '  - id: no-role-type', '    cron: "0 8 * * *"'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0')
    expect(issue?.line).toBe(24)
    expect(issue?.fix).toContain('至少给其一')
  })

  it('未知键拒收（strictObject，与 departments/people 同纪律）→ 定位到条目行（第 24 行）', () => {
    const r = mountJobs(['jobs:', '  - id: extra-key', '    cron: "*/5 * * * *"', '    type: patrol', '    note: 不在契约'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0')
    expect(issue?.line).toBe(24)
    expect(issue?.fix).toContain('Unrecognized')
  })
})

describe('模板 jobs 段自检（init 链路回归面）', () => {
  it('templates/company-2-level/org-config.yaml 过新 schema，两样例岗全字段装载', () => {
    const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/company-2-level')
    const template = readFileSync(path.join(templateDir, 'org-config.yaml'), 'utf8')
    const r = mount(template)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.slug).toBe('example-corp')
      expect(r.snapshot.jobs.map((j) => j.job_id)).toEqual(['health-patrol-工程部', 'daily-report-工程部'])
      expect(r.snapshot.jobs[0]).toEqual({
        job_id: 'health-patrol-工程部',
        company: 'example-corp',
        dept: 'departments/工程部',
        cron: '*/5 * * * *',
        role: '工程负责人',
        level: 2,
        model_tier: 'low',
        budget_cap: { usd: 1 },
        payload: { type: 'patrol', output: 'reports/工程部/' },
      })
      expect(r.snapshot.jobs[1]?.cron).toBe('0 18 * * *')
      expect(r.snapshot.jobs[1]?.payload).toEqual({ type: 'report', output: 'reports/工程部/' })
    }
  })
})
