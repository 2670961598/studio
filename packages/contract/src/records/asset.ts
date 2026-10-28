/**
 * ASSET 资产族记录形状与判定件（REC-ASSET-01/02）——MIG-03 / IMPL-03-02
 *
 * 依据链：
 *   - v2/11 §十一（资产登记/绑定损失清单字段与不变量）；§1.10 ASSET 族 2 类登记；§〇.4/§0.6 枚举零重述
 *   - v2/09 ENU-82 资产类型、ENU-83 专属标记（exclusive 必填 targetExecutor）、ENU-88 执行器值集
 *   - v2/06（资产对象本体与传播语义，唯一主表）、§3.4（必备资产）/§九（秘密/路径扫描）；v2/07 §2.1（适配
 *     契约② 绑定损失）、§2.3（专属标记与未表达项不得丢弃/不得宣称等价承载）、§四规则 3（证据缺口）；
 *     v2/08 §六（损失声明交换）；v2/15 §四（秘密值不入包与指纹）
 *   - plan/05 IMPL-03-02
 *
 * 登记缺口（不臆造）：
 *   1. REC-ASSET-01 `provenance`/`compatibility`/`propagation` 正文未给机器形状 → 以引用＋非空串槽承载，
 *      不新立值集（资产对象本体唯一主表在 v2/06）。
 *   2. REC-ASSET-02 `lost_capabilities` 的「明示不可用」语句以非空串承载（不新立 severity 值集；
 *      ENU-110 属 v2/12 绑定损失 severity，本记录不冒用）。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义族外枚举字面量。
 */
import { z } from 'zod'
import {
  ObjectRefSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  recordReject,
  type RecordValidationOutcome,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.10：ASSET 族 2 类） ——

/** v2/11 §1.10 ASSET 资产族 2 类 */
export const ASSET_RECORD_TYPES = ['REC-ASSET-01', 'REC-ASSET-02'] as const

export type AssetRecordType = (typeof ASSET_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表） ——

/** ENU-82 资产类型（Skill/MCP/插件/能力包） */
export const ASSET_KINDS = ['skill', 'mcp', 'plugin', 'capability_pack'] as const
export const AssetKindSchema = z.enum(ASSET_KINDS)
export type AssetKind = (typeof ASSET_KINDS)[number]

/** ENU-83 专属标记（exclusive 必填 targetExecutor；缺省按 generic 并警示——不得静默丢弃） */
export const ASSET_EXCLUSIVITY_MARKERS = ['generic', 'exclusive'] as const
export const AssetExclusivitySchema = z.enum(ASSET_EXCLUSIVITY_MARKERS)

/** ENU-88 执行器值集（绑定事实源 v2/12 四家；新增执行器先登记） */
export const EXECUTOR_VALUES = ['dsh', 'claude', 'codex', 'kimi'] as const
export const ExecutorSchema = z.enum(EXECUTOR_VALUES)
export type Executor = (typeof EXECUTOR_VALUES)[number]

// —— §3 REC-ASSET-01 资产登记（DOM-07 资产部权威；索引＝投影） ——

export const AssetRegistrationPayloadSchema = z.strictObject({
  /** ENU-82 */
  asset_kind: AssetKindSchema,
  /** 专属标记（「DSH 专属」与未表达项必须保留，不得丢弃、不得宣称等价承载——v2/07 §2.3） */
  exclusivity: z.strictObject({
    marker: AssetExclusivitySchema,
    /** exclusive 时必填（ENU-83） */
    target_executor: ExecutorSchema.optional(),
    /** 未表达项（不得丢弃——v2/07 §2.3） */
    unexpressed_items: z.array(z.string().min(1)),
  }),
  /** 发布者、版本、摘要、许可（资产对象本体 v2/06） */
  provenance: z.strictObject({
    publisher: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1),
    license: z.string().min(1),
  }),
  /** 宿主与绑定要求 */
  compatibility: z.array(z.string().min(1)).min(1),
  /** 传播语义（语义源 v2/06） */
  propagation: z.strictObject({ semantics: z.string().min(1), notes: z.array(z.string().min(1)) }),
  /** 资产部条目来源（索引条目） */
  index_ref: ObjectRefSchema,
})

export type AssetRegistrationPayload = z.infer<typeof AssetRegistrationPayloadSchema>
export const AssetRegistrationRecordSchema = recordEnvelopeSchema(AssetRegistrationPayloadSchema, 'REC-ASSET-01')

/** REC-ASSET-01 判定输入（标记是否被丢弃/等价承载声明/秘密与路径扫描） */
export interface AssetRegistrationContext {
  /** 专属标记或未表达项被丢弃（v2/07 §2.3 判负——NEG-REC-11） */
  markerDropped?: boolean
  /** 宣称等价承载（不得——v2/07 §2.1/§2.3） */
  claimsEquivalentHosting?: boolean
  /** 秘密值/本机路径入包（v2/15 §四） */
  containsSecretValue?: boolean
  containsLocalPath?: boolean
}

// —— §4 REC-ASSET-02 绑定损失清单（换宿主/备选 CLI 的逐项能力损失显性登记） ——

export const BindingLossPayloadSchema = z.strictObject({
  /** 被绑定的备选宿主 */
  bound_host: z.strictObject({ executor: ExecutorSchema, binding_ref: ObjectRefSchema }),
  /** 逐项：专属能力项→「明示不可用」；逐项落损失面，不得宣称等价承载 */
  lost_capabilities: z.array(
    z.strictObject({
      capability: z.string().min(1),
      loss_face: z.string().min(1),
      /** 明示不可用（不得留空、不得改写成「部分支持」——§十一） */
      unavailable_statement: z.string().min(1),
    }),
  ),
  /** 替代路径或「不能」 */
  compensations: z.array(z.strictObject({ capability: z.string().min(1), alternative: z.string().min(1) })),
  /** 证据缺口（外部后端保留自身权限系统等——v2/07 §四规则 3） */
  evidence_gaps: z.array(z.string().min(1)),
})

export type BindingLossPayload = z.infer<typeof BindingLossPayloadSchema>
export const BindingLossRecordSchema = recordEnvelopeSchema(BindingLossPayloadSchema, 'REC-ASSET-02')

/** REC-ASSET-02 判定输入（强策略岗位是否可派／是否静默回落默认家） */
export interface BindingLossContext {
  /** 强策略岗位（只能派给声明策略面可用的宿主，无解不派工——fail-closed） */
  strongPolicyPosition?: boolean
  /** 该备选宿主声明策略面可用 */
  strategySurfaceAvailable?: boolean
  /** 静默回落默认家（不得——§十一） */
  silentFallbackToDefaultHost?: boolean
  /** 损失项被隐去（未逐项落损失面） */
  lossesHidden?: boolean
}

// —— §5 形状闸（两类） ——

export const ASSET_RECORD_SCHEMAS: Readonly<Record<AssetRecordType, z.ZodType>> = {
  'REC-ASSET-01': AssetRegistrationRecordSchema,
  'REC-ASSET-02': BindingLossRecordSchema,
}

// —— §6 判定件（纯函数；不抛错） ——

/**
 * REC-ASSET-01 判定（§十一 不变量）：
 *   ① 专属标记与未表达项不得丢弃、不得宣称等价承载（NEG-REC-11）；
 *   ② exclusive 必填 targetExecutor（缺省按 generic 并警示——不静默）；
 *   ③ 定义正文纯配置；秘密值不入资产与指纹（v2/15）；资产部独立。
 */
export function validateAssetRegistration(record: unknown, ctx: AssetRegistrationContext = {}): RecordValidationOutcome {
  const parsed = AssetRegistrationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.exclusivity.marker === 'exclusive' && payload.exclusivity.target_executor === undefined) {
    checks.push(recordReject('payload.exclusivity.target_executor', 'exclusive 必填 targetExecutor（缺省按 generic 并警示——ENU-83）'))
  }
  if (ctx.markerDropped === true) {
    checks.push(recordReject('payload.exclusivity', '专属标记与未表达项不得丢弃（v2/07 §2.3——NEG-REC-11）'))
  }
  if (ctx.claimsEquivalentHosting === true) {
    checks.push(recordReject('payload.compatibility', '不得宣称等价承载（专属能力须明示不可用——v2/07 §2.1/§十一）'))
  }
  if (ctx.containsSecretValue === true) {
    checks.push(recordReject('payload.provenance', '秘密值不入资产与指纹（v2/15 §四——§十一）'))
  }
  if (ctx.containsLocalPath === true) {
    checks.push(recordReject('payload.provenance', '资产定义不得含本机路径（v2/15 §四）'))
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-ASSET-02 判定（§十一 不变量）：
 *   ① 换宿主＝新出工段＋能力重认＋五门重判（在途钉旧计划；由上游记录面承载，本记录只声明损失）；
 *   ② 强策略岗位只能派给声明策略面可用的宿主，无解不派工（fail-closed），不得静默回落默认家；
 *   ③ 损失须逐项落损失面，不得宣称等价承载（NEG-REC-11）。
 */
export function validateBindingLoss(record: unknown, ctx: BindingLossContext = {}): RecordValidationOutcome {
  const parsed = BindingLossRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.strongPolicyPosition === true && ctx.strategySurfaceAvailable !== true) {
    checks.push(recordReject('payload.bound_host', '强策略岗位只能派给声明策略面可用的宿主，无解不派工（fail-closed——§十一）'))
  }
  if (ctx.silentFallbackToDefaultHost === true) {
    checks.push(recordReject('payload.bound_host', '不得静默回落默认家（须显式声明损失——§十一）'))
  }
  if (ctx.lossesHidden === true && payload.lost_capabilities.length === 0) {
    checks.push(recordReject('payload.lost_capabilities', '换宿主的能力损失须逐项显性登记（NEG-REC-11——§十一）'))
  }
  for (const [index, entry] of payload.lost_capabilities.entries()) {
    if (entry.unavailable_statement.trim().length === 0) {
      checks.push(recordReject(`payload.lost_capabilities.${index}`, '专属能力项须明示不可用（不得留空——§十一）'))
    }
  }
  return mergeOutcomes(...checks)
}
