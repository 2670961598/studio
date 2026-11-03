/**
 * engine/observe/tick —— 观察面·相位 1 尾拍内步骤（只读投影消费＋REC-OBS-02/03/04 写入编排）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：采集→state-diff→派发→收割→合并→回收→落账/心跳。本件挂在
 *     **相位 1 采集尾**，是相位内步骤——不增删相位、不新增事件名）；
 *   - docs/17-§6（收割四要件：观测写入不参与收割判定；「接管≠收割」——写失败原样进拍错误面，
 *     不冒认已写、不静默降级）；
 *   - docs/v2/08 §4.4（监控故障是一等观察：采集失败/投影故障须显式登记，受影响视图显示未知/受损；
 *     §4.4 还要求「不得沿用最后一张健康快照」——故本步只报故障，不伪造健康投影）；
 *   - docs/v2/08 §4.1（投影六态：未知不补零——`snapshotFound=false` 时报告如实标 unknown）；
 *   - docs/v2/08 §5.3（观察结束不是遗忘：恢复后以 REC-OBS-04 有据结束，登记残留风险与再触发条件）；
 *   - docs/v2/11 §十二（REC-OBS-02/03/04 字段与不变量；观察面→记录组映射 MON-15 监控自身）；
 *   - docs/v2/14 §1.8（PORT-OBS：只读投影＋reportFault 唯一写槽）；
 *   - docs/plan/05 IMPL-04-08（只读投影）后的写面腿；studio-dev-539（差距项 #13）。
 *
 * 状态机（边沿触发，防刷屏）：
 *   故障出现（本拍有采集失败或投影故障）且该视图无打开中观察 → 开 REC-OBS-03（观察义务）＋
 *   逐类落 REC-OBS-02（每类一条；按观察记录 id 幂等，同拍重放命中既有）；故障持续 → 不重复写；
 *   故障消失 → REC-OBS-04 有据结束（窗口所见＋终局依据＋残留风险＋再触发条件）并清观察。
 *   进程重启：打开中观察经 `port.openWatches()` 从记录重建（不依赖内存态），恢复同样可结束。
 *
 * 幂等：写入键＝(视图/类别, tick 序列)——同拍重放命中既有；跨拍＝新观察（§0.4-4）。
 * 诚实边界（登记缺口）：投影快照生产面（REC-OBS-01 写者）未在本单领土——无快照时本步如实报
 * unknown、不伪造健康投影（NEG-MON-01），也**不把「无快照」记成 coverage_gap 故障**（避免把
 * 材料缺口冒充监控故障）；投影故障只在**有快照且不可用**（projection_failed/conflict/stale）时
 * 升级为一等观察。投影生产者落地后本步自动纳入故障面，无需改判据。
 */
import {
  PROJECTION_FAULT_KINDS,
  type CallContext,
  type FaultRef,
  type ProjectionFault,
  type ProjectionFaultKind,
} from '@studio-next/contract'
import type {
  ObsClosureInput,
  ObsCollectFailure,
  ObsProjectionRead,
  ObsTickInput,
  ObsTickOutcome,
  ObsWatchInput,
  ObservationTickStep,
  ObservationWritePort,
} from './types.ts'

/** 观察视图：MON-15「监控自身」（采集中断/覆盖缺口/陈旧视图/最后可信游标/恢复与根因——v2/08 §4.2） */
export const OBS_SELF_VIEW = 'MON-15' as const
/** 该视图逐面状态槽（面名显式点名——空集可能被误读为「无异常」，NEG-MON-01） */
export const OBS_SELF_FACES = ['collect', 'projection', 'freshness'] as const
/** 观察窗口缺省时长（1h；REC-OBS-03 事前声明窗口） */
export const OBS_WATCH_WINDOW_MS = 60 * 60_000
/** 独立发现通道名（不依赖执行体自报——v2/08 §五） */
export const OBS_INDEPENDENT_CHANNEL = 'daemon-tick-report' as const
/** 观察主体类别（视图类主体；v2/11 §十二 观察面 MON-xx） */
export const OBS_SUBJECT_KIND = 'observation-view' as const

/** 拍内观察步依赖（运行装配注入；测试可用 fake port 复现） */
export interface ObservationTickStepDeps {
  /** 公司 slug（select 视图/记录公司维） */
  readonly company: string
  /** 被观察视图名（缺省 MON-15） */
  readonly viewName?: string
  /** 视图逐面状态键（缺省 collect/projection/freshness） */
  readonly faces?: readonly string[]
  readonly port: ObservationWritePort
  /** CallContext 构造（运行装配注入署名；测试给确定性 fake） */
  readonly ctx: () => CallContext
  /** 观察窗口时长（ms；缺省 1h） */
  readonly watchWindowMs?: number
  /** 日志出口（缺省 no-op；serve 装配接 daemon 日志） */
  readonly log?: (line: string) => void
}

/** 打开中的观察（引擎侧携带态；记录为唯一源，重启可重建） */
interface OpenEpisode {
  readonly recordId: string
  readonly declaredFrom: string
  readonly declaredTo: string
  readonly reportedKinds: Set<string>
}

/** 故障条件（本拍识别到的观察面故障） */
interface FaultCondition {
  readonly kind: ProjectionFaultKind
  readonly detail: string
  readonly rootCauseClass: string
  readonly escalation: boolean
}

/** 观察面拍内步骤工厂（每引擎一实例；状态=打开中观察索引） */
export function createObservationTickStep(deps: ObservationTickStepDeps): ObservationTickStep {
  const viewName = deps.viewName ?? OBS_SELF_VIEW
  const faces = deps.faces ?? OBS_SELF_FACES
  const windowMs = deps.watchWindowMs ?? OBS_WATCH_WINDOW_MS
  const log = deps.log ?? ((): void => {})
  const episodes = new Map<string, OpenEpisode>()
  let initialized = false

  const initOnce = (errors: string[]): boolean => {
    if (initialized) return true
    const loaded = deps.port.openWatches()
    if (loaded.kind !== 'ok') {
      errors.push(`观察面打开中观察读取失败：${loaded.error.subcause}——本拍不写观察记录（避免重复开观察）`)
      return false
    }
    for (const watch of loaded.value) {
      episodes.set(watch.subjectRefId, {
        recordId: watch.recordId,
        declaredFrom: watch.declaredFrom,
        declaredTo: watch.declaredTo,
        reportedKinds: new Set(),
      })
    }
    initialized = true
    return true
  }

  const observe = (input: ObsTickInput): ObsTickOutcome => {
    const errors: string[] = []
    const logLines: string[] = []
    /** 观测行同时进本拍报告与 daemon 日志（不落台账事件——事件词表冻结 17-§3） */
    const note = (line: string): void => {
      logLines.push(line)
      log(line)
    }
    let faultsRecorded = 0
    let watchesOpened = 0
    let watchesClosed = 0

    // ① 只读投影消费（生产消费 projectObservationSnapshot；失败=拍错误面，不伪造状态）
    let projection: ObsProjectionRead | undefined
    const projected = deps.port.project({ viewName, faces })
    if (projected.kind === 'ok') projection = projected.value
    else errors.push(`观察面投影读取失败：${projected.error.subcause}——本拍按材料不足处理（不补零/不补绿）`)

    // ② 本拍故障条件（采集失败面＋投影故障面；按类别去重保序）
    const conditions = conditionsOf(input.failures, projection)
    const ctx = deps.ctx()

    // ③ 观察索引首次装载（记录为唯一源；读失败=本拍不写）
    if (!initOnce(errors)) {
      return {
        report: reportOf(viewName, faultsRecorded, watchesOpened, watchesClosed, episodes, projection),
        errors,
        logLines,
      }
    }

    const episode = episodes.get(viewName)
    if (conditions.length > 0) {
      // ④ 故障出现：无观察则开 REC-OBS-03；逐类落 REC-OBS-02（边沿触发/幂等）
      let active = episode
      if (active === undefined) {
        const opened = deps.port.recordContinuousObservation(watchInputOf(input, viewName, windowMs), ctx)
        if (opened.kind === 'ok') {
          active = {
            recordId: opened.value.recordId,
            declaredFrom: input.lastTrustedAt,
            declaredTo: addMs(input.lastTrustedAt, windowMs),
            reportedKinds: new Set(),
          }
          episodes.set(viewName, active)
          watchesOpened += 1
          note(
            `[obs] 观察开启（REC-OBS-03）：view=${viewName} watch=${opened.value.recordId} window=${input.lastTrustedAt}..${addMs(input.lastTrustedAt, windowMs)}`,
          )
        } else {
          errors.push(
            `观察义务记录未落地（REC-OBS-03，view=${viewName}）：${describeFailure(opened.error)}——` +
              '本拍不再写该视图故障记录（观察不成立先于故障记录；下拍重试）',
          )
        }
      }
      if (active !== undefined) {
        for (const condition of conditions) {
          if (active.reportedKinds.has(condition.kind)) continue
          const recorded = deps.port.reportFaultAt(
            faultOf(input, viewName, condition, deps.company),
            ctx,
            input.lastTrustedAt,
          )
          if (recorded.kind === 'ok') {
            active.reportedKinds.add(condition.kind)
            faultsRecorded += 1
            note(faultLine(viewName, condition, recorded.value, input))
          } else {
            errors.push(
              `监控故障未落地（REC-OBS-02，view=${viewName} kind=${condition.kind}）：${describeFailure(recorded.error)}` +
                '——下拍重试（观察不改事实：不冒认已记录）',
            )
          }
        }
      }
    } else if (episode !== undefined) {
      // ⑤ 故障消失：REC-OBS-04 有据结束（观察结束不是遗忘——残留风险与再触发条件必须登记）
      const closed = deps.port.recordObservationClosure(closureInputOf(input, viewName, episode, projection), ctx)
      if (closed.kind === 'ok') {
        episodes.delete(viewName)
        watchesClosed += 1
        note(
          `[obs] 观察结束（REC-OBS-04）：view=${viewName} watch=${episode.recordId} closure=${closed.value.recordId}` +
            ` seq=#${input.seq}`,
        )
      } else {
        errors.push(
          `观察结束记录未落地（REC-OBS-04，view=${viewName} watch=${episode.recordId}）：${describeFailure(closed.error)}` +
            '——观察保持打开（不冒认已结束）',
        )
      }
    }

    return {
      report: reportOf(viewName, faultsRecorded, watchesOpened, watchesClosed, episodes, projection),
      errors,
      logLines,
    }
  }

  return { observe }
}

// —— 内部小件（纯映射；零 IO） ——

function reportOf(
  viewName: string,
  faultsRecorded: number,
  watchesOpened: number,
  watchesClosed: number,
  episodes: ReadonlyMap<string, OpenEpisode>,
  projection: ObsProjectionRead | undefined,
): ObsTickOutcome['report'] {
  return {
    view: viewName,
    faultsRecorded,
    watchesOpened,
    watchesClosed,
    openWatches: episodes.size,
    projection: {
      snapshotFound: projection?.snapshotFound ?? false,
      states: (projection?.states ?? []).map((state) => ({ face: state.face, state: state.state })),
      faultKind: projection?.fault === null || projection === undefined ? null : projection.fault.kind,
    },
  }
}

function conditionsOf(failures: readonly ObsCollectFailure[], projection: ObsProjectionRead | undefined): readonly FaultCondition[] {
  const out: FaultCondition[] = []
  const seen = new Set<string>()
  const push = (condition: FaultCondition): void => {
    if (seen.has(condition.kind)) return
    seen.add(condition.kind)
    out.push(condition)
  }
  for (const failure of failures) {
    if (failure.source === 'activity') {
      push({ kind: 'collection_interrupted', detail: failure.message, rootCauseClass: 'activity-stream-fetch', escalation: true })
    } else if (failure.source === 'mirror-list') {
      push({ kind: 'source_unreachable', detail: failure.message, rootCauseClass: 'platform-list-unreachable', escalation: true })
    } else {
      push({ kind: 'cursor_broken', detail: failure.message, rootCauseClass: 'activity-cursor-loop', escalation: true })
    }
  }
  // 投影故障只在**有快照且不可用**时成为故障面：无 REC-OBS-01 快照＝材料不足（如实 unknown，
  // 不伪造成 coverage_gap 故障——投影快照生产面不在本单领土，缺口登记见文件头注与 REPORT）
  if (projection?.snapshotFound === true && projection.fault !== null) {
    const kind = projection.fault.kind
    if ((PROJECTION_FAULT_KINDS as readonly string[]).includes(kind)) {
      push({
        kind: kind as ProjectionFaultKind,
        detail: projection.fault.detail,
        rootCauseClass: 'projection-unusable',
        escalation: kind === 'conflict_unresolved',
      })
    }
  }
  return out
}

function faultOf(
  input: ObsTickInput,
  viewName: string,
  condition: FaultCondition,
  company: string,
): ProjectionFault {
  return {
    failureKind: condition.kind,
    occurredAt: input.lastTrustedAt,
    discoveredAt: input.at,
    affectedViews: [{ viewName, company: { companyId: company, slug: company } }],
    lastTrustedCursor: input.cursorAfter ?? input.cursorBefore ?? '(no-cursor)',
    displayEffect: 'unknown',
    rootCauseClass: condition.rootCauseClass,
  }
}

function watchInputOf(input: ObsTickInput, viewName: string, windowMs: number): ObsWatchInput {
  return {
    subject: { kind: OBS_SUBJECT_KIND, refId: viewName },
    window: {
      declaredFrom: input.lastTrustedAt,
      declaredTo: addMs(input.lastTrustedAt, windowMs),
      lastTrustedAt: input.lastTrustedAt,
    },
    sightings: {
      independentDiscoveryChannels: [
        { channel: OBS_INDEPENDENT_CHANNEL, materialRef: { refId: `daemon-tick:${input.seq}`, refVersion: '1.0.0' } },
      ],
    },
    uncertainty: {
      reachable: false,
      treatment: '不可达/不可观测按「未知」处理，不记为「已停止」；恢复以采集成功＋投影可用为准',
    },
    escalationFlag: true,
    idempotency: { subjectId: viewName, operationClass: 'continuous-observation', requesterSequence: `tick-${input.seq}` },
  }
}

function closureInputOf(
  input: ObsTickInput,
  viewName: string,
  episode: OpenEpisode,
  projection: ObsProjectionRead | undefined,
): ObsClosureInput {
  const projectionState =
    projection === undefined ? '投影不可读（材料不足）' : `投影 snapshotFound=${String(projection.snapshotFound)} fault=${projection.fault === null ? 'none' : projection.fault.kind}`
  return {
    watchRecordId: episode.recordId,
    basis: [
      {
        sighting: `拍 #${input.seq}（${input.at}）采集成功且观察面投影可用（${projectionState}）`,
        terminalBasis: `最后可信游标 cursor=${input.cursorAfter ?? input.cursorBefore ?? '(no-cursor)'}；观察窗口 ${episode.declaredFrom}..${episode.declaredTo}`,
      },
    ],
    residualRisk: [
      `同型监控故障可能再现（view=${viewName}；再触发按新事项受理并回查本观察记录）`,
      '投影快照生产面未装配时该视图仍显示 unknown（材料不足——不得补 0/补绿）',
    ],
    retriggerTerms: '同类采集中断/来源不可达/投影故障再现＝新开 REC-OBS-02＋REC-OBS-03，并回查本结束记录',
    idempotency: { subjectId: episode.recordId, operationClass: 'observation-closure', requesterSequence: `tick-${input.seq}` },
  }
}

function faultLine(
  viewName: string,
  condition: FaultCondition,
  ref: FaultRef,
  input: ObsTickInput,
): string {
  return (
    `[obs] 监控故障已登记（REC-OBS-02）：view=${viewName} kind=${condition.kind} record=${ref.recordId}` +
    ` cursor=${input.cursorAfter ?? input.cursorBefore ?? '(no-cursor)'} seq=#${input.seq}`
  )
}

function describeFailure(failure: { readonly subcause: string; readonly detail?: string; readonly sideEffectPossible: boolean }): string {
  return `${failure.subcause}${failure.detail === undefined ? '' : `（${failure.detail}）`} sideEffectPossible=${String(failure.sideEffectPossible)}`
}

/** ISO 时刻 + 毫秒（observation window；不可解析=装配/时钟错误，显式抛） */
function addMs(timestamp: string, deltaMs: number): string {
  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) throw new Error(`observe/tick：时刻不可解析（注入时钟须给带偏移 ISO）：${timestamp}`)
  return new Date(ms + deltaMs).toISOString()
}
