#!/usr/bin/env node
// margin-watch.mjs —— 行数余量观测面（零写能力；默认 exit 0，--strict 供 CI 提示）
//
// 依据：docs/17-§2（主循环七相位——观测不增删相位）、docs/17-§6（收割四要件——观测零判据
//   变更）、docs/20-§十五.三（600 行阈 / lineBaseline ratchet）、docs/91（零余量拆件纪律）。
//
// 判据：上限=lineBaseline[file] ?? maxLinesPerFile（运行时读 boundary-rules.mjs，不复制）；
//   余量=上限−wc -l 同口径行数；余量 < softMargin(50) = WARN；> 上限 = OVER。
//   契约冻结面低余量只标 FROZEN-WARN（不判红——修法只能走批示流）。
//
// 用法：
//   node scripts/guards/margin-watch.mjs            # 观测面，恒 exit 0
//   node scripts/guards/margin-watch.mjs --strict   # 非冻结面 WARN/OVER/MISSING → exit 1
//   node scripts/guards/margin-watch.mjs --json     # 机器可读
//   node scripts/guards/margin-watch.mjs --root <dir>
import fs from 'node:fs'
import path from 'node:path'
import { maxLinesPerFile, lineBaseline } from './boundary-rules.mjs'
import { frozenContractFaces, softMargin, watchFiles } from './margin-rules.mjs'

/** wc -l 口径：末行无换行符计 1 行，空文件 0 行（与 boundaries.mjs countLines 同口径）。 */
function countLines(text) {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

function main() {
  const args = process.argv.slice(2)
  const rootFlag = args.indexOf('--root')
  const root = rootFlag >= 0 ? path.resolve(args[rootFlag + 1]) : path.resolve(import.meta.dirname, '..', '..')
  const json = args.includes('--json')
  const strict = args.includes('--strict')
  const frozen = new Set(frozenContractFaces)

  const rows = watchFiles.map((file) => {
    const abs = path.join(root, file)
    if (!fs.existsSync(abs)) return { file, lines: null, cap: lineBaseline[file] ?? maxLinesPerFile, margin: null, status: 'MISSING' }
    const lines = countLines(fs.readFileSync(abs, 'utf8'))
    const cap = lineBaseline[file] ?? maxLinesPerFile
    const margin = cap - lines
    const status =
      lines > cap
        ? 'OVER'
        : margin < softMargin
          ? frozen.has(file)
            ? 'FROZEN-WARN'
            : 'WARN'
          : 'OK'
    return { file, lines, cap, margin, status }
  })

  if (json) {
    console.log(JSON.stringify({ softMargin, maxLinesPerFile, rows }, null, 2))
  } else {
    for (const r of rows) {
      const lines = r.lines === null ? 'MISSING' : String(r.lines)
      const margin = r.margin === null ? '-' : String(r.margin)
      console.log(`${r.status.padEnd(11)} ${lines.padStart(5)} / ${String(r.cap).padStart(4)} 余量 ${margin.padStart(4)}  ${r.file}`)
    }
    console.log(`余量观测：阈 ${maxLinesPerFile}，软余量 ${softMargin}；契约冻结面低余量只告警（FROZEN-WARN，修法=批示流）`)
  }

  if (strict) {
    const bad = rows.filter((r) => r.status !== 'OK' && r.status !== 'FROZEN-WARN')
    if (bad.length > 0) {
      console.error(`余量观测 FAIL（--strict）：${bad.map((r) => `${r.status}:${r.file}`).join('、')}`)
      return 1
    }
  }
  return 0
}

process.exit(main())
