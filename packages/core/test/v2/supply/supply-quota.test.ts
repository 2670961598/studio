/**
 * 供给级配额池状态机测试 —— docs/quality/supply-quota-gating.md §2/§5（task-157 / FIX-03）。
 *
 * 覆盖：阻塞登记（reset/回退）、五态 verdict、恢复期单探针（认领/租约/释放）、探针成功
 * 放开、新阻塞清探针、多窗叠加、TTL 修剪、序列化坏值保守重置。纯函数、固定时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  QUOTA_PROBE_LEASE_MS,
  QUOTA_RECORD_TTL_MS,
  claimQuotaProbe,
  deserializeSupplyQuotaState,
  emptySupplyQuotaState,
  pruneSupplyQuota,
  quotaBlockOf,
  quotaPoolKeyOf,
  quotaPoolVerdict,
  recordQuotaBlock,
  releaseQuotaProbe,
  releaseQuotaProbesOf,
  resolveQuotaOpen,
  serializeSupplyQuotaState,
  type SupplyQuotaState,
} from '../../../src/supply/supply-quota.ts'

const NOW = Date.parse('2026-11-26T06:00:00.000Z')
const RESET = Date.parse('2026-11-27T06:24:57.000Z')
const MIN = 60_000

function blocked(resetAt?: number, now = NOW, window: 'week' | 'five_hour' | 'month' | 'unknown' = 'week'): SupplyQuotaState {
  return recordQuotaBlock(emptySupplyQuotaState(), { pool: 'glm', window, resetAt, now, fallbackMs: 15 * MIN, sourceId: 'a' })
}

describe('quotaPoolKeyOf / 空态', () => {
  it('池键=provider 小写去空白；空态 verdict=open', () => {
    expect(quotaPoolKeyOf(' GLM ')).toBe('glm')
    expect(quotaPoolVerdict(emptySupplyQuotaState(), 'glm', 'T-1', NOW)).toBe('open')
    expect(quotaBlockOf(emptySupplyQuotaState(), 'glm', NOW)).toBeUndefined()
  })
})

describe('recordQuotaBlock：阻塞登记', () => {
  it('有 resetAt → 阻塞至 resetAt；窗口携带 reset/来源', () => {
    const state = blocked(RESET)
    expect(quotaPoolVerdict(state, 'glm', 'T-1', NOW)).toBe('blocked')
    expect(quotaPoolVerdict(state, 'glm', 'T-1', RESET - 1)).toBe('blocked')
    expect(quotaBlockOf(state, 'glm', NOW)).toEqual({ window: 'week', blockedUntil: RESET, resetAt: RESET, sourceId: 'a', recordedAt: NOW })
    // 到点 → 恢复期
    expect(quotaPoolVerdict(state, 'glm', 'T-1', RESET)).toBe('probe-claimable')
    expect(quotaBlockOf(state, 'glm', RESET)).toBeUndefined()
  })
  it('无 resetAt / resetAt 已过期 → blockedUntil = now + 回退冷却（现行为退化）', () => {
    expect(quotaBlockOf(blocked(undefined), 'glm', NOW)?.blockedUntil).toBe(NOW + 15 * MIN)
    expect(quotaBlockOf(blocked(NOW - 1), 'glm', NOW)?.blockedUntil).toBe(NOW + 15 * MIN)
    expect(quotaBlockOf(blocked(undefined), 'glm', NOW)?.resetAt).toBeUndefined()
    expect(quotaPoolVerdict(blocked(undefined), 'glm', 'T-1', NOW + 15 * MIN)).toBe('probe-claimable')
  })
  it('多窗叠加：未到期窗口保留，约束窗=最晚者；到期窗口被清理', () => {
    const first = recordQuotaBlock(emptySupplyQuotaState(), { pool: 'glm', window: 'five_hour', resetAt: NOW + 5 * 3_600_000, now: NOW, fallbackMs: 0, sourceId: 'a' })
    const both = recordQuotaBlock(first, { pool: 'glm', window: 'week', resetAt: RESET, now: NOW, fallbackMs: 0, sourceId: 'b', providerCode: '1310' })
    expect(quotaBlockOf(both, 'glm', NOW)).toMatchObject({ window: 'week', blockedUntil: RESET, sourceId: 'b', providerCode: '1310' })
    expect(quotaPoolVerdict(both, 'glm', 'T-1', NOW + 5 * 3_600_000)).toBe('blocked')
    expect(quotaBlockOf(both, 'glm', NOW + 5 * 3_600_000)?.window).toBe('week')
    // 新阻塞登记时丢弃他窗已到期记录
    const later = recordQuotaBlock(both, { pool: 'glm', window: 'month', resetAt: RESET + 86_400_000, now: NOW + 6 * 3_600_000, fallbackMs: 0, sourceId: 'c' })
    expect(Object.keys((later.pools as Record<string, { windows: Record<string, unknown> }>)['glm']!.windows).sort()).toEqual(['month', 'week'])
  })
  it('池间互不影响', () => {
    const state = blocked(RESET)
    expect(quotaPoolVerdict(state, 'opencode-go', 'T-1', NOW)).toBe('open')
  })
})

describe('恢复期单探针', () => {
  it('首个候选认领：本单 probe-mine、他单 probe-other；他池不受影响', () => {
    const at = RESET + 1
    const claimed = claimQuotaProbe(blocked(RESET), 'glm', 'T-1', at)
    expect(claimed).not.toBe(blocked(RESET) as object)
    expect(quotaPoolVerdict(claimed, 'glm', 'T-1', at)).toBe('probe-mine')
    expect(quotaPoolVerdict(claimed, 'glm', 'T-2', at)).toBe('probe-other')
    expect(quotaPoolVerdict(claimed, 'opencode-go', 'T-2', at)).toBe('open')
    // 重复认领（已有活探针）不改变状态
    expect(claimQuotaProbe(claimed, 'glm', 'T-2', at)).toBe(claimed)
  })
  it('认领只在恢复期成立：open / blocked 态认领无效果', () => {
    const empty = emptySupplyQuotaState()
    expect(claimQuotaProbe(empty, 'glm', 'T-1', NOW)).toBe(empty)
    const state = blocked(RESET)
    expect(claimQuotaProbe(state, 'glm', 'T-1', NOW)).toBe(state)
  })
  it('租约到期 → 他单可认领；缺省租约 60min', () => {
    expect(QUOTA_PROBE_LEASE_MS).toBe(60 * MIN)
    const at = RESET + 1
    const claimed = claimQuotaProbe(blocked(RESET), 'glm', 'T-1', at)
    expect(quotaPoolVerdict(claimed, 'glm', 'T-2', at + QUOTA_PROBE_LEASE_MS)).toBe('probe-claimable')
    const retook = claimQuotaProbe(claimed, 'glm', 'T-2', at + QUOTA_PROBE_LEASE_MS)
    expect(quotaPoolVerdict(retook, 'glm', 'T-2', at + QUOTA_PROBE_LEASE_MS)).toBe('probe-mine')
  })
  it('释放：持票不符不动；持票相符 → 回 probe-claimable；按票全池释放', () => {
    const at = RESET + 1
    const claimed = claimQuotaProbe(blocked(RESET), 'glm', 'T-1', at)
    expect(releaseQuotaProbe(claimed, 'glm', 'T-9')).toBe(claimed as object)
    const released = releaseQuotaProbe(claimed, 'glm', 'T-1')
    expect(quotaPoolVerdict(released, 'glm', 'T-2', at)).toBe('probe-claimable')
    const again = claimQuotaProbe(released, 'glm', 'T-1', at)
    const all = releaseQuotaProbesOf(again, 'T-1')
    expect(quotaPoolVerdict(all, 'glm', 'T-2', at)).toBe('probe-claimable')
    expect(releaseQuotaProbesOf(claimed, 'nobody')).toBe(claimed)
  })
  it('探针成功 → resolveQuotaOpen 删池记录=全开', () => {
    const at = RESET + 1
    const claimed = claimQuotaProbe(blocked(RESET), 'glm', 'T-1', at)
    const open = resolveQuotaOpen(claimed, 'glm')
    expect(quotaPoolVerdict(open, 'glm', 'T-2', at)).toBe('open')
    expect(quotaPoolVerdict(open, 'glm', 'T-3', at)).toBe('open')
    expect(open.pools['glm']).toBeUndefined()
  })
  it('探针失败再遇 quota → 新阻塞清探针、重新 blocked', () => {
    const at = RESET + 1
    const claimed = claimQuotaProbe(blocked(RESET), 'glm', 'T-1', at)
    const again = recordQuotaBlock(claimed, { pool: 'glm', window: 'week', resetAt: at + 86_400_000, now: at, fallbackMs: 0, sourceId: 'a' })
    expect(quotaPoolVerdict(again, 'glm', 'T-1', at)).toBe('blocked')
    expect(quotaPoolVerdict(again, 'glm', 'T-1', at + 86_400_000)).toBe('probe-claimable')
  })
})

describe('pruneSupplyQuota / 持久化', () => {
  it('恢复期记录超 TTL 且无活探针 → 忘记（回 open）；未超 TTL / 有活探针保留', () => {
    expect(QUOTA_RECORD_TTL_MS).toBe(24 * 3_600_000)
    const state = blocked(RESET)
    const still = RESET + QUOTA_RECORD_TTL_MS - 1
    expect(quotaPoolVerdict(pruneSupplyQuota(state, still), 'glm', 'T-1', still)).toBe('probe-claimable')
    const gone = RESET + QUOTA_RECORD_TTL_MS
    expect(quotaPoolVerdict(pruneSupplyQuota(state, gone), 'glm', 'T-1', gone)).toBe('open')
    // 活探针在 → 保留
    const claimed = claimQuotaProbe(state, 'glm', 'T-1', gone - 1)
    expect(pruneSupplyQuota(claimed, gone)).toBe(claimed as object)
    // 阻塞中 → 保留
    expect(pruneSupplyQuota(state, NOW)).toBe(state as object)
  })
  it('serialize/deserialize 往返；坏值/坏版本/坏条目保守处理', () => {
    const at = RESET + 1
    const claimed = claimQuotaProbe(recordQuotaBlock(blocked(RESET), { pool: 'kimi', window: 'unknown', now: NOW, fallbackMs: 15 * MIN, sourceId: 'k' }), 'glm', 'T-1', at)
    expect(deserializeSupplyQuotaState(serializeSupplyQuotaState(claimed))).toEqual(claimed)
    expect(deserializeSupplyQuotaState(null)).toEqual(emptySupplyQuotaState())
    expect(deserializeSupplyQuotaState('')).toEqual(emptySupplyQuotaState())
    expect(deserializeSupplyQuotaState('{oops')).toEqual(emptySupplyQuotaState())
    expect(deserializeSupplyQuotaState(JSON.stringify({ version: 2, pools: {} }))).toEqual(emptySupplyQuotaState())
    expect(deserializeSupplyQuotaState(JSON.stringify({ version: 1, pools: 'x' }))).toEqual(emptySupplyQuotaState())
    const partial = deserializeSupplyQuotaState(
      JSON.stringify({
        version: 1,
        pools: {
          glm: { windows: { week: { window: 'week', blockedUntil: RESET, resetAt: 'soon', sourceId: 'a' }, bad: { window: 'nope', blockedUntil: 1 }, worse: 7 }, probe: { ticket: 'T-1', claimedAt: at, leaseUntil: at + MIN } },
          kimi: { windows: [] },
          junk: 3,
        },
      }),
    )
    expect(partial.pools['glm']).toEqual({ windows: { week: { window: 'week', blockedUntil: RESET, sourceId: 'a', recordedAt: 0 } }, probe: { ticket: 'T-1', claimedAt: at, leaseUntil: at + MIN } })
    expect(partial.pools['kimi']).toBeUndefined()
    expect(partial.pools['junk']).toBeUndefined()
  })
})
