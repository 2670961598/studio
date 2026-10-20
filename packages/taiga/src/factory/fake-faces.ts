/**
 * fake-faces —— FakeTaiga 的 DEV-49 出厂态根治路由面（S0 语义定版=docs/32-§九）。
 *
 * 从 testutil.ts 上移的三条路由（尺寸基线清偿，docs/20-§十五.三；行为与内联版零变更）：
 *   1. PATCH /api/v1/projects/{id}——ProjectValidator 可写 default_*_status（A1 重指面）
 *   2. DELETE /api/v1/{userstory|issue|task}-statuses/{id}?moveTo={id}——MoveOnDestroyMixin
 *      语义（A3 退役面）：moveTo 必填（缺=400）；引用单据先行迁移（不拒删不级联删）；
 *      被删状态若是项目默认值→默认值改指 moveTo；成功 204 无体。task/issue 桩无状态
 *      承载单（引用迁移面对两实体为空真——userstory 面用 entities 全量迁移建模）
 *   3. POST /userstories 不带 status 落**项目默认态**（红面根因口径——与 statuses[0]
 *      无关；A1 重指后同路径建单即落声明集内=绿证）
 *
 * 默认态回显段（by_slug/PATCH 共用 projectDefaultsEcho）。
 */
import type { FakeTaiga } from '../testutil.ts'

type Respond = (status: number, json: unknown) => Response

/** 四默认态回显段（ProjectSerializer 形状；epic 无接入=null） */
export function projectDefaultsEcho(fake: FakeTaiga): Record<string, number | null> {
  return {
    default_epic_status: null,
    default_us_status: fake.defaultStatuses.userstory,
    default_task_status: fake.defaultStatuses.task,
    default_issue_status: fake.defaultStatuses.issue,
  }
}

/**
 * DEV-49 三路由处理器：命中即返 Response，未命中返 undefined（route() 继续走其余面）。
 * query=已解析的查询参数表；respond=testutil 的统一响应构造器。
 */
export function factoryCureRoute(
  fake: FakeTaiga,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string>,
  respond: Respond,
): Response | undefined {
  // —— 项目默认态改指（A1）——
  const pm = /^\/api\/v1\/projects\/(\d+)$/.exec(path)
  if (pm !== null && method === 'PATCH') {
    if (pm[1] !== '1') return respond(404, { _error_message: 'Project not found', _error_type: 'not_found' })
    const b = (body ?? {}) as { default_us_status?: unknown; default_task_status?: unknown; default_issue_status?: unknown }
    for (const [field, entity] of [
      ['default_us_status', 'userstory'],
      ['default_task_status', 'task'],
      ['default_issue_status', 'issue'],
    ] as const) {
      const v = b[field]
      if (v === undefined) continue
      if (v !== null && typeof v !== 'number') return respond(400, { [field]: ['A valid integer is required.'] })
      fake.defaultStatuses[entity] = v
    }
    return respond(200, { id: 1, slug: 'probe-co', ...projectDefaultsEcho(fake) })
  }

  // —— 状态档 DELETE（A3，MoveOnDestroyMixin）——
  const delStatus = /^\/api\/v1\/(userstory|issue|task)-statuses\/(\d+)$/.exec(path)
  if (delStatus !== null && method === 'DELETE') {
    const entity = delStatus[1] as 'userstory' | 'issue' | 'task'
    const list = entity === 'userstory' ? fake.statuses : entity === 'issue' ? fake.issueStatuses : fake.taskStatuses
    const target = list.find((s) => s.id === Number(delStatus[2]))
    if (target === undefined) return respond(404, { _error_message: 'Status not found', _error_type: 'not_found' })
    const moveToRaw = query['moveTo']
    if (moveToRaw === undefined || moveToRaw === '' || !/^\d+$/.test(moveToRaw)) {
      return respond(400, { _error_message: "Query param 'moveTo' is required", _error_type: 'validation_error' })
    }
    const moveTo = list.find((s) => s.id === Number(moveToRaw))
    if (moveTo === undefined) return respond(404, { _error_message: 'moveTo status not found', _error_type: 'not_found' })
    if (fake.failStatusDeletes.has(target.id)) {
      return respond(500, { _error_message: 'simulated status delete failure', _error_type: 'server_error' })
    }
    if (entity === 'userstory') {
      for (const e of fake.entities) {
        if (e.status === target.id) {
          e.status = moveTo.id
          fake.pushHistory(e.id, { diffKeys: ['status'] })
        }
      }
    }
    if (fake.defaultStatuses[entity] === target.id) fake.defaultStatuses[entity] = moveTo.id
    list.splice(list.indexOf(target), 1)
    return new Response(null, { status: 204, headers: { 'Content-Type': 'application/json' } })
  }
  return undefined
}
