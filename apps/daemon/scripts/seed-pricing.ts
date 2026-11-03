#!/usr/bin/env bun
/**
 * seed-pricing —— 一次性价目补种（studio-dev-554；rework studio-dev-584 原样保留）
 *
 * 定位：部署窗口内、daemon 未持 writer 租约时，把 models.yaml 三档直接补种进
 * price_snapshots（价格事实源），让成本报表立即可折 USD；正常晨间路径仍是
 * type=pricing 单 → GATE_PASS 后置步（engine/pricing/pricing.ts）写入——同一条 store
 * 唯一写面，本脚本只是运营补种口。
 *
 * 为什么是脚本而不是 CLI 常态写口：store/pricing.ts 头注冻结「无 CLI/脚本写口」的
 * 单一写入者纪律；本件是原单任务书明确授权的一次性补种例外（部署窗口、幂等、可审计）。
 * 若要把补种常态化，须走契约面/写面纪律报批（本单不擅自扩权）。
 *
 * 幂等（fail-closed）：
 *   - source_ticket 缺省固定为 `seed-pricing:<priceDate>`；同键同内容重跑=appended=false
 *     （store 单据幂等），不重复追加；
 *   - 同键不同内容=store CONFIG_INVALID/ticket-conflict 拒（不覆盖、不猜价）；
 *   - models.yaml 缺档/非有限价/同模型异价 → publish.buildPricingTable 拒（不写坏价目）；
 *   - 生成文本先过 parsePricingTable + validatePricingTable 自检，与消费面同闸。
 *
 * 用法（仓根）：
 *   mise exec -- bun apps/daemon/scripts/seed-pricing.ts \
 *     --db /path/ledger.sqlite --models ~/.config/studio-next/models.yaml \
 *     --company studio-dev [--date YYYY-MM-DD] [--by HF-1] [--ticket seed-pricing:...] [--dry-run]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createModelCatalog,
  parseModelsYaml,
  parsePricingTable,
  validatePricingTable,
} from '@studio-next/core'
import { openLedgerWriter } from '@studio-next/store'
import { buildPricingTable, renderPricingTableYaml } from '../src/engine/pricing/publish.ts'
import { makeUlid } from '../src/engine/tools/id.ts'

interface Args {
  db?: string
  models?: string
  company?: string
  date?: string
  by: string
  ticket?: string
  dryRun: boolean
}

function usage(problem?: string): never {
  if (problem !== undefined) console.error(`seed-pricing：${problem}`)
  console.error(
    [
      '用法：bun apps/daemon/scripts/seed-pricing.ts --db <库> --models <models.yaml> --company <slug>',
      '      [--date YYYY-MM-DD] [--by <工号>] [--ticket <单据号锚>] [--dry-run]',
    ].join('\n'),
  )
  process.exit(problem === undefined ? 0 : 2)
}

function parseArgs(argv: string[]): Args {
  const out: Args = { by: 'HF-1', dryRun: false }
  const take = (i: number, key: string): [string, number] => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`--${key} 缺值`)
    return [v, i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    switch (a) {
      case '--db': {
        const [v, j] = take(i, 'db')
        out.db = v
        i = j
        break
      }
      case '--models': {
        const [v, j] = take(i, 'models')
        out.models = v
        i = j
        break
      }
      case '--company': {
        const [v, j] = take(i, 'company')
        out.company = v
        i = j
        break
      }
      case '--date': {
        const [v, j] = take(i, 'date')
        out.date = v
        i = j
        break
      }
      case '--by': {
        const [v, j] = take(i, 'by')
        out.by = v
        i = j
        break
      }
      case '--ticket': {
        const [v, j] = take(i, 'ticket')
        out.ticket = v
        i = j
        break
      }
      case '--dry-run':
        out.dryRun = true
        break
      case '-h':
      case '--help':
      case 'help':
        usage()
        break
      default:
        usage(`未知参数 ${a}`)
    }
  }
  if (out.db === undefined) usage('缺 --db <库路径>')
  if (out.models === undefined) usage('缺 --models <models.yaml>')
  if (out.company === undefined) usage('缺 --company <slug>')
  return out
}

/** 本地日串（与 daemon pricing.localDateString 同口径；脚本独立小件不复用 daemon 内部件） */
function localDateString(ms: number): string {
  const d = new Date(ms)
  const pad = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  const priceDate = args.date ?? localDateString(Date.now())
  const sourceTicket = args.ticket ?? `seed-pricing:${priceDate}`

  const modelsText = readFileSync(args.models as string, 'utf8')
  const config = parseModelsYaml(modelsText)
  const catalog = createModelCatalog(config)
  const table = buildPricingTable({
    tiers: catalog.tiers(),
    priceDate,
    sourceNote: `models.yaml 三档一次性补种（${priceDate}；seed-pricing 脚本）`,
  })
  const text = renderPricingTableYaml(table)
  // 自检：与收割后置步同一解析/覆盖闸（生成器→消费面永不漂移）
  const parsed = parsePricingTable(text)
  validatePricingTable(
    parsed,
    catalog.tiers().map((t) => ({ provider: t.provider, model: t.model })),
  )

  if (args.dryRun) {
    console.log(`# dry-run：不写库；目标 source_ticket=${sourceTicket}`)
    process.stdout.write(text)
    return 0
  }

  const ledger = openLedgerWriter(path.resolve(args.db as string), 'cli:seed-pricing')
  try {
    const now = Date.now()
    let appended = 0
    let skipped = 0
    for (const m of parsed.models) {
      for (const p of m.prices) {
        const r = ledger.appendPriceSnapshot({
          id: `ps-${makeUlid(now)}`,
          company: args.company as string,
          provider: m.provider,
          model: m.model,
          price_date: parsed.priceDate,
          slot: p.slot,
          input_per_m: p.inputPerM,
          output_per_m: p.outputPerM,
          ...(p.cacheReadPerM !== undefined ? { cache_read_per_m: p.cacheReadPerM } : {}),
          ...(p.cacheCreationPerM !== undefined ? { cache_creation_per_m: p.cacheCreationPerM } : {}),
          currency: 'USD',
          billing_track: m.billingTrack,
          ...(m.planMonthlyUsd !== undefined ? { plan_monthly_usd: m.planMonthlyUsd } : {}),
          source_note: parsed.sourceNote,
          source_ticket: sourceTicket,
          published_by: args.by,
        })
        if (r.appended) appended += 1
        else skipped += 1
        console.log(
          `${r.appended ? 'APPEND' : 'SKIP'} ${m.provider}/${m.model} ${parsed.priceDate}/${p.slot} ` +
            `in=${p.inputPerM}/M out=${p.outputPerM}/M version=${r.version} id=${r.id}`,
        )
      }
    }
    console.log(
      `seed-pricing：date=${parsed.priceDate} models=${parsed.models.length} rows=${appended + skipped} ` +
        `appended=${appended} skipped=${skipped} source_ticket=${sourceTicket}`,
    )
    return 0
  } finally {
    ledger.close()
  }
}

try {
  process.exitCode = main()
} catch (err) {
  console.error(`seed-pricing 失败（fail-closed，未补种）：${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
}
