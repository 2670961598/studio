/**
 * model-eval-evaluate.test —— 编排内核 runEval + CLI 端到端（node:test；零 dsh、零联网、零真实凭据）
 *
 * 依据：docs/quality/model-eval.md §5（不可用处理 / 调用方式 / 隔离边界）、§9（安全边界）、§10（测试）。
 * - runEval 一律注入假 exec：按 --patch overlay 认模型、按任务文本认预探/裁判、按 cwd 认任务；
 * - CLI 端到端用一个假 dsh（node 脚本，吐合法事件流）走完 main()：退出码 0 / 2 / 3 / 1，report.md/json 落盘。
 * 纯函数单测见 model-eval-runner.test.mjs。运行：node --test scripts/test/model-eval-*.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../ops/model-eval/lib/args.mjs'
import { KIMI_ENV_KEY, parseModelRef, renderOverlay } from '../ops/model-eval/lib/overlay.mjs'
import { PROBE_PROMPT, dshArgs } from '../ops/model-eval/lib/exec.mjs'
import { cellScore, renderMarkdown } from '../ops/model-eval/lib/report.mjs'
import { REPO_ROOT, runEval } from '../ops/model-eval/lib/evaluate.mjs'
import { benchBroken } from '../ops/model-eval/run.mjs'
import { T04_DECISION, T06_GOOD } from './fixtures/model-eval/samples.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TASKS_DIR = resolve(HERE, '..', 'ops', 'model-eval', 'tasks')
const RUN_MJS = resolve(HERE, '..', 'ops', 'model-eval', 'run.mjs')
/** 假 kimi 凭据（只在测试内存/临时目录里流转；用来验证「不进报告、只进 kimi 子进程 env」）。 */
const FAKE_KIMI = 'kimi-fake-7Qp2Zx9Lm'
const KIMI = 'kimi-coding/k3.1-pro'
const HARNESS_STDERR = "Error: EPERM: operation not permitted, open '/x/.dsh/profiles/headless/cordis.yml'"

const roots = []
const tmpRoot = (prefix = 'model-eval-run-') => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  roots.push(d)
  return d
}
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ 假 dsh 与产物 */

const ev = (...objs) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`

/** 一次成功的 dsh 调用：合法事件流（session → step → tool → step_end(usage) → turn_end(completed) → final）。 */
function okRun({ text = '完成', input = 1000, output = 200, sessionId = 'sess-1', latencyMs = 1234 } = {}) {
  return {
    exitCode: 0,
    signal: null,
    spawnError: null,
    timedOut: false,
    latencyMs,
    stdout: ev(
      { type: 'session', sessionId, cwd: '/w' },
      { type: 'status', phase: 'step_start' },
      { type: 'tool_call', callId: 'c1', tool: 'bash', input: {} },
      { type: 'tool_result', callId: 'c1', status: 'ok' },
      { type: 'status', phase: 'step_end', usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 10 } },
      { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } },
      { type: 'final', sessionId, reason: 'completed', text },
    ),
    stderr: '',
  }
}

/** 开跑前失败：顶层 error 事件 + 非 0 退出。 */
const errRun = (message, exitCode = 1) => ({ exitCode, signal: null, spawnError: null, timedOut: false, latencyMs: 800, stdout: ev({ type: 'error', message }), stderr: '' })
const harnessRun = () => ({ exitCode: 1, signal: null, spawnError: null, timedOut: false, latencyMs: 300, stdout: '', stderr: HARNESS_STDERR })
const timeoutRun = () => ({ exitCode: null, signal: 'SIGTERM', spawnError: null, timedOut: true, latencyMs: 300_000, stdout: '', stderr: '' })

/** 在假 dsh 的 cwd（工位）里落产物。 */
const write = (spec, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(spec.cwd, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}

/**
 * 假 dsh：script(call) 返回 RunResult（或 undefined = 成功）。call = { model, cwd, text, probe, judge, task, spec }。
 * 模型从 --patch 指向的 overlay 读；预探按任务文本；裁判按 prompt 首行；任务按 cwd 尾部 `<slug>__r<n>`。
 */
function fakeDsh(script) {
  const calls = []
  const exec = async (spec) => {
    const overlay = readFileSync(spec.args[spec.args.indexOf('--patch') + 1], 'utf8')
    const provider = /^ {4}provider: (.+)$/m.exec(overlay)[1]
    const model = /^ {4}model: (.+)$/m.exec(overlay)[1]
    const text = spec.args[spec.args.indexOf('--') + 1]
    const judge = text.startsWith('你是任务 ')
    const call = { model: `${provider}/${model}`, cwd: spec.cwd, text, probe: text === PROBE_PROMPT, judge, task: judge ? text.slice(5, 8) : /__(t\d\d-[a-z]+)__r\d$/.exec(spec.cwd)?.[1].slice(0, 3) ?? null, spec }
    calls.push(call)
    const out = script(call)
    return out === undefined ? okRun() : out
  }
  return { exec, calls }
}

const kimiWith = (ageMs = 0) => () => ({ token: FAKE_KIMI, file: '/none/kimi-token', reason: null, ageMs })
const kimiNone = () => ({ token: null, file: '/none/kimi-token', reason: 'token 文件缺失', ageMs: null })

function cfg(argv, out, extra = {}) {
  const quiet = argv.includes('-q') || argv.includes('--quiet')
  return {
    ...parseArgs(argv, { now: () => new Date('2026-11-23T08:00:00Z') }),
    dshBin: '/nonexistent/dsh',
    tasksDir: TASKS_DIR,
    out,
    quiet,
    ...extra,
  }
}

const runWith = (config, script, { readKimiToken = kimiNone } = {}) => {
  const fake = fakeDsh(script)
  const logs = []
  return runEval(config, {
    exec: fake.exec,
    readKimiToken,
    env: { PATH: '/bin', HOME: '/h', DSH_SESSION_ID: 'parent-session', DEEPSEEK_API_KEY: 'x' },
    log: (m) => logs.push(m),
    now: () => new Date('2026-11-23T08:00:00Z'),
  }).then((report) => ({ report, calls: fake.calls, logs }))
}

const rowOf = (report, model, task) => report.rows.find((r) => r.model === model && r.task === task)

/* ------------------------------------------------------------------ runEval 编排（假 exec） */

test('runEval 主流程：预探失败跳过、逐格跑判、证据落盘、凭据只进 kimi 子进程且不进报告', async () => {
  const out = tmpRoot()
  const script = (call) => {
    if (call.probe) return call.model === KIMI ? errRun(`401 Unauthorized: invalid token ${FAKE_KIMI}`) : okRun({ text: '可用' })
    if (call.model === 'glm/GLM-5.4') {
      write(call.spec, call.task === 't04' ? { 'decision.md': T04_DECISION } : { 'answer.md': T06_GOOD })
      return okRun()
    }
    if (call.task === 't04') write(call.spec, { 'decision.md': T04_DECISION.replace('判定：该问清', '判定：该建单') })
    return okRun({ text: '我没法完成' })
  }
  const { report, calls } = await runWith(cfg(['--models', `glm/GLM-5.4,glm/GLM-5.3-Flash,${KIMI}`, '--tasks', 't04,t06', '--judge', 'none'], out), script, { readKimiToken: kimiWith() })

  assert.equal(calls.length, 7, '3 次预探 + 2 模型 × 2 任务')
  assert.deepEqual(report.config.tasks, ['t04', 't06'])
  assert.deepEqual(report.config.models, ['glm/GLM-5.4', 'glm/GLM-5.3-Flash', KIMI])
  assert.equal(report.outDir, realpathSync(out))
  assert.equal(report.schema, 'model-eval/v1')
  assert.equal(report.judge.enabled, false)
  assert.equal(report.availability.length, 3)
  const kimiAvail = report.availability.find((a) => a.model === KIMI)
  assert.equal(kimiAvail.available, false)
  assert.equal(kimiAvail.errorClass, 'auth')
  assert.match(kimiAvail.reason, /^auth: /)
  assert.ok(report.availability.filter((a) => a.model !== KIMI).every((a) => a.available && a.errorClass === 'ok'))

  assert.equal(report.rows.length, 6)
  const good = rowOf(report, 'glm/GLM-5.4', 't04')
  assert.equal(good.status, 'completed')
  assert.equal(good.ok, true)
  assert.equal(good.deterministicPass, true)
  assert.equal(good.deterministicScore, 1)
  assert.equal(good.reason, null)
  assert.equal(good.tokensTotal, 1200)
  assert.equal(good.steps, 1)
  assert.equal(good.toolCalls, 1)
  assert.equal(good.sessionId, 'sess-1')
  assert.equal(good.finalText, '完成')
  assert.equal(rowOf(report, 'glm/GLM-5.4', 't06').deterministicPass, true)
  const wrong = rowOf(report, 'glm/GLM-5.3-Flash', 't04')
  assert.equal(wrong.ok, true)
  assert.equal(wrong.deterministicPass, false)
  assert.deepEqual(wrong.failedChecks, ['decision-first-line'])
  assert.ok(rowOf(report, 'glm/GLM-5.3-Flash', 't06').failedChecks.includes('q1-person'))
  for (const t of ['t04', 't06']) {
    const r = rowOf(report, KIMI, t)
    assert.equal(r.status, 'skipped')
    assert.equal(r.errorClass, 'auth')
    assert.equal(r.deterministicPass, null)
  }

  const s = report.summary
  assert.deepEqual([s['glm/GLM-5.4'].passCount, s['glm/GLM-5.4'].cellsRun, s['glm/GLM-5.4'].cellsSkipped], [2, 2, 0])
  assert.deepEqual(s['glm/GLM-5.4'].byTask, { t04: 1, t06: 1 })
  assert.deepEqual(s[KIMI].byTask, {})
  assert.equal(s[KIMI].cellsSkipped, 2)
  const mid = report.roles.find((r) => r.role === 'mid').ranking
  assert.equal(mid[0].model, 'glm/GLM-5.4')
  assert.equal(mid[0].eligible, true)
  assert.equal(mid.at(-1).model, KIMI)
  assert.match(mid.at(-1).note, /不可用/)
  assert.ok(report.warnings.some((w) => /只跑了 2\/6 个任务/.test(w)))
  assert.ok(report.warnings.some((w) => /--reps=1/.test(w)))
  assert.equal(benchBroken(report), false)

  // 凭据：只进 kimi 子进程 env；报告全文不含
  for (const c of calls) {
    assert.equal(c.spec.cmd, '/nonexistent/dsh')
    assert.equal(c.spec.env.DSH_SESSION_ID, undefined)
    assert.equal(c.spec.env.DEEPSEEK_API_KEY, undefined)
    assert.equal(c.spec.env.PATH, '/bin')
    assert.deepEqual(c.spec.args, dshArgs(c.spec.args[c.spec.args.indexOf('--patch') + 1], c.text))
    assert.equal(c.spec.env[KIMI_ENV_KEY], c.model === KIMI ? FAKE_KIMI : undefined, c.model)
  }
  assert.equal(JSON.stringify(report).includes(FAKE_KIMI), false)

  // 证据落盘
  const real = realpathSync(out)
  assert.equal(readFileSync(join(real, 'overlays', 'glm__GLM-5.4.yml'), 'utf8'), renderOverlay(parseModelRef('glm/GLM-5.4')))
  assert.ok(existsSync(join(real, 'overlays', 'kimi-coding__k3.1-pro.yml')))
  assert.ok(readFileSync(join(real, 'logs', 'glm__GLM-5.4__t04-triage__r1.ndjson'), 'utf8').startsWith('{"type":"session"'))
  assert.equal(existsSync(join(real, 'logs', 'glm__GLM-5.4__t04-triage__r1.stderr.log')), false, 'stderr 为空不落文件')
  assert.equal(readdirSync(join(real, 'logs')).some((f) => f.includes('probe')), false, '预探不占 logs')
  assert.equal(good.outputPath, join(real, 'work', 'glm__GLM-5.4__t04-triage__r1'))
  assert.ok(existsSync(join(good.outputPath, 'decision.md')))
  assert.ok(existsSync(join(good.outputPath, 'fixtures', '规程.md')))

  const md = renderMarkdown(report)
  assert.match(md, /⏭ 跳过/)
  assert.match(md, /❌ 0\/1 · 0\.88/)
  assert.match(md, /本次只跑 2 个任务（t04、t06）/)
  assert.doesNotMatch(md, /undefined|\[object Object\]|NaN/)
})

test('runEval 裁判：逐格打分、解析失败记 judgeError、裁判用量单独计、同模型只预探一次', async () => {
  const out = tmpRoot()
  let n = 0
  const script = (call) => {
    if (call.probe) return undefined
    if (call.judge) return okRun({ text: n++ === 0 ? '```json\n{"score": 8, "reason": "判定与逐项都对"}\n```' : '我觉得不错' })
    write(call.spec, { 'decision.md': T04_DECISION })
    return undefined
  }
  const { report, calls } = await runWith(cfg(['--models', 'glm/GLM-5.3-Flash', '--tasks', 't04', '--reps', '2', '--judge', 'glm/GLM-5.4'], out), script)
  assert.equal(calls.length, 6, '2 预探 + 2 任务 + 2 裁判')
  const judgeCalls = calls.filter((c) => c.judge)
  assert.ok(judgeCalls.every((c) => c.model === 'glm/GLM-5.4' && c.cwd.includes(`${sep}judge${sep}glm__GLM-5.3-Flash__t04-triage__r`)))
  assert.equal(judgeCalls[0].task, 't04')
  assert.match(judgeCalls[0].text, /【被测模型的产物】\n### decision\.md/)
  assert.equal(report.judge.enabled, true)
  assert.equal(report.judge.model, 'glm/GLM-5.4')
  assert.equal(report.judge.available, true)
  assert.equal(report.judge.tokensTotal, 2400, '只计裁判调用，不含预探')
  assert.deepEqual(report.availability.map((a) => a.model), ['glm/GLM-5.3-Flash', 'glm/GLM-5.4'])
  const [r1, r2] = report.rows
  assert.equal(r1.judgeScore, 8)
  assert.equal(r1.judgeReason, '判定与逐项都对')
  assert.equal(r1.judgeError, null)
  assert.equal(r1.judgeSelf, false)
  assert.equal(r2.judgeScore, null)
  assert.equal(r2.judgeError, 'parse')
  assert.equal(cellScore(r1, { judgeEnabled: true }), 0.94)
  assert.equal(cellScore(r2, { judgeEnabled: true }), 1, '裁判没给出可读分 → 该格只用确定性分（judgeError 留痕）')
  assert.equal(cellScore(r1, { judgeEnabled: false }), 1)
  assert.equal(report.summary['glm/GLM-5.3-Flash'].byTask.t04, 0.97)
  assert.ok(existsSync(join(realpathSync(out), 'logs', 'glm__GLM-5.4__judge__glm__GLM-5.3-Flash__t04-triage__r1.ndjson')))
  assert.match(renderMarkdown(report), /判 8\.0/)
})

test('runEval judgeSelf / 价目表 / 裁判不可用', async () => {
  const out = tmpRoot()
  const judge = (call) => (call.probe ? undefined : call.judge ? okRun({ text: '{"score": 10, "reason": "满分"}' }) : (write(call.spec, { 'answer.md': T06_GOOD }), undefined))
  const self = await runWith(cfg(['--models', 'glm/GLM-5.4', '--tasks', 't06', '--judge', 'glm/GLM-5.4'], out, { priceTable: { 'glm/GLM-5.4': { input: 1, output: 2, per: 1000 } } }), judge)
  assert.equal(self.calls.length, 3, '同模型只预探一次：1 预探 + 1 任务 + 1 裁判')
  assert.equal(self.report.availability.length, 1)
  assert.equal(self.report.rows[0].judgeSelf, true)
  assert.equal(self.report.rows[0].judgeScore, 10)
  assert.equal(self.report.rows[0].costUsd, 1.4, '(1000×1 + 200×2) / 1000')
  assert.equal(self.report.judge.costUsd, 1.4)
  assert.equal(self.report.summary['glm/GLM-5.4'].totalCostUsd, 1.4)
  assert.ok(self.report.warnings.some((w) => /judgeSelf/.test(w)))
  assert.ok(self.logs.length >= 3, '每次调用记进度')

  const down = await runWith(cfg(['--models', 'glm/GLM-5.4', '--tasks', 't06', '--judge', 'opencode-go/deepseek-v4.1-flash'], join(out, 'b')), (call) => {
    if (call.model === 'opencode-go/deepseek-v4.1-flash') return errRun('429 {"error":"usage limit reached, top up"}')
    return judge(call)
  })
  assert.equal(down.calls.filter((c) => c.judge).length, 0, '裁判不可用不逐格调')
  assert.equal(down.report.judge.available, false)
  assert.match(down.report.judge.reason, /^quota:/)
  assert.equal(down.report.rows[0].judgeScore, null)
  assert.equal(down.report.rows[0].judgeError, null)
  assert.equal(cellScore(down.report.rows[0], { judgeEnabled: true }), 1, '裁判缺席 → 该格只用确定性分')
})

test('runEval 评测台故障：全部 harness → benchBroken；--no-skip-unavailable 逐格记 failed 且不计分', async () => {
  const out = tmpRoot()
  const argv = ['--models', 'glm/GLM-5.4,glm/GLM-5.3-Flash', '--tasks', 't04,t06', '--judge', 'none']
  const all = await runWith(cfg(argv, join(out, 'a')), () => harnessRun())
  assert.equal(all.calls.length, 2, '逐模型各预探一次；全 harness → 不发车')
  assert.equal(all.report.availability.length, 2)
  assert.ok(all.report.availability.every((a) => !a.available && a.errorClass === 'harness'))
  assert.ok(all.report.rows.every((r) => r.status === 'skipped' && r.errorClass === 'harness'))
  assert.equal(benchBroken(all.report), true)

  const force = await runWith(cfg([...argv, '--no-skip-unavailable'], join(out, 'b')), () => harnessRun())
  assert.equal(force.calls.length, 6, '2 预探 + 2 模型 × 2 任务')
  assert.ok(force.report.rows.every((r) => r.status === 'failed' && r.errorClass === 'harness' && cellScore(r, { judgeEnabled: false }) === null))
  assert.equal(force.report.summary['glm/GLM-5.4'].cellsBroken, 2)
  assert.equal(force.report.summary['glm/GLM-5.4'].cellsRun, 0)
  assert.equal(benchBroken(force.report), true)
  assert.match(renderMarkdown(force.report), /⚠️ 评测台故障/)

  const mixed = await runWith(cfg(argv, join(out, 'c')), (call) => (call.model === 'glm/GLM-5.4' ? harnessRun() : undefined))
  assert.equal(benchBroken(mixed.report), false, '有模型预探成功就不算评测台不可用')
  assert.equal(mixed.report.rows.filter((r) => r.status === 'skipped').length, 2)
  assert.equal(mixed.report.rows.filter((r) => r.status === 'completed').length, 2)
})

test('runEval 超时 / kimi 无 token / token 过期预警 / AGENTS.md 污染预警', async () => {
  const out = tmpRoot()
  writeFileSync(join(out, 'AGENTS.md'), '# 污染源\n')
  const slow = await runWith(cfg(['--models', 'glm/GLM-5.4', '--tasks', 't06', '--judge', 'none', '--no-skip-unavailable'], join(out, 'a')), () => timeoutRun())
  const row = slow.report.rows[0]
  assert.equal(row.status, 'failed')
  assert.equal(row.errorClass, 'timeout')
  assert.equal(cellScore(row, { judgeEnabled: false }), 0)
  assert.deepEqual(slow.report.summary['glm/GLM-5.4'].failures, { timeout: 1 })
  assert.equal(slow.report.summary['glm/GLM-5.4'].passCount, 0)
  assert.deepEqual(slow.report.summary['glm/GLM-5.4'].failedChecks, {}, '失败格不统计未过项')
  assert.equal(benchBroken(slow.report), false)
  assert.ok(slow.report.warnings.some((w) => /AGENTS\.md/.test(w)))

  const noTok = await runWith(cfg(['--models', `${KIMI},glm/GLM-5.4`, '--tasks', 't06', '--judge', 'none'], join(out, 'b')), () => undefined, { readKimiToken: kimiNone })
  assert.equal(noTok.calls.some((c) => c.model === KIMI), false, '无 token 不调 dsh')
  assert.deepEqual([noTok.report.availability[0].available, noTok.report.availability[0].errorClass, noTok.report.availability[0].reason], [false, 'auth', 'kimi token 不可用：token 文件缺失'])
  assert.equal(rowOf(noTok.report, KIMI, 't06').status, 'skipped')
  assert.equal(rowOf(noTok.report, 'glm/GLM-5.4', 't06').status, 'completed')

  const stale = await runWith(cfg(['--models', KIMI, '--tasks', 't06', '--judge', 'none'], join(out, 'c')), (call) => (call.probe ? errRun(`401 Unauthorized: bad token ${FAKE_KIMI}`) : undefined), { readKimiToken: kimiWith(20 * 60_000) })
  assert.equal(stale.calls.length, 1)
  assert.ok(stale.report.warnings.some((w) => /20 分钟前/.test(w)))
  assert.equal(JSON.stringify(stale.report).includes(FAKE_KIMI), false)
  assert.match(stale.report.availability[0].reason, /<redacted>/)
})

test('runEval 判分脚本抛异常 = 评测台问题：该格不计分并告警，不冒记到模型头上', async () => {
  const root = tmpRoot()
  const tasksDir = join(root, 'tasks')
  const taskDir = join(tasksDir, 't09-boom')
  mkdirSync(join(taskDir, 'fixtures'), { recursive: true })
  writeFileSync(join(taskDir, 'prompt.md'), '# 任务：演示\n\n只能读写当前工作目录，不要联网。\n')
  writeFileSync(join(taskDir, 'check.mjs'), 'export const rubric = "- 判分脚本自身演示用 rubric"\nexport async function check() { throw new Error("boom: 判分脚本炸了") }\n')
  const { report } = await runWith(cfg(['--models', 'glm/GLM-5.4', '--judge', 'none'], join(root, 'o'), { tasksDir }), () => undefined)
  const row = report.rows[0]
  assert.equal(report.rows.length, 1)
  assert.equal(row.status, 'completed')
  assert.equal(row.ok, true)
  assert.equal(row.checkError, 'boom: 判分脚本炸了')
  assert.equal(row.deterministicScore, null)
  assert.equal(cellScore(row, { judgeEnabled: false }), null)
  assert.equal(report.summary['glm/GLM-5.4'].cellsBroken, 1)
  assert.equal(report.summary['glm/GLM-5.4'].cellsRun, 0)
  assert.equal(benchBroken(report), false)
  assert.ok(report.warnings.some((w) => /确定性检查脚本报错/.test(w)))
  const md = renderMarkdown(report)
  assert.match(md, /⚠️ 评测台故障（boom: 判分脚本炸了）/)
  assert.match(md, /completed（判分异常）/)
})

/* ------------------------------------------------------------------ CLI 端到端（假 dsh） */

/** 写一个假 dsh（node 脚本）：认 --patch overlay 与任务文本，吐合法事件流；FAKE_HARNESS=1 时模拟评测台故障。 */
function writeFakeDsh(dir) {
  const file = join(dir, 'dsh')
  writeFileSync(
    file,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const argv = process.argv
const overlay = readFileSync(argv[argv.indexOf('--patch') + 1], 'utf8')
const text = argv[argv.indexOf('--') + 1]
const model = /^ {4}model: (.+)$/m.exec(overlay)[1]
const GOOD = ${JSON.stringify(T04_DECISION)}
const emit = (o) => console.log(JSON.stringify(o))
emit({ type: 'session', sessionId: 'fake-1', cwd: process.cwd() })
if (process.env.FAKE_HARNESS === '1') {
  console.error(${JSON.stringify(HARNESS_STDERR)})
  process.exit(1)
}
emit({ type: 'status', phase: 'step_start' })
emit({ type: 'status', phase: 'step_end', usage: { inputTokens: 1000, outputTokens: 200 } })
if (text.startsWith('只回复')) emit({ type: 'final', sessionId: 'fake-1', reason: 'completed', text: '可用' })
else if (text.startsWith('你是任务')) emit({ type: 'final', sessionId: 'fake-1', reason: 'completed', text: '{"score": 9, "reason": "ok"}' })
else {
  writeFileSync('decision.md', model === 'GLM-5.4' ? GOOD : GOOD.replace('判定：该问清', '判定：该建单'))
  emit({ type: 'final', sessionId: 'fake-1', reason: 'completed', text: '完成' })
}
emit({ type: 'status', phase: 'turn_end', reason: { kind: 'completed' } })
`,
  )
  chmodSync(file, 0o755)
  return file
}

test('CLI 端到端：假 dsh → exit 0 且 report 落盘；评测台故障 exit 3；用法错 exit 2；仓内 --out exit 1', () => {
  const root = tmpRoot('model-eval-cli-')
  const fake = writeFakeDsh(root)
  const run = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [RUN_MJS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: join(root, 'home'), ...extraEnv }, timeout: 60_000 })
  const common = ['--models', 'glm/GLM-5.4,glm/GLM-5.3-Flash', '--tasks', 't04', '--judge', 'none', '--dsh', fake, '-q']

  const out = join(root, 'o1')
  const r1 = run([...common, '--out', out])
  assert.equal(r1.status, 0, r1.stderr)
  const line = JSON.parse(r1.stdout.trim().split('\n').at(-1))
  assert.deepEqual([line.cells, line.completed, line.passed], [2, 2, 1])
  assert.equal(realpathSync(line.json), realpathSync(join(out, 'report.json')))
  const report = JSON.parse(readFileSync(line.json, 'utf8'))
  assert.equal(report.schema, 'model-eval/v1')
  assert.equal(report.rows.length, 2)
  const md = readFileSync(line.report, 'utf8')
  assert.match(md, /## 2\. 结果矩阵/)
  assert.match(md, /✅ 1\/1/)
  assert.match(md, /❌ 0\/1/)
  assert.ok(existsSync(join(out, 'overlays', 'glm__GLM-5.3-Flash.yml')))

  const r2 = run([...common, '--out', join(root, 'o2')], { FAKE_HARNESS: '1' })
  assert.equal(r2.status, 3)
  assert.match(r2.stderr, /评测台不可用/)
  assert.ok(existsSync(join(root, 'o2', 'report.md')), '评测台故障也留报告')

  const r3 = run([...common, '--out', join(root, 'o3'), '--tasks', 't99'])
  assert.equal(r3.status, 2)
  assert.match(r3.stderr, /未知任务：t99/)
  const r4 = run(['--bogus'])
  assert.equal(r4.status, 2)
  const inside = join(REPO_ROOT, 'model-eval-should-not-exist')
  const r5 = run([...common, '--out', inside])
  assert.equal(r5.status, 1)
  assert.match(r5.stderr, /仓内/)
  assert.equal(existsSync(inside), false)
  const r6 = run(['--dsh', fake, '--help'])
  assert.equal(r6.status, 0)
  assert.match(r6.stdout, /--judge/)
})
