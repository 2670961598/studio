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
  /**
   * 人日预算覆盖（132-§6.4 单C·studio-dev-177，批示 P1「可按人覆盖 people[].cost_caps」）：
   * org-config people[].cost_caps.daily_usd 可选携带（status/skills 同款扩法）。
   * 未携带=用 cost_guard.daily_budget_usd.per_person_default 缺省帽；不携带=现状
   * 行为零变化（cost_guard 段不声明时本键不参与任何判定）。
   */
  costCaps?: { dailyUsd: number }
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

// —— 成本警戒段（132-§6.4 单C·studio-dev-177；批示 P1/P2 载体=132 提案，制作人 2026-10-22 全批） ——

/** 警戒动作值域（P2 直译四档动作；alarm=dispatch+notify 双动作） */
export const COST_GUARD_ROUTES = ['notify', 'dispatch', 'dispatch+notify', 'gate'] as const
export type CostGuardRoute = (typeof COST_GUARD_ROUTES)[number]

/** 警戒档（比例线：at_pct 相对日预算的百分比，>100 合法=超支档如 hard 120） */
export interface CostGuardTier {
  /** 档名（org-config 段内唯一；如 watch/warn/alarm/hard） */
  tier: string
  /** 预算百分比线（正有限数） */
  atPct: number
  /** 达线动作（P2 四档） */
  route: CostGuardRoute
}

/**
 * org-config cost_guard 段（不声明=undefined=警戒面整体关闭，现状行为零变化）。
 * 消费面：cost-threshold 唤起源（每拍评估）+ 派发闸 hard 线联动（route='gate' 档）。
 */
export interface CostGuardConfig {
  /** 日预算（USD）：公司日预算 + 人日缺省帽（people[].cost_caps.daily_usd 可按人覆盖） */
  dailyBudgetUsd: { company: number; perPersonDefault: number }
  /** 警戒档（≥1，按 at_pct 升序评估，取最高达标档） */
  alertTiers: readonly CostGuardTier[]
}

/**
 * org-config groups 段条目（130-P3 频道供给扩展，130 提案 §6.7.1/C4——组群声明面）。
 * 声明由供给器展开（ensure 幂等收敛）为小组频道 `#<公司slug>-<部门ascii slug>-<组id>`：
 * 如 groups[{id: pln, dept: departments/研发部}] → `#studio-dev-rd-pln`（DEV-20 §5.1 命名法）。
 * members 为工号显式清单（审计面——不按 role 模糊匹配；增减人改声明，下拍供给收敛）。
 */
export interface OrgGroupDecl {
  /** 组 id：ASCII slug（频道别名段——语法闸同公司 slug），部门内唯一 */
  id: string
  /** 所属部门 path（须在 departments 内——装载交叉校验） */
  dept: string
  /** 频道显示名（CJK，如「研发部-策划组」） */
  name: string
  /** 组长（可选；组长进群 PL=50——DEV-20 §5.3 部门频道列「部门主管」槽同款） */
  leader?: PersonId
  /** 成员工号清单（≥1；leader 若声明须在清单内） */
  members: PersonId[]
}

/**
 * org-config hooks 段（129-§6.1① / §6.3 P0-A，studio-dev-178 单C）：公司级事件
 * 唤起钩子声明面。v0 只开 `data_change.routes`——data-change 意图的路由表
 * （变更类型 → 联动单 assignee 工号；入/退/调→对账岗〔docs/52-§13 C1-08 口径〕，
 * 升/降→规划线，由各公司自配）。类型值域（人事事件七值）归引擎路由闸 fail-closed
 * （129-A 纪律：值域不复制进 company 校验器）；装载面只做形状闸+目标工号悬空检。
 */
export interface OrgHooksDecl {
  /**
   * 数据变更路由表：变更类型 → 联动单 assignee 工号（P0-A 验收样板：
   * 新人入司 → 路由命中者的收件箱自动出现对账单，零手工派单）。
   * daemon.yaml `dataChangeRoutes` 为逐键覆盖位（部署级逃生——合并面在装配层）。
   */
  data_change?: { routes: Record<string, string> }
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
   * 事件钩子声明（129-§6.1①，studio-dev-178 单C；不声明=undefined=引擎路由闸
   * fail-closed 现状行为）。可选=快照向后兼容（workflows/groups 同款扩法）；
   * 装载面交叉校验 route 目标工号在册。
   */
  hooks?: OrgHooksDecl
  /**
   * 组群声明（130-P3，130 提案 §6.7.1/C4；不声明=undefined=无小组频道供给）。
   * 可选=快照向后兼容（workflows 同款扩法）；装载面交叉校验（dept 存在/工号在册）。
   */
  groups?: OrgGroupDecl[]
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
  /**
   * 成本警戒段（132-§6.4 单C·studio-dev-177；不声明=undefined=警戒面关闭）。
   * 可选=快照向后兼容（workflows 同款扩法）；声明即经装载面交叉校验
   * （档名/线值唯一、route='gate' 至多一档）。
   */
  costGuard?: CostGuardConfig
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
