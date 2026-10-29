/**
 * 员工侧负向机制补强纯判定件：NEG-EMP-02/04/06/07/08/09（MIG-08 补强单；决定二=A 第二批）
 *
 * 依据链：v2/17 §4.1（六行 NEG：禁配累计/验收口径不变量/绩效归因/交接闸/集体任职/外部保留权）；
 *   v2/02 §一（集体与外部边界）、§3.4（结清两段式）、§五（口径不降/不得静默退化）、§六（拆身份合并累计）、
 *   §七（累计禁配：主体同一/范围完整/不重置清单/冲突处置）、§九（三层归因/不经程序不改任命职级）；
 *   v2/11 §3.1（REC-LIFE-01/03/05）、§四（REC-PERF-01）、§5.2（REC-WORK-09）、§八（REC-CHG-01）、§〇.7；
 *   v2/03 §2.3 表 A′（保留权力显式归属）；v2/09（不新立取值；未登记值集按判定面常量承载并标 GAP）。
 *
 * 边界：纯判定件，零 IO、不取时钟、不抛错；输入面＝已解析的记录面声明（不新增记录类、不改冻结字段/值集），
 *   输出统一 `RecordValidationOutcome`（复用 recordReject/mergeOutcomes）；声明缺字段即判负，不补默认值。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`。
 */
import { mergeOutcomes, recordReject, type RecordValidationOutcome } from './envelope.ts'

// —— §0 共用输入面 ——

/** 判定输入面的记录引用（只承载「类型＋ID＋版本」；解析与形状闸在记录面/端口，本件不重做解析） */
export interface JudgmentRecordRef {
  readonly refType: string
  readonly refId: string
  readonly refVersion: string
}

const isBlank = (value: string): boolean => value.trim().length === 0

const isUsableRef = (ref: JudgmentRecordRef | undefined): ref is JudgmentRecordRef =>
  ref !== undefined && !isBlank(ref.refType) && !isBlank(ref.refId) && !isBlank(ref.refVersion)

function blankStringAt(value: string, path: string, message: string): RecordValidationOutcome[] {
  return isBlank(value) ? [recordReject(path, message)] : []
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 NEG-EMP-02 任职侧累计禁配（v2/02 §七/§六；REC-LIFE-01 conflict_check_ref→REC-LIFE-05）
// ─────────────────────────────────────────────────────────────────────────────

/** 已解析任职（REC-LIFE-01/05 解析：身份键 holderId、稳定主体 subjectId、岗位/部署/账号面） */
export interface ResolvedHolding {
  readonly holderId: string
  /** 身份解析结果（拆身份/换名不影响主体同一；链接见 identityLinks） */
  readonly subjectId: string
  readonly positionRef: string
  readonly deploymentIds: readonly string[]
  readonly accountIds: readonly string[]
  /** 任职类型（任命/兼任/代理/替补/临时/外部挂靠——不重置清单成员，不得据以重置累计） */
  readonly appointmentKind: string
}

/** 已解析冲突声明（REC-LIFE-05 interest_declarations/conflict_check 解析） */
export interface DeclaredConflict {
  readonly conflictId: string
  readonly subjectId: string
  readonly counterpartyId: string
  readonly conflictKind: string
  /** 冲突处置（拒绝/调整分工/回避/补偿控制/终止）；缺＝未处置（不得先做后补——02 §七） */
  readonly disposition?: string
}

/** 禁配检查结论声明（当前累计视图上的检查；须覆盖该主体全部位置/部署/账号） */
export interface ConflictCheckDeclaration {
  readonly subjectId: string
  readonly checkedPositionRefs: readonly string[]
  readonly checkedDeploymentIds: readonly string[]
  readonly checkedAccountIds: readonly string[]
  readonly conclusion: string
  /** 「无冲突」主张（结论解析：拆分身份/位置的「各自干净」不得当累计结论） */
  readonly conflictFree: boolean
}

export interface CumulativeConflictInput {
  readonly holdings: readonly ResolvedHolding[]
  readonly conflicts: readonly DeclaredConflict[]
  readonly conflictChecks: readonly ConflictCheckDeclaration[]
  /** 同一主体身份链（换名/拆身份/兼任拆两身份：链接两侧强制合并——拆身份无效，02 §六/§七） */
  readonly identityLinks?: readonly { readonly holderId: string; readonly sameSubjectAs: string }[]
  /** 累计视图（REC-LIFE-05 cumulative_view 解析：覆盖范围＋结论） */
  readonly cumulativeView: { readonly coveredSubjectIds: readonly string[]; readonly conclusion: string; readonly conflictFree: boolean }
}

/** 主体归并（并查集；作用域只在本判定调用内，不落记录） */
function resolveSubject(parent: Map<string, string>, subjectId: string): string {
  const chain: string[] = []
  let cursor = subjectId
  let next = parent.get(cursor)
  while (next !== undefined && next !== cursor) {
    chain.push(cursor)
    cursor = next
    next = parent.get(cursor)
  }
  for (const node of chain) parent.set(node, cursor)
  return cursor
}

function unionSubject(parent: Map<string, string>, left: string, right: string): void {
  const a = resolveSubject(parent, left)
  const b = resolveSubject(parent, right)
  if (a !== b) parent.set(b, a)
}

/**
 * NEG-EMP-02 判定（v2/02 §七/§六；v2/17 §4.1）：
 *   ① 主体同一：按任职者累计（兼任/代理/临时/换名/拆身份/分次出工一律合并，拆身份链接强制归并）；
 *   ② 范围完整：检查须覆盖该主体全部现有任职的**位置/部署/账号**（跨面累计，不重置）；
 *   ③ 冲突处置：已声明冲突须有处置（拒绝/调整分工/回避/补偿控制/终止），不得先做后补；
 *   ④ 拆身份规避判负：主体存冲突时，任何单身份/单位置的「无冲突」结论与「无禁配」累计结论一并判负。
 */
export function validateCumulativeConflict(input: CumulativeConflictInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  const parent = new Map<string, string>()
  const holderSubject = new Map<string, string>()

  for (const [index, holding] of input.holdings.entries()) {
    checks.push(...blankStringAt(holding.holderId, `holdings.${index}.holderId`, '任职声明须有身份键（主体同一按任职者累计——02 §七）'))
    checks.push(...blankStringAt(holding.subjectId, `holdings.${index}.subjectId`, '任职声明须有已解析稳定主体（拆身份/换名不产生新主体——02 §六）'))
    checks.push(...blankStringAt(holding.positionRef, `holdings.${index}.positionRef`, '任职声明须有岗位引用（跨位置累计的观测面——02 §七）'))
    checks.push(...blankStringAt(holding.appointmentKind, `holdings.${index}.appointmentKind`, '任职声明须写任职类型（不重置清单按类型识别——02 §七）'))
    const known = holderSubject.get(holding.holderId)
    if (known !== undefined && known !== holding.subjectId) {
      checks.push(recordReject(`holdings.${index}.holderId`, `同一身份键 ${holding.holderId} 解析出两个主体（${known}/${holding.subjectId}）＝拆身份/换名规避（02 §六）`))
    }
    holderSubject.set(holding.holderId, holding.subjectId)
    if (!parent.has(holding.subjectId)) parent.set(holding.subjectId, holding.subjectId)
  }

  for (const [index, link] of (input.identityLinks ?? []).entries()) {
    const left = holderSubject.get(link.holderId)
    const right = holderSubject.get(link.sameSubjectAs)
    if (left === undefined || right === undefined) {
      checks.push(recordReject(`identityLinks.${index}`, '身份链两侧须均为在册任职身份（不在累计视图的身份不得用于规避累计——02 §六/§七）'))
      continue
    }
    unionSubject(parent, left, right)
  }

  const conflictGroups = new Map<string, { conflict: DeclaredConflict; index: number }[]>()
  for (const [index, conflict] of input.conflicts.entries()) {
    checks.push(...blankStringAt(conflict.conflictId, `conflicts.${index}.conflictId`, '冲突声明须有具名冲突标识（02 §七）'))
    checks.push(...blankStringAt(conflict.counterpartyId, `conflicts.${index}.counterpartyId`, '冲突声明须有相对方/对象（02 §七）'))
    if (!parent.has(conflict.subjectId)) {
      checks.push(recordReject(`conflicts.${index}.subjectId`, '冲突主体须在累计视图内（全部现有任职＋仍有影响的历史关系——02 §七）'))
      continue
    }
    const key = resolveSubject(parent, conflict.subjectId)
    const bucket = conflictGroups.get(key) ?? []
    bucket.push({ conflict, index })
    conflictGroups.set(key, bucket)
    if (conflict.disposition === undefined || isBlank(conflict.disposition)) {
      checks.push(recordReject(`conflicts.${index}.disposition`, `冲突「${conflict.conflictId}」未处置（拒绝/调整分工/回避/补偿控制/终止，不得先做后补——02 §七）`))
    }
  }

  const groupHoldings = new Map<string, ResolvedHolding[]>()
  for (const holding of input.holdings) {
    const key = resolveSubject(parent, holding.subjectId)
    const bucket = groupHoldings.get(key) ?? []
    bucket.push(holding)
    groupHoldings.set(key, bucket)
  }

  const covered = new Set(input.cumulativeView.coveredSubjectIds)
  checks.push(...blankStringAt(input.cumulativeView.conclusion, 'cumulativeView.conclusion', '累计视图须有结论（不成文＝未检查——02 §七）'))
  for (const holdings of groupHoldings.values()) {
    const members = [...new Set(holdings.map((holding) => holding.subjectId))]
    if (!members.some((member) => covered.has(member))) {
      checks.push(recordReject('cumulativeView.coveredSubjectIds', `累计视图未覆盖主体 ${members.join('/')}（范围完整：全部现有任职＋仍有影响的历史关系——02 §七）`))
    }
  }

  for (const [index, check] of input.conflictChecks.entries()) {
    if (!parent.has(check.subjectId)) {
      checks.push(recordReject(`conflictChecks.${index}.subjectId`, '禁配检查须对应在册任职主体（不得以另一身份的单点结论充抵累计——02 §六）'))
      continue
    }
    const key = resolveSubject(parent, check.subjectId)
    const holdings = groupHoldings.get(key) ?? []
    const groupConflicts = conflictGroups.get(key) ?? []
    const missingPositions = [...new Set(holdings.map((holding) => holding.positionRef))].filter((ref) => !check.checkedPositionRefs.includes(ref))
    const missingDeployments = [...new Set(holdings.flatMap((holding) => holding.deploymentIds))].filter((id) => !check.checkedDeploymentIds.includes(id))
    const missingAccounts = [...new Set(holdings.flatMap((holding) => holding.accountIds))].filter((id) => !check.checkedAccountIds.includes(id))
    if (missingPositions.length > 0) {
      checks.push(recordReject(`conflictChecks.${index}.checkedPositionRefs`, `跨位置累计不完整（缺 ${missingPositions.join('/')}）：检查须覆盖该主体全部现有任职（02 §七）`))
    }
    if (missingDeployments.length > 0) {
      checks.push(recordReject(`conflictChecks.${index}.checkedDeploymentIds`, `跨部署累计不完整（缺 ${missingDeployments.join('/')}）：换配置/换部署不重置累计（02 §六/§七）`))
    }
    if (missingAccounts.length > 0) {
      checks.push(recordReject(`conflictChecks.${index}.checkedAccountIds`, `跨账号累计不完整（缺 ${missingAccounts.join('/')}）：换账号/拆身份不重置累计（02 §六/§七）`))
    }
    if (check.conflictFree && groupConflicts.length > 0) {
      checks.push(recordReject(`conflictChecks.${index}.conclusion`, `该主体存在 ${groupConflicts.length} 条已声明冲突，仍作「无冲突」结论＝拆身份/拆位置规避（合并累计——02 §六/§七）`))
    }
  }

  if (input.cumulativeView.conflictFree && input.conflicts.length > 0) {
    checks.push(recordReject('cumulativeView.conclusion', `累计视图声明无禁配，但存在 ${input.conflicts.length} 条冲突声明（拆身份后的单点结论无效——02 §七）`))
  }
  return mergeOutcomes(...checks)
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 NEG-EMP-04 验收口径版本链（v2/02 §五/E-4；v2/11 §5.2 REC-WORK-09）
// ─────────────────────────────────────────────────────────────────────────────

export interface CriteriaRevisionStep {
  /** 口径版本（显式；不得同名换内容/隐式覆盖） */
  readonly revision: string
  /** 该口径要求的验收检查项（口径不降的比较基准） */
  readonly requiredChecks: readonly string[]
  /** 本步变更依据（非首步必填；须 REC-CHG-01——判据变更只向前适用，v2/11 §八） */
  readonly changeRecordRef?: JudgmentRecordRef
  /** 变更理由（非首步必填非空；降口径不得静默） */
  readonly rationale?: string
}

export interface AcceptanceCriteriaRevisionInput {
  readonly workRef: string
  /** 口径版本链（首项＝工作受理时原口径；末项＝当前口径） */
  readonly chain: readonly CriteriaRevisionStep[]
  /** 本次验收所用口径版本（REC-WORK-09 `criteria_revision`；须为当前版本） */
  readonly appliedRevision: string
  /** 能力状态与处置声明（REC-CAP-02/资格状态解析） */
  readonly capability: { readonly degraded: boolean; readonly disclosed: boolean; readonly disposition?: string }
  /** 验收结论（REC-WORK-09 verdict 解析） */
  readonly acceptance: { readonly verdict: string; readonly claimedAsCompleted: boolean }
}

/**
 * NEG-EMP-04 判定（v2/02 §五/E-4；v2/11 §5.2/§八）：
 *   ① 原口径/新口径版本显式且不重名；口径链每一步变更须有 REC-CHG-01 记录＋理由（无变更记录→拒）；
 *   ② 验收所用口径须为链上当前版本（不得用旧口径或事后口径）；
 *   ③ 能力退化须明示缺失并给处置阶梯（缩小范围/替换配置/补足/外部能力/拒绝或停止），静默退化判负；
 *   ④ 能力退化后降低口径并以 accepted 宣称完成＝冒充完成，判负（口径不降）。
 */
export function validateAcceptanceCriteriaRevision(input: AcceptanceCriteriaRevisionInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  checks.push(...blankStringAt(input.workRef, 'workRef', '验收口径判定须指向具体工作（无工作对象＝无口径可比——02 §五）'))
  if (input.chain.length === 0) {
    checks.push(recordReject('chain', '须显式原口径/新口径版本链（无链即无口径可比——02 §五）'))
  }
  const seen = new Set<string>()
  const lowered: { index: number; dropped: string[] }[] = []
  for (const [index, step] of input.chain.entries()) {
    if (isBlank(step.revision)) {
      checks.push(recordReject(`chain.${index}.revision`, '口径版本须显式非空（机器值集未登记，按 GAP 非空串承载——02 §五）'))
    } else if (seen.has(step.revision)) {
      checks.push(recordReject(`chain.${index}.revision`, `口径版本 ${step.revision} 重复＝同名换内容/隐式覆盖（版本须显式递增——02 §五）`))
    } else {
      seen.add(step.revision)
    }
    if (index === 0) continue
    const previous = input.chain[index - 1]
    if (!isUsableRef(step.changeRecordRef) || step.changeRecordRef.refType !== 'REC-CHG-01') {
      checks.push(recordReject(`chain.${index}.changeRecordRef`, '口径变更须走 REC-CHG-01 变更链并显式引用（无变更记录→拒——02 §五/E-4）'))
    }
    if (step.rationale === undefined || isBlank(step.rationale)) {
      checks.push(recordReject(`chain.${index}.rationale`, '口径变更须显式理由（降口径不得静默——02 §五）'))
    }
    if (previous !== undefined) {
      const dropped = previous.requiredChecks.filter((item) => !step.requiredChecks.includes(item))
      if (dropped.length > 0) lowered.push({ index, dropped })
    }
  }

  if (input.capability.degraded && !input.capability.disclosed) {
    checks.push(recordReject('capability.disclosed', '能力退化须明示缺什么/影响什么/持续多久/有何替代（不得静默退化——02 §五）'))
  }
  if (input.capability.degraded && (input.capability.disposition === undefined || isBlank(input.capability.disposition))) {
    checks.push(recordReject('capability.disposition', '能力缺失须给处置阶梯（缩小范围/替换配置/补足能力/外部能力/拒绝或停止——02 §五）'))
  }

  const last = input.chain[input.chain.length - 1]
  if (isBlank(input.appliedRevision) || (last !== undefined && input.appliedRevision !== last.revision)) {
    checks.push(recordReject('appliedRevision', '验收所用口径须为链上当前版本（不得用旧口径/事后口径——REC-WORK-09 criteria_revision）'))
  }

  if (input.acceptance.claimedAsCompleted && input.acceptance.verdict !== 'accepted') {
    checks.push(recordReject('acceptance.claimedAsCompleted', '未获接受（verdict≠accepted）不得宣称完成（完成≠验收≠结清——v2/02 §九）'))
  }
  for (const { index, dropped } of lowered) {
    if (input.capability.degraded && input.acceptance.verdict === 'accepted' && input.acceptance.claimedAsCompleted) {
      checks.push(recordReject(`chain.${index}.requiredChecks`, `能力退化后降验收口径冒充完成（E-4）：去掉「${dropped.join('/')}」仍以 accepted 宣称完成——口径不降，须缩小范围/替换/停止（02 §五）`))
    }
  }
  return mergeOutcomes(...checks)
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 NEG-EMP-06 绩效归因（v2/02 §九/E-6；v2/11 §四 REC-PERF-01）
// ─────────────────────────────────────────────────────────────────────────────

/** 本对象只承载前两层（组织绩效口径 v2/03，不作个人归因——02 §九） */
export const ATTRIBUTION_LAYERS_IN_SCOPE = ['执行能力表现', '任职者绩效'] as const
/** 不得记成任职者绩效成绩的因素（值集未在 v2/09 登记——GAP；配置红利/一次性因素，02 §九） */
export const NON_ATTRIBUTABLE_PERFORMANCE_FACTORS = ['configuration_dividend', '配置红利', 'one_off', '一次性因素'] as const
/** 可改变任命/职级的程序记录（v2/03 任免/决定面；非程序引用不得生效） */
export const PERFORMANCE_TO_POSITION_PROCEDURE_REFS = ['REC-AUTH-01', 'REC-LIFE-01', 'REC-LIFE-02', 'REC-DEC-01'] as const

export interface AttributionFactor {
  readonly factorId: string
  /** 因素类别（值集未登记——GAP 非空串；配置红利/一次性因素见同名常量） */
  readonly kind: string
  /** 是否被记入职级/任职者的绩效成绩（配置红利/一次性因素记成绩＝E-6 判负） */
  readonly creditedToPerformance: boolean
  /** 该因素归属层（须与结论层一致：三层归因不得错位） */
  readonly layer: string
}

export interface PerformanceAttributionInput {
  readonly subjectRef: JudgmentRecordRef
  /** 结论层别（执行能力表现/任职者绩效） */
  readonly layer: string
  readonly factors: readonly AttributionFactor[]
  /** 绩效结论对任命/职级的效力主张 */
  readonly effectOnPosition?: {
    readonly changesAppointment: boolean
    readonly changesRank: boolean
    /** 所经 v2/03 程序引用（任免/决定记录） */
    readonly procedureRef?: JudgmentRecordRef
  }
  /** 证据弱标注（弱证据结论只能是「暂不能归因」，不得作重大任职决定——v2/11 §四） */
  readonly evidenceWeak: boolean
  /** 输入证据（须含 REC-WORK-09 验收结论——绩效以验收结论为输入） */
  readonly inputRefs: readonly JudgmentRecordRef[]
}

/**
 * NEG-EMP-06 判定（v2/02 §九/E-6；v2/11 §四）：
 *   ① 绩效结论不经 v2/03 程序不得改变任命/职级；无程序引用或引用非任免/决定记录即判负；
 *   ② 配置红利/一次性因素不得记成任职者绩效成绩；因素层与结论层不一致＝三层归因错位判负；
 *   ③ 证据弱时结论只能「暂不能归因」，不得据此作重大任职决定；
 *   ④ 记成绩须以验收结论（REC-WORK-09）为输入，不得以执行面终态/自报替代。
 */
export function validatePerformanceAttribution(input: PerformanceAttributionInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  checks.push(...blankStringAt(input.subjectRef.refId, 'subjectRef.refId', '绩效归因须有具名被评价任职者（不按配置/批次归因——02 §九）'))
  if (!(ATTRIBUTION_LAYERS_IN_SCOPE as readonly string[]).includes(input.layer)) {
    checks.push(recordReject('layer', `本对象只承载执行能力表现/任职者绩效（实得「${input.layer}」）；组织绩效不作个人归因（02 §九）`))
  }
  for (const [index, factor] of input.factors.entries()) {
    checks.push(...blankStringAt(factor.factorId, `factors.${index}.factorId`, '归因因素须具名（不得以「环境」类空话充抵——02 §九）'))
    if (isBlank(factor.kind)) {
      checks.push(recordReject(`factors.${index}.kind`, '归因因素须写类别（值集未登记，按 GAP 非空串——02 §九）'))
      continue
    }
    if ((NON_ATTRIBUTABLE_PERFORMANCE_FACTORS as readonly string[]).includes(factor.kind.trim().toLowerCase()) && factor.creditedToPerformance) {
      checks.push(recordReject(`factors.${index}.creditedToPerformance`, '配置红利/一次性因素不得记成绩（E-6）：须归执行能力表现层或不计成绩（02 §九）'))
    }
    if (factor.creditedToPerformance && factor.layer !== input.layer) {
      checks.push(recordReject(`factors.${index}.layer`, `三层归因错位：因素层「${factor.layer}」与结论层「${input.layer}」不一致不得记成绩（02 §九）`))
    }
  }

  const effect = input.effectOnPosition
  const changesPosition = effect !== undefined && (effect.changesAppointment || effect.changesRank)
  if (changesPosition) {
    if (!isUsableRef(effect.procedureRef)) {
      checks.push(recordReject('effectOnPosition.procedureRef', '绩效结论不经 v2/03 程序不得改变任命或职级（无程序引用即判负——E-6 断言面）'))
    } else if (!(PERFORMANCE_TO_POSITION_PROCEDURE_REFS as readonly string[]).includes(effect.procedureRef.refType)) {
      checks.push(recordReject('effectOnPosition.procedureRef.refType', `程序引用须指向任免/决定记录（实得 ${effect.procedureRef.refType}；绩效记录不能自我兑换任命/职级——E-6）`))
    }
    if (input.evidenceWeak) {
      checks.push(recordReject('evidenceWeak', '证据弱时结论只能「暂不能归因」，不得据此作重大任职决定（v2/11 §四）'))
    }
  }

  if (input.factors.some((factor) => factor.creditedToPerformance)) {
    const hasAcceptance = input.inputRefs.some((ref) => ref.refType === 'REC-WORK-09')
    if (!hasAcceptance) {
      checks.push(recordReject('inputRefs', '记成绩须以 REC-WORK-09 验收结论为输入（不得以执行面终态/自报替代——v2/11 §四/§十五-2）'))
    }
  }
  return mergeOutcomes(...checks)
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 NEG-EMP-07 交接闸（v2/02 §3.4/E-7；v2/11 §3.1 REC-LIFE-03 两段式）
// ─────────────────────────────────────────────────────────────────────────────

/** 交接最小集（v2/02 §六：权源/关键输入/决定依据/已采取行动/结果/未决事项/承诺/已知不能/风险） */
export const HANDOVER_MIN_SET = ['权源', '关键输入', '决定依据', '已采取行动', '结果', '未决事项', '承诺', '已知不能', '风险'] as const

/** 交接面声明（REC-LIFE-03 face=handover_face 解析；无交接记录＝undefined） */
export interface HandoverFaceDeclaration {
  readonly recordRef?: JudgmentRecordRef
  /** 接收者核验确认（不得单方宣告——v2/02 §六/§3.2） */
  readonly verifiedByReceiver: boolean
  /** 完成度（已解析；仅 complete 可进入离岗待结清） */
  readonly completeness: string
  /** 交接最小集已覆盖项 */
  readonly coveredItems: readonly string[]
  /** 交接记录缺口（逐项） */
  readonly gaps: readonly string[]
}

export interface HandoverBeforeSettlementInput {
  readonly subjectRef: string
  /** 任职类型（任命/兼任/代理/替补/临时/外部挂靠） */
  readonly appointmentKind: string
  readonly handover?: HandoverFaceDeclaration
  /** 结清面主张（REC-LIFE-03 face=settlement_face；是否宣称已结清/退役） */
  readonly settlement: { readonly claimed: boolean; readonly closedItems: readonly string[]; readonly openItems: readonly string[] }
}

/**
 * NEG-EMP-07 判定（v2/02 §3.4/E-7；v2/11 §3.1）：
 *   ① 两段式：交接核验通过→离岗待结清→逐项结清→已退役；交接未完成不得结清；
 *   ② 交接须有记录承载＋接收者核验（不得单方宣告），完成度非 complete 即不得进入结清；
 *   ③ 交接最小集缺口逐项列出；记录缺口逐项列出，不得以「已结清」覆盖；
 *   ④ 临时/代行任职必须交接记录，不因「临时」减免（不得把长期关系拆成一串临时规避结清）。
 */
export function validateHandoverBeforeSettlement(input: HandoverBeforeSettlementInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  checks.push(...blankStringAt(input.subjectRef, 'subjectRef', '交接判定须指向具体任职关系（02 §3.4）'))
  const temporary = input.appointmentKind === 'temporary' || input.appointmentKind === 'acting'
  const handover = input.handover
  if (!input.settlement.claimed) return mergeOutcomes(...checks)
  if (handover === undefined) {
    checks.push(recordReject('handover', `未完成交接不得结清（两段式：交接核验通过→离岗待结清）；${temporary ? `临时/代行任职（${input.appointmentKind}）必须交接记录，不因临时减免（E-7）` : '须有交接面记录（REC-LIFE-03）'}`))
  } else {
    if (!isUsableRef(handover.recordRef)) {
      checks.push(recordReject('handover.recordRef', '交接须有记录承载（REC-LIFE-03 交接面）；无记录＝无交接（E-7）'))
    }
    if (handover.completeness !== 'complete') {
      checks.push(recordReject('handover.completeness', `交接完成度须为 complete（实得「${handover.completeness}」）——未完成不得进入离岗待结清（02 §3.4）`))
    }
    if (!handover.verifiedByReceiver) {
      checks.push(recordReject('handover.verifiedByReceiver', '交接须接收者核验确认，不得单方宣告（02 §六/§3.4）'))
    }
    const missing = HANDOVER_MIN_SET.filter((item) => !handover.coveredItems.includes(item))
    if (missing.length > 0) {
      checks.push(recordReject('handover.coveredItems', `交接最小集缺「${missing.join('」「')}」（九项：权源/关键输入/决定依据/已采取行动/结果/未决事项/承诺/已知不能/风险——02 §六）`))
    }
    if (handover.gaps.length > 0) {
      checks.push(recordReject('handover.gaps', `交接记录缺口逐项登记：${handover.gaps.join('/')}（缺口不得以结清覆盖——02 §3.4/E-7）`))
    }
  }
  if (input.settlement.openItems.length > 0) {
    checks.push(recordReject('settlement.openItems', `未结清项：${input.settlement.openItems.join('/')}——逐项结清核验通过才可宣称已退役（02 §3.4）`))
  }
  return mergeOutcomes(...checks)
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 NEG-EMP-08 集体任职（v2/02 §一/E-8）
// ─────────────────────────────────────────────────────────────────────────────

/** 集体规则四要件（v2/02 §一：议事/表决/异议/记录规则） */
export const COLLECTIVE_RULE_PARTS = ['deliberation', 'voting', 'dissent', 'recording'] as const
/** 不得以匿名集体承接责任的表示（值集未在 v2/09 登记——GAP） */
export const COLLECTIVE_ANONYMOUS_LITERALS = ['collective', 'anonymous', '集体', '集体承担', '集体负责'] as const

export interface CollectiveMemberDeclaration {
  readonly memberRef: string
  readonly named: boolean
  readonly responsibilityScope?: string
}

export interface CollectiveAppointmentInput {
  /** v2/03 设定的集体规则引用（无规则引用即拒） */
  readonly ruleRef?: JudgmentRecordRef
  /** 规则内容（议事/表决/异议/记录四项须齐备） */
  readonly rule?: { readonly deliberation: string; readonly voting: string; readonly dissent: string; readonly recording: string }
  /** 集体任职记录/集体史（无记录即拒） */
  readonly recordRef?: JudgmentRecordRef
  readonly members: readonly CollectiveMemberDeclaration[]
  /** 可识别代表（须经成员授权，不得匿名） */
  readonly representative?: { readonly memberRef: string; readonly mandateRef?: JudgmentRecordRef }
  /** 责任承接（须落到成员/代表，按实际控制担责） */
  readonly responsibility: { readonly assignedTo: string; readonly anonymousClaim?: boolean }
}

/**
 * NEG-EMP-08 判定（v2/02 §一/E-8）：
 *   ① 集体须 v2/03 设定的议事/表决/异议/记录规则（无规则引用或四要件不齐→拒）；
 *   ② 须有集体任职记录（无记录＝匿名集体挡箭牌→拒）；
 *   ③ 成员须具名（匿名成员→拒）；须有可识别代表并经成员授权（mandate 引用）；
 *   ④ 责任不得由匿名集体承接（按实际控制落到成员/代表——「集体承担」类表示→拒）。
 */
export function validateCollectiveAppointment(input: CollectiveAppointmentInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  if (!isUsableRef(input.ruleRef)) {
    checks.push(recordReject('ruleRef', '集体任职须 v2/03 设定的集体规则引用（无规则即拒——02 §一/E-8）'))
  }
  if (input.rule === undefined) {
    checks.push(recordReject('rule', '集体规则须齐备议事/表决/异议/记录四项（缺即规则不成立——02 §一）'))
  } else {
    const labels: Readonly<Record<(typeof COLLECTIVE_RULE_PARTS)[number], string>> = { deliberation: '议事', voting: '表决', dissent: '异议', recording: '记录' }
    for (const part of COLLECTIVE_RULE_PARTS) {
      if (isBlank(input.rule[part])) {
        checks.push(recordReject(`rule.${part}`, `集体规则缺「${labels[part]}」（议事/表决/异议/记录四项齐备——02 §一）`))
      }
    }
  }
  if (!isUsableRef(input.recordRef)) {
    checks.push(recordReject('recordRef', '集体任职须有集体记录（无记录＝匿名集体挡箭牌——02 §一/E-8）'))
  }
  if (input.members.length === 0) {
    checks.push(recordReject('members', '集体任职须有具名成员（无成员＝匿名集体——02 §一）'))
  }
  for (const [index, member] of input.members.entries()) {
    if (!member.named || isBlank(member.memberRef)) {
      checks.push(recordReject(`members.${index}`, '成员须具名（匿名成员不得承接集体任职——02 §一/E-8）'))
    }
  }
  const representative = input.representative
  if (representative === undefined) {
    checks.push(recordReject('representative', '集体须有可识别代表（不得匿名——02 §一）'))
  } else {
    if (!isUsableRef(representative.mandateRef) || isBlank(representative.memberRef)) {
      checks.push(recordReject('representative.mandateRef', '代表须经成员授权（mandate 引用）且可识别（不得匿名代表——02 §一）'))
    } else if (!input.members.some((member) => member.memberRef === representative.memberRef)) {
      checks.push(recordReject('representative.memberRef', '代表须为具名成员之一（经成员授权——02 §一）'))
    }
  }
  const assignedTo = input.responsibility.assignedTo.trim()
  if (isBlank(assignedTo)) {
    checks.push(recordReject('responsibility.assignedTo', '责任承接须显式落到成员/代表（不得空着——02 §一）'))
  } else if (input.responsibility.anonymousClaim === true || (COLLECTIVE_ANONYMOUS_LITERALS as readonly string[]).includes(assignedTo.toLowerCase())) {
    checks.push(recordReject('responsibility', '责任不得由匿名集体承接：成员按实际控制分别担责（E-8/02 §一）'))
  }
  return mergeOutcomes(...checks)
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 NEG-EMP-09 外部主体保留权/最终承诺（v2/02 §一/E-9；v2/03 §2.3 表 A′）
// ─────────────────────────────────────────────────────────────────────────────

/** 表 A′ 中恒归外部老板/外部锚、不可下发给内部主体的保留权力（行 2/3/4/11；02 §一） */
export const EXTERNALLY_HELD_RESERVED_POWERS = ['最终责任', '公司身份', '清算', 'G9 任免', '外部独立审计'] as const
/** 内部程序记录类型（不得充当外部保留权/最终承诺的授权引用——E-9） */
export const INTERNAL_PROCEDURE_RECORD_TYPES = ['REC-DEC-01', 'REC-LIFE-01', 'REC-LIFE-02', 'REC-AUTH-07'] as const

export interface ReservedPowerExerciseInput {
  /** 行使者主体类别（external_owner/external_subject/internal_boss/internal_position） */
  readonly actorClass: string
  /** 行使的保留权力（表 A′ 行名；值集未登记——GAP 非空串） */
  readonly power: string
  /** 显式授权引用（外部授予/设立记录/root_delegation；外部身份本身不产生保留权） */
  readonly authorizationRef?: JudgmentRecordRef
  /** 本次行使所依据的内部程序（内部程序不得补位——E-9） */
  readonly internalProcedureRef?: JudgmentRecordRef
  /** 是否落在授权范围内（授权解析结论） */
  readonly withinGrantedScope: boolean
  /** 越权涉及的部分（逐项；越权部分无效） */
  readonly overflowParts?: readonly string[]
  /** 最终承诺主张（外部入口不产生最终承诺——02 §一） */
  readonly finalCommitment?: { readonly claimed: boolean; readonly authorizationRef?: JudgmentRecordRef }
}

/**
 * NEG-EMP-09 判定（v2/02 §一/E-9；v2/03 §2.3 表 A′）：
 *   ① 外部主体行使保留权/最终承诺须显式授权引用（外部身份不产生最终责任或保留权）；
 *   ② 内部程序不得补位：以内部决定/审批（REC-DEC-01 等）充当外部授权即判负；
 *   ③ 越权部分无效（逐项列出）并停止问责；范围声明与越权清单矛盾亦判负；
 *   ④ 最终承诺只可由外部老板（根）或最高宰相按 root_delegation 范围作出；外部入口不产生最终承诺。
 */
export function validateExternalReservedPower(input: ReservedPowerExerciseInput): RecordValidationOutcome {
  const checks: RecordValidationOutcome[] = []
  checks.push(...blankStringAt(input.actorClass, 'actorClass', '保留权判定须写行使者主体类别（02 §一）'))
  if (isBlank(input.power)) {
    checks.push(recordReject('power', '保留权判定须写行使的权力（表 A′ 行名；值集未登记，按 GAP 非空串）'))
  } else if (input.actorClass !== 'external_owner' && ((EXTERNALLY_HELD_RESERVED_POWERS as readonly string[]).includes(input.power.trim()))) {
    checks.push(recordReject('power', `「${input.power}」恒归外部老板/外部锚，不可下发给内部主体行使（表 A′ 行 3/4/11；02 §一）`))
  }

  const authorization = input.authorizationRef
  if (!isUsableRef(authorization)) {
    checks.push(recordReject('authorizationRef', '保留权/最终承诺须显式授权引用（外部身份本身不产生保留权或最终责任——02 §一/E-9）'))
  } else if ((INTERNAL_PROCEDURE_RECORD_TYPES as readonly string[]).includes(authorization.refType)) {
    checks.push(recordReject('authorizationRef.refType', `内部程序不得补位外部保留权（实得 ${authorization.refType}）：须外部授予/设立记录/root_delegation（E-9）`))
  }
  if (input.internalProcedureRef !== undefined) {
    checks.push(recordReject('internalProcedureRef', '内部程序不得补位外部保留权或最终承诺：内部审批不产生外部授权（E-9）'))
  }

  if (!input.withinGrantedScope) {
    const parts = (input.overflowParts ?? []).filter((part) => !isBlank(part))
    checks.push(recordReject('withinGrantedScope', `越权部分无效${parts.length > 0 ? `（${parts.join('/')}）` : ''}：停止并问责；外部入口不产生最终承诺（02 §一/E-9）`))
  } else if ((input.overflowParts ?? []).some((part) => !isBlank(part))) {
    checks.push(recordReject('overflowParts', '范围声明（在授权范围内）与越权清单矛盾（越权部分无效——E-9）'))
  }

  const commitment = input.finalCommitment
  if (commitment !== undefined && commitment.claimed) {
    if (input.actorClass !== 'external_owner' && input.actorClass !== 'internal_boss') {
      checks.push(recordReject('finalCommitment.claimed', '外部入口不产生最终承诺（仅外部老板为根/最高宰相按 root_delegation 范围行使——02 §一/E-9）'))
    }
    if (!isUsableRef(commitment.authorizationRef)) {
      checks.push(recordReject('finalCommitment.authorizationRef', '最终承诺须显式授权引用（外部根授予/按 root_delegation 范围——表 A′ 行 7）'))
    } else if ((INTERNAL_PROCEDURE_RECORD_TYPES as readonly string[]).includes(commitment.authorizationRef.refType)) {
      checks.push(recordReject('finalCommitment.authorizationRef.refType', '内部程序不得补位最终承诺（须外部根授予/root_delegation——E-9）'))
    }
  }
  return mergeOutcomes(...checks)
}
