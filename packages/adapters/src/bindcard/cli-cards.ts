/**
 * bindcard/cli-cards —— 三张备选 CLI 绑定卡（BIND-CLI-CLAUDE-01 / CODEX-01 / KIMI-01）
 *                      ＋ PB-6 拟稿点登记＋fail-closed 能力对齐面（IMPL-07-05）
 *
 * 依据：
 *   - v2/12 §2.1 备选 CLI 适配契约（契约四条）＋「三张卡共表」：现状/budget_cap/cancel_turn/
 *     session_resume/agents_md/cost_native/特有约束/策略面/探针；**铁律**：能力声明强度不得
 *     超过证据；凡「待探针/拟稿」在投影生成时一律按不支持处理（fail-closed）。
 *   - v2/12 §四 会话续跑的宿主级约束（Claude `--resume` 较硬；Codex `--resume` 两形待探
 *     PRB-25；Kimi `-S` 拟稿 PRB-26）；§六 损失表 BIND-LOSS-07/08/09。
 *   - v2/17 §五 PB-6（备选 CLI 批次，无前置、随时并行；**未证前 session_resume/降级档一律
 *     按不支持**；结论只入 BIND-CLI-* 卡）——本文件的 `PB6_DRAFT_POINTS` 就是该批次在本包
 *     领土内的拟稿点登记面（登记≠通过；probe 状态恒 not-executed）。
 *   - v2/16 §三 adapters 行「codex/kimi session_resume 静态声明与 fail-closed 冲突仍为待裁项
 *     （MIG-07）」——本单的裁法：适配器文件（codex.ts/kimi.ts）不改（旧测试与拟稿注释原样，
 *     不在本单领土），静态声明在**注册/声明面**以 fail-closed 对齐值呈现：
 *     `failClosedCapabilities()` 把 codex/kimi 的 session_resume 按不支持（false）处理。
 *     对齐点是 agentconfig.ts（wireRegistry/registerBuiltins 消费本函数），不是卡外第二张表。
 *   - v2/09 ENU-109/110/111（现状四值/损失 severity/探针三态）；plan/05 IMPL-07-05。
 *
 * 不改变合法行为（本单纪律）：
 *   - 只对**登记为未证**的能力字段（当前恰 codex/kimi 的 session_resume）翻 false；
 *     dsh/claude 的 session_resume（真机实证/较硬）与其余字段一律原样透传。
 *   - agents_md 面只登记（registered-only）不改值：claude 版本门控降级发生在 launch 且
 *     detect 以 gaps 明报、codex/kimi 通道细节待探——把非布尔面硬改会改变合法行为。
 *   - 适配器运行时（launch/stream/resumeWithSession）零改动：本件只改**声明视图**。
 */
import type { ExecutorCapabilities, ExecutorFamily } from '@studio-next/contract'
import type { BindingCard, CardFaceRow, CardLossRow, CarrierRow } from './types.ts'
import { deepFreeze } from './types.ts'

/** 三张 CLI 卡 ID（v2/12 §2.1；平台卡/WS 卡/PRM 卡不属本包领土，见 card.ts 拒收面） */
export const CLI_BINDING_CARD_IDS = {
  claude: 'BIND-CLI-CLAUDE-01',
  codex: 'BIND-CLI-CODEX-01',
  kimi: 'BIND-CLI-KIMI-01',
} as const
export type CliBindingFamily = keyof typeof CLI_BINDING_CARD_IDS

/** CLI 卡版本（v2/12 §2.1：三张卡均 v2.0） */
export const CLI_CARD_VERSION = 'v2.0'

/** CLI 卡 ownerRef（同执行绑定负责人；v2/03 治理位置表登记） */
export const CLI_CARD_OWNER_REF = '框架执行绑定负责人（v2/03 治理位置表登记）'

/** CLI 卡摘要位说明（未计算；与 DSH 卡同口径） */
export const CLI_CARD_DIGEST_NOTE = '摘要未计算（目标：v2/10 jcs@1 跨实现未证）——不得当作校验位'

/** CLI 卡公共授权行（CLI 无原生策略段：tools/sandbox/approval 一律不承载） */
const CLI_AUTHORIZATION = deepFreeze({
  mode: 'per-segment' as const,
  unsupportedSegmentRule:
    'CLI 无原生策略段：tools/sandbox/approval 段不承载（换离 DSH 即明示不可用，BIND-LOSS-01）——未承载段最高记第 4/5 态，不得记第 6 态',
  notAuthority: '绑定不是授权：CLI 的「允许」只答技术许可；授权只有 v2/03 四态',
})

/** CLI 卡公共供给行（版本未钉＝不得供给；补钉随 PB-6 探针结论入卡） */
const CLI_SUPPLY: readonly string[] = deepFreeze([
  'CLI 二进制由部署提供（PATH），不进公司包（DOM-06：公司包只携带引用与兼容声明）',
  '版本未钉：本卡登记为供给缺口——缺钉版本＝不得供给（v2/12 §〇.4 供给行硬规则；补钉随 PRB-24/25/26）',
  '插件/钩子面不由本包生成；CLI hooks 只 command、一次读取、updatedInput 不生效（不作核心策略）',
])

/** CLI 卡公共迁移行 */
const CLI_EXPORT_EXIT = deepFreeze({
  export: '事件流 JSONL 兜底导出（与 DSH 同口径；导出面≠可复核能力证明）',
  migration: '换宿主＝新出工段+能力重认+开工五门重判；换入/换离 DSH 均须重探（PB-6，v2/12 §2.1）',
  exit: '退出＝停止供给+事件归档；换宿主不换任职（v2/12 §1.6）',
})

/** CLI 卡公共证据行 */
const CLI_EVIDENCE: readonly string[] = deepFreeze([
  '流事件（八类顶层事件归一，streams.ts）',
  '原生成本字段（仅 claude cost_native=true）',
  '探针未执行（PRB-24/25/26）：证据强度＝拟稿/未证，一律按不支持处理',
])

/** 换离 DSH 的专属损失（CLI 卡不支持行引 DSH 卡损失行，不复制第二张损失表） */
const DSH_EXCLUSIVE_UNAVAILABLE = 'DSH 专属能力面（v2/12 §1.5 六项）换宿主即明示不可用——损失行见 BIND-DSH-01 卡 BIND-LOSS-01…06'

// ---------------------------------------------------------------------------
// BIND-CLI-CLAUDE-01
// ---------------------------------------------------------------------------

const CLAUDE_CARRIER_MAP: readonly CarrierRow[] = [
  { semantic: 'budget_cap', carrier: '--max-budget-usd（单次上限不累计）', strength: '有', status: '已有' },
  { semantic: 'cancel_turn', carrier: '无单轮取消原语（只能整进程 kill）', strength: '无', status: '已有', note: '四家同（v2/07 EXEC-03）' },
  { semantic: 'session_resume', carrier: '--resume', strength: '较硬（未按我们的形态复验）', status: '已有' },
  { semantic: 'agents_md', carrier: 'native＋版本门控降级（<2.1.277 降 append_system_prompt）', strength: '拟稿', status: '未证' },
  { semantic: 'cost_native', carrier: 'result 原生 total_cost_usd', strength: '有', status: '已有' },
  { semantic: '策略面', carrier: '权限模式+hooks', strength: '弱（hook 只 command/一次读取/updatedInput 不生效）', status: '未证' },
]

const CLAUDE_LOSSES: readonly CardLossRow[] = [
  {
    lossId: 'BIND-LOSS-07',
    severity: 'degrading',
    description: '无统一策略面：hook 只 command、配置一次读取、updatedInput 不生效；预算帽是单次上限不累计',
    cannotClaim: '不得称「hook≈guard」「预算已累计限」',
  },
]

const CLAUDE_FACES: readonly CardFaceRow[] = [
  { face: '适配器接入（args/流归一/kill 链）', status: '已有', anchor: 'claude.ts（--max-budget-usd、原生 cost、killpg 链）' },
  { face: '权限面（权限模式/hooks）', status: '未证', anchor: 'v2/12 §2.1 策略面列（PRB-24 未执行）' },
  { face: 'AGENTS.md 版本门控降级', status: '未证', anchor: 'claude.ts 头注（拟稿；detect 以 gaps 明报）' },
]

/** BIND-CLI-CLAUDE-01（v2/12 §2.1） */
export const CLAUDE_BINDING_CARD: BindingCard = deepFreeze({
  cardId: CLI_BINDING_CARD_IDS.claude,
  cardVersion: CLI_CARD_VERSION,
  family: 'claude',
  digest: { computed: false, note: CLI_CARD_DIGEST_NOTE },
  ownerRef: CLI_CARD_OWNER_REF,
  host: {
    name: 'Claude CLI',
    version: '未钉（AGENTS.md 原生读取需 ≥2.1.277；实例版本随部署）',
    license: '未声明（部署侧许可，不进公司包；不默认继承框架仓 MIT）',
    launchForm: 'PATH 上的外部 CLI（claude -p JSON 流）；版本探测 detect --version',
    supplyRef: 'v2/13 依赖条目；版本钉住随 PB-6 补齐',
  },
  coverage: ['budget_cap', 'cancel_turn', 'session_resume', 'agents_md', 'cost_native', '策略面（权限模式/hooks）'],
  unsupported: [
    '组织/任命/禁配/验收/问责',
    '网络出站/进程隔离/秘密保管/跨进程互斥/权威激活（宿主词汇不可表达）',
    DSH_EXCLUSIVE_UNAVAILABLE,
  ],
  carrierMap: CLAUDE_CARRIER_MAP,
  supply: CLI_SUPPLY,
  authorization: CLI_AUTHORIZATION,
  evidence: CLI_EVIDENCE,
  losses: CLAUDE_LOSSES,
  exportExit: CLI_EXPORT_EXIT,
  probes: deepFreeze([{ probeId: 'PRB-24', state: 'not-executed' as const }]),
  faces: CLAUDE_FACES,
})

// ---------------------------------------------------------------------------
// BIND-CLI-CODEX-01
// ---------------------------------------------------------------------------

const CODEX_CARRIER_MAP: readonly CarrierRow[] = [
  { semantic: 'budget_cap', carrier: '无原生预算帽旗标（预算只能框架断路，事后）', strength: '无', status: '已有' },
  { semantic: 'cancel_turn', carrier: '无单轮取消原语（只能整进程 kill）', strength: '无', status: '已有' },
  {
    semantic: 'session_resume',
    carrier: 'codex exec --resume（旗标/子命令两形待探）',
    strength: '拟稿',
    status: '未证',
    note: 'PB-6 拟稿点：未证按不支持（本卡声明面 false；PRB-25）',
  },
  { semantic: 'agents_md', carrier: 'native（拟稿假设：原生读 workspace AGENTS.md）', strength: '拟稿', status: '未证' },
  { semantic: 'cost_native', carrier: '无原生成本（tokens 有，金额恒 0 待价目表折算）', strength: '无', status: '已有' },
  { semantic: '策略面', carrier: '沙箱模式+审批（文档面未证）', strength: '未证', status: '未证' },
]

const CODEX_LOSSES: readonly CardLossRow[] = [
  {
    lossId: 'BIND-LOSS-08',
    severity: 'degrading',
    description: '预算只能事后断路（超支已发生）；成本金额恒 0 待折算',
    cannotClaim: '不得称「预算可控」「成本有金额证据」',
  },
]

const CODEX_FACES: readonly CardFaceRow[] = [
  { face: '适配器接入（exec --json、turn.completed.usage）', status: '已有', anchor: 'codex.ts 头注（tokens 只取 turn_end.usage）' },
  { face: '会话续跑（--resume 两形）', status: '未证', anchor: 'v2/12 §四（拟稿，PRB-25 未执行）' },
  { face: 'AGENTS.md 通道', status: '未证', anchor: 'codex.ts 头注（native 假设，待探）' },
  { face: '成本折算（价目表）', status: '未证', anchor: 'v2/12 §2.1（cost_native=false；折算未做）' },
]

/** BIND-CLI-CODEX-01（v2/12 §2.1） */
export const CODEX_BINDING_CARD: BindingCard = deepFreeze({
  cardId: CLI_BINDING_CARD_IDS.codex,
  cardVersion: CLI_CARD_VERSION,
  family: 'codex',
  digest: { computed: false, note: CLI_CARD_DIGEST_NOTE },
  ownerRef: CLI_CARD_OWNER_REF,
  host: {
    name: 'Codex CLI',
    version: '未钉（实例版本随部署；探针未执行）',
    license: '未声明（部署侧许可，不进公司包；不默认继承框架仓 MIT）',
    launchForm: 'PATH 上的外部 CLI（codex exec --json）',
    supplyRef: 'v2/13 依赖条目；版本钉住随 PB-6 补齐',
  },
  coverage: ['budget_cap', 'cancel_turn', 'session_resume', 'agents_md', 'cost_native', '策略面（沙箱模式+审批，文档面未证）'],
  unsupported: [
    '组织/任命/禁配/验收/问责',
    '网络出站/进程隔离/秘密保管/跨进程互斥/权威激活（宿主词汇不可表达）',
    '会话续跑（未证前按不支持；明报降级新派，不得静默新开会话冒充续跑）',
    DSH_EXCLUSIVE_UNAVAILABLE,
  ],
  carrierMap: CODEX_CARRIER_MAP,
  supply: CLI_SUPPLY,
  authorization: CLI_AUTHORIZATION,
  evidence: CLI_EVIDENCE,
  losses: CODEX_LOSSES,
  exportExit: CLI_EXPORT_EXIT,
  probes: deepFreeze([{ probeId: 'PRB-25', state: 'not-executed' as const }]),
  faces: CODEX_FACES,
})

// ---------------------------------------------------------------------------
// BIND-CLI-KIMI-01
// ---------------------------------------------------------------------------

const KIMI_CARRIER_MAP: readonly CarrierRow[] = [
  { semantic: 'budget_cap', carrier: '无原生预算帽旗标（预算只能框架断路，事后）', strength: '无', status: '已有' },
  { semantic: 'cancel_turn', carrier: '无单轮取消原语（只能整进程 kill）', strength: '无', status: '已有' },
  {
    semantic: 'session_resume',
    carrier: '-S <sessionId>（旗标形待探）',
    strength: '拟稿',
    status: '未证',
    note: 'PB-6 拟稿点：未证按不支持（本卡声明面 false；PRB-26）',
  },
  { semantic: 'agents_md', carrier: 'native（实锤；通道细节未证）', strength: '已有', status: '已有' },
  { semantic: 'cost_native', carrier: '无原生成本（usage 在 session wire.jsonl；金额恒 0 待折算）', strength: '无', status: '已有' },
  { semantic: '策略面', carrier: '未证（权限面未探）', strength: '未证', status: '未证' },
]

const KIMI_LOSSES: readonly CardLossRow[] = [
  {
    lossId: 'BIND-LOSS-09',
    severity: 'degrading',
    description: '模式互斥限制 plan 类协调路径；wire 路径拟稿',
    cannotClaim: '不得称「全模式可用」',
  },
]

const KIMI_FACES: readonly CardFaceRow[] = [
  { face: '适配器接入（stdout 流＋wire 合流）', status: '库级', anchor: 'kimi.ts（库级；未接主循环常规派发）' },
  { face: '会话续跑（-S 旗标形）', status: '未证', anchor: 'v2/12 §四（拟稿，PRB-26 未执行）' },
  { face: 'wire 路径约定（session wire.jsonl 落点）', status: '未证', anchor: 'kimi.ts 头注（wirePathResolver 缺省为拟稿）' },
  { face: '模式互斥（-p 与 yolo/auto/plan）', status: '已有', anchor: 'kimi.ts 头注（已知约束）' },
]

/** BIND-CLI-KIMI-01（v2/12 §2.1） */
export const KIMI_BINDING_CARD: BindingCard = deepFreeze({
  cardId: CLI_BINDING_CARD_IDS.kimi,
  cardVersion: CLI_CARD_VERSION,
  family: 'kimi',
  digest: { computed: false, note: CLI_CARD_DIGEST_NOTE },
  ownerRef: CLI_CARD_OWNER_REF,
  host: {
    name: 'Kimi CLI',
    version: '未钉（实例版本随部署；探针未执行）',
    license: '未声明（部署侧许可，不进公司包；不默认继承框架仓 MIT）',
    launchForm: 'PATH 上的外部 CLI（kimi -p JSON 流；usage 在 wire.jsonl）',
    supplyRef: 'v2/13 依赖条目；版本钉住随 PB-6 补齐',
  },
  coverage: ['budget_cap', 'cancel_turn', 'session_resume', 'agents_md', 'cost_native', '模式互斥约束'],
  unsupported: [
    '组织/任命/禁配/验收/问责',
    '网络出站/进程隔离/秘密保管/跨进程互斥/权威激活（宿主词汇不可表达）',
    '会话续跑（未证前按不支持；明报降级新派）',
    'plan 类协调路径（-p 与 yolo/auto/plan 互斥，模式不全可用）',
    DSH_EXCLUSIVE_UNAVAILABLE,
  ],
  carrierMap: KIMI_CARRIER_MAP,
  supply: CLI_SUPPLY,
  authorization: CLI_AUTHORIZATION,
  evidence: CLI_EVIDENCE,
  losses: KIMI_LOSSES,
  exportExit: CLI_EXPORT_EXIT,
  probes: deepFreeze([{ probeId: 'PRB-26', state: 'not-executed' as const }]),
  faces: KIMI_FACES,
})

/** 三张 CLI 卡（顺序＝v2/12 §2.1 表序） */
export const CLI_BINDING_CARDS: readonly BindingCard[] = deepFreeze([
  CLAUDE_BINDING_CARD,
  CODEX_BINDING_CARD,
  KIMI_BINDING_CARD,
])

// ---------------------------------------------------------------------------
// PB-6 拟稿点登记（v2/17 §五：未证前 session_resume/降级档一律按不支持）
// ---------------------------------------------------------------------------

/** capability 面（取值＝contract ExecutorCapabilities 的键；不另立能力名值集） */
export type CapabilityField = keyof ExecutorCapabilities

/** 布尔能力字段（fail-closed 翻 false 只对布尔面成立；agents_md 是通道枚举面，不翻） */
export const BOOLEAN_CAPABILITY_FIELDS = ['budget_cap', 'cancel_turn', 'session_resume', 'cost_native'] as const
export type BooleanCapabilityField = (typeof BOOLEAN_CAPABILITY_FIELDS)[number]

/** 判布尔能力字段（type guard） */
export function isBooleanCapabilityField(field: CapabilityField): field is BooleanCapabilityField {
  return (BOOLEAN_CAPABILITY_FIELDS as readonly string[]).includes(field)
}

/**
 * 拟稿点（PB-6 批次登记行）：
 *   - disposition='unsupported'：未证即按不支持——登记面把布尔能力对齐 false（当前仅
 *     codex/kimi 的 session_resume）；
 *   - disposition='registered-only'：只登记不改值（非布尔面/降级档；改它会改变合法行为）。
 */
export interface CapabilityDraftPoint {
  readonly pointId: string
  readonly batch: 'PB-6'
  readonly family: ExecutorFamily
  readonly capability: CapabilityField
  readonly probeId: string
  readonly declared: string
  readonly disposition: 'unsupported' | 'registered-only'
  readonly probeState: 'not-executed'
  readonly reason: string
}

/** PB-6 拟稿点登记表（唯一源；agentconfig 的 fail-closed 对齐只从这里取） */
export const PB6_DRAFT_POINTS: readonly CapabilityDraftPoint[] = deepFreeze([
  {
    pointId: 'PB-6-CODEX-SESSION-RESUME',
    batch: 'PB-6',
    family: 'codex',
    capability: 'session_resume',
    probeId: 'PRB-25',
    declared: '拟稿：codex exec --resume（旗标/子命令两形待探）',
    disposition: 'unsupported',
    probeState: 'not-executed',
    reason: 'PB-6 未出结论：续跑形态未证→按不支持（v2/12 §2.1 铁律；v2/17 §五 PB-6）',
  },
  {
    pointId: 'PB-6-KIMI-SESSION-RESUME',
    batch: 'PB-6',
    family: 'kimi',
    capability: 'session_resume',
    probeId: 'PRB-26',
    declared: '拟稿：-S <sessionId>（旗标形待探）',
    disposition: 'unsupported',
    probeState: 'not-executed',
    reason: 'PB-6 未出结论：续跑形态未证→按不支持（v2/12 §2.1 铁律；v2/17 §五 PB-6）',
  },
  {
    pointId: 'PB-6-CODEX-AGENTS-MD',
    batch: 'PB-6',
    family: 'codex',
    capability: 'agents_md',
    probeId: 'PRB-25',
    declared: 'native（拟稿假设：原生读 workspace AGENTS.md）',
    disposition: 'registered-only',
    probeState: 'not-executed',
    reason: '通道面是枚举不是布尔：本单只登记不改值（改它会改变合法行为；结论随 PB-6 入卡）',
  },
  {
    pointId: 'PB-6-CLAUDE-AGENTS-MD',
    batch: 'PB-6',
    family: 'claude',
    capability: 'agents_md',
    probeId: 'PRB-24',
    declared: 'native＋版本门控降级（<2.1.277 降 append_system_prompt，拟稿）',
    disposition: 'registered-only',
    probeState: 'not-executed',
    reason: '降级在 launch 发生且 detect 以 gaps 明报（非静默）——权限面未证只登记，不改通道值',
  },
])

/** 取某家某能力的拟稿点（无登记＝undefined） */
export function capabilityDraftPoint(
  family: string | undefined,
  capability: CapabilityField,
): CapabilityDraftPoint | undefined {
  if (family === undefined) return undefined
  return PB6_DRAFT_POINTS.find((p) => p.family === family && p.capability === capability)
}

/** 未证能力的探针 ID（错误信息用；无登记＝undefined） */
export function unprovenProbeIdOf(family: string | undefined, capability: CapabilityField): string | undefined {
  const point = capabilityDraftPoint(family, capability)
  return point !== undefined && point.disposition === 'unsupported' ? point.probeId : undefined
}

/**
 * fail-closed 能力对齐（本单的 **唯一** 声明真值面）：
 *   - 声明入参＝适配器静态声明（可能含拟稿 over-claim）；
 *   - 登记为 `unsupported` 的布尔能力翻 false（未证按不支持）；其余字段原样；
 *   - family 未登记（自定义执行器）→ 原样返回（本包不为未登记家族代言）。
 * 纯函数：同入参同输出、不读环境、不改入参对象。
 */
export function failClosedCapabilities(
  family: string | undefined,
  declared: ExecutorCapabilities,
): ExecutorCapabilities {
  if (family === undefined) return declared
  let effective: ExecutorCapabilities | undefined
  for (const point of PB6_DRAFT_POINTS) {
    if (point.family !== family) continue
    if (point.disposition !== 'unsupported') continue
    if (!isBooleanCapabilityField(point.capability)) continue
    effective ??= { ...declared }
    effective[point.capability] = false
  }
  return effective ?? declared
}
