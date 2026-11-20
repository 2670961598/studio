/**
 * P1-2 wake.sourceSeq 语义回归（自 test/wake.nt.ts 拆出——BC-S2 行数阈 600；断言原样保留）。
 * 语义：wake.sourceSeq=源消息在同房内的 roomSeq（非全局 seq），与 Transport v1 Message.roomSeq
 *       对齐（src/server.ts sourceSeq=roomSeq 同事务落库）——消费侧（daemon 的
 *       chatd-mention-source）按 messages.list 返回的 Message.roomSeq 匹配 wake.sourceSeq
 *       定位源消息（docs/quality/workbench-transport-v1.md M3 节）。
 * 场景：跨房消息错开全局 seq 与 roomSeq，wire（claim 回包）与 DB（wakes.source_seq）双面断言，
 *       并按消费侧定位路径（同房 room_seq=source_seq）验证能命中源消息（旧全局 seq 语义即 miss）。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 C；
 *       docs/sentinel-logs/提案-Phase1聊天服务-2026-11-17.md。
 * 边界：无网络/无密钥/无 host；不接生产、不写公司目录、不迁数据。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/wake-source-seq.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { startChatd } from './support/proc.ts'
import { expectOk, readDb, tmpDir, withClient } from './support/wake-e2e.ts'

test('e2e：mention wake 的 source_seq=源消息 roomSeq（非全局 seq）——跨房消息错开两序，DB 可按 roomSeq 定位源消息', async () => {
  const dir = tmpDir('sourceseq')
  const dbPath = path.join(dir, 'chat.db')
  const socketPath = path.join(dir, 'chat.sock')
  try {
    const h = await startChatd({ env: { WORKBENCH_CHATD_DB: dbPath }, dir, socketPath })
    try {
      await withClient(h, async (c) => {
        const roomA = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'a', memberIds: ['pm', 'dev'] }))
        const roomB = await expectOk<{ roomId: string }>(await c.call('rooms.create', { kind: 'group', name: 'b', memberIds: ['pm', 'dev'] }))
        // B 房 filler 先行：推大全局 seq 与 A 房 roomSeq 的差值
        const filler = await expectOk<{ seq: number; roomSeq: number }>(await c.call('messages.send', { roomId: roomB.roomId, senderId: 'pm', body: 'filler' }))
        assert.deepEqual([filler.seq, filler.roomSeq], [1, 1])
        const sent = await expectOk<{ seq: number; roomSeq: number }>(await c.call('messages.send', { roomId: roomA.roomId, senderId: 'pm', body: '@dev hi', mentions: ['dev'] }))
        assert.deepEqual([sent.seq, sent.roomSeq], [2, 1], '前置：全局 seq=2 与 A 房 roomSeq=1 错开')
        const inbox = await expectOk<{ pendingWakeIds: string[] }>(await c.call('inbox', { actorId: 'dev' }))
        const wakeId = inbox.pendingWakeIds[0]
        assert.ok(wakeId !== undefined, 'mention 应产生 pending wake')
        const claim = await expectOk<{ wakes: { sourceSeq: number }[] }>(await c.call('wakes.claim', { actorId: 'dev', wakeIds: [wakeId] }))
        assert.equal(claim.wakes[0]?.sourceSeq, sent.roomSeq, 'claim 回包 sourceSeq=源消息 roomSeq')
        assert.notEqual(claim.wakes[0]?.sourceSeq, sent.seq, 'claim 回包 sourceSeq 不得为全局 seq')
      })
      h.sigterm()
      assert.equal((await h.waitExit()).code, 0)
      readDb(dbPath, (db) => {
        const wakeRow = db.prepare('SELECT room_id, source_seq FROM wakes').get() as unknown as { room_id: string; source_seq: number }
        // 消费侧（chatd-mention-source）的定位路径：同房 room_seq=source_seq 必须命中源消息
        const msgRow = db.prepare('SELECT seq, room_seq FROM messages WHERE room_id = ? AND room_seq = ?').get(wakeRow.room_id, wakeRow.source_seq) as unknown as { seq: number; room_seq: number } | undefined
        assert.ok(msgRow !== undefined, '按 wake.source_seq=roomSeq 能定位源消息（旧全局 seq 语义在两序错开即 miss）')
        assert.equal(wakeRow.source_seq, msgRow.room_seq, 'DB wakes.source_seq=源消息 room_seq')
        assert.notEqual(wakeRow.source_seq, msgRow.seq, 'DB wakes.source_seq 不得为全局 seq')
      })
    } finally {
      await h.cleanup()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
