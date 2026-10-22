/**
 * split e2e —— 拆单物化全链（130-P2，studio-dev-173；提案 §6.2.2/§6.2.3-R2/S6/S7）
 *
 * 栈：typeflows e2e 同款（initCompany→目录补丁→fake 全家桶）；本包补丁=org-config
 * 增员 AGENT-2（L1 工程师，skills=[typescript,vitest]）——部长=AGENT-1（工程负责人）。
 *
 * 断言面（判负线=S6 双建 / S7 停摆误报·锚点断链）：
 *   S6 幂等：同一批示 3 拍连投 → 子单数恒定＋PATROL split: 键唯一（恰一次）；清单
 *   追加 → 只新建增量键；位次即键（改字段同位次不重建）；解析失败=零物化＋建议面；
 *   幽灵点将=整条拒收。
 *   S7 全链：物化→父单立案（leader 短持＋回执）→autoApprove 待批→已派发(部长工位)→
 *   fake REPORT 落盘→四要件收割→已交付 CLOSE；子单同步走 L0 五态链；零 STALL/
 *   WAIT_APPROVAL 滞留（docs/17-§2 七相位不越相位；docs/17-§6 收割四要件）。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'

/** initCompany 的 git 首提身份（e2e.test.ts 同款注入——只作用于测试进程） */
const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'split-e2e@studio-next.invalid',
  GIT_COMMITTER_EMAIL: 'split-e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-23T00:00:00.000Z')

/** AGENT-2 人事档案（六节固定形——模板 AGENT-1.md 同构，正文最小化） */
const AGENT2_MD = `---
id: AGENT-2
name: 示例工程师二
login: agent-2
level: 1
dept: departments/工程部
role: 工程师
reports_to: AGENT-1
skills: [typescript, vitest]
side_effects: [写盘]
executor: dsh
status: active
---

# AGENT-2 · 示例工程师二

## 一、定位

工程师：承接部长拆单的执行单，按验收口径交付。

## 二、职责

- 执行单交付：验收口径冻结、证据齐全（REPORT + 闸门 exit=0）
- 泳道纪律：一泳道一 worker 一分支

## 三、做过的事（事实段 · 系统机械归集）

<!--AUTO-->
（待回填）
<!--/AUTO-->

## 四、技能本体

| 技能 | 等级 | 依据 |
|---|---|---|
| typescript | 熟练 | 见技能本体映射表 |
| vitest | 熟练 | 见技能本体映射表 |

## 五、表现画像（事实段 · 零自评）

（暂无）

## 六、自述

（暂无）
`

let root = ''
let snapshot: CompanySnapshot
let aiwsRoot = ''

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
  tick: () => Promise<TickReport>
}

function buildStack(id: string): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
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
      docRefs: ['docs/17-§2（主循环七相位）', 'docs/17-§6（收割四要件）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      aiwsRoot,
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      autoApprove: true, // P0 归一层未合（studio-dev-171）；真批示→approved 映射用 demo 自批占位
      mirrorRescanEveryTicks: 5, // DEV-42①：父子同泳道串行（一泳道一 worker）→子单顺延后活动已消费，
      // 缺重扫即饿死——测试栈把镜像重扫调密（5 拍；缺省 30 拍太长），机制本身不新增
    },
    people: snapshot.people,
    departments: snapshot.departments, // 130-P2（studio-dev-173）：部门索引注入——立案 leader 解析
    makeId: deterministicIds(),
  })
  const tick = async (): Promise<TickReport> => {
    clock.advance(1000)
    return engine.tick()
  }
  return { platform, ledger, engine, clock, tick }
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-daemon-split-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  // 目录补丁=纯配置：org-config 增员 AGENT-2（等级分布 1:1 对齐）＋人事档案文件——索引↔档案双检
  const files = await readDirectoryFiles(companyDir)
  const cfg = files['org-config.yaml'] ?? ''
  expect(cfg).toContain('AGENT-1')
  files['org-config.yaml'] = cfg
    .replace('    2: 1 # 示例模板只放 1 名成员；填满一家 2 级公司时按 5-8 agent 补档', '    2: 1 # 部长\n    1: 1 # 工程师（130-P2 拆单物化 e2e 增员）')
    .replace(
      '    file: departments/工程部/people/AGENT-1.md # 人事档案路径（正文在此）',
      `    file: departments/工程部/people/AGENT-1.md # 人事档案路径（正文在此）
  - id: AGENT-2 # 拆单物化 e2e 增员（子单执行位）
    name: 示例工程师二
    login: agent-2
    level: 1
    dept: departments/工程部
    role: 工程师
    reports_to: AGENT-1
    skills: [typescript, vitest]
    status: active
    executor: dsh
    file: departments/工程部/people/AGENT-2.md`,
    )
  files['departments/工程部/people/AGENT-2.md'] = AGENT2_MD
  const mounted = loadCompanyDirectory(files)
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line} ${i.rule}`).join('；')}`)
  snapshot = mounted.snapshot
  aiwsRoot = path.join(path.dirname(companyDir), '.AIWS')
  const aiwsTree = ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  expect(aiwsTree.personDirs.length).toBe(2)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 拆单批示体（批示行＋```split 围栏块——提案 §6.2.2 冻结面） */
function directiveBody(childrenJson: string): string {
  return `前置语：需求已评审。\n批示:拆单\n\`\`\`split\n${childrenJson}\n\`\`\`\n（完）`
}

/** 台账 PATROL split 键集（物化幂等面——intent=split:<parent>#<seq>） */
function splitKeys(ledger: Ledger): string[] {
  return ledger
    .queryEvents()
    .filter((e) => e.event === 'PATROL' && (e.note ?? '').includes('intent=split:'))
    .map((e) => (e.note ?? '').match(/intent=(split:[^;]+)/)?.[1] ?? '')
    .filter((k) => k !== '')
}

async function mkParent(stack: TestStack, title: string): Promise<string> {
  const created = await stack.platform.issues.create({
    title,
    type: 'task',
    dept: snapshot.departments[0]?.path,
    level: 1, // L1：新单→待批→已派发→…→已交付（父单立案链）
  })
  return created.id
}

describe('S6 幂等（判负线=双建）', () => {
  let stack: TestStack
  beforeAll(() => {
    stack = buildStack('s6-idem')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  it('首拍物化：子单落库＋父单立案（leader 短持＋回执＋建议面）', async () => {
    const parent = await mkParent(stack, '需求：登录网关交付')
    stack.engine.ingestSplit([
      { parent, author: 'AGENT-1', body: directiveBody(`{"children":[{"title":"网关代理层 typescript","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§2"},{"title":"网关用例 vitest","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§6"}]}`) },
    ])
    const r1: TickReport = await stack.tick()
    expect(r1.errors).toEqual([])

    const kids = await stack.platform.links.children(parent)
    expect(kids).toHaveLength(2)
    for (const kid of kids) {
      const rec = await stack.platform.issues.get(kid)
      expect(rec.parent).toBe(parent)
      expect(rec.type).toBe('task')
      expect(rec.assignee).toBe('AGENT-2')
      expect(rec.dept).toBe(snapshot.departments[0]?.path)
    }
    // 父单立案收口：assignee=leader（AGENT-1）＋拆单回执（子单清单＋建议面——集中派工理由在案）
    const p = await stack.platform.issues.get(parent)
    expect(p.assignee).toBe('AGENT-1')
    const pComments = await stack.platform.comments.list(parent)
    expect(pComments.length).toBe(1) // 立案回执（内嵌逐子单建议面——一评论一收口，§6.2.3-R2）
    expect(pComments[0]?.body).toContain('拆单回执')
    expect(pComments[0]?.body).toContain('集中派工') // 子单乙候选：AGENT-2 已执子单甲 → 集中派工加分理由在案
    // PATROL 键：子单×2＋立案 1
    expect(new Set(splitKeys(stack.ledger))).toEqual(new Set([`split:${parent}#1`, `split:${parent}#2`, `split:${parent}#file`]))
  })

  it('同批示再投 2 拍：子单数恒定＋PATROL 键集不变（恰一次——判负线=双建）', async () => {
    const parent = (await stack.platform.issues.list({})).find((i) => i.title === '需求：登录网关交付')?.id ?? ''
    const body = directiveBody(`{"children":[{"title":"网关代理层 typescript","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§2"},{"title":"网关用例 vitest","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§6"}]}`)
    for (let i = 0; i < 2; i += 1) {
      stack.engine.ingestSplit([{ parent, author: 'AGENT-1', body }])
      const r = await stack.tick()
      expect(r.errors).toEqual([])
      expect(await stack.platform.links.children(parent)).toHaveLength(2)
    }
    const keys = splitKeys(stack.ledger)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })

  it('清单追加（第 3 子单）：只新建增量键（位次即键——1/2 不重建）', async () => {
    const parent = (await stack.platform.issues.list({})).find((i) => i.title === '需求：登录网关交付')?.id ?? ''
    stack.engine.ingestSplit([
      {
        parent,
        author: 'AGENT-1',
        body: directiveBody(`{"children":[{"title":"网关代理层 typescript","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§2"},{"title":"网关用例 vitest","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§6"},{"title":"网关文档锚点","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"test -s docs","docs":"docs/17-§6"}]}`),
      },
    ])
    const r = await stack.tick()
    expect(r.errors).toEqual([])
    expect(await stack.platform.links.children(parent)).toHaveLength(3)
    expect(splitKeys(stack.ledger)).toHaveLength(4) // +split:P#3（file 键已花不重复）
  })

  it('同位次改字段：不重建（位次即键，改派/改题走平台声明边）', async () => {
    const parent = (await stack.platform.issues.list({})).find((i) => i.title === '需求：登录网关交付')?.id ?? ''
    stack.engine.ingestSplit([
      {
        parent,
        author: 'AGENT-1',
        body: directiveBody(`{"children":[{"title":"网关代理层 typescript（改题）","assignee":"AGENT-1","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§2"},{"title":"网关用例 vitest（改题）","assignee":"AGENT-1","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§6"},{"title":"网关文档锚点（改题）","assignee":"AGENT-1","level":0,"lane":"core","acceptance":"test -s docs","docs":"docs/17-§6"}]}`),
      },
    ])
    const r = await stack.tick()
    expect(r.errors).toEqual([])
    expect(await stack.platform.links.children(parent)).toHaveLength(3) // 键全命中：零重建
    const kids = await stack.platform.links.children(parent)
    for (const kid of kids) expect((await stack.platform.issues.get(kid)).assignee).toBe('AGENT-2') // 旧单不动
    expect(splitKeys(stack.ledger)).toHaveLength(4)
  })

  it('缺 assignee 清单：整条拒收（零物化）＋建议面预挂（打分理由＋决定权在部长）', async () => {
    const parent = await mkParent(stack, '需求：缺将清单')
    stack.engine.ingestSplit([{ parent, author: 'AGENT-1', body: directiveBody(`{"children":[{"title":"无人认领单"}]}`) }])
    const r = await stack.tick()
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('assignee')
    expect(await stack.platform.links.children(parent)).toHaveLength(0)
    const comments = await stack.platform.comments.list(parent)
    expect(comments.length).toBe(1) // 建议面（非回执）
    expect(comments[0]?.body).toContain('候选清单＋打分理由')
    expect(comments[0]?.body).toContain('决定权在部长')
  })

  it('幽灵点将（工号不在人事索引）：整条拒收——不猜（fail-closed）', async () => {
    const parent = await mkParent(stack, '需求：幽灵将')
    stack.engine.ingestSplit([{ parent, author: 'AGENT-1', body: directiveBody(`{"children":[{"title":"单","assignee":"GHOST-9"}]}`) }])
    const r = await stack.tick()
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('GHOST-9').toContain('人事索引')
    expect(await stack.platform.links.children(parent)).toHaveLength(0)
    expect(await stack.platform.comments.list(parent)).toHaveLength(0)
  })
})

describe('S7 全链（判负线=停摆误报/锚点断链）', () => {
  let stack: TestStack
  beforeAll(() => {
    stack = buildStack('s7-chain')
  })
  afterAll(() => {
    stack.ledger.close()
  })

  it('物化→立案→自批→派发→收割四要件→已交付 CLOSE（父单 L1 链）＋子单 L0 五态链', async () => {
    const parent = await mkParent(stack, '需求：拆单物化首单')
    stack.engine.ingestSplit([
      {
        parent,
        author: 'AGENT-1',
        body: directiveBody(`{"children":[{"title":"子单甲：契约扩展 typescript","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§2"},{"title":"子单乙：用例 vitest","assignee":"AGENT-2","level":0,"lane":"core","acceptance":"bun test","docs":"docs/17-§6"}]}`),
      },
    ])
    // 拍链：物化(1)→子单派发/父单呈批(2..)→收割→复验→合并→关单——每拍一动作（docs/17-§2）；
    // 同泳道串行（父先执，子单顺延至镜像重扫救回）→拍数预算=40（重扫 5 拍一档）
    const reports: TickReport[] = []
    for (let i = 0; i < 40; i += 1) {
      reports.push(await stack.tick())
    }
    for (const [i, r] of reports.entries()) {
      expect(r.errors, `第 ${i + 1} 拍零错`).toEqual([])
    }

    // 终态：父子俱达 已交付（L1/L0 锚点链同名的结构保证）
    const p = await stack.platform.issues.get(parent)
    expect(p.state).toBe('已交付')
    expect(p.assignee).toBe('AGENT-1') // 立案 leader 短持至终态
    const kids = await stack.platform.links.children(parent)
    expect(kids).toHaveLength(2)
    for (const kid of kids) {
      const rec = await stack.platform.issues.get(kid)
      expect(rec.state).toBe('已交付')
      expect(rec.assignee).toBe('AGENT-2')
    }

    // 零停摆误报/零 WAIT_APPROVAL 滞留（判负线）——自批链全程无停摆事件
    const all = stack.ledger.queryEvents()
    expect(all.filter((e) => e.event === 'STALL' || e.event === 'STALL_ALARM')).toEqual([])
    expect(all.filter((e) => e.note?.includes('WAIT_APPROVAL')).length).toBe(0)

    // 父单事件锚点链完整（PATROL 立案→DISPATCH→GATE_PASS→QA_PASS→MERGE→CLOSE）
    const pe = stack.ledger.queryEvents({ issue: parent }).map((e) => e.event)
    expect(pe).toContain('DISPATCH')
    expect(pe).toContain('GATE_PASS')
    expect(pe).toContain('QA_PASS')
    expect(pe).toContain('MERGE')
    expect(pe).toContain('CLOSE')
    expect(pe.indexOf('PATROL')).toBeLessThan(pe.indexOf('DISPATCH'))
    expect(pe.indexOf('DISPATCH')).toBeLessThan(pe.indexOf('GATE_PASS'))
    expect(pe.indexOf('GATE_PASS')).toBeLessThan(pe.indexOf('QA_PASS'))
    expect(pe.indexOf('QA_PASS')).toBeLessThan(pe.indexOf('MERGE'))
    expect(pe.indexOf('MERGE')).toBeLessThan(pe.indexOf('CLOSE'))

    // 子单事件链（L0 五态：DISPATCH→GATE_PASS→QA_PASS→MERGE→CLOSE）＋镜像父子列
    for (const kid of kids) {
      const ke = stack.ledger.queryEvents({ issue: kid }).map((e) => e.event)
      for (const name of ['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE']) expect(ke).toContain(name)
      expect(stack.ledger.getTicketMirror(kid)?.parent).toBe(parent)
      expect(stack.ledger.getTicketMirror(kid)?.assignee).toBe('AGENT-2')
    }
    expect(stack.ledger.getTicketMirror(parent)?.assignee).toBe('AGENT-1')

    // 父单立案 REPORT 落部长工位（fake adapter 代笔——四要件之 REPORT 落盘）
    const leaderReport = path.join(aiwsRoot, snapshot.departments[0]?.path ?? '', 'AGENT-1', 'tickets', parent, 'att1', 'REPORT.md')
    expect(existsSync(leaderReport)).toBe(true)
  })

  it('终态父单再拆单：明报拒收（复活走声明边——不在拆单面隐式重开）', async () => {
    const parent = await mkParent(stack, '需求：终态再拆')
    // 先交付到底（40 拍足量），再对终态父单投拆单
    for (let i = 0; i < 40; i += 1) await stack.tick()
    const p0 = await stack.platform.issues.get(parent)
    if (p0.state !== '已交付') throw new Error(`前置失败：父单未达终态（${p0.state}）`)
    stack.engine.ingestSplit([{ parent, author: 'AGENT-1', body: directiveBody(`{"children":[{"title":"复活单","assignee":"AGENT-2"}]}`) }])
    const r = await stack.tick()
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('已终态')
    expect(await stack.platform.links.children(parent)).toHaveLength(0)
  })
})
