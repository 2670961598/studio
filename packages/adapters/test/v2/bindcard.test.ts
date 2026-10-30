/**
 * bindcard.test.ts —— IMPL-07-05 验收（DSH 绑定档案＋专属/通用二分；LANE-X）
 *
 * 冻结验收口径（plan/05 IMPL-07-05）：① BIND-DSH-01 卡可查（必答行集/版本锁/现状按面拆行/
 * 损失与探针引用/装载期不变量）；② 激活代次＋围栏（幂等重放、回退/竞争代次拒收、两轴不得互推）；
 * ③ 能力包只携引用＋公司包不自封权威＋专属/通用二分；④ NEG-RUN-05（未登记选择链直连非主绑定
 * 执行器被拒；选择≠授权）；⑤ PB-6 拟稿点登记（codex/kimi session_resume 未证→按不支持，
 * agentconfig 声明面/注册面对齐）；⑥ 不改变合法行为（dsh/claude 声明原样、适配器本体零改动）。
 *
 * 依据：v2/12 §〇.4/§一/§2.1/§四/§五/§六；v2/05 §三 DOM-06；v2/17 NEG-RUN-05＋GAP-V2-04＋PB-6；
 * v2/16 §三 adapters 行；v2/09 ENU-82/83/88/109/110/111。
 * 边界：只测**静态规则内核**（纯数据/纯函数）——探针未执行，「已有」面不升级为机制保证；
 * 落账与强制点归 daemon 各单（本单不改 daemon/其它包/旧测试；本文件 <600 行阈内自查）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, Result } from '@studio-next/contract'
import type { ActivationLedger, BindingActivationRequest, BindingCard, ProbeState } from '../../src/bindcard/index.ts'
import {
  CARD_FACT_STATUSES, CLAUDE_BINDING_CARD, CLI_BINDING_CARD_IDS, CODEX_BINDING_CARD, DSH_BINDING_CARD,
  DSH_EXCLUSIVE_FACES, DSH_HOST_VERSION, EMPTY_ACTIVATION_LEDGER, EMPTY_SELECTION_CHAIN, GENERIC_HOST_REQUIREMENTS,
  HOST_BINDING_CARD_IDS, HOST_CARD_REGISTRY, KIMI_BINDING_CARD, PB6_DRAFT_POINTS, PROBE_STATES, activateBinding,
  activationChain, activeActivation, capabilityDraftPoint, guardActivation, loadActiveBindingCard, loadBindingCard,
  loadCapabilityPacks, registerSelection, resolveCapabilityPacks, resolveDispatchTarget, unprovenProbeIdOf,
  validateBindingCard,
} from '../../src/bindcard/index.ts'
import {
  builtinResolver, effectiveCapabilities, familyOfExecutorName, loadAgentConfig, registerBuiltins, wireRegistry,
} from '../../src/agentconfig.ts'
import { CodexAdapter } from '../../src/codex.ts'
import { KimiAdapter } from '../../src/kimi.ts'
import { createRegistry } from '../../src/registry.ts'

function errOf<T>(r: Result<T, ClassifiedError>): ClassifiedError {
  if (r.kind !== 'err') throw new Error('期望 CONFIG_INVALID（err），实际 ok——放行路径必须不存在')
  return r.error
}
function okOf<T>(r: Result<T, ClassifiedError>): T {
  if (r.kind !== 'ok') throw new Error(`期望 ok，实际 ${r.error.subcause}：${r.error.detail ?? ''}`)
  return r.value
}
/** Result 失败面断言：子因 + detail 片段（一次到位） */
function expectErr<T>(r: Result<T, ClassifiedError>, subcause: string, needle?: string): ClassifiedError {
  const err = errOf(r)
  expect(err.subcause).toBe(subcause)
  if (needle !== undefined) expect(err.detail ?? '').toContain(needle)
  return err
}
/** 抛错通道（agentconfig 走 configInvalid 抛错） */
function expectThrows(fn: () => unknown, subcause: string, needle?: string): ClassifiedError {
  try {
    fn()
  } catch (e) {
    const err = e as Error & ClassifiedError
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe(subcause)
    if (needle !== undefined) expect(err.message).toContain(needle)
    return err
  }
  throw new Error(`期望抛出 ${subcause}，实际未抛出——放行路径必须不存在`)
}

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const claim = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  assetId: 'pack.alpha', kind: 'skill', contentDigest: DIGEST_A, required: true, ...over,
})
const actReq = (over: Partial<BindingActivationRequest> = {}): BindingActivationRequest => ({
  cardId: 'BIND-DSH-01', hostVersion: DSH_HOST_VERSION, generation: 1, fenceEpoch: 1,
  decidedBy: '制作人', reason: 'IMPL-07-05 首代激活', ...over,
})
const proof = (over: Partial<{ generation: number; fenceEpoch: number; hostVersion: string }> = {}) => ({
  cardId: 'BIND-DSH-01', hostVersion: DSH_HOST_VERSION, generation: 1, fenceEpoch: 1, ...over,
})
function seed(): { ledger: ActivationLedger; activationId: string } {
  const seeded = okOf(activateBinding(EMPTY_ACTIVATION_LEDGER, actReq()))
  return { ledger: seeded.ledger, activationId: seeded.activation.activationId }
}

// ---------------------------------------------------------------------------
// ① BIND-DSH-01 卡字段（卡可查；必答行；现状按面拆行）
// ---------------------------------------------------------------------------

describe('BIND-DSH-01 卡：必答行集与事实口径', () => {
  it('卡可查：标识/版本/宿主钉住/摘要未计算/ownerRef 非空；卡内不变量通过', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect([card.cardId, card.cardVersion, card.family]).toEqual(['BIND-DSH-01', 'v2.0', 'dsh'])
    expect([card.host.version, card.host.license]).toEqual(['0.2.1-rc.5', 'MIT'])
    expect(card.digest.computed).toBe(false)
    expect(card.digest.note).toContain('未计算')
    expect(card.ownerRef.trim()).not.toBe('')
    expect(validateBindingCard(card)).toEqual([])
  })

  it('覆盖/不支持：覆盖含策略投影（目标）；不支持逐条列并以「外部承接」收口；绑定不是授权', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.coverage.some((c) => c.includes('策略投影承载（目标'))).toBe(true)
    for (const item of ['组织/任命/禁配/验收/问责', '网络出站', '进程隔离', '秘密保管', '跨进程互斥', '权威激活']) {
      expect(card.unsupported).toContain(item)
    }
    expect(card.unsupported.join('')).toContain('外部承接')
    expect(card.authorization.mode).toBe('per-segment')
    expect(card.authorization.notAuthority).toContain('绑定不是授权')
  })

  it('载体映射：§1.4 全表；「不可表达」单列 unmappable（不硬塞现状四值）；PTC 未证', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.carrierMap.length).toBeGreaterThanOrEqual(14)
    const unmappable = card.carrierMap.filter((r) => r.unmappable === true)
    expect(unmappable.length).toBe(1)
    expect(unmappable[0]?.semantic).toContain('网络/进程/秘密/组织/验收/跨进程互斥')
    expect(unmappable[0]?.status).toBeUndefined()
    for (const row of card.carrierMap) if (row.unmappable !== true) expect(CARD_FACT_STATUSES).toContain(row.status)
    expect(card.carrierMap.find((r) => r.semantic === '工具呈现/PTC')?.status).toBe('未证')
  })

  it('损失行：BIND-LOSS-01…06＋10（severity/cannotClaim 齐备）；探针 17 行全 not-executed', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    const ids = card.losses.map((l) => l.lossId)
    for (const id of ['BIND-LOSS-01', 'BIND-LOSS-02', 'BIND-LOSS-03', 'BIND-LOSS-04', 'BIND-LOSS-05', 'BIND-LOSS-06', 'BIND-LOSS-10']) {
      expect(ids).toContain(id)
    }
    expect(card.losses.find((l) => l.lossId === 'BIND-LOSS-01')?.severity).toBe('blocking')
    expect(card.losses.find((l) => l.lossId === 'BIND-LOSS-10')?.cannotClaim).toContain('completed')
    expect(card.probes.length).toBe(17)
    expect(card.probes.every((p) => PROBE_STATES.includes(p.state) && p.state === 'not-executed')).toBe(true)
    for (const id of ['PRB-01', 'PRB-04', 'PRB-07', 'PRB-12', 'PRB-16', 'PRB-22']) {
      expect(card.probes.map((p) => p.probeId)).toContain(id)
    }
  })

  it('现状按面拆行：策略投影=目标、沙箱实际拦截=未证、命令形态=已有（每面恰一值）', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    const face = (name: string) => card.faces.find((f) => f.face.includes(name))?.status
    expect([face('策略投影'), face('沙箱实际拦截'), face('命令形态'), face('长驻宿主')]).toEqual([
      '目标', '未证', '已有', '未证',
    ])
    const names = card.faces.map((f) => f.face)
    expect(new Set(names).size).toBe(names.length)
  })

  it('四张卡可查；外域/未知卡指名归属且不复制第二张表（平台卡归各包、WS/PRM 卡不在此）', () => {
    for (const cardId of HOST_BINDING_CARD_IDS) expect(okOf(loadBindingCard(cardId)).cardId).toBe(cardId)
    expect(Object.keys(HOST_CARD_REGISTRY).sort()).toEqual([...HOST_BINDING_CARD_IDS].sort())
    expect(CLI_BINDING_CARD_IDS).toEqual({
      claude: 'BIND-CLI-CLAUDE-01', codex: 'BIND-CLI-CODEX-01', kimi: 'BIND-CLI-KIMI-01',
    })
    for (const foreign of ['BIND-PLAT-YT-01', 'BIND-PLAT-TAIGA-01', 'BIND-PLAT-LOCAL-01', 'BIND-WS-01', 'BIND-PRM-01', 'dsh', '']) {
      expectErr(loadBindingCard(foreign), 'bindcard/unknown-card', '不复制第二张表')
    }
    expectErr(loadBindingCard('BIND-PLAT-YT-01'), 'bindcard/unknown-card', 'packages/yt')
  })

  it('版本不符＝弃用（换宿主＝新档案，不静默降级）', () => {
    expectErr(loadBindingCard('BIND-DSH-01', '0.2.0'), 'bindcard/host-mismatch', '弃用')
    expectErr(loadBindingCard('BIND-CLI-CODEX-01', '0.2.1-rc.5'), 'bindcard/host-mismatch')
    expect(okOf(loadBindingCard('BIND-DSH-01', DSH_HOST_VERSION)).cardId).toBe('BIND-DSH-01')
  })

  it('卡冻结（改不动）＋坏卡装载期拒收（摘要冒充/无主/现状混写/探针非法/损失 ID 非法）', () => {
    expect(Object.isFrozen(DSH_BINDING_CARD)).toBe(true)
    expect(Object.isFrozen(DSH_BINDING_CARD.faces)).toBe(true)
    expect(() => {
      ;(DSH_BINDING_CARD as unknown as { cardId: string }).cardId = 'BIND-DSH-99'
    }).toThrow(TypeError)
    const base = okOf(loadBindingCard('BIND-DSH-01'))
    const broken: BindingCard[] = [
      { ...base, ownerRef: '  ' },
      { ...base, digest: { computed: true, note: '假装已计算' } as unknown as BindingCard['digest'] },
      { ...base, carrierMap: [{ semantic: 'x', carrier: 'y', strength: '—' }] },
      { ...base, carrierMap: [{ semantic: 'x', carrier: 'y', strength: '—', status: '目标', unmappable: true }] },
      { ...base, probes: [{ probeId: 'PRB-01', state: '可能通过' as unknown as ProbeState }] },
      { ...base, losses: [{ lossId: 'LOSS-1', severity: 'degrading', description: 'x', cannotClaim: 'y' }] },
      { ...base, faces: [{ face: '同一面', status: '已有', anchor: 'a' }, { face: '同一面', status: '目标', anchor: 'a' }] },
    ]
    for (const card of broken) expect(validateBindingCard(card).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// ①′ 专属/通用二分
// ---------------------------------------------------------------------------

describe('专属/通用二分：DSH 专属面（换宿主明示不可用）vs 通用必达面', () => {
  it('专属面六项：均指名目标执行器 dsh＋损失引用＋不得宣称', () => {
    expect(DSH_EXCLUSIVE_FACES.length).toBe(6)
    for (const face of DSH_EXCLUSIVE_FACES) {
      expect([face.binding, face.targetExecutor]).toEqual(['exclusive', 'dsh'])
      expect(face.lossRef.startsWith('BIND-LOSS-')).toBe(true)
      expect(face.cannotClaim.trim()).not.toBe('')
      expect(CARD_FACT_STATUSES).toContain(face.status)
    }
    expect(DSH_EXCLUSIVE_FACES.map((f) => f.faceId)).toEqual(
      expect.arrayContaining(['position-policy-projection', 'dsh-plugin-asset']),
    )
  })

  it('通用必达面六项（续跑或明报降级/声明不超证据）；三张 CLI 卡明示 DSH 专属面不可用', () => {
    expect(GENERIC_HOST_REQUIREMENTS.length).toBe(6)
    const reqIds = GENERIC_HOST_REQUIREMENTS.map((r) => r.requirementId)
    expect(reqIds).toEqual(expect.arrayContaining(['session-resume-or-degrade', 'claims-not-exceed-evidence']))
    expect(GENERIC_HOST_REQUIREMENTS.find((r) => r.requirementId === 'claims-not-exceed-evidence')?.rule).toContain('按不支持')
    for (const card of [CLAUDE_BINDING_CARD, CODEX_BINDING_CARD, KIMI_BINDING_CARD]) {
      expect(card.unsupported.join('')).toContain('DSH 专属能力面')
      expect(card.supply.join('')).toContain('版本未钉')
      expect([card.losses.length, card.exportExit.exit.trim() === '']).toEqual([1, false])
    }
    expect(KIMI_BINDING_CARD.faces.find((f) => f.face.includes('适配器接入'))?.status).toBe('库级')
    expect(CODEX_BINDING_CARD.faces.find((f) => f.face.includes('会话续跑'))?.status).toBe('未证')
  })
})

// ---------------------------------------------------------------------------
// ② 激活代次＋围栏
// ---------------------------------------------------------------------------

describe('激活代次＋围栏：两轴独立、幂等重放、回退拒收', () => {
  it('首代激活：DOM-06/具名决定/supersedes=null/token 两轴分离（围栏 token 不含代次，反之亦然）', () => {
    const { ledger, activationId } = seed()
    const a = okOf(activateBinding(EMPTY_ACTIVATION_LEDGER, actReq())).activation
    expect([a.domain, a.state, a.supersedes, a.generation, a.fence.epoch]).toEqual(['DOM-06', 'active', null, 1, 1])
    expect(a.fence.token).toContain('#fence-1')
    expect(a.fence.token).not.toContain('#gen-')
    expect(a.generationToken).toContain('#gen-1')
    expect(a.generationToken).not.toContain('#fence-')
    expect(activeActivation(ledger, 'BIND-DSH-01')?.activationId).toBe(activationId)
  })

  it('幂等重放不新增；同代次异内容＝竞争代次（保持冻结交终裁）', () => {
    const first = seed()
    const replay = okOf(activateBinding(first.ledger, actReq()))
    expect(replay.ledger).toBe(first.ledger)
    expect(replay.activation.activationId).toBe(first.activationId)
    expectErr(activateBinding(first.ledger, actReq({ reason: '另一份决定' })), 'bindcard/generation-conflict', '冻结')
  })

  it('第二代取代第一代（旧代 superseded、旧账本不可变）；旧证明被围栏', () => {
    const first = seed()
    const second = okOf(activateBinding(first.ledger, actReq({ generation: 2, fenceEpoch: 2, reason: '换段' })))
    expect(second.activation.supersedes).toBe(first.activationId)
    const chain = activationChain(second.ledger, 'BIND-DSH-01')
    expect([chain.length, chain[0]?.state, chain[1]?.state]).toEqual([2, 'superseded', 'active'])
    expect(first.ledger.activations.length).toBe(1)
    expectErr(guardActivation(second.ledger, proof()), 'bindcard/generation-stale')
  })

  it('两轴不得互推（TERM-35）：代次当前围栏落后→fence-stale；反之→generation-stale；激活期同拒', () => {
    const first = seed()
    const second = okOf(activateBinding(first.ledger, actReq({ generation: 2, fenceEpoch: 5, reason: '两轴各自前进' })))
    expectErr(guardActivation(second.ledger, proof({ generation: 2, fenceEpoch: 1 })), 'bindcard/fence-stale')
    expectErr(guardActivation(second.ledger, proof({ generation: 1, fenceEpoch: 5 })), 'bindcard/generation-stale')
    expectErr(activateBinding(second.ledger, actReq({ generation: 3, fenceEpoch: 5, reason: '围栏不动' })), 'bindcard/fence-stale')
  })

  it('越序自封拒收：未来代次/未来围栏纪元不受理', () => {
    const first = seed()
    expectErr(guardActivation(first.ledger, proof({ generation: 9, fenceEpoch: 9 })), 'bindcard/generation-ahead')
    expectErr(guardActivation(first.ledger, proof({ generation: 1, fenceEpoch: 9 })), 'bindcard/fence-ahead')
  })

  it('未激活不得驱动派发；宿主版本不符＝旧卡不加载；无主决定/空依据/非法代次/非法围栏一律拒', () => {
    expectErr(guardActivation(EMPTY_ACTIVATION_LEDGER, proof()), 'bindcard/not-activated')
    const first = seed()
    expectErr(guardActivation(first.ledger, proof({ hostVersion: '0.1.0' })), 'bindcard/host-mismatch')
    for (const [req, sub] of [
      [actReq({ decidedBy: '系统' }), 'bindcard/decision-anonymous'],
      [actReq({ reason: ' ' }), 'bindcard/decision-incomplete'],
      [actReq({ generation: 0 }), 'bindcard/generation-invalid'],
      [actReq({ fenceEpoch: 0 }), 'bindcard/fence-invalid'],
      [actReq({ hostVersion: '0.1.0' }), 'bindcard/host-mismatch'],
    ] as const) {
      expectErr(activateBinding(EMPTY_ACTIVATION_LEDGER, req), sub)
    }
  })

  it('loadActiveBindingCard：围栏通过才返回卡本体＋当前激活；超前证明被拒', () => {
    const first = seed()
    const loaded = okOf(loadActiveBindingCard(first.ledger, proof()))
    expect([loaded.card.cardId, loaded.activation.activationId]).toEqual(['BIND-DSH-01', first.activationId])
    expectErr(loadActiveBindingCard(first.ledger, proof({ generation: 2, fenceEpoch: 2 })), 'bindcard/generation-ahead')
  })
})

// ---------------------------------------------------------------------------
// ③ 能力包只携引用／公司包不自封权威／专属·通用二分
// ---------------------------------------------------------------------------

describe('能力包引用：只携引用、不自封权威、缺目标执行器明示不可用', () => {
  it('合法引用：generic＋exclusive 双形；产物只含引用面（installAuthorization=required，无内容/无授权位）', () => {
    const loaded = okOf(
      loadCapabilityPacks([
        claim({ binding: 'generic' }),
        { assetId: 'pack.dsh-plugin', kind: 'plugin', binding: 'exclusive', targetExecutor: 'dsh', contentDigest: DIGEST_B, required: true, compatibility: ['dsh@0.2.1-rc.5'] },
      ]),
    )
    expect([loaded.refs.length, loaded.warnings.length]).toEqual([2, 0])
    const exclusive = loaded.refs[1]
    expect([exclusive?.binding, exclusive?.targetExecutor, exclusive?.installAuthorization]).toEqual(['exclusive', 'dsh', 'required'])
    expect(exclusive?.refId).toBe(`pack.dsh-plugin@${DIGEST_B.slice(0, 12)}`)
    expect(['content' in (exclusive ?? {}), 'authorized' in (exclusive ?? {})]).toEqual([false, false])
  })

  it('只携引用：内嵌内容键一律拒（字节装载归公司资产部，绑定面不二次实现）', () => {
    expectErr(loadCapabilityPacks([claim({ content: 'inline-bytes' })]), 'bindcard/capability-embedded-content', '只携引用')
    expectErr(loadCapabilityPacks([claim({ files: ['a'] })]), 'bindcard/capability-embedded-content')
  })

  it('公司包不自封权威：authorized/grantedBy/authority/installAuthorization=granted 一律拒', () => {
    for (const c of [claim({ authorized: true }), claim({ grantedBy: '制作人' }), claim({ authority: 'root' }), claim({ installAuthorization: 'granted' })]) {
      expectErr(loadCapabilityPacks([c]), 'bindcard/capability-self-authority', '授权链')
    }
    expect(okOf(loadCapabilityPacks([claim({ installAuthorization: 'required' })])).refs[0]?.installAuthorization).toBe('required')
  })

  it('专属/通用二分：缺标记按通用并警示；exclusive 必填目标执行器；generic 不得标目标', () => {
    const loaded = okOf(loadCapabilityPacks([claim()]))
    expect([loaded.refs[0]?.binding, loaded.warnings[0]?.code]).toEqual(['generic', 'W-SCH-002'])
    expectErr(loadCapabilityPacks([claim({ binding: 'exclusive' })]), 'bindcard/capability-target-missing')
    expectErr(loadCapabilityPacks([claim({ binding: 'generic', targetExecutor: 'dsh' })]), 'bindcard/capability-binding-conflict')
    expectErr(loadCapabilityPacks([claim({ binding: 'exclusive', targetExecutor: 'nova' })]), 'bindcard/capability-target-unknown')
  })

  it('形状面拒收：未知类型/坏摘要/未知专属标记/重名/非对象/坏标识', () => {
    for (const [input, sub] of [
      [[claim({ kind: 'binary' })], 'bindcard/capability-kind-unknown'],
      [[claim({ contentDigest: 'deadbeef' })], 'bindcard/capability-digest-invalid'],
      [[claim({ binding: 'shared' })], 'bindcard/capability-binding-unknown'],
      [[claim(), claim()], 'bindcard/capability-dup'],
      [['pack.alpha'], 'bindcard/capability-shape'],
      [[{ kind: 'skill', contentDigest: DIGEST_A }], 'bindcard/capability-id-invalid'],
    ] as const) {
      expectErr(loadCapabilityPacks(input), sub)
    }
  })

  it('可用性：专属缺目标执行器＝incompatible（明示不可用，必备进 unavailableRequired）；未知执行器名＝不具备', () => {
    const refs = okOf(
      loadCapabilityPacks([
        claim({ binding: 'generic' }),
        { assetId: 'pack.dsh-only', kind: 'plugin', binding: 'exclusive', targetExecutor: 'dsh', contentDigest: DIGEST_B, required: true },
      ]),
    ).refs
    const withDsh = resolveCapabilityPacks(refs, ['dsh'])
    expect(withDsh.rows.map((r) => r.state)).toEqual(['applicable', 'applicable'])
    expect(withDsh.rows[1]?.reason).toBe('target-executor-available')
    const without = resolveCapabilityPacks(refs, ['claude'])
    expect(without.rows.map((r) => r.state)).toEqual(['applicable', 'incompatible'])
    expect([without.rows[1]?.reason, without.unavailableRequired.map((r) => r.assetId)]).toEqual(['missing-executor', ['pack.dsh-only']])
    expect(without.rows.every((r) => r.installAuthorization === 'required')).toBe(true)
    expect(without.note).toContain('传播≠授权')
    expect(resolveCapabilityPacks(refs, ['DSH']).rows[1]?.state).toBe('incompatible')
  })
})

// ---------------------------------------------------------------------------
// ④ NEG-RUN-05：未登记选择链直连非主绑定执行器被拒
// ---------------------------------------------------------------------------

describe('NEG-RUN-05：执行器选择链（未登记直连＝拒；选择≠授权）', () => {
  it('负向：无登记链直连非主绑定执行器 → selection-unregistered（指名 NEG-RUN-05/GAP-V2-04）', () => {
    expectErr(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'IMPL-07-05', executor: 'codex' }), 'dispatch/selection-unregistered')
    const err = errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'IMPL-07-05', executor: 'codex' }))
    expect(err.detail ?? '').toContain('NEG-RUN-05')
    expect(err.detail ?? '').toContain('GAP-V2-04')
    for (const executor of ['claude', 'codex', 'kimi']) {
      expectErr(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor }), 'dispatch/selection-unregistered')
    }
  })

  it('主绑定 dsh 走缺省链（默认＝DSH，无需登记）；选择结果恒非授权（无 granted 位）', () => {
    const picked = okOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor: 'dsh' }))
    expect([picked.source, picked.chainId, picked.authorization]).toEqual(['default', 'default:primary', 'not-granted-here'])
    expect('granted' in picked).toBe(false)
  })

  it('登记后放行（chainId 记来源）；登记链说的不是它 → selection-mismatch（不得绕登记改派）', () => {
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-2', executor: 'claude', source: 'ticket', registeredBy: '制作人', reason: '异源复核（单据指定）',
      }),
    )
    const picked = okOf(resolveDispatchTarget(chain, { ticket: 'T-2', executor: 'claude' }))
    expect([picked.executor, picked.chainId, picked.authorization]).toEqual(['claude', 'ticket:T-2', 'not-granted-here'])
    const posChain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-3', executor: 'claude', source: 'position', positionRef: 'position.qa', registeredBy: '制作人', reason: '岗位绑定',
      }),
    )
    expectErr(resolveDispatchTarget(posChain, { ticket: 'T-3', executor: 'kimi' }), 'dispatch/selection-mismatch', 'claude')
  })

  it('非法登记拒收（未知执行器/空单号/无主/position 缺引用）；同内容重登记幂等、异内容冲突', () => {
    expectErr(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T', executor: 'probe-x' }), 'dispatch/executor-unknown')
    const entry = { ticket: 'T-4', executor: 'kimi' as const, source: 'ticket' as const, registeredBy: '制作人', reason: '跨家复核' }
    for (const bad of [{ ...entry, ticket: ' ' }, { ...entry, registeredBy: '' }, { ...entry, source: 'position' as const }]) {
      expectErr(registerSelection(EMPTY_SELECTION_CHAIN, bad), 'dispatch/selection-invalid')
    }
    const first = okOf(registerSelection(EMPTY_SELECTION_CHAIN, entry))
    expect(okOf(registerSelection(first, entry))).toBe(first)
    expectErr(registerSelection(first, { ...entry, reason: '换个理由' }), 'dispatch/selection-conflict')
  })
})

// ---------------------------------------------------------------------------
// ⑤ PB-6 拟稿点登记＋agentconfig 未证能力对齐
// ---------------------------------------------------------------------------

describe('PB-6 拟稿点登记：未证按不支持（声明面/注册面对齐）', () => {
  it('登记表：codex/kimi session_resume 挂 PRB-25/26、disposition=unsupported、探针 not-executed；非布尔面只登记', () => {
    expect(PB6_DRAFT_POINTS.length).toBeGreaterThanOrEqual(4)
    const codex = capabilityDraftPoint('codex', 'session_resume')
    expect([codex?.probeId, codex?.disposition, codex?.probeState, codex?.batch]).toEqual(['PRB-25', 'unsupported', 'not-executed', 'PB-6'])
    expect(capabilityDraftPoint('kimi', 'session_resume')?.probeId).toBe('PRB-26')
    expect([unprovenProbeIdOf('codex', 'session_resume'), unprovenProbeIdOf('kimi', 'session_resume')]).toEqual(['PRB-25', 'PRB-26'])
    expect([capabilityDraftPoint('codex', 'agents_md')?.disposition, unprovenProbeIdOf('codex', 'agents_md')]).toEqual(['registered-only', undefined])
    expect([capabilityDraftPoint('dsh', 'session_resume'), capabilityDraftPoint('claude', 'session_resume')]).toEqual([undefined, undefined])
  })

  it('有效声明：codex/kimi 续跑翻 false、其余字段原样；dsh/未知家返回原引用（合法面零改动）', () => {
    const codex = new CodexAdapter()
    const kimi = new KimiAdapter()
    const aligned = effectiveCapabilities('codex', codex.capabilities)
    expect([aligned.session_resume, aligned.budget_cap, aligned.agents_md]).toEqual([false, codex.capabilities.budget_cap, codex.capabilities.agents_md])
    expect(effectiveCapabilities('kimi', kimi.capabilities).session_resume).toBe(false)
    expect(effectiveCapabilities('dsh', codex.capabilities)).toBe(codex.capabilities)
    expect(effectiveCapabilities('probe-x', codex.capabilities)).toBe(codex.capabilities)
    // 适配器本体零改动：静态声明仍是拟稿 true（改它须 PRB 证据另行立单）
    expect([codex.capabilities.session_resume, kimi.capabilities.session_resume]).toEqual([true, true])
    expect([familyOfExecutorName('codex-high'), familyOfExecutorName('kimi-judge'), familyOfExecutorName('probe-x')]).toEqual(['codex', 'kimi', undefined])
  })

  it('注册面：registerBuiltins 的 codex/kimi 声明续跑=false，dsh/claude 原样（路由收口、适配器方法未替换）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(['codex', 'kimi'].map((n) => registry.resolve(n).capabilities.session_resume)).toEqual([false, false])
    expect(['dsh', 'claude'].map((n) => registry.resolve(n).capabilities.session_resume)).toEqual([true, true])
    expect(registry.pickAll({ sessionResume: true }).map((a) => a.name)).toEqual(['dsh', 'claude'])
    expect(registry.pickAll({ sessionResume: false }).map((a) => a.name)).toEqual(['codex', 'kimi'])
    expect([registry.resolve('codex').name, typeof registry.resolve('codex').launch]).toEqual(['codex', 'function'])
  })

  it('配置面：agent.yaml 给 kimi 写 session_resume:true → cap-unproven（指名 PRB-26）；false/省略照过；dsh 行为不变', () => {
    expectThrows(
      () => wireRegistry(createRegistry(), loadAgentConfig('executors:\n  kimi:\n    capabilities:\n      session_resume: true\n'), builtinResolver),
      'agentconfig/cap-unproven',
      'PRB-26',
    )
    const honest = wireRegistry(
      createRegistry(),
      loadAgentConfig('executors:\n  codex:\n    capabilities:\n      session_resume: false\n      budget_cap: false\n'),
      builtinResolver,
    )
    expect(honest.resolve('codex').capabilities.session_resume).toBe(false)
    const withDsh = wireRegistry(
      createRegistry(),
      loadAgentConfig('executors:\n  dsh:\n    default: true\n    capabilities: { session_resume: true }\n'),
      builtinResolver,
    )
    expect(withDsh.defaultName()).toBe('dsh')
    expectThrows(
      () => wireRegistry(createRegistry(), loadAgentConfig('executors:\n  dsh:\n    capabilities:\n      budget_cap: true\n'), builtinResolver),
      'agentconfig/cap-drift',
    )
  })
})
