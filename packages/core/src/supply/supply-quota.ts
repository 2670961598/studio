/**
 * supply/supply-quota —— 供给级配额池状态机（task-157 / FIX-03；docs/quality/supply-quota-gating.md §2）
 *
 * 纯函数、零 IO、时间入参。额度是**供给池级**（同 provider 的账号/窗口共享），而既有冷却是
 * 源级——同一池的其他源在窗口未到前照样被派发再 429。本件把「池-窗口」阻塞与恢复期单探针
 * 建模为显式状态：
 *   - `recordQuotaBlock`：登记阻塞（resetAt 已知=阻塞至 reset；未知=now+回退冷却=现行为）；
 *   - `quotaPoolVerdict`：五态 open / blocked / probe-other / probe-mine / probe-claimable；
 *   - 恢复期（窗口全部到期）只放**一个**探针：`claimQuotaProbe` 认领（租约防死锁）、
 *     `releaseQuotaProbe(s)Of` 释放、`resolveQuotaOpen` 探针成功即全开；
 *   - 持久化形 `{version:1, pools}`，坏值保守重置为空（=全开，与 model-routing.state 同口径）。
 * 状态不可变：变更返回新对象，无变更返回同一引用（调用方据此决定是否落 kv）。
 */
import type { QuotaWindow } from './error-kind.ts'

export interface QuotaWindowBlock {
  readonly window: QuotaWindow
  /** 池在该窗口下的阻塞截止（=resetAt 或登记时刻+回退冷却） */
  readonly blockedUntil: number
  readonly resetAt?: number
  /** 首次观测到该窗口阻塞的路由源 */
  readonly sourceId: string
  readonly recordedAt: number
  readonly providerCode?: string
}

export interface QuotaProbeClaim {
  readonly ticket: string
  readonly claimedAt: number
  /** 租约到期（防探针单长跑/回收面/崩溃重启死锁：过期即可被他单认领） */
  readonly leaseUntil: number
}

export interface QuotaPoolState {
  readonly windows: Readonly<Record<string, QuotaWindowBlock>>
  readonly probe?: QuotaProbeClaim
}

export interface SupplyQuotaState {
  readonly pools: Readonly<Record<string, QuotaPoolState>>
}

export type QuotaPoolVerdict = 'open' | 'blocked' | 'probe-other' | 'probe-mine' | 'probe-claimable'

/** 探针租约缺省 60min */
export const QUOTA_PROBE_LEASE_MS = 60 * 60_000
/** 恢复期记录保留期：窗口到期超过 TTL 且无活探针即忘记该池（回 open） */
export const QUOTA_RECORD_TTL_MS = 24 * 60 * 60_000

const WINDOWS: ReadonlySet<string> = new Set<QuotaWindow>(['five_hour', 'week', 'month', 'unknown'])

export function emptySupplyQuotaState(): SupplyQuotaState {
  return { pools: {} }
}

/** 池键=provider 小写去空白（account 维度本切片不建模，note 携 account=-） */
export function quotaPoolKeyOf(provider: string): string {
  return provider.trim().toLowerCase()
}

export interface QuotaBlockInput {
  readonly pool: string
  readonly window: QuotaWindow
  /** > now 才生效；否则走 fallbackMs */
  readonly resetAt?: number | undefined
  readonly now: number
  /** 无有效 resetAt 时的阻塞时长（调用方给源级冷却值=现行为退化） */
  readonly fallbackMs: number
  readonly sourceId: string
  readonly providerCode?: string | undefined
}

/** 阻塞登记：写入本窗口、保留他窗未到期记录、清除探针认领（§2.2） */
export function recordQuotaBlock(state: SupplyQuotaState, input: QuotaBlockInput): SupplyQuotaState {
  const resetAt = input.resetAt !== undefined && Number.isFinite(input.resetAt) && input.resetAt > input.now ? input.resetAt : undefined
  const blockedUntil = resetAt ?? input.now + Math.max(0, input.fallbackMs)
  const windows: Record<string, QuotaWindowBlock> = {}
  const prev = state.pools[input.pool]
  if (prev !== undefined) {
    for (const [window, block] of Object.entries(prev.windows)) {
      if (window !== input.window && block.blockedUntil > input.now) windows[window] = block
    }
  }
  windows[input.window] = {
    window: input.window,
    blockedUntil,
    ...(resetAt !== undefined ? { resetAt } : {}),
    sourceId: input.sourceId,
    recordedAt: input.now,
    ...(input.providerCode !== undefined ? { providerCode: input.providerCode } : {}),
  }
  return { pools: { ...state.pools, [input.pool]: { windows } } }
}

export function quotaPoolOf(state: SupplyQuotaState, pool: string): QuotaPoolState | undefined {
  return state.pools[pool]
}

/** 约束窗：未到期窗口里 blockedUntil 最晚者；无=池未阻塞 */
export function quotaBlockOf(state: SupplyQuotaState, pool: string, now: number): QuotaWindowBlock | undefined {
  const record = state.pools[pool]
  if (record === undefined) return undefined
  let binding: QuotaWindowBlock | undefined
  for (const block of Object.values(record.windows)) {
    if (block.blockedUntil > now && (binding === undefined || block.blockedUntil > binding.blockedUntil)) binding = block
  }
  return binding
}

/** 恢复期参考窗：全部到期时取最晚到期者（hold 观测载荷用；无记录=undefined） */
export function quotaRecoveringBlockOf(state: SupplyQuotaState, pool: string): QuotaWindowBlock | undefined {
  const record = state.pools[pool]
  if (record === undefined) return undefined
  let latest: QuotaWindowBlock | undefined
  for (const block of Object.values(record.windows)) {
    if (latest === undefined || block.blockedUntil > latest.blockedUntil) latest = block
  }
  return latest
}

/** 五态判定：任一窗口未到期=blocked；有记录全到期=恢复期（按探针认领分三态）；无记录=open */
export function quotaPoolVerdict(state: SupplyQuotaState, pool: string, ticket: string, now: number): QuotaPoolVerdict {
  const record = state.pools[pool]
  if (record === undefined) return 'open'
  if (quotaBlockOf(state, pool, now) !== undefined) return 'blocked'
  const probe = record.probe
  if (probe !== undefined && probe.leaseUntil > now) return probe.ticket === ticket ? 'probe-mine' : 'probe-other'
  return 'probe-claimable'
}

/** 探针认领（仅恢复期成立；已有活探针=不变） */
export function claimQuotaProbe(state: SupplyQuotaState, pool: string, ticket: string, now: number, leaseMs: number = QUOTA_PROBE_LEASE_MS): SupplyQuotaState {
  if (quotaPoolVerdict(state, pool, ticket, now) !== 'probe-claimable') return state
  const record = state.pools[pool]
  if (record === undefined) return state
  return { pools: { ...state.pools, [pool]: { ...record, probe: { ticket, claimedAt: now, leaseUntil: now + leaseMs } } } }
}

/** 释放本池由该票持有的认领（持票不符=不变） */
export function releaseQuotaProbe(state: SupplyQuotaState, pool: string, ticket: string): SupplyQuotaState {
  const record = state.pools[pool]
  if (record === undefined || record.probe === undefined || record.probe.ticket !== ticket) return state
  return withPool(state, pool, { windows: record.windows })
}

/** 释放该票在所有池的认领 */
export function releaseQuotaProbesOf(state: SupplyQuotaState, ticket: string): SupplyQuotaState {
  let next = state
  for (const pool of Object.keys(state.pools)) next = releaseQuotaProbe(next, pool, ticket)
  return next
}

/** 探针成功：删池记录=全开 */
export function resolveQuotaOpen(state: SupplyQuotaState, pool: string): SupplyQuotaState {
  if (state.pools[pool] === undefined) return state
  const pools: Record<string, QuotaPoolState> = {}
  for (const [key, record] of Object.entries(state.pools)) if (key !== pool) pools[key] = record
  return { pools }
}

/** 修剪：无未到期窗口、无活探针、且最晚窗口已到期超过 TTL 的池整条忘记 */
export function pruneSupplyQuota(state: SupplyQuotaState, now: number, ttlMs: number = QUOTA_RECORD_TTL_MS): SupplyQuotaState {
  let changed = false
  const pools: Record<string, QuotaPoolState> = {}
  for (const [pool, record] of Object.entries(state.pools)) {
    const latest = quotaRecoveringBlockOf(state, pool)
    const live = latest !== undefined && (latest.blockedUntil > now || latest.blockedUntil > now - ttlMs || (record.probe !== undefined && record.probe.leaseUntil > now))
    if (live) pools[pool] = record
    else changed = true
  }
  return changed ? { pools } : state
}

function withPool(state: SupplyQuotaState, pool: string, record: QuotaPoolState | undefined): SupplyQuotaState {
  if (record === undefined) {
    if (state.pools[pool] === undefined) return state
    const pools: Record<string, QuotaPoolState> = {}
    for (const [key, value] of Object.entries(state.pools)) if (key !== pool) pools[key] = value
    return { pools }
  }
  return { pools: { ...state.pools, [pool]: record } }
}

/** daemon_kv 持久化（JSON；坏值保守重置为空=全开，不崩） */
export function serializeSupplyQuotaState(state: SupplyQuotaState): string {
  return JSON.stringify({ version: 1, pools: state.pools })
}

export function deserializeSupplyQuotaState(raw: string | null | undefined): SupplyQuotaState {
  if (raw === null || raw === undefined || raw === '') return emptySupplyQuotaState()
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; pools?: unknown }
    if (parsed.version !== 1 || typeof parsed.pools !== 'object' || parsed.pools === null || Array.isArray(parsed.pools)) return emptySupplyQuotaState()
    const pools: Record<string, QuotaPoolState> = {}
    for (const [pool, value] of Object.entries(parsed.pools as Record<string, unknown>)) {
      const record = recordOf(value)
      if (record !== undefined) pools[pool] = record
    }
    return { pools }
  } catch {
    return emptySupplyQuotaState()
  }
}

function recordOf(value: unknown): QuotaPoolState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as { windows?: unknown; probe?: unknown }
  if (typeof v.windows !== 'object' || v.windows === null || Array.isArray(v.windows)) return undefined
  const windows: Record<string, QuotaWindowBlock> = {}
  for (const [window, raw] of Object.entries(v.windows as Record<string, unknown>)) {
    const block = blockOf(window, raw)
    if (block !== undefined) windows[window] = block
  }
  const probe = typeof v.probe === 'object' && v.probe !== null && !Array.isArray(v.probe) ? (v.probe as Record<string, unknown>) : undefined
  const probeTicket = probe?.['ticket']
  const probeClaimedAt = probe?.['claimedAt']
  const probeLeaseUntil = probe?.['leaseUntil']
  return {
    windows,
    ...(typeof probeTicket === 'string' && typeof probeClaimedAt === 'number' && typeof probeLeaseUntil === 'number'
      ? { probe: { ticket: probeTicket, claimedAt: probeClaimedAt, leaseUntil: probeLeaseUntil } }
      : {}),
  }
}

function blockOf(window: string, raw: unknown): QuotaWindowBlock | undefined {
  if (!WINDOWS.has(window) || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const b = raw as Record<string, unknown>
  if (typeof b['blockedUntil'] !== 'number' || !Number.isFinite(b['blockedUntil'])) return undefined
  if (typeof b['sourceId'] !== 'string') return undefined
  return {
    window: window as QuotaWindow,
    blockedUntil: b['blockedUntil'],
    ...(typeof b['resetAt'] === 'number' && Number.isFinite(b['resetAt']) ? { resetAt: b['resetAt'] } : {}),
    sourceId: b['sourceId'],
    recordedAt: typeof b['recordedAt'] === 'number' && Number.isFinite(b['recordedAt']) ? b['recordedAt'] : 0,
    ...(typeof b['providerCode'] === 'string' ? { providerCode: b['providerCode'] } : {}),
  }
}
