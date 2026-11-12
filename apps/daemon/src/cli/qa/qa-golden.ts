/**
 * qa-golden —— #811 阶段2 golden 集（纯载入/校验/确定性选取；observe-only）
 *
 * 数据落 `<companyDir>/var/qa/golden/golden-v<n>.json` + `manifest.json`（sha256/版本/
 * 选取规则/样本量；只读、不入仓——QA-1 人工审后由显式 `qa-eval --build-golden` 生成，
 * 实现绝不自动生成/覆盖）。本件零台账 IO：构建输入由 qa-eval 只读 SQL 提供；本件只做
 * 纯选取/校验/文件编解码。
 *
 * 选取规则（版本冻结 `hash-strata/v1`）：
 *   - 候选=有 CLOSE 且至少一次 GATE_PASS 的已收口单（每单一条，CLOSE 去重）；
 *   - 分层键=`dept|level|type|outcome`（outcome 优先级 stall > qa-back > long > retry > clean）；
 *   - 每层内按 `sha256('qa-golden/v1:'+issue)` 稳定排序，层间 round-robin 取满 target；
 *   - 不足则按全局哈希序补齐；脱敏只留结构化字段（不含 note 原文/路径/凭据）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const QA_GOLDEN_SCHEMA = 'qa-golden/v1'
export const QA_GOLDEN_MANIFEST_SCHEMA = 'qa-golden-manifest/v1'
export const QA_GOLDEN_RULE = 'hash-strata/v1'
export const QA_GOLDEN_DEFAULT_COUNT = 80
export const QA_GOLDEN_MIN_COUNT = 60
/** 长耗时阈值（ms；仅用于 outcome 分层，不是门禁） */
export const QA_GOLDEN_LONG_MS = 30 * 60 * 1000

export type QaGoldenOutcome = 'clean' | 'retry' | 'qa-back' | 'long' | 'stall'
export type QaTierName = 'high' | 'mid' | 'low'

export interface QaGoldenTicket {
  readonly ticket: string
  readonly dept: string
  readonly level: number
  readonly type: string
  readonly lane: string | null
  readonly outcome: QaGoldenOutcome
  readonly attempts: number
  readonly gateFails: number
  readonly qaBacks: number
  readonly stalls: number
  readonly resumes: number
  readonly dispatchToCloseMs: number | null
  readonly models: readonly string[]
}

export interface QaGoldenStats {
  readonly onePassRate: number | null
  readonly failReasonCounts: Readonly<Record<string, number>>
  readonly duration: { readonly medianMs: number | null; readonly p90Ms: number | null }
  readonly modelCounts: Readonly<Record<string, number>>
  readonly tierCounts: Readonly<Record<QaTierName, number>>
  readonly outcomeCounts: Readonly<Record<QaGoldenOutcome, number>>
  readonly alarmSrcCounts: Readonly<Record<string, number>>
}

export interface QaGoldenFile {
  readonly schema: typeof QA_GOLDEN_SCHEMA
  readonly version: string
  readonly generatedAt: string
  readonly selection: {
    readonly rule: typeof QA_GOLDEN_RULE
    readonly targetCount: number
    readonly builtUntil: string
    readonly sourceCompany: string
  }
  readonly tickets: readonly QaGoldenTicket[]
  readonly stats: QaGoldenStats
  readonly cohorts: ReadonlyArray<{ readonly key: string; readonly count: number }>
}

export interface QaGoldenManifest {
  readonly schema: typeof QA_GOLDEN_MANIFEST_SCHEMA
  readonly version: string
  readonly file: string
  readonly sha256: string
  readonly count: number
  readonly generatedAt: string
}

export interface QaGoldenBuildRows {
  readonly events: ReadonlyArray<{ readonly ts: number; readonly issue: string; readonly event: string; readonly note: string | null }>
  readonly mirror: ReadonlyArray<{ readonly issue: string; readonly dept: string; readonly level: number; readonly type: string; readonly lane: string | null }>
  readonly work: ReadonlyArray<{ readonly issue: string; readonly model: string | null }>
}

export interface QaGoldenBuildOptions {
  readonly targetCount?: number
  readonly builtUntil: string
  readonly sourceCompany: string
  readonly generatedAt: string
  readonly tierOf?: (model: string) => QaTierName | null
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function stableHash(key: string): string {
  return sha256Hex(`qa-golden/v1:${key}`)
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
}

function p90Of(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] as number
}

/** 失败原因归一（与 qa-report 同口径：category 优先，否则首段去 src；不含 note 原文） */
function reasonOf(note: string | null): string {
  if (note === null || note.trim() === '') return 'no-note'
  const category = /\bcategory=([^;\s]+)/.exec(note)?.[1]
  if (category !== undefined) return category
  const first = note.split(/[;；]/)[0]?.trim() ?? ''
  const src = /src=([^;\s]+)/.exec(first)?.[1]
  return (src ?? first).slice(0, 80) || 'no-note'
}

interface Lifecycle {
  issue: string
  events: Array<{ ts: number; event: string }>
  attempts: number
  gatePasses: number
  gateFails: number
  qaBacks: number
  stalls: number
  resumes: number
  firstDispatch: number | undefined
  closeTs: number | undefined
  reasons: Map<string, number>
}

function lifecycleOf(issue: string, events: ReadonlyArray<{ ts: number; event: string; note: string | null }>): Lifecycle {
  const life: Lifecycle = { issue, events: [], attempts: 0, gatePasses: 0, gateFails: 0, qaBacks: 0, stalls: 0, resumes: 0, firstDispatch: undefined, closeTs: undefined, reasons: new Map() }
  for (const e of events) {
    life.events.push({ ts: e.ts, event: e.event })
    if (e.event === 'DISPATCH') {
      life.firstDispatch = life.firstDispatch === undefined ? e.ts : Math.min(life.firstDispatch, e.ts)
    }
    if (e.event === 'GATE_PASS') life.gatePasses += 1
    if (e.event === 'GATE_FAIL') {
      life.gateFails += 1
      const reason = reasonOf(e.note)
      life.reasons.set(reason, (life.reasons.get(reason) ?? 0) + 1)
    }
    if (e.event === 'QA_BACK') life.qaBacks += 1
    if (e.event === 'STALL') life.stalls += 1
    if (e.event === 'RESUME') life.resumes += 1
    if (e.event === 'CLOSE') life.closeTs = life.closeTs === undefined ? e.ts : Math.max(life.closeTs, e.ts)
  }
  // attempts=事件 attempt 维度不可得时以 DISPATCH 次数回退（只读面稳定代理）
  life.attempts = Math.max(1, life.events.filter((e) => e.event === 'DISPATCH').length)
  return life
}

function outcomeOf(life: Lifecycle, durationMs: number | null): QaGoldenOutcome {
  if (life.stalls > 0) return 'stall'
  if (life.qaBacks > 0) return 'qa-back'
  if (durationMs !== null && durationMs >= QA_GOLDEN_LONG_MS) return 'long'
  if (life.gateFails > 0) return 'retry'
  return 'clean'
}

/** 确定性分层选取（纯函数；同输入恒同输出） */
export function selectGoldenTickets(rows: QaGoldenBuildRows, options: QaGoldenBuildOptions): { tickets: QaGoldenTicket[]; stats: QaGoldenStats; cohorts: Array<{ key: string; count: number }> } {
  const target = options.targetCount ?? QA_GOLDEN_DEFAULT_COUNT
  const byIssue = new Map<string, Array<{ ts: number; event: string; note: string | null }>>()
  for (const e of rows.events) {
    const arr = byIssue.get(e.issue) ?? []
    arr.push({ ts: e.ts, event: e.event, note: e.note })
    byIssue.set(e.issue, arr)
  }
  const mirror = new Map(rows.mirror.map((m) => [m.issue, m]))
  const models = new Map<string, Set<string>>()
  for (const w of rows.work) {
    if (w.model === null) continue
    const set = models.get(w.issue) ?? new Set()
    set.add(w.model)
    models.set(w.issue, set)
  }
  const candidates: QaGoldenTicket[] = []
  for (const [issue, evs] of byIssue) {
    evs.sort((a, b) => a.ts - b.ts || a.event.localeCompare(b.event))
    const life = lifecycleOf(issue, evs)
    if (life.closeTs === undefined || life.gatePasses === 0) continue
    const duration = life.firstDispatch === undefined ? null : Math.max(0, life.closeTs - life.firstDispatch)
    const m = mirror.get(issue)
    candidates.push({
      ticket: issue,
      dept: m?.dept ?? 'unknown',
      level: m?.level ?? 0,
      type: m?.type ?? 'unknown',
      lane: m?.lane ?? null,
      outcome: outcomeOf(life, duration),
      attempts: life.attempts,
      gateFails: life.gateFails,
      qaBacks: life.qaBacks,
      stalls: life.stalls,
      resumes: life.resumes,
      dispatchToCloseMs: duration,
      models: [...(models.get(issue) ?? new Set<string>())].sort(),
    })
  }
  // 确定性哈希序 + 分层 round-robin
  const sorted = [...candidates].sort((a, b) => stableHash(a.ticket).localeCompare(stableHash(b.ticket)) || a.ticket.localeCompare(b.ticket))
  const strata = new Map<string, QaGoldenTicket[]>()
  for (const t of sorted) {
    const key = `${t.dept}|${String(t.level)}|${t.type}|${t.outcome}`
    const arr = strata.get(key) ?? []
    arr.push(t)
    strata.set(key, arr)
  }
  const keys = [...strata.keys()].sort()
  const picked: QaGoldenTicket[] = []
  const seen = new Set<string>()
  let progress = true
  while (picked.length < target && progress) {
    progress = false
    for (const key of keys) {
      if (picked.length >= target) break
      const next = strata.get(key)?.shift()
      if (next === undefined) continue
      if (seen.has(next.ticket)) continue
      seen.add(next.ticket)
      picked.push(next)
      progress = true
    }
  }
  for (const t of sorted) {
    if (picked.length >= target) break
    if (seen.has(t.ticket)) continue
    seen.add(t.ticket)
    picked.push(t)
  }
  const tickets = picked.sort((a, b) => a.ticket.localeCompare(b.ticket))
  // 统计（golden 基线；只从选中样本聚合，不含 note 原文）
  const reasons = new Map<string, number>()
  const modelCounts = new Map<string, number>()
  const tierCounts: Record<QaTierName, number> = { high: 0, mid: 0, low: 0 }
  const outcomeCounts: Record<QaGoldenOutcome, number> = { clean: 0, retry: 0, 'qa-back': 0, long: 0, stall: 0 }
  const durations: number[] = []
  let clean = 0
  for (const t of tickets) {
    outcomeCounts[t.outcome] += 1
    if (t.gateFails === 0) clean += 1
    if (t.dispatchToCloseMs !== null) durations.push(t.dispatchToCloseMs)
    for (const model of t.models) {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1)
      const tier = options.tierOf?.(model) ?? null
      if (tier !== null) tierCounts[tier] += 1
    }
  }
  for (const issue of tickets.map((t) => t.ticket)) {
    const life = lifecycleOf(issue, byIssue.get(issue) ?? [])
    for (const [reason, count] of life.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + count)
  }
  const stats: QaGoldenStats = {
    onePassRate: tickets.length > 0 ? clean / tickets.length : null,
    failReasonCounts: Object.fromEntries([...reasons.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    duration: { medianMs: medianOf(durations), p90Ms: p90Of(durations) },
    modelCounts: Object.fromEntries([...modelCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    tierCounts,
    outcomeCounts,
    alarmSrcCounts: {},
  }
  const cohortMap = new Map<string, number>()
  for (const t of tickets) {
    const key = t.dept
    cohortMap.set(key, (cohortMap.get(key) ?? 0) + 1)
  }
  const cohorts = [...cohortMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => ({ key, count }))
  return { tickets, stats, cohorts }
}

/** golden 文件/清单文本（确定性：tickets 已排序、无 wall-clock 之外随机） */
export function goldenFileText(file: QaGoldenFile): string {
  return `${JSON.stringify(file, null, 2)}
`
}
export function manifestOf(fileText: string, version: string, count: number, generatedAt: string): QaGoldenManifest {
  return { schema: QA_GOLDEN_MANIFEST_SCHEMA, version, file: `golden-${version}.json`, sha256: sha256Hex(fileText), count, generatedAt }
}

function safeUnlink(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    /* 不存在=已清理 */
  }
}

/** v<n> → 数字（仅 v1/v2...；非法版本 → 明确拒绝） */
export function goldenVersionNumber(version: string): number {
  const m = /^v(\d+)$/.exec(version)
  if (m === null) throw new Error(`golden version 形状须 v<n>：${version}`)
  return Number(m[1])
}

/**
 * 写 golden + manifest（**显式人工入口**；版本升序，绝不自动覆盖旧 golden）：
 *   - 已有 manifest：请求 version 必须 **> 旧 version**，否则明确拒绝（文案说明升 version）；
 *   - 新版本写 `golden-v<n>.json`（旧 v 文件保留，可回滚），manifest 原子更新指向最新版本；
 *   - manifest 更新失败 → 删除本次新 golden、还原旧 manifest（旧版可用）；
 *   - 该版本 golden 文件已存在 → 拒绝（防止半途/手工残留被覆盖）。
 */
export function writeGoldenFiles(dir: string, golden: QaGoldenFile, manifest: QaGoldenManifest): { goldenPath: string; manifestPath: string } {
  const goldenPath = path.join(dir, manifest.file)
  const manifestPath = path.join(dir, 'manifest.json')
  const nextVersion = goldenVersionNumber(manifest.version)
  let previousManifest: QaGoldenManifest | undefined
  if (existsSync(manifestPath)) {
    try {
      previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as QaGoldenManifest
    } catch {
      throw new Error(`已有 manifest 无法解析：${manifestPath}（人工处置后再建）`)
    }
    if (previousManifest.schema !== QA_GOLDEN_MANIFEST_SCHEMA) throw new Error(`已有 manifest schema 不符：${String(previousManifest.schema)}`)
    const prevVersion = goldenVersionNumber(previousManifest.version)
    if (nextVersion <= prevVersion) {
      throw new Error(`golden 版本须升序：当前 ${previousManifest.version}，请求 ${manifest.version}——请以更高 --version 人工审后新建（旧版保留可回滚）`)
    }
  }
  if (existsSync(goldenPath)) throw new Error(`golden 文件已存在：${goldenPath}（不覆盖；如需重建请升 --version）`)
  mkdirSync(dir, { recursive: true })
  const text = goldenFileText(golden)
  const manifestText = `${JSON.stringify(manifest, null, 2)}
`
  const tmpGolden = `${goldenPath}.tmp-${String(process.pid)}`
  const tmpManifest = `${manifestPath}.tmp-${String(process.pid)}`
  const manifestBackup = `${manifestPath}.bak-${String(process.pid)}`
  let backedUp = false
  let goldenRenamed = false
  try {
    writeFileSync(tmpGolden, text, 'utf8')
    writeFileSync(tmpManifest, manifestText, 'utf8')
    if (existsSync(manifestPath)) {
      renameSync(manifestPath, manifestBackup)
      backedUp = true
    }
    renameSync(tmpGolden, goldenPath)
    goldenRenamed = true
    renameSync(tmpManifest, manifestPath)
    if (backedUp) safeUnlink(manifestBackup)
    return { goldenPath, manifestPath }
  } catch (err) {
    safeUnlink(tmpGolden)
    safeUnlink(tmpManifest)
    if (goldenRenamed) safeUnlink(goldenPath)
    if (backedUp) {
      try {
        if (existsSync(manifestBackup) && !existsSync(manifestPath)) renameSync(manifestBackup, manifestPath)
      } catch {
        /* 还原失败不掩盖原错误（备份仍在） */
      }
    }
    throw err
  }
}

/** 载入 golden（manifest 必在；sha256/版本/schema/重复 ticket 校验；只读） */
export function loadGolden(dir: string, version?: string): { golden: QaGoldenFile; manifest: QaGoldenManifest; sha256: string; path: string } {
  const manifestPath = path.join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`golden manifest 不存在：${manifestPath}（先由 QA-1 人工跑 --build-golden）`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as QaGoldenManifest
  if (manifest.schema !== QA_GOLDEN_MANIFEST_SCHEMA) throw new Error(`golden manifest schema 不符：${String(manifest.schema)}`)
  if (version !== undefined && manifest.version !== version) throw new Error(`golden 版本不符：要求 ${version}，manifest=${manifest.version}`)
  const goldenPath = path.join(dir, manifest.file)
  if (!existsSync(goldenPath)) throw new Error(`golden 文件不存在：${goldenPath}`)
  const text = readFileSync(goldenPath, 'utf8')
  const sha = sha256Hex(text)
  if (sha !== manifest.sha256) throw new Error(`golden 哈希不符（manifest≠文件）：${sha}`)
  const golden = JSON.parse(text) as QaGoldenFile
  if (golden.schema !== QA_GOLDEN_SCHEMA) throw new Error(`golden schema 不符：${String(golden.schema)}`)
  if (golden.version !== manifest.version) throw new Error(`golden 版本与 manifest 不一致：${golden.version}≠${manifest.version}`)
  if (!Array.isArray(golden.tickets) || golden.tickets.length !== manifest.count) throw new Error(`golden 样本数不符：${String(golden.tickets?.length)}≠${String(manifest.count)}`)
  const seen = new Set<string>()
  for (const t of golden.tickets) {
    if (typeof t.ticket !== 'string' || t.ticket === '') throw new Error('golden ticket 含空单号')
    if (seen.has(t.ticket)) throw new Error(`golden 重复 ticket：${t.ticket}`)
    seen.add(t.ticket)
  }
  return { golden, manifest, sha256: sha, path: goldenPath }
}
