/**
 * neg-emp2.test.ts —— NEG-EMP-02/04/06/07/08/09 机制补强（contract 记录判定面；MIG-08 补强单）
 *
 * 依据：v2/17 §4.1 六行 NEG（02 禁配累计｜04 验收口径不变量｜06 绩效归因｜07 交接闸｜08 集体任职｜
 *   09 外部保留权）；v2/02 §一/§3.4/§五/§六/§七/§九；v2/11 §3.1/§四/§5.2/§八；v2/03 §2.3 表 A′。
 *
 * 口径（只测生产面真实机制，不造假）：每个 case 调用 `src/records/emp-neg.ts` 的**纯判定件**并断言
 *   真实拒绝路径/字段；正例与负例成对；不写「类型存在」类空断言、不以注释/字符串列表充数。
 * 输入面＝已解析记录面声明（不改冻结记录字段/不新增记录类）；每条 NEG 的「仍 target」腿（V3 端口/
 *   daemon 网关执行面）不在本文件冒充。
 *
 * 变异验证（逐条临时去掉守卫→红→还原→绿；位置/结果见文末「变异台账」注释块）。
 */
import { describe, expect, it } from 'vitest'
import {
  COLLECTIVE_RULE_PARTS,
  HANDOVER_MIN_SET,
  validateAcceptanceCriteriaRevision,
  validateCollectiveAppointment,
  validateCumulativeConflict,
  validateExternalReservedPower,
  validateHandoverBeforeSettlement,
  validatePerformanceAttribution,
  type AcceptanceCriteriaRevisionInput,
  type AttributionFactor,
  type CollectiveAppointmentInput,
  type ConflictCheckDeclaration,
  type CriteriaRevisionStep,
  type CumulativeConflictInput,
  type DeclaredConflict,
  type HandoverBeforeSettlementInput,
  type HandoverFaceDeclaration,
  type PerformanceAttributionInput,
  type ResolvedHolding,
  type ReservedPowerExerciseInput,
} from '../../src/records/emp-neg.ts'
import type { RecordValidationOutcome } from '../../src/records/envelope.ts'

function ref(refType: string, refId = 'rec-1'): { refType: string; refId: string; refVersion: string } {
  return { refType, refId, refVersion: '1.0.0' }
}

function issuePaths(outcome: RecordValidationOutcome): string[] {
  return outcome.ok ? [] : outcome.issues.map((issue) => issue.path)
}

function issueText(outcome: RecordValidationOutcome): string {
  return outcome.ok ? '' : outcome.issues.map((issue) => issue.message).join('|')
}

// ───────────────────────── NEG-EMP-02：累计禁配（拆身份/拆面规避判负） ─────────────────────────

function holding(overrides: Partial<ResolvedHolding> = {}): ResolvedHolding {
  return {
    holderId: 'holder-h1',
    subjectId: 'subject-s1',
    positionRef: 'position-p1',
    deploymentIds: ['deploy-d1'],
    accountIds: ['account-a1'],
    appointmentKind: 'appointment',
    ...overrides,
  }
}

function conflict(overrides: Partial<DeclaredConflict> = {}): DeclaredConflict {
  return { conflictId: 'conflict-c1', subjectId: 'subject-s1', counterpartyId: 'party-x', conflictKind: 'interest', disposition: '回避', ...overrides }
}

function conflictCheck(overrides: Partial<ConflictCheckDeclaration> = {}): ConflictCheckDeclaration {
  return {
    subjectId: 'subject-s1',
    checkedPositionRefs: ['position-p1'],
    checkedDeploymentIds: ['deploy-d1'],
    checkedAccountIds: ['account-a1'],
    conclusion: '已处置：回避安排生效',
    conflictFree: false,
    ...overrides,
  }
}

function cumulative(overrides: Partial<CumulativeConflictInput> = {}): CumulativeConflictInput {
  return {
    holdings: [holding()],
    conflicts: [],
    conflictChecks: [conflictCheck({ conclusion: '无冲突', conflictFree: true })],
    cumulativeView: { coveredSubjectIds: ['subject-s1'], conclusion: '累计视图：无禁配', conflictFree: true },
    ...overrides,
  }
}

describe('NEG-EMP-02 · 累计禁配（兼任拆两身份规避禁配→合并累计判负）', () => {
  it('兼任拆成两个身份、各自身份单点结论「无冲突」→ 拒（拆身份无效，合并累计）', () => {
    const input = cumulative({
      holdings: [holding(), holding({ holderId: 'holder-h2', subjectId: 'subject-s2', positionRef: 'position-p2', deploymentIds: ['deploy-d2'], accountIds: ['account-a2'], appointmentKind: 'concurrent' })],
      identityLinks: [{ holderId: 'holder-h1', sameSubjectAs: 'holder-h2' }],
      conflicts: [conflict()],
      conflictChecks: [conflictCheck({ subjectId: 'subject-s2', checkedPositionRefs: ['position-p2'], checkedDeploymentIds: ['deploy-d2'], checkedAccountIds: ['account-a2'], conclusion: '无冲突', conflictFree: true })],
    })
    const outcome = validateCumulativeConflict(input)
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('conflictChecks.0.conclusion')
    expect(issueText(outcome)).toContain('拆身份')
  })

  it('检查只覆盖岗位、漏部署/账号面 → 拒（跨位置/部署/账号累计，范围完整）', () => {
    const outcome = validateCumulativeConflict(cumulative({ conflictChecks: [conflictCheck({ checkedDeploymentIds: [], checkedAccountIds: [] })] }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('conflictChecks.0.checkedDeploymentIds')
    expect(issuePaths(outcome)).toContain('conflictChecks.0.checkedAccountIds')
  })

  it('冲突未处置（先做后补）→ 拒', () => {
    const outcome = validateCumulativeConflict(cumulative({ conflicts: [conflict({ disposition: '' })], cumulativeView: { coveredSubjectIds: ['subject-s1'], conclusion: '有冲突待处置', conflictFree: false } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('conflicts.0.disposition')
    expect(issueText(outcome)).toContain('不得先做后补')
  })

  it('累计视图漏掉一名在册任职主体 → 拒（范围完整）', () => {
    const outcome = validateCumulativeConflict(
      cumulative({
        holdings: [holding(), holding({ holderId: 'holder-h2', subjectId: 'subject-s2', positionRef: 'position-p2', deploymentIds: [], accountIds: [], appointmentKind: 'concurrent' })],
        conflictChecks: [conflictCheck(), conflictCheck({ subjectId: 'subject-s2', checkedPositionRefs: ['position-p2'], checkedDeploymentIds: [], checkedAccountIds: [] })],
      }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('cumulativeView.coveredSubjectIds')
  })

  it('对照面：同一主体兼任两岗、冲突已处置、检查覆盖全部位置/部署/账号 → 放行', () => {
    const input = cumulative({
      holdings: [holding(), holding({ holderId: 'holder-h2', positionRef: 'position-p2', deploymentIds: ['deploy-d2'], accountIds: ['account-a2'], appointmentKind: 'concurrent' })],
      conflicts: [conflict()],
      conflictChecks: [
        conflictCheck({ checkedPositionRefs: ['position-p1', 'position-p2'], checkedDeploymentIds: ['deploy-d1', 'deploy-d2'], checkedAccountIds: ['account-a1', 'account-a2'], conclusion: '冲突已处置：回避安排' }),
      ],
      cumulativeView: { coveredSubjectIds: ['subject-s1'], conclusion: '累计视图：1 条冲突已处置', conflictFree: false },
    })
    expect(validateCumulativeConflict(input)).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-04：验收口径版本链（降口径冒充完成判负） ─────────────────────────

function criteriaStep(overrides: Partial<CriteriaRevisionStep> = {}): CriteriaRevisionStep {
  return { revision: 'criteria-v1', requiredChecks: ['四要件', '独立收割', '验收证据'], ...overrides }
}

function criteria(overrides: Partial<AcceptanceCriteriaRevisionInput> = {}): AcceptanceCriteriaRevisionInput {
  return {
    workRef: 'work-w1',
    chain: [criteriaStep()],
    appliedRevision: 'criteria-v1',
    capability: { degraded: false, disclosed: false },
    acceptance: { verdict: 'accepted', claimedAsCompleted: true },
    ...overrides,
  }
}

describe('NEG-EMP-04 · 验收口径不变量（能力退化后降口径冒充完成→判负）', () => {
  it('能力退化后降口径仍以 accepted 宣称完成 → 拒（口径不降，冒充完成）', () => {
    const outcome = validateAcceptanceCriteriaRevision(
      criteria({
        chain: [criteriaStep(), criteriaStep({ revision: 'criteria-v2', requiredChecks: ['四要件'], changeRecordRef: ref('REC-CHG-01'), rationale: '能力退化后缩小口径' })],
        appliedRevision: 'criteria-v2',
        capability: { degraded: true, disclosed: true, disposition: '缩小范围' },
      }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('chain.1.requiredChecks')
    expect(issueText(outcome)).toContain('冒充完成')
  })

  it('口径变更无 REC-CHG-01 变更记录 → 拒', () => {
    const outcome = validateAcceptanceCriteriaRevision(
      criteria({ chain: [criteriaStep(), criteriaStep({ revision: 'criteria-v2', requiredChecks: ['四要件'], rationale: '口径调整' })], appliedRevision: 'criteria-v2' }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('chain.1.changeRecordRef')
    expect(issueText(outcome)).toContain('REC-CHG-01')
  })

  it('验收仍用旧口径版本（链上当前已是 v2）→ 拒（不得用旧/事后口径）', () => {
    const outcome = validateAcceptanceCriteriaRevision(
      criteria({
        chain: [criteriaStep(), criteriaStep({ revision: 'criteria-v2', changeRecordRef: ref('REC-CHG-01'), rationale: '收紧判据' })],
        appliedRevision: 'criteria-v1',
      }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('appliedRevision')
  })

  it('能力已退化却未明示缺失 → 拒（静默退化）', () => {
    const outcome = validateAcceptanceCriteriaRevision(criteria({ capability: { degraded: true, disclosed: false, disposition: '替换配置' } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('capability.disclosed')
  })

  it('对照面：退化明示＋处置阶梯＋口径未降＋附条件接受（不宣称完成）→ 放行（诚实供给失败）', () => {
    const input = criteria({
      capability: { degraded: true, disclosed: true, disposition: '替换配置' },
      acceptance: { verdict: 'conditional_accepted', claimedAsCompleted: false },
    })
    expect(validateAcceptanceCriteriaRevision(input)).toEqual({ ok: true })
  })

  it('对照面：口径收紧（新增检查）走 REC-CHG-01 变更链 → 放行', () => {
    const input = criteria({
      chain: [
        criteriaStep(),
        criteriaStep({ revision: 'criteria-v2', requiredChecks: ['四要件', '独立收割', '验收证据', '事后抽样'], changeRecordRef: ref('REC-CHG-01'), rationale: '事故后收紧' }),
      ],
      appliedRevision: 'criteria-v2',
    })
    expect(validateAcceptanceCriteriaRevision(input)).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-06：绩效归因（配置红利记成绩/绩效改任命判负） ─────────────────────────

function factor(overrides: Partial<AttributionFactor> = {}): AttributionFactor {
  return { factorId: 'factor-1', kind: 'judgment_quality', creditedToPerformance: true, layer: '任职者绩效', ...overrides }
}

function attribution(overrides: Partial<PerformanceAttributionInput> = {}): PerformanceAttributionInput {
  return {
    subjectRef: ref('REC-LIFE-01'),
    layer: '任职者绩效',
    factors: [factor()],
    evidenceWeak: false,
    inputRefs: [ref('REC-WORK-09'), ref('REC-WORK-08')],
    ...overrides,
  }
}

describe('NEG-EMP-06 · 绩效归因（配置红利记成绩并据此晋升→判负）', () => {
  it('把配置红利记成任职者绩效成绩 → 拒（三层归因分开，E-6）', () => {
    const outcome = validatePerformanceAttribution(attribution({ factors: [factor({ kind: 'configuration_dividend' })] }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('factors.0.creditedToPerformance')
    expect(issueText(outcome)).toContain('配置红利')
  })

  it('绩效结论改变职级却无 v2/03 程序引用 → 拒（不经程序不得改变任命/职级）', () => {
    const outcome = validatePerformanceAttribution(attribution({ effectOnPosition: { changesAppointment: false, changesRank: true } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('effectOnPosition.procedureRef')
    expect(issueText(outcome)).toContain('v2/03 程序')
  })

  it('程序引用指向绩效记录自身（自我兑换）→ 拒（引用须为任免/决定记录）', () => {
    const outcome = validatePerformanceAttribution(
      attribution({ effectOnPosition: { changesAppointment: false, changesRank: true, procedureRef: ref('REC-PERF-01') } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('effectOnPosition.procedureRef.refType')
  })

  it('证据弱仍据此作重大任职决定 → 拒（只能「暂不能归因」）', () => {
    const outcome = validatePerformanceAttribution(
      attribution({ evidenceWeak: true, effectOnPosition: { changesAppointment: true, changesRank: false, procedureRef: ref('REC-LIFE-01') } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('evidenceWeak')
  })

  it('结论层填组织绩效（个人绩效对象冒用组织归因）→ 拒', () => {
    const outcome = validatePerformanceAttribution(attribution({ layer: '组织绩效' }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('layer')
  })

  it('记成绩却未以验收结论（REC-WORK-09）为输入 → 拒（不得以执行面终态替代）', () => {
    const outcome = validatePerformanceAttribution(attribution({ inputRefs: [ref('REC-WORK-08')] }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('inputRefs')
  })

  it('对照面：因素层与结论层一致、输入含验收结论、经任免程序建议升降 → 放行', () => {
    const input = attribution({ effectOnPosition: { changesAppointment: false, changesRank: true, procedureRef: ref('REC-LIFE-01') } })
    expect(validatePerformanceAttribution(input)).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-07：交接闸（无交接离场即结清→不得结清） ─────────────────────────

function handover(overrides: Partial<HandoverFaceDeclaration> = {}): HandoverFaceDeclaration {
  return {
    recordRef: ref('REC-LIFE-03'),
    verifiedByReceiver: true,
    completeness: 'complete',
    coveredItems: [...HANDOVER_MIN_SET],
    gaps: [],
    ...overrides,
  }
}

function settlement(overrides: Partial<HandoverBeforeSettlementInput> = {}): HandoverBeforeSettlementInput {
  return {
    subjectRef: 'appointment-a1',
    appointmentKind: 'temporary',
    handover: handover(),
    settlement: { claimed: true, closedItems: ['记忆'], openItems: [] },
    ...overrides,
  }
}

describe('NEG-EMP-07 · 交接闸（临时任职者无交接离场即结清→不得结清）', () => {
  it('临时任职无交接记录即宣称结清 → 拒（临时不减免，两段式）', () => {
    const outcome = validateHandoverBeforeSettlement({
      subjectRef: 'appointment-a1',
      appointmentKind: 'temporary',
      settlement: { claimed: true, closedItems: ['记忆'], openItems: [] },
    })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('handover')
    expect(issueText(outcome)).toContain('临时')
  })

  it('交接未完成（partial）且缺口逐项 → 拒（不得进入离岗待结清）', () => {
    const outcome = validateHandoverBeforeSettlement(
      settlement({ handover: handover({ completeness: 'partial', coveredItems: ['权源', '关键输入'], gaps: ['承诺未交接', '风险未移交'] }) }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('handover.completeness')
    expect(issuePaths(outcome)).toContain('handover.coveredItems')
    expect(issuePaths(outcome)).toContain('handover.gaps')
    expect(issueText(outcome)).toContain('承诺未交接')
  })

  it('交接未经接收者核验（单方宣告完成）→ 拒', () => {
    const outcome = validateHandoverBeforeSettlement(settlement({ handover: handover({ verifiedByReceiver: false }) }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('handover.verifiedByReceiver')
  })

  it('交接无记录承载（recordRef 空）→ 拒（无记录＝无交接）', () => {
    const outcome = validateHandoverBeforeSettlement(settlement({ handover: handover({ recordRef: ref('REC-LIFE-03', '') }) }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('handover.recordRef')
  })

  it('尚有未结清项即宣称已退役 → 拒（逐项结清）', () => {
    const outcome = validateHandoverBeforeSettlement(settlement({ settlement: { claimed: true, closedItems: [], openItems: ['外部关系未结', '授权未关闭'] } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('settlement.openItems')
  })

  it('对照面：交接完整＋接收者核验＋最小集齐＋无缺口＋无未结项 → 放行', () => {
    expect(validateHandoverBeforeSettlement(settlement())).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-08：集体任职（匿名集体挡箭牌→拒） ─────────────────────────

function collective(overrides: Partial<CollectiveAppointmentInput> = {}): CollectiveAppointmentInput {
  return {
    ruleRef: ref('REC-DEC-01'),
    rule: { deliberation: '议事：定期会议＋议程留痕', voting: '表决：过半数', dissent: '异议：记录并附理由', recording: '记录：每次落盘' },
    recordRef: ref('REC-LIFE-08'),
    members: [
      { memberRef: 'member-1', named: true },
      { memberRef: 'member-2', named: true },
    ],
    representative: { memberRef: 'member-1', mandateRef: ref('REC-DEC-01') },
    responsibility: { assignedTo: 'members' },
    ...overrides,
  }
}

describe('NEG-EMP-08 · 集体任职（无 03 规则与记录/匿名集体→拒）', () => {
  it('集体任职无 v2/03 集体规则 → 拒', () => {
    const outcome = validateCollectiveAppointment(collective({ ruleRef: ref('') }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('ruleRef')
    expect(issueText(outcome)).toContain('无规则')
  })

  it('无集体记录（匿名集体挡箭牌）→ 拒', () => {
    const outcome = validateCollectiveAppointment(collective({ recordRef: ref('REC-LIFE-08', '') }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordRef')
  })

  it('成员匿名 → 拒（须具名成员）', () => {
    const outcome = validateCollectiveAppointment(
      collective({ members: [{ memberRef: 'member-1', named: true }, { memberRef: 'member-x', named: false }] }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('members.1')
  })

  it('无可识别代表/未获成员授权 → 拒', () => {
    const outcome = validateCollectiveAppointment(collective({ representative: { memberRef: 'member-1' } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('representative.mandateRef')
  })

  it('责任由「集体」匿名承接 → 拒（成员按实际控制担责）', () => {
    const outcome = validateCollectiveAppointment(collective({ responsibility: { assignedTo: '集体承担' } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('responsibility')
    expect(issueText(outcome)).toContain('匿名集体')
  })

  it('集体规则四要件不齐（缺异议规则）→ 拒', () => {
    const outcome = validateCollectiveAppointment(
      collective({ rule: { deliberation: '议事：开会', voting: '表决：过半数', dissent: '', recording: '记录：落盘' } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain(`rule.${COLLECTIVE_RULE_PARTS[2]}`)
  })

  it('对照面：规则四要件齐＋集体记录＋具名成员＋经授权代表＋责任落成员 → 放行', () => {
    expect(validateCollectiveAppointment(collective())).toEqual({ ok: true })
  })
})

// ───────────────────────── NEG-EMP-09：外部保留权/最终承诺（越权→无效，内部程序不得补位） ─────────────────────────

function reservedPower(overrides: Partial<ReservedPowerExerciseInput> = {}): ReservedPowerExerciseInput {
  return {
    actorClass: 'internal_boss',
    power: '公司级对外承诺',
    authorizationRef: ref('REC-AUTH-01'),
    withinGrantedScope: true,
    finalCommitment: { claimed: true, authorizationRef: ref('REC-AUTH-01') },
    ...overrides,
  }
}

describe('NEG-EMP-09 · 外部保留权（未授权行使保留权/最终承诺→越权部分无效）', () => {
  it('外部主体行使清算保留权却无显式授权引用 → 拒（外部身份不产生保留权）', () => {
    const outcome = validateExternalReservedPower(
      reservedPower({ actorClass: 'external_subject', power: '清算', authorizationRef: ref(''), finalCommitment: { claimed: false } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('authorizationRef')
    expect(issueText(outcome)).toContain('不产生保留权')
  })

  it('以内部决定记录充当外部保留权授权 → 拒（内部程序不得补位）', () => {
    const outcome = validateExternalReservedPower(reservedPower({ authorizationRef: ref('REC-LIFE-01') }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('authorizationRef.refType')
    expect(issueText(outcome)).toContain('内部程序不得补位')
  })

  it('行使超出授权范围 → 拒（越权部分无效＋逐项列出）', () => {
    const outcome = validateExternalReservedPower(
      reservedPower({ withinGrantedScope: false, overflowParts: ['签发根授予', '撤回最高宰相'], finalCommitment: { claimed: false } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('withinGrantedScope')
    expect(issueText(outcome)).toContain('越权部分无效')
    expect(issueText(outcome)).toContain('签发根授予')
  })

  it('外部入口声称作出最终承诺 → 拒（外部入口不产生最终承诺）', () => {
    const outcome = validateExternalReservedPower(
      reservedPower({ actorClass: 'external_subject', finalCommitment: { claimed: true, authorizationRef: ref('REC-AUTH-01') } }),
    )
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('finalCommitment.claimed')
  })

  it('内部主体行使恒归外部老板的保留权（最终责任）→ 拒（不可下发）', () => {
    const outcome = validateExternalReservedPower(reservedPower({ actorClass: 'internal_position', power: '最终责任', finalCommitment: { claimed: false } }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('power')
    expect(issueText(outcome)).toContain('不可下发')
  })

  it('以内部程序（审批）补位授权引用 → 拒', () => {
    const outcome = validateExternalReservedPower(reservedPower({ internalProcedureRef: ref('REC-DEC-01') }))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('internalProcedureRef')
  })

  it('对照面：最高宰相按 root_delegation 范围作对外承诺（授权引用齐＋在范围内）→ 放行', () => {
    expect(validateExternalReservedPower(reservedPower())).toEqual({ ok: true })
  })
})

/*
 * 变异台账（实测：逐条临时去守卫→红→还原→绿；变异前/还原后 emp-neg.ts sha256 一致）：
 *   EMP-02｜emp-neg.ts L194 `check.conflictFree && groupConflicts.length > 0` 前置 `false &&`
 *          → 红「兼任拆成两个身份…→拒」1 failed/37 passed；还原 38 passed。
 *   EMP-04｜L285 `capability.degraded && verdict==='accepted' && claimedAsCompleted` 前置 `false &&`
 *          → 红「能力退化后降口径仍以 accepted 宣称完成→拒」1 failed/37 passed；还原 38 passed。
 *   EMP-06｜L359 `changesPosition = effect !== undefined && (…)` 改 `false`（程序闸整段失效）
 *          → 红 3 条（无程序引用/自我兑换/证据弱）3 failed/35 passed；还原 38 passed。
 *   EMP-07｜L428 `handover.completeness !== 'complete'` 前置 `false &&`
 *          → 红「交接未完成（partial）…→拒」1 failed/37 passed；还原 38 passed。
 *   EMP-08｜L486 `!isUsableRef(input.ruleRef)` 前置 `false &&`
 *          → 红「集体任职无 v2/03 集体规则→拒」1 failed/37 passed；还原 38 passed。
 *   EMP-09｜L574 `INTERNAL_PROCEDURE_RECORD_TYPES.includes(authorization.refType)` 改 `false`
 *          → 红「以内部决定记录充当外部保留权授权→拒」1 failed/37 passed；还原 38 passed。
 */
