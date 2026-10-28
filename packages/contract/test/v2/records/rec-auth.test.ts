/**
 * rec-auth.test.ts —— AUTH 权责族「一族一正一负」（MIG-03 / IMPL-03-01；NEG-REC-01 底行）
 *
 * 依据：v2/17 §3.4（AUTH 权责 16：NEG-REC-01 权源冒充/代批/围栏代次互推/镜像升权威，V1·case＋V3·int——
 *   本文件只落 **V1 形状腿**）＋§4.1 NEG-REC-01 行；v2/11 §2.2（AUTH-01..08 字段表/不变量）、
 *   §〇.4（幂等/版本）、§〇.5（生效槽：pending 时 payload effective_time 必须为空）、§〇.2-1（具名决定者）。
 *
 * 纪律：只断言形状与拒绝条件；不跑真机、不打桩 LLM（V3 腿归 07-06/07-10）。
 */
import { describe, expect, it } from 'vitest'
import {
  validateAuthExercise,
  validateAuthGrant,
  validateAuthWithdrawal,
  validateAuthorityActivation,
  validateCredentialReference,
  validateIncapacityDecision,
} from '../../../src/records/auth.ts'
import {
  AT,
  activationPayload,
  credentialPayload,
  delegationGrantPayload,
  envelope,
  exercisePayload,
  fencePayload,
  incapacityPayload,
  issuePaths,
  leasePayload,
  rootGrantPayload,
  withdrawalPayload,
} from './fixtures.ts'

const ROOT_RESOLVED = { grantorClass: 'external_owner', proofVerified: true, fingerprintMatches: true } as const

describe('AUTH-01 授予/转授边（正例）', () => {
  it('根授予：外部老板签发＋指纹＋签名或离线批准件＋proof_mode=ritual_and_key → 放行', () => {
    expect(validateAuthGrant(envelope('REC-AUTH-01', rootGrantPayload()), ROOT_RESOLVED)).toEqual({ ok: true })
  })

  it('普通转授：+2 链内逐级、父授予为 REC-AUTH-01、无根授予子类型字段 → 放行', () => {
    expect(validateAuthGrant(envelope('REC-AUTH-01', delegationGrantPayload()), { grantorClass: 'internal_boss', proofVerified: false, fingerprintMatches: false })).toEqual({
      ok: true,
    })
  })
})

describe('NEG-REC-01 权源冒充/代批：授权记录拒绝条件', () => {
  it('根授予两件证明都缺（无签名且无离线批准件）→ 拒（根授予不成立）', () => {
    const payload = rootGrantPayload()
    delete payload['external_signature']
    const outcome = validateAuthGrant(envelope('REC-AUTH-01', payload), ROOT_RESOLVED)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.external_signature')
  })

  it('根授予 proof_mode=record_only → 拒（ENU-138：root 恒 ritual_and_key）', () => {
    const outcome = validateAuthGrant(envelope('REC-AUTH-01', rootGrantPayload({ proof_mode: 'record_only' })), ROOT_RESOLVED)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.proof_mode')
  })

  it('普通转授填根授予子类型字段 → 拒（其余类型禁填）', () => {
    const outcome = validateAuthGrant(
      envelope('REC-AUTH-01', delegationGrantPayload({ key_fingerprint: 'sha256:root-fp' })),
      { grantorClass: 'internal_boss', proofVerified: false, fingerprintMatches: false },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.key_fingerprint')
  })

  it('普通转授的 parent_grant 不是 REC-AUTH-01 → 拒（根链/父链须可解析）', () => {
    const outcome = validateAuthGrant(
      envelope('REC-AUTH-01', delegationGrantPayload({ parent_grant: { refType: 'REC-DEC-01', refId: 'dec-1', refVersion: '1.0.0' } })),
      { grantorClass: 'internal_boss', proofVerified: false, fingerprintMatches: false },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.parent_grant.refType')
  })
})

describe('AUTH-02 授权行使（正例＋拒绝条件）', () => {
  it('对照面：最高宰相以内部老板身份行 root（引 root_delegation、withheld_scope 空）→ 放行', () => {
    const outcome = validateAuthExercise(
      envelope('REC-AUTH-02', exercisePayload({ on_behalf_of: 'internal_boss', root_use: true, root_delegation_ref: { refType: 'REC-AUTH-01', refId: 'root-1', refVersion: '1.0.0' } })),
      { actorClass: 'internal_boss' },
    )
    expect(outcome).toEqual({ ok: true })
  })

  it('root_use 为真却未附 root_delegation_ref → 拒（§2.2）', () => {
    const outcome = validateAuthExercise(envelope('REC-AUTH-02', exercisePayload({ root_use: true })), { actorClass: 'internal_boss' })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.root_delegation_ref')
  })

  it('internal_boss 行使却留非空 withheld_scope → 拒（ENU-139）', () => {
    const outcome = validateAuthExercise(
      envelope('REC-AUTH-02', exercisePayload({ on_behalf_of: 'internal_boss', root_use: true, root_delegation_ref: { refType: 'REC-AUTH-01', refId: 'root-1', refVersion: '1.0.0' }, withheld_scope: ['appoint_g8'] })),
      { actorClass: 'internal_boss' },
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.withheld_scope')
  })
})

describe('AUTH-03 授权撤回（后代枚举＋停用证据）', () => {
  it('对照面：root 撤回且后代全集被枚举（含 root 指纹项）→ 放行', () => {
    const payload = withdrawalPayload({
      reason: 're_assignment',
      successor_grant: { refType: 'REC-AUTH-01', refId: 'root-2', refVersion: '1.0.0' },
      descendants: [
        {
          descendant_type: 'root_key',
          identity_ref: 'desc-root-key',
          credential: { credential_class: 'root', logical_reference: 'cred-root.company-a' },
          deactivation_evidence: 'old root 签名失效确认',
          reconcile_entry: 'reconcile:desc-root-key',
        },
        {
          descendant_type: 'sub_agent',
          identity_ref: 'desc-1',
          credential: { credential_class: 'scoped', logical_reference: 'cred-scoped-1' },
          deactivation_evidence: '撤销回执',
          reconcile_entry: 'reconcile:desc-1',
        },
      ],
    })
    expect(validateAuthWithdrawal(envelope('REC-AUTH-03', payload), { knownDescendantIds: ['desc-root-key', 'desc-1'] })).toEqual({ ok: true })
  })

  it('root 撤回缺派生登记侧已知后代 → 拒（后代未全停不得记完成——I-6）', () => {
    const outcome = validateAuthWithdrawal(envelope('REC-AUTH-03', withdrawalPayload()), { knownDescendantIds: ['desc-1', 'desc-2'] })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.descendants')
  })

  it('无后代却无显式确认方法 → 拒（不得留空视为零）', () => {
    const outcome = validateAuthWithdrawal(envelope('REC-AUTH-03', withdrawalPayload({ descendants: [] })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.deactivation_evidence.no_descendant_confirmation')
  })

  it('改授/轮换未写 successor_grant → 拒（轮换时必填）', () => {
    const outcome = validateAuthWithdrawal(envelope('REC-AUTH-03', withdrawalPayload({ reason: 're_assignment' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.successor_grant')
  })

  it('pending 却回填实际生效时刻 → 拒（§0.5：预计起点不得回填为实际生效时间）', () => {
    const outcome = validateAuthWithdrawal(
      envelope('REC-AUTH-03', withdrawalPayload(), { effectiveState: 'pending', effectiveTime: { from: AT } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.effective_time')
  })
})

describe('AUTH-04 凭据逻辑引用（无值；类别不原地升级）', () => {
  it('对照面：scoped 凭据挂普通转授、逻辑引用非路径非值 → 放行', () => {
    const outcome = validateCredentialReference(
      envelope('REC-AUTH-04', credentialPayload({ credential_class: 'scoped', logical_reference: 'cred-scoped-1', permitted_operations: ['write_comment'] })),
      { holderClass: 'internal_position', boundGrantClass: 'delegation' },
    )
    expect(outcome).toEqual({ ok: true })
  })

  it('逻辑引用带路径分隔符 → 拒（非路径）', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload({ logical_reference: '/etc/root-key' })), {
      holderClass: 'internal_boss',
      boundGrantClass: 'root_delegation',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.logical_reference')
  })

  it('逻辑引用承载秘密值形态 → 拒（秘密值永不入库）', () => {
    const outcome = validateCredentialReference(envelope('REC-AUTH-04', credentialPayload({ logical_reference: 'sk-live-abc123' })), {
      holderClass: 'internal_boss',
      boundGrantClass: 'root_delegation',
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.logical_reference')
  })
})

describe('AUTH-05/06/07/08 形状与不变量', () => {
  it('租约/围栏观测形状可校验（正例）', () => {
    expect(envelope('REC-AUTH-05', leasePayload()).recordType).toBe('REC-AUTH-05')
    expect(envelope('REC-AUTH-06', fencePayload()).payload).toEqual(fencePayload())
  })

  it('权威激活：代次递增（前任 1 → 本次 2）→ 放行', () => {
    expect(validateAuthorityActivation(envelope('REC-AUTH-07', activationPayload()))).toEqual({ ok: true })
  })

  it('权威激活：代次不递增（回退不新起代次）→ 拒', () => {
    const outcome = validateAuthorityActivation(envelope('REC-AUTH-07', activationPayload({ activation_generation: 1 })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.activation_generation')
  })

  it('失能判定：异议由被判主体自设 → 拒（不得由被判主体自设异议位置）', () => {
    const outcome = validateIncapacityDecision(envelope('REC-AUTH-08', incapacityPayload()), { dissentAuthoredBySubject: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.dissent_position')
  })

  it('失能判定：对照面（具名判者、恢复前提齐、异议非自设）→ 放行', () => {
    expect(validateIncapacityDecision(envelope('REC-AUTH-08', incapacityPayload()))).toEqual({ ok: true })
  })
})

describe('信封骨架（§〇.2-1/§〇.5）：AUTH 族的全族前置闸', () => {
  it('决定者写「daemon」→ 拒（框架/系统/平台/流程/daemon/监控/自动策略不得作决定者）', () => {
    const outcome = validateAuthGrant(
      envelope('REC-AUTH-01', rootGrantPayload(), { producer: { decidedBy: 'daemon', writtenBy: 'daemon:records' } }),
      ROOT_RESOLVED,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('producer.decidedBy')
  })

  it('信封 recordType 与 schema 不一致 → 拒（一事件一身份）', () => {
    const outcome = validateAuthGrant(envelope('REC-AUTH-04', rootGrantPayload()), ROOT_RESOLVED)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('pending 却缺信封 effectiveTime → 拒（§0.5：pending/effective 必填）', () => {
    const outcome = validateAuthGrant(
      envelope('REC-AUTH-01', rootGrantPayload(), { effectiveState: 'pending', effectiveTime: undefined }),
      ROOT_RESOLVED,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('effectiveTime')
  })
})
