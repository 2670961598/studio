/**
 * buildServeRuntime notifyBroadcast 注入面测试（105-刀B，studio-dev-219）：
 *   - 不注入=零装配零行为（notifyRelay 缺席，既有行为不变——同 hrSync/roomFace 纪律）
 *   - 注入=relay 露头（runtime.notifyRelay）：拍边界中继→face 收到（全文 alert+dept /
 *     摘要 overview），惊动计量 PATROL 落台账（note 锚 notify=sent:…；心跳哨兵单锚）
 *   - cost 警戒出口：engine deps.notify 换装后 v0 log 线保留（面板/console 第一落点）
 * daemon 不 import @studio-next/matrix（25-§一.2）——face=结构同形替身。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, EventRecord, Notification } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { buildServeRuntime, type ServeConfig } from '../../src/assembly/serve.ts'
import type { NotifyBroadcastFace, NotifyBroadcastTargets, NotifySendReport } from '../../src/engine/notify/broadcast.ts'

const SNAPSHOT: CompanySnapshot = {
  slug: 'demo',
  name: 'Demo 公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' }],
  jobs: [],
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-serve-notify-'))
})

afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await rm(root, { recursive: true, force: true })
})

function cfgOf(id: string, over?: Partial<ServeConfig>): ServeConfig {
  return {
    db: path.join(root, `${id}.sqlite`),
    platform: 'fake',
    company: SNAPSHOT.slug,
    rootDir: path.join(root, id),
    tickMs: 10,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 60_000,
    stallKillAfterAlarms: 0,
    laneTtlMs: 30 * 60_000,
    breakerThreshold: 3,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15_000,
    matrix: false,
    fileWatch: false,
    cadence: false,
    sla: false,
    reloadWatch: false,
    ...over,
  }
}

/** 记录型假面（结构同形 NotifyBroadcastFace——daemon 侧零 matrix import） */
function fakeFace(): NotifyBroadcastFace & { calls: Array<{ message: Notification; targets: NotifyBroadcastTargets }> } {
  const calls: Array<{ message: Notification; targets: NotifyBroadcastTargets }> = []
  return {
    calls,
    async send(message, targets): Promise<NotifySendReport> {
      calls.push({ message, targets })
      const sent: string[] = []
      if (targets.alert === true) sent.push('alert')
      if (targets.overview === true) sent.push('overview')
      if (targets.dept !== undefined && targets.dept !== '') sent.push(`dept:${targets.dept}`)
      return { sent, failed: [] }
    },
  }
}

function evt(event: string, issue: string, note?: string): EventRecord {
  return {
    id: `01JTESTTESTTESTTESTTEST${event.length}`,
    ts: 1_700_000_000_000,
    company: 'demo',
    issue,
    event,
    actor: 'daemon',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    ...(note !== undefined ? { note } : {}),
  } as EventRecord
}

describe('buildServeRuntime：notifyBroadcast 注入面（105-刀B）', () => {
  it('不注入=零装配零行为（notifyRelay 缺席；引擎照常起拍）', async () => {
    const ledger = openLedger(path.join(root, 'off.sqlite'))
    const runtime = buildServeRuntime(cfgOf('off'), ledger, SNAPSHOT, { log: () => {} })
    try {
      expect(runtime.notifyRelay).toBeUndefined()
      const report = await runtime.engine.tick()
      expect(report.errors).toEqual([])
    } finally {
      await runtime.stop()
    }
  })

  it('注入=relay 露头：GATE_PASS 中继→全文(alert+dept)+摘要(overview)；PATROL 计量落台账', async () => {
    const ledger = openLedger(path.join(root, 'on.sqlite'))
    const face = fakeFace()
    const logs: string[] = []
    const runtime = buildServeRuntime(cfgOf('on'), ledger, SNAPSHOT, {
      log: (l) => logs.push(l),
      notifyBroadcast: face,
    })
    try {
      expect(runtime.notifyRelay).toBeDefined()
      expect(logs.some((l) => l.includes('notify 广播面已装配'))).toBe(true)
      await runtime.notifyRelay?.([evt('GATE_PASS', 'STUDIO-1', '四要件齐')])
      expect(face.calls).toHaveLength(2)
      expect(face.calls[0]?.targets).toEqual({ alert: true, dept: 'departments/工程部' })
      expect(face.calls[1]?.targets).toEqual({ overview: true })
      expect(face.calls[0]?.message.from).toContain('daemon@demo') // B-4 出面署名
      const patrols = ledger.queryEvents({ event: 'PATROL' }).filter((e) => e.note?.includes('notify=sent:'))
      expect(patrols).toHaveLength(1)
      expect(patrols[0]?.note).toContain('notify=sent:3;failed:0')
      expect(patrols[0]?.issue).toBe('-') // 心跳哨兵单锚（181 同锚）
      expect(patrols[0]?.actor).toBe('daemon')
    } finally {
      await runtime.stop()
    }
  })

  it('零事件/零发送拍零计量（PATROL 不加噪音行）', async () => {
    const ledger = openLedger(path.join(root, 'quiet.sqlite'))
    const face = fakeFace()
    const runtime = buildServeRuntime(cfgOf('quiet'), ledger, SNAPSHOT, { log: () => {}, notifyBroadcast: face })
    try {
      await runtime.notifyRelay?.([evt('PATROL', '-')]) // 不在路由表
      expect(face.calls).toHaveLength(0)
      expect(ledger.queryEvents({ event: 'PATROL' }).filter((e) => e.note?.includes('notify=sent:'))).toHaveLength(0)
    } finally {
      await runtime.stop()
    }
  })
})
