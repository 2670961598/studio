import type {
  AddEvidenceInput,
  DaemonPort,
  Evidence,
  EvidenceKind,
  GateRun,
  GetGateRunInput,
  ListEvidenceInput,
  RecordGateEvidenceInput,
  RecordGateEvidenceResult,
} from './types.ts'
import type { EvidenceRow, GateRunRow, TicketRow, TicketTx } from './store.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import { DAEMON_PRINCIPAL_ID } from './catalog.ts'
import { hashJson } from './util.ts'
import { inspectEvidenceFile, verifyEvidenceFile } from './evidence.ts'

const ALLOWED_EXECUTOR_EVIDENCE_KINDS: readonly string[] = ['summary', 'report', 'patch', 'trace']

/** Append non-gate evidence, bound to the ticket's current revision. */
export async function addEvidence(
  core: ServiceCore,
  actorId: string,
  input: AddEvidenceInput,
): Promise<Evidence> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'addEvidence', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    if (typeof input.kind === 'string' && (input.kind as string) === 'gate') {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'gate evidence is daemon-only', {
        kind: 'gate',
      })
    }
    if (!ALLOWED_EXECUTOR_EVIDENCE_KINDS.includes(input.kind)) {
      throw new IssuesError('VALIDATION_FAILED', 'unknown evidence kind', { kind: input.kind })
    }
    const file = inspectEvidenceFile(core.evidenceRoot, input.uri)
    const now = core.now()
    const evidence: EvidenceRow = {
      id: core.newIdFor('evd'),
      ticketId: row.id,
      ticketRevision: row.revision,
      kind: input.kind as EvidenceKind,
      uri: file.uri,
      sha256: file.sha256,
      bytes: file.bytes,
      producer: actor.kind === 'human' ? 'human' : 'agent',
      gateRunId: null,
      createdBy: actor.id,
      createdAt: now,
    }
    core.store.insertEvidence(tx, evidence)
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.evidence_added',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: {
        evidenceId: evidence.id,
        kind: evidence.kind,
        uri: evidence.uri,
        sha256: evidence.sha256,
        bytes: evidence.bytes,
        ticketRevision: evidence.ticketRevision,
        producer: evidence.producer,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return core.evidenceDto(evidence)
  })
}

export async function listEvidence(
  core: ServiceCore,
  actorId: string,
  input: ListEvidenceInput,
): Promise<Evidence[]> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    return core.store.listEvidence(tx, row.id).map(item => core.evidenceDto(item))
  })
}

export async function getGateRun(
  core: ServiceCore,
  actorId: string,
  input: GetGateRunInput,
): Promise<GateRun | null> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    core.requireMembership(tx, input.projectId, actor.id)
    const row = core.store.getGateRun(tx, input.gateRunId)
    if (row === undefined) return null
    const ticket = core.store.getTicket(tx, input.projectId, row.ticketId)
    if (ticket === undefined) return null
    return core.gateRunDto(row)
  })
}

/**
 * Validate the harvest verdict for `T7` (Part 1 §4.2 / C3-F1/F3 / C4-F1/F2).
 * The verdict must be a passing daemon `gate_runs` row at the ticket's current
 * revision (the gate epoch), fresh for the current attempt, covering exactly the
 * current attempt's non-gate evidence, whose files still hash to the stored
 * `sha256`, and traced by its own `kind='gate'` evidence row.
 */
export function validateGateForDone(
  core: ServiceCore,
  tx: TicketTx,
  row: TicketRow,
): { verdict: GateRunRow; evidenceIds: string[] } {
  const attempt = core.attemptScope(tx, row)
  const currentEvidence = core.currentAttemptEvidence(tx, row)
  const evidenceIds = currentEvidence.map(item => item.id).sort()
  const anchor = core.freezeAnchor(tx, row.id)

  const verdicts = core.store.listGateRuns(tx, row.id)
  let staleVerdictSeen = false
  const passing = verdicts.filter(verdict => {
    const isPassing =
      verdict.gateExit === 0 &&
      verdict.reqCompleted === 1 &&
      verdict.reqOutput === 1 &&
      verdict.reqReport === 1
    if (!isPassing) return false
    const epochMatches = verdict.ticketRevision === row.revision
    const attemptFresh =
      verdict.producedAt > attempt.lowerBound &&
      (anchor === null || verdict.producedAt > anchor.occurredAt)
    if (!epochMatches || !attemptFresh) {
      staleVerdictSeen = true
      return false
    }
    return true
  })
  if (passing.length === 0) {
    if (staleVerdictSeen) {
      throw new IssuesError('GATE_EPOCH_STALE', 'the passing verdict is stale for this revision/attempt', {
        currentRevision: row.revision,
        attemptLowerBound: attempt.lowerBound,
      })
    }
    throw new IssuesError('GATE_RECORD_MISSING', 'no passing daemon gate verdict for this ticket', {
      ticketRevision: row.revision,
    })
  }
  const verdict = passing.reduce((latest, candidate) =>
    candidate.producedAt > latest.producedAt ? candidate : latest,
  )
  const covered = [...verdict.coveredEvidenceIds].sort()
  if (!sameStringArray(covered, evidenceIds)) {
    throw new IssuesError('GATE_EPOCH_STALE', 'verdict coverage does not equal the current evidence set', {
      coveredEvidenceIds: covered,
      currentEvidenceIds: evidenceIds,
    })
  }
  const gateTrace = core.store
    .listEvidence(tx, row.id)
    .filter(
      evidence =>
        evidence.kind === 'gate' &&
        evidence.gateRunId === verdict.id &&
        evidence.ticketId === row.id &&
        evidence.ticketRevision === verdict.ticketRevision,
    )
  if (gateTrace.length === 0) {
    throw new IssuesError('GATE_RECORD_MISSING', 'the verdict has no bound gate evidence trace', {
      gateRunId: verdict.id,
    })
  }
  for (const evidence of currentEvidence) {
    if (evidence.ticketId !== row.id) {
      throw new IssuesError('EVIDENCE_NOT_BOUND', 'evidence belongs to another ticket', {
        evidenceId: evidence.id,
      })
    }
    if (evidence.ticketRevision > verdict.ticketRevision) {
      throw new IssuesError('EVIDENCE_NOT_BOUND', 'evidence was created after the gate epoch', {
        evidenceId: evidence.id,
        evidenceRevision: evidence.ticketRevision,
        gateRevision: verdict.ticketRevision,
      })
    }
    verifyEvidenceFile(core.evidenceRoot, evidence.uri, evidence.sha256)
  }
  return { verdict, evidenceIds }
}

/**
 * Daemon-only verdict writer. It is returned separately from the public service
 * and writes one `gate_runs` row plus the `kind='gate'` evidence trace in one
 * transaction; an executor has no path to it (Part 2a §7.1/§7.2, F3).
 */
export class DaemonGate implements DaemonPort {
  private readonly core: ServiceCore

  constructor(core: ServiceCore) {
    this.core = core
  }

  async recordGateEvidence(input: RecordGateEvidenceInput): Promise<RecordGateEvidenceResult> {
    const daemon = this.core.read(tx => {
      const principal = this.core.store.getPrincipal(tx, DAEMON_PRINCIPAL_ID)
      if (principal === undefined) {
        throw new IssuesError('STORAGE_UNAVAILABLE', 'daemon principal is missing')
      }
      return principal
    })
    const idempotencyKey = input.idempotencyKey ?? this.core.newIdFor('idem')
    return this.core.runCommand(daemon, 'recordGateEvidence', idempotencyKey, input, tx => {
      const project = this.core.requireProject(tx, input.projectId)
      const row = this.core.loadTicket(tx, project.id, input.ticketId)
      if (row.archivedAt !== null) {
        throw new IssuesError('TRANSITION_NOT_ALLOWED', 'archived tickets accept no verdicts')
      }
      const harvestRevision = input.ticketRevision ?? row.revision
      if (harvestRevision !== row.revision) {
        throw new IssuesError('GATE_EPOCH_STALE', 'harvest revision is not the current revision', {
          currentRevision: row.revision,
          ticketRevision: harvestRevision,
        })
      }
      const producedAt = input.producedAt ?? this.core.now()
      const attempt = this.core.attemptScope(tx, row)
      const anchor = this.core.freezeAnchor(tx, row.id)
      if (
        producedAt <= attempt.lowerBound ||
        (anchor !== null && producedAt <= anchor.occurredAt)
      ) {
        throw new IssuesError('GATE_EPOCH_STALE', 'verdict is fresher than the attempt boundary', {
          producedAt,
          attemptLowerBound: attempt.lowerBound,
        })
      }
      if (input.gateExit !== 0 && input.gateExit !== 1) {
        throw new IssuesError('VALIDATION_FAILED', 'gateExit must be 0 or 1')
      }
      const rawRequirements: unknown = input.requirements
      if (typeof rawRequirements !== 'object' || rawRequirements === null) {
        throw new IssuesError('VALIDATION_FAILED', 'requirements are required')
      }
      const requirements = rawRequirements as Record<string, unknown>
      for (const key of ['completed', 'output', 'report'] as const) {
        if (typeof requirements[key] !== 'boolean') {
          throw new IssuesError('VALIDATION_FAILED', `requirements.${key} must be a boolean`)
        }
      }
      const covered = [...new Set(input.coveredEvidenceIds)].sort()
      const currentEvidence = this.core.currentAttemptEvidence(tx, row)
      const expectedIds = currentEvidence.map(item => item.id).sort()
      if (!sameStringArray(covered, expectedIds)) {
        throw new IssuesError('GATE_EPOCH_STALE', 'covered_evidence_ids must equal the current evidence set', {
          coveredEvidenceIds: covered,
          currentEvidenceIds: expectedIds,
        })
      }
      for (const evidence of currentEvidence) {
        if (evidence.createdAt > producedAt) {
          throw new IssuesError('GATE_EPOCH_STALE', 'covered evidence was created after the verdict', {
            evidenceId: evidence.id,
            createdAt: evidence.createdAt,
            producedAt,
          })
        }
      }
      const file = inspectEvidenceFile(this.core.evidenceRoot, input.uri)
      const recordSha256 =
        input.recordSha256 ??
        hashJson({
          ticketId: row.id,
          ticketRevision: harvestRevision,
          producedAt,
          gateExit: input.gateExit,
          requirements: {
            completed: requirements['completed'] === true,
            output: requirements['output'] === true,
            report: requirements['report'] === true,
          },
          coveredEvidenceIds: covered,
        })
      if (typeof recordSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(recordSha256)) {
        throw new IssuesError('VALIDATION_FAILED', 'recordSha256 must be 64 lowercase hex chars')
      }
      const now = this.core.now()
      const gateRun: GateRunRow = {
        id: this.core.newIdFor('gate'),
        ticketId: row.id,
        ticketRevision: harvestRevision,
        producedAt,
        gateExit: input.gateExit,
        reqCompleted: requirements['completed'] === true ? 1 : 0,
        reqOutput: requirements['output'] === true ? 1 : 0,
        reqReport: requirements['report'] === true ? 1 : 0,
        coveredEvidenceIds: covered,
        recordSha256,
        createdBy: daemon.id,
        createdAt: now,
      }
      this.core.store.insertGateRun(tx, gateRun)
      const gateEvidence: EvidenceRow = {
        id: this.core.newIdFor('evd'),
        ticketId: row.id,
        ticketRevision: harvestRevision,
        kind: 'gate',
        uri: file.uri,
        sha256: file.sha256,
        bytes: file.bytes,
        producer: 'daemon',
        gateRunId: gateRun.id,
        createdBy: daemon.id,
        createdAt: now,
      }
      this.core.store.insertEvidence(tx, gateEvidence)
      const event = this.core.appendEvent(tx, {
        projectId: project.id,
        ticketId: row.id,
        type: 'ticket.evidence_added',
        actor: daemon,
        revisionBefore: row.revision,
        revisionAfter: row.revision,
        fromStateCode: row.stateCode,
        toStateCode: row.stateCode,
        payload: {
          evidenceId: gateEvidence.id,
          kind: 'gate',
          uri: gateEvidence.uri,
          sha256: gateEvidence.sha256,
          bytes: gateEvidence.bytes,
          ticketRevision: harvestRevision,
          producer: 'daemon',
          gateRunId: gateRun.id,
        },
        idempotencyKey: idempotencyKey,
        outboxTopic: 'ticket.activity',
      })
      return {
        gateRun: this.core.gateRunDto(gateRun),
        evidence: this.core.evidenceDto(gateEvidence),
        event: this.core.eventDto(event),
      }
    })
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
