/**
 * packages/api/test/v2/fakes.ts —— V2 测试夹具（fake 栈；零网络/零真 LLM/零磁盘）
 *
 * 依据：plan/05 IMPL-06-07/08（各路由正负例用 `app.request` 或最小 fake）；docs/v2/14
 * §四（只落单不派工；202=入队≠受理；幂等四槽；快照未命中=503；跨公司隔离）。
 *
 * 形态：fake PORT-OBS 只读子口、fake PORT-GATE（内存四槽幂等）、八个只读投影读取器、
 * 认证器（头驱动）、hooks 签名助手。全部纯内存，测试用 `app.request()` 进程内驱动。
 */
import { createHmac } from 'node:crypto'
import type {
  CallContext,
  ClockReading,
  CompanyRef,
  DeliveryReceipt,
  ExternalIntent,
  FailureCategory,
  GatePort,
  HealthReport,
  Identifier,
  IntentKey,
  IntentReceipt,
  PortResult,
  Projection,
  ReadContext,
  ViewId,
} from '@studio-next/contract'
import {
  createApiApp,
  type ApiApp,
  type ApiAppOptions,
  type ApiEventFeed,
  type ApiHookSource,
  type ApiIntakeAuthenticator,
  type ApiIssueView,
  type ApiObservationReadFace,
  type ApiReadSources,
  type ApiSubscriptionPolicy,
} from '../../src/index.ts'

export const COMPANY: CompanyRef = { companyId: 'C-001', slug: 'demo' }
export const NOW = '2026-10-28T00:00:00.000Z'
export const NOW_MS = Date.parse(NOW)

export function ok<T>(value: T): PortResult<T> {
  return { kind: 'ok', value }
}

export function err(category: FailureCategory, subcause: string): PortResult<never> {
  return {
    kind: 'err',
    error: {
      category,
      subcause,
      retryable: false,
      sideEffectPossible: false,
      reconcile: { required: false, reason: 'fixture：确定未产生外部效果' },
      responsiblePosition: 'fixture',
    },
  }
}

/** fake PORT-OBS 只读子口（snapshot/health 不该被 API 调用——调用即测试失败） */
export function makeObs(overrides: Partial<ApiObservationReadFace> = {}): ApiObservationReadFace {
  let counter = 0
  const base: ApiObservationReadFace = {
    snapshot: (_view: ViewId, _rc: ReadContext): PortResult<Projection> => {
      throw new Error('fixture: obs.snapshot 不应被 API 端点调用（读源=readers）')
    },
    clock: (): ClockReading => ({ now: NOW, source: 'injected' }),
    newId: (kind: string): Identifier => {
      counter += 1
      return { kind, value: `${kind}-${String(counter)}`, sortable: true }
    },
    health: (_rc: ReadContext): PortResult<HealthReport> => {
      throw new Error('fixture: obs.health 不应被 API 端点调用')
    },
  }
  return {
    snapshot: overrides.snapshot ?? base.snapshot,
    clock: overrides.clock ?? base.clock,
    newId: overrides.newId ?? base.newId,
    health: overrides.health ?? base.health,
  }
}

/** fake PORT-GATE 状态（意图/上下文留档供断言） */
export interface FakeGateState {
  readonly gate: GatePort
  readonly intents: ExternalIntent[]
  readonly contexts: CallContext[]
  readonly receiptCalls: Array<{ readonly key: IntentKey; readonly rc: ReadContext }>
}

export interface FakeGateOptions {
  readonly receipt?: (key: IntentKey, rc: ReadContext) => PortResult<IntentReceipt | undefined>
  readonly receiveIntent?: (intent: ExternalIntent, ctx: CallContext) => PortResult<IntentReceipt>
}

function commissionerRefOf(intent: ExternalIntent): string {
  return intent.commissioner.mapped
    ? intent.commissioner.caller.callerId
    : `external:${intent.commissioner.externalPrincipal}`
}

function anchorRefOf(intent: ExternalIntent): string {
  return intent.dispatcherAnchor.defaulted === true
    ? 'intake:governance-position'
    : intent.dispatcherAnchor.anchor.callerId
}

function receiptOf(intent: ExternalIntent, intentRef: string, deduped: boolean): IntentReceipt {
  return {
    intentRef,
    identity: {
      company: intent.company,
      source: intent.source,
      requestKind: intent.requestKind,
      key: intent.key,
    },
    outcome: 'queued',
    commissionerRef: commissionerRefOf(intent),
    anchorRef: anchorRefOf(intent),
    queuedAt: NOW,
    deduped,
  }
}

/**
 * fake PORT-GATE：
 *   - 默认 receiveIntent 按四槽键做内存幂等（同键同摘要→deduped；同键异摘要→
 *     rejected_idempotency）；
 *   - receipt 缺省返回 Ok(undefined)（快照未命中，测 503 用）。
 */
export function makeGate(options: FakeGateOptions = {}): FakeGateState {
  const intents: ExternalIntent[] = []
  const contexts: CallContext[] = []
  const receiptCalls: Array<{ key: IntentKey; rc: ReadContext }> = []
  const slots = new Map<string, { digest: string; receipt: IntentReceipt }>()
  const slotKey = (key: IntentKey): string =>
    `${key.company.companyId}|${key.source}|${key.requestKind}|${key.key}`

  const gate: GatePort = {
    receiveIntent: (intent, ctx) => {
      if (options.receiveIntent !== undefined) return options.receiveIntent(intent, ctx)
      intents.push(intent)
      contexts.push(ctx)
      const slot = slotKey(intent)
      const existing = slots.get(slot)
      if (existing !== undefined) {
        if (existing.digest !== intent.payloadDigest) {
          return err('rejected_idempotency', 'rejected_idempotency')
        }
        return ok({ ...existing.receipt, deduped: true })
      }
      const receipt = receiptOf(intent, `intent-${String(intents.length)}`, false)
      slots.set(slot, { digest: intent.payloadDigest, receipt })
      return ok(receipt)
    },
    receipt: (key, rc) => {
      receiptCalls.push({ key, rc })
      if (options.receipt !== undefined) return options.receipt(key, rc)
      return ok(undefined)
    },
    notify: (envelope): PortResult<DeliveryReceipt> => {
      const receipt: DeliveryReceipt = {
        notificationId: envelope.notificationId,
        dedupKey: envelope.dedupKey,
        deliveryState: 'sent',
        deliveredAt: NOW,
        targets: ['subscription:fixture'],
        evidenceRefs: [],
        deduped: false,
        reconcile: { required: false, reason: 'fixture：送达≠接受' },
      }
      return ok(receipt)
    },
  }
  return { gate, intents, contexts, receiptCalls }
}

/** 八个只读投影读取器（默认数据含一条别家行/缺月报源，供负例直接复用） */
export function makeReaders(overrides: Partial<ApiReadSources> = {}): ApiReadSources {
  const base: ApiReadSources = {
    company: () => ({ companyId: COMPANY.companyId, slug: COMPANY.slug, name: 'Demo 公司', platform: 'taiga' }),
    org: () => ({
      company: COMPANY.slug,
      departments: [
        { path: '研发部', name: '研发部', headcount: 3, relations: ['汇报给最高宰相'] },
        { path: '研发部/平台组', name: '平台组', parent: '研发部', headcount: 2 },
      ],
      warnings: ['悬空父引用（parent 不在部门集，已提升为根）：x'],
    }),
    people: () => ({
      company: COMPANY.slug,
      total: 5,
      byDepartment: [
        { key: '研发部', count: 3 },
        { key: '财务部', count: 2 },
      ],
      byLevel: [{ key: 'L1', count: 5 }],
      byStatus: [{ key: 'active', count: 5 }],
    }),
    projects: () => [
      {
        company: COMPANY.slug,
        projectId: 'p-1',
        name: 'Demo 项目',
        platform: 'taiga',
        totalIssues: 2,
        byState: [{ state: 'open', count: 2 }],
      },
      { company: 'other', projectId: 'p-x', name: '别家项目（不得外露）' },
    ],
    issues: (query) => ({
      items: [
        {
          company: COMPANY.slug,
          issueId: 'i-1',
          title: '单据一',
          state: query.state ?? 'open',
          updatedAt: '2026-10-27T00:00:00.000Z',
          assignee: 'E-001',
          labels: ['外部'],
          secretColumn: '不得外露',
        } as unknown as ApiIssueView,
        { company: 'other', issueId: 'i-x', title: '别家单据（不得外露）', state: 'open' },
      ],
      total: 2,
    }),
    finance: () => ({
      company: COMPANY.slug,
      currency: 'CNY',
      window: { from: '2026-10-01', to: '2026-10-31' },
      // 缺 monthly 源：默认响应应给 unknown 段（无 value，不补 0）
      segments: [
        { source: 'budget', state: 'observed', value: 1000, unit: 'CNY' },
        { source: 'events', state: 'observed', value: 200, unit: 'CNY' },
      ],
    }),
    reports: () => [
      { company: COMPANY.slug, file: '2026-10.md', bytes: 128, generatedAt: NOW },
      { company: 'other', file: 'other.md', bytes: 1 },
    ],
    agentCard: () => ({
      company: COMPANY.slug,
      name: 'Demo 公司',
      slug: COMPANY.slug,
      version: '1.0.0',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
      capabilities: ['intake', 'read'],
    }),
  }
  return { ...base, ...overrides }
}

/** 头驱动认证器：partner:ok / signed:ok / root:key / forbidden / 其余 401 */
export function makeAuth(): ApiIntakeAuthenticator {
  return (input) => {
    const credential = input.headers.get('x-sn-credential') ?? ''
    if (credential === 'root:key') {
      return {
        ok: true,
        auth: { tier: 'partner', credentialRef: 'credential:root' },
        caller: { callerId: 'root-holder', kind: 'program', programRef: 'ROOT' },
        credentialClass: 'root',
      }
    }
    if (credential === 'forbidden') {
      return { ok: false, status: 403, subcause: 'credential-revoked' }
    }
    if (credential === 'partner:ok') {
      return {
        ok: true,
        auth: { tier: 'partner', credentialRef: 'credential:partner-1' },
        caller: { callerId: 'partner-1', kind: 'program', programRef: 'PARTNER' },
      }
    }
    if (credential === 'signed:ok') {
      return {
        ok: true,
        auth: { tier: 'signed', hmacRef: 'hmac:partner-2', timestamp: '1', nonce: 'n-1' },
        caller: { callerId: 'partner-2', kind: 'program', programRef: 'PARTNER' },
      }
    }
    return { ok: false, status: 401, subcause: 'credential-missing' }
  }
}

export interface AppOverrides {
  readonly company?: CompanyRef
  readonly obs?: ApiObservationReadFace
  readonly gate?: GatePort
  readonly readers?: ApiReadSources
  readonly auth?: ApiIntakeAuthenticator
  readonly hooks?: readonly ApiHookSource[]
  readonly events?: ApiEventFeed
  readonly subscriptions?: ApiSubscriptionPolicy
  readonly log?: (line: string) => void
}

/** 造被测 app（缺省完整 fake 栈；可选覆盖单槽） */
export function makeApp(overrides: AppOverrides = {}): ApiApp {
  const options: ApiAppOptions = {
    company: overrides.company ?? COMPANY,
    obs: overrides.obs ?? makeObs(),
    gate: overrides.gate ?? makeGate().gate,
    readers: overrides.readers ?? makeReaders(),
    auth: overrides.auth ?? makeAuth(),
    ...(overrides.hooks !== undefined ? { hooks: overrides.hooks } : {}),
    ...(overrides.events !== undefined ? { events: overrides.events } : {}),
    ...(overrides.subscriptions !== undefined ? { subscriptions: overrides.subscriptions } : {}),
    ...(overrides.log !== undefined ? { log: overrides.log } : {}),
  }
  return createApiApp(options)
}

/** JSON 响应解析 */
export async function jsonBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}

/** 带认证头的 JSON POST */
export function postJson(
  app: ApiApp,
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'x-sn-credential': 'partner:ok' },
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

/** 合法触发面 body（测试按需覆盖） */
export function intakeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dedupKey: 'idem-0001',
    commissioner: { mapped: true, caller: { callerId: 'partner-1', kind: 'program', programRef: 'PARTNER' } },
    body: { title: '外部需求（只落单不派工）' },
    ...overrides,
  }
}

/** hook 签名头（签名串＝timestamp.nonce.rawBody；测试与实现同源判据） */
export function hookHeaders(
  secret: string,
  rawBody: string,
  nonce: string,
  timestamp: number = NOW_MS,
): Record<string, string> {
  const signature = createHmac('sha256', secret).update(`${String(timestamp)}.${nonce}.${rawBody}`).digest('hex')
  return {
    'content-type': 'application/json',
    'x-sn-timestamp': String(timestamp),
    'x-sn-nonce': nonce,
    'x-sn-signature': signature,
  }
}

/** 默认订阅策略（allowlist 只放一个公网域名；私网/回环一律拒） */
export const SUBSCRIPTION_POLICY: ApiSubscriptionPolicy = Object.freeze({
  allowlist: Object.freeze(['hooks.partner.example']),
})
