/**
 * engine/records/object-carriers —— 五对象记录载体（OBJ-01..05）生产写面的形状映射件
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/05 §三 DOM-03/DOM-05（记录投影不是第四事实源）、§四、§六 OBJ-01..05；
 *   - docs/v2/11 §七（REC-ACC-01/02）、§八（REC-CHG-01）、§十（REC-REV-01/REC-EVAL-01），
 *     §〇.2（具名决定者/写入路径分离）、§〇.4（身份/版本/幂等）、§〇.5（生效槽）、§〇.7（证明边界）；
 *   - docs/v2/08 §六（变更链段名与三门/迁移表）；docs/v2/15；docs/v2/17 §六.2、NEG-REC-06/07/09；
 *   - docs/17-§2（主循环七相位）、docs/17-§6（收割四要件）；本单 studio-dev-537。
 *
 * 职责边界：
 *   - **只做「事实/契约 payload → 记录信封草案」纯映射**；形状唯一源＝contract
 *     `ALL_RECORD_SCHEMAS`（本文件零字段表重述、零枚举复制——§0.6）；
 *   - 不落库、不读时钟、不造事实：时刻/决定者/引用全部由调用方（生产相位/位置）注入；
 *     缺具名决定者或缺证据引用 = 构造期抛错（fail-fast），写面再以 fail-closed 拒写；
 *   - `basisRefs` 恒 `[]`（v14 records 列集无 basis_refs 列——store/hist 头注缺口；
 *     依据引用按各族 payload 槽位承载，见 store/hist「basis-refs-unlanded」）。
 *
 * 相位×记录类型×写入者映射（生产接线唯一源；与 #527 记录族写面映射表同源）：
 *   | 相位/触发面 | 记录类型 | 触发条件 | 具名决定者（producer.decidedBy） |
 *   |---|---|---|---|
 *   | 相位 4 收割（GATE_FAIL） | REC-ACC-01 | 收割失败且独立裁判位置在场 | 独立裁判位置（配置注入） |
 *   | 问责救济决定（显式面） | REC-ACC-02 | 救济决定作出 | 独立作出者（配置注入） |
 *   | 相位 5 合并/进化链段（显式面） | REC-CHG-01 | 变更链逐段推进 | 各段具名作出者 |
 *   | 复盘单归档（postmortem 链） | REC-REV-01 | 复盘位置提交复盘单 | 复盘位置（actor 注入） |
 *   | 结构评价（显式面） | REC-EVAL-01 | 评价位置作出结论 | 评价位置（配置注入） |
 *   显式面 = `createObjectRecordWire` 暴露给装配面的写口（无生产决策源时不自动触发——
 *   不伪造决定者/结论；缺事实即拒写并留痕）。
 */
import type {
  AccountabilityCasePayload,
  ChangeSegmentPayload,
  RecordRef,
  RemedyDecisionPayload,
  ReviewPayload,
  StructuralEvaluationPayload,
} from '@studio-next/contract/records'

/** 五对象载体（OBJ-01/02→ACC、OBJ-03→CHG、OBJ-04→REV、OBJ-05→EVAL） */
export const OBJECT_CARRIER_TYPES = ['REC-ACC-01', 'REC-ACC-02', 'REC-CHG-01', 'REC-REV-01', 'REC-EVAL-01'] as const

export type ObjectCarrierType = (typeof OBJECT_CARRIER_TYPES)[number]

/** 载体信封元（信封非 payload 面；时刻/决定者/写者全注入） */
export interface ObjectCarrierMeta {
  /** 公司标识（幂等键第①元，§0.4-5） */
  readonly company: string
  /** 载体对象标识（幂等键第③元；如单号/候选 id/复盘单号） */
  readonly subjectId: string
  /** 操作类别（幂等键第④元，token 形：小写 ASCII） */
  readonly operationClass: string
  /** 请求方序列（幂等键第⑤元；同语义事件重复提交须同值） */
  readonly requesterSequence: string
  /** 系统获知时刻（ISO；注入时钟，不读墙钟） */
  readonly producedAt: string
  /** 具名决定者（§0.2-1：不得 daemon/框架/系统/平台/流程/监控/自动策略） */
  readonly decidedBy: string
  /** 写入路径（与决定者分离——§0.2-2） */
  readonly writtenBy: string
  /** 生效状态（决定类记录缺省 effective） */
  readonly effectiveState?: 'pending' | 'effective'
  /** 生效起点（缺省=producedAt；不得早于生产链实际生效时刻） */
  readonly effectiveFrom?: string
  /** 记录身份（缺省=确定性派生：同语义事件同 id，§0.4-1） */
  readonly recordId?: string
  /** 证明边界（ACC/REV/EVAL 必填——§0.7；缺省按族口径补） */
  readonly proofBoundary?: string
}

/** 信封草案（写面唯一输入） */
export interface ObjectCarrierDraft {
  readonly recordType: ObjectCarrierType
  /** 未判形状的信封（contract 闸在写面——fail-closed 不在此处静默） */
  readonly envelope: Record<string, unknown>
}

const SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const
const SPEC_VERSION = '2.0.0'

/** 记录身份派生（确定性；同公司/类型/对象/操作/序列=同 id——幂等重放靠它） */
export function carrierRecordId(recordType: ObjectCarrierType, meta: ObjectCarrierMeta): string {
  return `rec-${recordType.slice(4).toLowerCase()}:${meta.company}:${meta.subjectId}:${meta.operationClass}:${meta.requesterSequence}`
}

/**
 * 记录信封（§〇 通用契约；生效槽按元注入）。
 * 构造期 fail-fast：元字段缺失/空白即抛错（调用方 bug 不得落成半条记录）。
 */
export function carrierEnvelope(
  recordType: ObjectCarrierType,
  meta: ObjectCarrierMeta,
  payload: unknown,
): ObjectCarrierDraft {
  for (const [field, value] of [
    ['company', meta.company],
    ['subjectId', meta.subjectId],
    ['operationClass', meta.operationClass],
    ['requesterSequence', meta.requesterSequence],
    ['producedAt', meta.producedAt],
    ['decidedBy', meta.decidedBy],
    ['writtenBy', meta.writtenBy],
  ] as const) {
    if (value.trim() === '') throw new Error(`object-carriers: 元字段 ${field} 不得为空（记录身份/责任主体不可缺）`)
  }
  const effectiveState = meta.effectiveState ?? 'effective'
  const effectiveFrom = meta.effectiveFrom ?? meta.producedAt
  return {
    recordType,
    envelope: {
      recordId: meta.recordId ?? carrierRecordId(recordType, meta),
      recordType,
      schemaRef: SCHEMA_REF,
      specVersion: SPEC_VERSION,
      companyRef: meta.company,
      producedAt: meta.producedAt,
      producer: { decidedBy: meta.decidedBy, writtenBy: meta.writtenBy },
      basisRefs: [],
      payload,
      effectiveState,
      effectiveTime: { from: effectiveFrom },
      ...(meta.proofBoundary !== undefined ? { proofBoundary: meta.proofBoundary } : {}),
      idempotencyKey: {
        companyRef: meta.company,
        recordType,
        subjectId: meta.subjectId,
        operationClass: meta.operationClass,
        requesterSequence: meta.requesterSequence,
      },
    },
  }
}

/** REC-ACC-01 问责案例载体（OBJ-01） */
export function accountabilityCase(meta: ObjectCarrierMeta, payload: AccountabilityCasePayload): ObjectCarrierDraft {
  return carrierEnvelope('REC-ACC-01', meta, payload)
}

/** REC-ACC-02 救济决定载体（OBJ-02） */
export function remedyDecision(meta: ObjectCarrierMeta, payload: RemedyDecisionPayload): ObjectCarrierDraft {
  return carrierEnvelope('REC-ACC-02', meta, payload)
}

/** REC-CHG-01 变更链段载体（OBJ-03） */
export function changeSegment(meta: ObjectCarrierMeta, payload: ChangeSegmentPayload): ObjectCarrierDraft {
  return carrierEnvelope('REC-CHG-01', meta, payload)
}

/** REC-REV-01 复盘载体（OBJ-04） */
export function reviewRecord(meta: ObjectCarrierMeta, payload: ReviewPayload): ObjectCarrierDraft {
  return carrierEnvelope('REC-REV-01', meta, payload)
}

/** REC-EVAL-01 结构评价载体（OBJ-05） */
export function structuralEvaluation(meta: ObjectCarrierMeta, payload: StructuralEvaluationPayload): ObjectCarrierDraft {
  return carrierEnvelope('REC-EVAL-01', meta, payload)
}

/**
 * payload 内记录引用闭包（递归收集 `{refType, refId, refVersion}` 三元形）。
 * 写面以 `HistFace.get(refId)` 逐条核验存在与类型——悬空引用即拒写（§0.4-2/§十五-2）。
 */
export function collectRecordRefs(value: unknown, out: RecordRef[] = []): RecordRef[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordRefs(item, out)
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  const bag = value as Record<string, unknown>
  if (typeof bag['refType'] === 'string' && typeof bag['refId'] === 'string' && typeof bag['refVersion'] === 'string') {
    out.push({ refType: bag['refType'] as RecordRef['refType'], refId: bag['refId'], refVersion: bag['refVersion'] })
    return out
  }
  for (const item of Object.values(bag)) collectRecordRefs(item, out)
  return out
}
