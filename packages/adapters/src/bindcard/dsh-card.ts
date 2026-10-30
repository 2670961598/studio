/**
 * bindcard/dsh-card —— BIND-DSH-01（DSH 主绑定档案卡，v2.0 随宿主 0.2.1-rc.5 钉住）
 *
 * 依据：v2/12 §一 BIND-DSH-01 全卡——§1.1 卡面（标识/ownerRef/宿主/覆盖/不支持/映射/供给/
 * 授权与生效/证据/损失/导出迁移退出/探针/现状）、§1.2 版本锁与宿主三形态面表、§1.4 载体映射
 * 表、§1.5 专属能力实现面、§六 损失表（BIND-LOSS-01…06＋10）；v2/09 ENU-109/110/111；
 * v2/16 §三 adapters 行（绑定档案＝本单改造项）；plan/05 IMPL-07-05。
 *
 * 换宿主纪律（卡的本体规则，不在别处重述）：
 *   - 宿主升级＝**新档案**（ID 版本+版本锁重钉+全量重探），旧卡作废不加载——本卡版本锁
 *     0.2.1-rc.5（2026-10-30 升级，P-05 复验 PASS）；`loadBindingCard(id, hostVersion)`
 *     版本不符即拒（弃用，不静默降级）。
 *   - 换宿主不换任职（v2/12 §1.6）：卡只管宿主承载，人事/授权面在 v2/02–04。
 *   - 卡上的「覆盖/不支持」是**语义二分**，不是能力保证：DSH 专属能力面（§1.5）独占
 *     `DSH_EXCLUSIVE_FACES`，通用必达面（§2.1 契约①）在 `GENERIC_HOST_REQUIREMENTS`——
 *     专属/通用二分落在这两处，不在卡外再造第二张表。
 *
 * 诚实边界（与 seatbelt.ts 头注同款纪律）：
 *   - 沙箱实际拦截＝未证（PRB-04 未执行）；策略投影/position 插件＝目标；长驻宿主＝未证。
 *     卡面「已有」仅指仓内实现/接线事实，不宣称机制保证（v2/12 §0.5-3）。
 *   - 探针状态一律如实（not-executed）；本文件不产出 PASS，也不把「已挂 bridge 上下文插件」
 *     读成「策略已生效」（注入是上下文不是策略，v2/12 §1.7）。
 */
import type { BindingCard, CardFaceRow, CardLossRow, CardProbeRow, CardFactStatus, CarrierRow } from './types.ts'
import { deepFreeze } from './types.ts'

/** 卡标识（v2/12 §1.1 标识行；引用必须带 ID+版本） */
export const DSH_BINDING_ID = 'BIND-DSH-01'

/** 卡版本（v2.0；随宿主钉住——宿主升级即新档案，不是卡内改字段） */
export const DSH_CARD_VERSION = 'v2.0'

/** 版本锁（v2/12 §1.2：detect 版本比对不符即报诊断不派；rc 版插件 API 可变，升级＝新档案+全量重探） */
export const DSH_HOST_VERSION = '0.2.1-rc.5'

/** 宿主名与许可（§1.1 宿主行：MIT；PATH 上的外部 CLI；依赖条目 v2/13） */
export const DSH_HOST_NAME = 'DSH'
export const DSH_HOST_LICENSE = 'MIT'

/** 卡摘要位说明（v2/12 §0.4 硬规则：jcs@1 跨实现未证前标「未计算（目标）」） */
export const DSH_CARD_DIGEST_NOTE = '摘要未计算（目标：v2/10 jcs@1 跨实现未证）——不得当作校验位'

/** ownerRef（v2/12 §1.1；具名治理位置在 v2/03 治理位置表登记） */
export const DSH_CARD_OWNER_REF = '框架执行绑定负责人（v2/03 治理位置表登记）'

/**
 * DSH 专属能力实现面（v2/12 §1.5 六行）：专属＝只由目标宿主承载、换宿主即明示不可用
 * （v2/06 §三 专属标记／v2/07 §2.3 保留不丢、不宣称等价承载）。
 * `lossRef` 指 v2/12 §六的换离 DSH 损失行；`cannotClaim` 是该能力下不得作出的宣称。
 */
export interface ExclusiveCapabilityFace {
  readonly faceId: string
  readonly title: string
  readonly binding: 'exclusive'
  readonly targetExecutor: 'dsh'
  readonly status: CardFactStatus
  readonly note: string
  readonly lossRef: string
  readonly cannotClaim: string
}

/** 专属面（六行；顺序＝v2/12 §1.5 表序） */
export const DSH_EXCLUSIVE_FACES: readonly ExclusiveCapabilityFace[] = deepFreeze([
  {
    faceId: 'position-policy-projection',
    title: '岗位运行时策略投影下发',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '目标',
    note: 'position 插件：agent/created 读取并校验投影→收紧工具/沙箱/审批（§1.6）',
    lossRef: 'BIND-LOSS-01',
    cannotClaim: '不得称等价承载策略；强策略岗无合格宿主时不派工',
  },
  {
    faceId: 'in-process-subagent-decay',
    title: '进程内子 agent 衰减',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '目标',
    note: 'dsh-subagent preset+toolFilter+maxDepth；外部 CLI 后端保留自身权限（不假设继承收紧）',
    lossRef: 'BIND-LOSS-02',
    cannotClaim: '不得称子 agent 继承收紧；外部后端衰减保证不可达',
  },
  {
    faceId: 'persona-preset',
    title: 'persona/preset 岗位族运行时组合',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '未证',
    note: 'dsh-persona/dsh-agent-preset（恒软，不可配为硬）；本仓未启用',
    lossRef: 'BIND-LOSS-03',
    cannotClaim: '不得称岗位身份等价；软承载不得进「已满足授权条件」证据',
  },
  {
    faceId: 'session-checkpoint',
    title: '会话检查点（副作用前持久化）',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '目标',
    note: 'dsh-session-checkpoint-policy；崩溃后 TOOL_OUTCOME_UNKNOWN 不自动重试',
    lossRef: 'BIND-LOSS-04',
    cannotClaim: '不得称副作用前留证等价；未知不重试的宿主侧保证未证',
  },
  {
    faceId: 'position-events',
    title: 'position 类事件面',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '目标',
    note: 'position/manifest-loaded、position/denied、position/drift（校验失败记 manifest-rejected 缺口，不记 drift）',
    lossRef: 'BIND-LOSS-05',
    cannotClaim: '不得称拒绝可复核；缺 position 事件面＝拒绝与偏离证据缺口',
  },
  {
    faceId: 'dsh-plugin-asset',
    title: 'DSH 插件资产（执行器专属资产）',
    binding: 'exclusive',
    targetExecutor: 'dsh',
    status: '已有',
    note: '仅 bridge 上下文插件已挂（templates/*/plugins/ 保留不迁出）；策略类插件未挂、专属标记保留规则＝规范已立',
    lossRef: 'BIND-LOSS-06',
    cannotClaim: '不得称资产跨执行器等价；必备资产声明公司须接收方具备 DSH',
  },
])

/**
 * 通用能力必达面（v2/12 §2.1 契约①：通用能力必达）——四家执行器一视同仁的底线；
 * 与专属面对照即「专属/通用二分」：专属项换宿主＝明示不可用，通用项不可用＝该家不达契约。
 */
export interface GenericCapabilityRequirement {
  readonly requirementId: string
  readonly title: string
  readonly rule: string
}

export const GENERIC_HOST_REQUIREMENTS: readonly GenericCapabilityRequirement[] = deepFreeze([
  {
    requirementId: 'native-terminal-detection',
    title: '原生终态判定',
    rule: '只认宿主原生终态（DSH＝turn_end.reason.kind）；退出码与「输出非空」不参与终态判定',
  },
  {
    requirementId: 'stream-harvest',
    title: '流式收割',
    rule: '八类顶层事件归一（session/status/thinking/text/tool_call/tool_result/final/error）',
  },
  {
    requirementId: 'workspace-mount',
    title: '工作区挂载',
    rule: '派发 workspace 即该次尝试工位目录；cwd 不是隔离，只影响相对路径解析',
  },
  {
    requirementId: 'session-resume-or-degrade',
    title: '会话续跑或明报降级新派',
    rule: '不支持续跑的家必须明报降级新派；静默新开会话冒充续跑＝违规',
  },
  {
    requirementId: 'jsonl-fallback-export',
    title: '事件 JSONL 兜底导出',
    rule: '事件流可导出 JSONL（证据兜底通道）；导出面不构成可复核能力的证明',
  },
  {
    requirementId: 'claims-not-exceed-evidence',
    title: '声明不超证据',
    rule: '凡「待探针/拟稿」在投影与派发决策面一律按不支持处理（fail-closed）',
  },
])

/** 载体映射表（v2/12 §1.4 全表；「无载体」行单列 unmappable，见 types.ts 说明） */
const CARRIER_MAP: readonly CarrierRow[] = [
  { semantic: '执行配置面', carrier: 'profile + --patch overlay + cmd', strength: '中', status: '已有', note: 'bridge 已接' },
  {
    semantic: '策略投影承载',
    carrier: '无原生概念；须自建 position 插件',
    strength: '—',
    status: '目标',
  },
  {
    semantic: '岗位身份/语气',
    carrier: 'dsh-persona（scoped）',
    strength: '软',
    status: '未证',
    note: '未启用；恒软，不得配为硬',
  },
  {
    semantic: '工作区规则',
    carrier: 'dsh-agent-instructions（AGENTS.md 有界用户消息）',
    strength: '软',
    status: '已有',
    note: 'bridge 等价通道',
  },
  {
    semantic: '工具可见性',
    carrier: 'ctx.tools.restrict',
    strength: '强（对模型）',
    status: '目标',
  },
  {
    semantic: '逐调用判定',
    carrier: 'tools/pre-execute + ctx.tools.guard（allow/deny/ask）',
    strength: '强（对模型）',
    status: '目标',
    note: '判定顺序按四态值集唯一主表 v2/09 ENU-31',
  },
  {
    semantic: '文件写域',
    carrier: 'dsh-sandbox/sandbox-policy（read-only/workspace-write）',
    strength: '强（文件）',
    status: '未证',
    note: 'dump-config 见缺省 workspace-write；实际拦截未探（PRB-04）',
  },
  {
    semantic: '工具呈现/PTC',
    carrier: 'dsh-agent-tool-presentation（native/ptc/both）',
    strength: '中（不足挡任意代码）',
    status: '未证',
    note: '默认档 native（＝ptc 禁用）；启用须单列可达工具子集与 OS 级边界取证（PRB-16）',
  },
  {
    semantic: '审批',
    carrier: 'dsh-user-approval（ask/never，fail-closed）',
    strength: '强（fail-closed）',
    status: '目标',
  },
  {
    semantic: '子 agent',
    carrier: 'dsh-subagent/dsh-tool-subagent（preset/toolFilter/maxDepth）',
    strength: '中（衰减仅进程内后端）',
    status: '目标',
  },
  {
    semantic: '会话续跑',
    carrier: 'dsh-session-persistence（--session-id 透传）',
    strength: '中',
    status: '已有',
    note: '真机实证（studio-dev-230）：原工位原 cwd 跨进程复验；cwd 逐字节一致＝调度纪律',
  },
  {
    semantic: '会话检查点',
    carrier: 'checkpoint-policy（TOOL_OUTCOME_UNKNOWN）',
    strength: '中',
    status: '目标',
  },
  {
    semantic: 'MCP 工具',
    carrier: 'dsh-mcp-client（不在 headless 默认栈）',
    strength: '中',
    status: '未证',
  },
  {
    semantic: '兼容 hooks',
    carrier: 'dsh-hooks-claude-code/dsh-hooks-codex',
    strength: '弱（只 command、一次读取、updatedInput 不生效）',
    status: '未证',
    note: '不作核心策略（hook≠guard）',
  },
  {
    semantic: '网络/进程/秘密/组织/验收/跨进程互斥',
    carrier: '无（宿主词汇不可表达）',
    strength: '—',
    unmappable: true,
    note: '必须外置；「配置里写了」不冒充（v2/12 §〇.3）',
  },
]

/** 损失行（v2/12 §六 BIND-LOSS-01…06＝换离 DSH 的代价；BIND-LOSS-10＝DSH 自身不承载面） */
const LOSSES: readonly CardLossRow[] = [
  {
    lossId: 'BIND-LOSS-01',
    severity: 'blocking',
    description: '换离 DSH 后策略投影下发不可用：无逐岗位工具收紧/逐调用判定/审批设置',
    cannotClaim: '不得称「等价承载策略」；强策略岗不派',
  },
  {
    lossId: 'BIND-LOSS-02',
    severity: 'degrading',
    description: '进程内子 agent 衰减不可用（外部后端本就保留自身权限、无衰减保证）',
    cannotClaim: '不得称「子 agent 继承收紧」',
  },
  {
    lossId: 'BIND-LOSS-03',
    severity: 'degrading',
    description: 'persona/preset 岗位族运行时组合不可用，岗位语气降为通用注入',
    cannotClaim: '不得称「岗位身份等价」',
  },
  {
    lossId: 'BIND-LOSS-04',
    severity: 'degrading',
    description: '会话检查点（副作用前持久化）不可用；留证只剩框架侧主证',
    cannotClaim: '不得称「副作用前留证等价」',
  },
  {
    lossId: 'BIND-LOSS-05',
    severity: 'degrading',
    description: 'position 类事件面（manifest-loaded/denied/drift）不可用，拒绝与偏离证据缺口',
    cannotClaim: '不得称「拒绝可复核」',
  },
  {
    lossId: 'BIND-LOSS-06',
    severity: 'blocking',
    description: 'DSH 插件资产不可用（执行器专属资产；声明必备资产的公司要求接收方具备 DSH）',
    cannotClaim: '不得称「资产跨执行器等价」',
  },
  {
    lossId: 'BIND-LOSS-10',
    severity: 'blocking',
    description: '宿主不承载授权/验收/义务：turn_end.completed 只是执行体自述',
    cannotClaim: '不得把 completed 当 accepted；不得称「DSH 允许＝公司授权」',
  },
]

/** 探针行（v2/12 §1.1 探针 row：PRB-01…04、07…12、16…22；全部 not-executed） */
const PROBES: readonly CardProbeRow[] = deepFreeze(
  ['01', '02', '03', '04', '07', '08', '09', '10', '11', '12', '16', '17', '18', '19', '20', '21', '22'].map(
    (n) => ({ probeId: `PRB-${n}`, state: 'not-executed' as const }),
  ),
)

/** 现状面表（v2/12 §1.2 面表＋§1.1 现状行；每面恰一值，禁「部分已有」混写） */
const FACES: readonly CardFaceRow[] = [
  { face: '命令形态（CLI shell-out）', status: '已有', anchor: 'dsh.ts DSH_DEFAULT_CMD（--profile headless --json）' },
  { face: '版本锁', status: '已有', anchor: 'dsh.ts LOCKED_VERSION（0.2.1-rc.5）' },
  { face: '遥测红线', status: '已有', anchor: 'dsh.ts 头注（DSH_TELEMETRY_MODE=DISABLED 全拉起注入）' },
  { face: '终态判定', status: '已有', anchor: 'dsh.ts 头注（只认 turn_end.reason.kind）' },
  { face: '成本（无金额）', status: '已有', anchor: 'dsh.ts capabilities.cost_native=false（价目表折算）' },
  { face: '插件承载（仅上下文，不挂策略）', status: '已有', anchor: 'instructions-store.ts / packages/dsh-bridge' },
  { face: '会话续跑', status: '已有', anchor: 'dsh.ts resumeWithSession（--session-id，真机实证）' },
  { face: '策略投影/position 插件', status: '目标', anchor: 'v2/12 §1.6（本仓无 position 插件）' },
  { face: '沙箱实际拦截', status: '未证', anchor: 'seatbelt.ts 头注（PRB-04 未执行，按不支持处理）' },
  { face: '长驻宿主（profile/SDK/ACP）', status: '未证', anchor: 'v2/12 §1.2（本仓未实现任何 ACP/SDK 绑定）' },
]

/** BIND-DSH-01 卡本体（冻结常量；装载面见 card.ts loadBindingCard） */
export const DSH_BINDING_CARD: BindingCard = deepFreeze({
  cardId: DSH_BINDING_ID,
  cardVersion: DSH_CARD_VERSION,
  family: 'dsh',
  digest: { computed: false, note: DSH_CARD_DIGEST_NOTE },
  ownerRef: DSH_CARD_OWNER_REF,
  host: {
    name: DSH_HOST_NAME,
    version: DSH_HOST_VERSION,
    license: DSH_HOST_LICENSE,
    launchForm: 'PATH 上的外部 CLI：stdin 喂任务、stdout 收 NDJSON（dsh --profile headless --json）',
    supplyRef: 'v2/13 依赖条目（宿主二进制由部署提供；插件 overlay 由框架侧生成）',
  },
  coverage: [
    '会话内工具面',
    '文件写域',
    '审批',
    '进程内子 agent',
    '会话持久化与检查点',
    '上下文注入',
    '策略投影承载（目标，v2/12 §1.6）',
  ],
  unsupported: [
    '组织/任命/禁配/验收/问责',
    '网络出站',
    '进程隔离',
    '秘密保管',
    '跨进程互斥',
    '权威激活',
    '以上全部外部承接（宿主词汇不可表达，绑定不是授权）',
  ],
  carrierMap: CARRIER_MAP,
  supply: [
    '宿主二进制由部署提供（不进公司包；公司包只携带引用与兼容声明，DOM-06）',
    '插件 overlay 由框架侧生成（落 <rootDir>/tmp/，落点可写性未证——PRB-22）',
    `版本锁 ${DSH_HOST_VERSION}：detect 版本比对不符即报诊断不派；升级＝新档案+全量重探`,
    '一切 dsh 拉起注入 DSH_TELEMETRY_MODE=DISABLED（默认外发已实证）',
  ],
  authorization: {
    mode: 'per-segment',
    unsupportedSegmentRule:
      '未承载段在供给链上最高到第 4/5 态（已落位/已核验），不得记第 6 态（宿主承认该能力）；校验失败＝拒载＋manifest-rejected，不记 drift',
    notAuthority: '绑定不是授权：卡上的「允许」只答技术许可，授权只有 v2/03 四态；DSH 允许≠公司授权',
  },
  evidence: [
    '八类顶层事件流：session/status/thinking/text/tool_call/tool_result/final/error（turn_end 为 status 的 phase）',
    '插件自报事件（position 类事件面＝目标，见专属面）',
    '审批事件',
    '采集者独立（CAP-02；交付方自报仅线索）',
  ],
  losses: LOSSES,
  exportExit: {
    export: '事件流 JSONL 兜底导出（导出面≠可复核能力证明）',
    migration: '换宿主＝新出工段+能力重认+开工五门重判（v2/12 §2.1）；旧清单作废不加载',
    exit: '退出＝停止供给+事件归档；换宿主不换任职（v2/12 §1.6）',
  },
  probes: PROBES,
  faces: FACES,
})
