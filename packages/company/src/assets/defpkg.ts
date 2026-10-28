/**
 * assets/defpkg —— PKG-DEF 定义包校验与目录卫生（IMPL-05-02；NEG-PKG-01/02/05/06/08/09）
 *
 * 依据链：
 *   - v2/06 §一.2（PKG-DEF＝定义部＋资产部）、§二.1（进/不进清单）、§2.2（字节惰性）、
 *     §3.4（定义部必须可装、装不动即拒收并指名）、§3.5（传播≠授权）、§4.1（目录契约封闭集）、
 *     §4.3（51 兼容层：原格式无法表达处必须显示「未表达」，不得默认值虚构完整）、
 *     §4.4（.studio-next.yaml 定义段/挂载戳记拆分）、§4.5（plugins/ 四条约束）、
 *     §九（强制失败出口：未知 part 类型、身份主张从属、秘密/本机路径、资产执行边界、
 *     挂载戳记剥离、CL 结构判据、定义部可装性）
 *   - v2/10 §4.2（part 条目：partType 值集唯一主表 v2/09；unknown 一律拒收）、§4.7（戳记名单）、
 *     §4.8（偷渡通道：脚本/解释器行、版本控制钩子、包管理生命周期）
 *   - v2/03 §2.4（CL 判据是结构事实不是声明；「只改 level 字段」无效——NEG-ORG-06 同型）
 *   - v2/11 §十一（身份/状态主张非权威：冲突以记录为准，不得激活）
 *   - plan/05 IMPL-05-02
 *
 * 与 v2/10 SCH-PKG-01 的关系（诚实登记缺口，不复制全字段表）：
 *   本波 `package.yaml` 只承载 part **索引闭包**（partId/partType）——用于 NEG-PKG-01 与导入
 *   分区判定；SCH-PKG-01 全字段（digest/aggregateDigest/signatures…）与 aggregateDigest 复算
 *   需 canonical 实现（v2/10 §5.3），归 MIG-06 PORT-DEF 接线；本件不冒充已实现。
 *
 * 登记缺口（不臆造）：
 *   1. `package.yaml` 是本波最小 part 索引载体；v2/06 §4.1 封闭集未列 manifest 文件位，
 *      `assets/` 亦为本实现为通用资产补的目录位——两者均登记为迁移期实现选择，不冒称已冻结。
 *   2. 定义部正文的完整 51/V2 schema 校验（validator.ts 面）未接线——本件只做可装性前置
 *      （org-config/dependencies 可解析、part 闭包、目录卫生、CL/身份/戳记）；完整校验归
 *      MIG-06 PORT-DEF 与 validator 迁移波次。
 *   3. aggregateDigest / part digest 的复算未做（需 canonical 实现，v2/10 §5.3）——不宣称已核验。
 *
 * 语义：全部校验在落位前完成；失败即抛 CONFIG_INVALID/defpkg/*，调用方（import.ts）保证
 * 暂存目录清理、目标目录零落位——结构上不存在「半包」。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'
import { parseDependencies } from '../dependencies.ts'
import {
  DotIdSchema,
  SemverSchema,
  type AssetLoadReport,
  type Executor,
  type RequiredAssetDecisionByName,
  type RequiredAssetPolicy,
} from './types.ts'
import { loadCompanyAssets } from './loader.ts'
import { parseAssetManifest } from './registry.ts'
import {
  isExecutableContent,
  isSafeRelativePath,
  scanSuspiciousText,
  SECRET_SCAN_NOTE,
  serializeStudioNextDefinition,
  splitStudioNextYaml,
  walkTree,
  type MountStampKey,
  type SuspiciousHit,
  type TreeEntry,
} from './hygiene.ts'

/** 包清单落点（本波最小 manifest；SCH-PKG-01 全字段归 MIG-06——见头注） */
export const PACKAGE_MANIFEST_FILE = 'package.yaml'

/** 包清单交换标记（本波自有；公共 schema 身份未登记前不冒称） */
export const DEFINITION_PACKAGE_SCHEMA = 'studio-next/pkg-def@1'

/** 支持的 V2 规范主版本（未知主版本拒收——v2/10 §4.1/§5.2） */
export const DEFINITION_SPEC_MAJOR = 2

/** part 类型封闭集（v2/06 表 4；字面量主表 v2/09——`unknown` 单独处理：一律拒收） */
export const PART_TYPES = ['definition', 'asset', 'template-asset', 'evidence', 'license'] as const
export type PartType = (typeof PART_TYPES)[number]

/** v2/06 §4.1 目录契约封闭集（本波补 `package.yaml` 与 `assets/`——见头注缺口，不改上位卷） */
export const DEFINITION_PACKAGE_TOP_LEVEL = [
  PACKAGE_MANIFEST_FILE,
  'org-config.yaml',
  'charter.md',
  'charter',
  'departments',
  'prompts',
  'docs',
  'dependencies.yaml',
  'assets.yaml',
  'plugins',
  'assets',
  '.gitignore',
  'README.md',
  '.studio-next.yaml',
] as const

/** 明示自授/信任态断言（NEG-PKG-02/06：不得随包传播、不得作为激活依据） */
const SELF_TRUST_PATTERNS: readonly RegExp[] = [
  /本目录即权威/,
  /已取得信任/,
  /已激活权威/,
  /自授权/,
  /authoritative\s*:\s*true/i,
  /trusted\s*:\s*true/i,
  /activation\s*:\s*true/i,
]

/** 明示自授/信任态字段（org-config 顶层或 company 段） */
const SELF_TRUST_KEYS = ['trust', 'trusted', 'authoritative', 'activation', 'authority'] as const

/** 包 part 声明（索引闭包） */
export interface DefPkgPart {
  partId: string
  partType: PartType
}

/** PKG-DEF 最小清单 */
export interface DefPkgManifest {
  artifactId: string
  artifactVersion: string
  specVersion: string
  parts: DefPkgPart[]
}

const PartSchema = z.strictObject({
  partId: DotIdSchema,
  partType: z.string().min(1),
})

const ManifestSchema = z.strictObject({
  schema: z.literal(DEFINITION_PACKAGE_SCHEMA),
  artifactId: DotIdSchema,
  artifactVersion: SemverSchema,
  specVersion: SemverSchema,
  parts: z.array(PartSchema).min(1),
})

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** part 类型预检：未知/`unknown` 一律逐条指名拒收（NEG-PKG-01；E-SCH-001） */
function preflightPartTypes(raw: unknown): string[] {
  const root = asRecord(raw)
  const parts = root?.['parts']
  if (!Array.isArray(parts)) return []
  const problems: string[] = []
  for (const [index, item] of parts.entries()) {
    const part = asRecord(item)
    if (part === null) continue
    const type = part['partType']
    if (type === 'unknown') problems.push(`parts[${index}].partType=unknown`)
    else if (typeof type !== 'string' || !(PART_TYPES as readonly string[]).includes(type)) {
      problems.push(`parts[${index}].partType=${String(type)}`)
    }
  }
  return problems
}

/** 解析包清单（纯函数；未知 part 类型/未知键/未知主版本均拒收并指名） */
export function parseDefinitionManifest(src: string): DefPkgManifest {
  let raw: unknown
  try {
    raw = parseYaml(src)
  } catch (err) {
    configInvalid('defpkg/manifest-invalid', `package.yaml YAML 语法错误：${err instanceof Error ? err.message : String(err)}`)
  }
  const root = asRecord(raw)
  if (root === null) configInvalid('defpkg/manifest-invalid', 'package.yaml 顶层须为对象（PKG-DEF 清单）')
  if (root['schema'] !== DEFINITION_PACKAGE_SCHEMA) {
    configInvalid('defpkg/manifest-invalid', `package.yaml schema 须为 ${DEFINITION_PACKAGE_SCHEMA}（收到 ${String(root['schema'])}）`)
  }
  const specVersion = root['specVersion']
  if (typeof specVersion === 'string' && !specVersion.startsWith(`${DEFINITION_SPEC_MAJOR}.`)) {
    configInvalid(
      'defpkg/spec-version',
      `specVersion=${specVersion} 主版本不受支持（只收 ${DEFINITION_SPEC_MAJOR}.x；未知主版本拒收——v2/10 §4.1/§5.2）`,
    )
  }
  const problems = preflightPartTypes(root)
  if (problems.length > 0) {
    configInvalid(
      'defpkg/unknown-part',
      `未知/不可接受 part 类型（E-SCH-001——逐条指名，不得默认忽略）：${problems.join('、')}`,
    )
  }
  const parsed = ManifestSchema.safeParse(root)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n')
    configInvalid('defpkg/manifest-invalid', `package.yaml 结构不合法（strictObject——未知字段拒收）：\n${issues}`)
  }
  return {
    artifactId: parsed.data.artifactId,
    artifactVersion: parsed.data.artifactVersion,
    specVersion: parsed.data.specVersion,
    parts: parsed.data.parts.map((part) => ({ partId: part.partId, partType: part.partType as PartType })),
  }
}

// —— CL 结构判据（v2/03 §2.4；NEG-PKG-08） ——

/** 结构事实（记录/投影面注入；本件不读取记录——owner=组织投影/记录面） */
export interface OrgStructureFacts {
  /** 有效设立记录 */
  established: boolean
  /** 有效 root_delegation（外部老板 → 最高宰相） */
  rootDelegation: boolean
  /** 最高宰相在编，或登记缺位（缺位也满足 CL2 的第三项） */
  bossCovered: boolean
  /** 在编职级（G 号；如 [8, 7, 5]） */
  inPositionLevels: readonly number[]
  /** D8 部门数 */
  deptCount: number
  /** 部门嵌套深度（一层=1） */
  maxDeptDepth: number
  /** 专职部门审计位置在编 */
  auditPosition: boolean
}

/** CL 主张判定结果（verified=false 表示无结构事实可判——不得据此宣称已升层） */
export interface LevelClaimReport {
  claimed?: number
  computedMax?: number
  verified: boolean
  ok: boolean
  reason?: string
}

/** 结构可判定的最高 CL（逐层累进，判据原文 v2/03 §2.4-2；N 不参与） */
export function computedMaxLevel(facts: OrgStructureFacts): number {
  const has = (level: number): boolean => facts.inPositionLevels.includes(level)
  if (!(facts.established && facts.rootDelegation && facts.bossCovered)) return 1
  let level = 2
  if (!has(1) && !has(2)) return level
  level = 3
  if (!(facts.deptCount >= 1 && has(8))) return level
  level = 4
  if (!has(7)) return level
  level = 5
  if (!(facts.deptCount >= 2 && has(6))) return level
  level = 6
  if (!(facts.maxDeptDepth >= 2 && facts.auditPosition)) return level
  level = 7
  if (!(has(5) && has(4) && has(3) && facts.maxDeptDepth >= 3)) return level
  level = 8
  if (!([2, 3, 4, 5, 6, 7, 8].every(has) && facts.deptCount >= 3 && facts.auditPosition)) return level
  return 9
}

/**
 * CL 主张判定：**结构事实**为准，`level` 只是主张（v2/03 §2.4-1）。
 * 只改 level 字段而结构不达 → 拒（NEG-PKG-08 / NEG-ORG-06 同型）；无结构事实 → 未核验（诚实标损）。
 */
export function judgeLevelClaim(claimed: number | undefined, facts?: OrgStructureFacts): LevelClaimReport {
  if (claimed === undefined) return { verified: false, ok: true }
  if (facts === undefined) {
    return {
      claimed,
      verified: false,
      ok: true,
      reason: '未提供结构事实，CL 主张未核验（不得据此宣称已升层——v2/03 §2.4）',
    }
  }
  const computedMax = computedMaxLevel(facts)
  if (claimed > computedMax) {
    return {
      claimed,
      computedMax,
      verified: true,
      ok: false,
      reason: `CL${claimed} 主张超出结构可判定上限 CL${computedMax}——「只改 level 字段」无效（v2/03 §2.4；NEG-ORG-06 同型）`,
    }
  }
  return { claimed, computedMax, verified: true, ok: true }
}

// —— 定义包扫描（先校验后落位的第一步） ——

/** 单文件落位计划（内容已定；.studio-next.yaml 只留定义段） */
export interface DefPkgFilePlan {
  rel: string
  data: Buffer
  /** 定义段重写（挂载戳记已剥离） */
  transformed: boolean
}

/** 身份主张报告（非权威；与记录冲突一律以记录为准，不得激活——NEG-PKG-02） */
export interface IdentityClaimReport {
  present: boolean
  claimedState?: string
  authoritative: false
  activation: 'none'
  conflict: boolean
  note: string
}

/** 扫描产物（校验完成，未落位） */
export interface DefinitionPackageScan {
  manifest: DefPkgManifest
  files: DefPkgFilePlan[]
  assets: AssetLoadReport
  strippedStamps: MountStampKey[]
  identityClaim: IdentityClaimReport
  levelClaim: LevelClaimReport
  /** 只声明「未发现疑似」——不称绝无秘密（v2/15 §4.4） */
  scanNote: string
  executableFiles: string[]
  installAuthorization: 'required'
}

export interface ScanDefinitionPackageOptions {
  sourceDir: string
  availableExecutors?: readonly Executor[]
  requiredAssetPolicy?: RequiredAssetPolicy
  decision?: RequiredAssetDecisionByName
  structureFacts?: OrgStructureFacts
  /** 记录侧身份状态（可选；给了就与包内主张对照，冲突以记录为准且不得激活） */
  identityRecordState?: string
}

function readLevelClaim(orgConfig: Record<string, unknown>): number | undefined {
  const company = asRecord(orgConfig['company'])
  const raw = orgConfig['levelClaim'] ?? company?.['level']
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string') {
    const match = /^(?:CL)?([1-9])$/.exec(raw.trim())
    if (match !== null && match[1] !== undefined) return Number(match[1])
  }
  return undefined
}

/** 目录树静态卫生（符号链接/本地产物/封闭集外顶层/路径逃逸） */
function assertTreeHygiene(entries: readonly TreeEntry[]): void {
  for (const entry of entries) {
    if (entry.kind === 'symlink') {
      configInvalid('defpkg/symlink', `包内符号链接（当前口径全拒——v2/06 §4.6）：${entry.rel}`)
    }
    if (!isSafeRelativePath(entry.rel)) {
      configInvalid('defpkg/path-escape', `包内路径不安全（绝对路径/.. 逃逸）：${entry.rel}`)
    }
  }
  for (const forbidden of ['.git', '.AIWS', '.studio-next']) {
    if (entries.some((entry) => entry.rel === forbidden || entry.rel.startsWith(`${forbidden}/`))) {
      configInvalid('defpkg/forbidden-path', `包内出现 ${forbidden}/（本地产物/信任态/版本控制——不随包传播，v2/06 §4.1）`)
    }
  }
  for (const entry of entries) {
    const top = entry.rel.split('/')[0] ?? ''
    if (!(DEFINITION_PACKAGE_TOP_LEVEL as readonly string[]).includes(top)) {
      configInvalid('defpkg/unknown-top-level', `目录契约封闭集外的顶层项：${top}（v2/06 §4.1；豁免须显式留痕）`)
    }
  }
}

/** 生命期脚本/包管理工程闸（v2/10 §4.8：不因解包触发安装脚本） */
function assertNoLifecycleScripts(rel: string, text: string): void {
  if (path.posix.basename(rel) !== 'package.json') return
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(text) as Record<string, unknown>
  } catch {
    configInvalid('defpkg/executable-outside-plugins', `package.json 解析失败（包管理通道——不自动执行）：${rel}`)
  }
  const scripts = asRecord(pkg['scripts'])
  const lifecycle = scripts === null ? undefined : ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly'].find((key) => scripts[key] !== undefined)
  if (lifecycle !== undefined) {
    configInvalid('defpkg/lifecycle-script', `${rel} 声明了生命周期脚本 ${lifecycle}（导入不执行、不得夹带——v2/10 §4.8）`)
  }
}

/**
 * 扫描 PKG-DEF（只读；不执行、不落位）：
 * 目录卫生 → 清单/part 闭包 → 定义部可装性 → 秘密/路径 → 可执行内容边界 → 戳记剥离 →
 * 资产部装载 → 身份主张从属 → CL 结构判据。任一不满足即抛 CONFIG_INVALID/defpkg/*。
 */
export async function scanDefinitionPackage(opts: ScanDefinitionPackageOptions): Promise<DefinitionPackageScan> {
  const sourceDir = path.resolve(opts.sourceDir)
  if (!existsSync(sourceDir)) configInvalid('defpkg/source-missing', `定义包目录不存在：${sourceDir}`)
  const entries = await walkTree(sourceDir)
  assertTreeHygiene(entries)
  const files = entries.filter((entry) => entry.kind === 'file')

  const manifestPath = path.join(sourceDir, PACKAGE_MANIFEST_FILE)
  if (!existsSync(manifestPath)) {
    configInvalid(
      'defpkg/manifest-missing',
      `缺 ${PACKAGE_MANIFEST_FILE}：part 语义无法表达（v2/06 §4.3 不得由默认值虚构完整）——拒收`,
    )
  }
  const manifest = parseDefinitionManifest(await readFile(manifestPath, 'utf8'))

  // 定义部可装性前置：公司索引必备（装不动即拒收并指名——v2/06 §3.4）
  if (!files.some((entry) => entry.rel === 'org-config.yaml')) {
    configInvalid('defpkg/definition-uninstallable', '定义部缺 org-config.yaml（公司索引）——定义部装不动即拒收，不得降级装资产凑合')
  }

  // 资产位置（清单唯一索引；代码只允许 plugins/<assetId>/——v2/06 §4.5/§九-5）
  const assetsSource = files.some((entry) => entry.rel === 'assets.yaml')
    ? await readFile(path.join(sourceDir, 'assets.yaml'), 'utf8')
    : ''
  const assetEntries = assetsSource === '' ? [] : parseAssetManifest(assetsSource).entries
  const pluginDirs = new Set(
    assetEntries
      .filter((entry) => entry.type === 'plugin' && entry.binding === 'exclusive')
      .map((entry) => path.posix.join('plugins', entry.assetId)),
  )
  const inPluginDir = (rel: string): boolean =>
    [...pluginDirs].some((dir) => rel === dir || rel.startsWith(`${dir}/`))

  const filePlans: DefPkgFilePlan[] = []
  const executableFiles: string[] = []
  const suspicious: SuspiciousHit[] = []
  let strippedStamps: MountStampKey[] = []
  let orgConfigText = ''
  let levelClaim: LevelClaimReport = { verified: false, ok: true }

  for (const file of files) {
    const data = await readFile(file.abs)
    const text = data.toString('utf8')
    const isText = !data.includes(0)
    if (isText) suspicious.push(...scanSuspiciousText(text, file.rel))
    if (isText && SELF_TRUST_PATTERNS.some((pattern) => pattern.test(text))) {
      configInvalid(
        'defpkg/trust-claim',
        `包内出现自授/信任态文本（${file.rel}）——不得随公开定义传播（v2/06 §九-2/§九-6）`,
      )
    }
    if (file.rel === 'org-config.yaml') orgConfigText = text
    if (isExecutableContent(file.rel, data) && !inPluginDir(file.rel)) executableFiles.push(file.rel)
    if (isText) assertNoLifecycleScripts(file.rel, text)

    if (file.rel === '.studio-next.yaml') {
      let split: ReturnType<typeof splitStudioNextYaml>
      try {
        split = splitStudioNextYaml(text)
      } catch (err) {
        configInvalid('defpkg/definition-uninstallable', `.studio-next.yaml 解析失败（定义部装不动）：${err instanceof Error ? err.message : String(err)}`)
      }
      if (split.unknownKeys.length > 0) {
        configInvalid(
          'defpkg/stamp-unknown-key',
          `.studio-next.yaml 出现定义段/挂载戳记之外的键：${split.unknownKeys.join('、')}（戳记须剥离、未知键拒收——v2/06 §4.4）`,
        )
      }
      strippedStamps = split.stripped
      const serialized = serializeStudioNextDefinition(split.definition)
      if (serialized !== null) filePlans.push({ rel: file.rel, data: Buffer.from(serialized, 'utf8'), transformed: true })
      continue
    }
    filePlans.push({ rel: file.rel, data, transformed: false })
  }

  if (suspicious.length > 0) {
    configInvalid(
      'defpkg/secret-suspect',
      `包内疑似秘密值/本机路径 ${suspicious.length} 处（隔离不放行；只报位置与类别、不回显值——v2/15 §四）：${suspicious
        .map((hit) => `${hit.path}:${hit.line}(${hit.kind}/${hit.pattern})`)
        .join('、')}`,
    )
  }
  if (executableFiles.length > 0) {
    configInvalid(
      'defpkg/executable-outside-plugins',
      `定义部/通用资产位置出现可执行内容（代码只允许 plugins/ 下 DSH 插件——v2/06 §4.5/§九-5）：${executableFiles.join('、')}`,
    )
  }

  // 定义部语义前置：依赖清单可解析（不得降级装资产凑合——NEG-PKG-09）
  const depsFile = files.find((entry) => entry.rel === 'dependencies.yaml')
  if (depsFile !== undefined) {
    try {
      parseDependencies(await readFile(depsFile.abs, 'utf8'))
    } catch (err) {
      configInvalid(
        'defpkg/definition-uninstallable',
        `dependencies.yaml 不合法（定义部装不动即拒收——v2/06 §3.4）：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // 身份主张从属（NEG-PKG-02）：自称权威/信任态即拒；普通主张保留但非权威、不得激活
  let identityClaim: IdentityClaimReport = {
    present: false,
    authoritative: false,
    activation: 'none',
    conflict: false,
    note: '无身份主张（包内主张一律非权威，记录为准）',
  }
  const orgConfig = ((): Record<string, unknown> => {
    try {
      const parsed: unknown = parseYaml(orgConfigText)
      return asRecord(parsed) ?? {}
    } catch (err) {
      configInvalid('defpkg/definition-uninstallable', `org-config.yaml 解析失败（定义部装不动）：${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  if (typeof orgConfig['schema'] !== 'string') {
    configInvalid('defpkg/definition-uninstallable', 'org-config.yaml 缺 schema 声明（公司索引不完整——定义部装不动即拒收）')
  }
  const company = asRecord(orgConfig['company'])
  if (company === null) {
    configInvalid('defpkg/definition-uninstallable', 'org-config.yaml 缺 company 段（公司索引不完整——定义部装不动即拒收）')
  }
  for (const key of SELF_TRUST_KEYS) {
    if (orgConfig[key] !== undefined || company?.[key] !== undefined) {
      configInvalid(
        'defpkg/trust-claim',
        `包内出现自授/信任态字段 ${key}（信任决定只能由有权部署者/合法设立程序作出——v2/06 §九-2/§九-6）`,
      )
    }
  }
  const identity = asRecord(orgConfig['identity'])
  const claimedState = typeof identity?.['claimedIdentityState'] === 'string' ? identity['claimedIdentityState'] : undefined
  if (identity !== null || claimedState !== undefined) {
    const conflict = claimedState !== undefined && opts.identityRecordState !== undefined && claimedState !== opts.identityRecordState
    identityClaim = {
      present: true,
      ...(claimedState !== undefined ? { claimedState } : {}),
      authoritative: false,
      activation: 'none',
      conflict,
      note: conflict
        ? `包内主张 ${claimedState} 与记录 ${opts.identityRecordState} 冲突——以记录为准，不得激活（v2/06 §九-2）`
        : '身份/状态主张非权威：不作激活依据，冲突一律以记录为准（v2/01 §五）',
    }
  }
  const claimedLevel = readLevelClaim(orgConfig)
  if (claimedLevel !== undefined && (claimedLevel < 2 || claimedLevel > 9)) {
    configInvalid('defpkg/level-claim', `CL 主张 ${claimedLevel} 超出 2..9（CL1 不成公司——v2/03 §2.4）`)
  }
  if (claimedLevel !== undefined) levelClaim = judgeLevelClaim(claimedLevel, opts.structureFacts)
  if (!levelClaim.ok) configInvalid('defpkg/level-claim', levelClaim.reason ?? 'CL 主张与结构不符')

  // 资产部装载（无清单=零资产；必备不可用按 v2/06 §3.4 二选一）
  return {
    manifest,
    files: filePlans,
    assets: await loadAssets(sourceDir, opts),
    strippedStamps: [...strippedStamps],
    identityClaim,
    levelClaim,
    scanNote: SECRET_SCAN_NOTE,
    executableFiles,
    installAuthorization: 'required',
  }
}

/** 资产装载封装（保留调用点单一，便于测试替换语义——仍走同一 loader） */
async function loadAssets(sourceDir: string, opts: ScanDefinitionPackageOptions): Promise<AssetLoadReport> {
  return loadCompanyAssets({
    companyDir: sourceDir,
    ...(opts.availableExecutors !== undefined ? { availableExecutors: opts.availableExecutors } : {}),
    ...(opts.requiredAssetPolicy !== undefined ? { requiredAssetPolicy: opts.requiredAssetPolicy } : {}),
    ...(opts.decision !== undefined ? { decision: opts.decision } : {}),
  })
}
