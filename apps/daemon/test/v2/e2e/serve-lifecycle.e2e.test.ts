/**
 * serve 装配/启动/停机 e2e —— MIG-06 / IMPL-06-05「serve 拆分·config/runtime/run」
 *
 * 依据（实现单引用）：
 *   - plan/05 IMPL-06-05 冻结验收：`bun run test:v2 -- apps/daemon/test/v2/e2e` 绿；
 *     serve 拆 config/runtime/run 后**行为/错误码/事件序不变**（薄壳只留公共导出/转发）；
 *   - docs/v2/16 §三 daemon 行（DISP-02：serve 拆三件，facade 不增散件）与 plan/02 §五-1
 *     「唯一主写」（拆后产物由 runtime/run 消费，测试面钉装配序）；
 *   - docs/17-§2（主循环七相位）、docs/38-§2／§4 R-B（优雅停与在途接管）、docs/41-§2
 *     （控制面停机通道：请求→拍边界消费→回执；DEV-41 kv 去重位）。
 *
 * 栈形态：**fake 栈零外部依赖**——`platform: fake` ＋内置 fake adapter ＋ demo 快照；
 * 不跑真 LLM、不打网络、不写真实用户目录（临时根 mkdtemp，结束整根删除）。
 *
 * 分层（v2/17 §一）：
 *   ① 装配冒烟：buildServeRuntime 直装（配置面→运行栈→启动源→一拍→统一停机面）；
 *   ② 启动/停机冒烟：runServe 真跑进程内主循环，经控制面停机请求收口，断言 ServeResult
 *      形状、停机回执、请求消费（live→.consume）、daemon_kv 去重位、信号监听器复原；
 *   ③ 拒启面：注入缺失/必配键缺失＝CONFIG_INVALID 明报（fail-closed，不静默空转）。
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { openLedger } from '@studio-next/store'
import {
  buildServeRuntime,
  DEMO_SNAPSHOT,
  parseDaemonConfig,
  runServe,
} from '../../../src/assembly/serve.ts'
import {
  awaitStopResult,
  STOP_LAST_SEEN_KV_KEY,
  STOP_REQUEST_CONSUMED_FILE,
  STOP_REQUEST_FILE,
  writeStopRequest,
} from '../../../src/control/stop-channel.ts'

/** 临时根（afterAll 整根删除；失败也不留在磁盘） */
const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'sn-serve-e2e-'))
  roots.push(root)
  return root
}

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.length = 0
})

/** 扁平 daemon.yaml（路径标量 JSON.stringify 引号壳——与 CLI 骨架同纪律） */
function daemonYaml(root: string, extra: readonly string[] = []): string {
  const q = (s: string): string => JSON.stringify(s)
  return [
    '# serve e2e 配置（fake 栈；零外部依赖）',
    `db: ${q(path.join(root, 'var', 'ledger.sqlite'))}`,
    'platform: fake',
    'company: demo',
    `rootDir: ${q(path.join(root, 'var'))}`,
    'tickMs: 25',
    ...extra,
    '',
  ].join('\n')
}

function varDir(root: string): string {
  return path.join(root, 'var')
}

describe('serve 装配冒烟（config/runtime 拆后直装，fake 栈）', () => {
  it('buildServeRuntime：配置→运行栈→唤起源→一拍→统一停机面（停源/关台账）全链', async () => {
    const root = await makeRoot()
    await mkdir(varDir(root), { recursive: true })
    const config = parseDaemonConfig(daemonYaml(root, ['jobs: true']))
    expect(config.platform).toBe('fake')
    expect(config.jobs).toBe(true)
    expect(config.tickMs).toBe(25)

    const logs: string[] = []
    const ledger = openLedger(path.resolve(config.db))
    try {
      const runtime = buildServeRuntime(config, ledger, DEMO_SNAPSHOT, {
        log: (line: string): void => {
          logs.push(line)
        },
        clock: (): number => 1_700_000_000_000,
      })

      // 运行栈形状：engine＋scheduler＋源注册表＋自检汇报＋停机函数（ServeRuntime 契约）
      expect(runtime.engine).toBeDefined()
      expect(runtime.scheduler).not.toBeNull()
      expect(runtime.sources.list().map((entry) => entry.source.name)).toContain('scheduler')
      expect(runtime.evolveSelfCheck.skipped).toBe('empty-ledger')
      expect(typeof runtime.stop).toBe('function')
      // 装配序证据：executor/工作区树/源注册表日志均在（拆后由 runtime 装配面产出）
      expect(logs.join('\n')).toContain('.AIWS 员工工作区树')
      expect(logs.join('\n')).toContain('唤起源注册表')
      expect(existsSync(path.join(varDir(root), '.AIWS'))).toBe(true)

      // 启动：源注册表 startAll → emit 统一进 engine.ingest（源零直驱），再跑一拍
      const ingested: string[] = []
      runtime.sources.startAll((intent) => {
        ingested.push(intent.kind)
        runtime.engine.ingest([intent])
      })
      const report = await runtime.engine.tick()
      expect(report.seq).toBeGreaterThanOrEqual(1)
      expect(report.errors).toEqual([])
      expect(Array.isArray(report.events)).toBe(true)

      // 停机：先停源（不再进新意图）→ 在途 drain（engine.dispose）→ 关台账
      await runtime.stop()
      expect(() => ledger.version()).toThrow()
    } finally {
      // 装配失败面兜底关库（已关则 swallow——e2e 只清临时根，不掩盖断言失败）
      try {
        ledger.close()
      } catch {
        /* already closed */
      }
    }
  })

  it('注入/必配缺失＝CONFIG_INVALID 拒启（matrix/fileWatch 开而未给面；不静默空转）', async () => {
    const root = await makeRoot()
    await mkdir(varDir(root), { recursive: true })

    const matrixCfg = parseDaemonConfig(
      daemonYaml(root, ['matrix: true', 'matrixHomeserverUrl: http://127.0.0.1:8008', 'matrixUserId: "@demo-bot:localhost"']),
    )
    const matrixLedger = openLedger(path.resolve(matrixCfg.db))
    try {
      expect(() => buildServeRuntime(matrixCfg, matrixLedger, DEMO_SNAPSHOT, { log: () => {} })).toThrow(
        /CONFIG_INVALID：matrix: true 需注入 matrix 源工厂/,
      )
    } finally {
      matrixLedger.close()
    }

    const watchCfg = parseDaemonConfig(daemonYaml(root, ['fileWatch: true']))
    const watchLedger = openLedger(path.resolve(watchCfg.db))
    try {
      expect(() => buildServeRuntime(watchCfg, watchLedger, DEMO_SNAPSHOT, { log: () => {} })).toThrow(
        /CONFIG_INVALID：fileWatch: true 需配 fileWatchPath/,
      )
    } finally {
      watchLedger.close()
    }
  })

  it('配置面未知键/坏平台值＝启动拒（parse 面 fail-closed，错误消息不漂移）', () => {
    expect(() => parseDaemonConfig('platform: fake\ncompany: demo\nunknownKey: 1\n')).toThrow(/未知配置键 unknownKey/)
    expect(() => parseDaemonConfig('platform: nope\n')).toThrow(/platform 须为 localfile\|taiga\|fake/)
  })
})

describe('serve 启动/停机冒烟（runServe 真主循环＋控制面停机通道）', () => {
  it('runServe：启动→一拍→控制面停机→优雅停收口→ServeResult/回执/去重位/监听器全对', async () => {
    const root = await makeRoot()
    await mkdir(varDir(root), { recursive: true })
    const configPath = path.join(root, 'daemon.yaml')
    await writeFile(configPath, daemonYaml(root), 'utf8')

    const requestId = 'e2e-stop-1'
    writeStopRequest(varDir(root), { id: requestId, requestedAt: Date.now(), reason: 'e2e smoke' })

    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
      logs.push(args.map((arg) => String(arg)).join(' '))
    })
    const sigintBefore = process.listenerCount('SIGINT')
    const sigtermBefore = process.listenerCount('SIGTERM')
    let result: Awaited<ReturnType<typeof runServe>>
    try {
      result = await runServe(configPath)
    } finally {
      logSpy.mockRestore()
    }

    // ServeResult：控制面停机（非 error），至少一拍
    expect(result.stopReason).toBe('stop-request')
    expect(result.ticks).toBeGreaterThanOrEqual(1)
    expect('lastError' in result).toBe(false)
    expect(logs.join('\n')).toContain('studio-next daemon 启动')
    expect(logs.join('\n')).toContain('控制面停机请求')
    expect(logs.join('\n')).toContain('已优雅关闭')
    // 主循环信号监听器复原（生命周期编排不泄漏进程面）
    expect(process.listenerCount('SIGINT')).toBe(sigintBefore)
    expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore)

    // 停机回执：CLI 按 id 匹配（收口后才落——detail 携 ticks 证据）
    const ack = await awaitStopResult(varDir(root), requestId, 2000)
    expect(ack).toBeDefined()
    expect(ack?.ok).toBe(true)
    expect(ack?.stopped).toBe(true)
    expect(ack?.detail).toContain(`ticks=${result.ticks}`)

    // 请求消费语义（DEV-41）：live 面清空、.consume 留档；去重位已落 daemon_kv 跨重启
    const controlDir = path.join(varDir(root), 'control')
    expect(existsSync(path.join(controlDir, STOP_REQUEST_FILE))).toBe(false)
    expect(existsSync(path.join(controlDir, STOP_REQUEST_CONSUMED_FILE))).toBe(true)
    const reopened = openLedger(path.join(varDir(root), 'ledger.sqlite'))
    try {
      expect(reopened.kvGet(STOP_LAST_SEEN_KV_KEY)).toBe(requestId)
    } finally {
      reopened.close()
    }
    // 台账文件真实落盘（关库后可重新打开）
    expect(existsSync(path.join(varDir(root), 'ledger.sqlite'))).toBe(true)

    // 回执文件内容可被 CLI 解析（JSON 形状稳定）
    const ackRaw = await readFile(path.join(controlDir, 'stop.result.json'), 'utf8')
    const parsed = JSON.parse(ackRaw) as { id?: string; ok?: boolean; stopped?: boolean }
    expect(parsed.id).toBe(requestId)
    expect(parsed.ok).toBe(true)
    expect(parsed.stopped).toBe(true)
  })
})
