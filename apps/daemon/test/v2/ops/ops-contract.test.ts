/**
 * ops-contract —— OPS 补形 A 契约面（类型钉子＋信封映射纯函数）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.8（PORT-OPS 请求形状）、docs/v2/11 §〇/§六 REC-WORK-18、
 *     docs/v2/10 §4.1（schemaRef/specVersion）、docs/49「OPS 补形 A」。
 *
 * 形状正/负由 `ops-shape-pins.ts` 在 typecheck:v2 编译期钉住（缺 actions/review/notified、
 * 裸名串缺 refVersion、预设边界缺 boundaryRecordRef 均编译失败）；本文件只证钉子件可导入、
 * 契约常量在位，并验信封映射纯函数（确定性/决定者还原/证据边界）。
 */
import { describe, expect, it } from 'vitest'
import { OPS_AUTHORITY_SOURCE, PORT_OPS } from '@studio-next/contract'
import {
  OPS_EFFECT_ON_ORIGINAL_TEXT,
  OPS_RECORD_SCHEMA_REF,
  OPS_RECORD_SPEC_VERSION,
  OPS_RECORD_WRITTEN_BY,
  opsStopEnvelope,
} from '../../../src/assembly/ops/index.ts'
import type { OpsStopRecord } from '../../../src/control/stop-channel.ts'
import { compileOnlyOpsShapePins } from './ops-shape-pins.ts'

const AT = '2026-11-01T00:00:00.000Z'
const DUE = '2026-11-02T00:00:00.000Z'

function stopRecord(overrides: Partial<OpsStopRecord> = {}): OpsStopRecord {
  return {
    recordType: 'REC-WORK-18',
    recordId: 'REC-WORK-18:envelope-1',
    version: 1,
    company: 'demo',
    at: AT,
    kind: 'emergency_stop',
    reason: '现场最小止损',
    authorizationRef: 'REC-DEC-01',
    trigger: 'REC-WORK-17',
    boundaryRef: { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [{ refId: 'evidence-1', refVersion: '1.0.0' }],
    notified: [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }],
    review: { position: 'audit-1', due: DUE, conclusion: '未完成（复核待作）' },
    effectOnOriginal: { retroactiveApproval: false, equalsRecovery: false, normalizable: false },
    outcome: 'unknown',
    gaps: [],
    signature: { actorKind: 'control', actorRef: 'ctl:ops', decisionRef: 'REC-DEC-01' },
    ...overrides,
  }
}

describe('OPS 补形 A 契约常量与类型钉子', () => {
  it('类型级钉子件可加载（缺 actions/review/notified 等在 typecheck:v2 编译期拒）', () => {
    expect(typeof compileOnlyOpsShapePins).toBe('function')
  })

  it('PORT-OPS 身份不变：端口名＋供能来源单向（自身不新增权源）', () => {
    expect(PORT_OPS).toBe('PORT-OPS')
    expect(OPS_AUTHORITY_SOURCE).toBe('PORT-AUTH')
  })
})

describe('OpsStopRecord → REC-WORK-18 信封映射（纯函数）', () => {
  it('信封全字段：schemaRef/specVersion/companyRef/producedAt/producer/生效槽＋payload 八字段', () => {
    const envelope = opsStopEnvelope(stopRecord())
    expect(envelope.recordId).toBe('REC-WORK-18:envelope-1')
    expect(envelope.recordType).toBe('REC-WORK-18')
    expect(envelope.schemaRef).toEqual(OPS_RECORD_SCHEMA_REF)
    expect(envelope.specVersion).toBe(OPS_RECORD_SPEC_VERSION)
    expect(envelope.companyRef).toBe('demo')
    expect(envelope.producedAt).toBe(AT)
    expect(envelope.producer).toEqual({ decidedBy: 'ctl:ops', writtenBy: OPS_RECORD_WRITTEN_BY })
    expect(envelope.basisRefs).toEqual([])
    expect(envelope.effectiveState).toBe('effective')
    expect(envelope.effectiveTime).toEqual({ from: AT })
    expect(envelope.payload).toEqual({
      trigger: 'REC-WORK-17',
      boundary_ref: { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' },
      actions_taken: ['停止对外写入'],
      not_authorized: ['未进入禁止面'],
      evidence_preserved: [{ refId: 'evidence-1', refVersion: '1.0.0' }],
      notified: [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }],
      independent_review: { position: 'audit-1', deadline: DUE, conclusion: '未完成（复核待作）' },
      effect_on_original: OPS_EFFECT_ON_ORIGINAL_TEXT,
    })
  })

  it('确定性：同输入两次映射逐字段相等（重放可判等——幂等前提）', () => {
    expect(opsStopEnvelope(stopRecord())).toEqual(opsStopEnvelope(stopRecord()))
  })

  it('system 代写：decidedBy 取 onBehalfOf（可还原决定人），不把通道位当决定者', () => {
    const envelope = opsStopEnvelope(
      stopRecord({ signature: { actorKind: 'system', actorRef: 'daemon', onBehalfOf: 'G9.internal-boss' } }),
    )
    expect(envelope.producer.decidedBy).toBe('G9.internal-boss')
  })

  it('真实缺口进 proofBoundary（证明什么/不证明什么/缺口逐条），不塞进 payload', () => {
    const envelope = opsStopEnvelope(stopRecord({ gaps: ['围栏机制未证（mechanismProven=false）——不得宣称旧写入者已被冻结'] }))
    expect(envelope.proofBoundary).toContain('显式缺口')
    expect(envelope.proofBoundary).toContain('围栏机制未证')
    expect(Object.keys(envelope.payload)).toHaveLength(8)
  })

  it('无预设边界：boundary_ref 恒 null（不臆造引用）', () => {
    const envelope = opsStopEnvelope(stopRecord({ boundaryRef: null, kind: 'circuit_break' }))
    expect(envelope.payload.boundary_ref).toBeNull()
  })
})
