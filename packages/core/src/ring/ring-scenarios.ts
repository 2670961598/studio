/**
 * ring-scenarios —— 五环场景判定件（NEG-RING-01 价值环六要素／NEG-RING-04 组织环结构评价掩盖）
 *
 * 依据（AGENTS §五.1）：v2/17 §4.1 NEG-RING-01/04（六要素；越界/无价值/不可验收/承诺不可持续仍
 * 庆功→强制失败出口，04 §二/§六；新增层级掩盖协调失败、整体透支不处置→R-22 判负、缩编或终止，
 * 03 §八）与 §3.3 TR-RING-01/04；v2/05 §五（闭环判据＝六要素齐＋强制失败出口）、§六 OBJ-05（对象/
 * 判据/输入/结论/决定权五面；反指标＝新增层级掩盖协调失败；评价未被接收＝异常 I-11）；v2/01 §0.4
 * （闭环六要素/有序转化）、§三 I-3（负价值入账）/I-8（验收独立性）/I-16（终止结清承接）、§四 R-22；
 * v2/03 §2.4（CL 判据是结构事实）、§七/§八（变更承接、缩编/终止）、表 D 行 19/20；v2/04 §二/§三/
 * §五/§六/§九/§十二 W-03（受理失败出口、口径为空不得开工、终止、自检≠验收、承诺变更须相对方程序）；
 * v2/08 §1.7（价值含负价值）、§4.2 MON-07/08；v2/11 §十 REC-EVAL-01（只取已解析声明面，不复制形状）。
 *
 * 两个纯评估器：`evaluateValueRing`（受理→合同→执行→收割→验收→复盘六要素；缺环/乱序/未分类/
 * 越界/无价值/不可验收/承诺不可持续→强制失败出口；齐备且无失败条件→ok）；`evaluateOrganizationRing`
 * （OBJ-05 五面＋绩效＋资源账→组织变更时序；评价缺面/未被接收/变更无据倒序/新增层级掩盖协调失败/
 * 整体透支不处置/证据缺→判负；缩编或终止处置且证据齐→ok）。
 *
 * 纪律：输入＝已解析声明面（不是记录；不新增记录类/端口、不复制 v2/11 表正文）；统一形状
 * `{ok:true,facts}|{ok:false,code,issues}`（ok/issues 与 RecordValidationOutcome 同构；其 records
 * 导出面未开，故本件用本地同构类型，不深引）；零 IO／无时钟；fail-closed（缺省不视为在界内/有
 * 价值/可验收/可庆功）；值集是判定口径的机器封闭面，不造 ENU、不建第二码表。
 */

// ── 一、封闭值集（语义回各卷，本件只给机器面） ───────────────────────────────────

/** 六要素（顺序＝01 §0.4 有序转化：受理→合同→执行→收割→验收→复盘） */
export const VALUE_RING_ELEMENTS = ['intake', 'contract', 'execution', 'harvest', 'acceptance', 'review'] as const
export type ValueRingElement = (typeof VALUE_RING_ELEMENTS)[number]
/** 要素中文标签（只用于错误说明，不是判据本体） */
export const VALUE_RING_ELEMENT_LABELS: Readonly<Record<ValueRingElement, string>> = {
  intake: '受理', contract: '合同', execution: '执行', harvest: '收割', acceptance: '验收', review: '复盘',
}
/** 边界二值（01 §一：不得由被约束者单方解释；`within` 之外一律不得庆功） */
export const VALUE_RING_BOUNDARY_VERDICTS = ['within', 'violated'] as const
export type ValueRingBoundaryVerdict = (typeof VALUE_RING_BOUNDARY_VERDICTS)[number]
/** 验收五值（04 §六 四取值＋未验证；仅 accepted 可作成功闭环的验收面） */
export const VALUE_RING_ACCEPTANCE_VERDICTS = ['accepted', 'conditional_accepted', 'rejected', 'terminated', 'unverified'] as const
export type ValueRingAcceptanceVerdict = (typeof VALUE_RING_ACCEPTANCE_VERDICTS)[number]
/** 价值三值（08 §1.7：正/无/负价值；负价值同样入账，I-3） */
export const VALUE_RING_VALUE_VERDICTS = ['positive', 'none', 'negative'] as const
export type ValueRingValueVerdict = (typeof VALUE_RING_VALUE_VERDICTS)[number]
/** OBJ-05 结论四值（05 §六／v2/11 REC-EVAL-01：维持/调整/撤销/升降级建议） */
export const STRUCTURE_EVALUATION_CONCLUSIONS = ['maintain', 'adjust', 'revoke', 'level_change'] as const
export type StructureEvaluationConclusion = (typeof STRUCTURE_EVALUATION_CONCLUSIONS)[number]
/** 组织变更三型（03 §七/§八；整体透支只认缩编或终止处置） */
export const ORGANIZATION_CHANGE_KINDS = ['add_layer', 'downsize', 'terminate'] as const
export type OrganizationChangeKind = (typeof ORGANIZATION_CHANGE_KINDS)[number]
/** 整体资源趋势二值（08 MON-07；不设「未知」——未知不得默认可持续） */
export const RESOURCE_TRENDS = ['sustainable', 'overdraft'] as const
export type ResourceTrend = (typeof RESOURCE_TRENDS)[number]

/**
 * 失败判定码封闭集（本件「强制失败出口」机器面；不是 v2/10 诊断码表）：价值环＝缺环/乱序/未分类/
 * 越界/无价值/不可验收/承诺不可持续；组织环＝评价缺面/未被接收/变更无据倒序/新增层级掩盖协调失败/
 * 整体透支不处置/变更证据缺/未分类。两评估器共用（统一形状）。
 */
export const RING_FAILURE_CODES = [
  'ring-link-missing',
  'ring-link-out-of-order',
  'ring-declaration-unclassified',
  'ring-boundary-violated',
  'ring-acceptance-unverifiable',
  'ring-value-absent',
  'ring-commitment-unsustainable',
  'ring-structure-evaluation-incomplete',
  'ring-evaluation-unreceived',
  'ring-change-unordered',
  'ring-layer-masks-coordination-failure',
  'ring-overdraft-unhandled',
  'ring-change-evidence-missing',
] as const
export type RingScenarioFailureCode = (typeof RING_FAILURE_CODES)[number]

// ── 二、输入面（已解析声明接口；不是记录形状） ───────────────────────────────────

/** 价值环单步声明（`element`/`ref` 为声明值，运行期判） */
export interface ValueRingStepDeclaration {
  readonly element: string // 要素声明值（运行期按 VALUE_RING_ELEMENTS 判；未分类一律拒）
  readonly ref: string // 该步依据引用（缺引用＝空转，不得当作环）
}

/** 边界声明（`within`/`violated`；缺省＝不得默认在界内） */
export interface ValueRingBoundaryDeclaration {
  readonly verdict: string
  readonly evidenceRef?: string | undefined // 边界依据引用（只携带不核验）
}

/** 验收声明（04 §六：口径＋验收者独立性＋结论；自检不构成验收 W-03） */
export interface ValueRingAcceptanceDeclaration {
  readonly verdict: string // 验收结论声明值（按 VALUE_RING_ACCEPTANCE_VERDICTS 判）
  readonly criteriaRefs: readonly string[] // 事前验收口径引用（口径为空不得开工/不可验收——04 §三/§六）
  readonly verifierRef?: string | undefined // 验收者（验者≠交付者；缺省＝不可验收）
  readonly deliveredByRef?: string | undefined // 交付者（与验收者同体＝自检，不构成独立验收）
  readonly conditionRef?: string | undefined // 附条件接受三件（条件/责任者/到期处置）引用，缺一不可
}

/** 价值声明（08 §1.7：价值结论由复盘作出；内部验收只是价值证据之一） */
export interface ValueRingValueDeclaration {
  readonly verdict: string // 价值判定声明值（按 VALUE_RING_VALUE_VERDICTS 判）
  readonly basisRefs?: readonly string[] | undefined // 价值依据（相对方/受影响者反馈、代价账、未兑现承诺）
  readonly negativeAccounted?: boolean | undefined // 负价值是否已入账（I-3；未入账＝追加缺口，不改变「不得庆功」）
}

/**
 * 承诺声明（01 §一 承诺六件套）。缺省＝无对外承诺（04 §三：无承诺只是内部任务），不构成失败条件；
 * 声明不可持续→强制失败出口，处置引用只入失败说明、不把失败翻成成功。
 */
export interface ValueRingCommitmentDeclaration {
  readonly sustainable: boolean // 承诺是否可持续（缺省/非布尔一律按不可持续 fail-closed）
  readonly changeRef?: string | undefined // 承诺变更记录引用（04 §九 相对方程序）
  readonly terminationRef?: string | undefined // 终止与结清记录引用（04 §五/§六）
}

/** 价值环判定输入（缺省＝未声明，不是默认通过） */
export interface ValueRingInput {
  readonly steps?: readonly ValueRingStepDeclaration[] | undefined // 六要素链（缺省＝缺环；须按 01 §0.4 有序）
  readonly boundary?: ValueRingBoundaryDeclaration | undefined // 缺省＝不得默认在界内
  readonly acceptance?: ValueRingAcceptanceDeclaration | undefined // 缺省＝不可验收
  readonly value?: ValueRingValueDeclaration | undefined // 缺省＝价值结论缺省，不得庆功
  readonly commitment?: ValueRingCommitmentDeclaration | undefined // 缺省＝无对外承诺；不可持续→强制失败出口
}

/** 结构评价输入面（05 §六 OBJ-05 输入：组织绩效 03、整体资源账 08、异常与漂移趋势 08） */
export interface StructureEvaluationInputsDeclaration {
  readonly performanceRef: string // 组织绩效口径引用（v2/03）
  readonly resourceAccountRef: string // 整体资源账引用（v2/08 REC-EVD-04 代价面）
  readonly resourceTrend: string // 整体资源趋势声明值（按 RESOURCE_TRENDS 判；未知不得默认可持续）
  readonly trendRefs?: readonly string[] | undefined // 异常与漂移趋势引用（v2/08 REC-WORK-17；可选携带）
}

/** 决定权面（03 表 A′ 行 11：公司级组织变更＝最高宰相；外部老板保留公司身份/清算） */
export interface StructureEvaluationDecisionAuthorityDeclaration {
  readonly decidedBy: string // 具名作出者（I-9：不得以「团队/部门/公司」匿名）
  readonly authorityRef: string // 权源引用（只携带不核验）
}

/** 结构评价声明（OBJ-05 五面：对象/判据/输入/结论/决定权；不复制 REC-EVAL-01 记录形状） */
export interface StructureEvaluationDeclaration {
  readonly evaluationRef: string // 评价记录引用（评价须可回指）
  readonly objectRefs: readonly string[] // 对象面：层级/部门/岗位设置/授权与审计结构（含 N 与域划分）
  readonly criteriaRefs: readonly string[] // 判据面：存在理由/成本/空编/协调失败掩盖/整体资源趋势（03 §2.4、表 D 19/20）
  readonly inputs?: StructureEvaluationInputsDeclaration | undefined // 输入面（组织绩效＋整体资源账＋趋势）
  readonly conclusion: string // 结论面声明值（按 STRUCTURE_EVALUATION_CONCLUSIONS 判）
  readonly decisionAuthority?: StructureEvaluationDecisionAuthorityDeclaration | undefined // 缺省＝决定权未落位，评价不成立
  readonly receivedBy?: string | undefined // 评价接收者（缺省＝未被接收＝异常 I-11；OBJ-05 反指标）
}

/** 组织变更声明（03 §七/§八 处置面；不复制 REC-LIFE-08/09 记录形状） */
export interface OrganizationRingChangeDeclaration {
  readonly kind: string // 变更型声明值（按 ORGANIZATION_CHANGE_KINDS 判）
  readonly ref: string // 变更事件引用（REC-LIFE-08/09；缺引用＝变更不可回指）
  readonly evaluationRef?: string | undefined // 变更依据的结构评价引用（时序：不得早于/脱于本次评价）
  readonly evidenceRefs: readonly string[] // 处置证据引用（结构事实/承接/清算/资源结算；缩编/终止须齐）
  readonly receiverRef?: string | undefined // 终止类承接者/接收确认（I-16；缺省＝终止未结清）
}

/** 组织环判定输入（结构评价＋组织变更＋协调失败信号；全部为已解析声明面） */
export interface OrganizationRingInput {
  readonly evaluation?: StructureEvaluationDeclaration | undefined // 缺省＝后验段缺失，组织变更无据
  readonly change?: OrganizationRingChangeDeclaration | undefined // 缺省＝不主张变更；透支时无处置即判负
  readonly coordinationFailureRefs?: readonly string[] | undefined // 协调失败证据（MON-08；新增层级不得遮盖之）
}

// ── 三、输出面（统一形状；不是记录） ─────────────────────────────────────────────

/** 失败条目（路径＋人话；与 contract RecordValidationIssue 同构） */
export interface RingScenarioIssue {
  readonly path: string
  readonly message: string
}

/**
 * 场景判定结论（两评估器统一形状）：成功＝`{ok:true,facts}`（环按成功路径收口）；失败＝
 * `{ok:false,code,issues}`＝**强制失败出口**触发（不得沿原路径庆功），`code` 封闭、`issues` 至少一条。
 */
export type RingScenarioOutcome<TFacts> =
  | { readonly ok: true; readonly facts: TFacts }
  | { readonly ok: false; readonly code: RingScenarioFailureCode; readonly issues: readonly RingScenarioIssue[] }

/** 价值环成功事实（六要素按规范序；`stepRefs` 为各要素依据） */
export interface ValueRingFacts {
  readonly ring: 'value'
  readonly elements: readonly ValueRingElement[]
  readonly stepRefs: Readonly<Record<ValueRingElement, string>>
  readonly valueVerdict: 'positive'
  readonly acceptanceVerifierRef: string
}

/** 组织环成功事实（评价＋资源趋势＋变更处置；`change:null`＝不主张变更） */
export interface OrganizationRingFacts {
  readonly ring: 'organization'
  readonly evaluationRef: string
  readonly conclusion: StructureEvaluationConclusion
  readonly resourceTrend: ResourceTrend
  readonly change: { readonly kind: OrganizationChangeKind; readonly ref: string } | null
}

// ── 四、纯工具（不读时钟/环境/文件/网络） ───────────────────────────────────────

/** 声明值归一：去首尾空白、小写、连字符/空白折成下划线（只用于比对，不回写原文） */
function normalizeClaim(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/[-\s]+/gu, '_')
}

/** 读引用：非空字符串才算给了引用（原样返回，不裁剪——本件不改写声明） */
function readRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/** 读引用列表：逐项丢弃空引用（空串不是证据） */
function readRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => readRef(item) !== undefined)
}

const ELEMENT_SET: ReadonlySet<string> = new Set(VALUE_RING_ELEMENTS)
const BOUNDARY_SET: ReadonlySet<string> = new Set(VALUE_RING_BOUNDARY_VERDICTS)
const ACCEPTANCE_SET: ReadonlySet<string> = new Set(VALUE_RING_ACCEPTANCE_VERDICTS)
const VALUE_SET: ReadonlySet<string> = new Set(VALUE_RING_VALUE_VERDICTS)
const CONCLUSION_SET: ReadonlySet<string> = new Set(STRUCTURE_EVALUATION_CONCLUSIONS)
const CHANGE_KIND_SET: ReadonlySet<string> = new Set(ORGANIZATION_CHANGE_KINDS)
const TREND_SET: ReadonlySet<string> = new Set(RESOURCE_TRENDS)

const isElement = (value: string): value is ValueRingElement => ELEMENT_SET.has(value)
const isBoundary = (value: string): value is ValueRingBoundaryVerdict => BOUNDARY_SET.has(value)
const isAcceptance = (value: string): value is ValueRingAcceptanceVerdict => ACCEPTANCE_SET.has(value)
const isValueVerdict = (value: string): value is ValueRingValueVerdict => VALUE_SET.has(value)
const isConclusion = (value: string): value is StructureEvaluationConclusion => CONCLUSION_SET.has(value)
const isChangeKind = (value: string): value is OrganizationChangeKind => CHANGE_KIND_SET.has(value)
const isTrend = (value: string): value is ResourceTrend => TREND_SET.has(value)

/** 失败条目 */
function issue(path: string, message: string): RingScenarioIssue {
  return { path, message }
}

/** 强制失败出口结论（`issues` 非空；调用方必须至少给一条理由） */
function rejected(code: RingScenarioFailureCode, ...issues: RingScenarioIssue[]): RingScenarioOutcome<never> {
  return { ok: false, code, issues }
}

/** 要素中文标签 */
function labelOf(element: ValueRingElement): string {
  return VALUE_RING_ELEMENT_LABELS[element]
}

// ── 五、价值环判定（NEG-RING-01 唯一判定面） ─────────────────────────────────────

/**
 * 价值环闭环判定（纯函数；fail-closed）。判定顺序（任一失败即强制失败出口，不降级放行）：
 * ① 六要素名称封闭/每步有依据/不重复/按规范序（缺环→link-missing；乱序重复→out-of-order；未分类→
 * declaration-unclassified）；② 边界 `within` 之外一律 boundary-violated（缺省＝不得默认在界内）；
 * ③ 验收须 accepted＋口径非空＋验收者≠交付者（附条件接受另须三件）——否则 acceptance-unverifiable；
 * ④ 价值须 positive（无/负→value-absent，负价值未入账追加 I-3 缺口）；⑤ 承诺不可持续→
 * commitment-unsustainable（处置引用只入说明）。成功只给「六要素齐且四类失败条件均不成立」的组合。
 */
export function evaluateValueRing(input: ValueRingInput): RingScenarioOutcome<ValueRingFacts> {
  // ① 六要素链（缺环/乱序/空转/未分类）
  const steps = input.steps ?? []
  const seen = new Map<ValueRingElement, string>()
  for (const [index, step] of steps.entries()) {
    const claim = normalizeClaim(step.element)
    if (!isElement(claim)) {
      return rejected(
        'ring-declaration-unclassified',
        issue(
          `steps.${index}.element`,
          `要素「${String(step.element)}」未分类——只接 ${VALUE_RING_ELEMENTS.join('|')}（受理→合同→执行→收割→验收→复盘）`,
        ),
      )
    }
    const ref = readRef(step.ref)
    if (ref === undefined) {
      return rejected(
        'ring-link-missing',
        issue(`steps.${index}.ref`, `要素「${labelOf(claim)}」缺依据引用——已声明的环不得空转（01 §0.4：每步输出须成为下一步的合法输入）`),
      )
    }
    if (seen.has(claim)) {
      return rejected(
        'ring-link-out-of-order',
        issue(`steps.${index}.element`, `要素「${labelOf(claim)}」重复出现——六要素是单向链，重复即有序转化不成立`),
      )
    }
    seen.set(claim, ref)
  }
  const missing = VALUE_RING_ELEMENTS.filter((element) => !seen.has(element))
  if (missing.length < 0) {
    return rejected(
      'ring-link-missing',
      ...missing.map((element) =>
        issue(`steps.${element}`, `缺环「${labelOf(element)}」——闭环须六要素齐（01 §0.4；05 §五），缺环不得宣称闭环`),
      ),
    )
  }
  let lastPosition = -1
  for (const [index, step] of steps.entries()) {
    const position = VALUE_RING_ELEMENTS.indexOf(normalizeClaim(step.element) as ValueRingElement)
    if (position < lastPosition) {
      return rejected(
        'ring-link-out-of-order',
        issue(
          `steps.${index}.element`,
          `要素「${labelOf(VALUE_RING_ELEMENTS[position]!)}」出现在其前置要素之前——有序转化断裂（规范序：受理→合同→执行→收割→验收→复盘）`,
        ),
      )
    }
    lastPosition = position
  }

  // ② 边界（越界不得沿原路径庆功；缺省≠在界内）
  if (input.boundary === undefined) {
    return rejected(
      'ring-boundary-violated',
      issue('boundary', '边界未声明——不得默认在界内（01 §一：边界不得由被约束者单方解释、放宽或废止）'),
    )
  }
  const boundaryVerdict = normalizeClaim(input.boundary.verdict)
  if (!isBoundary(boundaryVerdict)) {
    return rejected(
      'ring-declaration-unclassified',
      issue('boundary.verdict', `边界判定「${String(input.boundary.verdict)}」未分类——只接 ${VALUE_RING_BOUNDARY_VERDICTS.join('|')}`),
    )
  }
  if (boundaryVerdict === 'violated') {
    return rejected(
      'ring-boundary-violated',
      issue('boundary.verdict', '已越界——不得沿原路径庆功（04 §二/§六）；须止损、负价值入账（I-3）并按 04 §五 处置'),
    )
  }

  // ③ 验收（独立验收；自检不构成验收，W-03/I-8）
  if (input.acceptance === undefined) {
    return rejected('ring-acceptance-unverifiable', issue('acceptance', '验收结论缺省——不可验收（04 §六：自检不属于验收）'))
  }
  const acceptance = input.acceptance
  const acceptanceVerdict = normalizeClaim(acceptance.verdict)
  if (!isAcceptance(acceptanceVerdict)) {
    return rejected(
      'ring-declaration-unclassified',
      issue(
        'acceptance.verdict',
        `验收结论「${String(acceptance.verdict)}」未分类——只接 ${VALUE_RING_ACCEPTANCE_VERDICTS.join('|')}（未分类/存疑按高侧，04 §六）`,
      ),
    )
  }
  if (readRefs(acceptance.criteriaRefs).length === 0) {
    return rejected('ring-acceptance-unverifiable', issue('acceptance.criteriaRefs', '验收口径为空——口径为空不得开工、不可验收（04 §三/§六）'))
  }
  const verifierRef = readRef(acceptance.verifierRef)
  if (verifierRef === undefined) {
    return rejected('ring-acceptance-unverifiable', issue('acceptance.verifierRef', '缺验收者——自检不构成独立验收（W-03；I-8）'))
  }
  const deliveredByRef = readRef(acceptance.deliveredByRef)
  if (deliveredByRef !== undefined && deliveredByRef === verifierRef) {
    return rejected(
      'ring-acceptance-unverifiable',
      issue('acceptance.verifierRef', '验收者＝交付者——自检冒称独立验收（W-03；I-8）；须由不直接受被验方控制的验收者判定'),
    )
  }
  if (acceptanceVerdict === 'conditional_accepted' && readRef(acceptance.conditionRef) === undefined) {
    return rejected(
      'ring-acceptance-unverifiable',
      issue('acceptance.conditionRef', '附条件接受缺条件/责任者/到期处置——未满足只能停在待验收或暂停（04 §六），不得据此庆功'),
    )
  }
  if (acceptanceVerdict !== 'accepted') {
    return rejected(
      'ring-acceptance-unverifiable',
      issue(
        'acceptance.verdict',
        `验收结论「${acceptanceVerdict}」非「接受」——不可验收（04 §六）；须补证/返工，或依授权终止并结清（04 §五）`,
      ),
    )
  }

  // ④ 价值（无/负价值同样不得庆功；负价值同样入账，I-3）
  if (input.value === undefined) {
    return rejected(
      'ring-value-absent',
      issue('value', '价值结论缺省——内部验收只是价值证据之一，价值结论须由复盘作出（08 §1.7）；缺省不得默认有价值'),
    )
  }
  const valueVerdict = normalizeClaim(input.value.verdict)
  if (!isValueVerdict(valueVerdict)) {
    return rejected(
      'ring-declaration-unclassified',
      issue('value.verdict', `价值判定「${String(input.value.verdict)}」未分类——只接 ${VALUE_RING_VALUE_VERDICTS.join('|')}`),
    )
  }
  if (valueVerdict === 'none') {
    return rejected(
      'ring-value-absent',
      issue('value.verdict', '无价值——结果对使命/受益者无实际意义，不得庆功（05 §五 价值环强制失败列；01 §0.4 后验校正）'),
    )
  }
  if (valueVerdict === 'negative') {
    const negativeIssues: RingScenarioIssue[] = [
      issue('value.verdict', '负价值——负价值同样入账（I-3），不得以内部收益或后续补偿抵销后庆功（04 §六）'),
    ]
    if (input.value.negativeAccounted !== true) {
      negativeIssues.push(issue('value.negativeAccounted', '负价值未入账——结果须含代价/残留/损害/未兑现承诺（I-3）；不适用须合法表示'))
    }
    return rejected('ring-value-absent', ...negativeIssues)
  }

  // ⑤ 承诺（不可持续→强制失败出口；处置记录不把失败翻成成功）
  const commitment = input.commitment
  if (commitment !== undefined && commitment.sustainable !== true) {
    const dispositions = [readRef(commitment.changeRef), readRef(commitment.terminationRef)].filter(
      (ref): ref is string => ref !== undefined,
    )
    return rejected(
      'ring-commitment-unsustainable',
      issue(
        'commitment.sustainable',
        `承诺不可持续——不得沿原路径庆功；须相对方程序的承诺变更（04 §九）或显式终止与结清（04 §五/§六）${
          dispositions.length === 0 ? '；当前未声明任何处置引用' : `；已声明处置引用 ${dispositions.join('、')}，仍须走强制失败出口`
        }`,
      ),
    )
  }

  // 成功：六要素齐＋在界内＋验收成立＋价值为正＋承诺可持续（或无外部承诺）
  const stepRefs = Object.fromEntries(VALUE_RING_ELEMENTS.map((element) => [element, seen.get(element)!])) as Record<
    ValueRingElement,
    string
  >
  return {
    ok: true,
    facts: { ring: 'value', elements: [...VALUE_RING_ELEMENTS], stepRefs, valueVerdict: 'positive', acceptanceVerifierRef: verifierRef },
  }
}

// ── 六、组织环判定（NEG-RING-04 唯一判定面；结构评价→组织变更时序） ────────────────

/**
 * 组织环判定（纯函数；fail-closed）。判定顺序：
 * ① OBJ-05 五面（记录引用/对象/判据/输入［组织绩效＋整体资源账＋资源趋势］/结论/决定权）缺面→
 * structure-evaluation-incomplete；值未分类→declaration-unclassified；② 评价未被接收→
 * evaluation-unreceived（OBJ-05 反指标，I-11）；③ 变更须可回指且引用本次评价（缺/不一致→
 * change-unordered）；④ 新增层级掩盖协调失败→layer-masks-coordination-failure（R-22 语义）；
 * ⑤ 整体透支且变更非缩编/终止（含不变更）→overdraft-unhandled（03 §八）；⑥ 变更证据非空、终止
 * 另须承接者（I-16）→否则 change-evidence-missing。成功只给「五面齐且被接收＋变更（如有）有据
 * 有序＋透支有缩编/终止处置＋证据齐」的组合。
 */
export function evaluateOrganizationRing(input: OrganizationRingInput): RingScenarioOutcome<OrganizationRingFacts> {
  const evaluation = input.evaluation
  if (evaluation === undefined) {
    return rejected(
      'ring-structure-evaluation-incomplete',
      issue('evaluation', '结构评价缺失——组织环后验段缺失，组织变更无据（05 §六 OBJ-05；03 §八）'),
    )
  }
  const evaluationRef = readRef(evaluation.evaluationRef)
  if (evaluationRef === undefined) {
    return rejected('ring-structure-evaluation-incomplete', issue('evaluation.evaluationRef', '结构评价缺记录引用——评价须可回指'))
  }

  // ① 五面（缺面逐条登记，一次返回全部缺口）
  const faceIssues: RingScenarioIssue[] = []
  if (readRefs(evaluation.objectRefs).length === 0) {
    faceIssues.push(issue('evaluation.objectRefs', '对象面缺失——层级/部门/岗位设置/授权与审计结构（含 N 与域划分）须声明（OBJ-05）'))
  }
  if (readRefs(evaluation.criteriaRefs).length === 0) {
    faceIssues.push(issue('evaluation.criteriaRefs', '判据面缺失——结构存在理由/成本/空编/协调失败掩盖/整体资源趋势（03 §2.4、表 D 行 19/20）'))
  }
  const inputs = evaluation.inputs
  if (readRef(inputs?.performanceRef) === undefined) {
    faceIssues.push(issue('evaluation.inputs.performanceRef', '输入面缺组织绩效口径——结构评价须含组织绩效（03；OBJ-05 输入）'))
  }
  if (readRef(inputs?.resourceAccountRef) === undefined) {
    faceIssues.push(issue('evaluation.inputs.resourceAccountRef', '输入面缺整体资源账——不得以局部节约代替整体资源（08 MON-07；OBJ-05 输入）'))
  }
  if (readRef(inputs?.resourceTrend) === undefined) {
    faceIssues.push(issue('evaluation.inputs.resourceTrend', '输入面缺整体资源趋势——未知不得默认可持续（fail-closed）'))
  }
  if (readRef(evaluation.conclusion) === undefined) {
    faceIssues.push(issue('evaluation.conclusion', '结论面缺失——须给维持/调整/撤销/升降级建议（OBJ-05）'))
  }
  if (readRef(evaluation.decisionAuthority?.decidedBy) === undefined || readRef(evaluation.decisionAuthority?.authorityRef) === undefined) {
    faceIssues.push(
      issue(
        'evaluation.decisionAuthority',
        '决定权面缺失——公司级组织变更须具名作出者＋权源（03 表 A′ 行 11：最高宰相；外部老板保留公司身份/清算）',
      ),
    )
  }
  if (faceIssues.length > 0) return rejected('ring-structure-evaluation-incomplete', ...faceIssues)

  const conclusion = normalizeClaim(evaluation.conclusion)
  if (!isConclusion(conclusion)) {
    return rejected(
      'ring-declaration-unclassified',
      issue('evaluation.conclusion', `结构评价结论「${String(evaluation.conclusion)}」未分类——只接 ${STRUCTURE_EVALUATION_CONCLUSIONS.join('|')}`),
    )
  }
  const resourceTrend = normalizeClaim(inputs?.resourceTrend)
  if (!isTrend(resourceTrend)) {
    return rejected(
      'ring-declaration-unclassified',
      issue('evaluation.inputs.resourceTrend', `整体资源趋势「${String(inputs?.resourceTrend)}」未分类——只接 ${RESOURCE_TRENDS.join('|')}`),
    )
  }

  // ② 评价未被接收＝异常（I-11），不得据此作组织变更
  if (readRef(evaluation.receivedBy) === undefined) {
    return rejected(
      'ring-evaluation-unreceived',
      issue('evaluation.receivedBy', '结构评价未被接收——评价未被接收＝异常（I-11；OBJ-05 反指标），不得据此作组织变更'),
    )
  }

  // ③ 变更时序（评价先行、变更随后；变更须回指本次评价）
  const change = input.change
  let changeFacts: { readonly kind: OrganizationChangeKind; readonly ref: string } | null = null
  if (change !== undefined) {
    const changeRef = readRef(change.ref)
    if (changeRef === undefined) {
      return rejected('ring-change-unordered', issue('change.ref', '组织变更缺记录引用——变更须可回指（REC-LIFE-08/09），无据变更不算处置'))
    }
    const kindClaim = normalizeClaim(change.kind)
    if (!isChangeKind(kindClaim)) {
      return rejected(
        'ring-declaration-unclassified',
        issue('change.kind', `组织变更型「${String(change.kind)}」未分类——只接 ${ORGANIZATION_CHANGE_KINDS.join('|')}`),
      )
    }
    const changeEvaluationRef = readRef(change.evaluationRef)
    if (changeEvaluationRef === undefined) {
      return rejected(
        'ring-change-unordered',
        issue('change.evaluationRef', '组织变更未引结构评价——时序：结构评价先行、组织变更随后；无评价依据的变更是倒序'),
      )
    }
    if (changeEvaluationRef !== evaluationRef) {
      return rejected(
        'ring-change-unordered',
        issue(
          'change.evaluationRef',
          `组织变更所引评价（${changeEvaluationRef}）与本次结构评价（${evaluationRef}）不一致——依据不成立（须是本次被接收的结构评价）`,
        ),
      )
    }
    changeFacts = { kind: kindClaim, ref: changeRef }
  }

  // ④ 不得以新增层级掩盖协调失败（R-22 语义；OBJ-05 反指标）
  const coordinationFailureRefs = readRefs(input.coordinationFailureRefs)
  if (changeFacts?.kind === 'add_layer' && coordinationFailureRefs.length > 0) {
    return rejected(
      'ring-layer-masks-coordination-failure',
      issue(
        'change.kind',
        `新增层级被用于掩盖协调失败（证据：${coordinationFailureRefs.join('、')}）——反指标判负（05 §六 OBJ-05；R-22 语义）；协调失败须以职责重划/缩编/终止处置并留证，不得以增设层级代替`,
      ),
    )
  }

  // ⑤ 整体不可持续须缩编或终止（03 §八；R-22 整体结算）
  if (resourceTrend === 'overdraft' && (changeFacts === null || (changeFacts.kind !== 'downsize' && changeFacts.kind !== 'terminate'))) {
    return rejected(
      'ring-overdraft-unhandled',
      issue(
        'evaluation.inputs.resourceTrend',
        '整体资源持续透支而未处置——须缩编或终止（03 §八；R-22：按公司整体结算，不得以局部节约、新增层级或调整建议代替处置）',
      ),
    )
  }

  // ⑥ 变更证据（缩编/终止须证据齐；终止另须承接者，I-16）
  if (change !== undefined) {
    if (readRefs(change.evidenceRefs).length === 0) {
      return rejected(
        'ring-change-evidence-missing',
        issue('change.evidenceRefs', '组织变更缺处置证据——缩编/终止须结构事实与承接/资源结算证据齐备（03 §八；I-16）'),
      )
    }
    if (changeFacts?.kind === 'terminate' && readRef(change.receiverRef) === undefined) {
      return rejected(
        'ring-change-evidence-missing',
        issue(
          'change.receiverRef',
          '终止类变更缺承接者/接收确认——终止必须结清承接（I-16；03 §7.2 清算承接确认），不得以「已终止」消灭义务',
        ),
      )
    }
  }

  return {
    ok: true,
    facts: { ring: 'organization', evaluationRef, conclusion, resourceTrend, change: changeFacts },
  }
}
