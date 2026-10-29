/**
 * test/v2/capability-gap —— NEG-RING-03 五出口必答（能力环；V2 层证据）
 *
 * 依据：v2/17 §4.1 NEG-RING-03（缺能力/退化/成本失控仍接单→缩/换/外援/拒绝/停止五出口
 *       必答，02 §五）、§3.3 TR-RING-03（能力环 V1＋V3 行）、v2/02 §五（四答＋处置阶梯＋
 *       不得虚构能力/降低验收口径/静默退化）、v2/05 §五 能力环行（缺能力/退化/成本失控须
 *       缩/换/外援/拒绝/停止）、v2/04 §二（受理五取值：拒绝须附理由；无能力须明示缺口与
 *       替代路径）、§四（能力退化/更换＝重判，不是继续）、v2/07 §一 CAP-03（换能力＝生效
 *       事务）、§六（替换级别/换能力触发重判）、v2/01 §四 R-7（退化/不可用/成本失控→明示
 *       不能；降级/替换/拒绝或停止；不得降标冒充完成）。
 *
 * 断言面：五出口各一正＋每类×每出口可决（不给 kind→exit 矩阵）；负例逐条＝缺出口、
 * 多出口（含同出口两写）、三件缺失（理由/授权引用/影响）、继续形代替出口、封闭集外值、
 * 未分类缺口、四答前两项空转。分布断言不靠覆盖率数字充当负例（plan/04 §1.3）。
 *
 * 零 IO：不 import fs/net/child_process；本件不取时钟（时点由调用方落记录时携带），
 *       同输入恒同决策——确定性由「两次调用深等」与「无时钟入参」共同表达。
 *
 * 验证级诚实注：NEG-RING-03 主表为 V1＋V3——本文件只给 **V2（core 纯函数）** 证据；
 *               V1 契约 case 与 V3 fake 集成面不在本文件冒充（缺口随交付报告上呈）。
 *
 * 变异验证（2026-10-29 人工执行，非本文件自动化）：对 src 五个守卫逐一短路——出口封闭集／
 * 理由／多出口／未分类／缺出口——test:v2 单文件分别红 5／2／2／1／5 条；还原后源件
 * SHA-256 回原值并复跑 39/39 绿。守卫非装饰；原始输出留交付报告。
 */
import { describe, expect, it } from 'vitest'
import type {
  CapabilityGapDeclaration,
  CapabilityGapExitClaim,
  CapabilityGapInput,
} from '../../src/capability-gap.ts'
import {
  CAPABILITY_GAP_ANSWERS,
  CAPABILITY_GAP_CONTINUATION_FORMS,
  CAPABILITY_GAP_EXITS,
  CAPABILITY_GAP_KINDS,
  decideCapabilityGap,
} from '../../src/capability-gap.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 一、夹具（最小声明面；默认值＝一个合法可决的缺口声明）
// ─────────────────────────────────────────────────────────────────────────────

function declaration(overrides: Partial<CapabilityGapDeclaration> = {}): CapabilityGapDeclaration {
  return {
    gapRef: 'gap/2026-10-29/dept-head-1',
    kind: 'missing',
    capabilityRef: 'capability.dsh.session-resume',
    impactRef: 'work/commitment-731',
    durationRef: 'review/2026-11-05',
    alternativeRefs: ['capability.alt-cli'],
    ...overrides,
  }
}

function exitClaim(exit: string, overrides: Partial<CapabilityGapExitClaim> = {}): CapabilityGapExitClaim {
  return {
    exit,
    reason: '缩小到已认定范围，缺口不落在验收口径内',
    authorityRef: 'REC-AUTH-02/ver-3',
    impactRef: 'work/commitment-731 范围收窄，验收口径不降',
    ...overrides,
  }
}

function gapInput(overrides: Partial<CapabilityGapInput> = {}): CapabilityGapInput {
  return { declaration: declaration(), dispositions: [exitClaim('reduce')], ...overrides }
}

type GapResult = ReturnType<typeof decideCapabilityGap>
type GapDecision = Extract<GapResult, { readonly kind: 'ok' }>['value']
type GapFailure = Extract<GapResult, { readonly kind: 'err' }>['error']

function expectOk(result: GapResult): GapDecision {
  if (result.kind !== 'ok') {
    throw new Error(`期望 ok，实得 err：${result.error.subcause}｜${result.error.detail}`)
  }
  return result.value
}

/** Err 的说明文本（PortFailure.detail 是可选字段；按空串兜底，判据不依赖可选性） */
function detailOf(failure: GapFailure): string {
  return failure.detail ?? ''
}

function expectRejected(result: GapResult, subcause: string): GapFailure {
  if (result.kind !== 'err') {
    throw new Error(`期望 err（${subcause}），实得 ok：${JSON.stringify(result.value)}`)
  }
  expect(result.error.subcause).toBe(subcause)
  return result.error
}

/** 类别中文标签（只用于断言错误说明「点名了哪一类缺口」，非判据本体） */
const KIND_LABEL: Readonly<Record<'degraded' | 'cost_runaway', string>> = {
  degraded: '能力退化',
  cost_runaway: '成本失控',
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、封闭值集（五出口是 NEG-RING-03 的验收口径本体）
// ─────────────────────────────────────────────────────────────────────────────

describe('NEG-RING-03 五出口封闭面', () => {
  it('五出口恰为缩/换/外援/拒绝/停止（顺序＝02 §五 处置阶梯序，不是优先级）', () => {
    expect([...CAPABILITY_GAP_EXITS]).toEqual(['reduce', 'replace', 'external', 'refuse', 'stop'])
    expect(CAPABILITY_GAP_EXITS.length).toBe(5)
  })

  it('缺口类别恰三值（缺能力/退化/成本失控）', () => {
    expect([...CAPABILITY_GAP_KINDS]).toEqual(['missing', 'degraded', 'cost_runaway'])
  })

  it('四答携带项恰两项（持续多久/有何替代）', () => {
    expect([...CAPABILITY_GAP_ANSWERS]).toEqual(['duration', 'alternative'])
  })

  it('继续形语形不是出口：与五出口无交集', () => {
    const exitSet = new Set<string>(CAPABILITY_GAP_EXITS)
    for (const form of CAPABILITY_GAP_CONTINUATION_FORMS) {
      expect(exitSet.has(form)).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 三、正例：五出口各一正＋每类×每出口可决
// ─────────────────────────────────────────────────────────────────────────────

describe('正例：恰选五出口之一即成立', () => {
  for (const exit of CAPABILITY_GAP_EXITS) {
    it(`出口 ${exit}：单一声明即决，理由/授权引用/影响齐备`, () => {
      const decision = expectOk(decideCapabilityGap(gapInput({ dispositions: [exitClaim(exit)] })))
      expect(decision.disposition.exit).toBe(exit)
      expect(decision.disposition.reason).toBe('缩小到已认定范围，缺口不落在验收口径内')
      expect(decision.disposition.authorityRef).toBe('REC-AUTH-02/ver-3')
      expect(decision.disposition.impactRef).toBe('work/commitment-731 范围收窄，验收口径不降')
      expect(decision.declaration.kind).toBe('missing')
      expect(decision.declaration.gapRef).toBe('gap/2026-10-29/dept-head-1')
      expect([...decision.missingAnswers]).toEqual([])
    })
  }

  it('全部类别 × 全部出口均可决（本件不造 kind→exit 矩阵）', () => {
    let decided = 0
    for (const kind of CAPABILITY_GAP_KINDS) {
      for (const exit of CAPABILITY_GAP_EXITS) {
        const decision = expectOk(
          decideCapabilityGap(gapInput({ declaration: declaration({ kind }), dispositions: [exitClaim(exit)] })),
        )
        expect(decision.declaration.kind).toBe(kind)
        expect(decision.disposition.exit).toBe(exit)
        decided += 1
      }
    }
    expect(decided).toBe(CAPABILITY_GAP_KINDS.length * CAPABILITY_GAP_EXITS.length)
  })

  it('四答原样携带：缺什么/影响什么/持续多久/有何替代', () => {
    const decision = expectOk(
      decideCapabilityGap(
        gapInput({
          declaration: declaration({
            gapRef: 'gap/2',
            kind: 'degraded',
            capabilityRef: 'capability.dsh.sandbox',
            impactRef: 'work/commitment-9',
            durationRef: 'review/2026-11-12',
            alternativeRefs: ['capability.alt-cli', 'capability.remote-service'],
          }),
          dispositions: [exitClaim('replace')],
        }),
      ),
    )
    expect(decision.declaration).toEqual({
      gapRef: 'gap/2',
      kind: 'degraded',
      capabilityRef: 'capability.dsh.sandbox',
      impactRef: 'work/commitment-9',
      durationRef: 'review/2026-11-12',
      alternativeRefs: ['capability.alt-cli', 'capability.remote-service'],
    })
    expect(decision.missingAnswers).toEqual([])
  })

  it('声明值归一：Cost-Runaway→cost_runaway、 REPLACE →replace（只归一判定，不改原文引用）', () => {
    const decision = expectOk(
      decideCapabilityGap(
        gapInput({
          declaration: declaration({ kind: 'Cost-Runaway' }),
          dispositions: [exitClaim(' REPLACE ')],
        }),
      ),
    )
    expect(decision.declaration.kind).toBe('cost_runaway')
    expect(decision.disposition.exit).toBe('replace')
  })

  it('同输入恒同决策（纯函数、无时钟/无随机）', () => {
    const input = gapInput()
    const first = expectOk(decideCapabilityGap(input))
    const second = expectOk(decideCapabilityGap(input))
    expect(second).toEqual(first)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 四、负例：缺出口／多出口／无理由／默认继续（NEG-RING-03 逐条）
// ─────────────────────────────────────────────────────────────────────────────

describe('负例：缺出口（不得默认继续）', () => {
  it('未给处置出口（dispositions 缺省）→ Err gap-exit-missing', () => {
    const failure = expectRejected(decideCapabilityGap(gapInput({ dispositions: undefined })), 'gap-exit-missing')
    expect(detailOf(failure)).toContain('不得默认继续')
    expect(detailOf(failure)).toContain('五出口')
  })

  it('空出口列表 → Err gap-exit-missing（空列表不是「无缺口」）', () => {
    expectRejected(decideCapabilityGap(gapInput({ dispositions: [] })), 'gap-exit-missing')
  })

  for (const kind of ['degraded', 'cost_runaway'] as const) {
    it(`${KIND_LABEL[kind]}：无出口不得默认继续（错误说明点名类别）`, () => {
      const failure = expectRejected(
        decideCapabilityGap(gapInput({ declaration: declaration({ kind }), dispositions: [] })),
        'gap-exit-missing',
      )
      expect(detailOf(failure)).toContain(KIND_LABEL[kind])
      expect(detailOf(failure)).toContain('不得默认继续')
    })
  }
})

describe('负例：出口多于一个（并列不是选择）', () => {
  it('两个不同出口 → Err gap-exit-multiple', () => {
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('reduce'), exitClaim('stop')] })),
      'gap-exit-multiple',
    )
    expect(detailOf(failure)).toContain('reduce')
    expect(detailOf(failure)).toContain('stop')
    expect(detailOf(failure)).toContain('2 个')
  })

  it('同一出口声明两次仍按「多于一个」拒（重写不构成一次选择）', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('external'), exitClaim('external')] })),
      'gap-exit-multiple',
    )
  })
})

describe('负例：以「继续原路径/接受风险」代替出口', () => {
  it('exit=continue → Err gap-exit-not-closed（rejected_forbidden）', () => {
    const failure = expectRejected(decideCapabilityGap(gapInput({ dispositions: [exitClaim('continue')] })), 'gap-exit-not-closed')
    expect(failure.category).toBe('rejected_forbidden')
    expect(detailOf(failure)).toContain('继续原路径')
    expect(detailOf(failure)).toContain('接受风险')
  })

  it('exit=accept_risk → Err（同一判据，不因语形放行）', () => {
    const failure = expectRejected(decideCapabilityGap(gapInput({ dispositions: [exitClaim('accept_risk')] })), 'gap-exit-not-closed')
    expect(failure.category).toBe('rejected_forbidden')
  })

  it('全部继续形语形一律拒（逐形过判，无一例外）', () => {
    for (const form of CAPABILITY_GAP_CONTINUATION_FORMS) {
      const failure = expectRejected(decideCapabilityGap(gapInput({ dispositions: [exitClaim(form)] })), 'gap-exit-not-closed')
      expect(failure.category).toBe('rejected_forbidden')
      expect(detailOf(failure)).toContain('不得以')
    }
  })

  it('封闭集外未知值 → Err gap-exit-not-closed（按前置条件拒，不按禁止）', () => {
    // 02 §五 阶梯里的「补足能力」未被 17 §4.1/05 §五 列入五出口：本件按封闭集外值拒，
    // 第六出口的取舍属文档口径（张力已登记于 src 头注），不在测试里自增。
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('supplement')] })),
      'gap-exit-not-closed',
    )
    expect(failure.category).toBe('rejected_precondition')
    expect(detailOf(failure)).toContain('五出口封闭集')
  })

  it('出口全空白 → Err（归一后为空串，不是出口）', () => {
    expectRejected(decideCapabilityGap(gapInput({ dispositions: [exitClaim('   ')] })), 'gap-exit-not-closed')
  })
})

describe('负例：出口三件（理由/授权引用/影响）缺一即拒', () => {
  it('无理由 → Err gap-exit-reason-missing', () => {
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('reduce', { reason: undefined })] })),
      'gap-exit-reason-missing',
    )
    expect(detailOf(failure)).toContain('理由')
  })

  it('理由全空白 → Err（空白不是理由）', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('reduce', { reason: '   ' })] })),
      'gap-exit-reason-missing',
    )
  })

  it('无授权引用 → Err gap-exit-authority-missing', () => {
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('external', { authorityRef: undefined })] })),
      'gap-exit-authority-missing',
    )
    expect(detailOf(failure)).toContain('授权引用')
  })

  it('授权引用全空白 → Err', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('external', { authorityRef: '' })] })),
      'gap-exit-authority-missing',
    )
  })

  it('无影响说明 → Err gap-exit-impact-missing', () => {
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ dispositions: [exitClaim('stop', { impactRef: undefined })] })),
      'gap-exit-impact-missing',
    )
    expect(detailOf(failure)).toContain('影响')
  })
})

describe('负例：缺口声明本身空转/未分类', () => {
  it('无缺口声明 → Err gap-declaration-missing', () => {
    expectRejected(decideCapabilityGap({ dispositions: [exitClaim('reduce')] }), 'gap-declaration-missing')
  })

  it('无缺口引用（gapRef）→ Err（匿名处置不受理）', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ declaration: declaration({ gapRef: '  ' }) })),
      'gap-declaration-ref-missing',
    )
  })

  it('未分类缺口类别 → Err gap-kind-unknown（fail-closed，不按最省事一类走）', () => {
    const failure = expectRejected(
      decideCapabilityGap(gapInput({ declaration: declaration({ kind: 'something_else' }) })),
      'gap-kind-unknown',
    )
    expect(detailOf(failure)).toContain('missing|degraded|cost_runaway')
  })

  it('未明示缺什么（capabilityRef 空）→ Err gap-capability-missing', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ declaration: declaration({ capabilityRef: '   ' }) })),
      'gap-capability-missing',
    )
  })

  it('未明示影响什么（impactRef 空）→ Err gap-impact-missing', () => {
    expectRejected(
      decideCapabilityGap(gapInput({ declaration: declaration({ impactRef: '' }) })),
      'gap-impact-missing',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 五、四答后两项：可不答但不得默认已答；Err 封套四答
// ─────────────────────────────────────────────────────────────────────────────

describe('四答携带项与 Err 封套', () => {
  it('持续多久/有何替代未答 → missingAnswers 列出（不阻断决策，也不默认已答）', () => {
    const decision = expectOk(
      decideCapabilityGap(
        gapInput({
          declaration: declaration({ durationRef: undefined, alternativeRefs: undefined }),
          dispositions: [exitClaim('reduce')],
        }),
      ),
    )
    expect([...decision.missingAnswers]).toEqual(['duration', 'alternative'])
    expect(decision.declaration.durationRef).toBeUndefined()
    expect(decision.declaration.alternativeRefs).toEqual([])
  })

  it('只答持续多久 → missingAnswers 仅 alternative', () => {
    const decision = expectOk(
      decideCapabilityGap(
        gapInput({ declaration: declaration({ alternativeRefs: undefined }), dispositions: [exitClaim('stop')] }),
      ),
    )
    expect([...decision.missingAnswers]).toEqual(['alternative'])
  })

  it('alternativeRefs: []（明示无可替代）＝已答，不算未答', () => {
    const decision = expectOk(
      decideCapabilityGap(gapInput({ declaration: declaration({ alternativeRefs: [] }) })),
    )
    expect([...decision.missingAnswers]).toEqual([])
    expect(decision.declaration.alternativeRefs).toEqual([])
  })

  it('替代项全空白 → 按未答处理（空白引用不是替代）', () => {
    const decision = expectOk(
      decideCapabilityGap(gapInput({ declaration: declaration({ alternativeRefs: ['   ', ''] }) })),
    )
    expect([...decision.missingAnswers]).toEqual(['alternative'])
    expect(decision.declaration.alternativeRefs).toEqual([])
  })

  it('Err 封套四答齐备：类别/可重试/副作用/对账/责任位置（v2/14 §0.2）', () => {
    const failure = expectRejected(decideCapabilityGap(gapInput({ dispositions: [] })), 'gap-exit-missing')
    expect(failure.category).toBe('rejected_precondition')
    expect(failure.retryable).toBe(false)
    expect(failure.sideEffectPossible).toBe(false)
    expect(failure.reconcile.required).toBe(false)
    if (failure.reconcile.required) throw new Error('纯判定不应要求对账')
    expect(failure.reconcile.reason.length).toBeGreaterThan(0)
    expect(failure.responsiblePosition.length).toBeGreaterThan(0)
    expect(detailOf(failure).length).toBeGreaterThan(0)
  })
})
