/**
 * 单据面 —— YouTrack issues API ↔ FlowPlatform.issues（docs/25-§3.2）
 *
 * 请求契约（docs/03 实测白名单 + N10 防坑）：
 *   - list：GET /api/issues?query=…&fields=…&$top&$skip——查询语言只用白名单语法
 *     （project:/字段: a,b/updated: a .. b/sort by:），分页必须 $top/$skip；
 *     $top/$skip 偏移分页 + 服务端数据并发变更理论上可漏可重（v0 已知局限，
 *     对账兜底=activity 全量翻页模式）
 *   - get/create/写值：GET/POST /api/issues[/{idReadable}]，fields 必带（缺 fields 只回 id）
 *   - transition = 写 state 自定义字段（POST /api/issues/{id}，值 {name}，名字寻址 N11：
 *     实体内部 id 绝不落盘）
 *   - parent 维度 = Subtask 链接（见 links.ts）：create 带 .parent → 建单后补链接；
 *     IssueRecord.parent 从 INWARD Subtask 链接派生
 *   - create 需要项目绑定（N1 公司=一个项目）：实例构造时给 project 短名，
 *     内部 id 按 N11 每实例按名解析（GET /api/admin/projects，结果缓存）
 *
 * updatedSince 语义：端口=严格大于（对齐 localplatform）；YouTrack 查询发
 * `updated: <iso> .. *` 开区间，下界含等风险由**客户端严格后滤**兜平（两实现口径一致）。
 */
import { z } from 'zod'
import type { IssueCreate, IssueQuery, IssueRecord, PersonId, TicketId } from '@studio-next/contract'
import { YouTrackPlatformError } from './errors.ts'
import { FieldTranslator } from './fieldmap.ts'
import type { YtHttpClient } from './http.ts'
import type { LinkFacade } from './links.ts'

/** 列表分页窗口（$top；docs/03：分页必须 $top/$skip） */
export const LIST_PAGE_SIZE = 100

/** 防御性翻页上限：$skip 被服务端静默忽略（N10）时防止死循环 */
const MAX_LIST_PAGES = 1000

/** 单据 JSON 形状（typed 子集，未建模字段透传 unknown——zod loose） */
export const issueJsonSchema = z.looseObject({
  id: z.string(),
  idReadable: z.string(),
  summary: z.string(),
  description: z.string().nullable().optional(),
  created: z.number().optional(),
  updated: z.number(),
  customFields: z
    .array(
      z.looseObject({
        name: z.string(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
  links: z
    .array(
      z.looseObject({
        direction: z.string().optional(),
        linkType: z.looseObject({ name: z.string().optional() }).optional(),
        issues: z.array(z.looseObject({ idReadable: z.string() })).optional(),
      }),
    )
    .optional(),
})
export type IssueJson = z.infer<typeof issueJsonSchema>

export const ISSUE_FIELDS =
  'id,idReadable,summary,description,created,updated,customFields(name,value),links(direction,linkType(name),issues(idReadable))'

/** issues 面依赖（platform.ts 组装注入；links 供 parent 维度落链） */
export interface IssueDeps {
  http: YtHttpClient
  tr: FieldTranslator
  project: string | undefined
  projectIdCache: { id: string | null }
  links: LinkFacade
}

function httpPath(id: TicketId): string {
  return `/api/issues/${encodeURIComponent(id)}`
}

/** 单条 GET（404 统一收口为 issue-not-found） */
export async function fetchIssueJson(http: YtHttpClient, id: TicketId): Promise<IssueJson> {
  try {
    return await http.request(issueJsonSchema, {
      method: 'GET',
      path: httpPath(id),
      query: { fields: ISSUE_FIELDS },
    })
  } catch (err) {
    if (err instanceof YouTrackPlatformError && err.subcause === 'not-found') {
      throw new YouTrackPlatformError('EXTERNAL_REJECT', 'issue-not-found', `单据不存在：${id}`)
    }
    throw err
  }
}

/** state 必填：无映射值=实例数据缺状态字段（配置/数据问题，明报） */
function requireState(tr: FieldTranslator, json: IssueJson): string {
  const platform = tr.toPlatform('state')
  const hit = FieldTranslator.readCustomField(json.customFields, platform)
  if (!hit.found) {
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'issue-missing-state',
      `单据 ${json.idReadable} 缺状态字段 ${platform}（provision 与实例字段不一致？）`,
    )
  }
  const decoded = tr.decodeValue('state', hit.value)
  if (typeof decoded !== 'string') {
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'issue-missing-state',
      `单据 ${json.idReadable} 的状态字段 ${platform} 值形状无法解码`,
    )
  }
  return decoded
}

/** IssueJson → IssueRecord（读方向翻译，宽容解码见 fieldmap 头注） */
export function toIssueRecord(json: IssueJson, tr: FieldTranslator): IssueRecord {
  const rec: IssueRecord = {
    id: json.idReadable,
    title: json.summary,
    state: requireState(tr, json),
    updated: new Date(json.updated).toISOString(),
  }
  if (json.description !== undefined && json.description !== null) rec.description = json.description
  for (const business of ['type', 'dept', 'lane', 'level', 'assignee'] as const) {
    // 未映射的记录维：读侧跳过（无平台名即无此维可见）；要可见就在 provision 里映射
    let platform: string
    try {
      platform = tr.toPlatform(business)
    } catch {
      continue
    }
    const hit = FieldTranslator.readCustomField(json.customFields, platform)
    if (!hit.found) continue
    const decoded = tr.decodeValue(business, hit.value)
    if (decoded === undefined) continue
    if (business === 'level') rec.level = decoded as number
    else if (business === 'assignee') rec.assignee = decoded as PersonId
    else if (business === 'type') rec.type = decoded as string
    else if (business === 'dept') rec.dept = decoded as string
    else rec.lane = decoded as string
  }
  const parent = parentFromLinks(json)
  if (parent !== undefined) rec.parent = parent
  return rec
}

/** INWARD Subtask 链接 → parent idReadable（YouTrack 的 parent 语义=子单侧 subtask-of 链） */
export function parentFromLinks(json: IssueJson): TicketId | undefined {
  for (const link of json.links ?? []) {
    if (link.direction !== 'INWARD') continue
    if (link.linkType?.name !== 'Subtask') continue
    const first = link.issues?.[0]?.idReadable
    if (first !== undefined) return first
  }
  return undefined
}

/** IssueQuery → YouTrack 查询语言（只用 docs/03 实测白名单语法；未映射过滤维显式报错） */
export function buildIssueQuery(q: IssueQuery, tr: FieldTranslator, project: string | undefined): string {
  const clauses: string[] = []
  if (project !== undefined && project !== '') clauses.push(`project: ${project}`)
  if (q.stateIn !== undefined && q.stateIn.length > 0) {
    clauses.push(`${tr.toPlatform('state')}: ${q.stateIn.join(',')}`)
  }
  if (q.assignee !== undefined) {
    clauses.push(`${tr.toPlatform('assignee')}: ${q.assignee}`)
  }
  if (q.lane !== undefined) {
    clauses.push(`${tr.toPlatform('lane')}: ${q.lane}`)
  }
  if (q.updatedSince !== undefined) {
    // 开区间下界；含等风险由客户端严格后滤兜平（见 listIssues）
    clauses.push(`updated: ${q.updatedSince} .. *`)
  }
  clauses.push('sort by: updated asc')
  return clauses.join(' ')
}

/** list：内部 $top/$skip 翻页拼全量；updatedSince 客户端严格后滤（口径对齐 localplatform） */
export async function listIssues(
  http: YtHttpClient,
  tr: FieldTranslator,
  project: string | undefined,
  q: IssueQuery,
): Promise<IssueRecord[]> {
  if (q.stateIn !== undefined && q.stateIn.length === 0) return [] // 空集语义：不发请求
  const query = buildIssueQuery(q, tr, project)
  const out: IssueRecord[] = []
  let skip = 0
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const batch = await http.request(z.array(issueJsonSchema), {
      method: 'GET',
      path: '/api/issues',
      query: { query, fields: ISSUE_FIELDS, $top: String(LIST_PAGE_SIZE), $skip: String(skip) },
    })
    out.push(...batch.map((j) => toIssueRecord(j, tr)))
    if (batch.length < LIST_PAGE_SIZE) break
    skip += LIST_PAGE_SIZE
  }
  if (q.updatedSince !== undefined) {
    const since = q.updatedSince
    return out.filter((r) => r.updated > since)
  }
  return out
}

/** create 入参校验（运行时口径：外部输入路径也要拦下） */
function validateCreate(input: IssueCreate): void {
  if (typeof input['title'] !== 'string' || input['title'].trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-create-input', 'title 必填且非空')
  }
  if (input['description'] !== undefined && typeof input['description'] !== 'string') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-create-input', 'description 必须是字符串')
  }
  if (input['parent'] !== undefined && typeof input['parent'] !== 'string') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-create-input', 'parent 必须是字符串')
  }
}

/** create：映射可写的记录维 → customFields；提供了却未映射 → 显式报错（不静默丢）
 *  （IssueCreate 无 lane 维——契约现状，lane 只能经 setField 补，对齐 localplatform 注记） */
function buildCreateCustomFields(input: IssueCreate, tr: FieldTranslator): Array<{ name: string; value: unknown }> {
  const customFields: Array<{ name: string; value: unknown }> = []
  for (const business of ['type', 'dept', 'level', 'assignee'] as const) {
    const value = input[business]
    if (value === undefined) continue
    customFields.push({ name: tr.toPlatform(business), value: tr.encodeValue(business, value) })
  }
  return customFields
}

/** 项目内部 id 按短名解析（N11：id 绝不落盘；每实例缓存） */
export async function resolveProjectId(http: YtHttpClient, project: string): Promise<string> {
  const projects = await http.request(
    z.array(z.looseObject({ id: z.string(), shortName: z.string().optional() })),
    { method: 'GET', path: '/api/admin/projects', query: { fields: 'id,shortName,name' } },
  )
  const hit = projects.find((p) => p.shortName === project)
  if (hit === undefined) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'unknown-project', `实例上找不到短名为 ${project} 的项目`)
  }
  return hit.id
}

export async function createIssue(deps: IssueDeps, input: IssueCreate): Promise<IssueRecord> {
  validateCreate(input)
  const { http, tr, project, projectIdCache, links } = deps
  if (project === undefined || project === '') {
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'missing-project-binding',
      'create 需要项目绑定（N1 公司=一个项目）：构造 opts.project 未提供（拟稿待批点，见 index 头注）',
    )
  }
  if (projectIdCache.id === null) projectIdCache.id = await resolveProjectId(http, project)
  const body: Record<string, unknown> = {
    project: { id: projectIdCache.id },
    summary: input.title,
  }
  if (input.description !== undefined) body['description'] = input.description
  const customFields = buildCreateCustomFields(input, tr)
  if (customFields.length > 0) body['customFields'] = customFields
  const created = await http.request(issueJsonSchema, {
    method: 'POST',
    path: '/api/issues',
    query: { fields: ISSUE_FIELDS },
    body,
  })
  if (input.parent !== undefined && input.parent !== '') {
    // parent 维=Subtask 链（links.parent-child 同源）；补链后重取保证返回记录含 parent
    await links.link(input.parent, created.idReadable, 'parent-child')
    return toIssueRecord(await fetchIssueJson(http, created.idReadable), tr)
  }
  return toIssueRecord(created, tr)
}

/** transition：写 state 自定义字段（值 {name}，名字寻址）；返回推进后的记录 */
export async function transitionIssue(
  http: YtHttpClient,
  tr: FieldTranslator,
  id: TicketId,
  toState: string,
): Promise<IssueRecord> {
  if (typeof toState !== 'string' || toState.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-state', '目标状态必须非空')
  }
  const updated = await http.request(issueJsonSchema, {
    method: 'POST',
    path: httpPath(id),
    query: { fields: ISSUE_FIELDS },
    body: { customFields: [{ name: tr.toPlatform('state'), value: { name: toState } }] },
  })
  return toIssueRecord(updated, tr)
}

/**
 * setField 分派：
 *   state → 拒收（transition 唯一通道，docs/18-§二）
 *   title/description → 内建 summary/description 直写
 *   parent → Subtask 链（对齐 localplatform「parent 字段也算 children 来源」；
 *            TODO(v0)：已有父链的替换（删旧链）留集成单）
 *   level → 整数校验后写映射字段
 *   其余 → 经 FieldProvisionMap 翻译写 customField；未映射显式报错
 */
export async function setIssueField(deps: IssueDeps, id: TicketId, field: string, value: unknown): Promise<void> {
  const { http, tr, links } = deps
  if (field === 'state') {
    throw new YouTrackPlatformError(
      'CONFIG_INVALID',
      'state-via-set-field',
      '状态只能经 transition() 推进，setField 不接受 state（docs/18-§二）',
    )
  }
  if (field === 'title' || field === 'description') {
    const encoded = tr.encodeValue(field, value)
    await http.request(issueJsonSchema, {
      method: 'POST',
      path: httpPath(id),
      query: { fields: ISSUE_FIELDS },
      body: { [field === 'title' ? 'summary' : 'description']: encoded },
    })
    return
  }
  if (field === 'parent') {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-field-value', 'parent 必须是非空单号')
    }
    await links.link(value, id, 'parent-child')
    return
  }
  const platform = tr.toPlatform(field) // 未知/未映射 → unmapped-field 显式报错
  await http.request(issueJsonSchema, {
    method: 'POST',
    path: httpPath(id),
    query: { fields: ISSUE_FIELDS },
    body: { customFields: [{ name: platform, value: tr.encodeValue(field, value) }] },
  })
}
