/**
 * brief 测试 —— 17-§5 两模板：首版四要素（单号/验收命令/文档章节引用/AGENTS.md 通道说明）、
 * 续跑版前情摘要（上次 summary.json 注入）/ 缺 resume fail-loud / TaskBrief 形状对齐（kernel.ts）/
 * 通道三分支文案 / 纯函数。
 */
import { describe, expect, it } from 'vitest'
import type { SummarySidecar, TaskBrief } from '@studio-next/contract'
import { renderTaskBrief, SIZE_GATE_MAX_LINES_PER_FILE, type BriefContext } from '../src/brief.ts'

const SUMMARY: SummarySidecar = {
  schema: 'summary/v1',
  conclusion: '装配器首刀完成，指纹/裁剪/隔离全绿',
  changed_files: ['packages/prompt/src/layers.ts', 'packages/prompt/src/trim.ts'],
  rejection_reason: '验收命令被改动——冻结口径禁改，退回',
}

function baseCtx(): BriefContext {
  return {
    ticket: 'STUDIO-110',
    attempt: 1,
    workspace: '/lanes/main/.worktrees/STUDIO-110',
    briefPath: '/lanes/main/.worktrees/STUDIO-110/BRIEF.md',
    agentsChannel: { channel: 'user_level', target: '/Users/w/.dsh/AGENTS.md' },
    acceptance: ['bun run typecheck', 'bun run test'],
    docRefs: ['docs/17-§5（装配管线全图）', 'docs/01-需求-公司面.md C2 节'],
    objective: 'prompt 包 L0-L5 装配器首刀',
  }
}

describe('首版模板（17-§5：单号/验收命令/文档章节引用/AGENTS.md 通道说明）', () => {
  it('四要素齐：单号+尝试次数、验收命令逐字、文档章节、通道说明', () => {
    const r = renderTaskBrief('first', baseCtx())
    expect(r.text).toContain('# 任务书 · STUDIO-110（第 1 次尝试 · 首次派发）')
    expect(r.text).toContain('```bash\nbun run typecheck\nbun run test\n```')
    expect(r.text).toContain('- docs/17-§5（装配管线全图）')
    expect(r.text).toContain('- docs/01-需求-公司面.md C2 节')
    expect(r.text).toContain('AGENTS.md 用户级通道：`/Users/w/.dsh/AGENTS.md`')
    expect(r.text).toContain('workspace：`/lanes/main/.worktrees/STUDIO-110`')
    expect(r.text).toContain('任务书落盘：`/lanes/main/.worktrees/STUDIO-110/BRIEF.md`')
    // 开工自检段（2026-11-01 轨1 R1——269/320 教训固化：绝对路径+工具自检+如实申报）
    expect(r.text).toContain('## 开工自检（首步必做')
    expect(r.text).toContain('相对路径先换算绝对再访问')
    expect(r.text).toContain('禁止按错误假设默默干完再交差')
  })

  it('首版不含前情摘要节', () => {
    expect(renderTaskBrief('first', baseCtx()).text).not.toContain('前情摘要')
  })

  it('验收口径/文档引用为空 → throw（无验收不派工/文档先行）', () => {
    expect(() => renderTaskBrief('first', { ...baseCtx(), acceptance: [] })).toThrow(/验收口径为空/)
    expect(() => renderTaskBrief('first', { ...baseCtx(), docRefs: [] })).toThrow(/文档章节引用为空/)
  })

  it('attempt<1 → throw', () => {
    expect(() => renderTaskBrief('first', { ...baseCtx(), attempt: 0 })).toThrow(/attempt/)
  })
})

describe('续跑版模板（前情摘要=上次 summary.json 注入）', () => {
  const resumeCtx: BriefContext = {
    ...baseCtx(),
    attempt: 2,
    resume: { sessionId: 'sess-abc123', summaryPath: '/evidence/STUDIO-110.summary.json', summary: SUMMARY },
  }

  it('多「前情摘要」节：结论/改动文件/打回理由/上次会话/摘要文件全注入', () => {
    const r = renderTaskBrief('resume', resumeCtx)
    expect(r.text).toContain('第 2 次尝试 · 续跑')
    expect(r.text).toContain('## 前情摘要（上次 summary.json 注入')
    expect(r.text).toContain('- 结论：装配器首刀完成，指纹/裁剪/隔离全绿')
    expect(r.text).toContain('`packages/prompt/src/layers.ts`')
    expect(r.text).toContain('`packages/prompt/src/trim.ts`')
    expect(r.text).toContain('- 打回理由（本次须针对性回应）：验收命令被改动——冻结口径禁改，退回')
    expect(r.text).toContain('`sess-abc123`')
    expect(r.text).toContain('`/evidence/STUDIO-110.summary.json`')
  })

  it('改动文件为空 → 显式「无改动文件」，不静默空节', () => {
    const r = renderTaskBrief('resume', {
      ...resumeCtx,
      resume: {
        sessionId: 's2',
        summaryPath: '/x.json',
        summary: { ...SUMMARY, changed_files: [], rejection_reason: undefined },
      },
    })
    expect(r.text).toContain('（无改动文件——纯分析/评审单）')
    expect(r.text).not.toContain('打回理由')
  })

  it('缺 resume → throw（不静默降级为首版）', () => {
    expect(() => renderTaskBrief('resume', baseCtx())).toThrow(/必须带 resume/)
  })
})

describe('TaskBrief 形状对齐（contract kernel.ts——executor 输入对端）', () => {
  it('首版：ticket/attempt/briefPath/workspace/AGENTS_MD 通道逐字段对齐；无 resume/budgetCap', () => {
    const { taskBrief } = renderTaskBrief('first', baseCtx())
    const expected: TaskBrief = {
      ticket: 'STUDIO-110',
      attempt: 1,
      briefPath: '/lanes/main/.worktrees/STUDIO-110/BRIEF.md',
      workspace: '/lanes/main/.worktrees/STUDIO-110',
      AGENTS_MD: { channel: 'user_level', target: '/Users/w/.dsh/AGENTS.md' },
    }
    expect(taskBrief).toEqual(expected)
    expect('resume' in taskBrief).toBe(false)
    expect('budgetCap' in taskBrief).toBe(false)
  })

  it('续跑+预算：resume{sessionId,summaryPath} 与 budgetCap{usd} 按需带', () => {
    const { taskBrief } = renderTaskBrief('resume', {
      ...baseCtx(),
      attempt: 2,
      budgetCapUsd: 3.5,
      resume: { sessionId: 's1', summaryPath: '/x.json', summary: SUMMARY },
    })
    expect(taskBrief.resume).toEqual({ sessionId: 's1', summaryPath: '/x.json' })
    expect(taskBrief.budgetCap).toEqual({ usd: 3.5 })
    // 预算上限也进任务书正文（worker 可见）
  })

  it('预算上限进正文（超限即停如实上报）', () => {
    const r = renderTaskBrief('first', { ...baseCtx(), budgetCapUsd: 2 })
    expect(r.text).toContain('$2（超限即停并如实上报')
  })
})

describe('通道说明三分支（04-§六 B5：用户级优先 / claude<2.1.277 回退）', () => {
  it('native：工作区根落点+不覆盖已有说明', () => {
    const r = renderTaskBrief('first', {
      ...baseCtx(),
      agentsChannel: { channel: 'native', target: '/ws/AGENTS.md' },
    })
    expect(r.text).toContain('AGENTS.md 原生通道：落 `/ws/AGENTS.md`')
    expect(r.text).toContain('不覆盖')
  })

  it('append_system_prompt：--append-system-prompt-file 回退说明', () => {
    const r = renderTaskBrief('first', {
      ...baseCtx(),
      agentsChannel: { channel: 'append_system_prompt', target: '/tmp/sp.md' },
    })
    expect(r.text).toContain('--append-system-prompt-file 注入：`/tmp/sp.md`')
    expect(r.text).toContain('claude<2.1.277')
  })
})

describe('行数阈硬约束 + 交付自检清单（docs/17-§5.1，studio-dev-576：撞阈必须真拆，禁折行凑数）', () => {
  it('首版恒注入硬约束节：阈值/判定/真拆两形态/凑数六类/规则源/判定要义', () => {
    const t = renderTaskBrief('first', baseCtx()).text
    expect(t).toContain('## 行数阈硬约束（撞阈必须真拆——禁止折注释/删空行/压缩语句凑行数，否则验证必判负；docs/17-§5.1）')
    expect(t).toContain('文件改动后 >600 行必须拆')
    expect(t).toContain('scripts/guards/boundary-rules.mjs')
    expect(t).toContain('bun run guard:boundaries`（违例码 BC-S2')
    // 真拆两形态（SG-3）：新建文件 / 抽函数到更低层模块
    expect(t).toContain('撞阈唯一合法处置=**真拆**：①新建文件')
    expect(t).toContain('②抽函数/类型到既有更低层模块')
    // 凑数六类（SG-4）：折注释/删空行/语句压行/压缩 JSON/删测试/藏字符串
    expect(t).toContain('折叠注释（多行注释压单行/删注释正文/JSDoc 删段）')
    expect(t).toContain('删/合并空行')
    expect(t).toContain('语句压行（多语句同行、块压一行、删格式化换行）')
    expect(t).toContain('压缩 JSON/数组/对象换行')
    expect(t).toContain('删减或跳过测试/缩水断言')
    expect(t).toContain('把代码藏进字符串/模板/外部文件绕行数')
    expect(t).toContain('测试全绿、验收 exit=0 也判 Q6 判负退回')
    expect(t).toContain('行数下降 ∧ 无新增文件 ∧ 无抽函数 = 凑数')
  })

  it('「交付自检清单」四问逐条在场（①行数前后 ②真拆证据 ③凑数自查 ④基线距离）', () => {
    const t = renderTaskBrief('first', baseCtx()).text
    expect(t).toContain('## 交付自检清单（改完必须逐项自报进 REPORT——缺项=未完成；docs/17-§5.1）')
    expect(t).toContain('- ① 行数前后：每个改动文件 `wc -l` 改动前 → 改动后（逐文件列，禁合计口径）')
    expect(t).toContain('- ② 真拆证据：新增文件路径 / 抽出的函数与其落点')
    expect(t).toContain('- ③ 凑数自查：折注释 / 删空行 / 压缩语句 / 删改测试——逐项「是·否」')
    expect(t).toContain('- ④ 基线距离：`maxLinesPerFile − wc -l`（即 600 − 改动后行数）')
  })

  it('续跑版同构注入（前情摘要不替代硬约束）', () => {
    const t = renderTaskBrief('resume', {
      ...baseCtx(),
      attempt: 2,
      resume: { sessionId: 's9', summaryPath: '/x.json', summary: { ...SUMMARY, rejection_reason: 'Q6 折注释凑行数' } },
    }).text
    expect(t).toContain('## 前情摘要')
    expect(t).toContain('Q6 折注释凑行数')
    expect(t).toContain('## 行数阈硬约束')
    expect(t).toContain('## 交付自检清单')
  })

  it('段序：开工自检之后、预算上限之前（per-attempt 操作面，不破 AGENTS.md 层序）', () => {
    const t = renderTaskBrief('first', { ...baseCtx(), budgetCapUsd: 5 }).text
    const selfCheckAt = t.indexOf('## 开工自检')
    const sizeAt = t.indexOf('## 行数阈硬约束')
    const listAt = t.indexOf('## 交付自检清单')
    const budgetAt = t.indexOf('## 预算上限')
    expect(selfCheckAt).toBeGreaterThan(-1)
    expect(sizeAt).toBeGreaterThan(selfCheckAt)
    expect(listAt).toBeGreaterThan(sizeAt)
    expect(budgetAt).toBeGreaterThan(listAt)
  })

  it('阈值文案随常量渲染（不硬编码第二处 600，防文案漂移）', () => {
    expect(SIZE_GATE_MAX_LINES_PER_FILE).toBe(600)
    const t = renderTaskBrief('first', baseCtx()).text
    expect(t).toContain(`文件改动后 >${SIZE_GATE_MAX_LINES_PER_FILE} 行必须拆`)
    expect(t).toContain(`即 ${SIZE_GATE_MAX_LINES_PER_FILE} − 改动后行数`)
  })
})

describe('纯函数性', () => {
  it('同输入恒同输出（双跑 text/taskBrief 全等）', () => {
    const a = renderTaskBrief('resume', { ...baseCtx(), resume: { sessionId: 's', summaryPath: '/p', summary: SUMMARY } })
    const b = renderTaskBrief('resume', { ...baseCtx(), resume: { sessionId: 's', summaryPath: '/p', summary: SUMMARY } })
    expect(a.text).toBe(b.text)
    expect(a.taskBrief).toEqual(b.taskBrief)
  })
})
