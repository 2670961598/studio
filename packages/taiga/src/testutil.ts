/**
 * FakeTaiga —— 状态桩（零真实网络；任务定调：fixture 用 docs/32 实测响应形状手造）。
 *
 * 形状来源（/tmp/taiga-probe 实录 + 9000 端口只读核验，敏感值脱敏）：
 *   - 分页头 x-pagination-count / x-paginated-by / x-pagination-current（实测头名）
 *   - userstory 列表**无 description**、单条 by_ref 有（实测差异）
 *   - history 新→旧、条目含逐字段 diff + user.username + comment（实测）
 *   - roles 带 permissions 数组（roles-probe-co.json 快照同构，值截短）
 *   - 错误体 {_error_message, _error_type}（Taiga 惯例）
 *   - **建单不产 history 条目**（实测：建单+两次流转只有 2 条状态条目）
 *
 * 认证模型：Bearer 必须持当前有效 token；expireToken() 模拟 JWT 过期（401 →
 * 适配器自动 refresh/重登 → 重试一次的通路可测）。凭据全部假值（永不入仓真凭据）。
 * 时间：内部 tick 固定步进 1s（起点 2026-10-18T00:00:00Z），确定性回放。
 */
import { expect } from 'vitest'
import type { ErrorCategory, FieldProvisionMap, FlowPlatform } from '@studio-next/contract'
import { createTaigaPlatform, TaigaPlatformError, type FetchLike } from './index.ts'

export interface FakeEntity {
  id: number
  ref: number
  subject: string
  description: string | null
  status: number
  version: number
  assignedTo: number | null
  createdDate: string
  modifiedDate: string
  /** 自定义属性值（只在专用值端点可见——实体序列化器不回显，真机实证） */
  attrValues: Record<string, string>
  /** 值对象自身乐观并发号（与实体 version 独立——真机实证） */
  attrVersion: number
  /** 本实体可见 history（新→旧；建单不产条目——实测口径） */
  history: FakeHistoryEntry[]
}

export interface FakeHistoryEntry {
  id: string
  createdAt: string
  username: string
  diffKeys: string[]
  comment: string
  hidden: boolean
  snapshot: boolean
}

export interface FakeWikiPage {
  id: number
  slug: string
  content: string
  /** 页自身乐观并发号（真机 P61-P63：缺/错 version 均 400；成功 version+1、editions+1） */
  version: number
  editions: number
}

export interface FakeTask {
  id: number
  ref: number
  subject: string
  userStory: number
}

export interface FakeIssue {
  id: number
  ref: number
  subject: string
  /** 生成链只读（真机 P40-P45/P58：POST/PATCH 均被静默丢弃；UI 专属动作） */
  generatedFromIssue: number | null
}

export interface CallLog {
  method: string
  path: string
  query: Record<string, string>
  body?: unknown
}

const TICK_BASE = Date.parse('2026-10-18T00:00:00.000Z')
const USERNAME = 'svc-agent'
const PASSWORD = 'fake-password'

function respond(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
}

function hexPad(n: number, width: number): string {
  let s = (n >>> 0).toString(16)
  while (s.length < width) s = `0${s}`
  return s.slice(0, width)
}

/** 全十六进制 UUID 形状（时间低位打散，非字典序——正好考验游标不依赖 id 序） */
function uuidOf(tickMs: number, seq: number): string {
  return `${hexPad(seq, 8)}-${hexPad(tickMs & 0xffff, 4)}-${hexPad((seq ^ 0x4a71) & 0xffff, 4)}-${hexPad((tickMs >>> 16) & 0xffff, 4)}-${hexPad(tickMs + seq, 12)}`
}

export class FakeTaiga {
  readonly calls: CallLog[] = []
  readonly unmatched: CallLog[] = []
  readonly members: Array<{ id: number; username: string }> = [
    { id: 5, username: 'admin' },
    { id: 6, username: 'worker-p2' },
  ]
  readonly statuses: Array<{ id: number; name: string; slug: string }> = [
    { id: 1, name: 'New', slug: 'new' },
    { id: 3, name: 'In progress', slug: 'in-progress' },
    { id: 5, name: 'Done', slug: 'done' },
  ]
  /** issue 实体状态集（DEV-43 多实体 provision：issue-statuses 端点独立于 userstory） */
  readonly issueStatuses: Array<{ id: number; name: string; slug: string }> = [{ id: 21, name: 'New', slug: 'new' }]
  /** task 实体状态集（DEV-43：task-statuses 端点——provision 物化面测试缝） */
  readonly taskStatuses: Array<{ id: number; name: string; slug: string }> = [{ id: 31, name: 'New', slug: 'new' }]
  /** 自定义属性：四映射维 + 一个不映射的（工号）——证明未映射维读不见 */
  readonly attributes: Array<{ id: number; name: string; type: string }> = [
    { id: 11, name: '类型', type: 'text' },
    { id: 12, name: '部门', type: 'text' },
    { id: 13, name: '等级', type: 'number' },
    { id: 14, name: '泳道', type: 'text' },
    { id: 15, name: '工号', type: 'text' },
  ]
  readonly roles: Array<{ id: number; name: string; slug: string; computable: boolean; permissions: string[] }> = [
    { id: 1, name: 'UX', slug: 'ux', computable: true, permissions: ['add_issue', 'modify_issue', 'view_issues', 'add_us', 'modify_us', 'comment_us'] },
    { id: 6, name: 'Stakeholder', slug: 'stakeholder', computable: false, permissions: ['view_issues', 'view_us', 'comment_issue'] },
  ]
  entities: FakeEntity[] = []
  wiki: FakeWikiPage[] = []
  /** task 派生链（真机 P30-P32：POST /tasks {user_story} + GET /tasks?user_story= 过滤有效） */
  tasks: FakeTask[] = []
  /** issue 生成链读面（真机结论：字段回显但 API 不可写——只服务 children(issue)） */
  issues: FakeIssue[] = []
  /** 测试旋钮：下一次 PATCH 强制 409（模拟 GET 与 PATCH 之间的并发写） */
  conflictNextPatch = false

  private tickMs = TICK_BASE
  private seq = 1
  private entitySeq = 100
  private refSeq = 0
  private tokenSeq = 0
  private statusSeq = 6
  private attrSeq = 16
  private wikiSeq = 2
  private taskSeq = 200
  private issueSeq = 300
  private currentToken = 'jwt-test-0'
  private validRefresh = 'refresh-test-0'

  constructor() {
    this.wiki.push({ id: 1, slug: 'home', content: '# 知识库根页\n零依赖跑法见下游', version: 1, editions: 1 })
  }

  // —— 测试辅助 ——
  private nextTick(): string {
    this.tickMs += 1000
    return new Date(this.tickMs).toISOString()
  }

  /** 模拟 JWT 过期（当前 token 失效；refresh 仍可用） */
  expireToken(): void {
    this.currentToken = ''
  }

  /** 直接播种一单（不带 history——建单本就不产条目） */
  seedEntity(input: { subject: string; status?: number; description?: string }): FakeEntity {
    const e: FakeEntity = {
      id: this.entitySeq++,
      ref: ++this.refSeq,
      subject: input.subject,
      description: input.description ?? null,
      status: input.status ?? 1,
      version: 1,
      assignedTo: null,
      createdDate: this.nextTick(),
      modifiedDate: this.nextTick(),
      attrValues: {},
      attrVersion: 1,
      history: [],
    }
    this.entities.push(e)
    return e
  }

  /** 手工注入 history 条目（穿插测试用）；同步推进实体 modified_date（真机语义） */
  pushHistory(entityId: number, input: { username?: string; diffKeys?: string[]; comment?: string; at?: string }): string {
    const e = this.entities.find((x) => x.id === entityId)
    if (e === undefined) throw new Error(`fake: 无实体 ${String(entityId)}`)
    const id = uuidOf(this.tickMs, this.seq++)
    const at = input.at ?? this.nextTick()
    e.history.push({ id, createdAt: at, username: input.username ?? 'admin', diffKeys: input.diffKeys ?? [], comment: input.comment ?? '', hidden: false, snapshot: false })
    e.modifiedDate = at
    return id
  }

  findEntity(ref: number): FakeEntity | undefined {
    return this.entities.find((x) => x.ref === ref)
  }

  /** 播种派生 task（ref 沿项目全局序列——真机 P10-P30 连号口径） */
  seedTask(input: { subject: string; userStory: number }): FakeTask {
    const t: FakeTask = { id: this.taskSeq++, ref: ++this.refSeq, subject: input.subject, userStory: input.userStory }
    this.tasks.push(t)
    return t
  }

  /** 播种 issue（生成链字段只读——真机 P40-P45；generatedFromIssue 仅服务 children 读面） */
  seedIssue(input: { subject: string; generatedFromIssue?: number }): FakeIssue {
    const i: FakeIssue = { id: this.issueSeq++, ref: ++this.refSeq, subject: input.subject, generatedFromIssue: input.generatedFromIssue ?? null }
    this.issues.push(i)
    return i
  }

  /** 播种 wiki 页（测试只关心 slug/content；id/version/editions 由 fake 分配） */
  seedWikiPage(slug: string, content: string): FakeWikiPage {
    const page: FakeWikiPage = { id: this.wikiSeq++, slug, content, version: 1, editions: 1 }
    this.wiki.push(page)
    return page
  }

  countHistoryFetches(): number {
    return this.calls.filter((c) => c.path.startsWith('/api/v1/history/')).length
  }

  /** 写调用计数（幂等断言用：POST/PATCH/PUT/DELETE 条数，不含 auth 交换） */
  countWriteCalls(filter?: (c: CallLog) => boolean): number {
    return this.calls.filter(
      (c) =>
        (c.method === 'POST' || c.method === 'PATCH' || c.method === 'PUT' || c.method === 'DELETE') &&
        !c.path.startsWith('/api/v1/auth') &&
        (filter === undefined || filter(c)),
    ).length
  }

  // —— fetch 注入面 ——

  private lastBearer = ''

  readonly fetch: FetchLike = (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const query = Object.fromEntries(u.searchParams.entries())
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    this.lastBearer = typeof headers['Authorization'] === 'string' ? headers['Authorization'] : ''
    let body: unknown
    if (init?.body !== undefined && typeof init.body === 'string') body = JSON.parse(init.body) as unknown
    this.calls.push({ method, path: u.pathname, query, ...(body === undefined ? {} : { body }) })
    return Promise.resolve(this.route(method, u.pathname, query, body))
  }

  private route(method: string, path: string, query: Record<string, string>, body: unknown): Response {
    // —— 认证交换（免 Bearer）——
    if (method === 'POST' && path === '/api/v1/auth') {
      const b = (body ?? {}) as { type?: string; username?: string; password?: string }
      if (b.type !== 'normal' || b.username !== USERNAME || b.password !== PASSWORD) {
        return respond(401, { _error_message: 'Invalid credentials', _error_type: 'auth' })
      }
      this.currentToken = `jwt-test-${String(++this.tokenSeq)}`
      this.validRefresh = `refresh-test-${String(this.tokenSeq)}`
      return respond(200, { auth_token: this.currentToken, refresh: this.validRefresh, id: 5, username: USERNAME, full_name_display: 'Svc Agent', email: 'svc@fake.local' })
    }
    if (method === 'POST' && path === '/api/v1/auth/refresh') {
      const b = (body ?? {}) as { refresh?: string }
      if (b.refresh !== this.validRefresh) {
        return respond(401, { _error_message: 'Invalid refresh token', _error_type: 'auth' })
      }
      this.currentToken = `jwt-test-${String(++this.tokenSeq)}`
      this.validRefresh = `refresh-test-${String(this.tokenSeq)}`
      return respond(200, { auth_token: this.currentToken, refresh: this.validRefresh })
    }

    // —— Bearer 校验（401 通路：过期/无效 token 一律 401，适配器应刷新重试）——
    if (this.lastBearer !== `Bearer ${this.currentToken}`) {
      return respond(401, { _error_message: 'Invalid token', _error_type: 'not_authenticated' })
    }

    // —— 项目 ——
    if (method === 'GET' && path === '/api/v1/projects/by_slug') {
      if (query['slug'] !== 'probe-co') return respond(404, { _error_message: 'Project not found', _error_type: 'not_found' })
      return respond(200, {
        id: 1,
        name: 'probe-co',
        slug: 'probe-co',
        description: '试点公司',
        created_date: '2026-10-18T00:00:01.000Z',
        modified_date: '2026-10-18T00:00:01.000Z',
        members: this.members.map((m) => ({ id: m.id, username: m.username, full_name_display: m.username, role: 1, role_name: 'UX', is_active: true })),
        owner: { id: 5, username: 'admin', full_name_display: 'admin' },
      })
    }

    // —— 状态集 / 属性集 / 角色（读 + onboard 写面路由）——
    if (method === 'GET' && path === '/api/v1/userstory-statuses') {
      return respond(200, this.statuses.map((s, i) => ({ id: s.id, name: s.name, slug: s.slug, order: i + 1, is_closed: s.id === 5, is_archived: false, color: '#70728F', wip_limit: null, project: 1 })))
    }
    // —— issue/task 状态集（DEV-43 多实体 provision；形状对齐 userstory 同族端点） ——
    if (method === 'GET' && path === '/api/v1/issue-statuses') {
      return respond(200, this.issueStatuses.map((s, i) => ({ id: s.id, name: s.name, slug: s.slug, order: i + 1, is_closed: false, is_archived: false, color: '#70728F', wip_limit: null, project: 1 })))
    }
    if (method === 'POST' && path === '/api/v1/issue-statuses') {
      const b = (body ?? {}) as { project?: number; name?: string }
      const name = typeof b.name === 'string' ? b.name : ''
      if (b.project !== 1 || name.trim() === '') return respond(400, { project: 'This field is required.', name: 'This field is required.' })
      if (this.issueStatuses.some((s) => s.name === name)) return respond(400, { name: ['Duplicated name'] })
      const created = { id: this.statusSeq++, name, slug: `smoke-${String(this.statusSeq)}` }
      this.issueStatuses.push(created)
      return respond(201, { id: created.id, name, slug: created.slug, order: 10, is_closed: false, is_archived: false, color: '#999999', wip_limit: null, project: 1 })
    }
    if (method === 'GET' && path === '/api/v1/task-statuses') {
      return respond(200, this.taskStatuses.map((s, i) => ({ id: s.id, name: s.name, slug: s.slug, order: i + 1, is_closed: false, is_archived: false, color: '#70728F', wip_limit: null, project: 1 })))
    }
    if (method === 'POST' && path === '/api/v1/task-statuses') {
      const b = (body ?? {}) as { project?: number; name?: string }
      const name = typeof b.name === 'string' ? b.name : ''
      if (b.project !== 1 || name.trim() === '') return respond(400, { project: 'This field is required.', name: 'This field is required.' })
      if (this.taskStatuses.some((s) => s.name === name)) return respond(400, { name: ['Duplicated name'] })
      const created = { id: this.statusSeq++, name, slug: `smoke-${String(this.statusSeq)}` }
      this.taskStatuses.push(created)
      return respond(201, { id: created.id, name, slug: created.slug, order: 10, is_closed: false, is_archived: false, color: '#999999', wip_limit: null, project: 1 })
    }
    if (method === 'POST' && path === '/api/v1/userstory-statuses') {
      // 真机 P80/P81：POST {project, name} 201；重名 400 {"name": ["Duplicated name"]}
      const b = (body ?? {}) as { project?: number; name?: string }
      const name = typeof b.name === 'string' ? b.name : ''
      if (b.project !== 1 || name.trim() === '') {
        return respond(400, { project: 'This field is required.', name: 'This field is required.' })
      }
      if (this.statuses.some((s) => s.name === name)) {
        return respond(400, { name: ['Duplicated name'] })
      }
      const created = { id: this.statusSeq++, name, slug: `smoke-${String(this.statusSeq)}` }
      this.statuses.push(created)
      return respond(201, { id: created.id, name, slug: created.slug, order: 10, is_closed: false, is_archived: false, color: '#999999', wip_limit: null, project: 1 })
    }
    if (method === 'GET' && path === '/api/v1/userstory-custom-attributes') {
      return respond(200, this.attributes.map((a, i) => ({ id: a.id, name: a.name, description: '', type: a.type, order: i + 1, project: 1, extra: null, created_date: '2026-10-18T00:00:01.000Z', modified_date: '2026-10-18T00:00:01.000Z' })))
    }
    if (method === 'POST' && path === '/api/v1/userstory-custom-attributes') {
      // 真机 P82-P84：POST {project, name, type?} 201（type 生效）；重名 400
      const b = (body ?? {}) as { project?: number; name?: string; type?: string }
      const name = typeof b.name === 'string' ? b.name : ''
      if (b.project !== 1 || name.trim() === '') {
        return respond(400, { project: 'This field is required.', name: 'This field is required.' })
      }
      if (this.attributes.some((a) => a.name === name)) {
        return respond(400, { name: ['Already exists one with the same name.'], project: ['Already exists one with the same name.'] })
      }
      const type = typeof b.type === 'string' ? b.type : 'text'
      const created = { id: this.attrSeq++, name, type }
      this.attributes.push(created)
      return respond(201, { id: created.id, name, description: '', type, order: Date.now(), project: 1, extra: null, created_date: '2026-10-19T00:00:01.000Z', modified_date: '2026-10-19T00:00:01.000Z' })
    }
    if (method === 'GET' && path === '/api/v1/roles') {
      return respond(200, this.roles.map((r, i) => ({ id: r.id, name: r.name, slug: r.slug, project: 1, order: (i + 1) * 10, computable: r.computable, permissions: [...r.permissions], members_count: 0 })))
    }
    const roleMatch = /^\/api\/v1\/roles\/(\d+)$/.exec(path)
    if (roleMatch !== null && method === 'PATCH') {
      // 真机 P70-P72：PATCH /roles/{id} {permissions} → 200 整角色回显，无 version
      const roleId = Number(roleMatch[1])
      const role = this.roles.find((r) => r.id === roleId)
      if (role === undefined) return respond(404, { _error_message: 'Role not found', _error_type: 'not_found' })
      const b = (body ?? {}) as { permissions?: unknown }
      if (!Array.isArray(b.permissions) || !b.permissions.every((p) => typeof p === 'string')) {
        return respond(400, { permissions: ['This field must be a list of strings.'] })
      }
      role.permissions = [...(b.permissions as string[])]
      return respond(200, { id: role.id, name: role.name, slug: role.slug, project: 1, order: 10, computable: role.computable, permissions: [...role.permissions], members_count: 0 })
    }

    // —— 实体列表（分页头 + 无 description，实测形态）——
    if (method === 'GET' && path === '/api/v1/userstories') {
      return this.pageEntities(this.entities.filter(() => true), query)
    }

    // —— 建单 ——
    if (method === 'POST' && path === '/api/v1/userstories') {
      const b = (body ?? {}) as { project?: number; subject?: string; description?: string; assigned_to?: number | null; status?: number }
      if (typeof b.project !== 'number' || typeof b.subject !== 'string' || b.subject === '') {
        return respond(400, { _error_message: 'project and subject are required', _error_type: 'validation_error' })
      }
      const now = this.nextTick()
      const e: FakeEntity = {
        id: this.entitySeq++,
        ref: ++this.refSeq,
        subject: b.subject,
        description: b.description ?? null,
        status: b.status ?? this.statuses[0]?.id ?? 1,
        version: 1,
        assignedTo: b.assigned_to ?? null,
        createdDate: now,
        modifiedDate: now,
        attrValues: {},
        attrVersion: 1,
        history: [], // 建单不产条目（实测口径）
      }
      this.entities.push(e)
      return respond(200, this.entityJson(e, { withDescription: true }))
    }

    // —— by_ref 单条（带 description）——
    if (method === 'GET' && path === '/api/v1/userstories/by_ref') {
      const e = this.findEntity(Number(query['ref'] ?? '-1'))
      if (e === undefined) return respond(404, { _error_message: 'User story not found', _error_type: 'not_found' })
      return respond(200, this.entityJson(e, { withDescription: true }))
    }

    // —— 自定义属性值端点（真机实证：GET 值对象自动存在；PATCH+值对象自身 version；
    //     POST 该路径 405；实体序列化器不回显——全部按 9000 端口冒烟核验建模）——
    let m = /^\/api\/v1\/userstories\/custom-attributes-values\/(\d+)$/.exec(path)
    if (m !== null) {
      const targetId = Number(m[1])
      const e = this.entities.find((x) => x.id === targetId)
      if (e === undefined) return respond(404, { _error_message: 'User story not found', _error_type: 'not_found' })
      if (method === 'GET') {
        return respond(200, { attributes_values: { ...e.attrValues }, version: e.attrVersion, user_story: e.id })
      }
      if (method === 'POST') {
        return respond(405, { _error_message: "Method 'POST' not allowed.", _error_type: 'taiga.base.exceptions.MethodNotAllowed' })
      }
      if (method === 'PATCH') {
        const b = (body ?? {}) as { attributes_values?: Record<string, string | number>; version?: number }
        if (b.version !== e.attrVersion) {
          return respond(400, { version: 'The version parameter is not valid' }) // 真机错误体形状
        }
        for (const [attrId, value] of Object.entries(b.attributes_values ?? {})) e.attrValues[attrId] = String(value)
        e.attrVersion += 1
        this.pushHistory(e.id, { diffKeys: ['custom_attributes'] })
        return respond(200, { attributes_values: { ...e.attrValues }, version: e.attrVersion, user_story: e.id })
      }
    }

    // —— PATCH 单条（流转/字段/评论）——
    m = /^\/api\/v1\/userstories\/(\d+)$/.exec(path)
    if (m !== null && method === 'PATCH') {
      const targetId = Number(m[1])
      const e = this.entities.find((x) => x.id === targetId)
      if (e === undefined) return respond(404, { _error_message: 'User story not found', _error_type: 'not_found' })
      const b = (body ?? {}) as {
        status?: number
        subject?: string
        description?: string
        assigned_to?: number | null
        comment?: string
        version?: number
      }
      if (b.version !== e.version) return respond(409, { _error_message: 'Version mismatch', _error_type: 'version_mismatch' })
      if (this.conflictNextPatch) {
        this.conflictNextPatch = false
        return respond(409, { _error_message: 'Version mismatch (injected)', _error_type: 'version_mismatch' })
      }
      const diffKeys: string[] = []
      if (b.status !== undefined && b.status !== e.status) {
        diffKeys.push('status', 'is_closed')
        e.status = b.status
      }
      if (b.subject !== undefined && b.subject !== e.subject) {
        diffKeys.push('subject')
        e.subject = b.subject
      }
      if (b.description !== undefined) {
        diffKeys.push('description')
        e.description = b.description
      }
      if (b.assigned_to !== undefined) {
        diffKeys.push('assigned_to')
        e.assignedTo = b.assigned_to
      }
      if (b.comment !== undefined && b.comment !== '') {
        // 评论条目（独立于 diff 条目，Taiga 实测：纯评论=单条 comment 条目）
        this.pushHistory(e.id, { comment: b.comment })
      }
      if (diffKeys.length > 0) {
        this.pushHistory(e.id, { diffKeys })
      }
      e.version += 1
      e.modifiedDate = this.nextTick()
      return respond(200, this.entityJson(e, { withDescription: true }))
    }

    // —— history（新→旧，实测）——
    m = /^\/api\/v1\/history\/userstory\/(\d+)$/.exec(path)
    if (m !== null && method === 'GET') {
      const targetId = Number(m[1])
      const e = this.entities.find((x) => x.id === targetId)
      if (e === undefined) return respond(404, { _error_message: 'History not found', _error_type: 'not_found' })
      const entries = [...e.history].reverse() // 内部存旧→新，响应翻转成新→旧
      return respond(200, entries.map((h) => this.historyJson(h, e.ref)))
    }

    // —— wiki（读 + upsert 写面；真机 P60-P66 端点形状）——
    if (method === 'GET' && path === '/api/v1/wiki') {
      const pageSize = Number(query['page_size'] ?? '30')
      const page = Number(query['page'] ?? '1')
      const slice = this.wiki.slice((page - 1) * pageSize, page * pageSize)
      return respond(200, slice.map((w) => this.wikiJson(w)), {
        'x-pagination-count': String(this.wiki.length),
        'x-paginated-by': String(pageSize),
        'x-pagination-current': String(page),
      })
    }
    if (method === 'GET' && path === '/api/v1/wiki/by_slug') {
      const hit = this.wiki.find((w) => w.slug === query['slug'])
      if (hit === undefined) return respond(404, { _error_message: 'Wiki page not found', _error_type: 'not_found' })
      return respond(200, this.wikiJson(hit))
    }
    if (method === 'POST' && path === '/api/v1/wiki') {
      // 真机 P65/P66：POST {project, slug, content} 201（version=1）；重复 slug 400 __all__
      const b = (body ?? {}) as { project?: number; slug?: string; content?: string }
      if (b.project !== 1 || typeof b.slug !== 'string' || b.slug === '' || typeof b.content !== 'string') {
        return respond(400, { project: 'This field is required.', slug: 'This field is required.', content: 'This field is required.' })
      }
      if (this.wiki.some((w) => w.slug === b.slug)) {
        return respond(400, { __all__: ['Wiki page with this Project and Slug already exists.'] })
      }
      const page: FakeWikiPage = { id: this.wikiSeq++, slug: b.slug, content: b.content, version: 1, editions: 1 }
      this.wiki.push(page)
      return respond(201, this.wikiJson(page))
    }
    m = /^\/api\/v1\/wiki\/(\d+)$/.exec(path)
    if (m !== null && method === 'PATCH') {
      // 真机 P61-P63：PATCH {content, version}——缺/错 version 400；成功 version+1、editions+1
      const page = this.wiki.find((w) => w.id === Number(m[1]))
      if (page === undefined) return respond(404, { _error_message: 'Wiki page not found', _error_type: 'not_found' })
      const b = (body ?? {}) as { content?: string; version?: number }
      if (typeof b.content !== 'string' || b.version !== page.version) {
        return respond(400, { version: 'The version parameter is not valid' })
      }
      page.content = b.content
      page.version += 1
      page.editions += 1
      return respond(200, this.wikiJson(page))
    }

    // —— task 派生链（真机 P30-P32：GET /tasks?user_story= 过滤有效）——
    if (method === 'GET' && path === '/api/v1/tasks') {
      const usFilter = query['user_story'] !== undefined ? Number(query['user_story']) : null
      const list = this.tasks.filter((t) => usFilter === null || t.userStory === usFilter)
      const pageSize = Number(query['page_size'] ?? '30')
      const page = Number(query['page'] ?? '1')
      const slice = list.slice((page - 1) * pageSize, page * pageSize)
      return respond(200, slice.map((t) => this.taskJson(t)), {
        'x-pagination-count': String(list.length),
        'x-paginated-by': String(pageSize),
        'x-pagination-current': String(page),
      })
    }

    // —— issue 生成链读面（真机 P40-P45：字段回显、过滤参数平台不认→客户端过滤）——
    if (method === 'GET' && path === '/api/v1/issues') {
      const pageSize = Number(query['page_size'] ?? '30')
      const page = Number(query['page'] ?? '1')
      const slice = this.issues.slice((page - 1) * pageSize, page * pageSize)
      return respond(200, slice.map((i) => this.issueJson(i)), {
        'x-pagination-count': String(this.issues.length),
        'x-paginated-by': String(pageSize),
        'x-pagination-current': String(page),
      })
    }
    if (method === 'GET' && path === '/api/v1/issues/by_ref') {
      const hit = this.issues.find((x) => x.ref === Number(query['ref'] ?? '-1'))
      if (hit === undefined) return respond(404, { _error_message: 'Issue not found', _error_type: 'not_found' })
      return respond(200, this.issueJson(hit))
    }

    this.unmatched.push({ method, path, query, ...(body === undefined ? {} : { body }) })
    return respond(404, { _error_message: `fake-no-route: ${method} ${path}`, _error_type: 'not_found' })
  }

  private pageEntities(list: FakeEntity[], query: Record<string, string>): Response {
    const pageSize = Number(query['page_size'] ?? '30')
    const page = Number(query['page'] ?? '1')
    const slice = list.slice((page - 1) * pageSize, page * pageSize)
    return respond(200, slice.map((e) => this.entityJson(e, { withDescription: false })), {
      'x-pagination-count': String(list.length),
      'x-paginated-by': String(pageSize),
      'x-pagination-current': String(page),
    })
  }

  private entityJson(e: FakeEntity, opts: { withDescription: boolean }): Record<string, unknown> {
    const status = this.statuses.find((s) => s.id === e.status)
    return {
      id: e.id,
      ref: e.ref,
      subject: e.subject,
      ...(opts.withDescription ? { description: e.description } : {}),
      status: e.status,
      status_extra_info: { name: status?.name ?? '?', color: '#70728F', is_closed: status?.id === 5 },
      version: e.version,
      assigned_to: e.assignedTo,
      assigned_to_extra_info: null,
      owner: 5,
      owner_extra_info: { username: 'admin', full_name_display: 'admin' },
      project: 1,
      project_extra_info: { name: 'probe-co', slug: 'probe-co' },
      milestone: null,
      is_closed: status?.id === 5,
      created_date: e.createdDate,
      modified_date: e.modifiedDate,
      custom_attributes_values: null, // 实体序列化器不回显属性值（真机实证，值走专用端点）
      tags: [],
      watchers: [],
      is_blocked: false,
      blocked_note: '',
      total_comments: e.history.filter((h) => h.comment !== '').length,
    }
  }

  private historyJson(h: FakeHistoryEntry, ref: number): Record<string, unknown> {
    const diff: Record<string, unknown> = {}
    for (const k of h.diffKeys) diff[k] = [1, 2]
    return {
      id: h.id,
      user: { pk: 5, username: h.username, name: h.username, photo: null, is_active: true },
      created_at: h.createdAt,
      type: 1,
      key: `userstories.userstory:${String(ref)}`,
      diff,
      snapshot: null,
      values: {},
      values_diff: diff,
      comment: h.comment,
      comment_html: '',
      delete_comment_date: null,
      delete_comment_user: null,
      edit_comment_date: null,
      is_hidden: h.hidden,
      is_snapshot: h.snapshot,
    }
  }

  private wikiJson(w: FakeWikiPage): Record<string, unknown> {
    return {
      id: w.id,
      project: 1,
      slug: w.slug,
      content: w.content,
      owner: 5,
      last_modifier: 5,
      created_date: '2026-10-18T00:00:01.000Z',
      modified_date: '2026-10-19T00:00:01.000Z',
      editions: w.editions,
      version: w.version,
    }
  }

  private taskJson(t: FakeTask): Record<string, unknown> {
    return {
      id: t.id,
      ref: t.ref,
      subject: t.subject,
      user_story: t.userStory,
      status: 1,
      version: 1,
      project: 1,
      created_date: '2026-10-19T00:00:01.000Z',
      modified_date: '2026-10-19T00:00:01.000Z',
    }
  }

  private issueJson(i: FakeIssue): Record<string, unknown> {
    return {
      id: i.id,
      ref: i.ref,
      subject: i.subject,
      status: 1,
      version: 1,
      project: 1,
      generated_from_issue: i.generatedFromIssue,
      generated_from_task: null,
      generated_from_user_story: null,
      created_date: '2026-10-19T00:00:01.000Z',
      modified_date: '2026-10-19T00:00:01.000Z',
    }
  }
}

// —— 平台工厂与断言（口径对齐 localplatform/yt testutil） ——

export const TEST_BASE_URL = 'http://taiga.test'
export const TEST_PASSWORD_AUTH = { type: 'password' as const, username: USERNAME, password: PASSWORD }

/** 默认测试映射（公司目录声明样例；state/assignee 原生不需要映射） */
export const TEST_FIELDS: FieldProvisionMap = {
  fields: { type: '类型', dept: '部门', level: '等级', lane: '泳道' },
  types: { level: 'int' as const },
  states: ['New', 'In progress', 'Done'],
  stateFlow: { New: ['In progress'], 'In progress': ['Done'] },
}

export function makePlatform(
  fake: FakeTaiga,
  opts?: { pageSize?: number; fields?: FieldProvisionMap | undefined; entity?: 'userstory' | 'issue' },
): FlowPlatform {
  return createTaigaPlatform({
    baseUrl: TEST_BASE_URL,
    project: 'probe-co',
    auth: TEST_PASSWORD_AUTH,
    fields: opts?.fields ?? TEST_FIELDS,
    ...(opts?.entity === undefined ? {} : { entity: opts.entity }),
    ...(opts?.pageSize === undefined ? {} : { pageSize: opts.pageSize }),
    fetch: fake.fetch,
  })
}

/** 异步断言：reject TaigaPlatformError 且 category/subcause 匹配 */
export async function expectTaigaReject(
  fn: () => Promise<unknown>,
  category: ErrorCategory,
  subcause: string,
): Promise<void> {
  let caught: unknown = null
  try {
    await fn()
  } catch (err) {
    caught = err
  }
  expect(caught, '应当抛出 TaigaPlatformError').toBeInstanceOf(TaigaPlatformError)
  const err = caught as TaigaPlatformError
  expect(err.category).toBe(category)
  expect(err.subcause).toBe(subcause)
}
