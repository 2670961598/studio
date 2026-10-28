/**
 * AUTH 权责族记录形状与判定件（MIG-03 / IMPL-03-01）
 *
 * 依据链：
 *   - v2/11 §2.2 授权链 REC-AUTH-01..08（字段表/不变量/失败出口）；§1.1 AUTH 权责族 16 类登记；
 *     §0.3-2 决定面封闭清单；§0.5 时间字段分层；§0.7 证明边界；§十四 迁移总表（本族不承载状态机）
 *   - v2/09 ENU-74（授权撤回原因）、ENU-75（围栏模式）、ENU-76（失能判定类别）、
 *     ENU-130（停用证据三选一）、ENU-136（凭据类别）、ENU-137（授权子类型）、
 *     ENU-138（根授予证明模式）、ENU-139（行使身份）——值集唯一主表在 v2/09，本文件只投影
 *   - v2/03 §3.1/§3.3/§3.4（根与冷启动、+1/+2 链、G9/G8 授权面）；v2/15 §七（SEC-ROOT-02 验签/指纹）
 *   - plan/05 IMPL-03-01；plan/03 §四（MIG-03）
 *
 * 范围（本单）＝AUTH-01..08（授权链）的 payload 形状＋关键不变量校验器。§1.1 AUTH 族的另 8 类
 * （§2.1 通用骨架 REC-CMD-01/02、REC-DEC-01、REC-RCP-01、REC-COR-01、REC-EVT-01/02/03）的 payload 形状
 * 在 `common.ts`（宰相 2026-10-28 补件令）；本文件 `AUTH_RECORD_SCHEMAS` 为 16 类的并集形状闸。
 *
 * 纪律：只写可擦除语法；相对 import 带 `.ts`；类型导入 `import type`；不定义任何族外枚举字面量。
 */
import { z } from 'zod'
import { COMMON_RECORD_SCHEMAS } from './common.ts'
import {
  DecisionFaceSchema,
  ObjectRefSchema,
  RecordRefSchema,
  TimestampSchema,
  checkEffectiveSlotConsistency,
  issuesFromZod,
  mergeOutcomes,
  recordEnvelopeSchema,
  recordReject,
  type RecordValidationOutcome,
  type SubjectClass,
} from './envelope.ts'

// —— §1 记录类型登记（v2/11 §1.1：AUTH 权责族 16 类；本单落 8 类 payload）——

/** v2/11 §1.1 AUTH 权责族 16 类（序即 §1.1 表序；授权链 8 类在本文件、通用骨架 8 类在 common.ts） */
export const AUTH_RECORD_TYPES = [
  'REC-CMD-01', 'REC-CMD-02', 'REC-DEC-01', 'REC-RCP-01', 'REC-COR-01', 'REC-EVT-01', 'REC-EVT-02', 'REC-EVT-03',
  'REC-AUTH-01', 'REC-AUTH-02', 'REC-AUTH-03', 'REC-AUTH-04', 'REC-AUTH-05', 'REC-AUTH-06', 'REC-AUTH-07', 'REC-AUTH-08',
] as const

export type AuthRecordType = (typeof AUTH_RECORD_TYPES)[number]

// —— §2 枚举投影（字面量唯一主表 v2/09；本文件只投影，不新立取值）——

/** ENU-137 授权子类型：`delegation` 普通转授｜`root_delegation` 根授予（外部老板→最高宰相，必带证明字段与指纹） */
export const GRANT_CLASSES = ['delegation', 'root_delegation'] as const
export const GrantClassSchema = z.enum(GRANT_CLASSES)
export type GrantClass = (typeof GRANT_CLASSES)[number]

/** ENU-138 根授予证明模式：`ritual_and_key`（root 唯一允许值）｜`record_only`（不得用于 root） */
export const PROOF_MODES = ['ritual_and_key', 'record_only'] as const
export const ProofModeSchema = z.enum(PROOF_MODES)

/** ENU-139 行使身份：`self` 本人权源内｜`internal_boss` 最高宰相以内部老板身份行 root（子 agent 不得取） */
export const ON_BEHALF_OF_VALUES = ['self', 'internal_boss'] as const
export const OnBehalfOfSchema = z.enum(ON_BEHALF_OF_VALUES)

/** ENU-136 凭据类别：`root`（仅最高宰相，以老板身份签发内部硬动作）｜`scoped`（子 agent 只能持此） */
export const CREDENTIAL_CLASSES = ['root', 'scoped'] as const
export const CredentialClassSchema = z.enum(CREDENTIAL_CLASSES)
export type CredentialClass = (typeof CREDENTIAL_CLASSES)[number]

/** ENU-74 授权撤回原因（到期/主动撤回/禁配/改授/失能/越权发现） */
export const WITHDRAWAL_REASONS = ['expiry', 'active_withdrawal', 'conflict_of_interest', 're_assignment', 'incapacity', 'unauthorized_found'] as const
export const WithdrawalReasonSchema = z.enum(WITHDRAWAL_REASONS)

/** ENU-130 停用证据三选一（无后代时另需显式确认方法） */
export const DEACTIVATION_EVIDENCE_KINDS = ['revocation_receipt', 'injection_stop_confirm', 'fence_rejection_record'] as const
export const DeactivationEvidenceKindSchema = z.enum(DEACTIVATION_EVIDENCE_KINDS)

/** ENU-75 围栏模式三值（REC-AUTH-07 `fencing_mode`；无互认围栏只允许独占交接） */
export const FENCING_MODES = ['mutual_fence', 'common_arbiter', 'exclusive_handover'] as const
export const FencingModeSchema = z.enum(FENCING_MODES)

/** ENU-76 失能判定类别（REC-AUTH-08 `failure_class`） */
export const INCAPACITY_CLASSES = ['unreachable', 'unresponsive', 'credential_failed', 'capability_lost', 'duty_refusal', 'all_subjects_failed'] as const
export const IncapacityClassSchema = z.enum(INCAPACITY_CLASSES)

// —— §3 REC-AUTH-01 授予/转授边（生产者：授权者 +2 链；根授予＝外部老板）——

/** 权限范围（§2.2：purpose/object/scope（含不可为边界）——scope 必须显式列不可为边界） */
export const GrantScopeSchema = z.strictObject({
  purpose: z.string().min(1),
  object: z.string().min(1),
  included: z.array(z.string().min(1)).min(1),
  /** 不可为边界（空列表＝未声明边界；§2.2「scope（含不可为边界）」要求显式） */
  forbidden: z.array(z.string().min(1)),
})

/**
 * 授权期限（§2.2 `term（区间）`）。**非生效窗口**：不承载生效状态三值，生效状态与时点在信封（§0.5）；
 * 字段名取 from/to 而非 `until`——§0.5 明文禁止 payload 出现 `until` 与区间型生效窗口字段。
 */
export const GrantTermSchema = z.strictObject({ from: TimestampSchema, to: TimestampSchema })

/** 根授予子类型追加字段（`grant_class=root_delegation` 时必填，其余类型禁填——§2.2 表） */
export const ROOT_DELEGATION_ONLY_FIELDS = ['key_fingerprint', 'external_signature', 'offline_approval_ref', 'proof_mode', 'external_veto_configured'] as const

/** REC-AUTH-01 payload（§2.2 字段表序；根授予子类型四字段＋签名/离线批准件二选一） */
export const AuthGrantPayloadSchema = z
  .strictObject({
    grantor: ObjectRefSchema,
    grantee: ObjectRefSchema,
    /** 普通转授＝父授予（REC-AUTH-01）；根授予＝公司设立记录（v2/03 §3.1；治 DSF P0-4「parent_grant 可空」） */
    parent_grant: RecordRefSchema,
    grant_class: GrantClassSchema,
    scope: GrantScopeSchema,
    conditions: z.array(z.string().min(1)),
    term: GrantTermSchema,
    /** 可否再转授（子授权不得超出父授权目的/范围/条件/期限——I-6） */
    delegable: z.boolean(),
    withdrawal_terms: z.string().min(1),
    /** →REC-LIFE-05 累计禁配结论（跨位置/部署/账号累计，不重置） */
    conflict_check_ref: RecordRefSchema,
    /** operating root key 的指纹或公钥标识（**不是密钥值**；秘密值不入库/提示词/日志/快照——v2/15） */
    key_fingerprint: z.string().min(1).optional(),
    /** 外部老板签名件引用（与 offline_approval_ref 二选一；二者皆无即根授予不成立） */
    external_signature: ObjectRefSchema.optional(),
    /** 离线批准件引用（与 external_signature 二选一） */
    offline_approval_ref: ObjectRefSchema.optional(),
    proof_mode: ProofModeSchema.optional(),
    /** 外部宪法否决是否显式配置（默认 false＝外部无否决，v2/03 §2.3 行 1） */
    external_veto_configured: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const present = ROOT_DELEGATION_ONLY_FIELDS.filter((field) => v[field] !== undefined)
    if (v.grant_class === 'root_delegation') {
      for (const field of ['key_fingerprint', 'proof_mode', 'external_veto_configured'] as const) {
        if (v[field] === undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `根授予必填 ${field}（§2.2 根授予子类型追加字段）` })
        }
      }
      if (v.external_signature === undefined && v.offline_approval_ref === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['external_signature'],
          message: '根授予须有外部签名或离线批准件（二选一；二者皆无即根授予不成立——§2.2/§十五-2）',
        })
      }
      if (v.proof_mode !== undefined && v.proof_mode !== 'ritual_and_key') {
        ctx.addIssue({ code: 'custom', path: ['proof_mode'], message: '根授予 proof_mode 恒 ritual_and_key（ENU-138：record_only 不得用于根授予）' })
      }
    } else if (present.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: [present[0] ?? 'grant_class'],
        message: `根授予子类型字段禁填（grant_class=delegation 时 ${present.join('/')} 不得出现——§2.2）`,
      })
    }
    if (v.grant_class === 'delegation' && v.parent_grant.refType !== 'REC-AUTH-01') {
      ctx.addIssue({ code: 'custom', path: ['parent_grant', 'refType'], message: '普通转授的 parent_grant 须为 REC-AUTH-01（父授予）' })
    }
  })

export const AuthGrantRecordSchema = recordEnvelopeSchema(AuthGrantPayloadSchema, 'REC-AUTH-01')

/** 权源解析输入（v2/03 §三 授权表 / v2/15 §七；**判定面输入，不是记录字段**） */
export interface GrantIssuerResolution {
  /** 授予人主体类别（根授予只能由外部老板签发：不得为任何 agent 或最高宰相本人） */
  grantorClass: SubjectClass
  /** 证明核验结论：外部签名或离线批准件已核验通过（v2/15 SEC-ROOT-02） */
  proofVerified: boolean
  /** `key_fingerprint` 与外部侧登记的 operating root key 相符 */
  fingerprintMatches: boolean
}

// —— §4 REC-AUTH-02 授权行使（生产者：行使者＋检查位置）——

/** 逐项范围核验（§2.2 `within_scope（逐项）`） */
export const WithinScopeItemSchema = z.strictObject({
  item: z.string().min(1),
  /** 该项是否在授予范围内（行使不得反向扩大授予） */
  within: z.boolean(),
  basis: z.string().min(1).optional(),
})

export const AuthExercisePayloadSchema = z.strictObject({
  exercised_grant: RecordRefSchema,
  action_ref: ObjectRefSchema,
  within_scope: z.array(WithinScopeItemSchema).min(1),
  exercised_at: TimestampSchema,
  /** ENU-139：self＝本人权源内；internal_boss＝最高宰相以内部老板身份行 root（子 agent 不得取此值） */
  on_behalf_of: OnBehalfOfSchema,
  /** 是否以 root 身份行使（为真时必附 root_delegation_ref） */
  root_use: z.boolean(),
  root_delegation_ref: RecordRefSchema.optional(),
  /** 未行使范围（on_behalf_of=internal_boss 时须为空——ENU-139） */
  withheld_scope: z.array(z.string().min(1)).optional(),
})

export const AuthExerciseRecordSchema = recordEnvelopeSchema(AuthExercisePayloadSchema, 'REC-AUTH-02')

/** 行使判定输入（行使人主体类别；权源解析归 v2/03 §三，记录不复制） */
export interface AuthExerciseContext {
  actorClass: SubjectClass
}

// —— §5 REC-AUTH-03 授权撤回（P0-12 主载体：后代枚举＋停用证据）——

/** 后代枚举项（§2.2 表：｛类型、身份标识、持有凭据类别＋逻辑引用（非值）、终止或围栏证据、对账入口｝） */
export const RevokedDescendantSchema = z.strictObject({
  /** 派生执行体类型：子 agent/子 shell/外部后端子进程/会话快照（v2/07 §四「派生即登记」） */
  descendant_type: z.string().min(1),
  identity_ref: z.string().min(1),
  credential: z.strictObject({
    credential_class: CredentialClassSchema,
    /** 逻辑引用（**非值非路径**；秘密值不得入记录——v2/15） */
    logical_reference: z.string().min(1),
  }),
  deactivation_evidence: z.string().min(1),
  reconcile_entry: z.string().min(1),
})

/** 停用证据（§2.2：逐个停用/凭据失效的机制性证据；**无后代的显式确认方法**不得留空视为零） */
export const DeactivationEvidenceSchema = z.strictObject({
  kind: DeactivationEvidenceKindSchema,
  evidence_ref: z.string().min(1),
  no_descendant_confirmation: z
    .strictObject({
      probe_method: z.string().min(1),
      last_probed_at: TimestampSchema,
    })
    .optional(),
})

export const AuthWithdrawalPayloadSchema = z
  .strictObject({
    withdrawn_grant: RecordRefSchema,
    reason: WithdrawalReasonSchema,
    /** 单时刻（§0.5）；仅实际生效时填，pending 时必须为 null——checkEffectiveSlotConsistency 判定 */
    effective_time: TimestampSchema.nullable(),
    in_flight_inventory: z.array(z.string().min(1)),
    /** 后代枚举（必填槽；空列表只在「无后代」且带 no_descendant_confirmation 时成立） */
    descendants: z.array(RevokedDescendantSchema),
    deactivation_evidence: DeactivationEvidenceSchema,
    runtime_stop_evidence: RecordRefSchema,
    credential_actions: z.array(z.string().min(1)),
    residual_side_effects: z.array(z.string().min(1)),
    successor_grant: RecordRefSchema.optional(),
    /** 被撤回授予的 grant_class（ENU-137；=root_delegation 时按「外部撤回 root」口径校验后代全集） */
    withdrawn_grant_class: GrantClassSchema,
  })
  .superRefine((v, ctx) => {
    if (v.descendants.length === 0 && v.deactivation_evidence.no_descendant_confirmation === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['deactivation_evidence', 'no_descendant_confirmation'],
        message: '无后代时须给显式确认方法（探测方法与最后探测时点），不得留空视为零（§2.2/ENU-130）',
      })
    }
    if (v.withdrawn_grant_class === 'root_delegation' && v.descendants.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['descendants'],
        message: '外部撤回/轮换 root：descendants[] 必须枚举全部内部授权与凭据（含 root 指纹与全部 scoped 凭据）',
      })
    }
    if (v.reason === 're_assignment' && v.successor_grant === undefined) {
      ctx.addIssue({ code: 'custom', path: ['successor_grant'], message: '改授/轮换须同时写 successor_grant（§2.2：轮换时必填）' })
    }
  })

export const AuthWithdrawalRecordSchema = recordEnvelopeSchema(AuthWithdrawalPayloadSchema, 'REC-AUTH-03')

/** 撤回判定输入（后代全集来自派生登记/凭据目录——记录不复制登记表） */
export interface AuthWithdrawalContext {
  /** 派生登记侧已知的后代身份集合（root 撤回时须全覆盖：后代未清不得记完成） */
  knownDescendantIds?: readonly string[]
}

// —— §6 REC-AUTH-04 凭据逻辑引用（无值；credential_class=root 仅最高宰相）——

export const CREDENTIAL_LOGICAL_REF_PATTERN = /^[a-z][a-z0-9-]*(?:[.:/][a-z0-9@_-]+)*$/i

export const CredentialReferencePayloadSchema = z
  .strictObject({
    credential_class: CredentialClassSchema,
    /** 逻辑引用（非路径非值；如 `cred-root@company`） */
    logical_reference: z.string().min(1),
    /** 绑定授予（root 类必为 grant_class=root_delegation 的授予） */
    bound_grant: RecordRefSchema,
    permitted_operations: z.array(z.string().min(1)).min(1),
    /** 凭据有效期区间（**凭据有效期非生效窗口**，不受 §0.5 payload 区间禁令约束——§2.2 明文） */
    valid_window: z.strictObject({ from: TimestampSchema, to: TimestampSchema }),
    revocation_state: z.string().min(1),
    exposure_scope: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    if (/[/\\]/.test(v.logical_reference)) {
      ctx.addIssue({ code: 'custom', path: ['logical_reference'], message: '逻辑引用非路径（含路径分隔符即拒收——§2.2）' })
    }
    if (/^(?:sk-|ghp_|xox[bp]-|Bearer\s)/i.test(v.logical_reference)) {
      ctx.addIssue({ code: 'custom', path: ['logical_reference'], message: '逻辑引用不得承载秘密值（秘密值永不入库——§2.2/v2/15）' })
    }
  })

export const CredentialReferenceRecordSchema = recordEnvelopeSchema(CredentialReferencePayloadSchema, 'REC-AUTH-04')

/** 凭据判定输入（签发位置/权源解析；记录不复制凭据目录） */
export interface CredentialHolderResolution {
  /** 持有人主体类别（root 类只签发给最高宰相——§2.2） */
  holderClass: SubjectClass
  /** bound_grant 的 grant_class（权源解析） */
  boundGrantClass?: GrantClass
  /** 该凭据此前记录的类别（用于「不得原地升级/改类」判定——§2.2） */
  previousClass?: CredentialClass
}

// —— §7 REC-AUTH-05..08（形状；不变量在 §8 判定件）——

/** REC-AUTH-05 租约（生产者：权威端/仲裁者） */
export const LeasePayloadSchema = z.strictObject({
  holder: ObjectRefSchema,
  scope: z.array(z.string().min(1)).min(1),
  granted_at: TimestampSchema,
  expires_at: TimestampSchema,
  /** 续租不增治理代次 */
  renewable: z.boolean(),
  /** 跨框架互认时必填 */
  arbitration_ref: ObjectRefSchema.optional(),
})
export const LeaseRecordSchema = recordEnvelopeSchema(LeasePayloadSchema, 'REC-AUTH-05')

/** REC-AUTH-06 围栏观测（治理代次与技术围栏两轴不得共用字段/不得互推——v2/05 §三） */
export const FenceObservationPayloadSchema = z.strictObject({
  epoch: z.number().int().nonnegative(),
  /** 不记令牌内容（只记引用） */
  token_ref: z.string().min(1),
  issued_by: ObjectRefSchema,
  rejections: z.array(
    z.strictObject({
      stale_writer_ref: z.string().min(1),
      rejected_at: TimestampSchema,
      object_ref: ObjectRefSchema,
      stale_epoch: z.number().int().nonnegative(),
    }),
  ),
  recognized_by: z.array(ObjectRefSchema).min(1),
  last_verified_at: TimestampSchema,
})
export const FenceObservationRecordSchema = recordEnvelopeSchema(FenceObservationPayloadSchema, 'REC-AUTH-06')

/** REC-AUTH-07 权威激活（决定面封闭清单成员：必带 `decision_face`） */
export const AuthorityActivationPayloadSchema = z.strictObject({
  fact_domain: z.string().min(1),
  requirement_ref: ObjectRefSchema,
  chosen_endpoint: ObjectRefSchema,
  unmet_requirements: z.array(z.string().min(1)),
  activation_generation: z.number().int().nonnegative(),
  /** 首代为空（无前任代次） */
  previous_generation: z.number().int().nonnegative().nullable(),
  /** 复审到期（单时刻——payload 不存区间窗口，§0.5） */
  review_due: TimestampSchema,
  old_writer_stop: z.strictObject({ method: z.string().min(1), evidence_ref: z.string().min(1) }),
  in_flight_migration: z.array(z.string().min(1)),
  fencing_mode: FencingModeSchema,
  scope_judged: z.strictObject({
    judged: z.array(z.string().min(1)).min(1),
    not_judged: z.array(z.string().min(1)),
  }),
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})
export const AuthorityActivationRecordSchema = recordEnvelopeSchema(AuthorityActivationPayloadSchema, 'REC-AUTH-07')

/** REC-AUTH-08 失能与恢复判定（决定面封闭清单成员） */
export const IncapacityDecisionPayloadSchema = z.strictObject({
  subject: ObjectRefSchema,
  failure_class: IncapacityClassSchema,
  evidence: z.array(z.string().min(1)).min(1),
  judged_by: ObjectRefSchema,
  scope_and_term: z.string().min(1),
  freeze_effect: z.array(z.string().min(1)).min(1),
  recovery_preconditions: z.array(z.string().min(1)).min(1),
  notified: z.array(ObjectRefSchema).min(1),
  /** 不得由被判主体自设（§2.2；判定见 validateIncapacityDecision） */
  dissent_position: z.string().min(1),
  decision_face: DecisionFaceSchema,
})
export const IncapacityDecisionRecordSchema = recordEnvelopeSchema(IncapacityDecisionPayloadSchema, 'REC-AUTH-08')

// —— §8 判定件（纯函数；不抛错，返回 RecordValidationOutcome） ——

/** 形状闸：按 recordType 取本族 schema 解析（未落 payload 的通用骨架类型返回登记缺口提示） */
export const AUTH_RECORD_SCHEMAS: Readonly<Record<AuthRecordType, z.ZodType>> = {
  ...COMMON_RECORD_SCHEMAS,
  'REC-AUTH-01': AuthGrantRecordSchema, 'REC-AUTH-02': AuthExerciseRecordSchema, 'REC-AUTH-03': AuthWithdrawalRecordSchema,
  'REC-AUTH-04': CredentialReferenceRecordSchema, 'REC-AUTH-05': LeaseRecordSchema, 'REC-AUTH-06': FenceObservationRecordSchema,
  'REC-AUTH-07': AuthorityActivationRecordSchema, 'REC-AUTH-08': IncapacityDecisionRecordSchema,
}

/**
 * REC-AUTH-01 判定：形状＋（根授予）签发人/证明/指纹三闸。
 * 不变量（§2.2/§十五-2）：`root_delegation` 只能由外部老板签发（grantor 不得为任何 agent 或最高宰相本人）；
 * 无有效 root_delegation 的最高宰相不得签发内部硬动作。
 */
export function validateAuthGrant(record: unknown, resolution: GrantIssuerResolution): RecordValidationOutcome {
  const parsed = AuthGrantRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  if (envelope.payload.grant_class === 'root_delegation') {
    if (resolution.grantorClass !== 'external_owner') {
      checks.push(recordReject('payload.grantor', `根授予只能由外部老板签发（实际授予人类别 ${resolution.grantorClass}——§2.2/ENU-137）`))
    }
    if (!resolution.proofVerified) {
      checks.push({ ok: false, issues: [{ path: 'payload.external_signature', message: '根授予证明核验未过（验签/离线批准件——§2.2/v2/15 SEC-ROOT-02）' }] })
    }
    if (!resolution.fingerprintMatches) {
      checks.push({ ok: false, issues: [{ path: 'payload.key_fingerprint', message: 'key_fingerprint 与外部侧 operating root key 不符（§2.2）' }] })
    }
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-AUTH-02 判定：`on_behalf_of=internal_boss` 仅最高宰相本人可用、须引对应 `root_delegation`
 * 且 `withheld_scope` 为空；`root_use` 为真必附 `root_delegation_ref`（§2.2/ENU-139）。
 */
export function validateAuthExercise(record: unknown, ctx: AuthExerciseContext): RecordValidationOutcome {
  const parsed = AuthExerciseRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const issues: { path: string; message: string }[] = []
  const slot = checkEffectiveSlotConsistency(parsed.data)
  if (!slot.ok) issues.push(...slot.issues)
  if (payload.on_behalf_of === 'internal_boss') {
    if (ctx.actorClass !== 'internal_boss') {
      issues.push({ path: 'payload.on_behalf_of', message: 'on_behalf_of=internal_boss 仅最高宰相本人可用（子 agent 不得取此值——ENU-139）' })
    }
    if (payload.root_delegation_ref === undefined) {
      issues.push({ path: 'payload.root_delegation_ref', message: 'internal_boss 行使须引对应 root_delegation（REC-AUTH-01）' })
    }
    if (payload.withheld_scope !== undefined && payload.withheld_scope.length > 0) {
      issues.push({ path: 'payload.withheld_scope', message: 'internal_boss 行使时 withheld_scope 须为空（ENU-139）' })
    }
  }
  if (payload.root_use && payload.root_delegation_ref === undefined) {
    issues.push({ path: 'payload.root_delegation_ref', message: 'root_use 为真时必附 root_delegation_ref（§2.2）' })
  }
  if (payload.root_delegation_ref !== undefined && payload.root_delegation_ref.refType !== 'REC-AUTH-01') {
    issues.push({ path: 'payload.root_delegation_ref.refType', message: 'root_delegation_ref 须指向 REC-AUTH-01（根授予）' })
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

/**
 * REC-AUTH-03 判定：后代未全停或凭据未失效时撤回不得记完成（I-6）；
 * root 撤回须覆盖派生登记侧已知的全部后代（后代全集来自 ctx，记录不复制登记表）。
 */
export function validateAuthWithdrawal(record: unknown, ctx: AuthWithdrawalContext = {}): RecordValidationOutcome {
  const parsed = AuthWithdrawalRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.withdrawn_grant_class === 'root_delegation') {
    const known = ctx.knownDescendantIds ?? []
    const enumerated = new Set(payload.descendants.map((item) => item.identity_ref))
    const missing = known.filter((id) => !enumerated.has(id))
    if (missing.length > 0) {
      checks.push({
        ok: false,
        issues: [{ path: 'payload.descendants', message: `后代未全枚举（缺 ${missing.join('/')}）——后代未清不得记完成（§2.2/§十五-2）` }],
      })
    }
  }
  return mergeOutcomes(...checks)
}

/**
 * REC-AUTH-04 判定：`credential_class=root` 仅在最高宰相名下且绑定 `root_delegation`；
 * 子 agent 持 root key 判负；`scoped` 不得原地升级为 `root`（升级＝新授予＋新凭据记录——§2.2）。
 */
export function validateCredentialReference(record: unknown, resolution: CredentialHolderResolution): RecordValidationOutcome {
  const parsed = CredentialReferenceRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (payload.credential_class === 'root') {
    if (resolution.holderClass !== 'internal_boss') {
      checks.push({
        ok: false,
        issues: [{ path: 'payload.credential_class', message: `root 凭据只能在最高宰相名下（持有人类别 ${resolution.holderClass}＝供给面已破，ENU-136/§2.2）` }],
      })
    }
    if (resolution.boundGrantClass !== undefined && resolution.boundGrantClass !== 'root_delegation') {
      checks.push(recordReject('payload.bound_grant', 'root 凭据的 bound_grant 须为 grant_class=root_delegation 的授予（§2.2）'))
    }
    if (payload.bound_grant.refType !== 'REC-AUTH-01') {
      checks.push({ ok: false, issues: [{ path: 'payload.bound_grant.refType', message: 'bound_grant 须指向 REC-AUTH-01（授予记录）' }] })
    }
  }
  if (resolution.previousClass !== undefined && resolution.previousClass !== payload.credential_class) {
    checks.push(recordReject('payload.credential_class', `凭据类别不得原地改类（${resolution.previousClass}→${payload.credential_class}）——升级须新授予＋新凭据记录（§2.2）`))
  }
  return mergeOutcomes(...checks)
}

/** REC-AUTH-07 判定：代次单调（回退＝新决定＋新代次）、不得由验证通过倒推激活——§2.2 */
export function validateAuthorityActivation(record: unknown): RecordValidationOutcome {
  const parsed = AuthorityActivationRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const previous = payload.previous_generation ?? 0
  if (payload.activation_generation <= previous) {
    checks.push(recordReject('payload.activation_generation', `代次须递增（${payload.activation_generation} ≤ 前任 ${previous}）——回退＝新决定＋新代次（§2.2）`))
  }
  return mergeOutcomes(...checks)
}

/** REC-AUTH-08 判定：异议不得由被判主体自设（§2.2 不变量） */
export function validateIncapacityDecision(record: unknown, ctx: { dissentAuthoredBySubject?: boolean } = {}): RecordValidationOutcome {
  const parsed = IncapacityDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  if (ctx.dissentAuthoredBySubject === true) {
    checks.push({ ok: false, issues: [{ path: 'payload.dissent_position', message: '异议位置不得由被判主体自设（§2.2 REC-AUTH-08）' }] })
  }
  return mergeOutcomes(...checks)
}

/**
 * root 动作签发面 preflight（v2/15 §七 SEC-ROOT-02/05；NEG-ORG-09/11/12 的 V1 腿）：
 * 无有效 root_delegation／证明不过／指纹不符／行使人非最高宰相／动作越出范围或期限——一律拒。
 * **记录照实落**：越界行使本身是「外部可撤回的违约」，不是不可记录的；本函数只判「能不能签发」。
 */
export interface RootActionRequest {
  /** 待签发动作的声明范围（逐项） */
  action_scope: readonly string[]
  /** 动作发生的时刻（期限判定用；调用方给，不取系统时间——纯函数纪律） */
  at: string
}

export interface RootActionResolution extends GrantIssuerResolution {
  /** 行使人主体类别（root 动作只能由最高宰相行） */
  actorClass: SubjectClass
  withdrawGrantClass?: GrantClass
  /** 授予已撤回/到期（撤回完成判定在 REC-AUTH-03，此处只消费其结论） */
  revokedOrExpired?: boolean
}

export function checkRootActionPreflight(rootGrant: unknown, request: RootActionRequest, resolution: RootActionResolution): RecordValidationOutcome {
  const grantOutcome = validateAuthGrant(rootGrant, resolution)
  if (!grantOutcome.ok) return grantOutcome
  const parsed = AuthGrantRecordSchema.parse(rootGrant)
  const payload = parsed.payload
  if (payload.grant_class !== 'root_delegation') {
    return { ok: false, issues: [{ path: 'payload.grant_class', message: '非根授予不能作为 root 动作权源（§2.2：内部程序不得补位）' }] }
  }
  if (resolution.actorClass !== 'internal_boss') {
    return { ok: false, issues: [{ path: 'actorClass', message: 'root 动作只能由最高宰相本人行（子 agent/部门首长不得行 root——§2.2/ENU-139）' }] }
  }
  if (resolution.revokedOrExpired === true) {
    return { ok: false, issues: [{ path: 'payload.term', message: 'root_delegation 已撤回/到期，不得用于新签发（§2.2 失败出口）' }] }
  }
  const included = payload.scope.included
  const outside = request.action_scope.filter((item) => !included.includes(item))
  if (outside.length > 0) {
    return recordReject('request.action_scope', `root 超范围动作拒签（${outside.join('/')} 不在 root_delegation 范围内——违约，处置走外部撤回/轮换，§2.2/§十五-2）`)
  }
  const at = Date.parse(request.at)
  const from = Date.parse(payload.term.from)
  const to = Date.parse(payload.term.to)
  if (!(at >= from && at <= to)) {
    return { ok: false, issues: [{ path: 'request.at', message: `动作时刻 ${request.at} 越出 root_delegation 期限（${payload.term.from}..${payload.term.to}）` }] }
  }
  return { ok: true }
}
