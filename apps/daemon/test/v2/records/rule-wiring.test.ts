/**
 * rule-wiring —— IMPL-06-02「rule 接线冒烟」2 条（03-07 结转；daemon 侧首次消费 core 内核）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 微调登记（「plan/04 的 daemon 侧 rule 接线冒烟 2 件随 IMPL-06-02 落位，
 *     总数不变」）＋plan/04 §1.9.4（V2 新套件：不 mock、一次红即红）；
 *   - docs/v2/14 §1.4 PORT-WORK `judgeReadiness`（「REC-WORK-04 五门各一；judge→role 封闭
 *     映射」）——本文件的①测试的是该端口编排腿与 core `judgeWorkReadiness` 的接线同一性；
 *   - docs/v2/11 §5.1 REC-WORK-04（五门各一不得缺门重复；门级与整体结论共用同一组三值；
 *     **规则求值中止按该门不可开工聚合，不另造门级取值**；judge→role 封闭映射）——②测试
 *     规则两阶段（v2/10 §六）在门级三值上的聚合：静态错/refused 落 `fail` 而非第四值；
 *   - docs/v2/10 §六 RULE-01..08（两阶段不可合并：typecheck 未过不得进入求值）。
 *
 * 断言纪律：接线冒烟只证明「daemon 工作域真的委托 core 判定、没有第二套实现/没有造门级
 * 第四值」；核心判定本身的分支覆盖在 packages/core/test/v2（MIG-03），本文件不重复。
 */
import { describe, expect, it } from 'vitest'
import type { WorkReadinessInput } from '@studio-next/core'
import { judgeWorkReadiness } from '@studio-next/core'
import { WORK_GATE_JUDGE_ROLES, evaluateGateRule, judgeStartGates } from '../../../src/engine/work/intake.ts'
import { GATE_INPUTS, gateProfile, gateRule } from './fixtures/rule-gate.ts'

/** 五门齐备的合法证据面（值只用于接线断言，不代表任何真实公司） */
function readyGates(): WorkReadinessInput {
  return {
    authority: { state: 'permitted', evidenceRef: 'REC-AUTH-01:g-1@1' },
    capability: { qualificationRef: 'REC-CAP-02:c-1@1', evaluatedAtMs: 1_000, validUntilMs: 2_000 },
    prohibition: { state: 'clear', evidenceRef: 'REC-AUTH-08:p-1@1' },
    resource: { state: 'sufficient', evidenceRef: 'REC-WORK-05:r-1@1', nextReviewAtMs: 3_000 },
    acceptance: {
      intake: 'accepted',
      acceptanceCriteria: ['bun run verify:v2 exit=0'],
      verificationPositionRef: 'G7-verifier',
    },
  }
}

describe('rule 接线冒烟①：PORT-WORK judgeReadiness 编排腿＝core 五门三值（无第二实现）', () => {
  it('五门齐备→ready；缺门→not_ready（缺门清单逐门）；判据与 core 逐字段同值；gate→role 五门封闭', () => {
    const gates = readyGates()
    const core = judgeWorkReadiness(gates)
    const port = judgeStartGates({ workRef: 'REC-WORK-06:M-05@1', contractRef: 'REC-WORK-03:c-1@1', gates })

    // 接线同一性：端口只补形状（workRef/contractRef/judgeRoles），判定逐字段来自 core
    expect(port.verdict).toBe(core.verdict)
    expect(port.verdict).toBe('ready')
    expect(port.gates).toEqual(core.gates)
    expect(port.missingGates).toEqual(core.missingGates)
    expect(port.conditions).toEqual(core.conditions)
    expect(port.evidenceRefs).toEqual(core.evidenceRefs)

    // gate→role 封闭映射：五门一一对应（不得新增门/漏门）
    expect(Object.keys(WORK_GATE_JUDGE_ROLES).sort()).toEqual(
      ['acceptance', 'authority', 'capability', 'prohibition', 'resource'],
    )
    for (const gate of port.gates) {
      expect(WORK_GATE_JUDGE_ROLES[gate.gate]).toBeTypeOf('string')
      expect(WORK_GATE_JUDGE_ROLES[gate.gate].length).toBeGreaterThan(0)
    }

    // 缺门＝不可开工（缺门不是 pass）；端口不 fail-open 补结论
    const { capability: _omitted, ...missingCapability } = readyGates()
    const notReady = judgeStartGates({ workRef: 'REC-WORK-06:M-05@2', gates: missingCapability })
    expect(notReady.verdict).toBe('not_ready')
    expect(notReady.missingGates).toEqual(['capability'])
    expect(notReady.verdict).toBe(judgeWorkReadiness(missingCapability).verdict)

    // 验收口径为空不得开工（REC-WORK-04 acceptance 门）
    const emptyCriteria = judgeStartGates({
      workRef: 'REC-WORK-06:M-05@3',
      gates: { ...readyGates(), acceptance: { intake: 'accepted', acceptanceCriteria: ['  '], verificationPositionRef: 'G7-verifier' } },
    })
    expect(emptyCriteria.verdict).toBe('not_ready')
    expect(emptyCriteria.gates.some((gate) => gate.gate === 'acceptance' && gate.verdict === 'fail')).toBe(true)
  })
})

describe('rule 接线冒烟②：规则两阶段→门级三值（中止聚合为 fail，不造第四值）', () => {
  it('合法档：level≥3→pass；不满足→fail；静态面不过→typecheck-failed/fail/halted（不进求值）', () => {
    // ① 两阶段全通：true→pass（门可开工）
    const pass = evaluateGateRule({ profile: gateProfile(), rule: gateRule(), inputs: GATE_INPUTS })
    expect(pass.outcome).toBe('true')
    expect(pass.verdict).toBe('pass')
    expect(pass.halted).toBe(false)

    // ② 求值 false→fail（不冒充 pass）
    const fail = evaluateGateRule({ profile: gateProfile(), rule: gateRule(), inputs: { task: { level: 1 } } })
    expect(fail.outcome).toBe('false')
    expect(fail.verdict).toBe('fail')
    expect(fail.halted).toBe(false)

    // ③ 静态面不过＝求值中止：诊断原样返回，门级按不可开工聚合（三值共用，不新造取值）
    const staticBad = evaluateGateRule({
      profile: gateProfile(),
      rule: gateRule({ node: 'call', fn: 'host.now' }),
      inputs: GATE_INPUTS,
    })
    expect(staticBad.outcome).toBe('typecheck-failed')
    expect(staticBad.verdict).toBe('fail')
    expect(staticBad.halted).toBe(true)
    expect(staticBad.diagnostics.some((diagnostic) => diagnostic.code === 'E-RULE-001')).toBe(true)

    // ④ 求值中止（输入不在 jcs@1 域）→refused 折为门级 fail＋halted（refused 不得读成 false 之外的放行）
    const refused = evaluateGateRule({ profile: gateProfile(), rule: gateRule(), inputs: { task: { level: 5n } } })
    expect(refused.outcome).toBe('refused')
    expect(refused.verdict).toBe('fail')
    expect(refused.halted).toBe(true)
  })
})
