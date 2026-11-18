/** workbench-issues-rehearse.test —— task-127-B 真实 Phase0 10 单导入演练（node:test；真实仓内数据件，零网络零生产） */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { MAX_PARENT_DEPTH } from '../../vendor/workbench-core/issues/src/catalog.ts'
import { STATE_MAP, buildPlan } from '../workbench-issues-migrate.ts'
import { diffPlanAgainstSource } from '../workbench-issues-diff.ts'
import {
  DEFAULT_EXPORT,
  DEFAULT_EXPECTATIONS,
  adaptPhase0Export,
  createRehearsalDb,
  loadPhase0Export,
  rehearseCli,
  runRehearsal,
} from '../workbench-issues-rehearse.ts'
import { rollbackCli } from '../workbench-issues-rollback.ts'

const HERE = import.meta.dirname
const REHEARSE = path.join(HERE, '..', 'workbench-issues-rehearse.ts')
const ROLLBACK = path.join(HERE, '..', 'workbench-issues-rollback.ts')

const roots: string[] = []
test.after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
function tempRoot(): string { const d = mkdtempSync(path.join(tmpdir(), 'sn-issues-rehearse-test-')); roots.push(d); return d }
/** 演练临时库残留探测：跑前/跑后 /tmp 下 sn-issues-rehearse-* 目录数不得增加（排除本测试自己的 -test- 前缀根） */
const leakCount = (): number => readdirSync(tmpdir()).filter((n) => n.startsWith('sn-issues-rehearse-') && !n.startsWith('sn-issues-rehearse-test-')).length

interface RunResult { status: number; stdout: string; stderr: string }
function run(cli: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') }
  }
}

const planOfRealExport = () => buildPlan(adaptPhase0Export(loadPhase0Export(DEFAULT_EXPORT)).fixture)

/** 供回滚 SOP 用例复用的演练证据件（test 1 产出） */
let artifactDir: string | null = null

test('真实 Phase0 10 单：导入演练 0 gap（对账 exit 0，临时库自动清理）', () => {
  const root = tempRoot()
  artifactDir = root
  const before = leakCount()
  const r = run(REHEARSE, ['--out', path.join(root, 'rehearse.json')])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(leakCount(), before, '自动临时库必须跑完即清，不留残留')
  const report = JSON.parse(readFileSync(path.join(root, 'rehearse.json'), 'utf8')) as {
    ok: boolean
    export: { rows: number; rowsDropped: number }
    plan: { gapCount: number; blockingGaps: unknown[]; planHash: string }
    diff: { ok: boolean; counts: Record<string, number>; perIssue: { ok: boolean }[] }
    import: { tableCounts: Record<string, number>; dbHash: string; cleaned: boolean }
  }
  assert.equal(report.ok, true)
  assert.equal(report.export.rows, 10)
  assert.equal(report.export.rowsDropped, 0)
  assert.equal(report.plan.gapCount, 0, '真实 10 单 0 gap')
  assert.deepEqual(report.plan.blockingGaps, [])
  assert.equal(report.diff.ok, true)
  assert.deepEqual(report.diff.counts, {
    sourceRecords: 10, sourceIssuesUnique: 10, plannedIssues: 10,
    sourceComments: 0, plannedComments: 0, parentsLinked: 0, gaps: 0,
  })
  assert.equal(report.diff.perIssue.length, 10)
  assert.ok(report.diff.perIssue.every((p) => p.ok))
  assert.deepEqual(report.import.tableCounts, {
    principals: 4, projects: 1, memberships: 0, tickets: 10, ticketLabels: 60, comments: 0, events: 0,
  })
  assert.match(report.import.dbHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(report.import.cleaned, true)
})

test('ID 保留为 key：计划 key === 源 externalRef；body 自证来源（runbook §五.2 roundtrip 口径）', () => {
  const rows = loadPhase0Export(DEFAULT_EXPORT).rows
  const plan = planOfRealExport()
  const keys = new Set(plan.issues.map((e) => e.target.ticket.key))
  assert.deepEqual([...keys].sort(), rows.map((r) => r.issue).sort(), 'key=<keyPrefix>-<源 ref>=externalRef 原样')
  for (const entry of plan.issues) {
    const row = rows.find((r) => r.issue === entry.target.ticket.key)
    assert.ok(row !== undefined)
    assert.equal(entry.naturalKey, `studio-dev#${String(row.issue.split('-').pop())}`)
    assert.ok(entry.target.ticket.title.startsWith(`[${row.issue}] `), '标题按 Phase0 口径合成')
    const body = JSON.parse(entry.target.ticket.body) as { externalRef: string; state: string }
    assert.equal(body.externalRef, row.issue)
    assert.equal(body.state, row.state)
    assert.equal(entry.target.ticket.assignee, row.assignee)
  }
})

test('幂等：同导出重跑两次 → 同 planHash/同 dbHash/报告字节一致；同库重复导入显式拒绝（不重复塞入）', () => {
  const a = runRehearsal()
  const b = runRehearsal()
  assert.equal(a.code, 0)
  assert.equal(b.code, 0)
  assert.equal(a.report.plan.planHash, b.report.plan.planHash)
  const hashOf = (r: typeof a): string => (r.report.import !== null && !('skipped' in r.report.import) ? r.report.import.dbHash : '')
  assert.equal(hashOf(a), hashOf(b), '两次全新建库内容 hash 一致')
  assert.equal(JSON.stringify(a.report), JSON.stringify(b.report), '两轮报告整体一致')

  const root = tempRoot()
  const p1 = path.join(root, 'r1.json')
  const p2 = path.join(root, 'r2.json')
  assert.equal(run(REHEARSE, ['--out', p1]).status, 0)
  assert.equal(run(REHEARSE, ['--out', p2]).status, 0)
  assert.equal(readFileSync(p1, 'utf8'), readFileSync(p2, 'utf8'), 'CLI 两次 --out 产物字节一致')

  // 同库守卫：第二个轮次必须显式失败，而不是静默重复插入
  const db = path.join(root, 'explicit.db')
  assert.equal(run(REHEARSE, ['--db', db]).status, 0)
  const again = run(REHEARSE, ['--db', db])
  assert.equal(again.status, 2)
  assert.ok(again.stderr.includes('目标库已有'), again.stderr)
})

test('dry-run：只打印计划/目标行计数，不建库不落盘（--db/--out 均被忽略）', () => {
  const root = tempRoot()
  const db = path.join(root, 'no.db')
  const out = path.join(root, 'no.json')
  const before = leakCount()
  const r = run(REHEARSE, ['--dry-run', '--db', db, '--out', out])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(db), 'dry-run 不得建库')
  assert.ok(!existsSync(out), 'dry-run 不得写任何文件')
  assert.equal(leakCount(), before, 'dry-run 不产生临时目录')
  const summary = JSON.parse(r.stdout.trim()) as {
    dryRun: boolean
    counts: { plannedIssues: number; plannedComments: number; statusMapped: number }
    targetRowCounts: { tickets: number; labels: number; comments: number }
    planHash: string
  }
  assert.equal(summary.dryRun, true)
  assert.deepEqual(summary.counts, { plannedIssues: 10, plannedComments: 0, parentsLinked: 0, statusMapped: 10, statusUnmapped: 0 })
  assert.deepEqual(summary.targetRowCounts, { tickets: 10, labels: 60, comments: 0 })
  assert.equal(summary.planHash, planOfRealExport().meta.planHash, 'dry-run hash 与全量同口径')
})

test('空评论 body：计划 gap + diff 独立检出 + rehearse fail-closed 不建库（127-B P2 下限修复）', () => {
  const root = tempRoot()
  const mutated = path.join(root, 'export-empty-comment.json')
  const raw = JSON.parse(readFileSync(DEFAULT_EXPORT, 'utf8')) as { rows: Record<string, unknown>[] }
  raw.rows[0]!['comments'] = [{ id: 'c-empty', author: 'OPS-1', body: '', replyTo: null, createdAt: 1794848704000 }]
  writeFileSync(mutated, JSON.stringify(raw))

  // 计划层：空 body 显式 gap（vendor CHECK length BETWEEN 1 AND 16384）
  const { fixture } = adaptPhase0Export(loadPhase0Export(mutated))
  const plan = buildPlan(fixture)
  const gap = plan.gaps.find((g) => g.kind === 'comment-body-empty')
  assert.ok(gap !== undefined, '计划必须检出空评论 body')
  assert.equal(gap.issue, `studio-dev#${String((raw.rows[0]!['issue'] as string).split('-').pop())}`)
  // 对账层：独立检出（不靠 plan: 前缀转述）
  const diff = diffPlanAgainstSource(fixture, plan)
  assert.equal(diff.ok, false)
  assert.ok(diff.gaps.some((g) => g.kind === 'comment-body-empty'), 'diff 独立检出空 body')
  assert.ok(diff.gaps.some((g) => g.kind === 'plan:comment-body-empty'), '计划内 gap 以 plan: 前缀并入')
  // 演练层：vendor-blocking → 不建库、exit 1
  const before = leakCount()
  const r = run(REHEARSE, ['--export', mutated, '--out', path.join(root, 'report.json')])
  assert.equal(r.status, 1, '显式 gap → exit 1')
  assert.equal(leakCount(), before, 'fail-closed 不得建库')
  const report = JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8')) as {
    plan: { blockingGaps: { kind: string }[] }
    import: { skipped: string }
  }
  assert.deepEqual(report.plan.blockingGaps.map((g) => g.kind), ['comment-body-empty'])
  assert.match(report.import.skipped, /vendor-blocking/)

  // vendor 真值：空 body 插入确被 DDL 拒绝（证 blocking 判定与 vendor 一致）
  const probe = createRehearsalDb(path.join(root, 'probe.db'))
  probe.prepare("INSERT INTO principals (id, kind, display_name, status, created_at) VALUES ('prin:p1','agent','p1','active',1)").run()
  probe.prepare("INSERT INTO projects (id, key_prefix, name, next_ticket_seq, policy_json, policy_generation, created_at) VALUES ('proj:x','X','X',1,'{}',1,1)").run()
  probe.prepare(`INSERT INTO tickets (id, project_id, key, title, body, kind, priority, state_code, created_by, revision, policy_generation, created_at, updated_at, last_activity_at)
    VALUES ('t0','proj:x','X-1','t','','task',3,1,'prin:p1',1,1,1,1,1)`).run()
  assert.throws(() => probe.prepare("INSERT INTO comments (id, ticket_id, author_id, body, created_at) VALUES ('c0','t0','prin:p1','',1)").run(), /constraint/i)
  probe.close()
})

test('独立期望表：ticket-diff.json 预期值独立断言（不经共享推导件；127-B P2 修复 #2）', () => {
  const rawExp = JSON.parse(readFileSync(DEFAULT_EXPECTATIONS, 'utf8')) as {
    stateMatched: number
    stateExemptions: number
    idRoundtrip: boolean
    mapping: { externalRef: string; originalState: string; desiredStateCode: number; importedStateCode: number; stateMatched: boolean }[]
  }
  assert.equal(rawExp.mapping.length, 10)
  assert.equal(rawExp.stateMatched, 10)
  assert.equal(rawExp.stateExemptions, 0)
  assert.equal(rawExp.idRoundtrip, true)

  const rows = loadPhase0Export(DEFAULT_EXPORT).rows
  const plan = planOfRealExport()
  const byKey = new Map(plan.issues.map((e) => [e.target.ticket.key, e]))

  // 1) 快照重现：冻结 STATE_MAP 对 Phase0 记录的每个 originalState 给出与 desiredStateCode 相同的码
  let reproduced = 0
  const drifted: { ref: string; from: string; to: string }[] = []
  let liveChecked = 0
  for (const m of rawExp.mapping) {
    const mapped = STATE_MAP.find((r) => r.from === m.originalState)
    assert.ok(mapped !== undefined, `快照态 ${m.originalState} 必须在冻结映射表内`)
    assert.equal(mapped.to, m.desiredStateCode, `STATE_MAP["${m.originalState}"] 应重现 Phase0 desired=${String(m.desiredStateCode)}`)
    assert.equal(m.stateMatched, true)
    assert.equal(m.importedStateCode, m.desiredStateCode)
    reproduced += 1
    const row = rows.find((r) => r.issue === m.externalRef)
    assert.ok(row !== undefined, `期望行 ${m.externalRef} 应在当前导出内`)
    const entry = byKey.get(m.externalRef)
    assert.ok(entry !== undefined)
    if (row.state === m.originalState) {
      liveChecked += 1
      assert.equal(entry.target.ticket.stateCode, m.desiredStateCode, `${m.externalRef} 计划状态应=期望 desired`)
    } else {
      drifted.push({ ref: m.externalRef, from: m.originalState, to: row.state })
    }
  }
  assert.equal(reproduced, 10)
  assert.equal(liveChecked, 9, '非漂移行 9 单逐单对上期望状态码')
  // 2) 漂移显式：恰 1 单（studio-dev-1495 已交付→已派发），按当前导出映射 3，快照期望 6
  assert.deepEqual(drifted, [{ ref: 'studio-dev-1495', from: '已交付', to: '已派发' }])
  const driftEntry = byKey.get('studio-dev-1495')
  assert.equal(driftEntry?.target.ticket.stateCode, 3)
  assert.equal(driftEntry?.target.ticket.stateName, 'IN_PROGRESS')

  // 3) 工具结论与测试本地独立计算一致（工具不得给出另一套答案）
  const tool = runRehearsal()
  const exp = tool.report.expectations
  assert.ok(exp !== null)
  assert.equal(exp.snapshotReproduced, 10)
  assert.equal(exp.snapshotRows, 10)
  assert.equal(exp.liveMatched, 9)
  assert.equal(exp.liveRows, 9)
  assert.deepEqual(exp.failures, [])
  assert.equal(exp.drifted.length, 1)
  assert.equal(exp.drifted[0]?.issue, 'studio-dev-1495')
})

test('vendor 约束：长度/priority-requiresHuman/parent 深度全满足；违规插入被 DDL 拒绝', () => {
  assert.equal(MAX_PARENT_DEPTH, 3, 'vendor 冻结深度常量')
  const root = tempRoot()
  const dbPath = path.join(root, 'inspect.db')
  const r = run(REHEARSE, ['--db', dbPath, '--out', path.join(root, 'report.json')])
  assert.equal(r.status, 0, r.stderr)
  const report = JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8')) as {
    import: { vendorChecks: Record<string, { pass: boolean; min?: number; max?: number; violating?: number; limit?: number }> }
  }
  const vc = report.import.vendorChecks
  assert.equal(vc['titleLength']?.pass, true)
  assert.ok((vc['titleLength']?.max ?? 0) <= 512 && (vc['titleLength']?.min ?? 0) >= 1)
  assert.equal(vc['priorityRequiresHuman']?.pass, true)
  assert.equal(vc['priorityRequiresHuman']?.violating, 0)
  assert.equal(vc['parentDepth']?.pass, true)
  assert.equal(vc['parentDepth']?.max, 1, '真实 10 单全无父，深度 1')
  assert.equal(vc['parentDepth']?.limit, MAX_PARENT_DEPTH)
  assert.equal(vc['commentBodyBytes']?.pass, true)

  // 直接读库独立复核（不信工具自述）
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const titles = db.prepare('SELECT length(title) AS n FROM tickets').all() as { n: number }[]
  assert.ok(titles.every((t) => t.n >= 1 && t.n <= 512))
  const bad = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE priority <= 1 AND requires_human = 0').get() as { n: number }
  assert.equal(bad.n, 0, 'CHECK(priority>1 OR requires_human=1) 全行满足')
  const parents = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE parent_id IS NOT NULL').get() as { n: number }
  assert.equal(parents.n, 0)
  db.close()

  // 负探针：违规行确被 vendor DDL 拒（STRICT CHECK 不是摆设）
  const probe = createRehearsalDb(path.join(root, 'probe.db'))
  probe.prepare("INSERT INTO principals (id, kind, display_name, status, created_at) VALUES ('prin:p1','agent','p1','active',1)").run()
  probe.prepare("INSERT INTO projects (id, key_prefix, name, next_ticket_seq, policy_json, policy_generation, created_at) VALUES ('proj:x','X','X',1,'{}',1,1)").run()
  const base = `INSERT INTO tickets (id, project_id, key, title, body, kind, priority, state_code, created_by, revision, policy_generation, created_at, updated_at, last_activity_at) VALUES ('t1','proj:x','X-1'`
  assert.throws(() => probe.prepare(`${base},'','body','task',3,1,'prin:p1',1,1,1,1,1)`).run(), /constraint/i, '空标题被拒')
  assert.throws(() => probe.prepare(`${base},'${'x'.repeat(513)}','body','task',3,1,'prin:p1',1,1,1,1,1)`).run(), /constraint/i, '513B 标题被拒')
  assert.throws(() => probe.prepare(`${base},'ok','body','task',1,1,'prin:p1',1,1,1,1,1)`).run(), /constraint/i, 'priority=1 且 requires_human=0 被拒')
  assert.throws(() => probe.prepare(`${base},'ok','body','task',9,1,'prin:p1',1,1,1,1,1)`).run(), /constraint/i, 'state_code 越界被拒')
  assert.throws(() => probe.prepare(`${base},'ok','body','task',3,1,'prin:ghost',1,1,1,1,1)`).run(), /constraint/i, '未知 created_by 外键被拒')
  probe.close()

  // parent 深度（vendor 服务层 MAX_PARENT_DEPTH=3，DDL 无 CHECK）：计划/演练层显式拦截 4 级链
  const chained = path.join(root, 'export-deep-chain.json')
  const raw = JSON.parse(readFileSync(DEFAULT_EXPORT, 'utf8')) as { rows: Record<string, unknown>[] }
  const byRef = new Map(raw.rows.map((row) => [row['issue'] as string, row]))
  for (const [child, parent] of [['studio-dev-1487', 'studio-dev-1488'], ['studio-dev-1486', 'studio-dev-1487'], ['studio-dev-1488', 'studio-dev-1489'], ['studio-dev-1489', 'studio-dev-1490']] as const) {
    byRef.get(child)!['parent'] = parent
  }
  writeFileSync(chained, JSON.stringify(raw))
  const deepPlan = buildPlan(adaptPhase0Export(loadPhase0Export(chained)).fixture)
  assert.ok(deepPlan.gaps.some((g) => g.kind === 'parent-depth-exceeded' && g.issue === 'studio-dev#1486'))
  const deep = run(REHEARSE, ['--export', chained])
  assert.equal(deep.status, 1, '超深父链 → 显式失败')
  const deepReport = JSON.parse(deep.stdout) as { plan: { blockingGaps: { kind: string }[] }; import: { skipped: string } }
  assert.ok(deepReport.plan.blockingGaps.some((g) => g.kind === 'parent-depth-exceeded'))
  assert.match(deepReport.import.skipped, /vendor-blocking/)
})

test('回滚 SOP 干跑：7 步骤打印 + 证据件只读校验；不执行任何回滚动作', () => {
  assert.ok(artifactDir !== null, '依赖首个用例产出的 rehearse.json')
  const full = run(ROLLBACK, ['--artifacts', artifactDir as string])
  assert.equal(full.status, 0, full.stderr)
  assert.ok(full.stdout.includes('未执行任何回滚动作'), 'SOP 头部明示 dry-run 边界')
  for (let n = 1; n <= 7; n += 1) assert.ok(full.stdout.includes(`${String(n)}. `), `步骤 ${String(n)} 应打印`)
  assert.ok(full.stdout.includes('[PASS] snapshot'))
  assert.ok(full.stdout.includes('[PASS] diff'))
  assert.ok(full.stdout.includes('[PASS] artifacts:rehearse'), '演练证据件校验通过')
  const summary = JSON.parse(full.stdout.trim().split('\n').pop() as string) as { ok: boolean; dryRun: boolean; steps: number; checks: number; failed: number }
  assert.deepEqual(summary, { ok: true, dryRun: true, steps: 7, checks: 3, failed: 0 })

  // 库函数口径一致
  const viaFn = rollbackCli(['--artifacts', artifactDir as string])
  assert.equal(viaFn.code, 0)

  // 缺件：快照不存在 → FAIL + exit 1
  const missing = run(ROLLBACK, ['--snapshot', '/nonexistent/ticket-export.json'])
  assert.equal(missing.status, 1)
  assert.ok(missing.stdout.includes('[FAIL] snapshot'))
  // 缺件：artifacts 目录无 rehearse.json → FAIL + exit 1
  const emptyDir = tempRoot()
  const empty = run(ROLLBACK, ['--artifacts', emptyDir])
  assert.equal(empty.status, 1)
  assert.ok(empty.stdout.includes('[FAIL] artifacts:rehearse'))
})

test('用法面：未知参数/不可读文件 → exit 2', () => {
  assert.equal(run(REHEARSE, ['--export', '/nonexistent/export.json']).status, 2)
  assert.equal(run(REHEARSE, ['--bogus']).status, 2)
  assert.equal(run(ROLLBACK, ['--bogus']).status, 2)
  assert.equal(rehearseCli(['--help']).code, 0)
  // --skip-expectations：显式跳过期望表层（对账仍须 0 gap）
  const root = tempRoot()
  const skipped = run(REHEARSE, ['--skip-expectations', '--out', path.join(root, 'r.json')])
  assert.equal(skipped.status, 0, skipped.stderr)
  assert.equal(JSON.parse(readFileSync(path.join(root, 'r.json'), 'utf8')).expectations, null)
})
