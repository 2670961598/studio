/**
 * bindcard/capability —— 能力包引用面：只携引用、公司包不自封权威、专属/通用二分
 *
 * 依据：
 *   - v2/05 §三 DOM-06：**能力包、部署绑定＝独立工件**（能力包/绑定档案）；公司包只携带
 *     **引用与兼容声明**；唯一写入者＝部署责任者——绑定档案/能力包不是公司包的自封面。
 *   - v2/06 §三 表 3（ASSET-01：标识/类型/内容摘要/来源与许可/专属标记/必备声明/可选性）、
 *     §3.4（接收方缺专属执行器＝**不可用必须明示**；必备资产不可用走二选一）、§3.5
 *     （传播≠授权）、§1.1（包内主张不得覆盖记录、不得作为激活依据）、§五（秘密值/本机路径
 *     不入包——本件只收引用与声明，不碰字节）。
 *   - v2/07 §2.3（专属标记与未表达项不得丢弃、不得宣称等价承载）；v2/12 §1.5 专属面。
 *   - v2/09 ENU-82 资产类型（skill/mcp/plugin/capability_pack）、ENU-83 专属标记
 *     （generic/exclusive；exclusive 必填目标执行器）、ENU-88 执行器值集——值集唯一主表 09，
 *     运行时投影在 contract `records/asset.ts`（本件只消费，不复制字面量）。
 *   - plan/05 IMPL-07-05「能力包只携引用（公司包不自封权威）＋专属/通用二分」。
 *
 * 本件的两条硬规则：
 *   1. **只携引用**：引用＝（assetId, kind, 摘要, 专属标记, 必备性, 兼容声明）；出现内嵌字节/
 *      文件内容/内联体一律拒收（`bindcard/capability-embedded-content`）——字节装载归公司
 *      资产部（packages/company/src/assets 装载与 import.ts），不在绑定面二次实现。
 *   2. **不自封权威**：出现自封字段（authority/authorized/granted/approval/verified 等）一律
 *      拒收（`bindcard/capability-self-authority`）——公司包与资产清单只作声明；安装与使用
 *      走 v2/07 授权链，「传播≠授权」；本件产物恒带 `installAuthorization:'required'`，
 *      不提供任何「已授权」布尔位。
 *
 * 缺口登记（不臆造）：SCH-ASSET-01 的 `availability.need`（needed|optional）与「安装回执」
 * 记录形状归 v2/10/v2/11，本件只用 `required` 布尔＋引用面，不冒称已具备那两处形状。
 */
import type { ClassifiedError, Result } from '@studio-next/contract'
import type { AssetKind, Executor } from '../../../contract/src/records/asset.ts'
import {
  ASSET_EXCLUSIVITY_MARKERS,
  AssetExclusivitySchema,
  AssetKindSchema,
  ExecutorSchema,
} from '../../../contract/src/records/asset.ts'
import { DotIdSchema } from '../../../contract/src/records/envelope.ts'
import { configErr, deepFreeze, okResult } from './types.ts'

/** 专属标记类型（ENU-83 投影；不另立值集——直接取 contract 常量元组的成员类型） */
export type AssetBinding = (typeof ASSET_EXCLUSIVITY_MARKERS)[number]

/** 能力包引用（公司包侧唯一合法携带形；**无字节、无授权**） */
export interface CapabilityPackRef {
  /** 引用标识（assetId@摘要前 12 位；可复算可对账） */
  readonly refId: string
  /** 资产标识（dotid：命名空间.名，v2/10 §1.1） */
  readonly assetId: string
  /** 资产类型（v2/09 ENU-82 投影） */
  readonly kind: AssetKind
  /** 专属标记（v2/09 ENU-83 投影；缺省按通用并警示） */
  readonly binding: AssetBinding
  /** 目标执行器（exclusive 必填；generic 不得出现） */
  readonly targetExecutor?: Executor
  /** 内容摘要（sha-256 小写十六进制；引用完整性，不是内容本身） */
  readonly contentDigest: string
  /** 必备性（装载语义，不是授权语义） */
  readonly required: boolean
  /** 兼容声明（宿主/版本要求；允许携带——DOM-06 明示） */
  readonly compatibility: readonly string[]
  /** 传播≠授权：消费方仍须走授权链；本字段恒 'required'（不提供其它值） */
  readonly installAuthorization: 'required'
}

/** 清单警示（缺专属标记按通用处理并警示——不无声；码沿用公司资产部 W-SCH-002 口径） */
export interface CapabilityPackWarning {
  readonly code: 'W-SCH-002'
  readonly assetId: string
  readonly message: string
}

/** 装载结果（引用＋警示） */
export interface CapabilityPackLoadResult {
  readonly refs: readonly CapabilityPackRef[]
  readonly warnings: readonly CapabilityPackWarning[]
}

/** 内嵌内容键（出现即拒：只携引用） */
export const EMBEDDED_CONTENT_KEYS: readonly string[] = Object.freeze([
  'content',
  'contents',
  'bytes',
  'body',
  'payload',
  'inline',
  'files',
  'blob',
  'file',
  'data',
])

/** 自封权威键（出现即拒：公司包不自封权威；installAuthorization 单独判值） */
export const SELF_AUTHORITY_KEYS: readonly string[] = Object.freeze([
  'authority',
  'authorities',
  'authorized',
  'authorizedBy',
  'granted',
  'grantedBy',
  'approved',
  'approval',
  'approvedBy',
  'trusted',
  'verified',
  'activation',
  'activated',
  'signature',
  'sealed',
])

/** 摘要正则（sha-256 小写十六进制，64 位） */
const DIGEST_RE = /^[0-9a-f]{64}$/

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function errAt(index: number, subcause: string, detail: string): Result<never, ClassifiedError> {
  return configErr(subcause, `能力包声明[${String(index)}]：${detail}`)
}

/**
 * 装载公司包携带的能力包声明（引用面校验）：
 *   形状（strict 拒绝内嵌内容/自封权威）→ 标识（dotid）→ 类型（ENU-82）→ 摘要（64 位 hex）
 *   → 专属标记（缺省 generic＋警示 W-SCH-002；exclusive 必填 targetExecutor，generic 不得标）
 *   → 必备性/兼容声明 → 重名拒收。
 * 纯函数：不改入参、不读盘、不执行任何字节；同入参同输出。
 */
export function loadCapabilityPacks(input: readonly unknown[]): Result<CapabilityPackLoadResult, ClassifiedError> {
  const refs: CapabilityPackRef[] = []
  const warnings: CapabilityPackWarning[] = []
  const seen = new Set<string>()
  for (let i = 0; i < input.length; i += 1) {
    const raw = asRecord(input[i])
    if (raw === undefined) return errAt(i, 'bindcard/capability-shape', '条目须为映射（对象）而非数组/标量')
    for (const key of Object.keys(raw)) {
      if (EMBEDDED_CONTENT_KEYS.includes(key)) {
        return errAt(
          i,
          'bindcard/capability-embedded-content',
          `出现内嵌内容键 ${JSON.stringify(key)}——能力包只携引用（DOM-06）；字节装载归公司资产部（packages/company/src/assets），绑定面不二次实现`,
        )
      }
      if (SELF_AUTHORITY_KEYS.includes(key)) {
        return errAt(
          i,
          'bindcard/capability-self-authority',
          `出现自封权威键 ${JSON.stringify(key)}——公司包/资产清单不自封权威（v2/06 §1.1/§3.5）；安装与使用走 v2/07 授权链`,
        )
      }
      if (key === 'installAuthorization' && raw[key] !== 'required') {
        return errAt(
          i,
          'bindcard/capability-self-authority',
          `installAuthorization=${JSON.stringify(raw[key])}——只能声明 'required'（传播≠授权）；授权结论不得由公司包给出，安装与使用走 v2/07 授权链`,
        )
      }
    }
    const assetId = raw['assetId']
    if (typeof assetId !== 'string' || !DotIdSchema.safeParse(assetId).success) {
      return errAt(i, 'bindcard/capability-id-invalid', `assetId 须为 dotid（命名空间.名，v2/10 §1.1），收到 ${JSON.stringify(assetId)}`)
    }
    const kind = raw['kind']
    const kindParsed = AssetKindSchema.safeParse(kind)
    if (!kindParsed.success) {
      return errAt(i, 'bindcard/capability-kind-unknown', `资产类型须为 ENU-82 值集，收到 ${JSON.stringify(kind)}（未知类型拒收，不默认忽略）`)
    }
    const contentDigest = raw['contentDigest']
    if (typeof contentDigest !== 'string' || !DIGEST_RE.test(contentDigest)) {
      return errAt(i, 'bindcard/capability-digest-invalid', 'contentDigest 须为小写十六进制 sha-256（64 位）——无摘要不得进入分发')
    }
    const requiredRaw = raw['required']
    if (requiredRaw !== undefined && typeof requiredRaw !== 'boolean') {
      return errAt(i, 'bindcard/capability-shape', 'required 须为布尔（必备性是装载语义）')
    }
    const compatibilityRaw = raw['compatibility']
    let compatibility: readonly string[] = Object.freeze([]) as readonly string[]
    if (compatibilityRaw !== undefined) {
      if (!Array.isArray(compatibilityRaw) || compatibilityRaw.some((c) => typeof c !== 'string' || c.trim() === '')) {
        return errAt(i, 'bindcard/capability-shape', 'compatibility 须为非空字符串数组（兼容声明；允许携带）')
      }
      compatibility = Object.freeze([...(compatibilityRaw as string[])])
    }
    const bindingRaw = raw['binding']
    let binding: AssetBinding
    if (bindingRaw === undefined) {
      binding = 'generic'
      warnings.push(
        Object.freeze({
          code: 'W-SCH-002' as const,
          assetId,
          message: '缺专属标记：按通用处理并警示（不静默丢弃，v2/06 §3.2 缺失时口径）',
        }),
      )
    } else {
      const parsed = AssetExclusivitySchema.safeParse(bindingRaw)
      if (!parsed.success) {
        return errAt(i, 'bindcard/capability-binding-unknown', `专属标记须为 ENU-83 值集，收到 ${JSON.stringify(bindingRaw)}`)
      }
      binding = parsed.data
    }
    const targetRaw = raw['targetExecutor']
    let targetExecutor: Executor | undefined
    if (targetRaw !== undefined) {
      const parsed = ExecutorSchema.safeParse(targetRaw)
      if (!parsed.success) {
        return errAt(i, 'bindcard/capability-target-unknown', `targetExecutor 须为 ENU-88 值集，收到 ${JSON.stringify(targetRaw)}`)
      }
      targetExecutor = parsed.data
    }
    if (binding === 'exclusive' && targetExecutor === undefined) {
      return errAt(
        i,
        'bindcard/capability-target-missing',
        'exclusive 资产必填 targetExecutor（ENU-83）——「DSH 专属」必须指名目标执行器，不得留空',
      )
    }
    if (binding === 'generic' && targetExecutor !== undefined) {
      return errAt(
        i,
        'bindcard/capability-binding-conflict',
        `generic 资产不得标 targetExecutor（收到 ${targetExecutor}）——专属标记与目标执行器互相矛盾`,
      )
    }
    if (seen.has(assetId)) {
      return errAt(i, 'bindcard/capability-dup', `assetId 重复：${assetId}（清单是唯一索引，重复条目＝两次事实）`)
    }
    seen.add(assetId)
    refs.push(
      deepFreeze({
        refId: `${assetId}@${contentDigest.slice(0, 12)}`,
        assetId,
        kind: kindParsed.data,
        binding,
        ...(targetExecutor !== undefined ? { targetExecutor } : {}),
        contentDigest,
        required: requiredRaw === true,
        compatibility,
        installAuthorization: 'required' as const,
      }),
    )
  }
  return okResult({ refs: Object.freeze(refs), warnings: Object.freeze(warnings) })
}

/** 单条引用的可用性判定（专属/通用二分在运行时落点） */
export interface CapabilityPackResolutionRow {
  readonly refId: string
  readonly assetId: string
  readonly binding: AssetBinding
  readonly targetExecutor?: Executor
  readonly state: 'applicable' | 'incompatible'
  readonly reason: string
  readonly required: boolean
  readonly installAuthorization: 'required'
}

/** 可用性解析结果（不可用**必须明示**，不静默丢；授权面不在本件） */
export interface CapabilityPackResolution {
  readonly rows: readonly CapabilityPackResolutionRow[]
  readonly unavailableRequired: readonly CapabilityPackResolutionRow[]
  readonly note: string
}

/**
 * 能力包引用 × 接收方可用执行器 → 可用性判定（专属/通用二分）：
 *   - generic ⇒ applicable（任意合规执行环境可用）
 *   - exclusive ＋ 接收方具备目标执行器 ⇒ applicable
 *   - exclusive ＋ 接收方**不具备** ⇒ incompatible（reason=missing-executor；明示不可用，
 *     必备资产进 unavailableRequired——二选一决定归接收方部署者，本件不代选）
 *   - 未知执行器名一律视为「不具备」（fail-closed；不因拼写宽松放行）
 * 注意：可用性 ≠ 已授权；传播≠授权（v2/06 §3.5），安装与使用仍走承诺链（v2/07）。
 */
export function resolveCapabilityPacks(
  refs: readonly CapabilityPackRef[],
  availableExecutors: readonly string[],
): CapabilityPackResolution {
  const available = new Set<string>()
  for (const candidate of availableExecutors) {
    const parsed = ExecutorSchema.safeParse(candidate)
    if (parsed.success) available.add(parsed.data)
  }
  const rows: CapabilityPackResolutionRow[] = []
  for (const ref of refs) {
    const exclusiveMissing =
      ref.binding === 'exclusive' && (ref.targetExecutor === undefined || !available.has(ref.targetExecutor))
    const row: CapabilityPackResolutionRow = deepFreeze({
      refId: ref.refId,
      assetId: ref.assetId,
      binding: ref.binding,
      ...(ref.targetExecutor !== undefined ? { targetExecutor: ref.targetExecutor } : {}),
      state: exclusiveMissing ? 'incompatible' : 'applicable',
      reason: exclusiveMissing
        ? 'missing-executor'
        : ref.binding === 'exclusive'
          ? 'target-executor-available'
          : 'generic-any-compliant-host',
      required: ref.required,
      installAuthorization: 'required' as const,
    })
    rows.push(row)
  }
  const unavailableRequired = Object.freeze(
    rows.filter((r) => r.state === 'incompatible' && r.required),
  )
  return Object.freeze({
    rows: Object.freeze(rows),
    unavailableRequired,
    note: '专属资产缺目标执行器＝明示不可用（不静默丢弃、不冒充等价）；传播≠授权：可用性不构成安装/使用授权',
  })
}
