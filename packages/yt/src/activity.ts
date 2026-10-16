/**
 * 活动流 —— YouTrack activities 端点 ↔ FlowPlatform.activity.since（docs/25-§3.2）
 *
 * 游标语义（NA1 教训——增量必须不重不漏；对齐 localplatform 基线）：
 *   - 游标=不透明字符串；内部形态 base64url(JSON({v, last}))，last=最后见过的活动 id
 *   - since(cursor) 返回**严格新于边界**的活动（升序），nextCursor=本轮最后一条 id；
 *     无新增 → items=[] 且 nextCursor=null（调用方游标不动）
 *   - cursor=null = 全量翻页对账模式（内部把整个 feed 翻完再切页返回）
 *   - 坏游标显式报错（CONFIG_INVALID / bad-cursor），禁静默当从头
 *
 * 取法（绝不用 after/start——会被静默忽略，docs/03 N10）：
 *   1. GET /api/activities?$top&$skip 倒序取头（服务端顺序=权威顺序，新→旧）
 *   2. 翻页直到**命中边界活动 id**或取尽；边界（含）之后的旧活动全部截断
 *   3. 截断结果反转成升序返回；超出 pageSize 取最旧 pageSize 条，
 *      nextCursor=本批最新一条 id——并集不重不漏（与 localplatform 同式切页）
 *
 * kind 词表：已知类别归一成与 localplatform 对齐的动词（created/commented/
 * transitioned/field-set），未知类别原样透传类别 id（契约疑点：kind 词表未冻结，
 * 见 index 头注）。
 * 公司作用域：project 绑定时只保留 `项目短名-` 前缀的单据活动与非单据活动。
 * actor 语义：YouTrack author.login=平台账号（N9 账号=等级锚点），**不是工号**
 * ——与 localplatform（actor=工号）不一致，契约疑点已记录不改 contract。
 */
import { z } from 'zod'
import type { ActivityPage, PlatformActivity } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import type { YtHttpClient } from './http.ts'

export const DEFAULT_PAGE_SIZE = 100

/** 单次 since() 内部翻页上限（防御：边界活动被平台清理导致取不尽） */
const MAX_FETCH_PAGES = 1000

const ACTIVITY_FIELDS = 'id,timestamp,category(id),target(id,idReadable),author(login)'

const activityJsonSchema = z.looseObject({
  id: z.string(),
  timestamp: z.number(),
  category: z.looseObject({ id: z.string().optional() }).optional(),
  target: z.looseObject({ id: z.string().optional(), idReadable: z.string().optional() }).optional(),
  author: z.looseObject({ login: z.string().optional() }).optional(),
})
type ActivityJson = z.infer<typeof activityJsonSchema>

/** 已知类别 → 归一动词（与 localplatform 活动词表对齐）；未知原样透传 */
const KIND_BY_CATEGORY: Readonly<Record<string, string>> = {
  IssueCreatedCategory: 'created',
  IssueCommentedCategory: 'commented',
  IssueResolvedCategory: 'transitioned',
  IssueReopenedCategory: 'transitioned',
  IssueUpdatedCategory: 'field-set',
}

// —— 游标编解码（内部形态，核心不解释） ——

interface CursorPayload {
  v: 1
  last: string
}

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

function fromBase64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

export function encodeCursor(lastActivityId: string): string {
  const payload: CursorPayload = { v: 1, last: lastActivityId }
  return toBase64Url(JSON.stringify(payload))
}

/**
 * 坏游标如实报错（不静默当从头）。
 * 兼容两种输入（都是不透明字符串，形态归本适配器）：
 *   1. 规范形：base64url(JSON({v:1,last})) —— nextCursor 的产出形态
 *   2. 裸活动 id 形（^\\d+-\\d+$）——对齐 localplatform 基线的调用惯例
 *      （轮询方直接拿 items 末条 id 当游标续问，见 activity.test 基线）
 */
export function decodeCursor(cursor: string): string {
  if (/^\d+-\d+$/.test(cursor)) return cursor
  let payload: unknown
  try {
    payload = JSON.parse(fromBase64Url(cursor)) as unknown
  } catch {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-cursor', `无法解释的游标：${cursor.slice(0, 40)}`)
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as Record<string, unknown>)['v'] !== 1 ||
    typeof (payload as Record<string, unknown>)['last'] !== 'string' ||
    ((payload as Record<string, unknown>)['last'] as string).trim() === ''
  ) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-cursor', `游标内部形态不合法：${cursor.slice(0, 40)}`)
  }
  return (payload as CursorPayload).last
}

function toPlatformActivity(json: ActivityJson, project: string | undefined): PlatformActivity | null {
  const idReadable = json.target?.idReadable
  if (project !== undefined && project !== '' && idReadable !== undefined && !idReadable.startsWith(`${project}-`)) {
    return null // 公司作用域：别家项目的单据活动滤掉
  }
  const kind = json.category?.id ?? 'unknown'
  const act: PlatformActivity = {
    id: json.id,
    ts: new Date(json.timestamp).toISOString(),
    kind: KIND_BY_CATEGORY[kind] ?? kind,
  }
  if (idReadable !== undefined) act.issue = idReadable
  if (json.author?.login !== undefined) act.actor = json.author.login
  return act
}

/**
 * since(cursor)：
 *   1. 倒序翻页（$top/$skip）收集新于边界的活动
 *   2. 公司作用域过滤
 *   3. 升序返回；≤pageSize 全量返回且 nextCursor=null，否则切最旧 pageSize 条
 */
export async function activitySince(
  http: YtHttpClient,
  project: string | undefined,
  cursor: string | null,
  pageSize: number,
): Promise<ActivityPage> {
  const boundary = cursor === null ? null : decodeCursor(cursor)
  const desc: ActivityJson[] = []
  let skip = 0
  let hitBoundary = boundary === null
  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const batch = await http.request(z.array(activityJsonSchema), {
      method: 'GET',
      path: '/api/activities',
      query: { fields: ACTIVITY_FIELDS, $top: String(pageSize), $skip: String(skip) },
    })
    if (batch.length === 0) break // 取尽
    if (boundary === null) {
      desc.push(...batch)
    } else {
      const idx = batch.findIndex((a) => a.id === boundary)
      if (idx >= 0) {
        desc.push(...batch.slice(0, idx))
        hitBoundary = true
        break
      }
      desc.push(...batch)
    }
    if (batch.length < pageSize) break // 取尽（服务端窗口尾）
    skip += pageSize
  }
  if (!hitBoundary && boundary !== null && desc.length >= MAX_FETCH_PAGES * pageSize) {
    // 翻页上限内未命中边界且未取尽：如实上报而非漏报（防御分支）
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'boundary-not-found',
      `边界活动 ${boundary} 在 ${String(MAX_FETCH_PAGES)} 页内未命中（活动被清理或实例异常）`,
    )
  }
  const scope = project === undefined || project === '' ? undefined : project
  const ascending: PlatformActivity[] = []
  for (let i = desc.length - 1; i >= 0; i--) {
    const item = desc[i] === undefined ? null : toPlatformActivity(desc[i] as ActivityJson, scope)
    if (item !== null) ascending.push(item)
  }
  if (ascending.length <= pageSize) {
    return { items: ascending, nextCursor: null }
  }
  const items = ascending.slice(0, pageSize)
  const last = items[items.length - 1]
  // slice 后必非空（ascending.length > pageSize ≥ 1），last 收窄仅安抚 noUncheckedIndexedAccess
  return { items, nextCursor: last === undefined ? null : encodeCursor(last.id) }
}
