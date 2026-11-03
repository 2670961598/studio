/**
 * phase-d-live —— 刀D 进程级证据跑器（studio-dev-561；非单测自证）
 *
 * 用法（仓根）：
 *   bun apps/daemon/test/v2/records/fixtures/phase-d-live.ts --mode=green --db=/private/tmp/sn561-green.db
 *   bun apps/daemon/test/v2/records/fixtures/phase-d-live.ts --mode=red   --db=/private/tmp/sn561-red.db
 *
 * 依据：docs/17-§2·刀D（相位×记录类型×写入者×前置闸）；docs/17-§6；docs/v2/11 §5.2/§5.4/
 * §六/§七/§八/§十/§十三。证据口径：写完后由调用方用 `sqlite3 ... GROUP BY record_type` 直查
 * （本跑器只落库并打印计数，不替 sqlite 断言）。red=前置件未落/独立性自填，全部 refused、0 行。
 */
import {
  COMPANY,
  T0,
  iso,
  openPhaseDStack,
  ref,
  writeGreenScenario,
} from './phase-d-stack.ts'

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const [key, value] = raw.replace(/^--/, '').split('=')
  if (key !== undefined) args.set(key, value ?? '')
}
const mode = args.get('mode') ?? 'green'
const dbPath = args.get('db')
if (dbPath === undefined || (mode !== 'red' && mode !== 'green')) {
  console.error('用法：--mode=red|green --db=<sqlite 路径>')
  process.exit(2)
}

const stack = openPhaseDStack(dbPath)
const auth = ref('REC-AUTH-01', 'auth-1')

if (mode === 'green') {
  const result = writeGreenScenario(stack)
  console.log(JSON.stringify({ mode, writes: result.writes, counters: stack.wire.counters }))
} else {
  // 红例：前置件未落/独立性自填/匿名接收/跳段——应全部 refused，库内 0 行
  const refused: string[] = []
  const settlement = stack.wire.settlement({
    ticket: 'DEMO-561',
    attempt: 1,
    at: T0,
    payload: {
      work_ref: ref('REC-WORK-01', 'missing-work'),
      items: [{ item: 'artifact', state: 'closed' }],
      reservations: [],
      derived_face_evidence: [],
      memory_disposition_refs: [],
      verified_by: 'AGENT-5',
      independence: { verified_by: 'AGENT-5', control_basis_ref: auth },
      verified_scope: 'close',
      dissent_position: '无异议',
      decision_face: {
        decided_by: 'AGENT-5', authority_ref: auth, rationale: 'r', basis_refs: [auth],
        scope_judged: { judged: ['x'], not_judged: [] }, dissent_position: '无异议',
        effective_state: 'effective', effective_time: iso(T0),
      },
    },
  })
  if (!settlement.ok) refused.push(settlement.recordType)
  const exception = stack.wire.exception({
    ticket: 'DEMO-561',
    attempt: 1,
    at: T0,
    payload: {
      subject_ref: ref('REC-WORK-01', 'missing-work'), exception_class: 'rule_deviation', judged_against: 'r',
      impact_scope: 's', discovered_by: 'AGENT-1', receiver: '框架',
      escalation_target: { position: 'AGENT-2', deadline: iso(T0), re_escalate_to: 'AGENT-3' },
      response_deadline: iso(T0), review_condition: 'c', terminal: null, dissent_position: '无异议',
    },
  })
  if (!exception.ok) refused.push(exception.recordType)
  const accountability = stack.wire.accountability({
    ticket: 'DEMO-561',
    at: T0,
    payload: {
      subject_ref: ref('REC-LIFE-01', 'missing-life'), matter_refs: [ref('REC-WORK-01', 'missing-work')],
      inquiry_materials: { allegations: ['a'], explanations: [], adverse_information: [], silence_treated_as_report_exception: true },
      defense_window: { deadline: iso(T0), overdue_disposition: 'escalate' },
      arbiter: { verified_by: 'AGENT-6', control_basis_ref: auth },
      conclusion: 'established', consequence_routing: {}, dissent_position: '无异议', proof_boundary: 'p',
    },
  })
  if (!accountability.ok) refused.push(accountability.recordType)
  const review = stack.wire.review({
    ticket: 'DEMO-561',
    at: T0,
    payload: {
      scope: { matters: [ref('REC-WORK-01', 'missing-work')], window: { from: iso(T0), to: iso(T0 + 1000) } },
      inputs: {
        acceptance_refs: [], cost_account_ref: ref('REC-EVD-04', 'missing-value'), counterparty_feedback: [],
        affected_party_feedback: [], contrary_examples: [], unfulfilled_commitments: [],
      },
      findings: [{ finding: 'f', basis_refs: [auth] }],
      outputs: { personal_experience_refs: [], method_rule_candidates: [], structural_issues: [] },
      independence: { decided_by: 'AGENT-8', independence_note: 'n' },
      dissent_position: '无异议',
      decision_face: {
        decided_by: 'AGENT-8', authority_ref: auth, rationale: 'r', basis_refs: [auth],
        scope_judged: { judged: ['x'], not_judged: [] }, dissent_position: '无异议',
        effective_state: 'effective', effective_time: iso(T0),
      },
    },
  })
  if (!review.ok) refused.push(review.recordType)
  console.log(JSON.stringify({ mode, refused, counters: stack.wire.counters }))
}

const types = [
  'REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01', 'REC-ACC-02', 'REC-CHG-01', 'REC-REV-01',
  'REC-MEM-03', 'REC-EVD-04', 'REC-WORK-08', 'REC-WORK-09', 'REC-WORK-10', 'REC-WORK-13', 'REC-EVD-01',
]
const counts: Record<string, number> = {}
for (const type of types) counts[type] = stack.hist.query({ company: COMPANY, type }).length
console.log(JSON.stringify({ mode, db: dbPath, counts }))
stack.ledger.close()
