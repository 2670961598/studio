/**
 * studio-tools 场景工具输入 schema（MCP-16 target 行「入参」列机器化）—— studio-dev-548
 *
 * 依据：docs/v2/14-§三 工具表「入参（简）」列逐行；strictObject=多余字段拒收（fail-closed 不猜）。
 * 边界：只做形状收口，不做判权（判权归 PORT-AUTH/端口，v2/14 §三铁律 1）；跨字段语义校验
 * （如交接包十项齐全）在 scenario-tools.ts 的 spec.check 里，不在 schema 层表达。
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// 输入 schema（v2/14 §三「入参」列逐行；strictObject=多余字段拒收，fail-closed 不猜）
// ---------------------------------------------------------------------------

/** 公司维（v2/14 §三 公司维列：必带；多公司视图隔离） */
const companyDim = z.string().min(1).describe('公司维（v2/14 §三：必带；多公司视图隔离锚）')

/** 人事六状态（v2/09 ENU-01；null 只表示入职前 ∅） */
const LifecycleStateSchema = z.enum(['candidate', 'active', 'suspended', 'handover', 'settling', 'retired'])

export const HrProfileAmendInput = z.strictObject({
  company: companyDim,
  subjectRef: z.string().min(1).describe('档案主体（本人工号或授权范围引用）'),
  patch: z.record(z.string().min(1), z.string()).describe('字段补丁（字段名→新值；修订候选，不直接改档）'),
  reason: z.string().min(1).describe('修订理由'),
  basis: z.string().min(1).describe('依据引用（制度/批示/记录 id）'),
})

export const HrAppointmentProposeInput = z.strictObject({
  company: companyDim,
  positionRef: z.string().min(1).describe('位置引用（v2/03 权力树）'),
  holderRef: z.string().min(1).describe('拟任职者引用'),
  nominationRef: z.string().min(1).describe('提名引用'),
  termStart: z.string().min(1).describe('任期起点（幂等键四元组之一，v2/11 §0.4-5）'),
  draftVersion: z.number().int().nonnegative().describe('拟任版本（幂等键四元组之一）'),
  appointmentType: z.enum(['appointment', 'concurrent', 'acting', 'succession']).describe('任命四类型（v2/09 ENU-30）'),
  scope: z.string().min(1).describe('任命范围/职责口径'),
})

export const HrTransitionRequestInput = z.strictObject({
  company: companyDim,
  employmentRef: z.string().min(1).describe('任职引用'),
  from: LifecycleStateSchema.nullable().describe('起始状态（null=入职前 ∅）'),
  to: LifecycleStateSchema.describe('目标状态'),
  trigger: z.strictObject({
    producer: z.enum(['initiator', 'decisive', 'rule']).describe('迁移生产者三分（v2/09 ENU-13）'),
    recordRef: z.string().min(1).describe('触发记录引用（须为前置记录）'),
  }),
  basis: z.string().min(1).describe('依据（申请回执按边触发者校验后进决定链）'),
})

export const HrInterestDeclareInput = z.strictObject({
  company: companyDim,
  subjectRef: z.string().min(1).describe('申报主体（任职者）'),
  holdings: z
    .array(
      z.strictObject({
        ref: z.string().min(1).describe('持有物/关系引用'),
        kind: z.string().min(1).describe('类别（股权/任职/合同/亲属…）'),
        relation: z.string().min(1).describe('与职责的利益关系描述'),
      }),
    )
    .min(1)
    .describe('持有与利益关系清单'),
  relations: z.array(z.string().min(1)).min(1).describe('需申报的利益关系（独立检查位置复核）'),
  reviewPeriod: z.string().min(1).describe('复核期（如 2026Q4）'),
})

export const FinLedgerReadInput = z.strictObject({
  company: companyDim,
  window: z
    .strictObject({
      from: z.string().min(1).describe('起始时刻（含）'),
      to: z.string().min(1).describe('结束时刻（含）'),
    })
    .describe('时间窗'),
  segments: z
    .array(z.enum(['budget', 'events', 'report']))
    .min(1)
    .describe('账段（预算/事件/月报；缺源段=unknown 不补 0）'),
  readScope: z.string().min(1).describe('知悉范围（v2/02 §八；多公司视图隔离）'),
})

export const FinCostguardStatusInput = z.strictObject({
  company: companyDim,
  issue: z.string().min(1).describe('本单 id（成本警戒线投影口径）'),
})

export const DevPermissionRequestInput = z.strictObject({
  company: companyDim,
  purpose: z.string().min(1).describe('申请的授予面用途'),
  scope: z.array(z.string().min(1)).min(1).describe('申请的权限范围（申请不是授权）'),
  term: z.string().min(1).describe('申请期限（如 30d）'),
  reason: z.string().min(1).describe('申请理由'),
})

/** 九维能力声明维度（v2/07 §一 中立能力/实现来源/宿主绑定/依赖冲突/输入输出/副作用请求/生命周期/观测成本/证据与已知不能） */
export const CAPABILITY_DIMENSIONS = [
  'neutral_capability_type',
  'implementation_source',
  'host_binding',
  'dependencies_conflicts',
  'io_known_limits',
  'side_effect_requests',
  'lifecycle',
  'observation_cost',
  'evidence_known_incapability',
] as const

export const DevCapabilityDeclareInput = z.strictObject({
  company: companyDim,
  claimant: z.string().min(1).describe('声明主体（声明是主张非认定）'),
  dimensions: z
    .strictObject({
      neutral_capability_type: z.string().min(1).describe('中立能力与类型'),
      implementation_source: z.string().min(1).describe('实现与来源'),
      host_binding: z.string().min(1).describe('宿主与绑定'),
      dependencies_conflicts: z.string().min(1).describe('依赖与冲突'),
      io_known_limits: z.string().min(1).describe('输入输出与已知限制'),
      side_effect_requests: z.string().min(1).describe('副作用请求（只是请求不是授权）'),
      lifecycle: z.string().min(1).describe('生命周期（哪些明确不支持）'),
      observation_cost: z.string().min(1).describe('观测与成本（盲区）'),
      evidence_known_incapability: z.string().min(1).describe('证据与已知不能'),
    })
    .describe('九维声明（v2/07 §一）'),
  version: z.number().int().positive().describe('声明版本'),
})

export const DevAssetRegisterInput = z.strictObject({
  company: companyDim,
  asset: z
    .strictObject({
      type: z.string().min(1).describe('资产类型（v2/06）'),
      sourceSummary: z.string().min(1).describe('来源摘要'),
      compatibility: z.string().min(1).describe('兼容性口径'),
      exclusive: z.boolean().describe('是否专属'),
    })
    .describe('资产条目（写入者=daemon/部署，登记是申请）'),
})

export const WorkIntakeInput = z.strictObject({
  company: companyDim,
  rawContent: z.string().min(1).describe('意图原文（raw_content）'),
  source: z.string().min(1).describe('来源（lead-brief/用户/外部）'),
  deadline: z.string().min(1).optional().describe('时限（RFC3339；缺省=无限期，不猜）'),
})

/** 交接包十项（v2/09 ENU-124、v2/04 §十：①合同与版本…⑩派生执行体与凭据清单） */
export const HANDOVER_ITEM_KINDS = [
  'contract_version',
  'in_flight_status',
  'progress_account',
  'evidence_open_issues',
  'resource_balance',
  'external_contacts_commitments',
  'risks_assumptions',
  'open_questions',
  'authorization_scope_expiry',
  'derived_executors_credentials',
] as const

export const WorkHandoverSubmitInput = z.strictObject({
  company: companyDim,
  context: z.string().min(1).describe('交接语境（换人/换能力/换班次）＋工作与合同版本引用'),
  items: z
    .array(
      z.strictObject({
        item: z.enum(HANDOVER_ITEM_KINDS).describe('十项之一（v2/09 ENU-124）'),
        presence: z.enum(['included', 'missing']).describe('已含/缺失'),
        disposition: z.string().min(1).optional().describe('缺失项去向（缺失不得留空）'),
      }),
    )
    .length(10)
    .describe('交接包十项（缺项须写「缺失＋去向」）'),
  continuityAnswers: z
    .strictObject({
      why: z.string().min(1).describe('为什么做'),
      where: z.string().min(1).describe('做到哪'),
      remaining: z.string().min(1).describe('还欠什么'),
      nextCriteria: z.string().min(1).describe('下一步按什么判据'),
    })
    .describe('连续性检验四问（v2/04 §十）'),
  derivedFace: z.string().min(1).describe('派生执行体与凭据清单（第⑩项展开）'),
  submission: z.string().min(1).describe('提交面（提交≠接收确认）'),
})
