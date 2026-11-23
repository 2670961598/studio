/**
 * model-eval-benchmark.test —— 业务向基准工具（node:test；零 dsh、零联网、零真实凭据）
 *
 * 依据：docs/quality/benchmark-business-eval.md §3（盲评）/ §4（指纹）/ §5（统计协议）。
 * 覆盖：失败分类 / 多批次合并与重试规则 / 区间 / 统计矩阵与结论闸 / 指纹 / 盲评包核心 /
 * 三个 CLI 的端到端（临时目录里的假报告，不起 dsh）。
 * 运行：node --test scripts/test/model-eval-benchmark.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { aggregateSheets, buildPlan, cohenKappa, leakScan, parseCsv, parseSheet, seededShuffle } from '../ops/model-eval/benchmark/lib/blind-core.mjs'
import { classifyRow, sideOf } from '../ops/model-eval/benchmark/lib/classify.mjs'
import { diffFingerprints, fingerprintEvalDir } from '../ops/model-eval/benchmark/lib/fingerprint-core.mjs'
import { excludesZero, median, percentileNearestRank, summarizeScores, tCritical } from '../ops/model-eval/benchmark/lib/interval.mjs'
import { applyBlind, applyJudge, buildStats } from '../ops/model-eval/benchmark/lib/matrix.mjs'
import { cellKey, mergeReports } from '../ops/model-eval/benchmark/lib/merge.mjs'

const HERE = dirname(new URL(import.meta.url).pathname)
const CLI = join(HERE, '..', 'ops', 'model-eval', 'benchmark')
const roots = []
const tmpRoot = (prefix = 'model-eval-bench-') => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  roots.push(d)
  return d
}
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const row = (model, task, rep, patch = {}) => ({
  model, task, taskSlug: `${task}-x`, rep, status: 'completed', ok: true, deterministicPass: true, deterministicScore: 1,
  failedChecks: [], checks: [{ id: 'c1', ok: true, required: true, weight: 1, detail: '' }], judgeScore: null,
  latencyMs: 1000, tokensTotal: 100, steps: 2, toolCalls: 1, errorClass: null, reason: null, outputPath: null,
  checkError: null, finalText: null, ...patch,
})
const failed = (model, task, rep, errorClass, reason = 'x') =>
  row(model, task, rep, { status: 'failed', ok: false, deterministicPass: null, deterministicScore: null, checks: [], errorClass, reason })
const report = (generatedAt, rows, availability = []) => ({
  schema: 'model-eval/v1', generatedAt, config: { reps: 2, timeoutMs: 300_000, judge: 'none' }, availability, rows, summary: {},
})

test('classifyRow：基准失败分类与归属', () => {
  assert.equal(classifyRow(row('m', 't01', 1)).cls, 'OK')
  const tf = classifyRow(row('m', 't01', 1, { deterministicPass: false, deterministicScore: 0.5, failedChecks: ['a'] }))
  assert.equal(tf.cls, 'TASK_FAIL')
  assert.equal(tf.score, 0.5)
  assert.equal(classifyRow(failed('m', 't01', 1, 'refusal')).side, 'model')
  assert.equal(classifyRow(failed('m', 't01', 1, 'blocked')).cls, 'SAFETY_REFUSAL')
  assert.equal(classifyRow(failed('m', 't01', 1, 'max_tokens')).cls, 'BUDGET')
  const to = classifyRow(failed('m', 't01', 1, 'timeout'))
  assert.equal(to.cls, 'LIMIT:timeout')
  assert.equal(to.side, 'facility')
  assert.equal(to.score, null)
  for (const ec of ['quota', 'rate_limit', 'server', 'network', 'auth']) {
    assert.equal(classifyRow(failed('m', 't01', 1, ec)).cls, `PROVIDER_ERROR:${ec}`)
  }
  assert.equal(classifyRow(failed('m', 't01', 1, 'harness')).side, 'harness')
  assert.equal(classifyRow(row('m', 't01', 1, { checkError: 'boom' })).cls, 'HARNESS_BUG')
  assert.equal(classifyRow(row('m', 't01', 1, { checks: [] })).cls, 'HARNESS_BUG')
  assert.equal(classifyRow(failed('m', 't01', 1, 'aborted')).triage, true)
  assert.equal(sideOf('PROVIDER_ERROR:quota'), 'facility')
})

test('mergeReports：先到先得、重试替换、超时转模型侧', () => {
  const r1 = report('2026-01-01T00:00:01Z', [
    failed('m', 't01', 1, 'server'), row('m', 't01', 2, { deterministicScore: 0.5, deterministicPass: false }),
    failed('m', 't02', 1, 'timeout'), failed('m', 't02', 2, 'timeout'), failed('m', 't03', 1, 'quota'),
  ])
  const r2 = report('2026-01-01T00:00:02Z', [
    row('m', 't01', 1), row('m', 't01', 2, { deterministicScore: 1 }), row('m', 't02', 1), row('m', 't03', 1, { deterministicScore: 1 }),
  ])
  const cells = mergeReports([r2, r1]) // 乱序输入也要按时间归位
  const by = (model, task, rep) => cells.find((c) => c.key === cellKey({ model, task, rep }))
  assert.equal(cells.length, 5) // 5 个格键；第二批没有新增格
  assert.equal(by('m', 't01', 1).final.cls, 'OK') // 设施侧失败被重跑的有效样本替换
  assert.equal(by('m', 't01', 1).retried, true)
  assert.equal(by('m', 't01', 2).final.score, 0.5) // 首个有效样本定稿，后来的 1 分不替换
  assert.equal(by('m', 't01', 2).extraRuns, 1)
  assert.equal(by('m', 't02', 1).final.cls, 'OK') // 两次超时后第三次有效 → 仍取有效样本
  const timeoutBatch = (at) => report(at, [failed('m', 't02', 1, 'timeout')])
  const onlyTimeouts = mergeReports([timeoutBatch('2026-01-01T00:00:00Z'), timeoutBatch('2026-01-01T00:00:01Z')])
  assert.equal(onlyTimeouts.length, 1)
  assert.equal(onlyTimeouts[0].final.cls, 'BUDGET:timeout') // 同格两批次都超时 → 模型侧，计 0
  assert.equal(onlyTimeouts[0].final.side, 'model')
  assert.equal(onlyTimeouts[0].final.score, 0)
  assert.equal(by('m', 't03', 1).final.cls, 'OK')
  const stillMissing = mergeReports([report('2026-01-01T00:00:00Z', [failed('m', 't03', 1, 'server')])])
  assert.equal(stillMissing[0].final.side, 'facility')
})

test('interval：n=0/1/2/3 的区间口径', () => {
  assert.equal(summarizeScores([]).mean, null)
  assert.deepEqual(summarizeScores([0.5]).ci95, { method: 'none', lo: null, hi: null })
  assert.deepEqual(summarizeScores([0.2, 0.8]).ci95, { method: 'range', lo: 0.2, hi: 0.8 })
  const three = summarizeScores([0.2, 0.8, 0.8])
  assert.equal(three.ci95.method, 't')
  assert.ok(three.ci95.lo < 0.2 && three.ci95.hi > 0.8)
  const flat = summarizeScores([0.5, 0.5, 0.5])
  const capped = summarizeScores([1, 1, 0.9], { lo: 0, hi: 1 })
  assert.deepEqual([capped.ci95.lo < 0.9, capped.ci95.hi], [true, 1]) // 端点截到分值范围
  assert.equal(summarizeScores([1, 1, 0.9]).ci95.hi > 1, true) // 不给范围就不截
  assert.deepEqual([flat.ci95.lo, flat.ci95.hi], [0.5, 0.5])
  assert.equal(tCritical(1).t, 12.706)
  assert.equal(tCritical(40).approximate, true)
  assert.equal(excludesZero({ lo: 0.5, hi: 0.5 }), true)
  assert.equal(excludesZero({ lo: -0.1, hi: 0.3 }), false)
  assert.equal(excludesZero(null), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9)
})

test('buildStats：覆盖 / 两种口径 / 配对判读 / 结论闸 / 折分', () => {
  const mk = (model, base, patch = (t, r) => ({})) => [
    1, 2].flatMap((r) => ['t01', 't02', 't03'].map((t) => row(model, t, r, { deterministicScore: base, ...patch(t, r) })))
  const reports = [
    report('2026-01-01T00:00:00Z', [
      ...mk('a', 1), ...mk('b', 0.5, (t, r) => (t === 't02' && r === 2 ? { status: 'failed', ok: false, deterministicPass: null, deterministicScore: null, checks: [], errorClass: 'server', reason: '529' } : {})),
    ]),
  ]
  const cells = mergeReports(reports)
  const s = buildStats(reports, cells)
  const cov = (m) => s.coverage.find((c) => c.model === m)
  assert.equal(cov('a').valid, 6)
  assert.equal(cov('b').valid, 5)
  assert.equal(cov('b').missing, 1)
  const bm = (m) => s.byModel.find((x) => x.model === m)
  assert.equal(bm('b').mean, 0.5) // 能力口径：缺格不计
  assert.equal(bm('b').meanAvailabilityView < 0.5, true) // 可用性口径：缺格按 0
  assert.deepEqual(s.sharedTasks, ['t01', 't02', 't03'])
  assert.equal(s.pairs.length, 1)
  assert.equal(s.pairs[0].verdict, 'insufficient') // reps=2 → 冒烟不下结论
  assert.equal(s.decision.level, 'smoke')
  assert.equal(s.decision.conclusionAllowed, false)
  const formal = buildStats(reports, cells, { formalReps: 2 })
  assert.equal(formal.decision.level, 'formal')
  assert.equal(formal.pairs[0].verdict, 'insufficient') // b×t02 只有 1 个有效格 → 该对仍不足
  const fullReport = report('2026-01-01T00:00:00Z', [...mk('a', 1), ...mk('b', 0.5)])
  const full = buildStats([fullReport], mergeReports([fullReport]), { formalReps: 2 })
  assert.equal(full.pairs[0].verdict, 'distinguishable') // 配对差恒为 0.5，区间不含 0
  assert.equal(full.decision.conclusionAllowed, true)
  const noJudge = mergeReports(reports)
  assert.equal(applyBlind(noJudge, [{ model: 'a', task: 't01', rep: 1, total: 6 }]), 1)
  assert.equal(noJudge.find((c) => c.key === cellKey({ model: 'a', task: 't01', rep: 1 })).final.scoreFinal, 0.85) // 0.7 + 0.3×6/12
  const judged = mergeReports([report('2026-01-01T00:00:00Z', [
    row('a', 't01', 1, { judgeScore: 8 }), row('a', 't01', 2, { judgeScore: 8, judgeSelf: true }),
  ])])
  assert.equal(applyJudge(judged), 1) // 同源自评不折
  assert.equal(judged[0].final.scoreFinal, 0.94) // 0.7 + 0.3×8/10
  assert.equal(judged[1].final.scoreFinal, undefined)
  const refused = buildStats([report('2026-01-01T00:00:00Z', [...mk('a', 1), ...[1, 2].flatMap((r) => ['t01', 't02', 't03'].map((t) => failed('b', t, r, 'refusal')))])], mergeReports([report('2026-01-01T00:00:00Z', [...mk('a', 1), ...[1, 2].flatMap((r) => ['t01', 't02', 't03'].map((t) => failed('b', t, r, 'refusal')))])]), { formalReps: 2 })
  assert.equal(refused.decision.missingRatio, 0) // 模型侧拒答不是设施缺格
  assert.equal(refused.byModel.find((x) => x.model === 'b').mean, 0)
})

test('fingerprint：稳定、敏感于任务书字节、排除分析工具自身', () => {
  const evalDir = tmpRoot('model-eval-fp-')
  const task = join(evalDir, 'tasks', 't99-demo')
  mkdirSync(join(task, 'fixtures'), { recursive: true })
  mkdirSync(join(evalDir, 'lib'))
  mkdirSync(join(evalDir, 'benchmark'))
  writeFileSync(join(task, 'prompt.md'), '任务\n{{include:fixtures/a.md}}\n')
  writeFileSync(join(task, 'fixtures', 'a.md'), '材料一\n')
  writeFileSync(join(task, 'check.mjs'), 'export const check = () => []\n')
  writeFileSync(join(evalDir, 'lib', 'x.mjs'), 'export default 1\n')
  writeFileSync(join(evalDir, 'benchmark', 'tool.mjs'), 'export default 2\n')
  const a = fingerprintEvalDir(evalDir)
  assert.deepEqual(diffFingerprints(a, fingerprintEvalDir(evalDir)), [])
  assert.equal(a.harness.fileCount, 1)
  assert.equal(a.tasks.t99.fileCount, 3)
  assert.equal(JSON.stringify(a).includes(evalDir), false) // 不含绝对路径
  writeFileSync(join(task, 'fixtures', 'a.md'), '材料二\n')
  const b = fingerprintEvalDir(evalDir)
  assert.equal(b.tasks.t99.prompt, a.tasks.t99.prompt) // 原件没变
  assert.notEqual(b.tasks.t99.promptRendered, a.tasks.t99.promptRendered) // 模型实际看到的字节变了
  assert.match(diffFingerprints(a, b).join('；'), /t99：任务书（渲染后） \/ fixtures变了/)
  writeFileSync(join(evalDir, 'benchmark', 'tool.mjs'), 'export default 3\n')
  assert.equal(fingerprintEvalDir(evalDir).all.sha256, b.all.sha256) // 分析工具不入指纹
  assert.match(diffFingerprints(a, { tasks: {} }).join('；'), /harness/)
})

test('blind-core：洗牌 / 评分表 / 汇总 / 一致性 / 泄漏扫描', () => {
  const items = Array.from({ length: 20 }, (_, i) => i)
  const s1 = seededShuffle(items, 7)
  assert.deepEqual(s1, seededShuffle(items, 7)) // 同种子同输入 → 同顺序
  assert.notDeepEqual(s1, seededShuffle(items, 8)) // 换种子 → 换顺序
  assert.deepEqual([...s1].sort((a, b) => a - b), items) // 是排列：不丢不重
  const cells = mergeReports([report('2026-01-01T00:00:00Z', [row('a', 't01', 1), failed('a', 't01', 2, 'refusal'), row('b', 't01', 1)])])
  const plan = buildPlan(cells, { seed: 's1' })
  assert.deepEqual(plan.map((p) => p.anon), ['S-001', 'S-002']) // 模型侧失败格无产物，不入包
  assert.equal(cells.find((c) => c.key === 'a|t01|2').final.cls, 'SAFETY_REFUSAL')
  assert.deepEqual(buildPlan(cells, { seed: 's1' }), plan) // 可复现
  assert.deepEqual(plan.map((p) => p.model).sort(), ['a', 'b'])
  assert.deepEqual(parseCsv('a,"b,c"\n"d\ne",f'), [['a', 'b,c'], ['d\ne', 'f']])
  assert.throws(() => parseCsv('"abc'), /引号未闭合/)
  const sheet = parseSheet('item,correctness,completeness,compliance,clarity,confidence,notes,reviewer\nS-001,3,2,3,1,高,"含,逗号",甲\nS-002,9,2,2,2,,甲\nS-003,1,1,1,,甲\nS-004,1,1,1,1,1\nbad,1,1,1,1,甲\n')
  assert.equal(sheet.rows.length, 2)
  assert.equal(sheet.rows[0].total, 9)
  assert.equal(sheet.rows[0].notes, '含,逗号')
  assert.equal(sheet.errors.length, 3) // 越界分值 / 缺列值 / 编号非法各一行被剔除
  const agg = aggregateSheets([
    { reviewer: '甲', rows: [{ item: 'S-001', reviewer: '甲', dims: { correctness: 3, completeness: 3, compliance: 3, clarity: 3 }, total: 12 }, { item: 'S-002', reviewer: '甲', dims: { correctness: 2, completeness: 2, compliance: 2, clarity: 2 }, total: 8 }] },
    { reviewer: '乙', rows: [{ item: 'S-001', reviewer: '乙', dims: { correctness: 3, completeness: 3, compliance: 3, clarity: 2 }, total: 11 }, { item: 'S-002', reviewer: '乙', dims: { correctness: 1, completeness: 1, compliance: 1, clarity: 1 }, total: 4 }] },
  ], plan)
  const byAnon = Object.fromEntries(agg.items.map((i) => [i.anon, i]))
  assert.equal(byAnon['S-001'].total, 11.5) // 跨评审均值：12 与 11
  assert.equal(byAnon['S-001'].spread, 1)
  assert.equal(byAnon['S-002'].total, 6) // 8 与 4
  assert.equal(agg.singleReviewer, false)
  // 一致性：2 条共同条目；完全一致 0；|Δ|≤1 占一半；三档 κ=(0.5−0.25)/(1−0.25)
  assert.deepEqual([agg.agreement[0].n, agg.agreement[0].exact, agg.agreement[0].within1, agg.agreement[0].kappa3], [2, 0, 0.5, 0.3333])
  assert.equal(agg.adjudication.includes('S-002'), true) // 8 vs 4 → 极差 4 > 2
  assert.equal(cohenKappa([['high', 'high'], ['low', 'low']]), 1)
  assert.equal(cohenKappa([]), null)
  assert.equal(aggregateSheets([{ reviewer: '甲', rows: [] }], plan).singleReviewer, true)
  assert.deepEqual(leakScan('我是 GLM-5.4，不是 kimi'), [{ brand: 'GLM', count: 1 }, { brand: 'Kimi', count: 1 }])
  assert.deepEqual(leakScan('无品牌'), [])
})

function writeEvalFixture(dir) {
  const task = join(dir, 'tasks', 't01-demo')
  mkdirSync(join(task, 'fixtures', 'fixtures'), { recursive: true })
  writeFileSync(join(task, 'prompt.md'), '请写 REPORT.md\n')
  writeFileSync(join(task, 'fixtures', 'fixtures', 'input.md'), '# 输入\n路由 kimi-coding/k3.1-pro\n') // 模型读到的输入里有品牌词
  writeFileSync(join(task, 'check.mjs'), 'export const rubric = "要点"; export const check = () => []\n')
  return task
}

test('CLI 端到端：假报告 → stats / fingerprint / blind build+aggregate → 折分', () => {
  const root = tmpRoot('model-eval-e2e-')
  const evalDir = join(root, 'eval')
  const task = writeEvalFixture(evalDir)
  const work = (model, rep) => {
    const dir = join(root, 'work', `${model}__t01__r${rep}`)
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'fixtures'), { recursive: true })
    writeFileSync(join(dir, 'fixtures', 'input.md'), '# 输入\n')
    writeFileSync(join(dir, 'REPORT.md'), `# 报告\n模型 ${model} rep ${rep}\n依据 kimi 路由；由 GLM-5.4 撰写\n`) // GLM 不在输入里 = 可疑自报
    return dir
  }
  const rows = [1, 2].flatMap((rep) => ['m-a', 'm-b'].map((m) => row(m, 't01', rep, { taskSlug: 't01-demo', outputPath: work(m, rep), finalText: '完成' })))
  const runDir = join(root, 'run1')
  mkdirSync(runDir)
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report('2026-01-01T00:00:00Z', rows)))
  const run = (script, args) => spawnSync(process.execPath, [join(CLI, script), ...args], { encoding: 'utf8' })

  const fp = run('fingerprint.mjs', ['--eval-dir', evalDir, '--json'])
  assert.equal(fp.status, 0, fp.stderr)
  assert.equal(JSON.parse(fp.stdout).schema, 'model-eval-fingerprint/v1')
  writeFileSync(join(runDir, 'fingerprint.json'), fp.stdout)

  const bad = run('stats.mjs', [])
  assert.equal(bad.status, 2)
  const inRepo = run('stats.mjs', ['--reports', runDir, '--out', join(HERE, 'x-stats')])
  assert.equal(inRepo.status, 2)
  const st = run('stats.mjs', ['--reports', runDir, '--out', join(root, 'stats'), '--eval-dir', evalDir, '--fingerprint', join(runDir, 'fingerprint.json')])
  assert.equal(st.status, 0, st.stderr)
  const last = JSON.parse(st.stdout.trim().split('\n').pop())
  assert.equal(last.cells, 4)
  assert.equal(last.valid, 4)
  assert.equal(last.consistent, true)
  const stats = JSON.parse(readFileSync(join(root, 'stats', 'stats.json'), 'utf8'))
  assert.equal(stats.byModel.length, 2)
  assert.equal(stats.decision.level, 'smoke')
  assert.match(readFileSync(join(root, 'stats', 'stats.md'), 'utf8'), /配对比较/)

  const bl = run('blind.mjs', ['build', '--reports', runDir, '--out', join(root, 'blind'), '--eval-dir', evalDir, '--seed', '42', '--with-final-text'])
  assert.equal(bl.status, 0, bl.stderr)
  const mapping = JSON.parse(readFileSync(join(root, 'blind', 'mapping.json'), 'utf8'))
  assert.equal(Object.keys(mapping.items).length, 4)
  assert.equal(JSON.stringify(mapping).includes(root), false) // 钥匙不含绝对路径
  const anon = Object.keys(mapping.items)[0]
  assert.equal(readFileSync(join(root, 'blind', 'items', anon, 'TASK.md'), 'utf8'), '请写 REPORT.md\n')
  const leak = JSON.parse(readFileSync(join(root, 'blind', 'leak-scan.json'), 'utf8'))
  assert.equal(leak.scanned, 4)
  assert.equal(leak.suspicious, 4) // 「GLM」不在任务书 + fixtures 里；复述输入里的「kimi」不算泄漏
  assert.deepEqual(leak.items[0].hits.map((h) => [h.brand, h.inTask > 0]), [['GLM', false], ['Kimi', true]])
  assert.match(readFileSync(join(root, 'blind', 'items', anon, 'output', 'REPORT.md'), 'utf8'), /^# 报告\n/)
  const again = run('blind.mjs', ['build', '--reports', runDir, '--out', join(root, 'blind2'), '--eval-dir', evalDir, '--seed', '42', '--with-final-text'])
  assert.equal(again.status, 0, again.stderr)
  const mapping2 = JSON.parse(readFileSync(join(root, 'blind2', 'mapping.json'), 'utf8'))
  delete mapping.created
  delete mapping2.created
  assert.deepEqual(mapping2, mapping) // 同种子 → 同包（可复现）
  const scores = [0, 1].map((r) => Object.keys(mapping.items).map((anon) => `${anon},${3 - r},2,2,3,高,,评审${r}`).join('\n')).join('\n')
  const sheet = join(root, 'sheet.csv')
  writeFileSync(sheet, `item,correctness,completeness,compliance,clarity,confidence,notes,reviewer\n${scores}\n`)
  const ag = run('blind.mjs', ['aggregate', '--package', join(root, 'blind'), '--scores', sheet])
  assert.equal(ag.status, 0, ag.stderr)
  const result = JSON.parse(readFileSync(join(root, 'blind', 'result', 'blind-result.json'), 'utf8'))
  assert.equal(result.reviewers.length, 2)
  assert.equal(result.adjudication.length, 0) // 总分 10 vs 9，极差 1
  const fold = run('stats.mjs', ['--reports', runDir, '--out', join(root, 'stats-blind'), '--blind', join(root, 'blind', 'result', 'blind-result.json')])
  assert.equal(fold.status, 0, fold.stderr)
  const folded = JSON.parse(readFileSync(join(root, 'stats-blind', 'stats.json'), 'utf8'))
  assert.equal(folded.scoring.folded, 4)
  assert.equal(folded.scoring.mode, 'det+blind')
  assert.ok(folded.cells.every((c) => c.final.scoreFinal > 0.9)) // 0.7 + 0.3×(9.5/12)
  assert.equal(task.startsWith(evalDir), true)
})
