/**
 * LIFE 生命周期族记录形状与判定件（MIG-03 / IMPL-03-01）
 *
 * 依据链：v2/11 §3.1 任职侧 REC-LIFE-01..06（K2 载体）＋§3.2 组织侧 REC-LIFE-07..11；§1.2 LIFE 族 11 类；
 *   §〇.3-2 决定面封闭清单；§〇.5 时间分层；§〇.7 证明边界；§十四（§14.2 六状态十边、§14.3 身份四态）｜
 *   v2/09 ENU-01/02/30/34/35/36/40/125/126（字面量唯一主表；本文件只投影）｜
 *   v2/02 §二/§三（任命五条件、六状态十边、结清两段式）、v2/03 §2.2/§2.4/§3.3/§7.1/§7.2（G9/G8、单元缺位、连续性、
 *   移交）、v2/01 I-16｜plan/05 IMPL-03-01；plan/03 §四
 *
 * 登记缺口（不臆造，如实标出）：
 *   1. REC-LIFE-01 `acceptance_state` 机器值集未在 v2/09 登记 → 只约束非空串。
 *   2. REC-LIFE-03 `checklist_items` 取值集：v2/11 §3.1 写「主表 v2/09」，而 v2/09 只有 ENU-11（**工作侧**九项，
 *      v2/04 §六），无任职结清八项条目 → 用 item 名＋逐项状态（不设封闭枚举）。
 *   3. REC-LIFE-08 缺失事实值（未设岗/空编/单元缺位）未在 v2/09 登记 → 取 §3.1 正文中文名（同 REPORT 节名先例）。
 *   4. 一级单元字段（unitCount/units[]/domain/headRef/vacancyState）＝GAP-V2-17，不属本单冻结物：本文件不为 SCH-ORG-01
 *      增字段，只给「单元域不重叠」「缺位期不新增 G8」的判据输入（NEG-ORG-13/14 的 V1 腿）。
 */
import {
  DecisionFaceSchema,
  EffectiveSlotSchema,
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
import { z } from 'zod'

// —— §1 记录类型登记（v2/11 §1.2：任职 01..06＋组织 07..11）——
/** v2/11 §1.2 LIFE 生命周期族 11 类（序即 §1.2 表序） */
export const LIFE_RECORD_TYPES = [
  'REC-LIFE-01', 'REC-LIFE-02', 'REC-LIFE-03', 'REC-LIFE-04', 'REC-LIFE-05', 'REC-LIFE-06',
  'REC-LIFE-07', 'REC-LIFE-08', 'REC-LIFE-09', 'REC-LIFE-10', 'REC-LIFE-11',
] as const

export type LifeRecordType = (typeof LIFE_RECORD_TYPES)[number]

// —— §2 枚举投影（v2/09 主表；本文件不新立取值）——
/** ENU-01 任职六状态（空缺走 vacancy_state 字段，不作状态取值）｜ENU-02 公司身份四态（终态不复活） */
export const EMPLOYMENT_STATES = ['candidate', 'active', 'suspended', 'handover', 'settling', 'retired'] as const
export const EmploymentStateSchema = z.enum(EMPLOYMENT_STATES)
export type EmploymentState = (typeof EMPLOYMENT_STATES)[number]

export const IDENTITY_STATES = ['active', 'suspended', 'liquidated', 'dissolved'] as const
export const IdentityStateSchema = z.enum(IDENTITY_STATES)
export type IdentityState = (typeof IDENTITY_STATES)[number]

/** ENU-30 任命四类型（外部任职不设第五类型，走外部叠加标记） */
export const APPOINTMENT_KINDS = ['appointment', 'concurrent', 'acting', 'succession'] as const
export const AppointmentKindSchema = z.enum(APPOINTMENT_KINDS)

/** ENU-34 组织事件类别（含 2026-10-28 增补四值：一级单元设立/撤销/缺位、N 变更） */
export const ORG_EVENT_KINDS = [
  'level_change', 'position_create', 'vacancy_register', 'department_create', 'department_dissolve',
  'unit_create', 'unit_dissolve', 'unit_vacancy', 'unit_count_change',
] as const
export const OrgEventKindSchema = z.enum(ORG_EVENT_KINDS)

/** ENU-40 生涯事件三型｜ENU-35 连续性操作五值｜ENU-36 移交接受三值（REC-LIFE-10） */
export const CAREER_CHANGE_KINDS = ['capability_change', 'qualification_change', 'appointment_change'] as const
export const CareerChangeKindSchema = z.enum(CAREER_CHANGE_KINDS)

export const CONTINUITY_OPERATIONS = ['merge', 'absorb', 'split', 'consortium', 'successor_establish'] as const
export const ContinuityOperationSchema = z.enum(CONTINUITY_OPERATIONS)

export const TRANSFER_ACCEPTANCES = ['accepted', 'conditional', 'rejected'] as const
export const TransferAcceptanceSchema = z.enum(TRANSFER_ACCEPTANCES)

/** ENU-125 任职结清面（两段式，互不代签）｜ENU-126 结清项状态（reservation 须列责任者与到期） */
export const SETTLEMENT_FACES = ['handover_face', 'settlement_face'] as const
export const SettlementFaceSchema = z.enum(SETTLEMENT_FACES)
export const SETTLEMENT_ITEM_STATES = ['closed', 'reservation', 'open'] as const
export const SettlementItemStateSchema = z.enum(SETTLEMENT_ITEM_STATES)

/** §3.1 正文的中文机器字面（v2/09 未登记——缺口 3） */
export const VACANCY_LAYER_FACTS = ['未设岗', '空编', '单元缺位'] as const
export const VacancyLayerFactSchema = z.enum(VACANCY_LAYER_FACTS)

// —— §3 任职六状态迁移边（§14.2 L-01..L-10；表外即非法，一律拒写）——
export const EMPLOYMENT_TRANSITIONS = [
  { edge: 'L-01', from: null, to: 'candidate' }, { edge: 'L-02', from: 'candidate', to: 'active' },
  { edge: 'L-03', from: 'candidate', to: 'retired' }, { edge: 'L-04', from: 'active', to: 'suspended' },
  { edge: 'L-05', from: 'suspended', to: 'active' }, { edge: 'L-06', from: 'suspended', to: 'handover' },
  { edge: 'L-07', from: 'active', to: 'handover' }, { edge: 'L-08', from: 'handover', to: 'settling' },
  { edge: 'L-09', from: 'settling', to: 'retired' }, { edge: 'L-10', from: 'retired', to: 'candidate' },
] as const

/** 某一状态的全部合法出口（非法迁移须返回「当前状态/期望状态/合法出口列表」——§3.1 REC-LIFE-02） */
export function legalEmploymentExits(from: EmploymentState | null): EmploymentState[] {
  return EMPLOYMENT_TRANSITIONS.filter((edge) => edge.from === from).map((edge) => edge.to)
}

/** 「无异议」的缺省合法表示（v2/09 未登记机器值——按 §3.1 正文中文表示；判定见 validateEmploymentTransition） */
export const NO_DISSENT_DEFAULT_LITERALS = ['无异议'] as const

/** §14.2「前置记录」列（边→必引记录类型）：无该前置证据不得上任/交接/退役/重新任职 */
/** 键形 `from->to`（与 validateEmploymentTransition 判定式同形；`start->candidate` 表示建档边 L-01） */
export const EMPLOYMENT_EDGE_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  'candidate->active': ['REC-LIFE-01'], 'handover->settling': ['REC-LIFE-03'],
  'settling->retired': ['REC-LIFE-03'], 'retired->candidate': ['REC-LIFE-01'],
}

// —— §4 REC-LIFE-01 任命与任职关系（G9 必引 root_delegation；G8 双角色；跨空缺层说明）——
export const EntryGateResultSchema = z.strictObject({ satisfied: z.boolean(), basis_ref: RecordRefSchema.optional(), note: z.string().min(1).optional() })

/** 「内部老板双角色」标注（§3.1 `dual_role_record`，条件必填）：同体提名/任免必填，缺＝程序非法（不是自授豁免） */
export const DualRoleRecordSchema = z.strictObject({
  dual_role_label: z.literal('内部老板双角色'),
  proposer_record_ref: RecordRefSchema,
  external_audit_sample_ref: RecordRefSchema,
})

export const VacancyLayerNoteSchema = z.strictObject({
  skipped_layers: z.array(z.strictObject({ layer: z.string().min(1), missing_fact: VacancyLayerFactSchema })).min(1),
  substitute_evaluation_source: z.string().min(1),
  rationale: z.string().min(1),
})

export const VacancyStateSchema = z.strictObject({
  position_ref: ObjectRefSchema,
  since: TimestampSchema,
  acting_holder_ref: ObjectRefSchema.optional(),
  substitute_trigger: z.string().min(1),
})

/** REC-LIFE-01 payload（§3.1 字段表序；幂等键＝四元组，§0.4-5） */
export const AppointmentPayloadSchema = z.strictObject({
  appointment_kind: AppointmentKindSchema,
  position_ref: ObjectRefSchema,
  holder_ref: ObjectRefSchema,
  /** 代理/替补须同时写被替者（§3.1） */
  substituted_holder_ref: ObjectRefSchema.optional(),
  nomination_ref: RecordRefSchema,
  /** +2 任免权源（G9＝外部老板；G8＝最高宰相） */
  appointing_authority_ref: RecordRefSchema,
  /** +1 提议记录（+2 生效前提；无 +1 提议的 +2 任免程序非法——v2/03 §3.3 规则 1） */
  decision_basis_ref: RecordRefSchema,
  /** G9 记录必填：→REC-AUTH-01 根授予；缺失即任命不得生效（§3.1/§十五-2） */
  root_delegation_ref: RecordRefSchema.optional(),
  dual_role_record: DualRoleRecordSchema.optional(),
  vacancy_layer_note: VacancyLayerNoteSchema.optional(),
  /** 撤换/退出所依据的另一已发生决定（任期届满依 term 退出可空） */
  revocation_decision_ref: RecordRefSchema.optional(),
  scope: z.strictObject({ duties: z.string().min(1), forbidden: z.array(z.string().min(1)) }),
  /** 任期起止与届满处置（届满不自动续任——§3.1） */
  term: z.strictObject({ from: TimestampSchema, to: TimestampSchema, expiry_disposition: z.string().min(1) }),
  rank_interface_ref: ObjectRefSchema.optional(),
  /** →REC-CAP-02＋版本＋期限（可空须声明） */
  qualification_refs: z.array(RecordRefSchema),
  /** 资格空缺时的补证计划（§3.1） */
  qualification_gap_plan: z.string().min(1).optional(),
  /** →REC-LIFE-05 累计禁配结论（跨位置/部署/账号累计，不重置） */
  conflict_check_ref: RecordRefSchema,
  /** 任职者明示接受（决定≠接受；机器值集未登记——缺口 1） */
  acceptance_state: z.string().min(1),
  acceptance_time: TimestampSchema.optional(),
  acceptance_conditions: z.array(z.string().min(1)).optional(),
  /** 任命生效五条件核验结论（随任命记录落盘——v2/02 §二） */
  entry_gate_results: z.strictObject({
    authority: EntryGateResultSchema, qualification: EntryGateResultSchema, conflict: EntryGateResultSchema,
    handover: EntryGateResultSchema, acceptance: EntryGateResultSchema,
  }),
  /** →REC-LIFE-03 交接面；未完成不得宣称就任完成 */
  handover_ref: RecordRefSchema.optional(),
  handover_completion: z.string().min(1).optional(),
  vacancy_state: VacancyStateSchema.optional(),
  /** 任命幂等键四元组（位置引用＋任职者＋任期起点＋拟任版本——§0.4-5 唯一口径） */
  idempotency_four_tuple: z.strictObject({
    position_ref: ObjectRefSchema, holder_ref: ObjectRefSchema, term_start: TimestampSchema, proposed_version: z.string().min(1),
  }),
  decision_face: DecisionFaceSchema,
})

export const AppointmentRecordSchema = recordEnvelopeSchema(AppointmentPayloadSchema, 'REC-LIFE-01')

/** 任命判定输入（结构判据与权源解析的输入面——记录不复制 v2/03 权力树/表 A） */
export interface AppointmentContext {
  /** 位置职级判据（v2/03 §2.2/§3.3）：G9 最高宰相｜G8 一级单元首长｜G8 部门首长｜其他 */
  positionGrade: 'G9' | 'G8_unit_head' | 'G8_dept_head' | 'other'
  /** 任免者主体类别（G9＝外部老板；G8＝最高宰相） */
  appointingAuthorityClass: SubjectClass
  /** 提名者主体类别（G9＝外部老板；G8 单元首长＝最高宰相或另一单元首长） */
  nominatorClass: SubjectClass
  /** 职级差（>2 须带 vacancy_layer_note——v2/03 §3.3 规则 3）｜是否跨空缺层（含单元缺位直管）｜单元是否缺位 */
  rankGap?: number
  crossesVacancy?: boolean
  unitVacant?: boolean
}

// —— §5 REC-LIFE-02 任职状态迁移（决定面封闭清单成员；每态必附期限或复审条件）——
export const EmploymentTransitionPayloadSchema = z.strictObject({
  from_state: EmploymentStateSchema.nullable(),
  to_state: EmploymentStateSchema,
  trigger_ref: RecordRefSchema,
  /** 权源（不写「系统判定」——§3.1） */
  authority_ref: RecordRefSchema,
  precondition_results: z.array(z.strictObject({ item: z.string().min(1), satisfied: z.boolean(), basis: z.string().min(1) })),
  expected_version: z.string().min(1),
  /** 实际行为人（与写入者分开——§0.2） */
  actual_actor: z.string().min(1),
  /** 异议位置（来源白名单；「无异议」为合法表示） */
  dissent_position: z.string().min(1),
  dissent_source_ref: RecordRefSchema.optional(),
  /** 每态必附期限或复审条件（I-11；无限期暂停＝负例） */
  review_terms: z.strictObject({ deadline: TimestampSchema.optional(), review_condition: z.string().min(1).optional() }),
  side_effects: z.array(z.string().min(1)),
  /** 前置证据（§14.2 表「前置记录」列） */
  evidence_refs: z.array(RecordRefSchema).min(1),
  produced_refs: z.array(RecordRefSchema),
  decision_face: DecisionFaceSchema,
})

export const EmploymentTransitionRecordSchema = recordEnvelopeSchema(EmploymentTransitionPayloadSchema, 'REC-LIFE-02')

// —— §6 REC-LIFE-03 任职结清核验（两段式；与工作结清互不代签）——
/** 结清清单项（§3.1 八类：在途工作与承诺/资源与账户/信息与记录/记忆/授权与访问/外部关系/历史与证据/待处理救济；
 * 取值集主表缺失＝缺口 2 → item 名＋逐项状态）。 */
export const SettlementChecklistItemSchema = z.strictObject({
  item: z.string().min(1),
  state: SettlementItemStateSchema,
  /** reservation 时必填：责任者与到期 */
  reservation_owner: z.string().min(1).optional(),
  reservation_due: TimestampSchema.optional(),
})

export const EmploymentSettlementPayloadSchema = z.strictObject({
  subject: RecordRefSchema,
  /** 交接面/结清面两用（ENU-125；两段式互不代签） */
  face: SettlementFaceSchema,
  checklist_items: z.array(SettlementChecklistItemSchema).min(1),
  reservations: z.array(z.string().min(1)),
  verified_scope: z.string().min(1),
  dissent: z.string().min(1),
  decision_face: DecisionFaceSchema,
})

export const EmploymentSettlementRecordSchema = recordEnvelopeSchema(EmploymentSettlementPayloadSchema, 'REC-LIFE-03')

// —— §7 REC-LIFE-04 出工段 / 05 任职登记与禁配申报 / 06 生涯事件 ——
export const WorkSegmentPayloadSchema = z.strictObject({
  holder_ref: ObjectRefSchema,
  /** →REC-LIFE-01 生效版本（出工必引生效任命；任命未生效不得出工——§十五-2） */
  appointment_ref: RecordRefSchema,
  plan_ref: RecordRefSchema,
  authorization_result: RecordRefSchema,
  segment_gate_check: z.array(z.strictObject({ face: z.string().min(1), satisfied: z.boolean() })).min(1),
  inputs_snapshot: z.array(z.string().min(1)),
  decision_basis: z.string().min(1),
  start_end_pauses: z.array(z.strictObject({ reason: z.string().min(1), until: TimestampSchema })).optional(),
  action_receipts: z.array(RecordRefSchema),
  artifacts_and_evidence: z.array(RecordRefSchema),
  open_items: z.array(z.string().min(1)),
  known_incapabilities: z.array(z.string().min(1)),
})
export const WorkSegmentRecordSchema = recordEnvelopeSchema(WorkSegmentPayloadSchema, 'REC-LIFE-04')

export const EmploymentRegistryPayloadSchema = z.strictObject({
  holder_ref: ObjectRefSchema,
  /** 全部现有任职＋仍有影响的历史关系（主体同一：按任职者累计——§3.1） */
  holdings: z.array(RecordRefSchema),
  interest_declarations: z.array(z.strictObject({ content: z.string().min(1), source: z.string().min(1), declared_at: TimestampSchema })),
  avoidance_arrangements: z.array(z.string().min(1)),
  conflict_check: z.strictObject({ conclusion: z.string().min(1), basis: z.string().min(1), checked_at: TimestampSchema, checker: z.string().min(1) }),
  cumulative_view: z.string().min(1),
  check_points: z.array(z.string().min(1)),
})
export const EmploymentRegistryRecordSchema = recordEnvelopeSchema(EmploymentRegistryPayloadSchema, 'REC-LIFE-05')

export const CareerEventPayloadSchema = z.strictObject({
  event_kind: CareerChangeKindSchema,
  subject: ObjectRefSchema,
  /** →REC-CAP-02 / REC-LIFE-01 / REC-CHG-01（三类变化各有权源，不能打包绕过——§3.1） */
  change_ref: RecordRefSchema,
  constraints: z.array(z.string().min(1)),
  ...EffectiveSlotSchema.shape,
})
export const CareerEventRecordSchema = recordEnvelopeSchema(CareerEventPayloadSchema, 'REC-LIFE-06')

// —— §8 REC-LIFE-07..11 组织侧 ——
export const IdentityTransitionPayloadSchema = z.strictObject({
  from_state: IdentityStateSchema,
  to_state: IdentityStateSchema,
  decided_by: z.string().min(1),
  basis: z.array(z.string().min(1)).min(1),
  notice: z.string().min(1),
  dissent_position: z.string().min(1),
  /** 未结项承接者/接受范围/期限（终止类必填） */
  settlement_state: z.string().min(1).optional(),
  generation_effect: z.string().min(1),
  decision_face: DecisionFaceSchema,
})
export const IdentityTransitionRecordSchema = recordEnvelopeSchema(IdentityTransitionPayloadSchema, 'REC-LIFE-07')

/** 一级单元标识与 N 计数（REC-LIFE-08 `unit_ref`；**不是** GAP-V2-17 的 SCH-ORG-01 字段） */
export const UnitRefSchema = z.strictObject({
  unitId: z.string().min(1),
  /** N 计数变更前后值（N≥1，默认 1；不得写死 3——§3.2/§十五-2） */
  unit_count_before: z.number().int().min(1).nullable(),
  unit_count_after: z.number().int().min(1),
})

/** 单元缺位规则（REC-LIFE-08 `vacancy_rule`，unit_vacancy 必填——§3.2） */
export const VacancyRuleSchema = z.strictObject({
  /** 最高宰相直管安排 */
  acting_management: z.string().min(1),
  /** 缺位期禁止新增该单元 G8 */
  no_new_g8_during_vacancy: z.boolean(),
  /** 紧急例外是否触发双角色记录与外部审计抽样 */
  emergency_exception: z.strictObject({
    triggered: z.boolean(),
    dual_role_record_ref: RecordRefSchema.optional(),
    external_audit_sample_ref: RecordRefSchema.optional(),
  }),
})

export const OrgEventPayloadSchema = z
  .strictObject({
    event_kind: OrgEventKindSchema,
    /** 判据结构事实（在编结构核对，非声明；「只改 level 字段」无效——§3.2） */
    structure_evidence: z.array(z.string().min(1)).min(1),
    decided_by: z.string().min(1),
    /** 一级单元类事件必填（单元标识＋N 计数变更前后值） */
    unit_ref: UnitRefSchema.optional(),
    /** 空编与单元缺位必附复审期限；超期补设或降级二选一必答 */
    review_terms: z.strictObject({ deadline: TimestampSchema, fallback: z.string().min(1) }).optional(),
    /** 单元缺位必填（unit_vacancy） */
    vacancy_rule: VacancyRuleSchema.optional(),
    dissent_position: z.string().min(1),
  })
  .superRefine((v, ctx) => {
    const unitKinds: readonly string[] = ['unit_create', 'unit_dissolve', 'unit_vacancy', 'unit_count_change']
    const rules: [boolean, string[], string][] = [
      [unitKinds.includes(v.event_kind) && v.unit_ref === undefined, ['unit_ref'], '一级单元类事件必填 unit_ref（单元标识＋N 计数变更前后值——§3.2）'],
      [v.event_kind === 'unit_vacancy' && v.vacancy_rule === undefined, ['vacancy_rule'], '单元缺位必填 vacancy_rule（直管安排＋缺位期禁新增 G8＋紧急例外——§3.2）'],
      [(v.event_kind === 'unit_vacancy' || v.event_kind === 'vacancy_register') && v.review_terms === undefined, ['review_terms'], '空编/单元缺位必附复审期限与超期处置（空编不得静默——§3.2）'],
      // N 是配置参数（默认 1），不是规范常量：把 3 写死＝结构判据造假
      [v.event_kind === 'unit_count_change' && v.unit_ref?.unit_count_after === 3, ['unit_ref', 'unit_count_after'], 'N 变更不得写死 3（N≥1，默认 1——§3.2/§十五-2）'],
    ]
    for (const [violated, path, message] of rules) if (violated) ctx.addIssue({ code: 'custom', path, message })
  })

export const OrgEventRecordSchema = recordEnvelopeSchema(OrgEventPayloadSchema, 'REC-LIFE-08')

/** 终止两角（REC-LIFE-09 `terminal_roles`；I-16：(c) 裁决两角分设不得同体） */
export const TerminalRolesSchema = z.strictObject({
  /** 现实存在、独立于公司且独立于交付链的接收者 */
  external_receiver_ref: ObjectRefSchema,
  /** 残余责任主体＝外部老板 */
  residual_subject_ref: ObjectRefSchema,
  /** 两角不得同体：为假即拒写（§十五-2） */
  distinct_confirmed: z.boolean(),
})

export const ContinuityDecisionPayloadSchema = z
  .strictObject({
    operation: ContinuityOperationSchema,
    /** 终止/清算类必填（(c) 裁决） */
    terminal_roles: TerminalRolesSchema.optional(),
      parties: z.array(z.strictObject({ party_ref: ObjectRefSchema, role: z.string().min(1), identity_state: IdentityStateSchema })).min(2),
    identity_arrangement: z.string().min(1),
    commitments_assumed: z.array(z.strictObject({ commitment_ref: RecordRefSchema, counterparty_procedure_state: z.string().min(1) })),
    obligations_assumed: z.array(RecordRefSchema),
    appointments: z.array(z.strictObject({ appointment_ref: RecordRefSchema, disposition: z.string().min(1) })),
    lineage_links: z.array(z.string().min(1)).min(1),
    authority_plan: z.string().min(1),
    conflicts_kept: z.array(z.string().min(1)),
    dissent_and_remedy: z.string().min(1),
    scope_judged: z.strictObject({ judged: z.array(z.string().min(1)).min(1), not_judged: z.array(z.string().min(1)) }),
    decision_face: DecisionFaceSchema,
  })
  .superRefine((v, ctx) => {
    const surviving = v.parties[0]
    if (surviving !== undefined && ['liquidated', 'dissolved'].includes(surviving.identity_state)) {
      ctx.addIssue({ code: 'custom', path: ['parties', 0, 'identity_state'], message: '存续方只能 active（终态不复活——§3.2）' })
    }
  })

export const ContinuityDecisionRecordSchema = recordEnvelopeSchema(ContinuityDecisionPayloadSchema, 'REC-LIFE-09')

export const TransferArchivePayloadSchema = z
  .strictObject({
    scope: z.string().min(1),
    in_flight: z.array(z.string().min(1)),
    pending_obligations: z.array(RecordRefSchema),
    resources_and_access: z.array(z.string().min(1)),
    qualifications: z.array(z.strictObject({ item: z.string().min(1), revalidated: z.boolean(), note: z.string().min(1) })),
    credentials_and_links: z.array(z.string().min(1)),
    memory_disposition: z.string().min(1),
    authority_state: z.string().min(1),
    capability_and_rules: z.string().min(1),
    submission: z.string().min(1),
    verification: z.string().min(1),
    acceptance: TransferAcceptanceSchema,
    /** 拒绝时必填（§3.2） */
    rejection_reason: z.string().min(1).optional(),
    dissent_position: z.string().min(1),
    conditions: z.array(z.string().min(1)),
    acceptor: ObjectRefSchema,
  })
  .superRefine((v, ctx) => {
    if (v.acceptance === 'rejected' && v.rejection_reason === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rejection_reason'], message: '拒绝时必填 rejection_reason（§3.2 REC-LIFE-10）' })
    }
  })

export const TransferArchiveRecordSchema = recordEnvelopeSchema(TransferArchivePayloadSchema, 'REC-LIFE-10')

export const LossReportPayloadSchema = z.strictObject({
  scope: z.string().min(1),
  unrepresentable: z.array(z.string().min(1)),
  unmigratable: z.array(z.string().min(1)),
  unverified: z.array(z.string().min(1)),
  uncovered_obligations: z.array(z.string().min(1)),
  compensating_controls: z.array(z.string().min(1)),
  decision_options: z.array(z.string().min(1)),
  /** 可空＝未决定（§3.2；损失须在接收前列出） */
  decided_by: z.string().min(1).nullable(),
})
export const LossReportRecordSchema = recordEnvelopeSchema(LossReportPayloadSchema, 'REC-LIFE-11')

// —— §9 判定件（纯函数；不抛错） ——
/** 形状闸：按 recordType 取本族 schema 解析 */
export const LIFE_RECORD_SCHEMAS: Readonly<Record<LifeRecordType, z.ZodType>> = {
  'REC-LIFE-01': AppointmentRecordSchema, 'REC-LIFE-02': EmploymentTransitionRecordSchema, 'REC-LIFE-03': EmploymentSettlementRecordSchema,
  'REC-LIFE-04': WorkSegmentRecordSchema, 'REC-LIFE-05': EmploymentRegistryRecordSchema, 'REC-LIFE-06': CareerEventRecordSchema,
  'REC-LIFE-07': IdentityTransitionRecordSchema, 'REC-LIFE-08': OrgEventRecordSchema, 'REC-LIFE-09': ContinuityDecisionRecordSchema,
  'REC-LIFE-10': TransferArchiveRecordSchema, 'REC-LIFE-11': LossReportRecordSchema,
}

/**
 * REC-LIFE-01 判定（§3.1/§十五-2）——规则表逐条判，任一命中即拒写：
 *   G9 必引 root_delegation（REC-AUTH-01）且任免者/提名者＝外部老板；G8 一级单元首长须双角色标注或另一单元首长提议；
 *   G8 部门首长须引一级单元首长提议；跳级（>2）/跨空缺层须 vacancy_layer_note；缺位期不得新增 G8；
 *   五条件齐备且接受才可置生效（决定≠接受）。
 */
export function validateAppointment(record: unknown, ctx: AppointmentContext): RecordValidationOutcome {
  const parsed = AppointmentRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const envelope = parsed.data
  const payload = envelope.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(envelope)]
  const g9 = ctx.positionGrade === 'G9'
  const unitHead = ctx.positionGrade === 'G8_unit_head'
  const deptHead = ctx.positionGrade === 'G8_dept_head'
  const proposerTypes: readonly string[] = ['REC-AUTH-01', 'REC-LIFE-01', 'REC-DEC-01']
  const crosses = (ctx.rankGap !== undefined && ctx.rankGap > 2) || ctx.crossesVacancy === true
  const gates = payload.entry_gate_results
  const unmet = envelope.effectiveState === 'effective' ? (Object.keys(gates) as (keyof typeof gates)[]).filter((gate) => !gates[gate].satisfied) : []
  const rules: [boolean, string, string][] = [
    [crosses && payload.vacancy_layer_note === undefined, 'payload.vacancy_layer_note', '跳级任免（职级差 >2）或跨空缺层须带 vacancy_layer_note（缺失事实＋替代评价来源＋理由——§3.1/§十五-2）'],
    [g9 && payload.root_delegation_ref === undefined, 'payload.root_delegation_ref', 'G9（最高宰相）任命必引 root_delegation——缺失即任命不得生效（§3.1/§十五-2）'],
    [g9 && payload.root_delegation_ref !== undefined && payload.root_delegation_ref.refType !== 'REC-AUTH-01', 'payload.root_delegation_ref.refType', 'root_delegation_ref 须指向 REC-AUTH-01（grant_class=root_delegation）'],
    [g9 && ctx.appointingAuthorityClass !== 'external_owner', 'payload.appointing_authority_ref', 'G9 任命者须为外部老板（任免最高宰相是保留给外部的动作——v2/03 §3.1）'],
    [g9 && ctx.nominatorClass !== 'external_owner', 'payload.decision_basis_ref', 'G9 提名者须为外部老板（+1 提议记录）'],
    [unitHead && ctx.nominatorClass === 'internal_boss' && payload.dual_role_record === undefined, 'payload.dual_role_record', '最高宰相提名/任免同体时必带「内部老板双角色」标注（缺＝程序非法，不是自授豁免——§3.3 规则 1）'],
    [unitHead && ctx.nominatorClass !== 'internal_boss' && ctx.nominatorClass !== 'internal_position', 'payload.decision_basis_ref', 'G8 单元首长提名者须为最高宰相本人或另一单元首长（§2.2/§3.3）'],
    [unitHead && ctx.appointingAuthorityClass !== 'internal_boss' && ctx.appointingAuthorityClass !== 'external_owner', 'payload.appointing_authority_ref', 'G8 单元首长任免者须为最高宰相（或单元缺位期的外部处置——§3.1）'],
    [deptHead && !proposerTypes.includes(payload.decision_basis_ref.refType), 'payload.decision_basis_ref.refType', 'G8 部门首长须引一级单元首长的提议记录（+1 提议——§3.3 规则 1）'],
    [deptHead && ctx.appointingAuthorityClass !== 'internal_boss', 'payload.appointing_authority_ref', 'G8 部门首长任免者须为最高宰相（提议者可为一单元首长）'],
    [ctx.unitVacant === true && !g9 && payload.dual_role_record === undefined, 'payload.dual_role_record', '缺位期该单元不得新增 G8（紧急例外须最高宰相双角色记录＋外部审计抽样——§3.2/v2/03 §2.2 注）'],
    [envelope.effectiveState === 'effective' && unmet.length > 0, 'payload.entry_gate_results', `生效前五条件须齐备（未过：${unmet.join('/')}——§3.1/v2/02 §二）`],
    [envelope.effectiveState === 'effective' && payload.acceptance_time === undefined, 'payload.acceptance_time', '生效须有任职者明示接受（决定≠接受——§3.1）'],
  ]
  for (const [violated, path, message] of rules) if (violated) checks.push(recordReject(path, message))
  return mergeOutcomes(...checks)
}

/**
 * REC-LIFE-02 判定（§14.2/§3.1）：
 *   ① from→to 必在 L-01..L-10 边集内（表外即非法；拒写时返回合法出口列表）；
 *   ② 每态必附期限或复审条件（无限期暂停＝负例，I-11）；
 *   ③ 异议位置只可因「缺载且无『无异议』表示」拒写——不得因「无异议」本身拒写。
 */
export function validateEmploymentTransition(record: unknown): RecordValidationOutcome {
  const parsed = EmploymentTransitionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const payload = parsed.data.payload
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const edges = EMPLOYMENT_TRANSITIONS.filter((edge) => edge.from === payload.from_state && edge.to === payload.to_state)
  if (edges.length === 0) {
    const legal = legalEmploymentExits(payload.from_state)
    checks.push(recordReject('payload.to_state', `非法迁移 ${payload.from_state ?? '∅'}→${payload.to_state}（当前 ${payload.from_state ?? '∅'}；合法出口 ${legal.join('/') || '无（终态）'}——表外即非法，§14.2）`))
  }
  if (payload.review_terms.deadline === undefined && payload.review_terms.review_condition === undefined) {
    checks.push(recordReject('payload.review_terms', '每态必附期限或复审条件（无限期暂停违反 I-11——§3.1）'))
  }
  const required = EMPLOYMENT_EDGE_EVIDENCE[`${payload.from_state ?? 'start'}->${payload.to_state}`] ?? []
  const evidenceTypes = new Set(payload.evidence_refs.map((ref) => ref.refType))
  for (const type of required) {
    if (!evidenceTypes.has(type)) {
      checks.push(recordReject('payload.evidence_refs', `该边必引前置记录 ${type}（§14.2 前置记录列：未结清不得宣称退役/未生效不得上任）`))
    }
  }
  const dissentLiteral = payload.dissent_position.trim()
  if (payload.dissent_source_ref === undefined && !(NO_DISSENT_DEFAULT_LITERALS as readonly string[]).includes(dissentLiteral)) {
    checks.push(recordReject('payload.dissent_position', '异议位置缺载且无「无异议」表示（只可因「缺载且无表示」拒写——不得因「无异议」本身拒写，§3.1）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-LIFE-03 判定：两段式互不代签；reservation 须列责任者与到期（ENU-126/§3.1） */
export function validateEmploymentSettlement(record: unknown): RecordValidationOutcome {
  const parsed = EmploymentSettlementRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  for (const [index, item] of parsed.data.payload.checklist_items.entries()) {
    if (item.state === 'reservation' && (item.reservation_owner === undefined || item.reservation_due === undefined)) {
      checks.push(recordReject(`payload.checklist_items.${index}`, '保留事项须列责任者与到期（ENU-126）'))
    }
  }
  return mergeOutcomes(...checks)
}

/** REC-LIFE-07 判定：身份四态只走 §14.3 边；终态不复活（O-05 禁止边——§3.2） */
export function validateIdentityTransition(record: unknown): RecordValidationOutcome {
  const parsed = IdentityTransitionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const { from_state: from, to_state: to } = parsed.data.payload
  const legal =
    (from === 'active' && (to === 'suspended' || to === 'liquidated')) ||
    (from === 'suspended' && (to === 'active' || to === 'liquidated')) ||
    (from === 'liquidated' && to === 'dissolved')
  const checks: RecordValidationOutcome[] = [
    checkEffectiveSlotConsistency(parsed.data),
    legal ? { ok: true } : recordReject('payload.to_state', `非法身份迁移 ${from}→${to}（终态不复活；只能新设身份逐项承继——§14.3/§3.2）`),
  ]
  if (from === 'liquidated' && parsed.data.payload.settlement_state === undefined) {
    checks.push(recordReject('payload.settlement_state', '清算/解散须写未结项承接者、接受范围与期限（§3.2 REC-LIFE-07）'))
  }
  return mergeOutcomes(...checks)
}

/** REC-LIFE-08 判定：形状闸＋生效槽一致性（CL 判据/空编/缺位由 payload superRefine 承载） */
export function validateOrgEvent(record: unknown): RecordValidationOutcome {
  const parsed = OrgEventRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  return mergeOutcomes(checkEffectiveSlotConsistency(parsed.data))
}

/** REC-LIFE-09 判定：终止两角分设（distinct_confirmed 为假/两角同体即拒写——I-16/§十五-2） */
export function validateContinuityDecision(record: unknown): RecordValidationOutcome {
  const parsed = ContinuityDecisionRecordSchema.safeParse(record)
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) }
  const checks: RecordValidationOutcome[] = [checkEffectiveSlotConsistency(parsed.data)]
  const roles = parsed.data.payload.terminal_roles
  if (roles !== undefined) {
    if (!roles.distinct_confirmed) {
      checks.push(recordReject('payload.terminal_roles.distinct_confirmed', '终止两角不得同体（external_receiver_ref 与 residual_subject_ref 分设——I-16/§十五-2）'))
    }
    if (roles.external_receiver_ref.refId === roles.residual_subject_ref.refId) {
      checks.push(recordReject('payload.terminal_roles', '终止两角引用同一主体＝同体（I-16 判负）'))
    }
  }
  return mergeOutcomes(...checks)
}

// —— 一级单元结构判据（NEG-ORG-13/14 的 V1 腿；GAP-V2-17 未冻结 SCH-ORG-01 字段，此处只作判据输入）——

/** 单元对域的主张（判据输入，不是记录字段；结构权威判据在 v2/03 表 A 与 MIG-05 模型） */
export interface UnitDomainClaim {
  unitId: string
  /** 该单元主张的域（一单元一域） */
  domain: string
}

/**
 * 一级单元域边界判定（v2/03 表 A 注/§3.4/§八；NEG-ORG-13）：①同域两单元＝域重叠/双主表＝结构违规 ②同一单元多域＝
 * 越界（一单元一域）③跨单元冲突由最高宰相终裁（不在判定面）；N≥1、默认 1。 */
export function checkUnitDomainDisjoint(claims: readonly UnitDomainClaim[]): RecordValidationOutcome {
  const issues: { path: string; message: string }[] = []
  const domainOwner = new Map<string, string>()
  const unitDomains = new Map<string, Set<string>>()
  for (const [index, claim] of claims.entries()) {
    const owner = domainOwner.get(claim.domain)
    if (owner !== undefined && owner !== claim.unitId) {
      issues.push({ path: `claims.${index}.domain`, message: `域 ${claim.domain} 被两个一级单元同时主张（${owner}/${claim.unitId}）＝域重叠，结构违规判负（NEG-ORG-13/表 A 注）` })
    }
    domainOwner.set(claim.domain, claim.unitId)
    const domains = unitDomains.get(claim.unitId) ?? new Set<string>()
    if (domains.size > 0 && !domains.has(claim.domain)) {
      issues.push({ path: `claims.${index}.unitId`, message: `单元 ${claim.unitId} 主张多域＝越界（一单元一域——表 A 注）` })
    }
    domains.add(claim.domain)
    unitDomains.set(claim.unitId, domains)
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}
