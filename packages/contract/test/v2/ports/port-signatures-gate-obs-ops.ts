/**
 * port-signatures-gate-obs-ops.ts —— ports 类型级钉面（gate/obs/ops 三件）
 *
 * 定位：**只供 `typecheck:v2` 编译期校验**，不被 vitest 收集（非 `.test.ts`）。
 * `port-gate-obs-ops.test.ts` 导入两函数只为断言其存在，不执行端口调用（端口无实现）。
 * 依据：plan/05 IMPL-03-04、docs/v2/14 §1.8、docs/v2/05 §四、docs/v2/08 §4.1/§4.4、
 *       docs/v2/11 REC-OBS-01/02、REC-WORK-18、docs/v2/09 ENU-52/57/59/119/120/121/122。
 *
 * 两段：
 *   1. `compileOnlyGateObsOpsSurface`：最小合法值＋三端口方法签名调用；
 *   2. `pinRejectedShapes`：关键拒绝条件的**类型级**钉子（`@ts-expect-error` 放行即红）。
 */
import type * as Contract from '../../../src/index.ts'
import type * as Gate from '../../../src/ports/gate.ts'
import type * as Obs from '../../../src/ports/obs.ts'
import type * as Ops from '../../../src/ports/ops.ts'
import type * as defPort from '../../../src/ports/def.ts'

// ─────────────────────────────────────────────────────────────────────────────
// 编译期钉面（只供 `typecheck:v2`；运行期不执行端口逻辑）
// ─────────────────────────────────────────────────────────────────────────────

function stub<T>(): T {
  return {} as T
}

/** 最小合法值＋方法签名调用（编译期检查；三端口无实现，不伪造运行）。 */
export function compileOnlyGateObsOpsSurface(): void {
  const company: defPort.CompanyRef = { companyId: 'company-1', slug: 'acme' }
  const caller: defPort.CallerRef = {
    callerId: 'person-1',
    kind: 'employment',
    personId: 'person-1',
  }
  const grant: defPort.GrantRef = {
    recordId: 'grant-1',
    version: { recordId: 'grant-1', version: 1 },
    grantClass: 'delegation',
  }
  const signature: defPort.Signature = { actorKind: 'person', actorRef: 'person-1' }
  const ctx: defPort.CallContext = { company, caller, authority: [grant], signature }
  const rc: defPort.ReadContext = {
    readScope: { company, fields: ['state'], purpose: 'port-smoke' },
    caller,
  }
  const proof: defPort.ProofBoundary = { proves: ['shape'], doesNotProve: ['autonomy'] }
  const reconcile: defPort.ReconcileHandle = { required: false, reason: 'no-external-effect' }

  // —— PORT-GATE：外部意图只落单不派工 ——
  const key: Gate.IntentKey = {
    company,
    source: 'api',
    requestKind: 'request',
    key: 'dedup-1',
  }
  const intent: Gate.ExternalIntent = {
    ...key,
    toolScope: 'intake_comment',
    auth: { tier: 'signed', hmacRef: 'hmac-1', timestamp: '2026-11-01T00:00:00Z', nonce: 'n-1' },
    commissioner: { mapped: false, externalPrincipal: 'partner-1', identityMappingBasis: 'map-1' },
    dispatcherAnchor: { defaulted: true, resolvedBy: 'intake_governance_position' },
    submittedBy: caller,
    body: {},
    payloadDigest: 'sha256:intent',
    correlation: 'corr-1',
    receivedAt: '2026-11-01T00:00:01Z',
  }
  const receipt: Gate.IntentReceipt = {
    intentRef: 'intent-1',
    identity: key,
    outcome: 'queued',
    commissionerRef: 'commissioner-1',
    anchorRef: 'anchor-1',
    queuedAt: '2026-11-01T00:00:02Z',
    deduped: false,
  }
  const notification: Gate.NotificationEnvelope = {
    notificationId: 'notification-1',
    dedupKey: 'dedup-1',
    company,
    kind: 'state_change',
    title: 'title',
    body: 'body',
    subscriptionRefs: ['sub-1'],
    evidenceRefs: ['evidence-1'],
  }
  const delivery: Gate.DeliveryReceipt = {
    notificationId: 'notification-1',
    dedupKey: 'dedup-1',
    deliveryState: 'sent',
    deliveredAt: '2026-11-01T00:00:03Z',
    targets: ['sub-1'],
    evidenceRefs: ['evidence-1'],
    deduped: false,
    reconcile,
  }
  const gate = stub<Gate.GatePort>()
  gate.receiveIntent(intent, ctx)
  gate.receipt(key, rc)
  gate.notify(notification, ctx)
  void receipt
  void delivery

  // —— PORT-OBS：只读投影＋六态＋未知不补 0 ——
  const view: Obs.ViewId = { viewName: 'MON-04', company }
  const source: Obs.ProjectionSource = {
    endpoint: { endpointId: 'endpoint-1', kind: 'yt', location: 'internal' },
    generation: 3,
  }
  const projection: Obs.Projection = {
    view,
    projectionRuleVersion: 'proj@1',
    authoritativeSource: source,
    sourceCursor: 'cursor-42',
    generatedAt: '2026-11-01T00:00:04Z',
    dataValidWindow: { from: '2026-11-01T00:00:00Z', to: '2026-11-01T01:00:00Z' },
    knowledgeScope: ['state'],
    viewCompleteness: 'incomplete',
    stateAssignments: [{ face: 'MON-04', state: 'unknown', basis: 'no-material', lastTrustedCursor: 'cursor-42' }],
    readOnly: true,
    mutatesFacts: false,
  }
  const numericReading: Obs.MetricReading = {
    metric: 'in_flight',
    state: 'observed',
    value: 3,
    unit: 'count',
    basis: 'source-cursor',
  }
  const unknownReading: Obs.MetricReading = {
    metric: 'rework',
    state: 'unknown',
    stateNote: '材料不足',
    lastTrustedCursor: 'cursor-42',
  }
  const health: Obs.HealthReport = {
    service: 'daemon',
    checkedAt: '2026-11-01T00:00:05Z',
    availability: 'unavailable',
    resources: [
      { resource: 'cpu', reading: unknownReading, sampledAt: '2026-11-01T00:00:05Z' },
    ],
    autonomyProven: false,
    proofBoundary: proof,
  }
  const fault: Obs.ProjectionFault = {
    failureKind: 'collection_interrupted',
    occurredAt: '2026-11-01T00:00:00Z',
    discoveredAt: '2026-11-01T00:10:00Z',
    affectedViews: [view],
    lastTrustedCursor: 'cursor-42',
    displayEffect: 'unknown',
    rootCauseClass: 'source',
  }
  const faultRef: Obs.FaultRef = {
    recordId: 'fault-1',
    version: 1,
    recordedAs: 'projection_fault',
    mutatesFacts: false,
  }
  const clock: Obs.ClockReading = { now: '2026-11-01T00:00:06Z', source: 'injected' }
  const identifier: Obs.Identifier = { kind: 'record', value: 'record-1', sortable: true }
  const obs = stub<Obs.ObservationPort>()
  obs.snapshot(view, rc)
  obs.reportFault(fault, ctx)
  obs.clock()
  obs.newId('record')
  obs.health(rc)
  void projection
  void numericReading
  void health
  void faultRef
  void clock
  void identifier

  // —— PORT-OPS：供能引用＋控制面申报＋紧急处置 ——
  const authorization: Ops.OpsAuthorization = {
    poweredBy: 'policy_verdict',
    commandRef: 'command-1',
    verdict: 'permitted',
  }
  const declaration: Ops.ControlPlaneDeclaration = {
    action: 'ctl-guards',
  }
  const bundleReq: Ops.ExportBundleRequest = {
    authorization,
    reason: '导出公司包',
    bundleKind: 'company-package',
    includes: ['definitions'],
    scope: ['DOM-01'],
    outboundScanRef: 'scan-1',
    destination: 'bundles/company-1',
  }
  const migrationReq: Ops.MigrationCandidateRequest = {
    authorization,
    reason: '候选端点',
    domain: 'DOM-02',
    sourceEndpoint: source.endpoint,
    sourceGeneration: 3,
    comparedSources: ['store'],
  }
  const migration: Ops.MigrationCandidate = {
    candidateRef: 'candidate-1',
    activatable: false,
    requiresActivationDecision: true,
    reconcileRef: 'reconcile-1',
    blocking: [],
  }
  const preserveReq: Ops.PreserveRequest = {
    authorization,
    reason: '保全',
    subjectRef: 'record-1',
    evidenceRefs: ['evidence-1'],
    gaps: [],
    retainUntil: '2026-12-01T00:00:00Z',
    irreversibleHarm: false,
  }
  const breakReq: Ops.CircuitBreakRequest = {
    authorization,
    reason: '止损',
    requiresPlatformWrite: true,
    declaration,
    target: { kind: 'work', workRef: 'work-1' },
    fence: { scope: ['executors'], stopInjection: true, revokeDerived: true, mechanismProven: false },
    triggerRef: 'trigger-1',
  }
  const stopReq: Ops.EmergencyStopRequest = {
    authorization,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'trigger-1',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    notAuthorized: ['未撤销授权'],
    evidencePreserved: ['evidence-1'],
    notified: ['position-1'],
    review: { reviewerRef: 'position-2', due: '2026-11-02T00:00:00Z' },
  }
  const stopReceipt: Ops.StopReceipt = {
    recordId: 'stop-1',
    version: 1,
    actionsTaken: ['冻结出工段'],
    notAuthorized: ['未撤销授权'],
    evidencePreserved: ['evidence-1'],
    notified: ['position-1'],
    review: { reviewerRef: 'position-2', due: '2026-11-02T00:00:00Z' },
    effectOnOriginal: { retroactiveApproval: false, equalsRecovery: false, normalizable: false },
    outcome: 'unknown',
    reconcile: { required: true, query: { recordType: 'REC-WORK-18', keys: { recordId: 'stop-1' } } },
  }
  const ops = stub<Ops.OperationsPort>()
  ops.exportBundle(bundleReq, ctx)
  ops.migrationCandidate(migrationReq, ctx)
  ops.preserve(preserveReq, ctx)
  ops.circuitBreak(breakReq, ctx)
  ops.emergencyStop(stopReq, ctx)
  void migration
  void stopReceipt

  // —— 导出面收口：新形状可经包根（src/index.ts）取用，旧形状未破 ——
  const viaRoot: Contract.PortResult<Contract.IntentReceipt> = { kind: 'ok', value: receipt }
  const viaRootProjection: Contract.Projection = projection
  const viaRootStop: Contract.StopReceipt = stopReceipt
  const legacyNotifier: Contract.Notifier = { send: () => Promise.resolve() }
  const legacyPage: Contract.Page<number> = { items: [1] }
  const legacyResult: Contract.Result<number, string> = { kind: 'ok', value: 1 }
  const legacyNotification: Contract.Notification = { kind: 'k', title: 't', body: 'b' }
  // 13/13 端口接口名可经包根取用（收口后无重名歧义、无被静默吞掉的导出）
  const portInterfaces: readonly [
    Contract.DefinitionPort,
    Contract.RegistrationPort,
    Contract.AuthorizationPort,
    Contract.HumanResourcesPort,
    Contract.WorkPort,
    Contract.ExecutionPort,
    Contract.WorkspacePort,
    Contract.EvidencePort,
    Contract.HistoryPort,
    Contract.TrustPort,
    Contract.GatePort,
    Contract.ObservationPort,
    Contract.OperationsPort,
  ] = [
    stub<Contract.DefinitionPort>(),
    stub<Contract.RegistrationPort>(),
    stub<Contract.AuthorizationPort>(),
    stub<Contract.HumanResourcesPort>(),
    stub<Contract.WorkPort>(),
    stub<Contract.ExecutionPort>(),
    stub<Contract.WorkspacePort>(),
    stub<Contract.EvidencePort>(),
    stub<Contract.HistoryPort>(),
    stub<Contract.TrustPort>(),
    stub<Contract.GatePort>(),
    stub<Contract.ObservationPort>(),
    stub<Contract.OperationsPort>(),
  ]
  void portInterfaces
  void viaRoot
  void viaRootProjection
  void viaRootStop
  void legacyNotifier
  void legacyPage
  void legacyResult
  void legacyNotification
}

/**
 * 关键拒绝条件钉面（`@ts-expect-error` 放行即类型门红——每条注记写明拒的是什么）。
 * 本函数只供 `typecheck:v2`；不在运行期执行。
 */
export function pinRejectedShapes(): void {
  const company: defPort.CompanyRef = { companyId: 'company-1', slug: 'acme' }
  const key: Gate.IntentKey = { company, source: 'api', requestKind: 'request', key: 'k1' }
  const receipt: Gate.IntentReceipt = {
    intentRef: 'intent-1',
    identity: key,
    outcome: 'queued',
    commissionerRef: 'c-1',
    anchorRef: 'a-1',
    queuedAt: '2026-11-01T00:00:00Z',
    deduped: false,
  }

  // 消息当承诺：入口回执不得携带受理结论（受理归 PORT-WORK.recordIntake）
  const promised: Gate.IntentReceipt = {
    ...receipt,
    // @ts-expect-error —— intakeVerdict 恒不存在：202＝已入队≠已受理
    intakeVerdict: 'accepted',
  }
  // 消息当承诺：入口回执不得携带验收/接受时点
  const accepted: Gate.IntentReceipt = {
    ...receipt,
    // @ts-expect-error —— acceptedAt 恒不存在：入口不宣告接受
    acceptedAt: '2026-11-01T00:00:01Z',
  }
  // 通知发送≠对方接受：送达回执不得携带「对方已接受」
  const delivered: Gate.DeliveryReceipt = {
    notificationId: 'n-1',
    dedupKey: 'd-1',
    deliveryState: 'sent',
    targets: ['sub-1'],
    evidenceRefs: ['e-1'],
    deduped: false,
    reconcile: { required: false, reason: 'no-effect' },
    // @ts-expect-error —— acceptedBy 恒不存在：发送与接受分离
    acceptedBy: 'partner-1',
  }
  // 单静态 token＝禁止形态：三档凭证无 token 槽
  const staticToken: Gate.IntentAuth = {
    tier: 'partner',
    credentialRef: 'cred-1',
    // @ts-expect-error —— token 槽不存在（ENU-120 三档）
    token: 'static-token',
  }
  // 公开档不入站：public 只读，不属落单入口
  const publicIntake: Gate.IntentAuth = {
    // @ts-expect-error —— public 档只读，不得落单
    tier: 'public',
  }
  // 只读级调用落单入口＝越级
  const overScope = {
    ...key,
    // @ts-expect-error —— toolScope 恒 intake_comment：只读级不得落单
    toolScope: 'read_only',
    auth: { tier: 'partner', credentialRef: 'cred-1' } as Gate.IntentAuth,
    commissioner: { mapped: true, caller: { callerId: 'p-1', kind: 'employment' } } as Gate.CommissionerRef,
    dispatcherAnchor: { anchor: { callerId: 'p-2', kind: 'position' } } as Gate.DispatcherAnchor,
    submittedBy: { callerId: 'p-1', kind: 'employment' } as defPort.CallerRef,
    body: {},
    payloadDigest: 'sha256:x',
    receivedAt: '2026-11-01T00:00:00Z',
  } satisfies Gate.ExternalIntent
  // 外部委托主体不留空：未映射须显式声明映射依据
  // @ts-expect-error —— identityMappingBasis 必填（未映射不得留空）
  const anonymous: Gate.CommissionerRef = {
    mapped: false,
    externalPrincipal: 'partner-1',
    identityMappingBasis: undefined,
  }
  // 派单人锚缺省不是「无锚」：defaulted:true 不得再携 anchor
  const bothAnchors: Gate.DispatcherAnchor = {
    defaulted: true,
    resolvedBy: 'intake_governance_position',
    // @ts-expect-error —— 缺省与显式锚互斥
    anchor: { callerId: 'p-2', kind: 'position' },
  }

  // 监控改事实：投影恒只读
  const writableProjection = {
    view: { viewName: 'MON-04', company },
    projectionRuleVersion: 'proj@1',
    authoritativeSource: {
      endpoint: { endpointId: 'e-1', kind: 'yt', location: 'internal' },
      generation: 1,
    },
    sourceCursor: 'cursor-1',
    generatedAt: '2026-11-01T00:00:00Z',
    dataValidWindow: { from: '2026-11-01T00:00:00Z', to: '2026-11-01T01:00:00Z' },
    knowledgeScope: ['state'],
    viewCompleteness: 'unknown',
    stateAssignments: [
      { face: 'MON-04', state: 'unknown', basis: 'gap', lastTrustedCursor: 'cursor-1' },
    ],
    readOnly: true,
    // @ts-expect-error —— mutatesFacts 恒 false：监控不改事实（NEG-MON-03）
    mutatesFacts: true,
  } satisfies Obs.Projection
  // 未知不补 0：unknown 态无 value 槽
  // @ts-expect-error —— unknown 态无 value 槽，不得补 0（NEG-MON-01）
  const zeroForUnknown: Obs.MetricReading = {
    metric: 'rework',
    state: 'unknown',
    stateNote: '材料不足',
    lastTrustedCursor: 'cursor-1',
    value: 0,
  }
  // 受影响视图只允许「未知/受损」：不得显示为零/健康
  const healthyFault = {
    failureKind: 'stale_view',
    occurredAt: '2026-11-01T00:00:00Z',
    discoveredAt: '2026-11-01T00:01:00Z',
    affectedViews: [{ viewName: 'MON-04', company }],
    lastTrustedCursor: 'cursor-1',
    // @ts-expect-error —— displayEffect 只取 unknown|impaired
    displayEffect: 'healthy',
    rootCauseClass: 'source',
  } satisfies Obs.ProjectionFault
  // 三不可合并态不得并入健康
  const mergedHealth = {
    service: 'daemon',
    checkedAt: '2026-11-01T00:00:00Z',
    // @ts-expect-error —— availability 不得写 healthy（ENU-57 三不可合并）
    availability: 'healthy',
    resources: [],
    autonomyProven: false,
    proofBoundary: { proves: [], doesNotProve: [] },
  } satisfies Obs.HealthReport
  // 在线率不证明自治
  const autonomyClaim = {
    service: 'daemon',
    checkedAt: '2026-11-01T00:00:00Z',
    availability: 'available',
    resources: [],
    // @ts-expect-error —— autonomyProven 恒 false
    autonomyProven: true,
    proofBoundary: { proves: [], doesNotProve: [] },
  } satisfies Obs.HealthReport

  // 迁移候选≠激活
  const activated: Ops.MigrationCandidate = {
    candidateRef: 'candidate-1',
    // @ts-expect-error —— activatable 恒 false（激活属公司决定，不属部署配置）
    activatable: true,
    requiresActivationDecision: true,
    reconcileRef: 'reconcile-1',
    blocking: [],
  }
  // 自身不新增权源：供能只认 PORT-AUTH 结论/决定
  const selfGranted: Ops.OpsAuthorization = {
    poweredBy: 'policy_verdict',
    commandRef: 'command-1',
    verdict: 'permitted',
    // @ts-expect-error —— selfGranted 槽不存在（禁自授权）
    selfGranted: true,
  }
  // comment 借道控制面动作＝违规（ENU-119）
  const commentBypass = {
    // @ts-expect-error —— 控制面动作只能是 ctl- 词族（transition 不得显示为 comment）
    action: 'comment',
  } satisfies Ops.ControlPlaneDeclaration
  // 借道 op 须显式降级标记
  // @ts-expect-error —— 迁移期 op 借道须带 degradedBypass 降级标记
  const opWithoutMark: Ops.ControlPlaneDeclaration = {
    action: 'op',
  }
  // 平台触达申报与动作申报同生同灭
  // @ts-expect-error —— requiresPlatformWrite:true 必带控制面动作申报
  const touchWithoutDeclaration: Ops.OpsPlatformTouch = {
    requiresPlatformWrite: true,
  }
  // 紧急止损的「未授权清单」不得为空（空集不冒充未越权）
  const emptyNotAuthorized = {
    authorization: { poweredBy: 'decision', decisionRef: 'decision-1' },
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'trigger-1',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    // @ts-expect-error —— notAuthorized 非空元组
    notAuthorized: [],
    evidencePreserved: [],
    notified: ['position-1'],
    review: { reviewerRef: 'position-2', due: '2026-11-02T00:00:00Z' },
  } satisfies Ops.EmergencyStopRequest
  // 止损不追认原动作、不等于恢复、不推广为常态
  const stopEffects: Ops.StopReceipt['effectOnOriginal'] = {
    retroactiveApproval: false,
    equalsRecovery: false,
    // @ts-expect-error —— normalizable 恒 false（REC-WORK-18.effect_on_original）
    normalizable: true,
  }

  void promised
  void accepted
  void delivered
  void staticToken
  void publicIntake
  void overScope
  void anonymous
  void bothAnchors
  void writableProjection
  void zeroForUnknown
  void healthyFault
  void mergedHealth
  void autonomyClaim
  void activated
  void selfGranted
  void commentBypass
  void opWithoutMark
  void touchWithoutDeclaration
  void emptyNotAuthorized
  void stopEffects
}
