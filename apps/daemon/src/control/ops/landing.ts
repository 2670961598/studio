/**
 * control/ops/landing —— PORT-OPS 控制面记录/证据面落口（REC-WORK-18；OPS 补形 A）
 *
 * 拆件动机（2026-10-29，守卫文件阈 600）：stop-channel 原兼「停机文件协议」与「PORT-OPS
 * 记录/证据面」，补形后超阈——记录/证据面拆至 control/ops/ 子域（20-§十五.三「先拆再增」）；
 * stop-channel 只留文件协议，并在文末再出口本件公共名（既有导入路径不破）。
 *
 * 依据：docs/plan/05 IMPL-06-04（emergencyStop/circuitBreak 落口=REC-WORK-18 记录/证据面）；
 * docs/v2/14 §1.8（PORT-OPS；供能链 PORT-AUTH→PORT-OPS 单向，自身不新增权源；OPS 补形 A
 * 请求形状）；docs/v2/11 §六 REC-WORK-18（trigger/boundary_ref/actions_taken/not_authorized/
 * evidence_preserved/notified/independent_review/effect_on_original）；docs/v2/15 §二
 * SEC-SIG-01（署名三值）；docs/49「OPS 补形 A」。
 *
 * 边界：零事实源读写（记录写口经 appendRecord 注入）；不执行进程终止、不裁决权源、不私设
 * 台账（生产侧接 assembly/ops → PORT-HIST 写口）。fail-closed 三闸与真实缺口语义见文内。
 */
import type {
  BreakReceipt,
  BreakTarget,
  CallContext,
  CircuitBreakRequest,
  EmergencyReview,
  EmergencyStopRequest,
  FailureCategory,
  FenceDeclaration,
  OpsAuthorization,
  OpsRecordRef,
  OpsRef,
  PortFailure,
  PortResult,
  ReconcileHandle,
  Signature,
  StopReceipt,
} from '@studio-next/contract'

// ————————————————————————— PORT-OPS 落口（IMPL-06-04 / G-PORT-OPS） —————————————————————————
//
// 依据：docs/plan/05 IMPL-06-04（emergencyStop/circuitBreak 落口=REC-WORK-18 记录/证据面）；
// docs/v2/14 §1.8（PORT-OPS；供能链 PORT-AUTH→PORT-OPS 单向，自身不新增权源；OPS 补形 A
// 请求形状）；docs/v2/11 §六 REC-WORK-18（trigger/boundary_ref/actions_taken/not_authorized/
// evidence_preserved/notified/independent_review/effect_on_original）；docs/v2/15 §二
// SEC-SIG-01（署名三值）；docs/49「OPS 补形 A」。
//
// 定位：本件是 PORT-OPS 在控制面的**记录/证据面落口**——把止损/围栏请求落成 REC-WORK-18
// 记录草案并回执；不执行进程终止、不裁决权源、不私设台账（记录写口经 appendRecord 注入，
// 生产侧接 assembly/ops → PORT-HIST 写口）。真实动作面（停注入/杀树/吊销）与其回执归后续单：
// 本件只证「记录已登记」，不证「已停」。
//
// fail-closed 三闸（任一不过＝Err：无记录、无回执、放行路径不存在）：
//   ① 供能闸：authorization 缺失/来源不明/policy verdict≠permitted/引用空白 → rejected_authority；
//   ② 署名闸：CallContext 缺、公司维/caller 空白、control 缺 decisionRef、system 缺 onBehalfOf
//      （SEC-FC-06）→ rejected_authority；
//   ③ 记录闸：REC-WORK-18 必填面缺（actions_taken 空/not_authorized 空/保全引用缺显式
//      refVersion/notified 空或匿名/复核缺失或自审/无预设边界缺升级引用/预设边界缺
//      boundaryRecordRef/围栏空集）→ rejected_precondition；记录写口失败或抛出 → unavailable
//      （sideEffectPossible=true＋reconcile——不冒 Ok）。
// 结果不明独立标记：记录面 outcome 恒 'unknown'＋reconcile（不压成布尔「已停/未停」；
// 执行确认走 break/stop 回执与独立复核）。两方法均落 REC-WORK-18 全字段；`gaps` 只列
// **真实未做/未证项**（围栏机制未证、无预设紧急边界），不再有「端口形状无槽位」缺口。

/** 匿名责任者名单（v2/11 §六：receiver 必填具名位置，不得为「框架/系统/公司」——I-11） */
const ANONYMOUS_ACTORS: readonly string[] = ['框架', '系统', '公司', 'daemon', 'framework', 'system']

/** REC-WORK-18.effect_on_original 三枚 false（不追认原动作、不等于恢复、不推广为常态） */
const EFFECT_ON_ORIGINAL = {
  retroactiveApproval: false,
  equalsRecovery: false,
  normalizable: false,
} as const

/**
 * 写口失败分类（assembly/ops 的 appendRecord 抛出时携带；本件按类回 Err 的 category）：
 * `conflict`＝同 recordId/幂等键内容不一致（未写新行）；`unavailable`＝形状拒/库异常。
 */
export interface OpsWriteFailureClass {
  readonly category: 'conflict' | 'unavailable'
  readonly subcause: string
}

/** 携带分类的写口错误（Error 原样保留 message 供对账定位） */
export interface OpsWriteError extends Error {
  readonly opsWrite: OpsWriteFailureClass
}

/** 构造带分类的写口错误（assembly/ops 用；不抛裸 Error——分类随异常走，不靠字符串猜） */
export function opsWriteError(category: OpsWriteFailureClass['category'], subcause: string, message: string): OpsWriteError {
  const error = new Error(message) as Error & { opsWrite?: OpsWriteFailureClass }
  error.opsWrite = { category, subcause }
  return error as OpsWriteError
}

/** 异常 → 分类（非 OpsWriteError 一律 unavailable——不把未知异常冒成 conflict/前置拒） */
export function classifyOpsWriteError(error: unknown): { readonly message: string; readonly opsWrite?: OpsWriteFailureClass } {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof error === 'object' && error !== null) {
    const bag = (error as { opsWrite?: unknown }).opsWrite
    if (typeof bag === 'object' && bag !== null) {
      const category = (bag as { category?: unknown }).category
      const subcause = (bag as { subcause?: unknown }).subcause
      if ((category === 'conflict' || category === 'unavailable') && typeof subcause === 'string' && subcause !== '') {
        return { message, opsWrite: { category, subcause } }
      }
    }
  }
  return { message }
}

/** REC-WORK-18 记录草案（端口形状→记录形状；字段名对齐 docs/v2/11 §六） */
export interface OpsStopRecord {
  readonly recordType: 'REC-WORK-18'
  readonly recordId: string
  readonly version: 1
  readonly company: string
  readonly at: string
  readonly kind: 'emergency_stop' | 'circuit_break'
  readonly reason: string
  readonly authorizationRef: string
  readonly trigger: string
  /** 预设紧急边界引用（RecordRef 显式版本）；null＝无预设边界（只允许不进入禁止/保留权限的保全与升级） */
  readonly boundaryRef: OpsRecordRef | null
  /** 实际处置动作（调用方给定；至少一项） */
  readonly actionsTaken: readonly [string, ...string[]]
  /** 明确未做的事（空集不得冒充「未越权」——REC-WORK-18 判定条件） */
  readonly notAuthorized: readonly [string, ...string[]]
  /** 保全物（显式版本引用） */
  readonly evidencePreserved: readonly OpsRef[]
  /** 具名接收者（显式版本引用；拒匿名） */
  readonly notified: readonly [OpsRef, ...OpsRef[]]
  /** 事后独立复核（位置/期限/结论；两方法必填） */
  readonly review: { readonly position: string; readonly due: string; readonly conclusion: string }
  readonly effectOnOriginal: typeof EFFECT_ON_ORIGINAL
  readonly outcome: 'unknown'
  /** 记录面显式缺口（只列真实未做/未证项；不列「形状无槽位」——OPS 补形 A 已闭） */
  readonly gaps: readonly string[]
  readonly signature: Signature
}

/** PORT-OPS 落口依赖（全注入；本件零事实源读写） */
export interface OpsLandingDeps {
  /** 铸记录 ID（生产=ULID；测试=确定性序列） */
  readonly makeId: () => string
  /** 记录时刻（ISO；注入时钟——不读墙钟） */
  readonly now: () => string
  /** REC-WORK-18 记录落地（生产=PORT-HIST 写口）：抛出＝未落地 → fail-closed，不冒 Ok */
  readonly appendRecord: (record: OpsStopRecord) => void
}

/** PORT-OPS 落口面（OperationsPort 的 control 实现；两方法均先过三闸再落记录） */
export interface OpsLanding {
  emergencyStop(req: EmergencyStopRequest, ctx: CallContext): PortResult<StopReceipt>
  circuitBreak(req: CircuitBreakRequest, ctx: CallContext): PortResult<BreakReceipt>
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const okOf = <T>(value: T): PortResult<T> => ({ kind: 'ok', value })
const errOf = (failure: PortFailure): PortResult<never> => ({ kind: 'err', error: failure })

/** 分类失败（v2/11 §0.4-6：Err 必答副作用可能/可否重试/对账入口/责任位置） */
function opsFailure(
  category: FailureCategory,
  subcause: string,
  detail: string,
  reconcile: ReconcileHandle,
  extra: { retryable?: boolean; sideEffectPossible?: boolean; responsiblePosition?: string } = {},
): PortFailure {
  return {
    category,
    subcause,
    detail,
    retryable: extra.retryable ?? false,
    sideEffectPossible: extra.sideEffectPossible ?? false,
    reconcile,
    responsiblePosition: extra.responsiblePosition ?? '控制面停止通道（现场责任主体）',
  }
}

/** 供能闸（PORT-AUTH→PORT-OPS 单向：只收已核验政策结论或具名决定；缺省/异源＝拒） */
type AuthCheck = { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly why: string }

function checkAuthorization(auth: OpsAuthorization | undefined): AuthCheck {
  if (auth === undefined || auth === null || typeof auth !== 'object') {
    return { ok: false, why: 'authorization 缺失（PORT-OPS 只由 PORT-AUTH 供能，自身不新增权源）' }
  }
  const a = auth as { poweredBy?: unknown; commandRef?: unknown; verdict?: unknown; decisionRef?: unknown }
  if (a.poweredBy === 'policy_verdict') {
    if (a.verdict !== 'permitted') return { ok: false, why: `政策结论非 permitted（${String(a.verdict)}）` }
    const ref = textOf(a.commandRef)
    return ref === '' ? { ok: false, why: 'policy_verdict 缺 commandRef' } : { ok: true, ref }
  }
  if (a.poweredBy === 'decision') {
    const ref = textOf(a.decisionRef)
    return ref === '' ? { ok: false, why: 'decision 缺 decisionRef' } : { ok: true, ref }
  }
  return { ok: false, why: `供能来源不明（${String(a.poweredBy)}；只收 policy_verdict|decision）` }
}

/** 署名/公司维闸（SEC-SIG-01 同构造口径：system 缺 onBehalfOf 即非法；公司维必带） */
type CtxCheck =
  | { readonly ok: true; readonly company: string; readonly signature: Signature; readonly callerId: string }
  | { readonly ok: false; readonly why: string }

function checkContext(ctx: CallContext): CtxCheck {
  if (ctx === undefined || ctx === null || typeof ctx !== 'object') return { ok: false, why: 'CallContext 缺失' }
  const company = textOf(ctx.company?.slug) !== '' ? textOf(ctx.company.slug) : textOf(ctx.company?.companyId)
  if (company === '') return { ok: false, why: '公司维缺失（SEC-WD-01）' }
  const callerId = textOf(ctx.caller?.callerId)
  if (callerId === '') return { ok: false, why: 'caller 缺失（权源主张者不可匿名）' }
  const sig = ctx.signature as unknown
  if (sig === undefined || sig === null || typeof sig !== 'object') return { ok: false, why: '署名缺失（SEC-SIG-01）' }
  const s = sig as { actorKind?: unknown; actorRef?: unknown; onBehalfOf?: unknown; decisionRef?: unknown }
  if (textOf(s.actorRef) === '') return { ok: false, why: '署名 actorRef 空白' }
  if (s.actorKind === 'system' && textOf(s.onBehalfOf) === '') {
    return { ok: false, why: 'system 署名缺 onBehalfOf（SEC-FC-06/SEC-SIG-01）——代写须可还原决定人' }
  }
  if (s.actorKind === 'control' && textOf(s.decisionRef) === '') return { ok: false, why: 'control 署名缺 decisionRef' }
  if (s.actorKind !== 'person' && s.actorKind !== 'control' && s.actorKind !== 'system') {
    return { ok: false, why: `署名主体未知（${String(s.actorKind)}）` }
  }
  return { ok: true, company, signature: ctx.signature, callerId }
}

/** 文本清单闸（actions_taken/not_authorized：逐项非空；minOne 时空集拒——空集不得冒充「已处置/未越权」） */
function textListProblem(items: unknown, what: string, opts: { minOne: boolean }): string | undefined {
  if (!Array.isArray(items)) return `${what} 非数组`
  if (opts.minOne && items.length === 0) return `${what} 为空——须逐项列全（空集不得冒充「已处置/未越权」）`
  for (const item of items as readonly unknown[]) {
    if (textOf(item) === '') return `${what} 含空白项`
  }
  return undefined
}

/** 显式版本引用闸（notified/evidence_preserved：refId 与 refVersion 都必须由调用方给——不臆造版本） */
function refListProblem(items: unknown, what: string, opts: { minOne: boolean; rejectAnonymous: boolean }): string | undefined {
  if (!Array.isArray(items)) return `${what} 非数组`
  if (opts.minOne && items.length === 0) return `${what} 为空——须逐项具名（空集不得冒充「无越权/已通知」）`
  for (const item of items as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) return `${what} 含非引用项（须为 {refId, refVersion}——裸名串缺版本，不臆造）`
    const ref = item as { refId?: unknown; refVersion?: unknown }
    const refId = textOf(ref.refId)
    if (refId === '') return `${what} 含 refId 空白项`
    if (textOf(ref.refVersion) === '') return `${what} 引用「${refId}」缺 refVersion（版本由调用方显式提供；不硬编码/不臆造）`
    if (opts.rejectAnonymous && ANONYMOUS_ACTORS.includes(refId.toLowerCase())) {
      return `${what} 含匿名责任者「${refId}」（须具名位置/工号——I-11）`
    }
  }
  return undefined
}

/** 记录引用闸（预设边界 boundaryRecordRef：refType/refId/refVersion 三键都由调用方给） */
function recordRefProblem(ref: unknown, what: string): string | undefined {
  if (typeof ref !== 'object' || ref === null) return `${what} 缺失（须为 {refType, refId, refVersion}——版本由调用方显式提供）`
  const bag = ref as { refType?: unknown; refId?: unknown; refVersion?: unknown }
  if (textOf(bag.refType) === '') return `${what}.refType 空白`
  const refId = textOf(bag.refId)
  if (refId === '') return `${what}.refId 空白`
  return textOf(bag.refVersion) === '' ? `${what}.refVersion 缺失（不硬编码/不臆造版本）` : undefined
}

/** 平台触达申报闸：有平台写＝必申报控制面动作（ctl- 词族；op 借道须降级标记） */
function touchProblem(touch: { requiresPlatformWrite?: unknown; declaration?: unknown } | undefined): string | undefined {
  if (touch === undefined || touch === null) return 'requiresPlatformWrite 缺失（PORT-OPS 每次操作须显式声明平台触达）'
  if (touch.requiresPlatformWrite === true) {
    const decl = touch.declaration as { action?: unknown; degradedBypass?: unknown } | undefined
    if (decl === undefined || typeof decl.action !== 'string' || decl.action === '') return 'requiresPlatformWrite=true 但缺控制面动作申报'
    if (decl.action === 'op') {
      return decl.degradedBypass === 'ledger_marked' ? undefined : 'op 借道须显式降级标记 degradedBypass=ledger_marked（ENU-119）'
    }
    return decl.action.startsWith('ctl-') ? undefined : `控制面动作只收 ctl- 词族（收到 ${decl.action}）——transition 不得显示为 comment`
  }
  if (touch.requiresPlatformWrite === false) {
    return touch.declaration === undefined ? undefined : '无平台写却携控制面动作申报（申报与实文不一致）'
  }
  return 'requiresPlatformWrite 非布尔'
}

/** 紧急边界闸（两态：预设边界内先行；无预设＝只能不进入禁止/保留权限的保全与升级） */
function boundaryProblem(boundary: EmergencyStopRequest['boundary']): string | undefined {
  if (boundary === undefined || boundary === null) return 'boundary 缺失（须显式两态）'
  if (boundary.preset === true) {
    if (textOf(boundary.boundaryRef) === '') return '预设边界缺 boundaryRef'
    const recordRef = recordRefProblem(boundary.boundaryRecordRef, 'boundary.boundaryRecordRef')
    if (recordRef !== undefined) return `预设边界落记录须携显式记录引用：${recordRef}`
    const permitted = boundary.permittedActions
    if (!Array.isArray(permitted) || permitted.length === 0) return '预设边界缺 permittedActions（边界内可做的事须列全）'
    for (const item of permitted as readonly unknown[]) if (textOf(item) === '') return 'permittedActions 含空白项'
    return undefined
  }
  if (boundary.preset === false) {
    if (textOf(boundary.escalationRef) === '') return '无预设边界须携 escalationRef（只能保全与升级）'
    return boundary.prohibitedAmplification === true ? undefined : '无预设边界须显式 prohibitedAmplification=true'
  }
  return 'boundary.preset 非布尔'
}

/** 独立复核闸（REC-WORK-18：位置/期限必填；复核者＝现场责任主体＝自审拒） */
function reviewProblem(review: EmergencyReview | undefined, check: { signature: Signature; callerId: string }): string | undefined {
  if (review === undefined || review === null) return 'independent_review 缺失（REC-WORK-18 必填）'
  const position = textOf(review.reviewerRef)
  if (position === '') return 'independent_review.reviewerRef 空白（复核须具名位置）'
  const signature = check.signature as unknown as { actorRef?: unknown; onBehalfOf?: unknown }
  const responsible = [textOf(signature.actorRef), textOf(signature.onBehalfOf), check.callerId]
  if (responsible.includes(position)) return '复核者=现场责任主体（自审）——独立复核须独立于现场责任人'
  return textOf(review.due) === '' ? 'independent_review.due 缺失（复核须有期限）' : undefined
}

/** 围栏目标闸（只引用既有工作/出工段/执行体，不新造对象） */
function breakTargetProblem(target: BreakTarget | undefined): string | undefined {
  if (target === undefined || target === null) return 'target 缺失'
  if (target.kind === 'work') return textOf(target.workRef) === '' ? 'target.workRef 空白' : undefined
  if (target.kind === 'segment') return textOf(target.segmentRef) === '' ? 'target.segmentRef 空白' : undefined
  if (target.kind === 'executor') return textOf(target.bindingRef) === '' ? 'target.bindingRef 空白' : undefined
  return `target.kind 未知（${String((target as { kind?: unknown }).kind)}）`
}

/** 围栏声明闸（scope 逐项列全；机制未证＝记录显式缺口，不得宣称已冻结） */
function fenceProblem(fence: FenceDeclaration | undefined): string | undefined {
  if (fence === undefined || fence === null) return 'fence 缺失（止损围栏须声明冻结面）'
  if (!Array.isArray(fence.scope) || fence.scope.length === 0) return 'fence.scope 为空——须逐项列全（空集不得冒充全量）'
  for (const item of fence.scope as readonly unknown[]) if (textOf(item) === '') return 'fence.scope 含空白项'
  if (typeof fence.stopInjection !== 'boolean' || typeof fence.revokeDerived !== 'boolean' || typeof fence.mechanismProven !== 'boolean') {
    return 'fence 三键必须为布尔（stopInjection/revokeDerived/mechanismProven）'
  }
  return undefined
}

/**
 * circuitBreak 的「明确未做」清单：调用方申报为准，再补围栏声明可直接推出的未做项
 * （不越声明范围、不追认原动作）——去重合并，不改写调用方已列项。
 */
function circuitNotAuthorized(fence: FenceDeclaration, declared: readonly [string, ...string[]]): readonly [string, ...string[]] {
  const items: [string, ...string[]] = [...declared]
  const derived: string[] = ['未追认原动作（围栏声明不构成对原动作的追认）']
  if (!fence.stopInjection) derived.push('未停止注入（fence.stopInjection=false）')
  if (!fence.revokeDerived) derived.push('未撤销派生执行体（fence.revokeDerived=false）')
  if (!fence.mechanismProven) derived.push('围栏机制未证（mechanismProven=false）——不得宣称旧写入者已被冻结')
  for (const item of derived) if (!items.includes(item)) items.push(item)
  return items
}

/** 铸记录 ID＋时戳（依赖面异常＝fail-closed；不裸抛——落分类 Err） */
function stampOf(deps: OpsLandingDeps): { recordId: string; at: string } | undefined {
  try {
    return { recordId: deps.makeId(), at: deps.now() }
  } catch {
    return undefined
  }
}

/** 记录落地结果（写口失败＝fail-closed；写口成功后回执才成立；分类随异常走） */
type LandOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly opsWrite?: OpsWriteFailureClass }

function landRecord(deps: OpsLandingDeps, record: OpsStopRecord): LandOutcome {
  try {
    deps.appendRecord(record)
    return { ok: true }
  } catch (error) {
    return { ok: false, ...classifyOpsWriteError(error) }
  }
}

/** 记录未落地回执（类别取写口分类：conflict＝同 id 异内容；其余 unavailable——不冒 Ok） */
function unlandedFailure(op: 'emergencyStop' | 'circuitBreak', recordId: string, failure: Exclude<LandOutcome, { ok: true }>): PortFailure {
  const opsWrite = failure.opsWrite
  const conflict = opsWrite?.category === 'conflict'
  return opsFailure(
    conflict ? 'conflict' : 'unavailable',
    opsWrite?.subcause ?? 'ops-record-unlanded',
    `REC-WORK-18 记录未落地（${op}）：${failure.message}`,
    { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId } } },
    { retryable: !conflict, sideEffectPossible: true, responsiblePosition: '台账写口（PORT-HIST）' },
  )
}

const RECONCILE_NONE = { required: false, reason: '未授权/前置不成立：未执行任何动作，无副作用需对账' } as const

/** 复核槽投影（结论未给＝显式未完成标记——不臆造结论；补结论归复核记录，不覆写本事件） */
function reviewSlotOf(review: EmergencyReview): { position: string; due: string; conclusion: string } {
  const provided = textOf(review.conclusion)
  return {
    position: review.reviewerRef,
    due: review.due,
    conclusion: provided === '' ? `未完成（复核期限 ${review.due}，由 ${review.reviewerRef} 独立作出）` : provided,
  }
}

/** 非空引用列表 → 具名回执清单（receipt 用 refId；版本留在记录面） */
function refIdsOf(refs: readonly [OpsRef, ...OpsRef[]]): [string, ...string[]] {
  const [first, ...rest] = refs
  return [first.refId, ...rest.map((ref) => ref.refId)]
}

/** 建 PORT-OPS 落口（一引擎/一 CLI 进程一实例；零内部状态） */
export function createOpsLanding(deps: OpsLandingDeps): OpsLanding {
  return {
    emergencyStop(req: EmergencyStopRequest, ctx: CallContext): PortResult<StopReceipt> {
      const auth = checkAuthorization(req?.authorization)
      if (!auth.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-unauthorized', `PORT-OPS.emergencyStop 未授权：${auth.why}`, RECONCILE_NONE))
      }
      const context = checkContext(ctx)
      if (!context.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-signature-invalid', `PORT-OPS.emergencyStop 署名/公司维不成立：${context.why}`, RECONCILE_NONE))
      }
      const problem =
        (textOf(req.reason) === '' ? 'reason 缺失（匿名处置不成立）' : undefined) ??
        (textOf(req.triggerRef) === '' ? 'triggerRef 缺失（止损须引触发记录）' : undefined) ??
        boundaryProblem(req.boundary) ??
        textListProblem(req.actionsTaken, 'actions_taken', { minOne: true }) ??
        textListProblem(req.notAuthorized, 'not_authorized', { minOne: true }) ??
        refListProblem(req.notified, 'notified', { minOne: true, rejectAnonymous: true }) ??
        refListProblem(req.evidencePreserved, 'evidence_preserved', { minOne: false, rejectAnonymous: false }) ??
        reviewProblem(req.review, context) ??
        touchProblem(req)
      if (problem !== undefined) {
        return errOf(opsFailure('rejected_precondition', 'ops-record-invalid', `REC-WORK-18 不成立：${problem}`, RECONCILE_NONE))
      }
      const stamp = stampOf(deps)
      if (stamp === undefined) {
        return errOf(opsFailure('unavailable', 'ops-stamp-failed', 'PORT-OPS.emergencyStop 记录标识/时戳铸造失败（fail-closed）', RECONCILE_NONE, { retryable: true }))
      }
      const { recordId, at } = stamp
      const review = reviewSlotOf(req.review)
      const record: OpsStopRecord = {
        recordType: 'REC-WORK-18',
        recordId,
        version: 1,
        company: context.company,
        at,
        kind: 'emergency_stop',
        reason: req.reason,
        authorizationRef: auth.ref,
        trigger: req.triggerRef,
        boundaryRef: req.boundary.preset ? req.boundary.boundaryRecordRef : null,
        actionsTaken: req.actionsTaken,
        notAuthorized: req.notAuthorized,
        evidencePreserved: req.evidencePreserved,
        notified: req.notified,
        review,
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        // 请求形状已覆盖 REC-WORK-18 全字段——本记录无「形状缺口」（真实未做项在 not_authorized）
        gaps: [],
        signature: context.signature,
      }
      const landed = landRecord(deps, record)
      if (!landed.ok) return errOf(unlandedFailure('emergencyStop', recordId, landed))
      return okOf({
        recordId,
        version: 1,
        actionsTaken: record.actionsTaken,
        notAuthorized: record.notAuthorized,
        evidencePreserved: record.evidencePreserved.map((ref) => ref.refId),
        notified: refIdsOf(record.notified),
        review: { reviewerRef: req.review.reviewerRef, due: req.review.due, conclusion: review.conclusion },
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        reconcile: { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId } } },
      })
    },

    circuitBreak(req: CircuitBreakRequest, ctx: CallContext): PortResult<BreakReceipt> {
      const auth = checkAuthorization(req?.authorization)
      if (!auth.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-unauthorized', `PORT-OPS.circuitBreak 未授权：${auth.why}`, RECONCILE_NONE))
      }
      const context = checkContext(ctx)
      if (!context.ok) {
        return errOf(opsFailure('rejected_authority', 'ops-signature-invalid', `PORT-OPS.circuitBreak 署名/公司维不成立：${context.why}`, RECONCILE_NONE))
      }
      const problem =
        (textOf(req.reason) === '' ? 'reason 缺失（匿名处置不成立）' : undefined) ??
        (textOf(req.triggerRef) === '' ? 'triggerRef 缺失（止损须引触发记录；观察事件不构成止损权源）' : undefined) ??
        breakTargetProblem(req.target) ??
        fenceProblem(req.fence) ??
        textListProblem(req.actionsTaken, 'actions_taken', { minOne: true }) ??
        textListProblem(req.notAuthorized, 'not_authorized', { minOne: true }) ??
        refListProblem(req.notified, 'notified', { minOne: true, rejectAnonymous: true }) ??
        refListProblem(req.evidencePreserved, 'evidence_preserved', { minOne: false, rejectAnonymous: false }) ??
        reviewProblem(req.review, context) ??
        touchProblem(req)
      if (problem !== undefined) {
        return errOf(opsFailure('rejected_precondition', 'ops-record-invalid', `止损围栏不成立：${problem}`, RECONCILE_NONE))
      }
      const stamp = stampOf(deps)
      if (stamp === undefined) {
        return errOf(opsFailure('unavailable', 'ops-stamp-failed', 'PORT-OPS.circuitBreak 记录标识/时戳铸造失败（fail-closed）', RECONCILE_NONE, { retryable: true }))
      }
      const { recordId, at } = stamp
      const fence = req.fence
      const review = reviewSlotOf(req.review)
      const record: OpsStopRecord = {
        recordType: 'REC-WORK-18',
        recordId,
        version: 1,
        company: context.company,
        at,
        kind: 'circuit_break',
        reason: req.reason,
        authorizationRef: auth.ref,
        trigger: req.triggerRef,
        // 围栏声明不是紧急边界（真实事实，不冒充预设边界）；boundary_ref=null 允许「只保全与升级」
        boundaryRef: null,
        actionsTaken: req.actionsTaken,
        notAuthorized: circuitNotAuthorized(fence, req.notAuthorized),
        evidencePreserved: req.evidencePreserved,
        notified: req.notified,
        review,
        effectOnOriginal: EFFECT_ON_ORIGINAL,
        outcome: 'unknown',
        // 只列真实未证项：无预设紧急边界（围栏≠边界）＋围栏机制未证（不得宣称已冻结）
        gaps: [
          '无预设紧急边界（围栏声明不是紧急边界）——只登记保全与升级，不进入禁止/保留权限',
          ...(fence.mechanismProven ? [] : ['围栏机制未证（mechanismProven=false）——不得宣称旧写入者已被冻结']),
        ],
        signature: context.signature,
      }
      const landed = landRecord(deps, record)
      if (!landed.ok) return errOf(unlandedFailure('circuitBreak', recordId, landed))
      return okOf({
        recordId,
        stopped: [],
        fence: { scope: fence.scope, stopInjection: fence.stopInjection, revokeDerived: fence.revokeDerived, mechanismProven: fence.mechanismProven },
        residual: [],
        outcome: 'unknown',
        reconcile: { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId } } },
      })
    },
  }
}
