/**
 * rec-common.test.ts —— §2.1 通用骨架八条（CMD/DEC/RCP/COR/EVT）的「正＋负」（MIG-03 / IMPL-03-01 补件）
 *
 * 依据：v2/11 §2.1（七类压缩规格：字段/不变量/失败出口）＋§1.1（AUTH 权责族 16 类＝授权链 8＋骨架 8）｜
 *   v2/09 ENU-31/60/68/69/70/71/128｜v2/17 §3.4（AUTH 权责 16 行、NEG-REC-01）。宰相 2026-10-28 补件令：
 *   AUTH 族 16 类须形状齐——本文件为骨架 8 类的 V1 形状腿（不新增记录类，仍 74）。
 */
import { describe, expect, it } from 'vitest'
import {
  COMMON_RECORD_SCHEMAS,
  COMMON_RECORD_TYPES,
  validateAuthorityCheck,
  validateCommandRequest,
  validateCorrection,
  validateEvent,
  validateGenericDecision,
  validateReceipt,
  validateReconciliation,
  validateUnknownRegistry,
} from '../../../src/records/common.ts'
import { AUTH_RECORD_TYPES } from '../../../src/records/auth.ts'
import { LIFE_RECORD_TYPES } from '../../../src/records/life.ts'
import { PERF_RECORD_TYPES } from '../../../src/records/perf.ts'
import {
  authorityCheckPayload,
  commandRequestPayload,
  correctionPayload,
  envelope,
  eventPayload,
  genericDecisionPayload,
  issuePaths,
  receiptPayload,
  reconciliationPayload,
  unknownRegistryPayload,
} from './fixtures.ts'

describe('登记面：74 类计数与 28 类族覆盖（本单登记集）', () => {
  it('AUTH 16（授权链 8＋骨架 8）＋LIFE 11＋PERF 1＝28，余 46 类归 IMPL-03-02', () => {
    expect(COMMON_RECORD_TYPES).toHaveLength(8)
    expect(AUTH_RECORD_TYPES).toHaveLength(16)
    expect(LIFE_RECORD_TYPES).toHaveLength(11)
    expect(PERF_RECORD_TYPES).toHaveLength(1)
    expect(AUTH_RECORD_TYPES.length + LIFE_RECORD_TYPES.length + PERF_RECORD_TYPES.length).toBe(28)
    expect(28 + 46).toBe(74)
  })

  it('骨架 8 类形状闸齐（COMMON_RECORD_SCHEMAS 无缺件）', () => {
    expect(Object.keys(COMMON_RECORD_SCHEMAS).sort()).toEqual([...COMMON_RECORD_TYPES].sort())
  })
})

describe('REC-CMD-01 命令请求（正例＋拒绝条件）', () => {
  it('对照面：外部入口命令、来源已核验、效果可判定、带幂等键与预期版本 → 放行', () => {
    expect(validateCommandRequest(envelope('REC-CMD-01', commandRequestPayload()))).toEqual({ ok: true })
  })

  it('期望效果写空话「处理好」→ 拒（可判定性闸）', () => {
    const outcome = validateCommandRequest(envelope('REC-CMD-01', commandRequestPayload({ requested_effect: '处理好' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.requested_effect')
  })

  it('来源未核验却已进入执行步 → 拒（未核验只能暂缓或拒绝）', () => {
    const outcome = validateCommandRequest(envelope('REC-CMD-01', commandRequestPayload({ source_verification: 'unverified' })), {
      admittedToExecution: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.source_verification')
  })
})

describe('REC-CMD-02 权源检查（禁止优先/未覆盖不自动允许）', () => {
  it('对照面：permitted 且授予可解析、子授权链成立 → 放行', () => {
    expect(validateAuthorityCheck(envelope('REC-CMD-02', authorityCheckPayload()))).toEqual({ ok: true })
  })

  it('无可用授予却判 permitted → 拒（未覆盖不自动允许）', () => {
    const outcome = validateAuthorityCheck(envelope('REC-CMD-02', authorityCheckPayload({ resolved_grants: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.resolved_grants')
  })

  it('非 permitted 结论缺 fail_reason → 拒（禁止→停止；保留→转呈；未覆盖→请求决定）', () => {
    const outcome = validateAuthorityCheck(envelope('REC-CMD-02', authorityCheckPayload({ policy_verdict: 'uncovered' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.fail_reason')
  })

  it('checked_command 指向非 REC-CMD-01 → 拒（权源检查须针对命令请求）', () => {
    const outcome = validateAuthorityCheck(
      envelope('REC-CMD-02', authorityCheckPayload({ checked_command: { refType: 'REC-EVT-01', refId: 'evt-1', refVersion: '1.0.0' } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.checked_command.refType')
  })
})

describe('REC-DEC-01 泛型决定（一事件一身份；理由/范围/异议齐）', () => {
  it('对照面：无专用类型的分类结论，理由非空、范围与异议位置齐 → 放行', () => {
    expect(validateGenericDecision(envelope('REC-DEC-01', genericDecisionPayload()))).toEqual({ ok: true })
  })

  it('该语义事件已有专用记录类型 → 拒（再写 DEC-01＝双身份，§0.3-3）', () => {
    const outcome = validateGenericDecision(envelope('REC-DEC-01', genericDecisionPayload()), { hasDedicatedType: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('理由为空 → 拒（决定理由不得为空）', () => {
    const outcome = validateGenericDecision(envelope('REC-DEC-01', genericDecisionPayload({ rationale: '' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.rationale')
  })
})

describe('REC-RCP-01 回执（部分执行逐项必填；结果不明先对账）', () => {
  it('对照面：executed 带 resulting_version → 放行', () => {
    expect(validateReceipt(envelope('REC-RCP-01', receiptPayload()))).toEqual({ ok: true })
  })

  it('ack_kind=partially_executed 但 partial_items 空 → 拒（L3D-13）', () => {
    const outcome = validateReceipt(envelope('REC-RCP-01', receiptPayload({ ack_kind: 'partially_executed', partial_items: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.partial_items')
  })

  it('executed 缺 resulting_version → 拒', () => {
    const payload = receiptPayload()
    delete payload['resulting_version']
    const outcome = validateReceipt(envelope('REC-RCP-01', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.resulting_version')
  })

  it('结果不明却已盲目重试 → 拒（须先对账 REC-EVT-02）', () => {
    const outcome = validateReceipt(envelope('REC-RCP-01', receiptPayload({ ack_kind: 'unknown' })), { retriedWithoutReconcile: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.ack_kind')
  })
})

describe('REC-COR-01 修正（追加不覆盖；不得追溯授权越权）', () => {
  it('对照面：supersede 逐字段新旧值、原文保留恒真 → 放行', () => {
    expect(validateCorrection(envelope('REC-COR-01', correctionPayload()))).toEqual({ ok: true })
  })

  it('corrected_fields 为空 → 拒（修正须逐字段写新旧值）', () => {
    const outcome = validateCorrection(envelope('REC-COR-01', correctionPayload({ corrected_fields: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.corrected_fields')
  })

  it('original_preserved=false → 拒（追加不覆盖、旧版本保留）', () => {
    const outcome = validateCorrection(envelope('REC-COR-01', correctionPayload({ original_preserved: false })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.original_preserved')
  })

  it('被用来追溯授权过去的越权 → 拒（不得把补证伪装成当时证据）', () => {
    const outcome = validateCorrection(envelope('REC-COR-01', correctionPayload()), { retroactivelyAuthorizes: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.effective_from')
  })
})

describe('REC-EVT-01/02/03 事件与未知（事件不驱动迁移；未知不折零）', () => {
  it('对照面：事件带具名 actor、双时点、完整性三值 → 放行', () => {
    expect(validateEvent(envelope('REC-EVT-01', eventPayload()))).toEqual({ ok: true })
  })

  it('事件被当作迁移驱动源 → 拒（迁移只能由 REC-WORK-06/REC-LIFE-02 依决定作出）', () => {
    const outcome = validateEvent(envelope('REC-EVT-01', eventPayload()), { drivesTransition: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('actor_ref 只写工具名 → 拒（须可追到具名主体）', () => {
    const outcome = validateEvent(envelope('REC-EVT-01', eventPayload()), { actorIsToolOnly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.actor_ref')
  })

  it('对账无差异 → 放行（对照面）', () => {
    expect(validateReconciliation(envelope('REC-EVT-02', reconciliationPayload()))).toEqual({ ok: true })
  })

  it('有差异类别却无逐项责任位置/处置/期限 → 拒', () => {
    const outcome = validateReconciliation(envelope('REC-EVT-02', reconciliationPayload({ difference_classes: ['missing'] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.per_item_disposition')
  })

  it('有未消解差异却声明不阻断 → 拒（对账完成前不得结清/不得宣称迁移完成）', () => {
    const outcome = validateReconciliation(
      envelope('REC-EVT-02', reconciliationPayload({
        difference_classes: ['late_arrival'],
        per_item_disposition: [{ item: '迟到事件 1 条', owner: 'unit-head-1', disposition: '补齐并复核', due: '2026-10-28T00:00:00Z' }],
      })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.blocking_effect')
  })

  it('对账未完成（不完整）却宣称结清/迁移完成 → 拒', () => {
    const outcome = validateReconciliation(envelope('REC-EVT-02', reconciliationPayload({ completeness_claim: 'incomplete' })), {
      claimsSettledOrMigrated: true,
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.completeness_claim')
  })

  it('未知被下游显示成零/健康 → 拒（记录侧未知不得折算为通过）', () => {
    const outcome = validateUnknownRegistry(envelope('REC-EVT-03', unknownRegistryPayload()), { displayedAsZeroOrHealthy: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.impact')
  })

  it('未知登记的 owner 是匿名主体「daemon」→ 拒（须具名接收位置）', () => {
    const outcome = validateUnknownRegistry(envelope('REC-EVT-03', unknownRegistryPayload({ owner: 'daemon' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.owner')
  })
})
