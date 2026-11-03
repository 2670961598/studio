/**
 * engine/observe/port —— PORT-OBS 写槽实现（`reportFault`）＋ OBS 03/04 记录写面
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（观察面挂相位 1 采集尾；相位内步骤不增删相位）、docs/17-§6（接管≠收割：
 *     观测写失败不得冒认已写——fail-closed 进拍错误面）；
 *   - docs/v2/14 §1.8（PORT-OBS.reportFault 签名：`fault ＋ CallContext → PortResult<FaultRef>`）；
 *   - docs/v2/14 §0.2（CallContext：公司维/调用者/权源/署名；写方法缺任一＝构造期非法）；
 *   - docs/v2/11 §0.2-1（生产/决定分离：观察记录的具名决定者＝观察位置，写入路径＝daemon）；
 *   - docs/v2/15 §一 SEC-FC-06（署名三值：system 代写须 onBehalfOf 可还原决定人）；
 *   - docs/v2/08 §4.4（监控故障是一等观察：写不进去＝拍错误面显式上报，不静默丢）；
 *   - docs/v2/11 §0.4-6（Err 必答副作用可能/可否重试/对账入口/责任位置）。
 *
 * 分工：本件只做**端口语义**（ctx 校验、错误分类、回执形状）；落库映射唯一经 store OBS 写面
 * （`createObservationWriteFace`——hist.append 单一写口）。本件零记录形状定义、零 IO。
 *
 * 不改契约面：`reportFault` 是 PORT-OBS 既有唯一写槽；REC-OBS-03/04 在 v2/14 端口面无写槽，
 * 故以本窄面承载（不新增端口/不新增记录类——74 类/20 端口计数不变）。
 */
import type { CallContext, FaultRef, PortFailure, PortResult, ProjectionFault } from '@studio-next/contract'
import type { ObservationProjectionRead, OpenObservationWatch } from '@studio-next/store'
import type {
  ObsClosureInput,
  ObsRecordAck,
  ObsWatchInput,
  ObservationRecordWriter,
  ObservationWritePort,
} from './types.ts'

/** 观察面责任位置（Err 必答「责任位置」——v2/11 §0.4-6） */
const RESPONSIBLE_POSITION = 'daemon/engine/observe（观察位置）'

/** 装配依赖（全注入；不读环境/墙钟） */
export interface ObservationWritePortDeps {
  /** store OBS 写面（唯一落口） */
  readonly writer: ObservationRecordWriter
  /** 公司维 slug（与 ctx.company 比对——SEC-WD-01 多公司隔离） */
  readonly company: string
  /** 具名观察位置（producer.decidedBy；须与 system 署名 onBehalfOf 一致） */
  readonly decidedBy: string
}

/** PORT-OBS 写槽＋OBS 03/04 记录写面（本文件产出） */
export function createObservationWritePort(deps: ObservationWritePortDeps): ObservationWritePort {
  const company = requireText(deps.company, 'company')
  const decidedBy = requireText(deps.decidedBy, 'decidedBy')

  const guardCtx = (ctx: CallContext): PortFailure | undefined => {
    if (ctx.company.slug !== company || ctx.company.companyId !== company) {
      return failure('rejected_precondition', 'company-mismatch', `调用公司维（${ctx.company.companyId}/${ctx.company.slug}）与本进程挂载公司 ${company} 不一致——跨公司写拒（SEC-WD-01）`, false, false)
    }
    const signature = ctx.signature
    if (signature.actorKind !== 'system') {
      return failure(
        'rejected_authority',
        'signature-not-system',
        `监控故障/观察记录须以 system 代写署名并携 onBehalfOf（可还原具名观察位置）——实得 actorKind=${signature.actorKind}（v2/15 §一 SEC-FC-06）`,
        false,
        false,
      )
    }
    if (signature.onBehalfOf !== decidedBy) {
      return failure(
        'rejected_authority',
        'observer-mismatch',
        `署名 onBehalfOf=${signature.onBehalfOf} 与装配观察位置 ${decidedBy} 不一致——不得冒名写入（§0.2-1）`,
        false,
        false,
      )
    }
    return undefined
  }

  const reportFaultAt = (fault: ProjectionFault, ctx: CallContext, lastTrustedAt: string): PortResult<FaultRef> => {
    const denied = guardCtx(ctx)
    if (denied !== undefined) return { kind: 'err', error: denied }
    try {
      const receipt = deps.writer.reportFault({
        fault,
        lastTrustedAt,
        idempotency: idempotencyOf(ctx, 'monitoring-fault', `${fault.affectedViews.map((view) => view.viewName).join(',')}:${fault.failureKind}`, `${fault.discoveredAt}`),
      })
      return {
        kind: 'ok',
        value: { recordId: receipt.recordId, version: receipt.version, recordedAs: 'projection_fault', mutatesFacts: false },
      }
    } catch (error) {
      return { kind: 'err', error: failureOf(error) }
    }
  }

  /**
   * 契约槽 `reportFault(f, ctx)`：端口形状不承载 `last_trusted.at`（§十二要求）——
   * 以故障发生时刻（`occurredAt`）为下界，不取当前时刻冒充。需要精确最后可信点时刻的
   * 调用方（拍内观察步）走 `reportFaultAt`。
   */
  const reportFault = (fault: ProjectionFault, ctx: CallContext): PortResult<FaultRef> => reportFaultAt(fault, ctx, fault.occurredAt)

  const recordContinuousObservation = (input: ObsWatchInput, ctx: CallContext): PortResult<ObsRecordAck> => {
    const denied = guardCtx(ctx)
    if (denied !== undefined) return { kind: 'err', error: denied }
    try {
      const receipt = deps.writer.recordContinuousObservation(input)
      return { kind: 'ok', value: { recordId: receipt.recordId, appended: receipt.appended, version: 1 } }
    } catch (error) {
      return { kind: 'err', error: failureOf(error) }
    }
  }

  const recordObservationClosure = (input: ObsClosureInput, ctx: CallContext): PortResult<ObsRecordAck> => {
    const denied = guardCtx(ctx)
    if (denied !== undefined) return { kind: 'err', error: denied }
    try {
      const receipt = deps.writer.recordObservationClosure(input)
      return { kind: 'ok', value: { recordId: receipt.recordId, appended: receipt.appended, version: 1 } }
    } catch (error) {
      return { kind: 'err', error: failureOf(error) }
    }
  }

  const openWatches = (): PortResult<readonly OpenObservationWatch[]> => {
    try {
      return { kind: 'ok', value: deps.writer.openWatches() }
    } catch (error) {
      return { kind: 'err', error: failureOf(error) }
    }
  }

  const project = (view: { readonly viewName: string; readonly faces: readonly string[] }): PortResult<ObservationProjectionRead> => {
    try {
      return { kind: 'ok', value: deps.writer.project(view) }
    } catch (error) {
      return { kind: 'err', error: failureOf(error) }
    }
  }

  return { reportFault, reportFaultAt, recordContinuousObservation, recordObservationClosure, openWatches, project }
}

// —— 内部小件 ——

/** 幂等三元：请求方序列＝「拍摄序列:发现时刻」——同拍重放命中既有，跨拍＝新观察（§0.4-4） */
function idempotencyOf(
  ctx: CallContext,
  operationClass: string,
  subjectId: string,
  requesterSequence: string,
): { subjectId: string; operationClass: string; requesterSequence: string } {
  const sequence = ctx.expected === undefined ? requesterSequence : `${requesterSequence}:v${ctx.expected.version}`
  return { subjectId, operationClass, requesterSequence: sequence }
}

function failure(
  category: PortFailure['category'],
  subcause: string,
  detail: string,
  retryable: boolean,
  sideEffectPossible: boolean,
): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable,
    sideEffectPossible,
    reconcile:
      sideEffectPossible
        ? { required: true, query: { recordType: 'REC-OBS-02', keys: { subcause } } }
        : { required: false, reason: '写前拒收/同 id 重放：确定未产生新记录（不发明对账面）' },
    responsiblePosition: RESPONSIBLE_POSITION,
  }
}

/** 写面异常 → 分类失败（不改原结论；副作用可能性取写面自报） */
function failureOf(error: unknown): PortFailure {
  const bag = typeof error === 'object' && error !== null ? (error as { subcause?: unknown; sideEffectPossible?: unknown; message?: unknown }) : undefined
  const subcause = typeof bag?.subcause === 'string' ? bag.subcause : 'obs:unknown'
  const message = typeof bag?.message === 'string' ? bag.message : String(error)
  const sideEffectPossible = bag?.sideEffectPossible === true
  if (subcause.startsWith('store/obs:shape-mismatch') || subcause.startsWith('store/obs:action-restriction') || subcause.startsWith('store/obs:cross-company')) {
    return failure('rejected_precondition', subcause, `${message}（形状/不变量拒收：0 行落库）`, false, false)
  }
  if (subcause.startsWith('store/obs:duplicate-conflict')) {
    return failure('conflict', subcause, `${message}（既有行未被改写；本次未写）`, false, false)
  }
  return failure('unavailable', subcause, `${message}（写口异常：须对账/重试）`, true, sideEffectPossible)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`observe/port：${field} 须为非空串（装配期 fail-closed）`)
  }
  return value
}
