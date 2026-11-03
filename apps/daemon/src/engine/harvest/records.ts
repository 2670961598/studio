/**
 * harvest/records —— 收割证据批次落库（REC-EVD-01/02 → PORT-HIST 唯一记录写口）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：第 4 位＝收割）／§6（收割四要件：终态 completed＋输出非空＋
 *     REPORT 落盘＋闸门 exit=0；REPORT 旁落 summary 只作续跑前情，不抬升判据）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口；PORT-EVD `registerItem` 只收草案不收记录——
 *     L3K-14 的落库腿在本件）；§二 规则②（记录形状唯一源＝contract）；
 *   - docs/v2/11 §〇（记录信封）/§0.4-1（身份一经分配不复用）/§0.4-5（幂等键五元组）/
 *     §六 REC-EVD-01（批次字段：segment_ref/source_cursor/collected_items/harvest_completeness/
 *     gaps/execution_terminal/usage_and_cost/idempotency_key）＋REC-EVD-02（证据项：source_anchor/
 *     element_state/element/proves/does_not_prove；`not_applicable`/`missing` 须理由与去向）；
 *   - docs/v2/08 §1.4（批次是 EX-2+ 验收的强制输入；完整性存疑不得判接受）、§1.3/§2.4-4
 *     （来源锚两级：自述不得单独支撑 EX-2+）、§1.5（执行观察≠验收≠结清）、§0.2-3（自供不成独立）；
 *   - docs/v2/09 ENU-48（八要素以 EVD-ELM-01..08 对象 ID 引用）/ENU-49（来源两级）/ENU-50
 *     （要素三态）/ENU-53（执行终态五值，不得压布尔）/ENU-60（完整性三态）；
 *   - docs/plan/03 §MIG-06 入口条件（DEC-OPEN-13 未裁前只落「收割者≠交付者」结构位）。
 *
 * 本件四面：
 *   ① 纯映射（零 IO、确定性）：批次视图＋证据项草案 → contract 同形记录信封（REC-EVD-01/02）；
 *   ② 落库时机：**封批（seal）时整批原子写**——REC-EVD-02 逐项＋REC-EVD-01 一条，同一批记录
 *      同事务（v2/14 §1.6 显式 tx；写口实现见 assembly/harvest/records.ts）；收集中（record）
 *      只登记内存视图，不写半套；
 *   ③ 幂等：recordId/幂等键由（出工段×采集区间＋证据项序）确定性导出——同键同内容重放返回既有
 *      （零第二副作用），同键异内容由 PORT-HIST 拒（v2/11 §0.4-5）；
 *   ④ fail-closed：终态未采集到（ENU-53 五值不含 `unknown`）＝整批拒写（不臆造终态、不落半套）；
 *      写口异常＝状态 failed 并具名理由；`acceptanceInputOf` 对未落库批次一律判不可作验收输入。
 *
 * 边界：零权限判定、零验收/结清判断（落库≠接受——acceptance/settlement 恒 not_judged）；不新增
 * 记录类/端口（74 类/20 端口不变）；不改四要件判据（判据唯一实现仍在 batch.ts）。
 */
import type { TerminalState, TicketId } from '@studio-next/contract'
import {
  FRAMEWORK_HARVESTER,
  HARVEST_INDEPENDENCE_DECLARATION,
  HARVEST_RECORDER,
  type HarvestBatchLedger,
  type HarvestBatchView,
  type HarvestEvidenceExtra,
  type HarvestRecordOutcome,
  type HarvestSealOutcome,
  type HarvestSegment,
} from './batch.ts'
import type { EvidenceItemDraft } from '@studio-next/contract'

// ————————————————————————— 一、记录面常量（单点；不另立第二套） —————————————————————————

/** 冻结 schema 工件引用（v2/10 §4.1；与 assembly/ops 同口径） */
export const HARVEST_RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与 packages/contract/src/artifacts/generate.ts SPEC_VERSION 同值） */
export const HARVEST_RECORD_SPEC_VERSION = '2.0.0'

/** 写入路径名（producer.writtenBy：写路径与具名决定者分开——v2/11 §0.2-1） */
export const HARVEST_RECORD_WRITTEN_BY = 'daemon:engine/harvest'

/**
 * 决定者＝框架机械通道标识（**结构位**，DEC-OPEN-13 未裁）：
 * 收割由框架机械通道完成，不存在具名个人决定者；本件不虚构第二采集主体/最小主体形态，
 * 裁决后回改。关系要件（收割者≠交付者）与未裁声明随 proofBoundary 同行，不静默读成「已独立」。
 */
const HARVEST_DECIDED_BY = HARVEST_RECORDER.callerId

/** PORT-EVD 八要素承载名 → ENU-48 对象 ID（唯一主表 v2/08 §1.2；不另造字面量） */
const EVIDENCE_ELEMENT_BY_PORT_ID: Readonly<Record<string, string>> = {
  authority: 'EVD-ELM-01',
  input: 'EVD-ELM-02',
  action: 'EVD-ELM-03',
  acceptance_object: 'EVD-ELM-04',
  self_check: 'EVD-ELM-05',
  external_feedback: 'EVD-ELM-06',
  cost: 'EVD-ELM-07',
  open_items: 'EVD-ELM-08',
}

/** 出工段引用（→REC-LIFE-04；refId＝单号@誓号——本件不臆造版本，类型版本取初始 1.0.0） */
const SEGMENT_REF_TYPE = 'REC-LIFE-04'
const RECORD_TYPE_VERSION = '1.0.0'

// ————————————————————————— 二、记录信封（contract 同形；本件不定义记录类） —————————————————————————

/** 记录信封（与 contract `RecordEnvelope` 同形；形状唯一源＝contract records/evd.ts） */
export interface HarvestRecordEnvelope {
  readonly recordId: string
  readonly recordType: 'REC-EVD-01' | 'REC-EVD-02'
  readonly schemaRef: { readonly schemaId: string; readonly schemaVersion: string }
  readonly specVersion: string
  readonly companyRef: string
  readonly producedAt: string
  readonly producer: { readonly decidedBy: string; readonly writtenBy: string }
  readonly basisRefs: readonly { readonly refId: string; readonly refVersion: string }[]
  readonly payload: Readonly<Record<string, unknown>>
  readonly effectiveState: 'effective'
  readonly effectiveTime: { readonly from: string }
  readonly proofBoundary: string
  readonly idempotencyKey?: {
    readonly companyRef: string
    readonly recordType: string
    readonly subjectId: string
    readonly operationClass: string
    readonly requesterSequence: string
  }
}

/** 出工段引用（REC-LIFE-04 记录引用形） */
export function harvestSegmentRef(segment: HarvestSegment): { refType: string; refId: string; refVersion: string } {
  return { refType: SEGMENT_REF_TYPE, refId: `${segment.ticket}@att${segment.attempt}`, refVersion: RECORD_TYPE_VERSION }
}

/**
 * 批次记录 ID（确定性：出工段×采集区间——重启后同批同 ID，重放由 PORT-HIST 判幂等）。
 * 记录 ID 语法未在 v2/10 登记（信封只约束非空串），本件不自造 qid 形态、只用可读稳定键。
 */
export function harvestBatchRecordId(segment: HarvestSegment, interval: { readonly from: number; readonly to: number }): string {
  return `REC-EVD-01.${segment.ticket}.att${segment.attempt}.${interval.from}-${interval.to}`
}

/** 证据项记录 ID（确定性：出工段＋证据项序——同批重放同 ID） */
export function evidenceItemRecordId(segment: HarvestSegment, index: number): string {
  return `REC-EVD-02.${segment.ticket}.att${segment.attempt}.${index + 1}`
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString()
}

/** 来源锚（ENU-49 两级）：独立复采＝机械可复算事实；执行面自述只作观察，不洗成独立 */
function anchorOf(draft: EvidenceItemDraft): 'independent_collection' | 'self_reported' {
  return draft.independentOfDeliverer ? 'independent_collection' : 'self_reported'
}

/** 要素三态（ENU-50）：只在被采集到「在场」时 present；字节状态未定/未采＝missing（须补件去向） */
function elementStateOf(draft: EvidenceItemDraft): 'present' | 'missing' {
  return draft.byteDigestState === 'present' ? 'present' : 'missing'
}

/** 证据项 → REC-EVD-02 信封（含证明边界；missing 写补件去向，不留空视为零） */
export function evidenceItemEnvelope(
  draft: EvidenceItemDraft,
  context: { readonly company: string; readonly segment: HarvestSegment; readonly index: number; readonly at: number },
): HarvestRecordEnvelope {
  const anchor = anchorOf(draft)
  const state = elementStateOf(draft)
  const ref = { refId: draft.sourceRef, refVersion: RECORD_TYPE_VERSION }
  const sourceChain =
    anchor === 'independent_collection'
      ? [`框架收割通道 ${FRAMEWORK_HARVESTER}（机械可复算：${draft.sourceKind}）`]
      : [`执行面自述经框架收割通道读到（${draft.sourceKind}）——自述不单独支撑 EX-2+`]
  return {
    recordId: evidenceItemRecordId(context.segment, context.index),
    recordType: 'REC-EVD-02',
    schemaRef: HARVEST_RECORD_SCHEMA_REF,
    specVersion: HARVEST_RECORD_SPEC_VERSION,
    companyRef: context.company,
    producedAt: isoOf(context.at),
    producer: { decidedBy: HARVEST_DECIDED_BY, writtenBy: HARVEST_RECORD_WRITTEN_BY },
    // v14 列集无 basis_refs 列：留空（非空即拒），依据引用登记在 provenance/证明边界
    basisRefs: [],
    payload: {
      element: EVIDENCE_ELEMENT_BY_PORT_ID[draft.element] ?? 'EVD-ELM-04',
      content_ref: ref,
      formed_at: isoOf(context.at),
      observed_at: isoOf(context.at),
      source_chain: sourceChain,
      source_anchor: anchor,
      element_state: state,
      ...(state === 'missing' ? { missing_refill_route: '由收割通道补采或退回归档（REC-EVD-01.gaps 承载）' } : {}),
      knowledge_scope: `${context.company}/harvest`,
      integrity_state: draft.byteDigestState,
      proves: draft.proofBoundary.proves.join('；'),
      does_not_prove: draft.proofBoundary.doesNotProve.join('；'),
    },
    effectiveState: 'effective',
    effectiveTime: { from: isoOf(context.at) },
    proofBoundary: `本证据项证明「${draft.proofBoundary.proves.join('；')}」被框架收割通道按 REC-EVD-02 登记；不证明「${draft.proofBoundary.doesNotProve.join('；')}」`,
    idempotencyKey: {
      companyRef: context.company,
      recordType: 'REC-EVD-02',
      subjectId: `${context.segment.ticket}@att${context.segment.attempt}/${draft.sourceKind}`,
      operationClass: 'harvest',
      requesterSequence: String(context.index + 1),
    },
  }
}

/** 结构位声明（REC-EVD-01 证明边界：关系要件＋未裁决策号同行；重复/失败批次同样携带） */
export function harvesterSlotDeclarationOf(batch: HarvestBatchView): string {
  return `收割者=${batch.harvester.harvester}；交付者=${batch.harvester.deliverer}；收割者≠交付者=${String(batch.harvester.differsFromDeliverer)}（关系要件）；${HARVEST_INDEPENDENCE_DECLARATION}`
}

/** 批次视图＋已落证据项 ID → REC-EVD-01 信封（终态五值直取，不压缩成布尔） */
export function harvestBatchEnvelope(
  batch: HarvestBatchView,
  context: {
    readonly company: string
    readonly at: number
    readonly itemRecordIds: readonly string[]
    readonly terminal: TerminalState
  },
): HarvestRecordEnvelope {
  const to = batch.interval.to ?? context.at
  const segmentRef = harvestSegmentRef(batch.segment)
  const recordId = harvestBatchRecordId(batch.segment, { from: batch.interval.from, to })
  return {
    recordId,
    recordType: 'REC-EVD-01',
    schemaRef: HARVEST_RECORD_SCHEMA_REF,
    specVersion: HARVEST_RECORD_SPEC_VERSION,
    companyRef: context.company,
    producedAt: isoOf(context.at),
    producer: { decidedBy: HARVEST_DECIDED_BY, writtenBy: HARVEST_RECORD_WRITTEN_BY },
    basisRefs: [],
    payload: {
      segment_ref: segmentRef,
      source_cursor: batch.idempotencyKey ?? `${segmentRef.refId}|${batch.interval.from}-${to}`,
      collected_items: batch.items.map((item, index) => ({
        item: item.sourceKind,
        content_ref: { refId: context.itemRecordIds[index] ?? evidenceItemRecordId(batch.segment, index), refVersion: RECORD_TYPE_VERSION },
      })),
      harvest_completeness: batch.completeness,
      gaps: batch.gaps,
      execution_terminal: context.terminal,
      // 实际用量/成本归 REC-WORK-05 与 cost 面；本记录不臆造金额（空数组＝未登记，不是零成本）
      usage_and_cost: { usage: [], cost: [] },
      idempotency_key: {
        segment_ref: segmentRef,
        collection_from: isoOf(batch.interval.from),
        collection_to: isoOf(to),
      },
    },
    effectiveState: 'effective',
    effectiveTime: { from: isoOf(context.at) },
    proofBoundary:
      '本记录证明引擎第 4 相位（收割，docs/17-§2）按 REC-EVD-01 登记该出工段的四要件观察面（终态/输出/REPORT/闸门退出码）' +
      '与完整性/gaps；不证明验收合格、结清、价值（X2/X3/X4 三判不合并）。' +
      harvesterSlotDeclarationOf(batch),
    idempotencyKey: {
      companyRef: context.company,
      recordType: 'REC-EVD-01',
      subjectId: segmentRef.refId,
      operationClass: 'harvest',
      requesterSequence: `${batch.interval.from}-${to}`,
    },
  }
}

// ————————————————————————— 三、落库口（写口注入；本件零 IO） —————————————————————————

/** PORT-HIST 批量写口（同域多记录一事务：要么整批落库、要么零落库） */
export interface HarvestRecordSink {
  appendMany(records: readonly unknown[]): readonly { readonly recordId: string; readonly appended: boolean }[]
}

/** 落库状态（pending＝收集中/未封批；refused＝按规矩拒写；failed＝写口异常） */
export type HarvestRecordingState = 'pending' | 'persisted' | 'refused' | 'failed'

/** 单批落库视图（观测/测试/验收输入闸；写口仅封批一次） */
export interface HarvestRecordingView {
  readonly segment: HarvestSegment
  readonly state: HarvestRecordingState
  readonly reasons: readonly string[]
  readonly batchRecordId: string | undefined
  readonly itemRecordIds: readonly string[]
  readonly recordedAt: string | undefined
}

export interface HarvestRecordingOptions {
  readonly sink: HarvestRecordSink
  readonly company: string
  readonly now: () => number
  /** 落库问题观测行（软失败：只记日志，不改写口结论——结论仍在 state/reasons） */
  readonly onProblem?: (line: string) => void
}

/** 录制簿＝批次簿子类型（现有 `HarvestBatchLedger` 消费面零改；额外暴露落库视图） */
export interface HarvestRecordingLedger extends HarvestBatchLedger {
  recordingOf(input: { readonly ticket: TicketId; readonly attempt: number }): HarvestRecordingView | undefined
  recordings(): readonly HarvestRecordingView[]
}

interface RecordingCell {
  segment: HarvestSegment
  state: HarvestRecordingState
  reasons: string[]
  batchRecordId: string | undefined
  itemRecordIds: string[]
  recordedAt: string | undefined
}

function recordingViewOf(cell: RecordingCell): HarvestRecordingView {
  return {
    segment: cell.segment,
    state: cell.state,
    reasons: [...cell.reasons],
    batchRecordId: cell.batchRecordId,
    itemRecordIds: [...cell.itemRecordIds],
    recordedAt: cell.recordedAt,
  }
}

/**
 * 录制簿装饰器：把批次簿的**封批**接到 PORT-HIST 写口（一引擎一簿；缺省不包＝纯内存旧行为）。
 * fail-closed 纪律：任何拒写/写失败都只落在 recording 视图（state＋具名理由），不抛到主循环、
 * 不改四要件判据——证据面是投影（records 不是第四事实源），但**不得被读成已落库/可作验收输入**。
 */
export function createHarvestRecordingLedger(inner: HarvestBatchLedger, options: HarvestRecordingOptions): HarvestRecordingLedger {
  const cells = new Map<string, RecordingCell>()
  const keyOf = (segment: HarvestSegment): string => `${segment.ticket}@att${segment.attempt}`
  const cellOf = (segment: HarvestSegment): RecordingCell => {
    const key = keyOf(segment)
    const existing = cells.get(key)
    if (existing !== undefined) return existing
    const cell: RecordingCell = { segment, state: 'pending', reasons: [], batchRecordId: undefined, itemRecordIds: [], recordedAt: undefined }
    cells.set(key, cell)
    return cell
  }

  const refuse = (cell: RecordingCell, reason: string): void => {
    cell.state = 'refused'
    cell.reasons = [reason]
    options.onProblem?.(`[harvest] REC-EVD-01 拒绝落库（${keyOf(cell.segment)}）：${reason}`)
  }

  return {
    begin(input) {
      const view = inner.begin(input)
      cellOf(view.segment)
      return view
    },

    record(input, requirements, extra?: HarvestEvidenceExtra): HarvestRecordOutcome {
      const outcome = inner.record(input, requirements, extra)
      const segment: HarvestSegment = { ticket: input.ticket, attempt: input.attempt }
      const cell = cellOf(segment)
      // 收集中只登记视图（零写）；冲突批次直接判拒（不落半套、不当验收输入）
      if (outcome.status === 'conflict') refuse(cell, '同键异内容（幂等冲突）——重复交付已拒，不得落库冒充批次')
      return outcome
    },

    seal(input, outcome, at): HarvestSealOutcome {
      const sealed = inner.seal(input, outcome, at)
      const segment: HarvestSegment = { ticket: input.ticket, attempt: input.attempt }
      const cell = cellOf(segment)
      if (cell.state === 'persisted') return sealed // 重复封批：零第二副作用（写口不再调用）
      const batch = sealed.batch
      if (batch === undefined) {
        if (sealed.status === 'missing') refuse(cell, sealed.reason ?? '批次未 begin：无采集段可封')
        return sealed
      }
      if (sealed.status === 'conflict') {
        refuse(cell, sealed.reason ?? '同键异内容（幂等冲突）')
        return sealed
      }
      const requirements = batch.requirements
      if (requirements === undefined) {
        refuse(cell, '四要件未登记（批次无 record）：不得以空证据冒充完整批次')
        return sealed
      }
      const terminal = batch.executionTerminal
      if (terminal === 'unknown') {
        // ENU-53 五值不含 unknown：终态未采集到＝不臆造、不落半套（批次＋证据项整批拒写）
        refuse(cell, '执行终态未采集到（ENU-53 五值不含 unknown）——不臆造终态、不落半套')
        return sealed
      }
      const to = batch.interval.to ?? at
      const itemIds = batch.items.map((_, index) => evidenceItemRecordId(segment, index))
      const records: unknown[] = [
        ...batch.items.map((item, index) =>
          evidenceItemEnvelope(item, { company: options.company, segment, index, at }),
        ),
        harvestBatchEnvelope(batch, { company: options.company, at, itemRecordIds: itemIds, terminal }),
      ]
      try {
        const refs = options.sink.appendMany(records)
        cell.state = 'persisted'
        cell.reasons = []
        cell.itemRecordIds = refs.slice(0, -1).map((ref) => ref.recordId)
        cell.batchRecordId = refs[refs.length - 1]?.recordId
        cell.recordedAt = isoOf(to)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        cell.state = 'failed'
        cell.reasons = [`REC-EVD-01/02 未落库（记录写口异常）：${message}`]
        options.onProblem?.(`[harvest] REC-EVD-01/02 未落库（${keyOf(segment)}）：${message}`)
      }
      return sealed
    },

    get(input) {
      return inner.get(input)
    },

    all() {
      return inner.all()
    },

    recordingOf(input) {
      const cell = cells.get(keyOf({ ticket: input.ticket, attempt: input.attempt }))
      return cell === undefined ? undefined : recordingViewOf(cell)
    },

    recordings() {
      return [...cells.values()].map(recordingViewOf)
    },
  }
}
