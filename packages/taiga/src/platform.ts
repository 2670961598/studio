/**
 * createTaigaPlatform —— FlowPlatform 端口的 Taiga 实现组装（docs/23、docs/25-§3.2）。
 *
 * 公司作用域构造期绑定（适配器实例=公司作用域）：
 *   - project：项目 slug（公司=项目，docs/30 §6 ③；必填——全部读写的落点）
 *   - entity：单据承载实体（默认 userstory=docs/32 真机试点全验路径；issue 备用；
 *     task 仅作 workflows 类型流 entity 映射的 provision 档案目标——DEV-43 v1 运行时
 *     单实体 CRUD 绑定仍 userstory|issue，按类型路由建单归 v2，docs/18-§2.1.1）
 *   - fields：业务字段↔Taiga 自定义属性映射（可缺省：state/title/description/assignee
 *     原生；type/dept/level/lane 等自定义维不映射则读不见、写显式报错）
 *   - auth：密码态（自动登录+401 刷新/重登）或预换 token 态（有 refresh 才可续）
 *   - fetch 可注入（缺省 globalThis.fetch；测试 fake 回放零真实网络）
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
  SignedBody,
  TicketId,
} from '@studio-next/contract'
import { DEFAULT_PAGE_SIZE, activitySince } from './activity.ts'
import { addComment, listComments } from './comments.ts'
import { TaigaContext } from './context.ts'
import { entityDescriptor, type TaigaEntity } from './entities.ts'
import { TaigaPlatformError } from './errors.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { TaigaFieldMap } from './fieldmap.ts'
import { installGuards, uninstallGuards } from './guards.ts'
import { TaigaClient, type FetchLike, type TaigaAuth } from './http.ts'
import { createIssue, getIssue, listIssues, setIssueField, transitionIssue } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { children as linkChildren, link as addLink } from './links.ts'

export interface TaigaPlatformOptions {
  /** 实例根（如 http://localhost:9000）；/api/v1 由客户端拼接；尾斜杠自动剥 */
  baseUrl: string
  /** 项目 slug（公司作用域；单据 TicketId 前缀即它） */
  project: string
  /** 认证：密码态或预换 token 态（docs/32 §二① JWT） */
  auth: TaigaAuth
  /** 单据承载实体（默认 userstory；issue 备用；task 仅 provision 档案面——运行时单实体 CRUD 绑定归 v2，docs/18-§2.1.1） */
  entity?: TaigaEntity
  /** 业务字段↔Taiga 自定义属性映射（可缺省，见头注） */
  fields?: FieldProvisionMap
  /** fetch 注入（缺省 globalThis.fetch；测试 fake 回放） */
  fetch?: FetchLike
  /** activity 返回页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function validateOptions(opts: TaigaPlatformOptions): void {
  if (typeof opts.baseUrl !== 'string' || !/^https?:\/\//.test(opts.baseUrl)) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-base-url', `baseUrl 必须是 http(s) URL：${String(opts.baseUrl)}`)
  }
  if (typeof opts.project !== 'string' || opts.project.trim() === '') {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-project', 'project（项目 slug，公司作用域）必填')
  }
  if (opts.auth === undefined || opts.auth === null) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', 'auth 必填（密码态或 token 态）')
  }
  if (opts.auth.type === 'password') {
    if (typeof opts.auth.username !== 'string' || opts.auth.username === '' || typeof opts.auth.password !== 'string' || opts.auth.password === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', '密码态需要非空 username/password')
    }
  } else if (opts.auth.type === 'token') {
    if (typeof opts.auth.token !== 'string' || opts.auth.token === '') {
      throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', 'token 态需要非空 token')
    }
  } else {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-auth', `未知 auth 类型：${String((opts.auth as { type: string }).type)}`)
  }
}

/** 组装上下文（guards.ts 的独立角色读取入口共用） */
export function buildContext(opts: TaigaPlatformOptions): TaigaContext {
  validateOptions(opts)
  const client = new TaigaClient(opts.baseUrl, opts.auth, opts.fetch)
  return new TaigaContext(client, entityDescriptor(opts.entity ?? 'userstory'), opts.project, new TaigaFieldMap(opts.fields))
}

export function createTaigaPlatform(opts: TaigaPlatformOptions): FlowPlatform {
  const ctx = buildContext(opts)
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(ctx, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return getIssue(ctx, id)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(ctx, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(ctx, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        return setIssueField(ctx, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        return addComment(ctx, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(ctx, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(ctx)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        return provisionFields(ctx, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        return kbUpsert(ctx, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(ctx, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(ctx, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(ctx, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        return addLink(ctx, a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return linkChildren(ctx, id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        return installGuards(ctx, company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        return uninstallGuards(ctx, company)
      },
    },
  }
}
