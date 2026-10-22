/**
 * 公司目录端口 —— 目录契约的只读快照协议（docs/25-§3.5，依据 04-§二/§九）
 * 目录本身是数据契约（org-config.yaml schema）；本端口是它的读视图。
 * 写路径永远归 daemon（唯一写入者）；校验错误模型=文件:行+修法。
 */
import type { CompanySlug, Money, PersonId } from './kernel.ts'
import type { ModelTier, RoleName } from './models.ts'

export interface PlatformBinding {
  /** youtrack | localfile | …（23-§二：换平台=改一行配置） */
  platform: string
  /** 业务字段名→平台字段名映射覆盖（模板与建议不写死） */
  fieldOverrides?: Record<string, string>
}

export interface DeptRelation {
  to: string
  type: '联签' | '下游交付' | '共享泳道'
  protocol?: string
}

export interface DeptNode {
  name: string
  path: string
  parent: string | null
  leader: PersonId
  level: number
  lanes: string[]
  functions: string[]
  relations: DeptRelation[]
}

export interface PersonRef {
  /** 工号=档案文件名=永不变主键 */
  id: PersonId
  name: string
  /** YouTrack 账号锚点（账号=等级锚点，工号=人） */
  login: string
  level: number
  dept: string
  /**
   * 人事状态（active|paused|retired——模板口径，v0 不锁枚举）：DEV-48 人事同步器
   * 分类维度（docs/52-§5.1 停/复/退/复职判定）。可选=快照向后兼容（DEV-43
   * CompanySnapshot.workflows 同款扩法）；未携带时按 active 缺省语义消费。
   */
  status?: string
  /**
   * 岗位（描述类变更 → 「调」分类，docs/52-§5.1）。正文六节不进快照（§13 风险 3：
   * 分类器只认索引字段级变更）——快照仅承载 front-matter 索引键。
   */
  role?: string
  /**
   * 技能本体索引键（org-config people[].skills——内部工种映射表，不用自由文本）。
   * 可选携带（130-P2，studio-dev-173；DEV-48 status/role 同款扩法）：源文/zod 早已
   * 收此键，本键只把它带进快照供派工建议面（拆单候选打分 F1，提案 §6.5.2）消费；
   * 不携带=建议面降档（role/dept 文本），零破坏。
   */
  skills?: readonly string[]
}

/** D9 通用模型：一切唤起都是定时任务，挂在部门节点下（04-§三） */
export interface ScheduledJob {
  job_id: string
  company: CompanySlug
  dept: string
  cron: string
  role: RoleName
  level: number
  model_tier: ModelTier['tier']
  budget_cap?: Money
  payload?: unknown
}

/**
 * 单据类型流声明（DEV-43，docs/51 v1.1 B-1 workflows 段；语义规范家 docs/18-§2.1.1）。
 * 装载期归一：YAML 裸串状态装载为 {name}（final 缺省 false）。
 */
export interface WorkflowStateDecl {
  /** 状态名（类内唯一、非空——docs/51 W-2） */
  name: string
  /** 终态标记：终态不产生主干前向边（截断推导，W-5）；delivered 锚必须落终态（W-4） */
  final?: boolean
}

/** 补充流转边（打回/promote/重开终态——from 允许=final，与等级流 rollback_edges 同纪律） */
export interface WorkflowEdgeDecl {
  from: string
  to: string
}

/** 语义相位锚点：把机器相位映射到具体状态名（docs/51 W-3/W-4/W-8） */
export interface WorkflowAnchorsDecl {
  /** 收件态（必须=states 首态——W-3） */
  inbox: string
  dispatched: string
  evidence: string
  verified: string
  /** 交付态（必须落 final 状态——W-4） */
  delivered: string
  /** 可选待批位：该流带审批环（只许插 inbox 后/verified 后两槽——W-8）；缺省=无审批环 */
  approval?: string
}

/** 一个单据类型的完整状态流声明（id 禁保留词 bug/task——W-9） */
export interface WorkflowTypeDecl {
  /** 类型 id：非空 slug 语法、禁冒号（FlowTable 键形 T:<type> 的命名空间隔离——W-1） */
  id: string
  /** 可选平台实体映射（userstory/issue/task）：provision 把本类状态建到对应实体工作流 */
  entity?: string
  /** 状态集（≥2，有序=主干：相邻即前向边；final 态截断） */
  states: WorkflowStateDecl[]
  /** 可选补充边 */
  edges?: WorkflowEdgeDecl[]
  /** 语义锚点 */
  anchors: WorkflowAnchorsDecl
}

/** org-config workflows 段（types ≥1；不声明=现状行为，docs/51 v1.1） */
export interface TicketWorkflows {
  types: WorkflowTypeDecl[]
}

export interface CompanySnapshot {
  slug: CompanySlug
  name: string
  level: number
  charter: string
  platform: PlatformBinding
  departments: DeptNode[]
  people: PersonRef[]
  jobs: ScheduledJob[]
  /** 单据类型流声明（DEV-43；不声明=undefined=等级流现状行为） */
  workflows?: TicketWorkflows
  /**
   * 州表卫生·白名单层（127-C，studio-dev-127 §4.7）：已知外来态（org-config
   * `yt.known_foreign_states`）——引擎哨兵对其降 FOREIGN_KNOWN 观察级（不升
   * ESCALATE），巡逻核公式并集吸收；不声明=undefined=哨兵现状全灵敏度。
   */
  knownForeignStates?: readonly string[]
  /**
   * 州表卫生·映射层（127-C，studio-dev-127 §4.7）：外来态→公司态统计映射
   * （org-config `yt.state_mapping`；装载面已过 `yt.state_mapping_audited` 全键
   * 盖戳校验——启用前置审计 fail-closed）。**仅统计视图**（面板进度聚合）——
   * 不动 decide/状态机，不迁移平台状态（daemon 单点写纪律）。不声明=不映射。
   */
  stateMapping?: Readonly<Record<string, string>>
}

/** 校验器输出：结构不合法给 文件:行 + 修法（04-§九） */
export interface DirectoryIssue {
  file: string
  line: number
  rule: string
  fix: string
}

/** 目录挂载结果：合法=快照；不合法=问题清单（拒绝启动，不静默降级） */
export type MountResult = { ok: true; snapshot: CompanySnapshot } | { ok: false; issues: DirectoryIssue[] }
