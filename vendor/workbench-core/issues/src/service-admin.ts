import type {
  CreatePrincipalInput,
  CreateProjectInput,
  GrantMembershipInput,
  MembershipView,
  Principal,
  Project,
  ProjectPolicy,
  UpdatePolicyInput,
} from './types.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import type { TicketTx } from './store.ts'
import { assertNonEmptyString, canonicalJson, hashJson } from './util.ts'
import { requireHuman, validateRoles, validateReason } from './validation.ts'

/** Host bootstrap: register a principal (never a client command). */
export async function createPrincipal(
  core: ServiceCore,
  input: CreatePrincipalInput,
): Promise<Principal> {
  const kind = input.kind
  if (kind !== 'human' && kind !== 'agent') {
    throw new IssuesError('VALIDATION_FAILED', 'principal kind must be human or agent', {
      field: 'kind',
    })
  }
  const displayName = assertNonEmptyString(input.displayName, 'displayName', 128)
  const row = core.read(tx => {
    const record = {
      id: core.newIdFor('prn'),
      kind,
      displayName,
      status: 'active' as const,
      createdAt: core.now(),
    }
    core.store.insertPrincipal(tx, record)
    return record
  })
  return { ...row }
}

/** Host bootstrap: create a project with its initial policy. */
export async function createProject(
  core: ServiceCore,
  actorId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const actor = core.resolveActor(actorId)
  requireHuman(actor, 'createProject')
  if (typeof input.keyPrefix !== 'string' || !/^[A-Z][A-Z0-9]{0,9}$/.test(input.keyPrefix)) {
    throw new IssuesError('VALIDATION_FAILED', 'keyPrefix must be uppercase A-Z/0-9', {
      field: 'keyPrefix',
    })
  }
  const name = assertNonEmptyString(input.name, 'name', 200)
  const policy = core.resolvePolicy(input.policy)
  const project = core.read(tx => {
    const row = {
      id: core.newIdFor('prj'),
      keyPrefix: input.keyPrefix,
      name,
      nextTicketSeq: 1,
      policyJson: canonicalJson(policy),
      policyGeneration: 1,
      createdAt: core.now(),
      archivedAt: null,
    }
    core.store.insertProject(tx, row)
    return row
  })
  return core.projectDto(project)
}

/**
 * Grant membership roles. A human grantor is required and `added_by` is never
 * the grantee. The very first grant of a project is a human bootstrap; later
 * grants require the actor to be a PLANNER member.
 */
export async function grantMembership(
  core: ServiceCore,
  actorId: string,
  input: GrantMembershipInput,
): Promise<MembershipView> {
  const actor = core.resolveActor(actorId)
  requireHuman(actor, 'grantMembership')
  const targetId = assertNonEmptyString(input.principalId, 'principalId')
  if (targetId === actor.id) {
    throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'a principal cannot grant itself a role', {
      principalId: targetId,
    })
  }
  const roles = validateRoles(input.roles)
  const reason = validateReason(input.reason)
  return core.runCommand(actor, 'grantMembership', input.idempotencyKey, input, tx => {
    const project = core.requireProject(tx, input.projectId)
    const target = core.store.getPrincipal(tx, targetId)
    if (target === undefined) {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'target principal not found', {
        principalId: targetId,
      })
    }
    if (target.kind === 'daemon') {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'the daemon principal cannot be a member')
    }
    if (target.status !== 'active') {
      throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'target principal is not active', {
        principalId: targetId,
      })
    }
    const existing = core.store.listMemberships(tx, project.id)
    if (existing.length > 0) {
      const actorRoles = core.store.getMembershipRoles(tx, project.id, actor.id)
      if (!actorRoles.includes('PLANNER')) {
        throw new IssuesError('PRINCIPAL_NOT_ALLOWED', 'membership grant requires PLANNER', {
          requiredRole: 'PLANNER',
        })
      }
    }
    const addedAt = core.now()
    for (const [index, role] of roles.entries()) {
      core.store.insertMembership(tx, {
        projectId: project.id,
        principalId: targetId,
        role,
        addedBy: actor.id,
        addedAt,
      })
      core.appendEvent(tx, {
        projectId: project.id,
        ticketId: null,
        type: 'membership.granted',
        actor,
        revisionBefore: 0,
        revisionAfter: 0,
        payload: {
          targetPrincipalId: targetId,
          role,
          addedBy: actor.id,
          reason,
        },
        idempotencyKey: index === 0 ? input.idempotencyKey : null,
        outboxTopic: 'membership.changed',
      })
    }
    return { projectId: project.id, principalId: targetId, roles }
  })
}

export async function getProject(
  core: ServiceCore,
  actorId: string,
  projectId: string,
): Promise<Project> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, projectId, actor.id)
    return core.projectDto(project)
  })
}

export async function updatePolicy(
  core: ServiceCore,
  actorId: string,
  input: UpdatePolicyInput,
): Promise<Project> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'updatePolicy', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'policy:write')
    requireHuman(actor, 'policy:write')
    const reason = validateReason(input.reason, 'reason')
    const before = core.projectPolicy(project)
    const after = core.resolvePolicy(input.policy, before)
    validateReopenPrincipals(core, tx, input.projectId, after.reopenPrincipals)
    const oldHash = hashJson(before)
    const newHash = hashJson(after)
    const updated = core.store.updateProjectPolicy(
      tx,
      project.id,
      input.expectedGeneration,
      canonicalJson(after),
      core.now(),
    )
    if (!updated) {
      const current = core.store.getProject(tx, project.id)
      throw new IssuesError('STALE_POLICY_GENERATION', 'expectedGeneration is stale', {
        currentGeneration: current?.policyGeneration ?? project.policyGeneration,
      })
    }
    const changed = policyChanged(before, after)
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: null,
      type: 'project.policy_updated',
      actor,
      revisionBefore: 0,
      revisionAfter: 0,
      payload: {
        oldGeneration: project.policyGeneration,
        newGeneration: project.policyGeneration + 1,
        oldHash,
        newHash,
        changed,
        reason,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'project.policy_updated',
    })
    const refreshed = core.store.getProject(tx, project.id)
    if (refreshed === undefined) throw new IssuesError('PROJECT_NOT_FOUND', 'project not found')
    return core.projectDto(refreshed)
  })
}

function policyChanged(before: ProjectPolicy, after: ProjectPolicy): string[] {
  const changed: string[] = []
  if (before.wipLimitPerWorker !== after.wipLimitPerWorker) changed.push('wipLimitPerWorker')
  if (before.wipLimitPerProject !== after.wipLimitPerProject) changed.push('wipLimitPerProject')
  if (before.evidenceRequired !== after.evidenceRequired) changed.push('evidenceRequired')
  if (canonicalJson(before.reopenPrincipals) !== canonicalJson(after.reopenPrincipals)) {
    changed.push('reopenPrincipals')
  }
  return changed
}

function validateReopenPrincipals(
  core: ServiceCore,
  tx: TicketTx,
  projectId: string,
  reopenPrincipals: readonly string[],
): void {
  for (const principalId of reopenPrincipals) {
    const principal = core.store.getPrincipal(tx, principalId)
    if (principal === undefined || principal.kind !== 'human') {
      throw new IssuesError(
        'POLICY_VALUE_OUT_OF_RANGE',
        'reopenPrincipals must name human principals',
        { field: 'reopenPrincipals', principalId },
      )
    }
    const roles = core.store.getMembershipRoles(tx, projectId, principalId)
    if (roles.length === 0) {
      throw new IssuesError(
        'POLICY_VALUE_OUT_OF_RANGE',
        'reopenPrincipals must be project members',
        { field: 'reopenPrincipals', principalId },
      )
    }
  }
}
