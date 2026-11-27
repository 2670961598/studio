/**
 * agy argv / env 构造件（task-140 分片；task-147 env 闸加固；BC-S2 尺寸阈「先拆后加」，docs/20-§十五）
 *
 * 本文件只放**无进程、无 IO 的纯函数**：缺省命令、版本地板、子进程 env 三道闸、launch argv 组装。
 * 适配器本体（伴生状态/watchdog/终态合成）在 agy.ts；stdout 终稿解析与失败分类在 agy-json.ts。
 * 只被 agy.ts 与测试直证引用（kimi-wire.ts 同例：不进 index.ts）。
 *
 * 依据：
 *   - task-140 实测事实单（本机 agy v1.5.18）：headless=`agy -p <任务串> --output-format json
 *     --dangerously-skip-permissions [--model <名>] [--add-dir <dir>] [--print-timeout <秒>]`；
 *     `--mode auto` 当前账号不可用（warning 后回退 default）——本适配器**永不下发 --mode**
 *   - docs/43-附录A-1 同型纪律：宿主 env 收封闭允许集（deny-by-default，不是黑名单剔除）
 *     ＋代理键放行（本机 Google 域直连被拦，agy 必须经代理——实测无代理即 auth 失败）；
 *     小写代理键是 Clash/终端常见注入形态，一并放行
 *   - docs/25-§二（v1.4）：TaskBrief.credentials 短命按单凭据——透传进子进程，值不记录不打印；
 *     注入键名以 daemon 侧 worker-key.ts 的 STUDIO_TOOLS_WKEY 为准（既有注入键只有它）
 *   - extendEnv:false 是允许集生效前提（execa 缺省并入 process.env）
 *
 * env 三道闸（task-147 加固，verifier 12 例探针全拒）。实际语义＝**封闭允许集＋封闭枚举＋高危
 * 拒收**——与 dsh 凭据键域闸**不同型**（dsh 只对 credentials 做封闭枚举；本件多一道合并后终检，
 * 且比对一律先 lower-case 再判键/前缀，`glm_api_key`／`DeepSeek_API_KEY`／`Node_Options` 一类
 * 大小写变体与正写同拒）：
 *   ① 宿主封闭允许集（filterAgyEnv）：宿主 env 只收录运行必需键与代理键，其余一概不透传；
 *   ② 注入通道封闭枚举（assertAgyInjectKeys）：proxyEnv 只收代理四键（大小写两形共 8 个字面）、
 *      credentials 只收 STUDIO_TOOLS_WKEY；枚举外键结构拒收（CONFIG_INVALID），不静默剔除后放行
 *      其余。HOME／PATH 是「宿主专属键」——子进程运行必需，但只许来自宿主 env 经①收录；经注入
 *      通道出现即拒（覆盖 HOME＝劫持配置/凭据发现路径，覆盖 PATH＝劫持可执行解析）；
 *   ③ 高危拒收终检（assertAgyEnvSafety）：合并后兜底——键 lower-case 后命中拒收表（加载器/解释器
 *      注入键＋Gemini/Google 凭据键＋他家执行体凭据/配置键＋凭据形后缀）即拒；HOME／PATH 逐字节核对
 *      仍是宿主原值（宿主基准必传，漏传按空基准判覆盖）。三道闸合成的唯一入口是 buildAgyEnv
 *      （detect/launch 共用）。
 *
 * env 允许集为何够用（安装包静态核对，未发起调用）：`agy` 是 Homebrew cask 的 bash 包装
 * （硬编码路径 exec 主二进制）→ Go 二进制；Go 的 os.UserHomeDir / os.TempDir 只读 HOME /
 * TMPDIR，代理读 HTTP(S)_PROXY / NO_PROXY（二进制串表另见 ALL_PROXY / all_proxy 字样）；
 * OAuth 凭据落 HOME 下本机文件——HOME 必放行，其余宿主键一概不进子进程。
 * 真机充分性未证（探钢单待办）：不够用时改允许集常量并补测试——不设「经 proxyEnv 补键」旁门
 * （proxyEnv 自 task-147 起只收代理键）。
 */
import { configInvalid } from '@studio-next/contract'

/** 缺省命令（task-140 实测事实单）：launch 时追加 `-p <任务串> --output-format json` 等旗标 */
export const AGY_DEFAULT_CMD: readonly string[] = ['agy']

/** 版本地板（实测基线 v1.5.18）：detect 低于此明报 gap（不静默放行） */
export const AGY_MIN_VERSION = '1.5.18'

/** AGENTS.md 拼接分隔符（append_system_prompt 通道：任务串 + 本分隔符 + 文件全文） */
export const AGY_MD_SEPARATOR = '\n\n--- AGENTS.md ---\n'

// ---------------------------------------------------------------------------
// env 闸①：宿主封闭允许集
// ---------------------------------------------------------------------------

/**
 * 宿主 env 封闭允许集（deny-by-default，不是黑名单剔除；键名 lower-case 后比对）：
 *   - PATH/HOME/LANG/TZ/TMPDIR/LC_*：进程运行必需键与本地化
 *   - 代理键：Google 域本机直连被拦，agy 必须经代理（task-140 实测：无代理 auth 必败）；
 *     小写镜像是 Clash/终端常见注入形态，一并放行
 */
const AGY_ENV_KEYS: readonly string[] = [
  'path', 'home', 'lang', 'tz', 'tmpdir',
  'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
]
const AGY_ENV_PREFIXES: readonly string[] = ['lc_']

/** 宿主 env → agy 子进程 env（只收录封闭允许集；键按宿主原样透传；导出供测试直证） */
export function filterAgyEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (AGY_ENV_KEYS.includes(lower) || AGY_ENV_PREFIXES.some((p) => lower.startsWith(p))) {
      out[key] = value
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// env 闸②：注入通道封闭枚举 ＋ 高危拒收表
// ---------------------------------------------------------------------------

/** 注入通道名（TaskBrief.credentials＝按单凭据；AgyAdapterOptions.proxyEnv＝代理钉扎位） */
export type AgyEnvChannel = 'proxyEnv' | 'credentials'

/** proxyEnv 封闭枚举：代理四键大小写两形（Go 只读这两形——混合大小写写了不生效，故不收） */
const AGY_PROXY_KEYS: readonly string[] = [
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
]

/**
 * credentials 封闭枚举：STUDIO_TOOLS_WKEY（worker-key.ts：worker 级平台写凭据，daemon 既有唯一
 * 注入键）。agy 凭据走本机 OAuth，无模型供应商 env 凭据面——KIMI_API_KEY 是 dsh 家族 provider 键，
 * 对 agy 同属第三方凭据，不收。
 */
const AGY_CREDENTIAL_KEYS: readonly string[] = ['STUDIO_TOOLS_WKEY']

/**
 * 高危拒收表（键 lower-case 后匹配；命中只改变报错措辞——封闭枚举外的键本就全拒）。
 *   - 宿主专属键 HOME／PATH：在注入通道出现即拒（闸②）；在合并后 env 里只许是宿主原值（闸③核对）
 *   - 加载器/解释器注入面：NODE_*、DYLD_*／LD_*、shell 启动面
 *   - Gemini/Google 凭据键：API-key 路由未证，缺省拒收（不透传、不可注入）
 *   - 他家执行体凭据/配置键不交叉；凭据形后缀兜底
 */
const AGY_DENY_RULES: readonly (readonly [RegExp, string])[] = [
  [/^home$/, 'HOME 是宿主专属键——覆盖即劫持配置/凭据发现路径（OAuth 凭据落 HOME 下），只许来自宿主 env'],
  [/^path$/, 'PATH 是宿主专属键——覆盖即劫持可执行解析，只许来自宿主 env'],
  [/^node_(options|path|preload)$/, 'NODE_OPTIONS／NODE_PATH／NODE_PRELOAD 可注入预载脚本、改写模块解析'],
  [/^(dyld_|ld_)/, 'DYLD_*／LD_* 动态链接器注入'],
  [/^(shell|bash_env|env|ifs|prompt_command)$/, 'shell 注入面（解释器/启动文件/分词）'],
  [/^(gemini_|google_|antigravity_)/, 'Gemini/Google 凭据键（API-key 路由未证，缺省拒收）'],
  [/^(anthropic|openai|claude|codex)/, '他家执行体凭据/配置键（不交叉）'],
  [/^(deepseek_|glm_|kimi_|dsh_)/, '他家执行体凭据/配置键（不交叉）'],
  [/(?:^|_)(?:api_?key|apikey|token|secret|password|passwd|credentials?)$/, '凭据形键名（*_api_key／*token／*secret／*password／*credentials）'],
]

/** lower-case 键命中的首条拒收理由（未命中＝undefined） */
function denyReasonOf(lowerKey: string): string | undefined {
  const hit = AGY_DENY_RULES.find(([re]) => re.test(lowerKey))
  return hit !== undefined ? hit[1] : undefined
}

/**
 * 注入通道键闸（封闭枚举，fail-closed）：枚举内键放行，其余结构拒收——命中高危表的键点名危害，
 * 一般键报「不在封闭枚举内」。只看键名不看值（红名单纪律）；错误文本只带键名。
 * 导出供适配器构造时校验 proxyEnv（配置写了没生效比报错更难查）与测试直证。
 */
export function assertAgyInjectKeys(channel: AgyEnvChannel, injected: Readonly<Record<string, string>>): void {
  const allowed = channel === 'proxyEnv' ? AGY_PROXY_KEYS : AGY_CREDENTIAL_KEYS
  for (const key of Object.keys(injected)) {
    if (allowed.includes(key)) continue
    const reason = denyReasonOf(key.toLowerCase())
    configInvalid(
      'agy/env-key-rejected',
      reason !== undefined
        ? `${channel} 键 ${JSON.stringify(key)} 属高危拒收键（${reason}）——agy 子进程结构拒收`
        : `${channel} 键 ${JSON.stringify(key)} 不在封闭枚举内——agy 子进程结构拒收（${channel} 只收：${allowed.join('、')}）`,
    )
  }
}

// ---------------------------------------------------------------------------
// env 闸③：合并后终检 ＋ 唯一合成入口
// ---------------------------------------------------------------------------

/** 宿主专属键（lower-case）：闸③据此核对「合并后仍为宿主原值」 */
const AGY_HOST_ONLY_KEYS: readonly string[] = ['home', 'path']

/**
 * 高危拒收终检（fail-closed 兜底）：合并后 env 的键 lower-case 后命中拒收表 → CONFIG_INVALID
 * 结构拒收（不静默剔除后放行其余）。两处例外：
 *   - HOME／PATH：子进程运行必需、合并后本就该在——闸①②已保证它们只可能来自宿主；此处逐字节核对
 *     仍是宿主原值（`host`＝宿主基准，必传；漏传按空基准处理 → HOME／PATH 在场即判覆盖）；
 *   - credentials 封闭枚举键：凭据的唯一入口是闸②，此处不再按「凭据形键名」误拒。
 * 只看键名不看值；错误文本只带键名，值永不入账。
 */
export function assertAgyEnvSafety(
  env: Readonly<Record<string, string>>,
  host: Readonly<Record<string, string | undefined>> | undefined,
): void {
  const reference = host ?? {}
  for (const [key, value] of Object.entries(env)) {
    const lower = key.toLowerCase()
    if (AGY_HOST_ONLY_KEYS.includes(lower)) {
      if (reference[key] !== value) {
        configInvalid(
          'agy/env-key-rejected',
          `env 键 ${JSON.stringify(key)} 是宿主专属键，合并后与宿主值不一致（覆盖劫持）——agy 子进程拒收`,
        )
      }
      continue
    }
    if (AGY_CREDENTIAL_KEYS.some((k) => k.toLowerCase() === lower)) continue
    const reason = denyReasonOf(lower)
    if (reason !== undefined) {
      configInvalid('agy/env-key-rejected', `env 键 ${JSON.stringify(key)} 属高危拒收键（${reason}）——agy 子进程拒收`)
    }
  }
}

/** 子进程 env 合成输入（三通道；base＝宿主 env，适配器传 process.env） */
export interface AgyEnvInput {
  readonly base: Readonly<Record<string, string | undefined>>
  readonly proxyEnv?: Readonly<Record<string, string>>
  readonly credentials?: Readonly<Record<string, string>>
}

/**
 * 子进程 env 的**唯一合成入口**（detect/launch 共用）：①允许集 → ②两通道封闭枚举闸 → 合并
 * （proxyEnv 钉扎可覆盖宿主同名代理键；credentials 最后追加）→ ③终检（以 base 为宿主基准）。
 * 任一闸拒收即抛 CONFIG_INVALID/agy/env-key-rejected，发生在 spawn 之前。
 */
export function buildAgyEnv(input: AgyEnvInput): Record<string, string> {
  const env = filterAgyEnv(input.base)
  if (input.proxyEnv !== undefined) {
    assertAgyInjectKeys('proxyEnv', input.proxyEnv)
    Object.assign(env, input.proxyEnv)
  }
  if (input.credentials !== undefined) {
    assertAgyInjectKeys('credentials', input.credentials)
    Object.assign(env, input.credentials)
  }
  assertAgyEnvSafety(env, input.base)
  return env
}

/** launch argv 组装输入（taskText=任务串全文；agentsMdText=append 通道拼接的 AGENTS.md 全文） */
export interface AgyArgvInput {
  readonly base: readonly string[]
  readonly taskText: string
  readonly agentsMdText?: string
  readonly model?: string
  readonly addDir?: string
  readonly printTimeoutSec?: number
}

/**
 * argv 基座（task-140 实测建议形）：
 * `agy -p <任务串> --output-format json --dangerously-skip-permissions [--model <名>]
 * [--add-dir <dir>] [--print-timeout <秒>]`——永不下发 --mode（auto 不可用回退 default，
 * 实测 warning；只读方案 mode=plan 留探钢单，不在派工面默认启用）。
 * --print-timeout 只在正数时下发：0/负数/缺省不下发（CLI 自管缺省）。
 */
export function buildAgyArgv(input: AgyArgvInput): readonly string[] {
  const prompt =
    input.agentsMdText !== undefined && input.agentsMdText !== ''
      ? `${input.taskText}${AGY_MD_SEPARATOR}${input.agentsMdText}`
      : input.taskText
  const argv = [...input.base, '-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions']
  if (input.model !== undefined && input.model !== '') argv.push('--model', input.model)
  if (input.addDir !== undefined && input.addDir !== '') argv.push('--add-dir', input.addDir)
  if (input.printTimeoutSec !== undefined && input.printTimeoutSec > 0) {
    argv.push('--print-timeout', String(input.printTimeoutSec))
  }
  return argv
}
