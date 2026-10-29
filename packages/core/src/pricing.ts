/**
 * pricing —— 定价面纯逻辑（132-§6.2 单B·studio-dev-169；docs/17-§4 models.yaml 桥）
 *
 * 定位：price_snapshots（store v9）与定价更新单附件（deliverables/pricing.yaml，
 * HF-1 每晨发布——P5 批示）之间的**纯函数域**：解析附件→校验覆盖→解析规则（取价）
 * →四桶折算→stale 报告→models.yaml 桥。零 IO（core 纪律）：输入是文本/行数组/声明面，
 * 不碰文件、网络、子进程——文件读取归 daemon 消费面（engine/pricing/）。
 *
 * 规格依据（实现单引用）：
 *   - 132-§6.2 单B：发布表 ⊇ models.yaml 三档（缺档拒收）；解析=日期 D 取
 *     price_date=D 最高 version 行，缺 D 沿用最近 ≤D 快照+stale_days 计数；连续 2 日
 *     stale→DAILY_ALARM；估值桥=当日快照优先、缺则 models.yaml 静态价兜底。
 *   - 132-§5-F1（OpenMeter 版本化价目卡）：同日修订=version+1 新行，旧行不动。
 *   - 132-§5-F5（Zuora 生效期定价）：未来日期行到日自然生效——carry 只取 <D，预发布
 *     价不提前生效。
 *   - DEV-19（studio-dev-34 影子价法）：coding_plan 边际 $0 仍记四单价（跨模型可比）；
 *     缺价期按 0 计+低估标记（unpricedBuckets——NULL=未定价，非零价）。
 *   - 132-A（studio-dev-168）：TokenCounts 四桶（cache_read/cache_creation，兼容读别名
 *     cached）；BILLING_TRACKS=['api','coding_plan'] 预设词表（本刀消费落位：coding_plan
 *     ⇒ planMonthlyUsd 必填=摊销轨锚——制作人 2026-10-22 补充令「包月 plan 摊销口径
 *     双轨入定价面」）。
 *   - docs/v2/13 §2.3/§八-5＋docs/v2/17 §4.4 NEG-ENG-02（YAML bomb 防线）：解析入口先过
 *     yaml.ts 上限件（源规模→AST 深度/节点数/别名数→toJS 显式 maxAliasCount）；超限＝
 *     CONFIG_INVALID/`pricing/yaml-limit:<kind>` 明确拒收，不截断不静默降级。
 *
 * 词表源位：PRICE_SLOT_VALUES（peak/offpeak——峰谷档，132-§6.2 DeepSeek 四维价）本模块
 * 冻结为唯一源；store/src/pricing.ts 复制+一致性测试钉死（CANDIDATE_STATUS_VALUES
 * 先例——store 值域不跨包运行时依赖）。BILLING_TRACKS 归 contract（132-A 词表源）。
 *
 * 精度口径（estimateCost 同款冻结）：IEEE-754 直算不中途四舍五入；显示层各自取整。
 */
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import { configInvalid, BILLING_TRACKS, type ClassifiedError, type ModelTier, type TokenCounts } from '@studio-next/contract'
import {
  checkYamlDocument,
  checkYamlSource,
  describeYamlLimit,
  toJsWithinLimits,
  type YamlLimitViolation,
} from './yaml.ts'

/** 峰谷档值域（132-§6.2 slot 键；缺省 peak 保守——非峰时段用峰价=高估不低估） */
export const PRICE_SLOT_VALUES = ['peak', 'offpeak'] as const
export type PriceSlot = (typeof PRICE_SLOT_VALUES)[number]

/** stale 告警阈（132-§6.2：连续 2 日 stale→DAILY_ALARM；staleDays≥2 即连续两晨未更） */
export const PRICING_STALE_ALARM_DAYS = 2

/** 附件名（daemon 消费面读 <workspace>/deliverables/pricing.yaml——本模块只管文本） */
export const PRICING_DELIVERABLE = 'pricing.yaml'

/** 声明面最小形（models.yaml 三档/catalog.tiers() 的投影——桥与校验的入参） */
export interface DeclaredModel {
  provider: string
  model: string
}

/** 单价四元组（$/1M；cache 两键缺=未定价——按 0 计+低估标记，DEV-19） */
export interface UnitPrice {
  inputPerM: number
  outputPerM: number
  cacheReadPerM?: number | undefined
  cacheCreationPerM?: number | undefined
}

/** 附件 models[] 单项（双轨：billingTrack+planMonthlyUsd——补充令结构） */
export interface PricingModelEntry {
  provider: string
  model: string
  billingTrack: (typeof BILLING_TRACKS)[number]
  /** coding_plan 必填（当月订阅费 USD，摊销轨锚）；api 不带 */
  planMonthlyUsd?: number | undefined
  prices: Array<UnitPrice & { slot: PriceSlot }>
}

/** 附件顶层形状（parsePricingTable 产物；store 入参由 daemon 消费面展开） */
export interface PricingTable {
  priceDate: string
  sourceNote: string
  models: PricingModelEntry[]
}

// ---------------------------------------------------------------------------
// zod 闸（strict：未知键拒；zod v4 z.number() 默认拒 NaN/Infinity）
// ---------------------------------------------------------------------------

const PriceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'priceDate 形如 YYYY-MM-DD').refine(
  (v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number]
    const back = new Date(Date.UTC(y, m - 1, d))
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
  },
  { message: 'priceDate 须为真日历日（如 2026-02-30 拒收）' },
)

const SlotPriceSchema = z.strictObject({
  slot: z.enum(PRICE_SLOT_VALUES).default('peak'),
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
  cacheReadPerM: z.number().nonnegative().optional(),
  cacheCreationPerM: z.number().nonnegative().optional(),
})

const ModelEntrySchema = z
  .strictObject({
    provider: z.string().min(1),
    model: z.string().min(1),
    billingTrack: z.enum(BILLING_TRACKS).default('api'),
    planMonthlyUsd: z.number().positive().optional(),
    prices: z.array(SlotPriceSchema).min(1),
  })
  .superRefine((r, ctx) => {
    if (r.billingTrack === 'coding_plan' && (r.planMonthlyUsd === undefined || r.planMonthlyUsd <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['planMonthlyUsd'], message: 'coding_plan 行必填 planMonthlyUsd（当月订阅费 USD 正数——摊销轨锚，制作人补充令）' })
    }
    if (r.billingTrack === 'api' && r.planMonthlyUsd !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['planMonthlyUsd'], message: 'api 行不得带 planMonthlyUsd（双轨互斥）' })
    }
    const seen = new Set<string>()
    for (const [i, p] of r.prices.entries()) {
      if (seen.has(p.slot)) {
        ctx.addIssue({ code: 'custom', path: ['prices', i, 'slot'], message: `重复 slot=${p.slot}（同模内每档至多一行——歧义拒收）` })
      }
      seen.add(p.slot)
    }
  })

const PricingTableSchema = z
  .strictObject({
    priceDate: PriceDateSchema,
    sourceNote: z.string().min(1),
    models: z.array(ModelEntrySchema).min(1),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>()
    for (const [i, m] of r.models.entries()) {
      const key = `${m.provider}/${m.model}`
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['models', i, 'model'], message: `重复模型 ${key}（同附件每模型至多一项——歧义拒收）` })
      }
      seen.add(key)
    }
  })

// ---------------------------------------------------------------------------
// 行号定位（LineCounter 手法；models.ts / company validator.ts 同源）
// ---------------------------------------------------------------------------

type ParsedDoc = ReturnType<typeof parseDocument>
interface YamlNodeLike { range?: readonly number[] | null }

function lineOfPath(doc: ParsedDoc, lc: LineCounter, path: (string | number)[]): number {
  for (let cut = path.length; cut >= 0; cut--) {
    const node = doc.getIn(path.slice(0, cut), true)
    if (node !== null && typeof node === 'object') {
      const range = (node as YamlNodeLike).range
      if (range && range.length > 0 && range[0] !== undefined) {
        return lc.linePos(range[0]).line
      }
    }
  }
  return 1
}

/** 校验问题三件套（沿 ModelsIssue 形状；文件名固定 pricing.yaml——附件语境） */
export interface PricingIssue {
  line: number
  rule: string
  fix: string
}

function zodIssuesToPricingIssues(doc: ParsedDoc, lc: LineCounter, issues: z.ZodIssue[]): PricingIssue[] {
  const out: PricingIssue[] = []
  for (const zi of issues) {
    const path = zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
    if (zi.code === 'unrecognized_keys') {
      for (const key of zi.keys) {
        out.push({
          line: lineOfPath(doc, lc, [...path, key]),
          rule: `pricing/unknown-key:${[...path, key].join('.')}`,
          fix: `未知键 ${[...path, key].join('.')}：${PRICING_DELIVERABLE} 不收此键（132-§6.2 冻结形状，strict）`,
        })
      }
      continue
    }
    out.push({
      line: lineOfPath(doc, lc, path),
      rule: `pricing/schema:${path.join('.') || '(root)'}`,
      fix: zi.message,
    })
  }
  return out
}

/** 抛 CONFIG_INVALID（ModelsIssue 同手法：category/subcause+issues 结构化载荷） */
function failPricing(subcause: string, issues: PricingIssue[]): never {
  const detail = issues.map(i => `${PRICING_DELIVERABLE}:${i.line} [${i.rule}] ${i.fix}`).join('\n')
  const err = new Error(`CONFIG_INVALID/${subcause}：${detail}`) as Error & ClassifiedError & { issues: PricingIssue[] }
  err.category = 'CONFIG_INVALID'
  err.subcause = subcause
  err.detail = detail
  err.issues = issues
  throw err
}

// ---------------------------------------------------------------------------
// 解析与校验
// ---------------------------------------------------------------------------

/** 上限违规 → 行号化 issue（行号取违规节点 range；源文本超限无节点可指=line 1） */
function yamlLimitIssue(lc: LineCounter | undefined, violation: YamlLimitViolation): PricingIssue {
  const offset = violation.offset
  return {
    line: lc !== undefined && offset !== undefined ? lc.linePos(offset).line : 1,
    rule: `pricing/yaml-limit:${violation.kind}`,
    fix: `${describeYamlLimit(violation)}——NEG-ENG-02 上限拒收（docs/v2/13 §八-5；不截断、不静默降级）`,
  }
}

/**
 * 解析定价更新单附件文本 → PricingTable。
 * 三道闸：yaml 资源上限（yaml.ts——源规模/AST 深度/节点数/别名数/展开计数）→ yaml 语法
 * （行号）→ zod strict 形状（行号回爬+交叉规则：重复模型/重复 slot/双轨互斥/真日历日）。
 * 坏件抛 CONFIG_INVALID（'pricing/parse'）；超上限抛 CONFIG_INVALID（'pricing/yaml-limit'，
 * NEG-ENG-02——明确拒收，不截断不静默降级）——daemon 消费面转 DAILY_ALARM（发布失败不静默）。
 */
export function parsePricingTable(text: string): PricingTable {
  // 上限①源文本规模：parse 之前拒（不为超长输入分配 AST）
  const sourceViolation = checkYamlSource(text)
  if (sourceViolation !== undefined) {
    failPricing('pricing/yaml-limit', [yamlLimitIssue(undefined, sourceViolation)])
  }
  const lc = new LineCounter()
  const doc = parseDocument(text, { lineCounter: lc })
  if (doc.errors.length > 0) {
    failPricing('pricing/yaml-syntax', doc.errors.map(e => ({
      line: e.pos[0] !== undefined ? lc.linePos(e.pos[0]).line : 1,
      rule: 'pricing/yaml-syntax',
      fix: e.message,
    })))
  }
  // 上限②AST 深度/节点数/别名节点数：toJS 之前拒（不展开别名）
  const documentViolation = checkYamlDocument(doc.contents)
  if (documentViolation !== undefined) {
    failPricing('pricing/yaml-limit', [yamlLimitIssue(lc, documentViolation)])
  }
  // 上限③别名展开计数（库计 maxAliasCount）；库的其它 toJS 报错归语法错（不裸奔）
  const read = toJsWithinLimits(doc)
  if (!read.ok) {
    if (read.reason === 'alias-limit') failPricing('pricing/yaml-limit', [yamlLimitIssue(lc, read.violation)])
    failPricing('pricing/yaml-syntax', [{ line: 1, rule: 'pricing/yaml-syntax', fix: read.message }])
  }
  const checked = PricingTableSchema.safeParse(read.value)
  if (!checked.success) {
    failPricing('pricing/parse', zodIssuesToPricingIssues(doc, lc, checked.error.issues))
  }
  return checked.data
}

/**
 * 覆盖校验（132-§6.2：发布表 ⊇ models.yaml 三档声明面）——缺档整表拒收
 * （晨间发布必须完整：半表入账=低估定时炸弹）。超额模型放行（「⊇」语义：快照面
 * 可记声明面外模型——公司目录扩展先于 models.yaml 改档的过渡态合法）。
 * declared 缺席（daemon 无 models.yaml，态 B）→ 跳过覆盖校验（形状闸已在 parse 把关；
 * 如实降级归 daemon 侧 note——core 不猜部署形态）。
 */
export function validatePricingTable(table: PricingTable, declared: readonly DeclaredModel[] | undefined): void {
  if (declared === undefined || declared.length === 0) return
  const have = new Set(table.models.map(m => `${m.provider}/${m.model}`))
  const missing = declared.filter(d => !have.has(`${d.provider}/${d.model}`))
  if (missing.length > 0) {
    configInvalid(
      'pricing/coverage',
      `发布表缺 models.yaml 声明模型：${missing.map(d => `${d.provider}/${d.model}`).join('、')}（132-§6.2 全覆盖校验——晨间发布必须完整）`,
    )
  }
}

// ---------------------------------------------------------------------------
// 解析规则（取价）——132-§6.2 直译
// ---------------------------------------------------------------------------

/** 快照行最小形（store PriceSnapshotRecord 的投影；测试可直接造字面量） */
export interface PriceSnapshotLike {
  provider: string
  model: string
  price_date: string
  slot: string
  version: number
  input_per_m: number
  output_per_m: number
  cache_read_per_m?: number | undefined
  cache_creation_per_m?: number | undefined
  billing_track: string
  plan_monthly_usd?: number | undefined
  id?: string | undefined
}

/** 解析结果：exact=当日快照（staleDays=0）；carry=沿用最近（staleDays=D−price_date） */
export interface ResolvedSnapshotPrice {
  source: 'snapshot'
  exact: boolean
  /** 命中快照行 id（无 id 输入=undefined——投影形允许） */
  snapshotId?: string | undefined
  priceDate: string
  staleDays: number
  billingTrack: string
  planMonthlyUsd?: number | undefined
  unit: UnitPrice
}

/** 'YYYY-MM-DD' → UTC epoch ms（纯日串无时区面；月参数 1 基转 0 基） */
function utcOfDateStr(v: string): number {
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

/** 'YYYY-MM-DD' 差值（日数；输入非日形=NaN 如实透出——调用方 parse 已闸） */
export function priceDateDiff(from: string, to: string): number {
  return Math.round((utcOfDateStr(to) - utcOfDateStr(from)) / 86_400_000)
}

/**
 * 取价：provider/model/slot 于日期 D——
 *   exact：price_date=D 的最高 version 行（F1 同日修订，取最新）；
 *   carry：无 D 行时最近 price_date<D 行（price_date 最大，再 version 最大；未来行
 *   不参与——F5 生效期语义），staleDays=D−price_date；
 *   无任何 ≤D 行：undefined（从未定价）。
 */
export function resolveSnapshotPrice(
  rows: readonly PriceSnapshotLike[],
  key: { provider: string; model: string; date: string; slot?: PriceSlot },
): ResolvedSnapshotPrice | undefined {
  const slot = key.slot ?? 'peak'
  const of = rows.filter(r => r.provider === key.provider && r.model === key.model && r.slot === slot)
  const latestOf = (candidates: PriceSnapshotLike[]): PriceSnapshotLike | undefined =>
    candidates.reduce<PriceSnapshotLike | undefined>((best, r) => {
      if (best === undefined) return r
      if (r.price_date !== best.price_date) return r.price_date > best.price_date ? r : best
      return r.version > best.version ? r : best
    }, undefined)
  const exactRow = latestOf(of.filter(r => r.price_date === key.date))
  const row = exactRow ?? latestOf(of.filter(r => r.price_date < key.date))
  if (row === undefined) return undefined
  return {
    source: 'snapshot',
    exact: exactRow !== undefined,
    snapshotId: row.id,
    priceDate: row.price_date,
    staleDays: exactRow !== undefined ? 0 : Math.max(priceDateDiff(row.price_date, key.date), 0),
    billingTrack: row.billing_track,
    planMonthlyUsd: row.plan_monthly_usd,
    unit: {
      inputPerM: row.input_per_m,
      outputPerM: row.output_per_m,
      cacheReadPerM: row.cache_read_per_m,
      cacheCreationPerM: row.cache_creation_per_m,
    },
  }
}

// ---------------------------------------------------------------------------
// 四桶折算（132-A TokenCounts 消费面；缺价按 0 计+低估标记——DEV-19）
// ---------------------------------------------------------------------------

/** 有用量而无单价的桶（低估标记——报表/对账面「下界口径」注脚的机械源） */
export type UnpricedBucket = 'cache_read' | 'cache_creation'

export interface FoldCostResult {
  usd: number
  unpricedBuckets: UnpricedBucket[]
}

/** 四桶兼容读（132-A：cache_read ?? cached——旧账键；写侧一律新键） */
function cacheReadTokens(tokens: TokenCounts): number {
  return tokens.cache_read ?? tokens.cached ?? 0
}

/**
 * 四桶折算：usd = Σ桶用量/1e6×单价（IEEE-754 直算）；cache 桶缺价（unit 键缺）按 0
 * 计入 usd 且登记 unpricedBuckets（=下界值——真值未知但 ≥此值；显示层注「低估」）。
 */
export function foldCostUsd(tokens: TokenCounts, unit: UnitPrice): FoldCostResult {
  const usd =
    (tokens.input / 1e6) * unit.inputPerM +
    (tokens.output / 1e6) * unit.outputPerM +
    (cacheReadTokens(tokens) / 1e6) * (unit.cacheReadPerM ?? 0) +
    ((tokens.cache_creation ?? 0) / 1e6) * (unit.cacheCreationPerM ?? 0)
  const unpricedBuckets: UnpricedBucket[] = []
  if (cacheReadTokens(tokens) > 0 && unit.cacheReadPerM === undefined) unpricedBuckets.push('cache_read')
  if ((tokens.cache_creation ?? 0) > 0 && unit.cacheCreationPerM === undefined) unpricedBuckets.push('cache_creation')
  return { usd, unpricedBuckets }
}

// ---------------------------------------------------------------------------
// stale 报告（P5 每晨必更的守夜面）
// ---------------------------------------------------------------------------

export interface PricingStaleEntry {
  provider: string
  model: string
  /** 声明面（models.yaml 三档）内=true；快照在册超额模型=false */
  declared: boolean
  /** 最近一次 ≤D 发布日；undefined=从未定价（比 stale 更严重——连沿用都无） */
  latestDate?: string | undefined
  /** D−latestDate（0=今晨已更）；undefined=从未定价 */
  staleDays?: number | undefined
  /** staleDays≥PRICING_STALE_ALARM_DAYS 或从未定价 */
  alarm: boolean
}

/**
 * stale 报告：模型集=声明面 ∪ 快照在册（凡在册皆有消费面——超额模型漏更同样低估）。
 * alarm=连续 PRICING_STALE_ALARM_DAYS 日无当日快照（沿用已达 2 日）或从未定价。
 */
export function pricingStaleReport(
  rows: readonly PriceSnapshotLike[],
  declared: readonly DeclaredModel[] | undefined,
  date: string,
): PricingStaleEntry[] {
  const declaredKeys = new Set((declared ?? []).map(d => `${d.provider}/${d.model}`))
  const keys = new Set<string>(declaredKeys)
  for (const r of rows) keys.add(`${r.provider}/${r.model}`)
  return [...keys].sort().map(key => {
    const [provider, model] = key.split('/') as [string, string]
    const latest = rows
      .filter(r => r.provider === provider && r.model === model && r.price_date <= date)
      .reduce<PriceSnapshotLike | undefined>((best, r) => {
        if (best === undefined) return r
        if (r.price_date !== best.price_date) return r.price_date > best.price_date ? r : best
        return r.version > best.version ? r : best
      }, undefined)
    const staleDays = latest === undefined ? undefined : priceDateDiff(latest.price_date, date)
    return {
      provider,
      model,
      declared: declaredKeys.has(key),
      latestDate: latest?.price_date,
      staleDays,
      alarm: staleDays === undefined || staleDays >= PRICING_STALE_ALARM_DAYS,
    }
  })
}

// ---------------------------------------------------------------------------
// models.yaml 桥（快照优先，静态价兜底——单C/D 折算的单一入口）
// ---------------------------------------------------------------------------

export type BridgedPrice =
  | (ResolvedSnapshotPrice & { source: 'snapshot' })
  | { source: 'models-yaml'; unit: UnitPrice }

/**
 * 桥：当日（或沿用）快照优先；无快照而 provider/model 命中三档 → models.yaml 静态价
 * （PriceEntry 两键——cache 无价=低估标记面，17-§4「价目表改动走批示」的兜底位）；
 * 都不中=undefined（未声明未定价——调用方如实上报，不猜价）。
 */
export function bridgePriceFor(
  rows: readonly PriceSnapshotLike[],
  tiers: readonly ModelTier[],
  key: { provider: string; model: string; date: string; slot?: PriceSlot },
): BridgedPrice | undefined {
  const snap = resolveSnapshotPrice(rows, key)
  if (snap !== undefined) return snap
  const tier = tiers.find(t => t.provider === key.provider && t.model === key.model)
  if (tier !== undefined) {
    return { source: 'models-yaml', unit: { inputPerM: tier.price.inputPerM, outputPerM: tier.price.outputPerM } }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 模型归一键（work_records.model 桥接——132-A 归一形 provider/model）
// ---------------------------------------------------------------------------

/** 归一：'provider/model'（如 deepseek/deepseek-flash；132-A ResultStats.model 同形） */
export function normalizeModelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** 逆归一：首 '/' 切分（model 名可含 '/'？——供应商惯例不含；含即取首段后全部为 model） */
export function parseModelKey(key: string): { provider: string; model: string } | undefined {
  const i = key.indexOf('/')
  if (i <= 0 || i >= key.length - 1) return undefined
  return { provider: key.slice(0, i), model: key.slice(i + 1) }
}
