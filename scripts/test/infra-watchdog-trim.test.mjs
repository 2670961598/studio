/**
 * infra-watchdog-trim.test —— M5-4a 目标集自动裁剪（plan/08 §一 1.B#8 / §四）
 *
 * 运行：node --test scripts/test/infra-watchdog-trim.test.mjs
 *
 * 覆盖（依据 docs/plan/08-M5打包分发-2026-11-20.md §一 1.B#8「支持裁剪目标集（只留 daemon/chatd）」）：
 *   - 纯面：trimDockerStackTargets（available=全保留；unavailable=docker/matrix/taiga/container:* 让位，
 *     daemon/chatd 恒在）、dockerCliAvailable（--version 判定）、probeChatd（NDJSON health 帧；
 *     token 文件缺失/鉴权失败/未配置；结果面零 token——密钥纪律）
 *   - CLI e2e（隔离）：PATH 无 docker → 只探 daemon/chatd（docker/matrix/taiga 指向死端口也零失败——
 *     SKIP 不是失败）；probe-set-trimmed reason=unavailable 恰一条（跨轮 state 去重）；
 *     docker 回位 → probe-set-restored + docker 栈照常被探
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { dockerCliAvailable, probeChatd, trimDockerStackTargets } from '../ops/infra-watchdog-lib.mjs'

const WATCHDOG = path.join(import.meta.dirname, '..', 'ops', 'infra-watchdog.mjs')
const roots = []
const servers = []
after(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-watchdog-trim-'))
  roots.push(dir)
  return dir
}

/** 假 chatd：workbench-transport/v1 NDJSON health 帧应答（与 scripts/ops/chatd-health.mjs 同 wire 格式） */
function fakeChatdSocket(responder) {
  const dir = tempRoot()
  const socketPath = path.join(dir, 'chat.sock')
  const server = createNetServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const idx = buffer.indexOf('\n')
      if (idx < 0) return
      const frame = JSON.parse(buffer.slice(0, idx))
      socket.write(`${JSON.stringify(responder(frame))}\n`)
      socket.end()
    })
  })
  servers.push(server)
  return new Promise((resolve) => server.listen(socketPath, () => resolve(socketPath)))
}

function startHttp(handler) {
  const server = createHttpServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
}

function writeFakeBin(dir, scripts) {
  const binDir = path.join(dir, 'bin')
  mkdirSync(binDir, { recursive: true })
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(binDir, name)
    writeFileSync(file, body, 'utf8')
    chmodSync(file, 0o755)
  }
  return binDir
}

function runCliAsync(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WATCHDOG, ...args], { env: { ...process.env, ...(env ?? {}) } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('exit', (status) => resolve({ status, stdout, stderr }))
    child.once('error', reject)
  })
}

const HEALTHY_FRAME = (frame) => ({
  id: frame.id,
  ok: true,
  result: { ok: true, protocol: 'workbench-transport/v1', server: 'chatd-test' },
})

// ————————————————————————— 纯面 —————————————————————————
test('trimDockerStackTargets：available=全保留；unavailable=docker 栈让位、daemon/chatd 恒在', () => {
  const all = ['docker', 'matrix', 'taiga', 'studioDev', 'chatd', 'studioProfit', 'container:synapse']
  const kept = trimDockerStackTargets(all, true)
  assert.deepEqual(kept.targets, all)
  assert.deepEqual(kept.skipped, [])
  const trimmed = trimDockerStackTargets(all, false)
  assert.deepEqual(trimmed.targets, ['studioDev', 'chatd', 'studioProfit'])
  assert.deepEqual(trimmed.skipped, ['docker', 'matrix', 'taiga', 'container:synapse'])
})

test('dockerCliAvailable：--version exit 0 判在位；非零/抛错/无 exec 判缺席', () => {
  assert.deepEqual(dockerCliAvailable({ execImpl: () => ({ status: 0 }) }), { available: true, reason: 'ok' })
  assert.equal(dockerCliAvailable({ execImpl: () => ({ status: 127, stdout: '', stderr: 'not found' }) }).available, false)
  assert.equal(dockerCliAvailable({ execImpl: () => { throw new Error('boom') } }).available, false)
  assert.equal(dockerCliAvailable({}).available, false)
})

test('probeChatd：健康 NDJSON 应答 ok；结果面零 token（密钥纪律）', async () => {
  const dir = tempRoot()
  const tokenFile = path.join(dir, 'chatd.token')
  writeFileSync(tokenFile, 'tok-secret-123\n', 'utf8')
  const socket = await fakeChatdSocket(HEALTHY_FRAME)
  const probe = await probeChatd(socket, { tokenFile, timeoutMs: 500 })
  assert.equal(probe.ok, true)
  assert.equal(probe.reason, 'ok')
  assert.equal(probe.server, 'chatd-test')
  assert.ok(!JSON.stringify(probe).includes('tok-secret-123'), '探针结果面不得回显 token')
})

test('probeChatd：token 文件缺失/鉴权失败/未配置/坏协议', async () => {
  const dir = tempRoot()
  assert.equal((await probeChatd('', { tokenFile: path.join(dir, 'none') })).reason, 'not-configured')
  const socket = await fakeChatdSocket(HEALTHY_FRAME)
  assert.equal((await probeChatd(socket, { tokenFile: path.join(dir, 'missing-token') })).reason, 'token-file-missing')
  const unauth = await fakeChatdSocket((frame) => ({ id: frame.id, ok: false, error: { code: 'WB_UNAUTHENTICATED', message: 'unauthenticated: bad token' } }))
  const rejected = await probeChatd(unauth, { token: 'wrong', timeoutMs: 500 })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'protocol-error:WB_UNAUTHENTICATED')
  assert.ok(!JSON.stringify(rejected).includes('wrong'), '鉴权失败结果面也不得回显 token')
  const badProtocol = await fakeChatdSocket((frame) => ({ id: frame.id, ok: true, result: { ok: true, protocol: 'other/v9' } }))
  const mismatch = await probeChatd(badProtocol, { token: 't', timeoutMs: 500 })
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.reason, /bad-health:/)
})

// ————————————————————————— CLI e2e（隔离） —————————————————————————
/** 全栈夹具：docker socket/黑白洞端口全配置（裁剪判据=它们被探就会失败）；daemon/chatd 用假健康面 */
async function fullStackFixture() {
  const dir = tempRoot()
  const tokenFile = path.join(dir, 'chatd.token')
  writeFileSync(tokenFile, 'tok-trim-e2e\n', 'utf8')
  const healthz = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, pid: 1 }))
  })
  const chatSock = await fakeChatdSocket(HEALTHY_FRAME)
  const config = {
    probeIntervalMs: 20,
    failureThreshold: 2,
    alertRepeatMs: 100,
    logDir: dir,
    alertsFile: path.join(dir, 'alerts.jsonl'),
    stateFile: path.join(dir, 'state.json'),
    alertOnly: true,
    containers: ['synapse'],
    probes: {
      // 死端口/不存在路径：若被探测必然失败——证伪「SKIP 不是失败」的对照组
      docker: { socket: path.join(dir, 'no-such-docker.sock'), timeoutMs: 300 },
      matrix: { url: 'http://127.0.0.1:9/dead-matrix', timeoutMs: 300 },
      taiga: { url: 'http://127.0.0.1:9/dead-taiga', timeoutMs: 300 },
      studioDev: { url: `${healthz}/healthz`, timeoutMs: 500, guardianLabel: 'io.studionext.daemon' },
      chatd: { socket: chatSock, tokenFile, timeoutMs: 500, guardianLabel: 'io.studionext.chatd.studio-dev' },
      studioProfit: { processPattern: null },
    },
  }
  const configPath = path.join(dir, 'watchdog.json')
  writeFileSync(configPath, JSON.stringify(config), 'utf8')
  const events = () =>
    existsSync(configPath.replace('watchdog.json', 'alerts.jsonl'))
      ? readFileSync(path.join(dir, 'alerts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : []
  return {
    dir,
    configPath,
    events: () => events(),
    state: () => JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')),
    // PATH 无 docker（只系统目录；本机真 docker 被剔除——干净机器形态）
    runNoDocker: (args) => runCliAsync(['--config', configPath, ...args], { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }),
    runWithDocker: (binDir, args) => runCliAsync(['--config', configPath, ...args], { PATH: `${binDir}:/usr/bin:/bin` }),
  }
}

test('CLI：PATH 无 docker → 只探 daemon/chatd；probe-set-trimmed 恰一条（跨轮去重）；零失败', async () => {
  const fx = await fullStackFixture()
  const result = await fx.runNoDocker(['--runs', '2', '--interval-ms', '20', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const events = fx.events()
  const trimmed = events.filter((entry) => entry.event === 'probe-set-trimmed')
  assert.equal(trimmed.length, 1, '两轮只落一条 trim 事件（state 去重）')
  assert.equal(trimmed[0].level, 'info')
  assert.equal(trimmed[0].reason, 'unavailable')
  assert.deepEqual(trimmed[0].targets, ['docker', 'matrix', 'taiga', 'container:synapse'])
  // SKIP 不是失败：docker 栈指向死端口也零 probe-failed
  assert.deepEqual(events.filter((entry) => entry.event === 'probe-failed'), [])
  // 只探 daemon/chatd：state 只有两目标的 lastOkAt；docker 栈无目标态
  const state = fx.state()
  assert.deepEqual(Object.keys(state.targets).sort(), ['chatd', 'studioDev'])
  assert.equal(typeof state.targets.studioDev.lastOkAt, 'number')
  assert.equal(typeof state.targets.chatd.lastOkAt, 'number')
  assert.equal(state.probeTrim.dockerStack.active, true)
  assert.deepEqual(state.probeTrim.dockerStack.targets, ['docker', 'matrix', 'taiga', 'container:synapse'])
})

test('CLI：docker 回位 → probe-set-restored + docker 栈照常被探（假 socket/inspect 全绿）', async () => {
  const fx = await fullStackFixture()
  // 阶段一：无 docker（写 state.active=true），阶段二：假 docker 回位
  const phase1 = await fx.runNoDocker(['--once', '--json'])
  assert.equal(phase1.status, 0, phase1.stderr)
  const binDir = writeFakeBin(fx.dir, {
    docker: '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Docker version 27.0.0-fake"; exit 0; fi\nif [ "$1" = "inspect" ]; then echo true; exit 0; fi\nexit 1\n',
  })
  // docker 栈换活面：真探测面（unix socket _ping + matrix/taiga HTTP）
  const dockerSockDir = tempRoot()
  const pingServer = createNetServer((socket) => {
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'))
  })
  servers.push(pingServer)
  const dockerSocket = path.join(dockerSockDir, 'd.sock')
  await new Promise((resolve) => pingServer.listen(dockerSocket, resolve))
  const liveBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{"ok":true}')
  })
  const raw = JSON.parse(readFileSync(fx.configPath, 'utf8'))
  raw.probes.docker.socket = dockerSocket
  raw.probes.matrix.url = `${liveBase}/_matrix/client/versions`
  raw.probes.taiga.url = `${liveBase}/api/v1/`
  writeFileSync(fx.configPath, JSON.stringify(raw), 'utf8')

  const phase2 = await fx.runWithDocker(binDir, ['--once', '--json'])
  assert.equal(phase2.status, 0, phase2.stderr)
  const events = fx.events()
  const restored = events.filter((entry) => entry.event === 'probe-set-restored')
  assert.equal(restored.length, 1)
  assert.equal(restored[0].level, 'info')
  // docker 栈恢复被探且全绿（零失败）；state 有 docker 目标态
  assert.deepEqual(events.filter((entry) => entry.event === 'probe-failed'), [])
  const state = fx.state()
  for (const target of ['docker', 'matrix', 'taiga', 'container:synapse', 'studioDev', 'chatd']) {
    assert.equal(typeof state.targets[target]?.lastOkAt, 'number', `${target} 应被探测`)
  }
  assert.equal(state.probeTrim.dockerStack.active, false)
})
