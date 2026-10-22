/**
 * judge —— :8791 判断调用读面（micro-judge 按址统计；studio-dev-160 §6.5 面板读面 · 单D）
 *
 * 提案 §6.5 冻结口径：「监控增『判断调用』区（每址次数/降级率/实费/熔断态）——纯读台账，
 * 无新事实源」（docs/17-§8 端面行；文档逻辑名 :8787、端口实值 :8791——制作人 2026-10-21
 * 令换端口 546bb6b）。判断调用零生命周期（160 §6.1 三零）：不进收割契约/work_records，
 * JUDGE_OK/JUDGE_FALLBACK 事件族是其唯一台账锚（单 164 落），本面=该事件族的只读聚合投影。
 *
 * 数据源与口径：
 *   - site 归属=事件 issue 列（site_id 哨兵——判断调用不占派工单号空间，judge/events.ts）；
 *     降级原因=note `site=<site> reason=<枚举值>`（机器可比对：熔断签名/面板分组消费，
 *     events.ts 头注钦定本面为 reason 分组消费方）
 *   - 调用量=JUDGE_OK+JUDGE_FALLBACK 计数（一次调用恰落一事件，两事件互斥穷尽——invoke.ts）；
 *     实费=Σ cost_usd 含降级事件携带的实际消耗（超时/超耗「实费照记」口径，单A §6.4）；
 *     费用的记账正源=预算行 mj: settle（judge/accounts.ts），本面为事件面等值投影——
 *     两源对账差异属异常态，如实呈现不互改
 *   - 熔断态=按址熔断状态机的事件重放投影：转移规则与 core judge-gates 值语义逐句对应
 *     （JUDGE_FALLBACK→onJudgeFallback、JUDGE_OK→onJudgeSuccess；同因连击 3 开、成功清零、
 *     跨日签名复位、日界自动闭合）。panel→core 是非法边（guard:boundaries 冻结，panel 运行面
 *     依赖=contract+store），镜像实现漂移由 apps/daemon/test/panel-judge-align.test.ts 钉住
 *     （daemon→panel、daemon→core 均合法边——同 panel-inbox-align 先例）。
 *     重放以事件 ts 折算 UTC 日键（judge 日历缺省 UTC；公司时区日历=单C 配置面未接）；
 *     daemon 内存态才是熔断真源——本投影与 workers v0/breakers v0 同精神，basis 字段机器可辨
 *
 * 窗口语义：?days= 滚动窗（缺省 7 上限 90，同断路卡）只约束统计面；熔断重放吃全量史
 * （窗口外事件不入统计但参与状态折叠——长休眠址的当前状态不失真）。
 * 只读纪律同本包：对 SQLite 零写（WAL 单写多读）。
 */
import type { EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { DAY_MS, dayKeyOf } from './views.ts'

/** 观测窗缺省天数（同断路卡 7 天） */
export const DEFAULT_JUDGE_DAYS = 7
/** 观测窗上限天数（同断路卡 90 天） */
export const MAX_JUDGE_DAYS = 90

/**
 * 熔断阈值（core JUDGE_BREAKER_THRESHOLD 同值=3——同因连击 3 次即熔断，提案 §6.2 冻结值；
 * 改值走批示，对齐测试钉住镜像同步）。panel 不引 core（非法边），故本地面声明同值。
 */
export const JUDGE_BREAKER_THRESHOLD_PROJECTION = 3

/** 快照口径说明（响应体 note 字段——机器可读处也留人话） */
export const JUDGE_SNAPSHOT_NOTE =
  'v1 投影：JUDGE_OK/JUDGE_FALLBACK 事件聚合（一次调用恰一事件）；' +
  '熔断态=事件重放（core judge-gates 值语义镜像，daemon 内存态为真源）；' +
  '日键按 UTC 折算（公司时区日历归 160-C）；费用正源=mj: 预算 settle 行，本面为事件面等值投影'

/** note 不可解析时的原因桶名（如实不臆造——正常事件 note 恒为 events.ts 冻结格式） */
export const JUDGE_REASON_UNKNOWN = 'unknown'

// —— 事件面判定与解析（note 格式=judge/events.ts 冻结格式） ——

/** JUDGE_* 判断事件判定（两事件名互斥穷尽——前缀族其余名不进本面） */
export function isJudgeEvent(ev: EventRecord): boolean {
  return ev.event === 'JUDGE_OK' || ev.event === 'JUDGE_FALLBACK'
}

/** JUDGE_FALLBACK note 原因位：`site=<site> reason=<枚举值>[ <detail>]` */
const FALLBACK_NOTE_PATTERN = /^site=\S+ reason=(\S+)/

/** 降级原因解析（events.ts 冻结格式的读面解析器）；不可解析 → null（计 unknown 桶） */
export function parseFallbackReason(note: string | undefined): string | null {
  if (note === undefined) return null
  const matched = FALLBACK_NOTE_PATTERN.exec(note)
  return matched === null ? null : (matched[1] as string)
}

// —— 按址熔断重放（core judge-gates 值语义的事件面镜像；对齐测试钉在 daemon） ——

/** 按址熔断投影（读面形；字段与 core JudgeSiteBreakerState 同名同义，成功清零语义一致） */
export interface JudgeBreakerProjection {
  /** 当前（快照日键）是否熔断中（=core isJudgeSiteOpen：openSinceDay===当日键） */
  open: boolean
  /** 当前同因连击（成功清零/换因归 1/跨日归 1） */
  streak: number
  /** 状态机最近降级原因（成功清零后=null；unknown=note 不可解析） */
  lastReason: string | null
  /** 熔断起始日键（UTC；open=false 且非 null=跨日已闭合的最近一次开断日——core 状态原样透传） */
  openSinceDay: string | null
}

/** 重放内部态（值语义逐步折叠；转移规则与 core onJudgeFallback/onJudgeSuccess 逐句对应） */
interface ReplayState {
  lastReason?: string
  streak: number
  openSinceDay?: string
  lastDayKey?: string
}

/**
 * 一次降级转移（=core onJudgeFallback）：跨自然日=签名复位（连因不隔夜累计）；同因同日
 * streak++；达阈值（3）→开；未达阈时同日旧标记防御性保留（core 同款——熔断中本不该到
 * 这，site-open 事件也经此路：同因同日 streak 续计但 open 语义不变）。
 */
function replayFallback(
  state: ReplayState,
  reason: string,
  dayKey: string,
  threshold: number,
): ReplayState {
  const sameDay = state.lastDayKey === dayKey
  const streak = sameDay && state.lastReason === reason ? state.streak + 1 : 1
  const open = streak >= threshold
  const openSinceDay = open || state.openSinceDay === dayKey ? dayKey : undefined
  return {
    lastReason: reason,
    streak,
    lastDayKey: dayKey,
    ...(openSinceDay !== undefined ? { openSinceDay } : {}),
  }
}

/** 一次成功转移（=core onJudgeSuccess：签名清零——连击性断，lastReason/openSinceDay 一并放空） */
function replaySuccess(): ReplayState {
  return { streak: 0 }
}

/**
 * 按址熔断全量重放：JUDGE_\* 事件（调用方保证 (ts,id) 稳定升序——store queryEvents 缺省序）
 * 逐条折叠；nowDayKey 判「当前是否仍开」（日界差自动闭合）。非判断事件跳过。
 * 导出面=对齐测试钉住点（apps/daemon/test/panel-judge-align.test.ts）。
 */
export function replayJudgeBreakers(
  events: EventRecord[],
  nowDayKey: string,
): Map<string, JudgeBreakerProjection> {
  const states = new Map<string, ReplayState>()
  for (const ev of events) {
    if (!isJudgeEvent(ev)) continue
    const site = ev.issue
    const prev = states.get(site) ?? { streak: 0 }
    const next =
      ev.event === 'JUDGE_OK'
        ? replaySuccess()
        : replayFallback(
            prev,
            parseFallbackReason(ev.note) ?? JUDGE_REASON_UNKNOWN,
            dayKeyOf(ev.ts),
            JUDGE_BREAKER_THRESHOLD_PROJECTION,
          )
    states.set(site, next)
  }
  const out = new Map<string, JudgeBreakerProjection>()
  for (const [site, state] of states) {
    out.set(site, {
      open: state.openSinceDay === nowDayKey,
      streak: state.streak,
      lastReason: state.lastReason ?? null,
      openSinceDay: state.openSinceDay ?? null,
    })
  }
  return out
}

// —— 按址统计（观测窗内聚合） ——

/** 降级原因分布行（count 降序，同数原因名升序——诊断面稳定全序） */
export interface JudgeReasonCount {
  reason: string
  count: number
}

/** 按址统计行（观测窗内；四要件列=调用量/费用/降级率/熔断态 + 诊断辅列） */
export interface JudgeSiteRow {
  /** 判定位 id（=事件 issue 哨兵；注册面见 judge/sites——单C） */
  site: string
  company: string
  /** 调用量=ok+fallbacks（一次调用恰落一事件） */
  calls: number
  ok: number
  fallbacks: number
  /** 降级率=fallbacks/calls（calls=0 时 0——空窗址不出现于行集，防御式约定） */
  fallbackRate: number
  /** 实费 USD（Σ cost_usd，含降级携带实费——超时/超耗照记） */
  costUsd: number
  /** 带 duration_ms 事件的均值（无计时事件=null——JUDGE_FALLBACK 未唤起型不带） */
  avgDurationMs: number | null
  /** 窗口内最近一次调用时刻（epoch ms） */
  lastTs: number
  /** 降级原因分布（面板分组消费——events.ts 头注钦定；无降级=空数组） */
  byReason: JudgeReasonCount[]
  /** 熔断态（全量史重放投影，不受窗口约束） */
  breaker: JudgeBreakerProjection
}

/** 全址合计（观测窗内） */
export interface JudgeTotals {
  calls: number
  ok: number
  fallbacks: number
  fallbackRate: number
  costUsd: number
}

/** 判断调用快照（/api/judge 响应体） */
export interface JudgeSnapshot {
  /** 口径标记：事件面重放投影 v1（daemon 内存态为真源——机器可辨，同 workers/breakers v0 精神） */
  basis: 'events-replay-v1'
  note: string
  generatedAt: number
  days: number
  /** 观测窗起点（epoch ms；滚动窗=now−days×24h） */
  since: number
  /** company 过滤维（null=全公司） */
  company: string | null
  /** 行集=窗口内有判断事件的址（calls 降序，同数 site 升序——稳定全序） */
  sites: JudgeSiteRow[]
  totals: JudgeTotals
  /** 熔断中（投影）址数 */
  openBreakers: number
}

/** 快照可调参数（测试注时间用 now；company/days 与端面 query 同义） */
export interface JudgeOptions {
  now?: number
  days?: number
  company?: string
}

/** 行集内累加器（窗口内逐步聚合） */
interface SiteAcc {
  company: string
  calls: number
  ok: number
  fallbacks: number
  costUsd: number
  durationSumMs: number
  durationCount: number
  lastTs: number
  reasons: Map<string, number>
}

/**
 * 判断调用快照：JUDGE_\* 事件按址聚合（窗口内统计）+ 熔断全量史重放投影。
 * 全部走 Ledger 读面（queryEvents 缺省 (ts,id) 升序——store 冻结语义），零 SQL 零写。
 */
export function buildJudgeSnapshot(ledger: Ledger, options?: JudgeOptions): JudgeSnapshot {
  const now = options?.now ?? Date.now()
  const days = options?.days ?? DEFAULT_JUDGE_DAYS
  const since = now - days * DAY_MS

  const judgeEvents = ledger
    .queryEvents(options?.company !== undefined ? { company: options.company } : {})
    .filter(isJudgeEvent)
  const breakers = replayJudgeBreakers(judgeEvents, dayKeyOf(now))

  const accs = new Map<string, SiteAcc>()
  for (const ev of judgeEvents) {
    if (ev.ts < since) continue // 窗口外：不入统计（熔断折叠已吃全量史）
    let acc = accs.get(ev.issue)
    if (acc === undefined) {
      acc = {
        company: ev.company,
        calls: 0,
        ok: 0,
        fallbacks: 0,
        costUsd: 0,
        durationSumMs: 0,
        durationCount: 0,
        lastTs: ev.ts,
        reasons: new Map<string, number>(),
      }
      accs.set(ev.issue, acc)
    }
    acc.company = ev.company // 址迁公司极罕见——取最近事件所属公司
    acc.calls += 1
    acc.lastTs = Math.max(acc.lastTs, ev.ts)
    acc.costUsd += ev.cost_usd ?? 0
    if (ev.duration_ms !== undefined) {
      acc.durationSumMs += ev.duration_ms
      acc.durationCount += 1
    }
    if (ev.event === 'JUDGE_OK') acc.ok += 1
    else {
      acc.fallbacks += 1
      const reason = parseFallbackReason(ev.note) ?? JUDGE_REASON_UNKNOWN
      acc.reasons.set(reason, (acc.reasons.get(reason) ?? 0) + 1)
    }
  }

  const sites: JudgeSiteRow[] = [...accs.entries()]
    .map(([site, acc]) => ({
      site,
      company: acc.company,
      calls: acc.calls,
      ok: acc.ok,
      fallbacks: acc.fallbacks,
      fallbackRate: acc.calls > 0 ? acc.fallbacks / acc.calls : 0,
      costUsd: acc.costUsd,
      avgDurationMs: acc.durationCount > 0 ? acc.durationSumMs / acc.durationCount : null,
      lastTs: acc.lastTs,
      byReason: [...acc.reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => (b.count !== a.count ? (b.count > a.count ? 1 : -1) : a.reason < b.reason ? -1 : 1)),
      breaker:
        breakers.get(site) ?? {
          open: false,
          streak: 0,
          lastReason: null,
          openSinceDay: null,
        },
    }))
    .sort((a, b) => (b.calls !== a.calls ? (b.calls > a.calls ? 1 : -1) : a.site < b.site ? -1 : 1))

  const calls = sites.reduce((sum, row) => sum + row.calls, 0)
  const fallbacks = sites.reduce((sum, row) => sum + row.fallbacks, 0)
  const ok = calls - fallbacks
  return {
    basis: 'events-replay-v1',
    note: JUDGE_SNAPSHOT_NOTE,
    generatedAt: now,
    days,
    since,
    company: options?.company ?? null,
    sites,
    totals: {
      calls,
      ok,
      fallbacks,
      fallbackRate: calls > 0 ? fallbacks / calls : 0,
      costUsd: sites.reduce((sum, row) => sum + row.costUsd, 0),
    },
    openBreakers: sites.filter((row) => row.breaker.open).length,
  }
}
