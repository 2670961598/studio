/**
 * assembly/panel/conversation-store —— panel `ConversationStore` Port 的 daemon 适配器（studio-dev-654a）
 *
 * 依据：docs/21-§七.1（单一会话事实源/行 schema/seq 合成/幂等）、§7.4（面板 Port 映射表）、
 * docs/v2/14-§8.1（装配入口/写鉴权/中继失败面）。
 *
 * 反屎山声明：
 *   - **不重复实现存储**：单源=engine/conversation/store.ts 的 `<companyDir>/conversations/<工号>.jsonl`；
 *     本件只做形状映射（Port↔store 行）与 seq 合成（单点口径 panelVisibleRows）。
 *   - **无特判硬编码**：来源判定用显式 `source` 字段；不按 eventId 前缀/工号白名单猜来源。
 *   - **无绕道吞错**：store 写失败原样抛（panel 路由映射 503），不静默返回空/成功。
 *
 * 边界：只在 daemon 装配侧使用（panel 包不 import 本件，保持 panel 零 daemon 依赖）。
 */
import {
  ConversationConflictError,
  compareConversationSummaries,
  summarizeConversation,
  type AppendConversationMessageInput,
  type AppendConversationMessageResult,
  type ClearConversationInput,
  type ConversationClear,
  type ConversationEntry,
  type ConversationMessage,
  type ConversationStore as PanelConversationStore,
  type ConversationSummary,
} from '@studio-next/panel/conversation'
import type { ConversationMessage as StoreMessage, ConversationStore } from '../../engine/conversation/store.ts'
import { panelVisibleRows, type PanelSeqRow } from '../../engine/conversation/panel-map.ts'

/** 适配器选项（producerId=面板写署名工号，来自 STUDIO_PANEL_PRODUCER_ID） */
export interface DaemonPanelStoreOptions {
  readonly producerId: string
}

/** store 行 → Port 条目（单点映射；来源透传） */
function entryOf(row: PanelSeqRow, producerId: string): ConversationEntry {
  const { seq } = row
  if (row.row.kind === 'clear') {
    return {
      v: 1,
      kind: 'clear',
      seq,
      id: row.row.id,
      at: row.row.at,
      personId: row.row.person,
      by: row.row.by,
      ...(row.row.reason !== undefined ? { reason: row.row.reason } : {}),
      source: row.row.source ?? 'matrix',
    }
  }
  const role = row.row.role
  return {
    v: 1,
    kind: 'message',
    seq,
    id: row.row.id,
    at: row.row.at,
    personId: row.row.person,
    from: role === 'producer' ? { kind: 'producer', ref: producerId } : { kind: 'person', ref: row.row.person },
    text: row.row.text,
    source: row.row.source ?? 'matrix',
    ...(row.row.clientMsgId !== undefined ? { clientMsgId: row.row.clientMsgId } : {}),
  }
}

/**
 * panel `ConversationStore` 的 daemon 实现：读写同一 JSONL 单源。
 * 构造不落盘（store 构造期已建目录）；缺 `--company-dir` 时上层不构造本适配器=503 降级。
 */
export class DaemonPanelConversationStore implements PanelConversationStore {
  private readonly store: ConversationStore
  private readonly options: DaemonPanelStoreOptions

  constructor(store: ConversationStore, options: DaemonPanelStoreOptions) {
    this.store = store
    this.options = options
  }

  private entriesOf(personId: string): ConversationEntry[] {
    return panelVisibleRows(this.store.visibleRecords(personId)).map((row) => entryOf(row, this.options.producerId))
  }

  private messageOf(personId: string, message: StoreMessage): ConversationMessage {
    const found = this.entriesOf(personId).find(
      (entry): entry is ConversationMessage => entry.kind === 'message' && entry.id === message.id,
    )
    if (found === undefined) throw new Error(`conversation-adapter: 写后回找不到消息（${personId}/${message.id}）`)
    return found
  }

  async list(): Promise<readonly ConversationSummary[]> {
    return this.store
      .personIds()
      .map((personId) => summarizeConversation(personId, this.entriesOf(personId)))
      .sort(compareConversationSummaries)
  }

  async read(personId: string): Promise<readonly ConversationEntry[]> {
    return this.entriesOf(personId)
  }

  async appendMessage(input: AppendConversationMessageInput): Promise<AppendConversationMessageResult> {
    const personId = input.personId
    if (input.clientMsgId !== undefined) {
      const existing = this.store.findMessageByClientMsgId(personId, input.clientMsgId)
      if (existing !== undefined) {
        if (existing.text !== input.text) {
          throw new ConversationConflictError(
            `conversation: clientMsgId 冲突（同键异内容；person=${personId}，key=${input.clientMsgId}）`,
          )
        }
        return { message: this.messageOf(personId, existing), deduped: true }
      }
    }
    const room = this.store.roomFor(personId)
    if (room === undefined) {
      // fail-closed：无绑定房=无法定位投递目标（不猜房、不落假 room）——上层按 503 如实报
      throw new Error(`conversation-adapter: 工号未绑定 DM 房（person=${personId}；先经 Matrix /bind 或启动绑定）`)
    }
    const written = this.store.appendMessage({
      person: personId,
      room,
      role: input.from.kind === 'producer' ? 'producer' : 'person',
      text: input.text,
      source: input.source,
      ...(input.clientMsgId !== undefined ? { clientMsgId: input.clientMsgId } : {}),
    })
    if (written === undefined) {
      // 幂等命中（appendMessage 对重复键返回 undefined）——回既有行，仍输出 deduped=true
      const existing = input.clientMsgId !== undefined ? this.store.findMessageByClientMsgId(personId, input.clientMsgId) : undefined
      if (existing !== undefined) return { message: this.messageOf(personId, existing), deduped: true }
      throw new Error('conversation-adapter: 追加消息被去重但找不到既有行（数据面异常）')
    }
    return { message: this.messageOf(personId, written), deduped: false }
  }

  async clear(input: ClearConversationInput): Promise<ConversationClear> {
    const room = this.store.roomFor(input.personId)
    if (room === undefined) {
      throw new Error(`conversation-adapter: 工号未绑定 DM 房（person=${input.personId}）`)
    }
    this.store.clear(
      room,
      input.personId,
      input.by,
      input.reason === undefined || input.reason === '' ? undefined : input.reason,
      input.source,
    )
    const entries = this.entriesOf(input.personId)
    const last = entries[entries.length - 1]
    if (last === undefined || last.kind !== 'clear') {
      throw new Error('conversation-adapter: clear 写后回找不到 clear 行（数据面异常）')
    }
    return last
  }
}
