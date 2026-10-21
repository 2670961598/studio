/**
 * sources —— 唤起源注册表 + 三源接入测试（v0.8 地基，docs/22-§一/§二/§三）
 *
 * 断言面（实现单口径逐条钉死）：
 *   1. 注册表核心：register（重名/空名/manifest 名不一致 CONFIG_INVALID 拒收）、
 *      unregister（未知名 false；运行中先停再除名）、list 快照、stats 计数
 *   2. 生命周期：startAll（emit 统一收集器、已启动跳过、追加源补启动=源增删热更面）、
 *      stopAll 全停可重起
 *   3. 单源崩溃隔离：start/stop/emit 三相位异常捕获+计数+继续，不拖死其他源
 *      （25-§3.4.5 emit 抛错裁决的注册表侧兜底；源侧契约=源自己捕获不中断轮询）
 *   4. scheduler 源：包装现有 onDue 零改调度器——手动泵（poll）经 sink、start 后经
 *      注册表 emit，scheduleIntent 形态不变（dedupKey=job_id@firedAt）
 *   5. watch-file 源（22-§三.1 验收靶子）：基线纪律（历史不当唤起）、mtime 去抖、
 *      JSON 行产意图（dedupKey=mtime#行号）、行级隔离（坏行计数不炸）、company 配置
 *      注入（行内不收）、文件缺失 CONFIG_INVALID、干净停、真 fs.watch 事件路径
 *   6. serve 接线：matrix/fileWatch 配置解析、matrix 工厂注入（不强依赖 matrix 包）、
 *      fileWatchPath 必配、停机顺序（先 stopAll 源再 drain 再关台账）
 *   7. **验收三证（docs/22-§三，直击解耦口径）**：
 *      ① 注册 watch-file 自定义源零改主循环——真引擎只用公面（ingest/pendingIntents/
 *         tick），文件变化经注册表直达引擎 ingest 队列；
 *      ② 100 重复意图（同 dedupKey）只唤起一次（复用 engine ingest 幂等面），异键不殃及；
 *      ③ unregister 任一源，其他源与主循环零影响（fake 双源核心面 + 真实双源面）。
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, InvokeIntent, InvokeSource, SourceManifest } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { scheduleIntent } from '../../src/engine/scheduler.ts'
import {
  createFileWatchSource,
  createSchedulerSource,
  createSourceRegistry,
  FILE_WATCH_SOURCE_NAME,
  FILE_WATCH_MANIFEST,
  SCHEDULER_SOURCE_NAME,
  SCHEDULER_SOURCE_MANIFEST,
} from '../../src/engine/sources.ts'
import { buildServeRuntime, DEMO_SNAPSHOT, parseDaemonConfig, type ServeConfig } from '../../src/assembly/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo, d, h, mi, s, 0).getTime()
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

function job(partial: Partial<JobRecord> & Pick<JobRecord, 'job_id'>): JobRecord {
  return {
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    next_run_at: 0,
    ...partial,
  }
}

/** 可控假源：start 记 emit / stop 清 emit；poke() 模拟源产意图（经注册表注入的 emit） */
interface FakeCtl {
  started: boolean
  startCount: number
  stopCount: number
  emit: ((intent: InvokeIntent) => void) | undefined
}

function fakeSource(
  name: string,
  throws?: { start?: Error; stop?: Error },
): { source: InvokeSource; ctl: FakeCtl } {
  const ctl: FakeCtl = { started: false, startCount: 0, stopCount: 0, emit: undefined }
  return {
    ctl,
    source: {
      name,
      start(emit): void {
        ctl.startCount += 1
        if (throws?.start !== undefined) throw throws.start
        ctl.emit = emit
        ctl.started = true
      },
      stop(): void {
        ctl.stopCount += 1
        if (throws?.stop !== undefined) throw throws.stop
        ctl.started = false
        ctl.emit = undefined
      },
    },
  }
}

/** 引擎测试栈（scheduler.test 同手法：fake 全家桶 + tmp 台账 + 假时钟） */
interface EngineStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildEngineStack(id: string, snapshot: CompanySnapshot = DEMO_SNAPSHOT): EngineStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = local(2026, 9, 16, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.8-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/22-§一（唤起源）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: snapshot.people[0]?.id ?? 'AGENT-1',
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
    },
    people: snapshot.people,
  })
  return { platform, ledger, engine, clock }
}

/** 台账栈（scheduler 源测试用：独立 tmp 库 + 假时钟） */
function openStack(id: string, start = local(2026, 9, 16, 0, 0, 0)): { ledger: Ledger; clock: { now(): number; advance(ms: number): void } } {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = start
  return { ledger, clock: { now: (): number => t, advance: (ms: number): void => { t += ms } } }
}

/** watch-file 测试文件：建文件并钉死 mtime（秒级——dedupKey 确定性断言用） */
function watchFile(id: string, content: string, mtimeSec: number): string {
  const dir = path.join(root, id)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'intents.jsonl')
  writeFileSync(file, content, 'utf8')
  utimesSync(file, mtimeSec, mtimeSec)
  return file
}

const T1 = 1_770_000_000 // 秒级锚点（mtime 钉死用；dedupKey=Sec*1000#行号）
const T2 = T1 + 60
const T3 = T2 + 60

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-sources-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 注册表：register / unregister / list —————————————————————————

describe('注册表：register / unregister / list', () => {
  it('register + list：注册序快照与 manifest 透传；stats.registered/started', () => {
    const reg = createSourceRegistry()
    const a = fakeSource('a')
    const manifest: SourceManifest = { name: 'b', kind: 'webhook', configSchema: 'test' }
    reg.register(a.source)
    reg.register(fakeSource('b').source, manifest)
    const names = reg.list().map((e) => e.source.name)
    expect(names).toEqual(['a', 'b'])
    expect(reg.list()[1]?.manifest).toEqual(manifest)
    expect(reg.stats.registered).toBe(2)
    expect(reg.stats.started).toBe(0)
    expect(reg.stats.sourceErrors).toBe(0)
  })

  it('register 重名拒收（CONFIG_INVALID，消息含源名）', () => {
    const reg = createSourceRegistry()
    reg.register(fakeSource('dup').source)
    expect(() => reg.register(fakeSource('dup').source)).toThrow(/CONFIG_INVALID.*重名.*dup/)
  })

  it('register 空 name 拒收；manifest.name 与源名不一致拒收', () => {
    const reg = createSourceRegistry()
    expect(() => reg.register(fakeSource('').source)).toThrow(/CONFIG_INVALID.*name/)
    const manifest: SourceManifest = { name: 'other', kind: 'webhook', configSchema: 'test' }
    expect(() => reg.register(fakeSource('real').source, manifest)).toThrow(/CONFIG_INVALID.*不一致/)
  })

  it('unregister：未知名返 false 不炸；已注册返 true 且除名', () => {
    const reg = createSourceRegistry()
    reg.register(fakeSource('a').source)
    expect(reg.unregister('ghost')).toBe(false)
    expect(reg.unregister('a')).toBe(true)
    expect(reg.list()).toEqual([])
    expect(reg.stats.registered).toBe(0)
  })

  it('unregister 运行中的源：先 stop 再除名（热更面——源增删先停后除）', () => {
    const reg = createSourceRegistry()
    const a = fakeSource('a')
    reg.register(a.source)
    reg.startAll(() => undefined)
    expect(a.ctl.started).toBe(true)
    expect(reg.unregister('a')).toBe(true)
    expect(a.ctl.started).toBe(false) // 先停
    expect(a.ctl.stopCount).toBe(1)
    expect(reg.stats.started).toBe(0)
  })
})

// ————————————————————————— 注册表：startAll / stopAll 与单源崩溃隔离 —————————————————————————

describe('注册表：startAll / stopAll 与单源崩溃隔离', () => {
  it('startAll：各源启动且 emit 统一进收集器；已启动源二次 startAll 跳过；stopAll 全停可重起', () => {
    const reg = createSourceRegistry()
    const a = fakeSource('a')
    const b = fakeSource('b')
    reg.register(a.source)
    reg.register(b.source)
    const got: InvokeIntent[] = []
    reg.startAll((i) => got.push(i))
    expect(a.ctl.started && b.ctl.started).toBe(true)
    expect(reg.stats.started).toBe(2)
    // 源经注册表注入的 emit 产意图——统一进收集器
    a.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'a', dedupKey: 'k1' })
    expect(got).toHaveLength(1)
    // 已启动源二次 startAll 跳过（源 start 不可重入——端口语义）
    reg.startAll((i) => got.push(i))
    expect(a.ctl.startCount).toBe(1)
    // stopAll 全停；再 startAll 重起（stop 后可再起）
    reg.stopAll()
    expect(a.ctl.started || b.ctl.started).toBe(false)
    reg.startAll((i) => got.push(i))
    expect(a.ctl.startCount).toBe(2)
    expect(reg.stats.started).toBe(2)
  })

  it('注册后追加源：下一次 startAll 补启动（22-§一「新源=新注册项」热更面）', () => {
    const reg = createSourceRegistry()
    const a = fakeSource('a')
    reg.register(a.source)
    reg.startAll(() => undefined)
    const b = fakeSource('b')
    reg.register(b.source)
    expect(b.ctl.started).toBe(false) // 追加即注册，不自动启动
    reg.startAll(() => undefined)
    expect(b.ctl.started).toBe(true) // 补启动；a 不重复启动
    expect(a.ctl.startCount).toBe(1)
    expect(b.ctl.startCount).toBe(1)
  })

  it('一个源 start 抛错：隔离计数（phase=start），其他源照常启动', () => {
    const reg = createSourceRegistry()
    const bad = fakeSource('bad', { start: new Error('启动即炸（注入）') })
    const good = fakeSource('good')
    reg.register(bad.source)
    reg.register(good.source)
    expect(() => reg.startAll(() => undefined)).not.toThrow()
    expect(good.ctl.started).toBe(true) // 坏源不拖死好源
    expect(reg.stats.started).toBe(1)
    expect(reg.stats.sourceErrors).toBe(1)
    expect(reg.stats.lastSourceError).toMatchObject({ source: 'bad', phase: 'start' })
    expect(reg.stats.lastSourceError?.message).toContain('启动即炸')
  })

  it('emit 抛错：注册表兜底吞错计数（phase=emit，25-§3.4.5），其他源照常产意图', () => {
    const reg = createSourceRegistry()
    const bad = fakeSource('bad')
    const good = fakeSource('good')
    reg.register(bad.source)
    reg.register(good.source)
    const got: InvokeIntent[] = []
    // 收集器对 bad 源的意图抛错（模拟自定义收集器缺陷）；对 good 正常收
    reg.startAll((i) => {
      if (i.source === 'bad') throw new Error('收集器炸了（注入）')
      got.push(i)
    })
    expect(() => bad.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'bad', dedupKey: 'k' })).not.toThrow()
    expect(reg.stats.sourceErrors).toBe(1)
    expect(reg.stats.lastSourceError).toMatchObject({ source: 'bad', phase: 'emit' })
    // 好源照常产意图（emit 异常不中断任何面）
    good.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'good', dedupKey: 'k' })
    expect(got).toHaveLength(1)
  })

  it('stopAll 一个源 stop 抛错：其他源照常停（phase=stop 计数）', () => {
    const reg = createSourceRegistry()
    const bad = fakeSource('bad', { stop: new Error('停机即炸（注入）') })
    const good = fakeSource('good')
    reg.register(bad.source)
    reg.register(good.source)
    reg.startAll(() => undefined)
    expect(() => reg.stopAll()).not.toThrow()
    expect(good.ctl.started).toBe(false)
    expect(good.ctl.stopCount).toBe(1)
    expect(reg.stats.sourceErrors).toBe(1)
    expect(reg.stats.lastSourceError).toMatchObject({ source: 'bad', phase: 'stop' })
    expect(reg.stats.started).toBe(0)
  })
})

// ————————————————————————— scheduler 源（包装现有 onDue，零改调度器） —————————————————————————

describe('scheduler 源：包装现有 onDue 回调为 InvokeSource', () => {
  it('形态与手动泵：name=scheduler；poll 到点 → scheduleIntent 经 sink 产出（serve 测试同面）', () => {
    const s = openStack('sched-src')
    const due = s.clock.now()
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: due }))
    const got: InvokeIntent[] = []
    const src = createSchedulerSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 1000, sink: (i) => got.push(i) })
    expect(src.name).toBe(SCHEDULER_SOURCE_NAME)
    const report = src.scheduler.poll() // 手动泵不经 start(emit)——意图走 sink
    expect(report.fired).toBe(1)
    expect(got).toEqual([scheduleIntent(s.ledger.getJob('j1') as JobRecord, due)])
    expect(got[0]).toMatchObject({
      kind: 'schedule',
      company: 'demo',
      payload: { job_id: 'j1' },
      source: 'scheduler',
      dedupKey: `j1@${due}`,
      priority: 2,
    })
    s.ledger.close()
  })

  it('start(emit)：调度器起、意图走注册表注入的 emit（sink 让位）；stop 停调度器', () => {
    const s = openStack('sched-live')
    const sinkGot: InvokeIntent[] = []
    const emitGot: InvokeIntent[] = []
    const src = createSchedulerSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 1000, sink: (i) => sinkGot.push(i) })
    src.start((i) => emitGot.push(i))
    expect(src.scheduler.running).toBe(true)
    // start 后才 due 的岗（j1 预置但不 due——只验注入 emit 面）
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() + 3_600_000 }))
    s.clock.advance(1)
    s.ledger.upsertJob(job({ job_id: 'j2', next_run_at: s.clock.now() }))
    src.scheduler.poll()
    expect(emitGot).toHaveLength(1) // start 后意图走注入 emit
    expect(emitGot[0]).toMatchObject({ payload: { job_id: 'j2' }, source: 'scheduler' })
    expect(sinkGot).toHaveLength(0)
    src.stop()
    expect(src.scheduler.running).toBe(false)
    s.ledger.close()
  })
})

// ————————————————————————— watch-file 源（22-§三.1 验收靶子） —————————————————————————

describe('watch-file 源：基线 / 去抖 / 行级隔离 / 干净停', () => {
  it('start 基线：启动时已有内容不产意图（历史不当唤起——对齐 matrix 首拉基线）', () => {
    const file = watchFile('fw-baseline', '{"payload":{"old":1}}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    const got: InvokeIntent[] = []
    src.start((i) => got.push(i))
    expect(got).toEqual([]) // 基线只记录 mtime，不唤起
    src.stop()
  })

  it('start 时文件不存在：CONFIG_INVALID 明报（监听面=变化非出现）', () => {
    const src = createFileWatchSource({ company: 'demo', file: path.join(root, 'no-such-file.jsonl') })
    expect(() => src.start(() => undefined)).toThrow(/CONFIG_INVALID.*不存在/)
  })

  it('check 手动泵：mtime 前进 → JSON 行各产一条 webhook 意图（dedupKey=mtime#非空行号）', () => {
    const file = watchFile('fw-pump', '{"payload":{"n":1}}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    const got: InvokeIntent[] = []
    src.start(() => undefined)
    writeFileSync(file, '{"payload":{"n":1}}\n{"payload":{"n":2},"priority":5}\n', 'utf8')
    utimesSync(file, T2, T2)
    const produced = src.check((i) => got.push(i))
    expect(produced).toBe(2)
    expect(got[0]).toMatchObject({ kind: 'webhook', company: 'demo', source: FILE_WATCH_SOURCE_NAME, payload: { n: 1 } })
    expect(got[0]?.dedupKey).toBe(`${T2 * 1000}#0`)
    expect(got[1]).toMatchObject({ payload: { n: 2 }, priority: 5 })
    expect(got[1]?.dedupKey).toBe(`${T2 * 1000}#1`)
    src.stop()
  })

  it('去抖与 at-least-once：mtime 未变产 0；mtime 离开再回 → 同 dedupKey 重投（幂等归引擎）', () => {
    const file = watchFile('fw-dedup', '{"payload":{"n":1}}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    const got: InvokeIntent[] = []
    src.start(() => undefined)
    writeFileSync(file, '{"payload":{"n":9}}\n', 'utf8')
    utimesSync(file, T2, T2)
    expect(src.check((i) => got.push(i))).toBe(1)
    expect(src.check((i) => got.push(i))).toBe(0) // mtime 未变：去抖
    // 正向推进：新 mtime 新键
    writeFileSync(file, '{"payload":{"n":9}}\n', 'utf8')
    utimesSync(file, T3, T3)
    expect(src.check((i) => got.push(i))).toBe(1)
    expect(got[1]?.dedupKey).toBe(`${T3 * 1000}#0`)
    // mtime 离开再回 T2（源重投面）：同键再产一条——重复消费去重归引擎幂等键（22-§三.2）
    writeFileSync(file, '{"payload":{"n":9}}\n', 'utf8')
    utimesSync(file, T2, T2)
    expect(src.check((i) => got.push(i))).toBe(1)
    expect(got[2]?.dedupKey).toBe(`${T2 * 1000}#0`)
    expect(got[0]?.dedupKey).toBe(`${T2 * 1000}#0`) // 同键重投（at-least-once 源面）
    src.stop()
  })

  it('行级隔离：坏行（非 JSON/数组/非法 kind/字段类型）跳过+计数，好行照常产', () => {
    const file = watchFile('fw-badlines', '[]\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    const got: InvokeIntent[] = []
    src.start(() => undefined)
    writeFileSync(
      file,
      ['not json', '{"kind":"bogus"}', '{"kind":"webhook","payload":{"ok":1}}', '[1,2]', '{"ticket":42}'].join('\n') + '\n',
      'utf8',
    )
    utimesSync(file, T2, T2)
    expect(src.check((i) => got.push(i))).toBe(1)
    expect(got[0]?.payload).toEqual({ ok: 1 })
    expect(got[0]?.dedupKey).toBe(`${T2 * 1000}#2`) // 行号=非空行序（坏行占号）
    expect(src.stats.parseErrors).toBe(4)
    expect(src.stats.emitted).toBe(1)
    src.stop()
  })

  it('company 恒为配置注入（行内 company 字段不收——一源一公司，25-§3.4 裁决 2 同精神）', () => {
    const file = watchFile('fw-company', '{"company":"evil-co","payload":1}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    const got: InvokeIntent[] = []
    src.start(() => undefined)
    writeFileSync(file, '{"company":"evil-co","payload":1}\n', 'utf8')
    utimesSync(file, T2, T2)
    src.check((i) => got.push(i))
    expect(got[0]?.company).toBe('demo')
    expect(got[0]?.kind).toBe('webhook') // 缺省 kind
    src.stop()
  })

  it('stop 后 check 返 0（干净停——在途面不再产）', () => {
    const file = watchFile('fw-stop', '{"payload":1}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file })
    src.start(() => undefined)
    src.stop()
    writeFileSync(file, '{"payload":2}\n', 'utf8')
    utimesSync(file, T2, T2)
    expect(src.check(() => undefined)).toBe(0)
  })

  it('真 fs.watch 事件路径：写文件 → 事件驱动 emit（变化到意图的实路径，非手动泵）', async () => {
    // 实测口径：macOS FSEvents 挂载期内（watch() 返回后立即写）变化丢事件——本源以
    // 启动盲窗补检兜底（graceMs 缺省 250ms，mtime 去抖幂等；见 src/engine/sources.ts 头注）。
    // 本用例故意在挂载后立即写（盲窗内），验证补检面；正常稳态事件面由补检后的常规事件覆盖。
    const file = watchFile('fw-real', '{"payload":{"live":1}}\n', T1)
    const src = createFileWatchSource({ company: 'demo', file, graceMs: 120 })
    const got: InvokeIntent[] = []
    src.start((i) => got.push(i))
    writeFileSync(file, '{"payload":{"live":2}}\n', 'utf8')
    utimesSync(file, T2, T2)
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && got.length === 0) {
      await new Promise((r) => setTimeout(r, 25))
    }
    src.stop()
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'webhook', company: 'demo', source: FILE_WATCH_SOURCE_NAME, payload: { live: 2 } })
  })
})

// ————————————————————————— serve 接线 —————————————————————————

function baseServeConfig(over: Partial<ServeConfig> = {}): ServeConfig {
  return {
    db: 'x',
    platform: 'fake',
    company: 'demo',
    rootDir: path.join(root, 'rt'),
    tickMs: 10,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 1,
    // DEV-44：本套测三源装配面非响置面——刀关（0）保持改动前告警-only 语义
    stallKillAfterAlarms: 0,
    laneTtlMs: 1,
    breakerThreshold: 3,
    autoApprove: true,
    jobs: false,
    jobPollMs: 10,
    matrix: false,
    fileWatch: false,
    ...over,
  }
}

describe('serve 接线：配置面与三源装配', () => {
  it('parseDaemonConfig：matrix/fileWatch/fileWatchPath 解析；缺省 false/无', () => {
    const base = 'db: ./x.sqlite\nplatform: fake\ncompany: demo\n'
    expect(parseDaemonConfig(base).matrix).toBe(false)
    expect(parseDaemonConfig(base).fileWatch).toBe(false)
    expect(parseDaemonConfig(base).fileWatchPath).toBeUndefined()
    // matrix 键组齐 → 开；六个键各自解析（str/num；105-刀A A-3）
    const cfg = parseDaemonConfig(
      `${base}matrix: true\n` +
        'matrixHomeserverUrl: http://127.0.0.1:18008\n' +
        'matrixUserId: @demo-bot:studio.local\n' +
        'matrixRooms: !a:lo;!b:lo\n' +
        'matrixRoles: 宰相=PRIME-0;制作人=PRODUCER-0\n' +
        'matrixPollMs: 5000\n' +
        'matrixSyncTimeoutMs: 30000\n' +
        'fileWatch: true\nfileWatchPath: /tmp/i.jsonl\n',
    )
    expect(cfg.matrix).toBe(true)
    expect(cfg.matrixHomeserverUrl).toBe('http://127.0.0.1:18008')
    expect(cfg.matrixUserId).toBe('@demo-bot:studio.local')
    expect(cfg.matrixRooms).toBe('!a:lo;!b:lo')
    expect(cfg.matrixRoles).toBe('宰相=PRIME-0;制作人=PRODUCER-0')
    expect(cfg.matrixPollMs).toBe(5000)
    expect(cfg.matrixSyncTimeoutMs).toBe(30000)
    expect(cfg.fileWatch).toBe(true)
    expect(cfg.fileWatchPath).toBe('/tmp/i.jsonl')
    // 开而缺必配键（homeserver/userId 任一）→ parse 面 fail-fast（105-刀A：同 taiga 先例）
    expect(() => parseDaemonConfig(`${base}matrix: true\n`)).toThrow(/matrix: true 缺必配键/)
    expect(() => parseDaemonConfig(`${base}matrix: true\nmatrixHomeserverUrl: http://127.0.0.1:18008\n`)).toThrow(/matrix: true 缺必配键/)
    expect(() => parseDaemonConfig(`${base}matrix: yes\n`)).toThrow(/matrix/)
  })

  it('buildServeRuntime jobs=true：注册表含 scheduler（manifest 同名）；startAll 后手动泵→engine.pendingIntents（既有面回归）；stop 先停源再关台账', async () => {
    const s = openStack('rt-jobs')
    const logs: string[] = []
    const rt = buildServeRuntime(baseServeConfig({ jobs: true, rootDir: path.join(root, 'rt-jobs-ws') }), s.ledger, DEMO_SNAPSHOT, {
      log: (l) => logs.push(l),
      clock: s.clock.now,
    })
    const entry = rt.sources.list().find((e) => e.source.name === SCHEDULER_SOURCE_NAME)
    expect(entry).toBeDefined()
    expect(entry?.manifest).toEqual(SCHEDULER_SOURCE_MANIFEST)
    // serve 同形接线：startAll 的 emit 统一进 engine.ingest
    rt.sources.startAll((intent) => rt.engine.ingest([intent]))
    expect(rt.scheduler?.running).toBe(true)
    s.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: s.clock.now() }))
    rt.scheduler?.poll() // 手动泵：sink 兜底出口（同一 ingest 队列）
    expect(rt.engine.pendingIntents).toBe(1)
    const tick = await rt.engine.tick()
    expect(tick.phases.dispatch.dispatched).toBe(1)
    await rt.stop()
    // 停机顺序：先 stopAll 源（日志可见）→ drain → 关台账（台账已关即证 dispose 已过）
    expect(logs.some((l) => l.includes('源已全停'))).toBe(true)
    expect(rt.sources.stats.started).toBe(0)
    expect(rt.scheduler?.running).toBe(false)
    expect(() => s.ledger.listJobs()).toThrow()
  })

  it('matrix: true 未注入工厂 → CONFIG_INVALID 拒启动；注入工厂 → 注册表含 matrix（端口形状对齐即接入）', async () => {
    const s1 = openStack('rt-matrix-missing')
    let sawLogs: string[] = []
    try {
      expect(() =>
        buildServeRuntime(baseServeConfig({ matrix: true, rootDir: path.join(root, 'rt-mx1') }), s1.ledger, DEMO_SNAPSHOT, {
          log: (l) => sawLogs.push(l),
        }),
      ).toThrow(/CONFIG_INVALID.*matrix 源工厂/)
    } finally {
      s1.ledger.close()
    }
    const s2 = openStack('rt-matrix-ok')
    const mentionLike = fakeSource('matrix') // start/stop 形状对齐 InvokeSource 的 mention 源同形件
    const rt = buildServeRuntime(baseServeConfig({ matrix: true, rootDir: path.join(root, 'rt-mx2') }), s2.ledger, DEMO_SNAPSHOT, {
      log: () => undefined,
      matrixSource: () => mentionLike.source,
    })
    expect(rt.sources.list().map((e) => e.source.name)).toContain('matrix')
    expect(rt.sources.list().find((e) => e.source.name === 'matrix')?.manifest?.kind).toBe('mention')
    rt.sources.startAll(() => undefined)
    expect(mentionLike.ctl.started).toBe(true)
    await rt.stop()
    expect(mentionLike.ctl.started).toBe(false)
  })

  it('fileWatch: true 未配 path → CONFIG_INVALID；配 path → 注册表含 watch-file（注册即生效面）', async () => {
    const s1 = openStack('rt-fw-missing')
    try {
      expect(() =>
        buildServeRuntime(baseServeConfig({ fileWatch: true, rootDir: path.join(root, 'rt-fw1') }), s1.ledger, DEMO_SNAPSHOT, {
          log: () => undefined,
        }),
      ).toThrow(/CONFIG_INVALID.*fileWatchPath/)
    } finally {
      s1.ledger.close()
    }
    const s2 = openStack('rt-fw-ok')
    const file = watchFile('rt-fw-file', '{"payload":1}\n', T1)
    const rt = buildServeRuntime(
      baseServeConfig({ fileWatch: true, fileWatchPath: file, rootDir: path.join(root, 'rt-fw2') }),
      s2.ledger,
      DEMO_SNAPSHOT,
      { log: () => undefined },
    )
    const entry = rt.sources.list().find((e) => e.source.name === FILE_WATCH_SOURCE_NAME)
    expect(entry).toBeDefined()
    expect(entry?.manifest).toEqual(FILE_WATCH_MANIFEST)
    await rt.stop()
  })
})

// ————————————————————————— 验收三证（docs/22-§三，直击解耦口径） —————————————————————————

describe('验收三证（docs/22-§三：解耦验收口径）', () => {
  it('证① 注册自定义源零改主循环：真引擎公面 + 注册表 + watch-file——文件变化经注册表直达 engine.ingest 队列', async () => {
    // 证明方式（实现单口径）：全程只用 Engine 公面（ingest/pendingIntents/tick）与注册表——
    // 不 import、不触碰 engine 内部状态；engine.ts 本刀零改（git diff 为证）。
    const stack = buildEngineStack('acc1')
    const file = watchFile('acc1-watch', '{"payload":{"n":0}}\n', T1)
    const reg = createSourceRegistry()
    reg.register(createFileWatchSource({ company: 'demo', file }), FILE_WATCH_MANIFEST)
    reg.startAll((intent) => stack.engine.ingest([intent])) // serve 同形接线：emit 统一进 ingest
    // 文件变化（真 fs.watch 事件路径）→ 意图达引擎 ingest 队列
    writeFileSync(file, '{"payload":{"n":1}}\n', 'utf8')
    utimesSync(file, T2, T2)
    const deadline = Date.now() + 3000
    while (Date.now() < deadline && stack.engine.pendingIntents === 0) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(stack.engine.pendingIntents).toBe(1)
    // 消费面（既有路径，零改）：v0.4 意图消费门只物化 schedule——webhook 明报不支持
    // （六源全通归 v0.8 后续刀），错误如实入报告、队列清空、不派发
    const report = await stack.engine.tick()
    expect(report.errors.join('\n')).toContain("kind='webhook' 不支持")
    expect(stack.engine.pendingIntents).toBe(0)
    expect(eventsOf(stack.ledger, 'DISPATCH')).toHaveLength(0)
    reg.stopAll()
    stack.ledger.close()
  })

  it('证② 100 重复意图（同 dedupKey）→ 引擎派发恰 1（复用 ingest 幂等面）；异键不殃及', async () => {
    // 场景一：100 条同键 schedule 意图经注册表 emit 投递 → 一拍内只物化/派发一次
    const s1 = buildEngineStack('acc2-dup')
    s1.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: 1 }))
    const firedAt = s1.clock.now()
    const dup: InvokeIntent = scheduleIntent(s1.ledger.getJob('health-patrol') as JobRecord, firedAt)
    const burst1: InvokeSource = {
      name: 'burst-dup',
      start: (emit): void => {
        for (let i = 0; i < 100; i += 1) emit(dup)
      },
      stop: (): void => undefined,
    }
    const reg1 = createSourceRegistry()
    reg1.register(burst1)
    reg1.startAll((intent) => s1.engine.ingest([intent]))
    expect(s1.engine.pendingIntents).toBe(100)
    const t1 = await s1.engine.tick()
    expect(t1.errors).toEqual([])
    expect(eventsOf(s1.ledger, 'PATROL')).toHaveLength(1) // 只物化一次
    expect(eventsOf(s1.ledger, 'DISPATCH')).toHaveLength(1) // 只唤起一次（22-§三.2）
    s1.ledger.close()

    // 场景二（异键不殃及——去重不扩大化）：99 同键先行，走完收割链（同泳道串行——
    // demo 快照单泳道，第二张岗单据须等首张 CLOSE 释放泳道，docs/18-§三 泳道闸既有语义）；
    // 之后追加注册 late 源投 1 条异键意图（注册表热更面）→ 第二次物化+派发照常发生。
    const s2 = buildEngineStack('acc2-mix')
    s2.ledger.upsertJob(job({ job_id: 'health-patrol', next_run_at: 1 }))
    const base = scheduleIntent(s2.ledger.getJob('health-patrol') as JobRecord, s2.clock.now())
    const reg2 = createSourceRegistry()
    const burst99: InvokeSource = {
      name: 'burst-99',
      start: (emit): void => {
        for (let i = 0; i < 99; i += 1) emit(base)
      },
      stop: (): void => undefined,
    }
    reg2.register(burst99)
    reg2.startAll((intent) => s2.engine.ingest([intent]))
    const first = await s2.engine.tick()
    expect(first.errors).toEqual([])
    expect(eventsOf(s2.ledger, 'PATROL')).toHaveLength(1) // 99 同键只物化一张
    expect(eventsOf(s2.ledger, 'DISPATCH')).toHaveLength(1)
    // 走完首张岗单据收割链（GATE_PASS → QA_PASS → MERGE → CLOSE——泳道释放）
    for (let i = 0; i < 4; i += 1) {
      s2.clock.advance(1000)
      await s2.engine.tick()
    }
    expect(eventsOf(s2.ledger, 'CLOSE')).toHaveLength(1)
    // 追加注册 late 源（热更面）：投 1 条异键意图（dedupKey=firedAt 不同——另一次触发）
    const later = scheduleIntent(s2.ledger.getJob('health-patrol') as JobRecord, s2.clock.now())
    const lateSource: InvokeSource = {
      name: 'late-single',
      start: (emit): void => {
        emit(later)
      },
      stop: (): void => undefined,
    }
    reg2.register(lateSource)
    reg2.startAll((intent) => s2.engine.ingest([intent]))
    const second = await s2.engine.tick()
    expect(second.errors).toEqual([])
    expect(eventsOf(s2.ledger, 'PATROL')).toHaveLength(2) // 异键=另一意图，不殃及
    expect(eventsOf(s2.ledger, 'DISPATCH')).toHaveLength(2)
    s2.ledger.close()
  })

  it('证③（核心面）unregister 任一源：其余源经注册表 emit 照常产意图（关掉=零影响）', () => {
    const reg = createSourceRegistry()
    const a = fakeSource('source-a')
    const b = fakeSource('source-b')
    reg.register(a.source)
    reg.register(b.source)
    const got: InvokeIntent[] = []
    reg.startAll((i) => got.push(i))
    a.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'source-a', dedupKey: 'a1' })
    b.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'source-b', dedupKey: 'b1' })
    expect(got).toHaveLength(2)
    // 关掉 a：a 停（emit 让位），b 照常产
    reg.unregister('source-a')
    expect(a.ctl.emit).toBeUndefined()
    b.ctl.emit?.({ kind: 'webhook', company: 'demo', source: 'source-b', dedupKey: 'b2' })
    expect(got).toHaveLength(3)
    expect(got[2]?.source).toBe('source-b')
    expect(reg.stats.started).toBe(1)
    expect(reg.stats.sourceErrors).toBe(0)
  })

  it('证③（真实双源）scheduler + watch-file 并行：注销其一，另一个照常产意图', () => {
    const s = openStack('acc3-real')
    s.ledger.upsertJob(job({ job_id: 'j1', next_run_at: s.clock.now() }))
    const file = watchFile('acc3-watch', '{"payload":{"n":0}}\n', T1)
    const got: InvokeIntent[] = []
    const reg = createSourceRegistry()
    const schedSrc = createSchedulerSource({ ledger: s.ledger, clock: s.clock.now, intervalMs: 1000, sink: (i) => got.push(i) })
    const watchSrc = createFileWatchSource({ company: 'demo', file })
    reg.register(schedSrc, SCHEDULER_SOURCE_MANIFEST)
    reg.register(watchSrc, FILE_WATCH_MANIFEST)
    reg.startAll((i) => got.push(i))
    // 双源并行各产一条
    schedSrc.scheduler.poll()
    writeFileSync(file, '{"payload":{"n":1}}\n', 'utf8')
    utimesSync(file, T2, T2)
    watchSrc.check((i) => got.push(i))
    expect(got.map((i) => i.source)).toEqual(['scheduler', FILE_WATCH_SOURCE_NAME])
    // 关掉 scheduler 源：watch-file 照常产（mtime 前进 → 新意图）
    expect(reg.unregister(SCHEDULER_SOURCE_NAME)).toBe(true)
    expect(schedSrc.scheduler.running).toBe(false)
    writeFileSync(file, '{"payload":{"n":2}}\n', 'utf8')
    utimesSync(file, T3, T3)
    expect(watchSrc.check((i) => got.push(i))).toBe(1)
    expect(got[2]).toMatchObject({ source: FILE_WATCH_SOURCE_NAME, payload: { n: 2 } })
    // 反向：关掉 watch-file 源，scheduler 手动泵仍经 sink 产（源侧引擎完好）
    expect(reg.unregister(FILE_WATCH_SOURCE_NAME)).toBe(true)
    s.ledger.upsertJob(job({ job_id: 'j2', next_run_at: s.clock.now() + 1 }))
    s.clock.advance(1)
    schedSrc.scheduler.poll()
    expect(got[3]).toMatchObject({ source: 'scheduler', payload: { job_id: 'j2' } })
    expect(reg.stats.registered).toBe(0)
    expect(reg.stats.sourceErrors).toBe(0)
    s.ledger.close()
  })
})
