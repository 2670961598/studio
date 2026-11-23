#!/usr/bin/env node
/**
 * blind.mjs —— 盲评包生成（匿名化 + 定种子洗牌）与评分汇总（跨评审均值 + 一致性）
 *
 * 用法：
 *   node scripts/ops/model-eval/benchmark/blind.mjs build --reports <…> --out <dir> [--seed <种子>] [--with-final-text]
 *   node scripts/ops/model-eval/benchmark/blind.mjs aggregate --package <dir> --scores <甲.csv[,乙.csv]> [--reviewers "甲,乙"] [--out <dir>]
 *
 * build    从评测报告的有效样本格（OK / TASK_FAIL）生成盲评包：items/S-xxx/{TASK.md, TASK-RUBRIC.md, output/**}；
 *          mapping.json = 匿名钥匙（评审不得打开）；scoresheet.csv = 评分表模板；leak-scan.json = 产物里的品牌词命中。
 *          同种子 → 同顺序（可复现）；--out 必须为空目录（盲评包不混批次）。
 * aggregate 读评分表 + 钥匙 → blind-result.json / blind-result.md（items[].total 供 stats.mjs --blind 折分）。
 * 退出码：0 = 已写出；2 = 用法错；1 = 内部错。
 * 口径：docs/quality/benchmark-business-eval.md §3.3、benchmark/rubric.md。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError } from '../lib/args.mjs'
import { collectArtifacts } from '../lib/evaluate.mjs'
import { listTasks, loadCheck, renderPromptFile } from '../lib/tasks.mjs'
import { aggregateSheets, buildPlan, leakScan, parseSheet, renderBlindMarkdown, SHEET_HEADER } from './lib/blind-core.mjs'
import { EVAL_DIR, HERE, loadReports, outLine, parseFlagArgs, parseList, readJson, safeOut, writeFileAtomic } from './lib/io.mjs'
import { mergeReports } from './lib/merge.mjs'

const USAGE = `用法：
  node scripts/ops/model-eval/benchmark/blind.mjs build --reports <report.json|目录>[,…] --out <dir> [--seed <种子>] [--with-final-text]
  node scripts/ops/model-eval/benchmark/blind.mjs aggregate --package <dir> --scores <甲.csv[,乙.csv]> [--reviewers "甲,乙"] [--out <dir>]`

/** 单个产物文件入包上限（超限不入包，记在 mapping.items[].skipped）。 */
const MAX_FILE_BYTES = 512 * 1024
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function readme(seed, count) {
  return `# 盲评包（匿名）

本包含 ${count} 个条目，**不含模型身份**。匿名钥匙 \`mapping.json\` 由第三人保管，**评审不得打开**。

## 条目结构

\`items/S-xxx/\`：
- \`TASK.md\` —— 模型收到的任务书原文（评测台渲染后的字节）
- \`TASK-RUBRIC.md\` —— 本任务的业务质量要点（评测台裁判 rubric 原文，供参考）
- \`output/\` —— 模型产物（工作树类任务只含相对原件有变化的文件）

## 流程

1. 评审（≥2 人）各自先读 \`rubric.md\` 的维度与锚点；挑 2 条条目试评对齐锚点，**不互看、不商量**。
2. 各自复制一份 \`scoresheet.csv\` 独立打分（\`reviewer\` 列填自己的代号；分值 0–3 整数；不确定写进 \`notes\`）。
3. 交回后由持钥匙者汇总：
   \`node scripts/ops/model-eval/benchmark/blind.mjs aggregate --package <本目录> --scores <甲.csv,乙.csv> --reviewers "甲,乙"\`
4. 跨评审总分极差 > 2 的条目进第三人仲裁；未评条目不进均值。

## 禁止

- 搜索条目内容、按行文风格猜模型、相互打听评分；
- 改动 \`output/\` 任何文件。

洗牌种子：\`${seed}\`（同种子同顺序；只影响条目编号，不含身份信息）。
`
}

/** 目录下全部文本文件（递归），用于「模型读到的输入」的品牌词参照；不存在 → 空数组。 */
function readTreeText(root) {
  if (!existsSync(root)) return []
  const out = []
  for (const rel of readdirSync(root, { recursive: true })) {
    const abs = join(root, String(rel))
    if (!statSync(abs).isFile() || abs.endsWith('.DS_Store') || statSync(abs).size > MAX_FILE_BYTES) continue
    out.push(readFileSync(abs, 'utf8'))
  }
  return out
}

async function build(a) {
  const loaded = loadReports(a.reports)
  const cells = mergeReports(loaded.map((x) => x.report))
  const seed = a.seed ?? 'benchmark'
  const plan = buildPlan(cells, { seed })
  if (plan.length === 0) throw new UsageError('无有效样本格（OK / TASK_FAIL）可入盲评包；先看 stats.mjs 的覆盖与失败分类')
  const out = safeOut(a.out ?? join(dirname(loaded[0].file), 'blind'))
  if (existsSync(out) && readdirSync(out).length > 0) throw new UsageError(`--out 已存在且非空（盲评包不混批次）：${basename(out)}`)
  const tasks = listTasks(join(a['eval-dir'] ?? EVAL_DIR, 'tasks'))
  const items = {}
  const leak = []
  const rows = [SHEET_HEADER.join(',')]
  for (const p of plan) {
    const task = tasks.find((t) => t.slug === p.taskSlug) ?? tasks.find((t) => t.id === p.task)
    if (!task) throw new Error(`评测台里找不到任务：${p.taskSlug}`)
    const dir = join(out, 'items', p.anon)
    const files = []
    const put = (rel, text) => {
      const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8')
      const abs = join(dir, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, buf)
      files.push({ path: rel, sha256: sha(buf), bytes: buf.length })
    }
    put('TASK.md', renderPromptFile(join(task.dir, 'prompt.md')))
    const { rubric } = await loadCheck(task)
    if (rubric) put('TASK-RUBRIC.md', `# 本任务业务质量要点（评测台裁判 rubric 原文，供盲评参考）\n\n${rubric.trim()}\n`)
    const fixturesSource = existsSync(join(task.dir, 'fixtures')) ? join(task.dir, 'fixtures') : null
    const skipped = []
    for (const art of collectArtifacts(p.outputPath, fixturesSource)) {
      const abs = join(p.outputPath, art.path)
      const bytes = statSync(abs).size
      if (bytes > MAX_FILE_BYTES) skipped.push({ path: art.path, bytes })
      else put(`output/${art.path}`, readFileSync(abs))
    }
    if (a['with-final-text'] && p.finalText) put('FINAL_MESSAGE.md', p.finalText)
    const text = files.filter((f) => f.path.startsWith('output/')).map((f) => readFileSync(join(dir, f.path), 'utf8')).join('\n')
    // 任务材料本身会提到品牌（如路由名、冷却源）：产物里复述材料事实不算泄漏；
    // 只把「模型读到的输入（任务书 + fixtures）里没出现过的品牌词」标为可疑
    const taskHits = leakScan([readFileSync(join(dir, 'TASK.md'), 'utf8'), ...readTreeText(join(task.dir, 'fixtures'))].join('\n'))
    const hits = leakScan(text).map((h) => ({ ...h, inTask: taskHits.find((t) => t.brand === h.brand)?.count ?? 0 }))
    const suspicious = hits.filter((h) => h.inTask === 0).length
    if (hits.length > 0) leak.push({ item: p.anon, suspicious, hits })
    items[p.anon] = { model: p.model, task: p.task, rep: p.rep, taskSlug: p.taskSlug, files, skipped }
    rows.push(`${p.anon},,,,,,,`)
  }
  writeFileAtomic(join(out, 'mapping.json'), `${JSON.stringify({
    schema: 'model-eval-blind-package/v1',
    seed,
    created: new Date().toISOString(),
    reviewersRequired: 2,
    items,
  }, null, 2)}\n`)
  writeFileAtomic(join(out, 'scoresheet.csv'), `${rows.join('\n')}\n`)
  copyFileSync(join(HERE, 'rubric.md'), join(out, 'rubric.md'))
  writeFileAtomic(join(out, 'README.md'), readme(seed, plan.length))
  writeFileAtomic(join(out, 'leak-scan.json'), `${JSON.stringify({ scanned: plan.length, flagged: leak.length, suspicious: leak.filter((x) => x.suspicious > 0).length, items: leak }, null, 2)}\n`)
  outLine({ package: out, items: plan.length, leakFlagged: leak.length, leakSuspicious: leak.filter((x) => x.suspicious > 0).length, mapping: join(out, 'mapping.json'), scoresheet: join(out, 'scoresheet.csv') })
  return 0
}

/** 一份评分表 → 按评审代号拆成若干份（列里的 reviewer 优先于 --reviewers / 文件名）。 */
function splitByReviewer(file, fallbackName) {
  const name = fallbackName ?? basename(file).replace(/\.csv$/i, '')
  const sheet = parseSheet(readFileSync(resolve(file), 'utf8'), { reviewer: name })
  if (sheet.rows.length === 0) throw new UsageError(`评分表无合法行：${basename(file)}`)
  const groups = new Map()
  for (const r of sheet.rows) {
    if (!groups.has(r.reviewer)) groups.set(r.reviewer, [])
    groups.get(r.reviewer).push(r)
  }
  return { sheets: [...groups].map(([reviewer, rows]) => ({ reviewer, rows })), errors: sheet.errors.map((e) => `${basename(file)}：${e}`) }
}

function aggregate(a) {
  if (!a.package) throw new UsageError('--package 必填')
  const pkg = resolve(a.package)
  const mapping = readJson(join(pkg, 'mapping.json'), 'mapping.json')
  if (mapping?.schema !== 'model-eval-blind-package/v1' || typeof mapping.items !== 'object') {
    throw new UsageError('mapping.json 不是盲评包钥匙（schema 不符）')
  }
  const plan = Object.entries(mapping.items).map(([anon, m]) => ({ anon, model: m.model, task: m.task, rep: m.rep }))
  const files = parseList(a.scores)
  if (files.length === 0) throw new UsageError('--scores 必填：至少一份评分表 csv')
  const names = parseList(a.reviewers)
  const sheets = []
  const errors = []
  files.forEach((f, i) => {
    const r = splitByReviewer(f, names[i])
    sheets.push(...r.sheets)
    errors.push(...r.errors)
  })
  const dup = sheets.map((s) => s.reviewer).filter((n, i, all) => all.indexOf(n) !== i)
  if (dup.length > 0) throw new UsageError(`评审代号重复（同一人只能交一份表）：${[...new Set(dup)].join(', ')}`)
  const result = aggregateSheets(sheets, plan)
  result.inputs = { package: basename(pkg), sheets: files.map((f) => basename(f)), errors }
  const out = safeOut(a.out ?? join(pkg, 'result'))
  writeFileAtomic(join(out, 'blind-result.json'), `${JSON.stringify(result, null, 2)}\n`)
  const markdown = join(out, 'blind-result.md')
  writeFileAtomic(markdown, renderBlindMarkdown(result))
  outLine({ result: join(out, 'blind-result.json'), markdown, reviewers: result.reviewers.length, scored: result.items.length - result.unScored.length, adjudication: result.adjudication.length })
  return 0
}

export async function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'build') return build(parseFlagArgs(rest, { reports: {}, out: {}, seed: {}, 'with-final-text': { type: 'bool' }, 'eval-dir': {} }))
  if (cmd === 'aggregate') return aggregate(parseFlagArgs(rest, { package: {}, scores: {}, reviewers: {}, out: {} }))
  throw new UsageError(cmd ? `未知子命令：${cmd}` : '缺子命令（build / aggregate）')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (e) {
    const usage = e?.name === 'UsageError'
    process.stderr.write(`${usage ? '用法错' : '内部错'}：${e?.message ?? e}\n${usage ? `\n${USAGE}\n` : `${e?.stack ?? ''}\n`}`)
    process.exitCode = usage ? 2 : 1
  }
}
