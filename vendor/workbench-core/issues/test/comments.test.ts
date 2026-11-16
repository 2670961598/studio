import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  driveTo,
  expectIssuesError,
  makeFixture,
  newTicket,
  readyTicket,
  refresh,
} from './helpers.ts'

test('comments: append-only flat rows, reply pointer same ticket, no revision bump', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    const first = await fixture.service.addComment(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'first comment',
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(first.comment.ticketId, ticket.id)
    assert.equal(first.comment.replyToCommentId, null)
    assert.equal(first.event.type, 'ticket.commented')
    assert.match(String(first.event.payload['bodySha256']), /^[0-9a-f]{64}$/)

    const reply = await fixture.service.addComment(fixture.ids.reviewer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'reply @dev',
      replyToCommentId: first.comment.id,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(reply.comment.replyToCommentId, first.comment.id)
    // A reply to a reply is allowed; the pointer is flat, never a tree edge.
    const nested = await fixture.service.addComment(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      body: 'reply to reply',
      replyToCommentId: reply.comment.id,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(nested.comment.replyToCommentId, reply.comment.id)

    const current = await refresh(fixture, ticket.id)
    assert.equal(current.revision, ticket.revision, 'comments do not bump revision')
    assert.equal(current.stateCode, ticket.stateCode)

    const list = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
    })
    assert.deepEqual(
      list.items.map(comment => comment.id),
      [first.comment.id, reply.comment.id, nested.comment.id],
    )
    // Defensive copies: mutating a returned object cannot rewrite append-only storage.
    const mutated = list.items[0] as { body: string }
    mutated.body = 'tampered'
    const reRead = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
    })
    assert.equal(reRead.items[0]?.body, 'first comment')
  } finally {
    fixture.cleanup()
  }
})

test('comments: reply target must exist on the same ticket', async () => {
  const fixture = await makeFixture()
  try {
    const ticketA = await newTicket(fixture, { title: 'A' })
    const ticketB = await newTicket(fixture, { title: 'B' })
    const commentOnA = await fixture.service.addComment(fixture.ids.developer, {
      projectId: fixture.projectId,
      ticketId: ticketA.id,
      body: 'on A',
      idempotencyKey: fixture.key.next(),
    })
    await expectIssuesError(
      fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketB.id,
        body: 'cross ticket reply',
        replyToCommentId: commentOnA.comment.id,
        idempotencyKey: fixture.key.next(),
      }),
      'REPLY_TARGET_INVALID',
    )
    await expectIssuesError(
      fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketA.id,
        body: 'missing target',
        replyToCommentId: 'cmt_missing',
        idempotencyKey: fixture.key.next(),
      }),
      'REPLY_TARGET_INVALID',
    )
    await expectIssuesError(
      fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketA.id,
        body: '',
        idempotencyKey: fixture.key.next(),
      }),
      'COMMENT_REQUIRED',
    )
    await expectIssuesError(
      fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticketA.id,
        body: 'x'.repeat(16 * 1024 + 1),
        idempotencyKey: fixture.key.next(),
      }),
      'VALIDATION_FAILED',
    )
    await expectIssuesError(
      fixture.service.addComment(fixture.ids.outsider, {
        projectId: fixture.projectId,
        ticketId: ticketA.id,
        body: 'not a member',
        idempotencyKey: fixture.key.next(),
      }),
      'PROJECT_FORBIDDEN',
    )
  } finally {
    fixture.cleanup()
  }
})

test('comments: allowed in terminal states, full 16 KiB accepted, @ text is not authority', async () => {
  const fixture = await makeFixture()
  try {
    const done = await driveTo(fixture, await readyTicket(fixture), 6)
    const body = `@${fixture.ids.developer} ` + 'y'.repeat(16 * 1024 - 20)
    const comment = await fixture.service.addComment(fixture.ids.reviewer, {
      projectId: fixture.projectId,
      ticketId: done.id,
      body,
      idempotencyKey: fixture.key.next(),
    })
    assert.equal(comment.comment.replyToCommentId, null, '@ text never creates a reply edge')
    const current = await refresh(fixture, done.id)
    assert.equal(current.stateCode, 6)
    assert.equal(current.revision, done.revision)
  } finally {
    fixture.cleanup()
  }
})

test('comments: opaque cursor pagination in seq order, never a timestamp cursor', async () => {
  const fixture = await makeFixture()
  try {
    const ticket = await newTicket(fixture)
    const ids: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const created = await fixture.service.addComment(fixture.ids.developer, {
        projectId: fixture.projectId,
        ticketId: ticket.id,
        body: `comment ${index}`,
        idempotencyKey: fixture.key.next(),
      })
      ids.push(created.comment.id)
    }
    const page1 = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 2,
    })
    assert.equal(page1.items.length, 2)
    assert.ok(page1.nextCursor !== null)
    const page2 = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 2,
      cursor: page1.nextCursor,
    })
    assert.deepEqual(
      page2.items.map(comment => comment.id),
      [ids[2], ids[3]],
    )
    const page3 = await fixture.service.listComments(fixture.ids.pm, {
      projectId: fixture.projectId,
      ticketId: ticket.id,
      limit: 2,
      cursor: page2.nextCursor ?? '',
    })
    assert.deepEqual(
      page3.items.map(comment => comment.id),
      [ids[4]],
    )
    assert.equal(page3.nextCursor, null)
  } finally {
    fixture.cleanup()
  }
})
