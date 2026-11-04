/**
 * engine/conversation/panel-dispatch —— 面板源消息派单 watcher（studio-dev-654b 的 C 路）
 *
 * 依据：docs/21-§七.4（面板→岗位派单：`dispatchedSeq` 独立游标／复用轮次物化／不重复 append／
 * 防回环／拍内每工号最多派 1 条）／§七.5 验收 2、3；docs/v2/14-§8.1（派单失败面）。
 *
 * 反屎山声明：
 *   - **不重复实现**：轮次物化走公共件 `materializeTurn`（与 Matrix 入站 consume 同源）；
 *     消息已由面板进程落盘（本件**绝不 appendMessage**）。
 *   - **防回环/防双派**：只处理 `source='panel'` 的 producer 消息；Matrix 入站/员工回复不处理。
 *   - **崩溃重派防护**：materialize 前用幂等 eventId（`panel:<消息行 id>`）查 `store.turnByEvent`，
 *     已有轮次=已派过 → 只推进游标不建单（消除「建单成功→游标未落盘→崩→重派」重复面）。
 *   - **无绕道吞错**：失败进 `errors`（TickReport 可见）且**不推进游标**（下一拍重试）；永久无效
 *     （非本司人员/房不在白名单）明报后推进游标，避免 head-of-line 卡死。
 *
 * 边界：拍边界同步调用（drain 内）；不新增事件词表/契约面；不读文件（走 store 读面）。
 */
import type { EventRecord, FlowPlatform, InvokeIntent, IssueRecord, TicketId } from '@studio-next/contract'
import type { ConversationTickDeps } from './consume.ts'
import { createConversationTurn, finishConversationTurn } from './materialize.ts'
import { panelSourceOf, panelVisibleRows } from './panel-map.ts'
import { createRelayStateStore } from './relay-state.ts'

/** watcher 依赖（drain 拍作用域；与 consume 同源注入） */
export interface PanelDispatchDeps {
  readonly conversation: ConversationTickDeps & { readonly statePath: string }
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
  readonly people: ReadonlyArray<{ id: string; dept?: string }>
}

/** 拍边界派单（每工号最多 1 条；返回本拍派发数，主要供测试/观测） */
export async function dispatchPanelPending(deps: PanelDispatchDeps): Promise<number> {
  const { store, config } = deps.conversation
  const log = deps.conversation.log ?? ((): void => {})
  const stateStore = createRelayStateStore(deps.conversation.statePath, log)
  const known = new Set(deps.people.map((person) => person.id))
  let dispatched = 0

  for (const person of store.personIds()) {
    // 首跑/迁移期 bootstrap（studio-dev-706，docs/21-§七.4）：无 dispatchedSeq 时以
    // relayedSeq（若有）或当前最大可见 seq 初始化——**历史面板消息不回填**；之后新消息照常派。
    let cursor = stateStore.dispatchedSeq(person)
    if (!stateStore.hasDispatchedSeq(person)) {
      const allRows = panelVisibleRows(store.visibleRecords(person))
      const maxVisibleSeq = allRows.length > 0 ? (allRows[allRows.length - 1]?.seq ?? 0) : 0
      const relayed = stateStore.relayedSeq(person)
      const initial = relayed > 0 ? Math.min(relayed, maxVisibleSeq) : maxVisibleSeq
      stateStore.updateDispatched(person, initial)
      cursor = initial
      log(
        `[conversation] 面板派单游标初始化：person=${person} dispatchedSeq=${String(initial)}` +
          `（历史不回填；relayedSeq=${String(relayed)} maxVisibleSeq=${String(maxVisibleSeq)}）`,
      )
    }
    const pending = panelVisibleRows(store.visibleRecords(person)).filter(
      (row) => row.seq > cursor && row.row.kind === 'msg' && row.row.role === 'producer' && panelSourceOf(row.row) === 'panel',
    )
    if (pending.length === 0) continue
    const next = pending[0]
    if (next === undefined) continue
    const row = next.row
    if (row.kind !== 'msg') continue
    // 永久无效面：明报并推进游标（不 head-of-line 卡死；不猜/不伪造）
    if (!known.has(person)) {
      deps.errors.push(`面板派单：工号 ${person} 不在人事索引（seq=${String(next.seq)}）——跳过并推进游标（需 /bind 或人事修正）`)
      stateStore.updateDispatched(person, next.seq)
      continue
    }
    if (!config.rooms.includes(row.room)) {
      deps.errors.push(`面板派单：房间 ${row.room} 不在 conversationRooms 白名单（person=${person} seq=${String(next.seq)}）——跳过并推进游标`)
      stateStore.updateDispatched(person, next.seq)
      continue
    }

    // 幂等口径：面板消息行 id 稳定（append-only）；同键已有轮次=已派过（崩溃重派防护）
    const eventId = `panel:${row.id}`
    const existingTurn = store.turnByEvent(person, eventId)
    if (existingTurn !== undefined) {
      stateStore.updateDispatched(person, next.seq)
      log(`[conversation] 面板派单：${eventId} 已有轮次（${existingTurn.issue}）——只推进游标不重复建单`)
      continue
    }

    // 上下文窗口排除本轮（consume「先取窗口再追加」同语义；面板消息已先落盘）
    const window = store.context(person, row.room, {
      limit: config.window,
      maxChars: config.maxChars,
      excludeIds: [row.id],
    })
    const payload = {
      target: '',
      mention: 'DM',
      text: row.text,
      eventId,
      sender: config.producer,
      room: row.room,
      channel: '',
      conversation: { v: 1 },
    }
    const intent: InvokeIntent = {
      kind: 'mention',
      company: config.company,
      source: 'panel-conversation',
      payload,
      dedupKey: eventId,
    }
    const materializeInput = {
      person,
      room: row.room,
      text: row.text,
      eventId,
      attempt: 1,
      window,
      intent,
      intentKey: eventId,
      sender: config.producer,
      origin: 'panel' as const,
    }
    const created = await createConversationTurn(deps, materializeInput)
    if (created === undefined) {
      // create 失败：errors 已由 createConversationTurn 记；游标不推进（下一拍重试，不丢）
      continue
    }
    finishConversationTurn(deps, created, materializeInput)
    stateStore.updateDispatched(person, next.seq)
    dispatched += 1
    log(`[conversation] 面板派单：${eventId} → ${created.id}（person=${person} seq=${String(next.seq)}）`)
  }
  return dispatched
}
