/**
 * claude 适配器（参考实现，docs/18-§1.2）——首刀：对 fake CLI harness 全绿；真 CLI 行为留探针单
 *
 * 依据：
 *   - docs/17-§6 claude 行：launch=`claude -p --output-format stream-json --max-budget-usd`；
 *     流=stream-json，result 事件是唯一终态；resultStats 取原生 cost/tokens/duration；
 *     kill=killpg TERM→KILL
 *   - docs/18-§一：claude≥2.1.277 才原生读 AGENTS.md——detect 的版本门槛；不达标明报，
 *     绝不静默降级
 *   - docs/17-§5：AGENTS.md 用户级通道优先；claude<2.1.277 回退 append-system-prompt-file
 *   - docs/25-§3.1 ExecutorAdapter 端口；ResultStats 口径 cost=Money{usd}、duration=DurationMs
 *   - docs/25-§二（v1.4）：TaskBrief.credentials 短命按单凭据——launch env 无条件透传进
 *     子进程；其值不记录不打印（红名单），流/日志/账面文本永不含凭据
 *
 * 拟稿（首刀自拟口径，待真 claude 探针单核实——只记录，不擅自定案）：
 *   - user_level 通道 env 映射：CLAUDE_CONFIG_DIR=<target>（变量名未见框架文档定义，按
 *     官方 CLI 环境变量惯例拟稿；真通道接口以探针结论为准，届时走批示改此处）
 *   - append_system_prompt 通道旗标 `--append-system-prompt-file <target>`：此项有官方
 *     文档依据（docs/17-§6 / 复查 A3），非拟稿
 *   - capabilities.agents_md 静态声明 'native'：contract 无「版本门控的动态通道」概念，
 *     不改契约；<2.1.277 的自动降级（native/user_level → append_system_prompt）发生在
 *     launch()，且 detect() 已以 gaps 明报——非静默降级
 *   - detect() 跑 `[...cmd, '--version']`：生产缺省 cmd=['claude']，与 binary+--version 等
 *     价；传完整前缀使注入的假 CLI 能按 FAKE_VERSION 旋钮回放版本输出（测试可控性取舍）
 *   - estimate()：与 dsh 相同的预算估算模型 v0 拟稿（任务书字符量粗估 + 低 confidence）；
 *     claude 有原生 cost，真账以 resultStats 为准
 *   - kill=killpg TERM→KILL 已兑现：execa 10 killDescendants:true（docs/27-§4.3 案 A，
 *     16-§二「唯一内建进程组杀法」）；升级链同构自持 SIGTERM→grace→SIGKILL，信号直达
 *     整组（子+孙）——与 dsh 头注同款，细节见彼处
 *
 * 已知坑与取舍（沉淀于此，docs/18-§1.2）：
 *   - 版本门槛：≥2.1.277 原生读 AGENTS.md；低于门槛 ok:true 不拦截启动，gaps 明报
 *     `claude-agents-md-fallback:<version><2.1.277`，launch 时 native/user_level 通道
 *     自动降级 append_system_prompt（17-§5 回退口径）；解析失败/未装/超时 → ok:false 明报
 *   - 版本比较取数字核心（2.1.277-rc.1 → [2,1,277]）：门槛版的 rc 视同达标——预发布语义
 *     未在文档定义，探针单核实后如需收紧走批示
 *   - result 事件是唯一终态（subtype==='success' 且 is_error!==true 才 completed）；
 *     kill 后 result 未到 = 无终态：isCompleted=false、账目零值（cost 无来源、tokens 无事件）
 *   - 原生账目（cost_native=true，四家第一家）：total_cost_usd/duration_ms/num_turns 从
 *     result 事件原文捕获进伴生状态（streams.parseLine 不透传这四项——协议疑点见 streams.ts
 *     头注）；tokens 复用 result 归一出的 turn_end.usage（同一事件经 streams 的归一投影，
 *     不二次解析 usage 字段）
 *   - session_id 从 result 事件回填伴生状态（nativeSessionId(h) 读）：续跑 --resume 用的是
 *     claude 原生 session id（与 Handle.sessionId 框架 UUID 是两回事）；TaskBrief.resume.sessionId
 *     由装配管线回填，适配器只透传
 *   - execa 10 实测（10.1.1）：kill() 仍无 per-call 宽限（第二参是 Error 实例），
 *     forceKillAfterDelay 仍只支持 spawn 级——graceMs 是 kill() 的 per-call 契约参数，
 *     故弃 spawn 级兜底（forceKillAfterDelay:false），SIGKILL 升级链由 kill() 自持（16-§二）
 *   - spawn 统一 reject:false——退出码只记录不参与判定（claude 无 dsh「吞信号退出 0」坑，
 *     但成功判定同样只认流内终态）
 *   - 伴生状态 sessions 为模块级私有 Map：随 daemon 进程存续，v0 不做回收（台账落盘后可重建）
 *   - stream() 一会话只许消费一次（一单一命、一流一收）；resultStats() 只汇总已消费的事件
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

/** 缺省命令（docs/17-§6 claude 行）：launch 时追加 `-p --output-format stream-json` 与动态旗标 */
export const CLAUDE_DEFAULT_CMD: readonly string[] = ['claude']

/** AGENTS.md 原生读取的版本门槛（docs/18-§一：claude≥2.1.277） */
export const CLAUDE_AGENTS_MD_MIN_VERSION = '2.1.277'

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
const DETECT_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Handle 伴生状态（模块内私有）
// ---------------------------------------------------------------------------

/** result 事件原生账目（streams.parseLine 不透传，适配器自行捕获——见文件头注） */
interface NativeResultMeta {
  /** result.total_cost_usd → ResultStats.cost.usd（cost_native=true 的账目来源） */
  costUsd?: number
  /** result.duration_ms → ResultStats.duration（原生时长优先于墙钟） */
  durationMs?: number
  /** result.num_turns → ResultStats.turns */
  numTurns?: number
  /** result.session_id：claude 原生会话 id，续跑 --resume 用（nativeSessionId 读） */
  sessionId?: string
}

interface SessionState {
  readonly subprocess: Subprocess
  readonly startedAt: number
  /** stream() 消费时累积的归一事件（resultStats 的 tokens/兜底账目来源） */
  readonly events: StreamEvent[]
  /** 逐行 stdout 原文缓冲（证据留痕，未解析；台账落盘归 daemon） */
  readonly rawLines: string[]
  streamConsumed: boolean
  killed: boolean
  /** 子进程 promise 已落定（退出或 spawn 失败）——由 launch 的派生观察器置位（dsh 头注 10.x 项） */
  settled: boolean
  /** promise 落定时留档的退出码（null=被信号杀死；未落定/spawn 失败时 undefined） */
  settledExitCode?: number | null
  /** spawn 层失败（如 ENOENT）——stdout 不可用时 stream() 如实抛出 */
  spawnError?: Error
  /** 流收尾时刻（kill 或自然退出后）；未收尾时 undefined */
  endedAt?: number
  /** stream() 收尾时记录的退出码（null=被信号杀死） */
  exitCode?: number | null
  /** result 事件原生账目（result 未到时 undefined——kill 无终态面） */
  nativeResult?: NativeResultMeta
}

/** sessionId（UUID 全局唯一）→ 伴生状态；多实例共享不冲突，见文件头注 */
const sessions = new Map<string, SessionState>()

function requireState(h: Handle): SessionState {
  const state = sessions.get(h.sessionId)
  if (state === undefined) {
    throw new Error(
      `claude: 未知的 sessionId=${h.sessionId}（伴生状态缺失——launch 未发生或 daemon 已重启）`,
    )
  }
  return state
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

export class ClaudeAdapter implements ExecutorAdapter {
  readonly name = 'claude'

  readonly capabilities: ExecutorCapabilities = {
    budget_cap: true, // --max-budget-usd（17-§6 claude 行）
    cancel_turn: false, // 无单轮取消原语，只能整进程 kill
    session_resume: true, // --resume；原生 session id 由 nativeSessionId() 回填装配管线
    agents_md: 'native', // 静态声明；<2.1.277 时 launch 自动降级 append_system_prompt（拟稿见头注）
    cost_native: true, // result 事件原生 total_cost_usd（四家第一家）
  }

  private readonly cmd: readonly string[]

  /** detect() 回填：低于门槛时 launch 的 AGENTS_MD 通道自动降级（native/user_level→append） */
  private agentsMdBelowThreshold = false

  /** cmd 可注入（测试用假 CLI）；缺省 `claude`（17-§6，launch 时追加流式旗标） */
  constructor(cmd: readonly string[] = CLAUDE_DEFAULT_CMD) {
    this.cmd = cmd.length > 0 ? cmd : CLAUDE_DEFAULT_CMD
  }

  /**
   * 版本探测：跑 `[...cmd, '--version']`（超时 5s）解析版本号。
   * 三态（docs/18-§一 版本门槛）：
   *   - 可解析且 ≥2.1.277 → ok:true、无 gaps（agents_md native 可用）
   *   - 可解析但 <2.1.277 → ok:true + gaps 明示回退（不拦截启动，launch 通道自动降级）
   *   - 未安装 / 解析失败 / 超时 → ok:false 明报（不静默降级）
   */
  async detect(): Promise<DetectResult> {
    const binary = this.cmd[0] ?? CLAUDE_DEFAULT_CMD[0] ?? 'claude'
    const result = await execa(binary, [...this.cmd.slice(1), '--version'], {
      timeout: DETECT_TIMEOUT_MS,
      reject: false, // 探测失败走 gaps 明报，不靠异常表达
      env: { ...process.env },
    })
    if (result.timedOut) {
      return { name: this.name, version: '', ok: false, gaps: ['claude-detect-timeout'] }
    }
    if (result.failed) {
      // spawn 层失败（ENOENT=未安装；其他如实带原因明报）
      const gap = isENOENT(result.cause)
        ? 'claude-not-installed'
        : `claude-detect-failed:${errMsg(result.cause)}`
      return { name: this.name, version: '', ok: false, gaps: [gap] }
    }
    // `claude --version` 实际输出形如 `2.1.277 (Claude Code)`：取首个语义化版本串
    const match = /v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/.exec(result.stdout.trim())
    if (match === null) {
      return { name: this.name, version: '', ok: false, gaps: ['claude-version-unparsed'] }
    }
    const version = match[1] ?? ''
    const below = isBelowThreshold(version, CLAUDE_AGENTS_MD_MIN_VERSION)
    this.agentsMdBelowThreshold = below // 回填通道门控（detect 前置是框架纪律，18-§一）
    const gaps = below
      ? [`claude-agents-md-fallback:${version}<${CLAUDE_AGENTS_MD_MIN_VERSION}:degrade-to-append_system_prompt`]
      : []
    return { name: this.name, version, ok: true, gaps }
  }

  /**
   * 预算预留估算。拟稿（与 dsh 同一 v0 模型，v0.6 前细化；docs/16 里程碑 v0.6=预算/断路完善）：
   * 字符量÷3 ≈ tokens × $10/M；地板 $0.05、天花板 $8；confidence=0.2——启发式仅够预留参考。
   * claude 有 --max-budget-usd 硬帽 + 原生 cost 真账，本估值只作预留，不作账。
   * 任务书不可读按 0 字符计（地板价兜底，不粉饰）。
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
   * 拉起 claude（execa）：`claude -p --output-format stream-json`
   * + 预算帽 `--max-budget-usd <usd>`（budgetCap 存在时）
   * + 续跑 `--resume <sessionId>`（task.resume 存在时）
   * + AGENTS_MD 通道（经版本门槛门控后）：
   *     native=不注入；user_level=CLAUDE_CONFIG_DIR=<target>（拟稿）；append_system_prompt=
   *     `--append-system-prompt-file <target>`（官方文档依据，17-§6/复查 A3）
   * cwd=task.workspace；TaskBrief.credentials（v1.4）无条件透传进子进程 env（值不打印
   * 不记录）；reject:false——退出码不构成异常（成功判定只认流内终态）。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    const [binary = CLAUDE_DEFAULT_CMD[0] ?? 'claude', ...base] = this.cmd
    const args = [...base, '-p', '--output-format', 'stream-json']
    if (task.budgetCap !== undefined) {
      args.push('--max-budget-usd', String(task.budgetCap.usd))
    }
    if (task.resume !== undefined) {
      args.push('--resume', task.resume.sessionId)
    }
    const channel = effectiveAgentsMdChannel(task.AGENTS_MD.channel, this.agentsMdBelowThreshold)
    if (channel === 'append_system_prompt') {
      args.push('--append-system-prompt-file', task.AGENTS_MD.target)
    }
    const subprocess = execa(binary, args, {
      cwd: task.workspace,
      env: {
        ...process.env,
        ...(channel === 'user_level' ? { CLAUDE_CONFIG_DIR: task.AGENTS_MD.target } : {}),
        ...(task.credentials ?? {}),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false,
      killDescendants: true, // 16-§二 兑现（execa 10）：独立进程组，kill() 信号直达整组（子+孙）
      forceKillAfterDelay: false, // graceMs 是 kill() per-call 参数；10.x kill() 仍无 per-call 宽限，升级链自持
      // 类型注：execa 10 具体选项实例化与泛型 Subprocess 在 exactOptionalPropertyTypes 下
      // 失协变（upstream 类型层缺口，运行时同物）——as Subprocess 单点收敛断言，四家同注
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
    // 维护（与 dsh 同构，详见 dsh 头注）：退出→settled+退出码留档；spawn 失败→spawnError+settled；
    // reject 分支在此吞掉（防无人消费时的未处理拒绝）
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
      throw state.spawnError ?? new Error(`claude: launch 失败——未取得 pid（cmd=${binary}）`)
    }
    return { executor: this.name, sessionId, pid }
  }

  /**
   * 逐行流消费：stdout chunk → 行切割（含尾部无换行残行）→ parseLine(line,'claude') 归一
   * → yield；事件与原文同时记入伴生状态，result 事件原文额外捕获原生账目（noteResultMeta）。
   * 一会话只许消费一次。迭代自然结束（stdout EOF）后 await 子进程拿退出码（reject:false 不抛）。
   */
  async *stream(h: Handle): AsyncGenerator<StreamEvent, void, unknown> {
    const state = requireState(h)
    if (state.streamConsumed) {
      throw new Error(`claude: stream() 已消费（sessionId=${h.sessionId}）——一单一命、一流一收`)
    }
    state.streamConsumed = true
    const stdout = state.subprocess.stdout
    if (stdout === null) {
      // spawn 即失败：无 stdout 通道——如实抛出（detect 前置漏网时在此明报）
      throw state.spawnError ?? new Error('claude: 子进程 stdout 不可用（launch 失败）')
    }
    const consume = (line: string): StreamEvent[] => {
      state.rawLines.push(line)
      noteResultMeta(line, state)
      const events = parseLine(line, 'claude')
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
   * 账目汇总（cost_native=true，四家第一家；只统计已消费的事件）：
   *   cost    = result.total_cost_usd（原生；result 未到时 0——kill 无终态面）
   *   tokens  = result 事件归一出的 turn_end.usage（streams 已归一，不二次解析）
   *   duration= result.duration_ms 优先；result 未到时回退墙钟（launch→流收尾）
   *   turns   = result.num_turns 优先；result 未到时回退 turn_end 事件计数（0）
   */
  async resultStats(h: Handle): Promise<ResultStats> {
    const state = requireState(h)
    const meta = state.nativeResult
    const usage = lastTurnEndUsage(state.events)
    return {
      cost: { usd: meta?.costUsd ?? 0 },
      tokens: usage ?? { input: 0, output: 0 },
      duration: meta?.durationMs ?? (state.endedAt ?? Date.now()) - state.startedAt,
      turns: meta?.numTurns ?? state.events.filter((e) => e.type === 'turn_end').length,
    }
  }

  /**
   * 优雅终止（整树）：SIGTERM 软杀整树 → 宽限 graceMs → SIGKILL 硬杀整树（与 dsh 同构
   * 升级链，killDescendants 细节见 dsh 头注）。
   * 已退出的进程不重复杀；幂等（重复 kill 直接返回）。
   * claude 无 dsh「吞 SIGTERM 退出 0」坑，但 kill 后 result 未到即无终态（isCompleted=false）。
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
    // 10.x 无 exit 事件可听（Subprocess 非 EventEmitter）：等 promise 落定（与 dsh 同构）
    await state.subprocess.then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * 收割判定（17-§6 口径）：turn_end.completed=true 且存在非空 log 文本。
   * claude 的 turn_end 由 result 事件归一而来（唯一终态）；退出码不参与判定。
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
    // 10.x 无同步 exitCode 属性：流收尾档优先，未消费流时读落定观察器留档（与 dsh 同构）
    return state.exitCode ?? state.settledExitCode
  }

  /**
   * claude 原生 session id（result 事件回填，伴生状态）——续跑 --resume 的输入；
   * result 未到（被杀/未消费）时 undefined。与 Handle.sessionId（框架 UUID）是两回事。
   */
  nativeSessionId(h: Handle): string | undefined {
    return requireState(h).nativeResult?.sessionId
  }
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/**
 * AGENTS_MD 通道在版本门槛下的有效值（17-§5：claude<2.1.277 回退 append-system-prompt-file）：
 * detect 判定低于门槛时 native/user_level 一律降级 append_system_prompt（append 不受影响）。
 * 明报在 detect().gaps——此处只做通道落地，非静默降级。
 */
function effectiveAgentsMdChannel(
  channel: TaskBrief['AGENTS_MD']['channel'],
  belowThreshold: boolean,
): TaskBrief['AGENTS_MD']['channel'] {
  if (belowThreshold && channel !== 'append_system_prompt') {
    return 'append_system_prompt'
  }
  return channel
}

/** 版本比较（数字核心逐段比；低于门槛返回 true）：2.1.276<2.1.277、2.2.0≥门槛、2.1.300>2.1.99 */
function isBelowThreshold(version: string, threshold: string): boolean {
  const a = numericParts(version)
  const b = numericParts(threshold)
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

/** 取版本串数字核心（预发布后缀截断：2.1.277-rc.1 → [2,1,277]——rc 视同达标，见头注） */
function numericParts(v: string): number[] {
  const core = /^v?(\d+(?:\.\d+)*)/.exec(v)?.[1] ?? ''
  if (core === '') return []
  return core.split('.').map((p) => {
    const n = Number.parseInt(p, 10)
    return Number.isNaN(n) ? 0 : n
  })
}

/**
 * result 事件原生账目捕获：streams.parseLine 只透传 usage/终态（协议疑点见 streams.ts 头注），
 * total_cost_usd/duration_ms/num_turns/session_id 由本函数从原文捕获进伴生状态。
 * 非 JSON 行 / 非 result 事件静默跳过（归一化与账目捕获职责分离，互不干扰）。
 */
function noteResultMeta(line: string, state: SessionState): void {
  let v: unknown
  try {
    v = JSON.parse(line) as unknown
  } catch {
    return
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return
  const r = v as Record<string, unknown>
  if (r['type'] !== 'result') return
  const costUsd = asFinite(r['total_cost_usd'])
  const durationMs = asFinite(r['duration_ms'])
  const numTurns = asFinite(r['num_turns'])
  const sessionId = typeof r['session_id'] === 'string' ? r['session_id'] : undefined
  state.nativeResult = {
    ...state.nativeResult,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(numTurns !== undefined ? { numTurns } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  }
}

/** 最后一个带 usage 的 turn_end（claude 的 turn_end 由 result 事件归一——即 result.usage） */
function lastTurnEndUsage(events: readonly StreamEvent[]): TokenCounts | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e !== undefined && e.type === 'turn_end' && e.usage !== undefined) return e.usage
  }
  return undefined
}

/** ENOENT 判定（未安装）：execa reject:false 下 spawn 失败挂在 result.cause（实测 9.6.1→10.1 同形） */
function isENOENT(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | undefined)?.code
  return code === 'ENOENT' || asError(cause).message.includes('ENOENT')
}

function asFinite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

function errMsg(e: unknown): string {
  const msg = asError(e).message
  return msg === '' ? String(e) : msg
}
