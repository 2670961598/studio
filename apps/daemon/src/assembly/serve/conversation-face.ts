/**
 * assembly/serve/conversation-face —— 持久对话装配面（studio-dev-646 Q6 先拆后增适配）
 *
 * 由 `runtime.ts` 在 buildServeRuntime 调一次；本件承接原 runtime 内联装配块（逐字搬运，
 * 不改语义）：conversation 开关 + notify 面必配校验 + wireConversation 装配 + 轮次验收覆盖选项。
 *
 * 依据：docs/21-§七（持久对话通道）、v2/14-§1.9（CONV 会话面装配）。
 */
import type { PersonRef } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import { CONVERSATION_ACCEPTANCE } from '../../engine/conversation/protocol.ts'
import { wireConversation, type WiredConversation } from '../../engine/conversation/wire.ts'
import type { ServeConfig } from './config.ts'

export interface WireServeConversationArgs {
  readonly config: ServeConfig
  readonly wrappedNotifyFace: NotifyBroadcastFace | undefined
  readonly ledger: Ledger
  readonly people: () => readonly PersonRef[]
  readonly log: (line: string) => void
}

/**
 * 装配持久对话（docs/21-§七，studio-dev-646 Phase 1；关=零装配零注入）：
 * 入站消费依赖注入 EngineDeps.conversation（drain 分流），出站中继在拍边界（run.ts）
 * 消费 onWorkComplete 信号 + 出站队列；回信复用 notify 面 `targets.room`（v2/14-§1.9）。
 */
export function wireServeConversation(args: WireServeConversationArgs): WiredConversation | undefined {
  const { config, wrappedNotifyFace } = args
  if (config.conversation && wrappedNotifyFace === undefined) {
    throw new Error(
      'CONFIG_INVALID：conversation: true 需注入 notify 广播面（opts.notifyBroadcast）——回信通道复用 notify 的房间定向（docs/21-§七.4 / v2/14-§1.9；生产形态要求 matrixChannels: true）',
    )
  }
  if (!config.conversation || wrappedNotifyFace === undefined) return undefined
  return wireConversation({
    company: config.company,
    ...(config.conversationDir !== undefined ? { dir: config.conversationDir } : {}),
    roomIds: config.conversationRooms ?? [],
    producer: config.matrixProducerMxid ?? '',
    defaultPerson: config.conversationDefaultPerson ?? 'PRIME-0',
    window: config.conversationWindow ?? 12,
    maxChars: config.conversationMaxChars ?? 6000,
    maxMessageChars: config.conversationMaxMessageChars ?? 2000,
    replyMaxChars: config.conversationReplyMaxChars ?? 12000,
    ledger: args.ledger,
    notify: wrappedNotifyFace,
    people: args.people,
    log: args.log,
  })
}

/**
 * 闸门轮次验收覆盖（docs/21-§七.4）：持久对话轮次按单覆盖为 `test -s REPORT.md`；
 * 其余单沿用全局验收（返回空对象＝不改门）。
 */
export function conversationAcceptanceOptions(wired: WiredConversation | undefined): {
  acceptanceFor?: (ticket: string) => readonly string[] | undefined
} {
  if (wired === undefined) return {}
  return {
    acceptanceFor: (ticket: string): readonly string[] | undefined =>
      wired.store.turnOf(ticket) !== undefined ? CONVERSATION_ACCEPTANCE : undefined,
  }
}
