/**
 * test/v2/hist-append —— MIG-04 / IMPL-04-06：PORT-HIST 写面（append/correct/显式 tx）＋形状闸
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-06（append 显式 tx 句柄测试；records.ts 校验源=contract；临时库 migrate 到 v15）
 *   - docs/v2/14 §1.6（append/get/correct＋显式 tx 句柄；多记录同域原子治 L3J-P1-01）
 *   - docs/v2/11 §〇（信封）/§0.4（身份一经分配不复用；同 id 内容一致=返回既有、不一致=拒；同幂等键同理）
 *     /§0.5（时间分层：pending/effective 必填起点；payload 不得出现区间终点）/§一（74 类登记）
 *   - docs/v2/05 §三 DOM-05：records＝记录投影，**非第四事实源**——修正只追加不覆盖原行
 *   - docs/v2/17 NEG-REC-05（DOM-05 负向面）：本文件只证**形状闸腿**（非法 payload/未登记类型/
 *     v14 缺列字段＝拒写）；EVD X2/X3/X4 语义判负归 PORT-EVD
 *
 * 隔离：临时目录真文件库（hist-fixtures 夹具；migrate 到 v15）；读/查询面见 hist-query.test.ts。
 */
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHistFace } from '../../src/hist.ts'
import { LATEST_VERSION, currentVersion } from '../../src/migrations.ts'
import {
  CLOCK,
  T0,
  corPayload,
  countRecords,
  decPayload,
  envelope,
  evtPayload,
  idemKey,
  iso,
  openHistHarness,
  recordRow,
  ulid,
  type HistHarness,
} from './hist-fixtures.ts'

let h: HistHarness

beforeAll(async () => {
  h = await openHistHarness()
})

afterAll(async () => {
  await h.close()
})

// —— 迁移与面构造 ——

describe('迁移到 v15 与面构造', () => {
  it('临时库 migrate 到 v15（v14 records 表在库）', () => {
    expect(LATEST_VERSION).toBe(15)
    expect(currentVersion(h.db)).toBe(15)
    expect(h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'records'").get()).toBeTruthy()
  })

  it('未迁移库上建面仍可构造（写面在语句层暴露 schema 缺失，不伪装成功）', () => {
    const bare = new DatabaseSync(':memory:')
    try {
      const broken = createHistFace(bare, { now: () => CLOCK })
      expect(() => broken.append(envelope('REC-EVT-01', evtPayload()))).toThrow(/no such table: records/)
    } finally {
      bare.close()
    }
  })
})

// —— append → get 往返（v14 列编码承诺）——

describe('append→get 往返（信封维无损；缺列字段拒收）', () => {
  const company = 'hist-roundtrip'
  const roundId = ulid(T0 + 1_000, 11)

  it('合法记录落 records 并全列回读（payload/信封/生效槽/schemaRef/幂等键）', () => {
    const record = envelope('REC-EVT-01', evtPayload(), {
      recordId: roundId,
      companyRef: company,
      producedAt: iso(T0 + 3_000),
      effectiveTime: { from: iso(T0 + 3_000) },
      proofBoundary: '本记录证明观察到该次采集；不证明采集完整',
      idempotencyKey: idemKey({ companyRef: company, requesterSequence: 'roundtrip-1' }),
      schemaRef: { schemaId: 'rec.evt-01', schemaVersion: '1.0.0' },
    })
    expect(h.hist.append(record)).toEqual({ recordId: roundId, recordType: 'REC-EVT-01', appended: true })

    const got = h.hist.get(roundId)
    expect(got?.recordId).toBe(roundId)
    expect(got?.recordType).toBe('REC-EVT-01')
    expect(got?.companyRef).toBe(company)
    expect(got?.specVersion).toBe('2.1.0')
    expect(got?.schemaRef).toEqual({ schemaId: 'rec.evt-01', schemaVersion: '1.0.0' })
    expect(got?.producer).toEqual({ decidedBy: 'ENG-1', writtenBy: 'daemon' })
    expect(got?.payload).toEqual(evtPayload())
    expect(got?.effectiveState).toBe('effective')
    expect(got?.effectiveTime).toEqual({ from: iso(T0 + 3_000) })
    expect(got?.producedAt).toBe(iso(T0 + 3_000))
    expect(got?.proofBoundary).toContain('不证明采集完整')
    expect(got?.idempotencyKey).toEqual(idemKey({ companyRef: company, requesterSequence: 'roundtrip-1' }))
    // v14 无 basis_refs 列：写面拒非空，回读恒 []（不伪造依据）
    expect(got?.basisRefs).toEqual([])
  })

  it('列编码：record_area 派生＝AUTH、schema_ref/producer/idempotency_key=JSON、created_at=注入时钟', () => {
    const row = recordRow(h.db, roundId)
    expect(row['record_type']).toBe('REC-EVT-01')
    expect(row['record_area']).toBe('AUTH')
    expect(JSON.parse(String(row['schema_ref']))).toEqual({ schemaId: 'rec.evt-01', schemaVersion: '1.0.0' })
    expect(JSON.parse(String(row['producer']))).toEqual({ decidedBy: 'ENG-1', writtenBy: 'daemon' })
    expect(JSON.parse(String(row['idempotency_key']))).toEqual([company, 'REC-EVT-01', 'STUDIO-1', 'append', 'roundtrip-1'])
    expect(row['produced_at']).toBe(T0 + 3_000)
    expect(row['effective_time']).toBe(T0 + 3_000)
    expect(row['created_at']).toBe(CLOCK)
  })

  it('同 id 同内容重复 append＝幂等返回既有（appended:false，不产生第二行）', () => {
    const record = envelope('REC-EVT-01', evtPayload(), {
      recordId: roundId,
      companyRef: company,
      producedAt: iso(T0 + 3_000),
      effectiveTime: { from: iso(T0 + 3_000) },
      proofBoundary: '本记录证明观察到该次采集；不证明采集完整',
      idempotencyKey: idemKey({ companyRef: company, requesterSequence: 'roundtrip-1' }),
      schemaRef: { schemaId: 'rec.evt-01', schemaVersion: '1.0.0' },
    })
    expect(h.hist.append(record)).toEqual({ recordId: roundId, recordType: 'REC-EVT-01', appended: false })
    expect(countRecords(h.db, company)).toBe(1)
  })

  it('get 权威确认不存在＝undefined（不拿空对象冒充）', () => {
    expect(h.hist.get(ulid(T0, 999))).toBeUndefined()
  })
})

// —— 负向：形状闸与 v14 列集可落性（NEG-REC 形状腿）——

describe('负向：非法 payload / 未登记类型 / 缺口字段＝拒写且零落库', () => {
  const company = 'hist-neg'

  it('非法 payload（REC-EVT-01 缺 event_completeness）→ CONFIG_INVALID，零落库', () => {
    const bad = envelope('REC-EVT-01', evtPayload({ event_completeness: undefined }), { companyRef: company, recordId: ulid(T0, 21) })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/record:invalid:payload\.event_completeness/)
    expect(countRecords(h.db, company)).toBe(0)
  })

  it('非法枚举值（event_completeness=maybe）→ 拒', () => {
    const bad = envelope('REC-EVT-01', evtPayload({ event_completeness: 'maybe' }), { companyRef: company, recordId: ulid(T0, 22) })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/record:invalid:payload\.event_completeness/)
  })

  it('未登记 recordType（REC-XYZ-99 悬空引用）→ 拒', () => {
    const bad = envelope('REC-XYZ-99', {}, { companyRef: company, recordId: ulid(T0, 23) })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/record:invalid:recordType/)
    expect(countRecords(h.db, company)).toBe(0)
  })

  it('pending 缺 effectiveTime（§0.5 时间分层）→ 拒', () => {
    const bad = envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: ulid(T0, 24), effectiveState: 'pending', effectiveTime: null })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/record:invalid:effectiveTime/)
  })

  it('payload 生效状态与信封不一致（REC-DEC-01）→ 生效槽一致性拒', () => {
    const bad = envelope('REC-DEC-01', decPayload({ effective_state: 'pending', effective_time: null }), {
      companyRef: company,
      recordId: ulid(T0, 25),
    })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/record:invalid:payload\.effective_state/)
  })

  it('basisRefs 非空（v14 无落列）→ 拒收而非静默丢依据', () => {
    const bad = envelope('REC-EVT-01', evtPayload(), {
      companyRef: company,
      recordId: ulid(T0, 26),
      basisRefs: [{ refId: ulid(T0, 1), refVersion: '1.0.0' }],
    })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/hist:basis-refs-unlanded/)
  })

  it('effectiveTime.until（v14 无落列，§0.5 唯一存放点）→ 拒收而非丢终点', () => {
    const bad = envelope('REC-EVT-01', evtPayload(), {
      companyRef: company,
      recordId: ulid(T0, 27),
      producedAt: iso(T0 + 1_000),
      effectiveTime: { from: iso(T0 + 1_000), until: iso(T0 + 2_000) },
    })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/hist:until-unlanded/)
  })

  it('幂等键 scope 与信封不一致（§0.4-5 第①②元）→ 拒', () => {
    const bad = envelope('REC-EVT-01', evtPayload(), {
      companyRef: company,
      recordId: ulid(T0, 28),
      idempotencyKey: idemKey({ companyRef: 'other-company' }),
    })
    expect(() => h.hist.append(bad)).toThrow(/CONFIG_INVALID\/store\/hist:idempotency-scope-mismatch/)
    expect(countRecords(h.db, company)).toBe(0)
  })
})

// —— 重复：同 id / 同幂等键（返回既有或拒，按 §0.4-4/§0.4-5）——

describe('重复：同 id / 同幂等键（内容一致=返回既有；异内容=拒）', () => {
  const company = 'hist-idem'
  const idA = ulid(T0, 31)

  it('同幂等键 + 内容一致但不同 recordId → 返回既有 id（重放不产生第二行）', () => {
    const key = idemKey({ companyRef: company, requesterSequence: 'idem-1' })
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: idA, producedAt: iso(T0 + 500), idempotencyKey: key }))
    // 重复提交可带新 recordId 与新「系统获知时刻」：语义内容一致即返既有（§0.4-4 不产生第二次副作用）
    const replay = h.hist.append(
      envelope('REC-EVT-01', evtPayload(), {
        companyRef: company,
        recordId: ulid(T0, 32),
        producedAt: iso(T0 + 900),
        effectiveTime: { from: iso(T0 + 500) },
        idempotencyKey: key,
      }),
    )
    expect(replay).toEqual({ recordId: idA, recordType: 'REC-EVT-01', appended: false })
    expect(countRecords(h.db, company)).toBe(1)
  })

  it('同幂等键 + 内容不一致 → 拒（同键异内容不覆盖）', () => {
    const key = idemKey({ companyRef: company, requesterSequence: 'idem-1' })
    const clash = envelope('REC-EVT-01', evtPayload({ cursor: 'cursor-2' }), { companyRef: company, recordId: ulid(T0, 33), producedAt: iso(T0 + 500), idempotencyKey: key })
    expect(() => h.hist.append(clash)).toThrow(/CONFIG_INVALID\/store\/hist:duplicate-idempotency-key/)
    expect(countRecords(h.db, company)).toBe(1)
  })

  it('同 id + 内容不一致 → 拒（身份一经分配不复用）', () => {
    const clash = envelope('REC-EVT-01', evtPayload({ cursor: 'cursor-3' }), { companyRef: company, recordId: idA, producedAt: iso(T0 + 500) })
    expect(() => h.hist.append(clash)).toThrow(/CONFIG_INVALID\/store\/hist:duplicate-id/)
    expect(countRecords(h.db, company)).toBe(1)
  })

  it('幂等作用域含公司维：换公司（键随换）可各自落一行', () => {
    const other = 'hist-idem-other'
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: other, recordId: ulid(T0, 34), idempotencyKey: idemKey({ companyRef: other, requesterSequence: 'idem-1' }) }))
    expect(countRecords(h.db, company)).toBe(1)
    expect(countRecords(h.db, other)).toBe(1)
  })
})

// —— 显式 tx 句柄（GAP-V2-09：多记录同域原子）——

describe('显式 tx 句柄（begin/commit/abort；句柄校验）', () => {
  const company = 'hist-tx'

  it('abort：事务内记录回滚（零落库）', () => {
    const id = ulid(T0, 41)
    const tx = h.hist.begin()
    expect(tx.open).toBe(true)
    const ref = h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id }), tx)
    expect(ref.appended).toBe(true)
    expect(h.hist.get(id)).toBeDefined() // 同连接内可见（未提交）
    const receipt = h.hist.abort(tx)
    expect(receipt).toEqual({ txId: tx.txId, committed: false, recordRefs: [] })
    expect(h.hist.get(id)).toBeUndefined()
    expect(countRecords(h.db, company)).toBe(0)
  })

  it('commit：多记录同事务原子落地，回执携本事务引用', () => {
    const id1 = ulid(T0, 42)
    const id2 = ulid(T0, 43)
    const tx = h.hist.begin()
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id1 }), tx)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id2 }), tx)
    const receipt = h.hist.commit(tx)
    expect(receipt.committed).toBe(true)
    expect(receipt.recordRefs.map((r) => r.recordId)).toEqual([id1, id2])
    expect(tx.open).toBe(false)
    expect(h.hist.get(id1)).toBeDefined()
    expect(h.hist.get(id2)).toBeDefined()
  })

  it('已关闭/外来句柄再写＝拒（显式句柄不得跨面/跨生命周期复用）', () => {
    const tx = h.hist.begin()
    h.hist.abort(tx)
    expect(() => h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: ulid(T0, 44) }), tx)).toThrow(
      /CONFIG_INVALID\/store\/hist:tx-closed/,
    )
    const other = createHistFace(h.db, { now: () => CLOCK })
    const foreign = other.begin()
    try {
      expect(() => h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: ulid(T0, 45) }), foreign)).toThrow(
        /CONFIG_INVALID\/store\/hist:tx-foreign/,
      )
    } finally {
      other.abort(foreign)
    }
  })

  it('嵌套 begin＝拒（单层事务；连接已在事务中）', () => {
    const tx = h.hist.begin()
    try {
      expect(() => h.hist.begin()).toThrow(/CONFIG_INVALID\/store\/hist:tx-nested/)
    } finally {
      h.hist.abort(tx)
    }
  })

  it('tx 内 correct 可随事务回滚（原行不受影响）', () => {
    const id = ulid(T0, 46)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id }))
    const tx = h.hist.begin()
    h.hist.correct(
      {
        targetRecordId: id,
        record: envelope('REC-COR-01', corPayload(id), { companyRef: company, recordId: ulid(T0, 47), producedAt: iso(T0 + 2_000) }),
      },
      tx,
    )
    h.hist.abort(tx)
    expect(h.hist.get(id)).toBeDefined()
    expect(countRecords(h.db, company, " AND record_type = 'REC-COR-01'")).toBe(0)
  })
})

// —— correct：追加不覆盖 ——

describe('correct（REC-COR-01 追加；原行一字不动）', () => {
  const company = 'hist-correct'
  const original = ulid(T0, 51)

  it('修正＝新记录行，原行全列不变，corrects 指向原记录', () => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: original, producedAt: iso(T0 + 1_000) }))
    const before = recordRow(h.db, original)
    const corId = ulid(T0, 52)
    const result = h.hist.correct({
      targetRecordId: original,
      record: envelope('REC-COR-01', corPayload(original), {
        companyRef: company,
        recordId: corId,
        producedAt: iso(T0 + 2_000),
        proofBoundary: '本记录证明追加了修正；不证明原结论已被撤销',
      }),
    })
    expect(result).toEqual({ recordId: corId, recordType: 'REC-COR-01', appended: true })
    // 原行不覆盖（含 created_at 在内的全列逐字节不变）
    expect(recordRow(h.db, original)).toEqual(before)
    // 修正行独立存在、payload 指向原记录
    const cor = h.hist.get(corId)
    expect(cor?.recordType).toBe('REC-COR-01')
    const payload = cor?.payload as { corrects: Array<{ refId: string }>; original_preserved: boolean }
    expect(payload.corrects[0]?.refId).toBe(original)
    expect(payload.original_preserved).toBe(true)
    expect(countRecords(h.db, company)).toBe(2)
  })

  it('修正目标不存在 → 拒（不为不存在的行补造历史）', () => {
    const missing = ulid(T0, 53)
    expect(() =>
      h.hist.correct({ targetRecordId: missing, record: envelope('REC-COR-01', corPayload(missing), { companyRef: company, recordId: ulid(T0, 54) }) }),
    ).toThrow(/CONFIG_INVALID\/store\/hist:correction-target-missing/)
  })

  it('非 REC-COR-01 走 correct → 拒', () => {
    expect(() =>
      h.hist.correct({ targetRecordId: original, record: envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: ulid(T0, 55) }) }),
    ).toThrow(/CONFIG_INVALID\/store\/hist:not-correction/)
  })

  it('payload.corrects 未指向目标 → 拒（修正必须显式链接）', () => {
    const other = ulid(T0, 56)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: other }))
    expect(() =>
      h.hist.correct({ targetRecordId: original, record: envelope('REC-COR-01', corPayload(other), { companyRef: company, recordId: ulid(T0, 57) }) }),
    ).toThrow(/CONFIG_INVALID\/store\/hist:correction-target-unlinked/)
  })

  it('original_preserved:false → 契约 literal 拒（不得伪造覆盖形修正）', () => {
    expect(() =>
      h.hist.correct({
        targetRecordId: original,
        record: envelope('REC-COR-01', corPayload(original, { original_preserved: false }), { companyRef: company, recordId: ulid(T0, 58) }),
      }),
    ).toThrow(/CONFIG_INVALID\/store\/record:invalid:payload\.original_preserved/)
  })
})
