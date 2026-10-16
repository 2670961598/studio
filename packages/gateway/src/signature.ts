/**
 * 署名注入 —— 写入体的身份落款（docs/17-§7、docs/25-§3.2 SignedBody）
 *
 * 冻结格式（拟稿，改动先过批示）：
 *   - signature = `[公司·部门·岗位·级别]` 四段全填充，`·`（U+00B7）分隔——与提示词/文档口径一字不差
 *   - 级别展示形态 = 数字直写（String(level)；org 目录 level 是数字。L 前缀变体待批）
 *   - SignedBody 对齐 contract v1.2：author=工号（PersonId，Comment.author 由此派生）
 *   - gateway 只组装结构（author/body/signature 三字段），不改写正文；
 *     展示形态（拼进评论尾行等）归平台适配器（25-§3.2：实现负责拼装）
 *   - 形状非法（空公司/部门/岗位/工号、级别非正整数）抛 CONFIG_INVALID/gw-signature-*（对齐 errors.ts 通道）
 */
import { configInvalid } from '@studio-next/contract'
import type { PersonId, SignedBody } from '@studio-next/contract'

/** 署名上下文（来自公司目录人事档案的四个身份位） */
export interface SignatureContext {
  company: string
  dept: string
  role: string
  level: number
}

/** composeSignature —— 拼装 `[公司·部门·岗位·级别]` 落款 */
export function composeSignature(ctx: SignatureContext): string {
  assertContext(ctx)
  return `[${ctx.company}·${ctx.dept}·${ctx.role}·${String(ctx.level)}]`
}

/** signedBody —— 署名注入的写入体（author=工号，对齐 contract v1.2） */
export function signedBody(ctx: SignatureContext, author: PersonId, body: string): SignedBody {
  assertContext(ctx)
  if (author === '') throw configInvalid('gw-signature-empty-author', '署名工号不得为空')
  return { author, body, signature: composeSignature(ctx) }
}

function assertContext(ctx: SignatureContext): void {
  if (ctx.company === '') throw configInvalid('gw-signature-empty-field', '署名公司不得为空')
  if (ctx.dept === '') throw configInvalid('gw-signature-empty-field', '署名部门不得为空')
  if (ctx.role === '') throw configInvalid('gw-signature-empty-field', '署名岗位不得为空')
  if (!Number.isInteger(ctx.level) || ctx.level < 1) throw configInvalid('gw-signature-bad-level', `署名级别须为 >=1 的整数，收到 ${String(ctx.level)}`)
}
