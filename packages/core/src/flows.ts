/**
 * flows —— 表驱动状态机（docs/18-§二，需求 F1-03）
 *
 * 规格依据（本文件头注即实现单引用）：
 *   - docs/18-§2.1 默认 flow_by_level 模板（公司可覆盖：传入替换，不写死）：
 *       L0: [新单 → 已派发 → 证据就绪 → 复验通过 → 已交付]
 *       L1: [新单 → 待批 → 已派发 → 证据就绪 → 复验通过 → 已交付]
 *       L2: [新单 → 待批 → 已派发 → 证据就绪 → 复验通过 → 待批 → 已交付]
 *   - rollback_edges / type_edges（技术债 promote 等）随表声明。
 *   - 状态权威在平台侧（docs/18-§2.4）：本表只描述"哪些迁移合法"，不做第二份可变状态。
 *
 * 语义说明：
 *   - mainline 是**边序列**而非位次函数：相邻两态构成一条前向边（L2 的「待批」出现两次，
 *     分别产生 待批→已派发 与 待批→已交付 两条边——按名字求"下一个状态"会歧义，按边集不会）。
 *   - nextStates/canTransition 只回答"迁移合法性"（第一道闸 state-diff 的查表依据）；
 *     第二道闸（平台 guard 挂 YouTrack）由 FlowPlatform.guards 安装同源规则，不在本包。
 *   - rollback/type 边仅当两端状态都在该流 mainline 状态集内才生效（跨流回退无意义）。
 *
 * 拟稿待批点（本单汇报，走批示流后再冻结）：
 *   - DEFAULT_ROLLBACK_EDGES 的具体集合（docs/18-§2.1 只举例"已交付→复验打回等"，
 *     下表为拟稿：断路回首批位 = 已派发→新单/待批 两读，暂双收，见 F1-10）。
 *   - DEFAULT_TYPE_EDGES v0 为空表：技术债 promote 的单型语义待 04-公司目录单型冻结后补。
 *
 * 纯逻辑纪律：零 IO、零 Date.now/random、同输入恒同输出。
 */

/** 默认模板状态名（协议锚点：decide 依锚点识别各相位语义；公司覆盖流可换名，锚点随表走） */
export const DEFAULT_STATES = {
  /** 新单（尚未定级/呈批的初始态） */
  fresh: '新单',
  /** 待批（等制作人批示；L1 前置一道、L2 前后各一道） */
  approval: '待批',
  /** 已派发（worker 已/将持有） */
  dispatched: '已派发',
  /** 证据就绪（REPORT 落盘+闸门过，待收割复验） */
  evidenceReady: '证据就绪',
  /** 复验通过（QA 绿，待合并/待交付批） */
  verified: '复验通过',
  /** 已交付（终态，回收相位清理） */
  delivered: '已交付',
} as const

/** 状态流锚点：把语义相位映射到具体状态名（公司自定义流换名时随表传入） */
export interface FlowAnchors {
  fresh: string
  approval: string
  dispatched: string
  evidenceReady: string
  verified: string
  delivered: string
}

export const DEFAULT_FLOW_ANCHORS: FlowAnchors = { ...DEFAULT_STATES }

/**
 * 无审批环哨兵（DEV-43，docs/18-§2.1.1）：类型流未声明 approval 锚时的锚点值（空串）。
 * 构造性安全：decide 5a 比 `successors.includes(approval)`——successors 只含声明状态名
 * （非空），空串永不命中；5b 比 `issue.state === approval`——能到 5b 的单已过步3状态集
 * 校验（状态名非空），空串永不相等。即「无待批位」无需改 decide 状态机即安全。
 */
export const NO_APPROVAL_ANCHOR = ''

/** 一条显式迁移边（rollback_edges / type_edges 用；mainline 的边由相邻关系隐式给出） */
export interface FlowEdge {
  from: string
  to: string
}

/** 单条状态流：主干（隐式前向边）+ 回退边 + 类型专属边 + 锚点 */
export interface StateFlow {
  /** 线性主干：相邻状态两两构成前向边（允许重名状态，见文件头注） */
  mainline: readonly string[]
  /**
   * 终态集（DEV-43，docs/18-§2.1.1）：forwardStates 推导主干前向边时**左态∈终态集即截断**
   * （终态无主干后继）。缺省（等级流现状）=不截断=行为不变。flowStates 仍取 mainline
   * 全集——多终态并列于序表尾部，人类经声明边可达，decide 步3 成员校验不缩水。
   */
  finalStates?: readonly string[]
  /** 回退边（复验打回/断路回炉等）；仅两端都在 mainline 状态集内才生效 */
  rollbackEdges?: readonly FlowEdge[]
  /** 类型专属边（技术债 promote 等）；v0 空表占位 */
  typeEdges?: readonly FlowEdge[]
  /** 语义锚点（缺省用默认模板状态名） */
  anchors?: FlowAnchors
}

/**
 * 流表（DEV-43 键域扩展，docs/18-§2.1.1）：`L<n>`（等级流，现状）∪ `T:<type>`（类型流，
 * 公司 org-config workflows 段声明注入）。公司目录覆盖=整表传入替换。
 */
export type FlowTable = Record<string, StateFlow>

/**
 * 默认回退边（拟稿待批，见文件头注）：
 *   - 已交付 → 已派发：交付后复验打回重做（docs/18-§2.1「已交付→复验打回」例）
 *   - 已交付 → 待批：交付后复议回批位（L1/L2）
 *   - 复验通过 → 已派发：复验结论撤销/打回重做
 *   - 证据就绪 → 已派发：复验不过打回 worker
 *   - 已派发 → 新单：断路器停重派+回首批位（F1-10，L0 读法）
 *   - 已派发 → 待批：断路器回批位（F1-10，L1/L2 读法）
 */
export const DEFAULT_ROLLBACK_EDGES: readonly FlowEdge[] = [
  { from: DEFAULT_STATES.delivered, to: DEFAULT_STATES.dispatched },
  { from: DEFAULT_STATES.delivered, to: DEFAULT_STATES.approval },
  { from: DEFAULT_STATES.verified, to: DEFAULT_STATES.dispatched },
  { from: DEFAULT_STATES.evidenceReady, to: DEFAULT_STATES.dispatched },
  { from: DEFAULT_STATES.dispatched, to: DEFAULT_STATES.fresh },
  { from: DEFAULT_STATES.dispatched, to: DEFAULT_STATES.approval },
]

/** TODO(v0 后续刀): 技术债 promote 等类型专属边——待单型语义冻结（docs/04）后补，v0 空表 */
export const DEFAULT_TYPE_EDGES: readonly FlowEdge[] = []

/** 主干（L0：docs/18-§2.1） */
export const L0_MAINLINE: readonly string[] = [
  DEFAULT_STATES.fresh,
  DEFAULT_STATES.dispatched,
  DEFAULT_STATES.evidenceReady,
  DEFAULT_STATES.verified,
  DEFAULT_STATES.delivered,
]

/** 主干（L1：新单与已派发之间加一道待批） */
export const L1_MAINLINE: readonly string[] = [
  DEFAULT_STATES.fresh,
  DEFAULT_STATES.approval,
  DEFAULT_STATES.dispatched,
  DEFAULT_STATES.evidenceReady,
  DEFAULT_STATES.verified,
  DEFAULT_STATES.delivered,
]

/** 主干（L2：前后双待批） */
export const L2_MAINLINE: readonly string[] = [
  DEFAULT_STATES.fresh,
  DEFAULT_STATES.approval,
  DEFAULT_STATES.dispatched,
  DEFAULT_STATES.evidenceReady,
  DEFAULT_STATES.verified,
  DEFAULT_STATES.approval,
  DEFAULT_STATES.delivered,
]

/** 默认 flow_by_level（docs/18-§2.1 冻结模板；公司覆盖=传入整表替换，不写死） */
export const DEFAULT_FLOW_TABLE: FlowTable = {
  L0: { mainline: L0_MAINLINE, rollbackEdges: DEFAULT_ROLLBACK_EDGES, typeEdges: DEFAULT_TYPE_EDGES },
  L1: { mainline: L1_MAINLINE, rollbackEdges: DEFAULT_ROLLBACK_EDGES, typeEdges: DEFAULT_TYPE_EDGES },
  L2: { mainline: L2_MAINLINE, rollbackEdges: DEFAULT_ROLLBACK_EDGES, typeEdges: DEFAULT_TYPE_EDGES },
}

/** 数字等级 → 流表键（IssueRecord.level 是 number；0→'L0'，未定级→''，未知等级交由查表失败明报） */
export function flowLevelKey(level: number | undefined): string {
  return level === undefined ? '' : `L${level}`
}

/**
 * 单据类型 → 流表键（DEV-43，docs/18-§2.1.1）：`T:<type>`。类型 id 禁冒号
 * （docs/51 W-1 命名空间隔离）；undefined/空串不产键（直落等级回退）。
 */
export function typeFlowKey(type: string | undefined): string {
  return type === undefined || type === '' ? '' : `T:${type}`
}

/**
 * 定流定表（DEV-43 解析序冻结，docs/18-§2.1.1——decide 步2 与 engine flowOf 共用）：
 *   ① `T:<type>` 命中优先（类型流；命中时不要求 level）
 *   ② 回退 `L<level>`（等级流，现状语义原样）
 *   ③ 都未命中 undefined（decide NOOP_UNKNOWN_FLOW / engine 不动，现状语义原样）
 * type 为 undefined/空串不查 T 键。保留词 bug/task 恒查不到 T 键（docs/51 W-9：
 * workflows 判定器拒收同 id 声明——断路单「待人定级后派」与岗单 L0 物化语义保持）。
 */
export function resolveTicketFlow(
  table: FlowTable,
  type: string | undefined,
  level: number | undefined,
): StateFlow | undefined {
  const typeKey = typeFlowKey(type)
  if (typeKey !== '') {
    const byType = table[typeKey]
    if (byType !== undefined) return byType
  }
  return resolveFlow(table, flowLevelKey(level))
}

/** 该流的状态全集（mainline 去重，保持首现顺序） */
export function flowStates(flow: StateFlow): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of flow.mainline) {
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** 该流的锚点（缺省回退默认模板状态名） */
export function flowAnchors(flow: StateFlow): FlowAnchors {
  return flow.anchors ?? DEFAULT_FLOW_ANCHORS
}

/** 显式边表（rollback+type 合并；仅保留两端都在状态集内的边） */
function explicitEdges(flow: StateFlow, states: ReadonlySet<string>): readonly FlowEdge[] {
  const edges = [...(flow.rollbackEdges ?? []), ...(flow.typeEdges ?? [])]
  return edges.filter((e) => states.has(e.from) && states.has(e.to))
}

/**
 * 合法后继状态集（确定性顺序：主干前向边 → rollback → type，去重保首现）。
 * 未知状态返回空数组（不在流内=平台侧自定义态，daemon 不动它）。
 */
export function nextStates(flow: StateFlow, state: string): readonly string[] {
  const states = new Set(flowStates(flow))
  if (!states.has(state)) return []

  const out: string[] = []
  const push = (s: string): void => {
    if (!out.includes(s)) out.push(s)
  }

  for (const s of forwardStates(flow, state)) push(s)
  for (const e of explicitEdges(flow, states)) {
    if (e.from === state) push(e.to)
  }
  return out
}

/**
 * 主干前向后继（仅 mainline 相邻边，不含 rollback/type）。
 * decide 的结构性推演（派发就绪/呈批/合并去向）只用它——回退边是"允许的修复路径"，
 * 不是"机器该走的下一步"（例：已交付 --rollback--> 已派发 不得触发再派发）。
 * 终态截断（DEV-43，docs/18-§2.1.1）：左态∈finalStates 则不产生该前向边——多终态
 * 并列于序表尾部时，首位终态之后的声明态不是机器主干可达（人类经声明边到达）。
 */
export function forwardStates(flow: StateFlow, state: string): readonly string[] {
  const finals = flow.finalStates === undefined ? undefined : new Set(flow.finalStates)
  const out: string[] = []
  for (let i = 0; i < flow.mainline.length - 1; i++) {
    if (flow.mainline[i] === state) {
      if (finals?.has(flow.mainline[i] as string)) continue // 左态终态：截断
      const next = flow.mainline[i + 1]
      if (next !== undefined && !out.includes(next)) out.push(next)
    }
  }
  return out
}

/** 迁移合法性判定（第一道闸查表；第二道闸=平台 guard，同源规则） */
export function canTransition(flow: StateFlow, from: string, to: string): boolean {
  return nextStates(flow, from).includes(to)
}

/** 查流表：键缺失返回 undefined（decide 对 undefined 明报 NOOP_UNKNOWN_FLOW，不猜默认流） */
export function resolveFlow(table: FlowTable, key: string): StateFlow | undefined {
  return table[key]
}
