/**
 * hot-reload —— L1 配置级热重载测试（docs/38-§2 L1 / §4 R-A，制作人 2026-10-19 全批）
 *
 * 断言面（任务书五证明面逐条钉死，src/hot-reload.ts + engine.applyCompanyUpdate + serve 接线）：
 *   1. 指纹面纯函数：statDirectory（.git/.DS_Store 跳过）/diffStatIndex 三桶/fingerprintDirectory
 *      确定性（同内容同指纹、键序无关）/renderStatDiff
 *   2. 变更→重装载→新任务用新配置：改 org-config（公司名）→ 自动指纹触发 → SCHEMA_EVOLVE
 *      （note 前缀 RELOAD;、payload_hash=新总指纹）→ 新派发的 AGENTS.md 含新公司名；
 *      **在途单不受扰**：重装载时在途的 T-1 照常收割（GATE_PASS），其 AGENTS.md 仍是旧装配方
 *   3. 增员增岗重装载：加人（档案+索引+等级分布三处）+ 加岗 → people/jobs 热生效
 *      （新岗进 jobs 表、旧岗保留；RELOAD note 含 jobs=+1）
 *   4. 坏配置拒载保持旧态：坏 org-config → ESCALATE（RELOAD_CONFIG_INVALID）+ 旧快照不动；
 *      防刷屏（同 stat 形态一告）；修复后自愈重装载
 *   5. 手动通道与幂等：reload 请求（控制面文件）→ 重装载/unchanged/company-mismatch 三态；
 *      内容未变=unchanged 零事件（幂等）；awaitReloadResult 轮询与超时；
 *      answerReloadNoCompanyDir（未挂公司目录 daemon 的回执）
 *   6. serve 接线与关监听零影响（docs/22-§三式三证明）：未挂公司目录=hotReload 缺席+主循环
 *      照常；挂公司目录=check 真跑通；reloadWatch: false=自动面静默、手动通道仍活
 */
import { readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, FlowPlatform } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import {
  answerReloadNoCompanyDir,
  awaitReloadResult,
  createHotReload,
  diffStatIndex,
  fingerprintDirectory,
  readReloadRequest,
  renderStatDiff,
  statDirectory,
  writeReloadRequest,
  type HotReload,
} from '../src/hot-reload.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'
import { buildServeRuntime, parseDaemonConfig, removeMissingJobs, seedJobs, type ServeConfig } from '../src/serve.ts'

/** initCompany 的 git 首提身份（e2e.test 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-hot-reload-test',
  GIT_AUTHOR_EMAIL: 'hot-reload@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-hot-reload-test',
  GIT_COMMITTER_EMAIL: 'hot-reload@studio-next.invalid',
}

const T0 = Date.parse('2026-10-19T00:00:00.000Z')
const DEPT = 'departments/工程部'

let root = ''
let companyDir = ''
let snapshot0: CompanySnapshot

/** 确定性 ULID（e2e.test 同款） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

/** 写公司目录文件 + 显式推 mtime（跨粒度确定性：内容长度可能相同，mtime 必前进） */
let mtimeSeq = Date.parse('2026-10-01T00:00:00.000Z')
function writeCompanyFile(rel: string, content: string): void {
  const target = path.join(companyDir, rel)
  writeFileSync(target, content, 'utf8')
  mtimeSeq += 10_000
  const at = new Date(mtimeSeq)
  utimesSync(target, at, at)
}

/** org-config 读改写（文本级替换——保持注释/结构，只动值；夹具漂移即抛） */
function patchOrgConfig(from: string, to: string): void {
  const text = readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8')
  if (!text.includes(from)) throw new Error(`测试夹具漂移：org-config 缺待替换段「${from}」`)
  writeCompanyFile('org-config.yaml', text.replace(from, to))
}

/** 引擎+热重载测试栈：fake 全家桶 + 真公司目录 + 拍边界语义（check 在 tick 间调——serve 同序） */
interface Stack {
  ledger: Ledger
  engine: Engine
  platform: FlowPlatform
  hot: HotReload
  clock: { now(): number; advance(ms: number): void }
  companyState: { snapshot: CompanySnapshot }
}

function buildStack(id: string, opts?: { watch?: boolean }): Stack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })

  const companyState: { snapshot: CompanySnapshot } = { snapshot: snapshot0 }
  const makeId = deterministicIds()
  const makeAssembler = (): ReturnType<typeof createDefaultAssembler> =>
    createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: companyState.snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/38-§2（L1 配置级热重载）'],
    })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: makeAssembler(),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot0.slug,
      rootDir: path.join(root, id),
      defaultPersonId: snapshot0.people[0]?.id ?? '',
      deptFallback: DEPT,
      defaultLane: 'core',
    },
    people: snapshot0.people,
    makeId,
  })
  const hot = createHotReload({
    companyDir,
    rootDir: path.join(root, id),
    ledger,
    company: snapshot0.slug,
    clock: clock.now,
    makeId,
    log: (): void => undefined,
    deptFallback: DEPT,
    watch: opts?.watch ?? true,
    minStableMs: 0,
    apply(next) {
      // serve.ts apply 段同形（本栈无 jobs 闸门差异——恒播种以直测岗热更面）
      const seeded = seedJobs(ledger, next.jobs, clock.now())
      const removed = removeMissingJobs(ledger, next)
      companyState.snapshot = next
      engine.applyCompanyUpdate({
        people: next.people,
        assembler: makeAssembler(),
        defaultPersonId: next.people[0]?.id ?? '',
        deptFallback: next.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
        defaultLane: next.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
      })
      return { jobsSeeded: seeded.seeded, jobsKept: seeded.kept, jobsRemoved: removed }
    },
  })
  return { ledger, engine, platform, hot, clock, companyState }
}

/** RELOAD 族事件检索（EventQuery 无事件名过滤——JS 面滤） */
function reloadEvents(ledger: Ledger): { evolve: number; escalate: number; lastNote: string } {
  const all = ledger.queryEvents()
  const evolve = all.filter((e) => e.event === 'SCHEMA_EVOLVE' && (e.note ?? '').startsWith('RELOAD;'))
  const escalate = all.filter((e) => e.event === 'ESCALATE' && (e.note ?? '').startsWith('RELOAD_'))
  return { evolve: evolve.length, escalate: escalate.length, lastNote: (evolve.at(-1)?.note ?? escalate.at(-1)?.note ?? '') }
}

/** 指定单的 DISPATCH note（fp= 指纹段断言用） */
function dispatchNote(ledger: Ledger, ticket: string): string {
  const evt = ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'DISPATCH')
  if (evt?.note === undefined) throw new Error(`缺 DISPATCH 事件：${ticket}`)
  return evt.note
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-hot-reload-'))
  companyDir = path.join(root, 'company')
  await initCompany({ slug: 'reload-corp', targetDir: companyDir })
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot0 = mounted.snapshot
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 指纹面纯函数 —————————————————————————

describe('指纹面：stat 扫描 / 三桶 diff / 内容指纹', () => {
  it('statDirectory 覆盖全树且跳过 .git/.DS_Store（与 readDirectoryFiles 同规则）', async () => {
    const stats = statDirectory(companyDir)
    const names = Object.keys(stats)
    expect(names).toContain('org-config.yaml')
    expect(names).toContain('departments/工程部/config.yaml')
    expect(names).toContain('departments/工程部/people/AGENT-1.md')
    expect(names.some((n) => n === '.git' || n.startsWith('.git/'))).toBe(false)
    // 与 readDirectoryFiles 键集一致（走法同规则的结构性证明）
    const files = await readDirectoryFiles(companyDir)
    expect([...names].sort()).toEqual(Object.keys(files).sort())
  })

  it('diffStatIndex 三桶：增/删/改；自比较零变更', () => {
    const prev = { 'a.yaml': { size: 1, mtimeMs: 1 }, 'b.yaml': { size: 2, mtimeMs: 2 } }
    const next = { 'a.yaml': { size: 1, mtimeMs: 9 }, 'c.yaml': { size: 3, mtimeMs: 3 } }
    const diff = diffStatIndex(prev, next)
    expect(diff).toEqual({ added: ['c.yaml'], removed: ['b.yaml'], modified: ['a.yaml'] })
    expect(renderStatDiff(diff)).toBe('+c.yaml、-b.yaml、~a.yaml')
    expect(diffStatIndex(prev, prev)).toEqual({ added: [], removed: [], modified: [] })
  })

  it('fingerprintDirectory 确定性：同内容同指纹（键序无关）、变内容变指纹、sha256 形', () => {
    const a = fingerprintDirectory({ 'x.md': '1', 'y.md': '2' })
    const b = fingerprintDirectory({ 'y.md': '2', 'x.md': '1' })
    const c = fingerprintDirectory({ 'x.md': '1', 'y.md': '3' })
    expect(a.overall).toBe(b.overall)
    expect(a.overall).not.toBe(c.overall)
    expect(a.overall).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(a.files['x.md']).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ————————————————————————— 2. 变更→重装载→新任务新配置 + 在途不受扰 —————————————————————————

describe('自动指纹：变更 → 拍边界重装载 → 新任务用新配置（在途单不受扰）', () => {
  let stack: Stack

  beforeAll(() => {
    stack = buildStack('chain')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  it('tick1 派发 T-1：旧公司名装配方落盘（AGENTS.md + DISPATCH 指纹）', async () => {
    await stack.engine.tick() // 空拍建游标基线
    await stack.platform.issues.create({ title: '重载前单', type: 'task', dept: DEPT, level: 0, assignee: snapshot0.people[0]?.id })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)
    const agentsMd = readFileSync(path.join(root, 'chain', 'workspaces', 'T-1', 'att1', 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('reload-corp') // 旧公司名（slug=装载名）
    expect(agentsMd).not.toContain('reload-corp-v2')
  })

  it('变更 org-config 公司名 → 首检 pending、次检重装载（SCHEMA_EVOLVE·RELOAD 落账）', async () => {
    patchOrgConfig('name: reload-corp', 'name: reload-corp-v2')
    expect(await stack.hot.check()).toBeNull() // 首见=记 pending（稳定窗），不动手
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    expect(report?.changes).toContain('~org-config.yaml')
    expect(report?.fingerprint).toMatch(/^sha256:/)
    const r = reloadEvents(stack.ledger)
    expect(r.evolve).toBe(1)
    expect(r.escalate).toBe(0)
    expect(r.lastNote).toContain('RELOAD;trigger=auto')
    expect(r.lastNote).toContain('~org-config.yaml')
    // 证据断言：事件字段与 note 同源（payload_hash=新总指纹）
    const evt = stack.ledger.queryEvents().find((e) => e.event === 'SCHEMA_EVOLVE' && (e.note ?? '').startsWith('RELOAD;'))
    expect(evt?.payload_hash).toBe(report?.fingerprint)
    expect(evt?.issue).toBe('-')
    expect(stack.hot.stats.reloads).toBe(1)
  })

  it('在途 T-1 不受扰：重装载后下一拍照常收割（GATE_PASS），装配方仍是旧名', async () => {
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.harvest.completed).toBe(1)
    expect(stack.ledger.queryEvents({ issue: 'T-1' }).map((e) => e.event)).toContain('GATE_PASS')
    const agentsMd = readFileSync(path.join(root, 'chain', 'workspaces', 'T-1', 'att1', 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('reload-corp') // 在途单旧装配方不动
    expect(agentsMd).not.toContain('reload-corp-v2')
  })

  it('T-1 链收口（QA/merge/CLOSE——core 泳道释放，为 T-2 让道）', async () => {
    for (let i = 0; i < 6; i += 1) {
      stack.clock.advance(1000)
      const r = await stack.engine.tick()
      expect(r.errors).toEqual([])
      if (stack.ledger.queryEvents({ issue: 'T-1' }).some((e) => e.event === 'CLOSE')) break
    }
    expect(stack.ledger.queryEvents({ issue: 'T-1' }).map((e) => e.event)).toContain('CLOSE')
  })

  it('新单 T-2 用新配置：AGENTS.md 含新公司名、DISPATCH 指纹前移', async () => {
    await stack.platform.issues.create({ title: '重载后单', type: 'task', dept: DEPT, level: 0, assignee: snapshot0.people[0]?.id })
    stack.clock.advance(1000)
    const report = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(1)
    const agentsMd = readFileSync(path.join(root, 'chain', 'workspaces', 'T-2', 'att1', 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('reload-corp-v2') // 新任务新身份（L1 语义本体）
    const fp1 = /fp=([^;]+)/.exec(dispatchNote(stack.ledger, 'T-1'))?.[1]
    const fp2 = /fp=([^;]+)/.exec(dispatchNote(stack.ledger, 'T-2'))?.[1]
    expect(fp1).toBeTruthy()
    expect(fp2).toBeTruthy()
    expect(fp1).not.toBe(fp2)
  })

  it('幂等空检：同指纹连续检零事件', async () => {
    stack.clock.advance(1000)
    expect(await stack.hot.check()).toBeNull()
    expect(reloadEvents(stack.ledger).evolve).toBe(1)
  })
})

// ————————————————————————— 3. 增员增岗 —————————————————————————

describe('增员增岗重装载：people/jobs 热生效', () => {
  let stack: Stack

  beforeAll(() => {
    stack = buildStack('grow')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  /** people 段追加块（插在「# 定时岗清单」注释前——people 段尾） */
  const PERSON_BLOCK = [
    '  - id: AGENT-2',
    '    name: 热重载工程师',
    '    login: agent-2',
    '    level: 2',
    '    dept: departments/工程部',
    '    role: 工程师',
    '    reports_to: AGENT-1',
    '    skills: [typescript]',
    '    status: active',
    '    executor: dsh',
    '    file: departments/工程部/people/AGENT-2.md',
  ].join('\n')

  it('加人（索引+等级分布+档案）→ people 扩（jobs 原样保留）', async () => {
    const text = readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8')
    const next = text.replace('2: 1 #', '2: 2 #').replace(/\n# 定时岗清单/, `\n${PERSON_BLOCK}\n\n# 定时岗清单`)
    writeCompanyFile('org-config.yaml', next)
    // 人事档案（multifile people 索引↔档案双检——缺档案即悬空拒载）
    writeCompanyFile(
      'departments/工程部/people/AGENT-2.md',
      readFileSync(path.join(companyDir, 'departments/工程部/people/AGENT-1.md'), 'utf8').replaceAll('AGENT-1', 'AGENT-2').replaceAll('agent-1', 'agent-2'),
    )
    await stack.hot.check() // pending（公司名已在上一组变更——基线为构造时盘面）
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    // people 热生效（引擎消费面经 companyState→applyCompanyUpdate）
    expect(stack.companyState.snapshot.people.map((p) => p.id)).toEqual(['AGENT-1', 'AGENT-2'])
    // 旧两岗保留（seedJobs kept 面）
    expect(stack.ledger.getJob('health-patrol-工程部')).toBeDefined()
    expect(stack.ledger.getJob('daily-report-工程部')).toBeDefined()
    expect(reloadEvents(stack.ledger).lastNote).toContain('people=2')
  })

  it('加岗（第三岗）→ jobs=+1 进 note、getJob 命中', async () => {
    const text = readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8')
    const next = text.replace(
      /\n# YouTrack 账号锚点映射/,
      '\n  - id: reload-probe-岗\n    dept: departments/工程部\n    cron: "7 3 * * *"\n    role: AGENT-2\n    type: probe\n    model_tier: low\n\n# YouTrack 账号锚点映射',
    )
    writeCompanyFile('org-config.yaml', next)
    await stack.hot.check()
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    expect(stack.ledger.getJob('reload-probe-岗')?.role).toBe('AGENT-2')
    expect(reloadEvents(stack.ledger).lastNote).toContain('jobs=+1')
  })

  it('撤岗 → jobs 表移除（他岗不动）', async () => {
    const text = readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8')
    const block = '\n  - id: reload-probe-岗\n    dept: departments/工程部\n    cron: "7 3 * * *"\n    role: AGENT-2\n    type: probe\n    model_tier: low\n\n# YouTrack 账号锚点映射'
    if (!text.includes(block)) throw new Error('测试夹具漂移：reload-probe 岗块不在预期位')
    writeCompanyFile('org-config.yaml', text.replace(block, '\n# YouTrack 账号锚点映射'))
    await stack.hot.check()
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    expect(stack.ledger.getJob('reload-probe-岗')).toBeUndefined()
    expect(stack.ledger.getJob('health-patrol-工程部')).toBeDefined()
    expect(stack.ledger.getJob('daily-report-工程部')).toBeDefined()
    expect(reloadEvents(stack.ledger).lastNote).toContain('jobs=+0/-1')
  })
})

// ————————————————————————— 4. 坏配置拒载保持旧态 —————————————————————————

describe('坏配置拒载：保持旧态 + ESCALATE + 防刷屏 + 修复自愈', () => {
  let stack: Stack
  let goodOrg: string

  beforeAll(() => {
    stack = buildStack('invalid')
    goodOrg = readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  it('坏 org-config（YAML 语法破）→ 拒载 + ESCALATE + 旧快照不动', async () => {
    writeCompanyFile('org-config.yaml', `${goodOrg}\ncompany: [破括号`)
    await stack.hot.check() // pending
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('invalid')
    const r = reloadEvents(stack.ledger)
    expect(r.escalate).toBe(1)
    expect(r.evolve).toBe(0)
    expect(r.lastNote).toContain('RELOAD_CONFIG_INVALID')
    expect(r.lastNote).toContain('org-config/yaml-syntax')
    // 旧态未动：快照持有者仍为挂载时形态（本栈构造用初始快照——名未换）
    expect(stack.companyState.snapshot.name).toBe('reload-corp')
    expect(stack.hot.stats.reloads).toBe(0)
  })

  it('防刷屏：同 stat 形态连检 5 次，ESCALATE 不涨、零重装载', async () => {
    for (let i = 0; i < 5; i += 1) {
      stack.clock.advance(1000)
      expect(await stack.hot.check()).toBeNull()
    }
    const r = reloadEvents(stack.ledger)
    expect(r.escalate).toBe(1)
    expect(r.evolve).toBe(0)
  })

  it('修复自愈两段：回写原内容=unchanged 零事件（幂等闸）；真变更=自动重装载', async () => {
    // ① 坏转好回到基线原态：stat 变而内容指纹同——不应用不落事件（拒载在册复位）
    writeCompanyFile('org-config.yaml', goodOrg)
    await stack.hot.check() // stat 再变=新形态，拒载在册复位
    stack.clock.advance(1000)
    const absorbed = await stack.hot.check()
    expect(absorbed?.kind).toBe('unchanged')
    expect(reloadEvents(stack.ledger).evolve).toBe(0)
    // ② 真修复（内容真变——mission 改句）：自动重装载成功
    writeCompanyFile('org-config.yaml', goodOrg.replace('# 使命（L1）', '# 使命（L1·修复自愈）'))
    await stack.hot.check()
    stack.clock.advance(1000)
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    expect(reloadEvents(stack.ledger).evolve).toBe(1)
    expect(stack.companyState.snapshot.people).toHaveLength(2) // 盘面真形态（含 AGENT-2）
  })
})

// ————————————————————————— 5. 手动通道与幂等 —————————————————————————

describe('手动 reload：控制面文件通道 / 幂等 / company 比对', () => {
  let stack: Stack
  const rootDirOf = (): string => path.join(root, 'manual')

  beforeAll(() => {
    stack = buildStack('manual')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  it('请求 → 重装载 → 回执 applied:true（ok）', async () => {
    patchOrgConfig('mission: 用一条可验证的交付链，把需求变成有证据的产出', 'mission: 热重载后的新使命（R-A 证明面）')
    writeReloadRequest(rootDirOf(), { id: 'req-1', company: null, requestedAt: 1 })
    const report = await stack.hot.check()
    expect(report?.kind).toBe('reloaded')
    expect(report?.changes).toContain('~org-config.yaml')
    const result = await awaitReloadResult(rootDirOf(), 'req-1', 1000, 10)
    expect(result).toMatchObject({ id: 'req-1', ok: true, applied: true })
    expect(readReloadRequest(rootDirOf())?.id).toBe('req-1')
  })

  it('幂等：内容未变的手动 reload → unchanged 回执 + 零新事件', async () => {
    const before = reloadEvents(stack.ledger)
    writeReloadRequest(rootDirOf(), { id: 'req-2', company: null, requestedAt: 2 })
    const report = await stack.hot.check()
    expect(report?.kind).toBe('unchanged')
    const result = await awaitReloadResult(rootDirOf(), 'req-2', 1000, 10)
    expect(result).toMatchObject({ id: 'req-2', ok: true, applied: false, reason: 'unchanged' })
    const after = reloadEvents(stack.ledger)
    expect(after.evolve).toBe(before.evolve)
    expect(after.escalate).toBe(before.escalate)
  })

  it('company 不符：回执 company-mismatch、不重装载不落账', async () => {
    const before = reloadEvents(stack.ledger)
    writeReloadRequest(rootDirOf(), { id: 'req-3', company: '别的公司', requestedAt: 3 })
    const report = await stack.hot.check()
    expect(report?.kind).toBe('company-mismatch')
    const result = await awaitReloadResult(rootDirOf(), 'req-3', 1000, 10)
    expect(result).toMatchObject({ id: 'req-3', ok: false, applied: false, reason: 'company-mismatch' })
    const after = reloadEvents(stack.ledger)
    expect(after.evolve + after.escalate).toBe(before.evolve + before.escalate)
  })

  it('同 id 请求不重放；awaitReloadResult 超时=undefined', async () => {
    expect(await stack.hot.check()).toBeNull() // req-3 仍在请求文件——同 id 幂等忽略
    expect(await awaitReloadResult(rootDirOf(), 'req-404', 150, 20)).toBeUndefined()
  })

  it('未挂公司目录 daemon：answerReloadNoCompanyDir 回执 no-company-dir（同请求幂等）', async () => {
    const dir = path.join(root, 'no-company-daemon')
    writeReloadRequest(dir, { id: 'req-9', company: null, requestedAt: 9 })
    const seen = answerReloadNoCompanyDir(dir, 'demo', null)
    expect(seen).toBe('req-9')
    const result = await awaitReloadResult(dir, 'req-9', 1000, 10)
    expect(result).toMatchObject({ id: 'req-9', ok: false, applied: false, reason: 'no-company-dir' })
    expect(answerReloadNoCompanyDir(dir, 'demo', seen)).toBe(seen)
  })
})

// ————————————————————————— 6. serve 接线与关监听零影响（docs/22-§三式三证明） —————————————————————————

/** serve 测试配置（最小面；companyDir/watch 由用例覆写） */
function serveConfig(id: string, over?: Partial<ServeConfig>): ServeConfig {
  return {
    db: path.join(root, `${id}.sqlite`),
    platform: 'fake',
    company: snapshot0.slug,
    rootDir: path.join(root, id),
    tickMs: 10,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 60_000,
    laneTtlMs: 30 * 60_000,
    breakerThreshold: 3,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15_000,
    matrix: false,
    fileWatch: false,
    cadence: false,
    sla: false,
    reloadWatch: true,
    ...over,
  }
}

/** 当前盘面快照（serve 装配与 hot 基线同源——盘面真形态） */
async function currentSnapshot(): Promise<CompanySnapshot> {
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`夹具破坏：公司目录非法 ${mounted.issues.map((i) => i.file).join('；')}`)
  return mounted.snapshot
}

describe('serve 接线：companyDir→hotReload 装配 / reloadWatch 解析 / 关监听零影响', () => {
  it('parseDaemonConfig：reloadWatch 默认 true、显式 false 收', () => {
    expect(parseDaemonConfig('db: ./x.sqlite\n').reloadWatch).toBe(true)
    expect(parseDaemonConfig('db: ./x.sqlite\nreloadWatch: false\n').reloadWatch).toBe(false)
  })

  it('未挂公司目录：hotReload 缺席、主循环照常（三证明之关面）', async () => {
    const ledger = openLedger(path.join(root, 'serve-no-dir.sqlite'))
    const logs: string[] = []
    const runtime = buildServeRuntime(serveConfig('serve-no-dir'), ledger, await currentSnapshot(), {
      log: (l) => logs.push(l),
      clock: () => T0,
    })
    try {
      expect(runtime.hotReload).toBeUndefined()
      expect(logs.some((l) => l.includes('L1 热重载'))).toBe(false)
      const report = await runtime.engine.tick()
      expect(report.errors).toEqual([])
      expect(report.events.some((e) => e.event === 'HEARTBEAT')).toBe(true)
    } finally {
      await runtime.stop()
    }
  })

  it('挂公司目录：hotReload 在位，serve 装配段真跑通（变更→SCHEMA_EVOLVE·RELOAD）', async () => {
    const ledger = openLedger(path.join(root, 'serve-dir.sqlite'))
    let t = T0
    const logs: string[] = []
    const runtime = buildServeRuntime(serveConfig('serve-dir', { companyDir }), ledger, await currentSnapshot(), {
      log: (l) => logs.push(l),
      clock: () => t,
    })
    try {
      const hot = runtime.hotReload
      expect(hot).toBeDefined()
      expect(logs.some((l) => l.includes('L1 热重载已接'))).toBe(true)
      expect(await hot!.check()).toBeNull() // 基线=当前盘面（启动不重放）
      patchOrgConfig('mission: 热重载后的新使命（R-A 证明面）', 'mission: serve 装配段第三版使命')
      expect(await hot!.check()).toBeNull() // pending
      t += 1000
      const report = await hot!.check()
      expect(report?.kind).toBe('reloaded')
      const evt = ledger.queryEvents().find((e) => e.event === 'SCHEMA_EVOLVE' && (e.note ?? '').startsWith('RELOAD;'))
      expect(evt?.note).toContain('~org-config.yaml')
      expect(evt?.note).toContain('RELOAD;trigger=auto')
    } finally {
      await runtime.stop()
    }
  })

  it('reloadWatch: false：自动面静默、手动通道仍活（三证明之关面②）', async () => {
    const ledger = openLedger(path.join(root, 'serve-watch-off.sqlite'))
    const runtime = buildServeRuntime(
      serveConfig('serve-watch-off', { companyDir, reloadWatch: false }),
      ledger,
      await currentSnapshot(),
      { log: (): void => undefined, clock: () => T0 },
    )
    try {
      const hot = runtime.hotReload
      expect(hot).toBeDefined()
      patchOrgConfig('mission: serve 装配段第三版使命', 'mission: watch 关时的第四版使命')
      for (let i = 0; i < 4; i += 1) expect(await hot!.check()).toBeNull()
      expect(reloadEvents(ledger).evolve).toBe(0) // 自动面关：零重装载零事件
      writeReloadRequest(path.join(root, 'serve-watch-off'), { id: 'req-w1', company: null, requestedAt: 5 })
      const report = await hot!.check()
      expect(report?.kind).toBe('reloaded') // 手动通道不受 reloadWatch 闸
      expect(reloadEvents(ledger).evolve).toBe(1)
    } finally {
      await runtime.stop()
    }
  })
})
