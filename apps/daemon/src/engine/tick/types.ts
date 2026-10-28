/**
 * tick/types —— 一拍主循环的配置与在途状态**类型面**（DISP-02 第一步：类型环解耦）
 *
 * 规格依据（实现单引用）：
 *   - docs/v2/16 §三 daemon 行（DISP-02）：engine.ts（基线 2337）拆分「先解类型环再拆
 *     行为」——EngineConfig／Inflight 等类型先归位本文件，再按域拆 tick/dispatch/
 *     harvest/breaker、engine.ts 留薄 facade（本单只做第一步，不拆行为）；
 *   - docs/plan/05 IMPL-06-01（领土＝本文件[新]＋engine.ts 类型引用改造）；docs/plan/02
 *     §五-2（engine.ts 基线只降）／§七-4（基线棘轮只降不升）；
 *   - 语义出处：docs/17-§2（每拍幂等相位机）、docs/17-§6（断路器／收割四要件）、
 *     docs/17-§7（读面分级）、docs/16-§三（预算双帽）等——注释随类型逐字迁入。
 *
 * 迁入清单（自 engine/engine.ts、engine/merge/merge-run.ts 原样搬迁——类型形状／
 * 注释／缺省值零漂移，零行为变更）：
 *   - EngineConfig ＋ ENGINE_CONFIG_DEFAULTS（引擎配置与其缺省常量）；
 *   - Inflight（在途工位）＋其直接依赖小类型 MergeRunContext／MergeRunDeps（202-P2
 *     合并跑注入面／在途上下文）——随归位消除 tick 类型面对 merge 运行体的反向类型引用。
 *
 * 解环（DISP-02 的结构保证；HEAD 实测口径）：
 *   - 旧图：5 件类型环＝engine.ts ⇄ merge-run.ts／merge-lease.ts（两件回引 engine.ts 取
 *     EngineConfig／Inflight）＋ tick-report/types.ts（经 merge-lease 回引）；engine.ts 与
 *     serve.ts 之间只有单向 serve→engine（EngineConfig 定义在 engine.ts）；另 serve.ts 与
 *     assembly 三件（channels／wire／hrsync-assemble）自成 ServeConfig 类型环（06-05 面）。
 *   - 新图：本文件＝叶子类型面，只引契约／core 的类型面与零依赖叶子件（merge-gate 的
 *     端口类型、read-tiers 的 ReadTier）——engine.ts／merge-run.ts／merge-lease.ts 与
 *     tick-report（经 merge-lease 传递）全部单向指向本文件；engine.ts 退出全部导入环
 *     （零类型回引），serve→engine 仍为单向（不新增任何反边）。
 *   - 边界：ServeConfig／RunServeOpts 不在此处——v2/16 §三定为 **assembly** 面（serve 拆
 *     config/runtime/run 归 IMPL-06-05），且 engine→assembly 为 BC-V1 反边违例；本单不碰
 *     serve.ts（06-05 领土）。
 *
 * 铁律：本文件只放类型与常量（零运行逻辑：无函数体／IO／可变状态）；引擎消费面仍经
 * engine.ts 再出口（旧导入路径与导出名全兼容）。
 */
import type { Handle, StreamEvent, TicketId } from '@studio-next/contract'
import {
  DEFAULT_QUEUE_AGE_STEP_MS,
  type ConcurrencyLimits,
  type FlowTable,
  type QueueRanker,
  type TierId,
} from '@studio-next/core'
import type { MergeGateCommandPort, MergeGitPort } from '../merge/merge-gate.ts'
import type { ReadTier } from '../read-tiers.ts'

// ————————————————————————— 配置 —————————————————————————

/** 引擎配置（并发三闸阈值即 ConcurrencyLimits，docs/17-§2） */
export interface EngineConfig {
  /** 公司 slug（events.company / intents.company / ticket_mirror.company） */
  company: string
  /**
   * daemon 工位根（rootDir 属 daemon 自管面——tmp/instructions、platform、控制面等落此；
   * 派发 workspace 缺省旧布局 `<rootDir>/workspaces/<单号>/att<N>`——aiwsRoot 未注入时
   * 的引擎直连测试回退路径，正式链路 serve 恒注入 aiwsRoot）
   */
  rootDir: string
  /**
   * .AIWS 员工工作区树根（DEV-28，docs/43-§五 派发权限圈①cwd——serve 推导注入：
   * 显式配置 > dirname(companyDir)/.AIWS > <rootDir>/.AIWS）：给定 → 派发 workspace
   * = `<aiwsRoot>/<部门路径>/<工号>/tickets/<单号>/att<N>`（收割四要件与 deliverables
   * 收账经 dirname(briefPath) 全随迁）；缺省 → 上述旧布局。
   */
  aiwsRoot?: string
  /**
   * 公司目录根（DEV-50 岗产物落位收账锚）：收割 GATE_PASS 后按 jobs[].output 声明
   * 落点把工位 REPORT 收账进公司目录 reports/ 位（docs/04-§三 / 17-§6 后置收账步）。
   * 缺省不注入=面关闭（既有链路零行为变化）。
   */
  companyDir?: string
  /** events.actor（17-§3「工号+账号」编码归 store 层定——v0 'daemon' 拟稿） */
  actor: string
  /** 派工默认工号（issue.assignee 缺省时的人员索引回退位） */
  defaultPersonId: string
  /**
   * data-change 路由表登记位（129-§6.1①：变更类型 → 联动单 assignee；拆单 C 接线
   * org-config hooks.data_change.routes——入/调/退→HF-1 对账〔docs/52-§13 C1-08 口径〕，
   * 升/降→PLN 线）。引擎消费语义：命中路由且目标在人事索引→物化联动单；未配/未命中/
   * 目标未知→明报拒收（fail-closed 无 defaultPersonId 兜底——mention 同款防错人纪律）。
   */
  dataChangeRoutes?: Readonly<Record<string, string>>
  /**
   * cost-threshold 缺省指派目标登记位（129-§6.3 P0-B「payload.target 缺省路由表」：
   * escalate 警戒处置单 assignee——接线 org-config hooks.cost_threshold.target 规范位
   * ＋daemon.yaml costThresholdTarget 逃生位合并）。解析序 payload.target＞本位＞明报
   * 拒收；目标须在人事索引（fail-closed 无 defaultPersonId 兜底——同上防错人纪律）。
   */
  costThresholdTarget?: string
  /**
   * cost-threshold 警戒处置单泳道落位（129-D 181）：显式配置优先；未配回退指派目标
   * 部门 lanes[0]（错位会跨部占道——lane 租约独占）；再无=不设（派发回退 defaultLane）。
   * 规范位 org-config hooks.cost_threshold.lane＋逃生位 daemon.yaml costThresholdLane。
   */
  costThresholdLane?: string
  /** events.dept / ticket_mirror.dept 兜底 */
  deptFallback: string
  /** issue.lane 缺省泳道 */
  defaultLane: string
  /** InvokeIntent.source（v0 活动流轮询源名） */
  intentSource: string
  /** 并发三闸之两闸（第三闸=泳道租约） */
  limits: ConcurrencyLimits
  /** 泳道租约 TTL（ms；续租/死主回收归后续刀） */
  laneTtlMs: number
  /** 合并租约 TTL（ms；202-P4——每拍续租+死主回收，跨进程归后续刀） */
  mergeLeaseTtlMs: number
  /** 在工静默告警阈值（ms；只盯已派发态，decide 4 号判定） */
  stallAfterMs: number
  /**
   * STALL 响置咬合阈（DEV-44，2026-10-20 三例实证 studio-dev-20/25/71：看门狗只叫不咬）：
   * 同 attempt 内 STALL 告警达 N 次（计数=最近一次 DISPATCH 起的事件派生，可重放）→
   * 响置闭环（executeStallResponse）：有在途句柄=整树杀（stop 通道同款 kill 链，02-F1-08
   * 「kill 后等死再重派」——await adapter.kill 即等死）→ 工位收口 interrupted（R-B 在途
   * 语义）→ 回首批位重派 attempt+1（activity 键未释放，重派靠 rescan 兜底，DEV-42①）；
   * 无在途句柄（工人消亡面）=GATE_FAIL（WORKER_DEAD 分类）收口+断路连击。两面均入断路器
   * （dispositions：STALL countsTowardBreaker——防「挂死-杀-重派」无限循环）。
   * 0=关（只叫不咬——负对照/缺陷存档用）；缺省 2（拟稿待批）。
   */
  stallKillAfterAlarms?: number
  /**
   * 收割相位增量泵流的每工位每拍时间片（ms；DEV-9 P1 冻结修复，docs/17-§2 拍有界）：
   * 事件就绪即折算（microtask 先于计时器——完成流仍同拍收口，fake 全家桶行为不变）；
   * 无事件即驻留让出拍界（心跳/热重载/看门狗回拍边界）。墙钟（非注入时钟）——
   * 泵流节奏是运行时活性面，不进台账账面。
   */
  harvestSliceMs: number
  /** 断路阈值 N（17-§6 默认 3） */
  breakerThreshold: number
  /**
   * 断路半开冷却窗 ms（DEV-46，2026-10-20 studio-dev-78 实证后的修法）：熔断后停重派
   * 至冷却窗过 → 放行一次半开试探派发（DISPATCH note 携 half-open-probe 锚）——成功
   * =GATE_PASS 断路复位，失败=回全开续冷却（trippedAt 刷新）。0=熔断即试探（负对照/
   * 测试隔离用）；缺省 30min（拟稿待批——外部服务限速类自愈等待面）。
   */
  breakerCooldownMs?: number
  /** demo 模式自动批（真制作人批准信号经网关动作词归一，v0 布尔拟稿） */
  autoApprove: boolean
  /** 零动作拍 HEARTBEAT 的哨兵单号（contract events.issue 必填——拟稿待批） */
  heartbeatIssue: string
  /** 每拍 activity 翻页上限 */
  maxActivityPages: number
  /** dispose() 优雅杀宽限（ms） */
  killGraceMs: number
  /**
   * 镜像对账重决策节流（DEV-42 ①）：每 N 拍把非闭环 mirror 单补进决策候选——活动
   * 驱动候选只看「有新活动」，被三闸顺延且活动已被游标消费的单会永久搁置（实测
   * studio-dev-45..53 滞留数小时）。list 全量每拍已取=补进零额外平台 IO；N=节流闸
   * （防 noop 决策日志无界放大）。0=关；缺省 30。
   */
  mirrorRescanEveryTicks?: number
  /**
   * 状态集巡逻核节流（DEV-49 A4，docs/52-§十）：每 N 拍核对「平台状态集−有效流表
   * 声明集=∅」（C1-08 口径），不成立对心跳哨兵单 ESCALATE（事件派生键去重）。
   * 节流=schema() 读放大；0=关；缺省 30（最坏 30 秒回归发现延迟）。
   */
  statusSetPatrolEveryTicks?: number
  /** C2 声明态面（studio-dev-126，wire.ts 单源计算）；缺省=面关 */
  provisionDeclaredStates?: readonly string[]
  /**
   * 州表卫生白名单（127-C，studio-dev-127 §4.7：org-config yt.known_foreign_states →
   * CompanySnapshot.knownForeignStates，serve 装配+热重载注入）：已知外来态——DEV-49
   * 单级哨不升 ESCALATE 降 FOREIGN_KNOWN 观察级（每单每态一条），巡逻核公式
   * 「平台状态集−(声明集∪白名单)=∅」并集吸收；未声明新漂移仍 ESCALATE（负对照
   * 保护）。缺省=无白名单=哨兵现状全灵敏度（面关零行为变化）。
   */
  knownForeignStates?: readonly string[]
  /**
   * 收割尾对账步节流（P3，studio-dev-100 提案 §4.3-1，全批）：每 N 拍对收割成功单跑
   * 「jobs[].output 声明落点×公司目录实际文件」对账——缺归档=REPORT_MISSING+哈希
   * 幂等补收（异哈希转人工不覆盖）。companyDir 未注入=面未开；0=关；缺省 30。
   */
  harvestReconEveryTicks?: number
  /**
   * 票级预算帽缺省（USD；docs/16-§三 reserve 票帽面）：TaskBrief.budgetCap（单票面）
   * 优先，缺省回退本帽；两者皆无=不设限。超帽=refusal 行落账且不派（20-§六.8）。
   */
  budgetTicketCapUsd?: number
  /**
   * 岗级预算帽缺省（USD；04-§四岗级预算）：仅价目表态（catalog 注入）生效——
   * 估算两态见 src/engine/budget-gate.ts 头注（态 B 估算=适配器自报，岗级比较基准无依据）。
   */
  budgetPersonCapUsd?: number
  /** 状态流表覆盖（公司目录 flows；缺省 DEFAULT_FLOW_TABLE，docs/18-§2.1） */
  flows?: FlowTable
  /**
   * 读面分级（17-§7）：role→tier 覆盖表（有效表={...DEFAULT_ROLE_READ_TIERS, ...本表}；
   * 缺省映射 main_worker=Full/verifier=Blind/其余 Focused 拟稿可配——见 src/engine/read-tiers.ts 头注）。
   */
  readTierByRole?: Readonly<Record<string, ReadTier>>
  /**
   * Blind 档冻结验收命令来源（与装配器 acceptance **同源**注入——serve 持同一常量，
   * 不双源）。遇 Blind 派发而未配/为空 → createView CONFIG_INVALID fail-closed（无验收
   * 不派工，纪律 3），派发失败明报，不静默降档。
   */
  readBlindAcceptance?: readonly string[]
  /**
   * 队列 ageBoost 步长 ms（129-§6.2-R4 排序键：wait/step 取档、两档封顶）：
   * 缺省 60min（core DEFAULT_QUEUE_AGE_STEP_MS 单一源）。档=tier→score 加成：
   * 排队 1 步=+1、2 步及以上=+2 封顶（饥饿防线——低优老单最终压过高优新单，
   * 但永不全额压制 3 级紧急单）。
   */
  queueAgeStepMs?: number
  /**
   * 人闸每人并发覆盖表（129-§6.2-R3 第四闸）：工号→在工帽。缺省帽=limits.
   * maxInflightPerPerson（缺省 1）；**只有批量执行岗**可配 >1（daemon.yaml
   * `personInflightOverrides: P-1=2;P-2=3` 扁平分号对——matrixRoles 先例）。
   */
  personInflightOverrides?: Readonly<Record<string, number>>
  /**
   * 模型档路由面（studio-dev-196，制作人 2026-10-22 三档定调）：modelTierByRole=
   * models.yaml roles 直录（岗位→档；**注入即开面**——缺省不注入=面关，派发行为
   * 与本单之前逐字节一致）；modelTierTickets=daemon.yaml modelTierTickets 显式
   * 单级覆盖（`TICKET=high;…` 分号对，org-config 规范位/单据字段=登记债务）。
   * 解析序与派发面语义见 src/engine/model-tier.ts 头注（单>岗>角色三级）。
   */
  modelTierByRole?: Readonly<Record<string, TierId>>
  modelTierTickets?: Readonly<Record<string, TierId>>
  /**
   * 制作人置顶单集（129-§6.2-R4：pinned=+∞ 恒首）。daemon.yaml `pinnedTickets:`
   * 逗号清单（平面字段写通道归刀B，登记在案）；现算不入携带态——改配置即刻生效。
   */
  pinnedTickets?: readonly string[]
  /**
   * 队列排序器注入位（129-§6.2-R1 升级位）：缺省不注入=core rankQueue 规则缺省档
   * （冻结公式）；160-B 小模型档接线时注入（接口面已冻结，本单不实现）。
   */
  queueRanker?: QueueRanker
}

/** 缺省引擎配置（demo/测试可直接改写；serve 侧由 daemon.yaml 覆盖） */
export const ENGINE_CONFIG_DEFAULTS: EngineConfig = {
  company: 'demo',
  rootDir: './var',
  actor: 'daemon',
  defaultPersonId: '',
  deptFallback: 'departments/工程部',
  defaultLane: 'core',
  intentSource: 'activity',
  limits: { maxActionsPerTick: 4, maxInflight: 2 },
  laneTtlMs: 30 * 60_000,
  mergeLeaseTtlMs: 30 * 60_000, // 202-P4 合并租约缺省=泳道同款（daemon.yaml 可覆盖）
  stallAfterMs: 60 * 60_000,
  stallKillAfterAlarms: 2,
  harvestSliceMs: 50,
  breakerThreshold: 3,
  breakerCooldownMs: 30 * 60_000,
  autoApprove: false,
  heartbeatIssue: '-',
  maxActivityPages: 10,
  killGraceMs: 5_000,
  mirrorRescanEveryTicks: 30,
  statusSetPatrolEveryTicks: 30,
  harvestReconEveryTicks: 30,
  queueAgeStepMs: DEFAULT_QUEUE_AGE_STEP_MS,
}

// ————————————————————————— 合并跑注入面（Inflight.mergeRun 直接依赖；202-P2 studio-dev-232） —————————————————————————

/** 合并跑依赖（serve 装配注入；缺省=面关零行为——v0 模拟轨不变） */
export interface MergeRunDeps {
  /** 目标分支（R5：恒 dev 家分支；缺省 'dev' 由 serve 给） */
  targetBranch: string
  /** 冻结门禁命令（R1：引擎亲跑；缺省 ['bun','run','test'] 由 serve 给） */
  gateCommand: readonly string[]
  /** 工位内 repo 相对路径（默认 'repo'——工位约定布局） */
  repoRelPath?: string
  /** git 四原语+代推端口（真实现=default-deps.ts spawn 版；测试=fake） */
  git: MergeGitPort
  /** 门禁命令端口（repo 内执行；超时=code≠0+note 如实） */
  gate: MergeGateCommandPort
}

/** 在途合并跑上下文（Inflight.mergeRun 在场=合并跑收割位别接线生效） */
export interface MergeRunContext {
  deps: MergeRunDeps
  leaseKey: string
  targetBranch: string
  /** 派发时工位 repo HEAD（提交核验基线：须成目标分支祖先） */
  reviewTip: string
  receiptPath: string
  /** 因果链锚：所续工时单 id（DISPATCH causation_id 同源） */
  causationId: string
  /** dsh 侧会话 id（契约 v1.5——resumeWithSession 唤起证据，MERGE note 留痕） */
  executorSessionId: string
}

// ————————————————————————— 在途状态 —————————————————————————

/** 在途工位（dispatch 落 work_record 'running' 后登记；harvest 收口后注销） */
export interface Inflight {
  ticket: TicketId
  workRecordId: string
  executor: string
  handle: Handle
  workspace: string
  briefPath: string
  attempt: number
  lane: string
  /** 派工对象工号（收割 settle 的人档行 scope；reserve 链的 person 桥同源） */
  personId: string
  /** 派发拍序：本拍派发的下一拍才可收割（同拍单至多一动作的收割侧落点） */
  dispatchedAtSeq: number
  /**
   * bridge 通道（agents_md≠native）的每任务指令临时文件（docs/25-§3.1 v1.5#1）：
   * 保留至收割完成（worker 全程可读、抗 compact 重注入）→ GATE_PASS/GATE_FAIL 删；
   * native 通道无此文件（AGENTS.md 恒在 workspace，收割后保留——工位证据）。
   */
  instructionsPath?: string
  // —— 增量泵收状态（DEV-9 P1 冻结修复，docs/17-§2 拍有界；一次性流跨拍续收） ——
  /** 驻留的一次性流迭代器（首收拍创建；一流一收纪律不变——dsh 单发流不二开） */
  streamIter?: AsyncIterator<StreamEvent>
  /** 驻留中的 next()（附 catch 防悬空拒绝：异常记 streamError，下一拍收口 WORKER_DEAD） */
  streamNext?: Promise<IteratorResult<StreamEvent>> | undefined
  /** 驻留期已吞的流异常（与同步抛同面收口） */
  streamError?: string
  /** 流已收尾（done）——本拍可走判定体 */
  streamDone?: boolean
  /** 逐拍折算的四要件输入（要件 1：终态 completed） */
  foldCompleted?: boolean
  /** 逐拍折算的四要件输入（要件 2：输出非空） */
  foldNonEmpty?: boolean
  /** 逐拍折算的 turn_end.error（终局错误原文，失败面 note 用） */
  foldTerminalError?: string
  mergeRun?: MergeRunContext // 202-P2：在场=收割位别接线（closeOutMergeHarvest/failMergeHarvest 面）
}
