/**
 * model-eval-runner.test —— runner 纯函数（node:test；零 dsh、零联网、零真实凭据）
 *
 * 依据：docs/quality/model-eval.md §3（判分构成）、§5（调用方式 / 隔离边界）、§10（测试）。
 * 覆盖：参数与 overlay / 子进程 env / token 与 dsh 解析 / execDsh 契约（用 node 自身冒烟）/ 事件流与错误分类 /
 * 脱敏 / 判分与角色排序 / 裁判提示词与作答解析 / outDir 安全员与产物收集。
 * 编排（runEval）与 CLI 端到端见 model-eval-evaluate.test.mjs。
 * 运行：node --test scripts/test/model-eval-*.test.mjs
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve, sep } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_JUDGE, DEFAULT_MODELS, USAGE, UsageError, parseArgs, timestamp } from '../ops/model-eval/lib/args.mjs'
import { KIMI_ENV_KEY, buildChildEnv, parseModelRef, renderOverlay } from '../ops/model-eval/lib/overlay.mjs'
import { dshArgs, execDsh, kimiTokenFile, readKimiToken, resolveDshBin } from '../ops/model-eval/lib/exec.mjs'
import { classifyFailure, classifyRun, detectHarness, firstStatus } from '../ops/model-eval/lib/errors.mjs'
import { parseNdjson, summarizeEvents, summarizeRun, usageTotal } from '../ops/model-eval/lib/ndjson.mjs'
import { redact, squash, tail } from '../ops/model-eval/lib/redact.mjs'
import { ALL_TASKS, COVERAGE_MIN, COST_PENALTY, ROLE_LABELS } from '../ops/model-eval/lib/roles.mjs'
import { cellScore, rankRoles, renderMarkdown, summarizeModels } from '../ops/model-eval/lib/report.mjs'
import { MAX_ARTIFACTS, MAX_REASON_CHARS, buildJudgePrompt, parseJudgeAnswer } from '../ops/model-eval/judge.mjs'
import { REPO_ROOT, assertSafeOutDir, collectArtifacts, findAgentsMd, readPriceTable } from '../ops/model-eval/lib/evaluate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 假 kimi 凭据（只在测试内存里流转；用来验证「只进 kimi 子进程 env、不进报告」）。 */
const FAKE_KIMI = 'kimi-fake-7Qp2Zx9Lm'
const HARNESS_STDERR = "Error: EPERM: operation not permitted, open '/x/.dsh/profiles/headless/cordis.yml'"

const roots = []
const tmpRoot = (prefix = 'model-eval-unit-') => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  roots.push(d)
  return d
}
after(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

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

/* ------------------------------------------------------------------ 参数 / overlay / env */

test('parseArgs：缺省矩阵、裁判、输出目录；显式参数覆盖', () => {
  const d = parseArgs([], { now: () => new Date(2026, 10, 23, 9, 5, 7) })
  assert.deepEqual(d.models, [...DEFAULT_MODELS])
  assert.deepEqual(d.modelRefs.map((m) => m.slug), ['glm__GLM-5.4', 'glm__GLM-5.3-Flash', 'glm__GLM-5.3', 'kimi-coding__k3.1-pro', 'opencode-go__deepseek-v4.1-flash'])
  assert.equal(d.judge, DEFAULT_JUDGE)
  assert.equal(d.judgeRef.id, DEFAULT_JUDGE)
  assert.equal(d.tasks, null)
  assert.equal(d.reps, 1)
  assert.equal(d.skipUnavailable, true)
  assert.equal(d.out, '/tmp/model-eval/20261123-090507')
  assert.equal(timestamp(new Date(2026, 0, 2, 3, 4, 5)), '20260102-030405')
  assert.equal(parseArgs(['--help']).help, true)
  assert.match(USAGE, /--judge/)

  const x = parseArgs(['--models', 'a/b, c/d', '--tasks', 'T01,t04-triage', '--reps', '3', '--judge', 'NONE', '--no-skip-unavailable', '--out', '/tmp/x', '--timeout-ms', '5000', '--probe-timeout-ms', '1000', '--dsh', '/bin/dsh', '--prices', '/tmp/p.json', '-q'])
  assert.deepEqual(x.models, ['a/b', 'c/d'])
  assert.deepEqual(x.tasks, ['t01', 't04-triage'])
  assert.equal(x.reps, 3)
  assert.equal(x.judge, null)
  assert.equal(x.judgeRef, null)
  assert.equal(x.skipUnavailable, false)
  assert.equal(x.out, '/tmp/x')
  assert.equal(x.timeoutMs, 5000)
  assert.equal(x.probeTimeoutMs, 1000)
  assert.equal(x.dsh, '/bin/dsh')
  assert.equal(x.prices, '/tmp/p.json')
  assert.equal(x.quiet, true)
})

test('parseArgs：用法错（未知参数 / 缺值 / 空值 / reps / 模型引用形态）', () => {
  const cases = [
    [['--bogus'], /未知参数/],
    [['--models'], /缺参数值/],
    [['--out', '  '], /缺参数值/],
    [['--reps', '0'], /须 ≥ 1/],
    [['--reps', 'x'], /正整数/],
    [['--reps', '1.5'], /正整数/],
    [['--timeout-ms', '-1'], /正整数/],
    [['--models', ''], /缺参数值/],
    [['--models', ' , '], /不能为空/],
    [['--models', 'noSlash'], /provider\/model/],
    [['--models', 'a/b\n- id: x'], /provider\/model/],
    [['--models', 'a/b c'], /provider\/model/],
    [['--judge', 'bad'], /provider\/model/],
    [['--judge'], /缺参数值/],
  ]
  for (const [argv, re] of cases) assert.throws(() => parseArgs(argv), (err) => err instanceof UsageError && re.test(err.message), argv.join(' '))
})

test('parseModelRef / renderOverlay / dshArgs：字符集收紧、overlay 与参数形态固定', () => {
  assert.equal(parseModelRef(' a/b\n').id, 'a/b', '首尾空白先 trim')
  assert.deepEqual(parseModelRef(' kimi-coding/k3.1-pro '), { id: 'kimi-coding/k3.1-pro', provider: 'kimi-coding', model: 'k3.1-pro', slug: 'kimi-coding__k3.1-pro' })
  for (const bad of ['', 'a', 'a/', '/b', 'a/b/c', 'a b/c', 'a/b:1', '../x', 'a/${x}']) assert.throws(() => parseModelRef(bad), UsageError, JSON.stringify(bad))
  assert.equal(
    renderOverlay(parseModelRef('glm/GLM-5.4')),
    '# model-eval 自动生成的路由 overlay（覆盖 agent-default-model）；勿手改。\n- id: agent-default-model\n  config:\n    provider: glm\n    model: GLM-5.4\n',
  )
  assert.deepEqual(dshArgs('/o.yml', 'T'), ['--profile', 'headless', '--patch', '/o.yml', '--permission-mode', 'workspace-write', '--json', '--', 'T'])
})

test('buildChildEnv：剔父会话身份变量与 DEEPSEEK_*；KIMI_API_KEY 只在显式给 token 时注入', () => {
  const base = { PATH: '/bin', HOME: '/h', DSH_SESSION_ID: 's', DSH_PROFILE: 'headless', DSH_PROFILE_DIR: '/x', DSH_SHELL: '/bin/zsh', DSH_HOME: '/dh', DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'u', KIMI_API_KEY: 'leak', UNDEF: undefined }
  assert.deepEqual(buildChildEnv(base), { PATH: '/bin', HOME: '/h', DSH_HOME: '/dh' })
  assert.deepEqual(buildChildEnv(base, { kimiToken: FAKE_KIMI }), { PATH: '/bin', HOME: '/h', DSH_HOME: '/dh', [KIMI_ENV_KEY]: FAKE_KIMI })
  assert.deepEqual(buildChildEnv(base, { kimiToken: '' }), { PATH: '/bin', HOME: '/h', DSH_HOME: '/dh' })
  assert.deepEqual(buildChildEnv(null), {})
  assert.equal(buildChildEnv({ N: 42 }).N, '42')
})

/* ------------------------------------------------------------------ 执行面（不 spawn dsh） */

test('readKimiToken / kimiTokenFile / resolveDshBin：文件形态、缺失、覆盖、dsh 解析', () => {
  const dir = tmpRoot('model-eval-tok-')
  const w = (name, content) => {
    const p = join(dir, name)
    writeFileSync(p, content)
    return p
  }
  const plain = readKimiToken({ file: w('plain', 'abc123\n') })
  assert.equal(plain.token, 'abc123')
  assert.equal(plain.reason, null)
  assert.equal(typeof plain.ageMs, 'number')
  assert.equal(readKimiToken({ file: w('json', '{"access_token":"xyz9","expires_in":900}') }).token, 'xyz9')
  assert.equal(readKimiToken({ file: w('camel', '{"accessToken":"camel1"}') }).token, 'camel1')
  assert.equal(readKimiToken({ file: w('multi', 'first1\nsecond\n') }).token, 'first1')
  assert.match(readKimiToken({ file: w('empty', '  \n') }).reason, /^token 文件为空/)
  assert.match(readKimiToken({ file: w('nokey', '{"a":1}') }).reason, /无 access_token/)
  assert.match(readKimiToken({ file: w('badjson', '{oops') }).reason, /^token 文件为空/)
  const missing = readKimiToken({ file: join(dir, 'nope') })
  assert.equal(missing.token, null)
  assert.equal(missing.reason, 'token 文件缺失', 'reason 会进 report，不得带宿主路径')
  assert.equal(missing.file, join(dir, 'nope'))

  assert.ok(kimiTokenFile({}).endsWith(`${sep}secrets${sep}kimi-access-token`))
  assert.equal(kimiTokenFile({ STUDIO_KIMI_TOKEN_FILE: '  /custom/kimi  ' }), '/custom/kimi')

  const fake = w('dsh', '#!/bin/sh\n')
  chmodSync(fake, 0o755)
  assert.equal(resolveDshBin(fake), fake)
  assert.equal(resolveDshBin(`  ${fake}  `), fake)
  assert.throws(() => resolveDshBin(join(dir, 'nope')), /不存在/)
  assert.ok([fake, '/opt/homebrew/bin/dsh'].includes(resolveDshBin(null, { PATH: dir })), '缺省安装位不在时才退到 PATH')
})

test('execDsh：RunResult 契约（正常 / spawn 失败 / 超时杀进程组）——用 node 自身冒烟', async () => {
  const cwd = tmpRoot('model-eval-exec-')
  const okr = await execDsh({ cmd: process.execPath, args: ['-e', 'console.log("hi")'], cwd, env: {}, timeoutMs: 10_000 })
  assert.equal(okr.exitCode, 0)
  assert.equal(okr.stdout, 'hi\n')
  assert.equal(okr.timedOut, false)
  assert.equal(okr.spawnError, null)
  const bad = await execDsh({ cmd: join(cwd, 'nope'), args: [], cwd, env: {}, timeoutMs: 1000 })
  assert.equal(bad.spawnError, 'ENOENT')
  const slow = await execDsh({ cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 8000)'], cwd, env: {}, timeoutMs: 300 })
  assert.equal(slow.timedOut, true)
  assert.equal(slow.exitCode, null)
  assert.ok(['SIGTERM', 'SIGKILL'].includes(slow.signal))
  assert.ok(slow.latencyMs >= 300 && slow.latencyMs < 6000, `latencyMs=${slow.latencyMs}`)
})

/* ------------------------------------------------------------------ 事件流与错误分类 */

test('parseNdjson / summarizeEvents / summarizeRun：坏行留证、usage 累加、终态只认 turn_end', () => {
  const p = parseNdjson('\uFEFF{"type":"session","sessionId":"s"}\n\nnot json\n[1,2]\n{"type":"text","text":"a"}\n')
  assert.equal(p.events.length, 2)
  assert.deepEqual(p.badLines, ['not json', '[1,2]'])
  const s = summarizeEvents(parseNdjson(ev(
    { type: 'session', sessionId: 's9' },
    { type: 'status', phase: 'step_start' },
    { type: 'tool_call', callId: 'c1' }, { type: 'tool_call', callId: 'c2' },
    { type: 'tool_result', callId: 'c1', status: 'error' }, { type: 'tool_result', callId: 'c2', status: 'ok' },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5 } },
    { type: 'status', phase: 'step_start' },
    { type: 'status', phase: 'step_end', usage: { inputTokens: 1 } },
    { type: 'text', text: 'a' }, { type: 'text', text: 'b' },
    { type: 'final', sessionId: 's9', reason: 'completed', text: 'F' },
  )).events)
  assert.equal(s.sessionId, 's9')
  assert.equal(s.steps, 2)
  assert.equal(s.toolCalls, 2)
  assert.equal(s.toolErrors, 1)
  assert.deepEqual(s.usage, { input: 11, output: 2, cacheRead: 5, cacheWrite: 0, steps: 2 })
  assert.equal(usageTotal(s.usage), 13)
  assert.equal(usageTotal(null), null)
  assert.equal(s.finalText, 'F')
  assert.equal(s.lastText, 'b')
  assert.equal(s.turnReason, null)
  const r = summarizeRun({ ...okRun(), stderr: 'E\n', exitCode: 1 })
  assert.equal(r.eventCount, 7)
  assert.equal(r.turnReason.kind, 'completed')
  assert.equal(r.exitCode, 1)
  assert.equal(r.stderrTail, 'E\n')
  assert.equal(classifyRun(r).errorClass, 'unknown', 'turn_end=completed 但 exit≠0 → unknown，不冒认')
})

test('classifyFailure / firstStatus / detectHarness：类目表', () => {
  const cases = [
    [{ code: 'ECONNREFUSED' }, 'network'],
    [{ code: 'ENOTFOUND' }, 'network'],
    [{ code: 'auth' }, 'auth'],
    [{ code: 'MISSING_CREDENTIAL' }, 'auth'],
    [{ status: 429 }, 'quota'],
    [{ status: 401 }, 'auth'],
    [{ status: 403 }, 'auth'],
    [{ status: 408 }, 'timeout'],
    [{ status: 503 }, 'server'],
    [{ status: 529 }, 'server'],
    [{ status: 402 }, 'bad_request'],
    [{ status: 400, message: 'bad' }, 'bad_request'],
    [{ status: 400, message: 'request refused by safety filter' }, 'refusal'],
    [{ message: '429 {"error":"quota"}' }, 'quota'],
    [{ message: 'HTTP 529 overloaded' }, 'server'],
    [{ message: '额度已耗尽' }, 'quota'],
    [{ message: 'Rate limit exceeded' }, 'rate_limit'],
    [{ message: 'Request timed out' }, 'timeout'],
    [{ name: 'TimeoutError' }, 'timeout'],
    [{ message: 'unexpected token < in json' }, 'parse'],
    [{ message: 'something odd happened' }, 'unknown'],
    [{}, 'unknown'],
  ]
  for (const [input, expected] of cases) assert.equal(classifyFailure(input), expected, JSON.stringify(input))
  assert.equal(firstStatus('429 x'), 429)
  assert.equal(firstStatus('x code: 503 y'), 503)
  assert.equal(firstStatus('nope'), undefined)
  assert.match(detectHarness(HARNESS_STDERR), /dsh/)
  assert.match(detectHarness('Error: ENOENT: no such file, open profiles/headless.yml'), /profile/)
  assert.match(detectHarness("Error: Cannot find module 'yml'"), /依赖/)
  assert.match(detectHarness('error: unknown option --foo'), /不认识/)
  assert.equal(detectHarness('some model error'), null)
  assert.equal(detectHarness(null), null)
})

test('classifyRun：ok 判据 + 失败类目（harness 优先于模型错误类目）', () => {
  const runOf = (stdout, patch = {}) => classifyRun(summarizeRun({ exitCode: 0, signal: null, spawnError: null, timedOut: false, latencyMs: 10, stdout, stderr: '', ...patch }))
  assert.deepEqual(runOf(okRun().stdout), { ok: true, errorClass: 'ok', errorDetail: null, reason: null })
  const cls = (r) => `${r.errorClass}:${r.reason}`
  assert.match(cls(runOf('', { exitCode: 1, stderr: HARNESS_STDERR })), /^harness:/)
  assert.match(cls(runOf(ev({ type: 'error', message: 'HTTP 529 overloaded' }), { exitCode: 1 })), /^server:/)
  assert.match(cls(runOf(ev({ type: 'error', message: 'EACCES: open /x/.dsh/profiles/headless/cordis.yml' }), { exitCode: 1 })), /^harness:/, '顶层 error 带评测台指纹 → harness')
  assert.match(cls(runOf('', { timedOut: true, latencyMs: 300000 })), /^timeout:.*300000/)
  assert.match(cls(runOf(ev({ type: 'status', phase: 'turn_end', reason: { kind: 'error', error: { code: 'ECONNREFUSED' } } }), { exitCode: 1 })), /^network:/)
  assert.match(cls(runOf(ev({ type: 'status', phase: 'turn_end', reason: { kind: 'error', error: { message: '429 too many requests' } } }), { exitCode: 1 })), /^quota:/)
  assert.match(cls(runOf(ev({ type: 'status', phase: 'turn_end', reason: { kind: 'blocked' } }), { exitCode: 1 })), /^blocked:/)
  assert.match(cls(runOf(ev({ type: 'status', phase: 'turn_end', reason: { kind: 'max_tokens' } }), { exitCode: 1 })), /^max_tokens:/)
  assert.match(cls(runOf(ev({ type: 'session', sessionId: 's' }), { exitCode: 0 })), /^aborted:.*无 turn_end/)
  assert.match(cls(runOf(ev({ type: 'session', sessionId: 's' }), { exitCode: null, signal: 'SIGKILL' })), /^aborted:.*SIGKILL/)
  assert.match(cls(runOf('', { exitCode: 0 })), /^parse:/)
  assert.match(cls(runOf('', { spawnError: 'EACCES' })), /^harness:/)
})

test('redact / squash / tail：显式秘密与形态兜底', () => {
  assert.equal(redact(`x ${FAKE_KIMI} y`, [FAKE_KIMI]), 'x <redacted> y')
  assert.equal(redact(['Authorization:', 'Bearer', 'abcdefghijklmnop'].join(' ')), 'Authorization: Bearer <redacted>')
  assert.equal(redact(`Bearer ${'a'.repeat(24)}`), 'Bearer <redacted>')
  assert.equal(redact('Bearer abcdefghij'), 'Bearer abcdefghij', '短值不误伤')
  assert.equal(redact('k=sk-abcdefghijklmnop'), 'k=<redacted:token>')
  assert.equal(redact('short', ['ab']), 'short', '长度 <4 的秘密值不处理')
  assert.equal(redact('plain'), 'plain')
  assert.equal(redact(null), '')
  assert.equal(squash(' a  b\n c ', 5), 'a b c')
  assert.equal(squash('abcdef', 3), 'abc…')
  assert.equal(squash(undefined), '')
  assert.equal(tail('abcdef', 4), '…cdef')
  assert.equal(tail('ab', 4), 'ab')
})

/* ------------------------------------------------------------------ 判分与汇总 */

test('cellScore：0.7×确定性 + 0.3×裁判/10；失败 0；评测台故障 / 判分异常 null', () => {
  const row = (patch) => ({ status: 'completed', ok: true, errorClass: 'ok', deterministicScore: 0.5, judgeScore: 8, checkError: null, ...patch })
  assert.equal(cellScore(row({}), { judgeEnabled: false }), 0.5)
  assert.equal(cellScore(row({}), { judgeEnabled: true }), 0.59)
  assert.equal(cellScore(row({ judgeScore: null }), { judgeEnabled: true }), 0.5)
  assert.equal(cellScore(row({ ok: false, status: 'failed', errorClass: 'timeout' }), { judgeEnabled: true }), 0)
  assert.equal(cellScore(row({ status: 'skipped' }), { judgeEnabled: true }), null)
  assert.equal(cellScore(row({ errorClass: 'harness' }), { judgeEnabled: true }), null)
  assert.equal(cellScore(row({ checkError: 'boom', deterministicScore: null }), { judgeEnabled: true }), null)
  assert.equal(cellScore(row({ deterministicScore: null }), { judgeEnabled: false }), null)
})

const mkRow = (model, task, det, patch = {}) => {
  const ok = patch.ok ?? true
  return {
    model, task, rep: 1,
    status: ok ? 'completed' : 'failed',
    ok,
    errorClass: ok ? 'ok' : 'timeout',
    deterministicPass: ok && det === 1,
    deterministicScore: ok ? det : 0.111,
    failedChecks: ok && det === 1 ? [] : ['x'],
    checks: [], judgeScore: null, judgeReason: null, judgeError: null, judgeSelf: false,
    latencyMs: 1000, tokensTotal: 10_000, costUsd: null, checkError: null, reason: null, errorDetail: null,
    ...patch,
  }
}

/** 合成报告：spec = { model: { rows: { task: det | [det, patch] }, patch?, available? } }。 */
function mkReport(spec, { tasks = [...ALL_TASKS], judgeEnabled = false } = {}) {
  const rows = []
  const availability = []
  for (const [model, s] of Object.entries(spec)) {
    const available = s.available !== false
    availability.push({ model, available, errorClass: available ? 'ok' : 'auth', reason: available ? null : 'auth: 401', latencyMs: 1 })
    if (!available) {
      for (const t of tasks) rows.push(mkRow(model, t, 0, { status: 'skipped', errorClass: 'auth', deterministicScore: null, deterministicPass: null }))
      continue
    }
    for (const [t, v] of Object.entries(s.rows)) {
      const [det, extra] = Array.isArray(v) ? v : [v, {}]
      rows.push(mkRow(model, t, det, { ...s.patch, ...extra }))
    }
  }
  const report = {
    schema: 'model-eval/v1',
    generatedAt: '2026-11-23T08:00:00.000Z',
    config: { models: Object.keys(spec), tasks, reps: 1, timeoutMs: 1, judge: judgeEnabled ? 'j/x' : null, skipUnavailable: true, prices: null },
    availability,
    judge: { model: 'j/x', enabled: judgeEnabled, available: judgeEnabled, reason: null, tokensTotal: null, costUsd: null },
    rows,
    warnings: ['w1'],
    outDir: '/o',
  }
  return { ...report, summary: summarizeModels(report) }
}

test('summarizeModels / rankRoles：角色加权、覆盖不足与不可用不进推荐、patrol 成本扣分', () => {
  const all = Object.fromEntries(ALL_TASKS.map((t) => [t, 1]))
  const report = mkReport({
    'a/one': { rows: all, patch: { tokensTotal: 100_000 } },
    'b/two': { rows: Object.fromEntries(ALL_TASKS.map((t) => [t, 0.9])), patch: { tokensTotal: 50_000 } },
    'c/three': { rows: { ...all, t01: [0, { ok: false }] }, patch: { tokensTotal: 100_000 } },
    'd/four': { available: false },
    'e/five': { rows: { t01: 1, t02: 1 } },
  })
  const roles = rankRoles(report, report.summary)
  const mid = roles.find((r) => r.role === 'mid')
  assert.equal(mid.label, ROLE_LABELS.mid)
  assert.deepEqual(mid.ranking.map((e) => e.model), ['a/one', 'b/two', 'c/three', 'e/five', 'd/four'])
  assert.deepEqual(mid.ranking.map((e) => e.eligible), [true, true, true, false, false])
  assert.equal(mid.ranking[0].score, 1)
  assert.equal(mid.ranking[1].score, 0.9)
  assert.equal(mid.ranking[2].score, 0.875, 't01 失败格记 0：(0+2+1+1+2+1)/8')
  assert.match(mid.ranking[3].note, /覆盖不足（2\/6）/)
  assert.match(mid.ranking[4].note, /不可用（auth: 401）/)
  const patrol = roles.find((r) => r.role === 'patrol')
  assert.equal(patrol.ranking[0].model, 'a/one')
  assert.equal(patrol.ranking[0].costPenalty, COST_PENALTY)
  assert.equal(patrol.ranking[0].score, 0.95)
  assert.equal(patrol.ranking[1].score, 0.875, 'b：0.9 − 0.05×0.5')
  assert.equal(patrol.ranking[2].model, 'c/three')
  assert.equal(patrol.ranking[2].quality, 0.733)
  assert.deepEqual(roles.map((r) => r.role), ['mid', 'high', 'patrol'])

  const a = report.summary['a/one']
  assert.equal(a.passCount, 6)
  assert.equal(a.cellsRun, 6)
  assert.equal(a.avgDetScore, 1)
  assert.equal(a.cellsBroken, 0)
  const c = report.summary['c/three']
  assert.equal(c.passCount, 5)
  assert.equal(c.avgDetScore, 0.833, '失败格按 0 进平均')
  assert.deepEqual(c.failures, { timeout: 1 })
  assert.deepEqual(c.failedChecks, {}, '失败格空工位上的未过项不进统计')
  assert.equal(c.byTask.t01, 0)
  const d = report.summary['d/four']
  assert.equal(d.cellsPlanned, 6)
  assert.equal(d.cellsRun, 0)
  assert.equal(d.cellsSkipped, 6)
  assert.deepEqual(d.byTask, {})
  assert.equal(COVERAGE_MIN, 0.6)
})

test('rankRoles：裁判开启时格分掺入裁判分；同分按均时延、再按模型名', () => {
  const all = Object.fromEntries(ALL_TASKS.map((t) => [t, 1]))
  const report = mkReport({
    'a/one': { rows: all, patch: { judgeScore: 10 } },
    'b/two': { rows: Object.fromEntries(ALL_TASKS.map((t) => [t, 0.9])), patch: { judgeScore: 4 } },
    'c/three': { rows: all },
  }, { judgeEnabled: true })
  const mid = rankRoles(report, report.summary).find((r) => r.role === 'mid')
  assert.deepEqual(mid.ranking.map((e) => e.model), ['a/one', 'c/three', 'b/two'])
  assert.equal(mid.ranking[0].score, 1)
  assert.equal(mid.ranking[2].score, 0.75, '0.7×0.9 + 0.3×0.4')
  // 裁判关闭：c 与 b 的 mid 分 1 vs 0.9；这里再造同分：a 与 c 同分 → 比均时延
  const tie = mkReport({ 'z/late': { rows: all, patch: { latencyMs: 9000 } }, 'a/fast': { rows: all, patch: { latencyMs: 100 } }, 'm/mid': { rows: all, patch: { latencyMs: 5000 } } })
  assert.deepEqual(rankRoles(tie, tie.summary).find((r) => r.role === 'high').ranking.map((e) => e.model), ['a/fast', 'm/mid', 'z/late'])
})

test('renderMarkdown：六段齐全、无 undefined/[object Object]/NaN、宿主路径不进 md', () => {
  const all = Object.fromEntries(ALL_TASKS.map((t) => [t, 1]))
  const report = mkReport({ 'a/one': { rows: all }, 'd/four': { available: false } })
  const md = renderMarkdown({ ...report, roles: rankRoles(report, report.summary) })
  for (const h of ['## 1. 可用性预探', '## 2. 结果矩阵', '## 3. 逐模型汇总', '## 4. 逐任务明细', '## 5. 业务适配建议', '## 6. 警告与局限', '- w1']) assert.ok(md.includes(h), h)
  assert.match(md, /⏭ 跳过/)
  assert.match(md, /✅ 1\/1 · 1\.00/)
  assert.match(md, /\| 6\/6 \|/)
  assert.match(md, /（不推荐）不可用（auth: 401）/)
  assert.doesNotMatch(md, /undefined|\[object Object\]|NaN|\/o\b/)
  const sub = mkReport({ 'a/one': { rows: { t01: 1, t02: 1 } } }, { tasks: ['t01', 't02'] })
  assert.match(renderMarkdown({ ...sub, roles: rankRoles(sub, sub.summary) }), /本次只跑 2 个任务（t01、t02）/)
})

test('buildJudgePrompt / parseJudgeAnswer：只认首个扁平 JSON、夹到 0-10、产物条数与长度上限', () => {
  const artifacts = Array.from({ length: 10 }, (_, i) => ({ path: `out/${i}.txt`, content: `c${i}` }))
  const prompt = buildJudgePrompt({ taskId: 't04', taskPrompt: '# 任务', rubric: '- R1', artifacts })
  assert.ok(prompt.startsWith('你是任务 t04 的裁判'))
  assert.equal(prompt.split('\n### ').length - 1, MAX_ARTIFACTS)
  assert.match(prompt, /\n- R1\n/)
  assert.match(buildJudgePrompt({ taskId: 't04', taskPrompt: 'x'.repeat(4000), rubric: 'r', artifacts: [{ path: 'a', content: 'y'.repeat(7000) }] }), /（截断，共 4000 字符）/)
  assert.match(buildJudgePrompt({ taskId: 't04', taskPrompt: 'x', rubric: 'r' }), /【被测模型的产物】\n（无产物）/)
  assert.deepEqual(parseJudgeAnswer('{"score": 8, "reason": "好"}'), { score: 8, reason: '好' })
  assert.equal(parseJudgeAnswer('```json\n{"score":7,"reason":"可"}\n```').score, 7)
  assert.equal(parseJudgeAnswer('前缀 {"score": 9, "reason": "优"} 后缀').score, 9)
  assert.equal(parseJudgeAnswer('{"score": 12, "reason": "x"}').score, 10)
  assert.equal(parseJudgeAnswer('{"score": -3}').score, 0)
  assert.equal(parseJudgeAnswer('{"score": "6.4"}').score, 6)
  assert.equal(parseJudgeAnswer('{"score": 6.5}').score, 7)
  assert.equal(parseJudgeAnswer('{"reason": "无分"}'), null)
  assert.equal(parseJudgeAnswer('{"a":{"score": 5}}'), null, '嵌套对象不是合法作答')
  assert.equal(parseJudgeAnswer('没有 JSON'), null)
  assert.equal(parseJudgeAnswer(null), null)
  assert.equal(parseJudgeAnswer('{"score": 5, "reason": "r"}')?.reason, 'r')
  assert.equal(parseJudgeAnswer(`{"score": 5, "reason": "${'长'.repeat(300)}"}`).reason.length, MAX_REASON_CHARS)
})

/* ------------------------------------------------------------------ 安全员与工具 */

test('assertSafeOutDir：拒根 / 家目录及其上级 / 仓内 / 文件 / git 工作树根；临时目录可用', () => {
  const dir = tmpRoot('model-eval-out-')
  assert.equal(assertSafeOutDir(dir), resolve(dir))
  assert.equal(assertSafeOutDir(join(dir, 'not-yet')), join(dir, 'not-yet'))
  const file = join(dir, 'f')
  writeFileSync(file, 'x')
  assert.throws(() => assertSafeOutDir(file), /不是目录/)
  const home = tmpRoot('model-eval-home-')
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    assert.throws(() => assertSafeOutDir(home), /家目录/)
    assert.throws(() => assertSafeOutDir(dirname(home)), /家目录/)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
  }
  assert.throws(() => assertSafeOutDir(parse(dir).root), /文件系统根/)
  assert.throws(() => assertSafeOutDir(REPO_ROOT), /仓内/)
  assert.throws(() => assertSafeOutDir(join(REPO_ROOT, 'model-eval-x')), /仓内/)
  const git = join(dir, 'wt')
  mkdirSync(join(git, '.git'), { recursive: true })
  assert.throws(() => assertSafeOutDir(git), /git 工作树根/)
})

test('findAgentsMd / collectArtifacts / readPriceTable', () => {
  const dir = tmpRoot('model-eval-art-')
  mkdirSync(join(dir, 'a', 'b'), { recursive: true })
  writeFileSync(join(dir, 'AGENTS.md'), '# x\n')
  assert.equal(findAgentsMd(join(dir, 'a', 'b')), join(dir, 'AGENTS.md'))
  assert.equal(findAgentsMd(join(dir, 'a')), join(dir, 'AGENTS.md'))
  assert.equal(findAgentsMd(dir), join(dir, 'AGENTS.md'))

  // 只读输入类（工位含 fixtures/ 子目录）：fixtures/ 整个排除
  const nested = join(dir, 'nested')
  for (const f of ['fixtures/a.md', 'decision.md', 'notes/.DS_Store']) mkdirSync(dirname(join(nested, f)), { recursive: true }), writeFileSync(join(nested, f), f)
  assert.deepEqual(collectArtifacts(nested, null).map((a) => a.path), ['decision.md'])
  // 工作树类（无 fixtures/ 子目录）：只取相对原件有变化的文件
  const src = join(dir, 'src')
  for (const f of ['README.md', 'lib/x.ts']) mkdirSync(dirname(join(src, f)), { recursive: true }), writeFileSync(join(src, f), `orig ${f}`)
  const tree = join(dir, 'tree')
  for (const f of ['README.md', 'lib/x.ts']) mkdirSync(dirname(join(tree, f)), { recursive: true }), writeFileSync(join(tree, f), `orig ${f}`)
  writeFileSync(join(tree, 'lib', 'x.ts'), 'changed')
  mkdirSync(join(tree, 'out'), { recursive: true })
  writeFileSync(join(tree, 'out', 'result.json'), '{}')
  assert.deepEqual(collectArtifacts(tree, src).map((a) => a.path), ['lib/x.ts', 'out/result.json'])
  assert.deepEqual(collectArtifacts(tree, null).map((a) => a.path), ['README.md', 'lib/x.ts', 'out/result.json'])

  const prices = join(dir, 'prices.json')
  writeFileSync(prices, '{"a/b": {"input": 1}}')
  assert.deepEqual(readPriceTable(prices), { 'a/b': { input: 1 } })
  assert.equal(readPriceTable(null), null)
  writeFileSync(prices, '[1]')
  assert.throws(() => readPriceTable(prices), /JSON 对象/)
  writeFileSync(prices, '{oops')
  assert.throws(() => readPriceTable(prices), SyntaxError)
})
