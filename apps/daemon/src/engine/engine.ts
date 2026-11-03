/**
 * engine —— daemon 主循环七相位引擎（docs/17-§2，v0.5 合龙件｜组装面）
 *
 * 本文件是引擎的**唯一出口与装配面**（20-§十五「先拆再增」拆件单 studio-dev-556：
 * 1998 → ≤550 行；行为与导出面语义零漂移）：
 *   ① `createEngine` 组装：运行时宿主（runtime/create-runtime.ts）＋ Engine 对象字面量；
 *   ② 两处**顺序锚**（源侧锚测试钉死在本文件，勿迁出）：
 *      - 崩溃注入缝五点集中表 `crashSeams`（F3-11；点名/语义见 crash-points.ts）；
 *      - 派发前「seatbelt 圈定→detect」前置 `dispatchPreflight`（SEC-FC-05 后半 / 18-§一：
 *        圈定失败即抛、detect/装配/launch 零调用；DISPATCH note 的 seatbelt 审计段同源）；
 *   ③ 导出面再出口：既有导入路径（`.../engine/engine.ts`）与导出名一个不减。
 *
 * 拆件图谱（相位体逐字迁出，宿主注入=rt，见 runtime/types.ts；本文件只留装配与相位缝）：
 *   · 相位 1 采集（游标/镜像/镜像 GC/双哨/批示归一层）＝ tick/collect.ts
 *   · 相位 2 state-diff（意图消费/候选补齐/定序/精序/开工门）＝ tick/state-diff.ts
 *   · 相位 3-6（派发/收割/合并/回收）＝ tick/phases.ts；拍入口与报告＝ tick/run.ts
 *   · 派发执行体＝ dispatch/execute.ts；收割判定体/失败面＝ harvest/finalize.ts；
 *     断路链＝ harvest/breaker.ts；事件/镜像/定流小构件＝ runtime/{events,flow}.ts；
 *     生命周期面（热替换/停机）＝ runtime/lifecycle.ts；域宿主装配＝ runtime/hosts.ts
 *   · 相位 7 落账·心跳＝ tick/account.ts
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
 *   - wkey：env 通道（结构性撤离——凭据随子进程终结，daemon 不留 token 副本）；重启后
 *     CLOSE 相位照常吊销（revoke 按 ticket，不依赖索引）；dispose 不吊销在途 key
 *     （work_records 留 running——R-B 例接收口，接管单重签一 attempt 一 key）；
 *   - 重启后在途接管【R-B 已收口——serve 启动例行接管（docs/38-§2）：前命孤儿 running 工位
 *     收口 interrupted，重派走新 attempt+adopt】；活体 WORKER_DEAD 检测（17-§9）仍归 R-C 面；
 *   - 合并相位（202-P2，docs/17-§2）：mergeRun 注入×待验收位×触发全齐=真单刀（merge-run.ts；
 *     不齐=手工链/lease 顺延，重进经活动/rescan 兜底）；其余位或面关=v0 模拟；
 *   - 任务书只出首版（续跑版=上次 summary.json 前情注入，17-§5，归真单刀）；
 *   - 呈批迁移（submit_approval）：v0 直迁平台，不落事件（呈批事件名待批示；真路径=网关
 *     动作词 GW_*，v0 无网关不伪造 GW_ 事件）；
 *   - approved 输入：v0 用 config.autoApprove（demo 自动批）；真制作人批准信号经网关动作词
 *     落平台后由 daemon 归一（decide.ts 头注拟稿待批点）；
 *   - 采集增量：activity 游标增量 + issues.list 全量对账（17-§12 分页/增量优化后续）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - 游标持久化／work_records 收口【均已清偿——切 store v4 正式面】：daemon_kv 自建段与
 *     closeWorkRecord 直发 UPDATE 已删，改用 ledger.kvGet/kvSet 与 ledger.endWorkRecord
 *     （键名/值形态/语句列位与原自建/直发逐字同形；防重闸与接管关系见 migrations v4 头注）。
 *   - seenIntentKeys 语义：DISPATCH 落账即「意图已消费」；GATE_PASS/GATE_FAIL 与 STALL
 *     咬合（kill 面收口锚）均释放键——键释放≠收割结论（studio-dev-141；派生面见
 *     sentinel/events-index.ts STALL_KILL_CLOSE_ANCHOR）。100 重复活动→1 次派发即此语义。
 *   - attempt 口径：= 该单 DISPATCH 事件计数 + 1（events 派生，可重放）。
 *   - events.level：IssueRecord.level 是流等级（0→L0 流），events.level 是 1..9 人员/公司口径——
 *     取 max(1, level)（0 级单按 1 记）。两口径混用为文档疑点，已上报不改文档。
 *   - ticket_mirror.created：IssueRecord 无 created 字段，以 updated 近似（镜像可重建，17-§3）。
 *   - HEARTBEAT 哨兵单号：events.issue 必填（contract），零动作拍挂 config.heartbeatIssue（'-'）。
 *
 * 意图消费口径（kind→handler 普适分发表，六源全通）：engine 只留 splice→drainIntents→
 * candidates 相位缝——共闸（公司匹配→分发表命中→无 ticket 意图缺 dedupKey 明报拒收，
 * 无 kind 特判）、各 kind 物化/幂等/路由/at-most-once 边界逐字归拆件：
 *   - 分发表与消费装配（schedule/escalate/relay/resume 六源）：intents/drain.ts 头注；
 *   - webhook（只落单不派工）/data-change（联动单路由 fail-closed）/mention（eventId 幂等、
 *     @唤醒单溯源、PATROL note 不含 job= 的 SLA 盲区）：intents/taxonomy.ts 头注；
 *   - 岗单据物化形态（type/level/assignee 回退链）与 markRan at-most-once 边界：同上两件
 *     ＋scheduler.ts 头注；job.level/model_tier/budget_cap 随行落表面归 jobs-sources.ts。
 */
import type { ExecutorAdapter, TicketId } from '@studio-next/contract'
import { crashHook } from './crash-points.ts'
import { runTick } from './tick/run.ts'
import { applyCompanyUpdate, disposeEngine } from './runtime/lifecycle.ts'
import { createRuntime } from './runtime/create-runtime.ts'
import type { CompanyRuntimeUpdate, Engine, EngineDeps } from './runtime/contract.ts'
import type { DispatchPreflight, EngineCrashSeams, EngineRuntime } from './runtime/types.ts'
import { resolveWorkerDispatchSeatbelt, seatbeltNote } from './work/dispatch-seatbelt.ts'

// 契约面（EngineDeps／Engine／CompanyRuntimeUpdate）迁驻 runtime/contract.ts——本文件仍是
// 唯一出口：导出名与旧导入路径（.../engine/engine.ts）零变更，serve/cli/测试无需改行。
export type { CompanyRuntimeUpdate, Engine, EngineDeps } from './runtime/contract.ts'

// 类型面归位（DISP-02 第一步：engine/tick/types.ts 解类型环；IMPL-06-01）——
// EngineConfig／Inflight／ENGINE_CONFIG_DEFAULTS 的定义迁出本文件，本文件仍是消费面
// 唯一再出口（导出名与旧导入路径零变更：serve/cli/旧测试无需改行）；本文件零配置定义。
export { ENGINE_CONFIG_DEFAULTS, type EngineConfig, type Inflight } from './tick/types.ts'

// ————————————————————————— 崩溃注入缝（F3-11） —————————————————————————

/**
 * 崩溃注入缝五点集中声明（受控测试缝，未武装=零行为；点名与顺序见 crash-points.ts）。
 * 生产调用点经 rt.crash.* 由各相位/域件在**原程序点**调用：③收割判定后、④心跳写入前、
 * ⑤停机 drain 中、①②派发预留/launch 后。⑦⑧⑨ 只作注册名，不进生产代码。
 */
const crashSeams: EngineCrashSeams = {
  dispatchReserved: (): void => crashHook('dispatch-reserved'),
  dispatchLaunched: (): void => crashHook('dispatch-launched'),
  harvestVerdict: (): void => crashHook('harvest-verdict'),
  heartbeatWrite: (): void => crashHook('heartbeat-write'),
  shutdownDrain: (): void => crashHook('shutdown-drain'),
}

// ————————————————————————— 派发前圈定→detect 顺序锚 —————————————————————————

/**
 * 派发前圈定→detect 前置（SEC-FC-05 后半 / 18-§一）：**顺序即语义**——seatbelt 解析失败
 * 即抛（异常上抛派发体的同一 catch → DISPATCH_FAIL，detect/装配/launch 零调用）；detect
 * 是 launch 前必跑面（不达标明报不静默降级）。返回值供派发体使用：detect 版本/能力锚与
 * DISPATCH note 的 seatbelt 审计段（形=`;${seatbeltNote(seatbelt)}`，锚形冻结）。
 */
async function dispatchPreflight(
  rt: EngineRuntime,
  adapter: ExecutorAdapter,
  ticket: TicketId,
  workspace: string,
): Promise<DispatchPreflight> {
  // 派发域 seatbelt 圈定前置（SEC-FC-05 后半）：失败即抛 → 派发体 catch → DISPATCH_FAIL，
  // detect/装配/launch 零调用（work/dispatch-seatbelt.ts）
  const seatbelt = resolveWorkerDispatchSeatbelt({ ticket, executor: adapter.name, workspace, grant: rt.deps.dispatchSeatbelt, derivationGuard: rt.deps.derivationGuard })
  // detect 前置（18-§一：launch 前必跑；不达标明报不静默降级）
  const detect = await adapter.detect()
  return { seatbelt, detect, seatbeltSegment: `;${seatbeltNote(seatbelt)}` }
}

// ————————————————————————— 引擎本体 —————————————————————————

/** 引擎构造：装配运行时宿主 → Engine 对象字面量（状态与函数面全在 rt，见 runtime/types.ts） */
export function createEngine(deps: EngineDeps): Engine {
  const rt = createRuntime(deps, {
    crash: crashSeams,
    dispatchPreflight: (adapter, ticket, workspace) => dispatchPreflight(rt, adapter, ticket, workspace),
  })

  const engine: Engine = {
    tick: () => runTick(rt),
    ingest(intents): void {
      rt.intentQueue.push(...intents)
    },
    get pendingIntents(): number {
      return rt.intentQueue.length
    },
    ingestSplit(directives): void {
      rt.splitQueue.push(...directives)
    },
    get pendingSplits(): number {
      return rt.splitQueue.length
    },
    ingestCompanyUpdate(order: unknown): boolean {
      if (rt.companyWriteQueue === undefined) return false
      rt.companyWriteQueue.enqueue(order)
      return true
    },
    get pendingCompanyUpdates(): number {
      return rt.companyWriteQueue?.pending ?? 0
    },
    applyCompanyUpdate(update: CompanyRuntimeUpdate): void {
      applyCompanyUpdate(rt, update)
    },
    dispose: () => disposeEngine(rt),
    beginDrain(nextReason: string): void {
      rt.drainCtl.begin(nextReason)
    },
    cancelDrain(): void {
      rt.drainCtl.cancel()
    },
    get drain(): { readonly active: boolean; readonly reason: string | undefined; readonly startedAt: number | undefined } {
      return { active: rt.drainCtl.active, reason: rt.drainCtl.reason, startedAt: rt.drainCtl.startedAt }
    },
    forceSettleTimeout: () => rt.drainCtl.forceSettleTimeout(),
    get config(): Engine['config'] {
      return rt.config
    },
    get harvestBatches() {
      return rt.harvestBatches
    },
    get harvestRecordings() {
      return rt.harvestPort.recordings()
    },
  }
  return engine
}

// ————————————————————————— 导出面（既有导入路径零漂移） —————————————————————————

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
export {
  checkEscalatePayload,
  costThresholdKey,
  type CostThresholdNotice,
  type EscalateIntentPayload,
} from './intents/escalate.ts'
// relay/resume 消费件（129-E 单E studio-dev-184；129-§6.1⑥ 接力/续命类——六源全通收口）：
// 消费语义（零物化重估/断点续跑计划）在 relay-resume.ts；源件在 relay-resume-sources.ts
export { checkRelayPayload, checkResumePayload, pickResumeAdapter, resolveResumePlan, type RelayIntentPayload, type ResumeIntentPayload, type ResumeDispatchPlan, type ResumePlanOutcome } from './intents/relay-resume.ts'

// ————————————————————————— 署名构造（SEC-FC-06 / SEC-SIG-01） —————————————————————————

// 署名构造析出至 ./signature/index.ts（行数基线棘轮「先拆再增」，studio-dev-504）：本文件
// 仍再出口同名类型/函数，既有导入路径与调用面零漂移。
export { constructEngineSignature, type EngineSignature, type EngineSignatureDraft } from './signature/index.ts'

export type { TickDecisionEntry, TickReport } from './tick-report/types.ts'
