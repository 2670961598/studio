/**
 * conversation/server —— 面板对话页的 Hono 路由层（studio-dev-647 · Phase 2）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14-§8.1：端面表（GET /conversation、/api/conversations…、POST messages/clear、
 *     SSE stream）、写鉴权 fail-closed、唯一错误体、409 幂等冲突、503 存储未接线；
 *   - docs/21-§7.2：双端同步（seq 游标/clear 重置/有界拉取）；
 *   - docs/v2/15-§0.2：读面缺省拒、拒绝不以空集冒充「没有」。
 *
 * 边界：本件不落盘、不直连库——`ConversationStore` 由装配侧注入；store=null 时全 API
 * 503 `conversation-store-unavailable`（页面降级横幅），**不返回空列表冒充无会话**。
 */
import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  DEFAULT_CONVERSATION_POLL_MS,
  MAX_BODY_BYTES,
  ConversationConflictError,
  type ConversationStore,
  type ConversationView,
} from './types.ts'
import {
  PRODUCER_TOKEN_HEADER,
  authorizeConversationWrite,
  compareConversationSummaries,
  isPersonId,
  parseAfterSeq,
  parseClearConversationBody,
  parseSendMessageBody,
  projectConversationView,
  type ConversationWritePolicy,
} from './api.ts'
import { renderConversationPage } from './page.ts'

/** createConversationApp 选项 */
export interface ConversationAppOptions {
  /** 会话存储 Port（Phase 1 注入）；null=未接线（读/写统一 503，页面降级） */
  readonly store: ConversationStore | null
  /** 写策略（token/producerId；缺省由装配侧 loadConversationWritePolicy 生成） */
  readonly policy: ConversationWritePolicy
  /** SSE/页面轮询间隔（缺省 2000ms；非正数落回缺省） */
  readonly pollIntervalMs?: number
}

type FailStatus = 400 | 401 | 403 | 409 | 413 | 503

/** 唯一错误体（docs/v2/14-§四：{error:{failure,category,subcause},traceId}） */
function fail(c: Context, status: FailStatus, failure: string, subcause: string): Response {
  return c.json({ error: { failure, category: 'conversation', subcause }, traceId: randomUUID() }, status)
}

/** 环回地址判定（node:http 的 socket.remoteAddress 形态：IPv4/IPv6/IPv4-mapped） */
function isLoopbackAddress(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

/**
 * 仅环回/本机来源（docs/v2/14-§8.1「环回读」）。
 * `x-sn-client-key` 由监听壳 toWebRequest 用 socket.remoteAddress 覆写注入（外部不可伪造）；
 * 携带 `x-forwarded-for` 说明前面有未知代理，按不可信处理（fail-closed）。
 */
function isLoopbackContext(c: Context): boolean {
  if ((c.req.header('x-forwarded-for') ?? '') !== '') return false
  const clientKey = c.req.header('x-sn-client-key')
  return clientKey === undefined || clientKey === '' || isLoopbackAddress(clientKey)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 解析 JSON 请求体（content-type 必须是 application/json——CSRF 前置） */
async function readJsonBody(c: Context): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType !== 'application/json') {
    return { ok: false, response: fail(c, 400, 'rejected_invalid', 'content-type-not-json') }
  }
  const declared = Number.parseInt(c.req.header('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: fail(c, 413, 'rejected_invalid', 'body-too-large') }
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: fail(c, 413, 'rejected_invalid', 'body-too-large') }
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, response: fail(c, 400, 'rejected_invalid', 'body-not-json') }
  }
}

/** 会话存储未接线/读失败统一 503（不回空集、不落盘代偿） */
function storeUnavailable(c: Context, subcause: string): Response {
  return fail(c, 503, 'rejected_unavailable', subcause)
}

/**
 * 会话子应用（满路径挂载：`app.route('/', createConversationApp(…))`）。
 * 路由顺序：页面 → 列表 → 历史 → SSE → 写面（写面最后，鉴权失败不触达存储）。
 */
export function createConversationApp(opts: ConversationAppOptions): Hono {
  const pollMs =
    opts.pollIntervalMs !== undefined && Number.isInteger(opts.pollIntervalMs) && opts.pollIntervalMs > 0
      ? opts.pollIntervalMs
      : DEFAULT_CONVERSATION_POLL_MS

  const app = new Hono()

  // 页面：store 未接线也渲染（显示降级横幅），不让页面 404/白屏
  app.get('/conversation', (c) =>
    c.html(
      renderConversationPage({
        pollIntervalMs: pollMs,
        storeWired: opts.store !== null,
        writeConfigured: opts.policy.token !== null,
        producerId: opts.policy.producerId,
      }),
    ),
  )

  // 会话列表（读面：环回开放；排序最近活跃优先）
  app.get('/api/conversations', async (c) => {
    if (!isLoopbackContext(c)) return fail(c, 403, 'rejected_forbidden', 'non-loopback-source')
    const store = opts.store
    if (store === null) return storeUnavailable(c, 'conversation-store-unavailable')
    try {
      const list = [...(await store.list())].sort(compareConversationSummaries)
      return c.json({ ok: true, conversations: list })
    } catch (err) {
      console.warn(`[panel/conversation] list failed: ${errText(err)}`)
      return storeUnavailable(c, 'conversation-store-read-failed')
    }
  })

  // 历史投影：after 游标增量；reset=true 时回全量有效历史并令前端整屏重置
  app.get('/api/conversations/:personId', async (c) => {
    if (!isLoopbackContext(c)) return fail(c, 403, 'rejected_forbidden', 'non-loopback-source')
    const personId = c.req.param('personId')
    if (!isPersonId(personId)) return fail(c, 400, 'rejected_invalid', 'person-id-invalid')
    const after = parseAfterSeq(c.req.query('after'))
    if (!after.ok) return fail(c, 400, 'rejected_invalid', after.subcause)
    const store = opts.store
    if (store === null) return storeUnavailable(c, 'conversation-store-unavailable')
    try {
      const entries = await store.read(personId)
      return c.json({ ok: true, view: projectConversationView(personId, entries, after.value) })
    } catch (err) {
      console.warn(`[panel/conversation] read failed: ${errText(err)}`)
      return storeUnavailable(c, 'conversation-store-read-failed')
    }
  })

  // SSE 增量：轮询存储（与页面拉取同源；断开经 onAbort 干净停止）
  app.get('/api/conversations/:personId/stream', (c) => {
    if (!isLoopbackContext(c)) return fail(c, 403, 'rejected_forbidden', 'non-loopback-source')
    const personId = c.req.param('personId')
    if (!isPersonId(personId)) return fail(c, 400, 'rejected_invalid', 'person-id-invalid')
    const after = parseAfterSeq(c.req.query('after'))
    if (!after.ok) return fail(c, 400, 'rejected_invalid', after.subcause)
    const store = opts.store
    if (store === null) return storeUnavailable(c, 'conversation-store-unavailable')
    return streamSSE(c, async (stream) => {
      let cursor = after.value ?? 0
      let aborted = false
      stream.onAbort(() => {
        aborted = true
      })
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ personId, after: cursor }),
        retry: 5000,
      })
      while (!aborted) {
        try {
          const entries = await store.read(personId)
          const view: ConversationView = projectConversationView(personId, entries, cursor)
          if (view.reset || view.messages.length > 0) {
            await stream.writeSSE({ event: 'conversation', data: JSON.stringify(view) })
            cursor = view.version
          }
        } catch {
          break // 读面异常：停轮询即净停（监控流不抢救；与 /api/events/stream 同款）
        }
        await stream.sleep(pollMs)
      }
    })
  })

  // 追加消息（写面：制作人凭据；幂等键=同工号内 clientMsgId）
  app.post('/api/conversations/:personId/messages', async (c) => {
    const personId = c.req.param('personId')
    if (!isPersonId(personId)) return fail(c, 400, 'rejected_invalid', 'person-id-invalid')
    const auth = authorizeConversationWrite(c.req.header(PRODUCER_TOKEN_HEADER), opts.policy)
    if (!auth.ok) return fail(c, auth.status, auth.failure, auth.subcause)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = parseSendMessageBody(body.value)
    if (!parsed.ok) return fail(c, 400, 'rejected_invalid', parsed.subcause)
    const store = opts.store
    if (store === null) return storeUnavailable(c, 'conversation-store-unavailable')
    try {
      const result = await store.appendMessage({
        personId,
        text: parsed.value.text,
        source: 'panel',
        from: { kind: 'producer', ref: auth.authority.ref },
        ...(parsed.value.clientMsgId !== undefined ? { clientMsgId: parsed.value.clientMsgId } : {}),
      })
      return c.json({ ok: true, message: result.message, deduped: result.deduped }, result.deduped ? 200 : 201)
    } catch (err) {
      if (err instanceof ConversationConflictError) {
        return fail(c, 409, 'rejected_idempotency', 'client-msg-id-conflict')
      }
      console.warn(`[panel/conversation] append failed: ${errText(err)}`)
      return storeUnavailable(c, 'conversation-store-write-failed')
    }
  })

  // clear：只追加审计记录，不物理删除（docs/21-§7.1）
  app.post('/api/conversations/:personId/clear', async (c) => {
    const personId = c.req.param('personId')
    if (!isPersonId(personId)) return fail(c, 400, 'rejected_invalid', 'person-id-invalid')
    const auth = authorizeConversationWrite(c.req.header(PRODUCER_TOKEN_HEADER), opts.policy)
    if (!auth.ok) return fail(c, auth.status, auth.failure, auth.subcause)
    const body = await readJsonBody(c)
    if (!body.ok) return body.response
    const parsed = parseClearConversationBody(body.value)
    if (!parsed.ok) return fail(c, 400, 'rejected_invalid', parsed.subcause)
    const store = opts.store
    if (store === null) return storeUnavailable(c, 'conversation-store-unavailable')
    try {
      const record = await store.clear({
        personId,
        by: auth.authority.ref,
        source: 'panel',
        ...(parsed.value.reason !== undefined ? { reason: parsed.value.reason } : {}),
      })
      return c.json({ ok: true, clear: record }, 201)
    } catch (err) {
      console.warn(`[panel/conversation] clear failed: ${errText(err)}`)
      return storeUnavailable(c, 'conversation-store-write-failed')
    }
  })

  return app
}
