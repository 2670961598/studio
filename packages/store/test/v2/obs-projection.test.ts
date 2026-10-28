/**
 * test/v2/obs-projection —— MIG-04 / IMPL-04-08：REC-OBS-01 投影快照的只读投影
 *
 * 依据：plan/05 IMPL-04-08（投影只读断言＝NEG-MON-03 前腿；stale 字段为 MIG-08 出口预留）；v2/11 §十二
 * REC-OBS-01（只读投影不得反向改写历史/成为第二事实源或隐蔽写路径；多公司隔离）；v2/08 §4.1 六态与
 * 未知/陈旧/冲突/缺口口径、§4.2 视图元数据、§4.4 监控故障一等观察（不得留空/显示为零/沿用最后健康
 * 快照）；v2/17 NEG-MON-01（未知显示为 0/空/绿、全绿冒充健康、stale 出口）／NEG-MON-03（监控不改事实）；
 * v2/09 ENU-52/59/60 值集唯一主表（本套件从 contract 根出口取六态运行时集合，不自立值集）。
 *
 * 覆盖：① 六态逐面投影＋元数据回显；② 最新 produced_at 胜出、旧版本保留；③ 未知不折零/空/绿（缺面→
 * unknown、无快照→unknown＋coverage_gap、公司隔离）；④ 完整性非 complete 却全槽 observed→conflicted
 * （NEG-MON-01 前腿）；⑤ stale 显式出口（新鲜度超限降 stale＋staleExits；未超限/未声明不造 stale；自标
 * stale 原样承载）；⑥ 投影失败与歧义（形状不符→gapped 不回退旧快照；同刻多条→conflicted 不静默选边；
 * JSON 坏行不参与且不抛错）；⑦ 只读投影（NEG-MON-03 前腿：导出面无写族命名、返回值深冻结、写保护
 * 触发器武装下零写、未迁移库 CONFIG_INVALID）。
 *
 * 隔离：临时库＝`new DatabaseSync(':memory:')`＋migrate()（v14 records/v15 触发器已落）；不碰真实台账、
 * 不读环境、不依赖系统时钟（新鲜度时点由查询注入）。
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { migrate } from '../../src/migrations.ts'
import * as obs from '../../src/obs.ts'
import { T0, ulid } from './fixtures.ts'

const HOUR = 3_600_000
const MINUTE = 60_000
const iso = (ms: number): string => new Date(ms).toISOString()

const dbs: DatabaseSync[] = []

/** 每个 it 一条临时库（隔离；migrate 到 v15 后 records 表在库） */
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  dbs.push(db)
  return db
}

afterAll(() => {
  for (const db of dbs) db.close()
})

// —— 记录夹具（payload=REC-OBS-01 字段；envelope 维落 records 列） ——

interface PayloadOverrides {
  viewId?: string
  projectionRuleVersion?: string
  cursor?: string
  generatedAt?: string
  windowFrom?: string
  windowTo?: string
  completeness?: string
  knowledgeScope?: readonly string[]
  states?: Record<string, { state: string; basis?: string; cursor?: string }>
  stateLegend?: string
}

function snapshotPayload(over: PayloadOverrides = {}): Record<string, unknown> {
  const states = over.states ?? { 'MON-01': { state: 'observed' } }
  const stateAssignments: Record<string, unknown> = {}
  for (const [face, assignment] of Object.entries(states)) {
    stateAssignments[face] = {
      state: assignment.state,
      basis: assignment.basis ?? `依据：${face}`,
      last_trusted_cursor: assignment.cursor ?? `cursor:${face}`,
    }
  }
  return {
    view_identity: {
      view_id: over.viewId ?? 'overview',
      projection_rule_version: over.projectionRuleVersion ?? 'view/v1',
    },
    authoritative_source: {
      endpoint: { refId: 'endpoint:overview', refVersion: '1.0.0' },
      generation: 7,
      activation_ref: { refType: 'REC-AUTH-07', refId: '01JAUTH00000000000000001', refVersion: '1.0.0' },
    },
    source_cursor: over.cursor ?? 'cursor:snapshot:1',
    generated_at: over.generatedAt ?? iso(T0),
    data_valid_window: { from: over.windowFrom ?? iso(T0 - HOUR), to: over.windowTo ?? iso(T0) },
    knowledge_scope: over.knowledgeScope ?? ['games'],
    view_completeness: over.completeness ?? 'complete',
    state_assignments: stateAssignments,
    ...(over.stateLegend === undefined ? {} : { state_legend: over.stateLegend }),
  }
}

const INSERT_SQL = [
  'INSERT INTO records',
  '  (record_id, record_type, record_area, schema_ref, spec_version, company, produced_at, producer, payload,',
  '   proof_boundary, effective_state, effective_time, revises, idempotency_key, created_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
].join('\n')

let recordSeq = 0

interface InsertOptions {
  recordId?: string
  company?: string
  producedAt?: number
  payload?: Record<string, unknown>
  /** 原样落列的坏 JSON（json_valid 过滤面用） */
  payloadText?: string
  revises?: string
}

/** 写一条 REC-OBS-01（测试侧直写；记录写口 IMPL-04-06 未落，避免依赖在途单） */
function insertSnapshot(db: DatabaseSync, options: InsertOptions = {}): string {
  const producedAt = options.producedAt ?? T0
  const recordId = options.recordId ?? ulid(T0, 1000 + recordSeq++)
  const payloadText = options.payloadText ?? JSON.stringify(options.payload ?? snapshotPayload())
  db.prepare(INSERT_SQL).run(
    recordId,
    obs.OBS_PROJECTION_RECORD_TYPE,
    obs.OBS_PROJECTION_RECORD_AREA,
    'rec.obs-01',
    '2.1.0',
    options.company ?? 'games',
    producedAt,
    'projection:test',
    payloadText,
    null,
    null,
    null,
    options.revises ?? null,
    null,
    producedAt + 1,
  )
  return recordId
}

function facesOf(projection: obs.ObservationProjection): string[] {
  return projection.stateAssignments.map((entry) => entry.face)
}

function statesOf(projection: obs.ObservationProjection): string[] {
  return projection.stateAssignments.map((entry) => entry.state)
}

/** 投影调用小件（默认 games/overview；freshness 可选——避免逐用例重复查询字面量） */
function project(
  db: DatabaseSync,
  faces: readonly string[],
  options: { viewName?: string; freshness?: obs.ObservationFreshnessRequirement } = {},
): obs.ObservationProjection {
  const base = { company: 'games', viewName: options.viewName ?? 'overview', faces }
  return options.freshness === undefined
    ? obs.projectObservationSnapshot(db, base)
    : obs.projectObservationSnapshot(db, { ...base, freshness: options.freshness })
}

// —— 一、六态/窗口/游标/生成时刻（v2/08 §4.1；v2/11 §十二） ——

describe('REC-OBS-01 投影：六态与元数据', () => {
  it('六态逐面原样投影（按请求面序）、窗口/游标/生成时刻/规则版本/知悉范围/完整性回显', () => {
    const db = freshDb()
    const recordId = insertSnapshot(db, {
      payload: snapshotPayload({
        cursor: 'cursor:snap-42',
        generatedAt: iso(T0),
        windowFrom: iso(T0 - 2 * HOUR),
        windowTo: iso(T0),
        completeness: 'incomplete',
        knowledgeScope: ['games', 'studio-dev'],
        stateLegend: '六态说明（说明性，可降级）',
        states: {
          'MON-01': { state: 'observed' },
          'MON-02': { state: 'derived' },
          'MON-03': { state: 'unknown' },
          'MON-04': { state: 'stale' },
          'MON-05': { state: 'conflicted' },
          'MON-06': { state: 'gapped' },
        },
      }),
    })
    const faces = ['MON-06', 'MON-01', 'MON-02', 'MON-03', 'MON-04', 'MON-05']
    const projection = obs.projectObservationSnapshot(db, { company: 'games', viewName: 'overview', faces })

    expect(projection).toMatchObject({
      view: { viewName: 'overview', company: 'games' },
      snapshotFound: true,
      recordIds: [recordId],
      projectionRuleVersion: 'view/v1',
      authoritativeSource: {
        endpoint: { refId: 'endpoint:overview', refVersion: '1.0.0' },
        generation: 7,
        activation: { refType: 'REC-AUTH-07', refId: '01JAUTH00000000000000001', refVersion: '1.0.0' },
      },
      sourceCursor: 'cursor:snap-42',
      generatedAt: iso(T0),
      dataValidWindow: { from: iso(T0 - 2 * HOUR), to: iso(T0) },
      knowledgeScope: ['games', 'studio-dev'],
      viewCompleteness: 'incomplete',
      readOnly: true,
      mutatesFacts: false,
      fault: null, // 无新鲜度声明且非全绿声明：投影机制本身无故障
    })
    expect(projection.stateLegend).toContain('六态说明')

    expect(facesOf(projection)).toEqual(faces)
    expect(statesOf(projection)).toEqual(['gapped', 'observed', 'derived', 'unknown', 'stale', 'conflicted'])
    for (const entry of projection.stateAssignments) {
      expect(entry.basis).toBe(`依据：${entry.face}`) // 每条状态槽的依据原样承载（可复核）
      expect(entry.lastTrustedCursor).toBe(`cursor:${entry.face}`)
      // 无 value/unit/count 等读数槽：未知不得被折成 0（NEG-MON-01 的接口面承载）
      expect(Object.keys(entry)).toEqual(['face', 'state', 'basis', 'lastTrustedCursor'])
    }
    // 生产者在状态槽内自标的 stale：有显式出口；未声明新鲜度时判据字段为 null（不冒充已判）
    expect(projection.staleExits).toHaveLength(1)
    expect(projection.staleExits[0]).toMatchObject({
      face: 'MON-04',
      requiresNewerSnapshot: true,
      lastTrustedCursor: 'cursor:MON-04',
      generatedAt: iso(T0),
      generatedAgeMs: null,
      dataWindowEndAgeMs: null,
      freshnessDeadline: null,
      overdueMs: null,
    })
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.stateAssignments)).toBe(true)
    expect(Object.isFrozen(projection.stateAssignments[0])).toBe(true)
  })

  it('最新 produced_at 胜出；旧版本保留（版本链 revises；v2/11 §0.4-1）', () => {
    const db = freshDb()
    const older = insertSnapshot(db, {
      payload: snapshotPayload({ cursor: 'cursor:old', generatedAt: iso(T0), windowTo: iso(T0) }),
    })
    const newer = insertSnapshot(db, {
      producedAt: T0 + 1_000,
      revises: older,
      payload: snapshotPayload({
        cursor: 'cursor:new',
        generatedAt: iso(T0 + 1_000),
        windowTo: iso(T0 + 1_000),
      }),
    })
    const projection = project(db, ['MON-01'])
    expect(projection.sourceCursor).toBe('cursor:new')
    expect(projection.generatedAt).toBe(iso(T0 + 1_000))
    expect(projection.dataValidWindow?.to).toBe(iso(T0 + 1_000))
    expect(projection.recordIds).toEqual([newer])
    expect(statesOf(projection)).toEqual(['observed'])
    // 旧版本未被覆盖/删除
    const rows = db.prepare('SELECT record_id, payload FROM records ORDER BY produced_at').all() as unknown as Array<
      Record<string, unknown>
    >
    expect(rows).toHaveLength(2)
    expect(String(rows[0]?.['payload'])).toContain('cursor:old')
  })

  it('请求面在快照中缺槽 → unknown（材料不足），lastTrustedCursor 为 null 非空串', () => {
    const db = freshDb()
    insertSnapshot(db, { payload: snapshotPayload({ states: { 'MON-01': { state: 'observed' } } }) })
    const projection = project(db, ['MON-01', 'MON-02'])
    expect(statesOf(projection)).toEqual(['observed', 'unknown'])
    const missing = projection.stateAssignments[1]!
    expect(missing.face).toBe('MON-02')
    expect(missing.basis).toContain('材料不足')
    expect(missing.basis).not.toBe('')
    expect(missing.lastTrustedCursor).toBeNull()
  })
})

// —— 二、未知不折零/空/绿（NEG-MON-01 前腿）＋公司隔离 ——

describe('未知不补 0/空/绿（NEG-MON-01 前腿）', () => {
  it('无快照：全请求面 unknown、元数据显式 null（非 0/空串）、coverage_gap；他公司同视图不泄漏', () => {
    const db = freshDb()
    insertSnapshot(db, {
      company: 'other-co',
      payload: snapshotPayload({ cursor: 'cursor:other-co', knowledgeScope: ['other-co'] }),
    })
    const projection = project(db, ['MON-01', 'MON-02'])
    expect(projection.snapshotFound).toBe(false)
    expect(projection.recordIds).toEqual([])
    expect(projection.sourceCursor).toBeNull()
    expect(projection.generatedAt).toBeNull()
    expect(projection.dataValidWindow).toBeNull()
    expect(projection.knowledgeScope).toBeNull()
    expect(projection.viewCompleteness).toBeNull()
    expect(statesOf(projection)).toEqual(['unknown', 'unknown'])
    for (const entry of projection.stateAssignments) {
      expect(entry.lastTrustedCursor).toBeNull()
      expect(entry.basis).toContain('材料不足')
      expect(Object.keys(entry)).toEqual(['face', 'state', 'basis', 'lastTrustedCursor'])
    }
    expect(projection.fault?.kind).toBe('coverage_gap')
    expect(projection.fault?.detail).toContain('无 REC-OBS-01 投影快照')
    // 不折零/空/绿：序列化面不得出现 value/unit/healthy 等伪造读数或健康标记
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('"value"')
    expect(serialized).not.toContain('"unit"')
    expect(serialized).not.toContain('"healthy"')
    // 隔离的另一半：他公司查询取到他公司快照
    const other = obs.projectObservationSnapshot(db, {
      company: 'other-co',
      viewName: 'overview',
      faces: ['MON-01'],
    })
    expect(other.snapshotFound).toBe(true)
    expect(other.sourceCursor).toBe('cursor:other-co')
    expect(other.knowledgeScope).toEqual(['other-co'])
  })

  it('完整性非 complete 却全槽 observed → 逐面 conflicted（不得全绿冒充健康）', () => {
    const db = freshDb()
    insertSnapshot(db, {
      payload: snapshotPayload({
        completeness: 'incomplete',
        states: { 'MON-01': { state: 'observed' }, 'MON-02': { state: 'observed' } },
      }),
    })
    insertSnapshot(db, {
      payload: snapshotPayload({
        viewId: 'overview-ok',
        completeness: 'complete',
        states: { 'MON-01': { state: 'observed' }, 'MON-02': { state: 'observed' } },
      }),
    })
    const claim = project(db, ['MON-01', 'MON-02'])
    expect(statesOf(claim)).toEqual(['conflicted', 'conflicted'])
    expect(claim.stateAssignments[0]?.basis).toContain('全绿')
    expect(claim.fault?.kind).toBe('conflict_unresolved')
    expect(claim.fault?.detail).toContain('全绿')
    expect(claim.viewCompleteness).toBe('incomplete')
    // 对照：同样状态在 completeness=complete 下不得被误伤
    const complete = project(db, ['MON-01', 'MON-02'], { viewName: 'overview-ok' })
    expect(statesOf(complete)).toEqual(['observed', 'observed'])
    expect(complete.fault).toBeNull()
  })

  it('空 faces/坏参数 → CONFIG_INVALID 拒（空集可能被读成「无异常」；fail-closed）', () => {
    const db = freshDb()
    const base = { company: 'games', viewName: 'overview', faces: ['MON-01'] }
    expect(() => obs.projectObservationSnapshot(db, { ...base, faces: [] })).toThrow(
      /CONFIG_INVALID\/store\/obs:empty-faces/,
    )
    expect(() => obs.projectObservationSnapshot(db, { ...base, company: '' })).toThrow(
      /CONFIG_INVALID\/store\/obs:bad-query/,
    )
    expect(() => obs.projectObservationSnapshot(db, { ...base, faces: [''] })).toThrow(
      /CONFIG_INVALID\/store\/obs:bad-query/,
    )
    expect(() =>
      obs.projectObservationSnapshot(db, { ...base, freshness: { now: 'not-a-time', maxAgeMs: 1 } }),
    ).toThrow(/CONFIG_INVALID\/store\/obs:bad-freshness/)
    expect(() =>
      obs.projectObservationSnapshot(db, { ...base, freshness: { now: iso(T0), maxAgeMs: -1 } }),
    ).toThrow(/CONFIG_INVALID\/store\/obs:bad-freshness/)
    // 未迁移库（无 records 表）→ CONFIG_INVALID no-table（不以「无数据」冒充未知）
    const bare = new DatabaseSync(':memory:')
    try {
      expect(() => obs.projectObservationSnapshot(bare, base)).toThrow(/CONFIG_INVALID\/store\/obs:no-table/)
    } finally {
      bare.close()
    }
  })
})

// —— 三、stale 显式出口（MIG-08 出口预留） ——

describe('stale 有显式出口（MIG-08 出口预留）', () => {
  const fiveStates = {
    'MON-01': { state: 'observed' },
    'MON-02': { state: 'derived' },
    'MON-03': { state: 'unknown' },
    'MON-04': { state: 'conflicted' },
    'MON-05': { state: 'gapped' },
  }

  it('超新鲜度：observed/derived 降 stale＋staleExits（截止/超期/最后可信游标）；其余四态不被改写', () => {
    const db = freshDb()
    insertSnapshot(db, {
      payload: snapshotPayload({ generatedAt: iso(T0), windowTo: iso(T0), states: fiveStates }),
    })
    const projection = project(db, ['MON-01', 'MON-02', 'MON-03', 'MON-04', 'MON-05'], { freshness: { now: iso(T0 + 10 * MINUTE), maxAgeMs: 5 * MINUTE } })
    expect(statesOf(projection)).toEqual(['stale', 'stale', 'unknown', 'conflicted', 'gapped'])
    expect(projection.staleExits).toHaveLength(2)
    expect(projection.staleExits.map((exit) => exit.face)).toEqual(['MON-01', 'MON-02'])
    expect(projection.staleExits[0]).toEqual({
      face: 'MON-01',
      requiresNewerSnapshot: true,
      lastTrustedCursor: 'cursor:MON-01',
      generatedAt: iso(T0),
      generatedAgeMs: 10 * MINUTE,
      dataWindowEndAgeMs: 10 * MINUTE,
      freshnessDeadline: iso(T0 + 5 * MINUTE),
      overdueMs: 5 * MINUTE,
    })
    // 原依据保留并附陈旧判据（可复核）；非健康态不被 stale 「升级」覆盖
    expect(projection.stateAssignments[0]?.basis).toContain('依据：MON-01')
    expect(projection.stateAssignments[0]?.basis).toContain('超新鲜度要求')
    expect(projection.stateAssignments[2]?.basis).toBe('依据：MON-03')
    expect(projection.stateAssignments[3]?.basis).toBe('依据：MON-04')
    expect(projection.stateAssignments[4]?.basis).toBe('依据：MON-05')
    expect(projection.fault?.kind).toBe('stale_view')
    expect(projection.fault?.detail).toContain('2 个面')
  })

  it('未超新鲜度/未声明不造 stale；生产者自标 stale 原样承载（判据归生产者）', () => {
    const db = freshDb()
    insertSnapshot(db, {
      payload: snapshotPayload({ generatedAt: iso(T0), windowTo: iso(T0), states: fiveStates }),
    })
    // 生产者在状态槽内自标的 stale（独立视图；未判新鲜度）
    insertSnapshot(db, {
      payload: snapshotPayload({
        viewId: 'overview-stale',
        generatedAt: iso(T0),
        windowTo: iso(T0),
        states: { 'MON-04': { state: 'stale', basis: '生产者判据：上游 30 分钟未刷新' } },
      }),
    })
    const fresh = project(db, ['MON-01', 'MON-02', 'MON-03', 'MON-04', 'MON-05'], { freshness: { now: iso(T0 + MINUTE), maxAgeMs: 5 * MINUTE } })
    expect(statesOf(fresh)).toEqual(['observed', 'derived', 'unknown', 'conflicted', 'gapped'])
    expect(fresh.staleExits).toEqual([])
    expect(fresh.fault).toBeNull()
    const undeclared = project(db, ['MON-01', 'MON-02'])
    expect(statesOf(undeclared)).toEqual(['observed', 'derived'])
    expect(undeclared.staleExits).toEqual([])
    expect(undeclared.fault).toBeNull()

    const recorded = project(db, ['MON-04'], { viewName: 'overview-stale', freshness: { now: iso(T0 + MINUTE), maxAgeMs: 5 * MINUTE } })
    expect(statesOf(recorded)).toEqual(['stale'])
    expect(recorded.stateAssignments[0]?.basis).toBe('生产者判据：上游 30 分钟未刷新')
    expect(recorded.staleExits[0]).toMatchObject({
      face: 'MON-04',
      requiresNewerSnapshot: true,
      lastTrustedCursor: 'cursor:MON-04',
      generatedAt: iso(T0),
      freshnessDeadline: null,
      overdueMs: null,
    })
  })
})

// —— 四、投影失败/歧义（不静默选边、不沿用最后健康快照） ——

describe('投影失败与歧义', () => {
  it('最新快照形状不符 → 整段 gapped（projection_failed），不回退旧快照（§4.4）', () => {
    const db = freshDb()
    insertSnapshot(db, {
      payload: snapshotPayload({ cursor: 'cursor:old', generatedAt: iso(T0), windowTo: iso(T0) }),
    })
    const broken = insertSnapshot(db, {
      producedAt: T0 + 1_000,
      payload: { view_identity: { view_id: 'overview' } }, // 缺 source_cursor/state_assignments 等
    })
    const projection = project(db, ['MON-01', 'MON-02'])
    expect(projection.snapshotFound).toBe(true)
    expect(projection.recordIds).toEqual([broken])
    expect(statesOf(projection)).toEqual(['gapped', 'gapped'])
    expect(projection.stateAssignments[0]?.basis).toContain('形状不符')
    expect(projection.sourceCursor).toBeNull() // 不得回退旧快照的游标冒充最新
    expect(projection.generatedAt).toBeNull()
    expect(projection.projectionRuleVersion).toBeNull()
    expect(projection.fault?.kind).toBe('projection_failed')
    expect(projection.fault?.detail).toContain('不回退旧快照')
    expect(JSON.stringify(projection)).not.toContain('cursor:old')
  })

  it('同刻多条最新快照 → 整段 conflicted（版本链歧义，不得静默选边）', () => {
    const db = freshDb()
    const first = insertSnapshot(db, {
      producedAt: T0,
      payload: snapshotPayload({ cursor: 'cursor:a' }),
    })
    const second = insertSnapshot(db, {
      producedAt: T0,
      payload: snapshotPayload({ cursor: 'cursor:b' }),
    })
    const projection = project(db, ['MON-01', 'MON-02'])
    expect(statesOf(projection)).toEqual(['conflicted', 'conflicted'])
    expect(projection.snapshotFound).toBe(true)
    expect([...projection.recordIds].sort()).toEqual([first, second].sort())
    expect(projection.sourceCursor).toBeNull()
    expect(projection.generatedAt).toBeNull()
    expect(projection.fault?.kind).toBe('conflict_unresolved')
    expect(projection.fault?.detail).toContain('不得静默选边')
    // 两条原始记录都保留（可复核，不替人删）
    const count = db.prepare('SELECT COUNT(*) AS c FROM records').get() as { c: number }
    expect(Number(count.c)).toBe(2)
  })

  it('JSON 坏行无法归因视图：不参与投影且不抛错（该视图按未知处理，不猜内容）', () => {
    const db = freshDb()
    insertSnapshot(db, { payloadText: '{"view_identity":' })
    const projection = project(db, ['MON-01'])
    expect(statesOf(projection)).toEqual(['unknown'])
    expect(projection.snapshotFound).toBe(false)
    expect(projection.fault?.kind).toBe('coverage_gap')
  })
})

// —— 五、只读投影（NEG-MON-03 前腿：监控不改事实） ——

describe('只读投影（NEG-MON-03 前腿：监控不改事实）', () => {
  it('导出面只有投影函数：无写族命名、无 append/write 槽', () => {
    const functions = Object.entries(obs)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
    expect(functions).toEqual(['projectObservationSnapshot'])
    expect(functions.filter((name) => /write|append|insert|update|delete|mutate|record|save|set|report/i.test(name))).toEqual(
      [],
    )
    const surface = obs as unknown as Record<string, unknown>
    expect(surface['appendRecord']).toBeUndefined()
    expect(surface['writeSnapshot']).toBeUndefined()
    expect(obs.OBS_PROJECTION_RECORD_TYPE).toBe('REC-OBS-01')
    expect(obs.OBS_PROJECTION_RECORD_AREA).toBe('OBS')
  })

  it('返回值深冻结：改属性/改数组均抛 TypeError（投影不是写路径）', () => {
    const db = freshDb()
    insertSnapshot(db, { payload: snapshotPayload() })
    const projection = project(db, ['MON-01'])
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.view)).toBe(true)
    expect(Object.isFrozen(projection.authoritativeSource)).toBe(true)
    expect(Object.isFrozen(projection.authoritativeSource?.endpoint)).toBe(true)
    expect(Object.isFrozen(projection.dataValidWindow)).toBe(true)
    expect(Object.isFrozen(projection.stateAssignments)).toBe(true)
    expect(Object.isFrozen(projection.stateAssignments[0])).toBe(true)

    const mutable = projection as unknown as { sourceCursor: string | null }
    expect(() => {
      mutable.sourceCursor = 'tampered'
    }).toThrow(TypeError)
    expect(projection.sourceCursor).toBe('cursor:snapshot:1')
    const entries = projection.stateAssignments as unknown as unknown[]
    expect(() => {
      entries.push({})
    }).toThrow(TypeError)
    expect(projection.stateAssignments).toHaveLength(1)
  })

  it('投影期间 records 被写保护触发器武装：零写、行集与 payload 字节不变', () => {
    const db = freshDb()
    insertSnapshot(db, { payload: snapshotPayload({ cursor: 'cursor:guarded' }) })
    const rowsBefore = db
      .prepare('SELECT record_id, payload FROM records ORDER BY record_id')
      .all()
      .map((row) => JSON.stringify(row))
    db.exec(
      "CREATE TRIGGER obs_guard_insert BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, 'records write during projection'); END",
    )
    db.exec(
      "CREATE TRIGGER obs_guard_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'records write during projection'); END",
    )
    db.exec(
      "CREATE TRIGGER obs_guard_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'records write during projection'); END",
    )
    try {
      const projection = project(db, ['MON-01'])
      // 触发器武装下仍能投影＝投影路径没有 INSERT/UPDATE/DELETE
      expect(projection.sourceCursor).toBe('cursor:guarded')
      expect(projection.readOnly).toBe(true)
      expect(projection.mutatesFacts).toBe(false)
      const rowsAfter = db
        .prepare('SELECT record_id, payload FROM records ORDER BY record_id')
        .all()
        .map((row) => JSON.stringify(row))
      expect(rowsAfter).toEqual(rowsBefore)
    } finally {
      db.exec('DROP TRIGGER obs_guard_insert')
      db.exec('DROP TRIGGER obs_guard_update')
      db.exec('DROP TRIGGER obs_guard_delete')
    }
  })
})
