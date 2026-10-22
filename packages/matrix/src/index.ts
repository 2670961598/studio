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
// DEV-48 人事同步器执行面（docs/52-§七；ensure-shape 业务幂等层——daemon 侧结构同形接口注入）
export { createMatrixHrFace, matrixLevelFor } from './hr-face.ts'
export type { MatrixHrFaceOptions, MatrixHrTarget } from './hr-face.ts'
// 130-P3 频道供给扩展（130 提案 §6.7 八类地图＋DEV-20 §5.1-§5.4 冻结基座；ensure
// 幂等收敛——S8 判负线=重跑漂移；boot 组合根装配，daemon 侧结构同形接口消费）
export {
  powerLevelTarget,
  planChannelMap,
  ensureSpace,
  ensureChannel,
  ensureCompanyChannels,
  ensureTicketRoom,
  archiveTicketRoom,
  createMatrixProvisionFace,
  mxidOf,
  serverNameOf,
  aliasLocalpart,
  ticketAliasLocalpart,
  ticketRoomName,
  resolveTicketMembers,
  ARCHIVED_PREFIX,
} from './provision.ts'
export type {
  ProvisionPerson,
  ProvisionDept,
  ProvisionGroup,
  ChannelMapInput,
  ChannelKind,
  PowerLevelColumn,
  PowerLevelsContent,
  ChannelSpec,
  ChannelMapPlan,
  ProvisionClient,
  EnsureRoomResult,
  CompanyChannelsReport,
} from './provision.ts'
