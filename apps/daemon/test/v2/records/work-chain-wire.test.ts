/**
 * work-chain-wire —— 开工/完成/验收链生产写面（studio-dev-560 刀C）定向红→绿
 *
 * 依据（实现单引用文档章节号）：docs/17-§2（主循环七相位／记录族生产写面映射表）；docs/17-§6
 * （收割四要件：记录是留痕不是判据）；docs/v2/11 §5.1（02/03/04/05）、§5.2（07/08/09 与
 * M-05/M-10/M-17 前置）、§六（EVD-03 八要素）、§〇.3-2（决定面封闭清单）、§十五-2（引用完整性）。
 *
 * 用例纪律：真 SQLite 台账（openLedger，tmp 目录）＋真写面；断言只认库内事实（hist.query 直查）。
 * 红例＝事实口缺省/前件未落（0 行＋逐项拒写理由）；绿例＝前置记录（刀B 授权/任职面 + CAP 前件）
 * 已落库后按相位落库；负例＝伪前件/高侧缺 EVD-01（拒写且零行，不臆造）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHistFace, openLedger, type HistFace, type Ledger } from '@studio-next/store'
import type { ReadContext } from '@studio-next/contract'
import type {
  CompletionRecordPayload,
  EffectLevelPayload,
  EvidencePackagePayload,
  IntakeDecisionPayload,
  PlanLockPayload,
  StartDecisionPayload,
  WorkAcceptancePayload,
  WorkContractPayload,
} from '../../../../../packages/contract/src/records/index.ts'
import {
  buildEnvelope,
  chainRecordId,
  chainRef,
  conflictRegistryRecordId,
  createRecordWire,
  type RecordWire,
  type RootGrantFact,
  type StartChainFacts,
  type HarvestChainFacts,
  type AcceptanceChainFacts,
} from '../../../src/engine/records/index.ts'
import {
  acceptancePayload,
  completionPayload,
  effectLevelPayload,
  gateResults,
  intakeDecisionPayload,
  planLockPayload,
  startDecisionPayload,
  workContractPayload,
} from '../../../../../packages/contract/test/v2/records/fixtures-work.ts'
import { AT, decisionFace } from '../../../../../packages/contract/test/v2/records/fixtures.ts'

const COMPANY = 'demo'
/** 读上下文（v2/14 §0.2-1：读方法必带；公司维=被测公司，两槽同填——V2 身份表落位前同值） */
const READ_CTX: ReadContext = {
  readScope: { company: { companyId: COMPANY, slug: COMPANY }, fields: ['record.payload'], purpose: 'work-chain-wire 测试读回' },
  caller: { callerId: 'ENG-1', kind: 'employment', personId: 'ENG-1' },
}
const T0 = Date.parse('2026-11-03T00:00:00.000Z')
const ISO0 = new Date(T0).toISOString()
const ROSTER = {
  departments: [
    { path: 'departments/综合部', leader: 'PRIME-0', functions: ['管理'], lanes: ['ops'] },
    { path: 'departments/研发部', leader: 'ENG-0', functions: ['交付'], lanes: ['core'] },
  ],
  people: [
    { id: 'PRIME-0', name: '首相', login: 'prime-0', level: 3, dept: 'departments/综合部', role: '总经理', status: 'active' },
    { id: 'ENG-0', name: '研发部长', login: 'eng-0', level: 3, dept: 'departments/研发部', role: '研发部长', status: 'active' },
    { id: 'ENG-1', name: '工程师', login: 'eng-1', level: 1, dept: 'departments/研发部', role: '执行', status: 'active' },
  ],
}
const ROOT_FACT: RootGrantFact = {
  establishmentRef: { refType: 'REC-EVT-01', refId: 'company-establishment:demo', refVersion: '1.0.0' },
  keyFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  externalSignatureRef: { refId: 'external-signature:producer-2026-11-01', refVersion: '1.0.0' },
  term: { from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
  proofVerified: true,
  fingerprintMatches: true,
}

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function wireWith(label: string): Promise<{ ledger: Ledger; hist: HistFace; wire: RecordWire }> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-560-${label}-`))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const hist = createHistFace(ledger.db)
  const wire = createRecordWire({ hist, company: COMPANY, roster: { roster: () => ROSTER }, rootGrant: ROOT_FACT })
  return { ledger, hist, wire }
}

function rowsOf(hist: HistFace, type: string) {
  return hist.query({ company: COMPANY, type }, READ_CTX)
}

/** 台账直插前件（刀B/CAP 之外的记录：本测试的「已落库」前置，非生产写面） */
function seed(hist: HistFace, recordId: string, recordType: string, payload: unknown, decidedBy = 'ENG-0'): void {
  const built = buildEnvelope(
    { recordType, recordId, producedAt: new Date(T0).toISOString(), decidedBy, effectiveState: 'effective', payload },
    { company: COMPANY },
  )
  if (!built.ok) throw new Error(`seed ${recordType} 形状失败：${built.reason}`)
  hist.append(built.envelope)
}

/** 绿面前件：刀B 授权/任职链 + CAP-01/02 + WORK-01 */
function seedPrereqs(hist: HistFace, wire: RecordWire): { authRef: ReturnType<typeof chainRef>; life05Ref: ReturnType<typeof chainRef> } {
  wire.rosterLoad({ at: T0, reason: 'boot' })
  const auth = wire.authorityRefFor({ personId: 'ENG-1', actionScope: 'dept:departments/研发部' })
  if (!auth.ok) throw new Error(`AUTH-01 前件未落：${auth.reason}`)
  const authRef = { refType: auth.ref.recordType, refId: auth.ref.recordId, refVersion: '1.0.0' }
  const life05Id = conflictRegistryRecordId(COMPANY, 'ENG-1', 'departments/研发部')
  const life05 = hist.get(life05Id, READ_CTX)
  if (life05 === undefined) throw new Error('LIFE-05 前件未落')
  const life05Ref = chainRef(life05.recordType, life05.recordId)
  // CAP-01/02（刀C 计划锁的契约前件；件外族，本测试只作为「已落库」事实种入）
  const cap01Id = `rec-cap-01:${COMPANY}:ENG-1:1.0.0`
  seed(hist, cap01Id, 'REC-CAP-01', {
    claim: {
      中立能力与类型: '代码实现',
      实现与来源: 'dsh-mid',
      宿主与绑定: 'serve 进程',
      依赖与冲突: '无',
      输入输出与已知限制: '仓内文件',
      副作用请求: [],
      生命周期: { supported: ['launch'], unsupported: ['外部网络'] },
      观测与成本: 'tokens 观测',
      证据与已知不能: '不证外部效果',
    },
    claimant: 'ENG-1',
    version: '1.0.0',
    evidence_refs: [],
  })
  const cap01Ref = chainRef('REC-CAP-01', cap01Id)
  seed(hist, `rec-cap-02:${COMPANY}:ENG-1:1.0.0`, 'REC-CAP-02', {
    subject: cap01Ref,
    scope: 'dept:departments/研发部',
    conclusion: 'recognized',
    conditions: [],
    term: { expires_at: '2027-01-01T00:00:00.000Z', renewal_rule: '到期重认' },
    evidence_refs: [cap01Ref],
    decided_by: 'ENG-0',
    independence: { verified_by: 'PRIME-0', control_basis_ref: life05Ref, structurally_unavailable: false },
    review_and_invalidation: {
      review_point: '2026-12-01T00:00:00.000Z',
      invalidation_rule: '范围变化即失效',
      dispute_entry: 'PRIME-0',
    },
  })
  // WORK-01 意图信封（刀A 已闭合族；用真写面落，供 02 引用）
  wire.intake({
    issue: { id: 'DEMO-560', title: '刀C 定向绿例', state: '新单', updated: new Date(T0).toISOString() },
    at: T0,
    actor: 'ENG-0',
    source: 'test.seed',
  })
  return { authRef, life05Ref }
}

function startFacts(authRef: ReturnType<typeof chainRef>): StartChainFacts {
  const w01 = chainRef('REC-WORK-01', `rec-work-01:${COMPANY}:DEMO-560`)
  const w02 = chainRef('REC-WORK-02', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-02'))
  const w07 = chainRef('REC-WORK-07', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-07'))
  const w03 = chainRef('REC-WORK-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-03'))
  const w04 = chainRef('REC-WORK-04', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-04'))
  const cap01 = chainRef('REC-CAP-01', `rec-cap-01:${COMPANY}:ENG-1:1.0.0`)
  const cap02 = chainRef('REC-CAP-02', `rec-cap-02:${COMPANY}:ENG-1:1.0.0`)
  const face = { authority_ref: authRef, basis_refs: [w01], decided_by: 'ENG-0' }
  return {
    workType: 'create',
    intentRef: w01,
    authorityRef: authRef,
    intake: intakeDecisionPayload({
      intent_ref: w01,
      decided_by: 'ENG-0',
      authority_ref: authRef,
      outcome: 'accepted',
      decision_face: decisionFace({ ...face, effective_time: ISO0 }),
    }) as unknown as IntakeDecisionPayload,
    effect: effectLevelPayload({
      subject_ref: w02,
      classified_by: 'ENG-0',
      decision_face: decisionFace({ ...face, effective_time: ISO0 }),
    }) as unknown as EffectLevelPayload,
    contract: workContractPayload({
      commitment_ref: w02,
      risk_classification_ref: w07,
      acceptance_criteria: {
        judged: '产物可用且证据包齐备',
        how: '按当时验收口径逐项核对',
        who: 'QA-2',
        when: AT,
        effect_level_ref: w07,
      },
      responsibility_positions: { work_owner: 'ENG-1', acceptor: 'QA-2', committer: 'PRIME-0', recorder: 'ENG-0' },
    }) as unknown as WorkContractPayload,
    plan: planLockPayload({
      contract_ref: w03,
      qualification_refs: [cap02],
      capability_descriptors: [{ capability_ref: cap01, digest: 'sha256:cap-1' }],
    }) as unknown as PlanLockPayload,
    start: startDecisionPayload({
      contract_ref: w03,
      authority_ref: authRef,
      gate_results: gateResults(),
      decision_face: decisionFace({ ...face, effective_time: ISO0 }),
    }) as unknown as StartDecisionPayload,
    transition: {
      decidedBy: 'PRIME-0',
      authorityRef: authRef,
      rationale: '派发决定已作出：意图/效果级/合同/计划锁/开工判断逐件落库',
      basisRefs: [w02, w04],
      scopeJudged: { judged: ['开工资格'], notJudged: ['验收', '价值'] },
      dissentPosition: '无异议',
    },
  }
}

function evidencePackage(): EvidencePackagePayload {
  const w03 = chainRef('REC-WORK-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-03'))
  const elements = Object.fromEntries(
    ['EVD-ELM-01', 'EVD-ELM-02', 'EVD-ELM-03', 'EVD-ELM-04', 'EVD-ELM-05', 'EVD-ELM-06', 'EVD-ELM-07', 'EVD-ELM-08'].map((id) => [
      id,
      { missing_reason: `${id} 未采集：低侧证据包只作自检自述（不冒充独立充分）` },
    ]),
  )
  return {
    work_ref: w03,
    contract_revision: '1.0.0',
    elements_present: elements,
    self_check: { checklist_ref: w03, conclusion: '自检通过（交付方自述，不构成独立验收）', self_reported: true },
    sufficiency_claim: '低侧：终态+自报；未主张独立充分',
    unresolved: ['低侧未做独立抽样（EX-1）'],
    dissent_entries: [],
  } as unknown as EvidencePackagePayload
}

function harvestFacts(authRef: ReturnType<typeof chainRef>): HarvestChainFacts {
  const w03 = chainRef('REC-WORK-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-03'))
  const w07 = chainRef('REC-WORK-07', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-07'))
  const w08 = chainRef('REC-WORK-08', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-08'))
  const evd = chainRef('REC-EVD-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-EVD-03'))
  const auth = authRef
  return {
    workType: 'create',
    effectLevel: 'EX-1',
    workRef: w03,
    effectRef: w07,
    evidencePackage: evidencePackage(),
    completion: completionPayload({
      work_ref: w03,
      effect_level_ref: w07,
      completion_basis: [
        { element: '终态事件', state: 'present' },
        { element: '自报', state: 'present' },
      ],
      collector_identity: { collector: 'ENG-1', independence: '低侧自报（EX-1）', self_reported: true },
      harvest_ref: undefined,
      sampling_ref: undefined,
      gaps: ['低侧未做独立抽样：按终态＋自报，不按 EX-2+ 四要件'],
    }) as unknown as CompletionRecordPayload,
    transition: {
      decidedBy: 'ENG-0',
      authorityRef: auth,
      rationale: '收割四要件齐备（终态/非空/REPORT/exit0），证据包与完成判据已落',
      basisRefs: [w08, evd],
      scopeJudged: { judged: ['证据就绪'], notJudged: ['验收'] },
      dissentPosition: '无异议',
    },
  }
}

function acceptanceFacts(life05Ref: ReturnType<typeof chainRef>, authRef: ReturnType<typeof chainRef>): AcceptanceChainFacts {
  const w03 = chainRef('REC-WORK-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-03'))
  const w07 = chainRef('REC-WORK-07', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-07'))
  const evd = chainRef('REC-EVD-03', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-EVD-03'))
  return {
    workType: 'create',
    effectLevel: 'EX-1',
    workRef: w03,
    effectRef: w07,
    independenceRef: life05Ref,
    acceptance: acceptancePayload({
      work_ref: w03,
      judged_by: 'QA-2',
      independence_verified_by: { verified_by: 'QA-2', control_basis_ref: life05Ref },
      evidence_refs: [evd, w07],
      effect_level_applied: w07,
      decision_face: decisionFace({ authority_ref: authRef, basis_refs: [evd], decided_by: 'QA-2', effective_time: ISO0 }),
    }) as unknown as WorkAcceptancePayload,
    transition: {
      decidedBy: 'QA-2',
      authorityRef: authRef,
      rationale: '验收四值 accepted：证据包与独立性核验齐备',
      basisRefs: [chainRef('REC-WORK-09', chainRecordId(COMPANY, 'DEMO-560', 1, 'REC-WORK-09'))],
      scopeJudged: { judged: ['验收'], notJudged: ['价值', '结清'] },
      dissentPosition: '无异议',
    },
  }
}

describe('刀C 红面：事实口缺省/前件未落 → 八族 fail-closed（0 行，不臆造）', () => {
  it('startChain 无 facts：五族逐条 record-prereq-missing，records 0 行', async () => {
    const { hist, wire } = await wireWith('red-start')
    const results = wire.startChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1' })
    expect(results).toHaveLength(5)
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('record-prereq-missing')
    }
    expect(hist.query({ company: COMPANY }, READ_CTX)).toHaveLength(0)
  })

  it('harvestChain/acceptanceChain 无 facts：逐族拒写，records 0 行', async () => {
    const { hist, wire } = await wireWith('red-review')
    const harvested = wire.harvestChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1' })
    const accepted = wire.acceptanceChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1' })
    expect(harvested.map((result) => (result.ok ? 'ok' : result.code))).toEqual(['record-prereq-missing', 'record-prereq-missing'])
    expect(accepted.map((result) => (result.ok ? 'ok' : result.code))).toEqual(['record-prereq-missing'])
    expect(hist.query({ company: COMPANY }, READ_CTX)).toHaveLength(0)
  })

  it('facts 带伪 authority_ref（未落库）：开工链全拒，0 行（引用未来记录＝拒写）', async () => {
    const { hist, wire } = await wireWith('red-fake-auth')
    const facts = startFacts(chainRef('REC-AUTH-01', 'rec-auth-01:demo:FORGED:1'))
    const results = wire.startChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1', facts })
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(hist.query({ company: COMPANY }, READ_CTX)).toHaveLength(0)
  })
})

describe('刀C 绿面：刀B 授权/任职＋CAP 前件已落库 → 八族按相位落库（真表直查）', () => {
  it('相位 3 开工链：WORK-02/07/03/05/04 + M-05 逐族落库；相位 4：EVD-03/08 + M-10；验收：WORK-09 + M-17', async () => {
    const { hist, wire } = await wireWith('green')
    const { authRef, life05Ref } = seedPrereqs(hist, wire)
    const started = wire.startChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1', facts: startFacts(authRef) })
    expect(started.map((result) => (result.ok ? result.recordType : `${result.recordType}:${result.reason}`))).toHaveLength(6)
    expect(started.filter((result) => !result.ok)).toEqual([])
    const harvested = wire.harvestChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1', facts: harvestFacts(authRef) })
    expect(harvested.filter((result) => !result.ok)).toEqual([])
    const accepted = wire.acceptanceChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1', facts: acceptanceFacts(life05Ref, authRef) })
    expect(accepted.filter((result) => !result.ok)).toEqual([])

    for (const type of ['REC-WORK-02', 'REC-WORK-03', 'REC-WORK-04', 'REC-WORK-05', 'REC-WORK-07', 'REC-WORK-08', 'REC-WORK-09', 'REC-EVD-03']) {
      expect(rowsOf(hist, type), `${type} 应按相位落库`).toHaveLength(1)
    }
    // M-05/M-10/M-17 三条迁移留痕（刀A 的 WORK-06 写面在前件齐后落库）
    expect(rowsOf(hist, 'REC-WORK-06').length).toBeGreaterThanOrEqual(3)
    // 刀D 族与其他未接族仍零写（负向断言：不误写）
    for (const type of ['REC-WORK-10', 'REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01', 'REC-CHG-01', 'REC-REV-01', 'REC-MEM-03', 'REC-EVD-04']) {
      expect(rowsOf(hist, type), `${type} 应仍 fail-closed`).toHaveLength(0)
    }
  })

  it('高侧（EX-2）缺 EVD-01 收割批次 → EVD-03 八要素/完成判据拒写，不冒认四要件', async () => {
    const { hist, wire } = await wireWith('high-side')
    const { authRef } = seedPrereqs(hist, wire)
    wire.startChain({ ticket: 'DEMO-560', attempt: 1, at: T0, actor: 'ENG-1', facts: startFacts(authRef) })
    const facts = harvestFacts(authRef)
    const results = wire.harvestChain({
      ticket: 'DEMO-560',
      attempt: 1,
      at: T0,
      actor: 'ENG-1',
      facts: { ...facts, effectLevel: 'EX-2' },
    })
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(rowsOf(hist, 'REC-WORK-08')).toHaveLength(0)
    expect(rowsOf(hist, 'REC-EVD-03')).toHaveLength(0)
    expect(rowsOf(hist, 'REC-WORK-06').filter((row) => (row.payload as { to_state?: string }).to_state === 'awaiting_review')).toHaveLength(0)
  })
})
