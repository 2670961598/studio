/**
 * assets/loader —— 资产部装载面（IMPL-05-01；G-DOM-07 / G-REC-ASSET）
 *
 * 依据链：
 *   - v2/06 §3.4（传播语义四情形＋装载报告：可用/不可用资产面与原因；必备不可用＝
 *     具名二选一，禁止静默忽略/冒充已装）、§3.5（传播≠授权）、§4.5（plugins/ 四条约束：
 *     条目＋专属标记、不获执行授权、字节惰性、跨框架明示不可用）、§九（强制失败出口）
 *   - v2/10 §4.4（ASSET-01 字段）、§4.8（字节惰性：文件可执行≠被调用）
 *   - v2/11 §十一 REC-ASSET-01（专属标记与未表达项不得丢弃、不得宣称等价承载）
 *   - v2/15 §四（秘密/本机路径：隔离＋明示限制，不称「绝无秘密」）
 *   - plan/05 IMPL-05-01
 *
 * 装载语义（结构上无「默认可用」）：
 *   - 无清单 → 零资产（不按目录名猜测、不默认全收）；目录里有资产文件反而登记为
 *     「未列出资产」索引违反；
 *   - 必备资产不可用 → judgeRequiredAssets（dependencies.ts）二选一：缺省 refuse（抛错拒绝），
 *     degrade 必须带具名 decision；
 *   - 专属资产缺目标执行器 → incompatible 逐条进报告（不降级成通用资产）；
 *   - 任何资产文件都不执行、不落位到可执行位置——本件只读＋打标记。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import { judgeRequiredAssets } from '../dependencies.ts'
import { isPluginAssetPosition, assetLocation, digestAssetDirectory, findUnlistedAssetFiles, parseAssetManifest } from './registry.ts'
import {
  decodeText,
  isExecutableContent,
  isInsideRoot,
  isRealDirectory,
  scanSuspiciousText,
  SECRET_SCAN_NOTE,
  walkTree,
} from './hygiene.ts'
import {
  ASSET_MANIFEST_FILE,
  type AssetEntry,
  type AssetIssue,
  type AssetLoadItem,
  type AssetLoadReport,
  type AssetManifestWarning,
  type LoadCompanyAssetsOptions,
  type RequiredAssetUnavailable,
} from './types.ts'

/** 插件形态闸（沿用 51-D-4：package.json name/version + dsh.bundle.patch 在位） */
interface PluginShapeVerdict {
  ok: boolean
  reason?: string
  executableContent: boolean
}

async function checkDshPluginShape(absDir: string, executableContent: boolean): Promise<PluginShapeVerdict> {
  const pkgFile = path.join(absDir, 'package.json')
  if (!existsSync(pkgFile)) return { ok: false, reason: '插件缺 package.json（51-D-4 形态闸）', executableContent }
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as Record<string, unknown>
  } catch {
    return { ok: false, reason: '插件 package.json 解析失败（51-D-4 形态闸）', executableContent }
  }
  if (typeof pkg['name'] !== 'string' || pkg['name'] === '' || typeof pkg['version'] !== 'string' || pkg['version'] === '') {
    return { ok: false, reason: '插件 package.json 缺非空 name/version（51-D-4 形态闸）', executableContent }
  }
  const dsh = typeof pkg['dsh'] === 'object' && pkg['dsh'] !== null ? (pkg['dsh'] as Record<string, unknown>) : null
  const bundle = dsh === null ? null : dsh['bundle']
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    return { ok: false, reason: '插件缺 dsh.bundle 声明（profile 层入场券——51-D-4 / docs/34 §3.1）', executableContent }
  }
  const patch = (bundle as Record<string, unknown>)['patch']
  if (typeof patch !== 'string' || patch === '') {
    return { ok: false, reason: '插件 dsh.bundle.patch 非法（51-D-4 形态闸）', executableContent }
  }
  const patchAbs = path.join(absDir, patch)
  if (!isInsideRoot(absDir, patchAbs)) return { ok: false, reason: `插件 patch 指到资产目录外：${patch}（路径逃逸）`, executableContent }
  if (!existsSync(patchAbs)) return { ok: false, reason: `插件 dsh.bundle.patch 所指文件不在位：${patch}（51-D-4）`, executableContent }
  return { ok: true, executableContent }
}

/** 资产目录扫描结果（秘密/本机路径/可选性判断的共用输入） */
interface AssetDirectoryScan {
  entries: Awaited<ReturnType<typeof walkTree>>
  executableContent: boolean
  suspects: number
}

async function scanAssetDirectory(absDir: string, relDir: string): Promise<AssetDirectoryScan> {
  const entries = await walkTree(absDir)
  let executableContent = false
  let suspects = 0
  for (const entry of entries) {
    if (entry.kind !== 'file') continue
    const data = await readFile(entry.abs)
    const text = decodeText(data)
    if (isExecutableContent(entry.rel, data)) executableContent = true
    if (text !== null) suspects += scanSuspiciousText(text, path.posix.join(relDir, entry.rel)).length
  }
  return { entries, executableContent, suspects }
}

/** 单条目装载判定（loaded/missing/incompatible/blocked——逐项给原因） */
async function loadEntry(
  companyDir: string,
  entry: AssetEntry,
  availableExecutors: ReadonlySet<string>,
  issues: AssetIssue[],
): Promise<{ item: AssetLoadItem; suspects: number }> {
  const location = assetLocation(entry)
  const abs = path.join(companyDir, location)
  const base: AssetLoadItem = {
    assetId: entry.assetId,
    type: entry.type,
    binding: entry.binding,
    ...(entry.targetExecutor !== undefined ? { targetExecutor: entry.targetExecutor } : {}),
    required: entry.requiredness.required,
    state: 'blocked',
    reason: '',
    installAuthorization: 'required',
    executableContent: false,
  }
  const blocked = (reason: string, code: string, hitCount = 0): { item: AssetLoadItem; suspects: number } => {
    issues.push({ code, ...(entry.assetId !== '' ? { assetId: entry.assetId } : {}), path: location, message: reason })
    return { item: { ...base, state: 'blocked', reason }, suspects: hitCount }
  }
  if (!isInsideRoot(companyDir, abs)) return blocked('资产位置越出公司目录（绝对路径/.. 逃逸）', 'assets/path-escape')
  if (!existsSync(abs)) {
    return { item: { ...base, state: 'missing', reason: `资产文件不在位：${location}（缺则不装载，不静默补）` }, suspects: 0 }
  }
  if (!(await isRealDirectory(abs))) return blocked(`资产位置不是普通目录（符号链接全拒——v2/06 §4.6）：${location}`, 'assets/symlink')

  const scan = await scanAssetDirectory(abs, location)
  const symlink = scan.entries.find((e) => e.kind === 'symlink')
  if (symlink !== undefined) return blocked(`资产目录含符号链接（全拒——v2/06 §4.6）：${symlink.rel}`, 'assets/symlink')
  if (!isPluginAssetPosition(entry) && scan.executableContent) {
    return blocked('定义部/通用资产位置含可执行内容——代码只允许 plugins/ 下 DSH 插件（v2/06 §4.5/§九-5）', 'assets/executable-outside-plugins')
  }
  if (isPluginAssetPosition(entry) && entry.targetExecutor !== 'dsh') {
    return blocked(`plugins/ 是 DSH 插件专属资产位，targetExecutor=${String(entry.targetExecutor)} 不合法（v2/06 §4.5）`, 'assets/plugin-position')
  }
  if (scan.suspects > 0) {
    return blocked('疑似秘密值/本机路径（隔离不放行；不称「绝无」——v2/15 §四）', 'assets/secret-suspect', scan.suspects)
  }
  const digest = await digestAssetDirectory(abs)
  if (digest.value !== entry.contentDigest.value) {
    return blocked(`内容摘要不符：声明 ${entry.contentDigest.value} / 实测 ${digest.value}（无摘要一致不得进入分发）`, 'assets/digest-mismatch')
  }
  let shape: PluginShapeVerdict = { ok: true, executableContent: scan.executableContent }
  if (isPluginAssetPosition(entry)) {
    shape = await checkDshPluginShape(abs, scan.executableContent)
    if (!shape.ok) return blocked(shape.reason ?? '插件形态不合法', 'assets/plugin-shape')
  }
  if (entry.binding === 'exclusive' && entry.targetExecutor !== undefined && !availableExecutors.has(entry.targetExecutor)) {
    const reason = `缺执行器 ${entry.targetExecutor}——专属资产不可用（v2/06 §3.4：明示，不冒充已装）`
    return {
      item: { ...base, state: 'incompatible', reason, location, executableContent: shape.executableContent },
      suspects: scan.suspects,
    }
  }
  return {
    item: { ...base, state: 'loaded', reason: '资产就位且摘要一致（装载≠安装授权——v2/06 §3.5）', location, executableContent: shape.executableContent },
    suspects: scan.suspects,
  }
}

/**
 * 装载公司资产（只读；不执行、不落位、不安装）。
 * 缺省 requiredAssetPolicy='refuse'：必备不可用直接抛 CONFIG_INVALID（拒绝装载，不得默认可用）。
 */
export async function loadCompanyAssets(opts: LoadCompanyAssetsOptions): Promise<AssetLoadReport> {
  const companyDir = path.resolve(opts.companyDir)
  const availableExecutors = new Set<string>(opts.availableExecutors ?? [])
  const policy = opts.requiredAssetPolicy ?? 'refuse'
  const warnings: AssetManifestWarning[] = []
  const issues: AssetIssue[] = []
  const manifestFile = path.join(companyDir, ASSET_MANIFEST_FILE)

  if (!existsSync(manifestFile)) {
    // 无清单=零资产；目录里有资产文件也不默认收集，只登记索引违反。
    const unlisted = await findUnlistedAssetFiles(companyDir, [])
    if (unlisted.length > 0) {
      issues.push({
        code: 'assets/unlisted',
        message: `无资产清单却有资产文件（无清单=零资产；未列出资产不装载）：${unlisted.join('、')}`,
      })
    }
    return {
      companyDir,
      manifestPresent: false,
      items: [],
      issues,
      warnings,
      unlisted,
      required: { policy, outcome: 'none', unavailable: [] },
      scan: { performed: true, suspects: 0, note: SECRET_SCAN_NOTE },
    }
  }

  const source = await readFile(manifestFile, 'utf8')
  const manifestHits = scanSuspiciousText(source, ASSET_MANIFEST_FILE)
  if (manifestHits.length > 0) {
    configInvalid(
      'assets/secret-suspect',
      `assets.yaml 含疑似秘密值/本机路径（只报类别与位置，不回显值——v2/15 §四）：${manifestHits
        .map((h) => `${h.path}:${h.line}(${h.kind}/${h.pattern})`)
        .join('、')}`,
    )
  }
  const parsed = parseAssetManifest(source)
  warnings.push(...parsed.warnings)
  const items: AssetLoadItem[] = []
  let suspects = 0
  for (const entry of [...parsed.entries].sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))) {
    const result = await loadEntry(companyDir, entry, availableExecutors, issues)
    items.push(result.item)
    suspects += result.suspects
  }
  const unlisted = await findUnlistedAssetFiles(companyDir, parsed.entries)
  for (const rel of unlisted) {
    issues.push({ code: 'assets/unlisted', path: rel, message: '资产文件无清单条目指向（索引唯一性违反——不装载）' })
  }

  const unavailable: RequiredAssetUnavailable[] = items
    .filter((item) => item.required && item.state !== 'loaded')
    .map((item) => ({ assetId: item.assetId, state: item.state, reason: item.reason }))
  const required = judgeRequiredAssets(unavailable, {
    policy,
    ...(opts.decision !== undefined ? { decision: opts.decision } : {}),
  })
  if (required.outcome === 'refused') {
    configInvalid(
      'assets/required-unavailable',
      `必备资产不可用，拒绝装载（v2/06 §3.4 二选一之拒绝；不得静默忽略/冒充已装）：${unavailable
        .map((u) => `${u.assetId}（${u.state}：${u.reason}）`)
        .join('、')}`,
    )
  }
  return {
    companyDir,
    manifestPresent: true,
    items,
    issues,
    warnings,
    unlisted,
    required,
    scan: { performed: true, suspects, note: SECRET_SCAN_NOTE },
  }
}

/** 报告摘要（面板/导入报告复用；只做计数，不改语义） */
export function summarizeAssetReport(report: AssetLoadReport): Record<'loaded' | 'missing' | 'incompatible' | 'blocked', number> {
  const counts = { loaded: 0, missing: 0, incompatible: 0, blocked: 0 }
  for (const item of report.items) counts[item.state] += 1
  return counts
}
