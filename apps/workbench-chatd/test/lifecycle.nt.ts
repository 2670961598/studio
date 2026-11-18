/**
 * P1-1b 模块 A 测试：进程起停 / SIGTERM drain / kill -9 重启 / 占用拒绝。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A 验收（起停/Kill -9/重启）。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/lifecycle.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { startChatd } from './support/proc.ts'
import { connectNdjson } from './support/ndjson.ts'

test('起停：ready → SIGTERM → exit 0，socket 文件清理', async () => {
  const h = await startChatd()
  try {
    await h.waitReady()
    assert.ok(existsSync(h.socketPath), 'socket 文件应存在')
    assert.ok(h.output().includes('"event":"listening"'), '应有 listening 日志')
    h.sigterm()
    const exit = await h.waitExit()
    assert.equal(exit.code, 0, `SIGTERM 后应 exit 0（signal=${String(exit.signal)}）\n${h.output()}`)
    assert.equal(exit.signal, null)
    assert.equal(existsSync(h.socketPath), false, '停机后 socket 文件应清理')
    assert.ok(h.output().includes('"event":"shutdown_complete"'), '应有 shutdown_complete 日志')
  } finally {
    await h.cleanup()
  }
})

test('drain：SIGTERM 后在途慢请求仍收到响应，其后新帧被拒（WB_UNAVAILABLE draining）', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_DELAY_MS: '300' } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const inflight = client.call('health', {}, 8_000)
    await new Promise((r) => { setTimeout(r, 50) })
    h.sigterm()
    const drained = await inflight // delay 300ms 内发 SIGTERM：drain 等在途完成
    assert.equal(drained.ok, true, `在途请求应被响应而非丢弃：${JSON.stringify(drained)}`)
    const after = await client.call('health', {}, 5_000)
    assert.equal(after.ok, false)
    if (after.ok === false) {
      assert.equal(after.error.code, 'WB_UNAVAILABLE')
      assert.equal(after.error.message, 'draining')
      assert.equal(after.error.retryable, true)
    }
    client.close()
    const exit = await h.waitExit()
    assert.equal(exit.code, 0)
  } finally {
    await h.cleanup()
  }
})

test('kill -9：进程即死且 socket 文件残留；同路径重启成功（陈旧 socket 清理，新 pid）', async () => {
  const first = await startChatd()
  const pidFirst = first.pid
  try {
    await first.waitReady()
    first.kill9()
    const exit = await first.waitExit()
    assert.equal(exit.signal, 'SIGKILL')
    assert.equal(exit.code, null)
    assert.ok(existsSync(first.socketPath), 'SIGKILL 不做清理——socket 文件残留（陈旧）')

    const second = await startChatd({ socketPath: first.socketPath })
    try {
      await second.waitReady()
      assert.notEqual(second.pid, pidFirst, '重启应为新进程')
      const client = await connectNdjson(second.socketPath)
      const health = await client.call('health')
      client.close()
      assert.equal(health.ok, true, '重启后 health 应可用')
      if (health.ok === true) {
        const result = health.result as { server?: string }
        assert.match(String(result.server), /mock/, 'health 应反映 mock 模式')
      }
    } finally {
      await second.cleanup()
    }
  } finally {
    await first.cleanup()
  }
})

test('占用保护：socket 被活实例监听时，第二实例拒绝启动（exit≠0）', async () => {
  const first = await startChatd()
  try {
    await first.waitReady()
    const second = await startChatd({ socketPath: first.socketPath })
    const exit = await second.waitExit()
    assert.notEqual(exit.code, 0, '应非 0 退出')
    assert.ok(second.output().includes('start_failed'), '应有 start_failed 日志')
    assert.ok(second.output().includes('占用'), '错误信息应说明 socket 被占用')
    // 原实例不受影响
    const client = await connectNdjson(first.socketPath)
    const health = await client.call('health')
    client.close()
    assert.equal(health.ok, true)
  } finally {
    await first.cleanup()
  }
})
