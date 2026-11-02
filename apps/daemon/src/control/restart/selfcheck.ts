/**
 * control/restart/selfcheck —— 重启后四口径自检（studio-dev-504 S5）
 *
 * 依据（实现单引用）：#497 plan §4.8（tick 在走 / cursor 前进 / 模型配置装载 / 执行面探针
 *   ＋ takeover 交叉核对；超时各自封顶，不阻塞主循环首拍；失败即 ALARM、不宣称已恢复）、
 *   §4.10（versionAlign：repoHead 不可得=unknown，不伪造）；docs/17-§2（自检不增删相位）。
 *
 * 本模块是**纯判定器**：探针/时钟/台账读面全部注入，零 IO——四口径各自的 fail 注入可单测
 * （N10）。落盘/事件/ALARM 由 serve 编排（run.ts）。
 */
import type { RestartCheckpoint, RestartSelfcheckReport, SelfcheckCheck } from './checkpoint.ts'

/** 自检探针（serve 装配注入；全部同步读取，自检本身不阻塞主循环） */
export interface RestartSelfcheckProbes {
  /** 当前进程已跑拍数 */
  ticksSinceStart: number
  /** 台账 tick.seq（启动后读活值） */
  tickSeq: () => number
  /** 台账 activity.cursor（空串/缺键=null） */
  cursor: () => string | null
  /** 启动后是否已落过 HEARTBEAT（cursor 无新活动时的旁证） */
  heartbeatSeen: () => boolean
  /** 本拍出现 cursorLoop 观测（游标回退环=fail） */
  cursorLoopSeen: () => boolean
  /** 模型配置装载面（demo/fake 形态=no catalog 属预期；有 agentYaml 却无 catalog=坏） */
  models: () => { catalogLoaded: boolean; mainWorkerTier: string | undefined; demoBypass: boolean }
  /** 执行面探针（registry.list() 非空 + 配置引用 executor detect 全 ok） */
  executor: () => { count: number; failures: readonly string[] }
  /** 新进程在途接管数（与检查点交叉核对） */
  takeover: () => number
  /** 版本对齐（repoHead 不可得=unknown，降为告警不 fail） */
  versionAlign: () => RestartSelfcheckReport['versionAlign']
  now: () => number
  /** tick 口径窗口（restartSelfcheckTicks 缺省 3） */
  minTicks: number
}

const pass = (detail: string): SelfcheckCheck => ({ pass: true, detail })
const fail = (detail: string): SelfcheckCheck => ({ pass: false, detail })

/** 执行四口径判定（纯函数；返回报告对象，落盘由调用方做） */
export function evaluateRestartSelfcheck(
  checkpoint: RestartCheckpoint,
  probes: RestartSelfcheckProbes,
): RestartSelfcheckReport {
  const seq = probes.tickSeq()
  const tick = probes.cursorLoopSeen()
    ? fail(`cursorLoop 观测（游标回退环）；seq=${seq}`)
    : seq > checkpoint.tickSeq && probes.ticksSinceStart >= probes.minTicks
      ? pass(`seq ${checkpoint.tickSeq}→${seq}，启动后 ${probes.ticksSinceStart} 拍（≥${probes.minTicks}）`)
      : fail(`seq 未前进或拍数不足：checkpoint=${checkpoint.tickSeq} 当前=${seq} 启动后拍数=${probes.ticksSinceStart}（需 ≥${probes.minTicks}）`)

  const cursor = probes.cursor()
  const cursorCheck =
    cursor !== null && cursor !== checkpoint.cursor
      ? pass(`cursor ${checkpoint.cursor ?? 'null'}→${cursor}`)
      : cursor === checkpoint.cursor && probes.heartbeatSeen()
        ? pass(`cursor 与检查点相同（${cursor ?? 'null'}），HEARTBEAT 在走且平台探针已通过首拍`)
        : cursor === checkpoint.cursor
          ? fail(`cursor 未前进且无 HEARTBEAT 旁证（${cursor ?? 'null'}）`)
          : fail('activity.cursor 为空（采集未落位）')

  const modelsProbe = probes.models()
  const modelsCheck =
    modelsProbe.catalogLoaded && modelsProbe.mainWorkerTier !== undefined
      ? pass(`models.yaml 已装载；roles.main_worker→${modelsProbe.mainWorkerTier}`)
      : modelsProbe.demoBypass
        ? pass('demo/fake 形态无 models.yaml（无模型配置可装载，按面关通过）')
        : fail(
            `模型配置未装载或 roles.main_worker 不可解析（catalogLoaded=${modelsProbe.catalogLoaded}，tier=${modelsProbe.mainWorkerTier ?? 'null'}）`,
          )

  const execProbe = probes.executor()
  const executorCheck =
    execProbe.count > 0 && execProbe.failures.length === 0
      ? pass(`registry.list()=${execProbe.count}，配置引用 executor detect 全 ok`)
      : execProbe.count === 0
        ? fail('executor 注册表为空')
        : fail(`executor detect 失败：${execProbe.failures.join('、')}`)

  // 交叉核对：检查点时刻仍未结算的在途数 = 请求时在途 − 已自然结算 − 已超时收口；
  // 它们都已 ended（done/interrupted），新进程不应再接管（takeover 应为 0）。拿原始
  // inflightBefore 直接比会把「自然跑完」误判成不一致。
  const expected = Math.max(0, checkpoint.inflightBefore - checkpoint.settled.length - checkpoint.interrupted.length)
  const actual = probes.takeover()
  const inflightReconcile = { expected, actual, pass: expected === actual }

  const checks = { tick, cursor: cursorCheck, models: modelsCheck, executor: executorCheck }
  const result = Object.values(checks).every((c) => c.pass) && inflightReconcile.pass ? 'pass' : 'fail'
  return {
    schema: 1,
    at: probes.now(),
    requestId: checkpoint.requestId,
    checkpointRef: checkpoint.eventId,
    result,
    checks,
    inflightReconcile,
    versionAlign: probes.versionAlign(),
  }
}
