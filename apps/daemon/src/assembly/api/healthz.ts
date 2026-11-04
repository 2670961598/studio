/**
 * assembly/api/healthz —— daemon liveness 探针（studio-dev-697 守护核配套）
 *
 * 依据：docs/17-§2（liveness 探针：tick 前进＋events 链摘要；非契约 API- 端点、不新增 PORT-）、
 * docs/90-§三（守护核落成形态：guardian 探 /healthz，503=不健康）。
 *
 * 语义（fail-closed，不谎报）：
 *   - 200 = 进程存活 ∧ tick 前进（最近一拍时戳 ≤ maxTickAgeMs）∧ events 哈希链摘要正常（ok 且未过期）；
 *   - 503 = 任一不满足（body 带 reason[] 与各面明细，便于守护核/运维定位）。
 *
 * 边界：本件纯函数（零 IO/零时钟读取，时间由调用方注入）——供 run.ts 组合与测试复用；
 * **不是 readiness**（不承载业务读数），不触碰契约包/PORT-。
 */

/** events 哈希链摘要快照（run.ts 侧按 TTL 复算后注入；verifyEventsChain 的轻量投影） */
export interface HealthzChainSnapshot {
  /** 最近一次复算是否通过 */
  readonly ok: boolean
  /** 链覆盖事件行数（失败时可缺省） */
  readonly events?: number
  /** 链尾 hash 前 12 位（外部锚对账用；不泄全量） */
  readonly tipPrefix?: string
  /** 复算时刻（ms） */
  readonly checkedAt: number
  /** 失败原因（ok=false 时） */
  readonly error?: string
  /** 校验模式（studio-dev-785 加法观测：full=启动/回退全量；delta=checkpoint+新增链行增量） */
  readonly mode?: 'full' | 'delta'
  /** delta 模式的检查点 seq（旧前缀锚；full=0） */
  readonly sinceSeq?: number
}

/** 输入（全部由调用方注入，便于测试确定性） */
export interface HealthzInput {
  readonly pid: number
  /** 进程启动时刻（ms） */
  readonly startedAt: number
  /** 当前时刻（ms） */
  readonly now: number
  readonly tick: {
    /** 最近一拍序号（0=尚未跑过） */
    readonly seq: number
    /** 本进程已跑拍数 */
    readonly count: number
    /** 最近一拍完成时刻（null=尚未跑过） */
    readonly lastAt: number | null
    /** 主循环拍间隔配置（ms） */
    readonly tickMs: number
  }
  readonly chain: HealthzChainSnapshot
  /** tick 前进阈值（缺省 max(30s, 5×tickMs)） */
  readonly maxTickAgeMs?: number
  /** 链摘要最大可接受陈旧度（缺省 10min；过期=不健康，防「拿旧摘要冒充」） */
  readonly chainMaxAgeMs?: number
  /** 事件循环延迟观测（studio-dev-785 加法字段；缺省不出现于 body） */
  readonly loop?: { readonly lagMs: number; readonly windowMs: number }
}

/** 一面对照结果（body 明细） */
export interface HealthzTickDetail {
  readonly seq: number
  readonly count: number
  readonly lastAt: number | null
  readonly ageMs: number | null
  readonly advancing: boolean
  readonly maxAgeMs: number
}

export interface HealthzChainDetail {
  readonly ok: boolean
  readonly events: number | null
  readonly tipPrefix: string | null
  readonly checkedAt: number
  readonly ageMs: number
  readonly fresh: boolean
  readonly error: string | null
  /** 校验模式（785 加法；旧探针忽略未知字段） */
  readonly mode: 'full' | 'delta'
  readonly sinceSeq: number
}

export interface HealthzLoopDetail {
  /** 事件循环延迟（采样窗内最大漂移，ms；0=未观测/健康） */
  readonly lagMs: number
  readonly windowMs: number
}

/** 探针响应（status 与 body 同时给出；HTTP 层据此原样回写） */
export interface HealthzReport {
  readonly status: 200 | 503
  readonly body: {
    readonly ok: boolean
    readonly pid: number
    readonly uptimeMs: number
    readonly tick: HealthzTickDetail
    readonly chain: HealthzChainDetail
    /** 事件循环延迟（785 加法字段；无观测时不出现） */
    readonly loop?: HealthzLoopDetail
    readonly reasons: readonly string[]
  }
}

/** tick 前进阈值（docs/17-§2：max(30s, 5×tickMs)） */
export function maxTickAgeMsOf(tickMs: number): number {
  return Math.max(30_000, Math.max(1, tickMs) * 5)
}

/** 缺省链摘要陈旧上限：10min（60-300s 复算节流之外再留冗余） */
export const DEFAULT_CHAIN_MAX_AGE_MS = 10 * 60_000

/**
 * 构造 liveness 报告（纯函数）。
 * 注意：`lastAt=null`（尚未跑过一拍）=不前进（启动瞬间可能短暂 503，guardian 有启动宽限）。
 */
export function buildHealthz(input: HealthzInput): HealthzReport {
  const tickMs = Math.max(1, input.tick.tickMs)
  const maxAgeMs = input.maxTickAgeMs ?? maxTickAgeMsOf(tickMs)
  const ageMs = input.tick.lastAt === null ? null : Math.max(0, input.now - input.tick.lastAt)
  const advancing = ageMs !== null && ageMs <= maxAgeMs
  const chainAgeMs = Math.max(0, input.now - input.chain.checkedAt)
  const chainMaxAge = input.chainMaxAgeMs ?? DEFAULT_CHAIN_MAX_AGE_MS
  const chainFresh = chainAgeMs <= chainMaxAge
  const chainOk = input.chain.ok && chainFresh

  const reasons: string[] = []
  if (!advancing) reasons.push(input.tick.lastAt === null ? 'tick-never-ran' : 'tick-stalled')
  if (!input.chain.ok) reasons.push('chain-invalid')
  else if (!chainFresh) reasons.push('chain-stale')

  const ok = advancing && chainOk
  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      pid: input.pid,
      uptimeMs: Math.max(0, input.now - input.startedAt),
      tick: {
        seq: input.tick.seq,
        count: input.tick.count,
        lastAt: input.tick.lastAt,
        ageMs,
        advancing,
        maxAgeMs,
      },
      chain: {
        ok: chainOk,
        events: input.chain.events ?? null,
        tipPrefix: input.chain.tipPrefix ?? null,
        checkedAt: input.chain.checkedAt,
        ageMs: chainAgeMs,
        fresh: chainFresh,
        error: input.chain.error ?? null,
        mode: input.chain.mode ?? 'full',
        sinceSeq: input.chain.sinceSeq ?? 0,
      },
      ...(input.loop !== undefined ? { loop: { lagMs: Math.max(0, input.loop.lagMs), windowMs: Math.max(0, input.loop.windowMs) } } : {}),
      reasons,
    },
  }
}
