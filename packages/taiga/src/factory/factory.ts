/**
 * 出厂态根治三步 —— onboard 库面（DEV-49，docs/52-§十 方案 A；S0 形状=docs/32-§九）。
 *
 * 根因链（docs/52-§10.1）：Taiga 项目复制出厂模板带全套英文出厂状态集（New/…），
 * provision GET-first 只增不删 → 出厂态全数留存；建单默认落项目级 default_*_status
 * （出厂=New）→ 单据出生即流外 → decide NOOP_UNKNOWN_STATE 静默卡死（14 单 2 小时
 * 事故，2026-10-20）。本模块把「平台默认态」从建单兜底链**变映射态**——任何路径
 * （UI/第三方直调 API/适配器）建单都落公司声明集内，与 DEV-40 初态机制对齐
 * （issues.create 解析序末位兜底由本三步根治）。
 *
 * 三步（docs/52-§10.2 表；§八 onboard 序列：provision 三件之后 A1→A2→A3）：
 *   A1 repointProjectDefaults：把 default_us_status/default_task_status/
 *      default_issue_status（epic 如有声明）指到公司收件态——PATCH /projects/{id}
 *      （S0 确认可写，docs/32-§九）；幂等=读现值 diff，已指即跳过
 *      目标解析（拟稿口径）：实体 E 的收件态 = entities[E].states[0]（DEV-43 实体
 *      档案首态）；无档案时绑定实体回退 map.states[0]（五态=新单）。项目默认值每
 *      实体只一个：多类型多收件态（typeInbox 各异）时默认值只能指其一——声明集内
 *      任一态都是映射态（根治目标达成），按类型精落位归 issues.create 的
 *      typeInbox 解析（B1，保持不动）
 *   A2 normalizeFactoryTickets：扫描绑定实体上 state∉声明集的单 → 逐单 transition
 *      到该类型收件态（fieldMap.initialStateFor(type)：typeInbox[type] > states[0]
 *      ——fix-new-state.ts 语义收编，按类型选收件态）；已在目标态不重放（transition
 *      目标=声明集内态，流外单永不等值，天然幂等）；只扫绑定实体（运行时单实体
 *      CRUD 绑定，docs/18-§2.1.1 v1 边界）；他实体存量由 A3 的 moveTo 兜底迁移
 *   A3 retireFactoryStatuses：快照先行（persistSnapshot 回调在**任何 DELETE 之前**
 *      调用——roles 快照同款先例，删除不可逆入档后行）→ 逐 DELETE
 *      /{entity}-statuses/{id}?moveTo=<收件态id>（S0 定版：moveTo 必填、引用自动
 *      迁移、默认值联动改指，docs/32-§九）。N5「值只增不删」的**显式例外**
 *      （docs/52-§十四 D3 决策=删）；跳过面：无声明集的实体不删（值只增不删原
 *      则对未声明实体保持）；DELETE 失败→跳过+报告（不中断其余）
 *
 * 与 daemon 的分工（docs/52-§十 A4 ↔ 本三步）：本模块=onboard 一次性写面（库函数，
 * 公司 onboard 脚本调用——同 readTaigaRoles 先例）；daemon 采集面未知态哨
 * （ESCALATE UNKNOWN_STATE+状态集巡逻核）在 apps/daemon engine，防回归不防存量。
 *
 * 幂等总口径：三步全 GET-first diff 写——重跑零写（onboard 两跑同结果基线）。
 * 本包零文件 IO：快照经回调落盘（调用方写 var/），保持适配器纯平台面。
 */
import type { FieldProvisionMap, TicketId } from '@studio-next/contract'
import type { TaigaContext, StatusInfo } from '../context.ts'
import { entityDescriptor, type TaigaEntity } from '../entities.ts'
import { validateProvisionMap } from '../fields.ts'
import { listIssues, transitionIssue } from '../issues.ts'
import { asArray, asObject, optNumberNull, reqNumber, reqString } from '../shape.ts'

/** 实体 → 项目默认态字段名（S0 源码定版：serializers.py default_*_status，docs/32-§九） */
const DEFAULT_STATUS_FIELDS: Readonly<Record<TaigaEntity, string>> = {
  userstory: 'default_us_status',
  task: 'default_task_status',
  issue: 'default_issue_status',
}

/** 处置顺序：绑定实体先行（A2 扫描面），其余按声明序（确定性） */
const CURE_ENTITIES: readonly TaigaEntity[] = ['userstory', 'issue', 'task']

/** A1 报告行：一次默认态改指（实体、字段、原态名→新态名） */
export interface DefaultRepoint {
  entity: TaigaEntity
  field: string
  from: string
  to: string
}

/** A2 报告行：一次存量归化（单号、原态→新态） */
export interface TicketNormalized {
  ticket: TicketId
  from: string
  to: string
}

/** A3 报告行：一次出厂态退役（实体、状态名；moveTo 兜底迁移语义见 docs/32-§九） */
export interface StatusRetired {
  entity: TaigaEntity
  status: string
  /** 迁移目标态名（moveTo；S0=引用单据自动改挂此态） */
  moveTo: string
}

/** A3 报告行：一次跳过（原因明示，不静默） */
export interface RetireSkipped {
  entity: TaigaEntity
  status: string
  reason: string
}

/** 删除前状态集快照（persistSnapshot 载荷；先例=roles 快照入档 var/） */
export interface FactoryStatusSnapshot {
  /** 取证时刻（epoch ms；调用方时钟） */
  at: number
  project: string
  /** 各实体全量状态集（含出厂态——DELETE 前原貌） */
  entities: Record<TaigaEntity, { statuses: StatusInfo[]; defaultStatus: number | null }>
}

/** 出厂态根治三步报告（cureFactoryStatuses 汇总；三步各自可独立跑各自返回子面） */
export interface FactoryCureReport {
  defaults: readonly DefaultRepoint[]
  /** 已指向即跳过的实体默认值面（幂等观测） */
  defaultsKept: readonly { entity: TaigaEntity; field: string; current: string }[]
  /** 无声明集（或目标状态名不在平台集）未动的默认值面 */
  defaultsSkipped: readonly { entity: TaigaEntity; field: string; reason: string }[]
  normalized: readonly TicketNormalized[]
  /** 已在声明集内的存量单（无需归化的幂等观测计数） */
  normalizedKept: number
  /** 归化失败面（transition 平台错——不中断扫描） */
  normalizeFailed: readonly { ticket: TicketId; from: string; reason: string }[]
  retired: readonly StatusRetired[]
  retireSkipped: readonly RetireSkipped[]
}

// ————————————————— 内构件 —————————————————

/** 声明状态集（实体档案优先；绑定实体回退 map.states=五态现状，docs/30 §6 ②） */
export function declaredStatesFor(ctx: TaigaContext, map: FieldProvisionMap, entity: TaigaEntity): readonly string[] | undefined {
  const profile = map.entities?.[entity]
  if (profile !== undefined && profile.states.length > 0) return profile.states
  if (entity === ctx.desc.entity) return map.states
  return undefined
}

/** 收件态名（A1/A3 落点）：声明集首态（拟稿口径见模块头注；多收件态精落位归 typeInbox 解析） */
function inboxStateFor(declared: readonly string[]): string | undefined {
  return declared[0]
}

/** 实体状态集拉取（GET /{statuses}?project=——真机形状 docs/32 §二；无缓存逐次真读） */
async function statusListOf(ctx: TaigaContext, entity: TaigaEntity): Promise<StatusInfo[]> {
  const desc = entity === ctx.desc.entity ? ctx.desc : entityDescriptor(entity)
  const projectId = await ctx.project()
  const res = await ctx.client.request({ method: 'GET', path: `/${desc.statuses}`, query: { project: String(projectId) } })
  return asArray(res.json, `${desc.statuses}`).map((v) => {
    const o = asObject(v, `${desc.statuses}[i]`)
    return { id: reqNumber(o, 'id', 'status'), name: reqString(o, 'name', 'status'), slug: reqString(o, 'slug', 'status') }
  })
}

/** 项目默认态四字段现值（GET /projects/by_slug 直读——S0：by_slug 回显，docs/32-§九） */
async function projectDefaults(ctx: TaigaContext): Promise<{ projectId: number; defaults: Record<TaigaEntity, number | null> }> {
  const res = await ctx.client.request({ method: 'GET', path: '/projects/by_slug', query: { slug: ctx.projectSlug } })
  const o = asObject(res.json, 'project')
  return {
    projectId: reqNumber(o, 'id', 'project'),
    defaults: {
      userstory: optNumberNull(o, DEFAULT_STATUS_FIELDS.userstory) ?? null,
      task: optNumberNull(o, DEFAULT_STATUS_FIELDS.task) ?? null,
      issue: optNumberNull(o, DEFAULT_STATUS_FIELDS.issue) ?? null,
    },
  }
}

function nameOfStatus(list: readonly StatusInfo[], id: number | null): string {
  if (id === null) return '（未设置）'
  return list.find((s) => s.id === id)?.name ?? `#${String(id)}（未知状态 id）`
}

/** 昂贵面统一入参闸：与 provision 同一校验（单一来源 fields.ts）——治前先验，零写明报 */
function validateMap(map: FieldProvisionMap): void {
  validateProvisionMap(map)
}

// ————————————————— A1 默认态重指 —————————————————

/**
 * 把项目默认态（default_us_status/default_task_status/default_issue_status）指到
 * 公司收件态。幂等=读现值 diff：全部已指 → 零 PATCH。单 PATCH 携全部待改字段。
 */
export async function repointProjectDefaults(ctx: TaigaContext, map: FieldProvisionMap): Promise<Pick<FactoryCureReport, 'defaults' | 'defaultsKept' | 'defaultsSkipped'>> {
  validateMap(map)
  const { projectId, defaults } = await projectDefaults(ctx)
  const repointed: DefaultRepoint[] = []
  const kept: { entity: TaigaEntity; field: string; current: string }[] = []
  const skipped: { entity: TaigaEntity; field: string; reason: string }[] = []
  const patchBody: Record<string, number> = {}

  for (const entity of CURE_ENTITIES) {
    const field = DEFAULT_STATUS_FIELDS[entity]
    const declared = declaredStatesFor(ctx, map, entity)
    if (declared === undefined) {
      skipped.push({ entity, field, reason: '无声明状态集（entities 档案缺、且非绑定实体回退面）——不动（值只增不删原则同面）' })
      continue
    }
    const inbox = inboxStateFor(declared)
    if (inbox === undefined) {
      skipped.push({ entity, field, reason: '声明状态集为空' })
      continue
    }
    const statuses = await statusListOf(ctx, entity)
    const target = statuses.find((s) => s.name === inbox)
    if (target === undefined) {
      skipped.push({ entity, field, reason: `收件态「${inbox}」不在平台状态集（先跑 fields.provision 建档）` })
      continue
    }
    const current = defaults[entity]
    if (current === target.id) {
      kept.push({ entity, field, current: inbox })
      continue
    }
    patchBody[field] = target.id
    repointed.push({ entity, field, from: nameOfStatus(statuses, current), to: inbox })
  }

  if (Object.keys(patchBody).length > 0) {
    await ctx.client.request({ method: 'PATCH', path: `/projects/${String(projectId)}`, body: patchBody })
  }
  return { defaults: repointed, defaultsKept: kept, defaultsSkipped: skipped }
}

// ————————————————— A2 存量归化 —————————————————

/**
 * 扫描绑定实体上流外态（state∉声明集）单据 → transition 到类型收件态。
 * fix-new-state.ts 语义收编（state==='New' → '新单' 是本扫描的特例）；按类型选
 * 收件态=fieldMap.initialStateFor(type)（typeInbox[type] > states[0]，DEV-40 同序）。
 * 已在声明集内的单不动（normalizedKept 计数=幂等观测）。
 */
export async function normalizeFactoryTickets(ctx: TaigaContext, map: FieldProvisionMap): Promise<Pick<FactoryCureReport, 'normalized' | 'normalizedKept' | 'normalizeFailed'>> {
  validateMap(map)
  const declared = declaredStatesFor(ctx, map, ctx.desc.entity) ?? []
  const declaredSet = new Set(declared)
  const tickets = await listIssues(ctx, {})
  const normalized: TicketNormalized[] = []
  const failed: { ticket: TicketId; from: string; reason: string }[] = []
  let kept = 0
  for (const t of tickets) {
    if (declaredSet.has(t.state)) {
      kept += 1
      continue
    }
    const target = ctx.fieldMap.initialStateFor(t.type)
    if (target === undefined) {
      failed.push({ ticket: t.id, from: t.state, reason: '无收件态可落（states 空且类型无 typeInbox）' })
      continue
    }
    try {
      await transitionIssue(ctx, t.id, target)
      normalized.push({ ticket: t.id, from: t.state, to: target })
    } catch (err) {
      failed.push({ ticket: t.id, from: t.state, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { normalized, normalizedKept: kept, normalizeFailed: failed }
}

// ————————————————— A3 出厂态退役 —————————————————

export interface RetireOptions {
  /** epoch ms 时钟（快照取证时刻；缺省 Date.now） */
  now?: () => number
  /**
   * 快照落盘回调（**任何 DELETE 之前**调用一次，携全实体删除前原貌）——roles 快照
   * 同款先例：删除不可逆，入档后行。抛错=中止全部删除（宁不删不入档）。
   */
  persistSnapshot?: (snapshot: FactoryStatusSnapshot) => void
}

/**
 * 出厂态退役：快照先行 → 逐 DELETE /{entity}-statuses/{id}?moveTo=<收件态id>。
 * 跳过面（+报告不静默）：无声明集的实体整体不删；DELETE 平台错逐条跳过不中断。
 * S0 定版语义（docs/32-§九）：moveTo 必填；引用单据自动迁移到 moveTo（与 A2 目标
 * 同值=竞态兜底）；被删状态若是项目默认值 → 默认值改指 moveTo。
 */
export async function retireFactoryStatuses(
  ctx: TaigaContext,
  map: FieldProvisionMap,
  opts?: RetireOptions,
): Promise<Pick<FactoryCureReport, 'retired' | 'retireSkipped'>> {
  validateMap(map)
  const { defaults } = await projectDefaults(ctx)
  const statusesByEntity = new Map<TaigaEntity, StatusInfo[]>()
  for (const entity of CURE_ENTITIES) {
    statusesByEntity.set(entity, await statusListOf(ctx, entity))
  }
  // 快照先行（删除不可逆，入档后行——回调抛错中止：宁不删不入档）
  const snapshot: FactoryStatusSnapshot = {
    at: (opts?.now ?? Date.now)(),
    project: ctx.projectSlug,
    entities: Object.fromEntries(
      CURE_ENTITIES.map((entity) => [entity, { statuses: [...(statusesByEntity.get(entity) ?? [])], defaultStatus: defaults[entity] }]),
    ) as FactoryStatusSnapshot['entities'],
  }
  opts?.persistSnapshot?.(snapshot)

  const retired: StatusRetired[] = []
  const skipped: RetireSkipped[] = []
  for (const entity of CURE_ENTITIES) {
    const statuses = statusesByEntity.get(entity) ?? []
    const declared = declaredStatesFor(ctx, map, entity)
    if (declared === undefined || declared.length === 0) {
      for (const s of statuses) skipped.push({ entity, status: s.name, reason: '实体无声明状态集——无 moveTo 落点，不删（值只增不删）' })
      continue
    }
    const declaredSet = new Set(declared)
    const desc = entity === ctx.desc.entity ? ctx.desc : entityDescriptor(entity)
    // moveTo 落点=声明集首态（与 A1 收件态同值——竞态新建单的兜底迁移目标与 A2 归化
    // 目标同构，docs/32-§九）
    const moveTo = statuses.find((x) => x.name === declared[0])
    if (moveTo === undefined) {
      for (const s of statuses) {
        if (!declaredSet.has(s.name)) skipped.push({ entity, status: s.name, reason: `收件态「${String(declared[0])}」不在平台状态集（provision 未跑？）` })
      }
      continue
    }
    for (const s of statuses) {
      if (declaredSet.has(s.name)) continue
      try {
        await ctx.client.request({ method: 'DELETE', path: `/${desc.statuses}/${String(s.id)}`, query: { moveTo: String(moveTo.id) } })
        retired.push({ entity, status: s.name, moveTo: moveTo.name })
      } catch (err) {
        skipped.push({ entity, status: s.name, reason: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  ctx.invalidateMeta() // 删档后作废缓存：schema()/状态名解析立即反映现状
  return { retired, retireSkipped: skipped }
}

// ————————————————— 三步合流（docs/52-§八 onboard 序列） —————————————————

/**
 * 出厂态根治三步合流：A1→A2→A3（provision 三件之后追加的 onboard 段；顺序即
 * 依赖——A1 先夺默认值，A2 清绑定实体存量，A3 退役（moveTo 兜底=A2 目标同值））。
 * 幂等：三步全 GET-first diff——重跑零写零删（快照回调仍每跑取证，幂等无副作用）。
 */
export async function cureFactoryStatuses(
  ctx: TaigaContext,
  map: FieldProvisionMap,
  opts?: RetireOptions,
): Promise<FactoryCureReport> {
  const a1 = await repointProjectDefaults(ctx, map)
  const a2 = await normalizeFactoryTickets(ctx, map)
  const a3 = await retireFactoryStatuses(ctx, map, opts)
  return { ...a1, ...a2, ...a3 }
}
