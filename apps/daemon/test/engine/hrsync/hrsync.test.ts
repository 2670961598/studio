/**
 * hr-sync 消化器测试（DEV-48，docs/52-§5.2/§9.1/§9.2/§六/§七/§十二）：
 * apply 段入队（diff 展开→三面任务行+哨兵票+摘要 kv，零平台 IO；op_key 幂等重放零新行）/
 * 相位尾 drain（补单 D7→personnel_events 挂账（确定性 id 跨面收敛不双写）→三面执行
 * ensure-shape→complete）/ Matrix 口令 kv 持久复用 / ledger 面 setPersonStatus /
 * 失败重试与达限 failed 终态+ESCALATE（HRSYNC;FAIL; 前缀；不自动开 bug 单）/
 * 出站脱敏（last_error/事件 note 过 redact 闭包）/ maxPerTick 每拍上限。
 * 台账=os.tmpdir() 真文件库；平台与三面=结构化 fake（无 matrix 包 import——宪法边）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, FlowPlatform, IssueRecord, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { redactOutbound } from '@studio-next/core'
import {
  createHrSyncDigester,
  enqueueHrBatch,
  HR_TICKET_SENTINEL,
  type HrSyncDeps,
  type HrSyncTickReport,
  type MatrixHrFace,
  type TaigaHrFace,
} from '../../../src/engine/hrsync/hrsync.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-hrsync-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

// —— 语料：公司快照（prev=2 人；next=入 1+升 1+停 1） ——

function person(id: string, name: string, login: string, level: number, dept: string, status?: 'paused'): PersonRef {
  return status === undefined ? { id, name, login, level, dept } : { id, name, login, level, dept, status }
}

function snapshotOf(people: PersonRef[]): CompanySnapshot {
  return {
    slug: 'demo',
    name: '演示公司',
    level: 5,
    charter: 'charter.md',
    platform: { platform: 'youtrack' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 3, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people,
    jobs: [],
  }
}

const DEPT = 'departments/工程部'
const PREV = snapshotOf([
  person('AGENT-1', '示例工程师', 'agent-1', 2, DEPT),
  person('AGENT-2', '后端工程师', 'agent-2', 3, DEPT),
])
const NEXT = snapshotOf([
  person('AGENT-1', '示例工程师', 'agent-1', 3, DEPT), // 升 2→3
  person('AGENT-2', '后端工程师', 'agent-2', 3, DEPT, 'paused'), // 停
  person('AGENT-3', '新同学', 'agent-3', 1, DEPT), // 入
])

// —— 装配件：fake 平台开单面 + 结构化 fake 三面 + 可注入红时钟 ——

function fakePlatform(log: IssueRecord[]): Pick<FlowPlatform, 'issues'> {
  const reject = async (): Promise<never> => {
    throw new Error('本测不触达 issues 其他面')
  }
  return {
    issues: {
      list: reject,
      get: reject,
      create: async (input) => {
        const issue: IssueRecord = {
          id: `T-HR-${String(log.length + 1).padStart(3, '0')}`,
          title: input.title,
          state: 'Open',
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.dept !== undefined ? { dept: input.dept } : {}),
          updated: '2026-01-01T00:00:00Z',
        }
        log.push(issue)
        return issue
      },
      transition: reject,
      setField: reject,
    },
  }
}

function fakeTaiga(calls: string[]): TaigaHrFace {
  return {
    ensureMember: async (a) => {
      calls.push(`入 ${a.username}→${a.roleSlug}${a.displayName !== undefined ? `（${a.displayName}）` : ''}`)
      return { membershipId: 1, created: true }
    },
    ensureRole: async (a) => {
      calls.push(`role ${a.username}→${a.roleSlug}`)
    },
    removeMember: async (a) => {
      calls.push(`退 ${a.username}`)
    },
  }
}

function fakeMatrix(calls: string[], failOn?: { op: string; err: Error }): MatrixHrFace {
  return {
    ensureAccount: async (a) => {
      if (failOn?.op === 'account') throw failOn.err
      calls.push(`account ${a.username}/${a.displayName} pw=${a.password}`)
      return { userId: `@${a.username}:mx.test`, created: true }
    },
    ensureMembership: async (a) => {
      calls.push(`join ${a.userId}→${a.roomAlias}`)
    },
    ensurePowerLevel: async (a) => {
      if (failOn?.op === 'power') throw failOn.err
      calls.push(`power ${a.userId}@${a.roomAlias}=${String(a.level)}`)
    },
    kickFromRoom: async (a) => {
      calls.push(`kick ${a.userId}@${a.roomAlias}`)
    },
  }
}

/** 事件 id=生产件 makeUlid（Crockford 字母表——原生 toString(32) 含 I/L/O/U 非法字符）；
 *  随机段 80bit 保证唯一性，clock 恒定亦不冲突。 */
const idOf: (ts: number) => string = makeUlid

function digester(over: Partial<HrSyncDeps['config']> & { faces?: HrSyncDeps['faces']; platform?: Pick<FlowPlatform, 'issues'> } = {}): { drain(): Promise<HrSyncTickReport> } {
  const taigaCalls: string[] = []
  const matrixCalls: string[] = []
  const tickets: IssueRecord[] = []
  const deps: HrSyncDeps = {
    ledger,
    platform: over.platform ?? fakePlatform(tickets),
    clock: () => 1_000_000,
    makeId: idOf,
    log: () => {},
    config: { company: 'demo', deptFallback: DEPT, maxPerTick: 10, retryLimit: 3, approver: 'daemon/hr-sync', ...over },
    faces: over.faces ?? {
      taiga: fakeTaiga(taigaCalls),
      matrix: fakeMatrix(matrixCalls),
      rooms: { company: '#co:mx.test', aliasForDept: (d) => (d === DEPT ? '#eng:mx.test' : undefined) },
      taigaRoleOf: (level) => (level >= 3 ? 'core' : 'member'),
    },
    redact: (text) => redactOutbound(text, ['abracadabra-secret-999']),
  }
  return createHrSyncDigester(deps)
}

describe('enqueueHrBatch（apply 段入队——零平台 IO）', () => {
  it('diff 展开：入=3 面/升=2 面/停=2 面；哨兵票+摘要 kv；重放 op_key 幂等零新行', () => {
    ledger.syncCompany(PREV)
    const batchId = '01HRSYNCBATCH0001'
    const r = enqueueHrBatch(ledger, { prev: PREV, next: NEXT, company: 'demo', batchId, ts: 5000 })
    expect(r.summary).toBe('入1；升1；停1')
    expect(r.enqueued).toBe(7)
    expect(ledger.kvGet(`hr.batch.${batchId}.summary`)).toBe('入1；升1；停1')
    const replay = enqueueHrBatch(ledger, { prev: PREV, next: NEXT, company: 'demo', batchId, ts: 5100 })
    expect(replay.enqueued).toBe(0) // op_key 幂等：任意态命中即跳
    const stats = ledger.hrSyncQueueStats()
    expect(stats.pending).toBe(7)
    for (const row of ledger.listHrSyncPending(10)) expect(row.ticket).toBe(`${HR_TICKET_SENTINEL}${batchId}`)
  })

  it('无变动：batchId=null 零任务（镜像同步≠人事变动）', () => {
    const r = enqueueHrBatch(ledger, { prev: NEXT, next: NEXT, company: 'demo', batchId: '01HRNOCHANGE0000000000', ts: 6000 })
    expect(r).toEqual({ batchId: null, summary: '无人事变动', enqueued: 0 })
  })
})

describe('drain（相位尾消化——补单→挂账→三面执行→complete）', () => {
  it('全链 happy path：对账单 1 张（kv 幂等）/事实账跨面收敛 3 行/三面调用齐/people.status 落位', async () => {
    ledger.syncCompany(NEXT) // 装配序：入队后镜像直覆（serve apply 步4）
    const tickets: IssueRecord[] = []
    const taigaCalls: string[] = []
    const matrixCalls: string[] = []
    const d = digester({ platform: fakePlatform(tickets), faces: { taiga: fakeTaiga(taigaCalls), matrix: fakeMatrix(matrixCalls), rooms: { company: '#co:mx.test', aliasForDept: (dep) => (dep === DEPT ? '#eng:mx.test' : undefined) }, taigaRoleOf: (l) => (l >= 3 ? 'core' : 'member') } })
    const report = await d.drain()
    expect(report).toMatchObject({ claimed: 7, done: 7, retried: 0, failed: 0, ticketsOpened: 1, eventsAppended: 1 })
    // 对账单：一张、type=hr、标题带批次；kv 记票号
    expect(tickets).toHaveLength(1)
    expect(tickets[0]?.title).toContain('[人事对账]')
    expect(tickets[0]?.type).toBe('hr')
    expect(ledger.kvGet('hr.batch.01HRSYNCBATCH0001')).toBe('T-HR-001')
    // ORG_UPGRADE 挂账单：note=HRSYNC;batch=…;摘要（§5.2 步8）
    const org = ledger.queryEvents({ company: 'demo', order: 'desc', limit: 1 })[0]
    expect(org?.event).toBe('ORG_UPGRADE')
    expect(org?.issue).toBe('T-HR-001')
    expect(org?.note).toBe('HRSYNC;batch=01HRSYNCBATCH0001;入1；升1；停1')
    // taiga 面：入（agent-3→member）+升（agent-1→core）
    expect(taigaCalls).toContain('入 agent-3→member（新同学）')
    expect(taigaCalls).toContain('role agent-1→core')
    // matrix 面：入=建号+公司房+部门房；升=power 0；停=power -1（两房）
    expect(matrixCalls.some((c) => c.startsWith('account agent-3/新同学'))).toBe(true)
    expect(matrixCalls).toContain('join @agent-3:mx.test→#co:mx.test')
    expect(matrixCalls).toContain('join @agent-3:mx.test→#eng:mx.test')
    expect(matrixCalls).toContain('power @agent-1@#co:mx.test=0') // 升/停/退/调走裸 @localpart（v0 口径；入路径才有全限定 id）
    expect(matrixCalls).toContain('power @agent-2@#co:mx.test=-1')
    // Matrix 口令 kv 持久（D6）
    const pw = ledger.kvGet('hr.matrix.pass.agent-3')
    expect(pw !== null && pw.length >= 18).toBe(true)
    expect(matrixCalls.some((c) => c.endsWith(`pw=${pw ?? ''}`))).toBe(true)
    // ledger 面：入→active、停→paused（syncCompany 不写 status——由任务写）
    expect(ledger.getPerson('AGENT-3')?.status).toBe('active')
    expect(ledger.getPerson('AGENT-2')?.status).toBe('paused')
    // 事实账：确定性 id 跨面收敛——7 任务 3 行（同人同变动同 id）
    const facts = [ ...ledger.personnelTimeline('AGENT-1'), ...ledger.personnelTimeline('AGENT-2'), ...ledger.personnelTimeline('AGENT-3') ].filter((e) => e.source === 'personnel_event')
    expect(facts).toHaveLength(3)
    for (const f of facts) {
      if (f.source !== 'personnel_event') continue
      expect(f.record.ticket).toBe('T-HR-001')
      expect(f.record.approver).toBe('daemon/hr-sync')
      expect(f.record.ts).toBe(5000) // 业务时（批次入队 ts）非执行时——重试幂等的根
    }
    // 再拍：队列空
    const again = await d.drain()
    expect(again.claimed).toBe(0)
  })
})

describe('drain 失败语义（§9.2：重试→达限 failed+ESCALATE；不自动开 bug 单）', () => {
  it('fail 未达限回 pending；达限 failed 终态+ESCALATE（脱敏面）；事实账不双写；票不重开', async () => {
    const prev = snapshotOf([person('AGENT-9', '事故演员', 'agent-9', 2, DEPT)])
    const next = snapshotOf([person('AGENT-9', '事故演员', 'agent-9', 2, DEPT, 'paused')])
    ledger.syncCompany(prev)
    const batchId = '01HRSYNCFAILBATCH1'
    const r = enqueueHrBatch(ledger, { prev, next, company: 'demo', batchId, ts: 9000 })
    expect(r.enqueued).toBe(2) // 停=matrix+ledger
    ledger.syncCompany(next)
    const tickets: IssueRecord[] = []
    const taigaCalls: string[] = []
    const matrixCalls: string[] = []
    const boom = new Error('matrix 5xx：shared-secret=abracadabra-secret-999 泄漏形')
    const d = digester({ retryLimit: 2, platform: fakePlatform(tickets), faces: { taiga: fakeTaiga(taigaCalls), matrix: fakeMatrix(matrixCalls, { op: 'power', err: boom }), rooms: { company: '#co:mx.test', aliasForDept: () => undefined } } })
    // 拍1：ledger 面成、matrix 面败回队（attempts 1/2）
    const r1 = await d.drain()
    expect(r1).toMatchObject({ done: 1, retried: 1, failed: 0, ticketsOpened: 1 })
    const row1 = ledger.db.prepare("SELECT status, attempts, last_error FROM hr_sync_log WHERE platform = 'matrix' AND ticket = ?").get(`${HR_TICKET_SENTINEL}${batchId}`) as { status: string; attempts: number; last_error: string }
    expect(row1.status).toBe('pending')
    expect(row1.attempts).toBe(1)
    expect(row1.last_error).toContain('<redacted:') // 密钥扫描出站面（§十二）
    expect(row1.last_error).not.toContain('abracadabra-secret-999')
    // 拍2：再败=达限 failed 终态 + ESCALATE；票 kv 幂等不重开
    const r2 = await d.drain()
    expect(r2).toMatchObject({ done: 0, retried: 0, failed: 1, ticketsOpened: 0 })
    expect(tickets).toHaveLength(1)
    const row2 = ledger.db.prepare("SELECT status, attempts FROM hr_sync_log WHERE platform = 'matrix' AND ticket = ?").get(`${HR_TICKET_SENTINEL}${batchId}`) as { status: string; attempts: number }
    expect(row2).toEqual({ status: 'failed', attempts: 2 })
    const esc = ledger.queryEvents({ company: 'demo' }).find((e) => e.event === 'ESCALATE')
    expect(esc?.event).toBe('ESCALATE')
    expect(esc?.note).toMatch(/^HRSYNC;FAIL;task=.+;matrix;停;AGENT-9;尝试=2：/)
    expect(esc?.note).toContain('<redacted:')
    // 事实账：两拍一拍一条——同 id 幂等不双写（ts=业务时）
    const facts = ledger.personnelTimeline('AGENT-9').filter((e) => e.source === 'personnel_event')
    expect(facts).toHaveLength(1)
    // failed 终态不吃拍；releaseHrSyncFailed 唤醒后可再走（store 面已测——此处只验不复活）
    const r3 = await d.drain()
    expect(r3.claimed).toBe(0)
  })
})

describe('maxPerTick（每拍消化上限——§9.2）', () => {
  it('上限逐拍消化：3 任务 3 拍', async () => {
    const prev = snapshotOf([])
    const next = snapshotOf([person('AGENT-7', '限流演员', 'agent-7', 1, DEPT)])
    ledger.syncCompany(prev)
    const batchId = '01HRSYNCTHROTTLE01'
    expect(enqueueHrBatch(ledger, { prev, next, company: 'demo', batchId, ts: 11000 }).enqueued).toBe(3)
    ledger.syncCompany(next)
    expect(ledger.hrSyncQueueStats().pending).toBe(3) // 前序用例已清队——上限测试只看本批
    const d = digester({ maxPerTick: 1 })
    expect((await d.drain()).claimed).toBe(1)
    expect((await d.drain()).claimed).toBe(1)
    expect((await d.drain()).claimed).toBe(1)
    expect((await d.drain()).claimed).toBe(0)
    expect(ledger.hrSyncQueueStats().done).toBeGreaterThanOrEqual(3)
  })
})
