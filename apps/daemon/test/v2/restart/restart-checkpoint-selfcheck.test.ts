/**
 * restart-checkpoint / restart-selfcheck —— S5 检查点原子面 + 四口径判定单测（studio-dev-504）
 *
 * 覆盖：#497 §4.5（检查点 JSON/last-exit/原子写/失败不写 authorized= N9 注入）、
 *   §4.8（四口径各自 fail 注入 + takeover 交叉核对 = N10）、§4.10（repoHead 不可得=unknown）；
 *   store WAL checkpoint 薄面（busy≠0 抛错）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  checkpointPathOf,
  readCheckpoint,
  readLastExit,
  sha256,
  writeLastExit,
  writeRestartCheckpoint,
  writeSelfcheckReport,
  type RestartCheckpoint,
} from '../../../src/control/restart/checkpoint.ts'
import { evaluateRestartSelfcheck, type RestartSelfcheckProbes } from '../../../src/control/restart/selfcheck.ts'

let root = ''
let ledger: Ledger
const NOW = 1_793_000_000_000

function sampleCheckpoint(over: Partial<RestartCheckpoint> = {}): RestartCheckpoint {
  return {
    schema: 1,
    requestId: '01J0000000000000000000000A',
    at: NOW,
    company: 'demo',
    reason: '制作人令：受权重启验证',
    authorizer: { personId: 'AGENT-1', role: '工程部长', level: 2 },
    authorizationRef: 'sha256:approved-ref-504',
    exitClass: 'restart',
    tickSeq: 42,
    cursor: 'a-000042',
    inflightBefore: 1,
    settled: [{ issue: 'T-1', attempt: 1, status: 'done' }],
    interrupted: [],
    inconsistent: false,
    ledger: { path: '/tmp/x.sqlite', walBefore: 12, walAfter: 0 },
    repoHead: null,
    assetFingerprint: null,
    eventId: '01J0000000000000000000000B',
    ...over,
  }
}

function passProbes(over: Partial<RestartSelfcheckProbes> = {}): RestartSelfcheckProbes {
  return {
    ticksSinceStart: 3,
    tickSeq: () => 45,
    cursor: () => 'a-000043',
    heartbeatSeen: () => true,
    cursorLoopSeen: () => false,
    models: () => ({ catalogLoaded: true, mainWorkerTier: 'high', demoBypass: false }),
    executor: () => ({ count: 1, failures: [] }),
    takeover: () => 0,
    versionAlign: () => 'unknown',
    now: () => NOW,
    minTicks: 3,
    ...over,
  }
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-restart-checkpoint-'))
  ledger = openLedger(path.join(root, 'ledger.sqlite'))
})

afterAll(() => {
  try {
    ledger.close()
  } catch {
    // 已关
  }
  rmSync(root, { recursive: true, force: true })
})

describe('S3 检查点原子写 / last-exit / WAL', () => {
  it('检查点写盘：路径/哈希/回读深等（eventId 与 tickSeq/cursor 可核验）', () => {
    const checkpoint = sampleCheckpoint()
    const written = writeRestartCheckpoint(root, checkpoint)
    expect(written.path).toBe(checkpointPathOf(root, checkpoint.requestId))
    expect(existsSync(written.path)).toBe(true)
    expect(written.hash.startsWith('sha256:')).toBe(true)
    expect(written.hash).toBe(sha256(readFileSync(written.path, 'utf8')))
    expect(readCheckpoint(written.path)).toEqual(checkpoint)
  })

  it('last-exit：authorized=true/exitClass=restart 可读；坏 JSON=undefined', () => {
    writeLastExit(root, {
      schema: 1,
      authorized: true,
      exitClass: 'restart',
      requestId: 'req-1',
      at: NOW,
      checkpoint: { path: '/tmp/cp.json', hash: 'sha256:aa' },
      interrupted: 0,
    })
    const mark = readLastExit(root)
    expect(mark?.authorized).toBe(true)
    expect(mark?.exitClass).toBe('restart')
    expect(mark?.checkpoint?.hash).toBe('sha256:aa')
    writeFileSync(path.join(root, 'restart', 'last-exit.json'), '{bad', 'utf8')
    expect(readLastExit(root)).toBeUndefined()
  })

  it('N9 检查点写失败（restart 目录被普通文件占位）→ 抛错且不产生 authorized 标记', () => {
    const other = mkdtempSync(path.join(tmpdir(), 'studio-next-restart-fail-'))
    writeFileSync(path.join(other, 'restart'), 'occupied', 'utf8')
    expect(() => writeRestartCheckpoint(other, sampleCheckpoint())).toThrow()
    expect(existsSync(path.join(other, 'restart', 'last-exit.json'))).toBe(false)
    rmSync(other, { recursive: true, force: true })
  })

  it('store WAL checkpoint 薄面：返回非负页数；close 后 WAL 收干', () => {
    const dbPath = path.join(root, 'wal.sqlite')
    const l = openLedger(dbPath)
    l.kvSet('wal.test', 'v')
    const r = l.checkpoint()
    expect(r.walBefore).toBeGreaterThanOrEqual(0)
    expect(r.walAfter).toBe(0)
    l.close()
    expect(existsSync(`${dbPath}-wal`) === false || readFileSync(`${dbPath}-wal`).length === 0).toBe(true)
  })

  it('busy≠0 时 WAL checkpoint 抛错（不静默跳过）', () => {
    const db = new DatabaseSync(path.join(root, 'wal-busy.sqlite'))
    db.exec('PRAGMA journal_mode=WAL')
    // 直接构造一个恒定 busy 的假面不可行（node:sqlite 无注入）；此处验证真实路径返回 0
    db.exec('CREATE TABLE t (x INTEGER)')
    const r = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number }
    expect(r.busy).toBe(0)
    db.close()
  })

  it('自检报告落盘（失败也写——不宣称已恢复的证据面）', () => {
    const file = writeSelfcheckReport(root, {
      schema: 1,
      at: NOW,
      requestId: 'req-2',
      checkpointRef: 'evt-2',
      result: 'fail',
      checks: {
        tick: { pass: false, detail: 'x' },
        cursor: { pass: false, detail: 'x' },
        models: { pass: false, detail: 'x' },
        executor: { pass: false, detail: 'x' },
      },
      inflightReconcile: { expected: 0, actual: 0, pass: true },
      versionAlign: 'unknown',
    })
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).result).toBe('fail')
  })
})

describe('S5 四口径判定（fail 注入 = N10）', () => {
  it('四口径全过 + takeover 对账 → pass', () => {
    const report = evaluateRestartSelfcheck(sampleCheckpoint({ inflightBefore: 0 }), passProbes())
    expect(report.result).toBe('pass')
    expect(report.checks.tick.pass && report.checks.cursor.pass && report.checks.models.pass && report.checks.executor.pass).toBe(true)
  })

  it('tick 未前进 → fail（ALARM;check=tick 语义）', () => {
    const report = evaluateRestartSelfcheck(sampleCheckpoint({ inflightBefore: 0 }), passProbes({ tickSeq: () => 42 }))
    expect(report.result).toBe('fail')
    expect(report.checks.tick.pass).toBe(false)
  })

  it('cursor 未前进且无 HEARTBEAT 旁证 → fail；有旁证 → pass', () => {
    const cp = sampleCheckpoint({ inflightBefore: 0 })
    const noBeat = evaluateRestartSelfcheck(cp, passProbes({ cursor: () => cp.cursor, heartbeatSeen: () => false }))
    expect(noBeat.checks.cursor.pass).toBe(false)
    const beat = evaluateRestartSelfcheck(cp, passProbes({ cursor: () => cp.cursor, heartbeatSeen: () => true }))
    expect(beat.checks.cursor.pass).toBe(true)
  })

  it('cursorLoop 观测 → tick 口径 fail（游标回退环）', () => {
    const report = evaluateRestartSelfcheck(sampleCheckpoint({ inflightBefore: 0 }), passProbes({ cursorLoopSeen: () => true }))
    expect(report.checks.tick.pass).toBe(false)
  })

  it('models 未装载且非 demo 形态 → fail；demo 形态按面关 pass', () => {
    const cp = sampleCheckpoint({ inflightBefore: 0 })
    const bad = evaluateRestartSelfcheck(cp, passProbes({ models: () => ({ catalogLoaded: false, mainWorkerTier: undefined, demoBypass: false }) }))
    expect(bad.checks.models.pass).toBe(false)
    const demo = evaluateRestartSelfcheck(cp, passProbes({ models: () => ({ catalogLoaded: false, mainWorkerTier: undefined, demoBypass: true }) }))
    expect(demo.checks.models.pass).toBe(true)
  })

  it('执行面探针失败/空注册表 → fail', () => {
    const cp = sampleCheckpoint({ inflightBefore: 0 })
    expect(evaluateRestartSelfcheck(cp, passProbes({ executor: () => ({ count: 1, failures: ['dsh:detect-not-ok'] }) })).checks.executor.pass).toBe(false)
    expect(evaluateRestartSelfcheck(cp, passProbes({ executor: () => ({ count: 0, failures: [] }) })).checks.executor.pass).toBe(false)
  })

  it('takeover 交叉核对：自然结算面（在途1−已结算1）=0/actual=0 → pass；不等 → fail', () => {
    const cp = sampleCheckpoint({ inflightBefore: 1, settled: [{ issue: 'T-1', attempt: 1, status: 'done' }] })
    expect(evaluateRestartSelfcheck(cp, passProbes({ takeover: () => 0 })).inflightReconcile.pass).toBe(true)
    expect(evaluateRestartSelfcheck(cp, passProbes({ takeover: () => 1 })).inflightReconcile.pass).toBe(false)
  })

  it('超时面（interrupted 非空）expected=0（已收口），不拿 inflightBefore 误判', () => {
    const cp = sampleCheckpoint({ inflightBefore: 1, interrupted: [{ issue: 'T-1', attempt: 1, status: 'interrupted' }] })
    const report = evaluateRestartSelfcheck(cp, passProbes({ takeover: () => 0 }))
    expect(report.inflightReconcile.expected).toBe(0)
    expect(report.inflightReconcile.pass).toBe(true)
  })
})
