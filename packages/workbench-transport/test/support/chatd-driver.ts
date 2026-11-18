/**
 * chatd-driver —— WorkbenchTransport v1 真客户端驱动器（仅测试用；Phase1 P1-1b）。
 * 由 apps/workbench-chatd/test/contract.nt.ts 以子进程拉起：对运行中的 workbench-chatd（真 Unix socket）
 * 执行「真客户端」调用（本包 src/client.ts），把观测结果按行输出 JSON 事件，由测试侧断言。
 * 与 test/support/mock-sidecar.ts 对称：那是「假 sidecar 给客户端测」，本件是「真客户端给 sidecar 测」。
 * 放在本包内的原因：workbench-chatd 不得 import 本包（分层宪法 20-§十五：新包间边=提案流），
 * 子进程拉起不构成 import 边；驱动器只 import 本包自身 src（intra，无边界违例）。
 * 用法：node --experimental-strip-types chatd-driver.ts --socket <path> [--scenario happy|timeout|kill-reconnect]
 *        [--request-timeout-ms <n>]；kill-reconnect 场景在断连观测后等 stdin 一行任意文本再验重连。
 * 输出：stdout 每行一个 JSON 事件 {stage, ...}；exit 0=场景完成，1=意外失败（fatal 事件）。
 */
import { once } from 'node:events'
import readline from 'node:readline'
import { WORKBENCH_TRANSPORT_PROTOCOL, WorkbenchTransport, WorkbenchTransportError } from '../../src/index.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const socketPath = flag('socket')
const scenario = flag('scenario') ?? 'happy'
const requestTimeoutMs = Number(flag('request-timeout-ms') ?? '2000')
if (socketPath === undefined) {
  process.stderr.write('usage: chatd-driver.ts --socket <path> [--scenario happy|timeout|kill-reconnect] [--request-timeout-ms <n>]\n')
  process.exit(1)
}

const emit = (stage: string, fields: Readonly<Record<string, unknown>> = {}): void => {
  process.stdout.write(`${JSON.stringify({ stage, ...fields })}\n`)
}

const client = new WorkbenchTransport({ socketPath, connectTimeoutMs: 1_000, requestTimeoutMs })

async function happy(): Promise<void> {
  const h = await client.health()
  emit('health', { ok: h.ok, protocol: h.protocol, server: h.server, startedAt: h.startedAt })
  if (h.protocol !== WORKBENCH_TRANSPORT_PROTOCOL) throw new Error(`protocol mismatch: ${h.protocol}`)
  const room = await client.createRoom({ kind: 'group', name: 'phase1-b', memberIds: ['pm', 'dev'] })
  emit('room', { roomId: room.roomId, kind: room.kind, memberCount: room.memberIds.length, headRoomSeq: room.headRoomSeq })
  const sent = await client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: '@dev hello', mentions: ['dev'], idempotencyKey: 'send-1' })
  emit('send', { seq: sent.seq, roomSeq: sent.roomSeq, messageId: sent.messageId, replayed: sent.replayed })
  const replay = await client.sendMessage({ roomId: room.roomId, senderId: 'pm', body: '@dev hello', mentions: ['dev'], idempotencyKey: 'send-1' })
  emit('send-replay', { messageId: replay.messageId, replayed: replay.replayed })
  if (replay.messageId !== sent.messageId) throw new Error('idempotent replay must return same messageId')
  const page = await client.listMessages({ roomId: room.roomId, actorId: 'dev' })
  emit('messages', { count: page.items.length, nextCursor: page.nextCursor, hasMore: page.hasMore, firstMentions: page.items[0]?.mentions ?? [] })
  const read1 = await client.read({ roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1, idempotencyKey: 'read-1' })
  emit('read', { roomId: read1.roomId, actorId: read1.actorId, lastReadRoomSeq: read1.lastReadRoomSeq, unread: read1.unread, replayed: read1.replayed })
  const read2 = await client.read({ roomId: room.roomId, actorId: 'dev', upToRoomSeq: 1, idempotencyKey: 'read-1' })
  emit('read-replay', { lastReadRoomSeq: read2.lastReadRoomSeq, replayed: read2.replayed })
  const inbox = await client.inbox({ actorId: 'dev' })
  emit('inbox', { actorId: inbox.actorId, unread: inbox.unread, mentions: inbox.mentions, pendingWakeIds: inbox.pendingWakeIds, rooms: inbox.rooms })
  const wakeId = inbox.pendingWakeIds[0]
  if (wakeId === undefined) throw new Error('expected one pending wake after mention')
  const claim1 = await client.claimWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-1' })
  emit('claim', { claimed: claim1.claimed, alreadyClaimed: claim1.alreadyClaimed, replayed: claim1.replayed })
  const claim2 = await client.claimWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'claim-2' })
  emit('claim-again', { claimed: claim2.claimed, alreadyClaimed: claim2.alreadyClaimed })
  const ack1 = await client.ackWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-1' })
  emit('ack', { acked: ack1.acked, alreadyAcked: ack1.alreadyAcked })
  const ack2 = await client.ackWakes({ actorId: 'dev', wakeIds: [wakeId], idempotencyKey: 'ack-2' })
  emit('ack-again', { acked: ack2.acked, alreadyAcked: ack2.alreadyAcked })
  const after = await client.inbox({ actorId: 'dev' })
  emit('inbox-after', { pendingWakeIds: after.pendingWakeIds, unread: after.unread })
}

async function timeoutScenario(): Promise<void> {
  try {
    await client.health()
    emit('timeout', { code: 'NO_ERROR' })
  } catch (err) {
    if (err instanceof WorkbenchTransportError) emit('timeout', { code: err.code, retryable: err.retryable })
    else throw err
  }
}

async function killReconnect(): Promise<void> {
  const h = await client.health()
  emit('health-ok', { ok: h.ok, server: h.server })
  emit('ready-for-kill', {})
  try {
    // 服务端 delay 拉长在途窗口；测试方看到 ready-for-kill 后对 chatd 发 SIGKILL，
    // 在途请求应被客户端归一为 WB_UNAVAILABLE（retryable），随后可自动重连。
    const slow = await client.health()
    emit('killed', { code: 'NO_ERROR', ok: slow.ok })
  } catch (err) {
    if (err instanceof WorkbenchTransportError) emit('killed', { code: err.code, retryable: err.retryable })
    else throw err
  }
  const rl = readline.createInterface({ input: process.stdin })
  await once(rl, 'line') // 等测试方重启 chatd 后放行
  rl.close()
  const again = await client.health()
  emit('reconnected', { ok: again.ok, server: again.server })
}

async function main(): Promise<void> {
  if (scenario === 'happy') await happy()
  else if (scenario === 'timeout') await timeoutScenario()
  else if (scenario === 'kill-reconnect') await killReconnect()
  else throw new Error(`unknown scenario: ${scenario}`)
  client.close()
}

main()
  .then(() => { process.exitCode = 0 }) // 不用 process.exit：给 stdout 管道冲刷时间，避免末行事件被截断
  .catch((err: unknown) => {
    emit('fatal', { message: err instanceof Error ? err.message : String(err) })
    process.exitCode = 1
  })
