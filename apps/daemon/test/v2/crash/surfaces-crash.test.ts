/**
 * surfaces-crash —— MIG-06：记录面第 7/8/9 注入点（backup-snapshot／projection-rebuild／
 * exclusion-report）V2 crash 腿（真子进程 SIGKILL，无 mock）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/03 MIG-06「记录面注入点补点（2026-10-28 MIG-04 交付登记）」：余 3 点归本波补登入
 *     CRASH_POINTS 并加 V2 测试；
 *   - plan/04 §1.6（V5 记录面四点扩展：备份快照写入中／投影重建中／rebuild 排除域报告写入中；
 *     扩展规则＝先登记冻结表新行再测试）；
 *   - docs/v2/17 §1.1 V5 行（每个 kill 点重启后三不变量成立）／§三 NEG-MIG-01/02 邻接面；
 *   - docs/v2/16 §四（DOM-04 限域：只备份不重放；报告不得声称钱账已重建）／§一 B11
 *     （rebuild 循环体只 appendEvent；单事务原子）／docs/v2/05 §三 DOM-04/05。
 *
 * 注入手法（真实子进程，无 mock；完成屏障前 SIGKILL）：
 *   ⑦ backup-snapshot：临时目录真库 4 行 cost_daily → 子进程用生产 backupCostDaily staging
 *     全量后把 JSONL 截到一半（侧车仍声明全量身份）→ 打 PRE_COMMIT → rename 前 SIGKILL
 *     → 重启断言 canonical 备份不成立、半件/孤儿侧车不被当完整 → 重跑生产备份产完整件且
 *     sha 与崩溃前声明的全量身份一致。
 *   ⑧ projection-rebuild：6 行 events JSONL → 子进程 openLedger(target)→BEGIN→生产 appendEvent
 *     重放前 3 行→打 PRE_COMMIT（事务内 replayed=3）→COMMIT 前 SIGKILL → 重启断言事务回滚、
 *     目标库零半投影 → 重跑生产 rebuild 全量 6 行、连跑两次不重复不丢、排除域零重放。
 *   ⑨ exclusion-report：子进程生产 rebuild 提交后渲染报告（4 行）→ 前 2 行写 staging →
 *     打 PRE_COMMIT → rename 前 SIGKILL → 重启断言 canonical 报告不存在、半报告缺排除域
 *     理由/备份声明不得当有效 → 重跑产完整报告（含排除域，且不称钱账已重建）。
 *
 * 三不变量：
 *   ① 不丢终态：⑦ 源库 4 行只读不变；⑧ 已提交种子/目标库完整性跨崩溃存活；⑨ 已提交重建不受
 *      报告半写影响（events=6 原样），重跑仍全量；
 *   ② 不假绿：三腿命中必须 `signal=SIGKILL`＋`code=null`；未命中点名必须 exit 91＋清 staging
 *      （绝不 exit 0 冒充崩溃）；半件有效性一律以「完整字节＋摘要＋行数/段齐全」判定；
 *   ③ 不重复副作用：⑦ 重跑覆盖同一 canonical（第二跑字节/sha 不变）；⑧ 二次 rebuild 仍 6 行
 *      （distinct=6，不 12）；⑨ 报告只落 canonical 一份（.partial 经 rename 消失）。
 *
 * 边界：⑦⑧⑨ **无生产调用点**（记录面写面归 store；daemon 生产侧不 import），注册名仅供本
 * 测试子进程使用；子进程经 store 公开写路径或 staging 产物在提交/rename 前调用 crashHook。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentVersion, openLedger, type Ledger } from '@studio-next/store'
import { readCostDailyBackup, verifyBackup } from '../../../../../packages/store/src/backup.ts'
import { renderRebuildReport } from '../../../../../packages/store/src/rebuild.ts'
import { CRASH_POINTS } from '../../../src/engine/crash-points.ts'
import {
  BACKUP_POINT,
  DB_ENV,
  EXCLUSION_POINT,
  EXPECTED_COST_ROWS,
  EXPECTED_EVENTS,
  HALF_COST_ROWS,
  HALF_EVENTS,
  MODE_ENV,
  OUT_ENV,
  REBUILD_POINT,
  SOURCE_ENV,
  costRows,
  eventRows,
} from './fixtures/surfaces-crash-scenario.ts'

const BACKUP_CHILD = fileURLToPath(new URL('./fixtures/backup-crash-child.ts', import.meta.url))
const REBUILD_CHILD = fileURLToPath(new URL('./fixtures/rebuild-crash-child.ts', import.meta.url))
const EXCLUSION_CHILD = fileURLToPath(new URL('./fixtures/exclusion-crash-child.ts', import.meta.url))

let root = ''
let backupDb = ''
let backupOut = ''
let backupNegOut = ''
let sourceJsonl = ''
let rebuildTarget = ''
let rebuildNegTarget = ''
let reportTarget = ''
let reportPath = ''
let reportNegTarget = ''
let reportNegPath = ''
const live = new Set<ChildProcess>()

afterAll(async () => {
  for (const child of live) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  live.clear()
  if (root !== '') await rm(root, { recursive: true, force: true })
})

interface ChildRun {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

/** spawn 真子进程（每腿独立子进程文件；env 覆盖式注入，SN_CRASH_POINT='' 保证不误杀） */
function runChild(script: string, env: Record<string, string>): Promise<ChildRun> {
  const child = spawn(process.execPath, ['--no-warnings', script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  live.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })
  return new Promise<ChildRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      live.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

/** 取子进程证据行（前缀严格匹配，防止把别的输出当证据） */
function evidenceLine(run: ChildRun, prefix: 'PRE_COMMIT' | 'COMMITTED' | 'REBUILT'): string {
  const line = run.stdout.split('\n').find((candidate) => candidate.startsWith(`${prefix} `))
  if (line === undefined) throw new Error(`子进程未输出 ${prefix} 证据行；stdout=${JSON.stringify(run.stdout)}`)
  return line.slice(prefix.length + 1)
}

function countRows(ledger: Ledger, table: 'events' | 'cost_daily'): number {
  const row = ledger.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as unknown as { c: number }
  return Number(row.c)
}

function integrity(ledger: Ledger): string {
  const row = ledger.db.prepare('PRAGMA integrity_check').get() as unknown as { integrity_check: string }
  return String(row.integrity_check)
}

/** 独立复算摘要（测试侧 node:crypto，不信任生产实现自报） */
function independentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 备份件完整性判定：canonical 存在＋侧车摘要校验通过＋行数等于源行数（三合一才算有效） */
function backupComplete(outPath: string, expectedRows: number): boolean {
  const digestPath = `${outPath}.sha256`
  if (!existsSync(outPath) || !existsSync(digestPath)) return false
  const declared = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0] ?? ''
  try {
    const checked = verifyBackup(outPath, declared)
    return checked.ok && checked.lines === expectedRows
  } catch {
    return false
  }
}

/** 排除域报告完整性判定：须含排除域清单/理由/备份声明，且不得称钱账已重建 */
function reportComplete(text: string): boolean {
  return (
    text.includes('已重建：events=')
    && text.includes('排除域：cost_daily')
    && text.includes('只备份不重放')
    && text.includes('未随本次操作生成')
    && !text.includes('钱账已重建')
  )
}

interface BackupEvidence {
  point: string
  totalLines: number
  partialLines: number
  declaredSha256: string
  digestPath: string
  partialPath: string
  outPath: string
  sourceRows: number
}

interface BackupCommitted {
  point: string
  domain: string
  lines: number
  sha256: string
  digestPath: string
  outPath: string
}

interface RebuildEvidence {
  point: string
  replayed: number
  total: number
  eventsInTx: number
  version: number
  target: string
}

interface RebuildDone {
  point: string
  events: number
  version: number
  excludedDomains: string[]
  dbEvents: number
  distinctIds: number
  ids: string[]
  costDaily: number
}

interface ReportEvidence {
  point: string
  events: number
  version: number
  reportLines: number
  partialLines: number
  excludedDomains: string[]
  target: string
  reportPath: string
  partialPath: string
}

interface ReportDone {
  point: string
  events: number
  version: number
  reportLines: number
  excludedDomains: string[]
  target: string
  reportPath: string
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-surfaces-crash-'))
  backupDb = path.join(root, 'backup-source.db')
  backupOut = path.join(root, 'cost_daily.jsonl')
  backupNegOut = path.join(root, 'neg-cost_daily.jsonl')
  sourceJsonl = path.join(root, 'events.jsonl')
  rebuildTarget = path.join(root, 'rebuild-target.db')
  rebuildNegTarget = path.join(root, 'rebuild-neg-target.db')
  reportTarget = path.join(root, 'report-target.db')
  reportPath = path.join(root, 'rebuild-report.md')
  reportNegTarget = path.join(root, 'report-neg-target.db')
  reportNegPath = path.join(root, 'report-neg.md')

  // ⑦ 备份源库：4 行定型钱账（崩溃前已提交；备份只读源表）
  const backupLedger = openLedger(backupDb)
  try {
    for (const row of costRows()) backupLedger.appendCostDaily(row)
  } finally {
    backupLedger.close()
  }

  // ⑧⑨ 事件源库：6 行 events＋2 行钱账（钱账属排除域，不随重建重放）；dump 成 JSONL
  const sourceLedger = openLedger(path.join(root, 'events-source.db'))
  try {
    for (const event of eventRows()) sourceLedger.appendEvent(event)
    for (const row of costRows().slice(0, 2)) sourceLedger.appendCostDaily(row)
    const dumped = sourceLedger.dumpEvents(sourceJsonl)
    expect(dumped.lines).toBe(EXPECTED_EVENTS)
    expect(dumped.excludedDomains.map((ref) => ref.domain)).toEqual(['cost_daily'])
  } finally {
    sourceLedger.close()
  }
})

describe('九点登记与生产调用点（⑦⑧⑨ 无新增生产调用点）', () => {
  it('CRASH_POINTS 长度=9：第 7/8/9 点按冻结表追加；①-⑥ 名称与顺序逐字不变', () => {
    expect(CRASH_POINTS).toEqual([
      'dispatch-reserved',
      'dispatch-launched',
      'harvest-verdict',
      'heartbeat-write',
      'shutdown-drain',
      'records-commit',
      'backup-snapshot',
      'projection-rebuild',
      'exclusion-report',
    ])
    expect(CRASH_POINTS).toHaveLength(9)
    expect(CRASH_POINTS[6]).toBe(BACKUP_POINT)
    expect(CRASH_POINTS[7]).toBe(REBUILD_POINT)
    expect(CRASH_POINTS[8]).toBe(EXCLUSION_POINT)
    expect(CRASH_POINTS[5]).toBe('records-commit')
  })

  it('生产调用点不变：engine.ts 仍 5 处 crashHook；⑦⑧⑨ 只作注册名（不进生产代码）', () => {
    const engineSrc = readFileSync(new URL('../../../src/engine/engine.ts', import.meta.url), 'utf8')
    const calls = engineSrc.match(/crashHook\('/g) ?? []
    expect(calls).toHaveLength(5) // ①-⑤ 旧五点；⑦⑧⑨ 不新增生产调用点
    for (const point of [BACKUP_POINT, REBUILD_POINT, EXCLUSION_POINT]) {
      expect(engineSrc).not.toContain(point)
    }
    // 注册名确实在冻结表（唯一权威）——测试子进程消费该注册名
    const crashSrc = readFileSync(new URL('../../../src/engine/crash-points.ts', import.meta.url), 'utf8')
    for (const point of [BACKUP_POINT, REBUILD_POINT, EXCLUSION_POINT]) {
      expect(crashSrc).toContain(point)
    }
  })
})

describe('第 7 点 backup-snapshot（备份件/侧车写入中，rename 前硬杀）', () => {
  it('负控：未命中点名=零行为（exit 91、不自杀、无 staging/canonical 残留）', async () => {
    const run = await runChild(BACKUP_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: backupDb,
      [OUT_ENV]: backupNegOut,
      SN_CRASH_POINT: 'dispatch-reserved',
    })
    expect(run.code).toBe(91)
    expect(run.signal).toBeNull()
    expect(run.stderr).toContain('CRASH_HOOK_NOT_ARMED')
    expect(existsSync(backupNegOut)).toBe(false)
    expect(existsSync(`${backupNegOut}.sha256`)).toBe(false)
    expect(existsSync(`${backupNegOut}.partial`)).toBe(false)
    expect(existsSync(`${backupNegOut}.partial.sha256`)).toBe(false)

    const ledger = openLedger(backupDb)
    try {
      expect(ledger.listCostDaily()).toHaveLength(EXPECTED_COST_ROWS)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
  })

  it('命中 backup-snapshot：半 JSONL＋全量摘要侧车、rename 前 SIGKILL → canonical 不成立、半件不被当完整', async () => {
    const run = await runChild(BACKUP_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: backupDb,
      [OUT_ENV]: backupOut,
      SN_CRASH_POINT: BACKUP_POINT,
    })

    // —— 不假绿：真进程硬杀，不是 exit 0 / 优雅停 ——
    expect(run.code).toBeNull()
    expect(run.signal).toBe('SIGKILL')
    expect(run.stderr).not.toContain('CRASH_HOOK_NOT_ARMED')

    // —— 命中点直证：全量 4 行、只刷出 2 行、侧车声明全量身份，随后才死 ——
    const pre = JSON.parse(evidenceLine(run, 'PRE_COMMIT')) as BackupEvidence
    expect(pre).toMatchObject({ point: BACKUP_POINT, totalLines: EXPECTED_COST_ROWS, partialLines: HALF_COST_ROWS, sourceRows: EXPECTED_COST_ROWS })
    expect(pre.declaredSha256).toMatch(/^[0-9a-f]{64}$/)

    // —— 重启：canonical 备份不成立（完成屏障未过 → 无「有效备份」声明）——
    expect(existsSync(backupOut)).toBe(false)
    expect(existsSync(`${backupOut}.sha256`)).toBe(false)

    // —— 半件 + 侧车存在，但摘要不符/行数不足：不得被当完整备份 ——
    expect(existsSync(pre.partialPath)).toBe(true)
    expect(existsSync(pre.digestPath)).toBe(true)
    const partialText = readFileSync(pre.partialPath, 'utf8')
    expect(partialText.split('\n').filter((line) => line !== '')).toHaveLength(HALF_COST_ROWS)
    const checked = verifyBackup(pre.partialPath, pre.declaredSha256)
    expect(checked.ok).toBe(false)
    expect(checked.actual).not.toBe(checked.expected)
    expect(checked.lines).toBe(HALF_COST_ROWS)
    expect(readCostDailyBackup(pre.partialPath)).toHaveLength(HALF_COST_ROWS)
    expect(backupComplete(pre.partialPath, EXPECTED_COST_ROWS)).toBe(false)

    // —— 不丢终态：备份只读源表，4 行原样 ——
    const ledger = openLedger(backupDb)
    try {
      expect(ledger.listCostDaily()).toHaveLength(EXPECTED_COST_ROWS)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
    console.log(`[backup-snapshot] signal=${String(run.signal)} 事务外全量=${String(pre.totalLines)} staging半写=${String(pre.partialLines)} canonical存在=${String(existsSync(backupOut))}`)
  })

  it('重启重跑：生产 backupCostDaily 产完整备份、sha 与崩溃前声明的全量身份一致、二次重跑字节不变', async () => {
    const run = await runChild(BACKUP_CHILD, {
      [MODE_ENV]: 'commit',
      [DB_ENV]: backupDb,
      [OUT_ENV]: backupOut,
      SN_CRASH_POINT: '',
    })
    expect(run.code).toBe(0)
    expect(run.signal).toBeNull()
    const done = JSON.parse(evidenceLine(run, 'COMMITTED')) as BackupCommitted
    expect(done).toMatchObject({ point: BACKUP_POINT, domain: 'cost_daily', lines: EXPECTED_COST_ROWS, outPath: backupOut })

    // 崩溃前声明的全量身份（staging 侧车仍在）＝重跑后的 canonical 摘要
    const declared = readFileSync(`${backupOut}.partial.sha256`, 'utf8').trim().split(/\s+/)[0] ?? ''
    expect(done.sha256).toBe(declared)
    expect(independentSha256(readFileSync(backupOut, 'utf8'))).toBe(done.sha256)
    expect(verifyBackup(backupOut, done.sha256)).toMatchObject({ ok: true, lines: EXPECTED_COST_ROWS })
    expect(readCostDailyBackup(backupOut)).toHaveLength(EXPECTED_COST_ROWS)
    // 行序契约＝(cost_date, person_id, model, id) 升序：种子 4 行的读回序为 500/502/501/503
    expect(readCostDailyBackup(backupOut).map((row) => row.id).sort()).toEqual(costRows().map((row) => String(row['id'])).sort())
    expect(readFileSync(done.digestPath, 'utf8')).toBe(`${done.sha256}  ${path.basename(backupOut)}\n`)
    expect(backupComplete(backupOut, EXPECTED_COST_ROWS)).toBe(true)
    // 半件 staging 仍在但永不因 canonical 完成而变成「完整备份」
    expect(backupComplete(`${backupOut}.partial`, EXPECTED_COST_ROWS)).toBe(false)

    // —— 不重复副作用：同库同内容第二跑覆盖同一 canonical（字节/sha 不变）——
    const firstBytes = readFileSync(backupOut, 'utf8')
    const second = await runChild(BACKUP_CHILD, {
      [MODE_ENV]: 'commit',
      [DB_ENV]: backupDb,
      [OUT_ENV]: backupOut,
      SN_CRASH_POINT: '',
    })
    expect(second.code).toBe(0)
    const doneAgain = JSON.parse(evidenceLine(second, 'COMMITTED')) as BackupCommitted
    expect(doneAgain.sha256).toBe(done.sha256)
    expect(readFileSync(backupOut, 'utf8')).toBe(firstBytes)
    console.log(`[backup-snapshot] 重跑 sha=${done.sha256.slice(0, 12)}… 行数=${String(done.lines)} 二次sha一致=${String(doneAgain.sha256 === done.sha256)}`)
  })
})

describe('第 8 点 projection-rebuild（投影重建提交前后，COMMIT 前硬杀）', () => {
  it('负控：未命中点名=零行为（exit 91、不自杀、目标库零事件）', async () => {
    const run = await runChild(REBUILD_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: rebuildNegTarget,
      [SOURCE_ENV]: sourceJsonl,
      SN_CRASH_POINT: 'dispatch-reserved',
    })
    expect(run.code).toBe(91)
    expect(run.signal).toBeNull()
    expect(run.stderr).toContain('CRASH_HOOK_NOT_ARMED')
    const ledger = openLedger(rebuildNegTarget)
    try {
      expect(currentVersion(ledger.db)).toBe(15)
      expect(ledger.queryEvents()).toHaveLength(0)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
  })

  it('命中 projection-rebuild：事务内半投影、COMMIT 前 SIGKILL → 重启回滚、目标库无半投影', async () => {
    const run = await runChild(REBUILD_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: rebuildTarget,
      [SOURCE_ENV]: sourceJsonl,
      SN_CRASH_POINT: REBUILD_POINT,
    })
    expect(run.code).toBeNull()
    expect(run.signal).toBe('SIGKILL')
    expect(run.stderr).not.toContain('CRASH_HOOK_NOT_ARMED')

    const pre = JSON.parse(evidenceLine(run, 'PRE_COMMIT')) as RebuildEvidence
    expect(pre).toMatchObject({ point: REBUILD_POINT, replayed: HALF_EVENTS, total: EXPECTED_EVENTS, eventsInTx: HALF_EVENTS, version: 15 })

    // 重启同库：未 COMMIT 的事务回滚（事务内 3 行 → 重启后 0 行），无半投影
    const ledger = openLedger(rebuildTarget)
    try {
      expect(currentVersion(ledger.db)).toBe(15)
      expect(countRows(ledger, 'events')).toBe(0)
      expect(ledger.queryEvents()).toHaveLength(0)
      expect(countRows(ledger, 'cost_daily')).toBe(0)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
    console.log(`[projection-rebuild] signal=${String(run.signal)} 事务内events=${String(pre.eventsInTx)} 重启后events=0`)
  })

  it('重跑 rebuild 幂等：全量 6 行、二次仍 6 行（distinct=6，不重复不丢）、排除域零重放', async () => {
    const first = await runChild(REBUILD_CHILD, {
      [MODE_ENV]: 'run',
      [DB_ENV]: rebuildTarget,
      [SOURCE_ENV]: sourceJsonl,
      SN_CRASH_POINT: '',
    })
    expect(first.code).toBe(0)
    expect(first.signal).toBeNull()
    const done = JSON.parse(evidenceLine(first, 'REBUILT')) as RebuildDone
    const expectedIds = eventRows().map((row) => String(row['id']))
    expect(done).toMatchObject({ point: REBUILD_POINT, events: EXPECTED_EVENTS, version: 15, excludedDomains: ['cost_daily'], dbEvents: EXPECTED_EVENTS, distinctIds: EXPECTED_EVENTS, costDaily: 0 })
    expect(done.ids).toEqual(expectedIds)

    const ledger = openLedger(rebuildTarget)
    let firstEvents: string
    try {
      expect(ledger.queryEvents()).toHaveLength(EXPECTED_EVENTS)
      expect(ledger.queryEvents().map((event) => event.id)).toEqual(expectedIds)
      expect(countRows(ledger, 'cost_daily')).toBe(0) // 排除域不重放
      expect(integrity(ledger)).toBe('ok')
      firstEvents = JSON.stringify(ledger.queryEvents())
    } finally {
      ledger.close()
    }

    // —— 不重复副作用：同源二次 rebuild 幂等（appendEvent 同 id 全列一致跳过）——
    const second = await runChild(REBUILD_CHILD, {
      [MODE_ENV]: 'run',
      [DB_ENV]: rebuildTarget,
      [SOURCE_ENV]: sourceJsonl,
      SN_CRASH_POINT: '',
    })
    expect(second.code).toBe(0)
    const doneAgain = JSON.parse(evidenceLine(second, 'REBUILT')) as RebuildDone
    expect(doneAgain).toMatchObject({ events: EXPECTED_EVENTS, dbEvents: EXPECTED_EVENTS, distinctIds: EXPECTED_EVENTS, costDaily: 0 })
    expect(doneAgain.ids).toEqual(expectedIds)

    const ledgerAgain = openLedger(rebuildTarget)
    try {
      expect(countRows(ledgerAgain, 'events')).toBe(EXPECTED_EVENTS) // 不是 12
      expect(JSON.stringify(ledgerAgain.queryEvents())).toBe(firstEvents) // 不丢/不改写
      expect(integrity(ledgerAgain)).toBe('ok')
    } finally {
      ledgerAgain.close()
    }
    console.log(`[projection-rebuild] 首次events=${String(done.events)} 二次events=${String(doneAgain.events)} distinct=${String(doneAgain.distinctIds)} costDaily=${String(doneAgain.costDaily)}`)
  })
})

describe('第 9 点 exclusion-report（排除域报告写入中，rename 前硬杀）', () => {
  it('负控：未命中点名=零行为（exit 91、不自杀、无报告 staging/canonical 残留）', async () => {
    const run = await runChild(EXCLUSION_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: reportNegTarget,
      [SOURCE_ENV]: sourceJsonl,
      [OUT_ENV]: reportNegPath,
      SN_CRASH_POINT: 'dispatch-reserved',
    })
    expect(run.code).toBe(91)
    expect(run.signal).toBeNull()
    expect(run.stderr).toContain('CRASH_HOOK_NOT_ARMED')
    expect(existsSync(reportNegPath)).toBe(false)
    expect(existsSync(`${reportNegPath}.partial`)).toBe(false)
    // 报告腿前置的 rebuild 已提交（生产行为非崩溃面）：目标库完整、非半投影
    const ledger = openLedger(reportNegTarget)
    try {
      expect(ledger.queryEvents()).toHaveLength(EXPECTED_EVENTS)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
  })

  it('命中 exclusion-report：报告半写、rename 前 SIGKILL → canonical 报告不存在、半报告不得当有效', async () => {
    const run = await runChild(EXCLUSION_CHILD, {
      [MODE_ENV]: 'crash',
      [DB_ENV]: reportTarget,
      [SOURCE_ENV]: sourceJsonl,
      [OUT_ENV]: reportPath,
      SN_CRASH_POINT: EXCLUSION_POINT,
    })
    expect(run.code).toBeNull()
    expect(run.signal).toBe('SIGKILL')
    expect(run.stderr).not.toContain('CRASH_HOOK_NOT_ARMED')

    const pre = JSON.parse(evidenceLine(run, 'PRE_COMMIT')) as ReportEvidence
    expect(pre).toMatchObject({ point: EXCLUSION_POINT, events: EXPECTED_EVENTS, version: 15, reportLines: 4, partialLines: 2, excludedDomains: ['cost_daily'], reportPath })
    expect(pre.partialLines).toBeLessThan(pre.reportLines)

    // 重启：canonical 报告不存在（rename 未过）；staging 半报告存在
    expect(existsSync(reportPath)).toBe(false)
    expect(existsSync(pre.partialPath)).toBe(true)
    const partialText = readFileSync(pre.partialPath, 'utf8')
    expect(partialText.split('\n').filter((line) => line !== '')).toHaveLength(pre.partialLines)
    // 半报告缺「排除域理由/备份声明」——不得当有效报告（NEG：半件不冒充完整）
    expect(partialText).not.toContain('只备份不重放')
    expect(partialText).not.toContain('未随本次操作生成')
    expect(reportComplete(partialText)).toBe(false)

    // —— 不丢终态：报告半写不回头破坏已提交的重建（events=6；排除域零重放）——
    const ledger = openLedger(reportTarget)
    try {
      expect(ledger.queryEvents()).toHaveLength(EXPECTED_EVENTS)
      expect(countRows(ledger, 'cost_daily')).toBe(0)
      expect(integrity(ledger)).toBe('ok')
    } finally {
      ledger.close()
    }
    console.log(`[exclusion-report] signal=${String(run.signal)} 报告行=${String(pre.reportLines)} 半写行=${String(pre.partialLines)} canonical存在=${String(existsSync(reportPath))}`)
  })

  it('重跑：rename 出完整报告，含排除域清单/理由/备份声明，与生产渲染逐行一致且不称钱账已重建', async () => {
    const run = await runChild(EXCLUSION_CHILD, {
      [MODE_ENV]: 'commit',
      [DB_ENV]: reportTarget,
      [SOURCE_ENV]: sourceJsonl,
      [OUT_ENV]: reportPath,
      SN_CRASH_POINT: '',
    })
    expect(run.code).toBe(0)
    expect(run.signal).toBeNull()
    const done = JSON.parse(evidenceLine(run, 'COMMITTED')) as ReportDone
    expect(done).toMatchObject({ point: EXCLUSION_POINT, events: EXPECTED_EVENTS, version: 15, reportLines: 4, excludedDomains: ['cost_daily'], reportPath })

    expect(existsSync(reportPath)).toBe(true)
    expect(existsSync(`${reportPath}.partial`)).toBe(false) // rename 后 staging 不残留
    const text = readFileSync(reportPath, 'utf8')
    const expected = renderRebuildReport({ events: EXPECTED_EVENTS, version: done.version, excludedDomains: ['cost_daily'] }, done.target).join('\n') + '\n'
    expect(text).toBe(expected)
    expect(reportComplete(text)).toBe(true)
    expect(text).toContain('排除域：cost_daily')
    expect(text).toContain('只备份不重放')
    expect(text).toContain('未随本次操作生成')
    expect(text).not.toContain('钱账已重建')
    expect(text).not.toMatch(/\bUSD\b/)
    console.log(`[exclusion-report] 完整报告行=${String(done.reportLines)} 排除域=${done.excludedDomains.join(',')} 半报告有效=${String(false)}`)
  })
})
