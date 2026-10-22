/**
 * sentinel 单元面 —— 127-A R1 定时岗产出哨兵（studio-dev-127 §4.2 批示③全批）
 *
 * 断言即规格（三层防御第三层——重构叙事后的管辖面收口）：
 *   - nonce 机械落法：sha256("<company>:<job>:<run_at>")——同司同岗同槽确定、异槽必异；
 *   - 锚复原：PATROL note job=＋dedup=<job_id>@<runAt>（scheduler.ts:200 同源）——
 *     他形（旧测试语料 sched:x:1/唤醒单）明跳过不误判；
 *   - 义务判定：工单型岗单（patrol 巡查工件结构性不进——岗型治理诚实化）；
 *   - 核验四态 fail-closed：ok/mismatch（抄旧槽）/missing/unreadable；
 *   - 任务书注入段：三元组原样＋P3 欠账语义＋数据源断链声明义务。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord, TicketId } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import {
  expectedSentinel,
  patrolJobOfNote,
  sentinelBriefBlock,
  sentinelDutyForTicket,
  ticketSentinelAnchor,
  verifySidecarSentinel,
  verifySidecarSentinelAtPath,
} from '../../../src/engine/jobs/sentinel.ts'

let root = ''
const T0 = new Date(2026, 9, 16, 18, 0, 0).getTime()
const SLOT = T0 + 5 * 60_000

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-sentinel-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function ledgerOf(id: string): Ledger {
  return openLedger(path.join(root, `${id}.sqlite`))
}

function reportJob(job_id: string, payload: unknown): JobRecord {
  return {
    job_id,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload,
    next_run_at: 0,
  }
}

/** PATROL 直写（engine 物化口径同形：note 携 job=/dedup= 两键） */
function appendPatrol(ledger: Ledger, ticket: TicketId, jobId: string, dedupKey: string, ts = T0): void {
  ledger.appendEvent({
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: ticket,
    event: 'PATROL',
    actor: 'daemon',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: `intent=sched:${jobId}:1;job=${jobId};cron=0 18 * * *;role=AGENT-1;dedup=${dedupKey};来源=job-scheduler`,
  } satisfies EventRecord)
}

describe('nonce 机械落法（§4.2：sha256(company:job:run_at)）', () => {
  it('同司同岗同槽确定；异槽/异岗/异司必异', () => {
    const a = expectedSentinel('demo', 'daily-report', SLOT)
    expect(a.nonce).toBe(createHash('sha256').update(`demo:daily-report:${SLOT}`).digest('hex'))
    expect(a).toEqual(expectedSentinel('demo', 'daily-report', SLOT)) // 确定
    expect(a.nonce).toMatch(/^[0-9a-f]{64}$/)
    expect(a.nonce).not.toBe(expectedSentinel('demo', 'daily-report', SLOT + 1).nonce) // 异槽
    expect(a.nonce).not.toBe(expectedSentinel('demo', 'other-job', SLOT).nonce) // 异岗
    expect(a.nonce).not.toBe(expectedSentinel('corp', 'daily-report', SLOT).nonce) // 异司
  })
})

describe('patrolJobOfNote：job= 段复原', () => {
  it('命中/无段/undefined 三态', () => {
    expect(patrolJobOfNote('intent=x;job=daily-report;cron=*')).toBe('daily-report')
    expect(patrolJobOfNote('intent=x;无 job 段')).toBeUndefined()
    expect(patrolJobOfNote(undefined)).toBeUndefined()
  })
})

describe('ticketSentinelAnchor：dedup 槽复原（<job_id>@<runAt>）', () => {
  it('常形：job@runAt → {company, jobId, runAt}', () => {
    const ledger = ledgerOf('anchor-ok')
    appendPatrol(ledger, 'T-1', 'daily-report', `daily-report@${SLOT}`)
    expect(ticketSentinelAnchor(ledger, 'T-1')).toEqual({ company: 'demo', jobId: 'daily-report', runAt: SLOT })
    ledger.close()
  })
  it('他形明跳过：旧语料 sched:x:1 / 前缀不属本岗 / 无 @ / 非 @ 后数字', () => {
    const legacy = ledgerOf('anchor-legacy')
    appendPatrol(legacy, 'T-1', 'daily-report', 'sched:daily-report:1')
    expect(ticketSentinelAnchor(legacy, 'T-1')).toBeUndefined() // 旧测试语料形——哨兵面不适用
    legacy.close()
    const alien = ledgerOf('anchor-alien')
    appendPatrol(alien, 'T-1', 'daily-report', 'other-job@123')
    expect(ticketSentinelAnchor(alien, 'T-1')).toBeUndefined() // 前缀不属本岗（锚归属闸）
    alien.close()
    const noAt = ledgerOf('anchor-noat')
    appendPatrol(noAt, 'T-1', 'daily-report', 'daily-report')
    expect(ticketSentinelAnchor(noAt, 'T-1')).toBeUndefined()
    noAt.close()
    const badTail = ledgerOf('anchor-badtail')
    appendPatrol(badTail, 'T-1', 'daily-report', 'daily-report@slot-7')
    expect(ticketSentinelAnchor(badTail, 'T-1')).toBeUndefined() // @ 后非纯数字
    badTail.close()
  })
  it('无 PATROL job= 锚（普通单/唤醒单）→ undefined', () => {
    const ledger = ledgerOf('anchor-none')
    expect(ticketSentinelAnchor(ledger, 'T-9')).toBeUndefined()
    ledger.close()
  })
})

describe('sentinelDutyForTicket：义务判定（管辖面收口）', () => {
  it('工单型岗单 → 期望三元组（nonce=期望重算）', () => {
    const ledger = ledgerOf('duty-report')
    appendPatrol(ledger, 'T-1', 'daily-report', `daily-report@${SLOT}`)
    ledger.upsertJob(reportJob('daily-report', { type: 'report', output: 'reports/工程部/' }))
    expect(sentinelDutyForTicket(ledger, 'T-1')).toEqual(expectedSentinel('demo', 'daily-report', SLOT))
    ledger.close()
  })
  it('patrol 巡查工件 → undefined（结构性不进——岗型治理诚实化）', () => {
    const ledger = ledgerOf('duty-patrol')
    appendPatrol(ledger, 'T-1', 'health-patrol', `health-patrol@${SLOT}`)
    ledger.upsertJob(reportJob('health-patrol', { type: 'patrol' }))
    expect(sentinelDutyForTicket(ledger, 'T-1')).toBeUndefined()
    ledger.close()
  })
  it('job 失联（热更移除）/锚不可解 → undefined', () => {
    const ghost = ledgerOf('duty-ghost')
    appendPatrol(ghost, 'T-1', 'ghost-job', `ghost-job@${SLOT}`)
    expect(sentinelDutyForTicket(ghost, 'T-1')).toBeUndefined()
    ghost.close()
    const unresolvable = ledgerOf('duty-unres')
    appendPatrol(unresolvable, 'T-1', 'daily-report', 'sched:daily-report:1')
    unresolvable.upsertJob(reportJob('daily-report', { type: 'report' }))
    expect(sentinelDutyForTicket(unresolvable, 'T-1')).toBeUndefined()
    unresolvable.close()
  })
})

describe('verifySidecarSentinel：四态 fail-closed', () => {
  const expected = expectedSentinel('demo', 'daily-report', SLOT)
  const okText = JSON.stringify({ schema: 'summary/v1', conclusion: 'x', sentinel: expected })

  it('undefined/空文 → missing（sidecar 缺）', () => {
    expect(verifySidecarSentinel(undefined, expected)).toBe('missing')
    expect(verifySidecarSentinel('   ', expected)).toBe('missing')
  })
  it('JSON 坏/非对象 → unreadable', () => {
    expect(verifySidecarSentinel('{not json', expected)).toBe('unreadable')
    expect(verifySidecarSentinel('"scalar"', expected)).toBe('unreadable')
  })
  it('sentinel 字段缺/形状坏 → missing', () => {
    expect(verifySidecarSentinel(JSON.stringify({ schema: 'summary/v1' }), expected)).toBe('missing')
    expect(verifySidecarSentinel(JSON.stringify({ sentinel: { job: 'x', run_at: 'not-number', nonce: 'z'.repeat(64) } }), expected)).toBe('missing')
    expect(verifySidecarSentinel(JSON.stringify({ sentinel: { ...expected, nonce: 'short' } }), expected)).toBe('missing')
  })
  it('三元组异 → mismatch（抄旧槽必落此档：同 job 异 run_at）', () => {
    const stale = expectedSentinel('demo', 'daily-report', SLOT - 7 * 24 * 3_600_000)
    expect(verifySidecarSentinel(JSON.stringify({ sentinel: stale }), expected)).toBe('mismatch')
    expect(verifySidecarSentinel(JSON.stringify({ sentinel: { ...expected, nonce: 'a'.repeat(64) } }), expected)).toBe('mismatch')
  })
  it('同三元组 → ok', () => {
    expect(verifySidecarSentinel(okText, expected)).toBe('ok')
  })
})

describe('verifySidecarSentinelAtPath：路径面（读不到=unreadable 如实暴露）', () => {
  const expected = expectedSentinel('demo', 'daily-report', SLOT)

  it('路径 undefined → missing；文件不存在/不可读 → unreadable', () => {
    expect(verifySidecarSentinelAtPath(undefined, expected)).toBe('missing')
    expect(verifySidecarSentinelAtPath(path.join(root, 'no-such.summary.json'), expected)).toBe('unreadable')
  })
  it('真文件过四态（与文本面同口径）', () => {
    const dir = path.join(root, 'sidecar')
    mkdirSync(dir, { recursive: true })
    const okFile = path.join(dir, 'a.summary.json')
    writeFileSync(okFile, JSON.stringify({ sentinel: expected }), 'utf8')
    expect(verifySidecarSentinelAtPath(okFile, expected)).toBe('ok')
    const badFile = path.join(dir, 'b.summary.json')
    writeFileSync(badFile, '}', 'utf8')
    expect(verifySidecarSentinelAtPath(badFile, expected)).toBe('unreadable')
  })
})

describe('sentinelBriefBlock：任务书 L4 注入段', () => {
  it('携三元组原样＋回写指令＋P3 欠账语义＋数据源断链义务', () => {
    const sent = expectedSentinel('demo', 'daily-report', SLOT)
    const block = sentinelBriefBlock(sent)
    expect(block).toContain('"sentinel"')
    expect(block).toContain(`"job":"daily-report"`)
    expect(block).toContain(`"run_at":${SLOT}`)
    expect(block).toContain(`"nonce":"${sent.nonce}"`)
    expect(block).toContain('summary.json')
    expect(block).toContain('SENTINEL_MISSING')
    expect(block).toContain('数据源断链')
    expect(block).toContain('不证产出质量') // 诚实边界明示
  })
})
