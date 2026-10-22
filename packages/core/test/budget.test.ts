/**
 * budget 预算链测试 —— 16-§三 预算行 / 20-§六.8 / F1-09：折叠三态全路径 /
 * 重复预留拒 / 超帽 refusal 落行与再试语义（拟稿：不封死）/ settle 冲销
 * （多预留单结·部分冲销）/ 无预留可结拒 / 幂等重放 / 操作态≡折叠不变律 /
 * estimateCost 集成（价目表驱动预留额）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, Money } from '@studio-next/contract'
import {
  BUDGET_PERSON_SUFFIX,
  BUDGET_REFUSAL_SUFFIX,
  budgetView,
  emptyBudgetLedger,
  foldBudgets,
  reserve,
  settle,
  type BudgetLedgerState,
  type BudgetRow,
  type ReserveInput,
} from '../src/budget.ts'
import { createModelCatalog, type ModelsConfig } from '../src/models.ts'

const usd = (n: number): Money => ({ usd: n })
const T0 = Date.parse('2026-10-16T00:00:00.000Z')

/** 断言抛 CONFIG_INVALID 并返回错误（同 models.test.ts 手法） */
function expectConfigInvalid(fn: () => unknown, subcause?: string): Error & ClassifiedError {
  try {
    fn()
  } catch (err) {
    const e = err as Error & ClassifiedError
    expect(e.category).toBe('CONFIG_INVALID')
    if (subcause !== undefined) expect(e.subcause).toBe(subcause)
    return e
  }
  throw new Error('应抛 CONFIG_INVALID 但未抛')
}

/** 预留入参装配（exactOptionalPropertyTypes：可选帽按需展开） */
function rsvInput(o: Partial<ReserveInput> & { id: string; ticket: string; person: string }): ReserveInput {
  return {
    id: o.id,
    ticket: o.ticket,
    person: o.person,
    estimated: o.estimated ?? usd(10),
    ...(o.ticketCap !== undefined ? { ticketCap: o.ticketCap } : {}),
    ...(o.personCap !== undefined ? { personCap: o.personCap } : {}),
    ...(o.personDay !== undefined ? { personDay: o.personDay } : {}), // 闸四·人日硬线（132-§6.4 单C）
    now: o.now ?? T0,
  }
}

// ---------------------------------------------------------------------------
// 折叠：三态全路径
// ---------------------------------------------------------------------------

describe('foldBudgets：三态折叠全路径', () => {
  it('空流 → 空视图 + 空桥', () => {
    const s = foldBudgets([])
    expect(s.views.size).toBe(0)
    expect(s.reserverOf.size).toBe(0)
  })

  it('reserve 行 → reserved 计入', () => {
    const s = foldBudgets([{ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 10, ts: T0 }])
    expect(budgetView(s, 'issue', 'T-1')).toEqual({ reserved: 10, settled: 0, refused: 0 })
  })

  it('reserve + settle（带冲销额与实际成本）→ 冲销并记账', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 10, ts: T0 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', estimated_usd: 10, actual_usd: 7.5, ts: T0 + 1 },
    ])
    expect(budgetView(s, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 7.5, refused: 0 })
  })

  it('settle 缺省冲销额 = 冲销全部在途（多预留单结：两笔一并冲）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 5, ts: T0 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 7, ts: T0 + 1 },
      { id: 'c', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', actual_usd: 6, ts: T0 + 2 },
    ])
    expect(budgetView(s, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 6, refused: 0 })
  })

  it('refusal 行 → refused 计入、reserved 不动（只记录不封死）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'refusal', estimated_usd: 12, ts: T0 },
    ])
    expect(budgetView(s, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 0, refused: 12 })
  })

  it('部分冲销：settle 冲销额 < 在途 → 余额留存', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 10, ts: T0 },
      { id: 'b', scope_kind: 'person', scope_id: 'P-1', kind: 'settle', estimated_usd: 4, actual_usd: 3, ts: T0 + 1 },
    ])
    expect(budgetView(s, 'person', 'P-1')).toEqual({ reserved: 6, settled: 3, refused: 0 })
  })

  it('冲销额 > 在途 → 下限 0（防御，不产生负预留）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 4, ts: T0 },
      { id: 'b', scope_kind: 'person', scope_id: 'P-1', kind: 'settle', estimated_usd: 10, actual_usd: 3, ts: T0 + 1 },
    ])
    expect(budgetView(s, 'person', 'P-1').reserved).toBe(0)
  })

  it('settle 缺 actual → settled +0（外来行兼容；只冲销）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 10, ts: T0 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', estimated_usd: 10, ts: T0 + 1 },
    ])
    expect(budgetView(s, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 0, refused: 0 })
  })

  it('issue / person / company 三档各自独立聚合（scope 泛化）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
      { id: 'a#p', scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
      { id: 'c', scope_kind: 'company', scope_id: 'acme', kind: 'reserve', estimated_usd: 8, ts: T0 },
    ])
    expect(budgetView(s, 'issue', 'T-1').reserved).toBe(3)
    expect(budgetView(s, 'person', 'P-1').reserved).toBe(3)
    expect(budgetView(s, 'company', 'acme').reserved).toBe(8)
  })

  it('无记录的主体 → 零视图（不进 state 的只读查询面）', () => {
    expect(budgetView(emptyBudgetLedger(), 'issue', 'T-9')).toEqual({ reserved: 0, settled: 0, refused: 0 })
  })

  it('桥重建：issue 行 id=X 与 person 行 id=X#p 配对 → reserverOf[T]=P', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
      { id: `a${BUDGET_PERSON_SUFFIX}`, scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
    ])
    expect(s.reserverOf.get('T-1')).toBe('P-1')
  })

  it('桥消费：settle 行后桥删（未结预留清零，桥失效）', () => {
    const s = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
      { id: `a${BUDGET_PERSON_SUFFIX}`, scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 3, ts: T0 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', estimated_usd: 3, actual_usd: 2, ts: T0 + 1 },
    ])
    expect(s.reserverOf.has('T-1')).toBe(false)
  })

  it('幂等重放：同行流重折叠 → 视图与桥全等', () => {
    const rows: BudgetRow[] = [
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 5, ts: T0 },
      { id: `a${BUDGET_PERSON_SUFFIX}`, scope_kind: 'person', scope_id: 'P-1', kind: 'reserve', estimated_usd: 5, ts: T0 },
      { id: 'r', scope_kind: 'issue', scope_id: 'T-2', kind: 'refusal', estimated_usd: 99, ts: T0 + 1 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', estimated_usd: 5, actual_usd: 4, ts: T0 + 2 },
      { id: `b${BUDGET_PERSON_SUFFIX}`, scope_kind: 'person', scope_id: 'P-1', kind: 'settle', estimated_usd: 5, actual_usd: 4, ts: T0 + 2 },
    ]
    const s1 = foldBudgets(rows)
    const s2 = foldBudgets(rows)
    expect(s1.views).toEqual(s2.views)
    expect(s1.reserverOf).toEqual(s2.reserverOf)
  })

  it('坏行拒收：未知 scope_kind / kind / NaN 金额 → CONFIG_INVALID', () => {
    expectConfigInvalid(
      () => foldBudgets([{ id: 'a', scope_kind: 'dept', scope_id: 'x', kind: 'reserve', ts: T0 } as unknown as BudgetRow]),
      'budget/fold:bad-scope-kind',
    )
    expectConfigInvalid(
      () => foldBudgets([{ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'refund', ts: T0 } as unknown as BudgetRow]),
      'budget/fold:bad-kind',
    )
    expectConfigInvalid(
      () => foldBudgets([{ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: Number.NaN, ts: T0 }]),
      'budget/fold:bad-estimated',
    )
  })
})

// ---------------------------------------------------------------------------
// 不变律：操作态 ≡ 发出行流的折叠（预算链的可重放根基）
// ---------------------------------------------------------------------------

describe('不变律：操作链终态 ≡ 发出行流重折叠', () => {
  it('reserve→settle 链：折叠全部发出行复现操作终态（视图+桥）', () => {
    let state = emptyBudgetLedger()
    const emitted: BudgetRow[] = []
    const r1 = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(5) }))
    if (!r1.ok) throw new Error('首预留应成功')
    state = r1.newState
    emitted.push(...r1.rows)
    const r2 = reserve(state, rsvInput({ id: 'b', ticket: 'T-2', person: 'P-1', estimated: usd(7), personCap: usd(20) }))
    if (!r2.ok) throw new Error('二预留应成功')
    state = r2.newState
    emitted.push(...r2.rows)
    const st = settle(state, { id: 'c', ticket: 'T-1', actual: usd(4), now: T0 + 2 })
    state = st.newState
    emitted.push(...st.rows)

    const replayed = foldBudgets(emitted)
    expect(replayed.views).toEqual(state.views)
    expect(replayed.reserverOf).toEqual(state.reserverOf)
  })

  it('含 refusal 的全链（拒→低估算再试→结）重放同结果', () => {
    let state = emptyBudgetLedger()
    const emitted: BudgetRow[] = []
    const r1 = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(12), personCap: usd(10) }))
    if (r1.ok) throw new Error('超帽应拒')
    state = r1.newState
    emitted.push(r1.refusal)
    const r2 = reserve(state, rsvInput({ id: 'b', ticket: 'T-1', person: 'P-1', estimated: usd(8), personCap: usd(10) }))
    if (!r2.ok) throw new Error('低估算应过闸')
    state = r2.newState
    emitted.push(...r2.rows)
    const st = settle(state, { id: 'd', ticket: 'T-1', actual: usd(6), now: T0 + 3 })
    state = st.newState
    emitted.push(...st.rows)

    const replayed = foldBudgets(emitted)
    expect(replayed.views).toEqual(state.views)
    expect(replayed.reserverOf).toEqual(state.reserverOf)
    // 三态齐备：拒过、留过、结过
    expect(budgetView(replayed, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 6, refused: 12 })
  })
})

// ---------------------------------------------------------------------------
// reserve：判定面（20-§六.8 预留不落即不派）
// ---------------------------------------------------------------------------

describe('reserve：成功路径与不可变性', () => {
  it('首次预留：双行（issue+person，id 派生 #p）、两视图计入、桥建立', () => {
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(5), now: T0 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [issueRow, personRow] = r.rows
    expect(issueRow).toEqual({ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 5, ts: T0 })
    expect(personRow).toEqual({
      id: `a${BUDGET_PERSON_SUFFIX}`,
      scope_kind: 'person',
      scope_id: 'P-1',
      kind: 'reserve',
      estimated_usd: 5,
      ts: T0,
    })
    expect(budgetView(r.newState, 'issue', 'T-1').reserved).toBe(5)
    expect(budgetView(r.newState, 'person', 'P-1').reserved).toBe(5)
    expect(r.newState.reserverOf.get('T-1')).toBe('P-1')
  })

  it('不可变更新：原 state 视图与桥不被改动', () => {
    const before = emptyBudgetLedger()
    const r = reserve(before, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1' }))
    expect(r.ok).toBe(true)
    expect(before.views.size).toBe(0)
    expect(before.reserverOf.size).toBe(0)
    expect(r.newState).not.toBe(before)
  })
})

describe('reserve：重复预留拒（同票已有未结预留）', () => {
  it('未结在 → 拒 duplicate，无新账行，newState 原引用', () => {
    const r1 = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1' }))
    if (!r1.ok) throw new Error('首预留应成功')
    const r2 = reserve(r1.newState, rsvInput({ id: 'b', ticket: 'T-1', person: 'P-1', estimated: usd(3) }))
    expect(r2).toMatchObject({ ok: false, reason: 'duplicate' })
    if (r2.ok) return
    expect(r2.newState).toBe(r1.newState)
  })

  it('settle 后同票再预留不算重复（二段尝试）', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(5) })).newState
    state = settle(state, { id: 'b', ticket: 'T-1', actual: usd(4), now: T0 + 1 }).newState
    const r3 = reserve(state, rsvInput({ id: 'c', ticket: 'T-1', person: 'P-1', estimated: usd(2) }))
    expect(r3.ok).toBe(true)
  })

  it('refusal 不是预留：拒后同票 reserve 不算 duplicate', () => {
    let state = emptyBudgetLedger()
    const refused = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', personCap: usd(1) }))
    if (refused.ok) throw new Error('应超帽拒')
    state = refused.newState
    const r2 = reserve(state, rsvInput({ id: 'b', ticket: 'T-1', person: 'P-1', estimated: usd(0.5), personCap: usd(1) }))
    expect(r2.ok).toBe(true)
  })
})

describe('reserve：超帽 refusal（refusal 也是一条账）', () => {
  it('票级帽超 → refusal 行落形（id+#r / issue 档 / estimated）且 refused 计入、reserved 不动', () => {
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(12), ticketCap: usd(10) }))
    expect(r).toMatchObject({ ok: false, reason: 'over-ticket-cap', cap: usd(10), inflight: 0, estimated: usd(12) })
    if (r.ok) return
    expect(r.refusal).toEqual({
      id: `a${BUDGET_REFUSAL_SUFFIX}`,
      scope_kind: 'issue',
      scope_id: 'T-1',
      kind: 'refusal',
      estimated_usd: 12,
      ts: T0,
    })
    expect(budgetView(r.newState, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 0, refused: 12 })
  })

  it('票级帽边界：在途+估算 == 帽 → 通过（严格大于才拒）', () => {
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(10), ticketCap: usd(10) }))
    expect(r.ok).toBe(true)
  })

  it('岗级帽按人聚合：他票在途吃掉额度 → 拒 over-person-cap，inflight=跨票合计', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(4) })).newState
    const r2 = reserve(state, rsvInput({ id: 'b', ticket: 'T-2', person: 'P-1', estimated: usd(8), personCap: usd(10) }))
    expect(r2).toMatchObject({ ok: false, reason: 'over-person-cap', inflight: 4 })
  })

  it('岗级帽边界：他票 4 + 本次 6 == 帽 10 → 通过', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(4) })).newState
    const r2 = reserve(state, rsvInput({ id: 'b', ticket: 'T-2', person: 'P-1', estimated: usd(6), personCap: usd(10) }))
    expect(r2.ok).toBe(true)
  })

  it('双帽同超 → reason 冻结为 over-ticket-cap（判定顺序：重复→票帽→人帽）', () => {
    const r = reserve(
      emptyBudgetLedger(),
      rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(99), ticketCap: usd(10), personCap: usd(10) }),
    )
    expect(r).toMatchObject({ ok: false, reason: 'over-ticket-cap' })
  })

  it('refusal 不封死（拟稿待批）：超帽拒后同票更低估算再试成功', () => {
    let state = emptyBudgetLedger()
    const refused = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(12), personCap: usd(10) }))
    if (refused.ok) throw new Error('应超帽拒')
    state = refused.newState
    const retry = reserve(state, rsvInput({ id: 'b', ticket: 'T-1', person: 'P-1', estimated: usd(9), personCap: usd(10) }))
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    // refused 留痕（可查），reserved 记本次
    expect(budgetView(retry.newState, 'issue', 'T-1')).toEqual({ reserved: 9, settled: 0, refused: 12 })
  })

  it('无帽 → 不设限（调用方责任；daemon 至少传一帽）', () => {
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(1e9) }))
    expect(r.ok).toBe(true)
  })
})

describe('reserve：闸四·人日硬线（132-§6.4 单C R6，studio-dev-177）', () => {
  it('已结实际+跨票在途+估算 > hard 线 → 拒 over-person-cap，inflight=spent+reserved 合计', () => {
    const r = reserve(
      emptyBudgetLedger(),
      rsvInput({
        id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(2),
        personDay: { spentUsd: 8.5, capUsd: 10 }, // 8.5 已结 + 0 在途 + 2 估算 = 10.5 > 10
      }),
    )
    expect(r).toMatchObject({ ok: false, reason: 'over-person-cap', cap: usd(10), inflight: 8.5 })
  })

  it('已结实际+跨票在途+估算 == hard 线 → 通过（严格大于才拒）', () => {
    const r = reserve(
      emptyBudgetLedger(),
      rsvInput({ id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(1.5), personDay: { spentUsd: 8.5, capUsd: 10 } }),
    )
    expect(r.ok).toBe(true)
  })

  it('在途计入：他票未结预留吃掉日额度（spent 5 + reserved 4 + est 2 > 10 → 拒）', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(4) })).newState
    const r = reserve(
      state,
      rsvInput({ id: 'b', ticket: 'T-2', person: 'P-1', estimated: usd(2), personDay: { spentUsd: 5, capUsd: 10 } }),
    )
    expect(r).toMatchObject({ ok: false, reason: 'over-person-cap', inflight: 9 }) // 5 已结 + 4 在途
  })

  it('闸序冻结：票帽+人日同超 → over-ticket-cap 先判（四闸序不动）', () => {
    const r = reserve(
      emptyBudgetLedger(),
      rsvInput({
        id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(99),
        ticketCap: usd(10), personDay: { spentUsd: 0, capUsd: 10 },
      }),
    )
    expect(r).toMatchObject({ ok: false, reason: 'over-ticket-cap' })
  })

  it('人帽通过而人日拒：三帽并存时日线独立生效', () => {
    const r = reserve(
      emptyBudgetLedger(),
      rsvInput({
        id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(2),
        personCap: usd(100), personDay: { spentUsd: 9, capUsd: 10 },
      }),
    )
    expect(r).toMatchObject({ ok: false, reason: 'over-person-cap', cap: usd(10) })
  })

  it('缺席=不判（cost_guard 段未声明/无 gate 档 → 面恒关）', () => {
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(1e9) }))
    expect(r.ok).toBe(true)
  })

  it('入参闸：spentUsd/capUsd 负数或非有限 → CONFIG_INVALID', () => {
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(1), personDay: { spentUsd: -1, capUsd: 10 } })),
      'budget/reserve:bad-person-day',
    )
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-9', person: 'P-1', estimated: usd(1), personDay: { spentUsd: 1, capUsd: Number.NaN } })),
      'budget/reserve:bad-person-day',
    )
  })
})

describe('reserve：入参闸（CONFIG_INVALID）', () => {
  it('负估算拒', () => {
    expectConfigInvalid(() => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(-1) })), 'budget/reserve:bad-estimated')
  })

  it('NaN/Infinity 估算拒（防 NaN 毒化台账）', () => {
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: { usd: Number.NaN } })),
      'budget/reserve:bad-estimated',
    )
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: { usd: Number.POSITIVE_INFINITY } })),
      'budget/reserve:bad-estimated',
    )
  })

  it('id 含保留后缀拒（#p/#r 是双行派生约定，不得撞车）', () => {
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: `a${BUDGET_PERSON_SUFFIX}`, ticket: 'T-1', person: 'P-1' })),
      'budget/reserve:bad-id',
    )
    expectConfigInvalid(
      () => reserve(emptyBudgetLedger(), rsvInput({ id: `a${BUDGET_REFUSAL_SUFFIX}`, ticket: 'T-1', person: 'P-1' })),
      'budget/reserve:bad-id',
    )
  })

  it('空单号/负时钟拒', () => {
    expectConfigInvalid(() => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: '', person: 'P-1' })), 'budget/reserve:bad-ticket')
    expectConfigInvalid(() => reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', now: -1 })), 'budget/reserve:bad-now')
  })
})

// ---------------------------------------------------------------------------
// settle：冲销正确性
// ---------------------------------------------------------------------------

describe('settle：冲销与记账', () => {
  function stateWithTwoTickets(): { state: BudgetLedgerState } {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: usd(5) })).newState
    state = reserve(state, rsvInput({ id: 'b', ticket: 'T-2', person: 'P-1', estimated: usd(3) })).newState
    return { state }
  }

  it('常规结算：released=该票全部在途；票视图清零入账；人池按额冲销（他票留存）；桥删', () => {
    const { state } = stateWithTwoTickets()
    const st = settle(state, { id: 'c', ticket: 'T-1', actual: usd(4), now: T0 + 1 })
    expect(st.ok).toBe(true)
    expect(st.released).toBe(5)
    expect(budgetView(st.newState, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 4, refused: 0 })
    // 人池部分冲销：5 冲掉、T-2 的 3 留存；actual 计入人档 settled（rollup 行源）
    expect(budgetView(st.newState, 'person', 'P-1')).toEqual({ reserved: 3, settled: 4, refused: 0 })
    expect(st.newState.reserverOf.has('T-1')).toBe(false)
    expect(st.newState.reserverOf.get('T-2')).toBe('P-1')
    // 双行落账形状
    expect(st.rows).toHaveLength(2)
    expect(st.rows[0]).toEqual({ id: 'c', scope_kind: 'issue', scope_id: 'T-1', kind: 'settle', estimated_usd: 5, actual_usd: 4, ts: T0 + 1 })
    expect(st.rows[1]).toMatchObject({ id: `c${BUDGET_PERSON_SUFFIX}`, scope_kind: 'person', scope_id: 'P-1', kind: 'settle' })
  })

  it('多预留单结：折叠态（外来流两笔未结）一次 settle 全冲', () => {
    // 操作面挡重复，但历史/外来行流可能含多笔未结——settle 冲销全部（任务书语义）
    const state = foldBudgets([
      { id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 5, ts: T0 },
      { id: 'b', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 7, ts: T0 + 1 },
    ])
    const st = settle(state, { id: 'c', ticket: 'T-1', actual: usd(6), now: T0 + 2 })
    expect(st.released).toBe(12)
    expect(budgetView(st.newState, 'issue', 'T-1')).toEqual({ reserved: 0, settled: 6, refused: 0 })
  })

  it('无预留可结 → CONFIG_INVALID（结算必须先有预留）', () => {
    expectConfigInvalid(() => settle(emptyBudgetLedger(), { id: 'c', ticket: 'T-1', actual: usd(1), now: T0 }), 'budget/settle:no-reserve')
  })

  it('只有 refusal 史的票结算同样拒（refusal 不是预留）', () => {
    const state = foldBudgets([{ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'refusal', estimated_usd: 12, ts: T0 }])
    expectConfigInvalid(() => settle(state, { id: 'c', ticket: 'T-1', actual: usd(1), now: T0 + 1 }), 'budget/settle:no-reserve')
  })

  it('二次结算（已结清）拒', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1' })).newState
    state = settle(state, { id: 'b', ticket: 'T-1', actual: usd(4), now: T0 + 1 }).newState
    expectConfigInvalid(() => settle(state, { id: 'c', ticket: 'T-1', actual: usd(1), now: T0 + 2 }), 'budget/settle:no-reserve')
  })

  it('外来流折叠态无桥（无 #p 配对）→ settle 只落票档行，不猜人', () => {
    const state = foldBudgets([{ id: 'a', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 5, ts: T0 }])
    const st = settle(state, { id: 'c', ticket: 'T-1', actual: usd(4), now: T0 + 1 })
    expect(st.rows).toHaveLength(1)
    expect(st.rows[0]?.scope_kind).toBe('issue')
  })

  it('负 actual 拒', () => {
    let state = emptyBudgetLedger()
    state = reserve(state, rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1' })).newState
    expectConfigInvalid(() => settle(state, { id: 'c', ticket: 'T-1', actual: usd(-2), now: T0 + 1 }), 'budget/settle:bad-actual')
  })

  it('不可变更新：settle 不改原 state', () => {
    const { state } = stateWithTwoTickets()
    const snapshot = budgetView(state, 'person', 'P-1')
    settle(state, { id: 'c', ticket: 'T-1', actual: usd(4), now: T0 + 1 })
    expect(budgetView(state, 'person', 'P-1')).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// estimateCost 集成：价目表驱动预留额（models.ts → budget.ts 链）
// ---------------------------------------------------------------------------

describe('estimateCost 集成（价目表驱动预留）', () => {
  const config: ModelsConfig = {
    tiers: {
      high: { provider: 'anthropic', model: 'm1', price: { inputPerM: 3, outputPerM: 15 } },
      mid: { provider: 'anthropic', model: 'm2', price: { inputPerM: 1, outputPerM: 5 } },
      low: { provider: 'anthropic', model: 'm3', price: { inputPerM: 0.25, outputPerM: 1 } },
    },
    roles: { main_worker: 'high', verifier: 'mid', summarizer: 'low' },
  }

  it('预留额=价目表折算：tokens(1M in, 250k out)@high → 3+3.75=6.75 美元入账行', () => {
    const catalog = createModelCatalog(config)
    const estimated = catalog.estimateCost({ input: 1_000_000, output: 250_000 }, 'high')
    expect(estimated.usd).toBe(6.75) // 双精度直算口径（models.ts 冻结）
    const r = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rows[0]?.estimated_usd).toBe(6.75)
  })

  it('同一估算过帽/过闸分岔：帽 6 拒（refusal 记 6.75）、帽 7 过', () => {
    const catalog = createModelCatalog(config)
    const estimated = catalog.estimateCost({ input: 1_000_000, output: 250_000 }, 'high')
    const refused = reserve(emptyBudgetLedger(), rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated, personCap: usd(6) }))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.refusal.estimated_usd).toBe(6.75)
    const ok = reserve(emptyBudgetLedger(), rsvInput({ id: 'b', ticket: 'T-1', person: 'P-1', estimated, personCap: usd(7) }))
    expect(ok.ok).toBe(true)
  })

  it('结算实际成本=实测 tokens 折算：人档 settled 累计（每成功交付记账）', () => {
    const catalog = createModelCatalog(config)
    let state = emptyBudgetLedger()
    state = reserve(
      state,
      rsvInput({ id: 'a', ticket: 'T-1', person: 'P-1', estimated: catalog.estimateCost({ input: 1_000_000, output: 250_000 }, 'high') }),
    ).newState
    const actual = catalog.estimateCost({ input: 600_000, output: 100_000 }, 'high') // 1.8+1.5=3.3
    expect(actual.usd).toBe(3.3)
    state = settle(state, { id: 'b', ticket: 'T-1', actual, now: T0 + 1 }).newState
    expect(budgetView(state, 'issue', 'T-1').settled).toBe(3.3)
    expect(budgetView(state, 'person', 'P-1').settled).toBe(3.3)
  })
})
