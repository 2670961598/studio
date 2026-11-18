/**
 * P1-1b 契约测试：用 packages/workbench-transport 的真客户端（WorkbenchTransport v1）打真 socket。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md §五（rooms/messages/read 的 contract；错误码/超时/断连）；
 *       docs/quality/workbench-transport-v1.md（P1-1b 对接点）。
 * 形态：驱动器子进程（packages/workbench-transport/test/support/chatd-driver.ts，真客户端）×
 *       chatd 子进程（真服务端）。两包文件互不 import（分层宪法 20-§十五 包间边冻结），经子进程组合成真 socket 契约。
 * 场景：happy（全端点+幂等+claim/ack）/ timeout（WB_TIMEOUT）/ kill-reconnect（WB_UNAVAILABLE+自动重连）。
 * 运行：node --experimental-strip-types --test apps/workbench-chatd/test/contract.nt.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { CHATD_DRIVER, startChatd, sleep, type ChatdHandle } from './support/proc.ts'
import { connectNdjson } from './support/ndjson.ts'

interface DriverEvent {
  readonly stage: string
  readonly [key: string]: unknown
}

/** 驱动器会话：收集 stdout NDJSON 事件（按 stage 等待/检索）+ stdin 放行（kill-reconnect 用）。 */
class DriverSession {
  private readonly events: DriverEvent[] = []
  private exitCode: number | null = null
  private exited = false
  private stderrText = ''
  private readonly proc: ChildProcess

  constructor(args: string[]) {
    this.proc = spawn(process.execPath, ['--experimental-strip-types', CHATD_DRIVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (line.trim() === '') continue
        this.events.push(JSON.parse(line) as DriverEvent)
      }
    })
    this.proc.stderr?.setEncoding('utf8')
    this.proc.stderr?.on('data', (chunk: string) => { this.stderrText += chunk })
    this.proc.once('exit', (code) => {
      this.exited = true
      this.exitCode = code
    })
  }

  async waitFor(stage: string, timeoutMs = 10_000): Promise<DriverEvent> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const index = this.events.findIndex((e) => e.stage === stage)
      if (index >= 0) return this.events.splice(index, 1)[0] as DriverEvent
      if (this.exited) throw new Error(`驱动器已退出（code=${String(this.exitCode)}）等不到 ${stage}；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      if (Date.now() > deadline) throw new Error(`等待事件 ${stage} 超时；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      await sleep(20)
    }
  }

  /** 尚未被 waitFor 消费的事件。 */
  collected(): readonly DriverEvent[] {
    return this.events
  }

  release(line: string): void {
    this.proc.stdin?.write(`${line}\n`)
  }

  async done(timeoutMs = 10_000): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (!this.exited) {
      if (Date.now() > deadline) throw new Error(`等待驱动器退出超时；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      await sleep(20)
    }
    return this.exitCode ?? -1
  }
}

test('happy 契约：真客户端 health/rooms/messages/read/inbox/claim-ack 全绿 + 幂等 replay', async () => {
  const h = await startChatd()
  try {
    await h.waitReady()
    const driver = new DriverSession(['--socket', h.socketPath, '--scenario', 'happy'])
    const code = await driver.done()
    const fatal = driver.collected().find((e) => e.stage === 'fatal')
    assert.equal(fatal, undefined, `驱动器不应 fatal：${JSON.stringify(fatal)}`)
    assert.equal(code, 0, `驱动器应 exit 0（实际 ${String(code)}）`)

    const health = driver.collected().find((e) => e.stage === 'health')
    assert.ok(health !== undefined, '应有 health 事件')
    assert.equal(health?.['ok'], true)
    assert.equal(health?.['protocol'], 'workbench-transport/v1', '协议版本与冻结值一致')
    assert.match(String(health?.['server']), /mock/, 'health 经真客户端应见 mock 标记')

    const send = driver.collected().find((e) => e.stage === 'send')
    assert.equal(send?.['roomSeq'], 1)
    const sendReplay = driver.collected().find((e) => e.stage === 'send-replay')
    assert.equal(sendReplay?.['replayed'], true, '同幂等键发送应 replay')
    assert.equal(sendReplay?.['messageId'], send?.['messageId'], 'replay 应返回同 messageId')

    const read = driver.collected().find((e) => e.stage === 'read')
    assert.deepEqual({ seq: read?.['lastReadRoomSeq'], unread: read?.['unread'] }, { seq: 1, unread: 0 })
    const readReplay = driver.collected().find((e) => e.stage === 'read-replay')
    assert.equal(readReplay?.['replayed'], true)

    const inbox = driver.collected().find((e) => e.stage === 'inbox')
    const pending = inbox?.['pendingWakeIds'] as string[]
    assert.equal(pending?.length, 1, 'mention 后应有 1 个 pending wake')
    const claim = driver.collected().find((e) => e.stage === 'claim')
    assert.deepEqual(claim?.['claimed'], pending)
    const claimAgain = driver.collected().find((e) => e.stage === 'claim-again')
    assert.deepEqual(claimAgain?.['alreadyClaimed'], pending)
    const ack = driver.collected().find((e) => e.stage === 'ack')
    assert.deepEqual(ack?.['acked'], pending)
    const inboxAfter = driver.collected().find((e) => e.stage === 'inbox-after')
    assert.deepEqual(inboxAfter?.['pendingWakeIds'], [], 'ack 后 pending 清空')
  } finally {
    await h.cleanup()
  }
})

test('timeout 契约：真客户端请求超时 → WB_TIMEOUT（retryable）；chatd 自身不受影响', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_DELAY_MS: '500' } })
  try {
    await h.waitReady()
    const driver = new DriverSession(['--socket', h.socketPath, '--scenario', 'timeout', '--request-timeout-ms', '100'])
    const code = await driver.done()
    assert.equal(code, 0, `驱动器应 exit 0（实际 ${String(code)}）`)
    const timeout = driver.collected().find((e) => e.stage === 'timeout')
    assert.deepEqual({ code: timeout?.['code'], retryable: timeout?.['retryable'] }, { code: 'WB_TIMEOUT', retryable: true })

    const client = await connectNdjson(h.socketPath)
    const stillAlive = await client.call('health', {}, 8_000) // delay 仍生效，给足超时
    client.close()
    assert.equal(stillAlive.ok, true, '客户端超时不污染服务端：health 仍可用')
  } finally {
    await h.cleanup()
  }
})

test('kill-reconnect 契约：SIGKILL 断连 → 在途 WB_UNAVAILABLE（retryable）；重启后同客户端自动重连', async () => {
  const h = await startChatd({ env: { WORKBENCH_CHATD_DELAY_MS: '1000' } })
  try {
    await h.waitReady()
    const driver = new DriverSession(['--socket', h.socketPath, '--scenario', 'kill-reconnect', '--request-timeout-ms', '8000'])
    const healthOk = await driver.waitFor('health-ok')
    assert.equal(healthOk['ok'], true)
    await driver.waitFor('ready-for-kill')

    h.kill9()
    const killed = await driver.waitFor('killed', 10_000)
    assert.deepEqual({ code: killed['code'], retryable: killed['retryable'] }, { code: 'WB_UNAVAILABLE', retryable: true }, '在途请求应归一为 WB_UNAVAILABLE')

    const restarted = await startChatd({ socketPath: h.socketPath })
    try {
      await restarted.waitReady()
      driver.release('go')
      const reconnected = await driver.waitFor('reconnected', 10_000)
      assert.equal(reconnected['ok'], true, '重启后同一客户端实例应自动重连并恢复')
      const code = await driver.done()
      assert.equal(code, 0)
    } finally {
      await restarted.cleanup()
    }
  } finally {
    await h.cleanup()
  }
})
