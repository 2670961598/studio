/**
 * test/v2/hist-query —— MIG-04 / IMPL-04-06：PORT-HIST 读面（query/reconcile/memory）＋DOM-05 投影断言
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-06（append→get/query；records 表只读投影断言＝DOM-05 非第四事实源；
 *     records.ts 校验源=contract 的 grep 断言）
 *   - docs/v2/14 §1.6（query/reconcile；reconcile 完成前不得结清、差异不得压成「已对平」）
 *   - docs/v2/11 §0.4（revises 版本链/乱序）、§0.9（13 AREA 封闭）、§十三（记忆按知悉范围最小化；
 *     继承只能走 REC-MEM-03 显式凭证——本面不自动继承）
 *   - docs/v2/05 §三 DOM-05：records＝记录投影，**非第四事实源**——只读对账零写语句、events/cost_daily
 *     各有其写口（DOM-03/DOM-04）；records 无 append-only 触发器（保护面在 v15 events）
 *   - docs/v2/17 NEG-REC-05（DOM-05 负向面）／NEG-MON-03（监控不改事实）前腿
 *
 * 隔离：临时目录真文件库（hist-fixtures 夹具；migrate 到 v15）；写面见 hist-append.test.ts。
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { v2RecordArea } from '../../src/records.ts'
import { ALL_RECORD_TYPES } from '../../../contract/src/records/index.ts'
import {
  CLOCK,
  T0,
  assetLossPayload,
  corPayload,
  countRecords,
  envelope,
  evtPayload,
  iso,
  memPayload,
  openHistHarness,
  ulid,
  type HistHarness,
} from './hist-fixtures.ts'

const AREAS = ['AUTH', 'LIFE', 'PERF', 'WORK', 'EVD', 'ACC', 'CHG', 'CAP', 'REV', 'EVAL', 'ASSET', 'OBS', 'MEM']

let h: HistHarness

beforeAll(async () => {
  h = await openHistHarness()
})

afterAll(async () => {
  await h.close()
})

// —— query（company/area/type/since + 确定性序）——

describe('query（company 必填；area/type/since 过滤；produced_at,record_id 升序）', () => {
  const company = 'hist-query'
  const t1 = T0 + 10_000
  const t2 = T0 + 20_000
  const t3 = T0 + 30_000

  beforeAll(() => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { recordId: ulid(t1, 1), companyRef: company, producedAt: iso(t1) }))
    h.hist.append(envelope('REC-ASSET-02', assetLossPayload(), { recordId: ulid(t2, 2), companyRef: company, producedAt: iso(t2) }))
    h.hist.append(
      envelope(
        'REC-EVT-03',
        { unknown_scope: 'platform', reason: '来源不可达', last_known: 'cursor-9', impact: '下游显示未知', owner: 'ENG-1', review_by: iso(t3 + 1_000) },
        { recordId: ulid(t3, 3), companyRef: company, producedAt: iso(t3) },
      ),
    )
  })

  it('company 全量（升序；跨 AREA 可查）', () => {
    const all = h.hist.query({ company })
    expect(all.map((r) => r.recordId)).toEqual([ulid(t1, 1), ulid(t2, 2), ulid(t3, 3)])
    expect(all.map((r) => r.recordType)).toEqual(['REC-EVT-01', 'REC-ASSET-02', 'REC-EVT-03'])
  })

  it('area 过滤（记录域由 recordType 派生，不手填）', () => {
    expect(h.hist.query({ company, area: 'AUTH' }).map((r) => r.recordId)).toEqual([ulid(t1, 1), ulid(t3, 3)])
    expect(h.hist.query({ company, area: 'ASSET' }).map((r) => r.recordId)).toEqual([ulid(t2, 2)])
    expect(h.hist.query({ company, area: 'WORK' })).toEqual([])
  })

  it('type / since / 组合过滤（since 含界）', () => {
    expect(h.hist.query({ company, type: 'REC-ASSET-02' }).map((r) => r.recordId)).toEqual([ulid(t2, 2)])
    expect(h.hist.query({ company, since: t2 }).map((r) => r.recordId)).toEqual([ulid(t2, 2), ulid(t3, 3)])
    expect(h.hist.query({ company, area: 'AUTH', since: t3 }).map((r) => r.recordId)).toEqual([ulid(t3, 3)])
    expect(h.hist.query({ company: 'no-such-company' })).toEqual([])
  })

  it('坏行不冒充「无行」：get/query 遇到坏 payload → CONFIG_INVALID（fail-closed）', () => {
    const badId = ulid(T0 + 40_000, 4)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { recordId: badId, companyRef: company, producedAt: iso(T0 + 40_000) }))
    h.db.prepare("UPDATE records SET payload = '{oops' WHERE record_id = ?").run(badId)
    expect(() => h.hist.get(badId)).toThrow(/CONFIG_INVALID\/store\/hist:corrupt-row:payload/)
    expect(() => h.hist.query({ company })).toThrow(/CONFIG_INVALID\/store\/hist:corrupt-row:payload/)
  })
})

// —— reconcile：只读投影自洽对账 ——

describe('reconcile（只读对账：投影自洽；差异不压平；零写语句）', () => {
  const company = 'hist-recon'
  const clean = ulid(T0, 61)

  beforeAll(() => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: clean, producedAt: iso(T0 + 1_000) }))
  })

  it('健康投影：settled=true、差异空、completedAt=注入时钟', () => {
    const batch = h.hist.reconcile({ company })
    expect(batch.checked).toBe(1)
    expect(batch.differences).toEqual([])
    expect(batch.settled).toBe(true)
    expect(batch.completedAt).toBe(iso(CLOCK))
  })

  it('坏行逐类收差异：JSON 坏=undeterminable、形状/域不符=conflict、revises 悬空=missing', () => {
    const jsonBad = ulid(T0, 62)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: jsonBad, producedAt: iso(T0 + 2_000) }))
    h.db.prepare("UPDATE records SET payload = '{oops' WHERE record_id = ?").run(jsonBad)
    const shapeBad = ulid(T0, 63)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: shapeBad, producedAt: iso(T0 + 3_000) }))
    h.db.prepare("UPDATE records SET payload = '{}' WHERE record_id = ?").run(shapeBad)
    const areaBad = ulid(T0, 64)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: areaBad, producedAt: iso(T0 + 4_000) }))
    h.db.prepare("UPDATE records SET record_area = 'WORK' WHERE record_id = ?").run(areaBad)
    const dangling = ulid(T0, 65)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: dangling, producedAt: iso(T0 + 5_000) }))
    h.db.prepare("UPDATE records SET revises = '{\"refId\":\"no-such\",\"refVersion\":\"1.0.0\"}' WHERE record_id = ?").run(dangling)
    const badTime = ulid(T0, 68)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: badTime, producedAt: iso(T0 + 6_000) }))
    h.db.prepare("UPDATE records SET produced_at = 'oops' WHERE record_id = ?").run(badTime)

    const batch = h.hist.reconcile({ company })
    expect(batch.settled).toBe(false)
    const kinds = batch.differences.map((d) => `${d.kind}:${d.recordId}`)
    expect(kinds).toContain(`undeterminable:${jsonBad}`)
    expect(kinds).toContain(`conflict:${shapeBad}`)
    expect(kinds).toContain(`conflict:${areaBad}`)
    expect(kinds).toContain(`missing:${dangling}`)
    expect(kinds).toContain(`undeterminable:${badTime}`)
  })

  it('版本链乱序（修正先于被修正记录）=disorder', () => {
    const chain = 'hist-recon-chain'
    const target = ulid(T0, 66)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: chain, recordId: target, producedAt: iso(T0 + 20_000) }))
    const corId = ulid(T0, 67)
    h.hist.correct({
      targetRecordId: target,
      record: envelope('REC-COR-01', corPayload(target), {
        companyRef: chain,
        recordId: corId,
        producedAt: iso(T0 + 10_000),
        revises: { refId: target, refVersion: '1.0.0' },
      }),
    })
    const batch = h.hist.reconcile({ company: chain })
    expect(batch.differences.some((d) => d.kind === 'disorder' && d.recordId === corId)).toBe(true)
  })

  it('只读：对账前后 records 全表逐行相同（监控/对账不改事实——NEG-MON-03 前腿）', () => {
    const snapshot = (): unknown => h.db.prepare('SELECT * FROM records ORDER BY record_id').all()
    const before = snapshot()
    h.hist.reconcile({ company })
    h.hist.reconcile({ company: 'no-such-company' })
    expect(snapshot()).toEqual(before)
  })
})

// —— memory：按 scope 精确读，不自动继承 ——

describe('memory（REC-MEM-01 按 owner_scope 精确读；不自动继承）', () => {
  const company = 'hist-mem'
  const mem1 = ulid(T0, 71)
  const mem2 = ulid(T0, 72)

  beforeAll(() => {
    h.hist.append(envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1' }), { companyRef: company, recordId: mem1, producedAt: iso(T0 + 1_000) }))
    h.hist.append(
      envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-2', domain: 'work', personal_subtype: undefined }), {
        companyRef: company,
        recordId: mem2,
        producedAt: iso(T0 + 2_000),
      }),
    )
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: ulid(T0, 73), producedAt: iso(T0 + 3_000) }))
  })

  it('只返回本 scope 的 REC-MEM-01（不返回他 scope / 非记忆记录）', () => {
    expect(h.hist.memory({ company, scope: 'ENG-1' }).map((r) => r.recordId)).toEqual([mem1])
    expect(h.hist.memory({ company, scope: 'ENG-2' }).map((r) => r.recordId)).toEqual([mem2])
  })

  it('不自动继承：父 scope/前缀/子 scope 均不命中（继承只能走 REC-MEM-03 显式凭证）', () => {
    expect(h.hist.memory({ company, scope: 'ENG' })).toEqual([])
    expect(h.hist.memory({ company, scope: 'ENG-1/child' })).toEqual([])
    expect(h.hist.memory({ company, scope: 'STUDIO' })).toEqual([])
  })

  it('domain 过滤生效；空 scope 拒', () => {
    expect(h.hist.memory({ company, scope: 'ENG-2', domain: 'personal' })).toEqual([])
    expect(h.hist.memory({ company, scope: 'ENG-2', domain: 'work' }).map((r) => r.recordId)).toEqual([mem2])
    expect(() => h.hist.memory({ company, scope: '  ' })).toThrow(/CONFIG_INVALID\/store\/hist:memory-scope-empty/)
  })
})

// —— DOM-05：records 是记录投影、不是第四事实源 ——

describe('DOM-05 投影面：零 events/cost_daily 写、无 append-only 触发器、来源=contract（grep）', () => {
  const company = 'hist-proj'
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('append/correct 不写 events 与 cost_daily（DOM-03/DOM-04 各有其写口）', () => {
    const eventsBefore = h.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }
    const costBefore = h.db.prepare('SELECT COUNT(*) AS c FROM cost_daily').get() as { c: number }
    const id = ulid(T0, 81)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id }))
    h.hist.correct({ targetRecordId: id, record: envelope('REC-COR-01', corPayload(id), { companyRef: company, recordId: ulid(T0, 82) }) })
    expect(h.db.prepare('SELECT COUNT(*) AS c FROM events').get()).toEqual(eventsBefore)
    expect(h.db.prepare('SELECT COUNT(*) AS c FROM cost_daily').get()).toEqual(costBefore)
  })

  it('records 不设 append-only 触发器（保护面在 DOM-03 events，v15 SEC-FC-04）', () => {
    const triggers = h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'records'").all() as Array<{ name: string }>
    expect(triggers).toEqual([])
    expect(h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'").all()).toHaveLength(2)
  })

  it('records.ts 校验源=contract（头注承诺兑现）：ALL_RECORD_SCHEMAS 取自 contract records 分区', () => {
    const recordsSrc = src('../../src/records.ts')
    expect(recordsSrc).toContain('ALL_RECORD_SCHEMAS')
    expect(recordsSrc).toContain("from '../../contract/src/records/index.ts'")
    expect(recordsSrc).toContain('export function v2RecordArea')
    // v2 记录形状不再在本文件复制（74 类字段表唯一源=contract）
    expect(recordsSrc).not.toMatch(/export const [A-Z0-9_]+RecordSchema = z\.strictObject/)
  })

  it('hist.ts 写面只有 records：零 UPDATE/DELETE、零 events/cost_daily 语句', () => {
    const histSrc = src('../../src/hist.ts')
    expect(histSrc.match(/\bINSERT INTO\s+\w+/g)).toEqual(['INSERT INTO records'])
    expect(histSrc).not.toMatch(/\bUPDATE\s+records\b/i)
    expect(histSrc).not.toMatch(/\bDELETE\s+FROM\s+records\b/i)
    expect(histSrc).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b[^;]*\bevents\b/i)
    expect(histSrc).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b[^;]*\bcost_daily\b/i)
  })

  it('13 AREA 由 contract 74 类派生（不重述字面量）：派生集合＝v2/11 §0.9 十三域', () => {
    const derived = [...new Set(ALL_RECORD_TYPES.map((recordType) => v2RecordArea(recordType)))].sort()
    expect(derived).toEqual([...AREAS].sort())
    expect(v2RecordArea('REC-CMD-01')).toBe('AUTH')
    expect(v2RecordArea('REC-WORK-ACCEPT-MAINT')).toBe('WORK')
    expect(v2RecordArea('REC-EVD-RVK')).toBe('EVD')
    expect(v2RecordArea('REC-CAP-ACTIVATE')).toBe('CAP')
    expect(v2RecordArea('REC-MEM-01')).toBe('MEM')
  })

  it('记录投影非事实源：records 行数只随 append 增长、query/memory/reconcile 零写', () => {
    const before = countRecords(h.db, company)
    h.hist.query({ company })
    h.hist.memory({ company, scope: 'ENG-1' })
    h.hist.reconcile({ company })
    expect(countRecords(h.db, company)).toBe(before)
  })
})
