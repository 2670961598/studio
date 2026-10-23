/**
 * sentinel —— 定时岗产出哨兵（127-A R1，studio-dev-127 §4.2 批示③全批：
 * 落点=summary.json 框架字段——结构化免解析）
 *
 * 契约语义（三层防御之第三层——R1-1 重构叙事后的管辖面）：
 *   - **管辖面**：工单型定时岗单（PATROL job= 锚、payload.type≠'patrol'——DISPATCH 面上
 *     有 worker 读任务书）。patrol 巡查工件无 worker——不注入不验证（岗型治理 4.1 让其
 *     诚实化为无产出义务）。
 *   - **nonce**：`sha256("<company>:<job_id>:<run_at>")` hex64；run_at=本槽 PATROL note
 *     `dedup=<job_id>@<run_at>` 的槽时刻——**调度侧事实源**（非 worker 自报），同槽复用/
 *     抄旧哨兵（run_at 不属本槽）结构性失配（红队 R1-2 采纳的机械落法）。
 *   - **下发**：engine.executeDispatch 任务书 L4 尾追加哨兵段（sentinelBriefBlock）——
 *     命令 worker 把三元组原样并入 summary.json 顶层 `sentinel` 字段（contract
 *     SummarySidecarSchema 框架字段，127-A 同批扩展）；位置容错（结构化无行位约束）。
 *   - **验证**：fail-closed 缺省——收割面 GATE_PASS note 尾缀观测（sentinel=ok|missing|
 *     mismatch|unreadable，不拦收割）；P3 对账步才是权威事件面（SENTINEL_MISSING，
 *     欠账不重派——批示⑤）。
 *   - **盲区诚实声明（127 §4.2）**：哨兵只证「真运行＋任务书被读到」，不证产出质量
 *     （C1 明示盲区）；质量侧翼=R4 最小内容门＋数据源断链首行声明义务（随哨兵段下发）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'

/** 哨兵三元组（worker 原样回写进 summary.json 顶层 sentinel 字段；contract 同形） */
export interface SentinelTriple {
  job: string
  run_at: number
  nonce: string
}

/** 哨兵验证态（收割观测 note / P3 事件分诊共用词表） */
export type SentinelStatus = 'ok' | 'missing' | 'mismatch' | 'unreadable'

/** 期望哨兵：nonce=sha256(company:job:run_at)——同司同岗同槽确定，异槽必异 */
export function expectedSentinel(company: string, job: string, runAt: number): SentinelTriple {
  return { job, run_at: runAt, nonce: createHash('sha256').update(`${company}:${job}:${runAt}`).digest('hex') }
}

/** PATROL note 的 job= 段（engine 物化口径——与 jobs-sources jobTickets/output-account 同形） */
export function patrolJobOfNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const m = /(?:^|;)job=([^;]+)/.exec(note)
  return m !== null ? (m[1] as string) : undefined
}

/** 岗 payload.type 读面（宽容读——不进 JobOps：type 是任务类型标签非运作规格段） */
function jobPayloadType(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const t = (payload as Record<string, unknown>).type
  return typeof t === 'string' && t !== '' ? t : undefined
}

/**
 * 哨兵义务判定（R1 管辖面收口）：PATROL job= 锚 + dedup 槽可解 + 岗在册 +
 * payload.type≠'patrol' → 期望三元组；否则 undefined=本单无哨兵义务
 * （普通单/patrol 巡查工件/唤醒单结构性不进——明跳过不误判）。
 */
export function sentinelDutyForTicket(ledger: Ledger, ticket: TicketId): SentinelTriple | undefined {
  const anchor = ticketSentinelAnchor(ledger, ticket)
  if (anchor === undefined) return undefined
  const job = ledger.getJob(anchor.jobId)
  if (job === undefined) return undefined
  if (jobPayloadType(job.payload) === 'patrol') return undefined
  return expectedSentinel(anchor.company, anchor.jobId, anchor.runAt)
}

/**
 * 单→哨兵锚复原：PATROL note `job=`＋`dedup=<job_id>@<runAt>` → {company, jobId, runAt}。
 * dedup 槽时刻不可解析（他源 PATROL/唤醒单/坏行）→ undefined=本单无哨兵义务（明跳过
 * 不误判——唤醒单 note 刻意不含 job=，结构性不进本面）。
 */
export function ticketSentinelAnchor(
  ledger: Ledger,
  ticket: TicketId,
): { company: string; jobId: string; runAt: number } | undefined {
  const patrol = ledger
    .queryEvents({ issue: ticket })
    .find((e) => e.event === 'PATROL' && patrolJobOfNote(e.note) !== undefined)
  const jobId = patrol !== undefined ? patrolJobOfNote(patrol.note) : undefined
  if (patrol === undefined || jobId === undefined) return undefined
  // dedup 槽形=<job_id>@<runAt>（scheduler.ts:200 同源）——取 @ 后段并核前缀归属，
  // 他形（sched:xx:1 旧测试语料/唤醒单自拟键）= 不可解 → 无哨兵义务（明跳过不误判）
  const m = /(?:^|;)dedup=([^;]+)/.exec(patrol.note ?? '')
  if (m === null) return undefined
  const dedup = m[1] as string
  const at = dedup.lastIndexOf('@')
  if (at <= 0 || dedup.slice(0, at) !== jobId) return undefined
  const runAt = Number.parseInt(dedup.slice(at + 1), 10)
  if (!Number.isFinite(runAt) || runAt <= 0) return undefined
  return { company: patrol.company, jobId, runAt }
}

/** 哨兵三元组是否形状齐（nonce=64hex——与 contract SummarySidecarSchema.sentinel 同规） */
function isTripleShape(v: unknown): v is SentinelTriple {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.job === 'string' && r.job !== '' &&
    typeof r.run_at === 'number' && Number.isInteger(r.run_at) && r.run_at >= 0 &&
    typeof r.nonce === 'string' && /^[0-9a-f]{64}$/.test(r.nonce)
  )
}

/**
 * sidecar 哨兵核验（fail-closed 缺省：一切「读不到/解析不出」面如实归类，不静默放行）：
 *   undefined/空文 → missing（sidecar 缺）；JSON 解析失败 → unreadable；
 *   sentinel 字段缺/形状坏 → missing；三元组异 → mismatch（抄旧槽必落此档）。
 */
export function verifySidecarSentinel(sidecarText: string | undefined, expected: SentinelTriple): SentinelStatus {
  if (sidecarText === undefined || sidecarText.trim() === '') return 'missing'
  let parsed: unknown
  try {
    parsed = JSON.parse(sidecarText)
  } catch {
    return 'unreadable'
  }
  if (typeof parsed !== 'object' || parsed === null) return 'unreadable'
  const sentinel = (parsed as Record<string, unknown>).sentinel
  if (!isTripleShape(sentinel)) return 'missing'
  return sentinel.job === expected.job && sentinel.run_at === expected.run_at && sentinel.nonce === expected.nonce
    ? 'ok'
    : 'mismatch'
}

/** 路径面核验（收割观测/P3 对账共用）：文件不可读→unreadable（stat 兜底语义——如实暴露） */
export function verifySidecarSentinelAtPath(sidecarPath: string | undefined, expected: SentinelTriple): SentinelStatus {
  if (sidecarPath === undefined) return 'missing'
  let text: string
  try {
    text = readFileSync(sidecarPath, 'utf8')
  } catch {
    return 'unreadable'
  }
  return verifySidecarSentinel(text, expected)
}

/**
 * 任务书 L4 哨兵注入段（executeDispatch 组装产物之后追加——与 wkey 指引行同位：
 * per-attempt 操作面，不进六层组装器）。含数据源断链首行声明义务句（127 §4.1/红队 7-3：
 * 义务面随任务书送达；正文机械核验归 B 面单后续——本单只注入不宣称已验）。
 *
 * studio-dev-216 写读对齐：注入文本必须与读面（gate.ts 工位发现 → accountJobOutput
 * 随件归档 → P3 哨兵门读 `<归档名>.summary.json`）**逐字对齐到落点**——212 实证「工位
 * summary.json」无路径限定时 worker 会按 deliverables/ 惯例落位（任务书验收命令常含
 * deliverables/plan.md），gate 只认与 REPORT.md 同目录的正位 → 归档侧车缺 → 误报
 * SENTINEL_MISSING（unreadable）。故注入段明示正位＝docs/17-§6「REPORT 旁落」。
 */
export function sentinelBriefBlock(sent: SentinelTriple): string {
  return [
    '',
    '## 定时岗产出哨兵（必写收尾项——studio-dev-127 §4.2）',
    '',
    '本单为定时岗工单。收尾时把下面的对象**原样并入工位 `summary.json` 的顶层 `sentinel` 字段**',
    '（文件落点＝**工位根目录、与 REPORT.md 同目录**——docs/17-§6「REPORT 旁落」；不是 deliverables/ 子目录，',
    '也不另起文件名；与 conclusion / changed_files 平级的框架字段；不改键名、不改值、不省略）：',
    '',
    '```json',
    `{"sentinel":{"job":${JSON.stringify(sent.job)},"run_at":${sent.run_at},"nonce":${JSON.stringify(sent.nonce)}}}`,
    '```',
    '',
    '- 该字段由 P3 对账步核验：缺失/改值/沿用旧槽（run_at 不属于本槽）→ SENTINEL_MISSING（欠账，不重派）。',
    '- 若本岗产物依赖台账/数据源聚合面，且聚合面全 0 或断链：REPORT.md 首行必须声明「数据源断链」状态。',
    '- 诚实边界：哨兵只证真运行与任务书被读到，不证产出质量。',
    '',
  ].join('\n')
}
