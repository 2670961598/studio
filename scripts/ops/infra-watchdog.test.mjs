/**
 * infra-watchdog.test —— 774 基础设施守护（纯面 + CLI 演练）
 *
 * 运行：node --test scripts/ops/infra-watchdog.test.mjs
 *
 * 覆盖：
 *   - 配置归一化（缺省/非法 fail-fast/命令形状）
 *   - 探测：HTTP（ok/500/timeout）、docker unix socket（OK/无响应超时）、进程/容器
 *   - 决策：连续 N 次阈值、告警节流、恢复冷却/小时上限/alert-only/recovery 关闭
 *   - CLI 端到端（隔离，假 docker/launchctl 命令 + 假 HTTP 服务）：容器未起→docker start、
 *     daemon /healthz 连续失败→launchctl kickstart、alert-only 不执行、恢复成功记 recovered
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { recoveryPlan } from './infra-watchdog.mjs'
import {
  DEFAULT_WATCHDOG_CONFIG,
  classifyProbe,
  decideFailureActions,
  deploySuppressionReason,
  normalizeConfig,
  suppressionOf,
  probeContainer,
  probeDockerSocket,
  probeHttp,
  probeProcess,
  pruneRecoveryTimes,
  readWatchdogState,
  targetList,
  writeWatchdogState,
} from './infra-watchdog-lib.mjs'

const WATCHDOG = path.join(import.meta.dirname, 'infra-watchdog.mjs')
const roots = []
const servers = []
after(() => {
  for (const server of servers.splice(0)) server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sn-infra-watchdog-'))
  roots.push(dir)
  return dir
}

function startHttp(handler) {
  const server = createServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
}

function fakeUnixSocket(handler) {
  const dir = tempRoot()
  const socketPath = path.join(dir, 'd.sock')
  const server = createNetServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(socketPath, () => resolve(socketPath)))
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

// ————————————————————————— 纯面 —————————————————————————
test('normalizeConfig：缺省补全、非法 fail-fast、命令形状校验', () => {
  const cfg = normalizeConfig({})
  assert.equal(cfg.failureThreshold, DEFAULT_WATCHDOG_CONFIG.failureThreshold)
  assert.equal(cfg.recovery.enabled, true)
  assert.ok(cfg.probes.matrix.url.includes('8008'))
  assert.throws(() => normalizeConfig(null), /必须是 JSON 对象/)
  assert.throws(() => normalizeConfig({ schema: 'x' }), /schema 不符/)
  assert.throws(() => normalizeConfig({ probeIntervalMs: 0 }), /probeIntervalMs/)
  assert.throws(() => normalizeConfig({ recoveryCommands: { docker: 'pkill' } }), /非空字符串数组/)
  const custom = normalizeConfig({ probeIntervalMs: 1000, failureThreshold: 3, recovery: { enabled: false }, containers: ['synapse'] })
  assert.equal(custom.probeIntervalMs, 1000)
  assert.equal(custom.failureThreshold, 3)
  assert.equal(custom.recovery.enabled, false)
  assert.deepEqual(targetList(custom).slice(-1), ['container:synapse'])
})

test('probeHttp：200/ok、500、超时（瞬态分类 warn）', async () => {
  const okBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  const ok = await probeHttp(`${okBase}/healthz`, { timeoutMs: 500, expectOkBody: true })
  assert.equal(ok.ok, true)
  const badBase = await startHttp((_req, res) => {
    res.statusCode = 500
    res.end('{}')
  })
  const bad = await probeHttp(`${badBase}/healthz`, { timeoutMs: 500 })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'http-500')
  assert.equal(classifyProbe('matrix', bad).level, 'error')
  const hangBase = await startHttp(() => {
    /* 不响应 → AbortSignal 超时 */
  })
  const hang = await probeHttp(`${hangBase}/slow`, { timeoutMs: 120 })
  assert.equal(hang.ok, false)
  assert.match(String(hang.reason), /unreachable/)
  assert.equal(classifyProbe('matrix', hang).level, 'warn') // 瞬态=warn（774 分级）
})

test('probeDockerSocket：_ping OK；无响应→timeout', async () => {
  const okSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nOK')
    })
  })
  const ok = await probeDockerSocket(okSocket, { timeoutMs: 800 })
  assert.equal(ok.ok, true)
  const hangSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      /* 卡住不回应（模拟 Docker VM 卡死） */
    })
  })
  const hang = await probeDockerSocket(hangSocket, { timeoutMs: 150 })
  assert.equal(hang.ok, false)
  assert.match(String(hang.reason), /timeout/)
  assert.equal(classifyProbe('docker', hang).level, 'warn')
})

test('probeProcess / probeContainer：注入 exec 结果可判', () => {
  const alive = probeProcess('daemon.yaml', { execImpl: () => ({ status: 0, stdout: '123 456\n' }) })
  assert.equal(alive.ok, true)
  const dead = probeProcess('daemon.yaml', { execImpl: () => ({ status: 1, stdout: '' }) })
  assert.equal(dead.ok, false)
  const running = probeContainer('synapse', { execImpl: () => ({ status: 0, stdout: 'true\n' }) })
  assert.equal(running.ok, true)
  const stopped = probeContainer('synapse', { execImpl: () => ({ status: 0, stdout: 'false\n' }) })
  assert.equal(stopped.ok, false)
  assert.equal(stopped.reason, 'not-running')
})

test('decideFailureActions：阈值/节流/冷却/小时上限/alert-only/关闭', () => {
  const config = normalizeConfig({ failureThreshold: 2, alertRepeatMs: 1_000, recovery: { enabled: true, cooldownMs: 1_000, maxPerHour: 2 } })
  const now = 10_000
  assert.equal(decideFailureActions({ failures: 1, state: {}, config, now, alertOnly: false }).alertDue, false)
  const first = decideFailureActions({ failures: 2, state: {}, config, now, alertOnly: false })
  assert.equal(first.alertDue, true)
  assert.equal(first.recover.allowed, true)
  // 告警节流：1s 内重复失败不再告警
  const throttled = decideFailureActions({ failures: 3, state: { lastAlertAt: now }, config, now: now + 500, alertOnly: false })
  assert.equal(throttled.alertDue, false) // 1s 内节流
  // 冷却
  const cooled = decideFailureActions({ failures: 3, state: { lastRecoveryAt: now, recoveryTimes: [now] }, config, now: now + 500, alertOnly: false })
  assert.equal(cooled.recover.allowed, false)
  assert.match(String(cooled.recover.reason), /cooldown/)
  // 小时上限
  const capped = decideFailureActions({ failures: 3, state: { recoveryTimes: [now - 10, now - 20] }, config, now: now + 5000, alertOnly: false })
  assert.equal(capped.recover.allowed, false)
  assert.match(String(capped.recover.reason), /max-per-hour/)
  // alert-only / 关闭
  assert.equal(decideFailureActions({ failures: 2, state: {}, config, now, alertOnly: true }).recover.reason, 'alert-only')
  const disabled = normalizeConfig({ failureThreshold: 2, recovery: { enabled: false } })
  assert.equal(decideFailureActions({ failures: 2, state: {}, config: disabled, now, alertOnly: false }).recover.reason, 'recovery-disabled')
  assert.equal(pruneRecoveryTimes([now - 3_600_001, now - 10], now).length, 1)
})

test('readWatchdogState / writeWatchdogState 往返', () => {
  const dir = tempRoot()
  const file = path.join(dir, 'state.json')
  assert.deepEqual(readWatchdogState(file), {})
  writeWatchdogState(file, { targets: { docker: { failures: 1 } } })
  assert.deepEqual(readWatchdogState(file).targets.docker.failures, 1)
})

// ————————————————————————— CLI 演练（隔离） —————————————————————————
test('CLI：容器未起→docker start；daemon /healthz 连续失败→launchctl kickstart；记录 recovered', async () => {
  const dir = tempRoot()
  const markerDir = path.join(dir, 'markers')
  mkdirSync(markerDir, { recursive: true })
  const binDir = await writeFakeBin(dir, {
    docker: `#!/bin/sh\nif [ "$1" = "inspect" ]; then echo false; exit 0; fi\nif [ "$1" = "start" ]; then echo "$2" >> ${markerDir}/containers-started; exit 0; fi\nexit 1\n`,
    launchctl: `#!/bin/sh\necho "$@" >> ${markerDir}/launchctl-calls; exit 0\n`,
  })
  // 假外部端口：matrix/taiga/docker 健康；studio-dev healthz 前两轮 500（触发阈值），之后 200
  const matrixBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{"versions":["v1.1"]}')
  })
  const taigaBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('[]')
  })
  let healthHits = 0
  const healthBase = await startHttp((_req, res) => {
    healthHits += 1
    if (healthHits <= 2) {
      res.statusCode = 500
      res.end('{"ok":false}')
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end('{"ok":true,"pid":1}')
  })
  const dockerSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
    })
  })
  const configPath = path.join(dir, 'watchdog.json')
  const stateFile = path.join(dir, 'state.json')
  const alertsFile = path.join(dir, 'alerts.jsonl')
  const config = {
    probeIntervalMs: 30,
    failureThreshold: 2,
    alertRepeatMs: 100,
    logDir: dir,
    alertsFile,
    stateFile,
    recovery: { enabled: true, cooldownMs: 1_000, maxPerHour: 5 },
    containers: ['synapse'],
    probes: {
      docker: { socket: dockerSocket, timeoutMs: 500 },
      matrix: { url: `${matrixBase}/_matrix/client/versions`, timeoutMs: 500 },
      taiga: { url: `${taigaBase}/api/v1/`, timeoutMs: 500 },
      studioDev: { url: `${healthBase}/healthz`, timeoutMs: 500, guardianLabel: 'io.studionext.daemon' },
      studioProfit: { processPattern: null },
    },
  }
  writeFileSync(configPath, JSON.stringify(config), 'utf8')
  const result = await runCliAsync(['--config', configPath, '--runs', '3', '--interval-ms', '30', '--json'], { PATH: `${binDir}:${process.env.PATH ?? ''}` })
  assert.equal(result.status, 0, result.stderr)
  // docker start 被调用（容器未起，第二轮阈值触发）
  assert.ok(existsSync(path.join(markerDir, 'containers-started')), 'container start 未执行')
  assert.match(readFileSync(path.join(markerDir, 'containers-started'), 'utf8'), /synapse/)
  // launchctl kickstart 被调用（studioDev 连续失败达阈值）
  assert.ok(existsSync(path.join(markerDir, 'launchctl-calls')), 'launchctl 未执行')
  assert.match(readFileSync(path.join(markerDir, 'launchctl-calls'), 'utf8'), /kickstart/)
  // 事件面：probe-failed warn、recovery-attempt/ok、recovered info、watchdog-start/stop info
  const events = readFileSync(alertsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const names = events.map((entry) => entry.event)
  assert.ok(names.includes('watchdog-start'))
  assert.ok(names.includes('watchdog-stop'))
  assert.ok(events.some((entry) => entry.event === 'probe-failed' && entry.target === 'studioDev' && entry.level === 'error'))
  assert.ok(events.some((entry) => entry.event === 'recovery-attempt' && entry.target === 'studioDev'))
  assert.ok(events.some((entry) => entry.event === 'recovery-ok' && entry.target === 'studioDev'))
  assert.ok(events.some((entry) => entry.event === 'recovered' && entry.level === 'info'))
  // state 持久化
  const state = readWatchdogState(stateFile)
  assert.equal(typeof state.lastRoundAt, 'number')
})

test('CLI --alert-only：同样连续失败但不执行任何恢复命令', async () => {
  const dir = tempRoot()
  const markerDir = path.join(dir, 'markers')
  mkdirSync(markerDir, { recursive: true })
  const binDir = await writeFakeBin(dir, {
    docker: `#!/bin/sh\nif [ "$1" = "inspect" ]; then echo true; exit 0; fi\necho "$@" >> ${markerDir}/called; exit 1\n`,
    launchctl: `#!/bin/sh\necho "$@" >> ${markerDir}/called; exit 0\n`,
  })
  const hangBase = await startHttp((_req, res) => {
    res.statusCode = 500
    res.end('{}')
  })
  const dockerSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
    })
  })
  const configPath = path.join(dir, 'watchdog.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      probeIntervalMs: 30,
      failureThreshold: 2,
      alertRepeatMs: 100,
      logDir: dir,
      alertsFile: path.join(dir, 'alerts.jsonl'),
      stateFile: path.join(dir, 'state.json'),
      recovery: { enabled: true, cooldownMs: 1_000, maxPerHour: 5 },
      containers: ['synapse'],
      probes: {
        docker: { socket: dockerSocket, timeoutMs: 500 },
        matrix: { url: `${hangBase}/_matrix/client/versions`, timeoutMs: 200 },
        taiga: { url: `${hangBase}/api/v1/`, timeoutMs: 200 },
        studioDev: { url: `${hangBase}/healthz`, timeoutMs: 200, guardianLabel: 'io.studionext.daemon' },
        studioProfit: { processPattern: null },
      },
    }),
    'utf8',
  )
  const result = await runCliAsync(['--config', configPath, '--runs', '3', '--interval-ms', '30', '--alert-only'], { PATH: `${binDir}:${process.env.PATH ?? ''}` })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(path.join(markerDir, 'called')), false, 'alert-only 不应执行恢复命令')
  const events = readFileSync(path.join(dir, 'alerts.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.ok(events.some((entry) => entry.event === 'recovery-skipped' && String(entry.note).includes('alert-only')))
})

// ————————————————————————— 774/B1：shipped example 可运行性 —————————————————————————
test('B1：shiped example（docker 恢复命令对象形状）可被 normalizeConfig 接受，recoveryPlan 输出合法命令', () => {
  const examplePath = path.join(import.meta.dirname, '..', '..', 'ops', 'launchd', 'infra-watchdog.example.json')
  const raw = JSON.parse(readFileSync(examplePath, 'utf8'))
  const placeholders = JSON.parse(JSON.stringify(raw).replace(/__LOGDIR__/g, tempRoot()).replace(/__WORKROOT__/g, '/tmp/fake-workroot'))
  const cfg = normalizeConfig(placeholders) // 旧实现此处抛「recoveryCommands.docker 必须是非空字符串数组」
  assert.equal(cfg.recovery.enabled, true)
  assert.deepEqual(cfg.recoveryCommands.docker, {
    dockerKill: ['pkill', '-f', 'Docker.app'],
    dockerStart: ['open', '-a', 'Docker'],
  })
  const plan = recoveryPlan('docker', cfg, { ok: false, reason: 'timeout' })
  assert.equal(plan.commands.length, 2)
  assert.deepEqual(plan.commands[0], ['pkill', '-f', 'Docker.app'])
  assert.deepEqual(plan.commands[1], ['open', '-a', 'Docker'])
  // 容器/守护恢复命令也来自 example（合法数组）
  assert.deepEqual(recoveryPlan('container:synapse', cfg, { ok: false }).commands, [['docker', 'start', 'synapse']])
})

test('B1：docker 恢复命令对象子键非法 → fail-fast（不静默）', () => {
  assert.throws(() => normalizeConfig({ recoveryCommands: { docker: { dockerKill: 'pkill' } } }), /docker\.dockerKill/)
  assert.throws(() => normalizeConfig({ recoveryCommands: { docker: { dockerStart: [] } } }), /docker\.dockerStart/)
  assert.throws(() => normalizeConfig({ recoveryCommands: { docker: { dockerRestart: ['x'] } } }), /未知子键/)
  assert.throws(() => normalizeConfig({ recoveryCommands: { docker: {} } }), /至少需/)
})

test('B1：shipped example 形状经 CLI --once 实跑 exit0（占位替换 + 探针换假服务）', async () => {
  const examplePath = path.join(import.meta.dirname, '..', '..', 'ops', 'launchd', 'infra-watchdog.example.json')
  const raw = JSON.parse(readFileSync(examplePath, 'utf8'))
  const dir = tempRoot()
  const dockerSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
    })
  })
  const okBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, pid: 1 }))
  })
  const cfg = {
    ...raw,
    probeIntervalMs: 20,
    failureThreshold: 1,
    logDir: dir,
    alertsFile: path.join(dir, 'alerts.jsonl'),
    stateFile: path.join(dir, 'state.json'),
    alertOnly: true,
    recovery: { ...raw.recovery, enabled: false },
    containers: [],
    probes: {
      ...raw.probes,
      docker: { socket: dockerSocket, timeoutMs: 500 },
      matrix: { ...raw.probes.matrix, url: `${okBase}/versions` },
      taiga: { ...raw.probes.taiga, url: `${okBase}/api/` },
      studioDev: { ...raw.probes.studioDev, url: `${okBase}/healthz` },
      studioProfit: { processPattern: null },
    },
  }
  const configPath = path.join(dir, 'shipped-example.json')
  writeFileSync(configPath, JSON.stringify(cfg), 'utf8')
  const result = await runCliAsync(['--config', configPath, '--once', '--json'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(path.join(dir, 'alerts.jsonl')))
})

// ————————————————————————— 812 后续单：boot/deploy 抑制窗 + 恢复审计 —————————————————————————

/** CLI 抑制面夹具：健康目标全绿；studioDev 由 handler 控制；recovery 命令写 marker */
async function suppressionFixture(healthHandler, extraConfig = {}) {
  const dir = tempRoot()
  const markerDir = path.join(dir, 'markers')
  mkdirSync(markerDir, { recursive: true })
  const healthyBase = await startHttp((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{"ok":true}')
  })
  const healthBase = await startHttp(healthHandler)
  const dockerSocket = await fakeUnixSocket((socket) => {
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
    })
  })
  const binDir = await writeFakeBin(dir, {
    launchctl: `#!/bin/sh\necho "$@" >> ${markerDir}/launchctl-calls\nexit 0\n`,
  })
  const alertsFile = path.join(dir, 'infra-alerts.jsonl')
  const stateFile = path.join(dir, 'state.json')
  const configPath = path.join(dir, 'watchdog.json')
  const config = {
    schema: 'studio-next/infra-watchdog-config/v1',
    probeIntervalMs: 20,
    failureThreshold: 1,
    alertRepeatMs: 1,
    logDir: dir,
    alertsFile,
    stateFile,
    recovery: { enabled: true, cooldownMs: 1, maxPerHour: 99 },
    containers: [],
    probes: {
      docker: { socket: dockerSocket, timeoutMs: 500 },
      matrix: { url: `${healthyBase}/matrix`, timeoutMs: 500 },
      taiga: { url: `${healthyBase}/taiga`, timeoutMs: 500 },
      studioDev: { url: `${healthBase}/healthz`, timeoutMs: 500, guardianLabel: 'io.studionext.daemon' },
      studioProfit: { processPattern: null, guardianLabel: null },
    },
    recoveryCommands: { studioDevKickstart: ['launchctl', 'kickstart', '-k', 'gui/0/io.studionext.daemon'] },
    ...extraConfig,
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  return {
    dir,
    configPath,
    alertsFile,
    markerDir,
    stateFile,
    run: async (extraArgs = []) =>
      runCliAsync(['--config', configPath, '--once', '--json', ...extraArgs], { PATH: `${binDir}:${process.env.PATH ?? ''}` }),
    runRounds: async (runs) =>
      runCliAsync(['--config', configPath, '--runs', String(runs), '--interval-ms', '20', '--json'], { PATH: `${binDir}:${process.env.PATH ?? ''}` }),
    events: () => {
      if (!existsSync(alertsFile)) return []
      return readFileSync(alertsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    },
    recoveredCommand: () => existsSync(path.join(markerDir, 'launchctl-calls')),
  }
}

test('抑制窗：daemon 启动中（healthz body.uptimeMs<120s）→ 只告警不 recovery，事件带观测', async () => {
  const fx = await suppressionFixture((_req, res) => {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: false, uptimeMs: 30_000, loop: { lagMs: 4_200 } }))
  })
  const result = await fx.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fx.recoveredCommand(), false, 'boot 抑制窗内不得执行 recoverCommands')
  const events = fx.events()
  const suppressed = events.find((e) => e.event === 'recovery-suppressed' && e.target === 'studioDev')
  assert.ok(suppressed, '缺 recovery-suppressed 事件（抑制不可查）')
  assert.equal(suppressed.suppressionReason, 'boot-uptime')
  assert.equal(suppressed.uptimeMs, 30_000)
  assert.equal(suppressed.loopLagMs, 4_200)
  assert.ok(events.some((e) => e.event === 'probe-failed' && e.target === 'studioDev' && e.failures >= 1), '抑制不得吞告警')
  assert.equal(events.some((e) => e.event === 'recovery-attempt'), false)
})

test('抑制窗：部署中（deployStateFile status=deploying）→ 不 recovery；解除后仍失败才恢复', async () => {
  const deployStateFile = path.join(tempRoot(), 'deploy-state.json')
  writeFileSync(deployStateFile, JSON.stringify({ status: 'deploying', deployedAt: new Date().toISOString() }), 'utf8')
  const fx = await suppressionFixture(
    (_req, res) => {
      res.statusCode = 500
      res.end('{"ok":false}')
    },
    { deployStateFile },
  )
  assert.equal((await fx.run()).status, 0)
  assert.equal(fx.recoveredCommand(), false, 'deploying 状态不得 recovery')
  assert.ok(fx.events().some((e) => e.event === 'recovery-suppressed' && e.suppressionReason === 'deploying'))
  // 抑制解除（部署完成，deployedAt 早于窗口）→ 仍失败应恢复；审计带 lastReason 等观测
  writeFileSync(deployStateFile, JSON.stringify({ status: 'active', deployedAt: new Date(Date.now() - 3_600_000).toISOString() }), 'utf8')
  assert.equal((await fx.run()).status, 0)
  assert.equal(fx.recoveredCommand(), true, '抑制解除后持续失败应恢复')
  const attempt = fx.events().find((e) => e.event === 'recovery-attempt' && e.target === 'studioDev')
  assert.ok(attempt, '缺 recovery-attempt')
  assert.equal(attempt.lastReason, 'http-500')
  assert.ok(typeof attempt.failures === 'number' && attempt.failures >= 1)
})

test('抑制不掩盖持续失败：连续多轮仍告警、抑制事件只一条、恢复后照常动作', async () => {
  let mode = 'booting'
  const fx = await suppressionFixture(
    (_req, res) => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(mode === 'booting' ? { ok: false, uptimeMs: 30_000 } : { ok: false, uptimeMs: 999_000 }))
    },
    { probeIntervalMs: 20 },
  )
  await fx.runRounds(2)
  assert.equal(fx.recoveredCommand(), false)
  const suppressed = fx.events().filter((e) => e.event === 'recovery-suppressed' && e.target === 'studioDev')
  assert.equal(suppressed.length, 1, '抑制事件应按原因去重（不逐轮刷屏）')
  const failed = fx.events().filter((e) => e.event === 'probe-failed' && e.target === 'studioDev')
  assert.ok(failed.length >= 2, `持续失败应逐轮告警（实得 ${String(failed.length)}）`)
  // uptime 已超窗（真挂死）→ 下一轮解除抑制并恢复
  mode = 'hung'
  await fx.run()
  assert.equal(fx.recoveredCommand(), true, '真挂死不得被抑制永久掩盖')
})

test('无抑制配置/信号：行为与旧版一致（失败达阈值→直接 recovery，无 recovery-suppressed）', async () => {
  const fx = await suppressionFixture((_req, res) => {
    res.statusCode = 500
    res.end('{"ok":false}')
  })
  const noCfgRun = await fx.run()
  assert.equal(noCfgRun.status, 0, `stdout=${noCfgRun.stdout} stderr=${noCfgRun.stderr}`)
  assert.equal(fx.recoveredCommand(), true, '无配置时不得改变既有恢复行为')
  const events = fx.events()
  assert.ok(events.some((e) => e.event === 'recovery-attempt' && e.target === 'studioDev'))
  assert.equal(events.some((e) => e.event === 'recovery-suppressed'), false)
})

test('suppressionOf/deploySuppressionReason：纯面判定（boot 低 uptime/部署近窗/fail-open）', () => {
  const base = normalizeConfig({})
  const now = Date.now()
  const lowUptime = suppressionOf({ target: 'studioDev', probe: { ok: false, body: { uptimeMs: 30_000 } }, targetState: { failures: 2 }, deployState: null, config: base, now })
  assert.equal(lowUptime?.reason, 'boot-uptime')
  const highUptime = suppressionOf({ target: 'studioDev', probe: { ok: false, body: { uptimeMs: 999_000 } }, targetState: { failures: 2 }, deployState: null, config: base, now })
  assert.equal(highUptime, null)
  assert.equal(deploySuppressionReason({ status: 'deploying' }, now, 120_000)?.reason, 'deploying')
  assert.equal(deploySuppressionReason({ deployedAt: new Date(now - 1_000).toISOString() }, now, 120_000)?.reason, 'deploy-recent')
  assert.equal(deploySuppressionReason({ deployedAt: new Date(now - 3_600_000).toISOString() }, now, 120_000), null)
  assert.equal(deploySuppressionReason(null, now, 120_000), null)
})
