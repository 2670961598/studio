/**
 * 会话入站消费件单测（studio-dev-646 Phase 1，docs/21-§七.2/§七.3）
 *
 * 覆盖：未绑定房缺省绑定（审计+回执）、窗口进任务书、命令不派单（/bind /clear /status /help）、
 * 非制作人/非白名单/幂等键伪造丢弃、eventId 去重、PATROL 审计锚、候选入队。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord } from '@studio-next/contract'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'
import { createConversationConsumer } from '../../../src/engine/conversation/consume.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PEOPLE = [{ id: 'PRIME-0', dept: 'departments/研发部' }, { id: 'ENG-1', dept: 'departments/研发部' }]
const PRODUCER = '@producer:localhost'
const ROOM = '!dm:localhost'

function makeStore(): ConversationStore {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-conversation-'))
  dirs.push(dir)
  return new ConversationStore({ dir, now: () => 1_790_000_000_000 })
}

function makeIssue(id: string): IssueRecord {
  return {
    id,
    company: 'acme',
    title: 't',
    description: 'd',
    state: '新单',
    type: 'task',
    level: 0,
    assignee: 'PRIME-0',
  } as unknown as IssueRecord
}

interface Harness {
  createCalls: Array<{ title: string; description: string; assignee?: string; type?: string; level?: number }>
  patrows: Array<{ name: EventRecord['event']; issue: string; note?: string }>
  candidates: Array<{ ticket: string; intent: InvokeIntent }>
  errors: string[]
  drainSeen: Set<string>
  mutations: number
  consume: (intent: InvokeIntent, Key: string) => Promise<void>
  store: ConversationStore
}

function harness(store = makeStore()): Harness {
  let n = 0
  const createCalls: Harness['createCalls'] = []
  const patrows: Harness['patrows'] = []
  const candidates: Harness['candidates'] = []
  const platform = {
    issues: {
      create: async (input: { title: string; description: string; assignee?: string; type?: string; level?: number }): Promise<IssueRecord> => {
        createCalls.push(input)
        n += 1
        const created = makeIssue(`LOCAL-${n}`)
        return {
          ...created,
          title: input.title,
          description: input.description,
          ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        }
      },
    },
  } as unknown as FlowPlatform
  const errors: string[] = []
  const drainSeen = new Set<string>()
  const h: Harness = {
    createCalls,
    patrows,
    candidates,
    errors,
    drainSeen,
    mutations: 0,
    store,
    consume: createConversationConsumer({
      conversation: {
        store,
        config: {
          company: 'acme',
          producer: PRODUCER,
          defaultPerson: 'PRIME-0',
          rooms: [ROOM],
          window: 12,
          maxChars: 6000,
          maxMessageChars: 2000,
        },
      },
      platform,
      syncMirror: () => {},
      makeEvent: (name, issue, _attempt, _tickEvents, extra) => {
        patrows.push({ name, issue: issue.id, ...(extra?.note !== undefined ? { note: extra.note } : {}) })
      },
      tickEvents: [],
      people: PEOPLE,
      errors,
      candidates,
      drainSeen,
      onMutation: () => {
        h.mutations += 1
      },
    }),
  }
  return h
}

function dm(eventId: string, text: string, overrides: Partial<Record<'sender' | 'room' | 'dedupKey', string>> = {}): InvokeIntent {
  return {
    kind: 'mention',
    company: 'acme',
    source: 'matrix',
    dedupKey: overrides.dedupKey ?? eventId,
    payload: {
      target: '',
      mention: 'DM',
      text,
      eventId,
      sender: overrides.sender ?? PRODUCER,
      room: overrides.room ?? ROOM,
      channel: overrides.room ?? ROOM,
      conversation: { v: 1 },
    },
  }
}

describe('入站：默认绑定与派单', () => {
  it('未绑定房首条消息 → 缺省绑定 PRIME-0（审计）+ 建单 + 候选 + PATROL 锚', async () => {
    const h = harness()
    await h.consume(dm('$e1', '你好，宰相'), 'matrix:mention:acme:$e1')
    expect(h.errors).toEqual([])
    expect(h.store.bindingOf(ROOM)).toMatchObject({ person: 'PRIME-0', reason: 'default' })
    expect(h.createCalls).toHaveLength(1)
    const created = h.createCalls[0]
    expect(created?.title).toContain('[对话] PRIME-0')
    expect(created?.assignee).toBe('PRIME-0')
    expect(created?.description).toContain('【本轮制作人消息】\n你好，宰相')
    expect(created?.description).toContain('历史上下文')
    expect(created?.description).toContain('会话不是单据')
    // studio-dev-684：任务书须含「去模板化/正常聊天/不设字数硬限制」回复纪律
    expect(created?.description).toContain('本轮是正常聊天，不是工程交付/汇报')
    expect(created?.description).toContain('不设字数/句数上限')
    expect(created?.description).toContain('不要工程汇报体')
    expect(h.candidates).toHaveLength(1)
    expect(h.candidates[0]?.intent.dedupKey).toBe('$e1')
    expect(h.store.turnOf('LOCAL-1')).toMatchObject({ person: 'PRIME-0', room: ROOM, done: false })
    expect(h.patrows[0]?.name).toBe('PATROL')
    expect(h.patrows[0]?.note).toContain('source=conversation')
    expect(h.mutations).toBe(1)
    // 缺省绑定回执入出站队列
    expect(h.store.pendingReplies(5).some((r) => r.text.includes('缺省绑定'))).toBe(true)
  })

  it('第二条消息的任务书带上一轮问答（窗口 N 生效）', async () => {
    const h = harness()
    await h.consume(dm('$e1', '第一句'), 'k1')
    // 模拟员工回复入会话（出站 relay 的写面）
    h.store.appendMessage({ person: 'PRIME-0', room: ROOM, role: 'person', text: '第一句的回复' })
    await h.consume(dm('$e2', '第二句'), 'k2')
    const second = h.createCalls[1]
    expect(second?.description).toContain('制作人：第一句')
    expect(second?.description).toContain('PRIME-0：第一句的回复')
    expect(second?.description).toContain('【本轮制作人消息】\n第二句')
  })
})

describe('命令面（不派单）', () => {
  it('/bind ENG-1 → 绑定切换 + 回执；下一条消息派给 ENG-1', async () => {
    const h = harness()
    await h.consume(dm('$b1', '/bind ENG-1'), 'k-bind')
    expect(h.createCalls).toHaveLength(0)
    expect(h.store.bindingOf(ROOM)).toMatchObject({ person: 'ENG-1', reason: 'explicit' })
    expect(h.store.pendingReplies(5).some((r) => r.text.includes('已绑定本房到 ENG-1'))).toBe(true)
    await h.consume(dm('$e1', '工程问题'), 'k1')
    expect(h.createCalls[0]?.assignee).toBe('ENG-1')
  })

  it('/bind 未知名工号 → 不改绑定、回执说明', async () => {
    const h = harness()
    await h.consume(dm('$b1', '/bind NOPE-9'), 'k-bind')
    expect(h.store.bindingOf(ROOM)).toBeUndefined()
    expect(h.createCalls).toHaveLength(0)
    expect(h.store.pendingReplies(5).some((r) => r.text.includes('未找到工号 NOPE-9'))).toBe(true)
  })

  it('/clear → 不派单、上下文归零、审计留行；绑定保留', async () => {
    const h = harness()
    await h.consume(dm('$e1', '旧消息'), 'k1')
    await h.consume(dm('$c1', '/clear 重开'), 'k-clear')
    expect(h.createCalls).toHaveLength(1)
    expect(h.store.context('PRIME-0', ROOM, { limit: 12, maxChars: 6000 }).text).toBe('')
    expect(h.store.bindingOf(ROOM)?.person).toBe('PRIME-0')
    expect(h.store.pendingReplies(5).some((r) => r.text.includes('已清空上下文'))).toBe(true)
    await h.consume(dm('$e2', '新消息'), 'k2')
    const second = h.createCalls[1]
    expect(second?.description).toContain('【历史上下文】\n（空：本房无更早消息或刚执行过 /clear）')
  })

  it('/status 与 /help 回执；未知命令回执', async () => {
    const h = harness()
    await h.consume(dm('$s1', '/status'), 'k-status')
    await h.consume(dm('$h1', '/help'), 'k-help')
    await h.consume(dm('$u1', '/wat'), 'k-unknown')
    expect(h.createCalls).toHaveLength(0)
    const texts = h.store.pendingReplies(10).map((r) => r.text)
    expect(texts.some((t) => t.includes('待送达'))).toBe(true)
    expect(texts.some((t) => t.includes('/bind <工号>'))).toBe(true)
    expect(texts.some((t) => t.includes('未知命令'))).toBe(true)
  })
})

describe('丢弃面（不可信输入/幂等）', () => {
  it('非制作人发送者 → 丢弃并明报', async () => {
    const h = harness()
    await h.consume(dm('$e1', 'hi', { sender: '@intruder:localhost' }), 'k1')
    expect(h.createCalls).toHaveLength(0)
    expect(h.errors.join('\n')).toContain('非制作人')
  })

  it('非白名单房 / dedupKey 伪造 / payload 标记不符 → 丢弃', async () => {
    const h = harness()
    await h.consume(dm('$e1', 'hi', { room: '!other:localhost' }), 'k1')
    await h.consume(dm('$e2', 'hi', { dedupKey: '$forged' }), 'k2')
    const broken = dm('$e3', 'hi')
    await h.consume({ ...broken, payload: { ...(broken.payload as object), conversation: { v: 2 } } }, 'k3')
    expect(h.createCalls).toHaveLength(0)
    expect(h.errors.length).toBe(3)
  })

  it('同 eventId 重投 → 只建一次单（跨调用幂等）', async () => {
    const h = harness()
    await h.consume(dm('$e1', '一次'), 'k1')
    await h.consume(dm('$e1', '一次'), 'k1')
    expect(h.createCalls).toHaveLength(1)
    expect(h.candidates).toHaveLength(1)
    expect(h.errors).toEqual([])
  })
})
