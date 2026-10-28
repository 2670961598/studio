/**
 * 链接面 —— 真机补测定版（docs/32 §四待核项已答；证据=
 * probe-evidence/taiga-links manifest P10-P60，2026-10-19）。
 *
 * Taiga 关联模型实测结论：
 *   1. ref 是**项目级全局序列**（US 9→issue 10→epic 11→task 12→issue 13-15 连号，
 *      P10-P12/P30/P40-P42）——TicketId `<slug>-<ref>` 跨实体不撞号；但本适配器
 *      issues 面按单实体集合寻址，task/epic 的 ref **不可经 issues.get 读**
 *   2. epic↔US：**API 不可挂接**——POST/GET /epics/{id}/relateduserstories 与
 *      POST /epics/{id}/userstories 均 404（P20/P56/P57）；PATCH US {epics:[id]}
 *      200 但字段被静默忽略（P55/P59，epic 计数仍 0，P60）
 *   3. US→task 派生链：**全通**——POST /tasks {user_story} 201 回显（P30/P31）；
 *      GET /tasks?user_story=<内部id> 过滤有效（P32）——唯一 API 可写的从属链
 *   4. issue 生成链 generated_from_{issue,task,user_story}：序列化器回显字段但
 *      **POST/PATCH 均被静默丢弃**（P40-P43/P58），列表过滤参数不生效（P44/P45）
 *      ——只能由 web UI「生成」动作产生，API 驱动实例上恒为空
 *   5. 横向关联（US↔US / issue↔issue 的 relates/depends）：**无模型**——
 *      /userstory-relations、/issue-relations 404（P50/P52），未知 PATCH 字段被
 *      静默忽略（P54）
 *
 * 落地面（真实可支持的才落，其余显式报错不装懂）：
 *   children(userstory) = GET /tasks?user_story= → 派生 task 的 TicketId（升序）。
 *      注意：子单是 **task 实体**，不可经本适配器 issues.get 读（跨实体边界，
 *      消费方须知——工单派生树若需读子单，须 task 面适配或 issues 面换绑 task）
 *   children(issue)     = 全量 issues 客户端过滤 generated_from_issue（过滤参数
 *      平台不认，P44）；API 驱动实例上恒为 []（生成链 UI 专属，结论 4）
 *   link() 三型全部显式报错 links-unsupported（不装懂、不落半吊子链）
 */
import type { LinkType, TicketId } from '@studio-next/contract'
import type { TaigaContext, EntityRaw } from './transport/context.ts'
import { TaigaPlatformError } from './transport/errors.ts'
import { LIST_PAGE_SIZE } from './transport/entities.ts'
import { asArray, asObject, optNumber, reqNumber } from './transport/shape.ts'


/** 单号升序（ref 数值序；TicketId 形见 context.ticketId） */
function compareByRef(a: TicketId, b: TicketId): number {
  const na = /-(\d+)$/.exec(a)?.[1]
  const nb = /-(\d+)$/.exec(b)?.[1]
  if (na !== undefined && nb !== undefined) return Number(na) - Number(nb)
  return a < b ? -1 : a > b ? 1 : 0
}

/** 404 统一收口为 issue-not-found（与 issues 面同口径） */
async function requireEntity(ctx: TaigaContext, id: TicketId): Promise<EntityRaw> {
  const ref = ctx.parseTicketId(id)
  // 与 issues 面同口径（IMPL-07-02）：项目端点 404（绑定指错项目）先于收口抛出＝Err，
  // 不得收口成「这张单不存在」。
  await ctx.project()
  try {
    return await ctx.fetchEntityByRef(ref)
  } catch (err) {
    if (err instanceof TaigaPlatformError && err.subcause === 'not-found') {
      throw new TaigaPlatformError('EXTERNAL_REJECT', 'issue-not-found', `单据不存在：${id}`)
    }
    throw err
  }
}

const UNSUPPORTED_BY_TYPE: Readonly<Record<LinkType, string>> = {
  'parent-child': '同面父子链不可写——US↔US 无父子模型、epic 挂接端点 404 且 PATCH epics 字段被忽略（P55-P57）、issue 生成链字段被静默丢弃（P58）；唯一可写从属链是 US→task，但建链发生在建 task 时（POST /tasks {user_story}），不支持对既有单补链',
  'depends-on': 'Taiga 无横向依赖关联模型（P50/P52：relations 端点 404；未知 PATCH 字段被静默忽略，P54）',
  'relates-to': 'Taiga 无横向关联模型（P50/P52/P54，同 depends-on）',
}

export async function link(ctx: TaigaContext, a: TicketId, b: TicketId, type: LinkType): Promise<void> {
  void ctx
  if (a === b) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'self-link', `链接两端不能是同一单据：${a}`)
  }
  const reason = UNSUPPORTED_BY_TYPE[type]
  if (reason === undefined) {
    throw new TaigaPlatformError('CONFIG_INVALID', 'bad-link-type', `未知链接类型：${String(type)}`)
  }
  throw new TaigaPlatformError(
    'CONFIG_INVALID',
    'links-unsupported',
    `Taiga 实测不支持 ${type} 链：${reason}；证据=probe-evidence/taiga-links（docs/32 §四待核项已答）`,
  )
}

export async function children(ctx: TaigaContext, id: TicketId): Promise<TicketId[]> {
  const raw = await requireEntity(ctx, id)
  const projectId = await ctx.project()
  if (ctx.desc.entity === 'userstory') {
    // 派生 task 链（真机 P30-P32；子单是 task 实体，不可经本面 issues.get 读——头注边界 1）
    const tasks = await ctx.client.paginate(
      { method: 'GET', path: '/tasks', query: { project: String(projectId), user_story: String(raw.id) } },
      (v) =>
        asArray(v, 'task-list').map((x) => {
          const o = asObject(x, 'task')
          return { ref: reqNumber(o, 'ref', 'task'), userStory: optNumber(o, 'user_story') }
        }),
      LIST_PAGE_SIZE,
    )
    return tasks
      .filter((t) => t.userStory === raw.id) // 头部兜底：fake/代理剥过滤参数时不装懂
      .map((t) => ctx.ticketId(t.ref))
      .sort(compareByRef)
  }
  // issue 生成链读（generated_from_issue；平台过滤参数不生效 P44 → 客户端过滤）
  const issues = await ctx.client.paginate(
    { method: 'GET', path: '/issues', query: { project: String(projectId) } },
    (v) =>
      asArray(v, 'issue-list').map((x) => {
        const o = asObject(x, 'issue')
        return { ref: reqNumber(o, 'ref', 'issue'), generatedFrom: optNumber(o, 'generated_from_issue') }
      }),
    LIST_PAGE_SIZE,
  )
  return issues
    .filter((x) => x.generatedFrom === raw.id)
    .map((x) => ctx.ticketId(x.ref))
    .sort(compareByRef)
}
