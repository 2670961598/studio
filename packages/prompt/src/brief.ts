/**
 * brief —— 任务书两模板（docs/17-§5 / 04-§六，需求 F1-15 侧）
 *
 * 规格依据（实现单引用）：
 *   - 17-§5：任务书两版——首次版 / 续跑版（续跑版含前情摘要 = 上次 summary.json）。
 *   - 17-§3 末行 / B4 / F1-15：REPORT 旁落 summary.json sidecar（结论/改动文件/打回理由）
 *     供续跑前情摘要——本模板把它注入续跑版「前情摘要」节。
 *   - kernel.ts TaskBrief：装配管线的输出对端（executor 输入形状）——本包返回文本与
 *     TaskBrief 形状对齐的对象，**落盘归 daemon**（本包零盘 IO）。
 *   - 纪律 1/3：文档章节引用必填（文档先行）；验收口径必填（无证据=无完成）。
 *
 * 【拟稿待批】
 *   - 前情摘要 ≤300 字（prompt 包骨架头注口径）：本刀不截断 sidecar 字段（sidecar 本身
 *     是结构化短字段；若批示要求硬上限，由 daemon 注入前截——拟稿记录）。
 *   - 通道说明三分支文案（native/user_level/append_system_prompt）为拟稿措辞，
 *     落点规则细节（备份/改名/.git/info/exclude）归 daemon 与适配器执行，这里只做说明注入。
 *
 * 纯函数纪律：同输入恒同输出；零盘 IO；零时间/随机内取。
 */
import type { AttemptNo, SummarySidecar, TaskBrief, TicketId } from '@studio-next/contract'

export type BriefKind = 'first' | 'resume'

/** 任务书上下文（一切内容参数注入；summary 为上次 summary.json 解析后的 sidecar） */
export interface BriefContext {
  ticket: TicketId
  attempt: AttemptNo
  /** 工位（worktree 路径） */
  workspace: string
  /** 任务书落盘路径（daemon 写入；本包只回填进 TaskBrief 与正文说明） */
  briefPath: string
  /** AGENTS.md 通道（04-§六 B5：用户级通道优先；claude<2.1.277 回退 append） */
  agentsChannel: TaskBrief['AGENTS_MD']
  /** 冻结验收命令（一命令一行；冻结后禁改） */
  acceptance: string[]
  /** 文档章节引用（实现单必须引用章节号——纪律 1） */
  docRefs: string[]
  /** 目标一句话 */
  objective: string
  /** 预算上限（美元；缺省=不限） */
  budgetCapUsd?: number
  /** 续跑必填：上次会话与 summary.json（17-§5 续跑版=前情摘要注入） */
  resume?: {
    sessionId: string
    summaryPath: string
    /** 上次 summary.json 内容（SummarySidecar 形状，contract schemas/report.ts） */
    summary: SummarySidecar
    /** 续跑缘由（202-P1：策划验收打回理由等——前情摘要节追加「本次续跑缘由」行；缺省无行） */
    note?: string
  }
}

/** 渲染结果：任务书全文 + contract TaskBrief 形状对齐对象（落盘归 daemon） */
export interface BriefRenderResult {
  kind: BriefKind
  /** 任务书 markdown 全文（即 briefPath 处落盘的内容字符串） */
  text: string
  /** 与 kernel.ts TaskBrief 形状对齐（executor 输入；resume/budgetCap 按需带） */
  taskBrief: TaskBrief
}

/** 三通道说明文案（拟稿措辞，见文件头注） */
function channelNote(c: TaskBrief['AGENTS_MD']): string {
  switch (c.channel) {
    case 'native':
      return `AGENTS.md 原生通道：落 \`${c.target}\`（工作区根）。若该处已有 AGENTS.md，不覆盖——改名或先备份并写 .git/info/exclude`
    case 'user_level':
      return `AGENTS.md 用户级通道：\`${c.target}\`（$DSH_HOME/$KIMI_CODE_HOME/$CODEX_HOME 一类用户级落点；compact 后从磁盘重注入，抗压缩）`
    case 'append_system_prompt':
      return `持久指令经 --append-system-prompt-file 注入：\`${c.target}\`（claude<2.1.277 的回退通道）`
  }
}

/** 任务书两模板渲染：first=首版；resume=续跑版（多「前情摘要」节=上次 summary.json 注入） */
export function renderTaskBrief(kind: BriefKind, ctx: BriefContext): BriefRenderResult {
  if (ctx.acceptance.length === 0) {
    throw new Error('prompt/brief: 验收口径为空——无验收不派工（纪律 3：无证据=无完成）')
  }
  if (ctx.docRefs.length === 0) {
    throw new Error('prompt/brief: 文档章节引用为空——实现单必须引用设计文档章节号（纪律 1：文档先行）')
  }
  if (ctx.attempt < 1) throw new Error('prompt/brief: attempt 必须 ≥1')

  const kindLabel = kind === 'first' ? '首次派发' : '续跑'
  const parts: string[] = [
    `# 任务书 · ${ctx.ticket}（第 ${ctx.attempt} 次尝试 · ${kindLabel}）`,
    '',
    '## 目标',
    ctx.objective,
  ]

  if (kind === 'resume') {
    if (ctx.resume === undefined) {
      throw new Error('prompt/brief: 续跑版必须带 resume（上次 sessionId+summary.json）——不静默降级为首版')
    }
    const { sessionId, summaryPath, summary } = ctx.resume
    const changed =
      summary.changed_files.length > 0
        ? summary.changed_files.map((f) => `  - \`${f}\``).join('\n')
        : '  - （无改动文件——纯分析/评审单）'
    parts.push(
      '## 前情摘要（上次 summary.json 注入——先读再干，勿重做已完成）',
      `- 上次会话：\`${sessionId}\`；摘要文件：\`${summaryPath}\``,
      `- 结论：${summary.conclusion}`,
      '- 改动文件：',
      changed,
    )
    if (summary.rejection_reason !== undefined) {
      parts.push(`- 打回理由（本次须针对性回应）：${summary.rejection_reason}`)
    }
    if (ctx.resume.note !== undefined) {
      parts.push(`- 本次续跑缘由（批示注入）：${ctx.resume.note}`)
    }
  }

  parts.push(
    '## 验收口径（冻结——冻结后禁改；验收命令以此为准）',
    '```bash',
    ctx.acceptance.join('\n'),
    '```',
    '## 文档章节引用（文档先行：实现须引用章节号；实现与文档冲突时停手改文档，走批示流）',
    ctx.docRefs.map((r) => `- ${r}`).join('\n'),
    '## 持久指令通道（AGENTS.md，抗 auto-compact）',
    `- ${channelNote(ctx.agentsChannel)}`,
    '- 红线/证据契约/验收口径以 AGENTS.md 为准；上下文被压缩后以磁盘文件为准，不凭记忆行事',
    '## 工位',
    `- workspace：\`${ctx.workspace}\``,
    `- 任务书落盘：\`${ctx.briefPath}\`（本文件即任务书）`,
  )

  if (ctx.budgetCapUsd !== undefined) {
    parts.push('## 预算上限', `- $${ctx.budgetCapUsd}（超限即停并如实上报，不硬撑、不伪造完成）`)
  }

  const taskBrief: TaskBrief = {
    ticket: ctx.ticket,
    attempt: ctx.attempt,
    briefPath: ctx.briefPath,
    workspace: ctx.workspace,
    AGENTS_MD: ctx.agentsChannel,
    ...(ctx.budgetCapUsd !== undefined ? { budgetCap: { usd: ctx.budgetCapUsd } } : {}),
    ...(kind === 'resume' && ctx.resume !== undefined
      ? { resume: { sessionId: ctx.resume.sessionId, summaryPath: ctx.resume.summaryPath } }
      : {}),
  }

  return { kind, text: `${parts.join('\n')}\n`, taskBrief }
}
