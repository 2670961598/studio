/**
 * drill —— 删库重建演习（F2-12 季度演习的可操作化；16-§四 v0.2 验收「删库重建演习一次通过」）
 *
 * 演习全链（`studio-next ledger drill <库路径>` 调用；流程沿 test/rebuild.test.ts 既有演习形态）：
 *   防呆（库路径必须不存在——不拿真实台账演习）→ 自建语料写入 → dumpEvents（JSONL 落 tmp，
 *   演习后清理）→ close + 删库三件套（db / -wal / -shm）→ rebuild 原路径重建 → 比对报告
 *   （删库到位 / 计数一致 / 逐条一致 / schema_version 一致）→ 人读结论「演习 PASS/FAIL」。
 *
 * 语料口径：与 test/rebuild.test.ts drillCorpus 同覆盖面（前缀族 GW_* / REPORT_*、四桶变体、
 *   可选字段满配）；事件 id 用**确定性**合成 ULID（时间位=ts、随机位=序号，无 crypto 随机）——
 *   演习可重现，且不越俎代庖：生产侧 ULID 由 daemon 生成（test/ulid.ts 头注口径）。
 * 结论留证：报告走 stdout（operator 重定向落盘即演习证据，F2-12「演习留盘证据」）；
 *   重建后的库留在 <库路径>（演习产物），tmp 目录用后即删。
 */
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configInvalid, type EventRecord } from '@studio-next/contract'
import { openLedger } from './ledger.ts'
import { rebuild } from './rebuild.ts'

/** 单项比对结果：name 人读（计数一致/逐条一致/…），detail 带前后值 */
export interface DrillCheck {
  name: string
  pass: boolean
  detail: string
}

/** 演习报告：pass=四检查全绿；渲染见 renderDrillReport */
export interface DrillReport {
  pass: boolean
  dbPath: string
  /** 演习语料事件数（写入条数） */
  corpus: number
  /** dumpEvents 写出 JSONL 行数 */
  dumpedLines: number
  /** rebuild 重放进库条数 */
  rebuiltEvents: number
  versionBefore: number
  versionAfter: number
  checks: DrillCheck[]
}

/** 演习语料（覆盖面沿 test/rebuild.test.ts drillCorpus；id 确定性合成，见文件头注） */
function drillCorpus(): EventRecord[] {
  const base = 1780000000000
  const events: EventRecord[] = []
  const push = (patch: Partial<EventRecord>): void => {
    const i = events.length
    const ts = base + i * 1000
    events.push({
      id: syntheticUlid(ts, i),
      ts,
      company: i % 3 === 0 ? 'poly' : 'games',
      issue: `STUDIO-${200 + (i % 5)}`,
      event: 'DISPATCH',
      actor: `AGENT-${1 + (i % 4)}:agent-${1 + (i % 4)}`,
      attempt: 1 + (i % 3),
      level: 2 + (i % 6),
      dept: 'departments/工程部',
      tokens: { input: 10 + i, output: 5 + i },
      ...patch,
    })
  }
  push({ event: 'DISPATCH' })
  push({ event: 'GATE_PASS', correlation_id: 'corr-a' })
  push({ event: 'GATE_FAIL', causation_id: 'cause-b', note: '验收红' })
  push({ event: 'QA_BACK' })
  push({ event: 'MERGE', payload_hash: 'sha256:abcd1234', size: 4096 })
  push({ event: 'CLOSE', duration_ms: 123456 })
  push({ event: 'STALL' })
  push({ event: 'QUARANTINE' })
  push({ event: 'APPROVE' })
  push({ event: 'ESCALATE' })
  push({ event: 'LLM', tokens: { input: 0 }, cost_usd: 0 })
  push({ event: 'SELF_EVAL', tokens: { output: 777 } })
  push({ event: 'POSTMORTEM', tokens: { cache_read: 100000 } })
  push({ event: 'PATROL', tokens: { cache_creation: 2048 } })
  push({ event: 'ORG_UPGRADE' })
  push({ event: 'KB_UPDATE' })
  push({ event: 'SCHEMA_EVOLVE' })
  push({ event: 'DAILY_ALARM' })
  push({ event: 'HEARTBEAT', tokens: { input: 0 } })
  push({ event: 'CIRCUIT_BREAK' })
  push({ event: 'RESUME' })
  push({ event: 'INVOKE_EXTERNAL' })
  push({ event: 'GW_COMMENT', correlation_id: 'corr-gw', causation_id: 'cause-b' })
  push({ event: 'GW_KB_SEARCH' })
  push({ event: 'REPORT_DAILY', payload_hash: 'sha256:feedface', size: 8192, duration_ms: 42, cost_usd: 0.0025, note: '日报' })
  push({
    event: 'LLM',
    tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
    cost_usd: 0.0125,
    duration_ms: 98765,
    size: 512,
    payload_hash: 'sha256:0011223344556677',
    note: '全可选字段',
    correlation_id: 'corr-full',
    causation_id: 'cause-full',
  })
  return events
}

/** Crockford Base32（ULID 字母表；与 contract UlidSchema 同源规范） */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    const idx = Number((value / 32n ** BigInt(i)) % 32n)
    out += B32[idx] ?? '0'
  }
  return out
}

/** 确定性合成 ULID：时间位=ts（10 字符，48bit），随机位=序号（16 字符）——同语料恒同 id，演习可重现 */
function syntheticUlid(ts: number, seq: number): string {
  return encodeBase32(BigInt(ts), 10) + encodeBase32(BigInt(seq), 16)
}

/** 删库三件套（db + -wal + -shm）：演习的「删库」动作 */
function dropDatabase(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true })
}

/** 逐条一致比对（两侧均出自 rowToEvent，键序恒定——JSON 序列化逐条比对即全列 deep-equal） */
function firstMismatch(a: EventRecord[], b: EventRecord[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i
  }
  return a.length === b.length ? -1 : n
}

/**
 * 跑一次删库重建演习。dbPath 必须不存在（防误删真实台账——存在即 CONFIG_INVALID）；
 * 演习产物（重建后的库）留在 dbPath；tmp 里的 JSONL 用后即删。
 */
export async function runLedgerDrill(dbPath: string): Promise<DrillReport> {
  if (existsSync(dbPath) || existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) {
    configInvalid('store/drill:target-exists', `演习库路径已存在：${dbPath}（防误删真实台账，演习必须用全新路径）`)
  }
  const tmp = await mkdtemp(path.join(tmpdir(), 'studio-next-drill-'))
  try {
    // ① 自建语料写入 → 快照（重建前基准）→ dump JSONL（落 tmp）
    const jsonl = path.join(tmp, 'drill.jsonl')
    const corpus = drillCorpus()
    const ledger = openLedger(dbPath)
    for (const e of corpus) ledger.appendEvent(e)
    const before = ledger.queryEvents()
    const versionBefore = ledger.version()
    const { lines } = ledger.dumpEvents(jsonl)
    ledger.close()

    // ② 删库三件套（真删，不留 -wal/-shm）
    dropDatabase(dbPath)
    const dropped = !existsSync(dbPath) && !existsSync(`${dbPath}-wal`) && !existsSync(`${dbPath}-shm`)

    // ③ 原路径重建（最强形态：灾难后原地恢复）
    const rebuilt = rebuild(jsonl, dbPath)

    // ④ 比对：删库到位 / 计数一致 / 逐条一致 / schema_version 一致
    const after = openLedger(dbPath)
    const afterEvents = after.queryEvents()
    const versionAfter = after.version()
    after.close()

    const diffAt = firstMismatch(before, afterEvents)
    const checks: DrillCheck[] = [
      { name: '删库到位', pass: dropped, detail: dropped ? 'db / -wal / -shm 三件已删' : '三件套有残留（删库未到位）' },
      {
        name: '计数一致',
        pass: before.length === afterEvents.length && rebuilt.events === before.length && lines === before.length,
        detail: `写入 ${before.length} → dump ${lines} → 重建 ${afterEvents.length}（rebuild 重放 ${rebuilt.events}）`,
      },
      {
        name: '逐条一致',
        pass: diffAt === -1,
        detail: diffAt === -1 ? `${before.length} 条全列 deep-equal（含 ULID 序）` : `第 ${diffAt + 1} 条不一致`,
      },
      {
        name: 'schema_version 一致',
        pass: versionBefore === versionAfter,
        detail: `v${versionBefore} → v${versionAfter}`,
      },
    ]
    return {
      pass: checks.every((c) => c.pass),
      dbPath,
      corpus: corpus.length,
      dumpedLines: lines,
      rebuiltEvents: rebuilt.events,
      versionBefore,
      versionAfter,
      checks,
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** 报告渲染（人读；末行「演习 PASS/FAIL」为冻结结论行——CLI exit 0/1 与 stdout 断言锚点） */
export function renderDrillReport(report: DrillReport): string[] {
  const lines: string[] = [
    `演习库：${report.dbPath}`,
    `语料：${report.corpus} 条事件（前缀族 / 四桶变体 / 可选字段满配）`,
    `快照：dumpEvents → ${report.dumpedLines} 行 JSONL（tmp，演习后清理）`,
    `重建：rebuild → ${report.rebuiltEvents} 条 / schema v${report.versionAfter}`,
  ]
  for (const check of report.checks) {
    lines.push(`比对：${check.pass ? '✓' : '✗'} ${check.name}（${check.detail}）`)
  }
  lines.push(report.pass ? '演习 PASS' : '演习 FAIL')
  return lines
}
