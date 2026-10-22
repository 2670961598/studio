/**
 * judge/invoke —— micro-judge 判断调用库（studio-dev-160 §6.1/§6.2/§6.3；单 164=单A）
 *
 * 一次调用的全序（提案 §6.1 五步 + §6.2 三帽/熔断 + §6.6-R2 有界延迟）：
 *   0) 前置闸（launch 前、无消耗）：按址熔断判定（site-open）→ 拍闸（tick-quota/
 *      tick-clock）→ 事前估算三帽（estimate-over-cap/site-daily/company-daily——
 *      「不落账不派 judge 版」：refuse 不落预算行，只落 JUDGE_FALLBACK 事件）。
 *      任一 refuse → **立即回退机械规则**（site.fallback(reason)），不重试（LLM_FAIL
 *      处置分叉，17-§9）。
 *   1) 簿记开日（ensureJudgeSiteDay：昨日帽额冲销+当日日 reserve）+ 每次调用 reserve 行。
 *   2) 合成最小 TaskBrief（brief.ts：任务串=角色+词表+上下文+输出铁律；一次性空工作区；
 *      AGENTS_MD=user_level；**credentials 永不设置**）→ 按址一次性 adapter（无工具只读
 *      沙箱 profile：写域=仅 DSH_HOME，workspace 只读）→ launch。
 *   3) 流消费（墙钟死线=timeoutMs，缺省 10s）：超时 kill 整树（SIGTERM→SIGKILL）→
 *      timeout（无部分输出）/output-truncated（有）；turn_end.completed → final 文本进
 *      三道闸 parseJudgeVerdict；turn_end 未完成（AUTH 等）→ no-model。
 *   4) 结算与观测：实际成本（resultStats tokens×low 档价目；适配器 cost_native=false）
 *      **必落 settle 行**（成功/降级/超耗都落——真消耗真记账）；事后超耗（actual>单次帽）
 *      → 裁决弃用回退机械规则（over-spend），实际仍计熔断；JUDGE_OK（采纳）/JUDGE_
 *      FALLBACK（降级，note=reason 枚举）落账；熔断状态推进（成功清零/同因连计 3 开）。
 *   5) 一次性目录树 finally 整删（调用毕 workspace 空——测试断言面）。
 *
 * 边界（单A 冻结）：v1 judge 派发面=dsh 家（dshJudgeAdapterFactory；其他家 judge 位
 * CONFIG_INVALID 明拒——非静默）；「判断结果进主循环状态组装」的接线=单B；sites
 * 注册表/时区日历配置面=单C（日历注入位已留，缺省 UTC 呈报）。
 *
 * 依据：docs/17-§2（主循环相位外的框架内微调用）、§6（dsh 行）；docs/25-§3.1（端口）；
 * studio-dev-160 §8-S2（一次性工作区）/S3（kill 语义）/S6（成本会计）/S9（延迟界）；
 * docs/49（制作人 2026-10-22 全批落档）。
 */
import type {
  ExecutorAdapter,
  Handle,
  ModelCatalog,
  StreamEvent,
  TaskBrief,
  TokenCounts,
} from '@studio-next/contract'
import { configInvalid } from '@studio-next/contract'
import {
  DEFAULT_JUDGE_CAPS,
  DEFAULT_JUDGE_TICK_LIMITS,
  JUDGE_ROLE,
  initialJudgeBreaker,
  initialJudgeTick,
  isJudgeSiteOpen,
  judgeOverSpend,
  judgePreCallGate,
  judgeTickGate,
  judgeVocabFingerprint,
  onJudgeFallback,
  onJudgeSuccess,
  onJudgeTickCall,
  parseJudgeVerdict,
} from '@studio-next/core'
import type {
  JudgeCaps,
  JudgeFallbackReason,
  JudgeSiteBreakerState,
  JudgeTickLimits,
  JudgeTickState,
  JudgeOpVerdict,
  JudgeVocab,
} from '@studio-next/core'
import { DshAdapter } from '@studio-next/adapters'
import { judgeFamilyOf } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../tools/id.ts'
import { buildJudgeTaskBrief, renderJudgePrompt } from './brief.ts'
import {
  ensureJudgeSiteDay,
  judgeDaySpent,
  reserveJudgeCall,
  settleJudgeCall,
  validJudgeSiteId,
  UTC_JUDGE_CALENDAR,
} from './accounts.ts'
import type { JudgeCalendar } from './accounts.ts'
import { judgeFallbackEvent, judgeOkEvent } from './events.ts'
import { createJudgeCallDirs } from './workspace.ts'
import type { JudgeCallDirs } from './workspace.ts'
import { ESTIMATE_CHARS_PER_TOKEN, ESTIMATE_OUTPUT_INPUT_RATIO } from '../budget-gate.ts'

// ————————————————————————— 配置面（site 注册 + 依赖注入） —————————————————————————

/** 单次调用墙钟死线缺省（提案 §6.6-R2：10s；site 可覆盖，改缺省走批示） */
export const DEFAULT_JUDGE_CALL_TIMEOUT_MS = 10_000

/** 判断位（=可判定问题的注册单位）：词表冻结 + 机械规则回退 + 帽/死线覆盖位 */
export interface JudgeSite {
  /** 判定位 id（账目 scope 键段+事件 issue 哨兵——禁冒号，validJudgeSiteId 闸） */
  readonly siteId: string
  /** 冻结词表（注册期 assertJudgeVocab+指纹由装配面收口——serve/单B） */
  readonly vocab: JudgeVocab
  /** 机械规则回退：一切降级路径的唯一出口（§6.1「降级一律回退机械规则」） */
  readonly fallback: (reason: JudgeFallbackReason) => JudgeOpVerdict
  /** 三帽覆盖（缺省=批示值 DEFAULT_JUDGE_CAPS） */
  readonly caps?: JudgeCaps
  /** 单次墙钟死线覆盖（缺省 10s） */
  readonly timeoutMs?: number
}

/** 调用库依赖（daemon 装配注入；全可测：ledger/catalog/adapter 工厂/时钟/日历） */
export interface JudgeDeps {
  readonly company: string
  readonly ledger: Ledger
  /** 价目表（judge 面必在场——serve 启动闸保证；估算与实际折算共用） */
  readonly catalog: ModelCatalog
  /** 按调用一次性 adapter 工厂（seatbelt 选项构造期固定→每次新构造；缺省=dsh judge 位） */
  readonly makeAdapter: (dirs: JudgeCallDirs) => ExecutorAdapter
  readonly now: () => number
  readonly makeId?: (ts: number) => string
  readonly calendar?: JudgeCalendar
  readonly limits?: JudgeTickLimits
  /** 一次性目录树父目录（缺省 os.tmpdir()；测试注入固定落点） */
  readonly wsParent?: string
}

/** 运行态（跨调用持有：熔断表 + 当前拍计数——serve 常驻，单B 挂主循环拍） */
export interface JudgeRuntime {
  readonly breakers: Map<string, JudgeSiteBreakerState>
  tick: JudgeTickState
  /** 新拍开始（主循环每拍调；拍内计数清零，拍身份=tickId） */
  beginTick(tickId: string): void
}

export function createJudgeRuntime(): JudgeRuntime {
  const rt: JudgeRuntime = {
    breakers: new Map(),
    tick: initialJudgeTick('tick-0'),
    beginTick: (tickId: string) => {
      rt.tick = initialJudgeTick(tickId)
    },
  }
  return rt
}

/** 调用结果（verdict 恒在——采纳或机械回退；degraded=走了机械规则） */
export interface JudgeInvokeResult {
  readonly verdict: JudgeOpVerdict
  readonly degraded: boolean
  readonly reason?: JudgeFallbackReason
  readonly estimatedUsd: number
  readonly costUsd: number
  readonly durationMs: number
}

/**
 * dsh 家 judge 位适配器工厂（v1 唯一支持的家族——单A 冻结面）：
 * 每次调用新构造 DshAdapter（seatbelt 选项构造期固定，写域=仅该次 DSH_HOME——workspace
 * 只读、回环 RPC 禁用（判断调用无宿主 RPC 依赖）；模型出口白名单（outboundTcp）归
 * 部署面（单B 接线随 sites 配置给——缺省禁远程，localhost 域名限制见 seatbelt.ts 头注）。
 * reg.name 必须是 `<family>-judge` 形态且家族=dsh，否则 CONFIG_INVALID 明拒。
 */
export function dshJudgeAdapterFactory(reg: {
  name: string
  cmd?: readonly string[] | undefined
}): (dirs: JudgeCallDirs) => ExecutorAdapter {
  const family = judgeFamilyOf(reg.name)
  if (family === undefined) {
    configInvalid(
      'judge/not-judge-slot',
      `judge 派发面注册名必须是 <family>-judge 形态，收到 ${reg.name}（studio-dev-160 §6.3）`,
    )
  }
  if (family !== 'dsh') {
    configInvalid(
      'judge/family-unsupported',
      `v1 judge 派发面仅支持 dsh 家（收到 ${reg.name}=${family} 家）；其他家族走后续单（单A 冻结面）`,
    )
  }
  return (dirs: JudgeCallDirs): ExecutorAdapter =>
    new DshAdapter(reg.cmd, {
      seatbelt: {
        mode: 'auto',
        dshHomeRedirect: dirs.dshHome,
        writeRootsOverride: [dirs.dshHome],
        profileDir: dirs.profileDir,
        rpcEndpoints: [],
      },
    })
}

/** 零用量约定（stats 缺席时的 JUDGE_OK tokens——四桶非空校验的最小真值） */
const ZERO_JUDGE_TOKENS: TokenCounts = { input: 0, output: 0 }

// ————————————————————————— 内部工具 —————————————————————————

/** 三道闸 subcause → 降级原因（parseJudgeVerdict 只抛这三类——穷尽映射） */
function gateSubcauseToReason(subcause: string): JudgeFallbackReason | undefined {
  if (subcause === 'judge/bad-json') return 'bad-json'
  if (subcause === 'judge/op-not-in-vocab') return 'op-not-in-vocab'
  if (subcause === 'judge/params-domain') return 'params-domain'
  return undefined
}

/** 下一事件带死线（for-await 不给逐事件超时面——race 计时器补；finally 清计时器） */
async function nextWithDeadline<T>(
  iter: AsyncIterator<T>,
  deadlineAt: number,
  now: () => number,
): Promise<{ type: 'event'; done: true } | { type: 'event'; done: false; value: T } | { type: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const remaining = deadlineAt - now()
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(remaining, 0))
    })
    const raced = (await Promise.race([iter.next(), timeout])) as
      | IteratorResult<T>
      | 'timeout'
    if (raced === 'timeout') return { type: 'timeout' }
    if (raced.done ?? false) return { type: 'event', done: true }
    return { type: 'event', done: false, value: raced.value as T }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** tokens → 美元（low 档价目折算——cost_native=false 的统一实际口径） */
function costOfTokens(catalog: ModelCatalog, tokens: TokenCounts): number {
  const tier = catalog.resolve(JUDGE_ROLE).tier
  return catalog.estimateCost({ input: tokens.input, output: tokens.output ?? 0 }, tier).usd
}

/** resultStats 尽力收（kill 后/异常流收不到统计=如实记 0，不伪造） */
async function statsOf(adapter: ExecutorAdapter, handle: Handle): Promise<{ tokens: TokenCounts; durationMs: number } | undefined> {
  try {
    const stats = await adapter.resultStats(handle)
    return { tokens: stats.tokens, durationMs: stats.duration }
  } catch {
    return undefined
  }
}

// ————————————————————————— 主流程 —————————————————————————

/**
 * 判断调用（全序见文件头注）。**永不抛 LLM 层错误**：一切失败路径=降级机械规则+
 * JUDGE_FALLBACK 落账（抛错只可能是 CONFIG_INVALID 装配错——如实上抛拒服务）。
 */
export async function invokeJudge(
  rt: JudgeRuntime,
  deps: JudgeDeps,
  site: JudgeSite,
  facts: unknown,
): Promise<JudgeInvokeResult> {
  if (!validJudgeSiteId(site.siteId)) {
    configInvalid(
      'judge/site-id',
      `siteId 非法：${site.siteId}（账目 scope 键纪律：非空且不含冒号——accounts.ts 头注）`,
    )
  }
  const makeId = deps.makeId ?? makeUlid
  const calendar = deps.calendar ?? UTC_JUDGE_CALENDAR
  const limits = deps.limits ?? DEFAULT_JUDGE_TICK_LIMITS
  const timeoutMs = site.timeoutMs ?? DEFAULT_JUDGE_CALL_TIMEOUT_MS
  const caps = site.caps ?? DEFAULT_JUDGE_CAPS
  const startedAt = deps.now()
  const dayKey = calendar.dayKeyOf(startedAt)
  const breaker = rt.breakers.get(site.siteId) ?? initialJudgeBreaker(site.siteId)

  /** 降级收口：机械规则回退 + 熔断推进 + JUDGE_FALLBACK 落账（一切失败路径共用） */
  const degrade = (
    reason: JudgeFallbackReason,
    extra: { estimatedUsd: number; costUsd?: number; durationMs?: number; tokens?: TokenCounts; detail?: string } = { estimatedUsd: 0 },
  ): JudgeInvokeResult => {
    const ts = deps.now()
    rt.breakers.set(site.siteId, onJudgeFallback(breaker, reason, dayKey))
    deps.ledger.appendEvent(
      judgeFallbackEvent({
        id: makeId(ts),
        ts,
        company: deps.company,
        site: site.siteId,
        reason,
        ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
        ...(extra.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
        ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
        ...(extra.tokens !== undefined ? { tokens: extra.tokens } : {}),
      }),
    )
    return {
      verdict: site.fallback(reason),
      degraded: true,
      reason,
      estimatedUsd: extra.estimatedUsd,
      costUsd: extra.costUsd ?? 0,
      durationMs: extra.durationMs ?? ts - startedAt,
    }
  }

  // 0a) 按址熔断：开=机械规则直答（不再唤起——熔断中的降级不累计签名）
  if (isJudgeSiteOpen(breaker, dayKey)) {
    return degrade('site-open')
  }
  // 0b) 拍闸：址拍额/拍总额/拍墙钟（预检不点火——拒绝不占拍计数）
  const tickDecision = judgeTickGate(rt.tick, site.siteId, timeoutMs, limits)
  if (tickDecision.kind === 'refuse') {
    return degrade(tickDecision.reason)
  }

  // 估算（任务串字符量口径，同 budget-gate 态 A：chars/4 输入 × 0.5 输出 × low 档）
  const prompt = renderJudgePrompt({ vocab: site.vocab, factsJson: JSON.stringify(facts) })
  const inputTokens = Math.ceil(prompt.length / ESTIMATE_CHARS_PER_TOKEN)
  const outputTokens = Math.ceil(inputTokens * ESTIMATE_OUTPUT_INPUT_RATIO)
  const lowTier = deps.catalog.resolve(JUDGE_ROLE).tier
  const estimatedUsd = deps.catalog.estimateCost({ input: inputTokens, output: outputTokens }, lowTier).usd

  // 0c) 事前三帽（不落账不派——refuse 无预算行，只有 JUDGE_FALLBACK 事件）
  const { siteUsd, companyUsd } = judgeDaySpent(deps.ledger, { site: site.siteId, dayKey, calendar })
  const preGate = judgePreCallGate({ estimateUsd: estimatedUsd, siteSpentUsd: siteUsd, companySpentUsd: companyUsd, caps })
  if (preGate.kind === 'refuse') {
    return degrade(preGate.reason, { estimatedUsd })
  }

  // 1) 日簿记 + 每次调用 reserve（「不落账不派」的落账半边）
  const callId = makeId(deps.now())
  ensureJudgeSiteDay(deps.ledger, {
    site: site.siteId,
    dayKey,
    caps,
    calendar,
    ts: deps.now(),
    makeId,
  })
  reserveJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, ts: deps.now(), id: makeId(deps.now()) })

  // 2) 合成 brief → 一次性 adapter → launch → 流消费（墙钟死线）
  const dirs = createJudgeCallDirs({ ...(deps.wsParent !== undefined ? { parent: deps.wsParent } : {}) })
  try {
    const brief: TaskBrief = buildJudgeTaskBrief(dirs, { callId, prompt })
    const adapter = deps.makeAdapter(dirs)
    let handle: Handle
    try {
      handle = await adapter.launch(brief)
    } catch {
      // launch 即败（spawn 层：CLI 缺席/凭据坏——模型面不可用）：reserve 收口 actual=0 结算
      settleJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, actualUsd: 0, ts: deps.now(), id: makeId(deps.now()) })
      const res = degrade('no-model', { estimatedUsd })
      rt.tick = onJudgeTickCall(rt.tick, site.siteId, deps.now() - startedAt)
      return res
    }
    const logs: string[] = []
    let turnEnd: Extract<StreamEvent, { type: 'turn_end' }> | undefined
    let timedOut = false
    let streamFailed = false
    const deadlineAt = deps.now() + timeoutMs
    const iter = adapter.stream(handle)[Symbol.asyncIterator]()
    while (true) {
      let next: Awaited<ReturnType<typeof nextWithDeadline<StreamEvent>>>
      try {
        next = await nextWithDeadline(iter, deadlineAt, deps.now)
      } catch {
        streamFailed = true // 流面异常（executor 侧管道坏）——模型面不可用同口径
        break
      }
      if (next.type === 'timeout') {
        timedOut = true
        await adapter.kill(handle, 500)
        break
      }
      if (next.type !== 'event' || next.done) break
      const ev: StreamEvent = next.value
      if (ev.type === 'log') logs.push(ev.text)
      else if (ev.type === 'turn_end') {
        turnEnd = ev
        break
      }
    }
    const stats = await statsOf(adapter, handle)
    const actualUsd = stats === undefined ? 0 : costOfTokens(deps.catalog, stats.tokens)

    // 3) 分类（互斥穷尽：completed 过闸 / completed 不过闸 / turn 失败 / 超时 / 无终态）
    if (turnEnd !== undefined && turnEnd.completed && !timedOut) {
      const raw = logs.at(-1) ?? ''
      try {
        const verdict = parseJudgeVerdict(raw, site.vocab)
        // 4) 事后超耗：裁决弃用（实际仍落账仍计熔断——超耗是真信号）
        if (judgeOverSpend(actualUsd, caps)) {
          settleJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, actualUsd, ts: deps.now(), id: makeId(deps.now()) })
          const res = degrade('over-spend', {
            estimatedUsd,
            costUsd: actualUsd,
            durationMs: stats?.durationMs ?? deps.now() - startedAt,
            ...(stats !== undefined ? { tokens: stats.tokens } : {}),
          })
          rt.tick = onJudgeTickCall(rt.tick, site.siteId, deps.now() - startedAt)
          return res
        }
        settleJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, actualUsd, ts: deps.now(), id: makeId(deps.now()) })
        rt.breakers.set(site.siteId, onJudgeSuccess(breaker))
        const ts = deps.now()
        const durationMs = stats?.durationMs ?? ts - startedAt
        deps.ledger.appendEvent(
          judgeOkEvent({
            id: makeId(ts),
            ts,
            company: deps.company,
            site: site.siteId,
            op: verdict.op,
            vocabFingerprint: judgeVocabFingerprint(site.vocab),
            costUsd: actualUsd,
            durationMs,
            tokens: stats?.tokens ?? ZERO_JUDGE_TOKENS,
          }),
        )
        rt.tick = onJudgeTickCall(rt.tick, site.siteId, deps.now() - startedAt)
        return { verdict, degraded: false, estimatedUsd, costUsd: actualUsd, durationMs }
      } catch (err) {
        // 三道闸拒收（LLM_FAIL judge/*）——立即降级不重试
        settleJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, actualUsd, ts: deps.now(), id: makeId(deps.now()) })
        const sub = (err as { subcause?: string }).subcause
        const reason = sub !== undefined ? gateSubcauseToReason(sub) : undefined
        if (reason === undefined) throw err
        const res = degrade(reason, {
          estimatedUsd,
          costUsd: actualUsd,
          durationMs: stats?.durationMs ?? deps.now() - startedAt,
          ...(stats !== undefined ? { tokens: stats.tokens } : {}),
        })
        rt.tick = onJudgeTickCall(rt.tick, site.siteId, deps.now() - startedAt)
        return res
      }
    }
    // 非采纳终态：超时/截断/turn 失败/流异常/无终态——如实结算+降级
    settleJudgeCall(deps.ledger, { site: site.siteId, callId, estimatedUsd, actualUsd, ts: deps.now(), id: makeId(deps.now()) })
    const reason: JudgeFallbackReason =
      timedOut ? (logs.length > 0 ? 'output-truncated' : 'timeout')
      : streamFailed || turnEnd !== undefined ? 'no-model'
      : logs.length > 0 ? 'output-truncated'
      : 'no-model'
    const res = degrade(reason, {
      estimatedUsd,
      costUsd: actualUsd,
      durationMs: stats?.durationMs ?? deps.now() - startedAt,
      ...(stats !== undefined ? { tokens: stats.tokens } : {}),
      ...(turnEnd !== undefined && turnEnd.errorCode !== undefined ? { detail: `code=${turnEnd.errorCode}` } : {}),
    })
    rt.tick = onJudgeTickCall(rt.tick, site.siteId, deps.now() - startedAt)
    return res
  } finally {
    dirs.cleanup() // 5) 一次性目录树整删（成功/降级/异常三态都收口）
  }
}

// ————————————————————————— 再导出（judge 面单一入口；core 纯面透传免多跳 import） —————————————————————————
