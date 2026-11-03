/**
 * conversation 面板端测试（studio-dev-647 · Phase 2）
 *
 * 覆盖：纯函数（工号/请求体/after/历史投影/摘要）、写鉴权 fail-closed、HTTP 端面
 * （页面/列表/历史/发送/clear/SSE）、幂等 409、clear 审计保留、存储未接线 503。
 * 依据：docs/v2/14-§8.1、docs/21-§七、docs/v2/15-§0.2。
 */
import { describe, expect, it } from 'vitest'
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
import {
  authorizeConversationWrite,
  loadConversationWritePolicy,
  parseAfterSeq,
  parseClearConversationBody,
  parseSendMessageBody,
  projectConversationView,
  summarizeConversation,
  isPersonId,
  type ConversationWritePolicy,
} from '../../src/conversation/api.ts'
import { createConversationApp } from '../../src/conversation/server.ts'
import { renderConversationPage } from '../../src/conversation/page.ts'

const TOKEN = 'test-producer-token'
const POLICY = { token: TOKEN, producerId: 'PRIME-0' } as const
const WRITE_HEADERS = { 'content-type': 'application/json', 'x-studio-producer-token': TOKEN }

/** 内存 ConversationStore（只测试语义，不冒充生产存储） */
class MemoryConversationStore implements ConversationStore {
  private readonly rows = new Map<string, ConversationEntry[]>()
  private readonly clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock
  }

  async list(): Promise<readonly ConversationSummary[]> {
    return [...this.rows.keys()].map((personId) => summarizeConversation(personId, this.rows.get(personId) ?? []))
  }

  async read(personId: string): Promise<readonly ConversationEntry[]> {
    return [...(this.rows.get(personId) ?? [])]
  }

  async appendMessage(input: AppendConversationMessageInput): Promise<AppendConversationMessageResult> {
    const rows = this.rows.get(input.personId) ?? []
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
      id: `m-${input.personId}-${String(seq)}`,
      at: input.at ?? this.clock(),
      personId: input.personId,
      from: input.from,
      text: input.text,
      source: input.source,
      ...(input.clientMsgId !== undefined ? { clientMsgId: input.clientMsgId } : {}),
    }
    rows.push(message)
    this.rows.set(input.personId, rows)
    return { message, deduped: false }
  }

  async clear(input: ClearConversationInput): Promise<ConversationClear> {
    const rows = this.rows.get(input.personId) ?? []
    const seq = rows.length === 0 ? 1 : rows[rows.length - 1]!.seq + 1
    const record: ConversationClear = {
      v: CONVERSATION_PROTOCOL_VERSION,
      kind: 'clear' as const,
      seq,
      id: `c-${input.personId}-${String(seq)}`,
      at: input.at ?? this.clock(),
      personId: input.personId,
      by: input.by,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      source: input.source,
    }
    rows.push(record)
    this.rows.set(input.personId, rows)
    return record
  }
}

function makeApp(store: ConversationStore | null = new MemoryConversationStore(), policy: ConversationWritePolicy = POLICY) {
  return createConversationApp({ store, policy, pollIntervalMs: 20 })
}

async function send(app: ReturnType<typeof makeApp>, text: string, clientMsgId?: string, token = TOKEN) {
  return app.request('/api/conversations/PRIME-0/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-producer-token': token },
    body: JSON.stringify({ text, ...(clientMsgId !== undefined ? { clientMsgId } : {}) }),
  })
}

describe('纯函数：工号/请求体/游标', () => {
  it('工号形状：大写开头、连字符分段、2..32', () => {
    for (const ok of ['PRIME-0', 'ENG-10', 'AGENT-1', 'QA-2']) expect(isPersonId(ok)).toBe(true)
    for (const bad of ['prime-0', 'ENG-', '-ENG', 'A', 'X'.repeat(33), 'ENG 10', '']) expect(isPersonId(bad)).toBe(false)
  })

  it('send body：trim、空/超长/坏幂等键/多余键全拒', () => {
    expect(parseSendMessageBody({ text: '  hi  ' })).toEqual({ ok: true, value: { text: 'hi' } })
    expect(parseSendMessageBody({ text: '' })).toEqual({ ok: false, subcause: 'text-empty' })
    expect(parseSendMessageBody({ text: 'x'.repeat(4001) })).toEqual({ ok: false, subcause: 'text-too-long' })
    expect(parseSendMessageBody({ text: 'hi', clientMsgId: 'short' })).toEqual({ ok: false, subcause: 'client-msg-id-invalid' })
    expect(parseSendMessageBody({ text: 'hi', extra: 1 })).toEqual({ ok: false, subcause: 'body-unknown-key' })
    expect(parseSendMessageBody(null)).toEqual({ ok: false, subcause: 'body-not-object' })
  })

  it('clear body：reason 可选；超长/非字符串拒', () => {
    expect(parseClearConversationBody({})).toEqual({ ok: true, value: {} })
    expect(parseClearConversationBody({ reason: '  换话题  ' })).toEqual({ ok: true, value: { reason: '换话题' } })
    expect(parseClearConversationBody({ reason: 1 })).toEqual({ ok: false, subcause: 'reason-not-string' })
    expect(parseClearConversationBody({ reason: 'x'.repeat(201) })).toEqual({ ok: false, subcause: 'reason-too-long' })
  })

  it('after 游标：缺省 undefined；非整数/负数拒', () => {
    expect(parseAfterSeq(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseAfterSeq('12')).toEqual({ ok: true, value: 12 })
    expect(parseAfterSeq('1.5')).toEqual({ ok: false, subcause: 'after-not-integer' })
    expect(parseAfterSeq('-1')).toEqual({ ok: false, subcause: 'after-not-integer' })
  })
})

describe('写鉴权 fail-closed（docs/v2/14-§8.1）', () => {
  it('未配置令牌=503；缺令牌=401；错令牌=403；对令牌=allowed', () => {
    expect(authorizeConversationWrite(undefined, { token: null, producerId: 'PRIME-0' })).toMatchObject({
      ok: false,
      status: 503,
      subcause: 'write-token-not-configured',
    })
    expect(authorizeConversationWrite(undefined, POLICY)).toMatchObject({ ok: false, status: 401 })
    expect(authorizeConversationWrite('wrong', POLICY)).toMatchObject({ ok: false, status: 403 })
    expect(authorizeConversationWrite(TOKEN, POLICY)).toEqual({ ok: true, authority: { kind: 'producer', ref: 'PRIME-0' } })
  })

  it('环境装载：缺 token / 非法工号 → token=null（不回落公开常量）', () => {
    expect(loadConversationWritePolicy({})).toEqual({ token: null, producerId: 'PRIME-0' })
    expect(loadConversationWritePolicy({ STUDIO_PANEL_PRODUCER_TOKEN: '  ' })).toEqual({ token: null, producerId: 'PRIME-0' })
    expect(loadConversationWritePolicy({ STUDIO_PANEL_PRODUCER_TOKEN: TOKEN, STUDIO_PANEL_PRODUCER_ID: 'bad id' })).toEqual({
      token: null,
      producerId: 'PRIME-0',
    })
    expect(loadConversationWritePolicy({ STUDIO_PANEL_PRODUCER_TOKEN: TOKEN, STUDIO_PANEL_PRODUCER_ID: 'PRIME-0' })).toEqual({
      token: TOKEN,
      producerId: 'PRIME-0',
    })
  })
})

describe('历史投影（clear/游标/重置）', () => {
  const rows: ConversationEntry[] = [
    { v: 1, kind: 'message', seq: 1, id: 'a', at: 10, personId: 'PRIME-0', from: { kind: 'producer', ref: 'PRIME-0' }, text: '一', source: 'matrix' },
    { v: 1, kind: 'message', seq: 2, id: 'b', at: 20, personId: 'PRIME-0', from: { kind: 'person', ref: 'PRIME-0' }, text: '二', source: 'matrix' },
    { v: 1, kind: 'clear', seq: 3, id: 'c', at: 30, personId: 'PRIME-0', by: 'PRIME-0', source: 'panel' },
    { v: 1, kind: 'message', seq: 4, id: 'd', at: 40, personId: 'PRIME-0', from: { kind: 'producer', ref: 'PRIME-0' }, text: '三', source: 'panel' },
  ]

  it('只返回最后 clear 之后的消息；version/clearedAt/clearSeq 正确', () => {
    const view = projectConversationView('PRIME-0', rows)
    expect(view.version).toBe(4)
    expect(view.clearSeq).toBe(3)
    expect(view.clearedAt).toBe(30)
    expect(view.messages.map((m) => m.text)).toEqual(['三'])
    expect(view.reset).toBe(false)
  })

  it('after 增量只返回新消息；after 落在 clear 之前 → reset=true 回全量', () => {
    expect(projectConversationView('PRIME-0', rows, 3).messages.map((m) => m.text)).toEqual(['三'])
    expect(projectConversationView('PRIME-0', rows, 2)).toMatchObject({ reset: true })
    expect(projectConversationView('PRIME-0', rows, 2).messages.map((m) => m.text)).toEqual(['三'])
  })

  it('摘要 count 只计有效消息，lastText 截断', () => {
    expect(summarizeConversation('PRIME-0', rows)).toMatchObject({ count: 1, lastAt: 40, lastText: '三', clearedAt: 30 })
  })
})

describe('HTTP 端面', () => {
  it('页面含列表/输入/clear/轮询配置；存储未接线时渲染降级横幅', async () => {
    const html = renderConversationPage({ pollIntervalMs: 2000, storeWired: false, writeConfigured: false, producerId: 'PRIME-0' })
    for (const marker of ['会话（工号）', '<textarea', 'clear', '发送', 'setInterval', 'PRIME-0']) expect(html).toContain(marker)
    const app = makeApp(null)
    const res = await app.request('/conversation')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('存储未接线')
  })

  it('存储未接线：读/写均 503（不返回空列表冒充无会话）', async () => {
    const app = makeApp(null)
    const list = await app.request('/api/conversations')
    expect(list.status).toBe(503)
    const body = (await list.json()) as { error: { subcause: string } }
    expect(body.error.subcause).toBe('conversation-store-unavailable')
    const write = await send(app, 'hi')
    expect(write.status).toBe(503)
  })

  it('读面非环回来源 403（x-sn-client-key；fail-closed）', async () => {
    const app = makeApp()
    const res = await app.request('/api/conversations', { headers: { 'x-sn-client-key': '198.51.100.7' } })
    expect(res.status).toBe(403)
    const ok = await app.request('/api/conversations', { headers: { 'x-sn-client-key': '127.0.0.1' } })
    expect(ok.status).toBe(200)
  })

  it('写面鉴权：缺令牌 401、错令牌 403、未配置 503，且存储零变化', async () => {
    const store = new MemoryConversationStore()
    const app = makeApp(store)
    const missing = await app.request('/api/conversations/PRIME-0/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(missing.status).toBe(401)
    const wrong = await send(app, 'hi', 'abcdefgh', 'wrong')
    expect(wrong.status).toBe(403)
    expect((await store.read('PRIME-0')).length).toBe(0)
    const noPolicy = makeApp(store, { token: null, producerId: 'PRIME-0' })
    expect((await send(noPolicy, 'hi')).status).toBe(503)
  })

  it('写面要求 application/json（CSRF 前置）；坏 JSON/坏工号/坏体 400', async () => {
    const app = makeApp()
    const textPlain = await app.request('/api/conversations/PRIME-0/messages', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-studio-producer-token': TOKEN },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(textPlain.status).toBe(400)
    const badJson = await app.request('/api/conversations/PRIME-0/messages', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: '{',
    })
    expect(badJson.status).toBe(400)
    const badId = await app.request('/api/conversations/lower-0/messages', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(badId.status).toBe(400)
    const badBody = await send(app, '   ')
    expect(badBody.status).toBe(400)
  })

  it('发送→列表/历史可见；幂等同键同内容 200 deduped，异内容 409', async () => {
    const app = makeApp()
    const first = await send(app, '你好', 'client-0001')
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { message: { seq: number; text: string } }
    expect(firstBody.message).toMatchObject({ seq: 1, text: '你好' })
    const again = await send(app, '你好', 'client-0001')
    expect(again.status).toBe(200)
    expect((await again.json()) as { deduped: boolean }).toMatchObject({ deduped: true })
    const conflict = await send(app, '改内容', 'client-0001')
    expect(conflict.status).toBe(409)

    const list = (await (await app.request('/api/conversations')).json()) as {
      conversations: Array<{ personId: string; count: number }>
    }
    expect(list.conversations).toEqual([expect.objectContaining({ personId: 'PRIME-0', count: 1 })])
    const history = (await (await app.request('/api/conversations/PRIME-0')).json()) as {
      view: { messages: Array<{ text: string }>; version: number }
    }
    expect(history.view.version).toBe(1)
    expect(history.view.messages.map((m) => m.text)).toEqual(['你好'])
  })

  it('clear：历史清空但审计行保留；after 落在 clear 前 → reset', async () => {
    const store = new MemoryConversationStore()
    const app = makeApp(store)
    await send(app, '旧消息', 'client-0002')
    const cleared = await app.request('/api/conversations/PRIME-0/clear', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ reason: '换话题' }),
    })
    expect(cleared.status).toBe(201)
    const raw = await store.read('PRIME-0')
    expect(raw.map((entry) => entry.kind)).toEqual(['message', 'clear'])
    expect(raw[1]).toMatchObject({ by: 'PRIME-0', reason: '换话题', source: 'panel' })
    const history = (await (await app.request('/api/conversations/PRIME-0')).json()) as {
      view: { messages: unknown[]; clearedAt: number | null; clearSeq: number }
    }
    expect(history.view.messages).toEqual([])
    expect(history.view.clearedAt).not.toBeNull()
    expect(history.view.clearSeq).toBe(2)
    const stale = (await (await app.request('/api/conversations/PRIME-0?after=1')).json()) as {
      view: { reset: boolean; messages: unknown[] }
    }
    expect(stale.view).toMatchObject({ reset: true, messages: [] })
  })

  it('SSE：连接即 ready；已有消息在一个轮询周期内送达；断开干净停止', async () => {
    const store = new MemoryConversationStore()
    await store.appendMessage({ personId: 'PRIME-0', text: '已有', source: 'matrix', from: { kind: 'person', ref: 'PRIME-0' } })
    const app = makeApp(store)
    const res = await app.request('/api/conversations/PRIME-0/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = res.body
    expect(body).not.toBeNull()
    if (body === null) return
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    const deadline = Date.now() + 3000
    try {
      while (Date.now() < deadline && !acc.includes('"text":"已有"')) {
        const chunk = await reader.read()
        if (chunk.done) break
        acc += decoder.decode(chunk.value, { stream: true })
      }
    } finally {
      await reader.cancel()
    }
    expect(acc).toContain('event: ready')
    expect(acc).toContain('event: conversation')
    expect(acc).toContain('"text":"已有"')
  })
})
