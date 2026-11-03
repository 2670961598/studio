/**
 * engine/tick/collect.ts —— 相位 1 采集（activity 增量＋issues 全量对账＋镜像 GC＋双哨＋批示归一层）
 *
 * 20-§十五「按域拆件、零行为变更」：相位体逐字迁出（宿主名对 rt 字段取别名 → 语句零改写），
 * 相位内步骤序不变（docs/17-§2 相位 1）：
 *   ① activity.since 增量翻页（游标回退环防护 studio-dev-409；空串=null 持久形态）
 *   ② issues.list 全量对账 → syncMirror（镜像 upsert）
 *   ③ 记录族生产写面·相位 1 采集尾（REC-WORK-01，钩子体=records/hooks.ts）
 *   ④ 镜像 GC 维护步（studio-dev-511：先备份再删；首拍强制）
 *   ⑤ DEV-49 A4 双哨（未知态哨＋状态集巡逻核，体=sentinels.ts）
 *   ⑥ 批示归一层（studio-dev-171：assembling=directive/wire.ts）
 * 本件只回传拍作用域观测值（报告用），不产生相位外副作用。
 */
import type { IssueRecord, TicketId } from '@studio-next/contract'
import type { DirectiveVerb } from '../directive/index.ts'
import { engineDirectiveDeps, runDirectiveLayer } from '../directive/index.ts'
import { runMirrorGcTick, type MirrorGcTickReport } from '../mirror-gc/step.ts'
import type { ObsCollectFailure } from '../observe/index.ts'
import { recordTickIntake } from '../records/hooks.ts'
import { buildEventIndex } from '../sentinel/events-index.ts'
import { runDev49Sentinels } from '../sentinel/sentinels.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { CURSOR_KEY, type CollectOutcome, type TickCtx } from './ctx.ts'

export async function collectPhase(rt: EngineRuntime, ctx: TickCtx): Promise<CollectOutcome> {
  // 逐字迁移的宿主别名（闭包名不变，语义=同一实例/同一绑定）
  const { platform, ledger, config, records, now, syncMirror, makeEvent, flowOf, resolvePerson } = rt
  const seq = ctx.seq
  const startedAt = ctx.startedAt
  const tickEvents = ctx.tickEvents
  const errors = ctx.errors
  /** 本拍采集失败事实（OBS 观察面输入；studio-dev-539／重出 studio-dev-617） */
  const obsFailures: ObsCollectFailure[] = []
    // —— 相位 1 采集：activity 增量（游标）+ issues 全量对账（镜像 upsert） ——
    const cursorRaw = ledger.kvGet(CURSOR_KEY)
    // 空串=「游标为 null（尚未消费任何活动）」的持久形态（kv 列 NOT NULL——回读须还原 null）
    const cursorBefore = cursorRaw === '' || cursorRaw === null ? null : cursorRaw
    let cursor: string | null = cursorBefore
    const affected: TicketId[] = []
    const affectedSeen = new Set<TicketId>()
    let pages = 0
    let activityCount = 0
    let cursorLoop = false // studio-dev-409：nextCursor 同值再现=游标回退环（观测面）
    try {
      const seenCursors = new Set<string>()
      for (let i = 0; i < config.maxActivityPages; i += 1) {
        pages += 1
        const page = await platform.activity.since(cursor)
        for (const item of page.items) {
          activityCount += 1
          if (item.issue !== undefined && !affectedSeen.has(item.issue)) {
            affectedSeen.add(item.issue)
            affected.push(item.issue)
          }
        }
        if (page.nextCursor !== null) {
          if (seenCursors.has(page.nextCursor)) {
            // 游标回退环（studio-dev-409 根因③面）：适配器把 nextCursor 拉回已见
            // 旧位置（边界假不可达→全量重放）——同值再现即环，停翻防打转；cursor
            // 停在最后一个未重复值，下拍增量续走。游标不透明（docs/25-§3.2）：
            // 只认重复、不解释内容，端口契约零变更
            cursorLoop = true
            break
          }
          seenCursors.add(page.nextCursor)
          cursor = page.nextCursor
        } else if (page.items.length > 0) {
          // 平台「无更多」但本页有货：游标退守最后活动 id（docs/25-§3.2 YouTrack=最后活动 id 边界）
          const last = page.items[page.items.length - 1]?.id
          if (last !== undefined) cursor = last
        }
        if (page.nextCursor === null) break
      }
      ledger.kvSet(CURSOR_KEY, cursor ?? '')
    } catch (err) {
      const message = `采集相位失败：${err instanceof Error ? err.message : String(err)}`
      errors.push(message)
      obsFailures.push({ source: 'activity', message })
    }

    if (cursorLoop) {
      obsFailures.push({
        source: 'cursor-loop',
        message: '活动流 nextCursor 同值再现（游标回退环）：已停翻防打转，游标停在最后未重复值',
      })
    }

    let mirrorListOk = true
    const issues = await platform.issues.list({}).catch((err: unknown) => {
      mirrorListOk = false
      const message = `镜像对账失败（issues.list）：${err instanceof Error ? err.message : String(err)}`
      errors.push(message)
      obsFailures.push({ source: 'mirror-list', message })
      return [] as IssueRecord[]
    })
    const issueById = new Map<TicketId, IssueRecord>(issues.map((i) => [i.id, i]))
    for (const issue of issues) syncMirror(issue)
    // 记录族生产写面·相位 1 采集尾（docs/17-§2）：活动驱动单 → REC-WORK-01（钩子体=records/hooks.ts）
    if (records !== undefined) {
      recordTickIntake({ records, issueById, affected, at: now(), actorOf: (issue) => resolvePerson(issue)?.id ?? config.defaultPersonId })
    }

    // —— 相位 1 尾·镜像 GC 维护步（studio-dev-511；docs/17-§2 相位内步骤/§3 可重建投影）——
    // 平台全量活动集已在本拍取到：删「company 下 issue ∉ 活动集」的残行（LOCAL-* 与未来同型）。
    // 先 VACUUM INTO 备份再删（备份失败不删）；平台拉取失败/活动集空=跳过；首拍强制。
    // 观测=daemon 日志 + tick report collect.mirrorGc + daemon_kv mirror.gc.last；不新增事件名。
    let mirrorGc: MirrorGcTickReport | undefined
    try {
      mirrorGc = runMirrorGcTick({
        ledger,
        company: config.company,
        rootDir: config.rootDir,
        activeIssues: issues.map((issue) => issue.id),
        listOk: mirrorListOk,
        ...(config.mirrorGcEveryTicks !== undefined ? { everyTicks: config.mirrorGcEveryTicks } : {}),
        seq,
        now: now(),
        force: rt.mirrorGcFirstRun,
      })
      if (mirrorGc !== undefined) {
        // 已做出一次判断（含跳过：平台不可用/空活动集）→ 后续按节流窗检查，避免逐拍刷日志
        rt.mirrorGcFirstRun = false
        if (mirrorGc.deleted > 0) ctx.mutations += mirrorGc.deleted
      }
    } catch (err) {
      errors.push(`镜像 GC 失败：${err instanceof Error ? err.message : String(err)}`)
    }

    // —— 相位 1 尾·观察面 OBS（studio-dev-539／重出 studio-dev-617；docs/17-§2 相位内步骤）：
    // 故障边沿触发落 REC-OBS-02＋观察义务 REC-OBS-03；恢复落 REC-OBS-04；写失败进 errors
    // （fail-closed，§6 接管≠收割）。面未装配＝零行为；观测写不改事实面（不 appendEvent、不 mutate）。
    let obs: CollectOutcome['obs']
    if (rt.deps.obs !== undefined) {
      const obsOutcome = rt.deps.obs.observe({
        seq,
        at: new Date(startedAt).toISOString(),
        lastTrustedAt: new Date(rt.lastCollectOkAt).toISOString(),
        cursorBefore,
        cursorAfter: cursor,
        failures: obsFailures,
      })
      obs = obsOutcome.report
      errors.push(...obsOutcome.errors)
    }
    // 最后可信点只在本拍采集无失败时前移（不取当前时刻冒充——v2/11 §十二 last_trusted.at）
    if (obsFailures.length === 0) rt.lastCollectOkAt = startedAt

    // —— 相位 1 尾：DEV-49 A4 双哨（未知态哨+状态集巡逻核，docs/52-§十；体=sentinels.ts，
    // 键派生=events-index.ts）——流外态单/出厂态回流不再只走 NOOP 静默观测链：ESCALATE
    // 落账（词表既有名）；哨计 mutations（RESUME 同口径）——有哨账的拍不落心跳。
    const index = buildEventIndex(ledger.queryEvents())
    const { alarmed: unknownStateAlarmed, foreignKnown, drift: statusSetDrift, declaredMissing: declaredStatusMissing, declaredExtra: platformStatusExtra } = await runDev49Sentinels({
      issues,
      flowOf,
      alarmedKeys: index.unknownStateAlarmed,
      foreignKnownKeys: index.foreignKnownAlarmed,
      driftKeys: index.statusSetDriftAlarmed,
      missingKeys: index.declaredStatusMissingAlarmed,
      extraKeys: index.platformStatusExtraAlarmed,
      attemptOf: index.attemptOf,
      ...(config.knownForeignStates === undefined ? {} : { knownForeignStates: config.knownForeignStates }),
      emit: (issue, attempt, note) => {
        makeEvent('ESCALATE', issue, attempt, tickEvents, { note })
      },
      emitForeignKnown: (issue, attempt, note) => {
        makeEvent('FOREIGN_KNOWN', issue, attempt, tickEvents, { note })
      },
      patrol: {
        seq,
        every: config.statusSetPatrolEveryTicks ?? 30,
        schema: () => platform.fields.schema(),
        ...(config.flows === undefined ? {} : { flows: config.flows }),
        ...(config.provisionDeclaredStates === undefined ? {} : { declared: config.provisionDeclaredStates }),
        heartbeatIssue: config.heartbeatIssue,
        deptFallback: config.deptFallback,
        at: startedAt,
      },
      onError: (msg) => {
        errors.push(msg)
      },
    })
    ctx.mutations += unknownStateAlarmed + foreignKnown + statusSetDrift + declaredStatusMissing + platformStatusExtra

    // —— 相位 1 尾：批示归一层（studio-dev-171，docs/18-§2.5；202-P1 位别两扩——
    //    dispatcher 源/验收位打回链/resume 物化，组装体=directive/wire.ts 工厂）
    const dLayer =
      rt.directives === undefined
        ? undefined
        : await runDirectiveLayer(
            engineDirectiveDeps({
              platform, gate: rt.directives, affected, issueById,
              directiveKeys: index.directiveKeys, attemptOf: (t) => index.attemptOf(t), flowOf,
              dispatcherOf: (t) => ledger.getTicketMirror(t)?.dispatcher,
              materializeResumeIntent: (t, cause, note) => { rt.intentQueue.push({ kind: 'resume', company: config.company, source: 'directive', ticket: t, payload: { cause, note } }) },
              releaseLane: (t) => { rt.lanes.release(issueById.get(t)?.lane ?? config.defaultLane, t) },
              syncMirror,
              emit: (event, issue, attempt, note) => makeEvent(event, issue, attempt, tickEvents, { note }),
              onError: (msg) => { errors.push(msg) },
            }),
          )
    const directiveReport = dLayer?.report ?? { tickets: 0, consumed: 0, rejected: 0 }
    const directiveVerbNow: ReadonlyMap<TicketId, DirectiveVerb> = dLayer?.verbsNow ?? new Map()
    ctx.mutations += dLayer?.mutations ?? 0
  return {
    cursorBefore,
    cursor,
    cursorLoop,
    pages,
    activityCount,
    affected,
    issues,
    issueById,
    mirrorGc,
    obs,
    index,
    unknownStateAlarmed,
    foreignKnown,
    statusSetDrift,
    declaredStatusMissing,
    platformStatusExtra,
    directiveReport,
    directiveVerbNow,
  }
}
