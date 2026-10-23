/**
 * merge-lease unit —— 202-P4 合并租约簿与观测面（studio-dev-234；proposal §5.6/§7 S6/S7，
 * docs/17-§2 相位 5 合并租约注记；泳道对偶件 lanes/registry.ts）。
 *
 * 断言面（对契约与冻结口径负责，不对实现细节）：
 *   - R1 租约三面：键形 `${company}:${targetBranch}`；acquire 幂等重进/他单活约拒绝；
 *     release 持有人校验（他人释放无效）+双释放安全。
 *   - R2 TTL+死主回收：TTL 内他单不可夺；到期=死主视同无主可夺占；过期不复活
 *     （renew 只续活约——死主判定以到期时刻为准）。
 *   - R3 host 级两拍：renewMergeLeases 只续在途合并跑（续租下他单仍顺延——判负线
 *     「等待者被判失败」反面）；mergeQueueFace 面关=lease:null／等待·在跑·租约态投影
 *     （死主让道双列异常如实投影）。
 *   - S7 L0 回放（102 次）：面关轨 v0 模拟合并 byte-identical——note 冻结串逐字全等
 *     ×102（生产台账 102 次全模拟的兼容面：面关轨道不查租约/状态位，行为零变更）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EventRecord, FlowPlatform, PersonRef, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, type Inflight } from '../../../src/engine/engine.ts'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import { buildEventIndex } from '../../../src/engine/sentinel/events-index.ts'
import { runMergeAction, type MergeRunHost } from '../../../src/engine/merge/merge-run.ts'
import { createMergeLeaseRegistry, mergeLeaseKey, mergeQueueFace, renewMergeLeases, type MergeLeaseHostFace } from '../../../src/engine/merge/merge-lease.ts'

const DEPT = 'departments/工程部'
const TTL = 30 * 60_000

function person(id: string): PersonRef {
  return { id, name: id, login: id.toLowerCase(), level: 1, dept: DEPT }
}

const ROSTER: readonly PersonRef[] = [person('ENG-1'), person('PLN-9')]

let root = ''

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'merge-lease-unit-suite-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('R1 租约簿三面（acquire/release/state）', () => {
  it('键形=公司:目标分支（P2 定型同源）', () => {
    expect(mergeLeaseKey('demo', 'dev')).toBe('demo:dev')
    expect(mergeLeaseKey('acme', 'main')).toBe('acme:main')
  })

  it('acquire 幂等重进=true；他单活约在位=false', () => {
    const r = createMergeLeaseRegistry(TTL)
    expect(r.acquire('demo:dev', 'T-1', 1_000)).toBe(true)
    expect(r.acquire('demo:dev', 'T-1', 1_100)).toBe(true) // 幂等重进（同单刷新 TTL 面）
    expect(r.acquire('demo:dev', 'T-2', 1_200)).toBe(false) // 他单活约在位
    expect(r.state('demo:dev', 1_200)).toMatchObject({ holder: 'T-1', expired: false })
  })

  it('release 持有人校验：他人释放无效；双释放安全', () => {
    const r = createMergeLeaseRegistry(TTL)
    r.acquire('demo:dev', 'T-1', 1_000)
    r.release('demo:dev', 'T-2') // 非持有人——无效
    expect(r.state('demo:dev', 1_000).holder).toBe('T-1')
    r.release('demo:dev', 'T-1')
    r.release('demo:dev', 'T-1') // 双释放安全（失败面/收口面各调一次）
    expect(r.state('demo:dev', 1_000)).toMatchObject({ holder: null, expired: false })
    expect(r.acquire('demo:dev', 'T-2', 1_000)).toBe(true) // 已释放可再占
  })

  it('state 三脸：无记录/活约/过期（holder:null+expired:true=死主待回收）', () => {
    const r = createMergeLeaseRegistry(TTL)
    expect(r.state('demo:dev', 1_000)).toEqual({ key: 'demo:dev', holder: null, expired: false })
    r.acquire('demo:dev', 'T-1', 1_000)
    expect(r.state('demo:dev', 1_500)).toEqual({ key: 'demo:dev', holder: 'T-1', expiresAt: 1_000 + TTL, expired: false })
    expect(r.state('demo:dev', 1_000 + TTL + 1)).toEqual({ key: 'demo:dev', holder: null, expired: true })
  })
})

describe('R2 TTL+死主回收（任务书领土：TTL＋续租＋死主回收）', () => {
  it('TTL 内他单不可夺；到期=死主视同无主可夺占（泄漏租约自愈）', () => {
    const r = createMergeLeaseRegistry(TTL)
    r.acquire('demo:dev', 'T-1', 1_000)
    expect(r.acquire('demo:dev', 'T-2', 1_000 + TTL - 1)).toBe(false) // 活约窗口内
    expect(r.acquire('demo:dev', 'T-2', 1_000 + TTL + 1)).toBe(true) // 死主回收（双释放面均未触的自愈）
    expect(r.state('demo:dev', 1_000 + TTL + 2)).toMatchObject({ holder: 'T-2', expired: false })
  })

  it('过期不复活：renew 只续活约（死主判定以到期时刻为准）', () => {
    const r = createMergeLeaseRegistry(TTL)
    r.acquire('demo:dev', 'T-1', 1_000)
    expect(r.renew('demo:dev', 'T-1', 1_000 + TTL + 1)).toBe(false) // 已过期——不复活
    expect(r.state('demo:dev', 1_000 + TTL + 2)).toMatchObject({ holder: null, expired: true })
    expect(r.acquire('demo:dev', 'T-2', 1_000 + TTL + 2)).toBe(true) // 让道给新单
  })

  it('renew 持有人匹配才续；非持有人 renew=false 不动租约', () => {
    const r = createMergeLeaseRegistry(TTL)
    r.acquire('demo:dev', 'T-1', 1_000)
    expect(r.renew('demo:dev', 'T-2', 1_500)).toBe(false)
    expect(r.state('demo:dev', 1_500).expiresAt).toBe(1_000 + TTL) // 未被他人续命
    expect(r.renew('demo:dev', 'T-1', 2_000)).toBe(true)
    expect(r.state('demo:dev', 2_000).expiresAt).toBe(2_000 + TTL)
  })
})

describe('R3 host 级两拍（renewMergeLeases/mergeQueueFace）', () => {
  function faceHost(o: { at: number; running?: Array<{ ticket: TicketId }>; mergeRun?: { targetBranch: string } }): MergeLeaseHostFace & { clockAt: number } {
    const h: MergeLeaseHostFace & { clockAt: number } = {
      clockAt: o.at,
      config: { company: 'demo' },
      inflight: new Map<TicketId, Pick<Inflight, 'ticket' | 'mergeRun'>>(),
      mergeRun: o.mergeRun,
      mergeLease: createMergeLeaseRegistry(TTL),
    }
    for (const e of o.running ?? []) h.inflight.set(e.ticket, { ticket: e.ticket, mergeRun: { leaseKey: mergeLeaseKey('demo', 'dev') } })
    return h
  }

  it('续租下他单仍顺延（判负线「等待者被判失败」反面）：在途合并跑每拍续命', () => {
    const h = faceHost({ at: 1_000, running: [{ ticket: 'T-A' }], mergeRun: { targetBranch: 'dev' } })
    expect(h.mergeLease.acquire('demo:dev', 'T-A', h.clockAt)).toBe(true)
    // —— 拍 2…拍 N：每拍头续租（长跑不被 TTL 误夺） ——
    for (let tick = 2; tick <= 5; tick += 1) {
      h.clockAt = 1_000 + (tick - 1) * (TTL - 1_000) // 每拍都压到旧 expiry 边缘再续
      renewMergeLeases(h, h.clockAt)
      expect(h.mergeLease.state('demo:dev', h.clockAt)).toMatchObject({ holder: 'T-A', expired: false })
      expect(h.mergeLease.acquire('demo:dev', 'T-B', h.clockAt)).toBe(false) // 续租下他单恒顺延
    }
  })

  it('renewMergeLeases 只续在途合并跑：普通在工单（无 mergeRun）零触碰', () => {
    const h = faceHost({ at: 1_000, mergeRun: { targetBranch: 'dev' } })
    h.inflight.set('T-PLAIN', { ticket: 'T-PLAIN', mergeRun: undefined })
    h.mergeLease.acquire('demo:dev', 'T-A', 1_000)
    renewMergeLeases(h, 1_000 + TTL + 1) // T-A 不在 inflight（死主）——不复活
    expect(h.mergeLease.state('demo:dev', 1_000 + TTL + 2)).toMatchObject({ holder: null, expired: true })
  })

  it('mergeQueueFace：等待/在跑/租约态只读投影；死主让道双列异常如实投影', () => {
    const live = faceHost({ at: 2_000, running: [{ ticket: 'T-A' }], mergeRun: { targetBranch: 'dev' } })
    live.mergeLease.acquire('demo:dev', 'T-A', 1_000)
    expect(mergeQueueFace(live, ['T-B'], 2_000)).toEqual({
      waiting: ['T-B'],
      running: ['T-A'],
      lease: { key: 'demo:dev', holder: 'T-A', expiresAt: 1_000 + TTL, expired: false },
    })
    const dead = faceHost({ at: 1_000 + TTL + 1, running: [{ ticket: 'T-A' }], mergeRun: { targetBranch: 'dev' } })
    dead.mergeLease.acquire('demo:dev', 'T-A', 1_000)
    expect(mergeQueueFace(dead, [], 1_000 + TTL + 1)).toEqual({
      waiting: [],
      running: ['T-A'], // daemon 停摆超 TTL：在跑单与死租约并存——如实投影（不粉饰）
      lease: { key: 'demo:dev', holder: null, expired: true },
    })
  })

  it('面关（mergeRun=undefined）→ lease:null（观测面缺席不冒充）', () => {
    const h = faceHost({ at: 1_000 })
    expect(mergeQueueFace(h, [], 1_000)).toEqual({ waiting: [], running: [], lease: null })
  })
})

describe('S7 L0 无类型流回放（102 次面关轨 byte-identical）', () => {
  /** 最小面关宿主：mergeRun 缺省——面关轨道在租约检查**之前**分派（结构性零触碰） */
  function buildFaceOffHost(dir: string): { host: MergeRunHost; platform: FlowPlatform; ledger: Ledger; events: EventRecord[] } {
    const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
    const platform = createFakePlatform({ now: () => '2026-10-24T00:00:00.000Z' })
    const events: EventRecord[] = []
    let seqN = 0
    let idN = 0
    const ulid = (n: number): string => '0'.repeat(10) + String(n).padStart(16, '0')
    const host: MergeRunHost = {
      platform,
      ledger,
      registry: { resolve: () => { throw new Error('面关轨不触适配器') }, register() {}, list: () => [] } as never,
      assemble: () => ({ agentsMd: { text: 'x', fingerprint: 'fp-0' }, brief: { text: 'x\n' } }) as never,
      config: { ...ENGINE_CONFIG_DEFAULTS, company: 'demo' as never, rootDir: dir, aiwsRoot: dir, defaultPersonId: 'ENG-1', deptFallback: DEPT, defaultLane: 'core', actor: 'PLN-9' },
      people: () => ROSTER,
      budgetDeps: { ledger, makeId: (ts: number): string => `b-${ts}-${(idN += 1)}` },
      costGuard: () => undefined,
      modelTiers: undefined,
      inflight: new Map(),
      mergeRun: undefined,
      mergeLease: createMergeLeaseRegistry(TTL),
      seq: (): number => (seqN += 1),
      now: (): number => 1_000,
      makeId: (_ts: number): string => ulid((idN += 1)),
      makeEvent: (name, issue, attempt, tickEvents, extra) => {
        const evt = {
          id: ulid((idN += 1)), ts: 1_000, company: 'demo', issue: issue.id, event: name, actor: 'PLN-9', attempt,
          level: Math.min(9, Math.max(1, issue.level ?? 1)), // evtLevel 裁剪面同构（L0 单事件面=1）
          dept: DEPT, tokens: extra?.tokens ?? { input: 0 },
          ...(extra?.note !== undefined ? { note: extra.note } : {}),
          ...(extra?.causation_id !== undefined ? { causation_id: extra.causation_id } : {}),
        } as EventRecord
        ledger.appendEvent(evt)
        events.push(evt)
        if (tickEvents !== events) tickEvents.push(evt)
        return evt
      },
      syncMirror: () => undefined,
      resolvePerson: (issue: { assignee?: string }): PersonRef | undefined => ROSTER.find((p) => p.id === issue.assignee),
      flowOf: (issue: { type?: string; level?: number }) => undefined as never,
    }
    return { host, platform, ledger, events }
  }

  it('102 张 L0 单（无 type+level 0）逐张过合并位：note 冻结串全等+面关 lease:null', async () => {
    const dir = mkdtempSync(path.join(root, 'l0-replay-'))
    const { host, platform, ledger, events } = buildFaceOffHost(dir)
    const FROZEN_NOTE = '→已交付（v0 模拟合并：无真 git 合并，归 v0.5 真单刀）'
    const FROZEN_DETAIL = '→已交付（模拟）'
    const notes: string[] = []
    for (let i = 0; i < 102; i += 1) {
      const t = await platform.issues.create({ title: `L0 回放单 ${i + 1}`, dept: DEPT, level: 0, assignee: 'ENG-1', initialState: '复验通过' })
      const r = await runMergeAction(host, { type: 'merge', ticket: t.id, toState: '已交付' }, buildEventIndex(ledger.queryEvents()), events, { budgetReserved: 0, budgetRefused: 0 }, new Map())
      expect(r.counted, `第 ${i + 1} 张计数`).toBe(true)
      expect(r.mutated, `第 ${i + 1} 张记账`).toBe(true)
      expect(r.result.ok, `第 ${i + 1} 张 ok`).toBe(true)
      expect(r.result.detail, `第 ${i + 1} 张 detail 字节不变`).toBe(FROZEN_DETAIL)
      const evt = events[events.length - 1]
      expect(evt?.event, `第 ${i + 1} 张 MERGE`).toBe('MERGE')
      notes.push(evt?.note ?? '')
      expect((await platform.issues.get(t.id)).state, `第 ${i + 1} 张已交付`).toBe('已交付')
      expect(mergeQueueFace(host, [], 1_000).lease, `第 ${i + 1} 拍面关 lease:null`).toBe(null)
    }
    expect(new Set(notes).size).toBe(1) // 102 条全一字不差（golden 回放不变）
    expect(notes[0]).toBe(FROZEN_NOTE)
    expect(events).toHaveLength(102) // 每张恰一条 MERGE，无租约面杂音
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
