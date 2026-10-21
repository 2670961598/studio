/**
 * harvest-recon —— 收割相位尾对账步（P3，studio-dev-100 提案 §4.3；docs/17-§2 相位 4 尾）
 *
 * 缺口（2026-10-20/21 实证，提案 E9-E13）：
 *   - E9 归档断链（86 号工况）：jobs[].output 声明落点 × 公司目录实际文件全链无**对账**面
 *     ——DEV-50（output-account.ts）已建 GATE_PASS 内联常态收账（前向修复），但存量断链
 *     （收割时 daemon 停机/重启窗/收账失败）无回扫补收：缺了就永远缺；
 *   - E10 悬空单（94 号工况）：有产物（deliverables/plan.md）、无 REPORT 的收割失败面，
 *     GATE_FAIL 只报「缺 REPORT」不见「已有产物」——重派/回收决策看不到半成品证据；
 *   - E12 权限静默（113 号归档 mode 600 实证）：收账面无权限/可达性检查，daemon/收割
 *     异用户部署下 copyFileSync 将静默失败。
 *
 * 本刀三面（相位内步骤，不增删相位、不动收割四要件与 decide 纯函数契约——提案 §4.5）：
 *   ① 落位对账（runHarvestRecon，本文件主体）：PATROL job= 锚 × jobs[].output × 公司目录
 *     实际文件比对——有工位副本缺归档 → `REPORT_MISSING` 事件 + **内容哈希幂等补收**
 *     （先事件后搬运；目标在位且哈希同=跳过；哈希异=再落事件转人工**绝不覆盖**——迟到
 *     写入竞态安全，R6）；**不代写**（补收只搬运工位已有副本，REPORT 缺失工况只事件化，R7）；
 *   ② 权限前移（WORKSPACE_UMASK，executeDispatch 消费）：派发窗 process.umask(0o022)
 *     ——daemon 落盘的工位脚手架与 launch 出的 worker 子进程（umask 随 fork/exec 继承）
 *     默认产物权限 ≥0644；收割期 stat 体检降为兜底（statHarvestDenial）——不可读即
 *     `HARVEST_DENIED` 事件不静默（R8）；
 *   ③ 悬空面可见（deliverablesOf，finalizeHarvest 失败面消费）：GATE_FAIL 缺 REPORT 而
 *     工位已有交付物 → `HARVEST_INCOMPLETE` 事件（attempt 作用域）——进重派/回收决策
 *     的视野，不自动补收不代写。
 *
 * 边界（提案 §4.5 冻结）：company/reports/ 仍 daemon 单点写；补收目标名与 DEV-50
 * reportFileName 同公式（防双命名源）；对账只治「写错位/漏收」，不治「没写」（病根归因
 * 留给事件流）；四要件判定与 GATE_PASS/FAIL 语义零改动。
 */
import { createHash } from 'node:crypto'
import { accessSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { isSafeRelativeOutputPath, parseJobOps } from '@studio-next/company'
import type { IssueRecord, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { reportFileName } from './output-account.ts'

// —— ② 权限前移（P3，提案 §4.3-2）——

/** 工位产物 umask 约定（0644 类）：目录可进入、组/他可读——收账面（daemon/收割异用户部署）可达 */
export const WORKSPACE_UMASK = 0o022

/**
 * ③ 悬空面快照（94 号工况）：工位 deliverables/ 非空清单（.gitkeep 不计）——
 * GATE_FAIL 缺 REPORT 时由 finalizeHarvest 消费：非空 → HARVEST_INCOMPLETE 事件。
 * 目录不存在/空 = undefined（调用面据此跳过）。
 */
export function deliverablesOf(workspace: string): string[] | undefined {
  const dir = path.join(workspace, 'deliverables')
  if (!existsSync(dir)) return undefined
  try {
    const names = statSync(dir).isDirectory()
      ? readdirSync(dir).filter((n) => n !== '.gitkeep' && n !== '.DS_Store')
      : []
    return names.length > 0 ? names : undefined
  } catch {
    return undefined // 读不到如实当「无快照」——权限面另由 statHarvestDenial 兜底
  }
}

/**
 * ② stat 兜底（E12）：收割面可达性体检——REPORT.md（在位时）与 deliverables/（在位时）
 * 逐个 accessSync(R_OK)；不可读 → { path, reason }（errno 归因）。可读 = undefined。
 * 只检「daemon 实际读不动」（EACCES/EPERM 类）；mode 预言面（0644 以下但本用户仍可读）
 * 不判 denied——那是 umask 前移的职责面，事件噪音换不来真信号。
 */
export function statHarvestDenial(workspace: string, reportPath: string | undefined): { path: string; reason: string } | undefined {
  const targets = [
    ...(reportPath !== undefined && existsSync(reportPath) ? [reportPath] : []),
    ...(() => {
      const dir = path.join(workspace, 'deliverables')
      return existsSync(dir) ? [dir] : []
    })(),
  ]
  for (const p of targets) {
    try {
      accessSync(p, 0o4 /* R_OK */)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { path: p, reason: msg }
    }
  }
  return undefined
}

// —— ① 落位对账（P3，提案 §4.3-1；红队 R6/R7 修订面）——

/**
 * 对账步事件的单据形：mirror 在案取实值 state/dept/level（makeEvent 消费面仅 id 与此
 * 三键）；失联走极小形（dept 兜底位/level=1）——心跳哨兵同法（sentinel/sentinels.ts）。
 * ticket_mirror 无 title 列（issues 平台侧字段）——占位 '-'。
 */
export function reconIssueRecord(deps: {
  ticket: TicketId
  mirror: { state?: string; dept?: string; level?: number } | undefined
  deptFallback: string
  at: number
}): IssueRecord {
  const { ticket, mirror, deptFallback, at } = deps
  return {
    id: ticket,
    title: '-',
    state: mirror?.state ?? '-',
    dept: mirror?.dept ?? deptFallback,
    level: mirror?.level ?? 1,
    updated: new Date(at).toISOString(),
  }
}

/** 对账步依赖（engine tick 相位 4 尾注入；全依赖注入，零全局态） */
export interface HarvestReconDeps {
  ledger: Ledger
  /** 公司目录根（面开关：undefined=面未开，对账零行为——serve 未配 companyDir 时） */
  companyDir: string
  /**
   * 事件落账口（engine makeEvent 接线——单→岗锚单据镜像 dept/level 由此解析）；
   * 对账步只产事实，不拼事件记录（company/actor/attempt 塔在 engine）。
   */
  emit: (name: 'REPORT_MISSING' | 'HARVEST_INCOMPLETE', ticket: TicketId, attempt: number, note: string) => void
  /** 异常上报口（engine tick errors 面；不接=只留事件痕） */
  onProblem?: (message: string) => void
}

/** 对账步结果（tick 汇报面；phase 4 尾计入 harvest.recon） */
export interface HarvestReconResult {
  /** 本拍对账扫过的岗单数（PATROL job= 锚且 job 声明 output 且已 GATE_PASS） */
  scanned: number
  /** 归档在位（哈希核过）——常态跳过数 */
  inPlace: number
  /** 本拍补收成功数（REPORT_MISSING 事件 + 哈希幂等搬运完成且回读核过） */
  repaired: number
  /** 哈希异/补收失败转人工数（绝不覆盖；事件已落） */
  manual: number
}

/** 单文件 sha256（内容哈希幂等的判定基元；读失败=undefined——调用面转人工） */
function sha256Of(file: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return undefined
  }
}

/** GATE_PASS note 的 report= 段（engine 落账口径：`；report=<abs>`——段分隔符全/半角分号兼收）——工位副本定位锚 */
function reportPathOfGatePass(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const m = /(?:^|[;；])report=([^;；]+)/.exec(note)
  return m !== null ? (m[1] as string) : undefined
}

/** 既有 REPORT_MISSING 事件的去重键（事件派生可重放——append-only 不释放；全/半角分号兼收） */
function reportedKeyOf(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  const m = /(?:^|[;；])recon-key=([^;；]+)/.exec(note)
  return m !== null ? (m[1] as string) : undefined
}

/**
 * 落位对账步（相位 4 尾，节流由 engine 控制）：
 *
 * 扫 PATROL job= 锚的收割成功单（GATE_PASS 在案）——jobs[].output 声明落点 × 公司目录
 * 实际文件比对。目标名=reportFileName(job, ticket, **GATE_PASS ts**)（与收割时
 * accountJobOutput 同刻同公式——重扫历史单不换日错名）。
 *
 * 判定序（每单）：
 *   1. 目标在位：工位副本不可考 → inPlace（归档在位即本步职责已了）；
 *      哈希同 → inPlace（**重复收割跳过**）；哈希异 → 落 REPORT_MISSING（conflict 变体，
 *      去重键含冲突标记）→ manual（**绝不覆盖**——迟到写入竞态安全，R6）；
 *   2. 目标缺（86 号工况）：**先事件**（REPORT_MISSING，recon-key 去重）**后搬运**——
 *      工位副本在 → 补收（mkdir+copy）+ **回读核哈希**（不核=负——spike-3 判负线），
 *      核过=rebared、核不过=manual；工位副本失考 → 事件（no-copy 变体）转人工；
 *   3. 非岗单/未声明落点/未收割成功 → 不扫（对账只治「写错位/漏收」，不治「没写」——
 *      94 号工况由收割面 HARVEST_INCOMPLETE 事件化，不在此补收不代写，R7）。
 *
 * throws 永不——一切异常折进 manual/onProblem（对账步不牵动拍语义）。
 */
export function runHarvestRecon(deps: HarvestReconDeps): HarvestReconResult {
  const { ledger, companyDir, emit } = deps
  const result: HarvestReconResult = { scanned: 0, inPlace: 0, repaired: 0, manual: 0 }
  try {
    // 事件派生索引（单次全量扫描——与 buildEventIndex 同量级，节流拍才跑）：
    const events = ledger.queryEvents()
    const jobIdOf = new Map<TicketId, string>() // PATROL job= 锚（首条口径与 accountJobOutput 同）
    const gatePass = new Map<TicketId, { ts: number; note: string | undefined; attempt: number }>()
    const reported = new Set<string>() // 既有 REPORT_MISSING recon-key（幂等去重）
    for (const e of events) {
      if (e.event === 'PATROL') {
        const m = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
        if (m !== null && !jobIdOf.has(e.issue)) jobIdOf.set(e.issue, m[1] as string)
      } else if (e.event === 'GATE_PASS' && !gatePass.has(e.issue)) {
        gatePass.set(e.issue, { ts: e.ts, note: e.note, attempt: e.attempt })
      } else if (e.event === 'REPORT_MISSING') {
        const key = reportedKeyOf(e.note)
        if (key !== undefined) reported.add(key)
      }
    }
    for (const [ticket, jobId] of jobIdOf) {
      const job = ledger.getJob(jobId)
      if (job === undefined) continue // job 失联（热更移除？）——无落点声明可对
      const output = parseJobOps(job.payload).output
      if (output === undefined) continue // 岗未声明 output
      const gate = gatePass.get(ticket)
      if (gate === undefined) continue // 未收割成功——非「漏收」面（94 号工况归收割面事件化）
      result.scanned += 1
      if (!isSafeRelativeOutputPath(output)) {
        // 装载期已过闸——热更/直写绕过残面：如实落事件转人工（对账不修复不合法落点）
        const key = `${ticket}|unsafe`
        if (!reported.has(key)) emit('REPORT_MISSING', ticket, gate.attempt, `落点不合法(output=${output})；recon-key=${key}；处置=人工`)
        result.manual += 1
        continue
      }
      const companyRoot = path.resolve(companyDir)
      const targetDir = path.resolve(companyRoot, output)
      if (targetDir !== companyRoot && !targetDir.startsWith(companyRoot + path.sep)) {
        const key = `${ticket}|escape`
        if (!reported.has(key)) emit('REPORT_MISSING', ticket, gate.attempt, `落点逃逸公司目录(output=${output})；recon-key=${key}；处置=人工`)
        result.manual += 1
        continue
      }
      const target = path.join(targetDir, reportFileName(job, ticket, gate.ts))
      const key = `${ticket}|${target}`
      const source = reportPathOfGatePass(gate.note)
      const targetHash = sha256Of(target)
      if (targetHash !== undefined) {
        // 目标在位——哈希核对（重复收割跳过 / 迟到写入冲突转人工）
        const srcHash = source !== undefined ? sha256Of(source) : undefined
        if (srcHash === undefined || srcHash === targetHash) {
          result.inPlace += 1
        } else {
          const conflictKey = `${key}|conflict`
          if (!reported.has(conflictKey)) {
            emit(
              'REPORT_MISSING',
              ticket,
              gate.attempt,
              `归档在位但哈希异（工位副本已变？）→转人工绝不覆盖；recon-key=${conflictKey}；target=${target}；src=${source ?? '-'}；hash=${srcHash.slice(0, 12)}≠${targetHash.slice(0, 12)}`,
            )
          }
          result.manual += 1
        }
        continue
      }
      // 目标缺（86 号工况）：先事件、后搬运
      if (source === undefined || !existsSync(source)) {
        if (!reported.has(key)) {
          emit(
            'REPORT_MISSING',
            ticket,
            gate.attempt,
            `缺归档且无工位副本可补（工位 REPORT 失考）→转人工；recon-key=${key}；target=${target}；src=${source ?? '-'}`,
          )
        }
        result.manual += 1
        continue
      }
      const srcHash = sha256Of(source)
      if (srcHash === undefined) {
        if (!reported.has(key)) {
          emit('REPORT_MISSING', ticket, gate.attempt, `工位副本不可读（哈希失考）→转人工；recon-key=${key}；src=${source}`)
        }
        result.manual += 1
        continue
      }
      if (!reported.has(key)) {
        emit('REPORT_MISSING', ticket, gate.attempt, `缺归档→补收（先事件后搬运）；recon-key=${key}；target=${target}；src=${source}；hash=${srcHash.slice(0, 12)}`)
      }
      try {
        mkdirSync(targetDir, { recursive: true })
        if (existsSync(target)) {
          // 搬运前复检（单写入者 daemon 下的竞态窗兜底）：在位即停——绝不覆盖
          const late = sha256Of(target)
          if (late === srcHash) {
            result.inPlace += 1
          } else {
            result.manual += 1
            deps.onProblem?.(`对账补收 ${ticket}：搬运前目标已在位且哈希异（迟到写入），不覆盖`)
          }
          continue
        }
        copyFileSync(source, target)
        // 补收后回读核哈希（spike-3 判负线：不核=负）
        const after = sha256Of(target)
        if (after === srcHash) {
          result.repaired += 1
        } else {          result.manual += 1
          deps.onProblem?.(`对账补收 ${ticket}：回读哈希不符（${after?.slice(0, 12) ?? '读失败'}≠${srcHash.slice(0, 12)}）——现场保留待人工`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.manual += 1
        deps.onProblem?.(`对账补收 ${ticket}：搬运失败(${msg})——现场保留待人工`)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.manual += 1
    deps.onProblem?.(`对账步索引失败：${msg}`)
  }
  return result
}
