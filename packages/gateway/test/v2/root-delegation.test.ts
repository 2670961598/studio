/**
 * root-delegation.test.ts —— root_delegation 验签/指纹/期限/范围 preflight（SEC-ROOT-02..05）
 *
 * 依据：v2/15 §七（7.3 启动验签五步、7.4 scoped 不得升 root、7.5 撤回/轮换无宽限、7.6 四硬拒绝）；
 *   v2/17 §4.1 NEG-ORG-09（无有效 root_delegation）/10（撤回轮换后旧签名）/11（子 agent 持 root）/
 *   12（root 超范围）；v2/11 §2.2（REC-AUTH-01/03 形状——本套件只造判定所需字段）；
 *   docs/plan/05 IMPL-07-06（「无 root_delegation 拒启/撤回后旧 root 签名拒（NEG-ORG-09/10 启动腿）」）。
 *
 * 断言口径：构造期失败＝CONFIG_INVALID 抛错（对象不产出）；运行期 preflight 拒绝＝纯码不抛
 * （与 gateway 两级错误口径一致：配置错抛、运行错返码）。
 */
import { describe, expect, it } from 'vitest'
import {
  createRootDelegationGate,
  readRootDelegation,
  rootKeyFingerprint,
  type RootActionRequest,
  type RootDelegationOptions,
} from '../../src/root-delegation.ts'
import { CONTROL_TICKET, createGateway } from '../../src/gateway.ts'
import type { SignatureContext } from '../../src/signature.ts'

const AT = '2026-06-01T00:00:00Z'
const AT_MS = Date.parse(AT)
const AT_ISO = new Date(AT_MS).toISOString()
const TERM = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
const ROOT_MATERIAL = new TextEncoder().encode('root-key-material-v1-never-logged')
const ROOT_FP = rootKeyFingerprint(ROOT_MATERIAL)
const ROTATED_FP = rootKeyFingerprint(new TextEncoder().encode('root-key-material-v2-rotated'))
const CTX: SignatureContext = { company: '测试公司', dept: 'departments/平台部', role: 'daemon', level: 2 }

/** REC-AUTH-01 根授予记录（只造判定消费的字段；形状闸归 contract v2/11 §2.2） */
function rootGrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    grantor: { refId: 'external-owner', refVersion: '1.0.0' },
    grantee: { refId: 'g9.internal-boss', refVersion: '1.0.0' },
    parent_grant: { refType: 'REC-LIFE-07', refId: 'founding-record-1', refVersion: '1.0.0' },
    grant_class: 'root_delegation',
    scope: {
      purpose: '以内部老板身份签发内部硬动作',
      object: '经营权限',
      included: ['approve_internal_hard_action', 'appoint_g8'],
      forbidden: ['外部审计', '清算'],
    },
    conditions: [],
    term: TERM,
    delegable: true,
    withdrawal_terms: '外部老板随时撤回/轮换；后代停用为完成条件',
    conflict_check_ref: { refType: 'REC-LIFE-05', refId: 'conflict-1', refVersion: '1.0.0' },
    key_fingerprint: ROOT_FP,
    external_signature: { refId: 'signature-artifact-1' },
    proof_mode: 'ritual_and_key',
    external_veto_configured: false,
    ...overrides,
  }
  return {
    recordId: 'root-grant-1',
    recordType: 'REC-AUTH-01',
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'company-a',
    producedAt: AT,
    producer: { decidedBy: 'external-owner', writtenBy: 'daemon:records' },
    basisRefs: [],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: '2026-01-01T00:00:00Z' },
  }
}

/** REC-AUTH-03 撤回/轮换记录（只造撤回目标字段） */
function withdrawal(targetId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'withdrawal-1',
    recordType: 'REC-AUTH-03',
    payload: {
      withdrawn_grant: { refType: 'REC-AUTH-01', refId: targetId, refVersion: '1.0.0' },
      reason: 'active_withdrawal',
      withdrawn_grant_class: 'root_delegation',
      effective_time: AT,
    },
    effectiveState: 'effective',
    ...overrides,
  }
}

function options(over: Record<string, unknown> = {}): RootDelegationOptions {
  return {
    delegation: rootGrant(),
    trustedFingerprint: ROOT_FP,
    proofVerified: true,
    grantorClass: 'external_owner',
    actorClass: 'internal_boss',
    credentialClass: 'root',
    clock: (): number => AT_MS,
    ...over,
  } as RootDelegationOptions
}

const IN_SCOPE: RootActionRequest = { actionScope: ['appoint_g8'], signerFingerprint: ROOT_FP }

/** 捕获构造期异常消息（断言 CONFIG_INVALID/子码） */
function constructError(over: Record<string, unknown>): string {
  try {
    createRootDelegationGate(options(over))
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望构造期抛 CONFIG_INVALID，实际装配成功（「无委任不得落成可签发状态」被破坏）')
}

function preflightOf(over: Record<string, unknown>, request: RootActionRequest = IN_SCOPE) {
  return createRootDelegationGate(options(over)).preflight(request)
}

describe('SEC-ROOT-02 正例：有效 root_delegation 才落成可签发状态', () => {
  it('外部老板签发＋ritual_and_key＋指纹相符＋有效期内 → 装配成功且范围内动作放行', () => {
    const gate = createRootDelegationGate(options())
    expect(gate.delegationRef).toBe('root-grant-1')
    expect(gate.fingerprint).toBe(ROOT_FP)
    expect(gate.preflight(IN_SCOPE)).toEqual({ allowed: true, delegationRef: 'root-grant-1', fingerprint: ROOT_FP, at: AT_ISO })
  })

  it('指纹是单向散列（sha256: 前缀，不等于钥材料；换钥即换指纹）', () => {
    expect(ROOT_FP).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(ROOT_FP).not.toBe(new TextDecoder().decode(ROOT_MATERIAL))
    expect(rootKeyFingerprint(ROOT_MATERIAL)).toBe(ROOT_FP)
    expect(ROOT_FP).not.toBe(ROTATED_FP)
  })

  it('readRootDelegation：只读判定字段（坏记录返回 undefined，供 fail-closed 判拒）', () => {
    expect(readRootDelegation(rootGrant())?.includedScope).toEqual(['approve_internal_hard_action', 'appoint_g8'])
    expect(readRootDelegation({ recordId: 'x', payload: {} })).toBeUndefined()
    expect(readRootDelegation('not-a-record')).toBeUndefined()
  })
})

describe('NEG-ORG-09 无有效 root_delegation 的最高宰相', () => {
  it('启动腿：无委任（delegation 缺）→ CONFIG_INVALID/gw-root-no-delegation', () => {
    expect(constructError({ delegation: undefined })).toMatch(/CONFIG_INVALID\/gw-root-no-delegation/)
  })

  it('启动腿：记录不可读/非根授予子类型/未生效 → CONFIG_INVALID/gw-root-delegation-invalid', () => {
    expect(constructError({ delegation: { recordId: 'bad', payload: {} } })).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
    expect(constructError({ delegation: rootGrant({ grant_class: 'delegation' }) })).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
    const pending = rootGrant()
    pending['effectiveState'] = 'pending'
    expect(constructError({ delegation: pending })).toMatch(/CONFIG_INVALID\/gw-root-delegation-invalid/)
  })

  it('启动腿：授予人非外部老板 → CONFIG_INVALID/gw-root-grantor-ineligible', () => {
    expect(constructError({ grantorClass: 'internal_boss' })).toMatch(/CONFIG_INVALID\/gw-root-grantor-ineligible/)
  })

  it('启动腿：外部证明未核验/缺签名件/proof_mode=record_only → CONFIG_INVALID/gw-root-proof-unverified', () => {
    expect(constructError({ proofVerified: false })).toMatch(/CONFIG_INVALID\/gw-root-proof-unverified/)
    expect(constructError({ delegation: rootGrant({ external_signature: undefined }) })).toMatch(
      /CONFIG_INVALID\/gw-root-proof-unverified/,
    )
    expect(constructError({ delegation: rootGrant({ proof_mode: 'record_only' }) })).toMatch(
      /CONFIG_INVALID\/gw-root-proof-unverified/,
    )
  })

  it('启动腿：指纹不符（委任指纹 ≠ 当前信任指纹）→ CONFIG_INVALID/gw-root-fingerprint-mismatch', () => {
    expect(constructError({ trustedFingerprint: ROTATED_FP })).toMatch(/CONFIG_INVALID\/gw-root-fingerprint-mismatch/)
    expect(constructError({ trustedFingerprint: undefined })).toMatch(/CONFIG_INVALID\/gw-root-fingerprint-mismatch/)
  })

  it('未装配 root 面的网关：rootPreflight 恒拒 gw-root-no-delegation（「没配」≠「不用验」）', () => {
    const gateway = createGateway({ secret: SECRET, clock: (): number => AT_MS, ticket: CONTROL_TICKET, ctx: CTX, author: 'PRIME-0' })
    expect(gateway.rootPreflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-no-delegation' })
  })

  it('gateway 装配 root 面＝启动腿：坏委任即 CONFIG_INVALID，实例不产出', () => {
    expect(() =>
      createGateway({
        secret: SECRET,
        clock: (): number => AT_MS,
        ticket: CONTROL_TICKET,
        ctx: CTX,
        author: 'PRIME-0',
        root: options({ delegation: undefined }),
      }),
    ).toThrowError(/CONFIG_INVALID\/gw-root-no-delegation/)

    const gateway = createGateway({
      secret: SECRET,
      clock: (): number => AT_MS,
      ticket: CONTROL_TICKET,
      ctx: CTX,
      author: 'PRIME-0',
      root: options(),
    })
    expect(gateway.rootPreflight(IN_SCOPE)).toEqual({ allowed: true, delegationRef: 'root-grant-1', fingerprint: ROOT_FP, at: AT_ISO })
  })
})

describe('NEG-ORG-10 撤回/轮换后的旧 root 签名（无宽限窗口）', () => {
  it('启动腿：已有 REC-AUTH-03 撤回 → CONFIG_INVALID/gw-root-revoked', () => {
    expect(constructError({ withdrawals: [withdrawal('root-grant-1')] })).toMatch(/CONFIG_INVALID\/gw-root-revoked/)
  })

  it('运行期：撤回写入登记后「下一次 preflight 即拒」（在途动作不设宽限）', () => {
    const withdrawals: unknown[] = []
    const gate = createRootDelegationGate(options({ withdrawals: (): readonly unknown[] => withdrawals }))
    expect(gate.preflight(IN_SCOPE).allowed).toBe(true)
    withdrawals.push(withdrawal('root-grant-1'))
    expect(gate.preflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-revoked' })
  })

  it('撤回记录 pending（未生效）同样拒（fail-closed，不「等生效」）', () => {
    const pending = withdrawal('root-grant-1')
    pending['effectiveState'] = 'pending'
    const withdrawals: unknown[] = []
    const gate = createRootDelegationGate(options({ withdrawals: (): readonly unknown[] => withdrawals }))
    expect(gate.preflight(IN_SCOPE).allowed).toBe(true)
    withdrawals.push(pending)
    expect(gate.preflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-revoked' })
  })

  it('撤回别的授予（refId 不匹配）不误伤当前委任', () => {
    expect(preflightOf({ withdrawals: [withdrawal('other-grant')] }).allowed).toBe(true)
  })

  it('轮换腿：当前信任指纹换新 → 旧委任指纹不符即拒', () => {
    let trusted = ROOT_FP
    const gate = createRootDelegationGate(options({ trustedFingerprint: (): string => trusted }))
    expect(gate.preflight(IN_SCOPE).allowed).toBe(true)
    trusted = ROTATED_FP
    expect(gate.preflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-fingerprint-mismatch' })
  })

  it('轮换后旧钥签名仍拒：委任已换发新钥，而本次签名指纹是旧钥 → gw-root-stale-key', () => {
    const reissued = rootGrant({ key_fingerprint: ROTATED_FP })
    const verdict = preflightOf(
      { delegation: reissued, trustedFingerprint: ROTATED_FP },
      { actionScope: ['appoint_g8'], signerFingerprint: ROOT_FP },
    )
    expect(verdict).toEqual({ allowed: false, reason: 'gw-root-stale-key' })
  })
})

describe('NEG-ORG-11 子 agent/scoped 凭据不得行 root', () => {
  it('行使人非最高宰相（一级单元首长/部门首长/派生执行体）→ gw-root-actor-ineligible', () => {
    expect(constructError({ actorClass: 'internal_position' })).toMatch(/CONFIG_INVALID\/gw-root-actor-ineligible/)
    expect(constructError({ actorClass: 'derived_executor' })).toMatch(/CONFIG_INVALID\/gw-root-actor-ineligible/)
  })

  it('scoped 凭据行 root（含「职级高/scope 覆盖」伪升级）→ gw-root-credential-scoped', () => {
    expect(constructError({ credentialClass: 'scoped' })).toMatch(/CONFIG_INVALID\/gw-root-credential-scoped/)
  })
})

describe('NEG-ORG-12 root 超范围/期限外', () => {
  it('范围外动作 → gw-root-scope-out；forbidden 边界同样拒', () => {
    expect(preflightOf({}, { actionScope: ['delete_company'], signerFingerprint: ROOT_FP })).toEqual({
      allowed: false,
      reason: 'gw-root-scope-out',
    })
    expect(preflightOf({}, { actionScope: ['外部审计'], signerFingerprint: ROOT_FP })).toEqual({
      allowed: false,
      reason: 'gw-root-scope-out',
    })
    // 逐项判定：范围内＋范围外混投＝整单拒（不做部分放行）
    expect(preflightOf({}, { actionScope: ['appoint_g8', 'delete_company'], signerFingerprint: ROOT_FP })).toEqual({
      allowed: false,
      reason: 'gw-root-scope-out',
    })
  })

  it('空范围不解释为全范围 → gw-root-empty-scope', () => {
    expect(preflightOf({}, { actionScope: [], signerFingerprint: ROOT_FP })).toEqual({ allowed: false, reason: 'gw-root-empty-scope' })
  })

  it('期限外（早于 from / 晚于 to）→ gw-root-term-out（时钟注入，非系统时间）', () => {
    expect(constructError({ clock: (): number => Date.parse('2025-12-31T23:59:59Z') })).toMatch(/CONFIG_INVALID\/gw-root-term-out/)
    const gate = createRootDelegationGate(options())
    let now = Date.parse(TERM.to) - 1_000
    const dynamic = createRootDelegationGate(options({ clock: (): number => now }))
    expect(dynamic.preflight(IN_SCOPE).allowed).toBe(true) // 期限最后 1 秒内（to 端点含）
    now = Date.parse(TERM.to) + 1_000
    expect(dynamic.preflight(IN_SCOPE)).toEqual({ allowed: false, reason: 'gw-root-term-out' })
    expect(gate.preflight(IN_SCOPE).allowed).toBe(true)
  })
})
