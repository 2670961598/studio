/**
 * serve/config-types —— serve 配置形状与缺省（纯类型/常量面）
 *
 * 依据（实现单引用）：docs/20-§十五.三（600 行阈：config.ts 拆件，行为零漂移）；
 *   docs/17-§2（主循环七相位——配置面不增删相位）；docs/17-§6（收割四要件——配置面零判据变更）。
 *
 * 边界：本件只放 ServeConfig 形状与 DEFAULT_SERVE_CONFIG；解析/交叉校验仍在 config.ts。
 * 拆件前 config.ts 600/600（零余量）；拆后原文件余量 ≥50（阈 600），本件 <600。
 */
import type { SeatbeltGrant } from '@studio-next/adapters'
import type { SelectionChain } from '@studio-next/adapters/bindcard'
import { ENGINE_CONFIG_DEFAULTS } from '../../engine/engine.ts'
import { HR_SERVE_DEFAULTS, type HrServeConfig } from '../hrsync/config.ts'
import { RESTART_SERVE_DEFAULTS, type RestartServeConfig } from '../serveconfig/restart.ts'
import type { SignatureServeConfig } from '../serveconfig/signature.ts'
import type { AuthorityServeConfig } from '../serveconfig/authority.ts'
import type { AnchorAbsenceDeclaration } from '../../control/hot-reload.ts'


/**
 * serve 配置（v0 最小面；引擎子配置并入扁平键）。hr* 人事同步器键子面在
 * assembly/hrsync/config.ts 的 HrServeConfig（DEV-48，docs/52-§九——此处 extends 收平）。
 */
export interface ServeConfig extends HrServeConfig, RestartServeConfig, SignatureServeConfig, AuthorityServeConfig {
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
  /** 对外 API 监听端口（MIG-06 装配欠账收口；docs/v2/14 §四）：**缺省 0＝ephemeral**（不抢 :8788；
   *  测试/多实例同机不撞端口）；生产在 daemon.yaml 显式指定 8788。绑定地址恒 127.0.0.1（v2/14 §四
   *  默认环回 fail-closed——LAN 暴露需显式旗标，当前未落位＝缺口，不默认监听 0.0.0.0）。 */
  apiPort?: number
  /** .AIWS 员工工作区树根（DEV-28，docs/43-§五+§十9）：缺省推导=显式本键 > dirname(companyDir)/.AIWS
   *  （公司根，生产形态——与公司 git 目录/var 平级）> `<rootDir>/.AIWS`（demo 无公司目录）。
   *  per-company 不并树：根归属标记异 slug 拒启动。 */
  aiwsRoot?: string
  /** 自动派工分配器开关（studio-dev-345；缺省关=行为零变） */
  autoAssign?: boolean
  /** 拍间隔 ms */
  tickMs: number
  /** 并发三闸 */
  maxActionsPerTick: number
  maxInflight: number
  /** 在工静默告警阈值 ms */
  stallAfterMs: number
  /** STALL 响置咬合阈（DEV-44，2026-10-20 三例实证：看门狗只叫不咬）：同 attempt 内告警达 N 次 →
   *  整树杀在途 worker（stop 通道同款 kill 链）+ 工位收口 + 回首批位重派 attempt+1（rescan 兜底）；
   *  无在途句柄=GATE_FAIL（WORKER_DEAD）收口。0=关；缺省 2。 */
  stallKillAfterAlarms: number
  /** 按 executor 分级静默阈值（studio-dev-505；`executor=ms;...` 单行字符串；缺省/未命中回退 stallAfterMs；装载期解析即验——空段/坏键/重复键/非正整数一律拒启 fail-closed，不静默忽略）。 */
  stallAfterMsByExecutor?: Readonly<Record<string, number>>
  /** 收割相位每工位每拍泵流时间片 ms（DEV-9 P1 冻结修复，docs/17-§2 拍有界；须 ≪ tickMs） */
  harvestSliceMs: number
  /** 泳道租约 TTL ms */
  laneTtlMs: number
  /** 合并租约 TTL ms（202-P4：TTL+每拍续租+死主回收；缺省同泳道 30min） */
  mergeLeaseTtlMs: number
  /** 断路阈值 N */
  breakerThreshold: number
  /** 断路半开冷却窗 ms（DEV-46：熔断后停重派至窗过→放行一次半开试探；0=即试探） */
  breakerCooldownMs: number
  /** 镜像对账重决策节流（DEV-42①，2026-10-20 哨查）：每 N 拍把非闭环（未 CLOSE）mirror 单
   * 补进决策候选——活动驱动候选只看「有新活动」，被三闸顺延且活动已被游标消费的单会
   * 永久搁置（实测 9 单零事件滞留数小时）。0=关；缺省 30。 */
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
  /** matrix @唤醒源开关（22-§二；缺省关）：true 时经**注入工厂**装配（buildServeRuntime opts.matrixSource）——
   *  daemon 不强依赖 @studio-next/matrix（装配单元注入 createMentionSource 产物；start/stop 签名对齐
   *  InvokeSource 端口即可接入）。开而未注入工厂=CONFIG_INVALID 拒启动（不静默空转）。 */
  matrix: boolean
  /**
   * matrix homeserver 基址（105-刀A A-3；matrix: true 时必配）：如 http://127.0.0.1:8008。
   * daemon.yaml 只配非敏感面——bot 密码**永不入 yaml**，经 env MATRIX_BOT_PASSWORD 供给（21A D5：密码红名单；apps/boot 读取）。
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
   * （src/engine/jobs-sources.ts——start 播种/周期刷新/stop 移除 payload 带 cadence_tier 的岗；到点
   * 意图仍走既有 scheduler→schedule 链，零新轮子）。jobs: false 时开了也无 scheduler 消费（诚实共存）。 */
  cadence: boolean
  /**
   * SLA/升级计时器源开关（35-§3 首刀；缺省关）：true 时注册 tick 驱动扫描器——岗单据
   * first-ack 超时/升级链档产 kind='escalate' 意图 + ESCALATE 落账（src/engine/jobs-sources.ts；
   * 只产意图+落账，notify 发送归 notify 端口后续刀；轮询复用 jobPollMs）。 */
  sla: boolean
  /**
   * 成本警戒源开关（132-§6.4 单C·studio-dev-177；缺省关）：true 时注册 cost-threshold 源
   * （tick 扫当日投影+预留，达档产 escalate+落账——cost-guard/source.ts；配置真源=org-config
   * cost_guard 段（快照装载，本开关只控注册面）；轮询复用 jobPollMs）。
   */
  costGuard: boolean
  /**
   * 新鲜度窗哨兵源开关（127-A R2 批示④；缺省关）：tick 驱动越窗扫描——JOB_STALE/
   * LATE_FIRST_RUN 事件（同岗同槽幂等、零内存态，src/engine/jobs/freshness.ts）；只落事件
   * 不自动补跑（处置=CLI jobs catchup）。扫描轮询复用 jobPollMs。
   */
  freshness: boolean
  /** 接力源开关（129-§6.1⑥/§6.5 单E·studio-dev-184；缺省关）：收割完成钩→「请重估单 X」幂等意图（誓作用域防抖，F1-11；缺省关=零装配零注入） */
  relay: boolean
  /** 续命源开关（129-§6.1⑥/§6.5 单E·studio-dev-184；缺省关）：断点续跑意图推送面（v0 生产调用面=测试与后续 CLI resume，50a-B4 归档） */
  resume: boolean
  /**
   * L1 配置热重载·自动指纹监听开关（docs/38-§2 L1 / §4 R-A；缺省开，仅 companyDir 给定
   * 时生效）：每拍轻量 stat+mtime 扫公司目录，变更且稳定 → 拍边界重装载（零进程重启）。
   * false=只剩手动通道（`studio-next reload`）。坏配置拒载保持旧态（RELOAD_CONFIG_INVALID
   * 落账，面板可见）。详见 src/control/hot-reload.ts 头注。
   */
  reloadWatch: boolean
  /**
   * 装配显式声明无锚（SEC-FC-03；docs/44-§2.3-4「init 通道目录无锚＝闸不适用」的显式化）：
   * daemon.yaml 两键 `reloadAnchorAbsenceDeclaredBy`/`reloadAnchorAbsenceReason` 的解析产物。
   * 缺省 undefined＝未声明→无锚拒自动应用（fail-closed 保持）；锚在场时走批准指纹面
   * （声明不越过锚）；坏锚仍拒启/拒应用（声明≠放行开关）。解析规则见
   * assembly/serve/anchor-absence.ts 头注。
   */
  reloadAnchorAbsence?: AnchorAbsenceDeclaration
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
  /** 队列小模型址开关（160-B·studio-dev-182）：逗号清单 mj-129-pick/mj-129-interrupt；缺省空=两址全关（规则缺省档）；未知址名启动即拒；开关需 judge 注册位+价目表在场 */
  judgeSites?: string
  /**
   * 模型档显式单级覆盖（studio-dev-196）：`单号=档` 分号对（档∈ high/mid/low，
   * 如 `STUDIO-196-H=high;STUDIO-196-L=low`）——解析即验（坏段/未知档/重复单号启动
   * 拒，CONFIG_INVALID fail-closed）。缺省=无覆盖（只靠角色映射路由；org-config
   * 规范位/单据字段=登记债务）。路由面开合随 models: 段（价目表）。
   */
  modelTierTickets?: string
  /**
   * 网关写路径收口位（**不是配置键**——SEC-FC-01：daemon.yaml `gateway:` 键已删除，出现即拒）。
   * 恒为 `true`：装配层只有 gated 形态，无「关掉即裸 platform」分支（wire.ts 裸 platform 分支
   * 已删）。保留此位只为把「恒定开」写成类型事实（runtime.ts 的旧分支成为静态死分支）。
   */
  gateway: true
  /**
   * 派发 seatbelt 配置通道（IMPL-07-09 随动；v2/15 §一 SEC-FC-05）：daemon.yaml 三键
   * `seatbeltTier`/`seatbeltWriteRoots`/`seatbeltAuthorization` 的解析产物。
   * **缺省 undefined＝read-only 最严**（不注入 grant）；workspace-write 只在三键齐备时成立；
   * 解析/校验在 serveconfig/coerce.ts（fail-closed，不静默放宽）——本字段是唯一装配事实源，
   * resolver 与 `EngineDeps.dispatchSeatbelt` 同取此一处。
   */
  seatbelt?: SeatbeltGrant
  /** 执行器选择链登记（studio-dev-620；v2/07 §一；NEG-RUN-05／GAP-V2-04 代偿；解析/校验见 serveconfig/coerce.ts；缺省=空链——只允许主绑定缺省链） */
  dispatchSelections?: SelectionChain
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
   * （红名单——与网关签根同纪律：值只经 env/秘密源，永不入 yaml/日志/台账；文件形态 0600 token
   * 归部署面装载进 env）。
   */
  taigaAuth?: 'password' | 'token'
  /**
   * Taiga 字段映射文件（taiga 时可选；JSON 装 FieldProvisionMap{fields,types?,states,
   * stateFlow}——扁平 YAML 不收嵌套故旁挂 JSON）。缺省=无映射（自定义维读不见、写报
   * unmapped-field）；同文件也是迁移期 fields.provision 输入（单一事实源）。
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
  // 对外 API 缺省 ephemeral（不抢 8788；生产 daemon.yaml 显式指定——MIG-06 装配收口）
  apiPort: 0,
  tickMs: 1000,
  maxActionsPerTick: ENGINE_CONFIG_DEFAULTS.limits.maxActionsPerTick,
  maxInflight: ENGINE_CONFIG_DEFAULTS.limits.maxInflight,
  stallAfterMs: ENGINE_CONFIG_DEFAULTS.stallAfterMs,
  stallKillAfterAlarms: ENGINE_CONFIG_DEFAULTS.stallKillAfterAlarms ?? 2,
  harvestSliceMs: ENGINE_CONFIG_DEFAULTS.harvestSliceMs,
  laneTtlMs: ENGINE_CONFIG_DEFAULTS.laneTtlMs,
  mergeLeaseTtlMs: ENGINE_CONFIG_DEFAULTS.mergeLeaseTtlMs,
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
  // 受权重启缺省关（studio-dev-504 / #497 C-6）：不开面=生产零行为
  ...RESTART_SERVE_DEFAULTS,
  fileWatch: false,
  cadence: false,
  sla: false,
  costGuard: false,
  freshness: false,
  // 接力/续命源缺省关（129-E studio-dev-184）：关=零装配零注入，行为字节不变
  relay: false,
  resume: false,
  reloadWatch: true,
  gateway: true,
}
