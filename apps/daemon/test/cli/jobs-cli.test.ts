/**
 * jobs CLI 薄壳面（127-A R2 手动补跑，studio-dev-127 §4.3 批示④——docs/17-§2 jobs 行）。
 *
 * 断言即规格（CLI 薄壳纪律：一切语义归 store/调度面，壳只做解析与呈现）：
 *   - list：只读列表（岗行携 job_id/cron/型/下跑/末跑）；库不存在拒收指路 company create；
 *   - catchup：--job 挪槽到当下（upsert 整记录回写——last_run_at 真实末跑不被覆盖）、
 *     成功报文答「然后呢」（下一拍 scheduler 即物化）；job 不在台账如实拒；
 *   - 写面不代建库；裸组/未知子命令走组简段（help-face 测试另锁全局面）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { openLedger, type JobRecord } from '@studio-next/store'

const BIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))
let work = ''
let dbPath = ''
const STALE_SLOT = new Date(2026, 9, 1, 9, 0, 0).getTime() // 蓄意过去槽（停跑象）

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'jobs-cli-'))
  dbPath = path.join(work, 'ledger.sqlite')
  const ledger = openLedger(dbPath)
  const base = (job_id: string, payload: Record<string, unknown>): JobRecord => ({
    job_id,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload,
    next_run_at: STALE_SLOT,
  })
  ledger.upsertJob({ ...base('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }), last_run_at: STALE_SLOT })
  ledger.upsertJob(base('health-patrol-工程部', { type: 'patrol' }))
  ledger.close()
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', timeout: 60_000 })
}

describe('jobs list（只读分诊面）', () => {
  it('岗行全字段可见：型=report/patrol、下跑槽、末跑槽（越窗分诊先看这里）', () => {
    const res = run(['jobs', 'list', '--db', dbPath])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain(`调度岗 2 个——库 ${dbPath}`)
    expect(res.stdout).toContain('daily-report-工程部  0 18 * * *  departments/工程部')
    expect(res.stdout).toContain('型=report')
    expect(res.stdout).toContain('health-patrol-工程部')
    expect(res.stdout).toContain('型=patrol')
    expect(res.stdout).toContain(`下跑=${new Date(STALE_SLOT).toISOString()}`)
    expect(res.stdout).toContain(`末跑=${new Date(STALE_SLOT).toISOString()}`)
  })

  it('库不存在拒收指路（E15②同款：不代建库）', () => {
    const res = run(['jobs', 'list', '--db', path.join(work, 'no-such.sqlite')])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('不代建库')
    expect(res.stderr).toContain('studio-next company create <slug>')
  })

  it('缺 --db → 用法面（非零）', () => {
    const res = run(['jobs', 'list'])
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('--db')
  })
})

describe('jobs catchup（手动补跑——只挪槽不派工）', () => {
  it('成功：next_run_at → 当下、last_run_at 真实末跑原样（upsert 不覆盖跑史）', () => {
    const before = Date.now()
    const res = run(['jobs', 'catchup', '--db', dbPath, '--job', 'daily-report-工程部'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('已补跑排程：daily-report-工程部')
    expect(res.stdout).toContain('下一拍 scheduler 即物化岗单') // 答「然后呢」
    expect(res.stdout).toContain(`原 ${new Date(STALE_SLOT).toISOString()}`)
    const ledger = openLedger(dbPath)
    const job = ledger.getJob('daily-report-工程部')
    ledger.close()
    expect(job?.next_run_at).toBeGreaterThanOrEqual(before) // 挪到当下
    expect(job?.last_run_at).toBe(STALE_SLOT) // 跑史不覆盖
    expect(job?.cron).toBe('0 18 * * *') // 整记录回写不丢字段
  })

  it('job 不在台账（热更移除）→ 如实拒 + jobs list 指路', () => {
    const res = run(['jobs', 'catchup', '--db', dbPath, '--job', 'ghost-job'])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('job 不在台账：ghost-job')
    expect(res.stderr).toContain('studio-next jobs list --db')
  })

  it('缺 --job / 库不存在 → 用法面与拒收面', () => {
    const noJob = run(['jobs', 'catchup', '--db', dbPath])
    expect(noJob.status).not.toBe(0)
    expect(noJob.stderr).toContain('--job')
    const noDb = run(['jobs', 'catchup', '--db', path.join(work, 'no-such.sqlite'), '--job', 'x'])
    expect(noDb.status).toBe(1)
    expect(noDb.stderr).toContain('不代建库')
  })
})
