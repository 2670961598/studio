/**
 * control/channel/file-io —— 控制面文件通道 IO 原语（三通道单源）
 *
 * 依据：docs/17-§2（拍边界消费）；docs/41-§2（控制面文件协议）；docs/43-§五②（worker 写域
 *   不含 control/，防伪造靠写域+owner/mode/lstat）；docs/20-§十五.三（原子写/哈希单源——
 *   不许并行第 N 套实现）。
 *
 * 单源收敛（studio-dev-555）：本件是控制面**唯一**的
 *   ① 原子写（同目录 tmp → fsync(file) → rename → fsync(dir)，半写不可达）；
 *   ② fsync 路径面；③ 临时件清理；④ **fs 错误分类**（lstat/read 的「不存在 / 权限 / IO」三分）。
 * sha256 单源在 `@studio-next/core` 的 `sha256Hex`（ENC-08）——本件不重造哈希。
 *
 * 错误分类纪律（本单要求④）：**只有 ENOENT/ENOTDIR 才是「不存在」**；EACCES/EPERM 及一切
 * 其余 errno 归「权限/IO」面，调用方必须 fail-closed（拒绝并留痕），不得与 absent 混同。
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'

/** fs 错误三分（absent=文件不存在；denied=权限面；io=其余 IO 面） */
type FsErrorClass = 'absent' | 'denied' | 'io'

/** errno 提取（NodeJS.ErrnoException.code；非对象/无 code=undefined） */
function errnoOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** fs 错误分类（**单源判据**）：仅 ENOENT/ENOTDIR=「不存在」；EACCES/EPERM=权限；其余=IO。 */
function classifyFsError(err: unknown): FsErrorClass {
  const code = errnoOf(err)
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent'
  if (code === 'EACCES' || code === 'EPERM') return 'denied'
  return 'io'
}

/** 权限/IO 面问题描述（`errorClass` 只取 denied|io——absent 由调用方先行分流） */
export interface FsProblem {
  errorClass: 'denied' | 'io'
  code: string
  message: string
}

/** 错误 → FsProblem（classify=absent 的调用方不该走到这里；保守记 io，不冒充权限面） */
function fsProblemOf(err: unknown): FsProblem {
  const cls = classifyFsError(err)
  return {
    errorClass: cls === 'denied' ? 'denied' : 'io',
    code: errnoOf(err) ?? 'unknown',
    message: err instanceof Error ? err.message : String(err),
  }
}

// —— 以下原语仅本件/本域内使用（不导出：避免再造「零生产引用导出」面，studio-dev-555 要求③） ——

/** 路径 fsync（文件或目录；失败即抛——不静默） */
function fsyncPath(file: string): void {
  const fd = openSync(file, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** 删除临时件（写失败清理；不存在不抛） */
function removeQuietly(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    // 已不存在：清理幂等
  }
}

/** 原子写选项（mode=目标权限；tmpSuffix=临时件定名后缀，缺省 pid+时间戳） */
export interface AtomicWriteOptions {
  /** 目标文件权限（缺省=进程 umask 口径：restart 面给 0600，stop/reload 沿用原缺省） */
  mode?: number
  /** 临时件定名后缀（缺省 `pid-时间戳`；通道面传请求 id，保持「同名 tmp 幂等覆写」） */
  tmpSuffix?: string
}

/**
 * 原子写 JSON（同目录 tmp + fsync(file) + rename + fsync(dir)；失败清理 tmp 并**抛出**）。
 * 返回写入字节（调用方需引用同一字节的哈希时直接复用，避免二次序列化漂移）。
 */
export function writeJsonAtomic(file: string, value: unknown, opts: AtomicWriteOptions = {}): string {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  const suffix = opts.tmpSuffix ?? `${String(process.pid)}-${String(Date.now())}`
  const tmp = `${file}.tmp-${suffix}`
  try {
    if (opts.mode === undefined) writeFileSync(tmp, bytes, { encoding: 'utf8' })
    else writeFileSync(tmp, bytes, { encoding: 'utf8', mode: opts.mode })
    fsyncPath(tmp)
    renameSync(tmp, file)
    fsyncPath(dir)
  } catch (err) {
    removeQuietly(tmp)
    throw err
  }
  return bytes
}

/** 读文本三态（absent=不存在；problem=权限/IO——调用方按通道语义分流，不得静默当 absent） */
export type TextOutcome =
  | { kind: 'absent' }
  | { kind: 'ok'; text: string }
  | { kind: 'problem'; problem: FsProblem }

/** 读控制面文本文件的分类结果（不抛：错误进 problem 三态） */
export function readTextOutcome(file: string): TextOutcome {
  try {
    return { kind: 'ok', text: readFileSync(file, 'utf8') }
  } catch (err) {
    if (classifyFsError(err) === 'absent') return { kind: 'absent' }
    return { kind: 'problem', problem: fsProblemOf(err) }
  }
}

/** lstat 三态（absent=不存在；problem=权限/IO——**不得**与 absent 混同，fail-closed 用） */
export type LstatOutcome =
  | { kind: 'ok'; stat: Stats }
  | { kind: 'absent' }
  | { kind: 'problem'; problem: FsProblem }

/** lstat 分类（不抛：ENOENT/ENOTDIR=absent，其余进 problem） */
export function lstatOutcome(file: string): LstatOutcome {
  try {
    return { kind: 'ok', stat: lstatSync(file) }
  } catch (err) {
    if (classifyFsError(err) === 'absent') return { kind: 'absent' }
    return { kind: 'problem', problem: fsProblemOf(err) }
  }
}
