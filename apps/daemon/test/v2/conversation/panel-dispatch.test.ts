/**
 * 面板源派单 watcher 单测（studio-dev-654b；docs/21-§七.4，v2/14-§8.1）
 *
 * 覆盖：panel 源消息派单（建 `[对话]` 单/轮次锚/PATROL/candidates）、游标推进与重启恢复、
 * 崩溃重派防护（turn 已存在→只推进游标）、非 panel 源不派、失败重试不丢、拍内每工号 1 条、
 * 上下文窗口排除本轮、双游标互不覆盖、Port 适配器→watcher 端到端。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord } from '@studio-next/contract'
import { DaemonPanelConversationStore } from '../../../src/assembly/panel/conversation-store.ts'
import type { ConversationTickDeps } from '../../../src/engine/conversation/consume.ts'
import { dispatchPanelPending } from '../../../src/engine/conversation/panel-dispatch.ts'
import { createRelayStateStore } from '../../../src/engine/conversation/relay-state.ts'
import { ConversationStore } from '../../../src/engine/conversation/store.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PEOPLE = [{ id: 'PRIME-0', dept: 'departments/研发部' }]
const PRODUCER = '@producer:localhost'
const ROOM = '!dm:localhost'

function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-panel-dispatch-'))
  dirs.push(dir)
  return dir
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
  store: ConversationStore
  statePath: string
  createCalls: Array<{ title: string; description: string; assignee?: string }>
  patrows: Array<{ name: EventRecord['event']; issue: string; note?: string }>
  candidates: Array<{ ticket: string; intent: InvokeIntent }>
  errors: string[]
  mutations: number
  dispatch: () => Promise<number>
}

function harness(options: { failCreateTimes?: number; dir?: string } = {}): Harness {
  const dir = options.dir ?? tempDir()
  const store = new ConversationStore({
    dir,
    now: () => 1_790_000_000_000,
    id: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
  })
  store.bind(ROOM, 'PRIME-0', PRODUCER, 'default')
  const statePath = path.join(dir, 'var', 'conversations', '.relay-state.json')
  const createCalls: Harness['createCalls'] = []
  const patrows: Harness['patrows'] = []
  const candidates: Harness['candidates'] = []
  const errors: string[] = []
  let failCreate = options.failCreateTimes ?? 0
  let issueSeq = 0
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
  const conversation: ConversationTickDeps & { statePath: string } = {
    store,
    statePath,
    config: {
      company: 'acme',
      producer: PRODUCER,
      defaultPerson: 'PRIME-0',
      rooms: [ROOM],
      window: 12,
      maxChars: 6000,
      maxMessageChars: 2000,
    },
  }
  const h: Harness = {
    store,
    statePath,
    createCalls,
    patrows,
    candidates,
    errors,
    mutations: 0,
    dispatch: () =>
      dispatchPanelPending({
        conversation,
        platform,
        syncMirror: (): void => {},
        makeEvent: (name, issue, _attempt, _events, extra): void => {
          patrows.push({ name, issue: issue.id, ...(extra?.note !== undefined ? { note: extra.note } : {}) })
        },
        tickEvents: [],
        errors,
        candidates,
        onMutation: (): void => {
          h.mutations += 1
        },
        people: PEOPLE,
      }),
  }
  return h
}

function appendPanel(h: Harness, text: string): string {
  const record = h.store.appendMessage({ person: 'PRIME-0', room: ROOM, role: 'producer', text, source: 'panel' })
  if (record === undefined) throw new Error('append failed')
  return record.id
}

describe('面板源派单 watcher（C）', () => {
  it('panel 消息→派单一次：建单/轮次锚/PATROL via=panel/candidates/游标推进', async () => {
    const h = harness()
    const stateStore = createRelayStateStore(h.statePath)
    stateStore.updateRelayed('PRIME-0', 7) // 654a 中继游标先存在
    const msgId = appendPanel(h, '面板上的问题')
    expect(await h.dispatch()).toBe(1)
    expect(h.createCalls).toHaveLength(1)
    expect(h.createCalls[0]?.title).toContain('[对话] PRIME-0')
    expect(h.createCalls[0]?.title).toContain('面板上的问题')
    expect(h.createCalls[0]?.assignee).toBe('PRIME-0')
    expect(h.candidates).toHaveLength(1)
    expect(h.mutations).toBe(1)
    expect(h.patrows[0]?.name).toBe('PATROL')
    expect(h.patrows[0]?.note).toContain(`event=panel:${msgId}`)
    expect(h.patrows[0]?.note).toContain('via=panel;')
    expect(h.store.turnByEvent('PRIME-0', `panel:${msgId}`)).toBeDefined()
    // 双游标互不覆盖
    const state = JSON.parse(readFileSync(h.statePath, 'utf8')) as {
      persons: Record<string, { relayedSeq: number; dispatchedSeq: number }>
    }
    expect(state.persons['PRIME-0']).toMatchObject({ relayedSeq: 7, dispatchedSeq: 1 })
  })

  it('重复 tick / 重启恢复不重派；崩溃重派防护（turn 已存在→只推游标）', async () => {
    const h = harness()
    const msgId = appendPanel(h, '只派一次')
    await h.dispatch()
    await h.dispatch()
    expect(h.createCalls).toHaveLength(1)
    // 模拟「建单成功但游标未落盘」崩溃：游标归零、turn 仍在
    createRelayStateStore(h.statePath).updateDispatched('PRIME-0', 0)
    await h.dispatch()
    expect(h.createCalls).toHaveLength(1) // 不重复建单
    expect(createRelayStateStore(h.statePath).dispatchedSeq('PRIME-0')).toBe(1)
    // 重启恢复：新 store/新 watcher 实例 + 同一目录/同一状态文件 → 游标恢复，不重派
    const reopened = harness({ dir: h.store.dir })
    expect(await reopened.dispatch()).toBe(0)
    expect(reopened.createCalls).toHaveLength(0)
    expect(reopened.store.turnByEvent('PRIME-0', `panel:${msgId}`)).toBeDefined()
  })

  it('非 panel 源不派；失败重试不丢（游标不推进）', async () => {
    const h = harness({ failCreateTimes: 1 })
    h.store.appendMessage({ person: 'PRIME-0', room: ROOM, role: 'producer', text: 'matrix 入站', source: 'matrix' })
    appendPanel(h, '面板消息')
    expect(await h.dispatch()).toBe(0) // create 抛错：失败，不推进游标
    expect(h.errors.length).toBe(1)
    expect(createRelayStateStore(h.statePath).dispatchedSeq('PRIME-0')).toBe(0)
    expect(await h.dispatch()).toBe(1) // 下一拍重试成功
    expect(h.createCalls).toHaveLength(2) // 第一次调用也进了 platform.create（抛错）
    expect(createRelayStateStore(h.statePath).dispatchedSeq('PRIME-0')).toBe(2) // seq1=matrix 跳过 + seq2=panel
  })

  it('拍内每工号最多派 1 条；上下文窗口排除本轮', async () => {
    const h = harness()
    const first = h.store.appendMessage({ person: 'PRIME-0', room: ROOM, role: 'person', text: '更早一句', source: 'matrix' })
    expect(first).toBeDefined()
    appendPanel(h, '第一问')
    appendPanel(h, '第二问')
    expect(await h.dispatch()).toBe(1) // 每工号 1 条
    expect(h.createCalls).toHaveLength(1)
    const description = h.createCalls[0]?.description ?? ''
    expect(description).toContain('更早一句')
    expect(description.split('第一问').length - 1).toBe(1) // 本轮只出现一次（窗口已排除）
    expect(await h.dispatch()).toBe(1) // 下一拍第二条
    expect(h.createCalls).toHaveLength(2)
  })

  it('端到端：panel Port 适配器写入 → watcher 派单（同一 JSONL 单源）', async () => {
    const h = harness()
    const adapter = new DaemonPanelConversationStore(h.store, { producerId: 'PRIME-0' })
    const appended = await adapter.appendMessage({
      personId: 'PRIME-0',
      text: '从面板发来的消息',
      source: 'panel',
      from: { kind: 'producer', ref: 'PRIME-0' },
      clientMsgId: 'c-654b-1',
    })
    expect(appended.deduped).toBe(false)
    expect(await h.dispatch()).toBe(1)
    expect(h.createCalls[0]?.title).toContain('从面板发来的消息')
    const view = await adapter.read('PRIME-0')
    expect(view.filter((entry) => entry.kind === 'message')).toHaveLength(1)
  })
})
