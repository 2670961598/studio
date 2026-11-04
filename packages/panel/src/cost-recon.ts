/**
 * panel/cost-recon —— 成本对账观测块（studio-dev-737；docs/17-§?/成本口径）
 *
 * 只读 daemon_kv `cost.recon.last`（cost_daily=结算权威；GATE_PASS.cost_usd=明细；log-only）。
 * 缺省/坏 JSON→unknown（不补 0、不显示绿）；字段口径与 daemon 写入 JSON 对齐。
 */
export type CostReconLevel = 'ignore' | 'warn' | 'escalate' | 'unknown'

export interface SnapshotCostRecon {
  readonly state: 'known' | 'unknown'
  readonly level: CostReconLevel
  readonly date: string | null
  readonly at: number | null
  readonly closedUsd: number | null
  readonly harvestUsd: number | null
  readonly deltaUsd: number | null
  readonly perModel: ReadonlyArray<{ readonly model: string; readonly closedUsd: number; readonly harvestUsd: number; readonly deltaUsd: number }>
  readonly caliber: string
  readonly reason?: string
}

function unknownCostRecon(reason: string): SnapshotCostRecon {
  return {
    state: 'unknown',
    level: 'unknown',
    date: null,
    at: null,
    closedUsd: null,
    harvestUsd: null,
    deltaUsd: null,
    perModel: [],
    caliber: 'cost-recon/unknown',
    reason,
  }
}

/** 解析 cost.recon.last（纯函数；坏数据→unknown） */
export function buildCostReconBlock(raw: string | null): SnapshotCostRecon {
  if (raw === null || raw === '') return unknownCostRecon('kv-missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return unknownCostRecon('kv-bad-json')
  }
  if (typeof parsed !== 'object' || parsed === null) return unknownCostRecon('kv-not-object')
  const v = parsed as { date?: unknown; at?: unknown; level?: unknown; closedUsd?: unknown; harvestUsd?: unknown; deltaUsd?: unknown; perModel?: unknown; caliber?: unknown }
  const level = v.level === 'ignore' || v.level === 'warn' || v.level === 'escalate' ? v.level : undefined
  if (level === undefined) return unknownCostRecon('kv-bad-level')
  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const perModel: Array<{ model: string; closedUsd: number; harvestUsd: number; deltaUsd: number }> = []
  if (Array.isArray(v.perModel)) {
    for (const row of v.perModel) {
      if (typeof row !== 'object' || row === null) continue
      const r = row as { model?: unknown; closedUsd?: unknown; harvestUsd?: unknown; deltaUsd?: unknown }
      if (typeof r.model !== 'string') continue
      perModel.push({ model: r.model, closedUsd: num(r.closedUsd) ?? 0, harvestUsd: num(r.harvestUsd) ?? 0, deltaUsd: num(r.deltaUsd) ?? 0 })
    }
  }
  return {
    state: 'known',
    level,
    date: typeof v.date === 'string' ? v.date : null,
    at: num(v.at),
    closedUsd: num(v.closedUsd),
    harvestUsd: num(v.harvestUsd),
    deltaUsd: num(v.deltaUsd),
    perModel,
    caliber: typeof v.caliber === 'string' ? v.caliber : 'cost-recon/v1',
  }
}

/** 读 daemon_kv（旧/测试 ledger 无 kvGet→null；读异常→null；不写） */
export function readCostReconRaw(ledger: unknown): string | null {
  const target = ledger as { kvGet?: (key: string) => string | null }
  if (typeof target.kvGet !== 'function') return null
  try {
    return target.kvGet('cost.recon.last')
  } catch {
    return null
  }
}
