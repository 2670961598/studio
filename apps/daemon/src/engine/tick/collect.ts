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
import { createEventIndexAccumulator, type EventIndex, type EventIndexAccumulator } from '../sentinel/events-index.ts'
import { runDev49Sentinels } from '../sentinel/sentinels.ts'
import type { EngineRuntime } from '../runtime/types.ts'
import { CURSOR_KEY, type CollectOutcome, type TickCtx } from './ctx.ts'
import { syncMirrorsIncremental } from '../runtime/events.ts'
import { releaseTicketLane } from '../lanes/release.ts'

/**
 * daemon_kv 游标（studio-dev-785）：链序 seq（events_chain 唯一权威顺序，跨 ts 回填安全）＋
 * 最近事件 ts（回填检测：新增事件 ts < cursor.ts → 全量重建）＋lastId（tip 观测/排障）。
 * 进程内增量用；**重启/缓存缺失无条件全量重建**（不信任持久游标补齐——F1 修复）。
 */
const EVENT_INDEX_CURSOR_KEY = 'sentinel.eventIndex.cursor'
interface EventIndexCursor {
  readonly seq: number
  readonly ts: number
  readonly lastId: string
}
const eventIndexCache = new WeakMap<object, { acc: EventIndexAccumulator; cursor: EventIndexCursor }>()

function writeEventIndexCursor(ledger: EngineRuntime['ledger'], cursor: EventIndexCursor): void {
  ledger.kvSet(EVENT_INDEX_CURSOR_KEY, JSON.stringify(cursor))
}

/** 全量重建（启动/回退路径）：queryEvents(company) 按 ts,id 序喂累积器（与 buildEventIndex 全量同源） */
function rebuildEventIndex(
  ledger: EngineRuntime['ledger'],
  company: string,
): { acc: EventIndexAccumulator; cursor: EventIndexCursor } {
  const events = ledger.queryEvents({ company })
  const acc = createEventIndexAccumulator()
  acc.applyEvents(events)
  const last = events[events.length - 1]
  const cursor: EventIndexCursor = {
    seq: ledger.eventsChainTipSeq(),
    ts: last?.ts ?? 0,
    lastId: last?.id ?? '',
  }
  writeEventIndexCursor(ledger, cursor)
  return { acc, cursor }
}

/**
 * 事件索引读面（studio-dev-785）：进程内累积器 + 链序游标。
 * - 缓存缺失（进程重启/新 ledger 对象）→ **无条件全量重建**（F1：持久游标不用于回灌历史）；
 * - 稳态：`queryEventsAfterChainSeq(cursor.seq)` 只取链序新增事件（链 seq 是唯一权威顺序，F2：
 *   追加 ts 回填事件也可见）；若新增事件 ts < cursor.ts（检测到乱序/回填）→ 本拍全量重建；
 * - 链序异常/查询失败 → 全量重建；全量仍失败如实上抛（不吞）。
 */
export function eventIndexOf(ledger: EngineRuntime['ledger'], company: string): EventIndex {
  const cached = eventIndexCache.get(ledger)
  if (cached !== undefined) {
    try {
      const rows = ledger.queryEventsAfterChainSeq(cached.cursor.seq)
      if (rows.length === 0) return cached.acc.index()
      if (rows.some((row) => row.event.ts < cached.cursor.ts)) {
        // 回填/乱序 ts：链序增量会与全量（ts,id 序）状态不一致——全量重建（fail-safe）
        throw new Error('事件 ts 回填/乱序（新增事件 ts < cursor.ts）——本拍全量重建')
      }
      cached.acc.applyEvents(rows.map((row) => row.event))
      const lastRow = rows[rows.length - 1]
      if (lastRow === undefined) return cached.acc.index()
      const nextCursor: EventIndexCursor = { seq: lastRow.seq, ts: lastRow.event.ts, lastId: lastRow.event.id }
      writeEventIndexCursor(ledger, nextCursor)
      const entry = { acc: cached.acc, cursor: nextCursor }
      eventIndexCache.set(ledger, entry)
      return entry.acc.index()
    } catch {
      eventIndexCache.delete(ledger) // 增量不可信→本拍全量重建
    }
  }
  const rebuilt = rebuildEventIndex(ledger, company)
  eventIndexCache.set(ledger, rebuilt)
  return rebuilt.acc.index()
}

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
    // studio-dev-790 v3：activity.since（活动页）与 issues.list（全量对账）互不依赖 → 并行。
    // 错误面保持：各自失败只登记自己的 errors/obsFailures（与串行时同文案/同 source）。
    const issuesListPromise = platform.issues.list({}).then(
      (list) => ({ ok: true as const, list }),
      (err: unknown) => ({ ok: false as const, err }),
    )
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
          // studio-dev-790 v4：稳态自游标——adapter 在「无新活动」时回传边界自身 canonical
          // （790 v2 语义，禁止回落裸 id）。`nextCursor === cursor && items=[]` 是稳态，
          // 不是回退环：直接收敛（cursor 保持原值，不置 cursorLoop、不 push obsFailure）。
          if (page.nextCursor === cursor && page.items.length === 0) break
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
    const listResult = await issuesListPromise
    let issues: IssueRecord[]
    if (listResult.ok) {
      issues = listResult.list
    } else {
      mirrorListOk = false
      const message = `镜像对账失败（issues.list）：${listResult.err instanceof Error ? listResult.err.message : String(listResult.err)}`
      errors.push(message)
      obsFailures.push({ source: 'mirror-list', message })
      issues = []
    }
    const issueById = new Map<TicketId, IssueRecord>(issues.map((i) => [i.id, i]))
    // studio-dev-790 v3：镜像增量 upsert——期望行与现有行全字段比对，未变跳过（766 行/拍 → 变化行）。
    // 可重建投影语义不变：平台全量对账仍在本拍完成；mirror GC 仍按活动集删除残行（下方 step）。
    syncMirrorsIncremental(rt, issues)
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
    const index = eventIndexOf(ledger, config.company)
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
              releaseLane: (t) => {
                // studio-dev-812：inflight epoch 优先；新 attempt 在途=跳过+errors（防误放新租约）；
                // 无 inflight 仅 holder===ticket 用 state.epoch（显式携带，不再无 epoch 释放）。
                const lane = issueById.get(t)?.lane ?? config.defaultLane
                const result = releaseTicketLane(rt.lanes, rt.inflight, t, lane, errors, { skipIfInflight: true })
                if (result !== undefined && !result.ok && result.reason === 'stale-epoch') {
                  errors.push(`泳道释放拒收（批示打回面）${t}@${lane}：epoch 陈旧（epoch=${String(result.epoch)} current=${String(result.currentEpoch)}）`)
                }
              },
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
