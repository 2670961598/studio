/**
 * kimi-token —— Kimi（kimi-coding provider）access token 读取/按需刷新（docs/quality/kimi-on-dsh.md §3/§4）
 *
 * 依据（实现单引用）：docs/quality/kimi-on-dsh.md §0/§4（注入面规格）；docs/25-§二
 *   （TaskBrief v1.4 credentials：短命、按单、env 透传、值红名单）；docs/31-§3.5
 *   （dsh 凭据优先级：进程 env 最高——注入值覆盖隔离 home 里陈旧 seed 的 .env）。
 *
 * 职责：dispatch 相位、launch 前现读 token 文件（`~/Library/Application Support/
 *   StudioNext/secrets/kimi-access-token`，0600，内容仅 token——由 scripts/ops/
 *   kimi-token-refresh.mjs 原子维护）；文件缺失/龄大且 serve 注入了刷新面时先刷新再读。
 *   产物只有 `{ KIMI_API_KEY: <token> }` 一项，经 TaskBrief.credentials 注入（同
 *   STUDIO_TOOLS_WKEY 纪律：任何 note/日志/台账不含凭据值）。
 *
 * fail-safe 语义（§4）：读取/刷新任何失败都不抛、不阻派发——文件缺失或形状坏=不注入，
 *   worker 以 AUTH 失败收场→路由按 auth 类冷却换源（glm-main 兜底）；刷新失败=回退现有
 *   （可能陈旧的）文件值。本模块零日志（凭据面静默，失败可观测面在 worker 侧与路由事件）。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** pi-ai kimi-coding provider 的 env 键（provider 定义 envApiKeyAuth(["KIMI_API_KEY"])）。 */
export const KIMI_API_KEY_ENV = 'KIMI_API_KEY'
/** 路由源 provider id（models.yaml `provider: kimi-coding`）。 */
export const KIMI_CODING_PROVIDER = 'kimi-coding'
/** token 文件路径覆盖 env（与刷新器同名同源——serve 面与 CLI 面恒同一路径）。 */
export const STUDIO_KIMI_TOKEN_FILE_ENV = 'STUDIO_KIMI_TOKEN_FILE'
/**
 * 新鲜度阈值：文件 mtime 龄超此值即触发按需刷新（access_token TTL 900s，docs/31-§3.5）——
 * 保证 launch 时余量 ≥11 分钟。>15 分钟的长单中途 401 属已知限制（kimi-on-dsh §9-1）。
 */
export const KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT = 240_000

/** token 值下限（夹具/占位值防呆——真 access token 数百字符；短于此视为坏形状不注入）。 */
const MIN_TOKEN_LENGTH = 16

/** serve 注入面（assembly/serve/kimi-token-face.ts 产物）；缺省=纯读模式（不刷新）。 */
export interface KimiTokenDeps {
  /** token 文件路径（缺省 kimiTokenFilePath()） */
  tokenFile?: string
  /** 按需刷新（spawn 刷新器；自带串行化与吞错——返回 ok:false 不抛）；缺省=不刷新 */
  refresh?: () => Promise<{ ok: boolean }>
  /** 新鲜度阈值 ms（缺省 KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT；测试注入口） */
  maxAgeMs?: number
  /** 时钟（测试注入口） */
  now?: () => number
}

/** 缺省 token 文件路径（env 覆盖：STUDIO_KIMI_TOKEN_FILE）。 */
export function kimiTokenFilePath(env: Record<string, string | undefined> = process.env): string {
  const overridden = env[STUDIO_KIMI_TOKEN_FILE_ENV]
  return overridden !== undefined && overridden !== '' ? overridden : join(homedir(), 'Library', 'Application Support', 'StudioNext', 'secrets', 'kimi-access-token')
}

export interface KimiTokenFile {
  token: string
  ageMs: number
}

/**
 * 读 token 文件：缺失/空/多行/过短 → undefined（fail-safe 不抛——任何 IO/形状失败同义）。
 * mtime 即写入时刻（刷新器原子 rename 落盘）→ ageMs = now − mtime。
 */
export function readKimiTokenFile(deps: KimiTokenDeps | undefined): KimiTokenFile | undefined {
  const file = deps?.tokenFile ?? kimiTokenFilePath()
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const token = text.trim()
  if (token.length < MIN_TOKEN_LENGTH || token.includes('\n') || token.includes('\r')) return undefined
  let mtimeMs: number
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    return undefined
  }
  const now = deps?.now !== undefined ? deps.now() : Date.now()
  return { token, ageMs: Math.max(0, now - mtimeMs) }
}

/** 注入条件（§4）：执行器注册名为 dsh 家族（dsh / dsh-mid / dsh-high / dsh-low）且选中源 provider=kimi-coding。 */
export function kimiInjectionActive(executorName: string, provider: string | undefined): boolean {
  return (executorName === 'dsh' || executorName.startsWith('dsh-')) && provider === KIMI_CODING_PROVIDER
}

/**
 * 解析注入凭据（execute.ts launch 前调用；failover 换源后须重调——新源非 kimi-coding 即不注入）：
 * 条件不满足 → undefined；文件缺失/坏形状且刷新后仍缺 → undefined（不注入）；否则 KIMI_API_KEY。
 */
export async function kimiTokenCredentials(
  deps: KimiTokenDeps | undefined,
  input: { executorName: string; provider: string | undefined },
): Promise<Record<string, string> | undefined> {
  if (!kimiInjectionActive(input.executorName, input.provider)) return undefined
  let file = readKimiTokenFile(deps)
  const maxAgeMs = deps?.maxAgeMs ?? KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT
  if ((file === undefined || file.ageMs > maxAgeMs) && deps?.refresh !== undefined) {
    await deps.refresh() // 注入面吞错（ok:false）；此处不分支——重读即取最新可得值
    file = readKimiTokenFile(deps)
  }
  if (file === undefined) return undefined
  return { [KIMI_API_KEY_ENV]: file.token }
}
