// ▸ 落仓路径：packages/core/test/assign.test.ts（新文件，全文照抄）

/**
 * assign —— 自动派工分配器纯函数测试（轨2 R1 登记项①，studio-dev-345）
 *
 * 规格依据（实现单引用，规格单一源=studio-dev-345 att1 deliverables/plan.md §1）：
 *   - 部门过滤（跨部门不兜底）／在职过滤（undefined=active）／并发帽（<1 视同 1）；
 *   - 在途最小者优先；同级轮转=等在途并列集内 cursor 取位（序：level DESC, id ASC）；
 *   - 失败闭集四码 fail-closed；cursor 坏值视同 0；nextCursor 仅成功前进。
 */
import { describe, expect, it } from 'vitest'
import type { PersonRef } from '@studio-next/contract'
import { assignLimitOf, pickAssignee } from '../src/assign/assign.ts'

const DEPT = 'departments/工程部'

function person(id: string, o: { level?: number; dept?: string; status?: 'active' | 'paused' | 'retired' } = {}): PersonRef {
  return {
    id,
    name: id,
    login: id.toLowerCase(),
    level: o.level ?? 2,
    dept: o.dept ?? DEPT,
    ...(o.status !== undefined ? { status: o.status } : {}),
  }
}

const LIM = { defaultLimit: 1 }

describe('pickAssignee · 失败闭集（fail-closed）', () => {
  it('no-people：人事索引空', () => {
    expect(pickAssignee({ dept: DEPT, people: [], inflightByPerson: {}, limits: LIM })).toEqual({ ok: false, code: 'no-people' })
  })
  it('dept-empty：部门无人（跨部门不兜底）', () => {
    const r = pickAssignee({ dept: 'departments/综合部', people: [person('P-1')], inflightByPerson: {}, limits: LIM })
    expect(r).toEqual({ ok: false, code: 'dept-empty' })
  })
  it('no-active：部门有座皆不在职', () => {
    const people = [person('P-1', { status: 'paused' }), person('P-2', { status: 'retired' })]
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM })).toEqual({ ok: false, code: 'no-active' })
  })
  it('all-at-cap：全在帽下（缺省帽 1）', () => {
    const people = [person('P-1'), person('P-2')]
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: { 'P-1': 1, 'P-2': 1 }, limits: LIM })).toEqual({ ok: false, code: 'all-at-cap' })
  })
})

describe('pickAssignee · 三件套', () => {
  it('在职过滤：status undefined=active（契约语义）', () => {
    const people = [person('P-1'), person('P-2', { status: 'paused' })]
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM })
    expect(r).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 1 })
  })

  it('在途最小者优先：0 者胜 1 者（即便 1 者工号更小）', () => {
    const people = [person('P-1'), person('P-2')]
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: { 'P-1': 1, 'P-2': 0 }, limits: LIM })
    expect(r).toEqual({ ok: true, personId: 'P-2', nextCursor: 1, tieCount: 1 })
  })

  it('并发帽：在帽者不入选（帽=overrides 优先于缺省）', () => {
    const people = [person('P-1'), person('P-2')]
    // P-1 覆盖帽 2、在工 1 → 在帽下且并列最小；P-2 缺省帽 1、在工 1 → 在帽上出局
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: { 'P-1': 1, 'P-2': 1 }, limits: { overrides: { 'P-1': 2 } } })
    expect(r).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 1 })
  })

  it('同级轮转：等在途并列集内 cursor 取位（序 level DESC, id ASC）', () => {
    const people = [person('P-1'), person('P-2'), person('P-3')]
    // 并列集=[P-1,P-2]（level 同 2、id 升序）；P-3 不在（异在途）
    const inflight = { 'P-1': 0, 'P-2': 0, 'P-3': 2 }
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: inflight, limits: LIM, cursor: 0 })).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 2 })
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: inflight, limits: LIM, cursor: 1 })).toEqual({ ok: true, personId: 'P-2', nextCursor: 2, tieCount: 2 })
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: inflight, limits: LIM, cursor: 2 })).toEqual({ ok: true, personId: 'P-1', nextCursor: 3, tieCount: 2 }) // 环回
  })

  it('并列集内高等级在前（level DESC）——同级轮转不越级', () => {
    const people = [person('P-1', { level: 1 }), person('P-3', { level: 3 })]
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM, cursor: 0 })
    expect(r).toEqual({ ok: true, personId: 'P-3', nextCursor: 1, tieCount: 2 }) // 取 [P-3,P-1] 首位
    const r2 = pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM, cursor: 1 })
    expect(r2).toEqual({ ok: true, personId: 'P-1', nextCursor: 2, tieCount: 2 })
  })

  it('部门过滤精确到 path 全等（单据无 dept 由调用面回退，函数侧只认入参）', () => {
    const people = [person('P-1'), person('P-X', { dept: 'departments/综合部' })]
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: { 'P-X': 0 }, limits: LIM })
    expect(r).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 1 }) // P-X 在他部，不兜底也不被跨部选中
  })
})

describe('pickAssignee · 健壮面', () => {
  it('cursor 坏值（负数/非整数/缺省）视同 0——fail-closed 不猜', () => {
    const people = [person('P-1'), person('P-2')]
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM, cursor: -3 })).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 2 })
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM, cursor: 1.5 })).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 2 })
    expect(pickAssignee({ dept: DEPT, people, inflightByPerson: {}, limits: LIM })).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 2 })
  })

  it('inflight 缺项计 0', () => {
    const people = [person('P-1'), person('P-2')]
    const r = pickAssignee({ dept: DEPT, people, inflightByPerson: { 'P-2': 1 }, limits: LIM })
    expect(r).toEqual({ ok: true, personId: 'P-1', nextCursor: 1, tieCount: 1 })
  })
})

describe('assignLimitOf · 帽口径（与人闸同源）', () => {
  it('overrides > defaultLimit > 1；<1 视同 1；向下取整', () => {
    expect(assignLimitOf('P-1', { overrides: { 'P-1': 3 }, defaultLimit: 2 })).toBe(3)
    expect(assignLimitOf('P-1', { defaultLimit: 2 })).toBe(2)
    expect(assignLimitOf('P-1', {})).toBe(1)
    expect(assignLimitOf('P-1', { defaultLimit: 0 })).toBe(1) // fail-closed
    expect(assignLimitOf('P-1', { overrides: { 'P-1': -2 } })).toBe(1)
    expect(assignLimitOf('P-1', { defaultLimit: 2.9 })).toBe(2)
  })
})
