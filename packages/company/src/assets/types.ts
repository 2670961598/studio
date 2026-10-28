/**
 * assets/types —— 公司资产部模型（DOM-07；84-D1a；IMPL-05-01）
 *
 * 依据链：
 *   - v2/06 §三（表 3 ASSET-01 语义：标识/类型/摘要/来源与许可/专属标记/必备声明/可选性）、
 *     §3.3（必备资产）、§3.4（缺目标执行器与必备不可用的二选一＋装载报告）、§3.5（传播≠授权）、
 *     §4.5（plugins/＝DSH 插件专属资产位）、§九（强制失败出口）
 *   - v2/10 §4.4（SCH-ASSET-01 字段形状）、§1.1（标量族 dotid/token/semver）、§2.8（ENC-08 摘要结构）
 *   - v2/11 §十一 REC-ASSET-01（专属标记与未表达项不得丢弃／不得宣称等价承载）
 *   - v2/07 §2.3（DSH 专属标记保留）、v2/15 §四（秘密值与本机路径不入包）
 *   - plan/05 IMPL-05-01
 *
 * 边界（不重述 v2 字段表——枚举字面量一律引 contract 工件）：
 *   - 资产类型 ENU-82、专属标记 ENU-83、执行器 ENU-88 的唯一主表在 v2/09；
 *     本包经 `contract/src/records/asset.ts` 的投影消费（contract 主出口暂未收编 records 面，
 *     故按 v2 套件既有先例走同仓相对引用；不复制字面量、不另立值集）。
 *   - 本件只给资产部模型与装载报告形状；装载 IO 在 loader.ts、清单解析在 registry.ts、
 *     定义包导入在 defpkg.ts/import.ts。记录面（REC-ASSET-01）形状归 contract，本件不复制。
 *
 * 缺口登记（不臆造）：
 *   1. SCH-ASSET-01 无「资产文件定位」字段 → 本波以目录契约补位（registry.assetLocation）：
 *      `plugins/<assetId>/`（DSH 插件专属位）与 `assets/<assetId>/`（其余资产）；
 *      该约定是本实现的落地选择，不回写 v2/10（归后续 schema 单列）。
 *   2. `availability.need` 值集 `needed|optional` 未在 contract 收编 → 本件就地声明字面量并注明
 *      待 v2/09 收口；不冒充已冻结值集。
 *   3. 内容摘要只收 byte 型（资产文件是字节）；semantic 摘要需 canonicalization 身份（v2/10 §2.8）
 *      ——本波无跨包 canonical 实现，不冒充。
 *   4. `provenance.version` 是 REC-ASSET-01 登记面的本地补位（SCH-ASSET-01 的 provenance 只列
 *      publisher/upstreamRef/license）：未声明即不生成登记 payload，不臆造版本；归 v2/10 后续 schema。
 */
import { DotIdSchema, SemverSchema, TokenSchema } from '../../../contract/src/records/envelope.ts'
import {
  ASSET_EXCLUSIVITY_MARKERS,
  ASSET_KINDS,
  EXECUTOR_VALUES,
  type AssetKind,
  type AssetRegistrationPayload,
  type Executor,
} from '../../../contract/src/records/asset.ts'
import { z } from 'zod'

// —— 枚举投影（值集唯一主表 v2/09；本件只 re-export，不复制字面量） ——

export { ASSET_EXCLUSIVITY_MARKERS, ASSET_KINDS, EXECUTOR_VALUES }
export type { AssetKind, AssetRegistrationPayload, Executor }

/** 专属标记两值（ENU-83 投影） */
export type AssetBinding = (typeof ASSET_EXCLUSIVITY_MARKERS)[number]

/** 资产清单在公司目录的固定落点（v2/06 §4.1：assets.yaml；无清单=零资产） */
export const ASSET_MANIFEST_FILE = 'assets.yaml'

/** 清单交换标记（本波自有；v2/09 未登记前不冒称公共 schema 身份） */
export const ASSET_MANIFEST_SCHEMA = 'studio-next/assets@1'

/** DSH 插件专属资产目录（v2/06 §4.5 正式位）；其余资产落 assets/（本实现补位，见头注缺口 1） */
export const PLUGIN_ASSET_DIR = 'plugins'
export const GENERIC_ASSET_DIR = 'assets'

/** 未声明许可的唯一标注（v2/06 表 3：不默认继承仓库许可；MIT 只覆盖框架仓） */
export const UNDECLARED_LICENSE_LABEL = '待有权者决定'

// —— 标量/摘要（SCH-SYN-01／ENC-08 子集；不另立标量） ——

/** 资产类型 zod 面（直接取 contract 值集，不复制） */
export const AssetKindSchema = z.enum(ASSET_KINDS)
export const AssetBindingSchema = z.enum(ASSET_EXCLUSIVITY_MARKERS)
export const ExecutorSchema = z.enum(EXECUTOR_VALUES)
export { DotIdSchema, SemverSchema, TokenSchema }

/** 摘要算法封闭集（ENC-08「至少 sha-256」） */
export const CONTENT_DIGEST_ALGORITHMS = ['sha-256'] as const
export type ContentDigestAlgorithm = (typeof CONTENT_DIGEST_ALGORITHMS)[number]

/**
 * 内容摘要（ENC-08 的资产子集）：kind 只收 byte——资产文件是字节，摘要证明「两次读取字节一致」；
 * semantic 摘要证明的是规范字节一致，需 canonicalizationId/Version，本波不做、不冒充。
 */
export interface ContentDigest {
  algorithm: ContentDigestAlgorithm
  /** 小写十六进制（sha-256=64 位） */
  value: string
  kind: 'byte'
}

/** 摘要 zod 面（strictObject：未知键拒收） */
export const ContentDigestSchema = z.strictObject({
  algorithm: z.enum(CONTENT_DIGEST_ALGORITHMS),
  value: z.string().regex(/^[0-9a-f]{64}$/, '摘要值须为小写十六进制 sha-256（64 位）'),
  kind: z.literal('byte'),
})

/** 许可声明（SCH-PKG-02.license 形状；未声明＝UNDECLARED_LICENSE_LABEL，不默认 MIT） */
export interface AssetLicense {
  licenseId: string
  scope: string
  textRef?: string
}

export const AssetLicenseSchema = z.strictObject({
  licenseId: TokenSchema,
  scope: z.string().min(1),
  textRef: DotIdSchema.optional(),
})

/** 来源与谱系（REC-ASSET-01 provenance 的资产清单面；version 供登记引用，未声明即不冒称） */
export interface AssetProvenance {
  publisher: string
  upstreamRef?: string
  version?: string
  license?: AssetLicense
}

export const AssetProvenanceSchema = z.strictObject({
  publisher: z.string().min(1),
  upstreamRef: DotIdSchema.optional(),
  version: SemverSchema.optional(),
  license: AssetLicenseSchema.optional(),
})

/** 必备声明（装载语义，不是授权语义——v2/06 §3.3） */
export interface AssetRequiredness {
  required: boolean
  impactNote: string
}

export const AssetRequirednessSchema = z.strictObject({
  required: z.boolean(),
  impactNote: z.string().min(1),
})

/**
 * 对运行是否必需（SCH-ASSET-01 availability.need）。
 * 值集 `needed|optional` 待 v2/09 收口（本波不冒充已冻结——见头注缺口 2）。
 */
export const ASSET_AVAILABILITY_NEEDS = ['needed', 'optional'] as const
export type AssetAvailabilityNeed = (typeof ASSET_AVAILABILITY_NEEDS)[number]

export interface AssetAvailability {
  need: AssetAvailabilityNeed
  impact: string
}

export const AssetAvailabilitySchema = z.strictObject({
  need: z.enum(ASSET_AVAILABILITY_NEEDS),
  impact: z.string().min(1),
})

/** 清单条目规范形（SCH-ASSET-01；binding 缺省补 generic 并警示，不静默丢弃） */
export interface AssetEntry {
  assetId: string
  type: AssetKind
  contentDigest: ContentDigest
  provenance: AssetProvenance
  binding: AssetBinding
  targetExecutor?: Executor
  requiredness: AssetRequiredness
  availability: AssetAvailability
}

/** 清单警示（W-SCH-002：缺专属标记按 generic 处理并警示——不无声） */
export interface AssetManifestWarning {
  code: 'W-SCH-002'
  assetId: string
  message: string
}

/** 清单/装载诊断（code 采用 v2/10 §八登记码；路径与秘密面用本波 subcause 串——不发明公共码） */
export interface AssetIssue {
  code: string
  assetId?: string
  path?: string
  message: string
}

/** 清单解析结果：零资产也合法（present=false≠空清单） */
export interface AssetManifestParseResult {
  entries: AssetEntry[]
  warnings: AssetManifestWarning[]
}

// —— 装载面（v2/06 §3.4 装载报告；本波落地，登记为「目标（未证）」机制的实现面） ——

/** 逐项装载态：loaded／missing／incompatible／blocked（不静默补、不冒充已装） */
export const ASSET_LOAD_STATES = ['loaded', 'missing', 'incompatible', 'blocked'] as const
export type AssetLoadState = (typeof ASSET_LOAD_STATES)[number]

/** 单资产装载条目（报告逐项；专属标记与目标执行器原样保留） */
export interface AssetLoadItem {
  assetId: string
  type: AssetKind
  binding: AssetBinding
  targetExecutor?: Executor
  required: boolean
  state: AssetLoadState
  reason: string
  /** 相对公司目录的资产位置（仅解析成功时给） */
  location?: string
  /** 资产安装/加载授权仍须走 v2/07 能力链：传播≠授权（v2/06 §3.5） */
  installAuthorization: 'required'
  /** 资产文件含可执行内容（只标记、绝不执行——字节惰性 v2/10 §4.8） */
  executableContent: boolean
}

/** 必备资产不可用的逐项事实（拒绝或降级的共同输入） */
export interface RequiredAssetUnavailable {
  assetId: string
  state: AssetLoadState
  reason: string
}

/** 必备不可用时的处置策略（二选一，无第三态、无默认可用） */
export type RequiredAssetPolicy = 'refuse' | 'degrade'

/** 降级/拒绝的具名留痕（v2/06 §3.4「由接收方部署者具名选择并留痕」） */
export interface RequiredAssetDecisionByName {
  /** 决定者（具名位置/人；不得写「系统/框架」） */
  actor: string
  note: string
}

/** 必备资产判定结果 */
export interface RequiredAssetDecision {
  policy: RequiredAssetPolicy
  outcome: 'none' | 'refused' | 'degraded'
  unavailable: RequiredAssetUnavailable[]
  decision?: RequiredAssetDecisionByName
}

/** 装载扫描说明（只声明「未发现疑似」，不称「绝无秘密」——v2/15 §四） */
export interface AssetScanNote {
  performed: boolean
  suspects: number
  note: string
}

/** 装载报告（v2/06 §3.4：可用/不可用资产面＋原因） */
export interface AssetLoadReport {
  companyDir: string
  manifestPresent: boolean
  items: AssetLoadItem[]
  issues: AssetIssue[]
  warnings: AssetManifestWarning[]
  /** 有文件无清单条目的相对路径（索引唯一性违反——不默认全收） */
  unlisted: string[]
  required: RequiredAssetDecision
  scan: AssetScanNote
}

/** 装载选项（executor 集与必备策略都无「默认可用」） */
export interface LoadCompanyAssetsOptions {
  companyDir: string
  /** 接收方可用执行器；缺省＝空集（专属资产一律 incompatible，如实进报告） */
  availableExecutors?: readonly Executor[]
  /** 必备不可用策略；缺省 refuse（fail-closed），degrade 须具名 decision */
  requiredAssetPolicy?: RequiredAssetPolicy
  decision?: RequiredAssetDecisionByName
}
