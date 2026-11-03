/**
 * conversation-sync —— 双端同步 spike（studio-dev-647 · Phase 2；D 条三闸第一闸）
 *
 * 目的：在不依赖 Matrix/daemon 的前提下，用**同一 JSONL 文件＋两个独立 store 实例**
 * （matrix 端 / panel 端）验证 docs/21-§7.2 的五条契约：
 *   ① Matrix 发 → panel 见（同 seq）；② panel 发 → Matrix 见（同 seq、无重复）；
 *   ③ clear 双端一致；④ 幂等同键不产生新行；⑤ 坏行隔离不阻塞后续读。
 *
 * 边界：本文件的 FileConversationStore 是**测试替身**（spike），不是生产存储实现；
 * 生产存储归 Phase 1（#646），面板只依赖 ConversationStore Port。
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CONVERSATION_PROTOCOL_VERSION,
  ConversationConflictError,
  type AppendConversationMessageInput,
  type AppendConversationMessageResult,
  type ClearConversationInput,
  type ConversationClear,
  type ConversationEntry,
  type ConversationMessage,
  type ConversationStore,
  type ConversationSummary,
} from '../../src/conversation/types.ts'
import { summarizeConversation } from '../../src/conversation/api.ts'
import { createConversationApp } from '../../src/conversation/server.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'studio-next-conversation-sync-'))
const TOKEN = 'sync-producer-token'
const POLICY = { token: TOKEN, producerId: 'PRIME-0' } as const

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

/** 测试替身：append-only JSONL（一个工号一份；与 docs/21-§7.1 同形） */
class FileConversationStore implements ConversationStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  private fileOf(personId: string): string {
    return path.join(this.dir, `${personId}.jsonl`)
  }

  async list(): Promise<readonly ConversationSummary[]> {
    mkdirSync(this.dir, { recursive: true })
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .map((personId) => summarizeConversation(personId, this.readSync(personId)))
  }

  async read(personId: string): Promise<readonly ConversationEntry[]> {
    return this.readSync(personId)
  }

  private readSync(personId: string): ConversationEntry[] {
    let raw = ''
    try {
      raw = readFileSync(this.fileOf(personId), 'utf8')
    } catch {
      return []
    }
    const entries: ConversationEntry[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        const parsed = JSON.parse(line) as ConversationEntry
        if (parsed.v === CONVERSATION_PROTOCOL_VERSION && (parsed.kind === 'message' || parsed.kind === 'clear')) {
          entries.push(parsed)
        }
      } catch {
        // 坏行隔离：单行损坏不阻塞后续读（docs/21-§7.1）
      }
    }
    return entries.sort((a, b) => a.seq - b.seq)
  }

  private append(personId: string, entry: ConversationEntry): void {
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(this.fileOf(personId), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' })
  }

  async appendMessage(input: AppendConversationMessageInput): Promise<AppendConversationMessageResult> {
    const rows = this.readSync(input.personId)
    if (input.clientMsgId !== undefined) {
      const existing = rows.find(
        (entry): entry is Extract<ConversationEntry, { kind: 'message' }> =>
          entry.kind === 'message' && entry.clientMsgId === input.clientMsgId,
      )
      if (existing !== undefined) {
        if (existing.text !== input.text) throw new ConversationConflictError('clientMsgId conflict')
        return { message: existing, deduped: true }
      }
    }
    const seq = rows.length === 0 ? 1 : rows[rows.length - 1]!.seq + 1
    const message: ConversationMessage = {
      v: CONVERSATION_PROTOCOL_VERSION,
      kind: 'message' as const,
      seq,
      id: `${input.source}-${String(seq)}-${String(Date.now())}`,
      at: input.at ?? Date.now(),
      personId: input.personId,
      from: input.from,
      text: input.text,
      source: input.source,
      ...(input.clientMsgId !== undefined ? { clientMsgId: input.clientMsgId } : {}),
    }
    this.append(input.personId, message)
    return { message, deduped: false }
  }

  async clear(input: ClearConversationInput): Promise<ConversationClear> {
    const rows = this.readSync(input.personId)
    const seq = rows.length === 0 ? 1 : rows[rows.length - 1]!.seq + 1
    const record: ConversationClear = {
      v: CONVERSATION_PROTOCOL_VERSION,
      kind: 'clear' as const,
      seq,
      id: `clear-${String(seq)}-${String(Date.now())}`,
      at: input.at ?? Date.now(),
      personId: input.personId,
      by: input.by,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      source: input.source,
    }
    this.append(input.personId, record)
    return record
  }
}

describe('双端同步 spike（同一 JSONL，两个 store 实例）', () => {
  it('Matrix 发 → 面板见；面板发 → Matrix 见；seq 连续且无重复', async () => {
    const matrix = new FileConversationStore(ROOT)
    const panel = new FileConversationStore(ROOT)
    const app = createConversationApp({ store: panel, policy: POLICY, pollIntervalMs: 20 })

    const first = await matrix.appendMessage({
      personId: 'PRIME-0',
      text: '制作人在 Matrix 说：在吗',
      source: 'matrix',
      from: { kind: 'producer', ref: 'PRIME-0' },
    })
    expect(first.message.seq).toBe(1)

    const panelSees = (await (await app.request('/api/conversations/PRIME-0')).json()) as {
      view: { version: number; messages: Array<{ seq: number; text: string; source: string }> }
    }
    expect(panelSees.view.version).toBe(1)
    expect(panelSees.view.messages).toEqual([
      expect.objectContaining({ seq: 1, text: '制作人在 Matrix 说：在吗', source: 'matrix' }),
    ])

    const reply = await app.request('/api/conversations/PRIME-0/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-producer-token': TOKEN },
      body: JSON.stringify({ text: '面板端回：在', clientMsgId: 'sync-client-0001' }),
    })
    expect(reply.status).toBe(201)
    const matrixSees = await matrix.read('PRIME-0')
    expect(matrixSees.map((entry) => entry.seq)).toEqual([1, 2])
    expect(matrixSees[1]).toMatchObject({ kind: 'message', text: '面板端回：在', source: 'panel', seq: 2 })

    // 幂等：同键同内容再提交不产生第 3 行
    const deduped = await app.request('/api/conversations/PRIME-0/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-producer-token': TOKEN },
      body: JSON.stringify({ text: '面板端回：在', clientMsgId: 'sync-client-0001' }),
    })
    expect(deduped.status).toBe(200)
    expect((await matrix.read('PRIME-0')).length).toBe(2)
  })

  it('clear 双端一致：审计行保留，面板历史清空，Matrix 端读到 clear', async () => {
    const matrix = new FileConversationStore(ROOT)
    const panel = new FileConversationStore(ROOT)
    const app = createConversationApp({ store: panel, policy: POLICY, pollIntervalMs: 20 })

    const cleared = await app.request('/api/conversations/PRIME-0/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-producer-token': TOKEN },
      body: JSON.stringify({ reason: 'sync-spike' }),
    })
    expect(cleared.status).toBe(201)

    const matrixRows = await matrix.read('PRIME-0')
    expect(matrixRows.map((entry) => entry.kind)).toEqual(['message', 'message', 'clear'])
    expect(matrixRows[2]).toMatchObject({ kind: 'clear', by: 'PRIME-0', reason: 'sync-spike' })

    const panelView = (await (await app.request('/api/conversations/PRIME-0')).json()) as {
      view: { messages: unknown[]; clearedAt: number | null; clearSeq: number; reset: boolean }
    }
    expect(panelView.view.messages).toEqual([])
    expect(panelView.view.clearSeq).toBe(3)
    expect(panelView.view.clearedAt).not.toBeNull()
    expect(panelView.view.reset).toBe(false)

    // 旧游标（clear 前）再拉：reset=true，强制前端整屏重置
    const stale = (await (await app.request('/api/conversations/PRIME-0?after=2')).json()) as {
      view: { reset: boolean; messages: unknown[] }
    }
    expect(stale.view).toMatchObject({ reset: true, messages: [] })
  })

  it('坏行隔离：损坏行不阻塞后续合法行读取', async () => {
    const store = new FileConversationStore(path.join(ROOT, 'corrupt'))
    mkdirSync(path.join(ROOT, 'corrupt'), { recursive: true })
    writeFileSync(path.join(ROOT, 'corrupt', 'ENG-10.jsonl'), '{"broken":\n', 'utf8')
    const appended = await store.appendMessage({
      personId: 'ENG-10',
      text: '好行',
      source: 'matrix',
      from: { kind: 'person', ref: 'ENG-10' },
    })
    // 坏行不含 seq，合法行 seq=1（坏行隔离不参与排序）
    expect(appended.message.seq).toBe(1)
    const rows = await store.read('ENG-10')
    expect(rows.map((entry) => entry.kind)).toEqual(['message'])
  })
})
