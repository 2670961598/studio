/**
 * merge default-deps —— 合并跑真机端口（202-P2，studio-dev-232；merge-run.ts 的 spawn 版）
 *
 * 职责：serve realGate 模式装配 MergeRunDeps——
 *   - git 端口：argv 直跑 git 四原语＋代推（rev-parse/merge-base --is-ancestor/rev-list
 *     --parents/push origin <branch>）；只认退出码与 stdout 首行（不 shell——注入面封死：
 *     branch 名经 [-A-Za-z0-9/_.] 白名单闸）；
 *   - 门禁端口：**逐条真执行冻结验收命令**（与 createAcceptanceGateRunner 同语义：shell
 *     原文不改写、cwd=repo、独立进程组、超时杀整组、首条非零短路后续 skipped、超时=124、
 *     spawn 失败=127）——R1 引擎亲跑=同一事实源（serve acceptance 数组双消费）；
 *   - 超时缺省=ACCEPTANCE_GATE_TIMEOUT_MS（60s，plan 冻结口径；serve 可覆配）。
 *
 * 诚实边界（拟稿 P4）：push 无重试无对账（失败如实入 MERGE note，迁移照走——传输缝
 * 归 P4 重试/对账面）；输出采集截断留证（2k 字符，防倾泻撑爆 note）。
 */
import { spawn } from 'node:child_process'
import { ACCEPTANCE_GATE_TIMEOUT_MS } from '../gate.ts'
import type { MergeRunDeps } from './merge-run.ts'
import type { MergeGitPort } from './merge-gate.ts'

/** 输出采集上限（字符/命令——摘要留证即可，gate.ts 同口径） */
const OUTPUT_CAP = 2_000

/** 超时杀组后的收口宽限（fd 病态面强收口——sandbox/gate.ts 同款） */
const POST_KILL_GRACE_MS = 2_000

/** 分支名白名单（命令注入面封死：git 子命令 argv 仍经此闸——纵深一层） */
const BRANCH_RE = /^[-A-Za-z0-9/_.]+$/

/** 单命令执行（shell=git argv 面关／门禁原文开；cwd/独立进程组/超时 SIGKILL 整组——gate.ts runShell 同模式） */
async function runSpawn(
  cmdline: readonly string[],
  cwd: string,
  timeoutMs: number,
  shell: boolean,
): Promise<{ exitCode: number; timedOut: boolean; output: string }> {
  const child = spawn(cmdline[0] as string, cmdline.slice(1), { shell, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
      if (out.length < OUTPUT_CAP) out += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (out.length < OUTPUT_CAP) out += chunk.toString('utf8')
    })
    child.once('close', (code: number | null) => finish(code ?? (timedOut ? 124 : 1)))
    child.once('error', (err: Error) => {
      spawnError = err
      finish(127)
    })
  })
  if (spawnError !== undefined) out += `${out === '' ? '' : ' | '}${spawnError.message}`
  return { exitCode, timedOut, output: out.trim().slice(0, OUTPUT_CAP) }
}

/** 首行 stdout（sha 摄取面；空输出=undefined） */
function firstLine(output: string): string | undefined {
  const line = output.split('\n', 1)[0]?.trim() ?? ''
  return line === '' ? undefined : line
}

/** spawn 版 git 端口（merge-run.ts MergeGitPort 真实现；测试注入 fake） */
export function createSpawnMergeGitPort(opts?: { gitBin?: string; timeoutMs?: number }): MergeGitPort {
  const gitBin = opts?.gitBin ?? 'git'
  const timeoutMs = opts?.timeoutMs ?? ACCEPTANCE_GATE_TIMEOUT_MS
  return {
    async revParseHead(repoDir: string): Promise<string | undefined> {
      const r = await runSpawn([gitBin, 'rev-parse', 'HEAD'], repoDir, timeoutMs, false)
      return r.exitCode === 0 ? firstLine(r.output) : undefined
    },
    async branchTip(repoDir: string, branch: string): Promise<string | undefined> {
      if (!BRANCH_RE.test(branch)) return undefined
      const r = await runSpawn([gitBin, 'rev-parse', '--verify', `${branch}^{commit}`], repoDir, timeoutMs, false)
      return r.exitCode === 0 ? firstLine(r.output) : undefined
    },
    async isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean> {
      const r = await runSpawn([gitBin, 'merge-base', '--is-ancestor', ancestor, descendant], repoDir, timeoutMs, false)
      return r.exitCode === 0
    },
    async tipParentCount(repoDir: string, branch: string): Promise<number> {
      if (!BRANCH_RE.test(branch)) return 0
      const r = await runSpawn([gitBin, 'rev-list', '--parents', '-n', '1', branch], repoDir, timeoutMs, false)
      if (r.exitCode !== 0) return 0
      return Math.max(0, (firstLine(r.output) ?? '').split(/\s+/).length - 1) // 「<tip> <p1> …」→父数=token-1
    },
    async push(repoDir: string, branch: string): Promise<{ ok: boolean; note: string }> {
      if (!BRANCH_RE.test(branch)) return { ok: false, note: `分支名不过白名单：${branch}` }
      const r = await runSpawn([gitBin, 'push', 'origin', branch], repoDir, timeoutMs, false)
      return { ok: r.exitCode === 0, note: `git push origin ${branch} exit=${r.exitCode}${r.timedOut ? '(timeout)' : ''}${r.output !== '' ? ` out=${r.output}` : ''}` }
    },
  }
}

/** MergeRunDeps 缺省装配（serve realGate 面）：targetBranch 缺省 dev（R5）；门禁=acceptance 原文逐条 */
export function createDefaultMergeRunDeps(opts: {
  gateCommand: readonly string[]
  targetBranch?: string
  repoRelPath?: string
  timeoutMs?: number
}): MergeRunDeps {
  const timeoutMs = opts.timeoutMs ?? ACCEPTANCE_GATE_TIMEOUT_MS
  return {
    targetBranch: opts.targetBranch ?? 'dev',
    gateCommand: opts.gateCommand,
    ...(opts.repoRelPath !== undefined ? { repoRelPath: opts.repoRelPath } : {}),
    git: createSpawnMergeGitPort({ timeoutMs }),
    gate: {
      // 逐条真执行冻结验收命令（createAcceptanceGateRunner 同语义：首条非零短路；note 携逐条摘要）
      async run(repoDir: string): Promise<{ code: number; note: string }> {
        if (opts.gateCommand.length === 0) return { code: 1, note: '合并跑门禁：无冻结验收命令（不派工纪律——配置面错）' }
        const parts: string[] = []
        let verdict = 0
        for (let i = 0; i < opts.gateCommand.length; i += 1) {
          const cmd = opts.gateCommand[i] as string
          if (verdict !== 0) {
            parts.push(`[${i + 1}] skipped（前序已红）`)
            continue
          }
          const r = await runSpawn([cmd], repoDir, timeoutMs, true)
          parts.push(`[${i + 1}] ${cmd} exit=${r.exitCode}${r.timedOut ? '(timeout)' : ''}${r.output !== '' ? ` out=${r.output}` : ''}`)
          if (r.exitCode !== 0) verdict = r.exitCode
        }
        return { code: verdict, note: `合并跑门禁（引擎亲跑 R1）：${parts.join('；')}` }
      },
    },
  }
}
