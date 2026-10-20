/**
 * engine —— daemon 主循环七相位引擎（docs/17-§2，v0.5 合龙件）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§2 主循环（相位机，每拍幂等）：采集 → state-diff → 派发 → 收割 → 合并 → 回收 → 落账/心跳。
 *     同一 tick 内单只一单至多一动作（decide 每单调一次，结构性保证）；tick 返回结构化 actions 落账。
 *     **拍有界（DEV-9 P1 冻结修复，2026-10-19 生产事故）**：收割相位对在途流**增量泵收**
 *     （每工位每拍至多 harvestSliceMs）——真机 dsh 流直到 worker 进程退出才收尾，整流
 *     内联消费会阻塞整拍（事故面：18:35:05 派发后 3m29s 零事件、控制面 reload 无回执、
 *     进程 S 态 0% CPU——心跳/热重载/看门狗全挂在拍边界上）。驻留迭代器跨拍续收，
 *     事件折算状态随 Inflight 驻留；流收尾拍走原判定体（四要件面不动）。
 *   - docs/17-§6 末 收割成功契约四要件：终态事件 completed + 输出非空 + REPORT 落盘 + 闸门 exit=0。
 *     前两要件由引擎消费 adapter.stream() 判定；后两要件由**可注入 gateRunner**（src/engine/gate.ts，
 *     v0 占位实现，诚实标注）执行。
 *   - docs/17-§6 末 断路器（DEV-46 半开修订）：worker 错误 → core.onWorkerError；首次熔断
 *     events 落 ESCALATE + platform.issues.create 建 bug 单（恰一次）+ trippedAt 入账——
 *     冷却窗（config.breakerCooldownMs，拟稿 30min）内 HOLD_BREAKER_OPEN 压制重派，窗过
 *     放行一次半开试探派发（成功=GATE_PASS 复位、失败=回全开续冷却）——熔断不再是
 *     死锁终态（2026-10-20 studio-dev-78 实证：复位唯一路径=被压制的成功信号=永不可达）。
 *   - docs/22-§三.2 意图幂等：同 (source, kind, company, ticket) 重复意图只唤起一次——
 *     seenIntentKeys 由 **events 派生**（DISPATCH 事件 note 携 intentKey；见 indexEvents），
 *     同 tick 重放 / 重启重放均不双写。
 *   - docs/23-§四 demo 模式：fake 全家桶（platform/adapter/台账/公司目录）零外部依赖跑通——
 *     端到端预演见 apps/daemon/test/e2e.test.ts。
 *   - docs/22-§一/§二 唤起源（schedule 源，v0.4）：ingest() 是意图注入口——调度器
 *     onDue 产 kind='schedule' 意图（payload 携 job_id，dedupKey=job_id+触发时刻），
 *     **只产意图不直接干活**；引擎在 state-diff 前把意图物化为「岗单据」进 decide 主链：
 *     PATROL 留痕 → 派发 → 收割 → …（定时岗结果落台账的机制面，16-§四 v0.4）。
 *     **岗单物化落位分型**（DEV-40，2026-10-20 哨查事故防复发）：工单型岗落流程初态
 *     （新单）照走派发-收割链；巡查岗（payload.type='patrol'）是巡查工件不是工单——
 *     落终态锚点（delivered 无前向边=结构性不可派发），decide 恒走回收 CLOSE
 *     （宰相批注：巡查工件落新单会被派发烧配额——镜像 18 张 New 积压即此类）。
 *     意图幂等（22-§三.2）：同键 schedule 意图只物化一次——PATROL 留痕派生键集
 *     （append-only **不释放**：markRan 已记账，源重投不得重跑）+ 拍内去重。
 *   - noop 观测面（2026-10-20 哨查事故防复发）：decide 的 noop 决策（NOOP_UNKNOWN_STATE/
 *     NOOP_UNKNOWN_FLOW/NOOP_IDLE/WAIT_APPROVAL/DEDUP_NOOP）无台账事件（事件词表
 *     冻结）也无平台动作——静默 noop=观察黑洞（14 张 P0/P1 单卡 2 小时无处可见）。
 *     TickDecisionEntry 携决策时平台态 state，serve 每拍为每个 noop 决策落一行日志
 *     （单号+原因码+态，见 serve.ts renderNoopDecision）。
 *   - 镜像对账重决策 + 复活一等语义（DEV-42，2026-10-20 哨查：队列大片开放却长时间零派发）：
 *     ① 候选积压饿死——决策候选是活动驱动的（采集相位 affected），被三闸顺延
 *     （HOLD_TICK_LIMIT/HOLD_INFLIGHT_LIMIT）且活动已被游标消费的单下一拍不再是候选
 *     =永久搁置（实测 studio-dev-45..53 零事件滞留数小时）；修法=相位 2 每节流拍把
 *     非闭环（未 CLOSE）mirror 单补进候选重决策（issues.list 全量每拍已取——零额外
 *     平台 IO；意图源名 'mirror' 与活动源区分，救回派发可归因；节流闸
 *     config.mirrorRescanEveryTicks，0=关）。
 *     ② CLOSE 单复活封锁——closed-set 由 CLOSE 事件派生且不释放，平台侧复活（态改回
 *     流程态+评论，docs/49 复活令口径「复活均评论即可」）被闭集永拦在决策外
 *     （实测 studio-dev-51/57 复活无效）；修法=复活一等语义：closed 单平台态离开终态
 *     （交付锚点）→ 落 RESUME 事件（17-§3 冻结词表内的复活锚点——REOPEN 不在词表，
 *     加名走 SCHEMA_EVOLVE 批示流不擅改契约）+ 闭集释放（CLOSE 后有 RESUME 即出闭集
 *     ——事件派生可重放，无第二份可变状态）。复活判定=离开终态，不是「有评论」
 *     （closed 单仅评论不复活——负断言钉死）；等级未登记流者终态锚点不可知，不复活
 *     （诚实边界，plan 登记）。
 *   - STALL 响置闭环（DEV-44，2026-10-20 三例实证 studio-dev-20/25/71：看门狗只叫不咬——
 *     工静默超阈、工人消亡、单卡已派发态，STALL 告警反复落账而无 kill+重派）：同 attempt 内
 *     STALL 告警达阈 config.stallKillAfterAlarms（缺省 2，0=关）→ executeStallResponse 咬合：
 *     ① kill 面（在途句柄存活）——`await adapter.kill(handle, killGraceMs)` 整树杀（与
 *     dispose()/stop 通道同一条 kill 链：SIGTERM 进程组→宽限→SIGKILL；await 即 02-F1-08
 *     「kill 后等死再重派」的等死）→ 工位收口 interrupted（**R-B 接管同款在途语义**：
 *     接管≠收割——四要件对被杀工人不可判，不落 GATE_FAIL 不结算预算）→ 回滚首批位，
 *     重派 attempt+1 经 rescan 兜底（activity 意图键未释放——22-§三.2 在工键经
 *     GATE_PASS/GATE_FAIL 才释放，kill 面两皆无；与 R-B 接管后重派同款路径，DEV-42①）；
 *     ② 消亡面（无在途句柄——工人已死/重启后在途丢失，三例实况面）——GATE_FAIL 收口
 *     （note 前缀 WORKER_DEAD：，与 failHarvest 流异常面同法）+ 遗留 running 工位收口
 *     failed + activity 键释放 → 重派 attempt+1 活动驱动。两面均入断路器（dispositions：
 *     STALL countsTowardBreaker=true——僵死反复须熔断收敛，防「挂死-杀-重派」无限循环；
 *     签名分型 stall:watchdog-kill / stall:worker-dead）。事件词表零新增（STALL/GATE_FAIL
 *     均在 17-§3 冻结表内）。
 *   - 看门狗喂数豁免（DEV-44 红证 ④ 发现的深层机制）：在工单的本单消费键不注入
 *     seenIntentKeys（相位 2 装配处）——镜像键被 mirror 源重派消费后，kill 面无结论
 *     事件、键不释放（22-§三.2），STALL_SILENT 候选会被 dedup step1 挡成 DEDUP_NOOP
 *     = 看门狗对第二誓起失明（告警断流，「只叫不咬」的第二层）。豁免后健康探针每拍
 *     可达（mirror 候选+rescan 兜底），重派安全由状态机守（已派发态无前向 dispatch
 *     后继）；回滚后的新单态去重照常生效。
 *   - docs/18-§三 状态归位：调度器不是控制面——岗单据与普通单走同一状态机同一收割链。
 *   - docs/16-§三 预算 / docs/20-§六.8：派发前预算闸（reserve→双行落账→才 launch——
 *     预算预留-结算**不落即不派**的机制化收口）+ 收割成功 settle 冲销（actual=每成功
 *     交付成本）+ 超帽 refusal 不派。判定引擎=core reserve/settle，接线件=src/engine/budget-gate.ts
 *     （估算两态/失败保留 adopt/双行落账顺序的拟稿待批点均见该文件头注）。
 *   - docs/17-§7 worker 级 wkey：按单签发→随派发注入→关单吊销——接线件=src/engine/worker-key.ts
 *     （deps.workerKeys 注入才启用；缺省不注入=零行为变更）。通道=**env**（2026-10-18
 *     制作人定调：凭据经子进程环境变量注入，永不入提示词/档案/任务书；TaskBrief.
 *     credentials v1.4 → 四家适配器无条件透传进子进程 env）。生命周期锚点：dispatch
 *     相位预算过闸后、launch 前 mint+credentials 注入（超帽拒派不签发）；GATE_FAIL/
 *     派发失败（非终局）=凭据随子进程 env 离场（结构性撤离）+重派重签（一 attempt
 *     一 key——**不吊销 ticket**：冻结的 revoke 是 ticket 级终局动作，会杀死重签新 key，
 *     per-key 吊销拟稿待批见该文件头注）；断路熔断（DEV-46 起**非终局**——冷却后半开
 *     试探要重签，同 GATE_FAIL 语义 env-离场）；CLOSE（recycle 相位）=终局吊销（17-§7
 *     「关单即吊销，杜绝归档后仍有效」）；GATE_PASS
 *     后 key 存续到 CLOSE（frozen 口径）。DISPATCH note 携 wkey 审计锚=nonce（凭据值
 *     红名单——note/日志/brief 永不含 token）。
 *   - docs/17-§7 末行 读面分级：dispatch 装配时按岗选档（main_worker=Full/verifier=Blind/
 *     其余 Focused，拟稿可配）→ createView 构造视图 → 随装配入参进任务书与 L4——
 *     接线件=src/engine/read-tiers.ts（装配期选择非运行期闸、与写闸的结构区别见该文件头注）。
 *
 * v0 占位与诚实边界（真单前逐项补齐，详见 serve.ts 头注与汇报）：
 *   - gateRunner：默认实现=REPORT 存在性 + exit0 模拟（真验收命令执行归 v0.5 真单刀）；
 *   - 泳道租约：进程内 Map + TTL（**不持久**；续租/死主回收/跨进程互斥归后续刀——单进程 v0 无死主）；
 *   - 断路器状态：进程内（重启即清零；持久化拟走 events 派生，待批示）；
 *   - wkey：env 通道下无在途文件索引面（凭据离场=子进程终结，结构性撤离；daemon 不留
 *     token 副本）；重启后 CLOSE 相位照常吊销（revoke 按 ticket，不依赖索引）；吊销集在
 *     gateway 内存 authority（跨进程可见性疑点见 src/engine/worker-key.ts 头注）；dispose 不吊销
 *     在途 key（work_records 留 running——重启 R-B 例行接管收口，接管单重签一 attempt 一 key）；
 *   - 重启后在途接管【R-B 已收口——serve 启动例行接管（serve.ts takeOverRunningWorkRecords，
 *     docs/38-§2）：前命孤儿 running 工位收口 interrupted，重派走新 attempt+adopt】；活体
 *     WORKER_DEAD 检测（wall/budget/心跳/僵尸，17-§9）仍归后续刀（R-C 面）；dispose() 仅对
 *     内存 handle 优雅 kill；
 *   - 合并相位：v0 无真 git 合并（MERGE 事件 + 状态迁移的**模拟**，note 如实标注）；
 *   - 任务书只出首版（续跑版=上次 summary.json 前情注入，17-§5，归真单刀）；
 *   - 呈批迁移（submit_approval）：v0 直迁平台，不落事件（呈批事件名待批示；真路径=网关
 *     动作词 GW_*，v0 无网关不伪造 GW_ 事件）；
 *   - approved 输入：v0 用 config.autoApprove（demo 自动批）；真制作人批准信号经网关动作词
 *     落平台后由 daemon 归一（decide.ts 头注拟稿待批点）；
 *   - 采集增量：activity 游标增量 + issues.list 全量对账（17-§12 分页/增量优化后续）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - 游标持久化【已清偿——切 store v4 正式面】：daemon_kv 自建段（DDL+prepared 语句）已删，
 *     改用 ledger.kvGet/kvSet（v4 正式读写面，语句与原自建逐字一致——字节级兼容）；键名
 *     'activity.cursor'/'tick.seq'、值形态（空串=游标 null 持久形态）、幂等语义全保持，
 *     存量数据原地续用（接管关系见 migrations v4 头注）。
 *   - work_records 收口【已清偿——切 store v4 正式面】：closeWorkRecord 直发 UPDATE 已删，
 *     改用 ledger.endWorkRecord（ended_at/status/cost_usd/tokens/report_ref/summary_ref
 *     全列入参；未给值 COALESCE 不动，语句列位与原直发逐列同形）。收口路径结构性单次
 *     （closeWorkRecord 调用点均在 inflight 注销前、每 entry 恰一次），v4 面「已收口再收=
 *     CONFIG_INVALID」的防重闸在正常流不触发——是对原语句的收口语义收紧，非行为变更。
 *   - seenIntentKeys 语义：DISPATCH 落账即「意图已消费」；该单出现 GATE_PASS/GATE_FAIL 后键
 *     释放（成功→证据就绪走收割链；失败→回首批位可再派）。100 重复活动→1 次派发即此语义。
 *   - attempt 口径：= 该单 DISPATCH 事件计数 + 1（events 派生，可重放）。
 *   - events.level：IssueRecord.level 是流等级（0→L0 流），events.level 是 1..9 人员/公司口径——
 *     取 max(1, level)（0 级单按 1 记）。两口径混用为文档疑点，已上报不改文档。
 *   - ticket_mirror.created：IssueRecord 无 created 字段，以 updated 近似（镜像可重建，17-§3）。
 *   - HEARTBEAT 哨兵单号：events.issue 必填（contract），零动作拍挂 config.heartbeatIssue（'-'）。
 *
 * schedule 意图消费口径（v0.4 拟稿待批，见 scheduler.ts 头注）：
 *   - 岗单据物化形态：type='task'、level=0（走 L0 状态流——定时岗无人审批环：岗的设立即
 *     授权，每跑再挂制作人审批与 48h 无人值守矛盾）、assignee=job.role（RoleName 恰为工号则
 *     精确命中，否则回退 defaultPersonId——岗位名→工号映射待人事档案面）；
 *   - job.level/model_tier/budget_cap 落 jobs 表随行，不进 v0 派发链（模型档接线归后续刀）；
 *   - markRan 已提交而进程崩溃于 ingest 消费前：该次触发丢失（at-most-once）——已物化岗单据
 *     经活动流重启后仍被主循环接管；
 *   - 非 schedule 意图 ingest 明报不支持（六源其余五源归 v0.8 唤起六源刀）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  EventRecord,
  ExecutorAdapter,
  FlowPlatform,
  Handle,
  InvokeIntent,
  IssueRecord,
  ModelCatalog,
  PersonRef,
  ResultStats,
  StreamEvent,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'
import {
  breakerStrikes,
  breakerTrippedAt,
  DEFAULT_FLOW_TABLE,
  decide,
  emptyBreakerState,
  flowAnchors,
  intentKeyOf,
  onWorkerError,
  onSuccess,
  resolveTicketFlow,
  type Action,
  type BreakerState,
  type ConcurrencyLimits,
  type DecisionCode,
  type FlowTable,
} from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import { gateDispatch, settleDispatch, type BudgetGateDeps } from './budget-gate.ts'
import { crashHook } from './crash-points.ts'
import { buildEventIndex, type EventIndex } from './sentinel/events-index.ts'
import type { GateRunner } from './gate.ts'
import { makeUlid } from './tools/id.ts'
import { instructionsTarget, removeInstructions, writeInstructions } from './instructions-store.ts'
import type { PromptAssembler } from './prompt-assembly.ts'
import { blindArtifactPaths, createView, resolveReadTier, roleOfAssignee } from './read-tiers.ts'
import type { ReadTier } from './read-tiers.ts'
import { heartbeatSentinelRecord, runDev49Sentinels } from './sentinel/sentinels.ts'
import { mintWorkerKey, workerKeyCredentials, workerKeyGuidance, WORKER_WKEY_ENV_KEY } from './worker-key.ts'
import type { WorkerKeyDeps } from './worker-key.ts'

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
  /** events.actor（17-§3「工号+账号」编码归 store 层定——v0 'daemon' 拟稿） */
  actor: string
  /** 派工默认工号（issue.assignee 缺省时的人员索引回退位） */
  defaultPersonId: string
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
   * 镜像对账重决策节流（DEV-42 ①，2026-10-20 哨查）：每 N 拍把非闭环（未 CLOSE）
   * mirror 单全量补进决策候选——活动驱动候选只看「有新活动」的单，被三闸顺延且活动
   * 已被游标消费的单会永久搁置（实测 studio-dev-45..53 零事件滞留数小时）。issues.list
   * 全量每拍已取（镜像 upsert 用），补进候选零额外平台 IO；N=节流闸（防 noop 决策
   * 日志面无界放大——serve 每拍为每个 noop 决策落一行）。0=关（负对照/测试隔离用）；
   * 缺省 30（tickMs=1s 时最坏 30 秒救回延迟）。
   */
  mirrorRescanEveryTicks?: number
  /**
   * 状态集巡逻核节流（DEV-49 A4，2026-10-20 出厂态根治，docs/52-§十）：每 N 拍核对
   * 「平台状态集 − 有效流表声明集 = ∅」（C1-08 看门狗口径）——出厂态回流/新模板重拷
   * 的回归哨；不成立即对心跳哨兵单 ESCALATE（每状态名一次，事件派生键去重）。
   * 节流原因=platform.fields.schema() 不是免单（每拍拉=平台读放大）；0=关（负对照/
   * 测试隔离用）；缺省 30（tickMs=1s 时最坏 30 秒回归发现延迟）。
   */
  statusSetPatrolEveryTicks?: number
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
}

/**
 * .AIWS 工位路径（docs/43-§五，DEV-28）：`<aiwsRoot>/<部门路径>/<工号>/tickets/<单号>/att<N>`
 * ——部门路径逐段展开（person.dept 是 '/' 分隔路径串）；派工对象的家+tickets+attempt。
 * 纯函数（serve 日志与测试断言同源；engine 内 executeDispatch 消费）。
 */
export function aiwsWorkspaceOf(
  aiwsRoot: string,
  person: { dept: string; id: string },
  ticket: TicketId,
  attempt: number,
): string {
  return path.join(aiwsRoot, ...person.dept.split('/'), person.id, 'tickets', ticket, `att${attempt}`)
}

// ————————————————————————— 依赖注入 —————————————————————————

/** 引擎依赖：全注入（platform 泳道的 @studio-next/localplatform 接入点=此处 FlowPlatform
 *  参数——v0 传 fake（src/engine/fakes.ts）；真 localfile/YouTrack 接线归 platform 泳道合龙） */
export interface EngineDeps {
  platform: FlowPlatform
  ledger: Ledger
  registry: ExecutorRegistry
  assembler: PromptAssembler
  /** 闸门执行器（v0 默认占位实现见 src/engine/gate.ts；真验收命令版归 v0.5 真单刀） */
  gateRunner: GateRunner
  clock: () => number
  config: EngineConfig
  /** 人员索引（公司目录快照注入；L1 配置热重载经 applyCompanyUpdate 整组替换——docs/38-§2） */
  people: readonly PersonRef[]
  /** ULID 生成器（缺省 src/engine/id.ts；测试可注入确定性序列） */
  makeId?: (ts: number) => string
  /**
   * 模型价目目录（可选注入；daemon.yaml models: 段装载，serve 侧接线）——
   * 注入=态 A（estimateCost 校准+双帽）；缺省=态 B 降级（估算=适配器自报、
   * 仅票级帽；两态说明见 src/engine/budget-gate.ts 头注）。
   */
  catalog?: ModelCatalog
  /**
   * worker 级 wkey 生命周期（可选注入；缺省不注入=关闭，行为零变更）：
   * dispatch 相位按单签发+env 通道注入；GATE_FAIL/断路（DEV-46 非终局）=env-离场不吊销，
   * CLOSE=终局吊销——17-§7；接线件与通道选型裁决见 src/engine/worker-key.ts。
   */
  workerKeys?: WorkerKeyDeps
}

// ————————————————————————— TickReport（17-§2「tick 返回结构化 actions」） —————————————————————————

/** 采集相位汇报 */
export interface TickPhaseCollect {
  activities: number
  pages: number
  affectedTickets: number
  mirrorSynced: number
  cursorBefore: string | null
  cursorAfter: string | null
  /**
   * 未知态哨告警数（DEV-49 A4，docs/52-§十）：流可解析而 state∉声明集的单本拍
   * 新落账的 ESCALATE 条数（每单每态一次——去重后增量）。
   */
  unknownStateAlarmed: number
  /**
   * 状态集巡逻核告警数（DEV-49 A4）：本拍新发现「平台有而公司声明集无」的状态名数
   * （每状态名一次；非巡逻拍恒 0）。
   */
  statusSetDrift: number
}

/** state-diff 相位：每候选一决（含 hold/noop——落账口径全量留痕） */
export interface TickDecisionEntry {
  ticket: TicketId
  intentKey: string
  code: DecisionCode
  actionType: Action['type']
  /** 决策时单据平台态（noop 观测面载荷：NOOP_UNKNOWN_STATE 等原因码须配单号+态可见） */
  state: string
}

/** 动作执行结果（派发/呈批/collect/merge/recycle/stall 面） */
export interface TickActionResult {
  ticket: TicketId
  actionType: Action['type']
  ok: boolean
  detail?: string
}

/** 收割相位汇报 */
export interface TickPhaseHarvest {
  checked: number
  completed: number
  failed: number
  pending: number
}

/** 派发相位预算闸汇报（docs/16-§三 reserve→refusal；20-§六.8） */
export interface TickPhaseDispatchBudget {
  /** 新落预留次数（双行落账成功的派发；adopt 沿用不计数） */
  budgetReserved: number
  /** 超帽拒派次数（refusal 行已落账；含票级+岗级） */
  budgetRefused: number
}

/** 一拍全量汇报（JSON 可序列化；actions=结构化动作原体，actionResults=执行面，events=本拍新账） */
export interface TickReport {
  seq: number
  ts: { start: number; end: number }
  phases: {
    collect: TickPhaseCollect
    stateDiff: {
      candidates: number
      decisions: readonly TickDecisionEntry[]
      /** 本拍复活对账释放的 closed 单数（DEV-42②：RESUME 落账数） */
      reopened: number
      /** 本拍镜像对账扫描补进候选的单数（DEV-42①：非节流拍恒 0） */
      rescanned: number
    }
    dispatch: { dispatched: number; approvals: number; results: readonly TickActionResult[] } & TickPhaseDispatchBudget
    harvest: TickPhaseHarvest
    merge: { merged: number }
    recycle: { recycled: number }
    account: { eventsAppended: number; heartbeat: boolean }
  }
  actions: readonly Action[]
  actionResults: readonly TickActionResult[]
  events: readonly EventRecord[]
  inflightAfter: number
  errors: readonly string[]
}

// ————————————————————————— 内部状态 —————————————————————————

/** 在途工位（dispatch 落 work_record 'running' 后登记；harvest 收口后注销） */
interface Inflight {
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
}

/** 泳道租约（进程内 v0：holder=单号；TTL 到期视同无主——decide laneFree 同语义） */
interface LaneLease {
  holder: TicketId
  expiresAt: number
}

// ————————————————————————— 引擎本体 —————————————————————————

/** 引擎句柄：serve 循环每拍调 tick()；停机走 dispose()（在途 drain=优雅杀） */
export interface Engine {
  tick(): Promise<TickReport>
  /**
   * 意图注入口（22-§一 源协议在引擎侧的落点）：唤起源（v0.4=scheduler 的 schedule 源）
   * 把意图推入队列，下一拍 state-diff 前消费——物化/去重/决策全在 tick 内（源零直驱）。
   */
  ingest(intents: readonly InvokeIntent[]): void
  /** 队列深度（观测/测试断言：未消费意图数） */
  readonly pendingIntents: number
  /**
   * 公司面热替换（docs/38-§2 L1 配置级热重载的引擎侧落点）：**拍边界调用**
   * （serve 主循环在 tick() 收口后调——单线程下无并发 tick，结构性不中断在途单/
   * dispatch）。整组替换人员索引、装配器与快照派生三键（defaultPersonId/deptFallback/
   * defaultLane）；在途工位（inflight/泳道租约/已落盘指令文件）不动——旧单跑旧装配方，
   * 替换后的新派发用新配置。引擎其余面（平台/台账/注册表/闸门/预算）不属公司目录资产，
   * 不在 L1 热更面。
   */
  applyCompanyUpdate(update: CompanyRuntimeUpdate): void
  /** 在途 drain（v0：对内存 handle 优雅 kill；work_records 留 running——重启接管归后续刀） */
  dispose(): Promise<void>
  readonly config: EngineConfig
}

/** applyCompanyUpdate 入参：公司目录快照在引擎内的全部消费面（整组换，不半换） */
export interface CompanyRuntimeUpdate {
  people: readonly PersonRef[]
  assembler: PromptAssembler
  /** 快照派生三键（与 buildServeRuntime 启动装载同源公式） */
  defaultPersonId: string
  deptFallback: string
  defaultLane: string
  /**
   * 流表热换（DEV-43 N1）：拍边界换表（T:<type> 叠缺省表——D13 构造序）。缺省=不换
   * （保持现表）；serve 侧显式传 undefined 语义=回内置缺省表由调用方用条件展开表达。
   */
  flows?: FlowTable
}

const CURSOR_KEY = 'activity.cursor'
const TICK_SEQ_KEY = 'tick.seq'

// —— 增量泵收运行件（DEV-9 P1 冻结修复，docs/17-§2 拍有界） ——

/** 驻留哨兵：parkRace 计时器到点（本拍无事件/时间片尽）——迭代器驻留，下一拍续收 */
const PARKED = Symbol('harvest-parked')

/**
 * 有界竞速：next() 就绪（含拒绝——原样传播走 WORKER_DEAD 面）则即时返回；ms 内未就绪
 * 返回 PARKED。挂起分支的拒绝由泵侧预附 catch 吞并记档（无悬空 unhandled rejection）。
 */
function parkRace(next: Promise<IteratorResult<StreamEvent>>, ms: number): Promise<IteratorResult<StreamEvent> | typeof PARKED> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(PARKED), Math.max(1, ms))
    timer.unref()
    next.then(
      (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export function createEngine(deps: EngineDeps): Engine {
  const { platform, ledger, registry, gateRunner, clock, config } = deps
  const makeId = deps.makeId ?? makeUlid

  // 公司面可替换绑定（docs/38-§2 L1）：applyCompanyUpdate 整组换（拍边界）——
  // people/assembler 被 resolvePerson/executeDispatch 闭包引用，let 化后热替换即生效
  let assembler = deps.assembler
  let people = deps.people

  // 预算闸依赖（docs/16-§三 / 20-§六.8）：判定=core reserve/settle，落账=ledger.appendBudget，
  // 行 id=makeId（ULID，id.ts）；catalog 缺省=态 B 降级（两态见 budget-gate.ts 头注）
  const budgetDeps: BudgetGateDeps = {
    ledger,
    makeId,
    ...(deps.catalog !== undefined ? { catalog: deps.catalog } : {}),
  }

  // —— 进程内状态（持久化边界见文件头注「v0 占位」） ——
  let breaker: BreakerState = emptyBreakerState()
  const lanes = new Map<string, LaneLease>()
  const inflight = new Map<TicketId, Inflight>()
  const intentQueue: InvokeIntent[] = []
  let seq = 0

  // worker 级 wkey（17-§7）：env 通道（TaskBrief.credentials v1.4）——凭据随 launch 进
  // 子进程 env，daemon 不留 token 副本、无在途索引面（吊销按 ticket 走 gateway，不依赖
  // 索引；workerKeys 未注入=面关闭）
  const workerKeys = deps.workerKeys

  /**
   * 吊销一单的 worker key（终局面：CLOSE——交付归档后不再重派，吊销安全；DEV-46 起
   * 熔断**不**再吊销：冷却后半开试探要重签新 key，ticket 级吊销会令试探 key 出生即死）。
   * env 通道下凭据本体已随子进程终结离场——吊销封死的是 TTL 兜底面（nonce 单次有效）。
   */
  function revokeWorkerKeyOf(ticket: TicketId): boolean {
    if (workerKeys === undefined) return false
    workerKeys.gateway.revoke(ticket)
    return true
  }

  // daemon_kv：store v4 正式面（活动流游标/拍序的家——ledger.kvGet/kvSet；本引擎自建 DDL
  // 与 prepared 语句已删，存量数据原地续用，见文件头注「已清偿」两条与 migrations v4 头注）
  const seqSeed = Number.parseInt(ledger.kvGet(TICK_SEQ_KEY) ?? '0', 10)
  if (Number.isInteger(seqSeed) && seqSeed > 0) seq = seqSeed

  // ————————————————— 小构件 —————————————————

  /** 时钟（一切时刻经注入 clock——core 纪律在 daemon 侧的同形落点） */
  const now = (): number => clock()

  function evtLevel(issue: IssueRecord): number {
    return Math.min(9, Math.max(1, issue.level ?? 1))
  }

  function evtDept(issue: IssueRecord): string {
    return issue.dept ?? config.deptFallback
  }

  /** 四桶映射（F2-04 冻结列名；kernel.TokenCounts 三字段→四桶，cached→cache_read 拟稿） */
  function tokenBuckets(stats: ResultStats): EventRecord['tokens'] {
    const out: Record<string, number> = { input: stats.tokens.input, output: stats.tokens.output }
    if (stats.tokens.cached !== undefined) out.cache_read = stats.tokens.cached
    return out as EventRecord['tokens']
  }

  /** 记账+入拍汇报（appendEvent 是 events 唯一写口——store 契约闸前置） */
  function append(evt: EventRecord, tickEvents: EventRecord[]): void {
    const r = ledger.appendEvent(evt)
    if (r.appended) tickEvents.push(evt)
  }

  function makeEvent(
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: {
      tokens?: EventRecord['tokens']
      cost_usd?: number
      duration_ms?: number
      size?: number
      payload_hash?: string
      note?: string
    },
  ): EventRecord {
    const ts = now()
    const rec: EventRecord = {
      id: makeId(ts),
      ts,
      company: config.company,
      issue: issue.id,
      event: name,
      actor: config.actor,
      attempt,
      level: evtLevel(issue),
      dept: evtDept(issue),
      tokens: extra?.tokens ?? { input: 0 },
      ...(extra?.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      ...(extra?.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
      ...(extra?.size !== undefined ? { size: extra.size } : {}),
      ...(extra?.payload_hash !== undefined ? { payload_hash: extra.payload_hash } : {}),
      ...(extra?.note !== undefined ? { note: extra.note } : {}),
    }
    append(rec, tickEvents)
    return rec
  }

  /** ticket_mirror upsert（IssueRecord→镜像列；created 以 updated 近似——拟稿见头注） */
  function syncMirror(issue: IssueRecord): void {
    const updatedMs = Date.parse(issue.updated)
    const safe = Number.isNaN(updatedMs) ? now() : updatedMs
    ledger.upsertTicketMirror({
      issue: issue.id,
      company: config.company,
      created: safe,
      updated: safe,
      state: issue.state,
      type: issue.type ?? 'task',
      dept: evtDept(issue),
      level: evtLevel(issue),
      dispatcher: config.actor,
      ...(issue.parent !== undefined ? { parent: issue.parent } : {}),
      ...(issue.lane !== undefined ? { lane: issue.lane } : {}),
    })
  }

  /** 泳道租约状态（过期=死主视同无主——decide laneFree 同语义；过期判定归 decide 入参时钟） */
  function laneState(lane: string): { lane: string; holder: string | null; expiresAt?: number } {
    const lease = lanes.get(lane)
    if (lease === undefined) return { lane, holder: null }
    return { lane, holder: lease.holder, expiresAt: lease.expiresAt }
  }

  function acquireLane(lane: string, ticket: TicketId, at: number): void {
    lanes.set(lane, { holder: ticket, expiresAt: at + config.laneTtlMs })
  }

  function releaseLane(lane: string, ticket: TicketId): void {
    const lease = lanes.get(lane)
    if (lease !== undefined && lease.holder === ticket) lanes.delete(lane)
  }

  function resolvePerson(issue: IssueRecord): PersonRef | undefined {
    return (
      (issue.assignee !== undefined ? people.find((p) => p.id === issue.assignee) : undefined) ??
      people.find((p) => p.id === config.defaultPersonId) ??
      people[0]
    )
  }

  function flowOf(issue: IssueRecord) {
    // DEV-43（docs/18-§2.1.1 解析序）：T:<type> 优先 → L:<level> 回退（与 decide 步2
    // 同函数——两处定流永不漂移）。保留词 bug/task 判定器不收 T 键（W-9）——断路单
    // 不定级回 NOOP_UNKNOWN_FLOW（待人定级后派）、岗单恒落 L0，现状语义保持。
    return resolveTicketFlow(config.flows ?? DEFAULT_FLOW_TABLE, issue.type, issue.level)
  }

  // ————————————————— 相位执行体 —————————————————

  /**
   * 派发：装配（指令文件按通道能力路由落盘：native=workspace AGENTS.md；bridge 通道=
   * 每任务临时文件 instructions-store.ts）→ **预算闸（reserve 双行落账→才 launch，
   * 20-§六.8 不落即不派）** → registry 选适配器 → launch → work_records 落在途
   * → 平台迁已派发 → events 落 DISPATCH（note 携分层指纹与 intentKey——幂等索引依据）。
   */
  async function executeDispatch(
    action: Extract<Action, { type: 'dispatch' }>,
    intentKey: string,
    index: EventIndex,
    tickEvents: EventRecord[],
    budget: TickPhaseDispatchBudget,
  ): Promise<TickActionResult> {
    const ticket = action.ticket
    // state-diff 排队时已占泳道（决策即占用）——任何失败路径都必须归还，不留死锁
    const fail = (detail: string): TickActionResult => {
      releaseLane(action.lane, ticket)
      inflight.delete(ticket)
      return { ticket, actionType: action.type, ok: false, detail }
    }
    if (inflight.has(ticket)) {
      return fail('该单已有在途工位（幂等跳过，不双写）')
    }
    const fresh = await platform.issues.get(ticket)
    const person = resolvePerson(fresh)
    if (person === undefined) {
      return fail('人员索引为空（people 未注入）——不派工')
    }
    const adapter = registry.pick()
    if (adapter === undefined) {
      return fail('注册表无存活 executor（registry.pick 空）')
    }
    const attempt = index.attemptOf(ticket)
    // workspace 落点（DEV-28，docs/43-§五 派发权限圈①cwd）：aiwsRoot 给定 → 员工家
    // .AIWS/<部门路径>/<工号>/tickets/<单号>/att<N>（收割四要件与 deliverables 收账经
    // dirname(briefPath) 随迁——闸门/台账引用零改动）；缺省 → 旧一次性布局（引擎直连
    // 测试回退面，serve 恒注入 aiwsRoot——正式链路一律员工家）
    const workspace =
      config.aiwsRoot !== undefined
        ? aiwsWorkspaceOf(config.aiwsRoot, person, ticket, attempt)
        : path.join(config.rootDir, 'workspaces', ticket, `att${attempt}`)
    const briefPath = path.join(workspace, 'brief.md')
    // AGENTS.md 落点按 adapter 通道能力路由（04-§六 B5 + docs/25-§3.1 v1.5#1，零 if executor——
    // 只读 capabilities）：native=workspace 根（原生发现，P-07）；user_level/append=bridge
    // 插件通道——每任务指令临时文件（workspace 外，<rootDir>/tmp/instructions/<单号>.md，
    // 0600），launch env STUDIO_NEXT_INSTRUCTIONS 指向它、由宿主插件注入系统提示 persona 段
    const agentsChannelKind = adapter.capabilities.agents_md
    const nativeAgents = agentsChannelKind === 'native'
    const agentsTarget = nativeAgents
      ? path.join(workspace, 'AGENTS.md')
      : instructionsTarget(config.rootDir, ticket)
    let instructionsPath: string | undefined // bridge 通道临时文件（收割/派发失败后清理）
    const at = now()
    let launched: Handle | undefined
    try {
      // detect 前置（18-§一：launch 前必跑；不达标明报不静默降级）
      const detect = await adapter.detect()
      if (!detect.ok) {
        return fail(`executor ${adapter.name} detect 不达标：${detect.gaps.join('；')}`)
      }
      // 读面分级（17-§7）：dispatch 装配时按岗选档（装配期选择非运行期闸——daemon 自身
      // 读不拦，见 src/engine/read-tiers.ts 头注与写闸的区别）。Blind 档在此补齐冻结验收命令
      //（config 同源）+ 本工位证据面路径；缺验收 → CONFIG_INVALID fail-closed（无验收
      // 不派工）——异常走本 catch=DISPATCH_FAIL 明报，不静默降档。
      const readTier = resolveReadTier(roleOfAssignee(fresh.assignee, people), config.readTierByRole)
      const readView = await createView(platform, readTier, ticket, {
        ...(readTier === 'blind'
          ? { blind: { acceptance: config.readBlindAcceptance ?? [], artifacts: blindArtifactPaths(workspace) } }
          : {}),
      })
      // 装配（L0-L5 → AGENTS.md + 任务书首版）与落盘（daemon 是 prompt 落盘者，17-§5）
      const assembled = assembler({
        issue: fresh,
        attempt,
        person,
        adapterName: adapter.name,
        adapterVersion: detect.version,
        capabilities: adapter.capabilities,
        workspace,
        briefPath,
        agentsTarget,
        agentsChannel: { channel: adapter.capabilities.agents_md, target: agentsTarget },
        readView,
      })
      mkdirSync(workspace, { recursive: true })
      if (nativeAgents) {
        writeFileSync(agentsTarget, assembled.agentsMd.text, 'utf8')
      } else {
        // bridge 通道（v1.5#1）：组装文本落每任务临时文件（0600，「生成物勿手改」横幅
        // 由组装产物自带）——TaskBrief.AGENTS_MD.target 指向它，dsh 适配器注 env 交插件消费
        instructionsPath = agentsTarget
        writeInstructions(agentsTarget, assembled.agentsMd.text)
      }
      // 任务书追加 wkey 指引行（workerKeys 启用面；追加在六层组装产物之外、任务书是
      // per-attempt 操作面——指引行只指路不含凭据值，env 通道定调见 worker-key.ts 头注）
      const briefText =
        workerKeys === undefined ? assembled.brief.text : `${assembled.brief.text}\n${workerKeyGuidance()}\n`
      writeFileSync(briefPath, briefText, 'utf8')
      const taskBrief = assembled.brief.taskBrief
      // 预算闸（TaskBrief 构造后、launch 前——20-§六.8 机制点）：估算（两态）→ reserve
      // 判定 → 过闸=双行落账（issue 先 person 后；落账与 launch 之间失败=不派，异常
      // 上抛本 catch→DISPATCH_FAIL）；超帽=refusal 行落账+不派；duplicate=沿用未结预留
      // （失败保留重派语义）。拟稿待批点清单见 src/engine/budget-gate.ts 头注。
      const gate = await gateDispatch(budgetDeps, {
        ticket,
        personId: person.id,
        adapter,
        taskBrief,
        briefChars: assembled.brief.text.length,
        ...(config.budgetTicketCapUsd !== undefined ? { fallbackTicketCapUsd: config.budgetTicketCapUsd } : {}),
        ...(config.budgetPersonCapUsd !== undefined ? { personCapUsd: config.budgetPersonCapUsd } : {}),
        now: at,
      })
      if (gate.kind === 'refused') {
        budget.budgetRefused += 1
        if (instructionsPath !== undefined) removeInstructions(instructionsPath) // 拒派即删（无收割会来收本 attempt）
        return fail(
          `budget-refusal:${gate.reason}：估算 $${gate.estimated} + 在途 $${gate.inflight} 超帽 $${gate.cap}` +
            `——refusal 行已落账（可查，F1-09），不派（20-§六.8 预留不落即不派的镜像面）`,
        )
      }
      if (gate.kind === 'reserved') budget.budgetReserved += 1
      crashHook('dispatch-reserved') // 崩溃注入①（F3-11）：reserve 双行已落账、launch 前——受控测试缝，默认零行为（src/engine/crash-points.ts）
      // worker wkey 签发+注入（17-§7：预算过闸后、launch 前——超帽拒派不签发凭据）：
      // mint（scope=六动词全集、一 attempt 一 key）→ TaskBrief.credentials（v1.4 env 通道，
      // 2026-10-18 制作人定调）——适配器无条件透传进子进程 env；daemon 不留 token 副本
      //（审计锚=下方 DISPATCH note 携 nonce；凭据值红名单，任何 note/日志永不含）
      const minted =
        workerKeys !== undefined
          ? mintWorkerKey(workerKeys.gateway, {
              ticket,
              ...(workerKeys.makeNonce !== undefined ? { makeNonce: workerKeys.makeNonce } : {}),
            })
          : undefined
      const launchBrief: TaskBrief = {
        ...taskBrief,
        ...(minted !== undefined ? { credentials: workerKeyCredentials(minted.token) } : {}),
      }
      launched = await adapter.launch(launchBrief)
      crashHook('dispatch-launched') // 崩溃注入②（F3-11）：launch 已返回、work_records 在途落账前——受控测试缝，默认零行为
      acquireLane(action.lane, ticket, at)
      const transitioned = await platform.issues.transition(ticket, action.toState)
      const workRecordId = makeId(at)
      ledger.insertWorkRecord({
        id: workRecordId,
        issue: ticket,
        person_id: person.id,
        executor: adapter.name,
        session_id: launched.sessionId,
        lane: action.lane,
        started_at: at,
        attempt,
        status: 'running',
      })
      inflight.set(ticket, {
        ticket,
        workRecordId,
        executor: adapter.name,
        handle: launched,
        workspace,
        briefPath,
        attempt,
        lane: action.lane,
        personId: person.id,
        dispatchedAtSeq: seq,
        ...(instructionsPath !== undefined ? { instructionsPath } : {}),
      })
      syncMirror(transitioned)
      makeEvent('DISPATCH', transitioned, attempt, tickEvents, {
        size: Buffer.byteLength(assembled.agentsMd.text, 'utf8'),
        payload_hash: `sha256:${createHash('sha256').update(assembled.agentsMd.text, 'utf8').digest('hex')}`,
        note: `fp=${assembled.agentsMd.fingerprint};intent=${intentKey};executor=${adapter.name}@${detect.version};read=${readTier};agents=${agentsTarget};brief=${briefPath};budget=${gate.kind === 'reserved' ? `reserve$${gate.estimated.toFixed(4)}` : `adopt$${gate.estimated.toFixed(4)}`}${minted !== undefined ? `;wkey=env:${WORKER_WKEY_ENV_KEY}:nonce=${minted.nonce}` : ''}${action.breakerProbe === true ? `;breaker=half-open-probe（冷却窗过——单次试探：成功即复位，失败回全开续冷却，DEV-46）` : ''}`,
      })
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail:
          `attempt=${attempt} executor=${adapter.name} lane=${action.lane}` +
          `;budget=${gate.kind === 'reserved' ? `reserve $${gate.estimated.toFixed(4)}` : `adopt（沿用未结预留）$${gate.estimated.toFixed(4)}`}`,
      }
    } catch (err) {
      // 派发失败如实分类上报（DISPOSITIONS: DISPATCH_FAIL/retry）；v0 不计断路连击（拟稿）
      const msg = err instanceof Error ? err.message : String(err)
      if (launched !== undefined) await adapter.kill(launched, config.killGraceMs).catch(() => undefined)
      // bridge 通道临时指令文件即删：launch 失败=无收割会来收本 attempt，留着即泄漏
      //（清理策略见 instructions-store.ts 头注；重派会重写同路径）
      if (instructionsPath !== undefined) removeInstructions(instructionsPath)
      // 已签发的 worker wkey 随失败撤离（env 通道：launch 失败=凭据未进任何存活子进程，
      // token 只活在本次调用栈——丢弃即离场；不吊销 ticket——重试重签同 ticket，ticket 级
      // 吊销是终局动作，见 worker-key.ts 头注拟稿；失效兜底=TTL+nonce 单次）。
      return fail(`DISPATCH_FAIL：${msg}`)
    }
  }

  /**
   * 收割一单（增量泵收版，DEV-9 P1 冻结修复，docs/17-§2 拍有界）：流未收尾先泵一个
   * 时间片（config.harvestSliceMs 墙钟）——事件就绪即折算、无事件即驻留返回 'streaming'
   * （单据留在在途，下一拍续收；心跳/热重载/看门狗回拍边界）；流收尾拍走判定体
   * finalizeHarvest（四要件面零改动，docs/17-§6）。判定序不变：流（要件 1/2）→ gateRunner
   * （要件 3/4）→ 四要件齐=迁证据就绪+预算 settle 双行冲销（16-§三：actual=每成功交付成本）
   * +GATE_PASS+work_records 收口+断路复位；不齐=回滚首批位+GATE_FAIL+断路连击（熔断瞬间
   * ESCALATE+建 bug 单）——失败路径**不结算**：预留保留（断路器回首批位后重派沿用同一笔
   * 额度，budget-gate 头注拟稿）。
   */
  async function harvestOne(entry: Inflight, tickEvents: EventRecord[], errors: string[]): Promise<'completed' | 'failed' | 'streaming'> {
    let adapter: ExecutorAdapter
    try {
      adapter = registry.resolve(entry.executor)
    } catch {
      return failHarvest(entry, tickEvents, 'CONFIG_INVALID：executor 已不在注册表（收割不可继续）', {
        completed: false,
        nonEmptyOutput: false,
        reportExists: false,
        exit0: false,
      })
    }
    if (entry.streamDone !== true) {
      let pumped: 'parked' | 'done'
      try {
        pumped = await pumpHarvestStream(adapter, entry)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return failHarvest(entry, tickEvents, `WORKER_DEAD：流消费异常 ${msg}`, {
          completed: entry.foldCompleted ?? false,
          nonEmptyOutput: entry.foldNonEmpty ?? false,
          reportExists: false,
          exit0: false,
        })
      }
      if (pumped === 'parked') return 'streaming'
    }
    return finalizeHarvest(adapter, entry, tickEvents, errors)
  }

  /**
   * 增量泵流（DEV-9 修复核心）：本工位本拍至多 config.harvestSliceMs——已就绪事件连续
   * 折算（microtask 先于计时器：完成流/fake 流仍同拍收干，既有测试行为不变）；时间片尽
   * 或流暂无事件 → 驻留让出拍界（保留迭代器+挂起 next() 跨拍续收；一流一收纪律不变）。
   * 挂起 next() 的拒绝被吞并记 streamError（防悬空 unhandled rejection）——下一拍泵首查
   * 即抛，与同步抛同走 WORKER_DEAD 面，不静默。
   */
  async function pumpHarvestStream(adapter: ExecutorAdapter, entry: Inflight): Promise<'parked' | 'done'> {
    if (entry.streamError !== undefined) throw new Error(entry.streamError)
    if (entry.streamIter === undefined) {
      entry.streamIter = adapter.stream(entry.handle)[Symbol.asyncIterator]()
      entry.foldCompleted = false
      entry.foldNonEmpty = false
    }
    const deadline = Date.now() + config.harvestSliceMs
    for (;;) {
      if (Date.now() >= deadline) return 'parked' // 时间片尽——拍有界硬保证（洪流面亦让出）
      if (entry.streamNext === undefined) {
        const next = entry.streamIter.next()
        // 驻留期拒绝兜底：吞并记档（防悬空拒绝）；活跃泵内的拒绝经 parkRace 原样传播
        next.catch((err) => {
          if (entry.streamError === undefined) {
            entry.streamError = err instanceof Error ? err.message : String(err)
          }
        })
        entry.streamNext = next
      }
      const winner = await parkRace(entry.streamNext, deadline - Date.now())
      if (winner === PARKED) return 'parked'
      entry.streamNext = undefined
      if (winner.done) {
        entry.streamDone = true
        return 'done'
      }
      foldHarvestEvent(entry, winner.value)
    }
  }

  /** 流事件 → 四要件输入折算（要件 1：turn_end.completed；要件 2：非空 log） */
  function foldHarvestEvent(entry: Inflight, ev: StreamEvent): void {
    if (ev.type === 'log' && ev.text.trim() !== '') entry.foldNonEmpty = true
    if (ev.type === 'turn_end') {
      entry.foldCompleted = ev.completed
      if (ev.error !== undefined) entry.foldTerminalError = ev.error
    }
  }

  /** 判定体（原收割后半零改动迁移）：折算态（要件 1/2）→ gateRunner（要件 3/4）→ 收口 */
  async function finalizeHarvest(
    adapter: ExecutorAdapter,
    entry: Inflight,
    tickEvents: EventRecord[],
    errors: string[],
  ): Promise<'completed' | 'failed'> {
    const ticket = entry.ticket
    const completed = entry.foldCompleted ?? false
    const nonEmptyOutput = entry.foldNonEmpty ?? false
    const terminalError = entry.foldTerminalError
    const gate = await gateRunner.run({
      ticket,
      attempt: entry.attempt,
      workspace: entry.workspace,
      briefPath: entry.briefPath,
    })
    const fresh = await platform.issues.get(ticket)
    const flow = flowOf(fresh)
    const stats = await adapter.resultStats(entry.handle)

    const verdict = { completed, nonEmptyOutput, reportExists: gate.reportExists, exit0: gate.exitCode === 0 }
    const fourOk = verdict.completed && verdict.nonEmptyOutput && verdict.reportExists && verdict.exit0
    crashHook('harvest-verdict') // 崩溃注入③（F3-11）：收割四要件判定后、GATE_PASS 落账前——受控测试缝，默认零行为
    if (flow === undefined) {
      return failHarvest(entry, tickEvents, 'CONFIG_INVALID：等级未登记状态流（收割去向不可定）', verdict)
    }
    if (fourOk) {
      const anchors = flowAnchors(flow)
      const transitioned = await platform.issues.transition(ticket, anchors.evidenceReady)
      ledger.endWorkRecord(entry.workRecordId, {
        ended_at: now(),
        status: 'done',
        cost_usd: stats.cost.usd,
        tokens: stats.tokens,
        ...(gate.reportExists ? { report_ref: gate.reportPath } : {}),
        ...(gate.summaryPath !== undefined ? { summary_ref: gate.summaryPath } : {}),
      })
      breaker = onSuccess(breaker, ticket).newState
      inflight.delete(ticket)
      syncMirror(transitioned)
      // 预算结算（收割成功路径）：settle(actual=stats.cost) 双行冲销在途预留——
      // 异常不破坏收割四要件结论（errors 如实上报；预留滞留→同票后续派发走 adopt 可见）
      let budgetNote = ''
      try {
        const settled = settleDispatch(budgetDeps, {
          ticket,
          personId: entry.personId,
          actual: stats.cost,
          now: now(),
        })
        budgetNote = `;budget=settle 冲销 $${settled.released.toFixed(4)} 实际 $${settled.actualUsd.toFixed(4)}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`预算结算异常 ${ticket}：${msg}`)
        budgetNote = `;budget=settle 失败（${msg}）`
      }
      makeEvent('GATE_PASS', transitioned, entry.attempt, tickEvents, {
        tokens: tokenBuckets(stats),
        cost_usd: stats.cost.usd,
        duration_ms: stats.duration,
        note: `四要件齐（completed/非空/REPORT/exit0）；report=${gate.reportPath}${gate.summaryPath !== undefined ? `;summary=${gate.summaryPath}` : ''}${budgetNote}`,
      })
      // bridge 通道指令临时文件：保留至收割完成→此刻删（v1.5#1 清理策略；内容指纹已在
      // DISPATCH note/payload_hash 落账——证据不依赖文件存活）
      if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
      return 'completed'
    }
    const missing = [
      ...(verdict.completed ? [] : ['终态 completed']),
      ...(verdict.nonEmptyOutput ? [] : ['输出非空']),
      ...(verdict.reportExists ? [] : ['REPORT 落盘']),
      ...(verdict.exit0 ? [] : ['闸门 exit=0']),
    ].join('、')
    const detail = `GATE_FAIL：四要件缺【${missing}】${terminalError !== undefined ? `；turn_end.error=${terminalError}` : ''}${gate.note !== undefined ? `；gate=${gate.note}` : ''}`
    return failHarvest(entry, tickEvents, detail, verdict)
  }

  /** 收割失败面：回滚首批位 + GATE_FAIL 落账 + work_records 收口 failed + 断路连击（熔断开 bug 单） */
  async function failHarvest(
    entry: Inflight,
    tickEvents: EventRecord[],
    detail: string,
    verdict: { completed: boolean; nonEmptyOutput: boolean; reportExists: boolean; exit0: boolean },
  ): Promise<'completed' | 'failed'> {
    const ticket = entry.ticket
    const fresh = await platform.issues.get(ticket)
    const flow = flowOf(fresh)
    // worker wkey 撤离（17-§7）：GATE_FAIL 重派=凭据随子进程 env 离场（结构性撤离——
    // 进程终结即离场，无文件面）+重签（一 attempt 一 key，新 TaskBrief 新 credentials）
    // ——**不吊销 ticket**（ticket 级吊销是终局动作，会杀死重签的新 key；per-key 吊销
    // 拟稿待批，见 worker-key.ts 头注）；断路熔断（下方达阈值）DEV-46 起同样不吊销
    // （冷却后半开试探要重签新 key——终局吊销唯一收口=CLOSE）
    const wkeyDiscarded = workerKeys !== undefined
    // 断路签名：四要件失败形态（同形态连击才熔断——breaker streak 语义）
    const signature = `harvest:${verdict.completed ? 'c' : '-'}${verdict.nonEmptyOutput ? 'o' : '-'}${verdict.reportExists ? 'r' : '-'}${verdict.exit0 ? 'g' : '-'}`
    ledger.endWorkRecord(entry.workRecordId, { status: 'failed', ended_at: now() })
    inflight.delete(ticket)
    releaseLane(entry.lane, ticket)
    if (flow !== undefined) {
      // 回首批位（DEFAULT_ROLLBACK_EDGES：已派发→新单；断路器停重派语义，breaker.ts 头注）
      const rolled = await platform.issues.transition(ticket, flowAnchors(flow).fresh)
      syncMirror(rolled)
      makeEvent('GATE_FAIL', rolled, entry.attempt, tickEvents, {
        note: `${detail};rollback=${flowAnchors(flow).fresh}${wkeyDiscarded ? ';wkey=env-离场（凭据随子进程终结；重派重签新 credentials）' : ''}`,
      })
    } else {
      makeEvent('GATE_FAIL', fresh, entry.attempt, tickEvents, {
        note: `${detail};rollback=跳过（等级未登记流）${wkeyDiscarded ? ';wkey=env-离场（凭据随子进程终结；重派重签新 credentials）' : ''}`,
      })
    }
    // 断路器：worker 错误入账（同单同签名连击；达阈值熔断→open_bug）——共享件见
    // strikeBreakerAndMaybeTrip（DEV-44 起 STALL 响置体同链，防双源漂移）
    await strikeBreakerAndMaybeTrip(ticket, fresh, entry.attempt, signature, detail, tickEvents)
    // bridge 通道指令临时文件：收割失败面同样「收割完成即删」（回首批位重派会重写）
    if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
    return 'failed'
  }

  /**
   * 断路器入账+熔断链（17-§6：worker 错误→onWorkerError 同单同签名连击；达阈→ESCALATE
   * 落账+自动开 bug 单（恰一次）——冷却窗内 HOLD_BREAKER_OPEN 压制重派，窗过放行一次
   * 半开试探（DEV-46：熔断不再是死锁终态——复位不再只靠被压制的成功信号）。
   * failHarvest（收割失败）与 executeStallResponse（STALL 咬合，DEV-44）共用——单一
   * 实现，防两面熔断链漂移。
   */
  async function strikeBreakerAndMaybeTrip(
    ticket: TicketId,
    fresh: IssueRecord,
    attempt: number,
    signature: string,
    detail: string,
    tickEvents: EventRecord[],
  ): Promise<void> {
    const result = onWorkerError(breaker, ticket, signature, now(), { threshold: config.breakerThreshold })
    breaker = result.newState
    if (result.action === null) return
    // 首次熔断：开 bug 单（恰一次；trippedAt 已入账——冷却窗由此起算，窗过 decide 放
    // 半开试探）。DEV-46 wkey 修订：熔断**不再吊销** ticket——半开试探要重签新 key，
    // ticket 级吊销会令试探 key 出生即死（revokedTickets 按单杀全 key，无解吊面）；
    // 凭据撤离走 env-离场（同 GATE_FAIL 语义），终局吊销唯一收口=CLOSE（worker-key.ts 头注）
    const bug = await platform.issues.create({
      title: `[bug] ${ticket} 断路熔断（同签名 ${result.action.strikes} 连击：${signature}）`,
      description: detail,
      type: 'bug',
      dept: evtDept(fresh),
      // 不定级：未定级单无状态流（decide NOOP_UNKNOWN_FLOW 明报不动），bug 单待人定级后派
    })
    await platform.links.link(bug.id, ticket, 'relates-to').catch(() => undefined)
    // note 形状冻结（panel BREAKER_NOTE_PATTERN 全锚定解析）：CIRCUIT_BREAK：单号 连击 N
    // 达阈值 M（签名 S）→ 自动开 bug 单 B——DEV-46 半开语义不进本 note（试探观测面=
    // DISPATCH half-open-probe 锚）；wkey 段无空格，随 bug 单号入 (\S+) 捕获，与旧一致
    makeEvent('ESCALATE', fresh, attempt, tickEvents, {
      note: `CIRCUIT_BREAK：${ticket} 连击 ${result.action.strikes} 达阈值 ${config.breakerThreshold}（签名 ${signature}）→ 自动开 bug 单 ${bug.id}${workerKeys !== undefined ? '；wkey=env-离场（熔断非终局——冷却后半开试探重签，DEV-46）' : ''}`,
    })
    syncMirror(bug)
  }

  /**
   * STALL 响置体（DEV-44 咬合——2026-10-20 三例实证「只叫不咬」的收口）：stall_alarm 动作
   * 执行面。同 attempt 内告警计数（index.stallStrikesOf+本拍）达 config.stallKillAfterAlarms
   * 即咬合，分两面（规格见文件头注 DEV-44 段）：
   *
   * A · kill 面（inflight 有句柄——工人僵死树活）：await adapter.kill（stop 通道同款链：
   * SIGTERM 进程组→killGraceMs→SIGKILL 整树；await 即 02-F1-08「kill 后等死」）→ 工位收口
   * interrupted（R-B 接管同款在途语义：接管≠收割——我们杀的、不是它交的，四要件不可判，
   * 不落 GATE_FAIL 不结算预算）→ 回滚首批位 → 重派 attempt+1 经 rescan 兜底（activity 意图
   * 键未释放——22-§三.2 键经 GATE_PASS/GATE_FAIL 才释放，kill 面两皆无；与 R-B 接管后
   * 重派同款路径，DEV-42①）。断路入账（dispositions：STALL countsTowardBreaker——防
   * 「挂死-杀-重派」无限循环），签名 stall:watchdog-kill。
   *
   * B · 消亡面（inflight 无句柄——工人已死/重启后在途丢失，三例实况）：GATE_FAIL 收口
   * （note 前缀 WORKER_DEAD：，与 failHarvest 流异常面同法）+ 遗留 running 工位收口 failed
   * + activity 键释放 → 重派 attempt+1 活动驱动。断路入账，签名 stall:worker-dead。
   *
   * 未达阈/刀关/本拍刚派发=只叫：STALL 告警事件照落（note 携第 N 次/阈计数），零处置。
   */
  async function executeStallResponse(
    action: Extract<Action, { type: 'stall_alarm' }>,
    index: EventIndex,
    tickEvents: EventRecord[],
  ): Promise<TickActionResult> {
    const ticket = action.ticket
    const fresh = await platform.issues.get(ticket).catch(() => undefined)
    if (fresh === undefined) {
      return { ticket, actionType: action.type, ok: false, detail: '平台取不到单据（告警无处落——下拍再看）' }
    }
    const threshold = config.stallKillAfterAlarms ?? 0
    // 在工 attempt 口径：告警/收口事件记「正在跑的这一誓」（与 GATE_PASS/GATE_FAIL 同族）；
    // attemptOf=DISPATCH 计数+1=下一誓，在工期减一（无 DISPATCH 的防御面=1）
    const workAttempt = Math.max(1, index.attemptOf(ticket) - 1)
    const nth = index.stallStrikesOf(ticket) + 1 // 索引建于拍首（不含本拍）——本拍告警是第 N 次
    const silent = `在工静默 ${action.silentMs}ms 超阈值 ${config.stallAfterMs}ms`
    const entry = inflight.get(ticket)
    if (threshold <= 0 || nth < threshold || (entry !== undefined && entry.dispatchedAtSeq === seq)) {
      // 只叫：告警事件照落（观测面不变——decide 4 号判定的台账留痕）
      makeEvent('STALL', fresh, workAttempt, tickEvents, {
        note: `${silent}（看门狗告警第 ${nth}${threshold > 0 ? `/${threshold}` : ''} 次；${
          threshold <= 0 ? '刀关 stallKillAfterAlarms=0' : nth < threshold ? '未达咬合阈' : '本拍刚派发让一拍'
        }——02-F1-08 daemon 侧兜底）`,
      })
      return { ticket, actionType: action.type, ok: true, detail: `silentMs=${action.silentMs};告警第${nth}次（只叫）` }
    }
    // —— 咬合（达阈）——
    const flow = flowOf(fresh)
    const freshAnchor = flow !== undefined ? flowAnchors(flow).fresh : undefined
    if (entry !== undefined) {
      // A 面：整树杀（await=等死——SIGTERM→宽限→SIGKILL；与 dispose()/stop 通道同一条链）
      let killNote: string
      try {
        const adapter = registry.resolve(entry.executor)
        await adapter.kill(entry.handle, config.killGraceMs)
        killNote = `整树杀 worker=${entry.executor} session=${entry.handle.sessionId} pid=${entry.handle.pid}（SIGTERM→${config.killGraceMs}ms→SIGKILL，stop 通道同款 kill 链，02-F1-08 kill 后等死）`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        killNote = `整树杀异常（executor=${entry.executor}：${msg}）——工位仍收口（句柄不可信即不可收割，如实留痕不冒认杀死）`
      }
      ledger.endWorkRecord(entry.workRecordId, { status: 'interrupted', ended_at: now() })
      inflight.delete(ticket)
      releaseLane(entry.lane, ticket)
      let rolled: IssueRecord | undefined
      if (freshAnchor !== undefined) {
        rolled = await platform.issues.transition(ticket, freshAnchor)
        syncMirror(rolled)
      }
      makeEvent('STALL', rolled ?? fresh, workAttempt, tickEvents, {
        note:
          `${silent}（第 ${nth}/${threshold} 次达阈——咬合）：${killNote}；工位收口 interrupted（R-B 在途语义：接管≠收割，四要件不可判）；` +
          `rollback=${rolled !== undefined ? freshAnchor : '跳过（等级未登记流）'}；重派=attempt+1 经 rescan 兜底（activity 键未释放——22-§三.2，R-B 同款路径 DEV-42①；预算沿用 adopt 不结算）` +
          `${workerKeys !== undefined ? '；wkey=env-离场（凭据随被杀子进程终结；重派重签新 key——不吊销 ticket）' : ''}`,
      })
      // 断路入账（dispositions：STALL countsTowardBreaker=true）
      await strikeBreakerAndMaybeTrip(
        ticket,
        fresh,
        workAttempt,
        'stall:watchdog-kill',
        `STALL 咬合（kill 面）：${silent} 第 ${nth}/${threshold} 次（${killNote}）`,
        tickEvents,
      )
      // bridge 通道指令临时文件：响置收口即删（重派会重写同路径）
      if (entry.instructionsPath !== undefined) removeInstructions(entry.instructionsPath)
      return { ticket, actionType: action.type, ok: true, detail: `咬合（kill 面）第${nth}/${threshold}次：${killNote}` }
    }
    // B 面：消亡（无可杀——三例实况：句柄不知，判定面 WORKER_DEAD 成立）
    const detail = `WORKER_DEAD：${silent}（第 ${nth}/${threshold} 次达阈——咬合）且无在途句柄（工人消亡面：2026-10-20 三例 studio-dev-20/25/71 同型）`
    let rolled: IssueRecord | undefined
    if (freshAnchor !== undefined) {
      rolled = await platform.issues.transition(ticket, freshAnchor)
      syncMirror(rolled)
    }
    makeEvent('STALL', rolled ?? fresh, workAttempt, tickEvents, {
      note: `${silent}（第 ${nth}/${threshold} 次达阈——咬合）：无在途句柄（工人消亡面）→ GATE_FAIL 收口；rollback=${rolled !== undefined ? freshAnchor : '跳过（等级未登记流）'}；重派=attempt+1（activity 键已释放——活动驱动+rescan 双兜底）`,
    })
    makeEvent('GATE_FAIL', rolled ?? fresh, workAttempt, tickEvents, {
      note: `${detail};rollback=${rolled !== undefined ? freshAnchor : '跳过（等级未登记流）'}${workerKeys !== undefined ? ';wkey=env-离场（无活进程；重派重签新 credentials）' : ''}`,
    })
    // 遗留 running 工位收口（进程内正常链路不产生 running 无 inflight——此面来自 dispose 后
    // 继续推拍等；R-B 启动接管已收口过的查无即跳过。判定面收口=failed，与 failHarvest 同款）
    for (const rec of ledger.listWorkRecords({ issue: ticket })) {
      if (rec.status === 'running') {
        ledger.endWorkRecord(rec.id, { status: 'failed', ended_at: now() })
      }
    }
    releaseLane(fresh.lane ?? config.defaultLane, ticket)
    await strikeBreakerAndMaybeTrip(ticket, fresh, workAttempt, 'stall:worker-dead', detail, tickEvents)
    return { ticket, actionType: action.type, ok: true, detail: `咬合（消亡面）第${nth}/${threshold}次：GATE_FAIL WORKER_DEAD 收口` }
  }

  // ————————————————— tick：七相位 —————————————————

  async function tick(): Promise<TickReport> {
    seq += 1
    ledger.kvSet(TICK_SEQ_KEY, String(seq))
    const startedAt = now()
    const tickEvents: EventRecord[] = []
    const decisions: TickDecisionEntry[] = []
    const decidedActions: Action[] = []
    const actionResults: TickActionResult[] = []
    const errors: string[] = []
    let mutations = 0

    // —— 相位 1 采集：activity 增量（游标）+ issues 全量对账（镜像 upsert） ——
    const cursorRaw = ledger.kvGet(CURSOR_KEY)
    // 空串=「游标为 null（尚未消费任何活动）」的持久形态（kv 列 NOT NULL——回读须还原 null）
    const cursorBefore = cursorRaw === '' || cursorRaw === null ? null : cursorRaw
    let cursor: string | null = cursorBefore
    const affected: TicketId[] = []
    const affectedSeen = new Set<TicketId>()
    let pages = 0
    let activityCount = 0
    try {
      for (let i = 0; i < config.maxActivityPages; i += 1) {
        pages += 1
        const page = await platform.activity.since(cursor)
        for (const item of page.items) {
          activityCount += 1
          if (item.issue !== undefined && !affectedSeen.has(item.issue)) {
            affectedSeen.add(item.issue)
            affected.push(item.issue)
          }
        }
        if (page.nextCursor !== null) {
          cursor = page.nextCursor
        } else if (page.items.length > 0) {
          // 平台「无更多」但本页有货：游标退守最后活动 id（docs/25-§3.2 YouTrack=最后活动 id 边界）
          const last = page.items[page.items.length - 1]?.id
          if (last !== undefined) cursor = last
        }
        if (page.nextCursor === null) break
      }
      ledger.kvSet(CURSOR_KEY, cursor ?? '')
    } catch (err) {
      errors.push(`采集相位失败：${err instanceof Error ? err.message : String(err)}`)
    }

    const issues = await platform.issues.list({}).catch((err: unknown) => {
      errors.push(`镜像对账失败（issues.list）：${err instanceof Error ? err.message : String(err)}`)
      return [] as IssueRecord[]
    })
    const issueById = new Map<TicketId, IssueRecord>(issues.map((i) => [i.id, i]))
    for (const issue of issues) syncMirror(issue)

    // —— 相位 1 尾：DEV-49 A4 双哨（未知态哨+状态集巡逻核，docs/52-§十；体=sentinels.ts，
    // 键派生=events-index.ts）——流外态单/出厂态回流不再只走 NOOP 静默观测链：ESCALATE
    // 落账（词表既有名）；哨计 mutations（RESUME 同口径）——有哨账的拍不落心跳。
    const index = buildEventIndex(ledger.queryEvents())
    const { alarmed: unknownStateAlarmed, drift: statusSetDrift } = await runDev49Sentinels({
      issues,
      flowOf,
      alarmedKeys: index.unknownStateAlarmed,
      driftKeys: index.statusSetDriftAlarmed,
      attemptOf: index.attemptOf,
      emit: (issue, attempt, note) => {
        makeEvent('ESCALATE', issue, attempt, tickEvents, { note })
      },
      patrol: {
        seq,
        every: config.statusSetPatrolEveryTicks ?? 30,
        schema: () => platform.fields.schema(),
        ...(config.flows === undefined ? {} : { flows: config.flows }),
        heartbeatIssue: config.heartbeatIssue,
        deptFallback: config.deptFallback,
        at: startedAt,
      },
      onError: (msg) => {
        errors.push(msg)
      },
    })
    mutations += unknownStateAlarmed + statusSetDrift

    // —— 相位 2 state-diff：受影响单逐个 decide（每单至多一动作；provisionalActions 供三闸） ——
    const dispatchQ: Array<{ action: Extract<Action, { type: 'dispatch' }>; intentKey: string }> = []
    const approvalQ: Array<Extract<Action, { type: 'submit_approval' }>> = []
    const collectQ: Array<Extract<Action, { type: 'collect' }>> = []
    const mergeQ: Array<Extract<Action, { type: 'merge' }>> = []
    const recycleQ: Array<Extract<Action, { type: 'recycle' }>> = []
    const stallQ: Array<Extract<Action, { type: 'stall_alarm' }>> = []
    let provisionalActions = 0

    // —— 相位 2 前置：意图队列消费（schedule 源，22-§一）——排程意图物化为岗单据进候选 ——
    const candidates: Array<{ ticket: TicketId; intent: InvokeIntent }> = []
    const drained = intentQueue.splice(0)
    const drainSeen = new Set<string>()
    for (const intent of drained) {
      if (intent.kind !== 'schedule') {
        errors.push(`意图消费：kind='${intent.kind}' 不支持（v0.4 只落 schedule 源；六源全通归 v0.8）——丢弃`)
        continue
      }
      if (intent.company !== config.company) {
        errors.push(`意图消费：公司不匹配（intent=${intent.company} engine=${config.company}）——丢弃`)
        continue
      }
      const payload = (intent.payload ?? {}) as { job_id?: unknown }
      if (typeof intent.dedupKey !== 'string' || intent.dedupKey === '') {
        errors.push('意图消费：schedule 意图缺 dedupKey（无 ticket 意图必填，invoke v1.3）——丢弃')
        continue
      }
      if (typeof payload.job_id !== 'string' || payload.job_id === '') {
        errors.push('意图消费：schedule 意图 payload 缺 job_id——丢弃')
        continue
      }
      const intentKey = intentKeyOf(intent)
      // 意图幂等（22-§三.2）：PATROL 已留痕的键（append-only 不释放——markRan 已记账，
      // 重投不得重跑）或本拍重复键，只物化一次
      if (index.patrolKeys.has(intentKey) || drainSeen.has(intentKey)) continue
      const job = ledger.getJob(payload.job_id)
      if (job === undefined) {
        errors.push(`意图消费：job ${payload.job_id} 不在台账（热更移除？）——丢弃`)
        continue
      }
      try {
        // 物化岗单据：L0 流（无人审批环）+ job.role 命工号则精确指派（口径见文件头注拟稿）。
        // 落位分型（DEV-40，2026-10-20 哨查事故防复发，docs/25-§3.2 IssueCreate.initialState）：
        //   - 工单型岗（report/cadence 等产出实工件）：不指定落位→适配器落流程初态（新单），
        //     照走 v0.4 派发-收割链（16-§四）；budget_cap 正因会派发才存在。
        //   - 巡查岗（payload.type='patrol'，公司目录 type 语义「巡检台账/在途/心跳，产出
        //     巡逻纪要」）：巡查工件不是工单——落终态锚点（delivered 无前向边=结构性不可
        //     派发），decide 恒走回收 CLOSE（宰相批注：落新单会被派发烧配额——镜像 18 张
        //     New 积压即此类）。L0 流缺失时不指定落位：单据落平台态，decide
        //     NOOP_UNKNOWN_FLOW 经 noop 观测面（serve noop 日志行）可见，不静默。
        const isPatrolArtifact = ((job.payload as { type?: unknown } | undefined)?.type) === 'patrol'
        // 岗单物化流：按 type='task' 走类型优先解析（DEV-43）——W-9 保留词表判定器不收
        // T:task 声明，故解析恒落 L0 回退（现状语义原样）；换写法只为与 decide/flowOf
        // 同一函数同一序（两处定流永不漂移）
        const l0Flow = resolveTicketFlow(config.flows ?? DEFAULT_FLOW_TABLE, 'task', 0)
        const created = await platform.issues.create({
          title: `[定时岗] ${job.job_id} ${new Date(startedAt).toISOString()}`,
          type: 'task',
          dept: job.dept,
          level: 0,
          assignee: job.role,
          ...(isPatrolArtifact && l0Flow !== undefined ? { initialState: flowAnchors(l0Flow).delivered } : {}),
        })
        syncMirror(created)
        makeEvent('PATROL', created, 1, tickEvents, {
          note: `intent=${intentKey};job=${job.job_id};cron=${job.cron};role=${job.role};dedup=${intent.dedupKey};来源=${intent.source}`,
        })
        mutations += 1
        drainSeen.add(intentKey)
        candidates.push({ ticket: created.id, intent })
      } catch (err) {
        errors.push(`意图消费：job ${job.job_id} 岗单据物化失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // —— 相位 2 前置②：复活对账（DEV-42②，2026-10-20 哨查 studio-dev-51/57 复活无效）——
    // closed-set 是 CLOSE 事件派生的闭集；平台侧复活（态改回流程态+评论，docs/49 复活令
    // 口径「复活均评论即可」）若无引擎侧一等语义，单据被闭集永拦——改态+评论也不进决策。
    // 复活判定=closed 单的平台态离开其流终态（交付锚点）：评论不动终态不算复活（负断言
    // 钉死）；等级未登记流者终态锚点不可知，不复活（诚实边界）。落 RESUME 事件
    // （17-§3 冻结词表内的复活锚点；REOPEN 不在词表，加名走 SCHEMA_EVOLVE 批示流）
    // → 下一拍 indexEvents 派生即出闭集（事件流序 last-write-wins，可重放）；本拍以
    // 局部闭集即时放行进决策（RESUME 也计 mutations——有账面动作的拍不落心跳）。
    const closedSet = new Set<TicketId>(index.closed)
    let reopened = 0
    for (const ticket of [...index.closed].sort()) {
      const issue = issueById.get(ticket)
      if (issue === undefined) continue // 平台已不可见（删除面归平台侧）——无从判定复活
      const flow = flowOf(issue)
      if (flow === undefined) continue // 等级未登记流：终态锚点不可知，不复活（plan 登记边界）
      const delivered = flowAnchors(flow).delivered
      if (issue.state === delivered) continue // 仍在终态=未复活（仅评论不触发）
      makeEvent('RESUME', issue, index.attemptOf(ticket), tickEvents, {
        note: `复活：closed 单离开终态 ${delivered} → ${issue.state}（平台侧复活；closed-set 释放，重进决策）`,
      })
      closedSet.delete(ticket)
      reopened += 1
      mutations += 1
    }

    for (const ticket of [...affected].sort()) {
      if (closedSet.has(ticket)) continue // 已 CLOSE 单不再进决策（复活经 RESUME 释放——见上）
      candidates.push({
        ticket,
        intent: {
          kind: 'ticket',
          company: config.company,
          ticket,
          source: config.intentSource,
          priority: 1,
        },
      })
    }

    // —— 相位 2 前置③：镜像对账重决策（DEV-42①，2026-10-20 哨查 studio-dev-45..53 零事件滞留）——
    // 活动驱动候选只看「有新活动」的单：被三闸顺延（HOLD_TICK_LIMIT/HOLD_INFLIGHT_LIMIT）
    // 且活动已被游标消费的单，下一拍不再是候选=永久搁置（队列大片开放却长时间零派发）。
    // 兜底=每 N 拍把非闭环（未 CLOSE）mirror 单补进候选（issues.list 全量每拍已取——镜像
    // upsert 用，零额外平台 IO）；N=节流闸（防 noop 决策日志面无界放大）。候选去重：本拍
    // 已是候选（活动/岗单物化）的单不重复（同拍一单至多一动作）；意图源名 'mirror'——
    // 与活动源 'activity' 区分，救回派发的 DISPATCH note/决策条目可观测归因。
    const candidateSeen = new Set<TicketId>(candidates.map((c) => c.ticket))
    let rescanned = 0
    const rescanEvery = config.mirrorRescanEveryTicks ?? 0
    if (rescanEvery > 0 && seq % rescanEvery === 0) {
      for (const issue of [...issues].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (closedSet.has(issue.id) || candidateSeen.has(issue.id)) continue
        candidates.push({
          ticket: issue.id,
          intent: { kind: 'ticket', company: config.company, ticket: issue.id, source: 'mirror', priority: 0 },
        })
        candidateSeen.add(issue.id)
        rescanned += 1
      }
    }
    for (const cand of candidates) {
      const ticket = cand.ticket
      const issue = issueById.get(ticket) ?? (await platform.issues.get(ticket).catch(() => undefined))
      if (issue === undefined) {
        errors.push(`state-diff：单 ${ticket} 平台取不到（跳过本拍）`)
        continue
      }
      const lane = issue.lane ?? config.defaultLane
      const intent = cand.intent
      // 看门狗喂数豁免（DEV-44）：在工（已派发态）单的本单消费键不注入 seenIntentKeys——
      // dedup 防 replay 不防健康探针；镜像键被上一誓消费后（kill 面无结论事件、键不释放），
      // STALL_SILENT 会被 step1 挡成 DEDUP_NOOP，看门狗对第二誓起失明（mirror 派发后告警
      // 断流=「只叫不咬」的深层机制，红证 ④ 复现）。豁免只影响在工单 noop 决策码面
      // （DEDUP_NOOP→EVIDENCE_PENDING/STALL_SILENT）：重派安全由状态机守（已派发态无
      // 前向 dispatch 后继），回滚后的新单态去重照常生效（红证 ② t4 回滚回声仍 DEDUP）。
      const candFlow = flowOf(issue)
      const ownSeenKey = candFlow === undefined ? null : index.seenKeyOf(ticket)
      const inWork = candFlow !== undefined && issue.state === flowAnchors(candFlow).dispatched
      const out = decide({
        issue,
        laneLease: laneState(lane),
        // 在途计数=已落工位 + 本拍已排队派发（两段式「先决后执」下三闸仍须拍内即时生效）
        inflightCount: inflight.size + dispatchQ.length,
        tickActionCount: provisionalActions,
        limits: config.limits,
        intent,
        seenIntentKeys: inWork && ownSeenKey !== null ? index.seenKeys.filter((k) => k !== ownSeenKey) : index.seenKeys,
        // 断路快照（DEV-46 半开面）：trippedAt 在册=熔断中；冷却窗进快照（缺省回退
        // decide 侧 DEFAULT_BREAKER_COOLDOWN_MS=30min 拟稿）——无 trippedAt 的旧形快照
        // decide 按 fail-closed 恒 hold（golden 旧迹兼容）
        breaker: (() => {
          const trippedAt = breakerTrippedAt(breaker, ticket)
          return {
            strikes: breakerStrikes(breaker, ticket),
            threshold: config.breakerThreshold,
            ...(trippedAt !== undefined ? { trippedAt } : {}),
            ...(config.breakerCooldownMs !== undefined ? { cooldownMs: config.breakerCooldownMs } : {}),
          }
        })(),
        ...(config.autoApprove ? { approved: true } : {}),
        ...(config.flows !== undefined ? { flows: config.flows } : {}),
        now: startedAt,
        stallAfterMs: config.stallAfterMs,
      })
      const { action, intentKey } = out
      decisions.push({ ticket, intentKey, code: action.code, actionType: action.type, state: issue.state })
      decidedActions.push(action)
      switch (action.type) {
        case 'dispatch':
          dispatchQ.push({ action, intentKey })
          provisionalActions += 1
          // 决策即占用泳道（两段式先决后执：后续候选的 decide 须看到本拍已派的占用；
          // 执行失败时 executeDispatch 的 catch 负责释放）
          acquireLane(action.lane, ticket, startedAt)
          break
        case 'submit_approval':
          approvalQ.push(action)
          provisionalActions += 1
          break
        case 'collect':
          collectQ.push(action)
          provisionalActions += 1
          break
        case 'merge':
          mergeQ.push(action)
          provisionalActions += 1
          break
        case 'recycle':
          recycleQ.push(action)
          provisionalActions += 1
          break
        case 'stall_alarm':
          stallQ.push(action)
          provisionalActions += 1
          break
        case 'hold':
        case 'wait_evidence':
        case 'noop':
        case 'open_bug': // open_bug 只由断路器产生（收割面），decide 不出——防御性忽略
          break
      }
    }

    // —— 相位 3 派发：submit_approval（派发前置呈批）→ dispatch ——
    let approvals = 0
    for (const action of approvalQ) {
      try {
        const transitioned = await platform.issues.transition(action.ticket, action.toState)
        syncMirror(transitioned)
        approvals += 1
        mutations += 1
        actionResults.push({
          ticket: action.ticket,
          actionType: action.type,
          ok: true,
          detail: `呈批→${action.toState}（v0 直迁，事件名待批示）`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`呈批迁移失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }
    let dispatched = 0
    const budget: TickPhaseDispatchBudget = { budgetReserved: 0, budgetRefused: 0 }
    for (const { action, intentKey } of dispatchQ) {
      const result = await executeDispatch(action, intentKey, index, tickEvents, budget)
      actionResults.push(result)
      if (result.ok) {
        dispatched += 1
        mutations += 1
      } else {
        errors.push(`派发失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }

    // —— 相位 4 收割：在途 handle 检查（本拍派发的下一拍才收）→ collect 动作 → STALL 响置（DEV-44） ——
    const harvest = { checked: 0, completed: 0, failed: 0, pending: 0 }
    for (const entry of [...inflight.values()]) {
      if (entry.dispatchedAtSeq === seq) {
        harvest.pending += 1
        continue
      }
      harvest.checked += 1
      try {
        const outcome = await harvestOne(entry, tickEvents, errors)
        if (outcome === 'streaming') {
          // 流驻留（增量泵收，DEV-9 修复）：本拍未收口——计 pending，下一拍续收
          harvest.pending += 1
          continue
        }
        if (outcome === 'completed') harvest.completed += 1
        else harvest.failed += 1
        mutations += 1
      } catch (err) {
        errors.push(`收割异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    for (const action of collectQ) {
      try {
        const fresh = await platform.issues.get(action.ticket)
        const flow = flowOf(fresh)
        if (flow === undefined) {
          errors.push(`collect：单 ${action.ticket} 等级未登记流`)
          actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: '等级未登记流' })
          continue
        }
        const anchors = flowAnchors(flow)
        const transitioned = await platform.issues.transition(action.ticket, anchors.verified)
        syncMirror(transitioned)
        makeEvent('QA_PASS', transitioned, index.attemptOf(action.ticket), tickEvents, {
          note: '证据就绪→复验通过（收割相位 QA 面）',
        })
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `→${anchors.verified}` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`collect 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }
    // —— 相位 4 收割末段：STALL 响置（DEV-44——告警达阈咬合：kill 面/消亡面，executeStallResponse） ——
    for (const action of stallQ) {
      const result = await executeStallResponse(action, index, tickEvents).catch(
        (err): TickActionResult => ({
          ticket: action.ticket,
          actionType: action.type,
          ok: false,
          detail: `响置异常：${err instanceof Error ? err.message : String(err)}`,
        }),
      )
      actionResults.push(result)
      if (result.ok) {
        mutations += 1
      } else {
        errors.push(`STALL 响置失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }

    // —— 相位 5 合并：复验通过 → 已交付（v0 模拟合并——无真 git 操作，note 如实标注） ——
    let merged = 0
    for (const action of mergeQ) {
      try {
        const transitioned = await platform.issues.transition(action.ticket, action.toState)
        syncMirror(transitioned)
        makeEvent('MERGE', transitioned, index.attemptOf(action.ticket), tickEvents, {
          note: `→${action.toState}（v0 模拟合并：无真 git 合并，归 v0.5 真单刀）`,
        })
        merged += 1
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `→${action.toState}（模拟）` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`merge 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }

    // —— 相位 6 回收：已交付 → 关单落账 + 泳道释放 + wkey 吊销（已交付为终态，无平台迁移） ——
    let recycled = 0
    for (const action of recycleQ) {
      try {
        const fresh = await platform.issues.get(action.ticket)
        const lane = fresh.lane ?? config.defaultLane
        releaseLane(lane, action.ticket)
        // 17-§7「关单即吊销，杜绝归档后仍有效」：CLOSE 是 wkey 生命周期的收口点
        // （GATE_PASS 后 key 存续到此处——验收/复验窗口内 worker 仍可署名回执）。
        // 工位=**原位**归档（DEV-28，docs/43-§五）：tickets/<单号>/att<N> 证据不动（台账
        // report_ref/summary_ref 引用不断链）、员工家永不删——回收只释放泳道+吊销凭据
        const wkeyRevoked = revokeWorkerKeyOf(action.ticket)
        makeEvent('CLOSE', fresh, index.attemptOf(action.ticket), tickEvents, {
          note: `交付回收：泳道释放、工位原位归档=.AIWS 家保留（docs/43-§五；会话归档归后续刀）${wkeyRevoked ? '；wkey=关单吊销（17-§7）' : ''}`,
        })
        recycled += 1
        mutations += 1
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `lane=${lane} 释放` })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`recycle 失败 ${action.ticket}：${msg}`)
        actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
      }
    }

    // —— 相位 7 落账/心跳：零动作拍落 HEARTBEAT（游标/拍序已持久化） ——
    let heartbeat = false
    if (mutations === 0) {
      crashHook('heartbeat-write') // 崩溃注入④（F3-11）：零动作拍心跳事件写入前（落账/心跳相位缝）——受控测试缝，默认零行为
      makeEvent(
        'HEARTBEAT',
        heartbeatSentinelRecord(config.heartbeatIssue, config.deptFallback, startedAt),
        1,
        tickEvents,
        { note: `tick#${seq} 无机器动作（activities=${activityCount}）` },
      )
      heartbeat = true
    }

    return {
      seq,
      ts: { start: startedAt, end: now() },
      phases: {
        collect: {
          activities: activityCount,
          pages,
          affectedTickets: affected.length,
          mirrorSynced: issues.length,
          cursorBefore,
          cursorAfter: cursor,
          unknownStateAlarmed,
          statusSetDrift,
        },
        stateDiff: { candidates: candidates.length, decisions, reopened, rescanned },
        dispatch: {
          dispatched,
          approvals,
          results: actionResults.filter((r) => r.actionType === 'dispatch' || r.actionType === 'submit_approval'),
          budgetReserved: budget.budgetReserved,
          budgetRefused: budget.budgetRefused,
        },
        harvest,
        merge: { merged },
        recycle: { recycled },
        account: { eventsAppended: tickEvents.length, heartbeat },
      },
      actions: decidedActions,
      actionResults,
      events: tickEvents,
      inflightAfter: inflight.size,
      errors,
    }
  }

  async function dispose(): Promise<void> {
    // bridge 通道指令临时文件不在此删：work_records 留 running 的接管语义同款——
    // 重启接管重写同路径（instructions-store.ts 头注清理策略）
    for (const entry of [...inflight.values()]) {
      try {
        const adapter = registry.resolve(entry.executor)
        await adapter.kill(entry.handle, config.killGraceMs)
      } catch {
        // kill 失败如实吞记（v0：dispose 不抛——停机路径保序）；work_records 留 running
        //（重启由 serve 启动例行接管收口——R-B，serve.ts takeOverRunningWorkRecords）
      }
    }
    crashHook('shutdown-drain') // 崩溃注入⑤（F3-11）：SIGINT 停机 drain 中途（kill 已跑、在途注销前）——受控测试缝，默认零行为
    inflight.clear()
  }

  const engine: Engine = {
    tick,
    ingest(intents: readonly InvokeIntent[]): void {
      intentQueue.push(...intents)
    },
    get pendingIntents(): number {
      return intentQueue.length
    },
    applyCompanyUpdate(update: CompanyRuntimeUpdate): void {
      // 整组替换（不半换）：people+assembler 绑定与快照派生三键一起换——调用方保证
      // 拍边界（serve 主循环）；本方法自身纯赋值不抛，失败面归调用方前置校验
      people = update.people
      assembler = update.assembler
      config.defaultPersonId = update.defaultPersonId
      config.deptFallback = update.deptFallback
      config.defaultLane = update.defaultLane
      // 流表热换（DEV-43 N1）：缺省不换（保持现表）；换表后下一拍 decide/flowOf 对
      // 新表重解析（含在途单——跨边界未知态走既有 NOOP_UNKNOWN_STATE 纪律）
      if (update.flows !== undefined) config.flows = update.flows
    },
    dispose,
    get config(): EngineConfig {
      return config
    },
  }
  return engine
}
