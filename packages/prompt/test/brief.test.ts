/**
 * brief 测试 —— 17-§5 两模板：首版四要素（单号/验收命令/文档章节引用/AGENTS.md 通道说明）、
 * 续跑版前情摘要（上次 summary.json 注入）/ 缺 resume fail-loud / TaskBrief 形状对齐（kernel.ts）/
 * 通道三分支文案 / 纯函数。
 */
import { describe, expect, it } from 'vitest'
import type { SummarySidecar, TaskBrief } from '@studio-next/contract'
import { renderTaskBrief, type BriefContext } from '../src/brief.ts'

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

describe('纯函数性', () => {
  it('同输入恒同输出（双跑 text/taskBrief 全等）', () => {
    const a = renderTaskBrief('resume', { ...baseCtx(), resume: { sessionId: 's', summaryPath: '/p', summary: SUMMARY } })
    const b = renderTaskBrief('resume', { ...baseCtx(), resume: { sessionId: 's', summaryPath: '/p', summary: SUMMARY } })
    expect(a.text).toBe(b.text)
    expect(a.taskBrief).toEqual(b.taskBrief)
  })
})
