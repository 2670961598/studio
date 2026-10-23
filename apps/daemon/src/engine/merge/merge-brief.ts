/**
 * merge-brief —— 合并跑最小任务书装配件（202-P2，studio-dev-232，docs/17-§2 相位 5 真单刀）
 *
 * 职责：在既有 L0-L5 装配管线（续跑版——前情摘要=上次 summary.json，17-§5）产出的任务书
 * 之后追加「合并指令块」。零 prompt 包改动（renderTaskBrief 不动）：合并指令块是引擎侧
 * 尾块（读面节同款落点裁决——任务书是 per-attempt 操作面）。
 *
 * 边界（诚实标注）：
 *   - 目标分支/门禁命令来自 MergeRunDeps（serve 装配注入；缺省 dev + bun run test=R1 裁决）；
 *   - 回执落点=工位根 merge-REPORT.md（要件 3「REPORT 落盘」的合并跑形态——回执≠收割
 *     REPORT.md，语义同为「worker 产出的落盘证据」；路径常量供引擎/闸门两侧共用防漂移）；
 *   - 任务书自身落 merge-brief.md（不覆写原 brief.md——原工位证据保全，docs/43-§五）。
 */

/** 合并跑任务书落点（工位根；原 brief.md 保全不动） */
export const MERGE_BRIEF_FILENAME = 'merge-brief.md'

/** 合并回执落点（工位根；收割四要件之要件 3 的合并跑形态） */
export const MERGE_RECEIPT_FILENAME = 'merge-REPORT.md'

/**
 * 合并指令块（任务书尾块）：目标分支（R5）/合并指令/冲突自解（R3）/回执要求/验收口径
 * 冻结（门禁 exit 0——引擎将亲跑核验，R1）。会话续跑由 TaskBrief.resume 承载（续跑版
 * 任务书既有面），此处不重复注入 session id（凭据红名单同理由——note/任务书不含密钥，
 * session id 非密钥但续跑证据走事件面留痕）。
 */
export function mergeDirectiveBlock(targetBranch: string, gateCommand: readonly string[]): string {
  const gate = gateCommand.join(' ')
  return [
    '',
    '—— 合并跑最小任务书（202-P2，v0.5 真单刀——本任务书由 daemon 在合并相位经 resume 唤起原会话注入）——',
    `目标分支：${targetBranch}（R5：合并目标恒 dev 家分支，不指名他枝）`,
    '合并指令：在本工位 repo 内把本单工作分支合入目标分支；不得强推、不得重写历史、不改无关文件',
    '冲突自解：冲突自解（R3）；解不动即如实收口——输出说明并留现场，不伪造不隐瞒（AGENTS 红线）',
    `合并回执：把合并回执写到工位根 ${MERGE_RECEIPT_FILENAME}（合入提交 sha/冲突文件清单与解法摘要/门禁自跑结论照录）`,
    `验收口径冻结：门禁命令 \`${gate}\` 在 repo 内 exit 0＋合并提交存在（真合并提交）——引擎将亲跑核验（R1），双绿才算合并完成`,
    `交付边界：只在工位完成合并提交，不推送（push 由 daemon 代推，R2）；不写平台、不动单据状态`,
    '',
  ].join('\n')
}
