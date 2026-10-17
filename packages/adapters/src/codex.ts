/**
 * codex 适配器 —— 首刀：对 fake CLI harness 全绿；真 CLI 行为留探针单
 *
 * 依据：
 *   - docs/17-§6 codex 行：launch=`codex exec --json`；流=NDJSON，
 *     turn.completed.usage 给 tokens；成本无原生字段→价目表折算（cost_native=false）；
 *     kill 同上（killpg TERM→KILL——同因 execa 无进程组杀原语，见 dsh 头注，走同构升级链）
 *   - docs/18-§一：ExecutorAdapter 六原语；detect 不达标明报，绝不静默降级
 *   - docs/25-§3.1 ExecutorAdapter 端口；协议 v1.1 turn_end.error 字段
 *     （turn.failed→error 映射已在 streams.ts 落地，codex 首刀携带）
 *   - docs/25-§二（v1.4）：TaskBrief.credentials 短命按单凭据——launch env 无条件透传进
 *     子进程；其值不记录不打印（红名单），流/日志/账面文本永不含凭据
 *
 * 拟稿（首刀自拟口径，待真 codex 探针单核实——只记录，不擅自定案）：
 *   - 续跑旗标 `codex exec --resume <sessionId>`：取旗标形态（镜像 claude --resume 语义）；
 *     真 CLI 亦可能是 `codex exec resume <id>` 子命令形态——两形孰真待探针，本拟稿取旗标形，
 *     探针结论到来后走批示改此处
 *   - AGENTS.md 通道 env 映射最小集（agentsMdEnv）：codex 原生读 workspace 根 AGENTS.md
 *     （拟稿），native 不注入；user_level 注入 CODEX_HOME=<target>（CODEX_HOME 为 codex 真实
 *     存在的 env 变量，但 target 落点的目录/文件语义与 L5 装配的对接待探针——适配器只透传）；
 *     append_system_prompt 注入 CODEX_APPEND_INSTRUCTIONS_FILE=<target>（变量名自拟，
 *     codex 未见官方 append 通道文档——镜像 dsh 同通道做法）
 *   - capabilities.agents_md='native'：按「codex 原生读 workspace AGENTS.md」假设声明（拟稿）
 *   - estimate()：与 dsh/claude 相同的预算估算模型 v0（任务书字符量粗估 + 低 confidence）
 *
 * 已知坑与取舍（沉淀于此，docs/18-§1.2）：
 *   - turn.failed 无 usage（17-§6 已知坑）：失败面 tokens 零值、无 turn_end.completed=true
 *     ——测试冻结；错误信息除 log 透传外，streams 已按 v1.1 裁决挂 turn_end.error
 *   - tokens 只取 turn_end.usage（turn.completed 总账，17-§6 codex 行）：codex 的
 *     item.completed 不带 usage；若探针发现 step 级也有 usage，账目口径走批示换算
 *     ——不混入 dsh 的 step 求和逻辑（避免双重计数）
 *   - cost_native=false：resultStats().cost 恒 {usd:0}——「待价目表折算」（与 dsh 同口径；
 *     ResultStats 无备注字段，不改 contract，以本头注 + 汇报记录）
 *   - budget_cap=false 照实声明：codex 无原生预算帽旗标；task.budgetCap 即使传入也无处落地
 *     （与 dsh 同做法——能力声明即契约，预算管控走框架断路，调度侧不应传帽）
 *   - codex 原生 session id（如 thread id）在 fixture 流中无来源：暂不做 nativeSessionId 式
 *     回填，续跑输入全靠 TaskBrief.resume.sessionId（装配管线透传）——探针单核实
 *   - kill 与 dsh/claude 同构升级链 SIGTERM→graceMs→SIGKILL 直杀子进程（17-§6 kill 列
 *     killpg 的同因取舍，见 dsh 头注）；codex 无 dsh「吞 SIGTERM 退出 0」坑
 *   - spawn 统一 reject:false——退出码只记录不参与判定（成功判定只认流内终态）
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

/** 缺省命令（docs/17-§6 codex 行）：launch 时追加 `exec --json` 与动态旗标（续跑拟稿） */
export const CODEX_DEFAULT_CMD: readonly string[] = ['codex']

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
      `codex: 未知的 sessionId=${h.sessionId}（伴生状态缺失——launch 未发生或 daemon 已重启）`,
    )
  }
  return state
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

export class CodexAdapter implements ExecutorAdapter {
  readonly name = 'codex'

  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, // 17-§6 codex 行无预算帽旗标；预算管控走框架断路（价目表折算后）
    cancel_turn: false, // 无单轮取消原语，只能整进程 kill
    session_resume: true, // `codex exec --resume <id>`（拟稿——旗标/子命令两形待探针，见头注）
    agents_md: 'native', // 拟稿：假设原生读 workspace AGENTS.md（待探针；通道 env 见 agentsMdEnv）
    cost_native: false, // 17-§6：tokens 有，成本无原生字段→价目表折算
  }

  private readonly cmd: readonly string[]

  /** cmd 可注入（测试用假 CLI）；缺省 `codex`（17-§6，launch 时追加 exec --json） */
  constructor(cmd: readonly string[] = CODEX_DEFAULT_CMD) {
    this.cmd = cmd.length > 0 ? cmd : CODEX_DEFAULT_CMD
  }

  /**
   * 版本探测：跑 `[...cmd, '--version']`（超时 5s）解析版本号。
   * 三态（docs/18-§一 detect 纪律）：可解析 → ok:true（codex 无版本门槛坑，gaps 空为常态）；
   * 未安装 / 解析失败 / 超时 → ok:false 明报（不静默降级）。
   * 注：跑完整 cmd 前缀使注入的假 CLI 能按 FAKE_VERSION 旋钮回放版本输出（与 claude 同取舍）。
   */
  async detect(): Promise<DetectResult> {
    const binary = this.cmd[0] ?? CODEX_DEFAULT_CMD[0] ?? 'codex'
    const result = await execa(binary, [...this.cmd.slice(1), '--version'], {
      timeout: DETECT_TIMEOUT_MS,
      reject: false, // 探测失败走 gaps 明报，不靠异常表达
      env: { ...process.env },
    })
    if (result.timedOut) {
      return { name: this.name, version: '', ok: false, gaps: ['codex-detect-timeout'] }
    }
    if (result.failed) {
      // spawn 层失败（ENOENT=未安装；其他如实带原因明报）
      const gap = isENOENT(result.cause)
        ? 'codex-not-installed'
        : `codex-detect-failed:${errMsg(result.cause)}`
      return { name: this.name, version: '', ok: false, gaps: [gap] }
    }
    // `codex --version` 实际输出形如 `codex-cli 0.42.0`：取首个语义化版本串
    const match = /v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/.exec(result.stdout.trim())
    if (match === null) {
      return { name: this.name, version: '', ok: false, gaps: ['codex-version-unparsed'] }
    }
    // codex 无版本门槛坑（对照 claude 2.1.277）：可解析即达标，gaps 空为常态
    return { name: this.name, version: match[1] ?? '', ok: true, gaps: [] }
  }

  /**
   * 预算预留估算。拟稿（与 dsh/claude 同一 v0 模型，v0.6 前细化；docs/16 里程碑 v0.6=预算/断路完善）：
   * 字符量÷3 ≈ tokens × $10/M；地板 $0.05、天花板 $8；confidence=0.2——启发式仅够预留参考。
   * codex 无原生成本（cost_native=false），真账以 resultStats 实测 tokens × 价目表为准（折算待批）。
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
   * 拉起 codex（execa）：`codex exec --json` + 续跑 `--resume <sessionId>`（拟稿旗标形）
   * + AGENTS_MD 通道 env（agentsMdEnv 拟稿：native=不注入）+ TaskBrief.credentials
   * （v1.4 短命按单凭据——无条件透传进子进程 env，值不打印不记录）。
   * cwd=task.workspace；budgetCap 无处落地（budget_cap=false，与 dsh 同做法——能力声明即契约）。
   * reject:false——退出码不构成异常（成功判定只认流内终态）。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    const [binary = CODEX_DEFAULT_CMD[0] ?? 'codex', ...base] = this.cmd
    const args = [...base, 'exec', '--json']
    if (task.resume !== undefined) {
      args.push('--resume', task.resume.sessionId)
    }
    const subprocess = execa(binary, args, {
      cwd: task.workspace,
      env: { ...process.env, ...agentsMdEnv(task.AGENTS_MD), ...(task.credentials ?? {}) },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      reject: false,
      forceKillAfterDelay: false, // execa kill() 无 per-call 宽限：关闭默认 5s 兜底，kill() 自持升级链
    })
    const sessionId = randomUUID()
    const state: SessionState = {
      subprocess,
      startedAt: Date.now(),
      events: [],
      rawLines: [],
      streamConsumed: false,
      killed: false,
    }
    sessions.set(sessionId, state)
    // spawn 层失败（ENOENT 等）在 reject:false 下仍会 reject：记入伴生状态，stream() 如实抛出；
    // 此处 catch 同时防止无人消费时的未处理拒绝
    subprocess.catch((e: unknown) => {
      state.spawnError = asError(e)
    })
    const pid = subprocess.pid
    if (pid === undefined) {
      sessions.delete(sessionId)
      throw state.spawnError ?? new Error(`codex: launch 失败——未取得 pid（cmd=${binary}）`)
    }
    return { executor: this.name, sessionId, pid }
  }

  /**
   * 逐行流消费：stdout chunk → 行切割（含尾部无换行残行）→ parseLine(line,'codex') 归一
   * → yield；事件与原文同时记入伴生状态。一会话只许消费一次。
   * 迭代自然结束（stdout EOF）后 await 子进程拿退出码（reject:false 不抛）。
   */
  async *stream(h: Handle): AsyncGenerator<StreamEvent, void, unknown> {
    const state = requireState(h)
    if (state.streamConsumed) {
      throw new Error(`codex: stream() 已消费（sessionId=${h.sessionId}）——一单一命、一流一收`)
    }
    state.streamConsumed = true
    const stdout = state.subprocess.stdout
    if (stdout === null) {
      // spawn 即失败：无 stdout 通道——如实抛出（detect 前置漏网时在此明报）
      throw state.spawnError ?? new Error('codex: 子进程 stdout 不可用（launch 失败）')
    }
    const consume = (line: string): StreamEvent[] => {
      state.rawLines.push(line)
      const events = parseLine(line, 'codex')
      state.events.push(...events)
      return events
    }
    try {
      let pending = ''
      // execa stdout 迭代产出 Buffer 块（实测 9.6.1）——统一按 utf8 解码
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
   *   tokens：turn_end.usage（turn.completed 总账——codex 行唯一 usage 来源）；失败面
   *           turn.failed 无 usage → 零值兜底（17-§6 已知坑，测试冻结）
   *   turns：step_end 计数（item.completed 归一而来）；duration：launch→流收尾（未收尾取 now）
   *   cost：恒 {usd:0}——cost_native=false，「待价目表折算」（文件头注，不改 contract）
   */
  async resultStats(h: Handle): Promise<ResultStats> {
    const state = requireState(h)
    return {
      cost: { usd: 0 },
      tokens: lastTurnEndUsage(state.events) ?? { input: 0, output: 0 },
      duration: (state.endedAt ?? Date.now()) - state.startedAt,
      turns: state.events.filter((e) => e.type === 'step_end').length,
    }
  }

  /**
   * 优雅终止：SIGTERM → 宽限 graceMs → SIGKILL（与 dsh/claude 同构升级链）。
   * 已退出的进程不重复杀；幂等（重复 kill 直接返回）。
   * 注：17-§6 kill 列写 killpg 同上——execa 9.6.1 无进程组杀原语，直杀子进程（dsh 头注同因）；
   * codex 无吞 SIGTERM 坑，kill 后 turn.completed 未到即无终态（isCompleted=false）。
   */
  async kill(h: Handle, graceMs: number): Promise<void> {
    const state = requireState(h)
    if (state.killed) return
    state.killed = true
    const proc = state.subprocess
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return // 已自然退出：无可杀
    }
    const exited = new Promise<void>((resolve) => {
      proc.once('exit', () => resolve())
      proc.once('error', () => resolve())
    })
    proc.kill('SIGTERM')
    const escalate = setTimeout(() => {
      proc.kill('SIGKILL') // 宽限内未退：强杀（SIGKILL 不可被吞）
    }, Math.max(0, graceMs))
    try {
      await exited
    } finally {
      clearTimeout(escalate)
    }
  }

  /**
   * 收割判定（17-§6 冻结口径）：turn_end.completed=true 且存在非空 log 文本。
   * 退出码不参与判定；turn.failed 归一出 completed=false（另带 error 字段，v1.1）——判失败。
   */
  isCompleted(h: Handle): boolean {
    const events = requireState(h).events
    const completedTurn = events.some((e) => e.type === 'turn_end' && e.completed)
    const hasOutput = events.some((e) => e.type === 'log' && e.text !== '')
    return completedTurn && hasOutput
  }

  /** 退出码记录（证据价值，不参与成功判定）；null=被信号杀死 */
  exitCode(h: Handle): number | null | undefined {
    const state = requireState(h)
    return state.exitCode ?? state.subprocess.exitCode
  }
}

// ---------------------------------------------------------------------------
// 内部工具（纯函数）
// ---------------------------------------------------------------------------

/**
 * AGENTS.md 通道 env 映射最小集（拟稿——待真 codex 探针单核实，见文件头注）：
 *   native               → 不注入（codex 原生读 workspace 根 AGENTS.md——拟稿假设）
 *   user_level           → CODEX_HOME=<target>（codex 真实 env 变量；目录/文件语义与 L5
 *                          装配的对接待探针，适配器只透传——镜像 claude CLAUDE_CONFIG_DIR 做法）
 *   append_system_prompt → CODEX_APPEND_INSTRUCTIONS_FILE=<target>（变量名自拟，codex 未见
 *                          官方 append 通道文档——镜像 dsh 同通道做法）
 * target 落点由 L5 装配决定、适配器只透传（docs/25-§二 TaskBrief 注释）。
 */
function agentsMdEnv(a: TaskBrief['AGENTS_MD']): Record<string, string> {
  switch (a.channel) {
    case 'native':
      return {}
    case 'user_level':
      return { CODEX_HOME: a.target }
    case 'append_system_prompt':
      return { CODEX_APPEND_INSTRUCTIONS_FILE: a.target }
  }
}

/** 最后一个带 usage 的 turn_end（codex 的 usage 只在 turn.completed——即终态总账） */
function lastTurnEndUsage(events: readonly StreamEvent[]): TokenCounts | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e !== undefined && e.type === 'turn_end' && e.usage !== undefined) return e.usage
  }
  return undefined
}

/** ENOENT 判定（未安装）：execa reject:false 下 spawn 失败挂在 result.cause（实测 9.6.1） */
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
