/**
 * cadence —— 岗位运作规格的解析面（docs/35-§3，制作人 2026-10-19 批复「岗位拓展的很好，没啥问题」）
 *
 * 职责（纯函数，零 IO——08 纯逻辑纪律；company 包只依赖 contract）：
 *   - **档位展开**：triggers.cadence 五档位（hourly/daily/weekly/monthly/quarterly）+ at 锚
 *     → cron 表达式（docs/35 §2「节奏档位枚举……不写死表达式」）。展开发生在装载期
 *     （validator toJobs）——contract ScheduledJob.cron 必填，档位岗装进快照时即已展开，
 *     daemon 侧调度器/cadence 源消费的是真 cron，零新解析轮子。
 *   - **时长解析**：sla/escalate 段的 "15m"/"4h" 形态 → epoch ms（schema refine 与装载共用）。
 *   - **ops 视图**：ScheduledJob.payload（unknown）→ daemon 侧强类型读面 parseJobOps——
 *     payload 形状由本包 toJobs 构造，读面也归本包（单一事实源；daemon 零形状耦合）。
 *
 * 档位缺省时刻表【拟稿待批 M5-①，docs/35 §6 待批示项延伸——档位默认锚】：
 *   hourly=整点｜daily=09:00（日站会/日报）｜weekly=周一 09:00（周经营会）｜
 *   monthly=每月 1 日 09:00（月结）｜quarterly=每季首月（1/4/7/10 月）1 日 09:00（季规划）。
 *   at 锚可覆盖时刻（HH:MM）与日（d<N>，仅 monthly/quarterly）；docs/35 例 `at: "d+1 09:00"`
 *   的 `d+1` 释为每月 1 日（+1=首日）。时区=cron 既有口径（系统本地时区，scheduler 头注）。
 *
 * 时长语法【拟稿待批 M5-②】：`<正整数><s|m|h|d>`（30s/15m/4h/2d）——复合形（1h30m）不收，
 * docs/35 语料只出现单段；要复合先走批示扩语法。
 */
import type { ScheduledJob } from '@studio-next/contract'

/** 五档位（docs/35-§3 triggers.cadence 枚举；自定义 cron 走既有 cron 键不进档位） */
export const CADENCE_TIERS = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly'] as const
export type CadenceTier = (typeof CADENCE_TIERS)[number]

/** 档位是否在枚举内（zod 之外的轻量判定——daemon/测试面） */
export function isCadenceTier(v: unknown): v is CadenceTier {
  return typeof v === 'string' && (CADENCE_TIERS as readonly string[]).includes(v)
}

/** 各档位缺省 cron（M5-① 拟稿待批；时刻全 09:00 起手——经营节奏「上班首件事」语义） */
const TIER_DEFAULT_CRON: Record<CadenceTier, string> = {
  hourly: '0 * * * *',
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  monthly: '0 9 1 * *',
  quarterly: '0 9 1 */3 *',
}

/** at 锚解析结果：HH:MM 时刻 + 可选日（d<N>，仅月档位有意义） */
export interface CadenceAt {
  /** 日（1..31；缺省=档位缺省日——月档位 1，其余档位无日语义） */
  day?: number
  /** 时 0..23 */
  hour: number
  /** 分 0..59 */
  minute: number
}

/**
 * at 锚解析：`"HH:MM"` 或 `"d<N> HH:MM"` / `"d+N HH:MM"`（docs/35 例 `d+1 09:00`，+N 释为首 N 日）。
 * 合法返回 CadenceAt；非法返回 null（zod refine 与展开器共用——不抛错，判定纯函数）。
 */
export function parseCadenceAt(at: string): CadenceAt | null {
  const text = at.trim()
  // 可选日前缀：d5 / d+5（大小写不敏感；日 1..31）
  const mDay = /^d\+?([0-9]{1,2})\s+/i.exec(text)
  const rest = mDay !== null ? text.slice(mDay[0].length) : text
  const mTime = /^([0-9]{1,2}):([0-9]{2})$/.exec(rest)
  if (mTime === null) return null
  const hour = Number(mTime[1])
  const minute = Number(mTime[2])
  if (hour > 23 || minute > 59) return null
  if (mDay !== null) {
    const day = Number(mDay[1])
    if (day < 1 || day > 31) return null
    return { day, hour, minute }
  }
  return { hour, minute }
}

/**
 * 档位+at → cron 表达式。档位与 at 合法性由 schema refine 前置保证；此处再守一道
 * （直接调用面的 belt）：非法即抛 CONFIG_INVALID 形错误（明报不猜）。
 * 规则：时刻取 at（缺省 09:00）；日取 at.day（缺省 1，仅月档位两档）；hourly 拒 at
 * （整点档无从锚时刻）；daily/weekly 拒 d 前缀（无日语义——周几/每日固定）。
 */
export function expandCadence(tier: CadenceTier, at?: string): string {
  if (at === undefined) return TIER_DEFAULT_CRON[tier]
  const parsed = parseCadenceAt(at)
  if (parsed === null) {
    throw new Error(`CONFIG_INVALID：cadence at '${at}' 不合法（须形如 "HH:MM" 或 "d<N> HH:MM"，docs/35-§3）`)
  }
  if (tier === 'hourly') {
    throw new Error(`CONFIG_INVALID：hourly 档位不收 at（整点档无从锚时刻——docs/35-§3）`)
  }
  if (parsed.day !== undefined && (tier === 'daily' || tier === 'weekly')) {
    throw new Error(`CONFIG_INVALID：${tier} 档位不收 d<N> 日锚（无日语义，只收 "HH:MM"）`)
  }
  const time = `${parsed.minute} ${parsed.hour}`
  if (tier === 'daily') return `${time} * * *`
  if (tier === 'weekly') return `${time} * * 1`
  if (tier === 'monthly') return `${time} ${parsed.day ?? 1} * *`
  return `${time} ${parsed.day ?? 1} */3 *` // quarterly：每季首月
}

/**
 * 岗位运作时长解析：`<正整数><s|m|h|d>` → ms；非法返回 null（M5-② 语法，拟稿待批）。
 * 上界守 366d（拒绝荒谬大数打爆 next_run_at 语义——明报不猜）。
 */
export function parseJobDuration(text: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/.exec(text.trim())
  if (m === null || m[1] === undefined || m[2] === undefined) return null
  const n = Number(m[1])
  if (n === 0) return null
  const unitMs: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  const unit = unitMs[m[2]]
  if (unit === undefined) return null
  const ms = n * unit
  return ms > 366 * 86_400_000 ? null : ms
}

// ————————————————————————— ops 视图（payload 强类型读面） —————————————————————————

/** triggers.cadence 段装载形态（cron 已展开进 ScheduledJob.cron；此处留档位原样供观测） */
export interface JobOpsCadence {
  tier: CadenceTier
  at?: string
}

/** sla 段装载形态（时长已解析为 ms；原始串不重复携带——语法由 schema 冻结） */
export interface JobOpsSla {
  first_ack_ms?: number
  resolve_hint_ms?: number
}

/** escalate 链单档装载形态（after 已解析 ms；unacked=通知目标原样串，notify 端口后续刀） */
export interface JobOpsEscalateTier {
  after_ms: number
  unacked: string
}

/**
 * 岗位运作规格装载视图（triggers/outputs/sla/escalate 四段 + output 落点，M5-③..⑥/DEV-50）。
 * output（单数）=产物落点相对路径（jobs[].output 装载自 M4-④；收割侧按落点收账，
 * DEV-50）——与 outputs（复数，报表模板清单 M5-⑤）语义互不相干。
 */
export interface JobOps {
  cadence?: JobOpsCadence
  outputs?: string[]
  output?: string
  sla?: JobOpsSla
  escalate?: JobOpsEscalateTier[]
  /** 127-A R2：新鲜度宽限逐岗声明（grace_ms）——daemon freshness 源消费 */
  grace_ms?: number
}

/**
 * ScheduledJob.payload → JobOps（daemon 侧读面）。
 * 宽容读：payload 由本包 toJobs 构造（schema 已过闸），此处只做形状防御——坏段不进结果
 * 不抛错（daemon 侧零崩；消费面按「段缺省=无该面」处理，与 scheduler payload.job_id
 * 检查同风格）。非对象/无任何已知键 → 空 JobOps。
 */
export function parseJobOps(payload: unknown): JobOps {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {}
  const p = payload as Record<string, unknown>
  const out: JobOps = {}
  if (isCadenceTier(p.cadence_tier)) {
    out.cadence = {
      tier: p.cadence_tier,
      ...(typeof p.cadence_at === 'string' ? { at: p.cadence_at } : {}),
    }
  }
  if (Array.isArray(p.outputs) && p.outputs.every((o) => typeof o === 'string' && o !== '')) {
    out.outputs = p.outputs as string[]
  }
  if (typeof p.output === 'string' && p.output !== '') out.output = p.output
  if (typeof p.grace_ms === 'number' && p.grace_ms > 0) out.grace_ms = p.grace_ms // 127-A R2 批示④
  const sla = p.sla
  if (typeof sla === 'object' && sla !== null && !Array.isArray(sla)) {
    const s = sla as Record<string, unknown>
    const parsed: JobOpsSla = {}
    if (typeof s.first_ack_ms === 'number' && s.first_ack_ms > 0) parsed.first_ack_ms = s.first_ack_ms
    if (typeof s.resolve_hint_ms === 'number' && s.resolve_hint_ms > 0) parsed.resolve_hint_ms = s.resolve_hint_ms
    if (Object.keys(parsed).length > 0) out.sla = parsed
  }
  if (Array.isArray(p.escalate)) {
    const tiers: JobOpsEscalateTier[] = []
    for (const e of p.escalate) {
      if (typeof e !== 'object' || e === null || Array.isArray(e)) continue
      const r = e as Record<string, unknown>
      if (typeof r.after_ms === 'number' && r.after_ms > 0 && typeof r.unacked === 'string' && r.unacked !== '') {
        tiers.push({ after_ms: r.after_ms, unacked: r.unacked })
      }
    }
    if (tiers.length > 0) out.escalate = tiers
  }
  return out
}

/**
 * 档位岗判定（cadence 源的选岗面）：payload 载 cadence_tier 即档位岗
 * （validator toJobs 只给 triggers.cadence 岗写该键——cron 直写岗不写）。
 */
export function isCadenceJob(job: ScheduledJob): boolean {
  return parseJobOps(job.payload).cadence !== undefined
}
