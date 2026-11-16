import type {
  AddCommentInput,
  AddCommentResult,
  Comment,
  DescendantNode,
  JsonObject,
  ListChildrenInput,
  ListCommentsInput,
  ListDescendantsInput,
  Page,
  ReparentInput,
  Ticket,
  TicketSummary,
} from './types.ts'
import type { CommentRow, PrincipalRow, TicketRow, TicketTx } from './store.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import { MAX_PARENT_DEPTH } from './catalog.ts'
import { sha256Hex } from './util.ts'
import { validateCommentBody, validateReason } from './validation.ts'

/* ------------------------------------------------------------------ */
/* Reparent (PLANNER-only; §3.5 five checks in one transaction)        */
/* ------------------------------------------------------------------ */

export async function reparent(
  core: ServiceCore,
  actorId: string,
  input: ReparentInput,
): Promise<Ticket> {
  const actor = core.resolveActor(actorId)
  return core.runCommand(actor, 'reparent', input.idempotencyKey, input, tx => {
    const { project, roles } = core.requireMembership(tx, input.projectId, actor.id)
    core.requireRole(roles, 'PLANNER', 'reparent')
    const row = core.loadTicket(tx, project.id, input.ticketId)
    if (row.revision !== input.expectedRevision) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    const reason = validateReason(input.reason)
    const newParentId = validateNewParent(core, tx, row, project.id, input.newParentId)
    const now = core.now()
    const updated = core.store.updateTicketCas(tx, row.id, row.revision, {
      parentId: newParentId,
      updatedAt: now,
      lastActivityAt: now,
    })
    if (updated === undefined) {
      core.staleRevision(tx, row, actor, roles, core.projectPolicy(project))
    }
    const updatedRow = updated as TicketRow
    core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.reparented',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision + 1,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload: {
        previousParentId: row.parentId,
        newParentId,
        reason,
      },
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return core.ticketWithLabels(tx, updatedRow)
  })
}

function validateNewParent(
  core: ServiceCore,
  tx: TicketTx,
  row: TicketRow,
  projectId: string,
  value: unknown,
): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new IssuesError('VALIDATION_FAILED', 'newParentId must be a ticket id or null', {
      field: 'newParentId',
    })
  }
  if (value === row.id) {
    throw new IssuesError('PARENT_SELF_FORBIDDEN', 'a ticket cannot be its own parent')
  }
  const parentProject = core.store.getTicketProject(tx, value)
  if (parentProject === undefined) {
    throw new IssuesError('PARENT_NOT_FOUND', 'parent ticket not found', { parentId: value })
  }
  if (parentProject !== projectId) {
    throw new IssuesError('PARENT_NOT_SAME_PROJECT', 'parent must be in the same project', {
      parentId: value,
    })
  }
  const ancestors = core.store.listAncestorIds(tx, value)
  if (ancestors.includes(row.id)) {
    throw new IssuesError('PARENT_CYCLE', 'new parent is a descendant of this ticket', {
      parentId: value,
    })
  }
  const movedHeight = core.store.maxSubtreeDepth(tx, row.id)
  const resultingDepth = ancestors.length + 1
  if (resultingDepth + movedHeight > MAX_PARENT_DEPTH) {
    throw new IssuesError('PARENT_DEPTH_EXCEEDED', 'moved subtree would exceed depth 3', {
      parentId: value,
      ancestors: ancestors.length,
      movedSubtreeHeight: movedHeight,
      maxDepth: MAX_PARENT_DEPTH,
    })
  }
  return value
}

/* ------------------------------------------------------------------ */
/* Flat comments (append-only, immutable reply pointer)                */
/* ------------------------------------------------------------------ */

export function addCommentCommand(
  core: ServiceCore,
  actor: PrincipalRow,
  input: AddCommentInput,
): AddCommentResult {
  return core.runCommand(actor, 'addComment', input.idempotencyKey, input, tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    const body = validateCommentBody(input.body)
    let replyToCommentId: string | null = null
    if (input.replyToCommentId !== undefined) {
      const target = core.store.getComment(tx, input.replyToCommentId)
      if (target === undefined || target.ticketId !== row.id) {
        throw new IssuesError('REPLY_TARGET_INVALID', 'reply target is not a comment on this ticket', {
          replyToCommentId: input.replyToCommentId,
        })
      }
      replyToCommentId = target.id
    }
    const now = core.now()
    const comment: CommentRow = core.store.insertComment(tx, {
      id: core.newIdFor('cmt'),
      ticketId: row.id,
      authorId: actor.id,
      body,
      replyToCommentId,
      createdAt: now,
    })
    const payload: JsonObject = {
      commentId: comment.id,
      bodySha256: sha256Hex(body),
    }
    if (replyToCommentId !== null) payload['replyToCommentId'] = replyToCommentId
    const event = core.appendEvent(tx, {
      projectId: project.id,
      ticketId: row.id,
      type: 'ticket.commented',
      actor,
      revisionBefore: row.revision,
      revisionAfter: row.revision,
      fromStateCode: row.stateCode,
      toStateCode: row.stateCode,
      payload,
      idempotencyKey: input.idempotencyKey,
      outboxTopic: 'ticket.activity',
    })
    return { comment: core.commentDto(comment), event: core.eventDto(event) }
  })
}

export async function addComment(
  core: ServiceCore,
  actorId: string,
  input: AddCommentInput,
): Promise<AddCommentResult> {
  const actor = core.resolveActor(actorId)
  return addCommentCommand(core, actor, input)
}

export async function listComments(
  core: ServiceCore,
  actorId: string,
  input: ListCommentsInput,
): Promise<Page<Comment>> {
  const actor = core.resolveActor(actorId)
  const limit = core.limitOf(input.limit)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    const binding = {
      stream: 'comments' as const,
      projectId: project.id,
      ticketId: row.id,
    }
    let afterSeq = 0
    if (input.cursor !== undefined) {
      const decoded = core.cursor.decode(input.cursor, binding)
      if (decoded.kind !== 'seq') {
        throw new IssuesError('VALIDATION_FAILED', 'cursor does not encode a comment position')
      }
      afterSeq = decoded.seq
    }
    const comments = core.store.listComments(tx, row.id, afterSeq, limit)
    const nextCursor = core.pageNextSeq(comments, limit, item => item.seq, binding)
    return core.page(
      comments.map(item => core.commentDto(item)),
      nextCursor,
    )
  })
}

export async function listChildren(
  core: ServiceCore,
  actorId: string,
  input: ListChildrenInput,
): Promise<TicketSummary[]> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    const children = core.store.listChildren(tx, project.id, row.id)
    const labels = core.labelsMap(tx, children)
    return children.map(child => core.summaryDto(child, labels.get(child.id) ?? []))
  })
}

export async function listDescendants(
  core: ServiceCore,
  actorId: string,
  input: ListDescendantsInput,
): Promise<DescendantNode[]> {
  const actor = core.resolveActor(actorId)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    const descendants = core.store.listDescendants(tx, row.id)
    if (descendants.length === 0) return []
    const ids = descendants.map(item => item.id)
    const rows = new Map(
      core.store.getTicketsByIds(tx, project.id, ids).map(ticket => [ticket.id, ticket]),
    )
    const ticketRows = [...rows.values()]
    const labels = core.labelsMap(tx, ticketRows)
    const nodes: DescendantNode[] = []
    for (const descendant of descendants) {
      const ticket = rows.get(descendant.id)
      if (ticket === undefined) continue
      nodes.push({
        ticket: core.summaryDto(ticket, labels.get(ticket.id) ?? []),
        depth: descendant.depth,
      })
    }
    return nodes
  })
}
