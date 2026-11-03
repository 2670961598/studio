/**
 * control/restart/checkpoint —— 受权重启检查点与退出标记（studio-dev-504 S3）
 *
 * 依据（实现单引用）：#497 plan §4.5（检查点协议：事件先行→摘要 JSON→kv→WAL checkpoint→
 *   close→last-exit.json，顺序即正确性）、§4.2（退出码/exitClass 契约）、§4.7（supervisor
 *   只读 last-exit.json）；docs/17-§2（进程边界收口，不增删主循环相位）。
 *
 * 原子写纪律：同目录 tmp + fsync(file) + rename + fsync(dir)——半写不可达；写失败即抛，
 * 调用方 exit 1 + ALARM 且**不写 authorized 标记**（不假装干净重启）。
 *
 * 诚实边界：repoHead/assetFingerprint 在 git 命令面不可用时如实为 null（versionAlign=unknown），
 * 不伪造版本对齐证据（#497 §4.10）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sha256Hex } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { writeJsonAtomic } from '../channel/file-io.ts'
import { restartDirOf, type RestartActor } from './channel.ts'

const LAST_EXIT_FILE = 'last-exit.json'

/** 在途结算明细（自然收口/超时收口都在摘要里如实列出） */
export interface RestartSettledItem {
  issue: string
  attempt: number
  status: string
}

/** 检查点摘要（形态冻结于 #497 §4.5，字段可向后兼容追加） */
export interface RestartCheckpoint {
  schema: 1
  requestId: string
  at: number
  company: string
  reason: string
  authorizer: { personId: string; role: string; level: number }
  authorizationRef: string
  exitClass: 'restart'
  tickSeq: number
  cursor: string | null
  inflightBefore: number
  settled: readonly RestartSettledItem[]
  interrupted: readonly RestartSettledItem[]
  inconsistent: boolean
  ledger: { path: string; walBefore: number; walAfter: number }
  repoHead: string | null
  assetFingerprint: string | null
  eventId: string
}

/** 退出标记（supervisor 拉起判据：0 无法区分授权重启与 SIGTERM，必须读 exitClass） */
export interface LastExitMark {
  schema: 1
  authorized: boolean
  exitClass: 'restart' | 'signal' | 'crash'
  requestId?: string
  at: number
  checkpoint?: { path: string; hash: string }
  interrupted?: number
}

export interface WrittenCheckpoint {
  path: string
  hash: string
  bytes: string
}

/**
 * sha256（检查点引用/证据哈希）：**哈希单源**=`@studio-next/core` 的 `sha256Hex`（ENC-08）——
 * studio-dev-555 消除本仓第 7 处 createHash 直连；本件只保留 `sha256:` 前缀形（既有口径）。
 */
export function sha256(text: string): string {
  return `sha256:${sha256Hex(text)}`
}

/** 检查点文件绝对路径（<rootDir>/restart/checkpoint-<requestId>.json） */
export function checkpointPathOf(rootDir: string, requestId: string): string {
  return path.join(restartDirOf(rootDir), `checkpoint-${requestId}.json`)
}

/** 写检查点摘要；返回路径+内容哈希（哈希=写入字节，事件 note 引用同一值） */
export function writeRestartCheckpoint(rootDir: string, checkpoint: RestartCheckpoint): WrittenCheckpoint {
  const file = checkpointPathOf(rootDir, checkpoint.requestId)
  const bytes = writeJsonAtomic(file, checkpoint, { mode: 0o600 })
  return { path: file, hash: sha256(bytes), bytes }
}

/** 写 last-exit.json（最后写：它出现=可以拉起） */
export function writeLastExit(rootDir: string, mark: LastExitMark): string {
  const file = path.join(restartDirOf(rootDir), LAST_EXIT_FILE)
  writeJsonAtomic(file, mark, { mode: 0o600 })
  return file
}

/**
 * 非受权重启的正常/信号退出标记（#497 §4.7 supervisor 契约：exitClass ∈ restart|signal|crash）。
 * 目的：清掉上一命的 restart 标记——否则下次启动会拿旧检查点重复自检、supervisor 误判「立即拉起」。
 * 仅在 restartEnabled 开面时由 runServe 调用；写失败不阻断停机（无标记=supervisor 按 crash 处理）。
 */
export function writeExitMarkOnStop(rootDir: string, stopReason: 'signal' | 'stop-request' | 'error', at: number): void {
  try {
    writeLastExit(rootDir, {
      schema: 1,
      authorized: false,
      exitClass: stopReason === 'error' ? 'crash' : 'signal',
      at,
    })
  } catch {
    // 无标记=supervisor 按 crash/退避处理（不冒充 authorized）
  }
}

/** 读 last-exit.json（无文件/坏 JSON=undefined——supervisor 按 crash/无标记处理） */
export function readLastExit(rootDir: string): LastExitMark | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(restartDirOf(rootDir), LAST_EXIT_FILE), 'utf8')) as Partial<LastExitMark>
    if (typeof parsed.at !== 'number' || typeof parsed.authorized !== 'boolean') return undefined
    const exitClass = parsed.exitClass
    if (exitClass !== 'restart' && exitClass !== 'signal' && exitClass !== 'crash') return undefined
    return {
      schema: 1,
      authorized: parsed.authorized,
      exitClass,
      at: parsed.at,
      ...(typeof parsed.requestId === 'string' ? { requestId: parsed.requestId } : {}),
      ...(parsed.checkpoint !== undefined && typeof parsed.checkpoint.path === 'string' && typeof parsed.checkpoint.hash === 'string'
        ? { checkpoint: { path: parsed.checkpoint.path, hash: parsed.checkpoint.hash } }
        : {}),
      ...(typeof parsed.interrupted === 'number' ? { interrupted: parsed.interrupted } : {}),
    }
  } catch {
    return undefined
  }
}

/** 读检查点摘要（按 last-exit 记录的路径；坏文件=undefined，不猜） */
export function readCheckpoint(file: string): RestartCheckpoint | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RestartCheckpoint>
    if (parsed.schema !== 1 || typeof parsed.tickSeq !== 'number' || typeof parsed.at !== 'number') return undefined
    return parsed as RestartCheckpoint
  } catch {
    return undefined
  }
}

/** 自检报告（四项 pass/detail + 交叉核对；落 var/restart/selfcheck-<ts>.json） */
export interface RestartSelfcheckReport {
  schema: 1
  at: number
  requestId: string
  checkpointRef: string | null
  result: 'pass' | 'fail'
  checks: {
    tick: SelfcheckCheck
    cursor: SelfcheckCheck
    models: SelfcheckCheck
    executor: SelfcheckCheck
  }
  inflightReconcile: { expected: number; actual: number; pass: boolean }
  versionAlign: 'aligned' | 'advanced' | 'unknown' | 'off'
}

export interface SelfcheckCheck {
  pass: boolean
  detail: string
}

/** 写自检报告（失败也落——「不宣称已恢复」的证据面） */
export function writeSelfcheckReport(rootDir: string, report: RestartSelfcheckReport): string {
  const file = path.join(restartDirOf(rootDir), `selfcheck-${report.at}.json`)
  writeJsonAtomic(file, report, { mode: 0o600 })
  return file
}

/**
 * 执行 WAL checkpoint(TRUNCATE) 并返回页数（S3 检查点第 5 步；store 薄面）。
 * busy≠0=有读者占用 → 抛错（检查点失败，exit 1 + ALARM，不静默跳过）。
 */
export function walCheckpoint(ledger: Ledger): { walBefore: number; walAfter: number } {
  return ledger.checkpoint()
}

/** 授权人摘要（检查点/事件同源；level 取组织快照而非请求自述） */
export function authorizerOf(actor: RestartActor, orgLevel: number, role: string): { personId: string; role: string; level: number } {
  return { personId: actor.personId, role, level: Math.min(9, Math.max(1, orgLevel)) }
}
