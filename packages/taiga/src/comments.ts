/**
 * 评论面 —— Taiga 评论=实体 history 条目（无独立评论资源；docs/32 §四 history 实测形状）。
 *
 *   写：PATCH /api/v1/{collection}/{内部id} {comment: "<正文>\n\n<署名>", version}
 *       （真机 onboard ⑨ 已实证 PATCH 写路径；comment 字段即 Taiga 官方评论通道）
 *   读：GET /api/v1/history/{entity}/{内部id} → 过滤 is_hidden/is_snapshot、comment 非空
 *       的条目 → Comment（id=history 条目 id，author=条目 user.username）
 *
 * 署名注入（docs/17-§7）：SignedBody.signature 作为正文尾行随 body 一起进 comment；
 * Comment.author 取 SignedBody.author（工号，v1.2 口径）——但注意 Taiga 侧真正的
 * 操作者是 JWT 账号（history.user.username），平台读面拿不到工号，读回的 author
 * 是平台账号名。端口缺口已记录（见 index 头注），不改 contract。
 */
import type { Comment, SignedBody, TicketId } from '@studio-next/contract'
import type { TaigaContext } from './context.ts'
import { TaigaPlatformError } from './errors.ts'
import { asArray, asObject, optBoolean, optString, reqObject, reqString } from './shape.ts'

export interface HistoryEntry {
  id: string
  createdAt: string
  username: string
  /** 原始 diff 键集（分类用：status 在键里=流转） */
  diffKeys: string[]
  comment: string
  hidden: boolean
  snapshot: boolean
}

export function parseHistoryEntry(v: unknown): HistoryEntry {
  const o = asObject(v, 'history-entry')
  const user = reqObject(o, 'user', 'history-entry')
  const diff = o['diff']
  const diffKeys =
    typeof diff === 'object' && diff !== null && !Array.isArray(diff) ? Object.keys(diff as Record<string, unknown>) : []
  return {
    id: reqString(o, 'id', 'history-entry'),
    createdAt: reqString(o, 'created_at', 'history-entry'),
    username: reqString(user, 'username', 'history-entry.user'),
    diffKeys,
    comment: optString(o, 'comment') ?? '',
    hidden: optBoolean(o, 'is_hidden') ?? false,
    snapshot: optBoolean(o, 'is_snapshot') ?? false,
  }
}

export function parseHistoryList(v: unknown): HistoryEntry[] {
  return asArray(v, 'history').map(parseHistoryEntry)
}

/** 取单实体的可见 history（新→旧原样；排序由调用方定） */
export async function fetchHistory(ctx: TaigaContext, internalId: number): Promise<HistoryEntry[]> {
  const res = await ctx.client.request({ method: 'GET', path: `/history/${ctx.desc.history}/${String(internalId)}` })
  return parseHistoryList(res.json)
}

/** history 条目 → 活动动词（与 localplatform/yt 词表对齐；未知面透传） */
export function kindOfEntry(entry: HistoryEntry): string {
  if (entry.comment !== '') return 'commented'
  if (entry.diffKeys.includes('status')) return 'transitioned'
  if (entry.diffKeys.length > 0) return 'field-set'
  return 'change'
}

export async function listComments(ctx: TaigaContext, id: TicketId): Promise<Comment[]> {
  const ref = ctx.parseTicketId(id)
  const raw = await ctx.fetchEntityByRef(ref) // 404 → not-found（统一口径在 getIssue 已示范；评论面直接透传）
  const entries = await fetchHistory(ctx, raw.id)
  const out: Comment[] = []
  for (const entry of entries) {
    if (entry.hidden || entry.snapshot || entry.comment === '') continue
    out.push({ id: entry.id, issue: id, author: entry.username, body: entry.comment, created: entry.createdAt })
  }
  // history 新→旧（实测）；评论读面升序稳定返回
  out.sort((a, b) => (a.created === b.created ? (a.id < b.id ? -1 : 1) : a.created < b.created ? -1 : 1))
  return out
}

export async function addComment(ctx: TaigaContext, id: TicketId, body: SignedBody): Promise<void> {
  if (
    typeof body['author'] !== 'string' ||
    typeof body['body'] !== 'string' ||
    typeof body['signature'] !== 'string'
  ) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-signed-body', '评论 author/body/signature 必须是字符串')
  }
  const ref = ctx.parseTicketId(id)
  const raw = await ctx.fetchEntityByRef(ref)
  const text = `${body.body}\n\n${body.signature}`
  await ctx.client.request({
    method: 'PATCH',
    path: `/${ctx.desc.collection}/${String(raw.id)}`,
    body: { comment: text, version: raw.version },
  })
}
