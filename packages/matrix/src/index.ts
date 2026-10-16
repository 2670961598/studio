/**
 * Studio Next · matrix —— Matrix 集成 v0.1（@唤醒 InvokeSource + Notifier 通知出口）
 *
 * 定位（docs/21 协作通讯、docs/22 唤起源、docs/25-§3.4/§4.2 端口）：
 *   - 纯核心（零 IO）：mentions.ts @唤醒解析器、format.ts 通知格式化器
 *   - 薄网络层：client.ts 注入式 fetch 的 CS API 最小客户端（零 npm 依赖，不引 SDK）
 *   - adapter.ts：createMatrixNotifier / createMentionSource 两件套（实现 contract 端口）
 *
 * 纪律：源只产意图绝不直接驱动 worker；频道内容按不可信输入对待（解析器防误报）。
 */
export {
  MENTION_SOURCE_NAME,
  DEFAULT_AGENT_ID_PATTERN,
  parseMentions,
  extractRoomMessages,
  stripNonConversational,
} from './mentions.ts'
export type {
  MentionParserConfig,
  MatrixRoomMessage,
  MentionPayload,
  SyncLike,
} from './mentions.ts'
export { formatNotification } from './format.ts'
export { MatrixClient } from './client.ts'
export type {
  FetchLike,
  FetchInit,
  FetchResponse,
  MatrixClientOptions,
  LoginResult,
  SyncResponse,
  JoinedRoomSnapshot,
} from './client.ts'
export { createMatrixNotifier, createMentionSource } from './adapter.ts'
export type { MentionSourceOptions } from './adapter.ts'
