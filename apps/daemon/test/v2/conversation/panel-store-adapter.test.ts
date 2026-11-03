/**
 * panel ConversationStore 适配器单测（studio-dev-654a；docs/21-§七.1/§七.4，v2/14-§8.1）
 *
 * 覆盖：同一 JSONL 单源读写、seq 合成（msg/clear 有效行文件序）、source/clientMsgId 透传、
 * clientMsgId 幂等（deduped=true）与异内容 409、system 旁白不进读面、未绑定房 fail-closed、
 * list 摘要 count=最后 clear 之后消息数。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationConflictError } from '@studio-next/panel/conversation'
import { DaemonPanelConversationStore } from '../../../src/assembly/panel/conversation-store.ts'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-panel-adapter-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(): { store: ConversationStore; adapter: DaemonPanelConversationStore; room: string } {
  const store = new ConversationStore({
    dir: tempDir(),
    now: () => 1_790_000_000_000,
    id: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
  })
  const room = '!dm:localhost'
  store.bind(room, 'PRIME-0', '@producer:localhost', 'default')
  return { store, adapter: new DaemonPanelConversationStore(store, { producerId: 'PRIME-0' }), room }
}

describe('panel Port 适配器（同一 JSONL 单源）', () => {
  it('读写同一文件；seq 按有效行文件序合成；source/clientMsgId 透传', async () => {
    const { store, adapter, room } = fixture()
    store.appendMessage({ person: 'PRIME-0', room, role: 'producer', text: 'matrix 入站', source: 'matrix' })
    const appended = await adapter.appendMessage({
      personId: 'PRIME-0',
      text: '面板写入',
      source: 'panel',
      from: { kind: 'producer', ref: 'PRIME-0' },
      clientMsgId: 'c-1',
    })
    expect(appended.deduped).toBe(false)
    expect(appended.message).toMatchObject({
      v: 1,
      kind: 'message',
      seq: 2,
      personId: 'PRIME-0',
      text: '面板写入',
      source: 'panel',
      clientMsgId: 'c-1',
      from: { kind: 'producer', ref: 'PRIME-0' },
    })
    const entries = await adapter.read('PRIME-0')
    expect(entries.map((e) => e.seq)).toEqual([1, 2])
    expect(entries[0]).toMatchObject({ kind: 'message', source: 'matrix', text: 'matrix 入站' })
    // 同一文件（单源）：store 上下文可见面板写入（role=producer）
    expect(store.context('PRIME-0', room, { limit: 10, maxChars: 10_000 }).included).toBe(2)
  })

  it('clientMsgId 幂等：同键同内容 deduped=true；同键异内容 409（ConversationConflictError）', async () => {
    const { adapter } = fixture()
    const input = {
      personId: 'PRIME-0',
      text: '同一句',
      source: 'panel' as const,
      from: { kind: 'producer' as const, ref: 'PRIME-0' },
      clientMsgId: 'same-key',
    }
    const first = await adapter.appendMessage(input)
    const again = await adapter.appendMessage(input)
    expect(first.deduped).toBe(false)
    expect(again.deduped).toBe(true)
    expect(again.message.seq).toBe(first.message.seq)
    await expect(adapter.appendMessage({ ...input, text: '不同句' })).rejects.toBeInstanceOf(ConversationConflictError)
  })

  it('system 旁白不进读面、不占 seq；clear 追加行保留且 count 正确', async () => {
    const { store, adapter, room } = fixture()
    store.appendMessage({ person: 'PRIME-0', room, role: 'system', text: '系统旁白' })
    await adapter.appendMessage({
      personId: 'PRIME-0',
      text: 'm1',
      source: 'panel',
      from: { kind: 'producer', ref: 'PRIME-0' },
    })
    store.appendMessage({ person: 'PRIME-0', room, role: 'person', text: '员工回复', source: 'matrix' })
    expect((await adapter.read('PRIME-0')).map((e) => e.kind)).toEqual(['message', 'message'])
    const clear = await adapter.clear({ personId: 'PRIME-0', by: 'PRIME-0', source: 'panel', reason: '重开' })
    expect(clear).toMatchObject({ kind: 'clear', seq: 3, personId: 'PRIME-0', by: 'PRIME-0', source: 'panel', reason: '重开' })
    const list = await adapter.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ personId: 'PRIME-0', count: 0, clearedAt: 1_790_000_000_000 })
  })

  it('未绑定 DM 房的工号：fail-closed 抛错（不猜房/不落假 room）', async () => {
    const { store, adapter } = fixture()
    store.bind('!other:localhost', 'ENG-1', '@producer:localhost', 'explicit')
    await expect(
      adapter.appendMessage({
        personId: 'ENG-2',
        text: 'x',
        source: 'panel',
        from: { kind: 'producer', ref: 'PRIME-0' },
      }),
    ).rejects.toThrow(/未绑定 DM 房/)
  })
})
