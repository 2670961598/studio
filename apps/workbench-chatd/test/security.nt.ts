/**
 * P1-1b 模块 A 测试：socket 权限 0700 / token 鉴权（无 token、错 token、对 token）/ 密钥不落日志 /
 *   鉴权 fail-closed（未配 token 默认 config_invalid 拒启；显式 ALLOW_NO_AUTH=1 才放行并告警）/ 占位符 token 拒启。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A 验收（socket 0700/token 拒绝无 token）。
 * 说明：v1 冻结错误码表无 UNAUTHENTICATED——鉴权失败以 WB_INVALID_ARGUMENT（retryable:false）承载，
 *       message 前缀 `unauthenticated:`（见 src/server.ts 头注与 README）。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/security.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { startChatd } from './support/proc.ts'
import { connectNdjson } from './support/ndjson.ts'

const TOKEN = 'test-token-p1-1b-do-not-log'

test('socket 文件权限为 0700', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN } })
  try {
    await h.waitReady()
    assert.equal(statSync(h.socketPath).mode & 0o777, 0o700, 'socket 权限应为 0700')
  } finally {
    await h.cleanup()
  }
})

test('无 token：拒绝且稳定错误码 WB_INVALID_ARGUMENT（不可重试）', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const res = await client.call('health', {})
    client.close()
    assert.equal(res.ok, false, '无 token 必须被拒绝')
    if (res.ok === false) {
      assert.equal(res.error.code, 'WB_INVALID_ARGUMENT')
      assert.equal(res.error.message, 'unauthenticated: token missing')
      assert.equal(res.error.retryable, false)
      assert.equal(res.id, 'raw-1', '错误响应应带回请求 id')
    }
  } finally {
    await h.cleanup()
  }
})

test('错 token：拒绝且同一稳定错误码（token invalid）', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const res = await client.call('health', { token: 'wrong-token' })
    client.close()
    assert.equal(res.ok, false)
    if (res.ok === false) {
      assert.equal(res.error.code, 'WB_INVALID_ARGUMENT')
      assert.equal(res.error.message, 'unauthenticated: token invalid')
    }
  } finally {
    await h.cleanup()
  }
})

test('对 token：全部端点通过；token 类型非字符串亦拒绝', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const health = await client.call('health', { token: TOKEN })
    assert.equal(health.ok, true, '正确 token 应放行')
    const badType = await client.call('health', { token: 12345 })
    assert.equal(badType.ok, false, '非字符串 token 应拒绝')
    if (badType.ok === false) assert.equal(badType.error.code, 'WB_INVALID_ARGUMENT')
    client.close()
  } finally {
    await h.cleanup()
  }
})

test('未配置 token（默认 fail-closed）：config_invalid 拒启 exit 1，不进入 ready', async () => {
  // 置 '' 显式关掉测试密闭基线里的 ALLOW_NO_AUTH=1，模拟生产/env 未豁免的默认路径
  const h = await startChatd({ env: { WORKBENCH_CHATD_ALLOW_NO_AUTH: '' } })
  try {
    const exit = await h.waitExit()
    assert.equal(exit.code, 1, `未配 token 且未显式豁免应 exit 1（code=${String(exit.code)}）\n${h.output()}`)
    assert.ok(h.output().includes('"event":"config_invalid"'), '应有 config_invalid 日志')
    assert.ok(h.output().includes('WORKBENCH_CHATD_TOKEN'), '错误信息应指向 WORKBENCH_CHATD_TOKEN')
    assert.ok(h.output().includes('WORKBENCH_CHATD_ALLOW_NO_AUTH'), '错误信息应给出显式豁免途径')
    assert.equal(h.output().includes('"event":"ready"'), false, '不应进入 ready')
    assert.equal(h.output().includes('"event":"auth_disabled"'), false, '未豁免不得出现 auth_disabled 告警')
  } finally {
    await h.cleanup()
  }
})

test('显式 WORKBENCH_CHATD_ALLOW_NO_AUTH=1（仅 mock/dev/test）：免鉴权放行，且启动告警 auth_disabled', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_ALLOW_NO_AUTH: '1' } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const res = await client.call('health', {})
    client.close()
    assert.equal(res.ok, true, '显式豁免时 mock/dev 模式应免鉴权可用')
    assert.ok(h.output().includes('"event":"auth_disabled"'), '应有 auth_disabled 告警')
  } finally {
    await h.cleanup()
  }
})

test('豁免开关不降低已配 token 的鉴权：ALLOW_NO_AUTH=1 且有 token 时无 token 请求仍拒绝', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN, WORKBENCH_CHATD_ALLOW_NO_AUTH: '1' } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    const res = await client.call('health', {})
    client.close()
    assert.equal(res.ok, false, '配了 token 就必须鉴权，豁免开关只管"能否无 token 启动"')
    if (res.ok === false) assert.equal(res.error.message, 'unauthenticated: token missing')
  } finally {
    await h.cleanup()
  }
})

test('占位符 token（形如 __...__，模板未替换）：config_invalid 拒启 exit 1', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: '__WORKBENCH_CHATD_TOKEN__' } })
  try {
    const exit = await h.waitExit()
    assert.equal(exit.code, 1, `占位符 token 应 exit 1（code=${String(exit.code)}）\n${h.output()}`)
    assert.ok(h.output().includes('"event":"config_invalid"'), '应有 config_invalid 日志')
    assert.ok(h.output().includes('占位符'), '错误信息应说明占位符未替换')
    assert.equal(h.output().includes('"event":"ready"'), false, '不应进入 ready')
  } finally {
    await h.cleanup()
  }
})

test('密钥纪律：token 值不出现在进程 stdout/stderr（日志面）', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_TOKEN: TOKEN } })
  try {
    await h.waitReady()
    const client = await connectNdjson(h.socketPath)
    await client.call('health', {})
    await client.call('health', { token: 'wrong-token' })
    await client.call('health', { token: TOKEN })
    client.close()
    h.sigterm()
    await h.waitExit()
    assert.equal(h.output().includes(TOKEN), false, 'token 值不得出现在任何进程输出中')
  } finally {
    await h.cleanup()
  }
})
