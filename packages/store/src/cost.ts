/**
 * cost —— v12 定型账读写面+迁移条目（132-§6.3 单D·studio-dev-179；BC-S2 先拆再增：
 * 迁移条目+形状闸+读写面同文件自足——usage.ts 同款先例）
 *
 * 表 DDL 归 migrations v12（本文件 `costDailyMigration` 常量，migrations.ts 尾部摊入
 * ——migrations.ts 已近尺寸阈 600，条目体落本文件不改史不超阈）；与 usage_daily
 * （open 投影）不同，本表 **append-only 定型账**：触发器禁 UPDATE/DELETE（probes_runs
 * /price_snapshots 同型，C5），「收口即冻结，物理不改史」（票面第 3 条语义）。
 *
 * 两个写口（kind 语义）：
 *   - kind='final'：日终收口首冻行（唯一增量写面 appendCostDaily）；自然键
 *     (company, person_id, model, cost_date) partial UNIQUE（WHERE kind='final'）
 *     =幂等双保险的库侧层（S2②：重复收口=约束拒绝，不产生第二行）；store 层前置
 *     同键检查给分类错（CONFIG_INVALID 而非裸约束错）——库侧 partial UNIQUE 仍兜底
 *     直插路径（v12-cost.test 双断言）。
 *   - kind='adjustment'：定型后迟到事实补账行（S3：重建回填/数据修复）；**携 signed
 *     delta**（四桶与 cost_usd 均可为负——数据修复可减账），adjusts_id 必填且须指向
 *     同格 (company, person_id, model, cost_date) 的 final 行；多行 adjustment 同挂
 *     一 final 行允许（每批迟到事实一行）。格真值=Σ(final+adjustments)。
 *     迟到**新格**（收口时无用量、后重建补出）=补 final 行（每行首冻语义的自然延伸，
 *     申报见 daemon cost-close/close.ts 头注）——partial UNIQUE 只拒同格第二 final。
 *
 * 读面：listCostDaily（对账段/日报装配/收口工序回读）；listClosedCostDates（收口
 * 巡检的日期扫描面，DISTINCT cost_date WHERE kind='final'——有界：一日至多一行）。
 *
 * id 归 daemon（ULID，store/test/ulid.ts 口径）；closed_by=工序锚串（'cost-close:<date>'
 * /'cost-adjust:<date>'——DDL 注「tick 锚事件 id/财务岗单号」的工序锚形，事件侧
 * REPORT_COST_CLOSE note 携同一 date 锚对应）。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid, UlidSchema } from '@studio-next/contract'
import { z } from 'zod'
import { assertRecord, optStr, str, type SqlRow } from './row-helpers.ts'
import type { Migration } from './migrations.ts'

// ---------------------------------------------------------------------------
// 迁移条目 v12（migrations.ts 尾部摊入——DDL 132-§6.3 逐列照录）
// ---------------------------------------------------------------------------

export const costDailyMigration: Migration = {
  version: 12,
  name: '132-D 定型面刀：cost_daily 定型账 append-only（studio-dev-179）',
  sql: [
    'CREATE TABLE cost_daily (',
    '  id TEXT PRIMARY KEY,',
    '  company TEXT NOT NULL, person_id TEXT NOT NULL,',
    "  model TEXT NOT NULL,                -- 'provider/model' 归一形（132-A）",
    "  cost_date TEXT NOT NULL,            -- 'YYYY-MM-DD' 本地时区（R1 落账日=ended_at 归属）",
    '  tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL,',
    '  cache_read INTEGER NOT NULL, cache_creation INTEGER NOT NULL,',
    '  price_snapshot_id TEXT NOT NULL,    -- 定价锚（F5 历史账×历史价互锁；哨兵值见 face 头注）',
    '  cost_usd REAL NOT NULL,             -- 四桶×单价/1e6（foldCostUsd 同式；缺价桶按 0 计=下界）',
    "  basis TEXT NOT NULL DEFAULT 'shadow',",
    "  kind TEXT NOT NULL DEFAULT 'final',",
    '  adjusts_id TEXT,                    -- adjustment 行指向被调整 final 行 id',
    '  closed_at INTEGER NOT NULL, closed_by TEXT NOT NULL,',
    '  note TEXT',
    ');',
    "CREATE UNIQUE INDEX idx_cost_daily_final ON cost_daily(company, person_id, model, cost_date) WHERE kind='final';",
    'CREATE INDEX idx_cost_daily_date ON cost_daily(company, cost_date);',
    "CREATE TRIGGER trg_cost_daily_no_update BEFORE UPDATE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：UPDATE 被拒（不回溯改史）'); END;",
    "CREATE TRIGGER trg_cost_daily_no_delete BEFORE DELETE ON cost_daily BEGIN SELECT RAISE(ABORT, 'cost_daily 已定型 append-only：DELETE 被拒（不回溯改史）'); END;",
    '',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// 形状闸（strict：未知列拒收）
// ---------------------------------------------------------------------------

export const COST_KIND_VALUES = ['final', 'adjustment'] as const
export type CostKind = (typeof COST_KIND_VALUES)[number]

export const COST_BASIS_VALUES = ['shadow', 'native'] as const
export type CostBasis = (typeof COST_BASIS_VALUES)[number]

/** 'YYYY-MM-DD' 真日历日（usage.ts 同式；cost_date 形状闸） */
const COST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(v: string): boolean {
  if (!COST_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(y, m - 1, d)
  const back = new Date(ms)
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
}

const CostDateSchema = z.string().refine(isCalendarDate, { message: 'cost_date 形如 YYYY-MM-DD 且须为真日历日' })

/** v12 定型账行记录（migrations v12 建列逐列对齐） */
export interface CostDailyRecord {
  id: string
  company: string
  person_id: string
  model: string
  cost_date: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
  /**
   * 定价锚：常规=命中快照行 id；降级哨兵 'models-yaml:<provider>/<model>'（桥静态价
   * 收口——interlock 降级为声明面版本，DAILY_ALARM 不静默）/'unpriced'（任何 ≤D 价
   * 皆无——usd=0 下界口径收口+DAILY_ALARM）。basis 恒 'shadow'（三路皆为折算）。
   */
  price_snapshot_id: string
  cost_usd: number
  basis: CostBasis
  kind: CostKind
  adjusts_id?: string
  closed_at: number
  closed_by: string
  note?: string
}

/** 四桶（final=非负真值；adjustment=signed delta——数据修复可减账） */
const TokenCountsSchema = z.strictObject({
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cache_read: z.number().int(),
  cache_creation: z.number().int(),
})

const CostDailyAppendSchema = z.strictObject({
  id: UlidSchema,
  company: z.string().min(1),
  person_id: z.string().min(1),
  model: z.string().min(1),
  cost_date: CostDateSchema,
  tokens: TokenCountsSchema,
  price_snapshot_id: z.string().min(1),
  cost_usd: z.number().finite(),
  basis: z.enum(COST_BASIS_VALUES).default('shadow'),
  kind: z.enum(COST_KIND_VALUES).default('final'),
  adjusts_id: z.string().min(1).optional(),
  closed_at: z.number().int().nonnegative(),
  closed_by: z.string().min(1),
  note: z.string().optional(),
})

/** listCostDaily 过滤面（全可选；cost-close 工序/对账段/日报装配的读面） */
export interface CostDailyQuery {
  company?: string
  cost_date?: string
  person_id?: string
  model?: string
  kind?: CostKind
}

// ---------------------------------------------------------------------------
// 读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入）
// ---------------------------------------------------------------------------

export interface CostDailyFace {
  /**
   * 唯一增量写面（final 首冻+adjustment 补账同口，kind 区分）：
   * final → 前置同键检查（已存在=CONFIG_INVALID 分类拒——迟到事实走 adjustment），
   * 库侧 partial UNIQUE 兜底直插；adjustment → adjusts_id 须指向同格已有 final 行。
   */
  appendCostDaily(row: unknown): void
  /** 读面：(cost_date, person_id, model, id) 升序；条件全可选 */
  listCostDaily(query?: CostDailyQuery): CostDailyRecord[]
  /** 已收口日期扫描面（DISTINCT cost_date WHERE kind='final'，升序——巡检有界） */
  listClosedCostDates(company: string): string[]
}

function rowToCostDaily(row: SqlRow): CostDailyRecord {
  const rec: CostDailyRecord = {
    id: str(row, 'id'),
    company: str(row, 'company'),
    person_id: str(row, 'person_id'),
    model: str(row, 'model'),
    cost_date: str(row, 'cost_date'),
    tokens_in: Number(row['tokens_in']),
    tokens_out: Number(row['tokens_out']),
    cache_read: Number(row['cache_read']),
    cache_creation: Number(row['cache_creation']),
    price_snapshot_id: str(row, 'price_snapshot_id'),
    cost_usd: Number(row['cost_usd']),
    basis: str(row, 'basis') as CostBasis,
    kind: str(row, 'kind') as CostKind,
    closed_at: Number(row['closed_at']),
    closed_by: str(row, 'closed_by'),
  }
  const adjusts = optStr(row, 'adjusts_id')
  if (adjusts !== undefined) rec.adjusts_id = adjusts
  const note = optStr(row, 'note')
  if (note !== undefined) rec.note = note
  return rec
}

/** v12 面工厂（ledger.ts 摊入；db 为已迁移到 v12 的库句柄） */
export function createCostDailyFace(db: DatabaseSync): CostDailyFace {
  const appendCostDaily = (row: unknown): void => {
    const r = assertRecord(CostDailyAppendSchema, row, 'store/cost-daily:invalid')
    if (r.kind === 'final') {
      if (r.adjusts_id !== undefined) {
        configInvalid('store/cost-daily:invalid', 'final 行不携带 adjusts_id（指向 final 行是 adjustment 行专属）')
      }
      if (r.cost_usd < 0 || r.tokens.tokens_in < 0 || r.tokens.tokens_out < 0 || r.tokens.cache_read < 0 || r.tokens.cache_creation < 0) {
        configInvalid('store/cost-daily:invalid', 'final 行四桶与 cost_usd 须非负（首冻真值；减账走 adjustment 负 delta）')
      }
      const dup = db
        .prepare(`SELECT id FROM cost_daily WHERE company = ? AND person_id = ? AND model = ? AND cost_date = ? AND kind = 'final'`)
        .get(r.company, r.person_id, r.model, r.cost_date) as { id: unknown } | undefined
      if (dup !== undefined) {
        configInvalid(
          'store/cost-daily:final-exists',
          `重复收口被拒（${r.company} ${r.person_id} ${r.model} ${r.cost_date} 已有 final 行 ${String(dup.id)}——append-only 不改史，迟到事实走 kind='adjustment'）`,
        )
      }
    } else {
      if (r.adjusts_id === undefined) {
        configInvalid('store/cost-daily:invalid', "adjustment 行必填 adjusts_id（指向同格 final 行——S3 迟到事实挂账）")
      }
      const target = db.prepare(`SELECT company, person_id, model, cost_date, kind FROM cost_daily WHERE id = ?`).get(r.adjusts_id) as
        | { company: unknown; person_id: unknown; model: unknown; cost_date: unknown; kind: unknown }
        | undefined
      if (target === undefined || target.kind !== 'final') {
        configInvalid('store/cost-daily:invalid', `adjusts_id=${r.adjusts_id} 不指向 final 行（须为同格已首冻行）`)
      }
      if (
        String(target.company) !== r.company ||
        String(target.person_id) !== r.person_id ||
        String(target.model) !== r.model ||
        String(target.cost_date) !== r.cost_date
      ) {
        configInvalid('store/cost-daily:invalid', 'adjustment 行与 adjusts_id 目标格不一致（须同 company/person/model/cost_date）')
      }
    }
    db.prepare(
      `INSERT INTO cost_daily (
         id, company, person_id, model, cost_date,
         tokens_in, tokens_out, cache_read, cache_creation,
         price_snapshot_id, cost_usd, basis, kind, adjusts_id, closed_at, closed_by, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      r.id,
      r.company,
      r.person_id,
      r.model,
      r.cost_date,
      r.tokens.tokens_in,
      r.tokens.tokens_out,
      r.tokens.cache_read,
      r.tokens.cache_creation,
      r.price_snapshot_id,
      r.cost_usd,
      r.basis,
      r.kind,
      r.adjusts_id ?? null,
      r.closed_at,
      r.closed_by,
      r.note ?? null,
    )
  }

  const listCostDaily = (query: CostDailyQuery = {}): CostDailyRecord[] => {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.company !== undefined) {
      where.push('company = ?')
      params.push(query.company)
    }
    if (query.cost_date !== undefined) {
      where.push('cost_date = ?')
      params.push(query.cost_date)
    }
    if (query.person_id !== undefined) {
      where.push('person_id = ?')
      params.push(query.person_id)
    }
    if (query.model !== undefined) {
      where.push('model = ?')
      params.push(query.model)
    }
    if (query.kind !== undefined) {
      where.push('kind = ?')
      params.push(query.kind)
    }
    const sql = `SELECT * FROM cost_daily${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY cost_date ASC, person_id ASC, model ASC, id ASC`
    return (db.prepare(sql).all(...params) as SqlRow[]).map(rowToCostDaily)
  }

  const listClosedCostDates = (company: string): string[] => {
    if (typeof company !== 'string' || company === '') {
      configInvalid('store/cost-daily:invalid', 'listClosedCostDates 的 company 须为非空字符串')
    }
    const rows = db
      .prepare(`SELECT DISTINCT cost_date FROM cost_daily WHERE company = ? AND kind = 'final' ORDER BY cost_date ASC`)
      .all(company) as Array<{ cost_date: unknown }>
    return rows.map((row) => String(row.cost_date))
  }

  return { appendCostDaily, listCostDaily, listClosedCostDates }
}
