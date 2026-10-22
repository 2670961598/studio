/**
 * perf —— 绩效五指标聚合件（130-P4，studio-dev-175；130-提案 §6.6——制作人 2026-10-22
 * 全批，批示⑥ 口径冻结；F2-08 口径版本化：消费侧 caliber 戳=`perf/v1`）。
 *
 * 定位（单一实现，三方消费）：面板部长视图（panel→store 合法边）／perf-weekly 报表管线
 * （company→store 合法边）／测试——**同一纯函数＝S9「面板/perf 报表从台账复算一致」
 * （130-提案 §8-S9，判负线=复算不一致）由单源结构性保证**。实形=纯函数聚合（非字面
 * GROUP BY SQL）：归属律（见下）在 SQL 需窗函数绕行，且复制两份实现才是复算漂移之源
 * （本单 plan §2 落位说明）。
 *
 * 只读投影纪律（130-提案 §6.6：只投影不裁决）：本件零写入、零 Date.now——窗界由调用方
 * 注入；数字全部来自台账读面（events / work_records），无自评字段。
 *
 * 五指标口径（批示⑥ 冻结；caliber=perf/v1 载于消费侧快照）：
 *   - 闸过率 gateRate = GATE_PASS/(GATE_PASS+GATE_FAIL)（分母=PASS+FAIL；零分母→null 如实）；
 *   - 打回 rejections = GATE_FAIL+QA_BACK+RESUME（**实现岗口径**——提案打回＝批示:打回
 *     评论（130-P0 归一层域）计提案质量不计个人，不进本指标：分计纪律照批示⑥）；
 *   - 完成时延 durations→P50/P90：work_records 中 ended_at 落窗者逐 attempt 计
 *     （ended−started；重试成本如实叠加；零样本→null）；在途（ended 空）不计（账未收）；
 *   - 证据完备度 harvestHits = HARVEST_INCOMPLETE+HARVEST_DENIED+HARVEST_INVALID 计数
 *     （17-§6 收账对账相位事件，「零命中」为独立判读列）；reportRate = REPORT 落盘率
 *     = GATE_PASS/(GATE_PASS+harvestHits)（过闸即四要件含 REPORT 落盘——17-§6）；
 *     REPORT_MISSING 归档搬运缺陷（100-P3 收账对账）不计个人证据面；
 *   - 工时成本 hours/cost/tokens：work_records 逐 attempt Σ（失败尝试也计=真实成本观，
 *     与月报工时同律）。
 *
 * 归属律（与月报 delivered 归属同一律——reports.ts §口径；S9 复算一致的前提）：
 *   - 事件归属人＝该单**最近一条** work_record 的人（按 started_at 取最新，同刻按 id
 *     稳定序；跨窗 work_record 也参与归属判定——「谁干的」与「何时收账」分离）；
 *   - 无工作记录→UNATTRIBUTED_PERSON 诚实桶（保留名，不臆造）；
 *   - 工时面直接按 work_records.person_id（记录的人）；
 *   - 全零行不产出（报表是账目不是名册）。
 */
import type { EventRecord } from '@studio-next/contract'
import type { WorkRecord } from './records.ts'

/** 事件归属诚实桶（月报 delivered 同名保留桶——reports.ts UNATTRIBUTED_PERSON 同律） */
export const UNATTRIBUTED_PERSON = '(unattributed)'

/** perf 聚合的事件计数五桶＋派生读数输入（GATE/QA/HARVEST 命中面） */
export interface PerfEventCounts {
  gate_pass: number
  gate_fail: number
  qa_back: number
  resume: number
  harvest_incomplete: number
  harvest_denied: number
  harvest_invalid: number
}

/** 人员绩效行（聚合最底层；数字全台账——面板/报表/测试三方同源消费的最小形状） */
export interface PerfPersonRow {
  person_id: string
  events: PerfEventCounts
  /** ended 落窗的 work_records 条数（attempt 逐条） */
  attempts: number
  /** Σ(ended_at−started_at)，epoch ms */
  hours_ms: number
  /** Σ work_records.cost_usd（收割侧账目；缺省计 0） */
  work_cost_usd: number
  /** Σ work_records.tokens（executor 归一三字段全加总；缺省计 0） */
  work_tokens_total: number
  /** 逐 attempt 时延 ms（原始序——P50/P90 由 perfPercentile 现算，行内不冗余存分位） */
  durations_ms: number[]
}

/** 聚合输入（窗界与数组均由调用方注入：公司过滤归调用方——月报同款纪律） */
export interface PerfAggregationInput {
  since: number
  until: number
  events: readonly EventRecord[]
  workRecords: readonly WorkRecord[]
}

const EMPTY_COUNTS: PerfEventCounts = {
  gate_pass: 0,
  gate_fail: 0,
  qa_back: 0,
  resume: 0,
  harvest_incomplete: 0,
  harvest_denied: 0,
  harvest_invalid: 0,
}

/** 计入 perf 的事件名闭集（批示⑥ 冻结五指标的事件面；词表=17-§3 冻结枚举既有名，零新名） */
const COUNTED_EVENTS = new Set(['GATE_PASS', 'GATE_FAIL', 'QA_BACK', 'RESUME', 'HARVEST_INCOMPLETE', 'HARVEST_DENIED', 'HARVEST_INVALID'])

/** work_records.tokens（TokenCounts 五字段全加总，读侧认旧账别名 cached；缺省字段计 0——如实不臆造） */
function tokensTotal(tokens: WorkRecord['tokens']): number {
  if (tokens === undefined || tokens === null) return 0
  return (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cache_read ?? 0) + (tokens.cache_creation ?? 0) + (tokens.cached ?? 0)
}

/**
 * 五指标聚合（纯函数）：事件按「单→最近 work_record」归属人计数；工时面按记录的人。
 * 行序=person_id 升序（全序确定性）；全零行不产出。
 */
export function perfPersonRows(input: PerfAggregationInput): PerfPersonRow[] {
  const byPerson = new Map<string, PerfPersonRow>()
  const ensure = (personId: string): PerfPersonRow => {
    let row = byPerson.get(personId)
    if (row === undefined) {
      row = { person_id: personId, events: { ...EMPTY_COUNTS }, attempts: 0, hours_ms: 0, work_cost_usd: 0, work_tokens_total: 0, durations_ms: [] }
      byPerson.set(personId, row)
    }
    return row
  }

  // 归属索引：issue → 最近一条 work_record（全量参与判定，不受窗界限制——「谁干的」与
  // 「何时收账」分离，月报 delivered 同律）。同 started_at 按 id 升序取大者（稳定序）。
  const latestWorkByIssue = new Map<string, WorkRecord>()
  for (const w of input.workRecords) {
    const cur = latestWorkByIssue.get(w.issue)
    if (cur === undefined || w.started_at > cur.started_at || (w.started_at === cur.started_at && w.id > cur.id)) {
      latestWorkByIssue.set(w.issue, w)
    }
  }

  // ① 事件面：ts 落窗（闭区间）且事件名计入闭集 → 按单归属人计数
  for (const e of input.events) {
    if (e.ts < input.since || e.ts > input.until) continue
    if (!COUNTED_EVENTS.has(e.event)) continue
    const latest = latestWorkByIssue.get(e.issue)
    const row = ensure(latest === undefined ? UNATTRIBUTED_PERSON : latest.person_id)
    switch (e.event) {
      case 'GATE_PASS':
        row.events.gate_pass += 1
        break
      case 'GATE_FAIL':
        row.events.gate_fail += 1
        break
      case 'QA_BACK':
        row.events.qa_back += 1
        break
      case 'RESUME':
        row.events.resume += 1
        break
      case 'HARVEST_INCOMPLETE':
        row.events.harvest_incomplete += 1
        break
      case 'HARVEST_DENIED':
        row.events.harvest_denied += 1
        break
      case 'HARVEST_INVALID':
        row.events.harvest_invalid += 1
        break
      default:
        break // 闭集已滤，不可达
    }
  }

  // ② 工时面：ended_at 落窗者逐 attempt 计（在途不计；失败尝试也计=真实成本观）
  for (const w of input.workRecords) {
    if (w.ended_at === undefined || w.ended_at === null) continue
    if (w.ended_at < input.since || w.ended_at > input.until) continue
    const row = ensure(w.person_id)
    row.attempts += 1
    const dur = Math.max(0, w.ended_at - w.started_at)
    row.hours_ms += dur
    row.durations_ms.push(dur)
    row.work_cost_usd += w.cost_usd ?? 0
    row.work_tokens_total += tokensTotal(w.tokens)
  }

  const rows = [...byPerson.values()].filter((r) => !isZeroRow(r))
  return rows.sort((a, b) => (a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : 0))
}

/** 全零行判（报表是账目不是名册——无台账活动的人不上 perf 面） */
function isZeroRow(r: PerfPersonRow): boolean {
  const c = r.events
  return (
    c.gate_pass === 0 &&
    c.gate_fail === 0 &&
    c.qa_back === 0 &&
    c.resume === 0 &&
    c.harvest_incomplete === 0 &&
    c.harvest_denied === 0 &&
    c.harvest_invalid === 0 &&
    r.attempts === 0
  )
}

// —— 派生读数（单一实现；快照/面板/测试三方直调，杜绝各自换算漂移） ——

/** 打回次数（批示⑥ 实现岗口径：GATE_FAIL+QA_BACK+RESUME） */
export function rejectionCount(row: Pick<PerfPersonRow, 'events'>): number {
  return row.events.gate_fail + row.events.qa_back + row.events.resume
}

/** HARVEST_* 命中数（17-§6 收账对账相位事件；「零命中」独立判读列） */
export function harvestHits(row: Pick<PerfPersonRow, 'events'>): number {
  return row.events.harvest_incomplete + row.events.harvest_denied + row.events.harvest_invalid
}

/** 闸过率（分母=PASS+FAIL，批示⑥；零分母→null 如实——不臆造 0/1） */
export function gateRate(row: Pick<PerfPersonRow, 'events'>): number | null {
  const denom = row.events.gate_pass + row.events.gate_fail
  return denom === 0 ? null : row.events.gate_pass / denom
}

/** REPORT 落盘率（GATE_PASS/(PASS+HARVEST 命中)；零分母→null 如实） */
export function reportRate(row: Pick<PerfPersonRow, 'events'>): number | null {
  const denom = row.events.gate_pass + harvestHits(row)
  return denom === 0 ? null : row.events.gate_pass / denom
}

/**
 * 时延分位（nearest-rank 口径：升序取第 ⌈p·n⌉ 位——小样本可复算、无插值臆造；
 * P50/P90=perf/v1 冻结口径）。零样本→null。
 */
export function perfPercentile(durationsMs: readonly number[], p: number): number | null {
  if (durationsMs.length === 0) return null
  if (durationsMs.length === 1) return durationsMs[0] ?? null
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(p * sorted.length))
  return sorted[rank - 1] ?? null
}
