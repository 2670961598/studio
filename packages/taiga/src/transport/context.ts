/**
 * 适配器上下文 —— 公司作用域绑定与三类平台缓存的共享底座（docs/25-§3.2「适配器实例=公司作用域」）。
 *
 * 公司=项目（docs/30 §6 ③）：project slug 构造期注入；内部数字 id 按名解析、
 * 每实例缓存（N11：实体内部 id 绝不落盘——TicketId 统一用 `<slug>-<ref>` 可读形）。
 *
 * 缓存（懒加载，实例生命周期内信任）：项目 id+成员、状态集、自定义属性集。
 * 换绑/热更不在首刀范围（重造实例即可，语义显式）。
 *
 * studio-dev-126 T1（长实例缓存失稳三面）：
 *   - 传输层**不再反向引入**领域面 fieldmap.ts（BC-T1 门禁钉死）：本文件只声明
 *     结构面 FieldMapLike，TaigaFieldMap 结构满足即注入（鸭子型，测试桩同权）；
 *   - invalidateMembers()：成员写面（hr-sync 邀请/注册/移除）后的写通作废——
 *     成员内嵌在 by_slug 响应里，故 projectId 与 memberList 必须一起作废；
 *   - 抛错型查找（statusIdByName/statusNameById/attributeIdByName/idByUsername）
 *     带**一次有界自愈**：缓存 miss → 作废重读真源一次 → 仍缺才如实抛
 *     （bound=1——不无限重拉；返回 undefined 的查找不自愈，防读放大无界）。
 */
import type { TaigaClient } from './http.ts'
import type { EntityDescriptor } from './entities.ts'
import { TaigaPlatformError } from './errors.ts'

/**
 * 字段映射结构面（T1）：transport 层对「业务字段↔平台名翻译器」的全部消费面。
 * 只收成员签名、不引领域类型——TaigaFieldMap（fieldmap.ts）结构满足即兼容；
 * 测试桩/替代实现同权注入（结构型依赖倒置，BC-T1 的正面表达）。
 */
export interface FieldMapLike {
  /** 类型收件态（typeInbox[type] > states[0]，DEV-40 解析序） */
  initialStateFor(type: string | undefined): string | undefined
  /** 业务字段名 → 平台属性名（未映射=undefined） */
  toPlatform(business: string): string | undefined
  /** 业务字段名 → 平台属性名（未映射=抛错面：requirePlatform） */
  requirePlatform(business: string): string
  /** 业务值 → 平台属性值（写编码） */
  encode(business: string, value: unknown): string | number
  /** 平台属性值 → 业务值（读解码） */
  decode(business: string, raw: string): string | number
  /** 业务字段 → 端口字段型（schema 面；值域=fieldmap.ts PORT_TYPES，此处按结构内联——零反向 import） */
  typeOf(business: string): 'string' | 'int' | 'enum' | 'date' | 'text'
}
import { asArray, asObject, optAttrValues, optNumberNull, optString, optStringNull, reqNumber, reqString } from './shape.ts'

export interface MemberInfo {
  id: number
  username: string
}

export interface StatusInfo {
  id: number
  name: string
  slug: string
}

export interface AttributeInfo {
  id: number
  name: string
  /** text | multiline | richtext | date | url | number */
  type: string
}

/** 单据原始形状（by_ref 单条与列表两形态的交集+并集；列表无 description——实测） */
export interface EntityRaw {
  id: number
  ref: number
  subject: string
  description?: string
  status: number
  version: number
  assignedTo?: number
  createdDate: string
  modifiedDate: string
  attrValues?: Record<string, string>
}

export function parseEntity(v: unknown, ctxLabel: string): EntityRaw {
  const o = asObject(v, ctxLabel)
  const description = optStringNull(o, 'description')
  const assignedTo = optNumberNull(o, 'assigned_to')
  const attrValues = optAttrValues(o, 'custom_attributes_values')
  return {
    id: reqNumber(o, 'id', ctxLabel),
    ref: reqNumber(o, 'ref', ctxLabel),
    subject: reqString(o, 'subject', ctxLabel),
    ...(description === undefined ? {} : { description }),
    status: reqNumber(o, 'status', ctxLabel),
    version: reqNumber(o, 'version', ctxLabel),
    ...(assignedTo === undefined ? {} : { assignedTo }),
    createdDate: reqString(o, 'created_date', ctxLabel),
    modifiedDate: reqString(o, 'modified_date', ctxLabel),
    ...(attrValues === undefined ? {} : { attrValues }),
  }
}

export function parseEntityList(v: unknown, ctxLabel: string): EntityRaw[] {
  return asArray(v, ctxLabel).map((x) => parseEntity(x, ctxLabel))
}

function parseMember(v: unknown): MemberInfo {
  const o = asObject(v, 'member')
  return { id: reqNumber(o, 'id', 'member'), username: reqString(o, 'username', 'member') }
}

function parseStatus(v: unknown): StatusInfo {
  const o = asObject(v, 'status')
  return { id: reqNumber(o, 'id', 'status'), name: reqString(o, 'name', 'status'), slug: reqString(o, 'slug', 'status') }
}

function parseAttribute(v: unknown): AttributeInfo {
  const o = asObject(v, 'attribute')
  return {
    id: reqNumber(o, 'id', 'attribute'),
    name: reqString(o, 'name', 'attribute'),
    type: optString(o, 'type') ?? 'text',
  }
}

export class TaigaContext {
  readonly client: TaigaClient
  readonly desc: EntityDescriptor
  readonly projectSlug: string
  readonly fieldMap: FieldMapLike
  private projectId: number | null = null
  private memberList: MemberInfo[] | null = null
  private statusList: StatusInfo[] | null = null
  private attrList: AttributeInfo[] | null = null

  constructor(client: TaigaClient, desc: EntityDescriptor, projectSlug: string, fieldMap: FieldMapLike) {
    this.client = client
    this.desc = desc
    this.projectSlug = projectSlug
    this.fieldMap = fieldMap
  }

  /** 项目 id+成员一次解析（GET /projects/by_slug；实测成员数组内嵌含 username） */
  private async resolveProject(): Promise<void> {
    if (this.projectId !== null) return
    const res = await this.client.request({ method: 'GET', path: '/projects/by_slug', query: { slug: this.projectSlug } })
    const o = asObject(res.json, 'projects/by_slug')
    this.projectId = reqNumber(o, 'id', 'projects/by_slug')
    const slug = reqString(o, 'slug', 'projects/by_slug')
    if (slug !== this.projectSlug) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-project', `项目 slug 不符：期望 ${this.projectSlug}，实得 ${slug}`)
    }
    this.memberList = asArray(o['members'], 'projects/by_slug.members').map(parseMember)
  }

  async project(): Promise<number> {
    await this.resolveProject()
    const id = this.projectId
    if (id === null) throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-project', `找不到项目 ${this.projectSlug}`)
    return id
  }

  async members(): Promise<MemberInfo[]> {
    await this.resolveProject()
    const list = this.memberList
    if (list === null) throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-project', `找不到项目 ${this.projectSlug}`)
    return list
  }

  async statuses(): Promise<StatusInfo[]> {
    if (this.statusList === null) {
      const projectId = await this.project()
      const res = await this.client.request({
        method: 'GET',
        path: `/${this.desc.statuses}`,
        query: { project: String(projectId) },
      })
      this.statusList = asArray(res.json, this.desc.statuses).map(parseStatus)
    }
    return this.statusList
  }

  async attributes(): Promise<AttributeInfo[]> {
    if (this.attrList === null) {
      const projectId = await this.project()
      const res = await this.client.request({
        method: 'GET',
        path: `/${this.desc.attributes}`,
        query: { project: String(projectId) },
      })
      this.attrList = asArray(res.json, this.desc.attributes).map(parseAttribute)
    }
    return this.attrList
  }

  /**
   * 作废状态集/属性集缓存（写面专用：provision/guards 改了平台侧元数据后调用，
   * 逼下次读回真源——provision 前后各一次，保证幂等判重与 schema() 反映新档）
   */
  invalidateMeta(): void {
    this.statusList = null
    this.attrList = null
  }

  /**
   * 作废「项目 id+成员」缓存（studio-dev-126 T1/T5 写通面：hr-sync 邀请/注册/移除
   * 改了平台成员集后调用）。成员内嵌在 GET /projects/by_slug 响应里、与 projectId
   * 一次解析（N11），故两者必须一起作废——下次 members()/idByUsername() 回真源。
   */
  invalidateMembers(): void {
    this.projectId = null
    this.memberList = null
  }

  async statusIdByName(name: string): Promise<number> {
    let hit = (await this.statuses()).find((s) => s.name === name)
    if (hit === undefined) {
      this.statusList = null // T1 一次有界自愈：长实例缓存可能落后平台真源（他人 provision/平台侧手改）
      hit = (await this.statuses()).find((s) => s.name === name)
    }
    if (hit === undefined) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-state', `项目 ${this.projectSlug} 无状态「${name}」（缓存已重读真源仍缺——先 fields.provision 建档；状态集：${(await this.statuses()).map((s) => s.name).join('、')}）`)
    }
    return hit.id
  }

  async statusNameById(id: number): Promise<string> {
    let hit = (await this.statuses()).find((s) => s.id === id)
    if (hit === undefined) {
      this.statusList = null // T1 一次有界自愈（同上：状态集被平台侧改掉的窗口）
      hit = (await this.statuses()).find((s) => s.id === id)
    }
    if (hit === undefined) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'issue-missing-state', `状态 id ${String(id)} 不在状态集内（缓存已重读真源仍缺——平台侧状态集真缺该态：检查出厂态退役/状态集变更记录）`)
    }
    return hit.name
  }

  async attributeIdByName(name: string): Promise<number> {
    let hit = (await this.attributes()).find((a) => a.name === name)
    if (hit === undefined) {
      this.attrList = null // T1 一次有界自愈
      hit = (await this.attributes()).find((a) => a.name === name)
    }
    if (hit === undefined) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-attribute', `项目 ${this.projectSlug} 无自定义属性「${name}」（缓存已重读真源仍缺——先 fields.provision 建档）`)
    }
    return hit.id
  }

  async attributeNameById(id: number): Promise<string | undefined> {
    const hit = (await this.attributes()).find((a) => a.id === id)
    return hit?.name
  }

  async usernameById(id: number): Promise<string | undefined> {
    return (await this.members()).find((m) => m.id === id)?.username
  }

  async idByUsername(username: string): Promise<number> {
    let hit = (await this.members()).find((m) => m.username === username)
    if (hit === undefined) {
      this.invalidateMembers() // T1 一次有界自愈：hr-sync 建号/邀请后的成员集变化窗口
      hit = (await this.members()).find((m) => m.username === username)
    }
    if (hit === undefined) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'unknown-user', `项目成员中无用户 ${username}（缓存已重读真源仍缺——成员不在位：检查 hr-sync 入场是否完成/项目成员页）`)
    }
    return hit.id
  }

  /** TicketId 形：`<slug>-<ref>`（对齐 YouTrack idReadable 惯例；裸 ref 不可跨项目消歧） */
  ticketId(ref: number): string {
    return `${this.projectSlug}-${String(ref)}`
  }

  parseTicketId(id: string): number {
    const prefix = `${this.projectSlug}-`
    if (!id.startsWith(prefix)) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-ticket-id', `单号必须形如 ${prefix}<ref>：${id}`)
    }
    const digits = id.slice(prefix.length)
    if (!/^\d+$/.test(digits)) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-ticket-id', `单号 ref 必须是数字：${id}`)
    }
    const ref = Number(digits)
    if (!Number.isSafeInteger(ref) || ref < 1) {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-ticket-id', `单号 ref 越界：${id}`)
    }
    return ref
  }

  /** 按可读 ref 取单（by_ref 真机实测路径）；404 由 http 层抛 not-found，这里不包装 */
  async fetchEntityByRef(ref: number): Promise<EntityRaw> {
    const projectId = await this.project()
    const res = await this.client.request({
      method: 'GET',
      path: `/${this.desc.collection}/by_ref`,
      query: { ref: String(ref), project: String(projectId) },
    })
    return parseEntity(res.json, `${this.desc.collection}/by_ref`)
  }

  /**
   * 取单的自定义属性值（专用值端点；真机实证：实体序列化器**不回显**属性值——
   * by_ref/列表/单条一律 null，必须 GET /{collection}/custom-attributes-values/{id}）
   */
  async fetchAttrValues(internalId: number): Promise<Record<string, string>> {
    const res = await this.client.request({
      method: 'GET',
      path: `/${this.desc.collection}/custom-attributes-values/${String(internalId)}`,
    })
    const o = asObject(res.json, 'attr-values')
    const vals = o['attributes_values']
    const out: Record<string, string> = {}
    if (typeof vals === 'object' && vals !== null && !Array.isArray(vals)) {
      for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
        out[k] = typeof v === 'string' ? v : String(v)
      }
    }
    return out
  }

  /**
   * 写自定义属性值（真机实证 2026-10-18：POST 该路径 405 不通；正解=PATCH
   * {attributes_values, version}，version 是**值对象自身**的乐观并发号，先 GET 取）。
   *
   * 合并语义（P1 修复 2026-10-19 监督哨：PATCH 的 attributes_values 是**整体替换**——
   * 只传单字段会抹掉其他自定义维（真机两次作案：设 lane 抹 level、补 level 抹 lane，
   * 台账 studio-dev 22:12 前后）。正解=GET 现值合并后再 PATCH（值不删，只覆盖传入键）。
   */
  async patchAttrValues(internalId: number, attrs: Record<string, string | number>): Promise<void> {
    const path = `/${this.desc.collection}/custom-attributes-values/${String(internalId)}`
    const current = await this.client.request({ method: 'GET', path })
    const currentObj = asObject(current.json, 'attr-values')
    const version = reqNumber(currentObj, 'version', 'attr-values')
    const existing = asObject(currentObj['attributes_values'] ?? {}, 'attributes_values') as Record<
      string,
      string | number
    >
    await this.client.request({
      method: 'PATCH',
      path,
      body: { attributes_values: { ...existing, ...attrs }, version },
    })
  }
}
