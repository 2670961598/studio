/**
 * todoqueue —— 员工待办队列域件（129-§6.2，studio-dev-167 单B，制作人 2026-10-22 全批）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§2 主循环七相位（四闸序冻结：断路 > 泳道 > **人** > 每拍 > 在途——本单
 *     把 129-§6.2-R3 人闸插进并发闸链；七相位不动，投影写落在相位 7 尾=hrSync drain
 *     同款「相位缝」）。
 *   - 129-§6.2-R1/R4 排序键冻结公式（值域单一源=packages/core/src/queue.ts）：
 *     score = clampPriority(意图优先级 0..3) + ageBoostTier(wait, step)（离散两档封顶）；
 *     pinned=+∞ 恒首；并列 FIFO（first_seen_at 升序 → 单号升序全序，确定性可重放）。
 *   - 129-§6.2-R2 todo_queue 投影语义：**可重建投影非事实源**——成员资格×person 全由
 *     ticket_mirror 重导；**决策永不读表**（派发排序拍内实时算）；表只作面板 inbox/
 *     观测投影。单写者=daemon，每拍末全量重投、diff 才写（全量换行不增量对账——镜像
 *     upsert 同款「整批换」语义在 store/ledger.replaceTodoQueue）。
 *
 * 域件职责（engine.ts 2034 行，20-§十五「先拆再增」——排序键/携带态/投影/配置解析
 * 全部收在本文件，engine 只留接线缝）：
 *   - 携带态 QueueCarry（first_seen_at FIFO 锚 + 峰值优先级 + 入队归因）：非事件可导
 *     携带列（jobs.last_run_at 先例）——启动从 todo_queue 表种子（seqSeed 同款恢复面），
 *     拍内 touch/drop，派发即出队；GATE_FAIL 回滚再入队=新钟（attempt 轮次已可区分，
 *     不做跨轮持久）。
 *   - 候选定序 orderCandidates：生命周期候选（收割/合并/回收链——原序）在前，队列
 *     候选（可前向到派发锚点者）全局排序在后（129 plan §3 落定：收割回收先于新派发；
 *     每拍上限约束下高分者优先过闸）。
 *   - 投影 projectTodoQueue：纯函数（镜像集→todo_queue 行集）——写面与判负线⑦的
 *     读回核对共用同一函数（零漂移）。
 *   - daemon.yaml 扁平键解析（matrixRoles 先例的工号=值分号对）：personInflightOverrides /
 *     pinnedTickets 坏形态明报（CONFIG_INVALID 语义——由调用面抛出件收口）。
 *
 * 诚实边界（129-B 不做，登记在案）：
 *   - 置顶（pinned）平台字段写通道归刀B——现只有 daemon.yaml pinnedTickets 配置面
 *     （改配置即刻生效，不入携带态）；
 *   - QueueRanker 注入位=160-B 小模型档升级位；本单恒用规则缺省档（core rankQueue）。
 */
import type { InvokeIntent, TicketId } from '@studio-next/contract'
import {
  ageBoostTier,
  clampPriority,
  DEFAULT_QUEUE_AGE_STEP_MS,
  flowAnchors,
  rankQueue,
  type QueueEntryRank,
  type QueueRanker,
  type StateFlow,
} from '@studio-next/core'
import type { TodoQueueRecord } from '@studio-next/store'

// ————————————————————————— 携带态 —————————————————————————

/** 队列携带条目（引擎内存态；启动自 todo_queue 表种子——FIFO 锚不因重启漂移） */
export interface QueueCarryEntry {
  /** 首次入队 epoch-ms（FIFO 锚；派发即出队，回滚再入队=新钟） */
  firstSeenAt: number
  /** 峰值钳后优先级 0..3（插队不抢占：更高意图只抬排序，落地在下一拍队首） */
  priority: number
  /** 入队归因（`源|kind`，人读——面板 why 列） */
  why?: string
}

/** 携带态：ticket → 条目（单写者=daemon 拍内；GC 见 projectTodoQueue 尾注） */
export type QueueCarry = Map<TicketId, QueueCarryEntry>

/** 启动种子（seqSeed 先例：重启后 FIFO 锚续用，投影可重建性兜底） */
export function seedQueueCarry(rows: readonly TodoQueueRecord[]): QueueCarry {
  const carry: QueueCarry = new Map()
  for (const row of rows) {
    carry.set(row.ticket, {
      firstSeenAt: row.first_seen_at,
      priority: clampPriority(row.priority),
      ...(row.why !== undefined ? { why: row.why } : {}),
    })
  }
  return carry
}

/**
 * 候选触队（拍内）：未见者种钟（firstSeenAt=本拍起点），见者抬峰不重种——
 * 同拍内同单多意图（活动+rescan）只钟一次；意图优先级取历史峰（钳后）。
 */
export function touchQueueCarry(carry: QueueCarry, ticket: TicketId, intent: InvokeIntent, at: number): QueueCarryEntry {
  const existing = carry.get(ticket)
  const priority = clampPriority(Math.max(existing?.priority ?? 0, intent.priority ?? 0))
  if (existing === undefined) {
    const entry: QueueCarryEntry = {
      firstSeenAt: at,
      priority,
      why: `${intent.source}|${intent.kind}`,
    }
    carry.set(ticket, entry)
    return entry
  }
  existing.priority = priority
  return existing
}

/** 出队（派发成功即调用；回滚再入队走 touchQueueCarry 新钟） */
export function dropQueueCarry(carry: QueueCarry, tickets: readonly TicketId[]): void {
  for (const t of tickets) carry.delete(t)
}

// ————————————————————————— 成员资格 —————————————————————————

/**
 * 成员源（结构最小面）：IssueRecord 与 ticket_mirror 行适配体均结构满足——投影以
 * 镜像表为源（拍内迁态后 syncMirror 已落=投影看到拍末真态），镜像集∩本拍平台活集
 * 过滤（平台消失单的镜像残行不产幽灵队行——issues.list 全量每拍已取，零额外 IO）。
 */
export interface QueueMemberSource {
  id: TicketId
  state: string
  type?: string
  level?: number
  assignee?: string
}

/**
 * 队列成员资格（129-§6.2-R2 冻结口径）：单据登记了流且当前态在主干**派发位之前**
 * （新单/待批均算——等机器派发的态）；在工（已派发）/收割链后段（证据就绪/复验通过/
 * 二道待批）/终态均非成员（在工=「人正在做」，不在待办投影里）。位置判定天然排除
 * 回退边（已交付 --rollback--> 已派发不得把终态单拉回队列——decide「回退边不是机器
 * 该走的下一步」同源纪律）。
 * 返回 ready_state：待批态='awaiting_approval'（成员但等制作人批），其余成员='ready'。
 */
export function queueMembership(issue: QueueMemberSource, flow: StateFlow | undefined): false | 'ready' | 'awaiting_approval' {
  if (flow === undefined) return false
  const anchors = flowAnchors(flow)
  // 成员=主干**派发位之前**的段（位置判定，非可达判定：L2 复验通过→待批→已派发在
  // 可达面上成立，但那是收割链后段的二道待批不是「排队等派发」——位置一刀切准）。
  // 派发锚不在主干（怪表）=面关（fail-closed 不产行）；态不在主干（未声明态）同关。
  const dispatchIdx = flow.mainline.indexOf(anchors.dispatched)
  if (dispatchIdx <= 0) return false
  const stateIdx = flow.mainline.indexOf(issue.state)
  if (stateIdx < 0 || stateIdx >= dispatchIdx) return false
  return anchors.approval !== '' && issue.state === anchors.approval ? 'awaiting_approval' : 'ready'
}

// ————————————————————————— 排序与候选定序 —————————————————————————

/** 排序输入（拍内快照：wait 已折算——引擎持钟，core 公式零 IO） */
export interface QueueCandidateMeta {
  ticket: TicketId
  priority: number
  pinned: boolean
  firstSeenAt: number
  boostTier: number
}

/** 队列候选快照（touch 后取：wait=now-firstSeenAt） */
export function queueCandidateMeta(carry: QueueCarry, ticket: TicketId, pinned: boolean, at: number, ageStepMs: number): QueueCandidateMeta {
  const entry = carry.get(ticket)
  const firstSeenAt = entry?.firstSeenAt ?? at
  const waitMs = Math.max(0, at - firstSeenAt)
  return {
    ticket,
    priority: entry?.priority ?? 0,
    pinned,
    firstSeenAt,
    boostTier: ageBoostTier(waitMs, ageStepMs),
  }
}

/**
 * 候选定序（129 plan §3 落定）：生命周期候选（非队列成员——收割/合并/回收链）保持
 * 原序在前；队列候选全局排序在后（收割回收先于新派发；每拍上限约束下高分者先过闸）。
 * 排序器可注入（QueueRanker=160-B 小模型档升级位）；缺省=core rankQueue 规则缺省档。
 * 纯函数：返回新数组，入参不动。
 */
export function orderCandidates<T extends { ticket: TicketId }>(
  candidates: readonly T[],
  memberOf: (ticket: TicketId) => boolean,
  metaOf: (ticket: TicketId) => QueueCandidateMeta,
  ranker: QueueRanker = rankQueue,
): T[] {
  const lifecycle: T[] = []
  const queueMetas: QueueCandidateMeta[] = []
  const queueItems = new Map<TicketId, T>()
  for (const cand of candidates) {
    if (!memberOf(cand.ticket)) {
      lifecycle.push(cand)
      continue
    }
    if (!queueItems.has(cand.ticket)) {
      queueItems.set(cand.ticket, cand)
      queueMetas.push(metaOf(cand.ticket))
    }
  }
  const entries: QueueEntryRank[] = queueMetas.map((m) => ({
    ticket: m.ticket,
    priority: m.priority,
    pinned: m.pinned,
    firstSeenAt: m.firstSeenAt,
    boostTier: m.boostTier,
  }))
  const ranked = ranker(entries)
  return [...lifecycle, ...ranked.map((e) => queueItems.get(e.ticket)).filter((c): c is T => c !== undefined)]
}

// ————————————————————————— 投影 —————————————————————————

/** 投影输入（纯函数——写面与判负线⑦读回核对共用，零漂移） */
export interface ProjectTodoQueueInput {
  /** 成员源集（镜像表∩平台活集——拍末真态；结构面见 QueueMemberSource） */
  members: readonly QueueMemberSource[]
  /** 流解析（engine flowOf——T:<type> 优先 L:<level> 回退，两处定流永不漂移） */
  flowResolve: (member: QueueMemberSource) => StateFlow | undefined
  /** 人解析（engine resolvePerson——assignee→defaultPersonId 链；不可解析行跳过） */
  personOf: (member: QueueMemberSource) => string | undefined
  carry: QueueCarry
  /** 制作人置顶单集（daemon.yaml pinnedTickets 现算——改配置即刻生效） */
  pinnedTickets: ReadonlySet<TicketId>
  ageStepMs: number
  now: number
  company: string
}

/**
 * 投影纯函数：镜像集 → todo_queue 行集（确定性行序=单号升序，diff 判定稳定）。
 * 非成员/人不可解析行不产；成员行携带态缺种（本拍新见）按 now 起钟。
 * GC 副作用：carry 中已非成员的单删条（离队=离携带——防跨拍膨胀；投影可重建兜底）。
 */
export function projectTodoQueue(input: ProjectTodoQueueInput): TodoQueueRecord[] {
  const rows: TodoQueueRecord[] = []
  const memberTickets = new Set<TicketId>()
  for (const member of input.members) {
    const membership = queueMembership(member, input.flowResolve(member))
    if (membership === false) continue
    memberTickets.add(member.id)
    const person = input.personOf(member)
    if (person === undefined) continue
    const entry = input.carry.get(member.id)
    const firstSeenAt = entry?.firstSeenAt ?? input.now
    const boostTier = ageBoostTier(Math.max(0, input.now - firstSeenAt), input.ageStepMs)
    rows.push({
      company: input.company,
      ticket: member.id,
      person,
      priority: clampPriority(entry?.priority ?? 0),
      pinned: input.pinnedTickets.has(member.id) ? 1 : 0,
      boost_tier: boostTier,
      first_seen_at: firstSeenAt,
      ...(boostTier > 0 ? { last_boost_at: firstSeenAt + boostTier * input.ageStepMs } : {}),
      ready_state: membership,
      ...(entry?.why !== undefined ? { why: entry.why } : {}),
      updated_at: input.now,
    })
  }
  // GC：离队单的携带条目删（成员资格变化即出——delivered/CLOSE/流注销全收口）
  for (const ticket of [...input.carry.keys()]) {
    if (!memberTickets.has(ticket)) input.carry.delete(ticket)
  }
  rows.sort((a, b) => (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0))
  return rows
}

/** 投影 diff 判定（canonical JSON 比对——updated_at 相同拍内恒等，跨拍仅成员/键变才写） */
export function todoQueueDiffers(prev: string | undefined, rows: readonly TodoQueueRecord[]): boolean {
  return prev !== JSON.stringify(rows)
}

// ————————————————————————— daemon.yaml 扁平键解析 —————————————————————————

/**
 * personInflightOverrides 解析（matrixRoles 先例的 `工号=值` 分号对）：
 * `P-1=2;P-2=3` → Map{P-1→2, P-2→3}。坏形态（空段/缺=/非整数/负数）明报——
 * 调用面（serve）以 CONFIG_INVALID 语义抛出拒启动，不静默忽略段。
 */
export function parsePersonInflightOverrides(raw: string): ReadonlyMap<string, number> {
  const out = new Map<string, number>()
  for (const segment of raw.split(';')) {
    const seg = segment.trim()
    if (seg === '') continue
    const eq = seg.indexOf('=')
    if (eq <= 0 || eq >= seg.length - 1) {
      throw new Error(`personInflightOverrides 段「${seg}」非 工号=N 形态（分号对，如 P-1=2;P-2=3）`)
    }
    const person = seg.slice(0, eq).trim()
    const value = Number.parseInt(seg.slice(eq + 1), 10)
    if (person === '' || !Number.isInteger(value) || value < 1) {
      throw new Error(`personInflightOverrides 段「${seg}」非法（工号非空、N=正整数——批量执行岗才可 >1）`)
    }
    out.set(person, value)
  }
  return out
}

/**
 * pinnedTickets 解析（逗号清单）：`T-1, T-2` → ['T-1','T-2']；空串=空集。
 * 单号原样收（不猜平台前缀规则——投影比对用镜像单号全等）。
 */
export function parsePinnedTickets(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** 本单常量出口（serve 缺省装配与测试同源） */
export { DEFAULT_QUEUE_AGE_STEP_MS }
