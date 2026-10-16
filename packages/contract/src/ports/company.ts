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

export interface CompanySnapshot {
  slug: CompanySlug
  name: string
  level: number
  charter: string
  platform: PlatformBinding
  departments: DeptNode[]
  people: PersonRef[]
  jobs: ScheduledJob[]
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
