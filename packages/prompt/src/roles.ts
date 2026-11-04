/**
 * prompt/roles —— L2.5 角色包纯逻辑（studio-dev-724 / 计划 726）
 *
 * 分层：本件**零 IO**（不读盘/不写盘），只放类型、常量与回退文本；公司目录装载/校验在
 * `apps/daemon/src/assembly/roles/loader.ts`（daemon 装配面）——boundary 宪法（20-§十五）
 * 下 company 包不新增文件（计划原写 packages/company/src/roles.ts，实现按 A 拆分规避，见 REPORT）。
 *
 * L2.5 内容 = 公司目录 `prompts/roles/<class>.md` 类模板 + `prompts/roles/cards/<工号>.md`
 * 岗位卡；公司目录权威（DOM-01）。未配置=诚实默认类边界（不冒充角色卡已授权工具/环境）。
 */

export const ROLE_CLASSES = ['minister', 'planner', 'executor', 'qa', 'intel', 'ops'] as const
export type RoleClass = (typeof ROLE_CLASSES)[number]

export const ROLE_CLASS_LABELS: Readonly<Record<RoleClass, string>> = {
  minister: '部长',
  planner: '策划',
  executor: '执行',
  qa: 'QA（独立验收）',
  intel: '情报',
  ops: '运维/职能支持',
}

/** 岗位卡形状（装载器校验后注入；本件不读盘） */
export interface RoleCard {
  readonly personId: string
  readonly roleClass: RoleClass
  readonly title: string
  readonly mission: string
  /** 卡正文（front-matter 之后全文；prompt L2.5 注入） */
  readonly body: string
  readonly version: number
}

/** 单人角色包（类模板+岗位卡；prompt L2.5 源输入） */
export interface RolePack {
  readonly roleClass: RoleClass
  readonly roleLabel: string
  readonly classText: string
  readonly card: RoleCard
}

/** 角色类推断（无卡时回退；按职称关键词——只作缺省提示，不冒充卡片事实） */
export function inferRoleClass(roleOrTitle: string | undefined): RoleClass {
  const text = roleOrTitle ?? ''
  if (/部长|总经理|宰相|老板/.test(text)) return 'minister'
  if (/策划/.test(text)) return 'planner'
  if (/QA|质量|验收/i.test(text)) return 'qa'
  if (/情报|研究|前沿/.test(text)) return 'intel'
  if (/运维|人事|财务|职能|支持/.test(text)) return 'ops'
  return 'executor'
}

/** 未配置角色包的默认 L2.5 文本（诚实标注；不含伪卡片事实） */
export function defaultRolePackText(person: { id: string; role?: string }): {
  roleClass: RoleClass
  classText: string
  cardText: string
} {
  const roleClass = inferRoleClass(person.role)
  return {
    roleClass,
    classText:
      `本岗角色类=${roleClass}（公司未配置 prompts/roles/${roleClass}.md）——默认边界以 L0/L2/L4 与公司目录为准；` +
      '不据此宣称角色卡已授权任何工具/环境。',
    cardText: `工号 ${person.id}：未配置岗位卡；按任务书与类边界执行（最小改动/测试自检/证据四要件/不越权/不自验收）。`,
  }
}
