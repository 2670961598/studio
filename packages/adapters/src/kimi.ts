/**
 * kimi 适配器 —— 首刀：对 fake CLI harness 全绿；真 CLI 行为留探针单
 *
 * 依据：
 *   - docs/17-§6 kimi 行：launch=`kimi -p --output-format stream-json`；流=stdout JSONL
 *     与 claude 同构但**无 usage——usage 读 session wire.jsonl**（已知坑）；
 *     tokens 有，成本折算（cost_native=false）；kill 同上；**`-p` 与 yolo/auto/plan 互斥**
 *   - docs/25-§3.1：session_resume 即「--resume/--session-id/-S 家族」；CLI 泳道首刀
 *     反馈裁决#4——wire 的 usage「逐轮求和=turn 总账」是**假设**，v0.6 探针前必须对
 *     真实 wire 证实（本适配器照此假设落地，探针结论到来前不改口径）
 *   - docs/02-§F1-13 / V4-V7 附A-2：kimi usage 不落 stdout 而在 session wire.jsonl
 *   - 复查报告-2026-10-16 通过项：dsh/kimi/codex 三家确实读 AGENTS.md（二进制/文档实锤）
 *     ——capabilities.agents_md='native' 有据；docs/04-§97（B5 修订）：用户级通道
 *     $KIMI_CODE_HOME 有文档实锤
 *   - docs/18-§一：ExecutorAdapter 六原语；detect 不达标明报，绝不静默降级
 *
 * 拟稿（首刀自拟口径，待真 kimi 探针单核实——只记录，不擅自定案）：
 *   - **wire 路径约定未知**：真 kimi 把 session wire.jsonl 落哪里无文档口径。构造器可注入
 *     wirePathResolver(sessionId, workspace)，缺省拟稿
 *     `<workspace>/.kimi/sessions/<sessionId>/wire.jsonl`（sessionId=框架 Handle UUID，
 *     launch 时即知）；探针结论到来后走批示改缺省或由 daemon 注入真实约定
 *   - 续跑旗标 `-S <sessionId>`：取旗标形（docs/25-§3.1 的「-S 家族」记法）；真 CLI 的
 *     参数拼写/取值形态待探针，届时走批示改此处
 *   - append_system_prompt 通道 env `KIMI_APPEND_SYSTEM_PROMPT_FILE=<target>`：变量名
 *     自拟（kimi 未见官方 append 通道文档——镜像 dsh 同通道做法）；user_level 通道
 *     `KIMI_CODE_HOME=<target>` 有文档实锤（docs/04 B5 修订），非拟稿
 *   - estimate()：与 dsh/claude/codex 相同的预算估算模型 v0（任务书字符量粗估 + 低 confidence）
 *
 * 已知坑与取舍（沉淀于此，docs/18-§1.2）：
 *   - usage 合流时序：wire.jsonl 在**会话结束后**读取（stdout EOF + 子进程退出之后）——
 *     fake CLI 在退出前落 wire（FAKE_WIRE_DIR 旋钮），无竞态；真 kimi 是否在退出前
 *     写完 wire 待探针
 *   - 合流行为对齐 streams.parseKimi 冻结口径（不静默降级）：wire 缺失/不可读 → 追加
 *     log 明示；wire 无 usage 记录 → 追加 log 明示；求和结果挂到**最后一个** turn_end
 *     （已有 usage 也覆盖——镜像 parseKimi 同款行为）；stdout 无 turn_end 可挂 → 追加
 *     log 明示且不折算（tokens 零值，不编造）
 *   - 流式固有不对称：turn_end 在 wire 读取前已 yield 给消费方，合流挂载的 usage 只反映在
 *     伴生状态（resultStats 的账目来源）——消费方手里那份 turn_end 无 usage 是预期面，
 *     不回补、不重发
 *   - **`-p` 与 yolo/auto/plan 互斥**（17-§6）：真 CLI 行为，fake 上无法测互斥——框架
 *     永不向 kimi 下发 yolo/auto/plan 类模式旗标（适配器只构造 `-p` 基座），探针单待办
 *   - cost_native=false：resultStats().cost 恒 {usd:0}——「待价目表折算」（与 dsh/codex
 *     同口径；ResultStats 无备注字段，不改 contract，以本头注 + 汇报记录）
 *   - budget_cap=false 照实声明：kimi 无原生预算帽旗标（附A-2：三家除 claude 外均无
 *     预算参数）；task.budgetCap 传入也无处落地——能力声明即契约，预算管控走框架断路
 *   - kimi stdout 无 step 级事件（claude 同构只有 system/assistant/result）：turns 取
 *     turn_end 计数（0 或 1），与 claude 回退口径同构
 *   - kill 与 dsh/claude/codex 同构升级链 SIGTERM→graceMs→SIGKILL 直杀子进程（17-§6
 *     kill 列 killpg 的同因取舍，见 dsh 头注）；被杀会话 wire 多半缺失——明示 log +
 *     tokens 零值（不编造）
 *   - spawn 统一 reject:false——退出码只记录不参与判定（成功判定只认流内终态）
 *   - 伴生状态 sessions 为模块级私有 Map：随 daemon 进程存续，v0 不做回收（台账落盘后可重建）
 *   - stream() 一会话只许消费一次（一单一命、一流一收）；resultStats() 只汇总已消费的事件
 */
import { randomUUID } from 'node:crypto'
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
import { parseLine, sumWireUsage } from './streams.ts'

/** 缺省命令（docs/17-§6 kimi 行）：launch 时追加 `-p --output-format stream-json` 与动态旗标 */
export const KIMI_DEFAULT_CMD: readonly string[] = ['kimi']

/**
 * wire.jsonl 路径解析器：sessionId（框架 Handle UUID）+ workspace → 绝对路径。
 * 真 kimi 的 session 目录约定未知（拟稿待探针，见文件头注）——注入位即探针结论落点。
 */
export type WirePathResolver = (sessionId: string, workspace: string) => string

/** detect() 版本探测超时（毫秒）：挂死的 CLI 不许挡调度 */
const DETECT_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// Handle 伴生状态（模块内私有）
// ---------------------------------------------------------------------------

interface SessionState {
  readonly subprocess: Subprocess
  readonly startedAt: number
  /** stream() 消费时累积的归一事件（resultStats 的账目来源；wire 合流在流尾就地挂载） */
  readonly events: StreamEvent[]
  /** 逐行 stdout 原文缓冲（证据留痕，未解析；台账落盘归 daemon） */
  readonly rawLines: string[]
  /** 会话结束后要读的 wire.jsonl 路径（launch 时解析，拟稿约定见文件头注） */
  readonly wirePath: string
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
      `kimi: 未知的 sessionId=${h.sessionId}（伴生状态缺失——launch 未发生或 daemon 已重启）`,
    )
  }
  return state
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

export class KimiAdapter implements ExecutorAdapter {
  readonly name = 'kimi'

  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, // 17-§6/附A-2：无原生预算帽旗标；预算管控走框架断路（价目表折算后）
    cancel_turn: false, // 无单轮取消原语，只能整进程 kill
    session_resume: true, // `-S <sessionId>`（拟稿旗标形，docs/25-§3.1「-S 家族」；待探针）
    agents_md: 'native', // 复查报告实锤：kimi 读 AGENTS.md（假设面收窄为通道细节，见 agentsMdEnv）
    cost_native: false, // 17-§6：tokens 有（wire 合流），成本无原生字段→价目表折算
  }

  private readonly cmd: readonly string[]
  private readonly wirePathResolver: WirePathResolver

  /**
   * cmd 可注入（测试用假 CLI）；缺省 `kimi`（17-§6，launch 时追加流式旗标）。
   * wirePathResolver 可注入（真 kimi 的 session 目录约定未知——拟稿缺省待探针，头注）。
   */
  constructor(
    cmd: readonly string[] = KIMI_DEFAULT_CMD,
    wirePathResolver: WirePathResolver = defaultWirePath,
  ) {
    this.cmd = cmd.length > 0 ? cmd : KIMI_DEFAULT_CMD
    this.wirePathResolver = wirePathResolver
  }

  /**
   * 版本探测：跑 `[...cmd, '--version']`（超时 5s）解析版本号。
   * 三态（docs/18-§一 detect 纪律；与 codex 同模式——kimi 无版本门槛坑）：
   * 可解析 → ok:true（gaps 空为常态）；未安装 / 解析失败 / 超时 → ok:false 明报（不静默降级）。
   * 注：跑完整 cmd 前缀使注入的假 CLI 能按 FAKE_VERSION 旋钮回放版本输出（与 claude/codex 同取舍）。
   */
  async detect(): Promise<DetectResult> {
    const binary = this.cmd[0] ?? KIMI_DEFAULT_CMD[0] ?? 'kimi'
    const result = await execa(binary, [...this.cmd.slice(1), '--version'], {
      timeout: DETECT_TIMEOUT_MS,
      reject: false, // 探测失败走 gaps 明报，不靠异常表达
      env: { ...process.env },
    })
    if (result.timedOut) {
      return { name: this.name, version: '', ok: false, gaps: ['kimi-detect-timeout'] }
    }
    if (result.failed) {
      // spawn 层失败（ENOENT=未安装；其他如实带原因明报）
      const gap = isENOENT(result.cause)
        ? 'kimi-not-installed'
        : `kimi-detect-failed:${errMsg(result.cause)}`
      return { name: this.name, version: '', ok: false, gaps: [gap] }
    }
    // `kimi --version` 输出形态未知（拟稿按通用语义化版本串抓取，探针权实）
    const match = /v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/.exec(result.stdout.trim())
    if (match === null) {
      return { name: this.name, version: '', ok: false, gaps: ['kimi-version-unparsed'] }
    }
    // kimi 无版本门槛坑（对照 claude 2.1.277）：可解析即达标，gaps 空为常态
    return { name: this.name, version: match[1] ?? '', ok: true, gaps: [] }
  }

  /**
   * 预算预留估算。拟稿（与 dsh/claude/codex 同一 v0 模型，v0.6 前细化；docs/16 里程碑
   * v0.6=预算/断路完善）：字符量÷3 ≈ tokens × $10/M；地板 $0.05、天花板 $8；
   * confidence=0.2——启发式仅够预留参考。kimi 无原生成本（cost_native=false），真账以
   * resultStats 实测 tokens（wire 合流总账）× 价目表为准（折算待批）。
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
   * 拉起 kimi（execa）：`kimi -p --output-format stream-json` + 续跑 `-S <sessionId>`
   * （拟稿旗标形，见文件头注）+ AGENTS_MD 通道 env（agentsMdEnv：native=不注入）。
   * cwd=task.workspace；budgetCap 无处落地（budget_cap=false 照实——能力声明即契约）。
   * reject:false——退出码不构成异常（成功判定只认流内终态）。
   * `-p` 与 yolo/auto/plan 互斥（17-§6）：适配器只构造 `-p` 基座、永不下发模式旗标。
   */
  async launch(task: TaskBrief): Promise<Handle> {
    const [binary = KIMI_DEFAULT_CMD[0] ?? 'kimi', ...base] = this.cmd
    const args = [...base, '-p', '--output-format', 'stream-json']
    if (task.resume !== undefined) {
      args.push('-S', task.resume.sessionId)
    }
    const subprocess = execa(binary, args, {
      cwd: task.workspace,
      env: { ...process.env, ...agentsMdEnv(task.AGENTS_MD) },
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
      wirePath: this.wirePathResolver(sessionId, task.workspace),
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
      throw state.spawnError ?? new Error(`kimi: launch 失败——未取得 pid（cmd=${binary}）`)
    }
    return { executor: this.name, sessionId, pid }
  }

  /**
   * 逐行流消费：stdout chunk → 行切割（含尾部无换行残行）→ parseLine(line,'kimi') 归一
   * （claude 同构 stdout——单行入口不做 wire 合并，streams.ts 头注）→ yield；事件与
   * 原文同时记入伴生状态。一会话只许消费一次。
   * stdout EOF 后 await 子进程拿退出码（reject:false 不抛），**随后读 wire.jsonl 合流**
   * （本家独有难点）：sumWireUsage 求和挂最后一个 turn_end；缺 wire/无 usage 记录/
   * 无 turn_end 可挂——追加明示 log（对齐 streams.parseKimi 冻结行为，不静默降级），
   * 追加事件同样 yield 给消费方（流式固有不对称见文件头注）。
   */
  async *stream(h: Handle): AsyncGenerator<StreamEvent, void, unknown> {
    const state = requireState(h)
    if (state.streamConsumed) {
      throw new Error(`kimi: stream() 已消费（sessionId=${h.sessionId}）——一单一命、一流一收`)
    }
    state.streamConsumed = true
    const stdout = state.subprocess.stdout
    if (stdout === null) {
      // spawn 即失败：无 stdout 通道——如实抛出（detect 前置漏网时在此明报）
      throw state.spawnError ?? new Error('kimi: 子进程 stdout 不可用（launch 失败）')
    }
    const consume = (line: string): StreamEvent[] => {
      state.rawLines.push(line)
      const events = parseLine(line, 'kimi')
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
    // wire 合流（会话结束后）：usage 求和挂 turn_end / 缺件明示 log——详见文件头注
    for (const event of await mergeWireUsage(state)) yield event
  }

  /**
   * 账目汇总（只统计伴生状态里已消费的事件；wire 合流已在 stream() 尾完成）：
   *   tokens：turn_end.usage（wire 逐轮求和总账——25-§3.1 裁决#4 假设口径）；缺 wire/
   *           无 usage 记录 → 零值兜底（明示 log 已在流尾，不静默降级不编造）
   *   turns：turn_end 计数（kimi stdout 无 step 级事件——claude 同构，见文件头注）
   *   duration：launch→流收尾（未收尾取 now）；cost：恒 {usd:0}——待价目表折算
   */
  async resultStats(h: Handle): Promise<ResultStats> {
    const state = requireState(h)
    return {
      cost: { usd: 0 },
      tokens: lastTurnEndUsage(state.events) ?? { input: 0, output: 0 },
      duration: (state.endedAt ?? Date.now()) - state.startedAt,
      turns: state.events.filter((e) => e.type === 'turn_end').length,
    }
  }

  /**
   * 优雅终止：SIGTERM → 宽限 graceMs → SIGKILL（与 dsh/claude/codex 同构升级链）。
   * 已退出的进程不重复杀；幂等（重复 kill 直接返回）。
   * 注：17-§6 kill 列写 killpg 同上——execa 9.6.1 无进程组杀原语，直杀子进程（dsh 头注同因）；
   * 被杀会话 wire 多半缺失——流尾明示 log + tokens 零值（kill 后 result 未到即无终态）。
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
   * 退出码与 wire 皆不参与判定——wire 只影响账目（tokens），不影响完成面。
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
// 内部工具（纯函数 + wire 合流）
// ---------------------------------------------------------------------------

/** 缺省 wire 路径拟稿：<workspace>/.kimi/sessions/<sessionId>/wire.jsonl（待探针，头注） */
function defaultWirePath(sessionId: string, workspace: string): string {
  return join(workspace, '.kimi', 'sessions', sessionId, 'wire.jsonl')
}

/**
 * AGENTS.md 通道 env 映射最小集：
 *   native               → 不注入（复查报告实锤：kimi 读 workspace AGENTS.md）
 *   user_level           → KIMI_CODE_HOME=<target>（docs/04-§97 B5 修订实锤，非拟稿；
 *                          target 落点目录/文件语义与 L5 装配的对接仍待探针，只透传）
 *   append_system_prompt → KIMI_APPEND_SYSTEM_PROMPT_FILE=<target>（变量名自拟——kimi
 *                          未见官方 append 通道文档，镜像 dsh 同通道做法）
 * target 落点由 L5 装配决定、适配器只透传（docs/25-§二 TaskBrief 注释）。
 */
function agentsMdEnv(a: TaskBrief['AGENTS_MD']): Record<string, string> {
  switch (a.channel) {
    case 'native':
      return {}
    case 'user_level':
      return { KIMI_CODE_HOME: a.target }
    case 'append_system_prompt':
      return { KIMI_APPEND_SYSTEM_PROMPT_FILE: a.target }
  }
}

/**
 * wire 合流（会话结束后调用；对齐 streams.parseKimi 冻结口径，不静默降级）：
 *   - 读失败：ENOENT → 「not found at <path>」明示；其他错误如实带原因明示
 *   - 可读但无 usage 记录 → 明示（与 parseKimi 同文）
 *   - 求和成功 → 挂到伴生 events 的最后一个 turn_end（已有 usage 也覆盖——镜像 parseKimi），
 *     无追加事件；无 turn_end 可挂 → 明示（与 parseKimi 同文）且不折算
 * 返回值=需追加 yield 给消费方的事件（均已同步记入伴生 events）。
 */
async function mergeWireUsage(state: SessionState): Promise<StreamEvent[]> {
  let text: string
  try {
    text = await readFile(state.wirePath, 'utf8')
  } catch (e) {
    const detail =
      (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? `wire.jsonl not found at ${state.wirePath}`
        : `wire.jsonl read failed: ${errMsg(e)}`
    return appendLog(state, `[kimi] ${detail}; usage unavailable（17-§6 已知坑）`)
  }
  const summed = sumWireUsage(text)
  if (summed === undefined) {
    return appendLog(state, '[kimi] no usage record in wire.jsonl; usage unavailable')
  }
  for (let i = state.events.length - 1; i >= 0; i--) {
    const ev = state.events[i]
    if (ev !== undefined && ev.type === 'turn_end') {
      state.events[i] = { ...ev, usage: summed } // 挂最后一个 turn_end（覆盖式，镜像 parseKimi）
      return []
    }
  }
  return appendLog(state, '[kimi] wire usage found but stdout has no turn_end to attach')
}

/** 明示 log：记入伴生 events 并原样返回（stream() 尾部 yield） */
function appendLog(state: SessionState, text: string): StreamEvent[] {
  const event: StreamEvent = { type: 'log', text }
  state.events.push(event)
  return [event]
}

/** 最后一个带 usage 的 turn_end（kimi 的 usage 只在 wire 合流后出现——即 wire 总账） */
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
