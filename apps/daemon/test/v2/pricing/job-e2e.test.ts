/**
 * 定价发布岗全链 V2 套件（studio-dev-554；rework studio-dev-584 保持断言面）
 * org-config 岗 → 物化 type=pricing 单 → 派发相位 daemon 生成附件 → 四要件 GATE_PASS →
 * 消费面 append price_snapshots。
 *
 * 用真引擎 + fake platform/adapter（不依赖 git/网络），公司目录取仓内模板
 * `templates/company-2-level`（不读生产目录，测试可移植）。断言：
 *   ① 岗单物化 type='pricing'（供给面缺口已闭合，不再是 task）；
 *   ② launch 前附件已生成且价目=测试 models.yaml 三档；
 *   ③ GATE_PASS note 携 `;pricing=N行@...`，快照行 source_ticket=单号、published_by=岗工号；
 *   ④ 成功路径零 `src=pricing-publish` DAILY_ALARM。
 *
 * 组织配置分离口径（rework studio-dev-584）：生产岗定义在**公司目录**（org-config），
 * 不进仓 patch；本测试以 `ledger.upsertJob` 注入同形岗，验证的是仓内代码链。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { ensureAiwsTree, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { createModelCatalog, parseModelsYaml } from '@studio-next/core'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const TEST_MODELS_YAML = [
  'tiers:',
  '  high: {provider: test, model: m-high, price: {inputPerM: 600, outputPerM: 2200}}',
  '  mid: {provider: test, model: m-mid, price: {inputPerM: 200, outputPerM: 800}}',
  '  low: {provider: test, model: m-low, price: {inputPerM: 50, outputPerM: 250}}',
  'roles:',
  '  main_worker: mid',
].join('\n')

let root = ''
let snapshot: CompanySnapshot
let ledger: Ledger
let engine: Engine
let platform: ReturnType<typeof createFakePlatform>
let aiwsRoot = ''
let clock = 0
let sawDeliverable = false
let ticketId = ''

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sn584-job-e2e-'))
  const mounted = loadCompanyDirectory(await readDirectoryFiles(path.join(process.cwd(), 'templates', 'company-2-level')))
  if (!mounted.ok) throw new Error(`模板公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
  aiwsRoot = path.join(root, '.AIWS')
  ensureAiwsTree(aiwsRoot, snapshot.departments, snapshot.people, { slug: snapshot.slug })
  ledger = openLedger(path.join(root, 'ledger.sqlite'))
  platform = createFakePlatform()
  const registry = createRegistry()
  registry.register(
    createFakeAdapter({
      onLaunch: (task) => {
        const pricing = readFileSync(path.join(task.workspace, 'deliverables', 'pricing.yaml'), 'utf8')
        sawDeliverable = pricing.includes('provider: test') && pricing.includes('model: m-high')
        mkdirSync(path.join(task.workspace, 'deliverables'), { recursive: true })
        writeFileSync(path.join(task.workspace, 'deliverables', 'plan.md'), '# plan\n- e2e pricing publish\n', 'utf8')
      },
    }),
    { default: true },
  )
  const person = snapshot.people[0]
  const dept = snapshot.departments[0]
  if (person === undefined || dept === undefined) throw new Error('模板公司目录无可用人/部门')
  clock = new Date(2026, 10, 3, 9, 45, 0, 0).valueOf()
  engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['test -s REPORT.md && test -s deliverables/plan.md'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: () => clock,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, 'root'),
      aiwsRoot,
      defaultPersonId: person.id,
      deptFallback: dept.path,
      defaultLane: dept.lanes[0] ?? 'core',
    },
    people: snapshot.people,
    makeId: makeUlid,
    catalog: createModelCatalog(parseModelsYaml(TEST_MODELS_YAML)),
  })
  const jobId = 'hf-pricing-daily-综合部'
  ledger.upsertJob({
    job_id: jobId,
    company: snapshot.slug,
    dept: dept.path,
    cron: '45 9 * * *',
    role: person.id,
    level: 2,
    model_tier: 'low',
    budget_cap: 1,
    payload: { type: 'pricing', output: 'reports/' },
    next_run_at: clock,
    status: 'active',
  })
  engine.ingest([
    { kind: 'schedule', company: snapshot.slug, payload: { job_id: jobId }, source: 'scheduler', dedupKey: `e2e-${jobId}@1` },
  ])
  for (let i = 0; i < 6; i++) {
    clock += 1000
    await engine.tick()
    const events = ledger.queryEvents({ company: snapshot.slug })
    const patrol = events.find((e) => e.event === 'PATROL' && (e.note ?? '').includes(`job=${jobId}`))
    if (patrol !== undefined) ticketId = patrol.issue
    const gatePass = ticketId === '' ? undefined : events.find((e) => e.event === 'GATE_PASS' && e.issue === ticketId)
    if (gatePass !== undefined && ledger.listPriceSnapshots({ company: snapshot.slug }).length > 0) break
  }
})

afterAll(() => {
  ledger.close()
  rmSync(root, { recursive: true, force: true })
})

describe('定价发布岗全链（岗→定价单→附件→GATE_PASS→快照）', () => {
  it('物化 type=pricing；daemon 派发前生成三档附件；GATE_PASS 后快照行带单号/发布人锚', () => {
    expect(ticketId).not.toBe('')
    expect(sawDeliverable).toBe(true)
    const events = ledger.queryEvents({ company: snapshot.slug })
    const gatePass = events.find((e) => e.event === 'GATE_PASS' && e.issue === ticketId)
    expect(gatePass?.note).toContain(';pricing=3行@2026-11-03v1..1')
    const rows = ledger.listPriceSnapshots({ company: snapshot.slug, source_ticket: ticketId })
    expect(rows.map((r) => `${r.provider}/${r.model}`).sort()).toEqual(['test/m-high', 'test/m-low', 'test/m-mid'])
    expect(rows.every((r) => r.published_by === snapshot.people[0]?.id && r.version === 1)).toBe(true)
    expect(events.filter((e) => e.event === 'DAILY_ALARM' && (e.note ?? '').includes('src=pricing-publish'))).toHaveLength(0)
  })

  it('单据类型断言：平台侧 issue.type=pricing（旧口径会吞成 task）', async () => {
    const issue = await platform.issues.get(ticketId)
    expect(issue.type).toBe('pricing')
  })
})
