/**
 * crash-points —— 崩溃注入回归集测试基建（F3-11，v0.10；测试专用，不进 src）
 *
 * 与 src/crash-points.ts 的分工：
 *   - src/crash-points.ts = 受控测试缝（env 门控 crashHook + 五点冻结表——调用点在生产代码）；
 *   - 本文件 = spawn 侧测试基建：真 serve 进程拉起/日志就绪等待（READY 信号模式——
 *     packages/adapters kill 测试竞态教训：**等日志信号再动手**，不盲等定时）/ 欠账岗
 *     播种与重挂 / 存活进程清场。
 *
 * fake 平台失忆补偿（诚实边界，测试头注同款说明）：
 *   demo fake 平台（createFakePlatform）状态在 serve 进程内存——SIGKILL 后单据与活动流
 *   随进程消亡，而真实平台（YouTrack/localfile）单据存续。重启后的「等价工作再驱动」由
 *   重挂欠账岗（next_run_at=1）承载：调度器再触发→岗单据重建（票号 T-1 与账面旧迹同 id=
 *   真实平台单据存续的模拟面）。重挂补偿的是 fake 的失忆，**不绕过引擎幂等**——判重仍以
 *   台账事件（receipt）为准：attempt=DISPATCH 计数+1、意图键去重、预算 adopt 沿用。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLedger } from '@studio-next/store'
import type { CrashPoint } from '../src/crash-points.ts'

/** daemon CLI 入口（scheduler.test 同款解析手法） */
export const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/bin.ts')

/** serve 配置形态（崩溃注入集用的最小面） */
export interface ServeConfigSpec {
  tickMs: number
  /** 调度轮询间隔（缺省 200ms——欠账岗尽快触发） */
  jobPollMs?: number
  /** 定时岗开关（缺省开——①②③⑤的工作源；④关） */
  jobs?: boolean
}

/** 写 daemon.yaml（扁平子集；db/rootDir 落绝对路径——cwd 无关） */
export function writeServeConfig(dir: string, spec: ServeConfigSpec): string {
  mkdirSync(dir, { recursive: true })
  const configPath = path.join(dir, 'daemon.yaml')
  writeFileSync(
    configPath,
    [
      `db: ${path.join(dir, 'ledger.sqlite')}`,
      'platform: fake',
      'company: demo',
      `rootDir: ${dir}`,
      `tickMs: ${spec.tickMs}`,
      `jobPollMs: ${spec.jobPollMs ?? 200}`,
      'autoApprove: true',
      `jobs: ${spec.jobs === false ? 'false' : 'true'}`,
    ].join('\n'),
    'utf8',
  )
  return configPath
}

/**
 * 播种/重挂欠账岗（daily-report，工单型岗 type='report'，next_run_at=1=远过去——seedJobs
 * 保欠账、调度器首拍补跑）。serve 启动前调用（顺序写库，避开与运行中 serve 的并发写）；
 * 崩溃后重启前同函数重挂=模拟真实平台的单据存续再驱动（见文件头注「失忆补偿」）。
 *
 * 岗选型（DEV-40 落位分型）：崩溃注入集的工作源必须走「物化→派发→收割」链——故用
 * 工单型岗（type='report'）。job_id 取 'daily-report'（不在 DEMO_SNAPSHOT 内）：快照
 * 播种（seedJobs）不覆盖该行，payload 保持在位；若复用快照内 'health-patrol'（demo
 * 巡查岗 type='patrol'）会被快照行覆写为巡查工件落终态，dispatch 链断（崩溃点不可达）。
 */
export function seedDueJob(dir: string): void {
  const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
  ledger.upsertJob({
    job_id: 'daily-report',
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    next_run_at: 1,
    payload: { type: 'report' },
  })
  ledger.close()
}

// ————————————————————————— spawn 面就绪信号基建 —————————————————————————

/** 拉起的 serve 进程句柄（日志累积+就绪等待+退出面） */
export interface ServeProc {
  child: ChildProcess
  /** stdout 累积（就绪信号与拍序断言的观测面） */
  stdout(): string
  /** stderr 累积（优雅停断言：应为空） */
  stderr(): string
  /**
   * 等待 stdout 出现模式（READY 信号模式：日志行=相位已到的就绪信号，再动手）。
   * from=从此下标起搜（顺序等待多次信号用）；返回匹配末下标（下次 from）。
   */
  waitFor(re: RegExp, opts?: { from?: number; timeoutMs?: number; what?: string }): Promise<number>
  /** 退出面（code/signal 一次定局） */
  exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

/** 存活进程登记（断言失败时 afterAll 清场，防悬挂子进程拖死测试进程） */
const live = new Set<ChildProcess>()

/** 强杀登记在册的存活进程（afterAll 清场兜底） */
export function killSurvivors(): void {
  for (const child of live) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    live.delete(child)
  }
}

/** 拉起真 serve 进程：`node bin.ts serve --config <yaml>`；crashPoint 给出=注入开启（env 门控） */
export function spawnServe(configPath: string, crashPoint?: CrashPoint): ServeProc {
  const env: Record<string, string | undefined> = { ...process.env }
  if (crashPoint === undefined) delete env.SN_CRASH_POINT // 重启进程必须干净（否则同点再自杀）
  else env.SN_CRASH_POINT = crashPoint
  const child = spawn(process.execPath, [BIN, 'serve', '--config', configPath], { encoding: 'utf8', env })
  live.add(child)
  let out = ''
  let err = ''
  child.stdout?.on('data', (d: string) => {
    out += d
  })
  child.stderr?.on('data', (d: string) => {
    err += d
  })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      live.delete(child)
      resolve({ code, signal })
    })
  })
  return {
    child,
    stdout: (): string => out,
    stderr: (): string => err,
    async waitFor(re, opts): Promise<number> {
      const from = opts?.from ?? 0
      const deadline = Date.now() + (opts?.timeoutMs ?? 20_000)
      for (;;) {
        const m = re.exec(out.slice(from))
        if (m !== null) return from + m.index + m[0].length
        if (Date.now() > deadline) {
          throw new Error(
            `等待 serve 日志超时（${opts?.what ?? String(re)}）——stdout 尾部：\n${out.slice(-2000)}`,
          )
        }
        await new Promise((r) => setTimeout(r, 25))
      }
    },
    exited: () => exit,
  }
}

/** 从 stdout 解析拍序（tick#N 日志行——tick.seq 持久化续用断言的观测面） */
export function tickSeqs(stdoutText: string): number[] {
  const out: number[] = []
  for (const m of stdoutText.matchAll(/tick#(\d+)/g)) out.push(Number.parseInt(m[1] ?? '0', 10))
  return out
}

/** 新建测试根（每 kill 点一目录：库/工位/配置同目录——重启复用同库同目录） */
export async function newCaseRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `studio-next-crash-${name}-`))
}
