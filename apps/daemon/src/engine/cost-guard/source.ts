/**
 * cost-guard/source —— cost-threshold 唤起源（132-§6.4 单C·studio-dev-177；
 * docs/22-§一/§二 源注册表接入；docs/25-§3.4 kind='escalate'）
 *
 * 定位（132-§6.4 触发条件定稿表逐字段对齐 129 P0-B 预留）：tick 驱动扫当日用量
 * 投影+在途预留 → 达档产 kind='escalate' 意图（payload.class='cost-threshold'，
 * 129 消费分发表既有行——本单不重设计消费面）+ ESCALATE 事件落账（SLA 源同型：
 * 只产意图+落账，物化处置单/notify 归 129 链执行）。
 *
 * 评估口径（每 tick，零内存态——重启/关源重开天然幂等）：
 *   - scope：company ｜ person:<工号>（F3 两级）；period=day:<本地日>；
 *   - running_usd = fold(usage_daily 当日 × 当日取价) + 在途净预留 fold（F4
 *     actual+forecast 双口径；取价=makeBasisResolver 快照优先→models.yaml 兜底，
 *     与收割即时折算同一入口——两口径恒一致）；
 *   - 判定 running_usd ≥ budget_usd × at_pct 按档序取最高达标档（core
 *     highestReachedTier）；
 *   - 幂等（同 scope 同日同档只醒一次）：dedupKey `cost:<scope>:<period>:<tier>`
 *     照录 129 公式；已醒集从本源 ESCALATE note 派生（`src=cost-threshold;scope=;
 *     period=;tier=`，sla-timer 源同型 C7）——升档=新 tier=新 key（升档必醒，
 *     降档不重复醒，机械保证）。
 *
 * 段未声明（guard getter 返回 undefined）=面关=零行为（poll 直接返回空报告）。
 *
 * ESCALATE 事件形状：公司级事件挂心跳哨兵单（issue='-'，events.issue 必填契约
 * ——pricing stale DAILY_ALARM 同法）；person scope 的 dept 取该人档案 dept
 * （deptFallback 兜底）；tokens={input:0}（无计量零值桶——events schema 口径）。
 */
import type {
  CostGuardConfig,
  EventRecord,
  InvokeIntent,
  InvokeSource,
  ModelTier,
  PersonRef,
  SourceManifest,
} from '@studio-next/contract'
import { highestReachedTier, localDateKey, usageCellsCostUsd, type UnitPrice } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../tools/id.ts'
import { makeBasisResolver, personDailyBudgetUsd, personReservedUsd, type ResolvedUnit } from './fold.ts'

/** cost-threshold 源名 */
export const COST_THRESHOLD_SOURCE_NAME = 'cost-threshold'

export const COST_THRESHOLD_SOURCE_MANIFEST: SourceManifest = {
  name: COST_THRESHOLD_SOURCE_NAME,
  kind: 'escalate',
  configSchema: 'org-config cost_guard 段（成本警戒唤起源——132-§6.4 单C；不声明=面关）',
}

/** 源依赖（serve 侧闭包快照 getter——热更经 applyCompanyUpdate 整组换） */
export interface CostThresholdSourceDeps {
  ledger: Ledger
  clock: () => number
  company: string
  /** cost_guard 段 getter（undefined=面关） */
  guard: () => CostGuardConfig | undefined
  /** 花名册 getter（scope 枚举+人日预算覆盖位+dept） */
  people: () => readonly PersonRef[]
  /** models.yaml 三档声明面（快照桥兜底；undefined=只信快照） */
  declared?: readonly ModelTier[]
  /** company 级事件 dept 兜底（config.deptFallback 同源） */
  deptFallback: string
  /** 心跳哨兵 issue（config.heartbeatIssue 同源） */
  heartbeatIssue: string
  /** 扫描轮询间隔 ms */
  intervalMs: number
  /** 事件 id 生成器（缺省 makeUlid——测试可注入确定性 id） */
  makeId?: (ts: number) => string
  /** 事件 actor（缺省 'daemon'） */
  actor?: string
  log?: (line: string) => void
}

/** 单次扫描报告（观测/测试断言） */
export interface CostThresholdReport {
  ts: number
  /** 本地日（period 面） */
  date: string
  /** 本拍评估的 scope 数（1 公司 + 花名册人数；面关=0） */
  checked: number
  /** 本拍新唤醒档位数 */
  fired: number
}

/** 源句柄：InvokeSource 端口 + 手动泵（poll）+ 计数 */
export interface CostThresholdSource extends InvokeSource {
  poll(emit?: (intent: InvokeIntent) => void): CostThresholdReport
  readonly stats: { polls: number; fired: number; errors: number }
}

/** 单格折算产物（top_consumers/事实包源料） */
interface CellCost {
  person: string
  model: string
  usd: number
  resolved: ResolvedUnit
}

function firedKeys(events: readonly EventRecord[]): Set<string> {
  const keys = new Set<string>()
  for (const e of events) {
    if (e.event !== 'ESCALATE') continue
    if (!(e.note ?? '').includes(`src=${COST_THRESHOLD_SOURCE_NAME}`)) continue // 他源 ESCALATE 不计
    const scope = /(?:^|;)scope=([^;]+)/.exec(e.note ?? '')
    const period = /(?:^|;)period=([^;]+)/.exec(e.note ?? '')
    const tier = /(?:^|;)tier=([^;]+)/.exec(e.note ?? '')
    if (scope !== null && period !== null && tier !== null) keys.add(`cost:${scope[1]}:${period[1]}:${tier[1]}`)
  }
  return keys
}

/**
 * createCostThresholdSource —— tick 驱动的成本警戒源（SLA 源同型）。
 * 零内存态：每拍全量重读 usage_daily/budgets/events 派生——重启天然恢复。
 */
export function createCostThresholdSource(deps: CostThresholdSourceDeps): CostThresholdSource {
  const log = deps.log ?? ((): void => undefined)
  const makeId = deps.makeId ?? makeUlid
  const stats = { polls: 0, fired: 0, errors: 0 }
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  function poll(emitOverride?: (intent: InvokeIntent) => void): CostThresholdReport {
    const now = deps.clock()
    const emit = emitOverride ?? liveEmit
    stats.polls += 1
    const guard = deps.guard()
    if (guard === undefined) return { ts: now, date: localDateKey(now), checked: 0, fired: 0 }
    const date = localDateKey(now)
    const period = `day:${date}`
    const people = deps.people()
    const resolve = makeBasisResolver(deps.ledger, deps.company, date, deps.declared)

    // 当日投影折算（快照优先→models.yaml 兜底→unpriced 按 0 计）
    const unitOf = (model: string): UnitPrice | undefined => resolve(model).unit
    const cells = deps.ledger.listUsageDaily({ company: deps.company, usage_date: date })
    const cellCosts: CellCost[] = cells.map((c) => ({
      person: c.person_id,
      model: c.model,
      usd: usageCellsCostUsd([c], unitOf).usd,
      resolved: resolve(c.model),
    }))
    const settledByPerson = new Map<string, number>()
    for (const c of cellCosts) settledByPerson.set(c.person, (settledByPerson.get(c.person) ?? 0) + c.usd)
    const reservedByPerson = new Map<string, number>()
    for (const p of people) reservedByPerson.set(p.id, personReservedUsd(deps.ledger, p.id))

    // 事实包公共料：top 消费格（≤3）+取价基准串+stale 标记
    const topConsumers = [...cellCosts].sort((a, b) => b.usd - a.usd).slice(0, 3)
    const priceSnapshotRef = [...new Set(cellCosts.map((c) => `${c.model}@${c.resolved.basis === 'snapshot' && c.resolved.snapshotId !== undefined ? c.resolved.snapshotId : c.resolved.basis}`))]
    const staleFlag =
      cellCosts.some(
        (c) => c.resolved.basis === 'unpriced' || c.resolved.basis === 'models-yaml' || (c.resolved.staleDays ?? 0) > 0,
      ) || cells.length === 0
    const fired = firedKeys(deps.ledger.queryEvents({ company: deps.company }))
    let firedNow = 0

    const fire = (
      scope: string,
      issueForEvent: { issue: string; dept: string },
      tierName: string,
      runningUsd: number,
      budgetUsd: number,
      pct: number,
      attemptAnchor: number,
    ): void => {
      const dedupKey = `cost:${scope}:${period}:${tierName}`
      if (fired.has(dedupKey)) return
      if (emit === undefined) return // 无出口不落账（防意图丢失——SLA 源同款）
      const facts = {
        scope,
        period,
        tier: tierName,
        running_usd: Number(runningUsd.toFixed(4)),
        budget_usd: budgetUsd,
        pct: Number(pct.toFixed(1)),
        top_consumers: topConsumers.map((c) => ({ person: c.person, model: c.model, usd: Number(c.usd.toFixed(4)) })),
        price_snapshot_ref: priceSnapshotRef.join(','),
        stale_flag: staleFlag,
      }
      emit({
        kind: 'escalate',
        company: deps.company,
        ticket: issueForEvent.issue,
        payload: { class: 'cost-threshold', facts },
        source: COST_THRESHOLD_SOURCE_NAME,
        dedupKey,
        priority: 3, // escalate 高优（SLA 源同口径）
      })
      deps.ledger.appendEvent({
        id: makeId(now),
        ts: now,
        company: deps.company,
        issue: issueForEvent.issue,
        event: 'ESCALATE',
        actor: deps.actor ?? 'daemon',
        attempt: attemptAnchor,
        level: 1,
        dept: issueForEvent.dept,
        tokens: { input: 0 },
        note:
          `成本警戒：${scope} ${tierName} 档 ${facts.pct}%（$${facts.running_usd}/预算 $${budgetUsd}）` +
          `；src=${COST_THRESHOLD_SOURCE_NAME};scope=${scope};period=${period};tier=${tierName}` +
          `;stale=${staleFlag ? 1 : 0}`,
      })
      fired.add(dedupKey)
      firedNow += 1
      stats.fired += 1
      log(`[cost-threshold] ${scope} ${tierName} 档（${facts.pct}%）→ escalate 意图 + ESCALATE 落账`)
    }

    // 公司档：budget=company 日预算；running=Σ全员当日折算+Σ全员在途
    const companyRunning = cellCosts.reduce((s, c) => s + c.usd, 0) + [...reservedByPerson.values()].reduce((s, v) => s + v, 0)
    const companyReached = highestReachedTier(guard.alertTiers, companyRunning, guard.dailyBudgetUsd.company)
    if (companyReached !== undefined) {
      fire('company', { issue: deps.heartbeatIssue, dept: deps.deptFallback }, companyReached.tier.tier, companyRunning, guard.dailyBudgetUsd.company, companyReached.pct, 1)
    }

    // 人档：budget=人日预算（覆盖位??缺省）；running=本人当日折算+本人在途
    for (const p of people) {
      const budgetUsd = personDailyBudgetUsd(guard, p)
      const runningUsd = (settledByPerson.get(p.id) ?? 0) + (reservedByPerson.get(p.id) ?? 0)
      const reached = highestReachedTier(guard.alertTiers, runningUsd, budgetUsd)
      if (reached !== undefined) {
        fire(`person:${p.id}`, { issue: deps.heartbeatIssue, dept: p.dept }, reached.tier.tier, runningUsd, budgetUsd, reached.pct, 1)
      }
    }
    return { ts: now, date, checked: 1 + people.length, fired: firedNow }
  }

  return {
    name: COST_THRESHOLD_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      liveEmit = emit
      timer = setInterval(() => {
        try {
          poll()
        } catch (err) {
          stats.errors += 1
          log(`[cost-threshold] 轮询异常（已吞不炸循环）：${err instanceof Error ? err.message : String(err)}`)
        }
      }, deps.intervalMs)
      timer.unref()
    },
    stop(): void {
      running = false
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      liveEmit = undefined
    },
    poll,
    get stats(): CostThresholdSource['stats'] {
      return { ...stats }
    },
  }
}
