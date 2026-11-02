/**
 * watchdog-liveness —— 看门狗 silentMs 活性锚（studio-dev-505）V2 定向用例
 *
 * 依据（实现单引用）：
 *   - docs/02-F1-08 看门狗三道（daemon 侧兜底：活性≠平台单据字段刷新）；
 *   - docs/17-§2 相位 4 停摆检查 / 相位 7 心跳；docs/17-§6 收割四要件（接管≠收割）；
 *   - docs/v2/07-§三 EXEC-01/EXEC-02（活性观察面）／EXEC-03（常态更新不得杀活 worker）。
 *
 * 红证语义（改前世界的缺陷，488-att2 实证）：silentMs=now−issue.updated——单据只在派发/
 * 状态迁移时刷新，单回合 > 阈值的**活体** worker 必达阈被误杀；本用例组把该口径钉死在
 * 「活性锚」上：worker 侧活动新鲜=不告警；worker 侧活动陈旧但单据刚更新=照常告警；
 * 无活性证据=回退 issue.updated（旧迹字节不变）；确定性消亡=即时告警交引擎 B 面收口。
 */
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/decide.ts'
import { DEFAULT_STATES } from '../../src/flows.ts'
import { makeInput, makeIssue, T0 } from '../helpers.ts'

const { dispatched, evidenceReady } = DEFAULT_STATES
const HOUR = 3_600_000

describe('看门狗 silentMs 活性锚（studio-dev-505）', () => {
  it('活性新鲜 + 单据 updated 古老 → 不告警（488-att2 误杀面：长回合活体不得达阈）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }),
        now: T0 + 2 * HOUR,
        liveness: { lastActivityAt: T0 + 2 * HOUR - 5_000, source: 'session-mtime' },
      }),
    )
    expect(out.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
  })

  it('活性陈旧 + 单据 updated 新鲜 → 照常告警（锚已切到 worker 活性，不认单据字段）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: dispatched, updated: new Date(T0 + 2 * HOUR).toISOString() }),
        now: T0 + 2 * HOUR,
        liveness: { lastActivityAt: T0, source: 'session-mtime' },
      }),
    )
    expect(out.action).toMatchObject({ type: 'stall_alarm', code: 'STALL_SILENT', silentMs: 2 * HOUR })
  })

  it('无活性证据 → 回退 issue.updated（旧世界字节不变；回退面可审计）', () => {
    const out = decide(
      makeInput({ issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }), now: T0 + 2 * HOUR }),
    )
    expect(out.action).toMatchObject({ type: 'stall_alarm', code: 'STALL_SILENT', silentMs: 2 * HOUR })
    expect('livenessSource' in out.action).toBe(false)
  })

  it('worker 确定性消亡（work_record interrupted）→ 未超阈也即时告警，交引擎 B 面收口', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }),
        now: T0 + 60_000,
        liveness: { lastActivityAt: T0 + 30_000, source: 'work-record', workerGone: true },
      }),
    )
    expect(out.action).toMatchObject({
      type: 'stall_alarm',
      code: 'STALL_SILENT',
      silentMs: 30_000,
      workerGone: true,
      livenessSource: 'work-record',
    })
  })

  it('动作携活性锚时刻与生效阈值（分级阈值由引擎解析后入参——判定面可审计）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: dispatched }),
        now: T0 + 2 * HOUR,
        stallAfterMs: HOUR,
        liveness: { lastActivityAt: T0, source: 'stream-event' },
      }),
    )
    expect(out.action).toMatchObject({
      type: 'stall_alarm',
      silentMs: 2 * HOUR,
      stallThresholdMs: HOUR,
      livenessAnchorAt: T0,
      livenessSource: 'stream-event',
    })
  })

  it('未在工态不吃活性锚（证据就绪照常收割；停摆判定只盯已派发）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: evidenceReady }),
        now: T0 + 2 * HOUR,
        liveness: { lastActivityAt: T0 + 2 * HOUR - 1_000, source: 'session-mtime' },
      }),
    )
    expect(out.action).toMatchObject({ type: 'collect', code: 'EVIDENCE_READY' })
  })

  it('阈值边界：静默恰等于阈值不告警（严格大于才达阈——既有语义零漂移）', () => {
    const out = decide(
      makeInput({
        issue: makeIssue({ state: dispatched }),
        now: T0 + HOUR,
        liveness: { lastActivityAt: T0, source: 'session-mtime' },
      }),
    )
    expect(out.action).toMatchObject({ type: 'wait_evidence', code: 'EVIDENCE_PENDING' })
  })
})
