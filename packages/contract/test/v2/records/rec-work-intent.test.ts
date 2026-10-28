/**
 * rec-work-intent.test.ts —— WORK 入口/合同/迁移判定 01..09「一正一负」＋74 类登记齐
 * （MIG-03 / IMPL-03-02；NEG-REC-04 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-04（W 族全部负形态：降档逃证/静默恢复/动作充数/自检冒验收/结清不结派生面，
 *   V1＋V3——本文件落 V1 形状腿）｜v2/11 §5.1/§5.2（01..09 字段与不变量）、§14.1（M-01..M-29）、
 *   §十五-2（跨记录不变量）｜v2/09 ENU-03/07/12/14/16/50。
 * 拆件：WORK 21 类夹具在 fixtures-work.ts；10..18＋三条具名类在 rec-work-exec.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { validateWorkIntake, validateIntakeDecision, validateWorkContract, validateStartDecision, validatePlanLock, validateWorkTransition, validateEffectLevel, validateCompletionRecord, validateWorkAcceptance, WORK_RECORD_TYPES } from '../../../src/records/work.ts'
import { ALL_RECORD_SCHEMAS, ALL_RECORD_TYPES, RECORD_TYPE_COUNT } from '../../../src/records/index.ts'
import { PROOF, acceptancePayload, completionPayload, effectLevelPayload, intakeDecisionPayload, planLockPayload, startDecisionPayload, transitionPayload, workContractPayload, workIntakePayload } from './fixtures-work.ts'
import { AT, envelope, issuePaths, oref, ref } from './fixtures.ts'

describe('WORK 01..09 正例（§5.1/§5.2 字段齐备）', () => {

  it('01 意图信封：原始内容不改写、来源已核验、受理时限在 → 放行', () => {
    expect(validateWorkIntake(envelope('REC-WORK-01', workIntakePayload()))).toEqual({ ok: true })
  })

  it('02 受理结论：接受＋主类型有依据＋决定面齐 → 放行', () => {
    expect(validateIntakeDecision(envelope('REC-WORK-02', intakeDecisionPayload()))).toEqual({ ok: true })
  })

  it('03 任务合同：五要件＋附加三件＋四责任位置具名 → 放行', () => {
    expect(validateWorkContract(envelope('REC-WORK-03', workContractPayload()))).toEqual({ ok: true })
  })

  it('03 探索合同：四条款齐备 → 放行', () => {
    const payload = workContractPayload({
      explore_terms: { boundary: '不进入生产面', learning_delivery: '可检验报告', stop_condition: '预算耗尽即停', evaluation: '事后独立判断' },
    })
    expect(validateWorkContract(envelope('REC-WORK-03', payload), { workType: 'explore' })).toEqual({ ok: true })
  })

  it('04 开工判断：五门各一、gate→role 正确、三值聚合一致、资源逐项充足 → 放行', () => {
    expect(validateStartDecision(envelope('REC-WORK-04', startDecisionPayload()))).toEqual({ ok: true })
  })

  it('05 执行计划锁：资格/能力引用正确、预留非空 → 放行', () => {
    expect(validatePlanLock(envelope('REC-WORK-05', planLockPayload()))).toEqual({ ok: true })
  })

  it('06 工作状态迁移：M-01 边＋前置记录齐＋异议「无异议」→ 放行', () => {
    expect(validateWorkTransition(envelope('REC-WORK-06', transitionPayload()))).toEqual({ ok: true })
  })

  it('07 效果级：EX-1 可逆且无敏感面 → 放行', () => {
    expect(validateEffectLevel(envelope('REC-WORK-07', effectLevelPayload()))).toEqual({ ok: true })
  })

  it('08 完成判据：EX-2+ 四要件齐备＋独立收割 → 放行', () => {
    expect(validateCompletionRecord(envelope('REC-WORK-08', completionPayload(), PROOF), { effectLevel: 'EX-2' })).toEqual({ ok: true })
  })

  it('09 验收记录：接受＋独立性核验槽＋证据包含 REC-EVD-03 → 放行', () => {
    expect(validateWorkAcceptance(envelope('REC-WORK-09', acceptancePayload(), PROOF))).toEqual({ ok: true })
  })

})

describe('NEG-REC-04 任务族拒绝条件（降档逃证/静默恢复/非法迁移/自检冒验收）', () => {

  it('降档逃证：EX-2+ 完成只按低侧自报闭合 → 拒（W-13）', () => {
    const payload = completionPayload({
      completion_basis: [{ element: '终态事件', state: 'present' }, { element: '自报', state: 'present' }],
      collector_identity: { collector: 'holder-h1', independence: '交付方自报', self_reported: true },
      harvest_ref: undefined,
      sampling_ref: ref('REC-EVD-02'),
    })
    const outcome = validateCompletionRecord(envelope('REC-WORK-08', payload, PROOF), { effectLevel: 'EX-2' })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.completion_basis')
    expect(issuePaths(outcome)).toContain('payload.collector_identity')
  })

  it('静默恢复：暂停→进行中却以事件为迁移权源 → 拒（M-13 须恢复决定）', () => {
    const payload = transitionPayload({ from_state: 'paused', to_state: 'in_progress', trigger_ref: ref('REC-EVT-01'), evidence_refs: [] })
    const outcome = validateWorkTransition(envelope('REC-WORK-06', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.trigger_ref.refType')
  })

  it('动作充数/非法迁移：已接受→进行中 → 拒（表外即非法，返回合法出口）', () => {
    const payload = transitionPayload({ from_state: 'accepted', to_state: 'in_progress', evidence_refs: [] })
    const outcome = validateWorkTransition(envelope('REC-WORK-06', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.to_state')
    const message = outcome.ok ? '' : outcome.issues.map((issue) => issue.message).join('|')
    expect(message).toContain('合法出口')
  })

  it('自检冒验收：以自检冒充独立验收 → 拒（W-03）', () => {
    const outcome = validateWorkAcceptance(envelope('REC-WORK-09', acceptancePayload(), PROOF), { selfCheckOnly: true, judgedByDeliverer: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.evidence_refs')
    expect(issuePaths(outcome)).toContain('payload.judged_by')
  })

  it('终局拒绝未说明为何不可返工 → 拒（L3D-09）', () => {
    const outcome = validateWorkAcceptance(envelope('REC-WORK-09', acceptancePayload({ verdict: 'rejected', reworkable: false }), PROOF))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.non_reworkable_basis')
  })

  it('未分类开工：信息门判可开工而主类型未分类 → 拒（L3D-11）', () => {
    const outcome = validateStartDecision(envelope('REC-WORK-04', startDecisionPayload()), { workType: 'unclassified' })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.gate_results')
  })

  it('资源不可知却判资源门可开工 → 拒（unknown≠充足）', () => {
    const payload = startDecisionPayload({
      resource_baseline: {
        subject: 'w-07',
        quota_ref: oref('quota-1'),
        entries: [{ resource_ref: oref('budget-1'), sufficient: null, basis: '额度不可知' }],
        as_of: AT,
        gaps: ['额度占用未知'],
      },
    })
    const outcome = validateStartDecision(envelope('REC-WORK-04', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.resource_baseline')
  })

  it('无限期暂缓（无期限无复审条件）→ 拒（I-11）', () => {
    const outcome = validateIntakeDecision(
      envelope('REC-WORK-02', intakeDecisionPayload({ outcome: 'hold', hold_terms: { preservation_duty: '保全原始内容' } })),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.hold_terms')
  })

})

describe('74 类登记齐（records/index.ts 并集闸）', () => {
  it('13 AREA 74 类、无重复、每类有 schema', () => {
    expect(RECORD_TYPE_COUNT).toBe(74)
    expect(ALL_RECORD_TYPES.length).toBe(74)
    expect(new Set(ALL_RECORD_TYPES).size).toBe(74)
    expect(Object.keys(ALL_RECORD_SCHEMAS).sort()).toEqual([...ALL_RECORD_TYPES].sort())
  })

  it('分族计数复算（16/11/1/21/6/2/1/4/1/1/2/4/4；CMD 两条命令/权源检查）', () => {
    const counts: Record<string, number> = {}
    for (const type of ALL_RECORD_TYPES) {
      const area = type.split('-')[1] ?? ''
      counts[area] = (counts[area] ?? 0) + 1
    }
    expect(counts).toEqual({
      CMD: 2, DEC: 1, RCP: 1, COR: 1, EVT: 3, AUTH: 8, LIFE: 11, PERF: 1, WORK: 21,
      EVD: 6, ACC: 2, CHG: 1, CAP: 4, REV: 1, EVAL: 1, ASSET: 2, OBS: 4, MEM: 4,
    })
  })

  it('WORK 族 21 类自登记一致（含三条具名类）', () => {
    expect(WORK_RECORD_TYPES.length).toBe(21)
    expect(WORK_RECORD_TYPES).toContain('REC-WORK-ACCEPT-MAINT')
    expect(WORK_RECORD_TYPES).toContain('REC-WORK-HANDOVER')
    expect(WORK_RECORD_TYPES).toContain('REC-WORK-COMMIT-CHANGE')
  })
})
