/**
 * notify 中继单测（105-刀B-5/-6/-7，studio-dev-219）：去重防反馈环（同单同错误签名
 * 恰一条）/ 全文 vs 摘要分频 / face 异常双保险不抛 / 惊动计量批聚合 / cost 警戒即时出口
 * （消费拍发，129 批示项④）/ deptOf 注入。
 */
import { describe, expect, it, vi } from 'vitest'
import { NotifyDedup } from '../../../src/engine/notify/dedup.ts'
import { createNotifyRelay } from '../../../src/engine/notify/relay.ts'
import type { NotifyBroadcastFace, NotifyBroadcastTargets, NotifySendReport } from '../../../src/engine/notify/broadcast.ts'
import type { EventRecord, Notification } from '@studio-next/contract'
import type { CostThresholdNotice } from '../../../src/engine/intents/escalate.ts'

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

/** 记录型假面：send 逐次入账（观测 calls）；可注入失败/异常 */
function recordingFace(behavior: 'ok' | 'soft-fail' | 'throw' = 'ok'): NotifyBroadcastFace & {
  calls: Array<{ message: Notification; targets: NotifyBroadcastTargets }>
} {
  const calls: Array<{ message: Notification; targets: NotifyBroadcastTargets }> = []
  return {
    calls,
    async send(message, targets): Promise<NotifySendReport> {
      calls.push({ message, targets })
      if (behavior === 'throw') throw new Error('matrix 挂了')
      if (behavior === 'soft-fail') return { sent: [], failed: [{ target: 'alert', reason: 'connection refused' }] }
      const sent: string[] = []
      if (targets.alert === true) sent.push('alert')
      if (targets.overview === true) sent.push('overview')
      if (targets.dept !== undefined && targets.dept !== '') sent.push(`dept:${targets.dept}`)
      return { sent, failed: [] }
    },
  }
}

describe('NotifyDedup（同单同错误签名恰一条，刀B-5/F10）', () => {
  it('STALL 连响 note 数字遮蔽同签名：第 1/2 与 2/2 次只放第一条', () => {
    const d = new NotifyDedup()
    expect(d.shouldSend('STALL', 'STUDIO-100', 1, '在工静默 30000ms 超阈值 30000ms（看门狗告警第 1/2 次；未达咬合阈）')).toBe(true)
    expect(d.shouldSend('STALL', 'STUDIO-100', 1, '在工静默 45000ms 超阈值 30000ms（看门狗告警第 2/2 次；未达咬合阈）')).toBe(false)
  })
  it('attempt 变（咬合重派新誓）= 新签名再告；不同单互不抑制', () => {
    const d = new NotifyDedup()
    expect(d.shouldSend('STALL', 'STUDIO-100', 1, 'x 1 次')).toBe(true)
    expect(d.shouldSend('STALL', 'STUDIO-100', 2, 'x 1 次')).toBe(true)
    expect(d.shouldSend('STALL', 'STUDIO-101', 1, 'x 1 次')).toBe(true)
  })
  it('cap 逐出最旧（防长跑膨胀）', () => {
    const d = new NotifyDedup(2, () => 0)
    expect(d.shouldSend('STALL', 'A', 1, 'n')).toBe(true)
    expect(d.shouldSend('STALL', 'B', 1, 'n')).toBe(true)
    expect(d.shouldSend('STALL', 'C', 1, 'n')).toBe(true) // 逐出 A
    expect(d.shouldSend('STALL', 'A', 1, 'n')).toBe(true) // A 回窗
    expect(d.size).toBe(2)
  })
})

describe('createNotifyRelay.relayEvents（拍边界事件中继）', () => {
  it('GATE_PASS：全文→alert+dept 一发，摘要→overview 一发（低噪总览）', async () => {
    const face = recordingFace()
    const relay = createNotifyRelay({ face, from: FROM })
    await relay.relayEvents([evt('GATE_PASS', { note: '四要件齐' })])
    expect(face.calls).toHaveLength(2)
    expect(face.calls[0]?.targets).toEqual({ alert: true, dept: 'departments/研发部' })
    expect(face.calls[0]?.message.body).toBe('四要件齐')
    expect(face.calls[1]?.targets).toEqual({ overview: true })
    expect(face.calls[1]?.message.body).toBe('四要件齐')
  })

  it('日报产物（;output=）：只发部门频道一发（低噪纪律）', async () => {
    const face = recordingFace()
    const relay = createNotifyRelay({ face, from: FROM })
    await relay.relayEvents([evt('GATE_PASS', { note: '四要件齐;output=/r/daily.md' })])
    expect(face.calls).toHaveLength(1)
    expect(face.calls[0]?.targets).toEqual({ dept: 'departments/研发部' })
    expect(face.calls[0]?.message.kind).toBe('report')
  })

  it('不在路由表的事件零发送；同签名连发只透传第一条（去重）', async () => {
    const face = recordingFace()
    const relay = createNotifyRelay({ face, from: FROM })
    await relay.relayEvents([
      evt('PATROL'),
      evt('STALL', { note: '告警第 1/2 次' }),
      evt('STALL', { note: '告警第 2/2 次' }),
    ])
    expect(face.calls).toHaveLength(2) // STALL 全文+摘要恰一对
  })

  it('face 抛异常=双保险捕获不外抛（刀B-6）；软失败入计量 failed', async () => {
    const onMeasure = vi.fn()
    const throwFace = recordingFace('throw')
    const relayThrow = createNotifyRelay({ face: throwFace, from: FROM, onMeasure })
    await expect(relayThrow.relayEvents([evt('GATE_PASS')])).resolves.toBeUndefined()
    const softFace = recordingFace('soft-fail')
    const relaySoft = createNotifyRelay({ face: softFace, from: FROM, onMeasure })
    await relaySoft.relayEvents([evt('GATE_PASS')])
    expect(onMeasure).toHaveBeenCalledWith(expect.objectContaining({ failed: expect.any(Number) }))
  })

  it('惊动计量（刀B-7）：一批一聚合（sent/failed/byRole/byKind）；零事件零计量', async () => {
    const onMeasure = vi.fn()
    const relay = createNotifyRelay({ face: recordingFace(), from: FROM, onMeasure })
    await relay.relayEvents([evt('GATE_PASS'), evt('STALL', { issue: 'STUDIO-101' })])
    expect(onMeasure).toHaveBeenCalledTimes(1)
    const batch = onMeasure.mock.calls[0]?.[0]
    expect(batch).toMatchObject({ sent: 6, failed: 0 }) // 每事件 3 角色（alert/dept/overview）
    expect(batch.byRole).toEqual({ alert: 2, 'dept:departments/研发部': 2, overview: 2 })
    expect(batch.byKind).toEqual({ gate: 3, stall: 3 })
    onMeasure.mockClear()
    await relay.relayEvents([])
    expect(onMeasure).not.toHaveBeenCalled()
  })
})

describe('createNotifyRelay.costNoticeOutlet（escalate 警戒即时出口，129 批示项④）', () => {
  const notice: CostThresholdNotice = {
    class: 'cost-threshold',
    scope: 'company',
    period: '2026-10-27',
    tier: 'warn',
    route: 'notify',
    pct: 85,
    runningUsd: 8.5,
    budgetUsd: 10,
    target: 'ENG-4',
    dedupKey: 'company:2026-10-27:warn',
    source: 'cost-close',
    staleFlag: false,
  }

  it('消费拍即时发（fire-and-forget 不抛、不待拍尾）+ deptOf 解析 target 部门', async () => {
    const face = recordingFace()
    const relay = createNotifyRelay({ face, from: FROM, deptOf: (t): string | undefined => (t === 'ENG-4' ? 'departments/研发部' : undefined) })
    relay.costNoticeOutlet(notice)
    // fire-and-forget：microtask 汇点后观测
    await new Promise((r) => setTimeout(r, 10))
    expect(face.calls).toHaveLength(2) // 全文→alert+dept；摘要→overview
    expect(face.calls[0]?.targets).toEqual({ alert: true, dept: 'departments/研发部' })
    expect(face.calls[0]?.message.kind).toBe('cost')
    expect(face.calls[1]?.targets).toEqual({ overview: true })
  })

  it('face 挂=双保险 catch（promise 拒绝不外泄成未处理异常）', async () => {
    const face = recordingFace('throw')
    const relay = createNotifyRelay({ face, from: FROM })
    relay.costNoticeOutlet(notice)
    await new Promise((r) => setTimeout(r, 10))
    // 无 unhandled rejection 即通过（vitest 会把未处理拒因变红）
  })

  it('计量同批聚合（cost kind 入账）', async () => {
    const onMeasure = vi.fn()
    const relay = createNotifyRelay({ face: recordingFace(), from: FROM, deptOf: () => 'departments/研发部', onMeasure })
    relay.costNoticeOutlet(notice)
    await new Promise((r) => setTimeout(r, 10))
    expect(onMeasure).toHaveBeenCalledTimes(1)
    expect(onMeasure.mock.calls[0]?.[0]).toMatchObject({ sent: 3, byKind: { cost: 3 } })
  })
})
