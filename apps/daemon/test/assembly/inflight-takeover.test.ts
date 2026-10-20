/**
 * inflight-takeover —— serve 启动例行接管 work_records running（DEV-13 R-B 回归集）
 *
 * 规格依据（实现单引用）：
 *   - docs/38-§2「在途接管收口」/ §4 分期表 R-B：serve 启动例行接管 work_records running
 *     （崩溃注入测试语义转正为生产面——crash-injection ③ 的重启恢复语义即本函数）。
 *   - docs/17-§2 主循环七相位：接管是**启动例行**（进程边界一次面），不是第八相位——
 *     七相位结构不动，tick 内零行为。
 *   - docs/17-§6 收割四要件：接管≠收割——handle 已失流不可续，四要件无据不判
 *     （不落 GATE_FAIL、不结算预算 settle）；重派走新 attempt，预算沿用未结预留
 *     （adopt，crash-injection ③ 冻结语义原样）。
 *   - docs/17-§3 事件词表（冻结）：无 WORKER_DEAD 事件名——接管不落台账事件
 *     （观测面=启动日志行 + work_records 终态行本身；加名走 SCHEMA_EVOLVE 批示流）。
 *
 * 分层：真进程面（重启进程真过 runServe 启动序列的例行真跑）由 crash-injection ③
 * 承载；本文件是函数级单测（快、确定）——两层互补，不重复拉进程。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import { takeOverRunningWorkRecords } from '../../src/serve.ts'

const dirs: string[] = []
afterAll(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
})

async function newLedger(): Promise<Ledger> {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-next-takeover-'))
  dirs.push(dir)
  return openLedger(path.join(dir, 'ledger.sqlite'))
}

/** 播种一条工位（缺省 running=孤儿形态；status/ended_at 可覆写造 done/failed 形态） */
function seedWork(ledger: Ledger, spec: { id: string; issue: string; attempt: number; status?: string; endedAt?: number }): void {
  ledger.insertWorkRecord({
    id: spec.id,
    issue: spec.issue,
    person_id: 'AGENT-1',
    executor: 'fake',
    started_at: 1_000,
    attempt: spec.attempt,
    status: spec.status ?? 'running',
    ...(spec.endedAt !== undefined ? { ended_at: spec.endedAt } : {}),
  })
}

describe('R-B 在途接管：takeOverRunningWorkRecords（启动例行，非第八相位）', () => {
  it('孤儿收口：running 工位收口 interrupted + ended_at 落位；done/failed 已收口行不动', async () => {
    const ledger = await newLedger()
    seedWork(ledger, { id: 'w-run', issue: 'T-1', attempt: 1 })
    seedWork(ledger, { id: 'w-done', issue: 'T-2', attempt: 1, status: 'done', endedAt: 1_500 })
    seedWork(ledger, { id: 'w-fail', issue: 'T-3', attempt: 2, status: 'failed', endedAt: 1_600 })

    const result = takeOverRunningWorkRecords(ledger, 2_000)

    expect(result.takenOver).toBe(1)
    expect(result.items).toEqual([{ id: 'w-run', issue: 'T-1', attempt: 1 }]) // 归因面：单号+attempt
    const taken = ledger.getWorkRecord('w-run')
    expect(taken?.status).toBe('interrupted') // 接管≠收割：既不冒认 done 也不误报 failed
    expect(taken?.ended_at).toBe(2_000)
    // 已收口行原样（过滤面先于收口面——不触发 endWorkRecord 的 already-ended 拒）
    expect(ledger.getWorkRecord('w-done')).toMatchObject({ status: 'done', ended_at: 1_500 })
    expect(ledger.getWorkRecord('w-fail')).toMatchObject({ status: 'failed', ended_at: 1_600 })
    ledger.close()
  })

  it('多孤儿全收口：同单多 attempt 与跨单孤儿一律收口（前命多代在途不留残）', async () => {
    const ledger = await newLedger()
    seedWork(ledger, { id: 'w-a1', issue: 'T-1', attempt: 1 })
    seedWork(ledger, { id: 'w-a2', issue: 'T-1', attempt: 2 })
    seedWork(ledger, { id: 'w-b1', issue: 'T-9', attempt: 1 })

    const result = takeOverRunningWorkRecords(ledger, 3_000)

    expect(result.takenOver).toBe(3)
    expect(result.items.map((i) => i.id).sort()).toEqual(['w-a1', 'w-a2', 'w-b1'])
    for (const id of ['w-a1', 'w-a2', 'w-b1']) {
      expect(ledger.getWorkRecord(id)).toMatchObject({ status: 'interrupted', ended_at: 3_000 })
    }
    ledger.close()
  })

  it('幂等：二次接管零收口（已收口行不 CONFIG_INVALID——启动例行可安全重入）', async () => {
    const ledger = await newLedger()
    seedWork(ledger, { id: 'w-1', issue: 'T-1', attempt: 1 })

    const first = takeOverRunningWorkRecords(ledger, 2_000)
    const second = takeOverRunningWorkRecords(ledger, 2_500)

    expect(first.takenOver).toBe(1)
    expect(second).toEqual({ takenOver: 0, items: [] }) // 零收口、零行变动
    expect(ledger.getWorkRecord('w-1')?.ended_at).toBe(2_000) // 不改写首次收口时刻
    ledger.close()
  })

  it('零孤儿 no-op：空库与全收口库返回 0（例行面常跑，无在途即无声过）', async () => {
    const empty = await newLedger()
    expect(takeOverRunningWorkRecords(empty, 1_000)).toEqual({ takenOver: 0, items: [] })
    empty.close()

    const closed = await newLedger()
    seedWork(closed, { id: 'w-done', issue: 'T-1', attempt: 1, status: 'done', endedAt: 1_200 })
    expect(takeOverRunningWorkRecords(closed, 1_300)).toEqual({ takenOver: 0, items: [] })
    closed.close()
  })

  it('预算面零接触：未结 reserve 行原样、不落 settle/refusal（重派 adopt 的前提，17-§6/16-§三）', async () => {
    const ledger = await newLedger()
    seedWork(ledger, { id: 'w-1', issue: 'T-1', attempt: 1 })
    ledger.appendBudget({ id: 'b-reserve', scope_kind: 'issue', scope_id: 'T-1', kind: 'reserve', estimated_usd: 0.01, ts: 1_000 })

    takeOverRunningWorkRecords(ledger, 2_000)

    const budgets = ledger.queryBudgets({ scope_kind: 'issue', scope_id: 'T-1' })
    expect(budgets).toHaveLength(1) // 原行原样：不结算（settle）、不拒派（refusal）、不双落
    expect(budgets[0]).toMatchObject({ kind: 'reserve', estimated_usd: 0.01, ts: 1_000 })
    ledger.close()
  })
})
