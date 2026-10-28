/**
 * rec-perf.test.ts —— PERF 绩效族「一族一正一负」（MIG-03 / IMPL-03-01；NEG-REC-03 底行）
 *
 * 依据：v2/17 §3.4（PERF 1：NEG-REC-03 E-6 误归因/自评/单一分数合并/不经程序改任命，V1）｜
 *   v2/11 §四（REC-PERF-01 字段表/不变量：五维不得抵消/不得合并、audit_class 必填、证据弱→暂不能归因、
 *   输入必含 REC-WORK-09＋REC-WORK-08）｜v2/09 ENU-135｜v2/02 §九（三层归因/不得自评）。
 */
import { describe, expect, it } from 'vitest'
import { validatePerformanceEvaluation } from '../../../src/records/perf.ts'
import type { PerformanceEvaluationContext } from '../../../src/records/perf.ts'
import { envelope, issuePaths, perfDimensions, perfPayload } from './fixtures.ts'

const INDEPENDENT: PerformanceEvaluationContext = { sameBody: false }
const PROOF = { proofBoundary: '证明：五维结论与归因层；不证明：外部独立性、组织绩效口径' }

describe('PERF-01 绩效评定（正例）', () => {
  it('独立评价位置（superior_audit）、五维齐、输入含验收＋分级完成、证明边界在场 → 放行', () => {
    expect(validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload(), PROOF), INDEPENDENT)).toEqual({ ok: true })
  })

  it('公司级自审标 internal_boss_self_audit 且不声明独立 → 放行（同载体同纪律）', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'internal_boss_self_audit',
        independence_claimed: false,
      },
    })
    expect(validatePerformanceEvaluation(envelope('REC-PERF-01', payload, PROOF), { sameBody: true })).toEqual({ ok: true })
  })
})

describe('NEG-REC-03 绩效拒绝条件（自评/单一分数合并/误归因/输入断链）', () => {
  it('单一分数合并（dimensions 多出 score 键）→ 拒（不得合并为单一分数）', () => {
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload({ dimensions: perfDimensions({ score: '85' }) }), PROOF), INDEPENDENT)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.dimensions')
  })

  it('五维缺一维（缺「价值」）→ 拒（不得互相抵消/不得少维）', () => {
    const dimensions = perfDimensions()
    delete dimensions['价值']
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload({ dimensions }), PROOF), INDEPENDENT)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.dimensions.价值')
  })

  it('自评却填 audit_class=external → 拒（不得自称独立；NEG-ORG-15 同族）', () => {
    const payload = perfPayload({
      evaluator_and_independence: {
        evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
        audit_class: 'external',
        independence_claimed: true,
      },
    })
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', payload, PROOF), { sameBody: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evaluator_and_independence.audit_class')
  })

  it('证据弱却给归因结论（非「暂不能归因」）→ 拒（E-6 误归因面）', () => {
    const outcome = validatePerformanceEvaluation(
      envelope('REC-PERF-01', perfPayload({ uncertainty: { note: '仅 1 件样本', evidence_weak: true, conclusion: '任职者能力不足' } }), PROOF),
      INDEPENDENT,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.uncertainty.conclusion')
  })

  it('输入缺验收结论 REC-WORK-09（以执行面终态为输入）→ 拒（三分离断链）', () => {
    const outcome = validatePerformanceEvaluation(
      envelope('REC-PERF-01', perfPayload({ input_refs: [{ refType: 'REC-WORK-08', refId: 'w8-1', refVersion: '1.0.0' }] }), PROOF),
      INDEPENDENT,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.input_refs')
  })

  it('输入缺分级完成记录 REC-WORK-08 → 拒（绩效以分级完成＋验收为输入）', () => {
    const outcome = validatePerformanceEvaluation(
      envelope('REC-PERF-01', perfPayload({ input_refs: [{ refType: 'REC-WORK-09', refId: 'w9-1', refVersion: '1.0.0' }] }), PROOF),
      INDEPENDENT,
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.input_refs')
  })

  it('归因层别越界（organization=组织绩效不属本对象）→ 拒（本对象只承载前两层）', () => {
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload({ layer: '组织绩效' }), PROOF), INDEPENDENT)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.layer')
  })

  it('缺证明边界（§0.7-1 证据类与决定类必填）→ 拒', () => {
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload()), INDEPENDENT)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('proofBoundary')
  })

  it('单元首长由最高宰相评价却填 cross_unit → 拒（逐级 +1 非同体＝superior_audit）', () => {
    const outcome = validatePerformanceEvaluation(envelope('REC-PERF-01', perfPayload(
      {
        evaluator_and_independence: {
          evaluator_ref: { refType: 'REC-LIFE-01', refId: 'rec-1', refVersion: '1.0.0' },
          audit_class: 'cross_unit',
          independence_claimed: false,
        },
      },
    ), PROOF), { sameBody: false, evaluatorClass: 'internal_boss', subjectClass: 'internal_position' })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evaluator_and_independence.audit_class')
  })
})
