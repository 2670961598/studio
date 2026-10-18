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
 * 边界所在单若仍存活必在候选集内（其 modified_date ≥ 边界条目时刻），可达性判定无损；
 * 候选集中未见边界 id 才判不可达 → 全量重放。docs/32 §四「全量重放代价」按此收敛。
 */
import type { ActivityPage, PlatformActivity, TicketId } from '@studio-next/contract'
import type { TaigaContext, EntityRaw } from './context.ts'
import { parseEntityList } from './context.ts'
import { TaigaPlatformError } from './errors.ts'
import { fetchHistory, kindOfEntry, type HistoryEntry } from './comments.ts'
import { LIST_PAGE_SIZE } from './issues.ts'
import { asObject } from './shape.ts'

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

interface MergedEntry {
  entry: HistoryEntry
  issue: TicketId
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
    for (const entry of await fetchHistory(ctx, raw.id)) {
      if (entry.hidden || entry.snapshot) continue
      merged.push({ entry, issue: ctx.ticketId(raw.ref) })
    }
  }
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
    LIST_PAGE_SIZE,
  )

  // 候选集：canonical 边界（有 ts）走剪枝；裸 id 边界/全量模式全扫
  let candidates: EntityRaw[]
  if (boundary === null || boundary.ts === null) {
    candidates = all
  } else {
    const bts: string = boundary.ts // 收窄快照（闭包内属性收窄失效，先落 const）
    // 剪枝：modified_date 严格早于边界 ts 的单不可能有新活动；相等也保留（同秒写入防漏）
    candidates = all.filter((raw) => !(raw.modifiedDate < bts))
  }
  const merged = sortAscending(await collect(ctx, candidates))

  if (boundary === null) {
    return pageOf(ctx, merged, pageSize)
  }

  if (boundary.ts !== null) {
    const bts: string = boundary.ts // 收窄快照（闭包内属性收窄失效，先落 const）
    const bid: string = boundary.id
    // 快路径：可达性=候选集中见到边界条目
    if (!merged.some((m) => m.entry.id === bid)) {
      // 边界不可达（单据被删/条目被隐藏=作用域漂移）→ 全量重放（裁决(a) 对齐）
      const full = sortAscending(await collect(ctx, all))
      return pageOf(ctx, full, pageSize)
    }
    return pageOf(ctx, merged.filter((m) => strictlyAfter(m.entry, { ts: bts, id: bid })), pageSize)
  }

  // 裸 id 边界：无 ts 不能剪枝也不能比大小——在升序全量里定位边界，切其后
  const full = merged // 裸 id 形候选集=all（上文分支保证）
  const idx = full.findIndex((m) => m.entry.id === boundary.id)
  if (idx < 0) {
    return pageOf(ctx, full, pageSize) // 不可达 → 全量重放
  }
  return pageOf(ctx, full.slice(idx + 1), pageSize)
}

async function pageOf(ctx: TaigaContext, ascending: MergedEntry[], pageSize: number): Promise<ActivityPage> {
  if (ascending.length <= pageSize) {
    return { items: await Promise.all(ascending.map((m) => toPlatformActivity(ctx, m))), nextCursor: null }
  }
  const head = ascending.slice(0, pageSize)
  const last = head[head.length - 1]
  // slice 后必非空（length > pageSize ≥ 1），last 收窄仅安抚 noUncheckedIndexedAccess
  const nextCursor = last === undefined ? null : encodeCursor(last.entry.createdAt, last.entry.id)
  return { items: await Promise.all(head.map((m) => toPlatformActivity(ctx, m))), nextCursor }
}
