/**
 * restart-drain —— 受权重启 S2 引擎 draining 闸单测（studio-dev-504）
 *
 * 依据：docs/17-§2（七相位——draining 只关相位 3）、docs/17-§6（自然结算照四要件；
 *   超时不判四要件、标 interrupted）；#497 §4.3/§4.4。
 * 断言：派发停/收割续/自然清零不 interrupted/超时 interrupted/幂等/cancel 重开。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { Handle } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

let root = ''
const T0 = 1_793_000_000_000

function stack(id: string, mode: FakeAdapterMode, opts?: { onKill?: (h: Handle) => void }): {
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
} {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode, name: 'fake', ...(opts?.onKill !== undefined ? { onKill: opts.onKill } : {}) }), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      autoApprove: true,
      mirrorRescanEveryTicks: 1,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { ledger, engine, clock }
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-restart-drain-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('S2 draining 闸（派发停/收割续）', () => {
  it('drain 幂等：begin 两次不重置计时；cancel 后重新可派发；TickReport 只读闸位', async () => {
    const s = stack('idempotent', 'ok')
    expect(s.engine.drain.active).toBe(false)
    s.engine.beginDrain('制作人令')
    const started = s.engine.drain.startedAt
    s.clock.advance(500)
    s.engine.beginDrain('second')
    expect(s.engine.drain.reason).toBe('制作人令')
    expect(s.engine.drain.startedAt).toBe(started)
    s.clock.advance(1000)
    const report = await s.engine.tick()
    expect(report.phases.dispatch.gate).toBe('draining')
    s.engine.cancelDrain()
    expect(s.engine.drain.active).toBe(false)
    const reopened = await s.engine.tick()
    expect(reopened.phases.dispatch.gate).toBe('open')
    s.ledger.close()
  })

  it('draining 期间零新 DISPATCH / 零新审批', async () => {
    const s = stack('no-new-dispatch', 'ok')
    s.engine.beginDrain('drain-before-dispatch')
    const report = await s.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    expect(report.phases.dispatch.gate).toBe('draining')
    s.ledger.close()
  })

  it('自然结算：派发后在途 worker 在 draining 中跑完 → work_record done（非 interrupted）', async () => {
    // 用真实同一平台栈：手工建单后引擎采集
    const ledger = openLedger(path.join(root, 'natural.sqlite'))
    let t = T0
    const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
    const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
    await platform.issues.create({ title: 'long task', type: 'task', level: 0, dept: 'departments/工程部', assignee: 'AGENT-1' })
    const registry = createRegistry()
    registry.register(createFakeAdapter({ mode: 'ok', name: 'fake' }), { default: true })
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.5-test',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot: DEMO_SNAPSHOT,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: clock.now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: 'demo',
        rootDir: path.join(root, 'natural'),
        defaultPersonId: 'AGENT-1',
        deptFallback: 'departments/工程部',
        defaultLane: 'core',
        autoApprove: true,
        mirrorRescanEveryTicks: 1,
      },
      people: DEMO_SNAPSHOT.people,
    })
    clock.advance(1000)
    const first = await engine.tick()
    expect(first.phases.dispatch.dispatched).toBe(1)
    expect(first.inflightAfter).toBe(1)
    engine.beginDrain('natural-completion')
    clock.advance(1000)
    const second = await engine.tick()
    expect(second.phases.dispatch.gate).toBe('draining')
    expect(second.phases.dispatch.dispatched).toBe(0)
    expect(second.phases.harvest.completed).toBe(1)
    expect(second.inflightAfter).toBe(0)
    const records = ledger.listWorkRecords().filter((r) => r.issue.startsWith('T-'))
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe('done')
    expect(records.filter((r) => r.status === 'interrupted')).toHaveLength(0)
    ledger.close()
  })

  it('超时收口：kill 在途 + work_record interrupted（不判四要件、不烧断路）', async () => {
    const kills: string[] = []
    const ledger = openLedger(path.join(root, 'timeout.sqlite'))
    let t = T0
    const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
    const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
    await platform.issues.create({ title: 'stalled task', type: 'task', level: 0, dept: 'departments/工程部', assignee: 'AGENT-1' })
    const registry = createRegistry()
    registry.register(createFakeAdapter({ mode: 'stalled', name: 'fake', onKill: (h) => kills.push(h.sessionId) }), { default: true })
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.5-test',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot: DEMO_SNAPSHOT,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: clock.now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: 'demo',
        rootDir: path.join(root, 'timeout'),
        defaultPersonId: 'AGENT-1',
        deptFallback: 'departments/工程部',
        defaultLane: 'core',
        autoApprove: true,
        mirrorRescanEveryTicks: 1,
        killGraceMs: 1,
      },
      people: DEMO_SNAPSHOT.people,
    })
    clock.advance(1000)
    const first = await engine.tick()
    expect(first.inflightAfter).toBe(1)
    engine.beginDrain('timeout')
    const settled = await engine.forceSettleTimeout()
    expect(settled.interrupted).toHaveLength(1)
    expect(kills).toHaveLength(1)
    expect(engine.drain.active).toBe(true)
    const rec = ledger.listWorkRecords().find((r) => r.issue === settled.interrupted[0]?.ticket)
    expect(rec?.status).toBe('interrupted')
    expect(rec?.ended_at).toBeGreaterThan(0)
    ledger.close()
  })

  it('forceSettleTimeout 幂等：空在途再收口=空清单不炸', async () => {
    const s = stack('empty-settle', 'ok')
    const settled = await s.engine.forceSettleTimeout()
    expect(settled.interrupted).toHaveLength(0)
    expect(settled.orphaned).toBe(0)
    s.ledger.close()
  })
})
