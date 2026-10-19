/**
 * createYouTrackPlatform —— FlowPlatform 端口的 YouTrack 实现组装（docs/23/25-§3.2）。
 *
 * 公司作用域在构造时绑定（docs/25-§3.2「适配器实例=公司作用域」）：
 *   - fields: FieldProvisionMap —— 业务字段名↔平台字段名翻译表（state 映射必给）
 *   - project: 项目短名（N1 公司=一个 YouTrack 项目）——issues 查询加 project: 前缀、
 *     activity 按项目前缀过滤、create 的落点（create 缺它显式报错）
 *   - fetch 可注入（缺省 globalThis.fetch；测试注入 fake 回放，零真实网络）
 *
 * v0 不做：超时/重试/限流（见 errors.ts 头注）；真实例冒烟=独立集成单。
 */
import type {
  ActivityPage,
  Comment,
  CompanySlug,
  FieldProvisionMap,
  FieldSchema,
  FlowPlatform,
  GuardRule,
  IssueCreate,
  IssueQuery,
  IssueRecord,
  KbHit,
  LinkType,
  PlatformRole,
  SignedBody,
  TicketId,
} from '@studio-next/contract'
import { DEFAULT_PAGE_SIZE, activitySince } from './activity.ts'
import { addComment, listComments } from './comments.ts'
import { YouTrackPlatformError } from './errors.ts'
import { FieldTranslator } from './fieldmap.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { installGuards, readGuards, uninstallGuards } from './guards.ts'
import { YtHttpClient, type FetchLike } from './http.ts'
import { createIssue, listIssues, fetchIssueJson, setIssueField, toIssueRecord, transitionIssue, type IssueDeps } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { LinkFacade } from './links.ts'

export interface YouTrackPlatformOptions {
  /** 实例根（如 https://youtrack.internal）；尾斜杠自动剥 */
  baseUrl: string
  /** Bearer token（永久 token；密钥永不入库——由部署环境注入） */
  token: string
  /** 公司字段/状态映射（构造期校验：state 映射必给，见 fieldmap.ts） */
  fields: FieldProvisionMap
  /** 项目短名（公司作用域；create 必需——拟稿待批点，见 index.ts 头注） */
  project?: string
  /** 时钟注入：v0 预留未用（一切时间戳以平台响应为准，服务器权威） */
  clock?: () => string
  /** fetch 注入（缺省 globalThis.fetch；测试 fake 回放） */
  fetch?: FetchLike
  /** activity 返回页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function validateOptions(opts: YouTrackPlatformOptions): void {
  if (typeof opts.baseUrl !== 'string' || !/^https?:\/\//.test(opts.baseUrl)) {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-base-url', `baseUrl 必须是 http(s) URL：${String(opts.baseUrl)}`)
  }
  if (typeof opts.token !== 'string' || opts.token.trim() === '') {
    throw new YouTrackPlatformError('CONFIG_INVALID', 'bad-token', 'token 必须是非空字符串')
  }
}

export function createYouTrackPlatform(opts: YouTrackPlatformOptions): FlowPlatform {
  validateOptions(opts)
  const http = new YtHttpClient(opts.baseUrl, opts.token, opts.fetch ?? globalThis.fetch)
  const tr = new FieldTranslator(opts.fields) // 构造期校验（含 state 映射必给）
  const project = opts.project
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const links = new LinkFacade(http)
  const deps: IssueDeps = {
    http,
    tr,
    project,
    projectIdCache: { id: null },
    links,
  }
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(http, tr, project, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return toIssueRecord(await fetchIssueJson(http, id), tr)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(deps, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(http, tr, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        return setIssueField(deps, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        return addComment(http, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(http, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(http, tr)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        provisionFields(tr, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        return kbUpsert(http, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(http, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(http, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(http, project, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        return links.link(a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return links.children(id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        return installGuards(company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        return uninstallGuards(company)
      },
      async read(company: CompanySlug): Promise<PlatformRole[]> {
        return readGuards(company)
      },
    },
  }
}
