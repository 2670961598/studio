/**
 * engine/runtime/create-runtime.ts —— 运行时宿主装配（原 createEngine 前段闭包状态的显式化）
 *
 * 20-§十五「按域拆件、零行为变更」：构造序与拆前逐行同序（署名校验先行→写署名→id 生成器
 *→公司面可替换绑定→批示绑定→预算闸依赖→进程内状态→队列携带态→时钟/draining/合并宿主），
 * 唯一差异是「闭包 let」变成「rt 字段」。因此：
 *   - 状态实例同一（inflight/lanes/mergeLeases/harvestBatches/队列/携带态）；
 *   - 热替换绑定（people/assembler/costGuard/directives）经 rt 字段取活值；
 *   - 宿主对象（mergeHost）经 thunk 取活值（与原注释「函数面声明提升安全」同义）。
 *
 * 依赖方向：本件是**唯一**把域函数绑上宿主的装配点；域件之间不互相 import 实现。
 */
import type { InvokeIntent, TicketId } from '@studio-next/contract'
import { emptyBreakerState } from '@studio-next/core'
import type { BudgetGateDeps } from '../budget-gate.ts'
import { buildDirectiveAuthorizer } from '../directive/index.ts'
import type { DirectiveGateDeps } from '../directive/index.ts'
import { createDrainController } from '../drain/drain.ts'
import { strikeBreakerAndMaybeTrip } from '../harvest/breaker.ts'
import { createHarvestBatchLedger } from '../harvest/batch.ts'
import { createEmploymentGateSeam } from '../hr-gate/engine-seam.ts'
import { createLaneRegistry } from '../lanes/registry.ts'
import { createMergeLeaseRegistry } from '../merge/merge-lease.ts'
import type { MergeRunHost } from '../merge/merge-run.ts'
import { wireHarvestRecordingPort } from '../harvest/records-port.ts'
import { constructEngineSignature } from '../signature/index.ts'
import type { SplitDirectiveInput } from '../split/materialize.ts'
import { DEFAULT_QUEUE_AGE_STEP_MS, seedQueueCarry, type QueueCarry } from '../todoqueue/queue.ts'
import { TICK_SEQ_KEY } from '../tick/ctx.ts'
import type { Inflight } from '../tick/types.ts'
import { makeUlid } from '../tools/id.ts'
import { emitEvent, syncMirror, transitionHostOf } from './events.ts'
import { flowOf, latestRecordOf, resolvePerson } from './flow.ts'
import type { AssignRuntime } from '../assign/auto-assign.ts'
import type { EngineDeps } from './contract.ts'
import { harvestHostOf, stallHostOf } from './hosts.ts'
import type { EngineRuntime, EngineSeams } from './types.ts'

/** 装配引擎运行时宿主（构造期一次性；零拍内副作用） */
export function createRuntime(deps: EngineDeps, seams: EngineSeams): EngineRuntime {
  const { platform, ledger, registry, gateRunner, clock, config, catalog } = deps
  const records = deps.records // 记录族生产写面（缺省 undefined＝面关；写失败不打断拍）
  // 署名构造期校验先行（SEC-FC-06）：非法署名在消费依赖/建立写路径前拒起——不降级、不补缺省。
  // 未注入＝迁移期常量（ENGINE_CONFIG_DEFAULTS.actor='daemon' 直用；缺口登记见 v2/17，
  // 审计断言归 IMPL-07-10）。全部写路径的 actor 只从 writeActor 取，不再散读 config.actor。
  const writeSignature = deps.signature === undefined ? undefined : constructEngineSignature(deps.signature)
  // 最终署名取**决定人**（SEC-FC-06/SEC-SIG-01）：system 代写取 onBehalfOf（可还原决定人，
  // 与 assembly/ops/envelope.ts `decidedByOf` 同口径）；person/control 取 actorRef。
  // actorRef 只是通道位——常量 'daemon' 因此不再作为最终署名落到任何写路径（events.actor /
  // ticket_mirror.dispatcher）；未注入＝迁移期常量直用（零行为变更）。
  const writeActor =
    writeSignature === undefined
      ? config.actor
      : writeSignature.actorKind === 'system'
        ? writeSignature.onBehalfOf
        : writeSignature.actorRef
  const makeId = deps.makeId ?? makeUlid

  // 公司面可替换绑定（docs/38-§2 L1）：applyCompanyUpdate 整组换（拍边界）——
  // people/assembler 被 resolvePerson/executeDispatch 闭包引用，let 化后热替换即生效
  const assembler = deps.assembler
  const people = deps.people
  const costGuard = deps.costGuard // cost_guard 绑定（132-§6.4 单C）：applyCompanyUpdate 恒换（含 undefined=关面）

  // 任职闸门（v2/02 §3.4；studio-dev-550）：thunk 取活名册（L1 热重载整组换 people 后零重绑）——
  // 缺省 compat（引擎直连/旧测试）；serve 恒注入 strict（缺证即拒）。事实读取/拍内观测/台账
  // 留痕/执行位兜底全在 hr-gate/，相位体只各取一处单行调用（本处=唯一装配点）。
  const hrGate = createEmploymentGateSeam({
    people: () => rt.people,
    ...(deps.hrGate !== undefined ? { mode: deps.hrGate.mode } : {}),
    ledger,
    emit: (name, issue, attempt, tickEvents, extra) => rt.makeEvent(name, issue, attempt, tickEvents, extra),
  })

  // 批示归一层绑定（studio-dev-171，docs/18-§2.5）：peopleRef 闭包取活名册（L1 热替换
  // 即随换——防陈旧名册放行）；defaultAssignee 与 resolvePerson 回退链同源。
  const directiveDeps: DirectiveGateDeps | undefined = deps.directives
  // peopleRef 取**活绑定**（rt.people——与原 let 闭包同语义：L1 热替换后资格校验面即随换，
  // 防陈旧名册放行）；构造序不变（调用期才解引用，rt 由本函数末尾装配）。
  const directives =
    deps.directives === undefined ? undefined : buildDirectiveAuthorizer(deps.directives, () => rt.people, config.defaultPersonId)

  // 预算闸依赖（docs/16-§三 / 20-§六.8）：判定=core reserve/settle，落账=ledger.appendBudget，
  // 行 id=makeId（ULID，id.ts）；catalog 缺省=态 B 降级（两态见 budget-gate.ts 头注）
  const budgetDeps: BudgetGateDeps = {
    ledger,
    makeId,
    ...(deps.catalog !== undefined ? { catalog: deps.catalog } : {}),
  }

  // —— 进程内状态（持久化边界见 engine.ts 文件头注「v0 占位」） ——
  const breaker = emptyBreakerState()
  const lanes = createLaneRegistry(config.laneTtlMs)
  const mergeLeases = createMergeLeaseRegistry(config.mergeLeaseTtlMs) // 202-P4 合并租约簿（per-engine——merge-run.ts 经 mergeHost 注入）
  const inflight = new Map<TicketId, Inflight>()
  const harvestBook = createHarvestBatchLedger() // 收割批次簿（IMPL-06-03；观测/测试只读——写口仅收割相位）
  // 收割证据端口（REC-EVD-01/02 → PORT-HIST）：注入落库口＝录制簿（封批整批原子写）；
  // 缺省不注入＝纯内存簿（旧行为零变更）。簿唯一，harvestBatches 是同一实例的消费别名。
  const harvestPort = wireHarvestRecordingPort({ book: harvestBook, sink: deps.harvestRecords, company: config.company, now: () => clock() })
  const harvestBatches = harvestPort.batches
  const intentQueue: InvokeIntent[] = []
  const splitQueue: SplitDirectiveInput[] = []
  let seq = 0
  /** 镜像 GC 首拍强制位（studio-dev-511：部署后首拍即清残行；完成一次判断后置 false） */
  let mirrorGcFirstRun = true

  // worker 级 wkey（17-§7）：env 通道（TaskBrief.credentials v1.4）——凭据随 launch 进
  // 子进程 env，daemon 不留 token 副本、无在途索引面（吊销按 ticket 走 gateway，不依赖
  // 索引；workerKeys 未注入=面关闭）
  const workerKeys = deps.workerKeys
  const rooms = deps.rooms // 单据房间义务面（130-P3）：缺省=零行为
  const onWorkComplete = deps.onWorkComplete // 收割完成钩（129-E F1-11 接力产面）：缺省=零行为
  // 执行器选择链拒派留痕去重（studio-dev-620）：每单每因一次——rescan 重派不刷屏
  const selectionRejections = new Set<string>()

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
  // draining 控制器（studio-dev-504 S2）：只置内存闸/到期强收，自然收割仍归相位 4
  const drainCtl = createDrainController({ ledger, inflight, registry, killGraceMs: config.killGraceMs, now })

  // 202-P2 合并跑宿主：热换绑定经 thunk 取活值（与原注释「函数面声明提升安全」同义——
  // 箭头体在拍内求值，rt 此时已建好；per-engine 租约簿随宿主注入 202-P4）
  const mergeHost: MergeRunHost = {
    platform,
    ledger,
    registry,
    assemble: (i) => rt.assembler(i),
    config,
    people: () => rt.people,
    budgetDeps,
    costGuard: () => rt.costGuard,
    modelTiers: catalog !== undefined ? () => catalog.tiers() : undefined,
    inflight,
    mergeRun: deps.mergeRun,
    mergeLease: mergeLeases,
    seq: () => rt.seq,
    now,
    makeId,
    makeEvent: (name, issue, attempt, tickEvents, extra) => rt.makeEvent(name, issue, attempt, tickEvents, extra),
    syncMirror: (issue) => rt.syncMirror(issue),
    resolvePerson: (issue) => rt.resolvePerson(issue),
    flowOf: (issue) => rt.flowOf(issue),
  }

  let rt: EngineRuntime
  rt = {
    // —— 依赖与外部端口 ——
    deps,
    platform,
    ledger,
    registry,
    gateRunner,
    config,
    catalog: deps.catalog,
    records,
    workerKeys,
    rooms,
    onWorkComplete,
    hrGate,
    writeActor,
    makeId,
    now,
    makeEvent: (name, issue, attempt, tickEvents, extra) => emitEvent(rt, name, issue, attempt, tickEvents, extra),
    syncMirror: (issue) => syncMirror(rt, issue),
    resolvePerson: (issue) => resolvePerson(rt, issue),
    flowOf: (issue) => flowOf(rt, issue),
    transitionHostOf: (tickEvents) => transitionHostOf(rt, tickEvents),
    harvestHostOf: (tickEvents, errors) => harvestHostOf(rt, tickEvents, errors),
    stallHostOf: (errors) => stallHostOf(rt, errors),
    latestRecordOf: (ticket) => latestRecordOf(rt, ticket),
    strikeBreaker: (ticket, fresh, attempt, signature, detail, tickEvents) =>
      strikeBreakerAndMaybeTrip(rt, ticket, fresh, attempt, signature, detail, tickEvents),
    crash: seams.crash,
    dispatchPreflight: (adapter, ticket, workspace) => seams.dispatchPreflight(adapter, ticket, workspace),
    // —— 进程内可变状态 ——
    seq,
    breaker,
    assembler,
    people,
    costGuard,
    directiveDeps,
    directives,
    mirrorGcFirstRun,
    // OBS 最后可信点下界（studio-dev-539／重出 studio-dev-617）：构造期取注入时钟，不读墙钟。
    lastCollectOkAt: clock(),
    lastProjectedTodoQueue,
    intentQueue,
    splitQueue,
    inflight,
    lanes,
    mergeLeases,
    harvestBatches,
    harvestPort,
    budgetDeps,
    drainCtl,
    queueCarry,
    pendingQueuePriority,
    queueAgeStepMs,
    personLimits,
    pinnedTicketSet,
    selectionRejections,
    assignRuntime: (): AssignRuntime => ({ people: () => rt.people, config, personLimits, inflight, ledger, platform }),
    mergeHost,
  }
  return rt
}
