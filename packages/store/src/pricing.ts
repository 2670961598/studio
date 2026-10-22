/**
 * pricing —— v9 定价快照读写面（132-§6.2 单B·studio-dev-169；BC-S2 先拆再增：
 * 自 ledger.ts 拆出——形状闸随面落本文件，ledger.ts 仅摊入 createPricingFace）
 *
 * 表 DDL 归 migrations v9；写口唯一纪律（132-§8 S7）：本面 appendPriceSnapshot 是
 * price_snapshots 的唯一写面，生产调用方=daemon 定价单据化消费面（engine/pricing/）
 * ——「绕过单据的直写路径不存在」由 source_ticket 必填锚+daemon 唯一写入者纪律承保
 * （store 无法验证调用方身份，如实声明；无 CLI/脚本写口）。
 *
 * 语义（132-§6.2）：
 *   - append-only：触发器禁 UPDATE/DELETE（「日终定型不回溯」制作人令直译）——本面
 *     只有 INSERT；
 *   - 同日修订=新行 version+1（旧行不动）：version 由本面按自然键
 *     (company, provider, model, price_date, slot) 取 MAX(version)+1 赋值（单写者
 *     daemon 下无竞态；唯一索引 idx_price_snapshots_nat 兜底防漂移）；
 *   - 单据幂等：同 (company, source_ticket, provider, model, price_date, slot) 既有行
 *     全列一致 → 幂等跳过（appended=false，收割崩溃重放安全——同一张定价单重收不
 *     双写）；内容不一致 → CONFIG_INVALID 拒（insertCandidate 同款 fail-closed：
 *     同一单据对同一模型同日同档只能有一个价）；
 *   - id 归 daemon（'ps-'+ULID，store/test/ulid.ts 口径「生产侧 ULID 由 daemon 生成，
 *     store 只做格式校验」）；published_at 归本面（append 时刻的事实，调用方不供）。
 *
 * 计费轨双轨（制作人 2026-10-22 补充令「包月 plan 摊销口径双轨入定价面」）：
 *   - billing_track 值域**复制**自 contract BILLING_TRACKS（132-A 预设词表；store 零
 *     contract 运行时依赖同 CANDIDATE_STATUS_VALUES 先例，漂移由一致性测试钉死）；
 *   - api=按量轨（快照价折算）；coding_plan=包月订阅轨（边际 $0+影子价仍记四单价
 *     供跨模型可比，DEV-19）——plan_monthly_usd 必填正数=当月订阅费（摊销轨锚：
 *     日摊=月费÷当月日数的推导地基；实付现金流对账归 132-§7-7 机构层另立单）；
 *     api 行 plan_monthly_usd 必空（双轨互斥，superRefine 机械闸）。
 *
 * 形状闸落本文件的申报：records.ts 已达尺寸阈（597/600，20-§十五.三），本面闸随
 * 读写面同文件（hr-sync-queue 拆分先例允许面内自持形状闸；避免为 <3 行的基线扩容
 * 走提案流）。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, UlidSchema } from '@studio-next/contract'
import { z } from 'zod'
import { assertRecord, optNum, str, type SqlRow } from './row-helpers.ts'

/** 'ps-'+ULID（前缀语义归定价面；ULID 26 字符形复用契约 UlidSchema 校验） */
const PriceSnapshotIdSchema = z.string().refine(
  (v) => v.startsWith('ps-') && UlidSchema.safeParse(v.slice(3)).success,
  { message: "定价快照 id 须 'ps-'+26 字符 ULID（Crockford Base32 大写；store 只做格式校验——store/test/ulid.ts 口径）" },
)

// —— 冻结词表复制（值域与 contract ports/models.ts BILLING_TRACKS 一致性由测试钉死） ——

/** 计费轨值域（api=按量 / coding_plan=包月订阅；132-A 预设词表，132-B 消费落位） */
export const PRICE_BILLING_TRACK_VALUES = ['api', 'coding_plan'] as const
export type PriceBillingTrack = (typeof PRICE_BILLING_TRACK_VALUES)[number]

/** 峰谷档值域（132-§6.2 slot 键：DeepSeek 峰谷两档；缺省 peak 保守） */
export const PRICE_SLOT_VALUES = ['peak', 'offpeak'] as const
export type PriceSlot = (typeof PRICE_SLOT_VALUES)[number]

// —— 形状闸（strict：未知列拒——132-§4 DDL 列集+补充令两列） ——

/** 日历日串 'YYYY-MM-DD'（F5 日粒度；真日校验=UTC 回程比对，2026-02-30/0231 拒） */
const PRICE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(v: string): boolean {
  if (!PRICE_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
}

const PriceDateSchema = z.string().refine(isCalendarDate, { message: 'price_date 形如 YYYY-MM-DD 且须为真日历日' })

/**
 * 双轨互斥闸（制作人补充令）：coding_plan ⇒ plan_monthly_usd 必填正数（摊销轨锚）；
 * api ⇒ plan_monthly_usd 必空（按量轨无月费语义）。
 */
function billingTrackRefine(
  r: { billing_track: PriceBillingTrack; plan_monthly_usd?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (r.billing_track === 'coding_plan' && (r.plan_monthly_usd === undefined || r.plan_monthly_usd <= 0)) {
    ctx.addIssue({ code: 'custom', path: ['plan_monthly_usd'], message: 'coding_plan 行必填 plan_monthly_usd（当月订阅费 USD，正数——摊销轨锚）' })
  }
  if (r.billing_track === 'api' && r.plan_monthly_usd !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['plan_monthly_usd'], message: 'api 行不得带 plan_monthly_usd（双轨互斥——按量轨无月费）' })
  }
}

/** append 入参（record 去 version/published_at——version/published_at 归本面；id 归 daemon） */
const PriceSnapshotInputSchema = z
  .strictObject({
    id: PriceSnapshotIdSchema,
    company: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    price_date: PriceDateSchema,
    slot: z.enum(PRICE_SLOT_VALUES).default('peak'),
    /** cache-miss 输入价 $/1M（非负有限；zod v4 number 默认拒 NaN/Infinity） */
    input_per_m: z.number().nonnegative(),
    output_per_m: z.number().nonnegative(),
    /** NULL/缺=未定价（消费方按 0 计+低估标记——DEV-19；GLM cache 续采位） */
    cache_read_per_m: z.number().nonnegative().optional(),
    cache_creation_per_m: z.number().nonnegative().optional(),
    currency: z.literal('USD').default('USD'),
    billing_track: z.enum(PRICE_BILLING_TRACK_VALUES).default('api'),
    plan_monthly_usd: z.number().positive().optional(),
    /** 采价来源（官网页/账单——人读溯源） */
    source_note: z.string().min(1),
    /** 定价单据号锚（S7：快照落账带单据号锚——独立列可校可索引） */
    source_ticket: z.string().min(1),
    published_by: z.string().min(1),
  })
  .superRefine(billingTrackRefine)

/** price_snapshots 行记录（migrations v9 建列逐列对齐） */
export interface PriceSnapshotRecord {
  id: string
  company: string
  provider: string
  model: string
  price_date: string
  slot: PriceSlot
  input_per_m: number
  output_per_m: number
  cache_read_per_m?: number
  cache_creation_per_m?: number
  currency: string
  billing_track: PriceBillingTrack
  plan_monthly_usd?: number
  source_note: string
  source_ticket: string
  published_by: string
  published_at: number
  version: number
}

/** appendPriceSnapshot 结果：appended=false=单据幂等命中（同单同键全列一致，不新建行） */
export interface AppendPriceSnapshotResult {
  id: string
  version: number
  appended: boolean
}

/** listPriceSnapshots 过滤面（全可选；core 解析/桥/stale 的唯一读面） */
export interface PriceSnapshotQuery {
  company?: string
  provider?: string
  model?: string
  price_date?: string
  slot?: PriceSlot
  /** price_date <= 该日（含；解析规则的 ≤D 候选集拉取口） */
  on_or_before?: string
  source_ticket?: string
}

function rowToPriceSnapshot(row: SqlRow): PriceSnapshotRecord {
  const rec: PriceSnapshotRecord = {
    id: str(row, 'id'),
    company: str(row, 'company'),
    provider: str(row, 'provider'),
    model: str(row, 'model'),
    price_date: str(row, 'price_date'),
    slot: str(row, 'slot') as PriceSlot,
    input_per_m: Number(row['input_per_m']),
    output_per_m: Number(row['output_per_m']),
    currency: str(row, 'currency'),
    billing_track: str(row, 'billing_track') as PriceBillingTrack,
    source_note: str(row, 'source_note'),
    source_ticket: str(row, 'source_ticket'),
    published_by: str(row, 'published_by'),
    published_at: Number(row['published_at']),
    version: Number(row['version']),
  }
  const cacheRead = optNum(row, 'cache_read_per_m')
  if (cacheRead !== undefined) rec.cache_read_per_m = cacheRead
  const cacheCreation = optNum(row, 'cache_creation_per_m')
  if (cacheCreation !== undefined) rec.cache_creation_per_m = cacheCreation
  const planMonthly = optNum(row, 'plan_monthly_usd')
  if (planMonthly !== undefined) rec.plan_monthly_usd = planMonthly
  return rec
}

/** 幂等比对口径：append 入参面（id/version/published_at 外）全列一致（可选键缺=两侧同缺） */
type PriceSnapshotInputColumns = {
  [K in keyof Omit<PriceSnapshotRecord, 'id' | 'published_at' | 'version'>]:
    | Omit<PriceSnapshotRecord, 'id' | 'published_at' | 'version'>[K]
    | undefined
}

function inputColumnsOf(rec: PriceSnapshotInputColumns): Record<string, unknown> {
  return {
    company: rec.company,
    provider: rec.provider,
    model: rec.model,
    price_date: rec.price_date,
    slot: rec.slot,
    input_per_m: rec.input_per_m,
    output_per_m: rec.output_per_m,
    ...(rec.cache_read_per_m === undefined ? {} : { cache_read_per_m: rec.cache_read_per_m }),
    ...(rec.cache_creation_per_m === undefined ? {} : { cache_creation_per_m: rec.cache_creation_per_m }),
    currency: rec.currency,
    billing_track: rec.billing_track,
    ...(rec.plan_monthly_usd === undefined ? {} : { plan_monthly_usd: rec.plan_monthly_usd }),
    source_note: rec.source_note,
    source_ticket: rec.source_ticket,
    published_by: rec.published_by,
  }
}

/** v9 定价快照读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface PricingFace {
  /**
   * 追加一条定价快照（唯一写面；append-only——触发器禁 UPDATE/DELETE）。
   * version=同自然键 MAX(version)+1（首行 1）；published_at=append 时刻（调用方不供）。
   * 单据幂等：同 (company, source_ticket, provider, model, price_date, slot) 全列一致
   * → appended=false 返回既有行；不一致 → CONFIG_INVALID 拒。
   */
  appendPriceSnapshot(input: unknown): AppendPriceSnapshotResult
  /** 读面：(price_date, version) 升序；条件全可选（解析规则/桥/stale 的候选集拉取口） */
  listPriceSnapshots(query?: PriceSnapshotQuery): PriceSnapshotRecord[]
}

/** v9 面工厂（ledger.ts 摊入；db 为已迁移到 v9 的库句柄） */
export function createPricingFace(db: DatabaseSync, now: () => number): PricingFace {
  const appendPriceSnapshot = (input: unknown): AppendPriceSnapshotResult => {
    const r = assertRecord(PriceSnapshotInputSchema, input, 'store/price-snapshot:invalid')
    // 单据幂等闸（同单同模型同日同档）：全列一致=跳过（收割重放安全）；不一致=拒
    const ticketHit = db
      .prepare('SELECT * FROM price_snapshots WHERE company = ? AND source_ticket = ? AND provider = ? AND model = ? AND price_date = ? AND slot = ?')
      .get(r.company, r.source_ticket, r.provider, r.model, r.price_date, r.slot) as SqlRow | undefined
    if (ticketHit !== undefined) {
      const existing = rowToPriceSnapshot(ticketHit)
      // 幂等比对口径：入参面（id/version/published_at 外）全列一致——两侧各自投影
      // （r 侧不经 existing 补缺：可选键缺=真缺，与库行 NULL 回读的 undefined 对称）
      if (JSON.stringify(inputColumnsOf(existing)) === JSON.stringify(inputColumnsOf(r))) {
        return { id: existing.id, version: existing.version, appended: false }
      }
      configInvalid(
        'store/price-snapshot:ticket-conflict',
        `定价单 ${r.source_ticket} 对 ${r.provider}/${r.model} ${r.price_date}/${r.slot} 已有不同内容的快照行（id=${existing.id}）——同一单据同键只能有一个价`,
      )
    }
    // version 赋值：自然键 MAX(version)+1（同日修订=新行 version+1，旧行不动——F1 版本化）
    const maxRow = db
      .prepare('SELECT MAX(version) AS v FROM price_snapshots WHERE company = ? AND provider = ? AND model = ? AND price_date = ? AND slot = ?')
      .get(r.company, r.provider, r.model, r.price_date, r.slot) as { v: unknown }
    const version = (maxRow.v === null || maxRow.v === undefined ? 0 : Number(maxRow.v)) + 1
    const id = r.id
    const publishedAt = now()
    db.prepare(
      `INSERT INTO price_snapshots (
         id, company, provider, model, price_date, slot,
         input_per_m, output_per_m, cache_read_per_m, cache_creation_per_m,
         currency, billing_track, plan_monthly_usd,
         source_note, source_ticket, published_by, published_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      r.company,
      r.provider,
      r.model,
      r.price_date,
      r.slot,
      r.input_per_m,
      r.output_per_m,
      r.cache_read_per_m ?? null,
      r.cache_creation_per_m ?? null,
      r.currency,
      r.billing_track,
      r.plan_monthly_usd ?? null,
      r.source_note,
      r.source_ticket,
      r.published_by,
      publishedAt,
      version,
    )
    return { id, version, appended: true }
  }

  const listPriceSnapshots = (query: PriceSnapshotQuery = {}): PriceSnapshotRecord[] => {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.provider !== undefined) {
      where.push('provider = ?')
      params.push(query.provider)
    }
    if (query.model !== undefined) {
      where.push('model = ?')
      params.push(query.model)
    }
    if (query.price_date !== undefined) {
      where.push('price_date = ?')
      params.push(query.price_date)
    }
    if (query.slot !== undefined) {
      where.push('slot = ?')
      params.push(query.slot)
    }
    if (query.on_or_before !== undefined) {
      where.push('price_date <= ?')
      params.push(query.on_or_before)
    }
    if (query.source_ticket !== undefined) {
      where.push('source_ticket = ?')
      params.push(query.source_ticket)
    }
    const sql = `SELECT * FROM price_snapshots${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY price_date ASC, version ASC`
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToPriceSnapshot)
  }

  return { appendPriceSnapshot, listPriceSnapshots }
}
