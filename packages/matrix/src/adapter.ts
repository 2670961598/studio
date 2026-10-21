/**
 * adapter —— 组装两件套（协议依据 docs/25-§3.4 invoke、§4.2 notifier；docs/21-§四 @唤醒）
 *
 *   createMatrixNotifier(client)  → Notifier：send → formatNotification → client.sendMessage
 *   createMentionSource(options)  → InvokeSource：start(emit) 轮询 sync，新消息过
 *                                   parseMentions 产 mention 意图 emit；stop() 干净停轮询
 *
 * 轮询纪律：
 *   - 节奏默认 3000ms；出错指数退避（翻倍、上限 maxBackoffMs=60s、成功复位）
 *   - 空闲期长轮询（105-刀A A-4）：增量 sync 带 timeout=syncTimeoutMs（默认 25000ms，
 *     服务器无事件时挂连接到超时再返——省掉空转往返；首拉建基线 timeout=0）。
 *     长轮询只改请求参数，节奏与退避语义不变（判负线⑥：429 礼让收在 client 层，
 *     不动本层退避曲线）
 *   - 首次 sync 只建基线（拿 next_batch），历史消息不当唤起（防重放）
 *   - 自发消息（selfUserId）不产意图（防 bot 回声环）；m.mentions 命中 bot 同样不算
 *   - stop()：清 setTimeout 链 + 在途 poll 返回后不再调度/不再 emit，不留孤儿定时器
 */
import type {
  CompanySlug,
  InvokeIntent,
  InvokeSource,
  Notification,
  Notifier,
  PersonId,
} from '@studio-next/contract'
import { MatrixClient } from './client.ts'
import { formatNotification } from './format.ts'
import {
  MENTION_SOURCE_NAME,
  extractRoomMessages,
  parseMentions,
  type MentionParserConfig,
} from './mentions.ts'

/** 通知出口：channel 语义 = room_id（v0.1 不做 alias→room_id 解析，README 留痕） */
export function createMatrixNotifier(client: MatrixClient): Notifier {
  return {
    async send(channel: string, message: Notification): Promise<void> {
      await client.sendMessage(channel, formatNotification(message))
    },
  }
}

export interface MentionSourceOptions {
  client: MatrixClient
  company: CompanySlug
  /** 本源的 Matrix 身份（网关 bot user_id）：自发消息不产唤起，防回声 */
  selfUserId: string
  /** 监听房间白名单（room_id）；缺省=该账号可见的全部已加入房间 */
  rooms?: readonly string[]
  /** 角色词 → 工号 映射（@宰相/@制作人…） */
  roles?: Readonly<Record<string, PersonId>>
  /** 轮询间隔，默认 3000ms（sync 返回后到下一次 sync 的间隔；空闲唤醒延迟≈本值） */
  pollIntervalMs?: number
  /** 增量 sync 长轮询超时，默认 25000ms；基线拉取恒为 0（即刻返回） */
  syncTimeoutMs?: number
  /** 退避上限，默认 60000ms */
  maxBackoffMs?: number
  /** 工号识别样式（默认 DEFAULT_AGENT_ID_PATTERN） */
  agentIdPattern?: RegExp
}

/** @唤醒源：只产意图，绝不直接驱动 worker（docs/22 铁律） */
export function createMentionSource(options: MentionSourceOptions): InvokeSource {
  const pollIntervalMs = options.pollIntervalMs ?? 3000
  const syncTimeoutMs = options.syncTimeoutMs ?? 25_000
  const maxBackoffMs = options.maxBackoffMs ?? 60_000
  const parserConfig: MentionParserConfig = {
    company: options.company,
    ...(options.roles !== undefined ? { roles: options.roles } : {}),
    ...(options.agentIdPattern !== undefined ? { agentIdPattern: options.agentIdPattern } : {}),
    ...(options.selfUserId !== undefined ? { selfUserId: options.selfUserId } : {}),
  }
  const allowedRooms = options.rooms !== undefined ? new Set(options.rooms) : undefined

  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let since: string | undefined
  let baselineReady = false
  let delayMs = pollIntervalMs

  function schedule(emit: (intent: InvokeIntent) => void): void {
    if (!running) return
    timer = setTimeout(() => {
      void poll(emit)
    }, delayMs)
  }

  async function poll(emit: (intent: InvokeIntent) => void): Promise<void> {
    if (!running) return
    try {
      // 基线拉取（since 为空）即刻返回；增量走长轮询（timeout=syncTimeoutMs，空闲期
      // 服务器挂连接到超时——节奏仍由 pollIntervalMs 掌控，语义不变）
      const sync = await options.client.sync(since, since === undefined ? 0 : syncTimeoutMs)
      if (!running) return // stop() 在在途请求期间到达：丢弃结果
      since = sync.next_batch
      if (!baselineReady) {
        baselineReady = true // 首拉只建基线：历史消息不当唤起
      } else {
        for (const message of extractRoomMessages(sync)) {
          if (message.sender === options.selfUserId) continue
          if (allowedRooms !== undefined && !allowedRooms.has(message.roomId)) continue
          for (const intent of parseMentions(message, parserConfig)) emit(intent)
        }
      }
      delayMs = pollIntervalMs // 成功复位
      schedule(emit)
    } catch {
      delayMs = Math.min(delayMs * 2, maxBackoffMs) // 出错翻倍，上限封顶
      schedule(emit)
    }
  }

  return {
    name: MENTION_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      delayMs = pollIntervalMs
      void poll(emit) // 首拉立即出发（建基线）
    },
    stop(): void {
      running = false
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
