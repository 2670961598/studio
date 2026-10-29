/**
 * test/v2/ring-scenarios —— NEG-RING-01 价值环六要素｜NEG-RING-04 组织环结构评价掩盖（V6·SCEN）
 *
 * 依据：v2/17 §4.1 NEG-RING-01（六要素；越界/无价值/不可验收/承诺不可持续仍沿原路径庆功→强制
 * 失败出口，04 §二/§六）、NEG-RING-04（新增层级掩盖协调失败、整体透支不处置→R-22 判负、缩编或
 * 终止，03 §八）、§3.3 TR-RING-01/04；v2/05 §五（闭环判据＝六要素齐＋强制失败出口）、§六 OBJ-05
 * （五面；反指标＝新增层级掩盖协调失败；评价未被接收＝异常 I-11）；v2/01 §0.4/§三 I-3/I-8/I-16、
 * §四 R-22；v2/03 §2.4/§七/§八、表 D 行 19/20；v2/04 §二/§三/§五/§六/§九/§十二 W-03；v2/08 §1.7、
 * §4.2 MON-07/08；v2/11 §十 REC-EVAL-01。
 *
 * 断言面：NEG-RING-01（封闭面/正例/缺环乱序/四类失败出口：越界、无价值含负价值入账、不可验收含自检
 * 冒称与附条件、承诺不可持续含已声明处置不翻案）；NEG-RING-04（正例＋五面缺项/未接收/未分类/变更无据
 * 倒序/新增层级掩盖协调失败/整体透支不处置/证据缺）。每个负例断言**具名 code＋issue 路径**。零 IO。
 * 变异验证（2026-10-29 实测，脚本逐守卫短路→跑本文件→还原）：MUTATION_NOTE
 * 验证级诚实注：NEG-RING-01/04 主表为 V6·SCEN——本文件是 core 纯判定件的场景级证据；V1 契约
 * case／V6 全链场景（daemon 编排、记录落盘）不在本文件冒充（缺口随交付报告上呈）。
 */
import { describe, expect, it } from 'vitest'
import type {
  OrganizationRingChangeDeclaration,
  OrganizationRingInput,
  StructureEvaluationDeclaration,
  StructureEvaluationInputsDeclaration,
  ValueRingAcceptanceDeclaration,
  ValueRingCommitmentDeclaration,
  ValueRingInput,
  ValueRingStepDeclaration,
} from '../../src/ring/ring-scenarios.ts'
import {
  ORGANIZATION_CHANGE_KINDS,
  RESOURCE_TRENDS,
  RING_FAILURE_CODES,
  STRUCTURE_EVALUATION_CONCLUSIONS,
  VALUE_RING_ACCEPTANCE_VERDICTS,
  VALUE_RING_BOUNDARY_VERDICTS,
  VALUE_RING_ELEMENTS,
  VALUE_RING_ELEMENT_LABELS,
  VALUE_RING_VALUE_VERDICTS,
  evaluateOrganizationRing,
  evaluateValueRing,
} from '../../src/ring/ring-scenarios.ts'

// ── 夹具（最小声明面；默认值＝一个合法可判的正例） ───────────────────────────────

const SIX_STEPS: readonly ValueRingStepDeclaration[] = VALUE_RING_ELEMENTS.map((element) => ({
  element,
  ref: `rec/${element}`,
}))

function stepsOf(elements: readonly string[]): readonly ValueRingStepDeclaration[] {
  return elements.map((element) => ({ element, ref: `rec/${element}` }))
}

function acceptanceOf(overrides: Partial<ValueRingAcceptanceDeclaration> = {}): ValueRingAcceptanceDeclaration {
  return {
    verdict: 'accepted',
    criteriaRefs: ['criteria/pre-agreed'],
    verifierRef: 'position/independent-qa',
    deliveredByRef: 'position/delivery-team',
    ...overrides,
  }
}

function valueInput(overrides: Partial<ValueRingInput> = {}): ValueRingInput {
  return {
    steps: SIX_STEPS,
    boundary: { verdict: 'within', evidenceRef: 'charter/boundary' },
    acceptance: acceptanceOf(),
    value: { verdict: 'positive', basisRefs: ['feedback/client'] },
    commitment: { sustainable: true },
    ...overrides,
  }
}

const EVAL_REF = 'REC-EVAL-01/ring-04'
const INPUTS: StructureEvaluationInputsDeclaration = {
  performanceRef: 'perf/org-q4',
  resourceAccountRef: 'REC-EVD-04/q4',
  resourceTrend: 'sustainable',
}

function evaluationOf(overrides: Partial<StructureEvaluationDeclaration> = {}): StructureEvaluationDeclaration {
  return {
    evaluationRef: EVAL_REF,
    objectRefs: ['structure/layers', 'structure/departments', 'structure/authority-audit'],
    criteriaRefs: ['criteria/03-2.4', 'criteria/table-d-19-20'],
    inputs: { ...INPUTS },
    conclusion: 'maintain',
    decisionAuthority: { decidedBy: 'position/prime-minister', authorityRef: '03/table-A-prime-11' },
    receivedBy: 'position/review-receiver',
    ...overrides,
  }
}

function changeOf(overrides: Partial<OrganizationRingChangeDeclaration> = {}): OrganizationRingChangeDeclaration {
  return {
    kind: 'downsize',
    ref: 'REC-LIFE-08/org-change-1',
    evaluationRef: EVAL_REF,
    evidenceRefs: ['evidence/structure-facts', 'evidence/settlement'],
    ...overrides,
  }
}

function orgInput(overrides: Partial<OrganizationRingInput> = {}): OrganizationRingInput {
  return { evaluation: evaluationOf(), ...overrides }
}

type ValueResult = ReturnType<typeof evaluateValueRing>
type OrgResult = ReturnType<typeof evaluateOrganizationRing>

function expectValueOk(result: ValueResult) {
  if (!result.ok) throw new Error(`期望 ok，实得 ${result.code}：${result.issues.map((entry) => entry.path).join('|')}`)
  return result.facts
}

function expectOrgOk(result: OrgResult) {
  if (!result.ok) throw new Error(`期望 ok，实得 ${result.code}：${result.issues.map((entry) => entry.path).join('|')}`)
  return result.facts
}

function expectValueFailure(result: ValueResult, code: string): readonly string[] {
  if (result.ok) throw new Error(`期望失败 ${code}，实得 ok：${JSON.stringify(result.facts)}`)
  expect(result.code).toBe(code)
  expect(result.issues.length).toBeGreaterThan(0)
  return result.issues.map((entry) => entry.path)
}

function expectOrgFailure(result: OrgResult, code: string): readonly string[] {
  if (result.ok) throw new Error(`期望失败 ${code}，实得 ok：${JSON.stringify(result.facts)}`)
  expect(result.code).toBe(code)
  expect(result.issues.length).toBeGreaterThan(0)
  return result.issues.map((entry) => entry.path)
}

// ── NEG-RING-01：封闭值与六要素正例 ─────────────────────────────────────────────

describe('NEG-RING-01 · 价值环封闭面', () => {
  it('六要素恰为受理→合同→执行→收割→验收→复盘（01 §0.4 有序转化规范序）', () => {
    expect([...VALUE_RING_ELEMENTS]).toEqual(['intake', 'contract', 'execution', 'harvest', 'acceptance', 'review'])
    const labels = VALUE_RING_ELEMENTS.map((element) => VALUE_RING_ELEMENT_LABELS[element])
    expect(labels).toEqual(['受理', '合同', '执行', '收割', '验收', '复盘'])
  })

  it('边界/验收/价值值集封闭且四类失败出口在封闭码集内各有一码', () => {
    expect([...VALUE_RING_BOUNDARY_VERDICTS]).toEqual(['within', 'violated'])
    expect([...VALUE_RING_ACCEPTANCE_VERDICTS]).toEqual(
      ['accepted', 'conditional_accepted', 'rejected', 'terminated', 'unverified'],
    )
    expect([...VALUE_RING_VALUE_VERDICTS]).toEqual(['positive', 'none', 'negative'])
    for (const code of [
      'ring-link-missing',
      'ring-boundary-violated',
      'ring-value-absent',
      'ring-acceptance-unverifiable',
      'ring-commitment-unsustainable',
    ]) {
      expect(RING_FAILURE_CODES).toContain(code)
    }
  })

  it('正例：六要素齐＋在界内＋独立验收＋正价值＋可持续承诺 → ok（要素按规范序回传）', () => {
    const facts = expectValueOk(evaluateValueRing(valueInput()))
    expect(facts.ring).toBe('value')
    expect([...facts.elements]).toEqual([...VALUE_RING_ELEMENTS])
    expect(facts.stepRefs).toEqual({
      intake: 'rec/intake',
      contract: 'rec/contract',
      execution: 'rec/execution',
      harvest: 'rec/harvest',
      acceptance: 'rec/acceptance',
      review: 'rec/review',
    })
    expect(facts.valueVerdict).toBe('positive')
    expect(facts.acceptanceVerifierRef).toBe('position/independent-qa')
  })

  it('正例：无对外承诺（内部任务）不构成失败条件 → ok', () => {
    const facts = expectValueOk(evaluateValueRing(valueInput({ commitment: undefined })))
    expect(facts.ring).toBe('value')
  })

  it('同输入两次判定深等（零 IO／无时钟，确定性）', () => {
    expect(evaluateValueRing(valueInput())).toEqual(evaluateValueRing(valueInput()))
  })
})

// ── NEG-RING-01：缺环/乱序/空转/未分类 ──────────────────────────────────────────

describe('NEG-RING-01 · 缺环与有序转化断裂', () => {
  it('缺环一次登记全部缺口（缺复盘；缺合同＋收割）→ ring-link-missing', () => {
    const single = expectValueFailure(
      evaluateValueRing(valueInput({ steps: stepsOf(['intake', 'contract', 'execution', 'harvest', 'acceptance']) })),
      'ring-link-missing',
    )
    expect(single).toContain('steps.review')
    const multiple = expectValueFailure(
      evaluateValueRing(valueInput({ steps: stepsOf(['intake', 'execution', 'acceptance', 'review']) })),
      'ring-link-missing',
    )
    expect(multiple).toContain('steps.contract')
    expect(multiple).toContain('steps.harvest')
  })
  it('已声明要素缺依据引用＝空转 → ring-link-missing（不得当作环）', () => {
    const steps = SIX_STEPS.map((step) => (step.element === 'execution' ? { ...step, ref: '  ' } : step))
    const paths = expectValueFailure(evaluateValueRing(valueInput({ steps })), 'ring-link-missing')
    expect(paths).toContain('steps.2.ref')
  })

  it('乱序（合同先于受理）→ ring-link-out-of-order', () => {
    const reordered = [SIX_STEPS[1]!, SIX_STEPS[0]!, ...SIX_STEPS.slice(2)]
    const paths = expectValueFailure(evaluateValueRing(valueInput({ steps: reordered })), 'ring-link-out-of-order')
    expect(paths).toContain('steps.1.element')
  })
  it('要素重复 → ring-link-out-of-order（单向链重复即不成立）', () => {
    const steps = [...SIX_STEPS, { element: 'intake', ref: 'rec/dup' }]
    const paths = expectValueFailure(evaluateValueRing(valueInput({ steps })), 'ring-link-out-of-order')
    expect(paths).toContain('steps.6.element')
  })

  it('要素名未分类 → ring-declaration-unclassified', () => {
    const steps = stepsOf(['kickoff', 'contract', 'execution', 'harvest', 'acceptance', 'review'])
    const paths = expectValueFailure(evaluateValueRing(valueInput({ steps })), 'ring-declaration-unclassified')
    expect(paths).toContain('steps.0.element')
  })
})

// ── NEG-RING-01：四类强制失败出口（越界/无价值/不可验收/承诺不可持续） ────────────

describe('NEG-RING-01 · 越界出口', () => {
  it('已越界 → ring-boundary-violated（不得沿原路径庆功）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ boundary: { verdict: 'violated' } })),
      'ring-boundary-violated',
    )
    expect(paths).toContain('boundary.verdict')
  })
  it('边界缺省不得默认在界内 → ring-boundary-violated', () => {
    const paths = expectValueFailure(evaluateValueRing(valueInput({ boundary: undefined })), 'ring-boundary-violated')
    expect(paths).toContain('boundary')
  })

  it('边界判定未分类 → ring-declaration-unclassified（fail-closed）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ boundary: { verdict: 'maybe' } })),
      'ring-declaration-unclassified',
    )
    expect(paths).toContain('boundary.verdict')
  })
})

describe('NEG-RING-01 · 无价值出口', () => {
  it('无价值 → ring-value-absent', () => {
    const paths = expectValueFailure(evaluateValueRing(valueInput({ value: { verdict: 'none' } })), 'ring-value-absent')
    expect(paths).toContain('value.verdict')
  })

  it('负价值 → ring-value-absent（未入账追加 I-3 缺口；已入账仍不翻案）', () => {
    const unaccounted = expectValueFailure(
      evaluateValueRing(valueInput({ value: { verdict: 'negative', negativeAccounted: false } })),
      'ring-value-absent',
    )
    expect(unaccounted).toContain('value.verdict')
    expect(unaccounted).toContain('value.negativeAccounted')
    const accounted = expectValueFailure(
      evaluateValueRing(valueInput({ value: { verdict: 'negative', negativeAccounted: true } })),
      'ring-value-absent',
    )
    expect(accounted).toEqual(['value.verdict'])
  })

  it('价值结论缺省 → ring-value-absent（内部验收只是证据之一）', () => {
    const paths = expectValueFailure(evaluateValueRing(valueInput({ value: undefined })), 'ring-value-absent')
    expect(paths).toContain('value')
  })

  it('价值判定未分类 → ring-declaration-unclassified', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ value: { verdict: 'great' } })),
      'ring-declaration-unclassified',
    )
    expect(paths).toContain('value.verdict')
  })
})

describe('NEG-RING-01 · 不可验收出口', () => {
  it('验收结论缺省 → ring-acceptance-unverifiable', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: undefined })),
      'ring-acceptance-unverifiable',
    )
    expect(paths).toContain('acceptance')
  })

  it('验收口径为空 → ring-acceptance-unverifiable（04 §三/§六）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ criteriaRefs: [] }) })),
      'ring-acceptance-unverifiable',
    )
    expect(paths).toContain('acceptance.criteriaRefs')
  })

  it('缺验收者／验收者＝交付者（自检冒称独立验收）→ ring-acceptance-unverifiable（W-03/I-8）', () => {
    const missing = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ verifierRef: undefined }) })),
      'ring-acceptance-unverifiable',
    )
    expect(missing).toContain('acceptance.verifierRef')
    const selfReview = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ verifierRef: 'position/delivery-team' }) })),
      'ring-acceptance-unverifiable',
    )
    expect(selfReview).toContain('acceptance.verifierRef')
  })

  it('附条件接受缺条件/责任者/到期处置 → ring-acceptance-unverifiable', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ verdict: 'conditional_accepted' }) })),
      'ring-acceptance-unverifiable',
    )
    expect(paths).toContain('acceptance.conditionRef')
  })

  it('附条件接受三件齐备仍非「接受」→ ring-acceptance-unverifiable', () => {
    const paths = expectValueFailure(
      evaluateValueRing(
        valueInput({ acceptance: acceptanceOf({ verdict: 'conditional_accepted', conditionRef: 'condition/1' }) }),
      ),
      'ring-acceptance-unverifiable',
    )
    expect(paths).toContain('acceptance.verdict')
  })

  it('验收结论为拒绝 → ring-acceptance-unverifiable（返工或依授权终止）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ verdict: 'rejected' }) })),
      'ring-acceptance-unverifiable',
    )
    expect(paths).toContain('acceptance.verdict')
  })

  it('验收结论未分类 → ring-declaration-unclassified（未分类/存疑按高侧）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ acceptance: acceptanceOf({ verdict: 'looks-fine' }) })),
      'ring-declaration-unclassified',
    )
    expect(paths).toContain('acceptance.verdict')
  })
})

describe('NEG-RING-01 · 承诺不可持续出口', () => {
  it('承诺不可持续 → ring-commitment-unsustainable', () => {
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ commitment: { sustainable: false } })),
      'ring-commitment-unsustainable',
    )
    expect(paths).toContain('commitment.sustainable')
  })

  it('已声明承诺变更/终止引用仍走强制失败出口（处置不翻案）', () => {
    const paths = expectValueFailure(
      evaluateValueRing(
        valueInput({
          commitment: { sustainable: false, changeRef: 'REC-WORK-13/change-1', terminationRef: 'REC-WORK-06/term-1' },
        }),
      ),
      'ring-commitment-unsustainable',
    )
    expect(paths).toContain('commitment.sustainable')
  })

  it('承诺声明缺可持续判据 → 按不可持续 fail-closed', () => {
    const malformed = {} as ValueRingCommitmentDeclaration
    const paths = expectValueFailure(
      evaluateValueRing(valueInput({ commitment: malformed })),
      'ring-commitment-unsustainable',
    )
    expect(paths).toContain('commitment.sustainable')
  })
})

// ── NEG-RING-04：组织环正例与封闭面 ─────────────────────────────────────────────

describe('NEG-RING-04 · 组织环封闭面与正例', () => {
  it('结论/变更型/资源趋势值集封闭', () => {
    expect([...STRUCTURE_EVALUATION_CONCLUSIONS]).toEqual(['maintain', 'adjust', 'revoke', 'level_change'])
    expect([...ORGANIZATION_CHANGE_KINDS]).toEqual(['add_layer', 'downsize', 'terminate'])
    expect([...RESOURCE_TRENDS]).toEqual(['sustainable', 'overdraft'])
  })

  it('正例：五面齐＋被接收＋维持结论＋不主张变更 → ok（change=null）', () => {
    const facts = expectOrgOk(evaluateOrganizationRing(orgInput()))
    expect(facts.ring).toBe('organization')
    expect(facts.evaluationRef).toBe(EVAL_REF)
    expect(facts.conclusion).toBe('maintain')
    expect(facts.resourceTrend).toBe('sustainable')
    expect(facts.change).toBeNull()
  })

  it('正例：可持续时新增层级（无协调失败证据）→ ok', () => {
    const facts = expectOrgOk(
      evaluateOrganizationRing(orgInput({ change: changeOf({ kind: 'add_layer' }) })),
    )
    expect(facts.change).toEqual({ kind: 'add_layer', ref: 'REC-LIFE-08/org-change-1' })
  })

  it('正例：整体透支＋缩编处置＋证据齐 → ok（03 §八）', () => {
    const facts = expectOrgOk(
      evaluateOrganizationRing(
        orgInput({
          evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'overdraft' } }),
          change: changeOf({ kind: 'downsize' }),
        }),
      ),
    )
    expect(facts.resourceTrend).toBe('overdraft')
    expect(facts.change?.kind).toBe('downsize')
  })

  it('正例：整体透支＋终止处置＋承接者＋证据齐 → ok（I-16）', () => {
    const facts = expectOrgOk(
      evaluateOrganizationRing(
        orgInput({
          evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'overdraft' } }),
          change: changeOf({ kind: 'terminate', receiverRef: 'position/external-receiver' }),
        }),
      ),
    )
    expect(facts.change?.kind).toBe('terminate')
  })

  it('同输入两次判定深等（零 IO／无时钟，确定性）', () => {
    expect(evaluateOrganizationRing(orgInput())).toEqual(evaluateOrganizationRing(orgInput()))
  })
})

// ── NEG-RING-04：结构评价缺面/未接收/未分类 ─────────────────────────────────────

describe('NEG-RING-04 · OBJ-05 五面缺项', () => {
  it('结构评价缺省 → ring-structure-evaluation-incomplete', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ evaluation: undefined })),
      'ring-structure-evaluation-incomplete',
    )
    expect(paths).toContain('evaluation')
  })

  it('评价缺记录引用 → ring-structure-evaluation-incomplete', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ evaluation: evaluationOf({ evaluationRef: '' }) })),
      'ring-structure-evaluation-incomplete',
    )
    expect(paths).toContain('evaluation.evaluationRef')
  })

  it('五面逐面缺项各自判负（对象/判据/绩效/资源账/趋势/结论/决定权）', () => {
    const faceCases: readonly [string, Partial<StructureEvaluationDeclaration>][] = [
      ['evaluation.objectRefs', { objectRefs: [] }],
      ['evaluation.criteriaRefs', { criteriaRefs: [] }],
      ['evaluation.inputs.performanceRef', { inputs: { ...INPUTS, performanceRef: ' ' } }],
      ['evaluation.inputs.resourceAccountRef', { inputs: { ...INPUTS, resourceAccountRef: '' } }],
      ['evaluation.inputs.resourceTrend', { inputs: { ...INPUTS, resourceTrend: '' } }],
      ['evaluation.conclusion', { conclusion: '' }],
      ['evaluation.decisionAuthority', { decisionAuthority: { decidedBy: '', authorityRef: '' } }],
    ]
    for (const [path, overrides] of faceCases) {
      const paths = expectOrgFailure(
        evaluateOrganizationRing(orgInput({ evaluation: evaluationOf(overrides) })),
        'ring-structure-evaluation-incomplete',
      )
      expect(paths, `缺面应点名 ${path}`).toContain(path)
    }
  })

  it('结论／资源趋势／变更型未分类 → ring-declaration-unclassified（未知不得默认可持续）', () => {
    const conclusion = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ evaluation: evaluationOf({ conclusion: 'keep' }) })),
      'ring-declaration-unclassified',
    )
    expect(conclusion).toContain('evaluation.conclusion')
    const trend = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'unknown' } }) })),
      'ring-declaration-unclassified',
    )
    expect(trend).toContain('evaluation.inputs.resourceTrend')
    const changeKind = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ kind: 'reorg' }) })),
      'ring-declaration-unclassified',
    )
    expect(changeKind).toContain('change.kind')
  })

  it('评价未被接收 → ring-evaluation-unreceived（异常 I-11，不得据此变更）', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ evaluation: evaluationOf({ receivedBy: '' }) })),
      'ring-evaluation-unreceived',
    )
    expect(paths).toContain('evaluation.receivedBy')
  })
})

// ── NEG-RING-04：变更时序/掩盖/透支/证据 ────────────────────────────────────────

describe('NEG-RING-04 · 组织变更时序（评价先行、变更随后）', () => {
  it('变更缺记录引用 → ring-change-unordered', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ ref: '' }) })),
      'ring-change-unordered',
    )
    expect(paths).toContain('change.ref')
  })

  it('变更未引结构评价 → ring-change-unordered（无据变更是倒序）', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ evaluationRef: undefined }) })),
      'ring-change-unordered',
    )
    expect(paths).toContain('change.evaluationRef')
  })

  it('变更所引评价与本次结构评价不一致 → ring-change-unordered', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ evaluationRef: 'REC-EVAL-01/other' }) })),
      'ring-change-unordered',
    )
    expect(paths).toContain('change.evaluationRef')
  })
})

describe('NEG-RING-04 · 新增层级掩盖协调失败（R-22 语义）', () => {
  it('新增层级＋协调失败证据 → ring-layer-masks-coordination-failure（空白引用不构成证据）', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(
        orgInput({
          change: changeOf({ kind: 'add_layer' }),
          coordinationFailureRefs: ['MON-08/coordination-friction'],
        }),
      ),
      'ring-layer-masks-coordination-failure',
    )
    expect(paths).toContain('change.kind')
    const blank = expectOrgFailure(
      evaluateOrganizationRing(
        orgInput({
          evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'overdraft' } }),
          change: changeOf({ kind: 'add_layer' }),
          coordinationFailureRefs: ['  ', ''],
        }),
      ),
      'ring-overdraft-unhandled',
    )
    expect(blank).toContain('evaluation.inputs.resourceTrend')
  })
})

describe('NEG-RING-04 · 整体透支不处置（缩编或终止必答）', () => {
  it('整体透支＋不变更 → ring-overdraft-unhandled', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(
        orgInput({ evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'overdraft' } }) }),
      ),
      'ring-overdraft-unhandled',
    )
    expect(paths).toContain('evaluation.inputs.resourceTrend')
  })

  it('整体透支＋新增层级（非缩编/终止）→ ring-overdraft-unhandled', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(
        orgInput({
          evaluation: evaluationOf({ inputs: { ...INPUTS, resourceTrend: 'overdraft' } }),
          change: changeOf({ kind: 'add_layer' }),
        }),
      ),
      'ring-overdraft-unhandled',
    )
    expect(paths).toContain('evaluation.inputs.resourceTrend')
  })
})

describe('NEG-RING-04 · 变更证据与终止承接', () => {
  it('缩编处置证据为空 → ring-change-evidence-missing', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ kind: 'downsize', evidenceRefs: [] }) })),
      'ring-change-evidence-missing',
    )
    expect(paths).toContain('change.evidenceRefs')
  })

  it('终止处置缺承接者/接收确认 → ring-change-evidence-missing（I-16）', () => {
    const paths = expectOrgFailure(
      evaluateOrganizationRing(orgInput({ change: changeOf({ kind: 'terminate', receiverRef: ' ' }) })),
      'ring-change-evidence-missing',
    )
    expect(paths).toContain('change.receiverRef')
  })
})
