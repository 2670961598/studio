/**
 * overlay.mjs —— 模型路由 overlay 渲染 + 被测 dsh 子进程 env 组装（纯函数）
 *
 * 依据：docs/quality/model-eval.md §5（调用方式与隔离边界）；docs/quality/kimi-on-dsh.md §0
 * （KIMI_API_KEY 经进程 env 注入，dsh 凭据优先级最高）；docs/quality/provider-key-policy.md §5
 * （DEEPSEEK_* 不得进 worker/子进程 env）。
 *
 * overlay 形态（headless profile 的 --patch 补丁层，覆盖 agent-default-model）：
 *   - id: agent-default-model
 *     config:
 *       provider: glm
 *       model: GLM-5.4
 */
import { UsageError } from './args.mjs'

const REF_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/

/** 解析并校验 `provider/model`（字符集收紧，防 overlay/YAML 注入）。 */
export function parseModelRef(ref) {
  if (typeof ref !== 'string') throw new UsageError('模型引用须为字符串')
  const m = REF_RE.exec(ref.trim())
  if (m === null) throw new UsageError(`模型引用须形如 provider/model（仅字母数字._-）：${ref}`)
  return { id: `${m[1]}/${m[2]}`, provider: m[1], model: m[2], slug: `${m[1]}__${m[2]}` }
}

/** 渲染 --patch overlay 文件内容（provider/model 已过 REF_RE，可直接裸写）。 */
export function renderOverlay(ref) {
  return [
    '# model-eval 自动生成的路由 overlay（覆盖 agent-default-model）；勿手改。',
    '- id: agent-default-model',
    '  config:',
    `    provider: ${ref.provider}`,
    `    model: ${ref.model}`,
    '',
  ].join('\n')
}

/** 宿主 DSH 会话注入给工具 shell 的「父会话身份」变量——子 dsh 必须自己重新生成，不得继承。 */
export const SESSION_ENV_STRIP = Object.freeze(['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_SHELL'])

/** 凭据政策：官方 DeepSeek key 及其派生变量一律不进子进程 env。 */
export const FORBIDDEN_ENV_PREFIX = 'DEEPSEEK_'

/** Kimi 经 env 注入的键名（只对 provider=kimi-coding 注入）。 */
export const KIMI_ENV_KEY = 'KIMI_API_KEY'

/**
 * 组装被测 dsh 子进程 env：复制宿主 env，剔除父会话身份变量与被禁凭据前缀；
 * 仅当 provider 为 kimi-coding 且给了 token 时注入 KIMI_API_KEY，其余情况显式移除
 * （宿主 shell 里若有 KIMI_API_KEY 不得带进非 kimi 被测进程）。永不打印返回值。
 */
export function buildChildEnv(baseEnv, { kimiToken = null } = {}) {
  const env = {}
  for (const [k, v] of Object.entries(baseEnv ?? {})) {
    if (SESSION_ENV_STRIP.includes(k)) continue
    if (k.startsWith(FORBIDDEN_ENV_PREFIX)) continue
    if (v === undefined) continue
    env[k] = String(v)
  }
  delete env[KIMI_ENV_KEY]
  if (typeof kimiToken === 'string' && kimiToken !== '') env[KIMI_ENV_KEY] = kimiToken
  return env
}
