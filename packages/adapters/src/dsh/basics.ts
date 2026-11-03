/**
 * dsh/basics —— dsh 适配器基座（命令/版本/超时常量、构造选项、seatbelt 后端探测、env 白名单、
 * 凭据键域闸、Handle 伴生状态）
 *
 * 依据（实现单引用）：docs/17-§6 dsh 行（命令形态/锁版本/cost_native=false）；
 *   docs/43-附录A-1（env/凭据封闭允许集）；docs/43-§五 派发权限圈②（seatbelt 探测 fail-closed）；
 *   docs/31-§5-6（executorSessionId 伴生状态）；docs/20-§十五.三（600 行阈：dsh.ts 拆件，
 *   原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只放无行为副作用的基座（常量/类型/纯函数/模块级 Map）；适配器生命周期仍在 dsh.ts。
 */
import { spawnSync } from 'node:child_process'
import { configInvalid } from '@studio-next/contract'
import type { DetectResult, Handle, StreamEvent } from '@studio-next/contract'
import type { Subprocess } from 'execa'
import { SEATBELT_BIN } from '../seatbelt.ts'
import type { SeatbeltEndpoint } from '../seatbelt.ts'

/** 缺省命令（docs/17-§6 dsh 行）：`dsh --profile headless --json` */
export const DSH_DEFAULT_CMD: readonly string[] = ['dsh', '--profile', 'headless', '--json']

/** 锁定版本（docs/16-§二：锁版本升级走回归——2026-10-30 升 0.2.1-rc.5，P-05 四断言复验 PASS） */
export const LOCKED_VERSION = '0.2.1-rc.5'

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
export const DETECT_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// seatbelt 写域圈定（DEV-29 原型 attempt3 接线，docs/43-§五 派发权限圈 ②）
// ---------------------------------------------------------------------------

/**
 * dsh 适配器的 seatbelt 启用面（原型档，DEV-29——先行接线：生成器见 seatbelt.ts，
 * 本面只决定「派发时怎么参数化」）：
 *   - mode：'auto'=darwin 且后端可用才圈定（detect 前置探测，不可用=明报 gap 不派）；
 *     'off'=不圈定（缺省——不影响既有行为与测试）
 *   - dshHomeRedirect：per-attempt DSH_HOME 重定向目标（**须在写域内**，如
 *     <workspace>/.dsh-home——dsh boot 必写 $DSH_HOME/profiles/<name>/…，真机实测见
 *     验证记录；不重定向则 DSH_HOME 须由 extraWriteRoots 显式入白名单）
 *   - writeRootsOverride：**覆写整个写域**（给定后 task.workspace/extraWriteRoots/
 *     dshHomeRedirect 全不并入——judge 派发面置 [一次性 DSH_HOME 重定向目录]：workspace
 *     只读、跨目录产出位一并无——studio-dev-164 红队 2 的机制位，任务派工面勿用）
 *   - profileDir：profile 落盘目录（缺省 workspace/.seatbelt/——证据随单走，docs/17-§6；
 *     judge 派发面置一次性工作区外目录，配合 writeRootsOverride 保「调用毕目录空」断言面）
 *   - rpcEndpoints：回环宿主 RPC 白名单（缺省=DSH_HOST_RPC_DEFAULT 127.0.0.1:13800；
 *     空数组=禁回环）/ outboundTcp：模型 API 出口白名单（缺省空=禁远程出口；host 仅认
 *     localhost/*，域名出口=daemon 侧本地代理——见 seatbelt.ts 头注局限）
 *   - （attempt3 处置 (a)：无读域参数——读域宽放，再引入红线见 seatbelt.ts 头注）
 */
export interface DshSeatbeltOptions {
  mode: 'auto' | 'off'
  dshHomeRedirect?: string
  extraWriteRoots?: readonly string[]
  writeRootsOverride?: readonly string[]
  profileDir?: string
  rpcEndpoints?: readonly SeatbeltEndpoint[]
  outboundTcp?: readonly SeatbeltEndpoint[]
}

/** DshAdapter 构造选项（v0 仅 seatbelt 面；cmd 仍第一位保持既有调用点零改动） */
export interface DshAdapterOptions {
  seatbelt?: DshSeatbeltOptions
  /**
   * 模型归一形 `provider/model`（132-§6.1 单A·C3，studio-dev-168）：dsh 无 `--model`
   * 旗标，模型=profile `agent-default-model` 插件配置——daemon 侧的部署声明镜像
   * （agent.yaml executors.dsh.patches，agentconfig.ts 解析注入）。构造期注入、
   * resultStats 原样回传；未给=不填（无从可知，不猜——存量收割 model 列 NULL）。
   */
  model?: string
}

/**
 * seatbelt 后端可用性探测（detect 前置面）：以最小 profile 跑 `sandbox-exec -p … true`。
 * macOS 拒绝嵌套 sandbox_apply——**本会话自身已在 seatbelt 内时探测必败**（实测
 * EPERM exit 71），据此 fail-closed：mode='auto' 但后端不可用 = 明报 gap 不派
 * （写域圈定是安全面，「圈不住就照跑」不是选项）。应用点正确形态=未沙箱的派发方
 * （daemon）持 profile 应用到 worker 子进程——适配器 spawn 在 daemon 进程内，天然满足。
 * 嵌套环境（如本仓测试会话）预期=ok:false + gap 'seatbelt-nested-sandbox'——测试
 * 按环境自适应断言，两种环境都证 fail-closed 语义（不伪造绿）。
 */
export function detectSeatbeltBackend(): DetectResult {
  const probe = `(version 1)(allow default)(deny network*)` // 最小可用面：无网+全放行基线
  const r = spawnSyncProbe(SEATBELT_BIN, ['-p', probe, '/usr/bin/true'])
  if (r.status === 0) return { name: 'seatbelt', version: '', ok: true, gaps: [] }
  const detail =
    r.status === 71
      ? 'seatbelt-nested-sandbox' // 编译过但 apply 被拒（EPERM）=本进程已在沙箱内
      : `seatbelt-backend-failed:exit=${String(r.status ?? r.signal ?? 'null')}`
  return { name: 'seatbelt', version: '', ok: false, gaps: [detail] }
}

/** detectSeatbeltBackend 的 spawn 面（独立小函数：测试不可注入也不必注入——真机面） */
function spawnSyncProbe(bin: string, argv: readonly string[]): { status: number | null; signal: string | null } {
  const r = spawnSync(bin, argv, { timeout: DETECT_TIMEOUT_MS })
  return { status: r.status, signal: r.signal ?? null }
}

// ---------------------------------------------------------------------------
// worker env 白名单（docs/43-附录A-1 安全基线；spike 验证 docs/44-§二 条款1）
// ---------------------------------------------------------------------------

/**
 * 宿主 env 封闭允许集（docs/43-附录A-1）：子进程只继承这些键，其余一律不透传
 * （deny-by-default——不是「黑名单剔除」，是「白名单收录」）。
 *   - PATH/HOME/TMPDIR/TZ/LANG/LC_*：进程运行必需键与本地化（executor 运行面）
 *   - DSH_*：executor 自有配置命名空间（DSH_PROFILE / DSH_TELEMETRY_MODE 等——dsh 侧
 *     凭证与配置均从该命名空间读，docs/31-§3.5「进程 env 最高层」）
 * 框架注入键（STUDIO_NEXT_INSTRUCTIONS、TaskBrief.credentials、DSH_TELEMETRY_MODE 覆盖）
 * 不经此集——它们在白名单之后按固定顺序追加（见 spawnHeadless）。
 */
const ENV_KEY_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'LANG', 'TZ', 'TMPDIR']
const ENV_PREFIX_ALLOWLIST: readonly string[] = ['LC_', 'DSH_']

/**
 * credentials 键名封闭枚举（docs/43-附录A-1 凭据键域）：
 *   - DEEPSEEK_API_KEY（类别 model-key）：dsh 的 provider route 凭证（docs/31-A4 真机
 *     错误面指名「export DEEPSEEK_API_KEY in the launching environment」）
 *   - STUDIO_TOOLS_WKEY（类别 platform-write）：worker 级平台写凭据（worker-key.ts，17-§7）
 * 白名单外的键——尤其 PATH / NODE_OPTIONS / LD_* / DYLD_* / SHELL / HOME 类注入键——
 * 结构拒收（CONFIG_INVALID），绝不静默剔除后放行其余。
 */
const CREDENTIAL_KEY_ENUM: readonly string[] = ['DEEPSEEK_API_KEY', 'STUDIO_TOOLS_WKEY']

/** 注入高危键点名表（报错信息用——命中即明说这是注入面拒收，不是普通未知键） */
const INJECTION_KEY_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^PATH$/, 'PATH 覆盖可劫持可执行解析'],
  [/^NODE_OPTIONS$/, 'NODE_OPTIONS 可注入预载脚本'],
  [/^LD_/, 'LD_* 动态链接器注入'],
  [/^DYLD_/, 'DYLD_* macOS 动态链接器注入'],
  [/^SHELL$/, 'SHELL 可指定任意解释器'],
  [/^HOME$/, 'HOME 可劫持配置/凭证发现路径'],
]

/** 宿主 env → 子进程 env（只收录封闭允许集；deny-by-default，导出供测试直证） */
export function filterWorkerEnv(base: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (ENV_KEY_ALLOWLIST.includes(key) || ENV_PREFIX_ALLOWLIST.some((p) => key.startsWith(p))) {
      out[key] = value
    }
  }
  return out
}

/**
 * credentials 键域闸（封闭枚举）：白名单外键结构拒收并抛 CONFIG_INVALID。
 * 值不校验不打印（红名单纪律不变——本闸只看键名）。
 */
export function assertCredentialKeys(creds: Record<string, string>): void {
  for (const key of Object.keys(creds)) {
    if (CREDENTIAL_KEY_ENUM.includes(key)) continue
    const hit = INJECTION_KEY_PATTERNS.find(([re]) => re.test(key))
    configInvalid(
      'dsh/credential-key-rejected',
      hit !== undefined
        ? `credentials 键 ${JSON.stringify(key)} 属注入高危键（${hit[1]}）——封闭枚举外键结构拒收（docs/43-附录A-1；合法键：${CREDENTIAL_KEY_ENUM.join('、')}）`
        : `credentials 键 ${JSON.stringify(key)} 不在封闭枚举内——结构拒收（docs/43-附录A-1；合法键：${CREDENTIAL_KEY_ENUM.join('、')}）`,
    )
  }
}

// ---------------------------------------------------------------------------
// Handle 伴生状态（模块内私有）
// ---------------------------------------------------------------------------

export interface SessionState {
  readonly subprocess: Subprocess
  readonly startedAt: number
  /** stream() 消费时累积的归一事件（resultStats 的账目来源） */
  readonly events: StreamEvent[]
  /** 逐行 stdout 原文缓冲（证据留痕，未解析；台账落盘归 daemon） */
  readonly rawLines: string[]
  streamConsumed: boolean
  killed: boolean
  /**
   * dsh 侧会话 id（session-<uuid>）：stream() 从流首 session 事件捕获（P1 收存面
   * docs/31-§5-6；契约 Handle.executorSessionId v1.5——同步写进 Handle 供续跑/对账）
   */
  executorSessionId?: string
  /** 子进程 promise 已落定（退出或 spawn 失败）——由 launch 的派生观察器置位（头注 10.x 项） */
  settled: boolean
  /** promise 落定时留档的退出码（null=被信号杀死；未落定/spawn 失败时 undefined） */
  settledExitCode?: number | null
  /** spawn 层失败（如 ENOENT）——stdout 不可用时 stream() 如实抛出 */
  spawnError?: Error
  /** 流收尾时刻（kill 或自然退出后）；未收尾时 undefined */
  endedAt?: number
  /** stream() 收尾时记录的退出码（null=被信号杀死） */
  exitCode?: number | null
}

/** sessionId（UUID 全局唯一）→ 伴生状态；多实例共享不冲突，见文件头注 */
export const sessions = new Map<string, SessionState>()

export function requireState(h: Handle): SessionState {
  const state = sessions.get(h.sessionId)
  if (state === undefined) {
    throw new Error(
      `dsh: 未知的 sessionId=${h.sessionId}（伴生状态缺失——launch 未发生或 daemon 已重启）`,
    )
  }
  return state
}

// ---------------------------------------------------------------------------
// 适配器
