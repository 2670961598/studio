#!/usr/bin/env node
/**
 * run.mjs —— 自研模型能力评测台（业务向）入口
 *
 * 用法：node scripts/ops/model-eval/run.mjs [--models a/b,c/d] [--tasks t01,t02] [--reps 1]
 *        [--out DIR] [--timeout-ms 300000] [--judge x/y|none] [--skip-unavailable]（--help 看全）
 * 产物：<out>/report.json + report.md；工位 work/、事件流 logs/、路由 overlay overlays/。
 * 退出码：0 报告已写出（模型不可用不算失败）；2 用法错；1 内部错；3 评测台自身不可用（dsh 起不来）。
 * 依据：docs/quality/model-eval.md；制作人 2026-11-23 令。
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { USAGE, parseArgs } from './lib/args.mjs'
import { execDsh, installChildCleanup, readKimiToken, resolveDshBin } from './lib/exec.mjs'
import { readPriceTable, runEval } from './lib/evaluate.mjs'
import { renderMarkdown } from './lib/report.mjs'
import { listTasks, resolveTasks } from './lib/tasks.mjs'

const TASKS_DIR = join(import.meta.dirname, 'tasks')

/** 全部模型预探都因评测台自身故障失败 → 评测台不可用（exit 3）。 */
export function benchBroken(report) {
  const probed = report.availability.filter((a) => a.errorClass !== null)
  return probed.length > 0 && probed.every((a) => a.errorClass === 'harness')
}

async function main() {
  let config
  try {
    config = parseArgs(process.argv.slice(2))
    if (config.help) {
      console.log(USAGE)
      return 0
    }
    config.tasksDir = TASKS_DIR
    resolveTasks(listTasks(TASKS_DIR), config.tasks) // 未知/不唯一的任务在此就按用法错退出（exit 2），不发车
    config.priceTable = readPriceTable(config.prices)
  } catch (err) {
    console.error(`用法错：${err instanceof SyntaxError ? '价目表不是合法 JSON' : err.message}\n\n${USAGE}`)
    return 2
  }
  try {
    config.dshBin = resolveDshBin(config.dsh)
  } catch (err) {
    console.error(`评测台不可用：${err.message}`)
    return 3
  }
  installChildCleanup()
  const log = config.quiet ? () => {} : (m) => console.error(m)
  try {
    const report = await runEval(config, { exec: execDsh, readKimiToken, log })
    const jsonPath = join(report.outDir, 'report.json')
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    const mdPath = join(report.outDir, 'report.md')
    writeFileSync(mdPath, renderMarkdown(report), 'utf8')
    const completed = report.rows.filter((r) => r.status === 'completed').length
    const passed = report.rows.filter((r) => r.ok && r.deterministicPass === true).length
    console.log(JSON.stringify({ report: mdPath, json: jsonPath, cells: report.rows.length, completed, passed }))
    if (benchBroken(report)) {
      console.error(`评测台不可用：全部模型的可用性预探都因评测台自身故障失败（详见 ${mdPath} §1）`)
      return 3
    }
    return 0
  } catch (err) {
    console.error(`内部错：${err?.stack ?? err}`)
    return 1
  }
}

/** 直接执行才跑（被测试 import 时不跑 main——同 clean-machine-e2e.mjs / dist-smoke.mjs 约定）。 */
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      console.error(`内部错：${err?.stack ?? err}`)
      process.exitCode = 1
    },
  )
}
