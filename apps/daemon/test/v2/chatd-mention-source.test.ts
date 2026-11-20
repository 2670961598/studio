/**
 * chatd-mention-source 测试（M3 接线第一阶段 · 模块 D 最小刀，team task-133）
 *
 * 覆盖（提案 docs/plan/07-…-2026-11-19.md §5.5 mock sidecar 靶；matrix 源测试同款纪律）：
 *   - 首拉只建基线：启动时既有 pending wake 不唤起（防重放）；
 *   - wake 恰一次：新 wake → claim → emit → ack 一条链，后续拍不再重发；
 *   - claim/ack：批量 claim（idempotencyKey=actor+拍号）、逐 wake ack（幂等键=`wake:<id>`）、
 *     payload 与 daemon 消费闸 checkMentionPayload 同形；
 *   - 引擎幂等契约：payload.eventId=dedupKey=`wake:<id>`（源侧设置，消费件强制相等——
 *     修复前 eventId=room/seq ≠ dedupKey 全拒收）；多 actor 各独立 wake 不同键；直证过
 *     createMentionConsumer dedupKey 闸（物化唤醒单零 errors）；
 *   - 幂等吸收：租约期内重claim=alreadyClaimed（attempt 不计数）照常 emit→ack（同 dedupKey 重发，引擎折叠）；
 *   - 重投幂等：租约过期重投（attempt+1）→ 同键 `wake:<id>` 重发 → ack 收口；
 *   - stop 清定时器无孤儿：清 setTimeout 链、关 transport、在途 poll 返回后不再调度/不再 emit；
 *   - 错误退避：出错指数翻倍封顶、成功复位；WB_* 分类可读（transport/config/gone/…）；
 *   - 配置开关：mentionSource 缺省 matrix、'chatd' 直通、非法值 CONFIG_INVALID。
 *
 * 边界：不触 matrix 路径（既有源零改——本刀只加新文件）；mock transport/server，零真 socket。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InvokeIntent, TicketId } from '@studio-next/contract'
import type { AckResult, ClaimResult, InboxResult, Message, MessagePage, Room } from '@studio-next/workbench-transport'
import { createFakePlatform } from '../../src/engine/fakes.ts'
import { checkMentionPayload, createMentionConsumer, type IntentConsumerDeps } from '../../src/engine/intents/taxonomy.ts'
import {
  CHATD_MENTION_SOURCE_NAME,
  classifyChatdError,
  createChatdMentionSource,
  mentionSourceKindOf,
  type ChatdTransportPort,
} from '../../src/assembly/serve/chatd-mention-source.ts'

// ————————————————————————— mock sidecar（内存态；wake 租约语义镜像 server.ts:82-93/234-322） ————————————

const wbError = (code: string, message: string): Error => Object.assign(new Error(message), { code })

interface FakeWakeState {
  wakeId: string
  actorId: string
  roomId: string
  sourceSeq: number
  status: 'pending' | 'claimed' | 'acked' | 'dead'
  claimedUntil: number
  attempt: number
}

/** 内存 chatd：inbox/wakes.claim/wakes.ack/messages.list/rooms.list 最小实现（租约 TTL 可注入） */
class FakeChatd implements ChatdTransportPort {
  readonly messages: Message[] = []
  readonly wakes: FakeWakeState[] = []
  readonly calls: { method: string; input: unknown; at: number }[] = []
  leaseTtlMs = 30_000
  closed = false
  /** 接下来 N 次 inbox 抛 WB_UNAVAILABLE（退避测试旋钮） */
  failInbox = 0
  /** 接下来 N 次 ack 抛 WB_UNAVAILABLE（重投/幂等吸收测试旋钮） */
  failAck = 0
  /** inbox 挂起（在途 stop 测试旋钮）：true 时 inbox 返回手动 resolve 的 Promise */
  holdInbox = false
  private held: ((result: InboxResult) => void) | undefined
  private seq = 0

  /** 造一条消息 + 按提及产 wake（镜像 server messages.send 最小面） */
  send(body: string, mentions: readonly string[], senderId = 'PRIME-0'): void {
    this.seq += 1
    this.messages.push({ seq: this.seq, roomSeq: this.seq, roomId: 'room-1', senderId, body, mentions: [...mentions], createdAt: Date.now() })
    for (const actorId of [...new Set(mentions)]) {
      this.wakes.push({ wakeId: `wake-${String(this.wakes.length + 1)}`, actorId, roomId: 'room-1', sourceSeq: this.seq, status: 'pending', claimedUntil: 0, attempt: 0 })
    }
  }

  private async guard(method: string, input: unknown, run: () => Promise<unknown>): Promise<unknown> {
    this.calls.push({ method, input, at: Date.now() })
    if (this.closed) throw wbError('WB_NOT_CONNECTED', 'transport closed')
    return run()
  }

  async inbox(input: { actorId: string }): Promise<InboxResult> {
    return (await this.guard('inbox', input, async () => {
      if (this.failInbox > 0) {
        this.failInbox -= 1
        throw wbError('WB_UNAVAILABLE', 'socket closed')
      }
      if (this.holdInbox) return new Promise<InboxResult>((resolve) => { this.held = resolve })
      const pending = this.wakes.filter((w) => w.actorId === input.actorId && w.status !== 'acked' && w.status !== 'dead')
      return { actorId: input.actorId, unread: 0, mentions: pending.length, pendingWakeIds: pending.map((w) => w.wakeId), rooms: [] }
    })) as InboxResult
  }

  async claimWakes(input: { actorId: string; wakeIds: readonly string[] }): Promise<ClaimResult> {
    return (await this.guard('claimWakes', input, async () => {
      const claimed: string[] = []
      const alreadyClaimed: string[] = []
      const wakes: unknown[] = []
      for (const id of input.wakeIds) {
        const w = this.wakes.find((x) => x.wakeId === id)
        if (w === undefined || w.actorId !== input.actorId) throw wbError('WB_WAKE_NOT_FOUND', 'wake not found')
        const now = Date.now()
        if (w.status === 'claimed' && w.claimedUntil > now) {
          alreadyClaimed.push(id) // 租约期内同 actor 重claim=幂等（回同 lease，attempt 不计数）
          wakes.push(this.shape(w))
          continue
        }
        if (w.attempt >= 3) {
          w.status = 'dead' // 超限 dead-letter（投递终态，不再重投、inbox 不再计 pending）
          throw wbError('WB_WAKE_NOT_CLAIMABLE', 'wake dead-lettered after 3 delivery attempts')
        }
        w.attempt += 1 // 首投/租约过期重投：attempt+1，租约重授
        w.status = 'claimed'
        w.claimedUntil = now + this.leaseTtlMs
        claimed.push(id)
        wakes.push(this.shape(w))
      }
      return { claimed, alreadyClaimed, wakes, replayed: false }
    })) as ClaimResult
  }

  async ackWakes(input: { actorId: string; wakeIds: readonly string[] }): Promise<AckResult> {
    return (await this.guard('ackWakes', input, async () => {
      if (this.failAck > 0) {
        this.failAck -= 1
        throw wbError('WB_UNAVAILABLE', 'socket closed')
      }
      const acked: string[] = []
      const alreadyAcked: string[] = []
      for (const id of input.wakeIds) {
        const w = this.wakes.find((x) => x.wakeId === id)
        if (w === undefined || w.actorId !== input.actorId) throw wbError('WB_WAKE_NOT_FOUND', 'wake not found')
        if (w.status === 'dead') throw wbError('WB_WAKE_NOT_CLAIMABLE', 'wake dead-lettered')
        if (w.status === 'acked') {
          alreadyAcked.push(id) // ack 幂等
          continue
        }
        w.status = 'acked'
        acked.push(id)
      }
      return { acked, alreadyAcked, replayed: false }
    })) as AckResult
  }

  async listMessages(input: { roomId: string; limit?: number }): Promise<MessagePage> {
    return (await this.guard('listMessages', input, async () => {
      const all = this.messages.filter((m) => m.roomId === input.roomId) // 最旧在前（server 同序）
      const items = all.slice(0, input.limit ?? 50)
      return { items, nextCursor: null, hasMore: all.length > items.length }
    })) as MessagePage
  }

  async listRooms(): Promise<readonly Room[]> {
    return (await this.guard('listRooms', {}, async () => [
      { roomId: 'room-1', kind: 'broadcast', name: '大厅', memberIds: ['PRIME-0', 'AGENT-1', 'AGENT-2'], headRoomSeq: this.seq },
    ])) as readonly Room[]
  }

  close(): void {
    this.closed = true
  }

  /** 释放在途 inbox（holdInbox 测试面） */
  releaseInbox(result: InboxResult): void {
    this.held?.(result)
    this.held = undefined
  }

  private shape(w: FakeWakeState): unknown {
    return { wakeId: w.wakeId, actorId: w.actorId, roomId: w.roomId, sourceSeq: w.sourceSeq, cause: 'mention', status: w.status, claimedBy: null, claimedUntil: w.claimedUntil, createdAt: 0, ackedAt: null }
  }
}

// ————————————————————————— 夹具 —————————————————————————

interface FixtureOpts {
  leaseTtlMs?: number
  pollMs?: number
  maxBackoffMs?: number
  actors?: readonly string[]
}

function fixture(overrides?: FixtureOpts) {
  const chatd = new FakeChatd()
  if (overrides?.leaseTtlMs !== undefined) chatd.leaseTtlMs = overrides.leaseTtlMs
  const logs: string[] = []
  const emitted: InvokeIntent[] = []
  const source = createChatdMentionSource({
    company: 'acme',
    actors: overrides?.actors ?? ['AGENT-1', 'AGENT-2'],
    socketPath: 'unused-with-mock-transport.sock', // transport 已注入：socketPath 不被解析
    transport: chatd,
    pollMs: overrides?.pollMs ?? 100,
    ...(overrides?.maxBackoffMs !== undefined ? { maxBackoffMs: overrides.maxBackoffMs } : {}),
    log: (line) => logs.push(line),
  })
  return { chatd, logs, emitted, source, emit: (intent: InvokeIntent): void => { emitted.push(intent) } }
}

const inboxCalls = (c: FakeChatd): { method: string; input: unknown; at: number }[] => c.calls.filter((x) => x.method === 'inbox')

/** payload 收窄助手：InvokeIntent.payload=unknown，经消费闸同款结构校验收窄（源保证过闸） */
function payloadOf(intent: InvokeIntent): { eventId: string } {
  const checked = checkMentionPayload(intent.payload)
  if (typeof checked === 'string') throw new Error(`payload 结构闸不过：${checked}`)
  return checked
}

afterEach(() => {
  vi.useRealTimers()
})

// ————————————————————————— 配置开关（默认 matrix；本刀 inert） —————————————————————————

describe('mentionSourceKindOf（配置开关）', () => {
  it('缺省=matrix（生产现状不动）；chatd 直通；非法值 CONFIG_INVALID 明报', () => {
    expect(mentionSourceKindOf(undefined)).toBe('matrix')
    expect(mentionSourceKindOf(null)).toBe('matrix')
    expect(mentionSourceKindOf('')).toBe('matrix')
    expect(mentionSourceKindOf('chatd')).toBe('chatd')
    expect(() => mentionSourceKindOf('slack')).toThrow(/CONFIG_INVALID.*mentionSource.*matrix\|chatd/)
  })
})

// ————————————————————————— WB_* 错误分类（可读映射） —————————————————————————

describe('classifyChatdError（WB_* → 可读分类）', () => {
  it('传输三码→transport；鉴权/参数→config（unauthenticated: 明示 env 面）；终态→gone', () => {
    for (const code of ['WB_TIMEOUT', 'WB_UNAVAILABLE', 'WB_NOT_CONNECTED']) {
      const c = classifyChatdError(wbError(code, 'x'))
      expect(c.kind).toBe('transport')
      expect(c.readable).toContain(code)
    }
    const auth = classifyChatdError(wbError('WB_INVALID_ARGUMENT', 'unauthenticated: token invalid'))
    expect(auth.kind).toBe('config')
    expect(auth.readable).toContain('WORKBENCH_CHATD_TOKEN')
    expect(classifyChatdError(wbError('WB_WAKE_NOT_CLAIMABLE', 'wake dead-lettered')).kind).toBe('gone')
    expect(classifyChatdError(wbError('WB_IDEMPOTENCY_CONFLICT', 'x')).kind).toBe('conflict')
    expect(classifyChatdError(wbError('WB_PROTOCOL', 'x')).kind).toBe('defect')
    expect(classifyChatdError(new Error('boom')).kind).toBe('unknown')
  })
})

// ————————————————————————— 源行为 —————————————————————————

describe('createChatdMentionSource · 基线与恰一次', () => {
  it('首拉只建基线：启动前既有 pending wake 不 claim 不 emit（防重放）', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.chatd.send('@AGENT-1 开工', ['AGENT-1']) // 启动前已存在的 wake
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0) // 首拉（建基线）
    await vi.advanceTimersByTimeAsync(350) // 后续三拍
    expect(f.emitted).toEqual([])
    expect(f.chatd.calls.some((c) => c.method === 'claimWakes')).toBe(false)
    expect(f.logs.some((l) => l.includes('首拉建基线'))).toBe(true)
    f.source.stop()
  })

  it('新 wake 恰一次：claim→emit→ack 一条链，payload 过结构闸同形，后续拍不重发', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0) // 基线（两 actor 各一次 inbox）
    f.chatd.send('@AGENT-1 干活', ['AGENT-1'])
    await vi.advanceTimersByTimeAsync(100)
    expect(f.emitted.length).toBe(1)
    const intent = f.emitted[0] as InvokeIntent
    expect(intent).toMatchObject({ kind: 'mention', company: 'acme', source: CHATD_MENTION_SOURCE_NAME, dedupKey: 'wake:wake-1' })
    expect(typeof checkMentionPayload(intent.payload)).not.toBe('string') // 与 daemon 消费闸同形（结构闸直证）
    expect(intent.payload).toMatchObject({ target: 'AGENT-1', mention: '@AGENT-1', text: '@AGENT-1 干活', eventId: 'wake:wake-1', sender: 'PRIME-0', room: 'room-1', channel: '大厅' })
    expect(payloadOf(intent).eventId).toBe(intent.dedupKey) // 引擎幂等契约：dedupKey=eventId 源侧设置（taxonomy.ts 消费件强制相等）
    const claim = f.chatd.calls.find((c) => c.method === 'claimWakes')
    expect(claim?.input).toMatchObject({ actorId: 'AGENT-1', wakeIds: ['wake-1'] })
    expect((claim?.input as { idempotencyKey?: string }).idempotencyKey).toContain('AGENT-1|tick:') // actor+拍号
    const ack = f.chatd.calls.find((c) => c.method === 'ackWakes')
    expect(ack?.input).toMatchObject({ actorId: 'AGENT-1', wakeIds: ['wake-1'], idempotencyKey: 'wake:wake-1' })
    expect(f.chatd.wakes[0]?.status).toBe('acked')
    await vi.advanceTimersByTimeAsync(300) // 后续拍：已 ack 不再 pending → 不重发
    expect(f.emitted.length).toBe(1)
    expect(f.chatd.calls.filter((c) => c.method === 'claimWakes').length).toBe(1)
    f.source.stop()
  })

  it('多目标消息逐 actor 各一条：每 wake 独立 dedupKey，互不吞并', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0)
    f.chatd.send('@AGENT-1 @AGENT-2 都来', ['AGENT-1', 'AGENT-2'])
    await vi.advanceTimersByTimeAsync(100)
    expect(f.emitted.map((i) => i.dedupKey).sort()).toEqual(['wake:wake-1', 'wake:wake-2'])
    expect(f.emitted.every((i) => payloadOf(i).eventId === i.dedupKey)).toBe(true) // 多 actor 各自 eventId=dedupKey=wake:<各自 wakeId>
    expect(new Set(f.emitted.map((i) => payloadOf(i).eventId)).size).toBe(2) // 两条 wake → 两个不同 eventId/dedupKey（互不吞并）
    expect(f.emitted.every((i) => typeof checkMentionPayload(i.payload) !== 'string')).toBe(true)
    f.source.stop()
  })
})

describe('createChatdMentionSource · 幂等与重投', () => {
  it('租约期内重claim=alreadyClaimed 幂等吸收：attempt 不计数，同 dedupKey 重发（引擎折叠）→ ack 收口', async () => {
    vi.useFakeTimers()
    const f = fixture({ leaseTtlMs: 10_000 })
    f.chatd.failAck = 1 // 首拍 ack 失败：wake 留 claimed，租约仍有效
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0)
    f.chatd.send('@AGENT-1 修闸', ['AGENT-1'])
    await vi.advanceTimersByTimeAsync(100) // t=100：claim(attempt=1)→emit#1→ack 失败（拍软失败→退避 200）
    expect(f.emitted.length).toBe(1)
    await vi.advanceTimersByTimeAsync(200) // t=300：租约（至 10100）内重claim=alreadyClaimed→emit#2→ack 收口
    const claims = f.chatd.calls.filter((c) => c.method === 'claimWakes')
    expect((claims[1]?.input as { wakeIds: readonly string[] }).wakeIds).toEqual(['wake-1'])
    expect(f.emitted.map((i) => i.dedupKey)).toEqual(['wake:wake-1', 'wake:wake-1']) // 同键重发——恰一次归引擎幂等折叠
    expect(f.emitted.every((i) => payloadOf(i).eventId === i.dedupKey && payloadOf(i).eventId === 'wake:wake-1')).toBe(true) // 重投同 wake 同键：eventId 恒=dedupKey
    expect(f.chatd.wakes[0]?.attempt).toBe(1) // 幂等吸收：租约期内不计数
    expect(f.chatd.wakes[0]?.status).toBe('acked')
    await vi.advanceTimersByTimeAsync(200)
    expect(f.emitted.length).toBe(2) // ack 后不再重发
    f.source.stop()
  })

  it('租约过期重投（attempt+1）：同键 `wake:<id>` 重发后 ack 收口，恰一次归引擎', async () => {
    vi.useFakeTimers()
    const f = fixture({ leaseTtlMs: 300, pollMs: 1_000 })
    f.chatd.failAck = 1
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0)
    f.chatd.send('@AGENT-1 续命', ['AGENT-1'])
    await vi.advanceTimersByTimeAsync(1_000) // t=1000：首投 claim(attempt=1)→emit#1→ack 失败（退避 2000）
    expect(f.emitted.length).toBe(1)
    await vi.advanceTimersByTimeAsync(2_000) // t=3000：租约（至 1300）已过期→重投(attempt=2)→emit#2→ack 收口
    expect(f.chatd.wakes[0]?.attempt).toBe(2)
    expect(f.emitted.map((i) => i.dedupKey)).toEqual(['wake:wake-1', 'wake:wake-1'])
    expect(f.emitted.every((i) => payloadOf(i).eventId === i.dedupKey)).toBe(true) // 租约过期重投同 wake 同键：eventId 恒=dedupKey
    expect(f.chatd.wakes[0]?.status).toBe('acked')
    f.source.stop()
  })
})

describe('createChatdMentionSource · 引擎幂等契约（dedupKey=eventId 源侧设置）', () => {
  /** 最小消费件依赖（fake 平台零账本面——只验共闸+物化链，不验台账） */
  function mentionConsumerFixture(): { consume: ReturnType<typeof createMentionConsumer>; errors: string[]; candidates: Array<{ ticket: TicketId; intent: InvokeIntent }> } {
    const errors: string[] = []
    const candidates: Array<{ ticket: TicketId; intent: InvokeIntent }> = []
    const deps: IntentConsumerDeps = {
      platform: createFakePlatform(),
      syncMirror: () => {},
      makeEvent: () => {},
      tickEvents: [],
      config: {},
      people: [{ id: 'AGENT-1' }, { id: 'AGENT-2' }],
      errors,
      drainSeen: new Set<string>(),
      candidates,
      onMutation: () => {},
    }
    return { consume: createMentionConsumer(deps), errors, candidates }
  }

  // 修复直证：修复前源产 eventId=`${roomId}/${sourceSeq}` ≠ dedupKey=`wake:<id>`，引擎
  // 消费件（taxonomy.ts「幂等键源侧契约，105-刀A」）全拒收——daemon 日志 tick#944381 面。
  it('emit 的 payload.eventId === dedupKey === wake:<id>，过引擎 mention 消费件 dedupKey 闸（物化唤醒单零 errors）', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0)
    f.chatd.send('@AGENT-1 修幂等', ['AGENT-1'])
    await vi.advanceTimersByTimeAsync(100)
    expect(f.emitted.length).toBe(1)
    const intent = f.emitted[0] as InvokeIntent
    expect(intent.dedupKey).toBe('wake:wake-1')
    expect(payloadOf(intent).eventId).toBe('wake:wake-1')
    expect(payloadOf(intent).eventId).toBe(intent.dedupKey)
    const c = mentionConsumerFixture()
    await c.consume(intent, `${intent.source}|${intent.kind}|${intent.company}|${intent.dedupKey}`)
    expect(c.errors).toEqual([]) // dedupKey≠eventId 丢弃面已消除（同键过闸）
    expect(c.candidates.length).toBe(1) // 物化一张 @唤醒单（assignee=target）
    f.source.stop()
  })

  it('多 actor 两条 wake → 两个不同 dedupKey（各eventId=dedupKey），逐一过消费闸互不吞并', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0)
    f.chatd.send('@AGENT-1 @AGENT-2 各自独立', ['AGENT-1', 'AGENT-2'])
    await vi.advanceTimersByTimeAsync(100)
    expect(f.emitted.map((i) => i.dedupKey).sort()).toEqual(['wake:wake-1', 'wake:wake-2'])
    for (const intent of f.emitted) {
      expect(payloadOf(intent).eventId).toBe(intent.dedupKey)
      const c = mentionConsumerFixture()
      await c.consume(intent, `${intent.source}|${intent.kind}|${intent.company}|${intent.dedupKey}`)
      expect(c.errors).toEqual([])
      expect(c.candidates.length).toBe(1)
    }
    f.source.stop()
  })
})

describe('createChatdMentionSource · 停机与退避', () => {
  it('stop 清定时器无孤儿：清 setTimeout 链+关 transport，时间推进零新调用零 emit', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(0) // 基线 + 下一拍已调度
    expect(vi.getTimerCount()).toBe(1)
    f.source.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(f.chatd.closed).toBe(true)
    const before = inboxCalls(f.chatd).length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(inboxCalls(f.chatd).length).toBe(before)
    expect(f.emitted).toEqual([])
  })

  it('stop 在在途 poll 期间到达：请求返回后丢弃结果，不再 emit 不再调度', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.chatd.holdInbox = true
    f.source.start(f.emit) // 首拍 inbox 在途（挂起）
    expect(inboxCalls(f.chatd).length).toBe(1)
    f.chatd.send('@AGENT-1 迟到', ['AGENT-1'])
    f.source.stop()
    f.chatd.releaseInbox({ actorId: 'AGENT-1', unread: 0, mentions: 1, pendingWakeIds: ['wake-1'], rooms: [] }) // 在途请求此刻返回
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(inboxCalls(f.chatd).length).toBe(1) // 不再调度新拍
    expect(f.emitted).toEqual([]) // 丢弃结果：不 claim 不 emit
    expect(f.chatd.calls.some((c) => c.method === 'claimWakes')).toBe(false)
  })

  it('出错指数退避：翻倍封顶 maxBackoffMs、成功复位 pollMs（WB_* 可读分类入日志）', async () => {
    vi.useFakeTimers()
    const f = fixture({ pollMs: 100, maxBackoffMs: 400, actors: ['AGENT-1'] })
    f.chatd.failInbox = 3
    f.source.start(f.emit)
    await vi.advanceTimersByTimeAsync(1_150) // 0 失败→200 失败→600 失败→1000 成功（基线）→1100 常规拍
    const times = inboxCalls(f.chatd).map((c) => c.at)
    expect(times.map((t) => t - (times[0] ?? 0))).toEqual([0, 200, 600, 1000, 1100]) // 100→200→400（封顶）→复位 100（相对首拍，伪时钟基点=当前时刻）
    expect(f.logs.some((l) => l.includes('分类=transport') && l.includes('WB_UNAVAILABLE'))).toBe(true)
    f.source.stop()
  })
})
