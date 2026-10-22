/**
 * freshness 单元面 —— 127-A R2 定时岗新鲜度窗哨兵源（studio-dev-127 §4.3 批示④全批）
 *
 * 断言即规格（docs/35-§3 计时器族第三源——tick 驱动、零内存态、事件派生幂等）：
 *   - grace 解析序：payload.grace_ms > cadence 档缺省（hourly 10m/daily 2h/weekly 12h）
 *     > cron 周期桶（≤90min→10m、≤36h→2h、else 12h；坏 cron 从宽 12h）；
 *   - DST 豁免量：slot/now 同 offset=0；恒非负；
 *   - 尖刺四态：①停跑 JOB_STALE ②从未跑 LATE_FIRST_RUN（配置坏≠跑了没产出）
 *     ③窗内不报 ④逃逸档白名单跳过；
 *   - 幂等：同岗同槽只告一次（事件派生——重启天然恢复）；新槽位新记账；
 *   - note 四元组（hb_age/job_status/patrol_age/last_success_age 如实 '-'/'never'）
 *     ＋处置=手动补跑（jobs catchup）不自动重派；
 *   - 装载警告：patrol 无 T:patrol 流① / patrol×output 并存②；declaredTypeIdsOf T: 键集。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import {
  createFreshnessSource,
  declaredTypeIdsOf,
  dstAdjustMs,
  FRESHNESS_SOURCE_NAME,
  graceMsFor,
  jobContractLoadWarnings,
  type FreshnessSource,
} from '../../../src/engine/jobs/freshness.ts'

let root = ''
const T0 = new Date(2026, 9, 16, 12, 0, 0).getTime()

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-freshness-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function ledgerOf(id: string): Ledger {
  return openLedger(path.join(root, `${id}.sqlite`))
}

function job(partial: Partial<JobRecord> & { job_id: string }): JobRecord {
  return {
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload: {},
    next_run_at: T0,
    ...partial,
  }
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents({ company: 'demo' }).filter((e) => e.event === name)
}

/** 源构造（intervalMs 巨大=定时器不掺和；手动泵 poll 断言） */
function sourceOf(ledger: Ledger, clock: () => number): FreshnessSource {
  return createFreshnessSource({
    ledger,
    clock,
    company: 'demo',
    intervalMs: 3_600_000,
    heartbeatIssue: 'HEARTBEAT-哨兵',
    makeId: (ts: number) => makeUlid(ts),
  })
}

describe('graceMsFor：解析序（逐岗声明 > 档缺省 > cron 桶）', () => {
  it('payload.grace_ms 最先（逐岗声明压一切）', () => {
    expect(graceMsFor(job({ job_id: 'a', payload: { grace_ms: 42_000 } }), T0)).toBe(42_000)
  })
  it('cadence 档缺省（批示④冻结：hourly 10m/daily 2h/weekly 12h）', () => {
    expect(graceMsFor(job({ job_id: 'h', payload: { cadence_tier: 'hourly' } }), T0)).toBe(10 * 60_000)
    expect(graceMsFor(job({ job_id: 'd', payload: { cadence_tier: 'daily' } }), T0)).toBe(2 * 3_600_000)
    expect(graceMsFor(job({ job_id: 'w', payload: { cadence_tier: 'weekly' } }), T0)).toBe(12 * 3_600_000)
  })
  it('cron 周期桶：*/5→10m；daily→2h；monthly→12h', () => {
    expect(graceMsFor(job({ job_id: 'p5', cron: '*/5 * * * *' }), T0)).toBe(10 * 60_000)
    expect(graceMsFor(job({ job_id: 'p18', cron: '0 18 * * *' }), T0)).toBe(2 * 3_600_000)
    expect(graceMsFor(job({ job_id: 'pm', cron: '0 9 1 * *' }), T0)).toBe(12 * 3_600_000)
  })
  it('坏 cron 从宽 12h（永不 undefined）', () => {
    expect(graceMsFor(job({ job_id: 'bad', cron: 'not-a-cron' }), T0)).toBe(12 * 3_600_000)
  })
})

describe('dstAdjustMs：DST 豁免量', () => {
  it('同 offset=0；恒非负', () => {
    expect(dstAdjustMs(T0, T0 + 3_600_000)).toBe(0)
    expect(dstAdjustMs(T0, T0 + 3_600_000)).toBeGreaterThanOrEqual(0)
  })
})

describe('尖刺四态（①停跑②从未跑③窗内④逃逸档）', () => {
  it('① 停跑：last_run_at 在案、越窗 → JOB_STALE 一次；同槽重扫不重发', () => {
    const ledger = ledgerOf('spike-stale')
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: T0 - 3_600_000 }))
    let now = T0 + 10 * 60_000 // next_run_at(T0)+1m grace 已过
    const src = sourceOf(ledger, () => now)
    const r1 = src.poll()
    expect(r1).toMatchObject({ jobs: 1, stale: 1, lateFirstRun: 0 })
    const note = eventsOf(ledger, 'JOB_STALE')[0]?.note
    expect(note).toContain('停跑')
    expect(note).toContain(`src=${FRESHNESS_SOURCE_NAME};job=daily;slot=${T0}`)
    expect(note).toContain('hb_age=-') // 无心跳如实
    expect(note).toContain('patrol_age=-') // 从未物化如实
    expect(note).toContain('last_success_age=never') // 从未收割成功如实
    expect(note).toContain('jobs catchup') // 处置=手动补跑
    const r2 = src.poll() // 同槽重扫
    expect(r2).toMatchObject({ stale: 0 })
    expect(eventsOf(ledger, 'JOB_STALE')).toHaveLength(1) // 幂等
    expect(src.stats).toMatchObject({ polls: 2, stale: 1 })
    now = T0 + 20 * 60_000
    src.poll() // 时间前进但槽未推进——仍不重发
    expect(eventsOf(ledger, 'JOB_STALE')).toHaveLength(1)
    ledger.close()
  })
  it('新槽位新记账（补跑/到点推进 next_run_at 即换键）', () => {
    const ledger = ledgerOf('spike-reslot')
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: T0 - 3_600_000 }))
    let now = T0 + 10 * 60_000
    const src = sourceOf(ledger, () => now)
    src.poll()
    expect(eventsOf(ledger, 'JOB_STALE')).toHaveLength(1)
    // 推进槽（CLI catchup 同语义：next_run_at=now）
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: now, next_run_at: now }))
    now += 10 * 60_000 // 新槽又越窗
    const r = src.poll()
    expect(r).toMatchObject({ stale: 1 })
    expect(eventsOf(ledger, 'JOB_STALE')).toHaveLength(2) // 新槽新记账
    ledger.close()
  })
  it('② 从未跑：last_run_at 空 → LATE_FIRST_RUN（配置坏≠跑了没产出）', () => {
    const ledger = ledgerOf('spike-late')
    ledger.upsertJob(job({ job_id: 'fresh-job', payload: { grace_ms: 60_000 } }))
    const src = sourceOf(ledger, () => T0 + 10 * 60_000)
    const r = src.poll()
    expect(r).toMatchObject({ lateFirstRun: 1, stale: 0 })
    const note = eventsOf(ledger, 'LATE_FIRST_RUN')[0]?.note
    expect(note).toContain('从未跑过')
    expect(note).toContain('last_run_at=-')
    expect(eventsOf(ledger, 'LATE_FIRST_RUN')[0]?.issue).toBe('HEARTBEAT-哨兵') // 事件锚=心跳哨兵单
    ledger.close()
  })
  it('③ 窗内：now ≤ next_run_at+grace → 零事件', () => {
    const ledger = ledgerOf('spike-inwin')
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: T0 }))
    const src = sourceOf(ledger, () => T0 + 30_000) // 窗内
    expect(src.poll()).toMatchObject({ jobs: 1, stale: 0, lateFirstRun: 0 })
    expect(ledger.queryEvents({ company: 'demo' })).toHaveLength(0)
    ledger.close()
  })
  it('④ 逃逸档白名单（paused/manual/offline/下线）跳过；他司岗不扫', () => {
    const ledger = ledgerOf('spike-skip')
    ledger.upsertJob(job({ job_id: 'paused-job', status: 'paused', payload: { grace_ms: 60_000 } }))
    ledger.upsertJob(job({ job_id: 'manual-job', status: 'manual', payload: { grace_ms: 60_000 } }))
    ledger.upsertJob(job({ job_id: 'off-job', status: 'offline', payload: { grace_ms: 60_000 } }))
    ledger.upsertJob(job({ job_id: 'alien', company: 'other-corp', status: undefined, payload: { grace_ms: 60_000 } }))
    const src = sourceOf(ledger, () => T0 + 10 * 60_000)
    expect(src.poll()).toMatchObject({ jobs: 0 }) // 全逃逸/他司——扫描集空
    expect(ledger.queryEvents({ company: 'demo' })).toHaveLength(0)
    ledger.close()
  })
  it('四元组数据面：末次心跳/PATROL/GATE_PASS 龄如实进 note', () => {
    const ledger = ledgerOf('spike-quad')
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: T0 - 3_600_000 }))
    const at = (ts: number): string => makeUlid(ts)
    // 心跳 + 该岗物化 PATROL + 该岗单 GATE_PASS（ts 各异——断言取「最近一条」）
    ledger.appendEvent({ id: at(T0 - 9 * 60_000), ts: T0 - 9 * 60_000, company: 'demo', issue: 'HEARTBEAT-哨兵', event: 'HEARTBEAT', actor: 'daemon', attempt: 1, level: 1, dept: 'departments/工程部', tokens: { input: 0 }, note: 'tick' } satisfies EventRecord)
    ledger.appendEvent({ id: at(T0 - 8 * 60_000), ts: T0 - 8 * 60_000, company: 'demo', issue: 'T-7', event: 'PATROL', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/工程部', tokens: { input: 0 }, note: 'intent=x;job=daily;dedup=daily@1' } satisfies EventRecord)
    ledger.appendEvent({ id: at(T0 - 7 * 60_000), ts: T0 - 7 * 60_000, company: 'demo', issue: 'T-7', event: 'GATE_PASS', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/工程部', tokens: { input: 0 }, note: '四要件齐' } satisfies EventRecord)
    const now = T0 + 10 * 60_000
    const src = sourceOf(ledger, () => now)
    src.poll()
    const note = eventsOf(ledger, 'JOB_STALE')[0]?.note
    expect(note).toContain(`hb_age=${now - (T0 - 9 * 60_000)}`)
    expect(note).toContain(`patrol_age=${now - (T0 - 8 * 60_000)}`)
    expect(note).toContain(`last_success_age=${now - (T0 - 7 * 60_000)}`)
    expect(note).toContain('job_status=active') // status 空=active 缺省
    ledger.close()
  })
  it('start/stop 生命周期：stop 后可再 start（running 旗防双启）；异常吞掉面归 timer 侧', () => {
    const ledger = ledgerOf('spike-lifecycle')
    ledger.upsertJob(job({ job_id: 'daily', payload: { grace_ms: 60_000 }, last_run_at: T0 }))
    const src = sourceOf(ledger, () => T0 + 10 * 60_000)
    src.start()
    src.stop()
    src.start() // 不炸
    src.stop()
    // 直接泵在依赖坏死（库已关）时如实抛——「吞掉不炸循环」的合同面在 timer 轮询体
    // （源侧契约 25-§3.4.5：start 后 setInterval 内 try/catch 计 errors）——手动泵不代吞
    ledger.close()
    expect(() => src.poll()).toThrow()
    src.stop()
  })
})

describe('declaredTypeIdsOf：FlowTable T: 键 → 类型 id 集', () => {
  it('T: 前缀剥离；非 T 键不入；undefined → 空集', () => {
    expect(declaredTypeIdsOf({ 'T:patrol': {}, 'T:spike': {}, L0: {}, L2: {} })).toEqual(new Set(['patrol', 'spike']))
    expect(declaredTypeIdsOf(undefined)).toEqual(new Set())
  })
})

describe('jobContractLoadWarnings：岗契约装载警告（①缺流②组合）', () => {
  it('① patrol 岗无 T:patrol 类型流 → 退化警告；声明后消失', () => {
    const jobs = [{ job_id: 'p1', payload: { type: 'patrol' } }]
    const w1 = jobContractLoadWarnings(jobs, new Set())
    expect(w1).toHaveLength(1)
    expect(w1[0]).toContain('p1')
    expect(w1[0]).toContain('语义退化')
    expect(jobContractLoadWarnings(jobs, new Set(['patrol']))).toHaveLength(0)
  })
  it('② patrol×output 并存 → 结构性零产出警告（声明 T:patrol 不豁免组合面）', () => {
    const jobs = [{ job_id: 'p2', payload: { type: 'patrol', output: 'reports/x/' } }]
    const w = jobContractLoadWarnings(jobs, new Set(['patrol']))
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('结构性零产出')
    expect(w[0]).toContain('reports/x/')
  })
  it('工单型岗/无 payload 岗 → 零警告', () => {
    expect(jobContractLoadWarnings([{ job_id: 'r1', payload: { type: 'report', output: 'reports/x/' } }, { job_id: 'bare' }], new Set())).toHaveLength(0)
  })
})
