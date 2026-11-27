/**
 * acceptance-timeout.test.ts —— 验收闸门超时公司级可配（task-138）
 *
 * 依据（实现单引用）：task-138（daemon.yaml 公司级 `acceptanceTimeoutMs`，非法值启动拒
 * fail-closed）；docs/17-§6 验收闸门超时位别注记（四要件判据零变更——超时=要件 4 的执行
 * 边界）；docs/quality/验收超时配置与调优.md（配置/范围/缺省/风险面）；哨班 2026-11-26
 * （固定 60s 误杀重载验收命令→GATE_FAIL→熔断循环的事故动因）。
 *
 * 本套钉四面（配置通道是超时在 daemon.yaml 的唯一入口，缺省不写=引擎缺省零行为变化）：
 *   1. 配置解析：缺省不写=undefined（生效值走引擎缺省——配置层不复制 60_000 数值）；
 *      合法整数（含两端边界 1000/3600000）生效；非法（0/负数/非整数/字符串/越界）解析即拒
 *      ——fail-closed，不静默取缺省；
 *   2. 闸门行为：真子进程 `sleep 1.5`——1000ms 判负 exit=124(timeout)，3000ms 放行 exit=0，
 *      不传 timeoutMs（缺省 60s）不误杀短命令（缺省链零回归的短超时等价断言）；
 *   3. 装配链路：daemon.yaml 文本 → buildServeRuntime → 引擎收割闸门实际超时（两拍真栈：
 *      tick1 派发/tick2 收割，GATE_FAIL note 携 exit=124(timeout)＝配置值确已到 runShell 的
 *      行为证据——不测常量复制）；缺省链同栈 GATE_PASS；源锚钉「单值双消费」（收割闸门+
 *      合并跑门禁同取 config.acceptanceTimeoutMs，不双源漂移）；
 *   4. 启动日志：runServe 真跑主循环，`[serve] 验收闸门超时=<ms>ms（来源=…）` 两形可核对。
 *
 * 边界：不碰四要件判定/事件词/契约；不引合并跑全链（门禁超时同值由源锚钉，合并行为归
 * merge 套）；生产 daemon.yaml 不动（临时根 mkdtemp，结束整根删除）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalPlatform } from '@studio-next/localplatform'
import { openLedger } from '@studio-next/store'
import { buildServeRuntime, DEMO_SNAPSHOT, parseDaemonConfig, runServe } from '../../../src/assembly/serve.ts'
import { createAcceptanceGateRunner } from '../../../src/engine/gate.ts'
import { writeStopRequest } from '../../../src/control/stop-channel.ts'

const T0 = Date.parse('2026-11-02T00:00:00.000Z')
const SECRET_ENV = 'STUDIO_GATEWAY_SECRET'
const GATEWAY_KEY_MATERIAL = 'studio-next-v2-acceptance-timeout-channel-key-material-0123456789'

const workdir = mkdtempSync(path.join(tmpdir(), 'acceptance-timeout-v2-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

function newRoot(tag: string): string {
  const root = mkdtempSync(path.join(workdir, `${tag}-`))
  mkdirSync(path.join(root, 'var'), { recursive: true })
  return root
}

/** 抓 CONFIG_INVALID 报错原文（放行即失败——fail-open 路径不得存在） */
function catchError(run: () => unknown): string {
  try {
    run()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望 CONFIG_INVALID 拒绝，实际放行——fail-open 路径仍在')
}

/** 闸门直测工作区：REPORT.md 非空就位（要件 3 前置——闸门先验 REPORT 再跑冻结命令） */
function gateWorkspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(workdir, 'gate-ws-'))
  writeFileSync(path.join(dir, 'REPORT.md'), '# gate REPORT\n', 'utf8')
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** 扁平 daemon.yaml（路径标量 JSON.stringify 引号壳——与 CLI 骨架同纪律） */
function daemonYaml(root: string, extra: readonly string[] = []): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    `db: ${q(path.join(root, 'var', 'ledger.sqlite'))}`,
    'platform: localfile',
    'company: demo',
    `rootDir: ${q(path.join(root, 'var'))}`,
    'tickMs: 25',
    ...extra,
  ].join('\n')
}

interface StackHarness {
  readonly ticket: string
  readonly runtime: Awaited<ReturnType<typeof buildServeRuntime>>
  readonly ledger: ReturnType<typeof openLedger>
}

/** serve 级装配（seatbelt-config 同款 localfile 真栈：预置新单→buildServeRuntime→两拍） */
async function buildStack(tag: string, extra: readonly string[]): Promise<StackHarness> {
  const root = newRoot(tag)
  const config = parseDaemonConfig(daemonYaml(root, extra))
  const platformDir = path.join(root, 'var', 'platform')
  mkdirSync(platformDir, { recursive: true })
  const seed = createLocalPlatform(platformDir)
  const issue = await seed.issues.create({ title: '验收闸门超时装配链路', type: 'task', level: 0, initialState: '新单' })
  const ledger = openLedger(config.db)
  const runtime = buildServeRuntime(config, ledger, DEMO_SNAPSHOT, { log: () => {}, clock: () => T0 })
  return { ticket: issue.id, runtime, ledger }
}

let savedSecret: string | undefined
beforeEach(() => {
  savedSecret = process.env[SECRET_ENV]
  process.env[SECRET_ENV] = GATEWAY_KEY_MATERIAL // localfile 非 demo 形态：签根须由部署秘密源注入（SEC-FC-02）
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_ENV]
  else process.env[SECRET_ENV] = savedSecret
  savedSecret = undefined
})

describe('配置解析：acceptanceTimeoutMs（解析即验 fail-closed）', () => {
  it('缺省不写=undefined（生效值走引擎缺省——配置层不复制默认数值）', () => {
    const root = newRoot('cfg-default')
    const config = parseDaemonConfig(daemonYaml(root))
    expect(config.acceptanceTimeoutMs).toBeUndefined()
  })

  it('合法整数生效：两端边界 1000/3600000 与常用值 300000', () => {
    const root = newRoot('cfg-valid')
    expect(parseDaemonConfig(daemonYaml(root, ['acceptanceTimeoutMs: 1000'])).acceptanceTimeoutMs).toBe(1000)
    expect(parseDaemonConfig(daemonYaml(root, ['acceptanceTimeoutMs: 300000'])).acceptanceTimeoutMs).toBe(300000)
    expect(parseDaemonConfig(daemonYaml(root, ['acceptanceTimeoutMs: 3600000'])).acceptanceTimeoutMs).toBe(3_600_000)
  })

  it('非法值解析即拒（0/负数/非整数/字符串/越界）——错误消息点名键，不静默取缺省', () => {
    const root = newRoot('cfg-invalid')
    for (const line of [
      'acceptanceTimeoutMs: 0',
      'acceptanceTimeoutMs: -500',
      'acceptanceTimeoutMs: 500',
      'acceptanceTimeoutMs: 3600001',
      'acceptanceTimeoutMs: 1.5',
      'acceptanceTimeoutMs: "300000"',
      'acceptanceTimeoutMs: abc',
    ]) {
      const message = catchError(() => parseDaemonConfig(daemonYaml(root, [line])))
      expect(message, line).toMatch(/acceptanceTimeoutMs/)
    }
  })
})

describe('真验收闸门行为：timeoutMs 逐条冻结命令的执行上限', () => {
  it('1000ms 下 sleep 1.5 判负：exit=124，note 明示 (timeout)', { timeout: 20_000 }, async () => {
    const { dir, cleanup } = gateWorkspace()
    try {
      const runner = createAcceptanceGateRunner(['sleep 1.5'], { timeoutMs: 1000 })
      const outcome = await runner.run({ ticket: 'AT-1', attempt: 1, workspace: dir, briefPath: path.join(dir, 'brief.md') })
      expect(outcome.exitCode).toBe(124)
      expect(outcome.note ?? '').toContain('exit=124(timeout)')
      expect(outcome.reportExists).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('3000ms 下 sleep 1.5 放行：exit=0（同命令，放宽后不再误杀）', { timeout: 20_000 }, async () => {
    const { dir, cleanup } = gateWorkspace()
    try {
      const runner = createAcceptanceGateRunner(['sleep 1.5'], { timeoutMs: 3000 })
      const outcome = await runner.run({ ticket: 'AT-1', attempt: 1, workspace: dir, briefPath: path.join(dir, 'brief.md') })
      expect(outcome.exitCode).toBe(0)
      expect(outcome.note ?? '').toContain('exit=0')
    } finally {
      cleanup()
    }
  })

  it('不传 timeoutMs（缺省 60s）→ sleep 1.5 放行 exit=0（缺省链零回归的短超时等价断言）', { timeout: 20_000 }, async () => {
    const { dir, cleanup } = gateWorkspace()
    try {
      const runner = createAcceptanceGateRunner(['sleep 1.5'])
      const outcome = await runner.run({ ticket: 'AT-1', attempt: 1, workspace: dir, briefPath: path.join(dir, 'brief.md') })
      expect(outcome.exitCode).toBe(0)
      expect(outcome.note ?? '').toContain('exit=0')
    } finally {
      cleanup()
    }
  })
})

describe('装配链路：daemon.yaml → buildServeRuntime → 引擎收割闸门实际超时', () => {
  it('acceptanceTimeoutMs: 1000 → 两拍真栈收割 GATE_FAIL，note 携 exit=124(timeout)', { timeout: 60_000 }, async () => {
    const { ticket, runtime, ledger } = await buildStack('chain-timeout', [`acceptance: ${JSON.stringify('sleep 1.5')}`, 'acceptanceTimeoutMs: 1000'])
    try {
      await runtime.engine.tick() // tick1：派发（fake executor 代写 REPORT/summary——要件 3 就位）
      expect(ledger.queryEvents({ issue: ticket }).some((e) => e.event === 'DISPATCH')).toBe(true)
      await runtime.engine.tick() // tick2：收割→真闸门跑 sleep 1.5，1000ms 超时杀组判负
      const gateFail = ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_FAIL')
      expect(gateFail, '配置值未到闸门＝放行（透传断链）').toBeDefined()
      expect(gateFail?.note ?? '').toContain('真验收闸门')
      expect(gateFail?.note ?? '').toContain('exit=124(timeout)')
      expect(ledger.listWorkRecords({ issue: ticket })[0]?.status).toBe('failed')
    } finally {
      await runtime.stop()
    }
  })

  it('缺省不写键 → 同栈 GATE_PASS（60s 缺省不误杀 sleep 1.5）', { timeout: 60_000 }, async () => {
    const { ticket, runtime, ledger } = await buildStack('chain-default', [`acceptance: ${JSON.stringify('sleep 1.5')}`])
    try {
      await runtime.engine.tick()
      expect(ledger.queryEvents({ issue: ticket }).some((e) => e.event === 'DISPATCH')).toBe(true)
      await runtime.engine.tick()
      const gatePass = ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'GATE_PASS')
      expect(gatePass).toBeDefined()
      expect(gatePass?.note ?? '').toContain('四要件齐')
      expect(ledger.listWorkRecords({ issue: ticket })[0]?.status).toBe('done')
    } finally {
      await runtime.stop()
    }
  })

  it('装配源锚：runtime 单值双消费（收割闸门+合并跑门禁同取 config.acceptanceTimeoutMs，不双源）', () => {
    const runtimeSrc = readFileSync(fileURLToPath(new URL('../../../src/assembly/serve/runtime.ts', import.meta.url)), 'utf8')
    // 两处消费同读 config.acceptanceTimeoutMs（收割闸门+合并跑门禁）——少一处=透传断链
    const hits = runtimeSrc.match(/timeoutMs: config\.acceptanceTimeoutMs/g) ?? []
    expect(hits.length).toBe(2)
    // 启动日志值面单源：run.ts 兜底常量=gate.ts 真源（不在日志处复制 60_000）
    const runSrc = readFileSync(fileURLToPath(new URL('../../../src/assembly/serve/run.ts', import.meta.url)), 'utf8')
    expect(runSrc).toContain('[serve] 验收闸门超时=${config.acceptanceTimeoutMs ?? ACCEPTANCE_GATE_TIMEOUT_MS}ms（来源=${config.acceptanceTimeoutMs !== undefined ? \'daemon.yaml\' : \'缺省\'}）')
    expect(runSrc).toContain("import { ACCEPTANCE_GATE_TIMEOUT_MS } from '../../engine/gate.ts'")
  })
})

describe('启动日志：runServe 真跑主循环的核对行（task-138 交付面）', () => {
  it('配置键在场 → 来源=daemon.yaml（fake 栈冒烟＋控制面停机）', { timeout: 60_000 }, async () => {
    const root = newRoot('log-configured')
    const configPath = path.join(root, 'daemon.yaml')
    writeFileSync(
      configPath,
      [
        `db: ${JSON.stringify(path.join(root, 'var', 'ledger.sqlite'))}`,
        'platform: fake',
        'company: demo',
        `rootDir: ${JSON.stringify(path.join(root, 'var'))}`,
        'tickMs: 25',
        `acceptance: ${JSON.stringify('test -s REPORT.md')}`,
        'acceptanceTimeoutMs: 300000',
      ].join('\n'),
      'utf8',
    )
    writeStopRequest(path.join(root, 'var'), { id: 'at-log-1', requestedAt: Date.now(), reason: 'task-138 启动日志核对' })
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
      logs.push(args.map((arg) => String(arg)).join(' '))
    })
    try {
      await runServe(configPath, { apiStart: false })
    } finally {
      spy.mockRestore()
    }
    expect(logs.join('\n')).toContain('[serve] 验收闸门超时=300000ms（来源=daemon.yaml）')
  })

  it('缺省不写 → 来源=缺省且值=60000', { timeout: 60_000 }, async () => {
    const root = newRoot('log-default')
    const configPath = path.join(root, 'daemon.yaml')
    writeFileSync(
      configPath,
      [
        `db: ${JSON.stringify(path.join(root, 'var', 'ledger.sqlite'))}`,
        'platform: fake',
        'company: demo',
        `rootDir: ${JSON.stringify(path.join(root, 'var'))}`,
        'tickMs: 25',
        `acceptance: ${JSON.stringify('test -s REPORT.md')}`,
      ].join('\n'),
      'utf8',
    )
    writeStopRequest(path.join(root, 'var'), { id: 'at-log-2', requestedAt: Date.now(), reason: 'task-138 启动日志核对' })
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
      logs.push(args.map((arg) => String(arg)).join(' '))
    })
    try {
      await runServe(configPath, { apiStart: false })
    } finally {
      spy.mockRestore()
    }
    expect(logs.join('\n')).toContain('[serve] 验收闸门超时=60000ms（来源=缺省）')
  })
})
