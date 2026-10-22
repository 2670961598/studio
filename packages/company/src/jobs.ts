/**
 * jobs —— org-config jobs 段装载（v0.1-M4，04-§三 D9；v0.1-M5 岗位运作规格五段——docs/35-§3）。
 * 自 validator.ts 拆出（130-P3 接线时腾位，20-§十五.三.3「先拆再增」；逐字搬迁零行为漂移）。
 */
import type { RoleName, ScheduledJob } from '@studio-next/contract'
import { expandCadence, parseJobDuration } from './cadence.ts'
import type { OrgConfig } from './validator.ts'

/**
 * jobs 装载（v0.1-M4，04-§三 D9；v0.1-M5 岗位运作规格五段——docs/35-§3）：yaml jobs 段 → ScheduledJob[]。
 * 映射规则逐字段冻结在 OrgJobSchema 头注（拟稿待批 M4-①..⑧ + M5-①..⑥）；company=本司 slug；
 * dept 缺省=根部门（首个 parent:null，兜底 departments[0]——M4-①）。
 */
export function toJobs(org: OrgConfig): ScheduledJob[] {
  if (org.jobs === undefined) return []
  const rootDept = org.departments.find((d) => d.parent === null)?.path ?? org.departments[0]?.path ?? ''
  return org.jobs.map((j) => {
    // M5-⓪：cron 与 triggers.cadence 恰给其一（schema refine 保证），断言免检同 M4-② 风格
    const cron = j.cron ?? expandCadence(j.triggers?.cadence as 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly', j.triggers?.at)
    const sla = j.sla
    return {
      job_id: j.id,
      company: org.company.slug,
      dept: j.dept ?? rootDept, // M4-①
      cron,
      // M4-②：schema refine 保证 role/type 至少其一（见 OrgJobSchema），断言免检
      role: (j.role ?? j.type) as RoleName,
      level: j.level ?? org.company.level, // M4-⑤
      model_tier: j.model_tier ?? 'low', // M4-⑥
      ...(j.budget_cap !== undefined ? { budget_cap: { usd: j.budget_cap } } : {}), // M4-⑦
      ...(hasOpsPayload(j, sla)
        ? {
            payload: {
              ...(j.type !== undefined ? { type: j.type } : {}), // M4-④
              ...(j.output !== undefined ? { output: j.output } : {}), // M4-④
              ...(j.triggers?.cadence !== undefined ? { cadence_tier: j.triggers.cadence } : {}), // M5-③
              ...(j.triggers?.at !== undefined ? { cadence_at: j.triggers.at } : {}), // M5-③
              ...(j.outputs !== undefined ? { outputs: j.outputs } : {}), // M5-④
              ...(sla !== undefined
                ? {
                    sla: {
                      ...(sla['first-ack'] !== undefined ? { first_ack_ms: parseJobDuration(sla['first-ack']) as number } : {}), // M5-⑤
                      ...(sla['resolve-hint'] !== undefined ? { resolve_hint_ms: parseJobDuration(sla['resolve-hint']) as number } : {}), // M5-⑤
                    },
                  }
                : {}),
              ...(j.escalate !== undefined
                ? { escalate: j.escalate.map((e) => ({ after_ms: parseJobDuration(e.after) as number, unacked: e.unacked })) } // M5-⑥
                : {}),
              ...(j.grace !== undefined ? { grace_ms: parseJobDuration(j.grace) as number } : {}), // 127-A R2 批示④
            },
          }
        : {}),
    }
  })
}

/** ops 段存在性（payload 组装前置：type/output 既有 + cadence/outputs/sla/escalate/grace 段——全缺则不设 payload） */
function hasOpsPayload(
  j: {
    type?: string | undefined
    output?: string | undefined
    outputs?: string[] | undefined
    triggers?: { cadence?: string | undefined; at?: string | undefined } | undefined
    escalate?: Array<{ after: string; unacked: string }> | undefined
    grace?: string | undefined
  },
  sla?: { 'first-ack'?: string | undefined; 'resolve-hint'?: string | undefined } | undefined,
): boolean {
  return (
    j.type !== undefined ||
    j.output !== undefined ||
    j.outputs !== undefined ||
    j.triggers?.cadence !== undefined ||
    sla !== undefined ||
    j.escalate !== undefined ||
    j.grace !== undefined
  )
}
