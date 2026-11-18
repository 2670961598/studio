/** workbench-issues-migrate.test —— task-127-A 单子切换 dry-run 工具（node:test；fixtures 真文件，零网络零库） */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_FIXTURE,
  STATE_MAP,
  buildPlan,
  loadFixtureFromPath,
  planHashOf,
  slugOf,
  type ImportPlan,
} from '../workbench-issues-migrate.ts'
import { diffPlanAgainstSource } from '../workbench-issues-diff.ts'

const HERE = import.meta.dirname
const MIGRATE = path.join(HERE, '..', 'workbench-issues-migrate.ts')
const DIFF = path.join(HERE, '..', 'workbench-issues-diff.ts')
const FIXTURES = path.join(HERE, 'fixtures', 'issues-migrate')
const CLEAN_FIXTURE = path.join(FIXTURES, 'taiga-export.json')
const DUP_FIXTURE = path.join(FIXTURES, 'taiga-export-dup.json')

const roots: string[] = []
test.after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
function tempRoot(): string { const d = mkdtempSync(path.join(tmpdir(), 'sn-issues-migrate-')); roots.push(d); return d }

interface RunResult { status: number; stdout: string; stderr: string }
function run(cli: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

const byKey = (plan: ImportPlan): Map<string, typeof plan.issues[number]> =>
  new Map(plan.issues.map((entry) => [entry.naturalKey, entry]))

test('映射：状态码/层级/评论 全量落位（干净 10 单 fixture）', () => {
  const plan = buildPlan(loadFixtureFromPath(CLEAN_FIXTURE))
  const by = byKey(plan)
  assert.equal(plan.counts.plannedIssues, 10)
  // 状态：10 行冻结映射表逐行覆盖（fixture 状态集合 === STATE_MAP 集合）
  const fixtureStatuses = new Set(plan.issues.map((e) => e.sourceRef.status))
  assert.deepEqual(fixtureStatuses, new Set(STATE_MAP.map((r) => r.from)))
  const expectedStates: Record<number, [number, string]> = {
    101: [1, 'NEW'], 102: [2, 'TODO'], 103: [3, 'IN_PROGRESS'], 104: [4, 'TESTING'], 105: [5, 'TEST_IN_PROGRESS'],
    106: [6, 'DONE'], 107: [7, 'BLOCKED'], 108: [8, 'CANCELLED'], 109: [8, 'CANCELLED'], 110: [8, 'CANCELLED'],
  }
  for (const [id, [code, name]] of Object.entries(expectedStates)) {
    const entry = by.get(`studio-dev#${id}`)
    assert.ok(entry !== undefined, `studio-dev#${id} 应在计划内`)
    assert.equal(entry.target.ticket.stateCode, code, `#${id} stateCode`)
    assert.equal(entry.target.ticket.stateName, name, `#${id} stateName`)
    assert.ok(entry.statusMapped, `#${id} statusMapped`)
    assert.ok(entry.target.ticket.labels.includes(`legacy-state-${slugOf(entry.sourceRef.status)}`), `#${id} legacy-state 标签可回溯`)
  }
  // 层级：102/103→101，104→102（三层链，vendor MAX_PARENT_DEPTH=3 内），其余无父
  assert.equal(by.get('studio-dev#102')?.target.ticket.parentKey, 'STD-101')
  assert.equal(by.get('studio-dev#103')?.target.ticket.parentKey, 'STD-101')
  assert.equal(by.get('studio-dev#104')?.target.ticket.parentKey, 'STD-102')
  assert.equal(plan.counts.parentsLinked, 3)
  assert.equal(plan.issues.filter((e) => e.target.ticket.parentKey !== null).length, 3)
  // 父先于子：导入期 parent 解析依赖
  const order = plan.issues.map((e) => e.naturalKey)
  assert.ok(order.indexOf('studio-dev#101') < order.indexOf('studio-dev#102'), '101 应先于 102')
  assert.ok(order.indexOf('studio-dev#102') < order.indexOf('studio-dev#104'), '102 应先于 104')
  // 评论：reply 链保真；乱序录入按 (createdAt,id) 规范化
  const c103 = by.get('studio-dev#103')?.target.comments ?? []
  assert.equal(c103.length, 2)
  assert.equal(c103[0]?.id, 'c-103-1')
  assert.equal(c103[1]?.replyToCommentId, 'c-103-1')
  const c106 = by.get('studio-dev#106')?.target.comments ?? []
  assert.deepEqual(c106.map((c) => c.id), ['c-106-1', 'c-106-2'], 'fixture 故意乱序，计划应按时间序')
  assert.equal(c106[1]?.replyToCommentId, 'c-106-1')
  assert.equal(plan.counts.plannedComments, 9)
  // kind / priority / requiresHuman（vendor CHECK(priority>1 OR requires_human=1)）
  assert.equal(by.get('studio-dev#103')?.target.ticket.kind, 'bug')
  assert.equal(by.get('studio-dev#108')?.target.ticket.kind, 'chore')
  assert.equal(by.get('studio-dev#101')?.target.ticket.priority, 3)
  assert.equal(by.get('studio-dev#101')?.target.ticket.requiresHuman, false)
  assert.equal(by.get('studio-dev#108')?.target.ticket.priority, 1)
  assert.equal(by.get('studio-dev#108')?.target.ticket.requiresHuman, true)
  // principals：仅被引用者（assignee+评论作者），dispatcher 只进 labels
  assert.deepEqual(plan.principals.map((p) => `${p.username}:${p.kind}`), ['producer:human', 'verifier-b:agent', 'worker-a:agent'])
  // 0 gap 基线
  assert.deepEqual(plan.gaps, [])
})

test('幂等重跑：同输入 → 同 planHash；--out 两次字节一致；diff 两轮均 0 差异', () => {
  const root = tempRoot()
  const p1 = path.join(root, 'plan-1.json')
  const p2 = path.join(root, 'plan-2.json')
  const r1 = run(MIGRATE, ['--out', p1])
  const r2 = run(MIGRATE, ['--out', p2])
  assert.equal(r1.status, 0, r1.stderr)
  assert.equal(r2.status, 0, r2.stderr)
  assert.equal(readFileSync(p1, 'utf8'), readFileSync(p2, 'utf8'), '两次 --out 产物应字节一致')
  const h1 = JSON.parse(r1.stdout).planHash as string
  const h2 = JSON.parse(r2.stdout).planHash as string
  assert.equal(h1, h2)
  assert.equal(h1, planHashOf(buildPlan(loadFixtureFromPath(CLEAN_FIXTURE))), 'CLI 与库函数同口径')
  assert.equal(run(DIFF, ['--plan', p1]).status, 0)
  assert.equal(run(DIFF, ['--plan', p2]).status, 0)
})

test('dry-run：hash 稳定、与全量计划同口径、不落盘（--out 被忽略）', () => {
  const root = tempRoot()
  const out = path.join(root, 'should-not-exist.json')
  const a = run(MIGRATE, ['--dry-run'])
  const b = run(MIGRATE, ['--dry-run', '--out', out])
  assert.equal(a.status, 0, a.stderr)
  assert.equal(b.status, 0, b.stderr)
  const sa = JSON.parse(a.stdout)
  const sb = JSON.parse(b.stdout)
  assert.equal(sa.dryRun, true)
  assert.equal(sa.planHash, sb.planHash, '两次 dry-run hash 一致')
  assert.equal(sa.planHash, planHashOf(buildPlan(loadFixtureFromPath(CLEAN_FIXTURE))), 'dry-run hash = canonical(plan) 的 sha256')
  assert.equal(sa.counts.plannedIssues, 10)
  assert.equal(sa.counts.plannedComments, 9)
  assert.equal(sa.gapCount, 0)
  assert.ok(!existsSync(out), 'dry-run 不得写任何文件')
})

test('自然键去重：12 条记录 → 10 单；旧快照丢弃且不入 hash（与干净 fixture 同 planHash）', () => {
  const clean = buildPlan(loadFixtureFromPath(CLEAN_FIXTURE))
  const dup = buildPlan(loadFixtureFromPath(DUP_FIXTURE))
  assert.equal(dup.dedup.inputRecords, 12)
  assert.equal(dup.dedup.droppedDuplicateRecords, 2)
  assert.equal(dup.counts.plannedIssues, 10)
  assert.deepEqual(dup.dedup.dropped.map((d) => `${d.naturalKey}@${d.reason}`).sort(), [
    'studio-dev#103@older-snapshot',
    'studio-dev#106@older-snapshot',
  ])
  // last-write-wins：保留新快照（106=已交付/6，而非旧快照复验中/5）
  assert.equal(byKey(dup).get('studio-dev#106')?.target.ticket.stateCode, 6)
  // 被丢弃旧快照的评论不得进入计划（c-106-0）
  assert.equal(dup.counts.plannedComments, 9)
  assert.ok(dup.issues.every((e) => e.target.comments.every((c) => c.id !== 'c-106-0')))
  // 目标载荷不变：dedup 审计域不入 hash
  assert.equal(dup.meta.planHash, clean.meta.planHash, '重导出产生的重复记录不改变目标载荷 hash')
  // 对账（dup fixture ⇄ dup 计划）0 差异
  assert.equal(diffPlanAgainstSource(loadFixtureFromPath(DUP_FIXTURE), dup).ok, true)
})

test('gap 显式：未知状态 → 计划 gap + diff exit 1；篡改计划 → plan-hash-mismatch + 字段 mismatch', () => {
  const root = tempRoot()
  const fixture = path.join(root, 'unknown-status.json')
  const raw = JSON.parse(readFileSync(CLEAN_FIXTURE, 'utf8')) as { issues: { id: number; status: string }[] }
  raw.issues.find((i) => i.id === 105)!.status = '挂起-外系统'
  writeFileSync(fixture, JSON.stringify(raw))
  const planPath = path.join(root, 'plan.json')
  const migrated = run(MIGRATE, ['--fixture', fixture, '--out', planPath])
  assert.equal(migrated.status, 0, migrated.stderr)
  assert.equal(JSON.parse(migrated.stdout).gapCount, 1)
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as ImportPlan
  assert.deepEqual(plan.gaps.map((g) => [g.kind, g.issue]), [['status-unmapped', 'studio-dev#105']])
  assert.equal(plan.counts.statusUnmapped, 1)
  assert.equal(plan.counts.statusMapped, 9)
  const gapped = run(DIFF, ['--plan', planPath, '--fixture', fixture])
  assert.equal(gapped.status, 1, '显式 gap → exit 1')
  const report = JSON.parse(gapped.stdout) as { ok: boolean; gaps: { kind: string; issue: string | null }[] }
  assert.equal(report.ok, false)
  assert.ok(report.gaps.some((g) => g.kind === 'status-unmapped' && g.issue === 'studio-dev#105'))
  assert.ok(report.gaps.some((g) => g.kind === 'plan:status-unmapped'), '计划内 gap 以 plan: 前缀并入')

  // 篡改计划：评论正文被改 → hash 失效 + 字段 mismatch 双显式
  const tamperedPath = path.join(root, 'tampered.json')
  const tampered = JSON.parse(readFileSync(planPath, 'utf8')) as ImportPlan
  const target = tampered.issues.find((e) => e.naturalKey === 'studio-dev#103')
  ;(target!.target.comments[0]! as { body: string }).body = '被篡改的正文'
  writeFileSync(tamperedPath, JSON.stringify(tampered))
  const tamperedRun = run(DIFF, ['--plan', tamperedPath, '--fixture', CLEAN_FIXTURE])
  assert.equal(tamperedRun.status, 1)
  const tamperedReport = JSON.parse(tamperedRun.stdout) as { ok: boolean; plan: { planHashIntact: boolean }; gaps: { kind: string }[] }
  assert.equal(tamperedReport.ok, false)
  assert.equal(tamperedReport.plan.planHashIntact, false)
  assert.ok(tamperedReport.gaps.some((g) => g.kind === 'plan-hash-mismatch'))
  assert.ok(tamperedReport.gaps.some((g) => g.kind === 'mismatch:comments:body'))
})

test('计数正确：计划计数与 fixture 真值逐项对账；对账器独立复核一致', () => {
  const fixture = loadFixtureFromPath(CLEAN_FIXTURE)
  const plan = buildPlan(fixture)
  const uniqueIds = new Set(fixture.issues.map((i) => `${i.project}#${i.id}`))
  const comments = fixture.issues.reduce((sum, i) => sum + i.comments.length, 0)
  const parents = fixture.issues.filter((i) => i.parent !== null).length
  assert.equal(fixture.issues.length, 10)
  assert.equal(uniqueIds.size, 10)
  assert.equal(comments, 9)
  assert.equal(parents, 3)
  assert.deepEqual(plan.counts, { plannedIssues: 10, plannedComments: 9, parentsLinked: 3, statusMapped: 10, statusUnmapped: 0 })
  const report = diffPlanAgainstSource(fixture, plan)
  assert.equal(report.ok, true)
  assert.deepEqual(report.counts, {
    sourceRecords: 10, sourceIssuesUnique: 10, plannedIssues: 10,
    sourceComments: 9, plannedComments: 9, parentsLinked: 3, gaps: 0,
  })
  assert.equal(report.perIssue.length, 10)
  assert.ok(report.perIssue.every((p) => p.ok))
})

test('用法面：缺 --plan / fixture 不存在 → exit 2；默认 fixture 即干净 fixture', () => {
  assert.equal(path.resolve(DEFAULT_FIXTURE), path.resolve(CLEAN_FIXTURE))
  const noPlan = run(DIFF, [])
  assert.equal(noPlan.status, 2)
  assert.ok(noPlan.stderr.includes('--plan'), noPlan.stderr)
  const missing = run(MIGRATE, ['--fixture', '/nonexistent/taiga.json', '--dry-run'])
  assert.equal(missing.status, 2)
  assert.ok(missing.stderr.includes('不可读'), missing.stderr)
})
