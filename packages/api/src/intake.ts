/**
 * packages/api/src/intake.ts —— 触发面公共管线（API-10..13；hooks 复用）
 *
 * 依据：
 *   - docs/v2/14 §四触发面公共入参槽：company｜requestKind｜dedupKey｜commissioner｜
 *     dispatcherAnchor｜body｜correlation；回执带 commissionerRef/anchorRef；幂等键=四槽
 *     意图保留键（§0.2-3）；202=已入队≠已受理；同键同内容=200+duplicate、同键异内容=409；
 *   - docs/v2/15 §三 SEC-WD-01（写公司维）、§二 SEC-SIG-01（署名三值；system 必带
 *     onBehalfOf）、§七 SEC-ROOT（root 凭据不入接口面）。
 *
 * 边界（只落单不派工）：
 *   - 本管线只调 PORT-GATE.receiveIntent——没有 launch/dispatch/assign/加评论/写台账
 *     的代码路径（类型上也拿不到：deps 只有 obs/gate/readers/auth）；
 *   - 回执只出白名单（queued），不承载受理结论；受理归 REC-WORK-02（daemon 侧）；
 *   - `commissioner` 不留空：未映射须显式 externalPrincipal＋identity_mapping 依据；
 *     `dispatcherAnchor` 缺省＝意图受理治理位（defaulted 显式声明，不是「无锚」）。
 */
import type {
  CallContext,
  CallerRef,
  CommissionerRef,
  DispatcherAnchor,
  ExternalIntent,
  IntentAuth,
  IntentKey,
  IntentReceipt,
} from '@studio-next/contract'
import type { ApiRouteDeps } from './types.ts'
import {
  MAX_TEXT_FIELD_LENGTH,
  apiError,
  invalidRequest,
  isNonEmptyString,
  isRecord,
  nowIso,
  optionalString,
  parseCaller,
  payloadDigest,
  pickIntentReceipt,
  portFailureResponse,
  readJsonBody,
  rejectUnknownKeys,
  resolveRequestCompany,
} from './http.ts'
import type { ApiHttpContext } from './http.ts'

/** 四条触发路由的 requestKind（四槽之一；路径即事实，body 不得改写） */
export type TriggerKind = 'request' | 'explore' | 'task' | 'intel'

/** 触发面允许的顶层槽（未知槽=422；拼错不被静默忽略） */
const INTAKE_BODY_KEYS = [
  'company',
  'requestKind',
  'dedupKey',
  'commissioner',
  'dispatcherAnchor',
  'body',
  'correlation',
] as const

/** 默认派单人锚（v2/14 §四：意图受理治理位；N=1 默认形态＝最高宰相） */
const DEFAULT_ANCHOR: DispatcherAnchor = { defaulted: true, resolvedBy: 'intake_governance_position' }

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/** 外部委托主体：mapped 或「未映射＋identity_mapping 依据」；空主体不成立 */
export function parseCommissioner(value: unknown): CommissionerRef | undefined {
  if (!isRecord(value)) return undefined
  const mapped = value['mapped']
  if (mapped === true) {
    if (!onlyKeys(value, ['mapped', 'caller', 'identityMappingBasis'])) return undefined
    const caller = parseCaller(value['caller'])
    if (caller === undefined) return undefined
    return { mapped: true, caller }
  }
  if (mapped === false) {
    if (!onlyKeys(value, ['mapped', 'externalPrincipal', 'identityMappingBasis'])) return undefined
    const externalPrincipal = value['externalPrincipal']
    const basis = value['identityMappingBasis']
    if (!isNonEmptyString(externalPrincipal) || !isNonEmptyString(basis)) return undefined
    if (externalPrincipal.length > MAX_TEXT_FIELD_LENGTH || basis.length > MAX_TEXT_FIELD_LENGTH) return undefined
    return { mapped: false, externalPrincipal, identityMappingBasis: basis }
  }
  return undefined
}

/** 派单人锚：缺省＝受理治理位（显式 defaulted）；给出则必须是合法 CallerRef */
export function parseDispatcherAnchor(value: unknown): DispatcherAnchor | undefined {
  if (value === undefined) return DEFAULT_ANCHOR
  if (!isRecord(value)) return undefined
  if (value['defaulted'] === true) {
    if (!onlyKeys(value, ['defaulted', 'resolvedBy'])) return undefined
    if (value['resolvedBy'] !== 'intake_governance_position') return undefined
    return DEFAULT_ANCHOR
  }
  if (!onlyKeys(value, ['anchor', 'defaulted'])) return undefined
  const anchor = parseCaller(value['anchor'])
  if (anchor === undefined) return undefined
  return { anchor }
}

/** 回执白名单外的受理结论槽——出现即 wiring 错，503 不冒充 */
function commissionerOnBehalfOf(commissioner: CommissionerRef): string {
  return commissioner.mapped ? commissioner.caller.callerId : `external:${commissioner.externalPrincipal}`
}

function anchorRef(anchor: DispatcherAnchor): string {
  return anchor.defaulted === true ? 'intake:governance-position' : anchor.anchor.callerId
}

function isIntentAuth(value: unknown): value is IntentAuth {
  if (!isRecord(value)) return false
  const tier = value['tier']
  if (tier === 'partner') {
    return isNonEmptyString(value['credentialRef'])
  }
  if (tier === 'signed') {
    return (
      isNonEmptyString(value['hmacRef']) &&
      typeof value['timestamp'] === 'string' &&
      isNonEmptyString(value['nonce'])
    )
  }
  return false
}

/** 回执响应：新入队=202（已入队≠已受理）；同键同内容=200+duplicate；形状坏=503 */
export function respondIntentReceipt(c: ApiHttpContext, receipt: IntentReceipt): Response {
  const picked = pickIntentReceipt(receipt)
  if (picked === undefined) {
    return apiError(c, 503, 'receipt-invalid', 'degraded', 'receipt-outcome-invalid', {
      reason: '入口回执 outcome 不是 queued——触发面不承载受理结论（REC-WORK-02）',
    })
  }
  const status = receipt.deduped ? 200 : 202
  return c.json(
    {
      ok: true,
      enqueued: true,
      deduped: receipt.deduped,
      receipt: picked,
      note: receipt.deduped
        ? '同键同内容：返回既有入队回执（不产生第二次副作用）'
        : '202=已入队≠已受理；受理结论归 REC-WORK-02（daemon 侧），不在触发回执',
    },
    status,
  )
}

/** 认证结果（失败已带响应；成功给规范化 auth/caller） */
export type IntakeAuthContext =
  | { readonly ok: true; readonly auth: IntentAuth; readonly caller: CallerRef }
  | { readonly ok: false; readonly response: Response }

/**
 * 触发面认证（API-10..13 与 API-16 共用）：凭证三档之 partner/signed；失败 fail-closed；
 * root 凭据在接口面一律拒绝（SEC-ROOT-01：root 不进接口载荷/回执/日志）。
 */
export async function authenticateIntakeRequest(
  c: ApiHttpContext,
  deps: ApiRouteDeps,
): Promise<IntakeAuthContext> {
  const authResult = await deps.auth({
    method: c.req.method,
    path: c.req.path,
    headers: c.req.raw.headers,
  })
  if (authResult.ok !== true) {
    const status = authResult.status === 403 ? 403 : 401
    return {
      ok: false,
      response: apiError(c, status, 'credential-rejected', 'rejected_authority', authResult.subcause, {
        ...(authResult.detail !== undefined ? { detail: authResult.detail } : {}),
      }),
    }
  }
  const caller = parseCaller(authResult.caller)
  if (!isIntentAuth(authResult.auth) || caller === undefined) {
    throw new Error('api/auth: 认证器返回的形状非法（auth/caller）——装配错误')
  }
  if (authResult.credentialClass === 'root') {
    return {
      ok: false,
      response: apiError(c, 403, 'root-credential-forbidden', 'rejected_forbidden', 'root-credential-forbidden', {
        detail: 'operating root key 只由最高宰相持有，不进任何接口载荷/回执/日志（SEC-ROOT-01）',
      }),
    }
  }
  return { ok: true, auth: authResult.auth, caller }
}

/**
 * 触发面主管线（POST /v1/requests・explore・tasks・intel；hooks 验证后复用）。
 * @param kind 路由事实（路径决定 requestKind；body 给不同值＝422）
 */
export async function handleIntake(
  c: ApiHttpContext,
  deps: ApiRouteDeps,
  kind: TriggerKind,
): Promise<Response> {
  // ① 认证（凭证三档之 partner/signed；失败 fail-closed；root 凭据不入接口面）
  const authenticated = await authenticateIntakeRequest(c, deps)
  if (!authenticated.ok) return authenticated.response
  const caller = authenticated.caller

  // ② body（限长→JSON→严格键闸）
  const parsed = await readJsonBody(c)
  if (!parsed.ok) return parsed.response
  const body = parsed.value
  const unknown = rejectUnknownKeys(c, body, INTAKE_BODY_KEYS)
  if (unknown !== undefined) return unknown

  // ③ 公司维（query/body 同一解析规则；错绑=4xx）
  const company = resolveRequestCompany(c, deps, body['company'])
  if (!company.ok) return company.response

  // ④ requestKind 由路径决定；body 给不同值＝422（不允许路径与种类错位）
  const declaredKind = body['requestKind']
  if (declaredKind !== undefined && declaredKind !== kind) {
    return invalidRequest(c, 'requestKind', `本路径 requestKind 恒为 ${kind}（body 给了 ${String(declaredKind)}）`)
  }

  // ⑤ dedupKey（body 或 Idempotency-Key 头；两者同给须一致）
  const bodyKey = optionalString(c, body, 'dedupKey')
  if (!bodyKey.ok) return bodyKey.response
  const headerKey = c.req.header('idempotency-key')
  if (bodyKey.value !== undefined && headerKey !== undefined && bodyKey.value !== headerKey) {
    return invalidRequest(c, 'dedupKey', 'body.dedupKey 与 Idempotency-Key 头不一致')
  }
  const dedupKey = bodyKey.value ?? headerKey
  if (!isNonEmptyString(dedupKey) || dedupKey.length > MAX_TEXT_FIELD_LENGTH) {
    return invalidRequest(c, 'dedupKey', `dedupKey 必填（幂等键四槽之第四槽；1..${String(MAX_TEXT_FIELD_LENGTH)} 字符）`)
  }

  // ⑥ commissioner 不留空（未映射须显式声明＋identity_mapping 依据）
  const commissioner = parseCommissioner(body['commissioner'])
  if (commissioner === undefined) {
    return invalidRequest(
      c,
      'commissioner',
      'commissioner 必填：mapped:true+caller，或 mapped:false+externalPrincipal+identityMappingBasis（不留空）',
    )
  }

  // ⑦ dispatcherAnchor（缺省＝意图受理治理位，显式 defaulted；不是「无锚」）
  const dispatcherAnchor = parseDispatcherAnchor(body['dispatcherAnchor'])
  if (dispatcherAnchor === undefined) {
    return invalidRequest(c, 'dispatcherAnchor', 'dispatcherAnchor 须为 {anchor} 或 {defaulted:true,resolvedBy}')
  }

  // ⑧ body 槽（意图原始载荷；对象，不吞数组/null）
  const payload = body['body']
  if (!isRecord(payload)) return invalidRequest(c, 'body', 'body 必填且须为 JSON 对象（意图原始载荷）')

  const correlation = optionalString(c, body, 'correlation')
  if (!correlation.ok) return correlation.response

  const intentKey: IntentKey = {
    company: company.company,
    source: 'http',
    requestKind: kind,
    key: dedupKey,
  }
  const intent: ExternalIntent = {
    ...intentKey,
    toolScope: 'intake_comment',
    auth: authenticated.auth,
    commissioner,
    dispatcherAnchor,
    submittedBy: caller,
    body: payload,
    payloadDigest: payloadDigest({
      requestKind: kind,
      body: payload,
      ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
    }),
    receivedAt: nowIso(deps),
    ...(correlation.value !== undefined ? { correlation: correlation.value } : {}),
  }

  const ctx: CallContext = {
    company: company.company,
    caller,
    // 权源主张＝记录引用（token/凭据不是权源）；外部意图在入口无内部授权记录
    authority: [],
    // SEC-SIG-01：system 代写必带 onBehalfOf（可还原到委托主体）
    signature: {
      actorKind: 'system',
      actorRef: 'api:intake',
      onBehalfOf: commissionerOnBehalfOf(commissioner),
    },
  }

  // ⑨ 只落单：唯一写动作＝PORT-GATE.receiveIntent（无 launch/dispatch/台账直写）
  const result = deps.gate.receiveIntent(intent, ctx)
  if (result.kind === 'err') return portFailureResponse(c, result.error, 'intent-rejected')
  deps.log(
    `[api] intent enqueued：kind=${kind} key=${dedupKey} intentRef=${result.value.intentRef} ` +
      `deduped=${String(result.value.deduped)} anchor=${anchorRef(dispatcherAnchor)}`,
  )
  return respondIntentReceipt(c, result.value)
}
