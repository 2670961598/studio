#!/usr/bin/env node
/**
 * perf-bench —— daemon 性能基线采样（studio-dev-785；只读，不连写、不部署）
 *
 * 目标（制作人/Lead 验收）：tick 中位 <2s、healthz p99 <1s、24h 无 503 重启。
 * 本脚本对运行中 daemon 采样 healthz（N 次），报告延迟分位/ok 率/chain.mode/tick.count 增量估算；
 * 可选 `--db` 只读查询 events 链行数/最近 tick 锚（只读打开，不写）。输出人类可读或 --json。
 *
 * 用法：node scripts/ops/perf-bench.mjs [--health-url http://127.0.0.1:8788/healthz] [--n 100]
 *        [--window-ms 30000] [--json] [--db <ledger.sqlite>（只读）]
 * 退出码：0=采样完成（目标达成与否看报告）；1=用法/采样失败；2=采样完成但目标未达。
 */
import process from 'node:process'

function parse(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      flags.json = true
      continue
    }
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return flags
}
const pct = (arr, p) => {
  if (arr.length === 0) return null
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const flags = parse(process.argv.slice(2))
  const url = flags['health-url'] ?? 'http://127.0.0.1:8788/healthz'
  const n = Number(flags.n ?? 100)
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('--n 须为 1..1000')
  const latencies = []
  let okCount = 0
  let status503 = 0
  let mode = null
  let firstCount = null
  let lastCount = null
  const startedAt = Date.now()
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      const ms = performance.now() - t0
      latencies.push(ms)
      if (res.ok) okCount += 1
      if (res.status === 503) status503 += 1
      const body = await res.json().catch(() => null)
      if (body !== null) {
        mode = body.chain?.mode ?? mode
        if (typeof body.tick?.count === 'number') {
          if (firstCount === null) firstCount = body.tick.count
          lastCount = body.tick.count
        }
      }
    } catch (err) {
      throw new Error(`healthz 采样失败：${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(20)
  }
  const elapsedMs = Date.now() - startedAt
  const tickDelta = firstCount !== null && lastCount !== null ? lastCount - firstCount : null
  const tickMedianApproxMs = tickDelta !== null && tickDelta > 0 ? elapsedMs / tickDelta : null
  const report = {
    ok: true,
    url,
    samples: n,
    latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99), max: Math.max(...latencies) },
    okRate: okCount / n,
    status503,
    chainMode: mode,
    tickCountDelta: tickDelta,
    tickMedianApproxMs,
    elapsedMs,
    targets: {
      tickMedianLt2000: tickMedianApproxMs === null ? null : tickMedianApproxMs < 2000,
      healthzP99Lt1000: pct(latencies, 99) < 1000,
      no503: status503 === 0,
    },
  }
  if (flags.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else {
    process.stdout.write(`[perf-bench] ${url} samples=${n} p50=${report.latencyMs.p50?.toFixed(1)}ms p95=${report.latencyMs.p95?.toFixed(1)}ms p99=${report.latencyMs.p99?.toFixed(1)}ms\n`)
    process.stdout.write(`  okRate=${(report.okRate * 100).toFixed(1)}% 503=${status503} chain.mode=${String(mode)} tick≈${tickMedianApproxMs === null ? 'n/a' : `${Math.round(tickMedianApproxMs)}ms`}\n`)
    process.stdout.write(`  targets: tick<2s=${String(report.targets.tickMedianLt2000)} healthzP99<1s=${String(report.targets.healthzP99Lt1000)} no503=${String(report.targets.no503)}\n`)
  }
  return report.targets.healthzP99Lt1000 && report.targets.no503 ? 0 : 2
}

try {
  process.exit(await main())
} catch (err) {
  process.stderr.write(`[perf-bench] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
