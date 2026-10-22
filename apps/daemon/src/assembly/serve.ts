/**
 * serve —— `studio-next serve --config <daemon.yaml>` 常驻主循环（v0.5 合龙件）
 *
 * 依据：docs/17-§2 主循环七相位（engine.ts）；docs/16-§四 v0.5「主循环 + demo 端到端」。
 *
 * v0 配置最小面（daemon.yaml，全扁平 key: value）：
 *   db: <台账库路径>            platform: localfile|fake      company: <slug>
 *   rootDir: <工位根>           tickMs: <拍间隔>              maxActionsPerTick / maxInflight
 *   stallAfterMs / laneTtlMs / breakerThreshold / autoApprove …（缺省见 DEFAULT_SERVE_CONFIG）
 *   mirrorRescanEveryTicks: <镜像对账重决策节流>（DEV-42①，缺省 30；0=关——每 N 拍补非闭环 mirror 单进决策候选）
 *   jobs: true|false（定时岗调度开关，v0.4）   jobPollMs: <调度轮询间隔>（缺省 15000）
 *   models: <models.yaml 路径>（可选价目表，17-§4：注入=估算态 A「estimateCost 校准+双帽」；
 *     缺省=态 B 降级（budget-gate.ts 头注两态）。**缺省不拷贝 models.example.yaml**）
 *   budgetTicketCapUsd / budgetPersonCapUsd（可选预算帽：票级恒生效；岗级仅态 A 生效）
 *   gateway: true|false（网关写收口开关，缺省开——17-§7；生产不得关）
 *   gatewaySecret: <网关 HMAC 密钥>（>=32B；缺省开发值——**生产必配**，见 DEV_GATEWAY_SECRET 警告）
 *   matrix: true|false（@唤醒源开关，105-刀A A-3；true 时必配 matrixHomeserverUrl/
 *     matrixUserId，可选 matrixRooms/matrixRoles/matrixPollMs/matrixSyncTimeoutMs——
 *     bot 密码**永不入 yaml**，经 env MATRIX_BOT_PASSWORD 供给，装配单元 apps/boot 读取）
 *   platformDir: <LocalFile 平台根>（可选；platform: localfile 时缺省 <rootDir>/platform）
 *   agentYaml: <agent.yaml 路径>（可选；给定时按 docs/17-§4 装载真 executor 注册表——
 *     loadAgentConfig+wireRegistry+builtinResolver；缺省 fake adapter（demo））
 *   acceptance: <冻结验收命令>（可选；给定时=真单模式——任务书 L4/Blind 读面/真验收闸门
 *     三消费面的**单一事实源**；缺省 demo 占位（exit0 模拟）。多条命令一行内 && / ; 连接
 *     ——扁平 YAML 子集不收列表，多行拆分归真 YAML 装载后续刀）
 *
 * v0 边界（诚实标注——v0.5 真单刀后仍差什么）：
 *   - platform: localfile **已接线**（platformDir 可配）；taiga **已接线**（docs/30+32——键
 *     taigaUrl/Project/Entity/Auth/FieldsFile；凭据只经进程 env TAIGA_USERNAME+PASSWORD 或
 *     TAIGA_TOKEN(+REFRESH)，值永不入配置/日志/台账（红名单）；启动探针 fail-fast）；
 *     YouTrack 接线归 platform 泳道后续单。
 *   - 配置解析为零依赖手写扁平 YAML 子集（注释/#、key: value、引号剥壳、数字/布尔推断）——
 *     真 YAML（yaml@2 带行号 AST）装载归 daemon 依赖登记后的后续刀（16-§二 选型纪律）。
 *   - executor 注册双形态（v0.5 真单刀）：agentYaml 给定时=真 executor（agent.yaml →
 *     loadAgentConfig → wireRegistry（能力漂移/未知名 CONFIG_INVALID 明报）→ builtinResolver）；
 *     缺省=fake adapter（demo，行为不变）。dsh 真跑的外部依赖（CLI 在 PATH、凭据 env、
 *     profile patch）不在 daemon 面——凭据经进程 env 透传（TaskBrief.credentials 通道 +
 *     launch `...process.env`），凭据值永不入配置/日志/台账（红名单）。
 *     AGENTS.md 通道接线（v1.5#1）：dsh agents_md='user_level'——dispatch 落指令临时文件
 *     （workspace 外）+ env STUDIO_NEXT_INSTRUCTIONS；bridge overlay 启动期生成（下方段），挂载归 cmd。
 *   - 网关（17-§7 写入全收口）：平台写路径已过闸（gated-platform.ts——control key/署名注入/
 *     fail-closed；`gatewaySecret:` 缺省开发值生产必换）。worker 级按单 wkey 已接（worker-key.ts：
 *     签发+credentials env 注入+GATE_FAIL/断路/CLOSE 吊销）；仍欠：studio-tools stdio 入口与
 *     吊销集跨进程可见性（authority 落 store，挂账）；审批流（事件名待批示）同前。
 *   - 定时岗（v0.4，jobs: true）：scheduler+engine.ingest 全链已通（demo 岗=health-patrol）；
 *     **公司目录 jobs 段不进 snapshot**——company 校验器只收形状、toSnapshot 恒置 jobs:[]
 *     （v0.1-M3 边界，validator.ts 头注），公司目录岗进台账归后续单；现行岗入口=快照/upsertJob 热更。
 *   - 唤起源注册表（v0.8 地基，22-§一）：scheduler 源（jobs: true）+ matrix 源（matrix: true+注入
 *     工厂）+ watch-file 源（fileWatch/fileWatchPath，22-§三.1 靶子）+ cadence 展开器（35-§3）
 *     + SLA/升级计时器（sla: true）+ people-change 源（129-C：hrSync+hrPeopleWatch 双写 data-change 意图，路由=org-config hooks.data_change.routes）。
 *     startAll 的 emit 统一进 engine.ingest——源零直驱（见 src/engine/sources.ts）。意图消费门
 *     在引擎（kind→handler 分发表，105-刀A A-2）：schedule｜mention 已开闸（mention=③混合：
 *     @工号 物化唤醒单派岗位，@宰相/@制作人 roles 映射同径派发）；webhook｜data-change 已开闸
 *     （129-A：webhook 只落单不派工、data-change 联动单+路由指派，见 engine/intents/taxonomy.ts）；
 *     escalate 归刀B、ticket/relay/resume 等明报不支持——注册面先行，消费面按刀推进。
 *   - SIGINT/SIGTERM 优雅停：等当前拍收口 → stopAll 唤起源 → 在途 drain（v0=内存 handle
 *     优雅杀，work_records 留 running——重启由 takeOverRunningWorkRecords 接管收口，38-§2 R-B）
 *     → 关台账。队列中未消费意图停机即弃（at-most-once，与 markRan 已提交未消费边界同语义）。
 *   - L1 配置热重载（38-§2 L1/§4 R-A，src/control/hot-reload.ts）：companyDir 给定时每拍拍
 *     边界检查公司目录资产指纹（stat+mtime，reloadWatch 缺省开）与控制面 reload 请求；变更且
 *     稳定/手动 → 重走装载面（校验→快照→岗播种→装配器/署名上下文替换）→ RELOAD 落 SCHEMA_EVOLVE
 *     继续跑——零重启不断单。坏配置拒载保旧态+ESCALATE。daemon.yaml 与框架代码不在 L1 面（L2 归 R-C）。
 *   - 进化管线判负闸（v0 观察模式，src/evolve/evolve-guard.ts）：启动对框架资产清单跑
 *     authorize（assertChangeAuthorized ∘ 台账候选全集），unauthorized 如实报告（日志+ESCALATE）
 *     **不阻断启动**；空库首启跳过。真单刀接阻断模式+资产面扩展（头注冻结边界）。
 */
import { createRegistry, isJudgeExecutorName, loadAgentConfig, wireRegistry, builtinResolver } from '@studio-next/adapters'
import { AIWS_DIR, ensureAiwsTree } from '@studio-next/company'
import { assertJudgeRoleLow, createModelCatalog, fingerprint, parseModelsYaml, DEFAULT_FLOW_TABLE } from '@studio-next/core'
import { dshJudgeAdapterFactory } from '../engine/judge/invoke.ts'
import { configInvalid } from '@studio-next/contract'
import { createGateway, CONTROL_TICKET } from '@studio-next/gateway'
import type { SignatureContext } from '@studio-next/gateway'
import { openLedger, type Ledger } from '@studio-next/store'
import type {
  CompanySnapshot,
  CostGuardConfig,
  InvokeSource,
  ModelCatalog,
  PersonRef,
  ScheduledJob,
  SourceManifest,
} from '@studio-next/contract'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  parseDataChangeRoutes,
  type Engine,
  type EngineConfig,
} from '../engine/engine.ts'
import { runEvolveStartupSelfCheck, type EvolveSelfCheckReport, type FrozenAsset } from '../evolve/evolve-guard.ts'
import { mergeDataChangeRoutes } from '../engine/intents/taxonomy.ts' // 129-C：org-config hooks.data_change.routes（规范位）+ daemon.yaml dataChangeRoutes（逃生位）合并
import { createCostNotifyOutlet, mergeCostThresholdDefaults } from '../engine/intents/escalate.ts' // 129-D：cost-threshold 缺省路由合并+notify 出口（刀B 登记位）
import { wirePeopleChangeSource } from '../engine/hrsync/people-change-source.ts' // 129-C：people-change 源注册件（hrPeopleWatch 开时挂 hr-sync 分类器出口）
import { createFakeAdapter } from '../engine/fakes.ts'
import { buildServeDirectiveDeps, parseWhitelistSpec } from '../engine/directive/index.ts'
import { createDefaultGateRunner, createAcceptanceGateRunner } from '../engine/gate.ts'
import { answerReloadNoCompanyDir, createHotReload, type HotReload, type HotReloadApplyReport } from '../control/hot-reload.ts'
import { makeUlid } from '../engine/tools/id.ts'
import { provisionDshBridgeOverlay } from '../engine/instructions-store.ts'
import { logJobContractWarnings } from '../engine/jobs/freshness.ts'
import { registerJobSources } from './sources/jobs.ts'
import { createDefaultAssembler } from '../engine/prompt-assembly.ts'
import type { PromptAssembler } from '../engine/prompt-assembly.ts'
import { nextRunAt, type Scheduler } from '../engine/scheduler.ts'
import { flowsFromWorkflows } from '../engine/typeflows.ts'
import { consumeStopRequest, readStopRequest, STOP_LAST_SEEN_KV_KEY, writeStopResult } from '../control/stop-channel.ts'
import type { WorkerKeyDeps } from '../engine/worker-key.ts'
import type { MatrixHrFace } from '../engine/hrsync/hrsync.ts'
// 频道供给面（130-P3，130 提案 §6.7）：结构同形接口——daemon 不 import matrix 包
import type { MatrixRoomFace, MatrixRoomFaceContext } from '../engine/rooms/room-duty.ts'
// 人事同步器装配（DEV-48，docs/52-§九）——hr 配置面/装配体/平台接线件（BC-S2 先拆再增）
import { assembleHrSync, hrApplySegment } from './hrsync/assemble.ts'
import { coerceHrServeKey, HR_SERVE_DEFAULTS, validateHrServeCross, type HrServeConfig } from './hrsync/config.ts'
import { loadTaigaFieldMap, provisionDeclaredStates, resolveTaigaAuth, wireGatedPlatform, wirePlatform } from './platform/wire.ts'
export { resolveTaigaAuth, loadTaigaFieldMap, wirePlatform }
// 频道供给面类型再出（130-P3）：boot 组合根从 '@studio-next/daemon/serve' 消费工厂签名
export type { MatrixRoomFace, MatrixRoomFaceContext } from '../engine/rooms/room-duty.ts'
import {
  createFileWatchSource,
  createSchedulerSource,
  createSourceRegistry,
  FILE_WATCH_MANIFEST,
  SCHEDULER_SOURCE_MANIFEST,
  type SourceRegistry,
} from '../engine/sources.ts'

// ————————————————————————— 配置 —————————————————————————

/**
 * serve 配置（v0 最小面；引擎子配置并入扁平键）。hr* 人事同步器键子面在
 * assembly/hrsync/config.ts 的 HrServeConfig（DEV-48，docs/52-§九——此处 extends 收平）。
 */
export interface ServeConfig extends HrServeConfig {
  /** 台账库路径（不存在则建库+migrate——store openLedger 语义） */
  db: string
  /** 协作平台：fake（demo）| localfile（docs/23 LocalFile 平台）| taiga（docs/30 推荐 + docs/32 真机试点；接入点见 wirePlatform） */
  platform: 'localfile' | 'taiga' | 'fake'
  /** 公司 slug（events/intents/mirror 的 company 维） */
  company: string
  /**
   * daemon 工位根（tmp/instructions、platform、控制面等 daemon 自管面落此）。
   * 派发 workspace 归 .AIWS 员工家（DEV-28，docs/43-§五）——根推导见 aiwsRoot。
   */
  rootDir: string
  /**
   * .AIWS 员工工作区树根（DEV-28，docs/43-§五+§十9）：缺省推导=显式本键 >
   * dirname(companyDir)/.AIWS（公司根，生产形态——与公司 git 目录/var 平级）>
   * `<rootDir>/.AIWS`（demo 无公司目录）。per-company 不并树：根归属标记异 slug 拒启动。
   */
  aiwsRoot?: string
  /** 拍间隔 ms */
  tickMs: number
  /** 并发三闸 */
  maxActionsPerTick: number
  maxInflight: number
  /** 在工静默告警阈值 ms */
  stallAfterMs: number
  /**
   * STALL 响置咬合阈（DEV-44，2026-10-20 三例实证：看门狗只叫不咬）：同 attempt 内告警
   * 达 N 次 → 整树杀在途 worker（stop 通道同款 kill 链）+ 工位收口 + 回首批位重派
   * attempt+1（rescan 兜底）；无在途句柄=GATE_FAIL（WORKER_DEAD）收口。0=关；缺省 2。
   */
  stallKillAfterAlarms: number
  /** 收割相位每工位每拍泵流时间片 ms（DEV-9 P1 冻结修复，docs/17-§2 拍有界；须 ≪ tickMs） */
  harvestSliceMs: number
  /** 泳道租约 TTL ms */
  laneTtlMs: number
  /** 断路阈值 N */
  breakerThreshold: number
  /** 断路半开冷却窗 ms（DEV-46：熔断后停重派至窗过→放行一次半开试探；0=即试探） */
  breakerCooldownMs: number
  /**
   * 镜像对账重决策节流（DEV-42①，2026-10-20 哨查）：每 N 拍把非闭环（未 CLOSE）
   * mirror 单补进决策候选——活动驱动候选只看「有新活动」的单，被三闸顺延且活动已被
   * 游标消费的单会永久搁置（实测 9 单零事件滞留数小时）。0=关；缺省 30。
   */
  mirrorRescanEveryTicks: number
  /** demo 自动批（真制作人批准信号经网关动作词归一） */
  autoApprove: boolean
  /** 批示归一层·制作人账号（studio-dev-171，docs/18-§2.5）：批示豁免位（§2.3 任意
   * 介入不受限——含派单律）；缺省=未知 actor 面 fail-closed 拒 */
  directiveProducer?: string
  /** 批示归一层·组织锚白名单（分号分隔工号/账号）：部长外的固定白名单位；缺省=仅部长面 */
  directiveWhitelist?: string
  /** 定时岗调度开关（v0.4，16-§四）：true=scheduler + engine 同栈起（demo 样例岗见 DEMO_SNAPSHOT）。
   *  v0.8 地基起 jobs 兼作 scheduler 源开关（22-§一/§二：注册表注册并随 startAll 起） */
  jobs: boolean
  /** 调度轮询间隔 ms（22-§二「节奏可配」；缺省 15 秒） */
  jobPollMs: number
  /**
   * matrix @唤醒源开关（22-§二；缺省关）：true 时经**注入工厂**装配（buildServeRuntime
   * opts.matrixSource）——daemon 不强依赖 @studio-next/matrix（装配单元注入
   * createMentionSource 产物；start/stop 签名对齐 InvokeSource 端口即可接入）。
   * 开而未注入工厂=CONFIG_INVALID 拒启动（不静默空转）。
   */
  matrix: boolean
  /**
   * matrix homeserver 基址（105-刀A A-3；matrix: true 时必配）：如 http://127.0.0.1:8008。
   * daemon.yaml 只配非敏感面——bot 密码**永不入 yaml**，经进程 env MATRIX_BOT_PASSWORD
   * 供给（21A D5 批示：密码红名单，装配单元 apps/boot 读取）。
   */
  matrixHomeserverUrl?: string
  /** matrix bot 账号 user_id（@slug-bot:server；matrix: true 时必配） */
  matrixUserId?: string
  /** 监听房间白名单（分号分隔 room_id；缺省=bot 可见全部已加入房间）——扁平 YAML 不收列表 */
  matrixRooms?: string
  /** 角色词映射（分号分隔 角色词=工号，如 宰相=PRIME-0;制作人=PRODUCER-0；③混合语义源侧面） */
  matrixRoles?: string
  /** data-change 路由表登记位（129-A；分号对 变更类型=工号，如 入=HR-1;升=PLN-1；org-config 接线归拆单 C） */
  dataChangeRoutes?: string
  costThresholdTarget?: string // 129-D 缺省指派逃生位（org-config hooks.cost_threshold.target 规范位）
  costThresholdLane?: string // 129-D 泳道逃生位（org-config hooks.cost_threshold.lane 规范位）
  /** 轮询间隔 ms（缺省 3000——源节奏；@studio-next/matrix adapter 同名缺省） */
  matrixPollMs?: number
  /** 增量 sync 长轮询超时 ms（缺省 25000——空闲期挂连接，A-4；基线拉取恒 0） */
  matrixSyncTimeoutMs?: number
  /**
   * 公司频道供给开关（130-P3，130 提案 §6.7.3-③；缺省关）：true=注入工厂装配（opts.
   * matrixRoomFace）——启动+热重载 ensure 八类地图＋派发/CLOSE 生命周期钩（EngineDeps.
   * rooms）。开而未注入=CONFIG_INVALID；供给失败不阻主循环（执行体 assembly/channels/）。
   */
  matrixChannels: boolean
  /** 部门 path → ASCII slug 映射 JSON 路径（DEV-20 D6；matrixChannels: true 时必配） */
  matrixDeptMap?: string
  /** 制作人 MXID（缺省 @opengames:localhost——神号全知，130 §6.7.2；21A-§2.2） */
  matrixProducerMxid?: string
  /**
   * watch-file 示例源开关（22-§三.1 验收靶子；缺省关）：true 时监听 fileWatchPath 指定
   * 文件的变化，JSON 行各产一条 webhook 意图（dedupKey=mtime#行号，见 src/engine/sources.ts）。
   */
  fileWatch: boolean
  /** watch-file 监听文件路径（fileWatch: true 时必配；文件须先存在——CONFIG_INVALID 明报） */
  fileWatchPath?: string
  /**
   * cadence 档位展开器源开关（35-§3 首刀；缺省关）：true 时注册档位岗调度表生命周期源
   * （src/engine/jobs-sources.ts——start 播种/周期刷新/stop 移除 payload 带 cadence_tier 的岗；
   * 到点意图仍走既有 scheduler→schedule 意图链，零新轮子）。jobs: false 时开了也无
   * scheduler 消费（意图无人到点产出——配置面诚实共存，不代开 jobs）。
   */
  cadence: boolean
  /**
   * SLA/升级计时器源开关（35-§3 首刀；缺省关）：true 时注册 tick 驱动扫描器——岗单据
   * first-ack 超时/升级链档产 kind='escalate' 意图 + ESCALATE 落账（src/engine/jobs-sources.ts；
   * 只产意图+落账，notify 发送归 notify 端口后续刀）。扫描轮询复用 jobPollMs。
   */
  sla: boolean
  /**
   * 成本警戒源开关（132-§6.4 单C·studio-dev-177；缺省关）：true 时注册
   * cost-threshold 源——tick 驱动扫当日用量投影+在途预留，达档产 escalate 意图 +
   * ESCALATE 落账（src/engine/cost-guard/source.ts）。配置真源=公司目录
   * org-config cost_guard 段（快照装载——本开关只控注册面；段不声明=源空转零唤醒）。
   * 扫描轮询复用 jobPollMs。
   */
  costGuard: boolean
  /**
   * 新鲜度窗哨兵源开关（127-A R2 批示④；缺省关）：tick 驱动越窗扫描——JOB_STALE/
   * LATE_FIRST_RUN 事件（同岗同槽幂等、零内存态，src/engine/jobs/freshness.ts）；只落事件
   * 不自动补跑（处置=CLI jobs catchup）。扫描轮询复用 jobPollMs。
   */
  freshness: boolean
  /**
   * L1 配置热重载·自动指纹监听开关（docs/38-§2 L1 / §4 R-A；缺省开，仅 companyDir 给定
   * 时生效）：每拍轻量 stat+mtime 扫公司目录，变更且稳定 → 拍边界重装载（零进程重启）。
   * false=只剩手动通道（`studio-next reload`）。坏配置拒载保持旧态（RELOAD_CONFIG_INVALID
   * 落账，面板可见）。详见 src/control/hot-reload.ts 头注。
   */
  reloadWatch: boolean
  /** 公司目录路径（可选：装载 CompanySnapshot；缺省用内置 demo 快照） */
  companyDir?: string
  /**
   * 价目表路径（可选，17-§4 models.yaml）：装载→catalog 注入引擎（估算态 A：
   * estimateCost 校准+双帽）；缺省不装载=态 B 降级（估算=适配器自报、仅票级帽）——
   * **缺省不拷贝 models.example.yaml**（示例价入账=伪依据，两态见 budget-gate.ts 头注）。
   */
  models?: string
  /** 票级预算帽缺省（USD；docs/16-§三 reserve 票帽；TaskBrief.budgetCap 优先） */
  budgetTicketCapUsd?: number
  /** 岗级预算帽缺省（USD；04-§四；仅价目表态 A 生效） */
  budgetPersonCapUsd?: number
  /**
   * 人闸每人并发缺省帽（129-§6.2-R3 第四闸，studio-dev-167 单B）：人同时在工上限，
   * 缺省 1（串行）；批量执行岗走 personInflightOverrides 单独放宽。
   */
  maxInflightPerPerson?: number
  /**
   * 队列 ageBoost 步长 ms（129-§6.2-R4 排序键）：wait/step 取档两档封顶；缺省
   * 60min（引擎侧 DEFAULT_QUEUE_AGE_STEP_MS 单一源）。
   */
  queueAgeStepMs?: number
  /**
   * 人闸覆盖表（129-§6.2-R3）：`工号=N` 分号对（matrixRoles 先例），批量执行岗才可
   * 配 >1——坏形态启动即拒（CONFIG_INVALID 语义，不静默忽略段）。
   */
  personInflightOverrides?: string
  /**
   * 制作人置顶单集（129-§6.2-R4：pinned=+∞ 恒首）：逗号清单；平台字段写通道归刀B
   * （登记在案），配置面改了即刻生效。
   */
  pinnedTickets?: string
  /**
   * 网关写收口开关（17-§7「一切平台写入经 wkey 网关」；src/engine/gated-platform.ts）：
   * 缺省开——demo fake 平台也过真闸（同 secret 同验签链路）证明收口面；false=裸 platform
   * （仅测试/对照用，生产不得关——头注警告）。
   */
  gateway: boolean
  /**
   * 网关 HMAC 密钥（daemon.yaml `gatewaySecret:`；>=32 字节，不足构造期抛 CONFIG_INVALID 拒启动）。
   * 【警告】缺省=开发占位值（下方 DEV_GATEWAY_SECRET）——**生产必配强随机密钥**；
   * 密钥只进 HMAC，永不入日志/错误消息/台账（gateway 纪律）。
   */
  gatewaySecret?: string
  /** LocalFile 平台根（platform: localfile 时生效；缺省 <rootDir>/platform） */
  platformDir?: string
  /** Taiga 实例根（platform: taiga 时必配；如 http://localhost:9000——/api/v1 由客户端拼接，尾斜杠自动剥） */
  taigaUrl?: string
  /** Taiga 项目 slug（platform: taiga 时必配；公司=项目，docs/30 §6 ③——单据 TicketId 前缀即它） */
  taigaProject?: string
  /**
   * Taiga 单据承载实体（platform: taiga 时可选；userstory（缺省，docs/32 试点路径）| issue；
   * task 仅作 workflows 类型流 entity 映射的 provision 档案目标——DEV-43 v1 运行时单实体
   * CRUD 绑定仍 userstory|issue，docs/18-§2.1.1）
   */
  taigaEntity?: 'userstory' | 'issue' | 'task'
  /**
   * Taiga 认证态（platform: taiga 时必配）：password=env TAIGA_USERNAME+TAIGA_PASSWORD
   * （JWT 自动登录+401 自动刷新/重登）；token=env TAIGA_TOKEN(+TAIGA_REFRESH 可续期；无
   * refresh 且 token 失效须重启换新）。凭据值只进 env 永不入 daemon.yaml/日志/台账
   * （红名单——与 gatewaySecret 纪律同源；文件形态 0600 token 归部署面装载进 env）。
   */
  taigaAuth?: 'password' | 'token'
  /**
   * Taiga 字段映射文件（platform: taiga 时可选；JSON 文件装 FieldProvisionMap 形状
   * {fields:{业务名→平台属性名}, types?, states, stateFlow}——扁平 YAML 子集不收嵌套故
   * 旁挂 JSON）。缺省=无映射：state/title/description/assignee 原生可用，type/dept/
   * level/lane 等自定义维读不见、写显式报错 unmapped-field。同一份文件也是迁移期
   * fields.provision 的输入（单一事实源，见 deliverables/migration.md）。
   */
  taigaFieldsFile?: string
  /**
   * agent.yaml 路径（可选，docs/17-§4 executor 注册面）：给定时装载真 executor 注册表
   * （loadAgentConfig→wireRegistry→builtinResolver）；缺省 fake adapter（demo 不变）。
   */
  agentYaml?: string
  /**
   * 冻结验收命令（可选，v0.5 真单面）：给定时=真单模式——单一命令串（多条用 && / ; 连接）
   * 拆为单元素数组，作为任务书 L4 acceptance / Blind 读面 / 真验收闸门三消费面的单一事实源；
   * 缺省 demo 占位常量 + 占位闸门（exit0 模拟）。
   */
  acceptance?: string
}

export const DEFAULT_SERVE_CONFIG: ServeConfig = {
  db: './var/ledger.sqlite',
  platform: 'fake',
  company: 'demo',
  rootDir: './var',
  tickMs: 1000,
  maxActionsPerTick: ENGINE_CONFIG_DEFAULTS.limits.maxActionsPerTick,
  maxInflight: ENGINE_CONFIG_DEFAULTS.limits.maxInflight,
  stallAfterMs: ENGINE_CONFIG_DEFAULTS.stallAfterMs,
  stallKillAfterAlarms: ENGINE_CONFIG_DEFAULTS.stallKillAfterAlarms ?? 2,
  harvestSliceMs: ENGINE_CONFIG_DEFAULTS.harvestSliceMs,
  laneTtlMs: ENGINE_CONFIG_DEFAULTS.laneTtlMs,
  breakerThreshold: ENGINE_CONFIG_DEFAULTS.breakerThreshold,
  breakerCooldownMs: ENGINE_CONFIG_DEFAULTS.breakerCooldownMs ?? 30 * 60_000,
  mirrorRescanEveryTicks: ENGINE_CONFIG_DEFAULTS.mirrorRescanEveryTicks ?? 30,
  autoApprove: false,
  jobs: false,
  jobPollMs: 15_000,
  matrix: false,
  matrixChannels: false,
  // 人事同步器缺省关（DEV-48，docs/52-§九；缺省值面=HR_SERVE_DEFAULTS 单一源）
  ...HR_SERVE_DEFAULTS,
  fileWatch: false,
  cadence: false,
  sla: false,
  costGuard: false,
  freshness: false,
  reloadWatch: true,
  gateway: true,
}

/**
 * 开发缺省网关密钥（demo/测试占位——46 ASCII 字节，过 32B 门限）。
 * 【警告】生产必配 daemon.yaml `gatewaySecret:`（强随机 >=32B）：缺省值公开在仓库里，
 * 等于闸上无锁；secret 只进 HMAC 不落任何日志/台账（gateway 包纪律）。
 */
export const DEV_GATEWAY_SECRET = 'studio-next-dev-gateway-secret-do-not-use-in-prod'

function parseScalar(raw: string): string | number | boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10)
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1)
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1)
  return v
}

/**
 * 零依赖扁平 YAML 子集解析（v0 占位——真 YAML 装载归依赖登记后）：
 * 只认 `key: value` 行与 # 注释；嵌套/列表/多行标量不收（CONFIG_INVALID 明报不猜）。
 */
export function parseDaemonConfig(text: string): ServeConfig {
  const out: Record<string, string | number | boolean> = {}
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (line === '' || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行不是扁平 key: value（v0 只收扁平子集）：${line}`)
    }
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (valueRaw === '' || valueRaw.startsWith('#')) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行 value 为空（v0 不收嵌套/空值）：${line}`)
    }
    if (/^[\[{]|^\s*-/.test(valueRaw)) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行是嵌套/列表值（v0 只收扁平标量）：${line}`)
    }
    out[key] = parseScalar(valueRaw.split(' #')[0] ?? valueRaw)
  }
  return coerceServeConfig(out)
}

// daemon.yaml 标量强制件拆在 assembly/serveconfig/coerce.ts（129-A 接线时腾位，零行为漂移）
import { bool, num, str } from './serveconfig/coerce.ts'
// 员工待办队列配置解析件（129-§6.2，studio-dev-167 单B——engine/todoqueue 域件同源）
import { parsePersonInflightOverrides, queueServeOverrides } from '../engine/todoqueue/queue.ts'
import { crossValidateMatrixChannels, reEnsureChannels, startChannelSupply, wireRoomFace } from './channels/channels.ts'

function coerceServeConfig(raw: Record<string, string | number | boolean>): ServeConfig {
  const cfg: ServeConfig = { ...DEFAULT_SERVE_CONFIG }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'db':
        cfg.db = str(value, key)
        break
      case 'platform': {
        // 平台值收紧为显式枚举（CONFIG_INVALID 明报不猜）：原「未知值静默降 fake」会把
        // platform: taiga 误配跑成 demo 假平台（写面黑洞）——taiga 接线后该静默面必须堵死。
        const v = str(value, key)
        if (v !== 'localfile' && v !== 'taiga' && v !== 'fake') {
          throw new Error(`daemon.yaml：platform 须为 localfile|taiga|fake（实得 ${v}）`)
        }
        cfg.platform = v
        break
      }
      case 'company':
        cfg.company = str(value, key)
        break
      case 'rootDir':
        cfg.rootDir = str(value, key)
        break
      case 'aiwsRoot':
        cfg.aiwsRoot = str(value, key)
        break
      case 'companyDir':
        cfg.companyDir = str(value, key)
        break
      case 'models':
        cfg.models = str(value, key)
        break
      case 'budgetTicketCapUsd':
        cfg.budgetTicketCapUsd = num(value, key)
        break
      case 'budgetPersonCapUsd':
        cfg.budgetPersonCapUsd = num(value, key)
        break
      case 'maxInflightPerPerson': {
        // 人闸缺省帽（129-§6.2-R3）：正整数——0/负数在闸内 Math.max(1,·) 兜底，但配置
        // 面就明报（fail-closed 纪律：坏配置不猜意图）
        const v = num(value, key)
        if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：maxInflightPerPerson 须为正整数（实得 ${v}）`)
        cfg.maxInflightPerPerson = v
        break
      }
      case 'queueAgeStepMs': {
        // ageBoost 步长（129-§6.2-R4）：正毫秒——core ageBoostTier 对 ≤0 fail-closed 归 0 档，
        // 配置面同样明报（步长 0=加龄永不升档，几乎必是配置错）
        const v = num(value, key)
        if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：queueAgeStepMs 须为正整数毫秒（实得 ${v}）`)
        cfg.queueAgeStepMs = v
        break
      }
      case 'personInflightOverrides': {
        // 覆盖表（129-§6.2-R3）：解析即验（坏段启动拒——不静默忽略）；空值=未配（面关）
        const v = str(value, key)
        parsePersonInflightOverrides(v)
        cfg.personInflightOverrides = v
        break
      }
      case 'pinnedTickets':
        cfg.pinnedTickets = str(value, key)
        break
      case 'tickMs':
        cfg.tickMs = num(value, key)
        break
      case 'maxActionsPerTick':
        cfg.maxActionsPerTick = num(value, key)
        break
      case 'maxInflight':
        cfg.maxInflight = num(value, key)
        break
      case 'stallAfterMs':
        cfg.stallAfterMs = num(value, key)
        break
      case 'stallKillAfterAlarms': {
        // DEV-44 咬合阈：非负整数（0=关）——非整数明报不静默取整
        const v = num(value, key)
        if (!Number.isInteger(v)) throw new Error(`daemon.yaml：stallKillAfterAlarms 须为非负整数（实得 ${v}）`)
        cfg.stallKillAfterAlarms = v
        break
      }
      case 'harvestSliceMs':
        cfg.harvestSliceMs = num(value, key)
        break
      case 'laneTtlMs':
        cfg.laneTtlMs = num(value, key)
        break
      case 'breakerThreshold':
        cfg.breakerThreshold = num(value, key)
        break
      case 'breakerCooldownMs':
        cfg.breakerCooldownMs = num(value, key)
        break
      case 'mirrorRescanEveryTicks':
        cfg.mirrorRescanEveryTicks = num(value, key)
        break
      case 'autoApprove':
        cfg.autoApprove = bool(value, key)
        break
      case 'directiveProducer':
        cfg.directiveProducer = str(value, key)
        break
      case 'directiveWhitelist': {
        const v = str(value, key)
        if (parseWhitelistSpec(v) !== undefined) cfg.directiveWhitelist = v
        break
      }
      case 'jobs':
        cfg.jobs = bool(value, key)
        break
      case 'jobPollMs':
        cfg.jobPollMs = num(value, key)
        break
      case 'matrix':
        cfg.matrix = bool(value, key)
        break
      case 'matrixHomeserverUrl':
        cfg.matrixHomeserverUrl = str(value, key)
        break
      case 'matrixUserId':
        cfg.matrixUserId = str(value, key)
        break
      case 'matrixRooms':
        cfg.matrixRooms = str(value, key)
        break
      case 'matrixRoles':
        cfg.matrixRoles = str(value, key)
        break
      case 'dataChangeRoutes':
        cfg.dataChangeRoutes = str(value, key)
        break
      case 'costThresholdTarget':
        cfg.costThresholdTarget = str(value, key)
        break
      case 'costThresholdLane':
        cfg.costThresholdLane = str(value, key)
        break
      case 'matrixPollMs':
        cfg.matrixPollMs = num(value, key)
        break
      case 'matrixSyncTimeoutMs':
        cfg.matrixSyncTimeoutMs = num(value, key)
        break
      case 'matrixChannels':
        cfg.matrixChannels = bool(value, key)
        break
      case 'matrixDeptMap':
        cfg.matrixDeptMap = str(value, key)
        break
      case 'matrixProducerMxid':
        cfg.matrixProducerMxid = str(value, key)
        break
      case 'fileWatch':
        cfg.fileWatch = bool(value, key)
        break
      case 'fileWatchPath':
        cfg.fileWatchPath = str(value, key)
        break
      case 'cadence':
        cfg.cadence = bool(value, key)
        break
      case 'sla':
        cfg.sla = bool(value, key)
        break
      case 'costGuard':
        cfg.costGuard = bool(value, key)
        break
      case 'freshness':
        cfg.freshness = bool(value, key)
        break
      // —— 人事同步器键组（DEV-48，docs/52-§九/§六.1/§七；hrPeopleWatch=129-C）——胁迫/校验收口 assembly/hrsync/config.ts（不属 hr 面回落本 switch）
      case 'hrSync':
      case 'hrMaxPerTick':
      case 'hrRetryLimit':
      case 'hrApplyingTimeoutMs':
      case 'hrMatrix':
      case 'hrMatrixRooms':
      case 'hrTaigaInviteLog':
      case 'hrTaigaInvitePolls':
      case 'hrTaigaInvitePollMs':
      case 'hrPeopleWatch':
        coerceHrServeKey(cfg, key, value, { str, num, bool })
        break
      case 'reloadWatch':
        cfg.reloadWatch = bool(value, key)
        break
      case 'gateway':
        cfg.gateway = bool(value, key)
        break
      case 'gatewaySecret':
        cfg.gatewaySecret = str(value, key)
        break
      case 'platformDir':
        cfg.platformDir = str(value, key)
        break
      case 'taigaUrl':
        cfg.taigaUrl = str(value, key)
        break
      case 'taigaProject':
        cfg.taigaProject = str(value, key)
        break
      case 'taigaEntity': {
        const v = str(value, key)
        if (v !== 'userstory' && v !== 'issue' && v !== 'task') {
          throw new Error(`daemon.yaml：taigaEntity 须为 userstory|issue|task（实得 ${v}）`)
        }
        cfg.taigaEntity = v
        break
      }
      case 'taigaAuth': {
        const v = str(value, key)
        if (v !== 'password' && v !== 'token') {
          throw new Error(`daemon.yaml：taigaAuth 须为 password|token（实得 ${v}）——凭据值只经 env 供给，不入 daemon.yaml`)
        }
        cfg.taigaAuth = v
        break
      }
      case 'taigaFieldsFile':
        cfg.taigaFieldsFile = str(value, key)
        break
      case 'agentYaml':
        cfg.agentYaml = str(value, key)
        break
      case 'acceptance':
        cfg.acceptance = str(value, key)
        break
      default:
        throw new Error(`daemon.yaml：未知配置键 ${key}（v0 最小面，见 serve.ts 头注）`)
    }
  }
  // —— taiga 必配键交叉校验（fail-fast：parse 面一次收口；直接构造 ServeConfig 的测试面
  //    由 wirePlatform/createTaigaPlatform validateOptions 二道兜底）——
  if (cfg.platform === 'taiga') {
    const missing = [
      ...(cfg.taigaUrl === undefined ? ['taigaUrl'] : []),
      ...(cfg.taigaProject === undefined ? ['taigaProject'] : []),
      ...(cfg.taigaAuth === undefined ? ['taigaAuth'] : []),
    ]
    if (missing.length > 0) {
      throw new Error(`daemon.yaml：platform: taiga 缺必配键：${missing.join('、')}（见 serve.ts 头注 taiga 段）`)
    }
  }
  // —— 人事同步器交叉校验（DEV-48，docs/52；细节在 assembly/hrsync/config.ts）——
  validateHrServeCross(cfg)
  // —— matrix 必配键交叉校验（105-刀A A-3；fail-fast 同 taiga 先例）：开关开=非敏感装配
  //    面必齐；bot 密码只经 env MATRIX_BOT_PASSWORD（永不入 yaml，21A D5）——
  //    键组由装配单元 apps/boot 消费（daemon 只收不发 Matrix 网络请求）。
  if (cfg.matrix) {
    const missingMatrix = [
      ...(cfg.matrixHomeserverUrl === undefined ? ['matrixHomeserverUrl'] : []),
      ...(cfg.matrixUserId === undefined ? ['matrixUserId'] : []),
    ]
    if (missingMatrix.length > 0) {
      throw new Error(
        `daemon.yaml：matrix: true 缺必配键：${missingMatrix.join('、')}（105-刀A；密码经 env MATRIX_BOT_PASSWORD 供给，不入 yaml）`,
      )
    }
  }
  // —— 频道供给交叉校验（130-P3，130 提案 §6.7.3-③；fail-fast 同 matrix 先例）
  crossValidateMatrixChannels(cfg)
  return cfg
}

// ————————————————————————— demo 快照与栈装配 —————————————————————————

// demo 快照拆至 assembly/demo/（130-P3 接线时腾位，20-§十五「先拆再增」；同源 re-export）
import { DEMO_SNAPSHOT } from './demo/demo-snapshot.ts'
export { DEMO_SNAPSHOT }

/** runServe 启动日志的闸门形态（buildServeRuntime 同判据：acceptance 配置给定=真单模式） */
function realGateMode(config: ServeConfig): boolean {
  return config.acceptance !== undefined
}

/**
 * Taiga 凭据供给（token 供给面）：daemon.yaml 只配形态（taigaAuth: password|token），
 * 值一律经进程 env——TAIGA_USERNAME+TAIGA_PASSWORD（密码态：JWT 自动登录，401 自动
 * 刷新/重登，http.ts）或 TAIGA_TOKEN+TAIGA_REFRESH（token 态：预换 token，有 refresh
 * 才可续）。凭据值永不入 daemon.yaml/日志/台账（红名单，与 gatewaySecret 纪律同源）；
 * 缺键=fail-closed CONFIG_INVALID，只报缺哪个键名、不打印值。文件形态（0600 token
 * 文件，docs/32 冒烟惯例）归部署面装载（systemd EnvironmentFile / docker secrets
 * → env），daemon 只认 env。
 */

/**
 * Taiga 字段映射装载（taigaFieldsFile）：扁平 YAML 子集不收嵌套，FieldProvisionMap
 * 形状的映射旁挂 JSON 文件；读不到/非法 JSON/缺 fields 段=CONFIG_INVALID（明报不猜）。
 * 深层形状（值非空、类型枚举）归 TaigaFieldMap/validateProvisionMap 二道校验。同一份
 * 文件在迁移期也是 fields.provision 的输入（单一事实源，见 deliverables/migration.md）。
 */

/**
 * 平台接线：localfile=@studio-next/localplatform（docs/23 LocalFile 协作平台——真单首跑
 * 用本地文件平台，不依赖 Taiga/YouTrack 写面）；taiga=@studio-next/taiga（docs/30 推荐
 * + docs/32 真机试点——构造期公司作用域绑定 baseUrl/project/entity/字段映射/凭据；
 * 状态集/自定义属性经 fields.provision 建档后才可 transition/setField，缺档
 * unknown-state/unknown-attribute 明报）；fake=demo 内存平台。
 * LocalFile 根=platformDir（缺省 <rootDir>/platform）。**provision（初始态=流表首态）不在此
 * 做**：字段/状态 provision 是公司装载面的一次性运营动作（platform.fields.provision），
 * daemon 不代写——建单初始态定格在 created 事件（packages/localplatform/issues.ts 头注）。
 * taiga 同理：provision 归迁移/onboard 脚本（deliverables/migration.md），daemon 只消费。
 */

/**
 * daemon 侧网关身份（控制面与 worker-key 签发共用的 secret/署名上下文/工号）。
 * 签名上下文取快照首部门+公司级（控制面无人员档案，拟稿待批）。
 * **L1 热重载活对象**（docs/38-§2）：gateway 逐调用读 ctx 字段——reload 时 mutate
 * company/dept/level 三字段即全 daemon 署名跟随新组织（hot-reload apply 段唯一写者）。
 */
function daemonIdentity(config: ServeConfig, snapshot: CompanySnapshot): {
  secret: Uint8Array
  ctx: SignatureContext
  author: string
} {
  return {
    secret: new TextEncoder().encode(config.gatewaySecret ?? DEV_GATEWAY_SECRET),
    ctx: {
      company: snapshot.name,
      dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
      role: 'daemon',
      level: Math.max(1, snapshot.level),
    },
    author: ENGINE_CONFIG_DEFAULTS.actor,
  }
}

/**
 * 网关写收口接线拆至 assembly/platform/wire.ts（130-P3 接线时腾位，20-§十五「先拆再增」；
 * 同源 import 使用——逐字搬迁零行为漂移）。
 */
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

// ————————————————————————— 定时岗：播种与运行栈 —————————————————————————

/** 播种缺省隔离窗（与 scheduler 缺省一致；坏 cron 走统一隔离路径——scheduler 会再计数+推后） */
const SEED_QUARANTINE_MS = 60 * 60_000

/** 播种结果（serve 启动面观测） */
export interface SeedJobsResult {
  seeded: number
  /** 既有行保序数（next_run_at 原样保留——欠账不清，首拍补跑） */
  kept: number
}

/**
 * 快照 jobs → 台账 jobs 表播种（jobs: true 时 serve 启动调用；18-§三「定时岗全部来自
 * 公司目录配置」的 daemon 侧落点——现行入口=快照 jobs，公司目录 jobs 段装载归
 * packages/company 后续单，见文件头注 v0 边界）。
 * 语义：新岗 next_run_at=cron 下一槽（不立即抢跑）；**既有行 next_run_at 原样保留**
 * ——重启不清欠账：错过槽位由调度器首拍补跑一次（coalesce，18-§三）；last_run_at
 * 不在 upsert 更新列（store 契约）——跑史恒真。坏 cron=now+隔离窗（调度器统一隔离）。
 */
export function seedJobs(
  ledger: Ledger,
  jobs: readonly ScheduledJob[],
  now: number,
): SeedJobsResult {
  let seeded = 0
  let kept = 0
  for (const job of jobs) {
    const existing = ledger.getJob(job.job_id)
    let next: number
    if (existing !== undefined) {
      next = existing.next_run_at
      kept += 1
    } else {
      try {
        const computed = nextRunAt(job.cron, now)
        next = computed === null ? now + SEED_QUARANTINE_MS : computed
      } catch {
        next = now + SEED_QUARANTINE_MS
      }
    }
    ledger.upsertJob({
      job_id: job.job_id,
      company: job.company,
      dept: job.dept,
      cron: job.cron,
      role: job.role,
      level: job.level,
      model_tier: job.model_tier,
      ...(job.budget_cap !== undefined ? { budget_cap: job.budget_cap.usd } : {}),
      ...(job.payload !== undefined ? { payload: job.payload } : {}),
      next_run_at: next,
    })
    if (existing === undefined) seeded += 1
  }
  return { seeded, kept }
}

/**
 * L1 热重载·调度岗移除（docs/38-§2 L1；18-§三「重注册对应岗、不动其他岗」的移除对偶）：
 * jobs 表中 company=本司、已不在新快照的岗 → removeJob（他司岗与其他来源岗不动）。
 * 在途岗单据照常走收割链（调度器只管「不再触发」）；意图消费面对消失岗已有明报丢弃面
 * （engine.ts「job 不在台账（热更移除？）——丢弃」）。
 */
export function removeMissingJobs(ledger: Ledger, snapshot: CompanySnapshot): number {
  const keep = new Set(snapshot.jobs.map((j) => j.job_id))
  let removed = 0
  for (const job of ledger.listJobs()) {
    if (job.company === snapshot.slug && !keep.has(job.job_id)) {
      ledger.removeJob(job.job_id)
      removed += 1
    }
  }
  return removed
}

/** serve 运行栈（engine + 唤起源注册表 + 统一停机面；runServe 与测试共用装配） */
export interface ServeRuntime {
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
   * 优雅停：先 stopAll 唤起源（不再进新意图）→ 在途 drain → 关台账
   * （SIGINT/SIGTERM 同一收口；可重入）。队列中未消费意图停机即弃（at-most-once，
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
 * demo 冻结验收命令（单一常量双消费：装配器 L4 acceptance + Blind 读面验收面——
 * 17-§7 读面分级与 17-§6 收割口径同源，不双源漂移；真单刀接任务书粒度冻结时此处换装载）
 */
const ACCEPTANCE: string[] = ['echo demo-ok（v0 占位闸门不执行验收命令）']

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
  const log = opts?.log ?? ((line: string): void => console.log(line))
  const clock = opts?.clock ?? ((): number => Date.now())

  // —— 公司面活持有者（docs/38-§2 L1 热重载的替换点）：装配器/cadence 源/热重载 apply 段
  //    统一读此对象——快照整组换（companyState.snapshot = next），闭包零重建
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

  // —— .AIWS 员工工作区树（DEV-28，docs/43-§五+§十9）：建司即建+存量对账 ——
  //    根推导（单一规则）：显式 aiwsRoot > dirname(companyDir)/.AIWS（公司根——与公司
  //    git 目录/var 平级，生产形态）> <rootDir>/.AIWS（demo 无公司目录，daemon 自管面内）。
  //    per-company 不并树：根归属标记异 slug → CONFIG_INVALID 拒启动（fail-closed）；
  //    增量同步=扩编建目录/缩编归档不删（aiws.ts）；启动对账后热重载 apply 段随拍增量
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

  // —— executor 注册双形态（v0.5 真单刀）：agentYaml=真注册表；缺省=fake（demo 不变）——
  const registry = createRegistry()
  let agentConf: ReturnType<typeof loadAgentConfig> | undefined
  if (config.agentYaml !== undefined) {
    const agentText = readFileSync(path.resolve(config.agentYaml), 'utf8')
    agentConf = loadAgentConfig(agentText)
    wireRegistry(registry, agentConf, builtinResolver)
    log(
      `[serve] executor 注册（agent.yaml=${config.agentYaml}）：${registry.list().map((e) => `${e.name}${e.default ? '(default)' : ''}`).join('、')}`,
    )
  } else {
    registry.register(createFakeAdapter(), { default: true })
  }

  // —— dsh bridge 插件 provisioning（v1.5#1 通道装载自动化）：注册表含 bridge 通道
  //    executor（agents_md≠native）时启动生成 overlay（<rootDir>/tmp/dsh-bridge-overlay.yml，
  //    instructions-store.ts——装载法 B，34-§3.1）；挂载归 agent.yaml cmd --patch；未挂载
  //    则 STUDIO_NEXT_INSTRUCTIONS 无消费者（明报不拒启动）——
  const bridgeChannelUsers = registry.list().filter((e) => e.capabilities.agents_md !== 'native')
  if (bridgeChannelUsers.length > 0) {
    const overlay = provisionDshBridgeOverlay(path.resolve(config.rootDir))
    if (overlay !== undefined) {
      log(
        `[serve] bridge 插件 overlay 已生成：${overlay.overlayPath}（插件源 ${overlay.bridgeSrc}）` +
          `——通道 executor：${bridgeChannelUsers.map((e) => e.name).join('、')}；agent.yaml 该家 cmd 追加 --patch <该路径> 即挂载（docs/34-§3.1 装载法 B；未挂载则注入不发生）`,
      )
    } else {
      log(
        '[serve] 警告：注册表含 bridge 通道 executor（' +
          `${bridgeChannelUsers.map((e) => e.name).join('、')}）但 dsh-bridge 包不在仓内预期位置（仓外部署？）` +
          '——overlay 未生成；须自行以 --patch 挂载 studio-next-bridge，否则 STUDIO_NEXT_INSTRUCTIONS 无消费者、身份注入不发生',
      )
    }
  }

  // —— 冻结验收命令单一事实源（v0.5 真单刀）：acceptance 配置给定=真单模式（装配器 L4 /
  //    Blind 读面 / 真验收闸门三消费面同源）；缺省=demo 占位常量——不双源漂移 ——
  const acceptance: string[] = config.acceptance !== undefined ? [config.acceptance] : ACCEPTANCE
  const realGate = config.acceptance !== undefined

  // 价目表装载（可选，17-§4）：daemon.yaml models: 段 → parseModelsYaml → catalog 注入引擎
  // （态 A）；缺省不装载=态 B 降级——**不拷贝 models.example.yaml**（示例价入账=伪依据）。
  // fingerprint 启动日志呈现；台账事件锚归后续 daemon 单。装载失败 → CONFIG_INVALID 拒启动。
  let catalog: ModelCatalog | undefined
  let modelRoles: Readonly<Record<string, string>> | undefined
  if (config.models !== undefined) {
    const text = readFileSync(path.resolve(config.models), 'utf8')
    const parsed = parseModelsYaml(text)
    catalog = createModelCatalog(parsed)
    modelRoles = parsed.roles
    log(`[serve] 价目表装载：${config.models}（fingerprint=${fingerprint(parsed)}；估算态 A：estimateCost 校准+双帽）`)
  } else {
    log('[serve] 无价目表：预算闸态 B 降级（估算=适配器自报、仅票级帽——见 src/engine/budget-gate.ts 头注两态）')
  }

  // —— judge 注册位启动闸（studio-dev-164，红队 1 机制点）：agent.yaml 有 <family>-judge
  //    位时三查：①家族=v1 冻结面 dsh ②价目表在场（三帽要价目）③roles.micro_judge
  //    必显式 low（高档判断=成本事故，拦在启动面）——判断调用库本体的接线归单B ——
  const judgeRegs = agentConf?.executors.filter((e) => isJudgeExecutorName(e.name)) ?? []
  if (judgeRegs.length > 0) {
    for (const reg of judgeRegs) dshJudgeAdapterFactory(reg)
    if (catalog === undefined) {
      configInvalid('judge/no-models', 'judge 注册位在场但 daemon.yaml 无 models 段——三帽估算要价目表（studio-dev-160 §6.4）')
    }
    assertJudgeRoleLow(modelRoles ?? {})
    log(`[serve] judge 注册位：${judgeRegs.map((r) => r.name).join('、')}（v1=dsh 家派发面；三帽缺省 $0.01/次+$0.50/址/日+$5/公司/日）`)
  }

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
    stallAfterMs: config.stallAfterMs,
    stallKillAfterAlarms: config.stallKillAfterAlarms,
    harvestSliceMs: config.harvestSliceMs,
    laneTtlMs: config.laneTtlMs,
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
    })

  // worker 级 wkey（17-§7）：按单签发→TaskBrief.credentials env 注入→关单吊销（src/engine/worker-key.ts）
  const workerKeys = wireWorkerKeys(config, identity, clock, log)
  // raw platform（未包网关代理的原件）：engine 拿 gated 代理（下）；daemon 自身动作
  //（hr-sync 对账单开单）拿原件——网关收口的是 worker 写路径，非 daemon 自身动作
  const rawPlatform = wirePlatform(config)

  // —— 人事同步器装配（DEV-48，docs/52-§九；hrSync: true 时）：三面执行体 + 消化器 ——
  //    注入位=EngineDeps.hrSync（engine 相位 7 尾 drain，行为缝不在引擎内）；hrSync 关
  //    =零装配零注入，既有行为字节不变。装配体收口在 assembly/hrsync/assemble.ts
  //    （启动期台账镜像接线 syncCompany + 断电复位 + Taiga/Matrix 面接线——docs/52-§六/§七/§九）。
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
  const engine = createEngine({
    // 写路径网关收口（17-§7）：raw platform 包一层 gated 代理——engine 写调用签名不变（透明）
    platform: wireGatedPlatform(rawPlatform, config, identity, clock, log),
    ...(workerKeys !== undefined ? { workerKeys } : {}),
    ...(hrDigester !== undefined ? { hrSync: hrDigester } : {}),
    ...(roomFace !== undefined ? { rooms: roomFace } : {}),
    ledger,
    registry,
    assembler: makeAssembler(),
    // 闸门双形态（v0.5 真单刀）：真单模式=真验收闸门（逐条真执行冻结验收命令，
    // workspace cwd、超时杀进程组）；demo=占位闸门（exit0 模拟）——行为与既有测试面一致
    gateRunner: realGate
      ? createAcceptanceGateRunner(acceptance)
      : createDefaultGateRunner(),
    clock,
    config: engineConfig,
    people: snapshot.people, departments: snapshot.departments, // 130-P2（studio-dev-173）：部门索引随快照注入——父单立案 leader 解析
    // cost_guard 段（132-§6.4 单C）：闸四 hard 线联动（R6）的引擎配置源；段不声明=不注入=面关
    ...(snapshot.costGuard !== undefined ? { costGuard: snapshot.costGuard } : {}),
    // 成本警戒 notify 出口（129-D 181）：v0 接 log 行（刀B IM 链登记位——结构化交接件零重解析）
    notify: createCostNotifyOutlet(log),
    ...(catalog !== undefined ? { catalog } : {}),
    // 批示归一层（studio-dev-171，docs/18-§2.5）：恒注入（装配缝=engine/directive/
    // serve-config.ts——leader 表随快照，热重载整组换）
    directives: buildServeDirectiveDeps(
      { producer: config.directiveProducer, whitelist: config.directiveWhitelist },
      snapshot.departments,
    ),
  })

  // —— 唤起源注册表（22-§一）：三源按配置接入，emit 统一进 engine.ingest（runServe 接线） ——
  const sources = createSourceRegistry({ log })
  const ingestSink = (intent: Parameters<Engine['ingest']>[0][number]): void => {
    engine.ingest([intent])
  }
  // people-change 源（129-C P0-A，studio-dev-178）：hrSync+hrPeopleWatch 开=挂 hr-sync 分类器出口双写 data-change 意图（源本体 engine/hrsync/people-change-source.ts）
  const peopleChangePublish = config.hrPeopleWatch ? wirePeopleChangeSource(sources, { company: config.company, sink: ingestSink, log }) : undefined

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
  //    apply 段（校验绿后调用，幂等可重入）：调度岗播种/移除（jobs: true 时——与启动同一
  //    闸门）→ 快照持有者替换 → engine.applyCompanyUpdate（people/装配器/三派生键）→
  //    署名上下文 mutate。在途单/泳道/指令文件不动（拍边界结构性保证，hot-reload.ts 头注）。
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
        //    （哨兵票；diff 基=台账镜像现值，零平台 IO；hrSync 关=零动作）——实现体在
        //    assembly/hrsync/assemble.ts（hrApplySegment）；抛错=apply 整体失败保持旧
        //    态（fail-closed，与上同面）。
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

  return {
    engine,
    scheduler,
    sources,
    evolveSelfCheck,
    ...(hotReload !== undefined ? { hotReload } : {}),
    async stop(): Promise<void> {
      // 先停源（不再进新意图）→ 再停引擎（在途 drain）→ 关台账（SIGINT 停机顺序，22-§三.3）
      sources.stopAll()
      await engine.dispose()
      ledger.close()
    },
  }
}

// ————————————————————————— 在途接管（R-B） —————————————————————————

/** 在途接管结果（serve 启动例行面的观测锚——启动日志一行 + 测试断言面） */
export interface InflightTakeoverResult {
  /** 收口条数（前命孤儿 running 工位） */
  takenOver: number
  /** 收口明细（单号+attempt——日志归因面） */
  items: ReadonlyArray<{ id: string; issue: string; attempt: number }>
}

/**
 * serve 启动例行接管 work_records running（DEV-13 R-B；docs/38-§2「在途接管收口」/
 * docs/38-§4 分期表 R-B 行：崩溃注入测试语义转正为生产面——crash-injection ③ 的重启
 * 恢复语义即本函数；此前冻结边界「孤儿留 running、接管归后续刀」就此清偿）。
 *
 * 语义边界（与 docs/17-§2/§3/§6 的关系）：
 *   - **启动例行，非第八相位**（17-§2 主循环七相位不动）：进程边界一次面，tick 内
 *     零行为；启动时本进程 inflight 恒空——库上一切 running 行都是前命孤儿（daemon
 *     单写者前提，daemon_kv 同款），收口无歧义。
 *   - **接管≠收割**（17-§6 四要件）：handle 已失、流不可续——四要件无据不判（不落
 *     GATE_FAIL、不结算预算 settle、不烧断路连击）；收口=interrupted 终态行
 *     （EndWorkRecord.status 值域 v0 不锁——'interrupted'=前命中断，既不冒认 done
 *     也不误报 failed）。重派照旧走新意图（活动/镜像重决策，DEV-42①）→ 新 attempt
 *     → 预算沿用未结预留（adopt 不双落，crash-injection ③ 冻结语义原样）。
 *   - **零平台 IO / 零事件落账**：接管是台账卫生面（panel workers 投影「异常死亡
 *     未收割单永远留在聚合」的已知误差由此收口，views.ts 头注）；事件词表（17-§3
 *     冻结）无 WORKER_DEAD 名——观测面=启动日志行 + 终态行本身；加名走 SCHEMA_EVOLVE
 *     批示流，本刀不擅动契约。
 *   - **幂等**：过滤面（status='running' 且 ended_at 空）先于收口面（endWorkRecord
 *     已收口再收=CONFIG_INVALID）——二次接管恒零收口；优雅停（dispose 杀 handle 留
 *     running）与硬杀（SIGKILL）殊途同归，重启即收口。
 */
export function takeOverRunningWorkRecords(ledger: Ledger, now: number): InflightTakeoverResult {
  const items: Array<{ id: string; issue: string; attempt: number }> = []
  for (const r of ledger.listWorkRecords()) {
    if (r.status !== 'running' || r.ended_at !== undefined) continue
    if (ledger.endWorkRecord(r.id, { ended_at: now, status: 'interrupted' })) {
      items.push({ id: r.id, issue: r.issue, attempt: r.attempt })
    }
  }
  return { takenOver: items.length, items }
}

// ————————————————————————— 主循环 —————————————————————————

// 拍日志行抽件 render/tick.ts（20-§十五「先拆再增」）；公面经本文件 re-export 保持
// 既有导入面（noop-observability.test.ts 同源）
export { renderNoopDecision, noopLinesOf } from './render/tick.ts'
import { noopLinesOf, renderTick } from './render/tick.ts'

export interface ServeResult {
  ticks: number
  stopReason: 'signal' | 'stop-request' | 'error'
  lastError?: string
}

/**
 * 常驻主循环：装配运行栈（jobs=true 时含调度器播种与启动）→ 循环 tick（tickMs 间隔，
 * 信号可打断等待）→ 信号/出错优雅停（runtime.stop 统一收口：停调度器→drain→关台账）。
 * 返回 ServeResult（exit code 由调用方定：signal=0；error=1）。
 */
export async function runServe(
  configPath: string,
  opts?: {
    /**
     * matrix 源工厂（105-刀A A-3）：matrix: true 时注入（装配单元 apps/boot 构造
     * createMentionSource 产物——daemon 不强依赖 @studio-next/matrix）；缺省不注入
     * （matrix: true 且未注入=CONFIG_INVALID 拒启动）。
     */
    matrixSource?: () => InvokeSource
    /**
     * matrix 频道供给面工厂（130-P3 §6.7.3）：matrixChannels: true 时注入（apps/boot
     * 构造 createMatrixProvisionFace 产物）；缺省不注入（开而未注入=CONFIG_INVALID）。
     */
    matrixRoomFace?: (ctx: MatrixRoomFaceContext) => MatrixRoomFace
  },
): Promise<ServeResult> {
  const config = parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8'))
  const ledger: Ledger = openLedger(path.resolve(config.db))

  // —— 在途接管（DEV-13 R-B，docs/38-§2）：serve 启动例行接管 work_records running ——
  //    前命孤儿（硬杀 SIGKILL / 优雅停 dispose 留 running 同款）收口 interrupted；
  //    接管≠收割（四要件无据不判），重派走新 attempt、预算沿用未结预留（adopt）。
  //    最早落位（先于公司装载/探针/装配）：纯台账面零平台 IO——后续启动段即使失败，
  //    前命在途账也已收口（单写者前提下无条件正确）。
  const takeover = takeOverRunningWorkRecords(ledger, Date.now())
  console.log(
    takeover.takenOver > 0
      ? `[serve] 在途接管（R-B）：${takeover.takenOver} 条前命孤儿 running 工位收口 interrupted（${takeover.items.map((i) => `${i.issue}#att${i.attempt}`).join('、')}）——接管≠收割（四要件无据不判）；重派走新 attempt、预算沿用未结预留`
      : '[serve] 在途接管（R-B）：0 条前命孤儿 running 工位（无在途账待接管）',
  )

  let stopped = false
  let stopReason: ServeResult['stopReason'] = 'signal'
  let lastError: string | undefined
  const onSignal = (): void => {
    stopped = true
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let snapshot = DEMO_SNAPSHOT
  if (config.companyDir !== undefined) {
    // 公司目录装载（校验不过拒绝启动——04-§九；daemon 只读快照不写目录）
    const { loadCompanyDirectory, readDirectoryFiles } = await import('@studio-next/company')
    const files = await readDirectoryFiles(path.resolve(config.companyDir))
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      ledger.close()
      throw new Error(`公司目录校验不通过（拒绝启动）：\n${mounted.issues.map((i) => `  ${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('\n')}`)
    }
    snapshot = mounted.snapshot
  }

  // —— Taiga 启动探针（fail-fast，platform: taiga 时）：一次只读 fields.schema() 拉通
  //    网络→auth→项目解析→状态集四层（任一不通=启动期明报 exit 1，不等首拍 tick 才炸；
  //    探针实例只读即弃、置于装配前——失败时引擎/源不构造；engine 实例的平台经
  //    buildServeRuntime→wirePlatform 独立构造，网关收口不受影响）。 ——
  if (config.platform === 'taiga') {
    try {
      const schema = await wirePlatform(config).fields.schema()
      console.log(`[serve] Taiga 启动探针通过：schema ${String(schema.length)} 字段（auth/项目/状态集连通）`)
    } catch (err) {
      ledger.close()
      throw new Error(
        `CONFIG_INVALID：Taiga 启动探针失败（检查 taigaUrl/taigaProject/taigaAuth 凭据 env/平台状态集）：` +
        `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const { engine, sources, stop, hotReload } = buildServeRuntime(config, ledger, snapshot, {
    ...(opts?.matrixSource !== undefined ? { matrixSource: opts.matrixSource } : {}),
    ...(opts?.matrixRoomFace !== undefined ? { matrixRoomFace: opts.matrixRoomFace } : {}),
  })

  // 未挂公司目录的 daemon：L1 热重载不适用——reload 请求仍回执拒绝（不悬空 CLI 轮询）
  let answeredRequestId: string | null = null
  // 控制面停机请求的去重位（DEV-41 ①：落 daemon_kv 跨重启——重启读回，残留请求不当新
  // 请求消费；旧口径只存内存，daemon 重启即失忆，taiga6 一拍自停事故根因）
  let stopLastSeenId: string | null = ledger.kvGet(STOP_LAST_SEEN_KV_KEY)
  // 本进程已应答的停机请求 id（回执面：只对本进程消费的请求落回执——kv 读回的旧 id 不复回）
  let honoredStopId: string | null = null
  // 残留请求去重观测（静默去重=观察黑洞）：启动期 live 请求与 kv 去重位命中即落一行
  const residualStop = readStopRequest(path.resolve(config.rootDir))
  if (residualStop !== undefined && residualStop.id === stopLastSeenId) {
    console.log(`[serve] 残留停机请求已去重（id=${residualStop.id}，daemon_kv 读回——DEV-41）：不当新请求消费，正常起拍`)
  }

  console.log(`[serve] studio-next daemon 启动（company=${config.company} platform=${config.platform} db=${path.resolve(config.db)} tickMs=${config.tickMs}${config.jobs ? ` jobs=on pollMs=${config.jobPollMs}` : ''}）`)
  const stackMode =
    config.platform === 'localfile'
      ? `LocalFile 平台（${path.resolve(config.platformDir ?? path.join(config.rootDir, 'platform'))}）`
      : config.platform === 'taiga'
        ? `Taiga 平台（${config.taigaUrl ?? '?'} 项目=${config.taigaProject ?? '?'} 实体=${config.taigaEntity ?? 'userstory'}）`
        : 'fake 平台（demo）'
  const execMode = config.agentYaml !== undefined ? `真 executor（agent.yaml=${config.agentYaml}）` : 'fake executor（demo）'
  const gateMode = realGateMode(config) ? '真验收闸门（冻结验收命令真执行）' : '占位闸门（exit0 模拟）'
  console.log(`[serve] 栈形态：${stackMode} + ${execMode} + ${gateMode}（边界见 src/assembly/serve.ts 头注）`)
  // 唤起源统一启动（22-§一）：各源 start(emit)——emit 统一进引擎 ingest 队列，
  // 下一拍 state-diff 前消费；单源启动异常由注册表隔离（捕获+计数+继续，src/engine/sources.ts）
  sources.startAll((intent) => {
    engine.ingest([intent])
  })

  let ticks = 0
  while (!stopped) {
    try {
      const report = await engine.tick()
      ticks += 1
      console.log(`[serve] ${renderTick(report)}`)
      // noop 观测面（见 renderNoopDecision 头注）：静默 noop=观察黑洞，逐条落行
      for (const line of noopLinesOf(report)) console.log(line)
      for (const err of report.errors) console.error(`[serve] tick#${report.seq} 错误：${err}`)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      stopReason = 'error'
      break
    }
    // —— L1 热重载拍边界（docs/38-§2）：tick() 已收口、下一拍未开——指纹自动 + 控制面手动
    //    两触发面在此汇合；check() 恒不抛（失败面已落 ESCALATE/回执，hot-reload.ts 头注） ——
    if (hotReload !== undefined) {
      await hotReload.check()
    } else {
      answeredRequestId = answerReloadNoCompanyDir(path.resolve(config.rootDir), config.company, answeredRequestId)
    }
    // —— 控制面停机通道（DEV-9 顺带项，src/control/stop-channel.ts；DEV-41 重启失忆修复）：reload
    //    应答在前（停机前不悬空积压请求），停机请求在后；按 id 去重——去重位跨重启双保险：
    //    ① 先落 daemon_kv（改名前崩的窗口由重启读回兜底）② 再原子改名 .consume（live 面
    //    清空，新进程见无请求即正常起）。拍边界纪律不变（docs/17-§2——停机也是拍收口面） ——
    const stopRequest = readStopRequest(path.resolve(config.rootDir))
    if (stopRequest !== undefined && stopRequest.id !== stopLastSeenId) {
      stopLastSeenId = stopRequest.id
      honoredStopId = stopRequest.id
      // ① 去重位先落台账（crash 窗口兜底：②改名前崩——重启后 kv 读回即去重）
      ledger.kvSet(STOP_LAST_SEEN_KV_KEY, stopRequest.id)
      // ② 消费请求（原子改名 .consume；失败不阻断停机——①已兜底）
      const consumed = consumeStopRequest(path.resolve(config.rootDir))
      stopped = true
      stopReason = 'stop-request'
      console.log(
        `[serve] 控制面停机请求（id=${stopRequest.id}${stopRequest.reason !== undefined ? ` reason=${stopRequest.reason}` : ''}）——本拍已收口，优雅停开始` +
          `${consumed ? '（请求已消费：live 改名 .consume——重启见无请求即正常起）' : '（请求消费失败——daemon_kv 去重位兜底）'}`,
      )
    }
    // 拍间隔等待（信号打断不硬等满）
    const deadline = Date.now() + config.tickMs
    while (!stopped && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())))
    }
  }

  console.log(`[serve] 停机（${stopReason}${lastError !== undefined ? `：${lastError}` : ''}）——先停唤起源（不进新意图）+ 在途 drain`)
  await stop()
  console.log('[serve] 已优雅关闭（台账落盘；在途 work_records 留 running——重启启动例行接管收口（R-B））')
  // 控制面停机回执（src/control/stop-channel.ts）：优雅停收口**之后**落——CLI 见回执即在途
  // worker 已整树杀、台账已落盘（孤儿进程面闭环）。只回本进程应答的请求（honoredStopId）：
  // kv 读回的旧 id 属上一进程的应答面，不复回（旧回执仍在盘，按 id 匹配不误读）
  if (honoredStopId !== null) {
    writeStopResult(path.resolve(config.rootDir), {
      id: honoredStopId,
      ok: true,
      stopped: true,
      detail: `优雅停收口完成：ticks=${ticks}（停唤起源→在途 drain→worker 整树杀→台账落盘）`,
    })
  }
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  return { ticks, stopReason, ...(lastError !== undefined ? { lastError } : {}) }
}
