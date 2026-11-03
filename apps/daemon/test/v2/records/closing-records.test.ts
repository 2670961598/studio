/**
 * closing-records —— 刀D「结清/复盘/问责/变更链/记忆分流/价值评估」定向红→绿（studio-dev-561）
 *
 * 依据：docs/17-§2「记录族生产写面」段·刀D（相位 5/6 结清、相位 6/断路异常、配置热更、
 * 终局后/周期复盘）；docs/17-§6（收割四要件；记录是留痕不是判据）；docs/v2/11 §5.2/§5.4/
 * §六/§七/§八/§十/§十三。
 *
 * 用例纪律（V2 新套件）：真 SQLite 台账＋真 wire，不 mock 记录面；
 *   红=前置件未落/自填独立性/匿名接收/跳段 → refused 且 0 行；
 *   绿=前置件落库后按相位写面落行；其它未解锁族（WORK-08/09/EVD-01）仍 fail-closed。
 * 断言只认库内事实（hist.query 直查），不认桩、不认注释。
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  BLOCKED_RECORD_FAMILIES,
  PHASE_RECORD_FAMILIES,
  UNBLOCKED_RECORD_FAMILIES,
  blockedDraftFor,
  refMatches,
  type RecordWriteResult,
} from '../../../src/engine/records/index.ts'
import {
  COMPANY,
  T0,
  createPhaseDStack,
  greenInputs,
  iso,
  ref,
  seedLife,
  seedPrereqs,
  seedWork,
  writeChangeChain,
  writeGreenScenario,
  type PhaseDStack,
} from './fixtures/phase-d-stack.ts'

const stacks: PhaseDStack[] = []
afterAll(async () => {
  for (const stack of stacks) await stack.cleanup()
})

async function stack(label: string): Promise<PhaseDStack> {
  const created = await createPhaseDStack(label)
  stacks.push(created)
  return created
}

/** 断言拒写（refused；不落行） */
function expectRefused(result: RecordWriteResult, needle: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.code).toBe('record-prereq-missing')
    expect(result.reason).toContain(needle)
  }
}

/** 数一族的库内行数（唯一事实源） */
function countOf(stack: PhaseDStack, recordType: string): number {
  return stack.hist.query({ company: COMPANY, type: recordType }).length
}

describe('刀D 族清单（逐族解除 BLOCKED 并留表）', () => {
  it('八族解除阻断、逐族留相位/写面/前置闸；其余族仍在阻断表', () => {
    const expected = ['REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01', 'REC-ACC-02', 'REC-CHG-01', 'REC-REV-01', 'REC-MEM-03', 'REC-EVD-04']
    for (const type of expected) {
      expect(UNBLOCKED_RECORD_FAMILIES[type]).toBeDefined()
      expect(BLOCKED_RECORD_FAMILIES[type]).toBeUndefined()
      expect(UNBLOCKED_RECORD_FAMILIES[type]?.gate.length).toBeGreaterThan(10)
    }
    expect(Object.keys(UNBLOCKED_RECORD_FAMILIES).sort()).toEqual(expected.sort())
    // 未解锁族仍 fail-closed（不误写）
    for (const type of ['REC-WORK-08', 'REC-WORK-09', 'REC-WORK-10', 'REC-WORK-13', 'REC-EVD-01']) {
      expect(BLOCKED_RECORD_FAMILIES[type]).toBeDefined()
      const outcome = blockedDraftFor(type)
      expect(outcome.ok).toBe(false)
    }
    const unblocked = blockedDraftFor('REC-WORK-12')
    expect(unblocked.ok).toBe(false)
    if (!unblocked.ok) expect(unblocked.reason).toContain('写面已解除阻断')
  })

  it('相位族映射与 docs/17-§2 刀D 表同源（相位 5/6/断路/变更/复盘）', () => {
    expect(PHASE_RECORD_FAMILIES['phase5.close']).toContain('REC-WORK-12')
    expect(PHASE_RECORD_FAMILIES['phase5.close']).toContain('REC-MEM-03')
    expect(PHASE_RECORD_FAMILIES['phase5.close']).toContain('REC-EVD-04')
    expect(PHASE_RECORD_FAMILIES['phase6.recycle']).toContain('REC-WORK-17')
    expect(PHASE_RECORD_FAMILIES['phase6.breaker']).toContain('REC-ACC-01')
    expect(PHASE_RECORD_FAMILIES['config.change']).toEqual(['REC-CHG-01'])
    expect(PHASE_RECORD_FAMILIES['post-terminal.review']).toEqual(['REC-REV-01'])
  })
})

describe('刀D 红例（前置件未落/独立性自填/匿名接收/跳段 → 拒写且 0 行）', () => {
  it('空台账：目标族 0 行；七族前置不齐逐类拒写', async () => {
    const s = await stack('red')
    const auth = ref('REC-AUTH-01', 'auth-1')
    const work = ref('REC-WORK-01', 'missing-work')

    expectRefused(s.wire.settlement({ ticket: 'DEMO-561', attempt: 1, at: T0, payload: {
      work_ref: work,
      items: [{ item: 'artifact', state: 'closed' }],
      reservations: [], derived_face_evidence: [], memory_disposition_refs: [],
      verified_by: 'AGENT-5', independence: { verified_by: 'AGENT-5', control_basis_ref: auth },
      verified_scope: 'close', dissent_position: '无异议',
      decision_face: { decided_by: 'AGENT-5', authority_ref: auth, rationale: 'r', basis_refs: [auth], scope_judged: { judged: ['x'], not_judged: [] }, dissent_position: '无异议', effective_state: 'effective', effective_time: iso(T0) },
    } }), '记忆三路分流')

    expectRefused(s.wire.exception({ ticket: 'DEMO-561', attempt: 1, at: T0, payload: {
      subject_ref: work, exception_class: 'rule_deviation', judged_against: 'r', impact_scope: 's', discovered_by: 'AGENT-1',
      receiver: '框架', escalation_target: { position: 'AGENT-2', deadline: iso(T0), re_escalate_to: 'AGENT-3' },
      response_deadline: iso(T0), review_condition: 'c', terminal: null, dissent_position: '无异议',
    } }), '接收位置不得匿名')

    expectRefused(s.wire.accountability({ ticket: 'DEMO-561', at: T0, payload: {
      subject_ref: ref('REC-LIFE-01', 'missing-life'), matter_refs: [work],
      inquiry_materials: { allegations: ['a'], explanations: [], adverse_information: [], silence_treated_as_report_exception: true },
      defense_window: { deadline: iso(T0), overdue_disposition: 'escalate' },
      arbiter: { verified_by: 'AGENT-6', control_basis_ref: auth },
      conclusion: 'established', consequence_routing: {}, dissent_position: '无异议', proof_boundary: 'p',
    } }), '未落库')

    expectRefused(s.wire.review({ ticket: 'DEMO-561', at: T0, payload: {
      scope: { matters: [work], window: { from: iso(T0), to: iso(T0 + 1000) } },
      inputs: { acceptance_refs: [], cost_account_ref: ref('REC-EVD-04', 'missing-value'), counterparty_feedback: [], affected_party_feedback: [], contrary_examples: [], unfulfilled_commitments: [] },
      findings: [{ finding: 'f', basis_refs: [auth] }], outputs: { personal_experience_refs: [], method_rule_candidates: [], structural_issues: [] },
      independence: { decided_by: 'AGENT-8', independence_note: 'n' }, dissent_position: '无异议',
      decision_face: { decided_by: 'AGENT-8', authority_ref: auth, rationale: 'r', basis_refs: [auth], scope_judged: { judged: ['x'], not_judged: [] }, dissent_position: '无异议', effective_state: 'effective', effective_time: iso(T0) },
    } }), '未落库')

    expectRefused(s.wire.memoryDisposal({ ticket: 'DEMO-561', at: T0, independentPosition: 'AGENT-1', requestedBy: 'AGENT-1', payload: {
      operation: 'archive', target_entries: [ref('REC-MEM-01', 'm1')],
      authorizations: [{ layer: 'work', authorized_by: 'AGENT-1' }],
      reason_and_impact: { reason: 'r', impact_scope: 's', irrecoverable_notice: 'n' }, retained_obligations: [],
      disposal_evidence: { route: 'archive', archive_location: 'a', acceptance_ref: ref('REC-WORK-09', 'a') },
      notice: { notified: [{ refId: 'AGENT-1', refVersion: '1.0.0' }], residue_statement: 'r' },
    } }), '不得与请求方同体')

    expectRefused(s.wire.valueEvaluation({ ticket: 'DEMO-561', at: T0, payload: {
      work_ref: work, acceptance_ref: null,
      artifact_account: { entries: [{ item: 'a', amount: 1, note: 'n' }], basis: 'b' },
      state_account: { entries: [{ item: 's', amount: 1, note: 'n' }], basis: 'b' },
      impact_account: { entries: [{ item: 'i', amount: null, note: 'n' }], basis: 'b' },
      cost_account: { entries: [{ item: 'c', amount: 1, note: 'n' }], basis: 'b' },
      negative_value_items: [], external_feedback: [], conclusion: 'positive',
      uncertainty_and_dissent: { uncertainty: 'u', dissent_position: 'd' }, judged_by: 'AGENT-3',
      independence: { verified_by: 'AGENT-4', control_basis_ref: auth, self_declared: true }, proof_boundary: 'p',
    } }), '独立性自填')

    for (const type of ['REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01', 'REC-EVD-04', 'REC-MEM-03', 'REC-REV-01']) {
      expect(countOf(s, type)).toBe(0)
    }
  })

  it('结清四态/承接/派生面：转入清算缺 handover → 拒写', async () => {
    const s = await stack('red-settle')
    const auth = ref('REC-AUTH-01', 'auth-1')
    const outcome = s.wire.settlement({ ticket: 'DEMO-561', attempt: 1, at: T0, payload: {
      work_ref: ref('REC-WORK-01', 'w'),
      items: [{ item: 'artifact', state: 'closed', into_liquidation: true }],
      reservations: [], derived_face_evidence: [], memory_disposition_refs: [ref('REC-MEM-03', 'm')],
      verified_by: 'AGENT-5', independence: { verified_by: 'AGENT-5', control_basis_ref: auth },
      verified_scope: 'close', dissent_position: '无异议',
      decision_face: { decided_by: 'AGENT-5', authority_ref: auth, rationale: 'r', basis_refs: [auth], scope_judged: { judged: ['x'], not_judged: [] }, dissent_position: '无异议', effective_state: 'effective', effective_time: iso(T0) },
    } })
    expectRefused(outcome, '承接')
    expect(countOf(s, 'REC-WORK-12')).toBe(0)
  })

  it('变更链跳段：candidate 后直接 activation_approval → 拒写（不可跳段）', async () => {
    const s = await stack('red-chg')
    const auth = ref('REC-AUTH-01', 'auth-1')
    const chain = writeChangeChain(s, T0, auth)
    expect(chain).toHaveLength(5)
    const skipped = s.wire.changeSegment({
      ticket: 'CHG-561',
      at: T0 + 50_000,
      previousSegmentRef: ref('REC-CHG-01', 'rec-chg-01:demo:chg-561:candidate'),
      context: { previousSegment: 'candidate', gateDeciders: { verification_authorization: 'A1', independent_verification: 'A2', activation_approval: 'A3' } },
      payload: {
        chain_id: 'chg-561', segment: 'activation_approval',
        subject: { refId: 'rule-1', refVersion: '1.0.0' }, subject_kind: 'rule',
        decided_by: 'AGENT-12', authority_ref: auth, basis_refs: [auth],
        impact_assessment: { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] },
        criteria_version: '1.0.0', no_override: true,
        rollback_path: { stop_conditions: ['s'], monitoring: ['m'], rollback_steps: ['r'] },
        dissent_position: '无异议', effective_state: 'effective', effective_time: iso(T0 + 50_000),
      },
    })
    expectRefused(skipped, '段不可跳')
  })

  it('三门不合并：三门由同一具名位置作出 → 拒写', async () => {
    const s = await stack('red-gates')
    const auth = ref('REC-AUTH-01', 'auth-1')
    writeChangeChain(s, T0, auth)
    const outcome = s.wire.changeSegment({
      ticket: 'CHG-561',
      at: T0 + 60_000,
      previousSegmentRef: ref('REC-CHG-01', 'rec-chg-01:demo:chg-561:independent_verification'),
      context: { previousSegment: 'independent_verification', gateDeciders: { verification_authorization: 'SAME', independent_verification: 'SAME', activation_approval: 'SAME' } },
      payload: {
        chain_id: 'chg-561', segment: 'activation_approval',
        subject: { refId: 'rule-1', refVersion: '1.0.0' }, subject_kind: 'rule',
        decided_by: 'SAME', authority_ref: auth, basis_refs: [auth],
        impact_assessment: { tasks: [], information: [], permissions: [], commitments: [], evidence: [], qualifications: [], in_flight_side_effects: [] },
        criteria_version: '1.0.0', no_override: true,
        rollback_path: { stop_conditions: ['s'], monitoring: ['m'], rollback_steps: ['r'] },
        dissent_position: '无异议', effective_state: 'effective', effective_time: iso(T0 + 60_000),
      },
    })
    expectRefused(outcome, '三门不合并')
  })
})

describe('刀D 绿例（前置件落库后按相位写面落行）', () => {
  it('七族＋ACC-02 全绿：WORK-12/17、ACC-01/02、REV-01、MEM-03、EVD-04、CHG-01×5 落库', async () => {
    const s = await stack('green')
    const result = writeGreenScenario(s)
    expect(result.writes).toHaveLength(5 + 5)
    expect(countOf(s, 'REC-WORK-12')).toBe(1)
    expect(countOf(s, 'REC-WORK-17')).toBe(1)
    expect(countOf(s, 'REC-ACC-01')).toBe(1)
    expect(countOf(s, 'REC-ACC-02')).toBe(1)
    expect(countOf(s, 'REC-REV-01')).toBe(1)
    expect(countOf(s, 'REC-MEM-03')).toBe(1)
    expect(countOf(s, 'REC-EVD-04')).toBe(1)
    expect(countOf(s, 'REC-CHG-01')).toBe(5)
    // 未解锁族仍 0 行（负向断言：不误写）
    for (const type of ['REC-WORK-08', 'REC-WORK-09', 'REC-WORK-10', 'REC-WORK-13', 'REC-EVD-01']) {
      expect(countOf(s, type)).toBe(0)
    }
  })

  it('幂等：同结清重放 deduped、零第二行（§0.4-4）', async () => {
    const s = await stack('green-idem')
    const auth = ref('REC-AUTH-01', 'auth-1')
    const work = seedWork(s.wire)
    const life = seedLife(s.hist, auth)
    const prereq = seedPrereqs(s.wire, work)
    const inputs = greenInputs({ work, life, memory: prereq.memory, value: prereq.value })
    expect(s.wire.settlement(inputs.settlement).ok).toBe(true)
    const replay = s.wire.settlement(inputs.settlement)
    expect(replay.ok).toBe(true)
    if (replay.ok) expect(replay.deduped).toBe(true)
    expect(countOf(s, 'REC-WORK-12')).toBe(1)
    expect(s.wire.counters.deduped).toBeGreaterThan(0)
  })
})

describe('契约面零变更／引用族机械判', () => {
  it('refMatches：精确值/候选集/正则三形态（引用类型机械判，不猜）', () => {
    expect(refMatches(ref('REC-WORK-09', 'w'), /^REC-WORK-/)).toBe(true)
    expect(refMatches(ref('REC-EVD-04', 'e'), 'REC-EVD-04')).toBe(true)
    expect(refMatches(ref('REC-MEM-03', 'm'), ['REC-MEM-03', 'REC-MEM-01'])).toBe(true)
    expect(refMatches(ref('REC-CHG-01', 'c'), 'REC-EVD-04')).toBe(false)
  })
})
