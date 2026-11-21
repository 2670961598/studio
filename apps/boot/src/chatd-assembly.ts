/**
 * chatd 装配面（boot.ts 拆件，M5 尾随 notify 面小刀落地——20-§十五.三.3 尺寸阈 600 拆件纪律）：
 * workbench-chatd 相关的组合根装配件与共享常量统一收口本件——
 *   - WORKBENCH_CHATD_TOKEN_ENV / DEFAULT_MENTION_*（chatd 键组共享常量，boot.ts 再出口
 *     保持 '@studio-next/boot' 消费面零漂移）；
 *   - assembleChatdSource（M4-1 task-136，plan/07 §5.4：@唤醒源工厂装配）；
 *   - assembleChatdNotifyFace（M5 尾，plan/09-…-2026-11-21.md §二#3：notify 广播面装配——
 *     matrix: false 形态下替代 matrix broadcast 的 fail-closed 出口）。
 * 共同纪律：与 matrix 装配件同形但**零登录零网络**（transport 惰性连接——首请求才 connect）、
 * boot 不 spawn 不守护 chatd 进程（独立 ops/launchd 运维，M1 交付面）；互斥/必配键由
 * parseDaemonConfig 交叉面收口（assembly/serve/chatd-mention-source.ts + chatd-notify-face.ts），
 * 装配件只做开关面一致性兜底（错态调用=CONFIG_INVALID 明报）。
 */
import type { InvokeSource } from '@studio-next/contract'
import {
  createChatdMentionSource,
  createChatdNotifyFace,
  DEFAULT_CHATD_NOTIFY_SENDER_ID,
  type ChatdNotifyTransportPort,
  type ChatdSourceFactory,
  type ChatdTransportPort,
  type NotifyBroadcastFace,
  type ServeConfig,
} from '@studio-next/daemon/serve'

/**
 * chatd 鉴权 token env 名（M4-1 task-136；红名单同 bot 密码——值永不入 daemon.yaml/日志/
 * 台账，仅随 transport 请求附参）：与 chatd 侧同名 env（apps/workbench-chatd/src/config.ts）；
 * 缺省不拒启（chatd ALLOW_NO_AUTH 面合法）——鉴权失败走源软失败明报，分类=config。
 */
export const WORKBENCH_CHATD_TOKEN_ENV = 'WORKBENCH_CHATD_TOKEN'

/**
 * chatd 唤起源传输连接/请求超时缺省 ms（P1 加固——localplatform 全量 list 每拍扫描致 daemon
 * 事件循环偶发 >1s 停顿，transport 包内缺省 connect 1000/request 2000 会让启动首轮 poll 偶发
 * "connect timeout after 1000ms"；boot 组合根显式抬高，不动物理包缺省——面板聊天等其余
 * 消费面零漂移。可经 daemon.yaml mentionConnectTimeoutMs/mentionRequestTimeoutMs 覆盖
 * （正整数毫秒，非法值 parseDaemonConfig 即拒）。
 */
export const DEFAULT_MENTION_CONNECT_TIMEOUT_MS = 5_000
export const DEFAULT_MENTION_REQUEST_TIMEOUT_MS = 10_000

/**
 * chatd @唤醒源装配件（M4-1 task-136，docs/plan/06 §M3/M4 + plan/07 §5.4）：config 键组 +
 * env token → 源工厂。与 matrix 装配件同纪律但**零登录零网络**：transport 惰性连接（首请求
 * 才 connect），boot 不启动/不守护 chatd 进程（独立 ops/launchd 运维——M1 交付面）。
 * 工厂 ctx.actors 由 runServe 在公司快照在场处回调供给（boot 不持快照；matrixRoomFace ctx 判例）。
 * token 缺省不拒启（chatd ALLOW_NO_AUTH 面合法）——鉴权失败走源软失败明报（分类=config）。
 * 传输超时显式传 connectTimeoutMs/requestTimeoutMs（config 可配，缺省 5000/10000——P1 加固，
 * 防事件循环偶发停顿致首轮 poll connect timeout）。
 * 测试注入面：options.transport 传结构同形 mock（ChatdTransportPort——daemon/serve 再出口）。
 */
export function assembleChatdSource(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: { transport?: ChatdTransportPort; log?: (line: string) => void },
): ChatdSourceFactory {
  if (config.mentionSource !== 'chatd') {
    throw new Error('CONFIG_INVALID：assembleChatdSource 在 mentionSource ≠ chatd 下被调用（装配面与开关面不一致）')
  }
  const socketPath = config.chatdSocket
  if (socketPath === undefined || socketPath === '') {
    throw new Error('CONFIG_INVALID：mentionSource: chatd 缺 chatdSocket（缺省 <companyDir>/var/workbench/chat.sock——解析面已收口，此处兜底明报）')
  }
  const token = env[WORKBENCH_CHATD_TOKEN_ENV]
  const tokenNote = token !== undefined && token !== '' ? 'env 供给' : '未设（chatd ALLOW_NO_AUTH 面；鉴权失败走源软失败明报）'
  // P1 加固：传输超时 config 可配、缺省 5000/10000（DEFAULT_MENTION_* 单一源）——显式传入
  // 源工厂自建 transport 面（注入 transport 时选项仍随 factory 透传，同形不特判）。
  const connectTimeoutMs = config.mentionConnectTimeoutMs ?? DEFAULT_MENTION_CONNECT_TIMEOUT_MS
  const requestTimeoutMs = config.mentionRequestTimeoutMs ?? DEFAULT_MENTION_REQUEST_TIMEOUT_MS
  options?.log?.(
    `[boot] chatd @唤醒源已装配（socket=${socketPath}${config.mentionPollMs !== undefined ? `，pollMs=${String(config.mentionPollMs)}` : ''}` +
      `，connectTimeoutMs=${String(connectTimeoutMs)}，requestTimeoutMs=${String(requestTimeoutMs)}，token ${tokenNote}）→ runServe opts.chatdSource 注入` +
      '（chatd 进程独立 ops/launchd 运维——boot 不 spawn 不守护；源 emit 统一进 engine.ingest，22-§一 源零直驱）',
  )
  return (ctx): InvokeSource =>
    createChatdMentionSource({
      company: config.company,
      actors: ctx.actors,
      socketPath,
      ...(options?.transport !== undefined ? { transport: options.transport } : {}),
      ...(token !== undefined && token !== '' ? { token } : {}),
      ...(config.mentionPollMs !== undefined ? { pollMs: config.mentionPollMs } : {}),
      connectTimeoutMs,
      requestTimeoutMs,
      ...(options?.log !== undefined ? { log: options.log } : {}),
    })
}

/**
 * chatd 通知面装配件（M5 尾，plan/09 §二#3）：daemon.yaml notifyChatdRoomId（必填锚）
 * + 可选 notifyChatdSenderId（缺省 PRIME-0）+ 复用 chatdSocket/env WORKBENCH_CHATD_TOKEN/
 * mentionConnectTimeoutMs/mentionRequestTimeoutMs → createChatdNotifyFace 产物注入
 * runServe opts.notifyBroadcast——matrix: false 形态下替代 matrix broadcast 的 fail-closed
 * 出口（缺键=bootServe 不调本件=零注入零行为，现状不回归）。与 mention 源装配件同纪律：
 * 零登录零网络（transport 惰性连接）、boot 不 spawn 不守护 chatd 进程；token 缺省不拒启
 * （chatd ALLOW_NO_AUTH 面合法——鉴权失败走面软失败明报，分类=config）。
 * 测试注入面：options.transport 传结构同形 mock（ChatdNotifyTransportPort——daemon/serve 再出口）。
 */
export function assembleChatdNotifyFace(
  config: ServeConfig,
  env: Record<string, string | undefined>,
  options?: { transport?: ChatdNotifyTransportPort; log?: (line: string) => void },
): NotifyBroadcastFace {
  if (config.notifyChatdRoomId === undefined || config.matrix || config.matrixChannels) {
    throw new Error('CONFIG_INVALID：assembleChatdNotifyFace 在 notifyChatdRoomId 未配或 matrix/matrixChannels 面在场下被调用（装配面与开关面不一致——互斥由解析面收口，此处兜底）')
  }
  const socketPath = config.chatdSocket
  if (socketPath === undefined || socketPath === '') {
    throw new Error('CONFIG_INVALID：notifyChatdRoomId 缺 chatdSocket（缺省 <companyDir>/var/workbench/chat.sock——解析面已收口，此处兜底明报）')
  }
  const token = env[WORKBENCH_CHATD_TOKEN_ENV]
  const tokenNote = token !== undefined && token !== '' ? 'env 供给' : '未设（chatd ALLOW_NO_AUTH 面；鉴权失败走面软失败明报）'
  const senderId = config.notifyChatdSenderId ?? DEFAULT_CHATD_NOTIFY_SENDER_ID
  // 传输超时复用 chatd 唤醒源键组（同 socket 同 daemon 事件循环——P1 加固缺省 5000/10000 单一源）
  const connectTimeoutMs = config.mentionConnectTimeoutMs ?? DEFAULT_MENTION_CONNECT_TIMEOUT_MS
  const requestTimeoutMs = config.mentionRequestTimeoutMs ?? DEFAULT_MENTION_REQUEST_TIMEOUT_MS
  options?.log?.(
    `[boot] chatd notify 面已装配（socket=${socketPath}，roomId=${config.notifyChatdRoomId}，senderId=${senderId}` +
      `，connectTimeoutMs=${String(connectTimeoutMs)}，requestTimeoutMs=${String(requestTimeoutMs)}，token ${tokenNote}）→ runServe opts.notifyBroadcast 注入` +
      '（M5 尾 plan/09 §二#3：matrix: false 形态的 notify 出口；面软失败不炸主循环——面板仍是 critical 第一落点）',
  )
  return createChatdNotifyFace({
    socketPath,
    roomId: config.notifyChatdRoomId,
    senderId,
    ...(options?.transport !== undefined ? { transport: options.transport } : {}),
    ...(token !== undefined && token !== '' ? { token } : {}),
    connectTimeoutMs,
    requestTimeoutMs,
    ...(options?.log !== undefined ? { log: options.log } : {}),
  })
}
