/**
 * neg/harvest-neg —— NEG 覆盖补强（收割与证据域：WRK 收割腿＋EVD 族＋观察族）
 *
 * 依据（实现单必须引章节号——AGENTS §五.1）：
 *   - docs/v2/17 §4.1/§4.2 逐行：NEG-WRK-03（验收独立性·收割腿）、NEG-WRK-04（未分类高档侧）、
 *     NEG-WRK-14（观察悬空）、NEG-EVD-02（独立性出据）、NEG-EVD-03（公司层外部锚）、
 *     NEG-EVD-04（观察面活性）、NEG-EVD-06（来源锚）；
 *   - docs/v2/08 §1.3/§1.4/§1.5（来源锚两级、收割四要件与完整性、五类判断不合并）、
 *     §2.2（独立性不得自填；同体只能「内部老板自审」）、§2.3（外部锚/外部通道未建成
 *     fail-closed）、§4.2 MON（观察面活性、逾期异常 MON-12）、§5.3（观察结束不是遗忘）；
 *   - docs/v2/11 §六（REC-EVD-01/02 与 REC-EVD-05 字段与不变量）、§十二（REC-OBS-01/03/04）；
 *   - docs/v2/17 §一 V1（记录判定真跑）／V3（fake 只替代外部端口）。
 *
 * 断言纪律：全部调用生产函数（`engine/harvest/*`、contract 记录判定件、panel 只读投影），
 * 断言其**拒绝结论/判负输出**；每条跟正例对照，避免「形状永远红」冒充负例。
 */
import { describe, expect, it } from 'vitest'
import { acceptanceInputOf, gradeHarvestStages } from '../../../src/engine/harvest/stages.ts'
import {
  FRAMEWORK_HARVESTER,
  createHarvestBatchLedger,
  evidenceItemsOf,
  harvestRequirementsOf,
  type HarvestRequirements,
} from '../../../src/engine/harvest/batch.ts'
import type { RecordValidationOutcome } from '../../../../../packages/contract/src/records/envelope.ts'
import { validateEvidenceItem, validatePostAudit } from '../../../../../packages/contract/src/records/evd.ts'
import {
  validateContinuousObservation,
  validateObservationClosure,
  validateProjectionSnapshot,
} from '../../../../../packages/contract/src/records/obs.ts'
import { buildAuditOverdueView, buildObservationExit, type ObservationInput } from '../../../../../packages/panel/src/views.ts'

// ————————————————————————— 基座 —————————————————————————

const AT = '2026-10-28T00:00:00Z'
const PROOF = '只证明本记录观察到的材料；不证明验收合格、结清与价值'
type Issue = { readonly path: string; readonly message: string }
type ORef = { refId: string; refVersion: string }

function ref(refType: string, refId = 'rec-1', refVersion = '1.0.0') {
  return { refType, refId, refVersion }
}

function oref(refId = 'object-1'): ORef {
  return { refId, refVersion: '1.0.0' }
}

function envelope(recordType: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    recordId: 'rec-neg-0002',
    recordType,
    schemaRef: { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' },
    specVersion: '2.0.0',
    companyRef: 'company-a',
    producedAt: AT,
    producer: { decidedBy: 'g9.internal-boss', writtenBy: 'daemon:records' },
    basisRefs: [oref('basis-1')],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: AT },
    proofBoundary: PROOF,
  }
}

function reject(outcome: RecordValidationOutcome): readonly Issue[] {
  expect(outcome.ok).toBe(false)
  return outcome.ok ? [] : outcome.issues
}

function hit(issues: readonly Issue[], path: string, fragment: string): boolean {
  return issues.some((issue) => issue.path === path && issue.message.includes(fragment))
}

// ————————————————————————— 收割批次基座（真批次簿 begin→record→seal） —————————————————————————

const SEGMENT = { ticket: 'T-NEG-1', attempt: 1 }

/** 四要件齐（EX-2+ 完整批次） */
function completeRequirements(): HarvestRequirements {
  return harvestRequirementsOf({
    completed: true,
    nonEmptyOutput: true,
    reportExists: true,
    exit0: true,
    terminalObserved: true,
    terminalError: undefined,
  })
}

function seedBatch(deliverer: string, requirements: HarvestRequirements = completeRequirements()) {
  const ledger = createHarvestBatchLedger()
  ledger.begin({ ...SEGMENT, deliverer, at: 1000 })
  ledger.record({ ...SEGMENT, deliverer }, requirements)
  ledger.seal(SEGMENT, requirements.fourOk ? 'completed' : 'failed', 1500)
  const batch = ledger.get(SEGMENT)
  if (batch === undefined) throw new Error('批次缺位')
  return batch
}

// ————————————————————————— NEG-WRK-03（收割腿） —————————————————————————

describe('NEG-WRK-03 验收独立性（收割腿）：采集者=交付者→批次不得作验收输入', () => {
  it('自供批次（收割者=交付者）即便封批完整也不可用；关系要件成立才可用，且仍恒 not_judged', () => {
    // ① 自供：交付者写成框架机械通道本身（同一体）→ 关系要件不成立
    const selfSupplied = seedBatch(FRAMEWORK_HARVESTER)
    expect(selfSupplied.status).toBe('sealed')
    expect(selfSupplied.completeness).toBe('complete')
    expect(selfSupplied.harvester.differsFromDeliverer).toBe(false)
    expect(selfSupplied.harvester.independence).toBe('undetermined')
    const refused = acceptanceInputOf(selfSupplied)
    expect(refused.usable).toBe(false)
    expect(refused.reasons.join('')).toContain('收割者=交付者：关系要件不成立（自供不成独立')
    // ② 交付者具名（≠收割通道）→ 可作验收输入，但验收/结清判断仍归独立位置（不产出判断）
    const thirdParty = seedBatch('AGENT-1')
    const input = acceptanceInputOf(thirdParty)
    expect(input.usable).toBe(true)
    expect(input.acceptance).toBe('not_judged')
    expect(input.settlement).toBe('not_judged')
    expect(input.independentPositionRequired).toContain('验者≠交付者')
  })
})

// ————————————————————————— NEG-WRK-04（收割腿） —————————————————————————

describe('NEG-WRK-04 未分类高档侧（收割腿）：完整性存疑/未采到一律按高侧——不得作低档验收', () => {
  it('unknown/incomplete 批次不可作验收输入；终态未采到只记 unknown（不得压成布尔/低档）', () => {
    // ① 「没采集到」：终态未观察 → completeness=unknown（不是「无输出」，更不是可接受）
    const notCollected = harvestRequirementsOf({
      completed: false,
      nonEmptyOutput: false,
      reportExists: false,
      exit0: false,
      terminalObserved: false,
      terminalError: undefined,
    })
    expect(notCollected.executionTerminal).toBe('unknown')
    expect(notCollected.gaps).toContain('终态未采集到')
    const unknownBatch = seedBatch('AGENT-1', notCollected)
    expect(unknownBatch.completeness).toBe('unknown')
    const unknownInput = acceptanceInputOf(unknownBatch)
    expect(unknownInput.usable).toBe(false)
    expect(unknownInput.reasons.join('')).toContain('完整性=unknown：存疑时不得判接受')
    // ② 采到终态但四要件不齐 → incomplete：同样按高侧拒（不得折成低侧三件）
    const incomplete = harvestRequirementsOf({
      completed: true,
      nonEmptyOutput: false,
      reportExists: false,
      exit0: false,
      terminalObserved: true,
      terminalError: undefined,
    })
    const partialBatch = seedBatch('AGENT-1', incomplete)
    expect(partialBatch.completeness).toBe('incomplete')
    expect(acceptanceInputOf(partialBatch).reasons.join('')).toContain('完整性=incomplete：存疑时不得判接受')
    // ③ 分级口径写死：验收/结清恒 not_judged——未分类/存疑不得自判低档验收
    const stages = gradeHarvestStages()
    expect(stages.find((stage) => stage.stage === 'acceptance')?.state).toBe('not_judged')
    expect(stages.find((stage) => stage.stage === 'settlement')?.state).toBe('not_judged')
  })
})

// ————————————————————————— NEG-EVD-06 来源锚 —————————————————————————

function evidenceItemPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    element: 'EVD-ELM-01',
    content_ref: oref('turn_end.json'),
    formed_at: AT,
    observed_at: AT,
    source_chain: ['executor turn_end（执行面自述，经框架机械通道读到）'],
    source_anchor: 'self_reported',
    element_state: 'present',
    knowledge_scope: 'company-a/work',
    integrity_state: 'present',
    proves: '执行面自报终态被框架读到',
    does_not_prove: '工作完成/验收合格/结清/价值',
    ...overrides,
  }
}

describe('NEG-EVD-06 来源锚：逼真≠有效来源，自述不得单独支撑 EX-2+', () => {
  it('框架机械通道读到的终态自述仍标非独立；自述锚用于 EX-2+ → 证据项判负', () => {
    // ① 机械通道只保证「被读到」，不把自述洗成独立采集（来源锚逐项标注）
    const items = evidenceItemsOf({ segment: SEGMENT, requirements: completeRequirements() })
    const terminal = items.find((item) => item.sourceKind === 'execution_terminal_observation')
    expect(terminal?.independentOfDeliverer).toBe(false)
    expect(items.filter((item) => item.sourceKind !== 'execution_terminal_observation').every((item) => item.independentOfDeliverer)).toBe(true)
    // ② 自述锚（外形再逼真）不得单独支撑 EX-2+ 验收 → 证据项判负
    const rejected = reject(validateEvidenceItem(envelope('REC-EVD-02', evidenceItemPayload()), { forEx2Acceptance: true }))
    expect(hit(rejected, 'payload.source_anchor', '自述不得单独支撑 EX-2+')).toBe(true)
    // ③ 正例对照：同一材料改为独立采集锚 → 放行（判负来自来源锚本身）
    expect(
      validateEvidenceItem(envelope('REC-EVD-02', evidenceItemPayload({ source_anchor: 'independent_collection', source_chain: ['独立复采：闸门退出码＋REPORT 落盘'] })), {
        forEx2Acceptance: true,
      }),
    ).toEqual({ ok: true })
  })
})

// ————————————————————————— NEG-EVD-02 审计独立性 —————————————————————————

function postAuditPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'EX-1 低档结论事后审计（全量抽样）',
    audit_class: 'internal_boss_self_audit',
    conclusion: 'no_violation',
    audited_by: 'g9.internal-boss',
    independence_verified_by: { verified_by: 'g9.audit', control_basis_ref: ref('REC-LIFE-05') },
    basis_refs: [ref('REC-EVD-03')],
    findings: [],
    deadline: '2026-11-30T00:00:00Z',
    overdue_disposition: '逾期即入 REC-WORK-17 异常并标注「未经事后审计」',
    dissent_position: '无异议',
    ...overrides,
  }
}

describe('NEG-EVD-02 独立性出据：审计者资格独立性自填即拒收，逾期未审计即 MON-12 异常', () => {
  it('独立性自填/逾期未审计 → 记录判负；面板 MON-12 行恒标「未经事后审计」', () => {
    // 正例对照：独立核验槽有依据、未逾期
    expect(validatePostAudit(envelope('REC-EVD-05', postAuditPayload()))).toEqual({ ok: true })
    // ① 独立性自填（无独立检查位置与控制关系依据）→ 拒收
    const selfFilled = reject(
      validatePostAudit(
        envelope('REC-EVD-05', postAuditPayload({ independence_verified_by: { verified_by: 'g9.internal-boss', control_basis_ref: ref('REC-LIFE-05'), self_declared: true } })),
      ),
    )
    expect(hit(selfFilled, 'payload.independence_verified_by', '独立性自填即拒收')).toBe(true)
    // ② 逾期未审计＝异常（REC-WORK-17）并标注「未经事后审计」
    expect(hit(reject(validatePostAudit(envelope('REC-EVD-05', postAuditPayload()), { overdue: true })), 'payload.deadline', '未经事后审计')).toBe(true)
    // ③ 面板 MON-12 行：无审计引用且过期 → overdue＋异常面＋公开标注（不得静默绿）
    const overdueView = buildAuditOverdueView(
      [{ conclusionRef: 'REC-EVD-05@1.0.0', deadline: '2026-10-01T00:00:00Z', auditRef: null, auditClass: null, overdueDisposition: '升级至最高宰相' }],
      AT,
    )
    expect(overdueView.rows[0]?.overdue).toBe(true)
    expect(overdueView.rows[0]?.publicLabel).toBe('未经事后审计')
    expect(overdueView.anomaly?.face).toBe('MON-12')
    // ④ 正例对照：审计引用在场 → 非逾期、无 MON-12 异常
    const audited = buildAuditOverdueView(
      [{ conclusionRef: 'REC-EVD-05@1.0.0', deadline: '2026-10-01T00:00:00Z', auditRef: 'REC-EVD-05@1.0.0', auditClass: 'superior_audit', overdueDisposition: null }],
      AT,
    )
    expect(audited.rows[0]?.overdue).toBe(false)
    expect(audited.anomaly).toBeNull()
  })
})

// ————————————————————————— NEG-EVD-03 公司层外部锚 —————————————————————————

describe('NEG-EVD-03 公司层外部锚：无外部锚不得自称独立审计', () => {
  it('同体审计填 external/通道未建成填 external → 判负；同体只能「内部老板自审」并明示标注', () => {
    // ① 同体审计却自称外部（独立）→ 双拒（同体取值限制＋外部锚 fail-closed）
    const selfClaimed = reject(validatePostAudit(envelope('REC-EVD-05', postAuditPayload({ audit_class: 'external' })), { sameBody: true }))
    expect(hit(selfClaimed, 'payload.audit_class', '同体审计只能填 internal_boss_self_audit')).toBe(true)
    expect(hit(selfClaimed, 'payload.audit_class', '通道未建成不得填')).toBe(true)
    // ② 通道未建成（外部锚缺位）时即便非同体也不得填 external
    expect(hit(reject(validatePostAudit(envelope('REC-EVD-05', postAuditPayload({ audit_class: 'external' })))), 'payload.audit_class', 'fail-closed')).toBe(true)
    // ③ 正例：同体＋内部老板自审取值 → 放行（不得因「自审」本身拒写）
    expect(validatePostAudit(envelope('REC-EVD-05', postAuditPayload()), { sameBody: true })).toEqual({ ok: true })
    // ④ 明示标注：面板把内部自审译成「内部老板自审（不得自称独立）」，只有 external 才是外部锚
    const labeled = buildAuditOverdueView(
      [
        { conclusionRef: 'c-1', deadline: '2026-11-30T00:00:00Z', auditRef: 'REC-EVD-05@1.0.0', auditClass: 'internal_boss_self_audit', overdueDisposition: null },
        { conclusionRef: 'c-2', deadline: '2026-11-30T00:00:00Z', auditRef: 'REC-EVD-05@1.0.0', auditClass: 'external', overdueDisposition: null },
      ],
      AT,
    )
    expect(labeled.rows[0]?.auditClassLabel).toBe('内部老板自审（不得自称独立）')
    expect(labeled.rows[1]?.auditClassLabel).toBe('外部独立审计（外部锚）')
  })
})

// ————————————————————————— NEG-EVD-04 观察面活性 —————————————————————————

function snapshotPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    view_identity: { view_id: 'MON-04', projection_rule_version: '1.0.0' },
    authoritative_source: { endpoint: oref('mon-endpoint'), generation: 1, activation_ref: ref('REC-AUTH-07') },
    source_cursor: 'cursor-1',
    generated_at: AT,
    data_valid_window: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
    knowledge_scope: ['company-a'],
    view_completeness: 'complete',
    state_assignments: { 'MON-04': { state: 'observed', basis: '全链路抽样＋独立发现通道', last_trusted_cursor: 'cursor-1' } },
    ...overrides,
  }
}

function projection(overrides: Partial<ObservationInput> = {}): ObservationInput {
  const base: ObservationInput = {
    view: { viewName: 'MON-04', company: 'company-a' },
    projectionRuleVersion: '1.0.0',
    authoritativeSource: { endpoint: oref('mon-endpoint'), generation: 1 },
    sourceCursor: 'cursor-1',
    generatedAt: AT,
    dataValidWindow: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
    viewCompleteness: 'complete',
    stateAssignments: [{ face: 'MON-04', state: 'observed', basis: '全链路抽样＋独立发现通道', lastTrustedCursor: 'cursor-1' }],
    staleExits: [],
    fault: null,
  }
  return { ...base, ...overrides }
}

describe('NEG-EVD-04 观察面活性：观察行无依据/全绿冒充→MON 行判负', () => {
  it('状态槽为空/非完整却全绿/空依据自报已观察 → 观察面判负（未知不补 0/空/绿）', () => {
    // 正例对照：逐面状态槽有依据＋游标
    expect(validateProjectionSnapshot(envelope('REC-OBS-01', snapshotPayload()))).toEqual({ ok: true })
    // ① 观察行缺失（逐面/逐指标状态槽为空）→ 判负（缺项留白＝面板全绿冒充健康）
    expect(hit(reject(validateProjectionSnapshot(envelope('REC-OBS-01', snapshotPayload({ state_assignments: {} })))), 'payload.state_assignments', '不得为空')).toBe(true)
    // ② 完整性非 complete 却把逐面状态全标 observed → 全绿冒充健康判负
    const overGreen = reject(
      validateProjectionSnapshot(envelope('REC-OBS-01', snapshotPayload({ view_completeness: 'unknown' })), { claimsAllHealthy: true }),
    )
    expect(hit(overGreen, 'payload.view_completeness', '未知显示为零即判负')).toBe(true)
    // ③ 面板 MON 行：空依据不得自称已观察（tone 降 unknown、依据改写为缺失）
    const blankBasis = buildObservationExit(projection({ stateAssignments: [{ face: 'MON-04', state: 'observed', basis: '   ', lastTrustedCursor: null }] }))
    expect(blankBasis.faces[0]?.state).toBe('observed')
    expect(blankBasis.faces[0]?.basis).toContain('依据缺失（空依据不得自称已观察）')
    // ④ 面板 MON 行：无逐面状态槽 → 显式未知（不读成「无异常」）
    const noFaces = buildObservationExit(projection({ stateAssignments: [] }))
    expect(noFaces.faces).toHaveLength(1)
    expect(noFaces.faces[0]?.state).toBe('unknown')
    expect(noFaces.faces[0]?.basis).toContain('投影未给逐面状态槽')
  })
})

// ————————————————————————— NEG-WRK-14 观察悬空 —————————————————————————

function observationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: { kind: 'orphan_executor', ref: oref('exec-1') },
    window: { declared_from: '2026-10-01T00:00:00Z', declared_to: '2026-11-01T00:00:00Z', last_trusted_observation_at: AT },
    sightings: {
      activity_signals: [],
      credential_status_vs_rvk: ['后代清单（REC-EVD-RVK）逐项对账=空'],
      independent_discovery_channels: [{ channel: '进程表扫描（不依赖执行体自报）', material_ref: oref('ps-scan-1') }],
    },
    uncertainty: { reachable: false, treatment: '按未知处理：保留承载，不记「已停止」' },
    escalation_flag: true,
    ...overrides,
  }
}

function closurePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    watch_ref: ref('REC-OBS-03'),
    basis: [{ sighting: '窗口内无活性信号', terminal_basis: '凭据与后代清单已逐项停用（REC-EVD-RVK）' }],
    residual_risk: ['同类副作用可能再现（迟到副作用）'],
    retrigger_terms: '同类副作用再现即按新事项受理并回查原观察记录',
    ...overrides,
  }
}

describe('NEG-WRK-14 观察悬空：终止/撤回后无观察者/期限/记录即宣称闭环 → 判负', () => {
  it('结束决定不引观察记录/无终局依据/无期限或无独立观察通道 → 判负', () => {
    // 正例对照：有据结束（引 REC-OBS-03＋窗口所见＋残留风险＋再触发条件）
    expect(validateObservationClosure(envelope('REC-OBS-04', closurePayload()))).toEqual({ ok: true })
    expect(validateContinuousObservation(envelope('REC-OBS-03', observationPayload()))).toEqual({ ok: true })
    // ① 闭环未引持续观察记录（无观察记录即宣称结束）
    expect(hit(reject(validateObservationClosure(envelope('REC-OBS-04', closurePayload({ watch_ref: ref('REC-WORK-01') })))), 'payload.watch_ref.refType', '须引 REC-OBS-03')).toBe(true)
    // ② 无终局依据的结束＝遗忘
    expect(hit(reject(validateObservationClosure(envelope('REC-OBS-04', closurePayload()), { endedWithoutBasis: true })), 'payload.basis', '观察结束不是遗忘')).toBe(true)
    // ③ 观察窗口悬空/期限倒置（无期限即不得称在观察）
    expect(
      hit(
        reject(validateContinuousObservation(envelope('REC-OBS-03', observationPayload({ window: { declared_from: '2026-11-01T00:00:00Z', declared_to: '2026-10-01T00:00:00Z', last_trusted_observation_at: AT } })))),
        'payload.window',
        '观察窗口须事前声明',
      ),
    ).toBe(true)
    // ④ 不可达执行体被记为「已停止」→ 判负（不可观测≠已停止）
    expect(
      hit(reject(validateContinuousObservation(envelope('REC-OBS-03', observationPayload()), { treatedAsStoppedWhileUnreachable: true })), 'payload.uncertainty', '不得记为「已停止」'),
    ).toBe(true)
    // ⑤ 观察者不独立（无独立发现通道）→ 记录即拒（通道下限；所见不得只依赖执行体自报）
    const noChannel = reject(
      validateContinuousObservation(envelope('REC-OBS-03', observationPayload({ sightings: { activity_signals: [], credential_status_vs_rvk: [], independent_discovery_channels: [] } }))),
    )
    expect(noChannel.some((issue) => issue.path.startsWith('payload.sightings.independent_discovery_channels'))).toBe(true)
  })
})
