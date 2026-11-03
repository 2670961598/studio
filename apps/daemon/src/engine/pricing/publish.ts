/**
 * pricing/publish —— 定价发布岗的**生成缝**（studio-dev-554；rework studio-dev-584；
 * docs/17-§2 派发相位）
 *
 * 供给面缺失的本体：消费面（pricing/pricing.ts·consumePricingPublish）早已就绪，但没有
 * 任何生产者把 models.yaml 三档变成 type='pricing' 单的 deliverables/pricing.yaml。
 * 本件两段：
 *   ① 纯生成（零 IO）：buildPricingTable（ModelTier[] → 消费面冻结形状）+ renderPricingTableYaml；
 *   ② 派发缝：preparePricingAttachment 在 executeDispatch 建工作区之后、launch 之前落附件，
 *      并用消费面同一 parse/覆盖闸自检（生成器与消费者永不漂移）。
 *
 * rework 口径（studio-dev-584）：新增接线全部收在本件——engine.ts 只留一次调用，
 * 不把 13+ 行内联进主循环（engine 净增 ≤0，见 REPORT §3 行数证据）。
 *
 * 为什么生成在 daemon 而不是让 worker 手抄（fail-closed 理由）：
 *   - 价目是 price_snapshots 金额事实的源件，LLM 转写会把 0.015 抄成 0.15 而四要件仍全绿；
 *   - 生成后 worker 义务收窄为**核验**（附件 sha256/内容对照）与四要件产出（REPORT/summary），
 *     价格正确性由确定性的 models.yaml→价目表投影承保；
 *   - 失败仍在派发相位 fail-closed：生成抛错 → DISPATCH_FAIL（不派发、不 transition）+
 *     DAILY_ALARM（src=pricing-publish，同日同单去重）——绝不把坏价目单放出去。
 *
 * 生成口径（与消费面冲突处如实声明）：
 *   - tiers 缺席/非三档/缺 id → CONFIG_INVALID/pricing-publish/tiers-incomplete；
 *   - provider/model 空 / 价格非有限或负 → CONFIG_INVALID/pricing-publish/tier-invalid；
 *   - 同 provider/model 在不同档声明**不同单价** → price-conflict（消费面自然键唯一，不猜不覆盖）；
 *   - 三档同 model 同价 → 合法折叠为一条 model 行（生产现状 2026-11-03 三档同模型；
 *     覆盖校验按 provider/model 集合判定，三档覆盖仍成立；price_snapshots 自然键同口径）；
 *   - 币种：pricing.yaml 冻结形状**没有 currency 键**，store price_snapshots.currency 是
 *     literal('USD') 缺省——本件固定 USD。要支持非 USD 必须先改消费面契约（契约面子项，
 *     须报批），不得在本件私自发明 currency 键（会被 parsePricingTable strict 闸整表拒收）。
 *
 * 无状态/幂等：同日期同 tiers 生成同字节（渲染无时间戳/随机）；重派覆盖同路径不累积；
 * price_snapshots 的幂等仍由 store 单据自然键承保（同单同键重复入账=跳过）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configInvalid, type ModelTier } from '@studio-next/contract'
import {
  parsePricingTable,
  validatePricingTable,
  type PricingModelEntry,
  type PricingTable,
  type UnitPrice,
} from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { localDateString, PRICING_TICKET_TYPE } from './pricing.ts'

/** 附件相对路径（消费面 pricing/pricing.ts 的同一落点——单一事实源） */
export const PRICING_DELIVERABLE_REL = path.join('deliverables', 'pricing.yaml')

/** 三档 id 全集（models.yaml 冻结：high/mid/low——core/models.ts TIER_IDS 同源语义） */
const REQUIRED_TIERS = ['high', 'mid', 'low'] as const

/** 真日历日（与 core pricing PriceDateSchema 同口径；本件只做闸） */
function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const back = new Date(Date.UTC(y, m - 1, d))
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
}

/** 单价合法性（zod 已拒 NaN/Infinity；此处守直接调用面 + 负数/缺键） */
function assertPrice(tier: ModelTier): UnitPrice {
  const p: { inputPerM?: unknown; outputPerM?: unknown } = tier.price
  if (typeof p.inputPerM !== 'number' || typeof p.outputPerM !== 'number') {
    configInvalid('pricing-publish/tier-invalid', `档 ${tier.tier} 缺 price.inputPerM/outputPerM（models.yaml 三档价目必填）`)
  }
  const inputPerM = p.inputPerM
  const outputPerM = p.outputPerM
  for (const [key, v] of [
    ['inputPerM', inputPerM],
    ['outputPerM', outputPerM],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      configInvalid('pricing-publish/tier-invalid', `档 ${tier.tier} 的 ${key}=${String(v)} 非有限非负数（坏价目不发布）`)
    }
  }
  return { inputPerM, outputPerM }
}

/**
 * 三档 → 定价表（消费面冻结形状）。
 * 同 provider/model 折叠为一条（价格必须一致）；不同模型保持 tier 声明序。
 */
export function buildPricingTable(input: {
  tiers: readonly ModelTier[] | undefined
  priceDate: string
  sourceNote: string
}): PricingTable {
  const { tiers } = input
  if (tiers === undefined || tiers.length === 0) {
    configInvalid('pricing-publish/tiers-incomplete', 'models.yaml 三档缺席（catalog.tiers() 空）——无价目可发布，拒绝生成')
  }
  if (tiers.length !== REQUIRED_TIERS.length) {
    configInvalid(
      'pricing-publish/tiers-incomplete',
      `models.yaml 档数=${tiers.length}，须恰为 ${REQUIRED_TIERS.length}（high/mid/low；缺档不发布半表）`,
    )
  }
  const seenTier = new Set<string>()
  for (const t of tiers) {
    if (!(REQUIRED_TIERS as readonly string[]).includes(t.tier)) {
      configInvalid('pricing-publish/tiers-incomplete', `未知档 id=${String(t.tier)}（须 high/mid/low）`)
    }
    if (seenTier.has(t.tier)) {
      configInvalid('pricing-publish/tiers-incomplete', `档 ${t.tier} 重复声明（三档各恰一次）`)
    }
    seenTier.add(t.tier)
  }
  for (const id of REQUIRED_TIERS) {
    if (!seenTier.has(id)) configInvalid('pricing-publish/tiers-incomplete', `models.yaml 缺档 ${id}（三档必须齐全）`)
  }
  if (!isCalendarDate(input.priceDate)) {
    configInvalid('pricing-publish/bad-date', `priceDate='${input.priceDate}' 不是真日历日（YYYY-MM-DD）`)
  }
  if (typeof input.sourceNote !== 'string' || input.sourceNote.trim() === '') {
    configInvalid('pricing-publish/bad-source-note', 'sourceNote 必填非空（来源审计面）')
  }

  const byModel = new Map<string, PricingModelEntry>()
  for (const tier of tiers) {
    if (typeof tier.provider !== 'string' || tier.provider.trim() === '') {
      configInvalid('pricing-publish/tier-invalid', `档 ${tier.tier} 的 provider 必填非空`)
    }
    if (typeof tier.model !== 'string' || tier.model.trim() === '') {
      configInvalid('pricing-publish/tier-invalid', `档 ${tier.tier} 的 model 必填非空`)
    }
    const unit = assertPrice(tier)
    const key = `${tier.provider}/${tier.model}`
    const existing = byModel.get(key)
    if (existing === undefined) {
      byModel.set(key, {
        provider: tier.provider,
        model: tier.model,
        billingTrack: 'api',
        prices: [{ slot: 'peak', ...unit }],
      })
      continue
    }
    // 同模型异价：消费面按 provider/model 取价，两个价不可并存——拒，不静默择一
    const prev = existing.prices[0]
    if (prev === undefined || prev.inputPerM !== unit.inputPerM || prev.outputPerM !== unit.outputPerM) {
      configInvalid(
        'pricing-publish/price-conflict',
        `模型 ${key} 在多个档声明了不同单价（${prev?.inputPerM ?? '?'}/${prev?.outputPerM ?? '?'} vs ${unit.inputPerM}/${unit.outputPerM}）——消费面按 provider/model 唯一取价，拒绝歧义表`,
      )
    }
  }

  return {
    priceDate: input.priceDate,
    sourceNote: input.sourceNote,
    models: [...byModel.values()],
  }
}

/** YAML 标量安全引号（sourceNote 可能含冒号/引号/换行——单引号转义是 YAML 的确定形） */
function yamlSingleQuoted(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

/**
 * 定价表 → pricing.yaml 文本（确定性：键序/数字原样，无时间戳/无随机——同输入恒同字节）。
 * 形状与 packages/core/pricing.example.yaml 一致；调用方须再用 parsePricingTable 自检。
 */
export function renderPricingTableYaml(table: PricingTable): string {
  const lines: string[] = [
    `priceDate: ${yamlSingleQuoted(table.priceDate)}`,
    `sourceNote: ${yamlSingleQuoted(table.sourceNote)}`,
    'models:',
  ]
  for (const m of table.models) {
    lines.push(`  - provider: ${m.provider}`)
    lines.push(`    model: ${m.model}`)
    lines.push(`    billingTrack: ${m.billingTrack}`)
    if (m.planMonthlyUsd !== undefined) lines.push(`    planMonthlyUsd: ${String(m.planMonthlyUsd)}`)
    lines.push('    prices:')
    for (const p of m.prices) {
      lines.push(`      - slot: ${p.slot}`)
      lines.push(`        inputPerM: ${String(p.inputPerM)}`)
      lines.push(`        outputPerM: ${String(p.outputPerM)}`)
      if (p.cacheReadPerM !== undefined) lines.push(`        cacheReadPerM: ${String(p.cacheReadPerM)}`)
      if (p.cacheCreationPerM !== undefined) lines.push(`        cacheCreationPerM: ${String(p.cacheCreationPerM)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** 生成结果（派发相位留痕：路径/字节指纹/定价表） */
export interface PricingDeliverable {
  /** 绝对路径 <workspace>/deliverables/pricing.yaml */
  path: string
  /** 文件正文字节（pricing.yaml 全文） */
  text: string
  /** sha256 十六进制（任务书/DISPATCH note 可引；内容证据锚） */
  sha256: string
  /** 解析后的定价表（消费面同形） */
  table: PricingTable
}

/** 生成入参 */
export interface WritePricingDeliverableInput {
  /** worker 工位（收割四要件同一目录根） */
  workspace: string
  /** catalog.tiers()（models.yaml 三档；undefined=态 B 无价目表，fail-closed） */
  tiers: readonly ModelTier[] | undefined
  /** 生效日（本地业务日 'YYYY-MM-DD'） */
  priceDate: string
  /** 来源注记（缺省=models.yaml 三档投影注记） */
  sourceNote?: string
}

/**
 * 生成并落盘定价附件。抛错=发布失败（调用方转 DISPATCH_FAIL + DAILY_ALARM，不 launch）。
 * 写后立即用消费面同一解析/覆盖闸自检——生成器与消费面永不漂移（本件是唯一生产者）。
 */
export function writePricingDeliverable(input: WritePricingDeliverableInput): PricingDeliverable {
  const sourceNote = input.sourceNote ?? `models.yaml 三档价目投影（${input.priceDate}；daemon 派发相位生成）`
  const table = buildPricingTable({ tiers: input.tiers, priceDate: input.priceDate, sourceNote })
  const text = renderPricingTableYaml(table)
  // 自检①形状：与收割后置步同一 parse 闸（含 YAML 上限/行号/strict 键）
  const parsed = parsePricingTable(text)
  // 自检②覆盖：发布表 ⊇ models.yaml 三档声明（同集合口径；三档同模型折叠后仍全覆盖）
  validatePricingTable(
    parsed,
    (input.tiers ?? []).map((t) => ({ provider: t.provider, model: t.model })),
  )
  const file = path.join(input.workspace, PRICING_DELIVERABLE_REL)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
  return { path: file, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), table: parsed }
}

/** 引擎 makeEvent 闭包的结构子集（本件只发 DAILY_ALARM——事件词表零新增，docs/17-§3） */
type EmitAlarm = (note: string) => void

/** 派发相位定价附件入参（engine 一次调用收口；失败面=抛错→DISPATCH_FAIL） */
export interface PreparePricingAttachmentInput {
  /** IssueRecord.type——非 'pricing' 即零行为（普通单/巡查工件不受影响） */
  issueType: string | undefined
  /** 单号（告警去重前缀与任务书留痕锚） */
  ticket: string
  workspace: string
  at: number
  tiers: readonly ModelTier[] | undefined
  ledger: Pick<Ledger, 'queryEvents'>
  company: string
  /** DAILY_ALARM 发射（引擎侧 makeEvent 闭包，挂当前单） */
  emitAlarm: EmitAlarm
}

/** 告警去重前缀（同日同单只发一条：daemon 重启/重派不刷屏） */
function alarmPrefix(ticket: string, day: string): string {
  return `src=pricing-publish;ticket=${ticket};date=${day};stage=dispatch`
}

/**
 * 派发相位定价接线（engine.ts 唯一调用点）：type='pricing' 单在 launch 前生成附件，
 * 失败则同前缀去重发 DAILY_ALARM 并抛错（外层 catch=DISPATCH_FAIL，不 transition 不 launch）。
 * 返回任务书追加块（非定价单=''）。
 */
export function preparePricingAttachment(input: PreparePricingAttachmentInput): string {
  if (input.issueType !== PRICING_TICKET_TYPE) return ''
  const day = localDateString(input.at)
  try {
    const deliverable = writePricingDeliverable({ workspace: input.workspace, tiers: input.tiers, priceDate: day })
    return pricingBriefBlock(deliverable)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const prefix = alarmPrefix(input.ticket, day)
    const already = input.ledger
      .queryEvents({ company: input.company, since: input.at - 86_400_000 })
      .some((e) => e.event === 'DAILY_ALARM' && (e.note ?? '').startsWith(prefix))
    if (!already) input.emitAlarm(`${prefix}；定价发布失败：${msg}`)
    throw new Error(`定价发布附件生成失败（fail-closed，不派发）：${msg}`)
  }
}

/**
 * 定价岗单据 description（drain 物化时注入——平台侧可读、任务书读面可见）。
 * 仅陈述确定性事实与 worker 义务；不含路径硬编码（附件相对工位）。
 */
export function pricingTicketDescription(): string {
  return [
    '每日定价发布单（type=pricing）。',
    'daemon 在派发相位依据 models.yaml 三档生成附件 deliverables/pricing.yaml（与本任务书同工位）。',
    'worker 义务：核验附件与 models.yaml 三档一致（provider/model/inputPerM/outputPerM/priceDate），',
    '写 REPORT.md 与 deliverables/plan.md；不得手改价格、增删模型或改动生效日。',
    '附件缺失/解析失败/覆盖缺档=消费面拒收 price_snapshots 并发 DAILY_ALARM（src=pricing-publish）。',
  ].join('\n')
}

/** 任务书尾块（派发相位追加：附件路径/指纹/定价表摘要——per-attempt 操作面） */
export function pricingBriefBlock(d: PricingDeliverable, modelsPath?: string): string {
  const rows = d.table.models
    .flatMap((m) => m.prices.map((p) => `${m.provider}/${m.model} ${p.slot} in=${p.inputPerM}/M out=${p.outputPerM}/M`))
    .join('；')
  return [
    '—— 定价发布附件（daemon 派发相位生成；本单只核验不改价）——',
    `- 附件：\`${PRICING_DELIVERABLE_REL}\`（sha256:${d.sha256}）`,
    `- 生效日：${d.table.priceDate}；来源：${d.table.sourceNote}${modelsPath === undefined ? '' : `；models.yaml=${modelsPath}`}`,
    `- 价目：${rows}`,
    '- 义务：核验上述内容与 models.yaml 一致 → 写 REPORT.md（附摘录）与 deliverables/plan.md；',
    '  价格差异/缺档=立即在 REPORT 明报失败，不得改附件凑失败为绿（消费面 fail-closed）。',
    '',
  ].join('\n')
}
