/**
 * control/channel/protocol —— 控制面文件通道通用协议（stop / reload / restart 三合一）
 *
 * 依据：docs/17-§2（daemon `control/` 域=热重载/停机通道；拍边界消费）；docs/41-§2（控制面
 *   停机通道文件协议）；docs/20-§十五.三/.四（尺寸阈与 contrib 纪律——新特性开子文件夹）。
 *
 * 为什么合并（studio-dev-555 架构债清理，非功能变更）：#504 落了第 3 套并行文件通道
 *   （`control/restart/channel.ts` 自带 write/read/consume/await + 私有原子写 + 第 7 处 sha256），
 *   与 `stop-channel.ts` / `hot-reload.ts` 三份同款协议各自演化。本件收口为**一套**协议：
 *   请求原子写 → daemon 侧分类读取（absent/权限-IO）→ 回执原子写 → 消费改名 `.consume` →
 *   CLI 轮询按 id 匹配。
 *
 * 只保留薄语义差异（各通道自己的形状/解码/权限位）：
 *   - 文件名三元组（request/result/consumed）；
 *   - 请求写入权限（restart=0600；stop/reload 沿用进程 umask 口径）；
 *   - 回执解码（stop: stopped / reload: applied / restart: state+accepted）。
 *
 * 错误语义（三通道一致，本单要求④）：**权限错/IO 错 ≠ 不存在**。`readRequest` 返回
 *   `kind:'problem'`（带 errorClass/code），restart 面据此 fail-closed 拒绝并留痕；
 *   stop/reload 面按「无 live 请求」降级（不当停机/不当唤起），但不再把权限错说成 absent。
 */
import { renameSync } from 'node:fs'
import path from 'node:path'
import { controlDirOf, controlFileOf } from './paths.ts'
import { readTextOutcome, writeJsonAtomic, type FsProblem } from './file-io.ts'

/** 通道文件名三元组（consumed=消费后留档名，live 面清空） */
export interface ControlChannelFiles {
  request: string
  result: string
  consumed: string
}

/** 请求文件读面三态（problem=权限/IO 面；**不得**当 absent 处理） */
export type ControlRequestRead =
  | { kind: 'absent' }
  | { kind: 'ok'; text: string; file: string }
  | { kind: 'problem'; file: string; problem: FsProblem }

/** 写面权限选项（缺省=进程 umask 口径） */
export interface ControlWriteOptions {
  mode?: number
}

/** 控制面通道门面（三通道共用同一实现，差异只在 spec） */
export interface ControlChannel<TReq extends { id: string }, TRes extends { id: string }> {
  readonly files: ControlChannelFiles
  /** 请求文件绝对路径（`<rootDir>/control/<request>`） */
  requestFileOf(rootDir: string): string
  /** 回执文件绝对路径（`<rootDir>/control/<result>`） */
  resultFileOf(rootDir: string): string
  /** CLI 侧：原子写请求（tmp+fsync+rename+dir fsync——daemon 读到的恒是完整 JSON） */
  writeRequest(rootDir: string, request: TReq, opts?: ControlWriteOptions): void
  /** daemon 侧：原子写回执（CLI 按 id 匹配——旧回执不误读） */
  writeResult(rootDir: string, result: TRes, opts?: ControlWriteOptions): void
  /** daemon 侧：消费请求（原子改名 .consume；失败=false 不抛——去重位由调用方 kv 兜底） */
  consumeRequest(rootDir: string): boolean
  /** daemon 侧：分类读取请求原文（不解析——形状归各通道自己的 schema） */
  readRequest(rootDir: string): ControlRequestRead
  /** 读回执（无文件/坏 JSON/非对象/解码失败=undefined；id 给定则须匹配） */
  readResult(rootDir: string, id?: string): TRes | undefined
  /** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢） */
  awaitResult(rootDir: string, id: string, timeoutMs: number, pollMs?: number): Promise<TRes | undefined>
}

/** 通道定义参数（薄语义差异的唯一落点） */
export interface ControlChannelSpec<TRes extends { id: string }> {
  files: ControlChannelFiles
  /** 回执解码（坏形态=undefined；不得抛） */
  decodeResult(raw: Record<string, unknown>): TRes | undefined
  /** 请求写入权限（restart=0600；缺省=进程 umask 口径） */
  requestMode?: number
  /** 回执写入权限（缺省=进程 umask 口径） */
  resultMode?: number
}

/** 声明一条控制面文件通道（三通道共用同一实现） */
export function defineControlChannel<TReq extends { id: string }, TRes extends { id: string }>(
  spec: ControlChannelSpec<TRes>,
): ControlChannel<TReq, TRes> {
  const modeOption = (mode: number | undefined): { mode?: number } => (mode === undefined ? {} : { mode })
  const requestFileOf = (rootDir: string): string => controlFileOf(rootDir, spec.files.request)
  const resultFileOf = (rootDir: string): string => controlFileOf(rootDir, spec.files.result)
  const consumedFileOf = (rootDir: string): string => path.join(controlDirOf(rootDir), spec.files.consumed)

  const readResult = (rootDir: string, id?: string): TRes | undefined => {
    const outcome = readTextOutcome(resultFileOf(rootDir))
    if (outcome.kind !== 'ok') return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(outcome.text)
    } catch {
      return undefined
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const raw = parsed as Record<string, unknown>
    const parsedId = raw['id']
    if (typeof parsedId !== 'string' || parsedId === '') return undefined
    const decoded = spec.decodeResult(raw)
    if (decoded === undefined) return undefined
    if (id !== undefined && decoded.id !== id) return undefined
    return decoded
  }

  return {
    files: spec.files,
    requestFileOf,
    resultFileOf,
    writeRequest(rootDir, request, opts) {
      writeJsonAtomic(requestFileOf(rootDir), request, {
        ...modeOption(opts?.mode ?? spec.requestMode),
        tmpSuffix: request.id,
      })
    },
    writeResult(rootDir, result, opts) {
      writeJsonAtomic(resultFileOf(rootDir), result, {
        ...modeOption(opts?.mode ?? spec.resultMode),
        tmpSuffix: result.id,
      })
    },
    consumeRequest(rootDir) {
      try {
        renameSync(requestFileOf(rootDir), consumedFileOf(rootDir))
        return true
      } catch {
        return false
      }
    },
    readRequest(rootDir) {
      const file = requestFileOf(rootDir)
      const outcome = readTextOutcome(file)
      if (outcome.kind === 'ok') return { kind: 'ok', text: outcome.text, file }
      if (outcome.kind === 'absent') return { kind: 'absent' }
      return { kind: 'problem', file, problem: outcome.problem }
    },
    readResult,
    async awaitResult(rootDir, id, timeoutMs, pollMs = 100) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const result = readResult(rootDir, id)
        if (result !== undefined) return result
        if (Date.now() >= deadline) return undefined
        await new Promise((resolve) => setTimeout(resolve, pollMs))
      }
    },
  }
}
