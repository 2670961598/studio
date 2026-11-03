/**
 * assembly/serve/restart/orchestrator —— 受权重启编排（studio-dev-504 S3/S5；studio-dev-555 析出）
 *
 * 依据（实现单引用）：#497 plan §4.1/§4.2（控制面状态机 idle→draining→checkpointing→exit0）、
 *   §4.4/§4.5（draining 结算与检查点，顺序即正确性）、§4.8（重启后自检不宣称恢复）；
 *   docs/17-§2（主循环七相位：控制面在**拍边界**消费，不增删相位）；docs/17-§6（收割四要件
 *   由既有收割链判定——draining 到期只标 interrupted，不判四要件、不烧断路连击）。
 *
 * 析出动机（studio-dev-555，20-§十五.三「先拆再增」非注释折行）：#504 在 run.ts 内联了
 *   253 行重启编排块（无函数抽取，靠注释折行压 600 线）。本件把「控制面受理→draining 结算→
 *   检查点→退出」与「启动期 last-exit/checkpoint 读回＋拍边界自检」收进单一编排件：
 *   run.ts 只留一行 `step()` 调用与退出映射，行数净降 ≥100（不以注释折叠规避 guard）。
 *
 * 边界：本件只编排（不判定收割四要件、不写契约事件名——C-1 过渡口径见 channel.ts）；
 *   引擎/源/停机面由 run.ts 装配后注入（bindRuntime），保持 runServe 单线程拍边界语义。
 */
import path from 'node:path'
import type { CompanySnapshot } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import {
  appendDaemonEvent,
  appendRestartEvent,
  effectiveDrainTimeoutMs,
  eventMetaOf,
  inspectRestartRequest,
  loadRestartAuthorizations,
  rejectRestartRequest,
  RESTART_LAST_SEEN_KV_KEY,
  RESTART_USED_KV_PREFIX,
  restartNote,
  toRestartOrgSnapshot,
  validateRestartAuthorization,
  writeRestartResult,
  type RestartAuthorization,
  type RestartReject,
} from '../../../control/restart/channel.ts'
import {
  authorizerOf,
  readCheckpoint,
  readLastExit,
  writeLastExit,
  type LastExitMark,
  type RestartCheckpoint,
} from '../../../control/restart/checkpoint.ts'
import { alarmRestartCheckpointMissing, runRestartSelfcheckAtBoundary } from '../../../control/restart/selfcheck-run.ts'
import type { DrainSettleResult } from '../../../engine/drain/drain.ts'
import type { Engine } from '../../../engine/engine.ts'
import type { SourceRegistry } from '../../../engine/sources.ts'
import type { TickReport } from '../../../engine/tick-report/types.ts'
import type { RestartProbeFace } from '../executor-face.ts'
import { parseRestartAuthorizers } from '../../serveconfig/restart.ts'
import type { ServeConfig } from '../config.ts'
import { writeRestartCheckpointStep, type RestartRunCtx } from '../restart-checkpoint.ts'

/** 启动期读回面（在台账打开**之前**读取——失败即 CONFIG_INVALID 拒启，不留锁文件） */
export interface RestartStartupFace {
  priorLastExit: LastExitMark | undefined
  priorCheckpoint: RestartCheckpoint | undefined
  authorizations: readonly RestartAuthorization[]
}

/**
 * 启动期读回：上一命 last-exit/checkpoint（仅 restartEnabled 开面时读）+ 部署面授权装载。
 * 调用位置须在 openLedgerWriter 之前（与原 run.ts 行为一致：授权坏文件在拿写者围栏前拒启）。
 */
export function readRestartStartupFace(config: ServeConfig, rootDir: string): RestartStartupFace {
  if (!config.restartEnabled) return { priorLastExit: undefined, priorCheckpoint: undefined, authorizations: [] }
  const priorLastExit = readLastExit(rootDir)
  const priorCheckpoint =
    priorLastExit?.exitClass === 'restart' && priorLastExit.checkpoint !== undefined
      ? readCheckpoint(priorLastExit.checkpoint.path)
      : undefined
  const authorizations = loadRestartAuthorizations({
    ...(config.restartAuthorizationFile !== undefined ? { file: path.resolve(config.restartAuthorizationFile) } : {}),
    ...(config.restartAuthorizations !== undefined ? { inline: config.restartAuthorizations } : {}),
  })
  return { priorLastExit, priorCheckpoint, authorizations }
}

/** 注入的运行栈面（run.ts 装配后 bind——编排不自行构造 engine/源/停机面） */
export interface RestartBoundRuntime {
  engine: Pick<Engine, 'beginDrain' | 'forceSettleTimeout'>
  sources: Pick<SourceRegistry, 'stopAll'>
  stop: () => Promise<void>
  /** 返回前摘掉 SIGINT/SIGTERM 监听（与原 run.ts 退出前处理一致） */
  detachSignals: () => void
}

/** 编排器构造面 */
export interface RestartOrchestratorOptions {
  config: ServeConfig
  ledger: Ledger
  rootDir: string
  snapshot: CompanySnapshot
  startup: RestartStartupFace
  now?: () => number
  log?: (line: string) => void
  errorLine?: (line: string) => void
}

/** 自检触发面（拍边界，一次） */
export interface RestartSelfcheckInput {
  ticks: number
  processStartedAt: number
  cursorLoopSeen: boolean
  takeover: number
  restartProbe: RestartProbeFace['restartProbe']
}

/** 拍边界编排输入（tick 已收口） */
export interface RestartStepInput {
  ticks: number
  lastReport: TickReport | undefined
}

/** 编排退出面（成功/失败都带结构化证据；run.ts 映射成 ServeResult） */
export type RestartExitFace =
  | { kind: 'restart'; restart: { requestId: string; checkpointPath: string; checkpointHash: string; interrupted: number } }
  | { kind: 'restart-failed'; lastError: string }

/** 拍边界编排结果（continue=本拍无重启收口；exit=进程该退了） */
export type RestartStepOutcome = { kind: 'continue' } | { kind: 'exit'; exit: RestartExitFace }

/** draining 上下文（受理时的快照：在途清单/期限/授权人；形状单源=restart-checkpoint.RestartRunCtx，#556） */
type DrainContext = RestartRunCtx

/**
 * 受权重启编排器（拍边界单线程；状态机 idle → draining → checkpointing → exit）。
 *
 * 纪律：控制面请求**只**在 tick 收口后消费（docs/17-§2）；拒绝/重放/越级一律回执+事件，
 * 不改运行态（fail-closed）；draining 到期整树杀并如实标 interrupted（不判四要件）。
 */
export class RestartOrchestrator {
  private readonly config: ServeConfig
  private readonly ledger: Ledger
  private readonly rootDir: string
  private readonly snapshot: CompanySnapshot
  private readonly now: () => number
  private readonly log: (line: string) => void
  private readonly errorLine: (line: string) => void
  private readonly authorizations: readonly RestartAuthorization[]

  /** 启动期读回（run.ts 在台账打开前已取，构造时注入） */
  readonly priorLastExit: LastExitMark | undefined
  readonly priorCheckpoint: RestartCheckpoint | undefined

  private runtime: RestartBoundRuntime | undefined
  private lastSeenId: string | null
  private state: 'idle' | 'draining' | 'checkpointing' = 'idle'
  private ctx: DrainContext | undefined
  private selfcheckDone: boolean

  constructor(opts: RestartOrchestratorOptions) {
    this.config = opts.config
    this.ledger = opts.ledger
    this.rootDir = opts.rootDir
    this.snapshot = opts.snapshot
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? ((line) => console.log(line))
    this.errorLine = opts.errorLine ?? ((line) => console.error(line))
    this.authorizations = opts.startup.authorizations
    this.priorLastExit = opts.startup.priorLastExit
    this.priorCheckpoint = opts.startup.priorCheckpoint
    this.lastSeenId = this.ledger.kvGet(RESTART_LAST_SEEN_KV_KEY)
    this.selfcheckDone = this.priorCheckpoint === undefined
  }

  /** 注入装配面（buildServeRuntime 之后调用一次） */
  bindRuntime(runtime: RestartBoundRuntime): void {
    this.runtime = runtime
  }

  /** 装配面取用（未注入=编程错误：立即抛，不静默空转） */
  private bound(): RestartBoundRuntime {
    if (this.runtime === undefined) throw new Error('RestartOrchestrator：运行栈装配面未注入（bindRuntime 未调用）')
    return this.runtime
  }

  /** 受权重启开面是否生效（config.restartEnabled；关=编排全空转） */
  get enabled(): boolean {
    return this.config.restartEnabled
  }

  /** 上一命 restart 标记在但检查点读不回：ALARM 如实上报，不静默跳自检 */
  alarmIfCheckpointMissing(): void {
    if (!this.config.restartEnabled || this.priorLastExit?.exitClass !== 'restart' || this.priorCheckpoint !== undefined) return
    const meta = eventMetaOf(this.snapshot, undefined, this.config.company)
    alarmRestartCheckpointMissing(this.ledger, {
      company: this.config.company,
      ...meta,
      requestId: this.priorLastExit.requestId,
      now: this.now(),
    })
    this.errorLine('[serve] 受权重启标记存在但检查点摘要读不回——自检无法执行，落 ALARM（不宣称已恢复）')
  }

  /**
   * 拍边界自检（S5；#497 §4.8）：tick 窗口/总超时到即跑一次，四口径＋takeover 交叉核对；
   * 结果落 selfcheck-*.json，失败 DAILY_ALARM+ESCALATE，不宣称恢复。
   */
  async maybeRunSelfcheck(input: RestartSelfcheckInput): Promise<void> {
    if (this.selfcheckDone || this.priorCheckpoint === undefined) return
    const due =
      input.ticks >= this.config.restartSelfcheckTicks ||
      this.now() - input.processStartedAt >= this.config.restartSelfcheckTimeoutMs
    if (!due) return
    this.selfcheckDone = true
    await runRestartSelfcheckAtBoundary({
      ledger: this.ledger,
      rootDir: this.rootDir,
      company: this.config.company,
      checkpoint: this.priorCheckpoint,
      ticksSinceStart: input.ticks,
      processStartedAt: input.processStartedAt,
      cursorLoopSeen: input.cursorLoopSeen,
      takeover: input.takeover,
      versionAlignPolicy: this.config.restartVersionAlignPolicy,
      minTicks: this.config.restartSelfcheckTicks,
      restartProbe: input.restartProbe,
      metaOf: (personId) => eventMetaOf(this.snapshot, personId, this.config.company),
      log: this.log,
      error: this.errorLine,
      now: this.now,
    })
  }

  /**
   * 拍边界编排（受理 → draining 结算 → 检查点 → 退出）。
   * 返回 continue=本拍照旧；exit=进程应退出（run.ts 负责 return ServeResult）。
   */
  async step(input: RestartStepInput): Promise<RestartStepOutcome> {
    if (!this.config.restartEnabled) return { kind: 'continue' }
    const accepted = this.acceptAtBoundary()
    if (accepted.kind === 'exit') return accepted
    return this.advanceDrain(input)
  }

  /** 控制面受理面（idle 才受理；拒绝/重放一律回执+事件，不改运行态） */
  private acceptAtBoundary(): RestartStepOutcome {
    if (this.state !== 'idle') return { kind: 'continue' }
    const inspection = inspectRestartRequest(this.rootDir)
    if (inspection.kind === 'rejected') {
      // 无 id 面（坏 JSON/provenance/权限-IO）以「reason」去重：消费失败时防每拍重复落拒绝事件
      const rejectionKey = `rejected:${inspection.reason}`
      if (this.lastSeenId === rejectionKey) return { kind: 'continue' }
      this.reject('-', inspection.reason, inspection.detail, undefined, inspection.file)
      this.lastSeenId = rejectionKey
      this.ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, rejectionKey)
      return { kind: 'continue' }
    }
    if (inspection.kind !== 'ok' || inspection.request.id === this.lastSeenId) return { kind: 'continue' }

    const request = inspection.request
    const org = toRestartOrgSnapshot(this.snapshot)
    const usedRefs = new Set<string>()
    if (this.ledger.kvGet(`${RESTART_USED_KV_PREFIX}${request.authorizationRef}`) !== null) usedRefs.add(request.authorizationRef)
    const verdict = validateRestartAuthorization({
      request,
      authorizations: this.authorizations,
      org,
      now: this.now(),
      usedRefs,
      extraAuthorizers: parseRestartAuthorizers(this.config.restartAuthorizers),
    })
    if (!verdict.ok) {
      this.reject(request.id, verdict.reason, verdict.detail, request.actor.personId, inspection.file)
      return { kind: 'continue' }
    }

    const person = org.people.find((p) => p.id === request.actor.personId)
    const authorizer = authorizerOf(request.actor, person?.level ?? request.actor.level, person?.role ?? request.actor.role)
    const timeoutMs = effectiveDrainTimeoutMs(this.config.restartDrainTimeoutMs, request.drainTimeoutMs)
    const running = this.ledger.listWorkRecords().filter((r) => r.status === 'running')
    this.ctx = {
      request,
      authorizationRef: request.authorizationRef,
      authorizer,
      deadline: this.now() + timeoutMs,
      inflightAtRequest: running.length,
      startRunningIds: running.map((r) => r.id),
      inconsistent: false,
    }
    this.lastSeenId = request.id
    this.ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, request.id)
    writeRestartResult(this.rootDir, {
      id: request.id,
      ok: true,
      accepted: true,
      state: 'draining',
      detail: `authorized; drain_timeout_ms=${String(timeoutMs)}`,
    })
    const meta = eventMetaOf(this.snapshot, request.actor.personId, this.config.company)
    appendRestartEvent(this.ledger, {
      company: this.config.company,
      ...meta,
      now: this.now(),
      note: restartNote('started', [
        ['reason', request.reason],
        ['authorizer', authorizer.personId],
        ['authorization_ref', request.authorizationRef],
        ['inflight_before', running.length],
        ['drain_timeout_ms', timeoutMs],
        ['request_id', request.id],
      ]),
    })
    const runtime = this.bound()
    if (request.stopSources === true) runtime.sources.stopAll()
    runtime.engine.beginDrain(request.reason)
    this.state = 'draining'
    this.log(`[serve] 受权重启进入 draining（id=${request.id} authorizer=${authorizer.personId} 在途=${String(running.length)} deadline=${String(timeoutMs)}ms）——只关派发闸，收割/合并/回收照跑`)
    return { kind: 'continue' }
  }

  /** draining 结算/检查点（#497 §4.4/§4.5）：双面清零 → 检查点；到期先整树杀再检查点 */
  private async advanceDrain(input: RestartStepInput): Promise<RestartStepOutcome> {
    if (this.state !== 'draining' || this.ctx === undefined || input.lastReport === undefined) return { kind: 'continue' }
    const ctx = this.ctx
    const runningNow = this.ledger.listWorkRecords().filter((r) => r.status === 'running')
    const inflightZero = input.lastReport.inflightAfter === 0
    const recordsZero = runningNow.length === 0
    if (inflightZero !== recordsZero) ctx.inconsistent = true
    let settle: DrainSettleResult | undefined
    if (inflightZero && recordsZero) {
      // 自然结算：四要件由既有收割链判定，超时面不发生
    } else if (this.now() >= ctx.deadline) {
      settle = await this.bound().engine.forceSettleTimeout()
      const meta = eventMetaOf(this.snapshot, ctx.authorizer.personId, this.config.company)
      appendRestartEvent(this.ledger, {
        company: this.config.company,
        ...meta,
        now: this.now(),
        note: restartNote('drain_timeout', [
          ['interrupted', settle?.interrupted.map((i) => `${i.ticket}#att${String(i.attempt)}`).join(',') ?? 'none'],
          ['deadline_ms', effectiveDrainTimeoutMs(this.config.restartDrainTimeoutMs, ctx.request.drainTimeoutMs)],
          ['request_id', ctx.request.id],
        ]),
      })
      this.errorLine(
        `[serve] 受权重启 draining 到期：${String(settle?.interrupted.length ?? 0)} 条在途整树杀并标 interrupted（不判四要件、不烧断路连击）`,
      )
    }
    if (!(inflightZero && recordsZero) && settle === undefined) return { kind: 'continue' }
    this.state = 'checkpointing'
    return this.checkpointAndExit(ctx, settle)
  }

  /** 检查点 → 关停 → last-exit(authorized) → 退出面；任一失败=exit 非 0 + ALARM，不写 authorized */
  private async checkpointAndExit(ctx: DrainContext, settle: DrainSettleResult | undefined): Promise<RestartStepOutcome> {
    const meta = eventMetaOf(this.snapshot, ctx.authorizer.personId, this.config.company)
    try {
      // 检查点第 5 步先行（WAL 收干；失败=检查点失败，不静默）——随后事件/摘要/close/exit 标记。
      // 步体单源=../restart-checkpoint.ts（#556 落仓；本编排件只消费返回值，不重复实现）。
      const step = writeRestartCheckpointStep({
        ledger: this.ledger,
        company: this.config.company,
        dbPath: path.resolve(this.config.db),
        rootDir: this.rootDir,
        ctx,
        settle,
        snapshot: this.snapshot,
      })
      await this.bound().stop()
      writeLastExit(this.rootDir, {
        schema: 1,
        authorized: true,
        exitClass: 'restart',
        requestId: ctx.request.id,
        at: this.now(),
        checkpoint: { path: step.written.path, hash: step.written.hash },
        interrupted: step.interrupted.length,
      })
      this.log(
        `[serve] 受权重启检查点完成（id=${ctx.request.id} tick=${String(step.tickSeq)} settled=${String(step.settled.length)} interrupted=${String(step.interrupted.length)} exit=0 authorized=true）——等待 supervisor 拉起`,
      )
      this.bound().detachSignals()
      return {
        kind: 'exit',
        exit: {
          kind: 'restart',
          restart: { requestId: ctx.request.id, checkpointPath: step.written.path, checkpointHash: step.written.hash, interrupted: step.interrupted.length },
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.errorLine(`[serve] 受权重启检查点失败：${msg}——exit 非 0 + ALARM，不写 authorized 标记`)
      try {
        appendRestartEvent(this.ledger, {
          company: this.config.company,
          ...meta,
          now: this.now(),
          note: restartNote('failed', [
            ['reason', msg],
            ['request_id', ctx.request.id],
            ['exit_class', 'crash'],
          ]),
        })
        appendDaemonEvent(this.ledger, {
          event: 'DAILY_ALARM',
          company: this.config.company,
          ...meta,
          now: this.now(),
          note: `RESTART_CHECKPOINT_FAIL;request_id=${ctx.request.id};reason=${msg}`,
        })
      } catch {
        // 台账已不可写：日志已如实上报
      }
      try {
        await this.bound().stop()
      } catch {
        // 收口失败不覆盖 checkpoints 失败分类
      }
      try {
        writeLastExit(this.rootDir, { schema: 1, authorized: false, exitClass: 'crash', requestId: ctx.request.id, at: this.now() })
      } catch {
        // 退出标记写失败：无标记=supervisor 按 crash 处理（不冒充 authorized）
      }
      this.bound().detachSignals()
      return { kind: 'exit', exit: { kind: 'restart-failed', lastError: msg } }
    }
  }

  /** 拒绝收口（回执+事件+消费；失败只影响留痕不炸主循环） */
  private reject(id: string, reason: string, detail: string, actorId: string | undefined, file: string): void {
    const meta = eventMetaOf(this.snapshot, actorId, this.config.company)
    try {
      rejectRestartRequest(this.ledger, {
        rootDir: this.rootDir,
        company: this.config.company,
        ...meta,
        id,
        reason: reason as RestartReject,
        detail,
        ...(actorId !== undefined ? { actorId } : {}),
        file,
        now: this.now(),
      })
    } catch (err) {
      this.errorLine(`[serve] 重启拒绝收口失败：${err instanceof Error ? err.message : String(err)}`)
    }
    this.lastSeenId = id
    this.ledger.kvSet(RESTART_LAST_SEEN_KV_KEY, id)
    this.errorLine(`[serve] 受权重启请求拒绝（id=${id} reason=${reason}）：${detail}`)
  }
}
