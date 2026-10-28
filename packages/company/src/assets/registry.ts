/**
 * assets/registry —— 资产清单唯一索引（ASSET-01；IMPL-05-01）
 *
 * 依据链：
 *   - v2/06 §3.2（表 3：清单是资产部**唯一索引**；包内每个资产文件须有条目指向；
 *     无清单=零资产公司——不按目录名猜测、不默认全收）、§4.1（assets.yaml 目标文件位）、
 *     §4.5（plugins/＝DSH 插件专属资产位）
 *   - v2/10 §4.4（SCH-ASSET-01 字段：assetId/type/contentDigest/provenance/binding/
 *     targetExecutor/requiredness/availability）、§八（E-SCH-001/E-SCH-003/W-SCH-002）
 *   - v2/11 §十一 REC-ASSET-01（专属标记与未解析项不得丢弃）
 *   - plan/05 IMPL-05-01
 *
 * 目录定位（本实现补位，见 types.ts 头注缺口 1）：
 *   - `plugins/<assetId>/`：type=plugin 且 binding=exclusive 的 DSH 插件位（v2/06 §4.5 四条约束）；
 *   - `assets/<assetId>/`：其余资产（generic 或非插件类型专属资产）。
 *   两种位置均由清单条目**指向**；目录存在但无条目＝未列出资产（索引违反，不装载）。
 *
 * 摘要：byteDigest（sha-256）按「排序 rel 路径 + NUL + 字节长 + NUL + 内容」计算；
 * 只收规范目录（符号链接全拒——v2/06 §4.6 现状口径，放宽须显式修订）。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'
import {
  ASSET_KINDS,
  ASSET_MANIFEST_FILE,
  ASSET_MANIFEST_SCHEMA,
  ASSET_EXCLUSIVITY_MARKERS,
  AssetAvailabilitySchema,
  AssetBindingSchema,
  AssetKindSchema,
  AssetProvenanceSchema,
  AssetRequirednessSchema,
  ContentDigestSchema,
  EXECUTOR_VALUES,
  GENERIC_ASSET_DIR,
  PLUGIN_ASSET_DIR,
  UNDECLARED_LICENSE_LABEL,
  type AssetEntry,
  type AssetManifestParseResult,
  type AssetManifestWarning,
  type AssetRegistrationPayload,
  type ContentDigest,
} from './types.ts'
import { isRealDirectory, walkTree } from './hygiene.ts'

/** 单条目 strict 形（未知键拒收——SCH-ASSET-01 封闭字段集） */
const AssetEntrySchema = z.strictObject({
  assetId: z.string().regex(/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,3}$/, 'assetId 须为 dotid（v2/10 §1.1）'),
  type: AssetKindSchema,
  contentDigest: ContentDigestSchema,
  provenance: AssetProvenanceSchema,
  binding: AssetBindingSchema.optional(),
  targetExecutor: z.enum(EXECUTOR_VALUES).optional(),
  requiredness: AssetRequirednessSchema,
  availability: AssetAvailabilitySchema,
})

/** 清单顶层 strict 形 */
const AssetManifestSchema = z.strictObject({
  schema: z.literal(ASSET_MANIFEST_SCHEMA),
  assets: z.array(AssetEntrySchema),
})

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 封闭枚举预检：未知类型/值**逐条指名**（NEG-PKG-01；E-SCH-001——不默认忽略） */
function preflightClosedValues(raw: unknown): { closedValues: string[]; unsafeIds: string[] } {
  const closedValues: string[] = []
  const unsafeIds: string[] = []
  const root = asRecord(raw)
  if (root === null) return { closedValues, unsafeIds }
  const assets = root['assets']
  if (!Array.isArray(assets)) return { closedValues, unsafeIds }
  for (const [index, item] of assets.entries()) {
    const entry = asRecord(item)
    if (entry === null) continue
    const at = `assets[${index}]`
    const type = entry['type']
    if (type !== undefined && !(ASSET_KINDS as readonly unknown[]).includes(type)) {
      closedValues.push(`${at}.type=${String(type)}`)
    }
    const binding = entry['binding']
    if (binding !== undefined && !(ASSET_EXCLUSIVITY_MARKERS as readonly unknown[]).includes(binding)) {
      closedValues.push(`${at}.binding=${String(binding)}`)
    }
    const executor = entry['targetExecutor']
    if (executor !== undefined && !(EXECUTOR_VALUES as readonly unknown[]).includes(executor)) {
      closedValues.push(`${at}.targetExecutor=${String(executor)}`)
    }
    const availability = asRecord(entry['availability'])
    const need = availability?.['need']
    if (need !== undefined && need !== 'needed' && need !== 'optional') {
      closedValues.push(`${at}.availability.need=${String(need)}`)
    }
    const assetId = entry['assetId']
    if (typeof assetId !== 'string' || !/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,3}$/.test(assetId)) {
      unsafeIds.push(`${at}.assetId=${String(assetId)}`)
    }
  }
  return { closedValues, unsafeIds }
}

/**
 * 解析 assets.yaml（纯函数）：
 *   - 未知顶层键/形状错误 → assets/manifest-invalid；
 *   - assetId 非 dotid（绝对路径/.. 逃逸）→ assets/invalid-id；
 *   - 未知资产类型/封闭枚举值 → assets/unknown-type（E-SCH-001，逐条指名）；
 *   - 重复 assetId → assets/duplicate-asset（E-SCH-003）；
 *   - 缺 binding → 按 generic 并警示（W-SCH-002）；exclusive 缺 targetExecutor
 *     或 generic 带 targetExecutor → 形状拒收（不静默改判）。
 */
export function parseAssetManifest(src: string): AssetManifestParseResult {
  let raw: unknown
  try {
    raw = parseYaml(src)
  } catch (err) {
    configInvalid('assets/manifest-invalid', `assets.yaml YAML 语法错误：${err instanceof Error ? err.message : String(err)}`)
  }
  const root = asRecord(raw)
  if (root === null) configInvalid('assets/manifest-invalid', 'assets.yaml 顶层须为对象（SCH-ASSET-01 清单）')
  if (root['schema'] !== ASSET_MANIFEST_SCHEMA) {
    configInvalid(
      'assets/manifest-invalid',
      `assets.yaml schema 须为 ${ASSET_MANIFEST_SCHEMA}（收到 ${String(root['schema'])}；未知主版本拒收——v2/10 §4.1/§5.2）`,
    )
  }
  const preflight = preflightClosedValues(root)
  if (preflight.unsafeIds.length > 0) {
    configInvalid(
      'assets/invalid-id',
      `assetId 不合法（dotid 之外一律拒收——绝对路径/.. 逃逸不可表达）：${preflight.unsafeIds.join('、')}`,
    )
  }
  if (preflight.closedValues.length > 0) {
    configInvalid(
      'assets/unknown-type',
      `未知资产类型/封闭枚举值（E-SCH-001——逐条指名，不得默认忽略）：${preflight.closedValues.join('、')}`,
    )
  }
  const parsed = AssetManifestSchema.safeParse(root)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  [${i.path.join('.') || '(root)'}] ${i.message}`).join('\n')
    configInvalid('assets/manifest-invalid', `assets.yaml 结构不合法（SCH-ASSET-01 strictObject——未知字段拒收）：\n${issues}`)
  }
  const warnings: AssetManifestWarning[] = []
  const entries: AssetEntry[] = []
  const seen = new Set<string>()
  for (const item of parsed.data.assets) {
    if (seen.has(item.assetId)) {
      configInvalid('assets/duplicate-asset', `资产清单重复 assetId=${item.assetId}（唯一索引违反——E-SCH-003）`)
    }
    seen.add(item.assetId)
    const binding = item.binding ?? 'generic'
    if (item.binding === undefined) {
      warnings.push({
        code: 'W-SCH-002',
        assetId: item.assetId,
        message: '缺专属标记，按 generic 处理并警示（W-SCH-002——不静默丢弃）',
      })
    }
    if (binding === 'exclusive' && item.targetExecutor === undefined) {
      configInvalid(
        'assets/binding-invalid',
        `exclusive 资产 ${item.assetId} 缺 targetExecutor（ENU-83：专属必标目标执行器，不得按通用处理）`,
      )
    }
    if (binding === 'generic' && item.targetExecutor !== undefined) {
      configInvalid(
        'assets/binding-invalid',
        `generic 资产 ${item.assetId} 不得带 targetExecutor=${item.targetExecutor}（ENU-83：绑定与标记互斥）`,
      )
    }
    entries.push({
      assetId: item.assetId,
      type: item.type,
      contentDigest: item.contentDigest,
      provenance: normalizeProvenance(item.provenance),
      binding,
      ...(item.targetExecutor !== undefined ? { targetExecutor: item.targetExecutor } : {}),
      requiredness: item.requiredness,
      availability: item.availability,
    })
  }
  return { entries, warnings }
}

/** zod 推断（optional 含 undefined）→ 领域类型（exactOptionalPropertyTypes 下须显式裁剪） */
function normalizeProvenance(raw: {
  publisher: string
  upstreamRef?: string | undefined
  version?: string | undefined
  license?: { licenseId: string; scope: string; textRef?: string | undefined } | undefined
}): AssetEntry['provenance'] {
  const license =
    raw.license === undefined
      ? undefined
      : {
          licenseId: raw.license.licenseId,
          scope: raw.license.scope,
          ...(raw.license.textRef !== undefined ? { textRef: raw.license.textRef } : {}),
        }
  return {
    publisher: raw.publisher,
    ...(raw.upstreamRef !== undefined ? { upstreamRef: raw.upstreamRef } : {}),
    ...(raw.version !== undefined ? { version: raw.version } : {}),
    ...(license !== undefined ? { license } : {}),
  }
}

/** 读清单（无文件=零资产公司：present=false；绝不按目录名默认收集） */
export async function readAssetManifest(
  companyDir: string,
): Promise<AssetManifestParseResult & { present: boolean; source: string }> {
  const file = path.join(path.resolve(companyDir), ASSET_MANIFEST_FILE)
  if (!existsSync(file)) return { present: false, source: '', entries: [], warnings: [] }
  const source = await readFile(file, 'utf8')
  return { present: true, source, ...parseAssetManifest(source) }
}

/** 清单条目 → 相对资产位置（目录契约；见头注） */
export function assetLocation(entry: Pick<AssetEntry, 'assetId' | 'type' | 'binding'>): string {
  const pluginPosition = entry.type === 'plugin' && entry.binding === 'exclusive'
  return path.posix.join(pluginPosition ? PLUGIN_ASSET_DIR : GENERIC_ASSET_DIR, entry.assetId)
}

/** 资产位置是否 DSH 插件专属位（代码只允许此处——v2/06 §4.5） */
export function isPluginAssetPosition(entry: Pick<AssetEntry, 'assetId' | 'type' | 'binding'>): boolean {
  return assetLocation(entry).startsWith(`${PLUGIN_ASSET_DIR}/`)
}

/**
 * 目录内容摘要（byteDigest；sha-256）：排序 rel 路径 + NUL + 字节长 + NUL + 内容。
 * 符号链接全拒（真实路径包含性检查由调用方另做——digest 不做 IO 越界判断）。
 */
export async function digestAssetDirectory(dir: string): Promise<ContentDigest> {
  const entries = await walkTree(dir)
  const bad = entries.find((e) => e.kind === 'symlink')
  if (bad !== undefined) configInvalid('assets/symlink', `资产目录含符号链接（当前口径全拒——v2/06 §4.6）：${bad.rel}`)
  const files = entries.filter((e) => e.kind === 'file').sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of files) {
    const data = await readFile(file.abs)
    hash.update(Buffer.from(`${file.rel}\u0000${data.byteLength}\u0000`, 'utf8'))
    hash.update(data)
  }
  return { algorithm: 'sha-256', value: hash.digest('hex'), kind: 'byte' }
}

/**
 * 未列出资产扫描（索引唯一性）：
 * 顶层 plugins/<名>/、assets/<名>/ 未被清单条目指向者 → 返回其相对路径。
 * 无清单=零资产：调用方传空条目集，得到全部候选位置。
 */
export async function findUnlistedAssetFiles(companyDir: string, entries: readonly AssetEntry[]): Promise<string[]> {
  const root = path.resolve(companyDir)
  const listed = new Set(entries.map((entry) => assetLocation(entry)))
  const unlisted: string[] = []
  for (const base of [PLUGIN_ASSET_DIR, GENERIC_ASSET_DIR]) {
    const dir = path.join(root, base)
    if (!existsSync(dir)) continue
    if (!(await isRealDirectory(dir))) {
      unlisted.push(base)
      continue
    }
    const children = await walkTree(root, base)
    for (const child of children) {
      const depth = child.rel.split('/').length
      if (depth === 2 && child.kind === 'dir') {
        if (!listed.has(child.rel)) unlisted.push(child.rel)
      } else if (depth === 2 && child.kind === 'file') {
        unlisted.push(child.rel)
      } else if (child.kind === 'symlink') {
        unlisted.push(child.rel)
      }
    }
  }
  return unlisted.sort()
}

/** 许可描述（未声明＝「待有权者决定」，不默认继承仓库 MIT——v2/06 表 3） */
export function describeLicense(entry: Pick<AssetEntry, 'provenance'>): string {
  return entry.provenance.license?.licenseId ?? UNDECLARED_LICENSE_LABEL
}

/**
 * 清单条目 → REC-ASSET-01 payload 形状（引 contract 工件，不复制字段表）。
 * `provenance.version` 未表达时返回 null——登记记录须可解析版本，本件不臆造。
 */
export function toAssetRegistrationPayload(
  entry: AssetEntry,
  indexRef: { refId: string; refVersion: string },
): AssetRegistrationPayload | null {
  const version = entry.provenance.version
  if (version === undefined) return null
  return {
    asset_kind: entry.type,
    exclusivity: {
      marker: entry.binding,
      ...(entry.targetExecutor !== undefined ? { target_executor: entry.targetExecutor } : {}),
      unexpressed_items: [],
    },
    provenance: {
      publisher: entry.provenance.publisher,
      version,
      digest: entry.contentDigest.value,
      license: describeLicense(entry),
    },
    compatibility:
      entry.binding === 'exclusive' ? [`executor:${entry.targetExecutor ?? '未表达'}`] : ['executor:generic'],
    propagation: {
      semantics: '资产传播≠授权：安装/加载/资格一律走 v2/07 能力链（v2/06 §3.5）',
      notes: [
        entry.binding === 'exclusive'
          ? `专属资产：接收方缺 ${entry.targetExecutor ?? '目标执行器'} 时明示不可用（v2/06 §3.4）`
          : '通用资产：按资产类型判定可装性并进装载报告（v2/06 §3.4）',
      ],
    },
    index_ref: { refId: indexRef.refId, refVersion: indexRef.refVersion },
  }
}

// ───────────────────── 内置示例资产登记（IMPL-05-05；84 裁决一「plugins/ 6 件保留不迁出」） ─────────────────────

/**
 * 内置资产登记（数据面；**只追加，不改 05-01 装载 API**）
 *
 * 依据链：
 *   - v2/06 §三（ASSET-01：专属标记/必备声明/来源与许可）、§3.3（必备资产=装载语义，非授权）、
 *     §3.4（缺目标执行器明示不可用；必备不可用由接收方具名二选一）、§3.5（传播≠授权）、
 *     §4.5（plugins/ 四条约束：①清单条目＋专属标记 ②不获执行授权 ③字节惰性 ④无 DSH 明示不可用）
 *   - v2/10 §4.4（SCH-ASSET-01 字段形状）、§4.8（字节惰性：文件可执行 ≠ 被调用）
 *   - v2/11 §十一 REC-ASSET-01（专属标记与未表达项不得丢弃、不得宣称等价承载）
 *   - plan/05 IMPL-05-05；plan/03 MIG-05 冻结物 B13（模板 plugins 目录恰 6 件，不迁出）
 *
 * 迁移缺口（诚实登记，不臆造能力）：
 *   1. `assets.yaml` 是资产清单目标文件位（v2/06 §4.1），但现行仓库规范封闭集（repo-validate
 *      的 CLOSED_TOP_FILES）未收该件——本波以**本数据面**作模板资产的清单来源（唯一索引的过渡
 *      承载）；assets.yaml 随模板分发＋仓库规范放宽归 v2/16。模板内因此**不得**另有 assets.yaml。
 *   2. 摘要为 byteDigest（口径同 `digestAssetDirectory`：排序 rel + NUL + 字节长 + NUL + 字节）；
 *      模板插件字节改动必须同改本表（`test/v2/templates.test.ts` 复算断言，防「登记≠实物」）。
 *   3. 本表只登记**内置示例**资产（框架仓自带）；公司自有资产以各自 assets.yaml 为准。
 *   4. 登记≠授权：装载只落位＋登记，安装/加载资格仍走 v2/07 能力链（v2/06 §3.5）。
 */
export interface BuiltinAssetRecord {
  /** 承载模板（仓内相对路径；`entry.provenance.upstreamRef` 的人读对应面） */
  template: string
  /** 资产文件（相对模板根；B13=6 件的逐件证据面——计数按清单，不按目录名猜） */
  files: readonly string[]
  /** ASSET-01 清单条目（exclusive＋targetExecutor=dsh；必备声明/来源/许可/摘要齐全） */
  entry: AssetEntry
}

/**
 * 模板携带的 DSH 插件资产（2 资产／6 件）：`binding=exclusive`＋`targetExecutor=dsh`
 * ——专属标记**不得丢失**（NEG-REC-11）；`requiredness.required=true` 是装载语义（必备声明），
 * 不是安装授权；接收方无 dsh 时按 v2/06 §3.4 明示不可用并由部署者具名二选一。
 */
export const builtinAssets: readonly BuiltinAssetRecord[] = [
  {
    template: 'templates/company-game',
    files: [
      'plugins/dsh-asset-check/cordis.patch.yml',
      'plugins/dsh-asset-check/package.json',
      'plugins/dsh-asset-check/src/index.mjs',
    ],
    entry: {
      assetId: 'dsh-asset-check',
      type: 'plugin',
      contentDigest: { algorithm: 'sha-256', value: '1f7a8a00280259110e766278f6f9bb83c6d5a1f8f155406a84f2b83e08f2dd6c', kind: 'byte' },
      provenance: {
        publisher: 'Studio Next 框架仓（templates/company-game）',
        upstreamRef: 'template.company-game',
        version: '1.0.0',
        license: { licenseId: 'mit', scope: '框架仓内示例资产（templates/**）；跨公司再分发不默认继承框架仓许可' },
      },
      binding: 'exclusive',
      targetExecutor: 'dsh',
      requiredness: {
        required: true,
        impactNote: '游戏包声明为必备资产（资源完整性检查是构建冒烟前置）：缺则公司声明不完整，按 v2/06 §3.4 具名二选一（拒绝/降级），不得静默忽略或冒充已装',
      },
      availability: {
        need: 'needed',
        impact: '缺 dsh 执行器或插件不可用时资源完整性检查不可用——传播损失须明示（专属资产的结构性代价，84-D1），不虚构能力（v2/02 能力缺失纪律）',
      },
    },
  },
  {
    template: 'templates/company-internet',
    files: [
      'plugins/dsh-web-test/cordis.patch.yml',
      'plugins/dsh-web-test/package.json',
      'plugins/dsh-web-test/src/index.mjs',
    ],
    entry: {
      assetId: 'dsh-web-test',
      type: 'plugin',
      contentDigest: { algorithm: 'sha-256', value: 'eccf5a19f0e4b2497b3848867802fa49b5706c90282b6833032addb8c534363e', kind: 'byte' },
      provenance: {
        publisher: 'Studio Next 框架仓（templates/company-internet）',
        upstreamRef: 'template.company-internet',
        version: '1.2.0',
        license: { licenseId: 'mit', scope: '框架仓内示例资产（templates/**）；跨公司再分发不默认继承框架仓许可' },
      },
      binding: 'exclusive',
      targetExecutor: 'dsh',
      requiredness: {
        required: true,
        impactNote: '互联网包声明为必备资产（前端冒烟测试是发布前置）：缺则公司声明不完整，按 v2/06 §3.4 具名二选一（拒绝/降级），不得静默忽略或冒充已装',
      },
      availability: {
        need: 'needed',
        impact: '缺 dsh 执行器或插件不可用时前端冒烟测试不可用——传播损失须明示（专属资产的结构性代价，84-D1），不虚构能力（v2/02 能力缺失纪律）',
      },
    },
  },
]
