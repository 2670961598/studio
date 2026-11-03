/**
 * 会话出站中继单测（studio-dev-646 Phase 1，docs/21-§七.4 / v2/14-§1.9）
 *
 * 覆盖：REPORT 正文清洗后回房间（notify targets.room）、会话追加 person 角色、轮次 done 幂等、
 * 失败回执同轮同 attempt 一次、发送失败积压重试、非会话轮次零行为。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Notification } from '@studio-next/contract'
import type { Ledger, WorkRecord } from '@studio-next/store'
import type { NotifyBroadcastFace, NotifyBroadcastTargets, NotifySendReport } from '../../../src/engine/notify/broadcast.ts'
import type { RelayWorkSignal } from '../../../src/engine/intents/relay-resume-sources.ts'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'
import { createConversationRelay, extractConversationReply } from '../../../src/engine/conversation/reply.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-conversation-'))
  dirs.push(dir)
  return dir
}

function setup(options: { report?: string; failSend?: boolean } = {}): {
  store: ConversationStore
  relay: ReturnType<typeof createConversationRelay>
  sent: Array<{ message: Notification; targets: NotifyBroadcastTargets }>
  setFail: (fail: boolean) => void
} {
  const dir = tempDir()
  const store = new ConversationStore({ dir })
  store.bind('!dm:localhost', 'PRIME-0', '@producer:localhost', 'default')
  store.recordTurn({ issue: 'LOCAL-1', person: 'PRIME-0', room: '!dm:localhost', eventId: '$e1', attempt: 1 })
  const reportFile = path.join(dir, 'REPORT.md')
  if (options.report !== undefined) writeFileSync(reportFile, options.report)
  const records = [{ attempt: 1, report_ref: reportFile } as unknown as WorkRecord]
  const ledger = { listWorkRecords: () => records } as unknown as Ledger
  const sent: Array<{ message: Notification; targets: NotifyBroadcastTargets }> = []
  let fail = options.failSend ?? false
  const notify: NotifyBroadcastFace = {
    async send(message: Notification, targets: NotifyBroadcastTargets): Promise<NotifySendReport> {
      sent.push({ message, targets })
      return fail ? { sent: [], failed: [{ target: 'room', reason: 'fake matrix down' }] } : { sent: ['room'], failed: [] }
    },
  }
  const relay = createConversationRelay({
    store,
    ledger,
    notify,
    config: { company: 'acme', replyMaxChars: 200 },
    signatureOf: (person) => `[acme·departments/研发部·${person}·1]`,
  })
  return { store, relay, sent, setFail: (value: boolean) => { fail = value } }
}

function signal(overrides: Partial<RelayWorkSignal> = {}): RelayWorkSignal {
  return { ticket: 'LOCAL-1', attempt: 1, outcome: 'completed', personId: 'PRIME-0', ...overrides }
}

describe('extractConversationReply', () => {
  it('去 front-matter 与首个一级标题；超长截断并标注', () => {
    expect(extractConversationReply('---\ntitle: x\n---\n# 回复\n正文\n', 100)).toBe('正文')
    const long = extractConversationReply('# t\n' + '啊'.repeat(50), 10)
    expect(long.startsWith('啊'.repeat(10))).toBe(true)
    expect(long).toContain('原文 50 字')
  })
})

describe('出站：收割完成 → 回写会话 + 房间发送', () => {
  it('completed → REPORT 正文入会话并以 notify targets.room 发回；二次信号不重发', async () => {
    const h = setup({ report: '---\nschema: summary/v1\n---\n# 回复\n宰相已收到。' })
    h.relay.onWorkComplete(signal())
    await h.relay.relay()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.targets).toEqual({ room: '!dm:localhost' })
    expect(h.sent[0]?.message.body).toBe('宰相已收到。')
    expect(h.sent[0]?.message.from).toBe('[acme·departments/研发部·PRIME-0·1]')
    const ctx = h.store.context('PRIME-0', '!dm:localhost', { limit: 12, maxChars: 6000 })
    expect(ctx.text).toContain('PRIME-0：宰相已收到。')
    expect(h.store.turnOf('LOCAL-1')?.done).toBe(true)
    expect(h.store.pendingReplies(5)).toEqual([])

    h.relay.onWorkComplete(signal())
    await h.relay.relay()
    expect(h.sent).toHaveLength(1)
  })

  it('REPORT 缺失 → 诚实回执（不冒充回复），轮次仍收口', async () => {
    const h = setup()
    h.relay.onWorkComplete(signal())
    await h.relay.relay()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.message.body).toContain('回复正文为空/不可读')
    expect(h.store.turnOf('LOCAL-1')?.done).toBe(true)
  })

  it('failed → 同轮同 attempt 只发一次回执；新 attempt 可再发', async () => {
    const h = setup()
    h.relay.onWorkComplete(signal({ outcome: 'failed' }))
    h.relay.onWorkComplete(signal({ outcome: 'failed' }))
    await h.relay.relay()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.message.body).toContain('未过收割四要件')
    expect(h.store.turnOf('LOCAL-1')?.done).toBe(false) // 失败不标 done：后续成功仍可回信

    h.relay.onWorkComplete(signal({ outcome: 'failed', attempt: 2 }))
    await h.relay.relay()
    expect(h.sent).toHaveLength(2)
  })

  it('发送失败 → 积压不丢；恢复后重试送达', async () => {
    const h = setup({ report: '# r\n积压回复', failSend: true })
    h.relay.onWorkComplete(signal())
    await h.relay.relay()
    expect(h.sent).toHaveLength(1)
    expect(h.store.pendingReplies(5)).toHaveLength(1)
    expect(h.relay.stats.failed).toBe(1)

    h.setFail(false)
    await h.relay.relay()
    expect(h.sent).toHaveLength(2)
    expect(h.store.pendingReplies(5)).toEqual([])
    expect(h.relay.stats.sent).toBe(1)
  })

  it('非会话轮次 → 零行为（不发送/不改会话）', async () => {
    const h = setup({ report: 'x' })
    h.relay.onWorkComplete(signal({ ticket: 'LOCAL-999' }))
    await h.relay.relay()
    expect(h.sent).toEqual([])
  })
})
