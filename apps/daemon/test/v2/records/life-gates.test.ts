/**
 * life-gates —— IMPL-06-02「出工段重认门」V3 负例：NEG-EMP-03（实质变更拒绝续跑）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-02（冻结验收：NEG-EMP-03；`test:v2 -- apps/daemon/test/v2/records` 绿）；
 *   - docs/v2/17 §4.1 NEG-EMP-03（02 §十一 E-3；11 §4 引位）——「出工段重认（REC-WORK-06/07）：
 *     出工中换能力宣称『同一人不用重认』→ **实质变更重认门拒绝续跑**（02 §五/§六）」；
 *   - docs/v2/02 §五/§六（资格链与出工段：实质变更先重认；续跑同一会话 ≠ 恢复同一出工段）；
 *     docs/v2/07 §三 EXEC-04（恢复三层不得混同）＋EXEC-05（终态只是收割输入）；
 *   - docs/v2/11 §5.2 REC-WORK-06（迁移由决定驱动；trigger_ref 必填）、REC-WORK-07（效果级/
 *     能力面判定的独立性）、§十四 14.2（任职侧迁移由决定位置作出，执行体不自判）；
 *   - docs/v2/14 §1.3/§1.4（PORT-HR transitionLifecycle 与 PORT-WORK transition 同族）。
 *
 * 本文件断言两面（同一真栈，不 mock LLM）：
 *   ① 判负门（work/intake.ts `judgeSegmentContinuation`，NEG-EMP-03 的判负面）：执行体/能力
 *      档案任一变更＝实质变更；无重认结论（REC-CAP-02 引用）→ **同一出工段续跑不成立**
 *      （requalification_required，allowed=false）；重认到场才放行——「同一人/同一单」不是
 *      免重认理由。
 *   ② 引擎面（真栈）：能力位不支撑续跑时，引擎**拒绝静默续跑**——明报降级新派（DISPATCH
 *      note `resume=降级新派（…）`），新工位=attempt+1、新会话、causal 链仍挂旧工时单
 *      （因果不断，续跑语义不冒充）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { judgeSegmentContinuation } from '../../../src/engine/work/intake.ts'
import {
  createTicket,
  createWorkStack,
  disposeWorkStacks,
  eventsNamed,
  runTicks,
  tick,
} from './fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

describe('NEG-EMP-03 出工中换能力：实质变更重认门拒绝续跑', () => {
  it('门面：执行体/能力档案变更且无重认引用→续跑被拒；重认到场才放行（同一人不构成免重认）', () => {
    // ① 同执行体同能力档：无实质变更→同一出工段续跑成立
    const same = judgeSegmentContinuation({
      locked: { executor: 'fake-work', capabilityDigest: 'sha256:cap-a' },
      requested: { executor: 'fake-work', capabilityDigest: 'sha256:cap-a' },
      substantive: false,
    })
    expect(same.mode).toBe('continue')
    expect(same.allowed).toBe(true)

    // ② 出工中换执行家（能力/绑定变更）而主张「同一单不用重认」→ 拒绝续跑
    const changedExecutor = judgeSegmentContinuation({
      locked: { executor: 'fake-work', capabilityDigest: 'sha256:cap-a' },
      requested: { executor: 'other-worker', capabilityDigest: 'sha256:cap-a' },
      substantive: false,
    })
    expect(changedExecutor.substantive).toBe(true)
    expect(changedExecutor.mode).toBe('requalification_required')
    expect(changedExecutor.allowed).toBe(false)
    expect(changedExecutor.reason).toBe('substantive-change-requires-requalification')

    // ③ 能力档案变更（未换执行家）同样属实质变更——续跑被拒
    const changedCapability = judgeSegmentContinuation({
      locked: { executor: 'fake-work', capabilityDigest: 'sha256:cap-a' },
      requested: { executor: 'fake-work', capabilityDigest: 'sha256:cap-b' },
      substantive: false,
    })
    expect(changedCapability.mode).toBe('requalification_required')
    expect(changedCapability.allowed).toBe(false)

    // ④ 重认结论（REC-CAP-02 引用）到场→允许续跑；空白引用不算重认（不得以空串蒙混）
    const requalified = judgeSegmentContinuation({
      locked: { executor: 'fake-work', capabilityDigest: 'sha256:cap-a' },
      requested: { executor: 'other-worker', capabilityDigest: 'sha256:cap-b' },
      substantive: true,
      requalificationRef: 'REC-CAP-02:CAP-0007@1',
    })
    expect(requalified.mode).toBe('continue')
    expect(requalified.allowed).toBe(true)
    expect(requalified.requalificationRef).toBe('REC-CAP-02:CAP-0007@1')
    const blankRef = judgeSegmentContinuation({
      locked: { executor: 'fake-work' },
      requested: { executor: 'other-worker' },
      substantive: true,
      requalificationRef: '   ',
    })
    expect(blankRef.allowed).toBe(false)
  })

  it('引擎面：能力位不支撑续跑→拒绝静默续跑（明报降级新派、新 attempt/新会话、causal 链不断）', async () => {
    const stack = await createWorkStack('emp03')
    const ticket = await createTicket(stack)
    await runTicks(stack, 8) // 全链跑通到 CLOSE（真引擎：派发→收割→复验→合并→回收）
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)

    const [previous] = stack.ledger.listWorkRecords({ issue: ticket })
    expect(previous).toBeDefined()
    const previousSession = previous?.session_id
    expect(typeof previousSession).toBe('string')

    // 平台侧复活＋resume 主张（「同一单/同一人」要求续跑）——引擎须走重认/降级判定
    await stack.platform.issues.transition(ticket, '新单')
    stack.engine.ingest([
      {
        kind: 'resume',
        company: 'demo',
        source: 'records-test',
        ticket,
        payload: { cause: 'NEG-EMP-03：出工中换能力后续跑主张' },
      },
    ])
    await tick(stack)

    const dispatches = eventsNamed(stack.ledger, ticket, 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    const second = dispatches[1]
    expect(second?.attempt).toBe(2)
    // ① 不得静默续跑：note 明报降级因（fake-work 能力位 session_resume=false），无续跑锚
    expect(second?.note ?? '').toContain('resume=降级新派（')
    expect(second?.note ?? '').not.toContain('（续自第 1 誓）')
    // ② 因果链仍挂上次工时单（F1-15：降级不因断链）
    expect(second?.causation_id).toBe(previous?.id)
    // ③ 新工位=新誓新会话（续跑同一会话≠恢复同一出工段）
    const records = stack.ledger.listWorkRecords({ issue: ticket })
    expect(records).toHaveLength(2)
    expect(records[1]?.attempt).toBe(2)
    expect(records[1]?.session_id).not.toBe(previousSession)
    // ④ 门面以真数据复判：能力位由 false 主张为 true＝实质变更→无重认→拒绝续跑
    const verdict = judgeSegmentContinuation({
      locked: { executor: previous?.executor ?? '', capabilityDigest: 'session_resume=false' },
      requested: { executor: records[1]?.executor ?? '', capabilityDigest: 'session_resume=true' },
      substantive: false,
    })
    expect(verdict.mode).toBe('requalification_required')
    expect(verdict.allowed).toBe(false)
  })
})
