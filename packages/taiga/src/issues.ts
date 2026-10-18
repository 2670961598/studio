/**
 * 单据面 —— Taiga userstory/issue CRUD ↔ FlowPlatform.issues（docs/25-§3.2）
 *
 * 请求路径全部真机实测（docs/32 / 9000 端口，2026-10-18）：
 *   list   GET  /api/v1/{collection}?project=<id>&page=&page_size=（分页头迭代见 http.ts）
 *   get    GET  /api/v1/{collection}/by_ref?ref=&project=
 *   create POST /api/v1/{collection} {project, subject, description?, assigned_to?}
 *   flow   PATCH /api/v1/{collection}/{内部id} {status, version}（乐观并发：409=conflict 明报）
 *   字段   title/description/assignee 原生 PATCH；自定义维（type/dept/level/lane）走
 *          **专用值端点** GET/PATCH /api/v1/{collection}/custom-attributes-values/{内部id}
 *          （真机实证：实体序列化器不回显属性值；POST 该路径 405；PATCH 体键
 *          attributes_values + 值对象自身 version——2026-10-18 冒烟核验）
 *
 * 成本注记：自定义维有映射时，list/get 每单多一次值端点 GET（Taiga API 形状所迫，
 * 实测 ~9ms/次；AI 访问量级可忽略——docs/32 §四成本面）。无映射时零额外开销。
 *
 * 口径对齐：
 *   - TicketId = `<slug>-<ref>`（裸 ref 不跨项目消歧；内部数字 id 绝不落盘，N11）
 *   - IssueQuery 全维客户端过滤（公司作用域内单实体集，数百单量级成本可忽略——docs/32 §四）
 *   - updatedSince = 严格大于（ISO 字典序，与 localplatform/yt 同口径）
 *   - stateIn 空数组 → 空集不发请求；lane 未映射却要过滤 → 显式报错（不静默）
 *   - parent 维依赖 links 面：本切片 links 留骨架（docs/32 §四 issue↔US 关联待核）→ parent 显式报错
 */
import type { IssueCreate, IssueQuery, IssueRecord, PersonId, TicketId } from '@studio-next/contract'
import type { TaigaContext, EntityRaw } from './context.ts'
import { parseEntity, parseEntityList } from './context.ts'
import { notImplemented, TaigaPlatformError } from './errors.ts'
import { asObject } from './shape.ts'

export const LIST_PAGE_SIZE = 100

/** 自定义维（经 FieldProvisionMap 映射后可见可写） */
const CUSTOM_BUSINESS_DIMS = ['type', 'dept', 'level', 'lane'] as const

/** 实例是否映射了任何自定义维（决定读路径要不要拉值端点） */
function hasCustomDims(ctx: TaigaContext): boolean {
  return CUSTOM_BUSINESS_DIMS.some((d) => ctx.fieldMap.toPlatform(d) !== undefined)
}

async function toIssueRecord(ctx: TaigaContext, raw: EntityRaw): Promise<IssueRecord> {
  const rec: IssueRecord = {
    id: ctx.ticketId(raw.ref),
    title: raw.subject,
    state: await ctx.statusNameById(raw.status),
    updated: raw.modifiedDate,
  }
  if (raw.description !== undefined) rec.description = raw.description
  if (raw.assignedTo !== undefined) {
    const username = await ctx.usernameById(raw.assignedTo)
    if (username !== undefined) rec.assignee = username as PersonId
  }
  if (hasCustomDims(ctx)) {
    // 属性值只在专用值端点可见（实体序列化器不回显——真机实证）；无映射时零开销
    const attrValues = await ctx.fetchAttrValues(raw.id)
    for (const business of CUSTOM_BUSINESS_DIMS) {
      const platform = ctx.fieldMap.toPlatform(business)
      if (platform === undefined) continue
      const attr = (await ctx.attributes()).find((a) => a.name === platform)
      if (attr === undefined) continue
      const value = attrValues[String(attr.id)]
      if (value === undefined || value === '') continue // '' = Taiga 的「已清空」
      const decoded = ctx.fieldMap.decode(business, value)
      if (business === 'level') rec.level = decoded as number
      else if (business === 'type') rec.type = decoded as string
      else if (business === 'dept') rec.dept = decoded as string
      else rec.lane = decoded as string
    }
  }
  return rec
}

function matchesQuery(rec: IssueRecord, q: IssueQuery): boolean {
  if (q.stateIn !== undefined && !q.stateIn.includes(rec.state)) return false
  if (q.assignee !== undefined && rec.assignee !== q.assignee) return false
  if (q.lane !== undefined && rec.lane !== q.lane) return false
  if (q.updatedSince !== undefined && !(rec.updated > q.updatedSince)) return false
  return true
}

export async function listIssues(ctx: TaigaContext, q: IssueQuery): Promise<IssueRecord[]> {
  if (q.stateIn !== undefined && q.stateIn.length === 0) return [] // 空集语义：不发请求
  if (q.lane !== undefined && ctx.fieldMap.toPlatform('lane') === undefined) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'unmapped-field', 'lane 过滤维未在字段映射中声明（FieldProvisionMap.fields.lane）')
  }
  const projectId = await ctx.project()
  const raws = await ctx.client.paginate(
    { method: 'GET', path: `/${ctx.desc.collection}`, query: { project: String(projectId) } },
    (v) => parseEntityList(v, 'entity-list'), // 列表形态无 description（实测）——照常解析，该维自然缺省
    LIST_PAGE_SIZE,
  )
  const out: IssueRecord[] = []
  for (const raw of raws) {
    const rec = await toIssueRecord(ctx, raw)
    if (matchesQuery(rec, q)) out.push(rec)
  }
  return out
}

/** 404 统一收口为 issue-not-found（读/写路径同口径，对齐 yt） */
async function requireEntity(ctx: TaigaContext, id: TicketId): Promise<EntityRaw> {
  const ref = ctx.parseTicketId(id)
  try {
    return await ctx.fetchEntityByRef(ref)
  } catch (err) {
    if (err instanceof TaigaPlatformError && err.subcause === 'not-found') {
      throw new TaigaPlatformError('EXTERNAL_REJECT', 'issue-not-found', `单据不存在：${id}`)
    }
    throw err
  }
}

export async function getIssue(ctx: TaigaContext, id: TicketId): Promise<IssueRecord> {
  return toIssueRecord(ctx, await requireEntity(ctx, id))
}

function validateCreate(input: IssueCreate): void {
  if (typeof input['title'] !== 'string' || input['title'].trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-create-input', 'title 必填且非空')
  }
  for (const field of ['description', 'type', 'dept', 'assignee', 'parent'] as const) {
    const v = input[field]
    if (v !== undefined && typeof v !== 'string') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-create-input', `${field} 必须是字符串`)
    }
  }
  if (input.level !== undefined && (typeof input.level !== 'number' || !Number.isInteger(input.level))) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-create-input', 'level 必须是整数')
  }
}

export async function createIssue(ctx: TaigaContext, input: IssueCreate): Promise<IssueRecord> {
  validateCreate(input)
  if (input.parent !== undefined) {
    throw notImplemented('links', 'parent 维依赖单据关联（issue↔US 横向关联未实测，docs/32 §四待核项），links 面本切片留骨架')
  }
  const projectId = await ctx.project()
  const body: Record<string, unknown> = { project: projectId, subject: input.title }
  if (input.description !== undefined) body['description'] = input.description
  if (input.assignee !== undefined) body['assigned_to'] = await ctx.idByUsername(input.assignee)
  const res = await ctx.client.request({ method: 'POST', path: `/${ctx.desc.collection}`, body })
  const created = parseEntity(asObject(res.json, 'create'), 'create')
  // 自定义维落值（映射了且入参给了才写；PATCH 值端点形状见 context.patchAttrValues 头注）
  const attributes: Record<string, string | number> = {}
  for (const business of ['type', 'dept', 'level'] as const) {
    const value = input[business]
    if (value === undefined) continue
    const platform = ctx.fieldMap.toPlatform(business)
    if (platform === undefined) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unmapped-field', `建单入参给了 ${business} 但未在字段映射中声明`)
    }
    attributes[String(await ctx.attributeIdByName(platform))] = ctx.fieldMap.encode(business, value)
  }
  if (Object.keys(attributes).length > 0) {
    await ctx.patchAttrValues(created.id, attributes)
    return getIssue(ctx, ctx.ticketId(created.ref)) // 重取：记录含自定义维
  }
  return toIssueRecord(ctx, created)
}

/** PATCH 单条（内部 id 寻址 + version 乐观并发） */
async function patchEntity(ctx: TaigaContext, raw: EntityRaw, patch: Record<string, unknown>): Promise<EntityRaw> {
  const res = await ctx.client.request({
    method: 'PATCH',
    path: `/${ctx.desc.collection}/${String(raw.id)}`,
    body: { ...patch, version: raw.version },
  })
  return parseEntity(asObject(res.json, 'patch'), 'patch')
}

export async function transitionIssue(ctx: TaigaContext, id: TicketId, toState: string): Promise<IssueRecord> {
  if (typeof toState !== 'string' || toState.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-state', '目标状态必须非空')
  }
  const raw = await requireEntity(ctx, id)
  const targetId = await ctx.statusIdByName(toState)
  if (raw.status === targetId) return toIssueRecord(ctx, raw) // 幂等：已在目标态不重放写
  const updated = await patchEntity(ctx, raw, { status: targetId })
  return toIssueRecord(ctx, updated)
}

/**
 * setField 分派（**入参校验先于取单 IO**——非法字段/值不发请求）：
 *   state → 拒收（transition 唯一通道，docs/18-§二）
 *   title/description → 原生 subject/description 直写
 *   assignee → 成员 username 解析（null=清空）
 *   parent → links 骨架（docs/32 §四待核项，显式报错）
 *   自定义维（type/dept/level/lane）→ FieldProvisionMap 翻译写属性值；
 *   未映射/未知字段 → 显式报错（不静默丢）
 */
export async function setIssueField(ctx: TaigaContext, id: TicketId, field: string, value: unknown): Promise<void> {
  if (field === 'state') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'state-via-set-field', '状态只能经 transition() 推进，setField 不接受 state（docs/18-§二）')
  }
  // —— 先校验后 IO：字段合法性与值形状不依赖平台状态 ——
  const isNative = field === 'title' || field === 'description' || field === 'assignee' || field === 'parent'
  const isCustom = (CUSTOM_BUSINESS_DIMS as readonly string[]).includes(field)
  if (!isNative && !isCustom) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-field', `未知字段：${field}`)
  }
  if (field === 'title' && (typeof value !== 'string' || value.trim() === '')) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', 'title 必须是非空字符串')
  }
  if (field === 'description' && typeof value !== 'string') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', 'description 必须是字符串')
  }
  if (field === 'assignee' && value !== null && (typeof value !== 'string' || value.trim() === '')) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', 'assignee 必须是用户名（username）或 null')
  }
  if (field === 'parent') {
    // 骨架面快速失败（不实现就不该产生任何 IO）
    throw notImplemented('links', 'parent 维依赖单据关联（docs/32 §四待核项），links 面本切片留骨架')
  }
  if (isCustom) {
    ctx.fieldMap.requirePlatform(field) // 未映射 → unmapped-field（IO 前报错）
    if (field === 'level') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', 'level 必须是整数')
      }
    } else if (typeof value !== 'string') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-field-value', `${field} 必须是字符串`)
    }
  }

  const raw = await requireEntity(ctx, id)
  if (field === 'title') {
    await patchEntity(ctx, raw, { subject: value as string })
    return
  }
  if (field === 'description') {
    await patchEntity(ctx, raw, { description: value as string })
    return
  }
  if (field === 'assignee') {
    await patchEntity(ctx, raw, { assigned_to: value === null ? null : await ctx.idByUsername(value as string) })
    return
  }
  // 自定义维（专用值端点 PATCH，见 context.patchAttrValues 头注）
  const platform = ctx.fieldMap.requirePlatform(field)
  const attrId = await ctx.attributeIdByName(platform)
  await ctx.patchAttrValues(raw.id, { [String(attrId)]: ctx.fieldMap.encode(field, value) })
}
