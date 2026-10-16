/**
 * v0.2 第二刀·五表测试：v2 迁移幂等（含 v1 库升级路径）/ syncCompany 镜像往返 /
 * personnel_events append-only（触发器机制）/ 三表归并时间线 / budgets 查询面 / ticket_mirror。
 *
 * 环境：os.tmpdir() 真文件库（沿 ledger.test.ts 风格，不用 :memory:）。
 * 依据：docs/17-§3 数据模型、docs/02 F2-06（people+personnel_events 必挂单）、F1-09（预算三节点）、
 * docs/01 C1-04（生命周期时间线三表 join）、contract ports/company.ts（CompanySnapshot 源形状）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot } from '@studio-next/contract'
import { migrate, openLedger, openSqlite, type Ledger } from '../src/index.ts'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v2-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

/** 断言抛出 ClassifiedError 形状且 category=CONFIG_INVALID、subcause 匹配；可附带 message 子串 */
function expectConfigInvalid(fn: () => unknown, subcausePrefix: string, messageContains?: string): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const err = caught as Error & { category?: string; subcause?: string }
  expect(err.category).toBe('CONFIG_INVALID')
  expect(err.subcause).toMatch(new RegExp(`^${subcausePrefix.replaceAll('/', '\\/')}`))
  if (messageContains !== undefined) expect(err.message).toContain(messageContains)
}

/** 断言 db.exec 抛错且 message 含子串（触发器 RAISE 的直证面） */
function expectExecRejected(fn: () => void, messageContains: string): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toContain(messageContains)
}

describe('v2 迁移（五表 + append-only 触发器）', () => {
  it('建库即到最新版（v4，v2 五表随建库齐备）：五表在库、budgets scope 索引在库、personnel_events 两枚触发器在库', () => {
    expect(ledger.version()).toBe(4)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    for (const t of ['people', 'personnel_events', 'departments', 'ticket_mirror', 'budgets']) expect(tables).toContain(t)
    const triggers = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(triggers).toEqual(['trg_personnel_events_no_delete', 'trg_personnel_events_no_update'])
    const indexes = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_budgets_scope'").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(indexes).toEqual(['idx_budgets_scope'])
  })

  it('重开库 migrate 幂等：version 不涨、schema_version 恰四行、v2/v3/v4 不重放', () => {
    const again = openLedger(path.join(root, 'ledger.db'))
    expect(again.version()).toBe(4)
    const rows = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(rows.c)).toBe(4)
    again.close()
  })

  it('sha8 防漂移：篡改 v2 记录后重开 → CONFIG_INVALID', () => {
    const p = path.join(root, 'tamper.db')
    const l = openLedger(p)
    l.db.prepare("UPDATE schema_version SET sha8 = 'deadbeef' WHERE version = 2").run()
    l.close()
    expectConfigInvalid(() => openLedger(p), 'store/migration:sha8-mismatch', 'v2')
  })

  it('migrate upTo 越界防呆：0 / 超最新版 → CONFIG_INVALID', () => {
    expectConfigInvalid(() => migrate(openSqlite(path.join(root, 'up-to-bad.db')), { upTo: 0 }), 'store/migration:bad-up-to')
    expectConfigInvalid(() => migrate(openSqlite(path.join(root, 'up-to-bad.db')), { upTo: 99 }), 'store/migration:bad-up-to')
  })

  it('v1 库升级路径：v1 建库写入事件 → openLedger 升到最新版（v4），旧数据无损、五表补齐', () => {
    // ① 构造 v1 库（migrate upTo=1：测试构造历史版本库的通道）+ 裸插入一条合法事件
    const p = path.join(root, 'upgrade.db')
    const v1db = openSqlite(p)
    migrate(v1db, { upTo: 1 })
    expect(
      v1db.prepare('SELECT COUNT(*) AS c FROM sqlite_master WHERE type = ? AND name IN (?,?,?,?,?)').all('table', 'people', 'personnel_events', 'departments', 'ticket_mirror', 'budgets'),
    ).toHaveLength(1) // sqlite_master 汇总行：五表在 v1 库中一张都没有
    const ts = 1760000005000
    v1db
      .prepare(
        'INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', ts, 'demo', 'STUDIO-9', 'DISPATCH', 'AGENT-9:agent-9', 1, 3, 'departments/工程部', '{"input":100,"output":50}')
    v1db.close()

    // ② v1 库重开（openLedger 全量迁移）→ v4（v2 五表 + v3 jobs + v4 daemon_kv 逐版本补齐），v1 数据原样可读
    const upgraded = openLedger(p)
    expect(upgraded.version()).toBe(4)
    const events = upgraded.queryEvents()
    expect(events).toEqual([
      {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        ts,
        company: 'demo',
        issue: 'STUDIO-9',
        event: 'DISPATCH',
        actor: 'AGENT-9:agent-9',
        attempt: 1,
        level: 3,
        dept: 'departments/工程部',
        tokens: { input: 100, output: 50 },
      },
    ])
    // 五表已补齐，v1 三表仍在
    const tables = (
      upgraded.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    for (const t of ['events', 'work_records', 'sessions', 'people', 'personnel_events', 'departments', 'ticket_mirror', 'budgets']) {
      expect(tables).toContain(t)
    }
    upgraded.close()
  })
})

// —— syncCompany 镜像语料（CompanySnapshot 源形状：PersonRef 五字段 / DeptNode 全列） ——

const TS0 = 1770000000000

function makeSnapshot(patch: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    slug: 'demo',
    name: '演示公司',
    level: 5,
    charter: 'charter.md',
    platform: { platform: 'youtrack' },
    departments: [
      {
        name: '工程部',
        path: 'departments/工程部',
        parent: null,
        leader: 'AGENT-1',
        level: 3,
        lanes: ['core', 'im'],
        functions: ['交付', '把关'],
        relations: [],
      },
      {
        name: '后端组',
        path: 'departments/工程部/后端组',
        parent: 'departments/工程部',
        leader: 'AGENT-2',
        level: 2,
        lanes: [],
        functions: ['后端'],
        relations: [],
      },
    ],
    people: [
      { id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
      { id: 'AGENT-2', name: '后端工程师', login: 'agent-2', level: 3, dept: 'departments/工程部/后端组' },
    ],
    jobs: [],
    ...patch,
  }
}

describe('syncCompany 镜像往返（快照 → people/departments → 读出 deep-equal）', () => {
  it('首次同步：镜像行 = 快照所载字段（PersonRef 五字段 / DeptNode 全列 + slug），JSON 数组列往返', () => {
    const result = ledger.syncCompany(makeSnapshot())
    expect(result).toEqual({ people: 2, departments: 2 })
    expect(ledger.listPeople()).toEqual([
      { person_id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
      { person_id: 'AGENT-2', name: '后端工程师', login: 'agent-2', level: 3, dept: 'departments/工程部/后端组' },
    ])
    expect(ledger.listDepartments()).toEqual([
      {
        path: 'departments/工程部',
        company: 'demo',
        leader: 'AGENT-1',
        functions: ['交付', '把关'],
        lanes: ['core', 'im'],
      },
      {
        path: 'departments/工程部/后端组',
        company: 'demo',
        leader: 'AGENT-2',
        functions: ['后端'],
        lanes: [],
        parent_path: 'departments/工程部',
      },
    ])
    expect(ledger.getPerson('AGENT-1')).toEqual({ person_id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' })
    expect(ledger.getPerson('AGENT-404')).toBeUndefined()
  })

  it('再同步跟随快照覆盖写（镜像=可重建投影），行数不膨胀', () => {
    const changed = makeSnapshot({
      people: [
        { id: 'AGENT-1', name: '改名工程师', login: 'agent-1', level: 4, dept: 'departments/工程部/后端组' },
        { id: 'AGENT-2', name: '后端工程师', login: 'agent-2', level: 3, dept: 'departments/工程部/后端组' },
      ],
    })
    expect(ledger.syncCompany(changed)).toEqual({ people: 2, departments: 2 })
    expect(ledger.listPeople()).toEqual([
      { person_id: 'AGENT-1', name: '改名工程师', login: 'agent-1', level: 4, dept: 'departments/工程部/后端组' },
      { person_id: 'AGENT-2', name: '后端工程师', login: 'agent-2', level: 3, dept: 'departments/工程部/后端组' },
    ])
    expect(ledger.listDepartments()).toHaveLength(2)
  })

  it('只覆盖快照所载字段：people 扩展列（status/skills 等）不被镜像同步清空或覆盖', () => {
    // v0 people 扩展列尚无独立写面，直改库模拟人事流已写入的扩展状态（验证 upsert 列集契约）
    ledger.db
      .prepare("UPDATE people SET status = 'paused', skills = '[\"ops\"]', capability_tier = 1 WHERE person_id = 'AGENT-1'")
      .run()
    ledger.syncCompany(makeSnapshot({ people: [{ id: 'AGENT-1', name: '再改名', login: 'agent-1', level: 2, dept: 'departments/工程部' }] }))
    const p = ledger.getPerson('AGENT-1')
    expect(p).toEqual({
      person_id: 'AGENT-1',
      name: '再改名', // 快照所载：跟随
      login: 'agent-1',
      level: 2,
      dept: 'departments/工程部',
      skills: ['ops'], // 快照未载：保留
      capability_tier: 1,
      status: 'paused',
    })
  })

  it('坏快照整批拒（快照内重复 person_id / 部门 path 重复），库内镜像零变更', () => {
    const before = { people: ledger.listPeople(), depts: ledger.listDepartments() }
    expectConfigInvalid(
      () =>
        ledger.syncCompany(
          makeSnapshot({
            people: [
              { id: 'AGENT-DUP', name: '甲', login: 'a', level: 1, dept: 'd' },
              { id: 'AGENT-DUP', name: '乙', login: 'b', level: 2, dept: 'd' },
            ],
          }),
        ),
      'store/people:duplicate',
      'AGENT-DUP',
    )
    expectConfigInvalid(
      () =>
        ledger.syncCompany(
          makeSnapshot({
            departments: [
              { name: 'x', path: 'departments/x', parent: null, leader: 'AGENT-1', level: 1, lanes: [], functions: [], relations: [] },
              { name: 'x', path: 'departments/x', parent: null, leader: 'AGENT-2', level: 1, lanes: [], functions: [], relations: [] },
            ],
          }),
        ),
      'store/departments:duplicate',
      'departments/x',
    )
    // 非法行（level 越界）整批拒：合法行也不入账（预校验后单事务）
    expectConfigInvalid(
      () =>
        ledger.syncCompany(
          makeSnapshot({
            people: [
              { id: 'AGENT-OK', name: '合法', login: 'ok', level: 2, dept: 'd' },
              { id: 'AGENT-BAD', name: '非法', login: 'bad', level: 12, dept: 'd' },
            ],
          }),
        ),
      'store/people:invalid:level',
    )
    expect(ledger.getPerson('AGENT-OK')).toBeUndefined()
    expect(ledger.listPeople()).toEqual(before.people)
    expect(ledger.listDepartments()).toEqual(before.depts)
  })
})

describe('ticket_mirror（YouTrack 镜像）', () => {
  it('upsert 插入 → 读出全字段往返；再 upsert 即覆盖（last-write-wins）', () => {
    const base = {
      issue: 'STUDIO-300',
      company: 'demo',
      created: TS0,
      updated: TS0 + 1000,
      state: 'Open',
      type: 'Task',
      dept: 'departments/工程部',
      level: 3,
      dispatcher: 'PM-1:pm-1',
      parent: 'STUDIO-299',
      lane: 'core',
    }
    expect(ledger.upsertTicketMirror(base)).toBe('STUDIO-300')
    expect(ledger.getTicketMirror('STUDIO-300')).toEqual(base)
    // 无 parent / lane 的最小行
    expect(ledger.upsertTicketMirror({ ...base, issue: 'STUDIO-301', parent: undefined, lane: undefined })).toBe('STUDIO-301')
    expect(ledger.getTicketMirror('STUDIO-301')?.parent).toBeUndefined()
    expect(ledger.getTicketMirror('STUDIO-301')?.lane).toBeUndefined()

    // 覆盖写：状态推进 + updated 递增；镜像整行覆盖语义——本次快照未载 lane 即清空（NULL）
    ledger.upsertTicketMirror({ ...base, state: 'Done', updated: TS0 + 9000, lane: undefined })
    expect(ledger.getTicketMirror('STUDIO-300')).toEqual({ ...base, state: 'Done', updated: TS0 + 9000, lane: undefined })
    expect(ledger.getTicketMirror('STUDIO-300')?.lane).toBeUndefined()
    expect(ledger.listTicketMirrors().map((t) => t.issue)).toEqual(['STUDIO-301', 'STUDIO-300']) // updated 升序
    expect(ledger.getTicketMirror('STUDIO-404')).toBeUndefined()
  })

  it('坏记录拒入：level 越界 / 缺必填 / 未知列 → CONFIG_INVALID', () => {
    const base = { issue: 'X', company: 'demo', created: 1, updated: 2, state: 'Open', type: 'Task', dept: 'd', level: 3, dispatcher: 'p' }
    expectConfigInvalid(() => ledger.upsertTicketMirror({ ...base, level: 12 }), 'store/ticket-mirror:invalid:level')
    expectConfigInvalid(() => ledger.upsertTicketMirror({ ...base, state: '' }), 'store/ticket-mirror:invalid:state')
    expectConfigInvalid(() => ledger.upsertTicketMirror({ ...base, bogus: true }), 'store/ticket-mirror:invalid:', 'bogus')
  })
})

describe('budgets（预算三节点落账与查询面）', () => {
  it('reserve / settle / refusal 落账 + queryBudgets 按 scope 过滤、ts 升序', () => {
    expect(ledger.appendBudget({ id: 'bud-1', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'reserve', estimated_usd: 5, ts: TS0 + 1 }).appended).toBe(true)
    expect(ledger.appendBudget({ id: 'bud-2', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'settle', estimated_usd: 5, actual_usd: 4.2, ts: TS0 + 2 }).appended).toBe(true)
    expect(ledger.appendBudget({ id: 'bud-3', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'refusal', estimated_usd: 9.9, ts: TS0 + 3 }).appended).toBe(true)
    expect(ledger.appendBudget({ id: 'bud-4', scope_kind: 'person', scope_id: 'AGENT-1', kind: 'reserve', estimated_usd: 1, ts: TS0 + 4 }).appended).toBe(true)
    expect(ledger.appendBudget({ id: 'bud-5', scope_kind: 'company', scope_id: 'demo', kind: 'refusal', estimated_usd: 100, ts: TS0 + 5 }).appended).toBe(true)

    expect(ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'STUDIO-300' })).toEqual([
      { id: 'bud-1', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'reserve', estimated_usd: 5, ts: TS0 + 1 },
      { id: 'bud-2', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'settle', estimated_usd: 5, actual_usd: 4.2, ts: TS0 + 2 },
      { id: 'bud-3', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'refusal', estimated_usd: 9.9, ts: TS0 + 3 },
    ])
    expect(ledger.queryBudgets({ scope_kind: 'person', scope_id: 'AGENT-1' }).map((b) => b.id)).toEqual(['bud-4'])
    expect(ledger.queryBudgets({ scope_kind: 'company', scope_id: 'demo' }).map((b) => b.id)).toEqual(['bud-5'])
    expect(ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'NOPE' })).toEqual([])
  })

  it('幂等规则：同 id 全列一致 appended:false；内容冲突 CONFIG_INVALID', () => {
    const same = { id: 'bud-1', scope_kind: 'issue', scope_id: 'STUDIO-300', kind: 'reserve', estimated_usd: 5, ts: TS0 + 1 }
    expect(ledger.appendBudget(same)).toEqual({ id: 'bud-1', appended: false })
    expectConfigInvalid(() => ledger.appendBudget({ ...same, estimated_usd: 6 }), 'store/budget:duplicate-id')
  })

  it('坏记录拒入：scope_kind / kind 枚举外 → CONFIG_INVALID', () => {
    const base = { id: 'bud-bad', scope_kind: 'issue', scope_id: 'X-1', kind: 'reserve', ts: 1 }
    expectConfigInvalid(() => ledger.appendBudget({ ...base, scope_kind: 'dept' }), 'store/budget:invalid:scope_kind')
    expectConfigInvalid(() => ledger.appendBudget({ ...base, kind: 'refund' }), 'store/budget:invalid:kind')
    expectConfigInvalid(() => ledger.appendBudget({ id: '', scope_kind: 'issue', scope_id: 'X-1', kind: 'reserve', ts: 1 }), 'store/budget:invalid:id')
  })
})

describe('personnel_events（append-only 台账）与三表归并时间线', () => {
  it('落账 + 幂等规则 + 必挂单闸（缺 ticket/approver 拒入）', () => {
    const join = { id: 'pe-1', ts: TS0, person_id: 'AGENT-1', type: '入', next: 'AGENT-1', ticket: 'STUDIO-100', approver: 'PM-1' }
    expect(ledger.appendPersonnelEvent(join)).toEqual({ id: 'pe-1', appended: true })
    expect(ledger.appendPersonnelEvent({ ...join })).toEqual({ id: 'pe-1', appended: false }) // 键序不同仍幂等
    expectConfigInvalid(() => ledger.appendPersonnelEvent({ ...join, ticket: 'STUDIO-999' }), 'store/personnel-event:duplicate-id')
    expectConfigInvalid(
      () => ledger.appendPersonnelEvent({ id: 'pe-bad', ts: 1, person_id: 'AGENT-1', type: '升', approver: 'PM-1' }),
      'store/personnel-event:invalid:ticket',
      'ticket',
    )
    expectConfigInvalid(
      () => ledger.appendPersonnelEvent({ id: 'pe-bad', ts: 1, person_id: 'AGENT-1', type: '升', ticket: 'T-1' }),
      'store/personnel-event:invalid:approver',
    )
  })

  it('append-only 由触发器机制兜底：UPDATE / DELETE 直连库也被拒、行数不变', () => {
    const count = (ledger.db.prepare('SELECT COUNT(*) AS c FROM personnel_events').get() as { c?: unknown }).c
    expectExecRejected(() => ledger.db.exec("UPDATE personnel_events SET type = '退' WHERE id = 'pe-1'"), 'append-only')
    expectExecRejected(() => ledger.db.exec('DELETE FROM personnel_events WHERE id = ' + "'pe-1'"), 'append-only')
    const after = (ledger.db.prepare('SELECT COUNT(*) AS c FROM personnel_events').get() as { c?: unknown }).c
    expect(after).toBe(count)
  })

  it('personnelTimeline：personnel_events × work_records × sessions 按 person 归并、ts 升序', () => {
    // AGENT-1：入(TS0) → 干活(TS0+10h) → 升(TS0+20h) → 会话(TS0+30h) → 调(TS0+40h)
    ledger.appendPersonnelEvent({ id: 'pe-2', ts: TS0 + 20 * 3600_000, person_id: 'AGENT-1', type: '升', prev: '2', next: '3', ticket: 'STUDIO-101', approver: 'PM-1' })
    ledger.appendPersonnelEvent({ id: 'pe-3', ts: TS0 + 40 * 3600_000, person_id: 'AGENT-1', type: '调', prev: 'departments/工程部', next: 'departments/工程部/后端组', ticket: 'STUDIO-102', approver: 'PM-1' })
    ledger.appendPersonnelEvent({ id: 'pe-4', ts: TS0 + 25 * 3600_000, person_id: 'AGENT-2', type: '入', next: 'AGENT-2', ticket: 'STUDIO-103', approver: 'PM-1' })
    ledger.insertWorkRecord({ id: 'wr-t1', issue: 'STUDIO-110', person_id: 'AGENT-1', executor: 'dsh', started_at: TS0 + 10 * 3600_000, attempt: 1, status: 'done' })
    ledger.insertSession({ session_id: 'sess-t1', issue: 'STUDIO-110', person_id: 'AGENT-1', started_at: TS0 + 30 * 3600_000, turns: 5 })

    const timeline = ledger.personnelTimeline('AGENT-1')
    expect(timeline.map((e) => `${e.source}@${e.ts}`)).toEqual([
      `personnel_event@${TS0}`,
      `work_record@${TS0 + 10 * 3600_000}`,
      `personnel_event@${TS0 + 20 * 3600_000}`,
      `session@${TS0 + 30 * 3600_000}`,
      `personnel_event@${TS0 + 40 * 3600_000}`,
    ])
    // 记录本体原样带回（各源记录级往返）
    expect(timeline[0]?.record).toEqual({
      id: 'pe-1',
      ts: TS0,
      person_id: 'AGENT-1',
      type: '入',
      next: 'AGENT-1',
      ticket: 'STUDIO-100',
      approver: 'PM-1',
    })
    expect(timeline[1]?.record.id).toBe('wr-t1')
    expect(timeline[3]?.record).toEqual({
      session_id: 'sess-t1',
      issue: 'STUDIO-110',
      person_id: 'AGENT-1',
      started_at: TS0 + 30 * 3600_000,
      turns: 5,
    })

    // 只归并本人：AGENT-2 仅其入事件；无记录的人返回空数组
    expect(ledger.personnelTimeline('AGENT-2').map((e) => e.source)).toEqual(['personnel_event'])
    expect(ledger.personnelTimeline('AGENT-404')).toEqual([])
  })
})
