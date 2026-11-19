/**
 * matrix-to-chatd-diff —— M4 聊天自研切换·源导出 vs chatd 对账器（task-137）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M4（验收=双跑 0 漏/0 重复）、
 *     §四.3（切流前完成双跑对账）
 *   - docs/sentinel-logs/聊天自研切换-runbook-2026-11-19.md §五（0-Diff 判据）
 *
 * 三层对账（独立于迁移器收口断言——第二道闸门，不复用迁移器的记账）：
 *   A) 记账层：导出消息事件 = report.messages ∪ report.skips（每条源事件要么迁移要么
 *      显式不可迁登记——「0 漏」的完整口径，缺一条即 gap）；
 *   B) 结构层：房数/每房计数（live headRoomSeq 与标签扫描双口径）/发送者集合/首末时间
 *      （时间唯一载体=body 溯源标签 [mx:<eventId>@<ts>]——chatd v1 createdAt 是服务端
 *      迁移时刻，协议无回填位，见 runbook §八）；
 *   C) 事件层：每房 live 标签集 vs 计划 eventId 集——缺=漏（missed）、多或重复出现=漂移
 *      （unexpected/duplicate）。无标签消息=迁移外消息（双跑窗口正常流量），计数披露不判 gap。
 *
 * 读源两种（互斥）：
 *   --db <chatd.sqlite>     直读 SQLite（readOnly 打开，append-only 宪法零风险；**全量**口径，
 *                           不受协议 messages.list 每房 200 条窗口限制——离线对账/大房首选）
 *   --socket <path> --token  Transport v1 真客户端只读调用（rooms.list/messages.list；切流日
 *                           对运行中实例的在线对账；每房标签窗口=最旧 200 条，超窗记 capped 注记）
 *
 * 用法：node scripts/matrix-to-chatd-diff.ts --export <matrix-export.json> --report <migrate-report.json>
 *          (--db <path> | --socket <path> --token <tok>) [--json <out>] [--quiet]
 * 退出码：0=0 差异（切流门槛达成）；1=有 gap（逐条列 room/kind/detail）；2=用法/结构错误。
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { WorkbenchTransport } from '../packages/workbench-transport/src/index.ts'
import type { Room } from '../packages/workbench-transport/src/types.ts'
import { loadMatrixExport, type MatrixExport } from './matrix-export.ts'
import { parseTag, type MigrateReport } from './matrix-to-chatd-migrate.ts'
import { UsageError } from './workbench-issues-migrate.ts'

export const DIFF_SCHEMA = 'matrix-chatd-diff/v1'

export interface DiffGap { readonly room: string | null; readonly kind: string; readonly detail: string }
export interface DiffNote { readonly room: string | null; readonly kind: string; readonly detail: string }

export interface RoomDiff {
  readonly matrixRoomId: string
  readonly chatdRoomId: string
  readonly chatdName: string
  readonly planned: number
  readonly liveTagged: number
  readonly liveForeign: number
  readonly missed: number
  readonly unexpected: number
  readonly duplicate: number
  readonly sendersMatch: boolean
  readonly timeRangeMatch: boolean
  readonly capped: boolean
}

export interface DiffReport {
  readonly schema: typeof DIFF_SCHEMA
  readonly mode: 'db' | 'socket'
  readonly exportPath: string
  readonly reportPath: string
  readonly source: { readonly rooms: number; readonly messageEvents: number; readonly skipped: number; readonly migrated: number }
  readonly chatd: { readonly rooms: number; readonly taggedMessages: number; readonly foreignMessages: number }
  readonly perRoom: readonly RoomDiff[]
  readonly gaps: readonly DiffGap[]
  readonly notes: readonly DiffNote[]
  readonly ok: boolean
}

/* ------------------------------------------------------------------ */
/* live 读取面（db=全量；socket=协议窗口≤200/房）                        */
/* ------------------------------------------------------------------ */

interface LiveMessage { readonly chatdRoomId: string; readonly body: string; readonly senderId: string }
export interface LiveFace { readonly rooms: readonly Room[]; readonly messages: readonly LiveMessage[]; readonly cappedRooms: ReadonlySet<string> }

export function readChatdDb(dbPath: string): LiveFace {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch (cause) {
    throw new UsageError(`chatd SQLite 不可读（readOnly）：${dbPath}（${String(cause)}）`)
  }
  try {
    const roomRows = db.prepare('SELECT room_id, kind, name, member_ids FROM rooms').all() as unknown as { room_id: string; kind: string; name: string; member_ids: string }[]
    const msgRows = db.prepare('SELECT room_id, sender_id, body FROM messages ORDER BY room_id, room_seq').all() as unknown as { room_id: string; sender_id: string; body: string }[]
    const rooms: Room[] = roomRows.map((row) => ({
      roomId: row.room_id,
      kind: (row.kind === 'broadcast' || row.kind === 'dm' ? row.kind : 'group') as Room['kind'],
      name: row.name,
      memberIds: JSON.parse(row.member_ids) as string[],
      headRoomSeq: msgRows.filter((m) => m.room_id === row.room_id).length,
    }))
    return { rooms, messages: msgRows.map((m) => ({ chatdRoomId: m.room_id, body: m.body, senderId: m.sender_id })), cappedRooms: new Set() }
  } finally {
    db.close()
  }
}

async function readSocket(socketPath: string, token: string): Promise<LiveFace> {
  const client = new WorkbenchTransport({ socketPath, requestTimeoutMs: 10_000 })
  const raw = client as unknown as { request(method: string, params: Record<string, unknown>): Promise<unknown> } // 鉴权适配（同 migrate 头注）
  try {
    const rooms = (await raw.request('rooms.list', { token })) as readonly Room[]
    const messages: LiveMessage[] = []
    const cappedRooms = new Set<string>()
    for (const room of rooms) {
      const actorId = room.memberIds[0]
      if (actorId === undefined) continue // 无成员房无消息可读（空房）
      const page = (await raw.request('messages.list', { token, roomId: room.roomId, actorId, limit: 200 })) as { items: readonly { body: string; senderId: string }[]; hasMore: boolean }
      for (const item of page.items) messages.push({ chatdRoomId: room.roomId, body: item.body, senderId: item.senderId })
      if (page.hasMore) cappedRooms.add(room.roomId)
    }
    return { rooms, messages, cappedRooms }
  } finally {
    client.close()
  }
}

/* ------------------------------------------------------------------ */
/* 对账核心（纯函数：同输入同报告——测试与工具同源）                      */
/* ------------------------------------------------------------------ */

export function loadMigrateReport(filePath: string): MigrateReport {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (cause) {
    throw new UsageError(`迁移报告不可读：${filePath}（${String(cause)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${filePath}: JSON 解析失败（${String(cause)}）`)
  }
  const r = parsed as MigrateReport
  if (r.schema !== 'matrix-migrate-report/v1') throw new UsageError(`${filePath}: schema 应为 matrix-migrate-report/v1，实为 ${String(r.schema)}`)
  return r
}

export function diffExportVsChatd(exported: MatrixExport, report: MigrateReport, live: LiveFace, mode: 'db' | 'socket'): DiffReport {
  const gaps: DiffGap[] = []
  const notes: DiffNote[] = []

  // A) 记账层：每条导出消息事件必须被迁移或登记
  const exportEvents = new Map<string, { roomId: string }>()
  for (const room of exported.rooms) for (const msg of room.messages) exportEvents.set(msg.eventId, { roomId: room.roomId })
  const accounted = new Set<string>()
  for (const m of report.messages) {
    accounted.add(m.eventId)
    if (!exportEvents.has(m.eventId)) gaps.push({ room: null, kind: 'plan-foreign', detail: `report.messages 含导出外事件 ${m.eventId}` })
  }
  for (const s of report.skips) {
    accounted.add(s.eventId)
    if (!exportEvents.has(s.eventId)) gaps.push({ room: null, kind: 'plan-foreign', detail: `report.skips 含导出外事件 ${s.eventId}` })
  }
  for (const [eventId, info] of exportEvents) {
    if (!accounted.has(eventId)) gaps.push({ room: info.roomId, kind: 'export-unaccounted', detail: `导出事件 ${eventId} 既未迁移也未登记不可迁（0 漏口径破坏）` })
  }

  // B/C) 结构+事件层：按 chatd 房聚合 live 标签
  const liveRoomsById = new Map(live.rooms.map((room) => [room.roomId, room]))
  const liveByChatdRoom = new Map<string, LiveMessage[]>()
  for (const msg of live.messages) {
    const bucket = liveByChatdRoom.get(msg.chatdRoomId)
    if (bucket === undefined) liveByChatdRoom.set(msg.chatdRoomId, [msg])
    else bucket.push(msg)
  }

  const perRoom: RoomDiff[] = []
  for (const room of report.rooms) {
    const liveRoom = liveRoomsById.get(room.chatdRoomId)
    if (liveRoom === undefined) {
      gaps.push({ room: room.matrixRoomId, kind: 'room-missing', detail: `chatd 缺房 ${room.chatdName}（${room.chatdRoomId}）` })
      continue
    }
    const liveMessages = liveByChatdRoom.get(room.chatdRoomId) ?? []
    const tagCounts = new Map<string, number>()
    const tagTs = new Map<string, number>()
    const liveSendersByEvent = new Map<string, Set<string>>()
    let foreign = 0
    for (const msg of liveMessages) {
      const tag = parseTag(msg.body)
      if (tag === null) {
        foreign++
        continue
      }
      tagCounts.set(tag.eventId, (tagCounts.get(tag.eventId) ?? 0) + 1)
      tagTs.set(tag.eventId, tag.ts)
      const senders = liveSendersByEvent.get(tag.eventId) ?? new Set<string>()
      senders.add(msg.senderId)
      liveSendersByEvent.set(tag.eventId, senders)
    }
    const plannedEvents = report.messages.filter((m) => m.chatdRoomId === room.chatdRoomId)
    const plannedIds = new Set(plannedEvents.map((m) => m.eventId))
    let missed = 0
    let unexpected = 0
    let duplicate = 0
    for (const id of plannedIds) {
      const count = tagCounts.get(id) ?? 0
      if (count === 0) {
        missed++
        gaps.push({ room: room.matrixRoomId, kind: 'missed', detail: `事件 ${id} 计划迁移但 chatd 无（漏）` })
      } else if (count > 1) {
        duplicate += count - 1
        gaps.push({ room: room.matrixRoomId, kind: 'duplicate', detail: `事件 ${id} 在 chatd 出现 ${String(count)} 次（重复——append-only 不可修，需回滚重迁）` })
      }
    }
    for (const id of tagCounts.keys()) {
      if (!plannedIds.has(id)) {
        unexpected++
        gaps.push({ room: room.matrixRoomId, kind: 'unexpected', detail: `chatd 含计划外迁移标签 ${id}（漂移或旧迁移残留）` })
      }
    }
    // 发送者集合（计划 actors vs live 标签消息 senders）
    const plannedSenders = new Set(plannedEvents.map((m) => m.actor))
    const liveSenders = new Set(plannedEvents.filter((m) => tagCounts.has(m.eventId)).flatMap((m) => [...(liveSendersByEvent.get(m.eventId) ?? [])]))
    const sendersMatch = plannedSenders.size === liveSenders.size && [...plannedSenders].every((s) => liveSenders.has(s))
    if (!sendersMatch) gaps.push({ room: room.matrixRoomId, kind: 'sender-mismatch', detail: `发送者集合不符：计划 {${[...plannedSenders].sort().join(',')}} vs live {${[...liveSenders].sort().join(',')}}` })
    // 首末时间（标签 ts vs 计划 ts）
    const plannedTs = plannedEvents.filter((m) => tagTs.has(m.eventId)).map((m) => tagTs.get(m.eventId) as number)
    const plannedFirst = plannedEvents.length > 0 ? Math.min(...plannedEvents.map((m) => m.ts)) : null
    const plannedLast = plannedEvents.length > 0 ? Math.max(...plannedEvents.map((m) => m.ts)) : null
    const liveFirst = plannedTs.length > 0 ? Math.min(...plannedTs) : null
    const liveLast = plannedTs.length > 0 ? Math.max(...plannedTs) : null
    const timeRangeMatch = plannedFirst === liveFirst && plannedLast === liveLast
    if (!timeRangeMatch && plannedEvents.length > 0) gaps.push({ room: room.matrixRoomId, kind: 'time-range-mismatch', detail: `首末时间不符：计划 [${String(plannedFirst)},${String(plannedLast)}] vs live [${String(liveFirst)},${String(liveLast)}]（标签 ts 漂移）` })
    // 每房计数（结构层）：headRoomSeq == tagged + foreign
    const tagged = liveMessages.length - foreign
    if (liveRoom.headRoomSeq !== tagged + foreign) {
      gaps.push({ room: room.matrixRoomId, kind: 'count-mismatch', detail: `房 ${room.chatdName}：headRoomSeq=${String(liveRoom.headRoomSeq)} ≠ 标签${String(tagged)}+迁移外${String(foreign)}` })
    }
    if (foreign > 0) notes.push({ room: room.matrixRoomId, kind: 'foreign-messages', detail: `房 ${room.chatdName} 含 ${String(foreign)} 条无标签消息（双跑窗口新流量或人工消息；不判 gap）` })
    const capped = live.cappedRooms.has(room.chatdRoomId)
    if (capped) notes.push({ room: room.matrixRoomId, kind: 'capped', detail: `房 ${room.chatdName} 消息数超协议窗口（>200/房）：事件级对账只覆盖最旧 200 条；全量口径用 --db` })
    perRoom.push({
      matrixRoomId: room.matrixRoomId,
      chatdRoomId: room.chatdRoomId,
      chatdName: room.chatdName,
      planned: plannedEvents.length,
      liveTagged: tagged,
      liveForeign: foreign,
      missed,
      unexpected,
      duplicate,
      sendersMatch,
      timeRangeMatch,
      capped,
    })
  }

  // 房数（结构层）
  const exportRoomCount = exported.rooms.length
  if (report.rooms.length !== exportRoomCount) gaps.push({ room: null, kind: 'room-count', detail: `报告房数 ${String(report.rooms.length)} ≠ 导出房数 ${String(exportRoomCount)}` })
  const plannedChatdRooms = new Set(report.rooms.map((room) => room.chatdRoomId))
  for (const liveRoom of live.rooms) {
    if (!plannedChatdRooms.has(liveRoom.roomId)) notes.push({ room: null, kind: 'foreign-room', detail: `chatd 含计划外房 ${liveRoom.name}（${liveRoom.roomId}；双跑新建/存量，不判 gap）` })
  }

  const taggedTotal = perRoom.reduce((sum, room) => sum + room.liveTagged, 0)
  const foreignTotal = perRoom.reduce((sum, room) => sum + room.liveForeign, 0)
  return {
    schema: DIFF_SCHEMA,
    mode,
    exportPath: '',
    reportPath: '',
    source: { rooms: exportRoomCount, messageEvents: exportEvents.size, skipped: report.skips.length, migrated: report.messages.length },
    chatd: { rooms: live.rooms.length, taggedMessages: taggedTotal, foreignMessages: foreignTotal },
    perRoom,
    gaps,
    notes,
    ok: gaps.length === 0,
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：node scripts/matrix-to-chatd-diff.ts --export <matrix-export.json> --report <migrate-report.json> (--db <chatd.sqlite> | --socket <path> --token <tok>) [--json <out>] [--quiet]'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function diffCliArgs(argv: readonly string[]): { exportPath: string; reportPath: string; dbPath: string | undefined; socketPath: string | undefined; token: string | undefined; jsonOut: string | undefined; quiet: boolean; mode: 'db' | 'socket' } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const exportPath = valueOf('--export')
  const reportPath = valueOf('--report')
  const dbPath = valueOf('--db')
  const socketPath = valueOf('--socket')
  const token = valueOf('--token')
  const jsonOut = valueOf('--json')
  const quietIndex = args.indexOf('--quiet')
  const quiet = quietIndex >= 0
  if (quiet) args.splice(quietIndex, 1)
  if (args.some((a) => a === '--help' || a === '-h')) throw new UsageError(USAGE)
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (exportPath === undefined || reportPath === undefined) throw new UsageError(`缺少 --export/--report；${USAGE}`)
  const mode: 'db' | 'socket' = dbPath !== undefined ? 'db' : 'socket'
  if (mode === 'db' && socketPath !== undefined) throw new UsageError(`--db 与 --socket 互斥；${USAGE}`)
  if (mode === 'socket' && (socketPath === undefined || token === undefined)) throw new UsageError(`socket 模式需 --socket 与 --token；${USAGE}`)
  return { exportPath, reportPath, dbPath, socketPath, token, jsonOut, quiet, mode }
}

export async function diffCli(argv: readonly string[]): Promise<{ code: number; stdout: string }> {
  const args = diffCliArgs(argv)
  const exported = loadMatrixExport(args.exportPath)
  const report = loadMigrateReport(args.reportPath)
  const live = args.mode === 'db' ? readChatdDb(args.dbPath as string) : await readSocket(args.socketPath as string, args.token as string)
  const diff = diffExportVsChatd(exported, report, live, args.mode)
  const final: DiffReport = { ...diff, mode: args.mode, exportPath: args.exportPath, reportPath: args.reportPath }
  const text = `${JSON.stringify(final, null, 2)}\n`
  if (args.jsonOut !== undefined) {
    mkdirSync(path.dirname(args.jsonOut), { recursive: true })
    writeFileSync(args.jsonOut, text)
  }
  if (args.quiet) {
    return { code: final.ok ? 0 : 1, stdout: `${JSON.stringify({ ok: final.ok, mode: final.mode, rooms: final.chatd.rooms, tagged: final.chatd.taggedMessages, foreign: final.chatd.foreignMessages, gaps: final.gaps.length, gapKinds: [...new Set(final.gaps.map((g) => g.kind))] })}\n` }
  }
  return { code: final.ok ? 0 : 1, stdout: text }
}

if (isDirectRun()) {
  diffCli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(result.stdout)
      process.exit(result.code)
    })
    .catch((err: unknown) => {
      if (err instanceof UsageError) {
        console.error(`[matrix-to-chatd-diff] ${err.message}`)
        process.exit(2)
      }
      console.error(`[matrix-to-chatd-diff] ${String(err instanceof Error ? err.message : err)}`)
      process.exit(2)
    })
}
