/**
 * pricing —— 定价面 daemon 消费步（132-§6.2 单B·studio-dev-169；P4/P5 批示载体）
 *
 * 两个引擎缝的体（engine.ts 只留相位缝——hrsync 同款关注点分离）：
 *
 * 1. consumePricingPublish（收割相位 GATE_PASS 后置步，accountJobOutput 同缝）：
 *    type='pricing' 标准单据（HF-1 每晨发布，P5）的附件 deliverables/pricing.yaml →
 *    解析（core.parsePricingTable）→ 覆盖校验（validatePricingTable ⊇ models.yaml 三档）
 *    → 逐行 appendPriceSnapshot（source_ticket=单号锚，S7）。四要件冻结口径不动
 *    （docs/17-§6）；**消费失败不回滚收割**——DAILY_ALARM 唤醒 HF-1 不静默，note 后缀
 *    留痕。日内紧急调价=同流程独立定价单（132-§6.2；同日=version+1 新行）。
 *
 * 2. runPricingStaleCheck（相位 7 尾日锚步，hrSync drain 同缝）：本地日 10:00 后首拍
 *    跑（晨间发布窗 09:30 之后——132-§6.2 时间线）；kv 日锚 daemon_kv
 *    'pricing.stale_check_date' 一日一跑；stale≥2 或从未定价 → DAILY_ALARM（挂心跳
 *    哨兵单，events.issue 必填契约）。幂等零内存态：已告集从 DAILY_ALARM note 派生
 *    （`src=pricing-stale;model=…;date=…`，docs/22-§三.2 sla-timer 源同型——崩溃重放
 *    不双告，告警后 kv 写锚前崩=重跑时事件派生集命中跳过）。
 *
 * 事件词表零新增（17-§3 冻结）：stale/发布失败=DAILY_ALARM（既有名，此前无生产者）；
 * 发布成功=定价单自身 GATE_PASS note 后缀+快照行单据号锚（不双源——快照表即台账）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parsePricingTable,
  pricingStaleReport,
  validatePricingTable,
  type DeclaredModel,
  type PricingTable,
} from '@studio-next/core'
import type { Ledger } from '@studio-next/store'

/** 定价单据 type 值（建单侧声明 type='pricing'；本面只认值不建单——编排归 HF-1 岗） */
export const PRICING_TICKET_TYPE = 'pricing'

/** stale 检查时刻（本地时，晨间发布窗 09:30 后；拟稿待批——plan.md §4） */
export const PRICING_STALE_CHECK_HOUR = 10

/** stale 检查 kv 日锚键（daemon_kv；值=已跑的本地日 'YYYY-MM-DD'） */
export const PRICING_STALE_CHECK_DATE_KEY = 'pricing.stale_check_date'

/** 已告 note 派生前缀（幂等键语源；docs/22-§三.2） */
const STALE_ALARM_PREFIX = 'src=pricing-stale;'

/** 本地日串 'YYYY-MM-DD'（晨间窗为本地业务时间——reportFileName 同口径取本地字段） */
function localDateString(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 定价单消费步入参（engine finalizeHarvest 缝的全部依赖；emitAlarm 由引擎侧闭包 makeEvent） */
export interface PricingConsumeDeps {
  ledger: Ledger
  /** 定价单号（快照行 source_ticket 锚） */
  ticket: string
  /** IssueRecord.type——非 'pricing' 即零行为（普通单不受影响） */
  issueType: string | undefined
  /** worker 工作区（附件在 <workspace>/deliverables/pricing.yaml） */
  workspace: string
  company: string
  /** 收割 worker 工号（published_by——发布责任人） */
  personId: string
  /** models.yaml 三档声明面（catalog 缺席=态 B：跳过覆盖校验，note 如实降级） */
  declared: readonly DeclaredModel[] | undefined
  now(): number
  makeId(ts: number): string
  /** 发布失败告警（DAILY_ALARM，挂定价单） */
  emitAlarm(note: string): void
  onError(message: string): void
}

export interface PricingConsumeResult {
  /** GATE_PASS note 后缀（''=非定价单；';pricing=…' 成功；';pricing-err=…' 失败） */
  noteSuffix: string
  appended: number
}

/** note 截断（events.note 面板可读性；细节全量在 err.detail/onError 上报表） */
function brief(text: string, max = 200): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** 分类错误 → 摘要（CONFIG_INVALID 的 detail 带行号定位，取 subcause+首 issue） */
function errBrief(err: unknown): string {
  if (err instanceof Error) {
    const sub = (err as { subcause?: string }).subcause
    return sub !== undefined ? `${sub}：${brief(err.message)}` : brief(err.message)
  }
  return brief(String(err))
}

/** 附件读取+解析+校验（发布失败三源的公共收口：读不到/解析坏/覆盖缺） */
function loadPricingTable(deps: PricingConsumeDeps): PricingTable {
  const deliverable = path.join(deps.workspace, 'deliverables', 'pricing.yaml')
  let text: string
  try {
    text = readFileSync(deliverable, 'utf8')
  } catch {
    throw new Error(`定价单附件缺失（${path.join('deliverables', 'pricing.yaml')}——HF-1 每晨发布物）`)
  }
  const table = parsePricingTable(text)
  validatePricingTable(table, deps.declared)
  return table
}

/**
 * 定价更新单据化消费（GATE_PASS 后置步）。
 * 非定价单：noteSuffix='' 零行为。定价单：成功 append 逐行（ps-<ULID>；同日修订
 * version 自动+1），失败 DAILY_ALARM+pricing-err 后缀（收割结论不动）。
 */
export function consumePricingPublish(deps: PricingConsumeDeps): PricingConsumeResult {
  if (deps.issueType !== PRICING_TICKET_TYPE) return { noteSuffix: '', appended: 0 }
  let table: PricingTable
  try {
    table = loadPricingTable(deps)
  } catch (err) {
    const msg = errBrief(err)
    deps.onError(`定价发布失败 ${deps.ticket}：${msg}`)
    deps.emitAlarm(`src=pricing-publish;ticket=${deps.ticket}；定价发布失败：${msg}`)
    return { noteSuffix: `;pricing-err=${brief(msg, 120)}`, appended: 0 }
  }
  let appended = 0
  let firstVersion: number | undefined
  let lastVersion = 0
  for (const m of table.models) {
    for (const p of m.prices) {
      try {
        const r = deps.ledger.appendPriceSnapshot({
          id: `ps-${deps.makeId(deps.now())}`,
          company: deps.company,
          provider: m.provider,
          model: m.model,
          price_date: table.priceDate,
          slot: p.slot,
          input_per_m: p.inputPerM,
          output_per_m: p.outputPerM,
          ...(p.cacheReadPerM !== undefined ? { cache_read_per_m: p.cacheReadPerM } : {}),
          ...(p.cacheCreationPerM !== undefined ? { cache_creation_per_m: p.cacheCreationPerM } : {}),
          billing_track: m.billingTrack,
          ...(m.planMonthlyUsd !== undefined ? { plan_monthly_usd: m.planMonthlyUsd } : {}),
          source_note: table.sourceNote,
          source_ticket: deps.ticket,
          published_by: deps.personId,
        })
        if (r.appended) {
          appended += 1
          firstVersion = firstVersion === undefined ? r.version : firstVersion
          lastVersion = Math.max(lastVersion, r.version)
        }
      } catch (err) {
        // 单行落账失败=整单失败语义（半表入账=低估定时炸弹——core 覆盖校验同理由）；
        // 已入行不回滚（append-only 表无回滚面），如实告警+errors 上报，HF-1 重发新单
        const msg = errBrief(err)
        deps.onError(`定价快照落账失败 ${deps.ticket} ${m.provider}/${m.model} ${p.slot}：${msg}`)
        deps.emitAlarm(`src=pricing-publish;ticket=${deps.ticket}；快照落账失败 ${m.provider}/${m.model} ${p.slot}：${msg}`)
        return { noteSuffix: `;pricing-err=落账失败 ${brief(msg, 100)}`, appended }
      }
    }
  }
  const degraded = deps.declared === undefined ? '（态B：无 models.yaml，覆盖校验降级）' : ''
  return {
    noteSuffix: `;pricing=${String(appended)}行@${table.priceDate}v${String(firstVersion ?? 0)}..${String(lastVersion)}${degraded}`,
    appended,
  }
}

/** stale 检查步入参（engine 相位 7 尾缝；emitAlarm 挂心跳哨兵单） */
export interface PricingStaleDeps {
  ledger: Ledger
  company: string
  declared: readonly DeclaredModel[] | undefined
  now(): number
  emitAlarm(note: string): void
  onError(message: string): void
}

export interface PricingStaleTickReport {
  /** 本次检查归属本地日（未到窗/已跑=同日返回，checked=0） */
  date: string
  /** 报告覆盖模型数 */
  checked: number
  /** 本次新发 DAILY_ALARM 数（幂等去重后） */
  alarmed: number
}

/** 已告集派生：近 3 日本公司 DAILY_ALARM 中 src=pricing-stale 的 (model,date) 对 */
function alarmedKeys(ledger: Ledger, company: string, sinceMs: number): Set<string> {
  const keys = new Set<string>()
  for (const ev of ledger.queryEvents({ company, since: sinceMs })) {
    if (ev.event !== 'DAILY_ALARM' || ev.note === undefined || !ev.note.startsWith(STALE_ALARM_PREFIX)) continue
    const model = /model=([^;]+);/.exec(ev.note)?.[1]
    const date = /;date=(\d{4}-\d{2}-\d{2})/.exec(ev.note)?.[1]
    if (model !== undefined && date !== undefined) keys.add(`${model}|${date}`)
  }
  return keys
}

/**
 * 定价 stale 检查（相位 7 尾，一日一跑）：本地时 ≥10:00 且 kv 日锚≠今日 → 跑。
 * 告警条件（132-§6.2+P5）：连续 PRICING_STALE_ALARM_DAYS=2 日无当日快照（沿用已达
 * 2 日）或从未定价（连沿用都无）。幂等=事件 note 派生集+kv 日锚双层。
 */
export function runPricingStaleCheck(deps: PricingStaleDeps): PricingStaleTickReport {
  const at = deps.now()
  const date = localDateString(at)
  const hour = new Date(at).getHours()
  if (hour < PRICING_STALE_CHECK_HOUR) return { date, checked: 0, alarmed: 0 }
  if (deps.ledger.kvGet(PRICING_STALE_CHECK_DATE_KEY) === date) return { date, checked: 0, alarmed: 0 }
  try {
    const rows = deps.ledger.listPriceSnapshots({ company: deps.company })
    const entries = pricingStaleReport(rows, deps.declared, date)
    const seen = alarmedKeys(deps.ledger, deps.company, at - 3 * 86_400_000)
    let alarmed = 0
    for (const e of entries) {
      const modelKey = `${e.provider}/${e.model}`
      const stale = e.staleDays === undefined ? 'never' : String(e.staleDays)
      const note = `${STALE_ALARM_PREFIX}model=${modelKey};date=${date};stale=${stale}${e.declared ? '' : ';declared=no(在册)'}`
      if (!e.alarm || seen.has(`${modelKey}|${date}`)) continue
      deps.emitAlarm(note)
      alarmed += 1
    }
    deps.ledger.kvSet(PRICING_STALE_CHECK_DATE_KEY, date)
    return { date, checked: entries.length, alarmed }
  } catch (err) {
    // 检查面自身故障如实上报（不写 kv 锚——下一拍重试；告警不发——检查故障≠价格 stale）
    deps.onError(`定价 stale 检查失败：${errBrief(err)}`)
    return { date, checked: 0, alarmed: 0 }
  }
}
