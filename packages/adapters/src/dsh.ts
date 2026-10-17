/**
 * dsh 适配器（默认主力 executor）——首刀：对 fake CLI harness 全绿；真 CLI 行为留探针单
 *
 * 依据：
 *   - docs/17-§6 dsh 行：launch=`dsh --profile headless --json`（锁版本）；流=NDJSON
 *     （step_end 带 usage）；tokens 有、成本无价目表折算（cost_native=false）；
 *     SIGTERM 可杀；成功判定=turn_end.completed+输出非空，非退出码
 *   - docs/18-§一：ExecutorAdapter 六原语；detect 不达标明报，绝不静默降级
 *   - docs/16-§二：子进程用 execa；executor=dsh 默认锁 0.2.0-rc.2（锁版本升级走回归）
 *   - docs/25-§二（v1.4）：TaskBrief.credentials 短命按单凭据——launch env 无条件透传进
 *     子进程；其值不记录不打印（红名单），流/日志/账面文本永不含凭据
 *
 * 拟稿（首刀自拟口径，待真 dsh 探针单核实——只记录，不擅自定案）：
 *   - AGENTS.md 通道 env 映射最小集（agentsMdEnv）：native 不注入；user_level 注入
 *     DSH_AGENTS_MD=<target>；append_system_prompt 注入 DSH_APPEND_SYSTEM_PROMPT_FILE=<target>。
 *     变量名未见文档定义（镜像 claude append-system-prompt-file 语义自拟），真 dsh 的
 *     通道接口以探针结论为准，届时走批示改此处
 *   - capabilities.agents_md='native'：按「dsh 原生读 workspace 根 AGENTS.md」假设声明
 *   - estimate()：预算估算模型 v0——任务书字符量粗估 + confidence 低值，v0.6 前细化
 *   - isCompleted() 的「输出非空」以「存在非空 log 文本」近似（REPORT 落盘与闸门 exit
 *     归 core 收割四要件，不在适配器层）
 *
 * 已知坑与取舍（沉淀于此，docs/18-§1.2）：
 *   - 「dsh 被 kill 后退出码=0 且 final 为空」（17-§6）：exitCode 只记录不参与判定；
 *     spawn 统一 reject:false——非零退出码/被信号杀死不抛错，退出码对收割只有证据价值
 *   - execa 已升 10.x（docs/27-§4.3 案 A 拍板，16-§二「唯一内建进程组杀法」兑现）：
 *     spawn 配 killDescendants:true——Unix 落法为独立进程组，kill() 信号直达整组
 *     （子+孙），kill 链语义升级为「SIGTERM 软杀整树 → graceMs → SIGKILL 硬杀整树」
 *   - 10.x 实测（10.1.1 类型+源码）：kill(signal, error) 第二参是 Error 实例，仍无
 *     per-call 宽限；forceKillAfterDelay 仍只支持 spawn 级——而 graceMs 是 kill() 的
 *     per-call 契约参数，故弃 spawn 级兜底（forceKillAfterDelay:false），升级链自持
 *   - 10.x Subprocess 不再是 ChildProcess/EventEmitter：无 .once/.on（逃生口
 *     .nodeChildProcess）、无 .exitCode/.signalCode 同步属性——落定态改由 launch 的
 *     promise 派生观察器维护（settled/settledExitCode 伴生字段）；kill() 等落定用
 *     派生分支（reject 分支吞掉，见 kill() 注）
 *   - 宽限扫尾定时器不因父先退而取消（unref 不阻退出）：吞 TERM 的孙进程由宽限到点的
 *     整组 SIGKILL 收口（Unix 父退后 PGID 在组员存续期间保留，组杀仍可达；组已尽时
 *     为无害 no-op。理论 PID 复用误杀窗口系 upstream 文档化已知局限，概率极低）
 *   - resultStats().cost 恒 {usd:0}：cost_native=false，待价目表折算；ResultStats 结构
 *     无备注字段，不改 contract——以本头注 + 汇报记录「待价目表折算」
 *   - 伴生状态 sessions 为模块级私有 Map：sessionId 用随机 UUID，多实例不冲突；随
 *     daemon 进程存续，v0 不做回收（台账落盘后状态可重建投影）
 *   - stream() 一会话只许消费一次（一单一命、一流一收）；resultStats() 只汇总已消费
 *     的事件（收割流程固定先收流后收账）
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
import { parseLine } from './streams.ts'

/** 缺省命令（docs/17-§6 dsh 行）：`dsh --profile headless --json` */
export const DSH_DEFAULT_CMD: readonly string[] = ['dsh', '--profile', 'headless', '--json']

/** 锁定版本（docs/16-§二：dsh 锁 0.2.0-rc.2，锁版本升级走回归） */
const LOCKED_VERSION = '0.2.0-rc.2'

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
const DETECT_TIMEOUT_MS = 5_000

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
    agents_md: 'native', // 拟稿：假设原生读 workspace AGENTS.md（待探针；通道 env 见 agentsMdEnv）
    cost_native: false, // 17-§6：tokens 有，成本无价目表折算
  }

  private readonly cmd: readonly string[]

  /** cmd 可注入（测试用假 CLI）；缺省 `dsh --profile headless --json`（17-§6） */
  constructor(cmd: readonly string[] = DSH_DEFAULT_CMD) {
    this.cmd = cmd.length > 0 ? cmd : DSH_DEFAULT_CMD
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
      env: { ...process.env },
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
   * 拉起 dsh（execa）：cwd=task.workspace；env=进程环境 + AGENTS.md 通道变量最小集
   * （agentsMdEnv 拟稿）+ TaskBrief.credentials（v1.4 短命按单凭据——无条件透传进
   * 子进程 env，值不打印不记录）；句柄与逐行流缓冲存入伴生状态（模块私有 Map）。
   * reject:false——退出码不构成异常（成功判定只认流内终态，17-§6 已知坑）。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    const [binary = DSH_DEFAULT_CMD[0] ?? 'dsh', ...args] = this.cmd
    const subprocess = execa(binary, args, {
      cwd: task.workspace,
      env: { ...process.env, ...agentsMdEnv(task.AGENTS_MD), ...(task.credentials ?? {}) },
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
   *   tokens：step_end 的 usage 求和（dsh 逐 step 记账；golden fixture 中和=turn_end 总账），
   *           一个 step_end usage 都没有时回退最后一个带 usage 的 turn_end（终态总账兜底）
   *   turns：step_end 计数；duration：launch→流收尾（未收尾取 now）
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
   * 收割判定（17-§6 dsh 行冻结口径）：turn_end.completed=true 且存在非空 log 文本。
   * 退出码不参与判定——「被 kill 后退出码=0 且 final 为空」的已知坑由本口径挡住。
   */
  isCompleted(h: Handle): boolean {
    const events = requireState(h).events
    const completedTurn = events.some((e) => e.type === 'turn_end' && e.completed)
    const hasOutput = events.some((e) => e.type === 'log' && e.text !== '')
    return completedTurn && hasOutput
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
 * AGENTS.md 通道 env 映射最小集（拟稿——变量名自拟，真 dsh 通道接口待探针单核实）：
 *   native               → 不注入（dsh 原生读 workspace 根 AGENTS.md）
 *   user_level           → DSH_AGENTS_MD=<target>（用户级通道文件路径）
 *   append_system_prompt → DSH_APPEND_SYSTEM_PROMPT_FILE=<target>（镜像 claude
 *                          append-system-prompt-file 语义）
 * target 落点由 L5 装配决定、适配器只透传（docs/25-§二 TaskBrief 注释）。
 */
function agentsMdEnv(a: TaskBrief['AGENTS_MD']): Record<string, string> {
  switch (a.channel) {
    case 'native':
      return {}
    case 'user_level':
      return { DSH_AGENTS_MD: a.target }
    case 'append_system_prompt':
      return { DSH_APPEND_SYSTEM_PROMPT_FILE: a.target }
  }
}

/** usage 账目归并：step_end usage 求和优先，无任何 step usage 时回退最后带 usage 的 turn_end */
function aggregateUsage(events: readonly StreamEvent[]): TokenCounts {
  let input = 0
  let output = 0
  let cached = 0
  let seen = false
  let fallback: TokenCounts | undefined
  for (const e of events) {
    if (e.type === 'step_end' && e.usage !== undefined) {
      seen = true
      input += e.usage.input
      output += e.usage.output
      cached += e.usage.cached ?? 0
    } else if (e.type === 'turn_end' && e.usage !== undefined) {
      fallback = e.usage
    }
  }
  if (seen) return { input, output, cached }
  return fallback ?? { input: 0, output: 0 }
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
