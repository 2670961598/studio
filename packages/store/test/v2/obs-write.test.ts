/**
 * test/v2/obs-write —— OBS 观察族写面（REC-OBS-02/03/04）：生产观测记录落库＋fail-closed
 *
 * 依据：studio-dev-539（差距项 #13）；docs/17-§2（观察面=相位 1 尾内步骤）；docs/17-§6（观测写入
 * 不参与收割判定，「接管≠收割」——写失败不冒认）；v2/11 §十二（REC-OBS-02/03/04 字段与不变量）、
 * §0.4（幂等）、§0.5（生效槽）；v2/08 §4.4（监控故障是一等观察；受影响视图只显示未知/受损，
 * 不得留空/显示为零/沿用最后健康快照）、§5.3（观察结束不是遗忘）；v2/17 NEG-MON-01/NEG-MON-03；
 * v2/14 §1.6/§1.8（PORT-HIST 唯一记录写口／PORT-OBS.reportFault 写槽）。
 *
 * 覆盖：① REC-OBS-02 落库（字段映射/displayEffect 映射/幂等重放/读回）；② fail-closed 负向面
 * （形状不符、缺最后可信点、跨公司、动作限制未给依据三元组、闸拒、写口异常）——一律 0 行落库；
 * ③ REC-OBS-03/04 全链（开观察→结束），不变量拒收（窗口倒置、独立通道空、refType 错）；
 * ④ 打开中观察索引（openWatches）与故障读回（readFaults）；⑤ 只读投影转发（project）；
 * ⑥ NEG-MON-03：写面只落 records，不改 events/work_records 等事实面。
 *
 * 隔离：临时库＝`new DatabaseSync(':memory:')`＋migrate()；时钟/ID 注入，不读墙钟、不碰真实台账。
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { migrate } from '../../src/migrations.ts'
import { createHistFace } from '../../src/hist.ts'
import {
  createObservationWriteFace,
  ObsWriteError,
  OBS_CLOSURE_RECORD_TYPE,
  OBS_FAULT_RECORD_TYPE,
  OBS_WATCH_RECORD_TYPE,
  type ObservationFaultWriteInput,
  type ObservationWriteFace,
} from '../../src/obs/write.ts'
import { T0, ulid } from './fixtures.ts'

const HOUR = 3_600_000
const iso = (ms: number): string => new Date(ms).toISOString()
const COMPANY = 'games'

const dbs: DatabaseSync[] = []
const ALLOWED_WRITE_FACES = ['reportFault', 'recordContinuousObservation', 'recordObservationClosure'] as const

afterAll(() => {
  for (const db of dbs) db.close()
})

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  dbs.push(db)
  return db
}

/** 写面夹具：确定性 ID/时钟（同输入同输出——幂等断言可复算） */
function faceOf(db: DatabaseSync, options: { decidedBy?: string; company?: string; guardRecord?: (record: unknown) => unknown } = {}): ObservationWriteFace {
  let seq = 0
  return createObservationWriteFace({
    db,
    company: options.company ?? COMPANY,
    decidedBy: options.decidedBy ?? 'OPS-1',
    makeId: () => ulid(T0, 9000 + seq++),
    now: () => iso(T0),
    ...(options.guardRecord !== undefined ? { guardRecord: options.guardRecord } : {}),
  })
}

function faultInput(over: Partial<ObservationFaultWriteInput> & { fault?: ObservationFaultWriteInput['fault'] } = {}): ObservationFaultWriteInput {
  return {
    fault: over.fault ?? {
      failureKind: 'collection_interrupted',
      occurredAt: iso(T0 - 5_000),
      discoveredAt: iso(T0),
      affectedViews: [{ viewName: 'MON-15', company: { companyId: COMPANY, slug: COMPANY } }],
      lastTrustedCursor: 'cursor:42',
      displayEffect: 'unknown',
      rootCauseClass: 'activity-stream-fetch',
    },
    lastTrustedAt: over.lastTrustedAt ?? iso(T0 - 5_000),
    ...(over.actionRestrictionBasis !== undefined ? { actionRestrictionBasis: over.actionRestrictionBasis } : {}),
    idempotency: over.idempotency ?? { subjectId: 'MON-15:collection_interrupted', operationClass: 'monitoring-fault', requesterSequence: `tick-1` },
  }
}

function countRows(db: DatabaseSync, type: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM records WHERE record_type = ?').get(type) as { c?: unknown }
  return Number(row.c)
}

function onlyRow(db: DatabaseSync, type: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM records WHERE record_type = ?').get(type) as Record<string, unknown>
  return row
}

function watchInput(): Parameters<ObservationWriteFace['recordContinuousObservation']>[0] {
  return {
    subject: { kind: 'observation-view', refId: 'MON-15' },
    window: { declaredFrom: iso(T0 - HOUR), declaredTo: iso(T0), lastTrustedAt: iso(T0 - 5_000) },
    sightings: {
      independentDiscoveryChannels: [{ channel: 'daemon-tick-report', materialRef: { refId: 'daemon-tick:7', refVersion: '1.0.0' } }],
    },
    uncertainty: { reachable: false, treatment: '不可达按未知处理，不记为已停止' },
    escalationFlag: true,
    idempotency: { subjectId: 'MON-15', operationClass: 'continuous-observation', requesterSequence: 'tick-1' },
  }
}

function closureInput(watchRecordId: string): Parameters<ObservationWriteFace['recordObservationClosure']>[0] {
  return {
    watchRecordId,
    basis: [{ sighting: '拍 #9 采集成功', terminalBasis: '最后可信游标 cursor:43' }],
    residualRisk: ['同型中断可能再现'],
    retriggerTerms: '同类中断再现＝新开观察并回查本记录',
    idempotency: { subjectId: watchRecordId, operationClass: 'observation-closure', requesterSequence: 'tick-9' },
  }
}

// —— 一、REC-OBS-02：生产观测事件落库 ——

describe('REC-OBS-02 监控故障写入（reportFault 数据面）', () => {
  it('落一条 records 行：字段映射/具名决定者/生效槽/幂等键齐全，读回可复算', () => {
    const db = freshDb()
    const face = faceOf(db)
    const receipt = face.reportFault(faultInput())
    expect(receipt).toMatchObject({ recordType: OBS_FAULT_RECORD_TYPE, appended: true, version: 1 })
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(1)

    const row = onlyRow(db, OBS_FAULT_RECORD_TYPE)
    expect(row['record_area']).toBe('OBS')
    expect(row['company']).toBe(COMPANY)
    expect(row['spec_version']).toBe('2.0.0')
    expect(JSON.parse(String(row['producer']))).toEqual({ decidedBy: 'OPS-1', writtenBy: 'daemon:engine/observe' })
    expect(row['effective_state']).toBe('effective')
    const payload = JSON.parse(String(row['payload'])) as Record<string, unknown>
    expect(payload).toMatchObject({
      failure_kind: 'collection_interrupted',
      occurred_at: iso(T0 - 5_000),
      discovered_at: iso(T0),
      affected_views: ['MON-15'],
      last_trusted: { cursor: 'cursor:42', at: iso(T0 - 5_000) },
      display_effect: 'unknown',
      recovery_at: null,
      root_cause_class: 'activity-stream-fetch',
    })
    const key = JSON.parse(String(row['idempotency_key'])) as string[]
    expect(key).toHaveLength(5)
    expect(key[0]).toBe(COMPANY)
    expect(key[1]).toBe(OBS_FAULT_RECORD_TYPE)
    expect(JSON.parse(String(row['schema_ref']))).toEqual({ schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' })
    expect(String(row['proof_boundary'])).toContain('不证明故障已恢复')
  })

  it('同内容重放＝返回既有（同幂等键零第二副作用）；异内容同键＝拒写且既有行不被改写', () => {
    const db = freshDb()
    const face = faceOf(db)
    const input = faultInput()
    const first = face.reportFault(input)
    const replay = face.reportFault({ ...input, idempotency: { ...input.idempotency } })
    expect(replay.appended).toBe(false)
    expect(replay.recordId).toBe(first.recordId)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(1)

    const changed = faultInput({ fault: { ...faultInput().fault, discoveredAt: iso(T0 + 1) } })
    expect(() => face.reportFault({ ...changed, idempotency: input.idempotency })).toThrow(ObsWriteError)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(1)
  })

  it('displayEffect=impaired 映射记录值 damaged（端口值集与记录值集口径差，不扩集）', () => {
    const db = freshDb()
    const face = faceOf(db)
    face.reportFault(faultInput({ fault: { ...faultInput().fault, displayEffect: 'impaired' } }))
    const payload = JSON.parse(String(onlyRow(db, OBS_FAULT_RECORD_TYPE)['payload'])) as Record<string, unknown>
    expect(payload['display_effect']).toBe('damaged')
  })

  it('动作限制：未给授权依据记录三元组＝拒写（0 行）；给了三元组＝原样落库', () => {
    const db = freshDb()
    const face = faceOf(db)
    const withRestriction = {
      ...faultInput().fault,
      actionRestriction: {
        basisRef: 'REC-DEC-01#1',
        namedSubject: { callerId: 'OPS-1', kind: 'position' as const },
        scope: ['MON-15', 'collect'] as [string, ...string[]],
        expiry: iso(T0 + HOUR),
        reviewPoint: iso(T0 + 2 * HOUR),
      },
    }
    expect(() => face.reportFault(faultInput({ fault: withRestriction }))).toThrow(/action-restriction-unmapped/)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)

    face.reportFault(
      faultInput({
        fault: withRestriction,
        actionRestrictionBasis: { refType: 'REC-DEC-01', refId: '01JDEC00000000000000001', refVersion: '1.0.0' },
      }),
    )
    const payload = JSON.parse(String(onlyRow(db, OBS_FAULT_RECORD_TYPE)['payload'])) as Record<string, unknown>
    expect(payload['action_restriction']).toMatchObject({
      decided_by: 'OPS-1',
      scope: 'MON-15,collect',
      authorization_basis: { refType: 'REC-DEC-01', refId: '01JDEC00000000000000001', refVersion: '1.0.0' },
    })
  })
})

// —— 二、fail-closed 负向面（缺证/越权/写失败） ——

describe('fail-closed：形状不符/缺证/越权/写口异常一律 0 行并显式报错', () => {
  it('受影响视图为空＝形状拒收（监控故障不得沉默——§十二）', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() => face.reportFault(faultInput({ fault: { ...faultInput().fault, affectedViews: [] as never } }))).toThrow(ObsWriteError)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)
  })

  it('缺最后可信点时刻（空串）＝拒写，不以当前时刻冒充（时间轴不靠猜）', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() => face.reportFault(faultInput({ lastTrustedAt: '' }))).toThrow(/shape-mismatch:lastTrustedAt/)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)
  })

  it('跨公司受影响视图＝越权拒写（多公司隔离 SEC-WD-01）', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() =>
      face.reportFault(
        faultInput({
          fault: {
            ...faultInput().fault,
            affectedViews: [{ viewName: 'MON-15', company: { companyId: 'other', slug: 'other' } }],
          },
        }),
      ),
    ).toThrow(/cross-company-fault/)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)
  })

  it('入库闸拒收（三不入）＝0 行并显式报错', () => {
    const db = freshDb()
    const face = faceOf(db, {
      guardRecord: () => {
        throw new Error('疑似秘密：apiKey')
      },
    })
    expect(() => face.reportFault(faultInput())).toThrow(/guard-rejected/)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)
  })

  it('写口异常（库已关闭）＝显式错误且标注副作用可能（须对账）', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const face = faceOf(db)
    db.close()
    try {
      face.reportFault(faultInput())
      expect.unreachable('写口异常必须抛出')
    } catch (error) {
      expect(error).toBeInstanceOf(ObsWriteError)
      expect((error as ObsWriteError).subcause).toBe('store/obs:write-failed')
      expect((error as ObsWriteError).sideEffectPossible).toBe(true)
    }
  })

  it('幂等键 operationClass 非 token＝拒写（§0.4-5 形状）', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() =>
      face.reportFault(faultInput({ idempotency: { subjectId: 'MON-15', operationClass: 'Monitoring Fault!', requesterSequence: 'tick-1' } })),
    ).toThrow(/shape-mismatch:idempotency.operationClass/)
    expect(countRows(db, OBS_FAULT_RECORD_TYPE)).toBe(0)
  })
})

// —— 三、REC-OBS-03/04 全链（观察义务→有据结束） ——

describe('REC-OBS-03/04：持续观察与观察结束（不是遗忘）', () => {
  it('开观察→打开中索引可见→结束→索引清空；records 两类各一条', () => {
    const db = freshDb()
    const face = faceOf(db)
    const watch = face.recordContinuousObservation(watchInput())
    expect(watch.recordType).toBe(OBS_WATCH_RECORD_TYPE)
    expect(face.openWatches().map((item) => item.recordId)).toEqual([watch.recordId])

    const closure = face.recordObservationClosure(closureInput(watch.recordId))
    expect(closure.recordType).toBe(OBS_CLOSURE_RECORD_TYPE)
    expect(face.openWatches()).toEqual([])
    expect(countRows(db, OBS_WATCH_RECORD_TYPE)).toBe(1)
    expect(countRows(db, OBS_CLOSURE_RECORD_TYPE)).toBe(1)
    const payload = JSON.parse(String(onlyRow(db, OBS_CLOSURE_RECORD_TYPE)['payload'])) as Record<string, unknown>
    expect(payload).toMatchObject({
      watch_ref: { refType: OBS_WATCH_RECORD_TYPE, refId: watch.recordId, refVersion: '1.0.0' },
      retrigger_terms: '同类中断再现＝新开观察并回查本记录',
    })
    expect((payload['residual_risk'] as string[]).length).toBeGreaterThan(0)
  })

  it('观察窗口倒置（declared_to < declared_from）＝不变量拒收，0 行', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() =>
      face.recordContinuousObservation({ ...watchInput(), window: { declaredFrom: iso(T0), declaredTo: iso(T0 - HOUR), lastTrustedAt: iso(T0) } }),
    ).toThrow(/shape-mismatch/)
    expect(countRows(db, OBS_WATCH_RECORD_TYPE)).toBe(0)
  })

  it('独立发现通道为空＝拒写（不得依赖执行体自报——§十二/§五）', () => {
    const db = freshDb()
    const face = faceOf(db)
    expect(() =>
      face.recordContinuousObservation({ ...watchInput(), sightings: { independentDiscoveryChannels: [] } }),
    ).toThrow(/shape-mismatch/)
    expect(countRows(db, OBS_WATCH_RECORD_TYPE)).toBe(0)
  })

  it('观察结束 basis/residualRisk 为空＝拒写（观察结束不是遗忘）', () => {
    const db = freshDb()
    const face = faceOf(db)
    const watch = face.recordContinuousObservation(watchInput())
    expect(() => face.recordObservationClosure({ ...closureInput(watch.recordId), basis: [] })).toThrow(/shape-mismatch/)
    expect(() => face.recordObservationClosure({ ...closureInput(watch.recordId), residualRisk: [] })).toThrow(/shape-mismatch/)
    expect(countRows(db, OBS_CLOSURE_RECORD_TYPE)).toBe(0)
    expect(face.openWatches()).toHaveLength(1)
  })

  it('再触发条件空白＝不变量拒写（观察结束不是遗忘——§十二）', () => {
    const db = freshDb()
    const face = faceOf(db)
    const watch = face.recordContinuousObservation(watchInput())
    expect(() => face.recordObservationClosure({ ...closureInput(watch.recordId), retriggerTerms: '   ' })).toThrow(/shape-mismatch/)
    expect(countRows(db, OBS_CLOSURE_RECORD_TYPE)).toBe(0)
    expect(face.openWatches()).toHaveLength(1)
  })
})

// —— 四、读回面（告警消费）与投影转发（生产消费） ——

describe('读回面：故障检索与只读投影转发', () => {
  it('readFaults 按视图过滤且新→旧；project 在无快照时如实 unknown（不补零/不补绿）', () => {
    const db = freshDb()
    const face = faceOf(db)
    face.reportFault(faultInput())
    face.reportFault(
      faultInput({
        fault: { ...faultInput().fault, affectedViews: [{ viewName: 'MON-10', company: { companyId: COMPANY, slug: COMPANY } }], failureKind: 'stale_view' },
        idempotency: { subjectId: 'MON-10:stale_view', operationClass: 'monitoring-fault', requesterSequence: 'tick-2' },
      }),
    )
    expect(face.readFaults({ viewName: 'MON-15' })).toHaveLength(1)
    expect(face.readFaults()).toHaveLength(2)
    expect(face.readFaults({ viewName: 'MON-10' })[0]?.recordId).toBeTypeOf('string')

    const projection = face.project({ viewName: 'MON-15', faces: ['collect'] })
    expect(projection.snapshotFound).toBe(false)
    expect(projection.states).toEqual([{ face: 'collect', state: 'unknown', lastTrustedCursor: null }])
    expect(projection.fault?.kind).toBe('coverage_gap')
  })

  it('REC-OBS-01 快照在场时 project 回显六态（只读投影仍可重建，写面不改它）', () => {
    const db = freshDb()
    const hist = createHistFace(db)
    insertSnapshot(db)
    const face = createObservationWriteFace({
      db,
      hist,
      company: COMPANY,
      decidedBy: 'OPS-1',
      makeId: () => ulid(T0, 9999),
      now: () => iso(T0),
    })
    const projection = face.project({ viewName: 'MON-15', faces: ['collect', 'projection'] })
    expect(projection.snapshotFound).toBe(true)
    expect(projection.states).toEqual([
      { face: 'collect', state: 'observed', lastTrustedCursor: 'cursor:collect' },
      { face: 'projection', state: 'derived', lastTrustedCursor: 'cursor:projection' },
    ])
    expect(projection.generatedAt).toBe(iso(T0))
  })
})

// —— 五、NEG-MON-03：监控不改事实（写面只落 records） ——

describe('NEG-MON-03：观察写面不改事实面', () => {
  it('导出面只有三写一读；写 REC-OBS-02/03/04 后 events/work_records 行数不变', () => {
    const db = freshDb()
    const face = faceOf(db)
    const tables = ['events', 'work_records', 'budgets']
    const before = tables.map((table) => Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: unknown }).c))
    face.reportFault(faultInput())
    const watch = face.recordContinuousObservation(watchInput())
    face.recordObservationClosure(closureInput(watch.recordId))
    const after = tables.map((table) => Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: unknown }).c))
    expect(after).toEqual(before)
    const exported = Object.keys(face).sort()
    for (const name of ALLOWED_WRITE_FACES) expect(exported).toContain(name)
    expect(exported).toEqual(
      ['openWatches', 'project', 'readFaults', 'recordContinuousObservation', 'recordObservationClosure', 'reportFault'].sort(),
    )
  })
})

// —— 夹具：REC-OBS-01 快照（测试侧直写；投影生产面不在本单领土） ——

const INSERT_SQL = [
  'INSERT INTO records',
  '  (record_id, record_type, record_area, schema_ref, spec_version, company, produced_at, producer, payload,',
  '   proof_boundary, effective_state, effective_time, revises, idempotency_key, created_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
].join('\n')

function insertSnapshot(db: DatabaseSync): void {
  const payload = {
    view_identity: { view_id: 'MON-15', projection_rule_version: 'view/v1' },
    authoritative_source: {
      endpoint: { refId: 'endpoint:mon15', refVersion: '1.0.0' },
      generation: 3,
      activation_ref: { refType: 'REC-AUTH-07', refId: '01JAUTH00000000000000001', refVersion: '1.0.0' },
    },
    source_cursor: 'cursor:snapshot:1',
    generated_at: iso(T0),
    data_valid_window: { from: iso(T0 - HOUR), to: iso(T0) },
    knowledge_scope: [COMPANY],
    view_completeness: 'complete',
    state_assignments: {
      collect: { state: 'observed', basis: '采集相位成功', last_trusted_cursor: 'cursor:collect' },
      projection: { state: 'derived', basis: '按规则复算', last_trusted_cursor: 'cursor:projection' },
    },
  }
  db.prepare(INSERT_SQL).run(
    ulid(T0, 7000),
    'REC-OBS-01',
    'OBS',
    JSON.stringify({ schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' }),
    '2.0.0',
    COMPANY,
    T0,
    JSON.stringify({ decidedBy: 'OPS-1', writtenBy: 'test:projection' }),
    JSON.stringify(payload),
    '测试夹具：只读投影面',
    'effective',
    T0,
    null,
    null,
    T0 + 1,
  )
}
