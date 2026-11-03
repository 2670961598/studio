/**
 * control/hot-reload/channel —— L1 热重载控制面文件通道（reload 子命令 ↔ daemon）
 *
 * 依据（实现单引用）：docs/38-§2 L1（手动通道）；docs/17-§2（拍边界收口——通道读写不改相位）；
 *   docs/17-§6（收割判据零变更）；docs/20-§十五.三（600 行阈：hot-reload.ts 拆件后原文件
 *   余量 ≥50，行为零漂移）。
 *
 * 边界：本件只做控制面文件通道（原子写/读/回执/轮询/无目录应答）；热重载执行体仍在
 *   hot-reload.ts（createHotReload）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// ————————————————————————— 控制面文件通道（reload 子命令 ↔ daemon） —————————————————————————

/** 控制面目录段（<rootDir>/control——workspace/tmp 同级，rootDir 旗下） */
export const CONTROL_DIR = 'control'
export const RELOAD_REQUEST_FILE = 'reload.request.json'
export const RELOAD_RESULT_FILE = 'reload.result.json'

/** reload 请求（CLI 写；company 缺省 null=不限家——daemon 侧比对） */
export interface ReloadRequest { id: string; company: string | null; requestedAt: number }

/** reload 回执（daemon 写；CLI 轮询至 id 匹配；applied=false=未动：unchanged/错家/失败面） */
export interface ReloadResult { id: string; ok: boolean; applied: boolean; reason?: string; detail?: string }

/** 控制面目录绝对路径（<rootDir>/control） */
export function controlDirOf(rootDir: string): string {
  return path.join(rootDir, CONTROL_DIR)
}

/** CLI 侧：原子写请求（tmp+rename——daemon 读到的恒是完整 JSON） */
export function writeReloadRequest(rootDir: string, request: ReloadRequest): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, RELOAD_REQUEST_FILE)
  const tmp = `${target}.tmp-${request.id}`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** daemon 侧：读请求（无文件/坏 JSON → undefined——控制面文件坏不当唤起，下拍再看） */
export function readReloadRequest(rootDir: string): ReloadRequest | undefined {
  const target = path.join(controlDirOf(rootDir), RELOAD_REQUEST_FILE)
  if (!existsSync(target)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<ReloadRequest>
    if (typeof parsed.id !== 'string' || parsed.id === '') return undefined
    return { id: parsed.id, company: typeof parsed.company === 'string' && parsed.company !== '' ? parsed.company : null, requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0 }
  } catch {
    return undefined
  }
}

/** daemon 侧：写回执（原子写；CLI 按 id 匹配消费） */
export function writeReloadResult(rootDir: string, result: ReloadResult): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, RELOAD_RESULT_FILE)
  const tmp = `${target}.tmp-${result.id}`
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢） */
export async function awaitReloadResult(rootDir: string, id: string, timeoutMs: number, pollMs = 100): Promise<ReloadResult | undefined> {
  const target = path.join(controlDirOf(rootDir), RELOAD_RESULT_FILE)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<ReloadResult>
        if (parsed.id === id) {
          return { id: parsed.id as string, ok: parsed.ok === true, applied: parsed.applied === true, ...(parsed.reason !== undefined ? { reason: String(parsed.reason) } : {}), ...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}) }
        }
      } catch {
        // 坏 JSON/读到写一半：下轮再读（daemon 侧原子写使本分支近不可达——兜底不炸）
      }
    }
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/** 未挂公司目录 daemon 的控制面应答：回执 no-company-dir（CLI 轮询不悬空），不重装载不落账。 */
export function answerReloadNoCompanyDir(rootDir: string, company: string, lastSeen: string | null): string | null {
  const request = readReloadRequest(rootDir)
  if (request === undefined || request.id === lastSeen) return lastSeen
  writeReloadResult(rootDir, { id: request.id, ok: false, applied: false, reason: 'no-company-dir', detail: `daemon 未挂公司目录（daemon.yaml companyDir 未配）——L1 配置热重载不适用；本 daemon company=${company}` })
  return request.id
}
