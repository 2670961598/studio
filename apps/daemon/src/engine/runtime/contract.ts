/**
 * engine/runtime/contract.ts —— 引擎契约面（EngineDeps／Engine／CompanyRuntimeUpdate）
 *
 * 20-§十五「先拆再增」：三接口自 engine.ts 原样迁出（字段、默认值语义、注释逐字不变），
 * engine.ts 仍是唯一出口（`export type { ... }` 再出口）——既有外部导入路径
 *（`.../engine/engine.ts`）与导出名零漂移。迁出只为行数基线：本件零实现、零默认值。
 *
 * 依赖方向：本件只依赖契约/核心/适配器/存储的类型与引擎子域类型（tick/types.ts 的
 * EngineConfig／Inflight／MergeRunDeps 等），不被任何实现件反向依赖（纯类型面）。
 */
import type {
  CostGuardConfig,
  DeptNode,
  FlowPlatform,
  InvokeIntent,
  ModelCatalog,
  PersonRef,
} from '@studio-next/contract'
import type { FlowTable } from '@studio-next/core'
import type { ExecutorRegistry, SeatbeltGrant } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import type { EngineSignatureDraft } from '../signature/index.ts'
import type { HrGateOptions } from '../hr-gate/employment-gate.ts'
import type { DirectiveGateDeps } from '../directive/index.ts'
import type { GateRunner } from '../gate.ts'
import type { DrainSettleResult } from '../drain/drain.ts'
import type { PromptAssembler } from '../prompt-assembly.ts'
import type { CostThresholdNotice } from '../intents/escalate.ts'
import type { RelayWorkSignal } from '../intents/relay-resume-sources.ts'
import type { QueueJudgeHook } from '../judge/sites129.ts'
import type { HarvestBatchLedger } from '../harvest/batch.ts'
import type { HrSyncTickReport } from '../hrsync/hrsync.ts'
import type { SplitDirectiveInput } from '../split/materialize.ts'
import type { RoomDuty } from '../rooms/room-duty.ts'
import type { WorkerKeyDeps } from '../worker-key.ts'
import type { RecordWirePort } from '../records/index.ts'
import type { DispatchDerivationGuard } from '../work/dispatch-seatbelt.ts'
import type { DispatchDerivationRegistry } from '../work/derivation-registration.ts'
import type { EngineConfig, MergeRunDeps } from '../tick/types.ts'
import type { TickReport } from '../tick-report/types.ts'

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
  /**
   * 引擎写路径署名（SEC-FC-06 / SEC-SIG-01；可选注入）：`system` 必须在**构造期**携
   * `onBehalfOf`（缺省/空白/未知主体＝抛错拒起）；缺省不注入＝迁移期常量直用（零行为变更）。
   */
  signature?: EngineSignatureDraft
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
  /** 记录族生产写面（studio-dev-527；docs/17-§2 映射表）；缺省不注入＝面关零行为 */
  records?: RecordWirePort
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
  hrGate?: HrGateOptions // 任职闸门注入面（v2/02 §3.4）：缺省 compat（引擎直连/旧测试）；serve 恒注入 strict（缺证即拒）
  mergeRun?: MergeRunDeps // 202-P2 studio-dev-232：注入=相位 5 真单刀面开；缺省=v0 模拟轨零行为
  dispatchSeatbelt?: SeatbeltGrant // IMPL-07-09 派发域 seatbelt 圈定授权（省略=read-only 最严；放宽须显式授权并留痕；校验/留痕面见 work/dispatch-seatbelt.ts）
  derivationGuard?: DispatchDerivationGuard // GAP-V2-04 派生树撤回闸（省略=不拦；注入=phase-3 派发前拒已撤派生树，NEG-SEC-08/NEG-RUN-05）
  derivationRegistry?: DispatchDerivationRegistry // GAP-V2-04 S6 派发时登记（省略=不登记；注入=spawn 前 register，失败即派发失败）
  capabilitySupply?: import('../capability/index.ts').CapabilitySupplyFace // CAP 记录＋五出口决策（studio-dev-540；缺省＝面关零行为）
}

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
  // —— 受权重启 draining 面（studio-dev-504 S2；docs/17-§2 相位 3 闸，不增删相位）——
  /** 进入 draining：只关相位 3 派发闸（拍边界调用；幂等） */
  beginDrain(reason: string): void
  /** 撤销 draining（未 checkpointing 前） */
  cancelDrain(): void
  /** draining 只读观测面（tick 闸/编排判定） */
  readonly drain: { readonly active: boolean; readonly reason: string | undefined; readonly startedAt: number | undefined }
  /** 到期强收：整树杀在途 + running 收口 interrupted（不判四要件；返回如实清单） */
  forceSettleTimeout(): Promise<DrainSettleResult>
  readonly config: EngineConfig
  /** 收割批次簿观测面（IMPL-06-03 / REC-EVD-01）：只读视图；写口仅收割相位（batch.ts） */
  readonly harvestBatches: HarvestBatchLedger
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
