/**
 * company-commit · 写面与回滚（MIG-05 / IMPL-05-06）
 *
 * 依据：plan/05 IMPL-05-06（失败不留半 commit）；docs/04-§九「宁失败不半成品」同款纪律；
 *       docs/v2/05 §三 DOM-01（只写公司目录——本文件不触任何 git 内部文件、不碰库/平台）。
 *
 * 半成品防线（三层）：
 *   ① 写前快照：每目标路径的**存在性 + 逐字节内容 + 权限位**先读入内存（base64 保真，
 *      文本/二进制同路），回滚按快照逐字节复原；原不存在＝回滚时删除；
 *   ② 提交前校验：暂存集合必须 ⊆ 本单路径（防止工作树里他人改动被顺手带走）；
 *   ③ 失败回滚：`git reset` 撤暂存 → 快照复原 → 新建空目录清理，随后由编排层回读
 *      `git status` 断言「零残留」；回滚不完整＝拒并把残差如实上报（不宣称已回滚）。
 *
 * 目录创建：upsert 允许自动建父目录（新部门/config.yaml 首建）；回滚仅清理**本单新建**
 * 且已空的父目录——不删任何原有目录（不越权整理用户工作树）。
 */
import { chmod, lstat, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { commitInvalid } from './errors.ts'
import type { OrgChangeOp } from './types.ts'

/** 单路径写前快照（回滚唯一依据；不含目录） */
export interface PathSnapshot {
  readonly path: string
  readonly existed: boolean
  /** 逐字节内容（base64；existed=false 时 null） */
  readonly contentBase64: string | null
  /** 原权限位（existed=false 时 null；回滚复原可执行位等） */
  readonly mode: number | null
  /** 本单新建的父目录（相对路径，由外向内；回滚清理用） */
  readonly createdParents: readonly string[]
}

/** 逐条快照本单目标路径（写前调用；任一读失败＝拒，不带着不确定状态开写） */
export async function snapshotPaths(companyDir: string, relPaths: readonly string[]): Promise<readonly PathSnapshot[]> {
  const snapshots: PathSnapshot[] = []
  for (const relPath of relPaths) {
    const absolute = path.join(companyDir, relPath)
    const createdParents = await missingParents(companyDir, relPath)
    try {
      const info = await lstat(absolute)
      if (!info.isFile()) {
        commitInvalid('company-commit/target-not-file', `目标路径已存在但不是普通文件（${info.isDirectory() ? '目录' : '特殊文件'}）：${relPath}`)
      }
      const buffer = await readFile(absolute)
      snapshots.push({ path: relPath, existed: true, contentBase64: buffer.toString('base64'), mode: info.mode, createdParents })
    } catch (err) {
      if (isMissing(err)) {
        snapshots.push({ path: relPath, existed: false, contentBase64: null, mode: null, createdParents })
        continue
      }
      throw err
    }
  }
  return snapshots
}

/** 应用订单操作（顺序即订单顺序；写失败由编排层回滚） */
export async function applyOps(companyDir: string, ops: readonly OrgChangeOp[]): Promise<void> {
  for (const op of ops) {
    const absolute = path.join(companyDir, op.path)
    if (op.kind === 'upsert-file') {
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, op.content, { encoding: 'utf8' })
      continue
    }
    await rm(absolute, { force: true })
  }
}

/** 按快照逐字节复原（提交失败后的回滚面；调用方先撤暂存） */
export async function restoreSnapshots(companyDir: string, snapshots: readonly PathSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const absolute = path.join(companyDir, snapshot.path)
    if (!snapshot.existed) {
      await removeIfPresent(absolute)
      for (const created of [...snapshot.createdParents].reverse()) {
        await removeIfEmpty(path.join(companyDir, created))
      }
      continue
    }
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, Buffer.from(snapshot.contentBase64 ?? '', 'base64'))
    if (snapshot.mode !== null) await chmod(absolute, snapshot.mode)
  }
}

/** 目标路径上不存在的父目录链（相对路径，由外向内；不含路径末段） */
async function missingParents(companyDir: string, relPath: string): Promise<readonly string[]> {
  const segments = relPath.split('/').slice(0, -1)
  const missing: string[] = []
  let current = companyDir
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      await lstat(current)
    } catch (err) {
      if (!isMissing(err)) throw err
      missing.push(path.relative(companyDir, current).split(path.sep).join('/'))
    }
  }
  return missing
}

/** 删除已存在文件（ENOENT/ENOTDIR 视为「本来就没有」；其余错误如实抛） */
async function removeIfPresent(absolute: string): Promise<void> {
  try {
    await rm(absolute, { force: true })
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

/** 空目录才删（非空/不存在/非目录一律不动——不整理用户工作树） */
async function removeIfEmpty(absolute: string): Promise<void> {
  try {
    await rmdir(absolute)
  } catch {
    // ENOTEMPTY/ENOENT：有人往里写过东西或已被清理——保留现状，不递归删
  }
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
