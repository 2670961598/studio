/**
 * port-signatures-rest.ts —— ports 类型级冒烟（其余五端口：EXEC/WS/EVD/HIST/TRUST）
 *
 * 定位：**只供 `typecheck:v2` 编译期校验**，不被 vitest 收集（非 `.test.ts`）。
 * 与 `port-signatures-core.ts` 分件：单文件 ≤600 行（宪法 §十五.三尺寸阈），
 * 共享封套最小值在两件各自构造（测试辅助，不复制生产形状）。
 * 依据：docs/v2/14 §一/§二、plan/05 IMPL-03-03。
 */
import type * as Def from '../../../src/ports/def.ts'
import type * as Exec from '../../../src/ports/exec.ts'
import type * as Ws from '../../../src/ports/ws.ts'
import type * as Evd from '../../../src/ports/evd.ts'
import type * as Hist from '../../../src/ports/hist.ts'
import type * as Trust from '../../../src/ports/trust.ts'

function stub<T>(): T {
  return {} as T
}

/**
 * 本函数**只在 `typecheck:v2` 编译期生效**，测试运行时不调用：
 * 每个端口都以最小合法值调用一次方法签名，任何参数/返回类型漂移都会红类型门。
 */
export function compileOnlyRestPortSurface(): void {
  const company: Def.CompanyRef = { companyId: 'company-1', slug: 'acme' }
  const version: Def.VersionRef = { recordId: 'record-1', version: 1 }
  const caller: Def.CallerRef = {
    callerId: 'person-1',
    kind: 'employment',
    personId: 'person-1',
  }
  const grant: Def.GrantRef = {
    recordId: 'grant-1',
    version,
    grantClass: 'delegation',
  }
  const signature: Def.Signature = { actorKind: 'person', actorRef: 'person-1' }
  const ctx: Def.CallContext = { company, caller, authority: [grant], signature }
  const rc: Def.ReadContext = {
    readScope: { company, fields: ['title'], purpose: 'port-smoke' },
    caller,
  }
  const proof: Def.ProofBoundary = { proves: ['shape'], doesNotProve: ['runtime'] }

  const failure: Def.PortFailure = {
    category: 'rejected_forbidden',
    subcause: 'port-smoke',
    retryable: false,
    sideEffectPossible: false,
    reconcile: { required: false, reason: 'no-external-effect' },
    responsiblePosition: 'gateway',
  }
  const errResult: Def.PortResult<number> = { kind: 'err', error: failure }
  const okResult: Def.PortResult<number> = { kind: 'ok', value: 1 }
  void errResult
  void okResult

  // —— PORT-EXEC ——
  const binding: Exec.ExecutorBindingRef = {
    executor: 'dsh',
    bindingRef: 'binding-1',
    version: '0.1.0',
  }
  const selectionChain: Exec.SelectionChain = { fallback: binding }
  const preflight: Exec.LaunchPreflight = {
    policyProjectionRef: 'projection-1',
    policyProjectionDigest: 'sha256:projection',
    capabilityProbeRef: 'probe-1',
    secretConfirmationRef: 'secret-confirmation-1',
  }
  const brief: Exec.DispatchBrief = {
    workRef: 'work-1',
    contractRef: 'contract-1',
    planRef: 'plan-1',
    workspaceRef: 'workspace-1',
    secrets: [],
    host: { hostKind: 'dsh', version: '0.1.0', bindingRef: 'binding-1' },
    budget: { currency: 'USD', cap: 10 },
    watchdog: { heartbeatMs: 1_000, wallClockCapMs: 60_000, cancelGraceMs: 5_000 },
    evidenceObligation: { packageRef: 'package-1', requiredElements: ['authority'] },
    preflight,
  }
  const segment: Exec.SegmentRef = {
    segmentId: 'segment-1',
    workRef: 'work-1',
    attempt: 1,
    executor: 'dsh',
  }
  const projectionSegment: Exec.ProjectionSegmentValue = {
    enabled: true,
    sourceRefs: ['grant-1'],
  }
  const projection: Exec.PolicyProjection = {
    segments: {
      identity: projectionSegment,
      authority: projectionSegment,
      plan: projectionSegment,
      tools: projectionSegment,
      sandbox: projectionSegment,
      approval: projectionSegment,
      persona: projectionSegment,
      evidence: projectionSegment,
      validity: projectionSegment,
    },
    unsupportedSegments: [],
    digest: 'sha256:projection',
    authorityRefs: ['grant-1'],
    validity: { from: '2026-11-01T00:00:00Z' },
  }
  const executionPort = stub<Exec.ExecutionPort>()
  executionPort.selectExecutor(selectionChain, rc)
  executionPort.launch(brief, ctx)
  executionPort.observe(segment)
  executionPort.resultStats(segment, rc)
  executionPort.kill({ segment, reason: 'smoke', graceMs: 1_000 }, ctx)
  executionPort.compileProjection({
    companyId: 'company-1',
    workRef: 'work-1',
    planRef: 'plan-1',
    grantRefs: ['grant-1'],
    capabilityRefs: ['cap-1'],
    host: brief.host,
    secretTypes: ['per_task_shortlived'],
    validityFrom: '2026-11-01T00:00:00Z',
  })
  void projection

  // —— PORT-WS ——
  const zonePath: Ws.ZonePath = { zone: 'mutable_workspace', path: 'src/a.ts' }
  const workspacePort = stub<Ws.WorkspacePort>()
  workspacePort.resolve('mutable_workspace', rc)
  workspacePort.containment('src/a.ts', rc)
  workspacePort.realpath('src/a.ts', rc)
  workspacePort.read('src/a.ts', rc)
  workspacePort.write('src/a.ts', 'body', ctx)
  workspacePort.stageArtifact(
    {
      workRef: 'work-1',
      sourcePath: 'src/a.ts',
      targetZone: 'artifact_staging',
      mediaType: 'text/plain',
      digest: 'sha256:a',
      producedBy: 'person-1',
    },
    ctx,
  )
  void zonePath

  // —— PORT-EVD ——
  const evidenceItem: Evd.EvidenceItemDraft = {
    workRef: 'work-1',
    element: 'authority',
    sourceKind: 'record',
    sourceRef: 'grant-1',
    byteDigestState: 'present',
    proofBoundary: proof,
    recordedBy: caller,
    independentOfDeliverer: true,
  }
  const evidenceElement: Evd.EvidenceElement = {
    id: 'authority',
    state: 'present',
    refs: ['grant-1'],
  }
  const elements: Readonly<Record<Evd.EvidenceElementId, Evd.EvidenceElement>> = {
    authority: evidenceElement,
    input: evidenceElement,
    action: evidenceElement,
    acceptance_object: evidenceElement,
    self_check: evidenceElement,
    external_feedback: evidenceElement,
    cost: evidenceElement,
    open_items: evidenceElement,
  }
  const evidencePackage: Evd.PackageDraft = {
    workRef: 'work-1',
    elements,
    assembledBy: caller,
    proofBoundary: proof,
  }
  const evidencePort = stub<Evd.EvidencePort>()
  evidencePort.harvest(
    segment,
    { from: '2026-11-01T00:00:00Z', to: '2026-11-01T01:00:00Z' },
    ctx,
  )
  evidencePort.registerItem(evidenceItem, ctx)
  evidencePort.assemblePackage(evidencePackage, ctx)
  evidencePort.assessValue(
    {
      workRef: 'work-1',
      verdict: 'positive',
      accounts: {
        artifact_account: 'account-a',
        state_account: 'account-b',
        impact_account: 'account-c',
        cost_account: 'account-d',
      },
      judgedBy: caller,
      independent: true,
      proofBoundary: proof,
    },
    ctx,
  )
  evidencePort.postAudit(
    {
      workRef: 'work-1',
      conclusion: 'no_violation',
      auditor: caller,
      independent: true,
      basisRefs: ['ev-1'],
      proofBoundary: proof,
    },
    ctx,
  )
  evidencePort.recordRevocation(
    {
      grantRef: 'grant-1',
      evidenceKind: 'revocation_receipt',
      evidenceRef: 'ev-1',
      judgedBy: caller,
      independent: true,
      reason: 'smoke',
    },
    ctx,
  )

  // —— PORT-HIST ——
  const recordRef: Hist.HistoryRecordRef = {
    recordId: 'record-1',
    recordType: 'REC-WORK-06',
    version: 1,
  }
  const tx: Hist.TxHandle = { txId: 'tx-1', open: true }
  const recordDraft: Hist.RecordDraft = {
    recordType: 'REC-WORK-06',
    company,
    payload: { workRef: 'work-1' },
    writtenBy: caller,
  }
  const historyPort = stub<Hist.HistoryPort>()
  historyPort.append(recordDraft, ctx, tx)
  historyPort.begin(ctx)
  historyPort.commit(tx, ctx)
  historyPort.abort(tx, ctx)
  historyPort.get(recordRef, rc)
  historyPort.query({ ...rc, company, recordType: 'REC-WORK-06' })
  historyPort.payload(recordRef, rc)
  historyPort.correct(
    {
      target: recordRef,
      reason: 'smoke',
      patch: { status: 'fixed' },
      correctedBy: caller,
      appendOnly: true,
      proofBoundary: proof,
      expected: version,
    },
    ctx,
  )
  historyPort.reconcile(
    {
      company,
      recordType: 'REC-WORK-06',
      window: { from: '2026-11-01T00:00:00Z', to: '2026-11-01T01:00:00Z' },
    },
    ctx,
  )
  historyPort.memoryWrite(
    {
      domain: 'work',
      itemKind: 'fact',
      subject: 'person-1',
      content: 'smoke',
      sourceRefs: ['record-1'],
      writtenBy: caller,
    },
    ctx,
  )
  historyPort.memoryDispose(
    { action: 'erase', memoryRef: 'memory-1', authorizer: caller, reason: 'smoke' },
    ctx,
  )
  historyPort.memoryAuditAccess(
    {
      memoryRef: 'memory-1',
      accessor: caller,
      purpose: 'smoke',
      scope: ['memory-1'],
      accessedAt: '2026-11-01T00:00:00Z',
    },
    ctx,
  )

  // —— PORT-TRUST ——
  const credentialIssue: Trust.CredentialIssueRequest = {
    credentialClass: 'scoped',
    parentCredentialRef: 'credential-0',
    holder: caller,
    secretType: 'per_task_shortlived',
    scope: ['work-1'],
    ttl: { seconds: 60 },
    purpose: 'smoke',
  }
  const credential: Trust.CredentialRef = {
    credentialId: 'credential-1',
    credentialClass: 'scoped',
    scope: ['work-1'],
    ttl: { seconds: 60 },
  }
  const trustPort = stub<Trust.TrustPort>()
  trustPort.verifySource({ handleId: 'token-1', tokenKind: 'api' }, rc)
  trustPort.issue(credentialIssue, ctx)
  trustPort.supply(credential, { seconds: 30 }, rc)
  trustPort.revoke(credential, ctx)
  trustPort.auditUse({ credentialRef: 'credential-1' }, rc)
}
