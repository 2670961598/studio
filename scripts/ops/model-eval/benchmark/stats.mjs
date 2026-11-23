#!/usr/bin/env node
/**
 * stats.mjs —— 统计协议执行器：合并多批次评测报告 → 覆盖 / 均值 / 极差 / 95% 区间 / 配对差分 / 失败分类
 *
 * 用法：node scripts/ops/model-eval/benchmark/stats.mjs --reports <a/report.json|目录>[,…] [选项]
 *   --reports      一或多份 model-eval/v1 报告（逗号分隔；给目录 = 取其下 report.json）。多份按生成时间
 *                  当作同一评测的连续批次：设施侧失败的重跑批次直接追加进来，由本工具按重试规则定稿
 *   --out          输出目录（默认 <首份报告目录>/stats；仓外）→ stats.json + stats.md
 *   --eval-dir     指纹参照用的评测台目录（默认 = 本工具所属的 scripts/ops/model-eval）
 *   --fingerprint  与各批次同目录归档的 fingerprint.json（逗号分隔）→ 核对控制变量是否对齐
 *   --blind        blind.mjs aggregate 的 blind-result.json → 把盲评分按 0.7/0.3 折进格分
 *   --with-judge   运行带了 LLM 裁判时，把裁判分按 0.7/0.3 折进格分（裁判 ≠ 盲评，仅过渡用）
 *   --min-reps / --formal-reps  覆盖协议阈值（默认 2 / 3；仅用于敏感性查看，报告照录实际值）
 * 退出码：0 = 已写出；2 = 用法错；1 = 内部错。stdout 末行 JSON：{"stats","markdown","cells","valid","level"}。
 * 口径：docs/quality/benchmark-business-eval.md §5（统计协议）。
 */
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError } from '../lib/args.mjs'
import { fingerprintEvalDir, diffFingerprints } from './lib/fingerprint-core.mjs'
import { EVAL_DIR, loadReports, outLine, parseFlagArgs, parseList, readJson, safeOut, writeFileAtomic } from './lib/io.mjs'
import { applyBlind, applyJudge, buildStats, PROTOCOL } from './lib/matrix.mjs'
import { mergeReports } from './lib/merge.mjs'
import { renderStatsMarkdown } from './lib/render-stats.mjs'

const USAGE = `用法：node scripts/ops/model-eval/benchmark/stats.mjs --reports <a/report.json|目录>[,…] [--out <dir>] [--fingerprint <fp.json[,…]>]
       [--blind <blind-result.json>] [--with-judge]
       [--eval-dir <dir>] [--min-reps 2] [--formal-reps 3]`

const short = (hex) => (typeof hex === 'string' ? hex.slice(0, 12) : null)

/** 指纹核对：参照 = 当前评测台目录；逐份比对已归档指纹。 */
function checkFingerprints(spec, evalDir) {
  const ref = fingerprintEvalDir(evalDir)
  const reference = { harness: short(ref.harness.sha256), all: short(ref.all.sha256), tasks: Object.keys(ref.tasks).length }
  const provided = parseList(spec).map((part) => {
    const fp = readJson(resolve(part), '指纹文件')
    const diffs = diffFingerprints(ref, fp)
    return { file: basename(part), harness: short(fp?.harness?.sha256), all: short(fp?.all?.sha256), matchesReference: diffs.length === 0, diffs }
  })
  return {
    reference,
    provided,
    consistent: provided.length === 0 ? null : provided.every((p) => p.matchesReference),
    mismatches: provided.filter((p) => !p.matchesReference).map((p) => ({ file: p.file, diffs: p.diffs })),
    note: provided.length === 0
      ? '未提供批次指纹；参照取自当前评测台目录（跑后取）。正式对比须在每次跑前用 fingerprint.mjs --out 归档。'
      : undefined,
  }
}

export function main(argv) {
  const a = parseFlagArgs(argv, {
    reports: {},
    out: {},
    'eval-dir': {},
    fingerprint: {},
    blind: {},
    'with-judge': { type: 'bool' },
    'min-reps': { type: 'int', default: PROTOCOL.minReps },
    'formal-reps': { type: 'int', default: PROTOCOL.formalReps },
  })
  if (!a.reports) throw new UsageError('--reports 必填：至少一份 report.json 或其所在目录')
  const loaded = loadReports(a.reports)
  const reports = loaded.map((x) => Object.assign(x.report, { __file: x.label }))
  const cells = mergeReports(reports)

  let mode = 'det'
  let folded = 0
  if (a.blind) {
    const blind = readJson(resolve(a.blind), '盲评结果')
    folded = applyBlind(cells, blind?.items ?? [])
    mode = 'det+blind'
  } else if (a['with-judge']) {
    folded = applyJudge(cells)
    mode = 'det+judge'
  }
  const scoring = {
    mode,
    folded,
    note: mode === 'det'
      ? '仅确定性分（本次未折主观分）'
      : mode === 'det+blind'
        ? `格分 = 0.7×确定性 + 0.3×(盲评总分/12)，已折入 ${folded} 格；未折入的格仍用确定性分`
        : `格分 = 0.7×确定性 + 0.3×(裁判分/10)，已折入 ${folded} 格；LLM 裁判只是盲评的过渡替身（judgeSelf 风险见规范 §3.4）`,
  }

  const stats = buildStats(reports, cells, { minReps: a['min-reps'], formalReps: a['formal-reps'] })
  stats.fingerprints = checkFingerprints(a.fingerprint, a['eval-dir'] ?? EVAL_DIR)
  stats.scoring = scoring
  stats.cells = cells.map((c) => ({
    key: c.key,
    model: c.model,
    task: c.task,
    rep: c.rep,
    final: {
      cls: c.final.cls,
      side: c.final.side,
      score: c.final.score,
      scoreFinal: c.final.scoreFinal ?? null,
      attemptsUsed: c.final.attemptsUsed,
      retried: c.retried,
      extraRuns: c.extraRuns,
      failedChecks: c.final.failedChecks,
    },
    attempts: c.attempts.map((x) => ({ run: x.run, cls: x.cls })),
    detail: c.final.detail,
  }))
  stats.triage = cells
    .filter((c) => c.final.triage)
    .map((c) => `${c.key}：${c.final.cls} —— ${c.final.detail ?? ''}`)

  const outDir = safeOut(a.out ?? join(dirname(loaded[0].file), 'stats'))
  writeFileAtomic(join(outDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`)
  const markdown = join(outDir, 'stats.md')
  writeFileAtomic(markdown, renderStatsMarkdown(stats))
  outLine({
    stats: join(outDir, 'stats.json'),
    markdown,
    cells: cells.length,
    valid: cells.filter((c) => c.final.side === 'sample' || c.final.side === 'model').length,
    level: stats.decision.level,
    consistent: stats.fingerprints.consistent,
  })
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    const usage = e?.name === 'UsageError'
    process.stderr.write(`${usage ? '用法错' : '内部错'}：${e?.message ?? e}\n${usage ? `\n${USAGE}\n` : `${e?.stack ?? ''}\n`}`)
    process.exitCode = usage ? 2 : 1
  }
}
