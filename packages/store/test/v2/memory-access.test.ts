/**
 * test/v2/memory-access —— studio-dev-538：记忆域 MEM 读写审计（REC-MEM-02 访问留痕落库）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/08 §3.3（访问留痕与使用限制：每次访问留审计痕；只统计次数/命中率不算访问记录；
 *     知悉范围变化须重新审批）；§三（三域唯一主表）
 *   - docs/v2/11 §十三（REC-MEM-02 字段与不变量：访问被拒也是审计事件 ENU-66）、§十五-1（引用完整性）
 *   - docs/v2/14 §0.2-1（读面缺省＝拒：越权返回 Err，不得以 Ok(undefined) 冒充「无行」）／
 *     §1.6（PORT-HIST memoryWrite/memoryAuditAccess）
 *   - docs/v2/17 NEG-REC-13（MEM 族负向面）；docs/17-§2（本面零相位/零墙钟依赖）
 *
 * 定向红→绿（本单验收②）：本文件在新面缺失时 import 即红；落面后全绿。负向场景全部断言
 * 「拒绝＋denied 审计先落」或「拒绝且不签审计白条」——不以返回空列表冒充完成。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HistFace } from '../../src/hist.ts'
import {
  createMemoryAccessFace,
  type MemoryAccessContext,
  type MemoryAccessFace,
  type MemoryAccessWho,
} from '../../src/memory/access.ts'
import type { RecordRef } from '../../../contract/src/records/envelope.ts'
import { CLOCK, T0, envelope, iso, memPayload, openHistHarness, readContext, ulid, type HistHarness } from './hist-fixtures.ts'

let h: HistHarness
let seq = 0

beforeAll(async () => {
  h = await openHistHarness()
})

afterAll(async () => {
  await h.close()
})

// —— 世界：每测试一套独立 company（条目/授权依据/审计互不串场）——

interface World {
  readonly company: string
  readonly grantId: string
  readonly mem1: string
  readonly mem2: string
  readonly parent: string
  readonly child: string
  readonly memWork: string
  readonly memory: MemoryAccessFace
}

/** REC-AUTH-01 授权依据（delegation：scope.included 含 ENG-1；到期远在访问时刻之后） */
function grantPayload(): Record<string, unknown> {
  return {
    grantor: { refId: 'G9.internal-boss', refVersion: '1.0.0' },
    grantee: { refId: 'ENG-1', refVersion: '1.0.0' },
    parent_grant: { refType: 'REC-AUTH-01', refId: 'grant-root', refVersion: '1.0.0' },
    grant_class: 'delegation',
    scope: { purpose: 'memory-access', object: 'REC-MEM-01', included: ['ENG-1'], forbidden: ['越权读'] },
    conditions: [],
    term: { from: iso(T0), to: iso(T0 + 30 * 86_400_000) },
    delegable: false,
    withdrawal_terms: '到期即失效',
    conflict_check_ref: { refType: 'REC-LIFE-05', refId: 'conflict-1', refVersion: '1.0.0' },
  }
}

function world(name: string): World {
  const company = `mem-access-${name}`
  const grantId = ulid(T0, ++seq)
  const mem1 = ulid(T0, ++seq)
  const mem2 = ulid(T0, ++seq)
  const parent = ulid(T0, ++seq)
  const child = ulid(T0, ++seq)
  const memWork = ulid(T0, ++seq)
  const at = { companyRef: company, producedAt: iso(T0 + 1_000) }
  h.hist.append(envelope('REC-AUTH-01', grantPayload(), { ...at, recordId: grantId }))
  h.hist.append(envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1' }), { ...at, recordId: mem1 }))
  h.hist.append(
    envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-2', domain: 'work', personal_subtype: undefined }), {
      ...at,
      recordId: mem2,
    }),
  )
  h.hist.append(envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG' }), { ...at, recordId: parent }))
  h.hist.append(envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1/child' }), { ...at, recordId: child }))
  h.hist.append(
    envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1', domain: 'work', personal_subtype: undefined }), {
      ...at,
      recordId: memWork,
    }),
  )
  const memory = createMemoryAccessFace(h.hist, {
    makeId: () => `aud-${company}-${++seq}`,
    now: () => CLOCK,
    writtenBy: 'test',
  })
  return { company, grantId, mem1, mem2, parent, child, memWork, memory }
}

const HOLDER: MemoryAccessWho = {
  holderRef: { refId: 'ENG-1', refVersion: '1.0.0' },
  positionRef: null,
  procedureRef: null,
}
const BASIS_VERSION = '1.0.0'

function basisOf(world: World): RecordRef {
  return { refType: 'REC-AUTH-01', refId: world.grantId, refVersion: BASIS_VERSION }
}

/** 访问上下文（缺省合法：scope=ENG-1、授权在册未到期、时刻=注入时钟） */
function ctx(
  w: World,
  over: {
    readonly scope?: string
    readonly when?: string
    readonly expiresAt?: string
    readonly basisRef?: RecordRef
    readonly who?: MemoryAccessWho
  } = {},
): MemoryAccessContext {
  return {
    scope: over.scope ?? 'ENG-1',
    who:
      over.who ?? {
        holderRef: HOLDER.holderRef,
        positionRef: HOLDER.positionRef,
        procedureRef: HOLDER.procedureRef,
      },
    purpose: { why: '验收遗留检索', forWorkOrDecisionRef: { refType: 'REC-WORK-09', refId: 'work-1', refVersion: '1.0.0' } },
    authority: {
      basisRef: over.basisRef ?? basisOf(w),
      expiresAt: over.expiresAt ?? iso(CLOCK + 86_400_000),
    },
    when: over.when ?? iso(CLOCK),
  }
}

interface AuditRow {
  readonly recordId: string
  readonly effectiveState: string
  readonly payload: {
    readonly result: string
    readonly when: string
    readonly layer_and_entries: { readonly domain: string; readonly entry_refs: ReadonlyArray<{ refType: string; refId: string }> }
    readonly authority_ref: { readonly expires_at: string }
  }
}

/** 该公司 REC-MEM-02 审计行（按 produced_at,record_id 升序） */
function audits(company: string): AuditRow[] {
  const rows = h.db
    .prepare("SELECT record_id, payload, effective_state FROM records WHERE company = ? AND record_type = 'REC-MEM-02' ORDER BY produced_at ASC, record_id ASC")
    .all(company) as Array<{ record_id: string; payload: string; effective_state: string }>
  return rows.map((row) => ({
    recordId: row.record_id,
    effectiveState: row.effective_state,
    payload: JSON.parse(row.payload) as AuditRow['payload'],
  }))
}

function lastAudit(company: string): AuditRow {
  const rows = audits(company)
  const last = rows[rows.length - 1]
  if (last === undefined) throw new Error(`company=${company} 无 REC-MEM-02 审计行（审计缺证即判负）`)
  return last
}

/** 审计写口故障面（模拟审计不可落：写/读都必须 fail-closed） */
function withFailingAudit(base: HistFace): HistFace {
  return {
    ...base,
    append: (record, tx) => {
      const recordType = typeof record === 'object' && record !== null ? (record as { recordType?: unknown }).recordType : undefined
      if (recordType === 'REC-MEM-02') throw new Error('audit store unavailable')
      return tx === undefined ? base.append(record) : base.append(record, tx)
    },
  }
}

// —— 写面：REC-MEM-01 与 REC-MEM-02 同事务 ——

describe('memory.write：每次写入落 REC-MEM-02（同事务，审计不可缺）', () => {
  it('写条目→REC-MEM-01 落库＋provided 审计（entry_refs 指向本条）', () => {
    const w = world('write-ok')
    const entryId = ulid(T0, 970)
    const record = envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1' }), {
      companyRef: w.company,
      recordId: entryId,
      producedAt: iso(T0 + 2_000),
    })
    const ref = w.memory.write(record, ctx(w))
    expect(ref).toMatchObject({ recordId: entryId, recordType: 'REC-MEM-01', appended: true })
    expect(h.hist.get(entryId, readContext(w.company))?.recordId).toBe(entryId)
    const rows = audits(w.company)
    expect(rows).toHaveLength(1)
    expect(lastAudit(w.company).payload.result).toBe('provided')
    expect(lastAudit(w.company).payload.layer_and_entries.entry_refs.map((ref0) => ref0.refId)).toEqual([entryId])
    expect(lastAudit(w.company).payload.layer_and_entries.domain).toBe('personal')
    expect(lastAudit(w.company).payload.when).toBe(iso(CLOCK))
    expect(lastAudit(w.company).payload.authority_ref.expires_at).toBe(iso(CLOCK + 86_400_000))
    expect(lastAudit(w.company).effectiveState).toBe('effective')
  })

  it('审计写失败＝整体回滚（不留无审计记忆）', () => {
    const w = world('write-audit-fail')
    const memory = createMemoryAccessFace(withFailingAudit(h.hist), {
      makeId: () => `aud-fail-${++seq}`,
      now: () => CLOCK,
      writtenBy: 'test',
    })
    const entryId = ulid(T0, 971)
    const record = envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-1' }), {
      companyRef: w.company,
      recordId: entryId,
      producedAt: iso(T0 + 2_000),
    })
    expect(() => memory.write(record, ctx(w))).toThrow(/audit store unavailable/)
    expect(h.hist.get(entryId, readContext(w.company))).toBeUndefined()
    expect(audits(w.company)).toHaveLength(0)
  })

  it('越权写（条目 owner_scope ≠ 调用方 scope）→拒且零写入', () => {
    const w = world('write-denied')
    const entryId = ulid(T0, 972)
    const record = envelope('REC-MEM-01', memPayload({ owner_scope: 'ENG-2', domain: 'work', personal_subtype: undefined }), {
      companyRef: w.company,
      recordId: entryId,
      producedAt: iso(T0 + 2_000),
    })
    expect(() => w.memory.write(record, ctx(w, { scope: 'ENG-1' }))).toThrow(/CONFIG_INVALID\/store\/hist:memory-scope-denied/)
    expect(h.hist.get(entryId, readContext(w.company))).toBeUndefined()
    expect(audits(w.company)).toHaveLength(0)
  })
})

// —— 读面：精确等值、每次留痕、越权先落 denied ——

describe('memory.read：每次读取落 REC-MEM-02（scope 精确等值）', () => {
  it('定向读→返回条目＋provided 审计', () => {
    const w = world('read-ok')
    const result = w.memory.read({ company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1)] }, ctx(w))
    expect(result.entries.map((record) => record.recordId)).toEqual([w.mem1])
    expect(result.audit.recordType).toBe('REC-MEM-02')
    const audit = lastAudit(w.company)
    expect(audit.payload.result).toBe('provided')
    expect(audit.payload.layer_and_entries.entry_refs.map((ref) => ref.refId)).toEqual([w.mem1])
  })

  it('扫描读→只返回本 scope（父/子/前缀不继承）；domain 必填', () => {
    const w = world('read-scan')
    const personal = w.memory.read({ company: w.company, scope: 'ENG-1', domain: 'personal' }, ctx(w))
    expect(personal.entries.map((record) => record.recordId)).toEqual([w.mem1])
    const work = w.memory.read({ company: w.company, scope: 'ENG-1', domain: 'work' }, ctx(w))
    expect(work.entries.map((record) => record.recordId)).toEqual([w.memWork])
    expect(() => w.memory.read({ company: w.company, scope: 'ENG-1' }, ctx(w))).toThrow(/CONFIG_INVALID\/store\/hist:memory-domain-required/)
    expect(audits(w.company)).toHaveLength(2)
  })

  it('越权读（他 scope）→拒＋denied 审计先落（访问被拒也是审计事件）', () => {
    const w = world('read-other-scope')
    expect(() => w.memory.read({ company: w.company, scope: 'ENG-2', entryRefs: [basisOfEntry(w.mem2)] }, ctx(w))).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-scope-denied/,
    )
    const audit = lastAudit(w.company)
    expect(audit.payload.result).toBe('denied')
    expect(audit.payload.layer_and_entries.entry_refs.map((ref) => ref.refId)).toEqual([w.mem2])
  })

  it('父/子 scope 不精确等值→拒＋denied 审计（不自动继承）', () => {
    const w = world('read-prefix')
    expect(() => w.memory.read({ company: w.company, scope: 'ENG', domain: 'personal' }, ctx(w))).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-scope-denied/,
    )
    expect(lastAudit(w.company).payload.result).toBe('denied')
    expect(() => w.memory.read({ company: w.company, scope: 'ENG-1/child', domain: 'personal' }, ctx(w))).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-scope-denied/,
    )
    expect(lastAudit(w.company).payload.result).toBe('denied')
    expect(audits(w.company)).toHaveLength(2)
  })

  it('审计写失败＝不返回条目（缺证即判负）', () => {
    const w = world('read-audit-fail')
    const memory = createMemoryAccessFace(withFailingAudit(h.hist), {
      makeId: () => `aud-read-fail-${++seq}`,
      now: () => CLOCK,
      writtenBy: 'test',
    })
    expect(() => memory.read({ company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1)] }, ctx(w))).toThrow(
      /audit store unavailable/,
    )
    expect(audits(w.company)).toHaveLength(0)
  })

  it('扫描无条目→拒（零条目不成证，不签审计白条）', () => {
    const w = world('read-empty')
    expect(() => w.memory.read({ company: w.company, scope: 'NO-SUCH-SCOPE', domain: 'personal' }, ctx(w))).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-access-no-entries/,
    )
    expect(audits(w.company)).toHaveLength(0)
  })
})

// —— 授权机械检查（权源实体效力归 PORT-AUTH，本面只判可解析/未到期）——

describe('授权机械检查：悬空/到期/缺项一律 fail-closed', () => {
  it('授权依据悬空（不在册）→拒＋denied 审计', () => {
    const w = world('auth-missing')
    const missing: RecordRef = { refType: 'REC-AUTH-01', refId: 'grant-not-in-ledger', refVersion: '1.0.0' }
    expect(() =>
      w.memory.read({ company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1)] }, ctx(w, { basisRef: missing })),
    ).toThrow(/CONFIG_INVALID\/store\/hist:memory-authority-missing/)
    expect(lastAudit(w.company).payload.result).toBe('denied')
  })

  it('授权到期（expires_at ≤ when）→拒＋denied 审计', () => {
    const w = world('auth-expired')
    expect(() =>
      w.memory.read(
        { company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1)] },
        ctx(w, { expiresAt: iso(CLOCK), when: iso(CLOCK) }),
      ),
    ).toThrow(/CONFIG_INVALID\/store\/hist:memory-authority-expired/)
    expect(lastAudit(w.company).payload.result).toBe('denied')
  })

  it('上下文缺项（who 全空）→拒且不签审计白条（无可署名的访问不成证）', () => {
    const w = world('ctx-incomplete')
    const emptyWho: MemoryAccessWho = { holderRef: null, positionRef: null, procedureRef: null }
    expect(() => w.memory.read({ company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1)] }, ctx(w, { who: emptyWho }))).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-access-incomplete/,
    )
    expect(audits(w.company)).toHaveLength(0)
  })
})

// —— 审计直落面与引用完整性 ——

describe('memory.auditAccess：审计直落（引用完整性 §十五-1）', () => {
  it('条目引用可解析→REC-MEM-02 落库（provided）', () => {
    const w = world('audit-direct')
    const payload = {
      who: {
        holder_ref: { refId: 'ENG-1', refVersion: '1.0.0' },
        position_ref: null,
        procedure_ref: null,
      },
      when: iso(CLOCK),
      purpose: { why: 'kb.search 检索', for_work_or_decision_ref: { refType: 'REC-WORK-09', refId: 'work-9', refVersion: '1.0.0' } },
      layer_and_entries: { domain: 'personal' as const, entry_refs: [basisOfEntry(w.mem1)] },
      authority_ref: { basis_ref: basisOf(w), expires_at: iso(CLOCK + 86_400_000) },
      result: 'provided' as const,
    }
    const ref = w.memory.auditAccess({ company: w.company, payload })
    expect(ref.recordType).toBe('REC-MEM-02')
    expect(lastAudit(w.company).payload.result).toBe('provided')
  })

  it('条目引用悬空→拒（审计不得引悬空引用）', () => {
    const w = world('audit-dangling')
    const payload = {
      who: { holder_ref: { refId: 'ENG-1', refVersion: '1.0.0' }, position_ref: null, procedure_ref: null },
      when: iso(CLOCK),
      purpose: { why: '检索', for_work_or_decision_ref: { refType: 'REC-WORK-09', refId: 'work-9', refVersion: '1.0.0' } },
      layer_and_entries: { domain: 'personal' as const, entry_refs: [{ refType: 'REC-MEM-01' as const, refId: 'ghost', refVersion: '1.0.0' }] },
      authority_ref: { basis_ref: basisOf(w), expires_at: iso(CLOCK + 86_400_000) },
      result: 'provided' as const,
    }
    expect(() => w.memory.auditAccess({ company: w.company, payload })).toThrow(
      /CONFIG_INVALID\/store\/hist:memory-audit-entry-missing/,
    )
    expect(audits(w.company)).toHaveLength(0)
  })

  it('定向读跨域→拒（REC-MEM-02 单域；不写半条审计）', () => {
    const w = world('read-domain-mixed')
    expect(() =>
      w.memory.read({ company: w.company, scope: 'ENG-1', entryRefs: [basisOfEntry(w.mem1), basisOfEntry(w.memWork)] }, ctx(w)),
    ).toThrow(/CONFIG_INVALID\/store\/hist:memory-domain-mixed/)
    expect(audits(w.company)).toHaveLength(0)
  })
})

/** 条目引用形（只取 refId；面按在册记录复核类型/公司，不信任调用方版本串） */
function basisOfEntry(recordId: string): RecordRef {
  return { refType: 'REC-MEM-01', refId: recordId, refVersion: '1.0.0' }
}
