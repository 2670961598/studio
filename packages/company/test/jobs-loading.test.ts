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
 *   - v0.1-M5 岗位运作规格（docs/35-§3，制作人 2026-10-19 批复）：cadence 五档位装载期
 *     展开 + at 锚覆盖 + outputs/sla/escalate 装载（时长→ms）+ 形状闸（triggers 无
 *     cadence / cron 与 cadence 双写或全缺 / hourly+at / daily+d 锚 / 坏 at / 空 sla /
 *     坏时长 / 空 unacked / outputs 空串）+ cadence.ts 纯函数（时长解析 / ops 读视图）
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

  it('缺 cron 且缺 triggers.cadence（M5-⓪ 恰给其一）→ 定位到条目起始行（第 24 行）', () => {
    const r = mountJobs(['jobs:', '  - id: no-cron', '    type: patrol'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0')
    expect(issue?.line).toBe(24)
    expect(issue?.fix).toContain('恰给其一')
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

// ————————————————————————— v0.1-M5 岗位运作规格（docs/35-§3，制作人 2026-10-19 批复） —————————————————————————

describe('cadence 五档位解析（triggers.cadence → 装载期展开 cron + payload 留档）', () => {
  const TIERS: Array<[string, string]> = [
    ['hourly', '0 * * * *'],
    ['daily', '0 9 * * *'],
    ['weekly', '0 9 * * 1'],
    ['monthly', '0 9 1 * *'],
    ['quarterly', '0 9 1 */3 *'],
  ]
  for (const [tier, cron] of TIERS) {
    it(`${tier} → cron='${cron}'（缺省时刻表 M5-①）+ payload.cadence_tier 留档`, () => {
      const r = mount(orgYaml(['jobs:', `  - id: tier-${tier}`, '    role: 巡检岗', '    triggers:', `      cadence: ${tier}`].join('\n')))
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.snapshot.jobs[0]?.cron).toBe(cron)
        expect(r.snapshot.jobs[0]?.payload).toEqual({ cadence_tier: tier })
      }
    })
  }

  it('at 锚覆盖：daily "18:30" → 30 18 * * *；monthly "d+1 09:00" → 0 9 1 * *；quarterly "d15 08:00" → 0 8 15 */3 *', () => {
    const cases: Array<[string, string, string]> = [
      ['daily', '18:30', '30 18 * * *'],
      ['monthly', 'd+1 09:00', '0 9 1 * *'],
      ['quarterly', 'd15 08:00', '0 8 15 */3 *'],
    ]
    for (const [tier, at, cron] of cases) {
      const r = mount(orgYaml(['jobs:', `  - id: at-${tier}`, '    role: 报表岗', '    triggers:', `      cadence: ${tier}`, `      at: "${at}"`].join('\n')))
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.snapshot.jobs[0]?.cron).toBe(cron)
        expect(r.snapshot.jobs[0]?.payload).toEqual({ cadence_tier: tier, cadence_at: at })
      }
    }
  })
})

describe('岗位运作规格装载（outputs/sla/escalate → payload，M5-④⑤⑥）', () => {
  it('值守岗全段例（docs/35-§3 qa-oncall 同形）：时长→ms、链档透传、产出物清单', () => {
    const yaml = orgYaml([
      'jobs:', // 23
      '  - id: qa-oncall', // 24
      '    role: qa', // 25
      '    triggers:', // 26
      '      cadence: hourly', // 27
      '    sla: { first-ack: 15m, resolve-hint: 4h }', // 28
      '    escalate:', // 29
      '      - { after: 15m, unacked: notify-backup }', // 30
      '      - { after: 1h, unacked: notify-prime }', // 31
      '    outputs: [值守日志]', // 32
    ].join('\n'))
    const r = mount(yaml)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.jobs[0]).toEqual({
        job_id: 'qa-oncall',
        company: 'demo-corp',
        dept: 'departments/工程部',
        cron: '0 * * * *',
        role: 'qa',
        level: 2,
        model_tier: 'low',
        payload: {
          cadence_tier: 'hourly',
          outputs: ['值守日志'],
          sla: { first_ack_ms: 900_000, resolve_hint_ms: 14_400_000 },
          escalate: [
            { after_ms: 900_000, unacked: 'notify-backup' },
            { after_ms: 3_600_000, unacked: 'notify-prime' },
          ],
        },
      })
    }
  })

  it('cron 直写岗 + sla/outputs 并存（无 triggers 段也收 sla 面——SLA 不限档位岗）', () => {
    const r = mount(orgYaml(['jobs:', '  - id: plain-with-sla', '    cron: "*/5 * * * *"', '    role: verifier', '    sla: { first-ack: 30s }', '    outputs: [态势表, 预算对账]'].join('\n')))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.jobs[0]?.cron).toBe('*/5 * * * *')
      expect(r.snapshot.jobs[0]?.payload).toEqual({ sla: { first_ack_ms: 30_000 }, outputs: ['态势表', '预算对账'] })
    }
  })
})

describe('岗位运作规格形状闸（非法段 → DirectoryIssue）', () => {
  const mountJobs = (jobsBlock: string) => mount(orgYaml(jobsBlock))
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

  it('triggers 无 cadence（at 单独出现）→ 拒收', () => {
    const r = mountJobs(['jobs:', '  - id: at-alone', '    role: 巡检岗', '    triggers:', '      at: "09:00"'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0.triggers')
    expect(issue?.fix).toContain('至少给 cadence')
  })

  it('cron 与 triggers.cadence 双写 → 拒收（恰给其一，M5-⓪）', () => {
    const r = mountJobs(['jobs:', '  - id: both', '    cron: "0 8 * * *"', '    role: 巡检岗', '    triggers:', '      cadence: daily'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0')
    expect(issue?.fix).toContain('恰给其一')
  })

  it('cron 与 cadence 全缺 → 拒收（档位/自定义表达式必给其一）', () => {
    const r = mountJobs(['jobs:', '  - id: neither', '    role: 巡检岗'].join('\n'))
    const issue = mustIssue(r, 'org-config/missing-field:jobs.0')
    expect(issue?.fix).toContain('恰给其一')
  })

  it('hourly + at → 拒收（整点档无从锚时刻）', () => {
    const r = mountJobs(['jobs:', '  - id: hourly-at', '    role: 巡检岗', '    triggers:', '      cadence: hourly', '      at: "09:00"'].join('\n'))
    mustIssue(r, 'org-config/missing-field:jobs.0.triggers')
  })

  it('daily + d 日锚 → 拒收（无日语义）', () => {
    const r = mountJobs(['jobs:', '  - id: daily-d', '    role: 报表岗', '    triggers:', '      cadence: daily', '      at: "d3 09:00"'].join('\n'))
    mustIssue(r, 'org-config/missing-field:jobs.0.triggers')
  })

  it('at 时刻非法（25:00 / 9am）→ 拒收', () => {
    for (const at of ['25:00', '9am', '09']) {
      const r = mountJobs(['jobs:', '  - id: bad-at', '    role: 报表岗', '    triggers:', '      cadence: daily', `      at: "${at}"`].join('\n'))
      mustIssue(r, 'org-config/missing-field:jobs.0.triggers')
    }
  })

  it('sla 空段（两键全缺）→ 拒收；坏时长（15x）→ 拒收', () => {
    const empty = mountJobs(['jobs:', '  - id: sla-empty', '    cron: "0 8 * * *"', '    role: verifier', '    sla: {}'].join('\n'))
    const issue = mustIssue(empty, 'org-config/missing-field:jobs.0.sla')
    expect(issue?.fix).toContain('其一')

    const bad = mountJobs(['jobs:', '  - id: sla-bad', '    cron: "0 8 * * *"', '    role: verifier', '    sla: { first-ack: 15x }'].join('\n'))
    mustIssue(bad, 'org-config/missing-field:jobs.0.sla.first-ack')
  })

  it('escalate 坏时长 / 空 unacked → 拒收', () => {
    const badDur = mountJobs(['jobs:', '  - id: esc-bad', '    cron: "0 8 * * *"', '    role: verifier', '    escalate:', '      - { after: 15min, unacked: notify-backup }'].join('\n'))
    mustIssue(badDur, 'org-config/missing-field:jobs.0.escalate.0.after')

    const badTarget = mountJobs(['jobs:', '  - id: esc-empty', '    cron: "0 8 * * *"', '    role: verifier', '    escalate:', '      - { after: 15m, unacked: "" }'].join('\n'))
    mustIssue(badTarget, 'org-config/missing-field:jobs.0.escalate.0.unacked')
  })

  it('outputs 含空串 → 拒收（strictObject 同纪律的数组面）', () => {
    const r = mountJobs(['jobs:', '  - id: bad-outputs', '    cron: "0 8 * * *"', '    role: verifier', '    outputs: [态势表, ""]'].join('\n'))
    mustIssue(r, 'org-config/missing-field:jobs.0.outputs.1')
  })
})

describe('cadence 解析面纯函数（src/cadence.ts——daemon 读视图同源）', () => {
  it('parseJobDuration：四单位正解、零/复合/超界拒收', async () => {
    const { parseJobDuration } = await import('../src/cadence.ts')
    expect(parseJobDuration('30s')).toBe(30_000)
    expect(parseJobDuration('15m')).toBe(900_000)
    expect(parseJobDuration('4h')).toBe(14_400_000)
    expect(parseJobDuration('2d')).toBe(172_800_000)
    expect(parseJobDuration('0m')).toBeNull()
    expect(parseJobDuration('1h30m')).toBeNull()
    expect(parseJobDuration('15x')).toBeNull()
    expect(parseJobDuration('400d')).toBeNull() // 上界 366d
  })

  it('parseJobOps：合法 payload 全段读出；垃圾输入宽容读零崩', async () => {
    const { parseJobOps } = await import('../src/cadence.ts')
    expect(parseJobOps({ cadence_tier: 'monthly', cadence_at: 'd+1 09:00', outputs: ['月结报表'], sla: { first_ack_ms: 900_000 }, escalate: [{ after_ms: 3_600_000, unacked: 'notify-prime' }] })).toEqual({
      cadence: { tier: 'monthly', at: 'd+1 09:00' },
      outputs: ['月结报表'],
      sla: { first_ack_ms: 900_000 },
      escalate: [{ after_ms: 3_600_000, unacked: 'notify-prime' }],
    })
    expect(parseJobOps(undefined)).toEqual({})
    expect(parseJobOps('nonsense')).toEqual({})
    expect(parseJobOps({ cadence_tier: 'biannual', sla: 'x', escalate: [null, { after_ms: -1, unacked: 'x' }] })).toEqual({}) // 坏段不进结果
  })
})
