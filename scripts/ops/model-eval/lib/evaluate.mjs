/**
 * evaluate.mjs —— 评测编排内核（run.mjs 调它；真进程/宿主凭据一律经 deps 注入，测试用 fake）
 *
 * 流程：任务发现 → overlay 落盘 → 逐模型可用性预探（1 次最小调用；失败记原因、缺省跳过该模型
 * 其余格子）→ 顺序跑 (模型×任务×重复)，每格临时工位整拷 fixtures、跑 dsh、确定性 check →
 * （可选）固定裁判逐格打分 → 汇总（report.mjs）。
 * 纪律：永不整体失败于某模型不可用；工位只在 outDir 下；错误文本过脱敏；证据（NDJSON/stderr）留档。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { listTasks, loadCheck, prepareWorkdir, renderPromptFile, resolveTasks } from './tasks.mjs'
import { buildChildEnv, renderOverlay } from './overlay.mjs'
import { PROBE_PROMPT, dshArgs } from './exec.mjs'
import { summarizeRun, usageTotal } from './ndjson.mjs'
import { classifyRun } from './errors.mjs'
import { redact, squash, tail } from './redact.mjs'
import { listFiles, readTextIfExists } from './check-utils.mjs'
import { buildJudgePrompt, parseJudgeAnswer } from '../judge.mjs'
import { summarize } from './report.mjs'

export const KIMI_PROVIDER = 'kimi-coding'
export const SCHEMA = 'model-eval/v1'
/** 本仓根（本文件在 scripts/ops/model-eval/lib/ 下，上溯四级）。 */
export const REPO_ROOT = resolve(dirname(import.meta.filename), '..', '..', '..', '..')

function isWithin(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * outDir 安全员：临时区/普通目录可用；文件系统根、家目录或其上级、本仓内、任何 git 工作树根
 * 一律拒绝（评测产物永不落仓/落公司目录）。返回解析后的绝对路径。
 */
export function assertSafeOutDir(outDir) {
  const abs = resolve(String(outDir))
  if (dirname(abs) === abs) throw new Error(`--out 不能是文件系统根：${abs}`)
  const home = resolve(homedir())
  if (isWithin(home, abs)) throw new Error(`--out 不能是家目录或其上级：${abs}`)
  if (isWithin(abs, REPO_ROOT)) throw new Error(`--out 不得落在仓内（AGENTS §五.6：仓里不出现运行产物）：${abs}`)
  if (existsSync(abs)) {
    if (!statSync(abs).isDirectory()) throw new Error(`--out 已存在且不是目录：${abs}`)
    if (existsSync(join(abs, '.git'))) throw new Error(`--out 是一个 git 工作树根，拒绝写入：${abs}`)
  }
  return abs
}

/** 工位祖先里若挂着 AGENTS.md，dsh 会把它注入被测模型上下文（污染评测）——预警用。 */
export function findAgentsMd(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    const cand = join(dir, 'AGENTS.md')
    if (existsSync(cand)) return cand
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * 供裁判看的产物：工位里除 fixtures/ 子目录外的文件；无 fixtures/ 子目录（工位即工作树）时
 * 只取相对原件有变化的文件。
 */
export function collectArtifacts(dir, fixturesSource) {
  let files = listFiles(dir)
  if (existsSync(join(dir, 'fixtures'))) {
    files = files.filter((f) => !f.startsWith('fixtures/'))
  } else {
    const src = fixturesSource === null ? [] : listFiles(fixturesSource)
    files = files.filter((f) => {
      const a = readTextIfExists(join(dir, f))
      const b = src.includes(f) ? readTextIfExists(join(fixturesSource, f)) : null
      return a !== b
    })
  }
  return files
    .filter((f) => !/(^|\/)\.DS_Store$/.test(f))
    .sort()
    .map((path) => ({ path, content: readTextIfExists(join(dir, path)) ?? '' }))
}

function emptyRow(base, patch) {
  return {
    ok: false,
    status: 'skipped',
    deterministicPass: null,
    deterministicScore: null,
    failedChecks: [],
    checks: [],
    judgeScore: null,
    judgeReason: null,
    judgeError: null,
    judgeSelf: false,
    latencyMs: null,
    tokens: null,
    tokensTotal: null,
    toolCalls: null,
    toolErrors: null,
    steps: null,
    sessionId: null,
    errorClass: null,
    errorDetail: null,
    reason: null,
    finalText: null,
    outputPath: null,
    checkError: null,
    costUsd: null,
    ...base,
    ...patch,
  }
}

function addUsage(total, usage) {
  if (usage === null || typeof usage !== 'object') return total
  if (total === null) total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 }
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'steps']) total[k] += usage[k] ?? 0
  return total
}

function estimateCost(tokens, priceTable, modelRef) {
  const p = priceTable?.[modelRef.id] ?? priceTable?.[modelRef.model]
  if (!p || tokens === null || tokens === undefined) return null
  const per = Number(p.per ?? 1_000_000)
  const sum = (n, rate) => (Number.isFinite(n) && Number.isFinite(Number(rate)) ? n * Number(rate) : 0)
  const usd = (sum(tokens.input, p.input) + sum(tokens.output, p.output) + sum(tokens.cacheRead, p.cacheRead) + sum(tokens.cacheWrite, p.cacheWrite)) / per
  return Number.isFinite(usd) ? Math.round(usd * 10_000) / 10_000 : null
}

function defaultRubric(task) {
  return `- 产物完整、满足任务说明的形式要求（5 分）\n- 内容正确、结论有据（5 分）【${task.slug} 未提供 rubric，此为缺省依据】`
}

/**
 * 跑一轮评测。config = parseArgs() 结果 + { dshBin, tasksDir, priceTable? }；
 * deps = { exec, readKimiToken, env, log, now }（均可注入；exec 入参/返回同 exec.execDsh）。
 * 返回 report 对象（report.json 的内容；已含 summary/roles）。
 */
export async function runEval(config, deps) {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => new Date())
  const env = deps.env ?? process.env
  const readKimiToken = deps.readKimiToken ?? (() => ({ token: null, reason: 'readKimiToken 未注入' }))
  const allTasks = listTasks(config.tasksDir)
  const tasks = resolveTasks(allTasks, config.tasks)
  if (tasks.length === 0) throw new Error('没有可跑的任务')
  const checks = new Map()
  const prompts = new Map()
  for (const task of tasks) {
    checks.set(task.slug, await loadCheck(task))
    prompts.set(task.slug, renderPromptFile(join(task.dir, 'prompt.md'))) // include 缺失在这里就抛
  }

  const outDir = assertSafeOutDir(config.out)
  mkdirSync(outDir, { recursive: true })
  const realOut = realpathSync(outDir)
  const overlayDir = join(realOut, 'overlays')
  const logDir = join(realOut, 'logs')
  mkdirSync(overlayDir, { recursive: true })
  mkdirSync(logDir, { recursive: true })

  const warnings = []
  if (tasks.length < allTasks.length) warnings.push(`只跑了 ${tasks.length}/${allTasks.length} 个任务：角色排序仅基于所跑任务，不代表完整档位结论`)
  const secrets = []
  const wantsKimi = config.modelRefs.some((m) => m.provider === KIMI_PROVIDER) || config.judgeRef?.provider === KIMI_PROVIDER
  const kimi = wantsKimi ? readKimiToken() : null
  if (kimi?.token) {
    secrets.push(kimi.token)
    if (typeof kimi.ageMs === 'number' && kimi.ageMs > 15 * 60_000) {
      warnings.push(`kimi token 文件写入于 ${Math.round(kimi.ageMs / 60_000)} 分钟前（access token 有效期 15 分钟），预探大概率 auth 失败；刷新走 kimi-token-refresh.mjs，本评测不代刷`)
    }
  }

  const callModel = async (ref, { text, cwd, label, timeoutMs }) => {
    const overlayPath = join(overlayDir, `${ref.slug}.yml`)
    writeFileSync(overlayPath, renderOverlay(ref), 'utf8')
    mkdirSync(cwd, { recursive: true })
    const childEnv = buildChildEnv(env, { kimiToken: ref.provider === KIMI_PROVIDER ? kimi?.token ?? null : null })
    log(`[${label}] ${ref.id} …`)
    const run = await deps.exec({ cmd: config.dshBin, args: dshArgs(overlayPath, text), cwd, env: childEnv, timeoutMs, model: ref.id })
    const summary = summarizeRun(run)
    const outcome = classifyRun(summary)
    outcome.errorDetail = redact(squash(outcome.errorDetail, 400), secrets)
    outcome.reason = outcome.ok ? null : redact(outcome.reason, secrets)
    if (label !== 'probe') {
      writeFileSync(join(logDir, `${ref.slug}__${label}.ndjson`), redact(run.stdout ?? '', secrets), 'utf8')
      if (run.stderr) writeFileSync(join(logDir, `${ref.slug}__${label}.stderr.log`), redact(tail(run.stderr, 200_000), secrets), 'utf8')
    }
    log(`[${label}] ${ref.id} ${outcome.ok ? 'ok' : outcome.reason} ${summary.latencyMs ?? '?'}ms`)
    return { summary, outcome }
  }

  // 1) 可用性预探：逐模型 1 次最小调用；失败 → 记原因，不阻塞其它模型
  const availability = []
  const availByModel = new Map()
  let agentsWarned = false
  const probe = async (ref) => {
    if (availByModel.has(ref.id)) return availByModel.get(ref.id)
    const rec = { model: ref.id, available: false, errorClass: null, reason: null, latencyMs: null }
    if (ref.provider === KIMI_PROVIDER && !kimi?.token) {
      rec.errorClass = 'auth'
      rec.reason = `kimi token 不可用：${kimi?.reason ?? '未知原因'}`
    } else {
      const r = await callModel(ref, { text: PROBE_PROMPT, cwd: join(realOut, 'probe', ref.slug), timeoutMs: config.probeTimeoutMs, label: 'probe' })
      rec.available = r.outcome.ok
      rec.errorClass = r.outcome.errorClass
      rec.reason = r.outcome.reason
      rec.latencyMs = r.summary.latencyMs ?? null
    }
    availByModel.set(ref.id, rec)
    availability.push(rec)
    return rec
  }
  const warnAgentsMd = (dir) => {
    if (!agentsWarned && findAgentsMd(dir) !== null) {
      agentsWarned = true
      warnings.push('工位祖先目录存在 AGENTS.md：dsh 会把它注入被测模型上下文，评测口径被污染')
    }
  }
  for (const ref of config.modelRefs) await probe(ref)

  // 2) 逐格运行 + 确定性判分
  const rows = []
  for (const ref of config.modelRefs) {
    const avail = availByModel.get(ref.id)
    for (const task of tasks) {
      for (let rep = 1; rep <= config.reps; rep += 1) {
        const base = { model: ref.id, provider: ref.provider, modelId: ref.model, task: task.id, taskSlug: task.slug, rep }
        if (!avail.available && config.skipUnavailable) {
          rows.push(emptyRow(base, { status: 'skipped', errorClass: avail.errorClass, reason: avail.reason }))
          continue
        }
        const label = `${task.slug}__r${rep}`
        const workdir = join(realOut, 'work', `${ref.slug}__${label}`)
        rmSync(workdir, { recursive: true, force: true }) // 路径由已校验的 slug/任务目录名/rep 拼出，且在 outDir/work 下
        const { dir } = prepareWorkdir(task, workdir)
        warnAgentsMd(dir)
        const r = await callModel(ref, { text: prompts.get(task.slug), cwd: dir, timeoutMs: config.timeoutMs, label })
        const row = emptyRow(base, {
          status: r.outcome.ok ? 'completed' : 'failed',
          ok: r.outcome.ok,
          errorClass: r.outcome.errorClass,
          errorDetail: r.outcome.ok ? null : r.outcome.errorDetail,
          reason: r.outcome.reason,
          latencyMs: r.summary.latencyMs ?? null,
          tokens: r.summary.usage,
          tokensTotal: usageTotal(r.summary.usage),
          toolCalls: r.summary.toolCalls,
          toolErrors: r.summary.toolErrors,
          steps: r.summary.steps,
          sessionId: r.summary.sessionId,
          finalText: redact(squash(r.summary.finalText ?? r.summary.lastText, 400), secrets),
          outputPath: dir,
        })
        try {
          const res = await checks.get(task.slug).check({ dir, fixturesSource: join(task.dir, 'fixtures') })
          row.deterministicPass = res.pass === true
          row.deterministicScore = res.score
          row.checks = res.checks
          row.failedChecks = res.checks.filter((c) => !c.ok).map((c) => c.id)
        } catch (err) {
          // 判分脚本自己抛了 = 评测台问题：记 checkError、该格不计分（cellScore → null），不冒记到模型头上
          row.checkError = redact(squash(err?.message ?? String(err), 300), secrets)
          row.deterministicPass = false
          row.deterministicScore = null
        }
        row.costUsd = estimateCost(row.tokens, config.priceTable, ref)
        rows.push(row)
      }
    }
  }

  // 3) LLM 裁判（固定模型；失败不阻塞）
  const judge = { model: config.judgeRef?.id ?? null, enabled: config.judgeRef != null, available: null, reason: null, tokens: null, tokensTotal: null, costUsd: null }
  if (config.judgeRef) {
    const jr = await probe(config.judgeRef)
    judge.available = jr.available
    judge.reason = jr.reason
    let usage = null
    for (const row of rows) {
      row.judgeSelf = row.model === config.judgeRef.id
      if (!judge.available || row.status !== 'completed') continue
      const task = tasks.find((t) => t.slug === row.taskSlug)
      const prompt = buildJudgePrompt({
        taskId: task.id,
        taskPrompt: prompts.get(task.slug),
        rubric: checks.get(task.slug).rubric ?? defaultRubric(task),
        artifacts: collectArtifacts(row.outputPath, join(task.dir, 'fixtures')),
      })
      const tag = `${row.model.replace('/', '__')}__${task.slug}__r${row.rep}`
      const r = await callModel(config.judgeRef, { text: prompt, cwd: join(realOut, 'judge', tag), timeoutMs: config.timeoutMs, label: `judge__${tag}` })
      usage = addUsage(usage, r.summary.usage)
      if (!r.outcome.ok) {
        row.judgeError = r.outcome.errorClass
        continue
      }
      const parsed = parseJudgeAnswer(r.summary.finalText ?? r.summary.lastText)
      if (parsed === null) row.judgeError = 'parse'
      else {
        row.judgeScore = parsed.score
        row.judgeReason = redact(parsed.reason, secrets)
      }
    }
    judge.tokens = usage
    judge.tokensTotal = usageTotal(usage)
    judge.costUsd = estimateCost(usage, config.priceTable, config.judgeRef)
    if (rows.some((r) => r.judgeSelf)) warnings.push('裁判与部分被测模型相同（judgeSelf=true）：该部分格子不独立，读报告时降权')
  }
  const checkErrors = rows.filter((r) => r.checkError !== null)
  if (checkErrors.length > 0) warnings.push(`${checkErrors.length} 个格子的确定性检查脚本报错（评测台问题，未计分）：${checkErrors[0].model} ${checkErrors[0].taskSlug} r${checkErrors[0].rep} —— ${checkErrors[0].checkError}`)
  if (config.reps < 3) warnings.push(`--reps=${config.reps}：单次抽样，时延/通过率有随机性；正式对比建议 --reps 3`)

  return summarize({
    schema: SCHEMA,
    generatedAt: now().toISOString(),
    config: {
      models: config.modelRefs.map((m) => m.id),
      tasks: tasks.map((t) => t.id),
      reps: config.reps,
      timeoutMs: config.timeoutMs,
      judge: judge.model,
      skipUnavailable: config.skipUnavailable,
      prices: config.priceTable ? Object.keys(config.priceTable) : null,
    },
    dshBin: config.dshBin,
    outDir: realOut,
    availability,
    judge,
    rows,
    warnings,
  })
}

/** 读可选价目表（{ "provider/model": { input, output, cacheRead?, cacheWrite?, per? } }，USD/百万 tokens）。 */
export function readPriceTable(file) {
  if (file === null || file === undefined) return null
  const obj = JSON.parse(readFileSync(file, 'utf8'))
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('价目表须为 JSON 对象')
  return obj
}
