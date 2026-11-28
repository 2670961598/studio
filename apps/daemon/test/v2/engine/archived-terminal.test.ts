/**
 * archived-terminal —— task-158 / FIX-04 ③（Kimi 总审 P0-04）：Archived=可识别终态（归档）
 *
 * 依据：docs/quality/idempotent-closeout.md §3（Archived）/§5（测试面）；
 *       docs/sentinel-logs/全面Review拆分-2026-11-28.md §2.1 FIX-04 验收 ⑤；
 *       docs/quality/reviews/2026-11-28/00-overall-review.md §2.1 P0-04。
 * 现场（只读取证）：归档单被状态集巡逻报 UNKNOWN_STATE 共 7 次（哨兵误报），并可能被镜像重决策
 * /停摆面当作在途单处理。修法：decide 判 NOOP_ARCHIVED（归档终态，与 flow/单据终态同待，判定序
 * 先于状态集成员校验与停摆判定）；哨兵巡逻吸收 Archived；镜像重决策/复活扫描跳过。
 *
 * 断言面（V3 真栈）：零派发/零回退/零 RESUME/零 UNKNOWN_STATE 告警/零 ESCALATE；平台态不动。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createTicket, createWorkStack, disposeWorkStacks, eventsOf, issueOf, restartWorkStack, runTicks, tick, type WorkTestStack } from '../records/fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

function decisionsOf(reports: Awaited<ReturnType<typeof runTicks>>, ticket: string) {
  return reports.flatMap((r) => r.phases.stateDiff.decisions.filter((d) => d.ticket === ticket))
}
function collectsOf(reports: Awaited<ReturnType<typeof runTicks>>) {
  return reports.map((r) => r.phases.collect)
}

describe('T4 Archived 负测：归档单=终态——不重派、不回退、不报未知态', () => {
  it('建单即归档：连推 3 拍（含镜像重决策每拍）→ 决策恒 NOOP_ARCHIVED；零动作/零事件/零工时记录；巡逻零 UNKNOWN_STATE', async () => {
    const stack = await createWorkStack('fix04-t4-fresh')
    const ticket = await createTicket(stack, '归档单：零行为')
    await stack.platform.issues.transition(ticket, 'Archived') // 平台侧归档（活动流有 state-transition）
    const reports = await runTicks(stack, 3)
    // 首拍：归档迁移活动进决策（intent 键未消费）→ 判 NOOP_ARCHIVED；后续拍镜像重决策/复活扫描
    // 直接跳过归档单（不再进决策）——两段都是零行为
    const decisions = decisionsOf(reports, ticket)
    expect(decisions.length).toBeGreaterThanOrEqual(1)
    for (const d of decisions) expect(d).toMatchObject({ actionType: 'noop', code: 'NOOP_ARCHIVED', state: 'Archived' })
    expect(reports.flatMap((r) => r.actionResults).filter((r) => r.ticket === ticket)).toHaveLength(0)
    expect(reports.flatMap((r) => r.errors)).toHaveLength(0)
    expect(eventsOf(stack.ledger, ticket)).toHaveLength(0) // 无 DISPATCH/RESUME/GATE_FAIL/ESCALATE
    expect(stack.ledger.listWorkRecords({ issue: ticket })).toHaveLength(0)
    expect((await issueOf(stack, ticket)).state).toBe('Archived')
    for (const c of collectsOf(reports)) {
      expect(c.unknownStateAlarmed).toBe(0)
      expect(c.statusSetDrift).toBe(0)
    }
    // boot 孤儿扫描同待：非已派发态跳过，零写
    expect(await stack.engine.recoverOrphans()).toMatchObject({ scanned: 1, recovered: 0, duplicates: 0, failed: 0, skippedNotDispatched: 1 })
    expect(eventsOf(stack.ledger, ticket)).toHaveLength(0)
  })

  it('在途消亡单被平台归档（daemon 重启后）：决策先判 NOOP_ARCHIVED（停摆判定在其后）——零回退、零 GATE_FAIL、零 STALL 回退、不重派', async () => {
    const stack = await createWorkStack('fix04-t4-dead', { stallKillAfterAlarms: 1 })
    stack.mode.value = 'stalled'
    const ticket = await createTicket(stack, '在途消亡后被归档')
    await tick(stack)
    expect((await issueOf(stack, ticket)).state).toBe('已派发')
    await stack.engine.dispose()
    const restarted = restartWorkStack(stack, { stallKillAfterAlarms: 1 })
    await restarted.platform.issues.transition(ticket, 'Archived')
    restarted.clock.advance(61_000)
    const report = await tick(restarted)
    // 归档迁移活动进决策；该单活动 intent 键已被首派消费 → 幂等去重（第 1 步）先于归档判定（第 3a 步）：
    // 两路皆为 noop、零动作——归档单在任何判定序下都不重派
    const decisions = decisionsOf([report], ticket)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ actionType: 'noop', state: 'Archived' })
    expect(['NOOP_ARCHIVED', 'DEDUP_NOOP']).toContain(decisions[0]?.code)
    expect(eventsNamed(restarted, ticket, 'GATE_FAIL')).toHaveLength(0)
    expect(eventsNamed(restarted, ticket, 'STALL').filter((e) => (e.note ?? '').includes('rollback='))).toHaveLength(0)
    expect(eventsNamed(restarted, ticket, 'ESCALATE')).toHaveLength(0)
    expect(report.phases.collect.unknownStateAlarmed).toBe(0)
    expect(report.errors).toHaveLength(0)
    expect((await issueOf(restarted, ticket)).state).toBe('Archived')
    // 归档后不再重派：续推 5 拍（镜像重决策每拍）仍零 DISPATCH
    await runTicks(restarted, 5)
    expect(eventsNamed(restarted, ticket, 'DISPATCH')).toHaveLength(1)
    expect(eventsNamed(restarted, ticket, 'GATE_FAIL')).toHaveLength(0)
  })
})

function eventsNamed(stack: WorkTestStack, ticket: string, name: string) {
  return eventsOf(stack.ledger, ticket).filter((e) => e.event === name)
}
