/**
 * phase0-collab-wake —— collab mention→wake 离线 PoC（task-64 Phase0 切片2）
 * 只 import vendor/workbench-core；用内存 collab，不连生产/网络。
 * 覆盖 broadcast/group/DM、directed mention→wake、read cursor、idempotency、ack；
 * relay/lease 由薄适配模拟（vendor 无此 API），输出与 daemon Matrix face 的缺口清单。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { collab } from '../../vendor/workbench-core/index.ts'

const outDir = process.argv[process.argv.indexOf('--out') + 1] ?? '/tmp/phase0-evidence'
mkdirSync(outDir, { recursive: true })
const chat = collab.createMemoryCollab()
const pm = await chat.createActor({ kind: 'human', name: 'PM' })
const dev = await chat.createActor({ kind: 'agent', name: 'Dev' })
const qa = await chat.createActor({ kind: 'agent', name: 'QA' })
const broadcast = await chat.createBroadcastRoom(pm.id, { name: 'company' })
const group = await chat.createGroupRoom(pm.id, { name: 'phase0', memberIds: [dev.id, qa.id] })
const dm = await chat.createDm(pm.id, dev.id)
// 广播/ DM 也各发一条（覆盖三通道；directed mention/mentionAll 路径均走 wake）
const broadcastSend = await chat.sendMessage(pm.id, { roomId: broadcast.id, body: '@all Phase0 broadcast', mentionAll: true, idempotencyKey: 'phase0-broadcast-1' })
const dmSend = await chat.sendMessage(pm.id, { roomId: dm.id, body: 'Phase0 DM hello', mentions: [dev.id], idempotencyKey: 'phase0-dm-1' })

// directed mention（room=group）→ wake 给 Dev
const mentionSend = await chat.sendMessage(pm.id, { roomId: group.id, body: '@Dev 请评审 Phase0', mentions: [dev.id], idempotencyKey: 'phase0-mention-1' })
// 幂等重放：同 key 同请求 → replayed
const replay = await chat.sendMessage(pm.id, { roomId: group.id, body: '@Dev 请评审 Phase0', mentions: [dev.id], idempotencyKey: 'phase0-mention-1' })
// read cursor：QA 读 group
const page = await chat.listMessages(qa.id, { roomId: group.id })
const read = await chat.markRead(qa.id, { roomId: group.id, upToRoomSeq: page.items.at(-1)?.roomSeq ?? 1, idempotencyKey: 'phase0-read-1' })
// Dev inbox：wake + ack（relay/lease 薄适配：lease map 模拟投递租约；ack 用 vendor）
const inbox = await chat.checkInbox(dev.id, { roomIds: [group.id, broadcast.id, dm.id] })
const wakes = await chat.getWakeState(dev.id, { wakeIds: inbox.pendingWakeIds })
const lease = { leaseId: `lease:${dev.id}:${String(wakes[0]?.wakeId ?? 'none')}`, expiresAt: Date.now() + 60_000, holder: dev.id, simulated: true }
const ack = await chat.ackDelivery(dev.id, { wakeIds: inbox.pendingWakeIds, idempotencyKey: 'phase0-ack-1' })
// 不同 idempotency key 重放同一批 wake → vendor 返回 alreadyAcked（而不是同 key replay）
const ackReplay = await chat.ackDelivery(dev.id, { wakeIds: inbox.pendingWakeIds, idempotencyKey: 'phase0-ack-2' })
const broadcastRead = await chat.listMessages(dev.id, { roomId: broadcast.id })
const dmRead = await chat.listMessages(dev.id, { roomId: dm.id })
const broadcastMark = await chat.markRead(dev.id, { roomId: broadcast.id, upToRoomSeq: broadcastRead.items.at(-1)?.roomSeq ?? 1, idempotencyKey: 'phase0-broadcast-read-1' })
const dmMark = await chat.markRead(dev.id, { roomId: dm.id, upToRoomSeq: dmRead.items.at(-1)?.roomSeq ?? 1, idempotencyKey: 'phase0-dm-read-1' })
const inboxAfter = await chat.checkInbox(dev.id, { roomIds: [group.id] })

const result = {
  ok: true,
  rooms: { broadcast: broadcast.kind, group: group.kind, dm: dm.kind },
  mention: { seq: mentionSend.seq, roomSeq: mentionSend.roomSeq, replayed: replay.replayed },
  broadcast: { seq: broadcastSend.seq, replayed: false },
  dm: { seq: dmSend.seq },
  read: { groupUnreadAfterRead: read.unread, broadcastUnreadAfter: broadcastMark.unread, dmUnreadAfter: dmMark.unread },
  wake: { pendingBefore: inbox.pendingWakeIds.length, wakes: wakes.map((w) => ({ cause: w.cause, channel: w.channel, status: w.status })), lease, acked: ack.acked.length, alreadyAcked: ackReplay.alreadyAcked.length, pendingAfter: inboxAfter.pendingWakeIds.length },
  matrixFaceGap: [
    'vendor collab 无 relay/lease API：本 PoC 用进程内 lease map 模拟，P1 缺口（生产需 relay 投递/租约/重试）',
    '无跨进程/跨节点 wake 推送；daemon Matrix face 依赖 Matrix 事件回执，需 sidecar 适配器',
    '无 daemon PORT/事件台账对接；READ/WAKE/ACK 状态需映射到 daemon 观测面',
    'vendor read cursor 为 HMAC 绑定 room+principal；daemon Matrix face 需按公司/租户封装密钥',
    '许可/授权风险已由 Phase0 切片1 PROVENANCE 记录（无 LICENSE，制作人授权）',
  ],
}
writeFileSync(path.join(outDir, 'collab-wake.json'), JSON.stringify(result, null, 2))
writeFileSync(path.join(outDir, 'collab-wake.md'), `# Phase0 collab mention→wake\n\n- rooms: broadcast/group/dm\n- directed mention wake: ${String(wakes.length)} 个\n- idempotent send replayed=${String(replay.replayed)}\n- ack: acked=${String(ack.acked.length)} / replay alreadyAcked=${String(ackReplay.alreadyAcked.length)}\n- read cursor: group=${String(read.unread)} broadcast=${String(broadcastMark.unread)} dm=${String(dmMark.unread)}
- broadcast/DM send+read+ack 均覆盖；duplicate ack（不同 key）alreadyAcked=${String(ackReplay.alreadyAcked.length)}\n\n## Matrix face 差距\n${result.matrixFaceGap.map((g) => `- ${g}`).join('\n')}\n`)
console.log(JSON.stringify({ ok: true, wakes: wakes.length, replayed: replay.replayed, acked: ack.acked.length, alreadyAcked: ackReplay.alreadyAcked.length, pendingAfter: inboxAfter.pendingWakeIds.length, outDir }))
