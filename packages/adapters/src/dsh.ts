/**
 * dsh 适配器（默认主力 executor）——P0 重写：按 0.2.0-rc.2 真机事件形态对齐（docs/31）
 *
 * 依据：
 *   - docs/31-dsh真机探针报告：§5 修正清单 + §7 补充轮（五探针实录）——本轮 P0 重写的
 *     直接依据；事件解析见 streams.ts parseDsh（八类顶层 type，status+phase，camelCase
 *     usage，turn_end.reason.kind 终态）
 *   - docs/17-§6 dsh 行：launch=`dsh --profile headless --json`（锁版本）；流=NDJSON；
 *     tokens 有、成本无价目表折算（cost_native=false）；SIGTERM 可杀
 *   - docs/18-§一：ExecutorAdapter 六原语；detect 不达标明报，绝不静默降级
 *   - docs/16-§二：子进程用 execa；executor=dsh 默认锁 0.2.0-rc.2（锁版本升级走回归）
 *   - docs/25-§二（v1.4）：TaskBrief.credentials 短命按单凭据——launch env 透传进
 *     子进程（docs/43-附录A-1 起键域收封闭枚举闸：枚举外键结构拒收 CONFIG_INVALID）；
 *     其值不记录不打印（红名单），流/日志/账面文本永不含凭据。dsh 侧凭证优先级
 *     「进程 env 最高层」与该通道严丝合缝（docs/31-§3.5）
 *   - docs/25-§3.1 v1.5 裁决（2026-10-19 制作人批，dsh 三件套）：①AGENTS.md 注入走 dsh
 *     插件（STUDIO_NEXT_INSTRUCTIONS → packages/dsh-bridge studio-next-bridge）②Handle
 *     可选 executorSessionId（端口级原则，dsh 首填）③StreamEvent.turn_end.errorCode
 *     结构位（AUTH / MISSING_CREDENTIAL 先行）
 *
 * 真机对齐要点（P0，docs/31-§4 证伪表 → §5 修正清单）：
 *   - launch 传任务串：dsh headless 的任务=单个位置参数（docs/31-§0 发现 2——旧实现
 *     不传任务，真机每次 launch 必以 usage error 退出）。任务文本读 TaskBrief.briefPath
 *     文件内容（契约已有字段，不涉改动），以 `--` 分隔符防任务串以 `-` 开头被当旗标
 *   - isCompleted 终态判据唯一化（docs/31-§7 P-08 定性）：turn_end.reason.kind===
 *     'completed' 且仅此一条。「空 final + 无 turn_end + exit 0」= 被 kill（aborted 口径，
 *     非成功非失败）——退出码与「输出非空」一律不参与判定（旧「hasOutput 近似」已删）
 *   - 失败分类（P1，docs/31-A4/§7 P-04）：无凭证=turn_end.reason.error.code
 *     MISSING_CREDENTIAL；凭证无效=code AUTH（上游 401 透传）。code 进契约结构位
 *     turn_end.errorCode（v1.5，2026-10-19 批——前缀拼接方案废除），message 原文留在
 *     turn_end.error（streams.ts parseDshStatus）
 *   - 遥测红线（docs/31-§5-8）：一切 dsh 拉起（launch/detect）注入
 *     DSH_TELEMETRY_MODE=DISABLED——dsh 默认 FEEDBACK_ONLY 外发 deepseeksvc.com，禁外发
 *   - resultStats：tokens 从 step_end usage 累计（turn_end 兜底分支已删——真机 turn_end
 *     恒无 usage，docs/31-§3.2）；turns=step_end 计数（dsh 一个 turn 含 N 个 step，此处
 *     近似记 step 数——契约 ResultStats 无备注位，不改 contract）
 *
 * 已知坑与取舍（沉淀于此，docs/18-§1.2）：
 *   - 「dsh 被 kill 后：优雅空 final（final.text=""）且无 turn_end 事件、退出码 0」
 *     （17-§6 坑位，docs/31-§7 P-08 真机定性收口）：exitCode 只记录不参与判定；终态
 *     只认 turn_end.reason.kind（见上）。spawn 统一 reject:false——非零退出码/被信号
 *     杀死不抛错，退出码对收割只有证据价值
 *   - AGENTS.md 通道（2026-10-19 三件套之一）：插件通道——agents_md='user_level'（daemon
 *     组装指令落 workspace 外临时文件 0600），agentsMdEnv 注 STUDIO_NEXT_INSTRUCTIONS=
 *     <target>，由 studio-next-bridge 宿主插件（packages/dsh-bridge）注入系统提示；旧
 *     证伪变量已移除（docs/31-A1，裁决 docs/25-§3.1 v1.5#1）；挂载=agent.yaml cmd
 *     --patch overlay（instructions-store.ts），未挂载 env 无消费者；原生发现通道
 *     （launch cwd 向上扫，P-07）可并存不冲突
 *   - 续跑：resumeWithSession(task, executorSessionId) 已接线（--session-id 透传，P-05
 *     实证形态）；capabilities.session_resume 仍 false——端口开关待「cwd 一致性落调度
 *     纪律」立项后翻转（docs/31-§5-7；cwd 逐字节一致约束见 resumeWithSession 注）
 *   - execa 已升 10.x（docs/27-§4.3 案 A 拍板）：spawn 配 killDescendants:true——Unix
 *     落法为独立进程组，kill() 信号直达整组（子+孙），kill 链=「SIGTERM 软杀整树 →
 *     graceMs → SIGKILL 硬杀整树」；10.x kill(signal, error) 无 per-call 宽限、
 *     forceKillAfterDelay 仅 spawn 级——graceMs 是 kill() 契约参数，故弃 spawn 级兜底
 *     （forceKillAfterDelay:false），升级链自持；Subprocess 非 EventEmitter（无 .once/
 *     .exitCode），落定态由 launch 的 promise 派生观察器维护（settled/settledExitCode），
 *     kill() 等落定用派生分支（reject 分支吞掉，见 kill() 注）
 *   - 宽限扫尾定时器不因父先退而取消（unref 不阻退出）：吞 TERM 的孙进程由宽限到点的
 *     整组 SIGKILL 收口（Unix 父退后 PGID 在组员存续期间保留，组杀仍可达；组已尽时为
 *     无害 no-op。理论 PID 复用误杀窗口系 upstream 文档化已知局限，概率极低）
 *   - resultStats().cost 恒 {usd:0}：cost_native=false，待价目表折算；ResultStats 结构
 *     无备注字段，不改 contract——以本头注 + 汇报记录「待价目表折算」
 *   - 伴生状态 sessions 为模块级私有 Map：sessionId 用随机 UUID（框架侧 handle 主键）；
 *     dsh 侧 session-<uuid> 由 stream() 从流首 session 事件捕获写进 Handle.
 *     executorSessionId（P1 收存 docs/31-§5-6，契约 v1.5——resumeWithSession/对账用）；
 *     随 daemon 进程存续，v0 不做回收（台账落盘后状态可重建投影）
 *   - stream() 一会话只许消费一次（一单一命、一流一收）；resultStats() 只汇总已消费
 *     的事件（收割流程固定先收流后收账）
 *   - estimate()：预算估算模型 v0 拟稿——任务书字符量粗估 + confidence 低值，v0.6 前细化
 *   - seatbelt 写域圈定（DEV-29 原型 attempt3，docs/43-§五 派发权限圈②——先行接线）：
 *     构造项 opts.seatbelt（缺省不圈定，既有行为/测试零改动）；mode='auto' 时 detect 追加
 *     后端可用性探测（不可用/非 darwin=ok:false fail-closed 不派），launch 侧 profile 随
 *     派发参数化生成并以 sandbox-exec 包装 argv——生成器见 seatbelt.ts（attempt3 处置 (a)
 *     =删 strictRead 读收口；judge 派发面（studio-dev-164 红队 2）经 writeRootsOverride/
 *     profileDir 复用：workspace 不入写域+profile 落工作区外=无工具只读档）
 */
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execa } from 'execa'
import type { Subprocess } from 'execa'
import type {
  BudgetEstimate,
  DetectResult,
  ExecutorAdapter,
  ExecutorCapabilities,
  Handle,
  ResultStats,
  StreamEvent,
  TaskBrief,
  TokenCounts,
} from '@studio-next/contract'
import { configInvalid } from '@studio-next/contract'
import { parseLine, extractDshSessionId } from './streams.ts'
import {
  SEATBELT_BIN,
  buildWorkerSeatbeltProfile,
  seatbeltArgv,
  seatbeltProfileFileName,
} from './seatbelt.ts'
import type { SeatbeltEndpoint } from './seatbelt.ts'

/** 缺省命令（docs/17-§6 dsh 行）：`dsh --profile headless --json` */
export const DSH_DEFAULT_CMD: readonly string[] = ['dsh', '--profile', 'headless', '--json']

/** 锁定版本（docs/16-§二：dsh 锁 0.2.0-rc.2，锁版本升级走回归） */
const LOCKED_VERSION = '0.2.0-rc.2'

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
const DETECT_TIMEOUT_MS = 5_000

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
function detectSeatbeltBackend(): DetectResult {
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

interface SessionState {
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
const sessions = new Map<string, SessionState>()

function requireState(h: Handle): SessionState {
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
// ---------------------------------------------------------------------------

export class DshAdapter implements ExecutorAdapter {
  readonly name = 'dsh'

  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, // 17-§6 dsh 行无预算帽旗标；预算管控走框架断路（价目表折算后）
    cancel_turn: false, // 无单轮取消原语，只能整进程 kill
    session_resume: false, // v0 不声明续跑；不支持时明报并降级新派（调度侧职责）
    agents_md: 'user_level', // bridge 插件通道（docs/25-§3.1 v1.5#1 落地）：daemon 落指令临时文件（workspace 外）→ 本适配器注 STUDIO_NEXT_INSTRUCTIONS → studio-next-bridge 注入系统提示 persona 段；原生发现通道（P-07）仍在，无插件时 env 无消费者（注入不发生——provisioning 归 agent.yaml cmd --patch 挂载）
    cost_native: false, // 17-§6：tokens 有，成本无价目表折算
  }

  private readonly cmd: readonly string[]
  private readonly seatbelt: DshSeatbeltOptions | undefined

  /**
   * cmd 可注入（测试用假 CLI）；缺省 `dsh --profile headless --json`（17-§6）。
   * opts.seatbelt（DEV-29 原型 attempt3）：缺省不圈定（既有调用点零改动）；
   * mode='off' 同缺省。构造期校验 mode 形状（非法档位=结构拒收，不静默当 off）。
   */
  constructor(cmd: readonly string[] = DSH_DEFAULT_CMD, opts?: DshAdapterOptions) {
    this.cmd = cmd.length > 0 ? cmd : DSH_DEFAULT_CMD
    if (opts?.seatbelt !== undefined && opts.seatbelt.mode !== 'auto' && opts.seatbelt.mode !== 'off') {
      configInvalid(
        'dsh/seatbelt-mode-invalid',
        `seatbelt.mode 仅接受 'auto' | 'off'，得到 ${JSON.stringify(opts.seatbelt.mode)}——结构拒收（不静默当 off）`,
      )
    }
    this.seatbelt = opts?.seatbelt
  }

  /** seatbelt 圈定是否实际生效（mode='auto' 且构造在案） */
  private seatbeltEnabled(): boolean {
    return this.seatbelt?.mode === 'auto'
  }

  /**
   * 版本探测：跑 `<cmd[0]> --version`（超时 5s）解析语义化版本。
   * 未安装 / 解析失败 / 超时 → ok:false + gaps 明报（不静默降级）；
   * 版本可解析但与锁版本不符 → gap 明报但 ok:true（锁版本回归走探针线，16-§二）。
   */
  async detect(): Promise<DetectResult> {
    const binary = this.cmd[0] ?? DSH_DEFAULT_CMD[0] ?? 'dsh'
    const result = await execa(binary, ['--version'], {
      timeout: DETECT_TIMEOUT_MS,
      reject: false, // 探测失败走 gaps 明报，不靠异常表达
      // 遥测红线（docs/31-§5-8）+ env 白名单（docs/43-附录A-1）：探测子进程同走封闭
      // 允许集——deny-by-default 不因「只是 --version」放宽。extendEnv:false 是白名单的
      // **生效前提**：execa 缺省会把 env 选项并进 process.env（options.js
      // `{...(extendEnv && process.env), ...envOption}`）——不关掉它，白名单形同虚设
      env: { ...filterWorkerEnv(process.env), DSH_TELEMETRY_MODE: 'DISABLED' },
      extendEnv: false,
    })
    if (result.timedOut) {
      return { name: this.name, version: '', ok: false, gaps: ['dsh-detect-timeout'] }
    }
    if (result.failed) {
      // spawn 层失败（ENOENT=未安装；其他如实带原因明报）
      const gap = isENOENT(result.cause)
        ? 'dsh-not-installed'
        : `dsh-detect-failed:${errMsg(result.cause)}`
      return { name: this.name, version: '', ok: false, gaps: [gap] }
    }
    const match = /v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/.exec(result.stdout.trim())
    if (match === null) {
      return { name: this.name, version: '', ok: false, gaps: ['dsh-version-unparsed'] }
    }
    const version = match[1] ?? ''
    const gaps =
      version === LOCKED_VERSION
        ? []
        : [`dsh-version-unlocked:expected ${LOCKED_VERSION},got ${version}`]
    // seatbelt 后端前置探测（DEV-29 attempt3，mode='auto' 才走）：不可用（非 darwin/
    // 嵌套沙箱/sandbox-exec 缺失）→ ok:false + gap 明报 fail-closed 不派——圈定是
    // 安全面，「圈不住就照跑」不是选项。探测实现与语义见 detectSeatbeltBackend 注。
    if (this.seatbeltEnabled()) {
      const seatbelt = detectSeatbeltBackend()
      if (!seatbelt.ok) return { name: this.name, version, ok: false, gaps: [...gaps, ...seatbelt.gaps] }
    }
    return { name: this.name, version, ok: true, gaps }
  }

  /**
   * 预算预留估算。拟稿：预算估算模型 v0——按任务书字符量粗估，v0.6 前细化
   * （docs/16 里程碑 v0.6 = 预算/断路完善）。
   * 口径：字符量÷3 ≈ tokens（中文为主经验比）× $10/M（主线模型单价保守上界）；
   * 地板 $0.05、天花板 $8；confidence=0.2——启发式仅够预留参考，不可作账。
   * 任务书不可读按 0 字符计（地板价兜底，不粉饰——真账走 resultStats 实测 tokens）。
   */
  async estimate(task: TaskBrief): Promise<BudgetEstimate> {
    let chars = 0
    try {
      chars = (await readFile(task.briefPath, 'utf8')).length
    } catch {
      // 缺任务书：地板价兜底；装配管线缺件是上游问题，由 launch 前置闸报
    }
    const raw = Math.min(8, Math.max(0.05, (chars / 3 / 1_000_000) * 10))
    return { estimated: { usd: Math.round(raw * 10_000) / 10_000 }, confidence: 0.2 }
  }

  /**
   * 拉起 dsh（execa）：cwd=task.workspace；任务串=TaskBrief.briefPath 文件内容，以 `--`
   * 分隔符追加为单个位置参数（docs/31-§0 发现 2/§5-1：dsh headless 的任务=位置参数——
   * 不传则真机必以 usage error 退出；`--` 防任务串以 `-` 开头被当旗标）。任务书不可读
   * → 如实抛错（装配管线缺件，不静默传空串去撞真机的 "a task is required"）。
   * env=白名单允许集（filterWorkerEnv——docs/43-附录A-1 deny-by-default）+ AGENTS.md 通道
   * 变量（agentsMdEnv）+ TaskBrief.credentials（v1.4 短命按单凭据——键域封闭枚举闸
   * assertCredentialKeys，枚举外键结构拒收；值不打印不记录）+ DSH_TELEMETRY_MODE=DISABLED
   * （遥测红线，置于最后——红线优先级最高）。extendEnv:false（白名单生效前提，见 detect 位注记）。
   * reject:false——退出码不构成异常（成功判定只认流内终态，见 isCompleted）。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    return this.spawnHeadless(task, [])
  }

  /**
   * 续跑接线（预留面，2026-10-19 三件套之二落地）：以 dsh 侧会话 id（Handle.executorSessionId
   * 捕获值）透传 `--session-id <id>` 续跑同一任务书（真机形态：dsh --profile headless --json
   * --session-id session-… -- "任务串"，docs/31-§7 P-05 实证：turn:2、cacheReadTokens 前缀
   * 缓存命中=上下文延续）。
   * 硬约束（docs/31-§3.4 源码级，调度侧纪律）：cwd 必须与原会话记录的 cwd **逐字节一致**
   * （header.cwd !== cwd → dsh 立即报错）；未知 id → stdout 0 事件即败（经 stream() 消费
   * 为空流 + exit 1，isCompleted=false 如实）；subagent/fork 会话不可 adopt。
   * 注意：capabilities.session_resume 仍 false——端口开关（路由进调度）待「cwd 一致性落
   * 调度纪律」单独立项后翻转，本方法先行接线不声明能力（docs/31-§5-7）。
   */
  async resumeWithSession(task: TaskBrief, executorSessionId: string): Promise<Handle> {
    if (executorSessionId.trim() === '') {
      throw new Error('dsh: resumeWithSession 需要 dsh 侧会话 id（空串拒收——真机同款立即失败面）')
    }
    return this.spawnHeadless(task, ['--session-id', executorSessionId])
  }

  /** launch/resumeWithSession 共用落法：extraArgs 插在 `--` 任务串之前（dsh 旗标区） */
  private async spawnHeadless(task: TaskBrief, extraArgs: string[]): Promise<Handle> {
    const [binary = DSH_DEFAULT_CMD[0] ?? 'dsh', ...args] = this.cmd
    const taskText = await readTaskText(task.briefPath)
    // seatbelt 写域圈定（DEV-29 原型 attempt3，docs/43-§五②）：profile 随派发参数化生成
    // ——写域缺省=task.workspace+dshHomeRedirect+extraWriteRoots（judge 派发面走
    // writeRootsOverride 覆写=仅一次性 DSH_HOME，studio-dev-164 红队 2）；profile 缺省落
    // workspace/.seatbelt/（证据随单走，17-§6；judge 面 profileDir 移工作区外）；argv 以
    // sandbox-exec 包装（应用点=未沙箱派发方，嵌套 apply 被拒——detect 前置已闸）。
    let wrappedArgv: string[] = [binary, ...args, ...extraArgs, '--', taskText]
    let dshHomeEnv: Record<string, string> = {}
    if (this.seatbeltEnabled()) {
      const opts = this.seatbelt
      if (opts !== undefined) {
        // 写域：writeRootsOverride 覆写面（judge 派发面=仅一次性 DSH_HOME——workspace
        // 只读，studio-dev-164 红队 2）；缺省=task.workspace+extra+dshHomeRedirect
        const writeRoots =
          opts.writeRootsOverride !== undefined
            ? [...opts.writeRootsOverride]
            : [task.workspace, ...(opts.extraWriteRoots ?? [])]
        if (opts.writeRootsOverride === undefined && opts.dshHomeRedirect !== undefined) {
          writeRoots.push(opts.dshHomeRedirect)
        }
        if (opts.dshHomeRedirect !== undefined) {
          dshHomeEnv = { DSH_HOME: opts.dshHomeRedirect }
          mkdirSync(opts.dshHomeRedirect, { recursive: true })
        }
        const profileText = buildWorkerSeatbeltProfile({
          writeRoots,
          ...(opts.rpcEndpoints !== undefined ? { localRpcEndpoints: opts.rpcEndpoints } : {}),
          ...(opts.outboundTcp !== undefined ? { outboundTcp: opts.outboundTcp } : {}),
          label: `${task.ticket}/att${String(task.attempt)}`,
        })
        const profileDir = opts.profileDir ?? join(task.workspace, '.seatbelt')
        mkdirSync(profileDir, { recursive: true })
        const profilePath = join(profileDir, seatbeltProfileFileName())
        writeFileSync(profilePath, profileText, 'utf8')
        wrappedArgv = seatbeltArgv(profilePath, [binary, ...args, ...extraArgs, '--', taskText])
      }
    }
    const subprocess = execa(wrappedArgv[0] ?? binary, wrappedArgv.slice(1), {
      cwd: task.workspace,
      // env 白名单（docs/43-附录A-1，deny-by-default）：白名单允许集（PATH/HOME/LANG/
      // LC_*/TZ/TMPDIR/DSH_*）+ 框架注入键（AGENTS.md 通道变量）+ TaskBrief.credentials
      // （键域封闭枚举闸——枚举外键结构拒收 CONFIG_INVALID）+ seatbelt DSH_HOME 重定向
      // （DEV-29：DSH_ 前缀在允许集内，此处显式覆盖为写域内 per-attempt 落点）+ 遥测
      // 红线覆盖（置末，优先级最高）
      env: {
        ...filterWorkerEnv(process.env),
        ...agentsMdEnv(task.AGENTS_MD),
        ...checkedCredentials(task.credentials),
        ...dshHomeEnv,
        // 遥测红线（docs/31-§5-8）：dsh 默认 FEEDBACK_ONLY 外发 deepseeksvc.com——一律禁外发
        DSH_TELEMETRY_MODE: 'DISABLED',
      },
      extendEnv: false, // 白名单生效前提（同 detect 位注记：execa 缺省并入 process.env）
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false,
      killDescendants: true, // 16-§二 兑现（execa 10）：独立进程组，kill() 信号直达整组（子+孙）
      forceKillAfterDelay: false, // graceMs 是 kill() per-call 参数；10.x kill() 仍无 per-call 宽限，升级链自持
      // 类型注：execa 10 的具体选项实例化（ResultPromise<字面选项>）与泛型 Subprocess 在
      // exactOptionalPropertyTypes 下失协变（upstream 类型层缺口，运行时同物）——本行
      // as Subprocess 为单点收敛断言，四家同注
    }) as Subprocess
    const sessionId = randomUUID()
    const state: SessionState = {
      subprocess,
      startedAt: Date.now(),
      events: [],
      rawLines: [],
      streamConsumed: false,
      killed: false,
      settled: false,
    }
    sessions.set(sessionId, state)
    // execa 10：Subprocess 非 EventEmitter（无 .once/.exitCode 属性）——落定态由本派生观察器
    // 维护：退出→settled+退出码留档；spawn 层失败（ENOENT 等，reject:false 下仍 reject）
    // →spawnError+settled。reject 分支在此吞掉（防无人消费时的未处理拒绝；stream()/kill()
    // 各自的派生等待不外抛）
    subprocess.then(
      (result) => {
        state.settledExitCode = result.exitCode ?? null
        state.settled = true
      },
      (e: unknown) => {
        state.spawnError = asError(e)
        state.settled = true
      },
    )
    const pid = subprocess.pid
    if (pid === undefined) {
      sessions.delete(sessionId)
      throw state.spawnError ?? new Error(`dsh: launch 失败——未取得 pid（cmd=${binary}）`)
    }
    return { executor: this.name, sessionId, pid }
  }

  /**
   * 逐行流消费：stdout chunk → 行切割（含尾部无换行残行）→ parseLine(line,'dsh') 归一
   * → yield；事件与原文同时记入伴生状态。一会话只许消费一次。
   * 迭代自然结束（stdout EOF）后 await 子进程拿退出码（reject:false 不抛）。
   */
  async *stream(h: Handle): AsyncGenerator<StreamEvent, void, unknown> {
    const state = requireState(h)
    if (state.streamConsumed) {
      throw new Error(`dsh: stream() 已消费（sessionId=${h.sessionId}）——一单一命、一流一收`)
    }
    state.streamConsumed = true
    const stdout = state.subprocess.stdout
    if (stdout === null) {
      // spawn 即失败：无 stdout 通道——如实抛出（detect 前置漏网时在此明报）
      throw state.spawnError ?? new Error('dsh: 子进程 stdout 不可用（launch 失败）')
    }
    const consume = (line: string): StreamEvent[] => {
      state.rawLines.push(line)
      // P1 收存（docs/31-§5-6/§3.1）：流首 session 事件带 dsh 侧 session-<uuid>——捕获进
      // 伴生状态与 Handle.executorSessionId（契约 v1.5，2026-10-19 批；续跑/对账两便）。
      // 只捕获一次（首事件）；后续重复 session 行（真机无此面）不覆盖
      if (state.executorSessionId === undefined) {
        const dshSessionId = extractDshSessionId(line)
        if (dshSessionId !== undefined) {
          state.executorSessionId = dshSessionId
          h.executorSessionId = dshSessionId
        }
      }
      const events = parseLine(line, 'dsh')
      state.events.push(...events)
      return events
    }
    try {
      let pending = ''
      // execa stdout 迭代产出 Buffer 块（实测 9.6.1→10.1 同形）——统一按 utf8 解码
      for await (const chunk of stdout as AsyncIterable<unknown>) {
        pending += typeof chunk === 'string' ? chunk : String(chunk)
        let nl = pending.indexOf('\n')
        while (nl >= 0) {
          const line = pending.slice(0, nl)
          pending = pending.slice(nl + 1)
          for (const event of consume(line)) yield event
          nl = pending.indexOf('\n')
        }
      }
      // 尾部无换行的残行与 parseStream 全文切割行为一致（不丢最后一行）
      if (pending !== '') {
        for (const event of consume(pending)) yield event
      }
    } finally {
      state.endedAt = Date.now()
    }
    const result = await state.subprocess // reject:false：退出码/信号不抛错
    state.exitCode = result.exitCode ?? null // 被信号杀死时 undefined → null
    state.endedAt = Date.now()
  }

  /**
   * 账目汇总（只统计伴生状态里已消费的事件）：
   *   tokens：step_end 的 usage 求和（dsh 逐 step 记账且「不完整则整条省略」，docs/31-§3.2；
   *           无任何 step usage 时记零账——kill 面/预运行失败面如实，不编造）
   *   turns：step_end 计数（dsh 一个 turn 含 N 个 step 的近似记法——契约无备注位）
   *   duration：launch→流收尾（未收尾取 now）
   *   cost：恒 {usd:0}——cost_native=false，「待价目表折算」（文件头注，不改 contract）
   */
  async resultStats(h: Handle): Promise<ResultStats> {
    const state = requireState(h)
    return {
      cost: { usd: 0 },
      tokens: aggregateUsage(state.events),
      duration: (state.endedAt ?? Date.now()) - state.startedAt,
      turns: state.events.filter((e) => e.type === 'step_end').length,
    }
  }

  /**
   * 优雅终止（整树）：SIGTERM 软杀整树 → 宽限 graceMs → SIGKILL 硬杀整树（升级链自持）。
   * killDescendants（execa 10）下每次 kill() 信号直达子进程所在进程组——子+孙一概波及；
   * 直子退出即返回，扫尾定时器不因父先退而取消：吞 TERM 的孙进程由宽限到点的整组
   * SIGKILL 收口（详见文件头注）。
   * 已退出的进程不重复杀；幂等（重复 kill 直接返回）。
   * 已知坑（17-§6）：dsh 可能吞 SIGTERM 后退出码 0——成功判定与此无关（isCompleted）。
   */
  async kill(h: Handle, graceMs: number): Promise<void> {
    const state = requireState(h)
    if (state.killed) return
    state.killed = true
    if (state.settled) {
      return // 已退出（含 spawn 失败）：无可杀
    }
    const proc = state.subprocess
    proc.kill('SIGTERM') // 整组软杀（killDescendants：信号直达进程组，孙进程同波及）
    const escalate = setTimeout(() => {
      // 宽限到点整组硬杀：父吞 TERM 不退、或父先退而孙吞 TERM 残留，一概收口；
      // 组已尽时为无害 no-op（execa 组杀 ESRCH 回落已退进程直杀返回 false，不抛）
      proc.kill('SIGKILL')
    }, Math.max(0, graceMs))
    escalate.unref() // 扫尾兜底不阻止进程退出（kill() 返回后定时器照常待触发）
    // 10.x 无 exit 事件可听（Subprocess 非 EventEmitter）：等 promise 落定——直子退出或
    // spawn 失败均在此吞掉并返回（reject 分支兜底，正常路径 reject:false 不抛）
    await state.subprocess.then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * 收割判定——终态判据唯一化（docs/31-§7 P-08 真机定性）：存在 turn_end 且
   * completed=true（即流内 turn_end.reason.kind==='completed'），且仅此一条。
   * 退出码与「输出非空」一律不参与：kill 面=空 final + 无 turn_end + exit 0（P-08 实录），
   * 旧「hasOutput 近似」会把 kill 判象混进判定面，已删。空 final + 无 turn_end = 被 kill
   * （aborted 口径，非成功非失败——处置分类归 core）。
   */
  isCompleted(h: Handle): boolean {
    return requireState(h).events.some((e) => e.type === 'turn_end' && e.completed)
  }

  /** 退出码记录（证据价值，不参与成功判定）；null=被信号杀死；undefined=未落定（运行中/spawn 失败） */
  exitCode(h: Handle): number | null | undefined {
    const state = requireState(h)
    // 10.x 无同步 exitCode 属性：流收尾档（state.exitCode）优先，未消费流时读落定观察器留档
    return state.exitCode ?? state.settledExitCode
  }
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/**
 * credentials 键域检查 + 原样透传（值不打印不记录——红名单纪律不变）。
 * 枚举外键在此结构拒收（CONFIG_INVALID）——launch 前置失败如实上报，不带病起进程。
 */
function checkedCredentials(creds: TaskBrief['credentials']): Record<string, string> {
  if (creds === undefined) return {}
  assertCredentialKeys(creds)
  return { ...creds }
}

/**
 * AGENTS.md 通道 env 映射——插件通道（2026-10-19 三件套之一落地，docs/25-§3.1 v1.5 裁决#1）：
 * user_level / append_system_prompt 两通道改注 `STUDIO_NEXT_INSTRUCTIONS=<target>`，由
 * studio-next-bridge 宿主插件（packages/dsh-bridge）在 agent 创建时读文件注入系统提示
 * persona 前缀段（docs/31-§5-5 真方案：真机无任何 DSH_* 注入 env——旧变量
 * DSH_AGENTS_MD / DSH_APPEND_SYSTEM_PROMPT_FILE 全配置面零命中，已证伪移除 docs/31-A1）。
 * 前提：插件已挂载（per-company profile patch insert 条目或 --patch overlay）——未挂载时
 * 该 env 无消费者（无害空注，注入不发生）。dsh 侧两通道在此汇成一个注入面（无 append 专道）。
 * native → 不注入（与真机原生发现吻合：launch cwd 向上扫 AGENTS.md>CLAUDE.md，P-07 实证）。
 * target 落点由 L5 装配决定、适配器只透传（docs/25-§二 TaskBrief 注释；docs/04-§六）。
 */
function agentsMdEnv(a: TaskBrief['AGENTS_MD']): Record<string, string> {
  switch (a.channel) {
    case 'native':
      return {}
    case 'user_level':
    case 'append_system_prompt':
      return { STUDIO_NEXT_INSTRUCTIONS: a.target }
  }
}

/**
 * 任务串读取：briefPath 全文即任务文本（字节如实，不裁不拼——dsh headless 单位置参数）。
 * 不可读 → 抛错（装配管线缺件，launch 前置失败如实上报，不静默传空）。
 */
async function readTaskText(briefPath: string): Promise<string> {
  try {
    return await readFile(briefPath, 'utf8')
  } catch (e) {
    throw new Error(`dsh: 任务书不可读（briefPath=${briefPath}）：${errMsg(e)}`)
  }
}

/**
 * usage 账目归并：只认 step_end usage 求和（docs/31-§3.2：真机 turn_end 恒无 usage，
 * 旧 turn_end 兜底分支已删）；无任何 step usage → 零账（kill 面/预运行失败面，不编造）
 */
function aggregateUsage(events: readonly StreamEvent[]): TokenCounts {
  let input = 0
  let output = 0
  let cached = 0
  let seen = false
  for (const e of events) {
    if (e.type === 'step_end' && e.usage !== undefined) {
      seen = true
      input += e.usage.input
      output += e.usage.output
      cached += e.usage.cached ?? 0
    }
  }
  return seen ? { input, output, cached } : { input: 0, output: 0 }
}

/** ENOENT 判定（未安装）：execa reject:false 下 spawn 失败挂在 result.cause（实测 9.6.1→10.1 同形） */
function isENOENT(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | undefined)?.code
  return code === 'ENOENT' || asError(cause).message.includes('ENOENT')
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

function errMsg(e: unknown): string {
  const msg = asError(e).message
  return msg === '' ? String(e) : msg
}
