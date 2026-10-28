/**
 * harvest/batch —— 收割批次编排（REC-EVD-01 观察面 / PORT-EVD 编排腿）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-03（engine 拆分·收割域；领土 `engine/harvest/`）；
 *     docs/plan/03 §MIG-06 入口条件（DEC-OPEN-13 未裁前只落「收割者≠交付者」结构位）；
 *   - docs/v2/08 §1.4（收割批次 EVD-HVT 是 EX-2+ 验收判断的**强制输入**；四要件；收割
 *     完整性规则；独立收割者＝收割者≠交付者，**最小主体形态＝84b 未决**）、§1.5（五类
 *     判断不合并：执行结果不能推出完成/验收/结清）、§2.2（独立角色供给表：框架收割机制
 *     ＝独立于交付方的机械通道；不可得时不得按自报闭合）、§1.3（来源锚两级：自述不得
 *     单独支撑 EX-2+；对账差异非空即判负）；
 *   - docs/v2/11 §六 REC-EVD-01（收割批次字段：segment_ref/source_cursor/collected_items/
 *     harvest_completeness/gaps/execution_terminal（五值仅作观察，**不得压缩为布尔**）/
 *     usage_and_cost/idempotency_key（区间键）＋不变量：「无输出」与「没采集到」是两件事、
 *     重复收割按幂等键去重、完整性存疑时不得判接受）、REC-EVD-02（证据项：source_anchor/
 *     element_state/proves/does_not_prove；自述不得单独支撑 EX-2+）；
 *   - docs/v2/14 §1.6（PORT-EVD `harvest(seg, window)` 幂等键＝（出工段×采集区间）；
 *     `registerItem` 只收草案不收记录——记录写入归 PORT-HIST）；
 *   - docs/v2/17 NEG-EVD-01（自述与独立两分，对账差异非空即判负）／NEG-REC-05
 *     （X2 事件冒验收／X3 回执冒验收／X4 验收冒结清——完成分级三分离校验拒）。
 *
 * 本件四面（自 engine.ts 抽出——20-§十五「先拆再增」，engine 只留相位缝）：
 *   ① 区间幂等键：key＝（出工段 ticket×attempt × 采集区间 [from,to]）。重复交付按同键
 *      去重（零第二副作用）；同键异内容＝conflict（幂等冲突，拒第二次副作用）；收集中
 *      同段重复 begin＝resumed（增量泵收跨拍续收不新开批次）。
 *   ② 证据项登记：四要件 → `EvidenceItemDraft`（PORT-EVD.registerItem 入参形状，**收
 *      草案不收记录**；本件不写台账、不新增记录类）。自述面（执行面终态）与机械采集面
 *      （输出/REPORT/闸门退出码）逐项标 `independentOfDeliverer`，自述不得冒充独立。
 *   ③ 收割者≠交付者结构位（DEC-OPEN-13 未裁）：harvester＝框架机械通道常量（唯一采集
 *      路径），deliverer＝入口工号；`independence` 恒 `'undetermined'`——**本件不虚构独立
 *      收割通道/第二采集主体**，只落关系要件与声明，等裁决。
 *   ④ 失败/部分/重复批次：`harvest_completeness` 三态＋`gaps`；「无输出」与「没采集到」
 *      分开（后者判 unknown 并记「终态未采集到」）；完整性存疑/冲突/未封批次不得作验收
 *      输入（`acceptanceInputOf`，分级口径在 harvest/stages.ts）。X2/X3/X4 三判不合并以
 *      `HARVEST_STAGE_BOUNDARIES` 固定（执行观察＝本件；验收/结清恒 not_judged，归独立
 *      验收/核验位置）。
 *
 * 边界（与拆前 engine.ts 内联体逐字一致）：`runHarvestAttempt`＝原 harvestOne（适配器解析→
 * 增量泵收→判定体）；泵收时点仍取 `Date.now()` 时间片（拍有界语义零漂移），批次时点经
 * host.now（引擎注入时钟，测试可推）。零 IO 判定、零记录写入；四要件判定/`GATE_PASS|
 * FAIL`/迁移/预算/断路器全在调用方（引擎）与 core，本件不复制。
 */
import type {
  CallerRef,
  Completeness,
  EvidenceItemDraft,
  ExecutorAdapter,
  StreamEvent,
  TerminalState,
  TicketId,
} from '@studio-next/contract'
import type { Inflight } from '../tick/types.ts'
import { parkRace, PARKED } from './park.ts'

// ————————————————————————— 收割者≠交付者结构位（DEC-OPEN-13） —————————————————————————

/**
 * 收割者标识＝框架机械通道（v2/08 §2.2 常态供给：独立于交付方的机械通道）。
 * **唯一采集路径**：本件不建第二条收割通道，也不以「独立收割者」自称——
 * 独立收割最小主体形态＝DEC-OPEN-13 未裁（docs/v2/09 待裁表；plan/06 硬闸）。
 */
export const FRAMEWORK_HARVESTER = 'framework.daemon.harvest' as const

/** 未裁决策号（落结构位时随声明同行——不静默把「未定」读成「已独立」） */
export const HARVEST_INDEPENDENCE_PENDING = 'DEC-OPEN-13' as const

/** 结构位声明（恒随批次同存：重复/失败批次也同样携带——声明不丢） */
export const HARVEST_INDEPENDENCE_DECLARATION =
  '收割者≠交付者（关系要件成立即登记）；独立收割最小主体形态=DEC-OPEN-13 未裁——' +
  '本件只落结构位，不虚构独立收割通道（唯一采集路径=框架机械通道 framework.daemon.harvest）'

/** 独立性取值（只有「未定」——裁前不得出现 'independent' 面） */
export type HarvestIndependence = 'undetermined'

/** 收割者/交付者结构位（每批次登记一份；不参与任何放行判定，只作声明与负例判据） */
export interface HarvesterSlot {
  readonly harvester: string
  readonly deliverer: string
  /** 关系要件：收割者≠交付者（同体＝自供不成独立——v2/08 §0.2-3） */
  readonly differsFromDeliverer: boolean
  readonly independence: HarvestIndependence
  readonly pendingDecision: typeof HARVEST_INDEPENDENCE_PENDING
  readonly declaration: string
}

/** 构造结构位（deliverer 缺省/空串如实记 '-'——不得编造独立主体） */
export function harvesterSlotOf(input: { readonly deliverer: string | undefined }): HarvesterSlot {
  const deliverer = input.deliverer !== undefined && input.deliverer !== '' ? input.deliverer : '-'
  return {
    harvester: FRAMEWORK_HARVESTER,
    deliverer,
    differsFromDeliverer: deliverer !== FRAMEWORK_HARVESTER,
    independence: 'undetermined',
    pendingDecision: HARVEST_INDEPENDENCE_PENDING,
    declaration: HARVEST_INDEPENDENCE_DECLARATION,
  }
}

// ————————————————————————— 一、四要件与区间幂等键 —————————————————————————

/** 出工段（REC-LIFE-04 视角：单号×誓号——一次派发收割为一个采集段） */
export interface HarvestSegment {
  readonly ticket: TicketId
  readonly attempt: number
}

/** 采集区间（幂等键第二槽；begin 时 from 已知、seal 时 to 定稿） */
export interface HarvestInterval {
  readonly from: number
  readonly to: number | undefined
}

/**
 * 区间幂等键（REC-EVD-01.idempotency_key 的 daemon 侧单点公式）：
 * 出工段 × 采集区间——同键重复收割去重，不产生第二次副作用（v2/11 §六）。
 */
export function harvestIntervalKey(segment: HarvestSegment, interval: { readonly from: number; readonly to: number }): string {
  return `${segment.ticket}@att${segment.attempt}|${interval.from}-${interval.to}`
}

/** 四要件原始输入（终态/非空输出/REPORT/闸门 exit=0——v2/04 §1.2 冻结口径） */
export interface HarvestRequirementInput {
  readonly completed: boolean
  readonly nonEmptyOutput: boolean
  readonly reportExists: boolean
  readonly exit0: boolean
  /** turn_end 是否被观察到（false＝「没采集到」，不是「无输出」——两件事） */
  readonly terminalObserved: boolean
  readonly terminalError: string | undefined
}

/** 四要件判定结果（含失败归因面；`missing` 文案与拆前 GATE_FAIL 逐字一致） */
export interface HarvestRequirements extends HarvestRequirementInput {
  readonly fourOk: boolean
  /** GATE_FAIL 缺项清单（判定序＝终态/输出/REPORT/闸门——既有事件序不漂移） */
  readonly missing: readonly string[]
  /** 批次 gaps（completeness 归因；「没采集到」与「无输出」分开） */
  readonly gaps: readonly string[]
  /** 执行面终态观察（五值仅作观察；未采到/细分不可得＝unknown，不以布尔臆造） */
  readonly executionTerminal: TerminalState | 'unknown'
}

/**
 * 四要件判定（唯一实现——engine `finalizeHarvest` 与失败面共用，防两处漂移）。
 * 判据不变：`fourOk`＝四项全真；`missing` 供 GATE_FAIL 文案；`gaps` 供批次完整性。
 */
export function harvestRequirementsOf(input: HarvestRequirementInput): HarvestRequirements {
  const missing: string[] = [
    ...(input.completed ? [] : ['终态 completed']),
    ...(input.nonEmptyOutput ? [] : ['输出非空']),
    ...(input.reportExists ? [] : ['REPORT 落盘']),
    ...(input.exit0 ? [] : ['闸门 exit=0']),
  ]
  const gaps: string[] = [
    ...(input.terminalObserved ? (input.completed ? [] : ['终态 completed']) : ['终态未采集到']),
    ...(input.nonEmptyOutput ? [] : ['输出非空']),
    ...(input.reportExists ? [] : ['REPORT 落盘']),
    ...(input.exit0 ? [] : ['闸门 exit=0']),
  ]
  return {
    ...input,
    fourOk: input.completed && input.nonEmptyOutput && input.reportExists && input.exit0,
    missing,
    gaps,
    executionTerminal: executionTerminalOf(input),
  }
}

/**
 * 执行面终态观察（ENU-53 五值）：completed 可判；非完成且无错误原文时只能 `'unknown'`
 * ——**不从布尔臆造 blocked/aborted/limit_exceeded**（v2/11 §六「不得压缩为布尔」）。
 */
function executionTerminalOf(input: HarvestRequirementInput): TerminalState | 'unknown' {
  if (!input.terminalObserved) return 'unknown'
  if (input.completed) return 'completed'
  return input.terminalError !== undefined ? 'error' : 'unknown'
}

/** GATE_FAIL 文案（唯一出口——与拆前逐字一致：缺项＋turn_end.error＋gate 注） */
export function harvestFailureDetail(
  requirements: HarvestRequirements,
  extra: { readonly terminalError: string | undefined; readonly gateNote: string | undefined },
): string {
  return `GATE_FAIL：四要件缺【${requirements.missing.join('、')}】${extra.terminalError !== undefined ? `；turn_end.error=${extra.terminalError}` : ''}${extra.gateNote !== undefined ? `；gate=${extra.gateNote}` : ''}`
}

/** 断路器签名（同签名连击才熔断——形态串与拆前一致） */
export function harvestFailureSignature(requirements: HarvestRequirements): string {
  return `harvest:${requirements.completed ? 'c' : '-'}${requirements.nonEmptyOutput ? 'o' : '-'}${requirements.reportExists ? 'r' : '-'}${requirements.exit0 ? 'g' : '-'}`
}

// ————————————————————————— 二、证据项登记（REC-EVD-02 草案） —————————————————————————

/** 框架收割通道署名（程序类；不承载权源——权源校验归 PORT-AUTH） */
export const HARVEST_RECORDER: CallerRef = {
  callerId: FRAMEWORK_HARVESTER,
  kind: 'program',
  programRef: 'PORT-EVD.harvest',
}

/** 证据项构造输入（refs 只透传调用方已观测值，不猜路径） */
export interface HarvestEvidenceInput {
  readonly segment: HarvestSegment
  readonly requirements: HarvestRequirements
  readonly reportPath?: string
}

/**
 * 四要件 → 证据项草案（PORT-EVD.registerItem 形状；**收草案不收记录**）。
 *
 * 来源锚逐项标注（v2/08 §1.3/§2.4-4）：
 *   - 执行面终态＝自述面（executor turn_end）→ `independentOfDeliverer:false`
 *     （机械通道只保证「被框架读到」，不把自述洗成独立采集）；
 *   - 非空输出/REPORT 落盘/闸门退出码＝机械可复算事实 → `true`（机械通道采集）。
 * 每项 `doesNotProve` 固定排除「验收合格/结清/价值」——证据项不冒判断（§1.5）。
 */
export function evidenceItemsOf(input: HarvestEvidenceInput): readonly EvidenceItemDraft[] {
  const { segment, requirements } = input
  const ref = (suffix: string): string => `${segment.ticket}@att${segment.attempt}:${suffix}`
  return [
    {
      workRef: ref('work'),
      element: 'action',
      sourceKind: 'execution_terminal_observation',
      sourceRef: ref('turn_end'),
      byteDigestState: requirements.terminalObserved ? 'present' : 'not_collected',
      proofBoundary: {
        proves: ['执行面终态被框架收割通道观察（执行面自报，仅作观察）'],
        doesNotProve: ['工作完成', '验收合格', '结清', '价值'],
      },
      recordedBy: HARVEST_RECORDER,
      independentOfDeliverer: false,
    },
    {
      workRef: ref('work'),
      element: 'acceptance_object',
      sourceKind: 'harvest_stream_scan',
      sourceRef: ref('stream'),
      byteDigestState: requirements.nonEmptyOutput ? 'present' : 'not_collected',
      proofBoundary: {
        proves: ['框架从执行流中观察到非空输出'],
        doesNotProve: ['输出内容符合验收口径', '工作完成', '结清'],
      },
      recordedBy: HARVEST_RECORDER,
      independentOfDeliverer: true,
    },
    {
      workRef: ref('work'),
      element: 'acceptance_object',
      sourceKind: 'gate_workspace_scan',
      sourceRef: input.reportPath ?? ref('REPORT'),
      byteDigestState: requirements.reportExists ? 'present' : 'not_collected',
      proofBoundary: {
        proves: ['REPORT 落盘于工位（闸门机械核）'],
        doesNotProve: ['REPORT 内容充分', '验收合格', '结清'],
      },
      recordedBy: HARVEST_RECORDER,
      independentOfDeliverer: true,
    },
    {
      workRef: ref('work'),
      element: 'action',
      sourceKind: 'gate_exit_receipt',
      sourceRef: ref('gate-exit'),
      byteDigestState: requirements.exit0 ? 'present' : 'unknown',
      proofBoundary: {
        proves: ['闸门退出码被机械采集（宿主回执）'],
        doesNotProve: ['验收合格（X3：回执不证符合口径）', '结清', '价值'],
      },
      recordedBy: HARVEST_RECORDER,
      independentOfDeliverer: true,
    },
  ]
}

// ————————————————————————— 三、批次簿（重复/部分/失败） —————————————————————————

/** 批次生命周期（duplicate 是 seal 结果不是状态——首个封批记录保持权威） */
export type HarvestBatchStatus = 'collecting' | 'recorded' | 'sealed' | 'conflict'

/** 批次只读视图（面板/测试观测面；写口仅 begin/record/seal 三方法） */
export interface HarvestBatchView {
  readonly segment: HarvestSegment
  readonly interval: HarvestInterval
  readonly harvester: HarvesterSlot
  readonly status: HarvestBatchStatus
  readonly completeness: Completeness
  readonly executionTerminal: TerminalState | 'unknown'
  readonly gaps: readonly string[]
  readonly items: readonly EvidenceItemDraft[]
  readonly requirements: HarvestRequirements | undefined
  /** 区间幂等键（封批时定稿；收集中＝undefined） */
  readonly idempotencyKey: string | undefined
}

export type HarvestRecordOutcomeName = 'recorded' | 'duplicate' | 'conflict' | 'missing'
export type HarvestSealOutcomeName = 'sealed' | 'duplicate' | 'conflict' | 'missing'

/** 证据项登记附加面（已观测值透传；不猜路径） */
export interface HarvestEvidenceExtra {
  readonly reportPath?: string
}

export interface HarvestRecordOutcome {
  readonly status: HarvestRecordOutcomeName
  readonly batch: HarvestBatchView | undefined
}

export interface HarvestSealOutcome {
  readonly status: HarvestSealOutcomeName
  readonly batch: HarvestBatchView | undefined
  readonly duplicateOf?: string
  /** 冲突/缺批次时的具名理由（不静默） */
  readonly reason?: string
}

/** 批次簿（一引擎一簿；段→批次，键→封批映射） */
export interface HarvestBatchLedger {
  begin(input: { readonly ticket: TicketId; readonly attempt: number; readonly deliverer: string | undefined; readonly at: number }): HarvestBatchView
  record(input: { readonly ticket: TicketId; readonly attempt: number; readonly deliverer: string | undefined }, requirements: HarvestRequirements, extra?: HarvestEvidenceExtra): HarvestRecordOutcome
  seal(input: { readonly ticket: TicketId; readonly attempt: number }, outcome: 'completed' | 'failed', at: number): HarvestSealOutcome
  get(input: { readonly ticket: TicketId; readonly attempt: number }): HarvestBatchView | undefined
  all(): readonly HarvestBatchView[]
}

/** 内容签名（幂等比对：同键同内容＝duplicate；同键异内容＝conflict） */
function signatureOf(requirements: HarvestRequirements): string {
  return `${requirements.completed ? 'c' : '-'}${requirements.nonEmptyOutput ? 'o' : '-'}${requirements.reportExists ? 'r' : '-'}${requirements.exit0 ? 'g' : '-'}|${requirements.terminalObserved ? 't' : '-'}|${requirements.executionTerminal}`
}

interface BatchCell {
  segment: HarvestSegment
  from: number
  to: number | undefined
  slot: HarvesterSlot
  status: HarvestBatchStatus
  completeness: Completeness
  executionTerminal: TerminalState | 'unknown'
  gaps: string[]
  items: EvidenceItemDraft[]
  requirements: HarvestRequirements | undefined
  signature: string | undefined
  idempotencyKey: string | undefined
  sealedOutcome: 'completed' | 'failed' | undefined
}

/** 视图快照（只读面不暴露可写数组） */
function viewOf(cell: BatchCell): HarvestBatchView {
  return {
    segment: cell.segment,
    interval: { from: cell.from, to: cell.to },
    harvester: cell.slot,
    status: cell.status,
    completeness: cell.completeness,
    executionTerminal: cell.executionTerminal,
    gaps: [...cell.gaps],
    items: [...cell.items],
    requirements: cell.requirements,
    idempotencyKey: cell.idempotencyKey,
  }
}

/** 完整性三态（ENU-60）：四要件齐＝complete；终态采到但不齐＝incomplete；没采到＝unknown */
function completenessOf(requirements: HarvestRequirements | undefined): Completeness {
  if (requirements === undefined) return 'unknown'
  if (requirements.fourOk) return 'complete'
  return requirements.terminalObserved ? 'incomplete' : 'unknown'
}

/**
 * 建批次簿（内存投影；可重建，重启即空——批次记录本体写面归 PORT-HIST/后续单，本件不写）。
 * 会计纪律：同段只一活跃批次（增量泵收）；封批后同键重复交付零第二副作用。
 */
export function createHarvestBatchLedger(): HarvestBatchLedger {
  const cells = new Map<string, BatchCell>()
  const segmentKey = (segment: HarvestSegment): string => `${segment.ticket}@att${segment.attempt}`

  const cellOf = (input: { ticket: TicketId; attempt: number; deliverer: string | undefined }, at: number): BatchCell => {
    const segment: HarvestSegment = { ticket: input.ticket, attempt: input.attempt }
    const cell: BatchCell = {
      segment,
      from: at,
      to: undefined,
      slot: harvesterSlotOf({ deliverer: input.deliverer }),
      status: 'collecting',
      completeness: 'unknown',
      executionTerminal: 'unknown',
      gaps: [],
      items: [],
      requirements: undefined,
      signature: undefined,
      idempotencyKey: undefined,
      sealedOutcome: undefined,
    }
    cells.set(segmentKey(segment), cell)
    return cell
  }

  return {
    begin(input) {
      const existing = cells.get(segmentKey({ ticket: input.ticket, attempt: input.attempt }))
      // 同段已在收/已收＝增量泵收跨拍续收或重复 begin：返回既有批次（不新开、不重算区间）
      if (existing !== undefined) return viewOf(existing)
      return viewOf(cellOf(input, input.at))
    },

    record(input, requirements, extra) {
      const cell = cells.get(segmentKey({ ticket: input.ticket, attempt: input.attempt }))
      if (cell === undefined) {
        return { status: 'missing', batch: undefined }
      }
      const signature = signatureOf(requirements)
      if (cell.status === 'conflict') return { status: 'conflict', batch: viewOf(cell) }
      if (cell.status === 'sealed') {
        // 同键异内容：首个封批记录保持权威，第二次交付拒（零第二副作用）
        return cell.signature === signature
          ? { status: 'duplicate', batch: viewOf(cell) }
          : { status: 'conflict', batch: viewOf(cell) }
      }
      if (cell.signature !== undefined) {
        if (cell.signature === signature) return { status: 'duplicate', batch: viewOf(cell) }
        // 封批前同键异内容：批次判冲突（未封＝无权威内容），不得作验收输入
        cell.status = 'conflict'
        cell.gaps.push('同键异内容（重复交付内容不符）——第二次副作用拒')
        return { status: 'conflict', batch: viewOf(cell) }
      }
      cell.requirements = requirements
      cell.signature = signature
      cell.completeness = completenessOf(requirements)
      cell.executionTerminal = requirements.executionTerminal
      cell.gaps = [...requirements.gaps]
      cell.items = [...evidenceItemsOf({ segment: cell.segment, requirements, ...(extra?.reportPath !== undefined ? { reportPath: extra.reportPath } : {}) })]
      cell.status = 'recorded'
      return { status: 'recorded', batch: viewOf(cell) }
    },

    seal(input, outcome, at) {
      const cell = cells.get(segmentKey({ ticket: input.ticket, attempt: input.attempt }))
      if (cell === undefined) return { status: 'missing', batch: undefined, reason: '批次未 begin：无采集段可封' }
      if (cell.status === 'conflict') {
        return { status: 'conflict', batch: viewOf(cell), reason: '同键异内容（幂等冲突）——第二次副作用拒' }
      }
      if (cell.status === 'sealed') {
        // 重复交付：键/内容同＝duplicate（零第二副作用）；内容异＝conflict（首批保持权威）
        if (cell.sealedOutcome === outcome && cell.signature !== undefined) {
          return { status: 'duplicate', batch: viewOf(cell), duplicateOf: cell.idempotencyKey ?? '' }
        }
        return { status: 'conflict', batch: viewOf(cell), reason: '同键异内容：重复封批内容不符——首批保持权威' }
      }
      cell.to = at
      cell.completeness = completenessOf(cell.requirements)
      cell.idempotencyKey = harvestIntervalKey(cell.segment, { from: cell.from, to: at })
      cell.sealedOutcome = outcome
      cell.status = 'sealed'
      return { status: 'sealed', batch: viewOf(cell) }
    },

    get(input) {
      const cell = cells.get(segmentKey({ ticket: input.ticket, attempt: input.attempt }))
      return cell === undefined ? undefined : viewOf(cell)
    },

    all() {
      return [...cells.values()].map(viewOf)
    },
  }
}

// ————————————————————————— 四、收割一单（原 engine.harvestOne 抽出） —————————————————————————

/** 收割尝试宿主（engine 每拍构造；全部闭包读/写，不持状态副本） */
export interface HarvestAttemptHost {
  readonly batches: HarvestBatchLedger
  /** 增量泵收时间片（config.harvestSliceMs——拍有界语义） */
  readonly sliceMs: number
  /** 引擎注入时钟（批次时点；泵收时间片仍用墙钟 Date.now——拆前语义不变） */
  readonly now: () => number
  resolveAdapter(executor: string): ExecutorAdapter
  /** 判定体（GATE_PASS/FAIL、迁移、预算、收账……全在调用方；本件只给四要件） */
  finalize(adapter: ExecutorAdapter, entry: Inflight): Promise<'completed' | 'failed'>
  /** 失败面（回滚首批位＋GATE_FAIL＋断路器——调用方既有链） */
  fault(entry: Inflight, detail: string, requirements: HarvestRequirements): Promise<'completed' | 'failed'>
}

/**
 * 收割一单（增量泵收版，DEV-9 P1 冻结修复，docs/17-§2 拍有界）：流未收尾先泵一个时间片
 * （host.sliceMs 墙钟）——事件就绪即折算、无事件即驻留返回 'streaming'（单据留在在途，
 * 下一拍续收）；流收尾拍走判定体（host.finalize）。判定序不变：流（要件 1/2）→ gateRunner
 * （要件 3/4）→ 收口；不齐＝host.fault 走既有失败链（不结算）。
 *
 * 批次簿衔接（本件新增面，零事件/零迁移）：标准收割（非合并跑位别）在首次进入时 begin
 * （区间 from＝引擎时钟），失败面 record（证据项＋gaps），收口后 seal（键定稿）；合并跑
 * 位别（entry.mergeRun）有自己的收口链，不登记收割批次（不虚构覆盖面）。
 */
export async function runHarvestAttempt(host: HarvestAttemptHost, entry: Inflight): Promise<'completed' | 'failed' | 'streaming'> {
  const segment: HarvestSegment = { ticket: entry.ticket, attempt: entry.attempt }
  const trackable = entry.mergeRun === undefined
  const batch = trackable ? host.batches.begin({ ...segment, deliverer: entry.personId, at: host.now() }) : undefined
  const seal = (outcome: 'completed' | 'failed'): void => {
    if (batch !== undefined) host.batches.seal(segment, outcome, host.now())
  }
  const fault = async (detail: string, requirements: HarvestRequirements): Promise<'completed' | 'failed'> => {
    if (batch !== undefined) host.batches.record({ ...segment, deliverer: entry.personId }, requirements)
    const outcome = await host.fault(entry, detail, requirements)
    seal(outcome)
    return outcome
  }
  let adapter: ExecutorAdapter
  try {
    adapter = host.resolveAdapter(entry.executor)
  } catch {
    return fault(
      'CONFIG_INVALID：executor 已不在注册表（收割不可继续）',
      harvestRequirementsOf({ completed: false, nonEmptyOutput: false, reportExists: false, exit0: false, terminalObserved: false, terminalError: undefined }),
    )
  }
  if (entry.streamDone !== true) {
    let pumped: 'parked' | 'done'
    try {
      pumped = await pumpHarvestStream(host.sliceMs, adapter, entry)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return fault(
        `WORKER_DEAD：流消费异常 ${msg}`,
        harvestRequirementsOf({
          completed: entry.foldCompleted ?? false,
          nonEmptyOutput: entry.foldNonEmpty ?? false,
          reportExists: false,
          exit0: false,
          terminalObserved: entry.foldCompleted !== undefined,
          terminalError: entry.foldTerminalError,
        }),
      )
    }
    if (pumped === 'parked') return 'streaming'
  }
  const outcome = await host.finalize(adapter, entry)
  seal(outcome)
  return outcome
}

/**
 * 增量泵流（DEV-9 修复核心）：本工位本拍至多 sliceMs——已就绪事件连续折算（microtask
 * 先于计时器：完成流/fake 流仍同拍收干，既有行为不变）；时间片尽或流暂无事件 → 驻留让出
 * 拍界（保留迭代器＋挂起 next() 跨拍续收；一流一收纪律不变）。挂起 next() 的拒绝被吞并
 * 记 streamError（防悬空 unhandled rejection）——下一拍泵首查即抛，与同步抛同走
 * WORKER_DEAD 面，不静默。
 */
async function pumpHarvestStream(sliceMs: number, adapter: ExecutorAdapter, entry: Inflight): Promise<'parked' | 'done'> {
  if (entry.streamError !== undefined) throw new Error(entry.streamError)
  if (entry.streamIter === undefined) {
    entry.streamIter = adapter.stream(entry.handle)[Symbol.asyncIterator]()
    entry.foldCompleted = false
    entry.foldNonEmpty = false
  }
  const deadline = Date.now() + sliceMs
  for (;;) {
    if (Date.now() >= deadline) return 'parked' // 时间片尽——拍有界硬保证（洪流面亦让出）
    if (entry.streamNext === undefined) {
      const next = entry.streamIter.next()
      // 驻留期拒绝兜底：吞并记档（防悬空拒绝）；活跃泵内的拒绝经 parkRace 原样传播
      next.catch((err) => {
        if (entry.streamError === undefined) {
          entry.streamError = err instanceof Error ? err.message : String(err)
        }
      })
      entry.streamNext = next
    }
    const winner = await parkRace(entry.streamNext, deadline - Date.now())
    if (winner === PARKED) return 'parked'
    entry.streamNext = undefined
    if (winner.done) {
      entry.streamDone = true
      return 'done'
    }
    foldHarvestEvent(entry, winner.value)
  }
}

/** 流事件 → 四要件输入折算（要件 1：turn_end.completed；要件 2：非空 log） */
function foldHarvestEvent(entry: Inflight, ev: StreamEvent): void {
  if (ev.type === 'log' && ev.text.trim() !== '') entry.foldNonEmpty = true
  if (ev.type === 'turn_end') {
    entry.foldCompleted = ev.completed
    if (ev.error !== undefined) entry.foldTerminalError = ev.error
  }
}
