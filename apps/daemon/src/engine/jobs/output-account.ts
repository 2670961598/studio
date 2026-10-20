/**
 * output-account —— 岗产物落位收账（DEV-50，docs/17-§2 第 4 相「收割」的后置收账步）
 *
 * 缺口（2026-10-20 实证 studio-dev-86 首件日报）：jobs[].output（docs/04-§三 D9 落点
 * 声明，M4-④ 装载进 jobs 表 payload.output）全链无消费面——REPORT 只落工位
 * （work_records.report_ref），公司目录 reports/ 位永远空置，报表聚合（04-§三 叶→部门
 * →公司→总览）地基断链。
 *
 * 本刀（收割面收账，任务书首选路）：
 *   - 单→岗锚：PATROL note 携 job=<id>（engine 物化口径，与 jobs-sources.ts
 *     jobTickets 同形）→ ledger.getJob → parseJobOps(payload).output（DEV-50 补读面）；
 *   - 落位：收割 GATE_PASS 后把工位 REPORT.md 按 `<YYYY-MM-DD>-<type>-<节点>-<单号>.md`
 *     （docs/04-§三 报表命名约定）复制到 `<companyDir>/<output>/`——尾段以单号代
 *     「一句话总结」：机制面无语义摘要可产，取确定性段保同日多岗不撞名、重收同单幂等
 *     覆盖【拟稿待批；worker 自命名件仍留工位 deliverables，语义名归人面】；
 *   - 时钟注入（core 禁 Date.now 纪律在 daemon 侧同形），日期段取本地时区（与 cron
 *     解析口径一致，04-§三）。
 *
 * 契约边界（docs/17-§6 收割四要件冻结不动）：收账是 GATE_PASS 的后置步——四要件仍是
 * 收割成功的唯一判据；收账失败不回滚收割，如实留痕（note 后缀 + 可选 onProblem 上报
 * tick errors）。安全闸双保险：isSafeRelativeOutputPath 写边复检（装载期已过闸，防
 * 热更/直写绕过）+ companyDir 包含性校验（拼接后再核一次，防 `..` 变体）。
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { isSafeRelativeOutputPath, parseJobOps } from '@studio-next/company'
import type { TicketId } from '@studio-next/contract'
import type { JobRecord, Ledger } from '@studio-next/store'

/** 收账入参（engine finalizeHarvest GATE_PASS 路径构造；全部依赖注入，零全局态） */
export interface JobOutputAccountInput {
  ledger: Ledger
  ticket: TicketId
  /** 工位 REPORT.md 落点（gate 侧要件 3 的事实源；非存在时引擎不调本面） */
  reportPath: string
  /** 公司目录根（落点锚；undefined=面未开（未配 companyDir）→ 空收账非错） */
  companyDir: string | undefined
  /** 时钟注入：日期段的时刻源（本地时区取日） */
  now: () => number
  /** 收账异常上报口（engine tick errors 面；不接=只留 note 痕） */
  onProblem?: (message: string) => void
}

/** 收账结果：noteSuffix 拼进 GATE_PASS note（证据面）；target=实际落位（成功时） */
export interface JobOutputAccountResult {
  /** ''=无收账（非岗单/未声明落点/面未开）；';output=<目标>' 成功；';output-err=<因>' 失败 */
  noteSuffix: string
  target?: string
}

/** 文件名段消毒：非法字符折叠为 '-'（保 CJK；防空段/路径分隔注入） */
function sanitizeSegment(text: string): string {
  const s = text.replace(/[/\\?*:|<>"\x00-\x1f;]+/g, '-').replace(/^-+|-+$/g, '')
  return s === '' ? 'unnamed' : s
}

/** docs/04-§三 命名：`<YYYY-MM-DD>-<type>-<节点>-<尾段>.md`（本地时区取日，与 cron 同口径） */
export function reportFileName(job: JobRecord, ticket: TicketId, now: number): string {
  const d = new Date(now)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const payload = job.payload
  const rawType = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).type
    : undefined
  const type = typeof rawType === 'string' && rawType !== '' ? rawType : 'artifact'
  const node = path.posix.basename(job.dept.replaceAll('\\', '/'))
  return `${date}-${sanitizeSegment(type)}-${sanitizeSegment(node)}-${sanitizeSegment(String(ticket))}.md`
}

/**
 * 岗产物落位收账（幂等：同单同日重收=覆盖同目标；无声明落点/非岗单=空收账非错）。
 * throws 永不——一切失败折进 noteSuffix/onProblem（收割成败语义不被收账牵动）。
 */
export function accountJobOutput(input: JobOutputAccountInput): JobOutputAccountResult {
  const { ledger, ticket, reportPath, companyDir, now } = input
  const fail = (why: string): JobOutputAccountResult => {
    input.onProblem?.(`岗产物落位收账 ${ticket}：${why}`)
    return { noteSuffix: `;output-err=${why}` }
  }
  if (companyDir === undefined) return { noteSuffix: '' } // 面未开（companyDir 未注入）——非错
  // 单→岗锚：本单 PATROL note 的 job= 段（与 jobs-sources jobTickets 同形）；非岗单=不适用
  const patrol = ledger
    .queryEvents({ issue: ticket })
    .find((e) => e.event === 'PATROL' && /(?:^|;)job=([^;]+)/.exec(e.note ?? '') !== null)
  const anchor = patrol !== undefined ? /(?:^|;)job=([^;]+)/.exec(patrol.note ?? '') : null
  if (anchor === null) return { noteSuffix: '' } // 非定时岗单——无落点声明可收
  const jobId = anchor[1] as string
  const job = ledger.getJob(jobId)
  if (job === undefined) return fail(`job 不在台账(job=${jobId}，热更移除？)`)
  const output = parseJobOps(job.payload).output
  if (output === undefined) return { noteSuffix: '' } // 岗未声明 output——空收账非错
  if (!isSafeRelativeOutputPath(output)) return fail(`落点不合法(output=${output})`)
  const companyRoot = path.resolve(companyDir)
  const targetDir = path.resolve(companyRoot, output)
  if (targetDir !== companyRoot && !targetDir.startsWith(companyRoot + path.sep)) {
    return fail(`落点逃逸公司目录(output=${output})`)
  }
  const target = path.join(targetDir, reportFileName(job, ticket, now()))
  try {
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(reportPath, target)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return fail(`写失败(${msg})`)
  }
  return { noteSuffix: `;output=${target}`, target }
}
