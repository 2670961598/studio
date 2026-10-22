/**
 * REPORT 产物骨架 + summary.json sidecar schema（docs/17-§3 末行；复查报告-2026-10-16 B4；F1-15）
 *
 * 依据链：
 *   - 17-§3：收割成功契约（completed+输出非空+REPORT 落盘+闸门 exit=0）；
 *     「REPORT 旁落 summary.json sidecar（结论/改动文件/打回理由）供续跑前情摘要」。
 *   - 复查报告 B4：REPORT 是自由文本，机械提取「结论」仅 121/307——修订为
 *     结构化 sidecar `<单号>.summary.json`（结论/改动/打回理由），LLM 不抠全文。
 *   - F1-15：续跑前情摘要 = 上次 REPORT 结论 + diff 名单 + 打回理由。
 *
 * 【拟稿待批】docs 未细化 REPORT 最小必填节，以下为最小合理集（制作人批示后冻结）：
 *   - REPORT 骨架：一级标题（非空）+ 必填二级节「结论」「改动」「验证」——
 *     「结论/改动」对应 F1-15 前情摘要两要素，「验证」对应收割四要件里闸门 exit=0
 *     的证据自述；额外节（风险/备注/…）不拒收（开放世界），节序不约束。
 *   - sidecar 字段名 schema/conclusion/changed_files/rejection_reason，版本字面量
 *     summary/v1（对齐 org-config/v1 的 schema 字面量惯例）。
 */
import { z } from 'zod'
import { configInvalid } from './errors.ts'
import type { ValidationIssue, ValidationOutcome } from './events.ts'

/** REPORT 必填节（拟稿待批——见文件头注依据链） */
export const REPORT_REQUIRED_SECTIONS = ['结论', '改动', '验证'] as const

/** 从 markdown 提取的骨架视图：标题 + 二级节名→正文（已 trim） */
export interface ReportSkeletonView {
  title: string | null
  sections: Record<string, string>
}

/** REPORT 骨架 schema（作用在提取视图上）：标题非空、节名/节文非空、必填节齐 */
export const ReportSkeletonSchema = z
  .strictObject({
    title: z.string().min(1),
    sections: z.record(z.string().min(1), z.string().min(1)),
  })
  .superRefine((view, ctx) => {
    for (const section of REPORT_REQUIRED_SECTIONS) {
      if (!(section in view.sections)) {
        ctx.addIssue({ code: 'custom', path: ['sections', section], message: `REPORT 缺必填节「${section}」（拟稿待批）` })
      }
    }
  })

/**
 * markdown → 骨架视图：首个 `# ` 为标题；`## ` 开新节（`### ` 及更深归上一节正文）；
 * 标题前的引导文不进骨架。提取器零依赖、容错（非法 markdown 只是抽不出节，由 schema 拒收）。
 */
export function extractReportSkeleton(md: string): ReportSkeletonView {
  const lines = md.split(/\r?\n/)
  let title: string | null = null
  const sections: Record<string, string> = {}
  let current: string | null = null
  const buf: string[] = []
  const flush = (): void => {
    if (current !== null) sections[current] = buf.join('\n').trim()
    buf.length = 0
  }
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line)
    const h2 = /^##\s+(.+)$/.exec(line)
    if (h2 !== null) {
      flush()
      current = h2[1]!.trim()
    } else if (h1 !== null && title === null) {
      flush()
      current = null // 标题不是节；其后正文直至首个二级节不进骨架
      title = h1[1]!.trim()
    } else if (current !== null) {
      buf.push(line)
    }
  }
  flush()
  return { title, sections }
}

/** summary.json sidecar（17-§3 末行 / B4：结论/改动文件/打回理由；F1-15 续跑前情数据源） */
export const SummarySidecarSchema = z.strictObject({
  /** 版本字面量（拟稿：对齐 org-config/v1 惯例） */
  schema: z.literal('summary/v1'),
  /** 结论：非空（B4 实测痛点——自由文本抠不出结论，故强制结构化） */
  conclusion: z.string().min(1),
  /** 改动文件（diff 名单，F1-15）：数组可为空（纯分析/评审单），元素为文件路径非空串 */
  changed_files: z.array(z.string().min(1)),
  /** 打回理由：打回单必带、交付单可省（QA_BACK 复盘的原始输入） */
  rejection_reason: z.string().min(1).optional(),
  /**
   * 定时岗产出哨兵（127-A R1，批示③：落点=summary.json 框架字段——结构化免解析）。
   * 框架字段：daemon 派发时随任务书 L4 下发 `{job,run_at,nonce}`，worker 原样回写；
   * optional——非定时岗单不带（哨兵管辖面=工单型岗单，patrol 工件无 worker 读任务书）；
   * 岗单缺省=P3 对账步 fail-closed（SENTINEL_MISSING），schema 宽松只挡形状不代验证。
   */
  sentinel: z
    .strictObject({
      job: z.string().min(1),
      run_at: z.number().int().min(0),
      nonce: z.string().length(64),
    })
    .optional(),
})

export type SummarySidecar = z.infer<typeof SummarySidecarSchema>

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((zi) => ({
    path: zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number').join('.') || '(root)',
    message: zi.message,
  }))
}

/** REPORT 文档校验（数据层入口）：输入是 markdown 全文；合法 {ok:true}，不合法 {ok:false, issues} */
export function validateReportDocument(v: unknown): ValidationOutcome {
  if (typeof v !== 'string') {
    return { ok: false, issues: [{ path: '(root)', message: 'REPORT 文档必须是 markdown 字符串' }] }
  }
  const view = extractReportSkeleton(v)
  const parsed = ReportSkeletonSchema.safeParse({ title: view.title ?? '', sections: view.sections })
  if (parsed.success) return { ok: true }
  return { ok: false, issues: toIssues(parsed.error) }
}

/** summary.json sidecar 校验（数据层入口）：合法 {ok:true}，不合法 {ok:false, issues} */
export function validateSummarySidecar(v: unknown): ValidationOutcome {
  const parsed = SummarySidecarSchema.safeParse(v)
  if (parsed.success) return { ok: true }
  return { ok: false, issues: toIssues(parsed.error) }
}

/**
 * rpt 域契约 subject（CASES.md 域约定）：input 形如 {report: markdown, summary: sidecar 对象}。
 * 两件全过 → {ok:true, report:{ok:true}, summary:{ok:true}}；
 * 任一件不过 → throw CONFIG_INVALID，subcause=rpt/invalid:report / rpt/invalid:summary。
 */
export function rptSubject(input: unknown): { ok: true; report: { ok: true }; summary: { ok: true } } {
  const bundle = (input ?? {}) as { report?: unknown; summary?: unknown }
  const report = validateReportDocument(bundle.report)
  if (!report.ok) {
    const first = report.issues[0]!
    configInvalid('rpt/invalid:report', `${first.path}: ${first.message}`)
  }
  const summary = validateSummarySidecar(bundle.summary)
  if (!summary.ok) {
    const first = summary.issues[0]!
    configInvalid('rpt/invalid:summary', `${first.path}: ${first.message}`)
  }
  return { ok: true, report: { ok: true }, summary: { ok: true } }
}
