/**
 * work/dispatch-selection —— 执行器选择链接进 dispatch（v2/07 §一；NEG-RUN-05；GAP-V2-04 代偿）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/v2/07 §一「执行器选择链」：**单据指定＞岗位绑定＞默认（默认＝DSH）**；选择不是授权
 *     （选择只回答「这单由哪家跑」，权与禁配另判 v2/03/04）；强策略岗位无解不派工（fail-closed）。
 *   - docs/v2/14 §1.5 PORT-EXEC：`selectExecutor(c: SelectionChain, rc): PortResult<ExecutorChoice>`
 *     （选择算法端口；本件是其在 daemon 派发域的接线位）。
 *   - docs/v2/17 NEG-RUN-05（无登记选择链直连非主绑定执行器=拒）＋GAP-V2-04（派生树登记网关
 *     未建前以代偿校验拒）；docs/17-§2 相位 3 派发；docs/17-§6 收割四要件（拒派=不启动）。
 *   - 上游件：`packages/adapters/src/bindcard/selection.ts`（registerSelection /
 *     resolveDispatchTarget 的规则唯一源——本件不复制判定，只做「登记→解析→适配器解析」接线）。
 *
 * 本件是**派发路径的唯一选择解析点**（`engine/dispatch/execute.ts` 相位 3 调用），三面：
 *   1. 登记面 `buildSelectionChain`：把启动期登记的条目折成不可变选择链账本——任一条目
 *      非法（未知执行器/缺登记人/自相矛盾）即 CONFIG_INVALID 拒收（fail-closed 拒启，不静默忽略）。
 *   2. 解析面 `resolveDispatchSelection`：请求执行器解析序——
 *        续跑指名（同一家硬约束；v2/12 §2.1-③ 换宿主=新段）＞单据指定（source=ticket 登记）
 *        ＞岗位绑定（org-config people[].executor；缺岗位面时取 source=position 登记）＞
 *        候选适配器家族（tier/pick 既有链）。解析失败/未登记/指向别家 → rejected（不降级）。
 *   3. 适配面 `adapterForSelection`：选定家族 ≠ 候选适配器家族 → 按注册表换同家族执行位
 *      （无该家=拒派：无解不派工）；同家族保留候选（模型档/续跑位不丢）。
 *
 * 诚实边界（不冒充机制保证）：
 *   - 选择链登记通道＝daemon.yaml `dispatchSelections`（GAP-V2-04 派生树登记网关未建前的
 *     **代偿登记面**；REC-WORK-05 计划锁落地后迁出，登记面是证据不是授权）。
 *   - 岗位绑定＝org-config people[].executor（经 serve 装配注入；热重载面归后续刀——
 *     启动期装载，换岗生效随重启）。
 *   - 非 ENU-88 名（fake/自定义适配器）不在选择链值域：按「选择不适用」放行并留锚；生产
 *     agent.yaml 的未登记家族在装载期已 CONFIG_INVALID（agentconfig/unknown-executor），
 *     故生产派发面不存在「未知名绕过选择链」的放行路径。
 *   - 选择≠授权：本件不提供 granted 布尔位，授权仍只有 v2/03 四态。
 *
 * 纪律：零 IO（登记/解析/适配器选择全纯函数＋只读注册表）、零时钟读取、不持引擎状态。
 */
import { familyOfExecutorName, type ExecutorRegistry } from '@studio-next/adapters'
import {
  EMPTY_SELECTION_CHAIN,
  registerSelection,
  resolveDispatchTarget,
  type DispatchSelection,
  type SelectionChain,
  type SelectionChainEntry,
} from '@studio-next/adapters/bindcard'
import type { ClassifiedError, ExecutorAdapter, Result, TicketId } from '@studio-next/contract'

// ---------------------------------------------------------------------------
// 一、装配注入面（serve 装配期构造；缺省不注入=面关——仅测试直连引擎的兼容缝）
// ---------------------------------------------------------------------------

/** 派发选择链依赖（serve 恒注入；undefined=面关零行为——生产链路不存在面关形态） */
export interface DispatchSelectionDeps {
  /** 启动期登记折成的不可变选择链账本（空链=只允许主绑定缺省链） */
  readonly chain: SelectionChain
  /** 岗位绑定 executor 偏好（工号→executor 名；org-config people[].executor 的注入形） */
  readonly personExecutors: Readonly<Record<string, string>>
}

/** 解析结果三态（selected=放行；not-applicable=选择链值域外；rejected=fail-closed 拒派） */
export type DispatchSelectionOutcome =
  | { readonly kind: 'selected'; readonly selection: DispatchSelection }
  | { readonly kind: 'not-applicable'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly error: ClassifiedError }

/** 解析输入（dispatch/execute.ts 相位 3 一次给齐；resumeActive=续跑面在场） */
export interface DispatchSelectionInput {
  readonly deps: DispatchSelectionDeps
  readonly ticket: TicketId
  readonly personId: string
  /** 既有链（resume＞tier＞pick）选出的候选适配器注册名（家族由 familyOfExecutorName 归一） */
  readonly candidateName: string
  /** 续跑指名在场（同一家硬约束——不得被单据/岗位静默改派） */
  readonly resumeActive?: boolean
}

// ---------------------------------------------------------------------------
// 二、登记面：条目→选择链（fail-closed 拒收，不静默忽略）
// ---------------------------------------------------------------------------

/**
 * 把登记条目折成选择链账本：逐条过 `registerSelection`（单号/执行器值集/来源/登记人/依据/
 * positionRef/同键一致性），任一条非法即返回该条错误——启动期调用方据此 CONFIG_INVALID 拒启。
 */
export function buildSelectionChain(entries: readonly SelectionChainEntry[]): Result<SelectionChain, ClassifiedError> {
  let chain: SelectionChain = EMPTY_SELECTION_CHAIN
  for (const entry of entries) {
    const next = registerSelection(chain, entry)
    if (next.kind === 'err') return next
    chain = next.value
  }
  return { kind: 'ok', value: chain }
}

// ---------------------------------------------------------------------------
// 三、解析面：请求执行器 → 选择结果（失败即拒，不降级）
// ---------------------------------------------------------------------------

function reject(subcause: string, detail: string): DispatchSelectionOutcome {
  return { kind: 'rejected', error: { category: 'CONFIG_INVALID', subcause, detail } }
}

/** 选择链规则唯一源在 adapters（resolveDispatchTarget）——本件只把失败包成三态 */
function resolveFor(chain: SelectionChain, ticket: TicketId, executor: string): DispatchSelectionOutcome {
  const resolved = resolveDispatchTarget(chain, { ticket, executor })
  return resolved.kind === 'ok' ? { kind: 'selected', selection: resolved.value } : { kind: 'rejected', error: resolved.error }
}

/**
 * 派发选择解析（NEG-RUN-05 代偿校验的派发接线位）：
 *   1. 续跑面：候选家族即指名（同一家）；若单据指定与之冲突 → selection-mismatch 拒
 *      （续跑不静默改派，改派走新段）；其余仍过登记校验（非主绑定须登记）。
 *   2. 新派面：单据指定（source=ticket 登记）＞岗位绑定（personExecutors；缺岗位面取
 *      source=position 登记）＞候选适配器家族；随后过登记校验。
 *   3. 候选名不在 ENU-88 值集（fake/自定义）→ not-applicable（选择链值域外，留锚放行）。
 * 纯函数：不读盘、不调适配器、不启动进程。
 */
export function resolveDispatchSelection(input: DispatchSelectionInput): DispatchSelectionOutcome {
  const { chain, personExecutors } = input.deps
  const candidateFamily = familyOfExecutorName(input.candidateName)
  const ticketEntry = chain.entries.find((e) => e.ticket === input.ticket && e.source === 'ticket')
  const positionEntry = chain.entries.find((e) => e.ticket === input.ticket && e.source === 'position')
  const positionExecutor = (personExecutors[input.personId] ?? positionEntry?.executor ?? '').trim()

  if (input.resumeActive === true) {
    if (candidateFamily === undefined) {
      return {
        kind: 'not-applicable',
        reason: `续跑执行器 ${input.candidateName} 不在 ENU-88 值集（自定义/fake 名——选择链不覆盖）`,
      }
    }
    if (ticketEntry !== undefined && ticketEntry.executor !== candidateFamily) {
      return reject(
        'dispatch/selection-mismatch',
        `单据 ${JSON.stringify(input.ticket)} 选择链指定 ${ticketEntry.executor}，续跑指名 ${candidateFamily}——续跑须同一家（session id 为 executor 本地命名空间，v2/12 §2.1-③ 换宿主=新段），不得静默改派`,
      )
    }
    return resolveFor(chain, input.ticket, candidateFamily)
  }

  const requested = ticketEntry?.executor ?? (positionExecutor !== '' ? positionExecutor : undefined) ?? candidateFamily
  if (requested === undefined) {
    return {
      kind: 'not-applicable',
      reason: `候选执行器 ${input.candidateName} 不在 ENU-88 值集（自定义/fake 名——选择链不覆盖）`,
    }
  }
  return resolveFor(chain, input.ticket, requested)
}

// ---------------------------------------------------------------------------
// 四、适配面：选择结果 → 注册表适配器（同家族保留候选；无该家=拒派）
// ---------------------------------------------------------------------------

/**
 * 选定家族 → 注册表适配器：
 *   - 候选适配器同家族 → 原样保留（模型档 `<family>-<tier>`／续跑位不丢）；
 *   - 不同家族 → 取该家族注册位（default 优先，否则注册序首位）；无该家 → CONFIG_INVALID
 *     （`dispatch/executor-not-registered`：无解不派工，不静默回落默认家——v2/07 §2.1-④）。
 */
export function adapterForSelection(
  registry: ExecutorRegistry,
  selection: DispatchSelection,
  candidate: ExecutorAdapter,
): Result<ExecutorAdapter, ClassifiedError> {
  if (familyOfExecutorName(candidate.name) === selection.executor) return { kind: 'ok', value: candidate }
  const defaultName = registry.defaultName()
  const matches = registry.list().filter((e) => familyOfExecutorName(e.name) === selection.executor)
  const chosen = matches.find((e) => e.name === defaultName) ?? matches[0]
  if (chosen === undefined) {
    return {
      kind: 'err',
      error: {
        category: 'CONFIG_INVALID',
        subcause: 'dispatch/executor-not-registered',
        detail: `选择链选定 ${selection.executor}（${selection.chainId}），但注册表无该家族执行位——无解不派工（v2/07 §2.1-④；agent.yaml 未登记该家）`,
      },
    }
  }
  return { kind: 'ok', value: registry.resolve(chosen.name) }
}

// ---------------------------------------------------------------------------
// 五、引擎接线面：解析＋适配一步到位（dispatch/execute.ts 相位 3 的唯一调用点）
// ---------------------------------------------------------------------------

/** 引擎接线结果（ok=放行适配器＋观测锚；err=fail-closed 拒派） */
export type AppliedDispatchSelection =
  | { readonly kind: 'ok'; readonly adapter: ExecutorAdapter; readonly anchor: string }
  | { readonly kind: 'err'; readonly error: ClassifiedError }

/**
 * 派发选择一步到位（dispatch/execute.ts 调用）：解析 → 拒派判定 → 适配器解析。
 * 纯函数（只读注册表）；拒派留痕由调用方落 ESCALATE（本件给 note 素材，不触台账）。
 */
export function applyDispatchSelection(input: {
  readonly registry: ExecutorRegistry
  readonly deps: DispatchSelectionDeps
  readonly ticket: TicketId
  readonly personId: string
  readonly candidate: ExecutorAdapter
  readonly resumeActive?: boolean
}): AppliedDispatchSelection {
  const outcome = resolveDispatchSelection({
    deps: input.deps,
    ticket: input.ticket,
    personId: input.personId,
    candidateName: input.candidate.name,
    resumeActive: input.resumeActive === true,
  })
  if (outcome.kind === 'rejected') return { kind: 'err', error: outcome.error }
  const anchor = selectionNote(outcome)
  if (outcome.kind === 'not-applicable') return { kind: 'ok', adapter: input.candidate, anchor }
  const picked = adapterForSelection(input.registry, outcome.selection, input.candidate)
  return picked.kind === 'err' ? { kind: 'err', error: picked.error } : { kind: 'ok', adapter: picked.value, anchor }
}

/** 引擎接线结果（ok=放行适配器＋观测锚——面关时 adapter=candidate、anchor=''；err=拒派明报） */
export type DispatchSelectionGate =
  | { readonly kind: 'ok'; readonly adapter: ExecutorAdapter; readonly anchor: string }
  | { readonly kind: 'err'; readonly message: string }

/** 拒派明报消息（引擎 fail detail；子因＋明细，不吞错不降级） */
export function selectionRejectionMessage(error: ClassifiedError): string {
  return `DISPATCH_FAIL：执行器选择链拒绝——${error.subcause}：${error.detail ?? ''}`
}

/**
 * 引擎接线一步到位（dispatch/execute.ts 相位 3 的唯一调用点；引擎侧只留接线）：
 *   - 面关（deps undefined——仅测试直连引擎的兼容缝）→ ok（候选原样、无锚），零行为；
 *   - 放行 → ok（选择后适配器＋DISPATCH note 选择锚）；
 *   - 拒派 → err（明报消息；ESCALATE 留痕按 `seenRejections` **每单每因一次**，rescan 重派不刷屏）。
 * 拒派去重账由调用方持（per-engine 生命周期：rt.selectionRejections）；本件不写台账、不读时钟、不持引擎状态。
 */
export function gateDispatchSelection(
  deps: DispatchSelectionDeps | undefined,
  input: {
    readonly registry: ExecutorRegistry
    readonly ticket: TicketId
    readonly personId: string
    readonly candidate: ExecutorAdapter
    readonly resumeActive?: boolean
  },
  seenRejections: Set<string>,
  emitEscalate: (note: string) => void,
): DispatchSelectionGate {
  if (deps === undefined) return { kind: 'ok', adapter: input.candidate, anchor: '' }
  const applied = applyDispatchSelection({ ...input, deps })
  if (applied.kind === 'ok') return applied
  const key = `${input.ticket}:${applied.error.subcause}`
  if (!seenRejections.has(key)) {
    seenRejections.add(key)
    emitEscalate(selectionRejectionNote(applied.error))
  }
  return { kind: 'err', message: selectionRejectionMessage(applied.error) }
}

// ---------------------------------------------------------------------------
// 六、观测锚：DISPATCH note / 拒派留痕（记录面可判读，不静默）
// ---------------------------------------------------------------------------

/** DISPATCH note 选择锚（selected=`;selection=<chainId>@<executor>`；值域外=n/a 明示） */
export function selectionNote(outcome: DispatchSelectionOutcome): string {
  if (outcome.kind === 'selected') return `;selection=${outcome.selection.chainId}@${outcome.selection.executor}`
  if (outcome.kind === 'not-applicable') return ';selection=n/a（ENU-88 值集外——自定义/fake 名）'
  return ''
}

/** 拒派留痕 note（ESCALATE 事件；指名子因＋处置面＋不静默降级） */
export function selectionRejectionNote(error: ClassifiedError): string {
  return (
    `dispatch/selection 拒派（NEG-RUN-05；GAP-V2-04 代偿）：${error.subcause}：${error.detail ?? ''}` +
    '——修正选择链登记（daemon.yaml dispatchSelections／岗位绑定 org-config people[].executor）后重派；不静默降级'
  )
}

/** 775/C3 缺省执行类关键词（可经 daemon.yaml executionGuardKeywords 覆盖） */
export const DEFAULT_EXECUTION_GUARD_KEYWORDS: readonly string[] = [
  'deploy',
  'release',
  'tag',
  'push',
  '发布',
  '上线',
  '部署',
  '回滚',
]

export interface ExecutionGuardInput {
  title: string
  description?: string
  /** 实际用工号（resolve 后的 person.id） */
  personId: string
  /** 岗位名（org-config people[].role；快照可选键） */
  personRole?: string
  /** 受监控岗位（daemon.yaml executionGuardRoles；空/缺省=面关） */
  guardRoles?: readonly string[]
  /** 关键词覆盖（缺省 DEFAULT_EXECUTION_GUARD_KEYWORDS） */
  keywords?: readonly string[]
}

export interface ExecutionGuardHit {
  hit: boolean
  keyword?: string
}

/**
 * 执行类单据监控（studio-dev-775/C3）：岗位 ∈ guardRoles 且单据标题/描述命中执行关键词
 * → hit（调用面 ESCALATE + 拒派人工复核）。纯函数、无 IO；缺省 guardRoles 空=面关（零行为变）。
 * ASCII 关键词按词边界匹配（避免 deployment 误命中 deploy）；中文按子串匹配。
 */
export function executionGuardHit(input: ExecutionGuardInput): ExecutionGuardHit {
  const guardRoles = input.guardRoles ?? []
  if (guardRoles.length === 0) return { hit: false }
  if (input.personRole === undefined || !guardRoles.includes(input.personRole)) return { hit: false }
  const text = `${input.title}\n${input.description ?? ''}`
  const keywords = input.keywords !== undefined && input.keywords.length > 0 ? input.keywords : DEFAULT_EXECUTION_GUARD_KEYWORDS
  for (const keyword of keywords) {
    const needle = keyword.trim()
    if (needle === '') continue
    const ascii = /^[A-Za-z0-9._-]+$/.test(needle)
    const matched = ascii ? new RegExp(`(?:^|[^A-Za-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9_])`, 'i').test(text) : text.includes(needle)
    if (matched) return { hit: true, keyword: needle }
  }
  return { hit: false }
}
