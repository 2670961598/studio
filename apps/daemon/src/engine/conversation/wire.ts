/**
 * 制作人-岗位持久对话 · 服务装配件（配置 → 存储/消费依赖/出站中继）
 *
 * 依据：docs/21-§七.6（配置面与验收）、docs/v2/14-§1.9（CONV 会话面装配）。
 * 由 `assembly/serve/runtime.ts` 在 `conversation: true` 时调用一次；关=零装配零注入
 * （既有行为逐字节不变）。装配失败（目录不可建/配置缺）抛 CONFIG_INVALID——不静默降级。
 */
import path from 'node:path'
import type { PersonRef } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { NotifyBroadcastFace } from '../notify/broadcast.ts'
import { ConversationStore } from './store.ts'
import type { ConversationRuntimeConfig, ConversationTickDeps } from './consume.ts'
import { createConversationRelay, type ConversationRelay } from './reply.ts'

export interface WireConversationInput {
  company: string
  /** daemon.yaml conversationDir；缺省 undefined=本函数按 rootDir 推导 */
  dir?: string
  roomIds: readonly string[]
  producer: string
  defaultPerson: string
  window: number
  maxChars: number
  maxMessageChars: number
  replyMaxChars: number
  ledger: Ledger
  notify: NotifyBroadcastFace
  /** 人员索引活取（L1 热重载后署名取新快照；缺省=工号） */
  people: () => readonly PersonRef[]
  log?: (line: string) => void
}

export interface WiredConversation {
  store: ConversationStore
  tick: ConversationTickDeps
  relay: ConversationRelay
}

/** 四段式署名（与 prompt 装配面同形：`[公司·部门·岗位·级别]`） */
export function conversationSignature(company: string, person: PersonRef | undefined, fallback: string): string {
  if (person === undefined) return fallback
  return `[${company}·${person.dept}·${person.name}·${person.level}]`
}

/** 装配（fail-fast：缺房间/制作人/目录不可建=抛；调用方转 CONFIG_INVALID 拒启） */
export function wireConversation(input: WireConversationInput): WiredConversation {
  const log = input.log ?? ((): void => {})
  if (input.roomIds.length === 0) {
    throw new Error('CONFIG_INVALID：conversation: true 需配 conversationRooms（DM 房 ID 白名单，分号分隔）')
  }
  if (input.producer.trim() === '') {
    throw new Error('CONFIG_INVALID：conversation: true 需配 matrixProducerMxid（制作人 MXID，入站/命令鉴权）')
  }
  const dir = path.resolve(input.dir ?? path.join('.', 'conversations'))
  let store: ConversationStore
  try {
    store = new ConversationStore({ dir, log })
  } catch (err) {
    throw new Error(`CONFIG_INVALID：会话目录不可用（${dir}）：${err instanceof Error ? err.message : String(err)}`)
  }
  const cfg: ConversationRuntimeConfig = {
    company: input.company,
    producer: input.producer,
    defaultPerson: input.defaultPerson,
    rooms: [...input.roomIds],
    window: input.window,
    maxChars: input.maxChars,
    maxMessageChars: input.maxMessageChars,
  }
  const relay = createConversationRelay({
    store,
    ledger: input.ledger,
    notify: input.notify,
    config: { company: input.company, replyMaxChars: input.replyMaxChars },
    signatureOf: (person: string): string =>
      conversationSignature(input.company, input.people().find((p) => p.id === person), person),
    log,
  })
  log(
    `[serve] 制作人-岗位持久对话已装配：dir=${dir} rooms=${String(input.roomIds.length)} ` +
      `default=${input.defaultPerson} window=${String(input.window)}/${String(input.maxChars)}字（docs/21-§七，studio-dev-646）`,
  )
  return { store, tick: { store, config: cfg, log }, relay }
}
