/**
 * engine/records/object-wire —— 五对象记录载体生产写口（fail-closed 唯一落点）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口）；docs/v2/05 §三 DOM-03/DOM-05；
 *   - docs/v2/11 §〇（信封/决定者/幂等/生效槽/证明边界）、§七/§八/§十（五对象载体字段与不变量）；
 *   - docs/v2/17 §六.2、NEG-REC-06/07/09；docs/17-§2（相位 4 收割）、docs/17-§6（收割四要件）；
 *   - 本单 studio-dev-537；同源映射表见 ./object-carriers.ts 头注（与 #527 记录族写面同源）。
 *
 * 写面纪律（fail-closed）：
 *   ① 形状/不变量：contract 族 schema＋族判定件任一不过 → **拒写**（code=shape-refused），
 *      不落半条、不静默丢字段；
 *   ② 证据闭包：payload 内记录引用逐条 `hist.get` 核验存在与类型，悬空即 **拒写**
 *      （code=evidence-missing）——**不造悬空引用**（依赖 #527 记录族写面先落的 REC-WORK/EVD）；
 *   ③ 独立决定者：ACC/REV/EVAL 的具名决定者必须由生产位置注入；缺位=拒写
 *      （code=position-missing），**不以 daemon 冒充决定者**（§0.2-1/I-9）；
 *   ④ 写口异常：同 id/幂等键异内容=conflict；其余=write-failed——一律返回结果对象，
 *      由调用方决定是否计入拍错误（本件不吞错、不冒成功）。
 *
 * 相位接线（生产装配＝assembly/records/serve-face.ts；引擎钩子＝EngineDeps.onWorkComplete）：
 *   - 相位 4 收割 GATE_FAIL → `afterHarvest` → REC-ACC-01（问责案例开案，结论=暂不能归因）；
 *   - 其余四类为装配面显式写口（REV/CHG/ACC-02/EVAL）——无生产决策源时不自动触发，
 *     由复盘/进化/问责/评价位置经各自生产链注入事实后调用。
 */
import type { EventRecord } from '@studio-next/contract'
import type { HistFace, HistRecordRef, Ledger } from '@studio-next/store'
import type { RelayWorkSignal } from '../intents/relay-resume-sources.ts'
import {
  ALL_RECORD_SCHEMAS,
  issuesFromZod,
  validateAccountabilityCase,
  validateChangeSegment,
  validateRemedyDecision,
  validateReview,
  validateStructuralEvaluation,
  type AccountabilityCasePayload,
  type ChangeSegment,
  type ChangeSegmentPayload,
  type RecordRef,
  type RemedyDecisionPayload,
  type ReviewPayload,
  type StructuralEvaluationPayload,
} from '@studio-next/contract/records'
import {
  accountabilityCase,
  changeSegment,
  collectRecordRefs,
  remedyDecision,
  reviewRecord,
  structuralEvaluation,
  type ObjectCarrierDraft,
  type ObjectCarrierMeta,
  type ObjectCarrierType,
} from './object-carriers.ts'

/** 拒写/写口失败分类（调用方按类处置；不抛——fail-closed 结果化） */
export type ObjectRefusalCode = 'shape-refused' | 'evidence-missing' | 'position-missing' | 'write-conflict' | 'write-failed'

/** 写口结果 */
export type ObjectWriteOutcome =
  | { readonly ok: true; readonly ref: HistRecordRef }
  | { readonly ok: false; readonly code: ObjectRefusalCode; readonly detail: string }

/** 族判定件上下文（仅 REC-CHG-01 需要段序/三门输入；其余族无上下文） */
export interface ObjectWriteContext {
  readonly previousSegment?: ChangeSegment
  readonly establishedSegments?: readonly ChangeSegment[]
  readonly gateDeciders?: Partial<Record<'verification_authorization' | 'independent_verification' | 'activation_approval', string>>
  readonly beneficiaryActors?: readonly string[]
}

/** 生产位置注入面（缺位＝对应载体不开面——不伪造决定者） */
export interface ObjectRecordPositions {
  /** REC-ACC-01 独立裁判位置（具名工号/位置；不得 daemon） */
  readonly accountabilityArbiter?: string
  /** 裁判独立性控制依据引用（须为已落库记录） */
  readonly arbiterControlBasisRef?: RecordRef
  /** REC-REV-01 复盘位置 */
  readonly reviewPosition?: string
  /** REC-ACC-02 救济作出者 */
  readonly remedyPosition?: string
  /** REC-EVAL-01 评价位置 */
  readonly evaluationPosition?: string
  /** 申辩窗口（毫秒；缺省 72h——I-11 不得无限期） */
  readonly defenseWindowMs?: number
}

/** 写面依赖 */
export interface ObjectRecordWireDeps {
  readonly hist: HistFace
  readonly company: string
  readonly now: () => number
  readonly positions?: ObjectRecordPositions
  readonly log?: (line: string) => void
}

/** 收割面载体结果（观测/测试断言面） */
export type HarvestCarrierOutcome =
  | { readonly status: 'written'; readonly ref: HistRecordRef }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'refused'; readonly code: ObjectRefusalCode; readonly detail: string }

/** 五对象载体写口（生产装配面持有；读写同 HIST 句柄） */
export interface ObjectRecordWire {
  /** 通用写口：形状闸→证据闭包→落库（同一闸，无旁路） */
  write(draft: ObjectCarrierDraft, ctx?: ObjectWriteContext): ObjectWriteOutcome
  /** OBJ-01 问责案例开案 */
  openAccountabilityCase(meta: ObjectCarrierMeta, payload: AccountabilityCasePayload): ObjectWriteOutcome
  /** OBJ-02 救济决定 */
  decideRemedy(meta: ObjectCarrierMeta, payload: RemedyDecisionPayload): ObjectWriteOutcome
  /** OBJ-03 变更链段 */
  recordChangeSegment(meta: ObjectCarrierMeta, payload: ChangeSegmentPayload, ctx?: ObjectWriteContext): ObjectWriteOutcome
  /** OBJ-04 复盘 */
  recordReview(meta: ObjectCarrierMeta, payload: ReviewPayload): ObjectWriteOutcome
  /** OBJ-05 结构评价 */
  recordStructuralEvaluation(meta: ObjectCarrierMeta, payload: StructuralEvaluationPayload): ObjectWriteOutcome
  /** 相位 4 收割完成钩落点（GATE_FAIL → ACC-01；completed=零对象载体，不伪造复盘/评价） */
  afterHarvest(ledger: Ledger, signal: RelayWorkSignal): HarvestCarrierOutcome
  /** 记录面观测（五类计数＋投影自洽对账——真机证据面） */
  observe(): { readonly counts: Readonly<Record<ObjectCarrierType, number>>; readonly settled: boolean; readonly checked: number; readonly differences: number }
}

const DEFAULT_DEFENSE_WINDOW_MS = 72 * 60 * 60 * 1000

/** 族不变量判定（形状之后第二道；返回 issue 数组，空=通过） */
function invariantIssues(draft: ObjectCarrierDraft, ctx: ObjectWriteContext): readonly string[] {
  switch (draft.recordType) {
    case 'REC-ACC-01': {
      const outcome = validateAccountabilityCase(draft.envelope)
      return outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}: ${issue.message}`)
    }
    case 'REC-ACC-02': {
      const outcome = validateRemedyDecision(draft.envelope)
      return outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}: ${issue.message}`)
    }
    case 'REC-CHG-01': {
      const outcome = validateChangeSegment(draft.envelope, {
        ...(ctx.previousSegment !== undefined ? { previousSegment: ctx.previousSegment } : {}),
        ...(ctx.establishedSegments !== undefined ? { establishedSegments: ctx.establishedSegments } : {}),
        ...(ctx.gateDeciders !== undefined ? { gateDeciders: ctx.gateDeciders } : {}),
        ...(ctx.beneficiaryActors !== undefined ? { beneficiaryActors: ctx.beneficiaryActors } : {}),
      })
      return outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}: ${issue.message}`)
    }
    case 'REC-REV-01': {
      const outcome = validateReview(draft.envelope)
      return outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}: ${issue.message}`)
    }
    case 'REC-EVAL-01': {
      const outcome = validateStructuralEvaluation(draft.envelope)
      return outcome.ok ? [] : outcome.issues.map((issue) => `${issue.path}: ${issue.message}`)
    }
  }
}

/** store 层异常 → 分类（CONFIG_INVALID subcause 口径；不改写口结论） */
function classifyError(error: unknown): ObjectWriteOutcome {
  const message = error instanceof Error ? error.message : String(error)
  const bag = typeof error === 'object' && error !== null ? (error as { subcause?: unknown }) : undefined
  const subcause = typeof bag?.subcause === 'string' ? bag.subcause : ''
  if (subcause.startsWith('store/hist:duplicate-id') || subcause.startsWith('store/hist:duplicate-idempotency-key')) {
    return { ok: false, code: 'write-conflict', detail: message }
  }
  return { ok: false, code: 'write-failed', detail: message }
}

/** 建五对象载体写口（一 serve 进程一实例；HIST 面沿用唯一写口） */
export function createObjectRecordWire(deps: ObjectRecordWireDeps): ObjectRecordWire {
  const { hist, company, now } = deps
  const log = deps.log ?? ((): void => undefined)
  const positions = deps.positions ?? {}

  const write = (draft: ObjectCarrierDraft, ctx: ObjectWriteContext = {}): ObjectWriteOutcome => {
    const parsed = ALL_RECORD_SCHEMAS[draft.recordType].safeParse(draft.envelope)
    if (!parsed.success) {
      const first = issuesFromZod(parsed.error)[0]
      const detail = `${draft.recordType} 形状拒收：${first?.path ?? '(root)'} ${first?.message ?? ''}`
      log(`[records] 拒写 ${detail}`)
      return { ok: false, code: 'shape-refused', detail }
    }
    const invariants = invariantIssues(draft, ctx)
    if (invariants.length > 0) {
      const detail = `${draft.recordType} 不变量拒收：${invariants.join('; ')}`
      log(`[records] 拒写 ${detail}`)
      return { ok: false, code: 'shape-refused', detail }
    }
    const bag = draft.envelope as { payload?: unknown }
    for (const ref of collectRecordRefs(bag.payload)) {
      const target = hist.get(ref.refId)
      if (target === undefined) {
        const detail = `${draft.recordType} 证据闭包缺失：${ref.refType}#${ref.refId} 未落库（不造悬空引用——§0.4-2）`
        log(`[records] 拒写 ${detail}`)
        return { ok: false, code: 'evidence-missing', detail }
      }
      if (target.recordType !== ref.refType) {
        const detail = `${draft.recordType} 引用类型不符：${ref.refId} 实为 ${target.recordType}（声明 ${ref.refType}）`
        log(`[records] 拒写 ${detail}`)
        return { ok: false, code: 'evidence-missing', detail }
      }
    }
    try {
      const ref = hist.append(draft.envelope)
      log(`[records] ${ref.appended ? '落' : '重放'} ${draft.recordType} id=${ref.recordId}（company=${company}）`)
      return { ok: true, ref }
    } catch (error) {
      const outcome = classifyError(error)
      log(`[records] 拒写 ${draft.recordType}：${outcome.ok ? '' : outcome.detail}`)
      return outcome
    }
  }

  const afterHarvest = (ledger: Ledger, signal: RelayWorkSignal): HarvestCarrierOutcome => {
    if (signal.outcome !== 'failed') {
      return { status: 'skipped', reason: 'completed（复盘/评价不由收割面代作——不伪造决定者）' }
    }
    const arbiter = positions.accountabilityArbiter
    const basisRef = positions.arbiterControlBasisRef
    if (arbiter === undefined || arbiter.trim() === '' || basisRef === undefined) {
      const detail = '独立裁判位置/控制依据引用未配置（OBJECT positions）——问责载体不开面'
      log(`[records] 拒写 REC-ACC-01：${detail}`)
      return { status: 'refused', code: 'position-missing', detail }
    }
    const work = hist.query({ company, type: 'REC-WORK-01' }).find((record) => record.idempotencyKey?.subjectId === signal.ticket)
    if (work === undefined) {
      const detail = `缺 REC-WORK-01（${signal.ticket}）——依赖 #527 记录族生产写面先落，不造悬空引用`
      log(`[records] 拒写 REC-ACC-01：${detail}`)
      return { status: 'refused', code: 'evidence-missing', detail }
    }
    const failure = ledger
      .queryEvents({ issue: signal.ticket, order: 'desc', limit: 20 })
      .find((event: EventRecord) => event.event === 'GATE_FAIL' && event.attempt === signal.attempt)
    if (failure === undefined) {
      const detail = `相位 4 未找到本 attempt 的 GATE_FAIL 事件（${signal.ticket} att${signal.attempt}）`
      log(`[records] 拒写 REC-ACC-01：${detail}`)
      return { status: 'refused', code: 'evidence-missing', detail }
    }
    const ts = now()
    const defenseWindowMs = positions.defenseWindowMs ?? DEFAULT_DEFENSE_WINDOW_MS
    const workRef: RecordRef = { refType: 'REC-WORK-01', refId: work.recordId, refVersion: work.specVersion }
    const meta: ObjectCarrierMeta = {
      company,
      subjectId: signal.ticket,
      operationClass: 'acc-case-open',
      requesterSequence: `att${signal.attempt}`,
      producedAt: new Date(ts).toISOString(),
      decidedBy: arbiter,
      writtenBy: 'daemon:engine/records/object-wire',
      proofBoundary:
        '本记录证明问责案例已按 OBJ-01 开案（质疑材料/申辩窗口/独立裁判位置/暂不能归因结论）；不证明责任成立、不证明救济、不改变任命或职级（v2/11 §七）',
    }
    const payload: AccountabilityCasePayload = {
      subject_ref: workRef,
      matter_refs: [workRef],
      inquiry_materials: {
        allegations: [`收割四要件未齐：${failure.note === undefined ? '（事件无 note）' : failure.note}`],
        explanations: [],
        adverse_information: [],
        silence_treated_as_report_exception: true,
      },
      defense_window: {
        deadline: new Date(ts + defenseWindowMs).toISOString(),
        overdue_disposition: '逾期未申辩按报告异常处理（不因沉默推定责任成立——I-11）',
      },
      arbiter: { verified_by: arbiter, control_basis_ref: basisRef },
      conclusion: 'attribution_undetermined',
      consequence_routing: {},
      dissent_position: '申辩窗口内以书面异议提交（异议位置见 defense_window）',
      proof_boundary: '本记录只证明开案与程序位；责任/救济结论归独立裁判位置另行作出',
    }
    const outcome = write(accountabilityCase(meta, payload), {})
    return outcome.ok ? { status: 'written', ref: outcome.ref } : { status: 'refused', code: outcome.code, detail: outcome.detail }
  }

  const observe = (): ReturnType<ObjectRecordWire['observe']> => {
    const counts: Record<ObjectCarrierType, number> = {
      'REC-ACC-01': 0,
      'REC-ACC-02': 0,
      'REC-CHG-01': 0,
      'REC-REV-01': 0,
      'REC-EVAL-01': 0,
    }
    for (const type of Object.keys(counts) as ObjectCarrierType[]) counts[type] = hist.query({ company, type }).length
    const batch = hist.reconcile({ company })
    return { counts, settled: batch.settled, checked: batch.checked, differences: batch.differences.length }
  }

  return {
    write,
    openAccountabilityCase: (meta, payload) => write(accountabilityCase(meta, payload)),
    decideRemedy: (meta, payload) => write(remedyDecision(meta, payload)),
    recordChangeSegment: (meta, payload, ctx) => write(changeSegment(meta, payload), ctx),
    recordReview: (meta, payload) => write(reviewRecord(meta, payload)),
    recordStructuralEvaluation: (meta, payload) => write(structuralEvaluation(meta, payload)),
    afterHarvest,
    observe,
  }
}
