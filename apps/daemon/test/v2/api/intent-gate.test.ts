/**
 * assembly/intent/gate —— PORT-GATE 生产装配 V2 测试（studio-dev-542）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §二（PORT-GATE 落点 assembly/intent）、§四（只落单不派工；四槽意图保留键；
 *     同键同内容 deduped / 同键异内容 rejected_idempotency；receipt 快照未命中＝undefined）；
 *   - docs/v2/15 §一 SEC-FC-07（注入缺失／形状坏＝拒启，不静默降级）；
 *   - docs/17-§2（意图经 engine.ingest 入队，主循环相位不增删）、§6（落单物化经既有
 *     webhook 消费件 → gated platform 写面）。
 *
 * 定向红→绿（本单验收②）：
 *   红：`wireServeApi` 未注入 gate → 默认 fail-closed 面 `Err(port-gate-not-wired)`、零入队；
 *   绿：注入 `createIntentGate` → `Ok(queued)`、恰一次入队、回执可查；负向场景（越权/
 *   缺证/坏形状/幂等冲突）全部 Err 且零入队。
 */
import { describe, expect, it } from 'vitest'
import type {
  CallContext,
  CallerRef,
  CompanyRef,
  ExternalIntent,
  IntentKey,
  InvokeIntent,
  ReadContext,
} from '@studio-next/contract'
import { buildFailClosedGate, wireServeApi } from '../../../src/assembly/api/serve-face.ts'
import { createIntentGate } from '../../../src/assembly/intent/gate.ts'
import { checkWebhookPayload } from '../../../src/engine/intents/taxonomy.ts'

const COMPANY: CompanyRef = { companyId: 'studio-dev', slug: 'studio-dev' }
const OTHER: CompanyRef = { companyId: 'other', slug: 'other' }
const NOW = 1_790_000_000_000
const CALLER: CallerRef = { callerId: 'api:external-1', kind: 'program', programRef: 'external-api' }

const CTX: CallContext = {
  company: COMPANY,
  caller: CALLER,
  authority: [],
  signature: { actorKind: 'system', actorRef: 'api:intake', onBehalfOf: 'commissioner:external-1' },
}

const READ_CTX: ReadContext = {
  readScope: { company: COMPANY, fields: ['intent.receipt'], purpose: 'request-status' },
  caller: CALLER,
}

function makeIntent(overrides: Partial<ExternalIntent> = {}): ExternalIntent {
  const base: ExternalIntent = {
    company: COMPANY,
    source: 'http',
    requestKind: 'request',
    key: 'idem-0001',
    toolScope: 'intake_comment',
    auth: { tier: 'partner', credentialRef: 'credential:partner-1' },
    commissioner: { mapped: true, caller: CALLER },
    dispatcherAnchor: { defaulted: true, resolvedBy: 'intake_governance_position' },
    submittedBy: CALLER,
    body: { title: '外部需求（只落单不派工）', detail: '正文' },
    payloadDigest: 'sha256:fixture-1',
    receivedAt: new Date(NOW).toISOString(),
  }
  return { ...base, ...overrides } as ExternalIntent
}

function keyOf(intent: ExternalIntent): IntentKey {
  return { company: intent.company, source: intent.source, requestKind: intent.requestKind, key: intent.key }
}

/** 装配替身：`readSnapshot` 在装配期不被调用（只读闭包） */
function snapshot(): never {
  throw new Error('readSnapshot 不应在装配期被调用')
}

function gateWith(sink: InvokeIntent[]) {
  return createIntentGate({
    company: COMPANY,
    clock: () => NOW,
    enqueue: (intent) => sink.push(intent),
  })
}

describe('PORT-GATE · 定向红（未注入 gate）', () => {
  it('默认 fail-closed 面：receiveIntent=Err(port-gate-not-wired)，不伪造 queued 回执', () => {
    const result = buildFailClosedGate().receiveIntent(makeIntent(), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') {
      expect(result.error.subcause).toBe('port-gate-not-wired')
      expect(result.error.sideEffectPossible).toBe(false)
    }
  })

  it('wireServeApi 未注入 gate：装配面仍走默认拒（拒绝而非静默）', () => {
    const wiring = wireServeApi({ company: COMPANY, readSnapshot: snapshot, port: 0, clock: () => NOW, log: () => {} })
    const result = wiring.assembly.ports.gate.receiveIntent(makeIntent(), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('port-gate-not-wired')
  })
})

describe('PORT-GATE · 定向绿（注入生产 gate）', () => {
  it('wireServeApi 注入 gate：receiveIntent=Ok(queued) 且恰一次入队，payload 过 webhook 消费件形状', () => {
    const sink: InvokeIntent[] = []
    const wiring = wireServeApi({
      company: COMPANY,
      readSnapshot: snapshot,
      port: 0,
      clock: () => NOW,
      log: () => {},
      gate: gateWith(sink),
    })
    const result = wiring.assembly.ports.gate.receiveIntent(makeIntent(), CTX)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.value.outcome).toBe('queued')
    expect(result.value.deduped).toBe(false)
    expect(sink).toHaveLength(1)
    const enqueued = sink[0]
    expect(enqueued?.kind).toBe('webhook')
    expect(enqueued?.company).toBe(COMPANY.slug)
    expect(enqueued?.dedupKey).toBe('request:idem-0001')
    expect(typeof checkWebhookPayload(enqueued?.payload)).toBe('object')
  })

  it('同键同内容重投：deduped=true、intentRef 不变、不产生第二次入队', () => {
    const sink: InvokeIntent[] = []
    const gate = gateWith(sink)
    const first = gate.receiveIntent(makeIntent(), CTX)
    const second = gate.receiveIntent(makeIntent(), CTX)
    expect(first.kind).toBe('ok')
    expect(second.kind).toBe('ok')
    if (first.kind !== 'ok' || second.kind !== 'ok') return
    expect(second.value.deduped).toBe(true)
    expect(second.value.intentRef).toBe(first.value.intentRef)
    expect(sink).toHaveLength(1)
    expect(gate.pending).toBe(1)
  })

  it('同键异内容：Err(rejected_idempotency)，零第二次入队', () => {
    const sink: InvokeIntent[] = []
    const gate = gateWith(sink)
    expect(gate.receiveIntent(makeIntent(), CTX).kind).toBe('ok')
    const conflict = gate.receiveIntent(makeIntent({ payloadDigest: 'sha256:fixture-2' }), CTX)
    expect(conflict.kind).toBe('err')
    if (conflict.kind === 'err') expect(conflict.error.category).toBe('rejected_idempotency')
    expect(sink).toHaveLength(1)
  })

  it('receipt：命中返回既有回执；未命中 Ok(undefined)（快照未命中≠不存在）', () => {
    const sink: InvokeIntent[] = []
    const gate = gateWith(sink)
    const intent = makeIntent()
    const queued = gate.receiveIntent(intent, CTX)
    expect(queued.kind).toBe('ok')
    const hit = gate.receipt(keyOf(intent), READ_CTX)
    expect(hit.kind).toBe('ok')
    if (hit.kind === 'ok') expect(hit.value?.intentRef).toBe(queued.kind === 'ok' ? queued.value.intentRef : undefined)
    const miss = gate.receipt({ ...keyOf(intent), key: 'idem-missing' }, READ_CTX)
    expect(miss.kind).toBe('ok')
    if (miss.kind === 'ok') expect(miss.value).toBeUndefined()
  })
})

describe('PORT-GATE · 装配接线行（不发监听；监听面归 Lead 部署窗口）', () => {
  it('wireServeApi({enqueueIntent}) 装配期登记「PORT-GATE 已接线」', () => {
    const logs: string[] = []
    wireServeApi({
      company: COMPANY,
      readSnapshot: snapshot,
      port: 0,
      clock: () => NOW,
      log: (line) => logs.push(line),
      enqueueIntent: () => {},
    })
    const wiredLine = logs.find((line) => line.includes('PORT-GATE 已接线：receiveIntent→engine.ingest'))
    expect(wiredLine).toBeDefined()
    // 原始装配行入测试输出（证据归档，不只断言）
    console.log(wiredLine)
  })
})

describe('PORT-GATE · 负向/越权/缺证（全部 Err 且零入队）', () => {
  it('跨公司意图：Err(rejected_forbidden)', () => {
    const sink: InvokeIntent[] = []
    const result = gateWith(sink).receiveIntent(makeIntent({ company: OTHER }), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('cross-company-intent')
    expect(sink).toHaveLength(0)
  })

  it('工具面越级（只读档调用落单入口）：Err(rejected_forbidden)', () => {
    const sink: InvokeIntent[] = []
    const result = gateWith(sink).receiveIntent(makeIntent({ toolScope: 'read_only' as never }), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('intent-scope-escalation')
    expect(sink).toHaveLength(0)
  })

  it('缺证/坏凭证档：Err(rejected_authority)', () => {
    const sink: InvokeIntent[] = []
    const result = gateWith(sink).receiveIntent(makeIntent({ auth: { tier: 'public' } as never }), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.category).toBe('rejected_authority')
    expect(sink).toHaveLength(0)
  })

  it('payload 缺 title：Err(rejected_precondition)（不落匿名单）', () => {
    const sink: InvokeIntent[] = []
    const result = gateWith(sink).receiveIntent(makeIntent({ body: { detail: '无标题' } }), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('intent-payload-shape')
    expect(sink).toHaveLength(0)
  })

  it('system 署名缺 onBehalfOf：Err（SEC-SIG-01 构造期非法）', () => {
    const sink: InvokeIntent[] = []
    const badCtx = { ...CTX, signature: { actorKind: 'system', actorRef: 'api:intake' } } as unknown as CallContext
    const result = gateWith(sink).receiveIntent(makeIntent(), badCtx)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('call-context-invalid')
    expect(sink).toHaveLength(0)
  })

  it('入队面抛错：Err(unavailable) 且不登记回执（可重投，不伪造 queued）', () => {
    const gate = createIntentGate({
      company: COMPANY,
      clock: () => NOW,
      enqueue: () => {
        throw new Error('queue down')
      },
    })
    const result = gate.receiveIntent(makeIntent(), CTX)
    expect(result.kind).toBe('err')
    if (result.kind === 'err') {
      expect(result.error.subcause).toBe('intent-enqueue-failed')
      expect(result.error.retryable).toBe(true)
    }
    expect(gate.pending).toBe(0)
  })

  it('receipt 跨公司读：Err(rejected_forbidden)', () => {
    const gate = gateWith([])
    const result = gate.receipt(
      {
        company: OTHER,
        source: 'http',
        requestKind: 'request',
        key: 'idem-0001',
      },
      READ_CTX,
    )
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('cross-company-read')
  })

  it('notify 未接线：Err(notify-channel-not-wired)（保留默认拒，不静默）', () => {
    const result = gateWith([]).notify(
      {
        notificationId: 'n-1',
        dedupKey: 'd-1',
        company: COMPANY,
        kind: 'test',
        title: 't',
        body: 'b',
        subscriptionRefs: ['s-1'],
        evidenceRefs: ['e-1'],
      },
      CTX,
    )
    expect(result.kind).toBe('err')
    if (result.kind === 'err') expect(result.error.subcause).toBe('notify-channel-not-wired')
  })
})

describe('PORT-GATE · 装配 fail-closed', () => {
  it('缺 enqueue：CONFIG_INVALID 拒启（注入缺失≠空转）', () => {
    expect(() => createIntentGate({ company: COMPANY, clock: () => NOW } as never)).toThrowError(/CONFIG_INVALID/)
  })

  it('缺公司维：CONFIG_INVALID 拒启', () => {
    expect(() => createIntentGate({ company: { companyId: '', slug: '' }, clock: () => NOW, enqueue: () => {} } as never)).toThrowError(
      /CONFIG_INVALID/,
    )
  })
})
