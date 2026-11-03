/**
 * 跨进程读面单测（studio-dev-654a 复审缺陷修复；docs/21-§七.1）
 *
 * 场景：面板进程与 daemon 各持一个 ConversationStore 实例、共享同一 companyDir。
 * 覆盖：A 写→B 读（visibleRecords/clientMsgId 幂等表/eventIds 上下文）、B 写→A 读、
 * bindings 跨实例可见（roomFor/bindingOf）、turn/reply 状态重载、半行/坏行容错（跳过不抛）。
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-conversation-xproc-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function clocks(): { now: () => number; id: () => string } {
  let n = 0
  return { now: () => 1_790_000_000_000, id: () => `id-${++n}` }
}

describe('跨进程读面（面板进程与 daemon 双写者）', () => {
  it('A 写→B 读：消息/幂等表/上下文；B 写→A 读', () => {
    const dir = tempDir()
    const a = new ConversationStore({ dir, ...clocks() })
    const b = new ConversationStore({ dir, ...clocks() })
    const room = '!dm:localhost'

    a.bind(room, 'PRIME-0', '@producer:localhost', 'default')
    a.appendMessage({
      person: 'PRIME-0',
      room,
      role: 'producer',
      text: '面板写入',
      source: 'panel',
      clientMsgId: 'c-1',
    })

    // B 首次读：按文件签名重载（B 构造时文件还不存在）
    expect(b.visibleRecords('PRIME-0')).toHaveLength(1)
    expect(b.findMessageByClientMsgId('PRIME-0', 'c-1')?.text).toBe('面板写入')
    expect(b.context('PRIME-0', room, { limit: 10, maxChars: 10_000 }).text).toContain('面板写入')

    // 幂等表随重载同步：B 用同键追加被去重
    expect(
      b.appendMessage({ person: 'PRIME-0', room, role: 'producer', text: '面板写入', source: 'panel', clientMsgId: 'c-1' }),
    ).toBeUndefined()
    expect(b.visibleRecords('PRIME-0')).toHaveLength(1)

    // B 写 → A 读（反向可见）
    b.appendMessage({ person: 'PRIME-0', room, role: 'person', text: '员工回复', source: 'matrix', eventId: 'e-1' })
    expect(a.visibleRecords('PRIME-0').map((r) => (r.kind === 'msg' ? r.text : ''))).toEqual(['面板写入', '员工回复'])
    expect(a.hasEvent('PRIME-0', 'e-1')).toBe(true)
  })

  it('bindings 跨实例可见：A bind → B roomFor/bindingOf；后写覆盖先写', () => {
    const dir = tempDir()
    const a = new ConversationStore({ dir })
    const b = new ConversationStore({ dir })
    expect(b.roomFor('PRIME-0')).toBeUndefined()

    a.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
    expect(b.roomFor('PRIME-0')).toBe('!dm:localhost')
    expect(b.bindingOf('!dm:localhost')?.person).toBe('PRIME-0')

    a.bind('!dm2:localhost', 'PRIME-0', '@producer:localhost', 'explicit')
    expect(b.roomFor('PRIME-0')).toBe('!dm2:localhost')
    expect(b.bindingOf('!dm2:localhost')?.reason).toBe('explicit')
  })

  it('turn/reply 状态跨实例重载可见', () => {
    const dir = tempDir()
    const a = new ConversationStore({ dir, ...clocks() })
    const b = new ConversationStore({ dir, ...clocks() })
    const room = '!dm:localhost'
    a.bind(room, 'PRIME-0', '@producer:localhost', 'default')
    a.recordTurn({ issue: 'LOCAL-1', person: 'PRIME-0', room, eventId: 'e-1', attempt: 1 })
    expect(b.turnOf('LOCAL-1')?.person).toBe('PRIME-0')
    a.enqueueReply({ person: 'PRIME-0', room, text: '回信', kind: 'reply' })
    expect(b.pendingReplies(5)).toHaveLength(1)
  })

  it('半行/坏行容错：解析失败跳过计数不抛；下次签名变化补读', () => {
    const dir = tempDir()
    const a = new ConversationStore({ dir, ...clocks() })
    const b = new ConversationStore({ dir, ...clocks() })
    const room = '!dm:localhost'
    a.bind(room, 'PRIME-0', '@producer:localhost', 'default')
    a.appendMessage({ person: 'PRIME-0', room, role: 'producer', text: 'm1', source: 'panel' })

    // 模拟另一进程写入时被读到「半行」（两次 append 合成完整一行；读面中途看到半行须跳过不抛）
    const file = path.join(dir, 'PRIME-0.jsonl')
    const second = JSON.stringify({
      v: 1,
      kind: 'msg',
      id: 'id-x',
      at: 1_790_000_000_001,
      person: 'PRIME-0',
      room,
      role: 'person',
      text: 'm2',
      source: 'matrix',
    })
    appendFileSync(file, second.slice(0, 24), 'utf8')
    expect(() => b.visibleRecords('PRIME-0')).not.toThrow()
    expect(b.visibleRecords('PRIME-0')).toHaveLength(1)

    appendFileSync(file, second.slice(24) + '\n', 'utf8')
    expect(b.visibleRecords('PRIME-0')).toHaveLength(2)
  })
})
