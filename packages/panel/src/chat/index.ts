/**
 * chat —— 面板自研聊天室视图（M4-3 最小刀；独立入口同包 ./chat）
 *
 * 组成：types（Port＋稳定错误面）/ env（开关解析）/ wiring（Transport v1 客户端装配）/
 * page（服务端渲染壳＋原生 JS 轮询）/ server（Hono 路由）。默认关闭（WORKBENCH_CHATD_SOCKET
 * 未配=未启用），不因未配 chatd 拒启 panel。
 */
export { loadChatPanelEnv, type ChatPanelEnv, type ChatPanelEnvDefaults } from './env.ts'
export { createChatPanelOptions, createChatPanelTransport } from './wiring.ts'
export {
  DEFAULT_CHAT_ACTOR_ID,
  DEFAULT_CHAT_LIMIT,
  DEFAULT_CHAT_POLL_MS,
  MAX_CHAT_BODY_CHARS,
  MAX_CHAT_LIMIT,
  WB_HTTP_STATUS,
  type ChatPanelErrorBody,
  type ChatPanelErrorCode,
  type ChatPanelTransport,
  type InboxResult,
  type MessagePage,
  type ReadResult,
  type Room,
  type SendResult,
  type WbErrorCode,
} from './types.ts'
export {
  clampChatLimit,
  createChatApp,
  classifyChatFailure,
  parseReadBody,
  parseSendBody,
  type ChatAppOptions,
  type ParsedReadBody,
  type ParsedSendBody,
} from './server.ts'
export { renderChatBody, renderChatPage, type ChatPageOptions } from './page.ts'
export { HOST_PATH_MASK_SOURCE, maskHostPaths } from './mask.ts'
export { LINK_RE_SOURCE, isSafeLinkHref, linkifySegments, type LinkSegment } from './linkify.ts'
export { chatPageScript, type ChatScriptConfig } from './page-script.ts'
