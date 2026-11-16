import type {
  BatchAddCommentItem,
  BatchAddCommentsInput,
  BatchItemResult,
  BatchResult,
  BatchTransitionItem,
  BatchTransitionTicketsInput,
  Comment,
  TransitionResult,
} from './types.ts'
import { IssuesError } from './errors.ts'
import type { ServiceCore } from './core.ts'
import { MAX_WRITE_BATCH } from './catalog.ts'
import { addCommentCommand } from './service-parent-comment.ts'
import { transitionCommand } from './service-workflow.ts'
import { validateStateCode } from './validation.ts'

/**
 * Bounded batch writes (Part 2d §7.7.3/§7.7.4): ≤100 items, per-item authz /
 * CAS / idempotency identical to the single-item path, independent items by
 * default, `atomic: true` restricted to one aggregate (one ticket), and no path
 * that widens a grant or skips audit.
 */
export async function batchAddComments(
  core: ServiceCore,
  actorId: string,
  input: BatchAddCommentsInput,
): Promise<BatchResult<Comment>> {
  const actor = core.resolveActor(actorId)
  const items = validateBatchItems<BatchAddCommentItem>(input.items, item => {
    if (typeof item.ticketId !== 'string' || item.ticketId.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item requires ticketId')
    }
    if (typeof item.idempotencyKey !== 'string' || item.idempotencyKey.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item requires idempotencyKey')
    }
  })
  core.read(tx => core.requireMembership(tx, input.projectId, actor.id))
  const atomic = input.atomic === true
  if (atomic) assertSingleAggregate(items.map(item => item.ticketId))
  const run = (item: BatchAddCommentItem): Comment =>
    addCommentCommand(core, actor, {
      projectId: input.projectId,
      ticketId: item.ticketId,
      body: item.body,
      ...(item.replyToCommentId === undefined ? {} : { replyToCommentId: item.replyToCommentId }),
      idempotencyKey: item.idempotencyKey,
    }).comment
  return runBatch(core, items, atomic, run, 201)
}

export async function batchTransitionTickets(
  core: ServiceCore,
  actorId: string,
  input: BatchTransitionTicketsInput,
): Promise<BatchResult<TransitionResult>> {
  const actor = core.resolveActor(actorId)
  const items = validateBatchItems<BatchTransitionItem>(input.items, item => {
    if (typeof item.ticketId !== 'string' || item.ticketId.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item requires ticketId')
    }
    if (typeof item.idempotencyKey !== 'string' || item.idempotencyKey.length === 0) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item requires idempotencyKey')
    }
    if (typeof item.expectedRevision !== 'number' || !Number.isInteger(item.expectedRevision)) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item requires expectedRevision')
    }
    validateStateCode(item.targetStateCode)
  })
  core.read(tx => core.requireMembership(tx, input.projectId, actor.id))
  const atomic = input.atomic === true
  if (atomic) assertSingleAggregate(items.map(item => item.ticketId))
  const run = (item: BatchTransitionItem): TransitionResult =>
    transitionCommand(
      core,
      actor,
      {
        projectId: input.projectId,
        ticketId: item.ticketId,
        targetStateCode: item.targetStateCode,
        expectedRevision: item.expectedRevision,
        ...(item.reason === undefined ? {} : { reason: item.reason }),
        idempotencyKey: item.idempotencyKey,
      },
      item.targetStateCode,
    )
  return runBatch(core, items, atomic, run, 200)
}

function runBatch<TItem, TResult>(
  core: ServiceCore,
  items: readonly TItem[],
  atomic: boolean,
  run: (item: TItem) => TResult,
  successStatus: number,
): BatchResult<TResult> {
  if (atomic) {
    let failedIndex = 0
    try {
      const results = core.store.transaction(_tx => {
        return items.map((item, index) => {
          failedIndex = index
          return run(item)
        })
      })
      return {
        items: results.map((result, index) => ({
          index,
          status: successStatus,
          result,
          error: null,
        })),
      }
    } catch (error) {
      const failure = core.batchItemError(error)
      const envelopes: BatchItemResult<TResult>[] = items.map((_item, index) => {
        if (index === failedIndex) {
          return { index, status: failure.httpStatus, result: null, error: failure }
        }
        return {
          index,
          status: 422,
          result: null,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'atomic batch aborted',
            details: { atomicAborted: true, failedIndex },
            httpStatus: 422,
            retryable: false,
          },
        }
      })
      return { items: envelopes }
    }
  }
  const envelopes: BatchItemResult<TResult>[] = []
  for (const [index, item] of items.entries()) {
    try {
      envelopes.push({ index, status: successStatus, result: run(item), error: null })
    } catch (error) {
      const failure = core.batchItemError(error)
      envelopes.push({ index, status: failure.httpStatus, result: null, error: failure })
    }
  }
  return { items: envelopes }
}

function validateBatchItems<T>(value: unknown, validateItem: (item: T) => void): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IssuesError('VALIDATION_FAILED', 'batch requires at least one item', {
      field: 'items',
    })
  }
  if (value.length > MAX_WRITE_BATCH) {
    throw new IssuesError('VALIDATION_FAILED', `batch exceeds ${MAX_WRITE_BATCH} items`, {
      field: 'items',
      max: MAX_WRITE_BATCH,
    })
  }
  const items = value as T[]
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      throw new IssuesError('VALIDATION_FAILED', 'batch item must be an object')
    }
    validateItem(item)
  }
  return items
}

function assertSingleAggregate(ticketIds: readonly string[]): void {
  const distinct = new Set(ticketIds)
  if (distinct.size > 1) {
    throw new IssuesError(
      'VALIDATION_FAILED',
      'atomic batch is restricted to a single aggregate (one ticket)',
      { code: 'ATOMIC_CROSS_AGGREGATE', ticketCount: distinct.size },
    )
  }
}
