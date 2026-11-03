/**
 * obs/write —— OBS 观察族**写面**：REC-OBS-02 监控故障 / REC-OBS-03 持续观察 / REC-OBS-04 观察结束
 * （PORT-OBS.reportFault 的数据面；与只读投影 obs.ts 同域异件——读面不因本件获得写槽）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：观察记录由相位 1 采集尾的观察面写入——相位内步骤，不增删相位）；
 *   - docs/17-§6（收割四要件：观测写入不参与收割判定；「接管≠收割」——写失败不吞、不冒认已写）；
 *   - docs/v2/11 §十二（REC-OBS-02/03/04 字段与不变量）、§〇（记录信封）、§0.4（幂等：同
 *     recordId/幂等键内容一致=返回既有，不一致=拒写）、§0.5（生效槽）、§0.7（证明边界）；
 *   - docs/v2/08 §4.4（监控故障是一等观察；受影响视图只可显示未知/受损，不得留空、显示为零、
 *     沿用最后健康快照）、§5.3（观察结束不是遗忘：有据结束＋残留风险＋再触发条件）；
 *   - docs/v2/14 §1.8（PORT-OBS 签名／reportFault 唯一写槽）、§1.6（PORT-HIST 唯一记录写口）；
 *   - docs/v2/09 ENU-59 故障类别（值集唯一主表；本件零重述——构造函数只收 contract 类型）。
 *   - plan/05 IMPL-04-08（obs.ts 只读投影）之后的写面腿；本单 studio-dev-539（差距项 #13）。
 *
 * 与 obs.ts 的分工（读面纪律不动）：
 *   - `obs.ts` 只读投影：只发 SELECT、深冻结、导出面恒只有 `projectObservationSnapshot`；
 *   - 本件唯一写口：三条 append + 读回（openWatches/readFaults）+ 投影转发（project）——
 *     写面失败一律 fail-closed（抛 `ObsWriteError`，**不返回半成品、不静默降级**）。
 *
 * 形状唯一源＝contract（§0.6 枚举/形状零重述）：信封与族 payload 一律经 `createHistFace(db).append`
 * 的 contract 闸判；本件只做**端口形状 → 记录 payload 的字段映射**与不变量前置判定
 * （`validateMonitoringFailure`/`validateContinuousObservation`/`validateObservationClosure`）。
 *
 * 登记缺口（如实登记，不臆造）：
 *   1. 端口 `ProjectionFault.displayEffect` 值集为 `unknown|impaired`，记录 payload 为
 *      `unknown|damaged`（v2/09 二元投影；contract obs.ts 头注「登记缺口 1」）。本件显式映射
 *      `impaired → damaged`，不扩集、不改契约面。
 *   2. 端口 `FaultActionRestriction.basisRef` 为不透明串，记录面要求 `RecordRef{refType,refId,
 *      refVersion}` 三元组——**不猜编码**：出现动作限制时必须显式给 `actionRestrictionBasis`，
 *      否则拒写（`store/obs:action-restriction-unmapped`）。
 *   3. `last_trusted.at`（最后可信点时刻）端口形状未承载——由调用方显式给 `lastTrustedAt`；
 *      缺省不取当前时刻冒充（时间轴不得靠猜）。
 *   4. 观察主体 `subject.ref.refVersion` 走 semver：视图类主体无登记版本主表，取记录类型初始版本
 *      `1.0.0`（contract `RECORD_TYPE_VERSION_INITIAL`，不另立第二套版本）。
 *   5. v14 records 列集无 `basis_refs` 列：依据引用一律留空并写入 `proofBoundary`（同 hist.ts 缺口）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不新增记录类/端口/枚举。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import type { ProjectionFault } from '@studio-next/contract'
import {
  RECORD_TYPE_VERSION_INITIAL,
  validateContinuousObservation,
  validateMonitoringFailure,
  validateObservationClosure,
  type RecordValidationOutcome,
} from '../../../contract/src/records/index.ts'
import { createHistFace, type HistFace, type HistRecord, type HistRecordRef } from '../hist.ts'
import { projectObservationSnapshot, type ObservationProjection } from '../obs.ts'

/** 观察族记录类型（v2/11 §一 74 类登记；OBS 四类） */
export const OBS_FAULT_RECORD_TYPE = 'REC-OBS-02' as const
export const OBS_WATCH_RECORD_TYPE = 'REC-OBS-03' as const
export const OBS_CLOSURE_RECORD_TYPE = 'REC-OBS-04' as const
/** OBS 观察族 AREA（v2/11 §0.9 十三 AREA 封闭登记） */
export const OBS_RECORD_AREA = 'OBS' as const
/** 冻结 schema 工件引用（v2/10 §4.1；与 assembly/ops 同口径） */
export const OBS_RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const
/** 依循的 V2 规范版本（与 contract artifacts SPEC_VERSION 同值） */
export const OBS_RECORD_SPEC_VERSION = '2.0.0' as const
/** 写入路径名（producer.writtenBy：写路径与具名决定者分开——v2/11 §0.2-1） */
export const OBS_WRITTEN_BY = 'daemon:engine/observe' as const

// —— 一、写面输入形状（端口形状之外的显式补充；缺项即拒，不猜） ——

/** 幂等键三元（信封幂等五元组的后三元；前二元由 recordType/companyRef 补——§0.4-5） */
export interface ObservationIdempotency {
  readonly subjectId: string
  /** token（小写 ASCII `[a-z][a-z0-9-]{0,63}`，v2/10 §1.1） */
  readonly operationClass: string
  readonly requesterSequence: string
}

/** REC-OBS-02 写入输入（端口 `ProjectionFault`＋记录面必需的两处显式补充） */
export interface ObservationFaultWriteInput {
  readonly fault: ProjectionFault
  /** 最后可信点时刻（§十二 `last_trusted.at`；端口形状未承载——显式给，不取当前时刻冒充） */
  readonly lastTrustedAt: string
  /** 动作限制授权依据的记录三元组（见头注缺口 2；无动作限制时忽略） */
  readonly actionRestrictionBasis?: { readonly refType: string; readonly refId: string; readonly refVersion: string }
  readonly idempotency: ObservationIdempotency
}

/** 观察主体（本节只收视图/执行体类主体的窄形；refVersion 缺省取记录初始版本） */
export interface ObservationSubjectInput {
  readonly kind: string
  readonly refId: string
  readonly refVersion?: string
}

/** REC-OBS-03 写入输入（字段名对齐 v2/11 §十二；形状由 contract 判） */
export interface ContinuousObservationWriteInput {
  readonly subject: ObservationSubjectInput
  readonly window: { readonly declaredFrom: string; readonly declaredTo: string; readonly lastTrustedAt: string }
  readonly sightings: {
    readonly activitySignals?: readonly {
      readonly signal: string
      readonly at: string
      readonly materialRef: { readonly refId: string; readonly refVersion: string }
    }[]
    readonly credentialStatusVsRvk?: readonly string[]
    readonly independentDiscoveryChannels: readonly {
      readonly channel: string
      readonly materialRef: { readonly refId: string; readonly refVersion: string }
    }[]
  }
  readonly uncertainty: { readonly reachable: boolean; readonly treatment: string }
  readonly escalationFlag: boolean
  readonly idempotency: ObservationIdempotency
}

/** REC-OBS-04 写入输入（观察结束不是遗忘——basis/residualRisk 为空即拒） */
export interface ObservationClosureWriteInput {
  /** 被结束的 REC-OBS-03 记录 id（版本链：closure.watch_ref.refId） */
  readonly watchRecordId: string
  readonly basis: readonly { readonly sighting: string; readonly terminalBasis: string }[]
  readonly residualRisk: readonly string[]
  readonly retriggerTerms: string
  readonly idempotency: ObservationIdempotency
}

/** 打开中的观察（REC-OBS-03 未被任何 REC-OBS-04 结束） */
export interface OpenObservationWatch {
  readonly recordId: string
  /** 观察主体 refId（视图类主体＝视图名） */
  readonly subjectRefId: string
  readonly subjectKind: string
  readonly declaredFrom: string
  readonly declaredTo: string
  readonly lastTrustedAt: string
}

/** 投影读回（生产消费 projectObservationSnapshot 的窄形；写面不据此伪造状态） */
export interface ObservationProjectionRead {
  readonly viewName: string
  readonly snapshotFound: boolean
  readonly states: readonly { readonly face: string; readonly state: string; readonly lastTrustedCursor: string | null }[]
  readonly fault: { readonly kind: string; readonly detail: string } | null
  readonly generatedAt: string | null
  readonly dataWindowTo: string | null
  readonly rosterIds: readonly string[]
}

/** 写面回执（version 恒 1——v14 版本链对 OBS 首版不做多版；修正走 REC-COR-01） */
export interface ObservationWriteReceipt {
  readonly recordId: string
  readonly recordType: string
  readonly appended: boolean
  readonly version: 1
}

/** 写面装配依赖（全注入；不读环境/墙钟） */
export interface ObservationWriteDeps {
  readonly db: DatabaseSync
  /** 公司维（SEC-WD-01；幂等键第①元） */
  readonly company: string
  /** 具名观察位置（producer.decidedBy；须具名——framework/daemon/monitoring 等会被 contract 拒） */
  readonly decidedBy: string
  /** 记录 id 铸造（生产＝ULID 注入；测试＝确定性序列） */
  readonly makeId: () => string
  /** producedAt/effectiveTime（ISO 带偏移，注入时钟） */
  readonly now: () => string
  /** HIST 面（缺省 createHistFace(db)；注入面供同事务/测试复用） */
  readonly hist?: HistFace
  /** 三不入·库闸（生产=runtime outbound.gate.guardStoreRecord；检出即拒写，fail-closed） */
  readonly guardRecord?: (record: unknown) => unknown
}

/** OBS 写面（唯一写口；读回面只读） */
export interface ObservationWriteFace {
  reportFault(input: ObservationFaultWriteInput): ObservationWriteReceipt
  recordContinuousObservation(input: ContinuousObservationWriteInput): ObservationWriteReceipt
  recordObservationClosure(input: ObservationClosureWriteInput): ObservationWriteReceipt
  /** 打开中的观察（重启重建面；坏行 fail-closed） */
  openWatches(): readonly OpenObservationWatch[]
  /** 近故障读回（告警/面板消费面；新→旧） */
  readFaults(options?: { readonly viewName?: string; readonly limit?: number }): readonly HistRecord[]
  /** 只读投影转发（生产消费；不写、不改历史） */
  project(view: { readonly viewName: string; readonly faces: readonly string[] }): ObservationProjectionRead
}

// —— 二、写面异常（fail-closed：写失败/形状不符一律显式抛错） ——

/** 写面错误分类（subcause 前缀对齐 store 既有体例：store/obs:*） */
export class ObsWriteError extends Error {
  /** 分类子因（`store/obs:shape-mismatch:<path>` / `store/obs:write-failed` / `store/obs:duplicate-conflict` / `store/obs:action-restriction-unmapped` / `store/obs:cross-company-fault`） */
  readonly subcause: string
  /** 外部副作用是否可能已发生（写口异常=true 须对账；形状拒收=false 确定未写） */
  readonly sideEffectPossible: boolean

  constructor(subcause: string, message: string, sideEffectPossible: boolean) {
    super(`${subcause}: ${message}`)
    this.name = 'ObsWriteError'
    this.subcause = subcause
    this.sideEffectPossible = sideEffectPossible
  }
}

// —— 三、装配 ——

export function createObservationWriteFace(deps: ObservationWriteDeps): ObservationWriteFace {
  const hist = deps.hist ?? createHistFace(deps.db)
  const company = requireText(deps.company, 'company')
  const decidedBy = requireText(deps.decidedBy, 'decidedBy')

  const envelopeOf = (
    recordType: string,
    payload: unknown,
    idempotency: ObservationIdempotency,
    proofBoundary: string,
  ): unknown => {
    const at = deps.now()
    return {
      recordId: deps.makeId(),
      recordType,
      schemaRef: OBS_RECORD_SCHEMA_REF,
      specVersion: OBS_RECORD_SPEC_VERSION,
      companyRef: company,
      producedAt: at,
      producer: { decidedBy, writtenBy: OBS_WRITTEN_BY },
      // v14 列集无 basis_refs 列：留空并登记在证明边界（不由本件静默丢弃）
      basisRefs: [],
      payload,
      effectiveState: 'effective',
      effectiveTime: { from: at },
      proofBoundary,
      idempotencyKey: {
        companyRef: company,
        recordType,
        subjectId: requireText(idempotency.subjectId, 'idempotency.subjectId'),
        operationClass: requireToken(idempotency.operationClass, 'idempotency.operationClass'),
        requesterSequence: requireText(idempotency.requesterSequence, 'idempotency.requesterSequence'),
      },
    }
  }

  const append = (rawRecord: unknown, shape: (value: unknown) => RecordValidationOutcome): ObservationWriteReceipt => {
    let record = rawRecord
    if (deps.guardRecord !== undefined) {
      try {
        record = deps.guardRecord(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ObsWriteError('store/obs:guard-rejected', `记录被出站/入库闸拒（未落库，fail-closed）：${message}`, false)
      }
    }
    const checked = shape(record)
    if (!checked.ok) {
      const first = checked.issues?.[0]
      throw new ObsWriteError(
        `store/obs:shape-mismatch:${first?.path ?? '(root)'}`,
        `OBS 记录形状/不变量不符契约，拒写（0 行落库——fail-closed）：${first?.message ?? '未知形状问题'}`,
        false,
      )
    }
    let ref: HistRecordRef
    try {
      ref = hist.append(record)
    } catch (error) {
      const classified = classifyHistError(error)
      throw classified
    }
    return { recordId: ref.recordId, recordType: ref.recordType, appended: ref.appended, version: 1 }
  }

  const reportFault = (input: ObservationFaultWriteInput): ObservationWriteReceipt => {
    const fault = input.fault
    // 多公司一条记录：受影响视图须同属本记录公司维（跨公司＝泄露，SEC-WD-01/§十二）
    for (const view of fault.affectedViews) {
      if (view.company.slug !== company || view.company.companyId !== company) {
        throw new ObsWriteError(
          'store/obs:cross-company-fault',
          `受影响视图 ${view.viewName} 属公司 ${view.company}，与记录公司维 ${company} 不一致（多公司隔离——不得跨公司落一条记录）`,
          false,
        )
      }
    }
    if (fault.actionRestriction !== undefined && input.actionRestrictionBasis === undefined) {
      throw new ObsWriteError(
        'store/obs:action-restriction-unmapped',
        '动作限制须给授权依据记录三元组（refType/refId/refVersion）——端口 basisRef 为不透明串，本件不猜编码',
        false,
      )
    }
    const payload: Record<string, unknown> = {
      failure_kind: fault.failureKind,
      occurred_at: fault.occurredAt,
      discovered_at: fault.discoveredAt,
      affected_views: fault.affectedViews.map((view) => view.viewName),
      last_trusted: { cursor: requireText(fault.lastTrustedCursor, 'fault.lastTrustedCursor'), at: requireText(input.lastTrustedAt, 'lastTrustedAt') },
      display_effect: fault.displayEffect === 'impaired' ? 'damaged' : 'unknown',
      recovery_at: fault.recoveryAt ?? null,
      root_cause_class: requireText(fault.rootCauseClass, 'fault.rootCauseClass'),
    }
    if (fault.actionRestriction !== undefined && input.actionRestrictionBasis !== undefined) {
      const restriction = fault.actionRestriction
      payload['action_restriction'] = {
        authorization_basis: {
          refType: requireText(input.actionRestrictionBasis.refType, 'actionRestrictionBasis.refType'),
          refId: requireText(input.actionRestrictionBasis.refId, 'actionRestrictionBasis.refId'),
          refVersion: requireText(input.actionRestrictionBasis.refVersion, 'actionRestrictionBasis.refVersion'),
        },
        decided_by: requireText(restriction.namedSubject.callerId, 'actionRestriction.namedSubject'),
        scope: requireText(restriction.scope.join(','), 'actionRestriction.scope'),
        term: requireText(restriction.expiry, 'actionRestriction.expiry'),
        review_point: requireText(restriction.reviewPoint, 'actionRestriction.reviewPoint'),
      }
    }
    const record = envelopeOf(
      OBS_FAULT_RECORD_TYPE,
      payload,
      input.idempotency,
      '本记录证明监控故障已作为一等观察登记（类别/发生与发现/受影响视图/最后可信点/显示效果）；' +
        '不证明故障已恢复或根因已定位；不证明受影响视图的显示面已正确降级（消费面自证）；' +
        '不证明授权链（动作限制的授权依据为引用，核验归 PORT-AUTH）',
    )
    return append(record, (value) => validateMonitoringFailure(value))
  }

  const recordContinuousObservation = (input: ContinuousObservationWriteInput): ObservationWriteReceipt => {
    const subject = input.subject
    const payload = {
      subject: {
        kind: requireText(subject.kind, 'subject.kind'),
        ref: {
          refId: requireText(subject.refId, 'subject.refId'),
          refVersion: subject.refVersion ?? RECORD_TYPE_VERSION_INITIAL,
        },
      },
      window: {
        declared_from: requireText(input.window.declaredFrom, 'window.declaredFrom'),
        declared_to: requireText(input.window.declaredTo, 'window.declaredTo'),
        last_trusted_observation_at: requireText(input.window.lastTrustedAt, 'window.lastTrustedAt'),
      },
      sightings: {
        activity_signals: (input.sightings.activitySignals ?? []).map((signal) => ({
          signal: requireText(signal.signal, 'sightings.activitySignals.signal'),
          at: requireText(signal.at, 'sightings.activitySignals.at'),
          material_ref: {
            refId: requireText(signal.materialRef.refId, 'sightings.activitySignals.materialRef.refId'),
            refVersion: requireText(signal.materialRef.refVersion, 'sightings.activitySignals.materialRef.refVersion'),
          },
        })),
        credential_status_vs_rvk: [...(input.sightings.credentialStatusVsRvk ?? [])],
        independent_discovery_channels: input.sightings.independentDiscoveryChannels.map((channel) => ({
          channel: requireText(channel.channel, 'sightings.independentDiscoveryChannels.channel'),
          material_ref: {
            refId: requireText(channel.materialRef.refId, 'sightings.independentDiscoveryChannels.materialRef.refId'),
            refVersion: requireText(channel.materialRef.refVersion, 'sightings.independentDiscoveryChannels.materialRef.refVersion'),
          },
        })),
      },
      uncertainty: {
        reachable: input.uncertainty.reachable,
        treatment: requireText(input.uncertainty.treatment, 'uncertainty.treatment'),
      },
      escalation_flag: input.escalationFlag,
    }
    const record = envelopeOf(
      OBS_WATCH_RECORD_TYPE,
      payload,
      input.idempotency,
      '本记录证明观察义务已事前声明（主体/窗口/所见/独立发现通道/不确定性处置）；' +
        '不证明观察对象已停止或已消失（不可达按未知——§十二）；不证明独立发现通道充分；不证明残留风险已清',
    )
    return append(record, (value) => validateContinuousObservation(value))
  }

  const recordObservationClosure = (input: ObservationClosureWriteInput): ObservationWriteReceipt => {
    const payload = {
      watch_ref: {
        refType: OBS_WATCH_RECORD_TYPE,
        refId: requireText(input.watchRecordId, 'watchRecordId'),
        refVersion: RECORD_TYPE_VERSION_INITIAL,
      },
      basis: input.basis.map((item) => ({
        sighting: requireText(item.sighting, 'basis.sighting'),
        terminal_basis: requireText(item.terminalBasis, 'basis.terminalBasis'),
      })),
      residual_risk: input.residualRisk.map((risk) => requireText(risk, 'residualRisk[]')),
      retrigger_terms: requireText(input.retriggerTerms, 'retriggerTerms'),
    }
    const record = envelopeOf(
      OBS_CLOSURE_RECORD_TYPE,
      payload,
      input.idempotency,
      '本记录证明观察以有据结束（窗口所见＋终局依据＋残留风险＋再触发条件），不是遗忘（§十二/§5.3）；' +
        '不证明残留风险已消除；不证明同型副作用不再发生（再触发按新事项受理并回查原观察记录）',
    )
    return append(record, (value) => validateObservationClosure(value))
  }

  const openWatches = (): readonly OpenObservationWatch[] => {
    const watches = hist.query({ company, type: OBS_WATCH_RECORD_TYPE })
    const closures = hist.query({ company, type: OBS_CLOSURE_RECORD_TYPE })
    const closed = new Set<string>()
    for (const closure of closures) {
      const watchRef = payloadOf(closure).watch_ref
      const refId = typeof watchRef === 'object' && watchRef !== null ? (watchRef as { refId?: unknown }).refId : undefined
      if (typeof refId === 'string') closed.add(refId)
    }
    const open: OpenObservationWatch[] = []
    for (const watch of watches) {
      if (closed.has(watch.recordId)) continue
      const payload = payloadOf(watch)
      const subject = payload.subject as { kind?: unknown; ref?: { refId?: unknown } } | undefined
      const window = payload.window as { declared_from?: unknown; declared_to?: unknown; last_trusted_observation_at?: unknown } | undefined
      if (subject?.ref?.refId === undefined || window?.declared_to === undefined) {
        configInvalid('store/obs:watch-shape', `REC-OBS-03 ${watch.recordId} 缺 subject.ref.refId 或 window（坏行不冒充打开中观察）`)
      }
      open.push({
        recordId: watch.recordId,
        subjectRefId: String(subject.ref.refId),
        subjectKind: String(subject.kind ?? ''),
        declaredFrom: String(window.declared_from ?? ''),
        declaredTo: String(window.declared_to),
        lastTrustedAt: String(window.last_trusted_observation_at ?? ''),
      })
    }
    return open
  }

  const readFaults = (options?: { readonly viewName?: string; readonly limit?: number }): readonly HistRecord[] => {
    const rows = hist.query({ company, type: OBS_FAULT_RECORD_TYPE })
    const filtered =
      options?.viewName === undefined
        ? rows
        : rows.filter((row) => {
            const affected = payloadOf(row).affected_views
            return Array.isArray(affected) && affected.includes(options.viewName)
          })
    const limit = options?.limit ?? filtered.length
    return [...filtered].reverse().slice(0, Math.max(0, limit))
  }

  const project = (view: { readonly viewName: string; readonly faces: readonly string[] }): ObservationProjectionRead => {
    const projection: ObservationProjection = projectObservationSnapshot(deps.db, {
      company,
      viewName: view.viewName,
      faces: view.faces,
    })
    return {
      viewName: view.viewName,
      snapshotFound: projection.snapshotFound,
      states: projection.stateAssignments.map((state) => ({
        face: state.face,
        state: state.state,
        lastTrustedCursor: state.lastTrustedCursor,
      })),
      fault: projection.fault === null ? null : { kind: projection.fault.kind, detail: projection.fault.detail },
      generatedAt: projection.generatedAt,
      dataWindowTo: projection.dataValidWindow?.to ?? null,
      rosterIds: projection.recordIds,
    }
  }

  return { reportFault, recordContinuousObservation, recordObservationClosure, openWatches, readFaults, project }
}

// —— 四、内部小件 ——

function payloadOf(record: HistRecord): Record<string, unknown> {
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) {
    configInvalid('store/obs:payload-shape', `记录 ${record.recordId} payload 非对象（坏行不冒充已观察）`)
  }
  return payload as Record<string, unknown>
}

/** store/hist 写口异常 → OBS 写面分类（不改写原结论；副作用可能性如实标注） */
function classifyHistError(error: unknown): ObsWriteError {
  const message = error instanceof Error ? error.message : String(error)
  const bag = typeof error === 'object' && error !== null ? (error as { subcause?: unknown }) : undefined
  const subcause = typeof bag?.subcause === 'string' ? bag.subcause : ''
  if (subcause.startsWith('store/hist:duplicate-id') || subcause.startsWith('store/hist:duplicate-idempotency-key')) {
    return new ObsWriteError('store/obs:duplicate-conflict', `同 recordId/幂等键异内容，拒写（不改写既有行——§0.4-1）：${message}`, false)
  }
  if (subcause.startsWith('store/record:invalid') || subcause.startsWith('store/hist:basis-refs') || subcause.startsWith('store/hist:until') || subcause.startsWith('store/hist:idempotency')) {
    return new ObsWriteError('store/obs:shape-mismatch', `记录形状被 contract/store 闸拒收（0 行落库）：${message}`, false)
  }
  return new ObsWriteError('store/obs:write-failed', `OBS 记录未落地（写口异常，须对账/重试）：${message}`, true)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ObsWriteError(`store/obs:shape-mismatch:${field}`, `${field} 须为非空串（fail-closed）`, false)
  }
  return value
}

function requireToken(value: unknown, field: string): string {
  const text = requireText(value, field)
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(text)) {
    throw new ObsWriteError(`store/obs:shape-mismatch:${field}`, `${field} 须为 token（v2/10 §1.1：小写 ASCII [a-z][a-z0-9-]{0,63}）`, false)
  }
  return text
}
