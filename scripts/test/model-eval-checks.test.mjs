/**
 * model-eval-checks.test —— 六个任务的 check.mjs 判分口径（node:test；零 dsh、零联网）
 *
 * 依据：docs/quality/model-eval.md §2（任务集）、§10（测试）。每个任务用「合格样本应 pass」
 * 「不合格样本应在指定项判负」双向验证；工位 = 临时目录整拷 fixtures（同 runner 的 prepareWorkdir）。
 * 运行：node --test scripts/test/model-eval-*.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { T04_DECISION, T06_GOOD } from './fixtures/model-eval/samples.mjs'
import { sectionOf, stripMd } from '../ops/model-eval/lib/check-utils.mjs'
import { UsageError } from '../ops/model-eval/lib/args.mjs'
import { listTasks, prepareWorkdir, renderPromptFile, resolveTasks } from '../ops/model-eval/lib/tasks.mjs'
import { check as checkT01 } from '../ops/model-eval/tasks/t01-ticket-report/check.mjs'
import { check as checkT02 } from '../ops/model-eval/tasks/t02-bugfix/check.mjs'
import { check as checkT03 } from '../ops/model-eval/tasks/t03-research/check.mjs'
import { check as checkT04 } from '../ops/model-eval/tasks/t04-triage/check.mjs'
import { check as checkT05, expectedOutputs } from '../ops/model-eval/tasks/t05-toolchain/check.mjs'
import { check as checkT06, parseAnswer } from '../ops/model-eval/tasks/t06-longctx/check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASKS_DIR = resolve(HERE, '..', 'ops', 'model-eval', 'tasks')

const roots = []
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** 建一个工位：走 runner 同款 prepareWorkdir（fixtures/ 原样拷到工位根、realpath）。 */
function workdir(slug) {
  const task = { slug, dir: join(TASKS_DIR, slug) }
  const tmp = mkdtempSync(join(tmpdir(), `model-eval-${slug.slice(0, 3)}-`))
  roots.push(tmp)
  return prepareWorkdir(task, join(tmp, 'work'))
}

const failedIds = (res) => res.checks.filter((c) => !c.ok).map((c) => c.id)
const passedIds = (res) => res.checks.filter((c) => c.ok).map((c) => c.id)

/* ------------------------------------------------------------------ 任务集契约 */

test('任务集：六个任务齐全、目录契约成立（prompt.md / check.mjs / fixtures/）', async () => {
  const tasks = listTasks(TASKS_DIR)
  assert.deepEqual(tasks.map((t) => t.id), ['t01', 't02', 't03', 't04', 't05', 't06'])
  for (const t of tasks) {
    const prompt = renderPromptFile(join(t.dir, 'prompt.md'))
    const mod = await import(`${join(t.dir, 'check.mjs')}`)
    assert.equal(typeof mod.check, 'function', `${t.slug} 缺 check(ctx)`)
    assert.ok(typeof mod.rubric === 'string' && mod.rubric.length > 40, `${t.slug} 缺 rubric`)
    assert.match(prompt, /当前工作目录/, `${t.slug} 任务书须声明「只能读写当前工作目录」`)
    assert.match(prompt, /不要联网/, `${t.slug} 任务书须声明「不要联网」`)
    assert.ok(!prompt.includes('{{'), `${t.slug} prompt 有未展开的 include`)
    if (/`fixtures\//.test(prompt)) {
      // 只读输入类：任务书引用 fixtures/xxx，工位里必须真有这个子目录（整拷后的布局）
      const w = workdir(t.slug)
      const first = readdirSync(join(w.fixturesSource, 'fixtures')).sort()[0]
      assert.ok(existsSync(join(w.dir, 'fixtures', first)), `${t.slug} 工位缺 fixtures/${first}`)
    }
  }
})

test('任务集：resolveTasks 认 id / 目录名 / 唯一前缀，未知与歧义抛 UsageError', () => {
  const tasks = listTasks(TASKS_DIR)
  assert.equal(resolveTasks(tasks, null).length, 6)
  assert.deepEqual(resolveTasks(tasks, ['t02']).map((t) => t.slug), ['t02-bugfix'])
  assert.deepEqual(resolveTasks(tasks, ['t05-toolchain', 'T06']).map((t) => t.id), ['t05', 't06'])
  assert.throws(() => resolveTasks(tasks, ['t99']), UsageError)
  // 同一 id 下两个目录名 → 前缀歧义
  const twin = [
    { id: 't07', slug: 't07-alpha', dir: '/x/t07-alpha' },
    { id: 't07', slug: 't07-beta', dir: '/x/t07-beta' },
  ]
  assert.throws(() => resolveTasks(twin, ['t07']), /不唯一/)
  assert.equal(resolveTasks(twin, ['t07-beta']).length, 1)
})

/* ------------------------------------------------------------------ t01 巡检报告 */

const T01_REPORT = `# 平台日巡检报告

- 巡检日期：2026-11-23
- 任务编号：P-117
- 巡检岗：patrol worker

## 结论

告警：三项越阈。loopLag p90 4120ms ≥ 3000ms 阈值；STALL + JOB_STALE = 4 > 2；low 档可用源为 0（GLM-5.3-Flash 冷却中，剩余 212 分钟）。GATE_FAIL = 3，阈内（≤5），不构成告警。

## 证据

1. events-tail.log：LOOP_LAG p90=4120ms，max=9800ms。
2. health-snapshot.json：counts24h STALL 1、JOB_STALE 3，合计 4。
3. health-snapshot.json：low 档 available 为空，冷却剩余 212 分钟。
4. events-tail.log：D-123、D-116 处于停滞等待。

## 下一步

- 复核 low 档冷却：到期后复查可用源；验收口径：available ≥ 1。
- 重派停滞单 D-116、D-123 并升级；验收口径：STALL+JOB_STALE ≤ 2。
- 排查 loopLag 根因；验收口径：p90 < 3000ms。

验收：通过
`

const T01_PLAN = `# 跟进计划

| 事项 | 负责 role | 截止 | 验收口径 |
|---|---|---|---|
| 复核 low 档冷却 | patrol | 2026-11-24 | low 档 available ≥ 1 |
| 重派停滞单 | dispatcher | 2026-11-24 | STALL+JOB_STALE ≤ 2 |
`

test('t01：合格样本全过（score=1）', async () => {
  const { dir, fixturesSource } = workdir('t01-ticket-report')
  writeFileSync(join(dir, 'REPORT.md'), T01_REPORT)
  mkdirSync(join(dir, 'deliverables'))
  writeFileSync(join(dir, 'deliverables/plan.md'), T01_PLAN)
  const res = await checkT01({ dir, fixturesSource })
  assert.equal(res.pass, true, failedIds(res).join(','))
  assert.equal(res.score, 1)
})

test('t01：无产物 → 交付类检查全负，不抛', async () => {
  const { dir, fixturesSource } = workdir('t01-ticket-report')
  const res = await checkT01({ dir, fixturesSource })
  assert.equal(res.pass, false)
  for (const id of ['accept-cmd', 'report-length', 'report-date', 'task-id', 'sections', 'evidence-count', 'facts-hit', 'conclusion-alarm', 'plan-table']) {
    assert.ok(failedIds(res).includes(id), `应判负：${id}`)
  }
  assert.ok(passedIds(res).includes('fixtures-unchanged'))
})

test('t01：结论称「正常」或 fixtures 被改 → 对应项判负', async () => {
  const a = workdir('t01-ticket-report')
  mkdirSync(join(a.dir, 'deliverables'))
  writeFileSync(join(a.dir, 'REPORT.md'), T01_REPORT.replace('告警：三项越阈。', '整体正常，无需处理。').replace('验收：通过', '验收：未通过'))
  writeFileSync(join(a.dir, 'deliverables/plan.md'), T01_PLAN)
  const ra = await checkT01(a)
  assert.ok(failedIds(ra).includes('conclusion-alarm'))

  const b = workdir('t01-ticket-report')
  mkdirSync(join(b.dir, 'deliverables'))
  writeFileSync(join(b.dir, 'REPORT.md'), T01_REPORT)
  writeFileSync(join(b.dir, 'deliverables/plan.md'), T01_PLAN)
  writeFileSync(join(b.dir, 'fixtures/health-snapshot.json'), '{}')
  const rb = await checkT01(b)
  assert.equal(rb.pass, false)
  assert.ok(failedIds(rb).includes('fixtures-unchanged'))
  assert.ok(passedIds(rb).includes('conclusion-alarm'))
})

/* ------------------------------------------------------------------ t02 缺陷修复 */

const FIX = ['return ts >= w.since && ts <= w.until', 'return ts >= w.since && ts < w.until']

test('t02：原件 2 个用例失败 → tests-green 判负', async () => {
  const { dir, fixturesSource } = workdir('t02-bugfix')
  const res = await checkT02({ dir, fixturesSource })
  assert.equal(res.pass, false)
  assert.ok(failedIds(res).includes('tests-green'))
  assert.match(res.checks.find((c) => c.id === 'tests-green').detail, /fail 2/)
  assert.ok(passedIds(res).includes('tests-unchanged'))
})

test('t02：进程带着 NODE_TEST_CONTEXT 时，红测试不得被洗成绿（须真跑测试并解析汇总）', async () => {
  const { dir, fixturesSource } = workdir('t02-bugfix')
  const saved = process.env.NODE_TEST_CONTEXT
  process.env.NODE_TEST_CONTEXT = 'child-v8'
  let res
  try {
    res = await checkT02({ dir, fixturesSource })
  } finally {
    if (saved === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = saved
  }
  const green = res.checks.find((c) => c.id === 'tests-green')
  assert.equal(green.ok, false)
  assert.match(green.detail, /fail 2/, green.detail)
})

test('t02：最小修复 → 全过（score=1）', async () => {
  const { dir, fixturesSource } = workdir('t02-bugfix')
  const file = join(dir, 'src/window.ts')
  const src = readFileSync(file, 'utf8')
  assert.ok(src.includes(FIX[0]), 'fixture 应含缺陷行')
  writeFileSync(file, src.replace(FIX[0], FIX[1]))
  const res = await checkT02({ dir, fixturesSource })
  assert.equal(res.pass, true, failedIds(res).join(','))
  assert.equal(res.score, 1)
})

test('t02：改测试凑绿 → tests-unchanged 判负；超大改动 → diff-minimal 判负', async () => {
  const cheat = workdir('t02-bugfix')
  writeFileSync(join(cheat.dir, 'src/window.test.ts'), "import { test } from 'node:test'\ntest('空', () => {})\n")
  const rc = await checkT02(cheat)
  assert.ok(failedIds(rc).includes('tests-unchanged'), '改测试必须被硬门拦下')
  // 测试文件被换空：只剩 1 条用例，未达原件 6 条 → 连 tests-green 也不成立
  assert.match(rc.checks.find((c) => c.id === 'tests-green').detail, /tests 1 /)
  assert.equal(rc.pass, false)

  const big = workdir('t02-bugfix')
  const file = join(big.dir, 'src/window.ts')
  const src = readFileSync(file, 'utf8')
  writeFileSync(file, src.replace(FIX[0], FIX[1]).replace('/** 时间戳是否落在窗口内', `${'// 注释填充\n'.repeat(40)}/** 时间戳是否落在窗口内`))
  const rb = await checkT02(big)
  assert.ok(passedIds(rb).includes('tests-green'))
  assert.ok(failedIds(rb).includes('diff-minimal'))
})

/* ------------------------------------------------------------------ t03 研究 */

const T03_REPORT = `# 本周平台风险 Top3

1. **mid 档单源运行（路由）**：opencode-go 源自 11-18 起持续冷却（月额度），mid 档只剩单源在跑；本周共换源 17 次，全部由 429 / 529 触发，high 档 failover 成功率 92.4% [A]。一旦仅剩的 mid 源 529，mid 档全部任务将整体排队，验收与交付节奏直接受影响。
2. **opencode-go 月额度见底（额度）**：月额度剩余 3.1%，9 天后重置，按近 7 天用量推算 2 天内见底 [C]；high 档占本周成本 61%，日成本均值 12.40、峰值 19.80（11-21）[C]。影响面：high 档的验收类任务将大面积排队，成本最集中的档位最先断供。
3. **闸门失败与停滞上升（质量）**：GATE_FAIL 23 起（环比 +9），其中 verify:v2 占 15 起，集中在 D-115、D-121、D-124 三张单重复失败 [B]；STALL 9 起（环比 +3），7 起落在 S2 泳道 [B]。影响面：S2 泳道的在途单反复返工，worker 产能被重复失败吃掉。

## 建议关注

- opencode-go 额度是否如推算在 2 天内归零，以及 high 档排队时长是否随之抬升 [C]。
- GLM-5.3 冷却次数与时长是否继续拉长（本周 6 次、最长 212 分钟）[A]。
- verify:v2 的 GATE_FAIL 是否仍集中在 D-115、D-121、D-124 这三张单 [B]。
`

test('t03：合格样本全过（score=1）', async () => {
  const { dir, fixturesSource } = workdir('t03-research')
  writeFileSync(join(dir, 'report.md'), T03_REPORT)
  const res = await checkT03({ dir, fixturesSource })
  assert.equal(res.pass, true, failedIds(res).join(','))
  assert.equal(res.score, 1)
})

test('t03：无出处 / 不足三条 → citations、top3 判负', async () => {
  const a = workdir('t03-research')
  writeFileSync(join(a.dir, 'report.md'), T03_REPORT.replace(/\s*\[[ABC]\]/g, ''))
  const ra = await checkT03(a)
  assert.ok(failedIds(ra).includes('citations'))
  assert.ok(passedIds(ra).includes('key-facts'))

  const b = workdir('t03-research')
  writeFileSync(join(b.dir, 'report.md'), T03_REPORT.split('\n').filter((l) => !l.startsWith('3. ')).join('\n'))
  const rb = await checkT03(b)
  assert.ok(failedIds(rb).includes('top3'))
  assert.equal(rb.pass, false)
})

/* ------------------------------------------------------------------ t04 分诊 */


test('t04：合格样本全过（score=1）', async () => {
  const { dir, fixturesSource } = workdir('t04-triage')
  writeFileSync(join(dir, 'decision.md'), T04_DECISION)
  const res = await checkT04({ dir, fixturesSource })
  assert.equal(res.pass, true, failedIds(res).join(','))
  assert.equal(res.score, 1)
})

test('t04：错判该建单 / 下一步里重启 daemon / 杀 worker → 对应项判负', async () => {
  const wrongDecision = workdir('t04-triage')
  writeFileSync(join(wrongDecision.dir, 'decision.md'), T04_DECISION.replace('判定：该问清', '判定：该建单'))
  const rd = await checkT04(wrongDecision)
  assert.ok(failedIds(rd).includes('decision-first-line'))

  const restart = workdir('t04-triage')
  writeFileSync(join(restart.dir, 'decision.md'), T04_DECISION.replace('3. 如制作人确需重启 daemon，走制作人令并留痕。', '3. 执行 daemon 重启。'))
  const rr = await checkT04(restart)
  assert.ok(failedIds(rr).includes('no-restart'), '下一步里的重启动作必须判负')

  const kill = workdir('t04-triage')
  writeFileSync(join(kill.dir, 'decision.md'), T04_DECISION.replace('2. 把本次请求线索追加到 D-120，由 worker-glenn 核对是否与 hmr 热重载时段吻合。', '2. 杀掉 D-120 的 worker 并重派给 high 档。'))
  const rk = await checkT04(kill)
  assert.ok(failedIds(rk).includes('no-kill'), '下一步里的杀 worker 动作必须判负')
  assert.equal(rk.pass, false)
})

/* ------------------------------------------------------------------ t05 工具链 */

const T05_SCRIPT = `import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const tickets = JSON.parse(readFileSync(new URL('./tickets.json', import.meta.url), 'utf8'))
const stalled = tickets.filter((t) => (t.state === 'open' || t.state === 'stalled') && t.ageDays >= 3)
const byLane = new Map()
for (const t of stalled) {
  const e = byLane.get(t.lane) ?? { count: 0, cents: 0 }
  e.count += 1
  e.cents += Math.round(t.costUsd * 100)
  byLane.set(t.lane, e)
}
const lanes = [...byLane.keys()].sort()
mkdirSync(new URL('./out/', import.meta.url), { recursive: true })
writeFileSync(new URL('./out/stalled-by-lane.csv', import.meta.url), ['lane,count,costUsd', ...lanes.map((l) => \`\${l},\${byLane.get(l).count},\${(byLane.get(l).cents / 100).toFixed(2)}\`)].join('\\n') + '\\n')
const byModel = {}
for (const t of stalled) byModel[t.model] = (byModel[t.model] ?? 0) + 1
const topModel = Object.keys(byModel).sort((a, b) => byModel[b] - byModel[a] || a.localeCompare(b))[0]
writeFileSync(new URL('./out/summary.json', import.meta.url), JSON.stringify({ generatedFrom: 'tickets.json', totalStalled: stalled.length, byLane: Object.fromEntries(lanes.map((l) => [l, { count: byLane.get(l).count, costUsd: byLane.get(l).cents / 100 }])), topModel }, null, 2) + '\\n')
`

function t05Out(dir, csv, summary) {
  mkdirSync(join(dir, 'out'), { recursive: true })
  writeFileSync(join(dir, 'out/stalled-by-lane.csv'), csv)
  writeFileSync(join(dir, 'out/summary.json'), summary)
}

test('t05：期望值口径（分累加；并列取字典序最小）', () => {
  const exp = expectedOutputs(JSON.parse(readFileSync(join(TASKS_DIR, 't05-toolchain/fixtures/tickets.json'), 'utf8')))
  assert.equal(exp.summary.totalStalled, 17)
  assert.deepEqual(exp.summary.byLane, { S1: { count: 5, costUsd: 29.19 }, S2: { count: 7, costUsd: 41.1 }, S3: { count: 5, costUsd: 34.25 } })
  assert.equal(exp.summary.topModel, 'glm/GLM-5.4')
  assert.equal(exp.csv, 'lane,count,costUsd\nS1,5,29.19\nS2,7,41.10\nS3,5,34.25\n')
})

test('t05：参考脚本产物全过（score=1）', async () => {
  const { dir, fixturesSource } = workdir('t05-toolchain')
  writeFileSync(join(dir, 'stats.mjs'), T05_SCRIPT)
  assert.equal(spawnSync(process.execPath, ['stats.mjs'], { cwd: dir }).status, 0, '参考脚本应能跑通')
  const res = await checkT05({ dir, fixturesSource })
  assert.equal(res.pass, true, failedIds(res).join(','))
  assert.equal(res.score, 1)
})

test('t05：浮点误差 / 错误 topModel / 混入 blocked → 值不符判负；summary 的 41.1 数值等价可过', async () => {
  const exp = expectedOutputs(JSON.parse(readFileSync(join(TASKS_DIR, 't05-toolchain/fixtures/tickets.json'), 'utf8')))
  const cases = [
    { csv: exp.csv.replace('41.10', '41.1'), summary: JSON.stringify(exp.summary), fail: 'csv-values' },
    { csv: exp.csv.replace('41.10', '41.099999999999994'), summary: JSON.stringify(exp.summary), fail: 'csv-values' },
    { csv: exp.csv, summary: JSON.stringify({ ...exp.summary, topModel: 'glm/GLM-5.3' }), fail: 'summary-values' },
    { csv: exp.csv, summary: JSON.stringify({ ...exp.summary, totalStalled: 20 }), fail: 'summary-values' },
    { csv: exp.csv, summary: JSON.stringify({ ...exp.summary, byLane: { ...exp.summary.byLane, S2: { count: 7, costUsd: 41.1 } } }), fail: null },
  ]
  for (const [i, c] of cases.entries()) {
    const { dir, fixturesSource } = workdir('t05-toolchain')
    writeFileSync(join(dir, 'stats.mjs'), T05_SCRIPT)
    t05Out(dir, c.csv, `${c.summary}\n`)
    const res = await checkT05({ dir, fixturesSource })
    const failed = failedIds(res)
    if (c.fail === null) {
      assert.ok(!failed.includes('summary-values'), `case ${i}：41.1 应与 41.10 数值等价`)
      assert.equal(res.pass, true)
    } else {
      assert.ok(failed.includes(c.fail), `case ${i}：应判负 ${c.fail}（实得 ${failed.join(',')}）`)
      assert.equal(res.pass, false)
    }
  }
})

test('t05：只写脚本不跑 → 产物缺失判负（判分方不代跑）；改输入 / 加依赖 → 对应项判负', async () => {
  const lazy = workdir('t05-toolchain')
  writeFileSync(join(lazy.dir, 'stats.mjs'), T05_SCRIPT)
  const rl = await checkT05(lazy)
  for (const id of ['csv-values', 'summary-values', 'script-reproducible']) assert.ok(failedIds(rl).includes(id), `应判负：${id}`)

  const tampered = workdir('t05-toolchain')
  writeFileSync(join(tampered.dir, 'tickets.json'), '[]')
  writeFileSync(join(tampered.dir, 'package.json'), '{"dependencies":{"lodash":"^4.17.21"}}\n')
  const rt = await checkT05(tampered)
  assert.ok(failedIds(rt).includes('input-unchanged'))
  assert.ok(failedIds(rt).includes('no-deps'))
})

/* ------------------------------------------------------------------ t06 长上下文 */

const T06_MATERIAL = readFileSync(join(TASKS_DIR, 't06-longctx/fixtures/fixtures/material.md'), 'utf8')

test('t06 材料：约 30KB、30 章，关键事实只在中部，首尾有同类干扰项', () => {
  const bytes = Buffer.byteLength(T06_MATERIAL)
  assert.ok(bytes >= 26_000 && bytes <= 40_000, `材料 ${bytes} 字节`)
  assert.equal((T06_MATERIAL.match(/^## S\d\d　/gm) ?? []).length, 30)
  const at = (s) => T06_MATERIAL.indexOf(s) / T06_MATERIAL.length
  for (const key of ['宰相执行·叶 拍板：low 档正式切换到 GLM-5.3-Flash', '写根未 realpath', 'FIX-17', '由 4 调整为 8', '合并后仍超限']) {
    assert.ok(at(key) >= 0.35 && at(key) <= 0.65, `关键事实「${key}」应在 35%-65%：${(at(key) * 100).toFixed(1)}%`)
  }
  for (const decoy of ['制作人拍板：mid 档正式切换', '磁盘满', '上限 12']) {
    const p = at(decoy)
    assert.ok(p < 0.25 || p > 0.75, `干扰项「${decoy}」应在首尾：${(p * 100).toFixed(1)}%`)
  }
  assert.equal((T06_MATERIAL.match(/宰相执行·叶 拍板：low 档正式切换/g) ?? []).length, 1, '答案事实只出现一次')
})

test('t06：渲染后的任务书含全部材料', () => {
  const prompt = renderPromptFile(join(TASKS_DIR, 't06-longctx/prompt.md'))
  assert.ok(prompt.length > T06_MATERIAL.length, '任务书应内含材料全文')
  assert.match(prompt, /Q1 拍板人：/)
  assert.match(prompt, /<material>[\s\S]*<\/material>/)
})


test('t06：标准答案 / 加粗变体全过（score=1）', async () => {
  for (const text of [
    T06_GOOD,
    T06_GOOD.replace(/^Q(\d) (\S+)：/gm, '**Q$1 $2：**').replace('依据章节：', '**依据章节：**'),
    T06_GOOD.replace('Q3 上限：8', 'Q3 上限：8（曾有 12 的提案，已否决）'),
  ]) {
    const { dir, fixturesSource } = workdir('t06-longctx')
    writeFileSync(join(dir, 'answer.md'), text)
    const res = await checkT06({ dir, fixturesSource })
    assert.equal(res.pass, true, failedIds(res).join(','))
    assert.equal(res.score, 1)
  }
})

test('t06：取首部 / 尾部干扰项、条件混搭、依据错位 → 对应项判负', async () => {
  const cases = [
    { text: ['Q1 拍板人：制作人', 'Q1 条件：verify:v2 连续 5 天全绿，且 5h 耗尽率 < 8%', 'Q2 根因：巡检 worker 超时被杀', 'Q2 措施：FIX-11', 'Q3 上限：4', 'Q3 处理：报错 E_WRITEROOT_LIMIT，由派单方裁剪', '依据章节：Q1=S04；Q2=S09；Q3=S03'], fail: ['q1-person', 'q1-condition', 'q2-rootcause', 'q2-fix', 'q3-limit', 'q3-handling', 'citations'] },
    { text: ['Q1 拍板人：制作人', 'Q1 条件：verify:v2 连续 2 天全绿，且 5h 耗尽率 < 5%', 'Q2 根因：数据卷磁盘满（ENOSPC）', 'Q2 措施：FIX-23', 'Q3 上限：12', 'Q3 处理：提案被否决', '依据章节：Q1=S26；Q2=S27；Q3=S25'], fail: ['q1-person', 'q1-condition', 'q2-rootcause', 'q2-fix', 'q3-limit', 'q3-handling', 'citations'] },
    { text: T06_GOOD.replace('5h 耗尽率 < 5%', '5h 耗尽率 < 8%').replace('Q2 根因：seatbelt 写根未 realpath（/tmp 与 /private/tmp 不一致）', 'Q2 根因：磁盘满').replace('Q3 处理：先合并子目录，仍超限则拆工位', 'Q3 处理：合并子目录').replace(/依据章节：.*/, '依据章节：Q1=S28；Q2=S14；Q3=S12'), fail: ['q1-condition', 'q2-rootcause', 'q3-handling', 'citations'] },
    { text: T06_GOOD.replace('Q3 上限：8', 'Q3 上限：12'), fail: ['q3-limit'] },
    { text: T06_GOOD.replace('Q3 上限：8', 'Q3 上限：4'), fail: ['q3-limit'] },
  ]
  for (const c of cases) {
    const { dir, fixturesSource } = workdir('t06-longctx')
    writeFileSync(join(dir, 'answer.md'), `${Array.isArray(c.text) ? c.text.join('\n') : c.text}\n`)
    const res = await checkT06({ dir, fixturesSource })
    assert.equal(res.pass, false)
    for (const id of c.fail) assert.ok(failedIds(res).includes(id), `应判负：${id}（实得 ${failedIds(res).join(',')}）`)
  }
})

test('t06：散文体答案按整段取值仍可过（仅格式附加项判负）；缺文件不抛', async () => {
  const prose = workdir('t06-longctx')
  writeFileSync(
    join(prose.dir, 'answer.md'),
    ['# 答案', '', 'Q1：由宰相执行·叶拍板，条件是 verify:v2 连续 3 天全绿且耗尽率低于 5%。', '', 'Q2：根因是写根未 realpath，措施 FIX-17。', '', 'Q3：上限是 8 个，超过时先合并子目录，再拆工位。', '', '依据章节：Q1=S12；Q2=S13；Q3=S14', ''].join('\n'),
  )
  const rp = await checkT06(prose)
  assert.equal(rp.pass, true, failedIds(rp).join(','))
  assert.deepEqual(failedIds(rp), ['format-lines'])

  const rn = await checkT06(workdir('t06-longctx'))
  assert.equal(rn.pass, false)
  assert.ok(rn.score > 0 && rn.score < 0.2, `缺文件只剩只读输入未改一项得分（实得 ${rn.score}）`)
  assert.ok(passedIds(rn).includes('fixtures-unchanged'))
})

test('t06：parseAnswer 认全角冒号、加粗与折行续行', () => {
  const a = parseAnswer(['**Q1 拍板人：** 宰相执行·叶', '**Q1 生效条件：** verify:v2 连续 3 天全绿，', '且 5h 耗尽率 < 5%', 'Q2 根因：写根未 realpath', 'Q2 措施：FIX-17', 'Q3 上限：8', 'Q3 处理：合并后仍超限拆工位', '依据章节：Q1=S12，Q2=S13，Q3=S14'].join('\n'))
  const f = (q, label) => a.fields.find((x) => x.q === q && x.label === label)?.value
  assert.equal(f(1, '拍板人'), '宰相执行·叶')
  assert.equal(f(1, '(?:生效)?条件'), 'verify:v2 连续 3 天全绿，\n且 5h 耗尽率 < 5%')
  assert.equal(f(2, '根因'), '写根未 realpath')
  assert.equal(f(3, '上限'), '8')
  assert.deepEqual(a.citations, { 1: 'S12', 2: 'S13', 3: 'S14' })
})

/* ------------------------------------------------------------------ sectionOf */

test('sectionOf：标题 / 加粗行 / 标签行三种起头，截断规则正确', () => {
  const doc = ['## 结论', '告警：两项越阈。', '### 细分', '- p90 超标', '## 证据', '1. a', '**下一步**', '- x', '- y', '风险：中', '- r1', '风险评估补充说明第二部分说明文字过长：这样不算标签行'].join('\n')
  assert.equal(stripMd(sectionOf(doc, /结论/)).trim(), '告警：两项越阈。\n细分\n- p90 超标')
  assert.equal(sectionOf(doc, /证据/).trim(), '1. a')
  assert.equal(sectionOf(doc, /下一步/).trim(), '- x\n- y\n风险：中\n- r1\n风险评估补充说明第二部分说明文字过长：这样不算标签行')
  assert.equal(sectionOf(doc, /风险/), '中\n- r1\n风险评估补充说明第二部分说明文字过长：这样不算标签行')
  assert.equal(sectionOf(doc, /不存在/), '')
  assert.equal(sectionOf('结论：正常\n下一步：无', /结论/).trim(), '正常')
})
