/**
 * :8791 收件箱读面测试（129-§6.2 R2/R5，studio-dev-167 单B）：
 *   - /api/inbox 端面形状（total/ready/awaitingApproval/persons/oldestWaitMs/rows）
 *   - 行序=核心排序键读面镜像（置顶恒首→score 降→FIFO→单号）——与 core 的逐例
 *     对齐由 apps/daemon/test/panel-inbox-align.test.ts 钉住（跨包边：panel→core 非法）
 *   - company 过滤 / limit 夹取 / 空队零行不炸
 *   - buildInboxSnapshot 纯函数面（waitingMs 现算、pinned 布尔化、why 可空）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger, type TodoQueueRecord } from '@studio-next/store'
import { buildInboxSnapshot, compareInboxRows, INBOX_MAX_ROWS } from '../src/inbox.ts'
import { createPanelApp } from '../src/index.ts'

let root = ''
let ledger: Ledger

/** 语料：三行 DEMO + 一行 poly（company 过滤面）——次序刻意乱序种入（表序≠读序） */
function row(over: Partial<TodoQueueRecord>): TodoQueueRecord {
  return {
    company: 'demo',
    ticket: 'DEMO-1',
    person: 'P1',
    priority: 1,
    pinned: 0,
    boost_tier: 0,
    first_seen_at: 1000,
    ready_state: 'ready',
    updated_at: 5000,
    ...over,
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-inbox-'))
  ledger = openLedger(path.join(root, 'inbox.db'))
  ledger.replaceTodoQueue('demo', [
    row({ ticket: 'DEMO-3', person: 'P2', priority: 0, boost_tier: 2, first_seen_at: 900 }), // score 2（老化升档）
    row({ ticket: 'DEMO-1', person: 'P1', priority: 1, first_seen_at: 1000 }), // score 1
    row({ ticket: 'DEMO-2', person: 'P1', priority: 2, pinned: 1, first_seen_at: 1500, ready_state: 'awaiting_approval', why: 'activity|ticket' }), // 置顶 ∞
  ])
  ledger.replaceTodoQueue('poly', [
    row({ company: 'poly', ticket: 'POLY-1', person: 'P9', first_seen_at: 2000 }),
  ])
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const app = createPanelApp({ openLedger: () => ledger })

describe('GET /api/inbox', () => {
  it('端面形状：demo 三行，行序=置顶恒首→score 降→FIFO；company 过滤排他', async () => {
    const res = await app.request('/api/inbox?company=demo&now=0'.replace('&now=0', ''))
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReturnType<typeof buildInboxSnapshot>
    expect(body.total).toBe(3)
    expect(body.ready).toBe(2)
    expect(body.awaitingApproval).toBe(1)
    expect(body.persons).toBe(2)
    expect(body.company).toBe('demo')
    expect(body.rows.map((r) => r.ticket)).toEqual(['DEMO-2', 'DEMO-3', 'DEMO-1'])
    // 行形：置顶布尔化 + waitingMs 现算（snapshot now − first_seen_at）+ why 可空
    expect(body.rows[0]).toMatchObject({ ticket: 'DEMO-2', pinned: true, ready_state: 'awaiting_approval', why: 'activity|ticket' })
    expect(body.rows[2]?.pinned).toBe(false)
    expect(body.rows[2]?.why).toBeNull()
    expect(body.rows[1]?.waitingMs).toBeGreaterThan(0)
    expect(body.oldestWaitMs).toBe(body.rows.map((r) => r.waitingMs).reduce((a, b) => Math.max(a, b), 0))
  })

  it('company 缺省=全公司；limit 夹取（≥1、≤100）', async () => {
    const all = (await (await app.request('/api/inbox')).json()) as ReturnType<typeof buildInboxSnapshot>
    expect(all.total).toBe(4) // demo 3 + poly 1
    expect(all.company).toBeNull()
    const one = (await (await app.request('/api/inbox?company=demo&limit=1')).json()) as ReturnType<typeof buildInboxSnapshot>
    expect(one.rows).toHaveLength(1)
    expect(one.rows[0]?.ticket).toBe('DEMO-2') // 截断不破序（仍置顶首）
    expect(one.total).toBe(3) // total=全量口径（截断只作用 rows）
    const bad = (await (await app.request('/api/inbox?company=demo&limit=0')).json()) as ReturnType<typeof buildInboxSnapshot>
    expect(bad.rows).toHaveLength(3) // 非正整数→缺省 100
  })
})

describe('buildInboxSnapshot 纯函数面', () => {
  it('now 注入：waitingMs/oldestWaitMs 确定性（测试钟不漂）', () => {
    const snap = buildInboxSnapshot(ledger, { company: 'demo', now: 60_000 })
    expect(snap.rows[2]?.waitingMs).toBe(60_000 - 1000)
    expect(snap.oldestWaitMs).toBe(60_000 - 900)
    expect(snap.generatedAt).toBe(60_000)
  })

  it('空队零行不炸（total/persons/oldestWaitMs 全零）', () => {
    const snap = buildInboxSnapshot(ledger, { company: 'nobody' })
    expect(snap).toMatchObject({ total: 0, ready: 0, awaitingApproval: 0, persons: 0, oldestWaitMs: 0, rows: [] })
  })

  it('compareInboxRows：同分 FIFO→单号升序全序（确定性读序）', () => {
    const a = row({ ticket: 'DEMO-9', first_seen_at: 1000 })
    const b = row({ ticket: 'DEMO-10', first_seen_at: 1000 })
    const c = row({ ticket: 'DEMO-2', first_seen_at: 2000 })
    expect(compareInboxRows(a, b)).toBe(1) // 单号升序（字符串序 'DEMO-10'<'DEMO-9'）
    expect(compareInboxRows(b, a)).toBe(-1)
    expect(compareInboxRows(a, c)).toBe(-1) // 同分 FIFO：first_seen_at 1000 < 2000
    expect(compareInboxRows(c, a)).toBe(1)
    expect(INBOX_MAX_ROWS).toBe(100)
  })
})
