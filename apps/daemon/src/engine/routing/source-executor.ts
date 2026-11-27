/**
 * engine/routing/source-executor —— 模型源 per-source executor 解析面（task-141）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/quality/model-routing.md §10「源 executor 与跨执行器换源」：models.yaml
 *     `sources[].executor`（可选）＝该源的执行器注册名；缺省＝档位既有逻辑（tierExecutors/
 *     家族-档位位名）；同档可混用；未登记名拒启/热切拒绝/派发 fail-closed。
 *   - docs/quality/tier-executors.md「选择链登记面」：选择闸放行集合＝tierExecutors ∪ **本档**
 *     sources executor 家族（按派发档位取、不跨档放行——execute.ts 传派发档的 sources；本件给
 *     集合，登记判定仍在 work/dispatch-selection.ts）。
 *
 * 三面（全纯函数：不读盘、不读时钟、不持引擎状态；registry 形参为结构面 `{ list, resolve }`）：
 *   1. 校验面 `sourceExecutorIssues`：每档 sources[].executor 须在注册表登记名集合内——
 *      serve 启动（executor-face）与 models.yaml 热切（models-hot-swap）共用同一判据，不双源漂移。
 *   2. 解析面 `sourceExecutorFamilies` / `adapterForSource` / `reconcileSourceResume` /
 *      `sameExecutorFamily`：本档源 → executor 家族（选择闸放行集合）；源 → 适配器（显式
 *      executor=registry.resolve 指名；缺省=调用方给的档位既有候选——零漂移：无 executor 配置时
 *      候选原样返回）；续跑面 × 源 executor 对账（同族=续跑位优先；跨族=不强行续跑，降级新派
 *      ——F1-15 明报）；两适配器同族判定（链锁定时源归属判据）。
 *   3. 审计面 `sourceRef` / `routingHealthRow`：DISPATCH/FAILOVER note 的源引用形
 *      `<id>@<executor>`（显式）/ `<id>`（缺省——与 task-56/135 既有锚逐字节一致）；只读健康行。
 *
 * 诚实边界：非 dsh 家族执行器在构造期取 model（TaskBrief 无 model 字段）——源 executor 非 dsh
 * 时 models.yaml 的 provider/model 只作价目/身份归属，不套 overlay（派发体按结构能力判）。
 */
import { familyOfExecutorName } from '@studio-next/adapters'
import type { ExecutorAdapter, ExecutorFamily, Result } from '@studio-next/contract'
import type { ModelSourceSpec, TierId } from '@studio-next/core'
import { degradedResumeFace, type ResumeDispatchFace } from '../intents/relay-resume-faces.ts'

/** 多源计划（与 EngineDeps.modelRouting.sources 同形：档位 → 源列表） */
export type ModelSourcePlan = Partial<Record<TierId, readonly ModelSourceSpec[]>>

/** 注册表结构面（ExecutorRegistry 满足；本件不依赖注册表其它原语） */
export interface SourceRegistryFace {
  list(): readonly { readonly name: string }[]
  resolve(name: string): ExecutorAdapter
}

/**
 * **本档**源 executor 的家族集合（选择闸放行集合扩展——task-141；按派发档位取：调用方传该档的
 * sources，他档 executor 不放行）。非 ENU-88 值域的名字（familyOfExecutorName=undefined）不入
 * 集合：选择链不覆盖自定义名，放行与否仍由既有 not-applicable 判定。无 executor 配置=空集
 * （调用方据此零漂移）。
 */
export function sourceExecutorFamilies(sources: readonly ModelSourceSpec[] | undefined): ReadonlySet<ExecutorFamily> {
  const families = new Set<ExecutorFamily>()
  for (const source of sources ?? []) {
    const family = source.executor !== undefined ? familyOfExecutorName(source.executor) : undefined
    if (family !== undefined) families.add(family)
  }
  return families
}

/**
 * 两适配器是否同一家族（familyOfExecutorName 归一；派发体链锁定/续跑位的源归属判据——同族=
 * 源确在该执行位生效，异族=源未实际执行、不归因）。值域外名（自定义适配器）各按注册名自比。
 */
export function sameExecutorFamily(a: ExecutorAdapter, b: ExecutorAdapter): boolean {
  const family = familyOfExecutorName(a.name)
  return family !== undefined ? family === familyOfExecutorName(b.name) : a.name === b.name
}

/**
 * 源 executor 登记校验：逐档逐源比对注册名；返回问题行（空=全部合法）。
 * 行形=`<tier>/sources[<id>].executor=<name> 未登记（已登记：a、b）`——serve 两处（启动/热切）
 * 直接拼进 CONFIG_INVALID / MODELS_RELOAD_INVALID 文案。
 */
export function sourceExecutorIssues(plan: ModelSourcePlan | undefined, registered: readonly string[]): string[] {
  const known = new Set(registered)
  const issues: string[] = []
  for (const [tier, sources] of Object.entries(plan ?? {})) {
    for (const source of sources ?? []) {
      if (source.executor !== undefined && !known.has(source.executor)) {
        issues.push(`${tier}/sources[${source.id}].executor=${source.executor} 未登记（已登记：${registered.length > 0 ? registered.join('、') : '无'}）`)
      }
    }
  }
  return issues
}

/**
 * 源 → 适配器：显式 executor → `registry.resolve` 指名（未登记=err，调用方转可读拒派——
 * serve 校验面已挡生产配置，本处是派发面 fail-closed 兜底）；缺省 → tierCandidate 原样
 * （档位既有逻辑：tierExecutors/家族-档位/续跑位，零漂移）。
 */
export function adapterForSource(source: ModelSourceSpec, registry: SourceRegistryFace, tierCandidate: ExecutorAdapter): Result<ExecutorAdapter, string> {
  if (source.executor === undefined) return { kind: 'ok', value: tierCandidate }
  if (!registry.list().some((entry) => entry.name === source.executor)) {
    const registered = registry.list().map((entry) => entry.name)
    return { kind: 'err', error: `源 ${source.id} 的 executor=${source.executor} 未在注册表登记（已登记：${registered.length > 0 ? registered.join('、') : '无'}）` }
  }
  return { kind: 'ok', value: registry.resolve(source.executor) }
}

/** 续跑面对账结果：adapter=实际预绑位；face=对账后续跑面（同族/无面=原对象；跨族=降级新派） */
export interface SourceResumeReconcile {
  readonly adapter: ExecutorAdapter
  readonly face: ResumeDispatchFace | undefined
  /** 续跑同族位优先于源 executor 位（session 归属执行位——换位=丢会话；派发体据此不换绑） */
  readonly resumeLocked: boolean
}

/**
 * 续跑面 × 路由源 executor 对账（task-141「resume 跨执行器不强行 resume」）：
 *   - 无续跑面/已降级 → 源 executor 位原样；
 *   - 续跑位与源 executor 同家族 → 续跑位优先（session 归属执行位，源 executor 位让位）；
 *   - 不同家族 → 不强行续跑：降级新派（F1-15 明报锚，causation_id 仍挂上次工时单——因果不断）。
 *     引擎无日志通道，留痕即 DISPATCH note 锚 + actionResults detail 段。
 */
export function reconcileSourceResume(face: ResumeDispatchFace | undefined, source: ModelSourceSpec, next: ExecutorAdapter): SourceResumeReconcile {
  if (face === undefined || face.active !== true || face.adapter === undefined) return { adapter: next, face, resumeLocked: false }
  const resume = face.adapter
  const resumeFamily = familyOfExecutorName(resume.name)
  if (resumeFamily !== undefined && resumeFamily === familyOfExecutorName(next.name)) return { adapter: resume, face, resumeLocked: true }
  const reason = `路由源 ${sourceRef(source)} 非续跑同族 ${resume.name}——task-141 跨执行器不强行续跑`
  return { adapter: next, face: degradedResumeFace(face.causationId, next, reason), resumeLocked: false }
}

/** 源引用（审计锚）：显式 executor=`<id>@<executor>`；缺省=`<id>`（既有锚逐字节一致） */
export function sourceRef(source: ModelSourceSpec): string {
  return source.executor !== undefined ? `${source.id}@${source.executor}` : source.id
}

/**
 * 路由源只读健康行（healthz/面板只读列——不改契约/事件词）。task-141 加法扩展：常驻列
 * provider/model/priority/enabled（task-141 前的行没有这四键）＋可选 executor/cooldown（缺省
 * 不出现）；既有列（tier/id/available/cooldownUntil/lastFailureClass/lastSuccessAt）口径不变。
 */
export interface RoutingHealthSource {
  readonly tier: string
  readonly id: string
  /** 源 executor 注册名（缺省=档位既有逻辑→不出现） */
  readonly executor?: string
  readonly provider: string
  readonly model: string
  readonly priority: number
  readonly enabled: boolean
  /** 冷却参数声明（源 cooldown；未声明=路由器缺省→不出现） */
  readonly cooldown?: NonNullable<ModelSourceSpec['cooldown']>
  readonly available: boolean
  readonly cooldownUntil: number
  readonly lastFailureClass?: string
  readonly lastSuccessAt?: number
}

/** 源状态最小面（RoutingState 行的只读投影形；engine.modelRoutingHealth 调用） */
export interface RoutingHealthState {
  readonly cooldownUntil?: number | undefined
  readonly lastFailureClass?: string | undefined
  readonly lastSuccessAt?: number | undefined
}

/** 源 → 只读健康行（纯投影；可选键缺省不出现——既有键口径不变，四个声明列为 task-141 加法） */
export function routingHealthRow(tier: string, source: ModelSourceSpec, state: RoutingHealthState | undefined, now: number): RoutingHealthSource {
  const cooldownUntil = state?.cooldownUntil ?? 0
  return {
    tier,
    id: source.id,
    ...(source.executor !== undefined ? { executor: source.executor } : {}),
    provider: source.provider,
    model: source.model,
    priority: source.priority,
    enabled: source.enabled !== false,
    ...(source.cooldown !== undefined ? { cooldown: source.cooldown } : {}),
    available: cooldownUntil <= now,
    cooldownUntil,
    ...(state?.lastFailureClass !== undefined ? { lastFailureClass: state.lastFailureClass } : {}),
    ...(state?.lastSuccessAt !== undefined ? { lastSuccessAt: state.lastSuccessAt } : {}),
  }
}
