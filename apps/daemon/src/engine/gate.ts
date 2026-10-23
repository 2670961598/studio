/**
 * gate —— 收割四要件的闸门执行器端口（docs/17-§6 末：收割成功契约）
 *
 * 成功契约四要件（17-§6 冻结口径）：
 *   1. 终态事件 completed —— 由 engine 消费 adapter.stream() 的 turn_end.completed 判定；
 *   2. 输出非空          —— 由 engine 判定（存在非空 log 文本，dsh 口径近似，见 adapters/dsh.ts 头注）；
 *   3. REPORT 落盘       —— **本端口职责**（可注入）；
 *   4. 闸门 exit=0       —— **本端口职责**（可注入）。
 *
 * v0 默认实现 createDefaultGateRunner（**诚实标注：v0 占位**）：
 *   - REPORT 落盘 = 检查 briefPath 同目录约定文件 REPORT.md 存在（workspace 约定：
 *     <rootDir>/workspaces/<单号>/att<N>/REPORT.md）；
 *   - 闸门 exit=0 = **模拟**——不真跑冻结验收命令（验收命令的装载与执行归 v0.5 真单刀），
 *     reportExists ? 0 : 1；
 *   - summary.json sidecar 若存在则一并回报（engine 落 work_records.summary_ref），
 *     不存在不拦收（v0 拟稿：sidecar 必须性待批示——contract SummarySidecarSchema 已冻结形状）。
 *
 * TODO(v0.5 真单前)：真 gateRunner = 读任务书冻结验收命令 → 子进程执行 → 采集退出码与
 * 验收产物（REPORT 骨架校验走 contract validateReportDocument / validateSummarySidecar）。
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

/** 闸门输入（engine 收割相位组装） */
export interface GateInput {
  ticket: string
  attempt: number
  workspace: string
  briefPath: string
}

/** 闸门结论：四要件中第 3/4 要件的事实回报（第 1/2 要件归 engine 流消费侧） */
export interface GateOutcome {
  /** 闸门退出码（0=过；非 0=验收红——GATE_FAIL 子因之一） */
  exitCode: number
  /** REPORT 是否落盘（要件 3） */
  reportExists: boolean
  /** REPORT 落点（存在时回填；engine 落 work_records.report_ref 与 GATE_PASS note） */
  reportPath: string
  /** summary.json sidecar 落点（存在时回填；不存在=undefined） */
  summaryPath?: string
  note?: string
}

/** 闸门执行器端口：v0 默认实现见 createDefaultGateRunner；真验收命令版归 v0.5 真单刀 */
export interface GateRunner {
  run(input: GateInput): Promise<GateOutcome>
}

/** briefPath 同目录的 REPORT/summary 约定文件名（workspace 约定，拟稿待批） */
export const REPORT_FILENAME = 'REPORT.md'
export const SUMMARY_FILENAME = 'summary.json'

/**
 * summary.json sidecar 工位发现（studio-dev-216 写读对齐）：
 *   - 正位＝brief 同目录（与 REPORT.md 同级——docs/17-§6「REPORT 旁落」约定落点）；
 *   - 容错兜底＝`deliverables/summary.json`（212 实证：任务书验收命令常含 deliverables/
 *     路径，worker 会把 sidecar 落进同目录——值形状全对、落位偏一格即整链断：gate 看不见
 *     → accountJobOutput 不随件归档 → P3 哨兵门读归档侧车=unreadable → 误报
 *     SENTINEL_MISSING）。发现面收正位+兜底两位，哨兵核验语义零改动（找到什么读什么，
 *     三元组不符照旧 mismatch——fail-closed 不放松）。
 *   - 找不到=undefined（要件外观测面，不拦收割——v0 拟稿：sidecar 必须性待批示）。
 */
export function discoverSummaryPath(dir: string): string | undefined {
  const canonical = path.join(dir, SUMMARY_FILENAME)
  if (existsSync(canonical)) return canonical
  const deliverables = path.join(dir, 'deliverables', SUMMARY_FILENAME)
  return existsSync(deliverables) ? deliverables : undefined
}

/**
 * v0 占位闸门（诚实标注：不跑真验收命令）——
 * REPORT 落盘=同目录约定文件存在性检查；exit0=存在即模拟 0、缺失即 1。
 */
export function createDefaultGateRunner(): GateRunner {
  return {
    async run(input: GateInput): Promise<GateOutcome> {
      const reportPath = path.join(path.dirname(input.briefPath), REPORT_FILENAME)
      const summaryPath = discoverSummaryPath(path.dirname(input.briefPath))
      const reportExists = existsSync(reportPath)
      return {
        exitCode: reportExists ? 0 : 1,
        reportExists,
        reportPath,
        ...(summaryPath !== undefined ? { summaryPath } : {}),
        note: reportExists
          ? `v0 占位闸门：REPORT 存在即 exit0 模拟（真验收命令归 v0.5 真单刀）；size=${statSync(reportPath).size}`
          : 'v0 占位闸门：REPORT 未落盘（四要件第 3 条不满足）',
      }
    },
  }
}

// ————————————————————————— 真验收闸门（v0.5 真单刀） —————————————————————————

/** 真验收闸门缺省超时（ms/命令）：验收命令挂死不许挡收割（sandbox 同精神） */
export const ACCEPTANCE_GATE_TIMEOUT_MS = 60_000

/** 真验收闸门输出采集上限（字符/命令；防验收命令倾泻大输出撑爆 note——摘要留证即可） */
const ACCEPTANCE_OUTPUT_CAP = 2_000

/** 超时杀组后的收口宽限（ms；fd 被 escaped 进程持有等病态面强收口——sandbox 同款） */
const POST_KILL_GRACE_MS = 2_000

/**
 * 真验收闸门（docs/16-§四 v0.5「闸门 exit=0」的真执行面；TODO 清偿）：
 *   - 要件 3（REPORT 落盘）：同目录约定文件存在且**非空**（size>0——空文件不算落盘）；
 *   - 要件 4（闸门 exit=0）：**逐条真执行冻结验收命令**（与任务书 L4 acceptance 同一事实源，
 *     serve 侧单一数组双消费）——shell 子进程、cwd=workspace、独立进程组、超时杀整组
 *     （子进程执行模式对齐 src/evolve/sandbox.ts：detached+process-group kill，零新依赖）；
 *   - 退出码口径：REPORT 缺失/为空 → 1（前置失败，不再跑命令）；否则取**首条非零命令**的
 *     退出码（未跑到的后续命令如实标注 skipped——命令间短路语义交由命令文本自身（&&/;），
 *     闸门只认逐条退出码）；超时=124（timeout(1) 惯例码）+ note 明示；spawn 失败=127；
 *   - note 携逐条命令的退出码与输出摘要（截断留证）——GATE_FAIL 子因据此可读。
 * 验收命令属「冻结验收口径」：执行原文即任务书呈现原文，闸门不改写不解释。
 */
export function createAcceptanceGateRunner(
  acceptance: readonly string[],
  opts?: { timeoutMs?: number },
): GateRunner {
  const timeoutMs = opts?.timeoutMs ?? ACCEPTANCE_GATE_TIMEOUT_MS
  if (acceptance.length === 0) {
    throw new Error('gate: 真验收闸门须配至少一条冻结验收命令（无验收不派工——纪律 3）')
  }
  return {
    async run(input: GateInput): Promise<GateOutcome> {
      const dir = path.dirname(input.briefPath)
      const reportPath = path.join(dir, REPORT_FILENAME)
      const summaryPath = discoverSummaryPath(dir)
      const size = existsSync(reportPath) ? statSync(reportPath).size : 0
      const reportExists = size > 0 // 空 REPORT=未落盘（「非空输出」同精神，不粉饰）
      if (!reportExists) {
        return {
          exitCode: 1,
          reportExists: false,
          reportPath,
          ...(summaryPath !== undefined ? { summaryPath } : {}),
          note: `真验收闸门：REPORT 未落盘或为空（${reportPath}）——四要件第 3 条不满足，验收命令不跑`,
        }
      }
      const parts: string[] = [`REPORT size=${size}`]
      let verdict = 0
      for (let i = 0; i < acceptance.length; i += 1) {
        const cmd = acceptance[i] as string
        if (verdict !== 0) {
          parts.push(`[${i + 1}] skipped（前序已红）`)
          continue
        }
        const r = await runShell(cmd, dir, timeoutMs)
        parts.push(`[${i + 1}] exit=${r.exitCode}${r.timedOut ? '(timeout)' : ''}${r.output !== '' ? ` out=${r.output}` : ''}`)
        if (r.exitCode !== 0) verdict = r.exitCode
      }
      return {
        exitCode: verdict,
        reportExists: true,
        reportPath,
        ...(summaryPath !== undefined ? { summaryPath } : {}),
        note: `真验收闸门：${parts.join('；')}`,
      }
    },
  }
}

/** 单条验收命令执行（sandbox.ts 同款：shell+cwd+独立进程组+超时 SIGKILL 整组） */
async function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean; output: string }> {
  const child = spawn(command, {
    shell: true,
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let timedOut = false
  let spawnError: Error | undefined
  const exitCode = await new Promise<number>((resolve) => {
    let settled = false
    let graceTimer: NodeJS.Timeout | undefined
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      resolve(code)
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      } else {
        child.kill('SIGKILL')
      }
      graceTimer = setTimeout(() => finish(124), POST_KILL_GRACE_MS)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < ACCEPTANCE_OUTPUT_CAP) out += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (out.length < ACCEPTANCE_OUTPUT_CAP) out += chunk.toString('utf8')
    })
    child.once('close', (code: number | null) => finish(code ?? (timedOut ? 124 : 1)))
    child.once('error', (err: Error) => {
      spawnError = err
      finish(127)
    })
  })
  if (spawnError !== undefined) out += `${out === '' ? '' : ' | '}${spawnError.message}`
  return { exitCode, timedOut, output: out.trim().slice(0, ACCEPTANCE_OUTPUT_CAP) }
}
