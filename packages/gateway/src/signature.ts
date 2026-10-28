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
 *
 * 署名审计（SEC-SIG-01／SEC-FC-06；plan/05 IMPL-07-10「N-f 审计断言件」）：
 *   - 命题：每次平台写入的署名必须能回到**真实决定人**（SEC-SIG-01）；「daemon 做的」「工具做的」
 *     「公司做的」都不是可结算的署名（同节原文），常量 `daemon` 不得作为最终署名（SEC-FC-06）。
 *   - 本件是**审计判定**不是构造拒绝：contract v1.2 的 SignedBody 形状（author/body/signature）
 *     承载不了 SEC-SIG-01 目标的 `{actorKind, actorRef, onBehalfOf?}`（字段形状归 v2/11，改 contract
 *     走批示流）；构造期收口在 daemon 侧（IMPL-06-04）。建成前按 SEC-FC-06 机器强制点代偿：
 *     「台账中署名不可还原决定人的记录＝0」——auditSignatureLedger 供审计行扫描，判负行计入
 *     failures（NEG-SEC-06/N-f：不可还原＝判负，不得算绿）。
 *   - 判定不臆造来源：决定人回指（任职/决定记录引用）由调用方注入解析器（公司目录/台账侧），
 *     本包只做纯判定零 IO（守 gateway 包分层：只依赖 contract）。
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

/**
 * 署名主体三值（SEC-SIG-01；值集唯一主表 v2/09 ENU-118）：
 * person=人员工号｜control=控制面位置＋决定记录引用｜system=系统代写＋可还原工号或触发源。
 */
export type SignatureActorKind = 'person' | 'control' | 'system'

/** 决定人回指（任职/决定/行使记录引用；记录形状归 v2/11，网关只收判定所需最小面） */
export interface SignatureActorRef {
  readonly actorKind: SignatureActorKind
  /** 记录引用（REC-LIFE-01 任职 / REC-DEC-01 决定 / REC-AUTH-02 行使——refId） */
  readonly recordRef: string
}

/** 署名审计判负码（gw- 前缀族；NEG-SEC-06/N-f） */
export type SignatureAuditReason =
  | 'gw-sig-empty-author' // 空署名主体（无从回指）
  | 'gw-sig-placeholder-author' // 非人占位主体（daemon/tool/company/system 泛称——不是可结算署名）
  | 'gw-sig-unresolvable-decision-maker' // 解析不到任职/决定记录（回指断裂）

export type SignatureAuditVerdict =
  | { readonly ok: true; readonly author: PersonId; readonly actor: SignatureActorRef }
  | { readonly ok: false; readonly author: PersonId; readonly reason: SignatureAuditReason }

/**
 * 非人占位主体（SEC-SIG-01：「daemon 做的」「工具做的」「公司做的」都不是可结算的署名；
 * SEC-FC-06：常量 `daemon` 不得作为最终署名出现在任何写路径）。比较前归一：去空白＋小写。
 */
export const NON_ACTOR_AUTHORS = ['daemon', 'system', 'tool', 'company'] as const

const NON_ACTOR_SET: ReadonlySet<string> = new Set(NON_ACTOR_AUTHORS)

function isActorKind(value: string): value is SignatureActorKind {
  return value === 'person' || value === 'control' || value === 'system'
}

/**
 * auditDecisionMaker —— N-f 单行判定：署名能否还原到真实决定人。
 * 判负三态：空主体｜非人占位主体（含常量 daemon，即使解析器能映射也不放行——SEC-FC-06）｜
 * 解析不到记录或记录引用为空/主体类别非法（回指断裂）。正向＝author 解析为合法主体且记录引用非空。
 *
 * @param signed 待审计署名（网关落款或台账回读行；author=工号）
 * @param resolve 决定人解析器（工号 → 任职/决定记录引用；查不到返 undefined，不得造默认值）
 */
export function auditDecisionMaker(
  signed: SignedBody,
  resolve: (author: PersonId) => SignatureActorRef | undefined,
): SignatureAuditVerdict {
  const author = signed.author
  if (author.trim() === '') return { ok: false, author, reason: 'gw-sig-empty-author' }
  // 占位主体先行：常量 daemon 不得靠「解析器给条记录」洗白（SEC-FC-06）
  if (NON_ACTOR_SET.has(author.trim().toLowerCase())) return { ok: false, author, reason: 'gw-sig-placeholder-author' }
  const actor = resolve(author)
  if (actor === undefined) return { ok: false, author, reason: 'gw-sig-unresolvable-decision-maker' }
  if (!isActorKind(actor.actorKind) || actor.recordRef.trim() === '') {
    return { ok: false, author, reason: 'gw-sig-unresolvable-decision-maker' }
  }
  return { ok: true, author, actor }
}

/** 台账署名审计报告（SEC-FC-06 机器强制点的代偿形态：failures 必须为空才算过） */
export interface SignatureLedgerAudit {
  readonly audited: number
  readonly failures: readonly {
    readonly index: number
    readonly author: PersonId
    readonly reason: SignatureAuditReason
  }[]
}

/**
 * auditSignatureLedger —— 台账逐行署名审计（N-f：「署名不可还原决定人的记录＝0」）。
 * 任何一行判负即进 failures——审计断言不得把判负行折成 0（NEG-SEC-06：判负不是豁免）。
 */
export function auditSignatureLedger(
  rows: readonly SignedBody[],
  resolve: (author: PersonId) => SignatureActorRef | undefined,
): SignatureLedgerAudit {
  const failures: Array<{ readonly index: number; readonly author: PersonId; readonly reason: SignatureAuditReason }> = []
  rows.forEach((row, index) => {
    const verdict = auditDecisionMaker(row, resolve)
    if (!verdict.ok) failures.push({ index, author: verdict.author, reason: verdict.reason })
  })
  return { audited: rows.length, failures }
}
