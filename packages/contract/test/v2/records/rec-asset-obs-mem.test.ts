/**
 * rec-asset-obs-mem.test.ts —— ASSET 资产＋OBS 观察＋MEM 记忆「一族一正一负」
 * （MIG-03 / IMPL-03-02；NEG-REC-11／NEG-REC-12／NEG-REC-13 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-11（专属标记丢失/传播损失未声明/秘密入包）＋NEG-REC-12（观察悬空/未知显示为零/
 *   面板全绿/监控改事实）＋NEG-REC-13（清除消灭历史/记忆当证据/污染传播 R-33），V1＋V3——本文件落
 *   V1 形状腿）｜v2/11 §十一/§十二/§十三（三族字段与不变量）｜v2/09 ENU-52/59/63/64/65/66/67/82/83/88。
 */
import { describe, expect, it } from 'vitest'
import { validateAssetRegistration, validateBindingLoss } from '../../../src/records/asset.ts'
import {
  validateContinuousObservation,
  validateMonitoringFailure,
  validateObservationClosure,
  validateProjectionSnapshot,
} from '../../../src/records/obs.ts'
import {
  validateMemoryAccessAudit,
  validateMemoryContamination,
  validateMemoryDisposal,
  validateMemoryEntry,
} from '../../../src/records/mem.ts'
import { AT, TERM, envelope, issuePaths, oref, ref } from './fixtures.ts'

// —— ASSET ——

function assetPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asset_kind: 'skill',
    exclusivity: { marker: 'exclusive', target_executor: 'dsh', unexpressed_items: ['未表达：Windows 支持'] },
    provenance: { publisher: 'studio-next', version: '1.0.0', digest: 'sha256:asset-1', license: 'MIT' },
    compatibility: ['dsh >= 1.0.0'],
    propagation: { semantics: '定义只读传播；执行位不随包', notes: [] },
    index_ref: oref('ASSET-01'),
    ...overrides,
  }
}

function bindingLossPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bound_host: { executor: 'claude', binding_ref: oref('BIND-CLI-CLAUDE-01') },
    lost_capabilities: [{ capability: 'dsh 专属 hook', loss_face: 'provider-extension', unavailable_statement: '明示不可用' }],
    compensations: [{ capability: 'dsh 专属 hook', alternative: '不能' }],
    evidence_gaps: ['外部后端保留自身权限系统，无法导出权限证据'],
    ...overrides,
  }
}

// —— OBS ——

function observationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    view_identity: { view_id: 'mon-01', projection_rule_version: '1.0.0' },
    authoritative_source: { endpoint: oref('endpoint-1'), generation: 2, activation_ref: ref('REC-AUTH-07') },
    source_cursor: 'cursor-9',
    generated_at: AT,
    data_valid_window: { from: TERM.from, to: TERM.to },
    knowledge_scope: ['company-a'],
    view_completeness: 'complete',
    state_assignments: {
      'MON-01': { state: 'observed', basis: '游标与事件表核对一致', last_trusted_cursor: 'cursor-9' },
    },
    ...overrides,
  }
}

function failurePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    failure_kind: 'cursor_broken',
    occurred_at: AT,
    discovered_at: AT,
    affected_views: ['MON-01'],
    last_trusted: { cursor: 'cursor-8', at: AT },
    display_effect: 'damaged',
    recovery_at: null,
    root_cause_class: '来源游标截断',
    ...overrides,
  }
}

function watchPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: { kind: '孤儿执行体', ref: oref('desc-1') },
    window: { declared_from: TERM.from, declared_to: TERM.to, last_trusted_observation_at: AT },
    sightings: {
      activity_signals: [{ signal: '最后进展时点', at: AT, material_ref: oref('signal-1') }],
      credential_status_vs_rvk: ['在 REC-EVD-RVK 后代清单内，凭据已停用'],
      independent_discovery_channels: [{ channel: '围栏拒绝记录', material_ref: oref('fence-record-1') }],
    },
    uncertainty: { reachable: false, treatment: '按未知处理，不记为已停止' },
    escalation_flag: true,
    ...overrides,
  }
}

function closurePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    watch_ref: ref('REC-OBS-03'),
    basis: [{ sighting: '窗口内连续无新副作用', terminal_basis: '独立通道交叉核对一致' }],
    residual_risk: ['无法排除外部副本'],
    retrigger_terms: '同类副作用再现时按新事项受理并回查原观察记录',
    ...overrides,
  }
}

// —— MEM ——

function memoryEntryPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: 'personal',
    personal_subtype: 'experience',
    owner_scope: 'holder-h1',
    source_refs: [ref('REC-WORK-09')],
    observation_vs_interpretation: { observation: '验收被拒一次', interpretation: '口径理解有偏差' },
    formed_at: AT,
    valid_at: AT,
    review_at: AT,
    confidence: 'medium',
    knowledge_scope: '仅本人与 +2 可读',
    correction_lineage: [],
    disputed: false,
    ...overrides,
  }
}

function accessPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    who: { holder_ref: oref('holder-h1'), position_ref: null, procedure_ref: null },
    when: AT,
    purpose: { why: '交接检索', for_work_or_decision_ref: ref('REC-WORK-HANDOVER') },
    layer_and_entries: { domain: 'personal', entry_refs: [ref('REC-MEM-01')] },
    authority_ref: { basis_ref: ref('REC-AUTH-02'), expires_at: AT },
    result: 'provided',
    ...overrides,
  }
}

function disposalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'archive',
    target_entries: [ref('REC-MEM-01')],
    authorizations: [{ layer: '个人记忆', authorized_by: 'g9.internal-boss' }],
    reason_and_impact: {
      reason: '工作终止三路分流',
      impact_scope: '仅该工作出工记忆',
      irrecoverable_notice: '归档后仍受知悉范围限制',
    },
    retained_obligations: [],
    disposal_evidence: {
      route: 'archive',
      archive_location: 'memory-archive:2026-q4',
      acceptance_ref: ref('REC-MEM-02'),
    },
    notice: { notified: [oref('holder-h1')], residue_statement: '原始来源与外部副本可能仍存在' },
    ...overrides,
  }
}

function contaminationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contaminated_entries: [ref('REC-MEM-01')],
    isolation: { source: '错误经验条目', method: '先隔离不再检索，后处置' },
    propagation_radius: {
      affected_decisions: [ref('REC-WORK-11')],
      affected_works: [ref('REC-WORK-03')],
      downstream_memories: [],
    },
    affected_decisions: { batch_marked: true, reopen_scope_ref: ref('REC-WORK-11') },
    recovery_criteria: {
      withdrawal_rate: '撤回率降至事前阈值以下',
      multi_round_posterior: ['多轮后验 3 轮'],
      degradation_comparison: '与任务结构变化对照，不据指标提升宣布痊愈',
    },
    ...overrides,
  }
}

describe('ASSET 两类正例（§十一）', () => {
  it('01 资产登记：专属标记带 targetExecutor＋未表达项保留＋来源摘要 → 放行', () => {
    expect(validateAssetRegistration(envelope('REC-ASSET-01', assetPayload()))).toEqual({ ok: true })
  })

  it('02 绑定损失：逐项「明示不可用」＋替代或「不能」＋证据缺口 → 放行', () => {
    expect(validateBindingLoss(envelope('REC-ASSET-02', bindingLossPayload()))).toEqual({ ok: true })
  })
})

describe('NEG-REC-11 资产拒绝条件（专属标记丢失/等价承载/秘密入包）', () => {
  it('exclusive 缺 targetExecutor → 拒（ENU-83）', () => {
    const outcome = validateAssetRegistration(
      envelope('REC-ASSET-01', assetPayload({ exclusivity: { marker: 'exclusive', unexpressed_items: [] } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.exclusivity.target_executor')
  })

  it('专属标记被丢弃 → 拒（v2/07 §2.3）', () => {
    const outcome = validateAssetRegistration(envelope('REC-ASSET-01', assetPayload()), { markerDropped: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.exclusivity')
  })

  it('宣称等价承载 → 拒', () => {
    const outcome = validateAssetRegistration(envelope('REC-ASSET-01', assetPayload()), { claimsEquivalentHosting: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.compatibility')
  })

  it('秘密值入资产 → 拒（v2/15 §四）', () => {
    const outcome = validateAssetRegistration(envelope('REC-ASSET-01', assetPayload()), { containsSecretValue: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.provenance')
  })

  it('强策略岗位派给策略面不可用宿主 → 拒（fail-closed）', () => {
    const outcome = validateBindingLoss(envelope('REC-ASSET-02', bindingLossPayload()), {
      strongPolicyPosition: true,
      strategySurfaceAvailable: false,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.bound_host')
  })

  it('静默回落默认家 → 拒', () => {
    const outcome = validateBindingLoss(envelope('REC-ASSET-02', bindingLossPayload()), { silentFallbackToDefaultHost: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.bound_host')
  })
})

describe('OBS 四类正例（§十二）', () => {
  it('01 投影快照：业务时间窗＋知识范围＋逐面六态 → 放行', () => {
    expect(validateProjectionSnapshot(envelope('REC-OBS-01', observationPayload()))).toEqual({ ok: true })
  })

  it('02 监控故障：受影响视图显示受损＋最后可信游标 → 放行', () => {
    expect(validateMonitoringFailure(envelope('REC-OBS-02', failurePayload()))).toEqual({ ok: true })
  })

  it('03 持续观察：窗口事前声明＋独立发现通道＋不可达按未知 → 放行', () => {
    expect(validateContinuousObservation(envelope('REC-OBS-03', watchPayload()))).toEqual({ ok: true })
  })

  it('04 观察结束：有据＋残留风险＋再触发条件 → 放行', () => {
    expect(validateObservationClosure(envelope('REC-OBS-04', closurePayload()))).toEqual({ ok: true })
  })
})

describe('NEG-REC-12 观察拒绝条件（观察悬空/未知显示为零/面板全绿/监控改事实）', () => {
  it('完整性不完整却把逐面状态全标 observed（面板全绿冒充健康）→ 拒', () => {
    const outcome = validateProjectionSnapshot(envelope('REC-OBS-01', observationPayload({ view_completeness: 'incomplete' })), {
      claimsAllHealthy: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.view_completeness')
  })

  it('投影被用作写路径/反向改写历史 → 拒（不得成为第二事实源）', () => {
    const outcome = validateProjectionSnapshot(envelope('REC-OBS-01', observationPayload()), { writesHistory: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('受影响视图显示为零/健康 → 拒', () => {
    const outcome = validateMonitoringFailure(envelope('REC-OBS-02', failurePayload()), { displaysZeroOrHealthy: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.display_effect')
  })

  it('不可达执行体被记为「已停止」→ 拒（按未知处理）', () => {
    const outcome = validateContinuousObservation(envelope('REC-OBS-03', watchPayload()), {
      treatedAsStoppedWhileUnreachable: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.uncertainty')
  })

  it('观察结束无依据（观察悬空）→ 拒', () => {
    const outcome = validateObservationClosure(envelope('REC-OBS-04', closurePayload()), { endedWithoutBasis: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.basis')
  })

  it('监控故障无受影响视图（沉默）→ 拒', () => {
    const outcome = validateMonitoringFailure(envelope('REC-OBS-02', failurePayload({ affected_views: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('affected_views'))).toBe(true)
  })

  it('投影状态槽为空（缺项留白）→ 拒', () => {
    const outcome = validateProjectionSnapshot(envelope('REC-OBS-01', observationPayload({ state_assignments: {} })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.state_assignments')
  })
})

describe('MEM 四类正例（§十三）', () => {
  it('01 记忆条目：个人子类＋来源＋置信＋观察与解释分列 → 放行', () => {
    expect(validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()))).toEqual({ ok: true })
  })

  it('02 访问审计：任职/位置/程序分列＋用途＋授权到期 → 放行', () => {
    expect(validateMemoryAccessAudit(envelope('REC-MEM-02', accessPayload()))).toEqual({ ok: true })
  })

  it('02 访问被拒也是审计事件（result=denied）→ 放行', () => {
    expect(validateMemoryAccessAudit(envelope('REC-MEM-02', accessPayload({ result: 'denied' })))).toEqual({ ok: true })
  })

  it('03 处置决定：归档凭证（位置＋接收确认）＋通知与残余声明 → 放行', () => {
    expect(validateMemoryDisposal(envelope('REC-MEM-03', disposalPayload()))).toEqual({ ok: true })
  })

  it('04 污染处置：隔离来源＋传播半径＋批量标记＋痊愈判据三槽 → 放行', () => {
    expect(validateMemoryContamination(envelope('REC-MEM-04', contaminationPayload()))).toEqual({ ok: true })
  })
})

describe('NEG-REC-13 记忆拒绝条件（清除消灭历史/记忆当证据/污染传播）', () => {
  it('个人域缺个人记忆子类 → 拒（V4-P1-1）', () => {
    const payload = memoryEntryPayload()
    delete payload['personal_subtype']
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome).some((path) => path.includes('personal_subtype'))).toBe(true)
  })

  it('传闻/未验证推断写入记忆 → 拒', () => {
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()), { rumorSource: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.source_refs')
  })

  it('以记忆替代证据（E-12）→ 拒', () => {
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()), { usedAsEvidenceStandalone: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('与可核验记录冲突却未标不确定 → 拒', () => {
    const outcome = validateMemoryEntry(envelope('REC-MEM-01', memoryEntryPayload()), { conflictsWithRecordUnmarked: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.disputed')
  })

  it('只统计次数不算访问记录 → 拒', () => {
    const outcome = validateMemoryAccessAudit(envelope('REC-MEM-02', accessPayload()), { countsOnly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.layer_and_entries')
  })

  it('知悉范围变化未重新审批 → 拒', () => {
    const outcome = validateMemoryAccessAudit(envelope('REC-MEM-02', accessPayload()), { scopeChangedWithoutReapproval: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.scope_change')
  })

  it('转层只给单层授权 → 拒（L3E-10 双授权）', () => {
    const payload = disposalPayload({
      operation: 'transfer_layer',
      disposal_evidence: { route: 'transfer_out', layer_fields: ['target_layer=公司知识'], acceptance_ref: ref('REC-MEM-02') },
    })
    const outcome = validateMemoryDisposal(envelope('REC-MEM-03', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.authorizations')
  })

  it('转层源层与目标层双授权齐备 → 放行', () => {
    const payload = disposalPayload({
      operation: 'transfer_layer',
      authorizations: [
        { layer: '个人记忆', authorized_by: 'g9.internal-boss' },
        { layer: '公司知识', authorized_by: 'g9.internal-boss' },
      ],
      disposal_evidence: { route: 'transfer_out', layer_fields: ['target_layer=公司知识'], acceptance_ref: ref('REC-MEM-02') },
    })
    expect(validateMemoryDisposal(envelope('REC-MEM-03', payload))).toEqual({ ok: true })
  })

  it('借记忆清除消灭责任记录 → 拒', () => {
    const payload = disposalPayload({
      operation: 'erase',
      disposal_evidence: { route: 'erase', retention_check: '保留义务核对：责任记录保留', trail_ref: ref('REC-MEM-02') },
    })
    const outcome = validateMemoryDisposal(envelope('REC-MEM-03', payload), { clearsProtectedRecords: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.operation')
  })

  it('恢复出厂式删除当作合法结清 → 拒', () => {
    const outcome = validateMemoryDisposal(envelope('REC-MEM-03', disposalPayload()), { factoryReset: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.disposal_evidence')
  })

  it('污染先删后查 → 拒（R-33）', () => {
    const outcome = validateMemoryContamination(envelope('REC-MEM-04', contaminationPayload()), {
      deletedBeforeInvestigation: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.isolation')
  })

  it('仅删除最近一条错误经验即宣布痊愈 → 拒（R-33）', () => {
    const outcome = validateMemoryContamination(envelope('REC-MEM-04', contaminationPayload()), {
      recoveryBySingleDeletion: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.recovery_criteria')
  })

  it('受影响决定未批量标记 → 拒', () => {
    const outcome = validateMemoryContamination(
      envelope('REC-MEM-04', contaminationPayload({ affected_decisions: { batch_marked: false } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.affected_decisions.batch_marked')
  })
})
