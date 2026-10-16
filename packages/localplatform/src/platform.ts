/**
 * createLocalPlatform —— FlowPlatform 端口的 LocalFile 实现组装（docs/23、docs/25-§3.2）。
 *
 * 构造器注入根目录；实例无内状态（一切状态在盘上），同根多实例互通。
 * 时钟可注入（确定性回放/测试用）；activity 分页大小可注入（默认 100）。
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
import { installGuards, uninstallGuards } from './guards.ts'
import { fieldSchema, provisionFields } from './fields.ts'
import { ensureDir } from './fsutil.ts'
import { createIssue, getIssue, listIssues, setIssueField, transitionIssue } from './issues.ts'
import { kbGet, kbSearch, kbUpsert } from './kb.ts'
import { issuesDir, kbRoot, metaDir } from './layout.ts'
import { addLink, childTickets } from './links.ts'

export interface LocalPlatformOptions {
  /** 时钟注入：默认 new Date().toISOString()；确定性回放注入固定步进时钟 */
  now?: () => string
  /** activity 分页大小（默认 100；测试注入小值验证翻页语义） */
  pageSize?: number
}

function defaultNow(): string {
  return new Date().toISOString()
}

export function createLocalPlatform(root: string, opts?: LocalPlatformOptions): FlowPlatform {
  const now = opts?.now ?? defaultNow
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
  ensureDir(issuesDir(root))
  ensureDir(kbRoot(root))
  ensureDir(metaDir(root))
  return {
    issues: {
      async list(q: IssueQuery): Promise<IssueRecord[]> {
        return listIssues(root, q)
      },
      async get(id: TicketId): Promise<IssueRecord> {
        return getIssue(root, id)
      },
      async create(input: IssueCreate): Promise<IssueRecord> {
        return createIssue(root, now, input)
      },
      async transition(id: TicketId, toState: string): Promise<IssueRecord> {
        return transitionIssue(root, now, id, toState)
      },
      async setField(id: TicketId, field: string, value: unknown): Promise<void> {
        setIssueField(root, now, id, field, value)
      },
    },
    comments: {
      async add(id: TicketId, body: SignedBody): Promise<void> {
        addComment(root, now, id, body)
      },
      async list(id: TicketId): Promise<Comment[]> {
        return listComments(root, id)
      },
    },
    fields: {
      async schema(): Promise<FieldSchema[]> {
        return fieldSchema(root)
      },
      async provision(map: FieldProvisionMap): Promise<void> {
        provisionFields(root, map)
      },
    },
    kb: {
      async upsert(path: string, md: string): Promise<void> {
        kbUpsert(root, path, md)
      },
      async search(q: string): Promise<KbHit[]> {
        return kbSearch(root, q)
      },
      async get(path: string): Promise<string> {
        return kbGet(root, path)
      },
    },
    activity: {
      async since(cursor: string | null): Promise<ActivityPage> {
        return activitySince(root, cursor, pageSize)
      },
    },
    links: {
      async link(a: TicketId, b: TicketId, type: LinkType): Promise<void> {
        addLink(root, now, a, b, type)
      },
      async children(id: TicketId): Promise<TicketId[]> {
        return childTickets(root, id)
      },
    },
    guards: {
      async install(company: CompanySlug, rules: GuardRule[]): Promise<void> {
        installGuards(root, company, rules)
      },
      async uninstall(company: CompanySlug): Promise<void> {
        uninstallGuards(root, company)
      },
    },
  }
}
