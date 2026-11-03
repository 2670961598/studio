/**
 * test/v2/observe/obs-tick —— 观察面生产接线：PORT-OBS.reportFault 与相位 1 尾拍内步骤
 *
 * 依据：studio-dev-539（差距项 #13：只读投影生产消费=0＋reportFault/REC-OBS-02..04 无实现）；
 * docs/17-§2（观察面挂相位 1 采集尾——相位内步骤不增删相位）；docs/17-§6（观测写入不参与收割，
 * 写失败不冒认）；v2/08 §4.4（监控故障是一等观察；受影响视图显示未知/受损）、§5.3（观察结束不是
 * 遗忘）；v2/11 §十二（REC-OBS-02/03/04）；v2/14 §1.8（reportFault 唯一写槽）；v2/15 §一 SEC-FC-06
 * （system 代写须 onBehalfOf）；v2/17 NEG-MON-01/03。
 *
 * 覆盖：① 拍内状态机（故障边沿→开观察＋落 02；持续→不重复；恢复→04 结束；写失败→进 errors 且
 * 下拍重试）；② 重启重建（打开中观察从记录重建，恢复仍可结束）；③ 投影故障面升级为一等观察；
 * ④ 端口语义（公司维/署名/观察位置校验；写面错误→分类 Err，副作用可能性如实）；⑤ 真库集成
 * （store 写面＋hist.append：02/03/04 真落 records，openWatches 清空）。
 *
 * 隔离：内存库 `:memory:`＋migrate()；时钟/ID 注入；零真实台账、零平台 IO。
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import type { CallContext, FaultRef, PortFailure, PortResult, ProjectionFault } from '@studio-next/contract'
import { createHistFace, createObservationWriteFace, migrate } from '@studio-next/store'
import { createObservationTickStep, createObservationWritePort } from '../../../src/engine/observe/index.ts'
import type {
  ObsClosureInput,
  ObsRecordAck,
  ObsTickInput,
  ObsWatchInput,
  ObsProjectionRead,
  ObservationTickStep,
  ObservationWritePort,
} from '../../../src/engine/observe/index.ts'
import type { OpenObservationWatch } from '@studio-next/store'

const HOUR = 3_600_000
const T0 = Date.parse('2026-11-03T02:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()
const COMPANY = 'games'
const VIEW = 'MON-15'

const dbs: DatabaseSync[] = []
afterAll(() => {
  for (const db of dbs) db.close()
})

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  dbs.push(db)
  return db
}

function callCtx(over: Partial<CallContext> = {}): CallContext {
  return {
    company: { companyId: COMPANY, slug: COMPANY },
    caller: { callerId: 'daemon:engine/observe', kind: 'program', programRef: 'studio-next/daemon' },
    authority: [],
    signature: { actorKind: 'system', actorRef: 'daemon:engine/observe', onBehalfOf: 'OPS-1' },
    ...over,
  }
}

function ok<T>(value: T): PortResult<T> {
  return { kind: 'ok', value }
}

function failure(category: PortFailure['category'], subcause: string, sideEffectPossible = false): PortFailure {
  return {
    category,
    subcause,
    detail: `${subcause}（测试注入）`,
    retryable: true,
    sideEffectPossible,
    reconcile: sideEffectPossible ? { required: true, query: { recordType: 'REC-OBS-02', keys: { subcause } } } : { required: false, reason: '写前拒收' },
    responsiblePosition: 'test',
  }
}

function projectionOf(over: Partial<ObsProjectionRead> = {}): ObsProjectionRead {
  return {
    viewName: VIEW,
    snapshotFound: false,
    states: [{ face: 'collect', state: 'unknown', lastTrustedCursor: null }],
    fault: { kind: 'coverage_gap', detail: '无 REC-OBS-01 快照（材料不足）' },
    generatedAt: null,
    dataWindowTo: null,
    rosterIds: [],
    ...over,
  }
}

function tickInput(over: Partial<ObsTickInput> = {}): ObsTickInput {
  return {
    seq: over.seq ?? 1,
    at: over.at ?? iso(T0),
    lastTrustedAt: over.lastTrustedAt ?? iso(T0 - 60_000),
    cursorBefore: over.cursorBefore ?? 'cursor:1',
    cursorAfter: over.cursorAfter === undefined ? 'cursor:2' : over.cursorAfter,
    failures: over.failures ?? [{ source: 'activity', message: '采集相位失败：平台超时' }],
  }
}

// —— 观察面 fake 端口（状态机断言；零 DB） ——

interface FakePortState {
  watchInputs: ObsWatchInput[]
  faults: { fault: ProjectionFault; lastTrustedAt: string }[]
  closures: ObsClosureInput[]
  faultError: PortFailure | undefined
  watchError: PortFailure | undefined
  closureError: PortFailure | undefined
  projection: PortResult<ObsProjectionRead>
  open: OpenObservationWatch[]
}

function fakePort(over: Partial<FakePortState> = {}): { port: ObservationWritePort; state: FakePortState } {
  const state: FakePortState = {
    watchInputs: [],
    faults: [],
    closures: [],
    faultError: undefined,
    watchError: undefined,
    closureError: undefined,
    projection: ok(projectionOf()),
    open: [],
    ...over,
  }
  const port: ObservationWritePort = {
    reportFault: (_fault, _ctx): PortResult<FaultRef> => ok({ recordId: 'fault-x', version: 1, recordedAs: 'projection_fault', mutatesFacts: false }),
    reportFaultAt: (fault, _ctx, lastTrustedAt): PortResult<FaultRef> => {
      if (state.faultError !== undefined) return { kind: 'err', error: state.faultError }
      state.faults.push({ fault, lastTrustedAt })
      return ok({ recordId: `fault-${state.faults.length}`, version: 1, recordedAs: 'projection_fault', mutatesFacts: false })
    },
    recordContinuousObservation: (input, _ctx): PortResult<ObsRecordAck> => {
      if (state.watchError !== undefined) return { kind: 'err', error: state.watchError }
      state.watchInputs.push(input)
      return ok({ recordId: `watch-${state.watchInputs.length}`, appended: true, version: 1 })
    },
    recordObservationClosure: (input, _ctx): PortResult<ObsRecordAck> => {
      if (state.closureError !== undefined) return { kind: 'err', error: state.closureError }
      state.closures.push(input)
      return ok({ recordId: `closure-${state.closures.length}`, appended: true, version: 1 })
    },
    openWatches: (): PortResult<readonly OpenObservationWatch[]> => ok(state.open),
    project: (): PortResult<ObsProjectionRead> => state.projection,
  }
  return { port, state }
}

function stepOf(port: ObservationWritePort, over: { windowMs?: number } = {}): ObservationTickStep {
  return createObservationTickStep({
    company: COMPANY,
    ctx: () => callCtx(),
    port,
    ...(over.windowMs !== undefined ? { watchWindowMs: over.windowMs } : {}),
  })
}

// —— 一、拍内状态机 ——

describe('观察面拍内状态机（相位 1 尾；边沿触发）', () => {
  it('故障出现：开 REC-OBS-03＋每类落 REC-OBS-02；故障持续：不重复写', () => {
    const { port, state } = fakePort({ projection: ok(projectionOf({ fault: null, snapshotFound: true, states: [{ face: 'collect', state: 'observed', lastTrustedCursor: 'c:1' }] })) })
    const step = stepOf(port)

    const first = step.observe(tickInput())
    expect(first.report).toMatchObject({ view: VIEW, faultsRecorded: 1, watchesOpened: 1, watchesClosed: 0, openWatches: 1 })
    expect(state.watchInputs).toHaveLength(1)
    expect(state.watchInputs[0]?.window.declaredFrom).toBe(iso(T0 - 60_000))
    expect(state.watchInputs[0]?.window.declaredTo).toBe(iso(T0 - 60_000 + HOUR))
    expect(state.watchInputs[0]?.sightings.independentDiscoveryChannels[0]?.channel).toBe('daemon-tick-report')
    expect(state.faults).toHaveLength(1)
    expect(state.faults[0]?.fault).toMatchObject({
      failureKind: 'collection_interrupted',
      occurredAt: iso(T0 - 60_000),
      discoveredAt: iso(T0),
      lastTrustedCursor: 'cursor:2',
      displayEffect: 'unknown',
      affectedViews: [{ viewName: VIEW, company: { companyId: COMPANY, slug: COMPANY } }],
    })
    expect(state.faults[0]?.lastTrustedAt).toBe(iso(T0 - 60_000))
    expect(first.logLines.join('\n')).toContain('观察开启')

    const second = step.observe(tickInput({ seq: 2, at: iso(T0 + 1000) }))
    expect(second.report).toMatchObject({ faultsRecorded: 0, watchesOpened: 0, openWatches: 1 })
    expect(state.watchInputs).toHaveLength(1)
    expect(state.faults).toHaveLength(1)
  })

  it('故障消失：REC-OBS-04 有据结束（窗口所见＋残留风险＋再触发条件）并清观察', () => {
    const { port, state } = fakePort({ projection: ok(projectionOf({ fault: null, snapshotFound: true })) })
    const step = stepOf(port)
    step.observe(tickInput())
    const closed = step.observe(tickInput({ seq: 2, at: iso(T0 + 1000), failures: [] }))
    expect(closed.report).toMatchObject({ faultsRecorded: 0, watchesClosed: 1, openWatches: 0 })
    expect(state.closures).toHaveLength(1)
    expect(state.closures[0]?.watchRecordId).toBe('watch-1')
    expect(state.closures[0]?.basis[0]?.terminalBasis).toContain('cursor=')
    expect(state.closures[0]?.residualRisk.length).toBeGreaterThan(0)
    expect(closed.logLines.join('\n')).toContain('观察结束')
  })

  it('投影故障（有快照但不可用）升级为一等观察：conflict_unresolved 落 REC-OBS-02', () => {
    const { port, state } = fakePort({
      projection: ok(projectionOf({ snapshotFound: true, fault: { kind: 'conflict_unresolved', detail: '同刻多条最新快照（不静默选边）' } })),
    })
    const step = stepOf(port)
    const outcome = step.observe(tickInput({ failures: [] }))
    expect(outcome.report.faultsRecorded).toBe(1)
    expect(state.faults[0]?.fault.failureKind).toBe('conflict_unresolved')
    expect(state.faults[0]?.fault.rootCauseClass).toBe('projection-unusable')
    expect(outcome.report.projection).toMatchObject({ snapshotFound: true, faultKind: 'conflict_unresolved' })
  })

  it('写法失败 fail-closed：进拍 errors（不冒认已写），下拍重试成功后才计已记录', () => {
    const { port, state } = fakePort({ faultError: failure('unavailable', 'store/obs:write-failed', true) })
    const step = stepOf(port)
    const first = step.observe(tickInput())
    expect(first.errors.join('\n')).toContain('监控故障未落地')
    expect(first.errors.join('\n')).toContain('sideEffectPossible=true')
    expect(first.report.faultsRecorded).toBe(0)

    state.faultError = undefined
    const second = step.observe(tickInput({ seq: 2, at: iso(T0 + 1000) }))
    expect(second.report.faultsRecorded).toBe(1)
    expect(state.faults).toHaveLength(1)
  })

  it('观察义务写失败：本拍故障也不写（观察不成立先于故障记录），并进 errors', () => {
    const { port, state } = fakePort({ watchError: failure('unavailable', 'store/obs:write-failed', true) })
    const step = stepOf(port)
    const outcome = step.observe(tickInput())
    expect(outcome.errors.join('\n')).toContain('观察义务记录未落地')
    expect(state.faults).toHaveLength(0)
    expect(outcome.report).toMatchObject({ faultsRecorded: 0, watchesOpened: 0 })
  })

  it('重启重建：打开中观察取自记录；恢复拍直接 04 结束（不重复开观察）', () => {
    const open: OpenObservationWatch = {
      recordId: 'watch-persisted',
      subjectRefId: VIEW,
      subjectKind: 'observation-view',
      declaredFrom: iso(T0 - 2 * HOUR),
      declaredTo: iso(T0 - HOUR),
      lastTrustedAt: iso(T0 - 2 * HOUR),
    }
    const { port, state } = fakePort({ open: [open], projection: ok(projectionOf({ fault: null, snapshotFound: true })) })
    const step = stepOf(port)
    const recovered = step.observe(tickInput({ seq: 5, failures: [] }))
    expect(recovered.report).toMatchObject({ watchesOpened: 0, watchesClosed: 1, openWatches: 0 })
    expect(state.watchInputs).toHaveLength(0)
    expect(state.closures[0]?.watchRecordId).toBe('watch-persisted')
  })

  it('打开中观察读取失败＝本拍不写（避免重复开观察），显式进 errors', () => {
    const { port } = fakePort()
    const broken: ObservationWritePort = {
      ...port,
      openWatches: () => ({ kind: 'err', error: failure('unavailable', 'store/obs:write-failed', true) }),
    }
    const step = stepOf(broken)
    const outcome = step.observe(tickInput())
    expect(outcome.errors.join('\n')).toContain('打开中观察读取失败')
    expect(outcome.report).toMatchObject({ faultsRecorded: 0, watchesOpened: 0 })
  })
})

// —— 二、端口语义（ctx 校验／错误分类） ——

describe('PORT-OBS 写面端口语义（reportFault）', () => {
  function portOf(db: DatabaseSync): { port: ObservationWritePort; faults: number } {
    const writer = createObservationWriteFace({
      db,
      company: COMPANY,
      decidedBy: 'OPS-1',
      makeId: () => iso(T0),
      now: () => iso(T0),
    })
    return { port: createObservationWritePort({ writer, company: COMPANY, decidedBy: 'OPS-1' }), faults: 0 }
  }

  const fault: ProjectionFault = {
    failureKind: 'source_unreachable',
    occurredAt: iso(T0 - 1000),
    discoveredAt: iso(T0),
    affectedViews: [{ viewName: VIEW, company: { companyId: COMPANY, slug: COMPANY } }],
    lastTrustedCursor: 'cursor:9',
    displayEffect: 'unknown',
    rootCauseClass: 'platform-list-unreachable',
  }

  it('合法 ctx：Ok(FaultRef)，recordId 落库；回执 mutatesFacts=false（监控不改事实）', () => {
    const db = freshDb()
    const { port } = portOf(db)
    const result = port.reportFault(fault, callCtx())
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('应 Ok')
    expect(result.value).toMatchObject({ version: 1, recordedAs: 'projection_fault', mutatesFacts: false })
    const count = db.prepare("SELECT COUNT(*) AS c FROM records WHERE record_type = 'REC-OBS-02'").get() as { c?: unknown }
    expect(Number(count.c)).toBe(1)
  })

  it('跨公司 ctx＝rejected_precondition（SEC-WD-01）', () => {
    const { port } = portOf(freshDb())
    const result = port.reportFault(fault, callCtx({ company: { companyId: 'other', slug: 'other' } }))
    expect(result.kind).toBe('err')
    if (result.kind !== 'err') throw new Error('应 Err')
    expect(result.error).toMatchObject({ category: 'rejected_precondition', subcause: 'company-mismatch', sideEffectPossible: false, retryable: false })
  })

  it('非 system 署名／onBehalfOf 与被装配观察位置不一致＝rejected_authority（不冒名）', () => {
    const { port } = portOf(freshDb())
    const person = port.reportFault(fault, callCtx({ signature: { actorKind: 'person', actorRef: 'OPS-1' } }))
    expect(person.kind === 'err' ? person.error.subcause : '').toBe('signature-not-system')
    const impostor = port.reportFault(fault, callCtx({ signature: { actorKind: 'system', actorRef: 'daemon:engine/observe', onBehalfOf: 'ENG-9' } }))
    expect(impostor.kind === 'err' ? impostor.error.subcause : '').toBe('observer-mismatch')
  })

  it('写面形状拒收＝rejected_precondition（0 行；sideEffectPossible=false，不发明对账面）', () => {
    const { port } = portOf(freshDb())
    const result = port.reportFault({ ...fault, affectedViews: [] as never }, callCtx())
    expect(result.kind).toBe('err')
    if (result.kind !== 'err') throw new Error('应 Err')
    expect(result.error.category).toBe('rejected_precondition')
    expect(result.error.sideEffectPossible).toBe(false)
    expect(result.error.reconcile.required).toBe(false)
  })
})

// —— 三、真库集成：store 写面＋拍内步骤（端到端落 records） ——

describe('真库集成：02/03/04 端到端落 records 并可由 openWatches 复核', () => {
  it('故障拍→02+03；恢复拍→04；records 三类各一条、观察清零', () => {
    const db = freshDb()
    const writer = createObservationWriteFace({
      db,
      hist: createHistFace(db),
      company: COMPANY,
      decidedBy: 'OPS-1',
      makeId: (() => {
        let seq = 0
        return () => `01JOB${String(seq++).padStart(6, '0')}`
      })(),
      now: () => iso(T0),
    })
    const port = createObservationWritePort({ writer, company: COMPANY, decidedBy: 'OPS-1' })
    const step = stepOf(port)

    const first = step.observe(tickInput({ failures: [{ source: 'mirror-list', message: '镜像对账失败：issues.list 不可达' }] }))
    expect(first.errors).toEqual([])
    expect(first.report).toMatchObject({ faultsRecorded: 1, watchesOpened: 1 })

    const second = step.observe(tickInput({ seq: 2, at: iso(T0 + 1000), failures: [] }))
    expect(second.errors).toEqual([])
    expect(second.report).toMatchObject({ watchesClosed: 1, openWatches: 0 })

    for (const type of ['REC-OBS-02', 'REC-OBS-03', 'REC-OBS-04']) {
      const row = db.prepare('SELECT COUNT(*) AS c FROM records WHERE record_type = ?').get(type) as { c?: unknown }
      expect(Number(row.c), type).toBe(1)
    }
    expect(writer.openWatches()).toEqual([])
    expect(writer.readFaults({ viewName: VIEW })).toHaveLength(1)

    const closure = db.prepare("SELECT payload FROM records WHERE record_type = 'REC-OBS-04'").get() as { payload: string }
    const payload = JSON.parse(closure.payload) as { watch_ref: { refId: string } }
    const watch = db.prepare("SELECT record_id FROM records WHERE record_type = 'REC-OBS-03'").get() as { record_id: string }
    expect(payload.watch_ref.refId).toBe(watch.record_id)
  })
})
