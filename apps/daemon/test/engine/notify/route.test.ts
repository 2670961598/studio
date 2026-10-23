/**
 * notify 路由表单测（105-刀B-2，studio-dev-219）：冻结路由逐事件断言 + 低噪纪律
 * （不在表=不广播）+ `;output=` 日报产物分流 + cost 警戒计划 + 摘要件低噪形。
 */
import { describe, expect, it } from 'vitest'
import { planCostNoticeBroadcast, planEventBroadcast, reportOutputOf } from '../../../src/engine/notify/route.ts'
import type { EventRecord } from '@studio-next/contract'

const FROM = 'daemon@studio-dev（bot 代发）'

function evt(event: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: '01JTESTTESTTESTTESTTESTT',
    ts: 1_700_000_000_000,
    company: 'studio-dev',
    issue: 'STUDIO-100',
    event,
    actor: 'daemon',
    attempt: 1,
    level: 3,
    dept: 'departments/研发部',
    tokens: { input: 0 },
    ...overrides,
  } as EventRecord
}

describe('planEventBroadcast（冻结路由表）', () => {
  it('GATE_PASS → alert+dept+overview 全文，digest=单行摘要（低噪总览）', () => {
    const plan = planEventBroadcast(evt('GATE_PASS', { note: '四要件齐；report=REPORT.md;tokens=12' }), FROM)
    expect(plan?.kind).toBe('gate')
    expect(plan?.targets).toEqual({ alert: true, dept: 'departments/研发部', overview: true })
    expect(plan?.message.title).toBe('过闸 STUDIO-100')
    expect(plan?.message.body).toBe('四要件齐；report=REPORT.md;tokens=12')
    expect(plan?.digest.body).toBe('四要件齐')
    expect(plan?.message.from).toBe(FROM)
  })

  it('GATE_PASS note 携 ;output= → 日报产物：只进部门频道（alert/overview 关）', () => {
    const note = '四要件齐；report=…;output=/var/reports/studio-dev/daily/2026-10-27.md'
    const plan = planEventBroadcast(evt('GATE_PASS', { note }), FROM)
    expect(plan?.kind).toBe('report')
    expect(plan?.targets).toEqual({ alert: false, dept: 'departments/研发部', overview: false })
    expect(plan?.message.body).toContain('/var/reports/studio-dev/daily/2026-10-27.md')
  })

  it('reportOutputOf：`;output=` 段提取（无段=undefined；行首/中段都可）', () => {
    expect(reportOutputOf('四要件齐;output=/a/b.md')).toBe('/a/b.md')
    expect(reportOutputOf('output=/a/b.md;tail')).toBe('/a/b.md')
    expect(reportOutputOf('四要件齐；无产物')).toBeUndefined()
    expect(reportOutputOf(undefined)).toBeUndefined()
  })

  it('STALL/CIRCUIT_BREAK/DAILY_ALARM → alert+dept+overview（警戒族三连）', () => {
    for (const [event, kind] of [['STALL', 'stall'], ['CIRCUIT_BREAK', 'breaker'], ['DAILY_ALARM', 'alarm']] as const) {
      const plan = planEventBroadcast(evt(event, { note: '看门狗告警第 1/2 次' }), FROM)
      expect(plan?.kind).toBe(kind)
      expect(plan?.targets).toEqual({ alert: true, dept: 'departments/研发部', overview: true })
    }
  })

  it('低噪纪律：不在冻结表的事件不广播（DISPATCH/PATROL/GATE_FAIL/ESCALATE…）', () => {
    for (const event of ['DISPATCH', 'PATROL', 'GATE_FAIL', 'ESCALATE', 'HEARTBEAT', 'HARVEST_DENIED', 'QUARANTINE', 'RESUME']) {
      expect(planEventBroadcast(evt(event), FROM)).toBeUndefined()
    }
  })

  it('digestFact：note 首段截 120 字（长 note 不撑爆总览频道）', () => {
    const long = `${'长'.repeat(200)}；第二段`
    const plan = planEventBroadcast(evt('STALL', { note: long }), FROM)
    expect(plan?.digest.body.length).toBe(120)
    expect(plan?.digest.body).not.toContain('第二段')
  })
})

describe('planCostNoticeBroadcast（escalate 警戒→IM，129 批示项④）', () => {
  const notice = {
    scope: 'company',
    period: '2026-10-27',
    tier: 'warn',
    route: 'notify',
    pct: 85,
    runningUsd: 8.5,
    budgetUsd: 10,
    target: 'PRIME-0',
    dedupKey: 'company:2026-10-27:warn',
    staleFlag: false,
  }
  it('alert+target 部门+overview 成本摘要；正文含用量/对象/幂等键', () => {
    const plan = planCostNoticeBroadcast(notice, 'departments/研发部', FROM)
    expect(plan.kind).toBe('cost')
    expect(plan.targets).toEqual({ alert: true, overview: true, dept: 'departments/研发部' })
    expect(plan.message.body).toContain('$8.5 / 预算 $10（85%）')
    expect(plan.message.body).toContain('提醒对象：PRIME-0（departments/研发部）')
    expect(plan.message.body).toContain('幂等键：company:2026-10-27:warn')
    expect(plan.digest.body).toBe('$8.5/$10（85%）→ PRIME-0')
  })
  it('target 无部门解析=只投 alert+overview（dept 缺席不软失败）', () => {
    const plan = planCostNoticeBroadcast(notice, undefined, FROM)
    expect(plan.targets).toEqual({ alert: true, overview: true })
    expect(plan.message.body).toContain('提醒对象：PRIME-0')
  })
  it('staleFlag=计价格口径行存在；false=省略', () => {
    expect(planCostNoticeBroadcast({ ...notice, staleFlag: true }, undefined, FROM).message.body).toContain('unpriced/stale')
    expect(planCostNoticeBroadcast(notice, undefined, FROM).message.body).not.toContain('unpriced/stale')
  })
})
