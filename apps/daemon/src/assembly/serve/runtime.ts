/**
 * serve/runtime —— serve 运行时装配（运行栈＋依赖注入）
 *
 * 依据（实现单引用）：plan/05 IMPL-06-05「serve 拆分·config/runtime/run」（LANE-E）；
 *   docs/v2/16 §三 daemon 行（DISP-02：serve 拆 config/runtime/run，薄壳只留转发）；
 *   docs/17-§2（主循环七相位——装配不改相位）；22-§一（唤起源注册表，源零直驱）；
 *   17-§7（网关写收口）；38-§2（L1 热重载）；130-P3（频道供给）；105-刀B（notify 广播）。
 *
 * 职责：buildServeRuntime —— executor 注册/平台网关/人事同步/频道供给/notify 广播/唤起源
 * 注册表的装配，返回统一 ServeRuntime（engine＋scheduler＋sources＋hotReload＋stop）。
 * 行为/错误码/事件序与原 assembly/serve.ts 装配段零漂移；run.ts 只消费返回值。
 *
 * 拆分纪律（20-§十五.三／.四）：本文件是 assembly/serve/ 子域件，域平面零新增散件；
 * 配置解析/身份派生在 config.ts，主循环与停机编排在 run.ts，executor 注册面在
 * executor-face.ts——拆出件与本文均 <600 行（尺寸阈即拆件依据）。
 */
import { AIWS_DIR, ensureAiwsTree } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE } from '@studio-next/core'
import type {
  CompanySnapshot,
  CostGuardConfig,
  EventRecord,
  InvokeSource,
  PersonRef,
  ScheduledJob,
  SourceManifest,
  TicketId,
} from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import path from 'node:path'
import { createEngine, ENGINE_CONFIG_DEFAULTS, parseDataChangeRoutes, type Engine, type EngineConfig } from '../../engine/engine.ts'
import { runEvolveStartupSelfCheck, type EvolveSelfCheckReport, type FrozenAsset } from '../../evolve/evolve-guard.ts'
import { mergeDataChangeRoutes } from '../../engine/intents/taxonomy.ts'
import { createCostNotifyOutlet, mergeCostThresholdDefaults } from '../../engine/intents/escalate.ts'
import { createGateway, CONTROL_TICKET } from '@studio-next/gateway'
import { wirePeopleChangeSource } from '../../engine/hrsync/people-change-source.ts'
import { wireRelaySource, wireResumeSource, type RelayWorkSignal } from '../../engine/intents/relay-resume-sources.ts'
import { buildServeDirectiveDeps } from '../../engine/directive/index.ts'
import { createDefaultGateRunner, createAcceptanceGateRunner } from '../../engine/gate.ts'
import { createDefaultMergeRunDeps } from '../../engine/merge/default-deps.ts'
import { createHotReload, type HotReload, type HotReloadApplyReport } from '../../control/hot-reload.ts'
import { wireServeOps, type ServeOpsFace } from '../ops/index.ts'
import { makeUlid } from '../../engine/tools/id.ts'
import { logJobContractWarnings } from '../../engine/jobs/freshness.ts'
import { registerJobSources } from '../sources/jobs.ts'
import { createDefaultAssembler, type PromptAssembler } from '../../engine/prompt-assembly.ts'
import type { Scheduler } from '../../engine/scheduler.ts'
import { flowsFromWorkflows } from '../../engine/typeflows.ts'
import type { MatrixHrFace } from '../../engine/hrsync/hrsync.ts'
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../../engine/rooms/room-duty.ts'
import { wireNotifyAssembly } from '../notify/notify.ts'
import { wireServeOutboundGate } from '../outbound-gate/wire.ts'
import type { NotifyBroadcastFace } from '../../engine/notify/broadcast.ts'
import { assembleHrSync, hrApplySegment } from '../hrsync/assemble.ts'
import { loadTaigaFieldMap, provisionDeclaredStates, wireGatedPlatform, wirePlatform } from '../platform/wire.ts'
import {
  createFileWatchSource,
  createSchedulerSource,
  createSourceRegistry,
  FILE_WATCH_MANIFEST,
  SCHEDULER_SOURCE_MANIFEST,
  type SourceRegistry,
} from '../../engine/sources.ts'
import { queueServeOverrides } from '../../engine/todoqueue/queue.ts'
import { reEnsureChannels, startChannelSupply, wireRoomFace } from '../channels/channels.ts'
import { seedJobs, removeMissingJobs } from '../jobs-seed/jobs-seed.ts'
import { daemonIdentity, type ServeConfig } from './config.ts'
import { wireExecutorFace } from './executor-face.ts'
import { wireServeApi, type ServeApiWiring } from '../api/serve-face.ts'
import type { WorkerKeyDeps } from '../../engine/worker-key.ts'

/** serve 运行栈（engine + 唤起源注册表 + PORT-OPS 面 + 统一停机面；runServe 与测试共用装配） */
export interface ServeRuntime extends ServeOpsFace {
  engine: Engine
  scheduler: Scheduler | null
  /** 唤起源注册表（22-§一）：startAll 的 emit 统一进 engine.ingest（runServe 接线） */
  sources: SourceRegistry
  /**
   * L1 配置热重载执行体（docs/38-§2 L1 / §4 R-A；companyDir 给定时存在）：
   * runServe 主循环在**拍边界**（tick() 收口后）调 check()——指纹自动 + 控制面手动
   * 两触发面；缺省=未挂公司目录（demo 快照），L1 不适用（reload 请求由
   * answerReloadNoCompanyDir 回执拒绝）。详见 src/control/hot-reload.ts 头注。
   */
  hotReload?: HotReload
  /**
   * 启动期进化判负自检汇报（src/evolve/evolve-guard.ts，v0 观察模式）：ESCALATE 事件已在装配期
   * 落账（unauthorized 时）；本字段为汇报面（测试/面板观测锚）。
   */
  evolveSelfCheck: EvolveSelfCheckReport
  /**
   * 续命意图推送面（129-E 单E，studio-dev-184；resume: true 时存在）：v0 生产调用面=
   * 测试与后续 CLI `studio resume <单号>`（50a-B4 归档在册——命令面另批，此处先露面）。
   */
  resumePublish?: (ticket: TicketId, cause?: string) => boolean
  /**
   * notify 事件中继（105-刀B，studio-dev-219；notifyBroadcast 注入时存在）：
   * runServe 主循环在拍边界（tick() 收口后）以本拍新事件 TickReport.events 调用——
   * 按冻结路由表广播 #alert/部门频道/总览（docs/17-§2 七相位结构不动：中继在相位外
   * 只读消费）。永不抛（软失败=日志+计量 failed 数，面板仍第一落点——刀B-6）。
   */
  notifyRelay?: (events: readonly EventRecord[]) => Promise<void>
  /** 对外 API 同进程装配面（MIG-06 收口；v2/14 §四）：runServe 在源启动前 await start()，停机先 close() */
  api: ServeApiWiring
  /**
   * 优雅停：先关 API 入口（不再接新请求）→ stopAll 唤起源（不再进新意图）→ 在途 drain
   * → 关台账（SIGINT/SIGTERM 同一收口；可重入）。队列中未消费意图停机即弃（at-most-once，
   * 与调度器 markRan 已提交而 ingest 未消费的既有边界同语义——engine.ts 头注）。
   */
  stop(): Promise<void>
}

/** matrix 源 manifest（工厂注入面——daemon 不强依赖 @studio-next/matrix，22-§二） */
const MATRIX_MANIFEST: SourceManifest = {
  name: 'matrix',
  kind: 'mention',
  configSchema: '注入工厂（装配单元供 createMentionSource 产物；daemon.yaml matrix 开关）',
}


/**
 * worker 级 wkey 接线（17-§7「按单签发→随派发注入→关单吊销」；src/engine/worker-key.ts）。
 * gateway: false 时不签发（与控制面同开关）；签发实例绑 CONTROL_TICKET——本实例只用
 * issue/revoke 面，verify 面结构性失效（永远不能验 worker key，防误用；worker 侧验签
 * 归 per-ticket studio-tools 接线，吊销跨进程可见性疑点见 worker-key.ts 头注）。
 * 身份=共享活对象（与控制面同源——L1 热重载 mutate 面）。
 */
function wireWorkerKeys(config: ServeConfig, identity: ReturnType<typeof daemonIdentity>, clock: () => number, log: (line: string) => void): WorkerKeyDeps | undefined {
  if (!config.gateway) return undefined
  const { secret, ctx, author } = identity
  const gateway = createGateway({ secret, clock, ticket: CONTROL_TICKET, ctx, author })
  log('[serve] worker wkey 已接：按单签发 → TaskBrief.credentials（env 通道，子进程 env STUDIO_TOOLS_WKEY）→ GATE_FAIL/断路/CLOSE 吊销（17-§7；scope=六动词全集；凭据值红名单——不入提示词/档案/任务书/日志）')
  return { gateway }
}

/**
 * 装配 serve 运行栈：唤起源统一走注册表（22-§一）——
 *   - jobs=true：快照播种 + scheduler 源注册（源开关=既有 jobs 键，缺省语义不动）；
 *   - matrix=true：注入工厂装配（开而未注入=CONFIG_INVALID 拒启动）；
 *   - fileWatch=true：watch-file 示例源注册（fileWatchPath 必配）。
 * 源的 emit 由 runServe 的 startAll 统一接进 engine.ingest——源零直驱，决策归主循环。

 */
export function buildServeRuntime(
  config: ServeConfig,
  ledger: Ledger,
  snapshot: CompanySnapshot,
  opts?: {
    log?: (line: string) => void
    clock?: () => number
    quarantineMs?: number
    /** matrix 源工厂（matrix: true 时调用；不注入=CONFIG_INVALID——daemon 不强依赖 matrix 包） */
    matrixSource?: () => InvokeSource
    /**
     * Matrix 人事执行面工厂（DEV-48，docs/52-§七；hrSync+hrMatrix: true 时调用）：
     * 装配单元注入 createMatrixHrFace 产物（结构同形 engine/hrsync MatrixHrFace——
     * daemon 不 import @studio-next/matrix，同 matrixSource 注入纪律）。
     */
    hrMatrixFace?: () => MatrixHrFace
    /**
     * Matrix 频道供给面工厂（130-P3，130 提案 §6.7.3-③；matrixChannels: true 时调用）：
     * 装配单元（apps/boot）注入 createMatrixProvisionFace 产物（结构同形 engine/rooms/room-duty
     * MatrixRoomFace——daemon 不 import @studio-next/matrix，同注入纪律）。ctx.snapshot 活取
     * 公司快照（L1 热重载新鲜面）——daemon 只收工厂不持 Matrix 网络面。
     */
    matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
    /**
     * notify 广播面（105-刀B，studio-dev-219；matrixChannels: true 时由 boot 注入）：
     * createMatrixBroadcastFace 产物（结构同形 engine/notify/broadcast NotifyBroadcastFace
     * ——daemon 不 import @studio-next/matrix，同注入纪律）。注入后：①拍边界中继把本拍
     * 新事件（TickReport.events）按冻结路由表广播到 #alert/部门频道/总览；②engine escalate
     * cost-threshold 警戒出口从 v0 日志线切到 IM 即时广播（129 批示项④）。不注入=面关零
     * 行为（v0 出口保留——面板第一落点语义不变）。
     */
    notifyBroadcast?: NotifyBroadcastFace
    /** 出站脱敏补充秘密面（DEV-48，docs/52-§十二；matrix shared_secret 等装配单元持有物） */
    hrKnownSecrets?: readonly string[]
    /**
     * 进化判负自检注入面（测试确定性；缺省=仓样例集 FROZEN_FRAMEWORK_ASSETS + cwd 真文件
     * 哈希——src/evolve/evolve-guard.ts 头注锚定口径）：manifest/hashFile/fileExists 逐项覆盖。
     */
    evolveSelfCheck?: {
      manifest?: readonly FrozenAsset[]
      hashFile?: (assetPath: string) => string
      fileExists?: (assetPath: string) => boolean
    }
  },
): ServeRuntime {
  const rawLog = opts?.log ?? ((line: string): void => console.log(line))
  const clock = opts?.clock ?? ((): number => Date.now())
  // —— 出站闸（IMPL-07-11；docs/v2/15 §4.4/4.5）：五出口＋三不入统一件。日志/平台写/通知/
  //    提示词/台账五处即刻过闸；证据导出与 API 响应登记显式 gap（outbound-gate/exits.ts）
  const outbound = wireServeOutboundGate({
    env: process.env,
    ledger,
    company: config.company,
    dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    issue: ENGINE_CONFIG_DEFAULTS.heartbeatIssue,
    clock,
    rawLog,
    ...(opts?.hrKnownSecrets !== undefined ? { extraKnowns: opts.hrKnownSecrets } : {}),
  })
  const log = outbound.guardLog(rawLog)
  // 三不入·库（docs/v2/15 §4.5）：台账写口一处收口（失败落账 sink 持原件，避免自噬）
  ledger = outbound.createStoreWriteGuard(ledger)

  // —— PORT-OPS 面（OPS 补形 A；v2/14 §1.8）：装配体在 assembly/ops/serve-face.ts；不自动触发。
  const opsFace = wireServeOps({ ledger, clock, guardRecord: outbound.gate.guardStoreRecord, log })
  // —— 公司面活持有者（docs/38-§2 L1 热重载替换点）：快照整组换，闭包零重建
  const companyState: { snapshot: CompanySnapshot } = { snapshot }

  // 类型流表（DEV-43）：workflows 声明 → T:<type> 键（无声明=undefined=不注入，D9）
  const typeFlows = flowsFromWorkflows(snapshot.workflows)
  if (typeFlows !== undefined) {
    log(`[serve] 类型流装载：${Object.keys(typeFlows).length} 类（${Object.keys(typeFlows).join('、')}）——T 键叠缺省表（docs/18-§2.1.1）`)
  }
  // 岗契约装载警告（127-A R3 配套，§4.1 诚实化——不阻断）：patrol 缺 T:patrol 流①＋patrol×output②
  logJobContractWarnings(snapshot.jobs, typeFlows, log)
  // daemon 网关身份（共享活对象——reload 时 mutate ctx 三字段，署名跟随新组织）
  const identity = daemonIdentity(config, snapshot)

  // —— .AIWS 员工工作区树（DEV-28，docs/43-§五+§十9）：建司即建+存量对账——根推导
  //    单一规则：显式 aiwsRoot > dirname(companyDir)/.AIWS > <rootDir>/.AIWS；per-company
  //    不并树（异 slug 拒启动）；增量同步=扩编建目录/缩编归档不删（aiws.ts）+热重载增量。
  const aiwsRoot = path.resolve(
    config.aiwsRoot ??
      (config.companyDir !== undefined
        ? path.join(path.dirname(path.resolve(config.companyDir)), AIWS_DIR)
        : path.join(path.resolve(config.rootDir), AIWS_DIR)),
  )
  const aiwsClock = (): Date => new Date(clock())
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, {
    slug: snapshot.slug,
    now: aiwsClock,
  })
  log(
    `[serve] .AIWS 员工工作区树：${aiwsRoot}（部门 ${snapshot.departments.length}、工位 ${aiwsTree.personDirs.length}` +
      `${aiwsTree.created > 0 ? `、新建 ${aiwsTree.created}` : ''}${aiwsTree.archived.length > 0 ? `、归档 ${aiwsTree.archived.length}` : ''}）——派发 cwd=<部门>/<工号>/tickets/<单号>/att<N>，家保留（docs/43-§五；per-company 不并树 §十9）`,
  )

  // —— executor 面装配（注册表/桥接 overlay/价目表与档位/judge 两址）——体=runtime-executor
  //    （20-§十五.三 先拆再增：本段零 engine 实例依赖，构造结果供下方 engine 注入与启动日志）
  const { registry, catalog, modelRoles, modelTierTickets, judgeHook, acceptance, realGate } = wireExecutorFace(config, {
    ledger,
    clock,
    log,
  })

  // data-change 路由登记位（129-A）：坏形态 CONFIG_INVALID 明报拒启动（解析件在 engine/intents/taxonomy.ts）
  const dataChangeRoutes = mergeDataChangeRoutes(snapshot.hooks, parseDataChangeRoutes(config.dataChangeRoutes)) // 129-C：org-config 规范位+daemon.yaml 逃生位逐键覆盖；合并空=undefined（路由闸 fail-closed 不变）

  const engineConfig: EngineConfig = {
    ...ENGINE_CONFIG_DEFAULTS,
    company: config.company,
    rootDir: path.resolve(config.rootDir),
    // .AIWS 员工家（DEV-28）：派发 workspace 落员工家（docs/43-§五）——收割四要件与
    // deliverables 收账经 dirname(briefPath) 全随迁；缺省不注入=引擎旧布局回退面
    aiwsRoot,
    defaultPersonId: (snapshot.people[0] as PersonRef | undefined)?.id ?? '',
    ...(dataChangeRoutes !== undefined ? { dataChangeRoutes } : {}), // 129-A 路由登记位（未配=闸面 fail-closed）
    ...mergeCostThresholdDefaults(snapshot.hooks, config.costThresholdTarget, config.costThresholdLane), // 129-D 缺省路由登记位（org 规范位+daemon 逃生位整体覆盖；全缺=引擎 fail-closed）
    deptFallback: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    defaultLane: snapshot.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
    limits: {
      maxActionsPerTick: config.maxActionsPerTick,
      maxInflight: config.maxInflight,
      // 人闸缺省帽（129-§6.2-R3）：缺省不注入=引擎兜底 1（串行）；批量执行岗走覆盖表
      ...(config.maxInflightPerPerson !== undefined ? { maxInflightPerPerson: config.maxInflightPerPerson } : {}),
    },
    ...queueServeOverrides(config), // 队列面三键（129-§6.2 单B：步长/人闸覆盖表/置顶集——解析件 todoqueue/queue.ts）
    // 模型档路由面（studio-dev-196）：modelTierByRole 注入即开面（models.yaml 未装载=
    // 不注入=面关，派发行为与本单之前一致）；显式单级覆盖表装配期转 map（解析即验在
    // 装载 case 面——serve/model-tier-tickets fail-closed）
    ...(modelRoles !== undefined ? { modelTierByRole: modelRoles } : {}),
    ...(modelTierTickets !== undefined ? { modelTierTickets } : {}),
    stallAfterMs: config.stallAfterMs,
    stallKillAfterAlarms: config.stallKillAfterAlarms,
    harvestSliceMs: config.harvestSliceMs,
    laneTtlMs: config.laneTtlMs,
    mergeLeaseTtlMs: config.mergeLeaseTtlMs,
    breakerThreshold: config.breakerThreshold,
    breakerCooldownMs: config.breakerCooldownMs,
    mirrorRescanEveryTicks: config.mirrorRescanEveryTicks,
    autoApprove: config.autoApprove,
    // 读面分级（17-§7）：Blind 档冻结验收命令来源——与装配器 acceptance **同一事实源**
    //（单一事实源，不双源漂移；真单模式=acceptance 配置）；遇 Blind 派发而缺失 →
    // createView fail-closed 明报
    readBlindAcceptance: acceptance,
    // 类型流注入（DEV-43，docs/18-§2.1.1 D13 合并序）：T 键叠在 DEFAULT_FLOW_TABLE 上；
    // 无 workflows 声明=不注入（引擎走内置缺省表，现状行为字节不变——D9）
    ...(typeFlows !== undefined ? { flows: { ...DEFAULT_FLOW_TABLE, ...typeFlows } } : {}),
    ...(config.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: config.budgetTicketCapUsd } : {}),
    ...(config.budgetPersonCapUsd !== undefined ? { budgetPersonCapUsd: config.budgetPersonCapUsd } : {}),
    // C2 声明态漂移哨输入（studio-dev-126）：taiga 且挂了字段映射文件才注入（同一份
    // 文件 loadTaigaFieldMap 单源重读——启动期一次，非每拍）；其余平台缺省=面关
    ...(config.platform === 'taiga' && config.taigaFieldsFile !== undefined
      ? { provisionDeclaredStates: provisionDeclaredStates(loadTaigaFieldMap(config.taigaFieldsFile), config.taigaEntity ?? 'userstory') }
      : {}),
    // 州表卫生白名单注入（127-C，studio-dev-127 §4.7）：快照携带（org-config
    // yt.known_foreign_states 经 SH-1 内容规则校验）——已知外来态哨兵降 FOREIGN_KNOWN
    // 观察级；恒传显式数组（缺声明=空数组=哨兵全灵敏度，不留 undefined 滞留面）
    knownForeignStates: snapshot.knownForeignStates ?? [],
    ...(config.companyDir !== undefined ? { companyDir: path.resolve(config.companyDir) } : {}), // 岗产物落位收账锚（DEV-50）
  }
  // 装配器工厂（L1 热重载换装配器=换快照重建——静态部分不随公司目录变）
  const makeAssembler = (): PromptAssembler =>
    createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 Studio Next demo worker：按任务书目标产出，落 REPORT 与 summary，验收口径即闸门。',
      snapshot: companyState.snapshot,
      acceptance,
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）'],
      redactKnown: outbound.gate.promptRedactor, // 三不入·提示词（IMPL-07-11；IMPL-06-12 注入点）
    })

  // worker 级 wkey（17-§7）：按单签发→TaskBrief.credentials env 注入→关单吊销（src/engine/worker-key.ts）
  const workerKeys = wireWorkerKeys(config, identity, clock, log)
  // raw platform（未包网关代理的原件）：engine 拿 gated 代理（下）；daemon 自身动作
  //（hr-sync 对账单开单）拿原件——网关收口的是 worker 写路径，非 daemon 自身动作
  const rawPlatform = wirePlatform(config)

  // —— 人事同步器装配（DEV-48，docs/52-§九；hrSync: true 时）：三面执行体 + 消化器 ——
  //    注入位=EngineDeps.hrSync（相位 7 尾 drain）；关=零装配零注入行为零变；装配体收口
  //    assembly/hrsync/assemble.ts（台账镜像+断电复位+两平台面接线——52-§六/§七/§九）。
  const hrDigester = assembleHrSync({
    config,
    ...(opts?.hrMatrixFace !== undefined ? { hrMatrixFace: opts.hrMatrixFace } : {}),
    ...(opts?.hrKnownSecrets !== undefined ? { hrKnownSecrets: opts.hrKnownSecrets } : {}),
    ledger,
    snapshot,
    clock,
    log,
    engineDeptFallback: engineConfig.deptFallback,
    platformIssues: rawPlatform.issues,
    makeId: makeUlid,
  })
  // —— 频道供给面装配（130-P3，130 提案 §6.7.3；装配体拆至 assembly/channels/）：
  //    matrixChannels 关=零装配零注入，既有行为字节不变（同 hrSync 纪律）。
  let roomFace: MatrixRoomFace | undefined
  if (config.matrixChannels) roomFace = wireRoomFace(opts?.matrixRoomFace, () => companyState.snapshot)
  // —— notify 广播中继装配（105-刀B，studio-dev-219；面注入=开，缺省=零装配零行为）：
  //    装配体拆至 assembly/notify/（三件套：拍边界事件中继+cost 警戒 IM 出口+惊动计量
  //    PATROL；matrix 挂=IM 副本缺失，面板仍第一落点）。
  const wiredNotify =
    opts?.notifyBroadcast !== undefined
      ? wireNotifyAssembly({
          face: outbound.wrapNotifyFace(opts.notifyBroadcast),
          company: config.company,
          heartbeatIssue: engineConfig.heartbeatIssue,
          actor: engineConfig.actor,
          deptFallback: engineConfig.deptFallback,
          ledger,
          clock,
          people: companyState.snapshot.people,
          log,
        })
      : undefined
  if (wiredNotify !== undefined) {
    log('[serve] notify 广播面已装配：事件中继（拍边界）+cost 警戒即时出口+惊动计量（105-刀B，studio-dev-219）——matrix 挂=IM 副本缺失，面板仍第一落点')
  }
  // cost 警戒出口（181 EngineDeps.notify 注入件）：面注入=IM 即时广播叠加（129 批示项④）
  const costNotifyOutlet = wiredNotify?.costNoticeOutlet ?? createCostNotifyOutlet(log)
  // 平台写出站闸（exits.ts platform-write）：gated 代理外再包出站扫描（写文本过闸后才出站）
  const enginePlatform = outbound.wrapPlatform(wireGatedPlatform(rawPlatform, config, identity, clock, log))
  const engine = createEngine({
    // 写路径网关收口（17-§7）：raw platform 包一层 gated 代理——engine 写调用签名不变（透明）
    platform: enginePlatform,
    ...(workerKeys !== undefined ? { workerKeys } : {}),
    ...(hrDigester !== undefined ? { hrSync: hrDigester } : {}),
    ...(roomFace !== undefined ? { rooms: roomFace } : {}),
    ledger, // 已在装配序开头过三不入·库闸（appendEvent 写前扫描）
    registry,
    ...(judgeHook !== undefined ? { judge: judgeHook } : {}), // 160-B 两址精序（缺省不注入=规则缺省档）
    assembler: makeAssembler(),
    // 闸门双形态（v0.5 真单刀）：真单=逐条真执行冻结验收命令；demo=exit0 模拟占位
    gateRunner: realGate
      ? createAcceptanceGateRunner(acceptance)
      : createDefaultGateRunner(),
    ...(realGate ? { mergeRun: createDefaultMergeRunDeps({ gateCommand: acceptance }) } : {}), // 202-P2 相位 5 合并跑（面关=v0 模拟轨）
    clock,
    config: engineConfig,
    people: snapshot.people, departments: snapshot.departments, // 130-P2（studio-dev-173）：部门索引随快照注入——父单立案 leader 解析
    ...(snapshot.costGuard !== undefined ? { costGuard: snapshot.costGuard } : {}), // cost_guard 段（132-§6.4 单C）：段不声明=面关
    // 成本警戒 notify 出口（129-D 181）：v0 接 log 行；刀B 面注入=IM 即时广播叠加
    notify: costNotifyOutlet,
    ...(catalog !== undefined ? { catalog } : {}),
    // 批示归一层（studio-dev-171，docs/18-§2.5）：恒注入（装配缝=engine/directive/
    // serve-config.ts——leader 表随快照，热重载整组换）
    directives: buildServeDirectiveDeps(
      { producer: config.directiveProducer, whitelist: config.directiveWhitelist },
      snapshot.departments,
    ),
    // 收割完成钩（129-E 单E，F1-11 接力产面）：engine 相位 4 收口回调→relay 源 publish。
    // 源注册在 engine 之后（22-§一 装配序）——闭包后绑定（下方 relayPublish 绑定位）；
    // relay 源未开=闭包转发空跳零行为（缺省不注入语义等效）
    onWorkComplete: (signal: RelayWorkSignal): void => {
      relayPublish?.(signal)
    },
  })

  // —— 唤起源注册表（22-§一）：三源按配置接入，emit 统一进 engine.ingest（runServe 接线） ——
  const sources = createSourceRegistry({ log })
  const ingestSink = (intent: Parameters<Engine['ingest']>[0][number]): void => {
    engine.ingest([intent])
  }
  // people-change 源（129-C P0-A，studio-dev-178）：hrSync+hrPeopleWatch 开=挂 hr-sync 分类器出口双写 data-change 意图（源本体 engine/hrsync/people-change-source.ts）
  const peopleChangePublish = config.hrPeopleWatch ? wirePeopleChangeSource(sources, { company: config.company, sink: ingestSink, log }) : undefined
  // —— relay/resume 源（129-E 单E，studio-dev-184；§6.4-C6 注册三件套：源件+开关+manifest）——
  // relay：收割完成钩转发面（onWorkComplete 闭包→publish；誓作用域防抖——relay-resume-sources.ts 头注）
  // resume：续命意图推送面（v0 产面=测试/后续 CLI resume 命令，50a-B4 归档；publish 面经
  // runtime 返回口露出——命令面另批接）。
  const relayPublish = config.relay ? wireRelaySource(sources, { company: config.company, sink: ingestSink, log }) : undefined
  const resumePublish = config.resume ? wireResumeSource(sources, { company: config.company, sink: ingestSink, log }) : undefined

  let scheduler: Scheduler | null = null
  if (config.jobs) {
    const seeded = seedJobs(ledger, snapshot.jobs, clock())
    log(`[serve] 定时岗播种：新 ${seeded.seeded} / 保留 ${seeded.kept}（快照共 ${snapshot.jobs.length} 岗）`)
    // scheduler 源：包装现有调度器（零改 scheduler.ts）——手动泵（poll）经 sink 直达 ingest
    // （serve 测试面），start 后由注册表 emit 接管同一队列（src/engine/sources.ts 头注）
    const schedulerSource = createSchedulerSource({
      ledger,
      clock,
      intervalMs: config.jobPollMs,
      ...(opts?.quarantineMs !== undefined ? { quarantineMs: opts.quarantineMs } : {}),
      sink: ingestSink,
      log,
    })
    scheduler = schedulerSource.scheduler
    sources.register(schedulerSource, SCHEDULER_SOURCE_MANIFEST)
  }

  if (config.matrix) {
    if (opts?.matrixSource === undefined) {
      throw new Error(
        'CONFIG_INVALID：matrix: true 需注入 matrix 源工厂（runServe/buildServeRuntime opts.matrixSource）——' +
          'daemon 不强依赖 @studio-next/matrix（25-§一.2）；装配单元 apps/boot 组合根注入 ' +
          'createMentionSource 产物（105-刀A A-3：boot 读 daemon.yaml matrixHomeserverUrl/' +
          'matrixUserId/matrixRooms/matrixRoles/matrixPollMs/matrixSyncTimeoutMs + env ' +
          'MATRIX_BOT_PASSWORD → login → createMentionSource → runServe opts）',
      )
    }
    sources.register(opts.matrixSource(), MATRIX_MANIFEST)
  }

  if (config.fileWatch) {
    if (config.fileWatchPath === undefined || config.fileWatchPath === '') {
      throw new Error('CONFIG_INVALID：fileWatch: true 需配 fileWatchPath（监听文件路径，文件须先存在——22-§三.1）')
    }
    sources.register(
      createFileWatchSource({ company: config.company, file: path.resolve(config.fileWatchPath), log }),
      FILE_WATCH_MANIFEST,
    )
  }

  // —— 岗位域源群注册（cadence/SLA/新鲜度/成本警戒）——体拆至 sources-jobs.ts
  //（20-§十五.三 先拆再增；cost-threshold=132-§6.4 单C：guard/people getter 闭包
  // 快照——热更经 applyCompanyUpdate 整组换，摘段=undefined=面关零行为）
  registerJobSources({
    sources,
    flags: { cadence: config.cadence, sla: config.sla, freshness: config.freshness, costGuard: config.costGuard, company: config.company, jobPollMs: config.jobPollMs },
    ledger,
    clock,
    heartbeatIssue: engineConfig.heartbeatIssue,
    deptFallback: engineConfig.deptFallback,
    jobs: (): readonly ScheduledJob[] => companyState.snapshot.jobs,
    people: (): readonly PersonRef[] => companyState.snapshot.people,
    guard: (): CostGuardConfig | undefined => companyState.snapshot.costGuard,
    declared: catalog !== undefined ? catalog.tiers() : undefined,
    log,
  })

  log(`[serve] 唤起源注册表：${sources.list().map((e) => e.source.name).join('、') || '（空）'}——emit 统一进 engine.ingest（22-§一 源零直驱）`)

  // —— 公司频道地图启动供给（130-P3 §6.7.3-③；DEV-20 §5.4 ensure 幂等）：fire-and-forget
  //    不阻主循环（执行体拆至 assembly/channels/；报告/problems/failures 逐条落日志）
  if (roomFace !== undefined) startChannelSupply(roomFace, log)

  // —— L1 配置热重载执行体（docs/38-§2 L1 / §4 R-A；companyDir 给定时装配）——
  //    apply 段（校验绿后调用，幂等可重入）：岗播种/移除→快照替换→engine.applyCompanyUpdate
  //    →署名上下文 mutate；在途单/泳道/指令文件不动（拍边界结构性保证——hot-reload.ts 头注）。
  let hotReload: HotReload | undefined
  if (config.companyDir !== undefined) {
    hotReload = createHotReload({
      companyDir: path.resolve(config.companyDir),
      rootDir: path.resolve(config.rootDir),
      ledger,
      company: config.company,
      clock,
      makeId: makeUlid,
      log,
      deptFallback: engineConfig.deptFallback,
      watch: config.reloadWatch,
      apply(next: CompanySnapshot): HotReloadApplyReport {
        let seeded = 0
        let kept = 0
        let removed = 0
        // .AIWS 增量同步先行（DEV-28，docs/43-§五「人事变树变」）：新员工得文件夹、
        // 离司/下线归档不删——**先于**一切持有者替换（本步抛错=apply 整体失败 → 旧配置
        // 保持的既有 RELOAD_APPLY_FAILED 面，fail-closed；树与配置不半换）
        const synced = ensureAiwsTree(aiwsRoot, next.departments, next.people, { slug: next.slug, now: aiwsClock })
        if (synced.created > 0 || synced.archived.length > 0) {
          log(
            `[serve] .AIWS 增量同步（reload）：新建 ${synced.created}、归档 ${synced.archived.length}${synced.archived.length > 0 ? `（${synced.archived.join('、')}——内容保留不删）` : ''}`,
          )
        }
        // —— 人事同步入队（DEV-48，docs/52-§5.2 步2-3/§9.1）：diff 分类→三面任务入队
        //    （哨兵票；diff 基=台账镜像现值零平台 IO；hrSync 关=零动作）——体=hrApplySegment；
        //    抛错=apply 整体失败保持旧态（fail-closed）。
        const hr = hrApplySegment({ enabled: config.hrSync, ledger, prev: companyState.snapshot, next, company: config.company, clock, makeId: makeUlid, log, ...(peopleChangePublish !== undefined ? { publish: peopleChangePublish } : {}) })
        if (config.jobs) {
          // 台账段先行（幂等可重入——seedJobs 逐岗独立 upsert；失败重试下一形态自愈）
          const s = seedJobs(ledger, next.jobs, clock())
          seeded = s.seeded
          kept = s.kept
          removed = removeMissingJobs(ledger, next)
        }
        // 台账镜像（DEV-48，docs/52-§5.2 步4）：people/departments 直覆（status 列归
        // 任务执行写面 setPersonStatus，镜像不动——ledger.ts 头注口径）；幂等可重入。
        // store v2 面本单前从未接 daemon——hrSync 开=启动+reload 双点接线
        if (config.hrSync) {
          ledger.syncCompany(next)
        }
        // 纯赋值段（不抛）：快照持有者 → 引擎整组换 → 署名上下文
        companyState.snapshot = next
        // 频道地图重供给（130-P3 §6.7.3-③）：apply 段同步推进、供给异步收敛（执行体
        // 拆至 assembly/channels/——ensure 幂等只补差集；不入 apply 事务面）
        if (roomFace !== undefined) reEnsureChannels(roomFace, log)
        // 类型流热换（N1，DEV-43）：拍边界换表——在途单下拍 decide 对新表重解析
        //（resolveTicketFlow 同函数；跨边界遇未知态=既有 L1 热重载纪律 NOOP_UNKNOWN_STATE，
        //  状态权威在平台侧、不猜不动）；无 workflows=flows:undefined=回内置缺省表
        const nextTypeFlows = flowsFromWorkflows(next.workflows)
        // 岗契约装载警告（127-A）：热重载 apply 同面——拍边界随新快照重算，不阻断
        logJobContractWarnings(next.jobs, nextTypeFlows, log, '（reload）')
        engine.applyCompanyUpdate({
          people: next.people,
          assembler: makeAssembler(),
          defaultPersonId: (next.people[0] as PersonRef | undefined)?.id ?? '',
          deptFallback: next.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
          defaultLane: next.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
          ...(nextTypeFlows !== undefined ? { flows: { ...DEFAULT_FLOW_TABLE, ...nextTypeFlows } } : {}),
          // 州表卫生白名单热换（127-C）：恒显式（摘声明=空数组=哨兵回全灵敏度——
          // 白名单滞留会静默吞告警，安全面须热换即时生效）
          knownForeignStates: next.knownForeignStates ?? [],
          // 批示归一层 leader 表热换（studio-dev-171）：组织变动 fail-closed（换 leader/
          // 撤部即生效——防离任 leader 批示面残留）
          directives: new Map(next.departments.map((d) => [d.path, d.leader])),
          // cost_guard 段热换（132-§6.4 单C）：恒传（摘段=undefined=闸四联动+源评估面关）
          costGuard: next.costGuard,
        })
        identity.ctx.company = next.name
        identity.ctx.dept = next.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback
        identity.ctx.level = Math.max(1, next.level)
        return { jobsSeeded: seeded, jobsKept: kept, jobsRemoved: removed, hr }
      },
    })
    log(
      `[serve] L1 热重载已接：公司目录指纹监听${config.reloadWatch ? '开（每拍 stat+mtime，稳定后拍边界重装载）' : '关（reloadWatch: false——只剩手动通道）'}；手动通道 studio-next reload（<rootDir>/control/，docs/38-§2）`,
    )
  }

  // —— 进化管线判负闸·启动自检（v0 观察模式，src/evolve/evolve-guard.ts；20-§九 无 candidate id
  //    的生产改动判负）：对框架资产清单逐项 authorize，unauthorized 落 ESCALATE 如实报告、
  //    不阻断启动（阻断模式+资产面扩展归真单刀——头注冻结边界） ——
  const evolveSelfCheck = runEvolveStartupSelfCheck({
    ledger,
    clock,
    makeId: makeUlid,
    company: config.company,
    actor: ENGINE_CONFIG_DEFAULTS.actor,
    dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    log,
    ...(opts?.evolveSelfCheck ?? {}),
  })

  // —— 对外 API 同进程装配（MIG-06 欠账收口；v2/14 §四；装配体=assembly/api/serve-face.ts）——
  //    app 在装配期构造（同步），监听由 runServe await api.start()（apiPort 缺省 0=ephemeral）
  const api = wireServeApi({ company: { companyId: config.company, slug: config.company }, readSnapshot: () => companyState.snapshot, port: config.apiPort ?? 0, clock, log, guardResponse: outbound.guardApiResponse })

  return {
    engine,
    scheduler,
    sources,
    api,
    ...opsFace,
    evolveSelfCheck,
    ...(hotReload !== undefined ? { hotReload } : {}),
    // 129-E（184）：续命意图推送面露头（resume: true 时；调用面归 B4 CLI resume——另批）
    ...(resumePublish !== undefined ? { resumePublish } : {}),
    // 105-刀B（219）：拍边界事件中继露头（notifyBroadcast 注入时；runServe 主循环接线）
    ...(wiredNotify !== undefined ? { notifyRelay: wiredNotify.relayEvents } : {}),
    async stop(): Promise<void> {
      // 先关 API 入口（不再接新请求）→ 停源（不再进新意图）→ 引擎 drain → 关台账（22-§三.3）
      await api.close()
      sources.stopAll()
      await engine.dispose()
      ledger.close()
    },
  }
}
