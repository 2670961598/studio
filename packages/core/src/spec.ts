/**
 * spec —— 公共规范原子：诊断形状与封闭码表、标量与标识、版本解析、规则档规格投影
 *
 * 依据（MIG-03 / IMPL-03-07；docs/plan/05 该单领土与验收口径）：
 *   - v2/10 §八（诊断形状 `{code, severity, phase, location, messageKey, messageArgs,
 *     subjectRef?}` 与最小封闭码表；同一 code 不得跨 phase 复用——本件以
 *     `DIAGNOSTIC_CODE_PHASES` 单点承载，任何模块造码只能走 `makeDiagnostic`，
 *     未登记码在类型层与运行层双拒）；
 *   - v2/09 ENU-89（摘要 kind）、ENU-91（版本轴七 token）、ENU-92（版本/档状态三值）、
 *     ENU-93（求值结果四值）、ENU-94（求值封闭类型集九型）、ENU-96/97（severity/phase）、
 *     ENU-104（限额机器名七＋三）、ENU-105（求值结构块值）、ENU-106（Unicode 归一版本）；
 *   - v2/10 §1.1 标量族表（SCH-SYN-01）与 §1.3（引用钉精确版本，禁「当前最新」）、
 *     §2.8（ENC-08 摘要结构）、§5.1（轴 token）、§6.2 RULE-01（档＝语言不是单条规则）、
 *     §6.3（limitsApplied 七项可收紧＋档内固定三项、patternModel、determinism）；
 *   - v2/16 逐文件蓝图「新增（目标）：resources/spec/authority 子域」。
 *
 * 本件只做**纯投影**：形状、字面量、解析与判定；不做 IO、不读宿主环境、不持有状态。
 * 纪律：本件是 v2/09 字面量的**引用处**，不是第二登记处——新增/改义必须回 v2/09 登记，
 *       注释里的 ENU/码号即登记坐标；不得在此就地发明封闭值集。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、诊断（v2/10 §八；值集 ENU-96/97）
// ─────────────────────────────────────────────────────────────────────────────

/** 诊断严重度（值集唯一主表 v2/09 ENU-96：`error`｜`warning`｜`info`） */
export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** 诊断相位七值（值集唯一主表 v2/09 ENU-97；同一 code 不得跨相位复用） */
export type DiagnosticPhase =
  | 'parse'
  | 'structure'
  | 'typecheck'
  | 'inputBinding'
  | 'eval'
  | 'limit'
  | 'policy'

/** 诊断说明（v2/10 §八形状；输出不是被保存的业务事实，记录侧理由归 v2/11） */
export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly severity: DiagnosticSeverity
  readonly phase: DiagnosticPhase
  readonly location: string
  readonly messageKey: string
  readonly messageArgs: readonly (string | number | boolean)[]
  readonly subjectRef?: string
}

/** ENC 域码（v2/10 §八；封闭：未列出的码本域不得使用） */
export type EncDiagnosticCode =
  | 'E-ENC-001'
  | 'E-ENC-002'
  | 'E-ENC-003'
  | 'E-ENC-004'
  | 'E-ENC-005'

/**
 * SCH 域码（v2/10 §八字面）。**本件不纳入封闭表**：§八给 E-SCH-003/005 的相位写作
 * `refResolve`，而相位值集唯一主表 ENU-97 七值里没有 `refResolve`——两处字面不自洽，
 * 依「不新增枚举值集」纪律在此**只登记张力、不代决**（缺口登记见收口报告；schema 面
 * 实现归 contract/company，不经本件造码）。
 */
export type SchDiagnosticCode =
  | 'E-SCH-001'
  | 'E-SCH-002'
  | 'E-SCH-003'
  | 'E-SCH-004'
  | 'E-SCH-005'
  | 'W-SCH-001'
  | 'W-SCH-002'
  | 'W-SCH-003'

/** RULE 域码（v2/10 §八；E-RULE-001..010 ＋ W-RULE-001/002 封闭） */
export type RuleDiagnosticCode =
  | 'E-RULE-001'
  | 'E-RULE-002'
  | 'E-RULE-003'
  | 'E-RULE-004'
  | 'E-RULE-005'
  | 'E-RULE-006'
  | 'E-RULE-007'
  | 'E-RULE-008'
  | 'E-RULE-009'
  | 'E-RULE-010'
  | 'W-RULE-001'
  | 'W-RULE-002'

/**
 * 封闭码并集（v2/10 §八中**相位可判**的 17 码：ENC-001..005 ＋ RULE 全 12 码）。
 * 本件是唯一登记点，其它件不得增码；SCH 八码因 §八/ENU-97 的 `refResolve` 相位张力
 * 不入表（见 `SchDiagnosticCode` 注）。
 */
export type DiagnosticCode = EncDiagnosticCode | RuleDiagnosticCode

/**
 * 码 → 相位（v2/10 §八逐行照录；同一 code 不得跨相位复用）。
 * 造码函数据此填 phase，避免调用方自报相位造成「一号多相位」。
 */
export const DIAGNOSTIC_CODE_PHASES: Readonly<Record<DiagnosticCode, DiagnosticPhase>> = {
  'E-ENC-001': 'structure',
  'E-ENC-002': 'parse',
  'E-ENC-003': 'typecheck',
  'E-ENC-004': 'parse',
  'E-ENC-005': 'structure',
  'E-RULE-001': 'parse',
  'E-RULE-002': 'parse',
  'E-RULE-003': 'typecheck',
  'E-RULE-004': 'typecheck',
  'E-RULE-005': 'inputBinding',
  'E-RULE-006': 'inputBinding',
  'E-RULE-007': 'eval',
  'E-RULE-008': 'limit',
  'E-RULE-009': 'limit',
  'E-RULE-010': 'policy',
  'W-RULE-001': 'policy',
  'W-RULE-002': 'typecheck',
}

/** 运行层封闭校验：未登记码即不在 v2/10 §八 封闭集内，调用方不得使用 */
export function isClosedDiagnosticCode(code: string): code is DiagnosticCode {
  return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_CODE_PHASES, code)
}

/**
 * 造诊断（封闭码表的唯一入口）：
 *   severity 由码前缀定（`E-`＝error、`W-`＝warning），phase 由 §八码表定，二者都不由
 *   调用方自由填写——「一号一义、一码一相位」是机制不是自律（v2/10 §6.4/§八）。
 */
export function makeDiagnostic(
  code: DiagnosticCode,
  location: string,
  messageKey: string,
  messageArgs: readonly (string | number | boolean)[] = [],
): Diagnostic {
  return {
    code,
    severity: code.startsWith('W-') ? 'warning' : 'error',
    phase: DIAGNOSTIC_CODE_PHASES[code],
    location,
    messageKey,
    messageArgs,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、标量、标识与 JSON Pointer（v2/10 §1.1/§1.2；JSON Pointer＝RFC 6901）
// ─────────────────────────────────────────────────────────────────────────────

/** 标量族（v2/10 §1.1 SCH-SYN-01 十三行；本件只列机器名，语义回卷不重述） */
export const SCALAR_FAMILIES = [
  'text',
  'token',
  'dotid',
  'integer',
  'decimal',
  'boolean',
  'timestamp',
  'duration',
  'semver',
  'enumRef',
  'list',
  'record',
  'null',
] as const

/** 标量族机器名（值集来源见上；`SCALAR_FAMILIES` 的长度即封闭性断言面） */
export type ScalarFamily = (typeof SCALAR_FAMILIES)[number]

const TOKEN_RE = /^[a-z][a-z0-9-]{0,63}$/

/** `token`（v2/10 §1.1：小写 ASCII `[a-z][a-z0-9-]{0,63}`，无前后空格、无大写） */
export function isToken(text: string): boolean {
  return TOKEN_RE.test(text)
}

/** `dotid`（v2/10 §1.1/§1.2：一至四段，段间 `.`，每段为 token；裸 `/` 是 qid 不是 dotid） */
export function isDotid(text: string): boolean {
  const parts = text.split('.')
  return parts.length >= 1 && parts.length <= 4 && parts.every((part) => isToken(part))
}

/** JSON Pointer（RFC 6901；v2/10 §1.1 组合语义：字段路径与诊断定位统一此写法） */
export function isJsonPointer(text: string): boolean {
  if (text === '') return true
  if (!text.startsWith('/')) return false
  return /^(?:\/(?:[^~/]|~0|~1)*)+$/.test(text)
}

/** 解 JSON Pointer 为段列表（非法形态返回 null；`~1`→`/`、`~0`→`~`） */
export function parseJsonPointer(text: string): string[] | null {
  if (!isJsonPointer(text)) return null
  if (text === '') return []
  return text.slice(1).split('/').map((seg) => seg.replaceAll('~1', '/').replaceAll('~0', '~'))
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、semver 与版本轴（v2/10 §1.1 semver 行、§1.3、§5.1；ENU-91）
// ─────────────────────────────────────────────────────────────────────────────

/** 版本轴七 token（值集唯一主表 v2/09 ENU-91；引用必须「轴 token＋版本」） */
export const VERSION_AXES = [
  'core',
  'rule-profile',
  'company-revision',
  'binding-archive',
  'asset-lock',
  'framework-impl',
  'record-format',
] as const

/** 版本轴 token（语义回 v2/10 §5.1；本件不重述轴语义） */
export type VersionAxis = (typeof VERSION_AXES)[number]

/** 解出的 semver（预发布/构建元数据保留为标识符列表；构建元数据不参与优先级） */
export interface Semver {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
  readonly build: readonly string[]
}

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?(?:\+((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?$/
const NUMERIC_ID_RE = /^(?:0|[1-9]\d*)$/

/**
 * 解析 semver（v2/10 §1.1：三段 MAJOR.MINOR.PATCH，可带预发布与构建元数据）。
 * 通配/脱字符/波浪号/「latest」不是 semver（§1.3：包管理器语法只能在绑定边界映射）。
 */
export function parseSemver(text: string): Semver | null {
  const match = SEMVER_RE.exec(text)
  if (match === null) return null
  const [, major, minor, patch, prerelease, build] = match
  if (major === undefined || minor === undefined || patch === undefined) return null
  const pre = prerelease === undefined ? [] : prerelease.split('.')
  // 预发布数字段不得有前导零（semver §9）；非法即不解析（不是「尽量解析」）
  if (pre.some((id) => /^\d+$/.test(id) && !NUMERIC_ID_RE.test(id))) return null
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre,
    build: build === undefined ? [] : build.split('.'),
  }
}

/** 严格精确版本引用（禁「当前最新」与通配；v2/10 §1.3） */
export function isExactVersionRef(text: string): boolean {
  return parseSemver(text) !== null
}

function compareIdentifier(a: string, b: string): number {
  const aNum = NUMERIC_ID_RE.test(a)
  const bNum = NUMERIC_ID_RE.test(b)
  if (aNum && bNum) {
    const left = BigInt(a)
    const right = BigInt(b)
    return left === right ? 0 : left < right ? -1 : 1
  }
  if (aNum) return -1 // 数字标识符优先级低于非数字标识符
  if (bNum) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** semver 优先级比较（v2/10 §1.1：构建元数据不参与优先级；预发布 < 同段正式版） */
export function compareSemver(a: Semver, b: Semver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i += 1) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    if (left === undefined) return -1 // 前缀相同者更短＝更低
    if (right === undefined) return 1
    const verdict = compareIdentifier(left, right)
    if (verdict !== 0) return verdict
  }
  return 0
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、摘要结构（v2/10 §2.8 ENC-08；kind 值集 ENU-89）与规范化身份
// ─────────────────────────────────────────────────────────────────────────────

/** 摘要 kind（值集唯一主表 v2/09 ENU-89：`byte`｜`semantic`） */
export type DigestKind = 'byte' | 'semantic'

/** 摘要算法（登记制，至少 `sha-256`——本实现只产/只认这一种；值域外即结构违规） */
export type DigestAlgorithm = 'sha-256'

/**
 * 摘要结构八字段中的判定面（v2/10 §2.8）：
 *   `canonicalizationId`/`canonicalizationVersion` 仅 kind=semantic 必填；
 *   byteDigest 出现规范化身份即拒收（E-ENC-001）。`computedAt` 仅诊断，不入本结构。
 */
export interface DigestFace {
  readonly algorithm: DigestAlgorithm
  readonly value: string
  readonly kind: DigestKind
  readonly canonicalizationId?: string
  readonly canonicalizationVersion?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、规则档规格（v2/10 §6.1-§6.3；ENU-92/93/104/105/106）
// ─────────────────────────────────────────────────────────────────────────────

/** 档状态三值（ENU-92；注释即登记坐标） */
export const PROFILE_STATUSES = ['defined', 'vectors-published', 'supported'] as const

/** 档状态（ENU-92；`studio-next.jcs@1` 当前＝`vectors-published`） */
export type ProfileStatus = (typeof PROFILE_STATUSES)[number]

/** 求值结果四值（值集唯一主表 v2/09 ENU-93；unknown＝输入不足、refused＝求值中止） */
export const EVAL_OUTCOMES = ['true', 'false', 'unknown', 'refused'] as const

/** 求值结果（ENU-93；四值不得合并，refused 不得读成 false） */
export type EvalOutcome = (typeof EVAL_OUTCOMES)[number]

/** 政策结论四态（值集唯一主表 v2/09 ENU-31；判定顺序 prohibited→reserved→permitted→uncovered） */
export const POLICY_STATES = ['permitted', 'reserved', 'prohibited', 'uncovered'] as const

/** 政策结论（ENU-31；unknown 按 v2/10 §6.2 RULE-05 方向表处理） */
export type PolicyState = (typeof POLICY_STATES)[number]

/** 限额机器名·七项可收紧（值集唯一主表 v2/09 ENU-104；入 limitsApplied） */
export const LIMITS_APPLIED_NAMES = [
  'maxNodes',
  'maxDepth',
  'maxListItems',
  'maxTextCodepoints',
  'maxSignificantDigits',
  'maxScale',
  'maxEvalSteps',
] as const

/** limitsApplied 机器名（ENU-104；生效值＝min(档内声明, 调用侧收紧)） */
export type LimitsAppliedName = (typeof LIMITS_APPLIED_NAMES)[number]

/** 七项可收紧限额（ENU-104；RULE-06） */
export type LimitsApplied = { readonly [name in LimitsAppliedName]: number }

/** 档内固定三项（ENU-104；随 profileRef 锁定，不入 limitsApplied） */
export const FIXED_LIMIT_NAMES = [
  'maxPatternInputCodepoints',
  'maxPatternSteps',
  'maxQuantifierNesting',
] as const

/** 档内固定限额机器名（ENU-104） */
export type FixedLimitName = (typeof FIXED_LIMIT_NAMES)[number]

/** 档内固定三项限额（ENU-104；不在 limitsApplied 回报） */
export type FixedLimits = { readonly [name in FixedLimitName]: number }

/** 匹配模型（ENU-105：唯一值 `linear-nfa`——实现可用任何算法，接受/拒绝必须与线性自动机一致） */
export type MatchingModel = 'linear-nfa'

/** 锚定（ENU-105：唯一值 `full-match`——整串锚定） */
export type Anchoring = 'full-match'

/** 字符串比较（ENU-105：`codepoint`｜`nfc`；nfc 必须钉 Unicode 版本） */
export type StrComparison = 'codepoint' | 'nfc'

/** 舍入（ENU-105：`half-even` 缺省｜`floor`｜`ceiling`） */
export type DecimalRounding = 'half-even' | 'floor' | 'ceiling'

/** 结构块 patternModel（v2/10 §6.3；caseSensitivity 是档声明参数，禁内联开关） */
export interface PatternModel {
  readonly matchingModel: MatchingModel
  readonly anchoring: Anchoring
  readonly caseSensitive: boolean
  readonly maxQuantifierBound: number
}

/** 结构块 determinism（v2/10 §6.3；禁宿主时间/时区/环境/区域/随机/网络/文件/模型） */
export interface DeterminismBlock {
  readonly unicodeVersion: string
  readonly linebreakDef: string
  readonly strComparison: StrComparison
  readonly decimalContext: {
    readonly precision: number
    readonly rounding: DecimalRounding
  }
}

/** Unicode 归一钉版（值集唯一主表 v2/09 ENU-106；变更走 core 轴 minor） */
export const UNICODE_VERSION = 'Unicode 15.1.0'

/** 求值用例集引用（v2/10 §6.5：档必带 caseSetRefs，含拒绝用例；无用例的档不得跨实现声明支持） */
export interface CaseSetRef {
  readonly setId: string
  readonly version: string
  readonly digest: DigestFace
}

/** 档引用（v2/10 §6.5 规则引用结构；`digest` 必须是 semanticDigest） */
export interface RuleProfileRef {
  readonly profileId: string
  readonly version: string
  readonly digest: DigestFace
}

/**
 * 规则求值档规格（v2/10 §6.2 RULE-01：档＝语言，不是单条规则——同一档服务多条表达式，
 * 档不携带具体表达式与输入声明）。本形状是 `typecheckRuleProfile` 的**输入形状**：
 * 一切字段在型别上都是「已声明」，但值是 `unknown` 侧校验后收窄（类型门不是数据门）。
 */
export interface RuleProfileSpec {
  readonly profileId: string
  readonly version: string
  readonly status: ProfileStatus
  readonly semanticDigest: DigestFace
  /** 档声明的算子全集（§6.2 RULE-06：档外算子拒收 E-RULE-002） */
  readonly operators: readonly string[]
  readonly limits: {
    readonly ceiling: LimitsApplied
    readonly fixed: FixedLimits
  }
  readonly patternModel: PatternModel
  readonly determinism: DeterminismBlock
  readonly caseSetRefs: readonly CaseSetRef[]
  /**
   * 档声明的宿主读取面（缺省＝无）。非空即档不合法（RULE-08：禁读时间/时区/环境/
   * 主机名/区域设置/网络/随机/文件/进程/模型）；本字段存在的意义是让「违规档」有
   * 可判定的输入形状，而不是给实现留开关。
   */
  readonly ambientReads?: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 六、求值封闭类型集（v2/10 §6.2 RULE-04；值集唯一主表 v2/09 ENU-94 九型）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 求值类型（ENU-94：`Bool`｜`Int`｜`Dec(s)`｜`Str`｜`Ts`｜`Dur`｜`Enum(vocab,version)`｜
 * `List(T)`｜`Rec(name)`）。无隐式转换；显式转换白名单只有 `dec(Int)`/`int(Dec)`
 * （ENU-95），不存在向 `Str` 的通用转换。
 *
 * 实现注（缺口登记）：`Dec(s)` 的标度 `s` 在 RULE-02 的 inputDecl 形状里没有承载位
 * （字段只写标量族），本实现以限额 `maxScale` 为界、`Dec` 值自带 scale；逐字段钉 `s`
 * 的语义位登记为缺口，不在此发明字段。
 */
export type RuleType =
  | { readonly kind: 'Bool' }
  | { readonly kind: 'Int' }
  | { readonly kind: 'Dec' }
  | { readonly kind: 'Str' }
  | { readonly kind: 'Ts' }
  | { readonly kind: 'Dur' }
  | { readonly kind: 'Enum'; readonly vocab: string; readonly vocabVersion: string }
  | { readonly kind: 'List'; readonly element: RuleType }
  | { readonly kind: 'Rec'; readonly name: string }

/** 类型同一（结构比较；Enum 必须 vocab 与 vocabVersion 同时相等——跨词表/跨版本即不同型） */
export function ruleTypeEquals(left: RuleType, right: RuleType): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case 'Enum':
      return right.kind === 'Enum' && left.vocab === right.vocab && left.vocabVersion === right.vocabVersion
    case 'List':
      return right.kind === 'List' && ruleTypeEquals(left.element, right.element)
    case 'Rec':
      return right.kind === 'Rec' && left.name === right.name
    default:
      return true
  }
}

/** 类型机器名（诊断 messageArgs 用；形如 `Dec`/`List(Str)`/`Enum(risk,1.0.0)`） */
export function ruleTypeName(type: RuleType): string {
  switch (type.kind) {
    case 'Enum':
      return `Enum(${type.vocab},${type.vocabVersion})`
    case 'List':
      return `List(${ruleTypeName(type.element)})`
    case 'Rec':
      return `Rec(${type.name})`
    default:
      return type.kind
  }
}

/**
 * 标量族 → 求值类型（v2/10 §1.1 → §6.2 RULE-04 的落地映射）：
 *   text/token/dotid/semver → Str；integer → Int；decimal → Dec；boolean → Bool；
 *   timestamp → Ts；duration → Dur；enumRef → Enum（vocab/version 由引用处钉，缺省空）；
 *   list/record → 以 JSON 形状承载（元素/成员类型未在 RULE-02 声明，类型化使用须显式
 *   声明对象形态——缺口同上）。
 */
export function scalarFamilyToRuleType(family: ScalarFamily): RuleType {
  switch (family) {
    case 'boolean':
      return { kind: 'Bool' }
    case 'integer':
      return { kind: 'Int' }
    case 'decimal':
      return { kind: 'Dec' }
    case 'timestamp':
      return { kind: 'Ts' }
    case 'duration':
      return { kind: 'Dur' }
    case 'enumRef':
      return { kind: 'Enum', vocab: '', vocabVersion: '' }
    case 'list':
      return { kind: 'List', element: { kind: 'Rec', name: 'json' } }
    case 'record':
      return { kind: 'Rec', name: 'json' }
    case 'null':
      return { kind: 'Rec', name: 'null' }
    default:
      return { kind: 'Str' }
  }
}

/** 规则输入声明·字段（v2/10 §6.2 RULE-02：逐字段声明；`absenceTolerant` 缺省 false） */
export interface InputFieldDecl {
  readonly path: string
  /**
   * 标量族（RULE-02 原文口径）或显式求值类型（本条为承载注：list<T>/Enum(vocab,v)/
   * Rec(name) 的参数位在 RULE-02 形状里缺承载，显式类型用于需要类型化比较的声明）。
   */
  readonly type: ScalarFamily | RuleType
  readonly required: boolean
  readonly nullable: boolean
  readonly absenceTolerant: boolean
  /** 缺省（`defaultOf` 的合法性来源；与 `absenceTolerant=true` 并存＝声明期拒收） */
  readonly default?: string | number | boolean | null
}

/** 规则输入声明（v2/10 §6.2 RULE-02：`roots` 为 list<token>，`fields` 逐字段） */
export interface InputDecl {
  readonly roots: readonly string[]
  readonly fields: readonly InputFieldDecl[]
}

/** 人读/机读一致性（值集唯一主表 v2/09 ENU-103；`undeterminable` 按拒绝处理——本件不消费） */
export type HumanConsistency = 'consistent' | 'divergent' | 'undeterminable'

/** 规则档引用键（profileId＋version；同键必同摘要，异键必不同解释） */
export function profileRefKey(ref: { readonly profileId: string; readonly version: string }): string {
  return `${ref.profileId}@${ref.version}`
}
