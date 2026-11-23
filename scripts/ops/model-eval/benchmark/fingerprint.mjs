#!/usr/bin/env node
/**
 * fingerprint.mjs —— 控制变量指纹：对评测台 harness + 任务材料逐字节 sha256，供跨批次对齐核对
 *
 * 用法：node scripts/ops/model-eval/benchmark/fingerprint.mjs [--eval-dir <dir>] [--out <file.json>] [--env] [--json]
 *   --eval-dir  评测台目录（默认 = 本脚本所属的 scripts/ops/model-eval）
 *   --out       指纹 JSON 落到该文件（不得落在仓内；建议 <outDir>/fingerprint.json 与报告同目录归档）
 *   --env       附带运行环境事实：node 版本、平台、dsh 版本（取不到记 unknown，不猜）
 *   --json      完整指纹 JSON 打到 stdout
 * 退出码：0 = 已输出；2 = 用法错；1 = 内部错。
 * 口径：docs/quality/benchmark-business-eval.md §4（控制变量）。
 */
import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshBin } from '../lib/exec.mjs'
import { fingerprintEvalDir } from './lib/fingerprint-core.mjs'
import { EVAL_DIR, outLine, parseFlagArgs, refuseInRepo, writeFileAtomic } from './lib/io.mjs'

const USAGE = `用法：node scripts/ops/model-eval/benchmark/fingerprint.mjs [--eval-dir <dir>] [--out <file.json>] [--env] [--json]
  --eval-dir  评测台目录（默认 scripts/ops/model-eval）
  --out       指纹 JSON 落盘（仓外）
  --env       附带 node / 平台 / dsh 版本
  --json      完整 JSON 打到 stdout`

/** dsh 版本：取得到照录，取不到记 unknown（版本是控制变量，不能靠猜）。 */
function envFacts() {
  let dsh = 'unknown'
  try {
    const bin = resolveDshBin(null, process.env)
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000 })
    if (r.status === 0) dsh = (r.stdout || '').trim().split('\n')[0] || 'unknown'
  } catch {
    dsh = 'unknown'
  }
  return { node: process.version, platform: `${process.platform}/${process.arch}`, dsh }
}

export function main(argv) {
  const a = parseFlagArgs(argv, { 'eval-dir': {}, out: {}, env: { type: 'bool' }, json: { type: 'bool' } })
  const fp = fingerprintEvalDir(a['eval-dir'] ?? EVAL_DIR)
  if (a.env) fp.env = envFacts()
  if (a.out) writeFileAtomic(refuseInRepo(a.out, '--out'), `${JSON.stringify(fp, null, 2)}\n`)
  if (a.json) {
    outLine(fp)
  } else {
    process.stdout.write(`harness ${fp.harness.sha256.slice(0, 12)}（${fp.harness.fileCount} 文件）  all ${fp.all.sha256.slice(0, 12)}（${fp.all.fileCount} 文件）\n`)
    for (const [id, t] of Object.entries(fp.tasks)) {
      process.stdout.write(`${id} ${t.sha256.slice(0, 12)}  prompt ${t.promptRendered.slice(0, 8)}  check ${t.check.slice(0, 8)}  fixtures ${t.fixtures.sha256.slice(0, 8)}（${t.fixtures.fileCount} 文件）\n`)
    }
    if (fp.env) process.stdout.write(`env node ${fp.env.node}  ${fp.env.platform}  dsh ${fp.env.dsh}\n`)
  }
  if (a.out) outLine({ fingerprint: resolve(a.out), file: basename(a.out), tasks: Object.keys(fp.tasks).length, harness: fp.harness.sha256.slice(0, 12), all: fp.all.sha256.slice(0, 12) })
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
