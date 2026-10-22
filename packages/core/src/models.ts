/**
 * models —— 模型档装载与目录（docs/25-§3.3 端口实现；依据 docs/17-§4 models.yaml）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§4：models.yaml =「模型三档 + 角色映射 + 价目表（用户可配，改动走批示）」
 *     tiers{high/mid/low{provider,model,price{}}}/roles{岗位→档}；未知顶层键拒（strict）。
 *   - docs/25-§3.3：ModelCatalog 端口——tiers()/resolve(role)/estimateCost(tokens, tier)；
 *     换模型=改配置一行，零改码；价目表改动走批示。
 *   - docs/17-§3 末：budgets 表 kind=reserve/settle/refusal——预算链的下游账目；
 *     本模块是预算/价目表链的地基（estimateCost 供 reserve 估算与 settle 对账折算）。
 *   - docs/16-§二：yaml@2 选型登记（带行号 AST）；16-§二预算节「价目表在 models.yaml，
 *     成本按每成功交付记账」。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - estimateCost 精度口径（本单冻结）：usd = input/1e6*inputPerM + output/1e6*outputPerM，
 *     IEEE-754 双精度浮点直算——不中途四舍五入、不凑整到分/微美分；显示层（panel/报表）
 *     各自取整展示，台账（budgets.estimated/actual）存原始 double。对账口径归 docs/26。
 *   - TokenCounts cache 桶（cache_read/cache_creation/兼容别名 cached，132-§6.1 单A 四桶化）
 *     暂不计价：PriceEntry 无 cache 单价键（端口未定义），扩键走批示（17-§4「价目表改动
 *     走批示」），本刀不擅自发明 cachedPerM/cacheReadPerM/cacheWritePerM——cache 价落位
 *     归 132-单B price_snapshots（快照行 cache 键）。
 *   - fingerprint 覆盖 tiers+roles 全量（语义内容指纹）：改价、改角色映射都变指纹——两者
 *     都影响成本，都该留可审计锚点；「同内容」= 键序无关（规范化后哈希）。
 *
 * 纯函数纪律（core 零 IO）：输入是 yaml 文本/内存配置，不碰文件、网络、子进程；
 * sha8 用 node:crypto（纯计算非盘 IO，同 prompt/src/layers.ts 先例）。
 * 行号定位：yaml@2 LineCounter + AST 节点 range 回爬（手法沿 company/src/validator.ts，
 * 本地复制避免 core→company 跨包依赖）。
 */
import { createHash } from 'node:crypto'
import { LineCounter, parseDocument } from 'yaml'
import { z } from 'zod'
import type { ClassifiedError, ModelCatalog, ModelTier, Money, PriceEntry, RoleName, TokenCounts } from '@studio-next/contract'

const MODELS_FILE = 'models.yaml'

/** 三档 id（docs/17-§4 冻结：恰 high/mid/low） */
export const TIER_IDS = ['high', 'mid', 'low'] as const
export type TierId = (typeof TIER_IDS)[number]

/** 档规格（yaml tiers.<id> 值形状；tier 名即键，不重复存进值） */
export interface TierSpec {
  provider: string
  model: string
  price: PriceEntry
}

/** models.yaml 装载结果（parseModelsYaml 的返回形；createModelCatalog/fingerprint 的入参） */
export interface ModelsConfig {
  tiers: { high: TierSpec; mid: TierSpec; low: TierSpec }
  /** 岗位→档（键开放：公司可扩展岗位；main_worker 必在——parse 闸保证，类型面用 string 键） */
  roles: Record<string, TierId>
}

/** 校验问题（沿 company DirectoryIssue 的「行号+规则+修法」三件套；文件名固定 models.yaml） */
export interface ModelsIssue {
  line: number
  rule: string
  fix: string
}

// ---------------------------------------------------------------------------
// zod 闸（strict：未知键拒；zod v4 z.number() 默认拒 NaN/Infinity——非负有限数由此成立）
// ---------------------------------------------------------------------------

const PriceSchema = z.strictObject({
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
})

const TierSpecSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  price: PriceSchema,
})

const ModelsConfigSchema = z.strictObject({
  // strictObject + 恰三键 = 「恰含 high/mid/low」：缺档报 missing、多档报未知键
  tiers: z.strictObject({ high: TierSpecSchema, mid: TierSpecSchema, low: TierSpecSchema }),
  roles: z.record(z.string().min(1), z.enum(TIER_IDS)),
})

// ---------------------------------------------------------------------------
// 行号定位（LineCounter 手法；与 company/src/validator.ts 同源）
// ---------------------------------------------------------------------------

type ParsedDoc = ReturnType<typeof parseDocument>
interface YamlNodeLike { range?: readonly number[] | null }

/** zod 路径 → 源行：从完整路径逐级上爬，取第一个有 range 的 AST 节点；兜底第 1 行 */
function lineOfPath(doc: ParsedDoc, lc: LineCounter, path: (string | number)[]): number {
  for (let cut = path.length; cut >= 0; cut--) {
    const node = doc.getIn(path.slice(0, cut), true)
    if (node !== null && typeof node === 'object') {
      const range = (node as YamlNodeLike).range
      if (range && range.length > 0 && range[0] !== undefined) {
        return lc.linePos(range[0]).line // linePos 返回 1 基行号（实测校准）
      }
    }
  }
  return 1
}

/**
 * zod issues → ModelsIssue[]。
 * 特判 unrecognized_keys：其 issue.path 为空、键在 issue.keys 载荷（zod v4 实测），
 * 逐键回爬取行——未知键的行号定位是本单质量要求。
 */
function zodIssuesToModelsIssues(doc: ParsedDoc, lc: LineCounter, issues: z.ZodIssue[]): ModelsIssue[] {
  const out: ModelsIssue[] = []
  for (const zi of issues) {
    const path = zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
    if (zi.code === 'unrecognized_keys') {
      for (const key of zi.keys) {
        out.push({
          line: lineOfPath(doc, lc, [...path, key]),
          rule: `models/unknown-key:${[...path, key].join('.')}`,
          fix: `未知键 ${[...path, key].join('.')}：models.yaml 不收此键（17-§4 冻结形状，strict）`,
        })
      }
      continue
    }
    out.push({
      line: lineOfPath(doc, lc, path),
      rule: `models/schema:${path.join('.') || '(root)'}`,
      fix: zi.message,
    })
  }
  return out
}

/**
 * 抛 CONFIG_INVALID（docs/25-§二 kernel.ClassifiedError 形状；subcause 非空），
 * 附加 issues 载荷（行号+规则+修法，供面板/日志结构化呈现）——同 contract configInvalid
 * 的构造手法，多挂一个结构化字段（超集不破契约，runner 宽松匹配 category/subcause）。
 */
function failModels(subcause: string, issues: ModelsIssue[]): never {
  const detail = issues.map(i => `${MODELS_FILE}:${i.line} [${i.rule}] ${i.fix}`).join('\n')
  const err = new Error(`CONFIG_INVALID/${subcause}：${detail}`) as Error & ClassifiedError & { issues: ModelsIssue[] }
  err.category = 'CONFIG_INVALID'
  err.subcause = subcause
  err.detail = detail
  err.issues = issues
  throw err
}

// ---------------------------------------------------------------------------
// 解析：parseModelsYaml
// ---------------------------------------------------------------------------

/**
 * 解析 models.yaml 文本 → ModelsConfig。
 * 两道闸：yaml 语法（LineCounter 行号）→ zod strict 形状（行号回爬）→
 * 交叉规则（roles 至少 main_worker，17-§4「roles: { main_worker: high, ... }」最小集）。
 * 任一不过即抛 CONFIG_INVALID（subcause=models/yaml-syntax | models/schema），
 * err.detail 与 err.issues 均带 yaml 行号。
 */
export function parseModelsYaml(text: string): ModelsConfig {
  const lc = new LineCounter()
  const doc = parseDocument(text, { lineCounter: lc })

  if (doc.errors.length > 0) {
    failModels('models/yaml-syntax', doc.errors.map(e => ({
      line: e.pos[0] !== undefined ? lc.linePos(e.pos[0]).line : 1,
      rule: 'models/yaml-syntax',
      fix: e.message,
    })))
  }

  const checked = ModelsConfigSchema.safeParse(doc.toJS())
  if (!checked.success) {
    failModels('models/schema', zodIssuesToModelsIssues(doc, lc, checked.error.issues))
  }

  // 交叉规则（zod 形状过关后的语义规则；zod 的 record 放行空表，main_worker 在此收口）
  if (checked.data.roles.main_worker === undefined) {
    failModels('models/schema', [{
      line: lineOfPath(doc, lc, ['roles']),
      rule: 'models/missing-main-worker',
      fix: 'roles 至少登记 main_worker（17-§4「roles: { main_worker: high, ... }」）',
    }])
  }

  return {
    tiers: {
      high: checked.data.tiers.high,
      mid: checked.data.tiers.mid,
      low: checked.data.tiers.low,
    },
    roles: { ...checked.data.roles },
  }
}

// ---------------------------------------------------------------------------
// 目录：createModelCatalog（docs/25-§3.3 ModelCatalog 实现）
// ---------------------------------------------------------------------------

/** 编辑距离（Levenshtein 动态规划；角色名短串专用，供「最近似角色」提示） */
function editDistance(a: string, b: string): number {
  const n = b.length
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = new Array<number>(n + 1).fill(0)
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const up = prev[j] ?? 0
      const left = curr[j - 1] ?? 0
      const diag = prev[j - 1] ?? 0
      curr[j] = Math.min(up + 1, left + 1, diag + cost)
    }
    prev = curr
  }
  return prev[n] ?? 0
}

/** 最近似角色名：编辑距离最小；并列取字典序最小（确定性）；空表返回 null */
function nearestRole(role: string, known: string[]): string | null {
  if (known.length === 0) return null
  const sorted = [...known].sort()
  let best: string = sorted[0] ?? ''
  let bestDist = editDistance(role, best)
  for (const cand of sorted.slice(1)) {
    const d = editDistance(role, cand)
    if (d < bestDist) { best = cand; bestDist = d }
  }
  return best
}

function snapshotTier(t: ModelTier): ModelTier {
  return { tier: t.tier, provider: t.provider, model: t.model, price: { ...t.price } }
}

/**
 * 构造目录（tiers()/resolve/estimateCost）。
 * resolve 未登记角色 → CONFIG_INVALID 明报（subcause=models/role-unregistered）+ 最近似角色提示；
 * estimateCost 未知档 → CONFIG_INVALID；tiers()/resolve 返回副本（调用方改不动内部）。
 * 防御：手构 config 缺档时不炸构造——首次触达该档才明报（parse 产物必全三档）。
 */
export function createModelCatalog(config: ModelsConfig): ModelCatalog {
  const tiers: ModelTier[] = TIER_IDS
    .filter(id => config.tiers[id] !== undefined)
    .map(id => ({ tier: id, ...config.tiers[id] }))
  const byTier = new Map(tiers.map(t => [t.tier, t]))
  const roleNames = Object.keys(config.roles)

  return {
    tiers: () => tiers.map(snapshotTier),

    resolve(role: RoleName): ModelTier {
      const tierId = config.roles[role]
      if (tierId === undefined) {
        const nearest = nearestRole(role, roleNames)
        const hint = nearest === null ? 'roles 表为空（配置不完整）' : `最近似角色：${nearest}`
        const err = new Error(
          `角色 ${role} 未在 models.yaml roles 登记（${hint}；已登记：${[...roleNames].sort().join('/') || '无'}）`,
        ) as Error & ClassifiedError
        err.category = 'CONFIG_INVALID'
        err.subcause = 'models/role-unregistered'
        err.detail = hint
        throw err
      }
      const t = byTier.get(tierId)
      if (t === undefined) {
        failModels('models/tier-missing', [{
          line: 1,
          rule: `models/tier-missing:${tierId}`,
          fix: `roles.${role} 指向 ${tierId} 档，但 tiers 未提供该档（手构配置不完整）`,
        }])
      }
      return snapshotTier(t)
    },

    estimateCost(tokens: TokenCounts, tier: ModelTier['tier']): Money {
      const t = byTier.get(tier)
      if (t === undefined) {
        failModels('models/tier-unknown', [{
          line: 1,
          rule: `models/tier-unknown:${String(tier)}`,
          fix: `未知模型档 ${String(tier)}：三档仅 high/mid/low（17-§4）`,
        }])
      }
      // 精度口径（本单冻结）：双精度直算不凑整；cached 桶不计价（见文件头注）
      return { usd: (tokens.input / 1e6) * t.price.inputPerM + (tokens.output / 1e6) * t.price.outputPerM }
    },
  }
}

// ---------------------------------------------------------------------------
// 指纹：fingerprint（价目表变更防护的可审计锚点）
// ---------------------------------------------------------------------------

/** 递归规范化：对象键排序、弃 undefined 键——键序/注释/空白无关，内容唯一决定指纹 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonicalize(x)]),
    )
  }
  return v
}

/**
 * 内容指纹 sha8（sha256 前 8 位十六进制，同 prompt/src/layers.ts 的 rev 口径）。
 * 用途：daemon 启动时把指纹记台账（落点归 daemon 单：models.yaml 重载/变更事件的锚）——
 * 「价目表改动走批示」（17-§4）的可审计凭据：同内容同指纹、改价/改角色映射变指纹。
 */
export function fingerprint(config: ModelsConfig): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(config)), 'utf8').digest('hex').slice(0, 8)
}
