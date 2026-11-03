/**
 * conversation/index —— 面板对话页入口（studio-dev-647 · Phase 2；包内子入口 ./conversation）
 *
 * 依据：docs/v2/14-§8.1、docs/21-§七。纯函数层（api.ts）/类型面（types.ts）/路由层（server.ts）/
 * 页面壳（page.ts）四件分离；存储实现不在本包（Phase 1 #646 注入 ConversationStore）。
 */
export {
  DEFAULT_CONVERSATION_POLL_MS,
  MAX_BODY_BYTES,
  MAX_CLEAR_REASON,
  MAX_HISTORY_ENTRIES,
  MAX_MESSAGE_TEXT,
  CONVERSATION_PROTOCOL_VERSION,
  ConversationConflictError,
} from './types.ts'
export type {
  AppendConversationMessageInput,
  AppendConversationMessageResult,
  ClearConversationInput,
  ConversationActor,
  ConversationActorKind,
  ConversationClear,
  ConversationEntry,
  ConversationMessage,
  ConversationSource,
  ConversationStore,
  ConversationSummary,
  ConversationView,
} from './types.ts'
export {
  DEFAULT_PRODUCER_ID,
  PRODUCER_TOKEN_HEADER,
  authorizeConversationWrite,
  compareConversationSummaries,
  isPersonId,
  loadConversationWritePolicy,
  parseAfterSeq,
  parseClearConversationBody,
  parseSendMessageBody,
  projectConversationView,
  summarizeConversation,
} from './api.ts'
export type {
  ClearConversationBody,
  ConversationWriteAllowed,
  ConversationWriteAuthResult,
  ConversationWriteDenied,
  ConversationWritePolicy,
  Parsed,
  SendMessageBody,
} from './api.ts'
export { createConversationApp } from './server.ts'
export type { ConversationAppOptions } from './server.ts'
export { renderConversationPage } from './page.ts'
export type { ConversationPageOptions } from './page.ts'
