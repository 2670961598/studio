/**
 * 行业模板包导入流自测（DEV-30；docs/43-§三「行业模板包」× docs/43-§一「git 网址即公司」）
 *
 * 验收口径（任务书冻结）：
 *   - **可装**：两套行业示例包（互联网/游戏）各自打成真实 git 仓 → 真 CLI
 *     `studio-next company add <git-url>`（Node 原生 type-stripping 直跑 bin.ts）
 *     → exit 0 + 摘要（slug/trust=false/插件安装面）+ 落地布局（公司目录/信任锚/
 *     .AIWS 员工工作区树/隔离插件根）；
 *   - **可跑**：导入产物挂载快照 → fake 全家桶（fake FlowPlatform + fake executor，
 *     docs/23-§四——零 LLM 打桩）一单走主循环七相位（docs/17-§2）的前四拍：
 *     新单 → DISPATCH（装配落盘=员工家）→ 收割 → GATE_PASS，收割四要件齐
 *     （docs/17-§6：终态事件 + 非空 REPORT 落盘 + summary sidecar + work_records 收口）。
 *
 * 行业差异的包内容断言在 packages/company/test/industry-templates.test.ts；
 * 本文件证明**同一条导入与运行链路**对两套行业包都成立（同 schema 不同资产的可装可跑面）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { simpleGit } from 'simple-git'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../src/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../src/fakes.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates')
const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url))

/** 行业示例包两套（DEV-30 打样面：互联网 + 游戏——docs/43-§三） */
const CASES = [
  {
    dir: 'company-internet',
    slug: 'internet-corp',
    installName: 'my-net-corp',
    person: 'NET-1',
    deptPath: 'departments/研发部',
    plugin: 'dsh-web-test',
    missingPlugin: 'dsh-metrics-board',
  },
  {
    dir: 'company-game',
    slug: 'game-corp',
    installName: 'my-game-corp',
    person: 'GAME-1',
    deptPath: 'departments/研发部',
    plugin: 'dsh-asset-check',
    missingPlugin: 'dsh-loc-lint',
  },
] as const

/** 确定性 ULID（e2e.test.ts 同款：'0' 时间段 + 计数尾段，26 字符） */
function deterministicIds(): (ts: number) => string {
  let n = 0
  return (_ts: number): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface TestStack {
  platform: FlowPlatform
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

describe.each(CASES)('DEV-30 · $dir：DEV-27 导入流自测（可装 → fake 一单可跑）', (c) => {
  let root = ''
  let workRoot = ''
  let target = ''
  let aiwsRoot = ''
  let snapshot: CompanySnapshot
  let stack: TestStack
  let cliOut = ''

  beforeAll(async () => {
    // ── 分发仓：模板包 → 真实 git 仓（「git 网址即公司」的网址侧）──
    root = await mkdtemp(path.join(tmpdir(), `studio-next-dev30-${c.slug}-`))
    const repoUrl = path.join(root, 'pkg-repo')
    await cp(path.join(templatesRoot, c.dir), repoUrl, { recursive: true })
    const git = simpleGit(repoUrl)
    await git.init()
    await git.addConfig('user.name', 'dev30-fixture')
    await git.addConfig('user.email', `dev30@${c.slug}.invalid`)
    await git.add('-A')
    await git.commit(`v1: ${c.dir} 行业示例公司包`)

    // ── 可装：真 CLI 一条命令（克隆→剥离→校验→初始化→安装）──
    workRoot = path.join(root, 'work')
    target = path.join(workRoot, c.installName)
    const res = spawnSync(process.execPath, [BIN, 'company', 'add', repoUrl, c.installName, '--work-root', workRoot, '--by', '制作人-dev30'], {
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(res.status, `company add stdout=${res.stdout} stderr=${res.stderr}`).toBe(0)
    cliOut = res.stdout

    // ── 可跑准备：导入产物挂载快照 + fake 引擎栈（docs/23-§四 demo 模式）──
    const mounted = loadCompanyDirectory(await readDirectoryFiles(target))
    if (!mounted.ok) throw new Error(`导入产物挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line} ${i.rule}`).join('；')}`)
    snapshot = mounted.snapshot
    aiwsRoot = path.join(workRoot, '.AIWS')
    stack = buildStack(`e2e-${c.slug}`)
  })

  afterAll(async () => {
    stack?.ledger.close()
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  const buildStack = (id: string): TestStack => {
    const ledger = openLedger(path.join(root, `${id}.sqlite`))
    const t0 = Date.parse('2026-10-20T00:00:00.000Z')
    let t = t0
    const clock = {
      now: (): number => t,
      advance: (ms: number): void => {
        t += ms
      },
    }
    const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    const person = snapshot.people[0] as PersonRef
    const engine = createEngine({
      platform,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.5-demo',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）', 'docs/43-§三（行业模板包）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: clock.now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: snapshot.slug,
        rootDir: path.join(root, id),
        aiwsRoot,
        defaultPersonId: person.id,
        deptFallback: snapshot.departments[0]?.path ?? c.deptPath,
        defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      },
      people: snapshot.people,
      makeId: deterministicIds(),
    })
    return { platform, ledger, engine, clock }
  }

  it('可装：CLI exit 0 + 摘要（slug/信任锚/依赖清单安装面）+ 落地布局', () => {
    // 摘要面：首次导入 + 信任锚未信 + 插件 install/missing 各一（缺源=能力声明，不阻断）
    expect(cliOut).toContain(`slug=${c.slug}；首次导入`)
    expect(cliOut).toContain('trust=false')
    expect(cliOut).toContain(`${c.plugin}:install`)
    expect(cliOut).toContain(`${c.missingPlugin}:missing`)
    // 布局面（docs/43-§一）：
    expect(existsSync(path.join(target, 'org-config.yaml'))).toBe(true)
    expect(existsSync(path.join(target, 'charter.md'))).toBe(true)
    expect(existsSync(path.join(target, 'dependencies.yaml'))).toBe(true)
    expect(existsSync(path.join(target, '.studio-next', 'trust.json'))).toBe(true)
    // .AIWS 员工工作区树（首部门首员工的工位在位——docs/43-§五）
    expect(existsSync(path.join(aiwsRoot, c.deptPath, c.person))).toBe(true)
    // 依赖清单安装落隔离插件根（绝不写用户 ~/.dsh——docs/43-§四）
    expect(existsSync(path.join(workRoot, 'var', 'plugins', c.plugin))).toBe(true)
    expect(existsSync(path.join(workRoot, 'var', 'platform'))).toBe(true)
  })

  it('可跑：一单 DISPATCH（装配落盘=员工家+指纹）→ 收割 GATE_PASS，四要件齐（docs/17-§6）', async () => {
    // 新单（fake 平台七能力——docs/23-§四）
    const created = await stack.platform.issues.create({
      title: `${c.slug} 行业包自测单：交付一句话`,
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    const t1: TickReport = await stack.engine.tick()
    expect(t1.errors).toEqual([])
    expect(t1.phases.dispatch.dispatched).toBe(1)
    expect(t1.actions.map((a) => `${a.type}:${a.code}`)).toContain('dispatch:DISPATCH')
    expect((await stack.platform.issues.get(created.id)).state).toBe('已派发')
    expect(stack.ledger.getTicketMirror(created.id)?.company).toBe(c.slug)

    // 装配落盘：AGENTS.md（行业公司名进 L1——同链路不同资产的可见差异）+ 任务书首版
    const workspace = path.join(aiwsRoot, c.deptPath, c.person, 'tickets', created.id, 'att1')
    const agentsMd = readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Studio Next 生成物：勿手改')
    expect(agentsMd).toContain(`# L1 · 公司（${snapshot.name}｜`) // L1 行业公司名
    expect(agentsMd).toContain(`[${snapshot.name}·${c.deptPath}·`) // L2 署名前缀
    expect(readFileSync(path.join(workspace, 'brief.md'), 'utf8')).toContain('## 验收口径')

    // 指纹落账：DISPATCH note 携完整分层指纹（行业包=同人同岗不同公司/单号面）
    const dispatch = stack.ledger.queryEvents({ issue: created.id }).find((e) => e.event === 'DISPATCH')
    expect(dispatch?.note).toMatch(new RegExp(`^fp=W-v0\\.5-demo/co\\.[0-9a-f]{8}/org\\.[0-9a-f]{8}/p\\.${c.person}\\.[0-9a-f]{8}/t\\.${created.id}\\.1/ex\\.fake@0\\.0\\.0-fake;`))

    // 收割拍 → GATE_PASS（四要件齐：docs/17-§6）
    stack.clock.advance(1000)
    const t2: TickReport = await stack.engine.tick()
    expect(t2.errors).toEqual([])
    expect(t2.phases.harvest.completed).toBe(1)
    expect(stack.ledger.queryEvents({ issue: created.id }).map((e) => e.event)).toEqual(['DISPATCH', 'GATE_PASS'])
    expect((await stack.platform.issues.get(created.id)).state).toBe('证据就绪')

    // 要件②work_records 收口：done + 成本/令牌/报告引用齐
    const record = stack.ledger.listWorkRecords({ issue: created.id })[0]
    expect(record?.status).toBe('done')
    expect(record?.ended_at).toBeGreaterThan(0)
    expect(record?.cost_usd).toBe(0.01)
    expect(record?.tokens).toEqual({ input: 100, output: 50 })
    // 要件③非空 REPORT 落盘 + ④summary sidecar——都落在员工家工位（docs/43-§五）
    expect(record?.report_ref).toMatch(/REPORT\.md$/)
    expect(record?.summary_ref).toMatch(/summary\.json$/)
    expect(record?.report_ref).toContain(path.join('.AIWS', c.deptPath, c.person, 'tickets', created.id, 'att1'))
    expect(existsSync(record?.report_ref ?? '')).toBe(true)
    expect(readFileSync(record?.report_ref ?? '', 'utf8').length).toBeGreaterThan(0)
    expect(existsSync(record?.summary_ref ?? '')).toBe(true)
    expect(JSON.parse(readFileSync(record?.summary_ref ?? '', 'utf8')).schema).toBe('summary/v1')
  })
})
