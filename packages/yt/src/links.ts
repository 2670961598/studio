/**
 * 链接面 —— YouTrack issueLinks API（docs/25-§3.2 / docs/03 可复用零件）
 *
 * LinkType → YouTrack 链接类型与方向约定：
 *   | LinkType    | YouTrack 类型名 | 落链方向（source→target = POST 路径） |
 *   |-------------|-----------------|----------------------------------------|
 *   | parent-child | Subtask        | 子→父（子单侧持有 subtask-of 链）       |
 *   | depends-on   | Depends        | a→b（a depends on b）                   |
 *   | relates-to   | Relates         | a→b（无向）                            |
 *
 * 链接类型内部 id 按名字解析（N11：id 绝不落盘；GET /api/issueLinks，实例内缓存）。
 * children(id) = 该单 OUTWARD Subtask 链上的对端（=「parent 字段也算 children 来源」
 * 的 YouTrack 形态：parent 维就是 Subtask 链，两来源同链，天然去重；升序按单号后缀）。
 */
import { z } from 'zod'
import type { LinkType, TicketId } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import type { YtHttpClient } from './http.ts'
import { fetchIssueJson } from './issues.ts'

const LINK_TYPE_NAMES: Readonly<Record<LinkType, string>> = {
  'parent-child': 'Subtask',
  'depends-on': 'Depends',
  'relates-to': 'Relates',
}

const linkTypeJsonSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
})

/** 单号升序比较：取 `<PRJ>-<n>` 的 n；非此形状退化为字典序 */
export function compareTicketIds(a: TicketId, b: TicketId): number {
  const na = /-(\d+)$/.exec(a)?.[1]
  const nb = /-(\d+)$/.exec(b)?.[1]
  if (na !== undefined && nb !== undefined) return Number(na) - Number(nb)
  return a < b ? -1 : a > b ? 1 : 0
}

/** 链接面（issues.setField('parent') 与 issues.create(parent) 复用 link()） */
export class LinkFacade {
  private readonly http: YtHttpClient
  private linkTypeIds: Map<string, string> | null

  constructor(http: YtHttpClient) {
    this.http = http
    this.linkTypeIds = null
  }

  /** 名字 → 链接类型内部 id（N11：按名解析，实例内缓存） */
  private async resolveLinkTypeId(name: string): Promise<string> {
    if (this.linkTypeIds === null) {
      const list = await this.http.request(z.array(linkTypeJsonSchema), {
        method: 'GET',
        path: '/api/issueLinks',
        query: { fields: 'id,name,directed,sourceToTarget,targetToSource' },
      })
      const map = new Map<string, string>()
      for (const lt of list) {
        if (lt.name !== undefined) map.set(lt.name, lt.id)
      }
      this.linkTypeIds = map
    }
    const id = this.linkTypeIds.get(name)
    if (id === undefined) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'unknown-link-type', `实例上找不到链接类型 ${name}`)
    }
    return id
  }

  async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
    if (a === b) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'self-link', `链接两端不能是同一单据：${a}`)
    }
    const typeName = LINK_TYPE_NAMES[type]
    if (typeName === undefined) {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-link-type', `未知链接类型：${String(type)}`)
    }
    // 两端单必须存在（fetchIssueJson 已把 404 收口为 issue-not-found）
    const srcJson = type === 'parent-child' ? await fetchIssueJson(this.http, b) : await fetchIssueJson(this.http, a)
    const tgtId = type === 'parent-child' ? a : b
    await fetchIssueJson(this.http, tgtId)
    const linkTypeId = await this.resolveLinkTypeId(typeName)
    await this.http.request(z.looseObject({ id: z.string().optional(), idReadable: z.string().optional() }), {
      method: 'POST',
      path: `/api/issues/${encodeURIComponent(srcJson.id)}/links/${encodeURIComponent(linkTypeId)}/issues/${encodeURIComponent(tgtId)}`,
      query: { fields: 'id,idReadable' },
      body: {},
    })
  }

  async children(id: TicketId): Promise<TicketId[]> {
    const json = await fetchIssueJson(this.http, id)
    const set = new Set<TicketId>()
    for (const link of json.links ?? []) {
      if (link.direction !== 'OUTWARD') continue
      if (link.linkType?.name !== 'Subtask') continue
      for (const issue of link.issues ?? []) set.add(issue.idReadable)
    }
    return [...set].sort(compareTicketIds)
  }
}
