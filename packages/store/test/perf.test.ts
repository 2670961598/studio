/**
 * 130-P4·studio-dev-175：perf 五指标聚合件测试（批示⑥ 口径冻结——本文件即口径的判读标尺）。
 *
 * 覆盖面（130-提案 §6.6 五指标逐条＋归属律＋窗律）：
 *   - 闸过率 PASS/(PASS+FAIL)；零分母→null；
 *   - 打回=FAIL+QA_BACK+RESUME（实现岗口径）；
 *   - 时延 P50/P90 按 attempt 逐条（nearest-rank 口径可复算）；在途不计；零样本→null；
 *   - 证据完备度 HARVEST 三名命中＋REPORT 落盘率；REPORT_MISSING 不计；
 *   - 工时/成本/tokens Σ＋失败尝试计（真实成本观）；
 *   - 事件归属=单→最近 work_record（跨窗参与判定）；无记录→(unattributed)；
 *   - 全零行不产出；行序 person_id 升序；
 *   - reports 值域收 perf-weekly（ledger.insertReport/listReports 往返）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import {
  UNATTRIBUTED_PERSON,
  gateRate,
  harvestHits,
  openLedger,
  perfPercentile,
  perfPersonRows,
  rejectionCount,
  reportRate,
  type WorkRecord,
} from '../src/index.ts'

// —— 语料构造（纯函数面：直接拼记录形状，零库依赖） ——

type EventName =
  | 'GATE_PASS' | 'GATE_FAIL' | 'QA_BACK' | 'RESUME'
  | 'HARVEST_INCOMPLETE' | 'HARVEST_DENIED' | 'HARVEST_INVALID' | 'DISPATCH' | 'REPORT_MISSING'

let seq = 0
function ev(event: EventName, issue: string, ts: number, company = 'studio-dev'): EventRecord {
  seq += 1
  return {
    id: `01TESTPERF${String(seq).padStart(8, '0')}`,
    ts,
    company,
    issue,
    event,
    actor: 'ENG-4:eng-4',
    attempt: 1,
    level: 3,
    dept: 'departments/研发部',
    tokens: { input: 100, output: 50 },
  }
}

function wr(issue: string, personId: string, startedAt: number, endedAt?: number, costUsd?: number): WorkRecord {
  seq += 1
  return {
    id: `wr-${String(seq).padStart(6, '0')}`,
    issue,
    person_id: personId,
    executor: 'dsh',
    started_at: startedAt,
    ended_at: endedAt,
    cost_usd: costUsd,
    tokens: endedAt === undefined ? undefined : { input: 1000, output: 500, cache_read: 200 },
    attempt: 1,
    status: endedAt === undefined ? 'running' : 'done',
  }
}

const H = 3_600_000
const SINCE = Date.UTC(2026, 9, 19) // 2026-10-19 周一 00:00Z（ISO 周）
const UNTIL = Date.UTC(2026, 9, 25, 23, 59, 59, 999) // 2026-10-25 周日末（闭区间）

describe('perfPersonRows 五指标聚合（批示⑥ 冻结口径）', () => {
  it('闸过率=PASS/(PASS+FAIL)，零分母→null 如实', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [
        ev('GATE_PASS', 'T-1', SINCE + 1),
        ev('GATE_PASS', 'T-1', SINCE + 2),
        ev('GATE_FAIL', 'T-1', SINCE + 3),
        ev('GATE_PASS', 'T-2', SINCE + 4), // T-2 无 work_record → unattributed
      ],
      workRecords: [wr('T-1', 'ENG-4', SINCE, SINCE + H)],
    })
    const e4 = rows.find((r) => r.person_id === 'ENG-4')
    const un = rows.find((r) => r.person_id === UNATTRIBUTED_PERSON)
    expect(e4?.events.gate_pass).toBe(2)
    expect(e4?.events.gate_fail).toBe(1)
    expect(gateRate(e4!)).toBeCloseTo(2 / 3, 10)
    expect(un?.events.gate_pass).toBe(1)
    expect(gateRate(un!)).toBe(1)
    // 零分母：只有工时行（无 GATE 事件）→ gateRate null
    const onlyWork = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [],
      workRecords: [wr('T-3', 'ENG-9', SINCE, SINCE + H)],
    })
    expect(gateRate(onlyWork[0]!)).toBeNull()
  })

  it('打回=FAIL+QA_BACK+RESUME（实现岗口径——提案打回不进个人面）', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [
        ev('GATE_FAIL', 'T-1', SINCE + 1),
        ev('QA_BACK', 'T-1', SINCE + 2),
        ev('RESUME', 'T-1', SINCE + 3),
        ev('GATE_PASS', 'T-1', SINCE + 4),
      ],
      workRecords: [wr('T-1', 'ENG-4', SINCE, SINCE + H)],
    })
    expect(rejectionCount(rows[0]!)).toBe(3)
  })

  it('时延 P50/P90 nearest-rank 按 attempt 逐条；在途不计；零样本→null', () => {
    const durations = [10, 20, 30, 40]
    expect(perfPercentile(durations, 0.5)).toBe(20) // ⌈0.5·4⌉=2 位
    expect(perfPercentile(durations, 0.9)).toBe(40) // ⌈0.9·4⌉=4 位
    expect(perfPercentile([7], 0.5)).toBe(7)
    expect(perfPercentile([], 0.5)).toBeNull()
    // 在途（ended 空）不计入工时面
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [],
      workRecords: [wr('T-1', 'ENG-4', SINCE, undefined)],
    })
    expect(rows).toHaveLength(0) // 在途不产生任何工时行（全零行不产出）
  })

  it('证据完备度=HARVEST 三名命中＋REPORT 落盘率；REPORT_MISSING 不计', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [
        ev('GATE_PASS', 'T-1', SINCE + 1),
        ev('HARVEST_INCOMPLETE', 'T-1', SINCE + 2),
        ev('HARVEST_DENIED', 'T-2', SINCE + 3),
        ev('HARVEST_INVALID', 'T-2', SINCE + 4),
        ev('REPORT_MISSING', 'T-1', SINCE + 5), // 归档搬运缺陷——不计个人证据面
      ],
      workRecords: [wr('T-1', 'ENG-4', SINCE, SINCE + H), wr('T-2', 'ENG-4', SINCE, SINCE + H)],
    })
    const row = rows[0]!
    expect(harvestHits(row)).toBe(3)
    expect(reportRate(row)).toBeCloseTo(1 / 4, 10)
  })

  it('工时/成本/tokens Σ（失败尝试也计——真实成本观）', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [],
      workRecords: [
        wr('T-1', 'ENG-4', SINCE, SINCE + 2 * H, 1.5),
        wr('T-1', 'ENG-4', SINCE + 3 * H, SINCE + 4 * H, 0.5), // 失败重试也计
        wr('T-2', 'ENG-4', SINCE + 5 * H, SINCE + 8 * H, 2), // 窗内
      ],
    })
    expect(rows[0]!.attempts).toBe(3)
    expect(rows[0]!.hours_ms).toBe(6 * H)
    expect(rows[0]!.work_cost_usd).toBeCloseTo(4, 10)
    expect(rows[0]!.work_tokens_total).toBe(3 * 1700)
  })

  it('事件归属=单→最近一条 work_record（跨窗参与判定）；窗律：ts/ended 落窗闭区间', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [
        ev('GATE_PASS', 'T-1', SINCE), // 恰在窗界（闭区间）
        ev('GATE_PASS', 'T-2', UNTIL + 1), // 窗外弃
        ev('GATE_PASS', 'T-3', SINCE + 1), // T-3 归属最近记录人=ENG-9（跨窗记录参与判定）
      ],
      workRecords: [
        wr('T-1', 'ENG-4', SINCE - 10 * H, SINCE - 5 * H), // 全在窗外（工时面不计）但参与 T-1 归属
        wr('T-3', 'ENG-4', SINCE - 10 * H, SINCE - 5 * H),
        wr('T-3', 'ENG-9', SINCE - 4 * H, SINCE - 2 * H), // 更近 → T-3 归 ENG-9
      ],
    })
    const e4 = rows.find((r) => r.person_id === 'ENG-4')
    const e9 = rows.find((r) => r.person_id === 'ENG-9')
    expect(e4?.events.gate_pass).toBe(1) // T-1
    expect(e9?.events.gate_pass).toBe(1) // T-3
    expect(e4?.attempts).toBe(0) // 工时面全在窗外
  })

  it('全零行不产出；行序 person_id 升序', () => {
    const rows = perfPersonRows({
      since: SINCE,
      until: UNTIL,
      events: [ev('DISPATCH', 'T-1', SINCE + 1)], // DISPATCH 不计入闭集
      workRecords: [wr('T-2', 'ENG-9', SINCE, SINCE + H, 1), wr('T-3', 'ENG-4', SINCE, SINCE + H)],
    })
    expect(rows.map((r) => r.person_id)).toEqual(['ENG-4', 'ENG-9'])
    expect(rows.every((r) => r.events.gate_pass === 0)).toBe(true)
  })
})

// —— reports 值域收 perf-weekly（台账往返） ——

let root = ''
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-perf-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('reports type 值域 perf-weekly（130-P4/批示⑥）', () => {
  it('insertReport/listReports 往返 perf-weekly 行（node=部门 path）', async () => {
    const dbPath = path.join(root, 'perf-reports.db')
    const ledger = openLedger(dbPath)
    ledger.insertReport({
      id: 'perf-abc123def456',
      company: 'studio-dev',
      node: 'departments/研发部',
      type: 'perf-weekly',
      date: '2026-10-25',
      caliber: 'perf/v1',
      json_ref: 'reports/2026-10-25-perf-weekly-研发部-x.json',
    })
    const rows = ledger.listReports({ company: 'studio-dev', type: 'perf-weekly' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.node).toBe('departments/研发部')
    expect(rows[0]?.caliber).toBe('perf/v1')
    ledger.close()
  })
})

