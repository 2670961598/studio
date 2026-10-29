/**
 * terminal-shape —— IMPL-06-04「engine 收口」V3 契约（NEG-RUN-02＋SEC-FC-06＋G-PORT-OPS）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-04（验收：`test:v2 -- apps/daemon/test/v2/records` 绿——
 *     NEG-RUN-02 终态五值不压布尔；无 onBehalfOf 的 system 署名构造期抛错；G-PORT-OPS 落口）；
 *   - docs/v2/17 §一 V3（fake 只替代外部端口；内部决策/记录/状态机真跑）／NEG-RUN-02 行
 *     「终态 kind 五值压成布尔；kill 后无结果不明标记」→ 预期拒绝＝只认原生字段全值、
 *     结果不明独立标记（docs/v2/07 §三 EXEC-05；docs/v2/09 ENU-53）；
 *   - docs/v2/15 §一 SEC-FC-06（系统代写署名常量：无 onBehalfOf 的 system 署名＝构造期非法）、
 *     §二 SEC-SIG-01（署名三值：person/control/system；system 的 onBehalfOf 必填）；
 *   - docs/v2/14 §1.8（PORT-OPS：emergencyStop/circuitBreak；供能链 PORT-AUTH→PORT-OPS 单向）、
 *     docs/v2/11 §六 REC-WORK-18（紧急止损记录：trigger/boundary_ref/actions_taken/
 *     not_authorized/evidence_preserved/notified/independent_review/effect_on_original）。
 *
 * 断言纪律：负例只断言**拒绝面**（放行路径必须不存在：未授权＝零记录零回执）；不 mock LLM；
 * 引擎用例走真引擎＋真 SQLite 台账＋fake 平台/执行体（fixtures/work-stack.ts）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import type {
  CallContext,
  CircuitBreakRequest,
  EmergencyStopRequest,
  PortFailure,
  PortResult,
  StopReceipt,
  TerminalState,
} from '@studio-next/contract'
import { harvestRequirementsOf, type HarvestRequirementInput } from '../../../src/engine/harvest/batch.ts'
import {
  constructEngineSignature,
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type EngineDeps,
  type EngineSignatureDraft,
} from '../../../src/engine/engine.ts'
import { createOpsLanding, type OpsLanding, type OpsStopRecord } from '../../../src/control/stop-channel.ts'
import { createTicket, createWorkStack, disposeWorkStacks, eventsNamed, runTicks } from './fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

// ————————————————————————— 一、NEG-RUN-02 终态形状 —————————————————————————

/** ENU-53 执行终态五值（值集唯一主表 v2/09；本测试的规格钉子） */
const TERMINAL_FIVE = ['completed', 'error', 'blocked', 'aborted', 'limit_exceeded'] as const satisfies readonly TerminalState[]

/** 四要件输入骨架（只有 `completed` 布尔面时，观察面不得再压布尔——见 NEG-RUN-02） */
function requirementInput(overrides: Partial<HarvestRequirementInput> = {}): HarvestRequirementInput {
  return { completed: false, nonEmptyOutput: false, reportExists: false, exit0: false, terminalObserved: true, terminalError: undefined, ...overrides }
}

describe('NEG-RUN-02 终态五值不压布尔：只认原生字段全值，结果不明独立标记', () => {
  it('执行终态值集＝ENU-53 五值（布尔/杀毙字面不是终态值）', () => {
    expect([...TERMINAL_FIVE]).toEqual(['completed', 'error', 'blocked', 'aborted', 'limit_exceeded'])
    expect(new Set(TERMINAL_FIVE).size).toBe(5)
    // 终态是字符串值集：布尔 false/true 与「已杀」字面都不在值集内（负向：不得压缩/不得偷换）
    for (const bad of [false, true, 'killed', 'timeout']) expect(TERMINAL_FIVE).not.toContain(bad as never)
  })

  it('收割观察面只出五值或 unknown：completed→completed、错误原文→error、未采集→unknown（独立标记）', () => {
    const completed = harvestRequirementsOf(requirementInput({ completed: true, nonEmptyOutput: true, reportExists: true, exit0: true }))
    expect(completed.executionTerminal).toBe('completed')
    expect(completed.fourOk).toBe(true)

    const errored = harvestRequirementsOf(requirementInput({ terminalError: 'EXTERNAL_RATE_LIMIT：429' }))
    expect(errored.executionTerminal).toBe('error')
    expect(errored.fourOk).toBe(false)

    // 未采到终态（崩溃/被杀）≠ false：独立 unknown 标记＋「终态未采集到」唯一的 gaps
    //（「没采集到」与「无输出」两件事——其余要件齐时 gaps 只该有终态缺）；
    const unknown = harvestRequirementsOf(requirementInput({ terminalObserved: false, nonEmptyOutput: true, reportExists: true, exit0: true }))
    expect(unknown.executionTerminal).toBe('unknown')
    expect(unknown.gaps).toEqual(['终态未采集到'])
    expect(unknown.fourOk).toBe(false)
    for (const value of [completed.executionTerminal, errored.executionTerminal, unknown.executionTerminal]) {
      expect(typeof value).toBe('string')
      expect([...TERMINAL_FIVE, 'unknown']).toContain(value)
    }
  })

  it('kill 后结果不明：STALL 咬合杀工→收割批次终态 unknown（不封批、不冒结论），无 GATE_PASS/FAIL 冒充', async () => {
    const stack = await createWorkStack('run02-kill')
    stack.mode.value = 'stalled' // 静默工人：流驻留零事件（DEV-44 注入面）
    const ticket = await createTicket(stack)
    await runTicks(stack, 70) // 派发→静默超阈→两次告警→咬合整树杀

    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH').length).toBeGreaterThanOrEqual(1)
    const batch = stack.engine.harvestBatches.get({ ticket, attempt: 1 })
    expect(batch).toBeDefined()
    // 结果不明独立标记：终态 unknown（不是 false、不是臆造的 blocked/aborted）；
    // 批次未封口（未观察到终态不得按「已杀死」结案）。
    expect(batch?.executionTerminal).toBe('unknown')
    expect(batch?.status).not.toBe('sealed')
    // 杀≠收割结论：不落 GATE_PASS/GATE_FAIL
    expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(0)
    // 在途收口为 interrupted（接管≠收割语义；不留 running 冒充在途）
    expect(stack.ledger.listWorkRecords({ issue: ticket }).some((record) => record.status === 'interrupted')).toBe(true)
  })
})

// ————————————————————————— 二、SEC-FC-06 系统代写署名构造期校验 —————————————————————————

describe('SEC-FC-06 系统代写署名：无 onBehalfOf 的 system 署名＝构造期非法', () => {
  it('system 缺 onBehalfOf（缺省/空白）→ 构造期抛 SIGNATURE_INVALID（不降级不补缺省）', () => {
    expect(() => constructEngineSignature({ actorKind: 'system', actorRef: 'daemon' })).toThrow(/SIGNATURE_INVALID.*onBehalfOf/)
    expect(() => constructEngineSignature({ actorKind: 'system', actorRef: 'daemon', onBehalfOf: '   ' })).toThrow(/onBehalfOf/)
  })

  it('合法 system 署名保留可还原的 onBehalfOf（actorRef 只是通道位）', () => {
    expect(constructEngineSignature({ actorKind: 'system', actorRef: 'daemon', onBehalfOf: 'AGENT-1' })).toEqual({
      actorKind: 'system',
      actorRef: 'daemon',
      onBehalfOf: 'AGENT-1',
    })
  })

  it('control 缺 decisionRef／actorRef 空白／未知主体／草稿缺失 → 构造期拒绝（同层校验）', () => {
    expect(() => constructEngineSignature({ actorKind: 'control', actorRef: 'ctl:ops' })).toThrow(/decisionRef/)
    expect(() => constructEngineSignature({ actorKind: 'person', actorRef: '  ' })).toThrow(/actorRef/)
    expect(() => constructEngineSignature({ actorKind: 'robot', actorRef: 'x' } as unknown as EngineSignatureDraft)).toThrow(/未知署名主体/)
    expect(() => constructEngineSignature(undefined as unknown as EngineSignatureDraft)).toThrow(/SIGNATURE_INVALID/)
  })

  it('createEngine 构造期校验先行：非法 system 署名在入口即拒起（不消费依赖）', () => {
    const deps = { config: ENGINE_CONFIG_DEFAULTS, signature: { actorKind: 'system', actorRef: 'daemon' } } as unknown as EngineDeps
    expect(() => createEngine(deps)).toThrow(/SIGNATURE_INVALID.*onBehalfOf/)
  })

  it('迁移期显式缺口：未注入签名时仍用常量（合法调用行为不变；审计断言归 IMPL-07-10）', () => {
    expect(ENGINE_CONFIG_DEFAULTS.actor).toBe('daemon')
  })
})

// ————————————————————————— 三、G-PORT-OPS 落口（REC-WORK-18 记录/证据面） —————————————————————————

const FIXED_AT = '2026-11-01T00:00:00.000Z'

/** 合法调用上下文（control 署名：控制面位置＋决定记录引用） */
function opsContext(signature?: CallContext['signature']): CallContext {
  return {
    company: { companyId: 'company-demo', slug: 'demo' },
    caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
    authority: [],
    signature: signature ?? { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
  }
}

/** 紧急止损请求骨架（字段面见 v2/14 §1.8 EmergencyStopRequest；OPS 补形 A：REC-WORK-18 全字段） */
function emergencyRequest(overrides: Record<string, unknown> = {}): EmergencyStopRequest {
  return {
    authorization: { poweredBy: 'decision', decisionRef: 'REC-DEC-01' },
    reason: '现场最小止损：停止对外写入并保全现场',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: {
      preset: true,
      boundaryRef: 'REC-AUTH-01',
      boundaryRecordRef: { refType: 'REC-AUTH-01', refId: 'REC-AUTH-01', refVersion: '1.0.0' },
      permittedActions: ['停止对外写入', '保全现场快照'],
    },
    actionsTaken: ['停止对外写入', '保全现场快照'],
    notAuthorized: ['未进入禁止面', '未追认原动作'],
    evidencePreserved: [{ refId: 'evidence-snapshot-1', refVersion: '1.0.0' }],
    notified: [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }],
    review: { reviewerRef: 'audit-1', due: '2026-11-02T00:00:00.000Z' },
    ...overrides,
  } as unknown as EmergencyStopRequest
}

/** 止损围栏请求骨架（fence 声明见 v2/14 §1.8 CircuitBreakRequest；OPS 补形 A：REC-WORK-18 全字段） */
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
    evidencePreserved: [{ refId: 'evidence-2', refVersion: '1.0.0' }],
    notified: [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }],
    review: { reviewerRef: 'audit-2', due: '2026-11-02T00:00:00.000Z' },
    ...overrides,
  } as unknown as CircuitBreakRequest
}

interface OpsHarness {
  readonly landing: OpsLanding
  readonly records: OpsStopRecord[]
}

function buildOps(): OpsHarness {
  const records: OpsStopRecord[] = []
  const landing = createOpsLanding({
    makeId: () => `REC-WORK-18:${records.length + 1}`,
    now: () => FIXED_AT,
    appendRecord: (record) => {
      records.push(record)
    },
  })
  return { landing, records }
}

function expectRejected(outcome: PortResult<unknown>, category: PortFailure['category']): PortFailure {
  if (outcome.kind !== 'err') throw new Error('预期 Err，收到 Ok（放行路径必须不存在）')
  expect(outcome.error.category).toBe(category)
  return outcome.error
}

describe('G-PORT-OPS 落口：未授权 fail-closed（REC-WORK-18 记录/证据面）', () => {
  it('未授权四态（缺 authorization／来源不明／政策非 permitted／引用空白）→ rejected_authority，零记录零回执', () => {
    const unauthorized: EmergencyStopRequest[] = [
      emergencyRequest({ authorization: undefined }),
      emergencyRequest({ authorization: { poweredBy: 'self_granted', commandRef: 'cmd-1' } }),
      emergencyRequest({ authorization: { poweredBy: 'policy_verdict', commandRef: 'cmd-1', verdict: 'rejected' } }),
      emergencyRequest({ authorization: { poweredBy: 'decision', decisionRef: '   ' } }),
    ]
    for (const request of unauthorized) {
      const { landing, records } = buildOps()
      const failure = expectRejected(landing.emergencyStop(request, opsContext()), 'rejected_authority')
      expect(failure.sideEffectPossible).toBe(false)
      expect(failure.retryable).toBe(false)
      expect(failure.reconcile.required).toBe(false)
      // 放行路径不存在：未授权请求不落任何记录（无「先记后拒」）
      expect(records).toHaveLength(0)
    }
  })

  it('署名闸同 fail-closed：system 缺 onBehalfOf／control 缺 decisionRef／公司维空白 → rejected_authority，零记录', () => {
    const badContexts: CallContext[] = [
      opsContext({ actorKind: 'system', actorRef: 'daemon' } as unknown as CallContext['signature']),
      opsContext({ actorKind: 'control', actorRef: 'ctl:ops' } as unknown as CallContext['signature']),
      { ...opsContext(), company: { companyId: '', slug: '' } },
    ]
    for (const context of badContexts) {
      const { landing, records } = buildOps()
      expectRejected(landing.emergencyStop(emergencyRequest(), context), 'rejected_authority')
      expect(records).toHaveLength(0)
    }
  })

  it('REC-WORK-18 形状缺（not_authorized 空集／通知匿名／复核自审）→ rejected_precondition，零记录', () => {
    const invalid: EmergencyStopRequest[] = [
      emergencyRequest({ notAuthorized: [] }),
      emergencyRequest({ notified: [{ refId: '框架', refVersion: '1.0.0' }] }),
      // 复核者＝现场责任主体（caller AGENT-1）＝自审：独立复核不成立
      emergencyRequest({ review: { reviewerRef: 'AGENT-1', due: '2026-11-02T00:00:00.000Z' } }),
    ]
    for (const request of invalid) {
      const { landing, records } = buildOps()
      expectRejected(landing.emergencyStop(request, opsContext()), 'rejected_precondition')
      expect(records).toHaveLength(0)
    }
  })

  it('合法 decision 供能 → Ok：REC-WORK-18 落地恰一次（三 false／outcome unknown＋reconcile）', () => {
    const { landing, records } = buildOps()
    const outcome = landing.emergencyStop(emergencyRequest(), opsContext())
    expect(outcome.kind).toBe('ok')
    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record?.recordType).toBe('REC-WORK-18')
    expect(record?.kind).toBe('emergency_stop')
    expect(record?.boundaryRef).toEqual({ refType: 'REC-AUTH-01', refId: 'REC-AUTH-01', refVersion: '1.0.0' })
    // OPS 补形 A：实际处置动作与显式版本引用来自请求（非登记动作占位）
    expect(record?.actionsTaken).toEqual(['停止对外写入', '保全现场快照'])
    expect(record?.notified).toEqual([{ refId: 'G9.internal-boss', refVersion: '1.0.0' }])
    expect(record?.evidencePreserved).toEqual([{ refId: 'evidence-snapshot-1', refVersion: '1.0.0' }])
    expect(record?.notAuthorized).toEqual(['未进入禁止面', '未追认原动作'])
    expect(record?.gaps).toEqual([])
    expect(record?.effectOnOriginal).toEqual({ retroactiveApproval: false, equalsRecovery: false, normalizable: false })
    expect(record?.outcome).toBe('unknown')
    expect(record?.review?.position).toBe('audit-1')
    // 复核结论未给＝显式未完成标记（不臆造结论）
    expect(record?.review?.conclusion).toContain('未完成')
    const receipt = (outcome as { kind: 'ok'; value: StopReceipt }).value
    expect(receipt.recordId).toBe(record?.recordId)
    expect(receipt.effectOnOriginal.equalsRecovery).toBe(false)
    expect(receipt.outcome).toBe('unknown')
    expect(receipt.reconcile.required).toBe(true)
  })

  it('记录写口失败 → Err（不冒 Ok；sideEffectPossible=true＋对账入口）', () => {
    const landing = createOpsLanding({
      makeId: () => 'REC-WORK-18:down',
      now: () => FIXED_AT,
      appendRecord: () => {
        throw new Error('ledger unavailable')
      },
    })
    const failure = expectRejected(landing.emergencyStop(emergencyRequest(), opsContext()), 'unavailable')
    expect(failure.sideEffectPossible).toBe(true)
    expect(failure.retryable).toBe(true)
    expect(failure.reconcile.required).toBe(true)
  })

  it('circuitBreak 同闸：未授权 → rejected_authority 零记录；合法 → Ok 围栏回执＋REC-WORK-18 显式缺口记录', () => {
    const denied = buildOps()
    expectRejected(denied.landing.circuitBreak(breakRequest({ authorization: { poweredBy: 'policy_verdict', commandRef: 'cmd-1', verdict: 'denied' } }), opsContext()), 'rejected_authority')
    expect(denied.records).toHaveLength(0)

    const { landing, records } = buildOps()
    const outcome = landing.circuitBreak(breakRequest(), opsContext())
    expect(outcome.kind).toBe('ok')
    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record?.kind).toBe('circuit_break')
    // OPS 补形 A：notified/independent_review 已入请求形状（不再以形状缺口占位）
    expect(record?.notified).toEqual([{ refId: 'G9.internal-boss', refVersion: '1.0.0' }])
    expect(record?.review?.position).toBe('audit-2')
    expect(record?.actionsTaken).toEqual(['冻结旧写入者'])
    // 真实未证项仍逐条列（围栏机制未证／无预设紧急边界）
    expect(record?.gaps.length).toBeGreaterThan(0)
    expect(record?.gaps.join('｜')).not.toMatch(/槽位|请求形状/)
    // 机制未证不得宣称已冻结；未做清单非空（含围栏取反项）
    expect(record?.gaps.some((gap) => gap.includes('mechanismProven'))).toBe(true)
    expect(record?.notAuthorized).toContain('未撤销派生执行体（fence.revokeDerived=false）')
    if (outcome.kind === 'ok') {
      expect(outcome.value.fence.stopInjection).toBe(true)
      expect(outcome.value.outcome).toBe('unknown')
      expect(outcome.value.reconcile.required).toBe(true)
    }
  })
})
