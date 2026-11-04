/**
 * 活动面 —— history API 逐实体合并轮询 + 不透明游标（docs/25-§3.2 游标铁律；docs/32 §四）。
 *
 * 真机事实（docs/32 §四 + /tmp/taiga-probe/history-1.json 实录）：
 *   - Taiga **无全局活动流端点**；变更在 GET /history/{entity}/{内部id} 逐单可取，
 *     条目含逐字段 diff + actor + 时间戳——轮询兜底通道成立（webhook 是主通道）
 *   - history 条目 id 是 **UUID**（无时间序）→ 游标边界不能只拿 id 比「大小」
 *   - history 响应新→旧（实测）；本实现自行排序，不依赖服务端顺序
 *   - **建单事件不进 history**（实测：建单+两次流转只有 2 条状态条目）——
 *     created 类活动只能靠 webhook 主通道；轮询面见不到建单，如实记录不补造
 *
 * 游标语义（NA1 教训——增量不重不漏）：
 *   - 游标=不透明字符串；内部形态两可（产出 canonical，输入两形都认）：
 *       1. canonical：base64url(JSON({v:1,ts,id}))——nextCursor 的产出形态（含剪枝提示 ts）
 *       2. 裸活动 id 形（UUID）——轮询方拿 items 末条 id 续问的基线惯例
 *          （localplatform/yt 同款；无 ts → 无剪枝，全扫定位切割，代价换兼容）
 *   - since(cursor) 返回严格新于边界（(created_at,id) 字典序）的活动，升序；
 *     无新增 → items=[] 且 nextCursor=null（调用方游标不动）
 *   - cursor=null = 自最旧起的对账全量（返回最旧 pageSize 条，靠 nextCursor 翻到最新）
 *   - 坏游标显式报错（CONFIG_INVALID/bad-cursor），禁静默当从头
 *   - **边界不可达 = 全量重放**（对齐 yt 裁决(a)：边界单据被删/条目被隐藏 →
 *     游标跨了作用域变化，返回全部活动让上游去重，绝不静默空转）
 *
 * 剪枝（成本面）：边界非空时只对 modified_date >= 边界 ts 的单取 history——
 * 候选未含边界**不直接判不可达**：modified_date 与 history.created_at 精度/后缀
 * 不一致（秒级 vs 毫秒、+00:00 vs Z）或历史行曾受损（2026-10-31 事故 SQL）都会
 * 误剪「边界所在单」（studio-dev-409 根因）——先在全量集复核，命中=可达按增量走，
 * 全量集也未见才判不可达 → 全量重放。复核仅快路径未命中时发生（与重放同一次
 * collect，零额外成本），裁决(a) 语义不变。docs/32 §四「全量重放代价」按此收敛。
 */
import type { ActivityPage, PlatformActivity, TicketId } from '@studio-next/contract'
import type { TaigaContext, EntityRaw } from './transport/context.ts'
import { parseEntityList } from './transport/context.ts'
import { TaigaPlatformError } from './transport/errors.ts'
import { fetchHistory, kindOfEntry, type HistoryEntry } from './comments.ts'
import { ENTITY_LIST_PAGE_SIZE } from './transport/entities.ts'
import { asObject } from './transport/shape.ts'

export const DEFAULT_PAGE_SIZE = 100

interface CursorPayload {
  v: 1
  ts: string
  id: string
}

/** 解码后的边界：canonical 带 ts（剪枝可用）；裸 id 形 ts 缺省 */
interface Boundary {
  ts: string | null
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

export function encodeCursor(ts: string, id: string): string {
  const payload: CursorPayload = { v: 1, ts, id }
  return toBase64Url(JSON.stringify(payload))
}

/** 坏游标如实报错（不静默当从头）；认两形：canonical（含 ts）与裸活动 UUID */
export function decodeCursor(cursor: string): Boundary {
  if (UUID_RE.test(cursor)) return { ts: null, id: cursor } // 裸活动 id 形（基线惯例）
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(cursor)) as unknown
  } catch {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-cursor', `无法解释的游标：${cursor.slice(0, 40)}`)
  }
  const o = asObject(parsed, 'cursor')
  const v = o['v']
  const ts = o['ts']
  const id = o['id']
  if (v !== 1 || typeof ts !== 'string' || typeof id !== 'string' || ts === '' || id === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-cursor', `游标内部形态不合法：${cursor.slice(0, 40)}`)
  }
  return { ts, id }
}

/**
 * activityId → entity 内部 id 的 owner 缓存（studio-dev-790 v2）：live 根因=canonical 边界 ts 可能
 * 大于其所属单的 modified_date（Taiga history created_at 与 modified_date 不保证同源），
 * `modified_date >= boundary.ts` 剪枝会漏掉边界单 → 旧「边界不在候选=不可达」慢路径每拍全量。
 * 缓存让已知边界的所属单**始终并入候选**（1 次 history 即可验证可达）；owner 未知时全量学习一次。
 * LRU 容量 4096（仅存活动 id→内部 id，约几十 KB；超出逐最旧）。
 */
export class ActivityOwnerCache {
  private readonly map = new Map<string, number>()
  private readonly max: number

  constructor(max = 4096) {
    this.max = Math.max(1, Math.floor(max))
  }
  get size(): number {
    return this.map.size
  }
  get(activityId: string): number | undefined {
    const hit = this.map.get(activityId)
    if (hit === undefined) return undefined
    this.map.delete(activityId)
    this.map.set(activityId, hit)
    return hit
  }
  set(activityId: string, entityId: number): void {
    if (this.map.has(activityId)) this.map.delete(activityId)
    this.map.set(activityId, entityId)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }
}

const activityOwnerCaches = new WeakMap<TaigaContext, ActivityOwnerCache>()

function ownerCacheOf(ctx: TaigaContext): ActivityOwnerCache {
  let cache = activityOwnerCaches.get(ctx)
  if (cache === undefined) {
    cache = new ActivityOwnerCache()
    activityOwnerCaches.set(ctx, cache)
  }
  return cache
}

interface MergedEntry {
  entry: HistoryEntry
  issue: TicketId
  entityId: number
}

/** (created_at,id) 字典序严格新于边界（边界 ts 已知时用） */
function strictlyAfter(e: HistoryEntry, boundary: { ts: string; id: string }): boolean {
  if (e.createdAt !== boundary.ts) return e.createdAt > boundary.ts
  return e.id > boundary.id
}

function sortAscending(list: MergedEntry[]): MergedEntry[] {
  return list.sort((a, b) =>
    a.entry.createdAt === b.entry.createdAt ? (a.entry.id < b.entry.id ? -1 : 1) : a.entry.createdAt < b.entry.createdAt ? -1 : 1,
  )
}

async function toPlatformActivity(ctx: TaigaContext, m: MergedEntry): Promise<PlatformActivity> {
  const act: PlatformActivity = {
    id: m.entry.id,
    ts: m.entry.createdAt,
    issue: m.issue,
    kind: kindOfEntry(m.entry),
  }
  if (m.entry.username !== '') act.actor = m.entry.username
  void ctx // 预留（如未来需要 status 名解析）；显式空用避免 noUnusedParameters
  return act
}

/** 拉取一组实体的可见 history 并合并（issue 号由实体侧自带，不依赖 history key） */
async function collect(ctx: TaigaContext, entities: EntityRaw[]): Promise<MergedEntry[]> {
  const merged: MergedEntry[] = []
  for (const raw of entities) {
    // 容错（2026-11-01 应急修——认证振荡下单张历史拉取 401 不再炸整轮；跳过失败单，
    // 下轮重试——cursor 由成功单推进，失败单在下一个 tick 由「边界不可达→全量重放」兜底）
    let entries
    try {
      entries = await fetchHistory(ctx, raw.id)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.hidden || entry.snapshot) continue
      const issue = ctx.ticketId(raw.ref)
      merged.push({ entry, issue, entityId: raw.id })
    }
  }
  // owner 缓存登记（每次 collect 都更新；bounded LRU）
  const owners = ownerCacheOf(ctx)
  for (const item of merged) owners.set(item.entry.id, item.entityId)
  return merged
}

export async function activitySince(
  ctx: TaigaContext,
  cursor: string | null,
  pageSize: number,
): Promise<ActivityPage> {
  const boundary = cursor === null ? null : decodeCursor(cursor)
  const projectId = await ctx.project()
  const all = await ctx.client.paginate(
    { method: 'GET', path: `/${ctx.desc.collection}`, query: { project: String(projectId) } },
    (v) => parseEntityList(v, 'entity-list'),
    ENTITY_LIST_PAGE_SIZE,
  )

  // 候选集（studio-dev-790 v2）：
  //   - canonical 边界：`modified_date >= boundary.ts` 剪枝 ∪ **边界所属单（owner 缓存）**；
  //   - 裸 id/全量模式：全扫（无 ts 不能剪枝）。
  const owners = ownerCacheOf(ctx)
  const boundaryTs = boundary !== null ? boundary.ts : null
  const boundaryOwner = boundary !== null && boundaryTs !== null ? owners.get(boundary.id) : undefined
  let candidates: EntityRaw[]
  if (boundary === null || boundaryTs === null) {
    candidates = all
  } else {
    const bts: string = boundaryTs
    // 剪枝：modified_date 早于边界 ts 的单通常无新活动；相等保留（同秒防漏）。
    // studio-dev-790 v2：边界所属单恒并入——Taiga history created_at 可能晚于 modified_date，
    // 「边界不在候选」不得再判不可达（live 根因：每拍全量 763 history）。
    candidates = all.filter((raw) => !(raw.modifiedDate < bts) || raw.id === boundaryOwner)
  }
  const merged = sortAscending(await collect(ctx, candidates))

  if (boundary === null) {
    return pageOf(ctx, merged, pageSize)
  }

  if (boundaryTs !== null) {
    const bts: string = boundaryTs
    const bid: string = boundary.id
    // 快路径：候选/边界所属单见到边界条目 → 严格增量（items 可为空；游标不动=稳态）
    if (merged.some((m) => m.entry.id === bid)) {
      const tail = merged.filter((m) => strictlyAfter(m.entry, { ts: bts, id: bid }))
      // 空增量：返回边界自身 canonical（上游写回同值=稳态；避免 null 触发回落裸 id）
      return tail.length === 0 ? { items: [], nextCursor: encodeCursor(bts, bid) } : pageOf(ctx, tail, pageSize)
    }
    // 边界未见：
    //  - owner 未知（新边界首见）→ 全量 collect 一次学习 owner（之后稳态只拉 1 单）；
    //  - owner 已知但 history 仍无该条目（条目被隐藏/删除/历史损坏）→ 全量复核一次。
    // 全量复核命中=可达→严格增量；真不可达→**本拍全量重放**（docs/25-§3.2 yt(a)：上游把
    // cursor 推进到最新 canonical，下一拍可达；只慢一拍，绝不每拍全量）。
    const full = sortAscending(await collect(ctx, all))
    if (full.some((m) => m.entry.id === bid)) {
      const tail = full.filter((m) => strictlyAfter(m.entry, { ts: bts, id: bid }))
      return tail.length === 0 ? { items: [], nextCursor: encodeCursor(bts, bid) } : pageOf(ctx, tail, pageSize)
    }
    return pageOf(ctx, full, pageSize)
  }

  // 裸 id 边界：无 ts 不能剪枝也不能比大小——在升序全量里定位边界，切其后。
  // studio-dev-790：命中边界且其后为空时**必须升级为 canonical {ts,id} 游标**——否则上游
  // 永远拿不到 ts，只能空转全量 history（tick 11s 根因）。nextCursor=边界自身 canonical
  // （无损：边界之后无事件；下一拍起 modified_date 剪枝）。
  const full = merged // 裸 id 形候选集=all（上文分支保证）
  const idx = full.findIndex((m) => m.entry.id === boundary.id)
  if (idx < 0) {
    return pageOf(ctx, full, pageSize) // 不可达 → 全量重放
  }
  const boundaryEntry = full[idx]
  const tail = full.slice(idx + 1)
  if (tail.length === 0 && boundaryEntry !== undefined) {
    return { items: [], nextCursor: encodeCursor(boundaryEntry.entry.createdAt, boundaryEntry.entry.id) }
  }
  return pageOf(ctx, tail, pageSize)
}

async function pageOf(ctx: TaigaContext, ascending: MergedEntry[], pageSize: number): Promise<ActivityPage> {
  if (ascending.length <= pageSize) {
    // studio-dev-790：末页也返回 canonical {ts,id} 游标（上游持久化后可剪枝；空页=null）。
    // 不能返回 null：上游对 null 会回退「最后活动裸 id」——正是全量 history 永动机的根因。
    const last = ascending[ascending.length - 1]
    return {
      items: await Promise.all(ascending.map((m) => toPlatformActivity(ctx, m))),
      nextCursor: last === undefined ? null : encodeCursor(last.entry.createdAt, last.entry.id),
    }
  }
  const head = ascending.slice(0, pageSize)
  const last = head[head.length - 1]
  // slice 后必非空（length > pageSize ≥ 1），last 收窄仅安抚 noUncheckedIndexedAccess
  const nextCursor = last === undefined ? null : encodeCursor(last.entry.createdAt, last.entry.id)
  return { items: await Promise.all(head.map((m) => toPlatformActivity(ctx, m))), nextCursor }
}
