/**
 * ops-memory —— assembleOps 记忆访问面接线（studio-dev-538：REC-MEM-02 访问留痕落库）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/08 §3.3（每次访问留审计痕；访问被拒也是审计事件）；docs/v2/11 §十三（REC-MEM-02）；
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口）／§1.8（PORT-OPS 装配面）；
 *   - docs/17-§2（装配面不改主循环相位——runServe 不自动触发访问）。
 *
 * 断言面（真 SQLite 台账 + 真 assembleOps 装配）：
 *   ① 装配日志显式（启动日志证据锚：记忆访问面已装配）；
 *   ② assembly.memory 写→REC-MEM-01 与 REC-MEM-02 同事务落库（provided，entry_refs 指向本条）；
 *   ③ assembly.memory 读→第二条 REC-MEM-02；越权读→denied 审计先落再拒。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger, type MemoryAccessContext } from '@studio-next/store'
import { assembleOps, type OpsAssembly } from '../../../src/assembly/ops/index.ts'

const AT = '2026-11-01T00:00:00.000Z'
const CLOCK_MS = Date.parse(AT)
const COMPANY = 'demo'
const GRANT_ID = 'grant-1'

let dir = ''
let ledger: Ledger
let assembly: OpsAssembly
let logs: string[] = []
let seq = 0

const iso = (ms: number): string => new Date(ms).toISOString()

function grantPayload(): Record<string, unknown> {
  return {
    grantor: { refId: 'G9.internal-boss', refVersion: '1.0.0' },
    grantee: { refId: 'ENG-1', refVersion: '1.0.0' },
    parent_grant: { refType: 'REC-AUTH-01', refId: 'grant-root', refVersion: '1.0.0' },
    grant_class: 'delegation',
    scope: { purpose: 'memory-access', object: 'REC-MEM-01', included: ['ENG-1'], forbidden: ['越权读'] },
    conditions: [],
    term: { from: iso(CLOCK_MS - 86_400_000), to: iso(CLOCK_MS + 86_400_000) },
    delegable: false,
    withdrawal_terms: '到期即失效',
    conflict_check_ref: { refType: 'REC-LIFE-05', refId: 'conflict-1', refVersion: '1.0.0' },
  }
}

function memoryEntry(recordId: string, ownerScope: string): Record<string, unknown> {
  const at = iso(CLOCK_MS)
  return {
    recordId,
    recordType: 'REC-MEM-01',
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: COMPANY,
    producedAt: at,
    producer: { decidedBy: 'ENG-1', writtenBy: 'test' },
    basisRefs: [],
    payload: {
      domain: 'personal',
      personal_subtype: 'fact',
      owner_scope: ownerScope,
      source_refs: [{ refType: 'REC-EVT-01', refId: 'event-1', refVersion: '1.0.0' }],
      observation_vs_interpretation: { observation: '观察到一次失败', interpretation: '可能是环境问题' },
      formed_at: at,
      valid_at: at,
      review_at: iso(CLOCK_MS + 86_400_000),
      confidence: 'medium',
      knowledge_scope: 'task:STUDIO-538',
      correction_lineage: [],
      disputed: false,
    },
    effectiveState: 'effective',
    effectiveTime: { from: at },
  }
}

function ctx(scope: string): MemoryAccessContext {
  return {
    scope,
    who: { holderRef: { refId: 'ENG-1', refVersion: '1.0.0' }, positionRef: null, procedureRef: null },
    purpose: {
      why: '验收遗留检索',
      forWorkOrDecisionRef: { refType: 'REC-WORK-09', refId: 'work-1', refVersion: '1.0.0' },
    },
    authority: { basisRef: { refType: 'REC-AUTH-01', refId: GRANT_ID, refVersion: '1.0.0' }, expiresAt: iso(CLOCK_MS + 86_400_000) },
    when: AT,
  }
}

function auditRows(): Array<{ record_id: string; result: string; entryRefs: string[] }> {
  const rows = ledger.db
    .prepare("SELECT record_id, payload FROM records WHERE company = ? AND record_type = 'REC-MEM-02' ORDER BY produced_at ASC, record_id ASC")
    .all(COMPANY) as Array<{ record_id: string; payload: string }>
  return rows.map((row) => {
    const payload = JSON.parse(row.payload) as { result: string; layer_and_entries: { entry_refs: Array<{ refId: string }> } }
    return { record_id: row.record_id, result: payload.result, entryRefs: payload.layer_and_entries.entry_refs.map((ref) => ref.refId) }
  })
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-ops-memory-'))
  ledger = openLedger(path.join(dir, 'ledger.db'))
  logs = []
  assembly = assembleOps({
    ledger,
    makeId: () => `id-${++seq}`,
    now: () => AT,
    log: (line) => logs.push(line),
  })
})

afterAll(async () => {
  ledger.close()
  await rm(dir, { recursive: true, force: true })
})

describe('assembleOps 记忆访问面（studio-dev-538）', () => {
  it('装配日志显式＋授权依据落库（启动日志证据锚）', () => {
    expect(assembly.memory).toBeDefined()
    expect(logs.some((line) => line.includes('记忆访问面已装配'))).toBe(true)
    assembly.hist.append({
      recordId: GRANT_ID,
      recordType: 'REC-AUTH-01',
      schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
      specVersion: '2.0.0',
      companyRef: COMPANY,
      producedAt: iso(CLOCK_MS - 1_000),
      producer: { decidedBy: 'G9.internal-boss', writtenBy: 'test' },
      basisRefs: [],
      payload: grantPayload(),
      effectiveState: 'effective',
      effectiveTime: { from: iso(CLOCK_MS - 1_000) },
    })
  })

  it('写→REC-MEM-01＋REC-MEM-02 同事务；读→第二条审计；越权读→denied 先落再拒', () => {
    const entryId = 'entry-1'
    const written = assembly.memory.write(memoryEntry(entryId, 'ENG-1'), ctx('ENG-1'))
    expect(written.recordType).toBe('REC-MEM-01')
    expect(auditRows()).toEqual([{ record_id: expect.stringMatching(/^id-/), result: 'provided', entryRefs: [entryId] }])

    const read = assembly.memory.read(
      { company: COMPANY, scope: 'ENG-1', entryRefs: [{ refType: 'REC-MEM-01', refId: entryId, refVersion: '1.0.0' }] },
      ctx('ENG-1'),
    )
    expect(read.entries.map((record) => record.recordId)).toEqual([entryId])
    expect(auditRows()).toHaveLength(2)
    expect(auditRows()[1]).toMatchObject({ result: 'provided', entryRefs: [entryId] })

    expect(() =>
      assembly.memory.read(
        { company: COMPANY, scope: 'ENG-2', entryRefs: [{ refType: 'REC-MEM-01', refId: entryId, refVersion: '1.0.0' }] },
        ctx('ENG-1'),
      ),
    ).toThrow(/CONFIG_INVALID\/store\/hist:memory-scope-denied/)
    expect(auditRows()).toHaveLength(3)
    expect(auditRows()[2]).toMatchObject({ result: 'denied', entryRefs: [entryId] })
  })
})
