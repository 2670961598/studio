/**
 * engine/routing/seed —— per-source price snapshot 播种（task-56 启动口径；task-135 热切复用）
 *
 * 单一播种口径（启动与 models.yaml 热切共用本件，不双源漂移）：
 *   - 覆盖面：models.yaml 全档 sources[]（`modelSourcesOf` 归一——旧单源格式也计 default 源）；
 *   - 去重：同 provider/model 当日已有快照行（任意 source_ticket）即跳过——跨档同模型
 *     不重复播种、同日重复调用幂等（appendPriceSnapshot 单据幂等之外的第二道闸）；
 *   - 幂等：source_ticket=`seed-routing:<date>:<tier>:<source id>` 确定性锚 + 当日已播
 *     行预检；异常只告警不阻断调用面（启动不拒启 / 热切不回滚——价目缺行不破坏路由本体）。
 * 零新增事件词/schema；不触碰生产配置。
 */
import { localDateKey, modelSourcesOf, type ModelsConfig, type TierId } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../tools/id.ts'

/** 播种依赖（ledger 只取定价面两法；clock=注入时钟；log=告警出口） */
export interface SeedRoutingPriceDeps {
  readonly ledger: Pick<Ledger, 'appendPriceSnapshot' | 'listPriceSnapshots'>
  readonly company: string
  readonly clock: () => number
  readonly log: (line: string) => void
  /** 调用面标签（source_note 区分 startup / hot-swap 审计） */
  readonly origin: string
}

export interface SeedRoutingPriceResult {
  /** 当日参与判定的 provider/model 数（与启动日志 seeded= 口径一致） */
  readonly candidates: number
  /** 实际新落行数（0=当日已全部播种/去重跳过） */
  readonly appended: number
}

/**
 * 播种 per-source 价目快照（幂等；恒不抛——逐源 try/catch 只告警）。
 * 启动（executor-face）与热切（models-hot-swap，task-135 即时补种新源）共用。
 */
export function seedRoutingPriceSnapshots(deps: SeedRoutingPriceDeps, parsed: ModelsConfig): SeedRoutingPriceResult {
  const priceDate = localDateKey(deps.clock())
  const existing = new Set<string>()
  for (const row of deps.ledger.listPriceSnapshots({ company: deps.company, price_date: priceDate })) {
    existing.add(`${row.provider}/${row.model}`)
  }
  const seeded = new Set<string>()
  let appended = 0
  for (const tier of ['high', 'mid', 'low'] as const) {
    for (const source of modelSourcesOf(parsed, tier)) {
      const key = `${source.provider}/${source.model}`
      if (seeded.has(key) || existing.has(key)) continue
      seeded.add(key)
      try {
        deps.ledger.appendPriceSnapshot({
          id: `ps-${makeUlid(deps.clock())}`,
          company: deps.company,
          provider: source.provider,
          model: source.model,
          price_date: priceDate,
          slot: 'peak',
          input_per_m: source.price.inputPerM,
          output_per_m: source.price.outputPerM,
          ...(source.price.cacheReadPerM !== undefined ? { cache_read_per_m: source.price.cacheReadPerM } : {}),
          ...(source.price.cacheCreationPerM !== undefined ? { cache_creation_per_m: source.price.cacheCreationPerM } : {}),
          source_note: `models.yaml sources[] 路由源价目（tier=${tier as TierId};source=${source.id}；${deps.origin}）`,
          source_ticket: `seed-routing:${priceDate}:${tier as TierId}:${source.id}`,
          published_by: 'serve-routing',
        })
        appended += 1
      } catch (err) {
        deps.log(`[routing-seed] 路由源价目播种警告（${tier}/${source.id}）：${err instanceof Error ? err.message : String(err)}（不阻断；预算归属可能缺价）`)
      }
    }
  }
  return { candidates: seeded.size, appended }
}
