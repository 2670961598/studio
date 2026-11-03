/**
 * consume 建单失败语义回归（F1，studio-dev-654b 复验退回项）
 *
 * 旧顺序不变量：先 create → 成功才 append；create 失败=本轮未入队（消息未落盘、drainSeen 未标记）
 * → 重投可重试、不静默丢消息（verifier A2 探针等价断言）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord } from '@studio-next/contract'
import { createConversationConsumer } from '../../../src/engine/conversation/consume.ts'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PEOPLE = [{ id: 'PRIME-0', dept: 'departments/研发部' }]
const PRODUCER = '@producer:localhost'
const ROOM = '!dm:localhost'

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

describe('consume 建单失败语义（F1：失败不静默丢消息）', () => {
  it('create 首错→消息未落盘/未标记 drainSeen；重投成功补派一次', async () => {
    const dir = mkdtempSync(path.join(process.cwd(), '.tmp-consume-failure-'))
    dirs.push(dir)
    const store = new ConversationStore({ dir, now: () => 1_790_000_000_000 })
    let failCreate = 1
    let issueSeq = 0
    const createCalls: Array<{ title: string; description: string; assignee?: string }> = []
    const platform = {
      issues: {
        create: async (input: { title: string; description: string; assignee?: string }): Promise<IssueRecord> => {
          createCalls.push(input)
          if (failCreate > 0) {
            failCreate -= 1
            throw new Error('platform down')
          }
          issueSeq += 1
          return makeIssue(`LOCAL-${issueSeq}`)
        },
      },
    } as unknown as FlowPlatform
    const errors: string[] = []
    const candidates: Array<{ ticket: string; intent: InvokeIntent }> = []
    const drainSeen = new Set<string>()
    let mutations = 0
    const consumer = createConversationConsumer({
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
      syncMirror: (): void => {},
      makeEvent: (name: EventRecord['event']): void => {
        void name
      },
      tickEvents: [],
      people: PEOPLE,
      errors,
      candidates,
      drainSeen,
      onMutation: (): void => {
        mutations += 1
      },
    })
    const payload = {
      target: '',
      mention: 'DM',
      text: '重投能补派吗',
      eventId: 'e-f1',
      sender: PRODUCER,
      room: ROOM,
      channel: '',
      conversation: { v: 1 },
    }
    const intent: InvokeIntent = { kind: 'mention', company: 'acme', source: 'matrix', payload, dedupKey: 'e-f1' }

    // 第一投：create 抛错 → 不 append、不标记、不进候选（可重发）
    await consumer(intent, 'intent-e-f1')
    expect(createCalls).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('本轮未入队（可重发）')
    expect(store.hasEvent('PRIME-0', 'e-f1')).toBe(false)
    expect(store.visibleRecords('PRIME-0')).toHaveLength(0)
    expect(drainSeen.size).toBe(0)
    expect(candidates).toHaveLength(0)
    expect(mutations).toBe(0)

    // 第二投：重试成功 → 建单+append+轮次锚+PATROL+候选
    await consumer(intent, 'intent-e-f1')
    expect(createCalls).toHaveLength(2)
    expect(store.hasEvent('PRIME-0', 'e-f1')).toBe(true)
    expect(store.visibleRecords('PRIME-0')).toHaveLength(1)
    expect(candidates).toHaveLength(1)
    expect(mutations).toBe(1)
    expect(drainSeen.size).toBe(1)
  })
})
