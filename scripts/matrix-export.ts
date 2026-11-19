/**
 * matrix-export —— M4 聊天自研切换·Matrix 历史只读导出器（task-137）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M4（Matrix→chatd 历史迁移：
 *     双跑 0 漏/0 重复）、§四.2（数据迁移：actor=MXID→工号映射；只迁语义不迁拓扑；
 *     附件/加密显式 UNSUPPORTED）、§四.3（切 Matrix 只读保留）
 *   - packages/workbench-transport/src/types.ts（Transport v1——下游 chatd 形态，本件不依赖）
 *
 * 链路：password 登录（POST /_matrix/client/v3/login，唯一非 GET——无业务写入）→
 *   GET /joined_rooms → 每房 dir=b limit=100 逆序分页 /messages（from=next_token 直到无）→
 *   事件取 m.room.message（event_id/type/ts/sender/body/mentions/msgtype）＋房元尽力
 *   （name/topic 走 /state/m.room.name|m.room.topic，成员走 /members；失败=null 不伪造）。
 *
 * 边界（铁律）：**严格只读 Matrix**（数据面零写入；登录会话收尾尽力 /logout 自清）；
 *   单请求 30s 超时（AbortSignal.timeout）；429/5xx/网络错指数退避（base 500ms ×2^n 封顶
 *   15s，尊重 Retry-After 头与 M_LIMIT_EXCEEDED 的 retry_after_ms 体，≤5 次）；401 静默重登一次；
 *   **token/密码永不落日志/manifest/导出**（错误信息不含凭据）。产物只落 /tmp（快照含业务
 *   数据不入仓）；host 路径不入仓（homeserver/输出路径全部 env/参数传入）。
 *
 * E2EE 口径：m.room.encrypted 事件**不导出密文**（body=null 登记 type），下游迁移器登记
 *   skipped-encrypted（runbook 不可迁项）；密文导出既无用又扩大敏感面。
 *
 * 用法：MATRIX_HOMESERVER=… MATRIX_BOT_USER=@bot:server MATRIX_BOT_PASSWORD=… \
 *        node scripts/matrix-export.ts [--homeserver <url>] [--user <mxid>] \
 *          [--out /tmp/matrix-export-<date>.json] [--manifest <path>] [--max-pages <n>]
 *   密码只收 env MATRIX_BOT_PASSWORD（不收 flag——argv 会进 ps，不落凭据）。
 * 退出码：0=导出成功；1=导出失败（网络/协议/权限）；2=用法错误。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError } from './workbench-issues-migrate.ts'

export const EXPORT_SCHEMA = 'matrix-export/v1'
export const MANIFEST_SCHEMA = 'matrix-export-manifest/v1'
export const PAGE_LIMIT = 100
export const REQUEST_TIMEOUT_MS = 30_000
export const MAX_RETRIES = 5
export const BASE_BACKOFF_MS = 500
export const MAX_BACKOFF_MS = 15_000
/** 每房分页安全上限（防服务端 token 环：100/页 × 10000 页 = 百万事件封顶） */
export const DEFAULT_MAX_PAGES = 10_000

export class ExportError extends Error {}

/* ------------------------------------------------------------------ */
/* 导出类型（matrix-export/v1——迁移器/对账器共同消费的唯一形状）         */
/* ------------------------------------------------------------------ */

export interface ExportedMessage {
  readonly eventId: string
  readonly type: string
  readonly ts: number
  readonly sender: string
  /** m.room.encrypted 恒 null（不导密文）；m.room.message 缺 body=null 如实 */
  readonly body: string | null
  readonly msgtype: string | null
  readonly mentions: readonly string[]
}

export interface ExportedRoom {
  readonly roomId: string
  readonly name: string | null
  readonly topic: string | null
  readonly canonicalAlias: string | null
  /** 尽力而为（/members 失败=null）；仅作 chatd 房成员基数，非拓扑真相 */
  readonly members: readonly string[] | null
  /** 升序（ts，平局 eventId）——迁移发送序与对账口径唯一源 */
  readonly messages: readonly ExportedMessage[]
}

export interface MatrixExport {
  readonly schema: typeof EXPORT_SCHEMA
  readonly exportedAt: number
  readonly homeserver: string
  readonly rooms: readonly ExportedRoom[]
}

export interface ExportManifest {
  readonly schema: typeof MANIFEST_SCHEMA
  readonly exportedAt: number
  readonly homeserver: string
  readonly roomCount: number
  readonly messageCount: number
  readonly perRoomCounts: Readonly<Record<string, number>>
  readonly nonMessageEvents: number
  readonly encryptedEvents: number
  readonly timeRange: { readonly minTs: number | null; readonly maxTs: number | null }
  /** 导出文件字节级 sha256（先写盘后哈希，对账方重算即验完整性） */
  readonly exportSha256: string
  readonly pagination: { readonly limit: number; readonly pages: number; readonly maxPages: number }
  readonly http: { readonly gets: number; readonly posts: number; readonly retries: number; readonly relogins: number; readonly timeoutMs: number }
}

/* ------------------------------------------------------------------ */
/* 导出文件解析（防御：坏形状=UsageError fail-closed，供迁移/对账复用）  */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${where}：应为对象`)
  return value as Record<string, unknown>
}
function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new UsageError(`${where}：应为字符串`)
  return value
}
function asOptString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function asOptNumber(value: unknown, where: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UsageError(`${where}：应为有限数字`)
  return value
}
function asStringArray(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) throw new UsageError(`${where}：应为字符串数组`)
  return value as readonly string[]
}

export function parseMatrixExport(raw: unknown): MatrixExport {
  const r = asRecord(raw, 'export')
  const schema = asString(r['schema'], 'export.schema')
  if (schema !== EXPORT_SCHEMA) throw new UsageError(`export.schema：期望 ${EXPORT_SCHEMA}，实为 ${schema}`)
  const rooms = asRecord(r['rooms'], 'export.rooms')
  const parsedRooms: ExportedRoom[] = []
  for (const [roomId, roomRaw] of Object.entries(rooms)) {
    const room = asRecord(roomRaw, `export.rooms[${roomId}]`)
    const messages = Array.isArray(room['messages']) ? (room['messages'] as unknown[]) : []
    parsedRooms.push({
      roomId,
      name: asOptString(room['name']),
      topic: asOptString(room['topic']),
      canonicalAlias: asOptString(room['canonicalAlias']),
      members: room['members'] === null || room['members'] === undefined ? null : asStringArray(room['members'], `export.rooms[${roomId}].members`),
      messages: messages.map((m, i) => {
        const msg = asRecord(m, `export.rooms[${roomId}].messages[${i}]`)
        return {
          eventId: asString(msg['eventId'], `export.rooms[${roomId}].messages[${i}].eventId`),
          type: asString(msg['type'], `export.rooms[${roomId}].messages[${i}].type`),
          ts: asNumberStrict(msg['ts'], `export.rooms[${roomId}].messages[${i}].ts`),
          sender: asString(msg['sender'], `export.rooms[${roomId}].messages[${i}].sender`),
          body: msg['body'] === null || msg['body'] === undefined ? null : asString(msg['body'], `export.rooms[${roomId}].messages[${i}].body`),
          msgtype: asOptString(msg['msgtype']),
          mentions: msg['mentions'] === null || msg['mentions'] === undefined ? [] : asStringArray(msg['mentions'], `export.rooms[${roomId}].messages[${i}].mentions`),
        }
      }),
    })
  }
  return {
    schema,
    exportedAt: asNumberStrict(r['exportedAt'], 'export.exportedAt'),
    homeserver: asString(r['homeserver'], 'export.homeserver'),
    rooms: parsedRooms,
  }
}

function asNumberStrict(value: unknown, where: string): number {
  const n = asOptNumber(value, where)
  if (n === null) throw new UsageError(`${where}：缺失`)
  return n
}

export function loadMatrixExport(filePath: string): MatrixExport {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (cause) {
    throw new UsageError(`导出文件不可读：${filePath}（${String(cause)}）`)
  }
  try {
    return parseMatrixExport(JSON.parse(text))
  } catch (cause) {
    if (cause instanceof UsageError) throw new UsageError(`${filePath}: ${cause.message}`)
    throw new UsageError(`${filePath}: JSON 解析失败（${String(cause)}）`)
  }
}

/** 序列化形状（rooms 用 map 形：roomId 键——人读友好且与 parseMatrixExport 对偶） */
export function serializeMatrixExport(exported: MatrixExport): string {
  const rooms: Record<string, unknown> = {}
  for (const room of exported.rooms) rooms[room.roomId] = room
  return `${JSON.stringify({ ...exported, rooms }, null, 2)}\n`
}

export function sha256FileBytes(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

export function buildManifest(exported: MatrixExport, exportFileText: string, pages: number, maxPages: number, http: { gets: number; posts: number; retries: number; relogins: number }, nonMessageEvents = 0): ExportManifest {
  const messageCount = exported.rooms.reduce((sum, room) => sum + room.messages.length, 0)
  const perRoomCounts: Record<string, number> = {}
  let minTs: number | null = null
  let maxTs: number | null = null
  let encrypted = 0
  for (const room of exported.rooms) {
    perRoomCounts[room.roomId] = room.messages.length
    for (const m of room.messages) {
      if (m.type === 'm.room.encrypted') encrypted += 1
      if (minTs === null || m.ts < minTs) minTs = m.ts
      if (maxTs === null || m.ts > maxTs) maxTs = m.ts
    }
  }
  return {
    schema: MANIFEST_SCHEMA,
    exportedAt: exported.exportedAt,
    homeserver: exported.homeserver,
    roomCount: exported.rooms.length,
    messageCount,
    perRoomCounts,
    nonMessageEvents, // 导出侧证据：分页中跳过的非消息事件计数（parse 路径不重建，不伪造）
    encryptedEvents: encrypted,
    timeRange: { minTs, maxTs },
    exportSha256: sha256FileBytes(exportFileText),
    pagination: { limit: PAGE_LIMIT, pages, maxPages },
    http: { ...http, timeoutMs: REQUEST_TIMEOUT_MS },
  }
}

/* ------------------------------------------------------------------ */
/* HTTP（零依赖全局 fetch；只打印路径与状态，不打印头/体/token）          */
/* ------------------------------------------------------------------ */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

interface HttpStats { gets: number; posts: number; retries: number; relogins: number }

class MatrixHttp {
  private readonly baseUrl: string
  private readonly userId: string
  private readonly password: string
  private token: string | null = null
  readonly stats: HttpStats = { gets: 0, posts: 0, retries: 0, relogins: 0 }

  constructor(baseUrl: string, userId: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.userId = userId
    this.password = password
  }

  private url(apiPath: string, query: Record<string, string>): string {
    const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `${this.baseUrl}/_matrix/client/v3${apiPath}${qs === '' ? '' : `?${qs}`}`
  }

  /** 退避延迟：优先 429 体 retry_after_ms / Retry-After 头；缺省指数（500ms×2^n 封顶 15s） */
  private async backoffDelay(attempt: number, res: Response | null, body: unknown): Promise<number> {
    const headerRaw = res?.headers.get('retry-after') ?? null
    if (headerRaw !== null && /^\d+(\.\d+)?$/.test(headerRaw.trim())) return Math.min(MAX_BACKOFF_MS, Math.max(0, Number(headerRaw) * 1000))
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      const ms = (body as Record<string, unknown>)['retry_after_ms']
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) return Math.min(MAX_BACKOFF_MS, ms)
    }
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
  }

  /** 登录换 access_token（唯一 POST；失败信息不含凭据；token 不出本类） */
  private async login(): Promise<void> {
    const url = this.url('/login', {})
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user: this.userId }, password: this.password }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        this.stats.posts++
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`login 网络失败（重试 ${String(MAX_RETRIES)} 次后）：${errText(err)}`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, null, null))
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`login HTTP ${String(res.status)}（重试 ${String(MAX_RETRIES)} 次后仍失败）`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, res, await res.json().catch(() => null)))
        continue
      }
      if (!res.ok) throw new ExportError(`login HTTP ${String(res.status)}（凭据不回显；检查 MATRIX_BOT_USER/MATRIX_BOT_PASSWORD）`)
      const body = asObj(await res.json().catch(() => null))
      const token = typeof body['access_token'] === 'string' ? body['access_token'] : ''
      if (token === '') throw new ExportError('login 响应缺 access_token')
      this.token = token
      return
    }
  }

  /** 数据面 GET：429/5xx/网络错/超时退避重试 ≤MAX_RETRIES；401 重登一次 */
  async get(apiPath: string, query: Record<string, string>): Promise<unknown> {
    let relogined = false
    for (let attempt = 0; ; attempt++) {
      if (this.token === null) await this.login()
      const url = this.url(apiPath, query)
      let res: Response
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${this.token ?? ''}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        this.stats.gets++
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`GET ${apiPath} 网络失败（已重试 ${String(attempt)} 次）：${errText(err)}`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, null, null))
        continue
      }
      if (res.status === 401) {
        if (relogined) throw new ExportError(`GET ${apiPath} 重登后仍 401（token 失效/权限不足）`)
        relogined = true
        this.stats.relogins++
        this.token = null
        await this.login()
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new ExportError(`GET ${apiPath} HTTP ${String(res.status)}（重试 ${String(MAX_RETRIES)} 次后仍失败）`)
        this.stats.retries++
        await sleep(await this.backoffDelay(attempt, res, await res.json().catch(() => null)))
        continue
      }
      if (!res.ok) throw new ExportError(`GET ${apiPath} HTTP ${String(res.status)}`)
      return await res.json().catch(() => null)
    }
  }

  /** 尽力 logout（自清会话；失败静默——不影响导出结果；不重试不抛错） */
  async logoutBestEffort(): Promise<void> {
    if (this.token === null) return
    try {
      await fetch(this.url('/logout', {}), {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.token ?? ''}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      this.stats.posts++
    } catch {
      /* 尽力而为：会话残留无害（只读工具），不掩盖导出结果 */
    }
    this.token = null
  }
}

const asObj = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ExportError('响应应为 JSON 对象')
  return value as Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* 导出核心（可注入 fetch-less 纯分页逻辑，测试经真实 homeserver 驱动）   */
/* ------------------------------------------------------------------ */

interface RawEvent { readonly event_id: string; readonly type: string; readonly origin_server_ts: number; readonly sender: string; readonly content: Record<string, unknown> }

function toExportedMessage(ev: RawEvent): ExportedMessage | null {
  if (ev.type !== 'm.room.message' && ev.type !== 'm.room.encrypted') return null
  const content = ev.content ?? {}
  const body = typeof content['body'] === 'string' ? content['body'] : null
  const msgtype = typeof content['msgtype'] === 'string' ? content['msgtype'] : null
  const mentionsRaw = content['m.mentions']
  const mentions = mentionsRaw !== null && typeof mentionsRaw === 'object' && !Array.isArray(mentionsRaw) && Array.isArray((mentionsRaw as Record<string, unknown>)['user_ids'])
    ? ((mentionsRaw as Record<string, unknown>)['user_ids'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return { eventId: ev.event_id, type: ev.type, ts: ev.origin_server_ts, sender: ev.sender, body: ev.type === 'm.room.encrypted' ? null : body, msgtype, mentions }
}

/** 每房消息分页（dir=b 从最新往回；dedup by event_id 防边界重叠；安全上限 maxPages） */
async function paginateRoomMessages(http: MatrixHttp, roomId: string, maxPages: number): Promise<{ messages: ExportedMessage[]; pages: number; nonMessage: number }> {
  const collected = new Map<string, ExportedMessage>()
  let nonMessage = 0
  let from: string | undefined
  let pages = 0
  const seenTokens = new Set<string>()
  for (;;) {
    if (pages >= maxPages) throw new ExportError(`room ${roomId}：分页超过安全上限 ${String(maxPages)} 页（怀疑 token 环；--max-pages 可调）`)
    const query: Record<string, string> = { dir: 'b', limit: String(PAGE_LIMIT) }
    if (from !== undefined) query['from'] = from
    const body = asObj(await http.get(`/rooms/${encodeURIComponent(roomId)}/messages`, query))
    pages++
    const chunk = Array.isArray(body['chunk']) ? (body['chunk'] as unknown[]) : []
    for (const raw of chunk) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const ev = raw as RawEvent
      if (typeof ev.event_id !== 'string' || typeof ev.type !== 'string' || typeof ev.origin_server_ts !== 'number' || typeof ev.sender !== 'string') continue
      const msg = toExportedMessage(ev)
      if (msg === null) {
        nonMessage++
        continue
      }
      if (!collected.has(msg.eventId)) collected.set(msg.eventId, msg)
    }
    const next = body['end']
    if (typeof next !== 'string' || next === '' || seenTokens.has(next)) break
    seenTokens.add(next)
    from = next
  }
  const messages = [...collected.values()].sort((a, b) => (a.ts - b.ts) || (a.eventId < b.eventId ? -1 : 1))
  return { messages, pages, nonMessage }
}

/** 房元尽力：name/topic/canonicalAlias 走具名 state；成员走 /members（state_key 即 MXID） */
async function fetchRoomMeta(http: MatrixHttp, roomId: string): Promise<{ name: string | null; topic: string | null; canonicalAlias: string | null; members: string[] | null }> {
  const stateEvent = async (eventType: string): Promise<Record<string, unknown> | null> => {
    try {
      const body = await http.get(`/rooms/${encodeURIComponent(roomId)}/state/${eventType}`, {})
      return asObj(body)
    } catch {
      return null // 尽力而为：404/无权限=null，不伪造
    }
  }
  const nameEv = await stateEvent('m.room.name')
  const topicEv = await stateEvent('m.room.topic')
  const aliasEv = await stateEvent('m.room.canonical_alias')
  let members: string[] | null = null
  try {
    const body = asObj(await http.get(`/rooms/${encodeURIComponent(roomId)}/members`, {}))
    const chunk = Array.isArray(body['chunk']) ? (body['chunk'] as unknown[]) : []
    const ids = new Set<string>()
    for (const raw of chunk) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
      const stateKey = (raw as Record<string, unknown>)['state_key']
      const content = (raw as Record<string, unknown>)['content']
      const membership = content !== null && typeof content === 'object' && !Array.isArray(content) ? (content as Record<string, unknown>)['membership'] : undefined
      if (typeof stateKey === 'string' && membership !== 'leave' && membership !== 'ban') ids.add(stateKey)
    }
    members = [...ids].sort()
  } catch {
    members = null
  }
  return {
    name: typeof nameEv?.['name'] === 'string' ? (nameEv['name'] as string) : null,
    topic: typeof topicEv?.['topic'] === 'string' ? (topicEv['topic'] as string) : null,
    canonicalAlias: typeof aliasEv?.['alias'] === 'string' ? (aliasEv['alias'] as string) : null,
    members,
  }
}

export interface ExportOutcome {
  readonly exported: MatrixExport
  readonly manifest: ExportManifest
  readonly exportPath: string
  readonly manifestPath: string
}

/** 主流程：登录→joined_rooms→逐房（roomId 升序，确定性）分页+房元→落盘+manifest */
export async function runExport(options: { homeserver: string; userId: string; password: string; outPath: string; manifestPath: string; maxPages: number }): Promise<ExportOutcome> {
  const http = new MatrixHttp(options.homeserver, options.userId, options.password)
  const joined = asObj(await http.get('/joined_rooms', {}))
  const roomIdsRaw = joined['joined_rooms']
  if (!Array.isArray(roomIdsRaw) || !roomIdsRaw.every((x) => typeof x === 'string')) throw new ExportError('joined_rooms 响应形状不符（缺 joined_rooms 字符串数组）')
  const roomIds = [...(roomIdsRaw as string[])].sort()

  const rooms: ExportedRoom[] = []
  let pages = 0
  let nonMessage = 0
  for (const roomId of roomIds) {
    const meta = await fetchRoomMeta(http, roomId)
    const page = await paginateRoomMessages(http, roomId, options.maxPages)
    pages += page.pages
    nonMessage += page.nonMessage
    rooms.push({ roomId, ...meta, messages: page.messages })
  }
  await http.logoutBestEffort()

  const exported: MatrixExport = { schema: EXPORT_SCHEMA, exportedAt: Date.now(), homeserver: options.homeserver, rooms }
  const fileText = serializeMatrixExport(exported)
  mkdirSync(path.dirname(options.outPath), { recursive: true })
  writeFileSync(options.outPath, fileText)
  const manifest = buildManifest(exported, fileText, pages, options.maxPages, http.stats, nonMessage)
  writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { exported, manifest, exportPath: options.outPath, manifestPath: options.manifestPath }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：MATRIX_HOMESERVER=… MATRIX_BOT_USER=@bot:server MATRIX_BOT_PASSWORD=… node scripts/matrix-export.ts [--homeserver <url>] [--user <mxid>] [--out <file>] [--manifest <file>] [--max-pages <n>]'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function exportCliArgs(argv: readonly string[]): { homeserver: string; userId: string; outPath: string; manifestPath: string; maxPages: number } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const homeserver = valueOf('--homeserver') ?? process.env['MATRIX_HOMESERVER'] ?? ''
  const userId = valueOf('--user') ?? process.env['MATRIX_BOT_USER'] ?? ''
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const outPath = valueOf('--out') ?? path.join(tmpdir(), `matrix-export-${date}.json`)
  const manifestPath = valueOf('--manifest') ?? `${outPath}.manifest.json`
  const maxPagesRaw = valueOf('--max-pages')
  const maxPages = maxPagesRaw === undefined ? DEFAULT_MAX_PAGES : Number(maxPagesRaw)
  if (args.some((a) => a === '--help' || a === '-h')) throw new UsageError(USAGE)
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (maxPagesRaw !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) throw new UsageError(`--max-pages 应为正整数，实为 ${maxPagesRaw}`)
  if (homeserver === '') throw new UsageError(`缺少 homeserver（--homeserver 或 env MATRIX_HOMESERVER）；${USAGE}`)
  if (userId === '') throw new UsageError(`缺少 bot user id（--user 或 env MATRIX_BOT_USER）；${USAGE}`)
  if (!/^https?:\/\//.test(homeserver)) throw new UsageError(`homeserver 应为 http(s) URL：${homeserver}`)
  if (!userId.startsWith('@') || !userId.includes(':')) throw new UsageError('user 应为完整 MXID（@local:domain 形）')
  return { homeserver, userId, outPath, manifestPath, maxPages }
}

async function main(): Promise<void> {
  const options = exportCliArgs(process.argv.slice(2))
  if (process.env['MATRIX_BOT_PASSWORD'] === undefined || process.env['MATRIX_BOT_PASSWORD'] === '') {
    throw new UsageError(`缺少密码（env MATRIX_BOT_PASSWORD；只收 env 不收 flag——argv 不落凭据）；${USAGE}`)
  }
  const outcome = await runExport({ ...options, password: process.env['MATRIX_BOT_PASSWORD'] })
  const m = outcome.manifest
  const summary = {
    ok: true,
    export: outcome.exportPath,
    manifest: outcome.manifestPath,
    rooms: m.roomCount,
    messages: m.messageCount,
    encryptedEvents: m.encryptedEvents,
    nonMessageEvents: m.nonMessageEvents,
    timeRange: m.timeRange,
    sha256: m.exportSha256,
    http: m.http,
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (isDirectRun()) {
  main()
    .then(() => { process.exitCode = 0 })
    .catch((err: unknown) => {
      if (err instanceof UsageError) {
        console.error(`[matrix-export] ${err.message}`)
        process.exit(2)
      }
      console.error(`[matrix-export] ${err instanceof ExportError ? err.message : String(err)}`)
      process.exit(1)
    })
}
