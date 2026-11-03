/**
 * control/hot-reload/channel —— L1 热重载控制面文件通道（reload 子命令 ↔ daemon）
 *
 * 依据（实现单引用）：docs/38-§2 L1（手动通道）；docs/17-§2（拍边界收口——通道读写不改相位）；
 *   docs/17-§6（收割判据零变更）；docs/20-§十五.三（600 行阈：hot-reload.ts 拆件后原文件
 *   余量 ≥50，行为零漂移）；docs/41-§2（控制面文件协议落点 `<rootDir>/control/`）。
 *
 * 边界：本件只做 reload 通道的**薄语义**（文件名三元组 + 回执解码）——原子写/分类读/消费/
 *   轮询的实现单源=`control/channel/protocol.ts`（studio-dev-555 三通道 stop/reload/restart
 *   合并，禁止再落第 N 套并行通道）；目录/路径单源=`control/channel/paths.ts`。
 *   热重载执行体仍在 hot-reload.ts（createHotReload）。
 *
 * 请求文件：<rootDir>/control/reload.request.json（{id, company|null, requestedAt}）；
 * 回执文件：reload.result.json（{id, ok, applied, reason?, detail?}）；消费后留档
 * reload.request.json.consume（live 面清空——重复消费不可达）。
 */
import { CONTROL_DIR as CONTROL_PATHS_DIR, controlDirOf as controlDirOfShared } from '../channel/paths.ts'
import { defineControlChannel } from '../channel/protocol.ts'

/** 控制面目录段（<rootDir>/control——workspace/tmp 同级，rootDir 旗下；三通道单源） */
export const CONTROL_DIR = CONTROL_PATHS_DIR
export const RELOAD_REQUEST_FILE = 'reload.request.json'
export const RELOAD_RESULT_FILE = 'reload.result.json'
export const RELOAD_REQUEST_CONSUMED_FILE = `${RELOAD_REQUEST_FILE}.consume`

/** reload 请求（CLI 写；company 缺省 null=不限家——daemon 侧比对） */
export interface ReloadRequest { id: string; company: string | null; requestedAt: number }

/** reload 回执（daemon 写；CLI 轮询至 id 匹配；applied=false=未动：unchanged/错家/失败面） */
export interface ReloadResult { id: string; ok: boolean; applied: boolean; reason?: string; detail?: string }

/** 控制面目录绝对路径（<rootDir>/control；三通道单源） */
export function controlDirOf(rootDir: string): string {
  return controlDirOfShared(rootDir)
}

const RELOAD_CHANNEL = defineControlChannel<ReloadRequest, ReloadResult>({
  files: { request: RELOAD_REQUEST_FILE, result: RELOAD_RESULT_FILE, consumed: RELOAD_REQUEST_CONSUMED_FILE },
  decodeResult: (raw) => ({
    id: raw['id'] as string,
    ok: raw['ok'] === true,
    applied: raw['applied'] === true,
    ...(raw['reason'] !== undefined ? { reason: String(raw['reason']) } : {}),
    ...(raw['detail'] !== undefined ? { detail: String(raw['detail']) } : {}),
  }),
})

/** CLI 侧：原子写请求（tmp+fsync+rename——daemon 读到的恒是完整 JSON） */
export function writeReloadRequest(rootDir: string, request: ReloadRequest): void {
  RELOAD_CHANNEL.writeRequest(rootDir, request)
}

/** daemon 侧：读请求（无文件/坏 JSON → undefined——控制面文件坏不当唤起，下拍再看） */
export function readReloadRequest(rootDir: string): ReloadRequest | undefined {
  const read = RELOAD_CHANNEL.readRequest(rootDir)
  // 权限/IO 面按「无 live 请求」降级（不当唤起）；分类保留在 read.kind 里不冒充 absent
  if (read.kind !== 'ok') return undefined
  try {
    const parsed = JSON.parse(read.text) as Partial<ReloadRequest>
    if (typeof parsed.id !== 'string' || parsed.id === '') return undefined
    return { id: parsed.id, company: typeof parsed.company === 'string' && parsed.company !== '' ? parsed.company : null, requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0 }
  } catch {
    return undefined
  }
}

/** daemon 侧：写回执（原子写；CLI 按 id 匹配消费） */
export function writeReloadResult(rootDir: string, result: ReloadResult): void {
  RELOAD_CHANNEL.writeResult(rootDir, result)
}

/** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢） */
export async function awaitReloadResult(rootDir: string, id: string, timeoutMs: number, pollMs = 100): Promise<ReloadResult | undefined> {
  return RELOAD_CHANNEL.awaitResult(rootDir, id, timeoutMs, pollMs)
}

/** 未挂公司目录 daemon 的控制面应答：回执 no-company-dir（CLI 轮询不悬空），不重装载不落账。 */
export function answerReloadNoCompanyDir(rootDir: string, company: string, lastSeen: string | null): string | null {
  const request = readReloadRequest(rootDir)
  if (request === undefined || request.id === lastSeen) return lastSeen
  writeReloadResult(rootDir, { id: request.id, ok: false, applied: false, reason: 'no-company-dir', detail: `daemon 未挂公司目录（daemon.yaml companyDir 未配）——L1 配置热重载不适用；本 daemon company=${company}` })
  return request.id
}
