/**
 * decide 纯函数测试 —— docs/17-§2 七相位语义 / 并发三闸 / 幂等去重 / 断路压制 /
 * 纯度纪律。分支全覆盖目标：每闸、每锚点态、每理由码至少一例。
 */
import { describe, expect, it } from 'vitest'
import type { IssueRecord, InvokeIntent } from '@studio-next/contract'
import { decide, intentKeyOf } from '../src/decide.ts'
import { DEFAULT_FLOW_ANCHORS, DEFAULT_STATES } from '../src/flows.ts'
import { makeInput, makeIntent, makeIssue, T0 } from './helpers.ts'

const { fresh, approval, dispatched, evidenceReady, verified, delivered } = DEFAULT_STATES

describe('纯度纪律（F1-03：同状态同配置必同决策）', () => {
  it('同输入恒同输出（深等价）', () => {
    const a = decide(makeInput())
    const b = decide(makeInput())
    expect(a).toEqual(b)
  })

  it('不改动输入（seenIntentKeys 等引用内容不变）', () => {
    const input = makeInput()
    const snapshot = JSON.stringify(input)
    decide(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('L0 正常链（七相位语义）', () => {
  it('新单+三闸全过 → dispatch（17-§2 派发相位）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: fresh, level: 0 }) }))
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH', toState: dispatched, lane: 'main' })
  })

  it('已派发在工 → wait_evidence（收割前置）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: dispatched }) }))
    expect(out.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
  })

  it('证据就绪 → collect（收割相位）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: evidenceReady }) }))
    expect(out.action).toMatchObject({ type: 'collect', code: 'EVIDENCE_READY' })
  })

  it('复验通过 → merge（合并相位，L0 直达已交付）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: verified }) }))
    expect(out.action).toMatchObject({ type: 'merge', code: 'MERGE_DUE', toState: delivered })
  })

  it('已交付 → recycle（回收相位；回退边不误触发再派发）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: delivered }) }))
    expect(out.action).toMatchObject({ type: 'recycle', code: 'LANE_RELEASE' })
  })
})

describe('并发三闸（17-§2；F1-05 触顶顺延不丢）', () => {
  it('闸一：泳道租约有主且未过期 → hold LANE_BUSY', () => {
    const out = decide(makeInput({ laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 + 600_000 } }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_LANE_BUSY' })
  })

  it('闸一：租约已过期（死主）视同无主 → 照常派发', () => {
    const out = decide(
      makeInput({
        laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 - 1 },
        now: T0,
      }),
    )
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })

  it('闸序：断路未开时泳道优先于每拍（同触多发取首因）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: approval, level: 1 }),
        approved: true,
        laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 + 600_000 },
        tickActionCount: 5,
        limits: { maxActionsPerTick: 5, maxInflight: 10 },
      }),
    )
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_LANE_BUSY' })
  })

  it('闸二：每拍上限 → hold TICK_LIMIT', () => {
    const out = decide(makeInput({ tickActionCount: 5, limits: { maxActionsPerTick: 5, maxInflight: 10 } }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_TICK_LIMIT' })
  })

  it('闸三：全局在途上限 → hold INFLIGHT_LIMIT', () => {
    const out = decide(makeInput({ inflightCount: 10, limits: { maxActionsPerTick: 5, maxInflight: 10 } }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_INFLIGHT_LIMIT' })
  })

  it('闸序冻结：断路 > 泳道 > 每拍 > 在途（同触多发取首因）', () => {
    const both = decide(
      makeInput({
        breaker: { strikes: 3, threshold: 3 },
        laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 + 600_000 },
        tickActionCount: 5,
        limits: { maxActionsPerTick: 5, maxInflight: 10 },
        inflightCount: 10,
      }),
    )
    expect(both.action).toMatchObject({ type: 'hold', code: 'HOLD_BREAKER_OPEN' })
  })

  it('非派发动作不受三闸压制（已交付在闸全红时仍回收）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: delivered }),
        laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 + 600_000 },
        tickActionCount: 9,
        inflightCount: 99,
        limits: { maxActionsPerTick: 5, maxInflight: 10 },
      }),
    )
    expect(out.action).toMatchObject({ type: 'recycle', code: 'LANE_RELEASE' })
  })
})

describe('断路器压制（F1-10 断路后零新 DISPATCH）', () => {
  it('连击达阈值：派发就绪态 → hold BREAKER_OPEN', () => {
    const out = decide(makeInput({ breaker: { strikes: 3, threshold: 3 } }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_BREAKER_OPEN' })
  })

  it('阈值差一击不熔断：照常派发', () => {
    const out = decide(makeInput({ breaker: { strikes: 2, threshold: 3 } }))
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })
})

describe('幂等去重（22-§三.2 / 25-§3.4）', () => {
  it('键形：(source, kind, company, ticket??dedupKey)', () => {
    expect(intentKeyOf(makeIntent({ source: 'poll', kind: 'ticket', ticket: 'T-7' }))).toBe('poll|ticket|acme|T-7')
    // 无单意图（mention 类）：ticket 缺位走 dedupKey——内联构造，绕开 makeIntent 的默认单号
    const mention: InvokeIntent = { kind: 'mention', company: 'acme', source: 'matrix', dedupKey: 'm-1' }
    expect(intentKeyOf(mention)).toBe('matrix|mention|acme|m-1')
  })

  it('重复意图 → noop DEDUP_NOOP（100 个重复只唤起一次）', () => {
    const out = decide(makeInput({ seenIntentKeys: ['poll|ticket|acme|T-1'] }))
    expect(out.action).toMatchObject({ type: 'noop', code: 'DEDUP_NOOP' })
  })

  it('不同源/不同键不算重复：照常派发', () => {
    const out = decide(
      makeInput({
        seenIntentKeys: ['relay|relay|acme|T-1'],
        intent: makeIntent({ source: 'poll', kind: 'ticket' }),
      }),
    )
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })

  it('无 ticket 且无 dedupKey → hold INTENT_MALFORMED（不派工明报）', () => {
    const malformed: InvokeIntent = { kind: 'webhook', company: 'acme', source: 'hook' }
    const out = decide(makeInput({ intent: malformed }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_INTENT_MALFORMED' })
  })

  it('意图单号与本单不符 → hold INTENT_MISMATCH（防御装配错误）', () => {
    const out = decide(makeInput({ intent: makeIntent({ ticket: 'T-999' }) }))
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_INTENT_MISMATCH' })
  })
})

describe('L1/L2 批流（待批语义）', () => {
  it('L1 新单 → submit_approval（呈批：新单→待批）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: fresh, level: 1 }) }))
    expect(out.action).toMatchObject({ type: 'submit_approval', code: 'SUBMIT_APPROVAL', toState: approval })
  })

  it('L1 待批未批 → noop WAIT_APPROVAL', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: approval, level: 1 }) }))
    expect(out.action).toMatchObject({ type: 'noop', code: 'WAIT_APPROVAL' })
  })

  it('L1 待批已批+三闸全过 → dispatch', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: approval, level: 1 }), approved: true }))
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })

  it('L1 待批已批但闸红 → hold（批准不豁免三闸）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: approval, level: 1 }),
        approved: true,
        laneLease: { lane: 'main', holder: 'P-9', expiresAt: T0 + 600_000 },
      }),
    )
    expect(out.action).toMatchObject({ type: 'hold', code: 'HOLD_LANE_BUSY' })
  })

  it('L2 复验通过 → submit_approval（交付批）；交付批已准+已有证据 → merge', () => {
    const submit = decide(makeInput({ issue: makeIssue({ state: verified, level: 2 }) }))
    expect(submit.action).toMatchObject({ type: 'submit_approval', code: 'SUBMIT_APPROVAL' })

    const merge = decide(makeInput({ issue: makeIssue({ state: approval, level: 2 }), approved: true, verifiedEvidence: true }))
    expect(merge.action).toMatchObject({ type: 'merge', code: 'MERGE_DUE', toState: delivered })
  })

  it('L2 重名态「待批」消歧：已批但无复验证据 → 仍走派发轨道（不误合并）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: approval, level: 2 }), approved: true }))
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })

  it('L1 待批不因 verifiedEvidence 改道（successors 无已交付）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: approval, level: 1 }), approved: true, verifiedEvidence: true }))
    expect(out.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH' })
  })
})

describe('停摆告警（心跳相位）', () => {
  it('在工静默超阈值 → stall_alarm（带静默时长）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }), now: T0 + 2 * 3_600_000 }))
    expect(out.action).toMatchObject({ type: 'stall_alarm', code: 'STALL_SILENT', silentMs: 2 * 3_600_000 })
  })

  it('静默未超阈值 → 仍 wait_evidence', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: dispatched }), now: T0 + 3_500_000 }))
    expect(out.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
  })

  it('updated 不可解析 → 不告警不炸（坏数据不触发动作）', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: dispatched, updated: 'not-a-date' }) }))
    expect(out.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
  })
})

describe('明报兜底（不猜不动）', () => {
  it('等级未定级 → noop NOOP_UNKNOWN_FLOW', () => {
    // 内联构造：镜像单缺 level 字段（makeIssue 会兜 level:0，此处需要真缺位）
    const unleveld: IssueRecord = { id: 'T-1', title: '未定级单', state: fresh, type: 'task', updated: '2026-10-16T00:00:00.000Z' }
    const out = decide(makeInput({ issue: unleveld }))
    expect(out.action).toMatchObject({ type: 'noop', code: 'NOOP_UNKNOWN_FLOW' })
  })

  it('等级无对应流表（L9）→ noop NOOP_UNKNOWN_FLOW', () => {
    const out = decide(makeInput({ level: 9 }))
    expect(out.action).toMatchObject({ type: 'noop', code: 'NOOP_UNKNOWN_FLOW' })
  })

  it('状态不在流表状态集（平台自定义态）→ noop NOOP_UNKNOWN_STATE', () => {
    const out = decide(makeInput({ issue: makeIssue({ state: '制作人拖单态' }) }))
    expect(out.action).toMatchObject({ type: 'noop', code: 'NOOP_UNKNOWN_STATE' })
  })

  it('公司覆盖流：自定义态走对应语义（锚点随表）', () => {
    const custom = {
      L0: { mainline: ['Open', 'Running', 'Done'], anchors: { ...DEFAULT_FLOW_ANCHORS, fresh: 'Open', dispatched: 'Running', delivered: 'Done' } },
    }
    // Open（派发就绪：前向后继=Running）
    const dispatch = decide(makeInput({ flows: custom, issue: makeIssue({ state: 'Open' }) }))
    expect(dispatch.action).toMatchObject({ type: 'dispatch', code: 'DISPATCH', toState: 'Running' })
    // Running 为在工态 → wait_evidence；Done → recycle
    const wait = decide(makeInput({ flows: custom, issue: makeIssue({ state: 'Running' }) }))
    expect(wait.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
    const done = decide(makeInput({ flows: custom, issue: makeIssue({ state: 'Done' }) }))
    expect(done.action).toMatchObject({ type: 'recycle', code: 'LANE_RELEASE' })
    // 覆盖流没有 evidenceReady 锚点态：自定义中间态 → NOOP_IDLE
    const idle = decide(makeInput({ flows: custom, issue: makeIssue({ state: 'Paused' }) }))
    expect(idle.action).toMatchObject({ type: 'noop', code: 'NOOP_UNKNOWN_STATE' })
  })

  it('等级显式覆盖优先于镜像单字段（level 入参 2 覆盖 issue.level 0）', () => {
    const out = decide(makeInput({ level: 2, issue: makeIssue({ state: fresh, level: 0 }) }))
    expect(out.action).toMatchObject({ type: 'submit_approval', code: 'SUBMIT_APPROVAL' })
  })
})
