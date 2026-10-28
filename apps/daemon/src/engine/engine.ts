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
 *   - docs/22-§一/§二 唤起源：ingest() 是意图注入口——schedule 源（v0.4，scheduler 的
 *     onDue 产 kind='schedule' 意图，payload 携 job_id，dedupKey=job_id+触发时刻）与
 *     mention 源（v0.5 消费门开闸，105-刀A：Matrix 适配器产 kind='mention' 意图，
 *     dedupKey=eventId，经组合根 apps/boot 注入——daemon 本体不 import matrix 包），
 *     **只产意图不直接干活**；引擎在 state-diff 前按消费门分发表把意图物化为单据进
 *     decide 主链：PATROL 留痕 → 派发 → 收割 → …（结果落台账的机制面，16-§四）。
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
 *     重派 attempt+1 经 rescan 兜底（**咬合收口即释放消费键——studio-dev-141 修订
 *     2026-10-21**：原口径「activity 键未释放、重派靠 rescan 兜底」自相矛盾——rescan
 *     意图键与上誓消费键同形（mirror 派发被杀时），兜底恰被自己压制：123 号卡 16:59
 *     咬合→20:33 才被平台偶发活动救活，3.5h 零派发实证；修法=STALL 咬合事件作为该誓
 *     了结锚进 events-index 释放面（见 events-index.ts STALL_KILL_CLOSE_ANCHOR）——
 *     kill 面「无结论事件不释放」只在 GATE_FAIL 唯一释放路径的世界里成立）；
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
 *     后继）；回滚后的新单态去重照常生效——**studio-dev-141 修订**：该口径只对「同誓
 *     内 replay」成立；咬合收口即释放消费键（events-index 141 面），回退态单 rescan
 *     兜底即刻可派（原「红证 ② t4 回滚回声仍 DEDUP」的期望世界=无外部活动时单卡死
 *     数小时，123 号卡 3.5h 实证否决）。
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
 *   - 合并相位（202-P2 双轨，studio-dev-232，docs/17-§2）：待验收位+mergeRun 注入+触发全齐=真单刀
 *     （merge-run.ts；不齐=降级手工链/lease 顺延，重进经活动/rescan 兜底）；其余位或面关=v0 模拟；
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
 *   - seenIntentKeys 语义：DISPATCH 落账即「意图已消费」；该单出现 GATE_PASS/GATE_FAIL
 *     后键释放（成功→证据就绪走收割链；失败→回首批位可再派）；**STALL 咬合（kill 面
 *     收口锚）同样释放**（studio-dev-141：键释放≠收割结论——interrupted 单在工生命
 *     已终结，重派是新誓唤起非 replay；fake 平台 transition 产活动故旧测试经 activity
 *     通道逃生未暴露）。100 重复活动→1 次派发即此语义（同誓内口径不变）。
 *   - attempt 口径：= 该单 DISPATCH 事件计数 + 1（events 派生，可重放）。
 *   - events.level：IssueRecord.level 是流等级（0→L0 流），events.level 是 1..9 人员/公司口径——
 *     取 max(1, level)（0 级单按 1 记）。两口径混用为文档疑点，已上报不改文档。
 *   - ticket_mirror.created：IssueRecord 无 created 字段，以 updated 近似（镜像可重建，17-§3）。
 *   - HEARTBEAT 哨兵单号：events.issue 必填（contract），零动作拍挂 config.heartbeatIssue（'-'）。
 *
 * 意图消费口径（消费门=kind→handler 普适分发表，105-刀A A-2 开闸；schedule 面=v0.4 既有；
 * 129-A 扩两行=webhook｜data-change，studio-dev-166）：
 *   - 前置共闸（全 kind 一致，无 kind 特判——判负线①）：公司匹配 → 分发表命中 → 无 ticket
 *     意图缺 dedupKey=HOLD_INTENT_MALFORMED 明报拒收（25-§3.4 v1.3，判负线②）；
 *   - 分发表已开：schedule（岗单据物化）｜mention（@唤醒单物化，105-刀A）｜webhook（外部
 *     事件**只落单不派工**——终态锚点结构性不可派发，patrol 工件先例；人工分诊=平台复活；
 *     落单链收口+派工链登记位缓开=批示⑥，129-A）｜data-change（联动单物化→路由表定
 *     assignee→前向态进派发链，129-§6.1①；people-change 源与 org-config 路由表归拆单 C）；
 *     escalate 槽位归刀B notify 端口接线单，未注册即明报不支持（jobs-lifecycle 既有断言
 *     保持绿，S8）；
 *   - webhook 双链收口（129 P1-A/C9）：API 触发端点与 watch-file 同产 webhook 意图走
 *     ingest 统一链（同语义一条链）；dedupKey=事件指纹源侧设置（watch-file=mtime#行号，
 *     API=幂等键同源），引擎不猜公式只做可表示性闸；
 *   - data-change 幂等（129-§6.1 铁律2）：dedupKey=变更指纹 `person+classifier+prev→next`
 *     源侧设置，引擎消费面断言一致（防伪造换键重投——mention dedupKey=eventId 同款）；
 *     路由 fail-closed：路由未配/未命中/目标不在人事索引均明报拒收，无 defaultPersonId
 *     兜底（宁拒不错派）；
 *   - 岗单据物化形态：type='task'、level=0（走 L0 状态流——定时岗无人审批环：岗的设立即
 *     授权，每跑再挂制作人审批与 48h 无人值守矛盾）、assignee=job.role（RoleName 恰为工号则
 *     精确命中，否则回退 defaultPersonId——岗位名→工号映射待人事档案面）；
 *   - @唤醒单物化形态（105-§5.3 定稿=③ 混合语义，docs/21-§四/22-§二 同源文字）：@工号 →
 *     唤醒单直派该岗位；@宰相/@制作人 → 源侧 roles 映射成工号后同径派发（被唤醒者下游动作
 *     =对外 API :8788 落单，引擎不感知通道——两路同构）。type='task'、level=0、
 *     assignee=payload.target（必须命中人事索引——未知工号明报丢弃，防 typo 唤醒落
 *     defaultPersonId 的错人面）、title/description 携 roomId+eventId 溯源（S1）；
 *   - mention 幂等：dedupKey=Matrix eventId 源侧设置（21A-§5.10 勘误后口径，判负线③），
 *     引擎侧断言 dedupKey===payload.eventId（伪造绕幂等明报拒收）；物化层幂等=PATROL 留痕
 *     派生键集 append-only 不释放（同 eventId 重投/源重放恒只物化一次，22-§三.2）；
 *   - mention PATROL note 不含 job= 字段：jobs-sources 的 jobTickets 正则只认 job= 前缀——
 *     唤醒单对 SLA 扫描器结构性不可见（亲查 jobs-sources.ts）；note 动态字段经分号净化，
 *     防频道内容注入 job=/intent= 键（频道内容按不可信输入对待，21-§三）；
 *   - job.level/model_tier/budget_cap 落 jobs 表随行，不进 v0 派发链（模型档接线归后续刀）；
 *   - markRan 已提交而进程崩溃于 ingest 消费前：该次触发丢失（at-most-once）——已物化岗单据
 *     经活动流重启后仍被主循环接管；mention 同径（源重启按 eventId 重投可追补；E17 停机
 *     不丢意图两预案进 spike 比选不预设——105-§5.3-3）；
 *   - 分发表外 kind 仅 ticket（活动/镜像内部 kind，非源产面）明报不支持；relay/resume
 *     已开（129-E 单E，studio-dev-184——六源全通收口）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  CostGuardConfig,
  DeptNode,
  EventRecord,
  ExecutorAdapter,
  FlowPlatform,
  Handle,
  InvokeIntent,
  IssueRecord,
  ModelCatalog,
  PersonRef,
  StreamEvent,
  TaskBrief,
  TicketId,
} from '@studio-next/contract'
import {
  breakerStrikes,
  breakerTrippedAt,
  DEFAULT_FLOW_TABLE,
  emptyBreakerState,
  flowAnchors,
  onWorkerError,
  onSuccess,
  resolveTicketFlow,
  type Action,
  type BreakerState,
  type FlowTable,
} from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import { modelTierDispatchFace, resolveModelTier } from './tier/model-tier.ts'
import { gateDispatch, settleDispatch, type BudgetGateDeps } from './budget-gate.ts'
import { createLaneRegistry } from './lanes/registry.ts'
import { foldHarvestCost, writeThroughHarvestUsage } from './cost-guard/harvest.ts'
import { personDayGateInput } from './cost-guard/fold.ts'
import { crashHook } from './crash-points.ts'
// 意图分类学消费件（mention=105-刀A ｜ webhook｜data-change=129-A studio-dev-166 拆出，
// 20-§十五 尺寸门「先拆再增」）：契约面/指纹/路由解析/落单渲染+消费工厂；noteSafe 同源
// （各消费路径共用，零漂移）。公面经本文件 re-export（组合根守护测试钉「源侧产物↔契约」
// 兼容的既有口径——105-刀A checkMentionPayload 先例）。mention 消费件 129-D（181）迁入。
export {
  checkDataChangePayload,
  checkMentionPayload,
  checkWebhookPayload,
  dataChangeFingerprint,
  parseDataChangeRoutes,
  type DataChangeIntentPayload,
  type MentionIntentPayload,
  type WebhookIntentPayload,
} from './intents/taxonomy.ts'
// escalate 消费件（129-D studio-dev-181；129-§6.1② 阈值类首开——cost-threshold 类；
// 消费件装配迁 drain.ts——129-E 184 抽件，notify 端口类型经本文件 re-export 保持）
import type { CostThresholdNotice } from './intents/escalate.ts'
// 意图消费段（相位 2 前置）抽件（129-E studio-dev-184，20-§十五「先拆再增」）
import { drainIntents } from './intents/drain.ts'
export {
  checkEscalatePayload,
  costThresholdKey,
  type CostThresholdNotice,
  type EscalateIntentPayload,
} from './intents/escalate.ts'
// relay/resume 消费件（129-E 单E studio-dev-184；129-§6.1⑥ 接力/续命类——六源全通收口）：
// 消费语义（零物化重估/断点续跑计划）在 relay-resume.ts；源件在 relay-resume-sources.ts
import type { ResumeDispatchPlan } from './intents/relay-resume.ts'
import { resumeDispatchFace } from './intents/relay-resume-faces.ts'
import type { RelayWorkSignal } from './intents/relay-resume-sources.ts'
export { checkRelayPayload, checkResumePayload, pickResumeAdapter, resolveResumePlan, type RelayIntentPayload, type ResumeIntentPayload, type ResumeDispatchPlan, type ResumePlanOutcome } from './intents/relay-resume.ts'

import { createSplitMaterializer, type SplitDirectiveInput } from './split/materialize.ts' // 拆单物化件（130-P2 studio-dev-173；提案 §6.2.2/§6.2.3-R2）：批示:拆单→子单物化＋父单立案收口
import { buildEventIndex, STALL_KILL_CLOSE_ANCHOR, type EventIndex } from './sentinel/events-index.ts'
// 事件四要素形状＋人闸快照投影（自本件抽件——20-§十五「先拆再增」；BC-S2 清偿）
import { evtDept, evtLevel, personGateSnapshot, tokenBuckets } from './sentinel/shape.ts'
// 增量泵驻留竞速（DEV-9 P1 冻结修复件抽件——同上）
import { parkRace, PARKED } from './harvest/park.ts'
// 批示归一层（studio-dev-171，docs/18-§2.5；特性域 directive/＝parse/qualify 纯核＋
// wire 接线体＋serve 装配缝——20-§十五 contrib 模式子文件夹，BC-V3）
import {
  buildDirectiveAuthorizer,
  engineDirectiveDeps,
  runDirectiveLayer,
  type DirectiveAuthorizer,
  type DirectiveGateDeps,
  type DirectiveVerb,
} from './directive/index.ts'
import type { GateRunner } from './gate.ts'
import { accountJobOutput } from './jobs/output-account.ts'
import { sentinelBriefBlock, sentinelDutyForTicket, verifySidecarSentinelAtPath } from './jobs/sentinel.ts'
import { deliverablesOf, reconIssueRecord, runHarvestRecon, statHarvestDenial, WORKSPACE_UMASK, type HarvestReconResult } from './jobs/harvest-recon.ts'
import { makeUlid } from './tools/id.ts'
import { instructionsTarget, removeInstructions, writeInstructions } from './instructions-store.ts'
import { aiwsWorkspaceOf, type PromptAssembler } from './prompt-assembly.ts'
import { blindArtifactPaths, createView, resolveReadTier, roleOfAssignee } from './read-tiers.ts'
import { heartbeatSentinelRecord, runDev49Sentinels } from './sentinel/sentinels.ts'
import { mintWorkerKey, workerKeyCredentials, workerKeyGuidance, revokeWorkerKey, WORKER_WKEY_ENV_KEY } from './worker-key.ts'
import type { WorkerKeyDeps } from './worker-key.ts'
import type { HrSyncTickReport } from './hrsync/hrsync.ts'
import { closeRoomDuty, dispatchRoomDuty, type RoomDuty } from './rooms/room-duty.ts'
// 员工待办队列域件（129-§6.2，studio-dev-167 单B，20-§十五「先拆再增」自 engine.ts 拆出）：
// 排序键/携带态/成员资格/投影/配置解析全在域件；engine 只留相位缝（候选定序/人闸快照/
// 派发 note wait 锚/相位 7 尾投影重投）。
import {
  dropQueueCarry,
  orderCandidates,
  projectTodoQueue,
  queueCandidateMeta,
  queueMembership,
  seedQueueCarry,
  settlePendingQueuePriority,
  todoQueueDiffers,
  touchQueueCarry,
  type QueueCarry,
  type QueueMemberSource,
  DEFAULT_QUEUE_AGE_STEP_MS,
} from './todoqueue/queue.ts'
import { ageBoostTier } from '@studio-next/core'
import { consumePricingPublish, runPricingStaleCheck, type PricingStaleTickReport } from './pricing/pricing.ts'
import { costCloseDeps, runCostCloseTick } from './cost-close/close.ts'
import type { TickActionResult, TickDecisionEntry, TickPhaseDispatchBudget, TickPhaseHarvest, TickReport } from './tick-report/types.ts'
import { personViewOf, type QueueJudgeCandidate, type QueueJudgeHook } from './judge/sites129.ts' // 160-B 两址接线体（studio-dev-182）
import { closeOutMergeHarvest, failMergeHarvest, runMergeAction, type MergeRunHost } from './merge/merge-run.ts' // 202-P2 相位 5 合并跑机器（studio-dev-232）
import { createMergeLeaseRegistry, mergeQueueFace, renewMergeLeases } from './merge/merge-lease.ts' // 202-P4 合并租约簿（TTL+续租+死主回收）＋合并队列栏投影（studio-dev-234）
// 工作与判定域编排件（DISP-02 / IMPL-06-02 拆出；20-§十五「先拆再增」——engine 只留
// 相位缝与拍作用域闭包，判定本体仍在 core：意图受理=work/intent，开工门=work/intake，
// 状态迁移=work/transition）
import { acceptRevivals, collectWorkIntents, type WorkIntentCandidate } from './work/intent.ts'
import { decideWorkCandidate, type WorkCandidateHost } from './work/intake.ts'
import {
  applyWorkTransition,
  runApprovalTransitions,
  runCollectTransitions,
  runRecycleTransitions,
  type WorkPhaseHost,
  type WorkRecycleHost,
  type WorkTransitionHost,
} from './work/transition.ts'
export type { TickDecisionEntry, TickReport } from './tick-report/types.ts'

// 类型面归位（DISP-02 第一步：engine/tick/types.ts 解类型环；IMPL-06-01）——
// EngineConfig／Inflight／ENGINE_CONFIG_DEFAULTS 的定义迁出本文件，本文件仍是消费面
// 唯一再出口（导出名与旧导入路径零变更：serve/cli/旧测试无需改行）；本文件零配置定义。
import { type EngineConfig, type Inflight, type MergeRunDeps } from './tick/types.ts'
export { ENGINE_CONFIG_DEFAULTS, type EngineConfig, type Inflight } from './tick/types.ts'

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
  departments?: readonly DeptNode[] // 部门索引（可选注入，130-P2 studio-dev-173：父单立案 leader 解析用；缺省=立案面关闭明报，子单物化照常）
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
  /**
   * 人事同步消化器（可选注入；缺省不注入=行为零变更——DEV-48 docs/52-§9.2）：
   * 相位 7 尾每拍 drain maxHrSyncPerTick 条 hr_sync_log（补单/挂账/三面执行/重试）。
   * 装配与配置门（hrSync/hrMatrix 开关、known-secrets 脱敏闭包）见 serve.ts。
   */
  hrSync?: { drain(): Promise<HrSyncTickReport> }
  /**
   * 批示归一层（可选注入；缺省=面关行为零变更——studio-dev-171，docs/18-§2.5）：
   * 相位 1 采集尾拉评论→词表 v1 解析→角色校验→站立/打回，实现=engine/directive/
   *（wire.ts 头注）；departments 热重载经 applyCompanyUpdate 整组换。
   */
  directives?: DirectiveGateDeps
  /** 单据房间义务面（130-P3/DEV-20 P9-P10，src/engine/rooms/room-duty.ts）：派发/CLOSE 相位钩；缺省不注入=零行为变更 */
  rooms?: RoomDuty
  /** cost_guard 段（132-§6.4 单C）：快照装载面——闸四联动（R6）与源评估的配置源；缺省不注入=面关零行为 */
  costGuard?: CostGuardConfig
  /**
   * 成本警戒 notify 出口（129-§6.1②：escalate route=notify/dispatch+notify 的即时提醒
   * 通道——批示项④ busy 场景队首+即时提醒；105-刀B IM 链的登记位）。缺省不注入=留痕
   * note 记「notify=未接线」（登记位语义非承诺投递）；v0 serve 接 daemon log 行。
   */
  notify?: (notice: CostThresholdNotice) => void
  /**
   * 队列小模型精序钩子（160-B·studio-dev-182，judge/sites129.ts）：pick/interrupt 两址
   * 挂队列定序后、派发决策前的相位边缘；缺省不注入=规则缺省档行为零变（beginTick
   * 随拍清判断拍闸计数）。
   */
  judge?: QueueJudgeHook
  /**
   * 收割完成钩（可选注入；缺省不注入=零行为变更——129-E studio-dev-184）：相位 4 收割
   * 收口回调，GATE_PASS（completed）/GATE_FAIL（failed）两面都报——「worker 完成」含
   * 失败完成（F1-11 接力语义）。引擎只报事实不识源（hrSync digester 注入先例——行为缝
   * 不占主循环结构）；serve 侧闭包转发到 relay 源 publish（relay-resume-sources.ts）。
   * 钩异常进 tick errors 不炸拍（防御性 try/catch——收割面完整性优先于钩面）。
   */
  onWorkComplete?: (signal: RelayWorkSignal) => void
  mergeRun?: MergeRunDeps // 202-P2 studio-dev-232：注入=相位 5 真单刀面开；缺省=v0 模拟轨零行为
}

// ————————————————————————— TickReport（17-§2「tick 返回结构化 actions」；各面类型驻 tick-report/types.ts） —————————————————————————

// ————————————————————————— 内部状态 —————————————————————————

// Inflight（在途工位）已归位 ./tick/types.ts（DISP-02 类型环解耦，IMPL-06-01）——
// 与 EngineConfig 同面（配置＋在途状态）；本文件仍再出口（旧导入路径/导出名不变）。

/** 泳道租约簿（进程内 v0：holder=单号；TTL 到期视同无主——decide laneFree 同语义；
 * 体拆至 lanes.ts——20-§十五.三 先拆再增，studio-dev-177 单C 让位 cost-guard 缝） */

// ————————————————————————— 引擎本体 —————————————————————————

/** 引擎句柄：serve 循环每拍调 tick()；停机走 dispose()（在途 drain=优雅杀） */
export interface Engine {
  tick(): Promise<TickReport>
  /**
   * 意图注入口（22-§一 源协议在引擎侧的落点）：唤起源（v0.4=scheduler 的 schedule 源；
   * v0.5+ mention 源经组合根注入，105-刀A）把意图推入队列，下一拍 state-diff 前消费——
   * 物化/去重/决策全在 tick 内（源零直驱）。
   */
  ingest(intents: readonly InvokeIntent[]): void
  /** 队列深度（观测/测试断言：未消费意图数） */
  readonly pendingIntents: number
  /** 拆单指令注入口（130-P2 studio-dev-173：P0 归一层接线位；源零直驱同 ingest）＋队列深度观测 */
  ingestSplit(directives: readonly SplitDirectiveInput[]): void
  readonly pendingSplits: number
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
  /**
   * 州表卫生白名单热换（127-C）：缺省=不换（保持现值）；serve 挂载公司目录时**恒传
   * 显式数组**（snapshot.knownForeignStates ?? []——摘白名单=传空数组=哨兵回到全灵
   * 敏度，与 flows N1 的「缺省不换」边缘不同：白名单滞留会静默吞告警，安全面须热换
   * 即时生效）。
   */
  knownForeignStates?: readonly string[]
  /**
   * 批示归一层部门表热换（studio-dev-171，docs/18-§2.5）：path→leader 整组换——
   * 组织变动（换 leader/撤部）fail-closed 生效，防陈旧 leader 批示面。缺省=不换
   * （保持启动装配；面未开时传值也不开面——面的开闭随启动装配定）。
   */
  directives?: ReadonlyMap<string, string>
  /** cost_guard 段热换（132-§6.4 单C）：恒传（undefined=摘段关面——安全面热换即时生效） */
  costGuard: CostGuardConfig | undefined
}

const CURSOR_KEY = 'activity.cursor'
const TICK_SEQ_KEY = 'tick.seq'

// —— 增量泵收运行件（DEV-9 P1 冻结修复，docs/17-§2 拍有界；parkRace/PARKED 抽件
//    engine/harvest/park.ts——20-§十五「先拆再增」） ——

// ————————————————————————— mention 意图消费件（105-刀A A-2） —————————————————————————

export function createEngine(deps: EngineDeps): Engine {
  const { platform, ledger, registry, gateRunner, clock, config, catalog } = deps
  const makeId = deps.makeId ?? makeUlid

  // 公司面可替换绑定（docs/38-§2 L1）：applyCompanyUpdate 整组换（拍边界）——
  // people/assembler 被 resolvePerson/executeDispatch 闭包引用，let 化后热替换即生效
  let assembler = deps.assembler
  let people = deps.people
  let costGuard = deps.costGuard // cost_guard 绑定（132-§6.4 单C）：applyCompanyUpdate 恒换（含 undefined=关面）

  // 批示归一层绑定（studio-dev-171，docs/18-§2.5）：peopleRef 闭包取活名册（L1 热替换
  // 即随换——防陈旧名册放行）；defaultAssignee 与 resolvePerson 回退链同源。
  let directiveDeps = deps.directives
  let directives: DirectiveAuthorizer | undefined =
    deps.directives === undefined
      ? undefined
      : buildDirectiveAuthorizer(deps.directives, () => people, config.defaultPersonId)

  // 预算闸依赖（docs/16-§三 / 20-§六.8）：判定=core reserve/settle，落账=ledger.appendBudget，
  // 行 id=makeId（ULID，id.ts）；catalog 缺省=态 B 降级（两态见 budget-gate.ts 头注）
  const budgetDeps: BudgetGateDeps = {
    ledger,
    makeId,
    ...(deps.catalog !== undefined ? { catalog: deps.catalog } : {}),
  }

  // —— 进程内状态（持久化边界见文件头注「v0 占位」） ——
  let breaker: BreakerState = emptyBreakerState()
  const lanes = createLaneRegistry(config.laneTtlMs)
  const mergeLeases = createMergeLeaseRegistry(config.mergeLeaseTtlMs) // 202-P4 合并租约簿（per-engine——merge-run.ts 经 mergeHost 注入）
  const inflight = new Map<TicketId, Inflight>()
  const intentQueue: InvokeIntent[] = []
  const splitQueue: SplitDirectiveInput[] = []
  let seq = 0

  // worker 级 wkey（17-§7）：env 通道（TaskBrief.credentials v1.4）——凭据随 launch 进
  // 子进程 env，daemon 不留 token 副本、无在途索引面（吊销按 ticket 走 gateway，不依赖
  // 索引；workerKeys 未注入=面关闭）
  const workerKeys = deps.workerKeys
  const rooms = deps.rooms // 单据房间义务面（130-P3）：缺省=零行为
  const onWorkComplete = deps.onWorkComplete // 收割完成钩（129-E F1-11 接力产面）：缺省=零行为

  // daemon_kv：store v4 正式面（活动流游标/拍序的家——ledger.kvGet/kvSet；自建 DDL/prepared 已删，存量原地续用——文件头注「已清偿」与 migrations v4 头注）
  const seqSeed = Number.parseInt(ledger.kvGet(TICK_SEQ_KEY) ?? '0', 10)
  if (Number.isInteger(seqSeed) && seqSeed > 0) seq = seqSeed

  // —— 员工待办队列携带态（129-§6.2，studio-dev-167 单B）——
  // 首见钟是「非事件可导携带列」（jobs.last_run_at 先例）：事件面只有 DISPATCH（出队锚）无入队锚，
  // FIFO 钟只能携带。启动从 todo_queue 表种子（投影可重建，表即恢复源）；拍内 touch（种钟/抬峰）/drop
  // （派发成功即出队）；GC 收口在 projectTodoQueue（离队单删条）。回滚再入队=新钟（attempt 已可区分）。
  const queueCarry: QueueCarry = seedQueueCarry(ledger.listTodoQueue())
  // 警戒单峰值优先级延拍落地（129-D，studio-dev-181）：物化拍新单不在拍首活集——直接触钟会被投影 GC
  // 当拍删条，故只记 pending、落地拍并入携带峰（queue.ts settlePendingQueuePriority；离队即失效+15 分钟兜底）
  const pendingQueuePriority = new Map<TicketId, { priority: number; since: number }>()
  const queueAgeStepMs = config.queueAgeStepMs ?? DEFAULT_QUEUE_AGE_STEP_MS
  const pinnedTicketSet = (): ReadonlySet<TicketId> => new Set(config.pinnedTickets ?? [])
  const personOverrides = config.personInflightOverrides ?? {}
  /** 人闸帽与人闸快照（129-§6.2-R3 第四闸）：抽件 sentinel/shape.ts（显式参数版） */
  const personLimits = { overrides: personOverrides, defaultLimit: config.limits.maxInflightPerPerson ?? 1 }
  // 投影写缓存（canonical JSON——diff 才写；todo_queue 是可重建投影，写面节流观测项）
  let lastProjectedTodoQueue: string | undefined

  // ————————————————— 小构件 —————————————————

  /** 时钟（一切时刻经注入 clock——core 纪律在 daemon 侧的同形落点） */
  const now = (): number => clock()
  const mergeHost: MergeRunHost = { platform, ledger, registry, assemble: (i) => assembler(i), config, people: () => people, budgetDeps, costGuard: () => costGuard, modelTiers: catalog !== undefined ? () => catalog.tiers() : undefined, inflight, mergeRun: deps.mergeRun, mergeLease: mergeLeases, seq: () => seq, now, makeId, makeEvent, syncMirror, resolvePerson, flowOf } // 202-P2 合并跑宿主：热换绑定经 thunk 取活值；函数面声明提升安全（202-P4 增租约簿注入）

  // 事件四要素形状（evtLevel/evtDept/tokenBuckets）：抽件 sentinel/shape.ts
  //（20-§十五「先拆再增」）——evtDept 显式 deptFallback 参数版。

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
      /** 因果链锚（F1-15 续跑派发：causation_id=上次工时单 id——EventRecord 既有可选列填列非加列） */
      causation_id?: string
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
      dept: evtDept(issue, config.deptFallback),
      tokens: extra?.tokens ?? { input: 0 },
      ...(extra?.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      ...(extra?.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
      ...(extra?.size !== undefined ? { size: extra.size } : {}),
      ...(extra?.payload_hash !== undefined ? { payload_hash: extra.payload_hash } : {}),
      ...(extra?.note !== undefined ? { note: extra.note } : {}),
      ...(extra?.causation_id !== undefined ? { causation_id: extra.causation_id } : {}),
    }
    append(rec, tickEvents)
    return rec
  }

  /**
   * 状态迁移执行宿主（IMPL-06-02 拆件接线）：迁移→镜像→触发记录的顺序保证在
   * `work/transition.ts`（applyWorkTransition）；本件只把 engine 三闭包绑到本拍事件流。
   */
  const transitionHostOf = (tickEvents: EventRecord[]): WorkTransitionHost => ({
    platform,
    syncMirror,
    emit: (name, issue, attempt, extra) => makeEvent(name, issue, attempt, tickEvents, extra),
  })

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
      dept: evtDept(issue, config.deptFallback),
      level: evtLevel(issue),
      dispatcher: config.actor,
      ...(issue.parent !== undefined ? { parent: issue.parent } : {}),
      ...(issue.lane !== undefined ? { lane: issue.lane } : {}),
      // 队列归属键（129-§6.2-R3：assignee 复用不新建）——todo_queue 投影 person 列的
      // 镜像源（store v8 列）；派发侧 resolvePerson 同源链（assignee→defaultPersonId）
      ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
    })
  }

  /** 泳道租约状态（过期=死主视同无主——decide laneFree 同语义；过期判定归 decide 入参时钟） */
  function resolvePerson(issue: { assignee?: string }): PersonRef | undefined {
    return (
      (issue.assignee !== undefined ? people.find((p) => p.id === issue.assignee) : undefined) ??
      people.find((p) => p.id === config.defaultPersonId) ??
      people[0]
    )
  }

  function flowOf(issue: { type?: string; level?: number }) {
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
   *
   * resume 面（129-E studio-dev-184，F1-15）：resumePlan 在（拍作用域——drain 段 resume
   * 意图消费时登记）→ 适配器优先指名解析 plan.executor（原生续跑用同一家——session id
   * 是 executor 本地命名空间）→ 装配入参带 resume{sessionId, summaryPath, summary} →
   * 任务书续跑版（前情摘要注入，17-§5）；executor 除名/声明 session_resume=false →
   * 明报降级为新派（DISPATCH note `resume=降级新派` 锚——F1-15 字面「不支持续跑的
   * executor 明报并降级为新派」，不静默）。续跑不重置 attempt 计数（attemptOf 天然续号
   * ——断路器连击口径不被续跑洗白）；DISPATCH 事件挂 causation_id=上次工时单 id（F1-15
   * 「新工时单挂 causation_id 链到上次」——EventRecord 既有可选列填列非加列）。
   */
  async function executeDispatch(
    action: Extract<Action, { type: 'dispatch' }>,
    intentKey: string,
    index: EventIndex,
    tickEvents: EventRecord[],
    budget: TickPhaseDispatchBudget,
    resumePlan?: ResumeDispatchPlan,
  ): Promise<TickActionResult> {
    const ticket = action.ticket
    // state-diff 排队时已占泳道（决策即占用）——任何失败路径都必须归还，不留死锁
    const fail = (detail: string): TickActionResult => {
      lanes.release(action.lane, ticket)
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
    // 模型档选位（studio-dev-196）：单>岗>角色三级解析（model-tier.ts）；面关（models.yaml
    // 未装载）=tierFace undefined，选位与现行为逐字节一致。档面在 resume 面前：resume 不可
    // 续的 fallback=档位适配器（降级新派不降档——接力同档）。
    const tierResolve = resolveModelTier(
      {
        ticket,
        assignee: fresh.assignee,
        people,
        jobAnchor: index.jobAnchorOf(ticket),
        jobTierOf: (id) => ledger.getJob(id)?.model_tier,
      },
      config,
    )
    const tierFallback = registry.pick()
    const tierFace =
      tierResolve !== undefined && tierFallback !== undefined
        ? modelTierDispatchFace(registry, tierResolve.tier, tierFallback)
        : undefined
    // resume 面（129-E 单E）：指名解析优先（同一家原生续跑），不可续=明报降级走 pick 新派
    //（resumeDispatchFace 一次取齐适配器/观测锚/装配入参——faces 件，语义源 relay-resume.ts；
    // fallback=档位适配器——tier 面选位先于 resume 判定，见上）
    const resumeFace =
      resumePlan !== undefined ? resumeDispatchFace(registry, resumePlan, tierFace?.adapter ?? registry.pick()) : undefined
    const adapter =
      resumeFace !== undefined && resumeFace.adapter !== undefined
        ? resumeFace.adapter
        : (tierFace?.adapter ?? registry.pick())
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
    let prevUmask: number | undefined
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
      // 装配（L0-L5 → AGENTS.md + 任务书首版/续跑版，17-§5）与落盘（daemon 是 prompt 落盘者）。
      // resume 面（129-E）：face.assembleCtx 在场=续跑版（前情摘要注入）；降级面缺席=首版新派
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
        ...(resumeFace?.assembleCtx !== undefined ? { resume: resumeFace.assembleCtx } : {}),
      })
      // —— P3-② 权限前移（studio-dev-100 提案 §4.3-2，治 E12 于干预窗内）：工位脚手架
      //    落盘与 worker 子进程（umask 随 fork 继承）统一 0o022——产物默认 ≥0644，收割/
      //    收账面（异用户部署）可达；finally 恢复原 mask（process.umask 进程全局态，
      //    窗口=脚手架落盘→launch 返回；engine 单线程逐派发，窗内 await 无并发落盘面）——
      //    【拟稿：executor 工具面硬编码 0600 的写入不受 umask 影响，残面由收割 stat
      //    兜底（HARVEST_DENIED）如实暴露，不静默】
      prevUmask = process.umask(WORKSPACE_UMASK)
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
      // ＋定时岗产出哨兵段（127-A R1 批示③：工单型岗单注入三元组回写义务——per-attempt
      // 操作面同位；patrol 工件/普通单结构性不注入）
      const sentinelDuty = sentinelDutyForTicket(ledger, ticket)
      const briefParts = [assembled.brief.text]
      if (workerKeys !== undefined) briefParts.push(`${workerKeyGuidance()}\n`)
      if (sentinelDuty !== undefined) briefParts.push(sentinelBriefBlock(sentinelDuty))
      const briefText = briefParts.join('\n')
      writeFileSync(briefPath, briefText, 'utf8')
      const taskBrief = assembled.brief.taskBrief
      // 预算闸（TaskBrief 构造后、launch 前——20-§六.8 机制点）：估算（两态）→ reserve
      // 判定 → 过闸=双行落账（issue 先 person 后；落账与 launch 之间失败=不派，异常
      // 上抛本 catch→DISPATCH_FAIL）；超帽=refusal 行落账+不派；duplicate=沿用未结预留
      // （失败保留重派语义）。拟稿待批点清单见 src/engine/budget-gate.ts 头注。
      const personDay = personDayGateInput(costGuard, person, ledger, at) // 闸四·人日 hard 线（R6）：段声明且有 gate 档才带
      const gate = await gateDispatch(budgetDeps, {
        ticket,
        personId: person.id,
        adapter,
        taskBrief,
        briefChars: assembled.brief.text.length,
        ...(config.budgetTicketCapUsd !== undefined ? { fallbackTicketCapUsd: config.budgetTicketCapUsd } : {}),
        ...(config.budgetPersonCapUsd !== undefined ? { personCapUsd: config.budgetPersonCapUsd } : {}),
        ...(personDay !== undefined ? { personDay } : {}),
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
      lanes.acquire(action.lane, ticket, at)
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
      // 队列等待锚（129-§6.2-R4，studio-dev-167 单B）：DISPATCH note 尾携 wait/prio/boost
      // ——面板 scheduleToStart 观测面（store.recentDispatchWaitsMs 按此锚解析，正则
      // `wait=(\d+)`）；队列外直派（携带无条目——rescan 前的极端面）不携锚不误报。
      const queueEntryAtDispatch = queueCarry.get(ticket)
      const queueWaitMs =
        queueEntryAtDispatch !== undefined ? Math.max(0, at - queueEntryAtDispatch.firstSeenAt) : undefined
      const queueAnchor =
        queueEntryAtDispatch !== undefined
          ? `;wait=${queueWaitMs};prio=${queueEntryAtDispatch.priority};boost=${ageBoostTier(queueWaitMs ?? 0, queueAgeStepMs)}`
          : ''
      // resume 观测锚（129-E，F1-15「续跑派发不静默」）：note 尾锚+causation_id=上次工时单 id
      //（两形都带——因果链不因降级断；锚形见 faces 件 resumeDispatchFace 头注）
      makeEvent('DISPATCH', transitioned, attempt, tickEvents, {
        size: Buffer.byteLength(assembled.agentsMd.text, 'utf8'),
        payload_hash: `sha256:${createHash('sha256').update(assembled.agentsMd.text, 'utf8').digest('hex')}`,
        ...(resumeFace !== undefined ? { causation_id: resumeFace.causationId } : {}),
        note: `fp=${assembled.agentsMd.fingerprint};intent=${intentKey};executor=${adapter.name}@${detect.version}${tierFace?.noteAnchor ?? ''};read=${readTier};agents=${agentsTarget};brief=${briefPath};budget=${gate.kind === 'reserved' ? `reserve$${gate.estimated.toFixed(4)}` : `adopt$${gate.estimated.toFixed(4)}`}${minted !== undefined ? `;wkey=env:${WORKER_WKEY_ENV_KEY}:nonce=${minted.nonce}` : ''}${action.breakerProbe === true ? `;breaker=half-open-probe（冷却窗过——单次试探：成功即复位，失败回全开续冷却，DEV-46）` : ''}${queueAnchor}${resumeFace?.noteAnchor ?? ''}`,
      })
      // 派发成功即出队（129-§6.2）：携带条删——GATE_FAIL 回滚再入队走 touchQueueCarry
      // 新钟（attempt 轮次可区分，队列等待观测口径=每誓一钟，不跨轮累计）。
      if (queueEntryAtDispatch !== undefined) dropQueueCarry(queueCarry, [ticket])
      // 单据房间供给（130-P3/DEV-20 P9）：ensureTicketRoom；失败 ESCALATE 不阻派发（幂等重跑收敛）
      if (rooms !== undefined) await dispatchRoomDuty(rooms, { ticket, title: fresh.title, dept: fresh.dept ?? person.dept, assignee: person.id }, (note) => makeEvent('ESCALATE', transitioned, attempt, tickEvents, { note }))
      return {
        ticket,
        actionType: action.type,
        ok: true,
        detail:
          `attempt=${attempt} executor=${adapter.name} lane=${action.lane}` +
          `;budget=${gate.kind === 'reserved' ? `reserve $${gate.estimated.toFixed(4)}` : `adopt（沿用未结预留）$${gate.estimated.toFixed(4)}`}` +
          (resumeFace?.detailSegment ?? ''),
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
    } finally {
      // P3-② 权限前移窗收口：恢复派发前 umask（早退面——detect 不达标/预算拒派/launch
      // 异常——同样不泄漏全局态）
      if (prevUmask !== undefined) process.umask(prevUmask)
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
    // 合并跑位别分支（202-P2）：mergeRun 在场=合并收口（先门禁后 MERGE；平台迁移/断路/回滚位别接线）
    if (entry.mergeRun !== undefined) return closeOutMergeHarvest(mergeHost, adapter, entry, tickEvents, errors)
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
    // 132-§6.4 单C R4 即时折算：native>0 直用；否则当日取价 provisional——三面共值（缝体=cost-guard/harvest.ts）
    const harvestCost = foldHarvestCost(ledger, config.company, stats, deps.catalog !== undefined ? deps.catalog.tiers() : undefined, now())
    // —— P3-② stat 兜底（studio-dev-100 §4.3-2，治 E12）：收账面可达性体检——REPORT/
    //    deliverables 不可读即 HARVEST_DENIED 事件不静默。四要件语义冻结不动（denied 不
    //    改判 GATE_PASS/FAIL，只补可见性）；umask 前移后此面应为零，非零即残险如实上账 ——
    const denied = statHarvestDenial(entry.workspace, gate.reportPath)
    if (denied !== undefined) {
      makeEvent('HARVEST_DENIED', fresh, entry.attempt, tickEvents, {
        note: `收账面不可读（stat 兜底）→人工处置；path=${denied.path};cause=${denied.reason}`,
      })
    }

    const verdict = { completed, nonEmptyOutput, reportExists: gate.reportExists, exit0: gate.exitCode === 0 }
    const fourOk = verdict.completed && verdict.nonEmptyOutput && verdict.reportExists && verdict.exit0
    crashHook('harvest-verdict') // 崩溃注入③（F3-11）：收割四要件判定后、GATE_PASS 落账前——受控测试缝，默认零行为
    if (flow === undefined) {
      return failHarvest(entry, tickEvents, 'CONFIG_INVALID：等级未登记状态流（收割去向不可定）', verdict)
    }
    if (fourOk) {
      const anchors = flowAnchors(flow)
      const transitioned = await platform.issues.transition(ticket, anchors.evidenceReady)
      const endedAt = now()
      ledger.endWorkRecord(entry.workRecordId, {
        ended_at: endedAt,
        status: 'done',
        cost_usd: harvestCost.usd,
        tokens: stats.tokens,
        ...(stats.model !== undefined ? { model: stats.model } : {}),
        ...(gate.reportExists ? { report_ref: gate.reportPath } : {}),
        ...(gate.summaryPath !== undefined ? { summary_ref: gate.summaryPath } : {}),
        ...(entry.handle.executorSessionId !== undefined ? { executor_session_id: entry.handle.executorSessionId } : {}), // 202-P2：dsh 侧会话 id 收口（v13 列，resume 断点凭据）
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
          actual: { usd: harvestCost.usd }, // R4：结算实际=即时折算值（三面共值）
          now: now(),
        })
        budgetNote = `;budget=settle 冲销 $${settled.released.toFixed(4)} 实际 $${settled.actualUsd.toFixed(4)}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`预算结算异常 ${ticket}：${msg}`)
        budgetNote = `;budget=settle 失败（${msg}）`
      }
      // 岗产物落位收账（DEV-50，docs/04-§三）：GATE_PASS 后置步——jobs[].output 声明
      // 落点收账工位 REPORT（四要件冻结口径不动；收账失败不回滚收割，如实留痕上报）
      // ＋summary sidecar 同拷（127-A R1 批示③：哨兵随件归档——P3 对账步事实源）
      const account = accountJobOutput({
        ledger,
        ticket,
        reportPath: gate.reportPath,
        companyDir: config.companyDir,
        now,
        onProblem: (message) => errors.push(message),
        ...(gate.summaryPath !== undefined ? { summaryPath: gate.summaryPath } : {}),
      })
      // 哨兵观测（127-A R1）：工位 sidecar 即时核验——不拦收割（P3 对账步才是权威事件
      // 面），note 尾缀留痕；非岗单/patrol 工件无义务不加缀
      const harvestSentinel = sentinelDutyForTicket(ledger, ticket)
      const sentinelNote =
        harvestSentinel === undefined
          ? ''
          : `;sentinel=${verifySidecarSentinelAtPath(gate.summaryPath, harvestSentinel)}`
      // 定价更新单据化消费（132-§6.2 单B·studio-dev-169）：GATE_PASS 后置步——type='pricing'
      // 单的 deliverables/pricing.yaml 附件→解析→覆盖校验→append price_snapshots（单据号
      // 锚）。非定价单零行为；消费失败不回滚收割（DAILY_ALARM 唤醒发布岗，不静默）
      const pricingNote = consumePricingPublish({
        ledger,
        ticket,
        issueType: transitioned.type,
        workspace: entry.workspace,
        company: config.company,
        personId: entry.personId,
        declared: deps.catalog !== undefined ? deps.catalog.tiers() : undefined,
        now,
        makeId,
        emitAlarm: (note) => {
          makeEvent('DAILY_ALARM', transitioned, entry.attempt, tickEvents, { note })
        },
        onError: (message) => errors.push(message),
      }).noteSuffix
      // 相位尾缝·usage_daily write-through（132-§6.4 单C R1）：done 一格增量投影；失败不回滚（缝体=cost-guard/harvest.ts）
      const usageNote = writeThroughHarvestUsage({
        ledger, company: config.company, personId: entry.personId, workRecordId: entry.workRecordId,
        model: stats.model, tokens: stats.tokens, endedAt, makeId, onError: (message) => errors.push(message),
      })
      makeEvent('GATE_PASS', transitioned, entry.attempt, tickEvents, {
        tokens: tokenBuckets(stats),
        cost_usd: harvestCost.usd,
        duration_ms: stats.duration,
        // model 留痕走 note 后缀（132-§6.1 单A：events 列集冻结不动——`model=…` 尾缀）
        note: `四要件齐（completed/非空/REPORT/exit0）；report=${gate.reportPath}${gate.summaryPath !== undefined ? `;summary=${gate.summaryPath}` : ''}${budgetNote}${harvestCost.noteSuffix}${usageNote}${account.noteSuffix}${pricingNote}${account.sidecarSuffix}${sentinelNote}${stats.model !== undefined ? `;model=${stats.model}` : ''}`,
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
    if (entry.mergeRun !== undefined) return failMergeHarvest(mergeHost, entry, detail, tickEvents) // 202-P2 位别分支：无回滚无断路
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
    ledger.endWorkRecord(entry.workRecordId, { status: 'failed', ended_at: now(), ...(entry.handle.executorSessionId !== undefined ? { executor_session_id: entry.handle.executorSessionId } : {}) })
    inflight.delete(ticket)
    lanes.release(entry.lane, ticket)
    // 回首批位（DEFAULT_ROLLBACK_EDGES：已派发→新单；断路器停重派语义，breaker.ts 头注）——
    // 迁移与触发记录单一出口＝work/transition.ts（等级未登记流=无迁移面：只落 GATE_FAIL 留痕）
    const rollbackAnchor = flow !== undefined ? flowAnchors(flow).fresh : undefined
    const wkeyNote = wkeyDiscarded ? ';wkey=env-离场（凭据随子进程终结；重派重签新 credentials）' : ''
    const gateFailEvent = {
      name: 'GATE_FAIL' as const,
      extra: { note: `${detail};rollback=${rollbackAnchor ?? '跳过（等级未登记流）'}${wkeyNote}` },
    }
    await (rollbackAnchor !== undefined
      ? applyWorkTransition(transitionHostOf(tickEvents), { ticket, attempt: entry.attempt, toState: rollbackAnchor, event: gateFailEvent })
      : applyWorkTransition(transitionHostOf(tickEvents), { ticket, attempt: entry.attempt, carrier: fresh, event: gateFailEvent }))
    // —— P3-③ 悬空面可见（studio-dev-100 §4.3-1，94 号工况/E10）：缺 REPORT 而工位已有
    //    交付物 → HARVEST_INCOMPLETE 事件——半成品证据（deliverables 清单）进重派/回收
    //    决策视野；**不自动补收、不代写 REPORT**（补收治「写错位」不治「没写」，病根归因
    //    留给事件流——红队 R7 修订面）。attempt 作用域：每次失败收割各落一条（与 GATE_FAIL
    //    同拍性），重派续跑（att2+ 复用半成品）时决策面可见前科 ——
    if (!verdict.reportExists) {
      const deliverables = deliverablesOf(entry.workspace)
      if (deliverables !== undefined) {
        makeEvent('HARVEST_INCOMPLETE', fresh, entry.attempt, tickEvents, {
          note:
            `有产物无REPORT（悬空面）；workspace=${entry.workspace}` +
            `;deliverables=${deliverables.length}件（${deliverables.slice(0, 5).join('、')}${deliverables.length > 5 ? '…' : ''}）` +
            `；处置=进重派/回收决策（不补收不代写）`,
        })
      }
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
      dept: evtDept(fresh, config.deptFallback),
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
      lanes.release(entry.lane, ticket)
      // 回首批位（迁移与触发记录单一出口＝work/transition.ts）；等级未登记流=无迁移面
      const rollbackNote = freshAnchor ?? '跳过（等级未登记流）'
      const stallNote =
        `${silent}（第 ${nth}/${threshold} 次达阈——咬合）：${killNote}；${STALL_KILL_CLOSE_ANCHOR}（R-B 在途语义：接管≠收割，四要件不可判）；` +
        `rollback=${rollbackNote}；重派=attempt+1 经 rescan 兜底（咬合收口即释放消费键——studio-dev-141 修订：原「activity 键未释放」口径致回退态单 rescan 兜底被 DEDUP_NOOP 压制 3.5h 实证；键释放≠收割结论，GATE_FAIL/预算面不动；预算沿用 adopt 不结算）` +
        `${workerKeys !== undefined ? '；wkey=env-离场（凭据随被杀子进程终结；重派重签新 key——不吊销 ticket）' : ''}`
      const transitionHost = transitionHostOf(tickEvents)
      await (freshAnchor !== undefined
        ? applyWorkTransition(transitionHost, { ticket, attempt: workAttempt, toState: freshAnchor, event: { name: 'STALL', extra: { note: stallNote } } })
        : applyWorkTransition(transitionHost, { ticket, attempt: workAttempt, carrier: fresh, event: { name: 'STALL', extra: { note: stallNote } } }))
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
    const deadRollback = freshAnchor ?? '跳过（等级未登记流）'
    const deadNote = `${silent}（第 ${nth}/${threshold} 次达阈——咬合）：无在途句柄（工人消亡面）→ GATE_FAIL 收口；rollback=${deadRollback}；重派=attempt+1（activity 键已释放——活动驱动+rescan 双兜底）`
    const deadHost = transitionHostOf(tickEvents)
    const deadStall = await (freshAnchor !== undefined
      ? applyWorkTransition(deadHost, { ticket, attempt: workAttempt, toState: freshAnchor, event: { name: 'STALL', extra: { note: deadNote } } })
      : applyWorkTransition(deadHost, { ticket, attempt: workAttempt, carrier: fresh, event: { name: 'STALL', extra: { note: deadNote } } }))
    makeEvent('GATE_FAIL', deadStall.issue, workAttempt, tickEvents, {
      note: `${detail};rollback=${deadRollback}${workerKeys !== undefined ? ';wkey=env-离场（无活进程；重派重签新 credentials）' : ''}`,
    })
    // 遗留 running 工位收口（进程内正常链路不产生 running 无 inflight——此面来自 dispose 后
    // 继续推拍等；R-B 启动接管已收口过的查无即跳过。判定面收口=failed，与 failHarvest 同款）
    for (const rec of ledger.listWorkRecords({ issue: ticket })) {
      if (rec.status === 'running') {
        ledger.endWorkRecord(rec.id, { status: 'failed', ended_at: now() })
      }
    }
    lanes.release(fresh.lane ?? config.defaultLane, ticket)
    await strikeBreakerAndMaybeTrip(ticket, fresh, workAttempt, 'stall:worker-dead', detail, tickEvents)
    return { ticket, actionType: action.type, ok: true, detail: `咬合（消亡面）第${nth}/${threshold}次：GATE_FAIL WORKER_DEAD 收口` }
  }

  // ————————————————— tick：七相位 —————————————————

  async function tick(): Promise<TickReport> {
    seq += 1
    ledger.kvSet(TICK_SEQ_KEY, String(seq))
    const startedAt = now()
    deps.judge?.beginTick(`tick-${seq}`) // 160-B：判断拍闸计数随拍清零（invoke.ts 单B 挂主循环拍）
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
    const { alarmed: unknownStateAlarmed, foreignKnown, drift: statusSetDrift, declaredMissing: declaredStatusMissing, declaredExtra: platformStatusExtra } = await runDev49Sentinels({
      issues,
      flowOf,
      alarmedKeys: index.unknownStateAlarmed,
      foreignKnownKeys: index.foreignKnownAlarmed,
      driftKeys: index.statusSetDriftAlarmed,
      missingKeys: index.declaredStatusMissingAlarmed,
      extraKeys: index.platformStatusExtraAlarmed,
      attemptOf: index.attemptOf,
      ...(config.knownForeignStates === undefined ? {} : { knownForeignStates: config.knownForeignStates }),
      emit: (issue, attempt, note) => {
        makeEvent('ESCALATE', issue, attempt, tickEvents, { note })
      },
      emitForeignKnown: (issue, attempt, note) => {
        makeEvent('FOREIGN_KNOWN', issue, attempt, tickEvents, { note })
      },
      patrol: {
        seq,
        every: config.statusSetPatrolEveryTicks ?? 30,
        schema: () => platform.fields.schema(),
        ...(config.flows === undefined ? {} : { flows: config.flows }),
        ...(config.provisionDeclaredStates === undefined ? {} : { declared: config.provisionDeclaredStates }),
        heartbeatIssue: config.heartbeatIssue,
        deptFallback: config.deptFallback,
        at: startedAt,
      },
      onError: (msg) => {
        errors.push(msg)
      },
    })
    mutations += unknownStateAlarmed + foreignKnown + statusSetDrift + declaredStatusMissing + platformStatusExtra

    // —— 相位 1 尾：批示归一层（studio-dev-171，docs/18-§2.5；202-P1 位别两扩——
    //    dispatcher 源/验收位打回链/resume 物化，组装体=directive/wire.ts 工厂）
    const dLayer =
      directives === undefined
        ? undefined
        : await runDirectiveLayer(
            engineDirectiveDeps({
              platform, gate: directives, affected, issueById,
              directiveKeys: index.directiveKeys, attemptOf: (t) => index.attemptOf(t), flowOf,
              dispatcherOf: (t) => ledger.getTicketMirror(t)?.dispatcher,
              materializeResumeIntent: (t, cause, note) => { intentQueue.push({ kind: 'resume', company: config.company, source: 'directive', ticket: t, payload: { cause, note } }) },
              releaseLane: (t) => { lanes.release(issueById.get(t)?.lane ?? config.defaultLane, t) },
              syncMirror,
              emit: (event, issue, attempt, note) => makeEvent(event, issue, attempt, tickEvents, { note }),
              onError: (msg) => { errors.push(msg) },
            }),
          )
    const directiveReport = dLayer?.report ?? { tickets: 0, consumed: 0, rejected: 0 }
    const directiveVerbNow: ReadonlyMap<TicketId, DirectiveVerb> = dLayer?.verbsNow ?? new Map()
    mutations += dLayer?.mutations ?? 0

    // —— 相位 2 state-diff：受影响单逐个 decide（每单至多一动作；provisionalActions 供三闸） ——
    const dispatchQ: Array<{ action: Extract<Action, { type: 'dispatch' }>; intentKey: string; resumePlan?: ResumeDispatchPlan }> = [] // resumePlan=129-E 拍作用域续跑计划携带面
    const approvalQ: Array<Extract<Action, { type: 'submit_approval' }>> = []
    const collectQ: Array<Extract<Action, { type: 'collect' }>> = []
    const mergeQ: Array<Extract<Action, { type: 'merge' }>> = []
    const recycleQ: Array<Extract<Action, { type: 'recycle' }>> = []
    const stallQ: Array<Extract<Action, { type: 'stall_alarm' }>> = []
    let provisionalActions = 0

    // —— 相位 2 前置：意图队列消费（源只产意图，22-§一）——kind→handler 普适分发表 ——
    // 消费门（105-刀A A-2）：前置共闸对全 kind 一致（公司匹配 → 分发表命中 → 无 ticket
    // 意图缺 dedupKey=HOLD_INTENT_MALFORMED 明报拒收，25-§3.4 v1.3），无 kind 特判
    // （判负线①）；分发表已开 schedule｜mention（escalate 槽位归刀B notify 端口接线单）。
    const candidates: WorkIntentCandidate[] = []
    const drained = intentQueue.splice(0)
    const drainSeen = new Set<string>()

    // 意图消费段抽件 intents/drain.ts（20-§十五「先拆再增」——129-E studio-dev-184 拆出腾
    // 基线，语义逐字保持）：schedule 物化+五类消费件装配+分发表+共闸循环全在彼处；此处只
    // 注入拍作用域依赖（escalate 的 costGuard 活取热重载感知、touch 队列峰值登记同源迁入）。
    const relayResume = await drainIntents({
      drained,
      ledger,
      platform,
      syncMirror,
      makeEvent,
      tickEvents,
      config,
      people,
      ...(deps.departments !== undefined ? { departments: deps.departments } : {}),
      costGuard: (): CostGuardConfig | undefined => costGuard,
      ...(deps.notify !== undefined ? { notify: deps.notify } : {}),
      touch: (ticket, intent): void => {
        const p = Math.max(0, Math.min(3, intent.priority ?? 0))
        if (p <= 0) return
        const prev = pendingQueuePriority.get(ticket)
        pendingQueuePriority.set(ticket, { priority: Math.max(prev?.priority ?? 0, p), since: prev?.since ?? now() })
      },
      onMutation: (): void => {
        mutations += 1
      },
      errors,
      drainSeen,
      candidates,
      patrolKeys: index.patrolKeys,
      startedAt,
    })

    // —— 相位 2 前置①b：拆单指令消费（130-P2，studio-dev-173；提案 §6.2.2/§6.2.3-R2）——批示:拆单
    // ＋子单清单→物化子单（IssueCreate.parent）＋父单立案收口（leader 短持＋回执；状态零迁移走
    // 标准链）。幂等=父#序号 落 PATROL intent=split:（拍内 splitSeen＋跨拍 patrolKeys 双层）。
    const splitSeen = new Set<string>()
    const consumeSplit = createSplitMaterializer({ platform, ledger, syncMirror, makeEvent, tickEvents, config, people, departments: deps.departments, errors, patrolKeys: index.patrolKeys, splitSeen, onMutation: (): void => { mutations += 1 } })
    for (const directive of splitQueue.splice(0)) await consumeSplit(directive)

    // —— 相位 2 前置②：复活对账（DEV-42②，体=work/intent.ts acceptRevivals）——
    // closed-set 是 CLOSE 事件派生的闭集；平台侧复活（态改回流程态+评论，docs/49 复活令
    // 口径「复活均评论即可」）若无引擎侧一等语义，单据被闭集永拦——改态+评论也不进决策。
    // 复活判定=closed 单的平台态离开其流终态（交付锚点）：评论不动终态不算复活（负断言
    // 钉死）；等级未登记流者终态锚点不可知，不复活（诚实边界）。落 RESUME 事件
    // （17-§3 冻结词表内的复活锚点；REOPEN 不在词表，加名走 SCHEMA_EVOLVE 批示流）
    // → 下一拍 indexEvents 派生即出闭集（事件流序 last-write-wins，可重放）；本拍以
    // 局部闭集即时放行进决策（RESUME 也计 mutations——有账面动作的拍不落心跳）。
    const revival = acceptRevivals({
      closed: index.closed,
      issueOf: (ticket) => issueById.get(ticket),
      flowOf,
      attemptOf: (ticket) => index.attemptOf(ticket),
      emit: (issue, attempt, note) => makeEvent('RESUME', issue, attempt, tickEvents, { note }),
    })
    const closedSet = revival.closed
    const reopened = revival.reopened
    mutations += reopened

    // —— 相位 2 前置②b/③：候选补齐（活动驱动＋镜像 rescan，DEV-42①；体=work/intent.ts）——
    // 候选去重集初始化于 drain 之后（同拍一单至多一动作；relay/resume 推回的既有单恰可与
    // 本拍活动集相交——双候选=双 dispatch 状态腐坏；活动候选只补位不覆盖意图面候选）；
    // rescan 每 N 拍把非闭环（未 CLOSE）mirror 单补进候选（issues.list 全量每拍已取——
    // 零额外平台 IO），复用同一去重集；节流闸防 noop 决策日志面无界放大。
    const intake = collectWorkIntents({
      candidates,
      affected,
      issues,
      closed: closedSet,
      company: config.company,
      intentSource: config.intentSource,
      seq,
      ...(config.mirrorRescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: config.mirrorRescanEveryTicks } : {}),
    })
    const rescanned = intake.rescanned
    // —— 队列候选触钟+定序（129-§6.2，studio-dev-167 单B）——
    // 触钟（touchQueueCarry）：队列成员候选首见种 FIFO 锚、重复意图只抬峰不重种；
    // 定序（orderCandidates）：生命周期候选（收割/合并/回收链）原序在前，队列候选
    // 全局排序在后（收割回收先于新派发；每拍上限约束下高分者先过闸——129 plan §3）。
    // 镜像集外的候选（平台取不到）不触钟——拍内快照面，下一拍活动/rescan 兜底再进。
    const pinnedSet = pinnedTicketSet()
    for (const cand of candidates) {
      const issue = issueById.get(cand.ticket)
      if (issue === undefined) continue
      if (queueMembership(issue, flowOf(issue)) !== false) touchQueueCarry(queueCarry, cand.ticket, cand.intent, startedAt)
    }
    const memberOf = (ticket: TicketId): boolean => {
      const issue = issueById.get(ticket)
      return issue !== undefined && queueMembership(issue, flowOf(issue)) !== false
    }
    const metaOf = (ticket: TicketId) => queueCandidateMeta(queueCarry, ticket, pinnedSet.has(ticket), startedAt, queueAgeStepMs)
    let orderedCandidates = orderCandidates(candidates, memberOf, metaOf, config.queueRanker)
    // —— 相位 2 前置④：队列小模型精序（160-B·studio-dev-182；体=judge/sites129.ts）——
    // pick/interrupt 两址挂触钟定序后、派发决策前的相位边缘（160 §6.3）：只在非置顶队列
    // 候选内纯置换（置顶恒首·生命周期段不触·在工单结构性无入面）；降级=规则档原序。
    // 判断结果=C7「state 装配输入」口径——decide 签名零改；投影表仍走冻结公式（可重建面）。
    let judgeTick: TickReport['phases']['stateDiff']['judge']
    if (deps.judge !== undefined) {
      const queueItems = orderedCandidates.filter((c) => memberOf(c.ticket))
      const lifecycleItems = orderedCandidates.filter((c) => !memberOf(c.ticket))
      const queueViews: QueueJudgeCandidate[] = []
      for (const c of queueItems) {
        const issue = issueById.get(c.ticket)
        const meta = metaOf(c.ticket)
        if (issue === undefined) continue
        queueViews.push({
          ticket: c.ticket,
          type: issue.type ?? 'task',
          state: issue.state,
          level: issue.level ?? 0,
          priority: meta.priority,
          pinned: meta.pinned,
          boostTier: meta.boostTier,
          waitMs: startedAt - meta.firstSeenAt,
        })
      }
      // 本拍高优到达：priority≥2 的意图且种钟首见本拍（schedule=2/escalate=3 既有口径）
      const arrivals = candidates
        .filter((c) => (c.intent.priority ?? 0) >= 2 && !pinnedSet.has(c.ticket) && memberOf(c.ticket) && queueCarry.get(c.ticket)?.firstSeenAt === startedAt)
        .map((c) => ({ ticket: c.ticket, kind: c.intent.kind, priority: c.intent.priority ?? 0, source: c.intent.source }))
      const inflightViews = [...inflight.values()].map((w) => ({ ticket: w.ticket, person: w.personId, dispatchedTicksAgo: seq - w.dispatchedAtSeq }))
      const headTicket = queueViews.find((v) => !v.pinned)?.ticket
      const headIssue = headTicket !== undefined ? issueById.get(headTicket) : undefined
      const refined = await deps.judge.refine({
        queueOrdered: queueViews,
        arrivals,
        inflight: inflightViews,
        person: headIssue !== undefined ? personViewOf(resolvePerson(headIssue)) : null,
        dispatchWindowOpen: config.limits.maxActionsPerTick > 0 && inflight.size < config.limits.maxInflight,
      })
      const candByTicket = new Map(queueItems.map((c) => [c.ticket, c]))
      const permuted = refined.queueOrdered.map((v) => candByTicket.get(v.ticket))
      if (permuted.every((c) => c !== undefined)) orderedCandidates = [...lifecycleItems, ...permuted]
      else errors.push('judge 精序违背纯置换契约（候选集异动）——按规则档原序派发')
      if (refined.pick !== undefined || refined.interrupt !== undefined) judgeTick = { ...(refined.pick !== undefined ? { pick: refined.pick } : {}), ...(refined.interrupt !== undefined ? { interrupt: refined.interrupt } : {}) }
    }
    // 本拍已排队派发的人位占用（两段式先决后执——人闸快照折算面，dispatch 即记入）；
    // 必须声明在开工门宿主之前（宿主 personGateOf 闭包引用本表）
    const dispatchPersons = new Map<TicketId, string>()
    // —— 开工门快照宿主（IMPL-06-02 抽件 work/intake.ts：入参装配在彼，判定仍在 core）——
    // 人闸快照（129-§6.2-R3 第四闸——decide passGates 序冻结：断路>泳道>人>每拍>在途）：
    // 在工计数=内存 Inflight+本拍已排队派发（两段式先决后执拍内即时生效）；人不可解析=
    // 不注 gate 闸面跳过——人员配置错不是停摆理由，派发面 resolvePerson 同源失败才拒派。
    // 批示站立（studio-dev-171）：本拍归一动词优先，否则事件索引派生；approved 入参=D4
    // 清偿点：autoApprove 恒批（demo 语义保持）∥批准站立=真实批示驱动。断路快照（DEV-46
    // 半开面）：trippedAt 在册=熔断中；冷却窗进快照（缺省回退 decide 侧 30min 拟稿）——
    // 无 trippedAt 的旧形快照 decide 按 fail-closed 恒 hold（golden 旧迹兼容）。
    const workCandidateHost: WorkCandidateHost = {
      issueOf: (ticket) => issueById.get(ticket),
      fetchIssue: (ticket) => platform.issues.get(ticket).catch(() => undefined),
      flowOf,
      laneLeaseOf: (lane) => lanes.state(lane),
      personIdOf: (issue) => resolvePerson(issue)?.id,
      personGateOf: (personId) => personGateSnapshot(personId, dispatchPersons, inflight, personLimits),
      verbNowOf: (ticket) => directiveVerbNow.get(ticket) ?? index.directiveStandingOf(ticket),
      approvedNow: (verbNow) => config.autoApprove || verbNow === '批准',
      seenKeys: index.seenKeys,
      ownSeenKeyOf: (ticket, issue) => (flowOf(issue) === undefined ? null : index.seenKeyOf(ticket)),
      breakerOf: (ticket) => {
        const trippedAt = breakerTrippedAt(breaker, ticket)
        return {
          strikes: breakerStrikes(breaker, ticket),
          threshold: config.breakerThreshold,
          ...(trippedAt !== undefined ? { trippedAt } : {}),
          ...(config.breakerCooldownMs !== undefined ? { cooldownMs: config.breakerCooldownMs } : {}),
        }
      },
      onUnavailable: (ticket) => {
        errors.push(`state-diff：单 ${ticket} 平台取不到（跳过本拍）`)
      },
      defaultLane: config.defaultLane,
      limits: config.limits,
      ...(config.flows !== undefined ? { flows: config.flows } : {}),
      inflightCount: () => inflight.size + dispatchQ.length,
      tickActionCount: () => provisionalActions,
      now: () => startedAt,
      stallAfterMs: config.stallAfterMs,
    }
    for (const cand of orderedCandidates) {
      const decision = await decideWorkCandidate(workCandidateHost, cand)
      if (decision === undefined) continue
      const { ticket, issue, intentKey, action, personId } = decision
      // 5a 回弹抑制（studio-dev-171，docs/18-§2.5；判定件=directive/wire.ts）：打回/
      // 拆单/搁置站立期不自动呈批，观测面落 WAIT_APPROVAL（决策码零增删）
      if (decision.reboundSuppressed) {
        decisions.push({ ticket, intentKey, code: 'WAIT_APPROVAL', actionType: 'noop', state: issue.state })
        continue
      }
      decisions.push({ ticket, intentKey, code: action.code, actionType: action.type, state: issue.state })
      decidedActions.push(action)
      switch (action.type) {
        case 'dispatch': {
          // resume 面（129-E）：本拍 resume 意图消费登记的续跑计划随派发携带（拍作用域
          //——decide 未出 dispatch 即失效，重发意图即重试）
          const resumePlan = relayResume.planOf(ticket)
          dispatchQ.push(resumePlan !== undefined ? { action, intentKey, resumePlan } : { action, intentKey })
          provisionalActions += 1
          // 人位占用记账（同拍后续候选的人闸快照须看到——泳道占用同款决策即生效；
          // 执行失败时 executeDispatch fail() 不清 dispatchPersons——dispatchQ 派发循环
          // 即结束、下拍重算，无泄漏面）
          if (personId !== undefined) dispatchPersons.set(ticket, personId)
          // 决策即占用泳道（两段式先决后执：后续候选的 decide 须看到本拍已派的占用；
          // 执行失败时 executeDispatch 的 catch 负责释放）
          lanes.acquire(action.lane, ticket, startedAt)
          break
        }
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

    // —— 状态迁移编排宿主（IMPL-06-02 抽件 work/transition.ts：迁移→镜像→触发记录单一出口；
    //    相位执行体=呈批/复验/回收三面，错误码与事件序列逐字保持）——
    const workTransitionHost: WorkTransitionHost = transitionHostOf(tickEvents)
    const workPhaseHost: WorkPhaseHost = {
      ...workTransitionHost,
      attemptOf: (ticket) => index.attemptOf(ticket),
      flowOf,
      errors,
      actionResults,
      onMutation: () => {
        mutations += 1
      },
    }
    const roomClose =
      rooms === undefined
        ? undefined
        : async (ticket: TicketId, carrier: IssueRecord, attempt: number): Promise<void> => {
            await closeRoomDuty(rooms, ticket, (note) => {
              makeEvent('ESCALATE', carrier, attempt, tickEvents, { note })
            })
          }
    const workRecycleHost: WorkRecycleHost = {
      ...workPhaseHost,
      defaultLane: config.defaultLane,
      releaseLane: (ticket, lane) => {
        lanes.release(lane, ticket)
      },
      revokeCredential: (ticket) => revokeWorkerKey(workerKeys, ticket),
      ...(roomClose !== undefined ? { closeRoom: roomClose } : {}),
    }

    // —— 相位 3 派发：submit_approval（派发前置呈批）→ dispatch ——
    const approvals = await runApprovalTransitions(workPhaseHost, approvalQ)
    let dispatched = 0
    const budget: TickPhaseDispatchBudget = { budgetReserved: 0, budgetRefused: 0 }
    for (const { action, intentKey, resumePlan } of dispatchQ) {
      const result = await executeDispatch(action, intentKey, index, tickEvents, budget, resumePlan)
      actionResults.push(result)
      if (result.ok) {
        dispatched += 1
        mutations += 1
      } else {
        errors.push(`派发失败 ${action.ticket}：${result.detail ?? ''}`)
      }
    }

    // —— 相位 4 收割：在途 handle 检查（本拍派发的下一拍才收）→ collect 动作 → STALL 响置（DEV-44） ——
    const harvest: TickPhaseHarvest = { checked: 0, completed: 0, failed: 0, pending: 0 }
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
        // 收割完成钩（129-E，F1-11 接力产面）：completed/failed 两面都报（worker 完成含失败
        // 完成）；serve 闭包转发 relay 源；防御吞错——钩面异常不炸收割拍（errors 明报）
        if (onWorkComplete !== undefined) {
          try {
            onWorkComplete({ ticket: entry.ticket, attempt: entry.attempt, outcome, personId: entry.personId })
          } catch (err) {
            errors.push(`收割完成钩异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}（钩面不阻断收割）`)
          }
        }
      } catch (err) {
        errors.push(`收割异常 ${entry.ticket}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // 复验通过面（collect 动作；体=work/transition.ts runCollectTransitions——取拍末真态定流）
    await runCollectTransitions(workPhaseHost, collectQ)
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
    // —— 相位 4 收割尾·落位对账步（P3，studio-dev-100 提案 §4.3-1；docs/17-§2 相位内
    //    步骤——不增删相位）：PATROL job= 锚的收割成功单 × jobs[].output 声明落点 ×
    //    公司目录实际文件——缺归档=REPORT_MISSING 事件+内容哈希幂等补收（先事件后搬运；
    //    异哈希转人工绝不覆盖）。节流 N 拍一扫（全量事件扫描，量级口径同 mirrorRescan）；
    //    companyDir 未注入=面未开零行为；对账只补漏不改判（四要件/GATE 语义冻结）——
    let recon: HarvestReconResult | undefined
    const reconEvery = config.harvestReconEveryTicks ?? 30
    if (config.companyDir !== undefined && reconEvery > 0 && seq % reconEvery === 0) {
      const at = now()
      recon = runHarvestRecon({
        ledger,
        companyDir: config.companyDir,
        emit: (name, ticket, attempt, note) => {
          makeEvent(name, reconIssueRecord({ ticket, mirror: ledger.getTicketMirror(ticket), deptFallback: config.deptFallback, at }), attempt, tickEvents, { note })
        },
        onProblem: (message) => errors.push(message),
      })
      if (recon !== undefined) harvest.recon = recon
    }

    // —— 相位 5 合并（202-P2 双轨）：post-verified 验收位=真单刀（merge-run.ts：resume 唤起
    //    原会话自合并＋先门禁后 MERGE；触发不齐=降级宰相手工链/lease 顺延）；其余位=v0 模拟 ——
    let merged = 0
    renewMergeLeases(mergeHost, now()) // 202-P4 在途合并跑租约续命（每拍——长跑不被 TTL 误夺；死主=到期让道）
    const mergeWaiting: TicketId[] = [] // 合并队列栏：本拍 merge-lease-busy 顺延单（下拍重试）
    for (const action of mergeQ) {
      const r = await runMergeAction(mergeHost, action, index, tickEvents, budget, directiveVerbNow)
      actionResults.push(r.result)
      if (r.leaseBusy === true) mergeWaiting.push(action.ticket)
      if (r.deferred) continue // 占位性顺延（lease 忙/批示不在场）：不计数不上报，下一拍重进
      if (r.counted) { merged += 1; mutations += 1 } else if (r.mutated) mutations += 1
      if (!r.result.ok) errors.push(`merge 失败 ${action.ticket}：${r.result.detail ?? ''}`)
    }

    // —— 相位 6 回收：已交付 → 关单落账 + 泳道释放 + wkey 吊销（已交付为终态，无平台迁移） ——
    // 体=work/transition.ts runRecycleTransitions（17-§7 关单即吊销；DEV-28 工位原位归档；
    // 房间归档失败 ESCALATE 不阻回收——幂等重跑收敛）
    const recycled = await runRecycleTransitions(workRecycleHost, recycleQ)

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

    // —— 相位 7 尾·人事同步队列消化（DEV-48，docs/52-§9.2）：每拍消化 maxHrSyncPerTick 条 ——
    // 未注入（hrSync 配置关）=恒缺省不进报告；补单/挂账/三面执行/重试记账全在消化器内
    // （src/engine/hrsync/hrsync.ts——engine 只留相位缝，关注点分离）。
    let hrSync: HrSyncTickReport | undefined
    if (deps.hrSync !== undefined) {
      try {
        hrSync = await deps.hrSync.drain()
        mutations += hrSync.done + hrSync.failed
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`hr-sync drain 失败：${msg}`)
      }
    }

    // —— 相位 7 尾·todo_queue 投影重投（129-§6.2-R2，studio-dev-167 单B）——
    // 成员源=镜像表∩本拍平台活集（拍内迁态后 syncMirror 已落=投影看到拍末真态；
    // 平台消失单的镜像残行不产幽灵队行）。投影纯函数与判负线⑦读回核对同源（域件
    // projectTodoQueue）；diff 才写（canonical JSON——updated_at 同拍恒等，跨拍仅
    // 成员/键变才落 replaceTodoQueue 整批换）。携带 GC 也在纯函数内（离队删条）。
    const liveTickets = new Set<TicketId>(issues.map((i) => i.id))
    const mirrorRows = ledger.listTicketMirrors()
    const mirrorMemberOf = (ticket: TicketId): QueueMemberSource | undefined => {
      const row = mirrorRows.find((r) => r.issue === ticket)
      if (row === undefined) return undefined
      return { id: row.issue, state: row.state, type: row.type, level: row.level, ...(row.assignee !== undefined ? { assignee: row.assignee } : {}) }
    }
    const todoQueueMembers = mirrorRows
      .filter((r) => r.company === config.company && liveTickets.has(r.issue))
      .map((r): QueueMemberSource => ({
        id: r.issue,
        state: r.state,
        type: r.type,
        level: r.level,
        ...(r.assignee !== undefined ? { assignee: r.assignee } : {}),
      }))
    // 峰值优先级延拍落地（129-D）：物化拍记 pending，成员资格落地拍并入携带峰（queue.ts 纯函数）
    settlePendingQueuePriority({
      carry: queueCarry, pending: pendingQueuePriority, members: todoQueueMembers, mirrorMemberOf,
      flowResolve: flowOf, now: now(), staleAfterMs: 15 * 60_000,
    })
    const todoQueueRows = projectTodoQueue({
      members: todoQueueMembers,
      flowResolve: flowOf,
      personOf: (m) => resolvePerson(m)?.id,
      carry: queueCarry,
      pinnedTickets: pinnedSet,
      ageStepMs: queueAgeStepMs,
      now: now(),
      company: config.company,
    })
    if (todoQueueDiffers(lastProjectedTodoQueue, todoQueueRows)) {
      ledger.replaceTodoQueue(config.company, todoQueueRows)
      lastProjectedTodoQueue = JSON.stringify(todoQueueRows)
    }
    // 派发等待观测（129-§6.2-R5）：DISPATCH note wait 锚 SQL 读回（近 50 次）——
    // scheduleToStart 进 tick 报告（面板 inbox 挂钟观测面）。
    const scheduleWaits = ledger.recentDispatchWaitsMs(config.company, 50)
    const scheduleToStart = {
      count: scheduleWaits.length,
      avgMs: scheduleWaits.length > 0 ? Math.round(scheduleWaits.reduce((a, b) => a + b, 0) / scheduleWaits.length) : 0,
      maxMs: scheduleWaits.length > 0 ? Math.max(...scheduleWaits) : 0,
    }
    const queuePersons = new Set(todoQueueRows.map((r) => r.person)).size
    // —— 相位 7 尾·定价 stale 检查（132-§6.2 单B·studio-dev-169，P5 每晨必更守夜）：
    // 本地日 10:00 后首拍一日一跑（kv 日锚+事件 note 派生双层幂等）；stale≥2 或从未
    // 定价 → DAILY_ALARM 挂心跳哨兵单。体在 engine/pricing/pricing.ts——engine 只留缝。
    let pricingStale: PricingStaleTickReport | undefined
    try {
      pricingStale = runPricingStaleCheck({
        ledger,
        company: config.company,
        declared: deps.catalog !== undefined ? deps.catalog.tiers() : undefined,
        now,
        emitAlarm: (note) => {
          makeEvent(
            'DAILY_ALARM',
            heartbeatSentinelRecord(config.heartbeatIssue, config.deptFallback, now()),
            1,
            tickEvents,
            { note },
          )
        },
        onError: (message) => errors.push(message),
      })
      mutations += pricingStale.alarmed
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`定价 stale 检查失败：${msg}`)
    }
    const costClose = runCostCloseTick(costCloseDeps({ ledger, config, tiers: deps.catalog !== undefined ? deps.catalog.tiers() : undefined, now, makeId, makeEvent, tickEvents, errors, heartbeatSentinelRecord, bumpMutations: (n) => { mutations += n } })) // 相位7尾·日终收口 132-§6.3 单D

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
          foreignKnown,
          statusSetDrift,
          declaredStatusMissing,
          platformStatusExtra,
          directives: directiveReport,
        },
        stateDiff: { candidates: candidates.length, decisions, reopened, rescanned, queue: { rows: todoQueueRows.length, persons: queuePersons }, ...(judgeTick !== undefined ? { judge: judgeTick } : {}) },
        dispatch: {
          dispatched,
          approvals,
          results: actionResults.filter((r) => r.actionType === 'dispatch' || r.actionType === 'submit_approval'),
          budgetReserved: budget.budgetReserved,
          budgetRefused: budget.budgetRefused,
          scheduleToStart,
        },
        harvest,
        merge: { merged, queue: mergeQueueFace(mergeHost, mergeWaiting, now()) }, // 202-P4 合并队列栏（只读投影）
        recycle: { recycled },
        account: {
          eventsAppended: tickEvents.length + (hrSync?.eventsAppended ?? 0),
          heartbeat,
          ...(hrSync !== undefined ? { hrSync } : {}),
          ...(pricingStale !== undefined ? { pricingStale } : {}),
          ...(costClose.ran ? { costClose } : {}),
        },
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
    ingestSplit(directives: readonly SplitDirectiveInput[]): void { splitQueue.push(...directives) },
    get pendingSplits(): number { return splitQueue.length },
    applyCompanyUpdate(update: CompanyRuntimeUpdate): void {
      // 整组替换（不半换）：people+assembler 绑定与快照派生三键一起换——调用方保证
      // 拍边界（serve 主循环）；本方法自身纯赋值不抛，失败面归调用方前置校验
      people = update.people
      assembler = update.assembler
      costGuard = update.costGuard // 恒换（132-§6.4 单C）：摘段即关面
      config.defaultPersonId = update.defaultPersonId
      config.deptFallback = update.deptFallback
      config.defaultLane = update.defaultLane
      // 流表热换（DEV-43 N1）：缺省不换（保持现表）；换表后下一拍 decide/flowOf 对
      // 新表重解析（含在途单——跨边界未知态走既有 NOOP_UNKNOWN_STATE 纪律）
      if (update.flows !== undefined) config.flows = update.flows
      // 州表卫生白名单热换（127-C）：显式传值即换（含空数组=摘白名单——哨兵回全灵敏度）
      if (update.knownForeignStates !== undefined) config.knownForeignStates = update.knownForeignStates
      // 批示归一层部门表热换（studio-dev-171）：整组换 leader 表——组织变动
      // fail-closed；面未开（启动未注入）不因 update 开面
      if (update.directives !== undefined && directiveDeps !== undefined) {
        directiveDeps = { ...directiveDeps, departments: update.directives }
        directives = buildDirectiveAuthorizer(directiveDeps, () => people, config.defaultPersonId)
      }
    },
    dispose,
    get config(): EngineConfig {
      return config
    },
  }
  return engine
}
