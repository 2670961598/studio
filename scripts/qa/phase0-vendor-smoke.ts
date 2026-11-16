/**
 * phase0-vendor-smoke —— vendored workbench-core 薄包装冒烟（task-63 Phase0 切片1）
 *
 * 只 import `vendor/workbench-core/index.ts`（不依赖宿主路径/StudioNext/DSH/网络）：
 *  1) issues：create principal/project/ticket/comment，get 回读；
 *  2) collab：create actors/group room，directed mention send，list messages + markRead。
 * 输出 JSON 证据；失败 exit 1。可 `node --experimental-strip-types scripts/qa/phase0-vendor-smoke.ts`。
 */
import { issues, collab } from '../../vendor/workbench-core/index.ts'

const platform = issues.createMemoryIssues({})
try {
  const admin = await platform.service.createPrincipal({ kind: 'human', displayName: 'PM' })
  const project = await platform.service.createProject(admin.id, { keyPrefix: 'PH0', name: 'Phase0' })
  // bootstrap：项目创建者作为 PLANNER 给第二个 principal 授权；自助授权被内核拒（PRINCIPAL_NOT_ALLOWED）
  const dev = await platform.service.createPrincipal({ kind: 'agent', displayName: 'Dev' })
  await platform.service.grantMembership(admin.id, {
    projectId: project.id,
    principalId: dev.id,
    roles: ['PLANNER', 'DEVELOPER', 'TESTER'],
    reason: 'phase0 smoke bootstrap',
    idempotencyKey: 'phase0-grant-1',
  })
  const ticket = await platform.service.createTicket(dev.id, {
    projectId: project.id,
    title: 'phase0 vendored smoke ticket',
    body: 'offline vendor smoke',
    idempotencyKey: 'phase0-create-1',
  })
  await platform.service.addComment(dev.id, {
    projectId: project.id,
    ticketId: ticket.id,
    body: 'comment from vendor smoke',
    idempotencyKey: 'phase0-comment-1',
  })
  const got = await platform.service.getTicket(dev.id, { projectId: project.id, idOrKey: ticket.id })
  if (got.key === '' || got.title !== 'phase0 vendored smoke ticket') throw new Error('issues get mismatch')

  const chat = collab.createMemoryCollab()
  const pm = await chat.createActor({ kind: 'human', name: 'PM' })
  const chatDev = await chat.createActor({ kind: 'agent', name: 'Dev' })
  const room = await chat.createGroupRoom(pm.id, { name: 'phase0-room', memberIds: [chatDev.id] })
  const sent = await chat.sendMessage(pm.id, { roomId: room.id, body: '@Dev hello from vendored collab', mentions: [chatDev.id] })
  const page = await chat.listMessages(chatDev.id, { roomId: room.id })
  if (!page.items.some((m) => m.roomSeq === sent.roomSeq && m.mentions.includes(chatDev.id))) throw new Error('collab mention/list mismatch')
  const read = await chat.markRead(chatDev.id, { roomId: room.id, upToRoomSeq: sent.roomSeq })
  if (read.roomId !== room.id) throw new Error('collab markRead mismatch')

  console.log(JSON.stringify({
    ok: true,
    vendor: 'workbench-core',
    issues: { ticketId: ticket.id, key: ticket.key, stateCode: got.stateCode, comments: 1 },
    collab: { roomId: room.id, seq: sent.seq, roomSeq: sent.roomSeq, mentions: page.items.at(-1)?.mentions ?? [], unreadAfterRead: read.unread },
    hostPathDependency: false,
  }))
} finally {
  platform.close()
}
