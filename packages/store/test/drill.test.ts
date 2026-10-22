/**
 * 删库重建演习测试（F2-12 可操作化；16-§四 v0.2 验收「删库重建演习一次通过」的 CLI 面）。
 *
 * 两段：
 *   1. runLedgerDrill 进程内全链：全新路径四检查全绿 PASS、重建产物留在库路径；
 *      已存在路径拒演（防误删真实台账，store/drill:target-exists）
 *   2. spawn 冒烟（拟冻结验收命令）：node apps/daemon/src/cli/main.ts ledger drill <库路径>
 *      → exit 0 + stdout 含「演习 PASS」+ 比对报告；ledger dump / rebuild 往返；用法错误 exit 1
 * 沿 packages/company/test/init.test.ts 的 spawn 风格（process.execPath 直跑 bin.ts）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, runLedgerDrill } from '../src/index.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-drill-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runLedgerDrill（进程内全链）', () => {
  it('全新路径：语料写入 → dump → 删库三件套 → 原路径重建 → 四检查全绿 PASS', async () => {
    const dbPath = path.join(root, 'drill.db')
    const report = await runLedgerDrill(dbPath)

    expect(report.pass).toBe(true)
    expect(report.checks.map((c) => c.name)).toEqual(['删库到位', '计数一致', '逐条一致', 'schema_version 一致'])
    expect(report.checks.every((c) => c.pass)).toBe(true)
    expect(report.corpus).toBe(26)
    expect(report.dumpedLines).toBe(report.corpus)
    expect(report.rebuiltEvents).toBe(report.corpus)
    expect(report.versionBefore).toBe(12)
    expect(report.versionAfter).toBe(12)

    // 演习产物留在库路径（重建后的库可开可读）
    expect(existsSync(dbPath)).toBe(true)
    const rebuilt = openLedger(dbPath)
    expect(rebuilt.queryEvents().length).toBe(report.corpus)
    expect(rebuilt.version()).toBe(12)
    rebuilt.close()
  })

  it('已存在路径拒演（防误删真实台账）：CONFIG_INVALID 且原库不动', async () => {
    const dbPath = path.join(root, 'real.db')
    const ledger = openLedger(dbPath)
    const version = ledger.version()
    ledger.close()
    await expect(runLedgerDrill(dbPath)).rejects.toMatchObject({
      category: 'CONFIG_INVALID',
      subcause: 'store/drill:target-exists',
    })
    const again = openLedger(dbPath) // 原库原样（未被演习触碰）
    expect(again.version()).toBe(version)
    expect(again.queryEvents()).toEqual([])
    again.close()
  })
})

describe('spawn 冒烟（拟冻结验收命令：studio-next ledger drill → exit 0 + PASS）', () => {
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/daemon/src/cli/main.ts')
  const run = (args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' })

  it('ledger drill → exit 0、stdout 含「演习 PASS」与四项比对报告', () => {
    const dbPath = path.join(root, 'smoke-drill.db')
    const result = run(['ledger', 'drill', dbPath])
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('演习 PASS')
    expect(result.stdout).toContain('删库到位')
    expect(result.stdout).toContain('计数一致')
    expect(result.stdout).toContain('逐条一致')
    expect(result.stdout).toContain('schema_version 一致')
    expect(result.stdout).toContain('26 条事件')
    expect(existsSync(dbPath)).toBe(true) // 重建产物落库路径
  }, 30000)

  it('ledger dump → ledger rebuild 往返：两命令 exit 0，重建库事件数与导出行数一致', () => {
    const dbPath = path.join(root, 'smoke-round.db')
    const jsonl = path.join(root, 'smoke-round.jsonl')
    const target = path.join(root, 'smoke-round-rebuilt.db')
    expect(run(['ledger', 'drill', dbPath]).status).toBe(0) // 先造一个有数据的库

    const dump = run(['ledger', 'dump', dbPath, jsonl])
    expect(dump.status).toBe(0)
    expect(dump.stdout).toContain('已导出 26 行')

    const rebuildRun = run(['ledger', 'rebuild', jsonl, target])
    expect(rebuildRun.status).toBe(0)
    expect(rebuildRun.stdout).toContain('已重建：events=26 / schema v12')

    const rebuilt = openLedger(target)
    expect(rebuilt.queryEvents().length).toBe(26)
    rebuilt.close()
  }, 30000)

  it('drill 已存在库 → exit 1 + stderr 含 target-exists（防误删真实台账）', () => {
    const dbPath = path.join(root, 'smoke-exists.db')
    expect(run(['ledger', 'drill', dbPath]).status).toBe(0)
    const again = run(['ledger', 'drill', dbPath])
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('store/drill:target-exists')
  }, 30000)

  it('用法错误：未知 ledger 子命令 / 缺参 → exit 1 + stderr 错误行 + stdout 简段（studio-dev-103 S1 分面）', () => {
    const bogus = run(['ledger', 'bogus'])
    expect(bogus.status).toBe(1)
    // S1d：错误行→stderr（含已知子命令）；简段→stdout（不再倾倒全文 USAGE）
    expect(bogus.stderr).toContain('ledger：未知子命令：bogus（当前支持：drill、dump、rebuild）')
    expect(bogus.stdout).toContain('本组全文：studio-next ledger --help')

    const missing = run(['ledger', 'drill'])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('需要恰好一个参数')

    const dumpMissing = run(['ledger', 'dump', path.join(root, 'x.db')])
    expect(dumpMissing.status).toBe(1)
    expect(dumpMissing.stderr).toContain('需要恰好两个参数')
  })
})
