/** task-125：新 attempt 重置 stall 静默锚（重派后不因旧锚立即 STALL）。 */
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/decide.ts'
import { DEFAULT_STATES } from '../../src/flows.ts'
import { makeInput, makeIssue, T0 } from '../helpers.ts'

const { dispatched } = DEFAULT_STATES
const HOUR = 3_600_000

describe('task-125 stall attempt 锚', () => {
  it('旧锚陈旧 + 新 attempt 刚启动 → 不告警（silent 从 attemptStartedAt 起算）', () => {
    const out = decide(makeInput({
      issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }),
      now: T0 + 2 * HOUR,
      attemptStartedAt: T0 + 2 * HOUR - 2_000,
      stallAfterMs: HOUR,
    }))
    expect(out.action.type).not.toBe('stall_alarm')
  })

  it('同一 attempt 已超阈且锚陈旧 → 仍告警，并带 attemptStartedAt', () => {
    const out = decide(makeInput({
      issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }),
      now: T0 + 2 * HOUR,
      attemptStartedAt: T0 + 1_800_000,
      stallAfterMs: HOUR,
    }))
    expect(out.action).toMatchObject({ type: 'stall_alarm', code: 'STALL_SILENT', attemptStartedAt: T0 + 1_800_000 })
  })

  it('旧锚陈旧 + attempt 未达阈（即使 silentMs 超阈）→ 不咬合/不告警', () => {
    const out = decide(makeInput({
      issue: makeIssue({ state: dispatched, updated: '2026-10-16T00:00:00.000Z' }),
      now: T0 + 2 * HOUR,
      attemptStartedAt: T0 + 2 * HOUR - 30_000,
      stallAfterMs: HOUR,
    }))
    expect(out.action.type).not.toBe('stall_alarm')
  })
})
