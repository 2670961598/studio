/**
 * 制作人-岗位持久对话 · 入站消费件（房间消息 → 会话存储 → 单轮唤醒单）
 *
 * 协议依据：docs/21-§七.2/§七.3（绑定/入站/窗口策略）、docs/v2/14-§1.9（CONV 会话面：
 * 复用 `InvokeIntent{kind:'mention'}` 与 `dedupKey=eventId`，零新 kind/零新事件名）。
 *
 * 分流条件：drain 分发表把 `mention` 意图中 payload 带 `conversation:{v:1}` 者转给本件；
 * 其余 mention 仍走既有 @唤醒消费件（`isConversationPayload` 单点判定，不双派单）。
 *
 * 边界（docs/21-§七.5）：
 *   - 会话正文/历史/clear 不进 Taiga、不进公司 git 契约包；台账只落一条 PATROL 审计锚；
 *   - 轮次执行载体=既有单轮唤醒单（标题 `[对话]` 前缀，可过滤），单不承载会话状态；
 *   - 命令（/bind｜/clear｜/status｜/help）就地处理，不派单、不建单。
 *
 * 失败面：所有失败进 `errors`（TickReport 可见）并丢弃/停止本轮——不静默、不臆造。
 */
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord, PersonId, TicketId } from '@studio-next/contract'
import { createConversationTurn, finishConversationTurn } from './materialize.ts'
import { isConversationPayload, parseConversationCommand } from './protocol.ts'
import type { ConversationStore } from './store.ts'

/** 会话运行时配置（daemon.yaml conversation* 键的解析产物；装配面注入） */
export interface ConversationRuntimeConfig {
  company: string
  /** 制作人 MXID（命令鉴权与入站白名单的第二道；源侧已过滤一次） */
  producer: string
  /** 未绑定 DM 房的缺省岗位（缺省 PRIME-0 宰相） */
  defaultPerson: PersonId
  /** DM 房白名单（room_id） */
  rooms: readonly string[]
  /** 上下文窗口条数（docs/21-§七.3 缺省 12） */
  window: number
  /** 上下文总字数预算（缺省 6000） */
  maxChars: number
  /** 单条消息注入上限（缺省 2000） */
  maxMessageChars: number
}

/** 引擎 tick 作用域依赖（state-diff → drain 注入；零持有引擎内部状态） */
export interface ConversationTickDeps {
  store: ConversationStore
  config: ConversationRuntimeConfig
  /** 面板派单游标状态文件（<companyDir>/var/conversations/.relay-state.json；缺省=面板派单面关） */
  statePath?: string
  /** 观测面（缺省静默）；只在装配/命令面用，不写会话正文 */
  log?: (line: string) => void
}

/** drain 侧消费件依赖（与既有 consumerDeps 同源注入 + 会话面两件） */
export interface ConversationConsumerDeps {
  conversation: ConversationTickDeps
  platform: FlowPlatform
  syncMirror: (issue: IssueRecord) => void
  makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  tickEvents: EventRecord[]
  people: ReadonlyArray<{ id: string; dept?: string }>
  errors: string[]
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  drainSeen: Set<string>
  onMutation: () => void
}

/** 会话消费件（mention 分流入口；命令/入站两态） */
export function createConversationConsumer(
  deps: ConversationConsumerDeps,
): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  const { store, config } = deps.conversation
  const ack = (room: string, person: string, text: string): void => {
    store.enqueueReply({ person, room, text, kind: 'notice' })
  }
  const isKnownPerson = (id: string): boolean => deps.people.some((p) => p.id === id)

  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    if (!isConversationPayload(intent.payload)) {
      deps.errors.push(`会话消费：conversation 分流标记形状不符（intent=${intentKey}）——丢弃`)
      return
    }
    const payload = intent.payload
    if (payload.sender !== config.producer) {
      deps.errors.push(`会话消费：非制作人发送者 ${payload.sender}（room=${payload.room}）——丢弃（频道内容不可信）`)
      return
    }
    if (!config.rooms.includes(payload.room)) {
      deps.errors.push(`会话消费：房间不在 conversationRooms 白名单（${payload.room}）——丢弃`)
      return
    }
    if (intent.dedupKey !== payload.eventId) {
      deps.errors.push(`会话消费：dedupKey≠payload.eventId（${String(intent.dedupKey)} vs ${payload.eventId}）——丢弃（幂等键源侧契约）`)
      return
    }

    // ① 命令面（制作人专属；命令不派单）
    const command = parseConversationCommand(payload.text)
    if (command !== undefined) {
      handleCommand(command)
      deps.drainSeen.add(intentKey)
      return
    }

    // ② 绑定解析（未绑定=缺省岗位，审计 reason=default；绑定是会话事实，不是房间拓扑猜测）
    let binding = store.bindingOf(payload.room)
    if (binding === undefined) {
      if (!isKnownPerson(config.defaultPerson)) {
        deps.errors.push(`会话消费：缺省岗位 ${config.defaultPerson} 不在人事索引——丢弃（不猜绑定的回退）`)
        return
      }
      const bound = store.bind(payload.room, config.defaultPerson, config.producer, 'default')
      binding = { person: bound.person, at: bound.at, reason: 'default', by: bound.by }
      const note = `已按缺省绑定岗位 ${config.defaultPerson}（本房未 /bind；可发 /bind <工号> 切换）`
      store.appendMessage({ person: bound.person, room: payload.room, role: 'system', text: note })
      ack(payload.room, bound.person, note)
      deps.conversation.log?.(`[conversation] 房间 ${payload.room} 缺省绑定 ${config.defaultPerson}（reason=default）`)
    }
    const person = binding.person
    if (!isKnownPerson(person)) {
      deps.errors.push(`会话消费：绑定岗位 ${person} 不在人事索引（room=${payload.room}）——丢弃（/bind 修正）`)
      return
    }
    // 跨重启幂等：同 eventId 已入该人会话 → 不重复派单
    if (store.hasEvent(person, payload.eventId)) {
      deps.drainSeen.add(intentKey)
      return
    }

    // ③ 上下文窗口（先取窗口再追加本轮，避免本轮重复进历史）
    const window = store.context(person, payload.room, { limit: config.window, maxChars: config.maxChars })
    const materializeInput = {
      person,
      room: payload.room,
      text: payload.text,
      eventId: payload.eventId,
      attempt: 1,
      window,
      intent,
      intentKey,
      sender: payload.sender,
      origin: 'matrix' as const,
    }

    // ④ 先建单（失败=本轮未入队：不 append/不标记 drainSeen → 重投可重试，不静默丢消息）
    const created = await createConversationTurn(deps, materializeInput)
    if (created === undefined) return

    // ⑤ 会话落盘（写失败明报但不回滚已建单：出站仍能按轮次回房间）
    try {
      const appended = store.appendMessage({
        person,
        room: payload.room,
        role: 'producer',
        text: payload.text,
        eventId: payload.eventId,
      })
      if (appended === undefined) {
        deps.errors.push(`会话消费：消息 ${payload.eventId} 已在会话中（幂等命中）——不重复派单`)
        return
      }
    } catch (err) {
      deps.errors.push(
        `会话消费：会话落盘失败（event=${payload.eventId}）：${err instanceof Error ? err.message : String(err)}——本轮不回信（人工核对 conversations/）`,
      )
    }

    // ⑥ 轮次锚＋PATROL＋候选（公共件与面板派单同源）
    finishConversationTurn(deps, created, materializeInput)
    deps.drainSeen.add(intentKey)

    function handleCommand(cmd: NonNullable<ReturnType<typeof parseConversationCommand>>): void {
      const current = store.bindingOf(payload.room)
      const currentPerson = current?.person ?? config.defaultPerson
      switch (cmd.name) {
        case 'bind': {
          if (cmd.person === undefined) {
            ack(payload.room, currentPerson, `当前绑定：${currentPerson}（${current?.reason ?? '未绑定'}）。用法：/bind <工号>`)
            deps.drainSeen.add(intentKey)
            return
          }
          const target = cmd.person
          if (!isKnownPerson(target)) {
            ack(payload.room, currentPerson, `未找到工号 ${target}（人事索引无此人）；未改动绑定。`)
            deps.drainSeen.add(intentKey)
            return
          }
          store.bind(payload.room, target, payload.sender, 'explicit')
          store.appendMessage({ person: target, room: payload.room, role: 'system', text: `制作人 /bind ${target}（由 ${payload.sender}）` })
          ack(payload.room, target, `已绑定本房到 ${target}。后续消息按该岗位的持久会话处理；/clear 只清上下文、保留审计。`)
          deps.conversation.log?.(`[conversation] 房间 ${payload.room} 显式绑定 ${target}（by=${payload.sender}）`)
          deps.drainSeen.add(intentKey)
          return
        }
        case 'clear': {
          const receipt = store.clear(payload.room, currentPerson, payload.sender, cmd.reason)
          ack(
            payload.room,
            currentPerson,
            `已清空上下文（${receipt.count} 条；审计行保留：谁/何时/清空前最后消息 id=${receipt.before ?? '无'}）。绑定仍为 ${currentPerson}。`,
          )
          deps.conversation.log?.(`[conversation] /clear room=${payload.room} person=${currentPerson} count=${receipt.count}`)
          deps.drainSeen.add(intentKey)
          return
        }
        case 'status': {
          const stats = store.stats(currentPerson)
          ack(
            payload.room,
            currentPerson,
            `绑定：${currentPerson}（${current?.reason ?? '未绑定'}）；会话消息 ${stats.messages} 条、轮次 ${stats.turns}、待送达 ${stats.pendingReplies}。`,
          )
          deps.drainSeen.add(intentKey)
          return
        }
        case 'help': {
          ack(
            payload.room,
            currentPerson,
            '命令：/bind <工号> 绑定本房岗位；/clear [原因] 清空上下文（留审计）；/status 状态；/help 帮助。不 @ 也可直接说话。',
          )
          deps.drainSeen.add(intentKey)
          return
        }
        default: {
          ack(payload.room, currentPerson, `未知命令「${cmd.raw}」；/help 查看可用命令。`)
          deps.drainSeen.add(intentKey)
        }
      }
    }
  }
}
