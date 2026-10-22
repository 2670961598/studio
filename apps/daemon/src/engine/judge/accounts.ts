/**
 * judge/accounts —— 判断调用预算面（studio-dev-160 §6.2 三帽 + R3-c 口径；单 164）
 *
 * 账目口径（提案 §6.2「预留不落即不派」的 judge 版；docs/16-§三 预算行三节点）：
 *   - scope 约定（**冒号分隔**——ULID 大写无冒号、site_id 注册闸禁冒号，三段无歧义；
 *     不用连字符：site_id 可含连字符，前缀过滤会撞）：
 *       每次调用  mj:<site>:<callId>    reserve(估算) + settle(估算, 实际) 双行
 *       日界标记  mj-day:<site>:<dayKey> reserve(址日帽全额) 每日一次 + 日界冲销 settle
 *     （冲销行 estimated=帽额、actual=当日实际合计——对齐 core/budget.ts settle 语义：
 *     settle 行冲销全部未结预留）。
 *   - scope_kind 恒 'company'：判断调用不是派工（无票/无人），挂 issue/person 投影会
 *     污染 foldBudgets 视图；公司日帽=Σ 全部 mj: 调用 settle 的 actual（ts 窗口过滤，
 *     mj-day: 行不含 'mj:' 前缀天然排除，不双计）。
 *   - 三帽事前闸的 refuse（estimate-over-cap/site-daily/company-daily）**不落预算行**
 *     （「不落账不派 judge 版」——可观测面走 JUDGE_FALLBACK 事件 note=reason）。这与
 *     任务派工面 refusal 行（DEV-132）刻意不同：judge 拒派不占派发预算命名空间，拟稿
 *     口径已呈报（§6.2 冻结面只列三行种：日界 reserve+每次 settle+日界冲销）。
 *   - 日界冲销时机=该址新日首唤起（顺扫既有未结 mj-day reserve→冲销；懒收口不设
 *     定时器——daemon 崩溃恢复后首唤起补冲销，append-only 台账幂等重放友好）。
 *   - 日历注入：dayKeyOf/windowOf（缺省 UTC——公司时区口径待配置面立单，红队 3 已
 *     呈报：日界口径是三帽正确性的参数，注入面已留）。
 *
 * 依据：docs/17-§3 budgets 列；store Ledger.appendBudget/listBudgets（ts 双端闭区间）；
 * docs/20-§六.8 预算链；studio-dev-160 §8-S6（成本会计口径）。
 */
import type { BudgetRecord, Ledger } from '@studio-next/store'
import type { JudgeCaps } from '@studio-next/core'

/** 日历口径（dayKey=自然日键；windowOf=该日 ts 闭区间两端） */
export interface JudgeCalendar {
  readonly dayKeyOf: (ts: number) => string
  readonly windowOf: (dayKey: string) => { startTs: number; endTs: number }
}

/** 缺省日历：UTC 自然日（dayKey=YYYYMMDD；公司时区配置面立单前先用 UTC——呈报项） */
export const UTC_JUDGE_CALENDAR: JudgeCalendar = {
  dayKeyOf: (ts) => {
    const d = new Date(ts)
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${d.getUTCFullYear()}${mm}${dd}`
  },
  windowOf: (dayKey) => {
    const y = Number(dayKey.slice(0, 4))
    const m = Number(dayKey.slice(4, 6))
    const d = Number(dayKey.slice(6, 8))
    const startTs = Date.UTC(y, m - 1, d)
    return { startTs, endTs: startTs + 86_399_999 }
  },
}

// ————————————————————————— scope 键（冒号三段；site 禁冒号由注册闸保证） —————————————————————————

/** site_id 合法性（账目键纪律：非空、不含冒号——含冒号即 scope 段歧义） */
export function validJudgeSiteId(site: string): boolean {
  return site.length > 0 && !site.includes(':')
}

/** 每次调用的 budget scope（reserve+settle 双行共用） */
export function judgeCallScope(site: string, callId: string): string {
  return `mj:${site}:${callId}`
}

/** 址日标记 scope（日 reserve + 日界冲销共用） */
export function judgeDayScope(site: string, dayKey: string): string {
  return `mj-day:${site}:${dayKey}`
}

// ————————————————————————— 花费查询（三帽事前闸的输入） —————————————————————————

/** 一日两口径花费：该址当日实际 / 公司当日实际（Σ settle.actual，ts 窗口+前缀过滤） */
export function judgeDaySpent(
  ledger: Ledger,
  input: { site: string; dayKey: string; calendar?: JudgeCalendar },
): { siteUsd: number; companyUsd: number } {
  const calendar = input.calendar ?? UTC_JUDGE_CALENDAR
  const { startTs, endTs } = calendar.windowOf(input.dayKey)
  const rows = ledger.listBudgets({ kinds: ['settle'], since: startTs, until: endTs })
  let siteUsd = 0
  let companyUsd = 0
  for (const row of rows) {
    // 'mj-day:…'.startsWith('mj:') 为 false——日标记行天然不进花费合计（无双计）
    if (row.scope_id.startsWith('mj:')) {
      companyUsd += row.actual_usd ?? 0
      if (row.scope_id.startsWith(`mj:${input.site}:`)) siteUsd += row.actual_usd ?? 0
    }
  }
  return { siteUsd, companyUsd }
}

// ————————————————————————— 行落账 —————————————————————————

function budgetRow(input: {
  id: string
  scopeId: string
  kind: BudgetRecord['kind']
  ts: number
  estimatedUsd?: number
  actualUsd?: number
}): BudgetRecord {
  const rec: BudgetRecord = {
    id: input.id,
    scope_kind: 'company',
    scope_id: input.scopeId,
    kind: input.kind,
    ts: input.ts,
  }
  if (input.estimatedUsd !== undefined) rec.estimated_usd = input.estimatedUsd
  if (input.actualUsd !== undefined) rec.actual_usd = input.actualUsd
  return rec
}

/** 每次调用预留行（launch 前落——「不落账不派」；同 id 幂等=重放安全） */
export function reserveJudgeCall(ledger: Ledger, input: {
  site: string
  callId: string
  estimatedUsd: number
  ts: number
  id: string
}): void {
  ledger.appendBudget(
    budgetRow({
      id: input.id,
      scopeId: judgeCallScope(input.site, input.callId),
      kind: 'reserve',
      ts: input.ts,
      estimatedUsd: input.estimatedUsd,
    }),
  )
}

/** 每次调用结算行（launch 后必落——成功/降级/超耗都落：真消耗真记账，actual=实际） */
export function settleJudgeCall(ledger: Ledger, input: {
  site: string
  callId: string
  estimatedUsd: number
  actualUsd: number
  ts: number
  id: string
}): void {
  ledger.appendBudget(
    budgetRow({
      id: input.id,
      scopeId: judgeCallScope(input.site, input.callId),
      kind: 'settle',
      ts: input.ts,
      estimatedUsd: input.estimatedUsd,
      actualUsd: input.actualUsd,
    }),
  )
}

/**
 * 址日簿记（新日首唤起时调）：①冲销该址一切**未结**日标记（懒收口——昨日帽额冲销、
 * actual=该日实际合计）②为当日落日 reserve（帽额全额——日帽预留语义）。已有当日
 * reserve 则只做①（幂等：跨拍重复调不重复落）。
 */
export function ensureJudgeSiteDay(ledger: Ledger, input: {
  site: string
  dayKey: string
  caps: JudgeCaps
  calendar?: JudgeCalendar
  ts: number
  makeId: (ts: number) => string
}): void {
  // ① 冲销历史未结日标记（顺扫 mj-day:<site>: 前缀；预算行量=派发量级，全扫可接受）；
  //    当日标记跳过——当日 reserve 是「开口在用」，收口只针对历史日（懒收口语义）
  const dayPrefix = `mj-day:${input.site}:`
  const seen = new Map<string, { reserved: boolean; settled: boolean }>()
  for (const row of ledger.listBudgets()) {
    if (!row.scope_id.startsWith(dayPrefix)) continue
    const dayKey = row.scope_id.slice(dayPrefix.length)
    const s = seen.get(dayKey) ?? { reserved: false, settled: false }
    if (row.kind === 'reserve') s.reserved = true
    if (row.kind === 'settle') s.settled = true
    seen.set(dayKey, s)
  }
  for (const [dayKey, s] of seen) {
    if (dayKey === input.dayKey) continue // 当日开口不收（收口=跨日首唤起触发）
    if (!s.reserved || s.settled) continue
    const { siteUsd } = judgeDaySpent(ledger, {
      site: input.site,
      dayKey,
      ...(input.calendar !== undefined ? { calendar: input.calendar } : {}),
    })
    ledger.appendBudget(
      budgetRow({
        id: input.makeId(input.ts),
        scopeId: judgeDayScope(input.site, dayKey),
        kind: 'settle',
        ts: input.ts,
        estimatedUsd: input.caps.perSiteDailyUsd,
        actualUsd: siteUsd,
      }),
    )
  }
  // ② 当日日 reserve（幂等：seen 已含当日则跳过）
  const today = seen.get(input.dayKey)
  if (today === undefined || !today.reserved) {
    ledger.appendBudget(
      budgetRow({
        id: input.makeId(input.ts),
        scopeId: judgeDayScope(input.site, input.dayKey),
        kind: 'reserve',
        ts: input.ts,
        estimatedUsd: input.caps.perSiteDailyUsd,
      }),
    )
  }
}
