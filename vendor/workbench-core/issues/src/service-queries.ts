import type {
  Comment,
  EventEnvelope,
  GetCommentsInput,
  GetCommentsResult,
  GetTicketsInput,
  GetTicketsResult,
  ListEventsInput,
  ListProjectEventsInput,
  Page,
} from './types.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import { MAX_READ_BATCH } from './catalog.ts'

export async function listEvents(
  core: ServiceCore,
  actorId: string,
  input: ListEventsInput,
): Promise<Page<EventEnvelope>> {
  const actor = core.resolveActor(actorId)
  const limit = core.limitOf(input.limit)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const row = core.loadTicket(tx, project.id, input.ticketId)
    const binding = {
      stream: 'ticket-events' as const,
      projectId: project.id,
      ticketId: row.id,
    }
    let afterSeq = 0
    if (input.cursor !== undefined) {
      const decoded = core.cursor.decode(input.cursor, binding)
      if (decoded.kind !== 'seq') {
        throw new IssuesError('VALIDATION_FAILED', 'cursor does not encode an event position')
      }
      afterSeq = decoded.seq
    }
    const events = core.store.listTicketEvents(tx, row.id, afterSeq, limit)
    const nextCursor = core.pageNextSeq(events, limit, item => item.seq, binding)
    return core.page(
      events.map(item => core.eventDto(item)),
      nextCursor,
    )
  })
}

export async function listProjectEvents(
  core: ServiceCore,
  actorId: string,
  input: ListProjectEventsInput,
): Promise<Page<EventEnvelope>> {
  const actor = core.resolveActor(actorId)
  const limit = core.limitOf(input.limit)
  return core.read(tx => {
    const { project } = core.requireMembership(tx, input.projectId, actor.id)
    const binding = { stream: 'project-events' as const, projectId: project.id }
    let afterSeq = 0
    if (input.cursor !== undefined) {
      const decoded = core.cursor.decode(input.cursor, binding)
      if (decoded.kind !== 'seq') {
        throw new IssuesError('VALIDATION_FAILED', 'cursor does not encode an event position')
      }
      afterSeq = decoded.seq
    }
    const events = core.store.listProjectEvents(tx, project.id, afterSeq, limit)
    const nextCursor = core.pageNextSeq(events, limit, item => item.seq, binding)
    return core.page(
      events.map(item => core.eventDto(item)),
      nextCursor,
    )
  })
}

/**
 * Batch read: `getTickets(ids ≤ 500)` served by one chunked adapter call (never
 * N+1). Missing/invisible ids are simply omitted; `missing[]` is advisory and
 * only returned to a project-authorized caller (we already checked membership).
 */
export async function getTickets(
  core: ServiceCore,
  actorId: string,
  input: GetTicketsInput,
): Promise<GetTicketsResult> {
  const actor = core.resolveActor(actorId)
  const ids = validateIdBatch(input.ids, 'ids')
  return core.read(tx => {
    core.requireMembership(tx, input.projectId, actor.id)
    const rows = core.store.getTicketsByIds(tx, input.projectId, ids)
    const byId = new Map(rows.map(row => [row.id, row]))
    const labels = core.labelsMap(tx, rows)
    const items = []
    const missing: string[] = []
    for (const id of ids) {
      const row = byId.get(id)
      if (row === undefined) {
        missing.push(id)
        continue
      }
      items.push(core.ticketDto(row, labels.get(row.id) ?? []))
    }
    return { items, missing }
  })
}

/** Batch read: `getComments(ids ≤ 500)` scoped to one project, no N+1. */
export async function getComments(
  core: ServiceCore,
  actorId: string,
  input: GetCommentsInput,
): Promise<GetCommentsResult> {
  const actor = core.resolveActor(actorId)
  const ids = validateIdBatch(input.ids, 'ids')
  return core.read(tx => {
    core.requireMembership(tx, input.projectId, actor.id)
    const rows = core.store.getCommentsByIds(tx, input.projectId, ids)
    const byId = new Map(rows.map(row => [row.id, row]))
    const items: Comment[] = []
    const missing: string[] = []
    for (const id of ids) {
      const row = byId.get(id)
      if (row === undefined) {
        missing.push(id)
        continue
      }
      items.push(core.commentDto(row))
    }
    return { items, missing }
  })
}

/** Validate a batch id list BEFORE any I/O (501 ids → VALIDATION_FAILED). */
export function validateIdBatch(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new IssuesError('VALIDATION_FAILED', `${field} must be an array`, { field })
  }
  if (value.length > MAX_READ_BATCH) {
    throw new IssuesError('VALIDATION_FAILED', `${field} exceeds ${MAX_READ_BATCH} ids`, {
      field,
      max: MAX_READ_BATCH,
    })
  }
  const ids: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', `${field} must contain ticket ids`, { field })
    }
    ids.push(id)
  }
  return ids
}
