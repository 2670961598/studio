/**
 * C2.1 wake lease 加固测试：① dead 终态不可再 ack；② 可注入时钟（手动推进/跳变，零真实 sleep）。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C（wake_lease TTL/重试≤3/dead-letter；
 *       append-only 审计）——本文件为 verifier 上轮登记两项可落地风险的加固验收；
 *       docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md；docs/quality/workbench-transport-v1.md（DTO 冻结）。
 * 方法：直驱 dispatch + 注入 fake clock（store 构造参数 now，缺省 Date.now 不受影响）——
 *       不起子进程、不真实 sleep，TTL 过期=手动拨表，覆盖跳变（前跳=过期、回跳=租约复见有效）。
 * 边界：无网络/无密钥/无 host；不改协议端点形状与错误码集（dead ack 复用 WB_WAKE_NOT_CLAIMABLE）。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/wake-hardening.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MemoryChatStore } from '../src/store/memory.ts'
import { SqliteChatStore } from '../src/store/sqlite.ts'
import { createInitialState, WAKE_MAX_DELIVERY_ATTEMPTS, type MockState } from '../src/store/types.ts'
import type { ChatStore } from '../src/store/types.ts'
import { dispatch, type WakeDispatchOpts } from '../src/server.ts'

/** 手动时钟：t 拨表推进/回跳，dispatch 全部时间读此处（不触真实 sleep）。 */
function manualClock(start: number): { now: () => number; set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (next: number) => { t = next } }
}

const TTL_MS = 30_000
const OPTS: WakeDispatchOpts = { leaseTtlMs: TTL_MS }
const T0 = 1_700_000_000_000

interface ClaimResult { readonly claimed: string[]; readonly alreadyClaimed: string[]; readonly wakes: { readonly claimedUntil: number | null }[] }
interface AckResult { readonly acked: string[]; readonly alreadyAcked: string[] }

/** 造一个 mention wake（dispatch 直驱，确定性 id：room-1 / wake-1）。 */
function seedWake(state: MockState, store: ChatStore): string {
  dispatch(state, store, 'rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }, OPTS)
  dispatch(state, store, 'messages.send', { roomId: 'room-1', senderId: 'pm', body: '@dev please look', mentions: ['dev'] }, OPTS)
  return 'wake-1'
}

/** dispatch 业务失败断言：稳定错误码 + message 匹配（不依赖错误类导出）。 */
function expectFailure(run: () => unknown, code: string, messagePattern: RegExp): void {
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof Error, `应抛 Error（实际 ${String(err)}）`)
    assert.equal((err as { code?: unknown }).code, code)
    assert.match(err.message, messagePattern)
    return true
  })
}

const eventsOf = (state: MockState): string[] => state.wakeEvents.map((e) => `${String(e.eventId)}:${e.type}:${String(e.attempt)}`)

// ─── ① 可注入时钟：手动推进覆盖 TTL 语义（零 sleep） ─────────────────────────

test('单测：注入时钟手动推进——claim 授租（claimedUntil=now+TTL）；拨表过 TTL 再 claim=重投（attempt+1）；时间戳全部取自注入钟', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-ttl-'))
  try {
    const clock = manualClock(T0)
    const store = new SqliteChatStore(path.join(dir, 'chat.db'), clock.now)
    const state = createInitialState()
    try {
      const wakeId = seedWake(state, store)
      assert.deepEqual(eventsOf(state), ['1:created:0'], 'created 事件时间戳取注入钟（t0）')
      assert.equal(state.wakes[0]?.createdAt, T0, 'wake createdAt=注入钟当前值（非 Date.now）')

      const first = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS) as ClaimResult
      assert.deepEqual(first.claimed, [wakeId])
      assert.equal(first.wakes[0]?.claimedUntil, T0 + TTL_MS, '租约截止=注入钟 now+TTL（拨表可控）')

      clock.set(T0 + TTL_MS) // 恰到截止：claimedUntil > now 不成立 → 视为过期（边界含在过期侧）
      const second = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS) as ClaimResult
      assert.deepEqual(second.claimed, [wakeId], '拨表过 TTL 后 claim=重投（无真实等待）')
      assert.deepEqual(second.alreadyClaimed, [])
      assert.equal(second.wakes[0]?.claimedUntil, T0 + TTL_MS + TTL_MS, '重投以拨表后时刻重授租约')
      assert.deepEqual(eventsOf(state), ['1:created:0', '2:claimed:1', '3:redelivered:2'], '审计按拨表序追加')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单测：时钟回跳（跳变）——过期前回跳到有效窗口内，租约复见有效：claim 幂等（alreadyClaimed、不重投不计数）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-jump-'))
  try {
    const clock = manualClock(T0)
    const store = new SqliteChatStore(path.join(dir, 'chat.db'), clock.now)
    const state = createInitialState()
    try {
      const wakeId = seedWake(state, store)
      const first = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS) as ClaimResult
      const until = first.wakes[0]?.claimedUntil
      assert.ok(typeof until === 'number')

      clock.set(T0 + 1) // 回跳（跳变）：真实时刻已可能越过截止，但钟回拨到有效窗口内——
      // TTL 判定是纯 claimedUntil > now 比较（无单调性防护），租约复见有效：
      const second = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS) as ClaimResult
      assert.deepEqual(second.claimed, [], '回跳后租约复见有效：不重投')
      assert.deepEqual(second.alreadyClaimed, [wakeId], '幂等见 alreadyClaimed（同 lease 原值）')
      assert.equal(second.wakes[0]?.claimedUntil, until, 'claimedUntil 不因回跳改写')
      assert.deepEqual(eventsOf(state), ['1:created:0', '2:claimed:1'], '无新迁移：attempt 不回退、审计不追加（文档化现行为）')
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单测：缺省时钟=Date.now（生产行为不变）——不注入 now 时 store.now 贴合真实钟；注入则以注入值为准', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-default-'))
  try {
    const sqliteDefault = new SqliteChatStore(path.join(dir, 'chat.db'))
    try {
      assert.ok(Math.abs(sqliteDefault.now() - Date.now()) < 5_000, '缺省 now=Date.now（生产路径不变）')
    } finally {
      sqliteDefault.close()
    }
    const memoryDefault = new MemoryChatStore()
    assert.ok(Math.abs(memoryDefault.now() - Date.now()) < 5_000)

    const fixed = 1_234_567
    assert.equal(new MemoryChatStore(() => fixed).now(), fixed, '注入钟以注入值为准')
    const sqliteFixed = new SqliteChatStore(path.join(dir, 'chat2.db'), () => fixed)
    try {
      assert.equal(sqliteFixed.now(), fixed)
    } finally {
      sqliteFixed.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── ② dead 终态不可再 ack（拨表触达 dead，零 sleep） ─────────────────────────

/** 拨表驱动至 dead：首投+2 次过期重投（共 WAKE_MAX_DELIVERY_ATTEMPTS 次），再 claim 触发 dead-letter。 */
function driveToDead(state: MockState, store: ChatStore, clock: { now: () => number; set: (t: number) => void }, wakeId: string): number {
  let t = T0
  for (let i = 0; i < WAKE_MAX_DELIVERY_ATTEMPTS; i += 1) {
    const r = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS) as ClaimResult
    assert.deepEqual(r.claimed, [wakeId], `第 ${String(i + 1)} 次投递应成功（拨表前）`)
    t += TTL_MS + 1
    clock.set(t) // 过期（含边界外 1ms）
  }
  expectFailure(() => dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
  return t
}

test('单测：dead 终态 ack 拒绝——ack 回稳定 WB_WAKE_NOT_CLAIMABLE（message 注明 dead）；拒绝不追加审计；重复拒绝稳定', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-deadack-'))
  const dbPath = path.join(dir, 'chat.db')
  try {
    const clock = manualClock(T0)
    const store = new SqliteChatStore(dbPath, clock.now)
    const state = createInitialState()
    try {
      const wakeId = seedWake(state, store)
      const t = driveToDead(state, store, clock, wakeId)
      assert.deepEqual(
        eventsOf(state),
        ['1:created:0', '2:claimed:1', '3:redelivered:2', '4:redelivered:3', '5:dead_lettered:3'],
        '投递耗尽恰好 5 条审计',
      )
      assert.equal(state.wakeLeases.get(wakeId)?.state, 'dead')

      // 核心断言：dead 终态不可再 ack（同 actor=最后持租人也不行——终态不可翻案）
      for (let i = 0; i < 2; i += 1) {
        expectFailure(() => dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: [wakeId] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
      }
      assert.deepEqual(eventsOf(state), ['1:created:0', '2:claimed:1', '3:redelivered:2', '4:redelivered:3', '5:dead_lettered:3'], '拒绝路径审计零新增')
      assert.equal(state.wakeLeases.get(wakeId)?.state, 'dead', '租约终态不动摇')
      assert.equal(state.wakes[0]?.status, 'claimed', 'DTO 投影不变（dead 在租约域，状态枚举不扩）')

      clock.set(t + TTL_MS * 10) // 再怎么拨表（时间流逝）也翻不了案
      expectFailure(() => dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: [wakeId] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
      assert.deepEqual(eventsOf(state), ['1:created:0', '2:claimed:1', '3:redelivered:2', '4:redelivered:3', '5:dead_lettered:3'])
    } finally {
      store.close()
    }

    // 直读库复核：拒绝不落任何行（审计/租约均封口）
    const db = new DatabaseSync(dbPath)
    try {
      const c = db.prepare('SELECT COUNT(*) AS c FROM wake_events').get() as unknown as { c: number }
      assert.equal(c.c, 5, '库内审计 5 条封口（失败 ack 未落库）')
      const lease = db.prepare('SELECT state, attempt FROM wake_leases').get() as unknown as { state: string; attempt: number }
      assert.equal(lease.state, 'dead')
      assert.equal(lease.attempt, WAKE_MAX_DELIVERY_ATTEMPTS)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单测：dead 跨「重启」仍拒 ack——hydrate 恢复 dead 投影后，ack 照样回稳定错误且审计零新增（注入钟直驱，零 sleep）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-deadrestart-'))
  const dbPath = path.join(dir, 'chat.db')
  try {
    const clock = manualClock(T0)
    const first = new SqliteChatStore(dbPath, clock.now)
    const state = createInitialState()
    try {
      const wakeId = seedWake(state, first)
      driveToDead(state, first, clock, wakeId)
    } finally {
      first.close()
    }

    clock.set(T0 + 10 * TTL_MS) // 「重启」发生在很久以后（时间早已越过一切租约）
    const second = new SqliteChatStore(dbPath, clock.now)
    const revived = createInitialState()
    try {
      second.hydrate(revived)
      assert.equal(revived.wakeLeases.get('wake-1')?.state, 'dead', 'dead 投影随重启恢复')
      expectFailure(() => dispatch(revived, second, 'wakes.ack', { actorId: 'dev', wakeIds: ['wake-1'] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
      expectFailure(() => dispatch(revived, second, 'wakes.claim', { actorId: 'dev', wakeIds: ['wake-1'] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
      assert.equal(revived.wakeEvents.length, 5, '重启后拒绝同样零新增审计')
    } finally {
      second.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单测：正常 ack 语义不变——pending 直 ack 可确认、自持租约 ack 可确认、重复 ack 幂等（注入钟取 ackedAt）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'workbench-chatd-hard-ackok-'))
  try {
    const clock = manualClock(T0)
    const store = new SqliteChatStore(path.join(dir, 'chat.db'), clock.now)
    const state = createInitialState()
    try {
      // 场景 1：pending（未 claim）直接 ack——既有语义保留
      dispatch(state, store, 'rooms.create', { kind: 'group', name: 'g', memberIds: ['pm', 'dev'] }, OPTS)
      dispatch(state, store, 'messages.send', { roomId: 'room-1', senderId: 'pm', body: '@dev m1', mentions: ['dev'] }, OPTS)
      const direct = dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: ['wake-1'] }, OPTS) as AckResult
      assert.deepEqual(direct.acked, ['wake-1'])
      assert.deepEqual(dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: ['wake-1'] }, OPTS) as AckResult & { replayed: boolean }, { acked: [], alreadyAcked: ['wake-1'], replayed: false }, '重复 ack 幂等')

      // 场景 2：claim 后自持租约 ack——既有语义保留（dead 检查不拦正常路径）
      dispatch(state, store, 'messages.send', { roomId: 'room-1', senderId: 'pm', body: '@dev m2', mentions: ['dev'] }, OPTS)
      const claimed = dispatch(state, store, 'wakes.claim', { actorId: 'dev', wakeIds: ['wake-2'] }, OPTS) as ClaimResult
      assert.deepEqual(claimed.claimed, ['wake-2'])
      clock.set(T0 + 1_000)
      const acked = dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: ['wake-2'] }, OPTS) as AckResult
      assert.deepEqual(acked.acked, ['wake-2'], '自持租约 ack 正常确认')
      assert.equal(state.wakes[1]?.ackedAt, T0 + 1_000, 'ackedAt=注入钟当前值')
      assert.equal(state.wakeLeases.get('wake-2')?.state, 'acked', '租约终态 acked')

      // 非 wake 持有人 ack：既有 NOT_FOUND 语义保留
      expectFailure(() => dispatch(state, store, 'wakes.ack', { actorId: 'pm', wakeIds: ['wake-2'] }, OPTS), 'WB_WAKE_NOT_FOUND', /not found/)
      assert.deepEqual(
        eventsOf(state),
        ['1:created:0', '2:acked:0', '3:created:0', '4:claimed:1', '5:acked:1'],
        '正常路径审计与加固前完全一致',
      )
    } finally {
      store.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('单测：内存模式同口径——注入钟直驱 dead 后 ack 拒绝（租约语义模式无关，向后兼容）', () => {
  const clock = manualClock(T0)
  const store = new MemoryChatStore(clock.now)
  const state = createInitialState()
  const wakeId = seedWake(state, store)
  driveToDead(state, store, clock, wakeId)
  expectFailure(() => dispatch(state, store, 'wakes.ack', { actorId: 'dev', wakeIds: [wakeId] }, OPTS), 'WB_WAKE_NOT_CLAIMABLE', /dead-lettered/)
  assert.deepEqual(
    eventsOf(state),
    ['1:created:0', '2:claimed:1', '3:redelivered:2', '4:redelivered:3', '5:dead_lettered:3'],
    '内存模式：dead 终态 ack 同样拒绝、审计零新增',
  )
})
