/**
 * jobs-sources —— 岗位运作规格两新唤起源（docs/35-§3 首刀，制作人 2026-10-19 批复；
 * docs/22-§一/§二 源注册表接入；docs/25-§3.4 v1.4 kind='escalate'）
 *
 * 两源定位（35-§3 要点①②：「全部折算成 InvokeIntent 走既有主循环」——源零直驱）：
 *
 * 1. **cadence 档位展开器**（name='cadence'，manifest kind='schedule'）：
 *    公司目录 triggers.cadence 档位岗（装载期已由 company 包展开成真 cron——validator
 *    toJobs / src/cadence.ts）在本源收口调度表生命周期：start=展开播种（幂等 upsert、
 *    既有 next_run_at 保留——重启不清欠账，与 seedJobs 同语义）、周期刷新（jobs getter
 *    面向公司目录热更：档位变更→cron 覆写、岗撤→removeJob）、stop=移除自播种行
 *    （**启停源即启停档位岗**——daemon.yaml cadence 开关的语义落点）。
 *    意图不由本源直产——复用既有调度器 tick（18-§三）：档位岗进 jobs 表后与 cron 直写岗
 *    同链到点→scheduleIntent→engine.ingest（「不新造轮子」的结构性保证）。
 *    所有权边界：只动 payload 带 cadence_tier 的岗（parseJobOps 选岗）与自播种集——
 *    cron 直写岗（seedJobs 播种面）零触碰。
 *
 * 2. **SLA/升级计时器**（name='sla-timer'，manifest kind='escalate'）：
 *    tick 驱动扫在途单（台账 events 读面）：岗单据（PATROL 物化，note 携 job=）的
 *    当前派发窗（最近一次 DISPATCH 为锚）超 job 的 sla/escalate 档而未应答 → 产
 *    kind='escalate' 意图（payload 携单号+超时档+开窗/到点时刻，35-§4「升级唤起附原单
 *    上下文」的意图面）+ **ESCALATE 事件落账**（本刀「只产意图+落账」——notify 链发送
 *    归 notify 端口后续刀，35-§2 缺口表「升级链」的执行边界）。
 *    幂等（同单同档只告一次）：**零内存态**——已告集从本源 ESCALATE 事件 note 派生
 *    （note 携 src=sla-timer;anchor=<DISPATCH 事件 id>;tier=<档>），重启天然恢复
 *    （可重建投影的调度面同款推论：状态全在 events）。
 *    状态推进重置：锚后出现应答事件（ack 白名单=worker/流程推进类）即关窗；新 DISPATCH
 *    开新窗（新 anchor id=新幂等键位）——「推进后重置」的结构性落点。
 *
 * 语义口径（本文件冻结，测试逐条钉死）：
 *   - **在途单**：有 PATROL（→job_id 映射）且有 DISPATCH；最近 DISPATCH（锚）之后无
 *     应答事件。CLOSE 后不再升级（终态）。
 *   - **ack 白名单**（锚后任一即视为已应答——「first-ack 首响」的判定面）：
 *     LLM / GATE_PASS / GATE_FAIL / QA_PASS / QA_BACK / MERGE / CLOSE / APPROVE / RESUME /
 *     SELF_EVAL（23 冻结事件名的 worker/流程推进子集）。**非白名单=不应答**：ESCALATE
 *     （本源产物不计应答）、STALL（静默告警恰是要升级的信号）、HEARTBEAT（拍级哨兵）、
 *     PATROL（物化）、其余观测/框架事件（QUARANTINE/DAILY_ALARM/CIRCUIT_BREAK/GW_ 前缀族等）。
 *     未知未来事件名缺省=不应答（宁可多升级可见，不做静默漏报——失败方向声明）。
 *   - **档位序**：first-ack（payload.sla.first_ack_ms）→ escalate 链逐档
 *     （payload.escalate[i].after_ms，tier='chain-<i>'，payload.unacked=notify 目标透传）。
 *     各档独立计时独立幂等（同锚同档只告一次；35-§3 例 sla 15m + 链 15m/1h = 三档）。
 *     resolve-hint 本刀只解析不执行（办结 SLA 双表归后续刀——35-§6.3 待批示项）。
 *   - **SLA 规则来源**：jobs 表 payload（company 包 toJobs 构造、parseJobOps 读回）——
 *     岗级 SLA 只作用于该岗的岗单据。**普通单（无 job 映射）与值守订阅路由
 *     （oncall/subscribe，35-§3 qa-oncall 例）下刀**——本刀 SLA 面限于定时岗单据。
 *   - **emit 抛错=源缺陷**：25-§3.4.5 裁决同款——轮询体自我捕获（计数+日志+继续），
 *     注册表侧 safeEmit 兜底为第二道（sources.ts）。
 *   - **ESCALATE 事件形状**：actor='daemon'（config.actor 同款）、attempt=锚 DISPATCH
 *     attempt、level/dept 取 job 行、tokens={input:0}（无计量零值桶——events schema 口径）。
 */
import type { EventRecord, InvokeIntent, InvokeSource, ScheduledJob, SourceManifest } from '@studio-next/contract'
import { parseJobOps } from '@studio-next/company'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from './tools/id.ts'
import { nextRunAt } from './scheduler.ts'

// ————————————————————————— 源名与 manifest（22-§二 内置源表延伸行） —————————————————————————

/** cadence 档位展开器源名 */
export const CADENCE_SOURCE_NAME = 'cadence'

/** SLA/升级计时器源名 */
export const SLA_SOURCE_NAME = 'sla-timer'

export const CADENCE_SOURCE_MANIFEST: SourceManifest = {
  name: CADENCE_SOURCE_NAME,
  kind: 'schedule',
  configSchema: 'daemon.yaml cadence（档位岗调度表生命周期源——播种/刷新/移除）',
}

export const SLA_SOURCE_MANIFEST: SourceManifest = {
  name: SLA_SOURCE_NAME,
  kind: 'escalate',
  configSchema: 'daemon.yaml sla（SLA/升级计时器——扫描轮询复用 jobPollMs）',
}

// ————————————————————————— cadence 档位展开器 —————————————————————————

/** cadence 源依赖 */
export interface CadenceSourceDeps {
  ledger: Ledger
  clock: () => number
  /** 档位岗清单 getter（面向公司目录热更——serve 侧闭包 snapshot.jobs，快照重装载即刷新） */
  jobs: () => readonly ScheduledJob[]
  /** 刷新轮询间隔 ms */
  intervalMs: number
  /** 坏 cron 隔离窗 ms（缺省 60 分钟——与 scheduler/seedJobs 同缺省） */
  quarantineMs?: number
  log?: (line: string) => void
}

/** cadence 源单次展开报告（观测/测试断言） */
export interface CadenceReport {
  ts: number
  /** 本拍档位岗数（getter 选出） */
  cadenceJobs: number
  /** 新播种数（jobs 表原无行） */
  seeded: number
  /** 既有行保留数（next_run_at 原样——欠账不清） */
  kept: number
  /** 撤岗移除数（自播种集内有、本拍展开集无） */
  removed: number
}

/** cadence 源句柄：InvokeSource 端口 + 手动泵（expand，测试/显式驱动）+ 计数 */
export interface CadenceSource extends InvokeSource {
  /** 手动泵：立即展开一轮（start 前后皆可——与 fs/check 同为测试面），返回报告 */
  expand(): CadenceReport
  readonly stats: { expansions: number; seeded: number; removed: number }
}

/**
 * createCadenceSource —— 档位岗的调度表生命周期源。
 * 播种语义同 seedJobs（新岗 next_run_at=cron 下槽不立即抢跑；既有行保留 next_run_at）；
 * 刷新语义=upsert 覆写（档位/at 变更→新 cron 下拍生效）；移除语义=只动自播种集
 * （stop 也走移除——启停源即启停档位岗）。
 */
export function createCadenceSource(deps: CadenceSourceDeps): CadenceSource {
  const log = deps.log ?? ((): void => undefined)
  const quarantineMs = deps.quarantineMs ?? 60 * 60_000
  const stats = { expansions: 0, seeded: 0, removed: 0 }
  const owned = new Set<string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  function expand(): CadenceReport {
    const now = deps.clock()
    const cadenceJobs = deps.jobs().filter((j) => parseJobOps(j.payload).cadence !== undefined)
    const current = new Set(cadenceJobs.map((j) => j.job_id))
    let seeded = 0
    let kept = 0
    for (const job of cadenceJobs) {
      const existing = deps.ledger.getJob(job.job_id)
      let next: number
      if (existing !== undefined) {
        next = existing.next_run_at // 欠账不清：首拍补跑归调度器 coalesce（18-§三）
        kept += 1
      } else {
        try {
          const computed = nextRunAt(job.cron, now)
          next = computed === null ? now + quarantineMs : computed
        } catch {
          next = now + quarantineMs // 坏 cron 隔离窗（调度器会再计数+推后）
        }
      }
      deps.ledger.upsertJob({
        job_id: job.job_id,
        company: job.company,
        dept: job.dept,
        cron: job.cron, // 装载期已展开的真 cron（company toJobs——本源零解析）
        role: job.role,
        level: job.level,
        model_tier: job.model_tier,
        ...(job.budget_cap !== undefined ? { budget_cap: job.budget_cap.usd } : {}),
        ...(job.payload !== undefined ? { payload: job.payload } : {}),
        next_run_at: next,
      })
      owned.add(job.job_id)
      if (existing === undefined) seeded += 1
    }
    // 撤岗移除：自播种集中不在本拍展开集的行（公司目录热更面）
    let removed = 0
    for (const id of [...owned]) {
      if (!current.has(id)) {
        deps.ledger.removeJob(id)
        owned.delete(id)
        removed += 1
      }
    }
    stats.expansions += 1
    stats.seeded += seeded
    stats.removed += removed
    const report = { ts: now, cadenceJobs: cadenceJobs.length, seeded, kept, removed }
    log(`[cadence] 展开：档位岗 ${cadenceJobs.length}（新播 ${seeded} / 保留 ${kept} / 移除 ${removed}）`)
    return report
  }

  return {
    name: CADENCE_SOURCE_NAME,
    start(_emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      expand() // 启动即播种（注册即生效面）
      timer = setInterval(() => {
        try {
          expand()
        } catch (err) {
          log(`[cadence] 刷新异常（已吞不炸循环）：${err instanceof Error ? err.message : String(err)}`)
        }
      }, deps.intervalMs)
      timer.unref()
    },
    stop(): void {
      running = false
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      // 启停即启停岗：移除自播种行（cron 直写岗零触碰——所有权边界）
      let removed = 0
      for (const id of [...owned]) {
        deps.ledger.removeJob(id)
        owned.delete(id)
        removed += 1
      }
      if (removed > 0) log(`[cadence] 停源移除自播种档位岗 ${removed} 行`)
    },
    expand,
    get stats(): { expansions: number; seeded: number; removed: number } {
      return { ...stats }
    },
  }
}

// ————————————————————————— SLA/升级计时器 —————————————————————————

/** ack 白名单（锚后任一即关窗——「first-ack 首响」判定面，口径见文件头注） */
const ACK_EVENTS: ReadonlySet<string> = new Set([
  'LLM',
  'GATE_PASS',
  'GATE_FAIL',
  'QA_PASS',
  'QA_BACK',
  'MERGE',
  'CLOSE',
  'APPROVE',
  'RESUME',
  'SELF_EVAL',
])

/** 计时档（first-ack + escalate 链逐档；各档独立计时独立幂等） */
interface SlaTier {
  tier: string
  afterMs: number
  /** notify 目标（escalate 链档透传；first-ack 档无——发送归 notify 端口后续刀） */
  unacked?: string
}

/** SLA 源单次扫描报告（观测/测试断言） */
export interface SlaReport {
  ts: number
  /** 扫到的岗单据数（有 job 映射且有派发锚） */
  inFlight: number
  /** 本拍产 escalate 意图数（=本拍 ESCALATE 落账数） */
  fired: number
}

/** SLA 源运行面计数 */
export interface SlaSourceStats {
  polls: number
  /** 累计 escalate 意图（=累计本源 ESCALATE 事件） */
  escalated: number
  /** 轮询体异常（吞掉不炸——25-§3.4.5 源侧契约） */
  errors: number
}

/** SLA 源依赖 */
export interface SlaSourceDeps {
  ledger: Ledger
  clock: () => number
  /** 公司 slug（events 过滤 + 意图 company——一源一公司） */
  company: string
  /** 扫描轮询间隔 ms */
  intervalMs: number
  /** 事件 id 生成器（缺省 makeUlid——测试可注入确定性 id） */
  makeId?: (ts: number) => string
  /** 事件 actor（缺省 'daemon'——engine config.actor 同款） */
  actor?: string
  log?: (line: string) => void
}

/** SLA 源句柄：InvokeSource 端口 + 手动泵（poll，测试/显式驱动）+ 计数 */
export interface SlaSource extends InvokeSource {
  /** 手动泵：立即扫一轮（emit 缺省走 start 注入的 liveEmit；两者皆无=本拍不产只返回） */
  poll(emit?: (intent: InvokeIntent) => void): SlaReport
  readonly stats: SlaSourceStats
}

/**
 * createSlaSource —— tick 驱动的 SLA/升级计时器。
 * 零内存态：每拍全量重读 events 派生（在途窗+已告集）——重启/关源重开天然幂等。
 */
export function createSlaSource(deps: SlaSourceDeps): SlaSource {
  const log = deps.log ?? ((): void => undefined)
  const makeId = deps.makeId ?? makeUlid
  const stats: SlaSourceStats = { polls: 0, escalated: 0, errors: 0 }
  let liveEmit: ((intent: InvokeIntent) => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  /** job 单据映射：PATROL note 携 job=<id>（engine 物化口径）→ ticket → job_id */
  function jobTickets(events: readonly EventRecord[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const e of events) {
      if (e.event !== 'PATROL') continue
      const m = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
      if (m !== null) map.set(e.issue, m[1] as string)
    }
    return map
  }

  /** 本源已告集：ESCALATE note 携 src=sla-timer → `${anchor}#${tier}` 键集 */
  function firedKeys(events: readonly EventRecord[]): Set<string> {
    const keys = new Set<string>()
    for (const e of events) {
      if (e.event !== 'ESCALATE') continue
      if (!(e.note ?? '').includes(`src=${SLA_SOURCE_NAME}`)) continue // 引擎断路等他源 ESCALATE 不计
      const anchor = /(?:^|;)anchor=([^;]+)/.exec(e.note ?? '')
      const tier = /(?:^|;)tier=([^;]+)/.exec(e.note ?? '')
      if (anchor !== null && tier !== null) keys.add(`${anchor[1]}#${tier[1]}`)
    }
    return keys
  }

  function poll(emitOverride?: (intent: InvokeIntent) => void): SlaReport {
    const now = deps.clock()
    const emit = emitOverride ?? liveEmit
    stats.polls += 1
    // 派生面（单次线性扫描，asc 序）：锚=每单最近 DISPATCH；ack=锚后白名单事件；
    // 已告=本源 ESCALATE 派生——三集一并读出
    const events = deps.ledger.queryEvents({ company: deps.company })
    const tickets = jobTickets(events)
    const fired = firedKeys(events)
    interface Window {
      anchor: EventRecord
      acked: boolean
    }
    const windows = new Map<string, Window>()
    for (const e of events) {
      if (!tickets.has(e.issue)) continue // 只扫岗单据（普通单 SLA 归 oncall/subscribe 后续刀）
      if (e.event === 'DISPATCH') {
        windows.set(e.issue, { anchor: e, acked: false }) // 新锚开新窗（推进重置的结构性落点）
        continue
      }
      const w = windows.get(e.issue)
      if (w === undefined) continue
      if (ACK_EVENTS.has(e.event)) w.acked = true // 关窗（其后不再升级，直至新 DISPATCH）
    }
    let inFlight = 0
    let firedNow = 0
    for (const [ticket, w] of windows) {
      if (w.acked) continue
      const jobId = tickets.get(ticket)
      if (jobId === undefined) continue
      const job = deps.ledger.getJob(jobId)
      if (job === undefined) continue
      const ops = parseJobOps(job.payload)
      const tiers: SlaTier[] = []
      if (ops.sla?.first_ack_ms !== undefined) tiers.push({ tier: 'first-ack', afterMs: ops.sla.first_ack_ms })
      for (let i = 0; i < (ops.escalate?.length ?? 0); i += 1) {
        const e = ops.escalate?.[i]
        if (e !== undefined) tiers.push({ tier: `chain-${i}`, afterMs: e.after_ms, unacked: e.unacked })
      }
      if (tiers.length === 0) continue // 该岗无 SLA 段——不计时
      inFlight += 1
      for (const t of tiers) {
        const key = `${w.anchor.id}#${t.tier}`
        if (fired.has(key)) continue // 同单同档只告一次（幂等）
        const due = w.anchor.ts + t.afterMs
        if (now < due) continue // 未超时
        if (emit === undefined) continue // 无出口不落账（防意图丢失——落账即不可重发）
        const payload: Record<string, unknown> = {
          ticket,
          job_id: jobId,
          tier: t.tier,
          opened_at: w.anchor.ts,
          due_at: due,
        }
        if (t.unacked !== undefined) payload.unacked = t.unacked
        emit({
          kind: 'escalate',
          company: deps.company,
          ticket,
          payload,
          source: SLA_SOURCE_NAME,
          dedupKey: `sla:${ticket}@${w.anchor.id}#${t.tier}`,
          priority: 3, // 升级高优（schedule=2 / ticket=1 既有口径之上）
        })
        deps.ledger.appendEvent({
          id: makeId(now),
          ts: now,
          company: deps.company,
          issue: ticket,
          event: 'ESCALATE',
          actor: deps.actor ?? 'daemon',
          attempt: w.anchor.attempt,
          level: Math.max(1, Math.min(9, job.level)),
          dept: job.dept,
          tokens: { input: 0 },
          note:
            `SLA 计时器：${t.tier} 档超时（${t.afterMs}ms 未应答）` +
            `；src=${SLA_SOURCE_NAME};anchor=${w.anchor.id};tier=${t.tier};job=${jobId}` +
            `;opened=${w.anchor.ts};due=${due}${t.unacked !== undefined ? `;unacked=${t.unacked}` : ''}`,
        })
        fired.add(key) // 本拍内后续同键不重发
        firedNow += 1
        stats.escalated += 1
        log(`[sla-timer] 单 ${ticket}（job=${jobId}）${t.tier} 档超时 → escalate 意图 + ESCALATE 落账`)
      }
    }
    return { ts: now, inFlight, fired: firedNow }
  }

  return {
    name: SLA_SOURCE_NAME,
    start(emit: (intent: InvokeIntent) => void): void {
      if (running) return
      running = true
      liveEmit = emit
      timer = setInterval(() => {
        try {
          poll()
        } catch (err) {
          stats.errors += 1
          log(`[sla-timer] 轮询异常（已吞不炸循环）：${err instanceof Error ? err.message : String(err)}`)
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
    get stats(): SlaSourceStats {
      return { ...stats }
    },
  }
}
