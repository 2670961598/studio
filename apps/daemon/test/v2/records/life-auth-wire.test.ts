/**
 * life-auth-wire —— 任职/授权链生产写面（刀B）定向红→绿（studio-dev-605 重出 #559）
 *
 * 依据（实现单引用文档章节号）：docs/17-§2（主循环七相位／记录族生产写面映射表：相位 0 名册装载、
 * 相位 4 出工段、相位 7 对账读者）；docs/17-§6（收割四要件：记录是留痕不是判据）；docs/v2/11
 * §3.1（REC-LIFE-01 五条件/幂等四元组、REC-LIFE-04 出工必引生效任命）、§2.2（REC-AUTH-01 根授予
 * 三闸/转授边/不可为边界）、§0.4-4（重放零第二副作用）、§六（EVD-01 首项 segment_ref）、
 * §七（独立性：自填即拒）、§十五-2；docs/20a（交付 patch 形态门——与本测试无关，仅列交付面依据）。
 *
 * 用例纪律（V2 新套件）：真 SQLite 台账（openLedger，tmp 目录）＋真写面/真引擎；断言只认库内事实
 * （hist.query 直查、kv 直查、源码机械扫描）；红例＝面关/外部事实缺（0 行 + 逐项拒写理由），
 * 绿例＝名册+外部事实齐（按相位落库），负例＝自填/非在岗/前件缺（拒写且零行，不臆造）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadContext } from '@studio-next/contract'
import { createHistFace, openLedger, type Ledger } from '@studio-next/store'
import {
  BLOCKED_RECORD_FAMILIES,
  PENDING_PREREQ_FAMILIES,
  UNBLOCKED_RECORD_FAMILIES,
  RECORDS_RECONCILE_LAST_KEY,
  appointmentDraft,
  appointmentRecordId,
  blockedDraftFor,
  conflictRegistryDraft,
  createRecordWire,
  personOf,
  positionGradeOf,
  reconcileProjection,
  topPersonOf,
  workSegmentDraft,
  type CompanyRoster,
  type RecordWire,
  type RootGrantFact,
} from '../../../src/engine/records/index.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { createTicket, createWorkStack, disposeWorkStacks, runTicks } from './fixtures/work-stack.ts'

const COMPANY = 'demo'
/** 读上下文（v2/14 §0.2-1：读方法必带；公司维=被测公司，两槽同填——V2 身份表落位前同值） */
const READ_CTX: ReadContext = {
  readScope: { company: { companyId: COMPANY, slug: COMPANY }, fields: ['record.payload'], purpose: 'life-auth-wire 测试读回' },
  caller: { callerId: 'AGENT-1', kind: 'employment', personId: 'AGENT-1' },
}
const T0 = Date.parse('2026-11-03T00:00:00.000Z')

/** 授权链外部事实（#530 根委任生产件的夹具形态：设立记录/公开指纹/外部签名件/期限/核验结论） */
const ROOT_FACT: RootGrantFact = {
  establishmentRef: { refType: 'REC-EVT-01', refId: 'company-establishment:demo', refVersion: '1.0.0' },
  keyFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  externalSignatureRef: { refId: 'external-signature:producer-2026-11-01', refVersion: '1.0.0' },
  term: { from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
  proofVerified: true,
  fingerprintMatches: true,
}

/** 名册夹具（两部门四人：一级单元主管 ENG-0 走 G8_unit_head 双角色闸；成员走 other 档） */
const ROSTER: CompanyRoster = {
  departments: [
    { path: 'departments/综合部', leader: 'PRIME-0', functions: ['管理', '人事', '财务'], lanes: ['ops'] },
    { path: 'departments/研发部', leader: 'ENG-0', functions: ['交付', '策划', '质量'], lanes: ['core', 'qa'] },
  ],
  people: [
    { id: 'PRIME-0', name: '首相', login: 'prime-0', level: 3, dept: 'departments/综合部', role: '总经理', status: 'active' },
    { id: 'ENG-0', name: '研发部长', login: 'eng-0', level: 3, dept: 'departments/研发部', role: '研发部长', status: 'active' },
    { id: 'ENG-1', name: '工程师', login: 'eng-1', level: 1, dept: 'departments/研发部', role: '执行', status: 'active' },
    { id: 'PLN-1', name: '规划一', login: 'pln-1', level: 2, dept: 'departments/研发部', role: '策划', status: 'active' },
  ],
}

/** tmp 台账根（afterAll 统一回收） */
const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/** 建真 SQLite 台账 + 记录写面（roster/rootGrant 可选＝面关/外部事实缺对照） */
async function wireWith(
  label: string,
  options: { readonly roster?: CompanyRoster; readonly rootGrant?: RootGrantFact } = {},
): Promise<{ ledger: Ledger; wire: RecordWire }> {
  const root = await mkdtemp(path.join(tmpdir(), `sn-605-${label}-`))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const wire = createRecordWire({
    hist: createHistFace(ledger.db),
    company: COMPANY,
    ...(options.roster !== undefined ? { roster: { roster: () => options.roster as CompanyRoster } } : {}),
    ...(options.rootGrant !== undefined ? { rootGrant: options.rootGrant } : {}),
    readEvents: (since) => ledger.queryEvents({ company: COMPANY, ...(since > 0 ? { since } : {}) }),
  })
  return { ledger, wire }
}

/** 库内某族行数（真表直查） */
function rowsOf(ledger: Ledger, type: string) {
  return createHistFace(ledger.db).query({ company: COMPANY, type }, READ_CTX)
}

describe('刀B 红面：名册/外部事实缺省 → 派生类写面一律拒写（fail-closed，零行）', () => {
  it('名册端口未注入：rosterLoad 拒写并点名缺事实源，records 0 行', async () => {
    const { ledger, wire } = await wireWith('no-roster')
    const results = wire.rosterLoad({ at: T0, reason: 'boot' })
    expect(results).toHaveLength(1)
    expect(results[0]?.ok).toBe(false)
    if (results[0] !== undefined && !results[0].ok) {
      expect(results[0].code).toBe('record-prereq-missing')
      expect(results[0].reason).toContain('名册端口未注入')
    }
    expect(rowsOf(ledger, 'REC-LIFE-05')).toHaveLength(0)
    expect(rowsOf(ledger, 'REC-AUTH-01')).toHaveLength(0)
    expect(rowsOf(ledger, 'REC-LIFE-01')).toHaveLength(0)
    expect(wire.counters.refused).toBeGreaterThan(0)
  })

  it('有在岗名册但无根授予外部事实：LIFE-05 落库、AUTH-01/LIFE-01 拒写且零行（不猜指纹/不冒充验签）', async () => {
    const { ledger, wire } = await wireWith('no-root-fact', { roster: ROSTER })
    const results = wire.rosterLoad({ at: T0, reason: 'boot' })
    expect(rowsOf(ledger, 'REC-LIFE-05')).toHaveLength(4)
    expect(rowsOf(ledger, 'REC-AUTH-01')).toHaveLength(0)
    expect(rowsOf(ledger, 'REC-LIFE-01')).toHaveLength(0)
    const authRefusals = results.filter((result) => !result.ok && result.recordType === 'REC-AUTH-01')
    expect(authRefusals.length).toBeGreaterThan(0)
    const reasons = authRefusals.map((result) => (result.ok ? '' : result.reason)).join(' | ')
    expect(reasons).toContain('根授予外部事实不齐')
    expect(reasons).toContain('key_fingerprint')
    const lifeRefusals = results.filter((result) => !result.ok && result.recordType === 'REC-LIFE-01')
    expect(lifeRefusals.length).toBe(4)
    expect(lifeRefusals.map((result) => (result.ok ? '' : result.reason)).join(' | ')).toContain('REC-AUTH-01 权源链')
  })
})

describe('刀B 绿面：名册+外部事实齐 → 相位 0 按族落库（真表直查）', () => {
  it('AUTH-01 根授予+转授边 / LIFE-05 禁配申报 / LIFE-01 拟任面 逐族落库', async () => {
    const { ledger, wire } = await wireWith('green', { roster: ROSTER, rootGrant: ROOT_FACT })
    const results = wire.rosterLoad({ at: T0, reason: 'boot' })
    expect(results.some((result) => !result.ok)).toBe(true) // ENG-0 的 G8 双角色闸如实拒写

    // LIFE-05：四人在岗 → 四条（含顶位；核验位置独立于被检者）
    const life05 = rowsOf(ledger, 'REC-LIFE-05')
    expect(life05).toHaveLength(4)
    for (const row of life05) {
      const payload = row.payload as { conflict_check: { checker: string }; holder_ref: { refId: string } }
      expect(payload.conflict_check.checker).not.toBe(payload.holder_ref.refId.replace('person:', ''))
    }

    // AUTH-01：根授予 1 条（外部老板→顶位）+ 转授边 3 条（top→ENG-0、ENG-0→ENG-1、ENG-0→PLN-1）
    const auth = rowsOf(ledger, 'REC-AUTH-01')
    expect(auth).toHaveLength(4)
    const rootRow = auth.find((row) => row.recordId.includes(':root:'))
    expect(rootRow).toBeDefined()
    const rootPayload = rootRow?.payload as { grant_class: string; key_fingerprint: string; grantor: { refId: string } }
    expect(rootPayload.grant_class).toBe('root_delegation')
    expect(rootPayload.key_fingerprint).toBe(ROOT_FACT.keyFingerprint)
    expect(rootPayload.grantor.refId).toBe('external-owner:producer')
    const delegations = auth.filter((row) => row.recordId.includes(':deleg:'))
    expect(delegations).toHaveLength(3)
    for (const row of delegations) {
      const payload = row.payload as { grant_class: string; parent_grant: { refType: string; refId: string }; scope: { forbidden: string[] } }
      expect(payload.grant_class).toBe('delegation')
      expect(payload.parent_grant.refType).toBe('REC-AUTH-01')
      expect(payload.scope.forbidden.length).toBeGreaterThan(0) // 不可为边界显式列出（§2.2）
    }

    // LIFE-01：顶位（G9，引 root_delegation）+ 两成员（other 档）＝3 条；一级单元主管 ENG-0 双角色闸拒写
    const appointments = rowsOf(ledger, 'REC-LIFE-01')
    expect(appointments).toHaveLength(3)
    expect(appointments.every((row) => row.effectiveState === 'pending')).toBe(true) // 五条件未齐＝只落拟任面
    const top = appointments.find((row) => row.idempotencyKey?.subjectId === 'PRIME-0')
    expect(top?.payload).toMatchObject({ appointment_kind: 'appointment', acceptance_state: 'pending_acceptance' })
    const topPayload = top?.payload as {
      root_delegation_ref?: { refType: string }
      entry_gate_results: {
        authority: { satisfied: boolean }
        qualification: { satisfied: boolean }
        conflict: { satisfied: boolean }
        handover: { satisfied: boolean }
        acceptance: { satisfied: boolean }
      }
      decision_face: { effective_state: string }
    }
    expect(topPayload.root_delegation_ref?.refType).toBe('REC-AUTH-01')
    expect(topPayload.entry_gate_results.authority.satisfied).toBe(true)
    expect(topPayload.entry_gate_results.qualification.satisfied).toBe(false)
    expect(topPayload.entry_gate_results.handover.satisfied).toBe(false)
    expect(topPayload.entry_gate_results.acceptance.satisfied).toBe(false)
    expect(topPayload.decision_face.effective_state).toBe('pending') // 决定面与信封同值（§0.5）

    // 拒绝面逐条可读（不静默）
    const refusals = results.filter((result) => !result.ok)
    expect(refusals.map((result) => (result.ok ? '' : result.reason)).join(' | ')).toContain('内部老板双角色')
    expect(wire.counters.lifecycle).toBe(1)
  })

  it('幂等：同记录重放 → deduped，行数不变（§0.4-4 重放零第二副作用）', async () => {
    const { ledger, wire } = await wireWith('idem', { roster: ROSTER, rootGrant: ROOT_FACT })
    wire.rosterLoad({ at: T0, reason: 'boot' })
    const before = rowsOf(ledger, 'REC-AUTH-01').length + rowsOf(ledger, 'REC-LIFE-05').length + rowsOf(ledger, 'REC-LIFE-01').length
    const replay = wire.rosterLoad({ at: T0, reason: 'hr-change' })
    expect(wire.counters.deduped).toBeGreaterThan(0)
    const after = rowsOf(ledger, 'REC-AUTH-01').length + rowsOf(ledger, 'REC-LIFE-05').length + rowsOf(ledger, 'REC-LIFE-01').length
    expect(after).toBe(before)
    expect(replay.filter((result) => result.ok && !result.deduped)).toHaveLength(0)
  })
})

describe('刀B 自填即拒 / 独立性闸（§七；事实只可由名册派生）', () => {
  it('非在岗：LIFE-05/LIFE-01 拒写（非在岗不得登记任职/申报）', () => {
    const roster: CompanyRoster = { ...ROSTER, people: ROSTER.people.map((person) => (person.id === 'ENG-1' ? { ...person, status: 'retired' } : person)) }
    const registry = conflictRegistryDraft({ roster, company: COMPANY, at: T0, personId: 'ENG-1' })
    expect(registry.ok).toBe(false)
    if (!registry.ok) expect(registry.reason).toContain('非在岗')
    const appointment = appointmentDraft({ roster, company: COMPANY, at: T0, personId: 'ENG-1' })
    expect(appointment.ok).toBe(false)
    if (!appointment.ok) expect(appointment.reason).toContain('非在岗')
  })

  it('自任自免不可达：任何可落库草案的决定者恒为上级位置/外部老板（≠ 被任免者）', () => {
    const ref = (type: string, id: string) => ({ refType: type, refId: id, refVersion: '1.0.0' })
    const outcomes = ROSTER.people.map((person) => ({
      personId: person.id,
      outcome: appointmentDraft({
        roster: ROSTER,
        company: COMPANY,
        at: T0,
        personId: person.id,
        appointingAuthorityRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:PRIME-0'),
        nominationRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:PRIME-0'),
        decisionBasisRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:PRIME-0'),
        rootDelegationRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:PRIME-0'),
        conflictCheckRef: ref('REC-LIFE-05', `rec-life-05:demo:${person.id}`),
      }),
    }))
    for (const row of outcomes) {
      if (row.outcome.ok) expect(row.outcome.draft.decidedBy).not.toBe(row.personId)
      else expect(row.outcome.reason.length).toBeGreaterThan(0)
    }
    // 单部门＝顶位自任：无上级位置可作决定者 → 必拒（自授不是豁免）
    const single: CompanyRoster = {
      departments: [{ path: 'departments/研发部', leader: 'ENG-0', functions: ['交付'], lanes: ['core'] }],
      people: [{ id: 'ENG-0', name: '研发部长', login: 'eng-0', level: 3, dept: 'departments/研发部', role: '研发部长', status: 'active' }],
    }
    const selfTop = appointmentDraft({
      roster: single,
      company: COMPANY,
      at: T0,
      personId: 'ENG-0',
      appointingAuthorityRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:ENG-0'),
      nominationRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:ENG-0'),
      decisionBasisRef: ref('REC-AUTH-01', 'rec-auth-01:demo:root:ENG-0'),
      conflictCheckRef: ref('REC-LIFE-05', 'rec-life-05:demo:ENG-0'),
    })
    expect(selfTop.ok).toBe(false)
    if (!selfTop.ok) expect(selfTop.reason).toContain('root_delegation')
  })

  it('名册缺部门（悬空引用）：LIFE-05 拒写，不按缺省部门补造', () => {
    const roster: CompanyRoster = { departments: ROSTER.departments, people: [{ id: 'GHOST-1', name: '幽灵', login: 'ghost-1', level: 1, dept: 'departments/不存在', status: 'active' }] }
    const outcome = conflictRegistryDraft({ roster, company: COMPANY, at: T0, personId: 'GHOST-1' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('不在 departments 索引')
  })

  it('工号不在名册：一律拒写（不造主体）', () => {
    const outcome = conflictRegistryDraft({ roster: ROSTER, company: COMPANY, at: T0, personId: 'NOPE-9' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('不在公司目录名册')
  })

  it('写面入参只有时刻/工号：调用方无法传任职事实（类型面即闸）', async () => {
    const { wire } = await wireWith('type-gate', { roster: ROSTER, rootGrant: ROOT_FACT })
    // @ts-expect-error 任职事实不可由调用方注入（rosterLoad 只收 at/reason）
    const bad = () => wire.rosterLoad({ at: T0, reason: 'boot', positionRef: { refId: 'position:x', refVersion: '1.0.0' } })
    expect(typeof bad).toBe('function')
  })
})

describe('刀B 前件闸：LIFE-04 出工段 / EVD-01 收割批次（缺件即拒，不臆造）', () => {
  const ref = { refType: 'REC-WORK-05', refId: 'rec-work-05:demo:DEMO-1:1', refVersion: '1.0.0' }
  const prereqs = {
    appointmentRef: { refType: 'REC-LIFE-01', refId: 'rec-life-01:demo:ENG-1:x:1.0.0', refVersion: '1.0.0' },
    planRef: ref,
    authorizationRef: { refType: 'REC-AUTH-02', refId: 'rec-auth-02:demo:DEMO-1:1', refVersion: '1.0.0' },
    qualificationRef: { refType: 'REC-CAP-02', refId: 'rec-cap-02:demo:ENG-1', refVersion: '1.0.0' },
  }

  it('LIFE-04：缺生效任命 → 拒写并点名（不拿拟任面充生效）', () => {
    const outcome = workSegmentDraft({ roster: ROSTER, company: COMPANY, at: T0, ticket: 'DEMO-1', attempt: 1, personId: 'ENG-1', prereqs: {} })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.code).toBe('record-prereq-missing')
      expect(outcome.reason).toContain('生效** REC-LIFE-01')
    }
  })

  it('LIFE-04：任命/计划锁/授权结果齐但资格面（REC-CAP-02）未落 → 仍拒（逐项点名，不置真）', () => {
    const outcome = workSegmentDraft({
      roster: ROSTER,
      company: COMPANY,
      at: T0,
      ticket: 'DEMO-1',
      attempt: 1,
      personId: 'ENG-1',
      prereqs: { appointmentRef: prereqs.appointmentRef, planRef: prereqs.planRef, authorizationRef: prereqs.authorizationRef },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('REC-CAP-02')
  })

  it('LIFE-04：四前件齐（生效任命/计划锁/授权结果/资格）→ 可落草案（写面不是永久 fail-closed）', () => {
    const outcome = workSegmentDraft({ roster: ROSTER, company: COMPANY, at: T0, ticket: 'DEMO-1', attempt: 1, personId: 'ENG-1', prereqs })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const payload = outcome.draft.payload as { segment_gate_check: { face: string; satisfied: boolean }[] }
      expect(payload.segment_gate_check.every((face) => face.satisfied)).toBe(true)
    }
  })

  it('写面同一闸：workSegment/harvest 拒写且 records 零行（LIFE-04/EVD-01 不落臆造行）', async () => {
    const { ledger, wire } = await wireWith('segment-refuse', { roster: ROSTER, rootGrant: ROOT_FACT })
    wire.rosterLoad({ at: T0, reason: 'boot' })
    const segment = wire.workSegment({ ticket: 'DEMO-1', attempt: 1, personId: 'ENG-1', at: T0 })
    expect(segment.ok).toBe(false)
    const harvest = wire.harvest({ ticket: 'DEMO-1', attempt: 1, at: T0, actor: 'ENG-1', terminal: 'completed', gaps: [], usage: [], cost: [] })
    expect(harvest.ok).toBe(false)
    if (!harvest.ok) expect(harvest.reason).toContain('segment_ref')
    expect(rowsOf(ledger, 'REC-LIFE-04')).toHaveLength(0)
    expect(rowsOf(ledger, 'REC-EVD-01')).toHaveLength(0)
  })

  it('权源面：无覆盖授予/授予未落库 → authorityRefFor 拒（决定型记录不得无源落库）', async () => {
    const { wire } = await wireWith('authority-ref', { roster: ROSTER })
    const outcome = wire.authorityRefFor({ personId: 'ENG-1', actionScope: 'dept:departments/研发部' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/未落库|无覆盖授予/)
  })

  it('权源面（绿）：名册装载后，成员在其部门范围上有覆盖授予引用；不可为边界不覆盖', async () => {
    const { wire } = await wireWith('authority-green', { roster: ROSTER, rootGrant: ROOT_FACT })
    wire.rosterLoad({ at: T0, reason: 'boot' })
    const covered = wire.authorityRefFor({ personId: 'ENG-1', actionScope: 'dept:departments/研发部' })
    expect(covered.ok).toBe(true)
    if (covered.ok) expect(covered.ref.recordType).toBe('REC-AUTH-01')
    const uncovered = wire.authorityRefFor({ personId: 'ENG-1', actionScope: 'root:use' })
    expect(uncovered.ok).toBe(false)
  })
})

describe('刀B 族表：已交付族解禁、其余族保持阻断（不顺手放开）', () => {
  it('EVD-01 移出 BLOCKED（写面已接）、入 PENDING（前件未落）；未实现族仍在 BLOCKED', () => {
    expect(BLOCKED_RECORD_FAMILIES['REC-EVD-01']).toBeUndefined()
    expect(PENDING_PREREQ_FAMILIES['REC-EVD-01']).toBeDefined()
    expect(PENDING_PREREQ_FAMILIES['REC-LIFE-04']).toBeDefined()
    // 刀C 族（studio-dev-560 已交付：写面解禁）→ 八族入 UNBLOCKED；WORK-10/13 仍未接、仍在 BLOCKED
    for (const recordType of ['REC-WORK-02', 'REC-WORK-03', 'REC-WORK-04', 'REC-WORK-05', 'REC-WORK-07', 'REC-WORK-08', 'REC-WORK-09', 'REC-EVD-03']) {
      expect(UNBLOCKED_RECORD_FAMILIES[recordType]).toBeDefined()
    }
    for (const recordType of ['REC-WORK-10', 'REC-WORK-13']) {
      expect(BLOCKED_RECORD_FAMILIES[recordType]).toBeDefined()
      const outcome = blockedDraftFor(recordType)
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.code).toBe('record-prereq-missing')
    }
    // 刀B 不得顺手放开刀C/刀D 未交付族：无论 BLOCKED 还是 UNBLOCKED（写面已接/前件未落），一律拒写
    for (const recordType of ['REC-WORK-02', 'REC-WORK-03', 'REC-WORK-04', 'REC-WORK-05', 'REC-WORK-07', 'REC-EVD-03', 'REC-EVD-04', 'REC-MEM-03', 'REC-WORK-12', 'REC-WORK-17', 'REC-ACC-01', 'REC-CHG-01', 'REC-REV-01']) {
      expect(blockedDraftFor(recordType).ok).toBe(false)
    }
  })

  it('PENDING 族拒绝理由逐项点名缺件（不是一句「未实现」）', () => {
    const outcome = blockedDraftFor('REC-LIFE-04')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toContain('REC-WORK-05')
      expect(outcome.reason).toContain('REC-AUTH-02')
    }
  })
})

describe('刀B 名册对账：任职/授权记录不得脱离名册（凭空主体即差异）', () => {
  it('名册派生族：subject 不在名册 → undeterminable；在册 → 无差异', async () => {
    const { ledger, wire } = await wireWith('reconcile', { roster: ROSTER, rootGrant: ROOT_FACT })
    wire.rosterLoad({ at: T0, reason: 'boot' })
    const hist = createHistFace(ledger.db)
    const records = hist.query({ company: COMPANY }, READ_CTX)
    const rosterSubjects = new Set(ROSTER.people.map((person) => person.id))
    const settled = reconcileProjection(records, [], { rosterSubjects })
    expect(settled.differences.filter((difference) => difference.kind === 'undeterminable')).toHaveLength(0)

    const ghost = reconcileProjection(records, [], { rosterSubjects: new Set(['PRIME-0']) })
    expect(ghost.settled).toBe(false)
    expect(ghost.differences.some((difference) => difference.kind === 'undeterminable' && difference.subjectId === 'ENG-1')).toBe(true)
  })
})

describe('刀B 验收项①：对账读者接入生产对账循环（真引擎拍，非单测自证）', () => {
  it('第 30 拍（RECORDS_RECONCILE_EVERY_TICKS）后：reconcile 计数>0、结论落 daemon_kv、拍无错误', async () => {
    let wire: RecordWire | undefined
    const stack = await createWorkStack('rec-tick-recon', {}, {
      recordsOf: ({ ledger, company }) => {
        wire = createRecordWire({
          hist: createHistFace(ledger.db),
          company,
          roster: { roster: () => ROSTER },
          rootGrant: ROOT_FACT,
          readEvents: (since) => ledger.queryEvents({ company, ...(since > 0 ? { since } : {}) }),
        })
        return wire
      },
    })
    if (wire === undefined) throw new Error('recordsOf 未被夹具调用（夹具契约破坏）')
    wire.rosterLoad({ at: T0, reason: 'boot' })
    await createTicket(stack, '对账读者单')
    const reports = await runTicks(stack, 30)
    expect(wire.counters.reconcile).toBeGreaterThan(0)
    const last = stack.ledger.kvGet(RECORDS_RECONCILE_LAST_KEY)
    expect(last).not.toBeNull()
    const parsed = JSON.parse(last as string) as { seq: number; settled: boolean; differences: number; checked: number }
    expect(parsed.seq).toBe(30)
    expect(parsed.checked).toBeGreaterThan(0)
    expect(typeof parsed.settled).toBe('boolean')
    const reconcileErrors = reports.flatMap((report) => report.errors).filter((line) => line.includes('记录面对账读者'))
    expect(reconcileErrors).toEqual([])
  })
})

describe('刀B 验收项②：contract 深 import 收口（engine/records 走包入口）', () => {
  it('engine/records 源码无 packages/contract/src 直穿；契约面一律经 @studio-next/contract/records', async () => {
    const dir = fileURLToPath(new URL('../../../src/engine/records/', import.meta.url))
    const files = (await readdirSync(dir)).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    const violations: string[] = []
    let packageEntryImports = 0
    for (const name of files) {
      const text = await readFile(path.join(dir, name), 'utf8')
      if (text.includes('packages/contract/src')) violations.push(name)
      if (text.includes("from '@studio-next/contract/records'")) packageEntryImports += 1
    }
    expect(violations).toEqual([])
    expect(packageEntryImports).toBeGreaterThan(0)
  })
})

describe('刀B 与刀A 共存：名册/外部事实注入不改变既有面（缺省零行为）', () => {
  it('面关（无 roster/rootGrant）：既有的 WORK-01 意图写面语义不变', () => {
    expect(DEMO_SNAPSHOT.people[0]?.id).toBe('AGENT-1')
    expect(personOf(ROSTER, 'PRIME-0')?.level).toBe(3)
    expect(positionGradeOf(ROSTER, personOf(ROSTER, 'PRIME-0')!)).toBe('G9')
    expect(positionGradeOf(ROSTER, personOf(ROSTER, 'ENG-0')!)).toBe('G8_unit_head')
    expect(positionGradeOf(ROSTER, personOf(ROSTER, 'ENG-1')!)).toBe('other')
    expect(topPersonOf(ROSTER)?.id).toBe('PRIME-0')
    expect(appointmentRecordId(COMPANY, 'ENG-1', 'position:departments/研发部:执行')).toContain('rec-life-01:demo:ENG-1')
  })
})

afterAll(async () => {
  await disposeWorkStacks()
})
