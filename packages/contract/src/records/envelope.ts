/**
 * 记录信封与记录层共用部件（MIG-03 / IMPL-03-01）
 *
 * 依据链（实现单必须引用文档章节号——AGENTS §五.1）：
 *   - v2/11 §〇 通用记录契约：§0.2（责任主体/记录五分型）、§0.3（一事件一身份与决定面）、
 *     §0.4（身份/版本/幂等/双时间轴）、§0.5（时间字段分层与 payload 区间禁令）、
 *     §0.6（枚举零重述）、§0.7（证明边界）、§十五（字段不变量/73 类引用完整性）
 *   - v2/10 §1.1（标量族 token/dotid/semver/timestamp 语法——本文件不另立标量）；
 *     §4.1（`schemaRef`/`specVersion` 形状）
 *   - v2/09：ENU-62 生效状态三值（信封唯一存放）、§一 74 类登记（`recordType` 值域）
 *   - plan/05 IMPL-03-01 领土；plan/03 §四（MIG-03 范围/出口）
 *
 * 边界：
 *   - 只给形状与判定件；IO/落库在 store（MIG-04），端口签名在 ports（IMPL-03-03/04），本单不碰。
 *   - **不定义任何族内枚举字面量**（§0.6 零重述）：族文件只做 v2/09 主表投影并逐条标 ENU 号。
 *   - payload 字段名沿用 v2/11 正文的 snake_case（§0.5 `effective_time` 等）；信封字段按 03-01 单书 camelCase。
 *
 * 登记缺口（本单不臆造，如实标出，见 §报告）：
 *   1. `recordId` 的 ID 语法（qid 形态）在 v2/10 §1.1 写「登记 v2/09」，但 v2/09 实测无该条目
 *      → 本文件只约束非空串，不写死形态。
 *   2. v2/11 §0.4-1 正文写 `supersedes`、03-01 单书写 `revises`——同槽两名，本文件取单书
 *      `revises` 并注记差异（本单不改上位卷；归下一轮复扫统一）。
 *   3. v2/11 §0.4-2 引用形为「ID＋版本」。跨记录不变量（§十五-2：绩效必引验收/分级完成等）
 *      要机械可判类型，故**记录引用**带 `refType`（`RecordRefSchema`），**非记录对象**的引用
 *      用 `ObjectRefSchema`（不带 refType）——两个引用族都是「ID＋版本」的超集/等价形。
 */
import { z } from 'zod'

// —— §1 标量族（SCH-SYN-01，v2/10 §1.1 语法的记录面子集，本文件不另立标量）——

/** token：小写 ASCII `[a-z][a-z0-9-]{0,63}`（v2/10 §1.1） */
export const TokenSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'token：小写 ASCII [a-z][a-z0-9-]{0,63}')

/** dotid：一至四段、段间 `.`、每段为 token（v2/10 §1.1/§1.2） */
export const DotIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,3}$/, 'dotid：一至四段 token，段间 `.`')

/** semver：`MAJOR.MINOR.PATCH`（可带预发布/构建元数据；v2/10 §1.1） */
export const SemverSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'semver：MAJOR.MINOR.PATCH（可带预发布/构建元数据）',
  )

/**
 * timestamp：日期时间，必须带偏移（`Z` 或 `±hh:mm`），秒必填，小数秒 ≤9 位（v2/10 §1.1）。
 * 闰秒 `:60` 拒收；无偏移本地时间拒收（同上）。
 */
export const TimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
    'timestamp：带偏移的时刻（`Z` 或 `±hh:mm`），秒必填，小数秒 ≤9 位',
  )
  .refine((v) => !/T\d{2}:\d{2}:60(?:\.|Z|[+-])/.test(v), { message: 'timestamp：闰秒 `:60` 拒收（v2/10 §1.1）' })

/** 记录类型初始类型版本（§十五-4：全部 74 类初始类型版本 1.0.0；同主版本只许新增可选字段） */
export const RECORD_TYPE_VERSION_INITIAL = '1.0.0'

// —— §2 记录类型 ID（v2/11 §一 74 类唯一登记处；§0.9 AREA 登记处）——

/**
 * `REC-` 前缀集：§0.9 的 13 个 AREA（AUTH/LIFE/PERF/WORK/EVD/ACC/CHG/CAP/REV/EVAL/ASSET/OBS/MEM）
 * ＋§1.1 内的通用骨架五前缀（CMD/DEC/RCP/COR/EVT）。共 18 个前缀、74 类（03-01 只登记 28 类）。
 */
export const RECORD_AREA_PREFIXES = [
  'CMD',
  'DEC',
  'RCP',
  'COR',
  'EVT',
  'AUTH',
  'LIFE',
  'PERF',
  'WORK',
  'EVD',
  'ACC',
  'CHG',
  'CAP',
  'REV',
  'EVAL',
  'ASSET',
  'OBS',
  'MEM',
] as const

/**
 * 记录类型 ID 形状：`REC-<AREA>-<段>[<段>...]`（段为大写字母数字，可多段——
 * `REC-WORK-ACCEPT-MAINT`/`REC-WORK-COMMIT-CHANGE`/`REC-CAP-ACTIVATE`/`REC-EVD-RVK` 均为合法形）。
 * 形状合法 ≠ 已登记：登记集由各族文件导出（03-01 四件合计 28 类，余 46 类归 IMPL-03-02）。
 */
export const RecordTypeIdSchema = z
  .string()
  .regex(
    new RegExp(`^REC-(?:${RECORD_AREA_PREFIXES.join('|')})-[A-Z0-9]+(?:-[A-Z0-9]+)*$`),
    'recordType：形如 REC-AUTH-01 / REC-WORK-ACCEPT-MAINT（§一 登记形）',
  )

export type RecordTypeId = z.infer<typeof RecordTypeIdSchema>

// —— §3 引用族（§0.4-2 一切引用形如「ID＋版本」；见头注缺口 3）——

/** 非记录对象引用：「ID＋版本」（位置/端点/工件/签名件等非 REC 对象） */
export const ObjectRefSchema = z.strictObject({
  refId: z.string().min(1),
  refVersion: SemverSchema,
})

export type ObjectRef = z.infer<typeof ObjectRefSchema>

/** 记录引用：「记录类型＋ID＋版本」——跨记录不变量（§十五-2）须能机械判类型 */
export const RecordRefSchema = z.strictObject({
  refType: RecordTypeIdSchema,
  refId: z.string().min(1),
  refVersion: SemverSchema,
})

export type RecordRef = z.infer<typeof RecordRefSchema>

// —— §4 主体类别（**判定面输入**，不是记录字段：权源解析归 v2/03 §三 授权表，记录不复制）——

/**
 * 主体/授予人/行使人类别（v2/03 §3.1/§3.3、v2/07 §四「派生即登记」）。
 * 只作校验器上下文；**不落入任何 payload**（避免与 v2/03 权源表双写——§0.6 同则）。
 */
export const SUBJECT_CLASSES = ['external_owner', 'internal_boss', 'internal_position', 'derived_executor'] as const

export type SubjectClass = (typeof SUBJECT_CLASSES)[number]

/**
 * 不得作为决定者/异常接收者的匿名主体（§0.2-1 / I-9：框架/系统/平台/流程/daemon/监控/自动策略）。
 * 判定用：`producer.decidedBy` 归一为小写后命中即拒收（记录必须能追到具名位置）。
 */
export const FORBIDDEN_DECISION_SUBJECTS = [
  'framework',
  'system',
  'platform',
  'process',
  'daemon',
  'monitoring',
  'auto_policy',
  '自动策略',
  '监控',
  '框架',
  '系统',
  '平台',
  '流程',
] as const

/** 责任主体（§0.2-1：具名决定者＋写入路径分开；写入者不得替决定者补写理由） */
export const ProducerSchema = z
  .strictObject({
    /** 具名决定者（具名位置/工号；不得写框架/系统/平台/流程/daemon/监控/自动策略） */
    decidedBy: z.string().min(1),
    /** 写入路径（谁把记录写下的；与决定者分开——§0.2-1/§0.2-2） */
    writtenBy: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    const normalized = v.decidedBy.trim().toLowerCase()
    if ((FORBIDDEN_DECISION_SUBJECTS as readonly string[]).includes(normalized)) {
      ctx.addIssue({
        code: 'custom',
        path: ['decidedBy'],
        message: `决定者不得为「${v.decidedBy}」——§0.2-1/I-9 要求具名决定者（框架/系统/平台/流程/daemon/监控/自动策略均不可作决定者）`,
      })
    }
  })

export type Producer = z.infer<typeof ProducerSchema>

// —— §5 生效状态与时点（§0.5；字面量唯一主表 v2/09 ENU-62，信封唯一存放）——

/** ENU-62 生效状态三值：pending 待生效｜effective 已生效｜expired 已失效 */
export const EFFECTIVE_STATES = ['pending', 'effective', 'expired'] as const

export const EffectiveStateSchema = z.enum(EFFECTIVE_STATES)

export type EffectiveState = (typeof EFFECTIVE_STATES)[number]

/**
 * 信封生效时点（§0.5 表：`effectiveTime{from, until?}`）：
 *   - `from`：pending 时是预计/复审起点，effective 时是实际生效起点；
 *   - `until`：失效/复审终点，**唯一存放点**（payload 一律不得出现 `until`/区间型生效窗口字段）。
 */
export const EffectiveTimeSchema = z.strictObject({
  from: TimestampSchema,
  until: TimestampSchema.optional(),
})

export type EffectiveTime = z.infer<typeof EffectiveTimeSchema>

/**
 * payload 侧生效槽位（§0.5 配套规则）：非「决定面封闭清单」类型而正文要求带生效槽位的记录
 * （如 REC-AUTH-03 的 `effective_time`、REC-LIFE-06 的生效槽位）用它。
 * `effective_time` 仅实际生效时刻：pending 时必须为 null（checkEffectiveSlotConsistency 判定）；
 * 决定面封闭清单类型改由 `DecisionFaceSchema` 携带同槽。
 */
export const EffectiveSlotSchema = z.strictObject({
  effective_state: EffectiveStateSchema,
  effective_time: TimestampSchema.nullable(),
})

export type EffectiveSlot = z.infer<typeof EffectiveSlotSchema>

// —— §6 决定面（§0.3-1：嵌套槽位；§0.3-2 封闭清单类型必带）——

/**
 * 决定面（§0.3-1 六件：决定者、权源引用、理由与依据、判定范围与未判范围、异议位置、生效状态与时点）。
 * 适用范围＝§0.3-2 封闭清单：REC-AUTH-07/08、REC-WORK-02/04/06/07/09/12、REC-LIFE-01/02/07/09、
 * REC-CAP-ACTIVATE、REC-ACC-02（03-01 落其中 AUTH-07/08 与 LIFE-01/02/07/09）；
 * **另** REC-LIFE-03 的 §3.1 节头自称「决定面封闭清单成员」而 §0.3-2 清单未列——内部不一致登记缺口，
 * 本文件按 §3.1 给 LIFE-03 决定面。
 * 决定面是权威值：顶层同名字段（若存在）为只读投影，两处冲突即拒收（§0.3-4）。
 */
export const DecisionFaceSchema = z.strictObject({
  /** 决定者（具名位置） */
  decided_by: z.string().min(1),
  /** 权源引用（记录引用：授予/决定/规则版本） */
  authority_ref: RecordRefSchema,
  /** 理由（不得为空——§0.3/§2.1 REC-DEC-01 不变量） */
  rationale: z.string().min(1),
  /** 依据引用（逐条「ID＋版本」；不得为空列表） */
  basis_refs: z.array(RecordRefSchema).min(1),
  /** 判定范围（判了什么/没判什么——缺 scope_judged 只能作意见记录，不得触发迁移） */
  scope_judged: z.strictObject({
    judged: z.array(z.string().min(1)).min(1),
    not_judged: z.array(z.string().min(1)),
  }),
  /**
   * 异议位置（「无异议」为合法表示，§3.1 REC-LIFE-02 白名单口径：
   * 校验只可因「异议位置缺载且无无异议表示」拒写，不得因「无异议」本身拒写）。
   */
  dissent_position: z.string().min(1),
  /** 生效状态（与信封同值——§0.5 配套规则；不一致即拒收） */
  effective_state: EffectiveStateSchema,
  /** 生效时点（仅实际生效时刻；pending 时为空——checkEffectiveSlotConsistency 判定） */
  effective_time: TimestampSchema.optional(),
})

export type DecisionFace = z.infer<typeof DecisionFaceSchema>

// —— §7 幂等键（§0.4-5：通用作用域五元组）——

/**
 * 幂等键通用作用域（§0.4-5）：（公司标识、对象类型、对象标识、操作类别、请求方序列）五元组。
 * 协议特化键（任命四元组/权威激活/收割）必须①含公司标识②可显式映射回本五元组③在 v2/11 §0.4-5 登记——
 * 特化键槽位归各族 payload（如 REC-LIFE-01 的 `idempotency_four_tuple`），信封只承载通用作用域。
 */
export const IdempotencyScopeSchema = z.strictObject({
  companyRef: z.string().min(1),
  recordType: RecordTypeIdSchema,
  subjectId: z.string().min(1),
  operationClass: TokenSchema,
  requesterSequence: z.string().min(1),
})

export type IdempotencyScope = z.infer<typeof IdempotencyScopeSchema>

/** 证明边界（§0.7-1：证据类与决定类记录必填「本记录证明什么、不证明什么」） */
export const ProofBoundarySchema = z.string().min(1)

// —— §8 记录信封（本单主件；字段序即 03-01 单书序）——

/**
 * 记录信封 `RecordEnvelope<T>`（v2/11 §〇；字段含义集中在此，各族 payload 不重复信封面）：
 *   recordId        一次语义事件唯一身份，一经分配不复用（§0.3-1/§0.4-1）
 *   recordType      §一 74 类登记值（形状闸见 RecordTypeIdSchema）
 *   schemaRef       冻结 schema 工件引用 {schemaId: dotid, schemaVersion: semver}（v2/10 §4.1；
 *                   DEC-OPEN-15 未批不发 `$id` → 以 dotid 引用，不用 `$id`）
 *   specVersion     依循的 V2 规范版本（semver；未知主版本拒收，v2/10 §4.1）
 *   companyRef      公司标识（幂等键第①元的落点，§0.4-5；标识语法未登记→非空串）
 *   producedAt      系统获知时间（§0.4-3 双时间轴；业务生效时间在 payload/`effectiveTime`）
 *   producer        具名决定者＋写入路径（§0.2-1）
 *   basisRefs       依据引用（逐条「ID＋版本」，§0.4-2）
 *   payload         主 payload（一事件一主 payload，§0.3-1）
 *   effectiveState  ENU-62 三值（信封唯一存放，§0.5）
 *   effectiveTime   {from, until?}（pending/effective 时必填；`until` 唯一存放点，§0.5）
 *   proofBoundary   证明边界（§0.7-1：证据类与决定类记录必填；各族校验器按类型收紧）
 *   revises         版本链前一版本引用（§0.4-1 `supersedes` 槽，旧版本保留；见头注缺口 2）
 *   idempotencyKey  幂等键通用作用域五元组（§0.4-5）
 */
export interface RecordEnvelope<T = unknown> {
  recordId: string
  recordType: RecordTypeId
  schemaRef: { schemaId: string; schemaVersion: string }
  specVersion: string
  companyRef: string
  producedAt: string
  producer: Producer
  basisRefs: ObjectRef[]
  payload: T
  effectiveState: EffectiveState
  effectiveTime?: EffectiveTime
  proofBoundary?: string
  revises?: ObjectRef
  idempotencyKey?: IdempotencyScope
}

/** 任意族 payload 的信封（判定件入口用；不承诺 payload 内部形状） */
export type AnyRecordEnvelope = RecordEnvelope<unknown>

/**
 * 生效槽判定件的最小输入面（zod 推导形状与 `RecordEnvelope<T>` 的手写接口在
 * `exactOptionalPropertyTypes` 下不互相赋值——判定件收窄到只依赖这三项）。
 */
export interface EffectiveSlotCarrier {
  effectiveState: EffectiveState
  effectiveTime?: EffectiveTime | undefined
  payload: unknown
}

/** 由 payload schema 派生整记录（信封＋payload）的 zod 形状 */
export function recordEnvelopeSchema<P extends z.ZodType>(payload: P, recordType?: RecordTypeId) {
  const recordTypeSchema = recordType === undefined ? RecordTypeIdSchema : z.literal(recordType)
  return z
    .strictObject({
      recordId: z.string().min(1),
      recordType: recordTypeSchema,
      schemaRef: z.strictObject({ schemaId: DotIdSchema, schemaVersion: SemverSchema }),
      specVersion: SemverSchema,
      companyRef: z.string().min(1),
      producedAt: TimestampSchema,
      producer: ProducerSchema,
      basisRefs: z.array(ObjectRefSchema),
      payload,
      effectiveState: EffectiveStateSchema,
      effectiveTime: EffectiveTimeSchema.optional(),
      proofBoundary: ProofBoundarySchema.optional(),
      revises: ObjectRefSchema.optional(),
      idempotencyKey: IdempotencyScopeSchema.optional(),
    })
    .superRefine((v, ctx) => {
      // §0.5：pending/effective 时信封 effectiveTime 必填（planned/actual 起点不得缺）
      if ((v.effectiveState === 'pending' || v.effectiveState === 'effective') && v.effectiveTime === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['effectiveTime'],
          message: 'pending/effective 时信封 effectiveTime 必填（§0.5 时间分层）',
        })
      }
    })
}

// —— §9 判定结果与共用判定件（纯数据判定，不抛错；族校验器统一返回本形状）——

/** 记录级校验失败条目（path 为字段路径；message 为人话修法提示） */
export interface RecordValidationIssue {
  path: string
  message: string
}

/** 记录级校验结论：合法 `{ok:true}`／不合法带 issues（照 events.ValidationOutcome 口径，不抛错） */
export type RecordValidationOutcome = { ok: true } | { ok: false; issues: RecordValidationIssue[] }

/** 合法结论 */
export function recordOk(): RecordValidationOutcome {
  return { ok: true }
}

/** 单条不合法结论 */
export function recordReject(path: string, message: string): RecordValidationOutcome {
  return { ok: false, issues: [{ path, message }] }
}

/** zod 错误 → 记录级 issues（zod 路径按 JSON Pointer 风格拼点号，便于测试定位） */
export function issuesFromZod(error: z.ZodError): RecordValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '' : issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }))
}

/** 结论合并：任一不合法即不合法（保留全部 issues） */
export function mergeOutcomes(...outcomes: RecordValidationOutcome[]): RecordValidationOutcome {
  const issues = outcomes.flatMap((outcome) => (outcome.ok ? [] : outcome.issues))
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

/**
 * 生效槽位一致性（§0.5 配套规则，全类型判据）：
 *   ① payload 声明的生效状态（顶层 `effective_state` 或决定面同槽）必须与信封同值；
 *   ② pending 时 payload `effective_time` 必须为空（预计起点不得回填为实际生效时间）；
 *   ③ effective 且两侧都有值时须同值（与信封 `from` 同值校验）。
 * 不支持/未声明生效槽位的记录（如 REC-AUTH-01）只查②③的前提存在性，不强制①。
 */
export function checkEffectiveSlotConsistency(record: EffectiveSlotCarrier): RecordValidationOutcome {
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return recordOk()
  const bag = payload as Record<string, unknown>
  const face = typeof bag['decision_face'] === 'object' && bag['decision_face'] !== null ? (bag['decision_face'] as Record<string, unknown>) : undefined
  const declaredState = 'effective_state' in bag ? bag['effective_state'] : face?.['effective_state']
  const declaredTime = 'effective_time' in bag ? bag['effective_time'] : face?.['effective_time']
  const issues: RecordValidationIssue[] = []
  if (declaredState !== undefined && declaredState !== record.effectiveState) {
    issues.push({
      path: 'payload.effective_state',
      message: `payload 生效状态 ${String(declaredState)} 与信封 ${record.effectiveState} 不一致（§0.5：不一致即拒收）`,
    })
  }
  if (record.effectiveState === 'pending' && declaredTime !== undefined && declaredTime !== null) {
    issues.push({ path: 'payload.effective_time', message: 'pending 时 payload effective_time 必须为空（§0.5）' })
  }
  if (
    record.effectiveState === 'effective' &&
    typeof declaredTime === 'string' &&
    record.effectiveTime !== undefined &&
    declaredTime !== record.effectiveTime.from
  ) {
    issues.push({
      path: 'payload.effective_time',
      message: `effective 时 payload effective_time 须与信封 from 同值（${record.effectiveTime.from}，§0.5）`,
    })
  }
  return issues.length === 0 ? recordOk() : { ok: false, issues }
}
