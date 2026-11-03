/**
 * conversation/types —— 面板对话页的类型面与 Port 契约（studio-dev-647 · Phase 2）
 *
 * 依据（实现单引用）：
 *   - docs/21-§七：制作人-岗位持久对话通道（单一会话事实源＋双端同步契约）；
 *   - docs/v2/14-§8.1：面板对话页装配（PANEL-CONV；:8791）端面/鉴权/幂等/降级；
 *   - docs/v2/15-§二 SEC-SIG-01：写署名主体＝person（actorRef=制作人工号）。
 *
 * 分层纪律：本件零 IO 零 Hono——只放类型与 Port 接口。会话存储归 Phase 1（#646）
 * 装配注入；panel **不直连库/文件**，也不在 panel 内落盘代偿（docs/21-§7.4）。
 */

/** 会话日志协议版本（docs/21-§7.1 的 `v` 字段；升版=改本常量并回写文档） */
export const CONVERSATION_PROTOCOL_VERSION = 1

/** 页面轮询缺省间隔（docs/v2/14-§8.1：SSE/拉取同源，缺省 2s） */
export const DEFAULT_CONVERSATION_POLL_MS = 2000

/** 单条消息正文字符上限（docs/21-§7.1：单行 ≤16KB） */
export const MAX_MESSAGE_TEXT = 4000

/** clear 理由字符上限 */
export const MAX_CLEAR_REASON = 200

/** 请求体字节上限（防拉爆；与单条正文上限同量级） */
export const MAX_BODY_BYTES = 16 * 1024

/** 单次历史投影上限（docs/21-§7.2-6：列表/历史单次 ≤500 条） */
export const MAX_HISTORY_ENTRIES = 500

/** 会话来源：Matrix 端（Phase 1）或面板端（Phase 2） */
export type ConversationSource = 'matrix' | 'panel'

/** 署名主体：制作人（producer）或岗位员工（person） */
export type ConversationActorKind = 'producer' | 'person'

/** 消息署名（docs/v2/15 SEC-SIG-01 person 三值之一；不存 control/system） */
export interface ConversationActor {
  readonly kind: ConversationActorKind
  readonly ref: string
}

/** 一条对话消息（append-only 日志行；seq 由存储侧单点分配） */
export interface ConversationMessage {
  readonly v: typeof CONVERSATION_PROTOCOL_VERSION
  readonly kind: 'message'
  readonly seq: number
  readonly id: string
  readonly at: number
  readonly personId: string
  readonly from: ConversationActor
  readonly text: string
  readonly source: ConversationSource
  /** 发送端幂等键（同工号内唯一；docs/21-§7.2-4） */
  readonly clientMsgId?: string
}

/** 一条 clear 审计记录（不物理删除消息；docs/21-§7.1） */
export interface ConversationClear {
  readonly v: typeof CONVERSATION_PROTOCOL_VERSION
  readonly kind: 'clear'
  readonly seq: number
  readonly id: string
  readonly at: number
  readonly personId: string
  readonly by: string
  readonly reason?: string
  readonly source: ConversationSource
}

/** 会话日志行联合（读面按 kind 顶层判别） */
export type ConversationEntry = ConversationMessage | ConversationClear

/** 会话摘要（左侧列表；count=最后 clear 之后的消息数） */
export interface ConversationSummary {
  readonly personId: string
  readonly lastAt: number | null
  readonly lastText: string | null
  readonly count: number
  readonly clearedAt: number | null
}

/** 追加消息入参（存储侧补 seq/id/at；panel 侧只填文本/来源/署名/幂等键） */
export interface AppendConversationMessageInput {
  readonly personId: string
  readonly text: string
  readonly source: ConversationSource
  readonly from: ConversationActor
  readonly clientMsgId?: string
  readonly at?: number
}

/** 追加消息结果（deduped=true 表命中既有幂等键，未产生新行） */
export interface AppendConversationMessageResult {
  readonly message: ConversationMessage
  readonly deduped: boolean
}

/** clear 入参（存储侧追加 clear 记录并保留审计） */
export interface ClearConversationInput {
  readonly personId: string
  readonly by: string
  readonly source: ConversationSource
  readonly reason?: string
  readonly at?: number
}

/**
 * 会话存储 Port（Phase 1 实现并注入）。
 *
 * 实现须保证（docs/21-§7.2）：
 *   1. 同一工号 seq 单调；read 返回 seq 升序的全部行（含 clear 行）；
 *   2. appendMessage 以 (personId, clientMsgId) 幂等——同键同内容回既有行并置 deduped=true，
 *      同键异内容抛 ConversationConflictError；
 *   3. clear 只追加、不删除；存储失败抛错（面板侧映射 503，不静默吞错）。
 */
export interface ConversationStore {
  list(): Promise<readonly ConversationSummary[]>
  read(personId: string): Promise<readonly ConversationEntry[]>
  appendMessage(input: AppendConversationMessageInput): Promise<AppendConversationMessageResult>
  clear(input: ClearConversationInput): Promise<ConversationClear>
}

/** 面板读面投影（`GET /api/conversations/:personId` 的响应体） */
export interface ConversationView {
  readonly personId: string
  /** 当前版本（最后一行 seq；0=空会话） */
  readonly version: number
  /** 最后一条 clear 的时刻（null=从未 clear） */
  readonly clearedAt: number | null
  /** 最后一条 clear 的 seq（0=从未 clear） */
  readonly clearSeq: number
  /** 有效消息（最后 clear 之后；已按 after 游标过滤） */
  readonly messages: readonly ConversationMessage[]
  /** true=客户端游标落在 clear 之前，须整屏重置（docs/21-§7.2-5） */
  readonly reset: boolean
}

/** 幂等键冲突（同 (personId, clientMsgId) 异内容）——面板侧映射 409 */
export class ConversationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationConflictError'
  }
}
