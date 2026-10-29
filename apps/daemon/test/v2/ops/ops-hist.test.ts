/**
 * ops-hist —— OPS 补形 A 记录落库面（REC-WORK-18 → PORT-HIST append）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.6（PORT-HIST 唯一记录写口）/§1.8（PORT-OPS 请求形状）、
 *     docs/v2/11 §〇（信封）/§0.4（同 recordId/幂等键重放＝返回既有、异内容＝拒）/
 *     §六 REC-WORK-18；docs/v2/10 §4.1（schemaRef/specVersion）；
 *   - docs/49「OPS 补形 A」（决定 A：落完整记录、不臆造版本；写口失败 fail-closed）。
 *
 * 断言面：真 SQLite 台账 + 真 createHistFace——信封映射全字段可回读；同 recordId 幂等
 * （第二次 appended=false，不产生第二行）；同 id 异内容＝conflict；坏版本＝unavailable；
 * 三不入·库闸拒写＝fail-closed（未落库）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallContext, CircuitBreakRequest, EmergencyStopRequest, OpsRef, OpsRecordRef, StopReceipt } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { assembleOps, OPS_RECORD_SCHEMA_REF, OPS_RECORD_SPEC_VERSION, OPS_RECORD_WRITTEN_BY, type OpsAssembly } from '../../../src/assembly/ops/index.ts'
import type { OpsStopRecord } from '../../../src/control/stop-channel.ts'

const AT = '2026-11-01T00:00:00.000Z'
const DUE = '2026-11-02T00:00:00.000Z'
const COMPANY = 'demo'

const BOUNDARY_REF: OpsRecordRef = { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' }

function ref(refId: string, refVersion = '1.0.0'): OpsRef {
  return { refId, refVersion }
}

function opsContext(): CallContext {
  return {
    company: { companyId: 'company-demo', slug: COMPANY },
    caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
    authority: [],
    signature: { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
  }
}

function stopRequest(overrides: Record<string, unknown> = {}): EmergencyStopRequest {
  return {
    authorization: { poweredBy: 'decision', decisionRef: 'REC-DEC-01' },
    reason: '现场最小止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: true, boundaryRef: 'boundary-1', boundaryRecordRef: BOUNDARY_REF, permittedActions: ['停止对外写入'] },
    actionsTaken: ['停止对外写入', '冻结出工段'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [ref('evidence-1')],
    notified: [ref('G9.internal-boss')],
    review: { reviewerRef: 'audit-1', due: DUE },
    ...overrides,
  } as unknown as EmergencyStopRequest
}

function breakRequest(overrides: Record<string, unknown> = {}): CircuitBreakRequest {
  return {
    authorization: { poweredBy: 'policy_verdict', commandRef: 'REC-AUTH-02', verdict: 'permitted' },
    reason: '止损围栏',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence: { scope: ['executors'], stopInjection: true, revokeDerived: false, mechanismProven: false },
    triggerRef: 'REC-WORK-17',
    actionsTaken: ['冻结旧写入者'],
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: [ref('evidence-2')],
    notified: [ref('G9.internal-boss')],
    review: { reviewerRef: 'audit-2', due: DUE },
    ...overrides,
  } as unknown as CircuitBreakRequest
}

function stopRecord(overrides: Partial<OpsStopRecord> = {}): OpsStopRecord {
  return {
    recordType: 'REC-WORK-18',
    recordId: 'REC-WORK-18-IDEM-1',
    version: 1,
    company: COMPANY,
    at: AT,
    kind: 'emergency_stop',
    reason: '现场最小止损',
    authorizationRef: 'REC-DEC-01',
    trigger: 'REC-WORK-17',
    boundaryRef: BOUNDARY_REF,
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [ref('evidence-1')],
    notified: [ref('G9.internal-boss')],
    review: { position: 'audit-1', due: DUE, conclusion: '未完成（复核待作）' },
    effectOnOriginal: { retroactiveApproval: false, equalsRecovery: false, normalizable: false },
    outcome: 'unknown',
    gaps: [],
    signature: { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
    ...overrides,
  }
}

let dir = ''
let ledger: Ledger
let assembly: OpsAssembly
let seq = 0

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-v2-ops-hist-'))
  ledger = openLedger(path.join(dir, 'ledger.db'))
  assembly = assembleOps({
    ledger,
    makeId: () => `REC-WORK-18-${String(++seq)}`,
    now: () => AT,
  })
})

afterAll(async () => {
  ledger.close()
  await rm(dir, { recursive: true, force: true })
})

describe('REC-WORK-18 信封映射 + PORT-HIST 落库可读', () => {
  it('emergencyStop 落库：信封全字段（schemaRef/specVersion/producer/生效槽）＋payload 八字段可回读', () => {
    const outcome = assembly.ops.emergencyStop(stopRequest(), opsContext())
    if (outcome.kind !== 'ok') throw new Error(`预期 Ok，收到 ${outcome.error.category}/${outcome.error.subcause}`)
    const receipt = outcome.value as StopReceipt
    const record = assembly.hist.get(receipt.recordId)
    expect(record).toBeDefined()
    expect(record?.recordType).toBe('REC-WORK-18')
    expect(record?.schemaRef).toEqual(OPS_RECORD_SCHEMA_REF)
    expect(record?.specVersion).toBe(OPS_RECORD_SPEC_VERSION)
    expect(record?.companyRef).toBe(COMPANY)
    expect(record?.producedAt).toBe(AT)
    expect(record?.producer).toEqual({ decidedBy: 'ctl:ops', writtenBy: OPS_RECORD_WRITTEN_BY })
    // v14 列集无 basis_refs 列——写面留空（不静默丢字段，授权引用登记在 proofBoundary）
    expect(record?.basisRefs).toEqual([])
    expect(record?.effectiveState).toBe('effective')
    expect(record?.effectiveTime).toEqual({ from: AT })
    expect(record?.proofBoundary).toContain('不证明')

    const payload = record?.payload as Record<string, unknown>
    expect(payload['trigger']).toBe('REC-WORK-17')
    expect(payload['boundary_ref']).toEqual(BOUNDARY_REF)
    expect(payload['actions_taken']).toEqual(['停止对外写入', '冻结出工段'])
    expect(payload['not_authorized']).toEqual(['未进入禁止面'])
    expect(payload['evidence_preserved']).toEqual([ref('evidence-1')])
    expect(payload['notified']).toEqual([ref('G9.internal-boss')])
    expect(payload['independent_review']).toEqual({ position: 'audit-1', deadline: DUE, conclusion: expect.stringContaining('未完成') })
    expect(payload['effect_on_original']).toBe('不追认原动作、不等于恢复、不推广为常态')

    // 读面查询（company 维）同句柄可见
    const rows = assembly.hist.query({ company: COMPANY, type: 'REC-WORK-18' })
    expect(rows.some((row) => row.recordId === receipt.recordId)).toBe(true)
  })

  it('circuitBreak 落库：boundary_ref=null、notified/review 具名；真实缺口写进 proofBoundary', () => {
    const outcome = assembly.ops.circuitBreak(breakRequest(), opsContext())
    if (outcome.kind !== 'ok') throw new Error(`预期 Ok，收到 ${outcome.error.category}/${outcome.error.subcause}`)
    const record = assembly.hist.get(outcome.value.recordId)
    expect(record).toBeDefined()
    const payload = record?.payload as Record<string, unknown>
    expect(payload['boundary_ref']).toBeNull()
    expect(payload['actions_taken']).toEqual(['冻结旧写入者'])
    expect(payload['notified']).toEqual([ref('G9.internal-boss')])
    expect(payload['independent_review']).toEqual({ position: 'audit-2', deadline: DUE, conclusion: expect.stringContaining('未完成') })
    // gaps 只列真实未证项；proofBoundary 显式承载（记录不隐藏缺口）
    expect(record?.proofBoundary).toContain('显式缺口')
    expect(record?.proofBoundary).toContain('无预设紧急边界')
    expect(record?.proofBoundary).toContain('围栏机制未证')
    // 无「请求形状无槽位」式缺口
    expect(record?.proofBoundary).not.toContain('请求形状')
    expect(record?.proofBoundary).not.toContain('端口形状')
  })
})

describe('幂等与错误分类（同 recordId 重放不产生第二行；冲突/坏形不冒 Ok）', () => {
  it('同 recordId 同内容：第一次 appended=true，第二次 appended=false（返回既有，不产生第二行）', () => {
    const record = stopRecord()
    const before = assembly.hist.query({ company: COMPANY, type: 'REC-WORK-18' }).length
    const first = assembly.appendRecord(record)
    expect(first).toEqual({ recordId: record.recordId, recordType: 'REC-WORK-18', appended: true })
    const second = assembly.appendRecord(record)
    expect(second).toEqual({ recordId: record.recordId, recordType: 'REC-WORK-18', appended: false })
    expect(assembly.hist.query({ company: COMPANY, type: 'REC-WORK-18' }).length).toBe(before + 1)
    expect(assembly.hist.get(record.recordId)?.payload).toMatchObject({ trigger: record.trigger })
  })

  it('同 recordId 异内容 → 抛分类 conflict（ops-record-conflict；不改写既有行）', () => {
    const record = stopRecord({ recordId: 'REC-WORK-18-IDEM-2' })
    assembly.appendRecord(record)
    let failure: unknown
    try {
      assembly.appendRecord(stopRecord({ recordId: 'REC-WORK-18-IDEM-2', trigger: 'REC-WORK-17-CHANGED' }))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    const classified = failure as { opsWrite?: { category?: string; subcause?: string } }
    expect(classified.opsWrite?.category).toBe('conflict')
    expect(classified.opsWrite?.subcause).toBe('ops-record-conflict')
    expect((assembly.hist.get('REC-WORK-18-IDEM-2')?.payload as { trigger: string }).trigger).toBe('REC-WORK-17')
  })

  it('引用版本非 semver → 抛分类 unavailable（ops-record-invalid；记录形状拒收未落库）', () => {
    const record = stopRecord({ recordId: 'REC-WORK-18-BAD-REF', notified: [ref('G9.internal-boss', 'v1')] })
    let failure: unknown
    try {
      assembly.appendRecord(record)
    } catch (error) {
      failure = error
    }
    const classified = failure as { opsWrite?: { category?: string; subcause?: string } }
    expect(classified.opsWrite?.category).toBe('unavailable')
    expect(classified.opsWrite?.subcause).toBe('ops-record-invalid')
    expect(assembly.hist.get(record.recordId)).toBeUndefined()
  })

  it('三不入·库闸拒写 → fail-closed（ops-record-unmapped；未落库）', () => {
    const guarded = assembleOps({
      ledger,
      makeId: () => 'REC-WORK-18-GUARDED',
      now: () => AT,
      guardRecord: () => {
        throw new Error('outbound-gate: known secret in record')
      },
    })
    let failure: unknown
    try {
      guarded.appendRecord(stopRecord({ recordId: 'REC-WORK-18-GUARDED' }))
    } catch (error) {
      failure = error
    }
    const classified = failure as { opsWrite?: { category?: string; subcause?: string } }
    expect(classified.opsWrite?.category).toBe('unavailable')
    expect(classified.opsWrite?.subcause).toBe('ops-record-unmapped')
    expect(guarded.hist.get('REC-WORK-18-GUARDED')).toBeUndefined()
  })
})
