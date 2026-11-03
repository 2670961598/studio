/**
 * studio-tools 场景工具面（MCP-16 target 行实装 + 注册）—— studio-dev-548
 *
 * 依据（文档先行；实现与文档冲突即停手）：
 *   - docs/v2/14-§三（studio-tools MCP 工具面；MCP-HR/FIN/DEV/GEN 表逐行：入参/出参/所需权限/
 *     署名主体/公司维）——本文件是那 11 行 target 的「schema/权限/rate」机器化落点；
 *   - docs/v2/14-§三 铁律 1（工具是端口前门，不新增权源）、铁律 2（除只读外一律落「请求/申报」
 *     型记录：员工用工具「申请」，不是「办成」——状态推进不经工具）、铁律 3（署名与公司维随
 *     调用必带）、铁律 4（内/外两面不得同名同表）；
 *   - docs/17-§2（主循环七相位：工具面不产生相位，只产请求/申报）、docs/17-§6（收割四要件：
 *     工具回执不是完成证据——完成只认落盘证据）。
 *
 * 边界（本单不越线）：
 *   - **不动契约面**：GATEWAY_ACTIONS（packages/contract/src/ports/gateway.ts）仍只含既有六动词。
 *     场景工具经注入端口 ScenarioPort 路由（PORT-AUTH.verify → 对应端口方法由装配方实现），
 *     不经 gateway.gateWrite——那会把表外动词送进 gw-action-unknown-verb，属自欺。
 *     「GATEWAY_ACTIONS 增 11 动词 + wkey scope 扩面」= 契约面子项，须报 Lead/制作人批
 *     （本单 §6 边界；migration 记录逐条留痕）。
 *   - **不新增错误族**：工具错误四族冻结（auth/gateway/deps/internal，tools.ts TOOL_ERROR_CATEGORIES）。
 *     速率闸与越权判定归 auth 族（subcause=rate-limited / authority-denied），不私开第五族。
 *   - **fail-closed**：无 wkey / 端口未装配 / 速率超限 / 端口判权拒 / 端口异常 → 一律结构化
 *     { ok:false, error:{category,subcause,message} }，不伪造回执、不渲染成功（L3P-09/10 同纪律）。
 *   - **注册面**：SCENARIO_TOOL_SPECS 由 server.ts 逐个 mcp.registerTool（tools/list 可见）；
 *     与 STUDIO_TOOLS 同 server、不同注册组——既有六工具 ↔ GATEWAY_ACTIONS 的一一对应钉不变。
 */
import { z } from 'zod'
import type { McpScenarioGroup } from './tools.ts'
import { DenyOutput } from './tools.ts'
import {
  DevAssetRegisterInput,
  DevCapabilityDeclareInput,
  DevPermissionRequestInput,
  FinCostguardStatusInput,
  FinLedgerReadInput,
  HANDOVER_ITEM_KINDS,
  HrAppointmentProposeInput,
  HrInterestDeclareInput,
  HrProfileAmendInput,
  HrTransitionRequestInput,
  WorkHandoverSubmitInput,
  WorkIntakeInput,
} from './scenario-schemas.ts'

// ---------------------------------------------------------------------------
// 工具名/ID（与 tools.ts MCP_SCENARIO_GROUPS 声明逐行对齐；由 scenario-tools.test.ts 钉死）
// ---------------------------------------------------------------------------

/** 场景工具名（11 行 target → registered；顺序=声明表顺序，tools/list 广告序） */
export const SCENARIO_TOOL_NAMES = [
  'hr.profileAmend',
  'hr.appointmentPropose',
  'hr.transitionRequest',
  'hr.interestDeclare',
  'fin.ledgerRead',
  'fin.costguardStatus',
  'dev.permissionRequest',
  'dev.capabilityDeclare',
  'dev.assetRegister',
  'work.intake',
  'work.handoverSubmit',
] as const

export type ScenarioToolName = (typeof SCENARIO_TOOL_NAMES)[number]

/** 工具名 → v2/14 §三 行号（MCP-<组>-<两位序号>） */
export const SCENARIO_TOOL_IDS: Readonly<Record<ScenarioToolName, string>> = {
  'hr.profileAmend': 'MCP-HR-01',
  'hr.appointmentPropose': 'MCP-HR-02',
  'hr.transitionRequest': 'MCP-HR-03',
  'hr.interestDeclare': 'MCP-HR-04',
  'fin.ledgerRead': 'MCP-FIN-01',
  'fin.costguardStatus': 'MCP-FIN-03',
  'dev.permissionRequest': 'MCP-DEV-01',
  'dev.capabilityDeclare': 'MCP-DEV-02',
  'dev.assetRegister': 'MCP-DEV-03',
  'work.intake': 'MCP-GEN-01',
  'work.handoverSubmit': 'MCP-GEN-03',
}

// ---------------------------------------------------------------------------
// 权限 / 速率 / 回执（v2/14 §三「所需权限」「出参」列）
// ---------------------------------------------------------------------------

/**
 * 权限标签（v2/14 §三「所需权限」列的机器可读投影）。
 * **工具面只登记不判权**：判权归 PORT-AUTH + 对应端口（铁律 1）——工具不冒充授权者。
 */
export const SCENARIO_AUTHORITIES = [
  'self-or-hr-position', // HR-01 本人档案=本人；他人=人事职能位（+1 提议）
  'position-plus1', // HR-02 拟任提议按位置 +1 链（v2/03 §3.3）
  'edge-trigger', // HR-03 按边触发者校验（v2/11 §14.2；辞职=本人）
  'incumbent-declare', // HR-04 任职者申报＋独立检查位置检查
  'finance-read-scope', // FIN-01 财务知悉范围（readScope 承载）
  'finance-issue-scope', // FIN-03 在岗者本单/本部门
  'any-incumbent-request', // DEV-01 任何任职者可申请（批准=授权者，+2 链）
  'self-claim', // DEV-02 声明来源/公司需求（声明是主张非认定）
  'dev-position-propose', // DEV-03 研发职能位提议；登记=daemon
  'incumbent-intake', // GEN-01 任职者（内部意图入口）
  'handover-issuer', // GEN-03 交出者（提交≠接收确认）
] as const

export type ScenarioAuthority = (typeof SCENARIO_AUTHORITIES)[number]

export interface ScenarioPermission {
  /** 所需权限标签（v2/14 §三） */
  readonly authority: ScenarioAuthority
  /** 署名主体（SEC-SIG-01：个人署名） */
  readonly subject: 'person'
  /** 公司维必带（v2/14 §三 公司维列：多公司视图隔离锚） */
  readonly companyRequired: true
}

/** 速率约束（工具面自保；auth 族 subcause=rate-limited——不新增第五错误族） */
export interface ScenarioLimits {
  readonly perMinute: number
}

/** 端口回执（请求/申报型；决定面不在此——铁律 2「申请不是办成」） */
export interface ScenarioReceipt {
  readonly receiptType: string
  readonly receiptRef: string
}

/** 回执类型必须与 v2/14 §三「出参」列一致（端口回错类型=内部故障，不渲染成功） */
export const ScenarioReceiptSchema = z.strictObject({
  receiptType: z.string().min(1),
  receiptRef: z.string().min(1),
  /** 恒为 false：工具面产「请求/申报」，决定由有权位置经端口作出 */
  decided: z.literal(false),
})

/** 只读投影（v2/14 §三 FIN 行「出参」：账视图/警戒线状态；缺源段=unknown，不补 0） */
export const ScenarioViewSchema = z.record(z.string(), z.unknown())

const ReceiptOkSchema = z.strictObject({
  ok: z.literal(true),
  tool: z.string().min(1),
  receipt: ScenarioReceiptSchema,
})

const ViewOkSchema = z.strictObject({
  ok: z.literal(true),
  tool: z.string().min(1),
  view: ScenarioViewSchema,
})

/** 请求/申报类工具输出 = 回执 ∪ deny（与既有六工具同形两级错误） */
export const ScenarioReceiptOutput = z.discriminatedUnion('ok', [ReceiptOkSchema, DenyOutput])

/** 只读类工具输出 = 投影 ∪ deny（只读不产记录，回执语义不适用） */
export const ScenarioViewOutput = z.discriminatedUnion('ok', [ViewOkSchema, DenyOutput])

// ---------------------------------------------------------------------------
// 注入端口（PORT-AUTH.verify + 对应端口方法由装配方实现；IO 留在构造方）
// ---------------------------------------------------------------------------

/** 端口入参（一次工具调用的完整请求上下文） */
export interface ScenarioRequest {
  /** v2/14 §三 行号 */
  readonly id: string
  readonly tool: ScenarioToolName
  readonly group: McpScenarioGroup
  /** 公司维（v2/14 §三：必带；与 wkey/署名公司不一致由端口拒） */
  readonly company: string
  /** schema 收口后的参数（strictObject，多余字段已被协议层拒） */
  readonly args: Readonly<Record<string, unknown>>
  /** 调用凭据（端口执行 PORT-AUTH.verify；工具面不复制鉴权） */
  readonly wkey: string
  /** 请求时点（epoch ms；端口做 TTL/幂等窗口判据） */
  readonly at: number
}

/** 端口结果：请求/申报类→回执；只读类→只读投影（与工具 kind 必须一致，错型=内部故障） */
export type ScenarioOutcome =
  | ({ readonly kind: 'receipt' } & ScenarioReceipt)
  | { readonly kind: 'view'; readonly view: Readonly<Record<string, unknown>> }

/**
 * 场景端口（装配方注入）。**必须**按 v2/14 §三铁律 1/2 实现：
 *   ① PORT-AUTH.verify（wkey 验签/单号绑定/scope）→ 四态政策；拒绝抛 ScenarioPortError('auth', ...)；
 *   ② 按工具类别路由：request=对应端口方法并落「请求/申报」记录后返回回执；read=只读投影（不落记录）；
 *   ③ 不落状态推进（决定由有权位置作出）。
 */
export interface ScenarioPort {
  invoke(request: ScenarioRequest): Promise<ScenarioOutcome>
}

/** 端口分类错误（工具面原样透传 category/subcause；不伪造、不吞掉） */
export class ScenarioPortError extends Error {
  readonly category: 'auth' | 'gateway' | 'deps' | 'internal'
  readonly subcause: string

  constructor(category: 'auth' | 'gateway' | 'deps' | 'internal', subcause: string, message: string) {
    super(message)
    this.name = 'ScenarioPortError'
    this.category = category
    this.subcause = subcause
  }
}

// ---------------------------------------------------------------------------
// 速率闸（单 server 实例内存簿；多进程/多连接归 daemon，不在本刀）
// ---------------------------------------------------------------------------

export type RateDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number }

/** 60s 滑动窗：同工具每分钟至多 perMinute 次（超限返 retryAfterMs） */
export class ScenarioRateLimiter {
  private readonly now: () => number
  private readonly hits = new Map<string, number[]>()

  constructor(now: () => number) {
    this.now = now
  }

  take(tool: string, perMinute: number): RateDecision {
    const now = this.now()
    const windowStart = now - 60_000
    const seen = (this.hits.get(tool) ?? []).filter((at) => at > windowStart)
    if (seen.length >= perMinute) {
      this.hits.set(tool, seen)
      const oldest = seen[0] ?? now
      return { allowed: false, retryAfterMs: Math.max(0, oldest + 60_000 - now) }
    }
    seen.push(now)
    this.hits.set(tool, seen)
    return { allowed: true }
  }
}

// ---------------------------------------------------------------------------
// 工具规格（id/组/标题/描述/权限/速率/回执类型/输入 schema/跨字段校验）
// ---------------------------------------------------------------------------

/** 工具类别：request=请求/申报（落记录，回执 decided:false）；read=只读投影（不落记录） */
export type ScenarioToolKind = 'request' | 'read'

export interface ScenarioToolSpec<N extends ScenarioToolName = ScenarioToolName> {
  /** v2/14 §三 行号 */
  readonly id: string
  readonly name: N
  readonly group: McpScenarioGroup
  readonly title: string
  /** 「什么时候用哪个」；「怎么调」由 input schema 承担（AGENTS.md L5 引用） */
  readonly description: string
  readonly kind: ScenarioToolKind
  readonly permission: ScenarioPermission
  readonly limits: ScenarioLimits
  /** v2/14 §三「出参」列的回执类型（request 类必填；read 类为 null——只读不产记录） */
  readonly receiptType: string | null
  readonly input: z.ZodType
  readonly output: z.ZodType
  /** 跨字段校验（schema 层不表达的语义；返回非 undefined=拒，fail-closed） */
  readonly check?: (args: Readonly<Record<string, unknown>>) => string | undefined
}

const COMPANY_SCOPED: ScenarioPermission['companyRequired'] = true

/** 交接包十项必须齐全且不重复（缺失项须写去向）——schema 表达不了的跨字段约束 */
function checkHandoverItems(args: Readonly<Record<string, unknown>>): string | undefined {
  const items = args['items']
  if (!Array.isArray(items)) return 'items 须为数组'
  const kinds = items.map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { item?: unknown }).item : undefined))
  const missing = HANDOVER_ITEM_KINDS.filter((kind) => !kinds.includes(kind))
  if (missing.length > 0) return `交接包缺项：${missing.join(',')}（十项齐全，缺项写「缺失＋去向」）`
  if (new Set(kinds).size !== HANDOVER_ITEM_KINDS.length) return '交接包十项存在重复项'
  for (const entry of items) {
    const record = entry as { presence?: unknown; disposition?: unknown }
    if (record.presence === 'missing' && (typeof record.disposition !== 'string' || record.disposition === '')) {
      return '交接包 presence=missing 的项必须写 disposition（缺失＋去向）'
    }
  }
  return undefined
}

export const HrProfileAmendTool: ScenarioToolSpec<'hr.profileAmend'> = {
  id: SCENARIO_TOOL_IDS['hr.profileAmend'],
  name: 'hr.profileAmend',
  group: 'hr',
  title: '档案修订申请',
  description:
    '本人或授权范围提出人事档案修订候选：给 subjectRef、字段补丁、理由与依据。回执是修订候选（RevisionTicket），不是直接改档；改档决定由人事职能位/有权位置作出。',
  permission: { authority: 'self-or-hr-position', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'RevisionTicket',
  output: ScenarioReceiptOutput,
  input: HrProfileAmendInput,
}

export const HrAppointmentProposeTool: ScenarioToolSpec<'hr.appointmentPropose'> = {
  id: SCENARIO_TOOL_IDS['hr.appointmentPropose'],
  name: 'hr.appointmentPropose',
  group: 'hr',
  title: '拟任提议',
  description:
    '按位置 +1 链提出拟任登记：给位置、拟任职者、提名、任期起点与拟任版本（幂等键四元组）。回执=拟任登记（REC-LIFE-01 拟任面），已提交不等于任命生效。',
  permission: { authority: 'position-plus1', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-LIFE-01',
  output: ScenarioReceiptOutput,
  input: HrAppointmentProposeInput,
}

export const HrTransitionRequestTool: ScenarioToolSpec<'hr.transitionRequest'> = {
  id: SCENARIO_TOOL_IDS['hr.transitionRequest'],
  name: 'hr.transitionRequest',
  group: 'hr',
  title: '状态迁移申请',
  description:
    '提出人事状态迁移申请：给 from/to、触发主张（生产者＋记录引用）与依据。按边触发者校验后进 REC-LIFE-02 决定链；工具只递申请，不推进状态。',
  permission: { authority: 'edge-trigger', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-LIFE-02',
  output: ScenarioReceiptOutput,
  input: HrTransitionRequestInput,
}

export const HrInterestDeclareTool: ScenarioToolSpec<'hr.interestDeclare'> = {
  id: SCENARIO_TOOL_IDS['hr.interestDeclare'],
  name: 'hr.interestDeclare',
  group: 'hr',
  title: '利益申报',
  description:
    '任职者申报持有与利益关系＋复核期；由独立检查位置检查。回执=申报登记（REC-LIFE-05 申报面），不代替独立性判定。',
  permission: { authority: 'incumbent-declare', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-LIFE-05',
  output: ScenarioReceiptOutput,
  input: HrInterestDeclareInput,
}

export const FinLedgerReadTool: ScenarioToolSpec<'fin.ledgerRead'> = {
  id: SCENARIO_TOOL_IDS['fin.ledgerRead'],
  name: 'fin.ledgerRead',
  group: 'fin',
  title: '账视图只读',
  description:
    '按时间窗＋账段（预算/事件/月报）＋readScope 读账视图；缺源段=unknown，不补 0，多公司视图隔离。只读，不产生记录。',
  permission: { authority: 'finance-read-scope', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 60 },
  kind: 'read',
  receiptType: null,
  output: ScenarioViewOutput,
  input: FinLedgerReadInput,
}

export const FinCostguardStatusTool: ScenarioToolSpec<'fin.costguardStatus'> = {
  id: SCENARIO_TOOL_IDS['fin.costguardStatus'],
  name: 'fin.costguardStatus',
  group: 'fin',
  title: '成本警戒状态',
  description: '读本单成本警戒线状态（core costguard 只读投影）：花大成本前先看是否触线。只读，不产生记录。',
  permission: { authority: 'finance-issue-scope', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 60 },
  kind: 'read',
  receiptType: null,
  output: ScenarioViewOutput,
  input: FinCostguardStatusInput,
}

export const DevPermissionRequestTool: ScenarioToolSpec<'dev.permissionRequest'> = {
  id: SCENARIO_TOOL_IDS['dev.permissionRequest'],
  name: 'dev.permissionRequest',
  group: 'dev',
  title: '权限申请',
  description:
    '任何任职者可申请授予面（purpose/scope/期限）＋理由。回执=命令请求（REC-CMD-01）——申请不是授权，批准归授权者（+2 链）。',
  permission: { authority: 'any-incumbent-request', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-CMD-01',
  output: ScenarioReceiptOutput,
  input: DevPermissionRequestInput,
}

export const DevCapabilityDeclareTool: ScenarioToolSpec<'dev.capabilityDeclare'> = {
  id: SCENARIO_TOOL_IDS['dev.capabilityDeclare'],
  name: 'dev.capabilityDeclare',
  group: 'dev',
  title: '能力声明',
  description:
    '提交九维能力声明（中立能力/实现来源/宿主绑定/依赖冲突/输入输出/副作用请求/生命周期/观测成本/证据与已知不能）＋claimant＋版本。声明是主张非认定，不超证据。',
  permission: { authority: 'self-claim', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-CAP-01',
  output: ScenarioReceiptOutput,
  input: DevCapabilityDeclareInput,
}

export const DevAssetRegisterTool: ScenarioToolSpec<'dev.assetRegister'> = {
  id: SCENARIO_TOOL_IDS['dev.assetRegister'],
  name: 'dev.assetRegister',
  group: 'dev',
  title: '资产登记申请',
  description:
    '研发职能位提出资产条目登记（类型/来源摘要/兼容/专属标记）。回执=登记申请（REC-ASSET-01）；写入者=daemon/部署，申请不是登记完成。',
  permission: { authority: 'dev-position-propose', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-ASSET-01',
  output: ScenarioReceiptOutput,
  input: DevAssetRegisterInput,
}

export const WorkIntakeTool: ScenarioToolSpec<'work.intake'> = {
  id: SCENARIO_TOOL_IDS['work.intake'],
  name: 'work.intake',
  group: 'gen',
  title: '意图受理',
  description:
    '提交意图信封（原文/来源/时限）。回执=intentRef（REC-WORK-01 请求型，零决定面）；「已受理」不等于「已派工」。',
  permission: { authority: 'incumbent-intake', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-WORK-01',
  output: ScenarioReceiptOutput,
  input: WorkIntakeInput,
}

export const WorkHandoverSubmitTool: ScenarioToolSpec<'work.handoverSubmit'> = {
  id: SCENARIO_TOOL_IDS['work.handoverSubmit'],
  name: 'work.handoverSubmit',
  group: 'gen',
  title: '交接包提交',
  description:
    '交出者提交交接包十项（逐项已含/缺失＋去向）＋连续性四问答案＋派生执行体清单。回执=提交（REC-WORK-HANDOVER）；提交≠接收确认，只转移在途责任。',
  permission: { authority: 'handover-issuer', subject: 'person', companyRequired: COMPANY_SCOPED },
  limits: { perMinute: 20 },
  kind: 'request',
  receiptType: 'REC-WORK-HANDOVER',
  output: ScenarioReceiptOutput,
  input: WorkHandoverSubmitInput,
  check: checkHandoverItems,
}

/** 场景工具注册表（server.ts 逐个注册；顺序=SCENARIO_TOOL_NAMES） */
export const SCENARIO_TOOL_SPECS: readonly ScenarioToolSpec[] = [
  HrProfileAmendTool,
  HrAppointmentProposeTool,
  HrTransitionRequestTool,
  HrInterestDeclareTool,
  FinLedgerReadTool,
  FinCostguardStatusTool,
  DevPermissionRequestTool,
  DevCapabilityDeclareTool,
  DevAssetRegisterTool,
  WorkIntakeTool,
  WorkHandoverSubmitTool,
]

/** 名 → 规格（测试/装配按名取用） */
export function scenarioToolSpec(name: ScenarioToolName): ScenarioToolSpec {
  const spec = SCENARIO_TOOL_SPECS.find((candidate) => candidate.name === name)
  if (spec === undefined) throw new Error(`未登记的场景工具：${name}`)
  return spec
}

// ---------------------------------------------------------------------------
// 迁移留痕（target → registered；契约面子项未闭合，故不冒充 existing）
// ---------------------------------------------------------------------------

export interface McpScenarioMigration {
  readonly id: string
  readonly name: ScenarioToolName
  readonly from: 'target'
  readonly to: 'registered'
  /** 本单（改动单号） */
  readonly ticket: 'studio-dev-548'
  /** 实现落点（代码） */
  readonly implementation: string
  /** 验收落点（V2 套件） */
  readonly evidence: string
  /** 尚未闭合项（不冒充 existing 的理由） */
  readonly openSubitem: string
}

const OPEN_CONTRACT = 'GATEWAY_ACTIONS 未含本动词、wkey scope 未扩面——契约面子项，须报 Lead/制作人批（docs/v2/14 §三铁律 3/4）'

/** 逐条迁移记录（11 行；tools.ts 声明表 status 同步为 registered） */
export const SCENARIO_TOOL_MIGRATIONS: readonly McpScenarioMigration[] = SCENARIO_TOOL_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  from: 'target',
  to: 'registered',
  ticket: 'studio-dev-548',
  implementation: 'packages/studio-tools/src/scenario-tools.ts',
  evidence: 'packages/studio-tools/test/v2/scenario-tools.test.ts',
  openSubitem: OPEN_CONTRACT,
}))
