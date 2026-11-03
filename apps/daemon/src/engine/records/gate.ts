/**
 * engine/records/gate —— 刀D 记录族的跨记录前置闸（contract 看不到的那一半）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者×前置闸；刀D 段）；
 *   - docs/17-§6（收割四要件；记录是留痕不是判据）；
 *   - docs/v2/11 §〇.2-1（决定者/接收者不得匿名——框架/系统/平台/流程/daemon/监控/自动策略）、
 *     §〇.4-2（一切引用形「ID＋版本」、跨记录不变量靠 refType 机械判族）、§〇.7（证明边界）、
 *     §5.2（WORK-12 前置）、§5.4（WORK-17 具名接收）、§七（ACC 独立裁判）、
 *     §八/§14.4-2（CHG 三门不合并/不可跳段）、§十（REV 复盘位置独立）、§十三（MEM 处置授权）、
 *     §六（EVD-04 判断者独立）。
 *
 * 纪律：
 *   - 只做「引用类型正确＋被引记录在库＋位置不匿名/不同体」三类机械判定；
 *   - 族内不变量（四态推导、三门次序、四本账等）一律交 contract 判定件（`validate*`），
 *     本件不复制、不改写判据（契约面零变更）；
 *   - 拒写是合法终态：返回 `record-prereq-missing`，不抛错、不补造、不重试。
 */
import { FORBIDDEN_DECISION_SUBJECTS } from '../../../../../packages/contract/src/records/index.ts'
import type { DraftOutcome } from './drafts.ts'
import type { DraftDecisionFaceInput, DraftRecordRef, RecordRefRequirement } from './types.ts'

/** 引用类型期望：精确值、候选集或正则（族前缀用正则，单类用精确值） */
export type RefExpectation = string | readonly string[] | RegExp

/** 引用类型是否满足期望 */
export function refMatches(ref: DraftRecordRef, expected: RefExpectation): boolean {
  if (typeof expected === 'string') return ref.refType === expected
  if (expected instanceof RegExp) return expected.test(ref.refType)
  return expected.includes(ref.refType)
}

/** 期望的类型面文本（错误消息可读锚） */
export function describeExpectation(expected: RefExpectation): string {
  if (typeof expected === 'string') return expected
  if (expected instanceof RegExp) return `/${expected.source}/`
  return expected.join('|')
}

/** 拒写（record-prereq-missing；调用方只观测） */
export function refusePrereq(recordType: string, reason: string): Extract<DraftOutcome, { ok: false }> {
  return { ok: false, recordType, code: 'record-prereq-missing', reason }
}

/** 匿名位置判定（复用 contract 的封闭清单，不另立字面量） */
export function isAnonymousSubject(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return (FORBIDDEN_DECISION_SUBJECTS as readonly string[]).includes(normalized)
}

/** 两个位置是否同体（归一化空白/大小写；空串不同体——空串由 non-empty 校验另判） */
export function samePosition(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * 单条被引记录闸：类型必须满足期望；wire 写前再按 refId 机械核验存在性。
 * 类型不符＝record-prereq-missing（不把错类型硬塞进 payload 让契约兜底）。
 */
export function requireRef(
  recordType: string,
  ref: DraftRecordRef | undefined,
  expected: RefExpectation,
  role: string,
): { readonly ok: true; readonly requirement: RecordRefRequirement } | Extract<DraftOutcome, { ok: false }> {
  if (ref === undefined) return refusePrereq(recordType, `${role} 未提供（前置记录缺失——不臆造）`)
  if (!refMatches(ref, expected)) {
    return refusePrereq(
      recordType,
      `${role} 引用类型=${ref.refType}，期望 ${describeExpectation(expected)}（v2/11 §〇.4-2：跨记录引用须机械判族）`,
    )
  }
  return { ok: true, requirement: { ref, recordType: ref.refType, role } }
}

/** 多条被引记录闸（逐条；任一条不过即拒） */
export function requireRefs(
  recordType: string,
  refs: readonly DraftRecordRef[],
  expected: RefExpectation,
  role: string,
  options: { readonly min?: number } = {},
): { readonly ok: true; readonly requirements: readonly RecordRefRequirement[] } | Extract<DraftOutcome, { ok: false }> {
  const min = options.min ?? 1
  if (refs.length < min) {
    return refusePrereq(recordType, `${role} 数量=${refs.length}，至少 ${min} 条（前置记录缺失——不臆造）`)
  }
  const requirements: RecordRefRequirement[] = []
  for (const ref of refs) {
    const checked = requireRef(recordType, ref, expected, role)
    if (!checked.ok) return checked
    requirements.push(checked.requirement)
  }
  return { ok: true, requirements }
}

/** 决定面 → contract payload 决定面（字段名 snake_case；生效槽与信封同值） */
export function decisionFaceOf(input: DraftDecisionFaceInput): {
  decided_by: string
  authority_ref: DraftRecordRef
  rationale: string
  basis_refs: readonly DraftRecordRef[]
  scope_judged: { judged: readonly string[]; not_judged: readonly string[] }
  dissent_position: string
  effective_state: 'effective'
  effective_time: string
} {
  return {
    decided_by: input.decidedBy,
    authority_ref: input.authorityRef,
    rationale: input.rationale,
    basis_refs: input.basisRefs,
    scope_judged: { judged: input.scopeJudged.judged, not_judged: input.scopeJudged.notJudged },
    dissent_position: input.dissentPosition,
    effective_state: 'effective',
    effective_time: input.effectiveFrom,
  }
}

/** 决定面自检：决定者不得匿名、依据引用不得为空（§0.3-1/§0.3-2） */
export function checkDecisionFace(input: DraftDecisionFaceInput | undefined): string | undefined {
  if (input === undefined) return '决定面未提供（决定面封闭清单类型不得缺决定面——v2/11 §0.3-2）'
  if (isAnonymousSubject(input.decidedBy)) return `决定者不得匿名「${input.decidedBy}」（§0.2-1/I-9）`
  if (input.basisRefs.length === 0) return '决定面 basis_refs 不得为空列表（§0.3-1）'
  if (input.scopeJudged.judged.length === 0) return '决定面 scope_judged.judged 不得为空（§0.3-1）'
  return undefined
}
