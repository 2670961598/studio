/**
 * agy 适配器（Antigravity CLI / Gemini 源；team task-140）——登记不启用：首刀对 fake CLI 全绿，
 * 真 CLI 行为留探钢单（docs/quality/agy-adapter.md）
 *
 * 依据：
 *   - docs/18-§一（executor 四原语＋detect 三态纪律）、docs/17-§6（收割口径：终态事件＋非空输出）、
 *     docs/25-§二/§3.1（TaskBrief.credentials 短命按单凭据；usage 归一）、docs/43-附录A-1（env 白名单）
 *   - task-140 实测事实单（本机 agy v1.5.18；docs/quality/agy-adapter.md §二）
 *   - 四家（dsh/claude/codex/kimi）同构取舍：伴生状态模块级 Map、watchdog、kill 升级链、exitCode 只留证据
 *
 * 形态（实测）：headless 单对象终稿——`agy -p <任务串> --output-format json
 * --dangerously-skip-permissions` 正常收尾在 stdout 打一份 JSON（成功 {status:"SUCCESS",response,
 * conversation_id,duration_seconds,num_turns,usage}；失败 {status:"ERROR",error}）；非流式，无 step
 * 级事件。usage 桶 input/output/thinking/cache_read（契约三新键映射见 agy-json.ts）。
 * 分片（BC-S2 尺寸阈「先拆后加」）：argv/env 纯函数在 agy-argv.ts，终稿解析/失败分类在 agy-json.ts。
 *
 * 已知坑与取舍：
 *   - 无流：stream() 全量缓冲 stdout 至 EOF、等子进程落定后一次性 yield（终局前消费方看不到事件
 *     ——agy 形态固有，不伪造 step 事件）；stdout 读取异常不吞，记入终态文本
 *   - 凭据走本机 OAuth（安装后 `agy` 交互登录一次），无已证 env 凭据面；子进程 env 只经
 *     buildAgyEnv 合成（宿主封闭允许集＋proxyEnv/credentials 封闭枚举＋高危键拒收，大小写不敏感
 *     ——task-147 三道闸，agy-argv.ts）；他家凭据键不交叉，注入通道出现即结构拒收、不起子进程
 *   - Google 域必经代理：detect/launch 均带 proxyEnv；无代理＝auth 失败（实测）
 *   - `--mode auto` 当前账号不可用（warning 后回退 default）→ 永不下发 --mode
 *   - AGENTS.md：append_system_prompt 通道＝全文拼进 -p 任务串（唯一已证通道）；native 未证（CLI
 *     自行发现）、user_level 无 env 面 → 传入即 CONFIG_INVALID 明报（不静默降级）
 *   - headless 缺省超时＝无上限（v1.5.18 内嵌 changelog：5min→unlimited）→ 建议钉
 *     print-timeout-sec：下发 --print-timeout ＋适配器 watchdog（+4s 宽放后软杀→2s→硬杀整组）
 *   - 成功只认 status=SUCCESS＋response 非空＋finished_reason 不在场；finished_reason 在场
 *     （print_timeout/interrupted/error）＝残稿不计完成，CLI 上报的 usage 照记（真账，claude 同口径）
 *   - 失败分类 auth/eligibility/region/quota/network/timeout/other（实测样本归纳，非保证面）：
 *     auth→AUTH、quota→EXTERNAL_RATE_LIMIT（EXECUTOR_ERROR_CODES 冻结词表；词表外无码）
 *   - resume 未接线（session_resume=false）：调度侧按能力声明不派续跑；task.resume 传入即抛（fail-closed）
 *   - cost_native=false：usage 无成本字段 → cost 恒 {usd:0}，价目表折算待批
 *   - 子进程全权（--dangerously-skip-permissions）：任务书 credentials 经 env 注入即对模型工具可见
 *     ——agy 缺省无 env 凭据面，生产不应向 agy 任务注入 credentials
 *   - 伴生状态 sessions 为模块级私有 Map：随 daemon 进程存续，v0 不做回收（台账落盘后可重建）
 *   - stream() 一会话只许消费一次（一单一命、一流一收）；resultStats() 只汇总已消费的事件；
 *     被杀会话不合成终态（aborted，四家同口径）
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execa } from 'execa'
import type { Subprocess } from 'execa'
import { configInvalid } from '@studio-next/contract'
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
import {
  AGY_DEFAULT_CMD,
  AGY_MIN_VERSION,
  assertAgyInjectKeys,
  buildAgyArgv,
  buildAgyEnv,
} from './agy-argv.ts'
import { parseAgyJson, sanitizeAgyText } from './agy-json.ts'

export { AGY_DEFAULT_CMD, AGY_MIN_VERSION }

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
const DETECT_TIMEOUT_MS = 5_000

/** watchdog 宽放：agy 自管 --print-timeout 后留的自杀余量（毫秒） */
const WATCHDOG_SLACK_MS = 4_000
/** watchdog 软杀后硬杀宽限（毫秒）——与 kill() 升级链同构的整组回收节奏 */
const WATCHDOG_GRACE_MS = 2_000

// ---------------------------------------------------------------------------
// Handle 伴生状态（模块内私有）
// ---------------------------------------------------------------------------

interface SessionState {
  readonly subprocess: Subprocess
  readonly startedAt: number
  /** stream() 消费时累积的归一事件（resultStats 的账目来源） */
  readonly events: StreamEvent[]
  /** stdout 全文缓冲（终稿证据留痕；台账落盘归 daemon） */
  stdoutText: string
  /** CLI 上报 num_turns（ResultStats.turns 优先源；未上报 undefined） */
  cliNumTurns?: number
  /** stdout JSON 捕获的 conversation_id（Handle.executorSessionId 对账面） */
  conversationId?: string
  streamConsumed: boolean
  killed: boolean
  /** watchdog 已触发（print 超时软杀）：stream 终态判 timeout 面的标志 */
  timeoutFired: boolean
  /** 子进程 promise 已落定——由 launch 的派生观察器置位（dsh 头注 10.x 项） */
  settled: boolean
  /** promise 落定时留档的退出码（null=被信号杀死；未落定/spawn 失败时 undefined） */
  settledExitCode?: number | null
  /** spawn 层失败（如 ENOENT）——launch/stream 如实抛出 */
  spawnError?: Error
  /** 流收尾时刻（kill 或自然退出后）；未收尾时 undefined */
  endedAt?: number
  /** stream() 收尾时记录的退出码（null=被信号杀死） */
  exitCode?: number | null
}

/** sessionId（UUID 全局唯一）→ 伴生状态；多实例共享不冲突（与四家同口径） */
const sessions = new Map<string, SessionState>()

function requireState(h: Handle): SessionState {
  const state = sessions.get(h.sessionId)
  if (state === undefined) {
    throw new Error(`agy: 未知的 sessionId=${h.sessionId}（伴生状态缺失——launch 未发生或 daemon 已重启）`)
  }
  return state
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

/** 构造选项（model=--model 与 ResultStats.model；printTimeoutSec=--print-timeout + watchdog；proxyEnv=代理钉扎） */
export interface AgyAdapterOptions {
  /** 模型名（实测可用自然语言串如 "Gemini 4 Neon (High)"）；透传 --model，回填 ResultStats.model */
  readonly model?: string
  /**
   * print 超时（正整数秒；单位按秒是未证假设——CLI 侧未实测，见 docs/quality/agy-adapter.md §八）：
   * 下发 --print-timeout + 适配器 watchdog（+4s 宽放后软杀→2s→硬杀整组）
   */
  readonly printTimeoutSec?: number
  /**
   * 代理钉扎位：只收代理四键（HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY，大小写两形），可覆盖
   * 宿主同名代理键；其余键构造即 CONFIG_INVALID（agy/env-key-rejected）；形状坏（非对象/数组/
   * 值非字符串）即 agy/option-invalid；值不打印
   */
  readonly proxyEnv?: Readonly<Record<string, string>>
}

export class AgyAdapter implements ExecutorAdapter {
  readonly name = 'agy'

  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, // 无原生预算帽旗标；预算管控走框架断路（价目表折算后）
    cancel_turn: false, // 无单轮取消原语，只能整进程 kill
    session_resume: false, // --conversation/--continue 存在但续跑链路未实测——按不支持（头注）
    agents_md: 'append_system_prompt', // 唯一已证通道：AGENTS.md 全文拼进 -p 任务串
    cost_native: false, // usage 有 tokens 无成本字段 → cost {usd:0}，价目表折算待批
  }

  private readonly cmd: readonly string[]
  private readonly opts: AgyAdapterOptions

  /**
   * cmd 可注入（测试用假 CLI）；缺省 `agy`（task-140 实测经 PATH 解析到 Homebrew 包装脚本）。
   * 选项形状坏即 CONFIG_INVALID（不静默忽略——配置写了没生效比报错更难查）。
   */
  constructor(cmd: readonly string[] = AGY_DEFAULT_CMD, opts: AgyAdapterOptions = {}) {
    this.cmd = cmd.length > 0 ? cmd : AGY_DEFAULT_CMD
    if (opts.model !== undefined && (opts.model.trim() === '' || /[\r\n]/.test(opts.model))) {
      configInvalid('agy/option-invalid', `agy: model 须为非空单行串（收到 ${JSON.stringify(opts.model)}）`)
    }
    if (opts.printTimeoutSec !== undefined && !(Number.isInteger(opts.printTimeoutSec) && opts.printTimeoutSec > 0)) {
      configInvalid('agy/option-invalid', `agy: printTimeoutSec 须为正整数秒（收到 ${String(opts.printTimeoutSec)}）`)
    }
    if (opts.proxyEnv !== undefined) {
      const proxyEnv: unknown = opts.proxyEnv
      if (typeof proxyEnv !== 'object' || proxyEnv === null || Array.isArray(proxyEnv)) {
        configInvalid('agy/option-invalid', 'agy: proxyEnv 须为 {键: 值} 记录（代理钉扎位）')
      }
      assertAgyInjectKeys('proxyEnv', opts.proxyEnv)
      // 值形状：只报键名与类型，值不打印（代理 URL 可内嵌口令）
      for (const [key, value] of Object.entries(opts.proxyEnv)) {
        if (typeof value !== 'string') {
          configInvalid('agy/option-invalid', `agy: proxyEnv 键 ${JSON.stringify(key)} 的值须为字符串（实得 ${value === null ? 'null' : typeof value}）`)
        }
      }
    }
    this.opts = opts
  }

  /**
   * 版本探测：跑 `[...cmd, '--version']`（超时 5s；env 经 buildAgyEnv 三道闸——探测与派工同一口径）。
   * 三态（docs/18-§一 detect 纪律）：可解析且 ≥ 地板 1.5.18 → ok:true；未安装/解析失败/超时/
   * 低于地板 → ok:false 明报（不静默降级）。`--version` 输出形态未实测（只读其 help：「print
   * version and build info」）——取首个点分数字串，解析不到明报 agy-version-unparsed。
   */
  async detect(): Promise<DetectResult> {
    const binary = this.cmd[0] ?? AGY_DEFAULT_CMD[0] ?? 'agy'
    const env = buildAgyEnv({ base: process.env, ...(this.opts.proxyEnv !== undefined ? { proxyEnv: this.opts.proxyEnv } : {}) })
    const result = await execa(binary, [...this.cmd.slice(1), '--version'], {
      timeout: DETECT_TIMEOUT_MS,
      reject: false,
      env,
      extendEnv: false,
    })
    if (result.timedOut) {
      return { name: this.name, version: '', ok: false, gaps: ['agy-detect-timeout'] }
    }
    if (result.failed) {
      const gap = isENOENT(result.cause) ? 'agy-not-installed' : `agy-detect-failed:${errMsg(result.cause)}`
      return { name: this.name, version: '', ok: false, gaps: [gap] }
    }
    const match = /v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/.exec(result.stdout.trim())
    if (match === null) {
      return { name: this.name, version: '', ok: false, gaps: ['agy-version-unparsed'] }
    }
    const version = match[1] ?? ''
    if (!versionAtLeast(version, AGY_MIN_VERSION)) {
      return { name: this.name, version, ok: false, gaps: [`agy-version-unsupported:${version} < ${AGY_MIN_VERSION}`] }
    }
    return { name: this.name, version, ok: true, gaps: [] }
  }

  /**
   * 预算预留估算（与四家同一 v0 拟稿模型）：字符量÷3 ≈ tokens × $10/M；地板 $0.05、天花板 $8；
   * confidence=0.2。agy 无原生成本（cost_native=false），真账以 resultStats 实测 tokens ×
   * 价目表为准（折算待批）。任务书不可读按 0 字符计（地板价兜底，不粉饰）。
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
   * 拉起 agy（execa）：argv 见 buildAgyArgv（-p 任务串 + --output-format json +
   * --dangerously-skip-permissions + --model/--add-dir/--print-timeout 可选）。
   * cwd=task.workspace；env 只经 buildAgyEnv 合成（宿主允许集＋proxyEnv/credentials 封闭枚举
   * ＋高危键拒收——结构拒收发生在 spawn 之前）；
   * reject:false（退出码只记录）；killDescendants（kill 信号直达整组）。
   * resume 不支持（session_resume=false）：task.resume 传入即抛（fail-closed）。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    if (task.resume !== undefined) {
      throw new Error(
        'agy: 续跑未接线（session_resume=false，task-140 首刀）——agy 有 --conversation/--continue 但链路未实测；请走新会话派发（调度侧按能力声明不派续跑），续跑面留探钢单',
      )
    }
    const [binary = AGY_DEFAULT_CMD[0] ?? 'agy', ...base] = this.cmd
    const taskText = await readTaskText(task.briefPath)
    const agentsMdText = await agentsMdAppendText(task)
    const argv = buildAgyArgv({
      base,
      taskText,
      ...(agentsMdText !== undefined ? { agentsMdText } : {}),
      ...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
      addDir: task.workspace,
      ...(this.opts.printTimeoutSec !== undefined ? { printTimeoutSec: this.opts.printTimeoutSec } : {}),
    })
    const env = buildAgyEnv({
      base: process.env,
      ...(this.opts.proxyEnv !== undefined ? { proxyEnv: this.opts.proxyEnv } : {}),
      ...(task.credentials !== undefined ? { credentials: task.credentials } : {}),
    })
    const subprocess = execa(binary, argv, {
      cwd: task.workspace,
      env,
      extendEnv: false, // 白名单生效前提（execa 缺省并入 process.env——同 dsh 注记）
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false,
      killDescendants: true,
      forceKillAfterDelay: false, // 升级链自持（kill() 的 graceMs 是契约参数；同 dsh 取舍）
      // 类型注：execa 10 选项实例化与泛型 Subprocess 在 exactOptionalPropertyTypes 下
      // 失协变（upstream 类型层缺口，运行时同物）——as Subprocess 单点收敛断言，五家同注
    }) as Subprocess
    const sessionId = randomUUID()
    const state: SessionState = {
      subprocess,
      startedAt: Date.now(),
      events: [],
      stdoutText: '',
      streamConsumed: false,
      killed: false,
      timeoutFired: false,
      settled: false,
    }
    sessions.set(sessionId, state)
    // 派生观察器（dsh 头注 10.x 项）：退出→settled+退出码留档；spawn 失败→spawnError+settled
    subprocess.then(
      (result) => {
        state.settledExitCode = result.exitCode ?? null
        // reject:false 下 spawn 层失败（如 ENOENT）也走 resolve，原因挂在 cause（实测 execa 10.x）
        if (result.failed && result.exitCode === undefined && result.cause !== undefined) {
          state.spawnError = asError(result.cause)
        }
        state.settled = true
      },
      (e: unknown) => {
        state.spawnError = asError(e)
        state.settled = true
      },
    )
    if (subprocess.pid === undefined) {
      sessions.delete(sessionId)
      await state.subprocess.then(
        () => undefined,
        () => undefined,
      ) // 等 spawn 失败落定：原因留档后随错抛出
      throw state.spawnError ?? new Error(`agy: launch 失败——未取得 pid（cmd=${binary}）`)
    }
    armWatchdog(state, this.opts.printTimeoutSec)
    return { executor: this.name, sessionId, pid: subprocess.pid }
  }

  /**
   * 单对象终稿消费：全量缓冲 stdout 至 EOF → await 子进程落定 → 解析单 JSON → 归一事件
   * 一次性 yield（头注已知坑：无 step 级事件）。终态决策树（优先序）：killed=aborted（无终态，
   * 四家同口径）→ timeoutFired=timeout 面 → stdout JSON（success/error/bad-shape/bad-json；
   * 失败面并采 stderr 的 AGY_ERROR 行）。conversation_id 捕获进 Handle.executorSessionId。
   */
  async *stream(h: Handle): AsyncGenerator<StreamEvent, void, unknown> {
    const state = requireState(h)
    if (state.streamConsumed) {
      throw new Error(`agy: stream() 已消费（sessionId=${h.sessionId}）——一单一命、一流一收`)
    }
    state.streamConsumed = true
    const stdout = state.subprocess.stdout
    if (stdout === null) {
      // spawn 即失败：无 stdout 通道——如实抛出（detect 前置漏网时在此明报）
      throw state.spawnError ?? new Error('agy: 子进程 stdout 不可用（launch 失败）')
    }
    let text = ''
    let readError: string | undefined
    try {
      for await (const chunk of stdout as AsyncIterable<unknown>) {
        text += typeof chunk === 'string' ? chunk : String(chunk)
      }
    } catch (e) {
      readError = `stdout 读取中断：${errMsg(e)}` // 不吞：记入终态文本（坏稿面如实呈报）
    } finally {
      state.endedAt = Date.now()
    }
    state.stdoutText = text
    const result = await state.subprocess // reject:false：退出码/信号不抛错
    state.exitCode = result.exitCode ?? null // 被信号杀死时 undefined → null
    state.endedAt = Date.now()
    const stderrText = typeof result.stderr === 'string' ? result.stderr : ''
    for (const event of terminalEvents(state, h, text, stderrText, readError)) {
      state.events.push(event)
      yield event
    }
  }

  /**
   * 账目汇总（只统计伴生状态里已消费的事件）：
   *   tokens：CLI 上报的 usage 三桶（input/output/cache_read；thinking 无桶不折算）——成功面与
   *           上报了用量的失败面都记真账；未上报（被杀/超时/watchdog）零值（不编造）
   *   turns：CLI num_turns 优先（未上报回退 turn_end 计数）
   *   duration：launch→流收尾（未收尾取 now）；cost：恒 {usd:0}——待价目表折算
   */
  async resultStats(h: Handle): Promise<ResultStats> {
    const state = requireState(h)
    return {
      cost: { usd: 0 },
      tokens: lastTurnEndUsage(state.events) ?? { input: 0, output: 0 },
      duration: (state.endedAt ?? Date.now()) - state.startedAt,
      turns: state.cliNumTurns ?? state.events.filter((e) => e.type === 'turn_end').length,
      ...(this.opts.model !== undefined && this.opts.model !== '' ? { model: this.opts.model } : {}),
    }
  }

  /**
   * 优雅终止（整树）：SIGTERM 软杀整树 → 宽限 graceMs → SIGKILL 硬杀整树（四家同构升级链，
   * killDescendants 细节见 dsh 头注）。已退出的进程不重复杀；幂等。被杀会话不合成终态
   * （aborted 口径，头注）——tokens 零值不编造。
   */
  async kill(h: Handle, graceMs: number): Promise<void> {
    const state = requireState(h)
    if (state.killed) return
    if (state.settled) {
      return // 已退出（含 spawn 失败）：无可杀——不标 killed，终态事件如实保留
    }
    state.killed = true
    terminateTree(state, graceMs)
    // 10.x 无 exit 事件可听（Subprocess 非 EventEmitter）：等 promise 落定（与 dsh 同构）
    await state.subprocess.then(
      () => undefined,
      () => undefined,
    )
  }

  /** 收割判定（17-§6 冻结口径的 agy 形）：turn_end.completed=true 且存在非空 log 文本 */
  isCompleted(h: Handle): boolean {
    const events = requireState(h).events
    const completedTurn = events.some((e) => e.type === 'turn_end' && e.completed)
    const hasOutput = events.some((e) => e.type === 'log' && e.text !== '')
    return completedTurn && hasOutput
  }

  /** 退出码记录（证据价值，不参与成功判定）；null=被信号杀死；undefined=未落定 */
  exitCode(h: Handle): number | null | undefined {
    const state = requireState(h)
    return state.exitCode ?? state.settledExitCode
  }
}

// ---------------------------------------------------------------------------
// 内部工具（终态合成 + 纯辅助）
// ---------------------------------------------------------------------------

/** 整组回收升级链（kill() 与 watchdog 共用）：TERM → graceMs → KILL；定时器 unref 不阻退出 */
function terminateTree(state: SessionState, graceMs: number): void {
  const proc = state.subprocess
  proc.kill('SIGTERM') // 整组软杀（killDescendants：信号直达进程组，孙进程同波及）
  const escalate = setTimeout(() => {
    // 宽限到点整组硬杀：父吞 TERM 不退一概收口；组已尽时为无害 no-op（execa 组杀回落）
    proc.kill('SIGKILL')
  }, Math.max(0, graceMs))
  escalate.unref()
}

/** print 超时 watchdog：agy 自管 --print-timeout（+4s 宽放）后仍存活 → 软杀→2s→硬杀整组 */
function armWatchdog(state: SessionState, printTimeoutSec: number | undefined): void {
  if (printTimeoutSec === undefined || printTimeoutSec <= 0) return
  const watchdog = setTimeout(() => {
    if (state.settled) return // agy 已按 --print-timeout 自退（残稿面）：不干预
    state.timeoutFired = true
    terminateTree(state, WATCHDOG_GRACE_MS)
  }, printTimeoutSec * 1_000 + WATCHDOG_SLACK_MS)
  watchdog.unref() // 扫尾兜底不阻止进程退出（与 kill() 定时器同取舍）
}

/**
 * 终态事件合成（决策树见 stream() 注）：killed=aborted 无终态；timeoutFired=timeout 面；
 * success（log=response＋turn_end.completed）；error（分类 detail＋errorCode＋已上报 usage）；
 * bad-shape/bad-json（非零退出＝退出码面，带脱敏 stderr 片段）。
 */
function terminalEvents(
  state: SessionState,
  h: Handle,
  stdoutText: string,
  stderrText: string,
  readError: string | undefined,
): StreamEvent[] {
  if (state.killed) return [] // aborted：不合成终态（四家 killed 同口径）
  if (state.timeoutFired) {
    const detail = 'agy: print 超时（watchdog 已整组回收）——任务未收终稿；检查 --print-timeout 配置与网络/代理'
    return [
      { type: 'log', text: detail },
      { type: 'turn_end', completed: false, error: detail },
    ]
  }
  const outcome = parseAgyJson(stdoutText, stderrText)
  if (outcome.kind === 'success' || outcome.kind === 'error') {
    captureResultMeta(state, h, outcome)
  }
  if (outcome.kind === 'success') {
    return [
      { type: 'log', text: outcome.response },
      { type: 'turn_end', completed: true, ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}) },
    ]
  }
  if (outcome.kind === 'error') {
    const cls = outcome.errorClass
    return [
      { type: 'log', text: `agy ERROR(${cls.kind}): ${cls.detail}` },
      {
        type: 'turn_end',
        completed: false,
        error: cls.detail,
        ...(cls.code !== undefined ? { errorCode: cls.code } : {}),
        ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
      },
    ]
  }
  // bad-shape / bad-json：非零退出走退出码面（证据更直接）；退出码 0/信号＝终稿不可解析面
  const exitCode = state.exitCode ?? state.settledExitCode
  const stderrSnip = sanitizeAgyText(stderrText)
  const tail = `${readError !== undefined ? `${readError}；` : ''}${outcome.reason}${
    stderrSnip !== '' ? `；stderr: ${stderrSnip}` : ''
  }`
  const detail =
    exitCode !== null && exitCode !== undefined && exitCode !== 0
      ? `agy: 进程退出码 ${String(exitCode)}（${tail}）`
      : `agy: stdout 终稿不可解析（${tail}）`
  return [
    { type: 'log', text: detail },
    { type: 'turn_end', completed: false, error: detail },
  ]
}

/** 终稿公共位入账：conversation_id → 伴生状态 + Handle.executorSessionId；num_turns → turns 优先源 */
function captureResultMeta(state: SessionState, h: Handle, outcome: { conversationId?: string; numTurns?: number }): void {
  if (outcome.conversationId !== undefined) {
    state.conversationId = outcome.conversationId
    ;(h as { executorSessionId?: string }).executorSessionId = outcome.conversationId
  }
  if (outcome.numTurns !== undefined) state.cliNumTurns = outcome.numTurns
}

/** 最后一个带 usage 的 turn_end（agy 终稿单 turn——即 CLI 上报 usage 直录） */
function lastTurnEndUsage(events: readonly StreamEvent[]): TokenCounts | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e !== undefined && e.type === 'turn_end' && e.usage !== undefined) return e.usage
  }
  return undefined
}

/**
 * AGENTS.md 通道：append_system_prompt=读 target 全文返回（拼进 -p，唯一已证通道）；native=
 * 不注入（CLI 自行发现，未证）；user_level=CONFIG_INVALID（无已证 env 面——不静默降级）。
 */
async function agentsMdAppendText(task: TaskBrief): Promise<string | undefined> {
  const channel = task.AGENTS_MD.channel
  if (channel === 'native') return undefined
  if (channel === 'user_level') {
    configInvalid(
      'agy/agents-md-channel-unsupported',
      'agy: user_level 通道无已证 env 面（Antigravity 未见用户级配置目录 env）——已支持 append_system_prompt（AGENTS.md 全文拼进 -p）；改 daemon.yaml 的 agents_md 通道或立探钢单',
    )
  }
  try {
    return await readFile(task.AGENTS_MD.target, 'utf8')
  } catch (e) {
    throw new Error(`agy: AGENTS_MD.target 不可读（${task.AGENTS_MD.target}）：${errMsg(e)}——装配缺件，launch 前置失败如实上报`)
  }
}

/** 任务串读取：briefPath 全文（字节如实，不裁不拼） */
async function readTaskText(briefPath: string): Promise<string> {
  try {
    return await readFile(briefPath, 'utf8')
  } catch (e) {
    throw new Error(`agy: 任务书不可读（briefPath=${briefPath}）：${errMsg(e)}`)
  }
}

/** 语义化地板比较（只比前三数字段；1.5.18-beta1 与 1.5.18 同视为达标） */
function versionAtLeast(version: string, floor: string): boolean {
  const parse = (v: string): number[] =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((p) => {
        const n = Number.parseInt(p, 10)
        return Number.isNaN(n) ? 0 : n
      })
  const a = parse(version)
  const b = parse(floor)
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

/** ENOENT 判定（未安装）：execa reject:false 下 spawn 失败挂在 result.cause（四家同形） */
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
