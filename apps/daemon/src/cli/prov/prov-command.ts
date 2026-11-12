/**
 * prov-command —— `studio-next provenance trace|impact` 命令面（observe-only）
 *
 * 用法：
 *   provenance trace <ticket> --db <ledger.sqlite> --company <slug> [--out-dir <目录>] [--depth N]
 *   provenance impact --from <ticket|eventId|alertId> --db <ledger.sqlite> --company <slug>
 *                     [--since YYYY-MM-DD|epochMs] [--until ...] [--depth N] [--out-dir <目录>]
 * 只读 node:sqlite readOnly 仅 SELECT；不写台账/事件/单据/schema、不接主循环/不外发；
 * 空图/未知 from 输出空形状 exit0（observe-only）；坏参数/坏库 exit≠0 零输出。
 */
import path from 'node:path'
import { CONCISE, SECTION } from '../usage.ts'
import { errText } from '../argv.ts'
import { helpOk, usageFail, wantsHelp } from '../help.ts'
import { findProvAnchorTime, readProvData, type ProvData } from './prov-data.ts'
import { buildProvenanceGraph, impactOf, traceTicket } from './provenance-graph.ts'
import { renderImpactJson, renderImpactMarkdown, renderTraceJson, renderTraceMarkdown, writeProvFiles } from './prov-report.ts'

interface CommonArgs {
  readonly db: string
  readonly company: string
  readonly outDir: string
  readonly depth: number | undefined
}
export type ProvArgsResult =
  | { readonly ok: true; readonly mode: 'trace'; readonly ticket: string; readonly args: CommonArgs }
  | { readonly ok: true; readonly mode: 'impact'; readonly from: string; readonly since: number | undefined; readonly until: number | undefined; readonly args: CommonArgs }
  | { readonly ok: false; readonly message: string }

function nextValue(argv: readonly string[], i: number, token: string): { value: string; next: number } | { message: string } {
  const eq = token.indexOf('=')
  if (eq >= 0) return { value: token.slice(eq + 1), next: i }
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) return { message: `参数缺值：${token}` }
  return { value, next: i + 1 }
}
function epochOf(text: string, edge: 'start' | 'end'): number {
  if (/^\d+$/.test(text)) return Number(text)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`时间须 YYYY-MM-DD 或 epochMs：${text}`)
  const [y, m, d] = text.split('-').map(Number) as [number, number, number]
  const back = new Date(y, m - 1, d, edge === 'start' ? 0 : 23, edge === 'start' ? 0 : 59, edge === 'start' ? 0 : 59, edge === 'start' ? 0 : 999)
  if (edge === 'end') back.setDate(back.getDate() + 1)
  return back.valueOf()
}
function toLocalDate(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 解析 group 子命令 argv（trace/impact） */
export function parseProvenanceArgs(argv: readonly string[]): ProvArgsResult {
  const [sub, ...rest] = argv
  if (sub !== 'trace' && sub !== 'impact') return { ok: false, message: `provenance 子命令须 trace|impact（收到 ${sub ?? '空'}）` }
  const values: Record<string, string> = {}
  let positionals: string[] = []
  const flags = new Set(['db', 'company', 'out-dir', 'depth', 'from', 'since', 'until'])
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? ''
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const eq = token.indexOf('=')
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2)
    if (!flags.has(key)) return { ok: false, message: `未知参数：${token}（provenance 只接受 --db/--company/--out-dir/--depth/--from/--since/--until）` }
    const got = nextValue(rest, i, token)
    if ('message' in got) return { ok: false, message: got.message }
    values[key] = got.value
    i = got.next
  }
  if (values['db'] === undefined) return { ok: false, message: '缺少 --db <ledger.sqlite>（只读开库，不代建）' }
  if (values['company'] === undefined || values['company'] === '') return { ok: false, message: '缺少 --company <slug>' }
  let depth: number | undefined
  if (values['depth'] !== undefined) {
    const n = Number(values['depth'])
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, message: `坏 --depth：${values['depth']}` }
    depth = n
  }
  const db = path.resolve(values['db'])
  const outDir = values['out-dir'] !== undefined ? path.resolve(values['out-dir']) : path.join(path.dirname(db), 'var', 'reports', 'provenance')
  const common: CommonArgs = { db, company: values['company'], outDir, depth }
  if (sub === 'trace') {
    if (positionals.length !== 1 || positionals[0] === undefined) return { ok: false, message: '用法：provenance trace <ticket>（恰好一个票号）' }
    return { ok: true, mode: 'trace', ticket: positionals[0], args: common }
  }
  if (values['from'] === undefined) {
    const from = positionals[0]
    if (from === undefined) return { ok: false, message: 'impact 需 --from <ticket|eventId|alertId>' }
    values['from'] = from
  }
  let since: number | undefined
  let until: number | undefined
  try {
    since = values['since'] !== undefined ? epochOf(values['since'], 'start') : undefined
    until = values['until'] !== undefined ? epochOf(values['until'], 'end') : undefined
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  if (since !== undefined && until !== undefined && until <= since) return { ok: false, message: '时间窗非法：until 须晚于 since' }
  return { ok: true, mode: 'impact', from: values['from'], since, until, args: common }
}

function readCommon(args: CommonArgs, options: { issue?: string; since?: number; until?: number }): ProvData {
  return readProvData(args.db, args.company, options)
}

/** 命令实现（错误=stderr+exit≠0；空图/未知 from=空形状 exit0） */
export async function cmdProvenance(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['provenance'])
  const [sub, ...rest] = argv
  if (sub === undefined) return usageFail('provenance', '缺少子命令（trace|impact）', CONCISE['provenance'])
  const parsed = parseProvenanceArgs([sub, ...rest])
  if (!parsed.ok) return usageFail('provenance', parsed.message, CONCISE['provenance'])
  try {
    if (parsed.mode === 'trace') {
      const data = readCommon(parsed.args, { issue: parsed.ticket })
      const trace = traceTicket(buildProvenanceGraph(data), parsed.ticket, parsed.args.depth ?? 8)
      const { jsonPath, mdPath } = writeProvFiles('trace', parsed.args.outDir, parsed.ticket, renderTraceJson(trace), renderTraceMarkdown(trace))
      console.log(`provenance trace 已生成：${jsonPath} / ${mdPath}（ticket=${parsed.ticket} nodes=${String(trace.nodes.length)} edges=${String(trace.edges.length)} gaps=${String(trace.gaps.length)}；observe-only）`)
      return 0
    }
    // 默认窗口=from 锚点 ±24h（P1 fix：窗口真限制图展开，而非仅报告文字）
    let since = parsed.since
    let until = parsed.until
    if (since === undefined && until === undefined) {
      const anchor = findProvAnchorTime(parsed.args.db, parsed.args.company, parsed.from)
      if (anchor !== null) {
        since = anchor - 24 * 3_600_000
        until = anchor + 24 * 3_600_000
      }
    }
    const data = readCommon(parsed.args, {
      ...(since !== undefined ? { since } : {}),
      ...(until !== undefined ? { until } : {}),
    })
    const graph = buildProvenanceGraph(data)
    const impact = impactOf(graph, parsed.from, parsed.args.depth ?? 2, { ...(since !== undefined ? { since } : {}), ...(until !== undefined ? { until } : {}) })
    const name = parsed.from.startsWith('alert:') || parsed.from.startsWith('ticket:') ? parsed.from : toLocalDate(since ?? parsed.until ?? Date.now()) + '-' + parsed.from
    const { jsonPath, mdPath } = writeProvFiles('impact', parsed.args.outDir, name, renderImpactJson(impact), renderImpactMarkdown(impact))
    console.log(
      `provenance impact 已生成：${jsonPath} / ${mdPath}（from=${parsed.from} source=${impact.source?.id ?? '未知/空'} tickets=${String(impact.affected.tickets.length)} gaps=${String(impact.gaps.length)}；observe-only 不动作）`,
    )
    return 0
  } catch (err) {
    console.error(`provenance 失败：${errText(err)}`)
    return 2
  }
}
