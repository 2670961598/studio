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
import {
  appendDaemonEvent,
  appendRestartEvent,
  rejectRestartRequest,
  type RestartReject,
  effectiveDrainTimeoutMs,
  inspectRestartRequest,
  loadRestartAuthorizations,
  RESTART_LAST_SEEN_KV_KEY,
  RESTART_USED_KV_PREFIX,
  restartNote,
  eventMetaOf,
  toRestartOrgSnapshot,
  validateRestartAuthorization,
  writeRestartResult,
  type RestartRequest,
} from '../../control/restart/channel.ts'
import {
  authorizerOf,
  checkpointPathOf,
  readCheckpoint,
  readLastExit,
  sha256,
  writeExitMarkOnStop,
  writeLastExit,
  writeRestartCheckpoint,
  type RestartCheckpoint,
  type RestartSettledItem,
} from '../../control/restart/checkpoint.ts'
import { alarmRestartCheckpointMissing, runRestartSelfcheckAtBoundary } from '../../control/restart/selfcheck-run.ts'
import { makeUlid } from '../../engine/tools/id.ts'
import type { TickReport } from '../../engine/tick-report/types.ts'
import type { DrainSettleResult } from '../../engine/drain/drain.ts'
import { takeOverRunningWorkRecords } from '../../engine/harvest/inflight-takeover.ts'
import { noopLinesOf, renderTick } from '../render/tick.ts'
import { DEMO_SNAPSHOT } from '../demo/demo-snapshot.ts'
import { wirePlatform } from '../platform/wire.ts'
import type { MatrixHrFace } from '../../engine/hrsync/hrsync.ts'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../engine/rooms/room-duty.ts'
import { parseDaemonConfig, type ServeConfig } from './config.ts'
import { parseRestartAuthorizers } from '../serveconfig/restart.ts'
import { buildServeRuntime } from './runtime.ts'

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
  // —— 受权重启启动面（studio-dev-504 S3/S5）：上一命 last-exit/checkpoint 读回（仅开面时）；
  //    开面即装载部署面预登记授权（坏文件/空表/全过期在 config 校验已拒，此处再取运行期副本）——
  const priorLastExit = config.restartEnabled ? readLastExit(rootDirAbs) : undefined
  const priorCheckpoint =
    priorLastExit?.exitClass === 'restart' && priorLastExit.checkpoint !== undefined
      ? readCheckpoint(priorLastExit.checkpoint.path)
      : undefined
  const restartAuthorizations = config.restartEnabled
    ? loadRestartAuthorizations({
        ...(config.restartAuthorizationFile !== undefined ? { file: path.resolve(config.restartAuthorizationFile) } : {}),
        ...(config.restartAuthorizations !== undefined ? { inline: config.restartAuthorizations } : {}),
      })
    : []
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

  // —— 重启检查点缺失面：restart 标记在但摘要读不回——ALARM 如实上报，不静默跳自检 ——
  if (config.restartEnabled && priorLastExit?.exitClass === 'restart' && priorCheckpoint === undefined) {
    const meta = eventMetaOf(snapshot, undefined, config.company)
    alarmRestartCheckpointMissing(ledger, { company: config.company, ...meta, requestId: priorLastExit.requestId, now: Date.now() })
    console.error('[serve] 受权重启标记存在但检查点摘要读不回——自检无法执行，落 ALARM（不宣称已恢复）')
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

  const { engine, sources, stop, hotReload, notifyRelay, api, ops, restartProbe } = buildServeRuntime(config, ledger, snapshot, {
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
  // —— 受权重启编排态（studio-dev-504 S3）：idle → draining → checkpointing → exit(0) ——
  let restartLastSeenId: string | null = ledger.kvGet(RESTART_LAST_SEEN_KV_KEY)
  let restartState: 'idle' | 'draining' | 'checkpointing' = 'idle'
  let restartCtx:
    | {
        request: RestartRequest
        authorizationRef: string
        authorizer: { personId: string; role: string; level: number }
        deadline: number
        inflightAtRequest: number
        startRunningIds: readonly string[]
        inconsistent: boolean
      }
    | undefined
  let selfcheckDone = priorCheckpoint === undefined
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
  // —— 对外 API 起监听（MIG-06 欠账收口；v2/14 §四）：同进程装配已在 buildServeRuntime 完成，
  //    此处只起 node:http 壳（apiPort 缺省 0=ephemeral）——失败=CONFIG_INVALID 拒启，不静默半面。
  try {
    if (opts?.apiStart !== false) await api.start()
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

  // —— 重启留痕/拒绝辅助（拍边界单线程；失败只影响留痕不炸主循环） ——
  const rejectRestart = (id: string, reason: string, detail: string, actorId: string | undefined, file: string): void => {
    const meta = eventMetaOf(snapshot, actorId, config.company)
    try {
      rejectRestartRequest(ledger, {
        rootDir: rootDirAbs,
        company: config.company,
        ...meta,
        id,
        reason: reason as RestartReject,
        detail,
        ...(actorId !== undefined ? { actorId } : {}),
        file,
        now: Date.now(),
      })
    } catch (err) {
      console.error(`[serve] 重启拒绝收口失败：${err instanceof Error ? err.message : String(err)}`)
    }
    restartLastSeenId = id
    ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, id)
    console.error(`[serve] 受权重启请求拒绝（id=${id} reason=${reason}）：${detail}`)
  }

  let ticks = 0
  let lastReport: TickReport | undefined
  while (!stopped) {
    try {
      const report = await engine.tick()
      lastReport = report
      ticks += 1
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
    //    ＋takeover 交叉核对；结果落 selfcheck-*.json，失败 DAILY_ALARM+ESCALATE，不宣称恢复。
    if (!selfcheckDone && priorCheckpoint !== undefined) {
      const due = ticks >= config.restartSelfcheckTicks || Date.now() - processStartedAt >= config.restartSelfcheckTimeoutMs
      if (due) {
        selfcheckDone = true
        await runRestartSelfcheckAtBoundary({
          ledger,
          rootDir: rootDirAbs,
          company: config.company,
          checkpoint: priorCheckpoint,
          ticksSinceStart: ticks,
          processStartedAt,
          cursorLoopSeen,
          takeover: takeover.takenOver,
          versionAlignPolicy: config.restartVersionAlignPolicy,
          minTicks: config.restartSelfcheckTicks,
          restartProbe,
          metaOf: (personId) => eventMetaOf(snapshot, personId, config.company),
          log: (line) => console.log(line),
          error: (line) => console.error(line),
          now: () => Date.now(),
        })
      }
    }

    // —— 受权重启控制面（studio-dev-504 S3；#497 §4.1/§4.2）：授权通过→RESTART_STARTED→
    //    draining；拒绝/重放/越级一律回执+事件，不改运行态（fail-closed）。
    if (config.restartEnabled && restartState === 'idle') {
      const inspection = inspectRestartRequest(rootDirAbs)
      if (inspection.kind === 'rejected') {
        // 无 id 面（坏 JSON/provenance）以「reason」去重：消费失败时防每拍重复落拒绝事件
        const rejectionKey = `rejected:${inspection.reason}`
        if (restartLastSeenId !== rejectionKey) {
          rejectRestart('-', inspection.reason, inspection.detail, undefined, inspection.file)
          restartLastSeenId = rejectionKey
          ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, rejectionKey)
        }
      } else if (inspection.kind === 'ok' && inspection.request.id !== restartLastSeenId) {
        const request = inspection.request
        const org = toRestartOrgSnapshot(snapshot)
        const usedRefs = new Set<string>()
        if (ledger.kvGet(`${RESTART_USED_KV_PREFIX}${request.authorizationRef}`) !== null) usedRefs.add(request.authorizationRef)
        const verdict = validateRestartAuthorization({
          request,
          authorizations: restartAuthorizations,
          org,
          now: Date.now(),
          usedRefs,
          extraAuthorizers: parseRestartAuthorizers(config.restartAuthorizers),
        })
        if (!verdict.ok) {
          rejectRestart(request.id, verdict.reason, verdict.detail, request.actor.personId, inspection.file)
        } else {
          const person = org.people.find((p) => p.id === request.actor.personId)
          const authorizer = authorizerOf(request.actor, person?.level ?? request.actor.level, person?.role ?? request.actor.role)
          const timeoutMs = effectiveDrainTimeoutMs(config.restartDrainTimeoutMs, request.drainTimeoutMs)
          const running = ledger.listWorkRecords().filter((r) => r.status === 'running')
          restartCtx = {
            request,
            authorizationRef: request.authorizationRef,
            authorizer,
            deadline: Date.now() + timeoutMs,
            inflightAtRequest: running.length,
            startRunningIds: running.map((r) => r.id),
            inconsistent: false,
          }
          restartLastSeenId = request.id
          ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, request.id)
          writeRestartResult(rootDirAbs, {
            id: request.id,
            ok: true,
            accepted: true,
            state: 'draining',
            detail: `authorized; drain_timeout_ms=${timeoutMs}`,
          })
          const meta = eventMetaOf(snapshot, request.actor.personId, config.company)
          appendRestartEvent(ledger, {
            company: config.company,
            ...meta,
            now: Date.now(),
            note: restartNote('started', [
              ['reason', request.reason],
              ['authorizer', authorizer.personId],
              ['authorization_ref', request.authorizationRef],
              ['inflight_before', running.length],
              ['drain_timeout_ms', timeoutMs],
              ['request_id', request.id],
            ]),
          })
          if (request.stopSources === true) sources.stopAll()
          engine.beginDrain(request.reason)
          restartState = 'draining'
          console.log(`[serve] 受权重启进入 draining（id=${request.id} authorizer=${authorizer.personId} 在途=${running.length} deadline=${timeoutMs}ms）——只关派发闸，收割/合并/回收照跑`)
        }
      }
    }

    // —— draining 结算/检查点（#497 §4.4/§4.5）：inflight 与 running work_records 双面清零
    //    →检查点；到期先整树杀+interrupted 如实收口，再检查点。顺序即正确性。
    if (restartState === 'draining' && restartCtx !== undefined && lastReport !== undefined) {
      const runningNow = ledger.listWorkRecords().filter((r) => r.status === 'running')
      const inflightZero = lastReport.inflightAfter === 0
      const recordsZero = runningNow.length === 0
      if (inflightZero !== recordsZero) restartCtx.inconsistent = true
      let settle: DrainSettleResult | undefined
      if (inflightZero && recordsZero) {
        // 自然结算：四要件由既有收割链判定，超时面不发生
      } else if (Date.now() >= restartCtx.deadline) {
        settle = await engine.forceSettleTimeout()
        const meta = eventMetaOf(snapshot, restartCtx.authorizer.personId, config.company)
        appendRestartEvent(ledger, {
          company: config.company,
          ...meta,
          now: Date.now(),
          note: restartNote('drain_timeout', [
            ['interrupted', settle.interrupted.map((i) => `${i.ticket}#att${i.attempt}`).join(',') || 'none'],
            ['deadline_ms', effectiveDrainTimeoutMs(config.restartDrainTimeoutMs, restartCtx.request.drainTimeoutMs)],
            ['request_id', restartCtx.request.id],
          ]),
        })
        console.error(`[serve] 受权重启 draining 到期：${settle.interrupted.length} 条在途整树杀并标 interrupted（不判四要件、不烧断路连击）`)
      }
      if ((inflightZero && recordsZero) || settle !== undefined) {
        restartState = 'checkpointing'
        const ctx = restartCtx
        const meta = eventMetaOf(snapshot, ctx.authorizer.personId, config.company)
        try {
          // 检查点第 5 步先行（WAL 收干；失败=检查点失败，不静默）——随后事件/摘要/close/exit 标记
          const wal = ledger.checkpoint()
          const tickSeq = Number(ledger.kvGet('tick.seq') ?? '0')
          const cursorRaw = ledger.kvGet('activity.cursor')
          const cursor = cursorRaw === null || cursorRaw === '' ? null : cursorRaw
          const interrupted: RestartSettledItem[] = (settle?.interrupted ?? []).map((i) => ({ issue: i.ticket, attempt: i.attempt, status: 'interrupted' }))
          const interruptedIds = new Set((settle?.interrupted ?? []).map((i) => i.workRecordId))
          const settled: RestartSettledItem[] = []
          for (const id of ctx.startRunningIds) {
            if (interruptedIds.has(id)) continue // 超时收口单只进 interrupted 清单，不重复计 settled
            const rec = ledger.getWorkRecord(id)
            if (rec !== undefined && rec.status !== 'running') settled.push({ issue: rec.issue, attempt: rec.attempt, status: rec.status })
          }
          const eventId = makeUlid(Date.now())
          const checkpoint: RestartCheckpoint = {
            schema: 1,
            requestId: ctx.request.id,
            at: Date.now(),
            company: config.company,
            reason: ctx.request.reason,
            authorizer: ctx.authorizer,
            authorizationRef: ctx.authorizationRef,
            exitClass: 'restart',
            tickSeq,
            cursor,
            inflightBefore: ctx.inflightAtRequest,
            settled,
            interrupted,
            inconsistent: ctx.inconsistent,
            ledger: { path: path.resolve(config.db), walBefore: wal.walBefore, walAfter: wal.walAfter },
            repoHead: null,
            assetFingerprint: null,
            eventId,
          }
          const checkpointPath = checkpointPathOf(rootDirAbs, ctx.request.id)
          const checkpointHash = sha256(`${JSON.stringify(checkpoint, null, 2)}\n`)
          appendRestartEvent(ledger, {
            company: config.company,
            ...meta,
            now: Date.now(),
            eventId,
            note: restartNote('done', [
              ['cause', ctx.request.reason],
              ['authorizer', ctx.authorizer.personId],
              ['authorization_ref', ctx.authorizationRef],
              ['inflight_before', ctx.inflightAtRequest],
              ['settled', settled.length],
              ['interrupted', interrupted.length],
              ['checkpoint', `${path.relative(rootDirAbs, checkpointPath)}@${checkpointHash}`],
              ['exit_class', 'restart'],
              ['request_id', ctx.request.id],
            ]),
          })
          const written = writeRestartCheckpoint(rootDirAbs, checkpoint)
          if (written.hash !== checkpointHash) throw new Error(`检查点哈希不一致：写盘=${written.hash} 事件=${checkpointHash}`)
          ledger.kvSet('restart.lastCheckpoint', JSON.stringify({ path: written.path, hash: written.hash }))
          ledger.kvSet(`${RESTART_USED_KV_PREFIX}${ctx.authorizationRef}`, ctx.request.id)
          await stop()
          writeLastExit(rootDirAbs, {
            schema: 1,
            authorized: true,
            exitClass: 'restart',
            requestId: ctx.request.id,
            at: Date.now(),
            checkpoint: { path: written.path, hash: written.hash },
            interrupted: interrupted.length,
          })
          console.log(
            `[serve] 受权重启检查点完成（id=${ctx.request.id} tick=${tickSeq} settled=${settled.length} interrupted=${interrupted.length} exit=0 authorized=true）——等待 supervisor 拉起`,
          )
          process.off('SIGINT', onSignal)
          process.off('SIGTERM', onSignal)
          return {
            ticks,
            stopReason: 'restart',
            restart: { requestId: ctx.request.id, checkpointPath: written.path, checkpointHash: written.hash, interrupted: interrupted.length },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          lastError = msg
          console.error(`[serve] 受权重启检查点失败：${msg}——exit 非 0 + ALARM，不写 authorized 标记`)
          try {
            appendRestartEvent(ledger, {
              company: config.company,
              ...meta,
              now: Date.now(),
              note: restartNote('failed', [
                ['reason', msg],
                ['request_id', ctx.request.id],
                ['exit_class', 'crash'],
              ]),
            })
            appendDaemonEvent(ledger, {
              event: 'DAILY_ALARM',
              company: config.company,
              ...meta,
              now: Date.now(),
              note: `RESTART_CHECKPOINT_FAIL;request_id=${ctx.request.id};reason=${msg}`,
            })
          } catch {
            // 台账已不可写：日志已如实上报
          }
          try {
            await stop()
          } catch {
            // 收口失败不覆盖 checkpoints 失败分类
          }
          try {
            writeLastExit(rootDirAbs, { schema: 1, authorized: false, exitClass: 'crash', requestId: ctx.request.id, at: Date.now() })
          } catch {
            // 退出标记写失败：无标记=supervisor 按 crash 处理（不冒充 authorized）
          }
          process.off('SIGINT', onSignal)
          process.off('SIGTERM', onSignal)
          return { ticks, stopReason: 'restart-failed', lastError: msg }
        }
      }
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
