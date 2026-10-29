/**
 * serve/run —— 常驻主循环启动与停机编排（`studio-next serve --config <daemon.yaml>`）
 *
 * 依据（实现单引用）：plan/05 IMPL-06-05「serve 拆分·config/runtime/run」；docs/v2/16 §三
 *   daemon 行（DISP-02：薄壳只留转发）；docs/17-§2（主循环七相位）；docs/16-§四 v0.5
 *   「主循环 + demo 端到端」；docs/38-§2（L1 热重载拍边界/优雅停）与 §4 R-B（在途接管）；
 *   docs/41-§2（控制面停机通道，DEV-9/DEV-41 去重语义）。
 *
 * 职责：runServe —— 配置装载＋台账打开＋在途接管＋公司目录装载＋Taiga 启动探针 →
 * buildServeRuntime 装配 → 信号可打断的 tick 循环（拍边界：L1 热重载/控制面停机/notify
 * 中继）→ 统一停机收口（停唤起源→在途 drain→关台账）＋停机回执。
 *
 * 行为边界：启动/停机顺序、错误码（CONFIG_INVALID 明报）、日志行与 ServeResult 语义与原
 * assembly/serve.ts 逐字迁移零漂移。本文件只编排生命周期——装配归 runtime.ts、配置面归
 * config.ts；RunServeOpts 是组合根（apps/boot）与 runServe 的唯一注入契约。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { InvokeSource } from '@studio-next/contract'
import { openLedgerWriter, type Ledger } from '@studio-next/store'
import { answerReloadNoCompanyDir } from '../../control/hot-reload.ts'
import { consumeStopRequest, readStopRequest, STOP_LAST_SEEN_KV_KEY, writeStopResult } from '../../control/stop-channel.ts'
import { takeOverRunningWorkRecords } from '../../engine/harvest/inflight-takeover.ts'
import { noopLinesOf, renderTick } from '../render/tick.ts'
import { DEMO_SNAPSHOT } from '../demo/demo-snapshot.ts'
import { wirePlatform } from '../platform/wire.ts'
import type { MatrixHrFace } from '../../engine/hrsync/hrsync.ts'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../engine/rooms/room-duty.ts'
import { parseDaemonConfig, type ServeConfig } from './config.ts'
import { buildServeRuntime } from './runtime.ts'

/** runServe 启动日志的闸门形态（buildServeRuntime 同判据：acceptance 配置给定=真单模式） */
function realGateMode(config: ServeConfig): boolean {
  return config.acceptance !== undefined
}

/** 常驻主循环结果（exit code 由调用方定：signal=0；error=1） */
export interface ServeResult {
  ticks: number
  stopReason: 'signal' | 'stop-request' | 'error'
  lastError?: string
}

/**
 * runServe 注入面（组合根 apps/boot 为唯一合法调用方）：matrix 系工厂/通知面/人事面——
 * daemon 不强依赖 @studio-next/matrix（25-§一.2），全部以结构同形接口注入；缺省不注入
 * 时对应开关打开=CONFIG_INVALID 拒启动（不静默空转）。
 */
export interface RunServeOpts {
  /**
   * matrix 源工厂（105-刀A A-3）：matrix: true 时注入（装配单元 apps/boot 构造
   * createMentionSource 产物——daemon 不强依赖 @studio-next/matrix）；缺省不注入
   * （matrix: true 且未注入=CONFIG_INVALID 拒启动）。
   */
  matrixSource?: () => InvokeSource
  /**
   * matrix 频道供给面工厂（130-P3 §6.7.3）：matrixChannels: true 时注入（apps/boot
   * 构造 createMatrixProvisionFace 产物）；缺省不注入（开而未注入=CONFIG_INVALID）。
   */
  matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
  /**
   * notify 广播面（105-刀B，studio-dev-219）：boot 组合根注入 createMatrixBroadcastFace
   * 产物（daemon 不 import @studio-next/matrix，同注入纪律）；注入后 serve 把它交给
   * buildServeRuntime（拍边界事件中继+escalate 警戒 IM 出口）。缺省不注入=面关零行为。
   */
  notifyBroadcast?: NotifyBroadcastFace
  /** matrix 人事执行面工厂（studio-dev-217，docs/52-§七）：boot 组合根注入
   * assembleMatrixHrFace 产物；缺省不注入（hrMatrix: true 且未注入=CONFIG_INVALID） */
  hrMatrixFace?: () => MatrixHrFace
}

/**
 * 常驻主循环：装配运行栈（jobs=true 时含调度器播种与启动）→ 循环 tick（tickMs 间隔，
 * 信号可打断等待）→ 信号/出错优雅停（runtime.stop 统一收口：停调度器→drain→关台账）。
 * 返回 ServeResult（exit code 由调用方定：signal=0；error=1）。
 */
export async function runServe(
  configPath: string,
  opts?: RunServeOpts,
): Promise<ServeResult> {
  const config = parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8'))
  // 台账写者围栏（PB-5 / PRB-14 正面；store/src/writer-lease.ts）：daemon 启动即取
  // `<db>.writer.lock`——另一 daemon 持锁且进程存活 ⇒ STALL/writer-lease-held 拒启
  // （message 含持有者 pid/owner，不覆盖锁文件）；前命崩溃留下的死 pid 锁清理一次后接管。
  // 停机由 runtime.stop → ledger.close 先关库再释放锁（顺序见 store openLedgerWriter）。
  const ledger: Ledger = openLedgerWriter(path.resolve(config.db))

  // —— 在途接管（DEV-13 R-B，docs/38-§2）：serve 启动例行接管 work_records running ——
  //    前命孤儿（硬杀/优雅停留 running 同款）收口 interrupted；接管≠收割（四要件无据不
  //    判），重派新 attempt、预算沿用未结预留（adopt）；最早落位=纯台账面零平台 IO。
  const takeover = takeOverRunningWorkRecords(ledger, Date.now())
  console.log(
    takeover.takenOver > 0
      ? `[serve] 在途接管（R-B）：${takeover.takenOver} 条前命孤儿 running 工位收口 interrupted（${takeover.items.map((i) => `${i.issue}#att${i.attempt}`).join('、')}）——接管≠收割（四要件无据不判）；重派走新 attempt、预算沿用未结预留`
      : '[serve] 在途接管（R-B）：0 条前命孤儿 running 工位（无在途账待接管）',
  )

  let stopped = false
  let stopReason: ServeResult['stopReason'] = 'signal'
  let lastError: string | undefined
  const onSignal = (): void => {
    stopped = true
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let snapshot = DEMO_SNAPSHOT
  if (config.companyDir !== undefined) {
    // 公司目录装载（校验不过拒绝启动——04-§九；daemon 只读快照不写目录）
    const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')
    const files = await readDirectoryFiles(path.resolve(config.companyDir))
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      ledger.close()
      throw new Error(`公司目录校验不通过（拒绝启动）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`)
    }
    snapshot = mounted.snapshot
  }

  // —— Taiga 启动探针（fail-fast，platform: taiga 时）：一次只读 fields.schema() 拉通
  //    网络→auth→项目解析→状态集四层任一不通=启动期明报 exit 1（不等首拍炸）；探针只读
  //    即弃、置于装配前；engine 平台独立构造（网关收口不受影响）。
  if (config.platform === 'taiga') {
    try {
      const schema = await wirePlatform(config).fields.schema()
      console.log(`[serve] Taiga 启动探针通过：schema ${String(schema.length)} 字段（auth/项目/状态集连通）`)
    } catch (err) {
      ledger.close()
      throw new Error(
        `CONFIG_INVALID：Taiga 启动探针失败（检查 taigaUrl/taigaProject/taigaAuth 凭据 env/平台状态集）：` +
        `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const { engine, sources, stop, hotReload, notifyRelay, api, ops } = buildServeRuntime(config, ledger, snapshot, {
    ...(opts?.matrixSource !== undefined ? { matrixSource: opts.matrixSource } : {}),
    ...(opts?.matrixRoomFace !== undefined ? { matrixRoomFace: opts.matrixRoomFace } : {}),
    ...(opts?.notifyBroadcast !== undefined ? { notifyBroadcast: opts.notifyBroadcast } : {}),
    ...(opts?.hrMatrixFace !== undefined ? { hrMatrixFace: opts.hrMatrixFace } : {}),
  })
  // PORT-OPS 装配面（OPS 补形 A）：runtime 已把 emergencyStop/circuitBreak 接到
  // REC-WORK-18 → PORT-HIST（assembly/ops）。runServe **只持有装配面、不自动触发**
  // emergencyStop——控制面停机仍走 stop-channel 文件协议（行为/顺序不变）。
  void ops

  // 未挂公司目录的 daemon：L1 热重载不适用——reload 请求仍回执拒绝（不悬空 CLI 轮询）
  let answeredRequestId: string | null = null
  // 控制面停机请求的去重位（DEV-41 ①：落 daemon_kv 跨重启——重启读回，残留请求不当新
  // 请求消费；旧口径只存内存，daemon 重启即失忆，taiga6 一拍自停事故根因）
  let stopLastSeenId: string | null = ledger.kvGet(STOP_LAST_SEEN_KV_KEY)
  // 本进程已应答的停机请求 id（回执面：只对本进程消费的请求落回执——kv 读回的旧 id 不复回）
  let honoredStopId: string | null = null
  // 残留请求去重观测（静默去重=观察黑洞）：启动期 live 请求与 kv 去重位命中即落一行
  const residualStop = readStopRequest(path.resolve(config.rootDir))
  if (residualStop !== undefined && residualStop.id === stopLastSeenId) {
    console.log(`[serve] 残留停机请求已去重（id=${residualStop.id}，daemon_kv 读回——DEV-41）：不当新请求消费，正常起拍`)
  }

  console.log(`[serve] studio-next daemon 启动（company=${config.company} platform=${config.platform} db=${path.resolve(config.db)} tickMs=${config.tickMs}${config.jobs ? ` jobs=on pollMs=${config.jobPollMs}` : ''}）`)
  const stackMode =
    config.platform === 'localfile'
      ? `LocalFile 平台（${path.resolve(config.platformDir ?? path.join(config.rootDir, 'platform'))}）`
      : config.platform === 'taiga'
        ? `Taiga 平台（${config.taigaUrl ?? '?'} 项目=${config.taigaProject ?? '?'} 实体=${config.taigaEntity ?? 'userstory'}）`
        : 'fake 平台（demo）'
  const execMode = config.agentYaml !== undefined ? `真 executor（agent.yaml=${config.agentYaml}）` : 'fake executor（demo）'
  const gateMode = realGateMode(config) ? '真验收闸门（冻结验收命令真执行）' : '占位闸门（exit0 模拟）'
  console.log(`[serve] 栈形态：${stackMode} + ${execMode} + ${gateMode}（边界见 src/assembly/serve.ts 头注）`)
  // —— 对外 API 起监听（MIG-06 欠账收口；v2/14 §四）：同进程装配已在 buildServeRuntime 完成，
  //    此处只起 node:http 壳（apiPort 缺省 0=ephemeral）——失败=CONFIG_INVALID 拒启，不静默半面。
  try {
    await api.start()
  } catch (err) {
    await stop()
    throw new Error(
      `CONFIG_INVALID：对外 API 监听失败（apiPort=${String(config.apiPort ?? 0)}）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  // 唤起源统一启动（22-§一）：各源 start(emit)——emit 统一进引擎 ingest 队列，
  // 下一拍 state-diff 前消费；单源启动异常由注册表隔离（捕获+计数+继续，src/engine/sources.ts）
  sources.startAll((intent) => {
    engine.ingest([intent])
  })

  let ticks = 0
  while (!stopped) {
    try {
      const report = await engine.tick()
      ticks += 1
      console.log(`[serve] ${renderTick(report)}`)
      // noop 观测面（见 renderNoopDecision 头注）：静默 noop=观察黑洞，逐条落行
      for (const line of noopLinesOf(report)) console.log(line)
      for (const err of report.errors) console.error(`[serve] tick#${report.seq} 错误：${err}`)
      // —— notify 事件中继（105-刀B，studio-dev-219；notifyBroadcast 注入时存在）：拍边界
      //    只读本拍新事件（TickReport.events）按冻结路由表广播 #alert/部门频道/总览。
      //    fire-and-forget：IM 投递永不阻塞/打断主循环（沟通面非执行前置，刀B-6——矩阵
      //    挂=软失败日志+计量 failed，面板仍第一落点）；relayEvents 恒不抛（双保险 catch）。
      if (notifyRelay !== undefined && report.events.length > 0) {
        void notifyRelay(report.events).catch((): void => {})
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      stopReason = 'error'
      break
    }
    // —— L1 热重载拍边界（docs/38-§2）：tick() 已收口、下一拍未开——指纹自动 + 控制面手动
    //    两触发面在此汇合；check() 恒不抛（失败面已落 ESCALATE/回执，hot-reload.ts 头注） ——
    if (hotReload !== undefined) {
      await hotReload.check()
    } else {
      answeredRequestId = answerReloadNoCompanyDir(path.resolve(config.rootDir), config.company, answeredRequestId)
    }
    // —— 控制面停机通道（DEV-9 顺带项，src/control/stop-channel.ts；DEV-41 重启失忆修复）：reload
    //    应答在前、停机请求在后；按 id 去重双保险：①先落 daemon_kv（改名前崩由重启读回
    //    兜底）②原子改名 .consume。拍边界纪律不变（17-§2——停机也是拍收口面）。
    const stopRequest = readStopRequest(path.resolve(config.rootDir))
    if (stopRequest !== undefined && stopRequest.id !== stopLastSeenId) {
      stopLastSeenId = stopRequest.id
      honoredStopId = stopRequest.id
      // ① 去重位先落台账（crash 窗口兜底：②改名前崩——重启后 kv 读回即去重）
      ledger.kvSet(STOP_LAST_SEEN_KV_KEY, stopRequest.id)
      // ② 消费请求（原子改名 .consume；失败不阻断停机——①已兜底）
      const consumed = consumeStopRequest(path.resolve(config.rootDir))
      stopped = true
      stopReason = 'stop-request'
      console.log(
        `[serve] 控制面停机请求（id=${stopRequest.id}${stopRequest.reason !== undefined ? ` reason=${stopRequest.reason}` : ''}）——本拍已收口，优雅停开始` +
          `${consumed ? '（请求已消费：live 改名 .consume——重启见无请求即正常起）' : '（请求消费失败——daemon_kv 去重位兜底）'}`,
      )
    }
    // 拍间隔等待（信号打断不硬等满）
    const deadline = Date.now() + config.tickMs
    while (!stopped && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())))
    }
  }

  console.log(`[serve] 停机（${stopReason}${lastError !== undefined ? `：${lastError}` : ''}）——先停唤起源（不进新意图）+ 在途 drain`)
  await stop()
  console.log('[serve] 已优雅关闭（台账落盘；在途 work_records 留 running——重启启动例行接管收口（R-B））')
  // 控制面停机回执（src/control/stop-channel.ts）：优雅停收口**之后**落——CLI 见回执即在途
  // worker 已整树杀、台账已落盘（孤儿进程面闭环）。只回本进程应答的请求（honoredStopId）：
  // kv 读回的旧 id 属上一进程的应答面，不复回（旧回执仍在盘，按 id 匹配不误读）
  if (honoredStopId !== null) {
    writeStopResult(path.resolve(config.rootDir), {
      id: honoredStopId,
      ok: true,
      stopped: true,
      detail: `优雅停收口完成：ticks=${ticks}（停唤起源→在途 drain→worker 整树杀→台账落盘）`,
    })
  }
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
