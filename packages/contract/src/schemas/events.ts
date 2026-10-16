/**
 * events 台账记录 schema（docs/17-§3 数据模型·冻结 v1；docs/02 F2-02/F2-04）
 *
 * 事实源口径：events 表本库 append-only，daemon 唯一写入者（17-§3 表「权威源」列）。
 * 本 schema 是**记录级**契约：入库前 / 回填（F2-13）/ JSONL 再生（F2-11）逐条校验的标尺。
 *
 * 依据与拟稿说明（docs 未覆盖处逐条标「拟稿待批」）：
 *   - 列集 = 17-§3 events 表关键列（id/ts/company/issue/event/actor/attempt/level/dept/
 *     correlation_id?/causation_id?/tokens/cost_usd?/duration_ms?/size?/payload_hash?/note?）。
 *     注：F2-02 另列 `pid`（进程号）而 17-§3 表无此列——两文档口径不一，本 schema 从 17-§3，疑点已上报。
 *   - 事件名 = 17-§3 冻结清单：23 个具体名 + `GW_*`/`REPORT_*` 两个前缀族 = 25 类
 *     （与 F2-02「25 类事件枚举」互证）。前缀族走「枚举 ∪ 前缀正则」双通道。
 *   - tokens 四桶 = F2-04 冻结列名 input/output/cache_read/cache_creation（互斥桶，
 *     至少其一出现）。kernel.TokenCounts 是 executor 归一化层的三字段口径，不用于台账。
 *   - 拟稿待批（docs 未细化）：attempt 最小值取 1（首次尝试=1）；level 取 1..9
 *     （04-§四：agent 等级 1-9、公司 2-9 级，两口径都落此界内）；actor 为非空串
 *     （「工号+账号」具体编码归 store 层定）；correlation_id/causation_id 暂不锁 ULID
 *     （相关性键可能跨系统，先只约束非空）。
 */
import { z } from 'zod'
import { configInvalid } from './errors.ts'

/** 校验结论的失败条目（path 为字段路径或节名；message 为人话修法提示） */
export interface ValidationIssue {
  path: string
  message: string
}

/** 记录级校验结果：合法即 {ok:true}，不合法带 issues（不抛错，纯数据判定） */
export type ValidationOutcome = { ok: true } | { ok: false; issues: ValidationIssue[] }

// —— ULID（附录：ULID 规范——26 字符 Crockford Base32，128bit）——

/** Crockford Base32 字母表（剔除 I/L/O/U 防歧义），大写规范形 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * ULID 格式（canonical）：
 *   - 恰 26 字符、Crockford Base32 大写；
 *   - 首字符 ∈ '0'..'7'：时间戳 48bit（≤ 281474976710655，即公元 8921 年内）的数学推论。
 */
export const UlidSchema = z
  .string()
  .regex(ULID_PATTERN, 'ULID 须为 26 字符 Crockford Base32 大写（不含 I/L/O/U）')
  .refine((v) => v.charAt(0) <= '7', { message: "ULID 首字符须 ∈ '0'..'7'（48bit 时间戳上限的推论）" })

// —— 事件名：冻结枚举 + 前缀族双通道（17-§3）——

/** 23 个具体事件名（17-§3 冻结清单，序即文档序） */
export const EVENT_NAMES = [
  'DISPATCH',
  'GATE_PASS',
  'GATE_FAIL',
  'QA_PASS',
  'QA_BACK',
  'MERGE',
  'CLOSE',
  'STALL',
  'QUARANTINE',
  'APPROVE',
  'ESCALATE',
  'LLM',
  'SELF_EVAL',
  'POSTMORTEM',
  'PATROL',
  'ORG_UPGRADE',
  'KB_UPDATE',
  'SCHEMA_EVOLVE',
  'DAILY_ALARM',
  'HEARTBEAT',
  'CIRCUIT_BREAK',
  'RESUME',
  'INVOKE_EXTERNAL',
] as const

/** 前缀族：网关动作 / 报表产物（17-§3 以 `GW_*`/`REPORT_*` 记） */
export const EVENT_PREFIX_FAMILIES = ['GW_', 'REPORT_'] as const

/**
 * 前缀族正则：`GW_`/`REPORT_` 后接至少一个大写字母数字段（可下划线续段，如 GW_KB_SEARCH）。
 * 仅大写：台账事件名全大写（17-§3 清单如此），小写视作未知类型拒收（F2-02 验收口径）。
 */
export const EVENT_NAME_PREFIX_PATTERN = /^(?:GW|REPORT)_[A-Z0-9]+(?:_[A-Z0-9]+)*$/

/** 双通道事件名：冻结枚举 ∪ 前缀族正则 */
export const EventNameSchema = z.union([
  z.enum(EVENT_NAMES),
  z.string().regex(EVENT_NAME_PREFIX_PATTERN, '前缀族事件名形如 GW_XXX / REPORT_XXX（全大写）'),
])

/** 事件名判定（给 daemon/store 层的轻量入口） */
export function isEventName(v: string): boolean {
  return EventNameSchema.safeParse(v).success
}

// —— tokens 四桶（F2-04 冻结列名）——

/**
 * 互斥 token 四桶：input / output / cache_read / cache_creation（F2-04 原文列名）。
 * 至少其一出现：空对象视为「无计量」拒收（拟稿口径——无计量事件如 HEARTBEAT 由写入方
 * 显式给零值桶，如 {input:0}，保证「有 usage 零成本」体检可查）。
 * strict：未知桶名（含未来新增计费维度）拒收——加桶走 SCHEMA_EVOLVE，不静默吞。
 */
export const TokenBucketsSchema = z
  .strictObject({
    input: z.number().int().min(0).optional(),
    output: z.number().int().min(0).optional(),
    cache_read: z.number().int().min(0).optional(),
    cache_creation: z.number().int().min(0).optional(),
  })
  .refine((buckets) => Object.keys(buckets).length > 0, {
    message: 'tokens 四桶（input/output/cache_read/cache_creation）至少其一（F2-04）',
  })

// —— events 记录本体（17-§3 列集）——

/** strict：未知列拒收——台账列集冻结，加列走批示+SCHEMA_EVOLVE（F2-02「未知类型拒收」同精神） */
export const EventRecordSchema = z.strictObject({
  /** ULID（daemon 单写入者，顺序保证来自单写入而非库层，17-§3/F2-02 设计判断） */
  id: UlidSchema,
  /** epoch 毫秒（F2-02 ts；ULID 自身嵌时间戳，id↔ts 一致性交叉校验归 store 层，此处不重复） */
  ts: z.number().int().min(0),
  /** 公司 slug（目录路由键，同 kernel.CompanySlug） */
  company: z.string().min(1),
  /** 平台侧单号（kernel.TicketId；17-§3 列集未标可选，全事件必填——零活动日事件挂哨兵单号，拟稿待批） */
  issue: z.string().min(1),
  /** 事件名：冻结枚举+前缀族双通道 */
  event: EventNameSchema,
  /** 17-§3「actor(工号+账号)」：具体编码归 store 层，此处约束非空 */
  actor: z.string().min(1),
  /** 第几次尝试（指纹 t.<单号>.<att>；拟稿：首次=1，最小 1） */
  attempt: z.number().int().min(1),
  /** 等级（04-§四：agent 1-9 / 公司 2-9，两口径都在 1..9） */
  level: z.number().int().min(1).max(9),
  /** 部门 path（同公司目录 departments[].path 键形） */
  dept: z.string().min(1),
  /** 相关性 id（同一逻辑链横向关联；暂不锁 ULID——跨系统键，疑点已上报） */
  correlation_id: z.string().min(1).optional(),
  /** 因果 id（本事件由哪条事件引起，纵向链；同上暂不锁 ULID） */
  causation_id: z.string().min(1).optional(),
  /** 四桶互斥，至少其一（F2-04） */
  tokens: TokenBucketsSchema,
  /** 折算成本（美元微账，价目表折算；zod v4 z.number() 默认拒 Infinity） */
  cost_usd: z.number().min(0).optional(),
  duration_ms: z.number().int().min(0).optional(),
  /** payload 字节数（结果体分离：库内只存 size+hash+路径引用，F2-03） */
  size: z.number().int().min(0).optional(),
  /** 哈希引用（算法前缀形如 sha256:… 或裸 hex 均可——口径归 store 层，先只约束非空） */
  payload_hash: z.string().min(1).optional(),
  note: z.string().optional(),
})

export type EventRecord = z.infer<typeof EventRecordSchema>

/** zod issues → ValidationIssue[]（path 展平为点分字符串） */
function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((zi) => ({
    path: zi.path.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number').join('.') || '(root)',
    message: zi.message,
  }))
}

/**
 * 事件记录校验（evt 域的数据层入口）：合法 {ok:true}；不合法 {ok:false, issues}（不抛错）。
 * subcause 语义化规则：首个 issue 的 path 决定（如 evt/invalid:id、evt/invalid:event、evt/invalid:tokens）。
 */
export function validateEventRecord(v: unknown): ValidationOutcome {
  const parsed = EventRecordSchema.safeParse(v)
  if (parsed.success) return { ok: true }
  return { ok: false, issues: toIssues(parsed.error) }
}

/**
 * evt 域契约 subject（CASES.md 域约定；对齐 company/validator.ts 的 dirSubject 分工）：
 * 合法返回 {ok:true}；不合法 throw ClassifiedError 形状错误（category=CONFIG_INVALID，
 * subcause=evt/invalid:<首个 issue 路径>，detail=人话首条修法）。
 */
export function evtSubject(input: unknown): { ok: true } {
  const result = validateEventRecord(input)
  if (result.ok) return { ok: true }
  const first = result.issues[0]
  if (first === undefined) return { ok: true } // 不可达：zod 失败必有 issue
  configInvalid(`evt/invalid:${first.path}`, `${first.path}: ${first.message}`)
}
