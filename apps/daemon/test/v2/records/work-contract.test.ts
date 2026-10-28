/**
 * work-contract —— IMPL-06-02「engine 拆分·工作与判定域」V3 契约（NEG-WRK 纯 V3 三条）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-02（领土 `apps/daemon/test/v2/records/`；冻结验收「NEG-WRK 纯
 *     V3 3 条＋NEG-EMP-03；`bun run test:v2 -- apps/daemon/test/v2/records` 绿」）；
 *   - docs/v2/17 §一 V3（fake 只替代外部端口：fake 平台/执行体；内部决策、记录、事务、
 *     状态机真跑）；NEG 总表对应行：
 *     · NEG-WRK-02（04 §十二 W-02）**合同终止显式性**——「以新任务顶替失败，旧合同静默
 *       消失」预期拒绝＝显式终止锚缺→拒。本文件 §一：四要件不齐→GATE_FAIL 显式回滚锚
 *       （rollback=新单）＋失败工时收口；无 GATE_PASS/CLOSE 冒充；重试=新 attempt。
 *     · NEG-WRK-05（04 §十二 W-05）**时限三件套**——「无限返工/无限暂停」预期拒绝＝
 *       时限/阈值＋强制出口＋悬置缺→异常。本文件 §二：同签名连击达阈→ESCALATE＋自动
 *       开 bug 单（强制出口），熔断窗内 HOLD_BREAKER_OPEN 压制第四誓（返工有界）。
 *     · NEG-WRK-06（04 §十二 W-06）**静默恢复**——「叫停后未经恢复决定即续跑」预期拒绝＝
 *       恢复=新决定。本文件 §三：CLOSE 后「仅评论」不复活；平台态离开终态→RESUME 显式
 *       留痕（唯一复活门）→重进决策。
 *   - docs/v2/04 §五/§六/§十二（十态与边、完成判据、W 族负例）；docs/v2/07 §三（执行体/
 *     宿主事件不是迁移生产者：事件只是收割输入）；docs/v2/11 §5.2 REC-WORK-06（迁移由
 *     决定驱动）、REC-WORK-12（结清完整面）、§14.1 M-26..M-28。
 *
 * 断言纪律：只断言**拒绝面**（放行路径必须不存在），不以覆盖率数字充当负例；全部走
 * 真引擎＋真 SQLite 台账＋fake 平台/执行体（不 mock LLM、不重试、一次红即红）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  createTicket,
  createWorkStack,
  disposeWorkStacks,
  eventsNamed,
  issueOf,
  runTicks,
  tick,
} from './fixtures/work-stack.ts'

afterAll(async () => {
  await disposeWorkStacks()
})

describe('NEG-WRK-02 合同终止显式性：失败不得静默消失', () => {
  it('四要件不齐→GATE_FAIL 显式回滚（rollback=新单）＋失败工时收口；无 GATE_PASS/CLOSE；重试=新 attempt', async () => {
    const stack = await createWorkStack('wrk02')
    stack.mode.value = 'incomplete' // 终态 completed=false（四要件缺「终态」）
    const ticket = await createTicket(stack)
    await runTicks(stack, 2) // 派发 → 收割失败

    // ① 显式终止锚：GATE_FAIL note 携回滚目标（旧合同去向可见，不得静默消失）
    const gateFails = eventsNamed(stack.ledger, ticket, 'GATE_FAIL')
    expect(gateFails).toHaveLength(1)
    expect(gateFails[0]?.note ?? '').toContain('rollback=新单')
    // ② 失败不得冒充完成：无 GATE_PASS、无 CLOSE
    expect(eventsNamed(stack.ledger, ticket, 'GATE_PASS')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(0)
    // ③ 平台回首批位（显式状态证据）
    expect((await issueOf(stack, ticket)).state).toBe('新单')
    // ④ 旧誓工时收口为 failed（不得留 running 冒充仍在途）
    const records = stack.ledger.listWorkRecords({ issue: ticket })
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('failed')
    expect(typeof records[0]?.ended_at).toBe('number')

    // ⑤ 重试=新誓（attempt+1）而非把失败伪装成同一誓的续跑
    stack.mode.value = 'ok'
    await runTicks(stack, 2)
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH').map((e) => e.attempt)).toEqual([1, 2])
  })
})

describe('NEG-WRK-05 时限三件套：返工有界，达阈走强制出口', () => {
  it('同签名三连击达阈→CIRCUIT_BREAK 强制出口（ESCALATE＋自动 bug 单）；此后 HOLD_BREAKER_OPEN 压制第四誓', async () => {
    const stack = await createWorkStack('wrk05')
    stack.mode.value = 'incomplete'
    const ticket = await createTicket(stack)
    const reports = await runTicks(stack, 8)

    // ① 阈值面：同单同签名连击 3 次为限——第四次派发必须不存在（无限返工＝判负）
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(3)
    expect(eventsNamed(stack.ledger, ticket, 'GATE_FAIL')).toHaveLength(3)
    // ② 强制出口：熔断瞬间 ESCALATE（CIRCUIT_BREAK 冻结锚）＋自动开 bug 单恰一次
    const escalates = eventsNamed(stack.ledger, ticket, 'ESCALATE')
    expect(escalates.some((e) => (e.note ?? '').includes('CIRCUIT_BREAK'))).toBe(true)
    const bugs = stack.ledger.listTicketMirrors().filter((m) => m.type === 'bug' && m.issue !== ticket)
    expect(bugs).toHaveLength(1)
    // ③ 悬置归异常/升级：强制出口后的拍落 HOLD_BREAKER_OPEN（不是继续返工，也不是静默）
    const held = reports
      .flatMap((report) => report.phases.stateDiff.decisions)
      .filter((decision) => decision.ticket === ticket && decision.code === 'HOLD_BREAKER_OPEN')
    expect(held.length).toBeGreaterThanOrEqual(1)
  })
})

describe('NEG-WRK-06 静默恢复：复活须显式 RESUME 决定', () => {
  it('CLOSE 后仅评论→无 RESUME/无重派；平台态离开终态→RESUME 留痕且重进决策', async () => {
    const stack = await createWorkStack('wrk06')
    const ticket = await createTicket(stack)
    await runTicks(stack, 8)
    expect(eventsNamed(stack.ledger, ticket, 'CLOSE')).toHaveLength(1)
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(1)

    // ① 「叫停」（CLOSE 关单收口）后仅评论：评论不是恢复决定——不得 RESUME、不得重派
    await stack.platform.comments.add(ticket, { author: 'AGENT-1', body: '评论一句（无决定）', signature: '' })
    const commentTick = await tick(stack)
    expect(commentTick.phases.stateDiff.reopened).toBe(0)
    expect(eventsNamed(stack.ledger, ticket, 'RESUME')).toHaveLength(0)
    expect(eventsNamed(stack.ledger, ticket, 'DISPATCH')).toHaveLength(1)

    // ② 平台侧复活（态离开终态）＝唯一复活门：RESUME 显式落账后才重进决策
    await stack.platform.issues.transition(ticket, '新单')
    const revivedTick = await tick(stack)
    const resume = eventsNamed(stack.ledger, ticket, 'RESUME')
    expect(resume).toHaveLength(1)
    expect(resume[0]?.note ?? '').toContain('复活：closed 单离开终态')
    expect(revivedTick.phases.stateDiff.reopened).toBe(1)
    // ③ 恢复=新决定后的重进：第二誓（attempt+1）显式派发，不是静默续跑
    const dispatches = eventsNamed(stack.ledger, ticket, 'DISPATCH')
    expect(dispatches.length).toBeGreaterThanOrEqual(2)
    expect(dispatches[1]?.attempt).toBe(2)
  })
})
