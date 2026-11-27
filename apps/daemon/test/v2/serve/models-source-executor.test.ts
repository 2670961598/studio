/**
 * task-141：models.yaml sources[].executor 登记校验 V2 套件（serve 启动 + 热切共用判据）
 *
 * 依据：docs/quality/model-routing.md §10（未登记名拒启／热切拒绝并保留旧配置）。
 * 判据唯一源=engine/routing/source-executor.ts `sourceExecutorIssues`（启动 executor-face 与
 * 热切 models-hot-swap 同引，不双源漂移）。
 *
 * 改前必红：task-141 前 sources[].executor 既不被 schema 接受、也无人比对注册表——未登记名
 * 可静默进配置，直到派发才以 adapter 解析失败炸。接线后（本文件断言）：
 *   ① 启动：未登记 executor → CONFIG_INVALID `models/source-executor-unknown`（列档位/源/已登记名）；
 *   ② 启动：已登记 executor 放行且源计划原样进引擎面；无 executor 配置零漂移；
 *   ③ 热切：未登记 executor → kind='invalid'、不 apply、旧 overlay 字节不动、ESCALATE 留痕；
 *      拒绝不锁死——随后改为已登记名照常应用（新 sources 计划携 executor）；
 *   ④ 未注入 registry（测试直连缝）=校验面关；serve 装配恒注入（runtime.ts）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import { wireExecutorFace } from '../../../src/assembly/serve/executor-face.ts'
import { createModelsHotSwap, type ModelsHotSwapApplyInput } from '../../../src/assembly/serve/models-hot-swap.ts'
import { createFakeAdapter } from '../../../src/engine/fakes.ts'
import type { SourceRegistryFace } from '../../../src/engine/routing/source-executor.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-serve-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const MODELS_LEGACY = `tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1111, outputPerM: 0.3889}}
roles: {main_worker: mid, verifier: high, patrol: low}
`
/** high 档改多源：a 携 executor=<EXEC>、b 缺省（同档混用） */
const SOURCES_HIGH = `  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, executor: EXEC}
      - {id: b, provider: glm, model: GLM-5.3, priority: 20, price: {inputPerM: 1, outputPerM: 2}}
`
const withSources = (executor: string): string => MODELS_LEGACY.replace('  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}\n', SOURCES_HIGH).replace('executor: EXEC', `executor: ${executor}`)

const AGENT_YAML = ['executors:', '  dsh:', '    default: true', '  dsh-mid: {}', '  dsh-high: {}', '  dsh-low: {}'].join('\n')

function faceOf(label: string, yaml: string, withAgentYaml: boolean): { face: ReturnType<typeof wireExecutorFace>; close(): void } {
  const root = path.join(ROOT, label)
  mkdirSync(root, { recursive: true })
  const modelsPath = path.join(root, 'models.yaml')
  writeFileSync(modelsPath, yaml, 'utf8')
  const db = path.join(root, 'ledger.sqlite')
  const lines = [`db: ${db}`, 'platform: localfile', `platformDir: ${path.join(root, 'platform')}`, 'company: demo', `rootDir: ${path.join(root, 'var')}`, `models: ${modelsPath}`]
  if (withAgentYaml) {
    const agentYaml = path.join(root, 'agent.yaml')
    writeFileSync(agentYaml, `${AGENT_YAML}\n`, 'utf8')
    lines.push(`agentYaml: ${agentYaml}`)
  }
  const config = parseDaemonConfig(lines.join('\n'))
  const ledger = openLedger(db)
  try {
    return { face: wireExecutorFace(config, { ledger, clock: () => 1_000, log: () => {} }), close: () => ledger.close() }
  } catch (err) {
    ledger.close()
    throw err
  }
}

function invalidOf(label: string, yaml: string, withAgentYaml: boolean): Error & ClassifiedError {
  try {
    const wired = faceOf(label, yaml, withAgentYaml)
    wired.close()
  } catch (err) {
    return err as Error & ClassifiedError
  }
  throw new Error(`${label}: 预期拒启，实际放行`)
}

describe('task-141 启动校验（serve executor-face：sources[].executor 须在注册表登记）', () => {
  it('agent.yaml 只登记 dsh 四位 + sources[].executor=agy → 拒启 CONFIG_INVALID models/source-executor-unknown（列档位/源/已登记名）', () => {
    const err = invalidOf('startup-unknown', withSources('agy'), true)
    expect(err.category).toBe('CONFIG_INVALID')
    expect(err.subcause).toBe('models/source-executor-unknown')
    expect(err.message).toContain('models.yaml sources[].executor 未登记（task-141）：high/sources[a].executor=agy 未登记（已登记：dsh、dsh-mid、dsh-high、dsh-low）')
  })

  it('无 agent.yaml=注册表仅 fake 位：executor=fake 放行且源计划原样进引擎面；executor=agy 拒（已登记：fake）', () => {
    const ok = faceOf('startup-fake', withSources('fake'), false)
    try {
      expect(ok.face.modelSources?.high?.map((s) => s.executor)).toEqual(['fake', undefined])
      expect('executor' in (ok.face.modelSources?.high?.[1] ?? {})).toBe(false)
    } finally {
      ok.close()
    }
    const err = invalidOf('startup-fake-unknown', withSources('agy'), false)
    expect(err.subcause).toBe('models/source-executor-unknown')
    expect(err.message).toContain('executor=agy 未登记（已登记：fake）')
  })

  it('无 executor 配置零漂移：旧单源/多源 models.yaml 启动照常（校验面零问题）', () => {
    const ok = faceOf('startup-legacy', withSources('dsh').replace(', executor: dsh', ''), true)
    try {
      expect(ok.face.modelSources?.high?.map((s) => s.id)).toEqual(['a', 'b'])
      expect(ok.face.modelSources?.high?.every((s) => s.executor === undefined)).toBe(true)
    } finally {
      ok.close()
    }
  })
})

interface HotFixture {
  readonly modelsPath: string
  readonly overlay: string
  readonly ledger: ReturnType<typeof openLedger>
  readonly applies: ModelsHotSwapApplyInput[]
  readonly logs: string[]
  readonly hot: ReturnType<typeof createModelsHotSwap>
  setNow(n: number): void
  close(): void
}
let seq = 0
function hotFixture(name: string, registry?: SourceRegistryFace): HotFixture {
  const dir = path.join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  const modelsPath = path.join(dir, 'models.yaml')
  writeFileSync(modelsPath, MODELS_LEGACY, 'utf8')
  const rootDir = path.join(dir, 'var')
  const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
  const applies: ModelsHotSwapApplyInput[] = []
  const logs: string[] = []
  let now = 1_000
  const hot = createModelsHotSwap({
    modelsPath,
    rootDir,
    company: 'demo-hot',
    deptFallback: 'departments/工程部',
    ledger,
    clock: () => now,
    makeId: (ts) => makeUlid(ts + ++seq),
    log: (line) => logs.push(line),
    apply: (input) => { applies.push(input) },
    ...(registry !== undefined ? { registry } : {}),
  })
  return {
    modelsPath,
    overlay: path.join(rootDir, 'tmp', 'dsh-tier-mid.yml'),
    ledger,
    applies,
    logs,
    hot,
    setNow: (n) => { now = n },
    close: () => { hot.close(); ledger.close() },
  }
}
const registryOf = (...names: string[]): SourceRegistryFace => ({
  list: () => names.map((name) => ({ name })),
  resolve: (name) => createFakeAdapter({ name }),
})

describe('task-141 热切校验（models-hot-swap：先校验后落盘，拒绝=保持旧配置）', () => {
  it('未登记 executor → kind=invalid、不 apply、旧 overlay 字节不动、ESCALATE 留痕；随后改已登记名照常应用', async () => {
    const fx = hotFixture('hot-unknown', registryOf('dsh'))
    try {
      expect(await fx.hot.check()).toBeNull() // 基线
      expect(existsSync(fx.overlay)).toBe(false)
      // 先合法热切一次：旧配置=有 overlay 的 B 态
      writeFileSync(fx.modelsPath, MODELS_LEGACY.replaceAll('GLM-5.3,', 'GLM-5.3-B,'), 'utf8') // 全档改模型名（mid overlay 反映 tiers.mid）
      await fx.hot.check()
      fx.setNow(2_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      const before = readFileSync(fx.overlay, 'utf8')
      expect(before).toContain('model: GLM-5.3-B')

      writeFileSync(fx.modelsPath, withSources('agy').replaceAll('GLM-5.3,', 'GLM-5.3-C,'), 'utf8')
      expect(await fx.hot.check()).toBeNull() // 首见=去抖等待
      fx.setNow(3_500)
      const report = await fx.hot.check()
      expect(report?.kind).toBe('invalid')
      expect(report?.detail).toContain('high/sources[a].executor=agy 未登记（已登记：dsh）')
      expect(fx.applies).toHaveLength(1) // 不调用 apply
      expect(readFileSync(fx.overlay, 'utf8')).toBe(before) // 旧 overlay 不动（保持旧配置）
      const esc = fx.ledger.queryEvents({ company: 'demo-hot' }).filter((e) => e.event === 'ESCALATE' && (e.note ?? '').includes('sources[].executor 未登记'))
      expect(esc).toHaveLength(1)
      expect(esc[0]?.note).toContain('MODELS_RELOAD_INVALID：models.yaml sources[].executor 未登记，保持旧配置：high/sources[a].executor=agy 未登记（已登记：dsh）')
      expect(fx.logs.some((line) => line.includes('[models-hot-swap] 热切拒绝（保持旧配置）'))).toBe(true)

      // 拒绝不锁死：改为已登记 executor=dsh → 下次热切照常应用，新 sources 计划携 executor
      writeFileSync(fx.modelsPath, withSources('dsh').replaceAll('GLM-5.3,', 'GLM-5.3-D,'), 'utf8')
      await fx.hot.check()
      fx.setNow(5_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      expect(fx.applies).toHaveLength(2)
      expect(fx.applies[1]?.sources?.high?.map((s) => s.executor)).toEqual(['dsh', undefined])
      expect(readFileSync(fx.overlay, 'utf8')).toContain('model: GLM-5.3-D')
    } finally {
      fx.close()
    }
  })

  it('未注入 registry（测试直连缝）=校验面关：未登记 executor 不在热切面拒；派发面 adapterForSource 仍兜底', async () => {
    const fx = hotFixture('hot-no-registry')
    try {
      writeFileSync(fx.modelsPath, withSources('agy'), 'utf8')
      await fx.hot.check()
      fx.setNow(2_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      expect(fx.applies[0]?.sources?.high?.map((s) => s.executor)).toEqual(['agy', undefined])
    } finally {
      fx.close()
    }
  })
})
