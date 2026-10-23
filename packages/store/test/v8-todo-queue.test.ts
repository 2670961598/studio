/**
 * v8 测试（129-§6.2-R2，studio-dev-167 单B）：todo_queue 投影面 + ticket_mirror.assignee。
 *
 * 覆盖：建库即 v8 / replaceTodoQueue 全量重投语义（跨公司隔离 + 单事务整换 + 坏行整批拒）
 * / listTodoQueue 行序与 company 维 / recentDispatchWaitsMs note `wait=` 锚解析（有锚取值、
 * 无锚跳过、limit 截断）/ mirror assignee 列往返（可空兼容——旧行无指派不炸）。
 * 环境：os.tmpdir() 真文件库（沿 v7 测试风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '../src/index.ts'
import { makeUlid } from './ulid.ts'

let root = ''
let ledger: Ledger

const T0 = 1_792_108_860_000

/** 合法投影行最小件（replaceTodoQueue 入参=unknown[]：形状闸在 store 层 zod） */
function makeRow(patch: Record<string, unknown> = {}) {
  return {
    company: 'demo',
    ticket: 'T-1',
    person: 'P-1',
    priority: 1,
    pinned: 0,
    boost_tier: 0,
    first_seen_at: T0,
    ready_state: 'ready' as const,
    updated_at: T0 + 1000,
    ...patch,
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v8-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('建库即 v8（todo_queue 表 + idx_todo_queue_person）', () => {
  it('version=8、表与索引在库', () => {
    expect(ledger.version()).toBe(13)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(tables).toContain('todo_queue')
    const indexes = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_todo%' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(indexes).toEqual(['idx_todo_queue_person'])
  })
})

describe('replaceTodoQueue：全量重投语义（可重建投影非事实源）', () => {
  it('首次落行 → 同公司整换（旧行清、新行落）→ 他公司不受波及（跨公司隔离）', () => {
    expect(ledger.replaceTodoQueue('demo', [makeRow(), makeRow({ ticket: 'T-2', person: 'P-2', priority: 3, boost_tier: 2, first_seen_at: T0 + 500 })])).toBe(2)
    // 整换：T-1 出、T-3 进；T-2 保留（在新集合里）
    expect(
      ledger.replaceTodoQueue('demo', [
        makeRow({ ticket: 'T-2', person: 'P-2', priority: 3, boost_tier: 2, first_seen_at: T0 + 500 }),
        makeRow({ ticket: 'T-3', person: 'P-1', ready_state: 'awaiting_approval' }),
      ]),
    ).toBe(2)
    expect(ledger.listTodoQueue('demo').map((r) => r.ticket)).toEqual(['T-3', 'T-2']) // 行序 person→first_seen_at→ticket：P-1(T-3) 先于 P-2(T-2)
    // 他公司（行 company 须与目标一致——跨维写入拒）
    expect(ledger.replaceTodoQueue('acme', [makeRow({ company: 'acme', ticket: 'A-1' })])).toBe(1)
    expect(ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-9' })])).toBe(1)
    expect(ledger.listTodoQueue('acme').map((r) => r.ticket)).toEqual(['A-1']) // demo 整换不波及 acme
  })

  it('空行集=清空该公司投影（成员全出队时的全量重投）', () => {
    expect(ledger.replaceTodoQueue('acme', [])).toBe(0)
    expect(ledger.listTodoQueue('acme')).toEqual([])
  })

  it('坏行整批拒（值域外 boost_tier=3 → CONFIG_INVALID，事务回滚零落行）', () => {
    const before = ledger.listTodoQueue('demo').length
    expect(() => ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-4' }), makeRow({ ticket: 'T-5', boost_tier: 3 })])).toThrow()
    expect(ledger.listTodoQueue('demo').length).toBe(before) // 整批拒：T-4 也未落
    expect(() => ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-6', priority: 4 })])).toThrow()
    expect(() => ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-7', ready_state: 'paused' })])).toThrow()
    // 跨维写入拒：行 company 与重投目标不一致
    expect(() => ledger.replaceTodoQueue('demo', [makeRow({ company: 'acme', ticket: 'T-8' })])).toThrow()
  })

  it('可空列缺省往返：last_boost_at/why 不带 → 读面 undefined；带 → 原样', () => {
    ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-8' })])
    const row = ledger.listTodoQueue('demo').find((r) => r.ticket === 'T-8')
    expect(row).toBeDefined()
    expect(row?.last_boost_at).toBeUndefined()
    expect(row?.why).toBeUndefined()
    expect(row?.pinned).toBe(0)
    ledger.replaceTodoQueue('demo', [
      makeRow({ ticket: 'T-8', boost_tier: 2, last_boost_at: T0 + 7_200_000, pinned: 1, why: 'poll|ticket' }),
    ])
    const boosted = ledger.listTodoQueue('demo').find((r) => r.ticket === 'T-8')
    expect(boosted).toMatchObject({ boost_tier: 2, last_boost_at: T0 + 7_200_000, pinned: 1, why: 'poll|ticket' })
  })

  it('listTodoQueue 无参=全库读面（company 升序领头）', () => {
    ledger.replaceTodoQueue('demo', [makeRow({ ticket: 'T-8' })])
    const all = ledger.listTodoQueue()
    expect(all.map((r) => `${r.company}/${r.ticket}`)).toEqual(['demo/T-8'])
  })
})

describe('recentDispatchWaitsMs：DISPATCH note wait= 锚解析（schedule-to-start 观测面）', () => {
  it('取近 N 条 DISPATCH 的 wait= 值（ts 倒序取、升序不要求）；无锚跳过、limit 截断', () => {
    const base = { company: 'wait-co', issue: 'T-100', actor: 'AGENT-1:agent-1', attempt: 1, level: 3, dept: 'departments/研发部', tokens: { input: 10, output: 5 } }
    let seq = 0
    const mk = (patch: Record<string, unknown> = {}) => {
      seq += 1
      const ts = T0 + seq * 1000
      return { id: makeUlid(ts), ts, event: 'DISPATCH', ...base, ...patch }
    }
    ledger.appendEvent(mk({ note: 'dispatch ok;wait=1200;prio=1;boost=0' }))
    ledger.appendEvent(mk({ note: 'dispatch ok;wait=300;prio=2;boost=1' }))
    ledger.appendEvent(mk({ note: '旧格式事件无 wait 锚' }))
    ledger.appendEvent(mk({ event: 'ESCALATE', note: ';wait=999 非派发面不计' }))
    ledger.appendEvent(mk({ note: 'dispatch ok;wait=900;prio=1;boost=2' }))

    // ts 倒序取 DISPATCH：900（最新）→无锚(seq3)→300→1200；无锚行占 limit 位但产出跳过；ESCALATE 不入面
    expect(ledger.recentDispatchWaitsMs('wait-co', 10)).toEqual([900, 300, 1200])
    expect(ledger.recentDispatchWaitsMs('wait-co', 2)).toEqual([900]) // 第 2 位被无锚行吃掉（limit=原始行位非产出数）
    expect(ledger.recentDispatchWaitsMs('wait-co', 3)).toEqual([900, 300])
    expect(ledger.recentDispatchWaitsMs('other-co', 10)).toEqual([]) // 公司维隔离
  })
})

describe('ticket_mirror.assignee（v8 增列）', () => {
  it('upsert→读面往返；覆盖写 last-write-wins；旧行无指派可空兼容', () => {
    const base = { issue: 'M-1', company: 'demo', created: T0, updated: T0, state: '新单', type: 'task', dept: 'eng', level: 1, dispatcher: 'P-0' }
    ledger.upsertTicketMirror({ ...base })
    expect(ledger.getTicketMirror('M-1')?.assignee).toBeUndefined()
    ledger.upsertTicketMirror({ ...base, assignee: 'P-7' })
    expect(ledger.getTicketMirror('M-1')).toMatchObject({ assignee: 'P-7' })
    ledger.upsertTicketMirror({ ...base, updated: T0 + 1, assignee: 'P-8' })
    expect(ledger.getTicketMirror('M-1')).toMatchObject({ assignee: 'P-8', updated: T0 + 1 })
  })
})
