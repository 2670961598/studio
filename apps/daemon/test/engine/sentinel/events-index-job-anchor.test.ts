/**
 * events-index 岗单锚 —— jobAnchorOf 派生（studio-dev-196 模型档执行面第 2 级消费位）。
 *
 * 口径同 jobs-sources jobTickets：PATROL note 携 `job=<id>`（物化单 engine/intents/drain.ts
 * 落账形 `intent=…;job=<id>;cron=…;role=…;dedup=…`）→ ticket→jobId（last-write-wins——
 * 每岗每拍恒同单号，覆盖幂等）。结构性盲区保持：唤醒/mention 类 PATROL note 刻意不含
 * job= 字段（taxonomy.ts SLA 盲区纪律）→ 恒 undefined，不误入岗档解析。
 */
import { describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import { buildEventIndex } from '../../../src/engine/sentinel/events-index.ts'

const DEPT = 'departments/工程部'

describe('buildEventIndex 岗单锚（jobAnchorOf）', () => {
  let n = 0
  const ev = (event: string, note: string | undefined, issue = 'T-1'): EventRecord => {
    n += 1
    return {
      id: `01JTEST${String(n).padStart(10, '0')}`,
      ts: n,
      company: 'demo',
      issue,
      event,
      actor: 'daemon',
      attempt: 1,
      level: 1,
      dept: DEPT,
      ...(note !== undefined ? { note } : {}),
    } as EventRecord
  }

  it('物化单 PATROL note 携 job= → 该岗 id（drain.ts 落账形逐字段）', () => {
    const idx = buildEventIndex([
      ev('PATROL', 'intent=schedule|job=daily-report|demo;job=daily-report;cron=0 9 * * *;role=main_worker;dedup=daily-report@2026-10-23'),
    ])
    expect(idx.jobAnchorOf('T-1')).toBe('daily-report')
  })

  it('多岗多单分键；同单重物化 last-write-wins（覆盖幂等）', () => {
    const idx = buildEventIndex([
      ev('PATROL', 'intent=a;job=job-a', 'T-1'),
      ev('PATROL', 'intent=b;job=job-b', 'T-2'),
      ev('PATROL', 'intent=a2;job=job-a2', 'T-1'), // 同单后写覆盖
    ])
    expect(idx.jobAnchorOf('T-1')).toBe('job-a2')
    expect(idx.jobAnchorOf('T-2')).toBe('job-b')
    expect(idx.jobAnchorOf('T-3')).toBeUndefined()
  })

  it('结构性盲区保持：无 job= 的 PATROL（唤醒/mention 面）与非 PATROL 事件不立锚', () => {
    const idx = buildEventIndex([
      ev('PATROL', 'intent=mention|…;外部动态字段（无 job=——SLA 盲区纪律，taxonomy.ts）'),
      ev('DISPATCH', 'fp=…;job=spoof', 'T-1'), // 非 PATROL 面=派发词表，不进岗锚
      ev('STALL'),
    ])
    expect(idx.jobAnchorOf('T-1')).toBeUndefined()
  })
})
