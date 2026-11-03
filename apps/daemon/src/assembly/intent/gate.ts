/**
 * assembly/intent/gate —— PORT-GATE 生产装配（外部意图唯一入口；serve 装配注入腿）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §二（PORT-GATE 落点＝assembly/intent＋api 装配）、§四（对外 API 写面唯一
 *     经 PORT-GATE；只落单不派工；触发面 202＝已入队≠已受理；意图保留键四槽＝公司×来源×
 *     种类×票据或去重键；同键同内容＝返回既有结果＋deduped:true，同键异内容＝
 *     `rejected_idempotency`；`receipt` 的 undefined 只表本进程快照未命中，不得映射 404）；
 *   - docs/17-§2（主循环七相位：本件只把意图交给 engine.ingest，入队后由下一拍采集/state-diff
 *     链消费——本件不自起主循环、不自开库）；
 *   - docs/17-§6（收割四要件之外的落单物化面：外部意图经既有 webhook 消费件落终态锚点，
 *     平台写面走 gated platform——只落单不派工，派工链登记位不开）；
 *   - docs/v2/15 §一 SEC-FC-07（非测试装配只允许 gated 形态；注入缺失/形状坏＝装配错误
 *     拒启，不静默降级为匿名或空转）。
 *
 * 边界（诚实登记，不充值）：
 *   - 本件是 **GatePort 的实现**，不是第二套队列：意图本体仍归 engine 的 intentQueue，
 *     回执投影只是本进程内存快照（重启丢失；权威回执落 REC-WORK-01/02 的持久面归后续单，
 *     见 deliverables/plan.md §7「不做什么」）；
 *   - `notify` 出口未装配：保留 `Err(unsupported notify-channel-not-wired)`——未接线面
 *     拒绝而非静默（当前 fail-closed 默认拒语义保持）；
 *   - 零库零平台句柄：`enqueue` 只收 `(InvokeIntent) => void`，本件拿不到 FlowPlatform /
 *     Ledger，平台写面只经 engine 侧既有 gated platform 代理。
 */
import { configInvalid } from '@studio-next/contract'
import type {
  CallContext,
  CompanyRef,
  DeliveryReceipt,
  ExternalIntent,
  FailureCategory,
  GatePort,
  IntentKey,
  IntentReceipt,
  InvokeIntent,
  NotificationEnvelope,
  PortFailure,
  PortResult,
  ReadContext,
} from '@studio-next/contract'
import { makeUlid } from '../../engine/tools/id.ts'

/** 装配面署名（Err 必答责任位置；v2/11 §0.4-6） */
const RESPONSIBLE_POSITION = '宰衡/装配（assembly 意图入口）'

/** 外部面 intent 种类恒 webhook（InvokeIntent['kind'] 真实八值之一；requestKind 只进 payload） */
const EXTERNAL_INTENT_KIND = 'webhook' as const

/** 意图保留键四槽（公司×来源×种类×票据或去重键；槽间 NUL 防拼接歧义） */
function identityOf(key: IntentKey): string {
  return [key.company.slug, key.source, key.requestKind, key.key].join('\u0000')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** dedupKey 进 PATROL note 的物理约束（分号/换行不可表示——engine webhook 消费件同款闸） */
function isNoteSafe(value: string): boolean {
  return !/[;\r\n]/.test(value)
}

function failure(input: {
  readonly category: FailureCategory
  readonly subcause: string
  readonly detail: string
  readonly retryable?: boolean
}): PortFailure {
  return {
    category: input.category,
    subcause: input.subcause,
    detail: input.detail,
    retryable: input.retryable ?? false,
    sideEffectPossible: false,
    reconcile: {
      required: false,
      reason: '拒绝发生在本进程入口、enqueue 之前：确定未产生外部效果（未入队/未写平台，无需对账）',
    },
    responsiblePosition: RESPONSIBLE_POSITION,
  }
}

/** 校验后的外部意图（payload 只留 webhook 消费件认得的字段） */
interface ValidatedIntent {
  readonly intent: ExternalIntent
  readonly ctx: CallContext
  readonly title: string
  readonly detail?: string
  readonly eventId?: string
}

function checkCaller(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value['callerId'])
}

function checkCommissioner(value: unknown): string | undefined {
  if (!isRecord(value)) return 'commissioner 非对象'
  if (value['mapped'] === true) {
    if (!checkCaller(value['caller'])) return 'commissioner.caller 缺 callerId'
    return undefined
  }
  if (value['mapped'] === false) {
    if (!isNonEmptyString(value['externalPrincipal'])) return 'commissioner.externalPrincipal 缺失（空主体＝匿名委托，类型上不成立）'
    if (!isNonEmptyString(value['identityMappingBasis'])) return 'commissioner.identityMappingBasis 缺失（未映射须显式声明映射依据）'
    return undefined
  }
  return 'commissioner.mapped 必须为 true 或 false'
}

function checkDispatcherAnchor(value: unknown): string | undefined {
  if (!isRecord(value)) return 'dispatcherAnchor 非对象'
  if (value['defaulted'] === true) {
    if (value['resolvedBy'] !== 'intake_governance_position') return 'dispatcherAnchor.resolvedBy 只收 intake_governance_position'
    return undefined
  }
  if (!checkCaller(value['anchor'])) return 'dispatcherAnchor 须为 {anchor} 或 {defaulted:true,resolvedBy}'
  return undefined
}

function checkAuth(value: unknown): string | undefined {
  if (!isRecord(value)) return 'auth 非对象'
  const tier = value['tier']
  if (tier === 'partner') {
    return isNonEmptyString(value['credentialRef']) ? undefined : 'partner 档缺 credentialRef'
  }
  if (tier === 'signed') {
    if (!isNonEmptyString(value['hmacRef'])) return 'signed 档缺 hmacRef'
    if (!isNonEmptyString(value['timestamp'])) return 'signed 档缺 timestamp'
    if (!isNonEmptyString(value['nonce'])) return 'signed 档缺 nonce'
    return undefined
  }
  return `auth.tier 只收 partner/signed（public 档不入落单入口；实得 ${JSON.stringify(tier)}）`
}

/** 调用上下文（SEC-SIG-01：system 必带 onBehalfOf；缺任一即构造期非法） */
function checkContext(value: unknown, company: CompanyRef): string | undefined {
  if (!isRecord(value)) return 'CallContext 非对象'
  const companyRef = value['company']
  if (!isRecord(companyRef)) return 'CallContext.company 缺失'
  if (companyRef['slug'] !== company.slug || companyRef['companyId'] !== company.companyId) {
    return `CallContext.company 与挂载公司维不一致（拒绝跨公司写入，SEC-WD-01）`
  }
  if (!checkCaller(value['caller'])) return 'CallContext.caller 缺 callerId'
  if (!Array.isArray(value['authority'])) return 'CallContext.authority 须为数组（可空，但槽必在）'
  const signature = value['signature']
  if (!isRecord(signature)) return 'CallContext.signature 缺失（署名三值必带）'
  const actorKind = signature['actorKind']
  if (!isNonEmptyString(signature['actorRef'])) return 'CallContext.signature.actorRef 缺失'
  if (actorKind === 'system') {
    return isNonEmptyString(signature['onBehalfOf']) ? undefined : 'system 署名缺 onBehalfOf（SEC-SIG-01）'
  }
  if (actorKind === 'control') {
    return isNonEmptyString(signature['decisionRef']) ? undefined : 'control 署名缺 decisionRef'
  }
  if (actorKind === 'person') return undefined
  return `CallContext.signature.actorKind 只收 person/control/system（实得 ${JSON.stringify(actorKind)}）`
}

/**
 * 逐槽校验（fail-closed）：公司维/工具面分级/凭证档/委托主体/派单人锚/四槽保留键/
 * 调用上下文/body 形状。任一不过即 `Err`，**不落队列、不落回执**。
 */
function checkIntent(rawIntent: unknown, rawCtx: unknown, company: CompanyRef): ValidatedIntent | PortFailure {
  if (!isRecord(rawIntent)) {
    return failure({ category: 'rejected_precondition', subcause: 'intent-shape', detail: '外部意图须为对象（实得非对象）' })
  }
  const intentCompany = rawIntent['company']
  if (!isRecord(intentCompany) || intentCompany['slug'] !== company.slug || intentCompany['companyId'] !== company.companyId) {
    return failure({
      category: 'rejected_forbidden',
      subcause: 'cross-company-intent',
      detail: '意图公司维与挂载公司不一致——跨公司写入拒绝（SEC-WD-01：读/写同一公司维）',
    })
  }
  if (rawIntent['toolScope'] !== 'intake_comment') {
    return failure({
      category: 'rejected_forbidden',
      subcause: 'intent-scope-escalation',
      detail: `toolScope 只收 intake_comment（只读面/派工面不入本入口；实得 ${JSON.stringify(rawIntent['toolScope'])}）`,
    })
  }
  for (const slot of ['source', 'requestKind', 'key', 'payloadDigest', 'receivedAt'] as const) {
    if (!isNonEmptyString(rawIntent[slot])) {
      return failure({
        category: 'rejected_precondition',
        subcause: 'intent-key-malformed',
        detail: `意图保留键/证据槽 ${slot} 缺失或非字符串（四槽任一留空即不构成保留键）`,
      })
    }
  }
  const source = rawIntent['source'] as string
  const requestKind = rawIntent['requestKind'] as string
  const key = rawIntent['key'] as string
  if (!isNoteSafe(source) || !isNoteSafe(requestKind) || !isNoteSafe(key)) {
    return failure({
      category: 'rejected_precondition',
      subcause: 'intent-key-unrepresentable',
      detail: '意图保留键槽含分号/换行（PATROL note 键值不可表示）——拒绝而非静默丢弃',
    })
  }
  const commissionerError = checkCommissioner(rawIntent['commissioner'])
  if (commissionerError !== undefined) {
    return failure({ category: 'rejected_precondition', subcause: 'commissioner-invalid', detail: commissionerError })
  }
  const anchorError = checkDispatcherAnchor(rawIntent['dispatcherAnchor'])
  if (anchorError !== undefined) {
    return failure({ category: 'rejected_precondition', subcause: 'dispatcher-anchor-invalid', detail: anchorError })
  }
  if (!checkCaller(rawIntent['submittedBy'])) {
    return failure({ category: 'rejected_precondition', subcause: 'submitted-by-invalid', detail: 'submittedBy 缺 callerId' })
  }
  const authError = checkAuth(rawIntent['auth'])
  if (authError !== undefined) {
    return failure({ category: 'rejected_authority', subcause: 'intent-auth-invalid', detail: authError })
  }
  const body = rawIntent['body']
  if (!isRecord(body)) {
    return failure({ category: 'rejected_precondition', subcause: 'intent-body-shape', detail: 'body 须为 JSON 对象（意图原始载荷）' })
  }
  const title = body['title']
  if (!isNonEmptyString(title)) {
    return failure({
      category: 'rejected_precondition',
      subcause: 'intent-payload-shape',
      detail: 'body.title 必填（webhook 消费件落单标题主体；缺 title 即拒，不落匿名单）',
    })
  }
  const detailRaw = body['detail']
  if (detailRaw !== undefined && typeof detailRaw !== 'string') {
    return failure({ category: 'rejected_precondition', subcause: 'intent-payload-shape', detail: 'body.detail 须为字符串' })
  }
  const eventIdRaw = body['eventId']
  if (eventIdRaw !== undefined && typeof eventIdRaw !== 'string') {
    return failure({ category: 'rejected_precondition', subcause: 'intent-payload-shape', detail: 'body.eventId 须为字符串' })
  }
  const contextError = checkContext(rawCtx, company)
  if (contextError !== undefined) {
    return failure({ category: 'rejected_precondition', subcause: 'call-context-invalid', detail: contextError })
  }
  const validated: ValidatedIntent = {
    intent: rawIntent as unknown as ExternalIntent,
    ctx: rawCtx as CallContext,
    title,
    ...(typeof detailRaw === 'string' ? { detail: detailRaw } : {}),
    ...(typeof eventIdRaw === 'string' ? { eventId: eventIdRaw } : {}),
  }
  return validated
}

function commissionerRef(intent: ExternalIntent): string {
  return intent.commissioner.mapped ? intent.commissioner.caller.callerId : `external:${intent.commissioner.externalPrincipal}`
}

function anchorRef(anchor: ExternalIntent['dispatcherAnchor']): string {
  return anchor.defaulted === true ? 'intake:governance-position' : anchor.anchor.callerId
}

/** 外部意图 → 引擎意图（四槽保留键在引擎键面同构；requestKind 只进 payload 不参与键） */
function toInvokeIntent(validated: ValidatedIntent, company: CompanyRef): InvokeIntent {
  const { intent } = validated
  const payload: Record<string, unknown> = {
    title: validated.title,
    requestKind: intent.requestKind,
    ...(validated.detail !== undefined ? { detail: validated.detail } : {}),
    ...(validated.eventId !== undefined ? { eventId: validated.eventId } : {}),
  }
  return {
    kind: EXTERNAL_INTENT_KIND,
    company: company.slug,
    source: intent.source,
    // 四槽之第四槽在引擎键 intentKeyOf 里与 source/kind/company 合键；requestKind 需在
    // 值内区分（同 key 不同 requestKind 是两条保留键，不得被引擎去重合并）。
    dedupKey: `${intent.requestKind}:${intent.key}`,
    payload,
  }
}

/** 回执投影条目（本进程快照；digest 用于同键异内容判定） */
interface ReceiptEntry {
  readonly digest: string
  readonly receipt: IntentReceipt
}

/** PORT-GATE 生产装配入参（runServe 装配位交窄面：只交入队函数，不交引擎本体） */
export interface IntentGateArgs {
  /** 本进程挂载公司维（SEC-WD-01：读写同一解析规则） */
  readonly company: CompanyRef
  /** 毫秒时钟（与 runServe 同源注入——回执 queuedAt/intentRef 可确定性回放） */
  readonly clock: () => number
  /** 引擎入队唯一接缝（`(i) => engine.ingest([i])`；不交 Engine 本体，防越权 tick/decision） */
  readonly enqueue: (intent: InvokeIntent) => void
  /** 装配/入队日志出口（缺省 no-op；不记 body/凭据值） */
  readonly log?: (line: string) => void
}

/** 生产 PORT-GATE 面（比 GatePort 多两个只读观测槽；不放宽端口方法集） */
export interface IntentGate extends GatePort {
  /** 本进程已登记回执数（启动行/测试观测；非队列长度） */
  readonly pending: number
  /** 生产装配标记（启动行据此区分「已接线」与 fail-closed 默认面） */
  readonly wired: true
}

/**
 * 构造生产 PORT-GATE（注入缺失/形状坏 ⇒ CONFIG_INVALID 拒启，不静默降级）。
 * 三方法：receiveIntent（唯一写动作＝入队）｜receipt（本进程快照读）｜notify（未接线＝拒）。
 */
export function createIntentGate(args: IntentGateArgs): IntentGate {
  if (!isRecord(args)) {
    configInvalid('assembly/intent:args-missing', 'PORT-GATE 装配缺入参——注入缺失即 fail-closed，拒绝而非静默空转')
  }
  const company = args.company
  if (!isRecord(company) || !isNonEmptyString(company.companyId) || !isNonEmptyString(company.slug)) {
    configInvalid('assembly/intent:company-invalid', 'PORT-GATE 装配缺合法公司维 {companyId, slug}（SEC-WD-01 读写同一公司维）')
  }
  if (typeof args.clock !== 'function') {
    configInvalid('assembly/intent:clock-missing', 'PORT-GATE 装配缺时钟（回执 queuedAt/intentRef 须同源注入）')
  }
  if (typeof args.enqueue !== 'function') {
    configInvalid(
      'assembly/intent:enqueue-missing',
      'PORT-GATE 装配缺 enqueue 入队面（engine.ingest 接缝）——外部意图无入队面＝装配错误拒启，不静默丢弃',
    )
  }
  const log = args.log
  if (log !== undefined && typeof log !== 'function') {
    configInvalid('assembly/intent:log-shape', 'PORT-GATE log 须为 (line: string) => void（缺省不注入=no-op）')
  }
  const mountedCompany: CompanyRef = Object.freeze({ companyId: company.companyId, slug: company.slug })
  const clock = args.clock
  const enqueue = args.enqueue
  const receipts = new Map<string, ReceiptEntry>()

  function receiveIntent(intent: ExternalIntent, ctx: CallContext): PortResult<IntentReceipt> {
    const checked = checkIntent(intent, ctx, mountedCompany)
    if (!('intent' in checked)) return { kind: 'err', error: checked }
    const key = identityOf(checked.intent)
    const existing = receipts.get(key)
    if (existing !== undefined) {
      if (existing.digest !== checked.intent.payloadDigest) {
        return {
          kind: 'err',
          error: failure({
            category: 'rejected_idempotency',
            subcause: 'intent-digest-mismatch',
            detail:
              `同键异内容：四槽键已登记摘要 ${existing.digest.slice(0, 12)}…，本次 ${checked.intent.payloadDigest.slice(0, 12)}…` +
              '——拒绝第二次副作用（不得静默覆盖既有回执）',
          }),
        }
      }
      // 同键同内容：返回既有结果，不产生第二次副作用（202 幂等重投面）。
      return { kind: 'ok', value: { ...existing.receipt, deduped: true } }
    }
    const receipt: IntentReceipt = {
      intentRef: makeUlid(clock()),
      identity: {
        company: { companyId: mountedCompany.companyId, slug: mountedCompany.slug },
        source: checked.intent.source,
        requestKind: checked.intent.requestKind,
        key: checked.intent.key,
      },
      outcome: 'queued',
      commissionerRef: commissionerRef(checked.intent),
      anchorRef: anchorRef(checked.intent.dispatcherAnchor),
      queuedAt: new Date(clock()).toISOString(),
      deduped: false,
    }
    try {
      enqueue(toInvokeIntent(checked, mountedCompany))
    } catch (err) {
      return {
        kind: 'err',
        error: failure({
          category: 'unavailable',
          subcause: 'intent-enqueue-failed',
          detail: `意图入队面失败（未登记回执，可重投）：${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        }),
      }
    }
    receipts.set(key, { digest: checked.intent.payloadDigest, receipt })
    log?.(
      `[intent] 外部意图已入队：source=${checked.intent.source} requestKind=${checked.intent.requestKind} ` +
        `key=${checked.intent.key} intentRef=${receipt.intentRef}（只落单不派工；平台写出站经 gated platform）`,
    )
    return { kind: 'ok', value: receipt }
  }

  function receipt(key: IntentKey, rc: ReadContext): PortResult<IntentReceipt | undefined> {
    if (!isRecord(key) || !isNonEmptyString(key.source) || !isNonEmptyString(key.requestKind) || !isNonEmptyString(key.key)) {
      return {
        kind: 'err',
        error: failure({ category: 'rejected_precondition', subcause: 'intent-key-malformed', detail: 'receipt 查询键四槽不完整' }),
      }
    }
    const keyCompany = key.company
    if (!isRecord(keyCompany) || keyCompany['slug'] !== mountedCompany.slug) {
      return {
        kind: 'err',
        error: failure({
          category: 'rejected_forbidden',
          subcause: 'cross-company-read',
          detail: 'receipt 查询键公司维与挂载公司不一致——跨公司读拒绝（SEC-WD-01）',
        }),
      }
    }
    if (!isRecord(rc) || !isRecord(rc.readScope) || !isRecord(rc.readScope.company)) {
      return {
        kind: 'err',
        error: failure({ category: 'rejected_precondition', subcause: 'read-context-invalid', detail: 'receipt 读缺 ReadContext.readScope（读面缺省＝拒）' }),
      }
    }
    const scopeCompany = rc.readScope.company
    if (scopeCompany.slug !== mountedCompany.slug || !Array.isArray(rc.readScope.fields) || rc.readScope.fields.length === 0) {
      return {
        kind: 'err',
        error: failure({
          category: 'rejected_forbidden',
          subcause: 'read-scope-invalid',
          detail: 'receipt 读范围不覆盖本挂载公司或未声明字段（越权＝Err，不以 Ok(undefined) 冒充无行）',
        }),
      }
    }
    const entry = receipts.get(identityOf(key as IntentKey))
    return { kind: 'ok', value: entry?.receipt }
  }

  function notify(_envelope: NotificationEnvelope, _ctx: CallContext): PortResult<DeliveryReceipt> {
    return {
      kind: 'err',
      error: {
        category: 'unsupported',
        subcause: 'notify-channel-not-wired',
        detail: '通知出口未装配（通知面经 notifyBroadcast 注入，不在 API 面；送达≠接受）——拒绝而非静默',
        retryable: false,
        sideEffectPossible: false,
        reconcile: { required: false, reason: '通知面未装配：确定未产生外部效果（无发送路径）' },
        responsiblePosition: 'daemon/assembly（通知面装配）',
      },
    }
  }

  return Object.freeze({
    wired: true as const,
    get pending(): number {
      return receipts.size
    },
    receiveIntent,
    receipt,
    notify,
  })
}
