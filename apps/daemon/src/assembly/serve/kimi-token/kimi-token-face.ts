/**
 * serve/kimi-token-face —— Kimi（kimi-coding）token 注入面 serve 装配（docs/quality/kimi-on-dsh.md §4）
 *
 * 依据（实现单引用）：docs/quality/kimi-on-dsh.md §3/§4；docs/25-§二（TaskBrief v1.4
 * credentials）。把刷新器 CLI（scripts/ops/kimi-token-refresh.mjs，node 子进程——依赖方向
 * daemon→ops 脚本用 spawn 而非 import，scripts/ 不在包依赖面内）包成
 * EngineDeps.kimiToken.refresh：dispatch 相位、token 文件缺失或 mtime 龄超阈值时按需刷新
 * （access_token TTL 900s——保证 launch 时余量 ≥11 分钟），重读由 engine 侧完成。
 *
 * 纪律：
 *   - 凭据值红名单——日志只留一行分类（不回显子进程 stdout/stderr，不写路径/token）；
 *   - 串行化：refresh_token 服务器侧轮换，并发刷新自找竞态——进程内串行（同拍多张
 *     kimi 源单也只刷一次，engine 侧刷新后重读自然去重）；
 *   - 吞错不抛（fail-safe §4）：刷新败=回退现有文件值（engine 重读即得）；
 *   - 未路由 kimi-coding 源=本面零触发（现行生产 high=kimi 时零行为）。
 */
import { execFile as execFileCb } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT, kimiTokenFilePath, type KimiTokenDeps } from '../../../engine/dispatch/kimi-token.ts'

const execFile = promisify(execFileCb)

/** 刷新器 CLI：apps/daemon/src/assembly/serve/kimi-token → 仓根 scripts/ops/kimi-token-refresh.mjs。 */
const DEFAULT_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../scripts/ops/kimi-token-refresh.mjs')
/** 子进程总超时（脚本单请求 10s＋2 次重试＋退避，dispatch 相位不拖拍）。 */
const REFRESH_EXEC_TIMEOUT_MS = 40_000
/** 传给子进程的单请求超时与重试数（比 CLI 缺省收敛——dispatch 在线路径）。 */
const REFRESH_REQUEST_TIMEOUT_MS = 10_000
const REFRESH_MAX_ATTEMPTS = 2
/** 子进程 env 收口（daemon env 只透传必需键＋凭据路径覆盖；与 ENV_KEY_ALLOWLIST 同风的 deny-by-default）。 */
const PASS_ENV_KEYS: readonly string[] = ['PATH', 'HOME', 'LANG', 'TZ', 'TMPDIR', 'KIMI_CREDENTIALS_FILE', 'KIMI_CODE_OAUTH_HOST', 'KIMI_OAUTH_HOST']

/** exec 注入口（测试假体替换面；真体=promisified execFile）。 */
export type KimiRefreshExec = (file: string, args: readonly string[], opts: { env: Record<string, string>; timeout: number }) => Promise<{ stdout: string; stderr: string }>

export interface KimiTokenFaceOptions {
  /** 启动/失败留痕一行（缺省=不记） */
  log?: (line: string) => void
  /** 刷新器 CLI 路径（缺省=仓内 scripts/ops；测试/部署位覆盖） */
  scriptPath?: string
  /** node 可执行（缺省 process.execPath） */
  nodePath?: string
  /** env 源（缺省 process.env；测试注入） */
  env?: Record<string, string | undefined>
  /** exec 面（缺省 promisified execFile；测试假体） */
  exec?: KimiRefreshExec
}

/** 装配 EngineDeps.kimiToken（serve 恒注入——未路由 kimi-coding 源即零触发零行为）。 */
export function wireKimiTokenFace(opts: KimiTokenFaceOptions = {}): KimiTokenDeps {
  const env = opts.env ?? process.env
  const tokenFile = kimiTokenFilePath(env)
  const exec = opts.exec ?? execFile
  const log = opts.log
  const scriptPath = opts.scriptPath ?? DEFAULT_SCRIPT
  const nodePath = opts.nodePath ?? process.execPath
  let tail: Promise<unknown> = Promise.resolve() // 串行化游标（§4：轮换竞态防护）
  const refresh = (): Promise<{ ok: boolean }> => {
    const mine = tail.then(async (): Promise<{ ok: boolean }> => {
      const childEnv: Record<string, string> = {}
      for (const key of PASS_ENV_KEYS) {
        const v = env[key]
        if (v !== undefined && v !== '') childEnv[key] = v
      }
      childEnv['STUDIO_KIMI_TOKEN_FILE'] = tokenFile // 显式同路径源——不靠继承猜
      childEnv['KIMI_REFRESH_MAX_ATTEMPTS'] = String(REFRESH_MAX_ATTEMPTS)
      try {
        await exec(nodePath, [scriptPath, '--once', '--timeout-ms', String(REFRESH_REQUEST_TIMEOUT_MS)], { env: childEnv, timeout: REFRESH_EXEC_TIMEOUT_MS })
        log?.('[serve] kimi token 已刷新（kimi-on-dsh §4；值不落日志）')
        return { ok: true }
      } catch (err) {
        const e = err as { killed?: boolean; code?: number | string }
        const detail = e.killed === true ? 'timeout' : `exit=${String(e.code ?? '?')}`
        log?.(`[serve] kimi token 刷新失败（${detail}）——回退现有 token 文件（若在效期）`)
        return { ok: false }
      }
    })
    tail = mine.then(() => undefined, () => undefined)
    return mine
  }
  return { tokenFile, refresh, maxAgeMs: KIMI_TOKEN_FRESH_MAX_AGE_MS_DEFAULT }
}
