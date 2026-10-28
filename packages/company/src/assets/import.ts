/**
 * assets/import —— PKG-DEF 定义包导入（IMPL-05-02；v2/06 §3.4/§4.4/§九）
 *
 * 依据链：
 *   - v2/06 §2.2（字节惰性：物化不执行包内文件）、§3.4（定义部必须可装；装不动即拒收并指名，
 *     不得静默降级）、§3.5（自动落位≠自动授权）、§4.4（挂载戳记传播前剥离）、
 *     §4.5（plugins/ 四条约束）、§九（强制失败出口）
 *   - v2/10 §4.7（戳记名单）、§4.8（偷渡通道全链路不执行）
 *   - plan/03 MIG-05 出口（「导入失败不留半包」）、plan/05 IMPL-05-02
 *
 * 先校验后落位（结构保证，不是纪律口号）：
 *   1. scanDefinitionPackage 完成全部只读校验（目录卫生/清单闭包/定义部可装性/秘密与路径/
 *      可执行边界/戳记剥离/资产装载/身份从属/CL 结构判据）；
 *   2. 校验通过才在同卷父目录创建暂存目录 `.defpkg-staging-<uuid>`，逐文件写计划内容；
 *   3. 写完一次 rename 到目标——**要么零落位，要么完整包**；失败只删暂存，目标目录不动。
 * 目标目录必须不存在（不覆盖、不合并——避免把旧包与新包搅成半包）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import {
  scanDefinitionPackage,
  type DefinitionPackageScan,
  type IdentityClaimReport,
  type LevelClaimReport,
  type OrgStructureFacts,
  type PartType,
} from './defpkg.ts'
import { isInsideRoot } from './hygiene.ts'
import type {
  AssetLoadReport,
  Executor,
  RequiredAssetDecisionByName,
  RequiredAssetPolicy,
} from './types.ts'

/** 导入选项（与扫描选项同源；target 必须不存在） */
export interface ImportDefinitionPackageOptions {
  sourceDir: string
  targetDir: string
  availableExecutors?: readonly Executor[]
  requiredAssetPolicy?: RequiredAssetPolicy
  decision?: RequiredAssetDecisionByName
  structureFacts?: OrgStructureFacts
  identityRecordState?: string
}

/** 导入报告（落位后事实；资产不可用面逐条明示） */
export interface ImportDefinitionPackageReport {
  artifactId: string
  artifactVersion: string
  specVersion: string
  targetDir: string
  parts: { partId: string; partType: PartType }[]
  files: string[]
  assets: AssetLoadReport
  strippedStamps: string[]
  identityClaim: IdentityClaimReport
  levelClaim: LevelClaimReport
  installAuthorization: 'required'
  /** 暂存目录已消费（成功路径恒 false——失败不会返回报告） */
  staged: false
  scanNote: string
}

/** 导入前置：目标不允许与源互相包含（避免把包写进自己/覆盖来源） */
function assertTargetIsIndependent(sourceDir: string, targetDir: string): void {
  if (sourceDir === targetDir || isInsideRoot(sourceDir, targetDir) || isInsideRoot(targetDir, sourceDir)) {
    configInvalid('defpkg/target-conflict', `目标目录与源目录重叠（源 ${sourceDir} / 目标 ${targetDir}）——拒绝自包含导入`)
  }
}

/** 资产面进包闸：坏索引/缺文件/blocked 一律拒收（incompatible 由必备策略已判定，允许明示） */
function assertAssetsCommittable(scan: DefinitionPackageScan): void {
  const broken = scan.assets.items.filter((item) => item.state === 'missing' || item.state === 'blocked')
  if (scan.assets.unlisted.length > 0 || scan.assets.issues.length > 0 || broken.length > 0) {
    const details = [
      ...scan.assets.unlisted.map((rel) => `未列出：${rel}`),
      ...scan.assets.issues.map((issue) => `${issue.code}${issue.path !== undefined ? `(${issue.path})` : ''}：${issue.message}`),
      ...broken.map((item) => `${item.assetId}：${item.state}——${item.reason}`),
    ]
    configInvalid(
      'defpkg/assets-invalid',
      `资产部索引不完整/不合法，整包拒收（导入失败零落位）：${details.join('；')}`,
    )
  }
}

/** 暂存落盘（不执行任何文件；只写计划内容） */
async function stageFiles(stagingDir: string, scan: DefinitionPackageScan): Promise<void> {
  for (const file of scan.files) {
    const abs = path.join(stagingDir, file.rel)
    if (!isInsideRoot(stagingDir, abs)) {
      configInvalid('defpkg/path-escape', `计划文件越出暂存目录（路径逃逸）：${file.rel}`)
    }
    await mkdir(path.dirname(abs), { recursive: true })
    // 明文 0644：导入器不授予可执行位（落位≠可执行位置/安装授权——v2/06 §3.5）
    await writeFile(abs, file.data, { mode: 0o644 })
  }
}

/**
 * 导入 PKG-DEF：先校验后落位，失败不留半包（暂存目录清理、目标零改动）。
 * 落位＝文件到位（自动落位），**不等于**安装授权/执行授权（v2/06 §3.5）——
 * 资产安装仍走 v2/07 能力链，本件不代办落位到可执行位置。
 */
export async function importDefinitionPackage(opts: ImportDefinitionPackageOptions): Promise<ImportDefinitionPackageReport> {
  const sourceDir = path.resolve(opts.sourceDir)
  const targetDir = path.resolve(opts.targetDir)
  assertTargetIsIndependent(sourceDir, targetDir)
  if (existsSync(targetDir)) {
    configInvalid('defpkg/target-exists', `目标目录已存在：${targetDir}——不覆盖、不合并（避免半包）；请先由有权位置处置旧目录`)
  }
  const parent = path.dirname(targetDir)
  if (!existsSync(parent)) {
    configInvalid('defpkg/target-parent-missing', `目标父目录不存在：${parent}（不隐式建父链——避免失败落半套目录）`)
  }

  const scan = await scanDefinitionPackage({
    sourceDir,
    ...(opts.availableExecutors !== undefined ? { availableExecutors: opts.availableExecutors } : {}),
    ...(opts.requiredAssetPolicy !== undefined ? { requiredAssetPolicy: opts.requiredAssetPolicy } : {}),
    ...(opts.decision !== undefined ? { decision: opts.decision } : {}),
    ...(opts.structureFacts !== undefined ? { structureFacts: opts.structureFacts } : {}),
    ...(opts.identityRecordState !== undefined ? { identityRecordState: opts.identityRecordState } : {}),
  })
  assertAssetsCommittable(scan)

  const stagingDir = path.join(parent, `.defpkg-staging-${randomUUID()}`)
  let committed = false
  try {
    await mkdir(stagingDir)
    await stageFiles(stagingDir, scan)
    if (existsSync(targetDir)) {
      configInvalid('defpkg/target-exists', `目标目录在暂存期间出现：${targetDir}——拒绝覆盖（防半包）`)
    }
    await rename(stagingDir, targetDir)
    committed = true
  } finally {
    if (!committed) await rm(stagingDir, { recursive: true, force: true })
  }

  return {
    artifactId: scan.manifest.artifactId,
    artifactVersion: scan.manifest.artifactVersion,
    specVersion: scan.manifest.specVersion,
    targetDir,
    parts: scan.manifest.parts,
    files: scan.files.map((file) => file.rel).sort(),
    // 落位后资产报告指向目标目录（装载语义与源一致；位置字段是相对路径）
    assets: { ...scan.assets, companyDir: targetDir },
    strippedStamps: scan.strippedStamps,
    identityClaim: scan.identityClaim,
    levelClaim: scan.levelClaim,
    installAuthorization: 'required',
    staged: false,
    scanNote: scan.scanNote,
  }
}
