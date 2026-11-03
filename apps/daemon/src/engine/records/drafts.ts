/**
 * engine/records/drafts —— 主循环相位 → 记录草案（逐类判前置；不臆造）
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位×记录类型×写入者映射表——本件即其执行体）；
 *   - docs/17-§6（收割四要件：本件只在判定后落记录，不改四要件判据）；
 *   - docs/v2/11 §〇.2（记录五分型）／§〇.3-2（决定面封闭清单：WORK-02/04/06/07/09/12、
 *     ACC-02、REV-01、CHG-01 等必带决定面）／§〇.7（证明边界）／§5.2（WORK-06 边集与前置记录）／
 *     §5.4（WORK-17 具名接收）／§六（EVD-01 收割批次）／§七（ACC 问责）／§八（CHG 变更链）／
 *     §十（REV 复盘）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一写口）。
 *
 * 本件核心纪律：**请求型/事件型可直写，决定型必须先有权源/前置记录**——
 *   - 可直接写：REC-WORK-01（请求型，无决定面，v2/11 §0.2）；
 *   - 条件可写：REC-WORK-06（决定型：边集前置记录齐＋规则依据齐）、REC-EVD-01（事件型：
 *     需 REC-LIFE-04 出工段引用）；
 *   - 刀D（studio-dev-561）已解除的族：WORK-12/17、ACC-01/02、CHG-01、REV-01、MEM-03、
 *     EVD-04 的草案在 `close-drafts.ts`/`governance-drafts.ts`；族不在本表阻断清单内，
 *     但前置件未落时仍由契约校验器＋被引记录存在性闸拒写（fail-closed）。
 */
import type { IssueRecord } from '@studio-next/contract'
import type { DraftDecisionFaceInput, DraftRecordRef, RecordDraft, RecordDraftGate } from './types.ts'
import { requiredEvidenceOf, workEdgeOf, workStateOf } from './state-map.ts'

export type { DraftDecisionFaceInput, DraftRecordRef } from './types.ts'

/** 受理时限缺省（24h；v0 无受理 SLA 配置——缺省值登记于 plan，非契约值） */
export const INTAKE_DEADLINE_MS = 24 * 60 * 60 * 1000

/** 草案构建结果：ok=draft；refused=前置/契约不齐（调用方只观测，不重试、不补造） */
export type DraftOutcome =
  | { readonly ok: true; readonly draft: RecordDraft; readonly gate?: RecordDraftGate }
  | { readonly ok: false; readonly recordType: string; readonly code: 'record-prereq-missing'; readonly reason: string }

/** ISO 时刻（记录时间字段全形；调用方给 epoch-ms，转换只在此一处） */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

/** 平台工单 → REC-WORK-01 意图信封草案（相位 1 采集尾；请求型，零决定面） */
export function workIntakeDraft(args: {
  readonly issue: IssueRecord
  readonly at: number
  readonly actor: string
  readonly source: string
  readonly company: string
}): DraftOutcome {
  const { issue, at, actor, source, company } = args
  const constraints: string[] = []
  if (issue.level !== undefined) constraints.push(`level=L${issue.level}`)
  if (issue.type !== undefined) constraints.push(`type=${issue.type}`)
  if (issue.lane !== undefined) constraints.push(`lane=${issue.lane}`)
  if (issue.dept !== undefined) constraints.push(`dept=${issue.dept}`)
  if (issue.parent !== undefined) constraints.push(`parent=${issue.parent}`)
  const receivedAt = isoAt(at)
  const draft: RecordDraft = {
    recordType: 'REC-WORK-01',
    recordId: `rec-work-01:${company}:${issue.id}`,
    producedAt: receivedAt,
    decidedBy: actor,
    effectiveState: 'effective',
    effectiveFrom: receivedAt,
    idempotencyKey: {
      recordType: 'REC-WORK-01',
      subjectId: issue.id,
      operationClass: 'intake',
      requesterSequence: 'intake-1',
    },
    proofBoundary:
      '本记录证明：平台工单意图已按 REC-WORK-01 登记（原始内容/来源/身份映射/受理责任位置/受理时限/已知约束/请求方期望态）；' +
      '不证明来源真实性（authenticity_state=unverified，来源核验通道未接）；不证明受理结论（REC-WORK-02 未落）与权源；' +
      '不证明工作状态已迁移（迁移归 REC-WORK-06，前置记录不齐时拒写）。',
    payload: {
      raw_content: issue.description !== undefined && issue.description !== '' ? issue.description : issue.title,
      source,
      identity_mapping: `${company}#ticket:${issue.id}`,
      // ENU-69 来源核验四值：平台活动未过来源核验通道 → 诚实标 unverified（不冒充 verified）
      authenticity_state: 'unverified',
      received_at: receivedAt,
      intake_owner: actor,
      intake_deadline: isoAt(at + INTAKE_DEADLINE_MS),
      known_constraints: constraints,
      // 请求方期望态：平台单未声明 → 取请求方目标终态（settled）；不冒充受理结论
      requested_state: 'settled',
    },
  }
  return { ok: true, draft }
}

/**
 * 平台迁移 → REC-WORK-06 状态迁移草案（相位 3/4/6 迁移执行缝）。
 * 三道闸全在写前判：①边在 §14.1 表内；②该边前置记录齐（§14.1 前置记录列）；
 * ③规则型生产者附规则依据引用（§5.2）。任一不齐＝拒写（不伪造迁移记录）。
 */
export function workTransitionDraft(args: {
  readonly ticket: string
  readonly attempt: number
  readonly fromPlatformState: string
  readonly toPlatformState: string
  readonly at: number
  readonly actor: string
  readonly company: string
  readonly evidenceRefs?: readonly DraftRecordRef[]
  readonly ruleBasisRef?: DraftRecordRef
  readonly decision?: DraftDecisionFaceInput
}): DraftOutcome {
  const fromState = workStateOf(args.fromPlatformState)
  const toState = workStateOf(args.toPlatformState)
  if (fromState === undefined || toState === undefined) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason:
        `平台状态不在工作十态桥接表：${args.fromPlatformState}→${args.toPlatformState}` +
        '（state-map.ts 头注缺口 1：桥接表外状态不猜）',
    }
  }
  const edge = workEdgeOf(args.fromPlatformState, args.toPlatformState)
  if (edge === undefined) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason:
        `平台迁移 ${args.fromPlatformState}→${args.toPlatformState}（${fromState}→${toState}）` +
        '在 v2/11 §14.1 M-01..M-28 边集内无对应边（回退/重开/返工语义归 REC-WORK-10/11）——不臆造迁移记录',
    }
  }
  const required = requiredEvidenceOf(edge)
  const provided = new Set((args.evidenceRefs ?? []).map((ref) => ref.refType))
  const missing = required.filter((type) => !provided.has(type))
  if (missing.length > 0) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason: `边 ${edge.edge}（${fromState}→${toState}）前置记录未齐：缺 ${missing.join('、')}（v2/11 §14.1 前置记录列）`,
    }
  }
  if (args.ruleBasisRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason:
        `边 ${edge.edge} 为规则型迁移（decide 规则档）但规则依据记录未登记（rule_basis_ref 缺）——` +
        '§5.2 规定规则型必附规则依据引用，不写「系统判定」',
    }
  }
  const decision = args.decision
  if (decision !== undefined && decision.basisRefs.length === 0) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason: '决定面 basis_refs 为空（§0.3-1：依据引用不得为空列表；trigger_ref 亦由首项承载）',
    }
  }
  if (decision === undefined) {
    return {
      ok: false,
      recordType: 'REC-WORK-06',
      code: 'record-prereq-missing',
      reason: '决定面未提供（decidedBy/authorityRef/rationale/basisRefs/scopeJudged）——决定面封闭清单类型不得缺决定面（§0.3-2）',
    }
  }
  const recordedAt = isoAt(args.at)
  const draft: RecordDraft = {
    recordType: 'REC-WORK-06',
    recordId: `rec-work-06:${args.company}:${args.ticket}:${args.attempt}:${edge.edge}`,
    producedAt: recordedAt,
    decidedBy: decision.decidedBy,
    effectiveState: 'effective',
    effectiveFrom: decision.effectiveFrom,
    idempotencyKey: {
      recordType: 'REC-WORK-06',
      subjectId: args.ticket,
      operationClass: 'transition',
      requesterSequence: `${args.attempt}:${edge.edge}`,
    },
    proofBoundary:
      '本记录证明：平台迁移已按 REC-WORK-06 登记（边号/前后态/生产者三分/前置记录引用/决定面）；' +
      '不证明五门与资源门已过（REC-WORK-04/05 未落时该边前置即不齐、本记录不会存在）；不证明平台侧迁移不可逆。',
    payload: {
      state_family: 'work',
      from_state: fromState,
      to_state: toState,
      producer_type: 'rule',
      rule_basis_ref: args.ruleBasisRef,
      trigger_ref: decision.basisRefs[0],
      authority_ref: decision.authorityRef,
      precondition_results: [],
      expected_version: `${edge.edge}@attempt-${args.attempt}`,
      actual_actor: args.actor,
      dissent_position: decision.dissentPosition,
      occurred_at: recordedAt,
      observed_at: recordedAt,
      recorded_at: recordedAt,
      side_effects: [],
      evidence_refs: args.evidenceRefs ?? [],
      produced_refs: [],
      decision_face: {
        decided_by: decision.decidedBy,
        authority_ref: decision.authorityRef,
        rationale: decision.rationale,
        basis_refs: decision.basisRefs,
        scope_judged: { judged: decision.scopeJudged.judged, not_judged: decision.scopeJudged.notJudged },
        dissent_position: decision.dissentPosition,
        effective_state: 'effective',
        effective_time: decision.effectiveFrom,
      },
    },
  }
  return { ok: true, draft }
}

/**
 * 收割 → REC-EVD-01 收割批次草案（相位 4；事件型）。必需 `segmentRef`＝REC-LIFE-04 出工段
 * （§六 字段表首项）——v0 任职/出工链无生产者时由调用方判缺并走 blockedDraftFor。
 */
export function harvestBatchDraft(args: {
  readonly ticket: string
  readonly attempt: number
  readonly at: number
  readonly company: string
  readonly actor: string
  readonly terminal: 'completed' | 'error' | 'blocked' | 'aborted' | 'limit_exceeded'
  readonly gaps: readonly string[]
  readonly usage: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
  readonly cost: readonly { readonly item: string; readonly amount: number; readonly unit: string }[]
  readonly segmentRef?: DraftRecordRef
  readonly sourceCursor?: string
  readonly windowFrom?: number
  readonly windowTo?: number
}): DraftOutcome {
  if (args.segmentRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-EVD-01',
      code: 'record-prereq-missing',
      reason: 'REC-EVD-01 首项 segment_ref（→REC-LIFE-04 出工段）未落——任职/出工链无生产者，收割批次不臆造',
    }
  }
  const at = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType: 'REC-EVD-01',
      recordId: `rec-evd-01:${args.company}:${args.ticket}:${args.attempt}`,
      producedAt: at,
      decidedBy: args.actor,
      effectiveState: 'effective',
      effectiveFrom: at,
      idempotencyKey: {
        recordType: 'REC-EVD-01',
        subjectId: args.ticket,
        operationClass: 'harvest',
        requesterSequence: `${args.attempt}`,
      },
      proofBoundary: '本记录证明：执行面收割批次已登记（出工段/来源游标/所收集项/完整度/缺口/执行面自报终态/用量与成本）；不证明执行结果合格（判断归四要件与验收）。',
      payload: {
        segment_ref: args.segmentRef,
        source_cursor: args.sourceCursor ?? `attempt-${args.attempt}`,
        collected_items: [],
        harvest_completeness: 'unknown',
        gaps: [...args.gaps],
        // ENU-53 执行终态五值（执行面自报仅作观察，不压布尔）
        execution_terminal: args.terminal,
        usage_and_cost: { usage: [...args.usage], cost: [...args.cost] },
        // §0.4-5 特化键：（出工段×采集区间）
        idempotency_key: {
          segment_ref: args.segmentRef,
          collection_from: isoAt(args.windowFrom ?? args.at),
          collection_to: isoAt(args.windowTo ?? args.at),
        },
      },
    },
  }
}

/**
 * 现阶段拒写族清单（生产写面已接、前置链未注册——逐类给阻断件；不臆造）。
 * 键＝记录类型，值＝{ 相位, 阻断件, 依据 }；docs/17-§2 映射表与本表同源。
 */
export const BLOCKED_RECORD_FAMILIES: Readonly<
  Record<string, { readonly phase: string; readonly blocker: string; readonly ref: string }>
> = {
  'REC-WORK-08': {
    phase: '收割',
    blocker: 'REC-WORK-07 效果级判定＋REC-EVD-01/03 收割批次/证据包未落（§5.2 完成判据前置）',
    ref: 'v2/11 §5.2',
  },
  'REC-WORK-09': {
    phase: '复验/验收',
    blocker: 'REC-EVD-03 证据包＋REC-WORK-07 效果级＋REC-LIFE-05 独立性核验未落（§5.2 验收前置）',
    ref: 'v2/11 §5.2',
  },
  'REC-WORK-10': {
    phase: '返工',
    blocker: '触发记录（REC-WORK-06/08/09）未落——返工记录必须引被触发记录（§2 字段首项）',
    ref: 'v2/11 §5.2/§5.4',
  },
  'REC-WORK-13': {
    phase: '派发',
    blocker: 'REC-WORK-03 任务合同（work_ref）未落——协作请求必须引合同（§5.3 字段首项）',
    ref: 'v2/11 §5.3',
  },
  'REC-EVD-01': {
    phase: '收割',
    blocker: 'REC-LIFE-04 出工段引用未落（§六 首项 segment_ref）',
    ref: 'v2/11 §六',
  },
}

/**
 * 刀D 已解除的族（studio-dev-561；逐族留表——解除＝写面实现＋前置闸就位，**不是**前置件已落）。
 * 值＝{ 相位, 写面件, 前置闸, 依据 }；与 docs/17-§2 刀D 段同源。
 * 口径：写面已接但前置件（刀B 任职/授权、刀C 验收/证据包）未落时，草案/写面一律
 * `record-prereq-missing` 拒写——fail-closed 是合法终态，不臆造记录。
 */
export const UNBLOCKED_RECORD_FAMILIES: Readonly<
  Record<string, { readonly phase: string; readonly writer: string; readonly gate: string; readonly ref: string }>
> = {
  'REC-WORK-12': {
    phase: '相位 5 合并 / 相位 6 回收',
    writer: 'close-drafts.settlementDraft',
    gate: 'MEM-03 分流凭证＋EVD-04 价值评估（或显式缺口）＋独立核验位置（核验者≠责任者且非其控制者）',
    ref: 'v2/11 §5.2',
  },
  'REC-WORK-17': {
    phase: '相位 6 回收 / 断路',
    writer: 'close-drafts.exceptionDraft',
    gate: 'subject_ref（工作/合同记录，须已落）＋具名接收位置＋升级链（不得默认未认领）',
    ref: 'v2/11 §5.4',
  },
  'REC-ACC-01': {
    phase: '相位 6 回收 / 断路',
    writer: 'governance-drafts.accountabilityDraft',
    gate: 'REC-LIFE-01 任职引用＋独立裁判位置/控制关系依据（独立性自填即拒）＋申辩窗口非无限期',
    ref: 'v2/11 §七',
  },
  'REC-ACC-02': {
    phase: '问责出口 / 救济',
    writer: 'governance-drafts.remedyDraft',
    gate: 'case_ref（ACC-01/损害记录，须已落）＋决定面＋proof_boundary＋执行证据链',
    ref: 'v2/11 §七',
  },
  'REC-CHG-01': {
    phase: '配置热更 / 变更决定位',
    writer: 'governance-drafts.changeSegmentDraft',
    gate: '链前段（不可跳段）＋三门不合并（验证授权/独立验证/激活批准）＋CAP-01/02 前件（能力包）',
    ref: 'v2/11 §八/§14.4-2',
  },
  'REC-REV-01': {
    phase: '终局后 / 周期复盘',
    writer: 'close-drafts.reviewDraft',
    gate: 'EVD-04 代价账＋WORK-09 验收引用（须已落）＋复盘位置独立性（自填即拒）',
    ref: 'v2/11 §十',
  },
  'REC-MEM-03': {
    phase: '结清 / 复盘前置',
    writer: 'governance-drafts.memoryDisposalDraft',
    gate: '处置授权位置（须独立于请求方）＋三路分流凭证（归档/清除/转出）＋转层双授权',
    ref: 'v2/11 §十三',
  },
  'REC-EVD-04': {
    phase: '结清 / 复盘前置',
    writer: 'governance-drafts.valueEvaluationDraft',
    gate: '四本账（不得压总分）＋判断者独立性（自填即拒）＋负价值单列＋外部反馈为空只能「价值不明」',
    ref: 'v2/11 §六',
  },
}

/** 拒写族草案（供调用方统一判定：主循环对应相位有事件但记录面关） */
export function blockedDraftFor(recordType: string): DraftOutcome {
  const blocked = BLOCKED_RECORD_FAMILIES[recordType]
  if (blocked === undefined) {
    const unblocked = UNBLOCKED_RECORD_FAMILIES[recordType]
    if (unblocked !== undefined) {
      return {
        ok: false,
        recordType,
        code: 'record-prereq-missing',
        reason: `记录类型 ${recordType} 写面已解除阻断（${unblocked.writer}）；前置闸：${unblocked.gate}（${unblocked.ref}）`,
      }
    }
    return {
      ok: false,
      recordType,
      code: 'record-prereq-missing',
      reason: `记录类型 ${recordType} 不在本件已接生产写面清单（docs/17-§2 映射表）`,
    }
  }
  return {
    ok: false,
    recordType,
    code: 'record-prereq-missing',
    reason: `相位「${blocked.phase}」→ ${recordType} 前置链未注册：${blocked.blocker}（${blocked.ref}）`,
  }
}
