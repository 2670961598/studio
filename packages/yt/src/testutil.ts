/**
 * FakeYouTrack —— 状态桩（零真实网络；任务定调：fixtures 预造 YouTrack API JSON 回放）
 *
 * 只建模适配器依赖的最小端点行为（其余形状走 fixtures 原文）：
 *   - GET /api/activities：响应顺序=新→旧（适配器把该顺序当权威顺序，见 activity.ts 头注）；
 *     $top/$skip 认账；其余 query 参数忽略（对齐 N10：未知参数静默丢弃的实例现实）
 *   - GET /api/issues：只解析 `project: X` 子句做公司作用域过滤（服务端全文检索不建模，
 *     查询翻译由测试对 calls 断言）；$top/$skip 认账；created 升序稳定
 *   - 写路径（建单/改字段/评论/链接/文章）落内存并自动产生活动（Issue*Category），
 *     供游标语义做「写后即见」的端到端轮询测试
 *   - 未匹配路由 → 404 并记入 unmatched（fixture 纪律：测试末尾可断言零漏网）
 * 时间：内部 tick（固定步进 1s，起点 2026-01-02），确定性回放。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { ErrorCategory, FieldProvisionMap, FlowPlatform } from '@studio-next/contract'
import { createYouTrackPlatform, YouTrackPlatformError, type FetchLike } from './index.ts'

// —— fixtures 载入（YouTrack API JSON 原文） ——

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')

interface MetaFixture {
  projects: Array<{ id: string; shortName: string; name: string }>
  issueLinks: Array<{ id: string; name: string; directed: boolean }>
  customFields: Array<{ name: string; fieldType: { presentation: string } }>
}
/** activities.json 的 API 形状（target/author 嵌套）→ 内部 FakeActivity 扁平化 */
interface ActivityFixture {
  id: string
  timestamp: number
  category: { id: string }
  target?: { idReadable?: string }
  author?: { login?: string }
}
/** comments.json 的 API 形状（author 嵌套）→ 内部 FakeComment 扁平化 */
interface CommentFixture {
  id: string
  text: string
  created: number
  author: { login: string }
}

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as T
}

// —— 数据形状 ——

export interface FakeIssue {
  id: string
  idReadable: string
  summary: string
  description: string | null
  created: number
  updated: number
  customFields: Array<{ name: string; value: unknown }>
  links: Array<{ direction: string; linkType: { name: string }; issues: Array<{ id: string; idReadable: string }> }>
}
export interface FakeComment {
  id: string
  text: string
  created: number
  authorLogin: string
}
export interface FakeActivity {
  id: string
  timestamp: number
  category: string
  issueIdReadable?: string
  login?: string
}
export interface FakeArticle {
  id: string
  summary: string
  content: string
  parentId: string | null
}
export interface CallLog {
  method: string
  path: string
  query: Record<string, string>
  body?: unknown
}

const TICK_BASE = 1767312000000 // 2026-01-02T00:00:00Z 起，固定步进
const SERVICE_LOGIN = 'svc-agent' // token 对应的平台账号（N9：账号=等级锚点，非工号）

function respond(status: number, json: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response
}

export class FakeYouTrack {
  readonly calls: CallLog[] = []
  readonly unmatched: CallLog[] = []
  readonly projects: MetaFixture['projects']
  readonly linkTypes: MetaFixture['issueLinks']
  readonly adminFields: MetaFixture['customFields']
  issues: FakeIssue[]
  comments: Map<string, FakeComment[]>
  activities: FakeActivity[]
  articles: FakeArticle[]

  private tick = TICK_BASE
  private actSeq = 1
  private issueSeq = 100
  private commentSeq = 100
  private articleSeq = 100
  private readonly issueNoByProject = new Map<string, number>()

  constructor() {
    const meta = loadFixture<MetaFixture>('meta.json')
    this.projects = meta.projects
    this.linkTypes = meta.issueLinks
    this.adminFields = meta.customFields
    this.issues = loadFixture<FakeIssue[]>('issues.json').map((i) => ({ ...i, links: i.links.map((l) => structuredClone(l)) }))
    const comments = loadFixture<Record<string, CommentFixture[]>>('comments.json')
    this.comments = new Map(
      Object.entries(comments).map(([issue, list]) => [
        issue,
        list.map((c) => ({ id: c.id, text: c.text, created: c.created, authorLogin: c.author.login })),
      ]),
    )
    this.activities = loadFixture<ActivityFixture[]>('activities.json').map((a) => ({
      id: a.id,
      timestamp: a.timestamp,
      category: a.category.id,
      ...(a.target?.idReadable === undefined ? {} : { issueIdReadable: a.target.idReadable }),
      ...(a.author?.login === undefined ? {} : { login: a.author.login }),
    }))
    this.articles = loadFixture<FakeArticle[]>('articles.json').map((a) => ({ ...a }))
    for (const issue of this.issues) {
      const m = /^([A-Za-z]+)-(\d+)$/.exec(issue.idReadable)
      if (m !== null && m[1] !== undefined && m[2] !== undefined) {
        const cur = this.issueNoByProject.get(m[1]) ?? 0
        this.issueNoByProject.set(m[1], Math.max(cur, Number(m[2])))
      }
    }
  }

  // —— 注入给适配器的 fetch ——

  readonly fetch: FetchLike = (url: string, init?: { method?: string; body?: string }): Promise<Response> => {
    const u = new URL(url)
    const query = Object.fromEntries(u.searchParams.entries())
    const method = init?.method ?? 'GET'
    let body: unknown
    if (init?.body !== undefined) body = JSON.parse(init.body) as unknown
    const call: CallLog = { method, path: u.pathname, query, ...(body === undefined ? {} : { body }) }
    this.calls.push(call)
    return Promise.resolve(this.route(method, u.pathname, query, body))
  }

  // —— 测试辅助 ——

  private nextTick(): number {
    this.tick += 1000
    return this.tick
  }

  /** 手工注入活动（穿插测试用）；返回活动 id */
  pushActivity(input: Omit<FakeActivity, 'id'>): string {
    const id = `170-${String(this.actSeq++)}`
    this.activities.push({ ...input, id })
    return id
  }

  private autoActivity(category: string, issueIdReadable: string | undefined): void {
    this.pushActivity({ timestamp: this.tick, category, ...(issueIdReadable === undefined ? {} : { issueIdReadable }), login: SERVICE_LOGIN })
  }

  findIssue(idReadable: string): FakeIssue | undefined {
    return this.issues.find((i) => i.idReadable === idReadable)
  }

  private findIssueInternal(id: string): FakeIssue | undefined {
    return this.issues.find((i) => i.id === id)
  }

  private issueJson(i: FakeIssue): Record<string, unknown> {
    return {
      id: i.id,
      idReadable: i.idReadable,
      summary: i.summary,
      description: i.description,
      created: i.created,
      updated: i.updated,
      customFields: i.customFields.map((cf) => ({ ...cf })),
      links: i.links.map((l) => ({
        direction: l.direction,
        linkType: { name: l.linkType.name },
        issues: l.issues.map((x) => ({ id: x.id, idReadable: x.idReadable })),
      })),
      $type: 'Issue',
    }
  }

  private page<T>(list: readonly T[], query: Record<string, string>): T[] {
    const top = Number(query['$top'] ?? '100')
    const skip = Number(query['$skip'] ?? '0')
    return list.slice(skip, skip + top)
  }

  private sortedActivities(): FakeActivity[] {
    return [...this.activities].sort((a, b) => b.timestamp - a.timestamp)
  }

  // —— 路由（只建模适配器用到的端点） ——

  private route(method: string, path: string, query: Record<string, string>, body: unknown): Response {
    // meta 三件
    if (method === 'GET' && path === '/api/admin/projects') return respond(200, this.projects)
    if (method === 'GET' && path === '/api/issueLinks') return respond(200, this.linkTypes)
    if (method === 'GET' && path === '/api/admin/customFieldSettings/customFields') return respond(200, this.adminFields)

    // 活动流：新→旧 + $top/$skip
    if (method === 'GET' && path === '/api/activities') {
      const items = this.page(this.sortedActivities(), query).map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
        category: { id: a.category },
        ...(a.issueIdReadable === undefined
          ? { target: { id: `art-${a.id}`, $type: 'Article' } }
          : { target: { id: this.findIssue(a.issueIdReadable)?.id ?? '0-0', idReadable: a.issueIdReadable, $type: 'Issue' } }),
        ...(a.login === undefined ? {} : { author: { id: `hub-${a.login}`, login: a.login, $type: 'User' } }),
      }))
      return respond(200, items)
    }

    // 单据集合
    if (method === 'GET' && path === '/api/issues') {
      const clause = /(?:^|\s)project: (\S+)/.exec(query['query'] ?? '')
      const prefix = clause === null ? '' : `${clause[1] ?? ''}-`
      const filtered = prefix === '' ? this.issues : this.issues.filter((i) => i.idReadable.startsWith(prefix))
      const sorted = [...filtered].sort((a, b) => a.created - b.created)
      return respond(200, this.page(sorted, query).map((i) => this.issueJson(i)))
    }
    if (method === 'POST' && path === '/api/issues') {
      const b = (body ?? {}) as {
        project?: { id?: string }
        summary?: string
        description?: string
        customFields?: Array<{ name: string; value: unknown }>
      }
      const proj = this.projects.find((p) => p.id === b.project?.id)
      if (proj === undefined) return respond(400, { error_description: 'project is required' })
      const no = (this.issueNoByProject.get(proj.shortName) ?? 0) + 1
      this.issueNoByProject.set(proj.shortName, no)
      const now = this.nextTick()
      // 对齐真实实例行为：State 字段建单自动落 bundle 默认值（新单）
      const customFields = (b.customFields ?? []).map((cf) => ({ ...cf }))
      if (!customFields.some((cf) => cf.name === 'State')) customFields.push({ name: 'State', value: { name: '新单' } })
      const issue: FakeIssue = {
        id: `2-${String(this.issueSeq++)}`,
        idReadable: `${proj.shortName}-${String(no)}`,
        summary: b.summary ?? '',
        description: b.description ?? null,
        created: now,
        updated: now,
        customFields,
        links: [],
      }
      this.issues.push(issue)
      this.autoActivity('IssueCreatedCategory', issue.idReadable)
      return respond(200, this.issueJson(issue))
    }

    // 评论
    let m = /^\/api\/issues\/([^/]+)\/comments$/.exec(path)
    if (m !== null) {
      const issue = this.findIssue(decodeURIComponent(m[1] ?? ''))
      if (issue === undefined) return respond(404, { error_description: 'Issue not found' })
      if (method === 'GET') {
        const list = this.comments.get(issue.idReadable) ?? []
        return respond(
          200,
          this.page(list, query).map((c) => ({
            id: c.id,
            text: c.text,
            created: c.created,
            author: { id: `hub-${c.authorLogin}`, login: c.authorLogin, $type: 'User' },
          })),
        )
      }
      if (method === 'POST') {
        const b = (body ?? {}) as { text?: string }
        const comment: FakeComment = {
          id: `c-${String(this.commentSeq++)}`,
          text: b.text ?? '',
          created: this.nextTick(),
          authorLogin: SERVICE_LOGIN,
        }
        const list = this.comments.get(issue.idReadable) ?? []
        list.push(comment)
        this.comments.set(issue.idReadable, list)
        this.autoActivity('IssueCommentedCategory', issue.idReadable)
        return respond(200, { id: comment.id, text: comment.text, created: comment.created, author: { login: comment.authorLogin } })
      }
    }

    // 链接：POST /api/issues/{src 内部 id}/links/{类型 id}/issues/{target 可读 id}
    m = /^\/api\/issues\/([^/]+)\/links\/([^/]+)\/issues\/([^/]+)$/.exec(path)
    if (m !== null && method === 'POST') {
      const srcId = decodeURIComponent(m[1] ?? '')
      const typeId = decodeURIComponent(m[2] ?? '')
      const tgtId = decodeURIComponent(m[3] ?? '')
      const src = this.findIssueInternal(srcId)
      if (src === undefined) return respond(404, { error_description: 'Source issue not found' })
      const lt = this.linkTypes.find((t) => t.id === typeId)
      if (lt === undefined) return respond(404, { error_description: 'Link type not found' })
      const tgt = this.findIssue(tgtId)
      if (tgt === undefined) return respond(404, { error_description: 'Target issue not found' })
      const srcRef = { id: src.id, idReadable: src.idReadable }
      const tgtRef = { id: tgt.id, idReadable: tgt.idReadable }
      if (lt.name === 'Subtask') {
        // 语义：src（子）subtask-of tgt（父）——子持 INWARD、父持 OUTWARD
        src.links.push({ direction: 'INWARD', linkType: { name: lt.name }, issues: [tgtRef] })
        tgt.links.push({ direction: 'OUTWARD', linkType: { name: lt.name }, issues: [srcRef] })
      } else if (lt.name === 'Depends') {
        src.links.push({ direction: 'OUTWARD', linkType: { name: lt.name }, issues: [tgtRef] })
        tgt.links.push({ direction: 'INWARD', linkType: { name: lt.name }, issues: [srcRef] })
      } else {
        src.links.push({ direction: 'OUTWARD', linkType: { name: lt.name }, issues: [tgtRef] })
        tgt.links.push({ direction: 'OUTWARD', linkType: { name: lt.name }, issues: [srcRef] })
      }
      this.nextTick()
      this.autoActivity('IssueLinksCategory', src.idReadable)
      return respond(200, tgtRef)
    }

    // 单条单据（GET 读 / POST 改）
    m = /^\/api\/issues\/([^/]+)$/.exec(path)
    if (m !== null) {
      const issue = this.findIssue(decodeURIComponent(m[1] ?? ''))
      if (issue === undefined) return respond(404, { error_description: 'Issue not found' })
      if (method === 'GET') return respond(200, this.issueJson(issue))
      if (method === 'POST') {
        const b = (body ?? {}) as {
          summary?: string
          description?: string
          customFields?: Array<{ name: string; value: unknown }>
        }
        if (b.summary !== undefined) issue.summary = b.summary
        if (b.description !== undefined) issue.description = b.description
        for (const cf of b.customFields ?? []) {
          const existing = issue.customFields.find((x) => x.name === cf.name)
          if (existing === undefined) issue.customFields.push({ ...cf })
          else existing.value = cf.value
        }
        issue.updated = this.nextTick()
        this.autoActivity('IssueUpdatedCategory', issue.idReadable)
        return respond(200, this.issueJson(issue))
      }
    }

    // 文章
    if (method === 'GET' && path === '/api/articles') {
      const q = (query['query'] ?? '').trim().toLowerCase()
      const filtered = q === '' ? this.articles : this.articles.filter((a) => `${a.summary} ${a.content}`.toLowerCase().includes(q))
      return respond(
        200,
        this.page(filtered, query).map((a) => ({
          id: a.id,
          summary: a.summary,
          content: a.content,
          parentArticle: a.parentId === null ? null : { id: a.parentId },
        })),
      )
    }
    if (method === 'POST' && path === '/api/articles') {
      const b = (body ?? {}) as { summary?: string; content?: string; parentArticle?: { id?: string } }
      const parentId = b.parentArticle?.id ?? null
      if (parentId !== null && !this.articles.some((a) => a.id === parentId)) {
        return respond(400, { error_description: 'Parent article not found' })
      }
      const article: FakeArticle = {
        id: `2-${String(this.articleSeq++)}`,
        summary: b.summary ?? '',
        content: b.content ?? '',
        parentId,
      }
      this.articles.push(article)
      return respond(200, { id: article.id, summary: article.summary })
    }
    m = /^\/api\/articles\/([^/]+)$/.exec(path)
    if (m !== null) {
      const articleId = decodeURIComponent(m[1] ?? '')
      const article = this.articles.find((a) => a.id === articleId)
      if (article === undefined) return respond(404, { error_description: 'Article not found' })
      if (method === 'GET') {
        return respond(200, {
          id: article.id,
          summary: article.summary,
          content: article.content,
          parentArticle: article.parentId === null ? null : { id: article.parentId },
        })
      }
      if (method === 'POST') {
        const b = (body ?? {}) as { summary?: string; content?: string }
        if (b.summary !== undefined) article.summary = b.summary
        if (b.content !== undefined) article.content = b.content
        return respond(200, { id: article.id, summary: article.summary })
      }
    }

    this.unmatched.push({ method, path, query, ...(body === undefined ? {} : { body }) })
    return respond(404, { error_description: `fake-no-route: ${method} ${path}` })
  }
}

// —— 平台工厂与断言（口径对齐 localplatform testutil） ——

export const TEST_BASE_URL = 'https://yt.example'
export const TEST_TOKEN = 'test-token-000'

/** 默认测试映射（docs/03 默认模板的中文化样例；公司可整体替换——23-§二） */
export const TEST_PROVISION: FieldProvisionMap = {
  fields: { state: 'State', type: 'Type', dept: '部门', level: '等级', assignee: '派单人', lane: '泳道' },
  types: { state: 'enum', type: 'enum', dept: 'enum', level: 'int', lane: 'enum' },
  states: ['新单', '待批', '已派发', '已交付'],
  stateFlow: { 新单: ['待批'], 待批: ['已派发'], 已派发: ['已交付'] },
}

export function makePlatform(
  fake: FakeYouTrack,
  opts?: { project?: string; pageSize?: number; fields?: FieldProvisionMap },
): FlowPlatform {
  return createYouTrackPlatform({
    baseUrl: TEST_BASE_URL,
    token: TEST_TOKEN,
    fields: opts?.fields ?? TEST_PROVISION,
    ...(opts?.project === undefined ? {} : { project: opts.project }),
    ...(opts?.pageSize === undefined ? {} : { pageSize: opts.pageSize }),
    fetch: fake.fetch,
  })
}

/** 异步断言：reject YouTrackPlatformError 且 category/subcause 匹配 */
export async function expectYtReject(
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
  expect(caught, '应当抛出 YouTrackPlatformError').toBeInstanceOf(YouTrackPlatformError)
  const err = caught as YouTrackPlatformError
  expect(err.category).toBe(category)
  expect(err.subcause).toBe(subcause)
}
