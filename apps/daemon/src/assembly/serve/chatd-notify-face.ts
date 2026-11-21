/**
 * chatd-notify-face —— workbench-chatd 通知面（M5 尾收口，plan/09-…-2026-11-21.md §二#3）
 *
 * 依据：docs/plan/09 §二#3（Lead 决策：chatd notifier 替代 matrix broadcast 的 fail-closed
 * 出口——「无通知不阻塞单子/聊天主链」）；形态判例=assembly/serve/chatd-mention-source.ts
 * （transport/config 收口同款单孔纪律）＋ packages/matrix/src/broadcast.ts（matrix 广播面
 * ——本面是其结构同形替代，daemon 侧零 matrix import 不变，docs/25-§一.2）。
 *
 * 接口（NotifyBroadcastFace，engine/notify/broadcast.ts：send 永不抛出）：
 *   - 逻辑频道角色（alert/overview/dept）→ **单房间折叠**：chatd 无部门频道拓扑，三角色
 *     共投 notifyChatdRoomId 配置房——**每个不同 roomId 恰发一条**纯文本（同房多条重复=
 *     噪音），report.sent 仍逐角色点名（惊动计量 byRole 口径与 matrix 面同形）；
 *   - targets.room（显式房间，v2/14-§1.9 回信通道语义）→ 直投该房间不做解析（matrix 面
 *     同款「显式房间与三逻辑角色并列」）；与逻辑角色同房时并入同一条；
 *   - 空角色（无 alert/overview/dept/room）→ 零发送零报告（matrix 面 roles 空循环同语义）。
 *
 * 失败面（刀B-6 同契约）：**软失败不炸主循环**——send 单次 sendMessage 失败/抛错只入
 * report.failed + 落日志（分类复用 classifyChatdError：transport/config/defect/conflict/
 * gone/unknown），永不向上抛（把沟通面故障升级成主循环噪音=判负；面板（:8789，读 events
 * 台账）始终是 critical 第一落点，docs/19-§六冻结序不变）。
 *
 * 幂等键决策（不设）：本面 fire-and-forget 无重试面（relay 已有 NotifyDedup 去重 + 双保险
 * try/catch），messages.send 的 idempotencyKey 若按内容哈希派生会把「不同事件的同文通知」
 * 静默吞并——故恒不携带（每次 send=新消息；重试语义归上层 relay/部署面）。
 *
 * 密钥纪律：token 经 env WORKBENCH_CHATD_TOKEN 由组合根供给（值永不入 yaml/日志/台账，
 * 仅随 transport 请求附参——chatd-mention-source 同款红名单）。
 *
 * 配置收口（判例同 mention 源：本文件持键解析/交叉校验，config.ts switch/尾段收口到此）：
 *   - notifyChatdRoomId：非空字符串（chatd 房间 roomId）——键在场=面开（必填锚）；
 *   - notifyChatdSenderId：工号样式（如 PRIME-0），缺省 PRIME-0（DEFAULT_CHATD_NOTIFY_SENDER_ID，
 *     装配面 apps/boot 持缺省）；
 *   - 交叉：与 matrix/matrixChannels 互斥（双通知出口=双写，mention 互斥同判例）；孤儿
 *     senderId（无 roomId）=CONFIG_INVALID；chatdSocket 复用 mention 源键（缺省推导
 *     <companyDir>/var/workbench/chat.sock——mention 源已推导则直通）。
 */
import type { Notification } from '@studio-next/contract'
import { WorkbenchTransport } from '@studio-next/workbench-transport'
import type { SendResult } from '@studio-next/workbench-transport'
import { join, resolve } from 'node:path'
import { classifyChatdError, type ChatdServeKeyHelpers } from './chatd-errors.ts'
import type { NotifyBroadcastFace, NotifyBroadcastTargets, NotifySendFailure, NotifySendReport } from '../../engine/notify/broadcast.ts'
import type { ServeConfig } from './config-types.ts'

/** notify 发送者缺省工号（M5 尾 plan/09 §二#3：制作人神号锚——与 conversationDefaultPerson 缺省同源） */
export const DEFAULT_CHATD_NOTIFY_SENDER_ID = 'PRIME-0'

/** 工号样式（conversationDefaultPerson 同款正则——config.ts:571 单一形态判例） */
const PERSON_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

// ————————————————————————— 传输端口（结构同形；@studio-next/workbench-transport 直连） —————————————————————————

/**
 * 面所需的 transport 最小面（WorkbenchTransport 结构满足——ChatdTransportPort 同款判例：
 * 方法双变下 token 附加形参可传入，真实 client 把 params 原样序列化上帧，服务端
 * params.token 常时比较恰好收到；注入面留给测试 mock 与组装单元，本面不感知 socket 细节）。
 */
export interface ChatdNotifyTransportPort {
  sendMessage(input: { roomId: string; senderId: string; body: string; mentions?: readonly string[]; idempotencyKey?: string; token?: string }): Promise<SendResult>
}

/** chatd 通知面选项（transport 注入或缺省按 socketPath 自建——ChatdMentionSourceOptions 同形） */
export interface ChatdNotifyFaceOptions {
  /** Unix socket 路径（chatd 生产约定 <companyDir>/var/workbench/chat.sock） */
  readonly socketPath: string
  /** 通知目标房间（daemon.yaml notifyChatdRoomId——三逻辑角色折叠投递的单一落点） */
  readonly roomId: string
  /** 发送者工号（消息 senderId；缺省 PRIME-0 由装配面供给） */
  readonly senderId: string
  /** 传输客户端注入面（测试 mock/组装复用）；缺省按 socketPath 自建 WorkbenchTransport */
  readonly transport?: ChatdNotifyTransportPort
  /** 鉴权 token（值经 env WORKBENCH_CHATD_TOKEN 由组装单元供给；永不入 yaml/日志/台账） */
  readonly token?: string
  /** 房间显示名（仅日志标签用；缺省=roomId——面不拉 rooms.list，零额外请求） */
  readonly channelName?: string
  /** 自建 transport 的连接超时，默认 1000ms（client.ts:36）；boot 组合根缺省显式传 5000（P1 加固） */
  readonly connectTimeoutMs?: number
  /** 自建 transport 的请求超时，默认 2000ms（client.ts:37）；boot 组合根缺省显式传 10000（P1 加固） */
  readonly requestTimeoutMs?: number
  /** 日志出口（缺省 console.log；行均带 [chatd-notify] 前缀） */
  readonly log?: (line: string) => void
}

// ————————————————————————— 纯文本格式化（chatd 房间无 markdown 渲染面） —————————————————————————

/**
 * Notification → chatd 纯文本（packages/matrix/src/format.ts 的无 markdown 同形：
 * `[kind] title` / body / `- label: url` / `—— from`；**title 不加 `**` 加粗**——chatd
 * 消息体按原文渲染，markdown 记号只会变成字面噪音）。
 */
export function formatChatdNotification(n: Notification): string {
  const lines: string[] = []
  const kind = n.kind.trim()
  const title = n.title.trim()
  if (kind !== '' || title !== '') lines.push(`${kind !== '' ? `[${kind}] ` : ''}${title}`.trim())
  const body = n.body.replace(/\s+$/, '')
  if (body !== '') lines.push(body)
  for (const link of n.links ?? []) {
    const url = link.url.trim()
    if (url === '') continue
    const label = link.label.trim()
    lines.push(`- ${label !== '' ? label : url}: ${url}`)
  }
  const from = n.from?.trim() ?? ''
  if (from !== '') lines.push(`—— ${from}`)
  return lines.join('\n')
}

// ————————————————————————— 面实现 —————————————————————————

/**
 * chatd 通知面工厂：send(message, targets) → 逐不同 roomId 恰一条 messages.send。
 * never throws（软失败入 report.failed——刀B-6 同契约；relay 侧另有双保险，本面是第一道）。
 * socket 生命周期：面自建的 transport 惰性连接（首请求才 connect）、进程存续期持有——
 * NotifyBroadcastFace 端口无 stop 面（matrix 面持 client 同款），进程退出由 OS 收口。
 */
export function createChatdNotifyFace(options: ChatdNotifyFaceOptions): NotifyBroadcastFace {
  const log = options.log ?? ((): void => {})
  const auth = options.token !== undefined && options.token !== '' ? { token: options.token } : {}
  /** 失败面文本的 token 值替换（面自持自扫——见 sendToRoom 注） */
  const scrubToken = (text: string): string => (auth.token !== undefined ? text.split(auth.token).join('<redacted:chatd-token>') : text)
  const transport: ChatdNotifyTransportPort =
    options.transport ??
    new WorkbenchTransport({
      socketPath: options.socketPath,
      ...(options.connectTimeoutMs !== undefined ? { connectTimeoutMs: options.connectTimeoutMs } : {}),
      ...(options.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    })

  async function sendToRoom(roles: readonly string[], roomId: string, message: Notification): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      // 幂等键恒不携带（头注决策：无重试面；内容哈希键会吞并同文异事件通知）
      await transport.sendMessage({ roomId, senderId: options.senderId, body: formatChatdNotification(message), ...auth })
      return { ok: true }
    } catch (err) {
      const c = classifyChatdError(err)
      const target = roles.length === 1 ? (roles[0] ?? '') : roles.join('+')
      const label = roomId === options.roomId ? (options.channelName ?? roomId) : roomId
      // 已知值自扫（AGENTS 纪律 6「密钥永不入库/日志」）：err.message 理论可携带回显文本
      // （chatd 服务端现行鉴权错固定文案不回显 token——apps/workbench-chatd/server.ts:404-405；
      // 本面自持 token 故面内替换，不依赖出站闸的 env 收集面未含 WORKBENCH_CHATD_TOKEN 的现状）
      const reason = scrubToken(`${c.readable}（分类=${c.kind}，code=${c.code}）`)
      log(`[chatd-notify] ${target} 软失败（room=${label}，分类=${c.kind}，code=${c.code}；面板仍是 critical 第一落点——plan/09 §二#3）：${reason}`)
      return { ok: false, reason }
    }
  }

  return {
    async send(message: Notification, targets: NotifyBroadcastTargets): Promise<NotifySendReport> {
      // 角色 → 房间折叠表：三逻辑角色共投配置房；显式 room 直投（同房并入同一条——每房恰一条）
      const perRoom = new Map<string, string[]>()
      const logical: string[] = []
      if (targets.alert === true) logical.push('alert')
      if (targets.overview === true) logical.push('overview')
      if (targets.dept !== undefined && targets.dept !== '') logical.push(`dept:${targets.dept}`)
      if (logical.length > 0) perRoom.set(options.roomId, logical)
      if (targets.room !== undefined && targets.room !== '') {
        const merged = perRoom.get(targets.room)
        if (merged === undefined) perRoom.set(targets.room, ['room'])
        else merged.push('room')
      }
      const sent: string[] = []
      const failed: NotifySendFailure[] = []
      for (const [roomId, roles] of perRoom) {
        const r = await sendToRoom(roles, roomId, message)
        if (r.ok) sent.push(...roles)
        else failed.push({ target: roles.length === 1 ? (roles[0] ?? '') : roles.join('+'), reason: r.reason })
      }
      return { sent, failed }
    },
  }
}

// ————————————————————————— 配置收口（config.ts switch/尾段收口到此；判例=chatd-mention-source） —————————————————————————

/**
 * chatd 通知面键解析（config.ts switch 显式 case 收口；缺省/交叉校验分离）：
 *   - notifyChatdRoomId：非空字符串（trim 后空=CONFIG_INVALID——roomId 定位不许含糊）；
 *   - notifyChatdSenderId：工号样式（如 PRIME-0；conversationDefaultPerson 同款形态）。
 */
export function coerceChatdNotifyKey(cfg: ServeConfig, key: string, value: unknown, helpers: ChatdServeKeyHelpers): void {
  if (key === 'notifyChatdRoomId') {
    const v = helpers.str(value, key).trim()
    if (v === '') throw new Error(`daemon.yaml：notifyChatdRoomId 须为非空字符串（chatd 房间 roomId；实得空值）`)
    cfg.notifyChatdRoomId = v
    return
  }
  if (key === 'notifyChatdSenderId') {
    const v = helpers.str(value, key).trim()
    if (!PERSON_ID_PATTERN.test(v)) {
      throw new Error(`daemon.yaml：notifyChatdSenderId 须为工号样式（如 PRIME-0；实得 ${v}）`)
    }
    cfg.notifyChatdSenderId = v
    return
  }
}

/**
 * chatd 通知面交叉校验（config.ts 尾段收口；两键全缺=零交叉零推导——既有路径零漂移）：
 *   - 孤儿 senderId（无 roomId）=CONFIG_INVALID（成键纪律：键在场即被消费，不静默忽略）；
 *   - 与 matrixChannels: true 互斥（notify 广播面单一出口——matrix 面持有即不可再开 chatd 面）；
 *   - 与 matrix: true 互斥（boot 只在 matrix: false 注入 chatd notify 面——键在场不被消费
 *     =配置漂移，明报拒启）；
 *   - chatdSocket 复用 mention 源键：mention 源已推导（validateChatdMentionCross 先跑）则
 *     直通；未推导时按同款缺省 <companyDir>/var/workbench/chat.sock 推导（无 companyDir
 *     又未显式配=CONFIG_INVALID，不猜 cwd 相对路径）。
 */
export function validateChatdNotifyCross(cfg: ServeConfig): void {
  if (cfg.notifyChatdRoomId === undefined && cfg.notifyChatdSenderId === undefined) return
  if (cfg.notifyChatdRoomId === undefined) {
    throw new Error('daemon.yaml：notifyChatdSenderId 单独在场缺 notifyChatdRoomId（成对键——senderId 无 roomId 无消费面，见 serve 骨架注释）')
  }
  if (cfg.matrixChannels) {
    throw new Error('CONFIG_INVALID：notifyChatdRoomId 与 matrixChannels: true 互斥（notify 广播面单一出口——matrix 面已持有；双开=双写，mention 互斥同判例）')
  }
  if (cfg.matrix) {
    throw new Error('CONFIG_INVALID：notifyChatdRoomId 与 matrix: true 互斥（chatd notify 面只在 matrix: false 注入——键在场不被消费=配置漂移）')
  }
  if (cfg.chatdSocket === undefined) {
    if (cfg.companyDir === undefined || cfg.companyDir.trim() === '') {
      throw new Error('CONFIG_INVALID：notifyChatdRoomId 缺 chatdSocket 且无 companyDir 可推导缺省（<companyDir>/var/workbench/chat.sock）——显式配绝对路径')
    }
    cfg.chatdSocket = join(resolve(cfg.companyDir), 'var/workbench/chat.sock')
  }
}
