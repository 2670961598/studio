/**
 * authority-gate.test —— core/authority 五函数接入写路径的定向红→绿用例
 *
 * 依据：
 *   - docs/17-§2（主循环七相位：写路径经 gated-platform 收口）、docs/17-§6（收割四要件：
 *     判定必须留痕）；
 *   - docs/v2/05 §四 PORT-AUTH（持 root key 不自动构成授权，仍须按链核验）、
 *     docs/v2/14 §1.2（verify 四态 / withdraw 后代枚举＋停用证据＋无后代显式确认）；
 *   - packages/contract/src/ports/auth.ts、packages/core/src/authority.ts。
 *
 * 断言面（对应任务书验收②：「越权动作被拒且落证据；合法动作放行」）：
 *   1. 映射表覆盖两域十二动词，每词恰一个主判定函数；
 *   2. 合法主张 → permitted 放行 + 证据；越权/缺授予/已撤回/保留区/坏形状 → 拒 + 证据；
 *   3. 根级动作 → rootDelegationFailure（证明/授予人/本人行使三面）；
 *   4. 无主张：影子放行（留痕）与 requireClaim 硬切拒绝两态；
 *   5. 撤回：checkWithdrawalCompleteness（缺失后代/缺停用证据/无后代未确认均拒）；
 *   6. gated-platform 集成：拒绝时底层 platform 零调用（fail-closed），放行时副作用真发生。
 */
import { describe, expect, it } from 'vitest'
import { CONTROL_TICKET, GATEWAY_ACTION_WORDS, createGateway } from '@studio-next/gateway'
import type { FlowPlatform, IssueCreate } from '@studio-next/contract'
import type { GrantLink, WithdrawalRequestInput } from '@studio-next/core'
import { createFakePlatform } from '../../../src/engine/fakes.ts'
import {
  AUTHORITY_ACTION_ROUTES,
  AUTHORITY_WITHDRAW_FUNCTION,
  createAuthorityGate,
} from '../../../src/engine/tools/authority-gate.ts'
import type { AuthorityEvidence } from '../../../src/engine/tools/authority-gate.ts'
import { createGatedPlatform } from '../../../src/engine/tools/gated-platform.ts'

const NOW = 1_700_000_000_000

/** 授权范围词全集（本单映射表的范围词表；授予夹具按此裁剪出越权面） */
const ALL_SCOPES = [
  'platform.comment',
  'platform.heartbeat',
  'kb.article',
  'kb.search',
  'evidence.write',
  'budget.query',
  'platform.create',
  'platform.transition',
  'platform.set-field',
  'platform.link',
  'platform.provision',
  'platform.guards',
] as const

const ROOT: GrantLink = {
  grantId: 'g-root',
  grantClass: 'root_delegation',
  grantor: 'external-boss',
  grantorKind: 'external_boss',
  grantee: 'internal-boss',
  purpose: 'company.operations',
  scope: [...ALL_SCOPES],
  conditions: ['audit.read'],
  term: { fromMs: 0 },
  delegable: true,
  proof: { proofMode: 'ritual_and_key', keyFingerprint: 'sha256:abcd', externalSignatureRef: 'sig-1' },
}

const DELEGATION: GrantLink = {
  grantId: 'g-dev',
  grantClass: 'delegation',
  grantor: 'internal-boss',
  grantorKind: 'internal_position',
  grantee: 'dept-head',
  parentGrantId: 'g-root',
  purpose: 'company.operations',
  scope: [...ALL_SCOPES],
  conditions: ['audit.read'],
  term: { fromMs: 0 },
  delegable: false,
}

const SUB: GrantLink = {
  ...DELEGATION,
  grantId: 'g-sub',
  grantor: 'dept-head',
  grantee: 'team-lead',
  parentGrantId: 'g-dev',
}

interface Harness {
  readonly evidence: AuthorityEvidence[]
  readonly gate: ReturnType<typeof createAuthorityGate>
}

function makeGate(grants: readonly GrantLink[], options: { requireClaim?: boolean } = {}): Harness {
  const evidence: AuthorityEvidence[] = []
  const gate = createAuthorityGate({
    grants: () => grants,
    now: () => NOW,
    record: (item) => evidence.push(item),
    ...(options.requireClaim !== undefined ? { requireClaim: options.requireClaim } : {}),
  })
  return { evidence, gate }
}

const claim = (overrides: Partial<{ grantId: string; exercisedBy: string; withheldScope: readonly string[] }> = {}): Record<string, unknown> => ({
  grantId: 'g-dev',
  exercisedBy: 'dept-head',
  ...overrides,
})

const INPUT = { ticket: 'T-528' } as const

describe('映射表：两域十二动词全覆盖，每词恰一个主判定函数', () => {
  it('键集 = GATEWAY_ACTION_WORDS（worker 六 + ctl 六）；撤回面单列 checkWithdrawalCompleteness', () => {
    expect(Object.keys(AUTHORITY_ACTION_ROUTES).sort()).toEqual([...GATEWAY_ACTION_WORDS].sort())
    expect(AUTHORITY_WITHDRAW_FUNCTION).toBe('checkWithdrawalCompleteness')
    const functions = new Set(Object.values(AUTHORITY_ACTION_ROUTES).map((route) => route.decision))
    expect([...functions].sort()).toEqual(['isEffectivelyWithdrawn', 'rootDelegationFailure', 'verifyGrantChain'])
  })

  it('ctl- 六动词走 internal_boss；worker 六动词走 self（ENU-139）', () => {
    for (const [action, route] of Object.entries(AUTHORITY_ACTION_ROUTES)) {
      expect(route.action).toBe(action)
      expect(route.onBehalfOf).toBe(action.startsWith('ctl-') ? 'internal_boss' : 'self')
    }
  })
})

describe('verify 面：合法放行 / 越权拒绝（fail-closed + 证据）', () => {
  it('合法主张（root_delegation → delegation）→ permitted，链自根到叶，证据落 mode=enforce', () => {
    const { gate, evidence } = makeGate([ROOT, DELEGATION])
    const decision = gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(decision.allowed).toBe(true)
    expect(decision.state).toBe('permitted')
    expect(decision.chain).toEqual(['g-root', 'g-dev'])
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ mode: 'enforce', state: 'permitted', action: 'comment', ticket: 'T-528' })
    expect(evidence[0]?.evidenceId).toMatch(/^AUTH-[0-9a-f]{16}$/)
  })

  it('越权：授予 scope 不覆盖动作范围 → prohibited + scope-widening，且不放行', () => {
    const narrow: GrantLink = { ...DELEGATION, scope: ['platform.transition'] }
    const { gate, evidence } = makeGate([ROOT, narrow])
    const decision = gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('gw-authority-prohibited')
    expect(decision.refusals.map((item) => item.kind)).toContain('scope-widening')
    expect(evidence[0]).toMatchObject({ state: 'prohibited' })
  })

  it('缺授予 → uncovered（与 prohibited 不同态）', () => {
    const { gate } = makeGate([ROOT, DELEGATION])
    const decision = gate.authorize({ action: 'comment', args: { authority: claim({ grantId: 'g-missing' }) }, ...INPUT })
    expect(decision.allowed).toBe(false)
    expect(decision.state).toBe('uncovered')
    expect(decision.reason).toBe('gw-authority-uncovered')
    expect(decision.refusals.map((item) => item.kind)).toContain('grant-not-found')
  })

  it('自身撤回 / 父撤回 → 链不可再用（grant-withdrawn）', () => {
    const withdrawn: GrantLink = { ...DELEGATION, withdrawnAtMs: NOW - 1 }
    const own = makeGate([ROOT, withdrawn]).gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(own.allowed).toBe(false)
    expect(own.reason).toBe('gw-authority-withdrawn')
    const rootWithdrawn: GrantLink = { ...ROOT, withdrawnAtMs: NOW - 1 }
    const viaParent = makeGate([rootWithdrawn, DELEGATION]).gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(viaParent.allowed).toBe(false)
    expect(viaParent.reason).toBe('gw-authority-withdrawn')
  })

  it('保留区命中 → reserved（不自行放行；ENU-31）', () => {
    const reserved: GrantLink = { ...DELEGATION, reservedScopes: ['platform.comment'] }
    const decision = makeGate([ROOT, reserved]).gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(decision.allowed).toBe(false)
    expect(decision.state).toBe('reserved')
    expect(decision.reason).toBe('gw-authority-reserved')
  })

  it('主张形状坏 / 凭据当权源 → claim-invalid（声明了授权却坏了不降级）', () => {
    const { gate } = makeGate([ROOT, DELEGATION])
    for (const authority of ['token-abc', { grantId: '', exercisedBy: 'dept-head' }, { grantId: 'g-dev' }, { grantId: 'g-dev', exercisedBy: 'dept-head', extra: 1 }]) {
      const decision = gate.authorize({ action: 'comment', args: { authority }, ...INPUT })
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe('gw-authority-claim-invalid')
    }
  })

  it('证据落点异常 → 拒绝（无留痕不放行）', () => {
    const gate = createAuthorityGate({
      grants: () => [ROOT, DELEGATION],
      now: () => NOW,
      record: () => {
        throw new Error('ledger down')
      },
    })
    const decision = gate.authorize({ action: 'comment', args: { authority: claim() }, ...INPUT })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('gw-authority-evidence-failed')
  })
})

describe('根级动作：rootDelegationFailure（ctl-provision / ctl-guards）', () => {
  it('合法根授予 + 本人行使 → permitted', () => {
    const { gate } = makeGate([ROOT, DELEGATION])
    const decision = gate.authorize({ action: 'ctl-provision', args: { authority: claim({ grantId: 'g-root', exercisedBy: 'internal-boss' }) }, ...INPUT })
    expect(decision.allowed).toBe(true)
    expect(decision.state).toBe('permitted')
    expect(decision.chain).toEqual(['g-root'])
  })

  it('证明缺项（record_only / 无签名与离线件）→ prohibited', () => {
    const badProof: GrantLink = { ...ROOT, proof: { proofMode: 'record_only', keyFingerprint: 'sha256:abcd' } }
    const decision = makeGate([badProof, DELEGATION]).gate.authorize({
      action: 'ctl-provision',
      args: { authority: claim({ grantId: 'g-root', exercisedBy: 'internal-boss' }) },
      ...INPUT,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('gw-authority-prohibited')
    expect(decision.refusals.map((item) => item.kind)).toContain('root-proof-invalid')
  })

  it('internal_boss 非根被授予者本人 → on-behalf-of-forbidden', () => {
    const decision = makeGate([ROOT, DELEGATION]).gate.authorize({
      action: 'ctl-provision',
      args: { authority: claim({ grantId: 'g-root', exercisedBy: 'dept-head' }) },
      ...INPUT,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.refusals.map((item) => item.kind)).toContain('on-behalf-of-forbidden')
  })

  it('保留区（platform.guards）→ reserved', () => {
    const reservedRoot: GrantLink = { ...ROOT, reservedScopes: ['platform.guards'] }
    const decision = makeGate([reservedRoot, DELEGATION]).gate.authorize({
      action: 'ctl-guards',
      args: { authority: claim({ grantId: 'g-root', exercisedBy: 'internal-boss' }) },
      ...INPUT,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.state).toBe('reserved')
  })
})

describe('无主张两态：影子放行（默认）vs requireClaim 硬切', () => {
  it('默认 shadow：无主张放行但如实标 uncovered（不静默）', () => {
    const { gate, evidence } = makeGate([])
    const decision = gate.authorize({ action: 'comment', args: {}, ...INPUT })
    expect(decision.allowed).toBe(true)
    expect(decision.state).toBe('uncovered')
    expect(decision.mode).toBe('shadow')
    expect(evidence[0]).toMatchObject({ mode: 'shadow', state: 'uncovered' })
  })

  it('requireClaim=true：无主张即拒（授予记录生产者落地后硬切）', () => {
    const decision = makeGate([], { requireClaim: true }).gate.authorize({ action: 'comment', args: {}, ...INPUT })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('gw-authority-required')
  })

  it('读类动词：未撤回放行；已撤回拒', () => {
    const allowed = makeGate([ROOT, DELEGATION]).gate.authorize({ action: 'kb-search', args: { authority: claim() }, ...INPUT })
    expect(allowed.allowed).toBe(true)
    const withdrawn: GrantLink = { ...DELEGATION, withdrawnAtMs: NOW - 1 }
    const denied = makeGate([ROOT, withdrawn]).gate.authorize({ action: 'kb-search', args: { authority: claim() }, ...INPUT })
    expect(denied.allowed).toBe(false)
  })
})

describe('撤回面：checkWithdrawalCompleteness（后代枚举＋停用证据＋无后代确认）', () => {
  const request = (overrides: Partial<WithdrawalRequestInput> = {}): WithdrawalRequestInput => ({
    rootGrantId: 'g-root',
    withdrawnAtMs: NOW,
    enumeratedDescendants: ['g-dev', 'g-sub'],
    deactivationEvidence: [
      { grantId: 'g-dev', kind: 'revocation_receipt', evidenceRef: 'rev-1' },
      { grantId: 'g-sub', kind: 'injection_stop_confirm', evidenceRef: 'stop-2' },
    ],
    ...overrides,
  })

  it('后代逐项枚举 + 停用证据齐 → complete 放行，回执列出传递后代', () => {
    const decision = makeGate([ROOT, DELEGATION, SUB]).gate.withdraw(request())
    expect(decision.allowed).toBe(true)
    expect(decision.check?.complete).toBe(true)
    expect(decision.descendants).toEqual(['g-dev', 'g-sub'])
    expect(decision.state).toBe('permitted')
  })

  it('漏枚举后代 / 缺停用证据 → 拒（withdraw-incomplete），并回执缺口', () => {
    const missing = makeGate([ROOT, DELEGATION, SUB]).gate.withdraw(request({ enumeratedDescendants: ['g-dev'] }))
    expect(missing.allowed).toBe(false)
    expect(missing.reason).toBe('gw-authority-withdraw-incomplete')
    expect(missing.check?.missing).toEqual(['g-sub'])
    const unevidenced = makeGate([ROOT, DELEGATION, SUB]).gate.withdraw(request({ deactivationEvidence: [] }))
    expect(unevidenced.allowed).toBe(false)
    expect(unevidenced.check?.unevidenced.length).toBe(2)
  })

  it('无后代未显式确认 → 拒；根授予不存在 → uncovered', () => {
    const noDescendants = makeGate([ROOT]).gate.withdraw(
      request({ enumeratedDescendants: [], deactivationEvidence: [], noDescendantsConfirmed: false }),
    )
    expect(noDescendants.allowed).toBe(false)
    expect(noDescendants.check?.findings).toContain('no-descendants-not-confirmed')
    const unknown = makeGate([ROOT]).gate.withdraw(request({ rootGrantId: 'g-nope' }))
    expect(unknown.allowed).toBe(false)
    expect(unknown.reason).toBe('gw-authority-uncovered')
  })
})

describe('gated-platform 集成：拒绝时底层零副作用，放行时副作用真发生', () => {
  const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
  const CTX = { company: '指尖游戏', dept: '平台部', role: '控制面', level: 9 }

  function stack(grants: readonly GrantLink[]): { gated: FlowPlatform; created: () => number; evidence: AuthorityEvidence[] } {
    const inner = createFakePlatform()
    let count = 0
    const platform: FlowPlatform = {
      ...inner,
      issues: {
        ...inner.issues,
        create: async (input) => {
          count += 1
          return inner.issues.create(input)
        },
      },
    }
    const gateway = createGateway({ secret: SECRET, clock: () => NOW, ticket: CONTROL_TICKET, ctx: CTX, author: 'daemon-ctl' })
    const evidence: AuthorityEvidence[] = []
    const authority = createAuthorityGate({
      grants: () => grants,
      now: () => NOW,
      record: (item) => evidence.push(item),
    })
    const gated = createGatedPlatform(platform, gateway, { ctx: CTX, author: 'daemon-ctl', authority })
    return { gated, created: () => count, evidence }
  }

  it('越权建单（授予不含 platform.comment）→ EXTERNAL_REJECT/gw-authority-prohibited，平台零调用', async () => {
    const narrow: GrantLink = { ...DELEGATION, scope: ['platform.transition'] }
    const { gated, created, evidence } = stack([ROOT, narrow])
    const input = { title: '越权建单', authority: claim() } as unknown as IssueCreate
    await expect(gated.issues.create(input)).rejects.toMatchObject({
      category: 'EXTERNAL_REJECT',
      subcause: 'gw-authority-prohibited',
    })
    expect(created()).toBe(0)
    expect(evidence[0]).toMatchObject({ state: 'prohibited', action: 'comment' })
  })

  it('合法主张建单 → 过授权闸与 wkey 闸，平台副作用发生', async () => {
    const { gated, created } = stack([ROOT, DELEGATION])
    const input = { title: '合法建单', authority: claim() } as unknown as IssueCreate
    const rec = await gated.issues.create(input)
    expect(created()).toBe(1)
    expect(rec.title).toBe('合法建单')
  })

  it('无主张（存量写形态）→ shadow 放行，平台照常调用（真机不回归）', async () => {
    const { gated, created, evidence } = stack([])
    await gated.issues.create({ title: '存量建单' } as IssueCreate)
    expect(created()).toBe(1)
    expect(evidence[0]).toMatchObject({ mode: 'shadow', state: 'uncovered' })
  })
})
