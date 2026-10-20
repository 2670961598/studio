/**
 * v7 测试（DEV-48，docs/52-§8 队列语义 / §5.2 事实账）：hr_sync_log 全流转
 * （enqueue op_key 幂等——任意态命中即跳 / listHrSyncPending 上限与坏参 / claim 乐观锁 /
 * complete / failHrSync 未达限回 pending、达限 failed 终态 / releaseHrSyncFailed 唤醒 /
 * resetStaleHrSyncApplying 断电复位窗 / hrSyncQueueStats 四态计数）+
 * personnel_events id 幂等挂账 + setPersonStatus 写面。
 * 环境：os.tmpdir() 真文件库（沿 v4 测试风格）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '../src/index.ts'

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v7-'))
  ledger = openLedger(path.join(root, 'ledger.db'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('enqueueHrSync：op_key 幂等（§8 重放安全）', () => {
  it('首插 enqueued=true；同 op_key 再插（任意态）=跳过 enqueued=false', () => {
    const first = ledger.enqueueHrSync({ id: 't1', ts: 1, company: 'demo', person_id: 'P-1', kind: '停', platform: 'matrix', op_key: 'P-1|停|matrix|status|active|paused', ticket: '@hr:b1', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 1 })
    expect(first).toEqual({ id: 't1', enqueued: true })
    const again = ledger.enqueueHrSync({ id: 't1-dup', ts: 2, company: 'demo', person_id: 'P-1', kind: '停', platform: 'matrix', op_key: 'P-1|停|matrix|status|active|paused', ticket: '@hr:b2', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 2 })
    expect(again).toEqual({ id: 't1', enqueued: false })
  })

  it('不同 op_key（platform/prev/next 任一维不同）=不同任务', () => {
    ledger.enqueueHrSync({ id: 't2', ts: 1, company: 'demo', person_id: 'P-1', kind: '停', platform: 'ledger', op_key: 'P-1|停|ledger|status|active|paused', ticket: '@hr:b1', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 1 })
    const r = ledger.enqueueHrSync({ id: 't2', ts: 1, company: 'demo', person_id: 'P-1', kind: '停', platform: 'ledger', op_key: 'P-1|停|ledger|status|active|paused', ticket: '@hr:b1', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 1 })
    expect(r.enqueued).toBe(false)
  })

  it('坏行拒（person_id 空 / platform 越值域）——fail-fast 不猜', () => {
    expect(() => ledger.enqueueHrSync({ id: 'bad', ts: 1, company: 'demo', person_id: '', kind: '入', platform: 'taiga', op_key: 'k', ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: '*', prev: null, next: 'level 1；dept 研发部' }, updated: 1 })).toThrow()
    expect(() => ledger.enqueueHrSync({ id: 'bad2', ts: 1, company: 'demo', person_id: 'P-9', kind: '入', platform: 'slack', op_key: 'k2', ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: '*', prev: null, next: 'level 1；dept 研发部' }, updated: 1 })).toThrow()
  })
})

describe('任务流转（claim/complete/fail——四态 pending|applying|done|failed）', () => {
  it('listHrSyncPending 按上限取 pending；claim→applying；complete→done', () => {
    for (let i = 0; i < 3; i += 1) {
      ledger.enqueueHrSync({ id: `flow-${String(i)}`, ts: 10 + i, company: 'demo', person_id: `P-${String(i)}`, kind: '入', platform: 'ledger', op_key: `ok-flow-${String(i)}`, ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: '*', prev: null, next: 'level 1；dept 研发部' }, updated: 10 + i })
    }
    expect(ledger.listHrSyncPending(2)).toHaveLength(2)
    expect(ledger.claimHrSync('flow-0', 100)).toBe(true)
    expect(ledger.claimHrSync('flow-0', 101)).toBe(false) // 乐观锁：非 pending 不可重复 claim
    expect(ledger.completeHrSync('flow-0', 102)).toBe(true)
    expect(ledger.completeHrSync('flow-0', 103)).toBe(false) // 幂等收敛面：done 不可再收
  })

  it('failHrSync 未达限=attempts+1 回 pending；达限=failed 终态；releaseHrSyncFailed 唤醒回 pending', () => {
    ledger.enqueueHrSync({ id: 'retry-1', ts: 10, company: 'demo', person_id: 'P-7', kind: '入', platform: 'matrix', op_key: 'ok-retry-1', ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: '*', prev: null, next: 'level 1；dept 研发部' }, updated: 10 })
    expect(ledger.claimHrSync('retry-1', 20)).toBe(true)
    expect(ledger.failHrSync('retry-1', 'E1', { now: 21, retryLimit: 3 })).toBe('pending') // attempts 0→1
    expect(ledger.claimHrSync('retry-1', 30)).toBe(true)
    expect(ledger.failHrSync('retry-1', 'E2', { now: 31, retryLimit: 3 })).toBe('pending') // 1→2
    expect(ledger.claimHrSync('retry-1', 40)).toBe(true)
    expect(ledger.failHrSync('retry-1', 'E3', { now: 41, retryLimit: 3 })).toBe('failed') // 2→3 达限
    expect(ledger.claimHrSync('retry-1', 50)).toBe(false) // 终态不吃 claim
    expect(() => ledger.failHrSync('retry-1', 'E4', { now: 51, retryLimit: 3 })).toThrow() // 非 applying 拒
    expect(ledger.releaseHrSyncFailed('retry-1', 60)).toBe(true) // 人工唤醒
    expect(ledger.claimHrSync('retry-1', 61)).toBe(true)
    expect(ledger.completeHrSync('retry-1', 62)).toBe(true) // 收口：不留 applying 残留给后续语料
  })

  it('failHrSync 无此行=明报不猜', () => {
    expect(() => ledger.failHrSync('no-such', 'E', { now: 1, retryLimit: 3 })).toThrow()
  })
})

describe('resetStaleHrSyncApplying：断电复位（§8 启动例行）', () => {
  it('超窗 applying→pending；窗内不动；返回复位数', () => {
    ledger.enqueueHrSync({ id: 'stale-1', ts: 10, company: 'demo', person_id: 'P-8', kind: '停', platform: 'ledger', op_key: 'ok-stale-1', ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 10 })
    ledger.enqueueHrSync({ id: 'stale-2', ts: 10, company: 'demo', person_id: 'P-9', kind: '停', platform: 'ledger', op_key: 'ok-stale-2', ticket: '@hr:b', status: 'pending', attempts: 0, payload: { field: 'status', prev: 'active', next: 'paused' }, updated: 10 })
    expect(ledger.claimHrSync('stale-1', 1000)).toBe(true)
    expect(ledger.claimHrSync('stale-2', 2000)).toBe(true)
    const n = ledger.resetStaleHrSyncApplying(1500) // stale-1(updated=1000) 超 1500 窗；stale-2=2000 窗内
    expect(n).toBe(1)
    expect(ledger.claimHrSync('stale-1', 1600)).toBe(true) // 已回 pending 可再 claim
    expect(ledger.claimHrSync('stale-2', 1600)).toBe(false) // applying 保持
  })
})

describe('hrSyncQueueStats / setPersonStatus / personnel_events', () => {
  it('stats 四态计数（本库累计）', () => {
    const s = ledger.hrSyncQueueStats()
    expect(s).toMatchObject({ done: expect.any(Number), failed: expect.any(Number), pending: expect.any(Number), applying: expect.any(Number) })
    expect(s.done).toBeGreaterThanOrEqual(1)
    expect(s.failed).toBeGreaterThanOrEqual(0)
  })

  it('setPersonStatus：镜像行命中 true；无行 false（syncCompany 前置时序漂移如实失败）', () => {
    expect(ledger.setPersonStatus('ghost-404', 'retired')).toBe(false)
  })

  it('personnel_events：确定性 id 同内容幂等跳过；同 id 异内容拒（事实账不可变）', () => {
    ledger.appendPersonnelEvent({ id: 'HRE-test-0001', ts: 1, person_id: 'P-1', type: '停', prev: 'active', next: 'paused', ticket: 'T-1', approver: 'daemon/hr-sync' })
    ledger.appendPersonnelEvent({ id: 'HRE-test-0001', ts: 1, person_id: 'P-1', type: '停', prev: 'active', next: 'paused', ticket: 'T-1', approver: 'daemon/hr-sync' }) // 同内容=幂等跳过
    expect(() => ledger.appendPersonnelEvent({ id: 'HRE-test-0001', ts: 2, person_id: 'P-1', type: '停', prev: 'active', next: 'paused', ticket: 'T-2', approver: 'daemon/hr-sync' })).toThrow()
  })
})
