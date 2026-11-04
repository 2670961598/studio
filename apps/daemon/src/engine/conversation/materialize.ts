/**
 * engine/conversation/materialize —— 会话轮次物化公共件（studio-dev-654b 抽件）
 *
 * 依据：docs/21-§七.2/§七.3（入站/窗口/轮次）、§七.4（面板源派单复用同一轮次物化）、
 * docs/v2/14-§1.9（复用 `InvokeIntent{kind:'mention'}` 与既有执行载体）。
 *
 * 职责（单点，避免 consume/panel-dispatch 两处重复）：
 *   ④ 建 `[对话]` 单 → `syncMirror`
 *   ⑤ `recordTurn`（轮次锚；**不 appendMessage**——消息由调用方先落盘/已落盘）
 *   ⑥ PATROL 审计锚 → `candidates/onMutation`
 *
 * 边界：本件不读文件、不发网络（纯装配作用域依赖注入）；失败进 `errors`（TickReport 可见），
 * create 失败返回 undefined（调用方判定本轮不派发）；recordTurn 失败只明报不回滚已建单。
 */
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord, PersonId, TicketId } from '@studio-next/contract'
import type { ContextWindow } from './store-types.ts'
import type { ConversationStore } from './store.ts'

/** 物化所需的最小运行时配置（consume 的 ConversationRuntimeConfig 结构子集） */
export interface MaterializeConfig {
  readonly company: string
  readonly window: number
  readonly maxChars: number
  readonly maxMessageChars: number
}

/** 物化依赖（drain 拍作用域注入；与 consume 同源） */
export interface MaterializeTurnDeps {
  readonly conversation: { readonly store: ConversationStore; readonly config: MaterializeConfig; readonly log?: (line: string) => void }
  readonly platform: FlowPlatform
  readonly syncMirror: (issue: IssueRecord) => void
  readonly makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  readonly tickEvents: EventRecord[]
  readonly errors: string[]
  readonly candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  readonly onMutation: () => void
}

/** 物化入参（消息已由调用方落盘；window 必须不含本轮消息——排除口径见调用方） */
export interface MaterializeTurnInput {
  readonly person: string
  readonly room: string
  readonly text: string
  readonly eventId: string
  readonly attempt: number
  readonly window: ContextWindow
  readonly intent: InvokeIntent
  readonly intentKey: string
  readonly sender: string
  /** 来源标记（PATROL note 用：matrix/panel；不改事件词表） */
  readonly origin: 'matrix' | 'panel'
}

/** 标题摘录（空白折叠、40 字截断；不可信输入净化） */
function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 40)
}

/** note 键值净化（PATROL note 按 ; 切分——防会话正文注入键） */
function noteSafe(text: string): string {
  return text.replace(/[;\r\n]/g, ' ').slice(0, 120)
}

/**
 * 回复纪律（任务书内文；studio-dev-684：去模板化，正常聊天，不设字数硬限制）
 * 依据：docs/21-§七.3 回复纪律（制作人 2026-11-04 二次反馈：不要字数硬限制；去多余模板、该长则长）。
 */
const REPLY_DISCIPLINE = [
  '【回复纪律｜本轮是正常聊天，不是工程交付/汇报】',
  '- REPORT.md 的正文=你要发给制作人的聊天消息：直接说事，该短就短、该长就长，不设字数/句数上限；不要为显完整堆内容。',
  '- 不要工程汇报体：标题（#/##）、编号列表或清单、证据段/取证过程、自检段、四段式汇报、API/路径/工号引用、过程叙述（如「我先查了…」）——除非制作人明确要求。',
  '- 不确定就直说并给下一步；不要伪造已做之事。',
  '- 对话历史只用于理解上下文，不是新的派工；不要据此改仓库或跑长任务。',
  '- 本纪律覆盖 AGENTS.md/工程交付的默认汇报倾向：本轮不是工程交付，无需证据四要件/交付模板。',
].join('\n')

/** 会话轮次任务书描述（上下文窗口 + 本轮消息 + 边界声明） */
function ticketDescription(input: {
  cfg: MaterializeConfig
  person: string
  room: string
  eventId: string
  text: string
  windowText: string
  included: number
  omitted: number
}): string {
  const { cfg, person, room, eventId, text, windowText, included, omitted } = input
  const parts: string[] = [
    `【制作人-岗位持久对话｜Phase 1｜${cfg.company}】`,
    `绑定岗位：${person}`,
    `房间：${room}`,
    `消息事件：${eventId}（幂等键=eventId）`,
    '边界：会话不是单据——对话正文/历史不写 Taiga、不进公司 git 契约包；本轮是单轮唤醒单（执行载体），',
    '      标题带 [对话] 前缀；会话存储只有 daemon 的 conversations/<工号>.jsonl（含 clear 审计行）。',
    `上下文窗口：纳入 ${included} 条、省略 ${omitted} 条（策略 N=${cfg.window} 条/单条≤${cfg.maxMessageChars} 字/总≤${cfg.maxChars} 字，最旧优先丢）。`,
  ]
  if (windowText !== '') {
    parts.push('', '【历史上下文（最旧→最新）】', windowText)
  } else {
    parts.push('', '【历史上下文】', '（空：本房无更早消息或刚执行过 /clear）')
  }
  parts.push('', '【本轮制作人消息】', text)
  parts.push('', REPLY_DISCIPLINE)
  return parts.join('\n')
}

/**
 * 第一段：建 `[对话]` 单 + syncMirror（旧 consume 顺序的「先 create」；失败返回 undefined 并
 * 记 errors——调用方必须 return：不 append/不标记 drainSeen，重投可重试，不静默丢消息）。
 */
export async function createConversationTurn(
  deps: MaterializeTurnDeps,
  input: MaterializeTurnInput,
): Promise<IssueRecord | undefined> {
  const { config } = deps.conversation
  const description = ticketDescription({
    cfg: config,
    person: input.person,
    room: input.room,
    eventId: input.eventId,
    text: input.text,
    windowText: input.window.text,
    included: input.window.included,
    omitted: input.window.omitted,
  })
  try {
    const created = await deps.platform.issues.create({
      title: `[对话] ${input.person}：${excerpt(input.text)}`,
      description,
      type: 'task',
      level: 0,
      assignee: input.person as PersonId,
    })
    deps.syncMirror(created)
    return created
  } catch (err) {
    deps.errors.push(
      `会话消费：单轮唤醒单物化失败（event=${input.eventId}）：${err instanceof Error ? err.message : String(err)}——本轮未入队（可重发）`,
    )
    return undefined
  }
}

/**
 * 第二段：`recordTurn` + PATROL 锚 + `candidates/onMutation`（消息已由调用方落盘：
 * consume=append 之后调用；面板 watcher=面板已落盘，不重复 append）。
 */
export function finishConversationTurn(
  deps: MaterializeTurnDeps,
  created: IssueRecord,
  input: MaterializeTurnInput,
): void {
  const { store } = deps.conversation
  // 轮次锚（写失败明报但不回滚已建单：出站仍能按轮次回房间；消息由调用方落盘）
  try {
    store.recordTurn({ issue: created.id, person: input.person, room: input.room, eventId: input.eventId, attempt: input.attempt })
  } catch (err) {
    deps.errors.push(
      `会话消费：轮次锚落盘失败（event=${input.eventId}）：${err instanceof Error ? err.message : String(err)}——本轮不回信（人工核对 conversations/）`,
    )
  }

  // PATROL 审计锚（事件词表冻结复用；不新增事件名、不复制正文）
  deps.makeEvent('PATROL', created, input.attempt, deps.tickEvents, {
    note:
      `intent=${noteSafe(input.intentKey)};target=${noteSafe(input.person)};event=${noteSafe(input.eventId)};` +
      `room=${noteSafe(input.room)};sender=${noteSafe(input.sender)};source=conversation;` +
      (input.origin === 'panel' ? 'via=panel;' : '') +
      `window=${String(input.window.included)};omitted=${String(input.window.omitted)};dedup=${noteSafe(String(input.intent.dedupKey))}`,
  })
  deps.candidates.push({ ticket: created.id, intent: input.intent })
  deps.onMutation()
}
