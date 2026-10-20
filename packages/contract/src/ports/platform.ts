/**
 * FlowPlatform 端口 —— 协作平台七能力协议（docs/25-§3.2，依据 23）
 * YouTrack=参考实现（packages/yt 改造）；LocalFile=第二实现（契约靶子）。
 * 写入面只被 gateway 调用；游标是不透明字符串（NA1 教训），核心不解释。
 *
 * v1.6（2026-10-19 制作人圈选定案，四项）：guards 补 read 读位（PlatformRole）；
 * PlatformActivity.actor 语义定案（选A：平台侧可归因主体）；kind 词表冻结
 * （PLATFORM_ACTIVITY_KINDS）；lane/level=onboard 统一约定的自定义属性映射（选B）。
 * 详见 docs/25-§3.2「FlowPlatform 端口契约修订刀」裁决块。
 */
import type { CompanySlug, PersonId, TicketId } from './kernel.ts'

export interface IssueRecord {
  id: TicketId
  title: string
  state: string
  description?: string
  type?: string
  dept?: string
  level?: number
  assignee?: PersonId
  parent?: TicketId
  lane?: string
  updated: string
}

export interface IssueQuery {
  stateIn?: string[]
  assignee?: PersonId
  /** lane/level=onboard 统一约定的自定义属性映射（所有平台同形状；v1.6 选B，docs/25-§3.2）——适配器同形状翻译，未映射显式报错 */
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
  /**
   * 建单落位状态（可选，docs/25-§3.2）：建单时单据落在哪个状态。
   * 解析序（适配器统一口径）：显式 initialState > FieldProvisionMap.typeInbox[type]
   * （provision 按单据类型查收件态，DEV-43/docs/18-§2.1.1）> FieldProvisionMap.states[0]
   * （states 按流序声明、首元素=流程初态）> 平台默认态（各平台自带，不猜）。
   * 显式给值服务「不参与派发」的建单方（如定时岗物化的留痕工件落终态）。
   * 这只是建单时的初始落位，不是状态迁移通道——状态推进仍只有 transition() 一条路
   * （docs/18-§二）；平台不认识的目标态必须显式报错，不静默回落默认态。
   */
  initialState?: string
}

export interface Comment {
  id: string
  issue: TicketId
  author: string
  body: string
  created: string
}

export interface SignedBody {
  /** 署名者工号（gateway 组装；Comment.author 由此派生） */
  author: PersonId
  body: string
  /** 署名展示形态 [公司·部门·岗位·级别] 自动注入（17-§7），实现负责拼装 */
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
  /** 业务字段名 → 字段类型（缺省 string） */
  types?: Record<string, 'string' | 'int' | 'enum' | 'date' | 'text'>
  /** 流程状态全集，按流序声明——**首元素=流程初态**（建单落位依据，见 IssueCreate.initialState） */
  states: string[]
  stateFlow: Record<string, string[]>
  /**
   * 类型收件态（DEV-43，docs/18-§2.1.1）：type id → 该类流的 inbox 状态名。
   * 建单落位第二优先级（显式 initialState 之后、states[0] 之前）。
   */
  typeInbox?: Record<string, string>
  /**
   * 类型状态流（DEV-43）：type id → 该类「主干前向边+声明边」合并表。
   * per-type 键化（顶层 stateFlow 保持 legacy-only 永不并集——跨类型同名状态的后继
   * 不合并，guard 接线日按 type 取表）。
   */
  typeFlows?: Record<string, Record<string, string[]>>
  /**
   * 实体映射档案（DEV-43）：entity → 该实体承载的状态集（entity 声明类型的 states 并集）。
   * provision 把这些状态建到对应实体工作流（多实体档案面）；运行时单实体路由归 v2。
   */
  entities?: Record<string, { states: string[] }>
}

export interface KbHit {
  path: string
  title: string
  snippet: string
}

export interface PlatformActivity {
  id: string
  ts: string
  /** 单据类活动必填；kb/fields/guards 类平台级变更可无单 */
  issue?: TicketId
  /**
   * 冻结词表 PLATFORM_ACTIVITY_KINDS（v1.6）——词表外值=实现缺陷，契约校验拒收。
   * 注记：created 类事件以 webhook 为主通道，轮询不保证（Taiga 建单不进 history 实测，docs/32-§七）。
   */
  kind: string
  /**
   * 平台侧可归因主体（平台账号名：yt=author.login、taiga=username；LocalFile 例外=工号——
   * 本就无平台账号层）。工号翻译归框架侧（公司目录账号映射表，docs/04-§五），
   * 翻译机制归后续刀，端口不承载（v1.6 选A）。
   */
  actor?: string
}

/**
 * PlatformActivity.kind 冻结词表（v1.6，2026-10-19 制作人圈选定案）。
 * 三家实现**实际产出**归并（不臆造）：
 *   - created / commented / transitioned / field-set：localplatform 与 yt 的归一动词
 *     （yt KIND_BY_CATEGORY：Created/Commented/Resolved+Reopened→transitioned/Updated→field-set）
 *   - change：taiga history 兜底（无评论且无 diff 的条目）
 *   - unknown：yt 退化档（活动缺类别 id）
 * 词表只增不改，加词走批示。
 */
export const PLATFORM_ACTIVITY_KINDS = [
  'created',
  'commented',
  'transitioned',
  'field-set',
  'change',
  'unknown',
] as const

/** 冻结词表成员类型（PlatformActivity.kind 保持 string：平台喂回的运行时数据，靠本校验把关） */
export type PlatformActivityKind = (typeof PLATFORM_ACTIVITY_KINDS)[number]

/** kind 词表判定：越界=实现缺陷，契约校验据此拒收（负测见 contract 套） */
export function isPlatformActivityKind(v: string): v is PlatformActivityKind {
  return (PLATFORM_ACTIVITY_KINDS as readonly string[]).includes(v)
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

/**
 * 平台侧角色（v1.6 guards 读位）——形状锚=Taiga roles 快照（docs/32-§二⑤：
 * slug/name/permissions 数组，成员类 33 枚/stakeholder 19 枚）。
 * permissions 词表归平台（不冻结）；实现无角色真源时如实反映（如 LocalFile=guard 规则投影）。
 */
export interface PlatformRole {
  slug: string
  name: string
  permissions: readonly string[]
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
    /**
     * 读位（v1.6）：平台侧角色×权限清单——onboard 守闸补偿（docs/30-§6）的审计/回读素材。
     * **暂为可选位**：taiga 接线明确推迟（platform 泳道在飞刀，本刀不碰避冲突）——
     * 三实现接线齐后**转必选**；缺位≠支持，调用方应视为实现缺口明报，不得静默当空清单。
     */
    read?(company: CompanySlug): Promise<PlatformRole[]>
  }
}
