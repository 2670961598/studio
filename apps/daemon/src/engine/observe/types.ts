/**
 * engine/observe —— 观察面（OBS）域的类型面与写面窄契约
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：观察面挂**相位 1 采集尾**，是相位内步骤——不增删相位）；
 *   - docs/17-§6（收割四要件：观察记录不参与收割判定；「接管≠收割」——观测写失败不冒认已写）；
 *   - docs/v2/14 §二（PORT-OBS 实现域＝engine/observe＋panel/api 读面）、§1.8（reportFault 唯一写槽）；
 *   - docs/v2/08 §4.4（监控故障是一等观察；受影响视图只显示未知/受损）、§5.3（观察结束不是遗忘）；
 *   - docs/v2/11 §十二（REC-OBS-02/03/04 字段与不变量）；
 *   - plan/05 IMPL-04-08 之后的写面腿；studio-dev-539（差距项 #13：只读投影生产消费=0＋reportFault 无实现）。
 *
 * 本文件只承载**类型**与纯形状（零 IO、零运行时依赖）：write port 见 ./port.ts，拍内状态机见 ./tick.ts。
 */
import type { CallContext, FaultRef, PortResult, ProjectionFault } from '@studio-next/contract'
import type { ObservationProjectionRead, ObservationWriteReceipt, OpenObservationWatch } from '@studio-next/store'

/** 采集相位失败事实（相位 1 已捕获的失败面；观察面据此落 REC-OBS-02） */
export interface ObsCollectFailure {
  /** 失败源：活动流拉取／镜像全量取单／游标回退环 */
  readonly source: 'activity' | 'mirror-list' | 'cursor-loop'
  readonly message: string
}

/** 观察面投影故障（REC-OBS-01 读侧 fault 的窄投影；不复制六态值集——state 为 contract 值） */
export interface ObsProjectionFault {
  readonly kind: string
  readonly detail: string
}

/** 观察面投影读回（生产消费 projectObservationSnapshot 的窄形） */
export type ObsProjectionRead = ObservationProjectionRead

/** 拍内观察报告（进 TickReport.phases.collect.obs；只读观测面，不是事实源） */
export interface ObsTickReport {
  readonly view: string
  /** 本拍新落 REC-OBS-02 数 */
  readonly faultsRecorded: number
  /** 本拍新开 REC-OBS-03 数 */
  readonly watchesOpened: number
  /** 本拍 REC-OBS-04 结束数 */
  readonly watchesClosed: number
  /** 本拍结束后仍打开中的观察数 */
  readonly openWatches: number
  /** 本拍投影六态摘要（未知不补零——空 states＋snapshotFound=false 即「材料不足」） */
  readonly projection: {
    readonly snapshotFound: boolean
    readonly states: readonly { readonly face: string; readonly state: string }[]
    readonly faultKind: string | null
  }
}

/** 一拍观察步输入（引擎相位 1 已采集的事实；本步零额外平台 IO） */
export interface ObsTickInput {
  readonly seq: number
  /** 本拍开始时刻（ISO；故障发生/发现时刻下界——注入时钟） */
  readonly at: string
  /** 最后一次采集成功时刻（ISO；最后可信点时刻——不取当前时刻冒充） */
  readonly lastTrustedAt: string
  readonly cursorBefore: string | null
  readonly cursorAfter: string | null
  readonly failures: readonly ObsCollectFailure[]
}

/** 观察步结果（报告＋本拍错误行；错误行由引擎并入 TickReport.errors，fail-closed 不吞） */
export interface ObsTickOutcome {
  readonly report: ObsTickReport
  readonly errors: readonly string[]
  /** 运行面日志行（daemon 日志观测；不落台账事件——事件词表冻结 17-§3） */
  readonly logLines: readonly string[]
}

/** REC-OBS-03 写面输入（引擎侧窄形；字段语义对齐 v2/11 §十二） */
export interface ObsWatchInput {
  readonly subject: { readonly kind: string; readonly refId: string; readonly refVersion?: string }
  readonly window: { readonly declaredFrom: string; readonly declaredTo: string; readonly lastTrustedAt: string }
  readonly sightings: {
    readonly activitySignals?: readonly {
      readonly signal: string
      readonly at: string
      readonly materialRef: { readonly refId: string; readonly refVersion: string }
    }[]
    readonly credentialStatusVsRvk?: readonly string[]
    readonly independentDiscoveryChannels: readonly {
      readonly channel: string
      readonly materialRef: { readonly refId: string; readonly refVersion: string }
    }[]
  }
  readonly uncertainty: { readonly reachable: boolean; readonly treatment: string }
  readonly escalationFlag: boolean
  readonly idempotency: { readonly subjectId: string; readonly operationClass: string; readonly requesterSequence: string }
}

/** REC-OBS-04 写面输入（观察结束不是遗忘；basis/residualRisk 不得为空） */
export interface ObsClosureInput {
  readonly watchRecordId: string
  readonly basis: readonly { readonly sighting: string; readonly terminalBasis: string }[]
  readonly residualRisk: readonly string[]
  readonly retriggerTerms: string
  readonly idempotency: { readonly subjectId: string; readonly operationClass: string; readonly requesterSequence: string }
}

/** 观察写面回执（version 恒 1；重放 appended=false 即同内容幂等命中） */
export interface ObsRecordAck {
  readonly recordId: string
  readonly appended: boolean
  readonly version: 1
}

/**
 * 观察写面（PORT-OBS 写槽＋OBS 03/04 记录写面）。
 * `reportFault` 是 PORT-OBS 唯一写槽（v2/14 §1.8）；03/04 无端口槽（v2/14 端口面零新增——
 * 不改契约面），以本窄面承载，落口仍唯一经 store OBS 写面（hist.append）。
 */
export interface ObservationWritePort {
  reportFault(fault: ProjectionFault, ctx: CallContext): PortResult<FaultRef>
  /** 携显式最后可信点时刻的 reportFault（端口槽不承载 last_trusted.at——§十二；tick 步走此口） */
  reportFaultAt(fault: ProjectionFault, ctx: CallContext, lastTrustedAt: string): PortResult<FaultRef>
  recordContinuousObservation(input: ObsWatchInput, ctx: CallContext): PortResult<ObsRecordAck>
  recordObservationClosure(input: ObsClosureInput, ctx: CallContext): PortResult<ObsRecordAck>
  /** 打开中的观察（重启重建面；坏行 fail-closed） */
  openWatches(): PortResult<readonly OpenObservationWatch[]>
  /** 只读投影（生产消费；写面不据此伪造状态） */
  project(view: { readonly viewName: string; readonly faces: readonly string[] }): PortResult<ObsProjectionRead>
}

/** 拍内观察步（引擎注入面；纯依赖注入，可在测试中以 fake port 复现） */
export interface ObservationTickStep {
  observe(input: ObsTickInput): ObsTickOutcome
}

/** store OBS 写面结构（装配注入；engine 不 import store 运行体，仅类型向） */
export interface ObservationRecordWriter {
  reportFault(input: {
    readonly fault: ProjectionFault
    readonly lastTrustedAt: string
    readonly idempotency: { readonly subjectId: string; readonly operationClass: string; readonly requesterSequence: string }
  }): ObservationWriteReceipt
  recordContinuousObservation(input: ObsWatchInput): ObservationWriteReceipt
  recordObservationClosure(input: ObsClosureInput): ObservationWriteReceipt
  openWatches(): readonly OpenObservationWatch[]
  readFaults(options?: { readonly viewName?: string; readonly limit?: number }): readonly unknown[]
  project(view: { readonly viewName: string; readonly faces: readonly string[] }): ObservationProjectionRead
}

/** 写面错误判据（store ObsWriteError 的结构同形；避免 engine 侧 instanceof 跨包脆弱面） */
export interface ObsWriteErrorLike {
  readonly subcause: string
  readonly sideEffectPossible: boolean
  readonly message: string
}

export type { ObservationProjectionRead, OpenObservationWatch }
