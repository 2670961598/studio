/**
 * chatd-mention-source —— workbench-chatd 唤起源（M3 接线第一阶段 · 模块 D 最小刀，team task-133）
 *
 * 依据：docs/plan/07-边界提案-workbench-transport与chatd入表-2026-11-19.md §五（模块 D
 * 接口清单；提案 A 制作人已批=本刀前提，§2.1 两条包间边已入 boundary-rules.mjs）、
 * docs/plan/06-自研单子与聊天室切换-2026-11-19.md:28（M3）。
 *
 * 形态对齐既有 InvokeSource 形态（packages/contract/src/ports/gate.ts:248-253；
 * matrix 源判例 packages/matrix/src/adapter.ts:73-152）：
 *   - createChatdMentionSource(options) → InvokeSource：start(emit) 起
 *     inbox→claim→emit→ack 轮询循环（对 actors 在册工号逐 actor 收 inbox）；stop() 清
 *     setTimeout 链 + 关 transport，在途 poll 返回后不再调度/不再 emit，不留孤儿定时器。
 *   - 节奏默认 pollMs=3000（matrix 判例 adapter.ts:74）；出错指数翻倍封顶 maxBackoffMs=60s、
 *     成功复位（adapter.ts:130-133 同款曲线）；传输超时=所建 WorkbenchTransport 的
 *     requestTimeoutMs（缺省 2000，client.ts:37）。
 *   - 首拉只建基线：启动时已在 inbox 的 pending wake 不唤起（历史不当唤起，防重放——
 *     matrix「首拉建基线」同语义）；此后新出现的 wake 才 claim。
 *   - 恰一次：emit 返回后即 wakes.ack（alreadyAcked 幂等吸收）；未 ack（崩溃/ack 失败）→
 *     chatd 租约过期重投（attempt+1≤3）→ 源按同键 `wake:<wakeId>` 重发意图 → 引擎按
 *     (source,kind,company,dedupKey) 幂等折叠（gate.ts:244-245）；超限 dead-letter 终态。
 *   - payload 与 daemon 消费闸 MentionIntentPayload 同形（engine/intents/taxonomy.ts:59-67
 *     checkMentionPayload 过闸才 emit）：target=wake.actorId、mention='@'+工号、
 *     text=消息 body、eventId=`${roomId}/${sourceSeq}`、sender、room、channel=房间名。
 *   - emit 只产意图绝不直驱 worker（docs/22 铁律）；emit 抛错源自身捕获不中断轮询
 *     （docs/25-§3.4.5 源侧契约；不 ack——保守面，靠重投+引擎幂等收口）。
 *
 * 错误分类（WB_* → 可读分类，提案 §5.3；docs/17:331-335 分类枚举的源侧软失败面）：
 *   - WB_TIMEOUT/WB_UNAVAILABLE/WB_NOT_CONNECTED（retryable）→ 传输面：软失败计数+退避；
 *   - WB_INVALID_ARGUMENT（含 unauthenticated: 前缀）→ 配置面：计数+明报（装配期应由
 *     组装单元 CONFIG_INVALID 拒启——本刀不接装配，运行期只明报不中断）；
 *   - WB_PROTOCOL/WB_INTERNAL → 源缺陷：计数+明报；
 *   - WB_IDEMPOTENCY_CONFLICT → 以 chatd 审计 wake_events 为准：计数+跳过不重试；
 *   - WB_ROOM/MESSAGE/WAKE_NOT_FOUND、WB_WAKE_NOT_CLAIMABLE（含 dead-letter 终态）→
 *     对象缺失/终态：软失败计数+日志。
 *
 * 配置开关（提案 §5.4，**默认 matrix 不动生产现状**）：mentionSourceKindOf(raw) 把
 * daemon.yaml 的 mentionSource 值解析为 'matrix'|'chatd'，缺省='matrix'（chatd 默认
 * 关闭）；非法值 CONFIG_INVALID 明报。M4-1（team task-136）已接装配：本文件同时持有
 * 配置收口（coerceChatdServeKey/validateChatdMentionCross——config.ts switch/尾段收口到此）
 * 与注册面（wireChatdMentionSource——runtime.ts 在 mentionSource: chatd 时装配注入工厂；
 * 组合根 apps/boot 构造本源产物经 opts.chatdSource 注入，不启动 chatd 进程——独立 ops/launchd）。
 */
import type { CompanySlug, InvokeIntent, InvokeSource, PersonId, SourceManifest } from '@studio-next/contract'
import { WB_ERROR_CODES, WorkbenchTransport } from '@studio-next/workbench-transport'
import type { AckResult, ClaimResult, InboxResult, MessagePage, Room } from '@studio-next/workbench-transport'
import { isAbsolute, join, resolve } from 'node:path'
import { checkMentionPayload } from '../../engine/intents/taxonomy.ts'
import type { ServeConfig } from './config-types.ts'

/** 唤醒源名（InvokeIntent.source 的固定值；与 matrix 源 'matrix' 命名判例同构） */
export const CHATD_MENTION_SOURCE_NAME = 'chatd'

// ————————————————————————— 配置开关（默认 matrix；M4-1 起接线） —————————————————————————

/** daemon.yaml `mentionSource` 取值域（提案 §5.4：缺省 matrix——chatd 默认关闭） */
export type MentionSourceKind = 'matrix' | 'chatd'

export const DEFAULT_MENTION_SOURCE_KIND: MentionSourceKind = 'matrix'

/**
 * 解析 mentionSource 配置值：缺省/空 → 'matrix'（生产现状不动）；'matrix'|'chatd' 原样；
 * 其余 → CONFIG_INVALID 明报（不静默回落——开关拼错必须炸出来，fail-closed）。
 */
export function mentionSourceKindOf(raw: unknown): MentionSourceKind {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MENTION_SOURCE_KIND
  if (raw === 'matrix' || raw === 'chatd') return raw
  throw new Error(`CONFIG_INVALID：mentionSource 须为 matrix|chatd（缺省 matrix——chatd 默认关闭），实得 ${String(raw)}`)
}

// ————————————————————————— 传输端口（结构同形；@studio-next/workbench-transport 直连） —————————————————————————

/**
 * 源所需的 transport 最小面（WorkbenchTransport 结构满足——方法双变下 token 附加形参
 * 可传入：真实 client 把 params 原样序列化上帧，服务端 params.token 常时比较恰好收到；
 * 注入面留给测试 mock 与组装单元，本源不感知 socket 细节）。
 */
export interface ChatdTransportPort {
  inbox(input: { actorId: string; roomIds?: readonly string[]; token?: string }): Promise<InboxResult>
  claimWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string; token?: string }): Promise<ClaimResult>
  ackWakes(input: { actorId: string; wakeIds: readonly string[]; idempotencyKey?: string; token?: string }): Promise<AckResult>
  listMessages(input: { roomId: string; actorId: string; limit?: number; cursor?: string; token?: string }): Promise<MessagePage>
  listRooms(input: { token?: string }): Promise<readonly Room[]>
  /** 幂等关闭（client.ts:87-92 同款语义；stop() 收口调用） */
  close(): void
}

/** chatd 唤起源选项（对齐提案 §5.1 options；transport 注入或缺省按 socketPath 自建） */
export interface ChatdMentionSourceOptions {
  readonly company: CompanySlug
  /** roster 在册工号（每拍逐 actor 收 inbox；空数组=面开零行为） */
  readonly actors: readonly PersonId[]
  /** 收敛房间白名单（roomId；缺省=全部房间——inbox roomIds 透传，提案 §5.1 rooms?） */
  readonly rooms?: readonly string[]
  /** Unix socket 路径（chatd 生产约定 <companyDir>/var/workbench/chat.sock） */
  readonly socketPath: string
  /** 传输客户端注入面（测试 mock/组装复用）；缺省按 socketPath 自建 WorkbenchTransport */
  readonly transport?: ChatdTransportPort
  /** 鉴权 token（值经 env WORKBENCH_CHATD_TOKEN 由组装单元供给；永不入 yaml/日志/台账） */
  readonly token?: string
  /** 轮询间隔，默认 3000ms（matrix 判例） */
  readonly pollMs?: number
  /** 退避上限，默认 60000ms */
  readonly maxBackoffMs?: number
  /** 自建 transport 的请求超时，默认 2000ms（client.ts:37） */
  readonly requestTimeoutMs?: number
  /** 自建 transport 的连接超时，默认 1000ms（client.ts:36） */
  readonly connectTimeoutMs?: number
  /** 定位源消息的 messages.limit 窗口（1..200，默认 200——服务端上限内取最大窗） */
  readonly messageLimit?: number
  /** 日志出口（缺省 console.log；行均带 [chatd] 前缀——提案 §5.6） */
  readonly log?: (line: string) => void
}

// ————————————————————————— 错误分类（WB_* → 可读分类，提案 §5.3） —————————————————————————

const WB_CODES = new Set<string>(WB_ERROR_CODES)

/** 源侧错误分类（分类面=处置语义；具体处置计数/日志归轮询循环） */
export type ChatdErrorKind = 'transport' | 'config' | 'defect' | 'conflict' | 'gone' | 'unknown'

export interface ChatdSourceError {
  readonly kind: ChatdErrorKind
  readonly code: string
  readonly readable: string
}

/** WB_* 稳定码 → 可读分类（非 WB_* 错误归 unknown，同走软失败面不炸循环） */
export function classifyChatdError(err: unknown): ChatdSourceError {
  const code = (err as { code?: unknown } | null | undefined)?.code
  const message = err instanceof Error ? err.message : String(err)
  if (typeof code !== 'string' || !WB_CODES.has(code)) {
    return { kind: 'unknown', code: 'UNKNOWN', readable: `未分类错误：${message}` }
  }
  switch (code) {
    case 'WB_TIMEOUT':
    case 'WB_UNAVAILABLE':
    case 'WB_NOT_CONNECTED':
      return { kind: 'transport', code, readable: `传输面（${code}，可重试）：${message}` }
    case 'WB_INVALID_ARGUMENT':
      return {
        kind: 'config',
        code,
        readable: message.startsWith('unauthenticated:')
          ? `配置面（${code} 鉴权失败——token 缺失/不符，检查 env WORKBENCH_CHATD_TOKEN 供给）：${message}`
          : `配置面（${code} 参数缺陷——socket/token/工号拼参明报）：${message}`,
      }
    case 'WB_PROTOCOL':
    case 'WB_INTERNAL':
      return { kind: 'defect', code, readable: `源缺陷（${code}）：${message}` }
    case 'WB_IDEMPOTENCY_CONFLICT':
      return { kind: 'conflict', code, readable: `幂等冲突（${code}，以 chatd 审计为准，跳过不重试）：${message}` }
    default: // WB_ROOM/MESSAGE/WAKE_NOT_FOUND、WB_WAKE_NOT_CLAIMABLE（含 dead-letter 终态）
      return { kind: 'gone', code, readable: `对象缺失/终态（${code}，软失败跳过）：${message}` }
  }
}

// ————————————————————————— 源实现 —————————————————————————

/**
 * chatd @唤醒源：inbox→claim→emit→ack 循环（只产意图，绝不直接驱动 worker——docs/22 铁律）。
 * 默认关闭：本工厂只被组装单元在 mentionSource:'chatd' 时调用（缺省 matrix 走既有源）。
 */
export function createChatdMentionSource(options: ChatdMentionSourceOptions): InvokeSource {
  const pollMs = options.pollMs ?? 3_000
  const maxBackoffMs = options.maxBackoffMs ?? 60_000
  const messageLimit = Math.min(200, Math.max(1, options.messageLimit ?? 200))
  const log = options.log ?? ((line: string): void => { console.log(line) })
  const auth = options.token !== undefined ? { token: options.token } : {}
  const roomScope = options.rooms !== undefined ? { roomIds: [...options.rooms] } : {}
  // transport 注入优先（测试/组装复用）；缺省自建——连接惰性（首请求才 connect，client.ts:94-120）
  const owned = options.transport === undefined
  const transport: ChatdTransportPort =
    options.transport ??
    new WorkbenchTransport({
      socketPath: options.socketPath,
      ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
      ...(options.connectTimeoutMs !== undefined ? { connectTimeoutMs: options.connectTimeoutMs } : {}),
    })

  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let delayMs = pollMs
  let tick = 0
  let consecutiveFails = 0
  /** 首/基线纪律：actor 首次成功 inbox 时记录既有 pending（历史不当唤起） */
  const baselines = new Map<string, Set<string>>()

  function noteError(err: unknown, phase: string): void {
    consecutiveFails += 1
    const c = classifyChatdError(err)
    log(`[chatd] 源软失败（${phase}，分类=${c.kind}，连续=${String(consecutiveFails)}，退避=${String(delayMs)}→${String(Math.min(delayMs * 2, maxBackoffMs))}ms）：${c.readable}`)
  }

  function schedule(emit: (intent: InvokeIntent) => void): void {
    if (!running) return
    timer = setTimeout(() => {
      void poll(emit)
    }, delayMs)
  }

  /** 本拍房间名册（channel=房间名；仅确有 wake 要组 payload 的拍才拉） */
  async function roomNames(): Promise<Map<string, string>> {
    const rooms = await transport.listRooms({ ...auth })
    const names = new Map<string, string>()
    for (const room of rooms) names.set(room.roomId, room.name)
    return names
  }

  /** 逐 wake：定位源消息 → 组 payload 过结构闸 → emit → ack（任一环失败=该 wake 软失败，不 ack 靠重投） */
  async function processWake(
    emit: (intent: InvokeIntent) => void,
    actor: string,
    roomId: string,
    wakeId: string,
    sourceSeq: number,
    channel: string,
  ): Promise<boolean> {
    const page = await transport.listMessages({ roomId, actorId: actor, limit: messageLimit, ...auth })
    if (!running) return false
    const message = page.items.find((m) => m.roomSeq === sourceSeq)
    if (message === undefined) {
      log(`[chatd] wake ${wakeId} 源消息缺失（roomSeq=${String(sourceSeq)} 窗口=${String(messageLimit)}）——跳过不 ack，租约过期重投≤3 后 dead-letter`)
      return false
    }
    const payload = {
      target: actor,
      mention: `@${actor}`,
      text: message.body,
      eventId: `${roomId}/${String(sourceSeq)}`,
      sender: message.senderId,
      room: roomId,
      channel,
    }
    const gate = checkMentionPayload(payload)
    if (typeof gate === 'string') {
      log(`[chatd] wake ${wakeId} payload 结构闸不过（${gate}）——跳过不 ack`)
      return false
    }
    try {
      emit({ kind: 'mention', company: options.company, source: CHATD_MENTION_SOURCE_NAME, dedupKey: `wake:${wakeId}`, payload: gate })
    } catch (err) {
      // 源侧契约（25-§3.4.5）：emit 抛错自身捕获不中断轮询；不 ack——保守面，重投+引擎幂等收口
      log(`[chatd] wake ${wakeId} emit 抛错（源侧捕获不中断轮询）：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
    await transport.ackWakes({ actorId: actor, wakeIds: [wakeId], idempotencyKey: `wake:${wakeId}`, ...auth })
    return true
  }

  async function poll(emit: (intent: InvokeIntent) => void): Promise<void> {
    if (!running) return
    let failed = false
    tick += 1
    try {
      for (const actor of options.actors) {
        if (!running) return
        const inbox = await transport.inbox({ actorId: actor, ...roomScope, ...auth })
        if (!running) return // stop() 在在途请求期间到达：丢弃结果
        let baseline = baselines.get(actor)
        if (baseline === undefined) {
          baseline = new Set<string>(inbox.pendingWakeIds)
          baselines.set(actor, baseline)
          if (inbox.pendingWakeIds.length > 0) log(`[chatd] ${actor} 首拉建基线：既有 pending ${String(inbox.pendingWakeIds.length)} 条不唤起（防重放）`)
          continue
        }
        const fresh = inbox.pendingWakeIds.filter((id) => !baseline.has(id))
        if (fresh.length === 0) continue
        const claim = await transport.claimWakes({ actorId: actor, wakeIds: fresh, idempotencyKey: `${actor}|tick:${String(tick)}`, ...auth })
        if (!running) return
        const names = await roomNames()
        if (!running) return
        let acked = 0
        for (const wake of claim.wakes) {
          if (!running) return
          try {
            if (await processWake(emit, actor, wake.roomId, wake.wakeId, wake.sourceSeq, names.get(wake.roomId) ?? wake.roomId)) acked += 1
          } catch (err) {
            failed = true // 单 wake 失败隔离：计数明报，不炸同拍其余 wake（行级隔离，watch-file 判例）
            noteError(err, `wake ${wake.wakeId}`)
          }
        }
        log(`[chatd] ${actor} 本拍 claim ${String(claim.claimed.length)}（alreadyClaimed ${String(claim.alreadyClaimed.length)}）→ emit+ack ${String(acked)}/${String(claim.wakes.length)}`)
      }
    } catch (err) {
      failed = true // inbox/claim/rooms 面失败：整拍软失败（对基线无副作用——已建基线不回退）
      noteError(err, `poll#${String(tick)}`)
    }
    if (!running) return
    delayMs = failed ? Math.min(delayMs * 2, maxBackoffMs) : pollMs // 出错翻倍封顶，成功复位
    if (!failed) consecutiveFails = 0
    schedule(emit)
  }

  return {
    name: CHATD_MENTION_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      delayMs = pollMs
      log(`[chatd] 唤起源启动（pollMs=${String(pollMs)} maxBackoffMs=${String(maxBackoffMs)} actors=${String(options.actors.length)}${owned ? '' : ' transport=注入'}）`)
      void poll(emit) // 首拉立即出发（建基线）
    },
    stop(): void {
      if (!running && timer === undefined) return
      running = false
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      transport.close() // 幂等（client.ts:87-92 同款）；在途 poll 返回后因 !running 不再调度/不再 emit
      log('[chatd] 唤起源已停（定时器已清、transport 已关，在途 poll 丢弃结果）')
    },
  }
}

// ————————————————————————— 配置收口 + 注册面（M4-1 接线，team task-136） —————————————————————————

/** serveconfig 值收口助手（config.ts 扁平解析面的 str/num 同形——保持本件与解析件解耦的单孔） */
export interface ChatdServeKeyHelpers {
  readonly str: (value: unknown, key: string) => string
  readonly num: (value: unknown, key: string) => number
}

/**
 * chatd 唤起源键解析（config.ts switch 显式 case 收口到此；缺省/交叉校验分离——缺省推导
 * 要看 companyDir，属尾段交叉面）：
 *   - mentionSource：mentionSourceKindOf 值域校验（缺省 matrix、非法 CONFIG_INVALID）；
 *   - chatdSocket：显式配置须绝对路径（相对=CONFIG_INVALID——socket 定位不许含糊）；
 *   - mentionPollMs：正整数毫秒（0/负=CONFIG_INVALID——busy-loop 面直接拒启不兜底）。
 */
export function coerceChatdServeKey(cfg: ServeConfig, key: string, value: unknown, helpers: ChatdServeKeyHelpers): void {
  if (key === 'mentionSource') {
    cfg.mentionSource = mentionSourceKindOf(helpers.str(value, key))
    return
  }
  if (key === 'chatdSocket') {
    const v = helpers.str(value, key)
    if (!isAbsolute(v)) {
      throw new Error(`daemon.yaml：chatdSocket 须为绝对路径（生产约定 <companyDir>/var/workbench/chat.sock；实得 ${v}）`)
    }
    cfg.chatdSocket = v
    return
  }
  const v = helpers.num(value, key)
  if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：mentionPollMs 须为正整数毫秒（实得 ${v}）`)
  cfg.mentionPollMs = v
}

/**
 * chatd 唤起源交叉校验（parseDaemonConfig 尾段调用；matrix 必配键交叉之后的收口位）：
 *   - 与 matrix: true 互斥——双唤起源=双写（mention 幂等键第一槽 source 不同，引擎折叠
 *     不了；M4 双跑走影子工具不走配置双开，docs/plan/06-…-2026-11-19.md §M4）；
 *   - chatdSocket 缺省推导 `<companyDir>/var/workbench/chat.sock`（提案 §5.1 生产约定）；
 *     无 companyDir 又未显式配=CONFIG_INVALID（不猜 cwd 相对路径）。
 * mentionSource: matrix（缺省）零交叉零推导——既有路径行为零漂移。
 */
export function validateChatdMentionCross(cfg: ServeConfig): void {
  if (cfg.mentionSource !== 'chatd') return
  if (cfg.matrix) {
    throw new Error('CONFIG_INVALID：mentionSource: chatd 与 matrix: true 互斥（双唤起源=双写；M4 双跑走影子工具不走配置双开）')
  }
  if (cfg.chatdSocket === undefined) {
    if (cfg.companyDir === undefined) {
      throw new Error('CONFIG_INVALID：mentionSource: chatd 缺 chatdSocket 且无 companyDir 可推导缺省（<companyDir>/var/workbench/chat.sock）——显式配绝对路径')
    }
    cfg.chatdSocket = join(resolve(cfg.companyDir), 'var/workbench/chat.sock')
  }
}

/** chatd 源注册面所需的最小注册表形状（SourceRegistry 结构满足——同结构同形注入纪律） */
export interface ChatdSourceRegistry {
  register(source: InvokeSource, manifest?: SourceManifest): void
}

/**
 * chatd 源工厂（组合根注入面，M4-1 task-136）：ctx.actors=roster 在册工号——由
 * buildServeRuntime 在公司快照在场处回调供给（boot 不持快照；matrixRoomFace ctx 判例）。
 */
export type ChatdSourceFactory = (ctx: { actors: readonly PersonId[] }) => InvokeSource

/** chatd 源 manifest（mentionSource: chatd 时注册；configSchema=配置面锚点单一描述位） */
export const CHATD_SOURCE_MANIFEST: SourceManifest = {
  name: CHATD_MENTION_SOURCE_NAME,
  kind: 'mention',
  configSchema: 'daemon.yaml mentionSource/chatdSocket/mentionPollMs（扁平子集）＋env WORKBENCH_CHATD_TOKEN（值不入 yaml）',
}

/**
 * chatd 源注册（buildServeRuntime 装配段调用，M4-1 task-136）：mentionSource: chatd 时由
 * 组合根注入工厂装配——开而未注入=CONFIG_INVALID 拒启（matrix 判例 runtime.ts 同纪律）；
 * actors=公司快照在册工号。daemon **不启动 chatd 进程**（独立 ops/launchd 运维）——
 * socket 不在=源软失败退避（WB_NOT_CONNECTED 分类=transport），不拒启不炸主循环。
 */
export function wireChatdMentionSource(sources: ChatdSourceRegistry, factory: ChatdSourceFactory | undefined, actors: readonly PersonId[]): void {
  if (factory === undefined) {
    throw new Error(
      'CONFIG_INVALID：mentionSource: chatd 需注入 chatd 源工厂（runServe/buildServeRuntime opts.chatdSource）——' +
        'daemon 不启动 chatd 进程（独立 ops/launchd 运维）；装配单元 apps/boot 组合根注入 ' +
        'createChatdMentionSource 产物（M4-1 task-136；docs/plan/07-…-2026-11-19.md §5.1）',
    )
  }
  sources.register(factory({ actors }), CHATD_SOURCE_MANIFEST)
}
