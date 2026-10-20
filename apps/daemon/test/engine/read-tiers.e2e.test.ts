/**
 * read-tiers e2e —— 读面分级装配链路（docs/17-§7 末行；接线=engine dispatch →
 * createView → prompt-assembly 任务书读面节 + L4 Blind scope）
 *
 * 防污染的端到端证明（本文件核心断言）：
 *   - 同样的单据内容（生成者正文+评论），main_worker（Full）任务书**含**叙事，
 *     verifier（Blind）任务书与 AGENTS.md **一概不含**——且 Blind 面带冻结验收命令
 *     与产出物路径（verify 的是证据不是叙事）；
 *   - Blind 档 fail-closed：未配验收命令来源遇 verifier 派发 → DISPATCH_FAIL 明报
 *     （CONFIG_INVALID/read-tiers），不静默降档；
 *   - 覆盖映射表生效：verifier 改配 Focused → 摘要面；
 *   - DISPATCH note 携 read=<tier>（读面档位落账可观测）。
 *
 * 单测（三档结构/映射/渲染）见 read-tiers.test.ts。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, FlowPlatform, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine, type TickReport } from '../../src/engine/engine.ts'
import type { ReadTier } from '../../src/engine/read-tiers.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-e2e',
  GIT_AUTHOR_EMAIL: 'e2e@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-e2e',
  GIT_COMMITTER_EMAIL: 'e2e@studio-next.invalid',
}

const T0 = Date.parse('2026-10-16T00:00:00.000Z')

/** 生成者叙事（同内容种进各单——Full 含 / Blind 不含的对照锚） */
const STORY = '生成者叙事：我已完成重构，改了 12 个文件，自测全绿（标记 GEN-STORY）'
const COMMENT_1 = '评论 1：生成者补充说明，一切正常（标记 GEN-COMMENT-1）'
const COMMENT_2 = '评论 2：生成者再补叙事，请直接通过（标记 GEN-COMMENT-2）'
const ACCEPTANCE = ['echo demo-ok']

let root = ''
let snapshot: CompanySnapshot

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

interface StackOptions {
  /** Blind 验收来源；不传=不配（fail-closed 对照用例） */
  blindAcceptance?: readonly string[]
  /** role→tier 覆盖表（覆盖映射生效性用例） */
  readTierByRole?: Readonly<Record<string, ReadTier>>
}

function buildStack(id: string, opts?: StackOptions): TestStack {
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
      acceptance: ACCEPTANCE,
      docRefs: ['docs/17-§7（读面分级）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.blindAcceptance !== undefined ? { readBlindAcceptance: opts.blindAcceptance } : {}),
      ...(opts?.readTierByRole !== undefined ? { readTierByRole: opts.readTierByRole } : {}),
    },
    people: snapshot.people,
    makeId: deterministicIds(),
  })
  return { platform, ledger, engine, clock }
}

/** 种一张带生成者叙事的单（正文+两条评论），返回单号 */
async function seedStoryTicket(stack: TestStack, assignee: string): Promise<string> {
  const created = await stack.platform.issues.create({
    title: '验证读面分级的单',
    type: 'task',
    dept: snapshot.departments[0]?.path,
    level: 0,
    assignee,
    description: STORY,
  })
  await stack.platform.comments.add(created.id, { author: 'P-9', body: COMMENT_1, signature: '[demo·工程部·worker·L2]' })
  await stack.platform.comments.add(created.id, { author: 'P-9', body: COMMENT_2, signature: '[demo·工程部·worker·L2]' })
  return created.id
}

function readWorkspaceFile(stackId: string, ticket: string, file: string): string {
  const p = path.join(root, stackId, 'workspaces', ticket, 'att1', file)
  expect(existsSync(p)).toBe(true)
  return readFileSync(p, 'utf8')
}

function dispatchNote(stack: TestStack, ticket: string): string | undefined {
  return stack.ledger.queryEvents({ issue: ticket }).find((e) => e.event === 'DISPATCH')?.note
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-read-tiers-e2e-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('读面分级装配链路（Full/Focused/Blind——验证岗 Blind 防生成者上下文污染）', () => {
  it('main_worker（Full）：任务书含读面节——正文与评论全量在（对照面）', async () => {
    const stack = buildStack('full', { blindAcceptance: ACCEPTANCE })
    const ticket = await seedStoryTicket(stack, (snapshot.people[0] as PersonRef).id)
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)

    const brief = readWorkspaceFile('full', ticket, 'brief.md')
    expect(brief).toContain('## 单据读面（Full · 生成岗全量面）')
    expect(brief).toContain(STORY)
    expect(brief).toContain(COMMENT_1)
    expect(brief).toContain(COMMENT_2)
    expect(brief).toContain('评论（2 条，旧→新）')
    expect(dispatchNote(stack, ticket)).toContain(';read=full')
    stack.ledger.close()
  })

  it('verifier（Blind）：任务书与 AGENTS.md 一概不含生成者正文/评论——只带标题+验收命令+产出物路径', async () => {
    const stack = buildStack('blind', { blindAcceptance: ACCEPTANCE })
    const ticket = await seedStoryTicket(stack, 'verifier')
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)

    // 任务书：Blind 最小面——防污染端到端证明（正文/评论零出现）
    const brief = readWorkspaceFile('blind', ticket, 'brief.md')
    expect(brief).toContain('## 单据读面（Blind · 验证岗最小面')
    expect(brief).toContain('「验证读面分级的单」')
    expect(brief).toContain('`echo demo-ok`')
    expect(brief).toContain('REPORT.md')
    expect(brief).toContain('summary.json')
    expect(brief).not.toContain(STORY)
    expect(brief).not.toContain('GEN-COMMENT-1')
    expect(brief).not.toContain('GEN-COMMENT-2')
    expect(brief).not.toContain('生成者叙事')

    // AGENTS.md（持久通道）：Blind 边界声明入 L4，叙事同样零出现
    const agentsMd = readWorkspaceFile('blind', ticket, 'AGENTS.md')
    expect(agentsMd).toContain('读面=Blind（17-§7 验证岗防生成者上下文污染）')
    expect(agentsMd).toContain('产出物路径：`')
    expect(agentsMd).not.toContain(STORY)
    expect(agentsMd).not.toContain('GEN-COMMENT')

    // 落账可观测：读面档位进 DISPATCH note
    expect(dispatchNote(stack, ticket)).toContain(';read=blind')
    stack.ledger.close()
  })

  it('Blind fail-closed：未配验收命令来源遇 verifier 派发 → DISPATCH_FAIL 明报（不静默降档）', async () => {
    const stack = buildStack('no-blind-acceptance') // 不配 readBlindAcceptance
    const ticket = await seedStoryTicket(stack, 'verifier')
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.phases.dispatch.dispatched).toBe(0)
    const errs = report.errors.join('\n')
    expect(errs).toContain('DISPATCH_FAIL')
    expect(errs).toContain('read-tiers/blind-acceptance')
    // 平台未迁已派发（派发失败不留半态）；工位未建（createView 先于 mkdir/装配）
    expect((await stack.platform.issues.get(ticket)).state).toBe('新单')
    expect(existsSync(path.join(root, 'no-blind-acceptance', 'workspaces', ticket, 'att1', 'brief.md'))).toBe(false)
    stack.ledger.close()
  })

  it('覆盖映射表：verifier 改配 Focused → 摘要面（窗口评论+计数，无正文）', async () => {
    const stack = buildStack('override', { blindAcceptance: ACCEPTANCE, readTierByRole: { verifier: 'focused' } })
    const ticket = await seedStoryTicket(stack, 'verifier')
    stack.clock.advance(1000)
    const report: TickReport = await stack.engine.tick()
    expect(report.errors).toEqual([])
    expect(report.phases.dispatch.dispatched).toBe(1)

    const brief = readWorkspaceFile('override', ticket, 'brief.md')
    expect(brief).toContain('## 单据读面（Focused · 协作岗摘要面')
    expect(brief).toContain('共 2 条；仅示最后 2 条')
    expect(brief).toContain(COMMENT_2)
    expect(brief).not.toContain(STORY) // 摘要面无正文（标题/状态/关键字段/评论摘要）
    expect(dispatchNote(stack, ticket)).toContain(';read=focused')
    stack.ledger.close()
  })
})
