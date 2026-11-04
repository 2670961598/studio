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
import { openLedgerWriter, verifyEventsChain, type Ledger } from '@studio-next/store'
import { answerReloadNoCompanyDir } from '../../control/hot-reload.ts'
import { consumeStopRequest, readStopRequest, STOP_LAST_SEEN_KV_KEY, writeStopResult } from '../../control/stop-channel.ts'
import { writeExitMarkOnStop } from '../../control/restart/checkpoint.ts'
import type { TickReport } from '../../engine/tick-report/types.ts'
import { takeOverRunningWorkRecords } from '../../engine/harvest/inflight-takeover.ts'
import { noopLinesOf, renderTick } from '../render/tick.ts'
import { DEMO_SNAPSHOT } from '../demo/demo-snapshot.ts'
import { loadCompanyAtBoot } from '../assets/boot.ts'
import { wirePlatform } from '../platform/wire.ts'
import type { MatrixHrFace } from '../../engine/hrsync/hrsync.ts'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../engine/rooms/room-duty.ts'
import { parseDaemonConfig, type ServeConfig } from './config.ts'
import { buildServeRuntime } from './runtime.ts'
import type { SecretDeclarationInput } from '../trust/wire.ts'
import { RestartOrchestrator, readRestartStartupFace } from './restart/orchestrator.ts'
import { buildHealthz } from '../api/healthz.ts'
import { createReportsCommitFace } from './reports-commit.ts'

/** runServe 启动日志的闸门形态（buildServeRuntime 同判据：acceptance 配置给定=真单模式） */
function realGateMode(config: ServeConfig): boolean {
  return config.acceptance !== undefined
}

/** 常驻主循环结果（exit code 由调用方定：signal=0；error=1；restart=0；restart-failed=1） */
export interface ServeResult {
  ticks: number
  stopReason: 'signal' | 'stop-request' | 'error' | 'restart' | 'restart-failed'
  lastError?: string
  /** 受权重启成功面的检查点证据（exit 0 + last-exit.json 之外的结构化回执） */
  restart?: { requestId: string; checkpointPath: string; checkpointHash: string; interrupted: number }
}

/**
 * runServe 注入面（组合根 apps/boot 为唯一合法调用方）：matrix 系工厂/通知面/人事面——
 * daemon 不强依赖 @studio-next/matrix（25-§一.2），全部以结构同形接口注入；缺省不注入
 * 时对应开关打开=CONFIG_INVALID 拒启动（不静默空转）。
 */
export interface RunServeOpts {
  /** matrix 源工厂（105-刀A A-3）：matrix: true 时注入（装配单元 apps/boot 构造
   * createMentionSource 产物——daemon 不强依赖 @studio-next/matrix）；缺省不注入
   * （matrix: true 且未注入=CONFIG_INVALID 拒启动）。 */
  matrixSource?: () => InvokeSource
  /** matrix 频道供给面工厂（130-P3 §6.7.3）：matrixChannels: true 时注入（apps/boot
   * 构造 createMatrixProvisionFace 产物）；缺省不注入（开而未注入=CONFIG_INVALID）。 */
  matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
  /** notify 广播面（105-刀B，studio-dev-219）：boot 组合根注入 createMatrixBroadcastFace
   * 产物（daemon 不 import @studio-next/matrix，同注入纪律）；注入后 serve 把它交给
   * buildServeRuntime（拍边界事件中继+escalate 警戒 IM 出口）。缺省不注入=面关零行为。 */
  notifyBroadcast?: NotifyBroadcastFace
  /** matrix 人事执行面工厂（studio-dev-217，docs/52-§七）：boot 组合根注入
   * assembleMatrixHrFace 产物；缺省不注入（hrMatrix: true 且未注入=CONFIG_INVALID） */
  hrMatrixFace?: () => MatrixHrFace
  /** 对外 API 监听开关（缺省 true；隔离实例 E2E/无面板形态注入 false——不改变生产缺省） */
  apiStart?: boolean
  /** PORT-TRUST 凭据目录声明（组合根注入；缺省=目录空置，伙伴档/供给 fail-closed） */
  secretDeclarations?: readonly SecretDeclarationInput[]
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
  const rootDirAbs = path.resolve(config.rootDir)
  // —— 受权重启启动面（studio-dev-504 S3/S5；编排体=assembly/serve/restart/orchestrator.ts）：
  //    上一命 last-exit/checkpoint 读回（仅开面时）+ 部署面预登记授权装载——须在
  //    openLedgerWriter **之前**（坏授权文件在拿写者围栏前拒启，与原内联实现同序）。
  const restartStartup = readRestartStartupFace(config, rootDirAbs)
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
      ? `[serve] 在途接管（R-B）：${takeover.takenOver} 条前命孤儿 running 工位收口 interrupted（${takeover.items.map((i) => `${i.issue}#att${i.attempt}`).join('、')}）——接管≠收割（四要件无据不判）；重派走新 attempt、预算沿用未结预留；会话归档同体收口 ${takeover.sessionsClosed} 条${takeover.sessionProblems.length > 0 ? `（问题 ${takeover.sessionProblems.length} 条：${takeover.sessionProblems[0]}）` : ''}`
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
    // 资产部生产接线（DOM-07；docs/17-§2 boot 装配相位；失败=拒启，v2/06 §3.4 fail-closed）
    snapshot = await loadCompanyAtBoot({ companyDir: config.companyDir, rootDir: rootDirAbs, log: (line) => console.log(line), onRefuse: () => ledger.close(), ...(config.agentYaml !== undefined ? { agentYaml: config.agentYaml } : {}) })
  }

  // —— 受权重启编排器（studio-dev-504 S3/S5；studio-dev-555 把 run.ts 内联的 253 行重启块
  //    析出为独立编排件，run.ts 只留 step() 调用与退出映射）：启动期读回面注入 + 检查点缺失
  //    ALARM（restart 标记在但摘要读不回——如实上报，不静默跳自检）。
  const restart = new RestartOrchestrator({
    config,
    ledger,
    rootDir: rootDirAbs,
    snapshot,
    startup: restartStartup,
    now: () => Date.now(),
    log: (line) => console.log(line),
    errorLine: (line) => console.error(line),
  })
  restart.alarmIfCheckpointMissing()

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

  const { engine, sources, stop, hotReload, notifyRelay, conversationRelay, api, ops, restartProbe } = buildServeRuntime(config, ledger, snapshot, {
    ...(opts?.matrixSource !== undefined ? { matrixSource: opts.matrixSource } : {}),
    ...(opts?.matrixRoomFace !== undefined ? { matrixRoomFace: opts.matrixRoomFace } : {}),
    ...(opts?.notifyBroadcast !== undefined ? { notifyBroadcast: opts.notifyBroadcast } : {}),
    ...(opts?.hrMatrixFace !== undefined ? { hrMatrixFace: opts.hrMatrixFace } : {}),
    ...(opts?.secretDeclarations !== undefined ? { secretDeclarations: opts.secretDeclarations } : {}),
  })
  // PORT-OPS 装配面（OPS 补形 A）：runtime 已把 emergencyStop/circuitBreak 接到
  // REC-WORK-18 → PORT-HIST（assembly/ops）。runServe **只持有装配面、不自动触发**
  // emergencyStop——控制面停机仍走 stop-channel 文件协议（行为/顺序不变）。
  void ops
  // 编排器注入运行栈面（engine 派发闸/在途结算、唤起源停、优雅停、退出前信号解绑）
  restart.bindRuntime({
    engine,
    sources,
    stop,
    detachSignals: () => {
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, onSignal)
    },
  })

  // 未挂公司目录的 daemon：L1 热重载不适用——reload 请求仍回执拒绝（不悬空 CLI 轮询）
  let answeredRequestId: string | null = null
  // 控制面停机请求的去重位（DEV-41 ①：落 daemon_kv 跨重启——重启读回，残留请求不当新
  // 请求消费；旧口径只存内存，daemon 重启即失忆，taiga6 一拍自停事故根因）
  let stopLastSeenId: string | null = ledger.kvGet(STOP_LAST_SEEN_KV_KEY)
  // 本进程已应答的停机请求 id（回执面：只对本进程消费的请求落回执——kv 读回的旧 id 不复回）
  let honoredStopId: string | null = null
  const processStartedAt = Date.now()
  let cursorLoopSeen = false
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
  // —— liveness 探针状态（studio-dev-697，docs/17-§2）：tick 前进＋events 哈希链摘要 ——
  //    链摘要按 TTL 节流复算（16 万行全量校验不随每次探测跑；过期=不健康，防旧摘要冒充）。
  let ticks = 0
  let lastReport: TickReport | undefined
  let lastTickAt: number | null = null
  let chainSnapshot: { ok: boolean; events?: number; tipPrefix?: string; checkedAt: number; error?: string } | undefined
  const chainCacheTtlMs = 120_000
  const chainMaxAgeMs = 10 * 60_000
  const readChainSnapshot = (): NonNullable<typeof chainSnapshot> => {
    const now = Date.now()
    if (chainSnapshot !== undefined && now - chainSnapshot.checkedAt < chainCacheTtlMs) return chainSnapshot
    try {
      const report = verifyEventsChain(ledger.db)
      chainSnapshot = { ok: true, events: report.events, tipPrefix: report.tip.slice(0, 12), checkedAt: now }
    } catch (err) {
      chainSnapshot = {
        ok: false,
        checkedAt: now,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      }
    }
    return chainSnapshot
  }
  // —— 报表产出挂单 commit 面（studio-dev-705，docs/17-§2/docs/43-§十一）——
  //    收账/补收把进度落进 <companyDir>/reports/，拍边界收敛为挂单 commit（只处理 reports/ 前缀；
  //    org-config 等其它脏路径不纳入；失败回滚索引、下拍再试；状态切换才打日志防刷屏）。
  const reportsCommit = createReportsCommitFace({
    ...(config.companyDir !== undefined ? { companyDir: config.companyDir } : {}),
    log: (line) => console.log(line),
  })
  let reportsCommitState = 'init'
  const kickReportsCommit = (): void => {
    void reportsCommit
      .commitPending()
      .then((result) => {
        const key =
          result.status === 'committed'
            ? `committed:${result.commit ?? ''}`
            : result.status === 'clean'
              ? `clean:${String(result.otherDirty)}`
              : `${result.status}:${result.reason ?? ''}`
        if (key === reportsCommitState) return
        reportsCommitState = key
        if (result.status === 'error' || result.status === 'blocked') {
          console.error(`[serve] 报表挂单 commit 状态=${result.status}${result.reason !== undefined ? `（${result.reason}）` : ''}`)
        }
      })
      .catch((err: unknown) => {
        console.error(`[serve] 报表挂单 commit 异常：${err instanceof Error ? err.message : String(err)}`)
      })
  }
  // —— 对外 API 起监听 + 只读探活（MIG-06 欠账收口；v2/14 §四）：同进程装配已在 buildServeRuntime 完成，
  //    此处只起 node:http 壳（apiPort 缺省 0=ephemeral）——监听/探活失败=CONFIG_INVALID 拒启（探活体在 serve-face）。
  try {
    if (opts?.apiStart !== false) {
      await api.start({
        healthz: () =>
          buildHealthz({
            pid: process.pid,
            startedAt: processStartedAt,
            now: Date.now(),
            tick: {
              seq: lastReport?.seq ?? 0,
              count: ticks,
              lastAt: lastTickAt,
              tickMs: config.tickMs,
            },
            chain: readChainSnapshot(),
            chainMaxAgeMs,
          }),
      })
    }
  } catch (err) {
    await stop()
    throw new Error(
      `CONFIG_INVALID：对外 API 启动/探活失败（apiPort=${String(config.apiPort ?? 0)}）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  // 唤起源统一启动（22-§一）：各源 start(emit)——emit 统一进引擎 ingest 队列，
  // 下一拍 state-diff 前消费；单源启动异常由注册表隔离（捕获+计数+继续，src/engine/sources.ts）
  sources.startAll((intent) => {
    engine.ingest([intent])
  })

  while (!stopped) {
    try {
      const report = await engine.tick()
      lastReport = report
      ticks += 1
      lastTickAt = Date.now()
      if (report.phases.collect.cursorLoop) cursorLoopSeen = true
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
      // —— 制作人-岗位持久对话出站中继（docs/21-§七.4，studio-dev-646；conversation 面开时）：
      //    拍边界处理本拍收割信号（REPORT 正文回写会话）+ 重试出站队列（notify targets.room）。
      //    fire-and-forget：回信是沟通面非执行前置——失败积压不丢、不阻主循环。
      if (conversationRelay !== undefined) {
        void conversationRelay.relay().catch((): void => {})
      }
      // —— 报表产出挂单 commit（studio-dev-705）：拍边界收敛 reports/ 脏路径（fire-and-forget，
      //    失败只留 error 状态日志、不打断拍；下一拍自动重试）。
      kickReportsCommit()
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
    // —— 重启后自检（studio-dev-504 S5；#497 §4.8）：tick 窗口/总超时到即跑一次，四口径
    //    ＋takeover 交叉核对；幂等闸/落盘/失败 ALARM+ESCALATE 全在编排器内（不宣称恢复）。
    await restart.maybeRunSelfcheck({
      ticks,
      processStartedAt,
      cursorLoopSeen,
      takeover: takeover.takenOver,
      restartProbe,
    })

    // —— 受权重启拍边界编排（studio-dev-504 S3；#497 §4.1/§4.2/§4.4/§4.5）：受理→draining
    //    结算→检查点→exit；拒绝/重放/越级一律回执+事件不改运行态（体见 restart/orchestrator.ts）。
    const restartOutcome = await restart.step({ ticks, lastReport })
    if (restartOutcome.kind === 'exit') {
      return restartOutcome.exit.kind === 'restart'
        ? { ticks, stopReason: 'restart', restart: restartOutcome.exit.restart }
        : { ticks, stopReason: 'restart-failed', lastError: restartOutcome.exit.lastError }
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
  if (config.restartEnabled) writeExitMarkOnStop(rootDirAbs, stopReason === 'stop-request' ? 'stop-request' : stopReason, Date.now())
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
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.off(sig, onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
