/**
 * 实体描述符 —— Taiga 四实体中取两类作端口「单据」承载（docs/23-§二映射层）。
 *
 * 默认 userstory（docs/32 真机试点全部探针走的就是 userstory：onboard ⑨ 流转+history
 * 实测路径）；issue（Taiga 缺陷实体）同形状备用。epic/task 不接入（首刀边界）。
 *
 * URL 家族（真机 9000 端口逐条实测，2026-10-18）：
 *   列表/建单    /api/v1/{collection}?project=<id>
 *   按 ref 取单  /api/v1/{collection}/by_ref?ref=<ref>&project=<id>
 *   状态集       /api/v1/{statuses}?project=<id>
 *   自定义字段   /api/v1/{attributes}?project=<id>
 *   字段值写入   /api/v1/{collection}/custom-attributes-values/<内部id>
 *   历史         /api/v1/history/{history}/<内部id>
 */
export type TaigaEntity = 'userstory' | 'issue'

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

export const ENTITY_DESCRIPTORS: Readonly<Record<TaigaEntity, EntityDescriptor>> = {
  userstory: USERSTORY,
  issue: ISSUE,
}

export function entityDescriptor(entity: TaigaEntity): EntityDescriptor {
  const d = ENTITY_DESCRIPTORS[entity]
  if (d === undefined) {
    throw new Error(`未知 Taiga 实体：${String(entity)}`)
  }
  return d
}
