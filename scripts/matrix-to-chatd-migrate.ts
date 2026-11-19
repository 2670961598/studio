/**
 * matrix-to-chatd-migrate —— M4 聊天自研切换·Matrix 导出→chatd 迁移器（task-137）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 M4（双跑 0 漏/0 重复）、
 *     §四.2（数据迁移：rooms/messages；actor=MXID→工号映射；只迁语义不迁拓扑；
 *     附件/加密显式 UNSUPPORTED）、§四.4（回滚口径）
 *   - docs/sentinel-logs/聊天自研切换-runbook-2026-11-19.md §三（迁移窗口）/§八（幂等口径）
 *   - packages/workbench-transport/src/types.ts（Transport v1 冻结协议——本件经真客户端
 *     WorkbenchTransport 调 rooms.create/messages.send；与 chatd-driver 同法：子进程+真 socket，
 *     不构成包 import 边的违例口径一致）
 *
 * 形态：导出 JSON（scripts/matrix-export.ts 产物）→ 起临时 chatd（临时 socket/token/SQLite，
 *   mkdtemp 工作目录，跑完 SIGTERM 优雅停机；--socket/--token 可指向已运行实例=切流日形态）→
 *   Transport v1 写入。产物（报告/DB/token 文件）只落 /tmp 工作目录——快照含业务数据不入仓。
 *
 * 幂等（三层，0 漏/0 重复的机制保证——runbook §八全口径）：
 *   L1 房：rooms.list 按 chatd 房名匹配复用（房名映射确定性；撞名加 #<hash8> 消歧）；
 *   L2 消息：messages.send idempotencyKey=`mx:<eventId>`——chatd 端 replay 语义（SQLite 落
 *      idempotency 表，跨进程重启仍 replay；scope=send:<actor>|<roomId>，故**actor/房映射必须
 *      冻结**——runbook §二迁移窗口内不得改 mapping 文件）；
 *   L3 预检：发送前扫房内既有消息的 `[mx:` 前缀标签，已存在的 eventId 直接计 preexisting 跳过
 *      （协议 messages.list 每房只见最旧 200 条——预检覆盖面≤200/房，超出依赖 L2；--db 全量
 *      口径走对账器）。L3 兜 chatd「消息落库与幂等键落库分两个事务」的崩溃窗口（毫秒级）。
 *
 * 溯源标签：body 前缀 `[mx:<eventId>@<origin_ts>] `——event_id 为去重键、ts 为对账首末时间的
 *   唯一载体（chatd v1 createdAt=服务端 now，无法回填源时间——协议缺口登记于 README/runbook）。
 *
 * 不可迁项（显式 UNSUPPORTED，登记 skips 不静默——「0 漏」= 每条源事件要么迁移要么登记）：
 *   m.room.encrypted（E2EE 密文不导出）/ m.relates_to rel_type=m.replace（编辑链不重建）/
 *   msgtype m.file|m.image|m.audio|m.video（附件 mxc 内容）/ 空 body。
 *
 * 用法：node scripts/matrix-to-chatd-migrate.ts --export <matrix-export.json>
 *          [--actors <mapping.json>] [--workdir <dir>] [--cleanup]
 *          | --socket <path> --token <tok> --export <json> [--actors <mapping.json>]
 * 退出码：0=迁移成功（skips 属显式不可迁，不算失败）；1=迁移失败/断言 gap；2=用法/结构错误。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkbenchTransport, WorkbenchTransportError } from '../packages/workbench-transport/src/index.ts'
import { EXPORT_SCHEMA, loadMatrixExport, sha256FileBytes, type ExportedMessage, type ExportedRoom, type MatrixExport } from './matrix-export.ts'
import { UsageError } from './workbench-issues-migrate.ts'

export const REPORT_SCHEMA = 'matrix-migrate-report/v1'
export const CHATD_ENTRY = path.resolve(import.meta.dirname, '../apps/workbench-chatd/src/main.ts')
/** 溯源标签：`[mx:<eventId>@<ts>] ` 前缀（去重键+源时间，对账器 parseTag 对偶） */
export const TAG_PREFIX = '[mx:'
export const TAG_RE = /^\[mx:(\$[^@\]]+)@(\d+)\] /
const CHATD_BOOT_TIMEOUT_MS = 30_000
const CHATD_STOP_TIMEOUT_MS = 10_000
const CLIENT_REQUEST_TIMEOUT_MS = 10_000
const CLIENT_RETRIES = 3

export class MigrateError extends Error {}

/* ------------------------------------------------------------------ */
/* actor 映射：显式 JSON + 启发式 localpart + 兜底 MXID 逐字（并登记）    */
/* ------------------------------------------------------------------ */

export type ActorRule = 'explicit' | 'heuristic-localpart' | 'verbatim-mxid'

export interface ActorDecision { readonly actor: string; readonly rule: ActorRule }

const CLEAN_LOCALPART = /^[A-Za-z0-9._-]{1,64}$/

export function localpartOf(mxid: string): string {
  return mxid.startsWith('@') ? mxid.slice(1).split(':')[0] ?? '' : ''
}

/** 显式表（{@mxid: actor}）→ 启发式（干净 localpart 直用）→ MXID 逐字保留；决策全登记 */
export function buildActorMap(mxids: readonly string[], explicit: Readonly<Record<string, string>>): ReadonlyMap<string, ActorDecision> {
  const map = new Map<string, ActorDecision>()
  for (const mxid of mxids) {
    const hit = explicit[mxid]
    if (hit !== undefined && hit !== '') {
      map.set(mxid, { actor: hit, rule: 'explicit' })
      continue
    }
    const local = localpartOf(mxid)
    if (CLEAN_LOCALPART.test(local)) {
      map.set(mxid, { actor: local, rule: 'heuristic-localpart' })
      continue
    }
    map.set(mxid, { actor: mxid, rule: 'verbatim-mxid' })
  }
  return map
}

export function loadActorsFile(filePath: string): Readonly<Record<string, string>> {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (cause) {
    throw new UsageError(`actors 映射文件不可读：${filePath}（${String(cause)}）`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${filePath}: JSON 解析失败（${String(cause)}）`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UsageError(`${filePath}: 应为 {MXID: actor} 对象`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string' || v === '') throw new UsageError(`${filePath}: 值应为非空字符串（key=${k}）`)
    if (!k.startsWith('@')) throw new UsageError(`${filePath}: key 应为完整 MXID（@local:domain），实为 ${k}`)
    out[k] = v
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 房映射与消息计划（纯函数：同导出同计划——对账器同源消费）               */
/* ------------------------------------------------------------------ */

export type SkipReason = 'encrypted' | 'edit' | 'attachment' | 'empty-body'

export interface PlannedMessage {
  readonly eventId: string
  readonly roomId: string
  readonly ts: number
  readonly sender: string
  readonly actor: string
  readonly body: string
  readonly mentions: readonly string[]
  readonly idempotencyKey: string
  readonly taggedBody: string
}

export interface SkippedMessage { readonly eventId: string; readonly roomId: string; readonly reason: SkipReason }

export interface RoomPlan {
  readonly matrixRoomId: string
  /** chatd 房名（name‖alias‖roomId，全房唯一：撞名追加 #<hash8(matrixRoomId)>） */
  readonly chatdName: string
  readonly topic: string | null
  readonly memberActors: readonly string[]
  readonly planned: readonly PlannedMessage[]
  readonly skipped: readonly SkippedMessage[]
}

/** 单条消息取舍：可迁=非加密、有 body、非编辑链、非附件 msgtype */
export function classifyMessage(msg: ExportedMessage): SkipReason | null {
  if (msg.type === 'm.room.encrypted') return 'encrypted'
  if (msg.body === null || msg.body.trim() === '') return 'empty-body'
  if (msg.type !== 'm.room.message') return 'encrypted' // 防御：非 message/encrypted 类型不迁（导出器已滤）
  if (msg.msgtype === 'm.replace') return 'edit'
  if (msg.msgtype === 'm.file' || msg.msgtype === 'm.image' || msg.msgtype === 'm.audio' || msg.msgtype === 'm.video') return 'attachment'
  return null
}

export function tagOf(eventId: string, ts: number): string {
  return `${TAG_PREFIX}${eventId}@${String(ts)}] `
}

export function parseTag(body: string): { eventId: string; ts: number } | null {
  const m = TAG_RE.exec(body)
  if (m === null || m[1] === undefined || m[2] === undefined) return null
  return { eventId: m[1], ts: Number(m[2]) }
}

/** 全房唯一 chatd 房名（确定性：同名房以矩阵 roomId 哈希 8 位消歧） */
export function chatdNameOf(room: ExportedRoom, usedNames: ReadonlySet<string>): string {
  const base = room.name ?? room.canonicalAlias ?? room.roomId
  if (!usedNames.has(base)) return base
  const suffix = createHash('sha256').update(room.roomId, 'utf8').digest('hex').slice(0, 8)
  const name = `${base} #${suffix}`
  if (usedNames.has(name)) throw new MigrateError(`chatd 房名消歧后仍撞名：${name}（matrix room ${room.roomId}）`)
  return name
}

export function buildRoomPlans(exported: MatrixExport, actorMap: ReadonlyMap<string, ActorDecision>): readonly RoomPlan[] {
  const usedNames = new Set<string>()
  const plans: RoomPlan[] = []
  for (const room of [...exported.rooms].sort((a, b) => (a.roomId < b.roomId ? -1 : 1))) {
    const chatdName = chatdNameOf(room, usedNames)
    usedNames.add(chatdName)
    const actorOf = (mxid: string): string => {
      const hit = actorMap.get(mxid)
      if (hit === undefined) throw new MigrateError(`actor 映射缺决策：${mxid}（buildActorMap 应全覆盖）`)
      return hit.actor
    }
    const members = new Set<string>((room.members ?? []).map(actorOf))
    const planned: PlannedMessage[] = []
    const skipped: SkippedMessage[] = []
    for (const msg of room.messages) {
      const reason = classifyMessage(msg)
      if (reason !== null) {
        skipped.push({ eventId: msg.eventId, roomId: room.roomId, reason })
        continue
      }
      const mentions = msg.mentions.map(actorOf)
      for (const target of mentions) members.add(target) // chatd 约束：mention 目标必须是房成员
      members.add(actorOf(msg.sender))
      planned.push({
        eventId: msg.eventId,
        roomId: room.roomId,
        ts: msg.ts,
        sender: msg.sender,
        actor: actorOf(msg.sender),
        body: msg.body as string,
        mentions,
        idempotencyKey: `mx:${msg.eventId}`,
        taggedBody: `${tagOf(msg.eventId, msg.ts)}${msg.body as string}`,
      })
    }
    if (members.size === 0) members.add('migration-sentinel') // 空成员房：chatd memberIds 需非空语义，哨兵登记于报告
    plans.push({ matrixRoomId: room.roomId, chatdName, topic: room.topic, memberActors: [...members].sort(), planned, skipped })
  }
  return plans
}

/* ------------------------------------------------------------------ */
/* 临时 chatd 生命周期（spawn→ready→SIGTERM；token 不出日志/摘要）        */
/* ------------------------------------------------------------------ */

export interface ChatdHandle {
  readonly child: ChildProcess
  readonly socketPath: string
  readonly dbPath: string
  readonly token: string
  stop(): Promise<void>
}

export async function startTempChatd(workdir: string): Promise<ChatdHandle> {
  const socketPath = path.join(workdir, 'chat.sock')
  const dbPath = path.join(workdir, 'chatd.sqlite')
  const token = randomBytes(32).toString('hex')
  writeFileSync(path.join(workdir, 'chatd.token'), `${token}\n`, { mode: 0o600 })
  const child = spawn(process.execPath, ['--experimental-strip-types', CHATD_ENTRY], {
    env: { ...process.env, WORKBENCH_CHATD_SOCKET: socketPath, WORKBENCH_CHATD_TOKEN: token, WORKBENCH_CHATD_DB: dbPath, WORKBENCH_CHATD_LOG: 'info' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const stderr = child.stderr
  if (stderr === null) throw new MigrateError('chatd 子进程 stderr 不可用')
  let ready: ((value: void) => void) = () => {}
  let failed: ((err: Error) => void) = () => {}
  const readyPromise = new Promise<void>((resolve, reject) => {
    ready = resolve
    failed = reject
    let buffer = ''
    stderr.setEncoding('utf8')
    stderr.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        try {
          const evt = JSON.parse(line) as { event?: unknown }
          if (evt.event === 'ready') ready()
        } catch {
          /* 非 JSON 行忽略 */
        }
        index = buffer.indexOf('\n')
      }
    })
    child.once('exit', (code, signal) => {
      failed(new MigrateError(`chatd 启动即退出（code=${String(code)} signal=${String(signal)}；详见工作目录 stderr 无残留——token 不回显）`))
    })
  })
  const timer = setTimeout(() => {
    failed(new MigrateError(`chatd ${CHATD_BOOT_TIMEOUT_MS}ms 内未 ready`))
  }, CHATD_BOOT_TIMEOUT_MS)
  try {
    await readyPromise
  } finally {
    clearTimeout(timer)
    child.removeAllListeners('exit')
  }
  return {
    child,
    socketPath,
    dbPath,
    token,
    stop: async () => {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => child.kill('SIGKILL'), CHATD_STOP_TIMEOUT_MS)
        child.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
        child.kill('SIGTERM')
      })
    },
  }
}

/* ------------------------------------------------------------------ */
/* Transport v1 客户端（可重试包装：WB_UNAVAILABLE/WB_TIMEOUT 退避重试）  */
/* ------------------------------------------------------------------ */

/**
 * v1 客户端鉴权缺口适配：服务端契约收 `params.token`（apps/workbench-chatd/src/server.ts
 * 帧层鉴权，chatd README「鉴权」节），而 WorkbenchTransport v1 客户端 DTO 未建模 token
 * （构造无 token 形参；health/rooms.list 连 params 入口都没有）。本适配复用真客户端的
 * 连接/组帧/超时/重连机制，只在 wire 面注入服务端明确接受的 token 字段，不改协议；
 * M3 模块 D daemon 接线时应把 token 收进客户端构造（runbook 已登记）。
 */
interface AuthedClient {
  health(): ReturnType<WorkbenchTransport['health']>
  listRooms(): ReturnType<WorkbenchTransport['listRooms']>
  createRoom(input: Parameters<WorkbenchTransport['createRoom']>[0]): ReturnType<WorkbenchTransport['createRoom']>
  sendMessage(input: Parameters<WorkbenchTransport['sendMessage']>[0]): ReturnType<WorkbenchTransport['sendMessage']>
  listMessages(input: Parameters<WorkbenchTransport['listMessages']>[0]): ReturnType<WorkbenchTransport['listMessages']>
  close(): void
}

function authedClient(client: WorkbenchTransport, token: string): AuthedClient {
  const raw = client as unknown as { request(method: string, params: Record<string, unknown>): Promise<unknown> }
  const withToken = <T extends object>(input: T): T => ({ ...input, token }) as T
  return {
    health: () => raw.request('health', { token }) as ReturnType<WorkbenchTransport['health']>,
    listRooms: () => raw.request('rooms.list', { token }) as ReturnType<WorkbenchTransport['listRooms']>,
    createRoom: (input) => client.createRoom(withToken(input)),
    sendMessage: (input) => client.sendMessage(withToken(input)),
    listMessages: (input) => client.listMessages(withToken(input)),
    close: () => client.close(),
  }
}

async function callWithRetry<T>(makeCall: () => Promise<T>, what: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < CLIENT_RETRIES; attempt++) {
    try {
      return await makeCall()
    } catch (err) {
      lastErr = err
      if (err instanceof WorkbenchTransportError && (err.code === 'WB_UNAVAILABLE' || err.code === 'WB_TIMEOUT')) {
        await new Promise((resolve) => { setTimeout(resolve, 200 * 2 ** attempt) })
        continue
      }
      throw err
    }
  }
  throw new MigrateError(`${what} 重试 ${String(CLIENT_RETRIES)} 次后仍失败：${String(lastErr instanceof Error ? lastErr.message : lastErr)}`)
}

/* ------------------------------------------------------------------ */
/* 迁移报告                                                            */
/* ------------------------------------------------------------------ */

export interface MigratedMessageResult { readonly eventId: string; readonly roomId: string; readonly chatdRoomId: string; readonly actor: string; readonly ts: number; readonly status: 'sent' | 'replayed' | 'preexisting'; readonly messageId: string | null }

export interface MigrateReport {
  readonly schema: typeof REPORT_SCHEMA
  readonly exportSchema: typeof EXPORT_SCHEMA
  readonly exportSha256: string
  readonly startedAt: number
  readonly finishedAt: number
  readonly target: { readonly mode: 'temp' | 'external'; readonly socketPath: string; readonly dbPath: string | null; readonly chatdServer: string }
  readonly actorMap: Readonly<Record<string, ActorDecision>>
  readonly rooms: readonly {
    readonly matrixRoomId: string
    readonly chatdRoomId: string
    readonly chatdName: string
    readonly topic: string | null
    readonly memberCount: number
    readonly planned: number
    readonly sent: number
    readonly replayed: number
    readonly preexisting: number
    readonly skipped: number
    readonly foreignSeen: number
  }[]
  readonly counts: {
    readonly roomsCreated: number
    readonly roomsReused: number
    readonly plannedMessages: number
    readonly sent: number
    readonly replayed: number
    readonly preexisting: number
    readonly skippedByReason: Readonly<Record<string, number>>
  }
  readonly skips: readonly SkippedMessage[]
  readonly gaps: readonly { readonly kind: string; readonly detail: string }[]
  readonly messages: readonly MigratedMessageResult[]
}

/* ------------------------------------------------------------------ */
/* 迁移核心                                                            */
/* ------------------------------------------------------------------ */

export interface MigrateOutcome {
  readonly report: MigrateReport
  readonly reportPath: string
  readonly workdir: string
  readonly cleanup: boolean
}

export async function runMigrate(options: { exportPath: string; explicitActors: Readonly<Record<string, string>>; mode: 'temp' | 'external'; socketPath: string | undefined; token: string | undefined; workdir: string | undefined; cleanup: boolean }): Promise<MigrateOutcome> {
  const startedAt = Date.now()
  const exported = loadMatrixExport(options.exportPath)
  const exportText = readFileSync(options.exportPath, 'utf8')

  const mxids = new Set<string>()
  for (const room of exported.rooms) {
    for (const m of room.members ?? []) mxids.add(m)
    for (const msg of room.messages) {
      mxids.add(msg.sender)
      for (const u of msg.mentions) mxids.add(u)
    }
  }
  const actorMap = buildActorMap([...mxids].sort(), options.explicitActors)
  const plans = buildRoomPlans(exported, actorMap)

  // 工作目录（temp 模式）：mkdtemp；报告路径随目录
  const workdir = options.mode === 'temp'
    ? options.workdir !== undefined && options.workdir !== '' ? options.workdir : mkdtempSync(path.join(tmpdir(), 'mx-migrate-'))
    : path.dirname(options.exportPath)
  const reportPath = path.join(workdir, 'migrate-report.json')
  if (options.mode === 'temp' && options.workdir !== undefined && options.workdir !== '') mkdirSync(options.workdir, { recursive: true })

  let handle: ChatdHandle | undefined
  let socketPath: string
  let token: string
  if (options.mode === 'temp') {
    handle = await startTempChatd(workdir)
    socketPath = handle.socketPath
    token = handle.token
  } else {
    if (options.socketPath === undefined || options.token === undefined) throw new UsageError('external 模式需 --socket 与 --token')
    socketPath = options.socketPath
    token = options.token
  }

  const transport = new WorkbenchTransport({ socketPath, requestTimeoutMs: CLIENT_REQUEST_TIMEOUT_MS })
  const c = authedClient(transport, token)
  const gaps: { kind: string; detail: string }[] = []
  try {
    const health = await callWithRetry(() => c.health(), 'health')
    const existingRooms = await callWithRetry(() => c.listRooms(), 'rooms.list')
    const byName = new Map(existingRooms.map((room) => [room.name, room]))

    const roomResults: (MigrateReport['rooms'][number])[] = []
    const messageResults: MigratedMessageResult[] = []
    const skippedAll: SkippedMessage[] = []
    let roomsCreated = 0
    let roomsReused = 0

    for (const plan of plans) {
      const existing = byName.get(plan.chatdName)
      let chatdRoomId: string
      let foreignSeen = 0
      if (existing === undefined) {
        const created = await callWithRetry(() => c.createRoom({ kind: 'group', name: plan.chatdName, memberIds: plan.memberActors }), `rooms.create ${plan.chatdName}`)
        chatdRoomId = created.roomId
        roomsCreated++
      } else {
        chatdRoomId = existing.roomId
        roomsReused++
      }

      // L3 预检：扫房内既有消息标签（协议窗口=最旧 200 条/房；超出依赖 L2 idempotencyKey replay）
      const preexisting = new Set<string>()
      const listingActor = existing?.memberIds[0] ?? plan.memberActors[0] ?? 'migration-sentinel'
      const page = await callWithRetry(() => c.listMessages({ roomId: chatdRoomId, actorId: listingActor, limit: 200 }), `messages.list ${plan.chatdName}`)
      for (const item of page.items) {
        const tag = parseTag(item.body)
        if (tag === null) foreignSeen++ // 无标签=迁移外消息（双跑窗口新消息等）——如实计数不判 gap
        else preexisting.add(tag.eventId)
      }

      let sent = 0
      let replayed = 0
      let preexistingCount = 0
      for (const msg of plan.planned) {
        if (preexisting.has(msg.eventId)) {
          preexistingCount++
          messageResults.push({ eventId: msg.eventId, roomId: msg.roomId, chatdRoomId, actor: msg.actor, ts: msg.ts, status: 'preexisting', messageId: null })
          continue
        }
        const result = await callWithRetry(() => c.sendMessage({ roomId: chatdRoomId, senderId: msg.actor, body: msg.taggedBody, mentions: msg.mentions, idempotencyKey: msg.idempotencyKey }), `messages.send ${msg.eventId}`)
        if (result.replayed) {
          replayed++
          messageResults.push({ eventId: msg.eventId, roomId: msg.roomId, chatdRoomId, actor: msg.actor, ts: msg.ts, status: 'replayed', messageId: result.messageId })
        } else {
          sent++
          messageResults.push({ eventId: msg.eventId, roomId: msg.roomId, chatdRoomId, actor: msg.actor, ts: msg.ts, status: 'sent', messageId: result.messageId })
        }
      }
      skippedAll.push(...plan.skipped)
      roomResults.push({
        matrixRoomId: plan.matrixRoomId,
        chatdRoomId,
        chatdName: plan.chatdName,
        topic: plan.topic,
        memberCount: plan.memberActors.length,
        planned: plan.planned.length,
        sent,
        replayed,
        preexisting: preexistingCount,
        skipped: plan.skipped.length,
        foreignSeen,
      })
    }

    // 收口断言（0 漏/0 重复的迁移器侧闸门；对账器为独立第二道）：
    // 每房 headRoomSeq == 本轮 planned - preexisting + 迁移前既有消息数（foreign+旧标签）。
    const afterRooms = await callWithRetry(() => c.listRooms(), 'rooms.list(收口)')
    const afterById = new Map(afterRooms.map((room) => [room.roomId, room]))
    for (const room of roomResults) {
      const after = afterById.get(room.chatdRoomId)
      if (after === undefined) {
        gaps.push({ kind: 'room-vanished', detail: `chatd 房 ${room.chatdName}（${room.chatdRoomId}）收口时不存在` })
        continue
      }
      const expected = room.sent + room.replayed + room.preexisting + room.foreignSeen
      if (after.headRoomSeq !== expected) {
        gaps.push({ kind: 'head-room-seq-mismatch', detail: `房 ${room.chatdName}：headRoomSeq=${String(after.headRoomSeq)} ≠ 预期 ${String(expected)}（sent=${String(room.sent)} replayed=${String(room.replayed)} preexisting=${String(room.preexisting)} foreign=${String(room.foreignSeen)}）` })
      }
    }
    const plannedTotal = roomResults.reduce((sum, room) => sum + room.planned, 0)
    const accountedTotal = roomResults.reduce((sum, room) => sum + room.sent + room.replayed + room.preexisting + room.skipped, 0)
    if (accountedTotal !== plannedTotal + skippedAll.length) {
      gaps.push({ kind: 'accounting-mismatch', detail: `消息记账不平：accounted=${String(accountedTotal)} ≠ planned+skipped=${String(plannedTotal + skippedAll.length)}` })
    }

    const skippedByReason: Record<string, number> = {}
    for (const skip of skippedAll) skippedByReason[skip.reason] = (skippedByReason[skip.reason] ?? 0) + 1
    const report: MigrateReport = {
      schema: REPORT_SCHEMA,
      exportSchema: EXPORT_SCHEMA,
      exportSha256: sha256FileBytes(exportText),
      startedAt,
      finishedAt: Date.now(),
      target: { mode: options.mode, socketPath, dbPath: handle?.dbPath ?? null, chatdServer: health.server },
      actorMap: Object.fromEntries([...actorMap.entries()].map(([mxid, decision]) => [mxid, decision])),
      rooms: roomResults,
      counts: {
        roomsCreated,
        roomsReused,
        plannedMessages: plannedTotal,
        sent: roomResults.reduce((sum, room) => sum + room.sent, 0),
        replayed: roomResults.reduce((sum, room) => sum + room.replayed, 0),
        preexisting: roomResults.reduce((sum, room) => sum + room.preexisting, 0),
        skippedByReason,
      },
      skips: skippedAll,
      gaps,
      messages: messageResults,
    }
    c.close()
    if (handle !== undefined) await handle.stop()
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    if (gaps.length > 0) throw new MigrateError(`迁移收口断言失败（${String(gaps.length)} 条 gap，详见报告 ${reportPath}）：${gaps[0]?.detail}`)
    return { report, reportPath, workdir, cleanup: options.cleanup }
  } catch (err) {
    c.close()
    if (handle !== undefined) await handle.stop()
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = '用法：node scripts/matrix-to-chatd-migrate.ts --export <matrix-export.json> [--actors <mapping.json>] [--workdir <dir>] [--cleanup]\n' +
  '      或（切流日指向运行中实例）：node scripts/matrix-to-chatd-migrate.ts --export <json> --socket <path> --token <tok>'

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function migrateCliArgs(argv: readonly string[]): { exportPath: string; actorsPath: string | undefined; socketPath: string | undefined; token: string | undefined; workdir: string | undefined; cleanup: boolean; mode: 'temp' | 'external' } {
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
  const actorsPath = valueOf('--actors')
  const socketPath = valueOf('--socket')
  const token = valueOf('--token')
  const workdir = valueOf('--workdir')
  const cleanupIndex = args.indexOf('--cleanup')
  const cleanup = cleanupIndex >= 0
  if (cleanup) args.splice(cleanupIndex, 1)
  if (args.some((a) => a === '--help' || a === '-h')) throw new UsageError(USAGE)
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)
  if (exportPath === undefined) throw new UsageError(`缺少 --export；${USAGE}`)
  const mode: 'temp' | 'external' = socketPath !== undefined || token !== undefined ? 'external' : 'temp'
  if (mode === 'external' && (socketPath === undefined || token === undefined)) throw new UsageError(`external 模式需同时给 --socket 与 --token；${USAGE}`)
  if (mode === 'external' && workdir !== undefined) throw new UsageError(`external 模式不管理进程，不支持 --workdir；${USAGE}`)
  return { exportPath, actorsPath, socketPath, token, workdir, cleanup, mode }
}

async function main(): Promise<void> {
  const options = migrateCliArgs(process.argv.slice(2))
  const explicitActors = options.actorsPath !== undefined ? loadActorsFile(options.actorsPath) : {}
  const outcome = await runMigrate({
    exportPath: options.exportPath,
    explicitActors,
    mode: options.mode,
    socketPath: options.socketPath,
    token: options.token,
    workdir: options.workdir,
    cleanup: options.cleanup,
  })
  const r = outcome.report
  const summary = {
    ok: true,
    mode: r.target.mode,
    export: options.exportPath,
    report: outcome.reportPath,
    workdir: outcome.cleanup ? '(--cleanup 已清)' : outcome.workdir,
    db: outcome.cleanup ? null : r.target.dbPath,
    socket: r.target.socketPath,
    chatdServer: r.target.chatdServer,
    rooms: { created: r.counts.roomsCreated, reused: r.counts.roomsReused },
    messages: { planned: r.counts.plannedMessages, sent: r.counts.sent, replayed: r.counts.replayed, preexisting: r.counts.preexisting },
    skipped: r.counts.skippedByReason,
    unmappedVerbatimActors: Object.values(r.actorMap).filter((d) => d.rule === 'verbatim-mxid').length,
    gaps: r.gaps.length,
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  if (outcome.cleanup) rmSync(outcome.workdir, { recursive: true, force: true })
}

if (isDirectRun()) {
  main()
    .then(() => { process.exitCode = 0 })
    .catch((err: unknown) => {
      if (err instanceof UsageError) {
        console.error(`[matrix-to-chatd-migrate] ${err.message}`)
        process.exit(2)
      }
      console.error(`[matrix-to-chatd-migrate] ${err instanceof MigrateError ? err.message : String(err)}`)
      process.exit(1)
    })
}
