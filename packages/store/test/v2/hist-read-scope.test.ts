/**
 * test/v2/hist-read-scope —— 读面知悉范围（studio-dev-543）：hist 读面接 ReadContext（越权读拒）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §0.2-1（读面缺省＝拒；越权＝Err，**不得** Ok(undefined) 冒充「无行」；Ok(undefined)
 *     只表「权威确认不存在」）／§1.6（PORT-HIST get/query/reconcile 读签名）；
 *   - docs/v2/15 §五 SEC-RD-01（readScope＋caller 字段承载，治 P0-10；多公司视图按公司与知悉范围隔离）；
 *   - docs/17-§2（相位机）／§6（收割四要件）＝本单派发面：读面接线**不改**相位与收割判据。
 *
 * 覆盖（本单定向红→绿；改前红＝读面无上下文闸，改后绿）：
 *   ① 四读法缺 ReadContext ⇒ 拒（fail-closed，不按「无行」处理）；
 *   ② 畸形上下文（范围缺/公司维缺·畸形/可见字段空集/用途缺/调用者缺·畸形）逐项拒，处置轴可判；
 *   ③ 越权（跨公司）⇒ 拒且不泄漏记录存在性/内容（**不是** undefined／空集）；
 *   ④ 权威确认不存在仍＝undefined（不把「不存在」误判成越权）；坏行仍 fail-closed；
 *   ⑤ 读上下文来源可审计：onRead 收到 allow/deny 行（谁在读/范围依据/判定）；
 *   ⑥ 读面零写：get/query/reconcile/memory 不改 records（DOM-05 投影面）。
 *
 * 隔离：临时目录真文件库（hist-fixtures 夹具；migrate 到 v15）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ReadContext } from '@studio-next/contract'
import { createHistFace, type HistReadAudit } from '../../src/hist.ts'
import {
  CLOCK,
  T0,
  countRecords,
  envelope,
  evtPayload,
  iso,
  openHistHarness,
  readContext,
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

/** 期望拒绝：返回抛出的分类错误（无 subcause 的异常＝测试自身失败，显式抛回） */
function denialOf(run: () => unknown): { category?: string; subcause: string; failure?: string; detail?: string } {
  try {
    run()
  } catch (error) {
    const bag = error as { category?: unknown; subcause?: unknown; failure?: unknown; detail?: unknown }
    if (typeof bag.subcause !== 'string') throw error
    return {
      subcause: bag.subcause,
      ...(typeof bag.category === 'string' ? { category: bag.category } : {}),
      ...(typeof bag.failure === 'string' ? { failure: bag.failure } : {}),
      ...(typeof bag.detail === 'string' ? { detail: bag.detail } : {}),
    }
  }
  throw new Error('期望读面拒绝，实得成功（fail-closed 未生效）')
}

// —— ① 读方法必带 ReadContext ——

describe('① 读方法必带 ReadContext（v2/14 §0.2-1：缺省＝拒）', () => {
  const company = 'hist-scope-missing'
  const id = ulid(T0 + 1_000, 201)

  beforeAll(() => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id, producedAt: iso(T0 + 1_000) }))
  })

  it('get/query/reconcile/memory 四法缺上下文一律拒（不拿 undefined/空集冒充「无行」）', () => {
    const missing = undefined as unknown as ReadContext
    const cases: ReadonlyArray<readonly [string, () => unknown]> = [
      ['get', () => h.hist.get(id, missing)],
      ['query', () => h.hist.query({ company }, missing)],
      ['reconcile', () => h.hist.reconcile({ company }, missing)],
      ['memory', () => h.hist.memory({ company, scope: 'ENG-1' }, missing)],
    ]
    for (const [method, run] of cases) {
      const denial = denialOf(run)
      expect(denial.category, method).toBe('CONFIG_INVALID')
      expect(denial.subcause, method).toBe('store/hist:read-context-missing')
      expect(denial.failure, method).toBe('rejected_precondition')
    }
  })
})

// —— ② 畸形上下文逐项拒 ——

describe('② 畸形上下文逐项拒（范围/公司维/可见字段/用途/调用者）', () => {
  const company = 'hist-scope-bad'
  const id = ulid(T0 + 1_000, 211)
  const base = readContext(company)

  beforeAll(() => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id, producedAt: iso(T0 + 1_000) }))
  })

  const cases: ReadonlyArray<readonly [string, ReadContext, string, string]> = [
    ['readScope 缺', { caller: base.caller } as unknown as ReadContext, 'store/hist:read-scope-missing', 'rejected_precondition'],
    [
      '公司维缺',
      { readScope: { fields: ['record.payload'], purpose: 'p' }, caller: base.caller } as unknown as ReadContext,
      'store/hist:read-scope-company-missing',
      'rejected_precondition',
    ],
    [
      '公司维畸形',
      {
        readScope: { company: { companyId: '', slug: company }, fields: ['record.payload'], purpose: 'p' },
        caller: base.caller,
      } as unknown as ReadContext,
      'store/hist:read-scope-company-invalid',
      'rejected_precondition',
    ],
    [
      '可见字段空集＝越权',
      { readScope: { ...base.readScope, fields: [] }, caller: base.caller } as unknown as ReadContext,
      'store/hist:read-scope-fields-invalid',
      'rejected_forbidden',
    ],
    [
      '用途缺',
      {
        readScope: { company: base.readScope.company, fields: ['record.payload'] },
        caller: base.caller,
      } as unknown as ReadContext,
      'store/hist:read-purpose-missing',
      'rejected_precondition',
    ],
    ['调用者缺', { readScope: base.readScope } as unknown as ReadContext, 'store/hist:read-caller-missing', 'rejected_precondition'],
    [
      '调用者 kind 非法',
      { readScope: base.readScope, caller: { callerId: 'E-7', kind: 'robot' } } as unknown as ReadContext,
      'store/hist:read-caller-kind-invalid',
      'rejected_precondition',
    ],
  ]

  it('逐项拒，且观测轴（category）与处置轴（failure）分离可判（docs/80 TS-SCALAR-10）', () => {
    for (const [label, rc, subcause, failure] of cases) {
      const denial = denialOf(() => h.hist.get(id, rc))
      expect(denial.category, label).toBe('CONFIG_INVALID')
      expect(denial.subcause, label).toBe(subcause)
      expect(denial.failure, label).toBe(failure)
    }
  })
})

// —— ③ 越权读（跨公司）＝拒，不泄漏 ——

describe('③ 越权读（跨公司）＝拒，不泄漏存在性/内容（不得 Ok(undefined) 冒充无行）', () => {
  const mine = 'hist-scope-mine'
  const other = 'hist-scope-other'
  const myId = ulid(T0 + 2_000, 221)
  const otherId = ulid(T0 + 2_000, 222)

  beforeAll(() => {
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: mine, recordId: myId, producedAt: iso(T0 + 2_000) }))
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: other, recordId: otherId, producedAt: iso(T0 + 2_000) }))
  })

  it('get：他司记录 ⇒ read-forbidden（不是 undefined）；detail 不携 payload 内容', () => {
    const denial = denialOf(() => h.hist.get(otherId, readContext(mine)))
    expect(denial.category).toBe('CONFIG_INVALID')
    expect(denial.subcause).toBe('store/hist:read-forbidden')
    expect(denial.failure).toBe('rejected_forbidden')
    expect(denial.detail ?? '').not.toContain('event_completeness')
    // 反证：本司记录照常可读（闸不是「一律拒」）
    expect(h.hist.get(myId, readContext(mine))?.recordId).toBe(myId)
  })

  it('query/reconcile/memory：查他司一律拒（不返回空集冒充「无行」）', () => {
    const rc = readContext(mine)
    expect(denialOf(() => h.hist.query({ company: other }, rc)).subcause).toBe('store/hist:read-forbidden')
    expect(denialOf(() => h.hist.reconcile({ company: other }, rc)).subcause).toBe('store/hist:read-forbidden')
    expect(denialOf(() => h.hist.memory({ company: other, scope: 'ENG-1' }, rc)).subcause).toBe('store/hist:read-forbidden')
  })

  it('公司维两槽口径：companyId 或 slug 任一命中即同维（与 assembly/api/readers.ts 同口径）', () => {
    const bySlug: ReadContext = {
      readScope: { company: { companyId: 'co-unrelated', slug: mine }, fields: ['record.payload'], purpose: 'p' },
      caller: { callerId: 'E-7', kind: 'employment' },
    }
    expect(h.hist.get(myId, bySlug)?.recordId).toBe(myId)
    const byId: ReadContext = {
      readScope: { company: { companyId: mine, slug: 'slug-unrelated' }, fields: ['record.payload'], purpose: 'p' },
      caller: { callerId: 'E-7', kind: 'employment' },
    }
    expect(h.hist.get(myId, byId)?.recordId).toBe(myId)
  })
})

// —— ④ 权威确认不存在 vs 越权 ——

describe('④ 权威确认不存在＝undefined（只表不存在，不表越权）；坏行仍 fail-closed', () => {
  const company = 'hist-scope-absent'

  it('同司不存在 id ⇒ undefined；同司坏行 ⇒ CONFIG_INVALID/corrupt-row（不冒充「无行」）', () => {
    const rc = readContext(company)
    expect(h.hist.get(ulid(T0, 231), rc)).toBeUndefined()

    const bad = ulid(T0 + 9_000, 232)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: bad, producedAt: iso(T0 + 9_000) }))
    h.db.prepare("UPDATE records SET payload = '{oops' WHERE record_id = ?").run(bad)
    expect(denialOf(() => h.hist.get(bad, rc)).subcause).toMatch(/^store\/hist:corrupt-row:payload/)
  })
})

// —— ⑤ 上下文来源可审计 ——

describe('⑤ 上下文来源可审计（onRead：谁在读/范围依据/判定）', () => {
  const company = 'hist-scope-audit'
  const id = ulid(T0 + 4_000, 241)
  const audits: HistReadAudit[] = []
  let face: ReturnType<typeof createHistFace>

  beforeAll(() => {
    face = createHistFace(h.db, { now: () => CLOCK, onRead: (audit) => audits.push(audit) })
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id, producedAt: iso(T0 + 4_000) }))
  })

  it('allow 行携调用者/用途/公司维/字段声明/计数/注入时钟', () => {
    audits.length = 0
    expect(face.get(id, readContext(company, 'E-7'))?.recordId).toBe(id)
    expect(audits).toEqual([
      {
        method: 'get',
        decision: 'allow',
        callerId: 'E-7',
        callerKind: 'employment',
        company: `${company}/${company}`,
        fields: ['record.payload'],
        purpose: 'hist 测试读面（IMPL-04-06）',
        recordCount: 1,
        subcause: null,
        at: iso(CLOCK),
      },
    ])
  })

  it('deny 行携拒绝子因（越权/缺证都留痕，拒绝不静默）', () => {
    audits.length = 0
    // 记录属 hist-scope-audit，读范围声明 hist-scope-other ⇒ 越权（不得冒充「无行」）
    denialOf(() => face.get(id, readContext('hist-scope-other')))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      method: 'get',
      decision: 'deny',
      callerId: 'E-7',
      company: 'hist-scope-other/hist-scope-other',
      recordCount: 0,
      subcause: 'store/hist:read-forbidden',
    })

    audits.length = 0
    denialOf(() => face.get(id, undefined as unknown as ReadContext))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ method: 'get', decision: 'deny', callerId: null, company: null, subcause: 'store/hist:read-context-missing' })
  })
})

// —— ⑥ 读面零写 ——

describe('⑥ 读面零写（DOM-05 投影面）：四读法不改 records', () => {
  it('query/get/reconcile/memory 前后全表逐行一致、行数不增', () => {
    const company = 'hist-scope-ro'
    const id = ulid(T0 + 5_000, 251)
    h.hist.append(envelope('REC-EVT-01', evtPayload(), { companyRef: company, recordId: id, producedAt: iso(T0 + 5_000) }))

    const snapshot = (): unknown => h.db.prepare('SELECT * FROM records ORDER BY record_id').all()
    const before = snapshot()
    const rc = readContext(company)
    h.hist.get(id, rc)
    h.hist.query({ company }, rc)
    h.hist.reconcile({ company }, rc)
    h.hist.memory({ company, scope: 'ENG-1' }, rc)
    expect(snapshot()).toEqual(before)
    expect(countRecords(h.db, company)).toBe(1)
  })
})
