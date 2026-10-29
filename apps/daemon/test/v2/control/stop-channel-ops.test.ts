/**
 * stop-channel PORT-OPS 落口 —— OPS 补形 A（REC-WORK-18 必填面）行为断言
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.8（PORT-OPS 请求形状：emergencyStop/circuitBreak；OPS 补形 A）、
 *     docs/v2/11 §六 REC-WORK-18（trigger/boundary_ref/actions_taken/not_authorized/
 *     evidence_preserved/notified/independent_review/effect_on_original）、
 *     docs/v2/15 §一/§二（SEC-FC-06 署名、SEC-SIG-01 三值）；
 *   - docs/49「OPS 补形 A」（决定 A：补形状到必填面；引用版本调用方显式给，不臆造）。
 *
 * 断言纪律：负例只断言**拒绝面**（放行路径不存在：拒绝＝零记录零回执）；正例断言记录
 * **完整落形**（无「形状缺口」gap，真实未做进 not_authorized、真实未证进 gaps）。
 * 记录写口用内存数组（本件只测 control 面；真落库在 test/v2/ops）。
 */
import { describe, expect, it } from 'vitest'
import type {
  CallContext,
  CircuitBreakRequest,
  EmergencyStopRequest,
  OpsRecordRef,
  OpsRef,
  PortFailure,
  PortResult,
  StopReceipt,
} from '@studio-next/contract'
import {
  createOpsLanding,
  opsWriteError,
  type OpsLanding,
  type OpsStopRecord,
} from '../../../src/control/stop-channel.ts'

const AT = '2026-11-01T00:00:00.000Z'
const DUE = '2026-11-02T00:00:00.000Z'

function ref(refId: string, refVersion = '1.0.0'): OpsRef {
  return { refId, refVersion }
}

const BOUNDARY_REF: OpsRecordRef = { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' }

/** 合法调用上下文（control 署名：控制面位置＋决定记录引用） */
function opsContext(signature?: CallContext['signature']): CallContext {
  return {
    company: { companyId: 'company-demo', slug: 'demo' },
    caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
    authority: [],
    signature: signature ?? { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
  }
}

/** 紧急止损请求（REC-WORK-18 全字段：实际处置动作/未授权/保全/通知/独立复核） */
function emergencyRequest(overrides: Record<string, unknown> = {}): EmergencyStopRequest {
  return {
    authorization: { poweredBy: 'decision', decisionRef: 'REC-DEC-01' },
    reason: '现场最小止损：停止对外写入并保全现场',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: true, boundaryRef: 'boundary-1', boundaryRecordRef: BOUNDARY_REF, permittedActions: ['停止对外写入', '保全现场快照'] },
    actionsTaken: ['停止对外写入', '冻结出工段'],
    notAuthorized: ['未进入禁止面', '未追认原动作'],
    evidencePreserved: [ref('evidence-snapshot-1')],
    notified: [ref('G9.internal-boss')],
    review: { reviewerRef: 'audit-1', due: DUE },
    ...overrides,
  } as unknown as EmergencyStopRequest
}

/** 止损围栏请求（REC-WORK-18 全字段） */
function breakRequest(overrides: Record<string, unknown> = {}): CircuitBreakRequest {
  return {
    authorization: { poweredBy: 'policy_verdict', commandRef: 'REC-AUTH-02', verdict: 'permitted' },
    reason: '止损围栏：冻旧写入者',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence: { scope: ['executors'], stopInjection: true, revokeDerived: false, mechanismProven: false },
    triggerRef: 'REC-WORK-17',
    actionsTaken: ['冻结旧写入者'],
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: [ref('evidence-2')],
    notified: [ref('G9.internal-boss')],
    review: { reviewerRef: 'audit-2', due: DUE },
    ...overrides,
  } as unknown as CircuitBreakRequest
}

interface OpsHarness {
  readonly landing: OpsLanding
  readonly records: OpsStopRecord[]
}

function buildOps(append?: (record: OpsStopRecord) => void): OpsHarness {
  const records: OpsStopRecord[] = []
  const landing = createOpsLanding({
    makeId: () => `REC-WORK-18:${records.length + 1}`,
    now: () => AT,
    appendRecord:
      append ??
      ((record) => {
        records.push(record)
      }),
  })
  return { landing, records }
}

function failureOf(outcome: PortResult<unknown>, category: PortFailure['category']): PortFailure {
  if (outcome.kind !== 'err') throw new Error('预期 Err，收到 Ok（放行路径必须不存在）')
  expect(outcome.error.category).toBe(category)
  return outcome.error
}

describe('OPS 补形 A：emergencyStop 落完整 REC-WORK-18 记录', () => {
  it('合法请求 → Ok：actions_taken 用实际处置动作、boundary_ref 为显式 RecordRef、notified/evidence 为显式版本引用', () => {
    const { landing, records } = buildOps()
    const outcome = landing.emergencyStop(emergencyRequest(), opsContext())
    expect(outcome.kind).toBe('ok')
    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record?.recordType).toBe('REC-WORK-18')
    expect(record?.kind).toBe('emergency_stop')
    // 实际处置动作来自请求（不再是「登记动作」占位）
    expect(record?.actionsTaken).toEqual(['停止对外写入', '冻结出工段'])
    expect(record?.boundaryRef).toEqual(BOUNDARY_REF)
    expect(record?.notified).toEqual([ref('G9.internal-boss')])
    expect(record?.evidencePreserved).toEqual([ref('evidence-snapshot-1')])
    expect(record?.notAuthorized).toEqual(['未进入禁止面', '未追认原动作'])
    expect(record?.review?.position).toBe('audit-1')
    expect(record?.review?.due).toBe(DUE)
    // 复核结论未给＝显式未完成标记（不臆造结论）
    expect(record?.review?.conclusion).toContain('未完成')
    // 无「形状缺口」：端口形状已覆盖 REC-WORK-18 全字段
    expect(record?.gaps).toEqual([])
    expect(record?.effectOnOriginal).toEqual({ retroactiveApproval: false, equalsRecovery: false, normalizable: false })
    expect(record?.outcome).toBe('unknown')

    const receipt = (outcome as { kind: 'ok'; value: StopReceipt }).value
    expect(receipt.recordId).toBe(record?.recordId)
    expect(receipt.version).toBe(1)
    expect(receipt.actionsTaken).toEqual(['停止对外写入', '冻结出工段'])
    expect(receipt.notified).toEqual(['G9.internal-boss'])
    expect(receipt.evidencePreserved).toEqual(['evidence-snapshot-1'])
    expect(receipt.review.conclusion).toContain('未完成')
    expect(receipt.outcome).toBe('unknown')
    expect(receipt.reconcile.required).toBe(true)
  })

  it('无预设边界（preset:false）→ boundary_ref=null（只允许保全与升级，不冒充预设边界）', () => {
    const { landing, records } = buildOps()
    const outcome = landing.emergencyStop(
      emergencyRequest({ boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true } }),
      opsContext(),
    )
    expect(outcome.kind).toBe('ok')
    expect(records[0]?.boundaryRef).toBeNull()
    expect(records[0]?.gaps).toEqual([])
  })

  it('复核结论已给 → 记录与回执原样承载（不覆写、不臆造）', () => {
    const { landing, records } = buildOps()
    const outcome = landing.emergencyStop(
      emergencyRequest({ review: { reviewerRef: 'audit-1', due: DUE, conclusion: '复核通过：处置在预设边界内' } }),
      opsContext(),
    )
    expect(outcome.kind).toBe('ok')
    expect(records[0]?.review?.conclusion).toBe('复核通过：处置在预设边界内')
    if (outcome.kind === 'ok') expect(outcome.value.review.conclusion).toBe('复核通过：处置在预设边界内')
  })
})

describe('OPS 补形 A：circuitBreak 落完整 REC-WORK-18 记录（无形状缺口）', () => {
  it('合法请求 → Ok：notified/review/evidencePreserved/actionsTaken 全落形；gaps 只列真实未证项', () => {
    const { landing, records } = buildOps()
    const outcome = landing.circuitBreak(breakRequest(), opsContext())
    expect(outcome.kind).toBe('ok')
    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record?.kind).toBe('circuit_break')
    expect(record?.actionsTaken).toEqual(['冻结旧写入者'])
    expect(record?.notified).toEqual([ref('G9.internal-boss')])
    expect(record?.evidencePreserved).toEqual([ref('evidence-2')])
    expect(record?.review?.position).toBe('audit-2')
    expect(record?.boundaryRef).toBeNull()
    // 无预设紧急边界＝真实事实；但不得再出现「请求形状无 notified/independent_review 槽位」形状缺口
    expect(record?.gaps.join('｜')).not.toMatch(/槽位|请求形状|端口形状/)
    expect(record?.gaps.some((gap) => gap.includes('无预设紧急边界'))).toBe(true)
    expect(record?.gaps.some((gap) => gap.includes('mechanismProven'))).toBe(true)
    // notAuthorized：调用方申报保留，围栏取反项补入（真实未做如实列）
    expect(record?.notAuthorized).toContain('未撤销派生执行体')
    expect(record?.notAuthorized).toContain('未追认原动作（围栏声明不构成对原动作的追认）')
    expect(record?.notAuthorized).toContain('未撤销派生执行体（fence.revokeDerived=false）')
    if (outcome.kind === 'ok') {
      expect(outcome.value.fence.stopInjection).toBe(true)
      expect(outcome.value.fence.mechanismProven).toBe(false)
      expect(outcome.value.outcome).toBe('unknown')
      expect(outcome.value.reconcile.required).toBe(true)
    }
  })

  it('mechanismProven:true → 不再列围栏机制未证缺口（真实已证才除名）', () => {
    const { landing, records } = buildOps()
    const outcome = landing.circuitBreak(
      breakRequest({ fence: { scope: ['executors'], stopInjection: true, revokeDerived: true, mechanismProven: true } }),
      opsContext(),
    )
    expect(outcome.kind).toBe('ok')
    expect(records[0]?.gaps.some((gap) => gap.includes('mechanismProven'))).toBe(false)
  })
})

describe('OPS 补形 A：记录闸 fail-closed（缺 actions/review/notified 一律拒，零记录）', () => {
  it('emergencyStop：actions_taken 缺失/空集 → rejected_precondition 零记录', () => {
    const invalid = [emergencyRequest({ actionsTaken: undefined }), emergencyRequest({ actionsTaken: [] }), emergencyRequest({ actionsTaken: ['  '] })]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      const failure = failureOf(landing.emergencyStop(request, opsContext()), 'rejected_precondition')
      expect(failure.subcause).toBe('ops-record-invalid')
      expect(failure.sideEffectPossible).toBe(false)
      expect(records).toHaveLength(0)
    }
  })

  it('emergencyStop：review 缺失 / notified 缺失 / not_authorized 空集 → 拒（零记录）', () => {
    const invalid = [
      emergencyRequest({ review: undefined }),
      emergencyRequest({ notified: [] }),
      emergencyRequest({ notAuthorized: [] }),
    ]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      failureOf(landing.emergencyStop(request, opsContext()), 'rejected_precondition')
      expect(records).toHaveLength(0)
    }
  })

  it('引用版本不臆造：裸名串/缺 refVersion/预设边界缺 boundaryRecordRef → 拒（零记录）', () => {
    const invalid = [
      emergencyRequest({ notified: ['G9.internal-boss'] }),
      emergencyRequest({ evidencePreserved: ['evidence-1'] }),
      emergencyRequest({ notified: [{ refId: 'G9.internal-boss' }] }),
      emergencyRequest({ evidencePreserved: [{ refId: 'evidence-1', refVersion: '  ' }] }),
      emergencyRequest({ boundary: { preset: true, boundaryRef: 'boundary-1', permittedActions: ['停止对外写入'] } }),
      emergencyRequest({ boundary: { preset: true, boundaryRef: 'boundary-1', boundaryRecordRef: { refType: 'REC-AUTH-01', refId: 'b-1' }, permittedActions: ['停止对外写入'] } }),
    ]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      failureOf(landing.emergencyStop(request, opsContext()), 'rejected_precondition')
      expect(records).toHaveLength(0)
    }
  })

  it('具名与独立：notified 匿名责任者 / 复核者=现场责任主体（自审）→ 拒（零记录）', () => {
    const invalid = [
      emergencyRequest({ notified: [ref('框架')] }),
      emergencyRequest({ review: { reviewerRef: 'AGENT-1', due: DUE } }),
      emergencyRequest({ review: { reviewerRef: 'ctl:ops', due: DUE } }),
    ]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      failureOf(landing.emergencyStop(request, opsContext()), 'rejected_precondition')
      expect(records).toHaveLength(0)
    }
  })

  it('circuitBreak：缺 actions/notified/review/evidence 版本 → 拒（零记录）', () => {
    const invalid = [
      breakRequest({ actionsTaken: undefined }),
      breakRequest({ actionsTaken: [] }),
      breakRequest({ notified: [] }),
      breakRequest({ notified: ['G9.internal-boss'] }),
      breakRequest({ review: undefined }),
      breakRequest({ evidencePreserved: ['evidence-2'] }),
      breakRequest({ notAuthorized: [] }),
      breakRequest({ review: { reviewerRef: 'AGENT-1', due: DUE } }),
    ]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      failureOf(landing.circuitBreak(request, opsContext()), 'rejected_precondition')
      expect(records).toHaveLength(0)
    }
  })
})

describe('OPS 三闸不变：供能/署名闸 fail-closed（零记录零回执）', () => {
  it('供能四态（缺 authorization／来源不明／政策非 permitted／引用空白）→ rejected_authority', () => {
    const unauthorized = [
      emergencyRequest({ authorization: undefined }),
      emergencyRequest({ authorization: { poweredBy: 'self_granted', commandRef: 'cmd-1' } }),
      emergencyRequest({ authorization: { poweredBy: 'policy_verdict', commandRef: 'cmd-1', verdict: 'rejected' } }),
      emergencyRequest({ authorization: { poweredBy: 'decision', decisionRef: '   ' } }),
    ]
    for (const request of unauthorized) {
      const { landing, records } = buildOps()
      const failure = failureOf(landing.emergencyStop(request, opsContext()), 'rejected_authority')
      expect(failure.sideEffectPossible).toBe(false)
      expect(failure.reconcile.required).toBe(false)
      expect(records).toHaveLength(0)
    }
  })

  it('署名/公司维（system 缺 onBehalfOf／control 缺 decisionRef／公司维空白／caller 空白）→ rejected_authority', () => {
    const badContexts: CallContext[] = [
      opsContext({ actorKind: 'system', actorRef: 'daemon' } as unknown as CallContext['signature']),
      opsContext({ actorKind: 'control', actorRef: 'ctl:ops' } as unknown as CallContext['signature']),
      { ...opsContext(), company: { companyId: '', slug: '' } },
      { ...opsContext(), caller: { callerId: '', kind: 'employment' } },
    ]
    for (const context of badContexts) {
      const { landing, records } = buildOps()
      failureOf(landing.emergencyStop(emergencyRequest(), context), 'rejected_authority')
      failureOf(landing.circuitBreak(breakRequest(), context), 'rejected_authority')
      expect(records).toHaveLength(0)
    }
  })
})

describe('OPS 写口 fail-closed 与错误分类', () => {
  it('写口抛裸错 → unavailable（sideEffectPossible=true＋reconcile；不冒 Ok）', () => {
    const landing = createOpsLanding({
      makeId: () => 'REC-WORK-18:down',
      now: () => AT,
      appendRecord: () => {
        throw new Error('ledger unavailable')
      },
    })
    const failure = failureOf(landing.emergencyStop(emergencyRequest(), opsContext()), 'unavailable')
    expect(failure.sideEffectPossible).toBe(true)
    expect(failure.retryable).toBe(true)
    expect(failure.reconcile.required).toBe(true)
    expect(failure.subcause).toBe('ops-record-unlanded')
  })

  it('写口分类为 conflict（同 ID/幂等键异内容）→ Err category=conflict（不重试、须对账）', () => {
    const landing = createOpsLanding({
      makeId: () => 'REC-WORK-18:conflict',
      now: () => AT,
      appendRecord: () => {
        throw opsWriteError('conflict', 'ops-record-conflict', '同 recordId 内容不一致')
      },
    })
    const failure = failureOf(landing.circuitBreak(breakRequest(), opsContext()), 'conflict')
    expect(failure.subcause).toBe('ops-record-conflict')
    expect(failure.retryable).toBe(false)
    expect(failure.sideEffectPossible).toBe(true)
    expect(failure.reconcile.required).toBe(true)
  })

  it('makeId/now 铸造失败 → unavailable（不落半条记录）', () => {
    const landing = createOpsLanding({
      makeId: () => {
        throw new Error('id source down')
      },
      now: () => AT,
      appendRecord: () => {},
    })
    const failure = failureOf(landing.emergencyStop(emergencyRequest(), opsContext()), 'unavailable')
    expect(failure.subcause).toBe('ops-stamp-failed')
    expect(failure.retryable).toBe(true)
  })
})
