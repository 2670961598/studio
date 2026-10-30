/**
 * jobs 子命令组（127-A R2 手动补跑面，studio-dev-127 §4.3 批示④——CLI 薄壳）：
 *   - list：调度表只读列表（岗逐行 job_id/cron/dept/status/型/下跑槽/末跑槽——
 *     越窗分诊先看这里；库不存在即拒，只读面不代建库）；
 *   - catchup：手动补跑——next_run_at 推到当下（等价「槽已到期」，下一拍 scheduler 即
 *     物化岗单）。**只挪槽不派工**：到点意图仍走既有 jobs 源 tick 面（零新轮子）；
 *     停跑根因不在此治（freshness 哨兵事件分诊，§4.3——JOB_STALE 的处置指针即本命令）。
 * 写面纪律：写 ledger.sqlite（jobs 表 next_run_at 一列语义）；库必须已存在（写面不代建库）；
 * catchup 是写命令 → 取 writer 租约（daemon 持锁即 STALL/writer-lease-held 拒，PB-5 围栏）；
 * list 只读 → openLedger（不纳围栏；读写面分离，见 store writer-lease.ts 头注边界）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { openLedger, openLedgerWriter } from '@studio-next/store'
import { CONCISE, SECTION } from './usage.ts'
import { errText, parseArgv } from './argv.ts'
import { helpOk, missingSub, unknownSub, usageFail, wantsHelp } from './help.ts'

/** 组面已知子命令表（S1d did-you-mean 的候选集=本表） */
const JOBS_SUBS = ['list', 'catchup'] as const

const iso = (ts: number | undefined): string => (ts === undefined ? '—' : new Date(ts).toISOString())

export async function cmdJobs(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'list':
    case 'catchup':
      break
    case undefined:
      // S1c-B 批示统一：裸组命令=错误行+组简段+exit 1（git 惯例）
      return missingSub('jobs', JOBS_SUBS, CONCISE.jobs)
    case '-h':
    case '--help':
    case 'help':
      return helpOk(SECTION.jobs)
    default:
      return unknownSub('jobs', sub, JOBS_SUBS, CONCISE.jobs)
  }
  if (wantsHelp(rest)) return helpOk(SECTION.jobs) // S1b 预检（先于库存在性检查）
  const parsed = parseArgv(rest, new Set(sub === 'list' ? ['db'] : ['db', 'job']))
  if ('error' in parsed) {
    return usageFail(`jobs ${sub}`, parsed.error, CONCISE.jobs)
  }
  if (parsed.positionals.length > 0) {
    return usageFail(`jobs ${sub}`, `多余的位置参数：${parsed.positionals.join(' ')}`, CONCISE.jobs)
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    return usageFail(`jobs ${sub}`, '缺少 --db <库路径>', CONCISE.jobs)
  }
  const resolved = path.resolve(dbPath)
  if (!existsSync(resolved)) {
    console.error(`jobs ${sub}：库不存在：${resolved}（不代建库——建库走 studio-next company create <slug>（缺省即建库））`)
    return 1
  }
  if (sub === 'list') {
    try {
      const ledger = openLedger(resolved)
      try {
        const jobs = ledger.listJobs() // next_run_at 升序（SQL 序）——最近的槽在前
        console.log(`调度岗 ${jobs.length} 个——库 ${resolved}（schema v${ledger.version()}，只读）`)
        for (const j of jobs) {
          const type = ((j.payload as { type?: unknown } | undefined)?.type ?? '—') as string
          console.log(
            `${j.job_id}  ${j.cron}  ${j.dept}  ${(j.status ?? 'active').padEnd(7)}  型=${type}  下跑=${iso(j.next_run_at)}  末跑=${iso(j.last_run_at)}`,
          )
        }
        return 0
      } finally {
        ledger.close()
      }
    } catch (err) {
      console.error(`jobs list 失败：${errText(err)}`)
      return 1
    }
  }
  // catchup：--job 必配；整记录回写（其余字段原样——last_run_at 列不在 upsert 更新集，
  // 真实末跑事实不被 CLI 面覆盖）
  const jobId = parsed.flags.job
  if (jobId === undefined) {
    return usageFail('jobs catchup', '缺少 --job <job_id>', CONCISE.jobs)
  }
  try {
    // 写面（jobs.next_run_at 挪槽）：取 writer 租约（daemon 持锁时 STALL/writer-lease-held 拒，
    // PB-5 围栏覆盖）；jobs list 是只读面，仍走 openLedger（不纳围栏，读写面分离）
    const ledger = openLedgerWriter(resolved, 'cli:jobs-catchup')
    try {
      const job = ledger.getJob(jobId)
      if (job === undefined) {
        console.error(`jobs catchup：job 不在台账：${jobId}（热更移除？——studio-next jobs list --db ${resolved} 看现役岗）`)
        return 1
      }
      const now = Date.now()
      ledger.upsertJob({ ...job, next_run_at: now })
      console.log(`已补跑排程：${jobId} 下跑槽 → ${new Date(now).toISOString()}（原 ${iso(job.next_run_at)}）——下一拍 scheduler 即物化岗单`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    console.error(`jobs catchup 失败：${errText(err)}`)
    return 1
  }
}
