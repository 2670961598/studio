/**
 * 面板→Matrix 中继单测（studio-dev-654a 的 B 路；docs/21-§七.4，v2/14-§8.1）
 *
 * 覆盖：只中继 source='panel' 的 producer 消息（matrix 入站/员工回复/clear 不发送）、同一 seq 只发
 * 一次、失败保留游标下一拍重试、重启从状态文件恢复不重发、游标文件结构（relayedSeq；预留字段保留）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Notification } from '@studio-next/contract'
import type { NotifyBroadcastFace, NotifySendReport } from '../../../src/engine/notify/broadcast.ts'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'
import { createPanelRelay } from '../../../src/engine/conversation/panel-relay.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-panel-relay-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface SentCall {
  readonly message: Notification
  readonly room: string | undefined
}

function fakeNotify(options: { fail?: boolean } = {}): { notify: NotifyBroadcastFace; calls: SentCall[] } {
  const calls: SentCall[] = []
  const notify: NotifyBroadcastFace = {
    async send(message: Notification, targets): Promise<NotifySendReport> {
      calls.push({ message, room: targets.room })
      if (options.fail === true) return { sent: [], failed: [{ target: 'room', reason: 'matrix-down' }] }
      return { sent: ['room'], failed: [] }
    },
  }
  return { notify, calls }
}

function fixture(): { store: ConversationStore; room: string; statePath: string } {
  const dir = tempDir()
  const room = '!dm:localhost'
  const store = new ConversationStore({
    dir,
    now: () => 1_790_000_000_000,
    id: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
  })
  store.bind(room, 'PRIME-0', '@producer:localhost', 'default')
  return { store, room, statePath: path.join(dir, 'var', 'conversations', '.relay-state.json') }
}

function appendPanel(store: ConversationStore, room: string, text: string): void {
  store.appendMessage({ person: 'PRIME-0', room, role: 'producer', text, source: 'panel' })
}

describe('面板→Matrix 中继（B）', () => {
  it('只发 panel 源消息；同一 seq 只发一次；状态文件记录 relayedSeq', async () => {
    const { store, room, statePath } = fixture()
    appendPanel(store, room, 'p1')
    store.appendMessage({ person: 'PRIME-0', room, role: 'person', text: '员工回复', source: 'matrix' })
    appendPanel(store, room, 'p2')
    store.clear(room, 'PRIME-0', 'PRIME-0')
    const { notify, calls } = fakeNotify()
    const relay = createPanelRelay({ store, notify, statePath, senderSignature: '[公司·制作人]' })
    await relay.relay()
    expect(calls.map((call) => call.message.body)).toEqual(['p1', 'p2'])
    expect(calls.every((call) => call.room === room)).toBe(true)
    expect(calls[0]?.message.from).toBe('[公司·制作人]')
    expect(relay.stats).toMatchObject({ sent: 2, failed: 0 })
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { v: number; persons: Record<string, { relayedSeq: number }> }
    expect(state.v).toBe(1)
    // 游标只在成功中继时落盘：最后一条 panel 消息 seq=3（clear seq=4 不发送、不推进落盘游标）
    expect(state.persons['PRIME-0']?.relayedSeq).toBe(3)
    // 第二拍：无新消息 → 不重发
    await relay.relay()
    expect(calls).toHaveLength(2)
  })

  it('失败：保留游标、计失败数；下一拍成功才推进', async () => {
    const { store, room, statePath } = fixture()
    appendPanel(store, room, 'p1')
    const down = fakeNotify({ fail: true })
    const relayDown = createPanelRelay({ store, notify: down.notify, statePath, senderSignature: '[公司·制作人]' })
    await relayDown.relay()
    expect(down.calls).toHaveLength(1)
    expect(relayDown.stats).toMatchObject({ sent: 0, failed: 1 })
    const up = fakeNotify()
    const relayUp = createPanelRelay({ store, notify: up.notify, statePath, senderSignature: '[公司·制作人]' })
    await relayUp.relay()
    expect(up.calls.map((call) => call.message.body)).toEqual(['p1'])
    expect(relayUp.stats).toMatchObject({ sent: 1, failed: 0 })
  })

  it('重启恢复：新实例读状态文件，不重发已中继消息', async () => {
    const { store, room, statePath } = fixture()
    appendPanel(store, room, 'p1')
    const first = fakeNotify()
    await createPanelRelay({ store, notify: first.notify, statePath, senderSignature: '[公司·制作人]' }).relay()
    expect(first.calls).toHaveLength(1)
    appendPanel(store, room, 'p2')
    const second = fakeNotify()
    await createPanelRelay({ store, notify: second.notify, statePath, senderSignature: '[公司·制作人]' }).relay()
    expect(second.calls.map((call) => call.message.body)).toEqual(['p2'])
  })

  it('状态文件预留字段保留：写入 relayedSeq 不覆盖既有 dispatchedSeq', async () => {
    const { store, room, statePath } = fixture()
    appendPanel(store, room, 'p1')
    const stateDir = path.dirname(statePath)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, `${JSON.stringify({ v: 1, persons: { 'PRIME-0': { relayedSeq: 0, dispatchedSeq: 7 } } })}\n`, 'utf8')
    const { notify } = fakeNotify()
    await createPanelRelay({ store, notify, statePath, senderSignature: '[公司·制作人]' }).relay()
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      persons: Record<string, { relayedSeq: number; dispatchedSeq?: number | null }>
    }
    expect(state.persons['PRIME-0']).toMatchObject({ relayedSeq: 1, dispatchedSeq: 7 })
  })
})
