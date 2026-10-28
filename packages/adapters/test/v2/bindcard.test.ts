/**
 * bindcard.test.ts —— IMPL-07-05 验收（DSH 绑定档案＋专属/通用二分；LANE-X）
 *
 * 冻结验收口径（plan/05 IMPL-07-05）：
 *   ① BIND-DSH-01 卡可查（必答行集/版本锁/现状按面拆行/损失与探针引用/装载期不变量）；
 *   ② 激活代次＋围栏（幂等重放；回退/竞争代次拒收；围栏与代次两轴独立、不得互推）；
 *   ③ 能力包只携引用（拒内嵌内容）＋公司包不自封权威＋专属/通用二分（缺目标执行器明示不可用）；
 *   ④ NEG-RUN-05（未登记选择链直连非主绑定执行器被拒；选择≠授权）；
 *   ⑤ PB-6 拟稿点登记（codex/kimi session_resume 未证→按不支持；agentconfig 声明面/注册面对齐）；
 *   ⑥ 不改变合法行为（dsh/claude 续跑声明原样；适配器本体零改动——CodexAdapter 自身仍为拟稿 true）。
 *
 * 依据：v2/12 §〇.4/§一/§2.1/§四/§五/§六；v2/05 §三 DOM-06；v2/17 NEG-RUN-05＋GAP-V2-04＋PB-6；
 *       v2/16 §三 adapters 行；v2/09 ENU-82/83/88/109/110/111。
 * 边界：本套只测**静态规则内核**（纯数据/纯函数）——探针未执行，任何「已有」面都不升级为
 *       机制保证；落账与强制点归 daemon 各单（本单不改 daemon/其它包/旧测试）。
 */
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, Result } from '@studio-next/contract'
import type {
  ActivationLedger,
  BindingActivationRequest,
  BindingCard,
  ProbeState,
} from '../../src/bindcard/index.ts'
import {
  CARD_FACT_STATUSES,
  CLAUDE_BINDING_CARD,
  CLI_BINDING_CARD_IDS,
  CODEX_BINDING_CARD,
  DSH_BINDING_CARD,
  DSH_EXCLUSIVE_FACES,
  DSH_HOST_VERSION,
  EMPTY_ACTIVATION_LEDGER,
  EMPTY_SELECTION_CHAIN,
  GENERIC_HOST_REQUIREMENTS,
  HOST_BINDING_CARD_IDS,
  HOST_CARD_REGISTRY,
  KIMI_BINDING_CARD,
  PB6_DRAFT_POINTS,
  PROBE_STATES,
  activateBinding,
  activationChain,
  activeActivation,
  capabilityDraftPoint,
  guardActivation,
  loadActiveBindingCard,
  loadBindingCard,
  loadCapabilityPacks,
  registerSelection,
  resolveCapabilityPacks,
  resolveDispatchTarget,
  unprovenProbeIdOf,
  validateBindingCard,
} from '../../src/bindcard/index.ts'
import {
  builtinResolver,
  effectiveCapabilities,
  familyOfExecutorName,
  loadAgentConfig,
  registerBuiltins,
  wireRegistry,
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

/** 抛错通道（agentconfig 走 configInvalid 抛错，不走 Result） */
function throwsConfigInvalid(fn: () => unknown): ClassifiedError {
  try {
    fn()
  } catch (e) {
    const err = e as Error & ClassifiedError
    expect(err.category).toBe('CONFIG_INVALID')
    return err
  }
  throw new Error('期望抛出 CONFIG_INVALID，实际未抛出——放行路径必须不存在')
}

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)

function genericClaim(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { assetId: 'pack.alpha', kind: 'skill', contentDigest: DIGEST_A, required: true, ...over }
}

function activationReq(over: Partial<BindingActivationRequest> = {}): BindingActivationRequest {
  return {
    cardId: 'BIND-DSH-01',
    hostVersion: DSH_HOST_VERSION,
    generation: 1,
    fenceEpoch: 1,
    decidedBy: '制作人',
    reason: 'IMPL-07-05 首代激活',
    ...over,
  }
}

function seedLedger(): { ledger: ActivationLedger; activationId: string } {
  const seeded = okOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq()))
  return { ledger: seeded.ledger, activationId: seeded.activation.activationId }
}

// ---------------------------------------------------------------------------
// ① BIND-DSH-01 卡字段（卡可查；必答行集；现状按面拆行）
// ---------------------------------------------------------------------------

describe('BIND-DSH-01 卡：必答行集与事实口径', () => {
  it('卡可查：标识/版本/宿主钉住/摘要未计算/ownerRef 非空', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.cardId).toBe('BIND-DSH-01')
    expect(card.cardVersion).toBe('v2.0')
    expect(card.family).toBe('dsh')
    expect(card.host.version).toBe('0.2.0-rc.2')
    expect(card.host.license).toBe('MIT')
    expect(card.digest.computed).toBe(false)
    expect(card.digest.note).toContain('未计算')
    expect(card.ownerRef.trim()).not.toBe('')
    expect(validateBindingCard(card)).toEqual([])
  })

  it('覆盖/不支持：覆盖含策略投影（目标），不支持逐条列且以「外部承接」收口', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.coverage.length).toBeGreaterThanOrEqual(6)
    expect(card.coverage.some((c) => c.includes('策略投影承载（目标'))).toBe(true)
    for (const item of ['组织/任命/禁配/验收/问责', '网络出站', '进程隔离', '秘密保管', '跨进程互斥', '权威激活']) {
      expect(card.unsupported).toContain(item)
    }
    expect(card.unsupported.join('')).toContain('外部承接')
    expect(card.authorization.mode).toBe('per-segment')
    expect(card.authorization.notAuthority).toContain('绑定不是授权')
  })

  it('载体映射：覆盖 §1.4 全表且「不可表达」单列 unmappable（不硬塞现状四值）', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.carrierMap.length).toBeGreaterThanOrEqual(14)
    const unmappable = card.carrierMap.filter((r) => r.unmappable === true)
    expect(unmappable.length).toBe(1)
    expect(unmappable[0]?.semantic).toContain('网络/进程/秘密/组织/验收/跨进程互斥')
    expect(unmappable[0]?.status).toBeUndefined()
    for (const row of card.carrierMap) {
      if (row.unmappable !== true) expect(CARD_FACT_STATUSES).toContain(row.status)
    }
    expect(card.carrierMap.find((r) => r.semantic === '工具呈现/PTC')?.status).toBe('未证')
  })

  it('损失行：BIND-LOSS-01…06＋10，severity 与 cannotClaim 齐备', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    const ids = card.losses.map((l) => l.lossId)
    for (const id of [
      'BIND-LOSS-01',
      'BIND-LOSS-02',
      'BIND-LOSS-03',
      'BIND-LOSS-04',
      'BIND-LOSS-05',
      'BIND-LOSS-06',
      'BIND-LOSS-10',
    ]) {
      expect(ids).toContain(id)
    }
    expect(card.losses.find((l) => l.lossId === 'BIND-LOSS-01')?.severity).toBe('blocking')
    expect(card.losses.find((l) => l.lossId === 'BIND-LOSS-10')?.cannotClaim).toContain('completed')
  })

  it('探针行：PRB-01…04/07…12/16…22 全为 not-executed（未执行不得写「预期通过」）', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    expect(card.probes.length).toBe(17)
    expect(card.probes.every((p) => PROBE_STATES.includes(p.state))).toBe(true)
    expect(card.probes.every((p) => p.state === 'not-executed')).toBe(true)
    for (const id of ['PRB-01', 'PRB-04', 'PRB-07', 'PRB-12', 'PRB-16', 'PRB-22']) {
      expect(card.probes.map((p) => p.probeId)).toContain(id)
    }
  })

  it('现状按面拆行：策略投影=目标、沙箱实际拦截=未证、命令形态=已有（每面恰一值）', () => {
    const card = okOf(loadBindingCard('BIND-DSH-01'))
    const face = (name: string) => card.faces.find((f) => f.face.includes(name))
    expect(face('策略投影')?.status).toBe('目标')
    expect(face('沙箱实际拦截')?.status).toBe('未证')
    expect(face('命令形态')?.status).toBe('已有')
    expect(face('长驻宿主')?.status).toBe('未证')
    const names = card.faces.map((f) => f.face)
    expect(new Set(names).size).toBe(names.length)
  })

  it('四张执行宿主卡都可查，且本包只认这四张（外域卡指名归属、不复制第二张表）', () => {
    for (const cardId of HOST_BINDING_CARD_IDS) {
      expect(okOf(loadBindingCard(cardId)).cardId).toBe(cardId)
    }
    expect(Object.keys(HOST_CARD_REGISTRY).sort()).toEqual([...HOST_BINDING_CARD_IDS].sort())
    expect(CLI_BINDING_CARD_IDS).toEqual({
      claude: 'BIND-CLI-CLAUDE-01',
      codex: 'BIND-CLI-CODEX-01',
      kimi: 'BIND-CLI-KIMI-01',
    })
    for (const foreign of [
      'BIND-PLAT-YT-01',
      'BIND-PLAT-TAIGA-01',
      'BIND-PLAT-LOCAL-01',
      'BIND-WS-01',
      'BIND-PRM-01',
      'dsh',
      '',
    ]) {
      const err = errOf(loadBindingCard(foreign))
      expect(err.subcause).toBe('bindcard/unknown-card')
      expect(err.detail ?? '').toContain('不复制第二张表')
    }
    expect(errOf(loadBindingCard('BIND-PLAT-YT-01')).detail).toContain('packages/yt')
  })

  it('版本不符＝弃用：宿主版本与卡钉住不符即拒（换宿主＝新档案，不静默降级）', () => {
    const err = errOf(loadBindingCard('BIND-DSH-01', '0.2.0'))
    expect(err.subcause).toBe('bindcard/host-mismatch')
    expect(err.detail ?? '').toContain('弃用')
    expect(errOf(loadBindingCard('BIND-CLI-CODEX-01', '0.2.0-rc.2')).subcause).toBe('bindcard/host-mismatch')
    expect(okOf(loadBindingCard('BIND-DSH-01', DSH_HOST_VERSION)).cardId).toBe('BIND-DSH-01')
  })

  it('卡是冻结常量：取到卡再顺手改＝不可能（机制不是注释）', () => {
    expect(Object.isFrozen(DSH_BINDING_CARD)).toBe(true)
    expect(Object.isFrozen(DSH_BINDING_CARD.faces)).toBe(true)
    expect(() => {
      ;(DSH_BINDING_CARD as unknown as { cardId: string }).cardId = 'BIND-DSH-99'
    }).toThrow(TypeError)
    expect(DSH_BINDING_CARD.cardId).toBe('BIND-DSH-01')
  })

  it('坏卡装载期拒收：摘要冒充校验位/无主/现状混写/探针状态非法/损失 ID 非法', () => {
    const base = okOf(loadBindingCard('BIND-DSH-01'))
    const badProbe = { probeId: 'PRB-01', state: '可能通过' as unknown as ProbeState }
    const broken: BindingCard[] = [
      { ...base, ownerRef: '  ' },
      { ...base, digest: { computed: true, note: '假装已计算' } as unknown as BindingCard['digest'] },
      { ...base, carrierMap: [{ semantic: 'x', carrier: 'y', strength: '—' }] },
      { ...base, carrierMap: [{ semantic: 'x', carrier: 'y', strength: '—', status: '目标', unmappable: true }] },
      { ...base, probes: [badProbe] },
      { ...base, losses: [{ lossId: 'LOSS-1', severity: 'degrading', description: 'x', cannotClaim: 'y' }] },
      {
        ...base,
        faces: [
          { face: '同一面', status: '已有', anchor: 'a' },
          { face: '同一面', status: '目标', anchor: 'a' },
        ],
      },
    ]
    for (const card of broken) {
      expect(validateBindingCard(card).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// ①′ 专属/通用二分
// ---------------------------------------------------------------------------

describe('专属/通用二分：DSH 专属面（换宿主明示不可用）vs 通用必达面', () => {
  it('专属面六项均指名目标执行器 dsh＋损失引用＋不得宣称', () => {
    expect(DSH_EXCLUSIVE_FACES.length).toBe(6)
    for (const face of DSH_EXCLUSIVE_FACES) {
      expect(face.binding).toBe('exclusive')
      expect(face.targetExecutor).toBe('dsh')
      expect(face.lossRef.startsWith('BIND-LOSS-')).toBe(true)
      expect(face.cannotClaim.trim()).not.toBe('')
      expect(CARD_FACT_STATUSES).toContain(face.status)
    }
    const ids = DSH_EXCLUSIVE_FACES.map((f) => f.faceId)
    expect(ids).toContain('position-policy-projection')
    expect(ids).toContain('dsh-plugin-asset')
  })

  it('通用必达面六项：换宿主仍必须满足（续跑或明报降级、声明不超证据）', () => {
    expect(GENERIC_HOST_REQUIREMENTS.length).toBe(6)
    const ids = GENERIC_HOST_REQUIREMENTS.map((r) => r.requirementId)
    expect(ids).toContain('session-resume-or-degrade')
    expect(ids).toContain('claims-not-exceed-evidence')
    expect(
      GENERIC_HOST_REQUIREMENTS.find((r) => r.requirementId === 'claims-not-exceed-evidence')?.rule,
    ).toContain('按不支持')
  })

  it('三张 CLI 卡都明示「DSH 专属面换宿主即不可用」，不冒充等价承载', () => {
    for (const card of [CLAUDE_BINDING_CARD, CODEX_BINDING_CARD, KIMI_BINDING_CARD]) {
      expect(card.unsupported.join('')).toContain('DSH 专属能力面')
      expect(card.supply.join('')).toContain('版本未钉')
      expect(card.losses.length).toBe(1)
      expect(card.exportExit.exit.trim()).not.toBe('')
    }
    expect(KIMI_BINDING_CARD.faces.find((f) => f.face.includes('适配器接入'))?.status).toBe('库级')
    expect(CODEX_BINDING_CARD.faces.find((f) => f.face.includes('会话续跑'))?.status).toBe('未证')
  })
})

// ---------------------------------------------------------------------------
// ② 激活代次＋围栏
// ---------------------------------------------------------------------------

describe('激活代次＋围栏：两轴独立、幂等重放、回退拒收', () => {
  it('首代激活：代次/围栏纪元/具名决定/token 两轴分离', () => {
    const seeded = okOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq()))
    const activation = seeded.activation
    expect(activation.domain).toBe('DOM-06')
    expect(activation.state).toBe('active')
    expect(activation.supersedes).toBeNull()
    expect(activation.generation).toBe(1)
    expect(activation.fence.epoch).toBe(1)
    expect(activation.fence.token).toContain('#fence-1')
    expect(activation.fence.token).not.toContain('#gen-')
    expect(activation.generationToken).toContain('#gen-1')
    expect(activation.generationToken).not.toContain('#fence-')
    expect(activeActivation(seeded.ledger, 'BIND-DSH-01')?.activationId).toBe(activation.activationId)
  })

  it('幂等重放：同（卡,代次,围栏,决定人,理由）重放不新增（REC-AUTH-07 幂等键）', () => {
    const first = seedLedger()
    const replay = okOf(activateBinding(first.ledger, activationReq()))
    expect(replay.ledger).toBe(first.ledger)
    expect(replay.activation.activationId).toBe(first.activationId)
  })

  it('同代次异内容＝竞争代次：保持冻结交终裁（generation-conflict）', () => {
    const first = seedLedger()
    const err = errOf(activateBinding(first.ledger, activationReq({ reason: '另一份决定' })))
    expect(err.subcause).toBe('bindcard/generation-conflict')
    expect(err.detail ?? '').toContain('冻结')
  })

  it('第二代取代第一代，旧代记 superseded；旧证明被围栏', () => {
    const first = seedLedger()
    const second = okOf(
      activateBinding(
        first.ledger,
        activationReq({ generation: 2, fenceEpoch: 2, reason: 'IF 变更后换段（新决定＋新代次）' }),
      ),
    )
    expect(second.activation.supersedes).toBe(first.activationId)
    const chain = activationChain(second.ledger, 'BIND-DSH-01')
    expect(chain.length).toBe(2)
    expect(chain[0]?.state).toBe('superseded')
    expect(chain[1]?.state).toBe('active')
    // 旧账本不可变（新账本不回收写旧对象）
    expect(first.ledger.activations.length).toBe(1)
    const stale = errOf(
      guardActivation(second.ledger, {
        cardId: 'BIND-DSH-01',
        hostVersion: DSH_HOST_VERSION,
        generation: 1,
        fenceEpoch: 1,
      }),
    )
    expect(stale.subcause).toBe('bindcard/generation-stale')
  })

  it('两轴不得互推（TERM-35）：代次当前但围栏落后 → fence-stale；反之 → generation-stale', () => {
    const first = seedLedger()
    const second = okOf(
      activateBinding(
        first.ledger,
        activationReq({ generation: 2, fenceEpoch: 5, reason: '代次与围栏各自前进' }),
      ),
    )
    const fenceStale = errOf(
      guardActivation(second.ledger, {
        cardId: 'BIND-DSH-01',
        hostVersion: DSH_HOST_VERSION,
        generation: 2,
        fenceEpoch: 1,
      }),
    )
    expect(fenceStale.subcause).toBe('bindcard/fence-stale')
    const genStale = errOf(
      guardActivation(second.ledger, {
        cardId: 'BIND-DSH-01',
        hostVersion: DSH_HOST_VERSION,
        generation: 1,
        fenceEpoch: 5,
      }),
    )
    expect(genStale.subcause).toBe('bindcard/generation-stale')
    // 代次前进但围栏不前进：激活期即拒（不得用代次合法推围栏合法）
    const widen = errOf(
      activateBinding(
        second.ledger,
        activationReq({ generation: 3, fenceEpoch: 5, reason: '代次前进、围栏不动' }),
      ),
    )
    expect(widen.subcause).toBe('bindcard/fence-stale')
  })

  it('越序自封拒收：generation/fence 超前＝未来代次不受理', () => {
    const first = seedLedger()
    expect(
      errOf(
        guardActivation(first.ledger, {
          cardId: 'BIND-DSH-01',
          hostVersion: DSH_HOST_VERSION,
          generation: 9,
          fenceEpoch: 9,
        }),
      ).subcause,
    ).toBe('bindcard/generation-ahead')
    expect(
      errOf(
        guardActivation(first.ledger, {
          cardId: 'BIND-DSH-01',
          hostVersion: DSH_HOST_VERSION,
          generation: 1,
          fenceEpoch: 9,
        }),
      ).subcause,
    ).toBe('bindcard/fence-ahead')
  })

  it('未激活不得驱动派发；宿主版本不符＝旧卡不加载；无主决定/空依据/非法代次一律拒', () => {
    expect(
      errOf(
        guardActivation(EMPTY_ACTIVATION_LEDGER, {
          cardId: 'BIND-DSH-01',
          hostVersion: DSH_HOST_VERSION,
          generation: 1,
          fenceEpoch: 1,
        }),
      ).subcause,
    ).toBe('bindcard/not-activated')
    const first = seedLedger()
    expect(
      errOf(
        guardActivation(first.ledger, {
          cardId: 'BIND-DSH-01',
          hostVersion: '0.1.0',
          generation: 1,
          fenceEpoch: 1,
        }),
      ).subcause,
    ).toBe('bindcard/host-mismatch')
    expect(errOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq({ decidedBy: '系统' }))).subcause).toBe(
      'bindcard/decision-anonymous',
    )
    expect(errOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq({ reason: ' ' }))).subcause).toBe(
      'bindcard/decision-incomplete',
    )
    expect(errOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq({ generation: 0 }))).subcause).toBe(
      'bindcard/generation-invalid',
    )
    expect(errOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq({ fenceEpoch: 0 }))).subcause).toBe(
      'bindcard/fence-invalid',
    )
    expect(errOf(activateBinding(EMPTY_ACTIVATION_LEDGER, activationReq({ hostVersion: '0.1.0' }))).subcause).toBe(
      'bindcard/host-mismatch',
    )
  })

  it('loadActiveBindingCard：围栏通过才返回卡本体＋当前激活', () => {
    const first = seedLedger()
    const loaded = okOf(
      loadActiveBindingCard(first.ledger, {
        cardId: 'BIND-DSH-01',
        hostVersion: DSH_HOST_VERSION,
        generation: 1,
        fenceEpoch: 1,
      }),
    )
    expect(loaded.activation.activationId).toBe(first.activationId)
    expect(loaded.card.cardId).toBe('BIND-DSH-01')
    expect(
      errOf(
        loadActiveBindingCard(first.ledger, {
          cardId: 'BIND-DSH-01',
          hostVersion: DSH_HOST_VERSION,
          generation: 2,
          fenceEpoch: 2,
        }),
      ).subcause,
    ).toBe('bindcard/generation-ahead')
  })
})

// ---------------------------------------------------------------------------
// ③ 能力包只携引用／公司包不自封权威／专属·通用二分
// ---------------------------------------------------------------------------

describe('能力包引用：只携引用、不自封权威、缺目标执行器明示不可用', () => {
  it('合法引用：generic＋exclusive 双形，产物只含引用面（带 installAuthorization=required）', () => {
    const loaded = okOf(
      loadCapabilityPacks([
        genericClaim({ binding: 'generic' }),
        {
          assetId: 'pack.dsh-plugin',
          kind: 'plugin',
          binding: 'exclusive',
          targetExecutor: 'dsh',
          contentDigest: DIGEST_B,
          required: true,
          compatibility: ['dsh@0.2.0-rc.2'],
        },
      ]),
    )
    expect(loaded.refs.length).toBe(2)
    expect(loaded.warnings).toEqual([])
    const exclusive = loaded.refs[1]
    expect(exclusive?.binding).toBe('exclusive')
    expect(exclusive?.targetExecutor).toBe('dsh')
    expect(exclusive?.installAuthorization).toBe('required')
    expect(exclusive?.refId).toBe(`pack.dsh-plugin@${DIGEST_B.slice(0, 12)}`)
    expect('content' in (exclusive ?? {})).toBe(false)
    expect('authorized' in (exclusive ?? {})).toBe(false)
  })

  it('只携引用：出现内嵌内容即拒（字节装载归公司资产部，绑定面不二次实现）', () => {
    const err = errOf(loadCapabilityPacks([genericClaim({ content: 'inline-bytes' })]))
    expect(err.subcause).toBe('bindcard/capability-embedded-content')
    expect(err.detail ?? '').toContain('只携引用')
    expect(errOf(loadCapabilityPacks([genericClaim({ files: ['a'] })])).subcause).toBe(
      'bindcard/capability-embedded-content',
    )
  })

  it('公司包不自封权威：authorized/grantedBy/authority/installAuthorization=granted 一律拒', () => {
    for (const claim of [
      genericClaim({ authorized: true }),
      genericClaim({ grantedBy: '制作人' }),
      genericClaim({ authority: 'root' }),
      genericClaim({ installAuthorization: 'granted' }),
    ]) {
      const err = errOf(loadCapabilityPacks([claim]))
      expect(err.subcause).toBe('bindcard/capability-self-authority')
      expect(err.detail ?? '').toContain('授权链')
    }
    expect(
      okOf(loadCapabilityPacks([genericClaim({ installAuthorization: 'required' })])).refs[0]?.installAuthorization,
    ).toBe('required')
  })

  it('专属/通用二分：缺标记按通用并警示；exclusive 必填目标执行器；generic 不得标目标', () => {
    const loaded = okOf(loadCapabilityPacks([genericClaim()]))
    expect(loaded.refs[0]?.binding).toBe('generic')
    expect(loaded.warnings[0]?.code).toBe('W-SCH-002')
    expect(errOf(loadCapabilityPacks([genericClaim({ binding: 'exclusive' })])).subcause).toBe(
      'bindcard/capability-target-missing',
    )
    expect(
      errOf(loadCapabilityPacks([genericClaim({ binding: 'generic', targetExecutor: 'dsh' })])).subcause,
    ).toBe('bindcard/capability-binding-conflict')
    expect(
      errOf(loadCapabilityPacks([genericClaim({ binding: 'exclusive', targetExecutor: 'nova' })])).subcause,
    ).toBe('bindcard/capability-target-unknown')
  })

  it('形状面拒收：未知类型/坏摘要/未知专属标记/重名/非对象条目/坏标识', () => {
    expect(errOf(loadCapabilityPacks([genericClaim({ kind: 'binary' })])).subcause).toBe(
      'bindcard/capability-kind-unknown',
    )
    expect(errOf(loadCapabilityPacks([genericClaim({ contentDigest: 'deadbeef' })])).subcause).toBe(
      'bindcard/capability-digest-invalid',
    )
    expect(errOf(loadCapabilityPacks([genericClaim({ binding: 'shared' })])).subcause).toBe(
      'bindcard/capability-binding-unknown',
    )
    expect(errOf(loadCapabilityPacks([genericClaim(), genericClaim()])).subcause).toBe('bindcard/capability-dup')
    expect(errOf(loadCapabilityPacks(['pack.alpha'])).subcause).toBe('bindcard/capability-shape')
    expect(errOf(loadCapabilityPacks([{ kind: 'skill', contentDigest: DIGEST_A }])).subcause).toBe(
      'bindcard/capability-id-invalid',
    )
  })

  it('可用性判定：专属缺目标执行器＝incompatible（明示不可用，不静默丢；必备进 unavailableRequired）', () => {
    const refs = okOf(
      loadCapabilityPacks([
        genericClaim(),
        {
          assetId: 'pack.dsh-only',
          kind: 'plugin',
          binding: 'exclusive',
          targetExecutor: 'dsh',
          contentDigest: DIGEST_B,
          required: true,
        },
      ]),
    ).refs
    const withDsh = resolveCapabilityPacks(refs, ['dsh'])
    expect(withDsh.rows.map((r) => r.state)).toEqual(['applicable', 'applicable'])
    expect(withDsh.rows[1]?.reason).toBe('target-executor-available')
    const withoutDsh = resolveCapabilityPacks(refs, ['claude'])
    expect(withoutDsh.rows.map((r) => r.state)).toEqual(['applicable', 'incompatible'])
    expect(withoutDsh.rows[1]?.reason).toBe('missing-executor')
    expect(withoutDsh.unavailableRequired.map((r) => r.assetId)).toEqual(['pack.dsh-only'])
    expect(withoutDsh.rows.every((r) => r.installAuthorization === 'required')).toBe(true)
    expect(withoutDsh.note).toContain('传播≠授权')
    // 未知执行器名＝不具备（fail-closed，不因拼写宽松放行）
    expect(resolveCapabilityPacks(refs, ['DSH']).rows[1]?.state).toBe('incompatible')
  })
})

// ---------------------------------------------------------------------------
// ④ NEG-RUN-05：未登记选择链直连非主绑定执行器被拒
// ---------------------------------------------------------------------------

describe('NEG-RUN-05：执行器选择链（未登记直连＝拒；选择≠授权）', () => {
  it('负向：无登记链直连非主绑定执行器 → selection-unregistered（放行路径必须不存在）', () => {
    const err = errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'IMPL-07-05', executor: 'codex' }))
    expect(err.subcause).toBe('dispatch/selection-unregistered')
    expect(err.detail ?? '').toContain('NEG-RUN-05')
    expect(err.detail ?? '').toContain('GAP-V2-04')
    for (const executor of ['claude', 'codex', 'kimi']) {
      expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor })).subcause).toBe(
        'dispatch/selection-unregistered',
      )
    }
  })

  it('主绑定 dsh 走缺省链（默认＝DSH，无需登记）；选择结果恒非授权', () => {
    const picked = okOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T-1', executor: 'dsh' }))
    expect(picked.source).toBe('default')
    expect(picked.chainId).toBe('default:primary')
    expect(picked.authorization).toBe('not-granted-here')
    expect('granted' in picked).toBe(false)
  })

  it('登记后放行：单据指定 claude 的链只放行 claude（chainId 记来源）', () => {
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-2',
        executor: 'claude',
        source: 'ticket',
        registeredBy: '制作人',
        reason: '异源复核（单据指定）',
      }),
    )
    const picked = okOf(resolveDispatchTarget(chain, { ticket: 'T-2', executor: 'claude' }))
    expect(picked.executor).toBe('claude')
    expect(picked.chainId).toBe('ticket:T-2')
    expect(picked.source).toBe('ticket')
    expect(picked.authorization).toBe('not-granted-here')
  })

  it('登记链说的不是它 → selection-mismatch（不得绕登记改派）', () => {
    const chain = okOf(
      registerSelection(EMPTY_SELECTION_CHAIN, {
        ticket: 'T-3',
        executor: 'claude',
        source: 'position',
        positionRef: 'position.qa',
        registeredBy: '制作人',
        reason: '岗位绑定：复核岗走 claude',
      }),
    )
    const err = errOf(resolveDispatchTarget(chain, { ticket: 'T-3', executor: 'kimi' }))
    expect(err.subcause).toBe('dispatch/selection-mismatch')
    expect(err.detail ?? '').toContain('claude')
  })

  it('未登记执行器名/空单号/无主登记/position 缺引用/同链异内容一律拒；同内容重登记幂等', () => {
    expect(errOf(resolveDispatchTarget(EMPTY_SELECTION_CHAIN, { ticket: 'T', executor: 'probe-x' })).subcause).toBe(
      'dispatch/executor-unknown',
    )
    const entry = {
      ticket: 'T-4',
      executor: 'kimi' as const,
      source: 'ticket' as const,
      registeredBy: '制作人',
      reason: '跨家复核',
    }
    expect(errOf(registerSelection(EMPTY_SELECTION_CHAIN, { ...entry, ticket: ' ' })).subcause).toBe(
      'dispatch/selection-invalid',
    )
    expect(errOf(registerSelection(EMPTY_SELECTION_CHAIN, { ...entry, registeredBy: '' })).subcause).toBe(
      'dispatch/selection-invalid',
    )
    expect(errOf(registerSelection(EMPTY_SELECTION_CHAIN, { ...entry, source: 'position' })).subcause).toBe(
      'dispatch/selection-invalid',
    )
    const first = okOf(registerSelection(EMPTY_SELECTION_CHAIN, entry))
    expect(okOf(registerSelection(first, entry))).toBe(first)
    expect(errOf(registerSelection(first, { ...entry, reason: '换个理由' })).subcause).toBe(
      'dispatch/selection-conflict',
    )
  })
})

// ---------------------------------------------------------------------------
// ⑤ PB-6 拟稿点登记＋agentconfig 未证能力对齐
// ---------------------------------------------------------------------------

describe('PB-6 拟稿点登记：未证按不支持（声明面/注册面对齐）', () => {
  it('登记表：codex/kimi session_resume 挂 PRB-25/26、disposition=unsupported、探针 not-executed', () => {
    expect(PB6_DRAFT_POINTS.length).toBeGreaterThanOrEqual(4)
    const codex = capabilityDraftPoint('codex', 'session_resume')
    expect(codex?.probeId).toBe('PRB-25')
    expect(codex?.disposition).toBe('unsupported')
    expect(codex?.probeState).toBe('not-executed')
    expect(codex?.batch).toBe('PB-6')
    expect(capabilityDraftPoint('kimi', 'session_resume')?.probeId).toBe('PRB-26')
    expect(unprovenProbeIdOf('codex', 'session_resume')).toBe('PRB-25')
    expect(unprovenProbeIdOf('kimi', 'session_resume')).toBe('PRB-26')
    // 非布尔面只登记不改值（不改变合法行为）
    expect(capabilityDraftPoint('codex', 'agents_md')?.disposition).toBe('registered-only')
    expect(unprovenProbeIdOf('codex', 'agents_md')).toBeUndefined()
    // 有证据的家不登记（dsh 真机实证／claude 较硬）
    expect(capabilityDraftPoint('dsh', 'session_resume')).toBeUndefined()
    expect(capabilityDraftPoint('claude', 'session_resume')).toBeUndefined()
  })

  it('有效声明：codex/kimi 续跑翻 false，其余字段原样；dsh/未知家返回原引用（合法面零改动）', () => {
    const codex = new CodexAdapter()
    const aligned = effectiveCapabilities('codex', codex.capabilities)
    expect(aligned.session_resume).toBe(false)
    expect(aligned.budget_cap).toBe(codex.capabilities.budget_cap)
    expect(aligned.agents_md).toBe(codex.capabilities.agents_md)
    const kimi = new KimiAdapter()
    expect(effectiveCapabilities('kimi', kimi.capabilities).session_resume).toBe(false)
    expect(effectiveCapabilities('dsh', codex.capabilities)).toBe(codex.capabilities)
    expect(effectiveCapabilities('probe-x', codex.capabilities)).toBe(codex.capabilities)
    // 适配器本体零改动：静态声明仍是拟稿 true（改它须 PRB 证据另行立单）
    expect(codex.capabilities.session_resume).toBe(true)
    expect(kimi.capabilities.session_resume).toBe(true)
    // 家族名归一：judge/档位注册位归基础家族
    expect(familyOfExecutorName('codex-high')).toBe('codex')
    expect(familyOfExecutorName('kimi-judge')).toBe('kimi')
    expect(familyOfExecutorName('probe-x')).toBeUndefined()
  })

  it('注册面：registerBuiltins 的 codex/kimi 声明续跑=false，dsh/claude 原样（能力路由随之收口）', () => {
    const registry = registerBuiltins(createRegistry())
    expect(registry.resolve('codex').capabilities.session_resume).toBe(false)
    expect(registry.resolve('kimi').capabilities.session_resume).toBe(false)
    expect(registry.resolve('dsh').capabilities.session_resume).toBe(true)
    expect(registry.resolve('claude').capabilities.session_resume).toBe(true)
    expect(registry.pickAll({ sessionResume: true }).map((a) => a.name)).toEqual(['dsh', 'claude'])
    expect(registry.pickAll({ sessionResume: false }).map((a) => a.name)).toEqual(['codex', 'kimi'])
    // 适配器方法面未被替换（委托到本体；不是假适配器）
    expect(registry.resolve('codex').name).toBe('codex')
    expect(typeof registry.resolve('codex').launch).toBe('function')
  })

  it('配置面：agent.yaml 给 codex/kimi 写 session_resume:true → cap-unproven（写 false/省略照过）', () => {
    const overClaim = throwsConfigInvalid(() =>
      wireRegistry(
        createRegistry(),
        loadAgentConfig('executors:\n  kimi:\n    capabilities:\n      session_resume: true\n'),
        builtinResolver,
      ),
    )
    expect(overClaim.subcause).toBe('agentconfig/cap-unproven')
    expect(overClaim.detail ?? '').toContain('PRB-26')
    const honest = wireRegistry(
      createRegistry(),
      loadAgentConfig('executors:\n  codex:\n    capabilities:\n      session_resume: false\n      budget_cap: false\n'),
      builtinResolver,
    )
    expect(honest.resolve('codex').capabilities.session_resume).toBe(false)
    // 合法行为不变：dsh 续跑声明仍过
    expect(
      wireRegistry(
        createRegistry(),
        loadAgentConfig('executors:\n  dsh:\n    default: true\n    capabilities: { session_resume: true }\n'),
        builtinResolver,
      ).defaultName(),
    ).toBe('dsh')
    // 普通伪造能力仍是 cap-drift（不是被吞掉）
    expect(
      throwsConfigInvalid(() =>
        wireRegistry(
          createRegistry(),
          loadAgentConfig('executors:\n  dsh:\n    capabilities:\n      budget_cap: true\n'),
          builtinResolver,
        ),
      ).subcause,
    ).toBe('agentconfig/cap-drift')
  })
})
