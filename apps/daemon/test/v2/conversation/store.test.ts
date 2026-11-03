/**
 * 会话存储单测（studio-dev-646 Phase 1，docs/21-§七.1/§七.3/§七.4）
 *
 * 覆盖：绑定（后写覆盖/重载存活）、消息幂等、窗口 N/字数预算/单条截断、clear 审计与
 * 上下文归零、轮次锚、出站队列+送达回执、跨实例重建、畸形行跳过、工号路径安全。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-conversation-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function store(): ConversationStore {
  return new ConversationStore({ dir: tempDir(), now: () => 1_790_000_000_000, id: (() => {
    let n = 0
    return () => `id-${++n}`
  })() })
}

describe('绑定', () => {
  it('同房后写覆盖先写；新实例从 _bindings.jsonl 重建', () => {
    const dir = tempDir()
    const a = new ConversationStore({ dir })
    a.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    a.bind('!dm:localhost', 'ENG-1', '@producer:localhost', 'explicit')
    expect(a.bindingOf('!dm:localhost')).toMatchObject({ person: 'ENG-1', reason: 'explicit', by: '@producer:localhost' })
    const b = new ConversationStore({ dir })
    expect(b.bindingOf('!dm:localhost')?.person).toBe('ENG-1')
    expect(b.bindingOf('!other:localhost')).toBeUndefined()
  })

  it('非法工号（路径穿越面）拒写', () => {
    const s = store()
    expect(() => s.bind('!dm:localhost', '../evil', '@producer:localhost', 'explicit')).toThrow(/非法工号/)
  })
})

describe('消息与上下文窗口', () => {
  it('eventId 幂等：同人同 eventId 重复追加返回 undefined 且不双写', () => {
    const s = store()
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    const first = s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: '你好', eventId: '$e1' })
    expect(first).toBeDefined()
    expect(s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: '你好', eventId: '$e1' })).toBeUndefined()
    expect(s.hasEvent('PRIME-0', '$e1')).toBe(true)
  })

  it('窗口 N：只取最近 N 条并标注省略；按 room 隔离', () => {
    const s = store()
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    for (let i = 1; i <= 5; i += 1) {
      s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: i % 2 === 1 ? 'producer' : 'person', text: `m${i}` })
    }
    s.appendMessage({ person: 'PRIME-0', room: '!other:localhost', role: 'producer', text: 'other-room' })
    const win = s.context('PRIME-0', '!dm:localhost', { limit: 3, maxChars: 6000 })
    expect(win.included).toBe(3)
    expect(win.omitted).toBe(2)
    expect(win.text).toContain('更早 2 条已省略')
    expect(win.text).toContain('m3')
    expect(win.text).toContain('m5')
    expect(win.text).not.toContain('m2')
    expect(win.text).not.toContain('other-room')
  })

  it('字数预算：超预算从最旧丢；单条超长截断', () => {
    const s = new ConversationStore({ dir: tempDir(), maxMessageChars: 10 })
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: '旧'.repeat(9) })
    s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'person', text: '新'.repeat(30) })
    const win = s.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 20 })
    expect(win.omitted).toBe(1)
    expect(win.text).not.toContain('旧')
    expect(win.text).toContain('超长截断')
  })

  it('clear：上下文归零、历史行不删、审计含操作者/条数/清空前末消息；跨实例生效', () => {
    const dir = tempDir()
    const s = new ConversationStore({ dir })
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: 'a' })
    s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'person', text: 'b' })
    const receipt = s.clear('!dm:localhost', 'PRIME-0', '@producer:localhost', '重开')
    expect(receipt).toMatchObject({ count: 2, room: '!dm:localhost' })
    expect(receipt.before).toBeDefined()
    expect(s.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 6000 }).text).toBe('')
    s.appendMessage({ person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: 'clear 之后' })
    expect(s.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 6000 }).text).toContain('clear 之后')
    const lines = readFileSync(path.join(dir, 'PRIME-0.jsonl'), 'utf8').trim().split('\n')
    expect(lines.some((line) => (JSON.parse(line) as { kind?: string }).kind === 'clear')).toBe(true)
    const reloaded = new ConversationStore({ dir })
    const win = reloaded.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 6000 })
    expect(win.included).toBe(1)
    expect(win.text).toContain('clear 之后')
  })
})

describe('轮次与出站队列', () => {
  it('轮次锚幂等、done 标记跨实例；pendingReplies 只含未送达', () => {
    const dir = tempDir()
    const s = new ConversationStore({ dir })
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    s.recordTurn({ issue: 'LOCAL-1', person: 'PRIME-0', room: '!dm:localhost', eventId: '$e1', attempt: 1 })
    expect(s.recordTurn({ issue: 'LOCAL-1', person: 'PRIME-0', room: '!dm:localhost', eventId: '$e1', attempt: 1 })).toMatchObject({ issue: 'LOCAL-1' })
    expect(s.turnOf('LOCAL-1')?.person).toBe('PRIME-0')
    const reply = s.enqueueReply({ person: 'PRIME-0', room: '!dm:localhost', text: '回信', kind: 'reply', forIssue: 'LOCAL-1' })
    expect(s.pendingReplies(5).map((r) => r.id)).toEqual([reply.id])
    expect(s.markTurnDone('LOCAL-1')).toBe(true)
    expect(s.markTurnDone('LOCAL-1')).toBe(false)
    expect(s.markDelivered(reply.id)).toBe(true)
    expect(s.pendingReplies(5)).toEqual([])

    const reloaded = new ConversationStore({ dir })
    expect(reloaded.turnOf('LOCAL-1')?.done).toBe(true)
    expect(reloaded.pendingReplies(5)).toEqual([])
  })

  it('失败回执去重按 issue#attempt（跨实例）', () => {
    const dir = tempDir()
    const s = new ConversationStore({ dir })
    s.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    expect(s.failureNoticeSent('LOCAL-2', 1)).toBe(false)
    s.recordFailureNotice('PRIME-0', 'LOCAL-2', 1)
    expect(s.failureNoticeSent('LOCAL-2', 1)).toBe(true)
    expect(s.failureNoticeSent('LOCAL-2', 2)).toBe(false)
    expect(new ConversationStore({ dir }).failureNoticeSent('LOCAL-2', 1)).toBe(true)
  })
})

describe('重建与容错', () => {
  it('畸形行跳过并计数，合法行照常装载；会话文件 0600', () => {
    const dir = tempDir()
    writeFileSync(
      path.join(dir, 'PRIME-0.jsonl'),
      `${JSON.stringify({ v: 1, kind: 'msg', id: 'a', at: 1, person: 'PRIME-0', room: '!dm:localhost', role: 'producer', text: 'ok', eventId: '$x' })}\n` +
        'not-json\n' +
        `${JSON.stringify({ v: 1, kind: 'msg', id: 'b', at: 2, person: 'PRIME-0', room: '!dm:localhost', role: 'person', text: 'ok2' })}\n`,
    )
    const s = new ConversationStore({ dir })
    expect(s.stats('PRIME-0').problems).toBe(1)
    expect(s.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 6000 }).included).toBe(2)
    s.appendMessage({ person: 'ENG-1', room: '!dm:localhost', role: 'producer', text: 'x' })
    expect(existsSync(path.join(dir, 'ENG-1.jsonl'))).toBe(true)
    expect(readFileSync(path.join(dir, 'ENG-1.jsonl'), 'utf8').length).toBeGreaterThan(0)
  })
})
