/**
 * engine/routing/quota-gate —— 供给级配额门控接线（task-157 / FIX-03；docs/quality/supply-quota-gating.md §2）
 *
 * 纯逻辑在 core `supply/`（分类 supply/error-kind.ts、池状态机 supply/supply-quota.ts）；本件只做
 * daemon 侧接线，不持第二套状态机：
 *   §2.2 阻塞登记 `recordRoutedFailure`（launch 换源面＋harvest 回填面共用：源级冷却照旧登记，
 *        quota 类**另**记池阻塞并持久化 `model-routing.quota`）；
 *   §2.3 决策级门控 `quotaGateVerdict`（state-diff：dispatch 后、占泳道前；路由激活条件镜像 execute）；
 *   §2.4 探针生命周期（认领随门控／`settleQuotaProbe` 派发未成释放／`resolveRoutedPool` 成功放开）；
 *   §2.5 execute 级兜底记因在 router.ts `selectModelSource`；探针 DISPATCH 尾段 `quotaProbeNote`；
 *   §3 观测：`noteQuotaHold`（ESCALATE 每阻塞期一条，routingWarnings 去重）、`quotaHealthRows`。
 * 纪律：只认正向证据——无 reset 不延长阻塞（回退=源冷却，到期单探针收敛）；拿不准不 hold。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import {
  claimQuotaProbe,
  errorKindNote,
  pruneSupplyQuota,
  quotaBlockOf,
  quotaPoolKeyOf,
  quotaPoolVerdict,
  quotaRecoveringBlockOf,
  recordQuotaBlock,
  releaseQuotaProbe,
  releaseQuotaProbesOf,
  resolveQuotaOpen,
  serializeSupplyQuotaState,
} from '@studio-next/core'
import type { ErrorClassification, ModelSourceSpec, QuotaWindow, QuotaWindowBlock, SupplyQuotaState, TierId } from '@studio-next/core'
import { resumeDispatchFace } from '../intents/relay-resume-faces.ts'
import type { ResumeDispatchPlan } from '../intents/relay-resume.ts'
import type { EventIndex } from '../sentinel/events-index.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { modelTierDispatchFace, resolveModelTier } from '../tier/model-tier.ts'
import { applyDispatchSelection } from '../work/dispatch-selection.ts'
import { emptyRoutingState, recordSourceFailure, serializeRoutingState, type FailureClass } from './router.ts'

/** daemon_kv 键（与 model-routing.state 并存、各自序列化；坏值保守重置为空=全开） */
export const SUPPLY_QUOTA_KV_KEY = 'model-routing.quota'

/** 被阻塞/探针在途的池（hold 载荷逐池一项；ESCALATE 逐池一条） */
export interface QuotaHoldPool {
  readonly provider: string
  readonly window: QuotaWindow
  readonly blockedUntil: number
  readonly resetAt?: number
  /** 恢复期他单探针在途（probe-other）时携带 */
  readonly probeTicket?: string
  /** 本档 sources 中属该池的路由源 id（选择序） */
  readonly sources: readonly string[]
}

/** 决策级 hold 载荷（TickReport.decisions[].quota；render 行签名去重） */
export interface QuotaHoldPayload {
  readonly tier: string
  /** 约束池（blockedUntil 最早者——日志行/决策主锚） */
  readonly provider: string
  readonly window: QuotaWindow
  readonly blockedUntil: number
  readonly resetAt?: number
  readonly probeTicket?: string
  readonly sources: readonly string[]
  readonly pools: readonly QuotaHoldPool[]
}

/** 门控判定：hold=拦（§2.3）；claimed=本单已认领恢复期探针并放行（§2.4） */
export interface QuotaGateOutcome {
  readonly hold?: QuotaHoldPayload
  readonly claimed: boolean
  /** claimed 时的认领池（本档 enabled 源里首个可认领池） */
  readonly claimPool?: string | undefined
}

/** healthz `routing.quota[]` 行形（只列有记录的池） */
export interface QuotaHealthRow {
  readonly provider: string
  readonly state: 'blocked' | 'recovering' | 'probe'
  readonly window: QuotaWindow
  readonly blockedUntil: number
  readonly resetAt?: number
  readonly probeTicket?: string
  /** 全档位 sources 中属该池的路由源 id（配置序） */
  readonly sources: readonly string[]
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** 池状态替换＋持久化（无变更=同一引用不落 kv） */
function withQuota(rt: EngineRuntime, next: SupplyQuotaState): void {
  const routing = rt.modelRouting
  if (routing === undefined || next === routing.quota) return
  routing.quota = next
  rt.ledger.kvSet(SUPPLY_QUOTA_KV_KEY, serializeSupplyQuotaState(next))
}

const hasProbeOf = (quota: SupplyQuotaState, ticket: TicketId): boolean =>
  Object.values(quota.pools).some((record) => record.probe?.ticket === ticket)

/**
 * 路由源失败登记（§2.2；launch 换源面与 harvest 回填面唯一入口）：源级冷却照旧＋持久化；
 * quota 类另记池阻塞（`blockedUntil = resetAt ?? now + 源冷却Ms`，清该池探针认领）。
 * `ticket` 给定（收割面）且失败非 quota → 释放本单探针认领（§2.4：池停留恢复期，下一位再认领）。
 * 返回审计段素材：class/cooldownMs（既有 note 字段）＋ `note`=core `errorKindNote` 尾段。
 */
export function recordRoutedFailure(
  rt: EngineRuntime,
  source: ModelSourceSpec,
  err: unknown,
  at: number,
  ticket?: TicketId,
): { class: FailureClass; cooldownMs: number; note: string; cls: ErrorClassification } {
  const rec = recordSourceFailure(rt.modelRouting?.state ?? emptyRoutingState(), source, err, at)
  if (rt.modelRouting !== undefined) {
    rt.modelRouting.state = rec.state
    rt.ledger.kvSet('model-routing.state', serializeRoutingState(rec.state))
    const quota = rt.modelRouting.quota
    if (rec.cls.kind === 'quota') {
      withQuota(rt, recordQuotaBlock(quota, {
        pool: quotaPoolKeyOf(source.provider),
        window: rec.cls.quotaWindow ?? 'unknown',
        resetAt: rec.cls.resetAt,
        now: at,
        fallbackMs: rec.cooldownMs,
        sourceId: source.id,
        providerCode: rec.cls.providerCode,
      }))
    } else if (ticket !== undefined && hasProbeOf(quota, ticket)) {
      withQuota(rt, releaseQuotaProbesOf(quota, ticket))
    }
  }
  return { class: rec.class, cooldownMs: rec.cooldownMs, note: errorKindNote(rec.cls, { provider: source.provider }), cls: rec.cls }
}

/**
 * 路由源成功回填后的池放开（§2.4：探针成功=删池记录=全开）。池仍在阻塞期（阻塞登记早于本单
 * 派发）→ 在途旧单成功不是恢复证据，不动。
 */
export function resolveRoutedPool(rt: EngineRuntime, source: ModelSourceSpec, at: number): void {
  const quota = rt.modelRouting?.quota
  if (quota === undefined || quota.pools[quotaPoolKeyOf(source.provider)] === undefined) return
  const pool = quotaPoolKeyOf(source.provider)
  if (quotaPoolVerdict(quota, pool, '', at) === 'blocked') return
  withQuota(rt, resolveQuotaOpen(quota, pool))
}

/**
 * 探针派发 DISPATCH 尾段（§2.5；选中路由源后、launch 前调用）：
 * - 本单持该池认领 → `;routing-quota-probe=1;routing-quota-pool=<p>`；
 * - 选中源不在认领池 → 释放他池认领（探针未发生，不得占位）；
 * - **派发即认领**：选中源所在池在恢复期且本单未持认领（决策级门控未开：人位未定/选择链拒派/
 *   认领了他池）→ 经同一 core 转移 `claimQuotaProbe` 认领（非 probe-claimable=不变）——单探针
 *   不变量不依赖决策级镜像面；他单在途（probe-other）时 select 层已跳过，本函数不冒认。
 * 非探针=''。
 */
export function quotaProbeNote(rt: EngineRuntime, source: ModelSourceSpec, ticket: TicketId, at: number): string {
  const quota = rt.modelRouting?.quota
  if (quota === undefined) return ''
  const pool = quotaPoolKeyOf(source.provider)
  let next = quota
  for (const key of Object.keys(quota.pools)) {
    if (key !== pool && quota.pools[key]?.probe?.ticket === ticket) next = releaseQuotaProbe(next, key, ticket)
  }
  if (next.pools[pool]?.probe?.ticket !== ticket) next = claimQuotaProbe(next, pool, ticket, at)
  if (next !== quota) withQuota(rt, next)
  return next.pools[pool]?.probe?.ticket === ticket ? `;routing-quota-probe=1;routing-quota-pool=${pool}` : ''
}

/** 派发未成（executeDispatch !ok）→ 释放本单全部探针认领（§2.4） */
export function settleQuotaProbe(rt: EngineRuntime, ticket: TicketId, ok: boolean): void {
  const quota = rt.modelRouting?.quota
  if (ok || quota === undefined || !hasProbeOf(quota, ticket)) return
  withQuota(rt, releaseQuotaProbesOf(quota, ticket))
}

/**
 * 决策级门控（§2.3）：与 execute `routingActive` 同源判路由面开——modelRouting+catalog 在场、本档
 * sources 非空、绑定适配器名==='dsh' 或本档 sources[].executor 在场；档位候选/续跑面/选择链改派
 * 均按 execute 同函数纯解析镜像（人位未定、选择链拒派=不拦，交 execute 级兜底 §2.5）。
 * 面开 → 逐源判定（`quotaHoldOf`）：有可放行源→放行；恢复期可认领→本单认领后放行；否则 hold。
 */
export function quotaGateVerdict(
  rt: EngineRuntime,
  ticket: TicketId,
  issue: IssueRecord,
  personId: string | undefined,
  resumePlan: ResumeDispatchPlan | undefined,
  index: EventIndex,
  at: number,
): QuotaGateOutcome | undefined {
  const routing = rt.modelRouting
  if (routing === undefined || rt.catalog === undefined || personId === undefined) return undefined
  if (Object.keys(routing.quota.pools).length === 0) return undefined
  withQuota(rt, pruneSupplyQuota(routing.quota, at)) // TTL 修剪（§2.1）：到期池记录保留 24h 后忘记
  if (Object.keys(routing.quota.pools).length === 0) return undefined
  const tierResolve = resolveModelTier({
    ticket,
    assignee: issue.assignee,
    people: rt.people,
    jobAnchor: index.jobAnchorOf(ticket),
    jobTierOf: (id) => rt.ledger.getJob(id)?.model_tier,
  }, rt.config)
  const sources = tierResolve === undefined ? undefined : routing.sources[tierResolve.tier]
  if (tierResolve === undefined || sources === undefined || sources.length === 0) return undefined
  const tierFallback = rt.registry.pick()
  if (tierFallback === undefined) return undefined
  const tierFace = modelTierDispatchFace(rt.registry, tierResolve.tier, tierFallback, rt.config.tierExecutors?.[tierResolve.tier])
  const resumeFace = resumePlan !== undefined ? resumeDispatchFace(rt.registry, resumePlan, tierFace?.adapter ?? tierFallback) : undefined
  let adapter = resumeFace?.adapter ?? tierFace?.adapter ?? tierFallback
  if (rt.deps.dispatchSelection !== undefined) {
    const selection = applyDispatchSelection({ registry: rt.registry, deps: rt.deps.dispatchSelection, ticket, personId, candidate: adapter, resumeActive: resumeFace?.active === true })
    if (selection.kind === 'err') return undefined
    adapter = selection.adapter
  }
  if (adapter.name !== 'dsh' && !sources.some((source) => source.executor !== undefined)) return undefined
  return quotaHoldOf(sources, tierResolve.tier, ticket, at, routing.quota)
}

/**
 * 逐源判定（纯函数；enabled 源按选择序）：任一源 open/probe-mine → 放行（undefined）；
 * 首个 probe-claimable 池 → 本单认领（claimed）；否则全部 blocked/probe-other → hold 载荷
 * （逐池一项，blockedUntil 升序；主锚=约束池）。池为空=undefined（不拦）。
 */
export function quotaHoldOf(
  sources: readonly ModelSourceSpec[],
  tier: string,
  ticket: TicketId,
  at: number,
  quota: SupplyQuotaState,
): QuotaGateOutcome | undefined {
  const ordered = sources.filter((source) => source.enabled !== false).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  if (ordered.length === 0 || Object.keys(quota.pools).length === 0) return undefined
  const held = new Map<string, QuotaHoldPool>()
  let claimable: string | undefined
  for (const source of ordered) {
    const pool = quotaPoolKeyOf(source.provider)
    const verdict = quotaPoolVerdict(quota, pool, ticket, at)
    if (verdict === 'open' || verdict === 'probe-mine') return undefined
    if (verdict === 'probe-claimable') {
      claimable ??= pool
      continue
    }
    const block: QuotaWindowBlock | undefined = verdict === 'blocked' ? quotaBlockOf(quota, pool, at) : quotaRecoveringBlockOf(quota, pool)
    const probe = quota.pools[pool]?.probe
    const prev = held.get(pool)
    if (prev === undefined) {
      held.set(pool, {
        provider: pool,
        window: block?.window ?? 'unknown',
        blockedUntil: block?.blockedUntil ?? at,
        ...(block?.resetAt !== undefined ? { resetAt: block.resetAt } : {}),
        ...(verdict === 'probe-other' && probe !== undefined ? { probeTicket: probe.ticket } : {}),
        sources: [source.id],
      })
    } else if (!prev.sources.includes(source.id)) {
      held.set(pool, { ...prev, sources: [...prev.sources, source.id] })
    }
  }
  // 恢复期可认领池在前（execute 按选择序跳过阻塞池源、落到该池源=本单探针），即使他池仍阻塞
  if (claimable !== undefined) return { claimed: true, claimPool: claimable }
  if (held.size === 0) return undefined
  const pools = [...held.values()].sort((a, b) => a.blockedUntil - b.blockedUntil || a.provider.localeCompare(b.provider))
  const primary = pools[0]!
  return {
    claimed: false,
    hold: {
      tier,
      provider: primary.provider,
      window: primary.window,
      blockedUntil: primary.blockedUntil,
      ...(primary.resetAt !== undefined ? { resetAt: primary.resetAt } : {}),
      ...(primary.probeTicket !== undefined ? { probeTicket: primary.probeTicket } : {}),
      sources: primary.sources,
      pools,
    },
  }
}

/** 恢复期认领（§2.4；仅 `claimed` 结论后调用、池=本档源所在池；持久化） */
export function claimProbeFor(rt: EngineRuntime, ticket: TicketId, at: number, pool: string | undefined): boolean {
  const quota = rt.modelRouting?.quota
  if (quota === undefined || pool === undefined) return false
  if (quotaPoolVerdict(quota, pool, ticket, at) !== 'probe-claimable') return false
  withQuota(rt, claimQuotaProbe(quota, pool, ticket, at))
  return true
}

/**
 * 阻塞期 ESCALATE（§3；每池每窗口每 resetAt 每 tier 一条——routingWarnings 去重键
 * `quota-hold|<pool>|<w>|<resetAt>|<tier>`；hold 无台账事件，本条=阻塞期唯一台账留痕）。返回落账条数。
 */
export function noteQuotaHold(rt: EngineRuntime, issue: IssueRecord, hold: QuotaHoldPayload, attempt: number, tickEvents: EventRecord[]): number {
  let emitted = 0
  for (const pool of hold.pools) {
    const key = `quota-hold|${pool.provider}|${pool.window}|${pool.resetAt ?? ''}|${hold.tier}`
    if (rt.routingWarnings.has(key)) continue
    rt.routingWarnings.add(key)
    emitted += 1
    rt.makeEvent('ESCALATE', issue, attempt, tickEvents, {
      note:
        `MODEL_ROUTING_QUOTA_HOLD;tier=${hold.tier};provider=${pool.provider};account=-;quotaWindow=${pool.window}` +
        `${pool.resetAt !== undefined ? `;resetAt=${iso(pool.resetAt)}` : ''};blockedUntil=${iso(pool.blockedUntil)}` +
        `${pool.probeTicket !== undefined ? `;probeTicket=${pool.probeTicket}` : ''};sources=${pool.sources.join(',')}` +
        `;ticket=${issue.id}（同池窗口未到：决策级 hold 不占泳道不烧 attempt；恢复期单探针——task-157）`,
    })
  }
  return emitted
}

/** healthz `routing.quota[]`（§3；只列有记录的池，provider 升序；now=引擎钟） */
export function quotaHealthRows(rt: EngineRuntime, now: number): QuotaHealthRow[] {
  const routing = rt.modelRouting
  if (routing === undefined) return []
  const members = new Map<string, string[]>()
  for (const sources of Object.values(routing.sources)) {
    for (const source of sources ?? []) {
      const ids = members.get(quotaPoolKeyOf(source.provider)) ?? []
      if (!ids.includes(source.id)) ids.push(source.id)
      members.set(quotaPoolKeyOf(source.provider), ids)
    }
  }
  const rows: QuotaHealthRow[] = []
  for (const provider of Object.keys(routing.quota.pools)) {
    const quota = routing.quota
    const block = quotaBlockOf(quota, provider, now) ?? quotaRecoveringBlockOf(quota, provider)
    const probe = quota.pools[provider]?.probe
    const leased = probe !== undefined && probe.leaseUntil > now
    rows.push({
      provider,
      state: block !== undefined && block.blockedUntil > now ? 'blocked' : leased ? 'probe' : 'recovering',
      window: block?.window ?? 'unknown',
      blockedUntil: block?.blockedUntil ?? 0,
      ...(block?.resetAt !== undefined ? { resetAt: block.resetAt } : {}),
      ...(leased ? { probeTicket: probe.ticket } : {}),
      sources: members.get(provider) ?? [],
    })
  }
  return rows.sort((a, b) => a.provider.localeCompare(b.provider))
}

/** 在途单实际路由源的 provider（GATE_FAIL 尾段 `provider=`；无路由源=undefined→note 作 `-`） */
export function routedProviderOf(rt: EngineRuntime, entry: { routedSourceId?: string; routedTier?: TierId }): string | undefined {
  const id = entry.routedSourceId
  if (id === undefined || entry.routedTier === undefined) return undefined
  return rt.modelRouting?.sources[entry.routedTier]?.find((source) => source.id === id)?.provider
}
