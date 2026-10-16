/**
 * FlowPlatform 端口 —— 协作平台七能力协议（docs/25-§3.2，依据 23）
 * YouTrack=参考实现（packages/yt 改造）；LocalFile=第二实现（契约靶子）。
 * 写入面只被 gateway 调用；游标是不透明字符串（NA1 教训），核心不解释。
 */
import type { CompanySlug, PersonId, TicketId } from './kernel.ts'

export interface IssueRecord {
  id: TicketId
  title: string
  state: string
  type?: string
  dept?: string
  level?: number
  assignee?: PersonId
  parent?: TicketId
  lane?: string
  updated: string
}

export interface IssueQuery {
  project?: string
  stateIn?: string[]
  assignee?: PersonId
  lane?: string
  updatedSince?: string
}

export interface IssueCreate {
  title: string
  description?: string
  type?: string
  dept?: string
  level?: number
  assignee?: PersonId
  parent?: TicketId
}

export interface Comment {
  id: string
  issue: TicketId
  author: string
  body: string
  created: string
}

export interface SignedBody {
  body: string
  /** 署名 [公司·部门·岗位·级别] 自动注入（17-§7），实现负责拼装 */
  signature: string
}

export interface FieldSchema {
  name: string
  type: 'string' | 'int' | 'enum' | 'date' | 'text'
  values?: string[]
  bundle?: string
}

export interface FieldProvisionMap {
  /** 业务字段名 → 平台字段名（模板与建议不写死：公司目录声明映射，适配器翻译） */
  fields: Record<string, string>
  states: string[]
  stateFlow: Record<string, string[]>
}

export interface KbHit {
  path: string
  title: string
  snippet: string
}

export interface PlatformActivity {
  id: string
  ts: string
  issue: TicketId
  kind: string
  actor?: string
}

export interface ActivityPage {
  items: PlatformActivity[]
  /** null=没有更多；语义见 docs/25-§3.2（YouTrack 内部=倒序头取+最后活动 id 边界） */
  nextCursor: string | null
}

export type LinkType = 'parent-child' | 'depends-on' | 'relates-to'

export interface GuardRule {
  from: string
  to: string
  allowRoles?: string[]
}

export interface FlowPlatform {
  issues: {
    list(q: IssueQuery): Promise<IssueRecord[]>
    get(id: TicketId): Promise<IssueRecord>
    create(input: IssueCreate): Promise<IssueRecord>
    transition(id: TicketId, toState: string): Promise<IssueRecord>
    setField(id: TicketId, field: string, value: unknown): Promise<void>
  }
  comments: {
    add(id: TicketId, body: SignedBody): Promise<void>
    list(id: TicketId): Promise<Comment[]>
  }
  fields: {
    schema(): Promise<FieldSchema[]>
    provision(map: FieldProvisionMap): Promise<void>
  }
  kb: {
    upsert(path: string, md: string): Promise<void>
    search(q: string): Promise<KbHit[]>
    get(path: string): Promise<string>
  }
  activity: {
    since(cursor: string | null): Promise<ActivityPage>
  }
  links: {
    link(a: TicketId, b: TicketId, type: LinkType): Promise<void>
    children(id: TicketId): Promise<TicketId[]>
  }
  guards: {
    install(company: CompanySlug, rules: GuardRule[]): Promise<void>
    uninstall(company: CompanySlug): Promise<void>
  }
}
