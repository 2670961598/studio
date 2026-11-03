/**
 * engine/runtime/types.ts —— 引擎运行时宿主（EngineRuntime）
 *
 * 拆分口径（20-§十五「按域拆件、零行为变更」）：原 createEngine 闭包里的**全部可变状态**
 * 与**跨域共享函数**显式抬到本接口，由 runtime/create-runtime.ts 一次装配；各域实现件
 *（tick/*、harvest/*、dispatch/*）只经 rt 读写——闭包语义逐字保持：
 *   - 状态字段是**同一个对象/同一份绑定**（Map/数组/对象引用不变，config 仍是 deps.config
 *     原地热换），因此 `rt.inflight` 与拆前 `inflight` 指向同一实例；
 *   - 读「可热替换绑定」（people/assembler/costGuard/directives）一律经 rt 字段取活值
 *     （拆前是 let 闭包，热替换即时生效——语义不变）；
 *   - seq/breaker 等标量热写经 rt 字段（拆前是 let 闭包变量）。
 *
 * 函数字段（makeEvent/syncMirror/flowOf/…）由 create-runtime 绑定到本件实现的域函数：
 * 宿主对象是**唯一装配点**，域件之间不互相 import 实现（只 import 类型与既有域件），
 * 因此无环、无第二份状态。
 */
import type {
  CostGuardConfig,
  DetectResult,
  ExecutorAdapter,
  EventRecord,
  FlowPlatform,
  InvokeIntent,
  IssueRecord,
  ModelCatalog,
  PersonRef,
  TicketId,
} from '@studio-next/contract'
import type { BreakerState, StateFlow } from '@studio-next/core'
import type { ExecutorRegistry } from '@studio-next/adapters'
import type { Ledger, WorkRecord } from '@studio-next/store'
import type { AssignRuntime } from '../assign/auto-assign.ts'
import type { BudgetGateDeps } from '../budget-gate.ts'
import type { DrainController } from '../drain/drain.ts'
import type { GateRunner } from '../gate.ts'
import type { DirectiveAuthorizer, DirectiveGateDeps } from '../directive/index.ts'
import type { HarvestAttemptHost, HarvestBatchLedger } from '../harvest/batch.ts'
import type { EmploymentGateSeam } from '../hr-gate/engine-seam.ts'
import type { LaneRegistry } from '../lanes/registry.ts'
import type { MergeLeaseRegistry } from '../merge/merge-lease.ts'
import type { MergeRunHost } from '../merge/merge-run.ts'
import type { PromptAssembler } from '../prompt-assembly.ts'
import type { QueueCarry } from '../todoqueue/queue.ts'
import type { RecordWirePort } from '../records/index.ts'
import type { RelayWorkSignal } from '../intents/relay-resume-sources.ts'
import type { RoomDuty } from '../rooms/room-duty.ts'
import type { SplitDirectiveInput } from '../split/materialize.ts'
import type { WorkerKeyDeps } from '../worker-key.ts'
import type { StallResponseHost } from '../watchdog/stall-response.ts'
import type { WorkerDispatchSeatbelt } from '../work/dispatch-seatbelt.ts'
import type { WorkTransitionHost } from '../work/transition.ts'
import type { EngineConfig, Inflight } from '../tick/types.ts'
import type { EngineDeps } from './contract.ts'

/** 事件落账附加列（EventRecord 既有可选列；填列非加列——F1-15 causation_id 同面） */
export interface EngineEventExtra {
  tokens?: EventRecord['tokens']
  cost_usd?: number
  duration_ms?: number
  size?: number
  payload_hash?: string
  note?: string
  /** 因果链锚（F1-15 续跑派发：causation_id=上次工时单 id——EventRecord 既有可选列填列非加列） */
  causation_id?: string
}

/**
 * 崩溃注入缝（F3-11）：五点冻结表的生产调用面集中声明（受控测试缝，未武装=零行为；
 * 点名与语义见 crash-points.ts，顺序=拍内程序点序）。
 */
export interface EngineCrashSeams {
  dispatchReserved(): void
  dispatchLaunched(): void
  harvestVerdict(): void
  heartbeatWrite(): void
  shutdownDrain(): void
}

/** 派发前圈定→detect 前置结果（顺序锚实现驻 engine.ts——见 dispatch/execute.ts 头注） */
export interface DispatchPreflight {
  readonly seatbelt: WorkerDispatchSeatbelt
  readonly detect: DetectResult
  /** DISPATCH note 的 seatbelt 审计段（形=`;${seatbeltNote(seatbelt)}`，锚形冻结） */
  readonly seatbeltSegment: string
}

/**
 * 引擎缝：由 engine.ts 声明、注入宿主的两处**顺序锚**（崩溃注入五点集中表 + 派发前
 * 圈定→detect 前置）。拆件后仍留在 engine.ts 是源侧锚测试的冻结要求（见 engine.ts 头注）。
 */
export interface EngineSeams {
  readonly crash: EngineCrashSeams
  readonly dispatchPreflight: (adapter: ExecutorAdapter, ticket: TicketId, workspace: string) => Promise<DispatchPreflight>
}

/**
 * 引擎运行时宿主：`createEngine` 内全部闭包状态的显式面。
 * 字段分三组：①依赖/外部端口 ②进程内可变状态 ③跨域共享函数。
 */
export interface EngineRuntime {
  // —— ① 依赖与外部端口（构造后不变） ——
  readonly deps: EngineDeps
  readonly platform: FlowPlatform
  readonly ledger: Ledger
  readonly registry: ExecutorRegistry
  readonly gateRunner: GateRunner
  readonly config: EngineConfig
  readonly catalog: ModelCatalog | undefined
  readonly records: RecordWirePort | undefined
  readonly workerKeys: WorkerKeyDeps | undefined
  readonly rooms: RoomDuty | undefined
  readonly onWorkComplete: ((signal: RelayWorkSignal) => void) | undefined
  /** 任职闸门接缝（v2/02 §3.4；create-runtime 单点装配——事实/留痕/兜底/观测） */
  readonly hrGate: EmploymentGateSeam
  /** 最终写路径署名（SEC-FC-06：system→onBehalfOf；person/control→actorRef） */
  readonly writeActor: string
  readonly makeId: (ts: number) => string
  readonly now: () => number
  /** 事件落账（appendEvent=唯一写口） */
  readonly makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: EngineEventExtra,
  ) => EventRecord
  /** ticket_mirror upsert（created 以 updated 近似——拟稿见 engine.ts 头注） */
  readonly syncMirror: (issue: IssueRecord) => void
  /** 派工对象解析链（assignee→defaultPersonId→people[0]） */
  readonly resolvePerson: (issue: { assignee?: string }) => PersonRef | undefined
  /** 定流（DEV-43 解析序与 decide 步2 同函数：T:<type> 优先→L:<level> 回退） */
  readonly flowOf: (issue: { type?: string; level?: number }) => StateFlow | undefined
  /** 状态迁移宿主（每拍事件流绑定——体=work/transition.ts） */
  readonly transitionHostOf: (tickEvents: EventRecord[]) => WorkTransitionHost
  /** 收割尝试宿主（编排体=harvest/batch.ts；判定体见 harvest/finalize.ts） */
  readonly harvestHostOf: (tickEvents: EventRecord[], errors: string[]) => HarvestAttemptHost
  /** STALL 响置宿主（响置体=watchdog/stall-response.ts） */
  readonly stallHostOf: () => StallResponseHost
  /** 该单最新工时行（work_records 按 started_at 升序取末） */
  readonly latestRecordOf: (ticket: TicketId) => WorkRecord | undefined
  /** 断路器入账+熔断链（failHarvest / STALL 响置共用单一实现） */
  readonly strikeBreaker: (
    ticket: TicketId,
    fresh: IssueRecord,
    attempt: number,
    signature: string,
    detail: string,
    tickEvents: EventRecord[],
  ) => Promise<void>
  /** 崩溃注入缝（五点集中声明，见 EngineCrashSeams） */
  readonly crash: EngineCrashSeams
  /** 派发前圈定→detect 顺序锚（实现驻 engine.ts——源侧锚测试钉死该顺序） */
  readonly dispatchPreflight: (adapter: ExecutorAdapter, ticket: TicketId, workspace: string) => Promise<DispatchPreflight>

  // —— ② 进程内可变状态（拆前 createEngine 闭包 let/const） ——
  /** 拍序（每拍 +1 并持久化 tick.seq——docs/17-§2） */
  seq: number
  breaker: BreakerState
  /** 公司面可替换绑定（docs/38-§2 L1 热重载：applyCompanyUpdate 整组换） */
  assembler: PromptAssembler
  people: readonly PersonRef[]
  costGuard: CostGuardConfig | undefined
  /** 批示归一层依赖（applyCompanyUpdate 热换部门表——studio-dev-171） */
  directiveDeps: DirectiveGateDeps | undefined
  directives: DirectiveAuthorizer | undefined
  /** 镜像 GC 首拍强制位（studio-dev-511） */
  mirrorGcFirstRun: boolean
  /** todo_queue 投影写缓存（canonical JSON——diff 才写） */
  lastProjectedTodoQueue: string | undefined
  readonly intentQueue: InvokeIntent[]
  readonly splitQueue: SplitDirectiveInput[]
  readonly inflight: Map<TicketId, Inflight>
  readonly lanes: LaneRegistry
  readonly mergeLeases: MergeLeaseRegistry
  readonly harvestBatches: HarvestBatchLedger
  readonly budgetDeps: BudgetGateDeps
  readonly drainCtl: DrainController
  readonly queueCarry: QueueCarry
  readonly pendingQueuePriority: Map<TicketId, { priority: number; since: number }>
  readonly queueAgeStepMs: number
  readonly personLimits: { overrides: NonNullable<EngineConfig['personInflightOverrides']>; defaultLimit: number }
  readonly pinnedTicketSet: () => ReadonlySet<TicketId>
  readonly assignRuntime: () => AssignRuntime
  mergeHost: MergeRunHost
}
