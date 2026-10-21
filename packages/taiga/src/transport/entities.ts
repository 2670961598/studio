/**
 * 实体描述符 —— Taiga 四实体中取三类作端口「单据」承载（docs/23-§二映射层）。
 *
 * 默认 userstory（docs/32 真机试点全部探针走的就是 userstory：onboard ⑨ 流转+history
 * 实测路径）；issue（Taiga 缺陷实体）同形状备用；task（DEV-43）：类型流 entity 映射
 * 目标（探索单→task 等）——provision 档案面接入，运行时单实体 CRUD 绑定仍 userstory|issue
 * （v1 边界：按类型路由建单归 v2，docs/18-§2.1.1）。epic 不接入（首刀边界）。
 *
 * URL 家族（真机 9000 端口逐条实测，2026-10-18；task 家族与同类同形——/tasks、
 * /task-statuses、/task-custom-attributes、/history/task，Taiga API 同构）：
 *   列表/建单    /api/v1/{collection}?project=<id>
 *   按 ref 取单  /api/v1/{collection}/by_ref?ref=<ref>&project=<id>
 *   状态集       /api/v1/{statuses}?project=<id>
 *   自定义字段   /api/v1/{attributes}?project=<id>
 *   字段值写入   /api/v1/{collection}/custom-attributes-values/<内部id>
 *   历史         /api/v1/history/{history}/<内部id>
 */
export type TaigaEntity = 'userstory' | 'issue' | 'task'

/**
 * 列表分页尺寸（transport 层共享常量——studio-dev-126 T2 收口：原居 issues.ts，
 * memberships/activity/links 从业务面反向引入它=传输层常量倒挂；迁至本家后全部
 * 经 entities.ts 单一来源引入，issues.ts 不再被传输面反向依赖）
 */
export const LIST_PAGE_SIZE = 100

export interface EntityDescriptor {
  entity: TaigaEntity
  /** 列表/建单/PATCH 集合路径段 */
  collection: string
  /** 状态集路径段 */
  statuses: string
  /** 自定义字段定义路径段 */
  attributes: string
  /** history 路径段 */
  history: string
}

const USERSTORY: EntityDescriptor = {
  entity: 'userstory',
  collection: 'userstories',
  statuses: 'userstory-statuses',
  attributes: 'userstory-custom-attributes',
  history: 'userstory',
}

const ISSUE: EntityDescriptor = {
  entity: 'issue',
  collection: 'issues',
  statuses: 'issue-statuses',
  attributes: 'issue-custom-attributes',
  history: 'issue',
}

const TASK: EntityDescriptor = {
  entity: 'task',
  collection: 'tasks',
  statuses: 'task-statuses',
  attributes: 'task-custom-attributes',
  history: 'task',
}

export const ENTITY_DESCRIPTORS: Readonly<Record<TaigaEntity, EntityDescriptor>> = {
  userstory: USERSTORY,
  issue: ISSUE,
  task: TASK,
}

export function entityDescriptor(entity: TaigaEntity): EntityDescriptor {
  const d = ENTITY_DESCRIPTORS[entity]
  if (d === undefined) {
    throw new Error(`未知 Taiga 实体：${String(entity)}`)
  }
  return d
}
