/**
 * port-signatures-core.ts —— ports 类型级冒烟（核心五端口：DEF/REG/AUTH/HR/WORK）
 *
 * 定位：**只供 `typecheck:v2` 编译期校验**，不被 vitest 收集（非 `.test.ts`）。
 * `port-smoke.test.ts` 导入本函数只为断言其存在，不执行端口调用（端口无实现）。
 * 依据：docs/v2/14 §一/§二、plan/05 IMPL-03-03。
 */
import type * as Def from '../../../src/ports/def.ts'
import type * as Reg from '../../../src/ports/reg.ts'
import type * as Auth from '../../../src/ports/auth.ts'
import type * as Hr from '../../../src/ports/hr.ts'
import type * as Work from '../../../src/ports/work.ts'

function stub<T>(): T {
  return {} as T
}

export function compileOnlyCorePortSurface(): void {
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

  // —— PORT-DEF ——
  const defRef: Def.DefRef = { definitionId: 'def-1', revision: 1, digest: 'sha256:def' }
  const defSnapshot: Def.DefinitionSnapshot = {
    ref: defRef,
    status: 'effective',
    approval: {
      approvalRef: 'approval-1',
      approvedBy: caller,
      decidedAt: '2026-11-01T00:00:00Z',
      authority: [grant],
    },
    content: {},
    digest: 'sha256:def',
    immutable: true,
  }
  const definitionPort = stub<Def.DefinitionPort>()
  definitionPort.readRevision(defRef, rc)
  definitionPort.resolve([defRef], rc)
  definitionPort.diff(defRef, defRef, rc)
  definitionPort.list({ ...rc, company, kind: 'port', cursor: '0', limit: 10 })
  void defSnapshot

  // —— PORT-REG ——
  const revisionDraft: Reg.RevisionDraft = {
    definitionId: 'def-1',
    base: defRef,
    content: {},
    digest: 'sha256:rev',
    author: caller,
  }
  const revisionTicket: Reg.RevisionTicket = {
    ticketId: 'ticket-1',
    status: 'submitted',
    candidate: defRef,
    submittedAt: '2026-11-01T00:00:00Z',
  }
  const decisionFace: Reg.ApprovalDecisionFace = {
    decisionRef: 'decision-1',
    decidedBy: caller,
    authority: [grant],
    reason: 'smoke',
    scope: ['def-1'],
  }
  const endpoint: Reg.EndpointRef = {
    endpointId: 'endpoint-1',
    kind: 'company-dir',
    location: 'companies/acme',
  }
  const registrationPort = stub<Reg.RegistrationPort>()
  registrationPort.submitRevision(revisionDraft, ctx)
  registrationPort.registerApproval(revisionTicket, decisionFace, ctx)
  registrationPort.activateAuthority(
    { domain: 'DOM-01', endpoint, generation: 2, decision: decisionFace, expectedGeneration: 1 },
    ctx,
  )
  registrationPort.fenceWriter(
    { domain: 'DOM-01', endpoint, previousWriter: 'old-writer', expectedGeneration: 1, decision: decisionFace },
    ctx,
  )

  // —— PORT-AUTH ——
  const command: Auth.CommandRef = {
    commandId: 'command-1',
    commandClass: 'manual_action',
    company,
    requestedBy: caller,
    target: 'work-1',
    payloadDigest: 'sha256:cmd',
  }
  const subject: Auth.SubjectRef = { subjectType: 'person', subjectId: 'person-1' }
  const conflictReport: Auth.ConflictReport = {
    subject,
    compatible: true,
    findings: [],
    checkedAt: '2026-11-01T00:00:00Z',
  }
  const policyVerdict: Auth.PolicyVerdict = {
    command,
    conflictCheck: conflictReport,
    effectiveScope: ['work-1'],
    checkedAt: '2026-11-01T00:00:00Z',
    verdict: 'permitted',
    resolvedGrants: [grant],
    delegationChainOk: true,
  }
  const authorizationPort = stub<Auth.AuthorizationPort>()
  authorizationPort.verify(command, rc)
  authorizationPort.registerDecision(
    {
      subject,
      decisionKind: 'smoke',
      decidedBy: caller,
      reason: 'smoke',
      authority: [grant],
      scope: ['work-1'],
      undecided: [],
    },
    ctx,
  )
  authorizationPort.exercise(
    { grant, exercisedBy: caller, onBehalfOf: 'self', action: 'read' },
    ctx,
  )
  authorizationPort.withdraw(
    {
      grant,
      reason: 'smoke',
      closure: { descendants: [], noDescendantsConfirmed: true },
      deactivationEvidence: [{ kind: 'revocation_receipt', evidenceRef: 'ev-1' }],
    },
    ctx,
  )
  authorizationPort.checkConflicts(subject, rc)
  void policyVerdict

  // —— PORT-HR ——
  const appointmentKey: Hr.AppointmentIdempotencyKey = {
    positionRef: 'position-1',
    holder: 'person-1',
    termStart: '2026-11-01',
    draftVersion: version,
  }
  const appointment: Hr.AppointmentDraft = {
    appointmentType: 'appointment',
    idempotency: appointmentKey,
    nominator: caller,
    authority: [grant],
    effectiveFrom: '2026-11-01',
  }
  const hrPortSurface = stub<Hr.HumanResourcesPort>()
  hrPortSurface.submitAppointment(appointment, ctx)
  hrPortSurface.transitionLifecycle(
    {
      employmentRef: 'employment-1',
      from: 'candidate',
      to: 'active',
      trigger: { producer: 'decisive', recordRef: 'record-1' },
      expected: version,
      reason: 'smoke',
    },
    ctx,
  )
  hrPortSurface.settleEmployment('handover', [{ item: 'artifact', state: 'closed' }], ctx)
  hrPortSurface.recordPerformance(
    {
      subject: 'person-1',
      evaluator: caller,
      evaluatorPosition: 'verifier',
      subjectPosition: 'worker',
      evaluatorIsSubject: false,
      rating: 'ok',
      basisRefs: ['ev-1'],
      proofBoundary: proof,
    },
    ctx,
  )
  hrPortSurface.declareInterest(
    {
      declaredBy: caller,
      subject: 'person-1',
      relationship: 'none',
      scope: ['work-1'],
      authority: [grant],
    },
    ctx,
  )
  hrPortSurface.current({ company, personId: 'person-1' }, rc)

  // —— PORT-WORK ——
  const intent: Work.IntentEnvelope = {
    company,
    source: 'ticket',
    kind: 'ticket',
    ticket: 'T-1',
    submittedBy: caller,
    payloadDigest: 'sha256:intent',
  }
  const workPortSurface = stub<Work.WorkPort>()
  workPortSurface.reserveIntent(intent, ctx)
  workPortSurface.recordIntake(
    { verdict: 'accepted', workRef: 'work-1', decidedBy: caller, reason: 'smoke', authority: [grant] },
    ctx,
  )
  workPortSurface.reviseContract(
    {
      changesCommitment: false,
      workRef: 'work-1',
      base: version,
      changes: ['scope'],
      revisedBy: caller,
      authority: [grant],
    },
    ctx,
  )
  workPortSurface.judgeReadiness(
    { verdict: 'ready', workRef: 'work-1', gate: '权', judge: caller, basisRefs: ['grant-1'] },
    ctx,
  )
  workPortSurface.lockPlan(
    {
      workRef: 'work-1',
      planVersion: 'v1',
      lockedBy: caller,
      authority: [grant],
      scope: ['work-1'],
    },
    ctx,
  )
  workPortSurface.transition(
    {
      workRef: 'work-1',
      from: 'pending_start',
      to: 'in_progress',
      triggerRef: 'record-1',
      triggerProducer: 'initiator',
      expected: version,
      reason: 'smoke',
    },
    ctx,
  )
  workPortSurface.classifyEffect(
    {
      workRef: 'work-1',
      effectClass: 'EX-2',
      firstJudge: caller,
      independentOfDeliverer: true,
      uncertain: false,
      basisRefs: ['ev-1'],
      proofBoundary: proof,
    },
    ctx,
  )
  workPortSurface.recordCompletion(
    {
      workRef: 'work-1',
      terminal: 'completed',
      outputNonEmpty: true,
      reportRef: 'report-1',
      gateExitCode: 0,
      evidencePackageRef: 'package-1',
      declaredBy: caller,
      proofBoundary: proof,
    },
    ctx,
  )
  workPortSurface.recordAcceptance(
    {
      workRef: 'work-1',
      verdict: 'accepted',
      acceptor: caller,
      basisRefs: ['ev-1'],
      proofBoundary: proof,
    },
    ctx,
  )
  workPortSurface.recordMaintAcceptance(
    {
      workRef: 'work-1',
      verdict: 'maintained',
      verifier: caller,
      basisRefs: ['ev-1'],
      proofBoundary: proof,
    },
    ctx,
  )
  workPortSurface.raiseException(
    {
      workRef: 'work-1',
      category: 'rule_gap',
      receiver: caller,
      description: 'smoke',
      authority: [grant],
      proofBoundary: proof,
    },
    ctx,
  )
  workPortSurface.reopen(
    {
      workRef: 'work-1',
      to: 'in_progress',
      reason: 'smoke',
      reopenedBy: caller,
      authority: [grant],
      expected: version,
    },
    ctx,
  )
  workPortSurface.recordSettlement(
    {
      workRef: 'work-1',
      settlement: 'fully_settled',
      settledBy: caller,
      reservationRefs: [],
      proofBoundary: proof,
      expected: version,
    },
    ctx,
  )
  workPortSurface.submitHandover(
    {
      workRef: 'work-1',
      packageRef: 'package-1',
      from: caller,
      to: caller,
      items: ['artifact'],
      expected: version,
    },
    ctx,
  )
  workPortSurface.requestAssignment(
    {
      workRef: 'work-1',
      requestedTo: caller,
      requestedBy: caller,
      reason: 'smoke',
      authority: [grant],
      expected: version,
    },
    ctx,
  )
  workPortSurface.addComment(
    { kind: 'comment', workRef: 'work-1', actor: caller, body: 'smoke' },
    ctx,
  )
}
